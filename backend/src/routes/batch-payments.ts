/**
 * Batch Payments routes — Module 5 Accounts Payable (AP) & APCA .ABA File Export
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET  /api/v1/batch-payments        (List batch payment runs)
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
import { BillStatus, EntryType, Role } from '@prisma/client';

const CreateBatchPaymentBody = z.object({
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  bankAccountId: z.string().uuid().optional(),
  description: z.string().max(12).default('SUPPLIER PMT'),
  billPayments: z.array(z.object({
    billId: z.string().uuid(),
    amountCents: z.number().int().positive().optional(),
  })).min(1),
});

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

      return reply.code(200).send({ batchPayments: serializeBatch(batches) });
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
      return reply.code(200).send({ batchPayment: serializeBatch(batch) });
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

      const { paymentDate, bankAccountId, description, billPayments } = parse.data;
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

      // Bank GL Account (1000) & AP Account (2000)
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['1000', '2000'] },
          isActive: true,
        },
      });

      const bankAccount = bankAccountId
        ? await fastify.prisma.account.findFirst({ where: { id: bankAccountId, organizationId } })
        : accounts.find((a) => a.code === '1000');

      const apAccount = accounts.find((a) => a.code === '2000');

      if (!bankAccount || !apAccount) {
        return reply.code(500).send({ error: 'Required accounts (1000 Bank, 2000 AP) not found' });
      }

      const billIds = billPayments.map((b) => b.billId);
      const bills = await fastify.prisma.bill.findMany({
        where: { id: { in: billIds }, organizationId },
        include: { contact: true },
      });

      if (bills.length !== billIds.length) {
        return reply.code(400).send({ error: 'One or more specified bills do not exist in this organization' });
      }

      const abaRecords: AbaDetailRecord[] = [];
      const paymentAllocations: Array<{ bill: typeof bills[0]; amountCents: bigint }> = [];
      let totalBatchCents = 0n;

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

      const result = await fastify.prisma.$transaction(async (tx) => {
        const batchRecord = await tx.batchPayment.create({
          data: {
            organizationId,
            batchNumber,
            paymentDate: pDate,
            bankAccountId: bankAccount.id,
            description,
            totalCents: totalBatchCents,
            itemCount: paymentAllocations.length,
            abaFileContent: abaFileString,
            createdByUserId: request.user.userId,
          },
        });

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

        // Consolidated GL Journal Entry
        const count = await tx.journalEntry.count({ where: { organizationId } });
        const entryNumber = `JE-ABA-${String(count + 1).padStart(5, '0')}`;

        await tx.journalEntry.create({
          data: {
            organizationId,
            entryNumber,
            description: `EFT Batch Payment ${batchNumber} (${abaRecords.length} suppliers)`,
            referenceType: 'BATCH_PAYMENT',
            referenceId: batchRecord.id,
            postedAt: pDate,
            status: 'POSTED',
            createdByUserId: request.user.userId,
            lines: {
              create: [
                {
                  organizationId,
                  accountId: apAccount.id,
                  entryType: EntryType.DEBIT,
                  amountCents: totalBatchCents,
                },
                {
                  organizationId,
                  accountId: bankAccount.id,
                  entryType: EntryType.CREDIT,
                  amountCents: totalBatchCents,
                },
              ],
            },
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'BATCH_PAYMENT_CREATED',
          entityType: 'BATCH_PAYMENT',
          entityId: batchRecord.id,
          summary: `Created EFT batch payment ${batchNumber} ($${(Number(totalBatchCents) / 100).toFixed(2)}) for ${abaRecords.length} suppliers`,
        });

        return { batchRecord, createdPayments };
      });

      return reply.code(201).send({
        message: 'Batch payment successfully created and ABA file generated',
        batchPayment: serializeBatch(result.batchRecord),
        paymentsCount: result.createdPayments.length,
      });
    },
  );
};

export default batchPaymentRoutes;
