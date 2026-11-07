/**
 * Contacts routes — Phase 3 Contacts Directory API
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET   /api/v1/contacts         (List contacts with search, type filter, active filter)
 *  - POST  /api/v1/contacts         (Create customer, vendor, or both with optional ABN check)
 *  - GET   /api/v1/contacts/:id     (Get single contact)
 *  - PATCH /api/v1/contacts/:id     (Update contact details, payment terms, or active state)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireOrgAuth, requireRole } from '../plugins/auth.js';
import { validateABN } from '../lib/abn.js';
import { ContactType, Role } from '@prisma/client';

const ContactTypeEnum = z.nativeEnum(ContactType);

const ListContactsQuery = z.object({
  type: ContactTypeEnum.optional(),
  search: z.string().trim().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
});

const CreateContactBody = z.object({
  type: ContactTypeEnum,
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().nullable().optional(),
  abn: z.string().trim().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  requiresInvoiceForPayment: z.boolean().default(true),
});

const UpdateContactBody = z.object({
  type: ContactTypeEnum.optional(),
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().nullable().optional(),
  abn: z.string().trim().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  requiresInvoiceForPayment: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

const contactRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/contacts — List organization contacts
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/contacts',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const parse = ListContactsQuery.safeParse(request.query);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { type, search, isActive } = parse.data;
      const organizationId = request.user.organizationId!;

      const whereClause: {
        organizationId: string;
        type?: ContactType;
        isActive?: boolean;
        OR?: Array<{
          name?: { contains: string; mode: 'insensitive' };
          email?: { contains: string; mode: 'insensitive' };
          abn?: { contains: string };
        }>;
      } = {
        organizationId,
      };

      if (type) {
        whereClause.type = type;
      }

      if (typeof isActive === 'boolean') {
        whereClause.isActive = isActive;
      }

      if (search && search.length > 0) {
        const cleanDigits = search.replace(/\s/g, '');
        whereClause.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          ...(cleanDigits.length > 0 ? [{ abn: { contains: cleanDigits } }] : []),
        ];
      }

      const contacts = await fastify.prisma.contact.findMany({
        where: whereClause,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });

      return reply.code(200).send({ contacts });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/contacts — Create a contact
  // Allowed roles: ADMIN, ACCOUNTANT, AR_SPECIALIST, AP_SPECIALIST
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/contacts',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
        ),
      ],
    },
    async (request, reply) => {
      const parse = CreateContactBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const {
        type,
        name,
        email,
        abn,
        paymentTermsDays,
        requiresInvoiceForPayment,
      } = parse.data;

      let cleanAbn: string | null = null;
      if (abn && abn.trim().length > 0) {
        cleanAbn = abn.replace(/\s/g, '');
        if (!validateABN(cleanAbn)) {
          return reply.code(400).send({
            error: 'Invalid Australian Business Number (ABN)',
          });
        }
      }

      const organizationId = request.user.organizationId!;

      const contact = await fastify.prisma.contact.create({
        data: {
          organizationId,
          type,
          name,
          email: email ?? null,
          abn: cleanAbn,
          paymentTermsDays,
          requiresInvoiceForPayment,
          isActive: true,
        },
      });

      return reply.code(201).send({ contact });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/contacts/:id — Get contact details
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/contacts/:id',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid contact ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const contact = await fastify.prisma.contact.findFirst({
        where: { id, organizationId },
      });

      if (!contact) {
        return reply.code(404).send({ error: 'Contact not found' });
      }

      return reply.code(200).send({ contact });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/contacts/:id — Update contact details
  // Allowed roles: ADMIN, ACCOUNTANT, AR_SPECIALIST, AP_SPECIALIST
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/v1/contacts/:id',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
        ),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid contact ID format' });
      }

      const parse = UpdateContactBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const existing = await fastify.prisma.contact.findFirst({
        where: { id, organizationId },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Contact not found' });
      }

      const {
        type,
        name,
        email,
        abn,
        paymentTermsDays,
        requiresInvoiceForPayment,
        isActive,
      } = parse.data;

      let cleanAbn: string | null | undefined = undefined;
      if (abn !== undefined) {
        if (abn === null || abn.trim().length === 0) {
          cleanAbn = null;
        } else {
          const stripped = abn.replace(/\s/g, '');
          if (!validateABN(stripped)) {
            return reply.code(400).send({
              error: 'Invalid Australian Business Number (ABN)',
            });
          }
          cleanAbn = stripped;
        }
      }

      const updated = await fastify.prisma.contact.update({
        where: { id },
        data: {
          ...(type ? { type } : {}),
          ...(name ? { name } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(cleanAbn !== undefined ? { abn: cleanAbn } : {}),
          ...(paymentTermsDays !== undefined ? { paymentTermsDays } : {}),
          ...(requiresInvoiceForPayment !== undefined
            ? { requiresInvoiceForPayment }
            : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });

      return reply.code(200).send({ contact: updated });
    },
  );
};

export default contactRoutes;

