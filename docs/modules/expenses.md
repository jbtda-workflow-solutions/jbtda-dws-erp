# Module Context: `EXPENSES` (Direct Spend Money & Employee Expense Claims)

- **Module Key:** `EXPENSES`
- **Commercial Tier:** Standard Commercial (Toggleable Add-On)
- **Status:** ✅ Live (Stages 6, 10, 11)

---

## 1. Domain Ownership

### Database Tables (`backend/prisma/schema.prisma`)
- `direct_transactions`, `direct_transaction_lines` (`SPEND_MONEY` | `RECEIVE_MONEY`)
- `expense_claims`, `expense_claim_items` (`DRAFT` → `SUBMITTED` → `APPROVED` | `REJECTED` → `PAID`)

### Backend Routes (`backend/src/routes/`)
- `direct-transactions.ts`: `GET/POST/PATCH/DELETE /api/v1/direct-transactions/*`
- `expense-claims.ts`: `GET/POST/PATCH/DELETE /api/v1/expense-claims/*`, `/:id/submit`, `/:id/approve`, `/:id/reject`, `/:id/void`, `/:id/pay`, `/:id/reverse-payment`

### Frontend Pages (`frontend/src/pages/`)
- `ExpensesPage.tsx` (`/expenses` — Role-aware: My Claims, Team Approvals Queue, Reimbursement Payouts, Direct Bank/Card Spend)

---

## 2. General Ledger Posting Contracts

- **Direct Spend Money (`POST /api/v1/direct-transactions`, `SPEND_MONEY`):**
  - `DR <Line Expense/Asset Account>` (Subtotal + `trackingOptionId`)
  - `DR 2200 GST Paid` (GST)
  - `CR <Selected Bank/Card Account>` (Total)
- **Employee Expense Claim Approval (`POST /api/v1/expense-claims/:id/approve`):**
  - `DR <Line Expense Account>` (Subtotal + `trackingOptionId`)
  - `DR 2200 GST Paid` (GST)
  - `CR 2050 Employee Reimbursements Payable` (Total)
- **Employee Reimbursement Payout (`POST /api/v1/expense-claims/:id/pay` or via `.ABA` Batch):**
  - `DR 2050 Employee Reimbursements Payable` (Amount Paid)
  - `CR <Selected Operating Bank Account>` (Amount Paid)

---

## 3. RBAC, Module Gate & Hooks

- **Module Gate:** `requireModule('EXPENSES')`
- **RBAC:**
  - `EMPLOYEE`: Strictly isolated to creating, editing, submitting, and viewing **own** claims + own reimbursement BSB/Account. Zero access to company financials or Direct Spend.
  - `MANAGER`: Approve/reject team claims + submit own claims.
  - `ADMIN` & `ACCOUNTANT`: Full lifecycle including edit & re-post, void/unapprove, payout reversal, Direct Spend/Receive Money.
  - `AP_SPECIALIST`: Record Direct Spend Money & execute reimbursement payouts.
- **Webhook Events Emitted (via `CONNECTORS`):** `expense.submitted`, `expense.approved`, `expense.reimbursed`.
- **Cross-Module Hooks:** `DOCUMENTS` attaches receipt images/PDFs; `FLEET` and `PROJECTS` tag expense lines via `trackingOptionId`.
