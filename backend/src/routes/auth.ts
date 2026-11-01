/**
 * POST /api/v1/auth/google
 *
 * Verifies a Google OIDC ID token, upserts the user, determines onboarding
 * state, and issues a signed session cookie.
 *
 * Flow:
 *  1. Verify idToken with google-auth-library.
 *  2. Upsert the user record (keyed on google_sub).
 *  3. Check organization_members for existing memberships.
 *  4. Check organization_invites for pending invitations by email.
 *  5a. Existing member → issue full session (userId + organizationId + role).
 *  5b. Pending invite → accept it, issue full session.
 *  5c. No org, no invite → issue ONBOARDING session (organizationId: null).
 */

import type { FastifyPluginAsync } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { setSession } from '../plugins/auth.js';

const RequestBody = z.object({
  idToken: z.string().min(1),
});

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const googleClient = new OAuth2Client(process.env['GOOGLE_CLIENT_ID']);

  fastify.post('/api/v1/auth/google', async (request, reply) => {
    // -----------------------------------------------------------------------
    // 1. Parse & validate body
    // -----------------------------------------------------------------------
    const parse = RequestBody.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'idToken is required' });
    }
    const { idToken } = parse.data;

    // -----------------------------------------------------------------------
    // 2. Verify Google ID token
    // -----------------------------------------------------------------------
    let googleSub: string;
    let email: string;
    let name: string;
    let avatarUrl: string | undefined;

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env['GOOGLE_CLIENT_ID'],
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        return reply.code(401).send({ error: 'Invalid Google token payload' });
      }
      googleSub = payload.sub;
      email = payload.email;
      name = payload.name ?? email;
      avatarUrl = payload.picture;
    } catch {
      return reply.code(401).send({ error: 'Google token verification failed' });
    }

    // -----------------------------------------------------------------------
    // 3. Upsert user (immutable key: google_sub)
    // -----------------------------------------------------------------------
    const user = await fastify.prisma.user.upsert({
      where: { googleSub },
      create: { googleSub, email, name, avatarUrl },
      update: { email, name, avatarUrl },
    });

    // -----------------------------------------------------------------------
    // 4. Check for existing organization membership
    // -----------------------------------------------------------------------
    const memberships = await fastify.prisma.organizationMember.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });

    if (memberships.length > 0 && memberships[0] !== undefined) {
      // User already belongs to an org — issue full session
      const membership = memberships[0];
      const secret = process.env['SESSION_SECRET']!;
      setSession(reply, {
        userId: user.id,
        organizationId: membership.organizationId,
        role: membership.role,
      }, secret);

      return reply.code(200).send({
        status: 'authenticated',
        organizationId: membership.organizationId,
        role: membership.role,
      });
    }

    // -----------------------------------------------------------------------
    // 5. Check for a pending invite by verified email
    // -----------------------------------------------------------------------
    const invite = await fastify.prisma.organizationInvite.findFirst({
      where: {
        email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (invite) {
      // Accept the invite atomically
      const [, member] = await fastify.prisma.$transaction([
        fastify.prisma.organizationInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        }),
        fastify.prisma.organizationMember.create({
          data: {
            organizationId: invite.organizationId,
            userId: user.id,
            role: invite.role,
          },
        }),
      ]);

      const secret = process.env['SESSION_SECRET']!;
      setSession(reply, {
        userId: user.id,
        organizationId: member.organizationId,
        role: member.role,
      }, secret);

      return reply.code(200).send({
        status: 'authenticated',
        organizationId: member.organizationId,
        role: member.role,
      });
    }

    // -----------------------------------------------------------------------
    // 6. No org, no invite → ONBOARDING session
    // -----------------------------------------------------------------------
    const secret = process.env['SESSION_SECRET']!;
    setSession(reply, {
      userId: user.id,
      organizationId: null,
      role: null,
    }, secret);

    return reply.code(200).send({ status: 'onboarding' });
  });

  // -----------------------------------------------------------------------
  // DELETE /api/v1/auth/logout
  // -----------------------------------------------------------------------
  fastify.delete('/api/v1/auth/logout', async (_request, reply) => {
    void reply.clearCookie('erp_session', { path: '/' });
    return reply.code(200).send({ status: 'logged_out' });
  });
};

export default authRoutes;

