# Module Context: `CONNECTORS` (API Handler, Webhooks & External OAuth Integrations)

- **Module Key:** `CONNECTORS`
- **Commercial Tier:** Pro / Integrations Add-On
- **Status:** 🛠️ Planned — Active Stages 15–16 (`/connectors` UI, Inbound API Keys & Google Workspace); Outbound Webhooks / n8n Deferred (Stage D6)

---

## 1. Purpose & Architecture

`CONNECTORS` surfaces the platform's inbound/outbound API handler and third-party integrations as a first-class, tenant-scoped workspace (`/connectors`), maintaining 100% deterministic TypeScript execution and strict tenant isolation.

### Three Core Pillars
1. **Inbound API Handler, Scoped API Keys & `/connectors` UI (Active — Stage 15):**
   - Tenant-scoped Bearer tokens (`dws_live_<random>`) stored as SHA-256 hashes (plaintext displayed once on creation).
   - Scoped to Product Modules and Read/Write permissions (e.g., `receivables:read`, `receivables:write`, `payables:read`, `reports:read`, `contacts:write`).
   - Fastify auth middleware supports dual authentication: `erp_session` cookie (browser users) OR `Authorization: Bearer <api_key>` (machine clients), always enforcing `organizationId`, `requireModule(...)`, and immutable `audit_logs`.
2. **External OAuth App Connectors — Google Workspace (Active — Stage 16):**
   - Dedicated Google OAuth 2.0 Authorization Code flow (`access_type=offline`, `prompt=consent`) separate from user login OIDC.
   - OAuth access & refresh tokens encrypted at rest using **AES-256-GCM** (`ENCRYPTION_KEY` from Secret Manager) in `connector_accounts`.
   - **Google Drive:** Configure target Drive folders to archive/export Invoice PDFs, Bill vouchers, and BAS reports (and link Drive files).
   - **Google Sheets:** 1-click and scheduled export of live P&L, Trial Balance, Aged AR/AP, and Ledger tables to a linked spreadsheet.
   - **Google Calendar:** Sync Invoice/Bill due dates, ATO BAS lodgement deadlines, and Recurring Schedule dates to a shared finance calendar.
3. **Outbound Webhooks & n8n Automation Engine (⏸️ Deferred — Stage D6):**
   - Tenant-configurable webhook subscriptions (n8n, Zapier, Make, custom endpoints) with event filters, non-blocking post-commit dispatch signed with `X-Webhook-Signature` (HMAC-SHA256) / `X-Webhook-Secret`, and `webhook_deliveries` audit logs with 1-click retry & test ping.

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

## 4. Standard Outbound Webhook Envelope & Event Catalogue

All outbound webhooks (n8n, Zapier, custom endpoints) are non-blocking, fire-and-forget post-commit dispatches signed with `X-Webhook-Signature` (HMAC-SHA256) and/or `X-Webhook-Secret`, conforming to:

```json
{
  "event": "invoice.issued",
  "event_id": "evt_uuid",
  "timestamp": "2026-11-01T05:30:00Z",
  "organization_id": "org_uuid",
  "triggered_by_user_id": "usr_uuid",
  "data": {}
}
```

| Event | Trigger | Core `data` Fields |
| :--- | :--- | :--- |
| `invoice.issued` | Invoice transitions `DRAFT` → `ISSUED` | `invoice_id`, `invoice_number`, `customer_name`, `customer_email`, `due_date`, `subtotal_cents`, `gst_cents`, `total_cents` |
| `invoice.payment_received` | Payment recorded against Invoice | `invoice_id`, `invoice_number`, `payment_id`, `amount_cents`, `new_status`, `customer_email` |
| `bill.approved` | Bill transitions `DRAFT`/`PENDING_APPROVAL` → `AWAITING_PAYMENT` | `bill_id`, `vendor_name`, `reference`, `due_date`, `total_cents`, `gl_posted` |
| `expense.reimbursed` | Expense Claim marked `PAID` | `claim_id`, `member_id`, `total_cents`, `paid_at`, `bank_account_id` |
| `bas.locked` | Accounting period locked in BAS Engine | `lock_date`, `start_date`, `end_date`, `net_gst_cents`, `net_gst_type` |
| `bank.reconciled` | Bank statement lines matched against GL | `account_id`, `statement_line_count`, `reconciled_balance_cents` |

- Consumers MUST treat `event_id` as an idempotency key.

---

## 5. RBAC & Module Gate

- **Module Gate:** `requireModule('CONNECTORS')`
- **RBAC:** `ADMIN` (manage API keys, webhooks, OAuth connections, revoke tokens); `ACCOUNTANT` (trigger Sheets/Drive/Calendar syncs, inspect delivery logs); all other roles denied.
