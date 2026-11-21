# Module Context: `CORE_PLATFORM` (Workspace, Identity, Master Data & Governance)

- **Module Key:** `CORE_PLATFORM` (plus internal `DEVELOPER_PORTAL`)
- **Commercial Tier:** Base (Always Enabled — cannot be disabled)
- **Status:** ✅ Live (Stages 1, 3, 9, 12, 13; Module Gating formalized in Stage 14)

---

## 1. Domain Ownership

### Database Tables (`backend/prisma/schema.prisma`)
- **Identity & Tenancy (Protected):** `users`, `organizations`, `organization_members`, `organization_invites`
- **Governance:** `audit_logs` (append-only immutable trail)
- **Master Data:** `contacts` (Customers, Vendors, Both — with ATO Mod-89 ABN validation and EFT BSB/Account), `items` (Products & Services catalog with sales/purchase defaults and `isTrackedInventory` flag)

### Backend Routes (`backend/src/routes/`)
- `auth.ts`: `/api/v1/auth/config`, `/google`, `/me`, `/switch-organization`, `/logout`
- `organizations.ts`: `/api/v1/organizations`, `/current`, `/members`, `/invites`, `/audit-logs`
- `contacts.ts`: `/api/v1/contacts/*`, `/api/v1/contacts/:id/360`
- `items.ts`: `/api/v1/items/*`
- `bulk-import.ts`: `/api/v1/bulk-import/templates`, `/validate`, `/commit` (13 ERP record types)
- `developer.ts` (`DEVELOPER_PORTAL`): `/api/v1/developer/docs`, `/docs/content`, `/roadmap-summary`, `/api-catalog`, `/diagnostics`, `/database/tables`, `/database/sync-schema`, `/database/purge-tables`

### Frontend Pages (`frontend/src/pages/`)
- `LoginPage.tsx`, `OnboardingModal.tsx`, `DashboardPage.tsx`
- `ContactsPage.tsx` (`/contacts`), `ItemsPage.tsx` (`/items`)
- `SettingsPage.tsx` (`/settings`), `DeveloperPage.tsx` (`/developer`)
- Shell & Navigation: `frontend/src/components/AppShell.tsx`

---

## 2. RBAC & Governance Rules

- **7-Role Matrix:** `ADMIN`, `ACCOUNTANT`, `MANAGER`, `AR_SPECIALIST`, `AP_SPECIALIST`, `EMPLOYEE`, `AUDITOR`.
- **Workspace Governance (`ADMIN` only):** Organization profile, ABN, EFT remittance details, `apcaUserId`, `fiscalYearStartMonth` (default `7` July AU), `lockDate`, `enforceTwoPersonApproval`, `enabledModules`, team invites, Bulk CSV Import, and `/developer`.
- **Contact 360°:** Aggregates Quotes, Invoices, AR Credit Notes, Payments In, POs, Bills, Vendor Credits, Payments Out, and Direct Spend/Receive Money transactions for a contact.
- **Hard Protection:** `users`, `organizations`, `organization_members`, and `organization_invites` can never be purged by `/api/v1/developer/database/purge-tables`.

---

## 3. Extension & Integration Hooks

- `Organization.enabledModules`: Canonical string array controlling active Product Modules per tenant.
- `Contact`: Shared master entity referenced by `RECEIVABLES`, `PAYABLES`, `EXPENSES`, `DOCUMENTS`, and `PROJECTS`.
- `Item`: Shared catalog entity extended by `INVENTORY` via `isTrackedInventory`.
