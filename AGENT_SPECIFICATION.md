# Master System Specification & AI Agent Operating Manual

This document defines the complete technical architecture, operational guidelines, design system, and multi-stage development roadmap for building a modular, multi-tenant accounting application deployed on Google Cloud Platform (GCP).

---

## 1. Zero-Memory Agent Operating Protocol

You are operating as a senior full-stack software architect, cloud engineer, and financial security specialist.

### Critical Production Principle: Deterministic Runtime (Zero AI in Production)
- **AI Agents are the builders during development; they are NOT runtime dependencies.**
- The production application must be 100% deterministic, traditional web software (TypeScript, Fastify, React, Prisma, PostgreSQL).
- The production app must **NEVER** make runtime LLM API calls, run AI inference, or require background agents to process transactions, compute balances, or run authentication. Every workflow must be explicit, testable, compiled code.

### Mandatory Agent Rules
1. **Zero Session Memory Dependency:** Never assume context from previous chat sessions or prompt turns. The single source of truth is the code and documentation committed to this repository.
2. **Persistent Documentation First:** Every architectural decision, data model change, API contract, and security constraint must be documented in dedicated markdown files in the `/docs` directory before or immediately upon implementation.
3. **Changelog Maintenance:** Any task that introduces a new route, migration, dependency, or schema modification must append an entry to `docs/CHANGELOG.md`.
4. **Clean-Slate Baseline:** The database is a fresh testing environment. Generate clean baseline Prisma migrations with standard `snake_case` PostgreSQL naming conventions.
5. **Zero Local Installation or Host Execution:** Do NOT run `npm install`, package managers, or dev servers on the local host development machine. The application is never executed, installed, or demoed locally. Dependencies are declared directly in `package.json` manifests and are built/installed inside containerized multi-stage Docker builds on Google Cloud Build during deployment to Cloud Run.
6. **No Autonomous Git Commits (Provide Commit Messages):** Never execute `git commit` or `git push`. The user handles staging, commits, and pushes. Whenever a logical revision is completed, the agent must output a concise, conventional git commit message for the user to copy.
7. **Clean Imports & Compiler Tolerance:** Prune unused imports and variables during every revision. The frontend `tsconfig.json` maintains `noUnusedLocals: false` and `noUnusedParameters: false` to prevent trivial unused import warnings from breaking production container compilation in Cloud Build.

### Phase 0 Repository Scaffold
Before writing feature code, ensure the following directory structure and documentation files are present:

```
.
├── AGENTS.md                  # Root agent instructions and execution constraints
├── docs/
│   ├── ARCHITECTURE.md        # Topology, service boundaries, and GCP layout
│   ├── DATABASE_SCHEMA.md     # PostgreSQL tables, relations, and migration log
│   ├── SECURITY.md            # Auth mechanics, RBAC matrix, and crypto standards
│   ├── DESIGN_SYSTEM.md       # Typography, Tailwind tokens, and table conventions
│   ├── INTEGRATIONS.md        # Async webhook payloads and n8n job contracts
│   ├── STAGES_ROADMAP.md      # Detailed breakdown of Stage 1 (MVP) through Stage 3
│   └── CHANGELOG.md           # Chronological log of changes and schema diffs
├── frontend/                  # React SPA (Vite + TypeScript + Tailwind)
└── backend/                   # Core Modular Monolith API (Fastify + TypeScript + Prisma)
```

---

## 2. System Architecture & GCP Topology (Unified Monolith)

The application is deployed as a single, unified container on Google Cloud Run to eliminate cross-origin (CORS) complexity and ensure robust `SameSite=Strict` cookie security:

```
                          ┌────────────────────────────────────────┐
                          │         GCP Cloud Run Service          │
                          │                                        │
                          │  ┌──────────────────────────────────┐  │
                          │  │    Static React SPA (Vite/TS)    │  │
                          │  │  (Served via @fastify/static)    │  │
                          │  └──────────────────────────────────┘  │
                          │                                        │
                          │     Fastify + TypeScript + Prisma      │
                          └───────┬────────────────────────────┬───┘
                                  │                            │
            Direct Queries (ACID) │                            │ Async Webhooks
            (Cloud SQL Proxy)     │                            │ (X-Webhook-Secret)
                                  ▼                            ▼
                         ┌──────────────┐               ┌────────────────┐
                         │GCP Cloud SQL │               │ GCP Cloud Run  │
                         │ (PostgreSQL) │               │(n8n Automation)│
                         └──────────────┘               └────────┬───────┘
                                                                 │
                                                                 ▼
                                                         External Services
                                                         (Email, Plaid)
```

### Stack Components

1. **Frontend (`/frontend`):**
   - Single Page Application (React 18/19, TypeScript, Vite, Tailwind CSS).
   - Component primitives: Radix UI / shadcn/ui patterns with Lucide React icons.
   - Dynamic code-splitting via `React.lazy()` for module boundaries (Contacts, AP, AR, Ledger).
   - **Delivery:** Compiled at build time (`dist/`) and served directly by the Fastify backend from the root path (`GET /`). Not hosted separately.
   - **API Client:** Makes relative requests to the backend (e.g., `fetch('/api/v1/auth/google')`), avoiding CORS preflight checks entirely.

2. **Core Backend API (`/backend`):**
   - **Framework:** Fastify with TypeScript.
   - **ORM:** Prisma ORM with PostgreSQL client.
   - **Routing Isolation:**
     - Serve the React static build directory using `@fastify/static` at the root `/`.
     - Mount all core API logic under `/api/v1/`.
     - SPA Fallback: Any `GET` request failing to match `/api/*` returns `index.html` to allow React Router to handle client-side routing.
   - **Statelessness:** No local session caches. Autoscales horizontally across Cloud Run replicas.
   - **Connection Pool Ceiling:** Explicitly configure Prisma connection limits:
     `DATABASE_URL="postgresql://user:pass@host/db?connection_limit=7&pool_timeout=10"`
     This prevents multiple Cloud Run containers from exhausting Cloud SQL connection limits.
   - **Containerization:** Built via a multi-stage root `Dockerfile` that compiles the React app, compiles the TypeScript API, and packages both into a single unprivileged Node 20 runtime listening on `$PORT`.

3. **Database (Cloud SQL PostgreSQL):**
   - Managed PostgreSQL instance with private VPC connection or Cloud SQL Auth Proxy.
   - Zero direct public exposure.

4. **Automation & Integration Engine (n8n on Cloud Run):**
   - Worker engine for background automations (email dispatches, PDF generation, external syncing).
   - Triggered via asynchronous webhooks with `X-Webhook-Secret` verification. Does **not** process user authentication or synchronous financial queries.

### Cloud Run Runtime Configuration (Variables & Secrets)

The application relies strictly on Google Cloud Run container configuration (zero `.env` files in production):

1. **Cloud SQL Connections (Cloud Run UI):**
   - Attached Instance: `PROJECT_ID:REGION:INSTANCE_NAME` (e.g. `digitalworkflowsolutions-erp:us-central1:erp`).
   - Cloud Run mounts the Unix socket at `/cloudsql/<INSTANCE_CONNECTION_NAME>`, which Fastify discovers automatically.

2. **Environment Variables (Cloud Run UI):**
   | Variable | Description / Purpose |
   | :--- | :--- |
   | `INSTANCE_CONNECTION_NAME` | Cloud SQL instance connection name (e.g. `PROJECT_ID:REGION:INSTANCE_NAME`). Explicitly targets the Unix socket `/cloudsql/<INSTANCE_CONNECTION_NAME>`. Essential for multi-tenant isolation and portable client forks. |
   | `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Web Client ID (token verification & served to frontend via `/api/v1/auth/config`) |
   | `DB_USER` | PostgreSQL user (e.g. `erp_admin`) |
   | `DB_NAME` | PostgreSQL database name (e.g. `erp`) |
   | `FRONTEND_ORIGIN` | Allowed origin for CORS (e.g. preview deployment URL or `http://localhost:5173`) |
   | `NODE_ENV` | `production` |

3. **Secrets Exposed as Environment Variables (Secret Manager):**
   | Secret in Secret Manager | Mounted Variable | Purpose |
   | :--- | :--- | :--- |
   | `user_erp_admin_pass...` | `DB_PASSWORD` | PostgreSQL user password |
   | `erp_session_secret` | `SESSION_SECRET` | 32+ character random secret for signing and encrypting session cookies |
   | `erp_webhook_secret` *(Stage 2)* | `WEBHOOK_SECRET` | 64-character secret for n8n asynchronous webhooks |

---

## 3. Financial Mechanics, Currency & Tax Specifications

### Multi-Tenancy Architecture
- Every business table MUST include:
  ```sql
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT
  ```
- Every database query in the Fastify backend MUST explicitly include `where: { organizationId: request.organizationId }`.

### Currency: Australian Dollars (AUD) in Cents
- **Strict Integer Arithmetic:** Currencies are stored as integers (`BIGINT` in PostgreSQL, `bigint` or integer `number` in TypeScript) representing **cents**.
  - Example: $\$1,250.50 \rightarrow 125050$
  - Example: $\$0.05 \rightarrow 5$
- **Floating-point types (`FLOAT`, `DOUBLE`, `REAL`) are strictly banned from database schemas and calculation logic.**
- Monetary display formatting is performed client-side using `Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })`.

### Australian GST (Goods and Services Tax)
- Default Australian GST rate is a flat **10%**.
- Line items must explicitly track their tax treatment: `TAX_EXCLUSIVE`, `TAX_INCLUSIVE`, or `GST_FREE`.
- Calculation rules:
  - **Tax-Exclusive:** $\text{GST Cents} = \text{round}(\text{Subtotal Cents} \times 0.10)$
  - **Tax-Inclusive:** $\text{GST Cents} = \text{round}\left(\text{Gross Cents} - \frac{\text{Gross Cents}}{1.10}\right)$
- All totals must balance: $\text{Gross Cents} = \text{Subtotal Cents} + \text{GST Cents}$.

### Double-Entry Accounting Invariant (Automated Behind the Scenes)
- The General Ledger records transactions automatically on every confirmed invoice, bill, or payment.
- Invariant:
  $$\sum \text{Debits} = \sum \text{Credits}$$
- Balance checks must occur in integer cents within an atomic Prisma transaction (`prisma.$transaction([...])`). If debits $\neq$ credits, the transaction automatically rolls back.

---

## 4. Default Seed Chart of Accounts (Protected System Accounts)

When a new organization is created, the system automatically seeds **10 Protected System Accounts** (`isSystem: true`). Users can add custom accounts and hierarchical sub-accounts (`parentId`), and can transfer sub-account balances back into main accounts when decommissioning them, but the 10 system accounts cannot be deleted or re-coded:

| Code | Account Name | Type | Normal Balance | System Key | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `1000` | Operating Bank Account | `ASSET` | Debit | `OPERATING_BANK` | Primary cash account for payments in and out |
| `1200` | Accounts Receivable (A/R) | `ASSET` | Debit | `ACCOUNTS_RECEIVABLE` | Money owed by customers for issued invoices |
| `2000` | Accounts Payable (A/P) | `LIABILITY` | Credit | `ACCOUNTS_PAYABLE` | Money owed to suppliers for recorded bills |
| `2050` | Employee Reimbursements Payable | `LIABILITY` | Credit | `EMPLOYEE_REIMBURSEMENTS` | Liability for approved staff out-of-pocket expense claims |
| `2100` | GST Collected (Sales) | `LIABILITY` | Credit | `GST_COLLECTED` | 10% GST collected on sales to be remitted to the ATO |
| `2200` | GST Paid (Purchases) | `ASSET` | Debit | `GST_PAID` | 10% GST paid on bills & expenses, claimable from the ATO |
| `2300` | Customer Prepayments / Unearned | `LIABILITY` | Credit | `CUSTOMER_PREPAYMENTS` | Unallocated customer deposits / retainers on account |
| `3000` | Retained Earnings | `EQUITY` | Credit | `RETAINED_EARNINGS` | Cumulative historical net profit/loss equity account |
| `4000` | Sales Revenue | `REVENUE` | Credit | `DEFAULT_REVENUE` | Default operating income account |
| `6000` | Operating Expenses | `EXPENSE` | Debit | `DEFAULT_EXPENSE` | Default operating vendor and employee expense account |

---

## 5. Master Data, Dimensional Accounting & Governance Rules

### Contact Entity Design (`contacts`)
Contacts represent Customers (AR), Vendors/Suppliers (AP), or Both:
- `type`: `'CUSTOMER' | 'VENDOR' | 'BOTH'`
- `name` & `legal_name`: Trading and legal entity names
- `email`, `phone`, `billing_address`: Contact details
- `abn`: 11-digit Australian Business Number (validated via ATO checksum)
- `payment_terms_days`: Default net payment terms (e.g., 7, 14, 30 days)
- `bank_bsb`, `bank_account_number`, `bank_account_name`: Australian EFT banking details for `.aba` batch payment exports
- **`requires_invoice_for_payment` (Boolean, Default: `true`):**
  - When `true`: Incoming customer payments must be applied against an open Customer Invoice.
  - When `false`: Uninvoiced receipts are permitted, allowing the user to record either a **Direct Income Receipt** (coded straight to a `REVENUE` account + GST) or a **Customer Prepayment on Account** (`2300`).

### Dimensional Accounting (Tracking Categories / Cost Centers)
- Every organization can define custom **Tracking Categories** (e.g., *Department*, *Project*, *Location*, *Fleet Vehicle*) and **Tracking Options**.
- Every `JournalLine` and sub-ledger line item (`InvoiceLineItem`, `BillLineItem`, `QuoteLineItem`, `PurchaseOrderLineItem`, `ExpenseLineItem`) supports dimensional tagging so P&L and operational reports can be sliced by cost center or asset without duplicating GL accounts.

### Adaptive Approval Workflows & Period Controls
- **Smart Role Approvals:** `ADMIN` and `ACCOUNTANT` users can "Approve & Post Immediately" in 1 click (zero friction for small businesses) or save as Draft. Lower roles (`EMPLOYEE`, `AP_SPECIALIST`, `AR_SPECIALIST`) submit records into a `PENDING_APPROVAL` state. Organizations can optionally toggle `enforceTwoPersonApproval: true` to require maker-checker signoff across all roles.
- **Immutable System Audit Log:** Every mutation writes an append-only record to `audit_logs` capturing `actorUserId`, `organizationId`, `action`, `entityType`, `entityId`, and change metadata.
- **Accounting Period Lock Date:** Transactions cannot be created, edited, reversed, or voided with an effective date on or before `organization.lockDate`.

---

## 6. 8-Module Enterprise Architecture Scope

The platform is organized into **8 cohesive, deep-built modules** (see `docs/STAGES_ROADMAP.md` for full specifications):

1. **Module 1 — Enterprise Workspace, RBAC, Governance & Unified Schema:** Multi-company switcher, 7-tier domain-isolated RBAC, Organization remittance profile (BSB/Account #/APCA ID), Period Lock Dates, `enabledModules` feature flags (`['CORE_FINANCE', 'EXPENSES', 'FLEET', 'INVENTORY']`), and Immutable System Audit Log.
2. **Module 2 — The Financial Spine (CoA, Dimensions & GL Engine):** Full CRUD Chart of Accounts (`/accounts`), 10 protected system accounts, sub-account balance sweep decommissioning, Tracking Categories/Cost Centers, Manual & Recurring Adjusting Journals, and 1-click Journal Reversals.
3. **Module 3 — Master Data (Contacts & Items Catalog):** Customers & Vendors with Australian banking details and Contact 360 history; Products & Services Catalog (`/items`) with default sales/purchase pricing, GST treatments, and linked GL accounts.
4. **Module 4 — Accounts Receivable (AR):** Quotes/Estimates (with 1-click Invoice conversion), Coded Customer Invoices (with EFT remittance slip), Recurring Invoices, Customer Credit Notes, and Payments In (Invoice settlement, Direct Income Receipt, or Customer Prepayment).
5. **Module 5 — Accounts Payable (AP):** Purchase Orders (with manager approval & 1-click Bill conversion), Coded Vendor Bills, Recurring Bills, Vendor Credit Notes, Single Payments Out, and **Australian `.ABA` (Cemtex) Batch Payment File Export**.
6. **Module 6 — Enterprise Expenses (`/expenses`):** Direct "Spend Money" (Bank & Corporate Card purchases coded directly to GL) and Employee Expense Claims (`DRAFT` $\rightarrow$ `SUBMITTED` $\rightarrow$ `APPROVED` crediting `2050 Employee Reimbursements Payable` $\rightarrow$ `PAID` via single or `.aba` batch reimbursement).
7. **Module 7 — Multi-Account Banking, Transfers & Reconciliation (`/banking`):** Multiple Bank & Corporate Card accounts, Inter-Account Money Transfers, and CSV/OFX Bank Statement Import & Matching Reconciliation workspace.
8. **Module 8 — Financial Statements, Australian BAS Engine, Live Dashboard & Plug-Ins (`/reports` & `/`):** Trial Balance, Dimensional Profit & Loss, Balance Sheet, AR/AP Aging (Current, 1–30, 31–60, 61–90, 90+ days), ATO BAS Worksheet (G1, 1A, 1B), 100% live database Dashboard, and plug-in hooks for Fleet Management, Inventory, and GCS Attachments.

---

## 7. Authentication, Onboarding & Access Control

### Google OAuth 2.0 Flow
1. User clicks "Sign in with Google" in the React frontend (`@react-oauth/google`).
2. Google returns an OpenID Connect (OIDC) ID token (JWT) to the browser.
3. Frontend sends token to Fastify: `POST /api/v1/auth/google { "idToken": "..." }`.
4. Fastify verifies token using official `google-auth-library` (`OAuth2Client.verifyIdToken`).
5. User is upserted into the `users` table based on immutable `google_sub`.

### First-Time Onboarding (Option B)
1. Backend checks `organization_members` for existing memberships.
2. Backend checks `organization_invites` for pending invitations matching the user's verified email.
3. **If invited:** The user is linked to the inviting organization with the specified role and proceeds to the dashboard.
4. **If not invited and has no organizations:**
   - User is placed in an `ONBOARDING` status.
   - Frontend displays the **Create Organization Modal**.
   - Required fields:
     - **Organization Legal Name** (String, 2-100 characters)
     - **Australian Business Number (ABN)** (11 digits, validated against standard ATO ABN checksum algorithm)
   - On submission (`POST /api/v1/organizations`):
     - An `organizations` record is created.
     - The user is assigned the `ADMIN` role in `organization_members`.
     - Default Chart of Accounts is seeded for that organization.

### Session Delivery
- Fastify issues a signed, encrypted session cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`).
- The cookie payload contains:
  ```json
  {
    "userId": "uuid",
    "organizationId": "uuid",
    "role": "ADMIN"
  }
  ```
- Fastify middleware decorates `request.user` and `request.organizationId` on every authenticated call.

### Multi-Tenant 7-Role RBAC Matrix
Roles defined in `organization_members.role` (strictly compartmentalized by domain):
- `ADMIN`: Full access to company settings, lock dates, enabled modules, user invites, GL, AR, AP, Expenses, Banking, and Audit Logs.
- `ACCOUNTANT`: Full access to CoA, Tracking Dimensions, GL, manual journals, 1-click approvals, AR, AP, Expenses, Banking, and BAS/financial reporting; cannot alter org module flags or delete the organization.
- `MANAGER`: Operational approver; can approve Purchase Orders and Team Employee Expense Claims, read contacts/items/AR/AP, and submit own expenses; no access to GL journals or bank settings.
- `AR_SPECIALIST`: Domain-scoped to Customers, Items, Quotes, Customer Invoices, AR Credit Notes, and Payments In; cannot view AP bills, payroll/reimbursements, or full GL.
- `AP_SPECIALIST`: Domain-scoped to Vendors, Items, Purchase Orders, Vendor Bills, AP Credit Notes, Direct Spend Money, and preparing Batch Payment runs; cannot view AR invoices or full GL.
- `EMPLOYEE`: Strictly isolated to submitting and viewing their own Employee Expense Claims (and assigned operational modules like Fleet/Inventory when enabled); zero access to company financials, GL, AR, AP, or Contacts.
- `AUDITOR`: Read-only access across all financial records, reports, and the Immutable System Audit Log.

---

## 8. Machine-to-Machine Security & Webhooks (Core API $\rightarrow$ n8n)

- Outbound communication from Fastify to n8n is protected by a pre-shared 64-character secret.
- Header: `X-Webhook-Secret: <WEBHOOK_SECRET_ENV>`
- Standardized Event Schema:
  ```json
  {
    "event": "invoice.issued",
    "event_id": "evt_uuid",
    "timestamp": "2026-11-01T04:30:00Z",
    "organization_id": "org_uuid",
    "triggered_by_user_id": "usr_uuid",
    "data": {
      "invoice_id": "inv_uuid",
      "invoice_number": "INV-1001",
      "customer_email": "client@example.com",
      "total_cents": 132000
    }
  }
  ```

---

## 9. Corporate Precision Design System & UI/UX Specifications

The frontend implements an institutional, high-density financial interface codified in `docs/DESIGN_SYSTEM.md`.

### Core Aesthetic Principles
- **Architectural & Crisp Geometry:** Max corner radius of `4px` (`rounded`) on buttons/inputs/status tags and `6px` (`rounded-md`) on structural containers. Zero drop-shadows on cards/tables; rely on `1px solid` hairline borders (`border-slate-200`). Never use `rounded-xl`, `rounded-2xl`, `rounded-full` pill badges, or pastel icon boxes.
- **Process Pipeline Ribbons:** Every workflow module features a connected horizontal lifecycle pipeline (`Draft ➔ Pending Approval ➔ Open ➔ Overdue ➔ Paid`) displaying live record counts and AUD totals in `JetBrains Mono` that acts as both a process map and a 1-click filter.
- **Right-Hand Slide-Over Inspector Drawers (`Drawer`):** Clicking a table row opens a full-height right-hand drawer showing metadata, approval controls, the exact Double-Entry General Ledger impact (`DEBIT`/`CREDIT`), and the record's audit log while preserving table context on the left.

### Typography Hierarchy (`Inter` + `JetBrains Mono`)
1. **Interface & Prose (`font-sans`):** **Inter** (`300`, `400`, `500`, `600`). Headings use `font-medium` (500) with `tracking-tight`.
2. **Financial Figures, GL Codes & Identifiers (`font-numbers` / `font-mono`):** **JetBrains Mono** (`400`, `500`, `600`) with `tabular-nums`. Mandatory on all monetary amounts, GL account codes (`1000`), document numbers (`INV-1001`), ABNs, BSBs, and transaction dates.

### Brand Palette (Obsidian Carbon & Institutional Forest)
- **Obsidian Carbon Navigation Frame:** `#0B1311` (`bg-obsidian-950`) sidebar with `#111E1A` (`bg-obsidian-900`) active surfaces and `border-white/[0.08]` hairline dividers.
- **Work Surface:** `#F8FAFC` (`bg-slate-50`) canvas with `#FFFFFF` (`bg-white`) bordered workbenches and `36px–40px` compact table rows.
- **Primary Accents:** Institutional Forest `#14382C` (`bg-forest-900`), Hover `#1B4D3E` (`hover:bg-forest-700`), Emerald Signal `#10B981` (`text-emerald-500`), and Warm Brass/Amber (`#B45309`) for approval states.
- **Squared Status Tags:** `rounded` (`4px`) bordered tags with a `6px` semantic dot (`border-emerald-200`, `border-amber-200`, `border-rose-200`, `border-slate-300`).

---

## 10. Module-by-Module Deep-Build Roadmap

Development executes sequentially across **8 complete enterprise modules** (detailed in `docs/STAGES_ROADMAP.md`):

- **Module 1:** Enterprise Workspace, 7-Role RBAC, Governance, Immutable Audit Log & Unified Enterprise Prisma Schema
- **Module 2:** The Financial Spine — Chart of Accounts (`/accounts`), Tracking Dimensions & General Ledger Engine (`/ledger`)
- **Module 3:** Master Data — Contacts Directory (`/contacts`) & Products/Services Catalog (`/items`)
- **Module 4:** Accounts Receivable (AR) — Quotes, Invoices, Recurring Billing, Credit Notes, Direct Income & Prepayments
- **Module 5:** Accounts Payable (AP) — Purchase Orders, Vendor Bills, Recurring Bills, Vendor Credits & `.ABA` Batch Payments
- **Module 6:** Enterprise Expenses (`/expenses`) — Direct "Spend Money" (Bank/Card) & Employee Expense Claims (`2050` Reimbursements)
- **Module 7:** Multi-Account Banking, Inter-Account Transfers & CSV/OFX Statement Reconciliation (`/banking`)
- **Module 8:** Financial Statements, Australian BAS Engine, 100% Live Executive Dashboard & Plug-In Module Contract (`/reports` & `/`)