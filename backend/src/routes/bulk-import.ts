/**
 * Centralized Admin Bulk CSV Import Engine — Module 12
 *
 * Scoped strictly to request.user.organizationId and restricted to Role.ADMIN.
 * Supports Two-Step Validate & Preview (POST /api/v1/bulk-import/validate)
 * and Atomic Transactional Commit (POST /api/v1/bulk-import/commit) across
 * all 13 master & transactional record types:
 *  1. CONTACTS
 *  2. ITEMS
 *  3. ACCOUNTS
 *  4. TRACKING_OPTIONS
 *  5. INVOICES
 *  6. QUOTES
 *  7. CREDIT_NOTES
 *  8. BILLS
 *  9. PURCHASE_ORDERS
 * 10. VENDOR_CREDITS
 * 11. DIRECT_TRANSACTIONS
 * 12. EXPENSE_CLAIMS
 * 13. JOURNAL_ENTRIES
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { calculateGST, sumGSTResults } from '../lib/gst.js';
import { recordAuditLog } from '../lib/audit.js';
import { checkOrganizationLockDate, postJournalEntry } from '../lib/ledger-posting.js';
import {
  AccountType,
  BillStatus,
  ContactType,
  CreditNoteStatus,
  DirectTransactionType,
  EntryType,
  ExpenseClaimStatus,
  InvoiceStatus,
  JournalStatus,
  NormalBalance,
  PurchaseOrderStatus,
  QuoteStatus,
  Role,
  TaxTreatment,
} from '@prisma/client';

const BulkImportEntityEnum = z.enum([
  'CONTACTS',
  'ITEMS',
  'ACCOUNTS',
  'TRACKING_OPTIONS',
  'INVOICES',
  'QUOTES',
  'CREDIT_NOTES',
  'BILLS',
  'PURCHASE_ORDERS',
  'VENDOR_CREDITS',
  'DIRECT_TRANSACTIONS',
  'EXPENSE_CLAIMS',
  'JOURNAL_ENTRIES',
]);

export type BulkImportEntityType = z.infer<typeof BulkImportEntityEnum>;

const ValidateOrCommitBody = z.object({
  entityType: BulkImportEntityEnum,
  csvContent: z.string().min(1),
});

interface TemplateMetadata {
  entityType: BulkImportEntityType;
  label: string;
  category: 'MASTER_DATA' | 'ACCOUNTS_RECEIVABLE' | 'ACCOUNTS_PAYABLE' | 'EXPENSES_AND_GL';
  description: string;
  groupingKey: string | null;
  requiredColumns: string[];
  optionalColumns: string[];
  sampleCsv: string;
}

const BULK_IMPORT_TEMPLATES: readonly TemplateMetadata[] = [
  {
    entityType: 'CONTACTS',
    label: 'Contacts (Customers & Suppliers)',
    category: 'MASTER_DATA',
    description:
      'Import Customer, Supplier/Vendor, or Dual contacts. Optional default GL account codes and Cost Centres are strictly validated if provided.',
    groupingKey: null,
    requiredColumns: ['name'],
    optionalColumns: [
      'type',
      'legal_name',
      'abn',
      'email',
      'phone',
      'billing_address',
      'payment_terms_days',
      'default_revenue_account_code',
      'default_expense_account_code',
      'bank_bsb',
      'bank_account_number',
      'bank_account_name',
    ],
    sampleCsv: [
      'name,type,legal_name,abn,email,phone,billing_address,payment_terms_days,default_revenue_account_code,default_expense_account_code,bank_bsb,bank_account_number,bank_account_name',
      '"Apex Industrial Supplies",SUPPLIER,"Apex Industrial Pty Ltd",51824753556,accounts@apexindustrial.com.au,0290001111,"100 George St Sydney NSW 2000",30,,6000,062-000,12345678,"Apex Industrial Pty Ltd"',
      '"Horizon Logistics Group",CUSTOMER,"Horizon Logistics Group Pty Ltd",53004085616,ap@horizonlogistics.com.au,0380002222,"250 Collins St Melbourne VIC 3000",14,4000,,,,',
    ].join('\n'),
  },
  {
    entityType: 'ITEMS',
    label: 'Products & Services Catalog',
    category: 'MASTER_DATA',
    description:
      'Import coded products and services with default sale/purchase prices, GST treatments, and optional GL account codes.',
    groupingKey: null,
    requiredColumns: ['code', 'name'],
    optionalColumns: [
      'sale_unit_price',
      'sale_tax_treatment',
      'income_account_code',
      'sale_description',
      'purchase_unit_price',
      'purchase_tax_treatment',
      'expense_account_code',
      'purchase_description',
    ],
    sampleCsv: [
      'code,name,sale_unit_price,sale_tax_treatment,income_account_code,sale_description,purchase_unit_price,purchase_tax_treatment,expense_account_code,purchase_description',
      'CONS-01,"Senior Advisory Consulting",250.00,TAX_EXCLUSIVE,4000,"Senior consulting per hour",0.00,TAX_EXCLUSIVE,6000,"Subcontractor cost"',
      'HOST-MTH,"Managed Cloud Hosting",495.00,TAX_EXCLUSIVE,4000,"Monthly dedicated cloud hosting",180.00,TAX_EXCLUSIVE,6000,"Upstream cloud infrastructure"',
    ].join('\n'),
  },
  {
    entityType: 'ACCOUNTS',
    label: 'Chart of Accounts',
    category: 'MASTER_DATA',
    description:
      'Import GL accounts into the Chart of Accounts. Supports parent account hierarchy, bank account flags, and default tax treatments.',
    groupingKey: null,
    requiredColumns: ['code', 'name', 'type'],
    optionalColumns: [
      'normal_balance',
      'parent_code',
      'default_tax_treatment',
      'is_bank_account',
      'bank_bsb',
      'bank_account_number',
    ],
    sampleCsv: [
      'code,name,type,normal_balance,parent_code,default_tax_treatment,is_bank_account,bank_bsb,bank_account_number',
      '6110,"Software & SaaS Subscriptions",EXPENSE,DEBIT,6000,TAX_EXCLUSIVE,false,,',
      '6120,"Commercial Fleet Fuel & Tolls",EXPENSE,DEBIT,6000,TAX_INCLUSIVE,false,,',
      '1050,"Corporate Visa Expense Card",LIABILITY,CREDIT,,GST_FREE,true,062-001,99887766',
    ].join('\n'),
  },
  {
    entityType: 'TRACKING_OPTIONS',
    label: 'Cost Centres / Tracking Dimensions',
    category: 'MASTER_DATA',
    description:
      'Import Tracking Categories (e.g. Department, Project, Fleet Vehicle) and their selectable Cost Centre Options.',
    groupingKey: null,
    requiredColumns: ['category_name', 'option_name'],
    optionalColumns: ['option_code', 'category_description'],
    sampleCsv: [
      'category_name,option_name,option_code,category_description',
      'Department,Operations,OPS,"Core operational division"',
      'Department,Commercial & Sales,SALES,"Client acquisition and revenue"',
      'Project,Sydney Metro Upgrade,PRJ-SYD,"Major infrastructure contract"',
    ].join('\n'),
  },
  {
    entityType: 'INVOICES',
    label: 'Customer Tax Invoices (AR)',
    category: 'ACCOUNTS_RECEIVABLE',
    description:
      'Import single- or multi-line Customer Invoices. Rows sharing the same invoice_number are grouped into one invoice. Set status=ISSUED to automatically post to the General Ledger.',
    groupingKey: 'invoice_number',
    requiredColumns: ['invoice_number', 'contact_name', 'issue_date', 'description', 'unit_price'],
    optionalColumns: [
      'due_date',
      'status',
      'quantity',
      'tax_treatment',
      'account_code',
      'cost_centre',
      'item_code',
      'notes',
    ],
    sampleCsv: [
      'invoice_number,contact_name,issue_date,due_date,status,description,quantity,unit_price,tax_treatment,account_code,cost_centre,item_code,notes',
      'INV-2001,"Horizon Logistics Group",2026-07-01,2026-07-15,ISSUED,"Q3 Advisory Retainer",1,2500.00,TAX_EXCLUSIVE,4000,Operations,,Standard 14-day terms',
      'INV-2001,"Horizon Logistics Group",2026-07-01,2026-07-15,ISSUED,"Cloud Hosting Allocation",1,495.00,TAX_EXCLUSIVE,4000,Operations,,Standard 14-day terms',
    ].join('\n'),
  },
  {
    entityType: 'QUOTES',
    label: 'Customer Quotes & Estimates (AR)',
    category: 'ACCOUNTS_RECEIVABLE',
    description:
      'Import single- or multi-line Customer Quotes grouped by quote_number.',
    groupingKey: 'quote_number',
    requiredColumns: ['quote_number', 'contact_name', 'issue_date', 'description', 'unit_price'],
    optionalColumns: [
      'expiry_date',
      'status',
      'quantity',
      'tax_treatment',
      'account_code',
      'cost_centre',
      'item_code',
      'notes',
    ],
    sampleCsv: [
      'quote_number,contact_name,issue_date,expiry_date,status,description,quantity,unit_price,tax_treatment,account_code,cost_centre,item_code,notes',
      'QUO-1001,"Horizon Logistics Group",2026-07-01,2026-07-31,SENT,"Phase 1 Systems Architecture",1,5000.00,TAX_EXCLUSIVE,4000,,,Valid for 30 days',
    ].join('\n'),
  },
  {
    entityType: 'CREDIT_NOTES',
    label: 'Customer Credit Notes (AR)',
    category: 'ACCOUNTS_RECEIVABLE',
    description:
      'Import Customer AR Credit Notes grouped by credit_note_number. Set status=ISSUED to automatically post contra-AR & GST reversals to the GL.',
    groupingKey: 'credit_note_number',
    requiredColumns: ['credit_note_number', 'contact_name', 'issue_date', 'description', 'amount'],
    optionalColumns: ['status', 'tax_treatment', 'account_code', 'cost_centre', 'notes'],
    sampleCsv: [
      'credit_note_number,contact_name,issue_date,status,description,amount,tax_treatment,account_code,cost_centre,notes',
      'CN-1001,"Horizon Logistics Group",2026-07-05,ISSUED,"SLA Service Level Rebate",250.00,TAX_EXCLUSIVE,4000,,Credit adjustment',
    ].join('\n'),
  },
  {
    entityType: 'BILLS',
    label: 'Vendor Bills (AP)',
    category: 'ACCOUNTS_PAYABLE',
    description:
      'Import single- or multi-line Vendor Bills grouped by bill_reference. Set status=AWAITING_PAYMENT to automatically approve and post to the General Ledger.',
    groupingKey: 'bill_reference',
    requiredColumns: ['bill_reference', 'contact_name', 'issue_date', 'description', 'unit_price'],
    optionalColumns: [
      'due_date',
      'status',
      'quantity',
      'tax_treatment',
      'account_code',
      'cost_centre',
      'item_code',
      'notes',
    ],
    sampleCsv: [
      'bill_reference,contact_name,issue_date,due_date,status,description,quantity,unit_price,tax_treatment,account_code,cost_centre,item_code,notes',
      'BILL-9001,"Apex Industrial Supplies",2026-07-01,2026-07-31,AWAITING_PAYMENT,"Warehouse Shelving Units",2,850.00,TAX_EXCLUSIVE,6000,Operations,,Monthly account',
      'BILL-9001,"Apex Industrial Supplies",2026-07-01,2026-07-31,AWAITING_PAYMENT,"Freight & Delivery Charge",1,120.00,TAX_EXCLUSIVE,6000,Operations,,Monthly account',
    ].join('\n'),
  },
  {
    entityType: 'PURCHASE_ORDERS',
    label: 'Vendor Purchase Orders (AP)',
    category: 'ACCOUNTS_PAYABLE',
    description:
      'Import single- or multi-line Vendor Purchase Orders grouped by po_number.',
    groupingKey: 'po_number',
    requiredColumns: ['po_number', 'contact_name', 'issue_date', 'description', 'unit_price'],
    optionalColumns: [
      'delivery_date',
      'status',
      'quantity',
      'tax_treatment',
      'account_code',
      'cost_centre',
      'item_code',
      'notes',
    ],
    sampleCsv: [
      'po_number,contact_name,issue_date,delivery_date,status,description,quantity,unit_price,tax_treatment,account_code,cost_centre,item_code,notes',
      'PO-3001,"Apex Industrial Supplies",2026-07-01,2026-07-14,APPROVED,"Heavy Duty Pallet Racking",4,600.00,TAX_EXCLUSIVE,6000,,,Deliver to Gate B',
    ].join('\n'),
  },
  {
    entityType: 'VENDOR_CREDITS',
    label: 'Vendor Credits (AP)',
    category: 'ACCOUNTS_PAYABLE',
    description:
      'Import Vendor AP Credit Notes grouped by reference. Set status=ISSUED to automatically post contra-AP & GST Paid reversals to the GL.',
    groupingKey: 'reference',
    requiredColumns: ['reference', 'contact_name', 'issue_date', 'description', 'amount'],
    optionalColumns: ['status', 'tax_treatment', 'account_code', 'cost_centre', 'notes'],
    sampleCsv: [
      'reference,contact_name,issue_date,status,description,amount,tax_treatment,account_code,cost_centre,notes',
      'VCN-501,"Apex Industrial Supplies",2026-07-06,ISSUED,"Damaged Crate Return Credit",150.00,TAX_EXCLUSIVE,6000,,Supplier RMA #881',
    ].join('\n'),
  },
  {
    entityType: 'DIRECT_TRANSACTIONS',
    label: 'Direct Spend & Receive Money',
    category: 'EXPENSES_AND_GL',
    description:
      'Import direct bank/card Spend Money or Receive Money transactions linked to Contacts, GL Accounts, and Cost Centres. Automatically posts to the General Ledger.',
    groupingKey: 'reference',
    requiredColumns: ['transaction_date', 'type', 'bank_account_code', 'description', 'amount'],
    optionalColumns: [
      'reference',
      'contact_name',
      'payee_name',
      'account_code',
      'cost_centre',
      'tax_treatment',
      'notes',
    ],
    sampleCsv: [
      'reference,transaction_date,type,bank_account_code,contact_name,payee_name,description,amount,tax_treatment,account_code,cost_centre,notes',
      'TX-7001,2026-07-02,SPEND_MONEY,1000,"Apex Industrial Supplies",,"Urgent Hardware Consumables",165.00,TAX_INCLUSIVE,6000,Operations,Paid by corporate card',
      'TX-7002,2026-07-03,RECEIVE_MONEY,1000,"Horizon Logistics Group",,"Ad-hoc Dispatch Surcharge",550.00,TAX_INCLUSIVE,4000,Operations,Instant EFT receipt',
    ].join('\n'),
  },
  {
    entityType: 'EXPENSE_CLAIMS',
    label: 'Employee Expense Claims',
    category: 'EXPENSES_AND_GL',
    description:
      'Import Employee Expense Claims grouped by claim_number (or title). Set status=APPROVED to automatically post to 2050 Employee Reimbursements Payable.',
    groupingKey: 'claim_number',
    requiredColumns: ['claim_number', 'title', 'expense_date', 'merchant', 'description', 'amount'],
    optionalColumns: [
      'employee_email',
      'status',
      'account_code',
      'cost_centre',
      'tax_treatment',
      'notes',
    ],
    sampleCsv: [
      'claim_number,title,employee_email,status,expense_date,merchant,description,amount,tax_treatment,account_code,cost_centre,notes',
      'EXP-4001,"July Interstate Site Visit",,APPROVED,2026-07-04,"Qantas Airways","Return Flight SYD-MEL",440.00,TAX_INCLUSIVE,6000,Operations,Client workshop',
      'EXP-4001,"July Interstate Site Visit",,APPROVED,2026-07-04,"Uber Australia","Airport Transfer",66.00,TAX_INCLUSIVE,6000,Operations,Client workshop',
    ].join('\n'),
  },
  {
    entityType: 'JOURNAL_ENTRIES',
    label: 'Manual General Ledger Journals',
    category: 'EXPENSES_AND_GL',
    description:
      'Import balanced multi-line Double-Entry Manual Journals grouped by entry_number. Total Debits must equal Total Credits for each entry_number.',
    groupingKey: 'entry_number',
    requiredColumns: ['entry_number', 'posted_date', 'description', 'account_code', 'entry_type', 'amount'],
    optionalColumns: ['status', 'line_description', 'cost_centre'],
    sampleCsv: [
      'entry_number,posted_date,status,description,account_code,entry_type,amount,line_description,cost_centre',
      'JNL-8001,2026-07-01,POSTED,"Monthly Depreciation Adjustment",6000,DEBIT,1200.00,"Depreciation expense",Operations',
      'JNL-8001,2026-07-01,POSTED,"Monthly Depreciation Adjustment",1000,CREDIT,1200.00,"Accumulated provision",Operations',
    ].join('\n'),
  },
];

// ---------------------------------------------------------------------------
// CSV Parsing & Normalization Helpers
// ---------------------------------------------------------------------------

function parseCsvToObjects(csvContent: string): Array<{ rowNumber: number; data: Record<string, string> }> {
  const lines = csvContent
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row.');
  }

  const headerLine = lines[0]!;
  const delimiter = headerLine.includes('\t') ? '\t' : ',';

  const tokenize = (row: string): string[] => {
    const tokens: string[] = [];
    let insideQuotes = false;
    let currentToken = '';

    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === delimiter && !insideQuotes) {
        tokens.push(currentToken.trim().replace(/^["']|["']$/g, ''));
        currentToken = '';
      } else {
        currentToken += char;
      }
    }
    tokens.push(currentToken.trim().replace(/^["']|["']$/g, ''));
    return tokens;
  };

  const headers = tokenize(headerLine).map((h) =>
    h
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, '_'),
  );

  const rows: Array<{ rowNumber: number; data: Record<string, string> }> = [];

  for (let i = 1; i < lines.length; i++) {
    const tokens = tokenize(lines[i]!);
    if (tokens.every((t) => !t)) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]!;
      obj[key] = (tokens[c] ?? '').trim();
    }
    rows.push({ rowNumber: i + 1, data: obj });
  }

  return rows;
}

function getField(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== '') return val.trim();
  }
  return '';
}

function parseDateValue(raw: string): Date | null {
  if (!raw || !raw.trim()) return null;
  const clean = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const d = new Date(`${clean}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  const parts = clean.split(/[/.-]/);
  if (parts.length === 3) {
    let day = parseInt(parts[0]!, 10);
    let month = parseInt(parts[1]!, 10);
    let year = parseInt(parts[2]!, 10);
    if (year < 100) year += 2000;
    if (month > 12 && day <= 12) {
      const tmp = day;
      day = month;
      month = tmp;
    }
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1970) {
      const d = new Date(Date.UTC(year, month - 1, day));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const fallback = new Date(clean);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function parseMoneyToCents(raw: string, isAlreadyCents = false): bigint | null {
  if (!raw || !raw.trim()) return null;
  let clean = raw.trim().replace(/[$,\s]/g, '');
  let neg = false;
  if (clean.startsWith('(') && clean.endsWith(')')) {
    neg = true;
    clean = clean.slice(1, -1);
  } else if (clean.startsWith('-')) {
    neg = true;
    clean = clean.slice(1);
  } else if (clean.startsWith('+')) {
    clean = clean.slice(1);
  }
  const num = parseFloat(clean);
  if (isNaN(num)) return null;
  const cents = isAlreadyCents ? BigInt(Math.round(num)) : BigInt(Math.round(num * 100));
  return neg ? -cents : cents;
}

function parseTaxTreatmentOpt(
  raw: string,
  fallback: TaxTreatment = TaxTreatment.TAX_EXCLUSIVE,
): { valid: boolean; value: TaxTreatment } {
  if (!raw || !raw.trim()) return { valid: true, value: fallback };
  const norm = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['TAX_EXCLUSIVE', 'EXCLUSIVE', 'GST_EXCLUSIVE', 'EX_GST', '10%_GST'].includes(norm)) {
    return { valid: true, value: TaxTreatment.TAX_EXCLUSIVE };
  }
  if (['TAX_INCLUSIVE', 'INCLUSIVE', 'GST_INCLUSIVE', 'INC_GST', 'GST'].includes(norm)) {
    return { valid: true, value: TaxTreatment.TAX_INCLUSIVE };
  }
  if (['GST_FREE', 'FREE', 'ZERO', '0%', 'NO_GST', 'BAS_EXCLUDED', 'EXEMPT', 'NONE', 'INPUT_TAXED', 'INPUT'].includes(norm)) {
    return { valid: true, value: TaxTreatment.GST_FREE };
  }
  return { valid: false, value: fallback };
}

export const bulkImportRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/bulk-import/templates — List all 13 templates & column specs
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/bulk-import/templates',
    {
      preHandler: [requireRole(Role.ADMIN)],
    },
    async (_request, reply) => {
      return reply.code(200).send({
        templates: BULK_IMPORT_TEMPLATES,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Shared Validation & Execution Engine
  // -------------------------------------------------------------------------
  async function validateAndOptionallyCommit(
    organizationId: string,
    actorUserId: string,
    entityType: BulkImportEntityType,
    csvContent: string,
    commit: boolean,
  ) {
    const rawRows = parseCsvToObjects(csvContent);

    // Load organization reference datasets for strict validation
    const [
      org,
      contacts,
      accounts,
      items,
      trackingCategories,
      trackingOptions,
      orgMembers,
    ] = await Promise.all([
      fastify.prisma.organization.findUnique({
        where: { id: organizationId },
      }),
      fastify.prisma.contact.findMany({
        where: { organizationId },
      }),
      fastify.prisma.account.findMany({
        where: { organizationId },
      }),
      fastify.prisma.item.findMany({
        where: { organizationId },
      }),
      fastify.prisma.trackingCategory.findMany({
        where: { organizationId },
      }),
      fastify.prisma.trackingOption.findMany({
        where: { organizationId },
        include: { trackingCategory: true },
      }),
      fastify.prisma.organizationMember.findMany({
        where: { organizationId },
        include: { user: true },
      }),
    ]);

    const findContact = (nameOrRef: string) => {
      if (!nameOrRef) return null;
      const target = nameOrRef.trim().toLowerCase();
      return (
        contacts.find(
          (c) =>
            c.name.toLowerCase() === target ||
            (c.legalName && c.legalName.toLowerCase() === target),
        ) ?? null
      );
    };

    const findAccount = (codeOrName: string) => {
      if (!codeOrName) return null;
      const target = codeOrName.trim().toLowerCase();
      return (
        accounts.find(
          (a) =>
            a.code.toLowerCase() === target ||
            a.name.toLowerCase() === target ||
            `${a.code} - ${a.name}`.toLowerCase() === target ||
            `${a.code} ${a.name}`.toLowerCase() === target,
        ) ?? null
      );
    };

    const findItem = (codeOrName: string) => {
      if (!codeOrName) return null;
      const target = codeOrName.trim().toLowerCase();
      return (
        items.find(
          (it) => it.code.toLowerCase() === target || it.name.toLowerCase() === target,
        ) ?? null
      );
    };

    const findTrackingOption = (nameOrCode: string) => {
      if (!nameOrCode) return null;
      const target = nameOrCode.trim().toLowerCase();
      return (
        trackingOptions.find(
          (t) =>
            t.name.toLowerCase() === target ||
            (t.code && t.code.toLowerCase() === target) ||
            `${t.trackingCategory.name}: ${t.name}`.toLowerCase() === target,
        ) ?? null
      );
    };

    const defaultRevAccount =
      accounts.find((a) => a.systemKey === 'DEFAULT_REVENUE') ??
      accounts.find((a) => a.code === '4000') ??
      null;
    const defaultExpAccount =
      accounts.find((a) => a.systemKey === 'DEFAULT_EXPENSE') ??
      accounts.find((a) => a.code === '6000') ??
      null;
    const arAccount =
      accounts.find((a) => a.systemKey === 'ACCOUNTS_RECEIVABLE') ??
      accounts.find((a) => a.code === '1200') ??
      null;
    const apAccount =
      accounts.find((a) => a.systemKey === 'ACCOUNTS_PAYABLE') ??
      accounts.find((a) => a.code === '2000') ??
      null;
    const empReimbAccount =
      accounts.find((a) => a.systemKey === 'EMPLOYEE_REIMBURSEMENTS') ??
      accounts.find((a) => a.code === '2050') ??
      null;
    const gstCollectedAccount =
      accounts.find((a) => a.systemKey === 'GST_COLLECTED') ??
      accounts.find((a) => a.code === '2100') ??
      null;
    const gstPaidAccount =
      accounts.find((a) => a.systemKey === 'GST_PAID') ??
      accounts.find((a) => a.code === '2200') ??
      null;

    interface PreviewRecord {
      rowNumbers: string;
      identifier: string;
      primaryLabel: string;
      secondaryLabel: string;
      statusBadge: string;
      amountCents: number | null;
      resolvedBadges: string[];
      valid: boolean;
      errors: string[];
      payload: any;
    }

    const previewRecords: PreviewRecord[] = [];

    // =========================================================================
    // 1. CONTACTS
    // =========================================================================
    if (entityType === 'CONTACTS') {
      for (const r of rawRows) {
        const errors: string[] = [];
        const badges: string[] = [];
        const name = getField(r.data, 'name', 'contact_name', 'company_name');
        if (!name) errors.push('Missing required "name" column.');

        const rawType = getField(r.data, 'type', 'contact_type').toUpperCase() || 'CUSTOMER';
        let contactType: ContactType = ContactType.CUSTOMER;
        if (['CUSTOMER', 'VENDOR', 'BOTH'].includes(rawType)) {
          contactType = rawType as ContactType;
        } else if (rawType === 'SUPPLIER') {
          contactType = ContactType.VENDOR;
        } else {
          errors.push(`Invalid contact type "${rawType}" (use CUSTOMER, SUPPLIER, VENDOR, or BOTH).`);
        }

        const rawRevCode = getField(r.data, 'default_revenue_account_code', 'revenue_account');
        const revAcc = rawRevCode ? findAccount(rawRevCode) : null;
        if (rawRevCode && !revAcc) {
          errors.push(`Unrecognized default_revenue_account_code "${rawRevCode}".`);
        } else if (revAcc) {
          badges.push(`Rev: ${revAcc.code}`);
        }

        const rawExpCode = getField(r.data, 'default_expense_account_code', 'expense_account');
        const expAcc = rawExpCode ? findAccount(rawExpCode) : null;
        if (rawExpCode && !expAcc) {
          errors.push(`Unrecognized default_expense_account_code "${rawExpCode}".`);
        } else if (expAcc) {
          badges.push(`Exp: ${expAcc.code}`);
        }

        const termsRaw = getField(r.data, 'payment_terms_days', 'terms');
        const paymentTermsDays = termsRaw ? parseInt(termsRaw, 10) : 30;
        if (termsRaw && (isNaN(paymentTermsDays) || paymentTermsDays < 0)) {
          errors.push(`Invalid payment_terms_days "${termsRaw}".`);
        }

        const abn = getField(r.data, 'abn').replace(/\s+/g, '') || null;
        if (abn) badges.push(`ABN: ${abn}`);

        previewRecords.push({
          rowNumbers: `${r.rowNumber}`,
          identifier: name || `Row ${r.rowNumber}`,
          primaryLabel: name || 'Unnamed Contact',
          secondaryLabel: getField(r.data, 'email') || getField(r.data, 'legal_name') || contactType,
          statusBadge: contactType,
          amountCents: null,
          resolvedBadges: badges,
          valid: errors.length === 0,
          errors,
          payload: {
            name,
            type: contactType,
            legalName: getField(r.data, 'legal_name') || null,
            abn,
            email: getField(r.data, 'email') || null,
            phone: getField(r.data, 'phone') || null,
            billingAddress: getField(r.data, 'billing_address', 'address') || null,
            paymentTermsDays: isNaN(paymentTermsDays) ? 30 : paymentTermsDays,
            defaultRevenueAccountId: revAcc?.id ?? null,
            defaultExpenseAccountId: expAcc?.id ?? null,
            bankBsb: getField(r.data, 'bank_bsb', 'bsb') || null,
            bankAccountNumber: getField(r.data, 'bank_account_number', 'account_number') || null,
            bankAccountName: getField(r.data, 'bank_account_name') || null,
          },
        });
      }
    }

    // =========================================================================
    // 2. ITEMS
    // =========================================================================
    else if (entityType === 'ITEMS') {
      for (const r of rawRows) {
        const errors: string[] = [];
        const badges: string[] = [];
        const code = getField(r.data, 'code', 'item_code', 'sku');
        const name = getField(r.data, 'name', 'item_name');
        if (!code) errors.push('Missing required "code" column.');
        if (!name) errors.push('Missing required "name" column.');

        const salePriceRaw = getField(r.data, 'sale_unit_price', 'sale_price', 'unit_price');
        const salePriceCents = salePriceRaw ? parseMoneyToCents(salePriceRaw) : 0n;
        if (salePriceRaw && salePriceCents === null) {
          errors.push(`Invalid sale_unit_price "${salePriceRaw}".`);
        }

        const purchPriceRaw = getField(r.data, 'purchase_unit_price', 'purchase_price', 'cost_price');
        const purchPriceCents = purchPriceRaw ? parseMoneyToCents(purchPriceRaw) : 0n;
        if (purchPriceRaw && purchPriceCents === null) {
          errors.push(`Invalid purchase_unit_price "${purchPriceRaw}".`);
        }

        const saleTax = parseTaxTreatmentOpt(getField(r.data, 'sale_tax_treatment', 'tax_treatment'));
        if (!saleTax.valid) errors.push(`Invalid sale_tax_treatment.`);

        const purchTax = parseTaxTreatmentOpt(getField(r.data, 'purchase_tax_treatment'));
        if (!purchTax.valid) errors.push(`Invalid purchase_tax_treatment.`);

        const rawIncAcc = getField(r.data, 'income_account_code', 'revenue_account_code');
        const incAcc = rawIncAcc ? findAccount(rawIncAcc) : defaultRevAccount;
        if (rawIncAcc && !incAcc) {
          errors.push(`Unrecognized income_account_code "${rawIncAcc}".`);
        } else if (incAcc) {
          badges.push(`Income: ${incAcc.code}`);
        }

        const rawExpAcc = getField(r.data, 'expense_account_code');
        const expAcc = rawExpAcc ? findAccount(rawExpAcc) : defaultExpAccount;
        if (rawExpAcc && !expAcc) {
          errors.push(`Unrecognized expense_account_code "${rawExpAcc}".`);
        } else if (expAcc) {
          badges.push(`Expense: ${expAcc.code}`);
        }

        previewRecords.push({
          rowNumbers: `${r.rowNumber}`,
          identifier: code || `Row ${r.rowNumber}`,
          primaryLabel: name || 'Unnamed Item',
          secondaryLabel: getField(r.data, 'sale_description') || code,
          statusBadge: 'CATALOG_ITEM',
          amountCents: salePriceCents !== null ? Number(salePriceCents) : 0,
          resolvedBadges: badges,
          valid: errors.length === 0,
          errors,
          payload: {
            code,
            name,
            saleUnitPriceCents: salePriceCents ?? 0n,
            saleTaxTreatment: saleTax.value,
            incomeAccountId: incAcc?.id ?? null,
            saleDescription: getField(r.data, 'sale_description') || null,
            purchaseUnitPriceCents: purchPriceCents ?? 0n,
            purchaseTaxTreatment: purchTax.value,
            expenseAccountId: expAcc?.id ?? null,
            purchaseDescription: getField(r.data, 'purchase_description') || null,
          },
        });
      }
    }

    // =========================================================================
    // 3. ACCOUNTS (Chart of Accounts)
    // =========================================================================
    else if (entityType === 'ACCOUNTS') {
      for (const r of rawRows) {
        const errors: string[] = [];
        const badges: string[] = [];
        const code = getField(r.data, 'code', 'account_code');
        const name = getField(r.data, 'name', 'account_name');
        const rawType = getField(r.data, 'type', 'account_type').toUpperCase();

        if (!code) errors.push('Missing required "code" column.');
        if (!name) errors.push('Missing required "name" column.');
        if (!['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(rawType)) {
          errors.push(`Invalid account type "${rawType}" (use ASSET, LIABILITY, EQUITY, REVENUE, or EXPENSE).`);
        }

        const accType = (['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(rawType)
          ? rawType
          : 'EXPENSE') as AccountType;

        const rawNormal = getField(r.data, 'normal_balance').toUpperCase();
        const defaultNormal =
          accType === 'ASSET' || accType === 'EXPENSE'
            ? NormalBalance.DEBIT
            : NormalBalance.CREDIT;
        const normalBalance =
          rawNormal === 'DEBIT' || rawNormal === 'CREDIT'
            ? (rawNormal as NormalBalance)
            : defaultNormal;

        const rawParentCode = getField(r.data, 'parent_code', 'parent_account_code');
        const parentAcc = rawParentCode ? findAccount(rawParentCode) : null;
        if (rawParentCode && !parentAcc) {
          errors.push(`Unrecognized parent_code "${rawParentCode}".`);
        } else if (parentAcc) {
          badges.push(`Parent: ${parentAcc.code}`);
        }

        const taxOpt = parseTaxTreatmentOpt(
          getField(r.data, 'default_tax_treatment', 'tax_treatment'),
          accType === 'REVENUE' || accType === 'EXPENSE'
            ? TaxTreatment.TAX_EXCLUSIVE
            : TaxTreatment.GST_FREE,
        );
        if (!taxOpt.valid) errors.push('Invalid default_tax_treatment.');
        badges.push(taxOpt.value);

        const isBank = ['true', '1', 'yes'].includes(
          getField(r.data, 'is_bank_account').toLowerCase(),
        );
        if (isBank) badges.push('BANK_ACCOUNT');

        previewRecords.push({
          rowNumbers: `${r.rowNumber}`,
          identifier: code || `Row ${r.rowNumber}`,
          primaryLabel: name || 'Unnamed Account',
          secondaryLabel: `${accType} (${normalBalance})`,
          statusBadge: accType,
          amountCents: null,
          resolvedBadges: badges,
          valid: errors.length === 0,
          errors,
          payload: {
            code,
            name,
            type: accType,
            normalBalance,
            parentId: parentAcc?.id ?? null,
            defaultTaxTreatment: taxOpt.value,
            isBankAccount: isBank,
            bankBsb: getField(r.data, 'bank_bsb', 'bsb') || null,
            bankAccountNumber: getField(r.data, 'bank_account_number') || null,
          },
        });
      }
    }

    // =========================================================================
    // 4. TRACKING_OPTIONS (Cost Centres)
    // =========================================================================
    else if (entityType === 'TRACKING_OPTIONS') {
      for (const r of rawRows) {
        const errors: string[] = [];
        const categoryName = getField(r.data, 'category_name', 'category', 'dimension');
        const optionName = getField(r.data, 'option_name', 'name', 'cost_centre', 'cost_center');
        const optionCode = getField(r.data, 'option_code', 'code') || null;
        const categoryDesc = getField(r.data, 'category_description', 'description') || null;

        if (!categoryName) errors.push('Missing required "category_name" column.');
        if (!optionName) errors.push('Missing required "option_name" column.');

        previewRecords.push({
          rowNumbers: `${r.rowNumber}`,
          identifier: `${categoryName}: ${optionName}`,
          primaryLabel: optionName || 'Unnamed Option',
          secondaryLabel: `Category: ${categoryName}`,
          statusBadge: optionCode || 'COST_CENTRE',
          amountCents: null,
          resolvedBadges: [categoryName],
          valid: errors.length === 0,
          errors,
          payload: {
            categoryName,
            optionName,
            optionCode,
            categoryDesc,
          },
        });
      }
    }

    // =========================================================================
    // 5, 6, 8, 9: MULTI-LINE COMMERCIAL DOCUMENTS
    // INVOICES, QUOTES, BILLS, PURCHASE_ORDERS
    // =========================================================================
    else if (
      entityType === 'INVOICES' ||
      entityType === 'QUOTES' ||
      entityType === 'BILLS' ||
      entityType === 'PURCHASE_ORDERS'
    ) {
      const groups = new Map<string, Array<{ rowNumber: number; data: Record<string, string> }>>();
      for (const r of rawRows) {
        const key =
          getField(
            r.data,
            'invoice_number',
            'quote_number',
            'bill_reference',
            'bill_number',
            'po_number',
            'reference',
            'document_number',
          ) || `ROW-${r.rowNumber}`;
        const list = groups.get(key) ?? [];
        list.push(r);
        groups.set(key, list);
      }

      for (const [docRef, groupRows] of groups.entries()) {
        const first = groupRows[0]!.data;
        const errors: string[] = [];
        const badges: string[] = [];
        const rowNums = groupRows.map((g) => g.rowNumber).join(', ');

        if (docRef.startsWith('ROW-')) {
          errors.push('Missing document reference/number column.');
        }

        const rawContact = getField(first, 'contact_name', 'contact', 'customer', 'supplier', 'vendor', 'merchant');
        const contact = findContact(rawContact);
        if (!rawContact) {
          errors.push('Missing required "contact_name" column.');
        } else if (!contact) {
          errors.push(`Unrecognized Contact "${rawContact}" (strict match required in Contacts directory).`);
        } else {
          badges.push(`Contact: ${contact.name}`);
        }

        const issueDate = parseDateValue(getField(first, 'issue_date', 'date'));
        if (!issueDate) {
          errors.push('Invalid or missing "issue_date" (use YYYY-MM-DD or DD/MM/YYYY).');
        } else if (org?.lockDate && issueDate <= org.lockDate) {
          errors.push(
            `Issue date ${issueDate.toISOString().slice(0, 10)} falls on or before organization lock date (${org.lockDate.toISOString().slice(0, 10)}).`,
          );
        }

        const secondaryDateRaw = getField(first, 'due_date', 'expiry_date', 'delivery_date');
        const secondaryDate = secondaryDateRaw
          ? parseDateValue(secondaryDateRaw)
          : issueDate
          ? new Date(issueDate.getTime() + (contact?.paymentTermsDays ?? org?.defaultPaymentTermsDays ?? 30) * 86400000)
          : null;

        if (secondaryDateRaw && !secondaryDate) {
          errors.push(`Invalid secondary date "${secondaryDateRaw}".`);
        }

        const rawStatus = getField(first, 'status').toUpperCase();
        let targetStatus = 'DRAFT';
        if (entityType === 'INVOICES') {
          targetStatus = ['ISSUED', 'APPROVED', 'POSTED'].includes(rawStatus)
            ? InvoiceStatus.ISSUED
            : InvoiceStatus.DRAFT;
          const dup = await fastify.prisma.invoice.findFirst({
            where: { organizationId, invoiceNumber: docRef },
            select: { id: true },
          });
          if (dup) errors.push(`Invoice number "${docRef}" already exists.`);
        } else if (entityType === 'QUOTES') {
          targetStatus = ['SENT', 'ACCEPTED'].includes(rawStatus) ? rawStatus : QuoteStatus.DRAFT;
          const dup = await fastify.prisma.quote.findFirst({
            where: { organizationId, quoteNumber: docRef },
            select: { id: true },
          });
          if (dup) errors.push(`Quote number "${docRef}" already exists.`);
        } else if (entityType === 'BILLS') {
          targetStatus = ['AWAITING_PAYMENT', 'APPROVED', 'POSTED', 'ISSUED'].includes(rawStatus)
            ? BillStatus.AWAITING_PAYMENT
            : BillStatus.DRAFT;
        } else if (entityType === 'PURCHASE_ORDERS') {
          targetStatus = ['APPROVED', 'PENDING_APPROVAL'].includes(rawStatus)
            ? rawStatus
            : PurchaseOrderStatus.DRAFT;
          const dup = await fastify.prisma.purchaseOrder.findFirst({
            where: { organizationId, poNumber: docRef },
            select: { id: true },
          });
          if (dup) errors.push(`PO number "${docRef}" already exists.`);
        }

        const isSalesSide = entityType === 'INVOICES' || entityType === 'QUOTES';

        const processedLines: Array<{
          itemId: string | null;
          accountId: string | null;
          trackingOptionId: string | null;
          description: string;
          quantity: number;
          unitPriceCents: bigint;
          amountCents: bigint;
          taxTreatment: TaxTreatment;
          gstCents: bigint;
          totalCents: bigint;
        }> = [];

        for (const gr of groupRows) {
          const d = gr.data;
          const desc = getField(d, 'description', 'line_description', 'narrative');
          if (!desc) {
            errors.push(`Row ${gr.rowNumber}: Missing line "description".`);
          }

          const qtyRaw = getField(d, 'quantity', 'qty');
          const quantity = qtyRaw ? parseInt(qtyRaw, 10) : 1;
          if (isNaN(quantity) || quantity <= 0) {
            errors.push(`Row ${gr.rowNumber}: Invalid quantity "${qtyRaw}".`);
          }

          const priceRaw = getField(d, 'unit_price', 'amount', 'price');
          const unitPriceCents = parseMoneyToCents(priceRaw);
          if (unitPriceCents === null || unitPriceCents < 0n) {
            errors.push(`Row ${gr.rowNumber}: Invalid or missing "unit_price" / "amount".`);
          }

          const rawItemCode = getField(d, 'item_code', 'item');
          const matchedItem = rawItemCode ? findItem(rawItemCode) : null;
          if (rawItemCode && !matchedItem) {
            errors.push(`Row ${gr.rowNumber}: Unrecognized Item "${rawItemCode}".`);
          }

          const rawAccCode = getField(d, 'account_code', 'account', 'gl_account');
          let matchedAccount = rawAccCode ? findAccount(rawAccCode) : null;
          if (rawAccCode && !matchedAccount) {
            errors.push(`Row ${gr.rowNumber}: Unrecognized GL Account "${rawAccCode}".`);
          } else if (!matchedAccount) {
            const fallbackId = isSalesSide
              ? contact?.defaultRevenueAccountId ?? defaultRevAccount?.id
              : contact?.defaultExpenseAccountId ?? defaultExpAccount?.id;
            matchedAccount = accounts.find((a) => a.id === fallbackId) ?? null;
          }

          const rawTrack = getField(d, 'cost_centre', 'cost_center', 'tracking_option', 'tracking', 'department');
          const matchedTrack = rawTrack ? findTrackingOption(rawTrack) : null;
          if (rawTrack && !matchedTrack) {
            errors.push(`Row ${gr.rowNumber}: Unrecognized Cost Centre "${rawTrack}".`);
          }

          const taxParsed = parseTaxTreatmentOpt(
            getField(d, 'tax_treatment', 'tax', 'gst'),
            matchedAccount?.defaultTaxTreatment ?? TaxTreatment.TAX_EXCLUSIVE,
          );
          if (!taxParsed.valid) {
            errors.push(`Row ${gr.rowNumber}: Invalid tax_treatment.`);
          }

          const safePrice = unitPriceCents ?? 0n;
          const safeQty = isNaN(quantity) || quantity <= 0 ? 1 : quantity;
          const lineGrossOrNet = safePrice * BigInt(safeQty);
          const gstCalc = calculateGST(lineGrossOrNet, taxParsed.value);

          processedLines.push({
            itemId: matchedItem?.id ?? null,
            accountId: matchedAccount?.id ?? null,
            trackingOptionId: matchedTrack?.id ?? null,
            description: desc || 'Imported Line',
            quantity: safeQty,
            unitPriceCents: safePrice,
            amountCents: gstCalc.subtotalCents,
            taxTreatment: taxParsed.value,
            gstCents: gstCalc.gstCents,
            totalCents: gstCalc.totalCents,
          });
        }

        const totals = sumGSTResults(
          processedLines.map((l) => ({
            subtotalCents: l.amountCents,
            gstCents: l.gstCents,
            totalCents: l.totalCents,
          })),
        );

        badges.push(`${processedLines.length} line(s)`);

        previewRecords.push({
          rowNumbers: rowNums,
          identifier: docRef,
          primaryLabel: `${docRef} — ${contact?.name || rawContact || 'Unknown Contact'}`,
          secondaryLabel: `${issueDate ? issueDate.toISOString().slice(0, 10) : 'Invalid Date'} • ${processedLines[0]?.description || ''}`,
          statusBadge: targetStatus,
          amountCents: Number(totals.totalCents),
          resolvedBadges: badges,
          valid: errors.length === 0,
          errors,
          payload: {
            docRef,
            contactId: contact?.id ?? null,
            contactName: contact?.name ?? '',
            issueDate,
            secondaryDate,
            status: targetStatus,
            notes: getField(first, 'notes') || null,
            subtotalCents: totals.subtotalCents,
            gstCents: totals.gstCents,
            totalCents: totals.totalCents,
            lines: processedLines,
          },
        });
      }
    }

    // =========================================================================
    // 7 & 10: CREDIT_NOTES (AR) & VENDOR_CREDITS (AP)
    // =========================================================================
    else if (entityType === 'CREDIT_NOTES' || entityType === 'VENDOR_CREDITS') {
      const isAr = entityType === 'CREDIT_NOTES';
      const groups = new Map<string, Array<{ rowNumber: number; data: Record<string, string> }>>();
      for (const r of rawRows) {
        const key =
          getField(r.data, 'credit_note_number', 'vendor_credit_number', 'reference', 'document_number') ||
          `ROW-${r.rowNumber}`;
        const list = groups.get(key) ?? [];
        list.push(r);
        groups.set(key, list);
      }

      for (const [docRef, groupRows] of groups.entries()) {
        const first = groupRows[0]!.data;
        const errors: string[] = [];
        const badges: string[] = [];
        const rowNums = groupRows.map((g) => g.rowNumber).join(', ');

        if (docRef.startsWith('ROW-')) {
          errors.push(`Missing required "${isAr ? 'credit_note_number' : 'reference'}" column.`);
        }

        const rawContact = getField(first, 'contact_name', 'contact', 'customer', 'supplier', 'vendor');
        const contact = findContact(rawContact);
        if (!rawContact) {
          errors.push('Missing required "contact_name" column.');
        } else if (!contact) {
          errors.push(`Unrecognized Contact "${rawContact}".`);
        } else {
          badges.push(`Contact: ${contact.name}`);
        }

        const issueDate = parseDateValue(getField(first, 'issue_date', 'date'));
        if (!issueDate) {
          errors.push('Invalid or missing "issue_date".');
        } else if (org?.lockDate && issueDate <= org.lockDate) {
          errors.push(`Date falls within locked accounting period.`);
        }

        const rawStatus = getField(first, 'status').toUpperCase();
        const targetStatus = ['ISSUED', 'APPROVED', 'POSTED'].includes(rawStatus)
          ? CreditNoteStatus.ISSUED
          : CreditNoteStatus.DRAFT;

        if (isAr) {
          const dup = await fastify.prisma.creditNote.findFirst({
            where: { organizationId, creditNoteNumber: docRef },
            select: { id: true },
          });
          if (dup) errors.push(`Credit note number "${docRef}" already exists.`);
        }

        const processedLines: Array<{
          accountId: string | null;
          trackingOptionId: string | null;
          description: string;
          amountCents: bigint;
          taxTreatment: TaxTreatment;
          gstCents: bigint;
          totalCents: bigint;
        }> = [];

        for (const gr of groupRows) {
          const d = gr.data;
          const desc = getField(d, 'description', 'line_description');
          if (!desc) errors.push(`Row ${gr.rowNumber}: Missing "description".`);

          const amtRaw = getField(d, 'amount', 'unit_price');
          const amtCents = parseMoneyToCents(amtRaw);
          if (amtCents === null || amtCents <= 0n) {
            errors.push(`Row ${gr.rowNumber}: Invalid or missing "amount".`);
          }

          const rawAcc = getField(d, 'account_code', 'account');
          let matchedAcc = rawAcc ? findAccount(rawAcc) : null;
          if (rawAcc && !matchedAcc) {
            errors.push(`Row ${gr.rowNumber}: Unrecognized GL Account "${rawAcc}".`);
          } else if (!matchedAcc) {
            matchedAcc = isAr ? defaultRevAccount : defaultExpAccount;
          }

          const rawTrack = getField(d, 'cost_centre', 'cost_center', 'tracking_option');
          const matchedTrack = rawTrack ? findTrackingOption(rawTrack) : null;
          if (rawTrack && !matchedTrack) {
            errors.push(`Row ${gr.rowNumber}: Unrecognized Cost Centre "${rawTrack}".`);
          }

          const taxParsed = parseTaxTreatmentOpt(getField(d, 'tax_treatment', 'tax'));
          if (!taxParsed.valid) errors.push(`Row ${gr.rowNumber}: Invalid tax_treatment.`);

          const gstCalc = calculateGST(amtCents ?? 0n, taxParsed.value);
          processedLines.push({
            accountId: matchedAcc?.id ?? null,
            trackingOptionId: matchedTrack?.id ?? null,
            description: desc || 'Credit Line',
            amountCents: gstCalc.subtotalCents,
            taxTreatment: taxParsed.value,
            gstCents: gstCalc.gstCents,
            totalCents: gstCalc.totalCents,
          });
        }

        const totals = sumGSTResults(
          processedLines.map((l) => ({
            subtotalCents: l.amountCents,
            gstCents: l.gstCents,
            totalCents: l.totalCents,
          })),
        );

        previewRecords.push({
          rowNumbers: rowNums,
          identifier: docRef,
          primaryLabel: `${docRef} — ${contact?.name || rawContact}`,
          secondaryLabel: `${issueDate ? issueDate.toISOString().slice(0, 10) : ''} • ${processedLines[0]?.description || ''}`,
          statusBadge: targetStatus,
          amountCents: Number(totals.totalCents),
          resolvedBadges: badges,
          valid: errors.length === 0,
          errors,
          payload: {
            docRef,
            contactId: contact?.id ?? null,
            contactName: contact?.name ?? '',
            issueDate,
            status: targetStatus,
            notes: getField(first, 'notes') || null,
            subtotalCents: totals.subtotalCents,
            gstCents: totals.gstCents,
            totalCents: totals.totalCents,
            lines: processedLines,
          },
        });
      }
    }

    // =========================================================================
    // 11. DIRECT_TRANSACTIONS (Spend Money & Receive Money)
    // =========================================================================
    else if (entityType === 'DIRECT_TRANSACTIONS') {
      for (const r of rawRows) {
        const d = r.data;
        const errors: string[] = [];
        const badges: string[] = [];

        const txDate = parseDateValue(getField(d, 'transaction_date', 'date'));
        if (!txDate) {
          errors.push('Invalid or missing "transaction_date".');
        } else if (org?.lockDate && txDate <= org.lockDate) {
          errors.push('Transaction date falls on or before organization lock date.');
        }

        const rawType = getField(d, 'type', 'transaction_type').toUpperCase() || 'SPEND_MONEY';
        const txType: DirectTransactionType =
          rawType === 'RECEIVE_MONEY' || rawType === 'INCOME' || rawType === 'DEPOSIT'
            ? DirectTransactionType.RECEIVE_MONEY
            : DirectTransactionType.SPEND_MONEY;

        const rawBank = getField(d, 'bank_account_code', 'bank_account');
        const bankAcc = rawBank
          ? findAccount(rawBank)
          : accounts.find((a) => a.code === '1000');
        if (!bankAcc) {
          errors.push(`Unrecognized bank_account_code "${rawBank}".`);
        } else {
          badges.push(`Bank: ${bankAcc.code}`);
        }

        const rawContact = getField(d, 'contact_name', 'contact', 'merchant', 'supplier');
        const contact = rawContact ? findContact(rawContact) : null;
        if (rawContact && !contact) {
          errors.push(`Unrecognized Contact "${rawContact}" (strict match required when provided).`);
        } else if (contact) {
          badges.push(`Contact: ${contact.name}`);
        }

        const rawAcc = getField(d, 'account_code', 'account', 'gl_account');
        let targetAcc = rawAcc ? findAccount(rawAcc) : null;
        if (rawAcc && !targetAcc) {
          errors.push(`Unrecognized GL Account "${rawAcc}".`);
        } else if (!targetAcc) {
          targetAcc =
            txType === DirectTransactionType.RECEIVE_MONEY ? defaultRevAccount : defaultExpAccount;
        }
        if (targetAcc) badges.push(`GL: ${targetAcc.code}`);

        const rawTrack = getField(d, 'cost_centre', 'cost_center', 'tracking_option');
        const matchedTrack = rawTrack ? findTrackingOption(rawTrack) : null;
        if (rawTrack && !matchedTrack) {
          errors.push(`Unrecognized Cost Centre "${rawTrack}".`);
        } else if (matchedTrack) {
          badges.push(`CC: ${matchedTrack.name}`);
        }

        const desc = getField(d, 'description', 'narrative');
        if (!desc) errors.push('Missing required "description".');

        const amtCents = parseMoneyToCents(getField(d, 'amount'));
        if (amtCents === null || amtCents <= 0n) {
          errors.push('Invalid or missing positive "amount".');
        }

        const taxParsed = parseTaxTreatmentOpt(
          getField(d, 'tax_treatment', 'tax'),
          TaxTreatment.TAX_INCLUSIVE,
        );
        if (!taxParsed.valid) errors.push('Invalid tax_treatment.');

        const gstCalc = calculateGST(amtCents ?? 0n, taxParsed.value);

        previewRecords.push({
          rowNumbers: `${r.rowNumber}`,
          identifier: getField(d, 'reference') || `TX-Row-${r.rowNumber}`,
          primaryLabel: `${contact?.name || getField(d, 'payee_name') || desc}`,
          secondaryLabel: `${txDate ? txDate.toISOString().slice(0, 10) : ''} • ${desc}`,
          statusBadge: txType,
          amountCents: Number(gstCalc.totalCents),
          resolvedBadges: badges,
          valid: errors.length === 0,
          errors,
          payload: {
            type: txType,
            bankAccountId: bankAcc?.id ?? null,
            contactId: contact?.id ?? null,
            payeeName: contact?.name ?? (getField(d, 'payee_name') || desc),
            transactionDate: txDate,
            reference: getField(d, 'reference') || null,
            description: desc,
            accountId: targetAcc?.id ?? null,
            trackingOptionId: matchedTrack?.id ?? null,
            taxTreatment: taxParsed.value,
            subtotalCents: gstCalc.subtotalCents,
            gstCents: gstCalc.gstCents,
            totalCents: gstCalc.totalCents,
            notes: getField(d, 'notes') || null,
          },
        });
      }
    }

    // =========================================================================
    // 12. EXPENSE_CLAIMS
    // =========================================================================
    else if (entityType === 'EXPENSE_CLAIMS') {
      const groups = new Map<string, Array<{ rowNumber: number; data: Record<string, string> }>>();
      for (const r of rawRows) {
        const key = getField(r.data, 'claim_number', 'title') || `ROW-${r.rowNumber}`;
        const list = groups.get(key) ?? [];
        list.push(r);
        groups.set(key, list);
      }

      for (const [claimKey, groupRows] of groups.entries()) {
        const first = groupRows[0]!.data;
        const errors: string[] = [];
        const badges: string[] = [];
        const rowNums = groupRows.map((g) => g.rowNumber).join(', ');

        const claimNumber = getField(first, 'claim_number') || `EXP-${Math.floor(1000 + Math.random() * 9000)}`;
        const title = getField(first, 'title') || claimNumber;

        const empEmail = getField(first, 'employee_email', 'email').toLowerCase();
        let empUserId = actorUserId;
        if (empEmail) {
          const foundMember = orgMembers.find((m) => m.user.email.toLowerCase() === empEmail);
          if (!foundMember) {
            errors.push(`Unrecognized employee_email "${empEmail}" in organization members.`);
          } else {
            empUserId = foundMember.userId;
            badges.push(`Employee: ${foundMember.user.name}`);
          }
        }

        const rawStatus = getField(first, 'status').toUpperCase();
        const targetStatus =
          rawStatus === 'APPROVED' || rawStatus === 'POSTED'
            ? ExpenseClaimStatus.APPROVED
            : rawStatus === 'SUBMITTED'
            ? ExpenseClaimStatus.SUBMITTED
            : ExpenseClaimStatus.DRAFT;

        const itemsList: Array<{
          expenseDate: Date;
          merchant: string;
          description: string;
          accountId: string;
          trackingOptionId: string | null;
          amountCents: bigint;
          taxTreatment: TaxTreatment;
          gstCents: bigint;
          totalCents: bigint;
        }> = [];

        for (const gr of groupRows) {
          const d = gr.data;
          const expDate = parseDateValue(getField(d, 'expense_date', 'date'));
          if (!expDate) errors.push(`Row ${gr.rowNumber}: Invalid "expense_date".`);

          const merchant = getField(d, 'merchant', 'supplier', 'contact_name');
          if (!merchant) errors.push(`Row ${gr.rowNumber}: Missing "merchant".`);

          const desc = getField(d, 'description');
          if (!desc) errors.push(`Row ${gr.rowNumber}: Missing "description".`);

          const amtCents = parseMoneyToCents(getField(d, 'amount'));
          if (amtCents === null || amtCents <= 0n) {
            errors.push(`Row ${gr.rowNumber}: Invalid "amount".`);
          }

          const rawAcc = getField(d, 'account_code', 'account');
          const matchedAcc = rawAcc ? findAccount(rawAcc) : defaultExpAccount;
          if (rawAcc && !matchedAcc) {
            errors.push(`Row ${gr.rowNumber}: Unrecognized GL Account "${rawAcc}".`);
          }

          const rawTrack = getField(d, 'cost_centre', 'cost_center', 'tracking_option');
          const matchedTrack = rawTrack ? findTrackingOption(rawTrack) : null;
          if (rawTrack && !matchedTrack) {
            errors.push(`Row ${gr.rowNumber}: Unrecognized Cost Centre "${rawTrack}".`);
          }

          const taxParsed = parseTaxTreatmentOpt(
            getField(d, 'tax_treatment', 'tax'),
            TaxTreatment.TAX_INCLUSIVE,
          );
          const gstCalc = calculateGST(amtCents ?? 0n, taxParsed.value);

          itemsList.push({
            expenseDate: expDate ?? new Date(),
            merchant: merchant || 'Merchant',
            description: desc || 'Expense',
            accountId: matchedAcc?.id ?? defaultExpAccount?.id ?? '',
            trackingOptionId: matchedTrack?.id ?? null,
            amountCents: gstCalc.subtotalCents,
            taxTreatment: taxParsed.value,
            gstCents: gstCalc.gstCents,
            totalCents: gstCalc.totalCents,
          });
        }

        const totals = sumGSTResults(
          itemsList.map((it) => ({
            subtotalCents: it.amountCents,
            gstCents: it.gstCents,
            totalCents: it.totalCents,
          })),
        );

        badges.push(`${itemsList.length} item(s)`);

        previewRecords.push({
          rowNumbers: rowNums,
          identifier: claimNumber,
          primaryLabel: `${claimNumber} — ${title}`,
          secondaryLabel: `${itemsList.length} item(s) • ${itemsList[0]?.merchant || ''}`,
          statusBadge: targetStatus,
          amountCents: Number(totals.totalCents),
          resolvedBadges: badges,
          valid: errors.length === 0,
          errors,
          payload: {
            claimNumber,
            title,
            employeeUserId: empUserId,
            status: targetStatus,
            notes: getField(first, 'notes') || null,
            subtotalCents: totals.subtotalCents,
            gstCents: totals.gstCents,
            totalCents: totals.totalCents,
            items: itemsList,
          },
        });
      }
    }

    // =========================================================================
    // 13. JOURNAL_ENTRIES (Manual Double-Entry GL Journals)
    // =========================================================================
    else if (entityType === 'JOURNAL_ENTRIES') {
      const groups = new Map<string, Array<{ rowNumber: number; data: Record<string, string> }>>();
      for (const r of rawRows) {
        const key = getField(r.data, 'entry_number', 'reference') || `ROW-${r.rowNumber}`;
        const list = groups.get(key) ?? [];
        list.push(r);
        groups.set(key, list);
      }

      for (const [entryNum, groupRows] of groups.entries()) {
        const first = groupRows[0]!.data;
        const errors: string[] = [];
        const badges: string[] = [];
        const rowNums = groupRows.map((g) => g.rowNumber).join(', ');

        const postedDate = parseDateValue(getField(first, 'posted_date', 'date'));
        if (!postedDate) {
          errors.push('Invalid or missing "posted_date".');
        } else if (org?.lockDate && postedDate <= org.lockDate) {
          errors.push('Posted date falls on or before organization lock date.');
        }

        const desc = getField(first, 'description', 'narrative');
        if (!desc) errors.push('Missing journal "description".');

        const rawStatus = getField(first, 'status').toUpperCase();
        const targetStatus =
          rawStatus === 'DRAFT' ? JournalStatus.DRAFT : JournalStatus.POSTED;

        const jnlLines: Array<{
          accountId: string;
          trackingOptionId: string | null;
          description: string;
          entryType: EntryType;
          amountCents: bigint;
        }> = [];

        let debitSum = 0n;
        let creditSum = 0n;

        for (const gr of groupRows) {
          const d = gr.data;
          const rawAcc = getField(d, 'account_code', 'account');
          const matchedAcc = findAccount(rawAcc);
          if (!rawAcc || !matchedAcc) {
            errors.push(`Row ${gr.rowNumber}: Unrecognized GL Account "${rawAcc}".`);
          }

          const rawTrack = getField(d, 'cost_centre', 'cost_center', 'tracking_option');
          const matchedTrack = rawTrack ? findTrackingOption(rawTrack) : null;
          if (rawTrack && !matchedTrack) {
            errors.push(`Row ${gr.rowNumber}: Unrecognized Cost Centre "${rawTrack}".`);
          }

          const rawEntryType = getField(d, 'entry_type', 'type').toUpperCase();
          if (rawEntryType !== 'DEBIT' && rawEntryType !== 'CREDIT' && rawEntryType !== 'DR' && rawEntryType !== 'CR') {
            errors.push(`Row ${gr.rowNumber}: entry_type must be DEBIT or CREDIT.`);
          }
          const entryType =
            rawEntryType === 'CREDIT' || rawEntryType === 'CR'
              ? EntryType.CREDIT
              : EntryType.DEBIT;

          const amtCents = parseMoneyToCents(getField(d, 'amount'));
          if (amtCents === null || amtCents <= 0n) {
            errors.push(`Row ${gr.rowNumber}: Invalid positive "amount".`);
          } else {
            if (entryType === EntryType.DEBIT) debitSum += amtCents;
            else creditSum += amtCents;
          }

          jnlLines.push({
            accountId: matchedAcc?.id ?? '',
            trackingOptionId: matchedTrack?.id ?? null,
            description: getField(d, 'line_description', 'description') || desc,
            entryType,
            amountCents: amtCents ?? 0n,
          });
        }

        if (jnlLines.length < 2) {
          errors.push('A journal entry requires at least 2 lines (1 debit and 1 credit).');
        }
        if (debitSum !== creditSum) {
          errors.push(
            `Unbalanced journal: Debits ($${(Number(debitSum) / 100).toFixed(2)}) != Credits ($${(Number(creditSum) / 100).toFixed(2)}).`,
          );
        }

        badges.push(`${jnlLines.length} lines`);

        previewRecords.push({
          rowNumbers: rowNums,
          identifier: entryNum,
          primaryLabel: `${entryNum} — ${desc}`,
          secondaryLabel: `${postedDate ? postedDate.toISOString().slice(0, 10) : ''} • DR/CR $${(Number(debitSum) / 100).toFixed(2)}`,
          statusBadge: targetStatus,
          amountCents: Number(debitSum),
          resolvedBadges: badges,
          valid: errors.length === 0,
          errors,
          payload: {
            entryNumber: entryNum,
            postedDate,
            status: targetStatus,
            description: desc,
            lines: jnlLines,
          },
        });
      }
    }

    const validRecords = previewRecords.filter((r) => r.valid);
    const invalidRecords = previewRecords.filter((r) => !r.valid);

    if (!commit) {
      return {
        entityType,
        totalRecords: previewRecords.length,
        validCount: validRecords.length,
        invalidCount: invalidRecords.length,
        records: previewRecords.map(({ payload, ...rest }) => rest),
      };
    }

    if (validRecords.length === 0) {
      throw new Error('No valid records available to commit.');
    }

    // =========================================================================
    // STEP 2: ATOMIC COMMIT OF VALIDATED RECORDS
    // =========================================================================
    const committedCount = await fastify.prisma.$transaction(async (tx) => {
      let count = 0;

      for (const rec of validRecords) {
        const p = rec.payload;

        if (entityType === 'CONTACTS') {
          await tx.contact.create({
            data: {
              organizationId,
              name: p.name,
              type: p.type,
              legalName: p.legalName,
              abn: p.abn,
              email: p.email,
              phone: p.phone,
              billingAddress: p.billingAddress,
              paymentTermsDays: p.paymentTermsDays,
              defaultRevenueAccountId: p.defaultRevenueAccountId,
              defaultExpenseAccountId: p.defaultExpenseAccountId,
              bankBsb: p.bankBsb,
              bankAccountNumber: p.bankAccountNumber,
              bankAccountName: p.bankAccountName,
              isActive: true,
            },
          });
          count++;
        } else if (entityType === 'ITEMS') {
          await tx.item.upsert({
            where: {
              organizationId_code: { organizationId, code: p.code },
            },
            update: {
              name: p.name,
              saleUnitPriceCents: p.saleUnitPriceCents,
              saleTaxTreatment: p.saleTaxTreatment,
              incomeAccountId: p.incomeAccountId,
              saleDescription: p.saleDescription,
              purchaseUnitPriceCents: p.purchaseUnitPriceCents,
              purchaseTaxTreatment: p.purchaseTaxTreatment,
              expenseAccountId: p.expenseAccountId,
              purchaseDescription: p.purchaseDescription,
              isActive: true,
            },
            create: {
              organizationId,
              code: p.code,
              name: p.name,
              saleUnitPriceCents: p.saleUnitPriceCents,
              saleTaxTreatment: p.saleTaxTreatment,
              incomeAccountId: p.incomeAccountId,
              saleDescription: p.saleDescription,
              purchaseUnitPriceCents: p.purchaseUnitPriceCents,
              purchaseTaxTreatment: p.purchaseTaxTreatment,
              expenseAccountId: p.expenseAccountId,
              purchaseDescription: p.purchaseDescription,
              isActive: true,
            },
          });
          count++;
        } else if (entityType === 'ACCOUNTS') {
          await tx.account.upsert({
            where: {
              organizationId_code: { organizationId, code: p.code },
            },
            update: {
              name: p.name,
              type: p.type,
              normalBalance: p.normalBalance,
              parentId: p.parentId,
              defaultTaxTreatment: p.defaultTaxTreatment,
              isBankAccount: p.isBankAccount,
              bankBsb: p.bankBsb,
              bankAccountNumber: p.bankAccountNumber,
              isActive: true,
            },
            create: {
              organizationId,
              code: p.code,
              name: p.name,
              type: p.type,
              normalBalance: p.normalBalance,
              parentId: p.parentId,
              defaultTaxTreatment: p.defaultTaxTreatment,
              isBankAccount: p.isBankAccount,
              bankBsb: p.bankBsb,
              bankAccountNumber: p.bankAccountNumber,
              isActive: true,
            },
          });
          count++;
        } else if (entityType === 'TRACKING_OPTIONS') {
          const cat = await tx.trackingCategory.upsert({
            where: {
              organizationId_name: { organizationId, name: p.categoryName },
            },
            update: { isActive: true },
            create: {
              organizationId,
              name: p.categoryName,
              description: p.categoryDesc,
              isActive: true,
            },
          });
          await tx.trackingOption.upsert({
            where: {
              trackingCategoryId_name: {
                trackingCategoryId: cat.id,
                name: p.optionName,
              },
            },
            update: {
              code: p.optionCode,
              isActive: true,
            },
            create: {
              organizationId,
              trackingCategoryId: cat.id,
              name: p.optionName,
              code: p.optionCode,
              isActive: true,
            },
          });
          count++;
        } else if (entityType === 'INVOICES') {
          const inv = await tx.invoice.create({
            data: {
              organizationId,
              contactId: p.contactId,
              invoiceNumber: p.docRef,
              issueDate: p.issueDate,
              dueDate: p.secondaryDate ?? p.issueDate,
              status: p.status,
              subtotalCents: p.subtotalCents,
              gstCents: p.gstCents,
              totalCents: p.totalCents,
              amountPaidCents: 0n,
              notes: p.notes,
              createdByUserId: actorUserId,
              approvedByUserId: p.status === InvoiceStatus.ISSUED ? actorUserId : null,
              lineItems: {
                create: p.lines.map((l: any) => ({
                  organizationId,
                  itemId: l.itemId,
                  accountId: l.accountId,
                  trackingOptionId: l.trackingOptionId,
                  description: l.description,
                  quantity: l.quantity,
                  unitPriceCents: l.unitPriceCents,
                  amountCents: l.amountCents,
                  taxTreatment: l.taxTreatment,
                  gstCents: l.gstCents,
                  totalCents: l.totalCents,
                })),
              },
            },
          });

          if (p.status === InvoiceStatus.ISSUED && p.totalCents > 0n && arAccount) {
            const jLines: Array<{
              accountId: string;
              trackingOptionId?: string | null;
              entryType: EntryType;
              amountCents: bigint;
              description?: string;
            }> = [
              {
                accountId: arAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: p.totalCents,
                description: `Invoice ${inv.invoiceNumber} - ${p.contactName}`,
              },
            ];
            for (const l of p.lines) {
              if (l.amountCents > 0n) {
                jLines.push({
                  accountId: l.accountId || defaultRevAccount!.id,
                  trackingOptionId: l.trackingOptionId,
                  entryType: EntryType.CREDIT,
                  amountCents: l.amountCents,
                  description: `${inv.invoiceNumber}: ${l.description}`,
                });
              }
            }
            if (p.gstCents > 0n && gstCollectedAccount) {
              jLines.push({
                accountId: gstCollectedAccount.id,
                entryType: EntryType.CREDIT,
                amountCents: p.gstCents,
                description: `GST Collected on Invoice ${inv.invoiceNumber}`,
              });
            }
            await postJournalEntry(tx, {
              organizationId,
              actorUserId,
              description: `Invoice ${inv.invoiceNumber} issued to ${p.contactName}`,
              referenceType: 'INVOICE',
              referenceId: inv.id,
              postedAt: p.issueDate,
              status: JournalStatus.POSTED,
              lines: jLines,
            });
          }
          count++;
        } else if (entityType === 'QUOTES') {
          await tx.quote.create({
            data: {
              organizationId,
              contactId: p.contactId,
              quoteNumber: p.docRef,
              issueDate: p.issueDate,
              expiryDate: p.secondaryDate ?? p.issueDate,
              status: p.status,
              subtotalCents: p.subtotalCents,
              gstCents: p.gstCents,
              totalCents: p.totalCents,
              notes: p.notes,
              createdByUserId: actorUserId,
              lineItems: {
                create: p.lines.map((l: any) => ({
                  organizationId,
                  itemId: l.itemId,
                  accountId: l.accountId,
                  trackingOptionId: l.trackingOptionId,
                  description: l.description,
                  quantity: l.quantity,
                  unitPriceCents: l.unitPriceCents,
                  amountCents: l.amountCents,
                  taxTreatment: l.taxTreatment,
                  gstCents: l.gstCents,
                  totalCents: l.totalCents,
                })),
              },
            },
          });
          count++;
        } else if (entityType === 'CREDIT_NOTES') {
          const cn = await tx.creditNote.create({
            data: {
              organizationId,
              contactId: p.contactId,
              creditNoteNumber: p.docRef,
              issueDate: p.issueDate,
              status: p.status,
              subtotalCents: p.subtotalCents,
              gstCents: p.gstCents,
              totalCents: p.totalCents,
              amountAppliedCents: 0n,
              notes: p.notes,
              createdByUserId: actorUserId,
              lineItems: {
                create: p.lines.map((l: any) => ({
                  organizationId,
                  accountId: l.accountId,
                  trackingOptionId: l.trackingOptionId,
                  description: l.description,
                  amountCents: l.amountCents,
                  taxTreatment: l.taxTreatment,
                  gstCents: l.gstCents,
                  totalCents: l.totalCents,
                })),
              },
            },
          });

          if (p.status === CreditNoteStatus.ISSUED && p.totalCents > 0n && arAccount) {
            const jLines: Array<{
              accountId: string;
              trackingOptionId?: string | null;
              entryType: EntryType;
              amountCents: bigint;
              description?: string;
            }> = [];
            for (const l of p.lines) {
              if (l.amountCents > 0n) {
                jLines.push({
                  accountId: l.accountId || defaultRevAccount!.id,
                  trackingOptionId: l.trackingOptionId,
                  entryType: EntryType.DEBIT,
                  amountCents: l.amountCents,
                  description: `Credit Note ${cn.creditNoteNumber}: ${l.description}`,
                });
              }
            }
            if (p.gstCents > 0n && gstCollectedAccount) {
              jLines.push({
                accountId: gstCollectedAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: p.gstCents,
                description: `GST Reversal on Credit Note ${cn.creditNoteNumber}`,
              });
            }
            jLines.push({
              accountId: arAccount.id,
              entryType: EntryType.CREDIT,
              amountCents: p.totalCents,
              description: `Credit Note ${cn.creditNoteNumber} - ${p.contactName}`,
            });
            await postJournalEntry(tx, {
              organizationId,
              actorUserId,
              description: `Customer Credit Note ${cn.creditNoteNumber} (${p.contactName})`,
              referenceType: 'CREDIT_NOTE',
              referenceId: cn.id,
              postedAt: p.issueDate,
              status: JournalStatus.POSTED,
              lines: jLines,
            });
          }
          count++;
        } else if (entityType === 'BILLS') {
          const bill = await tx.bill.create({
            data: {
              organizationId,
              contactId: p.contactId,
              reference: p.docRef,
              issueDate: p.issueDate,
              dueDate: p.secondaryDate ?? p.issueDate,
              status: p.status,
              subtotalCents: p.subtotalCents,
              gstCents: p.gstCents,
              totalCents: p.totalCents,
              amountPaidCents: 0n,
              notes: p.notes,
              createdByUserId: actorUserId,
              approvedByUserId: p.status === BillStatus.AWAITING_PAYMENT ? actorUserId : null,
              lineItems: {
                create: p.lines.map((l: any) => ({
                  organizationId,
                  itemId: l.itemId,
                  accountId: l.accountId,
                  trackingOptionId: l.trackingOptionId,
                  description: l.description,
                  quantity: l.quantity,
                  unitPriceCents: l.unitPriceCents,
                  amountCents: l.amountCents,
                  taxTreatment: l.taxTreatment,
                  gstCents: l.gstCents,
                  totalCents: l.totalCents,
                })),
              },
            },
          });

          if (p.status === BillStatus.AWAITING_PAYMENT && p.totalCents > 0n && apAccount) {
            const jLines: Array<{
              accountId: string;
              trackingOptionId?: string | null;
              entryType: EntryType;
              amountCents: bigint;
              description?: string;
            }> = [];
            for (const l of p.lines) {
              if (l.amountCents > 0n) {
                jLines.push({
                  accountId: l.accountId || defaultExpAccount!.id,
                  trackingOptionId: l.trackingOptionId,
                  entryType: EntryType.DEBIT,
                  amountCents: l.amountCents,
                  description: `${bill.reference}: ${l.description}`,
                });
              }
            }
            if (p.gstCents > 0n && gstPaidAccount) {
              jLines.push({
                accountId: gstPaidAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: p.gstCents,
                description: `GST Paid on Bill ${bill.reference}`,
              });
            }
            jLines.push({
              accountId: apAccount.id,
              entryType: EntryType.CREDIT,
              amountCents: p.totalCents,
              description: `Bill ${bill.reference} - ${p.contactName}`,
            });
            await postJournalEntry(tx, {
              organizationId,
              actorUserId,
              description: `Bill ${bill.reference} from ${p.contactName}`,
              referenceType: 'BILL',
              referenceId: bill.id,
              postedAt: p.issueDate,
              status: JournalStatus.POSTED,
              lines: jLines,
            });
          }
          count++;
        } else if (entityType === 'PURCHASE_ORDERS') {
          await tx.purchaseOrder.create({
            data: {
              organizationId,
              contactId: p.contactId,
              poNumber: p.docRef,
              issueDate: p.issueDate,
              deliveryDate: p.secondaryDate ?? null,
              status: p.status,
              subtotalCents: p.subtotalCents,
              gstCents: p.gstCents,
              totalCents: p.totalCents,
              notes: p.notes,
              createdByUserId: actorUserId,
              approvedByUserId: p.status === PurchaseOrderStatus.APPROVED ? actorUserId : null,
              lineItems: {
                create: p.lines.map((l: any) => ({
                  organizationId,
                  itemId: l.itemId,
                  accountId: l.accountId,
                  trackingOptionId: l.trackingOptionId,
                  description: l.description,
                  quantity: l.quantity,
                  unitPriceCents: l.unitPriceCents,
                  amountCents: l.amountCents,
                  taxTreatment: l.taxTreatment,
                  gstCents: l.gstCents,
                  totalCents: l.totalCents,
                })),
              },
            },
          });
          count++;
        } else if (entityType === 'VENDOR_CREDITS') {
          const vc = await tx.vendorCredit.create({
            data: {
              organizationId,
              contactId: p.contactId,
              reference: p.docRef,
              issueDate: p.issueDate,
              status: p.status,
              subtotalCents: p.subtotalCents,
              gstCents: p.gstCents,
              totalCents: p.totalCents,
              amountAppliedCents: 0n,
              notes: p.notes,
              createdByUserId: actorUserId,
              lineItems: {
                create: p.lines.map((l: any) => ({
                  organizationId,
                  accountId: l.accountId,
                  trackingOptionId: l.trackingOptionId,
                  description: l.description,
                  amountCents: l.amountCents,
                  taxTreatment: l.taxTreatment,
                  gstCents: l.gstCents,
                  totalCents: l.totalCents,
                })),
              },
            },
          });

          if (p.status === CreditNoteStatus.ISSUED && p.totalCents > 0n && apAccount) {
            const jLines: Array<{
              accountId: string;
              trackingOptionId?: string | null;
              entryType: EntryType;
              amountCents: bigint;
              description?: string;
            }> = [
              {
                accountId: apAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: p.totalCents,
                description: `Vendor Credit ${vc.reference} - ${p.contactName}`,
              },
            ];
            for (const l of p.lines) {
              if (l.amountCents > 0n) {
                jLines.push({
                  accountId: l.accountId || defaultExpAccount!.id,
                  trackingOptionId: l.trackingOptionId,
                  entryType: EntryType.CREDIT,
                  amountCents: l.amountCents,
                  description: `Vendor Credit ${vc.reference}: ${l.description}`,
                });
              }
            }
            if (p.gstCents > 0n && gstPaidAccount) {
              jLines.push({
                accountId: gstPaidAccount.id,
                entryType: EntryType.CREDIT,
                amountCents: p.gstCents,
                description: `GST Reversal on Vendor Credit ${vc.reference}`,
              });
            }
            await postJournalEntry(tx, {
              organizationId,
              actorUserId,
              description: `Vendor Credit ${vc.reference} (${p.contactName})`,
              referenceType: 'VENDOR_CREDIT',
              referenceId: vc.id,
              postedAt: p.issueDate,
              status: JournalStatus.POSTED,
              lines: jLines,
            });
          }
          count++;
        } else if (entityType === 'DIRECT_TRANSACTIONS') {
          const dtx = await tx.directTransaction.create({
            data: {
              organizationId,
              type: p.type,
              bankAccountId: p.bankAccountId,
              contactId: p.contactId,
              payeeName: p.payeeName,
              transactionDate: p.transactionDate,
              reference: p.reference,
              subtotalCents: p.subtotalCents,
              gstCents: p.gstCents,
              totalCents: p.totalCents,
              notes: p.notes,
              createdByUserId: actorUserId,
              lines: {
                create: [
                  {
                    organizationId,
                    accountId: p.accountId,
                    trackingOptionId: p.trackingOptionId,
                    description: p.description,
                    amountCents: p.subtotalCents,
                    taxTreatment: p.taxTreatment,
                    gstCents: p.gstCents,
                    totalCents: p.totalCents,
                  },
                ],
              },
            },
          });

          const isReceive = p.type === DirectTransactionType.RECEIVE_MONEY;
          const jLines: Array<{
            accountId: string;
            trackingOptionId?: string | null;
            entryType: EntryType;
            amountCents: bigint;
            description?: string;
          }> = [];

          if (isReceive) {
            jLines.push({
              accountId: p.bankAccountId,
              entryType: EntryType.DEBIT,
              amountCents: p.totalCents,
              description: p.description,
            });
            if (p.gstCents > 0n && gstCollectedAccount) {
              jLines.push({
                accountId: gstCollectedAccount.id,
                entryType: EntryType.CREDIT,
                amountCents: p.gstCents,
                description: `GST on ${p.description}`,
              });
            }
            jLines.push({
              accountId: p.accountId,
              trackingOptionId: p.trackingOptionId,
              entryType: EntryType.CREDIT,
              amountCents: p.subtotalCents,
              description: p.description,
            });
          } else {
            jLines.push({
              accountId: p.accountId,
              trackingOptionId: p.trackingOptionId,
              entryType: EntryType.DEBIT,
              amountCents: p.subtotalCents,
              description: p.description,
            });
            if (p.gstCents > 0n && gstPaidAccount) {
              jLines.push({
                accountId: gstPaidAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: p.gstCents,
                description: `GST on ${p.description}`,
              });
            }
            jLines.push({
              accountId: p.bankAccountId,
              entryType: EntryType.CREDIT,
              amountCents: p.totalCents,
              description: p.description,
            });
          }

          await postJournalEntry(tx, {
            organizationId,
            actorUserId,
            description: `${isReceive ? 'Receive Money' : 'Spend Money'}: ${p.payeeName}`,
            referenceType: 'DIRECT_TRANSACTION',
            referenceId: dtx.id,
            postedAt: p.transactionDate,
            status: JournalStatus.POSTED,
            lines: jLines,
          });
          count++;
        } else if (entityType === 'EXPENSE_CLAIMS') {
          const claim = await tx.expenseClaim.create({
            data: {
              organizationId,
              employeeUserId: p.employeeUserId,
              claimNumber: p.claimNumber,
              title: p.title,
              status: p.status,
              submittedAt: p.status !== ExpenseClaimStatus.DRAFT ? new Date() : null,
              approvedAt: p.status === ExpenseClaimStatus.APPROVED ? new Date() : null,
              approvedByUserId: p.status === ExpenseClaimStatus.APPROVED ? actorUserId : null,
              subtotalCents: p.subtotalCents,
              gstCents: p.gstCents,
              totalCents: p.totalCents,
              notes: p.notes,
              items: {
                create: p.items.map((it: any) => ({
                  organizationId,
                  expenseDate: it.expenseDate,
                  merchant: it.merchant,
                  description: it.description,
                  accountId: it.accountId,
                  trackingOptionId: it.trackingOptionId,
                  amountCents: it.amountCents,
                  taxTreatment: it.taxTreatment,
                  gstCents: it.gstCents,
                  totalCents: it.totalCents,
                })),
              },
            },
          });

          if (p.status === ExpenseClaimStatus.APPROVED && p.totalCents > 0n && empReimbAccount) {
            const jLines: Array<{
              accountId: string;
              trackingOptionId?: string | null;
              entryType: EntryType;
              amountCents: bigint;
              description?: string;
            }> = [];
            for (const it of p.items) {
              if (it.amountCents > 0n) {
                jLines.push({
                  accountId: it.accountId,
                  trackingOptionId: it.trackingOptionId,
                  entryType: EntryType.DEBIT,
                  amountCents: it.amountCents,
                  description: `${claim.claimNumber}: ${it.merchant} - ${it.description}`,
                });
              }
            }
            if (p.gstCents > 0n && gstPaidAccount) {
              jLines.push({
                accountId: gstPaidAccount.id,
                entryType: EntryType.DEBIT,
                amountCents: p.gstCents,
                description: `GST Paid on Expense Claim ${claim.claimNumber}`,
              });
            }
            jLines.push({
              accountId: empReimbAccount.id,
              entryType: EntryType.CREDIT,
              amountCents: p.totalCents,
              description: `Expense Claim ${claim.claimNumber} Payable`,
            });

            await postJournalEntry(tx, {
              organizationId,
              actorUserId,
              description: `Approved Expense Claim ${claim.claimNumber}: ${claim.title}`,
              referenceType: 'EXPENSE_CLAIM',
              referenceId: claim.id,
              postedAt: new Date(),
              status: JournalStatus.POSTED,
              lines: jLines,
            });
          }
          count++;
        } else if (entityType === 'JOURNAL_ENTRIES') {
          await postJournalEntry(tx, {
            organizationId,
            actorUserId,
            description: `${p.entryNumber ? `[${p.entryNumber}] ` : ''}${p.description}`,
            referenceType: 'MANUAL',
            referenceId: p.entryNumber,
            postedAt: p.postedDate,
            status: p.status,
            lines: p.lines,
          });
          count++;
        }
      }

      await recordAuditLog(tx, {
        organizationId,
        actorUserId,
        action: 'BULK_CSV_IMPORT_COMMITTED',
        entityType,
        entityId: organizationId,
        summary: `Bulk CSV imported ${count} ${entityType} record(s)`,
        metadata: {
          entityType,
          committedCount: count,
        },
      });

      return count;
    });

    return {
      entityType,
      committedCount,
      message: `Successfully imported ${committedCount} ${entityType} record(s).`,
    };
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/bulk-import/validate — Step 1: Parse & Validate Preview
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/bulk-import/validate',
    {
      preHandler: [requireRole(Role.ADMIN)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const bodyParse = ValidateOrCommitBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      try {
        const preview = await validateAndOptionallyCommit(
          organizationId,
          request.user.userId,
          bodyParse.data.entityType,
          bodyParse.data.csvContent,
          false,
        );
        return reply.code(200).send(preview);
      } catch (err: any) {
        return reply.code(400).send({
          error: err.message || 'Failed to validate CSV upload.',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/bulk-import/commit — Step 2: Commit Validated Records
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/bulk-import/commit',
    {
      preHandler: [requireRole(Role.ADMIN)],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const bodyParse = ValidateOrCommitBody.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: bodyParse.error.flatten().fieldErrors,
        });
      }

      try {
        const result = await validateAndOptionallyCommit(
          organizationId,
          request.user.userId,
          bodyParse.data.entityType,
          bodyParse.data.csvContent,
          true,
        );
        return reply.code(201).send(result);
      } catch (err: any) {
        return reply.code(400).send({
          error: err.message || 'Failed to commit bulk CSV import.',
        });
      }
    },
  );
};

export default bulkImportRoutes;
