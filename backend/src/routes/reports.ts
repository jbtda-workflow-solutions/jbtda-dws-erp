/**
 * Financial Reports & Australian BAS Engine — Module 8.
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET  /api/v1/reports/trial-balance    (Point-in-time Trial Balance verifying debits == credits)
 *  - GET  /api/v1/reports/profit-and-loss  (Income Statement over date range with tracking dimensions)
 *  - GET  /api/v1/reports/balance-sheet    (Point-in-time Balance Sheet with Current Year Earnings)
 *  - GET  /api/v1/reports/aged-receivables (Aged AR bucketed into Current, 1-30, 31-60, 61-90, 90+)
 *  - GET  /api/v1/reports/aged-payables    (Aged AP bucketed into Current, 1-30, 31-60, 61-90, 90+)
 *  - GET  /api/v1/reports/bas              (ATO Business Activity Statement worksheet G1, 1A, 1B)
 *  - POST /api/v1/reports/bas/lock         (Set organization lock date to freeze accounting period)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireOrgAuth, requireRole } from '../plugins/auth.js';
import { recordAuditLog } from '../lib/audit.js';
import {
  AccountType,
  EntryType,
  JournalStatus,
  NormalBalance,
  Role,
  TaxTreatment,
} from '@prisma/client';

function serialize<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

const DateQuerySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const DateRangeQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  trackingOptionId: z.string().uuid().optional(),
});

const BasQuerySchema = z.object({
  period: z.enum(['MONTHLY', 'QUARTERLY']).optional().default('QUARTERLY'),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const LockBasBodySchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const reportRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/reports/trial-balance — Point-in-time Trial Balance
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/reports/trial-balance',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = DateQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid asOfDate query parameter (YYYY-MM-DD).' });
      }

      const asOfDateStr = parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10);
      const asOfDateEnd = new Date(`${asOfDateStr}T23:59:59.999Z`);

      const accounts = await fastify.prisma.account.findMany({
        where: { organizationId, isActive: true },
        orderBy: { code: 'asc' },
        include: {
          journalLines: {
            where: {
              journalEntry: {
                status: JournalStatus.POSTED,
                postedAt: { lte: asOfDateEnd },
              },
            },
            select: {
              entryType: true,
              amountCents: true,
            },
          },
        },
      });

      let totalDebitsCents = 0n;
      let totalCreditsCents = 0n;

      const reportAccounts = accounts.map((acc) => {
        let debits = 0n;
        let credits = 0n;

        for (const line of acc.journalLines) {
          if (line.entryType === EntryType.DEBIT) {
            debits += line.amountCents;
          } else {
            credits += line.amountCents;
          }
        }

        totalDebitsCents += debits;
        totalCreditsCents += credits;

        // Calculate net balance for normal display
        const netBalanceCents =
          acc.normalBalance === NormalBalance.DEBIT
            ? debits - credits
            : credits - debits;

        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          normalBalance: acc.normalBalance,
          debitsCents: debits,
          creditsCents: credits,
          netBalanceCents,
        };
      });

      return reply.send(
        serialize({
          asOfDate: asOfDateStr,
          totalDebitsCents,
          totalCreditsCents,
          isBalanced: totalDebitsCents === totalCreditsCents,
          differenceCents: totalDebitsCents - totalCreditsCents,
          accounts: reportAccounts,
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/reports/profit-and-loss — Income Statement over date range
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/reports/profit-and-loss',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = DateRangeQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid date range or trackingOptionId query parameter.' });
      }

      // Default: current calendar year to date
      const now = new Date();
      const defaultStart = `${now.getFullYear()}-01-01`;
      const defaultEnd = now.toISOString().slice(0, 10);

      const startDateStr = parsed.data.startDate ?? defaultStart;
      const endDateStr = parsed.data.endDate ?? defaultEnd;
      const { trackingOptionId } = parsed.data;

      const startDate = new Date(`${startDateStr}T00:00:00.000Z`);
      const endDate = new Date(`${endDateStr}T23:59:59.999Z`);

      // Find revenue and expense accounts
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          type: { in: [AccountType.REVENUE, AccountType.EXPENSE] },
        },
        orderBy: { code: 'asc' },
        include: {
          journalLines: {
            where: {
              ...(trackingOptionId ? { trackingOptionId } : {}),
              journalEntry: {
                status: JournalStatus.POSTED,
                postedAt: { gte: startDate, lte: endDate },
              },
            },
            select: {
              entryType: true,
              amountCents: true,
            },
          },
        },
      });

      // Split into Revenue, Cost of Goods Sold (COGS), and Operating Expenses
      const revenueRows: Array<{ id: string; code: string; name: string; amountCents: bigint }> = [];
      const cogsRows: Array<{ id: string; code: string; name: string; amountCents: bigint }> = [];
      const expenseRows: Array<{ id: string; code: string; name: string; amountCents: bigint }> = [];

      let totalRevenueCents = 0n;
      let totalCogsCents = 0n;
      let totalOperatingExpenseCents = 0n;

      for (const acc of accounts) {
        let debits = 0n;
        let credits = 0n;

        for (const line of acc.journalLines) {
          if (line.entryType === EntryType.DEBIT) {
            debits += line.amountCents;
          } else {
            credits += line.amountCents;
          }
        }

        if (acc.type === AccountType.REVENUE) {
          // Revenue normal balance is CREDIT: amount = credits - debits
          const net = credits - debits;
          if (net !== 0n || acc.code === '4000') {
            revenueRows.push({ id: acc.id, code: acc.code, name: acc.name, amountCents: net });
            totalRevenueCents += net;
          }
        } else if (acc.type === AccountType.EXPENSE) {
          // Expense normal balance is DEBIT: amount = debits - credits
          const net = debits - credits;
          const isCogs =
            acc.code.startsWith('5') ||
            acc.name.toLowerCase().includes('cost of goods sold') ||
            acc.name.toLowerCase().includes('cogs') ||
            acc.name.toLowerCase().includes('direct cost');

          if (isCogs) {
            if (net !== 0n) {
              cogsRows.push({ id: acc.id, code: acc.code, name: acc.name, amountCents: net });
              totalCogsCents += net;
            }
          } else {
            if (net !== 0n || acc.code === '6000') {
              expenseRows.push({ id: acc.id, code: acc.code, name: acc.name, amountCents: net });
              totalOperatingExpenseCents += net;
            }
          }
        }
      }

      const grossProfitCents = totalRevenueCents - totalCogsCents;
      const netOperatingProfitCents = grossProfitCents - totalOperatingExpenseCents;

      // Optional tracking option metadata for header display
      let trackingOptionName: string | null = null;
      if (trackingOptionId) {
        const opt = await fastify.prisma.trackingOption.findFirst({
          where: { id: trackingOptionId, organizationId },
          include: { trackingCategory: true },
        });
        if (opt) {
          trackingOptionName = `${opt.trackingCategory.name}: ${opt.name}`;
        }
      }

      return reply.send(
        serialize({
          startDate: startDateStr,
          endDate: endDateStr,
          trackingOptionId: trackingOptionId ?? null,
          trackingOptionName,
          revenue: revenueRows,
          totalRevenueCents,
          costOfGoodsSold: cogsRows,
          totalCogsCents,
          grossProfitCents,
          operatingExpenses: expenseRows,
          totalOperatingExpenseCents,
          netOperatingProfitCents,
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/reports/balance-sheet — Point-in-time Balance Sheet
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/reports/balance-sheet',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = DateQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid asOfDate query parameter.' });
      }

      const asOfDateStr = parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10);
      const asOfDateEnd = new Date(`${asOfDateStr}T23:59:59.999Z`);

      // All active accounts
      const accounts = await fastify.prisma.account.findMany({
        where: { organizationId, isActive: true },
        orderBy: { code: 'asc' },
        include: {
          journalLines: {
            where: {
              journalEntry: {
                status: JournalStatus.POSTED,
                postedAt: { lte: asOfDateEnd },
              },
            },
            select: {
              entryType: true,
              amountCents: true,
            },
          },
        },
      });

      // Group accounts
      const currentAssetRows: Array<{ id: string; code: string; name: string; amountCents: bigint }> = [];
      const nonCurrentAssetRows: Array<{ id: string; code: string; name: string; amountCents: bigint }> = [];
      let totalCurrentAssetsCents = 0n;
      let totalNonCurrentAssetsCents = 0n;

      const currentLiabilityRows: Array<{ id: string; code: string; name: string; amountCents: bigint }> = [];
      const nonCurrentLiabilityRows: Array<{ id: string; code: string; name: string; amountCents: bigint }> = [];
      let totalCurrentLiabilitiesCents = 0n;
      let totalNonCurrentLiabilitiesCents = 0n;

      const equityRows: Array<{ id: string; code: string; name: string; amountCents: bigint }> = [];
      let totalStaticEquityCents = 0n;

      // Net income / Current year earnings accumulator
      let cumulativeRevenueCredits = 0n;
      let cumulativeRevenueDebits = 0n;
      let cumulativeExpenseDebits = 0n;
      let cumulativeExpenseCredits = 0n;

      for (const acc of accounts) {
        let debits = 0n;
        let credits = 0n;

        for (const line of acc.journalLines) {
          if (line.entryType === EntryType.DEBIT) {
            debits += line.amountCents;
          } else {
            credits += line.amountCents;
          }
        }

        if (acc.type === AccountType.ASSET) {
          // Normal balance DEBIT: net = debits - credits
          const net = debits - credits;
          const isNonCurrent =
            acc.code.startsWith('17') ||
            acc.code.startsWith('18') ||
            acc.code.startsWith('19') ||
            acc.name.toLowerCase().includes('fixed asset') ||
            acc.name.toLowerCase().includes('property') ||
            acc.name.toLowerCase().includes('plant') ||
            acc.name.toLowerCase().includes('depreciation');

          if (isNonCurrent) {
            if (net !== 0n) {
              nonCurrentAssetRows.push({ id: acc.id, code: acc.code, name: acc.name, amountCents: net });
              totalNonCurrentAssetsCents += net;
            }
          } else {
            if (net !== 0n || acc.code === '1000' || acc.code === '1200') {
              currentAssetRows.push({ id: acc.id, code: acc.code, name: acc.name, amountCents: net });
              totalCurrentAssetsCents += net;
            }
          }
        } else if (acc.type === AccountType.LIABILITY) {
          // Normal balance CREDIT: net = credits - debits
          const net = credits - debits;
          const isNonCurrent =
            acc.code.startsWith('27') ||
            acc.code.startsWith('28') ||
            acc.code.startsWith('29') ||
            acc.name.toLowerCase().includes('non-current') ||
            acc.name.toLowerCase().includes('long term') ||
            acc.name.toLowerCase().includes('mortgage');

          if (isNonCurrent) {
            if (net !== 0n) {
              nonCurrentLiabilityRows.push({ id: acc.id, code: acc.code, name: acc.name, amountCents: net });
              totalNonCurrentLiabilitiesCents += net;
            }
          } else {
            if (net !== 0n || acc.code === '2000' || acc.code === '2100') {
              currentLiabilityRows.push({ id: acc.id, code: acc.code, name: acc.name, amountCents: net });
              totalCurrentLiabilitiesCents += net;
            }
          }
        } else if (acc.type === AccountType.EQUITY) {
          // Normal balance CREDIT: net = credits - debits
          const net = credits - debits;
          equityRows.push({ id: acc.id, code: acc.code, name: acc.name, amountCents: net });
          totalStaticEquityCents += net;
        } else if (acc.type === AccountType.REVENUE) {
          cumulativeRevenueCredits += credits;
          cumulativeRevenueDebits += debits;
        } else if (acc.type === AccountType.EXPENSE) {
          cumulativeExpenseDebits += debits;
          cumulativeExpenseCredits += credits;
        }
      }

      // Dynamic Current Year Earnings / Unappropriated Profit:
      // (Net Revenue) - (Net Expenses) = (Credits - Debits) - (Debits - Credits)
      const currentYearEarningsCents =
        cumulativeRevenueCredits -
        cumulativeRevenueDebits -
        (cumulativeExpenseDebits - cumulativeExpenseCredits);

      const totalAssetsCents = totalCurrentAssetsCents + totalNonCurrentAssetsCents;
      const totalLiabilitiesCents = totalCurrentLiabilitiesCents + totalNonCurrentLiabilitiesCents;
      const totalEquityCents = totalStaticEquityCents + currentYearEarningsCents;
      const totalLiabilitiesAndEquityCents = totalLiabilitiesCents + totalEquityCents;

      const isBalanced = totalAssetsCents === totalLiabilitiesAndEquityCents;
      const discrepancyCents = totalAssetsCents - totalLiabilitiesAndEquityCents;

      return reply.send(
        serialize({
          asOfDate: asOfDateStr,
          assets: {
            currentAssets: currentAssetRows,
            totalCurrentAssetsCents,
            nonCurrentAssets: nonCurrentAssetRows,
            totalNonCurrentAssetsCents,
            totalAssetsCents,
          },
          liabilities: {
            currentLiabilities: currentLiabilityRows,
            totalCurrentLiabilitiesCents,
            nonCurrentLiabilities: nonCurrentLiabilityRows,
            totalNonCurrentLiabilitiesCents,
            totalLiabilitiesCents,
          },
          equity: {
            accounts: equityRows,
            totalStaticEquityCents,
            currentYearEarningsCents,
            totalEquityCents,
          },
          totalAssetsCents,
          totalLiabilitiesAndEquityCents,
          isBalanced,
          discrepancyCents,
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/reports/aged-receivables — Accounts Receivable Aging
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/reports/aged-receivables',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = DateQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid asOfDate query parameter.' });
      }

      const asOfDateStr = parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10);
      const asOfDate = new Date(`${asOfDateStr}T23:59:59.999Z`);

      // Open Customer Invoices as of date
      const invoices = await fastify.prisma.invoice.findMany({
        where: {
          organizationId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
          issueDate: { lte: asOfDate },
        },
        include: {
          contact: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: [{ contact: { name: 'asc' } }, { dueDate: 'asc' }],
      });

      // Aging totals
      let grandTotalOutstandingCents = 0n;
      let totalCurrentCents = 0n;
      let totalDays1to30Cents = 0n;
      let totalDays31to60Cents = 0n;
      let totalDays61to90Cents = 0n;
      let totalDays90PlusCents = 0n;

      const contactMap = new Map<
        string,
        {
          contactId: string;
          contactName: string;
          contactEmail?: string | null;
          currentCents: bigint;
          days1to30Cents: bigint;
          days31to60Cents: bigint;
          days61to90Cents: bigint;
          days90PlusCents: bigint;
          totalCents: bigint;
          invoices: Array<{
            id: string;
            invoiceNumber: string;
            issueDate: string;
            dueDate: string;
            daysOverdue: number;
            totalCents: bigint;
            amountPaidCents: bigint;
            balanceDueCents: bigint;
            bucket: 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+';
          }>;
        }
      >();

      const msPerDay = 1000 * 60 * 60 * 24;

      for (const inv of invoices) {
        const balanceDue = inv.totalCents - inv.amountPaidCents;
        if (balanceDue <= 0n) continue;

        const dueTime = new Date(inv.dueDate).getTime();
        const asOfTime = asOfDate.getTime();
        const daysOverdue = Math.floor((asOfTime - dueTime) / msPerDay);

        let bucket: 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+' = 'CURRENT';
        if (daysOverdue <= 0) {
          bucket = 'CURRENT';
          totalCurrentCents += balanceDue;
        } else if (daysOverdue <= 30) {
          bucket = '1-30';
          totalDays1to30Cents += balanceDue;
        } else if (daysOverdue <= 60) {
          bucket = '31-60';
          totalDays31to60Cents += balanceDue;
        } else if (daysOverdue <= 90) {
          bucket = '61-90';
          totalDays61to90Cents += balanceDue;
        } else {
          bucket = '90+';
          totalDays90PlusCents += balanceDue;
        }

        grandTotalOutstandingCents += balanceDue;

        let entry = contactMap.get(inv.contactId);
        if (!entry) {
          entry = {
            contactId: inv.contactId,
            contactName: inv.contact.name,
            contactEmail: inv.contact.email,
            currentCents: 0n,
            days1to30Cents: 0n,
            days31to60Cents: 0n,
            days61to90Cents: 0n,
            days90PlusCents: 0n,
            totalCents: 0n,
            invoices: [],
          };
          contactMap.set(inv.contactId, entry);
        }

        if (bucket === 'CURRENT') entry.currentCents += balanceDue;
        else if (bucket === '1-30') entry.days1to30Cents += balanceDue;
        else if (bucket === '31-60') entry.days31to60Cents += balanceDue;
        else if (bucket === '61-90') entry.days61to90Cents += balanceDue;
        else entry.days90PlusCents += balanceDue;

        entry.totalCents += balanceDue;
        entry.invoices.push({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          issueDate: inv.issueDate.toISOString(),
          dueDate: inv.dueDate.toISOString(),
          daysOverdue: Math.max(0, daysOverdue),
          totalCents: inv.totalCents,
          amountPaidCents: inv.amountPaidCents,
          balanceDueCents: balanceDue,
          bucket,
        });
      }

      const contacts = Array.from(contactMap.values()).sort((a, b) =>
        a.contactName.localeCompare(b.contactName),
      );

      return reply.send(
        serialize({
          asOfDate: asOfDateStr,
          totalOutstandingCents: grandTotalOutstandingCents,
          totals: {
            currentCents: totalCurrentCents,
            days1to30Cents: totalDays1to30Cents,
            days31to60Cents: totalDays31to60Cents,
            days61to90Cents: totalDays61to90Cents,
            days90PlusCents: totalDays90PlusCents,
          },
          contacts,
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/reports/aged-payables — Accounts Payable Aging
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/reports/aged-payables',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = DateQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid asOfDate query parameter.' });
      }

      const asOfDateStr = parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10);
      const asOfDate = new Date(`${asOfDateStr}T23:59:59.999Z`);

      // Open Bills as of date
      const bills = await fastify.prisma.bill.findMany({
        where: {
          organizationId,
          status: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID'] },
          issueDate: { lte: asOfDate },
        },
        include: {
          contact: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: [{ contact: { name: 'asc' } }, { dueDate: 'asc' }],
      });

      let grandTotalOutstandingCents = 0n;
      let totalCurrentCents = 0n;
      let totalDays1to30Cents = 0n;
      let totalDays31to60Cents = 0n;
      let totalDays61to90Cents = 0n;
      let totalDays90PlusCents = 0n;

      const contactMap = new Map<
        string,
        {
          contactId: string;
          contactName: string;
          contactEmail?: string | null;
          currentCents: bigint;
          days1to30Cents: bigint;
          days31to60Cents: bigint;
          days61to90Cents: bigint;
          days90PlusCents: bigint;
          totalCents: bigint;
          bills: Array<{
            id: string;
            billNumber?: string | null;
            reference?: string | null;
            issueDate: string;
            dueDate: string;
            daysOverdue: number;
            totalCents: bigint;
            amountPaidCents: bigint;
            balanceDueCents: bigint;
            bucket: 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+';
          }>;
        }
      >();

      const msPerDay = 1000 * 60 * 60 * 24;

      for (const bill of bills) {
        const balanceDue = bill.totalCents - bill.amountPaidCents;
        if (balanceDue <= 0n) continue;

        const dueTime = new Date(bill.dueDate).getTime();
        const asOfTime = asOfDate.getTime();
        const daysOverdue = Math.floor((asOfTime - dueTime) / msPerDay);

        let bucket: 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+' = 'CURRENT';
        if (daysOverdue <= 0) {
          bucket = 'CURRENT';
          totalCurrentCents += balanceDue;
        } else if (daysOverdue <= 30) {
          bucket = '1-30';
          totalDays1to30Cents += balanceDue;
        } else if (daysOverdue <= 60) {
          bucket = '31-60';
          totalDays31to60Cents += balanceDue;
        } else if (daysOverdue <= 90) {
          bucket = '61-90';
          totalDays61to90Cents += balanceDue;
        } else {
          bucket = '90+';
          totalDays90PlusCents += balanceDue;
        }

        grandTotalOutstandingCents += balanceDue;

        let entry = contactMap.get(bill.contactId);
        if (!entry) {
          entry = {
            contactId: bill.contactId,
            contactName: bill.contact.name,
            contactEmail: bill.contact.email,
            currentCents: 0n,
            days1to30Cents: 0n,
            days31to60Cents: 0n,
            days61to90Cents: 0n,
            days90PlusCents: 0n,
            totalCents: 0n,
            bills: [],
          };
          contactMap.set(bill.contactId, entry);
        }

        if (bucket === 'CURRENT') entry.currentCents += balanceDue;
        else if (bucket === '1-30') entry.days1to30Cents += balanceDue;
        else if (bucket === '31-60') entry.days31to60Cents += balanceDue;
        else if (bucket === '61-90') entry.days61to90Cents += balanceDue;
        else entry.days90PlusCents += balanceDue;

        entry.totalCents += balanceDue;
        entry.bills.push({
          id: bill.id,
          reference: bill.reference,
          issueDate: bill.issueDate.toISOString(),
          dueDate: bill.dueDate.toISOString(),
          daysOverdue: Math.max(0, daysOverdue),
          totalCents: bill.totalCents,
          amountPaidCents: bill.amountPaidCents,
          balanceDueCents: balanceDue,
          bucket,
        });
      }

      const contacts = Array.from(contactMap.values()).sort((a, b) =>
        a.contactName.localeCompare(b.contactName),
      );

      return reply.send(
        serialize({
          asOfDate: asOfDateStr,
          totalOutstandingCents: grandTotalOutstandingCents,
          totals: {
            currentCents: totalCurrentCents,
            days1to30Cents: totalDays1to30Cents,
            days31to60Cents: totalDays31to60Cents,
            days61to90Cents: totalDays61to90Cents,
            days90PlusCents: totalDays90PlusCents,
          },
          contacts,
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/reports/bas — Australian BAS GST Worksheet
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/reports/bas',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = BasQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid BAS parameters.' });
      }

      const org = await fastify.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, abn: true, lockDate: true },
      });

      if (!org) return reply.code(404).send({ error: 'Organization not found.' });

      // Determine date window
      const now = new Date();
      let startStr: string;
      let endStr: string;
      let periodLabel: string;

      if (parsed.data.startDate && parsed.data.endDate) {
        startStr = parsed.data.startDate;
        endStr = parsed.data.endDate;
        periodLabel = `Custom: ${startStr} to ${endStr}`;
      } else {
        const year = parsed.data.year ?? now.getFullYear();
        if (parsed.data.period === 'MONTHLY') {
          const month = parsed.data.month ?? now.getMonth() + 1;
          const monthPad = String(month).padStart(2, '0');
          const lastDay = new Date(year, month, 0).getDate();
          startStr = `${year}-${monthPad}-01`;
          endStr = `${year}-${monthPad}-${String(lastDay).padStart(2, '0')}`;
          periodLabel = `${year} M${month}`;
        } else {
          // Quarterly (Standard Australian BAS Quarters)
          // Q1: Jul-Sep, Q2: Oct-Dec, Q3: Jan-Mar, Q4: Apr-Jun
          const quarter = parsed.data.quarter ?? Math.floor(now.getMonth() / 3) + 1;
          if (quarter === 1) {
            startStr = `${year}-07-01`;
            endStr = `${year}-09-30`;
            periodLabel = `FY${year} Q1 (Jul–Sep)`;
          } else if (quarter === 2) {
            startStr = `${year}-10-01`;
            endStr = `${year}-12-31`;
            periodLabel = `FY${year} Q2 (Oct–Dec)`;
          } else if (quarter === 3) {
            startStr = `${year + 1}-01-01`;
            endStr = `${year + 1}-03-31`;
            periodLabel = `FY${year} Q3 (Jan–Mar)`;
          } else {
            startStr = `${year + 1}-04-01`;
            endStr = `${year + 1}-06-30`;
            periodLabel = `FY${year} Q4 (Apr–Jun)`;
          }
        }
      }

      const startDate = new Date(`${startStr}T00:00:00.000Z`);
      const endDate = new Date(`${endStr}T23:59:59.999Z`);

      // 1. Calculate 1A: GST on Sales (Credits minus debits to 2100 GST Collected)
      const gstCollectedAccount = await fastify.prisma.account.findFirst({
        where: { organizationId, code: '2100' },
        include: {
          journalLines: {
            where: {
              journalEntry: {
                status: JournalStatus.POSTED,
                postedAt: { gte: startDate, lte: endDate },
              },
            },
            select: { entryType: true, amountCents: true },
          },
        },
      });

      let oneAGstCollectedCredits = 0n;
      let oneAGstCollectedDebits = 0n;
      if (gstCollectedAccount) {
        for (const line of gstCollectedAccount.journalLines) {
          if (line.entryType === EntryType.CREDIT) oneAGstCollectedCredits += line.amountCents;
          else oneAGstCollectedDebits += line.amountCents;
        }
      }
      const oneAGstCents = oneAGstCollectedCredits - oneAGstCollectedDebits;

      // 2. Calculate 1B: GST on Purchases (Debits minus credits to 2200 GST Paid)
      const gstPaidAccount = await fastify.prisma.account.findFirst({
        where: { organizationId, code: '2200' },
        include: {
          journalLines: {
            where: {
              journalEntry: {
                status: JournalStatus.POSTED,
                postedAt: { gte: startDate, lte: endDate },
              },
            },
            select: { entryType: true, amountCents: true },
          },
        },
      });

      let oneBGstPaidDebits = 0n;
      let oneBGstPaidCredits = 0n;
      if (gstPaidAccount) {
        for (const line of gstPaidAccount.journalLines) {
          if (line.entryType === EntryType.DEBIT) oneBGstPaidDebits += line.amountCents;
          else oneBGstPaidCredits += line.amountCents;
        }
      }
      const oneBGstCents = oneBGstPaidDebits - oneBGstPaidCredits;

      // 3. Calculate G1: Total Sales
      // Sum of issued customer invoices + direct income receipts posted within period
      const invoiceAgg = await fastify.prisma.invoice.aggregate({
        where: {
          organizationId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
          issueDate: { gte: startDate, lte: endDate },
        },
        _sum: { totalCents: true, gstCents: true, subtotalCents: true },
        _count: { id: true },
      });

      const directIncomeAgg = await fastify.prisma.paymentIn.aggregate({
        where: {
          organizationId,
          receiptType: 'DIRECT_INCOME',
          paymentDate: { gte: startDate, lte: endDate },
        },
        _sum: { amountCents: true },
        _count: { _all: true },
      });

      // GST-Free sales (G2/G3)
      const gstFreeLineAgg = await fastify.prisma.invoiceLineItem.aggregate({
        where: {
          organizationId,
          taxTreatment: TaxTreatment.GST_FREE,
          invoice: {
            status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
            issueDate: { gte: startDate, lte: endDate },
          },
        },
        _sum: { totalCents: true },
      });

      // Purchases: Bills + Direct Spend + Expense Claims
      const billAgg = await fastify.prisma.bill.aggregate({
        where: {
          organizationId,
          status: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID'] },
          issueDate: { gte: startDate, lte: endDate },
        },
        _sum: { totalCents: true, gstCents: true, subtotalCents: true },
        _count: { _all: true },
      });

      const directSpendAgg = await fastify.prisma.directTransaction.aggregate({
        where: {
          organizationId,
          type: 'SPEND_MONEY',
          transactionDate: { gte: startDate, lte: endDate },
        },
        _sum: { totalCents: true, gstCents: true },
        _count: { _all: true },
      });

      const expenseClaimAgg = await fastify.prisma.expenseClaim.aggregate({
        where: {
          organizationId,
          status: { in: ['APPROVED', 'PAID'] },
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { totalCents: true, gstCents: true },
        _count: { _all: true },
      });

      const g1TotalSalesCents =
        (invoiceAgg._sum?.totalCents ?? 0n) + (directIncomeAgg._sum?.amountCents ?? 0n);
      const g2G3GstFreeSalesCents = gstFreeLineAgg._sum?.totalCents ?? 0n;

      const totalPurchasesGrossCents =
        (billAgg._sum?.totalCents ?? 0n) +
        (directSpendAgg._sum?.totalCents ?? 0n) +
        (expenseClaimAgg._sum?.totalCents ?? 0n);

      // Distinguish Capital (G10) vs Non-Capital (G11)
      // Capital purchases: Bill lines or direct spend coded to Asset accounts
      const assetAccounts = await fastify.prisma.account.findMany({
        where: { organizationId, type: AccountType.ASSET },
        select: { id: true },
      });
      const assetAccountIds = assetAccounts.map((a) => a.id);

      const capitalLineAgg = await fastify.prisma.billLineItem.aggregate({
        where: {
          organizationId,
          accountId: { in: assetAccountIds },
          bill: {
            status: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID'] },
            issueDate: { gte: startDate, lte: endDate },
          },
        },
        _sum: { totalCents: true },
      });

      const g10CapitalPurchasesCents = capitalLineAgg._sum?.totalCents ?? 0n;
      const g11NonCapitalPurchasesCents =
        totalPurchasesGrossCents >= g10CapitalPurchasesCents
          ? totalPurchasesGrossCents - g10CapitalPurchasesCents
          : 0n;

      const netGstCents = oneAGstCents - oneBGstCents;
      const isPeriodLocked =
        Boolean(org.lockDate) && new Date(org.lockDate!) >= new Date(endStr);

      return reply.send(
        serialize({
          periodLabel,
          startDate: startStr,
          endDate: endStr,
          organization: {
            name: org.name,
            abn: org.abn,
            lockDate: org.lockDate ? org.lockDate.toISOString().slice(0, 10) : null,
          },
          isPeriodLocked,
          // ATO BAS Worksheet Box Metrics
          g1TotalSalesCents,
          g2G3GstFreeSalesCents,
          g10CapitalPurchasesCents,
          g11NonCapitalPurchasesCents,
          oneAGstCents,
          oneBGstCents,
          netGstCents,
          netGstType: netGstCents >= 0n ? 'PAYABLE' : 'REFUNDABLE',
          salesSummary: {
            invoicesCount: invoiceAgg._count?.id ?? 0,
            directIncomeCount: directIncomeAgg._count?._all ?? 0,
          },
          purchasesSummary: {
            billsCount: billAgg._count?._all ?? 0,
            directSpendCount: directSpendAgg._count?._all ?? 0,
            expenseClaimsCount: expenseClaimAgg._count?._all ?? 0,
          },
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/reports/bas/lock — Lock accounting period
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/reports/bas/lock',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const parsed = LockBasBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid lock date. Expected YYYY-MM-DD.' });
      }

      const { endDate } = parsed.data;
      const lockDateObj = new Date(`${endDate}T23:59:59.999Z`);

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const org = await tx.organization.update({
          where: { id: organizationId },
          data: { lockDate: lockDateObj },
          select: { id: true, name: true, lockDate: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BAS_PERIOD_LOCKED',
          entityType: 'ORGANIZATION',
          entityId: organizationId,
          summary: `BAS accounting period locked through ${endDate}. Past GL transactions are now frozen.`,
        });

        return org;
      });

      return reply.send({
        ok: true,
        message: `Accounting period locked through ${endDate}.`,
        lockDate: updated.lockDate ? updated.lockDate.toISOString().slice(0, 10) : null,
      });
    },
  );
};

export default reportRoutes;
