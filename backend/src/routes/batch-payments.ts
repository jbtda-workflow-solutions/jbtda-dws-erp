/**
 * Batch Payments routes — Module 5 AP & Module 6 Employee Reimbursements APCA .ABA File Export
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET  /api/v1/batch-payments        (List batch payment runs with bills & employee claims)
 *  - POST /api/v1/batch-payments        (Execute EFT batch payment run and generate .ABA file)
 *  - GET  /api/v1/batch-payments/:id    (Get batch run details and constituent payments)
 *  - GET  /api/v1/batch-payments/:id/aba(Download generated .ABA file)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { generateAbaFile, AbaDetailRecord } from '../lib/aba.js';
import { recordAuditLog } from '../lib/audit.js';
import { checkOrganizationLockDate } from '../lib/ledger-posting.js';
import { BillStatus, EntryType, ExpenseClaimStatus, Role } from '@prisma/client';

const CreateBatchPaymentBody = z.object({
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  bankAccountId: z.string().uuid().optional(),
  description: z.string().max(12).default('SUPPLIER PMT'),
  billPayments: z.array(z.object({
    billId: z.string().uuid(),
    amountCents: z.number().int().positive().optional(),
  })).default([]),
  expenseClaimPayments: z.array(z.object({
    claimId: z.string().uuid(),
    amountCents: z.number().int().positive().optional(),
  })).default([]),
}).refine(
  (data) => (data.billPayments?.length ?? 0) > 0 || (data.expenseClaimPayments?.length ?? 0) > 0,
  { message: 'At least one bill or employee expense claim must be selected for batch payment' },
);

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

function serializeBatch<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

export const batchPaymentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/batch-payments
  fastify.get(
    '/api/v1/batch-payments',
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

      const batches = await fastify.prisma.batchPayment.findMany({
        where: { organizationId },
        include: {
          paymentsOut: {
            include: {
              bill: {
                select: {
                  id: true,
                  reference: true,
                  totalCents: true,
                  contact: {
                    select: { id: true, name: true, bankBsb: true, bankAccountNumber: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { paymentDate: 'desc' },
      });

      // Also attach linked expense claims for each batch
      const batchIds = batches.map((b) => b.id);
      const claims = await fastify.prisma.expenseClaim.findMany({
        where: {
          organizationId,
          batchPaymentId: { in: batchIds },
        },
        include: {
          employee: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      const claimsByBatch = new Map<string, typeof claims>();
      claims.forEach((c) => {
        if (c.batchPaymentId) {
          const list = claimsByBatch.get(c.batchPaymentId) || [];
          list.push(c);
          claimsByBatch.set(c.batchPaymentId, list);
        }
      });

      const enrichedBatches = batches.map((b) => ({
        ...b,
        expenseClaims: claimsByBatch.get(b.id) || [],
      }));

      return reply.code(200).send({ batchPayments: serializeBatch(enrichedBatches) });
    },
  );

  // GET /api/v1/batch-payments/:id
  fastify.get(
    '/api/v1/batch-payments/:id',
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

      const batch = await fastify.prisma.batchPayment.findFirst({
        where: { id, organizationId },
        include: {
          paymentsOut: {
            include: {
              bill: {
                include: {
                  contact: true,
                },
              },
            },
          },
        },
      });

      if (!batch) return reply.code(404).send({ error: 'Batch payment run not found' });

      const claims = await fastify.prisma.expenseClaim.findMany({
        where: {
          organizationId,
          batchPaymentId: id,
        },
        include: {
          employee: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      return reply.code(200).send({
        batchPayment: serializeBatch({
          ...batch,
          expenseClaims: claims,
        }),
      });
    },
  );

  // GET /api/v1/batch-payments/:id/aba
  fastify.get(
    '/api/v1/batch-payments/:id/aba',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AP_SPECIALIST,
        ),
      ],
    },
    async (request, reply) => {
      const { id } = ParamsWithId.parse(request.params);
      const organizationId = request.user.organizationId!;

      const batch = await fastify.prisma.batchPayment.findFirst({
        where: { id, organizationId },
      });

      if (!batch) return reply.code(404).send({ error: 'Batch payment run not found' });
      if (!batch.abaFileContent) return reply.code(404).send({ error: 'ABA file content not found for this batch' });

      const filename = `${batch.batchNumber || 'batch_payment'}.aba`;
      return reply
        .header('Content-Type', 'text/plain')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(batch.abaFileContent);
    },
  );

  // POST /api/v1/batch-payments
  fastify.post(
    '/api/v1/batch-payments',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AP_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreateBatchPaymentBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parse.error.flatten().fieldErrors });
      }

      const { paymentDate, bankAccountId, description, billPayments, expenseClaimPayments } = parse.data;
      const organizationId = request.user.organizationId!;
      const pDate = new Date(paymentDate);

      await checkOrganizationLockDate(fastify.prisma, organizationId, pDate);

      const org = await fastify.prisma.organization.findUnique({ where: { id: organizationId } });
      if (!org) return reply.code(404).send({ error: 'Organization not found' });

      if (!org.bankBsb || !org.bankAccountNumber) {
        return reply.code(400).send({
          error: 'Organization bank BSB and account number must be configured in Workspace Governance before creating .ABA batch payments',
        });
      }

      // Accounts: 1000 Bank, 2000 AP, 2050 Employee Reimbursements
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['1000', '2000', '2050'] },
          isActive: true,
        },
      });

      const bankAccount = bankAccountId
        ? await fastify.prisma.account.findFirst({ where: { id: bankAccountId, organizationId } })
        : accounts.find((a) => a.code === '1000');

      const apAccount = accounts.find((a) => a.code === '2000');
      const reimbursementsAccount = accounts.find((a) => a.code === '2050');

      if (!bankAccount) {
        return reply.code(500).send({ error: 'Operating bank account (1000) not found' });
      }

      const abaRecords: AbaDetailRecord[] = [];
      let totalBatchCents = 0n;

      // ---------------------------------------------------------------------
      // 1. Process Bill Payments
      // ---------------------------------------------------------------------
      let totalBillsCents = 0n;
      const paymentAllocations: Array<{ bill: any; amountCents: bigint }> = [];

      if (billPayments && billPayments.length > 0) {
        if (!apAccount) {
          return reply.code(500).send({ error: 'Accounts Payable account (2000) not found' });
        }

        const billIds = billPayments.map((b) => b.billId);
        const bills = await fastify.prisma.bill.findMany({
          where: { id: { in: billIds }, organizationId },
          include: { contact: true },
        });

        if (bills.length !== billIds.length) {
          return reply.code(400).send({ error: 'One or more specified bills do not exist in this organization' });
        }

        for (const bp of billPayments) {
          const bill = bills.find((b) => b.id === bp.billId)!;
          if (bill.status === BillStatus.PAID || bill.status === BillStatus.VOID) {
            return reply.code(400).send({
              error: `Bill ${bill.reference || bill.id} cannot be paid because status is ${bill.status}`,
            });
          }

          const unpaidBalance = bill.totalCents - bill.amountPaidCents;
          const amountToPay = bp.amountCents ? BigInt(bp.amountCents) : unpaidBalance;

          if (amountToPay <= 0n || amountToPay > unpaidBalance) {
            return reply.code(400).send({
              error: `Invalid payment amount for bill ${bill.reference || bill.id}. Unpaid balance is ${Number(unpaidBalance)} cents.`,
            });
          }

          const vendor = bill.contact;
          if (!vendor.bankBsb || !vendor.bankAccountNumber) {
            return reply.code(400).send({
              error: `Vendor "${vendor.name}" (Bill ${bill.reference || bill.id}) does not have bank BSB and account number configured for EFT payments`,
            });
          }

          totalBillsCents += amountToPay;
          totalBatchCents += amountToPay;
          paymentAllocations.push({ bill, amountCents: amountToPay });

          abaRecords.push({
            bsb: vendor.bankBsb,
            accountNumber: vendor.bankAccountNumber,
            accountName: vendor.name.substring(0, 32),
            amountCents: amountToPay,
            lodgementReference: (bill.reference || 'BILL').substring(0, 18),
            traceBsb: org.bankBsb,
            traceAccountNumber: org.bankAccountNumber,
            remitterName: org.name.substring(0, 16),
          });
        }
      }

      // ---------------------------------------------------------------------
      // 2. Process Employee Expense Claims
      // ---------------------------------------------------------------------
      let totalClaimsCents = 0n;
      const claimAllocations: Array<{ claim: any; amountCents: bigint; member: any }> = [];

      if (expenseClaimPayments && expenseClaimPayments.length > 0) {
        if (!reimbursementsAccount) {
          return reply.code(500).send({ error: 'Employee Reimbursements Payable account (2050) not found' });
        }

        const claimIds = expenseClaimPayments.map((cp) => cp.claimId);
        const claims = await fastify.prisma.expenseClaim.findMany({
          where: { id: { in: claimIds }, organizationId },
          include: { employee: true },
        });

        if (claims.length !== claimIds.length) {
          return reply.code(400).send({ error: 'One or more specified expense claims do not exist in this organization' });
        }

        const employeeUserIds = Array.from(new Set(claims.map((c) => c.employeeUserId)));
        const members = await fastify.prisma.organizationMember.findMany({
          where: { organizationId, userId: { in: employeeUserIds } },
          select: {
            userId: true,
            bankBsb: true,
            bankAccountNumber: true,
            bankAccountName: true,
          },
        });
        const memberMap = new Map(members.map((m) => [m.userId, m]));

        for (const cp of expenseClaimPayments) {
          const claim = claims.find((c) => c.id === cp.claimId)!;
          if (claim.status !== ExpenseClaimStatus.APPROVED) {
            return reply.code(400).send({
              error: `Expense claim ${claim.claimNumber} cannot be paid because status is ${claim.status}. Only APPROVED claims can be settled.`,
            });
          }

          const amountToPay = cp.amountCents ? BigInt(cp.amountCents) : claim.totalCents;
          if (amountToPay <= 0n || amountToPay > claim.totalCents) {
            return reply.code(400).send({
              error: `Invalid reimbursement amount for claim ${claim.claimNumber}. Total due is ${Number(claim.totalCents)} cents.`,
            });
          }

          const member = memberMap.get(claim.employeeUserId);
          if (!member?.bankBsb || !member?.bankAccountNumber) {
            return reply.code(400).send({
              error: `Employee "${claim.employee.name}" (${claim.claimNumber}) does not have EFT bank BSB and account number configured in their member profile`,
            });
          }

          totalClaimsCents += amountToPay;
          totalBatchCents += amountToPay;
          claimAllocations.push({ claim, amountCents: amountToPay, member });

          abaRecords.push({
            bsb: member.bankBsb,
            accountNumber: member.bankAccountNumber,
            accountName: (member.bankAccountName || claim.employee.name).substring(0, 32),
            amountCents: amountToPay,
            lodgementReference: (claim.claimNumber || 'EXPENSE').substring(0, 18),
            traceBsb: org.bankBsb,
            traceAccountNumber: org.bankAccountNumber,
            remitterName: org.name.substring(0, 16),
          });
        }
      }

      // Generate Australian CEMTEX .ABA File
      const abaFileString = generateAbaFile(
        {
          financialInstitution: 'WBC',
          userSupplyingName: org.name,
          userIdentificationNumber: org.apcaUserId || '000000',
          descriptionOfEntries: description,
          processingDate: pDate,
        },
        abaRecords,
      );

      const batchCount = await fastify.prisma.batchPayment.count({ where: { organizationId } });
      const batchNumber = `ABA-${String(batchCount + 1).padStart(4, '0')}`;
      const totalItems = paymentAllocations.length + claimAllocations.length;

      const result = await fastify.prisma.$transaction(async (tx) => {
        const batchRecord = await tx.batchPayment.create({
          data: {
            organizationId,
            batchNumber,
            paymentDate: pDate,
            bankAccountId: bankAccount.id,
            description,
            totalCents: totalBatchCents,
            itemCount: totalItems,
            abaFileContent: abaFileString,
            createdByUserId: request.user.userId,
          },
        });

        // Record Payments Out for Bills
        const createdPayments = [];
        for (const alloc of paymentAllocations) {
          const pmt = await tx.paymentOut.create({
            data: {
              organizationId,
              billId: alloc.bill.id,
              bankAccountId: bankAccount.id,
              batchPaymentId: batchRecord.id,
              paymentDate: pDate,
              amountCents: alloc.amountCents,
              reference: `Batch ${batchNumber} - ${alloc.bill.reference || alloc.bill.id}`,
            },
          });
          createdPayments.push(pmt);

          const newAmountPaid = alloc.bill.amountPaidCents + alloc.amountCents;
          const newStatus = newAmountPaid >= alloc.bill.totalCents ? BillStatus.PAID : BillStatus.PARTIALLY_PAID;

          await tx.bill.update({
            where: { id: alloc.bill.id },
            data: {
              amountPaidCents: newAmountPaid,
              status: newStatus,
            },
          });
        }

        // Update Expense Claims to PAID
        const updatedClaims = [];
        for (const alloc of claimAllocations) {
          const updatedClaim = await tx.expenseClaim.update({
            where: { id: alloc.claim.id },
            data: {
              status: ExpenseClaimStatus.PAID,
              paidAt: pDate,
              paidFromBankId: bankAccount.id,
              batchPaymentId: batchRecord.id,
            },
          });
          updatedClaims.push(updatedClaim);

          await recordAuditLog(tx, {
            organizationId,
            actorUserId: request.user.userId,
            action: 'EXPENSE_CLAIM_PAID',
            entityType: 'EXPENSE_CLAIM',
            entityId: alloc.claim.id,
            summary: `Reimbursed expense claim ${alloc.claim.claimNumber} ($${(Number(alloc.amountCents) / 100).toFixed(2)}) via Batch Payment ${batchNumber}`,
          });
        }

        // Consolidated GL Journal Entry
        // DEBIT 2000 AP (totalBillsCents, if > 0)
        // DEBIT 2050 Employee Reimbursements (totalClaimsCents, if > 0)
        // CREDIT Bank Account (totalBatchCents)
        const count = await tx.journalEntry.count({ where: { organizationId } });
        const entryNumber = `JE-ABA-${String(count + 1).padStart(5, '0')}`;

        const glLines: Array<{
          organizationId: string;
          accountId: string;
          entryType: EntryType;
          amountCents: bigint;
        }> = [];

        if (totalBillsCents > 0n && apAccount) {
          glLines.push({
            organizationId,
            accountId: apAccount.id,
            entryType: EntryType.DEBIT,
            amountCents: totalBillsCents,
          });
        }

        if (totalClaimsCents > 0n && reimbursementsAccount) {
          glLines.push({
            organizationId,
            accountId: reimbursementsAccount.id,
            entryType: EntryType.DEBIT,
            amountCents: totalClaimsCents,
          });
        }

        glLines.push({
          organizationId,
          accountId: bankAccount.id,
          entryType: EntryType.CREDIT,
          amountCents: totalBatchCents,
        });

        await tx.journalEntry.create({
          data: {
            organizationId,
            entryNumber,
            description: `EFT Batch Payment ${batchNumber} (${totalItems} payees)`,
            referenceType: 'BATCH_PAYMENT',
            referenceId: batchRecord.id,
            postedAt: pDate,
            status: 'POSTED',
            createdByUserId: request.user.userId,
            lines: { create: glLines },
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BATCH_PAYMENT_CREATED',
          entityType: 'BATCH_PAYMENT',
          entityId: batchRecord.id,
          summary: `Created EFT batch payment ${batchNumber} ($${(Number(totalBatchCents) / 100).toFixed(2)}) for ${totalItems} payees (${paymentAllocations.length} bills, ${claimAllocations.length} expense claims)`,
        });

        return { batchRecord, createdPayments, updatedClaims };
      });

      return reply.code(201).send({
        message: 'Batch payment successfully created and ABA file generated',
        batchPayment: serializeBatch(result.batchRecord),
        billsPaidCount: result.createdPayments.length,
        claimsPaidCount: result.updatedClaims.length,
      });
    },
  );
};

export default batchPaymentRoutes;
