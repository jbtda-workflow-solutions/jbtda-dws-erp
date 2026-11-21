/**
 * Connectors Hub Routes — Module 15 (Phase 1: Inbound Scoped API Keys & Vault Overview)
 *
 * Supported endpoints (all gated by `requireModule('CONNECTORS')`):
 *  - GET    /api/v1/connectors/overview      (Vault readiness, connected apps & sync logs — ADMIN, ACCOUNTANT)
 *  - GET    /api/v1/connectors/api-keys      (List tenant API keys, hash omitted — ADMIN)
 *  - POST   /api/v1/connectors/api-keys      (Create scoped Bearer API key; returns plaintext once — ADMIN)
 *  - DELETE /api/v1/connectors/api-keys/:id  (Revoke API key — ADMIN)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireModule, requireRole } from '../plugins/auth.js';
import {
  generateApiKey,
  getEncryptionKeyDiagnostics,
} from '../lib/crypto.js';
import { resolveGoogleRedirectUri } from '../lib/google-oauth.js';
import { API_KEY_SCOPES, VALID_API_KEY_SCOPES } from '../lib/modules.js';
import { recordAuditLog } from '../lib/audit.js';

const CreateApiKeyBody = z.object({
  name: z.string().trim().min(2).max(100),
  scopes: z
    .array(z.string().trim().min(1))
    .min(1, 'Select at least one permission scope'),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .nullable()
    .optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

export const connectorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireModule('CONNECTORS'));

  // -------------------------------------------------------------------------
  // GET /api/v1/connectors/overview
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/connectors/overview',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const now = new Date();

      const [activeApiKeyCount, accounts, syncLogs] = await Promise.all([
        fastify.prisma.apiKey.count({
          where: {
            organizationId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        }),
        fastify.prisma.connectorAccount.findMany({
          where: { organizationId },
          select: {
            id: true,
            provider: true,
            externalAccountEmail: true,
            scopes: true,
            status: true,
            configJson: true,
            tokenExpiresAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        fastify.prisma.connectorSyncLog.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
      ]);

      const encryptionDiag = getEncryptionKeyDiagnostics();
      const googleClientIdConfigured = Boolean(
        process.env['GOOGLE_CLIENT_ID']?.trim(),
      );
      const googleClientSecretConfigured = Boolean(
        process.env['GOOGLE_OAUTH_CLIENT_SECRET']?.trim(),
      );

      return reply.code(200).send({
        encryptionConfigured: encryptionDiag.configured,
        googleOAuthConfigured:
          googleClientIdConfigured && googleClientSecretConfigured,
        diagnostics: {
          encryptionKey: encryptionDiag,
          googleClientIdConfigured,
          googleClientSecretConfigured,
          publicBaseUrl: process.env['PUBLIC_BASE_URL']?.trim() || null,
          expectedRedirectUri: resolveGoogleRedirectUri(request),
        },
        activeApiKeyCount,
        connectedApps: accounts.map((a) => ({
          id: a.id,
          provider: a.provider,
          externalAccountEmail: a.externalAccountEmail,
          scopes: a.scopes,
          status: a.status,
          config: a.configJson ? safeJsonParse(a.configJson) : null,
          tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        recentSyncLogs: syncLogs.map((log) => ({
          id: log.id,
          connectorAccountId: log.connectorAccountId,
          service: log.service,
          action: log.action,
          status: log.status,
          summary: log.summary,
          createdAt: log.createdAt.toISOString(),
        })),
        availableScopes: API_KEY_SCOPES,
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/connectors/api-keys
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/connectors/api-keys',
    { preHandler: [requireRole(Role.ADMIN)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      const keys = await fastify.prisma.apiKey.findMany({
        where: { organizationId },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          scopes: true,
          createdByUserId: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const creatorIds = Array.from(
        new Set(keys.map((k) => k.createdByUserId).filter((v): v is string => Boolean(v))),
      );
      const creators =
        creatorIds.length > 0
          ? await fastify.prisma.user.findMany({
              where: { id: { in: creatorIds } },
              select: { id: true, name: true, email: true },
            })
          : [];
      const creatorMap = new Map(creators.map((c) => [c.id, c]));

      return reply.code(200).send({
        apiKeys: keys.map((k) => {
          const creator = k.createdByUserId
            ? creatorMap.get(k.createdByUserId) ?? null
            : null;
          return {
            id: k.id,
            name: k.name,
            keyPrefix: k.keyPrefix,
            scopes: k.scopes,
            lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
            expiresAt: k.expiresAt?.toISOString() ?? null,
            revokedAt: k.revokedAt?.toISOString() ?? null,
            createdAt: k.createdAt.toISOString(),
            createdBy: creator
              ? { id: creator.id, name: creator.name, email: creator.email }
              : null,
          };
        }),
        availableScopes: API_KEY_SCOPES,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/connectors/api-keys
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/connectors/api-keys',
    { preHandler: [requireRole(Role.ADMIN)] },
    async (request, reply) => {
      const parsed = CreateApiKeyBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;
      const { name, scopes, expiresInDays } = parsed.data;

      const uniqueScopes = Array.from(new Set(scopes));
      const invalidScopes = uniqueScopes.filter((s) => !VALID_API_KEY_SCOPES.has(s));
      if (invalidScopes.length > 0) {
        return reply.code(400).send({
          error: `Unsupported API key scope(s): ${invalidScopes.join(', ')}`,
        });
      }

      const { plaintextKey, keyPrefix, keyHash } = generateApiKey();
      const expiresAt =
        expiresInDays != null
          ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
          : null;

      const created = await fastify.prisma.$transaction(async (tx) => {
        const key = await tx.apiKey.create({
          data: {
            organizationId,
            name,
            keyPrefix,
            keyHash,
            scopes: uniqueScopes,
            createdByUserId: userId,
            expiresAt,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'API_KEY_CREATED',
          entityType: 'API_KEY',
          entityId: key.id,
          summary: `Created scoped API key "${name}" (${keyPrefix}...) with ${uniqueScopes.length} scope(s)`,
          metadata: {
            keyPrefix,
            scopes: uniqueScopes,
            expiresAt: expiresAt?.toISOString() ?? null,
          },
        });

        return key;
      });

      return reply.code(201).send({
        apiKey: {
          id: created.id,
          name: created.name,
          keyPrefix: created.keyPrefix,
          scopes: created.scopes,
          lastUsedAt: null,
          expiresAt: created.expiresAt?.toISOString() ?? null,
          revokedAt: null,
          createdAt: created.createdAt.toISOString(),
        },
        plaintextKey,
      });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/connectors/api-keys/:id — Revoke API key
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/v1/connectors/api-keys/:id',
    { preHandler: [requireRole(Role.ADMIN)] },
    async (request, reply) => {
      const parsed = ParamsWithId.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid API key ID' });
      }

      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;
      const { id } = parsed.data;

      const existing = await fastify.prisma.apiKey.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'API key not found' });
      }
      if (existing.revokedAt) {
        return reply.code(200).send({ ok: true, alreadyRevoked: true });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.apiKey.update({
          where: { id: existing.id },
          data: { revokedAt: new Date() },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'API_KEY_REVOKED',
          entityType: 'API_KEY',
          entityId: existing.id,
          summary: `Revoked API key "${existing.name}" (${existing.keyPrefix}...)`,
          metadata: { keyPrefix: existing.keyPrefix },
        });
      });

      return reply.code(200).send({ ok: true });
    },
  );
};

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
