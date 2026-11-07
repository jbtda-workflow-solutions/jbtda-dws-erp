# Changelog

Chronological log of all changes, schema diffs, and new dependencies.

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
- `backend/src/server.ts` — Added `@fastify/static` plugin registration, multi-path asset resolution (`resolveFrontendDistPath()`), explicit `GET /` handler, and SPA client-side routing fallback handler (`index.html` fallback for non-API routes). Enhanced Content Security Policy (CSP) directives for Google Fonts, Google OAuth avatars, and inline styling.

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