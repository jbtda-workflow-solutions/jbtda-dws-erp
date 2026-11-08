# Corporate Precision Design System

This document defines the visual identity, geometric standards, typography, color tokens, density rules, and workflow patterns for the **JBTDA-DWS Enterprise Ledger & Business Services Platform**.

---

## 1. Design Philosophy: Institutional Ledger Precision

The interface rejects the "generic AI SaaS template" aesthetic (bubbly `rounded-2xl` cards, floating drop shadows, oversized pastel icon squares, and low-density whitespace). Instead, it embodies **Sleek Corporate Financial Precision**:

1. **Thinner, Leaner, Architectural Geometry:**
   - Structural surfaces connect via crisp `1px solid` hairline borders (`border-slate-200`) rather than floating shadows.
   - Corner radii are tight and deliberate: `4px` (`rounded`) for buttons, inputs, and status tags; `6px` (`rounded-md`) for structural panels and tables.
   - **Strictly Banned:** `rounded-xl`, `rounded-2xl`, pill-shaped `rounded-full` badges, and decorative pastel icon boxes (`w-10 h-10 rounded-xl bg-blue-50`).
2. **Process-Driven Density:**
   - Mid-to-high information density is justified by a clear **visual process path** at the top of every module: a connected **Lifecycle Pipeline Ribbon** that shows where every dollar and document sits (`Draft ➔ Pending Approval ➔ Open / Unpaid ➔ Overdue ➔ Settled`).
3. **Contextual Inspection (Slide-Over Workbench Drawers):**
   - Clicking a table row opens a docked, full-height **Right-Hand Inspector Drawer** (`Sheet`) showing the document breakdown, approval stepper, live Double-Entry GL impact (`DEBIT` / `CREDIT`), and audit trail—keeping the main table visible on the left for rapid sequential review.
4. **Bespoke Brand Identity (Obsidian Carbon & Institutional Forest):**
   - Deep Carbon/Obsidian navigation frame (`#0B1311`), crisp Alabaster/White work surfaces (`#F8FAFC` / `#FFFFFF`), Institutional Forest Green (`#14382C`) primary actions, and Warm Brass (`#B45309`) governance/approval indicators.

---

## 2. Typography Hierarchy (`Inter` + `JetBrains Mono`)

The platform pairs a geometric grotesque sans-serif for interface clarity with a technical monospace typeface for financial figures, account codes, and statutory identifiers.

### 1. Interface & Prose — `font-sans` (`Inter`)
- **Page Titles:** `text-lg` (`18px`), `font-medium` (500), `tracking-tight text-slate-900`. Never use `font-bold` (700).
- **Section & Drawer Headers:** `text-sm` (`14px`), `font-medium` (500), `tracking-tight text-slate-900`.
- **Micro Column & Metric Labels:** `text-[11px]`, `font-medium` (500), `uppercase tracking-wider text-slate-500`.
- **Table & Form Body Text:** `text-xs` (`12px`) or `text-[13px]`, `font-normal` (400), `text-slate-700`.

### 2. Financial Figures, GL Codes & Identifiers — `font-numbers` / `font-mono` (`JetBrains Mono`)
- **Mandatory Usage:**
  - All monetary values, subtotals, GST calculations, running balances, and KPI totals (`$142,850.00`).
  - General Ledger Account Codes (`1000`, `1200`, `2050`, `6000`).
  - Document & Transaction Numbers (`INV-1001`, `PO-0042`, `BILL-089`, `JE-0214`, `CLM-019`).
  - Statutory & Banking Identifiers: Australian ABNs (`51 824 753 556`), BSBs (`062-000`), Account Numbers, and ISO/AU Transaction Dates (`08 Nov 2026`).
- **Tabular Alignment Rule:** Always combine `font-numbers` (`JetBrains Mono`) with `tabular-nums` and `text-right` on monetary columns so decimal points align vertically down every ledger and table.

### Google Font Imports (`frontend/index.html`)
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
```

---

## 3. Color Tokens & Brand Palette

### Structural & Navigation Surfaces
| Token | Hex | Tailwind Class | Usage |
| :--- | :--- | :--- | :--- |
| **Obsidian Carbon** | `#0B1311` | `bg-obsidian-950` | Primary left navigation sidebar & institutional frame |
| **Obsidian Surface** | `#111E1A` | `bg-obsidian-900` | Company switcher button & active nav item fill in sidebar |
| **Obsidian Hairline** | `rgba(255,255,255,0.08)` | `border-white/[0.08]` | Crisp 1px section dividers inside the sidebar |
| **Canvas Alabaster** | `#F8FAFC` | `bg-slate-50` | App viewport background behind tables and strips |
| **Work Surface White** | `#FFFFFF` | `bg-white` | Data tables, metric strips, drawers, and document workbenches |
| **Structural Hairline** | `#E2E8F0` | `border-slate-200` | Primary 1px grid borders and connected panel dividers |
| **Subtle Row Divider** | `#F1F5F9` | `border-slate-100` | High-density table horizontal row lines |

### Brand & Action Accents
| Token | Hex | Tailwind Class | Usage |
| :--- | :--- | :--- | :--- |
| **Institutional Forest** | `#14382C` | `bg-forest-900` | Primary CTA buttons, active pipeline underline, focus rings |
| **Medium Forest** | `#1B4D3E` | `hover:bg-forest-700` | Primary CTA hover state & selected row left-border accent |
| **Emerald Signal** | `#10B981` | `text-emerald-500` | Active sidebar indicator bar, balanced ledger indicator ($\sum D == \sum C$) |
| **Soft Sage Tint** | `#EAF3EE` | `bg-forest-50` | Subtle active row highlight (`bg-forest-50/50`) |

### Squared Technical Status Tags (Bordered + 6px Dot)
Statuses use a **squared `4px` (`rounded`) tag with a `1px` border and a `6px` semantic dot**—never bubbly `rounded-full` pills:

| Semantic State | Dot Color | Background | Border | Text | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Posted / Paid / Balanced** | `bg-emerald-600` | `bg-emerald-50/70` | `border-emerald-200` | `text-emerald-900` | `PAID`, `POSTED`, `APPROVED`, `RECONCILED` |
| **Approval / Governance** | `bg-amber-600` | `bg-amber-50/70` | `border-amber-200` | `text-amber-900` | `PENDING_APPROVAL`, `SUBMITTED`, `PARTIALLY_PAID` |
| **Open / Issued / Active** | `bg-slate-600` | `bg-slate-100/80` | `border-slate-300` | `text-slate-800` | `ISSUED`, `AWAITING_PAYMENT`, `SENT` |
| **Draft / Unposted** | `bg-slate-400` | `bg-slate-50` | `border-slate-200` | `text-slate-600` | `DRAFT` |
| **Overdue / Rejected / Void**| `bg-rose-600` | `bg-rose-50/70` | `border-rose-200` | `text-rose-900` | `OVERDUE`, `REJECTED`, `VOID`, `IMBALANCED` |
| **System Locked / Protected**| `bg-forest-700` | `bg-forest-50` | `border-forest-200` | `text-forest-900` | `SYSTEM ACCOUNT`, `PERIOD LOCKED` |

---

## 4. Layout Architecture & Process-Driven Density

### 1. Lean Top Context Bar (`h-12` / `48px`)
Every view sits beneath a unified `48px` header bar (`bg-white border-b border-slate-200 px-6 flex items-center justify-between`):
- **Left:** Breadcrumb hierarchy (`Entity Legal Name` $\rightarrow$ `Module Domain` $\rightarrow$ `Active View`) + Accounting Period Lock badge (if `lockDate` is set).
- **Right:** Compact contextual actions (`h-8 px-3 text-xs rounded`) such as `+ New Journal`, `+ New Invoice`, or `Export .ABA`.

### 2. Connected Process Pipeline Ribbon (Workflow Navigation)
Instead of disconnected KPI cards or plain filter dropdowns, operational modules (AR, AP, Expenses, General Ledger) feature a **Connected Process Pipeline Ribbon** (`grid grid-flow-col auto-cols-fr divide-x divide-slate-200 border border-slate-200 bg-white rounded-md overflow-hidden`):
- Each cell represents a sequential step in the accounting process:
  - *Example (Accounts Payable):* `1. Purchase Orders` $\rightarrow$ `2. Draft Bills` $\rightarrow$ `3. Pending Approval` $\rightarrow$ `4. Awaiting Payment` $\rightarrow$ `5. Overdue` $\rightarrow$ `6. Paid (MTD)`
- Each pipeline stage displays:
  - Stage step number & uppercase label (`text-[11px] font-medium uppercase tracking-wider text-slate-500`)
  - Record count badge (`font-mono text-[11px] px-1.5 py-0.2 bg-slate-100 rounded text-slate-700`)
  - Aggregate monetary value (`font-numbers text-base font-medium tabular-nums text-slate-900 mt-1`)
- Clicking any pipeline cell filters the data table directly below and highlights the active cell with a `border-b-2 border-b-forest-900 bg-forest-50/30`.

### 3. High-Density Data Tables
- **Wrapper:** `bg-white border border-slate-200 rounded-md overflow-hidden` (no drop shadow).
- **Toolbar Row:** Integrated directly into the top of the table container (`px-3 py-2 border-b border-slate-200 bg-slate-50/40 flex items-center justify-between gap-2`) housing compact search input (`h-7 text-xs`), dimension filter, and date range filter.
- **Header Row (`<thead>`):** `bg-slate-50 border-b border-slate-200 h-8` (`32px`). Cells use `px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500`.
- **Body Rows (`<tbody>`):** `divide-y divide-slate-100`. Row height `h-9` (`36px`) to `h-10` (`40px`). Cells use `px-3 py-1.5 text-xs text-slate-700 whitespace-nowrap`.
- **Selected / Active Row State:** When a record is open in the right-hand Inspector Drawer, its table row stays highlighted (`bg-forest-50/60 border-l-2 border-l-forest-700`).

### 4. Right-Hand Slide-Over Inspector Drawer (`Drawer` / `Sheet`)
- Used for inspecting records (Invoices, Bills, Quotes, POs, Expense Claims, Contacts, Journal Entries) and performing in-context approvals or payment allocations.
- **Geometry:** Docked to `fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white border-l border-slate-200 shadow-2xl flex flex-col`.
- **Internal Structure:**
  1. **Sticky Header (`px-5 py-3.5 border-b border-slate-200`):** Document code (`font-mono text-sm font-semibold`), Status Tag, and close button.
  2. **Lifecycle / Approval Bar (`px-5 py-2.5 bg-slate-50 border-b border-slate-200`):** Shows who created the entry, current approval state, and 1-click `Approve & Post` / `Reject` controls if the user holds approver permissions.
  3. **Scrollable Body (`flex-1 overflow-y-auto p-5 space-y-5`):**
     - Metadata grid (2-column hairline key-value grid).
     - Line items table (with GL account codes and Tracking Dimension badges).
     - **Double-Entry Ledger Impact Box:** Every financial document drawer explicitly displays the exact `DEBIT` and `CREDIT` General Ledger lines (Account Code, Account Name, Debit AUD, Credit AUD) so the user always sees the underlying accounting reality.
     - Audit Log timeline for that record.
  4. **Sticky Action Footer (`px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between`):** Primary and secondary workflow actions.

### 5. Structured Multi-Line Document Workbenches
- Creating or editing multi-line documents (Manual Journals, Invoices, Bills, Quotes, Purchase Orders, Expense Claims) uses a wide workbench (`max-w-4xl` modal or dedicated full-height slide-over workbench) featuring:
  - A spreadsheet-style line editor (`border border-slate-200 rounded-md`) with compact inline inputs (`Item`, `Description`, `GL Account`, `Dimension`, `Qty`, `Unit Price`, `GST`, `Total`).
  - A sticky **Live Financial Summary & Double-Entry Verification Footer** showing Subtotal, 10% GST, Total AUD, and whether $\sum \text{Debits} == \sum \text{Credits}$.

---

## 5. Tailwind Configuration (`frontend/tailwind.config.ts`)

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: {
          800: '#182823',
          900: '#111E1A',
          950: '#0B1311',
        },
        forest: {
          50: '#EAF3EE',
          100: '#D3E6DC',
          200: '#A8CDB9',
          500: '#236551',
          700: '#1B4D3E',
          900: '#14382C',
        },
        navy: {
          50: '#F8FAFC',
          500: '#64748B',
          900: '#0F172A',
        },
        badge: {
          paidBg: '#ECFDF5',
          paidText: '#065F46',
          pendingBg: '#FFFBEB',
          pendingText: '#92400E',
          overdueBg: '#FFF1F2',
          overdueText: '#9F1239',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        numbers: ['"JetBrains Mono"', 'monospace'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```
