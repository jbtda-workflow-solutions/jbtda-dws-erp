/**
 * Bills routes — Module 5 Accounts Payable (AP) & Enterprise Procurement
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET    /api/v1/bills                  (List bills with contact, status, search filters)
 *  - POST   /api/v1/bills                  (Create draft or direct-posted bill with line items)
 *  - GET    /api/v1/bills/:id              (Get single bill details with line items and journal entries)
 *  - PATCH  /api/v1/bills/:id              (Update draft/awaiting-approval bill)
 *  - DELETE /api/v1/bills/:id              (Delete draft bill)
 *  - POST   /api/v1/bills/:id/approve      (Approve bill and post to General Ledger)
 *  - POST   /api/v1/bills/:id/void         (Void bill and reverse General Ledger journal entry)
 *  - POST   /api/v1/bills/:id/payments     (Record payment out against bill)
 *  - GET    /api/v1/bills/:id/payments     (List payments recorded for a bill)
 *  - POST   /api/v1/payments-out           (Unified alias for recording payments out)
 *  - GET    /api/v1/recurring-bills        (List recurring bill schedules)
 *  - POST   /api/v1/recurring-bills        (Create recurring bill schedule)
 *  - PATCH  /api/v1/recurring-bills/:id    (Update recurring bill schedule)
 *  - DELETE /api/v1/recurring-bills/:id    (Delete recurring bill schedule)
 *  - POST   /api/v1/recurring-bills/:id/run(Manually trigger recurring bill run)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import {
  checkOrganizationLockDate,
  postJournalEntry,
  reverseJournalEntry,
  syncOrReplaceJournalEntry,
} from '../lib/ledger-posting.js';
import { BillStatus, EntryType, JournalStatus, RecurrenceFrequency, Role, TaxTreatment } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const BillStatusEnum = z.nativeEnum(BillStatus);
const RecurrenceFrequencyEnum = z.nativeEnum(RecurrenceFrequency);

const LineItemInput = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(255),
  quantity: z.number().positive().default(1),
  unitPriceCents: z.number().int().nonnegative().optional(),
  amountCents: z.number().int().positive().optional(),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
  accountId: z.string().uuid().optional(),
  trackingOptionId: z.string().uuid().optional(),
});

const CreateBillBody = z.object({
  contactId: z.string().uuid(),
  billNumber: z.string().trim().min(1).optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().trim().max(1000).nullable().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  autoApprove: z.boolean().default(true),
  lineItems: z.array(LineItemInput).min(1),
});

const UpdateBillBody = z.object({
  contactId: z.string().uuid().optional(),
  billNumber: z.string().trim().min(1).optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lineItems: z.array(LineItemInput).min(1).optional(),
});

const ListBillsQuery = z.object({
  status: BillStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

const RecordPaymentBody = z.object({
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  amountCents: z.number().int().positive(),
  paymentMethod: z.string().default('DIRECT_CREDIT'),
  reference: z.string().trim().max(100).nullable().optional(),
});

const CreatePaymentOutBody = RecordPaymentBody.extend({
  billId: z.string().uuid(),
});

const RecurringBillBody = z.object({
  name: z.string().min(1),
  contactId: z.string().uuid(),
  frequency: RecurrenceFrequencyEnum,
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  notes: z.string().optional(),
  lineItems: z.array(LineItemInput).min(1),
});

function serializeBill<T extends Record<string, any>>(bill: T): any {
  return JSON.parse(
    JSON.stringify(bill, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

export const billRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/bills
  fastify.get(
    '/api/v1/bills',
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
      const parse = ListBillsQuery.safeParse(request.query);
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

      const bills = await fastify.prisma.bill.findMany({
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
          paymentsOut: true,
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      });

      return reply.code(200).send({ bills: serializeBill(bills) });
    },
  );

  // POST /api/v1/bills — Create Bill (Draft or Approved)
  fastify.post(
    '/api/v1/bills',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreateBillBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { contactId, billNumber: customBillNumber, reference, issueDate, dueDate, notes, purchaseOrderId, autoApprove, lineItems } =
        parse.data;
      const organizationId = request.user.organizationId!;
      const parsedIssueDate = new Date(issueDate);
      const parsedDueDate = new Date(dueDate);

      const initialStatus: BillStatus = autoApprove
        ? BillStatus.AWAITING_PAYMENT
        : BillStatus.PENDING_APPROVAL;

      if (autoApprove) {
        const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, parsedIssueDate);
        if (lockCheck.locked) {
          return reply.code(400).send({ error: lockCheck.message });
        }
      }

      const contact = await fastify.prisma.contact.findFirst({
        where: { id: contactId, organizationId },
      });

      if (!contact) {
        return reply.code(400).send({ error: 'Contact not found' });
      }

      if (contact.type === 'CUSTOMER') {
        return reply.code(400).send({
          error: 'Cannot record a bill against a CUSTOMER contact. Contact must be VENDOR or BOTH.',
        });
      }

      // Accounts
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['6000', '5000', '2200', '2000'] },
          isActive: true,
        },
      });

      const expenseAccount =
        accounts.find((a) => a.code === '6000') ??
        accounts.find((a) => a.code === '5000');
      const gstPaidAccount = accounts.find((a) => a.code === '2200');
      const apAccount = accounts.find((a) => a.code === '2000');

      if (!expenseAccount || !gstPaidAccount || !apAccount) {
        return reply.code(500).send({
          error:
            'Required Chart of Accounts entries (2000, 2200, 6000) are missing for this organization.',
        });
      }

      // Compute GST
      const processedLineItems = lineItems.map((item) => {
        const qty = item.quantity ?? 1;
        const unitPrice = item.unitPriceCents ?? (item.amountCents ? Math.round(item.amountCents / qty) : 0);
        const rawAmount = item.amountCents
          ? BigInt(item.amountCents)
          : BigInt(Math.round(qty * unitPrice));
        const gstResult = calculateGST(rawAmount, item.taxTreatment);
        return {
          itemId: item.itemId || null,
          description: item.description,
          quantity: qty,
          unitPriceCents: BigInt(unitPrice),
          taxTreatment: item.taxTreatment,
          amountCents: gstResult.subtotalCents,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
          accountId: item.accountId || expenseAccount.id,
          trackingOptionId: item.trackingOptionId || null,
        };
      });

      const totalResult = sumGSTResults(
        processedLineItems.map((item) => ({
          subtotalCents: item.amountCents,
          gstCents: item.gstCents,
          totalCents: item.totalCents,
        })),
      );

      const createdBill = await fastify.prisma.$transaction(async (tx) => {
        const bill = await tx.bill.create({
          data: {
            organizationId,
            contactId,
            reference: reference ?? customBillNumber ?? null,
            issueDate: parsedIssueDate,
            dueDate: parsedDueDate,
            status: initialStatus,
            subtotalCents: totalResult.subtotalCents,
            gstCents: totalResult.gstCents,
            totalCents: totalResult.totalCents,
            amountPaidCents: 0n,
            notes: notes ?? null,
            purchaseOrderId: purchaseOrderId ?? null,
            createdByUserId: request.user.userId,
            approvedByUserId: autoApprove ? request.user.userId : null,
            lineItems: {
              create: processedLineItems.map((li) => ({
                organizationId,
                itemId: li.itemId,
                accountId: li.accountId,
                trackingOptionId: li.trackingOptionId,
                quantity: li.quantity,
                unitPriceCents: li.unitPriceCents,
                description: li.description,
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

        // GL Journal Entry if auto-approved
        if (autoApprove && totalResult.totalCents > 0n) {
          const lines: Array<{
            accountId: string;
            description: string;
            entryType: EntryType;
            amountCents: bigint;
            trackingOptionId?: string | null;
          }> = [];

          // Group debits by account & tracking option
          for (const item of processedLineItems) {
            if (item.amountCents > 0n) {
              lines.push({
                accountId: item.accountId,
                description: `${bill.reference || bill.id}: ${item.description}`,
                entryType: EntryType.DEBIT,
                amountCents: item.amountCents,
                trackingOptionId: item.trackingOptionId,
              });
            }
          }

          if (totalResult.gstCents > 0n) {
            lines.push({
              accountId: gstPaidAccount.id,
              description: `GST Paid on Bill ${bill.reference || bill.id}`,
              entryType: EntryType.DEBIT,
              amountCents: totalResult.gstCents,
            });
          }

          lines.push({
            accountId: apAccount.id,
            description: `Bill ${bill.reference || bill.id} - ${contact.name}`,
            entryType: EntryType.CREDIT,
            amountCents: totalResult.totalCents,
          });

          await postJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: `Bill ${bill.reference || bill.id} from ${contact.name}${reference ? ` (${reference})` : ''}`,
            referenceType: 'BILL',
            referenceId: bill.id,
            postedAt: parsedIssueDate,
            lines,
          });
        }

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BILL_CREATED',
          entityType: 'BILL',
          entityId: bill.id,
          summary: `Recorded bill ${bill.reference || bill.id} from ${contact.name} for $${(Number(totalResult.totalCents) / 100).toFixed(2)} (Status: ${initialStatus})`,
        });

        return bill;
      });

      return reply.code(201).send({ bill: serializeBill(createdBill) });
    },
  );

  // GET /api/v1/bills/:id
  fastify.get(
    '/api/v1/bills/:id',
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
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid bill ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const bill = await fastify.prisma.bill.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lineItems: true,
          paymentsOut: true,
        },
      });

      if (!bill) {
        return reply.code(404).send({ error: 'Bill not found' });
      }

      const journalEntry = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'BILL',
          referenceId: bill.id,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          lines: {
            include: { account: true },
          },
        },
      });

      return reply.code(200).send({
        bill: serializeBill(bill),
        journalEntry: journalEntry ? serializeBill(journalEntry) : null,
      });
    },
  );

  // PATCH /api/v1/bills/:id — Update draft, pending_approval, or unpaid awaiting_payment bill (with GL sync)
  fastify.patch(
    '/api/v1/bills/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const userRole = request.user.role!;
      const bill = await fastify.prisma.bill.findFirst({
        where: { id, organizationId },
        include: { contact: true, lineItems: true },
      });

      if (!bill) {
        return reply.status(404).send({ error: 'Bill not found' });
      }

      const canEditPosted = userRole === Role.ADMIN || userRole === Role.ACCOUNTANT;

      if (bill.status === BillStatus.VOID) {
        return reply.status(400).send({ error: 'Cannot edit a VOID bill.' });
      }

      if (bill.amountPaidCents > 0n) {
        return reply.status(400).send({
          error: 'Cannot edit a bill that has recorded payments. Reverse the payment first.',
        });
      }

      if (bill.status === BillStatus.AWAITING_PAYMENT && !canEditPosted) {
        return reply.status(403).send({
          error: 'Only ADMIN or ACCOUNTANT users can edit an already-approved bill.',
        });
      }

      const parse = UpdateBillBody.safeParse(request.body);
      if (!parse.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parse.error.issues });
      }

      const { contactId, billNumber, reference, issueDate, dueDate, notes, lineItems } = parse.data;
      const targetIssueDate = issueDate ? new Date(issueDate) : bill.issueDate;

      if (bill.status === BillStatus.AWAITING_PAYMENT) {
        const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, targetIssueDate);
        if (lockCheck.locked) {
          return reply.status(400).send({ error: lockCheck.message });
        }
      }

      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['6000', '5000', '2200', '2000'] },
          isActive: true,
        },
      });
      const expenseAccount =
        accounts.find((a) => a.code === '6000') ??
        accounts.find((a) => a.code === '5000');
      const gstPaidAccount = accounts.find((a) => a.code === '2200');
      const apAccount = accounts.find((a) => a.code === '2000');

      if (!expenseAccount || !gstPaidAccount || !apAccount) {
        return reply.code(500).send({
          error: 'Required Chart of Accounts entries (2000, 2200, 6000) are missing.',
        });
      }

      try {
        const updated = await fastify.prisma.$transaction(async (tx) => {
          let subtotalCents = bill.subtotalCents;
          let gstCents = bill.gstCents;
          let totalCents = bill.totalCents;

          if (lineItems && lineItems.length > 0) {
            await tx.billLineItem.deleteMany({ where: { billId: id } });

            const processedLines = lineItems.map((item) => {
              const qty = item.quantity ?? 1;
              const unitPrice =
                item.unitPriceCents ?? (item.amountCents ? Math.round(item.amountCents / qty) : 0);
              const rawAmount = item.amountCents
                ? BigInt(item.amountCents)
                : BigInt(Math.round(qty * unitPrice));
              const gstResult = calculateGST(rawAmount, item.taxTreatment);
              return {
                organizationId,
                itemId: item.itemId || null,
                accountId: item.accountId || expenseAccount.id,
                trackingOptionId: item.trackingOptionId || null,
                quantity: qty,
                unitPriceCents: BigInt(unitPrice),
                description: item.description,
                taxTreatment: item.taxTreatment,
                amountCents: gstResult.subtotalCents,
                gstCents: gstResult.gstCents,
                totalCents: gstResult.totalCents,
              };
            });

            const totals = sumGSTResults(
              processedLines.map((li) => ({
                subtotalCents: li.amountCents,
                gstCents: li.gstCents,
                totalCents: li.totalCents,
              })),
            );

            subtotalCents = totals.subtotalCents;
            gstCents = totals.gstCents;
            totalCents = totals.totalCents;

            await tx.billLineItem.createMany({
              data: processedLines.map((li) => ({ ...li, billId: id })),
            });
          }

          const updatedBill = await tx.bill.update({
            where: { id },
            data: {
              contactId: contactId ?? bill.contactId,
              reference: reference !== undefined ? reference : (billNumber ?? bill.reference),
              issueDate: targetIssueDate,
              dueDate: dueDate ? new Date(dueDate) : bill.dueDate,
              notes: notes !== undefined ? notes : bill.notes,
              subtotalCents,
              gstCents,
              totalCents,
            },
            include: { contact: true, lineItems: true, paymentsOut: true },
          });

          // If bill is AWAITING_PAYMENT, synchronize its active General Ledger journal entry
          if (updatedBill.status === BillStatus.AWAITING_PAYMENT && updatedBill.totalCents > 0n) {
            const glLines: Array<{
              accountId: string;
              description: string;
              entryType: EntryType;
              amountCents: bigint;
              trackingOptionId?: string | null;
            }> = [];

            for (const item of updatedBill.lineItems) {
              if (item.amountCents > 0n) {
                glLines.push({
                  accountId: item.accountId || expenseAccount.id,
                  description: `${updatedBill.reference || updatedBill.id}: ${item.description}`,
                  entryType: EntryType.DEBIT,
                  amountCents: item.amountCents,
                  trackingOptionId: item.trackingOptionId,
                });
              }
            }

            if (updatedBill.gstCents > 0n) {
              glLines.push({
                accountId: gstPaidAccount.id,
                description: `GST Paid on Bill ${updatedBill.reference || updatedBill.id}`,
                entryType: EntryType.DEBIT,
                amountCents: updatedBill.gstCents,
              });
            }

            glLines.push({
              accountId: apAccount.id,
              description: `Bill ${updatedBill.reference || updatedBill.id} - ${updatedBill.contact.name}`,
              entryType: EntryType.CREDIT,
              amountCents: updatedBill.totalCents,
            });

            await syncOrReplaceJournalEntry(tx, {
              organizationId,
              actorUserId: request.user.userId,
              description: `Bill ${updatedBill.reference || updatedBill.id} from ${updatedBill.contact.name}`,
              referenceType: 'BILL',
              referenceId: updatedBill.id,
              postedAt: updatedBill.issueDate,
              lines: glLines,
            });
          }

          await recordAuditLog(tx, {
            organizationId,
            actorUserId: request.user.userId,
            action: 'BILL_UPDATED',
            entityType: 'BILL',
            entityId: updatedBill.id,
            summary: `Updated bill ${updatedBill.reference || updatedBill.id} ($${(Number(updatedBill.totalCents) / 100).toFixed(2)}, status: ${updatedBill.status})`,
          });

          return updatedBill;
        });

        return reply.send({ bill: serializeBill(updated) });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message || 'Failed to update bill.' });
      }
    },
  );

  // DELETE /api/v1/bills/:id — Delete DRAFT/PENDING_APPROVAL bill or ADMIN Force-Delete unpaid bill
  fastify.delete(
    '/api/v1/bills/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const isAdmin = request.user.role === Role.ADMIN;

      const bill = await fastify.prisma.bill.findFirst({ where: { id, organizationId } });
      if (!bill) return reply.status(404).send({ error: 'Bill not found' });

      if (bill.amountPaidCents > 0n) {
        return reply.status(400).send({
          error: 'Cannot delete a bill with recorded payments. Reverse the payments first.',
        });
      }

      if (bill.status !== BillStatus.DRAFT && bill.status !== BillStatus.PENDING_APPROVAL && !isAdmin) {
        return reply.status(400).send({
          error: 'Only DRAFT or PENDING_APPROVAL bills can be deleted (or use an ADMIN account to force-delete unpaid bills).',
        });
      }

      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, bill.issueDate);
      if (lockCheck.locked) {
        return reply.status(400).send({ error: lockCheck.message });
      }

      await fastify.prisma.$transaction(async (tx) => {
        // Clean up any linked BILL journal entries (and their reversals)
        const billJournals = await tx.journalEntry.findMany({
          where: { organizationId, referenceType: 'BILL', referenceId: bill.id },
          select: { id: true, reversedById: true },
        });
        const journalIds = billJournals.flatMap((j) =>
          j.reversedById ? [j.id, j.reversedById] : [j.id],
        );

        if (journalIds.length > 0) {
          await tx.journalEntry.updateMany({
            where: { organizationId, id: { in: journalIds } },
            data: { reversedById: null, reversesEntryId: null },
          });
          await tx.journalEntry.deleteMany({
            where: { organizationId, id: { in: journalIds } },
          });
        }

        await tx.billLineItem.deleteMany({ where: { billId: id } });
        await tx.bill.delete({ where: { id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BILL_DELETED',
          entityType: 'BILL',
          entityId: id,
          summary: `Deleted bill ${bill.reference || id} ($${(Number(bill.totalCents) / 100).toFixed(2)})`,
        });
      });

      return reply.send({ ok: true, message: 'Bill successfully deleted' });
    },
  );

  // POST /api/v1/bills/:id/approve — Approve DRAFT or PENDING_APPROVAL bill and post to GL
  fastify.post(
    '/api/v1/bills/:id/approve',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const bill = await fastify.prisma.bill.findFirst({
        where: { id, organizationId },
        include: { contact: true, lineItems: true },
      });

      if (!bill) return reply.status(404).send({ error: 'Bill not found' });
      if (bill.status !== BillStatus.DRAFT && bill.status !== BillStatus.PENDING_APPROVAL) {
        return reply.status(400).send({
          error: `Bill cannot be approved from ${bill.status} status.`,
        });
      }

      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, bill.issueDate);
      if (lockCheck.locked) {
        return reply.status(400).send({ error: lockCheck.message });
      }

      // Accounts
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['6000', '5000', '2200', '2000'] },
          isActive: true,
        },
      });

      const expenseAccount =
        accounts.find((a) => a.code === '6000') ??
        accounts.find((a) => a.code === '5000');
      const gstPaidAccount = accounts.find((a) => a.code === '2200');
      const apAccount = accounts.find((a) => a.code === '2000');

      if (!expenseAccount || !gstPaidAccount || !apAccount) {
        return reply.code(500).send({
          error: 'Required Chart of Accounts entries (2000, 2200, 6000) are missing.',
        });
      }

      const lines: Array<{
        accountId: string;
        description: string;
        entryType: EntryType;
        amountCents: bigint;
        trackingOptionId?: string | null;
      }> = [];

      for (const item of bill.lineItems) {
        if (item.amountCents > 0n) {
          lines.push({
            accountId: item.accountId || expenseAccount.id,
            description: `${bill.reference || bill.id}: ${item.description}`,
            entryType: EntryType.DEBIT,
            amountCents: item.amountCents,
            trackingOptionId: item.trackingOptionId,
          });
        }
      }

      if (bill.gstCents > 0n) {
        lines.push({
          accountId: gstPaidAccount.id,
          description: `GST Paid on Bill ${bill.reference || bill.id}`,
          entryType: EntryType.DEBIT,
          amountCents: bill.gstCents,
        });
      }

      lines.push({
        accountId: apAccount.id,
        description: `Bill ${bill.reference || bill.id} - ${bill.contact.name}`,
        entryType: EntryType.CREDIT,
        amountCents: bill.totalCents,
      });

      const updated = await fastify.prisma.$transaction(async (tx) => {
        if (bill.totalCents > 0n) {
          await syncOrReplaceJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: `Bill ${bill.reference || bill.id} from ${bill.contact.name}`,
            referenceType: 'BILL',
            referenceId: bill.id,
            postedAt: bill.issueDate,
            lines,
          });
        }

        const b = await tx.bill.update({
          where: { id },
          data: {
            status: BillStatus.AWAITING_PAYMENT,
            approvedByUserId: request.user.userId,
          },
          include: { contact: true, lineItems: true, paymentsOut: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BILL_APPROVED',
          entityType: 'BILL',
          entityId: b.id,
          summary: `Approved bill ${b.reference || b.id} from ${b.contact.name} ($${(Number(b.totalCents) / 100).toFixed(2)}) and posted to General Ledger`,
        });

        return b;
      });

      return reply.send({ bill: serializeBill(updated) });
    },
  );

  // POST /api/v1/bills/:id/revert-to-draft — Unapprove an unpaid bill back to DRAFT and reverse/remove GL entry
  fastify.post(
    '/api/v1/bills/:id/revert-to-draft',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const bill = await fastify.prisma.bill.findFirst({
        where: { id, organizationId },
        include: { contact: true },
      });

      if (!bill) return reply.status(404).send({ error: 'Bill not found' });
      if (bill.amountPaidCents > 0n) {
        return reply.status(400).send({
          error: 'Cannot revert a bill with recorded payments to draft. Reverse the payment first.',
        });
      }

      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, bill.issueDate);
      if (lockCheck.locked) {
        return reply.status(400).send({ error: lockCheck.message });
      }

      const originalJe = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'BILL',
          referenceId: bill.id,
          reversedById: null,
          status: JournalStatus.POSTED,
        },
      });

      const updatedBill = await fastify.prisma.$transaction(async (tx) => {
        if (originalJe) {
          await reverseJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            journalEntryId: originalJe.id,
            reversalDate: new Date(),
            reason: `Reverted bill ${bill.reference || bill.id} to DRAFT`,
            skipSubledgerCascade: true,
          });
        }

        const b = await tx.bill.update({
          where: { id },
          data: {
            status: BillStatus.DRAFT,
            approvedByUserId: null,
          },
          include: { contact: true, lineItems: true, paymentsOut: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BILL_REVERTED_TO_DRAFT',
          entityType: 'BILL',
          entityId: b.id,
          summary: `Reverted bill ${b.reference || b.id} to DRAFT and reversed General Ledger posting`,
        });

        return b;
      });

      return reply.send({ bill: serializeBill(updatedBill) });
    },
  );

  // POST /api/v1/bills/:id/void — Void unpaid bill and reverse GL entry
  fastify.post(
    '/api/v1/bills/:id/void',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const bill = await fastify.prisma.bill.findFirst({
        where: { id, organizationId },
        include: { contact: true },
      });

      if (!bill) return reply.status(404).send({ error: 'Bill not found' });
      if (bill.status === 'VOID') return reply.status(400).send({ error: 'Bill is already void' });
      if (bill.amountPaidCents > 0n) {
        return reply.status(400).send({ error: 'Cannot void a bill that has recorded payments. Reverse payments first.' });
      }

      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, new Date());
      if (lockCheck.locked) {
        return reply.status(400).send({ error: lockCheck.message });
      }

      // Find original Journal Entry
      const originalJe = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'BILL',
          referenceId: bill.id,
          reversedById: null,
          status: JournalStatus.POSTED,
        },
      });

      const updatedBill = await fastify.prisma.$transaction(async (tx) => {
        if (originalJe) {
          await reverseJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            journalEntryId: originalJe.id,
            reversalDate: new Date(),
            reason: `Reversal for voided bill ${bill.reference || bill.id}`,
            skipSubledgerCascade: true,
          });
        }

        const b = await tx.bill.update({
          where: { id },
          data: { status: BillStatus.VOID },
          include: { contact: true, lineItems: true, paymentsOut: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BILL_VOIDED',
          entityType: 'BILL',
          entityId: b.id,
          summary: `Voided bill ${b.reference || b.id} from ${bill.contact.name}`,
        });

        return b;
      });

      return reply.send({ bill: serializeBill(updatedBill) });
    },
  );

  // DELETE /api/v1/bills/:id/payments/:paymentId — Reverse a recorded payment out and restore bill balance
  fastify.delete<{ Params: { id: string; paymentId: string } }>(
    '/api/v1/bills/:id/payments/:paymentId',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id: billId, paymentId } = request.params;

      const paymentOut = await fastify.prisma.paymentOut.findFirst({
        where: { id: paymentId, billId, organizationId },
        include: { bill: true },
      });

      if (!paymentOut) {
        return reply.code(404).send({ error: 'Payment record not found for this bill.' });
      }

      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        paymentOut.paymentDate,
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const updatedBill = await fastify.prisma.$transaction(async (tx) => {
        const paymentJe = await tx.journalEntry.findFirst({
          where: {
            organizationId,
            referenceType: 'PAYMENT_OUT',
            referenceId: paymentOut.id,
            status: JournalStatus.POSTED,
            reversedById: null,
          },
        });

        if (paymentJe) {
          await reverseJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            journalEntryId: paymentJe.id,
            reversalDate: new Date(),
            reason: `Reversed payment on bill ${paymentOut.bill.reference || billId}`,
            skipSubledgerCascade: true,
          });
        }

        await tx.paymentOut.delete({ where: { id: paymentOut.id } });

        const currentPaid = paymentOut.bill.amountPaidCents;
        const newPaid = currentPaid > paymentOut.amountCents ? currentPaid - paymentOut.amountCents : 0n;
        const newStatus =
          newPaid === 0n ? BillStatus.AWAITING_PAYMENT : BillStatus.PARTIALLY_PAID;

        const b = await tx.bill.update({
          where: { id: billId },
          data: {
            amountPaidCents: newPaid,
            status: newStatus,
          },
          include: { contact: true, lineItems: true, paymentsOut: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'PAYMENT_OUT_REVERSED',
          entityType: 'BILL',
          entityId: billId,
          summary: `Reversed payment of $${(Number(paymentOut.amountCents) / 100).toFixed(2)} on bill ${b.reference || billId}`,
        });

        return b;
      });

      return reply.send({ bill: serializeBill(updatedBill) });
    },
  );

  // POST /api/v1/bills/:id/payments
  fastify.post(
    '/api/v1/bills/:id/payments',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST)],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid bill ID format' });
      }

      const bodyParse = RecordPaymentBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { id: billId } = paramParse.data;
      const { paymentDate, amountCents, paymentMethod, reference } = bodyParse.data;
      const organizationId = request.user.organizationId!;
      const parsedPaymentDate = new Date(paymentDate);

      await checkOrganizationLockDate(fastify.prisma, organizationId, parsedPaymentDate);

      const bill = await fastify.prisma.bill.findFirst({
        where: { id: billId, organizationId },
        include: { contact: true },
      });

      if (!bill) return reply.code(404).send({ error: 'Bill not found' });
      if (bill.status === BillStatus.PAID) return reply.code(400).send({ error: 'This bill has already been fully paid.' });
      if (bill.status === BillStatus.VOID || bill.status === BillStatus.DRAFT) {
        return reply.code(400).send({ error: `Cannot record payment against a ${bill.status} bill.` });
      }

      const remainingCents = bill.totalCents - bill.amountPaidCents;
      const amountBigInt = BigInt(amountCents);

      if (amountBigInt > remainingCents) {
        return reply.code(400).send({
          error: `Payment amount (${amountCents} cents) exceeds remaining balance (${Number(remainingCents)} cents).`,
        });
      }

      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['2000', '1000'] },
          isActive: true,
        },
      });

      const apAccount = accounts.find((a) => a.code === '2000');
      const bankAccount = accounts.find((a) => a.code === '1000');

      if (!apAccount || !bankAccount) {
        return reply.code(500).send({
          error: 'Required Chart of Accounts entries (1000 Operating Bank Account, 2000 Accounts Payable) are missing.',
        });
      }

      const result = await fastify.prisma.$transaction(async (tx) => {
        const newAmountPaid = bill.amountPaidCents + amountBigInt;
        const newStatus =
          newAmountPaid === bill.totalCents ? BillStatus.PAID : BillStatus.PARTIALLY_PAID;

        const paymentOut = await tx.paymentOut.create({
          data: {
            organizationId,
            billId: bill.id,
            paymentDate: parsedPaymentDate,
            amountCents: amountBigInt,
            bankAccountId: bankAccount.id,
            reference: reference ?? null,
          },
        });

        const updatedBill = await tx.bill.update({
          where: { id: bill.id },
          data: {
            amountPaidCents: newAmountPaid,
            status: newStatus,
          },
          include: {
            contact: true,
            lineItems: true,
            paymentsOut: true,
          },
        });

        const journalEntry = await postJournalEntry(tx, {
          organizationId,
          actorUserId: request.user.userId,
          description: `Payment for bill ${bill.reference || bill.id} from ${bill.contact.name}${reference ? ` (${reference})` : ''}`,
          referenceType: 'PAYMENT_OUT',
          referenceId: paymentOut.id,
          postedAt: parsedPaymentDate,
          lines: [
            {
              accountId: apAccount.id,
              description: `AP Settlement: Bill ${bill.reference || bill.id}`,
              entryType: EntryType.DEBIT,
              amountCents: amountBigInt,
            },
            {
              accountId: bankAccount.id,
              description: `Cash Outflow: Bill ${bill.reference || bill.id}`,
              entryType: EntryType.CREDIT,
              amountCents: amountBigInt,
            },
          ],
        });

        return { paymentOut, bill: updatedBill, journalEntry };
      });

      return reply.code(201).send({
        paymentOut: serializeBill(result.paymentOut),
        bill: serializeBill(result.bill),
        journalEntry: serializeBill(result.journalEntry),
      });
    },
  );

  // GET /api/v1/bills/:id/payments
  fastify.get(
    '/api/v1/bills/:id/payments',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AP_SPECIALIST, Role.AUDITOR)],
    },
    async (request, reply) => {
      const { id: billId } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const payments = await fastify.prisma.paymentOut.findMany({
        where: { billId, organizationId },
        orderBy: { paymentDate: 'desc' },
      });

      return reply.code(200).send({ payments: serializeBill(payments) });
    },
  );

  // POST /api/v1/payments-out
  fastify.post(
    '/api/v1/payments-out',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST)],
    },
    async (request, reply) => {
      const bodyParse = CreatePaymentOutBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { billId, paymentDate, amountCents, paymentMethod, reference } = bodyParse.data;
      const organizationId = request.user.organizationId!;
      const parsedPaymentDate = new Date(paymentDate);

      await checkOrganizationLockDate(fastify.prisma, organizationId, parsedPaymentDate);

      const bill = await fastify.prisma.bill.findFirst({
        where: { id: billId, organizationId },
        include: { contact: true },
      });

      if (!bill) return reply.code(404).send({ error: 'Bill not found' });
      if (bill.status === BillStatus.PAID) return reply.code(400).send({ error: 'This bill has already been fully paid.' });
      if (bill.status === BillStatus.VOID || bill.status === BillStatus.DRAFT) {
        return reply.code(400).send({ error: `Cannot record payment against a ${bill.status} bill.` });
      }

      const remainingCents = bill.totalCents - bill.amountPaidCents;
      const amountBigInt = BigInt(amountCents);

      if (amountBigInt > remainingCents) {
        return reply.code(400).send({
          error: `Payment amount (${amountCents} cents) exceeds remaining balance (${Number(remainingCents)} cents).`,
        });
      }

      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['2000', '1000'] },
          isActive: true,
        },
      });

      const apAccount = accounts.find((a) => a.code === '2000');
      const bankAccount = accounts.find((a) => a.code === '1000');

      if (!apAccount || !bankAccount) {
        return reply.code(500).send({
          error: 'Required Chart of Accounts entries (1000 Operating Bank Account, 2000 Accounts Payable) are missing.',
        });
      }

      const result = await fastify.prisma.$transaction(async (tx) => {
        const newAmountPaid = bill.amountPaidCents + amountBigInt;
        const newStatus =
          newAmountPaid === bill.totalCents ? BillStatus.PAID : BillStatus.PARTIALLY_PAID;

        const paymentOut = await tx.paymentOut.create({
          data: {
            organizationId,
            billId: bill.id,
            paymentDate: parsedPaymentDate,
            amountCents: amountBigInt,
            bankAccountId: bankAccount.id,
            reference: reference ?? null,
          },
        });

        const updatedBill = await tx.bill.update({
          where: { id: bill.id },
          data: {
            amountPaidCents: newAmountPaid,
            status: newStatus,
          },
          include: {
            contact: true,
            lineItems: true,
            paymentsOut: true,
          },
        });

        const journalEntry = await postJournalEntry(tx, {
          organizationId,
          actorUserId: request.user.userId,
          description: `Payment for bill ${bill.reference || bill.id} from ${bill.contact.name}${reference ? ` (${reference})` : ''}`,
          referenceType: 'PAYMENT_OUT',
          referenceId: paymentOut.id,
          postedAt: parsedPaymentDate,
          lines: [
            {
              accountId: apAccount.id,
              description: `AP Settlement: Bill ${bill.reference || bill.id}`,
              entryType: EntryType.DEBIT,
              amountCents: amountBigInt,
            },
            {
              accountId: bankAccount.id,
              description: `Cash Outflow: Bill ${bill.reference || bill.id}`,
              entryType: EntryType.CREDIT,
              amountCents: amountBigInt,
            },
          ],
        });

        return { paymentOut, bill: updatedBill, journalEntry };
      });

      return reply.code(201).send({
        paymentOut: serializeBill(result.paymentOut),
        bill: serializeBill(result.bill),
        journalEntry: serializeBill(result.journalEntry),
      });
    },
  );

  // -------------------------------------------------------------------------
  // Recurring Bills Endpoints
  // -------------------------------------------------------------------------

  // GET /api/v1/recurring-bills
  fastify.get(
    '/api/v1/recurring-bills',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AP_SPECIALIST)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      const schedules = await fastify.prisma.recurringSchedule.findMany({
        where: { organizationId, scheduleType: 'BILL' },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({ recurringBills: schedules });
    },
  );

  // POST /api/v1/recurring-bills
  fastify.post(
    '/api/v1/recurring-bills',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parse = RecurringBillBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parse.error.issues });
      }

      const { name, contactId, frequency, startDate, endDate, notes, lineItems } = parse.data;

      const schedule = await fastify.prisma.recurringSchedule.create({
        data: {
          organizationId,
          scheduleType: 'BILL',
          name,
          frequency,
          startDate: new Date(startDate),
          nextRunDate: new Date(startDate),
          templatePayloadJson: JSON.stringify({ contactId, notes, lineItems, endDate }),
          isActive: true,
          createdByUserId: request.user.userId,
        },
      });

      return reply.code(201).send({ recurringBill: schedule });
    },
  );

  // PATCH /api/v1/recurring-bills/:id
  fastify.patch(
    '/api/v1/recurring-bills/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const existing = await fastify.prisma.recurringSchedule.findFirst({
        where: { id, organizationId, scheduleType: 'BILL' },
      });
      if (!existing) return reply.status(404).send({ error: 'Recurring bill schedule not found' });

      const body = request.body as any;
      const updated = await fastify.prisma.recurringSchedule.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          frequency: body.frequency ?? existing.frequency,
          isActive: body.isActive !== undefined ? body.isActive : existing.isActive,
          nextRunDate: body.nextRunDate ? new Date(body.nextRunDate) : existing.nextRunDate,
          templatePayloadJson:
            body.templatePayload || body.templateData
              ? JSON.stringify(body.templatePayload || body.templateData)
              : existing.templatePayloadJson,
        },
      });

      return reply.send({ recurringBill: updated });
    },
  );

  // DELETE /api/v1/recurring-bills/:id
  fastify.delete(
    '/api/v1/recurring-bills/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      await fastify.prisma.recurringSchedule.deleteMany({
        where: { id, organizationId, scheduleType: 'BILL' },
      });

      return reply.send({ message: 'Recurring bill schedule deleted' });
    },
  );

  // POST /api/v1/recurring-bills/:id/run (Manually spawn bill from schedule)
  fastify.post(
    '/api/v1/recurring-bills/:id/run',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const schedule = await fastify.prisma.recurringSchedule.findFirst({
        where: { id, organizationId, scheduleType: 'BILL' },
      });

      if (!schedule) return reply.status(404).send({ error: 'Recurring bill schedule not found' });

      let template: { contactId: string; notes?: string; lineItems: any[] };
      try {
        template = JSON.parse(schedule.templatePayloadJson);
      } catch {
        return reply.status(500).send({ error: 'Corrupt template payload JSON in recurring schedule' });
      }

      const issueDate = new Date();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);

      // Calculate totals
      const processedLines = (template.lineItems || []).map((item) => {
        const rawAmount = item.amountCents
          ? BigInt(item.amountCents)
          : BigInt(Math.round(item.quantity * (item.unitPriceCents ?? 0)));
        const gstResult = calculateGST(rawAmount, item.taxTreatment || TaxTreatment.TAX_EXCLUSIVE);
        return {
          organizationId,
          itemId: item.itemId,
          description: item.description,
          taxTreatment: item.taxTreatment || TaxTreatment.TAX_EXCLUSIVE,
          amountCents: gstResult.subtotalCents,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
        };
      });

      const totals = sumGSTResults(
        processedLines.map((li) => ({
          subtotalCents: li.amountCents,
          gstCents: li.gstCents,
          totalCents: li.totalCents,
        })),
      );

      const bill = await fastify.prisma.bill.create({
        data: {
          organizationId,
          contactId: template.contactId,
          reference: `Recurring: ${schedule.name}`,
          issueDate,
          dueDate,
          status: BillStatus.DRAFT,
          subtotalCents: totals.subtotalCents,
          gstCents: totals.gstCents,
          totalCents: totals.totalCents,
          amountPaidCents: 0n,
          notes: template.notes,
          lineItems: {
            create: processedLines,
          },
        },
        include: { contact: true, lineItems: true },
      });

      // Calculate next run date
      const nextDate = new Date(schedule.nextRunDate);
      if (schedule.frequency === 'WEEKLY') nextDate.setDate(nextDate.getDate() + 7);
      else if (schedule.frequency === 'FORTNIGHTLY') nextDate.setDate(nextDate.getDate() + 14);
      else if (schedule.frequency === 'MONTHLY') nextDate.setMonth(nextDate.getMonth() + 1);
      else if (schedule.frequency === 'QUARTERLY') nextDate.setMonth(nextDate.getMonth() + 3);
      else if (schedule.frequency === 'ANNUALLY') nextDate.setFullYear(nextDate.getFullYear() + 1);

      await fastify.prisma.recurringSchedule.update({
        where: { id: schedule.id },
        data: { nextRunDate: nextDate, lastRunDate: new Date() },
      });

      return reply.send({
        message: 'Successfully generated bill from recurring schedule',
        bill: serializeBill(bill),
      });
    },
  );
};

export default billRoutes;
