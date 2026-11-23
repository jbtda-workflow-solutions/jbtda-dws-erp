/**
 * Tax Agent, Statutory & Period-Close Workbench Routes — Stage 19 (Wave 2).
 *
 * Designed for Australian Tax Agents, BAS Agents, and Senior Accountants
 * operating under `ACCOUNTANT` (full write/BAS/depreciation/lock) and `AUDITOR`
 * (read-only statutory review).
 *
 * Supported routes:
 *  - GET  /api/v1/tax/health-check              (Month-End & BAS Close Checklist + GST Exception Diagnostics)
 *  - GET  /api/v1/tax/bas-basis                 (Cash vs. Accrual ATO BAS Worksheet)
 *  - GET  /api/v1/tax/cash-flow                 (Statement of Cash Flows: Operating / Investing / Financing)
 *  - GET  /api/v1/tax/comparative-pl            (Comparative P&L: Current vs Prior Period / Prior Year)
 *  - GET  /api/v1/tax/fixed-assets              (List ATO Fixed Asset Register)
 *  - POST /api/v1/tax/fixed-assets              (Register new Fixed Asset)
 *  - POST /api/v1/tax/fixed-assets/run-depreciation (Post monthly ATO depreciation GL journal)
 *  - POST /api/v1/tax/fixed-assets/:id/dispose  (Dispose asset & post gain/loss journal)
 *  - GET  /api/v1/tax/workpaper-pack            (1-click EOFY Tax Agent Workpaper export)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  AccountType,
  DirectTransactionType,
  EntryType,
  JournalStatus,
  NormalBalance,
  Role,
  TaxTreatment,
} from '@prisma/client';
import { requireRole } from '../plugins/auth.js';
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

const CreateAssetSchema = z.object({
  assetNumber: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(150),
  category: z.string().trim().min(2).max(80),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costCents: z.coerce.number().int().positive(),
  residualValueCents: z.coerce.number().int().min(0).default(0),
  usefulLifeMonths: z.coerce.number().int().min(1).max(600).default(60),
  depreciationMethod: z.enum(['STRAIGHT_LINE', 'DIMINISHING_VALUE']).default('STRAIGHT_LINE'),
  depreciationRateBps: z.coerce.number().int().min(1).max(10000).default(2000),
  assetAccountId: z.string().uuid(),
  accumulatedDepAccountId: z.string().uuid(),
  depExpenseAccountId: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
});

const RunDepreciationSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  months: z.coerce.number().int().min(1).max(12).default(1),
});

const DisposeAssetSchema = z.object({
  disposalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  disposalProceedsCents: z.coerce.number().int().min(0),
  bankAccountId: z.string().uuid().optional(),
  gainLossAccountId: z.string().uuid(),
});

export const taxCloseRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // 19.2 GET /api/v1/tax/health-check
  // Month-End & BAS Close Checklist + GST Exception Diagnostics
  // -------------------------------------------------------------------------
  fastify.get<{ Querystring: { startDate?: string; endDate?: string } }>(
    '/api/v1/tax/health-check',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AUDITOR)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const today = new Date().toISOString().slice(0, 10);
      const startDateStr = request.query.startDate ?? `${today.slice(0, 4)}-07-01`;
      const endDateStr = request.query.endDate ?? today;
      const startDt = new Date(`${startDateStr}T00:00:00.000Z`);
      const endDt = new Date(`${endDateStr}T23:59:59.999Z`);

      const [
        org,
        unreconciledBankLinesCount,
        draftBillsCount,
        draftInvoicesCount,
        draftJournalsCount,
        pendingExpenseClaimsCount,
        billsWithGstMissingAbn,
        invoicesWithGstMissingAbn,
        openCreditNotesCount,
        openVendorCreditsCount,
      ] = await Promise.all([
        fastify.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true, abn: true, lockDate: true, fiscalYearStartMonth: true },
        }),
        fastify.prisma.bankStatementLine.count({
          where: {
            organizationId,
            isReconciled: false,
            statementDate: { lte: endDt },
          },
        }),
        fastify.prisma.bill.count({
          where: { organizationId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } },
        }),
        fastify.prisma.invoice.count({
          where: { organizationId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } },
        }),
        fastify.prisma.journalEntry.count({
          where: { organizationId, status: { in: [JournalStatus.DRAFT, JournalStatus.PENDING_APPROVAL] } },
        }),
        fastify.prisma.expenseClaim.count({
          where: { organizationId, status: { in: ['DRAFT', 'SUBMITTED'] } },
        }),
        // GST Exception 1: Posted Bills with GST > 0 where Supplier has no ABN (ATO requires ABN for tax invoices > $82.50)
        fastify.prisma.bill.findMany({
          where: {
            organizationId,
            status: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID'] },
            issueDate: { gte: startDt, lte: endDt },
            gstCents: { gt: 0n },
            contact: { OR: [{ abn: null }, { abn: '' }] },
          },
          take: 25,
          select: {
            id: true,
            reference: true,
            issueDate: true,
            totalCents: true,
            gstCents: true,
            contact: { select: { name: true } },
          },
        }),
        // GST Exception 2: Issued Invoices with GST > 0 where Customer has no ABN (advisory for B2B)
        fastify.prisma.invoice.findMany({
          where: {
            organizationId,
            status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
            issueDate: { gte: startDt, lte: endDt },
            gstCents: { gt: 0n },
            totalCents: { gte: 100000n }, // >= $1,000 ATO tax invoice threshold requiring buyer identity/ABN
            contact: { OR: [{ abn: null }, { abn: '' }] },
          },
          take: 25,
          select: {
            id: true,
            invoiceNumber: true,
            issueDate: true,
            totalCents: true,
            gstCents: true,
            contact: { select: { name: true } },
          },
        }),
        fastify.prisma.creditNote.count({
          where: { organizationId, status: 'ISSUED' },
        }),
        fastify.prisma.vendorCredit.count({
          where: { organizationId, status: 'ISSUED' },
        }),
      ]);

      const checklist = [
        {
          id: 'bank-reconciliation',
          label: 'All Bank Statement Lines Reconciled',
          status: unreconciledBankLinesCount === 0 ? 'PASS' : 'WARN',
          count: unreconciledBankLinesCount,
          detail:
            unreconciledBankLinesCount === 0
              ? 'Zero unreconciled bank lines up to period end.'
              : `${unreconciledBankLinesCount} bank statement line(s) still require reconciliation.`,
          href: '/bookkeeping',
        },
        {
          id: 'draft-documents',
          label: 'No Unposted Draft Bills, Invoices or Journals',
          status:
            draftBillsCount + draftInvoicesCount + draftJournalsCount === 0 ? 'PASS' : 'WARN',
          count: draftBillsCount + draftInvoicesCount + draftJournalsCount,
          detail: `${draftBillsCount} Draft Bills · ${draftInvoicesCount} Draft Invoices · ${draftJournalsCount} Draft Journals`,
          href: '/ledger',
        },
        {
          id: 'pending-claims',
          label: 'Employee Expense Claims Processed',
          status: pendingExpenseClaimsCount === 0 ? 'PASS' : 'WARN',
          count: pendingExpenseClaimsCount,
          detail:
            pendingExpenseClaimsCount === 0
              ? 'No draft or submitted claims pending.'
              : `${pendingExpenseClaimsCount} claim(s) awaiting submission or approval.`,
          href: '/expenses',
        },
        {
          id: 'gst-missing-abn-bills',
          label: 'ATO GST Input Credit Check (Vendor ABNs)',
          status: billsWithGstMissingAbn.length === 0 ? 'PASS' : 'FAIL',
          count: billsWithGstMissingAbn.length,
          detail:
            billsWithGstMissingAbn.length === 0
              ? 'All GST-bearing vendor bills have a valid supplier ABN.'
              : `${billsWithGstMissingAbn.length} vendor bill(s) claim GST input credits without a supplier ABN.`,
          href: '/bills',
        },
        {
          id: 'gst-missing-abn-invoices',
          label: 'ATO $1,000+ Tax Invoice Buyer ABN Check',
          status: invoicesWithGstMissingAbn.length === 0 ? 'PASS' : 'WARN',
          count: invoicesWithGstMissingAbn.length,
          detail:
            invoicesWithGstMissingAbn.length === 0
              ? 'All $1,000+ GST invoices have buyer ABN recorded.'
              : `${invoicesWithGstMissingAbn.length} invoice(s) >= $1,000 have no customer ABN recorded.`,
          href: '/invoices',
        },
        {
          id: 'open-credits',
          label: 'Unallocated AR/AP Credit Notes Reviewed',
          status: openCreditNotesCount + openVendorCreditsCount === 0 ? 'PASS' : 'INFO',
          count: openCreditNotesCount + openVendorCreditsCount,
          detail: `${openCreditNotesCount} AR Credit Note(s) · ${openVendorCreditsCount} Vendor Credit(s) open.`,
          href: '/invoices',
        },
      ];

      const passedChecks = checklist.filter((c) => c.status === 'PASS').length;

      return reply.send(
        serialize({
          period: { startDate: startDateStr, endDate: endDateStr },
          organization: {
            name: org?.name ?? '',
            abn: org?.abn ?? '',
            lockDate: org?.lockDate ? org.lockDate.toISOString().slice(0, 10) : null,
          },
          readinessScorePercent: Math.round((passedChecks / checklist.length) * 100),
          checklist,
          gstExceptions: {
            billsMissingVendorAbn: billsWithGstMissingAbn.map((b) => ({
              id: b.id,
              reference: b.reference || 'Vendor Bill',
              contactName: b.contact.name,
              issueDate: b.issueDate.toISOString().slice(0, 10),
              totalCents: b.totalCents,
              gstCents: b.gstCents,
            })),
            invoicesMissingCustomerAbn: invoicesWithGstMissingAbn.map((i) => ({
              id: i.id,
              invoiceNumber: i.invoiceNumber,
              contactName: i.contact.name,
              issueDate: i.issueDate.toISOString().slice(0, 10),
              totalCents: i.totalCents,
              gstCents: i.gstCents,
            })),
          },
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // 19.1 GET /api/v1/tax/bas-basis
  // Cash vs. Accrual ATO BAS Worksheet (G1, G3, G11, 1A, 1B, Net GST)
  // -------------------------------------------------------------------------
  fastify.get<{
    Querystring: { basis?: 'ACCRUAL' | 'CASH'; startDate?: string; endDate?: string };
  }>(
    '/api/v1/tax/bas-basis',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AUDITOR),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const basis = request.query.basis === 'CASH' ? 'CASH' : 'ACCRUAL';
      const today = new Date().toISOString().slice(0, 10);
      const startDateStr = request.query.startDate ?? `${today.slice(0, 4)}-07-01`;
      const endDateStr = request.query.endDate ?? today;
      const startDt = new Date(`${startDateStr}T00:00:00.000Z`);
      const endDt = new Date(`${endDateStr}T23:59:59.999Z`);

      let g1TotalSalesCents = 0n;
      let g3GstFreeSalesCents = 0n;
      let g11NonCapitalPurchasesCents = 0n;
      let box1aGstOnSalesCents = 0n;
      let box1bGstOnPurchasesCents = 0n;

      if (basis === 'ACCRUAL') {
        const [invoices, bills, directTxns, claims] = await Promise.all([
          fastify.prisma.invoice.findMany({
            where: {
              organizationId,
              status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
              issueDate: { gte: startDt, lte: endDt },
            },
            include: { lineItems: true },
          }),
          fastify.prisma.bill.findMany({
            where: {
              organizationId,
              status: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID'] },
              issueDate: { gte: startDt, lte: endDt },
            },
          }),
          fastify.prisma.directTransaction.findMany({
            where: {
              organizationId,
              transactionDate: { gte: startDt, lte: endDt },
            },
            include: { lines: true },
          }),
          fastify.prisma.expenseClaim.findMany({
            where: {
              organizationId,
              status: { in: ['APPROVED', 'PAID'] },
              approvedAt: { gte: startDt, lte: endDt },
            },
          }),
        ]);

        for (const inv of invoices) {
          g1TotalSalesCents += inv.totalCents;
          box1aGstOnSalesCents += inv.gstCents;
          for (const li of inv.lineItems) {
            if (li.taxTreatment === TaxTreatment.GST_FREE) {
              g3GstFreeSalesCents += li.totalCents;
            }
          }
        }
        for (const bill of bills) {
          g11NonCapitalPurchasesCents += bill.totalCents;
          box1bGstOnPurchasesCents += bill.gstCents;
        }
        for (const dt of directTxns) {
          if (dt.type === DirectTransactionType.RECEIVE_MONEY) {
            g1TotalSalesCents += dt.totalCents;
            box1aGstOnSalesCents += dt.gstCents;
            for (const li of dt.lines) {
              if (li.taxTreatment === TaxTreatment.GST_FREE) g3GstFreeSalesCents += li.totalCents;
            }
          } else {
            g11NonCapitalPurchasesCents += dt.totalCents;
            box1bGstOnPurchasesCents += dt.gstCents;
          }
        }
        for (const clm of claims) {
          g11NonCapitalPurchasesCents += clm.totalCents;
          box1bGstOnPurchasesCents += clm.gstCents;
        }
      } else {
        // CASH BASIS: GST recognized strictly on actual cash receipt/payment dates
        const [paymentsIn, paymentsOut, directTxns, paidClaims] = await Promise.all([
          fastify.prisma.paymentIn.findMany({
            where: {
              organizationId,
              paymentDate: { gte: startDt, lte: endDt },
            },
            include: {
              invoice: { select: { totalCents: true, gstCents: true } },
            },
          }),
          fastify.prisma.paymentOut.findMany({
            where: {
              organizationId,
              paymentDate: { gte: startDt, lte: endDt },
            },
            include: {
              bill: { select: { totalCents: true, gstCents: true } },
            },
          }),
          fastify.prisma.directTransaction.findMany({
            where: {
              organizationId,
              transactionDate: { gte: startDt, lte: endDt },
            },
            include: { lines: true },
          }),
          fastify.prisma.expenseClaim.findMany({
            where: {
              organizationId,
              status: 'PAID',
              paidAt: { gte: startDt, lte: endDt },
            },
          }),
        ]);

        for (const pi of paymentsIn) {
          g1TotalSalesCents += pi.amountCents;
          if (pi.invoice && pi.invoice.totalCents > 0n) {
            // Pro-rata GST collected on partial or full invoice settlement (integer math)
            const proRataGst = (pi.amountCents * pi.invoice.gstCents) / pi.invoice.totalCents;
            box1aGstOnSalesCents += proRataGst;
            if (pi.invoice.gstCents === 0n) g3GstFreeSalesCents += pi.amountCents;
          } else {
            box1aGstOnSalesCents += pi.gstCents;
            if (pi.gstCents === 0n) g3GstFreeSalesCents += pi.amountCents;
          }
        }

        for (const po of paymentsOut) {
          g11NonCapitalPurchasesCents += po.amountCents;
          if (po.bill && po.bill.totalCents > 0n) {
            const proRataGst = (po.amountCents * po.bill.gstCents) / po.bill.totalCents;
            box1bGstOnPurchasesCents += proRataGst;
          }
        }

        for (const dt of directTxns) {
          if (dt.type === DirectTransactionType.RECEIVE_MONEY) {
            g1TotalSalesCents += dt.totalCents;
            box1aGstOnSalesCents += dt.gstCents;
            for (const li of dt.lines) {
              if (li.taxTreatment === TaxTreatment.GST_FREE) g3GstFreeSalesCents += li.totalCents;
            }
          } else {
            g11NonCapitalPurchasesCents += dt.totalCents;
            box1bGstOnPurchasesCents += dt.gstCents;
          }
        }

        for (const clm of paidClaims) {
          g11NonCapitalPurchasesCents += clm.totalCents;
          box1bGstOnPurchasesCents += clm.gstCents;
        }
      }

      const netGstPayableCents = box1aGstOnSalesCents - box1bGstOnPurchasesCents;

      return reply.send(
        serialize({
          basis,
          period: { startDate: startDateStr, endDate: endDateStr },
          boxes: {
            g1TotalSalesCents,
            g3GstFreeSalesCents,
            g11NonCapitalPurchasesCents,
            box1aGstOnSalesCents,
            box1bGstOnPurchasesCents,
            netGstPayableCents,
          },
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // 19.3a GET /api/v1/tax/cash-flow
  // Statement of Cash Flows (Operating, Investing, Financing)
  // -------------------------------------------------------------------------
  fastify.get<{ Querystring: { startDate?: string; endDate?: string } }>(
    '/api/v1/tax/cash-flow',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AUDITOR),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const today = new Date().toISOString().slice(0, 10);
      const startDateStr = request.query.startDate ?? `${today.slice(0, 4)}-07-01`;
      const endDateStr = request.query.endDate ?? today;
      const startDt = new Date(`${startDateStr}T00:00:00.000Z`);
      const endDt = new Date(`${endDateStr}T23:59:59.999Z`);

      const bankAccounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          OR: [{ isBankAccount: true }, { type: AccountType.ASSET, code: { startsWith: '10' } }],
        },
        select: { id: true },
      });
      const bankIds = new Set(bankAccounts.map((a) => a.id));

      const allBankLines = await fastify.prisma.journalLine.findMany({
        where: {
          organizationId,
          accountId: { in: Array.from(bankIds) },
          journalEntry: {
            status: JournalStatus.POSTED,
            postedAt: { lte: endDt },
          },
        },
        include: {
          journalEntry: {
            select: {
              id: true,
              postedAt: true,
              referenceType: true,
              lines: {
                select: {
                  accountId: true,
                  account: { select: { type: true, code: true } },
                },
              },
            },
          },
        },
      });

      let openingCashCents = 0n;
      let operatingInflowsCents = 0n;
      let operatingOutflowsCents = 0n;
      let investingNetCents = 0n;
      let financingNetCents = 0n;

      for (const bl of allBankLines) {
        const cashDelta = bl.entryType === EntryType.DEBIT ? bl.amountCents : -bl.amountCents;
        if (bl.journalEntry.postedAt < startDt) {
          openingCashCents += cashDelta;
          continue;
        }

        // Skip internal bank-to-bank transfers (net zero cash across consolidated cash)
        if (bl.journalEntry.referenceType === 'BANK_TRANSFER') continue;

        const counterLines = bl.journalEntry.lines.filter((l) => !bankIds.has(l.accountId));
        const hasEquity = counterLines.some((l) => l.account.type === AccountType.EQUITY);
        const hasFixedAsset = counterLines.some(
          (l) => l.account.type === AccountType.ASSET && l.account.code.startsWith('15'),
        );

        if (hasEquity) {
          financingNetCents += cashDelta;
        } else if (hasFixedAsset) {
          investingNetCents += cashDelta;
        } else {
          if (cashDelta >= 0n) operatingInflowsCents += cashDelta;
          else operatingOutflowsCents += -cashDelta;
        }
      }

      const operatingNetCents = operatingInflowsCents - operatingOutflowsCents;
      const netCashChangeCents = operatingNetCents + investingNetCents + financingNetCents;
      const closingCashCents = openingCashCents + netCashChangeCents;

      return reply.send(
        serialize({
          period: { startDate: startDateStr, endDate: endDateStr },
          openingCashCents,
          operating: {
            inflowsCents: operatingInflowsCents,
            outflowsCents: operatingOutflowsCents,
            netCents: operatingNetCents,
          },
          investing: { netCents: investingNetCents },
          financing: { netCents: financingNetCents },
          netCashChangeCents,
          closingCashCents,
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // 19.3b GET /api/v1/tax/comparative-pl
  // Comparative Profit & Loss (Current vs Prior Period or Prior Year)
  // -------------------------------------------------------------------------
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      compareMode?: 'PRIOR_PERIOD' | 'PRIOR_YEAR';
    };
  }>(
    '/api/v1/tax/comparative-pl',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AUDITOR),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const today = new Date().toISOString().slice(0, 10);
      const startDateStr = request.query.startDate ?? `${today.slice(0, 4)}-07-01`;
      const endDateStr = request.query.endDate ?? today;
      const compareMode =
        request.query.compareMode === 'PRIOR_YEAR' ? 'PRIOR_YEAR' : 'PRIOR_PERIOD';

      const curStart = new Date(`${startDateStr}T00:00:00.000Z`);
      const curEnd = new Date(`${endDateStr}T23:59:59.999Z`);

      let priorStart: Date;
      let priorEnd: Date;
      if (compareMode === 'PRIOR_YEAR') {
        priorStart = new Date(curStart);
        priorStart.setUTCFullYear(priorStart.getUTCFullYear() - 1);
        priorEnd = new Date(curEnd);
        priorEnd.setUTCFullYear(priorEnd.getUTCFullYear() - 1);
      } else {
        const spanMs = Math.max(86_400_000, curEnd.getTime() - curStart.getTime());
        priorEnd = new Date(curStart.getTime() - 1);
        priorStart = new Date(priorEnd.getTime() - spanMs);
      }

      const [accounts, lines] = await Promise.all([
        fastify.prisma.account.findMany({
          where: {
            organizationId,
            type: { in: [AccountType.REVENUE, AccountType.EXPENSE] },
          },
          orderBy: { code: 'asc' },
          select: { id: true, code: true, name: true, type: true },
        }),
        fastify.prisma.journalLine.findMany({
          where: {
            organizationId,
            account: { type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } },
            journalEntry: {
              status: JournalStatus.POSTED,
              postedAt: { gte: priorStart, lte: curEnd },
            },
          },
          select: {
            accountId: true,
            entryType: true,
            amountCents: true,
            journalEntry: { select: { postedAt: true } },
            account: { select: { type: true } },
          },
        }),
      ]);

      const curMap = new Map<string, bigint>();
      const priorMap = new Map<string, bigint>();

      for (const l of lines) {
        const dt = l.journalEntry.postedAt;
        const val =
          l.account.type === AccountType.REVENUE
            ? l.entryType === EntryType.CREDIT
              ? l.amountCents
              : -l.amountCents
            : l.entryType === EntryType.DEBIT
              ? l.amountCents
              : -l.amountCents;

        if (dt >= curStart && dt <= curEnd) {
          curMap.set(l.accountId, (curMap.get(l.accountId) ?? 0n) + val);
        } else if (dt >= priorStart && dt <= priorEnd) {
          priorMap.set(l.accountId, (priorMap.get(l.accountId) ?? 0n) + val);
        }
      }

      const buildRows = (type: AccountType) =>
        accounts
          .filter((a) => a.type === type)
          .map((a) => {
            const currentCents = curMap.get(a.id) ?? 0n;
            const priorCents = priorMap.get(a.id) ?? 0n;
            const varianceCents = currentCents - priorCents;
            const varianceBps =
              priorCents !== 0n
                ? Number((varianceCents * 10000n) / (priorCents < 0n ? -priorCents : priorCents))
                : null;
            return {
              accountId: a.id,
              code: a.code,
              name: a.name,
              currentCents,
              priorCents,
              varianceCents,
              varianceBps,
            };
          })
          .filter((r) => r.currentCents !== 0n || r.priorCents !== 0n);

      const revenue = buildRows(AccountType.REVENUE);
      const expenses = buildRows(AccountType.EXPENSE);

      const curRev = revenue.reduce((s, r) => s + r.currentCents, 0n);
      const priorRev = revenue.reduce((s, r) => s + r.priorCents, 0n);
      const curExp = expenses.reduce((s, r) => s + r.currentCents, 0n);
      const priorExp = expenses.reduce((s, r) => s + r.priorCents, 0n);

      return reply.send(
        serialize({
          compareMode,
          currentPeriod: { startDate: startDateStr, endDate: endDateStr },
          priorPeriod: {
            startDate: priorStart.toISOString().slice(0, 10),
            endDate: priorEnd.toISOString().slice(0, 10),
          },
          revenue,
          expenses,
          totals: {
            currentRevenueCents: curRev,
            priorRevenueCents: priorRev,
            currentExpenseCents: curExp,
            priorExpenseCents: priorExp,
            currentNetProfitCents: curRev - curExp,
            priorNetProfitCents: priorRev - priorExp,
            netProfitVarianceCents: curRev - curExp - (priorRev - priorExp),
          },
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // 19.4 Fixed Asset Register, Auto-Depreciation & Disposal
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/tax/fixed-assets',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AUDITOR)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const assets = await fastify.prisma.fixedAsset.findMany({
        where: { organizationId },
        orderBy: [{ status: 'asc' }, { purchaseDate: 'desc' }],
      });

      const enriched = assets.map((a) => ({
        ...a,
        writtenDownValueCents:
          a.costCents > a.accumulatedDepCents ? a.costCents - a.accumulatedDepCents : 0n,
      }));

      return reply.send(serialize({ assets: enriched }));
    },
  );

  fastify.post(
    '/api/v1/tax/fixed-assets',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = CreateAssetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid fixed asset.' });
      }

      const d = parsed.data;
      const asset = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.fixedAsset.create({
          data: {
            organizationId,
            assetNumber: d.assetNumber,
            name: d.name,
            category: d.category,
            purchaseDate: new Date(`${d.purchaseDate}T00:00:00.000Z`),
            costCents: BigInt(d.costCents),
            residualValueCents: BigInt(d.residualValueCents),
            usefulLifeMonths: d.usefulLifeMonths,
            depreciationMethod: d.depreciationMethod,
            depreciationRateBps: d.depreciationRateBps,
            assetAccountId: d.assetAccountId,
            accumulatedDepAccountId: d.accumulatedDepAccountId,
            depExpenseAccountId: d.depExpenseAccountId,
            notes: d.notes ?? null,
            createdByUserId: request.user.userId,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'FIXED_ASSET_CREATED',
          entityType: 'FIXED_ASSET',
          entityId: created.id,
          summary: `Registered fixed asset ${created.assetNumber} "${created.name}" ($${(Number(created.costCents) / 100).toFixed(2)}).`,
        });

        return created;
      });

      return reply.code(201).send(serialize({ asset }));
    },
  );

  fastify.post(
    '/api/v1/tax/fixed-assets/run-depreciation',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = RunDepreciationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid depreciation run.' });
      }

      const { asOfDate, months } = parsed.data;
      const postedAt = new Date(`${asOfDate}T00:00:00.000Z`);

      try {
        const result = await fastify.prisma.$transaction(async (tx) => {
          const lockCheck = await checkOrganizationLockDate(tx, organizationId, postedAt);
          if (lockCheck.locked) throw new Error(lockCheck.message);

          const activeAssets = await tx.fixedAsset.findMany({
            where: {
              organizationId,
              status: 'ACTIVE',
              purchaseDate: { lte: postedAt },
            },
          });

          const journalLines: JournalLineInput[] = [];
          let totalDepCents = 0n;
          let depreciatedAssetsCount = 0;

          for (const asset of activeAssets) {
            const depreciableCap = asset.costCents - asset.residualValueCents;
            const remainingDepreciable = depreciableCap - asset.accumulatedDepCents;
            if (remainingDepreciable <= 0n) continue;

            // Integer-cent ATO Straight-Line or Diminishing-Value calculation
            let depCents = 0n;
            if (asset.depreciationMethod === 'DIMINISHING_VALUE') {
              const wdv = asset.costCents - asset.accumulatedDepCents;
              depCents = (wdv * BigInt(asset.depreciationRateBps) * BigInt(months)) / 120_000n;
            } else {
              depCents =
                (depreciableCap * BigInt(months)) / BigInt(Math.max(1, asset.usefulLifeMonths));
            }

            if (depCents > remainingDepreciable) depCents = remainingDepreciable;
            if (depCents <= 0n) continue;

            journalLines.push({
              accountId: asset.depExpenseAccountId,
              entryType: EntryType.DEBIT,
              amountCents: depCents,
              description: `Depreciation (${months}m): ${asset.assetNumber} ${asset.name}`,
            });
            journalLines.push({
              accountId: asset.accumulatedDepAccountId,
              entryType: EntryType.CREDIT,
              amountCents: depCents,
              description: `Accumulated Depreciation: ${asset.assetNumber} ${asset.name}`,
            });

            await tx.fixedAsset.update({
              where: { id: asset.id },
              data: {
                accumulatedDepCents: asset.accumulatedDepCents + depCents,
                lastDepreciatedAt: postedAt,
              },
            });

            totalDepCents += depCents;
            depreciatedAssetsCount++;
          }

          if (journalLines.length === 0) {
            throw new Error('No active assets have remaining depreciable value as at this date.');
          }

          const journal = await postJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: `ATO Fixed Asset Depreciation Run (${months}m to ${asOfDate})`,
            referenceType: 'DEPRECIATION',
            referenceId: organizationId,
            postedAt,
            lines: journalLines,
          });

          return {
            journalId: journal.id,
            entryNumber: journal.entryNumber,
            depreciatedAssetsCount,
            totalDepCents,
          };
        });

        return reply.send(serialize({ ok: true, ...result }));
      } catch (err: any) {
        return reply.code(400).send({ error: err.message || 'Depreciation run failed.' });
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/tax/fixed-assets/:id/dispose',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = DisposeAssetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid disposal payload.' });
      }

      const { disposalDate, disposalProceedsCents, bankAccountId, gainLossAccountId } = parsed.data;
      const postedAt = new Date(`${disposalDate}T00:00:00.000Z`);

      try {
        const result = await fastify.prisma.$transaction(async (tx) => {
          const lockCheck = await checkOrganizationLockDate(tx, organizationId, postedAt);
          if (lockCheck.locked) throw new Error(lockCheck.message);

          const asset = await tx.fixedAsset.findFirst({
            where: { id: request.params.id, organizationId },
          });
          if (!asset) throw new Error('Fixed asset not found.');
          if (asset.status === 'DISPOSED') throw new Error('Asset is already disposed.');

          const proceeds = BigInt(disposalProceedsCents);
          const wdv = asset.costCents - asset.accumulatedDepCents;
          const gainOrLoss = proceeds - wdv; // positive = gain (CREDIT), negative = loss (DEBIT)

          const lines: JournalLineInput[] = [];
          if (proceeds > 0n) {
            if (!bankAccountId) {
              throw new Error('Select a bank account to receive disposal proceeds.');
            }
            lines.push({
              accountId: bankAccountId,
              entryType: EntryType.DEBIT,
              amountCents: proceeds,
              description: `Disposal proceeds: ${asset.assetNumber} ${asset.name}`,
            });
          }
          if (asset.accumulatedDepCents > 0n) {
            lines.push({
              accountId: asset.accumulatedDepAccountId,
              entryType: EntryType.DEBIT,
              amountCents: asset.accumulatedDepCents,
              description: `Clear accumulated dep: ${asset.assetNumber}`,
            });
          }
          if (gainOrLoss < 0n) {
            lines.push({
              accountId: gainLossAccountId,
              entryType: EntryType.DEBIT,
              amountCents: -gainOrLoss,
              description: `Loss on disposal: ${asset.assetNumber}`,
            });
          }
          lines.push({
            accountId: asset.assetAccountId,
            entryType: EntryType.CREDIT,
            amountCents: asset.costCents,
            description: `Derecognise asset cost: ${asset.assetNumber}`,
          });
          if (gainOrLoss > 0n) {
            lines.push({
              accountId: gainLossAccountId,
              entryType: EntryType.CREDIT,
              amountCents: gainOrLoss,
              description: `Gain on disposal: ${asset.assetNumber}`,
            });
          }

          const journal = await postJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: `Fixed Asset Disposal: ${asset.assetNumber} ${asset.name}`,
            referenceType: 'ASSET_DISPOSAL',
            referenceId: asset.id,
            postedAt,
            lines,
          });

          await tx.fixedAsset.update({
            where: { id: asset.id },
            data: {
              status: 'DISPOSED',
              disposalDate: postedAt,
              disposalProceedsCents: proceeds,
            },
          });

          return { journalId: journal.id, entryNumber: journal.entryNumber, gainOrLossCents: gainOrLoss };
        });

        return reply.send(serialize({ ok: true, ...result }));
      } catch (err: any) {
        return reply.code(400).send({ error: err.message || 'Asset disposal failed.' });
      }
    },
  );

  // -------------------------------------------------------------------------
  // 19.4b GET /api/v1/tax/workpaper-pack
  // 1-Click EOFY Tax Agent Workpaper CSV Export
  // -------------------------------------------------------------------------
  fastify.get<{ Querystring: { asOfDate?: string } }>(
    '/api/v1/tax/workpaper-pack',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AUDITOR)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const asOfDateStr = request.query.asOfDate ?? new Date().toISOString().slice(0, 10);
      const asOfEnd = new Date(`${asOfDateStr}T23:59:59.999Z`);

      const [org, accounts, assets] = await Promise.all([
        fastify.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true, abn: true, lockDate: true },
        }),
        fastify.prisma.account.findMany({
          where: { organizationId, isActive: true },
          orderBy: { code: 'asc' },
          include: {
            journalLines: {
              where: {
                journalEntry: { status: JournalStatus.POSTED, postedAt: { lte: asOfEnd } },
              },
              select: { entryType: true, amountCents: true },
            },
          },
        }),
        fastify.prisma.fixedAsset.findMany({
          where: { organizationId },
          orderBy: { assetNumber: 'asc' },
        }),
      ]);

      const csvRows: string[] = [
        `"JBTDA-DWS ERP Tax Agent Workpaper Pack"`,
        `"Entity","${(org?.name ?? '').replace(/"/g, '""')}","ABN","${org?.abn ?? ''}","As Of","${asOfDateStr}"`,
        '',
        '"SECTION 1: TRIAL BALANCE"',
        '"Code","Account Name","Type","Debits (AUD)","Credits (AUD)","Net Balance (AUD)"',
      ];

      for (const acc of accounts) {
        let dr = 0n;
        let cr = 0n;
        for (const l of acc.journalLines) {
          if (l.entryType === EntryType.DEBIT) dr += l.amountCents;
          else cr += l.amountCents;
        }
        if (dr === 0n && cr === 0n) continue;
        const net = acc.normalBalance === NormalBalance.DEBIT ? dr - cr : cr - dr;
        csvRows.push(
          `"${acc.code}","${acc.name.replace(/"/g, '""')}","${acc.type}",${(Number(dr) / 100).toFixed(2)},${(Number(cr) / 100).toFixed(2)},${(Number(net) / 100).toFixed(2)}`,
        );
      }

      csvRows.push('');
      csvRows.push('"SECTION 2: FIXED ASSET REGISTER"');
      csvRows.push('"Asset #","Name","Category","Purchase Date","Method","Cost (AUD)","Accumulated Dep (AUD)","WDV (AUD)","Status"');

      for (const a of assets) {
        const wdv = a.costCents > a.accumulatedDepCents ? a.costCents - a.accumulatedDepCents : 0n;
        csvRows.push(
          `"${a.assetNumber}","${a.name.replace(/"/g, '""')}","${a.category.replace(/"/g, '""')}","${a.purchaseDate.toISOString().slice(0, 10)}","${a.depreciationMethod}",${(Number(a.costCents) / 100).toFixed(2)},${(Number(a.accumulatedDepCents) / 100).toFixed(2)},${(Number(wdv) / 100).toFixed(2)},"${a.status}"`,
        );
      }

      const filename = `tax-workpaper-pack-${asOfDateStr}.csv`;
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csvRows.join('\n'));
    },
  );
};

export default taxCloseRoutes;
