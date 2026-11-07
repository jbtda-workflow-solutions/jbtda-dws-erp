import { BookOpen, LucideIcon } from 'lucide-react';

export function LedgerPage() {
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-medium tracking-tight text-slate-900">General Ledger</h1>
        <p className="text-sm font-light text-slate-500 mt-1">
          Double-entry journal entries.
        </p>
      </div>
      <ComingSoon icon={BookOpen} label="General Ledger module" phase="Phase F6" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared placeholder
// ---------------------------------------------------------------------------

function ComingSoon({
  icon: Icon,
  label,
  phase,
}: {
  icon: LucideIcon;
  label: string;
  phase: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col items-center justify-center py-20 text-center px-6">
      <div className="w-12 h-12 rounded-2xl bg-forest-50 flex items-center justify-center mb-4">
        <Icon className="w-5 h-5 text-forest-700" />
      </div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="text-sm font-light text-slate-400 mt-1">
        Coming in <span className="font-medium text-forest-700">{phase}</span>
      </p>
    </div>
  );
}

