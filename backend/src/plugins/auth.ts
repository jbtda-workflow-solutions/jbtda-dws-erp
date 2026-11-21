import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Role } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isModuleEnabled, type ProductModuleKey } from '../lib/modules.js';
import { hashApiKey } from '../lib/crypto.js';

// ---------------------------------------------------------------------------
// Type declarations
// ---------------------------------------------------------------------------

export interface SessionPayload {
  userId: string;
  organizationId: string | null; // null during ONBOARDING
  role: Role | null;             // null during ONBOARDING
  authMethod?: 'COOKIE' | 'API_KEY';
  apiKeyId?: string;
  apiKeyScopes?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Decoded session or Bearer API key context — populated by requireAuth/requireOrgAuth. */
    user: SessionPayload;
    /** Cached raw enabledModules for the active organization during this request. */
    organizationEnabledModules?: string[];
  }
}

// ---------------------------------------------------------------------------
// Session cookie name
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = 'erp_session';

// ---------------------------------------------------------------------------
// Cookie signing helpers
// ---------------------------------------------------------------------------

function sign(payload: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function unsign(signed: string, secret: string): string | null {
  const lastDot = signed.lastIndexOf('.');
  if (lastDot === -1) return null;
  const payload = signed.slice(0, lastDot);
  const expected = sign(payload, secret);
  try {
    const a = Buffer.from(signed);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session utilities (exported for use in route handlers)
// ---------------------------------------------------------------------------

export function setSession(
  reply: FastifyReply,
  payload: SessionPayload,
  secret: string,
): void {
  const json = JSON.stringify({
    userId: payload.userId,
    organizationId: payload.organizationId,
    role: payload.role,
  });
  const encoded = Buffer.from(json).toString('base64url');
  const signed = sign(encoded, secret);
  void reply.setCookie(SESSION_COOKIE_NAME, signed, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export function getSession(
  request: FastifyRequest,
  secret: string,
): SessionPayload | null {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const encoded = unsign(raw, secret);
  if (!encoded) return null;
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as SessionPayload;
    return { ...parsed, authMethod: 'COOKIE' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inbound Bearer API Key Scope Resolution (Module 15.2)
// ---------------------------------------------------------------------------

function resolveRequiredScopeForRequest(
  method: string,
  url: string,
): string | 'FORBIDDEN_FOR_API_KEY' {
  const pathOnly = url.split('?')[0] ?? url;
  const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const access = isRead ? 'read' : 'write';

  // Machine API keys are strictly barred from governance, auth, connector management,
  // developer console, and bulk import endpoints to prevent privilege escalation.
  if (
    pathOnly.startsWith('/api/v1/auth') ||
    pathOnly.startsWith('/api/v1/organizations') ||
    pathOnly.startsWith('/api/v1/users') ||
    pathOnly.startsWith('/api/v1/audit-logs') ||
    pathOnly.startsWith('/api/v1/connectors') ||
    pathOnly.startsWith('/api/v1/developer') ||
    pathOnly.startsWith('/api/v1/bulk-import') ||
    pathOnly.startsWith('/api/v1/system')
  ) {
    return 'FORBIDDEN_FOR_API_KEY';
  }

  if (pathOnly.startsWith('/api/v1/contacts')) return `contacts:${access}`;
  if (pathOnly.startsWith('/api/v1/items')) return `items:${access}`;
  if (
    pathOnly.startsWith('/api/v1/accounts') ||
    pathOnly.startsWith('/api/v1/tracking-categories')
  ) {
    return `accounts:${access}`;
  }
  if (pathOnly.startsWith('/api/v1/ledger')) return `ledger:${access}`;
  if (pathOnly.startsWith('/api/v1/banking')) return `banking:${access}`;
  if (
    pathOnly.startsWith('/api/v1/reports') ||
    pathOnly.startsWith('/api/v1/dashboard')
  ) {
    return isRead ? 'reports:read' : 'FORBIDDEN_FOR_API_KEY';
  }
  if (
    pathOnly.startsWith('/api/v1/invoices') ||
    pathOnly.startsWith('/api/v1/quotes') ||
    pathOnly.startsWith('/api/v1/credit-notes') ||
    pathOnly.startsWith('/api/v1/payments-in')
  ) {
    return `receivables:${access}`;
  }
  if (
    pathOnly.startsWith('/api/v1/bills') ||
    pathOnly.startsWith('/api/v1/purchase-orders') ||
    pathOnly.startsWith('/api/v1/vendor-credits') ||
    pathOnly.startsWith('/api/v1/batch-payments') ||
    pathOnly.startsWith('/api/v1/payments-out') ||
    pathOnly.startsWith('/api/v1/recurring-bills')
  ) {
    return `payables:${access}`;
  }
  if (
    pathOnly.startsWith('/api/v1/direct-transactions') ||
    pathOnly.startsWith('/api/v1/expense-claims')
  ) {
    return `expenses:${access}`;
  }

  return 'FORBIDDEN_FOR_API_KEY';
}

function hasApiKeyScope(scopes: string[], requiredScope: string): boolean {
  if (scopes.includes(requiredScope)) return true;
  // A `:write` scope implicitly grants `:read` for the same domain
  if (requiredScope.endsWith(':read')) {
    const writeEquivalent = requiredScope.replace(/:read$/, ':write');
    if (scopes.includes(writeEquivalent)) return true;
  }
  return false;
}

/**
 * Resolves authentication from either:
 *  1. `Authorization: Bearer dws_live_...` (Tenant-scoped API Key — Module 15.2)
 *  2. `erp_session` HttpOnly Cookie (Human Google OIDC session)
 *
 * Returns true if request.user was populated; otherwise sends an HTTP error and returns false.
 */
async function resolveRequestAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (request.user) return true;

  const authHeader = request.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice('Bearer '.length).trim();
    if (!rawToken.startsWith('dws_live_')) {
      void reply.code(401).send({ error: 'Invalid API key format' });
      return false;
    }

    const requiredScope = resolveRequiredScopeForRequest(
      request.method,
      request.url,
    );
    if (requiredScope === 'FORBIDDEN_FOR_API_KEY') {
      void reply.code(403).send({
        error: 'API keys are not permitted to access this administrative endpoint.',
        code: 'API_KEY_ENDPOINT_FORBIDDEN',
      });
      return false;
    }

    const keyHash = hashApiKey(rawToken);
    const apiKey = await request.server.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        organization: {
          select: { enabledModules: true },
        },
      },
    });

    if (!apiKey || apiKey.revokedAt !== null) {
      void reply.code(401).send({ error: 'Invalid or revoked API key' });
      return false;
    }

    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
      void reply.code(401).send({ error: 'API key has expired' });
      return false;
    }

    if (!isModuleEnabled(apiKey.organization.enabledModules, 'CONNECTORS')) {
      void reply.code(403).send({
        error: "Module 'CONNECTORS' is not enabled for this organization.",
        code: 'MODULE_NOT_ENABLED',
        module: 'CONNECTORS',
      });
      return false;
    }

    if (!hasApiKeyScope(apiKey.scopes, requiredScope)) {
      void reply.code(403).send({
        error: `API key is missing required scope '${requiredScope}'.`,
        code: 'API_KEY_INSUFFICIENT_SCOPE',
        requiredScope,
      });
      return false;
    }

    request.organizationEnabledModules = apiKey.organization.enabledModules;
    request.user = {
      userId: apiKey.createdByUserId ?? apiKey.id,
      organizationId: apiKey.organizationId,
      // Machine keys operate at ACCOUNTANT ceiling (never ADMIN) so destructive
      // admin-only actions remain strictly human-gated.
      role: Role.ACCOUNTANT,
      authMethod: 'API_KEY',
      apiKeyId: apiKey.id,
      apiKeyScopes: apiKey.scopes,
    };

    // Update lastUsedAt asynchronously without blocking the API response
    void request.server.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Non-fatal telemetry update
      });

    return true;
  }

  // Fallback: HttpOnly session cookie
  const secret = process.env['SESSION_SECRET'];
  if (!secret) {
    void reply.code(500).send({ error: 'Server misconfiguration' });
    return false;
  }

  const session = getSession(request, secret);
  if (!session) {
    void reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }

  request.user = session;
  return true;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const authPlugin: FastifyPluginAsync = fp(async () => {
  // No-op plugin; auth helpers are exported as functions.
});

export default authPlugin;

// ---------------------------------------------------------------------------
// Route preHandler factories
// ---------------------------------------------------------------------------

/** Ensures the request has a valid session or Bearer API key. Populates request.user. */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await resolveRequestAuth(request, reply);
}

/** Ensures the request has a valid session/API key AND a resolved organization. */
export async function requireOrgAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ok = await resolveRequestAuth(request, reply);
  if (!ok) return;
  if (!request.user.organizationId) {
    return reply.code(403).send({ error: 'Organization required' });
  }
}

/** requireOrgAuth + role check. */
export function requireRole(...roles: Role[]) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const ok = await resolveRequestAuth(request, reply);
    if (!ok) return;
    if (!request.user.organizationId) {
      return reply.code(403).send({ error: 'Organization required' });
    }
    if (!request.user.role || !roles.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  };
}

/**
 * Product Module entitlement preHandler guard (Module 14 & 15).
 * Can be attached at the plugin level (`fastify.addHook('preHandler', requireModule('RECEIVABLES'))`)
 * or per route. Resolves auth if not already populated and verifies that the active
 * organization has `moduleKey` enabled (with legacy flag normalization).
 */
export function requireModule(moduleKey: ProductModuleKey) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const ok = await resolveRequestAuth(request, reply);
    if (!ok) return;

    const organizationId = request.user.organizationId;
    if (!organizationId) {
      return reply.code(403).send({ error: 'Organization required' });
    }

    let enabledModules = request.organizationEnabledModules;
    if (!enabledModules) {
      const org = await request.server.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { enabledModules: true },
      });
      if (!org) {
        return reply.code(404).send({ error: 'Organization not found' });
      }
      enabledModules = org.enabledModules;
      request.organizationEnabledModules = enabledModules;
    }

    if (!isModuleEnabled(enabledModules, moduleKey)) {
      return reply.code(403).send({
        error: `Module '${moduleKey}' is not enabled for this organization.`,
        code: 'MODULE_NOT_ENABLED',
        module: moduleKey,
      });
    }
  };
}
