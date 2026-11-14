/**
 * Expense Claims routes — Module 6 Enterprise Expenses & Staff Out-of-Pocket Claims
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET    /api/v1/expense-claims              (List expense claims with role-based scoping)
 *  - POST   /api/v1/expense-claims              (Create draft or submitted expense claim)
 *  - GET    /api/v1/expense-claims/:id          (Get single claim details, items, GL postings)
 *  - PATCH  /api/v1/expense-claims/:id          (Update draft or rejected claim)
 *  - DELETE /api/v1/expense-claims/:id          (Delete draft claim)
 *  - POST   /api/v1/expense-claims/:id/submit   (Submit draft or rejected claim for approval)
 *  - POST   /api/v1/expense-claims/:id/approve  (Manager/Accountant approval with GL posting to 2050)
 *  - POST   /api/v1/expense-claims/:id/reject   (Reject claim with reason)
 *  - POST   /api/v1/expense-claims/:id/pay      (Single reimbursement payout out of bank account)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import {
  checkOrganizationLockDate,
  postJournalEntry,
  reverseJournalEntry,
  syncOrReplaceJournalEntry,
} from '../lib/ledger-posting.js';
import { EntryType, ExpenseClaimStatus, Role, TaxTreatment } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const ExpenseClaimStatusEnum = z.nativeEnum(ExpenseClaimStatus);

const ExpenseItemInput = z.object({
  expenseDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  merchant: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(255),
  accountId: z.string().uuid().optional(),
  amountCents: z.number().int().positive(),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
  trackingOptionId: z.string().uuid().nullable().optional(),
});

const CreateExpenseClaimBody = z.object({
  title: z.string().trim().min(1).max(150),
  notes: z.string().trim().max(1000).nullable().optional(),
  submitNow: z.boolean().default(false),
  items: z.array(ExpenseItemInput).min(1),
});

const UpdateExpenseClaimBody = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  submitNow: z.boolean().optional(),
  items: z.array(ExpenseItemInput).min(1).optional(),
});

const RejectClaimBody = z.object({
  rejectionReason: z.string().trim().min(1).max(500),
});

const PayClaimBody = z.object({
  bankAccountId: z.string().uuid().optional(),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  reference: z.string().trim().max(100).nullable().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

function serializeData<T>(data: T): any {
  if (data === null || data === undefined) return null;
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

export const expenseClaimRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/expense-claims
  fastify.get(
    '/api/v1/expense-claims',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.EMPLOYEE,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const userRole = request.user.role!;
      const userId = request.user.userId;
      const query = request.query as Record<string, string | undefined>;

      const whereClause: any = { organizationId };

      // Role isolation: EMPLOYEE can only see their own claims
      if (userRole === Role.EMPLOYEE) {
        whereClause.employeeUserId = userId;
      } else {
        // Higher roles can use scope filter
        if (query.scope === 'my') {
          whereClause.employeeUserId = userId;
        } else if (query.scope === 'team') {
          whereClause.status = ExpenseClaimStatus.SUBMITTED;
        } else if (query.employeeUserId) {
          whereClause.employeeUserId = query.employeeUserId;
        }
      }

      if (query.status && Object.values(ExpenseClaimStatus).includes(query.status as any)) {
        whereClause.status = query.status as ExpenseClaimStatus;
      }

      const claims = await fastify.prisma.expenseClaim.findMany({
        where: whereClause,
        include: {
          employee: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          approvedBy: {
            select: { id: true, name: true, email: true },
          },
          items: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Enrich with member job title and department
      const employeeUserIds = Array.from(new Set(claims.map((c) => c.employeeUserId)));
      const members = await fastify.prisma.organizationMember.findMany({
        where: { organizationId, userId: { in: employeeUserIds } },
        select: {
          userId: true,
          jobTitle: true,
          department: true,
          bankBsb: true,
          bankAccountNumber: true,
          bankAccountName: true,
        },
      });
      const memberMap = new Map(members.map((m) => [m.userId, m]));

      // Enrich items with account details and tracking options
      const accountIds = new Set<string>();
      const trackingIds = new Set<string>();

      claims.forEach((c) => {
        c.items.forEach((it) => {
          accountIds.add(it.accountId);
          if (it.trackingOptionId) trackingIds.add(it.trackingOptionId);
        });
      });

      const accounts = await fastify.prisma.account.findMany({
        where: { id: { in: Array.from(accountIds) }, organizationId },
        select: { id: true, code: true, name: true },
      });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const trackingOptions = await fastify.prisma.trackingOption.findMany({
        where: { id: { in: Array.from(trackingIds) }, organizationId },
        select: { id: true, name: true },
      });
      const trackingMap = new Map(trackingOptions.map((o) => [o.id, o]));

      const enrichedClaims = claims.map((c) => {
        const mem = memberMap.get(c.employeeUserId);
        return {
          ...c,
          employee: {
            ...c.employee,
            jobTitle: mem?.jobTitle || null,
            department: mem?.department || null,
            bankBsb: mem?.bankBsb || null,
            bankAccountNumber: mem?.bankAccountNumber || null,
            bankAccountName: mem?.bankAccountName || null,
            hasBankDetails: Boolean(mem?.bankBsb && mem?.bankAccountNumber),
          },
          items: c.items.map((it) => {
            const acc = accountMap.get(it.accountId);
            const trk = it.trackingOptionId ? trackingMap.get(it.trackingOptionId) : null;
            return {
              ...it,
              accountCode: acc?.code || '',
              accountName: acc?.name || '',
              trackingOptionName: trk?.name || null,
            };
          }),
        };
      });

      return reply.code(200).send({ expenseClaims: serializeData(enrichedClaims) });
    },
  );

  // GET /api/v1/expense-claims/:id
  fastify.get(
    '/api/v1/expense-claims/:id',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.EMPLOYEE,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const userRole = request.user.role!;
      const userId = request.user.userId;

      const claim = await fastify.prisma.expenseClaim.findFirst({
        where: { id, organizationId },
        include: {
          employee: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          approvedBy: {
            select: { id: true, name: true, email: true },
          },
          items: true,
        },
      });

      if (!claim) {
        return reply.code(404).send({ error: 'Expense claim not found' });
      }

      // If user is EMPLOYEE, ensure they own the claim
      if (userRole === Role.EMPLOYEE && claim.employeeUserId !== userId) {
        return reply.code(403).send({ error: 'Forbidden: You can only view your own expense claims' });
      }

      // Member details
      const member = await fastify.prisma.organizationMember.findFirst({
        where: { organizationId, userId: claim.employeeUserId },
        select: {
          jobTitle: true,
          department: true,
          bankBsb: true,
          bankAccountNumber: true,
          bankAccountName: true,
        },
      });

      // Linked journal entries (Approval journal and Payout journal)
      const journalEntries = await fastify.prisma.journalEntry.findMany({
        where: {
          organizationId,
          referenceType: { in: ['EXPENSE_CLAIM', 'EXPENSE_CLAIM_PAYOUT'] },
          referenceId: id,
        },
        include: { lines: true },
      });

      // Account & tracking enrichment
      const accountIds = new Set<string>();
      claim.items.forEach((it) => accountIds.add(it.accountId));
      journalEntries.forEach((je) => je.lines.forEach((l) => accountIds.add(l.accountId)));

      const accounts = await fastify.prisma.account.findMany({
        where: { id: { in: Array.from(accountIds) }, organizationId },
        select: { id: true, code: true, name: true },
      });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const enrichedItems = claim.items.map((it) => {
        const acc = accountMap.get(it.accountId);
        return {
          ...it,
          accountCode: acc?.code || '',
          accountName: acc?.name || '',
        };
      });

      const enrichedJournals = journalEntries.map((je) => ({
        ...je,
        lines: je.lines.map((l) => {
          const acc = accountMap.get(l.accountId);
          return {
            ...l,
            accountCode: acc?.code || '',
            accountName: acc?.name || '',
          };
        }),
      }));

      return reply.code(200).send({
        expenseClaim: serializeData({
          ...claim,
          employee: {
            ...claim.employee,
            jobTitle: member?.jobTitle || null,
            department: member?.department || null,
            bankBsb: member?.bankBsb || null,
            bankAccountNumber: member?.bankAccountNumber || null,
            bankAccountName: member?.bankAccountName || null,
            hasBankDetails: Boolean(member?.bankBsb && member?.bankAccountNumber),
          },
          items: enrichedItems,
        }),
        journalEntries: serializeData(enrichedJournals),
      });
    },
  );

  // POST /api/v1/expense-claims
  fastify.post(
    '/api/v1/expense-claims',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.EMPLOYEE,
        ),
      ],
    },
    async (request, reply) => {
      const parse = CreateExpenseClaimBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { title, notes, submitNow, items } = parse.data;
      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;

      // Find default expense account 6000 if not specified
      const defaultExpense = await fastify.prisma.account.findFirst({
        where: { organizationId, code: '6000', isActive: true },
      });

      // Verify all item accounts
      const itemAccountIds = Array.from(
        new Set(items.map((it) => it.accountId || defaultExpense?.id).filter(Boolean)),
      ) as string[];

      const validAccounts = await fastify.prisma.account.findMany({
        where: {
          id: { in: itemAccountIds },
          organizationId,
          isActive: true,
        },
      });

      if (validAccounts.length !== itemAccountIds.length) {
        return reply.code(400).send({
          error: 'One or more line accounts are invalid, inactive, or not found.',
        });
      }

      // Compute GST and totals for each item
      const processedItems = items.map((item) => {
        const rawAmount = BigInt(item.amountCents);
        const gstResult = calculateGST(rawAmount, item.taxTreatment);
        const resolvedAccountId = item.accountId || defaultExpense?.id;
        if (!resolvedAccountId) {
          throw new Error('No expense account specified and default 6000 Operating Expenses not found.');
        }

        return {
          expenseDate: new Date(item.expenseDate),
          merchant: item.merchant,
          description: item.description,
          accountId: resolvedAccountId,
          trackingOptionId: item.trackingOptionId || null,
          taxTreatment: item.taxTreatment,
          amountCents: gstResult.subtotalCents,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
        };
      });

      const totalResult = sumGSTResults(
        processedItems.map((it) => ({
          subtotalCents: it.amountCents,
          gstCents: it.gstCents,
          totalCents: it.totalCents,
        })),
      );

      // Sequential claimNumber EXP-0001
      const count = await fastify.prisma.expenseClaim.count({
        where: { organizationId },
      });
      const claimNumber = `EXP-${String(count + 1).padStart(4, '0')}`;

      const status: ExpenseClaimStatus = submitNow
        ? ExpenseClaimStatus.SUBMITTED
        : ExpenseClaimStatus.DRAFT;

      const createdClaim = await fastify.prisma.$transaction(async (tx) => {
        const claim = await tx.expenseClaim.create({
          data: {
            organizationId,
            employeeUserId: userId,
            claimNumber,
            title,
            notes: notes || null,
            status,
            submittedAt: submitNow ? new Date() : null,
            subtotalCents: totalResult.subtotalCents,
            gstCents: totalResult.gstCents,
            totalCents: totalResult.totalCents,
            items: {
              create: processedItems.map((it) => ({
                organizationId,
                expenseDate: it.expenseDate,
                merchant: it.merchant,
                description: it.description,
                accountId: it.accountId,
                trackingOptionId: it.trackingOptionId,
                taxTreatment: it.taxTreatment,
                amountCents: it.amountCents,
                gstCents: it.gstCents,
                totalCents: it.totalCents,
              })),
            },
          },
          include: { items: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: submitNow ? 'EXPENSE_CLAIM_SUBMITTED' : 'EXPENSE_CLAIM_CREATED',
          entityType: 'EXPENSE_CLAIM',
          entityId: claim.id,
          summary: `${submitNow ? 'Submitted' : 'Created draft'} expense claim ${claimNumber} "${title}" for $${(Number(totalResult.totalCents) / 100).toFixed(2)} (${items.length} items)`,
        });

        return claim;
      });

      return reply.code(201).send({
        message: submitNow ? 'Expense claim submitted for approval' : 'Draft expense claim saved',
        expenseClaim: serializeData(createdClaim),
      });
    },
  );

  // PATCH /api/v1/expense-claims/:id
  fastify.patch(
    '/api/v1/expense-claims/:id',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.EMPLOYEE,
        ),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const parse = UpdateExpenseClaimBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const userRole = request.user.role!;
      const userId = request.user.userId;

      const existing = await fastify.prisma.expenseClaim.findFirst({
        where: { id, organizationId },
        include: { items: true, employee: true },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Expense claim not found' });
      }

      if (userRole === Role.EMPLOYEE && existing.employeeUserId !== userId) {
        return reply.code(403).send({ error: 'Forbidden: You can only edit your own claims' });
      }

      const isAdminOrAccountant = userRole === Role.ADMIN || userRole === Role.ACCOUNTANT;

      if (existing.status === ExpenseClaimStatus.PAID) {
        return reply.code(400).send({
          error: 'Cannot edit a PAID expense claim. Reverse the reimbursement payout first.',
        });
      }

      if (
        existing.status !== ExpenseClaimStatus.DRAFT &&
        existing.status !== ExpenseClaimStatus.REJECTED &&
        !isAdminOrAccountant
      ) {
        return reply.code(403).send({
          error: `Only ADMIN or ACCOUNTANT users can edit a claim in ${existing.status} status.`,
        });
      }

      const { title, notes, submitNow, items } = parse.data;

      const updated = await fastify.prisma.$transaction(async (tx) => {
        let updateData: any = {};
        if (title !== undefined) updateData.title = title;
        if (notes !== undefined) updateData.notes = notes || null;

        if (items && items.length > 0) {
          // Delete existing items and insert new ones
          await tx.expenseClaimItem.deleteMany({
            where: { expenseClaimId: id },
          });

          const defaultExpense = await tx.account.findFirst({
            where: { organizationId, code: '6000', isActive: true },
          });

          const processedItems = items.map((item) => {
            const rawAmount = BigInt(item.amountCents);
            const gstResult = calculateGST(rawAmount, item.taxTreatment);
            const resolvedAccountId = item.accountId || defaultExpense?.id;
            if (!resolvedAccountId) {
              throw new Error('No expense account specified and default 6000 Operating Expenses not found.');
            }

            return {
              organizationId,
              expenseClaimId: id,
              expenseDate: new Date(item.expenseDate),
              merchant: item.merchant,
              description: item.description,
              accountId: resolvedAccountId,
              trackingOptionId: item.trackingOptionId || null,
              taxTreatment: item.taxTreatment,
              amountCents: gstResult.subtotalCents,
              gstCents: gstResult.gstCents,
              totalCents: gstResult.totalCents,
            };
          });

          const totalResult = sumGSTResults(
            processedItems.map((it) => ({
              subtotalCents: it.amountCents,
              gstCents: it.gstCents,
              totalCents: it.totalCents,
            })),
          );

          await tx.expenseClaimItem.createMany({
            data: processedItems,
          });

          updateData.subtotalCents = totalResult.subtotalCents;
          updateData.gstCents = totalResult.gstCents;
          updateData.totalCents = totalResult.totalCents;
        }

        if (
          submitNow &&
          (existing.status === ExpenseClaimStatus.DRAFT || existing.status === ExpenseClaimStatus.REJECTED)
        ) {
          updateData.status = ExpenseClaimStatus.SUBMITTED;
          updateData.submittedAt = new Date();
          updateData.rejectionReason = null;
        }

        const claim = await tx.expenseClaim.update({
          where: { id },
          data: updateData,
          include: { items: true, employee: true },
        });

        // If the claim is APPROVED, synchronize its active EXPENSE_CLAIM GL journal in place
        if (claim.status === ExpenseClaimStatus.APPROVED) {
          const accounts = await tx.account.findMany({
            where: {
              organizationId,
              code: { in: ['2050', '2200'] },
              isActive: true,
            },
          });
          const reimbursementsAccount = accounts.find((a) => a.code === '2050');
          const gstPaidAccount = accounts.find((a) => a.code === '2200');

          if (reimbursementsAccount && gstPaidAccount) {
            const journalLines: Array<{
              accountId: string;
              trackingOptionId?: string | null;
              entryType: EntryType;
              amountCents: bigint;
              description?: string | null;
            }> = [];

            for (const it of claim.items) {
              if (it.amountCents > 0n) {
                journalLines.push({
                  accountId: it.accountId,
                  trackingOptionId: it.trackingOptionId,
                  entryType: EntryType.DEBIT,
                  amountCents: it.amountCents,
                  description: `${it.merchant}: ${it.description}`,
                });
              }
            }

            if (claim.gstCents > 0n) {
              journalLines.push({
                accountId: gstPaidAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: claim.gstCents,
                description: 'GST Paid (Purchases)',
              });
            }

            if (claim.totalCents > 0n) {
              journalLines.push({
                accountId: reimbursementsAccount.id,
                entryType: EntryType.CREDIT,
                amountCents: claim.totalCents,
                description: `Expense Reimbursement Payable - ${claim.employee.name} (${claim.claimNumber})`,
              });
            }

            if (journalLines.length >= 2) {
              await syncOrReplaceJournalEntry(tx, {
                organizationId,
                actorUserId: userId,
                description: `Expense Claim Approval: ${claim.claimNumber} - ${claim.title} (${claim.employee.name})`,
                referenceType: 'EXPENSE_CLAIM',
                referenceId: claim.id,
                postedAt: claim.approvedAt || new Date(),
                lines: journalLines,
              });
            }
          }
        }

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: submitNow ? 'EXPENSE_CLAIM_SUBMITTED' : 'EXPENSE_CLAIM_UPDATED',
          entityType: 'EXPENSE_CLAIM',
          entityId: id,
          summary: `Updated expense claim ${existing.claimNumber} (${claim.status}, $${(Number(claim.totalCents) / 100).toFixed(2)})`,
        });

        return claim;
      });

      return reply.code(200).send({
        message: 'Expense claim updated successfully',
        expenseClaim: serializeData(updated),
      });
    },
  );

  // DELETE /api/v1/expense-claims/:id
  fastify.delete(
    '/api/v1/expense-claims/:id',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.EMPLOYEE,
        ),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const userRole = request.user.role!;
      const userId = request.user.userId;

      const existing = await fastify.prisma.expenseClaim.findFirst({
        where: { id, organizationId },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Expense claim not found' });
      }

      if (userRole === Role.EMPLOYEE && existing.employeeUserId !== userId) {
        return reply.code(403).send({ error: 'Forbidden: You can only delete your own claims' });
      }

      if (existing.status === ExpenseClaimStatus.PAID) {
        return reply.code(400).send({
          error: 'Cannot delete a PAID expense claim. Reverse the reimbursement payout first.',
        });
      }

      const isAdmin = userRole === Role.ADMIN;

      if (
        existing.status !== ExpenseClaimStatus.DRAFT &&
        existing.status !== ExpenseClaimStatus.REJECTED &&
        !isAdmin
      ) {
        return reply.code(400).send({
          error: `Cannot delete claim with status ${existing.status}. Revert the claim to DRAFT first, or contact an ADMIN.`,
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        const linkedJournals = await tx.journalEntry.findMany({
          where: {
            organizationId,
            referenceType: { in: ['EXPENSE_CLAIM', 'EXPENSE_CLAIM_VOID'] },
            referenceId: id,
          },
          select: { id: true },
        });
        const jIds = linkedJournals.map((j) => j.id);
        if (jIds.length > 0) {
          await tx.journalEntry.updateMany({
            where: {
              organizationId,
              OR: [{ id: { in: jIds } }, { reversedById: { in: jIds } }, { reversesEntryId: { in: jIds } }],
            },
            data: { reversedById: null, reversesEntryId: null },
          });
          await tx.journalEntry.deleteMany({
            where: { id: { in: jIds }, organizationId },
          });
        }

        await tx.expenseClaim.delete({ where: { id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'EXPENSE_CLAIM_DELETED',
          entityType: 'EXPENSE_CLAIM',
          entityId: id,
          summary: `Deleted expense claim ${existing.claimNumber} "${existing.title}" (was ${existing.status})`,
        });
      });

      return reply.code(200).send({ message: 'Expense claim deleted successfully' });
    },
  );

  // POST /api/v1/expense-claims/:id/void — Revert/Void an APPROVED or SUBMITTED claim back to DRAFT
  fastify.post(
    '/api/v1/expense-claims/:id/void',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;

      const claim = await fastify.prisma.expenseClaim.findFirst({
        where: { id, organizationId },
        include: { employee: true },
      });

      if (!claim) {
        return reply.code(404).send({ error: 'Expense claim not found' });
      }

      if (claim.status === ExpenseClaimStatus.PAID) {
        return reply.code(400).send({
          error: 'Cannot revert a PAID expense claim to DRAFT. Reverse the reimbursement payout first.',
        });
      }

      if (claim.status === ExpenseClaimStatus.DRAFT) {
        return reply.code(400).send({ error: 'Expense claim is already in DRAFT status.' });
      }

      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        claim.approvedAt || new Date(),
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const activeJournal = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'EXPENSE_CLAIM',
          referenceId: claim.id,
          status: 'POSTED',
          reversedById: null,
        },
      });

      const updated = await fastify.prisma.$transaction(async (tx) => {
        if (activeJournal) {
          await reverseJournalEntry(tx, {
            organizationId,
            actorUserId: userId,
            journalEntryId: activeJournal.id,
            reversalDate: new Date(),
            reason: `Reverted Expense Claim ${claim.claimNumber} to DRAFT`,
            skipSubledgerCascade: true,
          });
        }

        const res = await tx.expenseClaim.update({
          where: { id },
          data: {
            status: ExpenseClaimStatus.DRAFT,
            approvedAt: null,
            approvedByUserId: null,
          },
          include: { items: true, employee: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'EXPENSE_CLAIM_REVERTED',
          entityType: 'EXPENSE_CLAIM',
          entityId: id,
          summary: `Reverted expense claim ${claim.claimNumber} (${claim.employee.name}) to DRAFT and reversed GL liability`,
        });

        return res;
      });

      return reply.code(200).send({
        message: 'Expense claim reverted to DRAFT and GL liability reversed',
        expenseClaim: serializeData(updated),
      });
    },
  );

  // POST /api/v1/expense-claims/:id/reverse-payment — Reverse reimbursement payout on a PAID claim
  fastify.post(
    '/api/v1/expense-claims/:id/reverse-payment',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;

      const claim = await fastify.prisma.expenseClaim.findFirst({
        where: { id, organizationId },
        include: { employee: true },
      });

      if (!claim) {
        return reply.code(404).send({ error: 'Expense claim not found' });
      }

      if (claim.status !== ExpenseClaimStatus.PAID) {
        return reply.code(400).send({
          error: `Only PAID expense claims can have their payout reversed (current status: ${claim.status}).`,
        });
      }

      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        claim.paidAt || new Date(),
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const payoutJournal = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: { in: ['EXPENSE_CLAIM_PAYOUT', 'EXPENSE_REIMBURSEMENT', 'EXPENSE_CLAIM_PAYMENT'] },
          referenceId: claim.id,
          status: 'POSTED',
          reversedById: null,
        },
      });

      const updated = await fastify.prisma.$transaction(async (tx) => {
        if (payoutJournal) {
          await reverseJournalEntry(tx, {
            organizationId,
            actorUserId: userId,
            journalEntryId: payoutJournal.id,
            reversalDate: new Date(),
            reason: `Reversed reimbursement payout for Expense Claim ${claim.claimNumber}`,
            skipSubledgerCascade: true,
          });
        }

        const res = await tx.expenseClaim.update({
          where: { id },
          data: {
            status: ExpenseClaimStatus.APPROVED,
            paidAt: null,
            paidFromBankId: null,
          },
          include: { items: true, employee: true },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'EXPENSE_REIMBURSEMENT_REVERSED',
          entityType: 'EXPENSE_CLAIM',
          entityId: id,
          summary: `Reversed reimbursement payout for expense claim ${claim.claimNumber}; claim restored to APPROVED`,
        });

        return res;
      });

      return reply.code(200).send({
        message: 'Reimbursement payout reversed; claim returned to APPROVED status',
        expenseClaim: serializeData(updated),
      });
    },
  );

  // POST /api/v1/expense-claims/:id/submit
  fastify.post(
    '/api/v1/expense-claims/:id/submit',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.EMPLOYEE,
        ),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const userRole = request.user.role!;
      const userId = request.user.userId;

      const claim = await fastify.prisma.expenseClaim.findFirst({
        where: { id, organizationId },
      });

      if (!claim) {
        return reply.code(404).send({ error: 'Expense claim not found' });
      }

      if (userRole === Role.EMPLOYEE && claim.employeeUserId !== userId) {
        return reply.code(403).send({ error: 'Forbidden: You can only submit your own claims' });
      }

      if (claim.status !== ExpenseClaimStatus.DRAFT && claim.status !== ExpenseClaimStatus.REJECTED) {
        return reply.code(400).send({
          error: `Cannot submit claim with status ${claim.status}. Only DRAFT or REJECTED claims can be submitted.`,
        });
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const res = await tx.expenseClaim.update({
          where: { id },
          data: {
            status: ExpenseClaimStatus.SUBMITTED,
            submittedAt: new Date(),
            rejectionReason: null,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'EXPENSE_CLAIM_SUBMITTED',
          entityType: 'EXPENSE_CLAIM',
          entityId: id,
          summary: `Submitted expense claim ${claim.claimNumber} for review`,
        });

        return res;
      });

      return reply.code(200).send({
        message: 'Expense claim submitted for approval',
        expenseClaim: serializeData(updated),
      });
    },
  );

  // POST /api/v1/expense-claims/:id/approve
  fastify.post(
    '/api/v1/expense-claims/:id/approve',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;

      const claim = await fastify.prisma.expenseClaim.findFirst({
        where: { id, organizationId },
        include: { items: true, employee: true },
      });

      if (!claim) {
        return reply.code(404).send({ error: 'Expense claim not found' });
      }

      if (claim.status !== ExpenseClaimStatus.SUBMITTED) {
        return reply.code(400).send({
          error: `Cannot approve claim with status ${claim.status}. Only SUBMITTED claims can be approved.`,
        });
      }

      // Maker-checker validation
      const org = await fastify.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { enforceTwoPersonApproval: true },
      });

      if (org?.enforceTwoPersonApproval && claim.employeeUserId === userId) {
        return reply.code(403).send({
          error: 'Two-person approval rule is enforced. You cannot approve your own expense claim.',
        });
      }

      // Check period lock date
      const approvalDate = new Date();
      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        approvalDate,
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      // Control accounts: 2050 Employee Reimbursements Payable & 2200 GST Paid
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['2050', '2200'] },
          isActive: true,
        },
      });

      const reimbursementsAccount = accounts.find((a) => a.code === '2050');
      const gstPaidAccount = accounts.find((a) => a.code === '2200');

      if (!reimbursementsAccount || !gstPaidAccount) {
        return reply.code(500).send({
          error: 'Required accounts (2050 Employee Reimbursements Payable, 2200 GST Paid) are missing or inactive.',
        });
      }

      // Build GL posting lines:
      // DEBIT line item expense accounts (subtotal)
      // DEBIT 2200 GST Paid (total GST)
      // CREDIT 2050 Employee Reimbursements Payable (total)
      const journalLines: Array<{
        accountId: string;
        trackingOptionId?: string | null;
        entryType: EntryType;
        amountCents: bigint;
        description?: string | null;
      }> = [];

      for (const it of claim.items) {
        journalLines.push({
          accountId: it.accountId,
          trackingOptionId: it.trackingOptionId,
          entryType: EntryType.DEBIT,
          amountCents: it.amountCents,
          description: `${it.merchant}: ${it.description}`,
        });
      }

      if (claim.gstCents > 0n) {
        journalLines.push({
          accountId: gstPaidAccount.id,
          entryType: EntryType.DEBIT,
          amountCents: claim.gstCents,
          description: 'GST Paid (Purchases)',
        });
      }

      journalLines.push({
        accountId: reimbursementsAccount.id,
        entryType: EntryType.CREDIT,
        amountCents: claim.totalCents,
        description: `Expense Reimbursement Payable - ${claim.employee.name} (${claim.claimNumber})`,
      });

      const result = await fastify.prisma.$transaction(async (tx) => {
        const updatedClaim = await tx.expenseClaim.update({
          where: { id },
          data: {
            status: ExpenseClaimStatus.APPROVED,
            approvedAt: approvalDate,
            approvedByUserId: userId,
          },
        });

        const journalEntry = await postJournalEntry(tx, {
          organizationId,
          actorUserId: userId,
          description: `Expense Claim Approval: ${claim.claimNumber} - ${claim.title} (${claim.employee.name})`,
          referenceType: 'EXPENSE_CLAIM',
          referenceId: id,
          postedAt: approvalDate,
          lines: journalLines,
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'EXPENSE_CLAIM_APPROVED',
          entityType: 'EXPENSE_CLAIM',
          entityId: id,
          summary: `Approved expense claim ${claim.claimNumber} ($${(Number(claim.totalCents) / 100).toFixed(2)}) for ${claim.employee.name} and posted to General Ledger (2050)`,
        });

        return { updatedClaim, journalEntry };
      });

      return reply.code(200).send({
        message: 'Expense claim approved and posted to General Ledger (2050 Employee Reimbursements Payable)',
        expenseClaim: serializeData(result.updatedClaim),
        journalEntry: serializeData(result.journalEntry),
      });
    },
  );

  // POST /api/v1/expense-claims/:id/reject
  fastify.post(
    '/api/v1/expense-claims/:id/reject',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const parse = RejectClaimBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;
      const { rejectionReason } = parse.data;

      const claim = await fastify.prisma.expenseClaim.findFirst({
        where: { id, organizationId },
        include: { employee: true },
      });

      if (!claim) {
        return reply.code(404).send({ error: 'Expense claim not found' });
      }

      if (claim.status !== ExpenseClaimStatus.SUBMITTED) {
        return reply.code(400).send({
          error: `Cannot reject claim with status ${claim.status}. Only SUBMITTED claims can be rejected.`,
        });
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const res = await tx.expenseClaim.update({
          where: { id },
          data: {
            status: ExpenseClaimStatus.REJECTED,
            rejectionReason,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'EXPENSE_CLAIM_REJECTED',
          entityType: 'EXPENSE_CLAIM',
          entityId: id,
          summary: `Rejected expense claim ${claim.claimNumber} (${claim.employee.name}): "${rejectionReason}"`,
        });

        return res;
      });

      return reply.code(200).send({
        message: 'Expense claim rejected',
        expenseClaim: serializeData(updated),
      });
    },
  );

  // POST /api/v1/expense-claims/:id/pay (Single individual payout)
  fastify.post(
    '/api/v1/expense-claims/:id/pay',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const parse = PayClaimBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;
      const { bankAccountId, paymentDate, reference } = parse.data;

      const claim = await fastify.prisma.expenseClaim.findFirst({
        where: { id, organizationId },
        include: { employee: true },
      });

      if (!claim) {
        return reply.code(404).send({ error: 'Expense claim not found' });
      }

      if (claim.status !== ExpenseClaimStatus.APPROVED) {
        return reply.code(400).send({
          error: `Cannot pay claim with status ${claim.status}. Only APPROVED claims can be settled.`,
        });
      }

      const pDate = paymentDate ? new Date(paymentDate) : new Date();

      // Check lock date
      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        pDate,
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      // Accounts: 2050 Employee Reimbursements Payable & Bank Account (1000)
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['1000', '2050'] },
          isActive: true,
        },
      });

      const reimbursementsAccount = accounts.find((a) => a.code === '2050');
      const bankAccount = bankAccountId
        ? await fastify.prisma.account.findFirst({
            where: { id: bankAccountId, organizationId, isActive: true },
          })
        : accounts.find((a) => a.code === '1000');

      if (!reimbursementsAccount || !bankAccount) {
        return reply.code(500).send({
          error: 'Required accounts (2050 Employee Reimbursements, selected Bank) are missing or inactive.',
        });
      }

      // GL Posting on Payout:
      // DEBIT 2050 Employee Reimbursements Payable (total)
      // CREDIT Bank Account (total)
      const journalLines = [
        {
          accountId: reimbursementsAccount.id,
          entryType: EntryType.DEBIT,
          amountCents: claim.totalCents,
          description: `Settlement of ${claim.claimNumber} - ${claim.employee.name}`,
        },
        {
          accountId: bankAccount.id,
          entryType: EntryType.CREDIT,
          amountCents: claim.totalCents,
          description: `EFT Payout for ${claim.claimNumber}: ${reference || claim.employee.name}`,
        },
      ];

      const result = await fastify.prisma.$transaction(async (tx) => {
        const updatedClaim = await tx.expenseClaim.update({
          where: { id },
          data: {
            status: ExpenseClaimStatus.PAID,
            paidAt: pDate,
            paidFromBankId: bankAccount.id,
          },
        });

        const journalEntry = await postJournalEntry(tx, {
          organizationId,
          actorUserId: userId,
          description: `Expense Reimbursement Payout: ${claim.claimNumber} - ${claim.employee.name}`,
          referenceType: 'EXPENSE_CLAIM_PAYOUT',
          referenceId: id,
          postedAt: pDate,
          lines: journalLines,
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'EXPENSE_CLAIM_PAID',
          entityType: 'EXPENSE_CLAIM',
          entityId: id,
          summary: `Paid out expense claim ${claim.claimNumber} ($${(Number(claim.totalCents) / 100).toFixed(2)}) to ${claim.employee.name} via ${bankAccount.name}`,
        });

        return { updatedClaim, journalEntry };
      });

      return reply.code(200).send({
        message: 'Expense claim reimbursed successfully and General Ledger updated',
        expenseClaim: serializeData(result.updatedClaim),
        journalEntry: serializeData(result.journalEntry),
      });
    },
  );
};

export default expenseClaimRoutes;
