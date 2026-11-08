/**
 * Contacts routes — Module 3 Contacts Directory & Contact 360 API
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET   /api/v1/contacts         (List contacts with search, type filter, active filter)
 *  - POST  /api/v1/contacts         (Create customer, vendor, or both with optional ABN & BSB checks)
 *  - GET   /api/v1/contacts/:id     (Get single contact with default account linkages)
 *  - PATCH /api/v1/contacts/:id     (Update contact details, payment terms, or active state)
 *  - GET   /api/v1/contacts/:id/360 (Contact 360: outstanding AR/AP, aging breakdown & transaction history)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { validateABN } from '../lib/abn.js';
import { recordAuditLog } from '../lib/audit.js';
import { ContactType, Role, AccountType } from '@prisma/client';

const ContactTypeEnum = z.nativeEnum(ContactType);

function cleanBsb(bsb?: string | null): string | null {
  if (!bsb || bsb.trim().length === 0) return null;
  const digits = bsb.replace(/\D/g, '');
  if (digits.length !== 6) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;
}

function serializeContact<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

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
  legalName: z.string().trim().max(150).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  billingAddress: z.string().trim().max(300).nullable().optional(),
  abn: z.string().trim().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  requiresInvoiceForPayment: z.boolean().default(true),
  defaultRevenueAccountId: z.string().uuid().nullable().optional(),
  defaultExpenseAccountId: z.string().uuid().nullable().optional(),
  bankBsb: z.string().trim().nullable().optional(),
  bankAccountNumber: z.string().trim().max(30).nullable().optional(),
  bankAccountName: z.string().trim().max(100).nullable().optional(),
});

const UpdateContactBody = z.object({
  type: ContactTypeEnum.optional(),
  name: z.string().trim().min(2).max(100).optional(),
  legalName: z.string().trim().max(150).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  billingAddress: z.string().trim().max(300).nullable().optional(),
  abn: z.string().trim().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  requiresInvoiceForPayment: z.boolean().optional(),
  defaultRevenueAccountId: z.string().uuid().nullable().optional(),
  defaultExpenseAccountId: z.string().uuid().nullable().optional(),
  bankBsb: z.string().trim().nullable().optional(),
  bankAccountNumber: z.string().trim().max(30).nullable().optional(),
  bankAccountName: z.string().trim().max(100).nullable().optional(),
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
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
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
          legalName?: { contains: string; mode: 'insensitive' };
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
          { legalName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          ...(cleanDigits.length > 0 ? [{ abn: { contains: cleanDigits } }] : []),
        ];
      }

      const contacts = await fastify.prisma.contact.findMany({
        where: whereClause,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });

      return reply.code(200).send({ contacts: serializeContact(contacts) });
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
        legalName,
        email,
        phone,
        billingAddress,
        abn,
        paymentTermsDays,
        requiresInvoiceForPayment,
        defaultRevenueAccountId,
        defaultExpenseAccountId,
        bankBsb,
        bankAccountNumber,
        bankAccountName,
      } = parse.data;

      const organizationId = request.user.organizationId!;

      let cleanAbn: string | null = null;
      if (abn && abn.trim().length > 0) {
        cleanAbn = abn.replace(/\s/g, '');
        if (!validateABN(cleanAbn)) {
          return reply.code(400).send({
            error: 'Invalid Australian Business Number (ABN)',
          });
        }
      }

      let formattedBsb: string | null = null;
      if (bankBsb && bankBsb.trim().length > 0) {
        formattedBsb = cleanBsb(bankBsb);
        if (!formattedBsb) {
          return reply.code(400).send({
            error: 'Invalid Australian Bank BSB format (must be 6 digits, e.g. 012-345)',
          });
        }
      }

      // Validate default revenue account if provided
      if (defaultRevenueAccountId) {
        const revAcc = await fastify.prisma.account.findFirst({
          where: { id: defaultRevenueAccountId, organizationId, isActive: true },
        });
        if (!revAcc || revAcc.type !== AccountType.REVENUE) {
          return reply.code(400).send({
            error: 'Selected default revenue account does not exist or is not a REVENUE account.',
          });
        }
      }

      // Validate default expense account if provided
      if (defaultExpenseAccountId) {
        const expAcc = await fastify.prisma.account.findFirst({
          where: { id: defaultExpenseAccountId, organizationId, isActive: true },
        });
        if (!expAcc || expAcc.type !== AccountType.EXPENSE) {
          return reply.code(400).send({
            error: 'Selected default expense account does not exist or is not an EXPENSE account.',
          });
        }
      }

      const contact = await fastify.prisma.contact.create({
        data: {
          organizationId,
          type,
          name,
          legalName: legalName ?? null,
          email: email ?? null,
          phone: phone ?? null,
          billingAddress: billingAddress ?? null,
          abn: cleanAbn,
          paymentTermsDays,
          requiresInvoiceForPayment,
          defaultRevenueAccountId: defaultRevenueAccountId ?? null,
          defaultExpenseAccountId: defaultExpenseAccountId ?? null,
          bankBsb: formattedBsb,
          bankAccountNumber: bankAccountNumber ?? null,
          bankAccountName: bankAccountName ?? null,
          isActive: true,
        },
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'CONTACT_CREATED',
        entityType: 'CONTACT',
        entityId: contact.id,
        summary: `Created ${contact.type} contact "${contact.name}"`,
      });

      return reply.code(201).send({ contact: serializeContact(contact) });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/contacts/:id — Get contact details
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/contacts/:id',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
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

      // Fetch linked default GL accounts if configured
      let defaultRevenueAccount = null;
      if (contact.defaultRevenueAccountId) {
        defaultRevenueAccount = await fastify.prisma.account.findUnique({
          where: { id: contact.defaultRevenueAccountId },
          select: { id: true, code: true, name: true, type: true },
        });
      }

      let defaultExpenseAccount = null;
      if (contact.defaultExpenseAccountId) {
        defaultExpenseAccount = await fastify.prisma.account.findUnique({
          where: { id: contact.defaultExpenseAccountId },
          select: { id: true, code: true, name: true, type: true },
        });
      }

      return reply.code(200).send({
        contact: serializeContact({
          ...contact,
          defaultRevenueAccount,
          defaultExpenseAccount,
        }),
      });
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
        legalName,
        email,
        phone,
        billingAddress,
        abn,
        paymentTermsDays,
        requiresInvoiceForPayment,
        defaultRevenueAccountId,
        defaultExpenseAccountId,
        bankBsb,
        bankAccountNumber,
        bankAccountName,
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

      let formattedBsb: string | null | undefined = undefined;
      if (bankBsb !== undefined) {
        if (bankBsb === null || bankBsb.trim().length === 0) {
          formattedBsb = null;
        } else {
          const clean = cleanBsb(bankBsb);
          if (!clean) {
            return reply.code(400).send({
              error: 'Invalid Australian Bank BSB format (must be 6 digits, e.g. 012-345)',
            });
          }
          formattedBsb = clean;
        }
      }

      // Validate default revenue account if updated
      if (defaultRevenueAccountId !== undefined && defaultRevenueAccountId !== null) {
        const revAcc = await fastify.prisma.account.findFirst({
          where: { id: defaultRevenueAccountId, organizationId, isActive: true },
        });
        if (!revAcc || revAcc.type !== AccountType.REVENUE) {
          return reply.code(400).send({
            error: 'Selected default revenue account does not exist or is not a REVENUE account.',
          });
        }
      }

      // Validate default expense account if updated
      if (defaultExpenseAccountId !== undefined && defaultExpenseAccountId !== null) {
        const expAcc = await fastify.prisma.account.findFirst({
          where: { id: defaultExpenseAccountId, organizationId, isActive: true },
        });
        if (!expAcc || expAcc.type !== AccountType.EXPENSE) {
          return reply.code(400).send({
            error: 'Selected default expense account does not exist or is not an EXPENSE account.',
          });
        }
      }

      const updated = await fastify.prisma.contact.update({
        where: { id },
        data: {
          ...(type ? { type } : {}),
          ...(name ? { name } : {}),
          ...(legalName !== undefined ? { legalName } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(billingAddress !== undefined ? { billingAddress } : {}),
          ...(cleanAbn !== undefined ? { abn: cleanAbn } : {}),
          ...(paymentTermsDays !== undefined ? { paymentTermsDays } : {}),
          ...(requiresInvoiceForPayment !== undefined ? { requiresInvoiceForPayment } : {}),
          ...(defaultRevenueAccountId !== undefined ? { defaultRevenueAccountId } : {}),
          ...(defaultExpenseAccountId !== undefined ? { defaultExpenseAccountId } : {}),
          ...(formattedBsb !== undefined ? { bankBsb: formattedBsb } : {}),
          ...(bankAccountNumber !== undefined ? { bankAccountNumber } : {}),
          ...(bankAccountName !== undefined ? { bankAccountName } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'CONTACT_UPDATED',
        entityType: 'CONTACT',
        entityId: updated.id,
        summary: `Updated contact "${updated.name}"`,
      });

      return reply.code(200).send({ contact: serializeContact(updated) });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/contacts/:id/360 — Contact 360: AR/AP Balances, Aging & History
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/contacts/:id/360',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
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

      // Fetch open invoices for AR
      const openInvoices = await fastify.prisma.invoice.findMany({
        where: {
          contactId: id,
          organizationId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        },
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          dueDate: true,
          totalCents: true,
          amountPaidCents: true,
          status: true,
        },
      });

      // Fetch open bills for AP
      const openBills = await fastify.prisma.bill.findMany({
        where: {
          contactId: id,
          organizationId,
          status: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID'] },
        },
        select: {
          id: true,
          reference: true,
          issueDate: true,
          dueDate: true,
          totalCents: true,
          amountPaidCents: true,
          status: true,
        },
      });

      const now = new Date();
      const nowMs = now.getTime();

      // Aging breakdown helper
      const arAging = { currentCents: 0n, days30Cents: 0n, days60Cents: 0n, days90PlusCents: 0n };
      let totalOutstandingArCents = 0n;

      for (const inv of openInvoices) {
        const remaining = inv.totalCents - inv.amountPaidCents;
        if (remaining > 0n) {
          totalOutstandingArCents += remaining;
          const dueMs = new Date(inv.dueDate).getTime();
          const daysOverdue = Math.floor((nowMs - dueMs) / (1000 * 60 * 60 * 24));

          if (daysOverdue <= 0) {
            arAging.currentCents += remaining;
          } else if (daysOverdue <= 30) {
            arAging.days30Cents += remaining;
          } else if (daysOverdue <= 60) {
            arAging.days60Cents += remaining;
          } else {
            arAging.days90PlusCents += remaining;
          }
        }
      }

      const apAging = { currentCents: 0n, days30Cents: 0n, days60Cents: 0n, days90PlusCents: 0n };
      let totalOutstandingApCents = 0n;

      for (const bill of openBills) {
        const remaining = bill.totalCents - bill.amountPaidCents;
        if (remaining > 0n) {
          totalOutstandingApCents += remaining;
          const dueMs = new Date(bill.dueDate).getTime();
          const daysOverdue = Math.floor((nowMs - dueMs) / (1000 * 60 * 60 * 24));

          if (daysOverdue <= 0) {
            apAging.currentCents += remaining;
          } else if (daysOverdue <= 30) {
            apAging.days30Cents += remaining;
          } else if (daysOverdue <= 60) {
            apAging.days60Cents += remaining;
          } else {
            apAging.days90PlusCents += remaining;
          }
        }
      }

      // Fetch unified chronological recent activity (Invoices, Bills, PaymentsIn, PaymentsOut, Quotes)
      const [recentInvoices, recentBills, recentPaymentsIn, recentPaymentsOut, recentQuotes] =
        await Promise.all([
          fastify.prisma.invoice.findMany({
            where: { contactId: id, organizationId },
            take: 15,
            orderBy: { issueDate: 'desc' },
            select: {
              id: true,
              invoiceNumber: true,
              issueDate: true,
              dueDate: true,
              totalCents: true,
              amountPaidCents: true,
              status: true,
            },
          }),
          fastify.prisma.bill.findMany({
            where: { contactId: id, organizationId },
            take: 15,
            orderBy: { issueDate: 'desc' },
            select: {
              id: true,
              reference: true,
              issueDate: true,
              dueDate: true,
              totalCents: true,
              amountPaidCents: true,
              status: true,
            },
          }),
          fastify.prisma.paymentIn.findMany({
            where: { contactId: id, organizationId },
            take: 15,
            orderBy: { paymentDate: 'desc' },
            select: {
              id: true,
              paymentDate: true,
              amountCents: true,
              reference: true,
            },
          }),
          fastify.prisma.paymentOut.findMany({
            where: { bill: { contactId: id }, organizationId },
            take: 15,
            orderBy: { paymentDate: 'desc' },
            select: {
              id: true,
              paymentDate: true,
              amountCents: true,
              reference: true,
              bill: { select: { reference: true } },
            },
          }),
          fastify.prisma.quote.findMany({
            where: { contactId: id, organizationId },
            take: 10,
            orderBy: { issueDate: 'desc' },
            select: {
              id: true,
              quoteNumber: true,
              issueDate: true,
              expiryDate: true,
              totalCents: true,
              status: true,
            },
          }),
        ]);

      // Map to unified chronological activity feed
      const activity: Array<{
        id: string;
        date: Date;
        docType: 'INVOICE' | 'BILL' | 'PAYMENT_IN' | 'PAYMENT_OUT' | 'QUOTE';
        referenceNumber: string;
        amountCents: bigint;
        status?: string;
        details?: string;
      }> = [];

      for (const inv of recentInvoices) {
        activity.push({
          id: inv.id,
          date: inv.issueDate,
          docType: 'INVOICE',
          referenceNumber: inv.invoiceNumber,
          amountCents: inv.totalCents,
          status: inv.status,
          details: `Due ${inv.dueDate.toISOString().slice(0, 10)}`,
        });
      }

      for (const bill of recentBills) {
        activity.push({
          id: bill.id,
          date: bill.issueDate,
          docType: 'BILL',
          referenceNumber: bill.reference || 'Bill',
          amountCents: bill.totalCents,
          status: bill.status,
          details: `Due ${bill.dueDate.toISOString().slice(0, 10)}`,
        });
      }

      for (const pin of recentPaymentsIn) {
        activity.push({
          id: pin.id,
          date: pin.paymentDate,
          docType: 'PAYMENT_IN',
          referenceNumber: pin.reference || 'Receipt',
          amountCents: pin.amountCents,
          status: 'SETTLED',
          details: 'Incoming payment received',
        });
      }

      for (const pout of recentPaymentsOut) {
        activity.push({
          id: pout.id,
          date: pout.paymentDate,
          docType: 'PAYMENT_OUT',
          referenceNumber: pout.reference || pout.bill.reference || 'Disbursement',
          amountCents: pout.amountCents,
          status: 'PAID',
          details: 'Outgoing supplier payment',
        });
      }

      for (const q of recentQuotes) {
        activity.push({
          id: q.id,
          date: q.issueDate,
          docType: 'QUOTE',
          referenceNumber: q.quoteNumber,
          amountCents: q.totalCents,
          status: q.status,
          details: `Expires ${q.expiryDate.toISOString().slice(0, 10)}`,
        });
      }

      // Sort combined activity descending by date
      activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return reply.code(200).send({
        contact: serializeContact(contact),
        summary: {
          totalOutstandingArCents: Number(totalOutstandingArCents),
          totalOutstandingApCents: Number(totalOutstandingApCents),
          arAging: {
            currentCents: Number(arAging.currentCents),
            days30Cents: Number(arAging.days30Cents),
            days60Cents: Number(arAging.days60Cents),
            days90PlusCents: Number(arAging.days90PlusCents),
          },
          apAging: {
            currentCents: Number(apAging.currentCents),
            days30Cents: Number(apAging.days30Cents),
            days60Cents: Number(apAging.days60Cents),
            days90PlusCents: Number(apAging.days90PlusCents),
          },
        },
        activity: serializeContact(activity.slice(0, 30)),
      });
    },
  );
};

export default contactRoutes;
