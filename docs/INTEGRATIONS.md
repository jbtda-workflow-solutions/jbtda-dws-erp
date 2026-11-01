# Integrations

Async webhook payloads and n8n job contracts for the JBTDA-DWS ERP system.

---

## Overview

The Fastify backend communicates with the n8n automation engine via
**asynchronous HTTP webhooks**. These are fire-and-forget calls — Fastify does
not await a meaningful response. n8n handles all side effects: email dispatch,
PDF generation, and external API synchronisation.

**n8n must never be a dependency for synchronous operations** (authentication,
balance calculation, payment recording).

---

## Authentication

Every webhook POST from Fastify to n8n includes:

```
X-Webhook-Secret: <value of WEBHOOK_SECRET env var>
Content-Type: application/json
```

The `WEBHOOK_SECRET` is a 64-character random hex string generated once and
stored in GCP Secret Manager for both services.

---

## Standard Event Envelope

All webhook payloads conform to this envelope:

```typescript
interface WebhookEvent<T = Record<string, unknown>> {
  event: string;           // e.g. "invoice.issued"
  event_id: string;        // UUID — idempotency key for n8n
  timestamp: string;       // ISO 8601 UTC
  organization_id: string; // UUID
  triggered_by_user_id: string; // UUID
  data: T;
}
```

---

## Event Catalogue

### `invoice.issued`
Triggered when an invoice status transitions from `DRAFT` → `ISSUED`.

```json
{
  "event": "invoice.issued",
  "event_id": "evt_01j...",
  "timestamp": "2026-11-01T05:30:00Z",
  "organization_id": "org_uuid",
  "triggered_by_user_id": "usr_uuid",
  "data": {
    "invoice_id": "inv_uuid",
    "invoice_number": "INV-1001",
    "customer_name": "Acme Corp",
    "customer_email": "accounts@acme.com",
    "due_date": "2026-11-15",
    "subtotal_cents": 120000,
    "gst_cents": 12000,
    "total_cents": 132000
  }
}
```

**n8n Actions:** Generate PDF invoice → email to customer.

---

### `invoice.payment_received`
Triggered when a payment is recorded against an invoice.

```json
{
  "event": "invoice.payment_received",
  "event_id": "evt_01j...",
  "timestamp": "2026-11-01T06:00:00Z",
  "organization_id": "org_uuid",
  "triggered_by_user_id": "usr_uuid",
  "data": {
    "invoice_id": "inv_uuid",
    "invoice_number": "INV-1001",
    "payment_id": "pay_uuid",
    "amount_cents": 132000,
    "new_status": "PAID",
    "customer_email": "accounts@acme.com"
  }
}
```

**n8n Actions:** Send payment receipt email to customer.

---

### `bill.awaiting_payment`
Triggered when a new bill is recorded.

```json
{
  "event": "bill.awaiting_payment",
  "event_id": "evt_01j...",
  "timestamp": "2026-11-01T07:00:00Z",
  "organization_id": "org_uuid",
  "triggered_by_user_id": "usr_uuid",
  "data": {
    "bill_id": "bill_uuid",
    "vendor_name": "Office Supplies Pty Ltd",
    "reference": "SUPP-INV-4521",
    "due_date": "2026-11-30",
    "total_cents": 55000
  }
}
```

**n8n Actions:** (Stage 2) Internal notification to AP team.

---

## n8n Webhook Endpoint Convention

n8n webhook URLs follow this pattern:

```
POST {N8N_WEBHOOK_BASE_URL}/webhook/{event-slug}
```

Example:
```
POST https://n8n.internal.example.com/webhook/invoice-issued
```

---

## Idempotency

- Each event carries a unique `event_id` (UUID).
- n8n workflows should use `event_id` as an idempotency key to avoid
  re-processing duplicate deliveries.
- Fastify does not implement retry logic; n8n Cloud Run should be configured
  with appropriate reliability settings.

