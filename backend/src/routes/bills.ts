/**
 * Bills routes — Phase 4 Accounts Payable (AP)
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET  /api/v1/bills       (List bills with contact, status, search filters)
 *  - POST /api/v1/bills       (Create bill with line items & atomic ledger posting)
 *  - GET  /api/v1/bills/:id   (Get bill details with line items and journal entries)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireOrgAuth, requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { BillStatus, EntryType, Role, TaxTreatment } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const BillStatusEnum = z.nativeEnum(BillStatus);

const LineItemInput = z.object({
  description: z.string().trim().min(1).max(255),
  amountCents: z.number().int().positive(), // raw entered amount in integer cents
  taxTreatment: TaxTreatmentEnum,
});

const CreateBillBody = z.object({
  contactId: z.string().uuid(),
  reference: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().trim().max(1000).nullable().optional(),
  lineItems: z.array(LineItemInput).min(1),
});

const ListBillsQuery = z.object({
  status: BillStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

/**
 * Helper to serialize BigInt fields to numbers/strings in JSON response
 */
function serializeBill<T extends Record<string, any>>(bill: T): any {
  return JSON.parse(
    JSON.stringify(bill, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

const billRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/bills — List organization bills
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/bills',
    { preHandler: [requireOrgAuth] },
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

      const whereClause: any = {
        organizationId,
      };

      if (status) {
        whereClause.status = status;
      }

      if (contactId) {
        whereClause.contactId = contactId;
      }

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
            },
          },
          lineItems: true,
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      });

      return reply.code(200).send({ bills: serializeBill(bills) });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/bills — Create a bill with line items & atomic GL posting
  // Allowed roles: ADMIN, ACCOUNTANT, AP_SPECIALIST
  // -------------------------------------------------------------------------
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

      const { contactId, reference, issueDate, dueDate, notes, lineItems } =
        parse.data;
      const organizationId = request.user.organizationId!;

      // 1. Verify contact exists and belongs to this organization
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

      // 2. Fetch Chart of Accounts entries required for AP posting
      // Code 5000: Operating Expenses (EXPENSE - Normal Balance DEBIT)
      // Code 2200: GST Paid (Purchases) (ASSET - Normal Balance DEBIT)
      // Code 2000: Accounts Payable (LIABILITY - Normal Balance CREDIT)
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['5000', '2200', '2000'] },
          isActive: true,
        },
      });

      const expenseAccount = accounts.find((a) => a.code === '5000');
      const gstPaidAccount = accounts.find((a) => a.code === '2200');
      const apAccount = accounts.find((a) => a.code === '2000');

      if (!expenseAccount || !gstPaidAccount || !apAccount) {
        return reply.code(500).send({
          error:
            'Required Chart of Accounts entries (2000, 2200, 5000) are missing for this organization.',
        });
      }

      // 3. Compute GST and aggregate totals using integer arithmetic
      const processedLineItems = lineItems.map((item) => {
        const gstResult = calculateGST(
          BigInt(item.amountCents),
          item.taxTreatment,
        );
        return {
          description: item.description,
          taxTreatment: item.taxTreatment,
          amountCents: gstResult.subtotalCents,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
        };
      });

      const totalResult = sumGSTResults(
        processedLineItems.map((item) => ({
          subtotalCents: item.amountCents,
          gstCents: item.gstCents,
          totalCents: item.totalCents,
        })),
      );

      const parsedIssueDate = new Date(issueDate);
      const parsedDueDate = new Date(dueDate);

      // 4. Atomic Transaction: Bill + LineItems + JournalEntry + JournalLines
      const createdBill = await fastify.prisma.$transaction(
        async (tx) => {
          // A. Create Bill
          const bill = await tx.bill.create({
            data: {
              organizationId,
              contactId,
              reference: reference ?? null,
              issueDate: parsedIssueDate,
              dueDate: parsedDueDate,
              status: BillStatus.AWAITING_PAYMENT,
              subtotalCents: totalResult.subtotalCents,
              gstCents: totalResult.gstCents,
              totalCents: totalResult.totalCents,
              amountPaidCents: 0n,
              notes: notes ?? null,
              lineItems: {
                create: processedLineItems.map((li) => ({
                  organizationId,
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

          // B. Construct Double-Entry Journal Lines
          // - DEBIT Operating Expenses (5000) for subtotalCents
          // - DEBIT GST Paid (2200) for gstCents (if gstCents > 0)
          // - CREDIT Accounts Payable (2000) for totalCents
          const journalLinesData: Array<{
            organizationId: string;
            accountId: string;
            entryType: EntryType;
            amountCents: bigint;
          }> = [];

          if (totalResult.subtotalCents > 0n) {
            journalLinesData.push({
              organizationId,
              accountId: expenseAccount.id,
              entryType: EntryType.DEBIT,
              amountCents: totalResult.subtotalCents,
            });
          }

          if (totalResult.gstCents > 0n) {
            journalLinesData.push({
              organizationId,
              accountId: gstPaidAccount.id,
              entryType: EntryType.DEBIT,
              amountCents: totalResult.gstCents,
            });
          }

          if (totalResult.totalCents > 0n) {
            journalLinesData.push({
              organizationId,
              accountId: apAccount.id,
              entryType: EntryType.CREDIT,
              amountCents: totalResult.totalCents,
            });
          }

          // Double-Entry Invariant Verification: sum(DEBITS) == sum(CREDITS)
          const debitSum = journalLinesData
            .filter((l) => l.entryType === EntryType.DEBIT)
            .reduce((sum, l) => sum + l.amountCents, 0n);

          const creditSum = journalLinesData
            .filter((l) => l.entryType === EntryType.CREDIT)
            .reduce((sum, l) => sum + l.amountCents, 0n);

          if (debitSum !== creditSum) {
            throw new Error(
              `General Ledger imbalance: Debits (${debitSum}) != Credits (${creditSum})`,
            );
          }

          // C. Create Journal Entry
          if (journalLinesData.length > 0) {
            await tx.journalEntry.create({
              data: {
                organizationId,
                description: `Bill from ${contact.name}${reference ? ` (${reference})` : ''}`,
                referenceType: 'BILL',
                referenceId: bill.id,
                postedAt: parsedIssueDate,
                lines: {
                  create: journalLinesData,
                },
              },
            });
          }

          return bill;
        },
      );

      return reply.code(201).send({ bill: serializeBill(createdBill) });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/bills/:id — Get single bill details
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/bills/:id',
    { preHandler: [requireOrgAuth] },
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

      // Find associated GL entry
      const journalEntry = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'BILL',
          referenceId: bill.id,
        },
        include: {
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      return reply.code(200).send({
        bill: serializeBill(bill),
        journalEntry: journalEntry ? serializeBill(journalEntry) : null,
      });
    },
  );
};

export default billRoutes;

