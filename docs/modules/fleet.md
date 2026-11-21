# Module Context: `FLEET` (Fleet Management & Per-Vehicle P&L)

- **Module Key:** `FLEET`
- **Commercial Tier:** Enterprise Add-On
- **Status:** ⏸️ Deferred (Deferred Stage D4 — full spec in `docs/PLUGINS.md` §2)

---

## 1. Purpose & Architecture

Tracks corporate motor vehicles, plant, and machinery by binding every `FleetVehicle` to a `TrackingOption` under the `"Fleet Vehicles"` `TrackingCategory`. Fuel, maintenance, insurance, and lease costs recorded across `PAYABLES` and `EXPENSES` automatically roll up into native per-vehicle P&L and cost-per-kilometer analytics.

---

## 2. Planned Data Model & Ledger Integration

- **Tables:**
  - `fleet_vehicles`: `id`, `organizationId`, `vin`, `registrationPlate`, `make`, `model`, `year`, `odometerKm`, `trackingOptionId` (FK → `tracking_options.id`), `assignedMemberId`, `status` (`ACTIVE` | `MAINTENANCE` | `DECOMMISSIONED`).
  - `fleet_service_logs`: `id`, `organizationId`, `vehicleId`, `serviceDate`, `odometerKm`, `description`, `linkedBillId`, `linkedDirectTransactionId`, `nextServiceDueKm`, `nextServiceDueDate`.
- **Financial Reporting:** Zero custom SQL — queries `/api/v1/reports/profit-and-loss?trackingOptionId={vehicle.trackingOptionId}` directly.

---

## 3. RBAC & Module Gate

- **Module Gate:** `requireModule('FLEET')`
- **RBAC:** `ADMIN`, `ACCOUNTANT`, `MANAGER` (full fleet management & vehicle P&L); `EMPLOYEE` (submit odometer/fuel logs for assigned vehicle); `AUDITOR` (read-only).
