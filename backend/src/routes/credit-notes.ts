/**
 * Customer Credit Notes routes — Module 4 Accounts Receivable (AR)
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET  /api/v1/credit-notes           (List customer credit notes with filters)
 *  - POST /api/v1/credit-notes           (Create draft credit note with line items)
 *  - GET  /api/v1/credit-notes/:id       (Get credit note details, lines & journal entries)
 *  - POST /api/v1/credit-notes/:id/issue (Issue credit note with contra-AR GL posting)
 *  - POST /api/v1/credit-notes/:id/allocate (Allocate open credit note to settle customer invoice)
 *  - POST /api/v1/credit-notes/:id/refund   (Process bank refund for open credit note)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import { checkOrganizationLockDate, reverseJournalEntry } from '../lib/ledger-posting.js';
import { CreditNoteStatus, EntryType, Role, TaxTreatment, InvoiceStatus } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const CreditNoteStatusEnum = z.nativeEnum(CreditNoteStatus);

const CreditNoteLineItemInput = z.object({
  itemId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  trackingOptionId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(255),
  amountCents: z.number().int().positive(),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
});

const CreateCreditNoteBody = z.object({
  contactId: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  creditNoteNumber: z.string().trim().min(1).max(50).optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().trim().max(1000).nullable().optional(),
  lineItems: z.array(CreditNoteLineItemInput).min(1),
});

const ListCreditNotesQuery = z.object({
  status: CreditNoteStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

const AllocateCreditNoteBody = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive().optional(),
});

const RefundCreditNoteBody = z.object({
  bankAccountId: z.string().uuid().optional(),
  refundDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

function serializeCreditNote<T extends Record<string, any>>(data: T): any {
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

export const creditNoteRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/credit-notes
  fastify.get(
    '/api/v1/credit-notes',
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
      const parse = ListCreditNotesQuery.safeParse(request.query);
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
          { creditNoteNumber: { contains: search, mode: 'insensitive' } },
          { contact: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const creditNotes = await fastify.prisma.creditNote.findMany({
        where: whereClause,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              email: true,
              abn: true,
            },
          },
          lineItems: true,
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      });

      return reply.code(200).send({ creditNotes: serializeCreditNote(creditNotes) });
    },
  );

  // POST /api/v1/credit-notes
  fastify.post(
    '/api/v1/credit-notes',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreateCreditNoteBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { contactId, invoiceId, creditNoteNumber: customNumber, reference, issueDate, notes, lineItems } =
        parse.data;
      const organizationId = request.user.organizationId!;

      const contact = await fastify.prisma.contact.findFirst({
        where: { id: contactId, organizationId },
      });
      if (!contact) {
        return reply.code(400).send({ error: 'Customer contact not found' });
      }

      // Accounts
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['4000', '4100', '2100', '1200'] },
          isActive: true,
        },
      });

      const defaultRevenueAccount =
        accounts.find((a) => a.code === '4000') ??
        accounts.find((a) => a.code === '4100');

      if (!defaultRevenueAccount) {
        return reply.code(500).send({
          error: 'Revenue account (4000) not found for this organization.',
        });
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
          accountId: item.accountId || defaultRevenueAccount.id,
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

      let creditNoteNumber = customNumber;
      if (!creditNoteNumber) {
        const count = await fastify.prisma.creditNote.count({ where: { organizationId } });
        creditNoteNumber = `CN-${String(count + 1).padStart(5, '0')}`;
      }

      const parsedIssueDate = new Date(issueDate);

      const created = await fastify.prisma.$transaction(async (tx) => {
        const cn = await tx.creditNote.create({
          data: {
            organizationId,
            contactId,
            invoiceId: invoiceId ?? null,
            creditNoteNumber,
            issueDate: parsedIssueDate,
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
          include: {
            contact: true,
            lineItems: true,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'CREDIT_NOTE_CREATED',
          entityType: 'CREDIT_NOTE',
          entityId: cn.id,
          summary: `Created draft credit note ${cn.creditNoteNumber} for ${contact.name} ($${(Number(totalResult.totalCents) / 100).toFixed(2)})`,
        });

        return cn;
      });

      return reply.code(201).send({ creditNote: serializeCreditNote(created) });
    },
  );

  // GET /api/v1/credit-notes/:id
  fastify.get(
    '/api/v1/credit-notes/:id',
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
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const creditNote = await fastify.prisma.creditNote.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lineItems: true,
        },
      });

      if (!creditNote) {
        return reply.code(404).send({ error: 'Credit note not found' });
      }

      const journalEntries = await fastify.prisma.journalEntry.findMany({
        where: { organizationId, referenceType: 'CREDIT_NOTE', referenceId: id },
        include: {
          lines: {
            include: { account: true },
          },
        },
      });

      return reply.code(200).send({
        creditNote: {
          ...serializeCreditNote(creditNote),
          journalEntries: serializeCreditNote(journalEntries),
        },
      });
    },
  );

  // POST /api/v1/credit-notes/:id/issue
  fastify.post(
    '/api/v1/credit-notes/:id/issue',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const cn = await fastify.prisma.creditNote.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lineItems: true,
        },
      });

      if (!cn) return reply.code(404).send({ error: 'Credit note not found' });
      if (cn.status !== CreditNoteStatus.DRAFT) {
        return reply.code(400).send({ error: `Cannot issue credit note in status ${cn.status}` });
      }

      await checkOrganizationLockDate(fastify.prisma, organizationId, cn.issueDate);

      // System Accounts
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['1200', '2100', '4000'] },
          isActive: true,
        },
      });

      const arAccount = accounts.find((a) => a.code === '1200');
      const gstCollectedAccount = accounts.find((a) => a.code === '2100');
      const defaultRevenueAccount = accounts.find((a) => a.code === '4000');

      if (!arAccount || !gstCollectedAccount) {
        return reply.code(500).send({ error: 'Required accounts (1200, 2100) not found' });
      }

      // Contra-AR Journal Lines:
      // DEBIT Revenue for subtotal
      // DEBIT 2100 GST Collected for tax
      // CREDIT 1200 Accounts Receivable for total
      const journalLinesData: Array<{
        organizationId: string;
        accountId: string;
        entryType: EntryType;
        amountCents: bigint;
        trackingOptionId?: string | null;
      }> = [];

      for (const line of cn.lineItems) {
        if (line.amountCents > 0n) {
          journalLinesData.push({
            organizationId,
            accountId: line.accountId || defaultRevenueAccount!.id,
            entryType: EntryType.DEBIT,
            amountCents: line.amountCents,
            trackingOptionId: line.trackingOptionId,
          });
        }
      }

      if (cn.gstCents > 0n) {
        journalLinesData.push({
          organizationId,
          accountId: gstCollectedAccount.id,
          entryType: EntryType.DEBIT,
          amountCents: cn.gstCents,
        });
      }

      journalLinesData.push({
        organizationId,
        accountId: arAccount.id,
        entryType: EntryType.CREDIT,
        amountCents: cn.totalCents,
      });

      const count = await fastify.prisma.journalEntry.count({ where: { organizationId } });
      const entryNumber = `JE-CN-${String(count + 1).padStart(5, '0')}`;

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const je = await tx.journalEntry.create({
          data: {
            organizationId,
            entryNumber,
            description: `Credit Note ${cn.creditNoteNumber} issued to ${cn.contact.name}`,
            referenceType: 'CREDIT_NOTE',
            referenceId: cn.id,
            postedAt: cn.issueDate,
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

        return tx.creditNote.update({
          where: { id },
          data: {
            status: CreditNoteStatus.ISSUED,
          },
          include: { contact: true, lineItems: true },
        });
      });

      return reply.code(200).send({ creditNote: serializeCreditNote(updated) });
    },
  );

  // POST /api/v1/credit-notes/:id/allocate
  fastify.post(
    '/api/v1/credit-notes/:id/allocate',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const parse = AllocateCreditNoteBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parse.error.flatten().fieldErrors });
      }

      const { invoiceId, amountCents: customAmount } = parse.data;

      const cn = await fastify.prisma.creditNote.findFirst({
        where: { id, organizationId },
        include: { contact: true },
      });
      if (!cn) return reply.code(404).send({ error: 'Credit note not found' });
      if (cn.status !== CreditNoteStatus.ISSUED) {
        return reply.code(400).send({ error: `Cannot allocate credit note in status ${cn.status}` });
      }

      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id: invoiceId, organizationId },
      });
      if (!invoice) return reply.code(404).send({ error: 'Invoice not found' });
      if (invoice.contactId !== cn.contactId) {
        return reply.code(400).send({ error: 'Credit note and invoice must belong to the exact same customer' });
      }

      const invoiceRemaining = invoice.totalCents - invoice.amountPaidCents;
      if (invoiceRemaining <= 0n) {
        return reply.code(400).send({ error: 'Invoice has already been fully paid' });
      }

      const remainingCents = cn.totalCents - cn.amountAppliedCents;
      if (remainingCents <= 0n) {
        return reply.code(400).send({ error: 'Credit note has already been fully applied' });
      }

      const allocatable = customAmount ? BigInt(customAmount) : remainingCents;
      if (allocatable <= 0n || allocatable > remainingCents) {
        return reply.code(400).send({ error: `Allocation amount must be between 1 and ${remainingCents} cents` });
      }

      const finalAlloc = allocatable > invoiceRemaining ? invoiceRemaining : allocatable;

      const result = await fastify.prisma.$transaction(async (tx) => {
        const newAmountApplied = cn.amountAppliedCents + finalAlloc;
        const newCnStatus = newAmountApplied >= cn.totalCents ? CreditNoteStatus.APPLIED : CreditNoteStatus.ISSUED;

        const updatedCn = await tx.creditNote.update({
          where: { id: cn.id },
          data: {
            amountAppliedCents: newAmountApplied,
            status: newCnStatus,
          },
        });

        const newInvPaid = invoice.amountPaidCents + finalAlloc;
        const newInvStatus = newInvPaid >= invoice.totalCents ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

        const updatedInv = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaidCents: newInvPaid,
            status: newInvStatus,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'CREDIT_NOTE_ALLOCATED',
          entityType: 'CREDIT_NOTE',
          entityId: cn.id,
          summary: `Allocated $${(Number(finalAlloc) / 100).toFixed(2)} from CN ${cn.creditNoteNumber} to Invoice ${invoice.invoiceNumber}`,
        });

        return { updatedCn, updatedInv, allocatedCents: finalAlloc };
      });

      return reply.code(200).send({
        message: 'Credit note successfully allocated to invoice',
        creditNote: serializeCreditNote(result.updatedCn),
        invoice: serializeCreditNote(result.updatedInv),
        allocatedCents: Number(result.allocatedCents),
      });
    },
  );

  // POST /api/v1/credit-notes/:id/refund
  fastify.post(
    '/api/v1/credit-notes/:id/refund',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const parse = RefundCreditNoteBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parse.error.flatten().fieldErrors });
      }

      const { bankAccountId, refundDate } = parse.data;
      const parsedDate = refundDate ? new Date(refundDate) : new Date();

      await checkOrganizationLockDate(fastify.prisma, organizationId, parsedDate);

      const cn = await fastify.prisma.creditNote.findFirst({
        where: { id, organizationId },
        include: { contact: true },
      });
      if (!cn) return reply.code(404).send({ error: 'Credit note not found' });
      const remainingCents = cn.totalCents - cn.amountAppliedCents;
      if (remainingCents <= 0n) {
        return reply.code(400).send({ error: 'Credit note has zero remaining refundable balance' });
      }

      // Accounts: Bank Account (1000) & AR Account (1200)
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['1000', '1200'] },
          isActive: true,
        },
      });

      const bankAccount = bankAccountId
        ? await fastify.prisma.account.findFirst({ where: { id: bankAccountId, organizationId } })
        : accounts.find((a) => a.code === '1000');

      const arAccount = accounts.find((a) => a.code === '1200');

      if (!bankAccount || !arAccount) {
        return reply.code(500).send({ error: 'Required accounts (1000 Bank, 1200 AR) not found' });
      }

      const refundAmount = remainingCents;

      const result = await fastify.prisma.$transaction(async (tx) => {
        const refundTx = await tx.directTransaction.create({
          data: {
            organizationId,
            type: 'SPEND_MONEY',
            bankAccountId: bankAccount.id,
            contactId: cn.contactId,
            payeeName: cn.contact.name,
            transactionDate: parsedDate,
            subtotalCents: refundAmount,
            gstCents: 0n,
            totalCents: refundAmount,
            reference: `Refund: Credit Note ${cn.creditNoteNumber}`,
            createdByUserId: request.user.userId,
          },
        });

        // GL Lines for Refund:
        // DEBIT 1200 Accounts Receivable (re-establishes AR balance that was cleared by CN)
        // CREDIT 1000 Bank Account (cash payout)
        const count = await tx.journalEntry.count({ where: { organizationId } });
        const entryNumber = `JE-REFUND-${String(count + 1).padStart(5, '0')}`;

        await tx.journalEntry.create({
          data: {
            organizationId,
            entryNumber,
            description: `Bank refund for Credit Note ${cn.creditNoteNumber} (${cn.contact.name})`,
            referenceType: 'CREDIT_NOTE_REFUND',
            referenceId: refundTx.id,
            postedAt: parsedDate,
            status: 'POSTED',
            createdByUserId: request.user.userId,
            lines: {
              create: [
                {
                  organizationId,
                  accountId: arAccount.id,
                  entryType: EntryType.DEBIT,
                  amountCents: refundAmount,
                },
                {
                  organizationId,
                  accountId: bankAccount.id,
                  entryType: EntryType.CREDIT,
                  amountCents: refundAmount,
                },
              ],
            },
          },
        });

        const updatedCn = await tx.creditNote.update({
          where: { id: cn.id },
          data: {
            amountAppliedCents: cn.totalCents,
            status: CreditNoteStatus.APPLIED,
          },
        });

        return { updatedCn, refundTx };
      });

      return reply.code(200).send({
        message: 'Credit note balance refunded successfully',
        creditNote: serializeCreditNote(result.updatedCn),
        refundTransaction: serializeCreditNote(result.refundTx),
      });
    },
  );

  // POST /api/v1/credit-notes/:id/void — Void an unallocated customer credit note
  fastify.post(
    '/api/v1/credit-notes/:id/void',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const cn = await fastify.prisma.creditNote.findFirst({
        where: { id, organizationId },
        include: { contact: true },
      });
      if (!cn) return reply.code(404).send({ error: 'Credit note not found' });
      if (cn.status === CreditNoteStatus.VOID) {
        return reply.code(400).send({ error: 'Credit note is already void.' });
      }
      if (cn.amountAppliedCents > 0n) {
        return reply.code(400).send({
          error: 'Cannot void a credit note that has already been allocated or refunded.',
        });
      }

      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, new Date());
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const originalEntry = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'CREDIT_NOTE',
          referenceId: cn.id,
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
            reason: `Void Credit Note ${cn.creditNoteNumber}`,
            skipSubledgerCascade: true,
          });
        }

        const res = await tx.creditNote.update({
          where: { id: cn.id },
          data: { status: CreditNoteStatus.VOID },
          include: { contact: true, lineItems: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'CREDIT_NOTE_VOIDED',
          entityType: 'CREDIT_NOTE',
          entityId: cn.id,
          summary: `Voided credit note ${cn.creditNoteNumber} (${cn.contact.name})`,
        });

        return res;
      });

      return reply.code(200).send({ creditNote: serializeCreditNote(updated) });
    },
  );

  // DELETE /api/v1/credit-notes/:id — Delete draft or ADMIN force-delete unallocated credit note
  fastify.delete(
    '/api/v1/credit-notes/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const isAdmin = request.user.role === Role.ADMIN;

      const cn = await fastify.prisma.creditNote.findFirst({
        where: { id, organizationId },
      });
      if (!cn) return reply.code(404).send({ error: 'Credit note not found' });

      if (cn.amountAppliedCents > 0n) {
        return reply.code(400).send({
          error: 'Cannot delete a credit note that has already been allocated or refunded.',
        });
      }

      if (cn.status !== CreditNoteStatus.DRAFT && !isAdmin) {
        return reply.code(400).send({
          error: 'Only DRAFT credit notes can be deleted by non-ADMIN users. Void the credit note instead.',
        });
      }

      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, cn.issueDate);
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      await fastify.prisma.$transaction(async (tx) => {
        const linkedJournals = await tx.journalEntry.findMany({
          where: {
            organizationId,
            referenceType: { in: ['CREDIT_NOTE', 'CREDIT_NOTE_VOID'] },
            referenceId: cn.id,
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

        await tx.creditNote.delete({ where: { id: cn.id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'CREDIT_NOTE_DELETED',
          entityType: 'CREDIT_NOTE',
          entityId: cn.id,
          summary: `Deleted credit note ${cn.creditNoteNumber}`,
        });
      });

      return reply.code(200).send({ success: true, message: 'Credit note deleted successfully' });
    },
  );
};

export default creditNoteRoutes;
