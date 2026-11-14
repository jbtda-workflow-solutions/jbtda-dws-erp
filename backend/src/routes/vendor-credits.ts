/**
 * Vendor Credits routes — Module 5 Accounts Payable (AP) & Vendor Returns
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET  /api/v1/vendor-credits           (List vendor credits with filters)
 *  - POST /api/v1/vendor-credits           (Create draft vendor credit with line items)
 *  - GET  /api/v1/vendor-credits/:id       (Get vendor credit details, lines & journal entries)
 *  - POST /api/v1/vendor-credits/:id/issue (Issue vendor credit with GL posting: DEBIT AP, CREDIT Expense/GST Paid)
 *  - POST /api/v1/vendor-credits/:id/allocate (Allocate open vendor credit to settle vendor bill)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import { checkOrganizationLockDate, reverseJournalEntry } from '../lib/ledger-posting.js';
import { CreditNoteStatus, EntryType, Role, TaxTreatment, BillStatus } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const CreditNoteStatusEnum = z.nativeEnum(CreditNoteStatus);

const VendorCreditLineItemInput = z.object({
  itemId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  trackingOptionId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(255),
  amountCents: z.number().int().positive(),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
});

const CreateVendorCreditBody = z.object({
  contactId: z.string().uuid(),
  creditNumber: z.string().trim().min(1).max(50).optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  creditDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().trim().max(1000).nullable().optional(),
  lineItems: z.array(VendorCreditLineItemInput).min(1),
});

const ListVendorCreditsQuery = z.object({
  status: CreditNoteStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

const AllocateVendorCreditBody = z.object({
  billId: z.string().uuid(),
  amountCents: z.number().int().positive().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

function serializeVC<T extends Record<string, any>>(data: T): any {
  const serialized = JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
  if (
    serialized &&
    typeof serialized === 'object' &&
    'totalCents' in serialized &&
    'amountAppliedCents' in serialized
  ) {
    serialized.remainingCents =
      Number(serialized.totalCents ?? 0) - Number(serialized.amountAppliedCents ?? 0);
  }
  return serialized;
}

export const vendorCreditRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/vendor-credits
  fastify.get(
    '/api/v1/vendor-credits',
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
      const parse = ListVendorCreditsQuery.safeParse(request.query);
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
          { reference: { contains: search, mode: 'insensitive' } },
          { contact: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const credits = await fastify.prisma.vendorCredit.findMany({
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

      return reply.code(200).send({ credits: serializeVC(credits) });
    },
  );

  // POST /api/v1/vendor-credits
  fastify.post(
    '/api/v1/vendor-credits',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreateVendorCreditBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { contactId, creditNumber: customNumber, reference, creditDate, notes, lineItems } =
        parse.data;
      const organizationId = request.user.organizationId!;

      const contact = await fastify.prisma.contact.findFirst({
        where: { id: contactId, organizationId },
      });
      if (!contact) {
        return reply.code(400).send({ error: 'Vendor contact not found' });
      }

      // Default Expense Account (6000)
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['6000', '5000'] },
          isActive: true,
        },
      });
      const defaultExpense = accounts.find((a) => a.code === '6000') ?? accounts.find((a) => a.code === '5000');
      if (!defaultExpense) {
        return reply.code(500).send({ error: 'Expense account (6000) not found' });
      }

      const processedLines = lineItems.map((item, idx) => {
        const gstResult = calculateGST(BigInt(item.amountCents), item.taxTreatment);
        return {
          lineNumber: idx + 1,
          itemId: item.itemId ?? null,
          description: item.description,
          amountCents: gstResult.subtotalCents,
          taxTreatment: item.taxTreatment,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
          accountId: item.accountId || defaultExpense.id,
          trackingOptionId: item.trackingOptionId ?? null,
        };
      });

      const totalResult = sumGSTResults(
        processedLines.map((li) => ({
          subtotalCents: li.amountCents,
          gstCents: li.gstCents,
          totalCents: li.totalCents,
        })),
      );

      let referenceNumber = reference || customNumber;
      if (!referenceNumber) {
        const count = await fastify.prisma.vendorCredit.count({ where: { organizationId } });
        referenceNumber = `VC-${String(count + 1).padStart(5, '0')}`;
      }

      const parsedDate = new Date(creditDate);

      const created = await fastify.prisma.$transaction(async (tx) => {
        const vc = await tx.vendorCredit.create({
          data: {
            organizationId,
            contactId,
            reference: referenceNumber,
            issueDate: parsedDate,
            status: CreditNoteStatus.DRAFT,
            subtotalCents: totalResult.subtotalCents,
            gstCents: totalResult.gstCents,
            totalCents: totalResult.totalCents,
            amountAppliedCents: 0n,
            notes: notes ?? null,
            createdByUserId: request.user.userId,
            lineItems: {
              create: processedLines.map((li) => ({
                organizationId,
                description: li.description,
                amountCents: li.amountCents,
                taxTreatment: li.taxTreatment,
                gstCents: li.gstCents,
                totalCents: li.totalCents,
                accountId: li.accountId,
                trackingOptionId: li.trackingOptionId,
              })),
            },
          },
          include: { contact: true, lineItems: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'VENDOR_CREDIT_CREATED',
          entityType: 'VENDOR_CREDIT',
          entityId: vc.id,
          summary: `Created draft vendor credit ${vc.reference || vc.id} for ${contact.name} ($${(Number(totalResult.totalCents) / 100).toFixed(2)})`,
        });

        return vc;
      });

      return reply.code(201).send({ vendorCredit: serializeVC(created) });
    },
  );

  // GET /api/v1/vendor-credits/:id
  fastify.get(
    '/api/v1/vendor-credits/:id',
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

      const vc = await fastify.prisma.vendorCredit.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lineItems: true,
        },
      });

      if (!vc) return reply.code(404).send({ error: 'Vendor credit not found' });

      const journalEntries = await fastify.prisma.journalEntry.findMany({
        where: { organizationId, referenceType: 'VENDOR_CREDIT', referenceId: id },
        include: {
          lines: {
            include: { account: true },
          },
        },
      });

      return reply.code(200).send({
        credit: {
          ...serializeVC(vc),
          journalEntries: serializeVC(journalEntries),
        },
      });
    },
  );

  // POST /api/v1/vendor-credits/:id/issue
  fastify.post(
    '/api/v1/vendor-credits/:id/issue',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const vc = await fastify.prisma.vendorCredit.findFirst({
        where: { id, organizationId },
        include: { contact: true, lineItems: true },
      });

      if (!vc) return reply.code(404).send({ error: 'Vendor credit not found' });
      if (vc.status !== CreditNoteStatus.DRAFT) {
        return reply.code(400).send({ error: `Cannot issue vendor credit in status ${vc.status}` });
      }

      await checkOrganizationLockDate(fastify.prisma, organizationId, vc.issueDate);

      // System Accounts: 2000 AP, 2200 GST Paid, 6000 Expense
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['2000', '2200', '6000', '5000'] },
          isActive: true,
        },
      });

      const apAccount = accounts.find((a) => a.code === '2000');
      const gstPaidAccount = accounts.find((a) => a.code === '2200');
      const defaultExpense = accounts.find((a) => a.code === '6000') ?? accounts.find((a) => a.code === '5000');

      if (!apAccount || !gstPaidAccount) {
        return reply.code(500).send({ error: 'Required accounts (2000 AP, 2200 GST Paid) not found' });
      }

      // Vendor Credit Journal Lines:
      // DEBIT 2000 Accounts Payable for total (reduces AP liability)
      // CREDIT Expense Account(s) for subtotal
      // CREDIT 2200 GST Paid for tax (reduces input tax credit asset)
      const journalLinesData: Array<{
        organizationId: string;
        accountId: string;
        entryType: EntryType;
        amountCents: bigint;
        trackingOptionId?: string | null;
      }> = [
        {
          organizationId,
          accountId: apAccount.id,
          entryType: EntryType.DEBIT,
          amountCents: vc.totalCents,
        },
      ];

      for (const line of vc.lineItems) {
        if (line.amountCents > 0n) {
          journalLinesData.push({
            organizationId,
            accountId: line.accountId || defaultExpense!.id,
            entryType: EntryType.CREDIT,
            amountCents: line.amountCents,
            trackingOptionId: line.trackingOptionId,
          });
        }
      }

      if (vc.gstCents > 0n) {
        journalLinesData.push({
          organizationId,
          accountId: gstPaidAccount.id,
          entryType: EntryType.CREDIT,
          amountCents: vc.gstCents,
        });
      }

      const count = await fastify.prisma.journalEntry.count({ where: { organizationId } });
      const entryNumber = `JE-VC-${String(count + 1).padStart(5, '0')}`;

      const updated = await fastify.prisma.$transaction(async (tx) => {
        await tx.journalEntry.create({
          data: {
            organizationId,
            entryNumber,
            description: `Vendor Credit ${vc.reference || vc.id} from ${vc.contact.name}`,
            referenceType: 'VENDOR_CREDIT',
            referenceId: vc.id,
            postedAt: vc.issueDate,
            status: 'POSTED',
            createdByUserId: request.user.userId,
            lines: {
              create: journalLinesData.map((l) => ({
                organizationId,
                accountId: l.accountId,
                entryType: l.entryType,
                amountCents: l.amountCents,
                trackingOptionId: l.trackingOptionId ?? null,
              })),
            },
          },
        });

        return tx.vendorCredit.update({
          where: { id },
          data: {
            status: CreditNoteStatus.ISSUED,
          },
          include: { contact: true, lineItems: true },
        });
      });

      return reply.code(200).send({ vendorCredit: serializeVC(updated) });
    },
  );

  // POST /api/v1/vendor-credits/:id/allocate
  fastify.post(
    '/api/v1/vendor-credits/:id/allocate',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const parse = AllocateVendorCreditBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parse.error.flatten().fieldErrors });
      }

      const { billId, amountCents: customAmount } = parse.data;

      const vc = await fastify.prisma.vendorCredit.findFirst({
        where: { id, organizationId },
        include: { contact: true },
      });
      if (!vc) return reply.code(404).send({ error: 'Vendor credit not found' });
      if (vc.status !== CreditNoteStatus.ISSUED) {
        return reply.code(400).send({ error: `Cannot allocate vendor credit in status ${vc.status}` });
      }

      const bill = await fastify.prisma.bill.findFirst({
        where: { id: billId, organizationId },
      });
      if (!bill) return reply.code(404).send({ error: 'Bill not found' });
      if (bill.contactId !== vc.contactId) {
        return reply.code(400).send({ error: 'Vendor credit and bill must belong to the exact same vendor' });
      }

      const billRemaining = bill.totalCents - bill.amountPaidCents;
      if (billRemaining <= 0n) {
        return reply.code(400).send({ error: 'Bill has already been fully paid' });
      }

      const remainingCents = vc.totalCents - vc.amountAppliedCents;
      if (remainingCents <= 0n) {
        return reply.code(400).send({ error: 'Vendor credit has already been fully applied' });
      }

      const allocatable = customAmount ? BigInt(customAmount) : remainingCents;
      if (allocatable <= 0n || allocatable > remainingCents) {
        return reply.code(400).send({ error: `Allocation amount must be between 1 and ${remainingCents} cents` });
      }

      const finalAlloc = allocatable > billRemaining ? billRemaining : allocatable;

      const result = await fastify.prisma.$transaction(async (tx) => {
        const newAmountApplied = vc.amountAppliedCents + finalAlloc;
        const newVcStatus = newAmountApplied >= vc.totalCents ? CreditNoteStatus.APPLIED : CreditNoteStatus.ISSUED;

        const updatedVc = await tx.vendorCredit.update({
          where: { id: vc.id },
          data: {
            amountAppliedCents: newAmountApplied,
            status: newVcStatus,
          },
        });

        const newBillPaid = bill.amountPaidCents + finalAlloc;
        const newBillStatus = newBillPaid >= bill.totalCents ? BillStatus.PAID : BillStatus.PARTIALLY_PAID;

        const updatedBill = await tx.bill.update({
          where: { id: bill.id },
          data: {
            amountPaidCents: newBillPaid,
            status: newBillStatus,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'VENDOR_CREDIT_ALLOCATED',
          entityType: 'VENDOR_CREDIT',
          entityId: vc.id,
          summary: `Allocated $${(Number(finalAlloc) / 100).toFixed(2)} from VC ${vc.reference || vc.id} to Bill ${bill.reference || bill.id}`,
        });

        return { updatedVc, updatedBill, allocatedCents: finalAlloc };
      });

      return reply.code(200).send({
        message: 'Vendor credit successfully allocated to bill',
        vendorCredit: serializeVC(result.updatedVc),
        bill: serializeVC(result.updatedBill),
        allocatedCents: Number(result.allocatedCents),
      });
    },
  );

  // POST /api/v1/vendor-credits/:id/void — Void an unallocated vendor credit
  fastify.post(
    '/api/v1/vendor-credits/:id/void',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const vc = await fastify.prisma.vendorCredit.findFirst({
        where: { id, organizationId },
        include: { contact: true },
      });
      if (!vc) return reply.code(404).send({ error: 'Vendor credit not found' });
      if (vc.status === CreditNoteStatus.VOID) {
        return reply.code(400).send({ error: 'Vendor credit is already void.' });
      }
      if (vc.amountAppliedCents > 0n) {
        return reply.code(400).send({
          error: 'Cannot void a vendor credit that has already been allocated to a bill.',
        });
      }

      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, new Date());
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const originalEntry = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'VENDOR_CREDIT',
          referenceId: vc.id,
          status: 'POSTED',
          reversedById: null,
        },
      });

      const updated = await fastify.prisma.$transaction(async (tx) => {
        if (originalEntry) {
          await reverseJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            journalEntryId: originalEntry.id,
            reversalDate: new Date(),
            reason: `Void Vendor Credit ${vc.reference || vc.id}`,
            skipSubledgerCascade: true,
          });
        }

        const res = await tx.vendorCredit.update({
          where: { id: vc.id },
          data: { status: CreditNoteStatus.VOID },
          include: { contact: true, lineItems: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'VENDOR_CREDIT_VOIDED',
          entityType: 'VENDOR_CREDIT',
          entityId: vc.id,
          summary: `Voided vendor credit ${vc.reference || vc.id} (${vc.contact.name})`,
        });

        return res;
      });

      return reply.code(200).send({ vendorCredit: serializeVC(updated) });
    },
  );

  // DELETE /api/v1/vendor-credits/:id — Delete draft or ADMIN force-delete unallocated vendor credit
  fastify.delete(
    '/api/v1/vendor-credits/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const isAdmin = request.user.role === Role.ADMIN;

      const vc = await fastify.prisma.vendorCredit.findFirst({
        where: { id, organizationId },
      });
      if (!vc) return reply.code(404).send({ error: 'Vendor credit not found' });

      if (vc.amountAppliedCents > 0n) {
        return reply.code(400).send({
          error: 'Cannot delete a vendor credit that has already been allocated to a bill.',
        });
      }

      if (vc.status !== CreditNoteStatus.DRAFT && !isAdmin) {
        return reply.code(400).send({
          error: `Only DRAFT vendor credits can be deleted by non-ADMIN users. Void the vendor credit instead.`,
        });
      }

      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, vc.issueDate);
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      await fastify.prisma.$transaction(async (tx) => {
        const linkedJournals = await tx.journalEntry.findMany({
          where: {
            organizationId,
            referenceType: { in: ['VENDOR_CREDIT', 'VENDOR_CREDIT_VOID'] },
            referenceId: vc.id,
          },
          select: { id: true },
        });
        const jIds = linkedJournals.map((j) => j.id);
        if (jIds.length > 0) {
          await tx.journalEntry.updateMany({
            where: {
              organizationId,
              OR: [{ id: { in: jIds } }, { reversedById: { in: jIds } }, { reversesEntryId: { in: jIds } }],
            },
            data: { reversedById: null, reversesEntryId: null },
          });
          await tx.journalEntry.deleteMany({
            where: { id: { in: jIds }, organizationId },
          });
        }

        await tx.vendorCredit.delete({ where: { id: vc.id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'VENDOR_CREDIT_DELETED',
          entityType: 'VENDOR_CREDIT',
          entityId: vc.id,
          summary: `Deleted vendor credit ${vc.reference || vc.id}`,
        });
      });

      return reply.code(200).send({ success: true, message: 'Vendor credit deleted successfully' });
    },
  );
};

export default vendorCreditRoutes;
