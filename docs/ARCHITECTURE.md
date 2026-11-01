# Architecture

System topology, service boundaries, and GCP deployment layout for the
JBTDA-DWS ERP application.

---

## High-Level Topology

```text
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

---

## Service Boundaries

### The Unified Cloud Run Service (Frontend + Backend)
The application operates as a **Modular Monolith** running inside a single Docker container on Google Cloud Run. This eliminates cross-origin (CORS) complexity and ensures secure `SameSite=Strict` session cookies work natively.

#### Frontend (`/frontend`)
- **Type:** Static Single Page Application (SPA) compiled at build time.
- **Framework:** React 18/19, Vite, TypeScript, Tailwind CSS.
- **Component Library:** Radix UI / shadcn/ui patterns, Lucide React icons.
- **Code-splitting:** `React.lazy()` at module boundaries (Contacts, AP, AR, Ledger).
- **Delivery:** The compiled `dist/` folder is served directly by the Fastify backend from the root path (`GET /`).
- **Auth interaction:** Uses `@react-oauth/google` to get an ID token, POSTs it to the API, and relies entirely on the `HttpOnly` session cookie thereafter. All API calls use relative paths (e.g., `fetch('/api/v1/...')`).

#### Backend API (`/backend`)
- **Framework:** Fastify with TypeScript.
- **ORM:** Prisma with PostgreSQL client.
- **Routing Isolation:**
  - All REST API routes MUST be prefixed with `/api/v1/`.
  - `@fastify/static` serves the React frontend at `/`.
  - **SPA Fallback:** Any `GET` request not starting with `/api` returns `index.html` to allow React Router to handle client-side routing.
- **Stateless design:** No local session caches. Horizontally autoscales across Cloud Run replicas.
- **Connection pool ceiling:** `DATABASE_URL="...&connection_limit=7&pool_timeout=10"` prevents container autoscaling spikes from exhausting Cloud SQL connections.
- **Containerization:** Built via a multi-stage root `Dockerfile` that compiles the React app, compiles the TypeScript API, and packages both into a single unprivileged Node 20 runtime listening on `$PORT`.

### Database (Cloud SQL PostgreSQL)
- Managed PostgreSQL instance on GCP Cloud SQL.
- Connected to Cloud Run via Cloud SQL Auth Proxy Unix domain socket at:
  `/cloudsql/<PROJECT_ID>:<REGION>:<INSTANCE_NAME>`
- Instance Connection Name format: `<PROJECT_ID>:<REGION>:<INSTANCE_NAME>`
- Zero direct public exposure; private VPC connectivity in production.
- All schema changes managed exclusively through Prisma Migrate.

### Automation Engine (n8n)
- n8n instance running on a dedicated Cloud Run service.
- Triggered **only** via asynchronous Fastify webhooks.
- Authenticated with `X-Webhook-Secret` header (64-character pre-shared secret).
- Responsibilities: email dispatch, PDF generation, external API syncing.
- **Must never** be involved in: authentication, synchronous financial queries, or balance computations.

---

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
| `NODE_ENV` | `production` |

*(Note: `FRONTEND_ORIGIN` is no longer required as the frontend and backend share the exact same origin).*

### 3. Secrets Section (Cloud Run UI $\leftarrow$ Secret Manager)
| Secret in Secret Manager | Mounted as Environment Variable |
|--------------------------|---------------------------------|
| Database password | `DB_PASSWORD` |
| Random 32+ character string | `SESSION_SECRET` |
| 64-character webhook secret (Stage 2) | `WEBHOOK_SECRET` |