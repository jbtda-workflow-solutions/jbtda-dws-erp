/**
 * General Ledger routes — Phase 8 General Ledger Audit Trail & Trial Balance
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET /api/v1/ledger          (Paginated, filterable list of double-entry journal entries and lines)
 *  - GET /api/v1/ledger/accounts (Chart of Accounts with aggregated debit/credit totals and net balance)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireOrgAuth, requireRole } from '../plugins/auth.js';
import { recordAuditLog } from '../lib/audit.js';
import { EntryType, NormalBalance, Role } from '@prisma/client';

const ListLedgerQuery = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountId: z.string().uuid().optional(),
  referenceType: z.enum(['BILL', 'PAYMENT_OUT', 'INVOICE', 'PAYMENT_IN', 'MANUAL']).optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ManualJournalLineInput = z.object({
  accountId: z.string().uuid(),
  entryType: z.enum(['DEBIT', 'CREDIT']),
  amountCents: z.number().int().positive(),
});

const CreateManualJournalEntryBody = z.object({
  description: z.string().trim().min(1).max(500),
  postedAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  lines: z.array(ManualJournalLineInput).min(2),
});

/**
 * Helper to serialize BigInt fields to numbers in JSON responses
 */
function serializeLedger<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

const ledgerRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/ledger — List double-entry journal entries with lines
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/ledger',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AUDITOR),
      ],
    },
    async (request, reply) => {
      const parse = ListLedgerQuery.safeParse(request.query);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { startDate, endDate, accountId, referenceType, search, limit, offset } = parse.data;
      const organizationId = request.user.organizationId!;

      const whereClause: any = {
        organizationId,
      };

      if (startDate || endDate) {
        whereClause.postedAt = {};
        if (startDate) {
          whereClause.postedAt.gte = new Date(`${startDate}T00:00:00.000Z`);
        }
        if (endDate) {
          whereClause.postedAt.lte = new Date(`${endDate}T23:59:59.999Z`);
        }
      }

      if (referenceType) {
        whereClause.referenceType = referenceType;
      }

      if (search && search.length > 0) {
        whereClause.OR = [
          { description: { contains: search, mode: 'insensitive' } },
          { referenceType: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (accountId) {
        whereClause.lines = {
          some: { accountId },
        };
      }

      const [entries, totalCount] = await Promise.all([
        fastify.prisma.journalEntry.findMany({
          where: whereClause,
          include: {
            lines: {
              include: {
                account: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    type: true,
                    normalBalance: true,
                  },
                },
              },
              orderBy: [
                { entryType: 'asc' }, // DEBIT first, then CREDIT
                { amountCents: 'desc' },
              ],
            },
          },
          orderBy: { postedAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        fastify.prisma.journalEntry.count({
          where: whereClause,
        }),
      ]);

      // Calculate global debit and credit aggregates across all journal lines for the org
      const allLines = await fastify.prisma.journalLine.findMany({
        where: { organizationId },
        select: { entryType: true, amountCents: true },
      });

      let totalDebitsCents = 0n;
      let totalCreditsCents = 0n;

      for (const line of allLines) {
        if (line.entryType === EntryType.DEBIT) {
          totalDebitsCents += line.amountCents;
        } else {
          totalCreditsCents += line.amountCents;
        }
      }

      return reply.code(200).send({
        entries: serializeLedger(entries),
        totalCount,
        totals: {
          totalDebitsCents: Number(totalDebitsCents),
          totalCreditsCents: Number(totalCreditsCents),
          isBalanced: totalDebitsCents === totalCreditsCents,
        },
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/ledger/accounts — Chart of Accounts with debit/credit totals
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/ledger/accounts',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      const accounts = await fastify.prisma.account.findMany({
        where: { organizationId },
        orderBy: { code: 'asc' },
        include: {
          journalLines: {
            select: {
              entryType: true,
              amountCents: true,
            },
          },
        },
      });

      const accountsWithBalances = accounts.map((acc) => {
        let debitsCents = 0n;
        let creditsCents = 0n;

        for (const line of acc.journalLines) {
          if (line.entryType === EntryType.DEBIT) {
            debitsCents += line.amountCents;
          } else {
            creditsCents += line.amountCents;
          }
        }

        // Net balance based on normal balance convention
        let netBalanceCents = 0n;
        if (acc.normalBalance === NormalBalance.DEBIT) {
          netBalanceCents = debitsCents - creditsCents;
        } else {
          netBalanceCents = creditsCents - debitsCents;
        }

        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          normalBalance: acc.normalBalance,
          description: acc.description,
          isSystem: acc.isSystem,
          systemKey: acc.systemKey,
          parentId: acc.parentId,
          isBankAccount: acc.isBankAccount,
          defaultTaxTreatment: acc.defaultTaxTreatment,
          isActive: acc.isActive,
          debitsCents: Number(debitsCents),
          creditsCents: Number(creditsCents),
          netBalanceCents: Number(netBalanceCents),
          lineCount: acc.journalLines.length,
        };
      });

      return reply.code(200).send({
        accounts: accountsWithBalances,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/ledger/entries — Record manual double-entry journal entry
  // Invariant: sum(DEBIT lines) == sum(CREDIT lines)
  // Allowed roles: ADMIN, ACCOUNTANT
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/ledger/entries',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const bodyParse = CreateManualJournalEntryBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { description, postedAt, lines } = bodyParse.data;
      const organizationId = request.user.organizationId!;

      // 1. Verify all referenced accounts belong to this organization and are active
      const accountIds = Array.from(new Set(lines.map((l) => l.accountId)));
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          id: { in: accountIds },
          isActive: true,
        },
      });

      if (accounts.length !== accountIds.length) {
        return reply.code(400).send({
          error: 'One or more selected accounts are invalid or inactive for this organization.',
        });
      }

      // 2. Validate double-entry balance: sum(DEBIT) == sum(CREDIT)
      let sumDebitsCents = 0n;
      let sumCreditsCents = 0n;

      for (const line of lines) {
        const lineAmount = BigInt(line.amountCents);
        if (line.entryType === 'DEBIT') {
          sumDebitsCents += lineAmount;
        } else {
          sumCreditsCents += lineAmount;
        }
      }

      if (sumDebitsCents !== sumCreditsCents) {
        return reply.code(400).send({
          error: `General Ledger imbalance: Total Debits (${Number(sumDebitsCents)} cents) must equal Total Credits (${Number(sumCreditsCents)} cents).`,
        });
      }

      // 3. Atomically create JournalEntry and JournalLines
      const journalEntry = await fastify.prisma.journalEntry.create({
        data: {
          organizationId,
          description,
          referenceType: 'MANUAL',
          referenceId: randomUUID(),
          postedAt: new Date(postedAt),
          lines: {
            create: lines.map((l) => ({
              organizationId,
              accountId: l.accountId,
              entryType: l.entryType === 'DEBIT' ? EntryType.DEBIT : EntryType.CREDIT,
              amountCents: BigInt(l.amountCents),
            })),
          },
        },
        include: {
          lines: {
            include: {
              account: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  type: true,
                  normalBalance: true,
                },
              },
            },
            orderBy: [
              { entryType: 'asc' },
              { amountCents: 'desc' },
            ],
          },
        },
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'MANUAL_JOURNAL_POSTED',
        entityType: 'JOURNAL_ENTRY',
        entityId: journalEntry.id,
        summary: `Posted manual adjusting journal "${description}" ($${(Number(sumDebitsCents) / 100).toFixed(2)})`,
      });

      return reply.code(201).send({
        entry: serializeLedger(journalEntry),
      });
    },
  );
};

export default ledgerRoutes;

