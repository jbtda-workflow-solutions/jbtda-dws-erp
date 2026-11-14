/**
 * Banking, Inter-Account Transfers & Statement Reconciliation Routes — Module 7
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET    /api/v1/banking/accounts                    (List bank & card accounts with ledger & reconciled balances)
 *  - PATCH  /api/v1/banking/accounts/:id                (Update bank details or bank account flag)
 *  - GET    /api/v1/banking/transfers                   (List inter-account money transfers)
 *  - POST   /api/v1/banking/transfers                   (Create transfer + atomic 2-line GL journal)
 *  - POST   /api/v1/banking/statements/import           (Upload / parse CSV statement lines)
 *  - GET    /api/v1/banking/statements                  (List imported statement lines with filters)
 *  - DELETE /api/v1/banking/statements/:id              (Delete unreconciled statement line)
 *  - GET    /api/v1/banking/reconciliation/suggestions  (Find smart matches between statement lines & ledger entries)
 *  - POST   /api/v1/banking/reconciliation/match        (1-Click match statement line to journal entry)
 *  - POST   /api/v1/banking/reconciliation/unmatch      (Reopen / unmatch reconciliation)
 *  - POST   /api/v1/banking/reconciliation/create-and-reconcile (On-the-fly spend/receive money & reconcile)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { calculateGST } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import {
  checkOrganizationLockDate,
  postJournalEntry,
  reverseJournalEntry,
} from '../lib/ledger-posting.js';
import {
  AccountType,
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

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);

function serializeData<T>(data: T): any {
  if (data === null || data === undefined) return null;
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

// ---------------------------------------------------------------------------
// CSV Statement Parser Helper
// ---------------------------------------------------------------------------

interface ParsedStatementRow {
  rowNumber: number;
  statementDate: Date;
  description: string;
  reference?: string | null;
  amountCents: bigint;
  rawContactName?: string | null;
  rawAccountCodeOrName?: string | null;
  rawTrackingOptionName?: string | null;
  rawTaxTreatment?: string | null;
}

function parseTaxTreatmentString(raw: string | null | undefined): {
  valid: boolean;
  value: TaxTreatment | null;
} {
  if (!raw || !raw.trim()) return { valid: true, value: null };
  const norm = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['TAX_EXCLUSIVE', 'EXCLUSIVE', 'GST_EXCLUSIVE', 'EX_GST', 'GST_ON_INCOME', 'GST_ON_EXPENSES', '10%_GST'].includes(norm)) {
    return { valid: true, value: TaxTreatment.TAX_EXCLUSIVE };
  }
  if (['TAX_INCLUSIVE', 'INCLUSIVE', 'GST_INCLUSIVE', 'INC_GST', 'GST'].includes(norm)) {
    return { valid: true, value: TaxTreatment.TAX_INCLUSIVE };
  }
  if (['GST_FREE', 'FREE', 'ZERO', '0%', 'NO_GST', 'BAS_EXCLUDED', 'EXEMPT', 'NONE', 'INPUT_TAXED', 'INPUT'].includes(norm)) {
    return { valid: true, value: TaxTreatment.GST_FREE };
  }
  return { valid: false, value: null };
}

function parseAustralianDate(dateStr: string): Date | null {
  const clean = dateStr.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const d = new Date(`${clean}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const parts = clean.split(/[/.-]/);
  if (parts.length === 3) {
    let day = parseInt(parts[0]!, 10);
    let month = parseInt(parts[1]!, 10);
    let year = parseInt(parts[2]!, 10);

    // If year is 2 digits e.g. 24 -> 2024
    if (year < 100) year += 2000;

    // Sanity check DD/MM vs MM/DD: in Australia, first component is Day
    if (month > 12 && day <= 12) {
      const temp = day;
      day = month;
      month = temp;
    }

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1970) {
      const d = new Date(Date.UTC(year, month - 1, day));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const fallback = new Date(clean);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function parseAmountStringToCents(amountStr: string): bigint | null {
  let clean = amountStr.trim().replace(/[$,\s]/g, '');
  if (!clean) return null;

  let isNegative = false;
  if (clean.startsWith('(') && clean.endsWith(')')) {
    isNegative = true;
    clean = clean.slice(1, -1);
  } else if (clean.startsWith('-')) {
    isNegative = true;
    clean = clean.slice(1);
  } else if (clean.startsWith('+')) {
    clean = clean.slice(1);
  }

  const num = parseFloat(clean);
  if (isNaN(num)) return null;

  const cents = BigInt(Math.round(num * 100));
  return isNegative ? -cents : cents;
}

export function parseStatementCsv(csvContent: string): ParsedStatementRow[] {
  const lines = csvContent
    .replace(/^\uFEFF/, '') // remove UTF-8 BOM
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV file must contain at least a header row and one transaction row.');
  }

  // Parse header
  const headerLine = lines[0]!;
  const delimiter = headerLine.includes('\t') ? '\t' : ',';

  // Naive CSV tokenizer that respects quotes
  const tokenize = (row: string): string[] => {
    const tokens: string[] = [];
    let insideQuotes = false;
    let currentToken = '';

    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"' || char === "'") {
        insideQuotes = !insideQuotes;
      } else if (char === delimiter && !insideQuotes) {
        tokens.push(currentToken.trim().replace(/^["']|["']$/g, ''));
        currentToken = '';
      } else {
        currentToken += char;
      }
    }
    tokens.push(currentToken.trim().replace(/^["']|["']$/g, ''));
    return tokens;
  };

  const headers = tokenize(headerLine).map((h) => h.toLowerCase().trim());

  let dateCol = -1;
  let descCol = -1;
  let refCol = -1;
  let amountCol = -1;
  let debitCol = -1;
  let creditCol = -1;
  let contactCol = -1;
  let accountCol = -1;
  let trackingCol = -1;
  let taxCol = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    if (['date', 'statement date', 'transaction date', 'posted date', 'tran date', 'effective date', 'statement_date', 'transaction_date'].includes(h)) {
      dateCol = i;
    } else if (['description', 'narrative', 'details', 'particulars', 'memo', 'transaction details', 'transaction_details'].includes(h)) {
      descCol = i;
    } else if (['reference', 'ref', 'reference number', 'cheque number', 'receipt', 'reference_number'].includes(h)) {
      refCol = i;
    } else if (['amount', 'value', 'tran amount', 'net amount', 'amount_cents', 'tran_amount'].includes(h)) {
      amountCol = i;
    } else if (['debit', 'withdrawal', 'dr', 'debit amount', 'debit_amount'].includes(h)) {
      debitCol = i;
    } else if (['credit', 'deposit', 'cr', 'credit amount', 'credit_amount'].includes(h)) {
      creditCol = i;
    } else if (['contact', 'merchant', 'supplier', 'vendor', 'customer', 'payee', 'contact_name', 'supplier_name', 'merchant_name'].includes(h)) {
      contactCol = i;
    } else if (['account', 'account code', 'account_code', 'gl account', 'gl_account', 'account name', 'account_name', 'gl code', 'gl_code'].includes(h)) {
      accountCol = i;
    } else if (['cost centre', 'cost_centre', 'cost center', 'cost_center', 'tracking', 'tracking_option', 'tracking option', 'department', 'project'].includes(h)) {
      trackingCol = i;
    } else if (['tax', 'tax treatment', 'tax_treatment', 'gst', 'tax code', 'tax_code'].includes(h)) {
      taxCol = i;
    }
  }

  if (dateCol === -1) {
    // Fallback: guess first column is date if it looks like one
    dateCol = 0;
  }
  if (descCol === -1) {
    descCol = 1 < headers.length ? 1 : 0;
  }

  const results: ParsedStatementRow[] = [];

  for (let r = 1; r < lines.length; r++) {
    const tokens = tokenize(lines[r]!);
    if (tokens.length <= Math.max(dateCol, descCol)) continue;

    const rawDate = tokens[dateCol] ?? '';
    const parsedDate = parseAustralianDate(rawDate);
    if (!parsedDate) continue;

    const desc = tokens[descCol] ?? 'Imported Transaction';
    const ref = refCol !== -1 && tokens[refCol] ? tokens[refCol]! : null;
    const rawContactName = contactCol !== -1 && tokens[contactCol] ? tokens[contactCol]!.trim() : null;
    const rawAccountCodeOrName = accountCol !== -1 && tokens[accountCol] ? tokens[accountCol]!.trim() : null;
    const rawTrackingOptionName = trackingCol !== -1 && tokens[trackingCol] ? tokens[trackingCol]!.trim() : null;
    const rawTaxTreatment = taxCol !== -1 && tokens[taxCol] ? tokens[taxCol]!.trim() : null;

    let rowCents: bigint | null = null;

    if (amountCol !== -1 && tokens[amountCol]) {
      rowCents = parseAmountStringToCents(tokens[amountCol]!);
    } else if (debitCol !== -1 || creditCol !== -1) {
      const debitRaw = debitCol !== -1 ? tokens[debitCol] : '';
      const creditRaw = creditCol !== -1 ? tokens[creditCol] : '';

      const debitCents = debitRaw ? parseAmountStringToCents(debitRaw) : null;
      const creditCents = creditRaw ? parseAmountStringToCents(creditRaw) : null;

      if (creditCents && creditCents > 0n) {
        rowCents = creditCents;
      } else if (debitCents && debitCents > 0n) {
        rowCents = -debitCents;
      } else if (debitCents && debitCents < 0n) {
        rowCents = debitCents;
      }
    }

    if (rowCents === null || rowCents === 0n) continue;

    results.push({
      rowNumber: r + 1,
      statementDate: parsedDate,
      description: desc.trim() || 'Imported Transaction',
      reference: ref ? ref.trim() : null,
      amountCents: rowCents,
      rawContactName: rawContactName || null,
      rawAccountCodeOrName: rawAccountCodeOrName || null,
      rawTrackingOptionName: rawTrackingOptionName || null,
      rawTaxTreatment: rawTaxTreatment || null,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const UpdateBankAccountBody = z.object({
  isBankAccount: z.boolean().optional(),
  bankBsb: z.string().trim().max(10).nullable().optional(),
  bankAccountNumber: z.string().trim().max(20).nullable().optional(),
  apcaUserId: z.string().trim().max(10).nullable().optional(),
});

const CreateTransferBody = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  transferDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  amountCents: z.number().int().positive(),
  reference: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

const ImportStatementBody = z.object({
  bankAccountId: z.string().uuid(),
  csvContent: z.string().optional(),
  dryRun: z.boolean().optional().default(false),
  lines: z
    .array(
      z.object({
        statementDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
        description: z.string().trim().min(1).max(500),
        reference: z.string().trim().max(100).nullable().optional(),
        amountCents: z.number().int(),
        suggestedContactId: z.string().uuid().nullable().optional(),
        suggestedAccountId: z.string().uuid().nullable().optional(),
        suggestedTrackingOptionId: z.string().uuid().nullable().optional(),
        suggestedTaxTreatment: TaxTreatmentEnum.nullable().optional(),
      }),
    )
    .optional(),
});

const MatchReconciliationBody = z.object({
  statementLineId: z.string().uuid(),
  journalEntryId: z.string().uuid(),
});

const UnmatchReconciliationBody = z.object({
  statementLineId: z.string().uuid(),
});

const ReconciliationModeEnum = z.enum([
  'DIRECT_EXPENSE',
  'DIRECT_INCOME',
  'ALLOCATE_BILL',
  'CREATE_AND_PAY_BILL',
  'ALLOCATE_INVOICE',
  'CREATE_AND_PAY_INVOICE',
]);

const CreateAndReconcileBody = z.object({
  statementLineId: z.string().uuid(),
  mode: ReconciliationModeEnum.optional(),
  contactId: z.string().uuid().nullable().optional(),
  payeeName: z.string().trim().max(255).nullable().optional(),
  targetAccountId: z.string().uuid().nullable().optional(),
  billId: z.string().uuid().nullable().optional(),
  invoiceId: z.string().uuid().nullable().optional(),
  documentReference: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().min(1).max(500).optional(),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.GST_FREE),
  trackingOptionId: z.string().uuid().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Plugin Routes
// ---------------------------------------------------------------------------

export const bankingRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/banking/accounts — Hub overview of all bank & card accounts
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/banking/accounts',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AP_SPECIALIST,
          Role.AR_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      // Retrieve all accounts flagged as bank account or matching standard bank codes
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          isActive: true,
          OR: [
            { isBankAccount: true },
            { code: '1000' },
            { type: AccountType.ASSET, name: { contains: 'Bank', mode: 'insensitive' } },
            { type: AccountType.LIABILITY, name: { contains: 'Card', mode: 'insensitive' } },
          ],
        },
        orderBy: { code: 'asc' },
      });

      if (accounts.length === 0) {
        return reply.send({ accounts: [], totals: { totalLedgerCents: 0, totalReconciledCents: 0 } });
      }

      const accountIds = accounts.map((a) => a.id);

      // Compute ledger balances from posted journal lines
      const [allLines, statementStats] = await Promise.all([
        fastify.prisma.journalLine.findMany({
          where: {
            organizationId,
            accountId: { in: accountIds },
            journalEntry: {
              status: JournalStatus.POSTED,
            },
          },
          select: {
            accountId: true,
            entryType: true,
            amountCents: true,
            journalEntry: {
              select: {
                isReconciled: true,
                reconciledAt: true,
              },
            },
          },
        }),
        fastify.prisma.bankStatementLine.groupBy({
          by: ['bankAccountId', 'isReconciled'],
          where: {
            organizationId,
            bankAccountId: { in: accountIds },
          },
          _count: { id: true },
          _max: { reconciledAt: true },
        }),
      ]);

      // Aggregate balances per account
      const statsMap = new Map<
        string,
        {
          ledgerDebitsCents: bigint;
          ledgerCreditsCents: bigint;
          reconciledDebitsCents: bigint;
          reconciledCreditsCents: bigint;
          lastReconciledAt: Date | null;
        }
      >();

      for (const line of allLines) {
        const cur = statsMap.get(line.accountId) ?? {
          ledgerDebitsCents: 0n,
          ledgerCreditsCents: 0n,
          reconciledDebitsCents: 0n,
          reconciledCreditsCents: 0n,
          lastReconciledAt: null,
        };

        if (line.entryType === EntryType.DEBIT) {
          cur.ledgerDebitsCents += line.amountCents;
          if (line.journalEntry.isReconciled) {
            cur.reconciledDebitsCents += line.amountCents;
          }
        } else {
          cur.ledgerCreditsCents += line.amountCents;
          if (line.journalEntry.isReconciled) {
            cur.reconciledCreditsCents += line.amountCents;
          }
        }

        if (
          line.journalEntry.reconciledAt &&
          (!cur.lastReconciledAt || line.journalEntry.reconciledAt > cur.lastReconciledAt)
        ) {
          cur.lastReconciledAt = line.journalEntry.reconciledAt;
        }

        statsMap.set(line.accountId, cur);
      }

      // Aggregate statement line counts
      const statementCounts = new Map<
        string,
        { total: number; unreconciled: number; lastReconciledAt: Date | null }
      >();

      for (const stat of statementStats) {
        const cur = statementCounts.get(stat.bankAccountId) ?? {
          total: 0,
          unreconciled: 0,
          lastReconciledAt: null,
        };
        const count = stat._count.id;
        cur.total += count;
        if (!stat.isReconciled) {
          cur.unreconciled += count;
        }
        if (stat._max.reconciledAt && (!cur.lastReconciledAt || stat._max.reconciledAt > cur.lastReconciledAt)) {
          cur.lastReconciledAt = stat._max.reconciledAt;
        }
        statementCounts.set(stat.bankAccountId, cur);
      }

      let totalLedgerCents = 0n;
      let totalReconciledCents = 0n;

      const results = accounts.map((acc) => {
        const stat = statsMap.get(acc.id) ?? {
          ledgerDebitsCents: 0n,
          ledgerCreditsCents: 0n,
          reconciledDebitsCents: 0n,
          reconciledCreditsCents: 0n,
          lastReconciledAt: null,
        };

        const stmtCount = statementCounts.get(acc.id) ?? {
          total: 0,
          unreconciled: 0,
          lastReconciledAt: null,
        };

        // For Assets, normal balance is DEBIT: positive when debits > credits
        // For Liabilities (e.g. Credit Card), normal balance is CREDIT: positive when credits > debits
        const isAsset = acc.type === AccountType.ASSET;
        const ledgerBalanceCents = isAsset
          ? stat.ledgerDebitsCents - stat.ledgerCreditsCents
          : stat.ledgerCreditsCents - stat.ledgerDebitsCents;

        const reconciledBalanceCents = isAsset
          ? stat.reconciledDebitsCents - stat.reconciledCreditsCents
          : stat.reconciledCreditsCents - stat.reconciledDebitsCents;

        const unreconciledDifferenceCents = ledgerBalanceCents - reconciledBalanceCents;

        totalLedgerCents += ledgerBalanceCents;
        totalReconciledCents += reconciledBalanceCents;

        const latestReconciledAt =
          stat.lastReconciledAt && stmtCount.lastReconciledAt
            ? stat.lastReconciledAt > stmtCount.lastReconciledAt
              ? stat.lastReconciledAt
              : stmtCount.lastReconciledAt
            : stat.lastReconciledAt ?? stmtCount.lastReconciledAt;

        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          normalBalance: acc.normalBalance,
          description: acc.description,
          isBankAccount: acc.isBankAccount,
          bankBsb: acc.bankBsb,
          bankAccountNumber: acc.bankAccountNumber,
          apcaUserId: acc.apcaUserId,
          ledgerBalanceCents: Number(ledgerBalanceCents),
          reconciledBalanceCents: Number(reconciledBalanceCents),
          unreconciledDifferenceCents: Number(unreconciledDifferenceCents),
          statementLineCount: stmtCount.total,
          unreconciledLineCount: stmtCount.unreconciled,
          lastReconciledAt: latestReconciledAt ? latestReconciledAt.toISOString() : null,
        };
      });

      return reply.send({
        accounts: results,
        totals: {
          totalLedgerCents: Number(totalLedgerCents),
          totalReconciledCents: Number(totalReconciledCents),
        },
      });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/banking/accounts/:id — Update bank details / banking flag
  // -------------------------------------------------------------------------
  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/banking/accounts/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const bodyParse = UpdateBankAccountBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const existing = await fastify.prisma.account.findFirst({
        where: { id, organizationId },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Account not found.' });
      }

      const dataToUpdate: any = {};
      if (bodyParse.data.isBankAccount !== undefined) {
        dataToUpdate.isBankAccount = bodyParse.data.isBankAccount;
      }
      if (bodyParse.data.bankBsb !== undefined) {
        dataToUpdate.bankBsb = bodyParse.data.bankBsb;
      }
      if (bodyParse.data.bankAccountNumber !== undefined) {
        dataToUpdate.bankAccountNumber = bodyParse.data.bankAccountNumber;
      }
      if (bodyParse.data.apcaUserId !== undefined) {
        dataToUpdate.apcaUserId = bodyParse.data.apcaUserId;
      }

      const updated = await fastify.prisma.account.update({
        where: { id: existing.id },
        data: dataToUpdate,
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'BANK_ACCOUNT_UPDATED',
        entityType: 'ACCOUNT',
        entityId: updated.id,
        summary: `Updated banking configuration for ${updated.code} - ${updated.name}`,
      });

      return reply.send({ account: serializeData(updated) });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/banking/transfers — List inter-account money transfers
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/banking/transfers',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AP_SPECIALIST,
          Role.AR_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      const transfers = await fastify.prisma.bankTransfer.findMany({
        where: { organizationId },
        orderBy: [{ transferDate: 'desc' }, { createdAt: 'desc' }],
      });

      const accountIds = Array.from(
        new Set([
          ...transfers.map((t) => t.fromAccountId),
          ...transfers.map((t) => t.toAccountId),
        ]),
      );

      const accounts = await fastify.prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, code: true, name: true, type: true },
      });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      // Fetch linked journal entries
      const journalEntries = await fastify.prisma.journalEntry.findMany({
        where: {
          organizationId,
          referenceType: 'BANK_TRANSFER',
          referenceId: { in: transfers.map((t) => t.id) },
        },
        select: {
          id: true,
          entryNumber: true,
          referenceId: true,
          status: true,
          isReconciled: true,
        },
      });
      const journalMap = new Map(journalEntries.map((j) => [j.referenceId, j]));

      const enriched = transfers.map((t) => ({
        ...t,
        fromAccount: accountMap.get(t.fromAccountId) ?? null,
        toAccount: accountMap.get(t.toAccountId) ?? null,
        journalEntry: journalMap.get(t.id) ?? null,
      }));

      return reply.send({ transfers: serializeData(enriched) });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/banking/transfers — Record clean 2-line inter-account transfer
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/banking/transfers',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const bodyParse = CreateTransferBody.safeParse(request.body);

      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const {
        fromAccountId,
        toAccountId,
        transferDate,
        amountCents,
        reference,
        description,
      } = bodyParse.data;

      if (fromAccountId === toAccountId) {
        return reply.code(400).send({
          error: 'Source and destination accounts must be different.',
        });
      }

      const dateObj = new Date(transferDate);

      // Lock date check
      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        dateObj,
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const [fromAccount, toAccount] = await Promise.all([
        fastify.prisma.account.findFirst({
          where: { id: fromAccountId, organizationId, isActive: true },
        }),
        fastify.prisma.account.findFirst({
          where: { id: toAccountId, organizationId, isActive: true },
        }),
      ]);

      if (!fromAccount) {
        return reply.code(404).send({ error: 'Source account not found or inactive.' });
      }
      if (!toAccount) {
        return reply.code(404).send({ error: 'Destination account not found or inactive.' });
      }

      const transferAmount = BigInt(amountCents);

      try {
        const result = await fastify.prisma.$transaction(async (tx) => {
          // 1. Create transfer record
          const transfer = await tx.bankTransfer.create({
            data: {
              organizationId,
              fromAccountId,
              toAccountId,
              transferDate: dateObj,
              amountCents: transferAmount,
              reference: reference?.trim() || null,
              description: description?.trim() || null,
              createdByUserId: request.user.userId,
            },
          });

          // 2. Post atomic 2-line double-entry journal:
          //    DEBIT destination account (money in)
          //    CREDIT source account (money out)
          const desc =
            description?.trim() ||
            `Inter-Account Transfer from ${fromAccount.code} - ${fromAccount.name} to ${toAccount.code} - ${toAccount.name}`;

          const entry = await postJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: desc,
            referenceType: 'BANK_TRANSFER',
            referenceId: transfer.id,
            postedAt: dateObj,
            status: JournalStatus.POSTED,
            lines: [
              {
                accountId: toAccountId,
                entryType: EntryType.DEBIT,
                amountCents: transferAmount,
                description: `Transfer in from ${fromAccount.code}`,
              },
              {
                accountId: fromAccountId,
                entryType: EntryType.CREDIT,
                amountCents: transferAmount,
                description: `Transfer out to ${toAccount.code}`,
              },
            ],
          });

          // 3. Record immutable audit log
          await recordAuditLog(tx, {
            organizationId,
            actorUserId: request.user.userId,
            action: 'BANK_TRANSFER_RECORDED',
            entityType: 'BANK_TRANSFER',
            entityId: transfer.id,
            summary: `Transferred $${(Number(transferAmount) / 100).toFixed(2)} from ${fromAccount.code} to ${toAccount.code} (${entry.entryNumber})`,
            metadata: {
              fromAccountId,
              toAccountId,
              amountCents: Number(transferAmount),
              journalEntryId: entry.id,
            },
          });

          return { transfer, entry };
        });

        return reply.code(201).send({
          message: 'Inter-account transfer recorded successfully.',
          transfer: serializeData({
            ...result.transfer,
            fromAccount,
            toAccount,
            journalEntry: result.entry,
          }),
        });
      } catch (err: any) {
        return reply.code(400).send({
          error: err.message || 'Failed to record inter-account transfer.',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/banking/transfers/:id — Reverse/delete inter-account transfer & GL journal
  // -------------------------------------------------------------------------
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/banking/transfers/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const transfer = await fastify.prisma.bankTransfer.findFirst({
        where: { id, organizationId },
      });

      if (!transfer) {
        return reply.code(404).send({ error: 'Bank transfer not found.' });
      }

      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        transfer.transferDate,
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const activeJournal = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'BANK_TRANSFER',
          referenceId: transfer.id,
          status: JournalStatus.POSTED,
          reversedById: null,
        },
      });

      await fastify.prisma.$transaction(async (tx) => {
        if (activeJournal) {
          await reverseJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            journalEntryId: activeJournal.id,
            reversalDate: new Date(),
            reason: `Reversed Bank Transfer ${transfer.reference || transfer.id}`,
            skipSubledgerCascade: true,
          });
        }

        await tx.bankTransfer.delete({ where: { id: transfer.id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BANK_TRANSFER_DELETED',
          entityType: 'BANK_TRANSFER',
          entityId: transfer.id,
          summary: `Deleted inter-account transfer ($${(Number(transfer.amountCents) / 100).toFixed(2)}) and reversed GL posting`,
        });
      });

      return reply.code(200).send({
        success: true,
        message: 'Inter-account transfer reversed and deleted successfully.',
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/banking/statements/import — Upload & parse bank statement CSV
  // Supports Two-Step Validate & Preview (dryRun: true) and Strict Matching
  // of optional Supplier/Merchant, GL Account, Cost Centre, and Tax Treatment.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/banking/statements/import',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const bodyParse = ImportStatementBody.safeParse(request.body);

      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { bankAccountId, csvContent, dryRun, lines: manualLines } = bodyParse.data;

      const bankAccount = await fastify.prisma.account.findFirst({
        where: { id: bankAccountId, organizationId, isActive: true },
      });

      if (!bankAccount) {
        return reply.code(404).send({ error: 'Bank account not found or inactive.' });
      }

      // If committing pre-validated lines directly (Step 2 of Validate & Preview)
      if (!csvContent && manualLines && manualLines.length > 0 && !dryRun) {
        const createdCount = await fastify.prisma.$transaction(async (tx) => {
          let count = 0;
          for (const l of manualLines) {
            await tx.bankStatementLine.create({
              data: {
                organizationId,
                bankAccountId,
                statementDate: new Date(l.statementDate),
                description: l.description.trim(),
                reference: l.reference?.trim() || null,
                amountCents: BigInt(l.amountCents),
                suggestedContactId: l.suggestedContactId || null,
                suggestedAccountId: l.suggestedAccountId || null,
                suggestedTrackingOptionId: l.suggestedTrackingOptionId || null,
                suggestedTaxTreatment: l.suggestedTaxTreatment || null,
                isReconciled: false,
              },
            });
            count++;
          }

          await recordAuditLog(tx, {
            organizationId,
            actorUserId: request.user.userId,
            action: 'BANK_STATEMENT_IMPORTED',
            entityType: 'ACCOUNT',
            entityId: bankAccountId,
            summary: `Imported ${count} validated statement lines for ${bankAccount.code} - ${bankAccount.name}`,
            metadata: {
              bankAccountId,
              importedCount: count,
            },
          });

          return count;
        });

        return reply.code(201).send({
          message: `Successfully imported ${createdCount} bank statement lines.`,
          importedCount: createdCount,
        });
      }

      let parsedRows: ParsedStatementRow[] = [];

      if (csvContent && csvContent.trim().length > 0) {
        try {
          parsedRows = parseStatementCsv(csvContent);
        } catch (err: any) {
          return reply.code(400).send({ error: err.message || 'Failed to parse CSV statement.' });
        }
      } else if (manualLines && manualLines.length > 0) {
        parsedRows = manualLines.map((l, idx) => ({
          rowNumber: idx + 1,
          statementDate: new Date(l.statementDate),
          description: l.description.trim(),
          reference: l.reference?.trim() || null,
          amountCents: BigInt(l.amountCents),
        }));
      } else {
        return reply.code(400).send({
          error: 'Must provide either csvContent or an array of statement lines.',
        });
      }

      if (parsedRows.length === 0) {
        return reply.code(400).send({
          error: 'No valid statement rows were extracted from the input.',
        });
      }

      // Fetch organization lookup tables for strict optional column validation
      const [orgContacts, orgAccounts, orgTrackingOptions] = await Promise.all([
        fastify.prisma.contact.findMany({
          where: { organizationId, isActive: true },
          select: {
            id: true,
            name: true,
            legalName: true,
            type: true,
            defaultExpenseAccountId: true,
            defaultRevenueAccountId: true,
          },
        }),
        fastify.prisma.account.findMany({
          where: { organizationId, isActive: true },
          select: { id: true, code: true, name: true, type: true, defaultTaxTreatment: true },
        }),
        fastify.prisma.trackingOption.findMany({
          where: { organizationId, isActive: true },
          include: { trackingCategory: { select: { name: true } } },
        }),
      ]);

      const accountById = new Map(orgAccounts.map((a) => [a.id, a]));

      // Validate each row against existing Contacts, Accounts, Tracking Options & Tax Treatments
      const validatedRows = parsedRows.map((row) => {
        const errors: string[] = [];
        let matchedContact: (typeof orgContacts)[number] | null = null;
        let matchedAccount: (typeof orgAccounts)[number] | null = null;
        let matchedTracking: (typeof orgTrackingOptions)[number] | null = null;
        let matchedTax: TaxTreatment | null = null;

        if (row.rawContactName) {
          const target = row.rawContactName.toLowerCase();
          matchedContact =
            orgContacts.find(
              (c) =>
                c.name.toLowerCase() === target ||
                (c.legalName && c.legalName.toLowerCase() === target),
            ) ?? null;
          if (!matchedContact) {
            errors.push(`Unrecognized Contact/Merchant "${row.rawContactName}" (no exact match in Contacts directory)`);
          }
        }

        if (row.rawAccountCodeOrName) {
          const target = row.rawAccountCodeOrName.toLowerCase();
          matchedAccount =
            orgAccounts.find(
              (a) =>
                a.code.toLowerCase() === target ||
                a.name.toLowerCase() === target ||
                `${a.code} - ${a.name}`.toLowerCase() === target ||
                `${a.code} ${a.name}`.toLowerCase() === target,
            ) ?? null;
          if (!matchedAccount) {
            errors.push(`Unrecognized GL Account "${row.rawAccountCodeOrName}" (no exact match by code or name in Chart of Accounts)`);
          }
        } else if (matchedContact) {
          // If Contact matched and no Account column was specified, fall back to Contact's default account
          const isDeposit = row.amountCents > 0n;
          const fallbackAccountId = isDeposit
            ? matchedContact.defaultRevenueAccountId
            : matchedContact.defaultExpenseAccountId;
          if (fallbackAccountId) {
            matchedAccount = accountById.get(fallbackAccountId) ?? null;
          }
        }

        if (row.rawTrackingOptionName) {
          const target = row.rawTrackingOptionName.toLowerCase();
          matchedTracking =
            orgTrackingOptions.find(
              (t) =>
                t.name.toLowerCase() === target ||
                (t.code && t.code.toLowerCase() === target) ||
                `${t.trackingCategory.name}: ${t.name}`.toLowerCase() === target,
            ) ?? null;
          if (!matchedTracking) {
            errors.push(`Unrecognized Cost Centre / Tracking Option "${row.rawTrackingOptionName}"`);
          }
        }

        if (row.rawTaxTreatment) {
          const parsedTax = parseTaxTreatmentString(row.rawTaxTreatment);
          if (!parsedTax.valid) {
            errors.push(
              `Unrecognized Tax Treatment "${row.rawTaxTreatment}" (use TAX_EXCLUSIVE, TAX_INCLUSIVE, or GST_FREE)`,
            );
          } else {
            matchedTax = parsedTax.value;
          }
        } else if (matchedAccount) {
          matchedTax = matchedAccount.defaultTaxTreatment;
        }

        return {
          rowNumber: row.rowNumber,
          statementDate: row.statementDate.toISOString().slice(0, 10),
          description: row.description,
          reference: row.reference ?? null,
          amountCents: Number(row.amountCents),
          rawContactName: row.rawContactName ?? null,
          rawAccountCodeOrName: row.rawAccountCodeOrName ?? null,
          rawTrackingOptionName: row.rawTrackingOptionName ?? null,
          rawTaxTreatment: row.rawTaxTreatment ?? null,
          suggestedContactId: matchedContact?.id ?? null,
          suggestedContactName: matchedContact?.name ?? null,
          suggestedAccountId: matchedAccount?.id ?? null,
          suggestedAccountCode: matchedAccount?.code ?? null,
          suggestedAccountName: matchedAccount?.name ?? null,
          suggestedTrackingOptionId: matchedTracking?.id ?? null,
          suggestedTrackingOptionName: matchedTracking
            ? `${matchedTracking.trackingCategory.name}: ${matchedTracking.name}`
            : null,
          suggestedTaxTreatment: matchedTax,
          valid: errors.length === 0,
          errors,
        };
      });

      const validRows = validatedRows.filter((r) => r.valid);
      const invalidRows = validatedRows.filter((r) => !r.valid);

      if (dryRun) {
        return reply.code(200).send({
          dryRun: true,
          totalCount: validatedRows.length,
          validCount: validRows.length,
          invalidCount: invalidRows.length,
          rows: validatedRows,
        });
      }

      if (invalidRows.length > 0) {
        return reply.code(400).send({
          error: `${invalidRows.length} row(s) failed strict Contact/Account/Cost Centre validation. Use Validate & Preview to inspect errors or commit valid rows only.`,
          totalCount: validatedRows.length,
          validCount: validRows.length,
          invalidCount: invalidRows.length,
          rows: validatedRows,
        });
      }

      // Insert validated rows into bank_statement_lines
      const createdCount = await fastify.prisma.$transaction(async (tx) => {
        let count = 0;
        for (const row of validRows) {
          await tx.bankStatementLine.create({
            data: {
              organizationId,
              bankAccountId,
              statementDate: new Date(row.statementDate),
              description: row.description,
              reference: row.reference,
              amountCents: BigInt(row.amountCents),
              suggestedContactId: row.suggestedContactId,
              suggestedAccountId: row.suggestedAccountId,
              suggestedTrackingOptionId: row.suggestedTrackingOptionId,
              suggestedTaxTreatment: row.suggestedTaxTreatment,
              isReconciled: false,
            },
          });
          count++;
        }

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BANK_STATEMENT_IMPORTED',
          entityType: 'ACCOUNT',
          entityId: bankAccountId,
          summary: `Imported ${count} statement lines for ${bankAccount.code} - ${bankAccount.name}`,
          metadata: {
            bankAccountId,
            importedCount: count,
          },
        });

        return count;
      });

      return reply.code(201).send({
        message: `Successfully imported ${createdCount} bank statement lines.`,
        importedCount: createdCount,
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/banking/statements — List imported statement lines with filters
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/banking/statements',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AP_SPECIALIST,
          Role.AR_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const query = request.query as Record<string, string | undefined>;

      const where: any = { organizationId };

      if (query.bankAccountId) {
        where.bankAccountId = query.bankAccountId;
      }
      if (query.isReconciled !== undefined) {
        where.isReconciled = query.isReconciled === 'true';
      }
      if (query.startDate) {
        where.statementDate = {
          ...(where.statementDate ?? {}),
          gte: new Date(query.startDate),
        };
      }
      if (query.endDate) {
        where.statementDate = {
          ...(where.statementDate ?? {}),
          lte: new Date(query.endDate),
        };
      }

      const limit = query.limit ? Math.min(parseInt(query.limit, 10), 200) : 100;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;

      const [totalCount, lines] = await Promise.all([
        fastify.prisma.bankStatementLine.count({ where }),
        fastify.prisma.bankStatementLine.findMany({
          where,
          orderBy: [{ statementDate: 'desc' }, { createdAt: 'desc' }],
          take: limit,
          skip: offset,
        }),
      ]);

      // If matched journals or suggested entities exist, retrieve their metadata
      const matchedJournalIds = lines
        .map((l) => l.matchedJournalId)
        .filter((id): id is string => Boolean(id));
      const suggestedContactIds = lines
        .map((l) => l.suggestedContactId)
        .filter((id): id is string => Boolean(id));
      const suggestedAccountIds = lines
        .map((l) => l.suggestedAccountId)
        .filter((id): id is string => Boolean(id));
      const suggestedTrackingIds = lines
        .map((l) => l.suggestedTrackingOptionId)
        .filter((id): id is string => Boolean(id));

      const [journals, suggestedContacts, suggestedAccounts, suggestedTrackings] =
        await Promise.all([
          matchedJournalIds.length > 0
            ? fastify.prisma.journalEntry.findMany({
                where: { id: { in: matchedJournalIds } },
                select: { id: true, entryNumber: true, description: true, referenceType: true },
              })
            : Promise.resolve([]),
          suggestedContactIds.length > 0
            ? fastify.prisma.contact.findMany({
                where: { id: { in: suggestedContactIds } },
                select: { id: true, name: true, type: true },
              })
            : Promise.resolve([]),
          suggestedAccountIds.length > 0
            ? fastify.prisma.account.findMany({
                where: { id: { in: suggestedAccountIds } },
                select: { id: true, code: true, name: true },
              })
            : Promise.resolve([]),
          suggestedTrackingIds.length > 0
            ? fastify.prisma.trackingOption.findMany({
                where: { id: { in: suggestedTrackingIds } },
                select: { id: true, name: true, trackingCategory: { select: { name: true } } },
              })
            : Promise.resolve([]),
        ]);

      const journalMap = new Map(journals.map((j) => [j.id, j]));
      const contactMap = new Map(suggestedContacts.map((c) => [c.id, c]));
      const accountMap = new Map(suggestedAccounts.map((a) => [a.id, a]));
      const trackingMap = new Map(
        suggestedTrackings.map((t) => [
          t.id,
          { id: t.id, name: t.name, category: { name: t.trackingCategory.name } },
        ]),
      );

      const enriched = lines.map((l) => ({
        ...l,
        matchedJournal: l.matchedJournalId ? journalMap.get(l.matchedJournalId) ?? null : null,
        suggestedContact: l.suggestedContactId ? contactMap.get(l.suggestedContactId) ?? null : null,
        suggestedAccount: l.suggestedAccountId ? accountMap.get(l.suggestedAccountId) ?? null : null,
        suggestedTrackingOption: l.suggestedTrackingOptionId
          ? trackingMap.get(l.suggestedTrackingOptionId) ?? null
          : null,
      }));

      return reply.send({
        totalCount,
        lines: serializeData(enriched),
      });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/banking/statements/:id — Delete unreconciled statement line
  // -------------------------------------------------------------------------
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/banking/statements/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const { id } = request.params;

      const line = await fastify.prisma.bankStatementLine.findFirst({
        where: { id, organizationId },
      });

      if (!line) {
        return reply.code(404).send({ error: 'Statement line not found.' });
      }

      if (line.isReconciled) {
        return reply.code(400).send({
          error: 'Reconciled statement lines cannot be deleted. Unmatch the line first before deleting.',
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.bankStatementLine.delete({ where: { id: line.id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BANK_STATEMENT_LINE_DELETED',
          entityType: 'BANK_STATEMENT_LINE',
          entityId: line.id,
          summary: `Deleted statement line: "${line.description}" ($${(Number(line.amountCents) / 100).toFixed(2)})`,
        });
      });

      return reply.send({ ok: true, message: 'Statement line deleted successfully.' });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/banking/reconciliation/suggestions — Smart matching engine
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/banking/reconciliation/suggestions',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AP_SPECIALIST,
          Role.AR_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const query = request.query as Record<string, string | undefined>;

      if (!query.bankAccountId) {
        return reply.code(400).send({ error: 'bankAccountId query parameter is required.' });
      }

      const { bankAccountId, statementLineId } = query;

      // 1. Fetch target statement line(s)
      const statementWhere: any = {
        organizationId,
        bankAccountId,
        isReconciled: false,
      };
      if (statementLineId) {
        statementWhere.id = statementLineId;
      }

      const statementLines = await fastify.prisma.bankStatementLine.findMany({
        where: statementWhere,
        orderBy: { statementDate: 'desc' },
        take: statementLineId ? 1 : 50,
      });

      // 2. Fetch all unreconciled posted journal lines for this bank account
      const unreconciledJournalLines = await fastify.prisma.journalLine.findMany({
        where: {
          organizationId,
          accountId: bankAccountId,
          journalEntry: {
            status: JournalStatus.POSTED,
            isReconciled: false,
          },
        },
        include: {
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              description: true,
              referenceType: true,
              referenceId: true,
              postedAt: true,
              status: true,
            },
          },
        },
        orderBy: { journalEntry: { postedAt: 'desc' } },
        take: 200,
      });

      // 3. For each statement line, calculate match score against unreconciled journal lines
      const suggestions = statementLines.map((stmt) => {
        // Sign convention:
        // statement amountCents > 0 (deposit / money in) => expects journal DEBIT to bank account
        // statement amountCents < 0 (withdrawal / money out) => expects journal CREDIT to bank account
        const isDeposit = stmt.amountCents > 0n;
        const expectedEntryType = isDeposit ? EntryType.DEBIT : EntryType.CREDIT;
        const targetAmountAbs = isDeposit ? stmt.amountCents : -stmt.amountCents;

        const candidateMatches: Array<{
          score: number;
          confidence: 'HIGH' | 'MEDIUM' | 'LOW';
          reasons: string[];
          journalLineId: string;
          journalEntry: any;
          amountCents: number;
          entryType: EntryType;
        }> = [];

        for (const jl of unreconciledJournalLines) {
          const isExactAmount = jl.amountCents === targetAmountAbs;
          const isCorrectDirection = jl.entryType === expectedEntryType;

          if (!isExactAmount && !isCorrectDirection) continue;

          let score = 0;
          const reasons: string[] = [];

          if (isExactAmount) {
            score += 50;
            reasons.push('Exact amount match');
          }

          if (isCorrectDirection) {
            score += 20;
            reasons.push(isDeposit ? 'Deposit matched with Ledger Debit' : 'Withdrawal matched with Ledger Credit');
          }

          // Date proximity
          const stmtTime = new Date(stmt.statementDate).getTime();
          const jnlTime = new Date(jl.journalEntry.postedAt).getTime();
          const dayDiff = Math.abs(Math.round((stmtTime - jnlTime) / (1000 * 60 * 60 * 24)));

          if (dayDiff === 0) {
            score += 30;
            reasons.push('Same day transaction');
          } else if (dayDiff <= 3) {
            score += 20;
            reasons.push(`Within ${dayDiff} days`);
          } else if (dayDiff <= 7) {
            score += 10;
            reasons.push(`Within ${dayDiff} days`);
          }

          // Text similarity
          const stmtText = `${stmt.description} ${stmt.reference || ''}`.toLowerCase();
          const jnlText = jl.journalEntry.description.toLowerCase();

          // Check if any keyword of length >= 4 matches
          const keywords = stmtText.split(/\s+/).filter((w) => w.length >= 4);
          const hasKeywordMatch = keywords.some((kw) => jnlText.includes(kw));

          if (hasKeywordMatch) {
            score += 15;
            reasons.push('Narrative keyword match');
          }

          if (score >= 40) {
            candidateMatches.push({
              score,
              confidence: score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW',
              reasons,
              journalLineId: jl.id,
              journalEntry: jl.journalEntry,
              amountCents: Number(jl.amountCents),
              entryType: jl.entryType,
            });
          }
        }

        candidateMatches.sort((a, b) => b.score - a.score);

        return {
          statementLine: serializeData(stmt),
          suggestedMatch: candidateMatches[0] ?? null,
          otherCandidates: candidateMatches.slice(1, 5),
        };
      });

      return reply.send({
        suggestions,
        unreconciledJournalEntries: serializeData(
          unreconciledJournalLines.map((jl) => ({
            id: jl.journalEntry.id,
            entryNumber: jl.journalEntry.entryNumber,
            description: jl.journalEntry.description,
            referenceType: jl.journalEntry.referenceType,
            postedAt: jl.journalEntry.postedAt,
            amountCents: Number(jl.amountCents),
            entryType: jl.entryType,
          })),
        ),
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/banking/reconciliation/match — 1-Click match line to journal
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/banking/reconciliation/match',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const bodyParse = MatchReconciliationBody.safeParse(request.body);

      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { statementLineId, journalEntryId } = bodyParse.data;

      const [stmtLine, journalEntry] = await Promise.all([
        fastify.prisma.bankStatementLine.findFirst({
          where: { id: statementLineId, organizationId },
        }),
        fastify.prisma.journalEntry.findFirst({
          where: { id: journalEntryId, organizationId },
          include: { lines: true },
        }),
      ]);

      if (!stmtLine) {
        return reply.code(404).send({ error: 'Statement line not found.' });
      }
      if (stmtLine.isReconciled) {
        return reply.code(400).send({ error: 'Statement line is already reconciled.' });
      }

      if (!journalEntry) {
        return reply.code(404).send({ error: 'Journal entry not found.' });
      }
      if (journalEntry.status !== JournalStatus.POSTED) {
        return reply.code(400).send({
          error: `Only POSTED journal entries can be reconciled (current status: ${journalEntry.status}).`,
        });
      }

      // Verify that this journal entry actually impacts the statement line's bank account
      const hasBankLine = journalEntry.lines.some(
        (l) => l.accountId === stmtLine.bankAccountId,
      );
      if (!hasBankLine) {
        return reply.code(400).send({
          error: 'Selected journal entry does not contain a line impacting this bank account.',
        });
      }

      const now = new Date();

      await fastify.prisma.$transaction(async (tx) => {
        // Mark statement line as reconciled
        await tx.bankStatementLine.update({
          where: { id: stmtLine.id },
          data: {
            isReconciled: true,
            matchedJournalId: journalEntry.id,
            reconciledAt: now,
            reconciledByUserId: request.user.userId,
          },
        });

        // Mark journal entry as reconciled
        await tx.journalEntry.update({
          where: { id: journalEntry.id },
          data: {
            isReconciled: true,
            reconciledAt: now,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BANK_STATEMENT_RECONCILED',
          entityType: 'BANK_STATEMENT_LINE',
          entityId: stmtLine.id,
          summary: `Reconciled statement line "${stmtLine.description}" with journal ${journalEntry.entryNumber || journalEntry.id}`,
          metadata: {
            statementLineId: stmtLine.id,
            journalEntryId: journalEntry.id,
            amountCents: Number(stmtLine.amountCents),
          },
        });
      });

      return reply.send({
        ok: true,
        message: 'Statement line matched and reconciled successfully.',
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/banking/reconciliation/unmatch — Reopen / unmatch reconciliation
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/banking/reconciliation/unmatch',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const bodyParse = UnmatchReconciliationBody.safeParse(request.body);

      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { statementLineId } = bodyParse.data;

      const stmtLine = await fastify.prisma.bankStatementLine.findFirst({
        where: { id: statementLineId, organizationId },
      });

      if (!stmtLine) {
        return reply.code(404).send({ error: 'Statement line not found.' });
      }
      if (!stmtLine.isReconciled) {
        return reply.code(400).send({ error: 'Statement line is not currently reconciled.' });
      }

      const matchedJournalId = stmtLine.matchedJournalId;

      await fastify.prisma.$transaction(async (tx) => {
        // Reset statement line
        await tx.bankStatementLine.update({
          where: { id: stmtLine.id },
          data: {
            isReconciled: false,
            matchedJournalId: null,
            reconciledAt: null,
            reconciledByUserId: null,
          },
        });

        // If there are no other statement lines matched to this journal, reset journal isReconciled
        if (matchedJournalId) {
          const otherMatches = await tx.bankStatementLine.count({
            where: {
              organizationId,
              matchedJournalId,
              id: { not: stmtLine.id },
              isReconciled: true,
            },
          });

          if (otherMatches === 0) {
            await tx.journalEntry.update({
              where: { id: matchedJournalId },
              data: {
                isReconciled: false,
                reconciledAt: null,
              },
            });
          }
        }

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BANK_STATEMENT_UNMATCHED',
          entityType: 'BANK_STATEMENT_LINE',
          entityId: stmtLine.id,
          summary: `Unmatched reconciliation for statement line "${stmtLine.description}"`,
        });
      });

      return reply.send({
        ok: true,
        message: 'Reconciliation reopened and line unmatched.',
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/banking/reconciliation/create-and-reconcile
  // Multi-Mode Contact-Linked Bank Reconciliation:
  //  - Outflows (amountCents < 0): DIRECT_EXPENSE | ALLOCATE_BILL | CREATE_AND_PAY_BILL
  //  - Inflows  (amountCents > 0): DIRECT_INCOME  | ALLOCATE_INVOICE | CREATE_AND_PAY_INVOICE
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/banking/reconciliation/create-and-reconcile',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const bodyParse = CreateAndReconcileBody.safeParse(request.body);

      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const {
        statementLineId,
        mode: rawMode,
        contactId: rawContactId,
        payeeName,
        targetAccountId: rawTargetAccountId,
        billId,
        invoiceId,
        documentReference,
        description,
        taxTreatment,
        trackingOptionId: rawTrackingOptionId,
      } = bodyParse.data;

      const stmtLine = await fastify.prisma.bankStatementLine.findFirst({
        where: { id: statementLineId, organizationId },
      });

      if (!stmtLine) {
        return reply.code(404).send({ error: 'Statement line not found.' });
      }
      if (stmtLine.isReconciled) {
        return reply.code(400).send({ error: 'Statement line is already reconciled.' });
      }

      // Check lock date for statement date
      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        stmtLine.statementDate,
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const bankAccount = await fastify.prisma.account.findFirst({
        where: { id: stmtLine.bankAccountId, organizationId, isActive: true },
      });

      if (!bankAccount) {
        return reply.code(404).send({ error: 'Bank account not found or inactive.' });
      }

      const isDeposit = stmtLine.amountCents > 0n;
      const totalAmountCents = isDeposit ? stmtLine.amountCents : -stmtLine.amountCents;
      const effectiveMode = rawMode ?? (isDeposit ? 'DIRECT_INCOME' : 'DIRECT_EXPENSE');

      // Validate mode matches cash direction
      if (
        isDeposit &&
        !['DIRECT_INCOME', 'ALLOCATE_INVOICE', 'CREATE_AND_PAY_INVOICE'].includes(effectiveMode)
      ) {
        return reply.code(400).send({
          error: `Deposit statement line cannot be reconciled with outflow mode ${effectiveMode}.`,
        });
      }
      if (
        !isDeposit &&
        !['DIRECT_EXPENSE', 'ALLOCATE_BILL', 'CREATE_AND_PAY_BILL'].includes(effectiveMode)
      ) {
        return reply.code(400).send({
          error: `Withdrawal statement line cannot be reconciled with inflow mode ${effectiveMode}.`,
        });
      }

      const effectiveContactId = rawContactId || stmtLine.suggestedContactId || null;
      const effectiveTargetAccountId = rawTargetAccountId || stmtLine.suggestedAccountId || null;
      const effectiveTrackingOptionId = rawTrackingOptionId ?? stmtLine.suggestedTrackingOptionId ?? null;
      const narrative = description?.trim() || stmtLine.description;

      // Resolve Contact if provided
      const contact = effectiveContactId
        ? await fastify.prisma.contact.findFirst({
            where: { id: effectiveContactId, organizationId },
          })
        : null;

      if (effectiveContactId && !contact) {
        return reply.code(404).send({ error: 'Selected Contact not found in this organization.' });
      }

      // Resolve System Control Accounts
      const systemAccounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          OR: [
            { systemKey: { in: ['GST_PAID', 'GST_COLLECTED', 'ACCOUNTS_PAYABLE', 'ACCOUNTS_RECEIVABLE'] } },
            { code: { in: ['1200', '2000', '2100', '2200'] } },
          ],
        },
      });

      const gstPaidAccount =
        systemAccounts.find((a) => a.systemKey === 'GST_PAID') ??
        systemAccounts.find((a) => a.code === '2200') ??
        null;
      const gstCollectedAccount =
        systemAccounts.find((a) => a.systemKey === 'GST_COLLECTED') ??
        systemAccounts.find((a) => a.code === '2100') ??
        null;
      const apAccount =
        systemAccounts.find((a) => a.systemKey === 'ACCOUNTS_PAYABLE') ??
        systemAccounts.find((a) => a.code === '2000') ??
        null;
      const arAccount =
        systemAccounts.find((a) => a.systemKey === 'ACCOUNTS_RECEIVABLE') ??
        systemAccounts.find((a) => a.code === '1200') ??
        null;

      try {
        const result = await fastify.prisma.$transaction(async (tx) => {
          const now = new Date();
          let matchedEntry: any = null;
          let auditSummary = '';

          // ===================================================================
          // MODE 1 & 2: DIRECT_EXPENSE (Spend Money) or DIRECT_INCOME (Receive Money)
          // Creates a full DirectTransaction record linked to Contact & GL
          // ===================================================================
          if (effectiveMode === 'DIRECT_EXPENSE' || effectiveMode === 'DIRECT_INCOME') {
            if (!effectiveTargetAccountId) {
              throw new Error('Target GL Account is required for Direct Expense / Direct Income.');
            }
            const targetAccount = await tx.account.findFirst({
              where: { id: effectiveTargetAccountId, organizationId, isActive: true },
            });
            if (!targetAccount) {
              throw new Error('Target coding GL account not found or inactive.');
            }

            // In bank reconciliation, the statement line amount is the gross bank settlement total.
            // Calculate GST so totalCents === totalAmountCents
            const effectiveTax =
              taxTreatment === TaxTreatment.TAX_EXCLUSIVE
                ? TaxTreatment.TAX_INCLUSIVE
                : taxTreatment;
            const gstCalc = calculateGST(totalAmountCents, effectiveTax);
            const subtotalCents = gstCalc.subtotalCents;

            const directTx = await tx.directTransaction.create({
              data: {
                organizationId,
                bankAccountId: bankAccount.id,
                contactId: contact?.id ?? null,
                payeeName: contact?.name ?? payeeName?.trim() ?? stmtLine.description,
                type: isDeposit
                  ? DirectTransactionType.RECEIVE_MONEY
                  : DirectTransactionType.SPEND_MONEY,
                transactionDate: stmtLine.statementDate,
                reference: documentReference?.trim() || stmtLine.reference || null,
                subtotalCents,
                gstCents: gstCalc.gstCents,
                totalCents: totalAmountCents,
                notes: narrative,
                createdByUserId: request.user.userId,
                lines: {
                  create: [
                    {
                      organizationId,
                      accountId: targetAccount.id,
                      trackingOptionId: effectiveTrackingOptionId,
                      description: narrative,
                      amountCents: subtotalCents,
                      taxTreatment: effectiveTax,
                      gstCents: gstCalc.gstCents,
                      totalCents: totalAmountCents,
                    },
                  ],
                },
              },
            });

            const journalLines: Array<{
              accountId: string;
              trackingOptionId?: string | null;
              entryType: EntryType;
              amountCents: bigint;
              description?: string;
            }> = [];

            if (isDeposit) {
              journalLines.push({
                accountId: bankAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: totalAmountCents,
                description: narrative,
              });
              if (gstCalc.gstCents > 0n && gstCollectedAccount) {
                journalLines.push({
                  accountId: gstCollectedAccount.id,
                  entryType: EntryType.CREDIT,
                  amountCents: gstCalc.gstCents,
                  description: `GST on ${narrative}`,
                });
              }
              journalLines.push({
                accountId: targetAccount.id,
                trackingOptionId: effectiveTrackingOptionId,
                entryType: EntryType.CREDIT,
                amountCents: subtotalCents,
                description: narrative,
              });
            } else {
              journalLines.push({
                accountId: targetAccount.id,
                trackingOptionId: effectiveTrackingOptionId,
                entryType: EntryType.DEBIT,
                amountCents: subtotalCents,
                description: narrative,
              });
              if (gstCalc.gstCents > 0n && gstPaidAccount) {
                journalLines.push({
                  accountId: gstPaidAccount.id,
                  entryType: EntryType.DEBIT,
                  amountCents: gstCalc.gstCents,
                  description: `GST on ${narrative}`,
                });
              }
              journalLines.push({
                accountId: bankAccount.id,
                entryType: EntryType.CREDIT,
                amountCents: totalAmountCents,
                description: narrative,
              });
            }

            matchedEntry = await postJournalEntry(tx, {
              organizationId,
              actorUserId: request.user.userId,
              description: `${isDeposit ? 'Receive Money' : 'Spend Money'}: ${contact?.name || payeeName || narrative}`,
              referenceType: 'DIRECT_TRANSACTION',
              referenceId: directTx.id,
              postedAt: stmtLine.statementDate,
              status: JournalStatus.POSTED,
              lines: journalLines,
            });

            auditSummary = `Created ${isDeposit ? 'Direct Income' : 'Direct Expense'} (${matchedEntry.entryNumber})${contact ? ` for ${contact.name}` : ''} and reconciled against ${targetAccount.code}`;
          }

          // ===================================================================
          // MODE 3: ALLOCATE_BILL — Pay an existing open Vendor Bill
          // ===================================================================
          else if (effectiveMode === 'ALLOCATE_BILL') {
            if (!billId) {
              throw new Error('Must select an open Vendor Bill to allocate payment against.');
            }
            if (!apAccount) {
              throw new Error('Protected System Account 2000 (Accounts Payable) is missing.');
            }

            const bill = await tx.bill.findFirst({
              where: { id: billId, organizationId },
              include: { contact: true },
            });
            if (!bill) {
              throw new Error('Selected Vendor Bill not found.');
            }
            if (bill.status === BillStatus.PAID || bill.status === BillStatus.VOID || bill.status === BillStatus.DRAFT) {
              throw new Error(`Cannot allocate payment to a ${bill.status} bill.`);
            }

            const remainingCents = bill.totalCents - bill.amountPaidCents;
            if (totalAmountCents > remainingCents) {
              throw new Error(
                `Statement withdrawal ($${(Number(totalAmountCents) / 100).toFixed(2)}) exceeds bill remaining balance ($${(Number(remainingCents) / 100).toFixed(2)}).`,
              );
            }

            const newAmountPaid = bill.amountPaidCents + totalAmountCents;
            const newStatus =
              newAmountPaid >= bill.totalCents ? BillStatus.PAID : BillStatus.PARTIALLY_PAID;

            const paymentOut = await tx.paymentOut.create({
              data: {
                organizationId,
                billId: bill.id,
                paymentDate: stmtLine.statementDate,
                amountCents: totalAmountCents,
                bankAccountId: bankAccount.id,
                reference: documentReference?.trim() || stmtLine.reference || null,
              },
            });

            await tx.bill.update({
              where: { id: bill.id },
              data: {
                amountPaidCents: newAmountPaid,
                status: newStatus,
              },
            });

            matchedEntry = await postJournalEntry(tx, {
              organizationId,
              actorUserId: request.user.userId,
              description: `Payment for bill ${bill.reference || bill.id} from ${bill.contact.name}`,
              referenceType: 'PAYMENT_OUT',
              referenceId: paymentOut.id,
              postedAt: stmtLine.statementDate,
              status: JournalStatus.POSTED,
              lines: [
                {
                  accountId: apAccount.id,
                  description: `AP Settlement: Bill ${bill.reference || bill.id}`,
                  entryType: EntryType.DEBIT,
                  amountCents: totalAmountCents,
                },
                {
                  accountId: bankAccount.id,
                  description: `Cash Outflow: Bill ${bill.reference || bill.id}`,
                  entryType: EntryType.CREDIT,
                  amountCents: totalAmountCents,
                },
              ],
            });

            auditSummary = `Allocated bank payment ($${(Number(totalAmountCents) / 100).toFixed(2)}) to Bill ${bill.reference || bill.id} (${bill.contact.name}) and reconciled`;
          }

          // ===================================================================
          // MODE 4: CREATE_AND_PAY_BILL — Create new Vendor Bill + settle & reconcile
          // ===================================================================
          else if (effectiveMode === 'CREATE_AND_PAY_BILL') {
            if (!contact) {
              throw new Error('Must select a Supplier / Contact to create and pay a new Vendor Bill.');
            }
            if (!effectiveTargetAccountId) {
              throw new Error('Must select an Expense GL Account for the new Vendor Bill.');
            }
            if (!apAccount) {
              throw new Error('Protected System Account 2000 (Accounts Payable) is missing.');
            }

            const targetAccount = await tx.account.findFirst({
              where: { id: effectiveTargetAccountId, organizationId, isActive: true },
            });
            if (!targetAccount) {
              throw new Error('Target Expense GL Account not found.');
            }

            const effectiveTax =
              taxTreatment === TaxTreatment.TAX_EXCLUSIVE
                ? TaxTreatment.TAX_INCLUSIVE
                : taxTreatment;
            const gstCalc = calculateGST(totalAmountCents, effectiveTax);
            const subtotalCents = gstCalc.subtotalCents;
            const billRef =
              documentReference?.trim() ||
              stmtLine.reference ||
              `BILL-${stmtLine.statementDate.toISOString().slice(0, 10).replace(/-/g, '')}`;

            const newBill = await tx.bill.create({
              data: {
                organizationId,
                contactId: contact.id,
                reference: billRef,
                issueDate: stmtLine.statementDate,
                dueDate: stmtLine.statementDate,
                status: BillStatus.PAID,
                subtotalCents,
                gstCents: gstCalc.gstCents,
                totalCents: totalAmountCents,
                amountPaidCents: totalAmountCents,
                notes: narrative,
                createdByUserId: request.user.userId,
                approvedByUserId: request.user.userId,
                lineItems: {
                  create: [
                    {
                      organizationId,
                      accountId: targetAccount.id,
                      trackingOptionId: effectiveTrackingOptionId,
                      description: narrative,
                      quantity: 1,
                      unitPriceCents: totalAmountCents,
                      amountCents: subtotalCents,
                      taxTreatment: effectiveTax,
                      gstCents: gstCalc.gstCents,
                      totalCents: totalAmountCents,
                    },
                  ],
                },
              },
            });

            // 1. Post BILL accrual journal (DR Expense, DR GST Paid, CR 2000 AP)
            const billJournalLines: Array<{
              accountId: string;
              trackingOptionId?: string | null;
              entryType: EntryType;
              amountCents: bigint;
              description?: string;
            }> = [
              {
                accountId: targetAccount.id,
                trackingOptionId: effectiveTrackingOptionId,
                entryType: EntryType.DEBIT,
                amountCents: subtotalCents,
                description: `${billRef}: ${narrative}`,
              },
            ];
            if (gstCalc.gstCents > 0n && gstPaidAccount) {
              billJournalLines.push({
                accountId: gstPaidAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: gstCalc.gstCents,
                description: `GST Paid on Bill ${billRef}`,
              });
            }
            billJournalLines.push({
              accountId: apAccount.id,
              entryType: EntryType.CREDIT,
              amountCents: totalAmountCents,
              description: `Bill ${billRef} - ${contact.name}`,
            });

            await postJournalEntry(tx, {
              organizationId,
              actorUserId: request.user.userId,
              description: `Bill ${billRef} from ${contact.name}`,
              referenceType: 'BILL',
              referenceId: newBill.id,
              postedAt: stmtLine.statementDate,
              status: JournalStatus.POSTED,
              lines: billJournalLines,
            });

            // 2. Record PaymentOut & post PAYMENT_OUT settlement journal (DR 2000 AP, CR Bank)
            const paymentOut = await tx.paymentOut.create({
              data: {
                organizationId,
                billId: newBill.id,
                paymentDate: stmtLine.statementDate,
                amountCents: totalAmountCents,
                bankAccountId: bankAccount.id,
                reference: billRef,
              },
            });

            matchedEntry = await postJournalEntry(tx, {
              organizationId,
              actorUserId: request.user.userId,
              description: `Payment for bill ${billRef} from ${contact.name}`,
              referenceType: 'PAYMENT_OUT',
              referenceId: paymentOut.id,
              postedAt: stmtLine.statementDate,
              status: JournalStatus.POSTED,
              lines: [
                {
                  accountId: apAccount.id,
                  description: `AP Settlement: Bill ${billRef}`,
                  entryType: EntryType.DEBIT,
                  amountCents: totalAmountCents,
                },
                {
                  accountId: bankAccount.id,
                  description: `Cash Outflow: Bill ${billRef}`,
                  entryType: EntryType.CREDIT,
                  amountCents: totalAmountCents,
                },
              ],
            });

            auditSummary = `Created & paid Bill ${billRef} for ${contact.name} ($${(Number(totalAmountCents) / 100).toFixed(2)}) and reconciled`;
          }

          // ===================================================================
          // MODE 5: ALLOCATE_INVOICE — Receive payment against an open Customer Invoice
          // ===================================================================
          else if (effectiveMode === 'ALLOCATE_INVOICE') {
            if (!invoiceId) {
              throw new Error('Must select an open Customer Invoice to allocate payment against.');
            }
            if (!arAccount) {
              throw new Error('Protected System Account 1200 (Accounts Receivable) is missing.');
            }

            const invoice = await tx.invoice.findFirst({
              where: { id: invoiceId, organizationId },
              include: { contact: true },
            });
            if (!invoice) {
              throw new Error('Selected Customer Invoice not found.');
            }
            if (
              invoice.status === InvoiceStatus.PAID ||
              invoice.status === InvoiceStatus.VOID ||
              invoice.status === InvoiceStatus.DRAFT
            ) {
              throw new Error(`Cannot allocate receipt to a ${invoice.status} invoice.`);
            }

            const remainingCents = invoice.totalCents - invoice.amountPaidCents;
            if (totalAmountCents > remainingCents) {
              throw new Error(
                `Statement deposit ($${(Number(totalAmountCents) / 100).toFixed(2)}) exceeds invoice remaining balance ($${(Number(remainingCents) / 100).toFixed(2)}).`,
              );
            }

            const newAmountPaid = invoice.amountPaidCents + totalAmountCents;
            const newStatus =
              newAmountPaid >= invoice.totalCents ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

            const paymentIn = await tx.paymentIn.create({
              data: {
                organizationId,
                invoiceId: invoice.id,
                contactId: invoice.contactId,
                receiptType: PaymentReceiptType.INVOICE_PAYMENT,
                bankAccountId: bankAccount.id,
                paymentDate: stmtLine.statementDate,
                amountCents: totalAmountCents,
                reference: documentReference?.trim() || stmtLine.reference || null,
              },
            });

            await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                amountPaidCents: newAmountPaid,
                status: newStatus,
              },
            });

            matchedEntry = await postJournalEntry(tx, {
              organizationId,
              actorUserId: request.user.userId,
              description: `Payment received for invoice ${invoice.invoiceNumber} from ${invoice.contact.name}`,
              referenceType: 'PAYMENT_IN',
              referenceId: paymentIn.id,
              postedAt: stmtLine.statementDate,
              status: JournalStatus.POSTED,
              lines: [
                {
                  accountId: bankAccount.id,
                  description: `Cash Receipt: Invoice ${invoice.invoiceNumber}`,
                  entryType: EntryType.DEBIT,
                  amountCents: totalAmountCents,
                },
                {
                  accountId: arAccount.id,
                  description: `AR Settlement: Invoice ${invoice.invoiceNumber}`,
                  entryType: EntryType.CREDIT,
                  amountCents: totalAmountCents,
                },
              ],
            });

            auditSummary = `Allocated bank receipt ($${(Number(totalAmountCents) / 100).toFixed(2)}) to Invoice ${invoice.invoiceNumber} (${invoice.contact.name}) and reconciled`;
          }

          // ===================================================================
          // MODE 6: CREATE_AND_PAY_INVOICE — Create new Customer Invoice + settle & reconcile
          // ===================================================================
          else if (effectiveMode === 'CREATE_AND_PAY_INVOICE') {
            if (!contact) {
              throw new Error('Must select a Customer / Contact to create and settle a new Customer Invoice.');
            }
            if (!effectiveTargetAccountId) {
              throw new Error('Must select a Revenue GL Account for the new Customer Invoice.');
            }
            if (!arAccount) {
              throw new Error('Protected System Account 1200 (Accounts Receivable) is missing.');
            }

            const targetAccount = await tx.account.findFirst({
              where: { id: effectiveTargetAccountId, organizationId, isActive: true },
            });
            if (!targetAccount) {
              throw new Error('Target Revenue GL Account not found.');
            }

            const effectiveTax =
              taxTreatment === TaxTreatment.TAX_EXCLUSIVE
                ? TaxTreatment.TAX_INCLUSIVE
                : taxTreatment;
            const gstCalc = calculateGST(totalAmountCents, effectiveTax);
            const subtotalCents = gstCalc.subtotalCents;

            let invoiceNumber = documentReference?.trim() || '';
            if (!invoiceNumber) {
              const count = await tx.invoice.count({ where: { organizationId } });
              invoiceNumber = `INV-${String(count + 1).padStart(4, '0')}`;
              while (await tx.invoice.findFirst({ where: { organizationId, invoiceNumber } })) {
                invoiceNumber = `INV-${String(Math.floor(1000 + Math.random() * 9000))}`;
              }
            }

            const newInvoice = await tx.invoice.create({
              data: {
                organizationId,
                contactId: contact.id,
                invoiceNumber,
                issueDate: stmtLine.statementDate,
                dueDate: stmtLine.statementDate,
                status: InvoiceStatus.PAID,
                subtotalCents,
                gstCents: gstCalc.gstCents,
                totalCents: totalAmountCents,
                amountPaidCents: totalAmountCents,
                notes: narrative,
                createdByUserId: request.user.userId,
                approvedByUserId: request.user.userId,
                lineItems: {
                  create: [
                    {
                      organizationId,
                      accountId: targetAccount.id,
                      trackingOptionId: effectiveTrackingOptionId,
                      description: narrative,
                      quantity: 1,
                      unitPriceCents: totalAmountCents,
                      amountCents: subtotalCents,
                      taxTreatment: effectiveTax,
                      gstCents: gstCalc.gstCents,
                      totalCents: totalAmountCents,
                    },
                  ],
                },
              },
            });

            // 1. Post INVOICE accrual journal (DR 1200 AR, CR Revenue, CR 2100 GST Collected)
            const invJournalLines: Array<{
              accountId: string;
              trackingOptionId?: string | null;
              entryType: EntryType;
              amountCents: bigint;
              description?: string;
            }> = [
              {
                accountId: arAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: totalAmountCents,
                description: `Invoice ${invoiceNumber} - ${contact.name}`,
              },
              {
                accountId: targetAccount.id,
                trackingOptionId: effectiveTrackingOptionId,
                entryType: EntryType.CREDIT,
                amountCents: subtotalCents,
                description: `${invoiceNumber}: ${narrative}`,
              },
            ];
            if (gstCalc.gstCents > 0n && gstCollectedAccount) {
              invJournalLines.push({
                accountId: gstCollectedAccount.id,
                entryType: EntryType.CREDIT,
                amountCents: gstCalc.gstCents,
                description: `GST Collected on Invoice ${invoiceNumber}`,
              });
            }

            await postJournalEntry(tx, {
              organizationId,
              actorUserId: request.user.userId,
              description: `Invoice ${invoiceNumber} issued to ${contact.name}`,
              referenceType: 'INVOICE',
              referenceId: newInvoice.id,
              postedAt: stmtLine.statementDate,
              status: JournalStatus.POSTED,
              lines: invJournalLines,
            });

            // 2. Record PaymentIn & post PAYMENT_IN settlement journal (DR Bank, CR 1200 AR)
            const paymentIn = await tx.paymentIn.create({
              data: {
                organizationId,
                invoiceId: newInvoice.id,
                contactId: contact.id,
                receiptType: PaymentReceiptType.INVOICE_PAYMENT,
                bankAccountId: bankAccount.id,
                paymentDate: stmtLine.statementDate,
                amountCents: totalAmountCents,
                reference: invoiceNumber,
              },
            });

            matchedEntry = await postJournalEntry(tx, {
              organizationId,
              actorUserId: request.user.userId,
              description: `Payment received for invoice ${invoiceNumber} from ${contact.name}`,
              referenceType: 'PAYMENT_IN',
              referenceId: paymentIn.id,
              postedAt: stmtLine.statementDate,
              status: JournalStatus.POSTED,
              lines: [
                {
                  accountId: bankAccount.id,
                  description: `Cash Receipt: Invoice ${invoiceNumber}`,
                  entryType: EntryType.DEBIT,
                  amountCents: totalAmountCents,
                },
                {
                  accountId: arAccount.id,
                  description: `AR Settlement: Invoice ${invoiceNumber}`,
                  entryType: EntryType.CREDIT,
                  amountCents: totalAmountCents,
                },
              ],
            });

            auditSummary = `Created & settled Invoice ${invoiceNumber} for ${contact.name} ($${(Number(totalAmountCents) / 100).toFixed(2)}) and reconciled`;
          }

          // Mark matched journal entry as reconciled
          await tx.journalEntry.update({
            where: { id: matchedEntry.id },
            data: {
              isReconciled: true,
              reconciledAt: now,
            },
          });

          // Mark statement line as reconciled
          const updatedLine = await tx.bankStatementLine.update({
            where: { id: stmtLine.id },
            data: {
              isReconciled: true,
              matchedJournalId: matchedEntry.id,
              reconciledAt: now,
              reconciledByUserId: request.user.userId,
            },
          });

          // Record audit log
          await recordAuditLog(tx, {
            organizationId,
            actorUserId: request.user.userId,
            action: 'BANK_STATEMENT_CREATED_AND_RECONCILED',
            entityType: 'BANK_STATEMENT_LINE',
            entityId: stmtLine.id,
            summary: auditSummary,
            metadata: {
              statementLineId: stmtLine.id,
              mode: effectiveMode,
              contactId: contact?.id ?? null,
              journalEntryId: matchedEntry.id,
              amountCents: Number(stmtLine.amountCents),
            },
          });

          return { entry: matchedEntry, updatedLine };
        });

        return reply.code(201).send({
          message: 'Transaction created and reconciled successfully.',
          journalEntry: serializeData(result.entry),
          statementLine: serializeData(result.updatedLine),
        });
      } catch (err: any) {
        return reply.code(400).send({
          error: err.message || 'Failed to create and reconcile transaction.',
        });
      }
    },
  );
};

export default bankingRoutes;
