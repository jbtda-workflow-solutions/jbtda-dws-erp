import { useState } from 'react';
import { ShieldCheck, FileSpreadsheet, TrendingUp, Landmark } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { HealthCheckTab } from '@/features/tax/HealthCheckTab';
import { CashAccrualBasTab } from '@/features/tax/CashAccrualBasTab';
import { CashFlowComparativeTab } from '@/features/tax/CashFlowComparativeTab';
import { FixedAssetsTab } from '@/features/tax/FixedAssetsTab';

type TaxTab = 'HEALTH' | 'BAS_BASIS' | 'ANALYTICS' | 'FIXED_ASSETS';

export function TaxClosePage() {
  const { role } = useAuth();
  const canWrite = role === 'ADMIN' || role === 'ACCOUNTANT';
  const [activeTab, setActiveTab] = useState<TaxTab>('HEALTH');

  const tabs: Array<{ key: TaxTab; label: string; icon: typeof ShieldCheck }> = [
    { key: 'HEALTH', label: 'Period-Close Health Check', icon: ShieldCheck },
    { key: 'BAS_BASIS', label: 'Cash vs. Accrual BAS', icon: FileSpreadsheet },
    { key: 'ANALYTICS', label: 'Cash Flow & Comparative P&L', icon: TrendingUp },
    { key: 'FIXED_ASSETS', label: 'Fixed Assets & Depreciation', icon: Landmark },
  ];

  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-slate-200">
        <h1 className="text-xl font-medium tracking-tight text-slate-900">
          Tax Agent & Period-Close Workbench
        </h1>
        <p className="text-xs font-light text-slate-500 mt-1">
          Month-end & BAS readiness diagnostics, Cash vs. Accrual ATO BAS worksheets, Statement of Cash Flows, Comparative P&L, Fixed Asset Depreciation, and EOFY workpaper exports.
        </p>
      </div>

      {/* Responsive Horizontal Sub-Navigation Tab Bar */}
      <div className="border-b border-slate-200 overflow-x-auto no-print">
        <div className="flex items-center gap-1 min-w-max">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2.5 min-h-[40px] text-xs transition-colors border-b-2 whitespace-nowrap ${
                  active
                    ? 'border-forest-900 text-forest-900 font-medium'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'HEALTH' && <HealthCheckTab canWrite={canWrite} />}
      {activeTab === 'BAS_BASIS' && <CashAccrualBasTab />}
      {activeTab === 'ANALYTICS' && <CashFlowComparativeTab />}
      {activeTab === 'FIXED_ASSETS' && <FixedAssetsTab canWrite={canWrite} />}
    </div>
  );
}
