import { Link } from 'react-router-dom';
import {
  FileText,
  Receipt,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  Users,
  Wallet,
} from 'lucide-react';
import type { DashboardSummary } from '@/api/client';
import { Button } from '@/components/ui/Button';

function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}$${(abs / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface SpecialistHomeProps {
  mode: 'AR' | 'AP';
  data: DashboardSummary;
  loading: boolean;
  onRefresh: () => void;
}

export function SpecialistHome({ mode, data, loading, onRefresh }: SpecialistHomeProps) {
  const isAr = mode === 'AR';
  const ledger = isAr ? data.receivables : data.payables;
  const primaryHref = isAr ? '/invoices' : '/bills';
  const primaryLabel = isAr ? 'Open Receivables (AR)' : 'Open Payables (AP)';
  const PrimaryIcon = isAr ? FileText : Receipt;

  const totalAging =
    ledger.aging.currentCents +
      ledger.aging.days1to30Cents +
      ledger.aging.days31to60Cents +
      ledger.aging.days61to90Cents +
      ledger.aging.days90PlusCents || 1;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-slate-900">
            {isAr ? 'Receivables (AR) Workbench' : 'Payables (AP) Workbench'}
          </h1>
          <p className="text-xs font-light text-slate-500 mt-1">
            {isAr
              ? `Open customer invoices, overdue chasing, and collections for ${data.organization.name}.`
              : `Open vendor bills, approvals queue, and payment scheduling for ${data.organization.name}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 min-h-[36px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link to={primaryHref}>
            <Button size="sm" className="flex items-center gap-1.5 bg-forest-900 hover:bg-forest-700 text-white min-h-[36px]">
              <PrimaryIcon className="w-3.5 h-3.5" />
              {primaryLabel}
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            {isAr ? 'Total AR Outstanding' : 'Total AP Outstanding'}
          </p>
          <p className="font-mono text-2xl font-medium tabular-nums text-slate-900 mt-2">
            {formatMoney(ledger.totalOutstandingCents)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">
            {isAr
              ? `${data.receivables.openInvoicesCount} open invoice(s)`
              : `${data.payables.openBillsCount} open bill(s)`}
          </p>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Overdue Balance
            </p>
            {ledger.overdueCents > 0 && <AlertTriangle className="w-4 h-4 text-rose-600" />}
          </div>
          <p
            className={`font-mono text-2xl font-medium tabular-nums mt-2 ${
              ledger.overdueCents > 0 ? 'text-rose-700' : 'text-emerald-700'
            }`}
          >
            {formatMoney(ledger.overdueCents)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">
            {isAr
              ? `${data.receivables.overdueInvoicesCount} overdue invoice(s)`
              : `${data.payables.overdueBillsCount} overdue bill(s)`}
          </p>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            {isAr ? 'Draft Invoices' : 'Draft / Pending Bills'}
          </p>
          <p className="font-mono text-2xl font-medium tabular-nums text-slate-900 mt-2">
            {isAr
              ? data.workbench?.draftInvoicesCount ?? 0
              : data.approvalsQueue.pendingBillsCount}
          </p>
          <Link
            to={primaryHref}
            className="text-[11px] font-medium text-forest-900 hover:underline mt-1 inline-block"
          >
            Review queue →
          </Link>
        </div>
      </div>

      {/* Aging Breakdown */}
      <div className="rounded-md border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-900">
            {isAr ? 'Accounts Receivable Aging' : 'Accounts Payable Aging'}
          </h2>
          <span className="text-xs font-mono text-slate-500">
            {formatMoney(ledger.totalOutstandingCents)}
          </span>
        </div>

        <div className="h-2.5 w-full rounded bg-slate-100 overflow-hidden flex">
          <div
            style={{ width: `${(ledger.aging.currentCents / totalAging) * 100}%` }}
            className="bg-emerald-500"
          />
          <div
            style={{ width: `${(ledger.aging.days1to30Cents / totalAging) * 100}%` }}
            className="bg-amber-400"
          />
          <div
            style={{ width: `${(ledger.aging.days31to60Cents / totalAging) * 100}%` }}
            className="bg-amber-600"
          />
          <div
            style={{ width: `${(ledger.aging.days61to90Cents / totalAging) * 100}%` }}
            className="bg-rose-500"
          />
          <div
            style={{ width: `${(ledger.aging.days90PlusCents / totalAging) * 100}%` }}
            className="bg-rose-700"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
          {[
            { label: 'Current', val: ledger.aging.currentCents },
            { label: '1–30 Days', val: ledger.aging.days1to30Cents },
            { label: '31–60 Days', val: ledger.aging.days31to60Cents },
            { label: '61–90 Days', val: ledger.aging.days61to90Cents },
            { label: '90+ Days', val: ledger.aging.days90PlusCents },
          ].map((b) => (
            <div key={b.label} className="rounded border border-slate-100 bg-slate-50/70 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{b.label}</p>
              <p className="font-mono text-xs font-medium tabular-nums text-slate-900 mt-0.5">
                {formatMoney(b.val)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          to="/contacts"
          className="rounded-md border border-slate-200 bg-white p-4 hover:border-forest-700 transition-colors flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Users className="w-4 h-4 text-forest-700" />
            <div>
              <p className="text-xs font-medium text-slate-900">Contacts Directory</p>
              <p className="text-[11px] text-slate-500">
                {data.activeContactsCount} active customer & supplier profiles
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </Link>

        <Link
          to="/expenses"
          className="rounded-md border border-slate-200 bg-white p-4 hover:border-forest-700 transition-colors flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Wallet className="w-4 h-4 text-forest-700" />
            <div>
              <p className="text-xs font-medium text-slate-900">Expenses & Claims</p>
              <p className="text-[11px] text-slate-500">
                Submit claims or review direct card/bank spend
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </Link>
      </div>
    </div>
  );
}
