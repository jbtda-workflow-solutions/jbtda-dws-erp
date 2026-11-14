# Database Schema

PostgreSQL tables, Prisma models, field constraints, and migration log for the
JBTDA-DWS ERP application.

> **Rule:** All monetary values are stored as `BIGINT` in cents. Never use
> `FLOAT`, `DOUBLE`, or `REAL` for monetary fields.

---

## Prisma Schema Location

`backend/prisma/schema.prisma`

---

## Core Enums

```prisma
enum Role {
  ADMIN
  ACCOUNTANT
  AR_SPECIALIST
  AP_SPECIALIST
  AUDITOR
}

enum ContactType {
  CUSTOMER
  VENDOR
  BOTH
}

enum TaxTreatment {
  TAX_EXCLUSIVE
  TAX_INCLUSIVE
  GST_FREE
}

enum BillStatus {
  AWAITING_PAYMENT
  PARTIALLY_PAID
  PAID
  VOID
}

enum InvoiceStatus {
  DRAFT
  ISSUED
  PARTIALLY_PAID
  PAID
  VOID
}

enum AccountType {
  ASSET
  LIABILITY
  EQUITY
  REVENUE
  EXPENSE
}

enum NormalBalance {
  DEBIT
  CREDIT
}

enum EntryType {
  DEBIT
  CREDIT
}
```

---

## Tables

### `users`
Authenticated application users (upserted on Google OAuth login).

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK, default `gen_random_uuid()` | |
| `google_sub` | String | UNIQUE, NOT NULL | Immutable Google subject ID |
| `email` | String | UNIQUE, NOT NULL | Verified by Google OIDC |
| `name` | String | NOT NULL | Display name from Google profile |
| `avatar_url` | String? | nullable | Google profile picture URL |
| `created_at` | DateTime | default `now()` | |
| `updated_at` | DateTime | `@updatedAt` | |

### `organizations`
Top-level multi-tenant boundary. Every business record is scoped to one org.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `name` | String | NOT NULL | Legal name (2–100 chars) |
| `abn` | String | UNIQUE, NOT NULL | 11-digit Australian Business Number |
| `created_at` | DateTime | default `now()` | |
| `updated_at` | DateTime | `@updatedAt` | |

### `organization_members`
Join table linking users to organizations with a role.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `organization_id` | UUID | FK → `organizations.id` ON DELETE RESTRICT | |
| `user_id` | UUID | FK → `users.id` ON DELETE RESTRICT | |
| `role` | Role | NOT NULL | |
| `created_at` | DateTime | default `now()` | |
| Unique | | `(organization_id, user_id)` | |

### `organization_invites`
Pending email invitations to join an organization.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `organization_id` | UUID | FK → `organizations.id` ON DELETE CASCADE | |
| `email` | String | NOT NULL | Invitee email (matched on login) |
| `role` | Role | NOT NULL | Role to grant on acceptance |
| `invited_by_user_id` | UUID | FK → `users.id` | |
| `accepted_at` | DateTime? | nullable | Set when invite is consumed |
| `expires_at` | DateTime | NOT NULL | |
| `created_at` | DateTime | default `now()` | |

### `accounts` (Chart of Accounts)
General Ledger accounts. Seeded automatically on org creation.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `organization_id` | UUID | FK → `organizations.id` ON DELETE RESTRICT | |
| `code` | String | NOT NULL | e.g. `"1000"` |
| `name` | String | NOT NULL | e.g. `"Operating Bank Account"` |
| `type` | AccountType | NOT NULL | |
| `normal_balance` | NormalBalance | NOT NULL | |
| `description` | String? | nullable | |
| `is_active` | Boolean | default `true` | |
| `created_at` | DateTime | default `now()` | |
| Unique | | `(organization_id, code)` | |

### `contacts`
Customers and/or vendors within an organization.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `organization_id` | UUID | FK → `organizations.id` ON DELETE RESTRICT | |
| `type` | ContactType | NOT NULL | `CUSTOMER`, `VENDOR`, or `BOTH` |
| `name` | String | NOT NULL | Legal or trading name |
| `email` | String? | nullable | Primary contact email |
| `abn` | String? | nullable | 11-digit ABN |
| `payment_terms_days` | Int | default `30` | Net payment terms |
| `requires_invoice_for_payment` | Boolean | default `true` | Enforce invoice match on payment |
| `is_active` | Boolean | default `true` | |
| `created_at` | DateTime | default `now()` | |
| `updated_at` | DateTime | `@updatedAt` | |

### `bills`
Accounts Payable — bills received from vendors.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `organization_id` | UUID | FK → `organizations.id` ON DELETE RESTRICT | |
| `contact_id` | UUID | FK → `contacts.id` ON DELETE RESTRICT | Vendor |
| `reference` | String? | nullable | Vendor's invoice/bill number |
| `issue_date` | DateTime | NOT NULL | |
| `due_date` | DateTime | NOT NULL | |
| `status` | BillStatus | default `AWAITING_PAYMENT` | |
| `subtotal_cents` | BigInt | NOT NULL | Sum of line item amounts excl. GST |
| `gst_cents` | BigInt | NOT NULL | Total GST across all line items |
| `total_cents` | BigInt | NOT NULL | `subtotal_cents + gst_cents` |
| `amount_paid_cents` | BigInt | default `0` | Running paid total |
| `notes` | String? | nullable | |
| `created_at` | DateTime | default `now()` | |
| `updated_at` | DateTime | `@updatedAt` | |

### `bill_line_items`
Individual line items on a bill.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `bill_id` | UUID | FK → `bills.id` ON DELETE CASCADE | |
| `organization_id` | UUID | FK → `organizations.id` | Denormalized for tenant safety |
| `description` | String | NOT NULL | |
| `amount_cents` | BigInt | NOT NULL | Excl. GST |
| `tax_treatment` | TaxTreatment | NOT NULL | |
| `gst_cents` | BigInt | NOT NULL | Calculated GST for this line |
| `total_cents` | BigInt | NOT NULL | `amount_cents + gst_cents` |

### `invoices`
Accounts Receivable — invoices issued to customers.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `organization_id` | UUID | FK → `organizations.id` ON DELETE RESTRICT | |
| `contact_id` | UUID | FK → `contacts.id` ON DELETE RESTRICT | Customer |
| `invoice_number` | String | NOT NULL | Auto-incremented per org, e.g. `INV-1001` |
| `issue_date` | DateTime | NOT NULL | |
| `due_date` | DateTime | NOT NULL | |
| `status` | InvoiceStatus | default `DRAFT` | |
| `subtotal_cents` | BigInt | NOT NULL | |
| `gst_cents` | BigInt | NOT NULL | |
| `total_cents` | BigInt | NOT NULL | |
| `amount_paid_cents` | BigInt | default `0` | |
| `notes` | String? | nullable | |
| `created_at` | DateTime | default `now()` | |
| `updated_at` | DateTime | `@updatedAt` | |
| Unique | | `(organization_id, invoice_number)` | |

### `invoice_line_items`
Individual line items on an invoice.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `invoice_id` | UUID | FK → `invoices.id` ON DELETE CASCADE | |
| `organization_id` | UUID | FK → `organizations.id` | Denormalized for tenant safety |
| `description` | String | NOT NULL | |
| `amount_cents` | BigInt | NOT NULL | Excl. GST |
| `tax_treatment` | TaxTreatment | NOT NULL | |
| `gst_cents` | BigInt | NOT NULL | |
| `total_cents` | BigInt | NOT NULL | |

### `payments_out`
Payments made against bills (AP).

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `organization_id` | UUID | FK → `organizations.id` ON DELETE RESTRICT | |
| `bill_id` | UUID | FK → `bills.id` ON DELETE RESTRICT | |
| `payment_date` | DateTime | NOT NULL | |
| `amount_cents` | BigInt | NOT NULL | |
| `reference` | String? | nullable | Bank reference |
| `created_at` | DateTime | default `now()` | |

### `payments_in`
Payments received against invoices (AR).

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `organization_id` | UUID | FK → `organizations.id` ON DELETE RESTRICT | |
| `invoice_id` | UUID? | FK → `invoices.id` | Nullable for direct receipts |
| `contact_id` | UUID | FK → `contacts.id` | |
| `payment_date` | DateTime | NOT NULL | |
| `amount_cents` | BigInt | NOT NULL | |
| `reference` | String? | nullable | |
| `created_at` | DateTime | default `now()` | |

### `journal_entries`
General Ledger double-entry records (auto-posted).

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `organization_id` | UUID | FK → `organizations.id` ON DELETE RESTRICT | |
| `description` | String | NOT NULL | Human-readable narration |
| `reference_type` | String | NOT NULL | `"BILL"`, `"PAYMENT_OUT"`, `"INVOICE"`, `"PAYMENT_IN"` |
| `reference_id` | UUID | NOT NULL | FK to the source record |
| `posted_at` | DateTime | default `now()` | |

### `journal_lines`
Individual debit/credit lines in a journal entry.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK | |
| `journal_entry_id` | UUID | FK → `journal_entries.id` ON DELETE CASCADE | |
| `organization_id` | UUID | FK → `organizations.id` | Denormalized |
| `account_id` | UUID | FK → `accounts.id` | |
| `entry_type` | EntryType | NOT NULL | `DEBIT` or `CREDIT` |
| `amount_cents` | BigInt | NOT NULL | |

---

## Default Chart of Accounts (10 Protected System Accounts Seeded per Org)

| Code | Name | Type | Normal Balance | System Key |
|------|------|------|---------------|------------|
| `1000` | Operating Bank Account | ASSET | DEBIT | `OPERATING_BANK` |
| `1200` | Accounts Receivable (A/R) | ASSET | DEBIT | `ACCOUNTS_RECEIVABLE` |
| `2000` | Accounts Payable (A/P) | LIABILITY | CREDIT | `ACCOUNTS_PAYABLE` |
| `2050` | Employee Reimbursements Payable | LIABILITY | CREDIT | `EMPLOYEE_REIMBURSEMENTS` |
| `2100` | GST Collected (Sales) | LIABILITY | CREDIT | `GST_COLLECTED` |
| `2200` | GST Paid (Purchases) | ASSET | DEBIT | `GST_PAID` |
| `2300` | Customer Prepayments / Unearned | LIABILITY | CREDIT | `CUSTOMER_PREPAYMENTS` |
| `3000` | Retained Earnings | EQUITY | CREDIT | `RETAINED_EARNINGS` |
| `4000` | Sales Revenue | REVENUE | CREDIT | `DEFAULT_REVENUE` |
| `6000` | Operating Expenses | EXPENSE | DEBIT | `DEFAULT_EXPENSE` |

---

## Unified Enterprise Schema Expansion (Planned for Module 1.1 Migration `002_enterprise_foundation`)

In Module 1.1, the baseline schema is expanded into the complete Unified Enterprise Schema so all 8 modules share clean relational constraints without mid-build schema churn:

1. **Workspace, Governance & Audit:**
   - `organizations`: Add `legal_name`, `trading_name`, `email`, `phone`, `address_line1`, `address_line2`, `city`, `state`, `postcode`, `bank_bsb`, `bank_account_number`, `bank_account_name`, `apca_user_id`, `default_payment_terms_days`, `fiscal_year_start_month`, `lock_date`, `enforce_two_person_approval`, `enabled_modules` (`String[]`).
   - `organization_members`: Expand `Role` enum (`ADMIN`, `ACCOUNTANT`, `MANAGER`, `AR_SPECIALIST`, `AP_SPECIALIST`, `EMPLOYEE`, `AUDITOR`) and add employee reimbursement banking (`bank_bsb`, `bank_account_number`, `bank_account_name`).
   - `audit_logs`: Append-only table (`id`, `organization_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `summary`, `metadata_json`, `created_at`).
2. **Financial Spine, Dimensions & Journals:**
   - `accounts`: Add `is_system` (`Boolean`), `system_key` (`String?`), `parent_id` (`UUID?` self-relation), `default_tax_treatment`, `is_bank_account` (`Boolean`), `bank_bsb`, `bank_account_number`.
   - `tracking_categories` & `tracking_options`: Custom dimensional cost-center tagging per organization.
   - `journal_entries`: Add `status` (`DRAFT`, `PENDING_APPROVAL`, `POSTED`, `REVERSED`), `entry_date`, `created_by_user_id`, `approved_by_user_id`, `reverses_entry_id`, `is_reconciled`, `reconciled_at`.
   - `journal_lines`: Add `description`, `tracking_option_id` (or join for multi-dimension tagging).
   - `recurring_schedules`: Templates for recurring Journals, Invoices, and Bills (`frequency`, `next_run_date`, `auto_post`, `template_payload_json`).
3. **Master Data (`contacts` & `items`):**
   - `contacts`: Add `legal_name`, `phone`, `billing_address`, `default_revenue_account_id`, `default_expense_account_id`, `bank_bsb`, `bank_account_number`, `bank_account_name`.
   - `items`: Products & Services catalog (`code`, `name`, `is_sold`, `sale_description`, `sale_unit_price_cents`, `sale_tax_treatment`, `income_account_id`, `is_purchased`, `purchase_description`, `purchase_unit_price_cents`, `purchase_tax_treatment`, `expense_account_id`, `is_tracked_inventory`, `is_active`).
4. **Accounts Receivable (`quotes`, `invoices`, `credit_notes`, `payments_in`):**
   - `quotes` & `quote_line_items`: Client estimates with 1-click conversion to `invoices`.
   - `invoices` & `invoice_line_items`: Add `PENDING_APPROVAL` status, `account_id`, `item_id`, `quantity`, `unit_price_cents`, `tracking_option_id`, `created_by_user_id`, `approved_by_user_id`.
   - `credit_notes` & `credit_note_line_items` & `credit_note_allocations`: Customer AR credit adjustments and invoice allocations.
   - `payments_in`: Add `receipt_type` (`INVOICE_PAYMENT`, `DIRECT_INCOME`, `CUSTOMER_PREPAYMENT`), `bank_account_id`, `revenue_account_id`, `tax_treatment`, `gst_cents`.
5. **Accounts Payable (`purchase_orders`, `bills`, `vendor_credits`, `payments_out`, `batch_payments`):**
   - `purchase_orders` & `purchase_order_line_items`: Approval-gated POs with 1-click conversion to `bills`.
   - `bills` & `bill_line_items`: Add `DRAFT` and `PENDING_APPROVAL` statuses, `purchase_order_id`, `account_id`, `item_id`, `quantity`, `unit_price_cents`, `tracking_option_id`, `created_by_user_id`, `approved_by_user_id`.
   - `vendor_credits` & `vendor_credit_line_items` & `vendor_credit_allocations`: Supplier AP credit adjustments.
   - `batch_payments`: Consolidated `.aba` payment batches covering multiple `payments_out` and employee reimbursements.
6. **Enterprise Expenses (`direct_transactions`, `expense_claims`, `expense_claim_items`):**
   - `direct_transactions` & `direct_transaction_lines`: Direct "Spend Money" (and "Receive Money") bank/card transactions.
   - `expense_claims` & `expense_claim_items`: Employee out-of-pocket claims (`DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`, `PAID`) posting to `2050 Employee Reimbursements Payable`.
7. **Banking & Reconciliation (`bank_transfers`, `bank_statement_lines`):**
   - `bank_statement_lines`: Imported CSV/OFX bank lines matched against GL transactions, including optional pre-validated CSV context references (`suggested_contact_id` FK $\rightarrow$ `contacts.id`, `suggested_account_id` FK $\rightarrow$ `accounts.id`, `suggested_tracking_option_id` FK $\rightarrow$ `tracking_options.id`, and `suggested_tax_treatment` `TaxTreatment?`).

---

## Migration Log

| # | Date | Description |
|---|------|-------------|
| 001 | 2026-11-01 | Initial schema — users, organizations, organization_members, organization_invites, accounts, contacts, bills, bill_line_items, invoices, invoice_line_items, payments_out, payments_in, journal_entries, journal_lines |
| 002 | 2026-11-11 | Unified Enterprise Foundation — quotes, credit_notes, purchase_orders, vendor_credits, batch_payments, direct_transactions, expense_claims, bank_transfers, bank_statement_lines, tracking_categories, tracking_options, recurring_schedules, audit_logs |
| 003 | 2026-11-14 | Module 12 Context-Aware Statement Lines — Added `suggested_contact_id`, `suggested_account_id`, `suggested_tracking_option_id`, and `suggested_tax_treatment` to `bank_statement_lines` |
| 004 | 2026-11-15 | Module 13 Prisma-Native Schema Self-Healing — Retired `rebuild_all_schema.sql`, raw DDL statements in `schema-sync.ts`, and mandatory `AUTO_SCHEMA_PUSH` / `DB_FORCE_RESET` env vars; `schema.prisma` is now synchronized automatically via `prisma db push --skip-generate --accept-data-loss` on boot and on-demand via `/api/v1/developer/database/sync-schema` |

