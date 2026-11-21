# Enterprise Plug-In Module Contract

> **Consolidated into `docs/modules/`:** To avoid context duplication, all plug-in and add-on module contracts now live as single-source-of-truth domain contexts under `docs/modules/`.

## Zero-Core-Mutation Guarantee

All optional modules integrate with the Unified Monolith without destructively modifying core financial tables:
1. Enforce `where: { organizationId }` on every query.
2. Post financial movements exclusively through `backend/src/lib/ledger-posting.ts` ($\sum \text{Debits} == \sum \text{Credits}$, integer AUD cents).
3. Gate backend routes via `requireModule('<MODULE_KEY>')` and frontend nav via `organization.enabledModules`.
4. Maintain 100% deterministic TypeScript runtime (zero runtime LLM calls).

## Canonical Add-On Module Specifications

| Module Key | Delivery Stage | Specification |
| :--- | :--- | :--- |
| `CONNECTORS` | Active (Stages 15–16) | [docs/modules/connectors.md](./modules/connectors.md) |
| `DOCUMENTS` *(formerly `ATTACHMENTS`)* | Deferred (Stage D1) | [docs/modules/documents.md](./modules/documents.md) |
| `PROJECTS` | Deferred (Stage D2) | [docs/modules/projects.md](./modules/projects.md) |
| `INVENTORY` | Deferred (Stage D3) | [docs/modules/inventory.md](./modules/inventory.md) |
| `FLEET` | Deferred (Stage D4) | [docs/modules/fleet.md](./modules/fleet.md) |
| `PAYROLL` | Deferred (Stage D5) | [docs/modules/payroll.md](./modules/payroll.md) |
