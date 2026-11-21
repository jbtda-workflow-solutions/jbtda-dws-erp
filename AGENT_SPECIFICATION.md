# Master System Specification

Concise architectural invariants and financial mechanics for **JBTDA-DWS-ERP** — a modular, multi-tenant Australian accounting & business services platform deployed as a unified monolith on Google Cloud Platform (GCP).

> **Single Source of Truth Map (Zero Duplication):**
> - **Operating Rules & Directory Tree:** `AGENTS.md`
> - **Topology, Env Vars, Secrets & Full API Catalog:** `docs/ARCHITECTURE.md`
> - **Database Schema:** `backend/prisma/schema.prisma` (invariants & migrations in `docs/DATABASE_SCHEMA.md`)
> - **Auth, Session Crypto & 7-Role RBAC Matrix:** `docs/SECURITY.md`
> - **UI/UX & Corporate Precision Design System:** `docs/DESIGN_SYSTEM.md`
> - **Product Module Registry & Domain Contexts:** `docs/modules/README.md` (`docs/modules/*.md`)
> - **Reproducible Delivery Roadmap (Stages 1–16 + Deferred D1–D5):** `docs/STAGES_ROADMAP.md`

---

## 1. Core Architectural Principles

1. **Deterministic Runtime (Zero AI in Production):**
   - AI agents are development-time builders only; they are **never** runtime dependencies.
   - Production code is 100% deterministic TypeScript (Fastify + Prisma + PostgreSQL + React). Never make runtime LLM API calls to process transactions, compute balances, or handle auth.
2. **Unified Monolith Container (Cloud Run):**
   - Built via a single multi-stage root `Dockerfile`: compiles the React SPA (`frontend/dist`) and Fastify API (`backend/dist`) into one unprivileged Node 20 container.
   - Fastify serves static SPA assets via `@fastify/static`, mounts all API routes under `/api/v1/*`, and falls back non-API `GET` routes to `index.html`. Same-origin delivery eliminates CORS overhead and supports `SameSite=Strict` cookies natively.
   - Stateless replicas connected to Cloud SQL PostgreSQL via Unix socket (`/cloudsql/<INSTANCE_CONNECTION_NAME>`) with `connection_limit=7&pool_timeout=10`.
3. **Async External Automation:**
   - External integrations (n8n, webhooks, Google Workspace connectors) run asynchronously and must **never** sit in the synchronous path of authentication, balance calculation, or GL posting.

---

## 2. Financial Mechanics, Currency & Australian Tax Invariants

### Multi-Tenancy Isolation
- Every business table includes `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT`.
- Every business-domain Prisma query MUST explicitly filter `where: { organizationId: request.organizationId }`.

### Currency: AUD Integer Cents
- Store all monetary values as `BIGINT` cents (`$1,250.50` → `125050n`).
- Floating-point types (`FLOAT`, `DOUBLE`, `REAL`) are strictly banned from schemas and monetary math.
- Client-side display uses `Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })`.

### Australian GST (10%)
- Every line item tracks `TaxTreatment`: `TAX_EXCLUSIVE`, `TAX_INCLUSIVE`, or `GST_FREE`.
  - **Tax-Exclusive:** $\text{GST Cents} = \text{round}(\text{Subtotal Cents} \times 0.10)$
  - **Tax-Inclusive:** $\text{GST Cents} = \text{round}\left(\text{Gross Cents} - \frac{\text{Gross Cents}}{1.10}\right)$
  - **Balance Rule:** $\text{Gross Cents} = \text{Subtotal Cents} + \text{GST Cents}$.

### Double-Entry General Ledger Invariant
- Every confirmed financial event posts an atomic, balanced `JournalEntry` inside `prisma.$transaction([...])`:
  $$\sum \text{Debits} = \sum \text{Credits}$$
- All postings enforce `effectiveDate > organization.lockDate`.
- The **10 Protected System Accounts** (`1000`–`6000`) are seeded automatically per organization and cannot be deleted or re-coded (canonical list in `docs/modules/core-accounting.md`).

### Dimensional Accounting & Adaptive Governance
- **Tracking Dimensions (`tracking_categories` / `tracking_options`):** Every `JournalLine` and sub-ledger line item accepts an optional `trackingOptionId` so P&L and operational reports slice cleanly by Department, Project, Location, or Fleet Vehicle without duplicating GL accounts.
- **Smart Approvals:** `ADMIN` and `ACCOUNTANT` can "Approve & Post Immediately" in 1 click unless `organization.enforceTwoPersonApproval === true` (strict maker-checker mode).
- **Immutable Audit Log:** Every mutation appends to `audit_logs` within the same Prisma transaction.
- **Contact Payment Rule (`requires_invoice_for_payment`):** Default `true` (incoming receipts must apply to an open Invoice); when `false`, permits Direct Income Receipts or Customer Prepayments (`2300`).

---

## 3. Product Modules & Delivery Roadmap

- **Canonical Product Modules (`docs/modules/README.md`):** `CORE_PLATFORM`, `CORE_ACCOUNTING`, `RECEIVABLES`, `PAYABLES`, `EXPENSES`, `CONNECTORS`, `DOCUMENTS`, `PROJECTS`, `INVENTORY`, `FLEET`, `PAYROLL`, and internal `DEVELOPER_PORTAL`.
- **Delivery Stages (`docs/STAGES_ROADMAP.md`):** Stages 1–13 completed; Stages 14–16 active (`Module Gating & Recurring Runner`, `Connectors Hub Phase 1 — /connectors UI & API Keys`, `Connectors Hub Phase 2 — Google Workspace`); Deferred Stages D1–D6 (`DOCUMENTS`, `PROJECTS`, `INVENTORY`, `FLEET`, `PAYROLL`, `Outbound Webhooks & n8n`).
