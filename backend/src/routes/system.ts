/**
 * System & Scheduled Execution Routes — Module 14.3
 *
 * Supported endpoints:
 *  - POST /api/v1/system/run-recurring
 *      Dual authentication:
 *        1. Machine / Cloud Scheduler: `X-Webhook-Secret` header matching WEBHOOK_SECRET env var
 *        2. Workspace Admin: `erp_session` cookie with Role.ADMIN (strictly scoped to caller's org)
 */

import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  BillStatus,
  EntryType,
  InvoiceStatus,
  JournalStatus,
  RecurrenceFrequency,
  Role,
  TaxTreatment,
} from '@prisma/client';
import { getSession } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { postJournalEntry } from '../lib/ledger-posting.js';
import { recordAuditLog } from '../lib/audit.js';
import { isModuleEnabled } from '../lib/modules.js';
import { getSystemAccountId } from '../lib/system-accounts.js';

const RunRecurringBody = z
  .object({
    asOfDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dryRun: z.boolean().optional().default(false),
    organizationId: z.string().uuid().optional(),
  })
  .optional();

function verifyWebhookSecret(provided: string | undefined): boolean {
  const expected = process.env['WEBHOOK_SECRET'];
  if (!expected || !provided) return false;
  try {
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function advanceNextRunDate(
  current: Date,
  frequency: RecurrenceFrequency,
): Date {
  const next = new Date(current);
  switch (frequency) {
    case RecurrenceFrequency.WEEKLY:
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case RecurrenceFrequency.FORTNIGHTLY:
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case RecurrenceFrequency.MONTHLY:
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case RecurrenceFrequency.QUARTERLY:
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case RecurrenceFrequency.ANNUALLY:
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next;
}

interface ScheduleExecutionResult {
  scheduleId: string;
  organizationId: string;
  scheduleType: string;
  name: string;
  status: 'EXECUTED' | 'DRY_RUN_DUE' | 'SKIPPED' | 'FAILED';
  generatedEntityId?: string;
  generatedReference?: string;
  autoPosted?: boolean;
  nextRunDate?: string;
  reason?: string;
}

export const systemRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/v1/system/run-recurring', async (request, reply) => {
    // 1. Authenticate via X-Webhook-Secret OR ADMIN session cookie
    const headerSecret = request.headers['x-webhook-secret'];
    const isCronAuth =
      typeof headerSecret === 'string' && verifyWebhookSecret(headerSecret);

    let callerUserId: string | null = null;
    let scopedOrganizationId: string | null = null;

    if (!isCronAuth) {
      const sessionSecret = process.env['SESSION_SECRET'];
      if (!sessionSecret) {
        return reply.code(500).send({ error: 'Server misconfiguration' });
      }
      const session = getSession(request, sessionSecret);
      if (!session) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!session.organizationId || session.role !== Role.ADMIN) {
        return reply
          .code(403)
          .send({ error: 'Forbidden: ADMIN role or valid X-Webhook-Secret required' });
      }
      callerUserId = session.userId;
      scopedOrganizationId = session.organizationId;
    }

    const parsed = RunRecurringBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const dryRun = parsed.data?.dryRun ?? false;
    const asOfDate = parsed.data?.asOfDate
      ? new Date(`${parsed.data.asOfDate}T23:59:59.999Z`)
      : new Date();

    const targetOrgId = isCronAuth
      ? (parsed.data?.organizationId ?? undefined)
      : scopedOrganizationId!;

    const dueSchedules = await fastify.prisma.recurringSchedule.findMany({
      where: {
        isActive: true,
        nextRunDate: { lte: asOfDate },
        ...(targetOrgId ? { organizationId: targetOrgId } : {}),
      },
      include: {
        organization: {
          select: {
            id: true,
            lockDate: true,
            enabledModules: true,
          },
        },
      },
      orderBy: { nextRunDate: 'asc' },
    });

    const results: ScheduleExecutionResult[] = [];
    const executionDate = new Date();

    for (const schedule of dueSchedules) {
      const org = schedule.organization;

      // Check module entitlement
      if (
        schedule.scheduleType === 'INVOICE' &&
        !isModuleEnabled(org.enabledModules, 'RECEIVABLES')
      ) {
        results.push({
          scheduleId: schedule.id,
          organizationId: schedule.organizationId,
          scheduleType: schedule.scheduleType,
          name: schedule.name,
          status: 'SKIPPED',
          reason: 'Module RECEIVABLES is not enabled for this organization',
        });
        continue;
      }

      if (
        schedule.scheduleType === 'BILL' &&
        !isModuleEnabled(org.enabledModules, 'PAYABLES')
      ) {
        results.push({
          scheduleId: schedule.id,
          organizationId: schedule.organizationId,
          scheduleType: schedule.scheduleType,
          name: schedule.name,
          status: 'SKIPPED',
          reason: 'Module PAYABLES is not enabled for this organization',
        });
        continue;
      }

      // Period lock date check when auto-posting
      if (schedule.autoPost && org.lockDate && executionDate <= org.lockDate) {
        results.push({
          scheduleId: schedule.id,
          organizationId: schedule.organizationId,
          scheduleType: schedule.scheduleType,
          name: schedule.name,
          status: 'SKIPPED',
          reason: `Execution date is on or before organization lockDate (${org.lockDate.toISOString().slice(0, 10)})`,
        });
        continue;
      }

      const nextRun = advanceNextRunDate(schedule.nextRunDate, schedule.frequency);

      if (dryRun) {
        results.push({
          scheduleId: schedule.id,
          organizationId: schedule.organizationId,
          scheduleType: schedule.scheduleType,
          name: schedule.name,
          status: 'DRY_RUN_DUE',
          autoPosted: schedule.autoPost,
          nextRunDate: nextRun.toISOString().slice(0, 10),
        });
        continue;
      }

      const actorId = callerUserId ?? schedule.createdByUserId ?? undefined;

      try {
        const outcome = await fastify.prisma.$transaction(async (tx) => {
          let payload: Record<string, any>;
          try {
            payload = JSON.parse(schedule.templatePayloadJson);
          } catch {
            throw new Error('Corrupt templatePayloadJson in recurring schedule');
          }

          let generatedEntityId = '';
          let generatedReference = '';

          if (schedule.scheduleType === 'MANUAL_JOURNAL') {
            const entry = await postJournalEntry(tx, {
              organizationId: schedule.organizationId,
              actorUserId: actorId,
              description: `${schedule.name}: ${payload.description || 'Recurring Journal'}`,
              referenceType: 'RECURRING_SCHEDULE',
              referenceId: schedule.id,
              postedAt: executionDate,
              status: schedule.autoPost
                ? JournalStatus.POSTED
                : JournalStatus.DRAFT,
              lines: (payload.lines || []).map((l: any) => ({
                accountId: l.accountId,
                entryType: l.entryType as EntryType,
                amountCents: BigInt(l.amountCents),
                description: l.description ?? null,
                trackingOptionId: l.trackingOptionId ?? null,
              })),
            });
            generatedEntityId = entry.id;
            generatedReference = entry.entryNumber ?? entry.id;
          } else if (schedule.scheduleType === 'INVOICE') {
            const invoiceCount = await tx.invoice.count({
              where: { organizationId: schedule.organizationId },
            });
            const invoiceNumber = `INV-${(1001 + invoiceCount).toString().padStart(4, '0')}`;
            const dueDate = new Date(
              executionDate.getTime() +
                (Number(payload.termsDays) || 30) * 24 * 60 * 60 * 1000,
            );

            const processedLines = (payload.lineItems || []).map((li: any) => {
              const rawAmount =
                li.amountCents !== undefined && Number(li.amountCents) > 0
                  ? BigInt(li.amountCents)
                  : BigInt(Math.round(Number(li.unitPriceCents || 0) * Number(li.quantity || 1)));
              const gst = calculateGST(
                rawAmount,
                (li.taxTreatment as TaxTreatment) || TaxTreatment.TAX_EXCLUSIVE,
              );
              return {
                organizationId: schedule.organizationId,
                itemId: li.itemId || null,
                accountId: li.accountId || null,
                trackingOptionId: li.trackingOptionId || null,
                description: li.description || schedule.name,
                quantity: Number(li.quantity || 1),
                unitPriceCents: BigInt(li.unitPriceCents || 0),
                amountCents: gst.subtotalCents,
                taxTreatment:
                  (li.taxTreatment as TaxTreatment) || TaxTreatment.TAX_EXCLUSIVE,
                gstCents: gst.gstCents,
                totalCents: gst.totalCents,
              };
            });

            const totals = sumGSTResults(
              processedLines.map((li: any) => ({
                subtotalCents: li.amountCents,
                gstCents: li.gstCents,
                totalCents: li.totalCents,
              })),
            );

            const created = await tx.invoice.create({
              data: {
                organizationId: schedule.organizationId,
                contactId: payload.contactId,
                invoiceNumber,
                issueDate: executionDate,
                dueDate,
                status: schedule.autoPost
                  ? InvoiceStatus.ISSUED
                  : InvoiceStatus.DRAFT,
                subtotalCents: totals.subtotalCents,
                gstCents: totals.gstCents,
                totalCents: totals.totalCents,
                notes: payload.notes
                  ? `Recurring Invoice: ${schedule.name}. ${payload.notes}`
                  : `Recurring Invoice: ${schedule.name}`,
                createdByUserId: actorId ?? null,
                lineItems: { create: processedLines },
              },
            });

            if (schedule.autoPost) {
              const [arAccountId, defaultRevId, gstCollectedId] =
                await Promise.all([
                  getSystemAccountId(tx, schedule.organizationId, 'ACCOUNTS_RECEIVABLE'),
                  getSystemAccountId(tx, schedule.organizationId, 'DEFAULT_REVENUE'),
                  getSystemAccountId(tx, schedule.organizationId, 'GST_COLLECTED'),
                ]);

              const glLines: Array<{
                accountId: string;
                entryType: EntryType;
                amountCents: bigint;
                description?: string | null;
                trackingOptionId?: string | null;
              }> = [
                {
                  accountId: arAccountId,
                  entryType: EntryType.DEBIT,
                  amountCents: totals.totalCents,
                  description: `Recurring Invoice ${invoiceNumber}`,
                },
              ];

              for (const li of processedLines) {
                if (li.amountCents > 0n) {
                  glLines.push({
                    accountId: li.accountId || defaultRevId,
                    entryType: EntryType.CREDIT,
                    amountCents: li.amountCents,
                    description: li.description,
                    trackingOptionId: li.trackingOptionId,
                  });
                }
              }

              if (totals.gstCents > 0n) {
                glLines.push({
                  accountId: gstCollectedId,
                  entryType: EntryType.CREDIT,
                  amountCents: totals.gstCents,
                  description: `GST on ${invoiceNumber}`,
                });
              }

              await postJournalEntry(tx, {
                organizationId: schedule.organizationId,
                actorUserId: actorId,
                description: `Recurring Invoice ${invoiceNumber} (${schedule.name})`,
                referenceType: 'INVOICE',
                referenceId: created.id,
                postedAt: executionDate,
                status: JournalStatus.POSTED,
                lines: glLines,
              });
            }

            generatedEntityId = created.id;
            generatedReference = invoiceNumber;
          } else if (schedule.scheduleType === 'BILL') {
            const dueDate = new Date(
              executionDate.getTime() +
                (Number(payload.termsDays) || 14) * 24 * 60 * 60 * 1000,
            );

            const processedLines = (payload.lineItems || []).map((li: any) => {
              const rawAmount = li.amountCents
                ? BigInt(li.amountCents)
                : BigInt(
                    Math.round(Number(li.quantity || 1) * Number(li.unitPriceCents || 0)),
                  );
              const gst = calculateGST(
                rawAmount,
                (li.taxTreatment as TaxTreatment) || TaxTreatment.TAX_EXCLUSIVE,
              );
              return {
                organizationId: schedule.organizationId,
                itemId: li.itemId || null,
                accountId: li.accountId || null,
                trackingOptionId: li.trackingOptionId || null,
                description: li.description || schedule.name,
                quantity: Number(li.quantity || 1),
                unitPriceCents: BigInt(li.unitPriceCents || 0),
                amountCents: gst.subtotalCents,
                taxTreatment:
                  (li.taxTreatment as TaxTreatment) || TaxTreatment.TAX_EXCLUSIVE,
                gstCents: gst.gstCents,
                totalCents: gst.totalCents,
              };
            });

            const totals = sumGSTResults(
              processedLines.map((li: any) => ({
                subtotalCents: li.amountCents,
                gstCents: li.gstCents,
                totalCents: li.totalCents,
              })),
            );

            const reference = `Recurring: ${schedule.name}`;
            const created = await tx.bill.create({
              data: {
                organizationId: schedule.organizationId,
                contactId: payload.contactId,
                reference,
                issueDate: executionDate,
                dueDate,
                status: schedule.autoPost
                  ? BillStatus.AWAITING_PAYMENT
                  : BillStatus.DRAFT,
                subtotalCents: totals.subtotalCents,
                gstCents: totals.gstCents,
                totalCents: totals.totalCents,
                amountPaidCents: 0n,
                notes: payload.notes ?? null,
                createdByUserId: actorId ?? null,
                lineItems: { create: processedLines },
              },
            });

            if (schedule.autoPost) {
              const [apAccountId, defaultExpId, gstPaidId] = await Promise.all([
                getSystemAccountId(tx, schedule.organizationId, 'ACCOUNTS_PAYABLE'),
                getSystemAccountId(tx, schedule.organizationId, 'DEFAULT_EXPENSE'),
                getSystemAccountId(tx, schedule.organizationId, 'GST_PAID'),
              ]);

              const glLines: Array<{
                accountId: string;
                entryType: EntryType;
                amountCents: bigint;
                description?: string | null;
                trackingOptionId?: string | null;
              }> = [];

              for (const li of processedLines) {
                if (li.amountCents > 0n) {
                  glLines.push({
                    accountId: li.accountId || defaultExpId,
                    entryType: EntryType.DEBIT,
                    amountCents: li.amountCents,
                    description: li.description,
                    trackingOptionId: li.trackingOptionId,
                  });
                }
              }

              if (totals.gstCents > 0n) {
                glLines.push({
                  accountId: gstPaidId,
                  entryType: EntryType.DEBIT,
                  amountCents: totals.gstCents,
                  description: `GST Paid on ${reference}`,
                });
              }

              glLines.push({
                accountId: apAccountId,
                entryType: EntryType.CREDIT,
                amountCents: totals.totalCents,
                description: reference,
              });

              await postJournalEntry(tx, {
                organizationId: schedule.organizationId,
                actorUserId: actorId,
                description: `Recurring Bill (${schedule.name})`,
                referenceType: 'BILL',
                referenceId: created.id,
                postedAt: executionDate,
                status: JournalStatus.POSTED,
                lines: glLines,
              });
            }

            generatedEntityId = created.id;
            generatedReference = reference;
          } else {
            throw new Error(`Unsupported scheduleType: ${schedule.scheduleType}`);
          }

          await tx.recurringSchedule.update({
            where: { id: schedule.id },
            data: {
              lastRunDate: executionDate,
              nextRunDate: nextRun,
            },
          });

          await recordAuditLog(tx, {
            organizationId: schedule.organizationId,
            actorUserId: actorId ?? null,
            action: 'RECURRING_SCHEDULE_EXECUTED',
            entityType: 'RECURRING_SCHEDULE',
            entityId: schedule.id,
            summary: `Executed recurring ${schedule.scheduleType} "${schedule.name}" -> ${generatedReference} (${schedule.autoPost ? 'auto-posted' : 'draft'})`,
            metadata: {
              scheduleType: schedule.scheduleType,
              generatedEntityId,
              generatedReference,
              autoPost: schedule.autoPost,
              nextRunDate: nextRun.toISOString(),
              trigger: isCronAuth ? 'SCHEDULER' : 'ADMIN_MANUAL',
            },
          });

          return { generatedEntityId, generatedReference };
        });

        results.push({
          scheduleId: schedule.id,
          organizationId: schedule.organizationId,
          scheduleType: schedule.scheduleType,
          name: schedule.name,
          status: 'EXECUTED',
          generatedEntityId: outcome.generatedEntityId,
          generatedReference: outcome.generatedReference,
          autoPosted: schedule.autoPost,
          nextRunDate: nextRun.toISOString().slice(0, 10),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Execution failed';
        results.push({
          scheduleId: schedule.id,
          organizationId: schedule.organizationId,
          scheduleType: schedule.scheduleType,
          name: schedule.name,
          status: 'FAILED',
          reason: message,
        });
      }
    }

    return reply.code(200).send({
      asOfDate: asOfDate.toISOString().slice(0, 10),
      dryRun,
      totalDue: dueSchedules.length,
      executedCount: results.filter((r) => r.status === 'EXECUTED').length,
      skippedCount: results.filter((r) => r.status === 'SKIPPED').length,
      failedCount: results.filter((r) => r.status === 'FAILED').length,
      results,
    });
  });
};
