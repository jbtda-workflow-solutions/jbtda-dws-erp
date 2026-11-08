# Security

Authentication mechanics, session management, RBAC matrix, and cryptographic
standards for the JBTDA-DWS ERP backend.

---

## Authentication Flow (Google OAuth 2.0 / OIDC)

```
Browser                     Fastify Backend             Google Auth
   │                               │                         │
   │── POST /api/v1/auth/google ──▶│                         │
   │   { idToken: "..." }          │                         │
   │                               │── verifyIdToken() ────▶ │
   │                               │◀─ { sub, email, name } ─│
   │                               │                         │
   │                               │── UPSERT users WHERE google_sub = sub
   │                               │── CHECK organization_members
   │                               │── CHECK organization_invites WHERE email = email
   │                               │
   │                               │ (accept invite OR create org OR ONBOARDING status)
   │                               │
   │◀── Set-Cookie: session=... ───│
   │    HttpOnly; Secure;          │
   │    SameSite=Strict; Path=/    │
```

### Token Verification

- Library: `google-auth-library` (`OAuth2Client.verifyIdToken`)
- Validates signature, `aud` (must match `GOOGLE_CLIENT_ID`), expiry, and issuer.
- The `sub` claim is the immutable Google subject ID used to upsert the user.

### Session Cookie

- **Mechanism:** Cryptographically signed session cookie (`erp_session`) using HMAC-SHA256
  and constant-time timing-safe verification.
- **Flags:** `HttpOnly`, `Secure` (production), `SameSite=Strict`, `Path=/`, `MaxAge=7 days`
- **Payload:**
  ```json
  {
    "userId": "uuid",
    "organizationId": "uuid | null",
    "role": "Role | null"
  }
  ```
- **Signing secret:** `SESSION_SECRET` env var (≥ 32 bytes, random).
- Sessions are stateless (no server-side store). The cookie IS the session.

### Session Verification & Restoration Endpoint (`GET /api/v1/auth/me`)

Used by the frontend SPA upon mounting/page refresh:
- Reads `erp_session` cookie and verifies HMAC signature against `SESSION_SECRET`.
- If valid session exists with an `organizationId`: returns `200 OK` with user details, organization details, and role.
- If valid session exists without an `organizationId`: returns `200 OK` with status `onboarding` and user details.
- If cookie is missing or invalid: returns `401 Unauthorized`.

### Fastify Auth Middleware

Every authenticated route is decorated by a `preHandler` hook that:
1. Reads and verifies the session cookie.
2. Decorates `request.user` with `{ userId, organizationId, role }`.
3. Returns `401 Unauthorized` if the cookie is missing or invalid.
4. Returns `403 Forbidden` if the user lacks the required role for the route.

### Explicit Public vs Authenticated Entrypoint Boundaries

Per **AGENTS.md Rule 14**, all access paths must be explicitly classified. There are zero undocumented or implicitly open access paths:

- **Strictly Unauthenticated / Public Endpoints:**
  - `GET /healthz` — Cloud Run infrastructure health probe (returns 200 or 503).
  - `GET /` & `GET /*` (non-API) — Static React SPA assets and client-side routing fallback.
  - `GET /api/v1/auth/config` — Serves Google Client ID for client-side OAuth initialization.
  - `POST /api/v1/auth/google` — OIDC token exchange and session cookie issuance.
- **Strictly Authenticated Endpoints:**
  - Every other endpoint under `/api/v1/*` requires a cryptographically valid `erp_session` cookie and is governed by the 7-Role RBAC Matrix below. Unauthenticated requests are rejected with `401 Unauthorized`. Unmatched `/api/*` routes are handled explicitly and return `404 Not Found` JSON.

---

## Onboarding Flow (Option B)

```
POST /api/v1/auth/google
        │
        ├── Has organization_members? ──YES──▶ Issue session (existing member)
        │
        ├── Has pending organization_invite? ──YES──▶ Accept invite, issue session
        │
        └── No org, no invite ──▶ Issue ONBOARDING session (no organizationId)
                │
                ▼
          POST /api/v1/organizations
          { name, abn }
                │
                ├── Validate name (2–100 chars)
                ├── Validate ABN (11-digit ATO checksum)
                ├── CREATE organizations record
                ├── CREATE organization_members { role: ADMIN }
                └── SEED default Chart of Accounts (7 accounts)
```

### ABN Validation (ATO Checksum Algorithm)

```typescript
function validateABN(abn: string): boolean {
  const digits = abn.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const adjusted = [Number(digits[0]) - 1, ...digits.slice(1).split('').map(Number)];
  const sum = adjusted.reduce((acc, d, i) => acc + d * weights[i], 0);
  return sum % 89 === 0;
}
```

---

## Enterprise 7-Role RBAC Matrix

Access is compartmentalized by functional domain so regular employees (`EMPLOYEE`) and domain specialists (`AR_SPECIALIST`, `AP_SPECIALIST`) only see and mutate records within their permitted scope:

| Capability | `ADMIN` | `ACCOUNTANT` | `MANAGER` | `AR_SPECIALIST` | `AP_SPECIALIST` | `EMPLOYEE` | `AUDITOR` |
|-----------|:-----:|:----------:|:-------:|:-------------:|:-------------:|:--------:|:-------:|
| Manage organization settings, lock dates & modules | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Invite / remove users & assign roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Chart of Accounts & Tracking Dimensions | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | 🔍 Read |
| General Ledger, Manual Journals & Financial Statements | ✅ | ✅ | 🔍 Read (Reports) | ❌ | ❌ | ❌ | 🔍 Read |
| Australian BAS Engine & Statutory GST Worksheet | ✅ | ✅ | 🔍 Read | ❌ | ❌ | ❌ | 🔍 Read |
| Lock Accounting Period (`organization.lockDate`) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 1-Click "Approve & Post" (Journals, Bills, Invoices) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve Purchase Orders & Team Expense Claims | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create / edit contacts & items catalog | ✅ | ✅ | 🔍 Read | ✅ (Cust) | ✅ (Vend) | ❌ | 🔍 Read |
| Quotes, Customer Invoices, AR Credit Notes & Receipts | ✅ | ✅ | 🔍 Read | ✅ | ❌ | ❌ | 🔍 Read |
| Purchase Orders, Vendor Bills & AP Credit Notes | ✅ | ✅ | ✅ (POs) | ❌ | ✅ | ❌ | 🔍 Read |
| Execute Payments Out & Export `.ABA` Bank Files | ✅ | ✅ | ❌ | ❌ | Draft/Prep | ❌ | ❌ |
| Record Direct "Spend Money" Bank/Card Expenses | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | 🔍 Read |
| Inter-Account Money Transfers | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | 🔍 Read |
| Bank Statement Import & GL Reconciliation | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | 🔍 Read |
| Submit & View **Own** Employee Expense Claims | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (Own) | 🔍 Read |
| View Immutable System Audit Log | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Delete organization | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Adaptive Maker-Checker Approval Rules
- When `organization.enforceTwoPersonApproval == false` (default for SMEs):
  - `ADMIN` and `ACCOUNTANT` users can immediately approve and post Bills, Invoices, and Manual Journals in a single step, or save as `DRAFT`.
  - `AR_SPECIALIST`, `AP_SPECIALIST`, and `EMPLOYEE` users submit entries into `PENDING_APPROVAL` / `SUBMITTED`, requiring an `ADMIN`, `ACCOUNTANT`, or `MANAGER` (for POs and Expense Claims) to approve.
- When `organization.enforceTwoPersonApproval == true` (Enterprise strict mode):
  - Any user who creates/submits a financial document or manual journal cannot be the same user who approves it (`createdByUserId !== approvedByUserId`).

### Immutable System Audit Log (`audit_logs`)
- Every create, update, status transition, approval, reversal, void, period lock change, and role assignment writes an append-only row to `audit_logs` within the same Prisma database transaction.
- No API endpoint exists to update or delete `audit_logs` rows.

---

## Machine-to-Machine Security (Fastify → n8n)

- All outbound webhook requests to n8n include:
  ```
  X-Webhook-Secret: <64-char random hex, from WEBHOOK_SECRET env>
  ```
- The n8n instance validates this header on every incoming request.
- Webhooks are fire-and-forget (async). Fastify does not wait for n8n to complete.
- Event schema is documented in `docs/INTEGRATIONS.md`.

---

## Cryptographic Standards

| Concern | Standard |
|---------|---------|
| Cookie signing | HMAC-SHA256 with `SESSION_SECRET` |
| Cookie encryption | AES-256-GCM with `SESSION_ENCRYPTION_KEY` |
| Webhook secret | 64-char cryptographically random hex (`crypto.randomBytes(32).toString('hex')`) |
| Password hashing | N/A — Google OAuth only, no passwords stored |
| Database connection | TLS enforced (Cloud SQL Auth Proxy handles mTLS) |

---

## Security Headers (Fastify)

Configure `@fastify/helmet` with the following:

```typescript
fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com'],
      frameSrc: ["'self'", 'https://accounts.google.com'],
    },
  },
});
```

---

## Input Validation

- All request bodies validated with **Zod** schemas at the route level.
- Fastify schema compilation (`ajv`) provides a first-pass JSON schema check.
- Zod provides business-rule validation (ABN format, date ordering, positive cents).
- Any validation failure returns `400 Bad Request` with structured error detail.

