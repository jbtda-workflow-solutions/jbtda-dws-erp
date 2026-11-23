/**
 * Global Cross-Module Search API — Stage 17 (Wave 0).
 *
 * Scoped strictly to `request.user.organizationId` and filtered by both the
 * user's RBAC `role` and the organization's `enabledModules`.
 *
 * Supported route:
 *  - GET /api/v1/search?q=<query>&limit=<n>
 *
 * Supports text matching (names, document numbers, references, account codes,
 * ABNs, descriptions) AND exact AUD dollar-amount matching (e.g. "$450.00" or "450").
 */

import type { FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { requireOrgAuth } from '../plugins/auth.js';
import { isModuleEnabled } from '../lib/modules.js';

export type SearchResultCategory =
  | 'CONTACT'
  | 'INVOICE'
  | 'QUOTE'
  | 'BILL'
  | 'PURCHASE_ORDER'
  | 'EXPENSE_CLAIM'
  | 'DIRECT_TRANSACTION'
  | 'ACCOUNT'
  | 'JOURNAL'
  | 'ITEM';

export interface GlobalSearchResult {
  id: string;
  category: SearchResultCategory;
  title: string;
  subtitle: string;
  href: string;
  status?: string;
  amountCents?: number;
  date?: string;
}

/**
 * Parses an optional AUD dollar query string (e.g. "$450.00", "450.5", "1,200")
 * into integer cents (`BigInt`), or returns `null` if the query is not numeric.
 */
function parseAmountQueryCents(raw: string): bigint | null {
  const cleaned = raw.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000) return null;
  return BigInt(Math.round(parsed * 100));
}

export const searchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/v1/search',
    { preHandler: [requireOrgAuth] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const role = request.user.role!;
      const userId = request.user.userId;

      const rawQ = (request.query.q ?? '').trim();
      if (rawQ.length < 2) {
        return reply.send({ query: rawQ, results: [] });
      }

      const requestedLimit = Number(request.query.limit ?? 20);
      const maxTotal = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 20, 5), 40);
      const perDomainLimit = Math.max(3, Math.ceil(maxTotal / 4));

      const org = await fastify.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { enabledModules: true },
      });
      if (!org) {
        return reply.code(404).send({ error: 'Organization not found.' });
      }

      const enabled = org.enabledModules;
      const amountCents = parseAmountQueryCents(rawQ);
      const results: GlobalSearchResult[] = [];

      const canReadContacts = (
        [
          Role.ADMIN,
          Role.ACCOUNTANT,
          Role.MANAGER,
          Role.AR_SPECIALIST,
          Role.AP_SPECIALIST,
          Role.AUDITOR,
        ] as Role[]
      ).includes(role);

      const canReadAccountsOrLedger = (
        [Role.ADMIN, Role.ACCOUNTANT, Role.AUDITOR] as Role[]
      ).includes(role);

      const canReadReceivables =
        isModuleEnabled(enabled, 'RECEIVABLES') &&
        (
          [
            Role.ADMIN,
            Role.ACCOUNTANT,
            Role.MANAGER,
            Role.AR_SPECIALIST,
            Role.AUDITOR,
          ] as Role[]
        ).includes(role);

      const canReadPayables =
        isModuleEnabled(enabled, 'PAYABLES') &&
        (
          [
            Role.ADMIN,
            Role.ACCOUNTANT,
            Role.MANAGER,
            Role.AP_SPECIALIST,
            Role.AUDITOR,
          ] as Role[]
        ).includes(role);

      const canReadExpenses = isModuleEnabled(enabled, 'EXPENSES');
      const canReadAllExpenses =
        canReadExpenses &&
        (
          [
            Role.ADMIN,
            Role.ACCOUNTANT,
            Role.MANAGER,
            Role.AP_SPECIALIST,
            Role.AUDITOR,
          ] as Role[]
        ).includes(role);

      const tasks: Array<Promise<void>> = [];

      // 1. Contacts
      if (canReadContacts) {
        tasks.push(
          fastify.prisma.contact
            .findMany({
              where: {
                organizationId,
                OR: [
                  { name: { contains: rawQ, mode: 'insensitive' } },
                  { legalName: { contains: rawQ, mode: 'insensitive' } },
                  { email: { contains: rawQ, mode: 'insensitive' } },
                  { abn: { contains: rawQ.replace(/\s/g, ''), mode: 'insensitive' } },
                ],
              },
              take: perDomainLimit,
              orderBy: { name: 'asc' },
              select: { id: true, name: true, type: true, email: true, abn: true },
            })
            .then((rows) => {
              for (const c of rows) {
                results.push({
                  id: c.id,
                  category: 'CONTACT',
                  title: c.name,
                  subtitle: [c.type, c.email, c.abn ? `ABN ${c.abn}` : null]
                    .filter(Boolean)
                    .join(' · '),
                  href: '/contacts',
                  status: c.type,
                });
              }
            }),
        );
      }

      // 2. Items & Services Catalog
      if (role !== Role.EMPLOYEE) {
        tasks.push(
          fastify.prisma.item
            .findMany({
              where: {
                organizationId,
                OR: [
                  { code: { contains: rawQ, mode: 'insensitive' } },
                  { name: { contains: rawQ, mode: 'insensitive' } },
                ],
              },
              take: perDomainLimit,
              orderBy: { code: 'asc' },
              select: {
                id: true,
                code: true,
                name: true,
                saleUnitPriceCents: true,
                purchaseUnitPriceCents: true,
                isSold: true,
              },
            })
            .then((rows) => {
              for (const item of rows) {
                results.push({
                  id: item.id,
                  category: 'ITEM',
                  title: `${item.code} — ${item.name}`,
                  subtitle: item.isSold ? 'Sales / Catalog Item' : 'Purchase Item',
                  href: '/items',
                  amountCents: Number(
                    item.isSold ? item.saleUnitPriceCents : item.purchaseUnitPriceCents,
                  ),
                });
              }
            }),
        );
      }

      // 3. Chart of Accounts
      if (canReadAccountsOrLedger) {
        tasks.push(
          fastify.prisma.account
            .findMany({
              where: {
                organizationId,
                OR: [
                  { code: { contains: rawQ, mode: 'insensitive' } },
                  { name: { contains: rawQ, mode: 'insensitive' } },
                ],
              },
              take: perDomainLimit,
              orderBy: { code: 'asc' },
              select: { id: true, code: true, name: true, type: true, isSystem: true },
            })
            .then((rows) => {
              for (const acc of rows) {
                results.push({
                  id: acc.id,
                  category: 'ACCOUNT',
                  title: `${acc.code} ${acc.name}`,
                  subtitle: `${acc.type}${acc.isSystem ? ' · System Account' : ''}`,
                  href: '/accounts',
                  status: acc.type,
                });
              }
            }),
        );
      }

      // 4. Customer Invoices & Quotes (RECEIVABLES)
      if (canReadReceivables) {
        tasks.push(
          fastify.prisma.invoice
            .findMany({
              where: {
                organizationId,
                OR: [
                  { invoiceNumber: { contains: rawQ, mode: 'insensitive' } },
                  { notes: { contains: rawQ, mode: 'insensitive' } },
                  { contact: { name: { contains: rawQ, mode: 'insensitive' } } },
                  ...(amountCents !== null ? [{ totalCents: amountCents }] : []),
                ],
              },
              take: perDomainLimit,
              orderBy: { issueDate: 'desc' },
              select: {
                id: true,
                invoiceNumber: true,
                status: true,
                totalCents: true,
                issueDate: true,
                contact: { select: { name: true } },
              },
            })
            .then((rows) => {
              for (const inv of rows) {
                results.push({
                  id: inv.id,
                  category: 'INVOICE',
                  title: inv.invoiceNumber,
                  subtitle: inv.contact.name,
                  href: '/invoices',
                  status: inv.status,
                  amountCents: Number(inv.totalCents),
                  date: inv.issueDate.toISOString().slice(0, 10),
                });
              }
            }),
        );

        tasks.push(
          fastify.prisma.quote
            .findMany({
              where: {
                organizationId,
                OR: [
                  { quoteNumber: { contains: rawQ, mode: 'insensitive' } },
                  { contact: { name: { contains: rawQ, mode: 'insensitive' } } },
                  ...(amountCents !== null ? [{ totalCents: amountCents }] : []),
                ],
              },
              take: Math.min(3, perDomainLimit),
              orderBy: { issueDate: 'desc' },
              select: {
                id: true,
                quoteNumber: true,
                status: true,
                totalCents: true,
                issueDate: true,
                contact: { select: { name: true } },
              },
            })
            .then((rows) => {
              for (const q of rows) {
                results.push({
                  id: q.id,
                  category: 'QUOTE',
                  title: q.quoteNumber,
                  subtitle: q.contact.name,
                  href: '/invoices',
                  status: q.status,
                  amountCents: Number(q.totalCents),
                  date: q.issueDate.toISOString().slice(0, 10),
                });
              }
            }),
        );
      }

      // 5. Vendor Bills & Purchase Orders (PAYABLES)
      if (canReadPayables) {
        tasks.push(
          fastify.prisma.bill
            .findMany({
              where: {
                organizationId,
                OR: [
                  { reference: { contains: rawQ, mode: 'insensitive' } },
                  { notes: { contains: rawQ, mode: 'insensitive' } },
                  { contact: { name: { contains: rawQ, mode: 'insensitive' } } },
                  ...(amountCents !== null ? [{ totalCents: amountCents }] : []),
                ],
              },
              take: perDomainLimit,
              orderBy: { issueDate: 'desc' },
              select: {
                id: true,
                reference: true,
                status: true,
                totalCents: true,
                issueDate: true,
                contact: { select: { name: true } },
              },
            })
            .then((rows) => {
              for (const bill of rows) {
                results.push({
                  id: bill.id,
                  category: 'BILL',
                  title: bill.reference || 'Vendor Bill',
                  subtitle: bill.contact.name,
                  href: '/bills',
                  status: bill.status,
                  amountCents: Number(bill.totalCents),
                  date: bill.issueDate.toISOString().slice(0, 10),
                });
              }
            }),
        );

        tasks.push(
          fastify.prisma.purchaseOrder
            .findMany({
              where: {
                organizationId,
                OR: [
                  { poNumber: { contains: rawQ, mode: 'insensitive' } },
                  { contact: { name: { contains: rawQ, mode: 'insensitive' } } },
                  ...(amountCents !== null ? [{ totalCents: amountCents }] : []),
                ],
              },
              take: Math.min(3, perDomainLimit),
              orderBy: { issueDate: 'desc' },
              select: {
                id: true,
                poNumber: true,
                status: true,
                totalCents: true,
                issueDate: true,
                contact: { select: { name: true } },
              },
            })
            .then((rows) => {
              for (const po of rows) {
                results.push({
                  id: po.id,
                  category: 'PURCHASE_ORDER',
                  title: po.poNumber,
                  subtitle: po.contact.name,
                  href: '/bills',
                  status: po.status,
                  amountCents: Number(po.totalCents),
                  date: po.issueDate.toISOString().slice(0, 10),
                });
              }
            }),
        );
      }

      // 6. Expense Claims & Direct Spend/Receive Money (EXPENSES)
      if (canReadExpenses) {
        tasks.push(
          fastify.prisma.expenseClaim
            .findMany({
              where: {
                organizationId,
                ...(canReadAllExpenses ? {} : { employeeUserId: userId }),
                OR: [
                  { claimNumber: { contains: rawQ, mode: 'insensitive' } },
                  { title: { contains: rawQ, mode: 'insensitive' } },
                  ...(amountCents !== null ? [{ totalCents: amountCents }] : []),
                ],
              },
              take: perDomainLimit,
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                claimNumber: true,
                title: true,
                status: true,
                totalCents: true,
                createdAt: true,
              },
            })
            .then((rows) => {
              for (const clm of rows) {
                results.push({
                  id: clm.id,
                  category: 'EXPENSE_CLAIM',
                  title: `${clm.claimNumber} — ${clm.title}`,
                  subtitle: 'Employee Expense Claim',
                  href: '/expenses',
                  status: clm.status,
                  amountCents: Number(clm.totalCents),
                  date: clm.createdAt.toISOString().slice(0, 10),
                });
              }
            }),
        );

        if (canReadAllExpenses) {
          tasks.push(
            fastify.prisma.directTransaction
              .findMany({
                where: {
                  organizationId,
                  OR: [
                    { reference: { contains: rawQ, mode: 'insensitive' } },
                    { payeeName: { contains: rawQ, mode: 'insensitive' } },
                    { notes: { contains: rawQ, mode: 'insensitive' } },
                    ...(amountCents !== null ? [{ totalCents: amountCents }] : []),
                  ],
                },
                take: Math.min(3, perDomainLimit),
                orderBy: { transactionDate: 'desc' },
                select: {
                  id: true,
                  type: true,
                  payeeName: true,
                  reference: true,
                  totalCents: true,
                  transactionDate: true,
                },
              })
              .then((rows) => {
                for (const dt of rows) {
                  results.push({
                    id: dt.id,
                    category: 'DIRECT_TRANSACTION',
                    title: dt.payeeName || dt.reference || dt.type.replace(/_/g, ' '),
                    subtitle: dt.reference
                      ? `${dt.type.replace(/_/g, ' ')} · ${dt.reference}`
                      : dt.type.replace(/_/g, ' '),
                    href: '/expenses',
                    status: dt.type,
                    amountCents: Number(dt.totalCents),
                    date: dt.transactionDate.toISOString().slice(0, 10),
                  });
                }
              }),
          );
        }
      }

      // 7. Journal Entries (Ledger)
      if (canReadAccountsOrLedger) {
        tasks.push(
          fastify.prisma.journalEntry
            .findMany({
              where: {
                organizationId,
                OR: [
                  { entryNumber: { contains: rawQ, mode: 'insensitive' } },
                  { description: { contains: rawQ, mode: 'insensitive' } },
                ],
              },
              take: perDomainLimit,
              orderBy: { postedAt: 'desc' },
              select: {
                id: true,
                entryNumber: true,
                description: true,
                status: true,
                referenceType: true,
                postedAt: true,
              },
            })
            .then((rows) => {
              for (const je of rows) {
                results.push({
                  id: je.id,
                  category: 'JOURNAL',
                  title: je.entryNumber || 'Journal Entry',
                  subtitle: je.description,
                  href: '/ledger',
                  status: je.status,
                  date: je.postedAt.toISOString().slice(0, 10),
                });
              }
            }),
        );
      }

      await Promise.all(tasks);

      return reply.send({
        query: rawQ,
        results: results.slice(0, maxTotal),
      });
    },
  );
};

export default searchRoutes;
