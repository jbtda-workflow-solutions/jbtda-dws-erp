# Integrations & Outbound Webhooks

> **Consolidated into `docs/modules/connectors.md`:** The complete Inbound API Key, Outbound Webhook Envelope, Event Catalogue (`invoice.issued`, `invoice.payment_received`, `bill.approved`, `expense.reimbursed`, `bas.locked`, `bank.reconciled`), n8n integration, and Google Workspace OAuth (Drive, Sheets, Calendar) specifications now live in **`docs/modules/connectors.md`**.

## Core Async Rule
- External integrations (n8n, custom webhooks, Google Workspace APIs) are strictly **asynchronous** and must never block authentication, balance calculations, or General Ledger posting.
- Outbound webhook requests are signed with HMAC-SHA256 (`X-Webhook-Signature`) and/or `X-Webhook-Secret` and carry a UUID `event_id` for consumer idempotency.
