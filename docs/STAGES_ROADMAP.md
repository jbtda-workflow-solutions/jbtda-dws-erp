# Stages Roadmap

Detailed breakdown of Stage 1 (MVP) through Stage 3 for the JBTDA-DWS ERP
application.

---

## Stage 1: Core Transactional Engine (Current)

**Goal:** A fully functional double-entry accounting backend with Google OAuth
login, multi-tenant org creation, contacts, AP (bills), and AR (invoices).
No external file dependencies.

### Backend Milestones

- [x] Phase 0: `/docs` scaffold and `AGENTS.md`
- [x] Phase 1: Backend project init, Google OAuth + session, Prisma schema + migrations
- [x] Phase 2: Organization creation with ABN validation and CoA seeding (`POST /api/v1/organizations`, `GET /api/v1/auth/me`)
- [x] Phase 3: Contacts CRUD API (`GET /api/v1/contacts`, `POST /api/v1/contacts`, `GET /api/v1/contacts/:id`, `PATCH /api/v1/contacts/:id`)
- [x] Phase 4: Bills API (create with line items, list, get with journal entries, and atomic double-entry ledger posting)
- [ ] Phase 5: Payments Out API with ledger posting
- [ ] Phase 6: Invoices API with automatic ledger posting on issuance
- [ ] Phase 7: Payments In API with invoice matching logic
- [ ] Phase 8: General Ledger read API (journal entries + lines)

### Frontend Milestones

- [x] Phase F1: Vite + React + Tailwind scaffold, Google OAuth login screen
- [x] Phase F2: Onboarding modal (org creation with live ATO ABN checksum validator)
- [x] Phase F3: Contacts directory (list with filters, create/edit modal with live ABN validator)
- [x] Phase F4: Bills module (list with filters, create bill with dynamic line items & live GST computation, view details & journal entry)
- [ ] Phase F5: Invoices module (list, create invoice, issue, record payment)
- [ ] Phase F6: General Ledger view (read-only journal list)

### Acceptance Criteria for Stage 1 Complete

1. User can log in with Google, create an organization with a valid ABN, and
   be assigned the ADMIN role.
2. User can create Contacts as CUSTOMER, VENDOR, or BOTH.
3. User can record a Bill with line items, see the correct GST calculation, and
   have the ledger automatically posted.
4. User can record a Payment Out against a Bill, see the Bill status update, and
   have the ledger automatically posted.
5. User can create a Customer Invoice (DRAFT), issue it (ISSUED), and have the
   ledger auto-posted on issuance.
6. User can record a Payment In against an Invoice (enforcing
   `requires_invoice_for_payment` policy), see the Invoice status update, and
   have the ledger posted.
7. All monetary arithmetic uses integer cents. No floats in DB or logic.
8. All queries are scoped to `organizationId`. Cross-tenant data leakage is
   impossible at the query layer.

---

## Stage 2: File Attachments & Outbound Integrations

**Goal:** Attach source documents to bills and invoices; trigger automated
email dispatch and PDF generation via n8n.

### Milestones

- [ ] GCP Cloud Storage integration (presigned V4 upload URLs)
- [ ] `attachments` table with `bill_id` / `invoice_id` FK
- [ ] `POST /api/v1/attachments/upload-url` — returns a presigned GCS URL
- [ ] n8n webhook trigger on `invoice.issued` → PDF generation + email send
- [ ] n8n webhook trigger on `invoice.payment_received` → receipt email
- [ ] Frontend: file drag-and-drop upload on Bill and Invoice detail screens

---

## Stage 3: Reporting & Financial Visibility

**Goal:** Read-only financial reporting views — General Ledger, Trial Balance,
P&L, and Australian BAS summary.

### Milestones

- [ ] **General Ledger View:** Paginated, filterable list of all journal entries
  with debit/credit columns and running balance per account.
- [ ] **Trial Balance:** Aggregated debit/credit totals per GL account,
  confirming ΣDebits = ΣCredits.
- [ ] **Profit & Loss:** Revenue accounts minus Expense accounts for a date range.
- [ ] **BAS Summary (Australian):**
  - G1: Total Sales (sum of all `REVENUE` account credits)
  - 1A: GST Collected (sum of `2100 - GST Collected` account credits)
  - 1B: GST Paid (sum of `2200 - GST Paid` account debits)
  - Net GST Payable = 1A − 1B

---

## Deferral Log

Items explicitly deferred from Stage 1:

| Item | Deferred To |
|------|------------|
| File/PDF attachments (GCS presigned URLs) | Stage 2 |
| n8n webhook triggers | Stage 2 |
| Email notifications | Stage 2 |
| General Ledger reporting UI | Stage 3 |
| Trial Balance & P&L | Stage 3 |
| BAS summary | Stage 3 |
| Bank reconciliation | Post-Stage 3 |
| Plaid bank feed integration | Post-Stage 3 |
| Multi-currency support | Post-Stage 3 |

