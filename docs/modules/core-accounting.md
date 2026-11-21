# Module Context: `CORE_ACCOUNTING` (Financial Spine, Banking, Reports & ATO BAS)

- **Module Key:** `CORE_ACCOUNTING`
- **Commercial Tier:** Base (Core Ledger — Always Enabled)
- **Status:** ✅ Live (Stages 2, 7, 8, 10, 11, 12; Recurring Runner added in Stage 14)

---

## 1. Domain Ownership

### Database Tables (`backend/prisma/schema.prisma`)
- **Chart of Accounts & Dimensions:** `accounts`, `tracking_categories`, `tracking_options`
- **General Ledger:** `journal_entries`, `journal_lines`, `recurring_schedules`
- **Banking & Reconciliation:** `bank_transfers`, `bank_statement_lines`

### Core Libraries (`backend/src/lib/`)
- `ledger-posting.ts`: `postJournalEntry`, `syncOrReplaceJournalEntry`, `reverseJournalEntry` (with anti-double-reversal guard & bidirectional sub-ledger cascade), period lock validation
- `system-accounts.ts`: 10 Protected System Accounts seeder & verifier
- `gst.ts`: Integer-cent 10% Australian GST engine (`TAX_EXCLUSIVE`, `TAX_INCLUSIVE`, `GST_FREE`)
- `schema-sync.ts`: Startup & on-demand Prisma schema self-heal

### Backend Routes (`backend/src/routes/`)
- `accounts.ts`: `/api/v1/accounts/*`, `/api/v1/tracking-categories/*`
- `ledger.ts`: `/api/v1/ledger/*` (entries, approve, reverse, edit, delete)
- `banking.ts`: `/api/v1/banking/accounts`, `/transfers`, `/statements/import`, `/statements`, `/reconciliation/*`
- `reports.ts`: `/api/v1/reports/trial-balance`, `/profit-and-loss`, `/balance-sheet`, `/aged-receivables`, `/aged-payables`, `/bas`, `/bas/lock`
- `dashboard.ts`: `/api/v1/dashboard/summary`

### Frontend Pages (`frontend/src/pages/`)
- `AccountsPage.tsx` (`/accounts`), `LedgerPage.tsx` (`/ledger`), `BankingPage.tsx` (`/banking`), `ReportsPage.tsx` (`/reports`)

---

## 2. Non-Negotiable Accounting Invariants

1. **10 Protected System Accounts (`isSystem: true`):**
   - `1000` Operating Bank (`OPERATING_BANK`)
   - `1200` Accounts Receivable (`ACCOUNTS_RECEIVABLE`)
   - `2000` Accounts Payable (`ACCOUNTS_PAYABLE`)
   - `2050` Employee Reimbursements Payable (`EMPLOYEE_REIMBURSEMENTS`)
   - `2100` GST Collected (`GST_COLLECTED`)
   - `2200` GST Paid (`GST_PAID`)
   - `2300` Customer Prepayments (`CUSTOMER_PREPAYMENTS`)
   - `3000` Retained Earnings (`RETAINED_EARNINGS`)
   - `4000` Sales Revenue (`DEFAULT_REVENUE`)
   - `6000` Operating Expenses (`DEFAULT_EXPENSE`)
2. **Strict Double-Entry:** $\sum \text{Debits} == \sum \text{Credits}$ in integer AUD cents inside `prisma.$transaction(...)`.
3. **Anti-Double-Reversal:** Reversing a posted journal creates `REV-xxxx` and marks **both** original and contra journals `REVERSED`. Contra entries cannot be reversed again.
4. **Bidirectional Cascade:** Reversing a sub-ledger journal in `/ledger` atomically cascades to the source `Bill`, `Invoice`, `PaymentIn`, `PaymentOut`, `CreditNote`, `VendorCredit`, `ExpenseClaim`, `DirectTransaction`, or `BankTransfer`.
5. **Tracking Dimensions:** Every `JournalLine` accepts an optional `trackingOptionId`, powering native dimensional P&L filtering for `PROJECTS`, `FLEET`, departments, and cost centres.

---

## 3. RBAC & Events

- **RBAC:** `ADMIN` & `ACCOUNTANT` (full CRUD/post/reconcile/lock); `MANAGER` (read reports, record bank transfers); `AUDITOR` (read-only across GL, banking, reports).
- **Webhook Events Emitted (via `CONNECTORS`):** `bas.locked`, `bank.reconciled`, `journal.posted`.
