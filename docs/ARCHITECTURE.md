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

The application reads its runtime configuration directly from the Google Cloud Run Container configuration (zero `.env` files are used in production).
Every variable and secret must be explicitly defined. **No configuration values may be left empty or omitted.**

### 1. Cloud SQL Connections Section (Cloud Run UI)
- Select the target Cloud SQL PostgreSQL instance (`PROJECT_ID:REGION:INSTANCE_NAME`).
- Cloud Run automatically mounts the Unix domain socket into the container at `/cloudsql/<INSTANCE_CONNECTION_NAME>`.
- The backend application automatically discovers this mounted socket from `/cloudsql/<INSTANCE_CONNECTION_NAME>`.

### 2. Environment Variables Section (Cloud Run UI)
| Variable | Source | Required / Default | Permitted Values | Failure Behavior | Description / Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `INSTANCE_CONNECTION_NAME` | Cloud Run Env | Required in Cloud Run | Format: `PROJECT:REGION:INSTANCE` (non-empty string) | If missing or invalid, Unix socket `/cloudsql/<INSTANCE>` is not found; database connection fails with error log | Cloud SQL instance connection name (`PROJECT_ID:REGION:INSTANCE_NAME`). Points database client explicitly to mounted socket at `/cloudsql/<INSTANCE_CONNECTION_NAME>`. Essential for multi-tenant isolation and portable client forks. |
| `GOOGLE_CLIENT_ID` | Cloud Run Env | Required | Non-empty Google OAuth Client ID string ending in `.apps.googleusercontent.com` | Google token verification rejects all tokens with `401 Unauthorized`; `/api/v1/auth/config` returns empty ID | Google OAuth 2.0 Web Client ID for authentication (used for token verification & served to frontend via `/api/v1/auth/config`). |
| `DB_USER` | Cloud Run Env | Required | Non-empty string (e.g. `erp_admin`) | Prisma connection throws PostgreSQL authentication error; `/healthz` returns `503 Service Unavailable` | Database username on the Cloud SQL PostgreSQL instance. |
| `DB_NAME` | Cloud Run Env | Required | Non-empty string (e.g. `erp`) | Prisma connection fails (database does not exist); `/healthz` returns `503 Service Unavailable` | Database name on the Cloud SQL instance. |
| `FRONTEND_ORIGIN` | Cloud Run Env | Required if cross-origin | Valid URL string or comma-separated list of URLs (e.g. `https://erp.domain1.com,https://erp.domain2.com`) | CORS preflight checks reject cross-origin requests from unlisted origins | Allowed origin(s) for CORS in development/preview or multi-origin cross-domain environments. In unified production, frontend and API share the exact same origin. |
| `NODE_ENV` | Cloud Run Env | Required | `"production"` \| `"development"` | Defaults to development logging; cookie `Secure` flag may not be strictly enforced | Runtime environment mode. Must be set to `"production"` on Cloud Run. |
| `AUTO_SCHEMA_PUSH` | Cloud Run Env | Required | `"true"` \| `"false"` (must be explicit) | Server throws error and aborts startup if missing, empty, or not strictly `"true"` or `"false"` | Mandatory explicit flag: `"true"` in development/testing to run automatic `prisma db push --skip-generate --accept-data-loss` on container boot. Set to `"false"` in production. |
| `DB_FORCE_RESET` | Cloud Run Env | Required | `"true"` \| `"false"` (must be explicit) | Server throws error and aborts startup if missing, empty, or not strictly `"true"` or `"false"` | Mandatory explicit flag: `"true"` alongside `AUTO_SCHEMA_PUSH="true"` to completely drop and recreate all tables on boot. Set to `"false"` for standard operations. |
| `PORT` | Cloud Run Env | Optional (Default: `8080`) | Numeric integer string (e.g. `"8080"`) | Container fails Cloud Run health check if not listening on the port Cloud Run expects | Port Fastify binds to. Automatically injected by Cloud Run. |
| `HOST` | Cloud Run Env | Optional (Default: `"0.0.0.0"`) | IP string (e.g. `"0.0.0.0"`) | Binding to `127.0.0.1` causes container to be unreachable from outside | Host interface Fastify binds to. |
| `FRONTEND_DIST_PATH` | Cloud Run Env | Optional (Default: auto-discovery) | Valid directory path containing `index.html` (e.g. `"/app/frontend/dist"`) | Fastify logs warning and serves API-only fallback HTML page on root; SPA routes return 404 | Custom filesystem path for compiled frontend SPA assets. |

### 3. Secrets Section (Cloud Run UI $\leftarrow$ Secret Manager)
| Secret in Secret Manager | Mounted Variable | Required | Permitted Values | Failure Behavior | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Database user password (e.g. `user_erp_admin_pass...`) | `DB_PASSWORD` | Required | Non-empty string | Prisma connection throws PostgreSQL authentication error; `/healthz` returns `503` | PostgreSQL database user password. |
| Cookie session secret (e.g. `erp_session_secret`) | `SESSION_SECRET` | Required | Cryptographically random string $\ge 32$ characters | Unsigned session cookies cannot be parsed or verified; auth fails | Secret key used for signing and encrypting `erp_session` HttpOnly cookies. |
| Webhook secret (Stage 2) (e.g. `erp_webhook_secret`) | `WEBHOOK_SECRET` | Required for automations | Cryptographically random hex string of 64 characters | Outbound n8n webhook dispatches fail signature verification | 64-character webhook secret transmitted in `X-Webhook-Secret` header for n8n automations. |

---

## Master Monolith Entrypoint Directory

Per **AGENTS.md Rule 14 (Zero-Ambiguity Entrypoint & Configuration Documentation Protocol)**, all network entrypoints, access paths, API routes, infrastructure probes, and client routes are explicitly cataloged below. No entrypoints or behaviors are implied.

### 1. Infrastructure & System Probes
| Verb | Exact Path | Auth Required | Purpose / Behavior | Response / Status |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/healthz` | No (Public) | Cloud Run liveness and readiness probe. Executes `SELECT 1` on PostgreSQL via Prisma. | `200 OK` `{ status: "ok", database: "connected" }`<br>`503 Service Unavailable` `{ status: "error", database: "unreachable" }` |
| `GET` | `/` | No (Public) | Root application entrypoint. Serves compiled React `index.html` via `@fastify/static`. | `200 OK` (HTML) |
| `GET` | `/*` (non-`/api`) | No (Public) | SPA client-side routing fallback handler. Any non-API route serves `index.html` so React Router handles client routes. | `200 OK` (HTML) |
| `ALL` | `/api/*` (unmatched) | N/A | API route 404 handler. Unmatched `/api/v1/*` routes return structured JSON error instead of HTML. | `404 Not Found` `{ statusCode: 404, error: "Not Found", message: "..." }` |

### 2. Authentication & Session API (`/api/v1/auth/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/auth/config` | No (Public) | Public | Serves `{ googleClientId: string }` so frontend initializes Google Identity Services without baked-in secrets. |
| `POST` | `/api/v1/auth/google` | No (Public) | Public | Verifies Google OIDC `idToken`. Upserts user, checks memberships/invites, issues signed `erp_session` cookie. |
| `GET` | `/api/v1/auth/me` | Cookie Session | Authenticated | Verifies session cookie. Returns active user profile, current organization, and active role. |
| `POST` | `/api/v1/auth/switch-organization` | Cookie Session | Authenticated | Validates membership in target organization; reissues session cookie with updated `organizationId` and `role`. |
| `DELETE` | `/api/v1/auth/logout` | Cookie Session | Authenticated | Clears `erp_session` cookie. |

### 3. Organizations & Governance API (`/api/v1/organizations/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/organizations` | Cookie Session | Authenticated | Lists all organizations the authenticated user belongs to. |
| `POST` | `/api/v1/organizations` | Cookie Session | Authenticated | Creates new organization, assigns creator as `ADMIN`, seeds 10 protected system GL accounts. |
| `GET` | `/api/v1/organizations/current` | Cookie Session | All Roles | Returns active organization profile, financial settings, lock dates, and EFT details. |
| `PATCH` | `/api/v1/organizations/current` | Cookie Session | `ADMIN` | Updates organization profile, lock dates, EFT banking, and two-person approval enforcement. Logs audit event. |
| `GET` | `/api/v1/organizations/current/members` | Cookie Session | All Roles | Lists active members of current organization. |
| `PATCH` | `/api/v1/organizations/current/members/:id` | Cookie Session | `ADMIN` | Updates member's assigned role. Logs audit event. |
| `DELETE` | `/api/v1/organizations/current/members/:id` | Cookie Session | `ADMIN` | Removes member from organization. Prevents removing last admin. Logs audit event. |
| `POST` | `/api/v1/organizations/current/invites` | Cookie Session | `ADMIN` | Creates email invitation with assigned role. |
| `GET` | `/api/v1/organizations/current/audit-logs` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Paginated query of immutable system audit trail with user and entity filters. |

### 4. Chart of Accounts & Tracking Dimensions API (`/api/v1/accounts`, `/api/v1/tracking-categories`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/accounts` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Lists active and archived GL accounts. |
| `POST` | `/api/v1/accounts` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Creates custom GL account or sub-account. Validates unique code. |
| `PATCH` | `/api/v1/accounts/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Updates account name, description, or archived status. Protects 10 system accounts and zero-balance decommissioning rules. |
| `POST` | `/api/v1/accounts/seed-system` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Idempotently verifies and seeds missing system accounts. |
| `GET` | `/api/v1/tracking-categories` | Cookie Session | All Roles | Lists tracking categories and their options. |
| `POST` | `/api/v1/tracking-categories` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Creates tracking category (Cost Center, Department, Project) and options. |

### 5. Contacts API (`/api/v1/contacts/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/contacts` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST`, `AP_SPECIALIST`, `MANAGER`, `AUDITOR` | Lists contacts with type filters (`CUSTOMER`, `VENDOR`, `EMPLOYEE`). |
| `POST` | `/api/v1/contacts` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` (Cust), `AP_SPECIALIST` (Vend) | Creates contact. Validates Australian ABN checksum algorithm. |
| `GET` | `/api/v1/contacts/:id` | Cookie Session | Read Roles | Fetches contact details, banking BSB/account, and default accounts. |
| `PATCH` | `/api/v1/contacts/:id` | Cookie Session | Write Roles | Updates contact details. Validates ABN if changed. |
| `DELETE` | `/api/v1/contacts/:id` | Cookie Session | `ADMIN` | Permanently deletes a contact with zero linked financial transactions; advises deactivation if historical transactions exist. |
| `GET` | `/api/v1/contacts/:id/360` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Returns 360-degree customer/vendor ledger history, outstanding balances, and open documents. |

### 6. Items / Products & Services Catalog API (`/api/v1/items/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/items` | Cookie Session | All Roles | Lists catalog items with unit prices in integer cents. |
| `POST` | `/api/v1/items` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Creates catalog item with sales/purchase accounts and tax rates. |
| `PATCH` | `/api/v1/items/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Updates catalog item details or pricing. |
| `DELETE` | `/api/v1/items/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Archives or removes catalog item if unreferenced. |

### 7. Customer Invoices & Accounts Receivable API (`/api/v1/invoices/*`, `/api/v1/payments-in`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/invoices` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST`, `MANAGER`, `AUDITOR` | Lists customer invoices with status filters. |
| `POST` | `/api/v1/invoices` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Creates draft customer invoice with line items. |
| `GET` | `/api/v1/invoices/:id` | Cookie Session | Read Roles | Returns invoice details, lines, tax calculations, and payments. |
| `PATCH` | `/api/v1/invoices/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Updates draft/pending invoice, or edits & re-posts an unpaid `ISSUED` invoice (`ADMIN`/`ACCOUNTANT`), atomically synchronizing the active `INVOICE` GL journal. |
| `DELETE` | `/api/v1/invoices/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Deletes a `DRAFT`/`PENDING_APPROVAL` invoice, or allows `ADMIN` Force-Delete on unpaid/void invoices (reversing any posted GL journal). |
| `POST` | `/api/v1/invoices/:id/issue` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Issues invoice: generates sequential invoice number, posts double-entry AR journal (Debit A/R, Credit Sales, Credit GST Collected). |
| `POST` | `/api/v1/invoices/:id/revert-to-draft` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Reverts an unpaid `ISSUED` or `PENDING_APPROVAL` invoice back to `DRAFT` and reverses its active GL journal. |
| `POST` | `/api/v1/invoices/:id/void` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Voids an unpaid invoice (`status = VOID`) and reverses its posted GL journal. |
| `POST` | `/api/v1/invoices/:id/payments` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Records incoming customer payment against invoice. Posts GL entry (Debit Bank, Credit A/R). |
| `DELETE` | `/api/v1/invoices/:id/payments/:paymentId` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Reverses and deletes a customer payment receipt, reverses its `PAYMENT_IN` GL journal, and restores the invoice balance/status. |
| `POST` | `/api/v1/payments-in` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Batch payment receipt allocating funds across multiple invoices. |
| `GET` | `/api/v1/invoices/recurring` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Lists recurring invoice schedules. |
| `POST` | `/api/v1/invoices/recurring` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Creates recurring invoice schedule. |
| `PATCH` | `/api/v1/invoices/recurring/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Updates recurring invoice schedule frequency and next run date. |
| `DELETE` | `/api/v1/invoices/recurring/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Cancels recurring invoice schedule. |

### 8. Vendor Bills & Accounts Payable API (`/api/v1/bills/*`, `/api/v1/payments-out`, `/api/v1/recurring-bills/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/bills` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST`, `MANAGER`, `AUDITOR` | Lists vendor bills with status filters. |
| `POST` | `/api/v1/bills` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Creates draft or submitted vendor bill with line items. |
| `GET` | `/api/v1/bills/:id` | Cookie Session | Read Roles | Returns bill details, line items, and allocated payments. |
| `PATCH` | `/api/v1/bills/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Updates draft/pending bill, or edits & re-posts an unpaid `AWAITING_PAYMENT` bill (`ADMIN`/`ACCOUNTANT`), atomically synchronizing the active `BILL` GL journal. |
| `DELETE` | `/api/v1/bills/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Deletes a `DRAFT`/`PENDING_APPROVAL` bill, or allows `ADMIN` Force-Delete on unpaid/void bills (reversing any posted GL journal). |
| `POST` | `/api/v1/bills/:id/approve` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Approves bill: posts double-entry AP journal (Debit Expense, Debit GST Paid, Credit A/P). |
| `POST` | `/api/v1/bills/:id/revert-to-draft` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Reverts an unpaid `AWAITING_PAYMENT` or `PENDING_APPROVAL` bill back to `DRAFT` and reverses its active GL journal. |
| `POST` | `/api/v1/bills/:id/void` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Voids an unpaid bill (`status = VOID`) and reverses its posted GL journal. |
| `POST` | `/api/v1/bills/:id/payments` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` (Draft) | Records payment out against bill. Posts GL entry (Debit A/P, Credit Bank). |
| `GET` | `/api/v1/bills/:id/payments` | Cookie Session | Read Roles | Lists payments allocated to this bill. |
| `DELETE` | `/api/v1/bills/:id/payments/:paymentId` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Reverses and deletes a supplier payment, reverses its `PAYMENT_OUT` GL journal, and restores the bill balance/status. |
| `POST` | `/api/v1/payments-out` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Direct payment-out batch allocation across bills. |
| `GET` | `/api/v1/recurring-bills` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Lists recurring bill schedules. |
| `POST` | `/api/v1/recurring-bills` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Creates recurring bill schedule. |
| `PATCH` | `/api/v1/recurring-bills/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Updates recurring bill schedule. |
| `DELETE` | `/api/v1/recurring-bills/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Cancels recurring bill schedule. |
| `POST` | `/api/v1/recurring-bills/:id/run` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Manually triggers immediate execution of recurring bill schedule. |

### 9. Sales Quotes API (`/api/v1/quotes/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/quotes` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST`, `MANAGER`, `AUDITOR` | Lists sales quotes. |
| `POST` | `/api/v1/quotes` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Creates draft quote. |
| `GET` | `/api/v1/quotes/:id` | Cookie Session | Read Roles | Fetches quote details and lines. |
| `PATCH` | `/api/v1/quotes/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Updates draft quote. |
| `DELETE` | `/api/v1/quotes/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Deletes non-invoiced sales quote. |
| `POST` | `/api/v1/quotes/:id/convert-to-invoice` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Converts approved quote into draft customer invoice. |

### 10. Purchase Orders API (`/api/v1/purchase-orders/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/purchase-orders` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST`, `MANAGER`, `AUDITOR` | Lists purchase orders. |
| `POST` | `/api/v1/purchase-orders` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Creates draft purchase order. |
| `GET` | `/api/v1/purchase-orders/:id` | Cookie Session | Read Roles | Fetches PO details and lines. |
| `PATCH` | `/api/v1/purchase-orders/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Updates draft PO. |
| `DELETE` | `/api/v1/purchase-orders/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Deletes non-billed purchase order. |
| `POST` | `/api/v1/purchase-orders/:id/approve` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER` | Approves PO. Validates two-person rule if enabled. |
| `POST` | `/api/v1/purchase-orders/:id/convert-to-bill` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Converts approved PO into draft vendor bill. |

### 11. Customer Credit Notes API (`/api/v1/credit-notes/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/credit-notes` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST`, `AUDITOR` | Lists customer credit notes. |
| `POST` | `/api/v1/credit-notes` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Creates draft credit note. |
| `GET` | `/api/v1/credit-notes/:id` | Cookie Session | Read Roles | Fetches credit note details and line items. |
| `POST` | `/api/v1/credit-notes/:id/issue` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Issues credit note: posts contra-AR journal (Debit Sales, Debit GST Collected, Credit A/R). |
| `POST` | `/api/v1/credit-notes/:id/allocate` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Allocates credit note against open customer invoice. |
| `POST` | `/api/v1/credit-notes/:id/refund` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Records direct cash refund against credit note. |
| `POST` | `/api/v1/credit-notes/:id/void` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Voids an unallocated customer credit note and reverses its contra-AR GL journal. |
| `DELETE` | `/api/v1/credit-notes/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Deletes a draft credit note or allows `ADMIN` Force-Delete on unallocated credit notes. |

### 12. Vendor Credits API (`/api/v1/vendor-credits/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/vendor-credits` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST`, `AUDITOR` | Lists vendor credits. |
| `POST` | `/api/v1/vendor-credits` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Creates draft vendor credit. |
| `GET` | `/api/v1/vendor-credits/:id` | Cookie Session | Read Roles | Fetches vendor credit details and lines. |
| `POST` | `/api/v1/vendor-credits/:id/issue` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Issues vendor credit: posts contra-AP journal (Debit A/P, Credit Expense, Credit GST Paid). |
| `POST` | `/api/v1/vendor-credits/:id/allocate` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Allocates vendor credit against open vendor bill. |
| `POST` | `/api/v1/vendor-credits/:id/refund` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Records direct cash refund from vendor. |
| `POST` | `/api/v1/vendor-credits/:id/void` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Voids an unallocated vendor credit and reverses its contra-AP GL journal. |
| `DELETE` | `/api/v1/vendor-credits/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Deletes a draft vendor credit or allows `ADMIN` Force-Delete on unallocated vendor credits. |

### 13. Batch Payments & Australian ABA Export API (`/api/v1/batch-payments/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/batch-payments` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Lists batch payment runs. |
| `POST` | `/api/v1/batch-payments` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Groups multiple approved bills and/or employee reimbursement claims into a batch payment. Creates payment records, updates claims to `PAID`, and posts consolidated GL entry (`DEBIT 2000 A/P` + `DEBIT 2050 Reimbursements Payable`, `CREDIT Bank`). |
| `GET` | `/api/v1/batch-payments/:id/aba` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Generates and downloads Australian APCA CEMTEX 120-character `.ABA` payment file. |

### 14. Direct Transactions API (`/api/v1/direct-transactions/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/direct-transactions` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST`, `AUDITOR` | Lists direct spend money / receive money transactions with bank account, contact, date, and search filters. |
| `POST` | `/api/v1/direct-transactions` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Records immediate bank/card spend or receive transaction. Calculates Australian GST, validates accounting period lock date, and atomically posts double-entry General Ledger journal (`DEBIT Expense/Asset`, `DEBIT 2200 GST Paid`, `CREDIT Bank/Card Account`). |
| `GET` | `/api/v1/direct-transactions/:id` | Cookie Session | Read Roles | Fetches direct transaction details, multi-line account distributions, and associated posted GL journal. |
| `PATCH` | `/api/v1/direct-transactions/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Updates a direct spend/receive transaction and atomically synchronizes its active `DIRECT_TRANSACTION` GL journal. |
| `DELETE` | `/api/v1/direct-transactions/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Deletes a direct spend/receive transaction and reverses its posted `DIRECT_TRANSACTION` GL journal. |

### 15. Employee Expense Claims & Reimbursements API (`/api/v1/expense-claims/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/expense-claims` | Cookie Session | All Roles (Scoped) | Lists expense claims. `EMPLOYEE` is strictly isolated to own claims (`scope=my`); `MANAGER` accesses team claims (`scope=team`); `ADMIN`/`ACCOUNTANT` access all organizational claims. |
| `POST` | `/api/v1/expense-claims` | Cookie Session | All Roles | Creates draft or submitted out-of-pocket expense claim with multi-line merchant receipts, account allocations, GST, and tracking categories. |
| `GET` | `/api/v1/expense-claims/:id` | Cookie Session | All Roles (Scoped) | Fetches expense claim details, receipts, approval timestamps, and attached GL journal entries. |
| `PATCH` | `/api/v1/expense-claims/:id` | Cookie Session | Claimant / Finance | Updates draft/rejected expense claim, or allows `ADMIN`/`ACCOUNTANT` to edit an unpaid `APPROVED` claim and synchronize its `EXPENSE_CLAIM` GL journal. |
| `DELETE` | `/api/v1/expense-claims/:id` | Cookie Session | Claimant / Finance | Deletes draft/rejected expense claim, or allows `ADMIN` Force-Delete on unpaid claims (reversing any posted GL journal). |
| `POST` | `/api/v1/expense-claims/:id/submit` | Cookie Session | Claimant / Finance | Submits draft claim for manager approval (`DRAFT` $\rightarrow$ `SUBMITTED`). |
| `POST` | `/api/v1/expense-claims/:id/approve` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER` | Approves claim. Enforces maker-checker rule when two-person approval is enabled. Posts GL journal (`DEBIT Expense`, `DEBIT 2200 GST Paid`, `CREDIT 2050 Employee Reimbursements Payable`). |
| `POST` | `/api/v1/expense-claims/:id/reject` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER` | Rejects claim with mandatory reason guidance (`SUBMITTED` $\rightarrow$ `REJECTED`). |
| `POST` | `/api/v1/expense-claims/:id/void` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Reverts an unpaid `APPROVED` or `SUBMITTED` claim back to `DRAFT` and reverses its `EXPENSE_CLAIM` GL journal. |
| `POST` | `/api/v1/expense-claims/:id/pay` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Settles approved claim via direct payment: posts settlement GL entry (`DEBIT 2050 Employee Reimbursements Payable`, `CREDIT Bank Account`) and marks claim `PAID`. |
| `POST` | `/api/v1/expense-claims/:id/reverse-payment` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Reverses the reimbursement payout on a `PAID` claim, reverses the `EXPENSE_REIMBURSEMENT` GL journal, and restores the claim to `APPROVED`. |

### 16. General Ledger & Financial Reporting API (`/api/v1/ledger/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/ledger` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Lists journal entries with account, date range, and reference type filters. |
| `GET` | `/api/v1/ledger/accounts` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Computes live debit/credit account balances. |
| `POST` | `/api/v1/ledger/entries` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Posts manual double-entry journal entry. Validates debits === credits in integer cents and lock dates. |
| `PATCH` | `/api/v1/ledger/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Edits a `DRAFT`/`PENDING_APPROVAL` journal or updates narrative/lines on an unreconciled `MANUAL` journal. |
| `DELETE` | `/api/v1/ledger/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Deletes a `DRAFT`/`PENDING_APPROVAL` journal, or allows `ADMIN` Force-Delete on unreconciled journals. |
| `POST` | `/api/v1/ledger/:id/approve` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Approves draft journal entry. Validates two-person rule if enabled. |
| `POST` | `/api/v1/ledger/:id/reverse` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Creates atomic contra-reversing journal entry (`REV-xxxx`), marks both original and contra entries `REVERSED`, blocks double-reversal, and bidirectionally cascades void/reversal to the source sub-ledger record. |
| `GET` | `/api/v1/ledger/trial-balance` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Generates Trial Balance financial statement. |
| `GET` | `/api/v1/ledger/profit-loss` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Generates Profit & Loss financial statement. |
| `GET` | `/api/v1/ledger/balance-sheet` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Generates Balance Sheet financial statement. |

### 17. Multi-Account Banking & Statement Reconciliation API (`/api/v1/banking/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/banking/accounts` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER`, `AUDITOR`, `AP_SPECIALIST`, `AR_SPECIALIST` | Lists all GL accounts flagged as bank/card accounts with live computed ledger balance, unreconciled lines count, statement count, and last statement date. |
| `PATCH` | `/api/v1/banking/accounts/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Updates bank account status (`isBankAccount`) and banking details (`bankBsb`, `bankAccountNumber`, `apcaUserId`). |
| `GET` | `/api/v1/banking/transfers` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER`, `AUDITOR` | Lists inter-account transfers with source/destination account names and transaction amounts. |
| `POST` | `/api/v1/banking/transfers` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER` | Records inter-account transfer and atomically posts clean 2-line double-entry GL journal (`DEBIT Destination Account`, `CREDIT Source Account`). |
| `DELETE` | `/api/v1/banking/transfers/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Reverses and deletes an inter-account transfer and reverses its linked `BANK_TRANSFER` GL journal. |
| `POST` | `/api/v1/banking/statements/import` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Two-step CSV bank statement parser (`dryRun: true` Validate & Preview vs. Commit). Accepts optional `Contact/Supplier/Merchant`, `Account/GL Code`, `Cost Centre/Tracking Option`, and `Tax Treatment` columns strictly validated against existing organization records. |
| `GET` | `/api/v1/banking/statements` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Lists imported bank statement lines enriched with pre-validated `suggestedContact`, `suggestedAccount`, and `suggestedTrackingOption` coding hints. |
| `DELETE` | `/api/v1/banking/statements/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Deletes an unreconciled statement line (reconciled lines protected against deletion). |
| `GET` | `/api/v1/banking/reconciliation/suggestions` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Computes smart match candidates between unreconciled statement lines and General Ledger transactions based on exact/opposite amount matching and date proximity scoring. |
| `POST` | `/api/v1/banking/reconciliation/match` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Matches a bank statement line with a GL journal entry, updating `isReconciled: true` and `reconciledAt` timestamp. |
| `POST` | `/api/v1/banking/reconciliation/unmatch` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Reverses an existing match, restoring both statement line and GL journal entry to unreconciled status. |
| `POST` | `/api/v1/banking/reconciliation/create-and-reconcile` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Multi-mode contact-linked reconciliation (`DIRECT_EXPENSE`, `ALLOCATE_BILL`, `CREATE_AND_PAY_BILL`, `DIRECT_INCOME`, `ALLOCATE_INVOICE`, `CREATE_AND_PAY_INVOICE`): creates and links `DirectTransaction`, `Bill`/`PaymentOut`, or `Invoice`/`PaymentIn` records to `Contact`, posts the double-entry GL journal, and reconciles the statement line. |

### 18. Financial Statements & Australian BAS Engine API (`/api/v1/reports/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/reports/trial-balance` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER`, `AUDITOR` | Point-in-time Trial Balance verifying total debits equal total credits across all active accounts. Supports `?asOfDate=YYYY-MM-DD`. |
| `GET` | `/api/v1/reports/profit-and-loss` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER`, `AUDITOR` | Multi-tiered Profit & Loss (Revenue, COGS, Gross Profit, Operating Expenses, Operating Profit) over date range with optional Tracking Dimension filtering (`?startDate=&endDate=&trackingOptionId=`). |
| `GET` | `/api/v1/reports/balance-sheet` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER`, `AUDITOR` | Point-in-time Balance Sheet grouping Assets, Liabilities, and Equity with dynamically calculated Current Year Unappropriated Earnings, mathematically proving Assets == Liabilities + Equity. |
| `GET` | `/api/v1/reports/aged-receivables` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER`, `AR_SPECIALIST`, `AUDITOR` | Aged Receivables breakdown bucketed into Current, 1-30, 31-60, 61-90, and 90+ days overdue, aggregated by customer contact with outstanding invoice schedules. |
| `GET` | `/api/v1/reports/aged-payables` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER`, `AP_SPECIALIST`, `AUDITOR` | Aged Payables breakdown bucketed into Current, 1-30, 31-60, 61-90, and 90+ days overdue, aggregated by supplier contact with outstanding bill schedules. |
| `GET` | `/api/v1/reports/bas` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `MANAGER`, `AUDITOR` | Computes official Australian Taxation Office (ATO) Business Activity Statement GST worksheet boxes: G1 Total Sales, G2/G3 Export/GST-Free Sales, G10 Capital Purchases, G11 Non-Capital Purchases, 1A GST on Sales, 1B GST on Purchases, and Net GST Settlement (Payable/Refundable). |
| `POST` | `/api/v1/reports/bas/lock` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Locks accounting period up to specified BAS end date (`lockDate`), freezing the General Ledger and preventing any retrospective transactions, modifications, or approvals. |

### 19. Executive Live Dashboard API (`/api/v1/dashboard/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/dashboard/summary` | Cookie Session | All Authenticated Roles | Computes 100% real-time financial intelligence: liquid cash position across bank accounts, AR & AP totals and aging brackets, actionable pending approvals queue (bills, POs, claims, journals), MTD and YTD P&L performance, and recent audit activity feed. |

### 20. Developer & Agent Context Console API (`/api/v1/developer/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/developer/docs` | Cookie Session | `ADMIN` | Returns the strictly allowlisted index of repository governance and technical Markdown documentation (`AGENTS.md`, `AGENT_SPECIFICATION.md`, `docs/*.md`) with file size, line count, category, and modification metadata. Zero arbitrary directory traversal. |
| `GET` | `/api/v1/developer/docs/content` | Cookie Session | `ADMIN` | Returns raw Markdown content and metadata for a whitelisted documentation key (`?path=AGENTS.md` or `?path=docs/ARCHITECTURE.md`). Rejects any unindexed path with `404 Not Found`. |
| `GET` | `/api/v1/developer/roadmap-summary` | Cookie Session | `ADMIN` | Deterministically parses `docs/STAGES_ROADMAP.md` into structured module progress metrics and completed/pending checklist gates. |
| `GET` | `/api/v1/developer/api-catalog` | Cookie Session | `ADMIN` | Deterministically parses `docs/ARCHITECTURE.md` (`Master Monolith Entrypoint Directory`) into structured domain groups, HTTP verbs, paths, auth requirements, RBAC scopes, and endpoint descriptions. |
| `GET` | `/api/v1/developer/diagnostics` | Cookie Session | `ADMIN` | Returns safe, non-secret container runtime telemetry, `SELECT 1` PostgreSQL latency, multi-tenant entity counts (`where: { organizationId }`), active workspace governance flags, and boolean-only secret presence checks (strictly redacting `DB_PASSWORD`, `SESSION_SECRET`, and `WEBHOOK_SECRET` values). |

### 21. Centralized Admin Bulk CSV Import API (`/api/v1/bulk-import/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/bulk-import/templates` | Cookie Session | `ADMIN` | Returns schema definitions, required vs. optional column rules, multi-line grouping keys, and downloadable sample `.CSV` templates for all 13 supported ERP record types (`CONTACTS`, `ITEMS`, `ACCOUNTS`, `TRACKING_OPTIONS`, `INVOICES`, `QUOTES`, `CREDIT_NOTES`, `BILLS`, `PURCHASE_ORDERS`, `VENDOR_CREDITS`, `DIRECT_TRANSACTIONS`, `EXPENSE_CLAIMS`, `JOURNAL_ENTRIES`). |
| `POST` | `/api/v1/bulk-import/validate` | Cookie Session | `ADMIN` | Step 1 Validate & Preview: Parses CSV rows for the selected `entityType`, groups multi-line documents by reference number, strictly validates foreign keys against existing organization Contacts, Accounts, Items, Tracking Options, and Lock Dates, and returns row/document validation previews without mutating the database. |
| `POST` | `/api/v1/bulk-import/commit` | Cookie Session | `ADMIN` | Step 2 Commit: Atomically persists all validated records/documents inside a Prisma transaction, executing full `LedgerPostingService` double-entry GL postings for any documents flagged as `ISSUED`, `AWAITING_PAYMENT`, `APPROVED`, or `POSTED`, and appends an immutable `AuditLog` summary. |

### 22. Frontend Client Routes (`frontend/src/App.tsx`)
| Client Route | Guard Status | Rendered Component | Purpose / Description |
| :--- | :--- | :--- | :--- |
| `/` | Authenticated | `<DashboardPage />` | Executive dashboard overview, live working capital metrics, actionable approvals banner, and financial KPIs. |
| `/` | Unauthenticated | `<LoginPage />` | Google OAuth 2.0 Sign-In page. |
| `/` | Onboarding | `<OnboardingModal />` | First-time organization creation modal with ABN verification. |
| `/contacts` | Authenticated | `<ContactsPage />` | Contacts directory workbench (Customers, Vendors, Employees). |
| `/items` | Authenticated | `<ItemsPage />` | Products & Services catalog workbench. |
| `/invoices` | Authenticated | `<InvoicesPage />` | Customer Invoices, Quotes, and Credit Notes workbench. |
| `/bills` | Authenticated | `<BillsPage />` | Accounts Payable Bills, Purchase Orders, Vendor Credits, and Batch Payments workbench. |
| `/expenses` | Authenticated | `<ExpensesPage />` | Direct Spend Money, Out-of-Pocket Expense Claims, Approvals Queue, and Reimbursement Payouts workbench. |
| `/banking` | Authenticated | `<BankingPage />` | Bank & Credit Card Accounts, Inter-Account Transfers, Statement CSV Import, and Smart Split-Pane Reconciliation workbench. |
| `/accounts` | Authenticated | `<AccountsPage />` | Chart of Accounts and Tracking Dimensions workbench. |
| `/ledger` | Authenticated | `<LedgerPage />` | General Ledger audit trail and manual journal entry management. |
| `/reports` | Authenticated | `<ReportsPage />` | Financial Statements (Trial Balance, Dimensional P&L, Balance Sheet, Aged AR/AP) and Australian ATO BAS Engine workbench. |
| `/settings` | Authenticated | `<SettingsPage />` | Organization profile, lock dates, EFT banking, team members, invites, system audit logs, and Centralized Admin Bulk CSV Import Hub (`ADMIN`). |
| `/developer` | Authenticated (`ADMIN`) | `<DeveloperPage />` | Read-only Developer & Agent Context Console (allowlisted Markdown docs viewer, roadmap tracker, changelog & audit feed, and sanitized runtime diagnostics). |
| `/*` | Authenticated | Navigate to `/` | Client-side catch-all redirect to `/`. |