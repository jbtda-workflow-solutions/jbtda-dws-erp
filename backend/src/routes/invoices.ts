/**
 * Invoices routes — Phase 6 Accounts Receivable (AR)
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET  /api/v1/invoices       (List invoices with customer, status, search filters)
 *  - POST /api/v1/invoices       (Create draft invoice with line items & GST calculation)
 *  - GET  /api/v1/invoices/:id   (Get invoice details with line items and journal entries)
 *  - POST /api/v1/invoices/:id/issue (Issue draft invoice with atomic double-entry GL posting)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireOrgAuth, requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { EntryType, InvoiceStatus, Role, TaxTreatment } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);
const InvoiceStatusEnum = z.nativeEnum(InvoiceStatus);

const LineItemInput = z.object({
  description: z.string().trim().min(1).max(255),
  amountCents: z.number().int().positive(),
  taxTreatment: TaxTreatmentEnum,
});

const CreateInvoiceBody = z.object({
  contactId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1).max(50).optional(),
  issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().trim().max(1000).nullable().optional(),
  lineItems: z.array(LineItemInput).min(1),
});

const ListInvoicesQuery = z.object({
  status: InvoiceStatusEnum.optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

/**
 * Helper to serialize BigInt fields to numbers in JSON responses
 */
function serializeInvoice<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

const invoiceRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/invoices — List organization invoices
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/invoices',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const parse = ListInvoicesQuery.safeParse(request.query);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { status, contactId, search } = parse.data;
      const organizationId = request.user.organizationId!;

      const whereClause: any = {
        organizationId,
      };

      if (status) {
        whereClause.status = status;
      }

      if (contactId) {
        whereClause.contactId = contactId;
      }

      if (search && search.length > 0) {
        whereClause.OR = [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { contact: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const invoices = await fastify.prisma.invoice.findMany({
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

      return reply.code(200).send({ invoices: serializeInvoice(invoices) });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/invoices — Create a draft customer invoice
  // Allowed roles: ADMIN, ACCOUNTANT, AR_SPECIALIST
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/invoices',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const parse = CreateInvoiceBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const {
        contactId,
        invoiceNumber: customInvoiceNumber,
        issueDate,
        dueDate,
        notes,
        lineItems,
      } = parse.data;
      const organizationId = request.user.organizationId!;

      // 1. Verify contact exists and belongs to this organization
      const contact = await fastify.prisma.contact.findFirst({
        where: { id: contactId, organizationId },
      });

      if (!contact) {
        return reply.code(400).send({ error: 'Contact not found' });
      }

      if (contact.type === 'VENDOR') {
        return reply.code(400).send({
          error:
            'Cannot issue an invoice to a VENDOR contact. Contact must be CUSTOMER or BOTH.',
        });
      }

      // 2. Generate or validate invoice number
      let invoiceNumber = customInvoiceNumber;
      if (!invoiceNumber) {
        const count = await fastify.prisma.invoice.count({
          where: { organizationId },
        });
        let candidateNum = 1001 + count;
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
      } else {
        const existing = await fastify.prisma.invoice.findFirst({
          where: { organizationId, invoiceNumber },
          select: { id: true },
        });
        if (existing) {
          return reply.code(409).send({
            error: `Invoice number '${invoiceNumber}' already exists in this organization.`,
          });
        }
      }

      // 3. Compute GST and aggregate totals using integer arithmetic
      const processedLineItems = lineItems.map((item) => {
        const gstResult = calculateGST(
          BigInt(item.amountCents),
          item.taxTreatment,
        );
        return {
          description: item.description,
          taxTreatment: item.taxTreatment,
          amountCents: gstResult.subtotalCents,
          gstCents: gstResult.gstCents,
          totalCents: gstResult.totalCents,
        };
      });

      const totalResult = sumGSTResults(
        processedLineItems.map((item) => ({
          subtotalCents: item.amountCents,
          gstCents: item.gstCents,
          totalCents: item.totalCents,
        })),
      );

      const parsedIssueDate = new Date(issueDate);
      const parsedDueDate = new Date(dueDate);

      // 4. Create Draft Invoice with line items
      const createdInvoice = await fastify.prisma.invoice.create({
        data: {
          organizationId,
          contactId,
          invoiceNumber,
          issueDate: parsedIssueDate,
          dueDate: parsedDueDate,
          status: InvoiceStatus.DRAFT,
          subtotalCents: totalResult.subtotalCents,
          gstCents: totalResult.gstCents,
          totalCents: totalResult.totalCents,
          amountPaidCents: 0n,
          notes: notes ?? null,
          lineItems: {
            create: processedLineItems.map((li) => ({
              organizationId,
              description: li.description,
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

      return reply.code(201).send({ invoice: serializeInvoice(createdInvoice) });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/invoices/:id — Get single invoice details
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/invoices/:id',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invoice ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id, organizationId },
        include: {
          contact: true,
          lineItems: true,
          paymentsIn: true,
        },
      });

      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      // Find associated GL entry (created upon issuance)
      const journalEntry = await fastify.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          referenceType: 'INVOICE',
          referenceId: invoice.id,
        },
        include: {
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      return reply.code(200).send({
        invoice: serializeInvoice(invoice),
        journalEntry: journalEntry ? serializeInvoice(journalEntry) : null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/invoices/:id/issue — Issue a draft invoice & post to General Ledger
  // Allowed roles: ADMIN, ACCOUNTANT, AR_SPECIALIST
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/invoices/:id/issue',
    {
      preHandler: [
        requireRole(Role.ADMIN, Role.ACCOUNTANT, Role.AR_SPECIALIST),
      ],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid invoice ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      // 1. Fetch invoice and verify it is in DRAFT status
      const invoice = await fastify.prisma.invoice.findFirst({
        where: { id, organizationId },
        include: { contact: true },
      });

      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      if (invoice.status !== InvoiceStatus.DRAFT) {
        return reply.code(400).send({
          error: `Cannot issue invoice in '${invoice.status}' status. Only DRAFT invoices can be issued.`,
        });
      }

      // 2. Fetch Chart of Accounts entries required for AR posting
      // Code 1200: Accounts Receivable (ASSET - Normal Balance DEBIT)
      // Code 4000: Sales Revenue (REVENUE - Normal Balance CREDIT)
      // Code 2100: GST Collected (Sales) (LIABILITY - Normal Balance CREDIT)
      const accounts = await fastify.prisma.account.findMany({
        where: {
          organizationId,
          code: { in: ['1200', '4000', '2100'] },
          isActive: true,
        },
      });

      const arAccount = accounts.find((a) => a.code === '1200');
      const revenueAccount = accounts.find((a) => a.code === '4000');
      const gstCollectedAccount = accounts.find((a) => a.code === '2100');

      if (!arAccount || !revenueAccount || !gstCollectedAccount) {
        return reply.code(500).send({
          error:
            'Required Chart of Accounts entries (1200 Accounts Receivable, 4000 Sales Revenue, 2100 GST Collected) are missing for this organization.',
        });
      }

      // 3. Atomic Transaction: Transition to ISSUED + Create JournalEntry + JournalLines
      const result = await fastify.prisma.$transaction(async (tx) => {
        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.ISSUED,
          },
          include: {
            contact: true,
            lineItems: true,
            paymentsIn: true,
          },
        });

        // Double-entry GL lines:
        // - DEBIT Accounts Receivable (1200) for totalCents
        // - CREDIT Sales Revenue (4000) for subtotalCents
        // - CREDIT GST Collected (2100) for gstCents (if gstCents > 0)
        const journalLinesData: Array<{
          organizationId: string;
          accountId: string;
          entryType: EntryType;
          amountCents: bigint;
        }> = [];

        if (invoice.totalCents > 0n) {
          journalLinesData.push({
            organizationId,
            accountId: arAccount.id,
            entryType: EntryType.DEBIT,
            amountCents: invoice.totalCents,
          });
        }

        if (invoice.subtotalCents > 0n) {
          journalLinesData.push({
            organizationId,
            accountId: revenueAccount.id,
            entryType: EntryType.CREDIT,
            amountCents: invoice.subtotalCents,
          });
        }

        if (invoice.gstCents > 0n) {
          journalLinesData.push({
            organizationId,
            accountId: gstCollectedAccount.id,
            entryType: EntryType.CREDIT,
            amountCents: invoice.gstCents,
          });
        }

        // Verify Double-Entry Balance Invariant: sum(DEBITS) == sum(CREDITS)
        const debitSum = journalLinesData
          .filter((l) => l.entryType === EntryType.DEBIT)
          .reduce((sum, l) => sum + l.amountCents, 0n);

        const creditSum = journalLinesData
          .filter((l) => l.entryType === EntryType.CREDIT)
          .reduce((sum, l) => sum + l.amountCents, 0n);

        if (debitSum !== creditSum) {
          throw new Error(
            `General Ledger imbalance on invoice issuance: Debits (${debitSum}) != Credits (${creditSum})`,
          );
        }

        let journalEntry = null;
        if (journalLinesData.length > 0) {
          journalEntry = await tx.journalEntry.create({
            data: {
              organizationId,
              description: `Invoice ${invoice.invoiceNumber} to ${invoice.contact.name}`,
              referenceType: 'INVOICE',
              referenceId: invoice.id,
              postedAt: invoice.issueDate,
              lines: {
                create: journalLinesData,
              },
            },
            include: {
              lines: {
                include: { account: true },
              },
            },
          });
        }

        return { invoice: updatedInvoice, journalEntry };
      });

      return reply.code(200).send({
        invoice: serializeInvoice(result.invoice),
        journalEntry: result.journalEntry ? serializeInvoice(result.journalEntry) : null,
      });
    },
  );
};

export default invoiceRoutes;

