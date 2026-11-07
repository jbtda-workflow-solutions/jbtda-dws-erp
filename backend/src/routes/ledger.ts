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
import { requireOrgAuth } from '../plugins/auth.js';
import { EntryType, NormalBalance } from '@prisma/client';

const ListLedgerQuery = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountId: z.string().uuid().optional(),
  referenceType: z.enum(['BILL', 'PAYMENT_OUT', 'INVOICE', 'PAYMENT_IN', 'MANUAL']).optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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
    { preHandler: [requireOrgAuth] },
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
};

export default ledgerRoutes;

