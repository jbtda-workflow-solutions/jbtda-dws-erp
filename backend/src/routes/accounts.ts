/**
 * Chart of Accounts & Tracking Categories (Dimensions) routes — Module 2 foundation.
 *
 * Endpoints:
 *   GET    /api/v1/accounts                          — List all GL accounts with live running balances
 *   POST   /api/v1/accounts                          — Create a custom GL account or sub-account
 *   PATCH  /api/v1/accounts/:id                      — Update account metadata (protects 10 system accounts)
 *   POST   /api/v1/accounts/:id/decommission         — Decommission / Sweep balance to parent/main account
 *   GET    /api/v1/tracking-categories               — List tracking dimensions & options
 *   POST   /api/v1/tracking-categories               — Create a tracking category + initial options
 *   POST   /api/v1/tracking-categories/:id/options   — Add an option to a tracking category
 *   PATCH  /api/v1/tracking-options/:id              — Update / archive a tracking option
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  AccountType,
  NormalBalance,
  TaxTreatment,
  EntryType,
  JournalStatus,
  Role,
} from '@prisma/client';
import { requireOrgAuth, requireRole } from '../plugins/auth.js';
import { recordAuditLog } from '../lib/audit.js';
import { checkOrganizationLockDate } from '../lib/ledger-posting.js';
import { ensureOrganizationSystemAccounts } from '../lib/system-accounts.js';

const VALID_ACCOUNT_TYPES = new Set<string>([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
]);

const VALID_TAX_TREATMENTS = new Set<string>([
  'TAX_EXCLUSIVE',
  'TAX_INCLUSIVE',
  'GST_FREE',
]);

function defaultNormalBalanceForType(type: AccountType): NormalBalance {
  return type === AccountType.ASSET || type === AccountType.EXPENSE
    ? NormalBalance.DEBIT
    : NormalBalance.CREDIT;
}

const accountRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/accounts — List Chart of Accounts with live running balances
  // -------------------------------------------------------------------------
  fastify.get<{
    Querystring: {
      type?: string;
      includeInactive?: string;
      search?: string;
    };
  }>(
    '/api/v1/accounts',
    {
      preHandler: [requireOrgAuth],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { type, includeInactive, search } = request.query;

      // Auto-heal / self-seed: If the organization has 0 accounts, seed the 10 protected accounts immediately
      const accountCount = await fastify.prisma.account.count({ where: { organizationId } });
      if (accountCount === 0) {
        await ensureOrganizationSystemAccounts(fastify.prisma, organizationId);
      }

      const where: Record<string, unknown> = { organizationId };

      if (type && VALID_ACCOUNT_TYPES.has(type)) {
        where['type'] = type as AccountType;
      }
      if (includeInactive !== 'true') {
        where['isActive'] = true;
      }
      if (search && search.trim()) {
        const q = search.trim();
        where['OR'] = [
          { code: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ];
      }

      const [accounts, postedLines] = await Promise.all([
        fastify.prisma.account.findMany({
          where,
          include: {
            parent: {
              select: { id: true, code: true, name: true },
            },
          },
          orderBy: { code: 'asc' },
        }),
        fastify.prisma.journalLine.findMany({
          where: {
            organizationId,
            journalEntry: {
              status: JournalStatus.POSTED,
            },
          },
          select: {
            accountId: true,
            entryType: true,
            amountCents: true,
          },
        }),
      ]);

      const balanceMap = new Map<
        string,
        { debitsCents: bigint; creditsCents: bigint; lineCount: number }
      >();

      for (const line of postedLines) {
        const cur = balanceMap.get(line.accountId) ?? {
          debitsCents: 0n,
          creditsCents: 0n,
          lineCount: 0,
        };
        if (line.entryType === EntryType.DEBIT) {
          cur.debitsCents += line.amountCents;
        } else {
          cur.creditsCents += line.amountCents;
        }
        cur.lineCount += 1;
        balanceMap.set(line.accountId, cur);
      }

      return reply.send({
        accounts: accounts.map((acc) => {
          const stats = balanceMap.get(acc.id) ?? {
            debitsCents: 0n,
            creditsCents: 0n,
            lineCount: 0,
          };
          const netBalanceCents =
            acc.normalBalance === NormalBalance.DEBIT
              ? stats.debitsCents - stats.creditsCents
              : stats.creditsCents - stats.debitsCents;

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
            parent: acc.parent,
            defaultTaxTreatment: acc.defaultTaxTreatment,
            isBankAccount: acc.isBankAccount,
            bankBsb: acc.bankBsb,
            bankAccountNumber: acc.bankAccountNumber,
            isActive: acc.isActive,
            debitsCents: Number(stats.debitsCents),
            creditsCents: Number(stats.creditsCents),
            netBalanceCents: Number(netBalanceCents),
            lineCount: stats.lineCount,
          };
        }),
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/accounts/seed — Explicitly verify & seed 10 Protected Accounts
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/accounts/seed',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      await ensureOrganizationSystemAccounts(fastify.prisma, organizationId);
      return reply.code(200).send({
        ok: true,
        message: '10 Protected System Accounts verified and initialized successfully.',
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/accounts — Create custom GL account or sub-account
  // -------------------------------------------------------------------------
  fastify.post<{
    Body: {
      code?: string;
      name?: string;
      type?: string;
      description?: string | null;
      parentId?: string | null;
      defaultTaxTreatment?: string;
      isBankAccount?: boolean;
      bankBsb?: string | null;
      bankAccountNumber?: string | null;
    };
  }>(
    '/api/v1/accounts',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const body = request.body ?? {};

      const code = body.code?.trim();
      const name = body.name?.trim();
      const typeStr = body.type?.trim();

      if (!code || !/^[A-Za-z0-9-]{2,12}$/.test(code)) {
        return reply.code(400).send({
          error: 'Account code must be 2–12 alphanumeric characters (e.g. 1050 or 6120).',
        });
      }

      if (!name || name.length < 2 || name.length > 100) {
        return reply.code(400).send({
          error: 'Account name must be between 2 and 100 characters.',
        });
      }

      if (!typeStr || !VALID_ACCOUNT_TYPES.has(typeStr)) {
        return reply.code(400).send({
          error: 'Account type must be ASSET, LIABILITY, EQUITY, REVENUE, or EXPENSE.',
        });
      }

      const accountType = typeStr as AccountType;
      const normalBalance = defaultNormalBalanceForType(accountType);

      const defaultTaxTreatment =
        body.defaultTaxTreatment &&
        VALID_TAX_TREATMENTS.has(body.defaultTaxTreatment)
          ? (body.defaultTaxTreatment as TaxTreatment)
          : accountType === AccountType.REVENUE ||
              accountType === AccountType.EXPENSE
            ? TaxTreatment.TAX_EXCLUSIVE
            : TaxTreatment.GST_FREE;

      const duplicate = await fastify.prisma.account.findUnique({
        where: {
          organizationId_code: { organizationId, code },
        },
      });
      if (duplicate) {
        return reply.code(409).send({
          error: `An account with code ${code} already exists in this organization.`,
        });
      }

      if (body.parentId) {
        const parent = await fastify.prisma.account.findFirst({
          where: { id: body.parentId, organizationId },
        });
        if (!parent) {
          return reply.code(400).send({
            error: 'Selected parent account does not exist in this organization.',
          });
        }
        if (parent.type !== accountType) {
          return reply.code(400).send({
            error: `Sub-account type (${accountType}) must match parent account type (${parent.type}).`,
          });
        }
      }

      const created = await fastify.prisma.$transaction(async (tx) => {
        const acc = await tx.account.create({
          data: {
            organizationId,
            code,
            name,
            type: accountType,
            normalBalance,
            description: body.description?.trim() || null,
            parentId: body.parentId || null,
            defaultTaxTreatment,
            isBankAccount: Boolean(body.isBankAccount),
            bankBsb: body.bankBsb?.trim() || null,
            bankAccountNumber: body.bankAccountNumber?.trim() || null,
            isSystem: false,
            isActive: true,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'ACCOUNT_CREATED',
          entityType: 'ACCOUNT',
          entityId: acc.id,
          summary: `Created GL account ${acc.code} — ${acc.name} (${acc.type})`,
          metadata: {
            code: acc.code,
            name: acc.name,
            type: acc.type,
            parentId: acc.parentId,
            isBankAccount: acc.isBankAccount,
          },
        });

        return acc;
      });

      return reply.code(201).send({ account: created });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/accounts/:id — Update account metadata
  // -------------------------------------------------------------------------
  fastify.patch<{
    Params: { id: string };
    Body: {
      code?: string;
      name?: string;
      description?: string | null;
      parentId?: string | null;
      defaultTaxTreatment?: string;
      isBankAccount?: boolean;
      bankBsb?: string | null;
      bankAccountNumber?: string | null;
      isActive?: boolean;
    };
  }>(
    '/api/v1/accounts/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;
      const body = request.body ?? {};

      const existing = await fastify.prisma.account.findFirst({
        where: { id, organizationId },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Account not found.' });
      }

      if (existing.isSystem) {
        if (body.code !== undefined && body.code.trim() !== existing.code) {
          return reply.code(403).send({
            error: `Account ${existing.code} (${existing.name}) is a protected system account. Its account code cannot be altered.`,
          });
        }
        if (body.isActive === false) {
          return reply.code(403).send({
            error: `Account ${existing.code} (${existing.name}) is a protected system account and cannot be deactivated.`,
          });
        }
      }

      const data: Record<string, unknown> = {};

      if (body.code !== undefined && !existing.isSystem) {
        const nextCode = body.code.trim();
        if (!/^[A-Za-z0-9-]{2,12}$/.test(nextCode)) {
          return reply.code(400).send({
            error: 'Account code must be 2–12 alphanumeric characters.',
          });
        }
        if (nextCode !== existing.code) {
          const dup = await fastify.prisma.account.findUnique({
            where: {
              organizationId_code: { organizationId, code: nextCode },
            },
          });
          if (dup) {
            return reply.code(409).send({
              error: `An account with code ${nextCode} already exists.`,
            });
          }
          data['code'] = nextCode;
        }
      }

      if (body.name !== undefined) {
        const nextName = body.name.trim();
        if (nextName.length < 2 || nextName.length > 100) {
          return reply.code(400).send({
            error: 'Account name must be between 2 and 100 characters.',
          });
        }
        data['name'] = nextName;
      }

      if (body.description !== undefined) {
        data['description'] = body.description?.trim() || null;
      }

      if (body.parentId !== undefined && !existing.isSystem) {
        if (body.parentId === existing.id) {
          return reply.code(400).send({
            error: 'An account cannot be its own parent.',
          });
        }
        if (body.parentId) {
          const parent = await fastify.prisma.account.findFirst({
            where: { id: body.parentId, organizationId },
          });
          if (!parent || parent.type !== existing.type) {
            return reply.code(400).send({
              error: 'Parent account must exist and have the same classification.',
            });
          }
        }
        data['parentId'] = body.parentId || null;
      }

      if (
        body.defaultTaxTreatment !== undefined &&
        VALID_TAX_TREATMENTS.has(body.defaultTaxTreatment)
      ) {
        data['defaultTaxTreatment'] = body.defaultTaxTreatment as TaxTreatment;
      }

      if (body.isBankAccount !== undefined) {
        data['isBankAccount'] = Boolean(body.isBankAccount);
      }
      if (body.bankBsb !== undefined) {
        data['bankBsb'] = body.bankBsb?.trim() || null;
      }
      if (body.bankAccountNumber !== undefined) {
        data['bankAccountNumber'] = body.bankAccountNumber?.trim() || null;
      }
      if (body.isActive !== undefined && !existing.isSystem) {
        data['isActive'] = Boolean(body.isActive);
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const acc = await tx.account.update({
          where: { id: existing.id },
          data,
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'ACCOUNT_UPDATED',
          entityType: 'ACCOUNT',
          entityId: acc.id,
          summary: `Updated GL account ${acc.code} — ${acc.name}`,
          metadata: data,
        });

        return acc;
      });

      return reply.send({ account: updated });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/accounts/:id/decommission
  // -------------------------------------------------------------------------
  fastify.post<{
    Params: { id: string };
    Body: {
      targetAccountId?: string | null;
      postedAt?: string;
    };
  }>(
    '/api/v1/accounts/:id/decommission',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;
      const body = request.body ?? {};

      const account = await fastify.prisma.account.findFirst({
        where: { id, organizationId },
      });

      if (!account) {
        return reply.code(404).send({ error: 'Account not found.' });
      }

      if (account.isSystem) {
        return reply.code(403).send({
          error: `Account ${account.code} (${account.name}) is a protected system account and cannot be deleted or decommissioned.`,
        });
      }

      const postedLines = await fastify.prisma.journalLine.findMany({
        where: {
          organizationId,
          accountId: account.id,
          journalEntry: { status: JournalStatus.POSTED },
        },
        select: { entryType: true, amountCents: true },
      });

      let debits = 0n;
      let credits = 0n;
      for (const l of postedLines) {
        if (l.entryType === EntryType.DEBIT) debits += l.amountCents;
        else credits += l.amountCents;
      }

      const netDebitMinusCredit = debits - credits;
      const targetId = body.targetAccountId || account.parentId;

      if (netDebitMinusCredit !== 0n && !targetId) {
        return reply.code(400).send({
          error:
            'This account has a non-zero balance. Please select a destination GL account to sweep its balance into before decommissioning.',
        });
      }

      const sweepDate = body.postedAt ? new Date(body.postedAt) : new Date();

      const result = await fastify.prisma.$transaction(async (tx) => {
        let sweepJournalId: string | null = null;

        if (netDebitMinusCredit !== 0n && targetId) {
          if (targetId === account.id) {
            throw fastify.httpErrors.badRequest(
              'Destination sweep account must be different from the account being decommissioned.',
            );
          }

          const lockCheck = await checkOrganizationLockDate(
            tx,
            organizationId,
            sweepDate,
          );
          if (lockCheck.locked) {
            throw fastify.httpErrors.conflict(lockCheck.message!);
          }

          const targetAccount = await tx.account.findFirst({
            where: { id: targetId, organizationId, isActive: true },
          });

          if (!targetAccount) {
            throw fastify.httpErrors.badRequest(
              'Selected destination account was not found or is inactive.',
            );
          }

          if (targetAccount.type !== account.type) {
            throw fastify.httpErrors.badRequest(
              `Destination account (${targetAccount.code} - ${targetAccount.type}) must share the same classification (${account.type}).`,
            );
          }

          const absAmount =
            netDebitMinusCredit > 0n
              ? netDebitMinusCredit
              : -netDebitMinusCredit;

          const sourceEntryType =
            netDebitMinusCredit > 0n ? EntryType.CREDIT : EntryType.DEBIT;
          const targetEntryType =
            netDebitMinusCredit > 0n ? EntryType.DEBIT : EntryType.CREDIT;

          const journal = await tx.journalEntry.create({
            data: {
              organizationId,
              description: `Balance sweep & decommission: ${account.code} ${account.name} → ${targetAccount.code} ${targetAccount.name}`,
              referenceType: 'ACCOUNT_BALANCE_SWEEP',
              referenceId: account.id,
              status: JournalStatus.POSTED,
              postedAt: sweepDate,
              createdByUserId: request.user.userId,
              approvedByUserId: request.user.userId,
              lines: {
                create: [
                  {
                    organizationId,
                    accountId: account.id,
                    entryType: sourceEntryType,
                    amountCents: absAmount,
                    description: `Zero out ${account.code} on decommission`,
                  },
                  {
                    organizationId,
                    accountId: targetAccount.id,
                    entryType: targetEntryType,
                    amountCents: absAmount,
                    description: `Balance transferred from ${account.code} ${account.name}`,
                  },
                ],
              },
            },
          });

          sweepJournalId = journal.id;
        }

        const updatedAccount = await tx.account.update({
          where: { id: account.id },
          data: { isActive: false },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'ACCOUNT_DECOMMISSIONED',
          entityType: 'ACCOUNT',
          entityId: account.id,
          summary: sweepJournalId
            ? `Swept balance of ${account.code} (${account.name}) and archived account`
            : `Archived GL account ${account.code} (${account.name})`,
          metadata: {
            accountId: account.id,
            code: account.code,
            targetAccountId: targetId ?? null,
            sweepJournalId,
          },
        });

        return { account: updatedAccount, sweepJournalId };
      });

      return reply.send(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/tracking-categories — List Tracking Categories & Options
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/tracking-categories',
    {
      preHandler: [requireOrgAuth],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      const categories = await fastify.prisma.trackingCategory.findMany({
        where: { organizationId },
        include: {
          options: {
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      });

      return reply.send({ categories });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/tracking-categories — Create Tracking Category (Dimension)
  // -------------------------------------------------------------------------
  fastify.post<{
    Body: {
      name?: string;
      options?: Array<{ name: string; code?: string | null }>;
    };
  }>(
    '/api/v1/tracking-categories',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const name = request.body?.name?.trim();
      const initialOptions = request.body?.options ?? [];

      if (!name || name.length < 2 || name.length > 60) {
        return reply.code(400).send({
          error: 'Tracking category name must be between 2 and 60 characters (e.g. Department, Project, Fleet Vehicle).',
        });
      }

      const dup = await fastify.prisma.trackingCategory.findUnique({
        where: { organizationId_name: { organizationId, name } },
      });
      if (dup) {
        return reply.code(409).send({
          error: `Tracking category "${name}" already exists.`,
        });
      }

      const category = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.trackingCategory.create({
          data: {
            organizationId,
            name,
            isActive: true,
            options: {
              create: initialOptions
                .filter((o) => o.name && o.name.trim())
                .map((o) => ({
                  organizationId,
                  name: o.name.trim(),
                  code: o.code?.trim() || null,
                  isActive: true,
                })),
            },
          },
          include: { options: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'TRACKING_CATEGORY_CREATED',
          entityType: 'TRACKING_CATEGORY',
          entityId: created.id,
          summary: `Created tracking dimension "${created.name}"`,
          metadata: { name: created.name },
        });

        return created;
      });

      return reply.code(201).send({ category });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/tracking-categories/:id/options — Add Option to Category
  // -------------------------------------------------------------------------
  fastify.post<{
    Params: { id: string };
    Body: { name?: string; code?: string | null };
  }>(
    '/api/v1/tracking-categories/:id/options',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;
      const name = request.body?.name?.trim();
      const code = request.body?.code?.trim() || null;

      if (!name || name.length < 1 || name.length > 60) {
        return reply.code(400).send({
          error: 'Option name must be between 1 and 60 characters.',
        });
      }

      const category = await fastify.prisma.trackingCategory.findFirst({
        where: { id, organizationId },
      });
      if (!category) {
        return reply.code(404).send({ error: 'Tracking category not found.' });
      }

      const option = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.trackingOption.create({
          data: {
            trackingCategoryId: category.id,
            organizationId,
            name,
            code,
            isActive: true,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'TRACKING_OPTION_CREATED',
          entityType: 'TRACKING_CATEGORY',
          entityId: category.id,
          summary: `Added dimension option "${created.name}" to ${category.name}`,
          metadata: { optionId: created.id, name: created.name, code },
        });

        return created;
      });

      return reply.code(201).send({ option });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/tracking-options/:id — Update or Archive Tracking Option
  // -------------------------------------------------------------------------
  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; code?: string | null; isActive?: boolean };
  }>(
    '/api/v1/tracking-options/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;
      const body = request.body ?? {};

      const existing = await fastify.prisma.trackingOption.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'Tracking option not found.' });
      }

      const updated = await fastify.prisma.trackingOption.update({
        where: { id: existing.id },
        data: {
          name: body.name !== undefined ? body.name.trim() : existing.name,
          code:
            body.code !== undefined ? body.code?.trim() || null : existing.code,
          isActive:
            body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive,
        },
      });

      return reply.send({ option: updated });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/accounts/:id — Safe delete (only for custom accounts with 0 lines)
  // -------------------------------------------------------------------------
  fastify.delete<{
    Params: { id: string };
  }>(
    '/api/v1/accounts/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const account = await fastify.prisma.account.findFirst({
        where: { id, organizationId },
        include: {
          children: { select: { id: true } },
          journalLines: { select: { id: true }, take: 1 },
        },
      });

      if (!account) {
        return reply.code(404).send({ error: 'Account not found.' });
      }

      if (account.isSystem) {
        return reply.code(403).send({
          error: `Account ${account.code} (${account.name}) is a protected system account and cannot be deleted.`,
        });
      }

      if (account.children.length > 0) {
        return reply.code(400).send({
          error: `Cannot delete account ${account.code} because it has ${account.children.length} sub-account(s). Please delete or reassign sub-accounts first.`,
        });
      }

      if (account.journalLines.length > 0) {
        return reply.code(400).send({
          error: `Account ${account.code} has historical journal activity and cannot be deleted directly. Use the Decommission & Balance Sweep action to safely sweep its balance and retire it.`,
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.account.delete({ where: { id: account.id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'ACCOUNT_DELETED',
          entityType: 'ACCOUNT',
          entityId: account.id,
          summary: `Deleted custom GL account ${account.code} — ${account.name}`,
          metadata: { code: account.code, name: account.name },
        });
      });

      return reply.send({ ok: true, message: `Account ${account.code} deleted successfully.` });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/tracking-categories/:id — Archive or delete category
  // -------------------------------------------------------------------------
  fastify.delete<{
    Params: { id: string };
  }>(
    '/api/v1/tracking-categories/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const category = await fastify.prisma.trackingCategory.findFirst({
        where: { id, organizationId },
        include: { options: true },
      });

      if (!category) {
        return reply.code(404).send({ error: 'Tracking category not found.' });
      }

      const optionIds = category.options.map((o) => o.id);
      const usedCount = await fastify.prisma.journalLine.count({
        where: {
          organizationId,
          trackingOptionId: { in: optionIds },
        },
      });

      await fastify.prisma.$transaction(async (tx) => {
        if (usedCount > 0) {
          // If used historically, mark category and options as inactive
          await tx.trackingCategory.update({
            where: { id: category.id },
            data: { isActive: false },
          });
          await tx.trackingOption.updateMany({
            where: { trackingCategoryId: category.id },
            data: { isActive: false },
          });

          await recordAuditLog(tx, {
            organizationId,
            actorUserId: request.user.userId,
            action: 'TRACKING_CATEGORY_ARCHIVED',
            entityType: 'TRACKING_CATEGORY',
            entityId: category.id,
            summary: `Archived tracking dimension "${category.name}" (retained for historical reporting)`,
          });
        } else {
          // If zero historical activity, cleanly delete
          await tx.trackingCategory.delete({
            where: { id: category.id },
          });

          await recordAuditLog(tx, {
            organizationId,
            actorUserId: request.user.userId,
            action: 'TRACKING_CATEGORY_DELETED',
            entityType: 'TRACKING_CATEGORY',
            entityId: category.id,
            summary: `Deleted tracking dimension "${category.name}"`,
          });
        }
      });

      return reply.send({
        ok: true,
        message: usedCount > 0
          ? `Dimension "${category.name}" was archived because it is referenced in past journals.`
          : `Dimension "${category.name}" was deleted successfully.`,
      });
    },
  );
};

export default accountRoutes;
