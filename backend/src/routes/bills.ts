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
import { checkOrganizationLockDate, postJournalEntry, reverseJournalEntry } from '../lib/ledger-posting.js';
import { BillStatus, EntryType, Role, TaxTreatment } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const BillStatusEnum = z.nativeEnum(BillStatus);

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
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
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

      if (autoApprove) {
        await checkOrganizationLockDate(fastify.prisma, organizationId, parsedIssueDate);
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
        const rawAmount = item.amountCents
          ? BigInt(item.amountCents)
          : BigInt(Math.round(item.quantity * (item.unitPriceCents ?? 0)));
        const gstResult = calculateGST(rawAmount, item.taxTreatment);
        return {
          itemId: item.itemId,
          description: item.description,
          taxTreatment: item.taxTreatment,
          amountCents: gstResult.subtotalCents,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
          accountId: item.accountId || expenseAccount.id,
          trackingOptionId: item.trackingOptionId,
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
            lineItems: {
              create: processedLineItems.map((li) => ({
                organizationId,
                itemId: li.itemId,
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
          const journalLinesData: Array<{
            accountId: string;
            description: string;
            debitCents: bigint;
            creditCents: bigint;
            trackingOptionId?: string;
          }> = [];

          // Group debits by account & tracking option
          for (const item of processedLineItems) {
            if (item.amountCents > 0n) {
              journalLinesData.push({
                accountId: item.accountId,
                description: `${bill.reference || bill.id}: ${item.description}`,
                debitCents: item.amountCents,
                creditCents: 0n,
                trackingOptionId: item.trackingOptionId,
              });
            }
          }

          if (totalResult.gstCents > 0n) {
            journalLinesData.push({
              accountId: gstPaidAccount.id,
              description: `GST Paid on Bill ${bill.reference || bill.id}`,
              debitCents: totalResult.gstCents,
              creditCents: 0n,
            });
          }

          journalLinesData.push({
            accountId: apAccount.id,
            description: `Bill ${bill.reference || bill.id} - ${contact.name}`,
            debitCents: 0n,
            creditCents: totalResult.totalCents,
          });

          const count = await tx.journalEntry.count({ where: { organizationId } });
          const entryNumber = `JE-BILL-${String(count + 1).padStart(5, '0')}`;

          await postJournalEntry(tx, {
            organizationId,
            entryNumber,
            date: parsedIssueDate,
            memo: `Bill ${bill.reference || bill.id} from ${contact.name}${reference ? ` (${reference})` : ''}`,
            source: 'BILL',
            sourceId: bill.id,
            lines: journalLinesData,
            userId: request.user.userId,
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
          purchaseOrder: true,
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

  // PATCH /api/v1/bills/:id
  fastify.patch(
    '/api/v1/bills/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const bill = await fastify.prisma.bill.findFirst({ where: { id, organizationId } });

      if (!bill) {
        return reply.status(404).send({ error: 'Bill not found' });
      }

      if (bill.status !== 'DRAFT') {
        return reply.status(400).send({ error: `Cannot edit bill with status ${bill.status}` });
      }

      const parse = UpdateBillBody.safeParse(request.body);
      if (!parse.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parse.error.issues });
      }

      const { contactId, billNumber, reference, issueDate, dueDate, notes, lineItems } = parse.data;

      const updated = await fastify.prisma.$transaction(async (tx) => {
        let subtotalCents = bill.subtotalCents;
        let gstCents = bill.gstCents;
        let totalCents = bill.totalCents;

        if (lineItems && lineItems.length > 0) {
          await tx.billLineItem.deleteMany({ where: { billId: id } });

          const processedLines = lineItems.map((item) => {
            const rawAmount = item.amountCents
              ? BigInt(item.amountCents)
              : BigInt(Math.round(item.quantity * (item.unitPriceCents ?? 0)));
            const gstResult = calculateGST(rawAmount, item.taxTreatment);
            return {
              organizationId,
              itemId: item.itemId,
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

        return tx.bill.update({
          where: { id },
          data: {
            contactId: contactId ?? bill.contactId,
            reference: reference !== undefined ? reference : (billNumber ?? bill.reference),
            issueDate: issueDate ? new Date(issueDate) : bill.issueDate,
            dueDate: dueDate ? new Date(dueDate) : bill.dueDate,
            notes: notes !== undefined ? notes : bill.notes,
            subtotalCents,
            gstCents,
            totalCents,
          },
          include: { contact: true, lineItems: true },
        });
      });

      return reply.send({ bill: serializeBill(updated) });
    },
  );

  // DELETE /api/v1/bills/:id
  fastify.delete(
    '/api/v1/bills/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const bill = await fastify.prisma.bill.findFirst({ where: { id, organizationId } });
      if (!bill) return reply.status(404).send({ error: 'Bill not found' });
      if (bill.status !== 'DRAFT') return reply.status(400).send({ error: 'Only DRAFT bills can be deleted' });

      await fastify.prisma.$transaction(async (tx) => {
        await tx.billLineItem.deleteMany({ where: { billId: id } });
        await tx.bill.delete({ where: { id } });
      });

      return reply.send({ message: 'Bill successfully deleted' });
    },
  );

  // POST /api/v1/bills/:id/approve
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
      if (bill.status !== 'DRAFT') {
        return reply.status(400).send({ error: `Bill is not in DRAFT status (current: ${bill.status})` });
      }

      await checkOrganizationLockDate(fastify.prisma, organizationId, bill.issueDate);

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

      const journalLinesData: Array<{
        accountId: string;
        description: string;
        debitCents: bigint;
        creditCents: bigint;
      }> = [];

      for (const item of bill.lineItems) {
        if (item.amountCents > 0n) {
          journalLinesData.push({
            accountId: expenseAccount.id,
            description: `${bill.reference || bill.id}: ${item.description}`,
            debitCents: item.amountCents,
            creditCents: 0n,
          });
        }
      }

      if (bill.gstCents > 0n) {
        journalLinesData.push({
          accountId: gstPaidAccount.id,
          description: `GST Paid on Bill ${bill.reference || bill.id}`,
          debitCents: bill.gstCents,
          creditCents: 0n,
        });
      }

      journalLinesData.push({
        accountId: apAccount.id,
        description: `Bill ${bill.reference || bill.id} - ${bill.contact.name}`,
        debitCents: 0n,
        creditCents: bill.totalCents,
      });

      const count = await fastify.prisma.journalEntry.count({ where: { organizationId } });
      const entryNumber = `JE-BILL-${String(count + 1).padStart(5, '0')}`;

      const updated = await fastify.prisma.$transaction(async (tx) => {
        await postJournalEntry(tx, {
          organizationId,
          entryNumber,
          date: bill.issueDate,
          memo: `Bill ${bill.reference || bill.id} from ${bill.contact.name}`,
          source: 'BILL',
          sourceId: bill.id,
          lines: journalLinesData,
          userId: request.user.userId,
        });

        return tx.bill.update({
          where: { id },
          data: { status: BillStatus.AWAITING_PAYMENT },
          include: { contact: true, lineItems: true },
        });
      });

      return reply.send({ bill: serializeBill(updated) });
    },
  );

  // POST /api/v1/bills/:id/void
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

      await checkOrganizationLockDate(fastify.prisma, organizationId, new Date());

      // Find original Journal Entry
      const originalJe = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'BILL',
          referenceId: bill.id,
          isReversed: false,
        },
      });

      const updatedBill = await fastify.prisma.$transaction(async (tx) => {
        if (originalJe) {
          await reverseJournalEntry(
            tx,
            originalJe.id,
            `Reversal for voided bill ${bill.reference || bill.id}`,
            request.user.userId,
          );
        }

        return tx.bill.update({
          where: { id },
          data: { status: BillStatus.VOID },
          include: { contact: true, lineItems: true },
        });
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
            contactId: bill.contactId,
            billId: bill.id,
            paymentDate: parsedPaymentDate,
            amountCents: amountBigInt,
            paymentMethod,
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

        const count = await tx.journalEntry.count({ where: { organizationId } });
        const entryNumber = `JE-PMTOUT-${String(count + 1).padStart(5, '0')}`;

        const journalEntry = await postJournalEntry(tx, {
          organizationId,
          entryNumber,
          date: parsedPaymentDate,
          memo: `Payment for bill ${bill.reference || bill.id} from ${bill.contact.name}${reference ? ` (${reference})` : ''}`,
          source: 'PAYMENT_OUT',
          sourceId: paymentOut.id,
          lines: [
            {
              accountId: apAccount.id,
              description: `AP Settlement: Bill ${bill.reference || bill.id}`,
              debitCents: amountBigInt,
              creditCents: 0n,
            },
            {
              accountId: bankAccount.id,
              description: `Cash Outflow: Bill ${bill.reference || bill.id}`,
              debitCents: 0n,
              creditCents: amountBigInt,
            },
          ],
          userId: request.user.userId,
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
            contactId: bill.contactId,
            billId: bill.id,
            paymentDate: parsedPaymentDate,
            amountCents: amountBigInt,
            paymentMethod,
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

        const count = await tx.journalEntry.count({ where: { organizationId } });
        const entryNumber = `JE-PMTOUT-${String(count + 1).padStart(5, '0')}`;

        const journalEntry = await postJournalEntry(tx, {
          organizationId,
          entryNumber,
          date: parsedPaymentDate,
          memo: `Payment for bill ${bill.reference || bill.id} from ${bill.contact.name}${reference ? ` (${reference})` : ''}`,
          source: 'PAYMENT_OUT',
          sourceId: paymentOut.id,
          lines: [
            {
              accountId: apAccount.id,
              description: `AP Settlement: Bill ${bill.reference || bill.id}`,
              debitCents: amountBigInt,
              creditCents: 0n,
            },
            {
              accountId: bankAccount.id,
              description: `Cash Outflow: Bill ${bill.reference || bill.id}`,
              debitCents: 0n,
              creditCents: amountBigInt,
            },
          ],
          userId: request.user.userId,
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
        include: {
          contact: { select: { id: true, name: true, email: true } },
        },
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
          contactId,
          frequency,
          startDate: new Date(startDate),
          nextRunDate: new Date(startDate),
          endDate: endDate ? new Date(endDate) : null,
          templateData: { notes, lineItems },
          isActive: true,
        },
        include: { contact: true },
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
          endDate: body.endDate ? new Date(body.endDate) : existing.endDate,
          templateData: body.templateData ?? existing.templateData,
        },
        include: { contact: true },
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
        include: { contact: true },
      });

      if (!schedule) return reply.status(404).send({ error: 'Recurring bill schedule not found' });

      const template = schedule.templateData as { notes?: string; lineItems: any[] };
      const issueDate = new Date();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);

      // Calculate totals
      const processedLines = template.lineItems.map((item) => {
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
          contactId: schedule.contactId,
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
      else if (schedule.frequency === 'MONTHLY') nextDate.setMonth(nextDate.getMonth() + 1);
      else if (schedule.frequency === 'QUARTERLY') nextDate.setMonth(nextDate.getMonth() + 3);
      else if (schedule.frequency === 'YEARLY') nextDate.setFullYear(nextDate.getFullYear() + 1);

      await fastify.prisma.recurringSchedule.update({
        where: { id: schedule.id },
        data: { nextRunDate: nextDate },
      });

      return reply.send({
        message: 'Successfully generated bill from recurring schedule',
        bill: serializeBill(bill),
      });
    },
  );
};

export default billRoutes;
