import { Link } from 'react-router-dom';
import {
  Wallet,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Landmark,
  RefreshCw,
} from 'lucide-react';
import type { DashboardSummary } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { StatusTag, resolveStatusTone } from '@/components/ui/StatusTag';

function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}$${(abs / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface EmployeeHomeProps {
  data: DashboardSummary;
  loading: boolean;
  onRefresh: () => void;
}

export function EmployeeHome({ data, loading, onRefresh }: EmployeeHomeProps) {
  const myClaims = data.myClaims;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-slate-900">
            My Staff Workspace
          </h1>
          <p className="text-xs font-light text-slate-500 mt-1">
            Submit out-of-pocket expense claims, track reimbursements, and manage your payout banking for{' '}
            <span className="font-medium text-slate-700">{data.organization.name}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 min-h-[40px] sm:min-h-[32px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link to="/expenses">
            <Button
              size="sm"
              className="flex items-center gap-1.5 bg-forest-900 hover:bg-forest-700 text-white min-h-[40px] sm:min-h-[32px]"
            >
              <Wallet className="w-3.5 h-3.5" />
              Submit Expense Claim
            </Button>
          </Link>
        </div>
      </div>

      {/* Banking Readiness Banner */}
      {myClaims && !myClaims.hasBankDetails && (
        <div className="rounded-md border border-amber-200 bg-amber-50/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-900">
                Reimbursement Bank Details Missing
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Add your Australian BSB & Account Number so approved expense claims can be paid via EFT.
              </p>
            </div>
          </div>
          <Link to="/settings">
            <Button size="sm" variant="outline" className="min-h-[40px] sm:min-h-[32px]">
              <Landmark className="w-3.5 h-3.5 mr-1.5" />
              Add Bank Details
            </Button>
          </Link>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Pending Reimbursement
          </p>
          <p className="font-mono text-2xl font-medium tabular-nums text-slate-900 mt-2">
            {formatMoney(myClaims?.pendingReimbursementCents ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">
            {myClaims?.submittedCount ?? 0} Submitted · {myClaims?.approvedCount ?? 0} Approved
          </p>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Reimbursed (Recent)
          </p>
          <p className="font-mono text-2xl font-medium tabular-nums text-emerald-700 mt-2">
            {formatMoney(myClaims?.totalPaidCents ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">
            {myClaims?.paidCount ?? 0} Paid claim(s)
          </p>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Payout Banking Status
          </p>
          <div className="mt-2 flex items-center gap-2">
            {myClaims?.hasBankDetails ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-800">Configured</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-800">Action Needed</span>
              </>
            )}
          </div>
          <Link
            to="/settings"
            className="text-[11px] font-medium text-forest-900 hover:underline mt-1.5 inline-block"
          >
            Manage payout details →
          </Link>
        </div>
      </div>

      {/* Recent Expense Claims */}
      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-900">My Recent Expense Claims</h2>
          <Link
            to="/expenses"
            className="text-xs font-medium text-forest-900 hover:underline inline-flex items-center gap-0.5"
          >
            View All <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {!myClaims || myClaims.recentClaims.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              You have not submitted any expense claims yet.
            </div>
          ) : (
            myClaims.recentClaims.map((clm) => (
              <Link
                key={clm.id}
                to="/expenses"
                className="px-4 py-3 min-h-[52px] flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-900 truncate">
                    <span className="font-mono text-slate-500 mr-1.5">{clm.claimNumber}</span>
                    {clm.title}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                    {new Date(clm.createdAt).toLocaleDateString('en-AU')}
                  </p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <StatusTag label={clm.status} tone={resolveStatusTone(clm.status)} />
                  <span className="font-mono text-xs font-medium tabular-nums text-slate-900">
                    {formatMoney(clm.totalCents)}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
