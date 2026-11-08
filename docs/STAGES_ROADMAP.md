# Master Architecture & 8-Module Deep-Build Roadmap

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

## 5. The 8-Module Deep-Build Execution Plan

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

### Module 3: Master Data — Contacts Directory & Products/Services Catalog
**Objective:** Centralize customer/supplier master records (including Australian banking data for `.aba` payments) and establish a coded Products & Services catalog for rapid, error-free document entry.

- [ ] **3.1 Enhanced Contacts Directory (`/contacts` & `/api/v1/contacts`)**:
  - Fields: `type` (`CUSTOMER`, `VENDOR`, `BOTH`), `name`, `legalName`, `abn` (ATO checksum validated), `email`, `phone`, `billingAddress`, `paymentTermsDays`, `requiresInvoiceForPayment`, `defaultRevenueAccountId`, `defaultExpenseAccountId`, `bankBsb`, `bankAccountNumber`, `bankAccountName`, `isActive`.
  - Contact 360 Detail Drawer/View: Shows contact summary, total outstanding AR/AP, aging breakdown, and chronological history of quotes, invoices, bills, credit notes, and payments.
- [ ] **3.2 Products & Services Catalog (`/items` & `/api/v1/items`)**:
  - Fields: `code` (SKU/Item code), `name`, `isSold`, `saleDescription`, `saleUnitPriceCents`, `saleTaxTreatment`, `incomeAccountId`, `isPurchased`, `purchaseDescription`, `purchaseUnitPriceCents`, `purchaseTaxTreatment`, `expenseAccountId`, `isTrackedInventory` (reserved flag for future Inventory module), `isActive`.
  - Dedicated **Items & Services Page (`/items`)** with search, filter (`All`, `Sales Items`, `Purchase Items`), and Create/Edit modal with filtered GL account pickers.

---

### Module 4: Accounts Receivable (AR) — Quotes, Invoices, Credit Notes, Prepayments & Receipts
**Objective:** Complete end-to-end revenue lifecycle from client quote to invoice issuance, recurring billing, credit adjustments, customer prepayments, and revenue receipts.

- [ ] **4.1 Quotes / Estimates (`/quotes` or AR Tab & `/api/v1/quotes`)**:
  - Lifecycle: `DRAFT` $\rightarrow$ `SENT` $\rightarrow$ `ACCEPTED` / `DECLINED` / `EXPIRED` $\rightarrow$ `INVOICED`.
  - Line items support Catalog Item auto-fill, Quantity, Unit Price (cents), Discount %, Tax Treatment, Revenue Account (`REVENUE` only), and Tracking Dimensions.
  - **1-Click Convert to Invoice**: Copies an accepted quote into a Draft or Issued Customer Invoice and links `quote.convertedInvoiceId`.
- [ ] **4.2 Customer Invoices (`/invoices` & `/api/v1/invoices`)**:
  - Lifecycle: `DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `ISSUED` $\rightarrow$ `PARTIALLY_PAID` $\rightarrow$ `PAID` / `VOID`.
  - Full editing of `DRAFT` and `PENDING_APPROVAL` invoices.
  - **Dynamic GL Posting on Issuance**:
    - `DEBIT 1200 Accounts Receivable` (Total Cents)
    - `CREDIT <Line Item Revenue Account>` (Line Subtotal Cents, tagged with Tracking Dimensions)
    - `CREDIT 2100 GST Collected` (Total GST Cents)
  - **Voiding**: Voiding an unpaid issued invoice automatically posts a reversing journal entry.
  - **Commercial Print / Remittance View**: Clean printable invoice layout featuring Company Legal Name, ABN, Address, Line Items, GST Summary, and **Australian EFT Remittance Slip (Bank Name, BSB, Account Number)**.
- [ ] **4.3 Recurring Invoice Schedules**:
  - Define frequency (`WEEKLY`, `MONTHLY`, `QUARTERLY`, `ANNUALLY`), start date, next run date, and auto-issue toggle.
- [ ] **4.4 Customer Credit Notes (AR Adjustments)**:
  - Issue Credit Notes (`CRN-1001`) coded to specific `REVENUE` accounts + GST, posting the exact reverse of an invoice (`DEBIT Revenue`, `DEBIT 2100 GST Collected`, `CREDIT 1200 Accounts Receivable`).
  - Allocate open Credit Notes to reduce the balance due on open Customer Invoices, or record a cash refund out of a bank account.
- [ ] **4.5 Payments In, Direct Income Receipts & Customer Prepayments**:
  - **Mode A — Invoice Settlement**: Apply incoming payment to one or more open Customer Invoices into any selected Bank/Asset account (`DEBIT Selected Bank Account`, `CREDIT 1200 Accounts Receivable`).
  - **Mode B — Direct Income Receipt ("Receive Money" without Invoice)**: When no invoice is used, code directly to a `REVENUE` account + GST (`DEBIT Selected Bank Account`, `CREDIT Revenue Account`, `CREDIT 2100 GST Collected`).
  - **Mode C — Customer Prepayment / Deposit on Account**: Record an unallocated customer deposit (`DEBIT Selected Bank Account`, `CREDIT 2300 Customer Prepayments`), which can later be applied to settle a newly issued invoice.

---

### Module 5: Accounts Payable (AP) — Purchase Orders, Bills, Vendor Credits & `.ABA` Batch Payments
**Objective:** Complete procurement and payables lifecycle with Purchase Order approvals, coded Vendor Bills, Recurring Bills, Vendor Credit Notes, and Australian `.ABA` batch bank file exports.

- [ ] **5.1 Purchase Orders (`/purchase-orders` or AP Tab & `/api/v1/purchase-orders`)**:
  - Lifecycle: `DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `APPROVED` / `REJECTED` $\rightarrow$ `BILLED` / `CANCELLED`.
  - `MANAGER`, `ACCOUNTANT`, and `ADMIN` can approve POs.
  - **1-Click Convert to Bill**: Converts an approved PO into a pre-filled Vendor Bill linked via `purchaseOrderId`.
- [ ] **5.2 Vendor Bills (`/bills` & `/api/v1/bills`)**:
  - Lifecycle: `DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `AWAITING_PAYMENT` $\rightarrow$ `PARTIALLY_PAID` $\rightarrow$ `PAID` / `VOID`.
  - Strict account classification filtering: Line items can only be coded to `EXPENSE` or `ASSET` accounts (default `6000 Operating Expenses`) + Tracking Dimensions.
  - **Dynamic GL Posting on Approval**:
    - `DEBIT <Line Item Expense/Asset Account>` (Line Subtotal Cents, tagged with Tracking Dimensions)
    - `DEBIT 2200 GST Paid` (Total GST Cents)
    - `CREDIT 2000 Accounts Payable` (Total Cents)
  - Full editing in `DRAFT`/`PENDING_APPROVAL`; Voiding an unpaid bill posts a reversing GL entry.
- [ ] **5.3 Recurring Bill Schedules**:
  - Schedule recurring supplier obligations (rent, leases, retainers).
- [ ] **5.4 Vendor Credit Notes (AP Adjustments)**:
  - Record supplier credit notes (`DEBIT 2000 Accounts Payable`, `CREDIT Expense/Asset`, `CREDIT 2200 GST Paid`) and apply them to reduce open Vendor Bills.
- [ ] **5.5 Payments Out & Australian `.ABA` Batch Payment Engine**:
  - **Single Payment Out**: Pay a bill from any selected Bank (`ASSET`) or Corporate Credit Card (`LIABILITY`) account (`DEBIT 2000 Accounts Payable`, `CREDIT Selected Bank/Card Account`).
  - **Batch Payment Run & `.ABA` File Generator (`/api/v1/batch-payments`)**:
    - Select multiple unpaid approved Bills (and/or approved Employee Expense Reimbursements).
    - Validate that the Organization and all selected payees have valid 6-digit Australian BSBs and Account Numbers.
    - Atomically record all constituent payments, update bill/claim statuses, post the consolidated GL entry, and generate a downloadable **APCA-compliant `.aba` (Cemtex) bank file** for 1-click upload to Australian business banking portals.

---

### Module 6: Enterprise Expenses — Direct "Spend Money" & Employee Expense Claims
**Objective:** Provide a dedicated `/expenses` module handling both immediate corporate card/bank purchases and staff out-of-pocket expense claims with manager approval and `2050 Employee Reimbursements Payable` accounting.

- [ ] **6.1 Direct "Spend Money" Transactions (Bank & Corporate Card Purchases)**:
  - For immediate purchases (fuel, software subscriptions, merchant receipts) paid via Bank Account or Corporate Credit Card without a prior AP Bill.
  - Multi-line coding to `EXPENSE` / `ASSET` accounts + Tracking Dimensions + GST treatment.
  - **Direct GL Posting**:
    - `DEBIT <Line Item Expense/Asset Account>` (Subtotal Cents + Dimensions)
    - `DEBIT 2200 GST Paid` (GST Cents)
    - `CREDIT <Selected Bank (ASSET) or Corporate Card (LIABILITY) Account>` (Total Cents)
- [ ] **6.2 Employee Expense Claims & Approval Workflow**:
  - **Employee Self-Service Portal**: Users with the `EMPLOYEE` role (and all other internal roles) can create and submit multi-line out-of-pocket expense claims (date, merchant, description, amount, GST treatment, expense category/account, tracking dimension).
  - Lifecycle: `DRAFT` $\rightarrow$ `SUBMITTED` $\rightarrow$ `APPROVED` / `REJECTED` $\rightarrow$ `PAID`.
  - **Manager / Accountant Approval & GL Posting**:
    - When approved by a `MANAGER`, `ACCOUNTANT`, or `ADMIN`, the system posts to the General Ledger:
      - `DEBIT <Line Item Expense Account>` (Subtotal Cents + Dimensions)
      - `DEBIT 2200 GST Paid` (GST Cents)
      - `CREDIT 2050 Employee Reimbursements Payable` (Total Cents)
- [ ] **6.3 Employee Reimbursement Payouts**:
  - Settle approved expense claims individually or include them in a **Batch Payment & `.ABA` File Run**:
    - `DEBIT 2050 Employee Reimbursements Payable` (Amount Paid)
    - `CREDIT <Selected Operating Bank Account>` (Amount Paid)
- [ ] **6.4 Module 6 Frontend UI (`/expenses`)**:
  - Role-aware interface:
    - `EMPLOYEE` users see only **"My Expense Claims"** (Submit Claim, Pending Approval, Reimbursed History).
    - `MANAGER`, `ACCOUNTANT`, and `ADMIN` users see **"My Claims"**, **"Team Approvals Queue"**, **"Reimbursement Payouts"**, and **"Direct Spend Money (Card/Bank)"**.

---

### Module 7: Multi-Account Banking, Inter-Account Transfers & Statement Reconciliation
**Objective:** Manage all cash and credit card accounts, transfer money cleanly between accounts, and reconcile imported bank statements against the General Ledger.

- [ ] **7.1 Bank & Credit Card Accounts Hub (`/banking`)**:
  - Overview of all GL accounts flagged as banking/card accounts (`1000 Operating Bank`, savings accounts, petty cash, corporate credit cards) showing Ledger Balance vs. Last Reconciled Balance.
- [ ] **7.2 Inter-Account Money Transfers (`/api/v1/banking/transfers`)**:
  - Dedicated transfer workflow between any two Bank/Card accounts (e.g., Operating Bank $\rightarrow$ Savings Reserve, or Operating Bank $\rightarrow$ Paying off Corporate Credit Card).
  - Posts a clean 2-line journal entry (`DEBIT Destination Account`, `CREDIT Source Account`) with zero GST or P&L distortion.
- [ ] **7.3 Bank Statement Import & Reconciliation Workspace (`/api/v1/banking/reconciliation`)**:
  - Upload CSV bank statement files (`Date`, `Description`, `Reference`, `Amount Cents`).
  - Smart Reconciliation Engine:
    - Auto-suggests matches against existing unreconciled Payments In, Payments Out, Batch Payments, Direct Spend/Receive Money, and Inter-Account Transfers by amount and date proximity.
    - Allows 1-click **"Match"** or on-the-fly **"Create & Reconcile"** (recording a Direct Spend/Receive Money or Transfer right from the reconciliation line).
    - Marks matched journal entries as `isReconciled: true` with `reconciledAt` timestamp.

---

### Module 8: Financial Statements, Australian BAS Engine, Live Dashboard & Plug-In Contract
**Objective:** Deliver real-time financial statements, ATO Business Activity Statement (BAS) reporting, a 100% live executive dashboard, and the standardized integration contract for custom client modules.

- [ ] **8.1 Interactive Financial Statements (`/reports` & `/api/v1/reports/*`)**:
  - **Trial Balance**: As-of any date; verifies Total Debits == Total Credits across all accounts.
  - **Profit & Loss Statement (Income Statement)**: Custom date range (e.g., This Month, Last Quarter, Financial Year to Date), filterable by **Tracking Dimension** (e.g., P&L for a specific Department, Project, or Fleet Vehicle).
  - **Balance Sheet**: Point-in-time statement grouping Assets, Liabilities, and Equity (including dynamically calculated Current Year Unappropriated Earnings) proving $\text{Assets} == \text{Liabilities} + \text{Equity}$.
  - **Aged Receivables (AR) & Aged Payables (AP) Summary & Detail**: Bucketed into `Current`, `1–30 Days`, `31–60 Days`, `61–90 Days`, and `90+ Days Overdue`.
- [ ] **8.2 Australian BAS (Business Activity Statement) Engine (`/reports/bas`)**:
  - Computes official ATO GST worksheet metrics for any selected monthly or quarterly tax period:
    - **G1**: Total Sales (Gross or Net revenue per org preference)
    - **G2 / G3**: GST-Free Sales
    - **G10 / G11**: Capital & Non-Capital Purchases
    - **1A**: GST on Sales (`2100 GST Collected` credits minus AR credit note reversals)
    - **1B**: GST on Purchases (`2200 GST Paid` debits minus AP credit note reversals)
    - **Net GST Payable / Refundable**: $1\text{A} - 1\text{B}$.
  - Includes a **"Lock BAS Period"** button that sets `organization.lockDate` to the end of the BAS quarter.
- [ ] **8.3 Real-Time Executive Dashboard (`/`) — Zero-Mock Policy**:
  - Replaces all static `"—"` placeholders in `DashboardPage.tsx` with live PostgreSQL aggregations (`GET /api/v1/dashboard/summary`):
    - Cash Position across all bank/card accounts.
    - Outstanding AR (Total + Overdue count & amount).
    - Unpaid AP & Pending Employee Reimbursements (Total + Overdue count & amount).
    - Actionable **Pending Approvals Queue** counter (Draft Bills, POs, Expense Claims, and Journals awaiting approval).
    - Month-to-Date & Year-to-Date Revenue, Expenses, and Net Operating Profit.
    - Visual AR & AP Aging bars.
    - Live Recent Financial Activity & Audit feed.
- [ ] **8.4 Enterprise Plug-In Module Contract (Future Custom Modules)**:
  - Documented extension interface allowing future client-specific modules to plug into the monolith without touching core tables:
    - **Fleet Management Module (`FLEET`)**: Links vehicles to `TrackingOption` records so fuel expenses, maintenance bills, and lease payments automatically roll up into per-vehicle P&L and cost-per-kilometer reports.
    - **Inventory & Warehouse Module (`INVENTORY`)**: Extends `Item` (`isTrackedInventory: true`) with stock ledger movements, Purchase Order goods receipts, and automated Cost of Goods Sold (COGS) journals on invoice issuance.
    - **Cloud Storage Document Attachments (`ATTACHMENTS`)**: GCS V4 presigned upload pipeline attaching PDFs/receipts to Bills, Expense Claims, Invoices, and Journals.
    - **Outbound Automation (`N8N_WEBHOOKS`)**: Asynchronous signed webhooks to n8n for external notifications and integrations.
