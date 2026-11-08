/**
 * Organization, Multi-Entity Workspace, Team RBAC & Audit Log Routes — Module 1
 *
 * Supported endpoints:
 *  - POST   /api/v1/organizations                  (Create organization, seed 10 protected accounts & dimensions)
 *  - GET    /api/v1/users/organizations            (List all organizations the authenticated user belongs to)
 *  - GET    /api/v1/organizations/profile          (Get active organization profile, banking & governance settings)
 *  - PATCH  /api/v1/organizations/profile          (Update company profile, BSB/Account, lockDate, modules — ADMIN)
 *  - PATCH  /api/v1/organizations/my-profile       (Update caller's employee reimbursement banking & job profile)
 *  - GET    /api/v1/organizations/members          (List active organization members & roles)
 *  - PATCH  /api/v1/organizations/members/:id      (Update member role, department, or banking — ADMIN)
 *  - DELETE /api/v1/organizations/members/:id      (Remove member from organization — ADMIN)
 *  - GET    /api/v1/organizations/invites          (List pending email invitations)
 *  - POST   /api/v1/organizations/invites          (Invite user by email with 7-tier Role — ADMIN)
 *  - DELETE /api/v1/organizations/invites/:id      (Revoke pending invitation — ADMIN)
 *  - GET    /api/v1/audit-logs                     (List immutable system audit logs — ADMIN, ACCOUNTANT, AUDITOR)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  requireAuth,
  requireOrgAuth,
  requireRole,
  setSession,
} from '../plugins/auth.js';
import { validateABN } from '../lib/abn.js';
import { ensureOrganizationSystemAccounts } from '../lib/system-accounts.js';
import { recordAuditLog } from '../lib/audit.js';
import { Role } from '@prisma/client';

const RoleEnum = z.nativeEnum(Role);

const CreateOrgBody = z.object({
  name: z.string().trim().min(2).max(100),
  legalName: z.string().trim().max(150).nullable().optional(),
  tradingName: z.string().trim().max(150).nullable().optional(),
  abn: z.string().trim(),
  email: z.string().trim().email().nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(40).nullable().optional(),
  addressLine1: z.string().trim().max(150).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(40).nullable().optional(),
  postcode: z.string().trim().max(20).nullable().optional(),
  bankBsb: z.string().trim().max(20).nullable().optional(),
  bankAccountNumber: z.string().trim().max(30).nullable().optional(),
  bankAccountName: z.string().trim().max(100).nullable().optional(),
});

const UpdateOrgProfileBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  legalName: z.string().trim().max(150).nullable().optional(),
  tradingName: z.string().trim().max(150).nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(40).nullable().optional(),
  addressLine1: z.string().trim().max(150).nullable().optional(),
  addressLine2: z.string().trim().max(150).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(40).nullable().optional(),
  postcode: z.string().trim().max(20).nullable().optional(),
  bankBsb: z.string().trim().max(20).nullable().optional(),
  bankAccountNumber: z.string().trim().max(30).nullable().optional(),
  bankAccountName: z.string().trim().max(100).nullable().optional(),
  apcaUserId: z.string().trim().max(20).nullable().optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  lockDate: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .nullable()
    .optional(),
  enforceTwoPersonApproval: z.boolean().optional(),
  enabledModules: z.array(z.string().trim().min(1)).optional(),
});

const UpdateMyMemberProfileBody = z.object({
  jobTitle: z.string().trim().max(100).nullable().optional(),
  department: z.string().trim().max(100).nullable().optional(),
  bankBsb: z.string().trim().max(20).nullable().optional(),
  bankAccountNumber: z.string().trim().max(30).nullable().optional(),
  bankAccountName: z.string().trim().max(100).nullable().optional(),
});

const UpdateMemberBody = z.object({
  role: RoleEnum.optional(),
  jobTitle: z.string().trim().max(100).nullable().optional(),
  department: z.string().trim().max(100).nullable().optional(),
  bankBsb: z.string().trim().max(20).nullable().optional(),
  bankAccountNumber: z.string().trim().max(30).nullable().optional(),
  bankAccountName: z.string().trim().max(100).nullable().optional(),
});

const CreateInviteBody = z.object({
  email: z.string().trim().email(),
  role: RoleEnum,
  department: z.string().trim().max(100).nullable().optional(),
  jobTitle: z.string().trim().max(100).nullable().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

const ListAuditLogsQuery = z.object({
  entityType: z.string().trim().optional(),
  action: z.string().trim().optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function normalizeBsb(bsb?: string | null): string | null {
  if (!bsb || bsb.trim().length === 0) return null;
  const digits = bsb.replace(/[^0-9]/g, '');
  if (digits.length === 6) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return bsb.trim();
}

const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // POST /api/v1/organizations — Create organization (Onboarding or + New Company)
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/organizations',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parse = CreateOrgBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const {
        name,
        legalName,
        tradingName,
        abn,
        email,
        phone,
        addressLine1,
        city,
        state,
        postcode,
        bankBsb,
        bankAccountNumber,
        bankAccountName,
      } = parse.data;
      const cleanAbn = abn.replace(/\s/g, '');

      if (!validateABN(cleanAbn)) {
        return reply.code(400).send({
          error: 'Invalid Australian Business Number (ABN)',
        });
      }

      const existing = await fastify.prisma.organization.findUnique({
        where: { abn: cleanAbn },
      });
      if (existing) {
        return reply.code(409).send({
          error: 'An organization with this ABN already exists',
        });
      }

      const userId = request.user.userId;

      const [organization, member] = await fastify.prisma.$transaction(
        async (tx) => {
          const org = await tx.organization.create({
            data: {
              name,
              legalName: legalName ?? name,
              tradingName: tradingName ?? null,
              abn: cleanAbn,
              email: email && email.length > 0 ? email : null,
              phone: phone ?? null,
              addressLine1: addressLine1 ?? null,
              city: city ?? null,
              state: state ?? null,
              postcode: postcode ?? null,
              bankBsb: normalizeBsb(bankBsb),
              bankAccountNumber: bankAccountNumber?.trim() || null,
              bankAccountName: bankAccountName?.trim() || name,
              enabledModules: ['CORE_FINANCE', 'EXPENSES'],
            },
          });

          const mem = await tx.organizationMember.create({
            data: {
              organizationId: org.id,
              userId,
              role: Role.ADMIN,
              jobTitle: 'Organization Administrator',
            },
          });

          // Seed the 10 Protected System Accounts
          await ensureOrganizationSystemAccounts(tx, org.id);

          // Seed default "Department" Tracking Category & Options for dimensional accounting
          const deptCategory = await tx.trackingCategory.create({
            data: {
              organizationId: org.id,
              name: 'Department',
              description: 'Business unit or operational cost center',
              isActive: true,
            },
          });

          await tx.trackingOption.createMany({
            data: [
              {
                organizationId: org.id,
                trackingCategoryId: deptCategory.id,
                name: 'Operations',
                code: 'OPS',
              },
              {
                organizationId: org.id,
                trackingCategoryId: deptCategory.id,
                name: 'Sales & Commercial',
                code: 'SLS',
              },
              {
                organizationId: org.id,
                trackingCategoryId: deptCategory.id,
                name: 'Corporate & Admin',
                code: 'ADM',
              },
            ],
          });

          await recordAuditLog(tx, {
            organizationId: org.id,
            actorUserId: userId,
            action: 'ORGANIZATION_CREATED',
            entityType: 'ORGANIZATION',
            entityId: org.id,
            summary: `Created organization "${org.name}" (ABN ${cleanAbn}) and seeded 10 protected system accounts`,
          });

          return [org, mem];
        },
      );

      // Update session cookie to active organization
      const secret = process.env['SESSION_SECRET']!;
      setSession(
        reply,
        {
          userId,
          organizationId: organization.id,
          role: member.role,
        },
        secret,
      );

      return reply.code(201).send({
        organization,
        role: member.role,
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/users/organizations — List all companies for current user
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/users/organizations',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const memberships = await fastify.prisma.organizationMember.findMany({
        where: { userId: request.user.userId },
        include: {
          organization: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      return reply.code(200).send({
        organizations: memberships.map((m) => ({
          membershipId: m.id,
          organizationId: m.organizationId,
          role: m.role,
          jobTitle: m.jobTitle,
          department: m.department,
          organization: m.organization,
          isActiveSession: m.organizationId === request.user.organizationId,
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/organizations/profile — Get active company profile & governance
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/organizations/profile',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;

      const [organization, myMembership] = await Promise.all([
        fastify.prisma.organization.findUnique({
          where: { id: organizationId },
        }),
        fastify.prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId,
              userId,
            },
          },
        }),
      ]);

      if (!organization) {
        return reply.code(404).send({ error: 'Organization not found' });
      }

      return reply.code(200).send({
        organization,
        memberProfile: myMembership,
      });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/organizations/profile — Update company profile & controls (ADMIN)
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/v1/organizations/profile',
    { preHandler: [requireRole(Role.ADMIN)] },
    async (request, reply) => {
      const parse = UpdateOrgProfileBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;
      const data = parse.data;

      // Ensure CORE_FINANCE is always present in enabledModules
      let enabledModules: string[] | undefined = undefined;
      if (data.enabledModules !== undefined) {
        const set = new Set(['CORE_FINANCE', ...data.enabledModules]);
        enabledModules = Array.from(set);
      }

      let parsedLockDate: Date | null | undefined = undefined;
      if (data.lockDate !== undefined) {
        parsedLockDate = data.lockDate ? new Date(data.lockDate) : null;
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const org = await tx.organization.update({
          where: { id: organizationId },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.legalName !== undefined ? { legalName: data.legalName || null } : {}),
            ...(data.tradingName !== undefined ? { tradingName: data.tradingName || null } : {}),
            ...(data.email !== undefined ? { email: data.email || null } : {}),
            ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
            ...(data.addressLine1 !== undefined ? { addressLine1: data.addressLine1 || null } : {}),
            ...(data.addressLine2 !== undefined ? { addressLine2: data.addressLine2 || null } : {}),
            ...(data.city !== undefined ? { city: data.city || null } : {}),
            ...(data.state !== undefined ? { state: data.state || null } : {}),
            ...(data.postcode !== undefined ? { postcode: data.postcode || null } : {}),
            ...(data.bankBsb !== undefined ? { bankBsb: normalizeBsb(data.bankBsb) } : {}),
            ...(data.bankAccountNumber !== undefined
              ? { bankAccountNumber: data.bankAccountNumber?.trim() || null }
              : {}),
            ...(data.bankAccountName !== undefined
              ? { bankAccountName: data.bankAccountName?.trim() || null }
              : {}),
            ...(data.apcaUserId !== undefined
              ? { apcaUserId: data.apcaUserId?.trim() || null }
              : {}),
            ...(data.defaultPaymentTermsDays !== undefined
              ? { defaultPaymentTermsDays: data.defaultPaymentTermsDays }
              : {}),
            ...(data.fiscalYearStartMonth !== undefined
              ? { fiscalYearStartMonth: data.fiscalYearStartMonth }
              : {}),
            ...(parsedLockDate !== undefined ? { lockDate: parsedLockDate } : {}),
            ...(data.enforceTwoPersonApproval !== undefined
              ? { enforceTwoPersonApproval: data.enforceTwoPersonApproval }
              : {}),
            ...(enabledModules !== undefined ? { enabledModules } : {}),
          },
        });

        // Also synchronize primary 1000 Operating Bank Account BSB/Account # if updated
        if (data.bankBsb !== undefined || data.bankAccountNumber !== undefined) {
          await tx.account.updateMany({
            where: { organizationId, code: '1000' },
            data: {
              ...(data.bankBsb !== undefined ? { bankBsb: normalizeBsb(data.bankBsb) } : {}),
              ...(data.bankAccountNumber !== undefined
                ? { bankAccountNumber: data.bankAccountNumber?.trim() || null }
                : {}),
              ...(data.apcaUserId !== undefined
                ? { apcaUserId: data.apcaUserId?.trim() || null }
                : {}),
            },
          });
        }

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action:
            data.lockDate !== undefined
              ? 'PERIOD_LOCK_UPDATED'
              : 'ORGANIZATION_PROFILE_UPDATED',
          entityType: 'ORGANIZATION',
          entityId: organizationId,
          summary:
            data.lockDate !== undefined
              ? `Updated organization settings and set Period Lock Date to ${
                  parsedLockDate ? parsedLockDate.toISOString().slice(0, 10) : 'Unlocked'
                }`
              : `Updated organization profile, banking remittance, and governance settings`,
          metadata: data,
        });

        return org;
      });

      return reply.code(200).send({ organization: updated });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/organizations/my-profile — Update own employee banking/profile
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/v1/organizations/my-profile',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const parse = UpdateMyMemberProfileBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const userId = request.user.userId;
      const data = parse.data;

      const updatedMember = await fastify.prisma.$transaction(async (tx) => {
        const mem = await tx.organizationMember.update({
          where: {
            organizationId_userId: {
              organizationId,
              userId,
            },
          },
          data: {
            ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle || null } : {}),
            ...(data.department !== undefined ? { department: data.department || null } : {}),
            ...(data.bankBsb !== undefined ? { bankBsb: normalizeBsb(data.bankBsb) } : {}),
            ...(data.bankAccountNumber !== undefined
              ? { bankAccountNumber: data.bankAccountNumber?.trim() || null }
              : {}),
            ...(data.bankAccountName !== undefined
              ? { bankAccountName: data.bankAccountName?.trim() || null }
              : {}),
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: userId,
          action: 'EMPLOYEE_BANK_PROFILE_UPDATED',
          entityType: 'ORGANIZATION_MEMBER',
          entityId: mem.id,
          summary: `Updated employee reimbursement bank details and profile`,
        });

        return mem;
      });

      return reply.code(200).send({ memberProfile: updatedMember });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/organizations/members — List organization members
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/organizations/members',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER, Role.AUDITOR),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      const members = await fastify.prisma.organizationMember.findMany({
        where: { organizationId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      });

      return reply.code(200).send({ members });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/organizations/members/:id — Update member role/banking (ADMIN)
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/v1/organizations/members/:id',
    { preHandler: [requireRole(Role.ADMIN)] },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid member ID' });
      }

      const bodyParse = UpdateMemberBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;
      const data = bodyParse.data;

      const existing = await fastify.prisma.organizationMember.findFirst({
        where: { id, organizationId },
        include: { user: { select: { name: true, email: true } } },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Organization member not found' });
      }

      // Guard against demoting the last ADMIN
      if (
        existing.role === Role.ADMIN &&
        data.role &&
        data.role !== Role.ADMIN
      ) {
        const adminCount = await fastify.prisma.organizationMember.count({
          where: { organizationId, role: Role.ADMIN },
        });
        if (adminCount <= 1) {
          return reply.code(400).send({
            error:
              'Cannot demote the last ADMIN of this organization. Assign another ADMIN first.',
          });
        }
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const mem = await tx.organizationMember.update({
          where: { id },
          data: {
            ...(data.role !== undefined ? { role: data.role } : {}),
            ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle || null } : {}),
            ...(data.department !== undefined ? { department: data.department || null } : {}),
            ...(data.bankBsb !== undefined ? { bankBsb: normalizeBsb(data.bankBsb) } : {}),
            ...(data.bankAccountNumber !== undefined
              ? { bankAccountNumber: data.bankAccountNumber?.trim() || null }
              : {}),
            ...(data.bankAccountName !== undefined
              ? { bankAccountName: data.bankAccountName?.trim() || null }
              : {}),
          },
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'MEMBER_UPDATED',
          entityType: 'ORGANIZATION_MEMBER',
          entityId: mem.id,
          summary: `Updated member ${existing.user.name} (${existing.user.email}) — Role: ${mem.role}`,
          metadata: data,
        });

        return mem;
      });

      return reply.code(200).send({ member: updated });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/organizations/members/:id — Remove member (ADMIN)
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/v1/organizations/members/:id',
    { preHandler: [requireRole(Role.ADMIN)] },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid member ID' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const existing = await fastify.prisma.organizationMember.findFirst({
        where: { id, organizationId },
        include: { user: { select: { name: true, email: true } } },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Member not found' });
      }

      if (existing.role === Role.ADMIN) {
        const adminCount = await fastify.prisma.organizationMember.count({
          where: { organizationId, role: Role.ADMIN },
        });
        if (adminCount <= 1) {
          return reply.code(400).send({
            error: 'Cannot remove the last ADMIN of this organization.',
          });
        }
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.organizationMember.delete({ where: { id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'MEMBER_REMOVED',
          entityType: 'ORGANIZATION_MEMBER',
          entityId: id,
          summary: `Removed ${existing.user.name} (${existing.user.email}) from organization`,
        });
      });

      return reply.code(200).send({ deleted: true });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/organizations/invites — List pending invitations
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/organizations/invites',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AUDITOR)] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      const invites = await fastify.prisma.organizationInvite.findMany({
        where: {
          organizationId,
          acceptedAt: null,
        },
        include: {
          invitedBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.code(200).send({ invites });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/organizations/invites — Invite team member by email (ADMIN)
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/organizations/invites',
    { preHandler: [requireRole(Role.ADMIN)] },
    async (request, reply) => {
      const parse = CreateInviteBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const actorUserId = request.user.userId;
      const email = parse.data.email.toLowerCase().trim();
      const { role, department, jobTitle } = parse.data;

      // Check if user already exists in the platform
      const existingUser = await fastify.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });

      if (existingUser) {
        const existingMember =
          await fastify.prisma.organizationMember.findUnique({
            where: {
              organizationId_userId: {
                organizationId,
                userId: existingUser.id,
              },
            },
          });

        if (existingMember) {
          return reply.code(409).send({
            error: `${email} is already an active member of this organization.`,
          });
        }

        // Immediately add existing user to organization_members for zero-friction onboarding
        const member = await fastify.prisma.$transaction(async (tx) => {
          const mem = await tx.organizationMember.create({
            data: {
              organizationId,
              userId: existingUser.id,
              role,
              department: department ?? null,
              jobTitle: jobTitle ?? null,
            },
            include: {
              user: {
                select: { id: true, name: true, email: true, avatarUrl: true },
              },
            },
          });

          await recordAuditLog(tx, {
            organizationId,
            actorUserId,
            action: 'MEMBER_ADDED_DIRECT',
            entityType: 'ORGANIZATION_MEMBER',
            entityId: mem.id,
            summary: `Added existing user ${existingUser.name} (${email}) directly to organization with role ${role}`,
            metadata: { email, role, department, jobTitle },
          });

          return mem;
        });

        return reply.code(201).send({
          status: 'added_immediately',
          member,
        });
      }

      // Check for an existing active invite for this email
      const existingInvite = await fastify.prisma.organizationInvite.findFirst({
        where: {
          organizationId,
          email: { equals: email, mode: 'insensitive' },
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (existingInvite) {
        return reply.code(409).send({
          error: `A pending invitation already exists for ${email}.`,
        });
      }

      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

      const invite = await fastify.prisma.$transaction(async (tx) => {
        const inv = await tx.organizationInvite.create({
          data: {
            organizationId,
            email,
            role,
            department: department ?? null,
            jobTitle: jobTitle ?? null,
            invitedByUserId: actorUserId,
            expiresAt,
          },
          include: {
            invitedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId,
          action: 'USER_INVITED',
          entityType: 'ORGANIZATION_INVITE',
          entityId: inv.id,
          summary: `Invited ${email} to join organization as ${role}`,
          metadata: { email, role, department, jobTitle, expiresAt },
        });

        return inv;
      });

      return reply.code(201).send({
        status: 'invite_created',
        invite,
      });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/organizations/invites/:id — Revoke pending invitation (ADMIN)
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/v1/organizations/invites/:id',
    { preHandler: [requireRole(Role.ADMIN)] },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invite ID' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const existing = await fastify.prisma.organizationInvite.findFirst({
        where: { id, organizationId },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Invitation not found' });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.organizationInvite.delete({ where: { id } });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'INVITE_REVOKED',
          entityType: 'ORGANIZATION_INVITE',
          entityId: id,
          summary: `Revoked pending invitation for ${existing.email} (${existing.role})`,
        });
      });

      return reply.code(200).send({ revoked: true });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/audit-logs — Immutable System Audit Log Query
  // Allowed roles: ADMIN, ACCOUNTANT, AUDITOR
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/audit-logs',
    { preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AUDITOR)] },
    async (request, reply) => {
      const parse = ListAuditLogsQuery.safeParse(request.query);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { entityType, action, search, limit, offset } = parse.data;
      const organizationId = request.user.organizationId!;

      const whereClause: any = {
        organizationId,
      };

      if (entityType) {
        whereClause.entityType = entityType;
      }

      if (action) {
        whereClause.action = action;
      }

      if (search && search.length > 0) {
        whereClause.OR = [
          { summary: { contains: search, mode: 'insensitive' } },
          { actorName: { contains: search, mode: 'insensitive' } },
          { actorEmail: { contains: search, mode: 'insensitive' } },
          { action: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [logs, totalCount] = await Promise.all([
        fastify.prisma.auditLog.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        fastify.prisma.auditLog.count({
          where: whereClause,
        }),
      ]);

      return reply.code(200).send({
        logs,
        totalCount,
      });
    },
  );
};

export default organizationRoutes;
