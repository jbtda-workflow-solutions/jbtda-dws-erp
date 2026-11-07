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

## 4. Default Seed Chart of Accounts

When a new organization is created, the system must automatically seed the following minimal Australian SME Chart of Accounts:

| Code | Account Name | Type | Normal Balance | Description |
| :--- | :--- | :--- | :--- | :--- |
| `1000` | Operating Bank Account | `ASSET` | Debit | Primary cash account for payments in and out |
| `1200` | Accounts Receivable (A/R) | `ASSET` | Debit | Money owed by customers for issued invoices |
| `2000` | Accounts Payable (A/P) | `LIABILITY` | Credit | Money owed to suppliers for recorded bills |
| `2100` | GST Collected (Sales) | `LIABILITY` | Credit | 10% GST collected to be remitted to the ATO |
| `2200` | GST Paid (Purchases) | `ASSET` | Debit | 10% GST paid on bills, claimable from the ATO |
| `4000` | Sales Revenue | `REVENUE` | Credit | Core business operating income |
| `5000` | Operating Expenses | `EXPENSE` | Debit | General vendor expenses and purchases |

---

## 5. Contact Configuration & Invoicing Workflow Rules

### Contact Entity Design (`contacts`)
Contacts represent both Customers (AR) and Vendors/Suppliers (AP):
- `type`: `'CUSTOMER' | 'VENDOR' | 'BOTH'`
- `name`: Legal or trading name
- `email`: Primary contact address
- `abn`: 11-digit Australian Business Number
- `payment_terms_days`: Default net payment terms (e.g., 7, 14, 30 days)
- **`requires_invoice_for_payment` (Boolean, Default: `true`):**
  - When `true`: The system enforces that incoming payments must be matched and applied against an existing open Customer Invoice.
  - When `false`: Direct payments/receipts can be recorded for this customer without creating a prior invoice (e.g., point-of-sale, direct bank transfers).

---

## 6. Stage 1 MVP Implementation Scope

Stage 1 establishes the foundational transactional workflows without external file dependencies. File and document attachments (GCS upload URLs) are deferred to Stage 2.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CORE / CONTACTS MODULE                          │
│     Organizations, User Roles, Vendors (Suppliers), Clients/Customers   │
└──────────────────┬──────────────────────────────────┬──────────────────┘
                   │                                  │
                   ▼                                  ▼
┌─────────────────────────────────────┐  ┌───────────────────────────────┐
│       ACCOUNTS PAYABLE (AP)         │  │    ACCOUNTS RECEIVABLE (AR)    │
│  • Record Bills Received            │  │  • Create Customer Invoices    │
│  • Record Payments Out against bills│  │  • Record Payments In          │
│  • Partial & Full payment allocation│  │  • Direct Receipts (if config) │
└──────────────────┬──────────────────┘  └────────────────┬──────────────┘
                   │                                      │
                   └──────────────────┬───────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       AUTOMATED LEDGER POSTING                         │
│     Automatic Double-Entry Journal Entries for all Bills & Payments    │
└────────────────────────────────────────────────────────────────────────┘
```

### 1. Contacts Management
- Create, list, edit, and deactivate Contacts.
- Set contact type, ABN, terms, and the `requires_invoice_for_payment` policy.

### 2. Accounts Payable (Bills & Payments Out)
- **Record Bill:**
  - Vendor selection, Bill Reference Number, Issue Date, Due Date.
  - Line items with Description, Amount in Cents, and GST treatment (`EXCLUSIVE`, `INCLUSIVE`, `GST_FREE`).
  - System calculates Subtotal, GST, and Total.
  - Status: `AWAITING_PAYMENT`, `PARTIALLY_PAID`, `PAID`, `VOID`.
  - **Automatic Ledger Posting:**
    - Debit `5000 - Operating Expenses` (Subtotal Cents)
    - Debit `2200 - GST Paid` (GST Cents)
    - Credit `2000 - Accounts Payable` (Total Cents)
- **Record Payment Out:**
  - Select Bill, Payment Date, Amount in Cents, Reference (e.g., Bank Ref).
  - Validates payment does not exceed remaining unpaid balance.
  - Updates Bill status (`PARTIALLY_PAID` or `PAID`).
  - **Automatic Ledger Posting:**
    - Debit `2000 - Accounts Payable` (Amount Paid)
    - Credit `1000 - Operating Bank Account` (Amount Paid)

### 3. Accounts Receivable (Invoices & Payments In)
- **Create Customer Invoice:**
  - Customer selection, Invoice Number (auto-incrementing per org), Issue Date, Due Date.
  - Line items with GST calculation.
  - Status: `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `VOID`.
  - **Automatic Ledger Posting on Issuance:**
    - Debit `1200 - Accounts Receivable` (Total Cents)
    - Credit `4000 - Sales Revenue` (Subtotal Cents)
    - Credit `2100 - GST Collected` (GST Cents)
- **Record Payment In:**
  - If customer has `requires_invoice_for_payment = true`: User selects an open invoice to apply the payment against.
  - If customer has `requires_invoice_for_payment = false`: User can record a direct cash receipt linked to the contact.
  - Updates Invoice status (`PARTIALLY_PAID` or `PAID`).
  - **Automatic Ledger Posting:**
    - Debit `1000 - Operating Bank Account` (Amount Received)
    - Credit `1200 - Accounts Receivable` (Amount Received)

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

### Multi-Tenant RBAC Matrix
Roles defined in `organization_members.role`:
- `ADMIN`: Full access to company settings, users, billing, AR, AP, GL.
- `ACCOUNTANT`: Full access to GL, journals, AR, AP, tax reporting; cannot delete the organization.
- `AR_SPECIALIST`: Can create/manage customers, issue invoices, record payments.
- `AP_SPECIALIST`: Can create/manage vendors, record bills, submit payment requests.
- `AUDITOR`: Read-only access across all records and audit logs.

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

## 9. Design System & UI/UX Specifications

The frontend implements a clean, high-performance financial interface using Tailwind CSS with an explicit hybrid typography strategy.

### Typography Hierarchy (Hybrid Approach)
1. **Interface Text (`font-sans`):** **Inter**
   - Headings: `font-medium` (500) with slight tight tracking (`tracking-tight`). Avoid bold weights (`font-bold`, 700).
   - Body & Descriptions: `font-light` (300) or `font-normal` (400) with relaxed line heights.
2. **Financial Numbers & Metrics (`font-numbers`):** **Open Sans**
   - All monetary amounts, line-item totals, subtotal/tax calculations, and transaction dates MUST use `font-numbers`.
   - **Tabular Alignment Rule:** Every single financial figure cell MUST include the `tabular-nums` class. This forces proportional alignment so decimal points line up vertically down columns.

### Color Tokens & Palette
- **Canvas / Background:** Canvas Off-White `#F8FAFC` (`bg-slate-50`)
- **Structure & Typography:** Midnight Navy `#0F172A` (`text-slate-900`), Muted Slate `#64748B` (`text-slate-500`)
- **Brand / Primary Actions:**
  - Primary CTA: Deep Forest Green `#14382C` (`bg-forest-900`)
  - Hover CTA: Medium Forest `#1B4D3E` (`hover:bg-forest-700`)
  - Soft Brand Tint: Soft Sage `#EAF3EE` (`bg-forest-50`)
- **Semantic Status Badges (Pastel Background + Saturated Text):**
  - **Paid / Settled:** Pastel Mint `#DCFCE7` background with Deep Green `#14532D` text
  - **Pending / Draft:** Soft Sand `#FEF3C7` background with Deep Bronze `#78350F` text
  - **Overdue / Void:** Soft Rose `#FFE4E6` background with Deep Wine `#881337` text

### Data Table Standards (Classic Tailwind Clean)
- **Table Container:** `bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm`
- **Header Row:** Light slate background (`bg-slate-50`), muted slate text (`text-slate-500`), small uppercase with wide tracking (`text-xs font-medium uppercase tracking-wider`).
- **Data Rows:** White background with subtle row dividers (`border-b border-slate-100` or `divide-y divide-slate-200`). Row hover: `hover:bg-slate-50 transition-colors`.
- **Column Alignment:** Contact/Vendor names and descriptions left-aligned; status badges centered or left-aligned; all monetary figures strictly right-aligned (`text-right font-numbers tabular-nums`).

### Tailwind Configuration (`tailwind.config.ts`)
```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#EAF3EE',
          500: '#236551',
          700: '#1B4D3E',
          900: '#14382C',
        },
        navy: {
          50: '#F8FAFC',
          500: '#64748B',
          900: '#0F172A',
        },
        badge: {
          paidBg: '#DCFCE7',
          paidText: '#14532D',
          pendingBg: '#FEF3C7',
          pendingText: '#78350F',
          overdueBg: '#FFE4E6',
          overdueText: '#881337',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        numbers: ['"Open Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

---

## 10. Phased Development Roadmap

### Stage 1: Core Transactional Engine (Immediate Scope)
- Fastify + React + Prisma baseline setup.
- Google OAuth 2.0 login and Option B Onboarding with 11-digit ABN validation.
- Default Chart of Accounts seeding on org creation.
- Contacts directory (Vendors & Customers with `requires_invoice_for_payment` setting).
- Bills Received & Payments Out (with automated debits/credits).
- Invoices Issued & Payments In (with automated debits/credits).

### Stage 2: File Attachments & Outbound Integrations
- Google Cloud Storage (GCS) integration for bill PDF uploads via V4 Presigned URLs.
- n8n webhook triggers for PDF invoice generation and automated email dispatch.

### Stage 3: Reporting & Financial Visibility
- Interactive General Ledger, Trial Balance, and Profit & Loss statement views.
- Australian Business Activity Statement (BAS) summary calculation (G1 Total Sales, 1A GST Collected, 1B GST Paid).