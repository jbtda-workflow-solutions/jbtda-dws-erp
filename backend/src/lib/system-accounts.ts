/**
 * Protected System Accounts Definition & Seeding Engine
 *
 * Every organization requires these 10 core accounts so automated sub-ledger
 * postings (AR, AP, GST, Reimbursements, Prepayments, Retained Earnings)
 * always resolve deterministically.
 */

import { AccountType, NormalBalance, TaxTreatment, type Prisma, type PrismaClient } from '@prisma/client';

export interface SystemAccountSpec {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  systemKey: string;
  isBankAccount: boolean;
  defaultTaxTreatment: TaxTreatment;
  description: string;
}

export const PROTECTED_SYSTEM_ACCOUNTS: readonly SystemAccountSpec[] = [
  {
    code: '1000',
    name: 'Operating Bank Account',
    type: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    systemKey: 'OPERATING_BANK',
    isBankAccount: true,
    defaultTaxTreatment: TaxTreatment.GST_FREE,
    description: 'Primary operating cash bank account for settlements in and out',
  },
  {
    code: '1200',
    name: 'Accounts Receivable (A/R)',
    type: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    systemKey: 'ACCOUNTS_RECEIVABLE',
    isBankAccount: false,
    defaultTaxTreatment: TaxTreatment.GST_FREE,
    description: 'Control account for outstanding customer invoices and AR credit notes',
  },
  {
    code: '2000',
    name: 'Accounts Payable (A/P)',
    type: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    systemKey: 'ACCOUNTS_PAYABLE',
    isBankAccount: false,
    defaultTaxTreatment: TaxTreatment.GST_FREE,
    description: 'Control account for unpaid supplier bills and vendor credits',
  },
  {
    code: '2050',
    name: 'Employee Reimbursements Payable',
    type: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    systemKey: 'EMPLOYEE_REIMBURSEMENTS',
    isBankAccount: false,
    defaultTaxTreatment: TaxTreatment.GST_FREE,
    description: 'Liability control account for approved staff out-of-pocket expense claims',
  },
  {
    code: '2100',
    name: 'GST Collected (Sales)',
    type: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    systemKey: 'GST_COLLECTED',
    isBankAccount: false,
    defaultTaxTreatment: TaxTreatment.GST_FREE,
    description: '10% Australian GST collected on sales to be remitted to the ATO (BAS 1A)',
  },
  {
    code: '2200',
    name: 'GST Paid (Purchases)',
    type: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    systemKey: 'GST_PAID',
    isBankAccount: false,
    defaultTaxTreatment: TaxTreatment.GST_FREE,
    description: '10% Australian GST paid on bills and expenses claimable from the ATO (BAS 1B)',
  },
  {
    code: '2300',
    name: 'Customer Prepayments / Unearned Revenue',
    type: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    systemKey: 'CUSTOMER_PREPAYMENTS',
    isBankAccount: false,
    defaultTaxTreatment: TaxTreatment.GST_FREE,
    description: 'Unallocated customer deposits and retainers received on account',
  },
  {
    code: '3000',
    name: 'Retained Earnings',
    type: AccountType.EQUITY,
    normalBalance: NormalBalance.CREDIT,
    systemKey: 'RETAINED_EARNINGS',
    isBankAccount: false,
    defaultTaxTreatment: TaxTreatment.GST_FREE,
    description: 'Cumulative historical net operating profit and loss equity account',
  },
  {
    code: '4000',
    name: 'Sales Revenue',
    type: AccountType.REVENUE,
    normalBalance: NormalBalance.CREDIT,
    systemKey: 'DEFAULT_REVENUE',
    isBankAccount: false,
    defaultTaxTreatment: TaxTreatment.TAX_EXCLUSIVE,
    description: 'Default core operating sales revenue account',
  },
  {
    code: '6000',
    name: 'Operating Expenses',
    type: AccountType.EXPENSE,
    normalBalance: NormalBalance.DEBIT,
    systemKey: 'DEFAULT_EXPENSE',
    isBankAccount: false,
    defaultTaxTreatment: TaxTreatment.TAX_EXCLUSIVE,
    description: 'Default general vendor and employee operating expense account',
  },
] as const;

/**
 * Ensures all 10 Protected System Accounts exist and are marked `isSystem: true`
 * for the given organization. Safe to run on both new and existing organizations.
 */
export async function ensureOrganizationSystemAccounts(
  db: Prisma.TransactionClient | PrismaClient,
  organizationId: string,
): Promise<void> {
  const existingAccounts = await db.account.findMany({
    where: { organizationId },
  });

  const byCode = new Map(existingAccounts.map((a) => [a.code, a]));

  for (const spec of PROTECTED_SYSTEM_ACCOUNTS) {
    const existing = byCode.get(spec.code);
    if (!existing) {
      await db.account.create({
        data: {
          organizationId,
          code: spec.code,
          name: spec.name,
          type: spec.type,
          normalBalance: spec.normalBalance,
          description: spec.description,
          isSystem: true,
          systemKey: spec.systemKey,
          isBankAccount: spec.isBankAccount,
          defaultTaxTreatment: spec.defaultTaxTreatment,
          isActive: true,
        },
      });
    } else if (
      !existing.isSystem ||
      existing.systemKey !== spec.systemKey ||
      (spec.code === '1000' && !existing.isBankAccount)
    ) {
      await db.account.update({
        where: { id: existing.id },
        data: {
          isSystem: true,
          systemKey: spec.systemKey,
          isBankAccount: spec.isBankAccount ? true : existing.isBankAccount,
          isActive: true,
        },
      });
    }
  }
}

