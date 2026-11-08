/**
 * Purchase Orders routes — Module 5 Accounts Payable (AP) & Procurement
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET    /api/v1/purchase-orders                  (List POs with supplier, status, search filters)
 *  - POST   /api/v1/purchase-orders                  (Create draft PO with line items & GST calculations)
 *  - GET    /api/v1/purchase-orders/:id              (Get PO details with line items)
 *  - PATCH  /api/v1/purchase-orders/:id              (Update draft/pending approval PO)
 *  - DELETE /api/v1/purchase-orders/:id              (Delete draft PO)
 *  - POST   /api/v1/purchase-orders/:id/approve      (Approve PO by Manager, Accountant, or Admin)
 *  - POST   /api/v1/purchase-orders/:id/reject       (Reject PO)
 *  - POST   /api/v1/purchase-orders/:id/convert-to-bill (1-Click Convert approved PO into Vendor Bill)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import { PurchaseOrderStatus, Role, TaxTreatment, BillStatus } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const PurchaseOrderStatusEnum = z.nativeEnum(PurchaseOrderStatus);

const POLineItemInput = z.object({
  itemId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  trackingOptionId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(255),
  quantity: z.number().int().positive().default(1),
  unitPriceCents: z.number().int().nonnegative().default(0),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
});

const CreatePOBody = z.object({
  contactId: z.string().uuid(),
  poNumber: z.string().trim().min(1).max(50).optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  deliveryDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: PurchaseOrderStatusEnum.default(PurchaseOrderStatus.DRAFT),
  lineItems: z.array(POLineItemInput).min(1),
});

const UpdatePOBody = z.object({
  contactId: z.string().uuid().optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  deliveryDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: PurchaseOrderStatusEnum.optional(),
  lineItems: z.array(POLineItemInput).min(1).optional(),
});

const ListPOsQuery = z.object({
  status: PurchaseOrderStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

function serializePO<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

export const purchaseOrderRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/purchase-orders
  fastify.get(
    '/api/v1/purchase-orders',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AP_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const parse = ListPOsQuery.safeParse(request.query);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { status, contactId, search } = parse.data;
      const organizationId = request.user.organizationId!;

      const whereClause: any = { organizationId };
      if (status) whereClause.status = status;
      if (contactId) whereClause.contactId = contactId;
      if (search && search.length > 0) {
        whereClause.OR = [
          { poNumber: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } },
          { contact: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const purchaseOrders = await fastify.prisma.purchaseOrder.findMany({
        where: whereClause,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              email: true,
              abn: true,
              bankBsb: true,
              bankAccountNumber: true,
            },
          },
          lineItems: true,
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      });

      return reply.code(200).send({ purchaseOrders: serializePO(purchaseOrders) });
    },
  );

  // POST /api/v1/purchase-orders
  fastify.post(
    '/api/v1/purchase-orders',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreatePOBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { contactId, poNumber: customNumber, reference, issueDate, deliveryDate, notes, status, lineItems } =
        parse.data;
      const organizationId = request.user.organizationId!;

      const contact = await fastify.prisma.contact.findFirst({
        where: { id: contactId, organizationId },
      });
      if (!contact) {
        return reply.code(400).send({ error: 'Vendor contact not found' });
      }

      // Accounts
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['6000', '5000'] },
          isActive: true,
        },
      });

      const defaultExpenseAccount =
        accounts.find((a) => a.code === '6000') ??
        accounts.find((a) => a.code === '5000');

      if (!defaultExpenseAccount) {
        return reply.code(500).send({
          error: 'Expense account (6000) not found for this organization.',
        });
      }

      const processedLines = lineItems.map((item, idx) => {
        const lineTotal = BigInt(item.quantity) * BigInt(item.unitPriceCents);
        const gstResult = calculateGST(lineTotal, item.taxTreatment);
        return {
          lineNumber: idx + 1,
          itemId: item.itemId ?? null,
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: BigInt(item.unitPriceCents),
          subtotalCents: gstResult.subtotalCents,
          taxTreatment: item.taxTreatment,
          taxCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
          accountId: item.accountId || defaultExpenseAccount.id,
          trackingOptionId: item.trackingOptionId ?? null,
        };
      });

      const totalResult = sumGSTResults(
        processedLines.map((li) => ({
          subtotalCents: li.subtotalCents,
          gstCents: li.taxCents,
          totalCents: li.totalCents,
        })),
      );

      let poNumber = customNumber;
      if (!poNumber) {
        const count = await fastify.prisma.purchaseOrder.count({ where: { organizationId } });
        poNumber = `PO-${String(count + 1).padStart(5, '0')}`;
      }

      const parsedOrderDate = new Date(issueDate);
      const parsedDeliveryDate = deliveryDate ? new Date(deliveryDate) : null;

      const created = await fastify.prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            organizationId,
            contactId,
            poNumber,
            issueDate: parsedOrderDate,
            deliveryDate: parsedDeliveryDate,
            status,
            subtotalCents: totalResult.subtotalCents,
            gstCents: totalResult.gstCents,
            totalCents: totalResult.totalCents,
            notes: notes ?? null,
            createdByUserId: request.user.userId,
            lineItems: {
              create: processedLines.map((li) => ({
                organizationId,
                itemId: li.itemId,
                description: li.description,
                quantity: li.quantity,
                unitPriceCents: li.unitPriceCents,
                amountCents: li.subtotalCents,
                taxTreatment: li.taxTreatment,
                gstCents: li.taxCents,
                totalCents: li.totalCents,
                accountId: li.accountId,
                trackingOptionId: li.trackingOptionId,
              })),
            },
          },
          include: {
            contact: true,
            lineItems: true,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'PURCHASE_ORDER_CREATED',
          entityType: 'PURCHASE_ORDER',
          entityId: po.id,
          summary: `Created Purchase Order ${po.poNumber} for ${contact.name} ($${(Number(totalResult.totalCents) / 100).toFixed(2)})`,
        });

        return po;
      });

      return reply.code(201).send({ purchaseOrder: serializePO(created) });
    },
  );

  // GET /api/v1/purchase-orders/:id
  fastify.get(
    '/api/v1/purchase-orders/:id',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AP_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const po = await fastify.prisma.purchaseOrder.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lineItems: true,
        },
      });

      if (!po) return reply.code(404).send({ error: 'Purchase order not found' });
      return reply.code(200).send({ purchaseOrder: serializePO(po) });
    },
  );

  // PATCH /api/v1/purchase-orders/:id
  fastify.patch(
    '/api/v1/purchase-orders/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const existing = await fastify.prisma.purchaseOrder.findFirst({
        where: { id, organizationId },
      });
      if (!existing) return reply.code(404).send({ error: 'Purchase order not found' });

      if (existing.status === PurchaseOrderStatus.BILLED) {
        return reply.code(400).send({ error: 'Cannot modify a billed purchase order' });
      }

      const parse = UpdatePOBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parse.error.flatten().fieldErrors });
      }

      const { contactId, issueDate, deliveryDate, notes, status, lineItems } = parse.data;

      // Accounts
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['6000', '5000'] },
          isActive: true,
        },
      });
      const defaultExpenseAccount = accounts.find((a) => a.code === '6000') ?? accounts.find((a) => a.code === '5000');

      const updated = await fastify.prisma.$transaction(async (tx) => {
        let subtotalCents = existing.subtotalCents;
        let gstCents = existing.gstCents;
        let totalCents = existing.totalCents;

        if (lineItems && lineItems.length > 0) {
          await tx.purchaseOrderLineItem.deleteMany({ where: { purchaseOrderId: id } });

          const processed = lineItems.map((item) => {
            const lineTotal = BigInt(item.quantity) * BigInt(item.unitPriceCents);
            const gstResult = calculateGST(lineTotal, item.taxTreatment);
            return {
              organizationId,
              purchaseOrderId: id,
              itemId: item.itemId ?? null,
              description: item.description,
              quantity: item.quantity,
              unitPriceCents: BigInt(item.unitPriceCents),
              amountCents: gstResult.subtotalCents,
              taxTreatment: item.taxTreatment,
              gstCents: gstResult.gstCents,
              totalCents: gstResult.totalCents,
              accountId: item.accountId || defaultExpenseAccount?.id!,
              trackingOptionId: item.trackingOptionId ?? null,
            };
          });

          const totals = sumGSTResults(
            processed.map((p) => ({
              subtotalCents: p.amountCents,
              gstCents: p.gstCents,
              totalCents: p.totalCents,
            })),
          );

          subtotalCents = totals.subtotalCents;
          gstCents = totals.gstCents;
          totalCents = totals.totalCents;

          await tx.purchaseOrderLineItem.createMany({ data: processed });
        }

        return tx.purchaseOrder.update({
          where: { id },
          data: {
            contactId: contactId ?? existing.contactId,
            issueDate: issueDate ? new Date(issueDate) : existing.issueDate,
            deliveryDate: deliveryDate !== undefined ? (deliveryDate ? new Date(deliveryDate) : null) : existing.deliveryDate,
            notes: notes !== undefined ? notes : existing.notes,
            status: status ?? existing.status,
            subtotalCents,
            gstCents,
            totalCents,
          },
          include: { contact: true, lineItems: true },
        });
      });

      return reply.code(200).send({ purchaseOrder: serializePO(updated) });
    },
  );

  // DELETE /api/v1/purchase-orders/:id
  fastify.delete(
    '/api/v1/purchase-orders/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const existing = await fastify.prisma.purchaseOrder.findFirst({
        where: { id, organizationId },
      });
      if (!existing) return reply.code(404).send({ error: 'Purchase order not found' });
      if (existing.status === PurchaseOrderStatus.BILLED) {
        return reply.code(400).send({ error: 'Cannot delete a billed purchase order' });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.purchaseOrderLineItem.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrder.delete({ where: { id } });
      });

      return reply.code(200).send({ message: 'Purchase order deleted successfully' });
    },
  );

  // POST /api/v1/purchase-orders/:id/approve
  fastify.post(
    '/api/v1/purchase-orders/:id/approve',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const existing = await fastify.prisma.purchaseOrder.findFirst({
        where: { id, organizationId },
      });
      if (!existing) return reply.code(404).send({ error: 'Purchase order not found' });

      const updated = await fastify.prisma.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.APPROVED,
          approvedByUserId: request.user.userId,
        },
        include: { contact: true, lineItems: true },
      });

      return reply.code(200).send({ message: 'Purchase order approved', purchaseOrder: serializePO(updated) });
    },
  );

  // POST /api/v1/purchase-orders/:id/reject
  fastify.post(
    '/api/v1/purchase-orders/:id/reject',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const updated = await fastify.prisma.purchaseOrder.update({
        where: { id, organizationId },
        data: { status: PurchaseOrderStatus.REJECTED },
        include: { contact: true, lineItems: true },
      });

      return reply.code(200).send({ message: 'Purchase order rejected', purchaseOrder: serializePO(updated) });
    },
  );

  // POST /api/v1/purchase-orders/:id/convert-to-bill (1-Click PO -> Bill Conversion)
  fastify.post(
    '/api/v1/purchase-orders/:id/convert-to-bill',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const po = await fastify.prisma.purchaseOrder.findFirst({
        where: { id, organizationId },
        include: { contact: true, lineItems: true },
      });

      if (!po) return reply.code(404).send({ error: 'Purchase order not found' });
      if (po.status === PurchaseOrderStatus.BILLED) {
        return reply.code(400).send({ error: 'Purchase order has already been converted to a bill' });
      }

      const issueDate = new Date();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (po.contact.paymentTermsDays || 30));

      const result = await fastify.prisma.$transaction(async (tx) => {
        const bill = await tx.bill.create({
          data: {
            organizationId,
            contactId: po.contactId,
            reference: po.poNumber,
            issueDate,
            dueDate,
            status: BillStatus.DRAFT,
            subtotalCents: po.subtotalCents,
            gstCents: po.gstCents,
            totalCents: po.totalCents,
            amountPaidCents: 0n,
            notes: po.notes,
            purchaseOrderId: po.id,
            lineItems: {
              create: po.lineItems.map((li) => ({
                organizationId,
                itemId: li.itemId,
                description: li.description,
                quantity: li.quantity,
                unitPriceCents: li.unitPriceCents,
                amountCents: li.amountCents,
                taxTreatment: li.taxTreatment || TaxTreatment.TAX_EXCLUSIVE,
                gstCents: li.gstCents,
                totalCents: li.totalCents,
                accountId: li.accountId,
                trackingOptionId: li.trackingOptionId,
              })),
            },
          },
          include: { contact: true, lineItems: true },
        });

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: PurchaseOrderStatus.BILLED,
            convertedBillId: bill.id,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'PURCHASE_ORDER_CONVERTED',
          entityType: 'PURCHASE_ORDER',
          entityId: po.id,
          summary: `Converted Purchase Order ${po.poNumber} to Bill ${bill.reference || bill.id}`,
        });

        return bill;
      });

      return reply.code(201).send({
        message: 'Successfully converted Purchase Order to Vendor Bill',
        bill: serializePO(result),
      });
    },
  );
};

export default purchaseOrderRoutes;
