/**
 * General Ledger routes — Module 2 The Financial Spine.
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET    /api/v1/ledger                  (Filterable, paginated journal entries with lines & status tabs)
 *  - GET    /api/v1/ledger/:id              (Inspect single journal entry with full detail & contra linkages)
 *  - POST   /api/v1/ledger/entries          (Create manual journal entry: POSTED, DRAFT, or PENDING_APPROVAL)
 *  - POST   /api/v1/ledger/:id/approve      (Approve PENDING_APPROVAL journal entry into POSTED)
 *  - POST   /api/v1/ledger/:id/reverse      (1-Click contra-journal reversal of POSTED entry)
 *  - DELETE /api/v1/ledger/:id              (Delete DRAFT or PENDING_APPROVAL entry)
 *  - GET    /api/v1/ledger/accounts         (Chart of Accounts Trial Balance totals)
 *  - GET    /api/v1/ledger/recurring        (List recurring journal schedules)
 *  - POST   /api/v1/ledger/recurring        (Create recurring journal schedule)
 *  - PATCH  /api/v1/ledger/recurring/:id    (Update/toggle recurring schedule)
 *  - DELETE /api/v1/ledger/recurring/:id    (Remove recurring schedule)
 *  - POST   /api/v1/ledger/recurring/:id/run (Manually trigger a recurring journal run)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireOrgAuth, requireRole } from '../plugins/auth.js';
import { recordAuditLog } from '../lib/audit.js';
import { ensureOrganizationSystemAccounts } from '../lib/system-accounts.js';
import {
  postJournalEntry,
  reverseJournalEntry,
  approveJournalEntry,
  validateJournalLines,
} from '../lib/ledger-posting.js';
import {
  EntryType,
  JournalStatus,
  NormalBalance,
  RecurrenceFrequency,
  Role,
} from '@prisma/client';

const ListLedgerQuery = z.object({
  status: z.enum(['POSTED', 'PENDING_APPROVAL', 'DRAFT', 'REVERSED', 'ALL']).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountId: z.string().uuid().optional(),
  trackingOptionId: z.string().uuid().optional(),
  referenceType: z.string().optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ManualJournalLineInput = z.object({
  accountId: z.string().uuid(),
  trackingOptionId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  entryType: z.enum(['DEBIT', 'CREDIT']),
  amountCents: z.number().int().positive(),
  description: z.string().trim().max(250).nullable().optional(),
});

const CreateManualJournalEntryBody = z.object({
  description: z.string().trim().min(1).max(500),
  postedAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  status: z.enum(['POSTED', 'DRAFT', 'PENDING_APPROVAL']).optional(),
  lines: z.array(ManualJournalLineInput).min(2),
});

const ReverseJournalBody = z.object({
  reversalDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  reason: z.string().trim().max(500).optional(),
});

const RecurringJournalBody = z.object({
  name: z.string().trim().min(2).max(100),
  frequency: z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY']),
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  autoPost: z.boolean().default(false),
  template: z.object({
    description: z.string().trim().min(1).max(500),
    lines: z.array(ManualJournalLineInput).min(2),
  }),
});

function serializeLedger<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

function calculateNextRunDate(currentDate: Date, frequency: RecurrenceFrequency): Date {
  const next = new Date(currentDate);
  switch (frequency) {
    case RecurrenceFrequency.WEEKLY:
      next.setDate(next.getDate() + 7);
      break;
    case RecurrenceFrequency.FORTNIGHTLY:
      next.setDate(next.getDate() + 14);
      break;
    case RecurrenceFrequency.MONTHLY:
      next.setMonth(next.getMonth() + 1);
      break;
    case RecurrenceFrequency.QUARTERLY:
      next.setMonth(next.getMonth() + 3);
      break;
    case RecurrenceFrequency.ANNUALLY:
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

const ledgerRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/ledger — List double-entry journal entries with status tabs
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/ledger',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AUDITOR),
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

      const {
        status,
        startDate,
        endDate,
        accountId,
        trackingOptionId,
        referenceType,
        search,
        limit,
        offset,
      } = parse.data;

      const organizationId = request.user.organizationId!;

      const whereClause: any = { organizationId };

      if (status && status !== 'ALL') {
        whereClause.status = status as JournalStatus;
      }

      if (startDate || endDate) {
        whereClause.postedAt = {};
        if (startDate) {
          whereClause.postedAt.gte = new Date(`${startDate}T00:00:00.000Z`);
        }
        if (endDate) {
          whereClause.postedAt.lte = new Date(`${endDate}T23:59:59.999Z`);
        }
      }

      if (referenceType && referenceType !== 'ALL') {
        whereClause.referenceType = referenceType;
      }

      if (search && search.length > 0) {
        whereClause.OR = [
          { description: { contains: search, mode: 'insensitive' } },
          { entryNumber: { contains: search, mode: 'insensitive' } },
          { referenceType: { contains: search, mode: 'insensitive' } },
        ];
      }

      const lineFilters: any = {};
      if (accountId) lineFilters.accountId = accountId;
      if (trackingOptionId) lineFilters.trackingOptionId = trackingOptionId;

      if (Object.keys(lineFilters).length > 0) {
        whereClause.lines = { some: lineFilters };
      }

      const [entries, totalCount, statusCountsRaw] = await Promise.all([
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
                trackingOption: {
                  select: {
                    id: true,
                    name: true,
                    trackingCategory: {
                      select: { id: true, name: true },
                    },
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
        fastify.prisma.journalEntry.count({ where: whereClause }),
        fastify.prisma.journalEntry.groupBy({
          by: ['status'],
          where: { organizationId },
          _count: { status: true },
        }),
      ]);

      const statusCounts: Record<string, number> = {
        POSTED: 0,
        PENDING_APPROVAL: 0,
        DRAFT: 0,
        REVERSED: 0,
        ALL: 0,
      };

      for (const item of statusCountsRaw) {
        statusCounts[item.status] = item._count.status;
        statusCounts.ALL += item._count.status;
      }

      // Calculate posted debit and credit aggregates across all posted lines
      const postedLines = await fastify.prisma.journalLine.findMany({
        where: {
          organizationId,
          journalEntry: { status: JournalStatus.POSTED },
        },
        select: { entryType: true, amountCents: true },
      });

      let totalDebitsCents = 0n;
      let totalCreditsCents = 0n;

      for (const line of postedLines) {
        if (line.entryType === EntryType.DEBIT) {
          totalDebitsCents += line.amountCents;
        } else {
          totalCreditsCents += line.amountCents;
        }
      }

      return reply.code(200).send({
        entries: serializeLedger(entries),
        totalCount,
        statusCounts,
        totals: {
          totalDebitsCents: Number(totalDebitsCents),
          totalCreditsCents: Number(totalCreditsCents),
          isBalanced: totalDebitsCents === totalCreditsCents,
        },
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/ledger/:id — Inspect single journal entry with linkages
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/ledger/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AUDITOR),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const entry = await fastify.prisma.journalEntry.findFirst({
        where: { id, organizationId },
        include: {
          lines: {
            include: {
              account: {
                select: { id: true, code: true, name: true, type: true, normalBalance: true },
              },
              trackingOption: {
                select: {
                  id: true,
                  name: true,
                  trackingCategory: { select: { id: true, name: true } },
                },
              },
            },
            orderBy: [{ entryType: 'asc' }, { amountCents: 'desc' }],
          },
        },
      });

      if (!entry) {
        return reply.code(404).send({ error: 'Journal entry not found.' });
      }

      let reversesEntry = null;
      if (entry.reversesEntryId) {
        reversesEntry = await fastify.prisma.journalEntry.findFirst({
          where: { id: entry.reversesEntryId, organizationId },
          select: { id: true, entryNumber: true, description: true, postedAt: true, status: true },
        });
      }

      let reversedByEntry = null;
      if (entry.reversedById) {
        reversedByEntry = await fastify.prisma.journalEntry.findFirst({
          where: { id: entry.reversedById, organizationId },
          select: { id: true, entryNumber: true, description: true, postedAt: true, status: true },
        });
      }

      return reply.send({
        entry: serializeLedger(entry),
        reversesEntry: reversesEntry ? serializeLedger(reversesEntry) : null,
        reversedByEntry: reversedByEntry ? serializeLedger(reversedByEntry) : null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/ledger/entries — Record manual adjusting journal entry
  // Invariant: sum(DEBIT) == sum(CREDIT) in integer cents
  // Smart Approval: ADMIN/ACCOUNTANT can post or draft; others submit for approval
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/ledger/entries',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AP_SPECIALIST, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const bodyParse = CreateManualJournalEntryBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { description, postedAt, status: requestedStatus, lines } = bodyParse.data;
      const organizationId = request.user.organizationId!;
      const userRole = request.user.role!;

      const canPostImmediately =
        userRole === Role.ADMIN || userRole === Role.ACCOUNTANT;

      let targetStatus: JournalStatus = JournalStatus.POSTED;
      if (requestedStatus === 'DRAFT') {
        targetStatus = JournalStatus.DRAFT;
      } else if (requestedStatus === 'PENDING_APPROVAL' || !canPostImmediately) {
        targetStatus = JournalStatus.PENDING_APPROVAL;
      }

      try {
        const entry = await fastify.prisma.$transaction(async (tx) => {
          return postJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description,
            referenceType: 'MANUAL',
            referenceId: 'manual',
            postedAt: postedAt ? new Date(postedAt) : new Date(),
            status: targetStatus,
            lines,
          });
        });

        return reply.code(201).send({ entry: serializeLedger(entry) });
      } catch (err: any) {
        return reply.code(400).send({
          error: err.message || 'Failed to record manual journal entry.',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/ledger/:id/approve — Approve PENDING_APPROVAL journal entry
  // -------------------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/ledger/:id/approve',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      try {
        const approved = await fastify.prisma.$transaction(async (tx) => {
          return approveJournalEntry(tx, organizationId, id, request.user.userId!);
        });

        return reply.send({ entry: serializeLedger(approved) });
      } catch (err: any) {
        return reply.code(400).send({
          error: err.message || 'Failed to approve journal entry.',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/ledger/:id/reverse — 1-Click Contra-Journal Reversal
  // -------------------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/ledger/:id/reverse',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const bodyParse = ReverseJournalBody.safeParse(request.body ?? {});
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { reversalDate, reason } = bodyParse.data;

      try {
        const result = await fastify.prisma.$transaction(async (tx) => {
          return reverseJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            journalEntryId: id,
            reversalDate: reversalDate ? new Date(reversalDate) : new Date(),
            reason,
          });
        });

        return reply.send({
          original: serializeLedger(result.original),
          reversal: serializeLedger(result.reversal),
        });
      } catch (err: any) {
        return reply.code(400).send({
          error: err.message || 'Failed to reverse journal entry.',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/ledger/:id — Delete DRAFT or PENDING_APPROVAL entry
  // -------------------------------------------------------------------------
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/ledger/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const entry = await fastify.prisma.journalEntry.findFirst({
        where: { id, organizationId },
      });

      if (!entry) {
        return reply.code(404).send({ error: 'Journal entry not found.' });
      }

      if (entry.status === JournalStatus.POSTED || entry.status === JournalStatus.REVERSED) {
        return reply.code(400).send({
          error: 'Posted or reversed journal entries cannot be deleted. Use 1-Click Reversal to void an active posted journal.',
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.journalEntry.delete({ where: { id: entry.id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'JOURNAL_DELETED',
          entityType: 'JOURNAL_ENTRY',
          entityId: entry.id,
          summary: `Deleted ${entry.status.toLowerCase()} journal ${entry.entryNumber || entry.id}: "${entry.description}"`,
        });
      });

      return reply.send({ ok: true, message: 'Draft journal deleted successfully.' });
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

      const accountCount = await fastify.prisma.account.count({ where: { organizationId } });
      if (accountCount === 0) {
        await ensureOrganizationSystemAccounts(fastify.prisma, organizationId);
      }

      const accounts = await fastify.prisma.account.findMany({
        where: { organizationId },
        orderBy: { code: 'asc' },
        include: {
          journalLines: {
            where: {
              journalEntry: { status: JournalStatus.POSTED },
            },
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
  // GET /api/v1/ledger/recurring — List recurring journal schedules
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/ledger/recurring',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AUDITOR),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      const schedules = await fastify.prisma.recurringSchedule.findMany({
        where: {
          organizationId,
          scheduleType: 'JOURNAL',
        },
        orderBy: { nextRunDate: 'asc' },
      });

      return reply.send({
        schedules: schedules.map((s) => ({
          ...s,
          template: JSON.parse(s.templatePayloadJson),
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/ledger/recurring — Create recurring journal schedule
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/ledger/recurring',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const parse = RecurringJournalBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { name, frequency, startDate, autoPost, template } = parse.data;
      const organizationId = request.user.organizationId!;

      // Validate template lines balance upfront
      try {
        await validateJournalLines(fastify.prisma, organizationId, template.lines);
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }

      const start = new Date(startDate);
      const schedule = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.recurringSchedule.create({
          data: {
            organizationId,
            scheduleType: 'JOURNAL',
            name,
            frequency: frequency as RecurrenceFrequency,
            startDate: start,
            nextRunDate: start,
            autoPost,
            isActive: true,
            templatePayloadJson: JSON.stringify(template),
            createdByUserId: request.user.userId,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'RECURRING_SCHEDULE_CREATED',
          entityType: 'RECURRING_SCHEDULE',
          entityId: created.id,
          summary: `Created recurring journal template "${created.name}" (${created.frequency})`,
          metadata: { name, frequency, autoPost },
        });

        return created;
      });

      return reply.code(201).send({
        schedule: {
          ...schedule,
          template,
        },
      });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/ledger/recurring/:id — Update/toggle recurring schedule
  // -------------------------------------------------------------------------
  fastify.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      frequency?: RecurrenceFrequency;
      autoPost?: boolean;
      isActive?: boolean;
    };
  }>(
    '/api/v1/ledger/recurring/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;
      const body = request.body ?? {};

      const existing = await fastify.prisma.recurringSchedule.findFirst({
        where: { id, organizationId, scheduleType: 'JOURNAL' },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Recurring schedule not found.' });
      }

      const data: any = {};
      if (body.name !== undefined) data.name = body.name.trim();
      if (body.frequency !== undefined) data.frequency = body.frequency;
      if (body.autoPost !== undefined) data.autoPost = Boolean(body.autoPost);
      if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

      const updated = await fastify.prisma.recurringSchedule.update({
        where: { id: existing.id },
        data,
      });

      return reply.send({
        schedule: {
          ...updated,
          template: JSON.parse(updated.templatePayloadJson),
        },
      });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/ledger/recurring/:id — Delete recurring schedule
  // -------------------------------------------------------------------------
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/ledger/recurring/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const existing = await fastify.prisma.recurringSchedule.findFirst({
        where: { id, organizationId, scheduleType: 'JOURNAL' },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Recurring schedule not found.' });
      }

      await fastify.prisma.recurringSchedule.delete({
        where: { id: existing.id },
      });

      return reply.send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/ledger/recurring/:id/run — Manually trigger recurring journal
  // -------------------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/ledger/recurring/:id/run',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const schedule = await fastify.prisma.recurringSchedule.findFirst({
        where: { id, organizationId, scheduleType: 'JOURNAL' },
      });

      if (!schedule) {
        return reply.code(404).send({ error: 'Recurring schedule not found.' });
      }

      const template = JSON.parse(schedule.templatePayloadJson);
      const executionDate = new Date();

      try {
        const result = await fastify.prisma.$transaction(async (tx) => {
          const entry = await postJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: `${schedule.name}: ${template.description}`,
            referenceType: 'RECURRING_SCHEDULE',
            referenceId: schedule.id,
            postedAt: executionDate,
            status: schedule.autoPost ? JournalStatus.POSTED : JournalStatus.DRAFT,
            lines: template.lines,
          });

          const nextRun = calculateNextRunDate(schedule.nextRunDate, schedule.frequency);

          await tx.recurringSchedule.update({
            where: { id: schedule.id },
            data: {
              lastRunDate: executionDate,
              nextRunDate: nextRun,
            },
          });

          return entry;
        });

        return reply.send({
          ok: true,
          message: `Generated journal ${result.entryNumber} from recurring template "${schedule.name}".`,
          entry: serializeLedger(result),
        });
      } catch (err: any) {
        return reply.code(400).send({
          error: err.message || 'Failed to execute recurring journal.',
        });
      }
    },
  );
};

export default ledgerRoutes;
