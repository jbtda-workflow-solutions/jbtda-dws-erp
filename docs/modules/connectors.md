# Module Context: `CONNECTORS` (API Handler, Webhooks & External OAuth Integrations)

- **Module Key:** `CONNECTORS`
- **Commercial Tier:** Pro / Integrations Add-On
- **Status:** 🛠️ Planned (Stages 15 & 16)

---

## 1. Purpose & Architecture

`CONNECTORS` surfaces the platform's inbound/outbound API handler and third-party integrations as a first-class, tenant-scoped workspace (`/connectors`). It replaces static single-tenant webhook env vars with self-service management while maintaining 100% deterministic TypeScript execution and strict tenant isolation.

### Three Core Pillars
1. **Inbound API Handler & Scoped API Keys (Stage 15):**
   - Tenant-scoped Bearer tokens (`dws_live_<random>`) stored as SHA-256 hashes (plaintext displayed once on creation).
   - Scoped to Product Modules and Read/Write permissions (e.g., `receivables:read`, `receivables:write`, `payables:read`, `reports:read`, `contacts:write`).
   - Fastify auth middleware supports dual authentication: `erp_session` cookie (browser users) OR `Authorization: Bearer <api_key>` (machine clients / n8n inbound), always enforcing `organizationId`, `requireModule(...)`, and immutable `audit_logs`.
2. **Outbound Webhooks & Automation Engine (Stage 15):**
   - Tenant-configurable webhook subscriptions (n8n, Zapier, Make, custom endpoints) with event filters (`invoice.issued`, `invoice.payment_received`, `bill.approved`, `expense.reimbursed`, `bas.locked`, `bank.reconciled`).
   - Non-blocking, fire-and-forget post-commit dispatch signed with `X-Webhook-Signature` (HMAC-SHA256) and/or `X-Webhook-Secret`.
   - Delivery audit table (`webhook_deliveries`) tracking HTTP status, latency, response snippet, and 1-click manual retry / test ping.
3. **External OAuth App Connectors — Google Workspace First (Stage 16):**
   - Dedicated Google OAuth 2.0 Authorization Code flow (`access_type=offline`, `prompt=consent`) separate from user login OIDC.
   - OAuth access & refresh tokens encrypted at rest using **AES-256-GCM** (`ENCRYPTION_KEY` from Secret Manager) in `connector_accounts`.
   - **Google Drive:** Configure target Drive folders to archive/export Invoice PDFs, Bill vouchers, and BAS reports (and link Drive files).
   - **Google Sheets:** 1-click and scheduled export of live P&L, Trial Balance, Aged AR/AP, and Ledger tables to a linked spreadsheet.
   - **Google Calendar:** Sync Invoice/Bill due dates, ATO BAS lodgement deadlines, and Recurring Schedule dates to a shared finance calendar.

---

## 2. Planned Data Models (`backend/prisma/schema.prisma`)

- `api_keys`: `id`, `organizationId`, `name`, `keyPrefix`, `keyHash`, `scopes` (`String[]`), `createdByUserId`, `lastUsedAt`, `expiresAt`, `revokedAt`, `createdAt`
- `webhook_endpoints`: `id`, `organizationId`, `name`, `url`, `secretEncrypted`, `subscribedEvents` (`String[]`), `isActive`, `createdAt`, `updatedAt`
- `webhook_deliveries`: `id`, `organizationId`, `webhookEndpointId`, `eventId`, `eventName`, `payloadJson`, `httpStatus`, `responseSnippet`, `durationMs`, `status` (`SUCCESS` | `FAILED`), `createdAt`
- `connector_accounts`: `id`, `organizationId`, `provider` (`GOOGLE_WORKSPACE`, future: `BASIQ_BANKING`, `STRIPE`), `externalAccountEmail`, `scopes` (`String[]`), `accessTokenEncrypted`, `refreshTokenEncrypted`, `tokenExpiresAt`, `configJson`, `status`, `connectedByUserId`, `createdAt`, `updatedAt`
- `connector_sync_logs`: `id`, `organizationId`, `connectorAccountId`, `service` (`GOOGLE_DRIVE` | `GOOGLE_SHEETS` | `GOOGLE_CALENDAR`), `action`, `status`, `summary`, `metadataJson`, `createdAt`

---

## 3. Cloud Run Secrets & Env Vars (Introduced in Stages 15–16)

- `ENCRYPTION_KEY` (Secret Manager, 32-byte hex): AES-256-GCM key for encrypting OAuth refresh tokens, webhook secrets, and session payload hardening.
- `GOOGLE_OAUTH_CLIENT_SECRET` (Secret Manager, Stage 16): OAuth 2.0 Web Client secret for exchanging Google Workspace authorization codes for offline refresh tokens.
- `PUBLIC_BASE_URL` (Cloud Run Env, Stage 16): Canonical public HTTPS origin (e.g. `https://erp.example.com`) used to construct exact OAuth callback URIs (`/api/v1/connectors/oauth/google/callback`).

---

## 4. RBAC & Module Gate

- **Module Gate:** `requireModule('CONNECTORS')`
- **RBAC:** `ADMIN` (manage API keys, webhooks, OAuth connections, revoke tokens); `ACCOUNTANT` (trigger Sheets/Drive/Calendar syncs, inspect delivery logs); all other roles denied.
