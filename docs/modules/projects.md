# Module Context: `PROJECTS` (Project Accounting, Budgets, Time & Billing)

- **Module Key:** `PROJECTS`
- **Commercial Tier:** Enterprise Add-On
- **Status:** ⏸️ Deferred (Deferred Stage D2)

---

## 1. Purpose & Architecture

Provides project-level budgeting, time tracking, billable expense capture, and client invoicing — natively anchored to `CORE_ACCOUNTING` **Tracking Dimensions** (`TrackingOption`) so every project automatically gets real-time Profit & Loss reporting without duplicating GL accounts.

---

## 2. Planned Data Model & Ledger Integration

- **Tracking Option Binding:** Creating a `Project` automatically provisions/binds a `TrackingOption` under the `"Projects"` `TrackingCategory`.
- **Planned Tables:**
  - `projects`: `id`, `organizationId`, `code`, `name`, `contactId` (Customer), `trackingOptionId` (FK → `tracking_options.id`), `billingType` (`FIXED_PRICE` | `TIME_AND_MATERIALS` | `NON_BILLABLE`), `budgetRevenueCents`, `budgetCostCents`, `status` (`DRAFT` | `ACTIVE` | `ON_HOLD` | `COMPLETED` | `ARCHIVED`), `startDate`, `endDate`.
  - `project_tasks`: `id`, `organizationId`, `projectId`, `name`, `defaultBillableRateCents`, `estimatedHours`.
  - `project_time_entries`: `id`, `organizationId`, `projectId`, `taskId`, `userId`, `workDate`, `durationMinutes`, `billable`, `hourlyRateCents`, `billedInvoiceId`, `notes`.
- **Cross-Module Hooks:**
  - Any `Invoice`, `Bill`, `DirectTransaction`, or `ExpenseClaim` line tagged with `project.trackingOptionId` automatically rolls up into Project Actual Revenue, Actual Cost, and Gross Margin via `/api/v1/reports/profit-and-loss?trackingOptionId=...`.
  - **1-Click Bill Unbilled Time & Expenses:** Compiles unbilled `project_time_entries` and billable expenses into a Draft Customer `Invoice` (`RECEIVABLES`).

---

## 3. RBAC & Module Gate

- **Module Gate:** `requireModule('PROJECTS')`
- **RBAC:** `ADMIN`, `ACCOUNTANT`, `MANAGER` (create/manage projects, approve time, trigger invoicing); `EMPLOYEE` (log & view own time entries on assigned projects); `AUDITOR` (read-only).
