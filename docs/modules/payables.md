# Module Context: `PAYABLES` (Procure-to-Pay / Accounts Payable)

- **Module Key:** `PAYABLES`
- **Commercial Tier:** Standard Commercial
- **Status:** ✅ Live (Stages 5, 11)

---

## 1. Domain Ownership

### Database Tables (`backend/prisma/schema.prisma`)
- `purchase_orders`, `purchase_order_line_items`
- `bills`, `bill_line_items`
- `vendor_credits`, `vendor_credit_line_items`, `vendor_credit_allocations`
- `payments_out`, `batch_payments`
- `recurring_schedules` (where `entityType = 'BILL'`)

### Backend Routes & Libraries (`backend/src/`)
- `routes/purchase-orders.ts`: `/api/v1/purchase-orders/*`, `/:id/approve`, `/:id/convert-to-bill`
- `routes/bills.ts`: `/api/v1/bills/*`, `/:id/approve`, `/:id/revert-to-draft`, `/:id/void`, `/:id/payments`, `/api/v1/payments-out`, `/api/v1/recurring-bills/*`
- `routes/vendor-credits.ts`: `/api/v1/vendor-credits/*`, `/:id/issue`, `/:id/allocate`, `/:id/refund`, `/:id/void`
- `routes/batch-payments.ts`: `/api/v1/batch-payments/*`, `/:id/aba`
- `lib/aba.ts`: APCA Cemtex 120-character Australian `.ABA` bank batch payment generator

### Frontend Components (`frontend/src/`)
- `pages/BillsPage.tsx` (`/bills` — Purchase Orders, Vendor Bills, Recurring Bills, Vendor Credits, Batch `.ABA` Payments)
- `components/BillPreviewModal.tsx` (Commercial Landscape A4 Vendor Bill Voucher & EFT Advice)

---

## 2. General Ledger Posting Contracts

- **Vendor Bill Approval (`POST /api/v1/bills/:id/approve`):**
  - `DR <Line Expense/Asset Account>` (Line Subtotal Cents + `trackingOptionId`)
  - `DR 2200 GST Paid` (Total GST Cents)
  - `CR 2000 Accounts Payable` (Total Cents)
- **Vendor Credit Issuance (`POST /api/v1/vendor-credits/:id/issue`):**
  - `DR 2000 Accounts Payable` (Total)
  - `CR <Line Expense/Asset Account>` (Subtotal) + `CR 2200 GST Paid` (GST)
- **Single Payment Out / Batch Payment (`POST /api/v1/bills/:id/payments`, `/api/v1/batch-payments`):**
  - `DR 2000 Accounts Payable` (Bill settlements) + `DR 2050 Employee Reimbursements Payable` (if batch includes claims)
  - `CR <Selected Bank or Corporate Card Account>` (Total Paid)

---

## 3. RBAC, Module Gate & Hooks

- **Module Gate:** `requireModule('PAYABLES')`
- **RBAC:** `ADMIN` & `ACCOUNTANT` (full lifecycle including approve, edit & re-post, revert, void, payment reversal, `.ABA` export); `MANAGER` (approve POs, read bills); `AP_SPECIALIST` (draft/submit POs, bills, vendor credits, prep batch payments); `AUDITOR` (read-only).
- **Webhook Events Emitted (via `CONNECTORS`):** `bill.approved`, `bill.paid`, `purchase_order.approved`.
- **Cross-Module Hooks:** `INVENTORY` clears `2020 Accrued Purchases` on PO-linked bill ingestion; `DOCUMENTS` attaches supplier tax invoice PDFs; `PAYROLL` reuses `lib/aba.ts` for wage disbursement files.
