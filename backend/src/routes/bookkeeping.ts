/**
 * Bookkeeping Workbench Routes — Stage 18 (Wave 1: CORE_ACCOUNTING).
 *
 * Scoped strictly to `request.user.organizationId` for multi-tenant isolation.
 * Supported routes:
 *  - GET    /api/v1/bookkeeping/account-transactions        (Interactive Account Transactions register with running balance)
 *  - GET    /api/v1/bookkeeping/bank-rules                  (List deterministic Bank Rules)
 *  - POST   /api/v1/bookkeeping/bank-rules                  (Create Bank Rule)
 *  - PATCH  /api/v1/bookkeeping/bank-rules/:id              (Update Bank Rule)
 *  - DELETE /api/v1/bookkeeping/bank-rules/:id              (Delete Bank Rule)
 *  - POST   /api/v1/bookkeeping/bank-rules/apply            (Auto-apply active Bank Rules to unreconciled statement lines)
 *  - POST   /api/v1/bookkeeping/cash-coding/reconcile       (Bulk Cash Coding reconciliation in one atomic transaction)
 *  - POST   /api/v1/bookkeeping/reconciliation/split-match  (Split/Multi-document + inline bank fee bank reconciliation)
 *  - GET    /api/v1/bookkeeping/reconciliation/summary      (Formal Bank Reconciliation Summary Proof & duplicate detection)
 *  - GET    /api/v1/bookkeeping/find-recode/preview         (Search posted GL lines for Find & Recode)
 *  - POST   /api/v1/bookkeeping/find-recode/apply           (Batch recode via atomic balanced Reclassification Journal)
 *  - POST   /api/v1/bookkeeping/conversion-balances         (Post balanced Opening / Conversion Balances journal)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  BillStatus,
  DirectTransactionType,
  EntryType,
  InvoiceStatus,
  JournalStatus,
  NormalBalance,
  PaymentReceiptType,
  Role,
  TaxTreatment,
} from '@prisma/client';
import { requireRole } from '../plugins/auth.js';
import { calculateGST } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import {
  checkOrganizationLockDate,
  postJournalEntry,
  type JournalLineInput,
} from '../lib/ledger-posting.js';

function serialize<T>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

const BankRuleBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  direction: z.enum(['SPEND', 'RECEIVE']).default('SPEND'),
  matchField: z.enum(['DESCRIPTION', 'REFERENCE', 'ANY']).default('ANY'),
  matchType: z.enum(['CONTAINS', 'EXACT', 'STARTS_WITH']).default('CONTAINS'),
  matchValue: z.string().trim().min(1).max(200),
  contactId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid(),
  trackingOptionId: z.string().uuid().nullable().optional(),
  taxTreatment: z.nativeEnum(TaxTreatment).default(TaxTreatment.TAX_INCLUSIVE),
  priority: z.coerce.number().int().min(1).max(9999).default(100),
  isActive: z.boolean().default(true),
});

const CashCodingSchema = z.object({
  items: z
    .array(
      z.object({
        statementLineId: z.string().uuid(),
        contactId: z.string().uuid().nullable().optional(),
        accountId: z.string().uuid(),
        trackingOptionId: z.string().uuid().nullable().optional(),
        taxTreatment: z.nativeEnum(TaxTreatment).default(TaxTreatment.TAX_INCLUSIVE),
        description: z.string().trim().max(250).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const SplitMatchSchema = z.object({
  statementLineId: z.string().uuid(),
  mode: z.enum(['INVOICES', 'BILLS']),
  allocations: z
    .array(
      z.object({
        documentId: z.string().uuid(),
        amountCents: z.coerce.number().int().positive(),
      }),
    )
    .min(1)
    .max(50),
  adjustment: z
    .object({
      accountId: z.string().uuid(),
      amountCents: z.coerce.number().int(), // positive = bank fee/deduction on receipt or surcharge on payment
      taxTreatment: z.nativeEnum(TaxTreatment).default(TaxTreatment.GST_FREE),
      description: z.string().trim().max(200).optional(),
      trackingOptionId: z.string().uuid().nullable().optional(),
    })
    .optional(),
});

const FindRecodeApplySchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1).max(200),
  targetAccountId: z.string().uuid().optional(),
  targetTrackingOptionId: z.string().uuid().nullable().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(2).max(250),
});

const ConversionBalancesSchema = z.object({
  conversionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(250).optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        debitCents: z.coerce.number().int().min(0).default(0),
        creditCents: z.coerce.number().int().min(0).default(0),
      }),
    )
    .min(2),
});

function matchesBankRule(
  rule: {
    direction: string;
    matchField: string;
    matchType: string;
    matchValue: string;
  },
  line: {
    amountCents: bigint;
    description: string;
    reference: string | null;
  },
): boolean {
  const isSpend = line.amountCents < 0n;
  if (rule.direction === 'SPEND' && !isSpend) return false;
  if (rule.direction === 'RECEIVE' && isSpend) return false;

  const needle = rule.matchValue.trim().toLowerCase();
  if (!needle) return false;

  const haystacks: string[] = [];
  if (rule.matchField === 'DESCRIPTION' || rule.matchField === 'ANY') {
    haystacks.push((line.description || '').toLowerCase());
  }
  if (rule.matchField === 'REFERENCE' || rule.matchField === 'ANY') {
    haystacks.push((line.reference || '').toLowerCase());
  }

  return haystacks.some((h) => {
    if (rule.matchType === 'EXACT') return h.trim() === needle;
    if (rule.matchType === 'STARTS_WITH') return h.trim().startsWith(needle);
    return h.includes(needle);
  });
}

export const bookkeepingRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // 18.1 GET /api/v1/bookkeeping/account-transactions
  // Interactive Account Transactions Register with Opening & Running Balance
  // -------------------------------------------------------------------------
  fastify.get<{
    Querystring: {
      accountId?: string;
      startDate?: string;
      endDate?: string;
      trackingOptionId?: string;
      referenceType?: string;
      search?: string;
      limit?: string;
    };
  }>(
    '/api/v1/bookkeeping/account-transactions',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AUDITOR),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { accountId, startDate, endDate, trackingOptionId, referenceType, search } =
        request.query;
      const limit = Math.min(Math.max(Number(request.query.limit ?? 250) || 250, 20), 1000);

      const startDt = startDate ? new Date(`${startDate}T00:00:00.000Z`) : null;
      const endDt = endDate ? new Date(`${endDate}T23:59:59.999Z`) : null;

      let selectedAccount: {
        id: string;
        code: string;
        name: string;
        type: string;
        normalBalance: NormalBalance;
      } | null = null;
      let openingBalanceCents = 0n;

      if (accountId) {
        selectedAccount = await fastify.prisma.account.findFirst({
          where: { id: accountId, organizationId },
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            normalBalance: true,
          },
        });
        if (!selectedAccount) {
          return reply.code(404).send({ error: 'Account not found.' });
        }

        if (startDt) {
          const priorLines = await fastify.prisma.journalLine.findMany({
            where: {
              organizationId,
              accountId,
              ...(trackingOptionId ? { trackingOptionId } : {}),
              journalEntry: {
                status: JournalStatus.POSTED,
                postedAt: { lt: startDt },
              },
            },
            select: { entryType: true, amountCents: true },
          });
          let priorDr = 0n;
          let priorCr = 0n;
          for (const pl of priorLines) {
            if (pl.entryType === EntryType.DEBIT) priorDr += pl.amountCents;
            else priorCr += pl.amountCents;
          }
          openingBalanceCents =
            selectedAccount.normalBalance === NormalBalance.DEBIT
              ? priorDr - priorCr
              : priorCr - priorDr;
        }
      }

      const rawLines = await fastify.prisma.journalLine.findMany({
        where: {
          organizationId,
          ...(accountId ? { accountId } : {}),
          ...(trackingOptionId ? { trackingOptionId } : {}),
          journalEntry: {
            status: JournalStatus.POSTED,
            ...(startDt || endDt
              ? {
                  postedAt: {
                    ...(startDt ? { gte: startDt } : {}),
                    ...(endDt ? { lte: endDt } : {}),
                  },
                }
              : {}),
            ...(referenceType && referenceType !== 'ALL' ? { referenceType } : {}),
          },
          ...(search && search.trim()
            ? {
                OR: [
                  { description: { contains: search.trim(), mode: 'insensitive' } },
                  {
                    journalEntry: {
                      description: { contains: search.trim(), mode: 'insensitive' },
                    },
                  },
                  {
                    journalEntry: {
                      entryNumber: { contains: search.trim(), mode: 'insensitive' },
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ journalEntry: { postedAt: 'asc' } }, { id: 'asc' }],
        take: limit,
        include: {
          account: {
            select: { id: true, code: true, name: true, type: true, normalBalance: true },
          },
          trackingOption: {
            select: { id: true, name: true },
          },
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              description: true,
              referenceType: true,
              referenceId: true,
              postedAt: true,
              isReconciled: true,
            },
          },
        },
      });

      let runningBalanceCents = openingBalanceCents;
      let totalDebitsCents = 0n;
      let totalCreditsCents = 0n;

      const transactions = rawLines.map((line) => {
        const debitCents = line.entryType === EntryType.DEBIT ? line.amountCents : 0n;
        const creditCents = line.entryType === EntryType.CREDIT ? line.amountCents : 0n;
        totalDebitsCents += debitCents;
        totalCreditsCents += creditCents;

        if (selectedAccount) {
          const delta =
            selectedAccount.normalBalance === NormalBalance.DEBIT
              ? debitCents - creditCents
              : creditCents - debitCents;
          runningBalanceCents += delta;
        }

        // Resolve deep-link route for source sub-ledger document
        let sourceHref = '/ledger';
        const refType = line.journalEntry.referenceType;
        if (refType === 'INVOICE' || refType === 'PAYMENT_IN' || refType === 'CREDIT_NOTE') {
          sourceHref = '/invoices';
        } else if (refType === 'BILL' || refType === 'PAYMENT_OUT' || refType === 'VENDOR_CREDIT') {
          sourceHref = '/bills';
        } else if (refType === 'DIRECT_TRANSACTION' || refType === 'EXPENSE_CLAIM' || refType === 'EXPENSE_REIMBURSEMENT') {
          sourceHref = '/expenses';
        } else if (refType === 'BANK_TRANSFER') {
          sourceHref = '/banking';
        }

        return {
          id: line.id,
          journalEntryId: line.journalEntryId,
          entryNumber: line.journalEntry.entryNumber,
          postedAt: line.journalEntry.postedAt,
          referenceType: refType,
          referenceId: line.journalEntry.referenceId,
          sourceHref,
          isReconciled: line.journalEntry.isReconciled,
          accountId: line.account.id,
          accountCode: line.account.code,
          accountName: line.account.name,
          accountType: line.account.type,
          trackingOptionId: line.trackingOption?.id ?? null,
          trackingOptionName: line.trackingOption?.name ?? null,
          description: line.description || line.journalEntry.description,
          journalDescription: line.journalEntry.description,
          debitCents,
          creditCents,
          runningBalanceCents: selectedAccount ? runningBalanceCents : null,
        };
      });

      return reply.send(
        serialize({
          account: selectedAccount,
          openingBalanceCents,
          closingBalanceCents: selectedAccount ? runningBalanceCents : null,
          totalDebitsCents,
          totalCreditsCents,
          count: transactions.length,
          transactions,
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // 18.2 Bank Rules CRUD & Auto-Apply
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/bookkeeping/bank-rules',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AUDITOR)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const rules = await fastify.prisma.bankRule.findMany({
        where: { organizationId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      });
      return reply.send({ rules });
    },
  );

  fastify.post(
    '/api/v1/bookkeeping/bank-rules',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = BankRuleBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid bank rule.' });
      }

      const data = parsed.data;
      const account = await fastify.prisma.account.findFirst({
        where: { id: data.accountId, organizationId, isActive: true },
        select: { id: true, code: true, name: true },
      });
      if (!account) {
        return reply.code(400).send({ error: 'Selected GL account does not exist or is inactive.' });
      }

      const rule = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.bankRule.create({
          data: {
            organizationId,
            name: data.name,
            direction: data.direction,
            matchField: data.matchField,
            matchType: data.matchType,
            matchValue: data.matchValue,
            contactId: data.contactId ?? null,
            accountId: data.accountId,
            trackingOptionId: data.trackingOptionId ?? null,
            taxTreatment: data.taxTreatment,
            priority: data.priority,
            isActive: data.isActive,
            createdByUserId: request.user.userId,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BANK_RULE_CREATED',
          entityType: 'BANK_RULE',
          entityId: created.id,
          summary: `Created bank rule "${created.name}" (${created.direction}: ${created.matchField} ${created.matchType} "${created.matchValue}" → ${account.code} ${account.name}).`,
        });

        return created;
      });

      return reply.code(201).send({ rule });
    },
  );

  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/bookkeeping/bank-rules/:id',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = BankRuleBodySchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid update payload.' });
      }

      const existing = await fastify.prisma.bankRule.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'Bank rule not found.' });
      }

      const updated = await fastify.prisma.bankRule.update({
        where: { id: existing.id },
        data: parsed.data,
      });

      return reply.send({ rule: updated });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/bookkeeping/bank-rules/:id',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const existing = await fastify.prisma.bankRule.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'Bank rule not found.' });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.bankRule.delete({ where: { id: existing.id } });
        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BANK_RULE_DELETED',
          entityType: 'BANK_RULE',
          entityId: existing.id,
          summary: `Deleted bank rule "${existing.name}".`,
        });
      });

      return reply.send({ ok: true });
    },
  );

  fastify.post<{ Body: { bankAccountId?: string } }>(
    '/api/v1/bookkeeping/bank-rules/apply',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const bankAccountId = request.body?.bankAccountId;

      const [rules, lines] = await Promise.all([
        fastify.prisma.bankRule.findMany({
          where: { organizationId, isActive: true },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        }),
        fastify.prisma.bankStatementLine.findMany({
          where: {
            organizationId,
            isReconciled: false,
            ...(bankAccountId ? { bankAccountId } : {}),
          },
        }),
      ]);

      let matchedCount = 0;
      await fastify.prisma.$transaction(async (tx) => {
        for (const line of lines) {
          const hit = rules.find((r) => matchesBankRule(r, line));
          if (!hit) continue;
          await tx.bankStatementLine.update({
            where: { id: line.id },
            data: {
              suggestedContactId: hit.contactId ?? line.suggestedContactId,
              suggestedAccountId: hit.accountId,
              suggestedTrackingOptionId: hit.trackingOptionId ?? line.suggestedTrackingOptionId,
              suggestedTaxTreatment: hit.taxTreatment,
            },
          });
          matchedCount++;
        }
      });

      return reply.send({
        ok: true,
        scannedLines: lines.length,
        matchedCount,
      });
    },
  );

  // -------------------------------------------------------------------------
  // 18.2b POST /api/v1/bookkeeping/cash-coding/reconcile
  // Bulk Cash Coding Reconciliation (atomic DirectTransaction + GL + Reconcile)
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/bookkeeping/cash-coding/reconcile',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = CashCodingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid cash coding payload.' });
      }

      const [gstCollectedAcc, gstPaidAcc] = await Promise.all([
        fastify.prisma.account.findFirst({ where: { organizationId, code: '2100' }, select: { id: true } }),
        fastify.prisma.account.findFirst({ where: { organizationId, code: '2200' }, select: { id: true } }),
      ]);

      if (!gstCollectedAcc || !gstPaidAcc) {
        return reply.code(400).send({ error: 'System GST accounts (2100/2200) are missing.' });
      }

      try {
        const reconciledCount = await fastify.prisma.$transaction(async (tx) => {
          let count = 0;
          for (const item of parsed.data.items) {
            const stmtLine = await tx.bankStatementLine.findFirst({
              where: { id: item.statementLineId, organizationId },
            });
            if (!stmtLine || stmtLine.isReconciled) {
              throw new Error(`Statement line ${item.statementLineId} is missing or already reconciled.`);
            }

            const lockCheck = await checkOrganizationLockDate(tx, organizationId, stmtLine.statementDate);
            if (lockCheck.locked) throw new Error(lockCheck.message);

            const isSpend = stmtLine.amountCents < 0n;
            const grossAbs = isSpend ? -stmtLine.amountCents : stmtLine.amountCents;
            const gstCalc = calculateGST(grossAbs, item.taxTreatment);
            // If TAX_EXCLUSIVE was chosen for a bank line, treat grossAbs as total paid/received
            const subtotalCents =
              item.taxTreatment === TaxTreatment.TAX_EXCLUSIVE
                ? (grossAbs * 10n) / 11n
                : gstCalc.subtotalCents;
            const gstCents =
              item.taxTreatment === TaxTreatment.TAX_EXCLUSIVE
                ? grossAbs - subtotalCents
                : gstCalc.gstCents;
            const totalCents = grossAbs;

            let payeeName: string | null = stmtLine.description.slice(0, 120);
            if (item.contactId) {
              const c = await tx.contact.findFirst({
                where: { id: item.contactId, organizationId },
                select: { name: true },
              });
              if (c) payeeName = c.name;
            }

            const directTx = await tx.directTransaction.create({
              data: {
                organizationId,
                type: isSpend
                  ? DirectTransactionType.SPEND_MONEY
                  : DirectTransactionType.RECEIVE_MONEY,
                bankAccountId: stmtLine.bankAccountId,
                contactId: item.contactId ?? null,
                payeeName,
                transactionDate: stmtLine.statementDate,
                reference: stmtLine.reference,
                subtotalCents,
                gstCents,
                totalCents,
                notes: item.description || `Cash coded: ${stmtLine.description}`,
                createdByUserId: request.user.userId,
                lines: {
                  create: [
                    {
                      organizationId,
                      accountId: item.accountId,
                      trackingOptionId: item.trackingOptionId ?? null,
                      description: item.description || stmtLine.description,
                      amountCents: subtotalCents,
                      taxTreatment: item.taxTreatment,
                      gstCents,
                      totalCents,
                    },
                  ],
                },
              },
            });

            const journalLines: JournalLineInput[] = [];
            if (isSpend) {
              journalLines.push({
                accountId: item.accountId,
                trackingOptionId: item.trackingOptionId ?? null,
                entryType: EntryType.DEBIT,
                amountCents: subtotalCents,
                description: item.description || stmtLine.description,
              });
              if (gstCents > 0n) {
                journalLines.push({
                  accountId: gstPaidAcc.id,
                  entryType: EntryType.DEBIT,
                  amountCents: gstCents,
                  description: 'GST Paid (Cash Coding)',
                });
              }
              journalLines.push({
                accountId: stmtLine.bankAccountId,
                entryType: EntryType.CREDIT,
                amountCents: totalCents,
                description: `Bank withdrawal: ${stmtLine.description}`,
              });
            } else {
              journalLines.push({
                accountId: stmtLine.bankAccountId,
                entryType: EntryType.DEBIT,
                amountCents: totalCents,
                description: `Bank deposit: ${stmtLine.description}`,
              });
              journalLines.push({
                accountId: item.accountId,
                trackingOptionId: item.trackingOptionId ?? null,
                entryType: EntryType.CREDIT,
                amountCents: subtotalCents,
                description: item.description || stmtLine.description,
              });
              if (gstCents > 0n) {
                journalLines.push({
                  accountId: gstCollectedAcc.id,
                  entryType: EntryType.CREDIT,
                  amountCents: gstCents,
                  description: 'GST Collected (Cash Coding)',
                });
              }
            }

            const journal = await postJournalEntry(tx, {
              organizationId,
              actorUserId: request.user.userId,
              description: `Cash Coding: ${payeeName || stmtLine.description}`,
              referenceType: 'DIRECT_TRANSACTION',
              referenceId: directTx.id,
              postedAt: stmtLine.statementDate,
              lines: journalLines,
              skipAuditLog: true,
            });

            await tx.journalEntry.update({
              where: { id: journal.id },
              data: { isReconciled: true, reconciledAt: new Date() },
            });

            await tx.bankStatementLine.update({
              where: { id: stmtLine.id },
              data: {
                isReconciled: true,
                matchedJournalId: journal.id,
                reconciledAt: new Date(),
                reconciledByUserId: request.user.userId,
              },
            });

            count++;
          }

          await recordAuditLog(tx, {
            organizationId,
            actorUserId: request.user.userId,
            action: 'CASH_CODING_BULK_RECONCILE',
            entityType: 'BANK_STATEMENT_LINE',
            entityId: organizationId,
            summary: `Bulk cash-coded and reconciled ${count} bank statement line(s).`,
          });

          return count;
        });

        return reply.send({ ok: true, reconciledCount });
      } catch (err: any) {
        return reply.code(400).send({ error: err.message || 'Bulk cash coding failed.' });
      }
    },
  );

  // -------------------------------------------------------------------------
  // 18.3 POST /api/v1/bookkeeping/reconciliation/split-match
  // Match 1 Bank Statement Line to Multiple Invoices/Bills + Inline Fee/Rounding
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/bookkeeping/reconciliation/split-match',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = SplitMatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid split match payload.' });
      }

      const { statementLineId, mode, allocations, adjustment } = parsed.data;

      try {
        const result = await fastify.prisma.$transaction(async (tx) => {
          const stmtLine = await tx.bankStatementLine.findFirst({
            where: { id: statementLineId, organizationId },
          });
          if (!stmtLine) throw new Error('Bank statement line not found.');
          if (stmtLine.isReconciled) throw new Error('Bank statement line is already reconciled.');

          const lockCheck = await checkOrganizationLockDate(tx, organizationId, stmtLine.statementDate);
          if (lockCheck.locked) throw new Error(lockCheck.message);

          const isInflow = stmtLine.amountCents > 0n;
          if (mode === 'INVOICES' && !isInflow) {
            throw new Error('Matching customer invoices requires a positive bank deposit line.');
          }
          if (mode === 'BILLS' && isInflow) {
            throw new Error('Matching vendor bills requires a negative bank withdrawal line.');
          }

          const bankAbsCents = isInflow ? stmtLine.amountCents : -stmtLine.amountCents;
          const totalAllocatedCents = allocations.reduce(
            (sum, a) => sum + BigInt(a.amountCents),
            0n,
          );
          const adjCents = BigInt(adjustment?.amountCents ?? 0);

          // For INVOICES (inflow): Bank Deposit = Sum(Invoice Settlements) - Merchant Fee
          // So Bank Deposit + Merchant Fee == Sum(Invoice Settlements)
          // For BILLS (outflow): Bank Withdrawal = Sum(Bill Settlements) + Bank Fee
          const expectedBankCents =
            mode === 'INVOICES'
              ? totalAllocatedCents - adjCents
              : totalAllocatedCents + adjCents;

          if (expectedBankCents !== bankAbsCents) {
            throw new Error(
              `Split total mismatch: bank line is $${(Number(bankAbsCents) / 100).toFixed(2)}, but allocations ${mode === 'INVOICES' ? 'minus' : 'plus'} adjustment equal $${(Number(expectedBankCents) / 100).toFixed(2)}.`,
            );
          }

          const [arAcc, apAcc, gstPaidAcc] = await Promise.all([
            tx.account.findFirst({ where: { organizationId, code: '1200' }, select: { id: true } }),
            tx.account.findFirst({ where: { organizationId, code: '2000' }, select: { id: true } }),
            tx.account.findFirst({ where: { organizationId, code: '2200' }, select: { id: true } }),
          ]);

          const journalLines: JournalLineInput[] = [];

          if (mode === 'INVOICES') {
            if (!arAcc) throw new Error('System account 1200 Accounts Receivable not found.');

            journalLines.push({
              accountId: stmtLine.bankAccountId,
              entryType: EntryType.DEBIT,
              amountCents: bankAbsCents,
              description: `Split bank deposit: ${stmtLine.description}`,
            });

            if (adjCents !== 0n && adjustment) {
              const feeAbs = adjCents > 0n ? adjCents : -adjCents;
              const feeGst =
                adjustment.taxTreatment === TaxTreatment.TAX_INCLUSIVE
                  ? feeAbs - (feeAbs * 10n) / 11n
                  : 0n;
              const feeNet = feeAbs - feeGst;
              journalLines.push({
                accountId: adjustment.accountId,
                trackingOptionId: adjustment.trackingOptionId ?? null,
                entryType: adjCents > 0n ? EntryType.DEBIT : EntryType.CREDIT,
                amountCents: feeNet,
                description: adjustment.description || 'Merchant / Bank Fee Adjustment',
              });
              if (feeGst > 0n && gstPaidAcc) {
                journalLines.push({
                  accountId: gstPaidAcc.id,
                  entryType: adjCents > 0n ? EntryType.DEBIT : EntryType.CREDIT,
                  amountCents: feeGst,
                  description: 'GST on Bank/Merchant Fee',
                });
              }
            }

            for (const alloc of allocations) {
              const inv = await tx.invoice.findFirst({
                where: { id: alloc.documentId, organizationId },
              });
              if (!inv) throw new Error(`Invoice ${alloc.documentId} not found.`);
              const allocBig = BigInt(alloc.amountCents);
              const remaining = inv.totalCents - inv.amountPaidCents;
              if (allocBig > remaining) {
                throw new Error(`Allocation exceeds balance due on ${inv.invoiceNumber}.`);
              }

              await tx.paymentIn.create({
                data: {
                  organizationId,
                  invoiceId: inv.id,
                  contactId: inv.contactId,
                  receiptType: PaymentReceiptType.INVOICE_PAYMENT,
                  bankAccountId: stmtLine.bankAccountId,
                  paymentDate: stmtLine.statementDate,
                  amountCents: allocBig,
                  reference: stmtLine.reference || `Split Rec: ${inv.invoiceNumber}`,
                },
              });

              const nextPaid = inv.amountPaidCents + allocBig;
              await tx.invoice.update({
                where: { id: inv.id },
                data: {
                  amountPaidCents: nextPaid,
                  status:
                    nextPaid >= inv.totalCents
                      ? InvoiceStatus.PAID
                      : InvoiceStatus.PARTIALLY_PAID,
                },
              });

              journalLines.push({
                accountId: arAcc.id,
                entryType: EntryType.CREDIT,
                amountCents: allocBig,
                description: `Payment received for ${inv.invoiceNumber}`,
              });
            }
          } else {
            if (!apAcc) throw new Error('System account 2000 Accounts Payable not found.');

            for (const alloc of allocations) {
              const bill = await tx.bill.findFirst({
                where: { id: alloc.documentId, organizationId },
              });
              if (!bill) throw new Error(`Bill ${alloc.documentId} not found.`);
              const allocBig = BigInt(alloc.amountCents);
              const remaining = bill.totalCents - bill.amountPaidCents;
              if (allocBig > remaining) {
                throw new Error(`Allocation exceeds balance due on bill ${bill.reference || bill.id}.`);
              }

              await tx.paymentOut.create({
                data: {
                  organizationId,
                  billId: bill.id,
                  bankAccountId: stmtLine.bankAccountId,
                  paymentDate: stmtLine.statementDate,
                  amountCents: allocBig,
                  reference: stmtLine.reference || `Split Rec: ${bill.reference || 'Bill'}`,
                },
              });

              const nextPaid = bill.amountPaidCents + allocBig;
              await tx.bill.update({
                where: { id: bill.id },
                data: {
                  amountPaidCents: nextPaid,
                  status:
                    nextPaid >= bill.totalCents
                      ? BillStatus.PAID
                      : BillStatus.PARTIALLY_PAID,
                },
              });

              journalLines.push({
                accountId: apAcc.id,
                entryType: EntryType.DEBIT,
                amountCents: allocBig,
                description: `Payment out for bill ${bill.reference || bill.id}`,
              });
            }

            if (adjCents !== 0n && adjustment) {
              const feeAbs = adjCents > 0n ? adjCents : -adjCents;
              const feeGst =
                adjustment.taxTreatment === TaxTreatment.TAX_INCLUSIVE
                  ? feeAbs - (feeAbs * 10n) / 11n
                  : 0n;
              const feeNet = feeAbs - feeGst;
              journalLines.push({
                accountId: adjustment.accountId,
                trackingOptionId: adjustment.trackingOptionId ?? null,
                entryType: adjCents > 0n ? EntryType.DEBIT : EntryType.CREDIT,
                amountCents: feeNet,
                description: adjustment.description || 'Bank Fee / Rounding Adjustment',
              });
              if (feeGst > 0n && gstPaidAcc) {
                journalLines.push({
                  accountId: gstPaidAcc.id,
                  entryType: adjCents > 0n ? EntryType.DEBIT : EntryType.CREDIT,
                  amountCents: feeGst,
                  description: 'GST on Bank Fee',
                });
              }
            }

            journalLines.push({
              accountId: stmtLine.bankAccountId,
              entryType: EntryType.CREDIT,
              amountCents: bankAbsCents,
              description: `Split bank payment: ${stmtLine.description}`,
            });
          }

          const journal = await postJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: `Split Reconciliation (${allocations.length} ${mode.toLowerCase()}): ${stmtLine.description}`,
            referenceType: mode === 'INVOICES' ? 'PAYMENT_IN' : 'PAYMENT_OUT',
            referenceId: stmtLine.id,
            postedAt: stmtLine.statementDate,
            lines: journalLines,
          });

          await tx.journalEntry.update({
            where: { id: journal.id },
            data: { isReconciled: true, reconciledAt: new Date() },
          });

          await tx.bankStatementLine.update({
            where: { id: stmtLine.id },
            data: {
              isReconciled: true,
              matchedJournalId: journal.id,
              reconciledAt: new Date(),
              reconciledByUserId: request.user.userId,
            },
          });

          return { journalId: journal.id, entryNumber: journal.entryNumber };
        });

        return reply.send({ ok: true, ...result });
      } catch (err: any) {
        return reply.code(400).send({ error: err.message || 'Split match reconciliation failed.' });
      }
    },
  );

  // -------------------------------------------------------------------------
  // 18.4 GET /api/v1/bookkeeping/reconciliation/summary
  // Formal Bank Reconciliation Proof (Statement vs GL) + Duplicate Detector
  // -------------------------------------------------------------------------
  fastify.get<{ Querystring: { bankAccountId?: string; asOfDate?: string } }>(
    '/api/v1/bookkeeping/reconciliation/summary',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AUDITOR)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const asOfDateStr = request.query.asOfDate ?? new Date().toISOString().slice(0, 10);
      const asOfEnd = new Date(`${asOfDateStr}T23:59:59.999Z`);

      const bankAccount = request.query.bankAccountId
        ? await fastify.prisma.account.findFirst({
            where: { id: request.query.bankAccountId, organizationId },
          })
        : await fastify.prisma.account.findFirst({
            where: {
              organizationId,
              isActive: true,
              OR: [{ isBankAccount: true }, { code: '1000' }],
            },
            orderBy: { code: 'asc' },
          });

      if (!bankAccount) {
        return reply.code(404).send({ error: 'Bank account not found.' });
      }

      const [journalLines, stmtLines] = await Promise.all([
        fastify.prisma.journalLine.findMany({
          where: {
            organizationId,
            accountId: bankAccount.id,
            journalEntry: {
              status: JournalStatus.POSTED,
              postedAt: { lte: asOfEnd },
            },
          },
          include: {
            journalEntry: {
              select: {
                id: true,
                entryNumber: true,
                description: true,
                postedAt: true,
                isReconciled: true,
                referenceType: true,
              },
            },
          },
          orderBy: { journalEntry: { postedAt: 'desc' } },
        }),
        fastify.prisma.bankStatementLine.findMany({
          where: {
            organizationId,
            bankAccountId: bankAccount.id,
            statementDate: { lte: asOfEnd },
          },
          orderBy: { statementDate: 'desc' },
        }),
      ]);

      let ledgerBalanceCents = 0n;
      let reconciledLedgerCents = 0n;
      let unreconciledDepositsCents = 0n;
      let unreconciledPaymentsCents = 0n;

      const unreconciledLedgerItems: Array<{
        id: string;
        entryNumber: string | null;
        postedAt: Date;
        description: string;
        amountCents: bigint;
      }> = [];

      for (const jl of journalLines) {
        const signed = jl.entryType === EntryType.DEBIT ? jl.amountCents : -jl.amountCents;
        ledgerBalanceCents += signed;
        if (jl.journalEntry.isReconciled) {
          reconciledLedgerCents += signed;
        } else {
          if (signed >= 0n) unreconciledDepositsCents += signed;
          else unreconciledPaymentsCents += -signed;
          unreconciledLedgerItems.push({
            id: jl.journalEntry.id,
            entryNumber: jl.journalEntry.entryNumber,
            postedAt: jl.journalEntry.postedAt,
            description: jl.description || jl.journalEntry.description,
            amountCents: signed,
          });
        }
      }

      let statementImportedBalanceCents = 0n;
      let reconciledStatementCents = 0n;
      const unreconciledStatementLines: typeof stmtLines = [];

      // Duplicate detection key: YYYY-MM-DD|amountCents|normalizedDescription
      const dupMap = new Map<string, string[]>();
      for (const sl of stmtLines) {
        statementImportedBalanceCents += sl.amountCents;
        if (sl.isReconciled) {
          reconciledStatementCents += sl.amountCents;
        } else {
          unreconciledStatementLines.push(sl);
        }

        const key = `${sl.statementDate.toISOString().slice(0, 10)}|${sl.amountCents.toString()}|${sl.description.trim().toLowerCase()}`;
        const list = dupMap.get(key) ?? [];
        list.push(sl.id);
        dupMap.set(key, list);
      }

      const duplicateStatementLineIds = Array.from(dupMap.values())
        .filter((ids) => ids.length > 1)
        .flat();

      const varianceCents = reconciledStatementCents - reconciledLedgerCents;

      return reply.send(
        serialize({
          asOfDate: asOfDateStr,
          bankAccount: {
            id: bankAccount.id,
            code: bankAccount.code,
            name: bankAccount.name,
            bankBsb: bankAccount.bankBsb,
            bankAccountNumber: bankAccount.bankAccountNumber,
          },
          summary: {
            statementImportedBalanceCents,
            reconciledStatementCents,
            ledgerBalanceCents,
            reconciledLedgerCents,
            unreconciledDepositsCents,
            unreconciledPaymentsCents,
            varianceCents,
            isBalanced: varianceCents === 0n && unreconciledStatementLines.length === 0,
          },
          unreconciledStatementCount: unreconciledStatementLines.length,
          unreconciledLedgerCount: unreconciledLedgerItems.length,
          duplicateStatementLineIds,
          unreconciledStatementLines: unreconciledStatementLines.slice(0, 100),
          unreconciledLedgerItems: unreconciledLedgerItems.slice(0, 100),
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // 18.5a GET /api/v1/bookkeeping/find-recode/preview
  // & POST /api/v1/bookkeeping/find-recode/apply
  // -------------------------------------------------------------------------
  fastify.get<{
    Querystring: {
      accountId?: string;
      trackingOptionId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    };
  }>(
    '/api/v1/bookkeeping/find-recode/preview',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { accountId, trackingOptionId, startDate, endDate, search } = request.query;

      const startDt = startDate ? new Date(`${startDate}T00:00:00.000Z`) : null;
      const endDt = endDate ? new Date(`${endDate}T23:59:59.999Z`) : null;

      const lines = await fastify.prisma.journalLine.findMany({
        where: {
          organizationId,
          ...(accountId ? { accountId } : {}),
          ...(trackingOptionId ? { trackingOptionId } : {}),
          account: { isSystem: false }, // Never bulk-recode protected system control lines directly
          journalEntry: {
            status: JournalStatus.POSTED,
            ...(startDt || endDt
              ? {
                  postedAt: {
                    ...(startDt ? { gte: startDt } : {}),
                    ...(endDt ? { lte: endDt } : {}),
                  },
                }
              : {}),
          },
          ...(search && search.trim()
            ? {
                OR: [
                  { description: { contains: search.trim(), mode: 'insensitive' } },
                  {
                    journalEntry: {
                      description: { contains: search.trim(), mode: 'insensitive' },
                    },
                  },
                ],
              }
            : {}),
        },
        take: 150,
        orderBy: { journalEntry: { postedAt: 'desc' } },
        include: {
          account: { select: { id: true, code: true, name: true, type: true } },
          trackingOption: { select: { id: true, name: true } },
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              description: true,
              postedAt: true,
              referenceType: true,
            },
          },
        },
      });

      return reply.send(serialize({ lines }));
    },
  );

  fastify.post(
    '/api/v1/bookkeeping/find-recode/apply',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = FindRecodeApplySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid recode request.' });
      }

      const { lineIds, targetAccountId, targetTrackingOptionId, effectiveDate, reason } =
        parsed.data;
      if (!targetAccountId && targetTrackingOptionId === undefined) {
        return reply.code(400).send({
          error: 'Specify at least a target GL account or a target cost centre.',
        });
      }

      const postedAt = new Date(`${effectiveDate}T00:00:00.000Z`);

      try {
        const journal = await fastify.prisma.$transaction(async (tx) => {
          const lockCheck = await checkOrganizationLockDate(tx, organizationId, postedAt);
          if (lockCheck.locked) throw new Error(lockCheck.message);

          const sourceLines = await tx.journalLine.findMany({
            where: {
              id: { in: lineIds },
              organizationId,
              journalEntry: { status: JournalStatus.POSTED },
            },
            include: {
              account: { select: { id: true, code: true, name: true, isSystem: true } },
              journalEntry: { select: { entryNumber: true } },
            },
          });

          if (sourceLines.length === 0) {
            throw new Error('No posted journal lines matched the selection.');
          }

          const reclassLines: JournalLineInput[] = [];
          for (const sl of sourceLines) {
            if (sl.account.isSystem) {
              throw new Error(`Cannot bulk-recode protected system account ${sl.account.code}.`);
            }
            const nextAccountId = targetAccountId ?? sl.accountId;
            const nextTrackingId =
              targetTrackingOptionId !== undefined
                ? targetTrackingOptionId
                : sl.trackingOptionId;

            if (nextAccountId === sl.accountId && nextTrackingId === sl.trackingOptionId) {
              continue;
            }

            // Reverse original coding
            reclassLines.push({
              accountId: sl.accountId,
              trackingOptionId: sl.trackingOptionId,
              entryType: sl.entryType === EntryType.DEBIT ? EntryType.CREDIT : EntryType.DEBIT,
              amountCents: sl.amountCents,
              description: `Recode out (${sl.journalEntry.entryNumber ?? 'JNL'}): ${reason}`,
            });

            // Apply new coding
            reclassLines.push({
              accountId: nextAccountId,
              trackingOptionId: nextTrackingId,
              entryType: sl.entryType,
              amountCents: sl.amountCents,
              description: `Recode in (${sl.journalEntry.entryNumber ?? 'JNL'}): ${reason}`,
            });
          }

          if (reclassLines.length < 2) {
            throw new Error('All selected lines already match the target account and cost centre.');
          }

          const created = await postJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: `Find & Recode (${reclassLines.length / 2} lines): ${reason}`,
            referenceType: 'FIND_AND_RECODE',
            referenceId: organizationId,
            postedAt,
            lines: reclassLines,
          });

          return created;
        });

        return reply.send(
          serialize({
            ok: true,
            journalId: journal.id,
            entryNumber: journal.entryNumber,
            recodedLineCount: lineIds.length,
          }),
        );
      } catch (err: any) {
        return reply.code(400).send({ error: err.message || 'Find & Recode failed.' });
      }
    },
  );

  // -------------------------------------------------------------------------
  // 18.5b POST /api/v1/bookkeeping/conversion-balances
  // Guided Opening / Conversion Balances Posting
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/bookkeeping/conversion-balances',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = ConversionBalancesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid conversion balances.' });
      }

      const { conversionDate, notes, lines } = parsed.data;
      const postedAt = new Date(`${conversionDate}T00:00:00.000Z`);

      const journalLines: JournalLineInput[] = [];
      for (const l of lines) {
        if (l.debitCents > 0 && l.creditCents > 0) {
          return reply.code(400).send({
            error: 'Each account row must have either a Debit OR a Credit opening balance, not both.',
          });
        }
        if (l.debitCents > 0) {
          journalLines.push({
            accountId: l.accountId,
            entryType: EntryType.DEBIT,
            amountCents: BigInt(l.debitCents),
            description: `Conversion balance as at ${conversionDate}`,
          });
        } else if (l.creditCents > 0) {
          journalLines.push({
            accountId: l.accountId,
            entryType: EntryType.CREDIT,
            amountCents: BigInt(l.creditCents),
            description: `Conversion balance as at ${conversionDate}`,
          });
        }
      }

      try {
        const journal = await fastify.prisma.$transaction(async (tx) => {
          return postJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: notes
              ? `Conversion Balances (${conversionDate}) — ${notes}`
              : `Opening Conversion Balances as at ${conversionDate}`,
            referenceType: 'CONVERSION_BALANCE',
            referenceId: organizationId,
            postedAt,
            lines: journalLines,
          });
        });

        return reply.code(201).send(
          serialize({
            ok: true,
            journalId: journal.id,
            entryNumber: journal.entryNumber,
          }),
        );
      } catch (err: any) {
        return reply.code(400).send({ error: err.message || 'Failed to post conversion balances.' });
      }
    },
  );
};

export default bookkeepingRoutes;
