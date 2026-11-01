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

## Default Chart of Accounts (Seeded per Org)

| Code | Name | Type | Normal Balance |
|------|------|------|---------------|
| `1000` | Operating Bank Account | ASSET | DEBIT |
| `1200` | Accounts Receivable (A/R) | ASSET | DEBIT |
| `2000` | Accounts Payable (A/P) | LIABILITY | CREDIT |
| `2100` | GST Collected (Sales) | LIABILITY | CREDIT |
| `2200` | GST Paid (Purchases) | ASSET | DEBIT |
| `4000` | Sales Revenue | REVENUE | CREDIT |
| `5000` | Operating Expenses | EXPENSE | DEBIT |

---

## Migration Log

| # | Date | Description |
|---|------|-------------|
| 001 | 2026-11-01 | Initial schema — users, organizations, organization_members, organization_invites, accounts, contacts, bills, bill_line_items, invoices, invoice_line_items, payments_out, payments_in, journal_entries, journal_lines |

