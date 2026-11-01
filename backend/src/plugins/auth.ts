import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@prisma/client';

// ---------------------------------------------------------------------------
// Type declarations
// ---------------------------------------------------------------------------

export interface SessionPayload {
  userId: string;
  organizationId: string | null; // null during ONBOARDING
  role: Role | null;             // null during ONBOARDING
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Decoded session — populated by the requireAuth preHandler. */
    user: SessionPayload;
  }
}

// ---------------------------------------------------------------------------
// Session cookie name
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = 'erp_session';

// ---------------------------------------------------------------------------
// Cookie signing helpers
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from 'node:crypto';

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
  const json = JSON.stringify(payload);
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
    return JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  // No-op plugin; auth helpers are exported as functions.
  // The requireAuth preHandler is defined below and exported for route use.
});

export default authPlugin;

// ---------------------------------------------------------------------------
// Route preHandler factories
// ---------------------------------------------------------------------------

/** Ensures the request has a valid session. Populates request.user. */
export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const secret = process.env['SESSION_SECRET'];
  if (!secret) {
    void reply.code(500).send({ error: 'Server misconfiguration' });
    return;
  }

  const session = getSession(request, secret);
  if (!session) {
    void reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  request.user = session;
  done();
}

/** Ensures the request has a valid session AND a resolved organization. */
export function requireOrgAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  requireAuth(request, reply, () => {
    if (!request.user.organizationId) {
      void reply.code(403).send({ error: 'Organization required' });
      return;
    }
    done();
  });
}

/** requireOrgAuth + role check. */
export function requireRole(...roles: Role[]) {
  return (
    request: FastifyRequest,
    reply: FastifyReply,
    done: () => void,
  ): void => {
    requireOrgAuth(request, reply, () => {
      if (!request.user.role || !roles.includes(request.user.role)) {
        void reply.code(403).send({ error: 'Forbidden' });
        return;
      }
      done();
    });
  };
}

