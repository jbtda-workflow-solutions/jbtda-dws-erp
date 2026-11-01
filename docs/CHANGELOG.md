# Changelog

Chronological log of all changes, schema diffs, and new dependencies.

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
- `backend/prisma/schema.prisma` — full initial Prisma schema:
  - Enums: `Role`, `ContactType`, `TaxTreatment`, `BillStatus`,
    `InvoiceStatus`, `AccountType`, `NormalBalance`, `EntryType`
  - Models: `User`, `Organization`, `OrganizationMember`,
    `OrganizationInvite`, `Account`, `Contact`, `Bill`, `BillLineItem`,
    `Invoice`, `InvoiceLineItem`, `PaymentOut`, `PaymentIn`,
    `JournalEntry`, `JournalLine`
- `backend/src/server.ts` — Fastify server setup with plugin registrations
- `backend/src/plugins/prisma.ts` — Prisma client Fastify plugin
- `backend/src/plugins/auth.ts` — session cookie middleware, `request.user` decorator
- `backend/src/routes/auth.ts` — `POST /api/v1/auth/google` (Google OIDC verification + upsert)
- `backend/src/lib/abn.ts` — ATO ABN checksum validation utility
- `backend/src/lib/gst.ts` — GST calculation utilities (exclusive / inclusive / free)
- `backend/.env.example` — documented environment variables
- Prisma migration `001_init` generated

### Schema Changes
- **New tables (14):** `users`, `organizations`, `organization_members`,
  `organization_invites`, `accounts`, `contacts`, `bills`, `bill_line_items`,
  `invoices`, `invoice_line_items`, `payments_out`, `payments_in`,
  `journal_entries`, `journal_lines`

---

## [0.1.0] — 2026-11-01 — Phase 0: Repository Scaffold

### Added
- `AGENT_SPECIFICATION.md` — master system specification (pre-existing)
- `AGENTS.md` — root agent operating manual and constraints
- `docs/ARCHITECTURE.md` — GCP topology and service boundaries
- `docs/DATABASE_SCHEMA.md` — PostgreSQL tables, Prisma models, migration log
- `docs/SECURITY.md` — Auth flow, RBAC matrix, cryptographic standards
- `docs/DESIGN_SYSTEM.md` — Typography, color tokens, Tailwind config, table standards
- `docs/INTEGRATIONS.md` — Async webhook payloads and n8n job contracts
- `docs/STAGES_ROADMAP.md` — Stage 1–3 milestones and deferral log
- `docs/CHANGELOG.md` — this file

