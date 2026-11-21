# Module Context: `PAYROLL` (Australian Payroll, Superannuation & STP Phase 2)

- **Module Key:** `PAYROLL`
- **Commercial Tier:** Enterprise Add-On (Significant Standalone Domain)
- **Status:** ⏸️ Deferred (Deferred Stage D5)

---

## 1. Purpose & Scope

Full Australian payroll engine covering employee employment profiles, pay calendars, deterministic PAYG withholding tables, Superannuation Guarantee (SG) accruals, leave entitlements, `.ABA` net wage batch disbursement, automated Payroll General Ledger journals, and ATO Single Touch Payroll (STP Phase 2) reporting hooks.

> **High-Sensitivity Data Boundary:** Payroll contains Tax File Numbers (TFNs), salaries, and personal banking data. All payroll endpoints require strict `PAYROLL`-scoped RBAC isolation (hidden from `AR_SPECIALIST`, `AP_SPECIALIST`, and regular `MANAGER`/`EMPLOYEE` peers), encrypted TFN storage (`AES-256-GCM`), and full audit logging.

---

## 2. Planned Data Model & System GL Accounts

- **Planned Tables:**
  - `payroll_employees`: `id`, `organizationId`, `memberId` (optional FK → `organization_members.id`), `firstName`, `lastName`, `email`, `tfnEncrypted`, `employmentType` (`FULL_TIME` | `PART_TIME` | `CASUAL` | `DIRECTOR`), `payBasis` (`SALARY` | `HOURLY`), `baseRateCents`, `superFundName`, `superFundUsi`, `superMemberNumber`, `bankBsb`, `bankAccountNumber`, `bankAccountName`, `startDate`, `terminationDate`, `isActive`.
  - `pay_calendars`: `id`, `organizationId`, `name`, `frequency` (`WEEKLY` | `FORTNIGHTLY` | `MONTHLY`), `nextPayPeriodStart`, `nextPayPeriodEnd`, `paymentDateOffsetDays`.
  - `pay_runs`: `id`, `organizationId`, `payCalendarId`, `periodStart`, `periodEnd`, `paymentDate`, `status` (`DRAFT` | `PENDING_APPROVAL` | `POSTED` | `PAID` | `VOID`), `totalGrossCents`, `totalPaygCents`, `totalSuperCents`, `totalNetCents`, `batchPaymentId`, `journalEntryId`.
  - `payslips`: `id`, `organizationId`, `payRunId`, `payrollEmployeeId`, `grossCents`, `paygWithholdingCents`, `superGuaranteeCents`, `reimbursementsCents`, `netPayCents`, `lineItemsJson`.
  - `leave_balances` & `leave_requests`: Annual leave, personal/carer's leave accruals and requests.
- **Module System GL Accounts (seeded when `PAYROLL` is enabled):**
  - `6100` Wages & Salaries Expense (`EXPENSE`, `DEBIT`)
  - `6110` Superannuation Expense (`EXPENSE`, `DEBIT`)
  - `2150` PAYG Withholding Payable (`LIABILITY`, `CREDIT` — maps to ATO BAS Label **W2**)
  - `2160` Superannuation Payable (`LIABILITY`, `CREDIT`)
  - `2170` Wages Payable — Payroll Clearing (`LIABILITY`, `CREDIT`)

---

## 3. General Ledger Posting Contracts

- **Pay Run Posting (`DRAFT` → `POSTED`):**
  - `DR 6100 Wages & Salaries Expense` (Total Gross Cents, tagged with employee default `trackingOptionId` if set)
  - `DR 6110 Superannuation Expense` (Total Super Cents)
  - `CR 2150 PAYG Withholding Payable` (Total PAYG Cents)
  - `CR 2160 Superannuation Payable` (Total Super Cents)
  - `CR 2170 Wages Payable — Payroll Clearing` (Total Net Pay Cents)
- **Wage Disbursement (Reuses `backend/src/lib/aba.ts` `.ABA` Batch Engine):**
  - `DR 2170 Wages Payable — Payroll Clearing` (Total Net Pay Cents)
  - `CR <Selected Operating Bank Account>` (Total Net Pay Cents)
- **ATO BAS Extension:** Once `PAYROLL` is active, `/api/v1/reports/bas` extends to include **W1** (Total Salary, Wages & Other Payments) and **W2** (Amounts Withheld from Payments).

---

## 4. RBAC & Module Gate

- **Module Gate:** `requireModule('PAYROLL')`
- **RBAC:** `ADMIN` & `ACCOUNTANT` (manage payroll employees, run/post/pay pay runs, export `.ABA`, STP submissions); `EMPLOYEE` (strictly self-service: view **own** payslips & submit **own** leave requests); `AUDITOR` (read-only); `AR_SPECIALIST` & `AP_SPECIALIST` (zero access).
