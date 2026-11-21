# Module Context: `RECEIVABLES` (Order-to-Cash / Accounts Receivable)

- **Module Key:** `RECEIVABLES`
- **Commercial Tier:** Standard Commercial
- **Status:** ✅ Live (Stages 4, 11)

---

## 1. Domain Ownership

### Database Tables (`backend/prisma/schema.prisma`)
- `quotes`, `quote_line_items`
- `invoices`, `invoice_line_items`
- `credit_notes`, `credit_note_line_items`, `credit_note_allocations`
- `payments_in`
- `recurring_schedules` (where `entityType = 'INVOICE'`)

### Backend Routes (`backend/src/routes/`)
- `quotes.ts`: `/api/v1/quotes/*`, `/:id/convert-to-invoice`
- `invoices.ts`: `/api/v1/invoices/*`, `/:id/issue`, `/:id/revert-to-draft`, `/:id/void`, `/:id/payments`, `/api/v1/payments-in`, `/api/v1/invoices/recurring/*`
- `credit-notes.ts`: `/api/v1/credit-notes/*`, `/:id/issue`, `/:id/allocate`, `/:id/refund`, `/:id/void`

### Frontend Components (`frontend/src/`)
- `pages/InvoicesPage.tsx` (`/invoices` — Quotes, Invoices, Recurring, Credit Notes, Payments In)
- `components/InvoicePreviewModal.tsx` (Commercial Landscape A4 Tax Invoice & EFT Remittance Slip)

---

## 2. General Ledger Posting Contracts

- **Invoice Issuance (`POST /api/v1/invoices/:id/issue`):**
  - `DR 1200 Accounts Receivable` (Total Cents)
  - `CR <Line Revenue Account>` (Line Subtotal Cents + `trackingOptionId`)
  - `CR 2100 GST Collected` (Total GST Cents)
- **Customer Credit Note Issuance (`POST /api/v1/credit-notes/:id/issue`):**
  - `DR <Line Revenue Account>` (Subtotal) + `DR 2100 GST Collected` (GST)
  - `CR 1200 Accounts Receivable` (Total)
- **Payments In (`POST /api/v1/invoices/:id/payments` or `/api/v1/payments-in`):**
  - **Mode A (`INVOICE_PAYMENT`):** `DR <Selected Bank Account>`, `CR 1200 Accounts Receivable`
  - **Mode B (`DIRECT_INCOME`):** `DR <Selected Bank Account>`, `CR <Revenue Account>`, `CR 2100 GST Collected`
  - **Mode C (`CUSTOMER_PREPAYMENT`):** `DR <Selected Bank Account>`, `CR 2300 Customer Prepayments`

---

## 3. RBAC, Module Gate & Hooks

- **Module Gate:** `requireModule('RECEIVABLES')`
- **RBAC:** `ADMIN` & `ACCOUNTANT` (full lifecycle including issue, edit & re-post, revert, void, payment reversal); `AR_SPECIALIST` (draft/submit quotes, invoices, credits, record receipts); `MANAGER` & `AUDITOR` (read-only).
- **Webhook Events Emitted (via `CONNECTORS`):** `invoice.issued`, `invoice.payment_received`, `quote.accepted`.
- **Cross-Module Hooks:** `INVENTORY` appends COGS journals on invoice issuance for `isTrackedInventory` items; `DOCUMENTS` attaches PDFs; `PROJECTS` bills time/expenses to invoices.
