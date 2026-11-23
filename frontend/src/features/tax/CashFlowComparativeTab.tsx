import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  taxCloseApi,
  type CashFlowResponse,
  type ComparativePlResponse,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';

function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}$${(abs / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatBps(bps: number | null): string {
  if (bps === null) return '—';
  const pct = (bps / 100).toFixed(1);
  return `${bps > 0 ? '+' : ''}${pct}%`;
}

export function CashFlowComparativeTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(`${today.slice(0, 4)}-07-01`);
  const [endDate, setEndDate] = useState(today);
  const [compareMode, setCompareMode] = useState<'PRIOR_PERIOD' | 'PRIOR_YEAR'>('PRIOR_PERIOD');

  const [cashFlow, setCashFlow] = useState<CashFlowResponse | null>(null);
  const [compPl, setCompPl] = useState<ComparativePlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cf, pl] = await Promise.all([
        taxCloseApi.getCashFlow({ startDate, endDate }),
        taxCloseApi.getComparativePl({ startDate, endDate, compareMode }),
      ]);
      setCashFlow(cf);
      setCompPl(pl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load financial analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [startDate, endDate, compareMode]);

  return (
    <div className="space-y-5">
      {/* Filter Bar */}
      <div className="rounded-md border border-slate-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              From
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              To
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Compare Against
            </label>
            <select
              value={compareMode}
              onChange={(e) => setCompareMode(e.target.value as 'PRIOR_PERIOD' | 'PRIOR_YEAR')}
              className="h-9 rounded border border-slate-200 px-2.5 text-xs"
            >
              <option value="PRIOR_PERIOD">Immediately Preceding Period</option>
              <option value="PRIOR_YEAR">Same Period Last Year (YoY)</option>
            </select>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Statement of Cash Flows */}
      {cashFlow && (
        <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60">
            <h2 className="text-sm font-medium text-slate-900">Statement of Cash Flows</h2>
            <p className="text-[11px] font-mono text-slate-500">
              {cashFlow.period.startDate} to {cashFlow.period.endDate}
            </p>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {[
              { label: 'Opening Cash Balance', val: cashFlow.openingCashCents, bold: true },
              { label: 'Operating Activities — Cash Inflows', val: cashFlow.operating.inflowsCents },
              { label: 'Operating Activities — Cash Outflows', val: -cashFlow.operating.outflowsCents },
              { label: 'Net Cash from Operating Activities', val: cashFlow.operating.netCents, bold: true },
              { label: 'Net Cash from Investing Activities (Fixed Assets)', val: cashFlow.investing.netCents },
              { label: 'Net Cash from Financing Activities (Equity)', val: cashFlow.financing.netCents },
              { label: 'Net Increase / (Decrease) in Cash', val: cashFlow.netCashChangeCents, bold: true },
              { label: 'Closing Cash Balance', val: cashFlow.closingCashCents, highlight: true },
            ].map((row) => (
              <div
                key={row.label}
                className={`px-4 py-2.5 flex items-center justify-between ${
                  row.highlight ? 'bg-forest-50/70 font-semibold' : row.bold ? 'font-medium bg-slate-50/40' : ''
                }`}
              >
                <span className="text-slate-700">{row.label}</span>
                <span className="font-mono tabular-nums text-slate-900">{formatMoney(row.val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comparative P&L */}
      {compPl && (
        <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60">
            <h2 className="text-sm font-medium text-slate-900">Comparative Profit & Loss</h2>
            <p className="text-[11px] font-mono text-slate-500">
              Current ({compPl.currentPeriod.startDate} → {compPl.currentPeriod.endDate}) vs Prior (
              {compPl.priorPeriod.startDate} → {compPl.priorPeriod.endDate})
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2 text-right">Current</th>
                  <th className="px-3 py-2 text-right">Prior</th>
                  <th className="px-3 py-2 text-right">$ Variance</th>
                  <th className="px-3 py-2 text-right">% Var</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50/70 font-semibold text-slate-600">
                  <td colSpan={5} className="px-3 py-1.5 text-[11px] uppercase tracking-wider">
                    Revenue
                  </td>
                </tr>
                {compPl.revenue.map((r) => (
                  <tr key={r.accountId} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <Link
                        to={`/bookkeeping?tab=REGISTER&accountId=${r.accountId}&startDate=${startDate}&endDate=${endDate}`}
                        className="hover:text-forest-900 hover:underline"
                      >
                        <span className="font-mono text-slate-500 mr-1.5">{r.code}</span>
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(r.currentCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{formatMoney(r.priorCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(r.varianceCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">{formatBps(r.varianceBps)}</td>
                  </tr>
                ))}

                <tr className="bg-slate-50/70 font-semibold text-slate-600">
                  <td colSpan={5} className="px-3 py-1.5 text-[11px] uppercase tracking-wider">
                    Expenses
                  </td>
                </tr>
                {compPl.expenses.map((r) => (
                  <tr key={r.accountId} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <Link
                        to={`/bookkeeping?tab=REGISTER&accountId=${r.accountId}&startDate=${startDate}&endDate=${endDate}`}
                        className="hover:text-forest-900 hover:underline"
                      >
                        <span className="font-mono text-slate-500 mr-1.5">{r.code}</span>
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(r.currentCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{formatMoney(r.priorCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(r.varianceCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">{formatBps(r.varianceBps)}</td>
                  </tr>
                ))}

                <tr className="bg-forest-50/70 font-semibold text-slate-900">
                  <td className="px-3 py-2.5">Net Operating Profit</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {formatMoney(compPl.totals.currentNetProfitCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {formatMoney(compPl.totals.priorNetProfitCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {formatMoney(compPl.totals.netProfitVarianceCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
