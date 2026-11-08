/**
 * Invoices routes — Module 4 Accounts Receivable (AR)
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET    /api/v1/invoices              (List invoices with customer, status, search filters)
 *  - POST   /api/v1/invoices              (Create draft invoice with line items, catalog lookup, dimensions)
 *  - GET    /api/v1/invoices/:id          (Get invoice details with line items and journal entries)
 *  - PATCH  /api/v1/invoices/:id          (Update draft/pending approval invoice)
 *  - DELETE /api/v1/invoices/:id          (Delete draft invoice)
 *  - POST   /api/v1/invoices/:id/issue    (Issue invoice with atomic double-entry GL posting)
 *  - POST   /api/v1/invoices/:id/void     (Void issued invoice with reversing GL entry)
 *  - POST   /api/v1/invoices/:id/payments (Record customer payment against invoice)
 *  - GET    /api/v1/invoices/:id/payments (List payments received for an invoice)
 *  - POST   /api/v1/payments-in           (Unified Payments In: Mode A Invoice, Mode B Direct Income, Mode C Prepayment)
 *  - POST   /api/v1/payments-in/:id/apply (Apply customer prepayment to an open invoice)
 *  - GET    /api/v1/invoices/recurring    (List recurring invoice schedules)
 *  - POST   /api/v1/invoices/recurring    (Create recurring invoice schedule)
 *  - PATCH  /api/v1/invoices/recurring/:id (Update recurring schedule)
 *  - DELETE /api/v1/invoices/recurring/:id (Delete recurring schedule)
 *  - POST   /api/v1/invoices/recurring/:id/run (Manually execute recurring schedule)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import { checkOrganizationLockDate } from '../lib/ledger-posting.js';
import {
  EntryType,
  InvoiceStatus,
  Role,
  TaxTreatment,
  PaymentReceiptType,
  RecurrenceFrequency,
} from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const InvoiceStatusEnum = z.nativeEnum(InvoiceStatus);
const PaymentReceiptTypeEnum = z.nativeEnum(PaymentReceiptType);
const RecurrenceFrequencyEnum = z.nativeEnum(RecurrenceFrequency);

const LineItemInput = z.object({
  itemId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  trackingOptionId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(255),
  quantity: z.number().int().positive().default(1),
  unitPriceCents: z.number().int().nonnegative().default(0),
  amountCents: z.number().int().nonnegative().optional(),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
});

const CreateInvoiceBody = z.object({
  contactId: z.string().uuid(),
  quoteId: z.string().uuid().nullable().optional(),
  invoiceNumber: z.string().trim().min(1).max(50).optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  status: InvoiceStatusEnum.default(InvoiceStatus.DRAFT),
  notes: z.string().trim().max(1000).nullable().optional(),
  lineItems: z.array(LineItemInput).min(1),
});

const UpdateInvoiceBody = z.object({
  contactId: z.string().uuid().optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  status: InvoiceStatusEnum.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lineItems: z.array(LineItemInput).min(1).optional(),
});

const ListInvoicesQuery = z.object({
  status: InvoiceStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

const CreatePaymentInBody = z.object({
  bankAccountId: z.string().uuid().optional(),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  amountCents: z.number().int().positive(),
  reference: z.string().trim().max(100).nullable().optional(),
});

const UnifiedPaymentInBody = z.object({
  receiptType: PaymentReceiptTypeEnum.default(PaymentReceiptType.INVOICE_PAYMENT),
  contactId: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  bankAccountId: z.string().uuid().optional(),
  revenueAccountId: z.string().uuid().optional(),
  trackingOptionId: z.string().uuid().nullable().optional(),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.GST_FREE),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  amountCents: z.number().int().positive(),
  reference: z.string().trim().max(100).nullable().optional(),
});

const ApplyPrepaymentBody = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
});

const CreateRecurringScheduleBody = z.object({
  name: z.string().trim().min(2).max(100),
  frequency: RecurrenceFrequencyEnum,
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  nextRunDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  autoPost: z.boolean().default(false),
  templatePayload: z.record(z.any()),
});

function serializeInvoice<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

const invoiceRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/invoices — List organization invoices
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/invoices',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const parse = ListInvoicesQuery.safeParse(request.query);
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
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { contact: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const invoices = await fastify.prisma.invoice.findMany({
        where: whereClause,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              email: true,
              abn: true,
              paymentTermsDays: true,
            },
          },
          lineItems: true,
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      });

      return reply.code(200).send({ invoices: serializeInvoice(invoices) });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/invoices — Create a draft customer invoice
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/invoices',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreateInvoiceBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const {
        contactId,
        quoteId,
        invoiceNumber: customInvoiceNumber,
        issueDate,
        dueDate,
        status,
        notes,
        lineItems,
      } = parse.data;
      const organizationId = request.user.organizationId!;

      const contact = await fastify.prisma.contact.findFirst({
        where: { id: contactId, organizationId },
      });
      if (!contact) {
        return reply.code(400).send({ error: 'Contact not found' });
      }
      if (contact.type === 'VENDOR') {
        return reply.code(400).send({
          error: 'Cannot issue an invoice to a VENDOR contact. Contact must be CUSTOMER or BOTH.',
        });
      }

      // Generate invoice number if not provided
      let invoiceNumber = customInvoiceNumber;
      if (!invoiceNumber) {
        const count = await fastify.prisma.invoice.count({ where: { organizationId } });
        let candidateNum = 1001 + count;
        while (true) {
          const candidate = `INV-${candidateNum.toString().padStart(4, '0')}`;
          const existing = await fastify.prisma.invoice.findFirst({
            where: { organizationId, invoiceNumber: candidate },
            select: { id: true },
          });
          if (!existing) {
            invoiceNumber = candidate;
            break;
          }
          candidateNum += 1;
        }
      } else {
        const existing = await fastify.prisma.invoice.findFirst({
          where: { organizationId, invoiceNumber },
          select: { id: true },
        });
        if (existing) {
          return reply.code(409).send({
            error: `Invoice number '${invoiceNumber}' already exists in this organization.`,
          });
        }
      }

      // Process line items
      const processedLineItems = lineItems.map((li) => {
        const rawAmount =
          li.amountCents !== undefined && li.amountCents > 0
            ? BigInt(li.amountCents)
            : BigInt(li.unitPriceCents) * BigInt(li.quantity);
        const gstResult = calculateGST(rawAmount, li.taxTreatment);
        return {
          itemId: li.itemId || null,
          accountId: li.accountId || null,
          trackingOptionId: li.trackingOptionId || null,
          description: li.description,
          quantity: li.quantity,
          unitPriceCents: BigInt(li.unitPriceCents),
          amountCents: gstResult.subtotalCents,
          taxTreatment: li.taxTreatment,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
        };
      });

      const totalResult = sumGSTResults(
        processedLineItems.map((li) => ({
          subtotalCents: li.amountCents,
          gstCents: li.gstCents,
          totalCents: li.totalCents,
        })),
      );

      const createdInvoice = await fastify.prisma.invoice.create({
        data: {
          organizationId,
          contactId,
          quoteId: quoteId || null,
          invoiceNumber,
          issueDate: new Date(issueDate),
          dueDate: new Date(dueDate),
          status,
          subtotalCents: totalResult.subtotalCents,
          gstCents: totalResult.gstCents,
          totalCents: totalResult.totalCents,
          amountPaidCents: 0n,
          notes: notes ?? null,
          createdByUserId: request.user.userId,
          lineItems: {
            create: processedLineItems.map((li) => ({
              organizationId,
              itemId: li.itemId,
              accountId: li.accountId,
              trackingOptionId: li.trackingOptionId,
              description: li.description,
              quantity: li.quantity,
              unitPriceCents: li.unitPriceCents,
              amountCents: li.amountCents,
              taxTreatment: li.taxTreatment,
              gstCents: li.gstCents,
              totalCents: li.totalCents,
            })),
          },
        },
        include: {
          contact: true,
          lineItems: true,
        },
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'INVOICE_CREATED',
        entityType: 'INVOICE',
        entityId: createdInvoice.id,
        summary: `Created invoice ${createdInvoice.invoiceNumber} for ${contact.name} ($${(Number(totalResult.totalCents) / 100).toFixed(2)})`,
      });

      return reply.code(201).send({ invoice: serializeInvoice(createdInvoice) });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/invoices/:id — Get single invoice details
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/invoices/:id',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invoice ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lineItems: true,
          paymentsIn: true,
        },
      });

      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      const journalEntry = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'INVOICE',
          referenceId: invoice.id,
        },
        include: {
          lines: {
            include: { account: true, trackingOption: true },
          },
        },
      });

      return reply.code(200).send({
        invoice: serializeInvoice(invoice),
        journalEntry: journalEntry ? serializeInvoice(journalEntry) : null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/invoices/:id — Update draft/pending approval invoice
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/v1/invoices/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invoice ID format' });
      }

      const bodyParse = UpdateInvoiceBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id, organizationId },
      });
      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      if (invoice.status === InvoiceStatus.ISSUED || invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.PARTIALLY_PAID) {
        return reply.code(400).send({
          error: `Cannot modify an invoice in '${invoice.status}' status. Only DRAFT or PENDING_APPROVAL invoices can be edited.`,
        });
      }

      const dataToUpdate: any = {};
      if (bodyParse.data.contactId) dataToUpdate.contactId = bodyParse.data.contactId;
      if (bodyParse.data.issueDate) dataToUpdate.issueDate = new Date(bodyParse.data.issueDate);
      if (bodyParse.data.dueDate) dataToUpdate.dueDate = new Date(bodyParse.data.dueDate);
      if (bodyParse.data.status) dataToUpdate.status = bodyParse.data.status;
      if (bodyParse.data.notes !== undefined) dataToUpdate.notes = bodyParse.data.notes;

      let processedLineItems: any = null;
      if (bodyParse.data.lineItems) {
        processedLineItems = bodyParse.data.lineItems.map((li) => {
          const rawAmount =
            li.amountCents !== undefined && li.amountCents > 0
              ? BigInt(li.amountCents)
              : BigInt(li.unitPriceCents) * BigInt(li.quantity);
          const gstResult = calculateGST(rawAmount, li.taxTreatment);
          return {
            itemId: li.itemId || null,
            accountId: li.accountId || null,
            trackingOptionId: li.trackingOptionId || null,
            description: li.description,
            quantity: li.quantity,
            unitPriceCents: BigInt(li.unitPriceCents),
            amountCents: gstResult.subtotalCents,
            taxTreatment: li.taxTreatment,
            gstCents: gstResult.gstCents,
            totalCents: gstResult.totalCents,
          };
        });

        const totalResult = sumGSTResults(
          processedLineItems.map((li: any) => ({
            subtotalCents: li.amountCents,
            gstCents: li.gstCents,
            totalCents: li.totalCents,
          })),
        );

        dataToUpdate.subtotalCents = totalResult.subtotalCents;
        dataToUpdate.gstCents = totalResult.gstCents;
        dataToUpdate.totalCents = totalResult.totalCents;
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        if (processedLineItems) {
          await tx.invoiceLineItem.deleteMany({
            where: { invoiceId: invoice.id, organizationId },
          });
          await tx.invoiceLineItem.createMany({
            data: processedLineItems.map((li: any) => ({
              invoiceId: invoice.id,
              organizationId,
              itemId: li.itemId,
              accountId: li.accountId,
              trackingOptionId: li.trackingOptionId,
              description: li.description,
              quantity: li.quantity,
              unitPriceCents: li.unitPriceCents,
              amountCents: li.amountCents,
              taxTreatment: li.taxTreatment,
              gstCents: li.gstCents,
              totalCents: li.totalCents,
            })),
          });
        }

        return tx.invoice.update({
          where: { id: invoice.id },
          data: dataToUpdate,
          include: { contact: true, lineItems: true },
        });
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'INVOICE_UPDATED',
        entityType: 'INVOICE',
        entityId: invoice.id,
        summary: `Updated invoice ${invoice.invoiceNumber} (status: ${updated.status})`,
      });

      return reply.code(200).send({ invoice: serializeInvoice(updated) });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/invoices/:id — Delete draft invoice
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/v1/invoices/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invoice ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id, organizationId },
      });
      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      if (invoice.status !== InvoiceStatus.DRAFT) {
        return reply.code(400).send({
          error: `Cannot delete an invoice in '${invoice.status}' status. Only DRAFT invoices can be deleted.`,
        });
      }

      await fastify.prisma.invoice.delete({ where: { id: invoice.id } });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'INVOICE_DELETED',
        entityType: 'INVOICE',
        entityId: invoice.id,
        summary: `Deleted draft invoice ${invoice.invoiceNumber}`,
      });

      return reply.code(200).send({ success: true, message: 'Invoice deleted successfully' });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/invoices/:id/issue — Issue invoice & post to General Ledger
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/invoices/:id/issue',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invoice ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id, organizationId },
        include: { contact: true, lineItems: true },
      });

      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      if (invoice.status !== InvoiceStatus.DRAFT && invoice.status !== InvoiceStatus.PENDING_APPROVAL) {
        return reply.code(400).send({
          error: `Cannot issue invoice in '${invoice.status}' status. Only DRAFT or PENDING_APPROVAL invoices can be issued.`,
        });
      }

      // Check period lock date
      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, invoice.issueDate);
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      // Fetch accounts: 1200 (Accounts Receivable), 2100 (GST Collected), 4000 (Default Sales Revenue)
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['1200', '4000', '2100'] },
          isActive: true,
        },
      });

      const arAccount = accounts.find((a) => a.code === '1200');
      const gstCollectedAccount = accounts.find((a) => a.code === '2100');
      const defaultRevenueAccount = accounts.find((a) => a.code === '4000');

      if (!arAccount || !gstCollectedAccount || !defaultRevenueAccount) {
        return reply.code(500).send({
          error: 'Required Chart of Accounts entries (1200, 2100, 4000) are missing for this organization.',
        });
      }

      const result = await fastify.prisma.$transaction(async (tx) => {
        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.ISSUED,
            approvedByUserId: request.user.userId,
          },
          include: { contact: true, lineItems: true, paymentsIn: true },
        });

        // Double-entry GL lines:
        // - DEBIT Accounts Receivable (1200) for totalCents
        // - CREDIT <Line Item Revenue Account> for subtotalCents (tagged with trackingOptionId)
        // - CREDIT GST Collected (2100) for gstCents
        const journalLinesData: Array<{
          organizationId: string;
          accountId: string;
          trackingOptionId?: string | null;
          entryType: EntryType;
          amountCents: bigint;
        }> = [];

        if (invoice.totalCents > 0n) {
          journalLinesData.push({
            organizationId,
            accountId: arAccount.id,
            entryType: EntryType.DEBIT,
            amountCents: invoice.totalCents,
          });
        }

        for (const li of invoice.lineItems) {
          if (li.amountCents > 0n) {
            journalLinesData.push({
              organizationId,
              accountId: li.accountId || defaultRevenueAccount.id,
              trackingOptionId: li.trackingOptionId || null,
              entryType: EntryType.CREDIT,
              amountCents: li.amountCents,
            });
          }
        }

        if (invoice.gstCents > 0n) {
          journalLinesData.push({
            organizationId,
            accountId: gstCollectedAccount.id,
            entryType: EntryType.CREDIT,
            amountCents: invoice.gstCents,
          });
        }

        const debitSum = journalLinesData
          .filter((l) => l.entryType === EntryType.DEBIT)
          .reduce((sum, l) => sum + l.amountCents, 0n);

        const creditSum = journalLinesData
          .filter((l) => l.entryType === EntryType.CREDIT)
          .reduce((sum, l) => sum + l.amountCents, 0n);

        if (debitSum !== creditSum) {
          throw new Error(
            `General Ledger imbalance on invoice issuance: Debits (${debitSum}) != Credits (${creditSum})`,
          );
        }

        let journalEntry = null;
        if (journalLinesData.length > 0) {
          journalEntry = await tx.journalEntry.create({
            data: {
              organizationId,
              description: `Invoice ${invoice.invoiceNumber} to ${invoice.contact.name}`,
              referenceType: 'INVOICE',
              referenceId: invoice.id,
              postedAt: invoice.issueDate,
              createdByUserId: request.user.userId,
              approvedByUserId: request.user.userId,
              lines: {
                create: journalLinesData.map((l) => ({
                  organizationId,
                  accountId: l.accountId,
                  trackingOptionId: l.trackingOptionId || null,
                  entryType: l.entryType,
                  amountCents: l.amountCents,
                })),
              },
            },
            include: {
              lines: { include: { account: true, trackingOption: true } },
            },
          });
        }

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'INVOICE_ISSUED',
          entityType: 'INVOICE',
          entityId: invoice.id,
          summary: `Issued invoice ${invoice.invoiceNumber} to ${invoice.contact.name} and posted to General Ledger`,
        });

        return { invoice: updatedInvoice, journalEntry };
      });

      return reply.code(200).send({
        invoice: serializeInvoice(result.invoice),
        journalEntry: result.journalEntry ? serializeInvoice(result.journalEntry) : null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/invoices/:id/void — Void an issued unpaid invoice
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/invoices/:id/void',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invoice ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id, organizationId },
        include: { contact: true },
      });

      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      if (invoice.status === InvoiceStatus.VOID) {
        return reply.code(400).send({ error: 'Invoice is already void.' });
      }

      if (invoice.amountPaidCents > 0n) {
        return reply.code(400).send({
          error: 'Cannot void an invoice that has payments recorded against it. Reverse payments first.',
        });
      }

      // Check lock date
      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, new Date());
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      // Find original issuance GL entry
      const originalEntry = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'INVOICE',
          referenceId: invoice.id,
        },
        include: { lines: true },
      });

      const result = await fastify.prisma.$transaction(async (tx) => {
        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.VOID },
        });

        let reversingEntry = null;
        if (originalEntry && originalEntry.lines.length > 0) {
          // Post exact reversing contra-lines: invert DEBIT to CREDIT and vice versa
          const reversingLines = originalEntry.lines.map((l) => ({
            organizationId,
            accountId: l.accountId,
            trackingOptionId: l.trackingOptionId,
            entryType: l.entryType === EntryType.DEBIT ? EntryType.CREDIT : EntryType.DEBIT,
            amountCents: l.amountCents,
          }));

          reversingEntry = await tx.journalEntry.create({
            data: {
              organizationId,
              description: `Void reversal for Invoice ${invoice.invoiceNumber} (${invoice.contact.name})`,
              referenceType: 'INVOICE_VOID',
              referenceId: invoice.id,
              reversesEntryId: originalEntry.id,
              postedAt: new Date(),
              createdByUserId: request.user.userId,
              approvedByUserId: request.user.userId,
              lines: {
                create: reversingLines,
              },
            },
          });

          await tx.journalEntry.update({
            where: { id: originalEntry.id },
            data: { reversedById: reversingEntry.id },
          });
        }

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'INVOICE_VOIDED',
          entityType: 'INVOICE',
          entityId: invoice.id,
          summary: `Voided invoice ${invoice.invoiceNumber} and posted reversing journal entry`,
        });

        return { invoice: updatedInvoice, reversingEntry };
      });

      return reply.code(200).send({
        invoice: serializeInvoice(result.invoice),
        reversingEntry: result.reversingEntry ? serializeInvoice(result.reversingEntry) : null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/invoices/:id/payments — Record customer payment received against invoice
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/invoices/:id/payments',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invoice ID format' });
      }

      const bodyParse = CreatePaymentInBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { id: invoiceId } = paramParse.data;
      const { bankAccountId, paymentDate, amountCents, reference } = bodyParse.data;
      const organizationId = request.user.organizationId!;

      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id: invoiceId, organizationId },
        include: { contact: true },
      });

      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.PENDING_APPROVAL) {
        return reply.code(400).send({
          error: 'Cannot record payment against an unissued invoice. Issue the invoice first.',
        });
      }

      if (invoice.status === InvoiceStatus.PAID) {
        return reply.code(400).send({ error: 'This invoice has already been fully paid.' });
      }

      if (invoice.status === InvoiceStatus.VOID) {
        return reply.code(400).send({ error: 'Cannot record payment against a VOID invoice.' });
      }

      const remainingCents = invoice.totalCents - invoice.amountPaidCents;
      const amountBigInt = BigInt(amountCents);

      if (amountBigInt > remainingCents) {
        return reply.code(400).send({
          error: `Payment amount (${amountCents} cents) exceeds remaining balance (${Number(remainingCents)} cents).`,
        });
      }

      // Check period lock date
      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, new Date(paymentDate));
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      // Bank account selection (default 1000 Operating Bank) & 1200 AR
      let bankAccount = null;
      if (bankAccountId) {
        bankAccount = await fastify.prisma.account.findFirst({
          where: { id: bankAccountId, organizationId, isActive: true },
        });
      } else {
        bankAccount = await fastify.prisma.account.findFirst({
          where: { organizationId, code: '1000', isActive: true },
        });
      }

      const arAccount = await fastify.prisma.account.findFirst({
        where: { organizationId, code: '1200', isActive: true },
      });

      if (!bankAccount || !arAccount) {
        return reply.code(500).send({
          error: 'Required Chart of Accounts entries (Bank Account, 1200 Accounts Receivable) are missing.',
        });
      }

      const result = await fastify.prisma.$transaction(async (tx) => {
        const newAmountPaid = invoice.amountPaidCents + amountBigInt;
        const newStatus =
          newAmountPaid === invoice.totalCents ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

        const paymentIn = await tx.paymentIn.create({
          data: {
            organizationId,
            invoiceId: invoice.id,
            contactId: invoice.contactId,
            receiptType: PaymentReceiptType.INVOICE_PAYMENT,
            bankAccountId: bankAccount.id,
            paymentDate: new Date(paymentDate),
            amountCents: amountBigInt,
            reference: reference ?? null,
          },
        });

        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaidCents: newAmountPaid,
            status: newStatus,
          },
          include: { contact: true, lineItems: true },
        });

        // Double-entry GL: DEBIT Bank Account, CREDIT Accounts Receivable (1200)
        const journalLinesData = [
          {
            organizationId,
            accountId: bankAccount.id,
            entryType: EntryType.DEBIT,
            amountCents: amountBigInt,
          },
          {
            organizationId,
            accountId: arAccount.id,
            entryType: EntryType.CREDIT,
            amountCents: amountBigInt,
          },
        ];

        const journalEntry = await tx.journalEntry.create({
          data: {
            organizationId,
            description: `Payment received for invoice ${invoice.invoiceNumber} from ${invoice.contact.name}`,
            referenceType: 'PAYMENT_IN',
            referenceId: paymentIn.id,
            postedAt: new Date(paymentDate),
            createdByUserId: request.user.userId,
            approvedByUserId: request.user.userId,
            lines: {
              create: journalLinesData,
            },
          },
          include: {
            lines: { include: { account: true } },
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'PAYMENT_IN_RECORDED',
          entityType: 'PAYMENT_IN',
          entityId: paymentIn.id,
          summary: `Recorded $${(amountCents / 100).toFixed(2)} payment from ${invoice.contact.name} for invoice ${invoice.invoiceNumber}`,
        });

        return { paymentIn, invoice: updatedInvoice, journalEntry };
      });

      return reply.code(201).send({
        paymentIn: serializeInvoice(result.paymentIn),
        invoice: serializeInvoice(result.invoice),
        journalEntry: serializeInvoice(result.journalEntry),
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/invoices/:id/payments — List payments received for an invoice
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/invoices/:id/payments',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invoice ID format' });
      }

      const { id: invoiceId } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const payments = await fastify.prisma.paymentIn.findMany({
        where: { invoiceId, organizationId },
        orderBy: { paymentDate: 'desc' },
      });

      return reply.code(200).send({ payments: serializeInvoice(payments) });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/payments-in — Unified Payments In (Modes A, B, C)
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/payments-in',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const bodyParse = UnifiedPaymentInBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const {
        receiptType,
        contactId,
        invoiceId,
        bankAccountId,
        revenueAccountId,
        trackingOptionId,
        taxTreatment,
        paymentDate,
        amountCents,
        reference,
      } = bodyParse.data;
      const organizationId = request.user.organizationId!;

      const contact = await fastify.prisma.contact.findFirst({
        where: { id: contactId, organizationId },
      });
      if (!contact) {
        return reply.code(404).send({ error: 'Contact not found' });
      }

      // Check lock date
      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, new Date(paymentDate));
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const amountBigInt = BigInt(amountCents);

      // Resolve Bank Account
      let bankAccount = null;
      if (bankAccountId) {
        bankAccount = await fastify.prisma.account.findFirst({
          where: { id: bankAccountId, organizationId, isActive: true },
        });
      } else {
        bankAccount = await fastify.prisma.account.findFirst({
          where: { organizationId, code: '1000', isActive: true },
        });
      }
      if (!bankAccount) {
        return reply.code(500).send({ error: 'Operating Bank Account not found.' });
      }

      // -----------------------------------------------------------------------
      // Mode A: INVOICE_PAYMENT
      // -----------------------------------------------------------------------
      if (receiptType === PaymentReceiptType.INVOICE_PAYMENT && invoiceId) {
        const invoice = await fastify.prisma.invoice.findFirst({
          where: { id: invoiceId, organizationId, contactId },
        });
        if (!invoice) {
          return reply.code(404).send({ error: 'Invoice not found for this contact.' });
        }
        if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.VOID) {
          return reply.code(400).send({ error: 'Cannot record payment against draft or void invoice.' });
        }

        const arAccount = await fastify.prisma.account.findFirst({
          where: { organizationId, code: '1200', isActive: true },
        });
        if (!arAccount) {
          return reply.code(500).send({ error: 'Accounts Receivable (1200) not found.' });
        }

        const remainingCents = invoice.totalCents - invoice.amountPaidCents;
        if (amountBigInt > remainingCents) {
          return reply.code(400).send({
            error: `Payment amount (${amountCents} cents) exceeds invoice balance (${Number(remainingCents)} cents).`,
          });
        }

        const result = await fastify.prisma.$transaction(async (tx) => {
          const newAmountPaid = invoice.amountPaidCents + amountBigInt;
          const newStatus =
            newAmountPaid === invoice.totalCents ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

          const paymentIn = await tx.paymentIn.create({
            data: {
              organizationId,
              invoiceId: invoice.id,
              contactId: contact.id,
              receiptType: PaymentReceiptType.INVOICE_PAYMENT,
              bankAccountId: bankAccount.id,
              paymentDate: new Date(paymentDate),
              amountCents: amountBigInt,
              reference: reference ?? null,
            },
          });

          const updatedInvoice = await tx.invoice.update({
            where: { id: invoice.id },
            data: { amountPaidCents: newAmountPaid, status: newStatus },
          });

          const journalLinesData = [
            {
              organizationId,
              accountId: bankAccount.id,
              entryType: EntryType.DEBIT,
              amountCents: amountBigInt,
            },
            {
              organizationId,
              accountId: arAccount.id,
              entryType: EntryType.CREDIT,
              amountCents: amountBigInt,
            },
          ];

          const journalEntry = await tx.journalEntry.create({
            data: {
              organizationId,
              description: `Payment received for invoice ${invoice.invoiceNumber} from ${contact.name}`,
              referenceType: 'PAYMENT_IN',
              referenceId: paymentIn.id,
              postedAt: new Date(paymentDate),
              lines: { create: journalLinesData },
            },
            include: { lines: { include: { account: true } } },
          });

          return { paymentIn, invoice: updatedInvoice, journalEntry };
        });

        return reply.code(201).send({
          paymentIn: serializeInvoice(result.paymentIn),
          invoice: serializeInvoice(result.invoice),
          journalEntry: serializeInvoice(result.journalEntry),
        });
      }

      // -----------------------------------------------------------------------
      // Mode B: DIRECT_INCOME ("Receive Money" without prior invoice)
      // -----------------------------------------------------------------------
      if (receiptType === PaymentReceiptType.DIRECT_INCOME) {
        let revAccount = null;
        if (revenueAccountId) {
          revAccount = await fastify.prisma.account.findFirst({
            where: { id: revenueAccountId, organizationId, type: 'REVENUE', isActive: true },
          });
        } else {
          revAccount = await fastify.prisma.account.findFirst({
            where: { organizationId, code: '4000', isActive: true },
          });
        }
        if (!revAccount) {
          return reply.code(400).send({ error: 'Valid Revenue account required for Direct Income receipt.' });
        }

        const gstAccount = await fastify.prisma.account.findFirst({
          where: { organizationId, code: '2100', isActive: true },
        });
        if (!gstAccount) {
          return reply.code(500).send({ error: 'GST Collected account (2100) not found.' });
        }

        const gstResult = calculateGST(amountBigInt, taxTreatment);

        const result = await fastify.prisma.$transaction(async (tx) => {
          const paymentIn = await tx.paymentIn.create({
            data: {
              organizationId,
              invoiceId: null,
              contactId: contact.id,
              receiptType: PaymentReceiptType.DIRECT_INCOME,
              bankAccountId: bankAccount.id,
              revenueAccountId: revAccount.id,
              trackingOptionId: trackingOptionId || null,
              taxTreatment,
              gstCents: gstResult.gstCents,
              paymentDate: new Date(paymentDate),
              amountCents: amountBigInt,
              reference: reference ?? null,
            },
          });

          // GL Posting:
          // DEBIT Bank Account (Total Amount)
          // CREDIT Revenue Account (Subtotal Amount)
          // CREDIT GST Collected (2100) (GST Amount, if > 0)
          const journalLinesData: Array<{
            organizationId: string;
            accountId: string;
            trackingOptionId?: string | null;
            entryType: EntryType;
            amountCents: bigint;
          }> = [
            {
              organizationId,
              accountId: bankAccount.id,
              entryType: EntryType.DEBIT,
              amountCents: amountBigInt,
            },
            {
              organizationId,
              accountId: revAccount.id,
              trackingOptionId: trackingOptionId || null,
              entryType: EntryType.CREDIT,
              amountCents: gstResult.subtotalCents,
            },
          ];

          if (gstResult.gstCents > 0n) {
            journalLinesData.push({
              organizationId,
              accountId: gstAccount.id,
              entryType: EntryType.CREDIT,
              amountCents: gstResult.gstCents,
            });
          }

          const journalEntry = await tx.journalEntry.create({
            data: {
              organizationId,
              description: `Direct Income received from ${contact.name}${reference ? ` (${reference})` : ''}`,
              referenceType: 'PAYMENT_IN',
              referenceId: paymentIn.id,
              postedAt: new Date(paymentDate),
              lines: { create: journalLinesData },
            },
            include: { lines: { include: { account: true, trackingOption: true } } },
          });

          return { paymentIn, journalEntry };
        });

        return reply.code(201).send({
          paymentIn: serializeInvoice(result.paymentIn),
          journalEntry: serializeInvoice(result.journalEntry),
        });
      }

      // -----------------------------------------------------------------------
      // Mode C: CUSTOMER_PREPAYMENT (Deposit on account / Retainer)
      // -----------------------------------------------------------------------
      const prepaymentAccount = await fastify.prisma.account.findFirst({
        where: { organizationId, code: '2300', isActive: true },
      });
      if (!prepaymentAccount) {
        return reply.code(500).send({
          error: 'Customer Prepayments account (2300) not found in Chart of Accounts.',
        });
      }

      const result = await fastify.prisma.$transaction(async (tx) => {
        const paymentIn = await tx.paymentIn.create({
          data: {
            organizationId,
            invoiceId: null,
            contactId: contact.id,
            receiptType: PaymentReceiptType.CUSTOMER_PREPAYMENT,
            bankAccountId: bankAccount.id,
            paymentDate: new Date(paymentDate),
            amountCents: amountBigInt,
            reference: reference ?? null,
          },
        });

        // GL Posting:
        // DEBIT Bank Account
        // CREDIT Customer Prepayments (2300 Liability)
        const journalLinesData = [
          {
            organizationId,
            accountId: bankAccount.id,
            entryType: EntryType.DEBIT,
            amountCents: amountBigInt,
          },
          {
            organizationId,
            accountId: prepaymentAccount.id,
            entryType: EntryType.CREDIT,
            amountCents: amountBigInt,
          },
        ];

        const journalEntry = await tx.journalEntry.create({
          data: {
            organizationId,
            description: `Customer Prepayment deposit received from ${contact.name}`,
            referenceType: 'PAYMENT_IN',
            referenceId: paymentIn.id,
            postedAt: new Date(paymentDate),
            lines: { create: journalLinesData },
          },
          include: { lines: { include: { account: true } } },
        });

        return { paymentIn, journalEntry };
      });

      return reply.code(201).send({
        paymentIn: serializeInvoice(result.paymentIn),
        journalEntry: serializeInvoice(result.journalEntry),
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/payments-in/:id/apply — Apply Customer Prepayment to open invoice
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/payments-in/:id/apply',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid payment ID format' });
      }

      const bodyParse = ApplyPrepaymentBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { id: paymentId } = paramParse.data;
      const { invoiceId, amountCents } = bodyParse.data;
      const organizationId = request.user.organizationId!;

      const paymentIn = await fastify.prisma.paymentIn.findFirst({
        where: { id: paymentId, organizationId },
        include: { contact: true },
      });

      if (!paymentIn) {
        return reply.code(404).send({ error: 'Payment record not found.' });
      }

      if (paymentIn.receiptType !== PaymentReceiptType.CUSTOMER_PREPAYMENT) {
        return reply.code(400).send({
          error: 'Only CUSTOMER_PREPAYMENT deposits can be applied to open invoices.',
        });
      }

      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id: invoiceId, organizationId, contactId: paymentIn.contactId },
      });

      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found for this customer.' });
      }

      if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.VOID) {
        return reply.code(400).send({ error: 'Can only apply prepayment to issued open invoices.' });
      }

      const applyBigInt = BigInt(amountCents);
      const remainingInvoice = invoice.totalCents - invoice.amountPaidCents;

      if (applyBigInt > remainingInvoice) {
        return reply.code(400).send({
          error: `Application amount ($${(amountCents / 100).toFixed(2)}) exceeds invoice unpaid balance ($${(Number(remainingInvoice) / 100).toFixed(2)}).`,
        });
      }

      // Accounts: 2300 (Customer Prepayments) & 1200 (Accounts Receivable)
      const prepaymentAccount = await fastify.prisma.account.findFirst({
        where: { organizationId, code: '2300', isActive: true },
      });
      const arAccount = await fastify.prisma.account.findFirst({
        where: { organizationId, code: '1200', isActive: true },
      });

      if (!prepaymentAccount || !arAccount) {
        return reply.code(500).send({ error: 'Required accounts 2300 and 1200 missing.' });
      }

      const result = await fastify.prisma.$transaction(async (tx) => {
        const newAmountPaid = invoice.amountPaidCents + applyBigInt;
        const newStatus =
          newAmountPaid === invoice.totalCents ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: { amountPaidCents: newAmountPaid, status: newStatus },
        });

        // GL Posting:
        // DEBIT 2300 Customer Prepayments (reduces prepayment liability)
        // CREDIT 1200 Accounts Receivable (reduces AR asset)
        const journalLinesData = [
          {
            organizationId,
            accountId: prepaymentAccount.id,
            entryType: EntryType.DEBIT,
            amountCents: applyBigInt,
          },
          {
            organizationId,
            accountId: arAccount.id,
            entryType: EntryType.CREDIT,
            amountCents: applyBigInt,
          },
        ];

        const journalEntry = await tx.journalEntry.create({
          data: {
            organizationId,
            description: `Applied prepayment from ${paymentIn.contact.name} to Invoice ${invoice.invoiceNumber}`,
            referenceType: 'PREPAYMENT_APPLICATION',
            referenceId: paymentIn.id,
            postedAt: new Date(),
            lines: { create: journalLinesData },
          },
          include: { lines: { include: { account: true } } },
        });

        return { invoice: updatedInvoice, journalEntry };
      });

      return reply.code(200).send({
        invoice: serializeInvoice(result.invoice),
        journalEntry: serializeInvoice(result.journalEntry),
      });
    },
  );

  // -------------------------------------------------------------------------
  // Recurring Invoice Schedules Management
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/invoices/recurring',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST, Role.AUDITOR),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const schedules = await fastify.prisma.recurringSchedule.findMany({
        where: { organizationId, scheduleType: 'INVOICE' },
        orderBy: { nextRunDate: 'asc' },
      });

      return reply.code(200).send({ schedules });
    },
  );

  fastify.post(
    '/api/v1/invoices/recurring',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreateRecurringScheduleBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { name, frequency, startDate, nextRunDate, autoPost, templatePayload } = parse.data;
      const organizationId = request.user.organizationId!;

      const schedule = await fastify.prisma.recurringSchedule.create({
        data: {
          organizationId,
          scheduleType: 'INVOICE',
          name,
          frequency,
          startDate: new Date(startDate),
          nextRunDate: new Date(nextRunDate),
          autoPost,
          templatePayloadJson: JSON.stringify(templatePayload),
          createdByUserId: request.user.userId,
        },
      });

      return reply.code(201).send({ schedule });
    },
  );

  fastify.patch(
    '/api/v1/invoices/recurring/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid schedule ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const existing = await fastify.prisma.recurringSchedule.findFirst({
        where: { id, organizationId, scheduleType: 'INVOICE' },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'Recurring schedule not found' });
      }

      const schedule = await fastify.prisma.recurringSchedule.update({
        where: { id },
        data: request.body as any,
      });

      return reply.code(200).send({ schedule });
    },
  );

  fastify.delete(
    '/api/v1/invoices/recurring/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid schedule ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      await fastify.prisma.recurringSchedule.deleteMany({
        where: { id, organizationId, scheduleType: 'INVOICE' },
      });

      return reply.code(200).send({ success: true });
    },
  );

  fastify.post(
    '/api/v1/invoices/recurring/:id/run',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid schedule ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const schedule = await fastify.prisma.recurringSchedule.findFirst({
        where: { id, organizationId, scheduleType: 'INVOICE' },
      });
      if (!schedule) {
        return reply.code(404).send({ error: 'Recurring schedule not found' });
      }

      const payload = JSON.parse(schedule.templatePayloadJson);

      // Generate invoice number
      const invoiceCount = await fastify.prisma.invoice.count({ where: { organizationId } });
      const invoiceNumber = `INV-${(1001 + invoiceCount).toString().padStart(4, '0')}`;

      const issueDate = new Date();
      const dueDate = new Date(issueDate.getTime() + (payload.termsDays || 30) * 24 * 60 * 60 * 1000);

      const processedLineItems = (payload.lineItems || []).map((li: any) => {
        const rawAmount =
          li.amountCents !== undefined && li.amountCents > 0
            ? BigInt(li.amountCents)
            : BigInt(li.unitPriceCents || 0) * BigInt(li.quantity || 1);
        const gstResult = calculateGST(rawAmount, li.taxTreatment || TaxTreatment.TAX_EXCLUSIVE);
        return {
          itemId: li.itemId || null,
          accountId: li.accountId || null,
          trackingOptionId: li.trackingOptionId || null,
          description: li.description,
          quantity: li.quantity || 1,
          unitPriceCents: BigInt(li.unitPriceCents || 0),
          amountCents: gstResult.subtotalCents,
          taxTreatment: li.taxTreatment || TaxTreatment.TAX_EXCLUSIVE,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
        };
      });

      const totalResult = sumGSTResults(
        processedLineItems.map((li: any) => ({
          subtotalCents: li.amountCents,
          gstCents: li.gstCents,
          totalCents: li.totalCents,
        })),
      );

      const createdInvoice = await fastify.prisma.invoice.create({
        data: {
          organizationId,
          contactId: payload.contactId,
          invoiceNumber,
          issueDate,
          dueDate,
          status: schedule.autoPost ? InvoiceStatus.ISSUED : InvoiceStatus.DRAFT,
          subtotalCents: totalResult.subtotalCents,
          gstCents: totalResult.gstCents,
          totalCents: totalResult.totalCents,
          notes: payload.notes ? `Recurring Invoice: ${schedule.name}. ${payload.notes}` : `Recurring Invoice: ${schedule.name}`,
          createdByUserId: request.user.userId,
          lineItems: {
            create: processedLineItems.map((li: any) => ({
              organizationId,
              itemId: li.itemId,
              accountId: li.accountId,
              trackingOptionId: li.trackingOptionId,
              description: li.description,
              quantity: li.quantity,
              unitPriceCents: li.unitPriceCents,
              amountCents: li.amountCents,
              taxTreatment: li.taxTreatment,
              gstCents: li.gstCents,
              totalCents: li.totalCents,
            })),
          },
        },
        include: { contact: true, lineItems: true },
      });

      // Calculate next run date based on frequency
      let nextDate = new Date(schedule.nextRunDate);
      if (schedule.frequency === RecurrenceFrequency.WEEKLY) {
        nextDate = new Date(nextDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      } else if (schedule.frequency === RecurrenceFrequency.FORTNIGHTLY) {
        nextDate = new Date(nextDate.getTime() + 14 * 24 * 60 * 60 * 1000);
      } else if (schedule.frequency === RecurrenceFrequency.MONTHLY) {
        nextDate.setMonth(nextDate.getMonth() + 1);
      } else if (schedule.frequency === RecurrenceFrequency.QUARTERLY) {
        nextDate.setMonth(nextDate.getMonth() + 3);
      } else if (schedule.frequency === RecurrenceFrequency.ANNUALLY) {
        nextDate.setFullYear(nextDate.getFullYear() + 1);
      }

      await fastify.prisma.recurringSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunDate: new Date(),
          nextRunDate: nextDate,
        },
      });

      return reply.code(201).send({ invoice: serializeInvoice(createdInvoice) });
    },
  );
};

export default invoiceRoutes;
