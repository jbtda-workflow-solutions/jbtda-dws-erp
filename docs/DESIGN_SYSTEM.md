# Design System

Typography, color tokens, Tailwind configuration, and table/component
conventions for the JBTDA-DWS ERP frontend.

---

## Typography Hierarchy (Hybrid Approach)

### Interface Text — `font-sans` (Inter)
- **Headings:** `font-medium` (weight 500), `tracking-tight`. Never use `font-bold` (700).
- **Body & Descriptions:** `font-light` (300) or `font-normal` (400) with relaxed line heights.

### Financial Numbers & Metrics — `font-numbers` (Open Sans)
- **Required on:** All monetary amounts, line-item totals, subtotal/tax calculations,
  transaction dates, and balance figures.
- **Tabular alignment:** Every financial figure cell MUST include the `tabular-nums`
  Tailwind class. This forces fixed-width digits so decimal points align vertically
  down columns.

### Google Font Imports (index.html)
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Open+Sans:wght@400;600&display=swap"
  rel="stylesheet"
/>
```

---

## Color Tokens & Palette

### Canvas
| Token | Hex | Tailwind |
|-------|-----|---------|
| Canvas Off-White | `#F8FAFC` | `bg-slate-50` |

### Structure & Typography
| Token | Hex | Tailwind |
|-------|-----|---------|
| Midnight Navy | `#0F172A` | `text-slate-900` |
| Muted Slate | `#64748B` | `text-slate-500` |

### Brand / Primary Actions
| Token | Hex | Tailwind | Usage |
|-------|-----|---------|-------|
| Deep Forest Green | `#14382C` | `bg-forest-900` | Primary CTA button background |
| Medium Forest | `#1B4D3E` | `hover:bg-forest-700` | CTA hover state |
| Soft Sage | `#EAF3EE` | `bg-forest-50` | Soft brand tint, sidebar accents |

### Semantic Status Badges
Badges use a **pastel background + saturated text** pattern:

| Status | Background | Background Hex | Text | Text Hex |
|--------|-----------|---------------|------|---------|
| Paid / Settled | `bg-badge-paidBg` | `#DCFCE7` | `text-badge-paidText` | `#14532D` |
| Pending / Draft | `bg-badge-pendingBg` | `#FEF3C7` | `text-badge-pendingText` | `#78350F` |
| Overdue / Void | `bg-badge-overdueBg` | `#FFE4E6` | `text-badge-overdueText` | `#881337` |

---

## Tailwind Configuration

`frontend/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#EAF3EE',
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
          paidBg: '#DCFCE7',
          paidText: '#14532D',
          pendingBg: '#FEF3C7',
          pendingText: '#78350F',
          overdueBg: '#FFE4E6',
          overdueText: '#881337',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        numbers: ['"Open Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

---

## Data Table Standards

### Container
```
bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm
```

### Header Row
```
bg-slate-50 text-slate-500 text-xs font-medium uppercase tracking-wider
```

### Data Rows
```
border-b border-slate-100   (or divide-y divide-slate-200 on <tbody>)
hover:bg-slate-50 transition-colors
```

### Column Alignment Rules
| Column Type | Alignment | Extra Classes |
|------------|-----------|--------------|
| Contact / vendor names | Left | — |
| Descriptions | Left | — |
| Status badges | Left or Center | — |
| **Monetary figures** | **Right** | `text-right font-numbers tabular-nums` |
| Dates | Left | `font-numbers tabular-nums` |

---

## Monetary Display Formatting

Always format monetary values client-side using the Intl API:

```typescript
const formatAUD = (cents: number): string =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
```

**Never** pass raw cent integers into display without this formatter.

---

## Status Badge Component (Reference)

```tsx
const statusConfig = {
  PAID:            { label: 'Paid',     bg: 'bg-badge-paidBg',     text: 'text-badge-paidText' },
  PARTIALLY_PAID:  { label: 'Partial',  bg: 'bg-badge-pendingBg',  text: 'text-badge-pendingText' },
  DRAFT:           { label: 'Draft',    bg: 'bg-badge-pendingBg',  text: 'text-badge-pendingText' },
  AWAITING_PAYMENT:{ label: 'Awaiting', bg: 'bg-badge-pendingBg',  text: 'text-badge-pendingText' },
  ISSUED:          { label: 'Issued',   bg: 'bg-badge-pendingBg',  text: 'text-badge-pendingText' },
  OVERDUE:         { label: 'Overdue',  bg: 'bg-badge-overdueBg',  text: 'text-badge-overdueText' },
  VOID:            { label: 'Void',     bg: 'bg-badge-overdueBg',  text: 'text-badge-overdueText' },
};

export function StatusBadge({ status }: { status: keyof typeof statusConfig }) {
  const { label, bg, text } = statusConfig[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
}
```

