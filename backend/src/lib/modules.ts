/**
 * Canonical Product Module Registry & Entitlement Normalization — Module 14
 *
 * Separates commercial/functional Product Modules (used for RBAC, navigation,
 * billing/tiering, and route entitlement gating) from sequential Delivery Stages.
 *
 * Single Source of Truth: docs/modules/README.md
 */

export type ProductModuleKey =
  | 'CORE_PLATFORM'
  | 'CORE_ACCOUNTING'
  | 'RECEIVABLES'
  | 'PAYABLES'
  | 'EXPENSES'
  | 'CONNECTORS'
  | 'DOCUMENTS'
  | 'PROJECTS'
  | 'INVENTORY'
  | 'FLEET'
  | 'PAYROLL'
  | 'DEVELOPER_PORTAL';

export type ModuleTier =
  | 'BASE'
  | 'STANDARD'
  | 'PRO'
  | 'ENTERPRISE'
  | 'INTERNAL';

export type ModuleStatus = 'LIVE' | 'PLANNED' | 'DEFERRED';

export interface ProductModuleDefinition {
  key: ProductModuleKey;
  label: string;
  tier: ModuleTier;
  alwaysEnabled: boolean;
  defaultEnabled: boolean;
  status: ModuleStatus;
  stageRef: string;
  navGroup: string;
  description: string;
}

export const MODULE_REGISTRY: readonly ProductModuleDefinition[] = [
  {
    key: 'CORE_PLATFORM',
    label: 'Core Workspace, Master Data & Governance',
    tier: 'BASE',
    alwaysEnabled: true,
    defaultEnabled: true,
    status: 'LIVE',
    stageRef: 'Stages 1, 3, 12',
    navGroup: 'Workspace',
    description:
      'Multi-company workspace, 7-role RBAC, immutable audit log, contacts directory, items catalog, and admin bulk CSV import.',
  },
  {
    key: 'CORE_ACCOUNTING',
    label: 'General Ledger, Banking & ATO BAS',
    tier: 'BASE',
    alwaysEnabled: true,
    defaultEnabled: true,
    status: 'LIVE',
    stageRef: 'Stages 2, 7, 8, 11',
    navGroup: 'General Ledger',
    description:
      'Chart of Accounts, 10 protected system accounts, tracking dimensions, manual/recurring journals, bank reconciliation, financial statements, and ATO BAS.',
  },
  {
    key: 'RECEIVABLES',
    label: 'Accounts Receivable (AR) & Sales',
    tier: 'STANDARD',
    alwaysEnabled: false,
    defaultEnabled: true,
    status: 'LIVE',
    stageRef: 'Stage 4',
    navGroup: 'Operations',
    description:
      'Quotes, customer tax invoices, recurring billing, AR credit notes, customer prepayments, and incoming payment receipts.',
  },
  {
    key: 'PAYABLES',
    label: 'Accounts Payable (AP) & .ABA Batches',
    tier: 'STANDARD',
    alwaysEnabled: false,
    defaultEnabled: true,
    status: 'LIVE',
    stageRef: 'Stage 5',
    navGroup: 'Operations',
    description:
      'Purchase orders, vendor bills, recurring bills, vendor credits, single payments out, and Australian APCA .ABA batch payment exports.',
  },
  {
    key: 'EXPENSES',
    label: 'Direct Spend & Employee Expense Claims',
    tier: 'STANDARD',
    alwaysEnabled: false,
    defaultEnabled: true,
    status: 'LIVE',
    stageRef: 'Stage 6',
    navGroup: 'Operations',
    description:
      'Immediate bank/card spend money coding and employee out-of-pocket expense claims with manager approval and 2050 reimbursements.',
  },
  {
    key: 'CONNECTORS',
    label: 'Connectors Hub, API Keys & Google Workspace',
    tier: 'PRO',
    alwaysEnabled: false,
    defaultEnabled: true,
    status: 'LIVE',
    stageRef: 'Stages 15–16',
    navGroup: 'Integrations',
    description:
      'Tenant-scoped inbound Bearer API keys, AES-256-GCM token vault, and Google Workspace OAuth integrations (Drive, Sheets, Calendar).',
  },
  {
    key: 'DOCUMENTS',
    label: 'Cloud Storage Document Vault',
    tier: 'PRO',
    alwaysEnabled: false,
    defaultEnabled: false,
    status: 'DEFERRED',
    stageRef: 'Deferred D1',
    navGroup: 'Cross-Cutting',
    description:
      'Google Cloud Storage V4 presigned PDF and receipt attachment vault linked to bills, invoices, expense claims, journals, and contacts.',
  },
  {
    key: 'PROJECTS',
    label: 'Project Accounting, Time & Billing',
    tier: 'ENTERPRISE',
    alwaysEnabled: false,
    defaultEnabled: false,
    status: 'DEFERRED',
    stageRef: 'Deferred D2',
    navGroup: 'Operations',
    description:
      'Project budgets vs. actuals bound to Tracking Dimensions, time tracking, WIP capture, and 1-click client invoicing.',
  },
  {
    key: 'INVENTORY',
    label: 'Perpetual Inventory & Warehousing',
    tier: 'ENTERPRISE',
    alwaysEnabled: false,
    defaultEnabled: false,
    status: 'DEFERRED',
    stageRef: 'Deferred D3',
    navGroup: 'Operations',
    description:
      'Multi-warehouse stock levels, Weighted Average Cost valuation, PO goods receipts, and automated COGS journal posting.',
  },
  {
    key: 'FLEET',
    label: 'Fleet Management & Vehicle P&L',
    tier: 'ENTERPRISE',
    alwaysEnabled: false,
    defaultEnabled: false,
    status: 'DEFERRED',
    stageRef: 'Deferred D4',
    navGroup: 'Operations',
    description:
      'Vehicle registry bound to Tracking Dimensions with odometer/service logs and native per-vehicle Profit & Loss reporting.',
  },
  {
    key: 'PAYROLL',
    label: 'Australian Payroll & STP Phase 2',
    tier: 'ENTERPRISE',
    alwaysEnabled: false,
    defaultEnabled: false,
    status: 'DEFERRED',
    stageRef: 'Deferred D5',
    navGroup: 'People',
    description:
      'Employee pay runs, PAYG withholding, Superannuation Guarantee accruals, leave tracking, .ABA wage runs, and ATO STP Phase 2 hooks.',
  },
  {
    key: 'DEVELOPER_PORTAL',
    label: 'Developer & Agent Context Console',
    tier: 'INTERNAL',
    alwaysEnabled: false,
    defaultEnabled: true,
    status: 'LIVE',
    stageRef: 'Stages 9, 13',
    navGroup: 'Governance',
    description:
      'Admin-only in-app governance docs reader, API reference catalog, roadmap tracker, runtime diagnostics, and database table manager.',
  },
] as const;

const VALID_MODULE_KEYS = new Set<string>(MODULE_REGISTRY.map((m) => m.key));

export const ALWAYS_ENABLED_MODULES: readonly ProductModuleKey[] =
  MODULE_REGISTRY.filter((m) => m.alwaysEnabled).map((m) => m.key);

export const DEFAULT_ENABLED_MODULES: readonly ProductModuleKey[] =
  MODULE_REGISTRY.filter((m) => m.defaultEnabled).map((m) => m.key);

/**
 * Normalizes an organization's stored `enabledModules` array into canonical
 * ProductModuleKeys. Transparently migrates legacy flags (`CORE_FINANCE`,
 * `ATTACHMENTS`) so existing tenants suffer zero disruption.
 */
export function normalizeEnabledModules(
  raw: readonly string[] | null | undefined,
): ProductModuleKey[] {
  const resolved = new Set<ProductModuleKey>(ALWAYS_ENABLED_MODULES);

  if (!raw || raw.length === 0) {
    for (const def of DEFAULT_ENABLED_MODULES) {
      resolved.add(def);
    }
    return Array.from(resolved);
  }

  for (const flag of raw) {
    const normalized = flag.trim().toUpperCase();
    if (normalized === 'CORE_FINANCE') {
      resolved.add('CORE_PLATFORM');
      resolved.add('CORE_ACCOUNTING');
      resolved.add('RECEIVABLES');
      resolved.add('PAYABLES');
      resolved.add('CONNECTORS');
      resolved.add('DEVELOPER_PORTAL');
      continue;
    }
    if (normalized === 'ATTACHMENTS') {
      resolved.add('DOCUMENTS');
      continue;
    }
    if (VALID_MODULE_KEYS.has(normalized)) {
      resolved.add(normalized as ProductModuleKey);
    }
  }

  return Array.from(resolved);
}

/**
 * Checks whether a canonical ProductModuleKey is enabled for an organization.
 */
export function isModuleEnabled(
  rawEnabledModules: readonly string[] | null | undefined,
  moduleKey: ProductModuleKey,
): boolean {
  if (ALWAYS_ENABLED_MODULES.includes(moduleKey)) {
    return true;
  }
  const normalized = normalizeEnabledModules(rawEnabledModules);
  return normalized.includes(moduleKey);
}

export interface ApiKeyScopeDefinition {
  scope: string;
  domain: string;
  moduleKey: ProductModuleKey;
  access: 'READ' | 'WRITE';
  label: string;
  description: string;
}

export const API_KEY_SCOPES: readonly ApiKeyScopeDefinition[] = [
  {
    scope: 'contacts:read',
    domain: 'Contacts',
    moduleKey: 'CORE_PLATFORM',
    access: 'READ',
    label: 'Read Contacts',
    description: 'List and inspect customers, vendors, and Contact 360° profiles.',
  },
  {
    scope: 'contacts:write',
    domain: 'Contacts',
    moduleKey: 'CORE_PLATFORM',
    access: 'WRITE',
    label: 'Write Contacts',
    description: 'Create and update customer and vendor contact records.',
  },
  {
    scope: 'items:read',
    domain: 'Items Catalog',
    moduleKey: 'CORE_PLATFORM',
    access: 'READ',
    label: 'Read Items',
    description: 'List and inspect products and services catalog SKUs.',
  },
  {
    scope: 'items:write',
    domain: 'Items Catalog',
    moduleKey: 'CORE_PLATFORM',
    access: 'WRITE',
    label: 'Write Items',
    description: 'Create, update, and archive catalog items.',
  },
  {
    scope: 'accounts:read',
    domain: 'Chart of Accounts',
    moduleKey: 'CORE_ACCOUNTING',
    access: 'READ',
    label: 'Read CoA & Dimensions',
    description: 'Read GL accounts and tracking categories/options.',
  },
  {
    scope: 'accounts:write',
    domain: 'Chart of Accounts',
    moduleKey: 'CORE_ACCOUNTING',
    access: 'WRITE',
    label: 'Write CoA & Dimensions',
    description: 'Create and update custom GL accounts and tracking dimensions.',
  },
  {
    scope: 'ledger:read',
    domain: 'General Ledger',
    moduleKey: 'CORE_ACCOUNTING',
    access: 'READ',
    label: 'Read General Ledger',
    description: 'Query journal entries, account balances, and GL audit trails.',
  },
  {
    scope: 'ledger:write',
    domain: 'General Ledger',
    moduleKey: 'CORE_ACCOUNTING',
    access: 'WRITE',
    label: 'Write General Ledger',
    description: 'Post manual journals and execute journal reversals.',
  },
  {
    scope: 'banking:read',
    domain: 'Banking',
    moduleKey: 'CORE_ACCOUNTING',
    access: 'READ',
    label: 'Read Banking & Statements',
    description: 'Read bank accounts, transfers, and imported statement lines.',
  },
  {
    scope: 'banking:write',
    domain: 'Banking',
    moduleKey: 'CORE_ACCOUNTING',
    access: 'WRITE',
    label: 'Write Banking & Reconciliation',
    description: 'Import statements, create transfers, and reconcile transactions.',
  },
  {
    scope: 'reports:read',
    domain: 'Reports & BAS',
    moduleKey: 'CORE_ACCOUNTING',
    access: 'READ',
    label: 'Read Financial Reports & Dashboard',
    description: 'Read Trial Balance, P&L, Balance Sheet, Aged AR/AP, BAS, and Dashboard KPIs.',
  },
  {
    scope: 'receivables:read',
    domain: 'Receivables (AR)',
    moduleKey: 'RECEIVABLES',
    access: 'READ',
    label: 'Read Receivables',
    description: 'Read quotes, customer invoices, AR credit notes, and receipts.',
  },
  {
    scope: 'receivables:write',
    domain: 'Receivables (AR)',
    moduleKey: 'RECEIVABLES',
    access: 'WRITE',
    label: 'Write Receivables',
    description: 'Create, issue, update, and record payments on customer invoices and quotes.',
  },
  {
    scope: 'payables:read',
    domain: 'Payables (AP)',
    moduleKey: 'PAYABLES',
    access: 'READ',
    label: 'Read Payables',
    description: 'Read purchase orders, vendor bills, vendor credits, and batch payments.',
  },
  {
    scope: 'payables:write',
    domain: 'Payables (AP)',
    moduleKey: 'PAYABLES',
    access: 'WRITE',
    label: 'Write Payables',
    description: 'Create, approve, and record payments on vendor bills and purchase orders.',
  },
  {
    scope: 'expenses:read',
    domain: 'Expenses',
    moduleKey: 'EXPENSES',
    access: 'READ',
    label: 'Read Expenses',
    description: 'Read direct spend/receive transactions and employee expense claims.',
  },
  {
    scope: 'expenses:write',
    domain: 'Expenses',
    moduleKey: 'EXPENSES',
    access: 'WRITE',
    label: 'Write Expenses',
    description: 'Create and manage direct transactions and employee expense claims.',
  },
] as const;

export const VALID_API_KEY_SCOPES = new Set<string>(
  API_KEY_SCOPES.map((s) => s.scope),
);
