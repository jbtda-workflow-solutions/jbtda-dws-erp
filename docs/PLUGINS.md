# Enterprise Plug-In Module Contract

Architectural specification and integration contracts for extending the JBTDA-DWS ERP Unified Monolith with custom enterprise modules without altering core financial ledger structures.

---

## 1. Architectural Philosophy & Zero-Core-Mutation Guarantee

The JBTDA-DWS ERP core is designed around a **Strict Immutable Financial Core**:
- The double-entry general ledger (`Account`, `JournalEntry`, `JournalLineItem`), statutory tax calculations (Australian GST & BAS), and bank reconciliation mechanisms are closed to destructive modification.
- Business extensions (Fleet, Inventory, Document Attachments, Automations) must integrate as **Modular Monolith Plug-Ins** using declarative metadata, dimensional tracking foreign keys (`trackingOptionId`), and non-blocking asynchronous event hooks.

### Core Guarantees:
1. **Multi-Tenant Isolation**: Every plug-in table and query must include and filter by `organizationId`.
2. **Deterministic Ledger Invariants**: Plug-ins never execute ad-hoc direct balance updates. All financial movements must generate standard balanced `JournalEntry` batches via existing core ledger posting services.
3. **Integer-Cent Monetary Arithmetic**: All monetary quantities remain strictly `BIGINT` cents.
4. **Zero AI at Runtime**: Deterministic TypeScript logic only.

---

## 2. Plug-In Specification: `FLEET` (Fleet Management & Vehicle P&L)

### 2.1 Overview
The Fleet Management plug-in enables tracking corporate motor vehicles, heavy machinery, and plant assets. It integrates directly with Module 2 Tracking Dimensions to provide instantaneous, granular vehicle-level Profit & Loss reports and cost-per-kilometer analytics.

### 2.2 Integration Mechanism: Tracking Option Binding
Every vehicle registered in the `FleetVehicle` entity automatically provisions or binds to a `TrackingOption` record under the system tracking category `"Fleet Vehicles"`:

```typescript
// Relationship Model
interface FleetVehicle {
  id: string;                    // UUID
  organizationId: string;        // Tenant isolation
  vin: string;                   // Vehicle Identification Number
  registrationPlate: string;     // e.g. "DWS-101"
  make: string;                  // e.g. "Toyota"
  model: string;                 // e.g. "Hilux SR5"
  year: number;                  // e.g. 2024
  odometerKm: number;            // Current odometer reading
  trackingOptionId: string;      // FK -> TrackingOption.id ("Fleet Vehicles")
  assignedContactId?: string;    // FK -> Contact.id (Driver / Employee)
  status: 'ACTIVE' | 'MAINTENANCE' | 'DECOMMISSIONED';
  createdAt: string;
  updatedAt: string;
}
```

### 2.3 Ledger Attribution
When recording operational expenses against a vehicle:
- **Direct Card Spend (Fuel / Tolls)**: Line items in `POST /api/v1/direct-transactions` are tagged with `trackingOptionId: vehicle.trackingOptionId`.
- **Supplier Bills (Servicing / Tyres)**: Line items in `POST /api/v1/bills` are tagged with `trackingOptionId: vehicle.trackingOptionId`.
- **Employee Expense Claims (Fuel reimbursement)**: Tagged with `trackingOptionId: vehicle.trackingOptionId`.

### 2.4 Financial Statement Extraction
Vehicle Profit & Loss statements require zero custom SQL calculations. The existing Module 8 reporting engine handles it natively:
```http
GET /api/v1/reports/profit-and-loss?startDate=2026-07-01&endDate=2027-06-30&trackingOptionId={vehicle.trackingOptionId}
```
This isolates total operating expenses, repairs, fuel, insurance, and lease costs attributed specifically to that registration plate.

---

## 3. Plug-In Specification: `INVENTORY` (Perpetual Inventory & Warehousing)

### 3.1 Overview
The Inventory plug-in extends the Products & Services catalog (`Item`) into a **Perpetual Inventory Tracking Engine**. It tracks stock levels across warehouse locations, automates Cost of Goods Sold (COGS) general ledger recognition, and reconciles goods receipts with Accounts Payable.

### 3.2 Data Model Extension
```prisma
// Extension models for Inventory Plug-In
model Warehouse {
  id              String           @id @default(uuid())
  organizationId  String           @map("organization_id")
  code            String           // e.g. "MELB-MAIN"
  name            String
  address         String?
  isActive        Boolean          @default(true) @map("is_active")
  createdAt       DateTime         @default(now()) @map("created_at")

  stockLevels     StockLevel[]

  @@unique([organizationId, code])
  @@map("warehouses")
}

model StockLevel {
  id              String           @id @default(uuid())
  organizationId  String           @map("organization_id")
  itemId          String           @map("item_id")
  warehouseId     String           @map("warehouse_id")
  quantityOnHand  Decimal          @default(0) @db.Decimal(12, 4) @map("quantity_on_hand")
  quantityAllocated Decimal        @default(0) @db.Decimal(12, 4) @map("quantity_allocated")
  averageUnitCostCents BigInt      @default(0) @map("average_unit_cost_cents")

  item            Item             @relation(fields: [itemId], references: [id])
  warehouse       Warehouse        @relation(fields: [warehouseId], references: [id])

  @@unique([organizationId, itemId, warehouseId])
  @@map("stock_levels")
}

enum StockMovementType {
  GOODS_RECEIPT     // PO delivery into stock
  SALES_DISPATCH    // AR Invoice fulfillment
  TRANSFER_IN       // Inter-warehouse
  TRANSFER_OUT      // Inter-warehouse
  STOCKTAKE_ADJUST  // Write-on / Write-off
}

model StockMovement {
  id              String            @id @default(uuid())
  organizationId  String            @map("organization_id")
  itemId          String            @map("item_id")
  warehouseId     String            @map("warehouse_id")
  movementType    StockMovementType @map("movement_type")
  quantity        Decimal           @db.Decimal(12, 4)
  unitCostCents   BigInt            @map("unit_cost_cents")
  totalCostCents  BigInt            @map("total_cost_cents")
  referenceType   String            @map("reference_type") // "PURCHASE_ORDER" | "INVOICE" | "ADJUSTMENT"
  referenceId     String            @map("reference_id")
  journalEntryId  String?           @map("journal_entry_id")
  createdAt       DateTime          @default(now()) @map("created_at")

  @@map("stock_movements")
}
```

### 3.3 Automated General Ledger Workflows
1. **Goods Receipt (PO Fulfillment)**:
   When inventory arrives before the supplier bill is finalized:
   - `DEBIT 1300 Inventory Asset` (Quantity $\times$ Unit Cost)
   - `CREDIT 2020 Accrued Purchases (Goods Received Not Invoiced)` (Total Cost)
2. **Supplier Bill Ingestion**:
   When the vendor bill arrives for the PO:
   - `DEBIT 2020 Accrued Purchases` (Clears accrual)
   - `DEBIT 2200 GST Paid` (Tax claim)
   - `CREDIT 2000 Accounts Payable` (Vendor obligation)
3. **Customer Invoice Issuance (COGS Recognition)**:
   When an invoice containing an inventory-tracked SKU transitions to `ISSUED`:
   - Fastify issues standard revenue posting:
     - `DEBIT 1200 Accounts Receivable`
     - `CREDIT 4000 Sales Revenue`
     - `CREDIT 2100 GST Collected`
   - Inventory plug-in hook atomically appends perpetual inventory recognition:
     - `DEBIT 5000 Cost of Goods Sold` (Calculated using Weighted Average Cost)
     - `CREDIT 1300 Inventory Asset` (Decrements balance sheet stock value)

---

## 4. Plug-In Specification: `ATTACHMENTS` (Cloud Storage Document Pipeline)

### 4.1 Overview
The Attachments plug-in establishes a zero-binary-in-database file storage architecture utilizing Google Cloud Storage (GCS) V4 presigned upload and download URLs.

### 4.2 Data Model
```typescript
interface DocumentAttachment {
  id: string;                    // UUID
  organizationId: string;        // Tenant isolation
  entityType: 'BILL' | 'INVOICE' | 'EXPENSE_CLAIM' | 'JOURNAL_ENTRY' | 'CONTACT';
  entityId: string;              // Target record UUID
  fileName: string;              // e.g. "tax-invoice-4891.pdf"
  fileSizeBytes: number;         // e.g. 248920
  mimeType: string;              // "application/pdf" | "image/png" | "image/jpeg"
  gcsBucket: string;             // e.g. "jbtda-dws-erp-attachments"
  gcsObjectKey: string;          // "{organizationId}/{entityType}/{entityId}/{uuid}.pdf"
  uploadedByUserId: string;      // User who initiated upload
  createdAt: string;
}
```

### 4.3 Presigned V4 Lifecycle
1. **Client Request (`POST /api/v1/attachments/presign-upload`)**:
   - Client sends `{ entityType, entityId, fileName, mimeType, fileSizeBytes }`.
   - Backend validates tenant permissions and file size limits ($\le 25\text{MB}$).
   - Backend constructs GCS key: `${organizationId}/${entityType}/${entityId}/${uuid}-${safeName}`.
   - Backend signs Google Cloud Storage V4 PUT URL with 15-minute expiry.
2. **Direct Browser Upload**:
   - React client performs direct `PUT` to the Google Cloud Storage bucket with binary body.
   - Fastify server CPU and network remain unencumbered by file transfers.
3. **Commit Attachment (`POST /api/v1/attachments/confirm`)**:
   - Client confirms completion. Fastify issues a GCS head object check and records metadata row in PostgreSQL.
4. **Secure Download (`GET /api/v1/attachments/:id/download-url`)**:
   - Backend verifies user organization membership and role permissions.
   - Backend returns temporary presigned GET URL (expires in 5 minutes).

---

## 5. Plug-In Specification: `N8N_WEBHOOKS` (Outbound Async Automation)

### 5.1 Overview
Outbound webhook integration decouples heavy notification tasks (email dispatch, SMS reminders, CRM synch, external document generation) from Fastify request cycles.

### 5.2 Delivery Guarantees & Contract
- **Fire-and-Forget / Non-Blocking**: Dispatched asynchronously via worker queue or post-commit event emitter. Fastify never awaits upstream execution.
- **HMAC / Shared Secret Security**:
  ```http
  POST https://n8n.internal.digitalworkflowsolutions.com/webhook/erp-events
  X-Webhook-Secret: <64-character hex secret>
  Content-Type: application/json
  ```
- **Envelope Standard**:
  ```typescript
  interface OutboundEventEnvelope<T> {
    eventId: string;             // UUID (idempotency key)
    event: string;               // e.g. "bill.approved", "bas.locked"
    timestamp: string;           // ISO 8601 UTC
    organizationId: string;      // Tenant UUID
    actorUserId: string;         // User triggering event
    data: T;                     // Event payload
  }
  ```

### 5.3 Event Catalogue Additions (Module 8 & Beyond)
| Event | Trigger | Payload Summary |
| :--- | :--- | :--- |
| `bill.approved` | Bill transitions `DRAFT`/`AWAITING_APPROVAL` $\rightarrow$ `OPEN` | `billId`, `contactId`, `totalCents`, `dueDate`, `glPosted: true` |
| `expense.reimbursed` | Claim marked `PAID` via single pay or batch ABA run | `claimId`, `memberId`, `totalCents`, `paidAt`, `bankAccountId` |
| `bas.locked` | User locks accounting period in BAS Engine | `lockDate`, `startDate`, `endDate`, `netGstCents`, `netGstType` |
| `bank.reconciled` | Bank statement lines matched against ledger | `accountId`, `statementLineCount`, `reconciledBalanceCents` |

---

## 6. Registration & Activation Protocol

To activate an enterprise plug-in for an organization:
1. An administrator enables the module flag on the organization settings:
   ```json
   {
     "enabledModules": ["CORE", "FLEET", "INVENTORY", "ATTACHMENTS", "N8N_WEBHOOKS"]
   }
   ```
2. The UI AppShell dynamically displays navigation nodes based on `organization.enabledModules`.
3. Fastify route guards verify that the active organization has the target module enabled before processing plug-in API requests.

