import { Link } from 'react-router-dom';
import {
  Building2,
  BookOpen,
  BarChart3,
  Landmark,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  FileText,
  Receipt,
  Clock,
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

interface BookkeeperHomeProps {
  data: DashboardSummary;
  loading: boolean;
  onRefresh: () => void;
}

export function BookkeeperHome({ data, loading, onRefresh }: BookkeeperHomeProps) {
  const { organization, cashPosition, receivables, payables, approvalsQueue, workbench } = data;
  const unreconciledCount = workbench?.unreconciledBankLinesCount ?? 0;
  const draftInvoices = workbench?.draftInvoicesCount ?? 0;
  const draftBills = workbench?.draftBillsCount ?? 0;
  const draftJournals = workbench?.draftJournalsCount ?? 0;
  const totalDrafts = draftInvoices + draftBills + draftJournals;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-medium tracking-tight text-slate-900">
              Accounting & Bookkeeping Workbench
            </h1>
            {organization.lockDate ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-medium bg-amber-50 text-amber-800 border border-amber-200">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                Locked ≤ {new Date(organization.lockDate).toLocaleDateString('en-AU')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Period Open
              </span>
            )}
          </div>
          <p className="text-xs font-light text-slate-500 mt-1">
            Daily bank reconciliation, unposted drafts, approvals, and BAS readiness for{' '}
            <span className="font-medium text-slate-700">{organization.name}</span>.
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
          <Link to="/banking">
            <Button size="sm" className="flex items-center gap-1.5 bg-forest-900 hover:bg-forest-700 text-white min-h-[36px]">
              <Building2 className="w-3.5 h-3.5" />
              Reconcile Bank
            </Button>
          </Link>
        </div>
      </div>

      {/* Bookkeeper Priority Action Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Link
          to="/banking"
          className="rounded-md border border-slate-200 bg-white p-4 hover:border-forest-700 transition-colors flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Unreconciled Bank Lines
            </span>
            <Building2 className="w-4 h-4 text-forest-700" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-medium tabular-nums text-slate-900">
              {unreconciledCount}
            </span>
            <span
              className={`text-xs font-mono ${
                unreconciledCount > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {unreconciledCount > 0 ? 'Needs matching →' : 'All reconciled'}
            </span>
          </div>
        </Link>

        <Link
          to="/ledger"
          className="rounded-md border border-slate-200 bg-white p-4 hover:border-forest-700 transition-colors flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Unposted Drafts
            </span>
            <Clock className="w-4 h-4 text-slate-500" />
          </div>
          <div className="mt-2">
            <span className="font-mono text-2xl font-medium tabular-nums text-slate-900">
              {totalDrafts}
            </span>
            <p className="text-[11px] text-slate-500 mt-1 font-mono">
              {draftInvoices} Inv · {draftBills} Bills · {draftJournals} Jnl
            </p>
          </div>
        </Link>

        <Link
          to="/bills"
          className="rounded-md border border-slate-200 bg-white p-4 hover:border-forest-700 transition-colors flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Pending Approvals
            </span>
            <AlertTriangle
              className={`w-4 h-4 ${
                approvalsQueue.totalPending > 0 ? 'text-amber-600' : 'text-slate-400'
              }`}
            />
          </div>
          <div className="mt-2">
            <span className="font-mono text-2xl font-medium tabular-nums text-slate-900">
              {approvalsQueue.totalPending}
            </span>
            <p className="text-[11px] text-slate-500 mt-1 font-mono">
              {approvalsQueue.pendingBillsCount} Bills · {approvalsQueue.pendingClaimsCount} Claims ·{' '}
              {approvalsQueue.pendingJournalsCount} Jnl
            </p>
          </div>
        </Link>

        <Link
          to="/reports"
          className="rounded-md border border-slate-200 bg-white p-4 hover:border-forest-700 transition-colors flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Cash & Liquidity
            </span>
            <BarChart3 className="w-4 h-4 text-forest-700" />
          </div>
          <div className="mt-2">
            <span className="font-mono text-2xl font-medium tabular-nums text-slate-900">
              {formatMoney(cashPosition.totalCashCents)}
            </span>
            <p className="text-[11px] text-slate-500 mt-1">
              Across {cashPosition.accounts.length} active bank/card account(s)
            </p>
          </div>
        </Link>
      </div>

      {/* Two-Column Workbench Body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Bank Accounts Ledger Balances */}
        <div className="lg:col-span-2 rounded-md border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-900">
              Bank & Card Accounts (GL Balances)
            </h2>
            <Link
              to="/banking"
              className="text-xs font-medium text-forest-900 hover:underline inline-flex items-center gap-0.5"
            >
              Open Banking <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {cashPosition.accounts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No bank accounts configured yet.
              </div>
            ) : (
              cashPosition.accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-900 truncate">
                      <span className="font-mono text-slate-500 mr-1.5">{acc.code}</span>
                      {acc.name}
                    </p>
                    {(acc.bankBsb || acc.bankAccountNumber) && (
                      <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                        BSB {acc.bankBsb ?? '—'} · Acct {acc.bankAccountNumber ?? '—'}
                      </p>
                    )}
                  </div>
                  <span className="font-mono text-sm font-medium tabular-nums text-slate-900 shrink-0">
                    {formatMoney(acc.balanceCents)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Accounting & Tax Quick Launchers */}
        <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-medium text-slate-900">
              Bookkeeping & Tax Shortcuts
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {[
              {
                label: 'Bookkeeping Workbench (Register & Rules)',
                sub: 'Account transactions, cash coding, Find & Recode & rec proof',
                href: '/bookkeeping',
                icon: BookOpen,
              },
              {
                label: 'Tax Agent & Period Close',
                sub: 'BAS health check, Cash/Accrual BAS, Cash Flow & Fixed Assets',
                href: '/tax-close',
                icon: ShieldCheck,
              },
              {
                label: 'Chart of Accounts & Cost Centres',
                sub: 'Manage GL accounts & tracking dimensions',
                href: '/accounts',
                icon: Landmark,
              },
              {
                label: 'Financial Statements & ATO BAS',
                sub: 'Trial Balance, P&L, Balance Sheet & BAS lock',
                href: '/reports',
                icon: BarChart3,
              },
              {
                label: `Receivables (${receivables.openInvoicesCount} open)`,
                sub: `${formatMoney(receivables.totalOutstandingCents)} outstanding`,
                href: '/invoices',
                icon: FileText,
              },
              {
                label: `Payables (${payables.openBillsCount} open)`,
                sub: `${formatMoney(payables.totalOutstandingCents)} unpaid`,
                href: '/bills',
                icon: Receipt,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className="px-4 py-3 min-h-[48px] flex items-center justify-between gap-3 hover:bg-forest-50/40 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 text-forest-700 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 truncate">
                        {item.label}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">{item.sub}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
