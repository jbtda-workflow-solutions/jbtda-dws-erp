# Master Architecture & 13-Module Deep-Build Roadmap

This document is the authoritative architectural blueprint and execution plan for the **JBTDA-DWS Enterprise Ledger & Business Services Platform**.

---

## 1. Architectural Philosophy: Ledger-First & Enterprise-Ready

Unlike basic small-business CRUD tools, this platform is architected as a **Ledger-First Financial & Business Services System** capable of scaling from a single-owner SME to a multi-entity, multi-role enterprise deployment:

1. **The General Ledger is the Single Source of Truth:**
   - Every financial event—whether an Invoice, Vendor Bill, Direct Card Expense, Employee Reimbursement, Customer Prepayment, Credit Note, or Bank Transfer—compiles down to an atomic, balanced Double-Entry Journal Entry ($\sum \text{Debits} == \sum \text{Credits}$ in integer AUD cents).
2. **Dimensional Accounting (Tracking Categories / Cost Centers):**
   - Instead of polluting the Chart of Accounts with hundreds of duplicate accounts, every journal line and sub-ledger line item supports **Tracking Dimensions** (e.g., *Department*, *Project*, *Location*, *Fleet Vehicle*). This enables instant P&L reporting by business unit or asset and provides the native financial hook for future modules like **Fleet Management** and **Inventory Management**.
3. **Adaptive Governance (Zero Friction for SMEs, Strict Controls for Enterprises):**
   - **Smart Approval Workflows:** `ADMIN` and `ACCOUNTANT` users can "Approve & Post Immediately" in a single click (ideal for small businesses), while `EMPLOYEE`, `AR_SPECIALIST`, and `AP_SPECIALIST` users submit entries into a maker-checker approval queue (`DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `APPROVED/POSTED`). Organizations can optionally enforce strict two-person approval (`enforceTwoPersonApproval`).
   - **Immutable System Audit Log:** Every state mutation across the platform records the actor, timestamp, entity, action, and change payload in an append-only `audit_logs` table.
   - **Accounting Period Lock Dates:** Admins can lock completed months or lodged BAS quarters (`lockDate`), strictly preventing backdated mutations in closed periods.
4. **Single Unified Codebase with Per-Organization Module Feature Flags:**
   - The platform runs as a unified container on Google Cloud Run (deployable either as a shared multi-tenant cloud service or a dedicated single-client enterprise instance).
   - Optional capabilities (`EXPENSES`, `FLEET`, `INVENTORY`, `ATTACHMENTS`) are controlled per organization via `enabledModules` flags, communicating with the core exclusively through the internal `LedgerPostingService` contract.
5. **Module-by-Module Deep Execution (Zero Mock Data):**
   - Rather than rushing through shallow horizontal phases, development proceeds **one complete module at a time to 100% enterprise depth**. Every screen, rollup, and balance queries live PostgreSQL data with zero hardcoded mock numbers.

---

## 2. System Domain Topology

```text
┌────────────────────────────────────────────────────────────────────────────────────┐
│                MODULE 1: ENTERPRISE WORKSPACE, RBAC & GOVERNANCE                   │
│  Multi-Company Switcher • 7-Role RBAC • Immutable Audit Log • Period Lock Dates    │
│  Company Remittance Profile (BSB/Acct) • Module Feature Flags (enabledModules)     │
└─────────────────────────────────────────┬──────────────────────────────────────────┘
                                          │
┌─────────────────────────────────────────▼──────────────────────────────────────────┐
│            MODULE 2: THE FINANCIAL SPINE (COA, DIMENSIONS & GL ENGINE)             │
│  Protected System Accounts + Custom CoA (/accounts) • Tracking Dimensions          │
│  Manual & Recurring Journals • Reversals • Strict Invariant: Σ Debits == Σ Credits │
└────────▲────────────────────▲────────────────────────▲────────────────────▲────────┘
         │                    │                        │                    │
         │ AR Postings        │ AP Postings            │ Expense Postings   │ Transfers & Rec
┌────────┴─────────┐ ┌────────┴─────────┐     ┌────────┴─────────┐ ┌────────┴─────────┐
│ MODULE 4: AR     │ │ MODULE 5: AP     │     │ MODULE 6:        │ │ MODULE 7:        │
│ • Quotes/Est.    │ │ • Purchase Orders│     │ EXPENSES         │ │ BANKING & REC    │
│ • Invoices       │ │ • Vendor Bills   │     │ • Spend Money    │ │ • Multi-Bank/Card│
│ • Recurring Inv. │ │ • Recurring Bills│     │   (Direct Card)  │ │ • Inter-Account  │
│ • AR Credit Notes│ │ • AP Credit Notes│     │ • Employee Claims│ │   Transfers      │
│ • Direct Income &│ │ • Batch Payments │     │   & Approvals    │ │ • CSV/OFX Import │
│   Prepayments    │ │   & .ABA Export  │     │ • 2050 Reimburse │ │   & Matching     │
└────────▲─────────┘ └────────▲─────────┘     └────────▲─────────┘ └────────┬─────────┘
         │                    │                        │                    │
         └────────────────────┴───────────┬────────────┴────────────────────┘
                                          │
┌─────────────────────────────────────────┴──────────────────────────────────────────┐
│             MODULE 3: MASTER DATA (CONTACTS & ITEMS / SERVICES CATALOG)            │
│  Customers & Vendors (ABN, Terms, BSB/Account #) • Coded Products & Services       │
└─────────────────────────────────────────┬──────────────────────────────────────────┘
                                          │ Live PostgreSQL Aggregations
┌─────────────────────────────────────────▼──────────────────────────────────────────┐
│         MODULE 8: FINANCIAL STATEMENTS, BAS ENGINE, DASHBOARD & PLUG-INS           │
│  Trial Balance • P&L (by Dimension) • Balance Sheet • AR/AP Aging • Australian BAS │
│  Live Executive Dashboard • Optional Enterprise Modules (Fleet, Inventory, GCS)    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Protected System Accounts (Seeded per Organization)

To guarantee that automated sub-ledger postings, tax calculations, and employee reimbursements never fail, every organization is seeded with **10 Protected System Accounts** (`isSystem: true`). Users may rename descriptions or create child sub-accounts under them, but system accounts **cannot be deleted or have their codes/types altered**:

| Code | Account Name | Type | Normal Balance | System Key | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `1000` | Operating Bank Account | `ASSET` | `DEBIT` | `OPERATING_BANK` | Default primary bank account for settlements |
| `1200` | Accounts Receivable (A/R) | `ASSET` | `DEBIT` | `ACCOUNTS_RECEIVABLE` | Control account for issued customer invoices & credit notes |
| `2000` | Accounts Payable (A/P) | `LIABILITY` | `CREDIT` | `ACCOUNTS_PAYABLE` | Control account for approved vendor bills & vendor credits |
| `2050` | Employee Reimbursements Payable | `LIABILITY` | `CREDIT` | `EMPLOYEE_REIMBURSEMENTS` | Liability control account for approved staff expense claims |
| `2100` | GST Collected (Sales) | `LIABILITY` | `CREDIT` | `GST_COLLECTED` | 10% Australian GST collected on sales (BAS Label 1A) |
| `2200` | GST Paid (Purchases) | `ASSET` | `DEBIT` | `GST_PAID` | 10% Australian GST paid on bills & expenses (BAS Label 1B) |
| `2300` | Customer Prepayments / Unearned | `LIABILITY` | `CREDIT` | `CUSTOMER_PREPAYMENTS` | Unallocated customer deposits / retainers received on account |
| `3000` | Retained Earnings | `EQUITY` | `CREDIT` | `RETAINED_EARNINGS` | Cumulative historical net profit/loss equity account |
| `4000` | Sales Revenue | `REVENUE` | `CREDIT` | `DEFAULT_REVENUE` | Default operating income account for invoice lines & direct receipts |
| `6000` | Operating Expenses | `EXPENSE` | `DEBIT` | `DEFAULT_EXPENSE` | Default operating expense account for bill lines & expense claims |

> **Sub-Account Decommissioning Rule:** Custom accounts with posted journal lines cannot be hard-deleted. They can either be marked inactive (`isActive: false`) or decommissioned via an automated **Balance Sweep Journal** that transfers their remaining balance into their parent/main account.

---

## 4. Enterprise 7-Role RBAC Matrix

Access is strictly compartmentalized by domain so regular staff and specialists only see what their role permits:

| Capability | `ADMIN` | `ACCOUNTANT` | `MANAGER` | `AR_SPECIALIST` | `AP_SPECIALIST` | `EMPLOYEE` | `AUDITOR` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Org Settings, Lock Dates, Modules & User Invites | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Chart of Accounts & Tracking Dimensions | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | 🔍 Read |
| General Ledger, Manual Journals & Financial Reports | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | 🔍 Read |
| 1-Click "Approve & Post" (Journals, Bills, Invoices) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve Purchase Orders & Team Expense Claims | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View & Manage Contacts & Items Catalog | ✅ | ✅ | 🔍 Read | ✅ (Cust) | ✅ (Vend) | ❌ | 🔍 Read |
| Quotes, Customer Invoices, AR Credits & Receipts | ✅ | ✅ | 🔍 Read | ✅ | ❌ | ❌ | 🔍 Read |
| Purchase Orders, Vendor Bills & AP Credits | ✅ | ✅ | ✅ (POs) | ❌ | ✅ | ❌ | 🔍 Read |
| Execute Payments Out & Export `.ABA` Bank Files | ✅ | ✅ | ❌ | ❌ | Draft/Prep | ❌ | ❌ |
| Record Direct "Spend Money" Bank/Card Expenses | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | 🔍 Read |
| Submit & View **Own** Employee Expense Claims | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (Own Only) | 🔍 Read |
| View System Audit Log | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 5. The 12-Module Deep-Build Execution Plan

Development proceeds strictly **one module at a time**. We complete the backend routes, validations, ledger integrations, audit logging, and frontend interfaces for a module before moving to the next.

> **Module-Gate Review Protocol (Mandatory):** When a module is completed, all checklist items for that module MUST be marked `[x]` in this document, `AGENTS.md` and `docs/CHANGELOG.md` must be updated, a conventional git commit message must be provided, and the agent MUST STOP for user review before beginning the next module.

---

### Module 1: Enterprise Workspace, RBAC, Governance & Unified Database Schema (✅ COMPLETED)
**Objective:** Lay down the complete enterprise PostgreSQL schema upfront so all foreign keys, enums, and domain relationships exist cleanly from day one, and build the complete multi-company workspace, RBAC security layer, and audit log engine.

- [x] **1.1 Unified Enterprise Prisma Schema Migration**:
  - Define the complete schema across all 8 modules in `backend/prisma/schema.prisma` (Organizations, Members with Employee Bank BSB/Acct, Invites, AuditLogs, Accounts with `isSystem`/`parentId`, TrackingCategories & Options, Contacts with Vendor BSB/Acct, Items, Quotes, Invoices, CreditNotes, PurchaseOrders, Bills, VendorCredits, ExpenseClaims, DirectTransactions, RecurringSchedules, PaymentsIn, PaymentsOut, BatchPayments, BankStatementLines, JournalEntries, JournalLines).
- [x] **1.2 Organization Profile, Governance & Feature Flags**:
  - Expand `Organization` with `legalName`, `tradingName`, `abn`, `email`, `phone`, `addressLine1`, `addressLine2`, `city`, `state`, `postcode`, `bankBsb`, `bankAccountNumber`, `bankAccountName`, `apcaUserId` (for `.aba` exports), `defaultPaymentTermsDays`, `fiscalYearStartMonth` (default `7` for July AU), `lockDate`, `enforceTwoPersonApproval`, and `enabledModules` (`['CORE_FINANCE', 'EXPENSES']`).
  - Endpoints: `GET /api/v1/organizations/profile` and `PATCH /api/v1/organizations/profile`.
- [x] **1.3 Multi-Company Switching & Self-Service Creation**:
  - `GET /api/v1/users/organizations`: List all organizations the user belongs to with their role and enabled modules.
  - `POST /api/v1/auth/switch-organization`: Verify membership and issue a re-signed session cookie for the selected company.
  - `POST /api/v1/organizations`: Allow authenticated users to create additional companies at any time, seeding the 10 protected system accounts.
- [x] **1.4 Team Invitations, 7-Role RBAC & Employee Banking Profile**:
  - Invite users by email with any of the 7 roles (`ADMIN`, `ACCOUNTANT`, `MANAGER`, `AR_SPECIALIST`, `AP_SPECIALIST`, `EMPLOYEE`, `AUDITOR`).
  - Store employee reimbursement bank details (`bankBsb`, `bankAccountNumber`, `bankAccountName`) on `OrganizationMember`.
  - Enforce domain-isolated RBAC middleware across all routes (e.g., `EMPLOYEE` cannot access `/ledger`, `/bills`, `/invoices`, or `/contacts`).
- [x] **1.5 Immutable System Audit Log Engine**:
  - Helper service `recordAuditLog(tx, { organizationId, actorUserId, action, entityType, entityId, summary, metadata })` called inside transactional mutations.
  - `GET /api/v1/audit-logs`: Paginated, filterable audit trail for `ADMIN`, `ACCOUNTANT`, and `AUDITOR`.
- [x] **1.6 Corporate Precision Design System Primitives & Module 1 UI**:
  - Upgrade `tailwind.config.ts` and `index.html` (`Inter` + `JetBrains Mono`, `obsidian-950` `#0B1311`, sharp `4px–6px` geometry).
  - Build core reusable precision primitives: `Drawer.tsx` (Right-Hand Slide-Over Inspector), `PipelineRibbon.tsx` (Connected Lifecycle Process Bar), `StatusTag.tsx` (Squared bordered tag with `6px` dot), and crisp `Button.tsx` / `Input.tsx` / `Modal.tsx`.
  - Upgrade `AppShell.tsx` to the **Obsidian Carbon** institutional frame with domain-grouped navigation, `h-12` Top Context Bar, Company Switcher dropdown, role badge, and `+ Create New Company`.
  - Dynamic sidebar navigation filtered by user `Role` and `organization.enabledModules`.
  - **Workspace Settings Page (`/settings`)** with tabs for:
    1. *Company Profile & Bank Remittance*
    2. *Financial Controls (Lock Date, Fiscal Year, 2-Person Approval Toggle, Enabled Modules)*
    3. *Team Members, Roles & Invitations*
    4. *My Reimbursement Bank Details*
    5. *System Audit Log Viewer*

---

### Module 2: The Financial Spine — Chart of Accounts, Dimensions & General Ledger Engine (✅ COMPLETED)
**Objective:** Build an enterprise-grade General Ledger engine with full Chart of Accounts management, hierarchical sub-accounts, Tracking Dimensions (Cost Centers), approval-gated manual journals, journal reversals, and recurring journal schedules.

- [x] **2.1 Chart of Accounts Management (`/accounts` & `/api/v1/accounts`)**:
  - Full CRUD for GL accounts (`code`, `name`, `type`, `normalBalance`, `parentId`, `defaultTaxTreatment`, `isBankAccount`, `bankBsb`, `bankAccountNumber`, `isActive`).
  - System Account Protection: Block deletion or code/type mutation on the 10 protected `isSystem` accounts.
  - Decommissioning & Balance Sweep: If a user deletes/decommissions a custom sub-account that has a non-zero balance, offer an automated **Sweep & Archive** action that posts a balancing journal transferring its balance to its parent/main account and marks the sub-account inactive.
- [x] **2.2 Tracking Categories / Cost Centers (`/api/v1/tracking-categories`)**:
  - Create and manage Tracking Categories (e.g., `Department`, `Project`, `Fleet Vehicle`) and their selectable Options (e.g., `Sales`, `Engineering`, `Truck-01`).
  - UI management tab within `/accounts` (or `/settings`).
- [x] **2.3 Core `LedgerPostingService` & Period Lock Enforcement**:
  - Centralized TypeScript service that validates and posts all journal entries across the entire monolith:
    - Enforces $\sum \text{Debits} == \sum \text{Credits}$ in integer cents.
    - Rejects postings dated on or before `organization.lockDate`.
    - Validates all `accountId` and `trackingOptionId` foreign keys belong to `organizationId` and are `isActive: true`.
- [x] **2.4 Manual Adjusting Journals, Approvals, Reversals & Recurring Schedules (`/ledger`)**:
  - Lifecycle: `DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `POSTED` $\rightarrow$ `REVERSED`.
  - Smart Approval: `ADMIN`/`ACCOUNTANT` can post immediately or save as draft; others submit for approval.
  - **1-Click Reversal**: Reverse any posted manual journal (creates an immutable contra-journal linked via `reversesEntryId`).
  - **Recurring Journal Templates**: Configure monthly/quarterly recurring journals (e.g., depreciation, prepayments amortization).
- [x] **2.5 Module 2 Frontend UI**:
  - Dedicated **Chart of Accounts Page (`/accounts`)** grouped by classification (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`), showing live running balances, system lock badges, sub-account indentation, Create/Edit modals, Balance Sweep modal, and Tracking Dimensions manager.
  - Enhanced **General Ledger Page (`/ledger`)** with journal status tabs (`Posted`, `Pending Approval`, `Drafts`, `Recurring`), dimensional filtering, journal detail inspection, 1-click reversal, and multi-line Manual Journal composer with dimension tags.

---

### Module 3: Master Data — Contacts Directory & Products/Services Catalog (✅ COMPLETED)
**Objective:** Centralize customer/supplier master records (including Australian banking data for `.aba` payments) and establish a coded Products & Services catalog for rapid, error-free document entry.

- [x] **3.1 Enhanced Contacts Directory (`/contacts` & `/api/v1/contacts`)**:
  - Fields: `type` (`CUSTOMER`, `VENDOR`, `BOTH`), `name`, `legalName`, `abn` (ATO checksum validated), `email`, `phone`, `billingAddress`, `paymentTermsDays`, `requiresInvoiceForPayment`, `defaultRevenueAccountId`, `defaultExpenseAccountId`, `bankBsb`, `bankAccountNumber`, `bankAccountName`, `isActive`.
  - Contact 360 Detail Drawer/View: Shows contact summary, total outstanding AR/AP, aging breakdown, and chronological history of quotes, invoices, bills, credit notes, and payments.
- [x] **3.2 Products & Services Catalog (`/items` & `/api/v1/items`)**:
  - Fields: `code` (SKU/Item code), `name`, `isSold`, `saleDescription`, `saleUnitPriceCents`, `saleTaxTreatment`, `incomeAccountId`, `isPurchased`, `purchaseDescription`, `purchaseUnitPriceCents`, `purchaseTaxTreatment`, `expenseAccountId`, `isTrackedInventory` (reserved flag for future Inventory module), `isActive`.
  - Dedicated **Items & Services Page (`/items`)** with search, filter (`All`, `Sales Items`, `Purchase Items`), and Create/Edit modal with filtered GL account pickers.

---

### Module 4: Accounts Receivable (AR) — Quotes, Invoices, Credit Notes, Prepayments & Receipts
**Objective:** Complete end-to-end revenue lifecycle from client quote to invoice issuance, recurring billing, credit adjustments, customer prepayments, and revenue receipts.

- [x] **4.1 Quotes / Estimates (`/quotes` or AR Tab & `/api/v1/quotes`)**:
  - Lifecycle: `DRAFT` $\rightarrow$ `SENT` $\rightarrow$ `ACCEPTED` / `DECLINED` / `EXPIRED` $\rightarrow$ `INVOICED`.
  - Line items support Catalog Item auto-fill, Quantity, Unit Price (cents), Discount %, Tax Treatment, Revenue Account (`REVENUE` only), and Tracking Dimensions.
  - **1-Click Convert to Invoice**: Copies an accepted quote into a Draft or Issued Customer Invoice and links `quote.convertedInvoiceId`.
- [x] **4.2 Customer Invoices (`/invoices` & `/api/v1/invoices`)**:
  - Lifecycle: `DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `ISSUED` $\rightarrow$ `PARTIALLY_PAID` $\rightarrow$ `PAID` / `VOID`.
  - Full editing of `DRAFT` and `PENDING_APPROVAL` invoices.
  - **Dynamic GL Posting on Issuance**:
    - `DEBIT 1200 Accounts Receivable` (Total Cents)
    - `CREDIT <Line Item Revenue Account>` (Line Subtotal Cents, tagged with Tracking Dimensions)
    - `CREDIT 2100 GST Collected` (Total GST Cents)
  - **Voiding**: Voiding an unpaid issued invoice automatically posts a reversing journal entry.
  - **Commercial Print / Remittance View**: Clean printable invoice layout featuring Company Legal Name, ABN, Address, Line Items, GST Summary, and **Australian EFT Remittance Slip (Bank Name, BSB, Account Number)**.
- [x] **4.3 Recurring Invoice Schedules**:
  - Define frequency (`WEEKLY`, `MONTHLY`, `QUARTERLY`, `ANNUALLY`), start date, next run date, and auto-issue toggle.
- [x] **4.4 Customer Credit Notes (AR Adjustments)**:
  - Issue Credit Notes (`CRN-1001`) coded to specific `REVENUE` accounts + GST, posting the exact reverse of an invoice (`DEBIT Revenue`, `DEBIT 2100 GST Collected`, `CREDIT 1200 Accounts Receivable`).
  - Allocate open Credit Notes to reduce the balance due on open Customer Invoices, or record a cash refund out of a bank account.
- [x] **4.5 Payments In, Direct Income Receipts & Customer Prepayments**:
  - **Mode A — Invoice Settlement**: Apply incoming payment to one or more open Customer Invoices into any selected Bank/Asset account (`DEBIT Selected Bank Account`, `CREDIT 1200 Accounts Receivable`).
  - **Mode B — Direct Income Receipt ("Receive Money" without Invoice)**: When no invoice is used, code directly to a `REVENUE` account + GST (`DEBIT Selected Bank Account`, `CREDIT Revenue Account`, `CREDIT 2100 GST Collected`).
  - **Mode C — Customer Prepayment / Deposit on Account**: Record an unallocated customer deposit (`DEBIT Selected Bank Account`, `CREDIT 2300 Customer Prepayments`), which can later be applied to settle a newly issued invoice.
- [x] **4.6 AR Precision UX, Modal Scaling & Items / SKU Catalog Integration**:
  - **Framed Max-Width Viewport & Workbench Boundaries**:
    - Update the top workbench layout and pages (`AccountsPage`, `LedgerPage`, `ExpensesPage`, `InvoicesPage`, `BillsPage`, `ContactsPage`, `ItemsPage`, `DashboardPage`, `SettingsPage`) to adopt a unified framed max-width layout (`max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8`) with consistent outer gutters so buttons, tables, and tabs never collide with window boundaries.
  - **Responsive & Dynamic Modal System (`Modal.tsx`)**:
    - Enhance `Modal.tsx` with dynamic size presets (`sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl`, `5xl`, `6xl`, `full`) that scale intelligently on larger viewports (`max-w-xl md:max-w-2xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl`).
    - Expand multi-line transaction modals (Manual Journal Entry composer, Recurring Journal modal, Bill Creator, and Invoice Creator) to utilize generous, comfortable widths on wide monitors.
  - **Full-Featured Invoice Creation Workbench (`CreateInvoiceModal`)**:
    - **Catalog Item / SKU Autocomplete**: Select pre-built sales items from `/api/v1/items` (auto-fills SKU/Code, Description, Unit Price, Tax Treatment, and default Revenue Account).
    - **Multi-Quantity Calculation**: Support fractional/integer `quantity` * `unitPrice` ($ / cents) with real-time subtotal calculation.
    - **Free-Text & Ad-Hoc Overrides**: Allow custom non-catalog line items with free-text descriptions and arbitrary unit prices.
    - **Tracking Dimensions / Cost Centers**: Expose tracking dimension tags (`trackingOptionId`) per line item (Cost Center / Project / Department).
    - **Line-Level Revenue Account Picker**: Select specific `REVENUE` GL accounts per line item.
    - **Real-Time Australian GST Preview**: Calculate and preview subtotal, GST collected, and total cents across Tax Exclusive, Tax Inclusive, and GST Free treatments.
- [x] **4.7 Horizontal (Landscape A4) Tax Invoice Preview & Print Engine**:
  - **Commercial Landscape A4 Document Layout**:
    - Build a dedicated horizontal A4 print preview component for customer invoices formatted specifically for standard Australian business operations.
    - Organization Header: Legal Name, Trading Name, ABN, Address, Contact Email/Phone.
    - Invoice Identity & Compliance Status: "TAX INVOICE" header for issued invoices; clear "DRAFT — NOT A TAX INVOICE" compliance banner/watermark for draft invoices.
    - Customer "Bill To" card: Contact Name, ABN, and Billing Address.
    - Wide tabular line item schedule: Description/Item, Qty, Unit Price ($), Tax Treatment, Subtotal, GST (10%), and Line Total.
    - Australian EFT Remittance Advice: Bottom split featuring banking remittance slip (Bank BSB, Account Number, Account Name, Payment Reference) alongside the financial breakdown (Subtotal, GST, Total Invoiced, Paid to Date, and Balance Due).
  - **Interactive Preview Modal & Native Browser Print Engine**:
    - Accessible directly inside `InvoiceDetailModal` via a "Preview & Print (Landscape A4)" action.
    - Integrates standard CSS print stylesheet (`@page { size: A4 landscape; margin: 10mm; }`) and `@media print` rules to hide UI chrome and render clean, edge-to-edge landscape A4 output via `window.print()`.

---

### Module 5: Accounts Payable (AP) — Purchase Orders, Bills, Vendor Credits & `.ABA` Batch Payments
**Objective:** Complete procurement and payables lifecycle with Purchase Order approvals, coded Vendor Bills, Recurring Bills, Vendor Credit Notes, and Australian `.ABA` batch bank file exports.

- [x] **5.1 Purchase Orders (`/purchase-orders` or AP Tab & `/api/v1/purchase-orders`)**:
  - Lifecycle: `DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `APPROVED` / `REJECTED` $\rightarrow$ `BILLED` / `CANCELLED`.
  - `MANAGER`, `ACCOUNTANT`, and `ADMIN` can approve POs.
  - **1-Click Convert to Bill**: Converts an approved PO into a pre-filled Vendor Bill linked via `purchaseOrderId`.
- [x] **5.2 Vendor Bills (`/bills` & `/api/v1/bills`)**:
  - Lifecycle: `DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `AWAITING_PAYMENT` $\rightarrow$ `PARTIALLY_PAID` $\rightarrow$ `PAID` / `VOID`.
  - Strict account classification filtering: Line items can only be coded to `EXPENSE` or `ASSET` accounts (default `6000 Operating Expenses`) + Tracking Dimensions.
  - **Dynamic GL Posting on Approval**:
    - `DEBIT <Line Item Expense/Asset Account>` (Line Subtotal Cents, tagged with Tracking Dimensions)
    - `DEBIT 2200 GST Paid` (Total GST Cents)
    - `CREDIT 2000 Accounts Payable` (Total Cents)
  - Full editing in `DRAFT`/`PENDING_APPROVAL`; Voiding an unpaid bill posts a reversing GL entry.
- [x] **5.3 Recurring Bill Schedules**:
  - Schedule recurring supplier obligations (rent, leases, retainers).
- [x] **5.4 Vendor Credit Notes (AP Adjustments)**:
  - Record supplier credit notes (`DEBIT 2000 Accounts Payable`, `CREDIT Expense/Asset`, `CREDIT 2200 GST Paid`) and apply them to reduce open Vendor Bills.
- [x] **5.5 Payments Out & Australian `.ABA` Batch Payment Engine**:
  - **Single Payment Out**: Pay a bill from any selected Bank (`ASSET`) or Corporate Credit Card (`LIABILITY`) account (`DEBIT 2000 Accounts Payable`, `CREDIT Selected Bank/Card Account`).
  - **Batch Payment Run & `.ABA` File Generator (`/api/v1/batch-payments`)**:
    - Select multiple unpaid approved Bills (and/or approved Employee Expense Reimbursements).
    - Validate that the Organization and all selected payees have valid 6-digit Australian BSBs and Account Numbers.
    - Atomically record all constituent payments, update bill/claim statuses, post the consolidated GL entry, and generate a downloadable **APCA-compliant `.aba` (Cemtex) bank file** for 1-click upload to Australian business banking portals.
- [x] **5.6 AP Precision UX, Line Item Coding Parity, Modal Scaling & Horizontal (Landscape A4) Vendor Bill Preview Engine**:
  - **Comprehensive Bill Coding Section (`CreateBillModal`)**:
    - Item / SKU catalog selector from `/api/v1/items` (`isPurchased: true`) with auto-population of description, purchase unit price, tax rate, and expense account.
    - Multi-quantity lines with live unit price multiplication (`quantity * unitPrice`).
    - Account selector: Allows coding lines to specific `EXPENSE`, `COGS`, or `ASSET` accounts (default `6000 Operating Expenses`).
    - Cost Center / Tracking Dimension selector (`trackingOptionId`) for project/department attribution.
    - "Save as Draft" vs "Approve Immediately & Post to GL" toggle for `ADMIN`/`ACCOUNTANT` users.
    - Real-time Australian GST calculation preview (Subtotal, GST 10%, Total).
    - Upgraded modal size to responsive `size="5xl"`.
  - **Bill Detail & GL Coding Inspection (`BillDetailModal`)**:
    - Upgraded modal size to `size="5xl"`.
    - Tabular display of coded GL accounts and Cost Centers on each line item.
    - "Print Preview (A4)" action opening `BillPreviewModal`.
  - **Horizontal (Landscape A4) Vendor Bill & Remittance Preview (`BillPreviewModal`)**:
    - Commercial Landscape A4 preview sheet (`@page { size: A4 landscape; margin: 8mm; }`).
    - Complete supplier card (ABN, address, contact), purchaser card, line items schedule with GL account codes and cost centers, financial calculation summary, and vendor EFT remittance advice (BSB, Account Number from Contact profile).
    - Browser print / "Save as PDF" engine with print-isolated styles.
  - **Universal Modal Scaling & Parity Sweep**:
    - Expenses: Upgraded `RecordDirectSpendModal` and `CreateEditClaimModal` to `size="5xl"`, `ExpenseClaimDetailModal` and `CreateBatchModal` to `size="4xl"`.
    - Purchase Orders: Upgraded `CreatePOModal` to `size="5xl"` with Tracking Dimension support, `PODetailModal` to `size="4xl"`.
    - Vendor Credits: Upgraded `CreateVendorCreditModal` to `size="5xl"` with Item/Account/Tracking coding, `VendorCreditDetailModal` to `size="4xl"`.
    - Quotes & AR Credit Notes: Upgraded `CreateQuoteModal` and `CreateCreditNoteModal` to `size="5xl"` with Tracking Dimension support, detail modals to `size="4xl"`.
    - Legacy sizing cleanup: Replaced deprecated `maxWidth` props with standard `size` presets across all application modals.

---

### Module 6: Enterprise Expenses — Direct "Spend Money" & Employee Expense Claims
**Objective:** Provide a dedicated `/expenses` module handling both immediate corporate card/bank purchases and staff out-of-pocket expense claims with manager approval and `2050 Employee Reimbursements Payable` accounting.

- [x] **6.1 Direct "Spend Money" Transactions (Bank & Corporate Card Purchases)**:
  - For immediate purchases (fuel, software subscriptions, merchant receipts) paid via Bank Account or Corporate Credit Card without a prior AP Bill.
  - Multi-line coding to `EXPENSE` / `ASSET` accounts + Tracking Dimensions + GST treatment.
  - **Direct GL Posting**:
    - `DEBIT <Line Item Expense/Asset Account>` (Subtotal Cents + Dimensions)
    - `DEBIT 2200 GST Paid` (GST Cents)
    - `CREDIT <Selected Bank (ASSET) or Corporate Card (LIABILITY) Account>` (Total Cents)
- [x] **6.2 Employee Expense Claims & Approval Workflow**:
  - **Employee Self-Service Portal**: Users with the `EMPLOYEE` role (and all other internal roles) can create and submit multi-line out-of-pocket expense claims (date, merchant, description, amount, GST treatment, expense category/account, tracking dimension).
  - Lifecycle: `DRAFT` $\rightarrow$ `SUBMITTED` $\rightarrow$ `APPROVED` / `REJECTED` $\rightarrow$ `PAID`.
  - **Manager / Accountant Approval & GL Posting**:
    - When approved by a `MANAGER`, `ACCOUNTANT`, or `ADMIN`, the system posts to the General Ledger:
      - `DEBIT <Line Item Expense Account>` (Subtotal Cents + Dimensions)
      - `DEBIT 2200 GST Paid` (GST Cents)
      - `CREDIT 2050 Employee Reimbursements Payable` (Total Cents)
- [x] **6.3 Employee Reimbursement Payouts**:
  - Settle approved expense claims individually or include them in a **Batch Payment & `.ABA` File Run**:
    - `DEBIT 2050 Employee Reimbursements Payable` (Amount Paid)
    - `CREDIT <Selected Operating Bank Account>` (Amount Paid)
- [x] **6.4 Module 6 Frontend UI (`/expenses`)**:
  - Role-aware interface:
    - `EMPLOYEE` users see only **"My Expense Claims"** (Submit Claim, Pending Approval, Reimbursed History) and **"My Reimbursement Banking"**.
    - `MANAGER`, `ACCOUNTANT`, and `ADMIN` users see **"My Claims"**, **"Team Approvals Queue"**, **"Reimbursement Payouts"**, and **"Direct Spend Money (Card/Bank)"**.

---

### Module 7: Multi-Account Banking, Inter-Account Transfers & Statement Reconciliation
**Objective:** Manage all cash and credit card accounts, transfer money cleanly between accounts, and reconcile imported bank statements against the General Ledger.

- [x] **7.1 Bank & Credit Card Accounts Hub (`/banking`)**:
  - Overview of all GL accounts flagged as banking/card accounts (`1000 Operating Bank`, savings accounts, petty cash, corporate credit cards) showing Ledger Balance vs. Last Reconciled Balance.
- [x] **7.2 Inter-Account Money Transfers (`/api/v1/banking/transfers`)**:
  - Dedicated transfer workflow between any two Bank/Card accounts (e.g., Operating Bank $\rightarrow$ Savings Reserve, or Operating Bank $\rightarrow$ Paying off Corporate Credit Card).
  - Posts a clean 2-line journal entry (`DEBIT Destination Account`, `CREDIT Source Account`) with zero GST or P&L distortion.
- [x] **7.3 Bank Statement Import & Reconciliation Workspace (`/api/v1/banking/reconciliation`)**:
  - Upload CSV bank statement files (`Date`, `Description`, `Reference`, `Amount Cents`).
  - Smart Reconciliation Engine:
    - Auto-suggests matches against existing unreconciled Payments In, Payments Out, Batch Payments, Direct Spend/Receive Money, and Inter-Account Transfers by amount and date proximity.
    - Allows 1-click **"Match"** or on-the-fly **"Create & Reconcile"** (recording a Direct Spend/Receive Money or Transfer right from the reconciliation line).
    - Marks matched journal entries as `isReconciled: true` with `reconciledAt` timestamp.

---

### Module 8: Financial Statements, Australian BAS Engine, Live Dashboard & Plug-In Contract
**Objective:** Deliver real-time financial statements, ATO Business Activity Statement (BAS) reporting, a 100% live executive dashboard, and the standardized integration contract for custom client modules.

- [x] **8.1 Interactive Financial Statements (`/reports` & `/api/v1/reports/*`)**:
  - **Trial Balance**: As-of any date; verifies Total Debits == Total Credits across all accounts.
  - **Profit & Loss Statement (Income Statement)**: Custom date range (e.g., This Month, Last Quarter, Financial Year to Date), filterable by **Tracking Dimension** (e.g., P&L for a specific Department, Project, or Fleet Vehicle).
  - **Balance Sheet**: Point-in-time statement grouping Assets, Liabilities, and Equity (including dynamically calculated Current Year Unappropriated Earnings) proving $\text{Assets} == \text{Liabilities} + \text{Equity}$.
  - **Aged Receivables (AR) & Aged Payables (AP) Summary & Detail**: Bucketed into `Current`, `1–30 Days`, `31–60 Days`, `61–90 Days`, and `90+ Days Overdue`.
- [x] **8.2 Australian BAS (Business Activity Statement) Engine (`/reports/bas`)**:
  - Computes official ATO GST worksheet metrics for any selected monthly or quarterly tax period:
    - **G1**: Total Sales (Gross or Net revenue per org preference)
    - **G2 / G3**: GST-Free Sales
    - **G10 / G11**: Capital & Non-Capital Purchases
    - **1A**: GST on Sales (`2100 GST Collected` credits minus AR credit note reversals)
    - **1B**: GST on Purchases (`2200 GST Paid` debits minus AP credit note reversals)
    - **Net GST Payable / Refundable**: $1\text{A} - 1\text{B}$.
  - Includes a **"Lock BAS Period"** button that sets `organization.lockDate` to the end of the BAS quarter.
- [x] **8.3 Real-Time Executive Dashboard (`/`) — Zero-Mock Policy**:
  - Replaces all static `"—"` placeholders in `DashboardPage.tsx` with live PostgreSQL aggregations (`GET /api/v1/dashboard/summary`):
    - Cash Position across all bank/card accounts.
    - Outstanding AR (Total + Overdue count & amount).
    - Unpaid AP & Pending Employee Reimbursements (Total + Overdue count & amount).
    - Actionable **Pending Approvals Queue** counter (Draft Bills, POs, Expense Claims, and Journals awaiting approval).
    - Month-to-Date & Year-to-Date Revenue, Expenses, and Net Operating Profit.
    - Visual AR & AP Aging bars.
    - Live Recent Financial Activity & Audit feed.
- [x] **8.4 Enterprise Plug-In Module Contract (Future Custom Modules)**:
  - Documented extension interface allowing future client-specific modules to plug into the monolith without touching core tables:
    - **Fleet Management Module (`FLEET`)**: Links vehicles to `TrackingOption` records so fuel expenses, maintenance bills, and lease payments automatically roll up into per-vehicle P&L and cost-per-kilometer reports.
    - **Inventory & Warehouse Module (`INVENTORY`)**: Extends `Item` (`isTrackedInventory: true`) with stock ledger movements, Purchase Order goods receipts, and automated Cost of Goods Sold (COGS) journals on invoice issuance.
    - **Cloud Storage Document Attachments (`ATTACHMENTS`)**: GCS V4 presigned upload pipeline attaching PDFs/receipts to Bills, Expense Claims, Invoices, and Journals.
    - **Outbound Automation (`N8N_WEBHOOKS`)**: Asynchronous signed webhooks to n8n for external notifications and integrations.

---

### Module 9: Developer & Agent Context Interface (`/developer`) (✅ COMPLETED)
**Objective:** Provide an in-app, read-only Developer & Governance Console so administrators operating outside an IDE (e.g., Antigravity Agent Studio) can inspect agent context files, architecture specs, roadmaps, changelogs, and runtime diagnostics directly within the web application.

- [x] **9.1 Backend Documentation & Diagnostics API (`/api/v1/developer/*`)**:
  - RBAC-restricted to `ADMIN` (and gated by a `DEVELOPER_PORTAL` module flag or org admin permission).
  - `GET /api/v1/developer/docs`: Whitelisted directory index of repository documentation (`AGENTS.md`, `AGENT_SPECIFICATION.md`, `docs/*.md`), returning file metadata (path, title, last modified timestamp, size). Strictly no arbitrary filesystem traversal outside the allowlisted documentation paths.
  - `GET /api/v1/developer/docs/content?path=...`: Returns raw Markdown content for a whitelisted documentation file.
  - `GET /api/v1/developer/roadmap-summary`: Parses `docs/STAGES_ROADMAP.md` into structured module completion progress (completed vs. pending checklist counts per module).
  - `GET /api/v1/developer/api-catalog`: Deterministically parses `docs/ARCHITECTURE.md` into a structured, searchable API endpoint reference catalog grouped by service domain with HTTP verb, path, auth, RBAC scope, and side-effect metadata.
  - `GET /api/v1/developer/diagnostics`: Safe, non-secret runtime metadata (Node version, `NODE_ENV`, active `enabledModules`, database connectivity status, and sanitized feature flags—strictly redacting all secrets such as `DB_PASSWORD`, `SESSION_SECRET`, `WEBHOOK_SECRET`).
  - Ensure `Dockerfile` copies `AGENTS.md`, `AGENT_SPECIFICATION.md`, and `docs/` into the runtime image so the documentation endpoints work in Cloud Run.
- [x] **9.2 Module 9 Frontend UI (`/developer`)**:
  - **Context & Docs Viewer Tab**: Split-pane Markdown reader with file sidebar (`AGENTS.md`, `AGENT_SPECIFICATION.md`, `STAGES_ROADMAP.md`, `CHANGELOG.md`, `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `SECURITY.md`, `PLUGINS.md`, `DESIGN_SYSTEM.md`, `INTEGRATIONS.md`), full-text search, and clean rendered Markdown + raw view toggle.
  - **API Reference Tab**: Searchable, filterable API endpoint catalog (`GET`/`POST`/`PATCH`/`DELETE`, Public/`ADMIN` scope filters, domain collapsible groups, and 1-click path copy) powered by `GET /api/v1/developer/api-catalog`.
  - **Roadmap Tracker Tab**: Visual progress overview of all modules and checklist items parsed from `STAGES_ROADMAP.md`.
  - **Changelog & Audit Feed Tab**: Chronological release/changelog viewer paired with recent system audit log events.
  - **Runtime & Environment Diagnostics Tab**: Read-only view of safe runtime flags, database health, and enabled organization modules.

---

### Module 10: Corporate Precision UI/UX Alignment, Overlay Architecture, Expenses Remediation & A4 Report Print Engine (✅ COMPLETED)
**Objective:** Remediate UI/UX discrepancies, data-mapping bugs in `/expenses`, modal/drawer backdrop alignment, and `/reports` A4 print isolation to bring every screen into 100% compliance with `docs/DESIGN_SYSTEM.md`.

- [x] **10.1 Universal Overlay Portal Architecture & Top-of-Viewport Backdrop Fix (`Modal.tsx`, `Drawer.tsx`, `InvoicePreviewModal.tsx`, `BillPreviewModal.tsx`, `OnboardingModal.tsx`)**:
  - Render `Modal`, `Drawer`, `InvoicePreviewModal`, `BillPreviewModal`, and `OnboardingModal` into `document.body` via React `createPortal(..., document.body)` and enforce `!mt-0` on `fixed inset-0` overlay containers.
  - Eliminates the `24px` (`1.5rem`) top-of-screen gap caused by parent `.space-y-6` / `.space-y-5` sibling margin selectors and isolates all overlays from `<header className="z-40">` stacking contexts.
- [x] **10.2 Expenses Module Data Contract Alignment & `$NaN` Remediation (`ExpensesPage.tsx` & `client.ts`)**:
  - Align frontend TypeScript interfaces (`DirectTransaction`, `DirectTransactionLine`, `ExpenseClaim`, `ExpenseClaimItem`) in `frontend/src/api/client.ts` and property accessors in `frontend/src/pages/ExpensesPage.tsx` with backend Prisma responses (`subtotalCents`, `gstCents`, `totalCents`, `amountCents`, `notes`, `bankAccountCode`, `bankAccountName`, and `claim.employee`).
  - Fix `$NaN` rendering for GST and Total columns across Direct Bank Spend, My Expense Claims, Team Approvals Queue, Reimbursement Payouts, and inspection drawers for both GST-Inclusive (`TAX_INCLUSIVE`) and GST-Exclusive (`TAX_EXCLUSIVE`) entries.
  - Fix GST-Inclusive claim editing (`CreateEditClaimModal`) so `TAX_INCLUSIVE` lines pre-fill from gross `it.totalCents` rather than net `it.amountCents` (preventing 10% amount reduction on re-save).
  - Fix employee identity and EFT banking status mapping (`claim.employee.name`, `claim.employee.hasBankDetails`, `claim.employee.bankBsb`, `claim.employee.bankAccountNumber`) so valid staff banking details display accurately instead of showing false `"Missing Banking"` / `"No BSB"` warnings.
- [x] **10.3 Expenses Slide-Over Inspector GL Journal Integration (`ExpensesPage.tsx`)**:
  - Fetch single-record detail endpoints (`GET /api/v1/expense-claims/:id` and `GET /api/v1/direct-transactions/:id`) when opening `InspectClaimDrawer` and `InspectDirectTxnDrawer` so the complete Double-Entry GL debit/credit journal impact table renders inside the drawer.
- [x] **10.4 Financial Reports A4 Print Engine & Chrome Isolation (`ReportsPage.tsx`, `AppShell.tsx`, `index.css`)**:
  - Implement dedicated `@media print` and `@page { size: A4; margin: 10mm; }` stylesheet rules isolating `#report-print-sheet` so printing from `/reports` outputs only the formatted A4 financial statement or BAS worksheet.
  - Suppress all webpage chrome (`AppShell.tsx` top navigation header and bottom status footer, page title bar, report navigation tabs, filter toolbars, and `.no-print` controls) during print.
  - Reset viewport scroll-lock containers (`h-screen`, `overflow-hidden`, `overflow-y-auto` on `AppShell` and `<main>`) in `@media print` so multi-page Trial Balance, Profit & Loss, Balance Sheet, Aged AR/AP, and BAS reports paginate cleanly across A4 sheets without clipping.
- [x] **10.5 Removal of Internal Meta-Tags & Footer Architecture Jargon (`ExpensesPage.tsx`, `ContactsPage.tsx`, `ItemsPage.tsx`, `ReportsPage.tsx`, `AppShell.tsx`)**:
  - Remove `<StatusTag>MODULE 06</StatusTag>` from `ExpensesPage.tsx`.
  - Remove non-user-facing `<StatusTag label="Master Data" />` badges from `ContactsPage.tsx` and `ItemsPage.tsx`, and the `Double-Entry Certified` badge from `ReportsPage.tsx`.
  - Streamline the `AppShell.tsx` footer by removing internal developer/infrastructure labels (`Cloud SQL (Unix Socket)`, `Deterministic Ledger Engine`, `Zero-LLM Runtime`, `ATO Mod-89`, and stale hardcoded version strings) in favor of clean entity, ABN, and workspace status details.
- [x] **10.6 Corporate Precision Geometry, Hairline Borders & Surface Standardization (`DashboardPage.tsx`, `InvoicesPage.tsx`, `BillsPage.tsx`, `AccountsPage.tsx`, `ExpensesPage.tsx`, `BankingPage.tsx`)**:
  - Replace legacy `rounded-xl`, `rounded-2xl`, `rounded-lg`, and `shadow-sm` card/table wrappers with crisp `rounded-md` (`6px`) `border border-slate-200 bg-white` flat surfaces per `docs/DESIGN_SYSTEM.md`.
  - Remove banned decorative pastel icon boxes (`w-10 h-10 rounded-xl bg-blue-50` / `bg-forest-50` / `bg-amber-50` / `bg-emerald-50`) on `DashboardPage.tsx` and adopt flat hairline metric strips.
  - Convert `rounded-full` pill tab counters across `InvoicesPage.tsx`, `BillsPage.tsx`, `ExpensesPage.tsx`, and `BankingPage.tsx` to squared `rounded` (`4px`) `font-mono` counter badges.
- [x] **10.7 Workbench Viewport Padding Deduplication (`DashboardPage.tsx` & `ReportsPage.tsx`)**:
  - Remove redundant outer `<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">` and `<div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8">` wrappers in `DashboardPage.tsx` and `ReportsPage.tsx` so all pages share the single `<main>` container gutter from `AppShell.tsx`.
- [x] **10.8 Page Header Typography & Sub-Navigation Tab Bar Unification (All Pages)**:
  - Standardize all page headers to `Inter` (`font-sans`) `text-xl font-medium tracking-tight text-slate-900` (replacing `font-mono uppercase font-bold` on `ReportsPage.tsx` and decorative header icon boxes on `BankingPage.tsx`).
  - Unify horizontal sub-navigation tab bar active indicators across all modules to `border-b-2 border-forest-900 text-forest-900 font-medium`.

---

### Module 11: Transactional Integrity, Bidirectional Sub-Ledger/GL Synchronization & Full Record Lifecycle Control (Edit / Void / Delete) (✅ COMPLETED)
**Objective:** Ensure 100% bidirectional consistency between the General Ledger (`/ledger`) and all sub-ledger modules (`/bills`, `/invoices`, `/expenses`, `/banking`), prevent double-reversal ledger corruption, and empower `ADMIN` / `ACCOUNTANT` users with complete Edit & Re-Post, Revert-to-Draft, Void, Payment Reversal, and Force-Delete lifecycle controls gated by the Accounting Period Lock Date.

- [x] **11.1 General Ledger Reversal Math, Anti-Double-Reversal Guard & Admin Force-Delete (`ledger-posting.ts`, `ledger.ts`, `LedgerPage.tsx`)**:
  - Mark both the original journal (`JNL-xxxx`) and the contra-reversal journal (`REV-xxxx`) as `status: JournalStatus.REVERSED` (mutually linked via `reversedById` and `reversesEntryId`) so both entries remain permanently in the GL audit trail with offsetting lines while netting to `$0.00` in `POSTED` Trial Balance, P&L, and Balance Sheet aggregations.
  - Strictly block "reversing a reversal": reject `reverseJournalEntry` when `original.reversesEntryId !== null`, `original.reversedById !== null`, `original.status !== 'POSTED'`, or `original.referenceType === 'MANUAL_REVERSAL'`, and hide the Reverse button in `LedgerPage.tsx` on contra-entries.
  - Automatically un-match any linked `BankStatementLine` reconciliation when a journal is reversed or deleted.
  - Allow `ADMIN` Force-Delete (`DELETE /api/v1/ledger/:id`) on unreconciled journals with an immutable `AuditLog` tombstone.
- [x] **11.2 Bidirectional Sub-Ledger $\leftrightarrow$ General Ledger Cascade Synchronization (`ledger-posting.ts`)**:
  - When a sub-ledger journal is reversed in `/ledger`, atomically cascade the reversal to the source sub-ledger record inside the same `prisma.$transaction(...)`:
    - `BILL` $\rightarrow$ marks `Bill` as `VOID` (rejects if `amountPaidCents > 0n`).
    - `INVOICE` $\rightarrow$ marks `Invoice` as `VOID` (rejects if `amountPaidCents > 0n`).
    - `PAYMENT_OUT` $\rightarrow$ deletes `PaymentOut` and recalculates parent `Bill.amountPaidCents` & status (`AWAITING_PAYMENT` / `PARTIALLY_PAID`).
    - `PAYMENT_IN` $\rightarrow$ deletes `PaymentIn` and recalculates parent `Invoice.amountPaidCents` & status (`ISSUED` / `PARTIALLY_PAID`).
    - `CREDIT_NOTE` / `VENDOR_CREDIT` $\rightarrow$ marks Credit Note / Vendor Credit as `VOID` (rejects if `amountAppliedCents > 0n`).
    - `EXPENSE_CLAIM` $\rightarrow$ reverts unpaid `APPROVED` `ExpenseClaim` to `DRAFT` (or if `EXPENSE_REIMBURSEMENT`, reverses payout and restores claim to `APPROVED`).
    - `DIRECT_TRANSACTION` $\rightarrow$ deletes `DirectTransaction` (`Spend Money` / `Receive Money`).
    - `BANK_TRANSFER` $\rightarrow$ deletes `BankTransfer`.
- [x] **11.3 Accounts Payable (`bills.ts`, `vendor-credits.ts`, `purchase-orders.ts`, `BillsPage.tsx`) — Edit & Re-Post, Revert to Draft, Void, Payment Reversal & Admin Delete**:
  - `PATCH /api/v1/bills/:id`: Allow editing `DRAFT`, `PENDING_APPROVAL`, and unpaid `AWAITING_PAYMENT` bills (`amountPaidCents === 0n`), atomically updating `BillLineItem` records (`quantity`, `unitPriceCents`, `accountId`, `trackingOptionId`) and synchronizing the active `BILL` `JournalEntry` lines in place.
  - `POST /api/v1/bills/:id/approve`: Allow approving both `DRAFT` and `PENDING_APPROVAL` bills while preserving line-level `accountId` and `trackingOptionId` in the GL posting.
  - `POST /api/v1/bills/:id/revert-to-draft`: Revert an unpaid `AWAITING_PAYMENT` or `PENDING_APPROVAL` bill to `DRAFT` and reverse/remove its active GL journal.
  - `DELETE /api/v1/bills/:id/payments/:paymentId`: Reverse a recorded `PaymentOut`, reverse its `PAYMENT_OUT` GL journal, and restore the `Bill` balance and status.
  - `DELETE /api/v1/bills/:id`: Allow deleting `DRAFT`/`PENDING_APPROVAL` bills and `ADMIN` Force-Delete on unpaid/void bills.
  - `POST /api/v1/vendor-credits/:id/void` & `DELETE /api/v1/vendor-credits/:id`: Void or delete unallocated vendor credits with GL journal reversal.
  - Surface **Edit Bill**, **Approve & Post**, **Revert to Draft**, **Void Bill**, **Delete**, and **Reverse Payment** actions in `BillsPage.tsx`.
- [x] **11.4 Accounts Receivable (`invoices.ts`, `credit-notes.ts`, `quotes.ts`, `InvoicesPage.tsx`) — Edit & Re-Post, Revert to Draft, Void, Payment Reversal & Admin Delete**:
  - `PATCH /api/v1/invoices/:id`: Allow editing `DRAFT`, `PENDING_APPROVAL`, and unpaid `ISSUED` invoices (`amountPaidCents === 0n`), atomically updating `InvoiceLineItem` records and synchronizing the active `INVOICE` `JournalEntry` lines in place.
  - `POST /api/v1/invoices/:id/revert-to-draft`: Revert an unpaid `ISSUED` or `PENDING_APPROVAL` invoice to `DRAFT` and reverse/remove its active GL journal.
  - `POST /api/v1/invoices/:id/void`: Standardize voiding through `reverseJournalEntry` so original and contra journals are marked `REVERSED`.
  - `DELETE /api/v1/invoices/:id/payments/:paymentId`: Reverse a recorded `PaymentIn`, reverse its `PAYMENT_IN` GL journal, and restore the `Invoice` balance and status.
  - `DELETE /api/v1/invoices/:id`: Allow deleting `DRAFT`/`PENDING_APPROVAL` invoices and `ADMIN` Force-Delete on unpaid/void invoices.
  - `POST /api/v1/credit-notes/:id/void` & `DELETE /api/v1/credit-notes/:id`: Void or delete unallocated customer credit notes with GL journal reversal.
  - Surface **Edit Invoice**, **Revert to Draft**, **Void Invoice**, **Delete**, and **Reverse Receipt** actions in `InvoicesPage.tsx`.
- [x] **11.5 Enterprise Expenses & Direct Transactions (`expense-claims.ts`, `direct-transactions.ts`, `ExpensesPage.tsx`) — Edit, Void/Unapprove, Payout Reversal & Delete**:
  - `POST /api/v1/expense-claims/:id/void`: Unapprove/void an `APPROVED` (unpaid) claim back to `DRAFT` and reverse its `EXPENSE_CLAIM` GL journal.
  - `POST /api/v1/expense-claims/:id/reverse-payment`: Reverse a paid reimbursement (`EXPENSE_REIMBURSEMENT` GL journal) and restore the claim to `APPROVED`.
  - `PATCH /api/v1/expense-claims/:id` & `DELETE /api/v1/expense-claims/:id`: Allow `ADMIN`/`ACCOUNTANT` to edit unpaid `APPROVED` claims (synchronizing the `2050` GL journal) and allow `ADMIN` Force-Delete on unpaid claims.
  - `PATCH /api/v1/direct-transactions/:id` & `DELETE /api/v1/direct-transactions/:id`: Allow `ADMIN`/`ACCOUNTANT` to edit or void/delete a `DirectTransaction` (`Spend Money` / `Receive Money`) and synchronize/reverse its GL journal.
  - Surface **Edit**, **Revert to Draft / Void**, **Reverse Payout**, and **Delete** controls in `ExpensesPage.tsx`.
- [x] **11.6 Banking Transfers & Master Data Lifecycle Controls (`banking.ts`, `contacts.ts`, `BankingPage.tsx`, `ContactsPage.tsx`)**:
  - `DELETE /api/v1/banking/transfers/:id`: Allow `ADMIN`/`ACCOUNTANT` to reverse/delete an inter-account `BankTransfer` and its linked `BANK_TRANSFER` GL journal.
  - `DELETE /api/v1/contacts/:id`: Allow `ADMIN` to delete contacts with no linked transactions (or deactivate contacts with historical activity).

---

### Module 12: Centralized Admin Bulk CSV Import Engine, Context-Aware Bank Statement Upload & Multi-Mode Contact-Linked Reconciliation (✅ COMPLETED)
**Objective:** Provide `ADMIN` users with a centralized, two-step **Validate & Preview $\rightarrow$ Commit** Bulk CSV Import Hub supporting all 13 core master and transactional record types; upgrade Bank Statement CSV imports to accept optional context columns (`Supplier/Merchant/Contact`, `Account Code/Name`, `Cost Centre/Tracking Option`, `Tax Treatment`) validated strictly against existing records; and upgrade Bank Reconciliation so every reconciled line explicitly specifies its transaction mode (`DIRECT_EXPENSE` / `DIRECT_INCOME`, `ALLOCATE_BILL` / `CREATE_AND_PAY_BILL`, or `ALLOCATE_INVOICE` / `CREATE_AND_PAY_INVOICE`) and links cleanly to a `Contact` record and Contact 360° activity feed.

- [x] **12.1 Schema Extensions for Context-Aware Statement Lines (`schema.prisma` & `schema-sync.ts`)**:
  - Extend `BankStatementLine` with optional pre-validated coding references populated during CSV statement import when optional columns are supplied:
    - `suggestedContactId` (`String?`, FK to `Contact`)
    - `suggestedAccountId` (`String?`, FK to `Account`)
    - `suggestedTrackingOptionId` (`String?`, FK to `TrackingOption`)
    - `suggestedTaxTreatment` (`TaxTreatment?`)
  - Synchronize schema changes idempotently in `backend/src/lib/schema-sync.ts` and `backend/prisma/migrations/rebuild_all_schema.sql`.
- [x] **12.2 Context-Aware Bank Statement CSV Upload with Two-Step Validate & Preview (`banking.ts` & `BankingPage.tsx`)**:
  - Expand `parseStatementCsv` in `backend/src/routes/banking.ts` to recognize optional CSV columns alongside standard Date/Description/Reference/Amount/Debit/Credit headers:
    - **Supplier / Merchant / Contact** (`contact`, `merchant`, `supplier`, `payee`, `customer`, `vendor`)
    - **GL Account** (`account`, `account_code`, `gl_account`, `account_name`)
    - **Cost Centre / Tracking Option** (`cost_centre`, `cost_center`, `tracking`, `department`, `project`)
    - **Tax Treatment** (`tax`, `tax_treatment`, `gst`, `tax_code`)
  - **Strict Validation Rule for Optional Columns:** Any optional column left blank is ignored (optional). However, when a non-empty value is provided for Contact, Account, or Cost Centre, it MUST strictly match an existing record in the organization's database (case-insensitive exact match on Contact `name`, Account `code` or `name`, and TrackingOption `name`).
  - **Two-Step Validate & Preview Flow (`POST /api/v1/banking/statements/import`):**
    - Support `dryRun: true` (Step 1: Validate & Preview) returning parsed rows with validation status (`VALID` in green with resolved `Contact`, `Account`, and `TrackingOption` badges, or `INVALID` in red with exact column mismatch reasons).
    - Step 2 (Commit): Allows the user in `BankingPage.tsx` to either fix and re-upload the CSV or commit all valid rows, persisting `suggestedContactId`, `suggestedAccountId`, `suggestedTrackingOptionId`, and `suggestedTaxTreatment` onto each created `BankStatementLine`.
- [x] **12.3 Multi-Mode Contact-Linked Bank Reconciliation (`banking.ts`, `contacts.ts`, `BankingPage.tsx`)**:
  - Upgrade the Split-Pane Reconciliation Workbench (`BankingPage.tsx`) and `POST /api/v1/banking/reconciliation/create-and-reconcile` so that when reconciling a bank statement line, the user explicitly selects the **Transaction Mode** based on cash direction:
    - **For Outflows / Withdrawals (`amountCents < 0`):**
      1. **Direct Expense (`DIRECT_EXPENSE`):** Creates a full `DirectTransaction` (`type: 'SPEND_MONEY'`) linked to the selected `contactId` (and `payeeName`), posts the balanced GL `JournalEntry` (`referenceType: 'DIRECT_TRANSACTION'`, `referenceId: directTx.id`, `isReconciled: true`), and links `BankStatementLine.matchedJournalId`. Appears immediately in `/expenses` and Contact 360°.
      2. **Pay Existing Vendor Bill (`ALLOCATE_BILL`):** Selects an open/partially-paid `Bill` (`AWAITING_PAYMENT` / `PARTIALLY_PAID`), records a `PaymentOut` for the statement line amount, updates `Bill.amountPaidCents` and status (`PAID` / `PARTIALLY_PAID`), posts the `PAYMENT_OUT` GL journal (`DR 2000 Accounts Payable`, `CR Bank`), and reconciles the statement line.
      3. **Create & Pay New Vendor Bill (`CREATE_AND_PAY_BILL`):** Atomically creates an approved `Bill` for the selected Supplier `contactId` (posting `DR Expense` / `DR 2200 GST Paid` / `CR 2000 AP`), immediately records the settling `PaymentOut` (`DR 2000 AP` / `CR Bank`), and reconciles the statement line against the payment journal.
    - **For Inflows / Deposits (`amountCents > 0`):**
      1. **Direct Income (`DIRECT_INCOME`):** Creates a full `DirectTransaction` (`type: 'RECEIVE_MONEY'`) linked to the selected `contactId`, posts the balanced GL `JournalEntry` (`referenceType: 'DIRECT_TRANSACTION'`, `referenceId: directTx.id`, `isReconciled: true`), and reconciles the statement line.
      2. **Receive Against Existing Customer Invoice (`ALLOCATE_INVOICE`):** Selects an open `Invoice` (`ISSUED` / `PARTIALLY_PAID`), records a `PaymentIn` for the statement line amount, updates `Invoice.amountPaidCents` and status (`PAID` / `PARTIALLY_PAID`), posts the `PAYMENT_IN` GL journal (`DR Bank`, `CR 1200 Accounts Receivable`), and reconciles the statement line.
      3. **Create & Settle New Customer Invoice (`CREATE_AND_PAY_INVOICE`):** Atomically creates an issued `Invoice` for the selected Customer `contactId` (posting `DR 1200 AR` / `CR Revenue` / `CR 2100 GST Collected`), immediately records the settling `PaymentIn` (`DR Bank` / `CR 1200 AR`), and reconciles the statement line against the receipt journal.
  - **Pre-Fill from Statement Hints & Contact Defaults:** When clicking a statement line in `BankingPage.tsx`, automatically pre-populate the Contact, GL Account, Cost Centre, and Tax Treatment from `suggestedContactId`, `suggestedAccountId` (or the Contact's `defaultExpenseAccountId` / `defaultRevenueAccountId` if no account column was in the CSV), `suggestedTrackingOptionId`, and `suggestedTaxTreatment`.
  - **Contact 360° Direct Transaction Integration (`GET /api/v1/contacts/:id/360`):** Include `DirectTransaction` (`SPEND_MONEY` and `RECEIVE_MONEY`) records in the Contact 360° chronological activity feed and lifetime spend/revenue summary metrics in `backend/src/routes/contacts.ts` and `frontend/src/pages/ContactsPage.tsx`.
- [x] **12.4 Centralized Admin Bulk CSV Import Engine — Backend API (`backend/src/routes/bulk-import.ts`)**:
  - RBAC-restricted to `ADMIN` (`requireRole('ADMIN')`).
  - **Supported 13 Record Types (`entityType`):**
    1. `CONTACTS` — Customers, Suppliers/Vendors, and Dual contacts (with optional ABN, payment terms, BSB/Account, default GL accounts).
    2. `ITEMS` — Products & Services catalog (with code, name, sales/purchase unit prices, default revenue/expense account codes, tax treatments).
    3. `ACCOUNTS` — Chart of Accounts (code, name, type, normal balance, parent account code, default tax treatment, bank details).
    4. `TRACKING_OPTIONS` — Cost Centres & Tracking Categories (`category_name`, `option_name`).
    5. `INVOICES` — Customer Tax Invoices (grouped into multi-line documents by `invoice_number`, with optional `status`: `DRAFT` default or `ISSUED` to auto-post to GL).
    6. `QUOTES` — Customer Quotes / Estimates (grouped by `quote_number`, with optional `status`: `DRAFT` or `SENT` / `ACCEPTED`).
    7. `CREDIT_NOTES` — Customer AR Credit Notes (grouped by `credit_note_number`, with optional `status`: `DRAFT` or `ISSUED` to auto-post contra-AR GL).
    8. `BILLS` — Vendor Bills (grouped into multi-line documents by `bill_reference` / `bill_number`, with optional `status`: `DRAFT` default or `AWAITING_PAYMENT` to auto-post to GL).
    9. `PURCHASE_ORDERS` — Vendor Purchase Orders (grouped by `po_number`, with optional `status`: `DRAFT` or `APPROVED`).
    10. `VENDOR_CREDITS` — Vendor AP Credits (grouped by `vendor_credit_number`, with optional `status`: `DRAFT` or `ISSUED` to auto-post contra-AP GL).
    11. `DIRECT_TRANSACTIONS` — Direct Spend Money & Receive Money transactions (grouped by `reference` or per-row, linked to `bank_account_code`, optional `contact_name`, `account_code`, `cost_centre`, `tax_treatment`, auto-posting to GL).
    12. `EXPENSE_CLAIMS` — Employee Expense Claims (grouped by `claim_title` + `employee_email`, with optional `status`: `DRAFT` or `APPROVED` to auto-post to `2050 Employee Reimbursements Payable`).
    13. `JOURNAL_ENTRIES` — Manual General Ledger Journals (grouped by `entry_number` / `reference`, validating $\sum \text{Debits} == \sum \text{Credits}$, with optional `status`: `DRAFT` or `POSTED`).
  - **Endpoints:**
    - `GET /api/v1/bulk-import/templates`: Returns metadata, column specifications (required vs. optional fields, accepted values, defaults), and downloadable sample CSV templates for all supported record types.
    - `POST /api/v1/bulk-import/validate`: Parses uploaded CSV for the selected `entityType`, groups multi-line documents by reference number, validates all foreign keys (strictly matching existing Contact names, Account codes/names, Item codes, Tracking Option names, and Lock Dates), and returns a structured row/document preview (`VALID` vs. `INVALID` with field-level error diagnostics) without mutating the database.
    - `POST /api/v1/bulk-import/commit`: Atomically commits all validated records/documents inside a Prisma transaction, executing full `LedgerPostingService` GL postings for any documents flagged as `ISSUED` / `AWAITING_PAYMENT` / `APPROVED` / `POSTED` and recording an immutable `AuditLog` summary.
- [x] **12.5 Centralized Admin Bulk CSV Import Hub UI (`SettingsPage.tsx` / Dedicated Admin Tab)**:
  - Add a dedicated **"Bulk CSV Import"** workbench tab inside Workspace Settings (`/settings`) exclusively for `ADMIN` users:
    - **Record Type Selector Grid:** Choose from the supported master and transactional record types with clear schema rules (showing required fields vs. optional fields and multi-line grouping key).
    - **1-Click Template Download:** Download a clean, pre-formatted `.csv` template with example rows for the chosen record type.
    - **Step 1 — Upload & Validate Preview Table:** Drag-and-drop or select a `.csv` file to run `POST /api/v1/bulk-import/validate`. Renders an interactive Corporate Precision preview table showing:
      - Summary counters (`Total Rows/Documents`, `Valid & Ready` in green, `Validation Errors` in red).
      - Resolved entity badges (matched Contact, GL Account, Cost Centre, Tax Treatment, and calculated AUD cent totals).
      - Exact row/column error messages for any unrecognized Contact, Account, Cost Centre, unbalanced journal, or lock-date violation.
    - **Step 2 — Commit Valid Records:** Action buttons to either **Re-Upload Corrected CSV** or **Commit Valid Records ($N$)** via `POST /api/v1/bulk-import/commit`, displaying a completion receipt with links to inspect the newly imported records.

---

### Module 13: Prisma-Native Schema Self-Healing & Interactive Developer Database Management Workbench (✅ COMPLETED)
**Objective:** Retire legacy raw-SQL rebuild scripts (`rebuild_all_schema.sql`, raw DDL statements in `schema-sync.ts`) and mandatory database-reset environment variables (`AUTO_SCHEMA_PUSH`, `DB_FORCE_RESET`) in favor of automatic Prisma-native schema self-healing (`prisma db push --skip-generate --accept-data-loss` + system GL account seeding); and build an interactive, dependency-aware **Database & Table Manager** inside the `/developer` console (`ADMIN` only) supporting both Organization-scoped and Global database table purges while permanently protecting user identities and workspace memberships.

- [x] **13.1 Prisma-Native Schema Self-Healing & Retirement of Raw SQL / Reset Env Vars (`prisma.ts`, `schema-sync.ts`, `Dockerfile`, `AGENTS.md`, `docs/ARCHITECTURE.md`)**:
  - Remove mandatory `AUTO_SCHEMA_PUSH` and `DB_FORCE_RESET` startup validation checks from `backend/src/plugins/prisma.ts`, `AGENTS.md`, and `docs/ARCHITECTURE.md` so container startup never fails due to missing reset flags.
  - Ensure `backend/prisma/schema.prisma` is the single canonical source of truth: on container startup, `prisma.ts` automatically runs `npx prisma db push --skip-generate --accept-data-loss` to self-heal tables, columns, enums, and indexes, followed by `verifyAllOrganizationSystemAccounts(prisma)` to verify the 10 protected system GL accounts (`1000`–`6000`).
  - Delete `backend/prisma/migrations/rebuild_all_schema.sql` and replace the 500+ lines of raw `ALTER TABLE` / `CREATE TABLE` SQL in `backend/src/lib/schema-sync.ts` with a clean Prisma schema-sync & system-account verifier callable both at boot and on-demand via API.
- [x] **13.2 Backend Developer Database Inspection, On-Demand Schema Sync & Selective Table Purge API (`backend/src/routes/developer.ts`)**:
  - RBAC-restricted to `ADMIN` (`requireRole('ADMIN')`).
  - `GET /api/v1/developer/database/tables`: Returns live row counts for all clearable ERP PostgreSQL tables across both scopes (`orgRowCount` for the active `organizationId` and `globalRowCount` across the entire database), grouped by domain (`AP`, `AR`, `EXPENSES`, `BANKING`, `GL`, `MASTER_DATA`, `AUDIT`) along with explicit parent/child dependency metadata and a list of permanently protected identity tables (`users`, `organizations`, `organization_members`, `organization_invites`).
  - `POST /api/v1/developer/database/sync-schema`: Triggers an on-demand Prisma schema self-heal (`npx prisma db push --skip-generate --accept-data-loss`) and re-seeds any missing protected system GL accounts (`1000`–`6000`), returning execution status, duration, and output logs.
  - `POST /api/v1/developer/database/purge-tables`: Accepts `{ scope: 'ORGANIZATION' | 'GLOBAL', tables: string[] }`:
    - **Hard Identity Guard:** Rejects or strips any attempt to target `users`, `organizations`, `organization_members`, or `organization_invites` so logins and workspace memberships are never affected.
    - **System Account Guard:** When `accounts` is selected, deletes only custom non-system accounts (`isSystem: false`), preserving the 10 protected system GL accounts (`1000`–`6000`).
    - **Safe Relational Unlinking & Cascade Ordering:** Executes inside an atomic Prisma transaction in strict child-to-parent topological order. Automatically unlinks foreign keys where needed (e.g., if `journal_entries` is wiped while `bank_statement_lines` is kept, resets `bank_statement_lines.is_reconciled = false` and `matched_journal_id = null`; if `bills` is wiped while `purchase_orders` is kept, unlinks `bills.purchase_order_id`).
    - Writes an immutable `AuditLog` event (`action: 'DATABASE_TABLE_PURGE'`) unless `audit_logs` itself was selected for purge after execution.
- [x] **13.3 Interactive Database & Table Manager UI in Developer Console (`frontend/src/pages/DeveloperPage.tsx` & `frontend/src/api/client.ts`)**:
  - Add a dedicated **Database & Table Manager** tab in `/developer` (`DeveloperPage.tsx`):
    - **Prisma Schema Self-Heal Card:** Displays schema sync status and a 1-click **"Run Prisma Schema Self-Heal & Verify System Accounts"** button.
    - **Purge Scope Toggle:** Switch between **Active Organization Only** (`where: { organizationId }`) and **Whole Database (All Organizations)** (`GLOBAL`), with a prominent badge confirming `users`, `organizations`, and `organization_members` are permanently protected.
    - **1-Click Selection Presets:**
      - *Select All Transactional & Log Tables (Keep Contacts, Items & CoA)*
      - *Select AP, Expenses & Journals Only*
      - *Select All Clearable Tables*
      - *Clear Selection*
    - **Dependency-Aware Table Grid:** Checkboxes for every table showing live `Org Rows` and `Total DB Rows`. Selecting a parent table (e.g., `bills`, `invoices`, `journal_entries`, `direct_transactions`, `expense_claims`, `contacts`) automatically selects required child/line tables and displays clear dependency notices.
    - **Confirmation Modal & Execution Receipt:** Requires explicit confirmation before executing the purge, then displays per-table deleted row counts and refreshes live diagnostics.
