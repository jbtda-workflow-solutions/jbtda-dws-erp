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

- **Mechanism:** Signed + encrypted HttpOnly cookie via `@fastify/session` or
  `fastify-secure-session`.
- **Flags:** `HttpOnly`, `Secure` (production), `SameSite=Strict`, `Path=/`
- **Payload:**
  ```json
  {
    "userId": "uuid",
    "organizationId": "uuid",
    "role": "ADMIN"
  }
  ```
- **Signing secret:** `SESSION_SECRET` env var (≥ 32 bytes, random).
- **Encryption key:** `SESSION_ENCRYPTION_KEY` env var (exactly 32 bytes).
- Sessions are stateless (no server-side store). The cookie IS the session.

### Fastify Auth Middleware

Every authenticated route is decorated by a `preHandler` hook that:
1. Reads and verifies the session cookie.
2. Decorates `request.user` with `{ userId, organizationId, role }`.
3. Returns `401 Unauthorized` if the cookie is missing or invalid.
4. Returns `403 Forbidden` if the user lacks the required role for the route.

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

## RBAC Matrix

| Capability | ADMIN | ACCOUNTANT | AR_SPECIALIST | AP_SPECIALIST | AUDITOR |
|-----------|:-----:|:----------:|:-------------:|:-------------:|:-------:|
| Manage organization settings | ✅ | ❌ | ❌ | ❌ | ❌ |
| Invite / remove users | ✅ | ❌ | ❌ | ❌ | ❌ |
| View all records | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create / edit contacts | ✅ | ✅ | ✅ | ✅ | ❌ |
| Create / manage invoices | ✅ | ✅ | ✅ | ❌ | ❌ |
| Record payments in | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create / manage bills | ✅ | ✅ | ❌ | ✅ | ❌ |
| Record payments out | ✅ | ✅ | ❌ | ✅ | ❌ |
| View General Ledger | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage Chart of Accounts | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete organization | ✅ | ❌ | ❌ | ❌ | ❌ |

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

