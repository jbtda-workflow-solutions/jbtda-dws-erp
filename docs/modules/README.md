# Product Module Registry & Context Index

This directory defines the canonical **Product Modules** of the JBTDA-DWS ERP platform.

Unlike **Delivery Stages** in `docs/STAGES_ROADMAP.md` (which track sequential engineering milestones), **Product Modules** are the permanent, industry-standard functional boundaries that govern:
1. **Commercial Packaging & Subscription Tiering** (`organization.enabledModules` and future plan/billing entitlements)
2. **RBAC & Permission Scoping** (role access + scoped API key permissions)
3. **UI Navigation & Content Groups** (`AppShell.tsx` navigation visibility)
4. **AI Agent Domain Contexts** (compact, self-contained module contracts so any agent can rebuild or extend a module deterministically without scanning the entire repository)

---

## Canonical Module Registry

| Module Key | Commercial Tier | Status | UI Entry / Group | Context File |
| :--- | :--- | :--- | :--- | :--- |
| `CORE_PLATFORM` | **Base (Always Enabled)** | ✅ Live | Workspace, Contacts, Items, Settings | [core-platform.md](./core-platform.md) |
| `CORE_ACCOUNTING` | **Base (Core Ledger)** | ✅ Live | General Ledger (`/accounts`, `/ledger`, `/banking`, `/reports`) | [core-accounting.md](./core-accounting.md) |
| `RECEIVABLES` | **Standard Commercial** | ✅ Live | Sales / AR (`/invoices`) | [receivables.md](./receivables.md) |
| `PAYABLES` | **Standard Commercial** | ✅ Live | Purchases / AP (`/bills`) | [payables.md](./payables.md) |
| `EXPENSES` | **Standard Commercial** | ✅ Live | Spend & Claims (`/expenses`) | [expenses.md](./expenses.md) |
| `CONNECTORS` | **Pro / Integrations Add-On** | 🛠️ Planned (Stages 15–16) | Integrations (`/connectors`) | [connectors.md](./connectors.md) |
| `DOCUMENTS` | **Pro Add-On** | ⏸️ Deferred (Stage D1) | Cross-cutting Attachment Vault | [documents.md](./documents.md) |
| `PROJECTS` | **Enterprise Add-On** | ⏸️ Deferred (Stage D2) | Operations / Projects (`/projects`) | [projects.md](./projects.md) |
| `INVENTORY` | **Enterprise Add-On** | ⏸️ Deferred (Stage D3) | Operations / Inventory (`/inventory`) | [inventory.md](./inventory.md) |
| `FLEET` | **Enterprise Add-On** | ⏸️ Deferred (Stage D4) | Operations / Fleet (`/fleet`) | [fleet.md](./fleet.md) |
| `PAYROLL` | **Enterprise Add-On** | ⏸️ Deferred (Stage D5) | People / Payroll (`/payroll`) | [payroll.md](./payroll.md) |
| `DEVELOPER_PORTAL` | **Platform Internal** | ✅ Live (`ADMIN` only) | Governance (`/developer`) | Covered in [core-platform.md](./core-platform.md) |

---

## Universal Module Invariants

Every Product Module MUST obey these non-negotiable platform contracts:
1. **Tenant Isolation:** Every database table and query includes `where: { organizationId: request.organizationId }`.
2. **Integer-Cent Money:** All monetary columns are `BIGINT` AUD cents; zero `FLOAT`/`DOUBLE`/`REAL`.
3. **Ledger-First Posting:** No module mutates account balances directly. Every financial event posts an atomic, balanced `JournalEntry` ($\sum \text{Debits} == \sum \text{Credits}$) through `backend/src/lib/ledger-posting.ts`.
4. **Period Lock Compliance:** Every posting, edit, void, or reversal validates `effectiveDate > organization.lockDate`.
5. **Immutable Audit Trail:** Every state mutation writes an append-only row to `audit_logs` within the same Prisma transaction.
6. **Module Entitlement Gate (`requireModule`):** Optional/add-on modules enforce `organization.enabledModules.includes(moduleKey)` on both Fastify route `preHandler` hooks (returning `403 Forbidden` with `{ code: 'MODULE_NOT_ENABLED', module }`) and `AppShell.tsx` navigation rendering.
7. **Deterministic Runtime:** 100% deterministic TypeScript — zero runtime LLM calls.
