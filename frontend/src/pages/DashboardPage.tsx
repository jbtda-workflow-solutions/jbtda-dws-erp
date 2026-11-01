import { FileText, Receipt, Users, TrendingUp } from 'lucide-react';

/**
 * Dashboard — overview / home page.
 * Phase F1: static placeholder cards.
 * Phase F2+: wired to real API data.
 */
export function DashboardPage() {
  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-medium tracking-tight text-slate-900">
          Dashboard
        </h1>
        <p className="text-sm font-light text-slate-500 mt-1">
          Welcome back — here's a snapshot of your financials.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard
          icon={FileText}
          label="Outstanding Invoices"
          value="—"
          sub="Awaiting payment"
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
        />
        <SummaryCard
          icon={Receipt}
          label="Unpaid Bills"
          value="—"
          sub="Due to vendors"
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
        />
        <SummaryCard
          icon={Users}
          label="Active Contacts"
          value="—"
          sub="Customers & vendors"
          iconBg="bg-forest-50"
          iconColor="text-forest-700"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Revenue (MTD)"
          value="—"
          sub="Month to date"
          iconBg="bg-green-50"
          iconColor="text-green-600"
        />
      </div>

      {/* Placeholder content */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-5 border-b border-slate-100">
          <h2 className="text-sm font-medium text-slate-900">Recent Activity</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <TrendingUp className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-600">No activity yet</p>
          <p className="text-sm font-light text-slate-400 mt-1">
            Create contacts, bills, and invoices to see activity here.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  icon: typeof FileText;
  label: string;
  value: string;
  sub: string;
  iconBg: string;
  iconColor: string;
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  iconBg,
  iconColor,
}: SummaryCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 flex items-start gap-4">
      <div
        className={`flex items-center justify-center w-10 h-10 rounded-xl shrink-0 ${iconBg}`}
      >
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider truncate">
          {label}
        </p>
        <p className="mt-1 text-2xl font-numbers tabular-nums font-medium text-slate-900">
          {value}
        </p>
        <p className="text-xs font-light text-slate-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

