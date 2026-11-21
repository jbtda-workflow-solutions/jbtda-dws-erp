/**
 * Google Workspace OAuth & Sync Routes — Module 16
 *
 * Supported endpoints:
 *  - GET    /api/v1/connectors/oauth/google/authorize  (Returns OAuth 2.0 offline-access URL — ADMIN)
 *  - GET    /api/v1/connectors/oauth/google/callback   (OAuth callback — verifies signed HMAC state, stores AES-256-GCM tokens)
 *  - DELETE /api/v1/connectors/oauth/google            (Disconnect & wipe encrypted tokens — ADMIN)
 *  - PATCH  /api/v1/connectors/google/config           (Save spreadsheetId, driveFolderId, calendarId — ADMIN, ACCOUNTANT)
 *  - POST   /api/v1/connectors/google/sheets/export    (Export live financial report to Google Sheets — ADMIN, ACCOUNTANT)
 *  - POST   /api/v1/connectors/google/drive/sync       (Archive financial CSV pack to Google Drive — ADMIN, ACCOUNTANT)
 *  - POST   /api/v1/connectors/google/calendar/sync    (Sync AR/AP/BAS/Recurring deadlines to Google Calendar — ADMIN, ACCOUNTANT)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireModule, requireRole } from '../plugins/auth.js';
import { encryptSecret, isEncryptionKeyConfigured } from '../lib/crypto.js';
import { isModuleEnabled } from '../lib/modules.js';
import { recordAuditLog } from '../lib/audit.js';
import {
  GOOGLE_WORKSPACE_PROVIDER,
  buildGoogleAuthorizeUrl,
  exchangeGoogleAuthCode,
  fetchGoogleAccountEmail,
  getValidGoogleAccessToken,
  parseConnectorConfig,
  resolveGoogleRedirectUri,
  signOAuthState,
  verifyOAuthState,
} from '../lib/google-oauth.js';
import {
  exportReportToGoogleSheet,
  type GoogleSheetsReportType,
} from '../lib/google-sheets.js';
import { syncArchiveToGoogleDrive } from '../lib/google-drive.js';
import { syncDeadlinesToGoogleCalendar } from '../lib/google-calendar.js';

const UpdateGoogleConfigBody = z.object({
  spreadsheetId: z.string().trim().max(200).nullable().optional(),
  driveFolderId: z.string().trim().max(200).nullable().optional(),
  calendarId: z.string().trim().max(200).nullable().optional(),
});

const ExportSheetsBody = z.object({
  spreadsheetId: z.string().trim().min(5).max(200).optional(),
  reportType: z.enum([
    'TRIAL_BALANCE',
    'PROFIT_AND_LOSS',
    'BALANCE_SHEET',
    'AGED_AR',
    'AGED_AP',
    'GENERAL_LEDGER',
  ]),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const SyncDriveBody = z
  .object({
    driveFolderId: z.string().trim().max(200).optional(),
  })
  .optional();

const SyncCalendarBody = z
  .object({
    calendarId: z.string().trim().max(200).optional(),
  })
  .optional();

export const googleConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/connectors/oauth/google/authorize — Generate OAuth URL (ADMIN)
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/connectors/oauth/google/authorize',
    { preHandler: [requireModule('CONNECTORS'), requireRole(Role.ADMIN)] },
    async (request, reply) => {
      if (!isEncryptionKeyConfigured()) {
        return reply.code(400).send({
          error:
            'ENCRYPTION_KEY is not configured on the server. Mount a 64-char hex secret before connecting Google Workspace.',
        });
      }

      try {
        const redirectUri = resolveGoogleRedirectUri(request);
        const state = signOAuthState(
          request.user.organizationId!,
          request.user.userId,
        );
        const authorizeUrl = buildGoogleAuthorizeUrl(redirectUri, state);
        return reply.code(200).send({ authorizeUrl, redirectUri });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Google OAuth configuration error';
        return reply.code(400).send({ error: message });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/connectors/oauth/google/callback — OAuth 2.0 Redirect Callback
  // Uses signed HMAC `state` so SameSite=Strict cookies never block the redirect.
  // -------------------------------------------------------------------------
  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>('/api/v1/connectors/oauth/google/callback', async (request, reply) => {
    const { code, state, error } = request.query;

    const redirectWithError = (msg: string) =>
      reply.redirect(
        `/connectors?google_error=${encodeURIComponent(msg.slice(0, 200))}`,
      );

    if (error) {
      return redirectWithError(`Google authorization declined: ${error}`);
    }
    if (!code || !state) {
      return redirectWithError('Missing OAuth authorization code or state.');
    }

    const verified = verifyOAuthState(state);
    if (!verified) {
      return redirectWithError(
        'Invalid or expired OAuth state token. Please try connecting again.',
      );
    }

    // Verify organization has CONNECTORS enabled and initiating user is ADMIN
    const membership = await fastify.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: verified.organizationId,
          userId: verified.userId,
        },
      },
      include: {
        organization: { select: { enabledModules: true } },
      },
    });

    if (
      !membership ||
      membership.role !== Role.ADMIN ||
      !isModuleEnabled(membership.organization.enabledModules, 'CONNECTORS')
    ) {
      return redirectWithError(
        'Organization ADMIN clearance and CONNECTORS module entitlement are required.',
      );
    }

    try {
      const redirectUri = resolveGoogleRedirectUri(request);
      const tokens = await exchangeGoogleAuthCode(code, redirectUri);
      const email = await fetchGoogleAccountEmail(tokens.accessToken);

      const existing = await fastify.prisma.connectorAccount.findUnique({
        where: {
          organizationId_provider: {
            organizationId: verified.organizationId,
            provider: GOOGLE_WORKSPACE_PROVIDER,
          },
        },
      });

      const encryptedAccess = encryptSecret(tokens.accessToken);
      const encryptedRefresh = tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : existing?.refreshTokenEncrypted ?? null;

      await fastify.prisma.$transaction(async (tx) => {
        const account = await tx.connectorAccount.upsert({
          where: {
            organizationId_provider: {
              organizationId: verified.organizationId,
              provider: GOOGLE_WORKSPACE_PROVIDER,
            },
          },
          create: {
            organizationId: verified.organizationId,
            provider: GOOGLE_WORKSPACE_PROVIDER,
            externalAccountEmail: email,
            scopes: tokens.scopes,
            accessTokenEncrypted: encryptedAccess,
            refreshTokenEncrypted: encryptedRefresh,
            tokenExpiresAt: tokens.expiresAt,
            status: 'CONNECTED',
            connectedByUserId: verified.userId,
          },
          update: {
            externalAccountEmail: email ?? existing?.externalAccountEmail ?? null,
            scopes: tokens.scopes.length > 0 ? tokens.scopes : existing?.scopes ?? [],
            accessTokenEncrypted: encryptedAccess,
            refreshTokenEncrypted: encryptedRefresh,
            tokenExpiresAt: tokens.expiresAt,
            status: 'CONNECTED',
            connectedByUserId: verified.userId,
          },
        });

        await recordAuditLog(tx, {
          organizationId: verified.organizationId,
          actorUserId: verified.userId,
          action: 'GOOGLE_CONNECTOR_CONNECTED',
          entityType: 'CONNECTOR_ACCOUNT',
          entityId: account.id,
          summary: `Connected Google Workspace account (${email ?? 'unknown email'})`,
          metadata: { scopes: tokens.scopes },
        });
      });

      return reply.redirect('/connectors?google=connected');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Google Workspace OAuth failed';
      return redirectWithError(msg);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/v1/connectors/oauth/google — Disconnect & wipe tokens (ADMIN)
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/v1/connectors/oauth/google',
    { preHandler: [requireModule('CONNECTORS'), requireRole(Role.ADMIN)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;

      const existing = await fastify.prisma.connectorAccount.findUnique({
        where: {
          organizationId_provider: {
            organizationId,
            provider: GOOGLE_WORKSPACE_PROVIDER,
          },
        },
      });

      if (!existing) {
        return reply.code(200).send({ ok: true, alreadyDisconnected: true });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.connectorAccount.update({
          where: { id: existing.id },
          data: {
            status: 'DISCONNECTED',
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
            tokenExpiresAt: null,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'GOOGLE_CONNECTOR_DISCONNECTED',
          entityType: 'CONNECTOR_ACCOUNT',
          entityId: existing.id,
          summary: `Disconnected Google Workspace account (${existing.externalAccountEmail ?? 'unknown'}) and purged encrypted tokens`,
        });
      });

      return reply.code(200).send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/connectors/google/config — Save Sheet/Drive/Calendar targets
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/v1/connectors/google/config',
    {
      preHandler: [
        requireModule('CONNECTORS'),
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const parsed = UpdateGoogleConfigBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const existing = await fastify.prisma.connectorAccount.findUnique({
        where: {
          organizationId_provider: {
            organizationId,
            provider: GOOGLE_WORKSPACE_PROVIDER,
          },
        },
      });

      if (!existing) {
        return reply
          .code(404)
          .send({ error: 'Google Workspace is not connected yet.' });
      }

      const currentConfig = parseConnectorConfig(existing.configJson);
      const nextConfig = {
        ...currentConfig,
        ...(parsed.data.spreadsheetId !== undefined
          ? { spreadsheetId: parsed.data.spreadsheetId || null }
          : {}),
        ...(parsed.data.driveFolderId !== undefined
          ? { driveFolderId: parsed.data.driveFolderId || null }
          : {}),
        ...(parsed.data.calendarId !== undefined
          ? { calendarId: parsed.data.calendarId || null }
          : {}),
      };

      await fastify.prisma.connectorAccount.update({
        where: { id: existing.id },
        data: { configJson: JSON.stringify(nextConfig) },
      });

      return reply.code(200).send({ ok: true, config: nextConfig });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/connectors/google/sheets/export — Export live report to Sheets
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/connectors/google/sheets/export',
    {
      preHandler: [
        requireModule('CONNECTORS'),
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const parsed = ExportSheetsBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      let tokenCtx: Awaited<ReturnType<typeof getValidGoogleAccessToken>>;
      try {
        tokenCtx = await getValidGoogleAccessToken(
          fastify.prisma,
          organizationId,
        );
      } catch (err: unknown) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Google token unavailable',
        });
      }

      const spreadsheetId =
        parsed.data.spreadsheetId ?? tokenCtx.config.spreadsheetId;
      if (!spreadsheetId) {
        return reply.code(400).send({
          error:
            'A Google Spreadsheet ID is required. Save one in Google Workspace targets or pass spreadsheetId.',
        });
      }

      try {
        const result = await exportReportToGoogleSheet(
          fastify.prisma,
          organizationId,
          {
            accessToken: tokenCtx.accessToken,
            spreadsheetId,
            reportType: parsed.data.reportType as GoogleSheetsReportType,
            startDate: parsed.data.startDate,
            endDate: parsed.data.endDate,
            asOfDate: parsed.data.asOfDate,
          },
        );

        await fastify.prisma.connectorSyncLog.create({
          data: {
            organizationId,
            connectorAccountId: tokenCtx.accountId,
            service: 'GOOGLE_SHEETS',
            action: `EXPORT_${parsed.data.reportType}`,
            status: 'SUCCESS',
            summary: `Exported ${result.rowCount} row(s) to tab "${result.sheetTitle}"`,
            metadataJson: JSON.stringify(result),
          },
        });

        return reply.code(200).send({ ok: true, ...result });
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : 'Google Sheets export failed';
        await fastify.prisma.connectorSyncLog.create({
          data: {
            organizationId,
            connectorAccountId: tokenCtx.accountId,
            service: 'GOOGLE_SHEETS',
            action: `EXPORT_${parsed.data.reportType}`,
            status: 'FAILED',
            summary: msg.slice(0, 300),
          },
        });
        return reply.code(502).send({ error: msg });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/connectors/google/drive/sync — Archive CSV pack to Drive
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/connectors/google/drive/sync',
    {
      preHandler: [
        requireModule('CONNECTORS'),
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const parsed = SyncDriveBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request body' });
      }

      const organizationId = request.user.organizationId!;
      let tokenCtx: Awaited<ReturnType<typeof getValidGoogleAccessToken>>;
      try {
        tokenCtx = await getValidGoogleAccessToken(
          fastify.prisma,
          organizationId,
        );
      } catch (err: unknown) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Google token unavailable',
        });
      }

      try {
        const result = await syncArchiveToGoogleDrive(
          fastify.prisma,
          organizationId,
          {
            accessToken: tokenCtx.accessToken,
            rootFolderId:
              parsed.data?.driveFolderId ?? tokenCtx.config.driveFolderId,
          },
        );

        // Persist auto-created archive root folder ID if none was saved yet
        if (!tokenCtx.config.driveFolderId && result.rootFolderId) {
          await fastify.prisma.connectorAccount.update({
            where: { id: tokenCtx.accountId },
            data: {
              configJson: JSON.stringify({
                ...tokenCtx.config,
                driveFolderId: result.rootFolderId,
              }),
            },
          });
        }

        await fastify.prisma.connectorSyncLog.create({
          data: {
            organizationId,
            connectorAccountId: tokenCtx.accountId,
            service: 'GOOGLE_DRIVE',
            action: 'ARCHIVE_FINANCIAL_PACK',
            status: 'SUCCESS',
            summary: `Uploaded ${result.filesUploaded} CSV archive file(s): ${result.fileNames.join(', ')}`,
            metadataJson: JSON.stringify(result),
          },
        });

        return reply.code(200).send({ ok: true, ...result });
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : 'Google Drive archive sync failed';
        await fastify.prisma.connectorSyncLog.create({
          data: {
            organizationId,
            connectorAccountId: tokenCtx.accountId,
            service: 'GOOGLE_DRIVE',
            action: 'ARCHIVE_FINANCIAL_PACK',
            status: 'FAILED',
            summary: msg.slice(0, 300),
          },
        });
        return reply.code(502).send({ error: msg });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/connectors/google/calendar/sync — Sync finance deadlines
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/connectors/google/calendar/sync',
    {
      preHandler: [
        requireModule('CONNECTORS'),
        requireRole(Role.ADMIN, Role.ACCOUNTANT),
      ],
    },
    async (request, reply) => {
      const parsed = SyncCalendarBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request body' });
      }

      const organizationId = request.user.organizationId!;
      let tokenCtx: Awaited<ReturnType<typeof getValidGoogleAccessToken>>;
      try {
        tokenCtx = await getValidGoogleAccessToken(
          fastify.prisma,
          organizationId,
        );
      } catch (err: unknown) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Google token unavailable',
        });
      }

      try {
        const result = await syncDeadlinesToGoogleCalendar(
          fastify.prisma,
          organizationId,
          {
            accessToken: tokenCtx.accessToken,
            calendarId: parsed.data?.calendarId ?? tokenCtx.config.calendarId,
          },
        );

        await fastify.prisma.connectorSyncLog.create({
          data: {
            organizationId,
            connectorAccountId: tokenCtx.accountId,
            service: 'GOOGLE_CALENDAR',
            action: 'SYNC_FINANCE_DEADLINES',
            status: 'SUCCESS',
            summary: `Synced ${result.syncedCount} deadline event(s) (${result.breakdown.invoices} AR, ${result.breakdown.bills} AP, ${result.breakdown.recurring} recurring, ${result.breakdown.bas} BAS)`,
            metadataJson: JSON.stringify(result),
          },
        });

        return reply.code(200).send({ ok: true, ...result });
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Google Calendar deadlines sync failed';
        await fastify.prisma.connectorSyncLog.create({
          data: {
            organizationId,
            connectorAccountId: tokenCtx.accountId,
            service: 'GOOGLE_CALENDAR',
            action: 'SYNC_FINANCE_DEADLINES',
            status: 'FAILED',
            summary: msg.slice(0, 300),
          },
        });
        return reply.code(502).send({ error: msg });
      }
    },
  );
};
