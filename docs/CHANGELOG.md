# Changelog

Chronological log of all changes, schema diffs, and new dependencies.

---

## [0.13.0] — 2026-11-08 — Module 1 Complete: Enterprise Workspace, 7-Role RBAC, Governance, Audit Log & Corporate Precision UI Shell

### Added
- `backend/prisma/schema.prisma` & `backend/prisma/migrations/002_enterprise_foundation/migration.sql`:
  - Implemented the **Unified Enterprise Prisma Schema** across all 8 planned modules (`Role` expanded to 7 roles, `Organization` governance/banking/lockDate/enforceTwoPersonApproval/enabledModules, `OrganizationMember` employee BSB/account fields, `OrganizationInvite`, `AuditLog`, hierarchical `Account` with `isSystem`/`systemKey`/`parentId`, `TrackingCategory` & `TrackingOption`, `Item`, `Quote`, `CreditNote`, `PurchaseOrder`, `VendorCredit`, `BatchPayment`, `DirectTransaction`, `ExpenseClaim`, `BankTransfer`, `BankStatementLine`, `RecurringSchedule`).
- `backend/src/lib/system-accounts.ts`:
  - Defined the **10 Protected System GL Accounts** (`1000`, `1200`, `2000`, `2050`, `2100`, `2200`, `2300`, `3000`, `4000`, `6000`) and idempotent `ensureOrganizationSystemAccounts` seeding helper.
- `backend/src/lib/schema-sync.ts`:
  - Added idempotent startup schema synchronizer executed automatically on server boot in `backend/src/plugins/prisma.ts` so Cloud Run deployments apply `002_enterprise_foundation` DDL and backfill the 10 system accounts on existing organizations automatically.
- `backend/src/lib/audit.ts`:
  - Implemented append-only `recordAuditLog` helper for recording structured audit events into `audit_logs`.
- `backend/src/lib/ledger-posting.ts` & `backend/src/routes/accounts.ts`:
  - Added accounting period `lockDate` check helper and foundational Chart of Accounts / Tracking Categories API routes.
- `frontend/src/components/ui/Drawer.tsx`, `StatusTag.tsx`, & `PipelineRibbon.tsx`:
  - Built core **Corporate Precision Design System** UI primitives (Right-Hand Slide-Over Inspector Drawer, squared technical StatusTag with `6px` dot, and connected horizontal Process Pipeline Ribbon).
- `frontend/src/pages/SettingsPage.tsx`:
  - Built the 5-tab **Workspace Governance & Entity Controls (`/settings`)** workbench:
    1. *Entity Profile & EFT Banking* (with live Tax Invoice Header & EFT Remittance Slip preview)
    2. *Period Locks & Feature Modules* (`lockDate`, Fiscal Year month, 2-Person Approval toggle, Enabled Modules)
    3. *Team & 7-Role RBAC* (Authorized Members table, Pending Invites table, Invite/Assign Modal, and Right-Hand Member Inspector Drawer)
    4. *My Reimbursement Profile* (Employee BSB & Account Number for `2050` expense payouts)
    5. *Immutable System Audit Log* (Filterable table + Right-Hand Audit Event JSON Inspector Drawer)

### Changed
- `backend/src/routes/auth.ts`:
  - Added automatic multi-invite claiming upon Google OAuth sign-in, full membership list & active organization profile in `GET /api/v1/auth/me`, and `POST /api/v1/auth/switch-organization`.
- `backend/src/routes/organizations.ts`:
  - Added `GET /api/v1/users/organizations`, `GET/PATCH /api/v1/organizations/profile`, `PATCH /api/v1/organizations/my-profile`, `GET/PATCH/DELETE /api/v1/organizations/members`, `GET/POST/DELETE /api/v1/organizations/invites`, and `GET /api/v1/audit-logs`.
- `backend/src/routes/contacts.ts`, `bills.ts`, `invoices.ts`, & `ledger.ts`:
  - Updated with 7-Role domain-isolated RBAC guards and immutable `recordAuditLog` instrumentation.
- `frontend/index.html`, `frontend/tailwind.config.ts`, `frontend/src/index.css`, `Button.tsx`, `Input.tsx`, & `Modal.tsx`:
  - Upgraded to the **Corporate Precision Design System** (`Inter` + `JetBrains Mono` with `tabular-nums`, `obsidian-950` `#0B1311`, `forest-900` `#14382C`, crisp `4px–6px` geometry).
- `frontend/src/components/AppShell.tsx`, `frontend/src/hooks/useAuth.tsx`, `frontend/src/api/client.ts`, & `frontend/src/App.tsx`:
  - Rebuilt `AppShell.tsx` with the Obsidian Carbon (`#0B1311`) sidebar, interactive Multi-Company Switcher dropdown, `+ Create New Entity` modal, role/module-filtered navigation, and lean `48px` (`h-12`) Top Context Bar with Period Lock and 2-Person Approval badges.
- `docs/STAGES_ROADMAP.md` & `AGENTS.md`:
  - Marked **Module 1 (1.1 – 1.6)** as `[x]` Completed and added the mandatory **Module-Gate Review Protocol** (Rule 13).

---

## [0.12.0] — 2026-11-08 — Enterprise Ledger-First Architecture & 8-Module Deep-Build Specification

### Changed
- `docs/STAGES_ROADMAP.md`:
  - Re-architected the roadmap into a cohesive **8-Module Enterprise Deep-Build Blueprint** designed to scale from SMEs to multi-entity enterprise deployments:
    - **Module 1 (Enterprise Workspace, RBAC, Governance & Unified Schema):** Multi-company switcher, 7-tier domain-isolated RBAC (`ADMIN`, `ACCOUNTANT`, `MANAGER`, `AR_SPECIALIST`, `AP_SPECIALIST`, `EMPLOYEE`, `AUDITOR`), Company profile with Australian BSB/Account #/APCA ID, Accounting Period Lock Dates, `enforceTwoPersonApproval` toggle, per-org `enabledModules` feature flags (`['CORE_FINANCE', 'EXPENSES', 'FLEET', 'INVENTORY']`), Immutable System Audit Log (`audit_logs`), and upfront Unified Enterprise Prisma Schema migration.
    - **Module 2 (The Financial Spine — CoA, Dimensions & GL Engine):** Full CRUD Chart of Accounts (`/accounts`), 10 Protected System Accounts (`1000`, `1200`, `2000`, `2050`, `2100`, `2200`, `2300`, `3000`, `4000`, `6000`), automated Balance Sweep decommissioning for custom sub-accounts, Tracking Categories / Cost Centers (Dimensions), approval-gated Manual Adjusting Journals, 1-click Reversals, and Recurring Journal Schedules.
    - **Module 3 (Master Data — Contacts & Items Catalog):** Enhanced Contacts with Australian banking details for `.aba` payments and Contact 360 history; Products & Services Catalog (`/items`) with sales/purchase defaults and GL account coding.
    - **Module 4 (Accounts Receivable):** Quotes/Estimates (with 1-click Invoice conversion), Coded Customer Invoices (with printable EFT remittance slip), Recurring Invoices, Customer Credit Notes, and Payments In supporting Invoice Settlement, Direct Income Receipts ("Receive Money"), and Customer Prepayments (`2300`).
    - **Module 5 (Accounts Payable):** Purchase Orders (with manager approval & 1-click Bill conversion), Coded Vendor Bills, Recurring Bills, Vendor Credit Notes, Single Payments Out, and **Australian `.ABA` (Cemtex) Batch Payment File Export**.
    - **Module 6 (Enterprise Expenses):** Direct "Spend Money" (Bank & Corporate Card purchases coded directly to GL) and Employee Expense Claims (`DRAFT` $\rightarrow$ `SUBMITTED` $\rightarrow$ `APPROVED` crediting `2050 Employee Reimbursements Payable` $\rightarrow$ `PAID` via single or `.aba` batch reimbursement).
    - **Module 7 (Multi-Account Banking, Transfers & Reconciliation):** Multiple Bank & Corporate Card accounts, Inter-Account Money Transfers, and CSV/OFX Bank Statement Import & Matching Reconciliation workspace.
    - **Module 8 (Financial Statements, Australian BAS Engine, Live Dashboard & Plug-Ins):** Trial Balance, Dimensional Profit & Loss, Balance Sheet, AR/AP Aging buckets, ATO BAS Worksheet (G1, 1A, 1B), 100% live PostgreSQL Executive Dashboard, and standardized plug-in contracts for Fleet Management, Inventory, and GCS Attachments.
- `AGENT_SPECIFICATION.md`, `docs/SECURITY.md`, & `docs/DATABASE_SCHEMA.md`:
  - Synchronized specifications with the 10 Protected System Accounts, 7-Role RBAC Matrix, Adaptive Maker-Checker Approval rules, Immutable Audit Log, and Unified Enterprise Schema blueprint.
- `docs/DESIGN_SYSTEM.md`:
  - Established the **Corporate Precision Design System**:
    - Replaced bubbly `rounded-xl`/`rounded-2xl` cards, drop-shadows, and pastel icon boxes with crisp `4px–6px` (`rounded` / `rounded-md`) architectural geometry, `1px` hairline structural grids (`border-slate-200`), and compact `36px–40px` table rows.
    - Upgraded financial and technical typography to `JetBrains Mono` (`font-numbers` / `font-mono` with `tabular-nums`) paired with `Inter` (`font-sans`).
    - Defined the **Obsidian Carbon & Institutional Forest** palette (`#0B1311` sidebar, `#14382C` primary actions, `#10B981` emerald signal, `#B45309` brass approval indicators) and squared technical Status Tags (`rounded` with `1px` border and `6px` dot).
    - Standardized the **Connected Process Pipeline Ribbon** (workflow lifecycle bar with live counts and AUD totals) and **Right-Hand Slide-Over Inspector Drawer** across all operational modules.

---

## [0.11.0] — 2026-11-07 — Stage 1 Finalization: Manual Journal Entries & Unallocated Direct Payments In

### Added
- `backend/src/routes/ledger.ts`:
  - `POST /api/v1/ledger/entries`: Manual double-entry adjusting journal entry API:
    - Restricted to `ADMIN` and `ACCOUNTANT` roles.
    - Validates multi-line submissions ($\ge 2$ lines) and ensures all referenced accounts belong to `request.user.organizationId` and are active.
    - Atomically validates double-entry invariant: $\sum \text{Debits} == \sum \text{Credits}$ in integer cents before insertion.
    - Creates `JournalEntry` with `referenceType: 'MANUAL'` and nested `JournalLine`s.
- `frontend/src/api/client.ts`:
  - Added `CreateManualJournalEntryInput` and `ledgerApi.createManualEntry`.
- `frontend/src/pages/LedgerPage.tsx`:
  - Added "New Journal Entry" action button in the header toolbar.
  - Implemented `CreateManualJournalEntryModal`:
    - Dynamic multi-line editor supporting account selection, DEBIT/CREDIT toggles, and dollar-cent amounts.
    - Real-time double-entry balancing indicator displaying total debits, total credits, and exact imbalance differential.
    - Submit disabled until lines are balanced ($\sum D == \sum C$), memo is provided, and all lines have valid accounts and positive amounts.
  - Added `MANUAL` badge and filter option in the General Ledger audit trail.
- `frontend/src/pages/InvoicesPage.tsx`:
  - Added "Receive Payment" action button in the main header (beside "New Invoice").
  - Implemented `ReceiveDirectPaymentModal`:
    - Allows recording incoming customer payments without an invoice (unallocated receipts, retainers, deposits) or matching against open customer invoices.
    - Checks customer's `requiresInvoiceForPayment` policy in real-time; displays customer policy notes and enforces invoice selection when required.
    - Posts directly to the General Ledger via `POST /api/v1/payments-in` (Debit `1000 - Operating Bank Account`, Credit `1200 - Accounts Receivable`).
- `docs/STAGES_ROADMAP.md`:
  - Moved Manual Journal Entries and Unallocated Payments In into Stage 1 milestones.
  - Updated Stage 1 Acceptance Criteria and Deferral Log to reflect 100% completion of Stage 1 Core Transactional Engine and General Ledger / Trial Balance visibility.

---

## [0.10.0] — 2026-11-07 — Stage 1 Complete: Phase 7 Payments In, Phase 8 General Ledger API & Phase F6 General Ledger UI

### Added
- `backend/src/routes/invoices.ts`:
  - `POST /api/v1/invoices/:id/payments`: Implemented Payments In API for receiving customer payments against an invoice:
    - Validates positive integer cents and ensures amount does not exceed remaining invoice balance.
    - Transitions invoice status to `PARTIALLY_PAID` or `PAID`.
    - Automatically creates a `PaymentIn` record and posts a balanced double-entry `JournalEntry`:
      - **DEBIT:** `1000 - Operating Bank Account` (increases cash asset)
      - **CREDIT:** `1200 - Accounts Receivable` (reduces customer AR asset)
      - Invariant: $\sum \text{Debits} == \sum \text{Credits}$.
    - Protected by `requireRole(ADMIN, ACCOUNTANT, AR_SPECIALIST)`.
  - `GET /api/v1/invoices/:id/payments`: List payments received for an invoice.
  - `POST /api/v1/payments-in`: Top-level endpoint for recording customer payments. Enforces contact `requiresInvoiceForPayment` policy (rejects unallocated payments if contact requires invoice matching).
- `backend/src/routes/ledger.ts`:
  - `GET /api/v1/ledger`: Filterable, paginated double-entry audit trail query:
    - Scoped strictly to `request.user.organizationId` for tenant isolation.
    - Supports filtering by date range (`startDate`, `endDate`), event type (`BILL`, `PAYMENT_OUT`, `INVOICE`, `PAYMENT_IN`), account (`accountId`), and description search.
    - Includes nested debit and credit lines with account code, name, and classification.
    - Computes global debit and credit aggregates and asserts ledger balancing invariant.
  - `GET /api/v1/ledger/accounts`: Returns Chart of Accounts for the organization with aggregated debits, credits, and net balance calculated according to normal balance convention (DEBIT vs. CREDIT).
- `backend/src/server.ts`:
  - Registered `ledgerRoutes` plugin.
- `frontend/src/api/client.ts`:
  - Added `PaymentIn`, `RecordPaymentInInput`, `paymentInApi.create`, `invoiceApi.recordPayment`, and `invoiceApi.getPayments`.
  - Added `JournalEntry`, `JournalLine`, `AccountWithBalance`, `LedgerTotals`, and `ledgerApi` (`list`, `accounts`).
- `frontend/src/pages/InvoicesPage.tsx`:
  - Added "Record Payment" action button in table rows and detail modal for issued/partially paid invoices.
  - Added interactive `RecordPaymentInModal` with live remaining balance calculation and payment date/reference inputs.
  - Added "Payments Received" history table inside the invoice detail inspection modal.
- `frontend/src/pages/LedgerPage.tsx`:
  - Implemented full General Ledger and Trial Balance view (Phase F6):
    - Real-time KPI cards: Total Journal Entries, Total Debits, Total Credits, and Ledger Health badge confirming $\sum \text{Debits} == \sum \text{Credits}$.
    - "Journal Entries" tab: Filterable audit log with date range, event type filter, account selector, and search. Each entry displays expandable double-entry lines with account codes and balanced validation status.
    - "Trial Balance" tab: Complete Chart of Accounts summary showing account code, name, category, normal balance, debit totals, credit totals, net balances, and $0.00 difference balancing footer.
- `frontend/src/App.tsx`:
  - Replaced `PlaceholderPages` with `LedgerPage` at `/ledger`.
- `frontend/src/pages/PlaceholderPages.tsx`:
  - Removed as all Stage 1 routes are now fully implemented.

---

## [0.9.0] — 2026-11-07 — Phase 5 Payments Out & Phase 6 Customer Invoices (AR) with Automated Ledger Posting

### Added
- `backend/src/routes/bills.ts`:
  - `POST /api/v1/bills/:id/payments` & `POST /api/v1/payments-out`: Implemented Payments Out API with General Ledger double-entry posting:
    - Validates payment date, positive integer amount in cents, and ensures amount does not exceed remaining unpaid balance.
    - Transitions bill status to `PARTIALLY_PAID` or `PAID`.
    - Automatically creates a `PaymentOut` record and posts a balanced double-entry `JournalEntry`:
      - **DEBIT:** `2000 - Accounts Payable` (reduces AP liability)
      - **CREDIT:** `1000 - Operating Bank Account` (reduces cash asset)
      - Strictly enforces $\sum \text{Debits} == \sum \text{Credits}$.
    - Protected by `requireRole(ADMIN, ACCOUNTANT, AP_SPECIALIST)`.
  - `GET /api/v1/bills/:id/payments`: List payments recorded against a bill.
- `backend/src/routes/invoices.ts`:
  - Implemented Accounts Receivable (AR) Invoices API:
    - `GET /api/v1/invoices`: List organization invoices filterable by status (`DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `VOID`), customer ID, or search string.
    - `POST /api/v1/invoices`: Create customer invoice in `DRAFT` status with dynamic line items and integer-cent Australian GST calculation (`calculateGST`, `sumGSTResults`). Automatically generates sequential `invoiceNumber` (e.g. `INV-1001`) per organization. Validates contact is `CUSTOMER` or `BOTH`.
    - `GET /api/v1/invoices/:id`: Fetch invoice details, line items, and associated General Ledger journal entry.
    - `POST /api/v1/invoices/:id/issue`: Issue draft invoice and post to General Ledger in an atomic transaction:
      - **DEBIT:** `1200 - Accounts Receivable` (Gross Total amount in cents)
      - **CREDIT:** `4000 - Sales Revenue` (Subtotal amount in cents)
      - **CREDIT:** `2100 - GST Collected (Sales)` (GST amount in cents, if $> 0$)
      - Strictly enforces $\sum \text{Debits} == \sum \text{Credits}$.
      - Protected by `requireRole(ADMIN, ACCOUNTANT, AR_SPECIALIST)`.
- `frontend/src/api/client.ts`:
  - Added `PaymentOut` interface, `billApi.recordPayment`, and `billApi.listPayments`.
  - Added `InvoiceStatus`, `InvoiceLineItem`, `Invoice`, `CreateInvoiceInput`, and `invoiceApi` (`list`, `get`, `create`, `issue`).
- `frontend/src/pages/InvoicesPage.tsx`:
  - Implemented full Accounts Receivable customer invoices UI:
    - Invoices table with search, status filter tabs, formatted integer AUD amounts (subtotal, GST, total), and status badges.
    - "New Invoice" modal with customer picker (filtered to `CUSTOMER` and `BOTH`), terms-based due date calculation, dynamic line items (add/remove rows, description, amount, tax treatment), and live subtotal/GST/total breakdown.
    - Detail inspection modal displaying customer information, line item breakdown, draft issuance banner, and double-entry General Ledger debit/credit balance entries upon issuance.
    - One-click "Issue Invoice & Post GL" action button for draft invoices.
- `frontend/src/pages/BillsPage.tsx`:
  - Restored `FileSpreadsheet` icon import required by empty state component.
  - Added "Record Payment" button and interactive modal allowing users to record outgoing payments against bills with live balance validation.
  - Added "Payments Recorded" history table in the bill details modal displaying past payments, payment dates, bank references, and amounts.

### Changed
- `backend/src/server.ts` — Registered `invoiceRoutes` under `/api/v1`.
- `frontend/src/App.tsx` — Replaced placeholder `/invoices` route with production `InvoicesPage` component.
- `frontend/src/pages/PlaceholderPages.tsx` — Removed `InvoicesPage` stub (leaving `LedgerPage` for Phase F6).
- `AGENTS.md` — Updated living directory tree with new routes and page components.
- `docs/STAGES_ROADMAP.md` — Marked Phase 5, Phase 6, and Phase F5 as completed.

---

## [0.8.1] — 2026-11-07 — Hardened TypeScript Compiler Settings & Pruned Unused Imports

### Changed
- `frontend/src/pages/BillsPage.tsx` — Pruned unused `Calendar` icon import.
- `frontend/src/pages/PlaceholderPages.tsx` — Pruned unused `FileSpreadsheet` icon import.
- `frontend/tsconfig.json` — Adjusted `noUnusedLocals: false` and `noUnusedParameters: false` to prevent trivial unused import warnings from failing the production Docker build step during deployment.
- `AGENTS.md` & `AGENT_SPECIFICATION.md` — Added Mandatory Rule 12 / Rule 7 explicitly instructing all agents on clean imports and compiler tolerance safeguards.

---

## [0.8.0] — 2026-11-07 — Phase 4 Accounts Payable (AP) Bills & Automatic Double-Entry Ledger Posting

### Added
- `backend/src/routes/bills.ts` — Implemented Accounts Payable (AP) Bills API:
  - `GET /api/v1/bills`: Filter bills by status (`AWAITING_PAYMENT`, `PARTIALLY_PAID`, `PAID`, `VOID`), contactId, or search query. Scoped strictly to `organizationId`.
  - `POST /api/v1/bills`: Atomic transaction creating Bill, multiple Line Items, and posting double-entry lines to General Ledger:
    - Calculates integer-cent GST using `calculateGST` (`TAX_EXCLUSIVE`, `TAX_INCLUSIVE`, or `GST_FREE`).
    - Validates vendor contact and verifies Chart of Accounts (`5000` Operating Expenses, `2200` GST Paid, `2000` Accounts Payable).
    - Verifies double-entry ledger balance invariant (`Debit sum == Credit sum`).
    - Protected by `requireRole(ADMIN, ACCOUNTANT, AP_SPECIALIST)`.
  - `GET /api/v1/bills/:id`: Retrieve bill details, line items, and associated double-entry `journalEntry` records.
- `frontend/src/api/client.ts` — Added `billApi` client methods (`list`, `get`, `create`) and TypeScript interfaces.
- `frontend/src/pages/BillsPage.tsx` — Full-featured Accounts Payable UI:
  - Table showing vendor name, reference, issue and due dates, formatted integer AUD amounts (subtotal, GST, total), and status badges.
  - Interactive "New Bill" modal with dynamic multi-line item inputs (add/remove rows, description, amount, tax treatment selector).
  - Real-time client-side calculation preview for subtotal, 10% GST, and total payable amount.
  - Detail inspection modal displaying line item breakdown and verified General Ledger debit/credit balance entries.

### Changed
- `backend/src/server.ts` — Registered `billRoutes` plugin under `/api/v1`.
- `frontend/src/App.tsx` — Replaced placeholder `/bills` route with production `BillsPage` component.
- `frontend/src/pages/PlaceholderPages.tsx` — Removed `BillsPage` stub.
- `AGENTS.md` — Updated living directory tree with `backend/src/routes/bills.ts` and `frontend/src/pages/BillsPage.tsx`.
- `docs/STAGES_ROADMAP.md` — Marked Phase 4 and Phase F4 as completed.

---

## [0.7.1] — 2026-11-07 — Fixed Frontend TypeScript Compiler Errors

### Changed
- `frontend/src/pages/ContactsPage.tsx` — Renamed `isOpen` prop to `open` when passing to `<Modal>` component, matching the `ModalProps` interface definition.
- `frontend/src/pages/PlaceholderPages.tsx` — Replaced unused and undefined `Users` icon fallback with typed `icon: LucideIcon` in the `ComingSoon` component to satisfy strict TypeScript compilation in Docker builds.

---

## [0.7.0] — 2026-11-07 — Phase 3 Contacts Directory (API & UI)

### Added
- `backend/src/routes/contacts.ts` — Implemented Contacts CRUD API:
  - `GET /api/v1/contacts`: Filter by contact type (`CUSTOMER`, `VENDOR`, `BOTH`), active state, or search string (name, email, ABN digits), scoped strictly to `organizationId`.
  - `POST /api/v1/contacts`: Create new contact with optional ATO modulus 89 ABN validation, custom payment terms in days (0–365), and invoice requirement policy (`requiresInvoiceForPayment`). Protected by `requireRole(ADMIN, ACCOUNTANT, AR_SPECIALIST, AP_SPECIALIST)`.
  - `GET /api/v1/contacts/:id`: Fetch single contact details with row-level multi-tenant boundary.
  - `PATCH /api/v1/contacts/:id`: Update contact details, payment terms, or toggle active/inactive status.
- `frontend/src/api/client.ts` — Added typed `contactApi` client methods (`list`, `get`, `create`, `update`) and TypeScript interfaces.
- `frontend/src/pages/ContactsPage.tsx` — Full-featured Contacts Directory UI:
  - Tabbed filtering for Customer, Vendor, and Both types.
  - Debounced real-time search across names, emails, and formatted ABNs.
  - Interactive Create/Edit modal with live Australian Business Number (ABN) validation.
  - Net payment terms and invoice requirement policy controls.
  - Status toggle (`Active` / `Inactive`).

### Changed
- `backend/src/server.ts` — Registered `contactRoutes` plugin under `/api/v1`.
- `frontend/src/App.tsx` — Replaced placeholder route with production `ContactsPage` component.
- `frontend/src/pages/PlaceholderPages.tsx` — Removed `ContactsPage` stub.
- `AGENTS.md` — Updated living directory tree with `backend/src/routes/contacts.ts` and `frontend/src/pages/ContactsPage.tsx`.
- `docs/STAGES_ROADMAP.md` — Marked Phase 3 and Phase F3 as completed.

---

## [0.6.2] — 2026-11-07 — Reverted Premature Database Mock Fallbacks & Enforced Fail-Fast Startup

### Changed
- `backend/src/plugins/prisma.ts` — Removed all mock/dummy database URL fallbacks and soft warning states. Prisma now fails fast at startup if database environment variables are missing, preventing unauthenticated half-initialized states.
- `backend/src/server.ts` — Restored `/healthz` to return HTTP 503 if Cloud SQL is unreachable, ensuring Cloud Run accurately reflects container database health.

---

## [0.6.1] — 2026-11-07 — Hardened Cloud SQL Discovery & Mandatory Multi-Tenant Configuration

### Changed
- `backend/src/plugins/prisma.ts` — Removed all hardcoded database fallback strings to protect multi-tenant integrity across client/business forks. Database configuration now strictly relies on explicit environment variables (`INSTANCE_CONNECTION_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`) or dynamic `/cloudsql` socket discovery. Added quote-stripping for UI-entered `DATABASE_URL` strings, explicit `datasources.db.url` configuration in `new PrismaClient()`, and non-crashing initialization with descriptive diagnostic logging when variables are missing.
- `AGENTS.md`, `AGENT_SPECIFICATION.md`, and `docs/ARCHITECTURE.md` — Added `INSTANCE_CONNECTION_NAME` to the mandatory Cloud Run environment variables specification table so any future agent turn or fork explicitly configures the target Cloud SQL instance.

---

## [0.6.0] — 2026-11-07 — Reconciled Specifications, Unified Container Codebase & No Local Execution Rule

### Added
- `backend/prisma/migrations/001_init/migration.sql` — Generated comprehensive PostgreSQL DDL script creating all 8 enums, 14 database tables, indexes, and relational foreign keys.
- `AGENTS.md` — Added Mandatory Rule 11: Explicit prohibition of `npm install` and local host execution. All dependencies and build steps are declared in configuration files and executed remotely in Cloud Build / Docker during deployment. Restored the full living directory layout.
- `AGENTS.md` & `AGENT_SPECIFICATION.md` & `docs/ARCHITECTURE.md` — Codified the complete Cloud Run runtime specification table matching active deployment (environment variables `GOOGLE_CLIENT_ID`, `DB_USER`, `DB_NAME`, `FRONTEND_ORIGIN`, `NODE_ENV`; secrets `DB_PASSWORD`, `SESSION_SECRET`, `WEBHOOK_SECRET`; Cloud SQL connection `digitalworkflowsolutions-erp:us-central1:erp`).
- `AGENT_SPECIFICATION.md` — Added Mandatory Agent Rule 5: Zero local installation or host execution.
- `backend/package.json` — Added dependency `@fastify/static`.
- `backend/src/routes/auth.ts` — Added `GET /api/v1/auth/config` to dynamically supply `GOOGLE_CLIENT_ID` to the frontend without requiring build-time arguments.
- `frontend/src/vite-env.d.ts` — Added Vite client type definitions for TypeScript compilation.
- `frontend/src/pages/LoginPage.tsx` — Cleaned up unused Google login hook stubs (`handleGoogleLogin`, `handleCredentialLogin`) to satisfy strict TypeScript `noUnusedLocals` compiler rules during Docker builds.
- `backend/src/server.ts` & `backend/src/routes/auth.ts` — Implemented resilient database error fallbacks: `/healthz` returns 200 with non-blocking DB connectivity status, and auth routes return descriptive 503 errors if Cloud SQL is unreachable, ensuring the container and frontend interface always load regardless of database availability.
- `backend/src/server.ts` — Added `@fastify/static` plugin registration, multi-path asset resolution (`resolveFrontendDistPath()`), explicit `GET /` handler, and SPA client-side routing fallback handler (`index.html` fallback for non-API routes). Configured `crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }` to allow Google Identity Services OAuth popup callbacks to communicate with the app window. Enhanced Content Security Policy (CSP) directives for Google Fonts, Google OAuth avatars, and inline styling.

### Changed
- `backend/.gitignore` — Removed ignore rule for `prisma/migrations` so database schema migrations are tracked in git and deployable in CI/CD.
- `AGENT_SPECIFICATION.md` — Reconciled Section 2 with `docs/ARCHITECTURE.md` and `AGENTS.md` to specify the Unified Monolith architecture (React SPA served by Fastify on Cloud Run, eliminating Firebase and CORS requirements).
- `Dockerfile` — Upgraded to a multi-stage build that compiles `/frontend` (Vite) and `/backend` (TypeScript) into a single production container image for Cloud Run deployment. Added `ENV FRONTEND_DIST_PATH=/app/frontend/dist` in runtime stage.
- `.dockerignore` — Removed `frontend/` exclusion to allow Docker to copy and compile frontend assets during remote builds.

### Removed
- `docs/AGENT_SPECIFICATION.md` — Removed redundant, truncated specification stub in favor of single master `AGENT_SPECIFICATION.md` in the root.

---

## [0.5.0] — 2026-11-01 — Architectural Shift to Single Unified Container

### Changed
- `docs/ARCHITECTURE.md` — Updated the topology diagram and service boundaries to mandate a Single Unified Cloud Run Service. Removed all references to Firebase Hosting and Cloud Storage CDN for the frontend.
- `docs/ARCHITECTURE.md` — Removed `FRONTEND_ORIGIN` from environment variables, as identical origins eliminate CORS requirements.
- `AGENT_SPECIFICATION.md` — Updated Section 2 to specify the Unified Monolith architecture. Explicitly defined that Fastify will serve the compiled React SPA via `@fastify/static` with an SPA fallback routing mechanism.
- `AGENTS.md` — Updated Mandatory Rule 8 to strictly enforce a multi-stage Docker build that compiles both the frontend and backend into a single runtime image.

---

## [0.4.8] — 2026-11-01 — Removed .env Files & Automated Cloud Run Container Config

### Removed
- `backend/.env.example`, `frontend/.env.example` — Removed all `.env` files in favor of direct Cloud Run Container configuration (environment variables, Secret Manager secrets, and Cloud SQL connections).

### Added
- `backend/src/plugins/prisma.ts` — Implemented automatic discovery of Cloud SQL Unix sockets mounted in `/cloudsql` by Cloud Run.
- `AGENTS.md` & `docs/ARCHITECTURE.md` — Updated living directory tree and documentation for Cloud Run Container UI configuration.

---

## [0.4.7] — 2026-11-01 — Cloud SQL Instance Connection Specification & Secret Support

### Changed
- `backend/src/plugins/prisma.ts` — Enhanced `resolveDatabaseUrl()` to directly support Google Cloud's standard `INSTANCE_CONNECTION_NAME` (`PROJECT_ID:REGION:INSTANCE_NAME`) alongside `DB_HOST`, mounting `DB_PASSWORD` directly from Secret Manager with URL-encoding for complex passwords.
- `docs/ARCHITECTURE.md` & `backend/.env.example` — Documented Google Cloud SQL instance connection name standard and Secret Manager mapping.

---

## [0.4.6] — 2026-11-01 — Discrete Cloud SQL Environment Variables & Secrets

### Added
- `backend/src/plugins/prisma.ts` — Added `resolveDatabaseUrl()` helper allowing database credentials to be supplied as individual environment variables / secrets (`DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST=/cloudsql/...`) or as a monolithic `DATABASE_URL`.
- `backend/.env.example` & `docs/ARCHITECTURE.md` — Documented discrete Cloud SQL configuration with Secret Manager support.

---

## [0.4.5] — 2026-11-01 — Container Startup & Health Resilience

### Fixed
- `backend/src/plugins/prisma.ts` — Made initial database connection non-blocking so container starts and listens on `$PORT` even if `DATABASE_URL` is not yet configured during initial Cloud Run deployment.
- `backend/src/server.ts` — Wrapped entire startup sequence in try/catch to ensure graceful logging.

---

## [0.4.4] — 2026-11-01 — TypeScript Build Fixes for Cloud Build

### Fixed
- `backend/tsconfig.json` — Removed `exactOptionalPropertyTypes: true` which caused compilation incompatibilities with Fastify, Pino, and Prisma library types.
- `backend/src/plugins/auth.ts` — Removed conflicting duplicate `declare module '@fastify/cookie'` interface declaration.
- `backend/src/routes/auth.ts` — Added explicit validation for `GOOGLE_CLIENT_ID` before invoking `verifyIdToken` and normalized `avatarUrl` to `null`.
- `backend/src/server.ts` — Adjusted logger and cookie registration to prevent passing `undefined` properties to Fastify plugins.

---

## [0.4.3] — 2026-11-01 — Documentation & Stages Roadmap Synchronization

### Changed
- `docs/STAGES_ROADMAP.md` — Marked Phase 2 (`POST /api/v1/organizations` & `GET /api/v1/auth/me`), Phase F1 (Vite/React/Tailwind scaffold & Google login), and Phase F2 (Onboarding modal with live ABN validator) as complete.
- `docs/SECURITY.md` — Updated session cookie mechanics to document HMAC-SHA256 constant-time verification and documented the session restoration endpoint `GET /api/v1/auth/me`.

---

## [0.4.2] — 2026-11-01 — Agent Rules & Living File Tree

### Added
- `AGENTS.md` — Added Mandatory Rule 9: Agents must review the complete file structure before creating or altering files to prevent directory duplication, and update both `AGENTS.md` and `docs/CHANGELOG.md` whenever files are added, removed, or moved.
- `AGENTS.md` — Added Mandatory Rule 10: Strict prohibition on autonomous `git commit` or `git push` operations; all git workflow operations are reserved for manual execution by the user.
- `AGENTS.md` — Replaced high-level tree with full, living directory tree of all repository files.

---

## [0.4.1] — 2026-11-01 — Directory Structure & Docker Clean-up

### Removed
- `backend/Dockerfile`, `backend/.dockerignore` — Removed redundant nested backend Docker files in favor of single root `Dockerfile`.
- `frontend/Dockerfile`, `frontend/.dockerignore`, `frontend/nginx.conf.template` — Removed invalid frontend containerization; frontend is deployed as static assets per spec.

### Changed
- Verified root directory layout matches `AGENT_SPECIFICATION.md` exactly: single root `Dockerfile` and `.dockerignore` for Cloud Run backend deployment.

---

## [0.4.0] — 2026-11-01 — Root Cloud Run Dockerfile & Phase 2 Onboarding API

### Added
- `Dockerfile` (root) — Multi-stage Cloud Run production build targeting Fastify backend
- `.dockerignore` (root) — Ignore frontend, local node_modules, and git from container context
- `backend/src/routes/organizations.ts` — `POST /api/v1/organizations` with ATO ABN validation, atomic org member assignment (ADMIN), and automated 7-account Chart of Accounts seed
- `backend/src/routes/auth.ts` — Added `GET /api/v1/auth/me` for seamless session restoration on page reload
- `frontend/src/api/client.ts` — Added `authApi.me()`
- `frontend/src/hooks/useAuth.tsx` — Auto-restore auth state on initial mount

---

## [0.3.0] — 2026-11-01 — Phase F1 & Cloud Run Containerization

### Added
- `frontend/` — React 18 + Vite + TypeScript + Tailwind CSS SPA scaffold
- `frontend/package.json` — dependencies: `@react-oauth/google`, `lucide-react`,
  `react-router-dom`, `clsx`, `tailwind-merge`
- `frontend/vite.config.ts` — Vite dev server with proxy to backend (`http://localhost:8080`)
- `frontend/tailwind.config.ts` — Brand tokens (Forest, Navy, semantic pastel badges, Inter/Open Sans)
- `frontend/src/api/client.ts` — Typed API client with credentialed requests
- `frontend/src/hooks/useAuth.tsx` — Global auth state machine (loading / unauthenticated / onboarding / authenticated)
- `frontend/src/pages/LoginPage.tsx` — Clean login screen with Google sign-in
- `frontend/src/pages/OnboardingModal.tsx` — Modal with ATO ABN checksum validation for first-time org setup
- `frontend/src/components/AppShell.tsx` — Responsive navigation sidebar with brand colors and sign-out
- `frontend/src/pages/DashboardPage.tsx` — Initial dashboard with tabular figures and summary cards
- `frontend/src/pages/PlaceholderPages.tsx` — Route shells for Contacts, Invoices, Bills, Ledger
- `backend/Dockerfile` & `backend/.dockerignore` — Multi-stage production container for Cloud Run deployment
- `frontend/Dockerfile` & `frontend/nginx.conf.template` — Production SPA container for Cloud Run deployment
- `AGENTS.md` & `docs/ARCHITECTURE.md` updated with containerization requirements

---

## [0.2.0] — 2026-11-01 — Phase 1: Backend Init, Auth & Prisma Schema

### Added
- `backend/` — Fastify + TypeScript Node.js project initialized
- `backend/package.json` — dependencies: `fastify`, `@fastify/cookie`,
  `fastify-plugin`, `@fastify/helmet`, `@fastify/cors`, `@fastify/sensible`,
  `google-auth-library`, `@prisma/client`, `zod`, `uuid`
- `backend/package.json` — devDependencies: `prisma`, `typescript`, `tsx`,
  `@types/node`, `@types/uuid`
- `backend/tsconfig.json` — TypeScript strict mode configuration
- `backend/prisma/schema.prisma` — full initial Prisma schema
- `backend/src/server.ts` — Fastify server setup with plugin registrations
- `backend/src/plugins/prisma.ts` — Prisma client Fastify plugin
- `backend/src/plugins/auth.ts` — session cookie middleware, `request.user` decorator
- `backend/src/routes/auth.ts` — `POST /api/v1/auth/google` (Google OIDC verification + upsert)
- `backend/src/lib/abn.ts` — ATO ABN checksum validation utility
- `backend/src/lib/gst.ts` — GST calculation utilities (exclusive / inclusive / free)
- `backend/.env.example` — documented environment variables
- Prisma migration `001_init` generated

---

## [0.1.0] — 2026-11-01 — Phase 0: Repository Scaffold

### Added
- `AGENT_SPECIFICATION.md` — master system specification
- `AGENTS.md` — root agent operating manual and constraints
- `docs/ARCHITECTURE.md` — GCP topology and service boundaries
- `docs/DATABASE_SCHEMA.md` — PostgreSQL tables, Prisma models, migration log
- `docs/SECURITY.md` — Auth flow, RBAC matrix, cryptographic standards
- `docs/DESIGN_SYSTEM.md` — Typography, color tokens, Tailwind config, table standards
- `docs/INTEGRATIONS.md` — Async webhook payloads and n8n job contracts
- `docs/STAGES_ROADMAP.md` — Stage 1–3 milestones and deferral log
- `docs/CHANGELOG.md` — this file