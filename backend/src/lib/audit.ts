/**
 * Immutable System Audit Log Service
 *
 * Appends audit log entries within transactions or standalone mutations.
 * Audit logs are append-only and cannot be edited or deleted via any API.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

export interface RecordAuditLogParams {
  organizationId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

export async function recordAuditLog(
  db: Prisma.TransactionClient | PrismaClient,
  params: RecordAuditLogParams,
): Promise<void> {
  let actorEmail = params.actorEmail ?? null;
  let actorName = params.actorName ?? null;

  if (params.actorUserId && (!actorEmail || !actorName)) {
    try {
      const user = await db.user.findUnique({
        where: { id: params.actorUserId },
        select: { email: true, name: true },
      });
      if (user) {
        actorEmail = actorEmail ?? user.email;
        actorName = actorName ?? user.name;
      }
    } catch {
      // Non-fatal fallback if user lookup fails
    }
  }

  const metadataJson = params.metadata
    ? JSON.stringify(params.metadata, (_key, val) =>
        typeof val === 'bigint' ? Number(val) : val,
      )
    : null;

  await db.auditLog.create({
    data: {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId ?? null,
      actorEmail,
      actorName,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      summary: params.summary,
      metadataJson,
    },
  });
}

