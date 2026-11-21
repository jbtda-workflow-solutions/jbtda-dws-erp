/**
 * Google Workspace OAuth 2.0 Helper & Token Vault — Module 16.1
 *
 * Uses a dedicated offline-access OAuth 2.0 flow separate from user OIDC login.
 * Access & refresh tokens are encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`)
 * inside `connector_accounts`.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { decryptSecret, encryptSecret } from './crypto.js';

export const GOOGLE_WORKSPACE_PROVIDER = 'GOOGLE_WORKSPACE';

export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

export interface GoogleWorkspaceConfig {
  spreadsheetId?: string | null;
  driveFolderId?: string | null;
  calendarId?: string | null;
}

export interface GoogleOAuthStatePayload {
  organizationId: string;
  userId: string;
  nonce: string;
  exp: number;
}

function getSessionSecret(): string {
  const secret = process.env['SESSION_SECRET'];
  if (!secret) {
    throw new Error('SESSION_SECRET is required to sign OAuth state tokens.');
  }
  return secret;
}

export function getGoogleOAuthCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env['GOOGLE_CLIENT_ID']?.trim();
  const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET']?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google Workspace OAuth requires both GOOGLE_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to be configured.',
    );
  }
  return { clientId, clientSecret };
}

export function resolveGoogleRedirectUri(request: FastifyRequest): string {
  const configuredBase = process.env['PUBLIC_BASE_URL']?.trim();
  if (configuredBase) {
    return `${configuredBase.replace(/\/+$/, '')}/api/v1/connectors/oauth/google/callback`;
  }
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto =
    typeof forwardedProto === 'string' && forwardedProto.length > 0
      ? forwardedProto.split(',')[0]!.trim()
      : request.protocol;
  const host = request.headers['host'] ?? 'localhost:8080';
  return `${proto}://${host}/api/v1/connectors/oauth/google/callback`;
}

export function signOAuthState(
  organizationId: string,
  userId: string,
): string {
  const payload: GoogleOAuthStatePayload = {
    organizationId,
    userId,
    nonce: randomBytes(12).toString('hex'),
    exp: Date.now() + 10 * 60 * 1000, // 10 minutes
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const sig = createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(state: string): GoogleOAuthStatePayload | null {
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const encoded = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expectedSig = createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  try {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as GoogleOAuthStatePayload;
    if (!payload.organizationId || !payload.userId || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildGoogleAuthorizeUrl(
  redirectUri: string,
  state: string,
): string {
  const { clientId } = getGoogleOAuthCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_WORKSPACE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleAuthCode(
  code: string,
  redirectUri: string,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}> {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!resp.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || 'Google OAuth token exchange failed',
    );
  }

  const expiresInSec = Number(data.expires_in ?? 3600);
  const expiresAt = new Date(Date.now() + expiresInSec * 1000);
  const scopes = data.scope ? data.scope.split(/\s+/).filter(Boolean) : [];

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
    scopes,
  };
}

export async function fetchGoogleAccountEmail(
  accessToken: string,
): Promise<string | null> {
  const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return null;
  const info = (await resp.json()) as { email?: string };
  return info.email ?? null;
}

export function parseConnectorConfig(
  raw: string | null | undefined,
): GoogleWorkspaceConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as GoogleWorkspaceConfig;
  } catch {
    return {};
  }
}

/**
 * Returns a valid, non-expired Google Workspace OAuth access token for the given
 * organization, automatically refreshing via the encrypted refresh token when needed.
 */
export async function getValidGoogleAccessToken(
  prisma: PrismaClient,
  organizationId: string,
): Promise<{
  accountId: string;
  accessToken: string;
  config: GoogleWorkspaceConfig;
}> {
  const account = await prisma.connectorAccount.findUnique({
    where: {
      organizationId_provider: {
        organizationId,
        provider: GOOGLE_WORKSPACE_PROVIDER,
      },
    },
  });

  if (!account || account.status !== 'CONNECTED') {
    throw new Error(
      'Google Workspace is not connected for this organization. Connect it in Connectors Hub first.',
    );
  }

  const config = parseConnectorConfig(account.configJson);
  const twoMinutesFromNow = new Date(Date.now() + 2 * 60 * 1000);

  if (
    account.accessTokenEncrypted &&
    account.tokenExpiresAt &&
    account.tokenExpiresAt > twoMinutesFromNow
  ) {
    return {
      accountId: account.id,
      accessToken: decryptSecret(account.accessTokenEncrypted),
      config,
    };
  }

  if (!account.refreshTokenEncrypted) {
    throw new Error(
      'Google Workspace refresh token is missing. Please disconnect and reconnect Google Workspace.',
    );
  }

  const refreshToken = decryptSecret(account.refreshTokenEncrypted);
  const { clientId, clientSecret } = getGoogleOAuthCredentials();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!resp.ok || !data.access_token) {
    await prisma.connectorAccount.update({
      where: { id: account.id },
      data: { status: 'ERROR' },
    });
    throw new Error(
      `Failed to refresh Google Workspace token: ${data.error_description || data.error || resp.statusText}`,
    );
  }

  const newExpiresAt = new Date(
    Date.now() + Number(data.expires_in ?? 3600) * 1000,
  );

  await prisma.connectorAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptSecret(data.access_token),
      tokenExpiresAt: newExpiresAt,
      status: 'CONNECTED',
    },
  });

  return {
    accountId: account.id,
    accessToken: data.access_token,
    config,
  };
}
