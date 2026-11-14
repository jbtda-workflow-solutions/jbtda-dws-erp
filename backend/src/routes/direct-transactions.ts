/**
 * Direct Transactions routes — Module 6 Enterprise Expenses & Direct Bank/Card Purchases
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET  /api/v1/direct-transactions     (List direct spend/receive money transactions)
 *  - POST /api/v1/direct-transactions     (Create direct spend money with multi-line coding and GL posting)
 *  - GET  /api/v1/direct-transactions/:id (Get single transaction details, lines, and journal entry)
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
import { DirectTransactionType, EntryType, Role, TaxTreatment } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const DirectTransactionTypeEnum = z.nativeEnum(DirectTransactionType);

const DirectLineInput = z.object({
  accountId: z.string().uuid(),
  description: z.string().trim().min(1).max(255),
  amountCents: z.number().int().positive(),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
  trackingOptionId: z.string().uuid().nullable().optional(),
});

const CreateDirectTransactionBody = z.object({
  type: DirectTransactionTypeEnum.default(DirectTransactionType.SPEND_MONEY),
  bankAccountId: z.string().uuid(),
  contactId: z.string().uuid().nullable().optional(),
  payeeName: z.string().trim().max(100).nullable().optional(),
  transactionDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  reference: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(DirectLineInput).min(1),
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

export const directTransactionRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/direct-transactions
  fastify.get(
    '/api/v1/direct-transactions',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AP_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const query = request.query as Record<string, string | undefined>;

      const whereClause: any = { organizationId };

      if (query.type && Object.values(DirectTransactionType).includes(query.type as any)) {
        whereClause.type = query.type as DirectTransactionType;
      }

      if (query.bankAccountId) {
        whereClause.bankAccountId = query.bankAccountId;
      }

      if (query.startDate || query.endDate) {
        whereClause.transactionDate = {};
        if (query.startDate) whereClause.transactionDate.gte = new Date(query.startDate);
        if (query.endDate) whereClause.transactionDate.lte = new Date(query.endDate);
      }

      const transactions = await fastify.prisma.directTransaction.findMany({
        where: whereClause,
        include: {
          contact: {
            select: { id: true, name: true, type: true },
          },
          lines: true,
        },
        orderBy: { transactionDate: 'desc' },
      });

      // Fetch accounts and tracking options to enrich line items
      const accountIds = new Set<string>();
      const trackingIds = new Set<string>();

      transactions.forEach((tx) => {
        accountIds.add(tx.bankAccountId);
        tx.lines.forEach((l) => {
          accountIds.add(l.accountId);
          if (l.trackingOptionId) trackingIds.add(l.trackingOptionId);
        });
      });

      const accounts = await fastify.prisma.account.findMany({
        where: { id: { in: Array.from(accountIds) }, organizationId },
        select: { id: true, code: true, name: true, type: true },
      });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const trackingOptions = await fastify.prisma.trackingOption.findMany({
        where: { id: { in: Array.from(trackingIds) }, organizationId },
        select: { id: true, name: true },
      });
      const trackingMap = new Map(trackingOptions.map((o) => [o.id, o]));

      const enrichedTransactions = transactions.map((tx) => {
        const bankAcc = accountMap.get(tx.bankAccountId);
        return {
          ...tx,
          bankAccountCode: bankAcc?.code || '',
          bankAccountName: bankAcc?.name || '',
          lines: tx.lines.map((l) => {
            const acc = accountMap.get(l.accountId);
            const trk = l.trackingOptionId ? trackingMap.get(l.trackingOptionId) : null;
            return {
              ...l,
              accountCode: acc?.code || '',
              accountName: acc?.name || '',
              trackingOptionName: trk?.name || null,
            };
          }),
        };
      });

      return reply.code(200).send({ directTransactions: serializeData(enrichedTransactions) });
    },
  );

  // GET /api/v1/direct-transactions/:id
  fastify.get(
    '/api/v1/direct-transactions/:id',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AP_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const transaction = await fastify.prisma.directTransaction.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lines: true,
        },
      });

      if (!transaction) {
        return reply.code(404).send({ error: 'Direct transaction not found' });
      }

      // Fetch linked journal entry
      const journalEntry = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'DIRECT_TRANSACTION',
          referenceId: id,
        },
        include: {
          lines: true,
        },
      });

      // Enrich lines
      const accountIds = new Set<string>([transaction.bankAccountId]);
      transaction.lines.forEach((l) => accountIds.add(l.accountId));
      if (journalEntry) {
        journalEntry.lines.forEach((l) => accountIds.add(l.accountId));
      }

      const accounts = await fastify.prisma.account.findMany({
        where: { id: { in: Array.from(accountIds) }, organizationId },
        select: { id: true, code: true, name: true, type: true },
      });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const bankAcc = accountMap.get(transaction.bankAccountId);

      const enrichedLines = transaction.lines.map((l) => {
        const acc = accountMap.get(l.accountId);
        return {
          ...l,
          accountCode: acc?.code || '',
          accountName: acc?.name || '',
        };
      });

      const enrichedJournal = journalEntry
        ? {
            ...journalEntry,
            lines: journalEntry.lines.map((l) => {
              const acc = accountMap.get(l.accountId);
              return {
                ...l,
                accountCode: acc?.code || '',
                accountName: acc?.name || '',
              };
            }),
          }
        : null;

      return reply.code(200).send({
        directTransaction: serializeData({
          ...transaction,
          bankAccountCode: bankAcc?.code || '',
          bankAccountName: bankAcc?.name || '',
          lines: enrichedLines,
        }),
        journalEntry: serializeData(enrichedJournal),
      });
    },
  );

  // POST /api/v1/direct-transactions
  fastify.post(
    '/api/v1/direct-transactions',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreateDirectTransactionBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const {
        type,
        bankAccountId,
        contactId,
        payeeName,
        transactionDate,
        reference,
        notes,
        lines,
      } = parse.data;

      const organizationId = request.user.organizationId!;
      const parsedDate = new Date(transactionDate);

      // Period lock check
      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        parsedDate,
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      // Verify bank/card account
      const bankAccount = await fastify.prisma.account.findFirst({
        where: { id: bankAccountId, organizationId, isActive: true },
      });

      if (!bankAccount) {
        return reply.code(400).send({
          error: 'Selected bank or card account is invalid, inactive, or not found.',
        });
      }

      // Verify contact if specified
      if (contactId) {
        const contact = await fastify.prisma.contact.findFirst({
          where: { id: contactId, organizationId },
        });
        if (!contact) {
          return reply.code(400).send({ error: 'Specified contact not found' });
        }
      }

      // Accounts needed for GST (2200 for purchases, 2100 for sales)
      const gstCode = type === DirectTransactionType.SPEND_MONEY ? '2200' : '2100';
      const gstAccount = await fastify.prisma.account.findFirst({
        where: { organizationId, code: gstCode, isActive: true },
      });

      if (!gstAccount) {
        return reply.code(500).send({
          error: `Required GST account (${gstCode}) is missing or inactive for this organization.`,
        });
      }

      // Verify all line accounts exist and are active
      const lineAccountIds = Array.from(new Set(lines.map((l) => l.accountId)));
      const validLineAccounts = await fastify.prisma.account.findMany({
        where: {
          id: { in: lineAccountIds },
          organizationId,
          isActive: true,
        },
      });

      if (validLineAccounts.length !== lineAccountIds.length) {
        return reply.code(400).send({
          error: 'One or more line accounts are invalid, inactive, or not found.',
        });
      }

      // Calculate line GST and totals
      const processedLines = lines.map((line) => {
        const rawAmount = BigInt(line.amountCents);
        const gstResult = calculateGST(rawAmount, line.taxTreatment);
        return {
          accountId: line.accountId,
          trackingOptionId: line.trackingOptionId || null,
          description: line.description,
          taxTreatment: line.taxTreatment,
          amountCents: gstResult.subtotalCents,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
        };
      });

      const totalResult = sumGSTResults(
        processedLines.map((l) => ({
          subtotalCents: l.amountCents,
          gstCents: l.gstCents,
          totalCents: l.totalCents,
        })),
      );

      // Execute transaction and direct GL posting
      const result = await fastify.prisma.$transaction(async (tx) => {
        const directTx = await tx.directTransaction.create({
          data: {
            organizationId,
            type,
            bankAccountId: bankAccount.id,
            contactId: contactId || null,
            payeeName: payeeName || null,
            transactionDate: parsedDate,
            reference: reference || null,
            notes: notes || null,
            subtotalCents: totalResult.subtotalCents,
            gstCents: totalResult.gstCents,
            totalCents: totalResult.totalCents,
            createdByUserId: request.user.userId,
            lines: {
              create: processedLines.map((l) => ({
                organizationId,
                accountId: l.accountId,
                trackingOptionId: l.trackingOptionId,
                description: l.description,
                taxTreatment: l.taxTreatment,
                amountCents: l.amountCents,
                gstCents: l.gstCents,
                totalCents: l.totalCents,
              })),
            },
          },
          include: { lines: true },
        });

        // Double-entry GL posting
        // SPEND_MONEY:
        //   DEBIT line item expense accounts (subtotal)
        //   DEBIT 2200 GST Paid (total GST)
        //   CREDIT bank account (total)
        // RECEIVE_MONEY:
        //   DEBIT bank account (total)
        //   CREDIT line item revenue accounts (subtotal)
        //   CREDIT 2100 GST Collected (total GST)
        const journalLines: Array<{
          accountId: string;
          trackingOptionId?: string | null;
          entryType: EntryType;
          amountCents: bigint;
          description?: string | null;
        }> = [];

        if (type === DirectTransactionType.SPEND_MONEY) {
          // Debits for each expense line
          for (const l of processedLines) {
            journalLines.push({
              accountId: l.accountId,
              trackingOptionId: l.trackingOptionId,
              entryType: EntryType.DEBIT,
              amountCents: l.amountCents,
              description: l.description,
            });
          }

          // Debit for GST Paid
          if (totalResult.gstCents > 0n) {
            journalLines.push({
              accountId: gstAccount.id,
              entryType: EntryType.DEBIT,
              amountCents: totalResult.gstCents,
              description: 'GST Paid (Purchases)',
            });
          }

          // Credit for Bank/Card payment
          journalLines.push({
            accountId: bankAccount.id,
            entryType: EntryType.CREDIT,
            amountCents: totalResult.totalCents,
            description: `Direct Spend Money - ${payeeName || reference || 'Payment'}`,
          });
        } else {
          // Debit for Bank cash received
          journalLines.push({
            accountId: bankAccount.id,
            entryType: EntryType.DEBIT,
            amountCents: totalResult.totalCents,
            description: `Direct Receive Money - ${payeeName || reference || 'Receipt'}`,
          });

          // Credits for each revenue line
          for (const l of processedLines) {
            journalLines.push({
              accountId: l.accountId,
              trackingOptionId: l.trackingOptionId,
              entryType: EntryType.CREDIT,
              amountCents: l.amountCents,
              description: l.description,
            });
          }

          // Credit for GST Collected
          if (totalResult.gstCents > 0n) {
            journalLines.push({
              accountId: gstAccount.id,
              entryType: EntryType.CREDIT,
              amountCents: totalResult.gstCents,
              description: 'GST Collected (Sales)',
            });
          }
        }

        const journalEntry = await postJournalEntry(tx, {
          organizationId,
          actorUserId: request.user.userId,
          description: `${type === DirectTransactionType.SPEND_MONEY ? 'Direct Spend Money' : 'Direct Receive Money'}: ${payeeName || reference || 'Transaction'}`,
          referenceType: 'DIRECT_TRANSACTION',
          referenceId: directTx.id,
          postedAt: parsedDate,
          lines: journalLines,
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'DIRECT_TRANSACTION_CREATED',
          entityType: 'DIRECT_TRANSACTION',
          entityId: directTx.id,
          summary: `Created ${type} ($${(Number(totalResult.totalCents) / 100).toFixed(2)}) paid via ${bankAccount.name} (${bankAccount.code})`,
        });

        return { directTx, journalEntry };
      });

      return reply.code(201).send({
        message: 'Direct transaction created and posted to General Ledger successfully',
        directTransaction: serializeData(result.directTx),
        journalEntry: serializeData(result.journalEntry),
      });
    },
  );

  // PATCH /api/v1/direct-transactions/:id — Edit direct transaction and synchronize GL journal
  fastify.patch(
    '/api/v1/direct-transactions/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const parse = CreateDirectTransactionBody.partial().safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const existing = await fastify.prisma.directTransaction.findFirst({
        where: { id, organizationId },
        include: { lines: true },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Direct transaction not found' });
      }

      const targetDate = parse.data.transactionDate ? new Date(parse.data.transactionDate) : existing.transactionDate;
      const lockCheck = await checkOrganizationLockDate(fastify.prisma, organizationId, targetDate);
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const targetBankAccountId = parse.data.bankAccountId || existing.bankAccountId;
      const bankAccount = await fastify.prisma.account.findFirst({
        where: { id: targetBankAccountId, organizationId, isActive: true },
      });
      if (!bankAccount) {
        return reply.code(400).send({ error: 'Selected bank or card account is invalid or inactive.' });
      }

      const targetType = parse.data.type || existing.type;
      const gstCode = targetType === DirectTransactionType.SPEND_MONEY ? '2200' : '2100';
      const gstAccount = await fastify.prisma.account.findFirst({
        where: { organizationId, code: gstCode, isActive: true },
      });
      if (!gstAccount) {
        return reply.code(500).send({ error: `Required GST account (${gstCode}) is missing.` });
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        let subtotalCents = existing.subtotalCents;
        let gstCents = existing.gstCents;
        let totalCents = existing.totalCents;

        if (parse.data.lines && parse.data.lines.length > 0) {
          await tx.directTransactionLine.deleteMany({
            where: { directTransactionId: id, organizationId },
          });

          const processedLines = parse.data.lines.map((line) => {
            const rawAmount = BigInt(line.amountCents);
            const gstResult = calculateGST(rawAmount, line.taxTreatment);
            return {
              organizationId,
              directTransactionId: id,
              accountId: line.accountId,
              trackingOptionId: line.trackingOptionId || null,
              description: line.description,
              taxTreatment: line.taxTreatment,
              amountCents: gstResult.subtotalCents,
              gstCents: gstResult.gstCents,
              totalCents: gstResult.totalCents,
            };
          });

          const totalResult = sumGSTResults(
            processedLines.map((l) => ({
              subtotalCents: l.amountCents,
              gstCents: l.gstCents,
              totalCents: l.totalCents,
            })),
          );

          subtotalCents = totalResult.subtotalCents;
          gstCents = totalResult.gstCents;
          totalCents = totalResult.totalCents;

          await tx.directTransactionLine.createMany({ data: processedLines });
        }

        const directTx = await tx.directTransaction.update({
          where: { id },
          data: {
            type: targetType,
            bankAccountId: targetBankAccountId,
            contactId: parse.data.contactId !== undefined ? parse.data.contactId : existing.contactId,
            payeeName: parse.data.payeeName !== undefined ? parse.data.payeeName : existing.payeeName,
            transactionDate: targetDate,
            reference: parse.data.reference !== undefined ? parse.data.reference : existing.reference,
            notes: parse.data.notes !== undefined ? parse.data.notes : existing.notes,
            subtotalCents,
            gstCents,
            totalCents,
          },
          include: { lines: true, contact: true },
        });

        const journalLines: Array<{
          accountId: string;
          trackingOptionId?: string | null;
          entryType: EntryType;
          amountCents: bigint;
          description?: string | null;
        }> = [];

        if (directTx.type === DirectTransactionType.SPEND_MONEY) {
          for (const l of directTx.lines) {
            if (l.amountCents > 0n) {
              journalLines.push({
                accountId: l.accountId,
                trackingOptionId: l.trackingOptionId,
                entryType: EntryType.DEBIT,
                amountCents: l.amountCents,
                description: l.description,
              });
            }
          }
          if (directTx.gstCents > 0n) {
            journalLines.push({
              accountId: gstAccount.id,
              entryType: EntryType.DEBIT,
              amountCents: directTx.gstCents,
              description: 'GST Paid (Purchases)',
            });
          }
          journalLines.push({
            accountId: bankAccount.id,
            entryType: EntryType.CREDIT,
            amountCents: directTx.totalCents,
            description: `Direct Spend Money - ${directTx.payeeName || directTx.reference || 'Payment'}`,
          });
        } else {
          journalLines.push({
            accountId: bankAccount.id,
            entryType: EntryType.DEBIT,
            amountCents: directTx.totalCents,
            description: `Direct Receive Money - ${directTx.payeeName || directTx.reference || 'Receipt'}`,
          });
          for (const l of directTx.lines) {
            if (l.amountCents > 0n) {
              journalLines.push({
                accountId: l.accountId,
                trackingOptionId: l.trackingOptionId,
                entryType: EntryType.CREDIT,
                amountCents: l.amountCents,
                description: l.description,
              });
            }
          }
          if (directTx.gstCents > 0n) {
            journalLines.push({
              accountId: gstAccount.id,
              entryType: EntryType.CREDIT,
              amountCents: directTx.gstCents,
              description: 'GST Collected (Sales)',
            });
          }
        }

        if (journalLines.length >= 2) {
          await syncOrReplaceJournalEntry(tx, {
            organizationId,
            actorUserId: request.user.userId,
            description: `${directTx.type === DirectTransactionType.SPEND_MONEY ? 'Direct Spend Money' : 'Direct Receive Money'}: ${directTx.payeeName || directTx.reference || 'Transaction'}`,
            referenceType: 'DIRECT_TRANSACTION',
            referenceId: directTx.id,
            postedAt: directTx.transactionDate,
            lines: journalLines,
          });
        }

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'DIRECT_TRANSACTION_UPDATED',
          entityType: 'DIRECT_TRANSACTION',
          entityId: directTx.id,
          summary: `Updated ${directTx.type} ($${(Number(directTx.totalCents) / 100).toFixed(2)})`,
        });

        return directTx;
      });

      return reply.code(200).send({
        message: 'Direct transaction updated and GL synchronized',
        directTransaction: serializeData(updated),
      });
    },
  );

  // DELETE /api/v1/direct-transactions/:id — Void/delete direct transaction and reverse/delete GL journal
  fastify.delete(
    '/api/v1/direct-transactions/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const existing = await fastify.prisma.directTransaction.findFirst({
        where: { id, organizationId },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Direct transaction not found' });
      }

      const lockCheck = await checkOrganizationLockDate(
        fastify.prisma,
        organizationId,
        existing.transactionDate,
      );
      if (lockCheck.locked) {
        return reply.code(400).send({ error: lockCheck.message });
      }

      const activeJournal = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'DIRECT_TRANSACTION',
          referenceId: id,
          status: 'POSTED',
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
            reason: `Deleted Direct Transaction ${existing.reference || existing.payeeName || existing.id}`,
            skipSubledgerCascade: true,
          });
        }

        await tx.directTransaction.delete({ where: { id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'DIRECT_TRANSACTION_DELETED',
          entityType: 'DIRECT_TRANSACTION',
          entityId: id,
          summary: `Deleted ${existing.type} ($${(Number(existing.totalCents) / 100).toFixed(2)}) and reversed GL posting`,
        });
      });

      return reply.code(200).send({
        success: true,
        message: 'Direct transaction deleted and GL posting reversed',
      });
    },
  );
};

export default directTransactionRoutes;
