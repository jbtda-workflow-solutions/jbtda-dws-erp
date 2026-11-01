# Architecture

System topology, service boundaries, and GCP deployment layout for the
JBTDA-DWS ERP application.

---

## High-Level Topology

```
                          ┌────────────────────────────────────────┐
                          │      GCP Cloud Storage + Cloud CDN     │
                          │         (or Firebase Hosting)          │
                          │       Static React SPA (Vite/TS)       │
                          └───────────────────┬────────────────────┘
                                             │ HTTPS (REST / JSON)
                                             ▼
                          ┌────────────────────────────────────────┐
                          │         GCP Cloud Run Service          │
                          │       Fastify + TypeScript + Prisma    │
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

---

## Service Boundaries

### Frontend (`/frontend`)
- **Type:** Static Single Page Application
- **Framework:** React 18/19, Vite, TypeScript, Tailwind CSS
- **Component Library:** Radix UI / shadcn/ui patterns, Lucide React icons
- **Code-splitting:** `React.lazy()` at module boundaries (Contacts, AP, AR, Ledger)
- **Hosting / Deployment:** Built via multi-stage Dockerfile (Nginx unprivileged on Cloud Run)
  or hosted on GCP Cloud Storage + Cloud CDN / Firebase Hosting.
- **Auth interaction:** Receives Google OIDC ID token via `@react-oauth/google`,
  posts it to the backend, then relies entirely on the HttpOnly session cookie.

### Backend API (`/backend`)
- **Type:** Core Modular Monolith
- **Framework:** Fastify with TypeScript
- **ORM:** Prisma with PostgreSQL client
- **Stateless design:** No local session caches. Horizontally autoscales across
  Cloud Run replicas.
- **Connection pool ceiling:**
  ```
  DATABASE_URL="postgresql://user:pass@host/db?connection_limit=7&pool_timeout=10"
  ```
  Prevents multiple Cloud Run containers from exhausting Cloud SQL connections.
- **Route prefix:** All API routes are prefixed `/api/v1/`
- **Containerization & Deployment:** Built via multi-stage Dockerfile and deployed
  directly from Git to GCP Cloud Run. Runs on Node 20 as an unprivileged user,
  executes `prisma generate`, compiles TypeScript, and listens on `${PORT:-8080}`.

### Database (Cloud SQL PostgreSQL)
- Managed PostgreSQL instance on GCP Cloud SQL
- Connected via Cloud SQL Auth Proxy (no direct public exposure)
- Private VPC connectivity in production
- All schema changes managed exclusively through Prisma Migrate

### Automation Engine (n8n)
- n8n instance running on a dedicated Cloud Run service
- Triggered **only** via asynchronous Fastify webhooks
- Authenticated with `X-Webhook-Secret` header (64-character pre-shared secret)
- Responsibilities: email dispatch, PDF generation, external API syncing
- **Must never** be involved in: authentication, synchronous financial queries,
  or balance computations

---

## API Versioning

All routes live under `/api/v1/`. Future breaking changes increment to `/api/v2/`.

## Environment Variables (Backend)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (with pool params) |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID for token verification |
| `SESSION_SECRET` | ≥ 32-byte secret for cookie signing |
| `SESSION_ENCRYPTION_KEY` | 32-byte key for cookie encryption |
| `WEBHOOK_SECRET` | 64-char pre-shared secret for n8n webhooks |
| `N8N_WEBHOOK_BASE_URL` | Base URL of the n8n Cloud Run service |
| `NODE_ENV` | `development` / `production` |
| `PORT` | Fastify listen port (default `8080` on Cloud Run) |

