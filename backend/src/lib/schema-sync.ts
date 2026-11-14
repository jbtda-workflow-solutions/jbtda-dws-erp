/**
 * Automatic Idempotent Database Schema Synchronizer
 *
 * Ensures that Cloud SQL PostgreSQL always has the latest enums, columns,
 * tables, and Protected System Accounts from Migration 001 + 002 on container boot.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ensureOrganizationSystemAccounts } from './system-accounts.js';

const IDEMPOTENT_DDL_STATEMENTS: readonly string[] = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,

  // 1. Expand Existing Enums
  `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANAGER'`,
  `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'EMPLOYEE'`,
  `ALTER TYPE "BillStatus" ADD VALUE IF NOT EXISTS 'DRAFT'`,
  `ALTER TYPE "BillStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL'`,
  `ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL'`,

  // 2. Create New Enums
  `DO $$ BEGIN
    CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'INVOICED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'BILLED', 'CANCELLED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'APPLIED', 'VOID');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "ExpenseClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "DirectTransactionType" AS ENUM ('SPEND_MONEY', 'RECEIVE_MONEY');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "PaymentReceiptType" AS ENUM ('INVOICE_PAYMENT', 'DIRECT_INCOME', 'CUSTOMER_PREPAYMENT');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // 3. Expand Existing Tables
  `ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "legal_name" TEXT,
    ADD COLUMN IF NOT EXISTS "trading_name" TEXT,
    ADD COLUMN IF NOT EXISTS "email" TEXT,
    ADD COLUMN IF NOT EXISTS "phone" TEXT,
    ADD COLUMN IF NOT EXISTS "address_line1" TEXT,
    ADD COLUMN IF NOT EXISTS "address_line2" TEXT,
    ADD COLUMN IF NOT EXISTS "city" TEXT,
    ADD COLUMN IF NOT EXISTS "state" TEXT,
    ADD COLUMN IF NOT EXISTS "postcode" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_bsb" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_account_number" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_account_name" TEXT,
    ADD COLUMN IF NOT EXISTS "apca_user_id" TEXT,
    ADD COLUMN IF NOT EXISTS "default_payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN IF NOT EXISTS "lock_date" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "enforce_two_person_approval" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "enabled_modules" TEXT[] DEFAULT ARRAY['CORE_FINANCE', 'EXPENSES']::TEXT[]`,

  `ALTER TABLE "organization_members"
    ADD COLUMN IF NOT EXISTS "job_title" TEXT,
    ADD COLUMN IF NOT EXISTS "department" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_bsb" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_account_number" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_account_name" TEXT,
    ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,

  `ALTER TABLE "organization_invites"
    ADD COLUMN IF NOT EXISTS "department" TEXT,
    ADD COLUMN IF NOT EXISTS "job_title" TEXT`,

  `ALTER TABLE "accounts"
    ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "system_key" TEXT,
    ADD COLUMN IF NOT EXISTS "parent_id" TEXT,
    ADD COLUMN IF NOT EXISTS "default_tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'TAX_EXCLUSIVE',
    ADD COLUMN IF NOT EXISTS "is_bank_account" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "bank_bsb" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_account_number" TEXT,
    ADD COLUMN IF NOT EXISTS "apca_user_id" TEXT,
    ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,

  `ALTER TABLE "contacts"
    ADD COLUMN IF NOT EXISTS "legal_name" TEXT,
    ADD COLUMN IF NOT EXISTS "phone" TEXT,
    ADD COLUMN IF NOT EXISTS "billing_address" TEXT,
    ADD COLUMN IF NOT EXISTS "default_revenue_account_id" TEXT,
    ADD COLUMN IF NOT EXISTS "default_expense_account_id" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_bsb" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_account_number" TEXT,
    ADD COLUMN IF NOT EXISTS "bank_account_name" TEXT`,

  `ALTER TABLE "invoices"
    ADD COLUMN IF NOT EXISTS "quote_id" TEXT,
    ADD COLUMN IF NOT EXISTS "created_by_user_id" TEXT,
    ADD COLUMN IF NOT EXISTS "approved_by_user_id" TEXT`,

  `ALTER TABLE "invoice_line_items"
    ADD COLUMN IF NOT EXISTS "item_id" TEXT,
    ADD COLUMN IF NOT EXISTS "account_id" TEXT,
    ADD COLUMN IF NOT EXISTS "tracking_option_id" TEXT,
    ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS "unit_price_cents" BIGINT NOT NULL DEFAULT 0`,

  `ALTER TABLE "bills"
    ADD COLUMN IF NOT EXISTS "purchase_order_id" TEXT,
    ADD COLUMN IF NOT EXISTS "created_by_user_id" TEXT,
    ADD COLUMN IF NOT EXISTS "approved_by_user_id" TEXT`,

  `ALTER TABLE "bill_line_items"
    ADD COLUMN IF NOT EXISTS "item_id" TEXT,
    ADD COLUMN IF NOT EXISTS "account_id" TEXT,
    ADD COLUMN IF NOT EXISTS "tracking_option_id" TEXT,
    ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS "unit_price_cents" BIGINT NOT NULL DEFAULT 0`,

  `ALTER TABLE "payments_out"
    ADD COLUMN IF NOT EXISTS "bank_account_id" TEXT,
    ADD COLUMN IF NOT EXISTS "batch_payment_id" TEXT`,

  `ALTER TABLE "payments_in"
    ADD COLUMN IF NOT EXISTS "receipt_type" "PaymentReceiptType" NOT NULL DEFAULT 'INVOICE_PAYMENT',
    ADD COLUMN IF NOT EXISTS "bank_account_id" TEXT,
    ADD COLUMN IF NOT EXISTS "revenue_account_id" TEXT,
    ADD COLUMN IF NOT EXISTS "tracking_option_id" TEXT,
    ADD COLUMN IF NOT EXISTS "tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'GST_FREE',
    ADD COLUMN IF NOT EXISTS "gst_cents" BIGINT NOT NULL DEFAULT 0`,

  `ALTER TABLE "journal_entries"
    ADD COLUMN IF NOT EXISTS "entry_number" TEXT,
    ADD COLUMN IF NOT EXISTS "status" "JournalStatus" NOT NULL DEFAULT 'POSTED',
    ADD COLUMN IF NOT EXISTS "reverses_entry_id" TEXT,
    ADD COLUMN IF NOT EXISTS "reversed_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "created_by_user_id" TEXT,
    ADD COLUMN IF NOT EXISTS "approved_by_user_id" TEXT,
    ADD COLUMN IF NOT EXISTS "is_reconciled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "reconciled_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,

  `ALTER TABLE "journal_lines"
    ADD COLUMN IF NOT EXISTS "tracking_option_id" TEXT,
    ADD COLUMN IF NOT EXISTS "description" TEXT`,

  // 4. Create New Enterprise Tables
  `CREATE TABLE IF NOT EXISTS "audit_logs" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "actor_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      "actor_email" TEXT,
      "actor_name" TEXT,
      "action" TEXT NOT NULL,
      "entity_type" TEXT NOT NULL,
      "entity_id" TEXT NOT NULL,
      "summary" TEXT NOT NULL,
      "metadata_json" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "audit_logs_organization_id_entity_type_entity_id_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id")`,

  `CREATE TABLE IF NOT EXISTS "tracking_categories" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "is_active" BOOLEAN NOT NULL DEFAULT true,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "tracking_categories_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "tracking_categories_organization_id_name_key" UNIQUE ("organization_id", "name")
  )`,

  `CREATE TABLE IF NOT EXISTS "tracking_options" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "tracking_category_id" TEXT NOT NULL REFERENCES "tracking_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "name" TEXT NOT NULL,
      "code" TEXT,
      "is_active" BOOLEAN NOT NULL DEFAULT true,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "tracking_options_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "tracking_options_tracking_category_id_name_key" UNIQUE ("tracking_category_id", "name")
  )`,

  `CREATE TABLE IF NOT EXISTS "items" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "is_sold" BOOLEAN NOT NULL DEFAULT true,
      "sale_description" TEXT,
      "sale_unit_price_cents" BIGINT NOT NULL DEFAULT 0,
      "sale_tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'TAX_EXCLUSIVE',
      "income_account_id" TEXT,
      "is_purchased" BOOLEAN NOT NULL DEFAULT true,
      "purchase_description" TEXT,
      "purchase_unit_price_cents" BIGINT NOT NULL DEFAULT 0,
      "purchase_tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'TAX_EXCLUSIVE',
      "expense_account_id" TEXT,
      "is_tracked_inventory" BOOLEAN NOT NULL DEFAULT false,
      "is_active" BOOLEAN NOT NULL DEFAULT true,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "items_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "items_organization_id_code_key" UNIQUE ("organization_id", "code")
  )`,

  `CREATE TABLE IF NOT EXISTS "quotes" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "contact_id" TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "quote_number" TEXT NOT NULL,
      "issue_date" TIMESTAMP(3) NOT NULL,
      "expiry_date" TIMESTAMP(3) NOT NULL,
      "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
      "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
      "gst_cents" BIGINT NOT NULL DEFAULT 0,
      "total_cents" BIGINT NOT NULL DEFAULT 0,
      "notes" TEXT,
      "converted_invoice_id" TEXT,
      "created_by_user_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "quotes_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "quotes_organization_id_quote_number_key" UNIQUE ("organization_id", "quote_number")
  )`,

  `CREATE TABLE IF NOT EXISTS "quote_line_items" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "quote_id" TEXT NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "item_id" TEXT,
      "account_id" TEXT,
      "tracking_option_id" TEXT,
      "description" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL DEFAULT 1,
      "unit_price_cents" BIGINT NOT NULL DEFAULT 0,
      "amount_cents" BIGINT NOT NULL,
      "tax_treatment" "TaxTreatment" NOT NULL,
      "gst_cents" BIGINT NOT NULL,
      "total_cents" BIGINT NOT NULL,
      CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "credit_notes" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "contact_id" TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "invoice_id" TEXT,
      "credit_note_number" TEXT NOT NULL,
      "issue_date" TIMESTAMP(3) NOT NULL,
      "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
      "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
      "gst_cents" BIGINT NOT NULL DEFAULT 0,
      "total_cents" BIGINT NOT NULL DEFAULT 0,
      "amount_applied_cents" BIGINT NOT NULL DEFAULT 0,
      "notes" TEXT,
      "created_by_user_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "credit_notes_organization_id_credit_note_number_key" UNIQUE ("organization_id", "credit_note_number")
  )`,

  `CREATE TABLE IF NOT EXISTS "credit_note_line_items" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "credit_note_id" TEXT NOT NULL REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "account_id" TEXT,
      "tracking_option_id" TEXT,
      "description" TEXT NOT NULL,
      "amount_cents" BIGINT NOT NULL,
      "tax_treatment" "TaxTreatment" NOT NULL,
      "gst_cents" BIGINT NOT NULL,
      "total_cents" BIGINT NOT NULL,
      CONSTRAINT "credit_note_line_items_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "purchase_orders" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "contact_id" TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "po_number" TEXT NOT NULL,
      "issue_date" TIMESTAMP(3) NOT NULL,
      "delivery_date" TIMESTAMP(3),
      "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
      "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
      "gst_cents" BIGINT NOT NULL DEFAULT 0,
      "total_cents" BIGINT NOT NULL DEFAULT 0,
      "notes" TEXT,
      "converted_bill_id" TEXT,
      "created_by_user_id" TEXT,
      "approved_by_user_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "purchase_orders_organization_id_po_number_key" UNIQUE ("organization_id", "po_number")
  )`,

  `CREATE TABLE IF NOT EXISTS "purchase_order_line_items" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "purchase_order_id" TEXT NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "item_id" TEXT,
      "account_id" TEXT,
      "tracking_option_id" TEXT,
      "description" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL DEFAULT 1,
      "unit_price_cents" BIGINT NOT NULL DEFAULT 0,
      "amount_cents" BIGINT NOT NULL,
      "tax_treatment" "TaxTreatment" NOT NULL,
      "gst_cents" BIGINT NOT NULL,
      "total_cents" BIGINT NOT NULL,
      CONSTRAINT "purchase_order_line_items_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "vendor_credits" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "contact_id" TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "bill_id" TEXT,
      "reference" TEXT,
      "issue_date" TIMESTAMP(3) NOT NULL,
      "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
      "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
      "gst_cents" BIGINT NOT NULL DEFAULT 0,
      "total_cents" BIGINT NOT NULL DEFAULT 0,
      "amount_applied_cents" BIGINT NOT NULL DEFAULT 0,
      "notes" TEXT,
      "created_by_user_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "vendor_credits_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "vendor_credit_line_items" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "vendor_credit_id" TEXT NOT NULL REFERENCES "vendor_credits"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "account_id" TEXT,
      "tracking_option_id" TEXT,
      "description" TEXT NOT NULL,
      "amount_cents" BIGINT NOT NULL,
      "tax_treatment" "TaxTreatment" NOT NULL,
      "gst_cents" BIGINT NOT NULL,
      "total_cents" BIGINT NOT NULL,
      CONSTRAINT "vendor_credit_line_items_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "batch_payments" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "batch_number" TEXT NOT NULL,
      "payment_date" TIMESTAMP(3) NOT NULL,
      "bank_account_id" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "total_cents" BIGINT NOT NULL DEFAULT 0,
      "item_count" INTEGER NOT NULL DEFAULT 0,
      "aba_file_content" TEXT,
      "created_by_user_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "batch_payments_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "batch_payments_organization_id_batch_number_key" UNIQUE ("organization_id", "batch_number")
  )`,

  `CREATE TABLE IF NOT EXISTS "direct_transactions" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "type" "DirectTransactionType" NOT NULL DEFAULT 'SPEND_MONEY',
      "bank_account_id" TEXT NOT NULL,
      "contact_id" TEXT REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      "payee_name" TEXT,
      "transaction_date" TIMESTAMP(3) NOT NULL,
      "reference" TEXT,
      "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
      "gst_cents" BIGINT NOT NULL DEFAULT 0,
      "total_cents" BIGINT NOT NULL DEFAULT 0,
      "notes" TEXT,
      "created_by_user_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "direct_transactions_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "direct_transaction_lines" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "direct_transaction_id" TEXT NOT NULL REFERENCES "direct_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "account_id" TEXT NOT NULL,
      "tracking_option_id" TEXT,
      "description" TEXT NOT NULL,
      "amount_cents" BIGINT NOT NULL,
      "tax_treatment" "TaxTreatment" NOT NULL,
      "gst_cents" BIGINT NOT NULL,
      "total_cents" BIGINT NOT NULL,
      CONSTRAINT "direct_transaction_lines_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "expense_claims" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "employee_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "claim_number" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "status" "ExpenseClaimStatus" NOT NULL DEFAULT 'DRAFT',
      "submitted_at" TIMESTAMP(3),
      "approved_at" TIMESTAMP(3),
      "approved_by_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      "paid_at" TIMESTAMP(3),
      "paid_from_bank_id" TEXT,
      "batch_payment_id" TEXT,
      "rejection_reason" TEXT,
      "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
      "gst_cents" BIGINT NOT NULL DEFAULT 0,
      "total_cents" BIGINT NOT NULL DEFAULT 0,
      "notes" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "expense_claims_organization_id_claim_number_key" UNIQUE ("organization_id", "claim_number")
  )`,

  `CREATE TABLE IF NOT EXISTS "expense_claim_items" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "expense_claim_id" TEXT NOT NULL REFERENCES "expense_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "expense_date" TIMESTAMP(3) NOT NULL,
      "merchant" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "account_id" TEXT NOT NULL,
      "tracking_option_id" TEXT,
      "amount_cents" BIGINT NOT NULL,
      "tax_treatment" "TaxTreatment" NOT NULL,
      "gst_cents" BIGINT NOT NULL,
      "total_cents" BIGINT NOT NULL,
      CONSTRAINT "expense_claim_items_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "bank_transfers" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "from_account_id" TEXT NOT NULL,
      "to_account_id" TEXT NOT NULL,
      "transfer_date" TIMESTAMP(3) NOT NULL,
      "amount_cents" BIGINT NOT NULL,
      "reference" TEXT,
      "description" TEXT,
      "created_by_user_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "bank_transfers_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "bank_statement_lines" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "bank_account_id" TEXT NOT NULL,
      "statement_date" TIMESTAMP(3) NOT NULL,
      "description" TEXT NOT NULL,
      "reference" TEXT,
      "amount_cents" BIGINT NOT NULL,
      "suggested_contact_id" TEXT,
      "suggested_account_id" TEXT,
      "suggested_tracking_option_id" TEXT,
      "suggested_tax_treatment" "TaxTreatment",
      "is_reconciled" BOOLEAN NOT NULL DEFAULT false,
      "matched_journal_id" TEXT,
      "reconciled_at" TIMESTAMP(3),
      "reconciled_by_user_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
  )`,

  `ALTER TABLE "bank_statement_lines"
    ADD COLUMN IF NOT EXISTS "suggested_contact_id" TEXT,
    ADD COLUMN IF NOT EXISTS "suggested_account_id" TEXT,
    ADD COLUMN IF NOT EXISTS "suggested_tracking_option_id" TEXT,
    ADD COLUMN IF NOT EXISTS "suggested_tax_treatment" "TaxTreatment"`,

  `CREATE TABLE IF NOT EXISTS "recurring_schedules" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "schedule_type" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "frequency" "RecurrenceFrequency" NOT NULL,
      "start_date" TIMESTAMP(3) NOT NULL,
      "next_run_date" TIMESTAMP(3) NOT NULL,
      "last_run_date" TIMESTAMP(3),
      "auto_post" BOOLEAN NOT NULL DEFAULT false,
      "is_active" BOOLEAN NOT NULL DEFAULT true,
      "template_payload_json" TEXT NOT NULL,
      "created_by_user_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "recurring_schedules_pkey" PRIMARY KEY ("id")
  )`,
];

export async function runStartupSchemaSync(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
): Promise<void> {
  logger.info('Running idempotent enterprise schema synchronization...');

  for (const sql of IDEMPOTENT_DDL_STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      logger.warn({ err, sql: sql.slice(0, 80) }, 'Non-fatal warning during DDL statement sync');
    }
  }

  // Ensure all existing organizations have the 10 Protected System Accounts seeded
  try {
    const orgs = await prisma.organization.findMany({
      select: { id: true },
    });
    for (const org of orgs) {
      await ensureOrganizationSystemAccounts(prisma, org.id);
    }
    logger.info(
      { organizationCount: orgs.length },
      'Enterprise schema synchronization & system account verification complete',
    );
  } catch (err) {
    logger.warn({ err }, 'Could not verify organization system accounts during startup sync');
  }
}

