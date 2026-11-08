/**
 * Products & Services Catalog routes — Module 3 Items Catalog API
 *
 * Scoped strictly to request.user.organizationId for multi-tenant isolation.
 * Supported routes:
 *  - GET    /api/v1/items       (List catalog items with search, type filter & account details)
 *  - POST   /api/v1/items       (Create a product or service with sales/purchase defaults)
 *  - GET    /api/v1/items/:id   (Get single item details with linked accounts)
 *  - PATCH  /api/v1/items/:id   (Update item details, prices, or GL accounts)
 *  - DELETE /api/v1/items/:id   (Archive or delete item if zero historical usage)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { recordAuditLog } from '../lib/audit.js';
import { TaxTreatment, Role, AccountType } from '@prisma/client';

const TaxTreatmentEnum = z.nativeEnum(TaxTreatment);

function serializeItem<T extends Record<string, any>>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value,
    ),
  );
}

const ListItemsQuery = z.object({
  type: z.enum(['ALL', 'SALES', 'PURCHASE']).optional().default('ALL'),
  search: z.string().trim().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional()
    .default('false'),
});

const CreateItemBody = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(2).max(100),
  isSold: z.boolean().default(true),
  saleDescription: z.string().trim().max(500).nullable().optional(),
  saleUnitPriceCents: z.number().int().min(0).default(0),
  saleTaxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
  incomeAccountId: z.string().uuid().nullable().optional(),
  isPurchased: z.boolean().default(true),
  purchaseDescription: z.string().trim().max(500).nullable().optional(),
  purchaseUnitPriceCents: z.number().int().min(0).default(0),
  purchaseTaxTreatment: TaxTreatmentEnum.default(TaxTreatment.TAX_EXCLUSIVE),
  expenseAccountId: z.string().uuid().nullable().optional(),
  isTrackedInventory: z.boolean().default(false),
});

const UpdateItemBody = z.object({
  code: z.string().trim().min(1).max(50).optional(),
  name: z.string().trim().min(2).max(100).optional(),
  isSold: z.boolean().optional(),
  saleDescription: z.string().trim().max(500).nullable().optional(),
  saleUnitPriceCents: z.number().int().min(0).optional(),
  saleTaxTreatment: TaxTreatmentEnum.optional(),
  incomeAccountId: z.string().uuid().nullable().optional(),
  isPurchased: z.boolean().optional(),
  purchaseDescription: z.string().trim().max(500).nullable().optional(),
  purchaseUnitPriceCents: z.number().int().min(0).optional(),
  purchaseTaxTreatment: TaxTreatmentEnum.optional(),
  expenseAccountId: z.string().uuid().nullable().optional(),
  isTrackedInventory: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const ParamsWithId = z.object({
  id: z.string().uuid(),
});

const itemRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/items — List catalog products and services
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/items',
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
      const parse = ListItemsQuery.safeParse(request.query);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { type, search, includeInactive } = parse.data;
      const organizationId = request.user.organizationId!;

      const whereClause: {
        organizationId: string;
        isActive?: boolean;
        isSold?: boolean;
        isPurchased?: boolean;
        OR?: Array<{
          code?: { contains: string; mode: 'insensitive' };
          name?: { contains: string; mode: 'insensitive' };
          saleDescription?: { contains: string; mode: 'insensitive' };
          purchaseDescription?: { contains: string; mode: 'insensitive' };
        }>;
      } = {
        organizationId,
      };

      if (!includeInactive) {
        whereClause.isActive = true;
      }

      if (type === 'SALES') {
        whereClause.isSold = true;
      } else if (type === 'PURCHASE') {
        whereClause.isPurchased = true;
      }

      if (search && search.length > 0) {
        whereClause.OR = [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { saleDescription: { contains: search, mode: 'insensitive' } },
          { purchaseDescription: { contains: search, mode: 'insensitive' } },
        ];
      }

      const items = await fastify.prisma.item.findMany({
        where: whereClause,
        orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      });

      // Gather account IDs to load linked names
      const accountIds = new Set<string>();
      for (const item of items) {
        if (item.incomeAccountId) accountIds.add(item.incomeAccountId);
        if (item.expenseAccountId) accountIds.add(item.expenseAccountId);
      }

      const accounts = await fastify.prisma.account.findMany({
        where: { id: { in: Array.from(accountIds) } },
        select: { id: true, code: true, name: true, type: true },
      });

      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const enriched = items.map((item) => ({
        ...item,
        incomeAccount: item.incomeAccountId ? accountMap.get(item.incomeAccountId) ?? null : null,
        expenseAccount: item.expenseAccountId ? accountMap.get(item.expenseAccountId) ?? null : null,
      }));

      return reply.code(200).send({ items: serializeItem(enriched) });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/items — Create catalog item
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/items',
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
      const parse = CreateItemBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const organizationId = request.user.organizationId!;
      const data = parse.data;

      // Check code uniqueness per organization
      const existing = await fastify.prisma.item.findUnique({
        where: {
          organizationId_code: {
            organizationId,
            code: data.code,
          },
        },
      });

      if (existing) {
        return reply.code(400).send({
          error: `An item with code "${data.code}" already exists in this organization.`,
        });
      }

      // Validate income account if provided
      if (data.incomeAccountId) {
        const incAcc = await fastify.prisma.account.findFirst({
          where: { id: data.incomeAccountId, organizationId, isActive: true },
        });
        if (!incAcc || incAcc.type !== AccountType.REVENUE) {
          return reply.code(400).send({
            error: 'Selected income account does not exist or is not a REVENUE account.',
          });
        }
      }

      // Validate expense account if provided
      if (data.expenseAccountId) {
        const expAcc = await fastify.prisma.account.findFirst({
          where: { id: data.expenseAccountId, organizationId, isActive: true },
        });
        if (!expAcc || expAcc.type !== AccountType.EXPENSE) {
          return reply.code(400).send({
            error: 'Selected expense account does not exist or is not an EXPENSE account.',
          });
        }
      }

      const item = await fastify.prisma.item.create({
        data: {
          organizationId,
          code: data.code,
          name: data.name,
          isSold: data.isSold,
          saleDescription: data.saleDescription ?? null,
          saleUnitPriceCents: BigInt(data.saleUnitPriceCents),
          saleTaxTreatment: data.saleTaxTreatment,
          incomeAccountId: data.incomeAccountId ?? null,
          isPurchased: data.isPurchased,
          purchaseDescription: data.purchaseDescription ?? null,
          purchaseUnitPriceCents: BigInt(data.purchaseUnitPriceCents),
          purchaseTaxTreatment: data.purchaseTaxTreatment,
          expenseAccountId: data.expenseAccountId ?? null,
          isTrackedInventory: data.isTrackedInventory,
          isActive: true,
        },
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'ITEM_CREATED',
        entityType: 'ITEM',
        entityId: item.id,
        summary: `Created catalog item "${item.code} — ${item.name}"`,
      });

      return reply.code(201).send({ item: serializeItem(item) });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/items/:id — Get single item details
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/items/:id',
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
        return reply.code(400).send({ error: 'Invalid item ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const item = await fastify.prisma.item.findFirst({
        where: { id, organizationId },
      });

      if (!item) {
        return reply.code(404).send({ error: 'Catalog item not found' });
      }

      let incomeAccount = null;
      if (item.incomeAccountId) {
        incomeAccount = await fastify.prisma.account.findUnique({
          where: { id: item.incomeAccountId },
          select: { id: true, code: true, name: true, type: true },
        });
      }

      let expenseAccount = null;
      if (item.expenseAccountId) {
        expenseAccount = await fastify.prisma.account.findUnique({
          where: { id: item.expenseAccountId },
          select: { id: true, code: true, name: true, type: true },
        });
      }

      return reply.code(200).send({
        item: serializeItem({
          ...item,
          incomeAccount,
          expenseAccount,
        }),
      });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/v1/items/:id — Update catalog item
  // -------------------------------------------------------------------------
  fastify.patch(
    '/api/v1/items/:id',
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
        return reply.code(400).send({ error: 'Invalid item ID format' });
      }

      const parse = UpdateItemBody.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: parse.error.flatten().fieldErrors,
        });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;
      const data = parse.data;

      const existing = await fastify.prisma.item.findFirst({
        where: { id, organizationId },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Catalog item not found' });
      }

      // Check code uniqueness if code changed
      if (data.code && data.code !== existing.code) {
        const codeConflict = await fastify.prisma.item.findUnique({
          where: {
            organizationId_code: {
              organizationId,
              code: data.code,
            },
          },
        });
        if (codeConflict) {
          return reply.code(400).send({
            error: `An item with code "${data.code}" already exists in this organization.`,
          });
        }
      }

      // Validate income account if updated
      if (data.incomeAccountId !== undefined && data.incomeAccountId !== null) {
        const incAcc = await fastify.prisma.account.findFirst({
          where: { id: data.incomeAccountId, organizationId, isActive: true },
        });
        if (!incAcc || incAcc.type !== AccountType.REVENUE) {
          return reply.code(400).send({
            error: 'Selected income account does not exist or is not a REVENUE account.',
          });
        }
      }

      // Validate expense account if updated
      if (data.expenseAccountId !== undefined && data.expenseAccountId !== null) {
        const expAcc = await fastify.prisma.account.findFirst({
          where: { id: data.expenseAccountId, organizationId, isActive: true },
        });
        if (!expAcc || expAcc.type !== AccountType.EXPENSE) {
          return reply.code(400).send({
            error: 'Selected expense account does not exist or is not an EXPENSE account.',
          });
        }
      }

      const updated = await fastify.prisma.item.update({
        where: { id },
        data: {
          ...(data.code ? { code: data.code } : {}),
          ...(data.name ? { name: data.name } : {}),
          ...(data.isSold !== undefined ? { isSold: data.isSold } : {}),
          ...(data.saleDescription !== undefined ? { saleDescription: data.saleDescription } : {}),
          ...(data.saleUnitPriceCents !== undefined ? { saleUnitPriceCents: BigInt(data.saleUnitPriceCents) } : {}),
          ...(data.saleTaxTreatment ? { saleTaxTreatment: data.saleTaxTreatment } : {}),
          ...(data.incomeAccountId !== undefined ? { incomeAccountId: data.incomeAccountId } : {}),
          ...(data.isPurchased !== undefined ? { isPurchased: data.isPurchased } : {}),
          ...(data.purchaseDescription !== undefined ? { purchaseDescription: data.purchaseDescription } : {}),
          ...(data.purchaseUnitPriceCents !== undefined ? { purchaseUnitPriceCents: BigInt(data.purchaseUnitPriceCents) } : {}),
          ...(data.purchaseTaxTreatment ? { purchaseTaxTreatment: data.purchaseTaxTreatment } : {}),
          ...(data.expenseAccountId !== undefined ? { expenseAccountId: data.expenseAccountId } : {}),
          ...(data.isTrackedInventory !== undefined ? { isTrackedInventory: data.isTrackedInventory } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'ITEM_UPDATED',
        entityType: 'ITEM',
        entityId: updated.id,
        summary: `Updated catalog item "${updated.code} — ${updated.name}"`,
      });

      return reply.code(200).send({ item: serializeItem(updated) });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/items/:id — Archive or clean delete catalog item
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/v1/items/:id',
    {
      preHandler: [requireRole(Role.ADMIN, Role.ACCOUNTANT)],
    },
    async (request, reply) => {
      const paramParse = ParamsWithId.safeParse(request.params);
      if (!paramParse.success) {
        return reply.code(400).send({ error: 'Invalid item ID format' });
      }

      const { id } = paramParse.data;
      const organizationId = request.user.organizationId!;

      const item = await fastify.prisma.item.findFirst({
        where: { id, organizationId },
      });

      if (!item) {
        return reply.code(404).send({ error: 'Catalog item not found' });
      }

      // Check for usage in sub-ledger line items
      const [invoiceUsage, billUsage, quoteUsage, poUsage] = await Promise.all([
        fastify.prisma.invoiceLineItem.count({ where: { itemId: id, organizationId } }),
        fastify.prisma.billLineItem.count({ where: { itemId: id, organizationId } }),
        fastify.prisma.quoteLineItem.count({ where: { itemId: id, organizationId } }),
        fastify.prisma.purchaseOrderLineItem.count({ where: { itemId: id, organizationId } }),
      ]);

      const totalUsage = invoiceUsage + billUsage + quoteUsage + poUsage;

      if (totalUsage > 0) {
        // Referenced in documents — mark inactive
        await fastify.prisma.item.update({
          where: { id },
          data: { isActive: false },
        });

        await recordAuditLog(fastify.prisma, {
          organizationId,
          actorUserId: request.user.userId,
          action: 'ITEM_ARCHIVED',
          entityType: 'ITEM',
          entityId: item.id,
          summary: `Archived catalog item "${item.code}" (referenced in past documents)`,
        });

        return reply.send({
          ok: true,
          message: `Item "${item.code}" was archived because it is referenced in past transactions.`,
        });
      }

      // Unused — clean delete
      await fastify.prisma.item.delete({ where: { id } });

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'ITEM_DELETED',
        entityType: 'ITEM',
        entityId: item.id,
        summary: `Deleted catalog item "${item.code}"`,
      });

      return reply.send({
        ok: true,
        message: `Item "${item.code}" was deleted successfully.`,
      });
    },
  );
};

export default itemRoutes;

