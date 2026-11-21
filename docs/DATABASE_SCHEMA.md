# Database Schema — Invariants & Migration Log

> **Single Source of Truth:** `backend/prisma/schema.prisma` is the canonical schema definition for all models, columns, enums, relations, and indexes. On container boot (and on-demand via `POST /api/v1/developer/database/sync-schema`), `backend/src/lib/schema-sync.ts` runs `prisma db push --skip-generate --accept-data-loss` and verifies the 10 Protected System GL Accounts (`1000`–`6000`).

---

## Non-Negotiable Schema Invariants

1. **Integer-Cent Money:** All monetary columns MUST be `BigInt` (`BIGINT` in PostgreSQL) storing AUD cents. `FLOAT`, `DOUBLE`, and `REAL` are strictly banned.
2. **Multi-Tenant Isolation:** Every business-domain table includes `organizationId String @map("organization_id")` referencing `organizations(id)`.
3. **PostgreSQL Naming:** All tables and columns map to `snake_case` via `@map` / `@@map`.
4. **Protected Identity & System Tables:** `users`, `organizations`, `organization_members`, `organization_invites`, and `accounts (is_system = true)` are permanently protected from developer table purges.
5. **10 Protected System GL Accounts:** Canonical list and keys live in `docs/modules/core-accounting.md` and `backend/src/lib/system-accounts.ts`.

---

## Domain Table Map (by Product Module)

| Product Module | PostgreSQL Tables (`schema.prisma`) |
| :--- | :--- |
| `CORE_PLATFORM` | `users`, `organizations`, `organization_members`, `organization_invites`, `audit_logs`, `contacts`, `items` |
| `CORE_ACCOUNTING` | `accounts`, `tracking_categories`, `tracking_options`, `journal_entries`, `journal_lines`, `recurring_schedules`, `bank_transfers`, `bank_statement_lines` |
| `RECEIVABLES` | `quotes`, `quote_line_items`, `invoices`, `invoice_line_items`, `credit_notes`, `credit_note_line_items`, `credit_note_allocations`, `payments_in` |
| `PAYABLES` | `purchase_orders`, `purchase_order_line_items`, `bills`, `bill_line_items`, `vendor_credits`, `vendor_credit_line_items`, `vendor_credit_allocations`, `payments_out`, `batch_payments` |
| `EXPENSES` | `direct_transactions`, `direct_transaction_lines`, `expense_claims`, `expense_claim_items` |
| `CONNECTORS` *(Stages 15–16)* | `api_keys`, `webhook_endpoints`, `webhook_deliveries`, `connector_accounts`, `connector_sync_logs` |
| `DOCUMENTS` *(Deferred D1)* | `document_attachments` |
| `PROJECTS` *(Deferred D2)* | `projects`, `project_tasks`, `project_time_entries` |
| `INVENTORY` *(Deferred D3)* | `warehouses`, `stock_levels`, `stock_movements` |
| `FLEET` *(Deferred D4)* | `fleet_vehicles`, `fleet_service_logs` |
| `PAYROLL` *(Deferred D5)* | `payroll_employees`, `pay_calendars`, `pay_runs`, `payslips`, `leave_balances`, `leave_requests` |

---

## Migration Log

| # | Date | Description |
| :--- | :--- | :--- |
| 001 | 2026-11-01 | Initial schema — `users`, `organizations`, `organization_members`, `organization_invites`, `accounts`, `contacts`, `bills`, `bill_line_items`, `invoices`, `invoice_line_items`, `payments_out`, `payments_in`, `journal_entries`, `journal_lines` |
| 002 | 2026-11-11 | Unified Enterprise Foundation — `quotes`, `credit_notes`, `purchase_orders`, `vendor_credits`, `batch_payments`, `direct_transactions`, `expense_claims`, `bank_transfers`, `bank_statement_lines`, `tracking_categories`, `tracking_options`, `recurring_schedules`, `audit_logs` |
| 003 | 2026-11-14 | Module 12 Context-Aware Statement Lines — Added `suggested_contact_id`, `suggested_account_id`, `suggested_tracking_option_id`, and `suggested_tax_treatment` to `bank_statement_lines` |
| 004 | 2026-11-15 | Module 13 Prisma-Native Schema Self-Healing — Retired `rebuild_all_schema.sql`, raw DDL in `schema-sync.ts`, and `AUTO_SCHEMA_PUSH`/`DB_FORCE_RESET`; `schema.prisma` now syncs via `prisma db push --skip-generate --accept-data-loss` |
