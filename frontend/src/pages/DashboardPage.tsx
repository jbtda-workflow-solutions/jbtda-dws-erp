import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Building2,
  AlertTriangle,
  Clock,
  CheckCircle2,
  RefreshCw,
  BarChart3,
  ChevronRight,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { dashboardApi, type DashboardSummary, ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';

function formatMoney(cents: number): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${isNegative ? '-' : ''}$${dollars}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await dashboardApi.getSummary();
      setData(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load dashboard metrics');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  if (loading && !data) {
    return (
      <div className="py-12 flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 rounded-full border-2 border-forest-900 border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-light text-slate-500">Loading live financial intelligence…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="py-12">
        <div className="rounded-md border border-rose-200 bg-rose-50/50 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
          <h2 className="text-base font-medium text-rose-900">Failed to Load Dashboard</h2>
          <p className="text-sm text-rose-600 mt-1 mb-4">{error}</p>
          <Button variant="outline" onClick={fetchDashboard}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    cashPosition,
    receivables,
    payables,
    approvalsQueue,
    performance,
    recentActivity,
    organization,
  } = data;

  const totalAgingAr =
    receivables.aging.currentCents +
    receivables.aging.days1to30Cents +
    receivables.aging.days31to60Cents +
    receivables.aging.days61to90Cents +
    receivables.aging.days90PlusCents || 1;

  const totalAgingAp =
    payables.aging.currentCents +
    payables.aging.days1to30Cents +
    payables.aging.days31to60Cents +
    payables.aging.days61to90Cents +
    payables.aging.days90PlusCents || 1;

  return (
    <div className="space-y-6">
      {/* Executive Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-medium tracking-tight text-slate-900">
              Executive Dashboard
            </h1>
            {organization.lockDate ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-medium bg-amber-50 text-amber-800 border border-amber-200">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                BAS Locked: {new Date(organization.lockDate).toLocaleDateString('en-AU')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Ledger Unlocked
              </span>
            )}
          </div>
          <p className="text-xs font-light text-slate-500 mt-1">
            Real-time financial position, working capital aging, and general ledger performance for{' '}
            <span className="font-medium text-slate-700">{organization.name}</span>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchDashboard}
            disabled={loading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link to="/reports">
            <Button size="sm" className="flex items-center gap-1.5 bg-forest-900 hover:bg-forest-800 text-white">
              <BarChart3 className="w-3.5 h-3.5" />
              Financial Reports & BAS
            </Button>
          </Link>
        </div>
      </div>

      {/* Actionable Approvals Alert Banner */}
      {approvalsQueue.totalPending > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/70 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-900">
                Action Required: {approvalsQueue.totalPending} Items Awaiting Review & Approval
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-amber-800 mt-1">
                {approvalsQueue.pendingBillsCount > 0 && (
                  <span>
                    • <strong className="font-semibold">{approvalsQueue.pendingBillsCount}</strong> Bills
                  </span>
                )}
                {approvalsQueue.pendingPosCount > 0 && (
                  <span>
                    • <strong className="font-semibold">{approvalsQueue.pendingPosCount}</strong> Purchase Orders
                  </span>
                )}
                {approvalsQueue.pendingClaimsCount > 0 && (
                  <span>
                    • <strong className="font-semibold">{approvalsQueue.pendingClaimsCount}</strong> Expense Claims
                  </span>
                )}
                {approvalsQueue.pendingJournalsCount > 0 && (
                  <span>
                    • <strong className="font-semibold">{approvalsQueue.pendingJournalsCount}</strong> Draft Journals
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {approvalsQueue.pendingBillsCount > 0 && (
              <Link to="/bills">
                <Button size="sm" variant="outline" className="text-xs bg-white hover:bg-amber-100 border-amber-200 text-amber-900">
                  Review Bills
                </Button>
              </Link>
            )}
            {approvalsQueue.pendingClaimsCount > 0 && (
              <Link to="/expenses">
                <Button size="sm" variant="outline" className="text-xs bg-white hover:bg-amber-100 border-amber-200 text-amber-900">
                  Review Expenses
                </Button>
              </Link>
            )}
            {approvalsQueue.pendingJournalsCount > 0 && (
              <Link to="/ledger">
                <Button size="sm" variant="outline" className="text-xs bg-white hover:bg-amber-100 border-amber-200 text-amber-900">
                  Review Journals
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Top Working Capital KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Cash Position */}
        <div className="rounded-md border border-slate-200 bg-white p-4 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Total Cash Position
            </p>
            <p className="mt-1.5 text-2xl font-mono tabular-nums font-semibold text-slate-900">
              {formatMoney(cashPosition.totalCashCents)}
            </p>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500 font-light">
              Across {cashPosition.accounts.length} bank account{cashPosition.accounts.length === 1 ? '' : 's'}
            </span>
            <Link to="/banking" className="text-forest-700 hover:text-forest-800 font-medium inline-flex items-center">
              Reconcile <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </Link>
          </div>
        </div>

        {/* Receivables */}
        <div className="rounded-md border border-slate-200 bg-white p-4 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Outstanding Invoices (AR)
            </p>
            <p className="mt-1.5 text-2xl font-mono tabular-nums font-semibold text-slate-900">
              {formatMoney(receivables.totalOutstandingCents)}
            </p>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
            {receivables.overdueCents > 0 ? (
              <span className="text-rose-600 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {formatMoney(receivables.overdueCents)} overdue
              </span>
            ) : (
              <span className="text-emerald-600 font-medium">All invoices current</span>
            )}
            <Link to="/invoices" className="text-slate-600 hover:text-slate-900 font-medium inline-flex items-center">
              {receivables.openInvoicesCount} open <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </Link>
          </div>
        </div>

        {/* Payables */}
        <div className="rounded-md border border-slate-200 bg-white p-4 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Outstanding Payables (AP)
            </p>
            <p className="mt-1.5 text-2xl font-mono tabular-nums font-semibold text-slate-900">
              {formatMoney(payables.totalOutstandingCents)}
            </p>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
            {payables.overdueCents > 0 ? (
              <span className="text-rose-600 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {formatMoney(payables.overdueCents)} overdue
              </span>
            ) : (
              <span className="text-emerald-600 font-medium">All bills current</span>
            )}
            <Link to="/bills" className="text-slate-600 hover:text-slate-900 font-medium inline-flex items-center">
              {payables.openBillsCount} open <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </Link>
          </div>
        </div>

        {/* Net Profit YTD */}
        <div className="rounded-md border border-slate-200 bg-white p-4 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Net Profit (YTD)
            </p>
            <p
              className={`mt-1.5 text-2xl font-mono tabular-nums font-semibold ${
                performance.ytdNetProfitCents >= 0 ? 'text-forest-800' : 'text-rose-600'
              }`}
            >
              {formatMoney(performance.ytdNetProfitCents)}
            </p>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500 font-light">
              MTD: <strong className="font-mono text-slate-700">{formatMoney(performance.mtdNetProfitCents)}</strong>
            </span>
            <Link to="/reports" className="text-forest-700 hover:text-forest-800 font-medium inline-flex items-center">
              View P&L <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Middle Section: Bank Accounts & Aging Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bank & Cash Balances Workbench */}
        <div className="rounded-md border border-slate-200 bg-white flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-forest-800" />
              <h2 className="text-sm font-medium text-slate-900">Cash & Bank Accounts</h2>
            </div>
            <Link to="/banking" className="text-xs text-forest-700 hover:text-forest-800 font-medium">
              Open Banking →
            </Link>
          </div>

          <div className="p-5 flex-1 flex flex-col justify-between">
            {cashPosition.accounts.length === 0 ? (
              <div className="text-center py-10">
                <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No bank accounts configured.</p>
                <Link to="/accounts" className="text-xs text-forest-700 hover:underline mt-1 block">
                  Add a bank account in Chart of Accounts
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                {cashPosition.accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="p-3 rounded border border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 font-semibold">
                          {acc.code}
                        </span>
                        <p className="text-sm font-medium text-slate-900">{acc.name}</p>
                      </div>
                      {(acc.bankBsb || acc.bankAccountNumber) && (
                        <p className="text-xs font-mono text-slate-400 mt-1">
                          BSB: {acc.bankBsb || '—'} • Acc: {acc.bankAccountNumber || '—'}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono tabular-nums font-semibold text-slate-900">
                        {formatMoney(acc.balanceCents)}
                      </p>
                      <span className="text-[10px] text-slate-400 uppercase font-medium">GL Balance</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Total Available Liquid Capital</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900 text-sm">
                {formatMoney(cashPosition.totalCashCents)}
              </span>
            </div>
          </div>
        </div>

        {/* Working Capital Aging Comparison */}
        <div className="rounded-md border border-slate-200 bg-white flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-700" />
              <h2 className="text-sm font-medium text-slate-900">Aging Analysis (AR vs AP)</h2>
            </div>
            <Link to="/reports" className="text-xs text-forest-700 hover:text-forest-800 font-medium">
              Detailed Aging →
            </Link>
          </div>

          <div className="p-5 space-y-5">
            {/* AR Aging Bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700">Receivables (Inflow)</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {formatMoney(receivables.totalOutstandingCents)}
                </span>
              </div>
              <div className="w-full h-2.5 rounded bg-slate-100 flex overflow-hidden">
                <div
                  style={{ width: `${(receivables.aging.currentCents / totalAgingAr) * 100}%` }}
                  className="bg-emerald-500"
                  title={`Current: ${formatMoney(receivables.aging.currentCents)}`}
                />
                <div
                  style={{ width: `${(receivables.aging.days1to30Cents / totalAgingAr) * 100}%` }}
                  className="bg-blue-400"
                  title={`1-30 Days: ${formatMoney(receivables.aging.days1to30Cents)}`}
                />
                <div
                  style={{ width: `${(receivables.aging.days31to60Cents / totalAgingAr) * 100}%` }}
                  className="bg-amber-400"
                  title={`31-60 Days: ${formatMoney(receivables.aging.days31to60Cents)}`}
                />
                <div
                  style={{ width: `${(receivables.aging.days61to90Cents / totalAgingAr) * 100}%` }}
                  className="bg-orange-500"
                  title={`61-90 Days: ${formatMoney(receivables.aging.days61to90Cents)}`}
                />
                <div
                  style={{ width: `${(receivables.aging.days90PlusCents / totalAgingAr) * 100}%` }}
                  className="bg-rose-500"
                  title={`90+ Days: ${formatMoney(receivables.aging.days90PlusCents)}`}
                />
              </div>
            </div>

            {/* AP Aging Bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700">Payables (Outflow)</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {formatMoney(payables.totalOutstandingCents)}
                </span>
              </div>
              <div className="w-full h-2.5 rounded bg-slate-100 flex overflow-hidden">
                <div
                  style={{ width: `${(payables.aging.currentCents / totalAgingAp) * 100}%` }}
                  className="bg-emerald-500"
                  title={`Current: ${formatMoney(payables.aging.currentCents)}`}
                />
                <div
                  style={{ width: `${(payables.aging.days1to30Cents / totalAgingAp) * 100}%` }}
                  className="bg-blue-400"
                  title={`1-30 Days: ${formatMoney(payables.aging.days1to30Cents)}`}
                />
                <div
                  style={{ width: `${(payables.aging.days31to60Cents / totalAgingAp) * 100}%` }}
                  className="bg-amber-400"
                  title={`31-60 Days: ${formatMoney(payables.aging.days31to60Cents)}`}
                />
                <div
                  style={{ width: `${(payables.aging.days61to90Cents / totalAgingAp) * 100}%` }}
                  className="bg-orange-500"
                  title={`61-90 Days: ${formatMoney(payables.aging.days61to90Cents)}`}
                />
                <div
                  style={{ width: `${(payables.aging.days90PlusCents / totalAgingAp) * 100}%` }}
                  className="bg-rose-500"
                  title={`90+ Days: ${formatMoney(payables.aging.days90PlusCents)}`}
                />
              </div>
            </div>

            {/* Aging Bracket Legend */}
            <div className="pt-2 grid grid-cols-5 gap-2 text-center text-[11px]">
              <div className="p-2 rounded bg-slate-50 border border-slate-200">
                <div className="w-2 h-2 rounded-full bg-emerald-500 mx-auto mb-1" />
                <span className="text-slate-500 block font-light">Current</span>
                <span className="font-mono text-slate-800 font-semibold block mt-0.5">
                  {formatMoney(receivables.aging.currentCents)}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-50 border border-slate-200">
                <div className="w-2 h-2 rounded-full bg-blue-400 mx-auto mb-1" />
                <span className="text-slate-500 block font-light">1-30d</span>
                <span className="font-mono text-slate-800 font-semibold block mt-0.5">
                  {formatMoney(receivables.aging.days1to30Cents)}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-50 border border-slate-200">
                <div className="w-2 h-2 rounded-full bg-amber-400 mx-auto mb-1" />
                <span className="text-slate-500 block font-light">31-60d</span>
                <span className="font-mono text-slate-800 font-semibold block mt-0.5">
                  {formatMoney(receivables.aging.days31to60Cents)}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-50 border border-slate-200">
                <div className="w-2 h-2 rounded-full bg-orange-500 mx-auto mb-1" />
                <span className="text-slate-500 block font-light">61-90d</span>
                <span className="font-mono text-slate-800 font-semibold block mt-0.5">
                  {formatMoney(receivables.aging.days61to90Cents)}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-50 border border-slate-200">
                <div className="w-2 h-2 rounded-full bg-rose-500 mx-auto mb-1" />
                <span className="text-slate-500 block font-light">90+d</span>
                <span className="font-mono text-slate-800 font-semibold block mt-0.5">
                  {formatMoney(receivables.aging.days90PlusCents)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Financial Performance & Live Audit Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* P&L Performance Breakdown */}
        <div className="rounded-md border border-slate-200 bg-white flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-forest-800" />
              <h2 className="text-sm font-medium text-slate-900">Operating Performance</h2>
            </div>
            <Link to="/reports" className="text-xs text-forest-700 hover:text-forest-800 font-medium">
              View P&L Statement →
            </Link>
          </div>

          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              {/* MTD Performance */}
              <div className="p-3.5 rounded border border-slate-200 bg-slate-50/70">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Month to Date (MTD)
                </span>
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Revenue:</span>
                    <span className="font-mono tabular-nums text-slate-900 font-medium">
                      {formatMoney(performance.mtdRevenueCents)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Expenses:</span>
                    <span className="font-mono tabular-nums text-slate-900 font-medium">
                      {formatMoney(performance.mtdExpenseCents)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-semibold">
                    <span className="text-slate-700">Net Profit:</span>
                    <span
                      className={`font-mono tabular-nums ${
                        performance.mtdNetProfitCents >= 0 ? 'text-forest-800' : 'text-rose-600'
                      }`}
                    >
                      {formatMoney(performance.mtdNetProfitCents)}
                    </span>
                  </div>
                </div>
              </div>

              {/* YTD Performance */}
              <div className="p-3.5 rounded border border-slate-200 bg-slate-50/70">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Year to Date (YTD)
                </span>
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Revenue:</span>
                    <span className="font-mono tabular-nums text-slate-900 font-medium">
                      {formatMoney(performance.ytdRevenueCents)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Expenses:</span>
                    <span className="font-mono tabular-nums text-slate-900 font-medium">
                      {formatMoney(performance.ytdExpenseCents)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-semibold">
                    <span className="text-slate-700">Net Profit:</span>
                    <span
                      className={`font-mono tabular-nums ${
                        performance.ytdNetProfitCents >= 0 ? 'text-forest-800' : 'text-rose-600'
                      }`}
                    >
                      {formatMoney(performance.ytdNetProfitCents)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded bg-forest-50/50 border border-forest-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-forest-900">
                <BarChart3 className="w-4 h-4 text-forest-700" />
                <span>GST & BAS Period Compliance Ready</span>
              </div>
              <Link to="/reports" className="font-medium text-forest-800 hover:underline">
                Generate ATO BAS Report →
              </Link>
            </div>
          </div>
        </div>

        {/* Live Audit Activity Log */}
        <div className="rounded-md border border-slate-200 bg-white flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-700" />
              <h2 className="text-sm font-medium text-slate-900">Recent Financial Activity</h2>
            </div>
            <Link to="/settings" className="text-xs text-forest-700 hover:text-forest-800 font-medium">
              Full Audit Trail →
            </Link>
          </div>

          <div className="p-5 flex-1">
            {recentActivity.length === 0 ? (
              <div className="text-center py-10">
                <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No activity recorded yet.</p>
                <p className="text-xs text-slate-400 mt-1">
                  Actions taken across invoices, bills, and journals will stream here.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5 max-h-[320px] overflow-y-auto pr-1">
                {recentActivity.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-forest-700 shrink-0 mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">{event.summary}</p>
                      <div className="flex items-center gap-2 text-slate-400 text-[11px] mt-0.5">
                        <span>{event.actorName || event.actorEmail || 'System'}</span>
                        <span>•</span>
                        <span>{formatDate(event.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
