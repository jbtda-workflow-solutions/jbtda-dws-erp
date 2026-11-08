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
| `FRONTEND_ORIGIN` | Cloud Run Env | Required if cross-origin | Valid URL string (e.g. `http://localhost:5173`) | CORS preflight checks reject cross-origin requests in dev/preview | Allowed origin for CORS (e.g. preview deployment URL or `http://localhost:5173`). In unified production, frontend and API share the exact same origin. |
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
| `PATCH` | `/api/v1/invoices/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Updates draft invoice. Disallowed if already issued or paid. |
| `POST` | `/api/v1/invoices/:id/issue` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Issues invoice: generates sequential invoice number, posts double-entry AR journal (Debit A/R, Credit Sales, Credit GST Collected). |
| `POST` | `/api/v1/invoices/:id/void` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Voids invoice: creates reversing journal entry. |
| `POST` | `/api/v1/invoices/:id/payments` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Records incoming customer payment against invoice. Posts GL entry (Debit Bank, Credit A/R). |
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
| `PATCH` | `/api/v1/bills/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Updates draft bill. Disallowed once approved. |
| `POST` | `/api/v1/bills/:id/approve` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Approves bill: posts double-entry AP journal (Debit Expense, Debit GST Paid, Credit A/P). |
| `POST` | `/api/v1/bills/:id/void` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Voids bill: creates reversing AP journal entry. |
| `POST` | `/api/v1/bills/:id/payments` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` (Draft) | Records payment out against bill. Posts GL entry (Debit A/P, Credit Bank). |
| `GET` | `/api/v1/bills/:id/payments` | Cookie Session | Read Roles | Lists payments allocated to this bill. |
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
| `POST` | `/api/v1/quotes/:id/convert-to-invoice` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AR_SPECIALIST` | Converts approved quote into draft customer invoice. |

### 10. Purchase Orders API (`/api/v1/purchase-orders/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/purchase-orders` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST`, `MANAGER`, `AUDITOR` | Lists purchase orders. |
| `POST` | `/api/v1/purchase-orders` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Creates draft purchase order. |
| `GET` | `/api/v1/purchase-orders/:id` | Cookie Session | Read Roles | Fetches PO details and lines. |
| `PATCH` | `/api/v1/purchase-orders/:id` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Updates draft PO. |
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

### 12. Vendor Credits API (`/api/v1/vendor-credits/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/vendor-credits` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST`, `AUDITOR` | Lists vendor credits. |
| `POST` | `/api/v1/vendor-credits` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Creates draft vendor credit. |
| `GET` | `/api/v1/vendor-credits/:id` | Cookie Session | Read Roles | Fetches vendor credit details and lines. |
| `POST` | `/api/v1/vendor-credits/:id/issue` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Issues vendor credit: posts contra-AP journal (Debit A/P, Credit Expense, Credit GST Paid). |
| `POST` | `/api/v1/vendor-credits/:id/allocate` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AP_SPECIALIST` | Allocates vendor credit against open vendor bill. |
| `POST` | `/api/v1/vendor-credits/:id/refund` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Records direct cash refund from vendor. |

### 13. Batch Payments & Australian ABA Export API (`/api/v1/batch-payments/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/batch-payments` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Lists batch payment runs. |
| `POST` | `/api/v1/batch-payments` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Groups multiple approved bills into a batch payment. Creates payment records. |
| `GET` | `/api/v1/batch-payments/:id/aba` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Generates and downloads Australian APCA CEMTEX 120-character `.ABA` payment file. |

### 14. General Ledger & Financial Reporting API (`/api/v1/ledger/*`)
| Verb | Exact Path | Auth Required | RBAC Scope | Purpose / Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/ledger` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Lists journal entries with account, date range, and reference type filters. |
| `GET` | `/api/v1/ledger/accounts` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Computes live debit/credit account balances. |
| `POST` | `/api/v1/ledger/entries` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Posts manual double-entry journal entry. Validates debits === credits in integer cents and lock dates. |
| `POST` | `/api/v1/ledger/:id/approve` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Approves draft journal entry. Validates two-person rule if enabled. |
| `POST` | `/api/v1/ledger/:id/reverse` | Cookie Session | `ADMIN`, `ACCOUNTANT` | Creates atomic reversing journal entry. |
| `GET` | `/api/v1/ledger/trial-balance` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Generates Trial Balance financial statement. |
| `GET` | `/api/v1/ledger/profit-loss` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Generates Profit & Loss financial statement. |
| `GET` | `/api/v1/ledger/balance-sheet` | Cookie Session | `ADMIN`, `ACCOUNTANT`, `AUDITOR` | Generates Balance Sheet financial statement. |

### 15. Frontend Client Routes (`frontend/src/App.tsx`)
| Client Route | Guard Status | Rendered Component | Purpose / Description |
| :--- | :--- | :--- | :--- |
| `/` | Authenticated | `<DashboardPage />` | Executive dashboard overview, KPI summaries, and quick actions. |
| `/` | Unauthenticated | `<LoginPage />` | Google OAuth 2.0 Sign-In page. |
| `/` | Onboarding | `<OnboardingModal />` | First-time organization creation modal with ABN verification. |
| `/contacts` | Authenticated | `<ContactsPage />` | Contacts directory workbench (Customers, Vendors, Employees). |
| `/items` | Authenticated | `<ItemsPage />` | Products & Services catalog workbench. |
| `/invoices` | Authenticated | `<InvoicesPage />` | Customer Invoices, Quotes, and Credit Notes workbench. |
| `/bills` | Authenticated | `<BillsPage />` | Accounts Payable Bills, Purchase Orders, Vendor Credits, and Batch Payments workbench. |
| `/accounts` | Authenticated | `<AccountsPage />` | Chart of Accounts and Tracking Dimensions workbench. |
| `/ledger` | Authenticated | `<LedgerPage />` | General Ledger audit trail and financial reports (Trial Balance, P&L, Balance Sheet). |
| `/settings` | Authenticated | `<SettingsPage />` | Organization profile, lock dates, EFT banking, team members, invites, and system audit logs. |
| `/*` | Authenticated | Navigate to `/` | Client-side catch-all redirect to `/`. |