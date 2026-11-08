-- =============================================================================
-- JBTDA-DWS-ERP COMPLETE POSTGRESQL SCHEMA REBUILD SCRIPT
-- Drops and recreates the entire public schema matching schema.prisma 1:1.
-- Confers all ownership and permissions to erp_admin.
-- =============================================================================

-- Step 1: Wipe and Recreate Public Schema
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Grant schema-level permissions
GRANT ALL ON SCHEMA public TO erp_admin;
GRANT ALL ON SCHEMA public TO public;

-- Best-effort: grant role membership and transfer schema ownership if permitted
DO $$ BEGIN
  EXECUTE format('GRANT erp_admin TO %I', CURRENT_USER);
  ALTER SCHEMA public OWNER TO erp_admin;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA public;

-- =============================================================================
-- Step 2: Create All 16 Enums
-- =============================================================================

CREATE TYPE "Role" AS ENUM (
  'ADMIN',
  'ACCOUNTANT',
  'MANAGER',
  'AR_SPECIALIST',
  'AP_SPECIALIST',
  'EMPLOYEE',
  'AUDITOR'
);

CREATE TYPE "ContactType" AS ENUM (
  'CUSTOMER',
  'VENDOR',
  'BOTH'
);

CREATE TYPE "TaxTreatment" AS ENUM (
  'TAX_EXCLUSIVE',
  'TAX_INCLUSIVE',
  'GST_FREE'
);

CREATE TYPE "BillStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'AWAITING_PAYMENT',
  'PARTIALLY_PAID',
  'PAID',
  'VOID'
);

CREATE TYPE "InvoiceStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'VOID'
);

CREATE TYPE "QuoteStatus" AS ENUM (
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'INVOICED'
);

CREATE TYPE "PurchaseOrderStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'BILLED',
  'CANCELLED'
);

CREATE TYPE "CreditNoteStatus" AS ENUM (
  'DRAFT',
  'ISSUED',
  'APPLIED',
  'VOID'
);

CREATE TYPE "ExpenseClaimStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'PAID'
);

CREATE TYPE "JournalStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'POSTED',
  'REVERSED'
);

CREATE TYPE "DirectTransactionType" AS ENUM (
  'SPEND_MONEY',
  'RECEIVE_MONEY'
);

CREATE TYPE "PaymentReceiptType" AS ENUM (
  'INVOICE_PAYMENT',
  'DIRECT_INCOME',
  'CUSTOMER_PREPAYMENT'
);

CREATE TYPE "RecurrenceFrequency" AS ENUM (
  'WEEKLY',
  'FORTNIGHTLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUALLY'
);

CREATE TYPE "AccountType" AS ENUM (
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE'
);

CREATE TYPE "NormalBalance" AS ENUM (
  'DEBIT',
  'CREDIT'
);

CREATE TYPE "EntryType" AS ENUM (
  'DEBIT',
  'CREDIT'
);

-- =============================================================================
-- Step 3: Create Core Multi-Tenant Tables (Users, Organizations, Members)
-- =============================================================================

CREATE TABLE "users" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "google_sub" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "avatar_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_google_sub_key" UNIQUE ("google_sub"),
  CONSTRAINT "users_email_key" UNIQUE ("email")
);

CREATE TABLE "organizations" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "legal_name" TEXT,
  "trading_name" TEXT,
  "abn" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "address_line1" TEXT,
  "address_line2" TEXT,
  "city" TEXT,
  "state" TEXT,
  "postcode" TEXT,
  "bank_bsb" TEXT,
  "bank_account_number" TEXT,
  "bank_account_name" TEXT,
  "apca_user_id" TEXT,
  "default_payment_terms_days" INTEGER NOT NULL DEFAULT 30,
  "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 7,
  "lock_date" TIMESTAMP(3),
  "enforce_two_person_approval" BOOLEAN NOT NULL DEFAULT false,
  "enabled_modules" TEXT[] DEFAULT ARRAY['CORE_FINANCE', 'EXPENSES']::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organizations_abn_key" UNIQUE ("abn")
);

CREATE TABLE "organization_members" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "role" "Role" NOT NULL,
  "job_title" TEXT,
  "department" TEXT,
  "bank_bsb" TEXT,
  "bank_account_number" TEXT,
  "bank_account_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_members_org_user_key" UNIQUE ("organization_id", "user_id")
);

CREATE TABLE "organization_invites" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "email" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "department" TEXT,
  "job_title" TEXT,
  "invited_by_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "accepted_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
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
);
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs"("organization_id", "created_at");
CREATE INDEX "audit_logs_org_entity_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id");

-- =============================================================================
-- Step 4: General Ledger Accounts & Dimensional Tracking
-- =============================================================================

CREATE TABLE "accounts" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "AccountType" NOT NULL,
  "normal_balance" "NormalBalance" NOT NULL,
  "description" TEXT,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "system_key" TEXT,
  "parent_id" TEXT REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "default_tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'TAX_EXCLUSIVE',
  "is_bank_account" BOOLEAN NOT NULL DEFAULT false,
  "bank_bsb" TEXT,
  "bank_account_number" TEXT,
  "apca_user_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounts_org_code_key" UNIQUE ("organization_id", "code")
);

CREATE TABLE "tracking_categories" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tracking_categories_org_name_key" UNIQUE ("organization_id", "name")
);

CREATE TABLE "tracking_options" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tracking_category_id" TEXT NOT NULL REFERENCES "tracking_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tracking_options_cat_name_key" UNIQUE ("tracking_category_id", "name")
);

-- =============================================================================
-- Step 5: Contacts & Items Catalog
-- =============================================================================

CREATE TABLE "contacts" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "type" "ContactType" NOT NULL,
  "name" TEXT NOT NULL,
  "legal_name" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "billing_address" TEXT,
  "abn" TEXT,
  "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
  "requires_invoice_for_payment" BOOLEAN NOT NULL DEFAULT true,
  "default_revenue_account_id" TEXT,
  "default_expense_account_id" TEXT,
  "bank_bsb" TEXT,
  "bank_account_number" TEXT,
  "bank_account_name" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "items" (
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
  CONSTRAINT "items_org_code_key" UNIQUE ("organization_id", "code")
);

-- =============================================================================
-- Step 6: Accounts Receivable (Quotes, Invoices, Credit Notes)
-- =============================================================================

CREATE TABLE "quotes" (
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
  CONSTRAINT "quotes_org_quote_number_key" UNIQUE ("organization_id", "quote_number")
);

CREATE TABLE "quote_line_items" (
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
);

CREATE TABLE "invoices" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "contact_id" TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "invoice_number" TEXT NOT NULL,
  "quote_id" TEXT,
  "issue_date" TIMESTAMP(3) NOT NULL,
  "due_date" TIMESTAMP(3) NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  "gst_cents" BIGINT NOT NULL DEFAULT 0,
  "total_cents" BIGINT NOT NULL DEFAULT 0,
  "amount_paid_cents" BIGINT NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by_user_id" TEXT,
  "approved_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoices_org_invoice_number_key" UNIQUE ("organization_id", "invoice_number")
);

CREATE TABLE "invoice_line_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "invoice_id" TEXT NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
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
  CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_notes" (
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
  CONSTRAINT "credit_notes_org_credit_number_key" UNIQUE ("organization_id", "credit_note_number")
);

CREATE TABLE "credit_note_line_items" (
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
);

-- =============================================================================
-- Step 7: Accounts Payable (Purchase Orders, Bills, Vendor Credits)
-- =============================================================================

CREATE TABLE "purchase_orders" (
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
  CONSTRAINT "purchase_orders_org_po_number_key" UNIQUE ("organization_id", "po_number")
);

CREATE TABLE "purchase_order_line_items" (
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
);

CREATE TABLE "bills" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "contact_id" TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "purchase_order_id" TEXT,
  "reference" TEXT,
  "issue_date" TIMESTAMP(3) NOT NULL,
  "due_date" TIMESTAMP(3) NOT NULL,
  "status" "BillStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
  "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  "gst_cents" BIGINT NOT NULL DEFAULT 0,
  "total_cents" BIGINT NOT NULL DEFAULT 0,
  "amount_paid_cents" BIGINT NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by_user_id" TEXT,
  "approved_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bill_line_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "bill_id" TEXT NOT NULL REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE,
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
  CONSTRAINT "bill_line_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vendor_credits" (
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
);

CREATE TABLE "vendor_credit_line_items" (
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
);

-- =============================================================================
-- Step 8: Payments & Batch Australian .ABA Payments
-- =============================================================================

CREATE TABLE "batch_payments" (
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
  CONSTRAINT "batch_payments_org_batch_number_key" UNIQUE ("organization_id", "batch_number")
);

CREATE TABLE "payments_out" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bill_id" TEXT NOT NULL REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bank_account_id" TEXT,
  "batch_payment_id" TEXT REFERENCES "batch_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "payment_date" TIMESTAMP(3) NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_out_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments_in" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "invoice_id" TEXT REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "contact_id" TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "receipt_type" "PaymentReceiptType" NOT NULL DEFAULT 'INVOICE_PAYMENT',
  "bank_account_id" TEXT,
  "revenue_account_id" TEXT,
  "tracking_option_id" TEXT,
  "tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'GST_FREE',
  "gst_cents" BIGINT NOT NULL DEFAULT 0,
  "payment_date" TIMESTAMP(3) NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_in_pkey" PRIMARY KEY ("id")
);

-- =============================================================================
-- Step 9: Direct Transactions, Expense Claims & Banking
-- =============================================================================

CREATE TABLE "direct_transactions" (
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
);

CREATE TABLE "direct_transaction_lines" (
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
);

CREATE TABLE "expense_claims" (
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
  CONSTRAINT "expense_claims_org_claim_number_key" UNIQUE ("organization_id", "claim_number")
);

CREATE TABLE "expense_claim_items" (
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
);

CREATE TABLE "bank_transfers" (
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
);

CREATE TABLE "bank_statement_lines" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bank_account_id" TEXT NOT NULL,
  "statement_date" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "reference" TEXT,
  "amount_cents" BIGINT NOT NULL,
  "is_reconciled" BOOLEAN NOT NULL DEFAULT false,
  "matched_journal_id" TEXT,
  "reconciled_at" TIMESTAMP(3),
  "reconciled_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recurring_schedules" (
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
);

-- =============================================================================
-- Step 10: General Ledger Double-Entry Audit Trail (Journals & Lines)
-- =============================================================================

CREATE TABLE "journal_entries" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "entry_number" TEXT,
  "description" TEXT NOT NULL,
  "reference_type" TEXT NOT NULL,
  "reference_id" TEXT NOT NULL,
  "status" "JournalStatus" NOT NULL DEFAULT 'POSTED',
  "reverses_entry_id" TEXT,
  "reversed_by_id" TEXT,
  "created_by_user_id" TEXT,
  "approved_by_user_id" TEXT,
  "is_reconciled" BOOLEAN NOT NULL DEFAULT false,
  "reconciled_at" TIMESTAMP(3),
  "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "journal_lines" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "journal_entry_id" TEXT NOT NULL REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "account_id" TEXT NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tracking_option_id" TEXT REFERENCES "tracking_options"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "description" TEXT,
  "entry_type" "EntryType" NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- =============================================================================
-- Step 11: Set Ownership and Grant All Privileges
-- =============================================================================

-- Grant all permissions to erp_admin on all created objects
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO erp_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO erp_admin;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO erp_admin;

-- Set default privileges for both current user and future objects in schema public
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO erp_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO erp_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO erp_admin;

DO $$ BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON TABLES TO erp_admin', CURRENT_USER);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON SEQUENCES TO erp_admin', CURRENT_USER);
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Verify table count (should return 34)
SELECT count(*) AS total_tables_created FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

