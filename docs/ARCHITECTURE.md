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
- **Hosting:** Static assets deployed to GCP Cloud Storage + Cloud CDN or Firebase Hosting.
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
- **Containerization & Deployment:** Built via the root `Dockerfile` and deployed
  directly from Git to GCP Cloud Run. Runs Node 20 as an unprivileged user,
  executes `prisma generate`, compiles TypeScript, and listens on dynamic `${PORT:-8080}`.

### Database (Cloud SQL PostgreSQL)
- Managed PostgreSQL instance on GCP Cloud SQL.
- Connected to Cloud Run via Cloud SQL Auth Proxy Unix domain socket at:
  `/cloudsql/<PROJECT_ID>:<REGION>:<INSTANCE_NAME>`
- Instance Connection Name format: `<PROJECT_ID>:<REGION>:<INSTANCE_NAME>`
- Zero direct public exposure; private VPC connectivity in production.
- Connection pool ceiling: configured with `connection_limit=7&pool_timeout=10`
  to protect the database from container autoscaling spikes.
- All schema changes managed exclusively through Prisma Migrate.

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

## Configuration via Cloud Run Container Interface

The application reads its runtime configuration directly from the Google Cloud Run Container configuration (no `.env` files are used in production):

### 1. Cloud SQL Connections Section (Cloud Run UI)
- Select the target Cloud SQL PostgreSQL instance (`PROJECT_ID:REGION:INSTANCE_NAME`).
- Cloud Run automatically mounts the Unix domain socket into the container at `/cloudsql/<instance>`.
- The backend application automatically discovers this mounted socket from `/cloudsql` without requiring manual path entry.

### 2. Environment Variables Section (Cloud Run UI)
| Variable | Description / Value |
|----------|---------------------|
| `DB_USER` | Database username (e.g. `postgres`) |
| `DB_NAME` | Database name on the Cloud SQL instance |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Web Client ID for authentication |
| `FRONTEND_ORIGIN` | Allowed origin for CORS (e.g. `http://localhost:5173` or production frontend URL) |
| `NODE_ENV` | `production` |

### 3. Secrets Section (Cloud Run UI $\leftarrow$ Secret Manager)
| Secret in Secret Manager | Mounted as Environment Variable |
|--------------------------|---------------------------------|
| Database password | `DB_PASSWORD` |
| Random 32+ character string | `SESSION_SECRET` |
| 64-character webhook secret (Stage 2) | `WEBHOOK_SECRET` |

