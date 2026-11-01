/**
 * Organization routes — Phase 2 Onboarding & Org management
 *
 * POST /api/v1/organizations:
 *  - Validates organization name (2–100 chars)
 *  - Validates ABN with standard ATO checksum algorithm
 *  - Atomically creates organization, assigns caller as ADMIN,
 *    and seeds the minimal Australian SME Chart of Accounts (7 accounts).
 *  - Issues an updated session cookie containing organizationId and ADMIN role.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, setSession } from '../plugins/auth.js';
import { validateABN } from '../lib/abn.js';
import { AccountType, NormalBalance, Role } from '@prisma/client';

const CreateOrgBody = z.object({
  name: z.string().trim().min(2).max(100),
  abn: z.string().trim(),
});

const DEFAULT_CHART_OF_ACCOUNTS = [
  {
    code: '1000',
    name: 'Operating Bank Account',
    type: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    description: 'Primary cash account for payments in and out',
  },
  {
    code: '1200',
    name: 'Accounts Receivable (A/R)',
    type: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    description: 'Money owed by customers for issued invoices',
  },
  {
    code: '2000',
    name: 'Accounts Payable (A/P)',
    type: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    description: 'Money owed to suppliers for recorded bills',
  },
  {
    code: '2100',
    name: 'GST Collected (Sales)',
    type: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    description: '10% GST collected to be remitted to the ATO',
  },
  {
    code: '2200',
    name: 'GST Paid (Purchases)',
    type: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    description: '10% GST paid on bills, claimable from the ATO',
  },
  {
    code: '4000',
    name: 'Sales Revenue',
    type: AccountType.REVENUE,
    normalBalance: NormalBalance.CREDIT,
    description: 'Core business operating income',
  },
  {
    code: '5000',
    name: 'Operating Expenses',
    type: AccountType.EXPENSE,
    normalBalance: NormalBalance.DEBIT,
    description: 'General vendor expenses and purchases',
  },
] as const;

const organizationRoutes: FastifyPluginAsync = async (fastify) => {
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

      const { name, abn } = parse.data;
      const cleanAbn = abn.replace(/\s/g, '');

      if (!validateABN(cleanAbn)) {
        return reply.code(400).send({
          error: 'Invalid Australian Business Number (ABN)',
        });
      }

      // Check if ABN is already registered
      const existing = await fastify.prisma.organization.findUnique({
        where: { abn: cleanAbn },
      });
      if (existing) {
        return reply.code(409).send({
          error: 'An organization with this ABN already exists',
        });
      }

      const userId = request.user.userId;

      // Atomically create Organization, OrganizationMember, and seed Chart of Accounts
      const [organization, member] = await fastify.prisma.$transaction(
        async (tx) => {
          const org = await tx.organization.create({
            data: {
              name,
              abn: cleanAbn,
            },
          });

          const mem = await tx.organizationMember.create({
            data: {
              organizationId: org.id,
              userId,
              role: Role.ADMIN,
            },
          });

          // Seed default Australian SME Chart of Accounts
          await tx.account.createMany({
            data: DEFAULT_CHART_OF_ACCOUNTS.map((account) => ({
              organizationId: org.id,
              code: account.code,
              name: account.name,
              type: account.type,
              normalBalance: account.normalBalance,
              description: account.description,
            })),
          });

          return [org, mem];
        },
      );

      // Re-issue session cookie with organizationId and ADMIN role
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
        organization: {
          id: organization.id,
          name: organization.name,
          abn: organization.abn,
          createdAt: organization.createdAt,
        },
        role: member.role,
      });
    },
  );
};

export default organizationRoutes;
