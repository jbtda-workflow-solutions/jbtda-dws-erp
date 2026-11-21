# Module Context: `DOCUMENTS` (Cloud Storage Document Vault & Attachments)

- **Module Key:** `DOCUMENTS` *(replaces legacy `ATTACHMENTS` flag)*
- **Commercial Tier:** Pro Add-On
- **Status:** ⏸️ Deferred (Deferred Stage D1 — see `docs/PLUGINS.md` §4)

---

## 1. Purpose & Architecture

Zero-binary-in-database document storage powered by **Google Cloud Storage (GCS) V4 presigned URLs**. Keeps PostgreSQL lean and Fastify CPU/network unencumbered by binary file transfers while attaching receipts, supplier invoices, contracts, and working papers directly to ERP records.

---

## 2. Planned Data Model & API Contract

- **Table (`document_attachments`):** `id`, `organizationId`, `entityType` (`BILL` | `INVOICE` | `EXPENSE_CLAIM` | `DIRECT_TRANSACTION` | `JOURNAL_ENTRY` | `CONTACT` | `PURCHASE_ORDER` | `QUOTE`), `entityId`, `fileName`, `fileSizeBytes`, `mimeType`, `gcsBucket`, `gcsObjectKey` (`{organizationId}/{entityType}/{entityId}/{uuid}-{safeName}`), `uploadedByUserId`, `createdAt`.
- **Routes (`/api/v1/documents/*`):**
  - `POST /api/v1/documents/presign-upload`: Validates tenant access, MIME allowlist (`application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `text/csv`), and file size ($\le 25\text{MB}$); returns 15-minute GCS V4 PUT URL.
  - `POST /api/v1/documents/confirm`: Verifies GCS object existence (`head`) and writes metadata row + audit log.
  - `GET /api/v1/documents`: Lists attachments for a target `entityType` + `entityId`.
  - `GET /api/v1/documents/:id/download-url`: Verifies tenant & parent-entity RBAC; returns 5-minute GCS V4 GET URL.
  - `DELETE /api/v1/documents/:id`: Deletes GCS object and metadata row (blocked if parent record is locked by `organization.lockDate`).
- **Cloud Run Config (Required when built):**
  - `GCS_ATTACHMENTS_BUCKET` (Cloud Run Env): Target GCS bucket name; Cloud Run service account granted `roles/storage.objectAdmin` and `roles/iam.serviceAccountTokenCreator` for V4 signing.

---

## 3. RBAC & Module Gate

- **Module Gate:** `requireModule('DOCUMENTS')`
- **RBAC:** Inherits access permissions of the parent entity (e.g., `EMPLOYEE` can attach/view receipts only on their own `EXPENSE_CLAIM`; `AP_SPECIALIST` on Bills/POs; `AUDITOR` read-only across all attachments).
