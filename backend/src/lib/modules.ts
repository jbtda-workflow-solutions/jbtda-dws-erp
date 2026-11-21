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
    defaultEnabled: false,
    status: 'PLANNED',
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
