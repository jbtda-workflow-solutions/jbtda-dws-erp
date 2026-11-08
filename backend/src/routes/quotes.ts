/**
 * Quotes / Estimates routes — Module 4 Accounts Receivable (AR)
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET    /api/v1/quotes                     (List quotes with contact, status, search filters)
 *  - POST   /api/v1/quotes                     (Create quote with line items & GST calculations)
 *  - GET    /api/v1/quotes/:id                 (Get quote details with line items)
 *  - PATCH  /api/v1/quotes/:id                 (Update quote details or transition status)
 *  - DELETE /api/v1/quotes/:id                 (Delete draft/cancelled quote)
 *  - POST   /api/v1/quotes/:id/convert-to-invoice (1-Click Convert accepted/sent quote into an Invoice)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import { QuoteStatus, Role, TaxTreatment, InvoiceStatus } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const QuoteStatusEnum = z.nativeEnum(QuoteStatus);

const QuoteLineItemInput = z.object({
  itemId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  trackingOptionId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(255),
  quantity: z.number().int().positive().default(1),
  unitPriceCents: z.number().int().nonnegative().default(0),
  taxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
});

const CreateQuoteBody = z.object({
  contactId: z.string().uuid(),
  quoteNumber: z.string().trim().min(1).max(50).optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  expiryDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: QuoteStatusEnum.default(QuoteStatus.DRAFT),
  lineItems: z.array(QuoteLineItemInput).min(1),
});

const UpdateQuoteBody = z.object({
  contactId: z.string().uuid().optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  expiryDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: QuoteStatusEnum.optional(),
  lineItems: z.array(QuoteLineItemInput).min(1).optional(),
});

const ListQuotesQuery = z.object({
  status: QuoteStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

function serializeQuote<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

const quoteRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/quotes — List organization quotes
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/quotes',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const parse = ListQuotesQuery.safeParse(request.query);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { status, contactId, search } = parse.data;
      const organizationId = request.user.organizationId!;

      const whereClause: any = { organizationId };

      if (status) {
        whereClause.status = status;
      }
      if (contactId) {
        whereClause.contactId = contactId;
      }
      if (search && search.length > 0) {
        whereClause.OR = [
          { quoteNumber: { contains: search, mode: 'insensitive' } },
          { contact: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const quotes = await fastify.prisma.quote.findMany({
        where: whereClause,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              email: true,
              abn: true,
              paymentTermsDays: true,
            },
          },
          lineItems: true,
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      });

      return reply.code(200).send({ quotes: serializeQuote(quotes) });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/quotes — Create a quote
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/quotes',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreateQuoteBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const {
        contactId,
        quoteNumber: customQuoteNumber,
        issueDate,
        expiryDate,
        notes,
        status,
        lineItems,
      } = parse.data;
      const organizationId = request.user.organizationId!;

      // 1. Verify contact exists in this org and is customer or both
      const contact = await fastify.prisma.contact.findFirst({
        where: { id: contactId, organizationId },
      });
      if (!contact) {
        return reply.code(400).send({ error: 'Contact not found' });
      }
      if (contact.type === 'VENDOR') {
        return reply.code(400).send({
          error: 'Cannot issue a quote to a VENDOR contact. Contact must be CUSTOMER or BOTH.',
        });
      }

      // 2. Generate or validate quote number
      let quoteNumber = customQuoteNumber;
      if (!quoteNumber) {
        const count = await fastify.prisma.quote.count({ where: { organizationId } });
        let candidateNum = 1001 + count;
        while (true) {
          const candidate = `QTE-${candidateNum.toString().padStart(4, '0')}`;
          const existing = await fastify.prisma.quote.findFirst({
            where: { organizationId, quoteNumber: candidate },
            select: { id: true },
          });
          if (!existing) {
            quoteNumber = candidate;
            break;
          }
          candidateNum += 1;
        }
      } else {
        const existing = await fastify.prisma.quote.findFirst({
          where: { organizationId, quoteNumber },
          select: { id: true },
        });
        if (existing) {
          return reply.code(409).send({
            error: `Quote number '${quoteNumber}' already exists in this organization.`,
          });
        }
      }

      // 3. Process line items with GST calculations
      const processedLineItems = lineItems.map((li) => {
        const lineTotalRaw = BigInt(li.unitPriceCents) * BigInt(li.quantity);
        const gstResult = calculateGST(lineTotalRaw, li.taxTreatment);
        return {
          itemId: li.itemId || null,
          accountId: li.accountId || null,
          trackingOptionId: li.trackingOptionId || null,
          description: li.description,
          quantity: li.quantity,
          unitPriceCents: BigInt(li.unitPriceCents),
          amountCents: gstResult.subtotalCents,
          taxTreatment: li.taxTreatment,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
        };
      });

      const totalResult = sumGSTResults(
        processedLineItems.map((li) => ({
          subtotalCents: li.amountCents,
          gstCents: li.gstCents,
          totalCents: li.totalCents,
        })),
      );

      const createdQuote = await fastify.prisma.quote.create({
        data: {
          organizationId,
          contactId,
          quoteNumber,
          issueDate: new Date(issueDate),
          expiryDate: new Date(expiryDate),
          status,
          subtotalCents: totalResult.subtotalCents,
          gstCents: totalResult.gstCents,
          totalCents: totalResult.totalCents,
          notes: notes ?? null,
          createdByUserId: request.user.userId,
          lineItems: {
            create: processedLineItems.map((li) => ({
              organizationId,
              itemId: li.itemId,
              accountId: li.accountId,
              trackingOptionId: li.trackingOptionId,
              description: li.description,
              quantity: li.quantity,
              unitPriceCents: li.unitPriceCents,
              amountCents: li.amountCents,
              taxTreatment: li.taxTreatment,
              gstCents: li.gstCents,
              totalCents: li.totalCents,
            })),
          },
        },
        include: {
          contact: true,
          lineItems: true,
        },
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'QUOTE_CREATED',
        entityType: 'QUOTE',
        entityId: createdQuote.id,
        summary: `Created quote ${createdQuote.quoteNumber} for ${contact.name} ($${(Number(totalResult.totalCents) / 100).toFixed(2)})`,
      });

      return reply.code(201).send({ quote: serializeQuote(createdQuote) });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/quotes/:id — Get single quote details
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/quotes/:id',
    {
      preHandler: [
        requireRole(
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AUDITOR,
        ),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid quote ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const quote = await fastify.prisma.quote.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lineItems: true,
        },
      });

      if (!quote) {
        return reply.code(404).send({ error: 'Quote not found' });
      }

      return reply.code(200).send({ quote: serializeQuote(quote) });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/quotes/:id — Update quote
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/v1/quotes/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid quote ID format' });
      }

      const bodyParse = UpdateQuoteBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const quote = await fastify.prisma.quote.findFirst({
        where: { id, organizationId },
      });
      if (!quote) {
        return reply.code(404).send({ error: 'Quote not found' });
      }

      if (quote.status === QuoteStatus.INVOICED) {
        return reply.code(400).send({
          error: 'Cannot modify a quote that has already been converted to an invoice.',
        });
      }

      const dataToUpdate: any = {};
      if (bodyParse.data.contactId) dataToUpdate.contactId = bodyParse.data.contactId;
      if (bodyParse.data.issueDate) dataToUpdate.issueDate = new Date(bodyParse.data.issueDate);
      if (bodyParse.data.expiryDate) dataToUpdate.expiryDate = new Date(bodyParse.data.expiryDate);
      if (bodyParse.data.notes !== undefined) dataToUpdate.notes = bodyParse.data.notes;
      if (bodyParse.data.status) dataToUpdate.status = bodyParse.data.status;

      let processedLineItems: any = null;
      let totalResult: any = null;

      if (bodyParse.data.lineItems) {
        processedLineItems = bodyParse.data.lineItems.map((li) => {
          const lineTotalRaw = BigInt(li.unitPriceCents) * BigInt(li.quantity);
          const gstResult = calculateGST(lineTotalRaw, li.taxTreatment);
          return {
            itemId: li.itemId || null,
            accountId: li.accountId || null,
            trackingOptionId: li.trackingOptionId || null,
            description: li.description,
            quantity: li.quantity,
            unitPriceCents: BigInt(li.unitPriceCents),
            amountCents: gstResult.subtotalCents,
            taxTreatment: li.taxTreatment,
            gstCents: gstResult.gstCents,
            totalCents: gstResult.totalCents,
          };
        });

        totalResult = sumGSTResults(
          processedLineItems.map((li: any) => ({
            subtotalCents: li.amountCents,
            gstCents: li.gstCents,
            totalCents: li.totalCents,
          })),
        );

        dataToUpdate.subtotalCents = totalResult.subtotalCents;
        dataToUpdate.gstCents = totalResult.gstCents;
        dataToUpdate.totalCents = totalResult.totalCents;
      }

      const updatedQuote = await fastify.prisma.$transaction(async (tx) => {
        if (processedLineItems) {
          await tx.quoteLineItem.deleteMany({
            where: { quoteId: quote.id, organizationId },
          });
          await tx.quoteLineItem.createMany({
            data: processedLineItems.map((li: any) => ({
              quoteId: quote.id,
              organizationId,
              itemId: li.itemId,
              accountId: li.accountId,
              trackingOptionId: li.trackingOptionId,
              description: li.description,
              quantity: li.quantity,
              unitPriceCents: li.unitPriceCents,
              amountCents: li.amountCents,
              taxTreatment: li.taxTreatment,
              gstCents: li.gstCents,
              totalCents: li.totalCents,
            })),
          });
        }

        return tx.quote.update({
          where: { id: quote.id },
          data: dataToUpdate,
          include: { contact: true, lineItems: true },
        });
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'QUOTE_UPDATED',
        entityType: 'QUOTE',
        entityId: quote.id,
        summary: `Updated quote ${quote.quoteNumber} (status: ${updatedQuote.status})`,
      });

      return reply.code(200).send({ quote: serializeQuote(updatedQuote) });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/quotes/:id — Delete quote
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/v1/quotes/:id',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid quote ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const quote = await fastify.prisma.quote.findFirst({
        where: { id, organizationId },
      });
      if (!quote) {
        return reply.code(404).send({ error: 'Quote not found' });
      }

      if (quote.status === QuoteStatus.INVOICED) {
        return reply.code(400).send({
          error: 'Cannot delete an invoiced quote.',
        });
      }

      await fastify.prisma.quote.delete({
        where: { id: quote.id },
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'QUOTE_DELETED',
        entityType: 'QUOTE',
        entityId: quote.id,
        summary: `Deleted quote ${quote.quoteNumber}`,
      });

      return reply.code(200).send({ success: true, message: 'Quote deleted successfully' });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/quotes/:id/convert-to-invoice — 1-Click Convert Quote to Invoice
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/quotes/:id/convert-to-invoice',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid quote ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const quote = await fastify.prisma.quote.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lineItems: true,
        },
      });

      if (!quote) {
        return reply.code(404).send({ error: 'Quote not found' });
      }

      if (quote.status === QuoteStatus.INVOICED) {
        return reply.code(400).send({
          error: 'This quote has already been converted to an invoice.',
        });
      }

      // Generate invoice number
      const invoiceCount = await fastify.prisma.invoice.count({ where: { organizationId } });
      let candidateNum = 1001 + invoiceCount;
      let invoiceNumber = '';
      while (true) {
        const candidate = `INV-${candidateNum.toString().padStart(4, '0')}`;
        const existing = await fastify.prisma.invoice.findFirst({
          where: { organizationId, invoiceNumber: candidate },
          select: { id: true },
        });
        if (!existing) {
          invoiceNumber = candidate;
          break;
        }
        candidateNum += 1;
      }

      const issueDate = new Date();
      const termsDays = quote.contact.paymentTermsDays || 30;
      const dueDate = new Date(issueDate.getTime() + termsDays * 24 * 60 * 60 * 1000);

      const result = await fastify.prisma.$transaction(async (tx) => {
        const createdInvoice = await tx.invoice.create({
          data: {
            organizationId,
            contactId: quote.contactId,
            invoiceNumber,
            quoteId: quote.id,
            issueDate,
            dueDate,
            status: InvoiceStatus.DRAFT,
            subtotalCents: quote.subtotalCents,
            gstCents: quote.gstCents,
            totalCents: quote.totalCents,
            amountPaidCents: 0n,
            notes: quote.notes ? `Converted from Quote ${quote.quoteNumber}. ${quote.notes}` : `Converted from Quote ${quote.quoteNumber}`,
            createdByUserId: request.user.userId,
            lineItems: {
              create: quote.lineItems.map((li) => ({
                organizationId,
                itemId: li.itemId,
                accountId: li.accountId,
                trackingOptionId: li.trackingOptionId,
                description: li.description,
                quantity: li.quantity,
                unitPriceCents: li.unitPriceCents,
                amountCents: li.amountCents,
                taxTreatment: li.taxTreatment,
                gstCents: li.gstCents,
                totalCents: li.totalCents,
              })),
            },
          },
          include: {
            contact: true,
            lineItems: true,
          },
        });

        await tx.quote.update({
          where: { id: quote.id },
          data: {
            status: QuoteStatus.INVOICED,
            convertedInvoiceId: createdInvoice.id,
          },
        });

        await recordAuditLog(tx, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'QUOTE_CONVERTED_TO_INVOICE',
          entityType: 'QUOTE',
          entityId: quote.id,
          summary: `Converted quote ${quote.quoteNumber} into invoice ${createdInvoice.invoiceNumber}`,
        });

        return createdInvoice;
      });

      return reply.code(201).send({ invoice: serializeQuote(result) });
    },
  );
};

export { quoteRoutes };
export default quoteRoutes;

