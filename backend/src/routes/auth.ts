/**
 * Authentication & Session Switching Routes — Module 1
 *
 * Endpoints:
 *  - GET    /api/v1/auth/config               (Public Google OAuth Client ID)
 *  - POST   /api/v1/auth/google               (Google OIDC verification, auto-invite claim, session issue)
 *  - GET    /api/v1/auth/me                   (Restore session, active org, and multi-company memberships)
 *  - POST   /api/v1/auth/switch-organization  (Switch active organization context in session cookie)
 *  - DELETE /api/v1/auth/logout               (Clear session cookie)
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Prisma, User } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { getSession, requireAuth, setSession, SESSION_COOKIE_NAME } from '../plugins/auth.js';
import { recordAuditLog } from '../lib/audit.js';

type MemberWithOrg = Prisma.OrganizationMemberGetPayload<{
  include: {
    organization: {
      select: {
        id: true;
        name: true;
        legalName: true;
        abn: true;
        lockDate: true;
        enabledModules: true;
        enforceTwoPersonApproval: true;
      };
    };
  };
}>;

const GoogleLoginBody = z.object({
  idToken: z.string().min(1),
});

const SwitchOrgBody = z.object({
  organizationId: z.string().uuid(),
});

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const googleClient = new OAuth2Client(process.env['GOOGLE_CLIENT_ID']);

  // -------------------------------------------------------------------------
  // GET /api/v1/auth/config — Public auth configuration for SPA
  // -------------------------------------------------------------------------
  fastify.get('/api/v1/auth/config', async () => ({
    googleClientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
  }));

  // -------------------------------------------------------------------------
  // POST /api/v1/auth/google — Verify Google ID token & resolve memberships
  // -------------------------------------------------------------------------
  fastify.post('/api/v1/auth/google', async (request, reply) => {
    const parse = GoogleLoginBody.safeParse(request.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'idToken is required' });
    }
    const { idToken } = parse.data;

    const googleClientId = process.env['GOOGLE_CLIENT_ID'];
    if (!googleClientId) {
      return reply
        .code(500)
        .send({ error: 'Server misconfiguration: GOOGLE_CLIENT_ID missing' });
    }

    let googleSub: string;
    let email: string;
    let name: string;
    let avatarUrl: string | null = null;

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: googleClientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        return reply.code(401).send({ error: 'Invalid Google token payload' });
      }
      googleSub = payload.sub;
      email = payload.email.toLowerCase().trim();
      name = payload.name ?? email;
      avatarUrl = payload.picture ?? null;
    } catch {
      return reply.code(401).send({ error: 'Google token verification failed' });
    }

    let user: User;
    let memberships: MemberWithOrg[];
    try {
      user = await fastify.prisma.user.upsert({
        where: { googleSub },
        create: { googleSub, email, name, avatarUrl },
        update: { email, name, avatarUrl },
      });

      // Automatically claim any pending, non-expired invitations for this email
      const pendingInvites = await fastify.prisma.organizationInvite.findMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (pendingInvites.length > 0) {
        for (const invite of pendingInvites) {
          await fastify.prisma.$transaction(async (tx) => {
            await tx.organizationInvite.update({
              where: { id: invite.id },
              data: { acceptedAt: new Date() },
            });

            const existingMember = await tx.organizationMember.findUnique({
              where: {
                organizationId_userId: {
                  organizationId: invite.organizationId,
                  userId: user.id,
                },
              },
            });

            if (!existingMember) {
              await tx.organizationMember.create({
                data: {
                  organizationId: invite.organizationId,
                  userId: user.id,
                  role: invite.role,
                  department: invite.department,
                  jobTitle: invite.jobTitle,
                },
              });

              await recordAuditLog(tx, {
                organizationId: invite.organizationId,
                actorUserId: user.id,
                actorEmail: user.email,
                actorName: user.name,
                action: 'INVITE_ACCEPTED',
                entityType: 'ORGANIZATION_INVITE',
                entityId: invite.id,
                summary: `${user.name} (${user.email}) accepted invitation as ${invite.role}`,
                metadata: { role: invite.role },
              });
            }
          });
        }
      }

      memberships = await fastify.prisma.organizationMember.findMany({
        where: { userId: user.id },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              legalName: true,
              abn: true,
              lockDate: true,
              enabledModules: true,
              enforceTwoPersonApproval: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    } catch (err: unknown) {
      fastify.log.error({ err }, 'Database error during Google auth flow');
      const msg = err instanceof Error ? err.message : 'Database error';
      return reply.code(503).send({
        error: `Database unavailable: ${msg}. Please ensure Cloud SQL is connected and database tables are initialized.`,
      });
    }

    const secret = process.env['SESSION_SECRET']!;

    if (memberships.length > 0 && memberships[0] !== undefined) {
      const primary = memberships[0];
      setSession(
        reply,
        {
          userId: user.id,
          organizationId: primary.organizationId,
          role: primary.role,
        },
        secret,
      );

      return reply.code(200).send({
        status: 'authenticated',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
        organization: primary.organization,
        organizationId: primary.organizationId,
        role: primary.role,
        memberships: memberships.map((m) => ({
          id: m.id,
          organizationId: m.organizationId,
          role: m.role,
          jobTitle: m.jobTitle,
          department: m.department,
          organization: m.organization,
        })),
      });
    }

    // No organization memberships and no pending invites -> ONBOARDING
    setSession(
      reply,
      {
        userId: user.id,
        organizationId: null,
        role: null,
      },
      secret,
    );

    return reply.code(200).send({
      status: 'onboarding',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/auth/me — Restore active session & all company memberships
  // -------------------------------------------------------------------------
  fastify.get('/api/v1/auth/me', async (request, reply) => {
    const secret = process.env['SESSION_SECRET'];
    if (!secret) {
      return reply.code(500).send({ error: 'Server misconfiguration' });
    }

    const session = getSession(request, secret);
    if (!session) {
      return reply.code(401).send({ error: 'Unauthenticated' });
    }

    try {
      const user = await fastify.prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, name: true, avatarUrl: true },
      });

      if (!user) {
        void reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
        return reply.code(401).send({ error: 'User not found or database was reset. Please sign in again.' });
      }

      const memberships = await fastify.prisma.organizationMember.findMany({
        where: { userId: user.id },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              legalName: true,
              tradingName: true,
              abn: true,
              email: true,
              phone: true,
              addressLine1: true,
              addressLine2: true,
              city: true,
              state: true,
              postcode: true,
              bankBsb: true,
              bankAccountNumber: true,
              bankAccountName: true,
              apcaUserId: true,
              defaultPaymentTermsDays: true,
              fiscalYearStartMonth: true,
              lockDate: true,
              enforceTwoPersonApproval: true,
              enabledModules: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (memberships.length === 0) {
        // Clear any stale organizationId from prior database sessions
        if (session.organizationId !== null || session.role !== null) {
          setSession(
            reply,
            {
              userId: user.id,
              organizationId: null,
              role: null,
            },
            secret,
          );
        }
        return reply.code(200).send({
          status: 'onboarding',
          user,
          memberships: [],
        });
      }

      // Resolve active membership (fallback to first membership if session org was removed or null)
      const activeMembership =
        memberships.find((m) => m.organizationId === session.organizationId) ??
        memberships[0]!;

      // Keep cookie synchronized if fallback occurred or role changed
      if (
        session.organizationId !== activeMembership.organizationId ||
        session.role !== activeMembership.role
      ) {
        setSession(
          reply,
          {
            userId: user.id,
            organizationId: activeMembership.organizationId,
            role: activeMembership.role,
          },
          secret,
        );
      }

      return reply.code(200).send({
        status: 'authenticated',
        user,
        organization: activeMembership.organization,
        organizationId: activeMembership.organizationId,
        role: activeMembership.role,
        memberProfile: {
          id: activeMembership.id,
          role: activeMembership.role,
          jobTitle: activeMembership.jobTitle,
          department: activeMembership.department,
          bankBsb: activeMembership.bankBsb,
          bankAccountNumber: activeMembership.bankAccountNumber,
          bankAccountName: activeMembership.bankAccountName,
        },
        memberships: memberships.map((m) => ({
          id: m.id,
          organizationId: m.organizationId,
          role: m.role,
          jobTitle: m.jobTitle,
          department: m.department,
          organization: m.organization,
        })),
      });
    } catch (err: unknown) {
      fastify.log.error({ err }, 'Database error during auth/me lookup');
      const msg = err instanceof Error ? err.message : 'Database error';
      return reply.code(503).send({
        error: `Database unavailable: ${msg}.`,
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/auth/switch-organization — Toggle active company context
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/auth/switch-organization',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parse = SwitchOrgBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: 'Valid organizationId is required' });
      }

      const { organizationId } = parse.data;
      const userId = request.user.userId;

      const membership = await fastify.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
        include: {
          organization: true,
        },
      });

      if (!membership) {
        return reply.code(403).send({
          error: 'You are not a member of the requested organization.',
        });
      }

      const secret = process.env['SESSION_SECRET']!;
      setSession(
        reply,
        {
          userId,
          organizationId: membership.organizationId,
          role: membership.role,
        },
        secret,
      );

      await recordAuditLog(fastify.prisma, {
        organizationId: membership.organizationId,
        actorUserId: userId,
        action: 'WORKSPACE_SWITCHED',
        entityType: 'ORGANIZATION',
        entityId: membership.organizationId,
        summary: `Switched active workspace to ${membership.organization.name} (${membership.role})`,
      });

      return reply.code(200).send({
        status: 'authenticated',
        organization: membership.organization,
        organizationId: membership.organizationId,
        role: membership.role,
      });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/auth/logout
  // -------------------------------------------------------------------------
  fastify.delete('/api/v1/auth/logout', async (_request, reply) => {
    void reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(200).send({ status: 'logged_out' });
  });
};

export default authRoutes;
