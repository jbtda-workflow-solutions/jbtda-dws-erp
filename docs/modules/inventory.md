# Module Context: `INVENTORY` (Perpetual Inventory & Warehousing)

- **Module Key:** `INVENTORY`
- **Commercial Tier:** Enterprise Add-On
- **Status:** ⏸️ Deferred (Deferred Stage D3 — full spec in `docs/PLUGINS.md` §3)

---

## 1. Purpose & Architecture

Extends `Item` (`isTrackedInventory: true` in `CORE_PLATFORM`) into a multi-warehouse **Perpetual Inventory Engine** with Weighted Average Cost (WAC) valuation, Purchase Order goods receipts, stock adjustments, and automated Cost of Goods Sold (COGS) General Ledger recognition on Invoice issuance.

---

## 2. Planned Data Model & GL Accounts

- **Tables:** `warehouses`, `stock_levels` (with `averageUnitCostCents` in `BIGINT`), `stock_movements` (`GOODS_RECEIPT`, `SALES_DISPATCH`, `TRANSFER_IN`, `TRANSFER_OUT`, `STOCKTAKE_ADJUST`).
- **Module System Accounts (seeded on module enable):**
  - `1300` Inventory Asset (`ASSET`, `DEBIT`)
  - `2020` Accrued Purchases — Goods Received Not Invoiced (`LIABILITY`, `CREDIT`)
  - `5000` Cost of Goods Sold (`EXPENSE`, `DEBIT`)
- **Automated GL Flows:**
  1. **PO Goods Receipt:** `DR 1300 Inventory Asset` / `CR 2020 Accrued Purchases`
  2. **PO-Linked Vendor Bill:** `DR 2020 Accrued Purchases` + `DR 2200 GST Paid` / `CR 2000 Accounts Payable`
  3. **Invoice Issuance (Tracked SKU):** Appends `DR 5000 COGS` / `CR 1300 Inventory Asset` atomically alongside standard AR revenue posting.

---

## 3. RBAC & Module Gate

- **Module Gate:** `requireModule('INVENTORY')`
- **RBAC:** `ADMIN`, `ACCOUNTANT`, `MANAGER` (warehouses, stocktakes, adjustments); `AP_SPECIALIST` (goods receipts); `AR_SPECIALIST` (read stock availability); `AUDITOR` (read-only).
