/**
 * Live Executive Dashboard Routes — Module 8 Zero-Mock Policy.
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET /api/v1/dashboard/summary — Real-time PostgreSQL aggregations for cash position,
 *                                    AR & AP aging, pending approvals queue, MTD/YTD P&L,
 *                                    and recent financial activity feed.
 */

import type { FastifyPluginAsync } from 'fastify';
import { requireOrgAuth } from '../plugins/auth.js';
import {
  AccountType,
  EntryType,
  JournalStatus,
} from '@prisma/client';

function serialize<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/v1/dashboard/summary',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const now = new Date();

      // 1. Organization fiscal preferences
      const org = await fastify.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          fiscalYearStartMonth: true,
          lockDate: true,
        },
      });

      if (!org) return reply.code(404).send({ error: 'Organization not found.' });

      // Calculate MTD & YTD date ranges
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth(); // 0-indexed
      const mtdStart = new Date(Date.UTC(currentYear, currentMonth, 1, 0, 0, 0, 0));

      const fyStartMonth = (org.fiscalYearStartMonth ?? 7) - 1; // Default July (6 in 0-indexed)
      const fyYear = currentMonth >= fyStartMonth ? currentYear : currentYear - 1;
      const ytdStart = new Date(Date.UTC(fyYear, fyStartMonth, 1, 0, 0, 0, 0));

      // -----------------------------------------------------------------------
      // 2. Cash Position across Bank & Card Accounts
      // -----------------------------------------------------------------------
      const bankAccounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          isActive: true,
          OR: [
            { isBankAccount: true },
            { type: AccountType.ASSET, code: { startsWith: '10' } },
          ],
        },
        orderBy: { code: 'asc' },
        include: {
          journalLines: {
            where: {
              journalEntry: { status: JournalStatus.POSTED },
            },
            select: { entryType: true, amountCents: true },
          },
        },
      });

      let totalCashCents = 0n;
      const cashAccountsList = bankAccounts.map((acc) => {
        let debits = 0n;
        let credits = 0n;
        for (const line of acc.journalLines) {
          if (line.entryType === EntryType.DEBIT) debits += line.amountCents;
          else credits += line.amountCents;
        }
        // Asset normal balance = DEBIT
        const balance = debits - credits;
        totalCashCents += balance;

        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          balanceCents: balance,
          bankBsb: acc.bankBsb,
          bankAccountNumber: acc.bankAccountNumber,
        };
      });

      // -----------------------------------------------------------------------
      // 3. Accounts Receivable (AR) & Aging
      // -----------------------------------------------------------------------
      const openInvoices = await fastify.prisma.invoice.findMany({
        where: {
          organizationId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        },
        select: {
          id: true,
          invoiceNumber: true,
          totalCents: true,
          amountPaidCents: true,
          dueDate: true,
        },
      });

      let totalArOutstandingCents = 0n;
      let totalArOverdueCents = 0n;
      let overdueInvoicesCount = 0;
      let arCurrentCents = 0n;
      let ar1to30Cents = 0n;
      let ar31to60Cents = 0n;
      let ar61to90Cents = 0n;
      let ar90PlusCents = 0n;

      const msPerDay = 1000 * 60 * 60 * 24;
      const todayTime = now.getTime();

      for (const inv of openInvoices) {
        const balanceDue = inv.totalCents - inv.amountPaidCents;
        if (balanceDue <= 0n) continue;

        totalArOutstandingCents += balanceDue;
        const dueTime = new Date(inv.dueDate).getTime();
        const daysOverdue = Math.floor((todayTime - dueTime) / msPerDay);

        if (daysOverdue > 0) {
          totalArOverdueCents += balanceDue;
          overdueInvoicesCount++;
        }

        if (daysOverdue <= 0) arCurrentCents += balanceDue;
        else if (daysOverdue <= 30) ar1to30Cents += balanceDue;
        else if (daysOverdue <= 60) ar31to60Cents += balanceDue;
        else if (daysOverdue <= 90) ar61to90Cents += balanceDue;
        else ar90PlusCents += balanceDue;
      }

      // -----------------------------------------------------------------------
      // 4. Accounts Payable (AP) & Aging
      // -----------------------------------------------------------------------
      const openBills = await fastify.prisma.bill.findMany({
        where: {
          organizationId,
          status: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID'] },
        },
        select: {
          id: true,
          reference: true,
          totalCents: true,
          amountPaidCents: true,
          dueDate: true,
        },
      });

      let totalApOutstandingCents = 0n;
      let totalApOverdueCents = 0n;
      let overdueBillsCount = 0;
      let apCurrentCents = 0n;
      let ap1to30Cents = 0n;
      let ap31to60Cents = 0n;
      let ap61to90Cents = 0n;
      let ap90PlusCents = 0n;

      for (const bill of openBills) {
        const balanceDue = bill.totalCents - bill.amountPaidCents;
        if (balanceDue <= 0n) continue;

        totalApOutstandingCents += balanceDue;
        const dueTime = new Date(bill.dueDate).getTime();
        const daysOverdue = Math.floor((todayTime - dueTime) / msPerDay);

        if (daysOverdue > 0) {
          totalApOverdueCents += balanceDue;
          overdueBillsCount++;
        }

        if (daysOverdue <= 0) apCurrentCents += balanceDue;
        else if (daysOverdue <= 30) ap1to30Cents += balanceDue;
        else if (daysOverdue <= 60) ap31to60Cents += balanceDue;
        else if (daysOverdue <= 90) ap61to90Cents += balanceDue;
        else ap90PlusCents += balanceDue;
      }

      // Employee Reimbursements Payable balance (account 2050)
      const reimbursementAccount = await fastify.prisma.account.findFirst({
        where: { organizationId, code: '2050' },
        include: {
          journalLines: {
            where: { journalEntry: { status: JournalStatus.POSTED } },
            select: { entryType: true, amountCents: true },
          },
        },
      });

      let pendingReimbursementsCents = 0n;
      if (reimbursementAccount) {
        let debits = 0n;
        let credits = 0n;
        for (const line of reimbursementAccount.journalLines) {
          if (line.entryType === EntryType.DEBIT) debits += line.amountCents;
          else credits += line.amountCents;
        }
        // Liability normal balance = CREDIT
        pendingReimbursementsCents = credits - debits;
      }

      // -----------------------------------------------------------------------
      // 5. Actionable Pending Approvals Queue
      // -----------------------------------------------------------------------
      const [
        pendingBillsCount,
        pendingPosCount,
        pendingClaimsCount,
        pendingJournalsCount,
      ] = await Promise.all([
        fastify.prisma.bill.count({
          where: { organizationId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } },
        }),
        fastify.prisma.purchaseOrder.count({
          where: { organizationId, status: 'PENDING_APPROVAL' },
        }),
        fastify.prisma.expenseClaim.count({
          where: { organizationId, status: 'SUBMITTED' },
        }),
        fastify.prisma.journalEntry.count({
          where: { organizationId, status: JournalStatus.PENDING_APPROVAL },
        }),
      ]);

      const totalPendingApprovals =
        pendingBillsCount + pendingPosCount + pendingClaimsCount + pendingJournalsCount;

      // -----------------------------------------------------------------------
      // 6. Performance Metrics (MTD & YTD Revenue / Expenses)
      // -----------------------------------------------------------------------
      const performanceLines = await fastify.prisma.journalLine.findMany({
        where: {
          organizationId,
          journalEntry: {
            status: JournalStatus.POSTED,
            postedAt: { gte: ytdStart },
          },
          account: {
            type: { in: [AccountType.REVENUE, AccountType.EXPENSE] },
          },
        },
        select: {
          entryType: true,
          amountCents: true,
          journalEntry: { select: { postedAt: true } },
          account: { select: { type: true } },
        },
      });

      let mtdRevenueCents = 0n;
      let mtdExpenseCents = 0n;
      let ytdRevenueCents = 0n;
      let ytdExpenseCents = 0n;

      for (const line of performanceLines) {
        const isMtd = line.journalEntry.postedAt >= mtdStart;

        if (line.account.type === AccountType.REVENUE) {
          const rev =
            line.entryType === EntryType.CREDIT
              ? line.amountCents
              : -line.amountCents;
          ytdRevenueCents += rev;
          if (isMtd) mtdRevenueCents += rev;
        } else if (line.account.type === AccountType.EXPENSE) {
          const exp =
            line.entryType === EntryType.DEBIT
              ? line.amountCents
              : -line.amountCents;
          ytdExpenseCents += exp;
          if (isMtd) mtdExpenseCents += exp;
        }
      }

      const mtdNetProfitCents = mtdRevenueCents - mtdExpenseCents;
      const ytdNetProfitCents = ytdRevenueCents - ytdExpenseCents;

      // -----------------------------------------------------------------------
      // 7. Recent Financial Activity / Audit Feed
      // -----------------------------------------------------------------------
      const recentActivity = await fastify.prisma.auditLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          summary: true,
          actorName: true,
          actorEmail: true,
          createdAt: true,
        },
      });

      // Active contacts count
      const activeContactsCount = await fastify.prisma.contact.count({
        where: { organizationId, isActive: true },
      });

      return reply.send(
        serialize({
          organization: {
            id: org.id,
            name: org.name,
            lockDate: org.lockDate ? org.lockDate.toISOString().slice(0, 10) : null,
          },
          cashPosition: {
            totalCashCents,
            accounts: cashAccountsList,
          },
          receivables: {
            totalOutstandingCents: totalArOutstandingCents,
            overdueCents: totalArOverdueCents,
            openInvoicesCount: openInvoices.length,
            overdueInvoicesCount,
            aging: {
              currentCents: arCurrentCents,
              days1to30Cents: ar1to30Cents,
              days31to60Cents: ar31to60Cents,
              days61to90Cents: ar61to90Cents,
              days90PlusCents: ar90PlusCents,
            },
          },
          payables: {
            totalOutstandingCents: totalApOutstandingCents,
            overdueCents: totalApOverdueCents,
            openBillsCount: openBills.length,
            overdueBillsCount,
            pendingReimbursementsCents,
            aging: {
              currentCents: apCurrentCents,
              days1to30Cents: ap1to30Cents,
              days31to60Cents: ap31to60Cents,
              days61to90Cents: ap61to90Cents,
              days90PlusCents: ap90PlusCents,
            },
          },
          approvalsQueue: {
            totalPending: totalPendingApprovals,
            pendingBillsCount,
            pendingPosCount,
            pendingClaimsCount,
            pendingJournalsCount,
          },
          performance: {
            mtdRevenueCents,
            mtdExpenseCents,
            mtdNetProfitCents,
            ytdRevenueCents,
            ytdExpenseCents,
            ytdNetProfitCents,
          },
          activeContactsCount,
          recentActivity,
        }),
      );
    },
  );
};

export default dashboardRoutes;

