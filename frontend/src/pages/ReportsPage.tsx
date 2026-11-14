import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText,
  BarChart3,
  Scale,
  Calendar,
  Lock,
  Printer,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Filter,
  DollarSign,
  TrendingUp,
  Receipt,
} from 'lucide-react';
import {
  reportsApi,
  accountApi,
  type TrialBalanceReport,
  type ProfitAndLossReport,
  type BalanceSheetReport,
  type AgedReceivablesReport,
  type AgedPayablesReport,
  type BasReport,
  type TrackingCategory,
} from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

type ReportTab = 'PL' | 'BALANCE_SHEET' | 'TRIAL_BALANCE' | 'AGED_AR' | 'AGED_AP' | 'BAS';

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatABN(raw?: string | null): string {
  if (!raw) return '—';
  const clean = raw.replace(/\D/g, '');
  if (clean.length === 11) {
    return `${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5, 8)} ${clean.slice(8, 11)}`;
  }
  return raw;
}

export function ReportsPage() {
  const { organization, role } = useAuth();
  const [activeTab, setActiveTab] = useState<ReportTab>('PL');

  // Shared date state
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [asOfDate, setAsOfDate] = useState<string>(todayStr);

  // P&L Filters
  const currentYear = new Date().getFullYear();
  const [plStartDate, setPlStartDate] = useState<string>(`${currentYear}-01-01`);
  const [plEndDate, setPlEndDate] = useState<string>(todayStr);
  const [plTrackingOptionId, setPlTrackingOptionId] = useState<string>('');
  const [trackingCategories, setTrackingCategories] = useState<TrackingCategory[]>([]);

  // BAS Filters
  const [basPeriod, setBasPeriod] = useState<'QUARTERLY' | 'MONTHLY'>('QUARTERLY');
  const [basYear, setBasYear] = useState<number>(currentYear);
  const [basQuarter, setBasQuarter] = useState<number>(Math.floor(new Date().getMonth() / 3) + 1);
  const [basMonth, setBasMonth] = useState<number>(new Date().getMonth() + 1);

  // Report Data
  const [plReport, setPlReport] = useState<ProfitAndLossReport | null>(null);
  const [bsReport, setBsReport] = useState<BalanceSheetReport | null>(null);
  const [tbReport, setTbReport] = useState<TrialBalanceReport | null>(null);
  const [arReport, setArReport] = useState<AgedReceivablesReport | null>(null);
  const [apReport, setApReport] = useState<AgedPayablesReport | null>(null);
  const [basReport, setBasReport] = useState<BasReport | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedContacts, setExpandedContacts] = useState<Record<string, boolean>>({});

  // Lock BAS state
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockingPeriod, setLockingPeriod] = useState(false);

  // Load tracking categories once
  useEffect(() => {
    async function loadDimensions() {
      try {
        const res = await accountApi.listTrackingCategories();
        setTrackingCategories(res.categories || []);
      } catch {
        // tolerate
      }
    }
    void loadDimensions();
  }, []);

  // Fetch active report
  useEffect(() => {
    let cancelled = false;
    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        if (activeTab === 'PL') {
          const res = await reportsApi.getProfitAndLoss({
            startDate: plStartDate,
            endDate: plEndDate,
            trackingOptionId: plTrackingOptionId || undefined,
          });
          if (!cancelled) setPlReport(res);
        } else if (activeTab === 'BALANCE_SHEET') {
          const res = await reportsApi.getBalanceSheet(asOfDate);
          if (!cancelled) setBsReport(res);
        } else if (activeTab === 'TRIAL_BALANCE') {
          const res = await reportsApi.getTrialBalance(asOfDate);
          if (!cancelled) setTbReport(res);
        } else if (activeTab === 'AGED_AR') {
          const res = await reportsApi.getAgedReceivables(asOfDate);
          if (!cancelled) setArReport(res);
        } else if (activeTab === 'AGED_AP') {
          const res = await reportsApi.getAgedPayables(asOfDate);
          if (!cancelled) setApReport(res);
        } else if (activeTab === 'BAS') {
          const res = await reportsApi.getBas({
            period: basPeriod,
            year: basYear,
            quarter: basPeriod === 'QUARTERLY' ? basQuarter : undefined,
            month: basPeriod === 'MONTHLY' ? basMonth : undefined,
          });
          if (!cancelled) setBasReport(res);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load report data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    asOfDate,
    plStartDate,
    plEndDate,
    plTrackingOptionId,
    basPeriod,
    basYear,
    basQuarter,
    basMonth,
  ]);

  const toggleContactExpand = (id: string) => {
    setExpandedContacts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handlePrint = () => {
    window.print();
  };

  const handleLockBas = async () => {
    if (!basReport) return;
    setLockingPeriod(true);
    try {
      await reportsApi.lockBasPeriod(basReport.endDate);
      setLockModalOpen(false);
      // Reload BAS report
      const res = await reportsApi.getBas({
        period: basPeriod,
        year: basYear,
        quarter: basPeriod === 'QUARTERLY' ? basQuarter : undefined,
        month: basPeriod === 'MONTHLY' ? basMonth : undefined,
      });
      setBasReport(res);
    } catch (err: any) {
      alert(err.message || 'Failed to lock BAS period.');
    } finally {
      setLockingPeriod(false);
    }
  };

  const canLockPeriod = role === 'ADMIN' || role === 'ACCOUNTANT';

  return (
    <div className="space-y-4">
      {/* Top Header & Export Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200 no-print print:hidden">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-slate-900">
            Financial Reports
          </h1>
          <p className="text-xs text-slate-500 font-sans mt-0.5">
            Real-time General Ledger financial statements, statutory ATO BAS engine, and AR/AP aging schedules.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Report</span>
          </Button>
        </div>
      </div>

      {/* Report Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto no-print print:hidden">
        <button
          type="button"
          onClick={() => setActiveTab('PL')}
          className={`flex items-center gap-2 px-4 py-2 text-xs border-b-2 transition-colors whitespace-nowrap -mb-px ${
            activeTab === 'PL'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Profit & Loss</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('BALANCE_SHEET')}
          className={`flex items-center gap-2 px-4 py-2 text-xs border-b-2 transition-colors whitespace-nowrap -mb-px ${
            activeTab === 'BALANCE_SHEET'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <Scale className="w-3.5 h-3.5" />
          <span>Balance Sheet</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('TRIAL_BALANCE')}
          className={`flex items-center gap-2 px-4 py-2 text-xs border-b-2 transition-colors whitespace-nowrap -mb-px ${
            activeTab === 'TRIAL_BALANCE'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Trial Balance</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('AGED_AR')}
          className={`flex items-center gap-2 px-4 py-2 text-xs border-b-2 transition-colors whitespace-nowrap -mb-px ${
            activeTab === 'AGED_AR'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span>Aged Receivables (A/R)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('AGED_AP')}
          className={`flex items-center gap-2 px-4 py-2 text-xs border-b-2 transition-colors whitespace-nowrap -mb-px ${
            activeTab === 'AGED_AP'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>Aged Payables (A/P)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('BAS')}
          className={`flex items-center gap-2 px-4 py-2 text-xs border-b-2 transition-colors whitespace-nowrap -mb-px ${
            activeTab === 'BAS'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>Australian BAS Engine</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-md p-3 flex flex-wrap items-center justify-between gap-3 text-xs no-print print:hidden">
        {activeTab === 'PL' ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700">Date Range:</span>
              <input
                type="date"
                value={plStartDate}
                onChange={(e) => setPlStartDate(e.target.value)}
                className="px-2 py-1 rounded border border-slate-300 font-mono text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={plEndDate}
                onChange={(e) => setPlEndDate(e.target.value)}
                className="px-2 py-1 rounded border border-slate-300 font-mono text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {/* Quick date presets */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const y = now.getFullYear();
                  const m = String(now.getMonth() + 1).padStart(2, '0');
                  setPlStartDate(`${y}-${m}-01`);
                  setPlEndDate(todayStr);
                }}
                className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 text-[11px] text-slate-700"
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const y = now.getFullYear();
                  setPlStartDate(`${y}-01-01`);
                  setPlEndDate(todayStr);
                }}
                className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 text-[11px] text-slate-700"
              >
                Year to Date
              </button>
            </div>

            {/* Tracking Category / Cost Center Filter */}
            {trackingCategories.length > 0 && (
              <div className="flex items-center gap-1.5 ml-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-semibold text-slate-700">Tracking:</span>
                <select
                  value={plTrackingOptionId}
                  onChange={(e) => setPlTrackingOptionId(e.target.value)}
                  className="px-2 py-1 rounded border border-slate-300 font-sans text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">All Categories & Cost Centers</option>
                  {trackingCategories.map((cat) => (
                    <optgroup key={cat.id} label={cat.name}>
                      {cat.options.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : activeTab === 'BAS' ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Period:</span>
              <select
                value={basPeriod}
                onChange={(e) => setBasPeriod(e.target.value as any)}
                className="px-2 py-1 rounded border border-slate-300 font-sans text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="QUARTERLY">Quarterly (Standard BAS)</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Year:</span>
              <input
                type="number"
                value={basYear}
                onChange={(e) => setBasYear(Number(e.target.value))}
                className="w-20 px-2 py-1 rounded border border-slate-300 font-mono text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {basPeriod === 'QUARTERLY' ? (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">Quarter:</span>
                <select
                  value={basQuarter}
                  onChange={(e) => setBasQuarter(Number(e.target.value))}
                  className="px-2 py-1 rounded border border-slate-300 font-sans text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value={1}>Q1 (Jul 1 – Sep 30)</option>
                  <option value={2}>Q2 (Oct 1 – Dec 31)</option>
                  <option value={3}>Q3 (Jan 1 – Mar 31)</option>
                  <option value={4}>Q4 (Apr 1 – Jun 30)</option>
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">Month:</span>
                <select
                  value={basMonth}
                  onChange={(e) => setBasMonth(Number(e.target.value))}
                  className="px-2 py-1 rounded border border-slate-300 font-sans text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {new Date(2026, m - 1, 1).toLocaleString('en-AU', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-semibold text-slate-700">As of Date:</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="px-2 py-1 rounded border border-slate-300 font-mono text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={() => setAsOfDate(todayStr)}
              className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 text-[11px] text-slate-700 ml-1"
            >
              Today
            </button>
          </div>
        )}

        <div className="flex items-center gap-3">
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs font-mono">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Recalculating...</span>
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-md flex items-center gap-2 text-xs no-print print:hidden">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Report Document Sheet */}
      <div id="report-print-sheet" className="bg-white border border-slate-200 rounded-md p-6 sm:p-8">
        {/* Printable Organization Header */}
        <div className="pb-6 border-b border-slate-200 mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold font-mono text-slate-900 tracking-tight">
              {organization?.name || 'Company Name'}
            </h2>
            <p className="text-xs font-mono text-slate-600 mt-0.5">
              ABN: {formatABN(organization?.abn)}
            </p>
          </div>
          <div className="text-right">
            <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-slate-800">
              {activeTab === 'PL' && 'PROFIT & LOSS STATEMENT'}
              {activeTab === 'BALANCE_SHEET' && 'BALANCE SHEET'}
              {activeTab === 'TRIAL_BALANCE' && 'TRIAL BALANCE'}
              {activeTab === 'AGED_AR' && 'AGED RECEIVABLES SUMMARY'}
              {activeTab === 'AGED_AP' && 'AGED PAYABLES SUMMARY'}
              {activeTab === 'BAS' && 'BUSINESS ACTIVITY STATEMENT (BAS)'}
            </h3>
            <p className="text-xs font-mono text-slate-500 mt-0.5">
              {activeTab === 'PL' && `For the period ${plStartDate} to ${plEndDate}`}
              {activeTab === 'BAS' && (basReport ? basReport.periodLabel : `FY${basYear}`)}
              {activeTab !== 'PL' && activeTab !== 'BAS' && `As of ${asOfDate}`}
            </p>
          </div>
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* TAB 1: PROFIT & LOSS                                               */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === 'PL' && plReport && (
          <div className="space-y-6 max-w-4xl mx-auto">
            {plReport.trackingOptionName && (
              <div className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-700">
                Segment / Cost Center: <span className="font-bold">{plReport.trackingOptionName}</span>
              </div>
            )}

            {/* Revenue */}
            <div>
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-900 text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                <span>REVENUE</span>
                <span>AUD</span>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {plReport.revenue.map((r) => (
                  <div key={r.id} className="py-2 flex items-center justify-between hover:bg-slate-50/50">
                    <span className="text-slate-700">
                      <span className="font-mono text-slate-400 mr-2">{r.code}</span>
                      {r.name}
                    </span>
                    <span className="font-mono text-slate-900">{formatCents(r.amountCents)}</span>
                  </div>
                ))}
                {plReport.revenue.length === 0 && (
                  <div className="py-2 text-slate-400 italic text-xs">No revenue recorded in this period.</div>
                )}
              </div>
              <div className="pt-2 flex items-center justify-between font-bold text-xs border-t border-slate-200">
                <span className="uppercase text-slate-900">Total Revenue</span>
                <span className="font-mono text-slate-900">{formatCents(plReport.totalRevenueCents)}</span>
              </div>
            </div>

            {/* Cost of Goods Sold */}
            {plReport.costOfGoodsSold.length > 0 && (
              <div>
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-300 text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                  <span>COST OF GOODS SOLD (COGS)</span>
                  <span>AUD</span>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {plReport.costOfGoodsSold.map((c) => (
                    <div key={c.id} className="py-2 flex items-center justify-between hover:bg-slate-50/50">
                      <span className="text-slate-700">
                        <span className="font-mono text-slate-400 mr-2">{c.code}</span>
                        {c.name}
                      </span>
                      <span className="font-mono text-slate-900">{formatCents(c.amountCents)}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 flex items-center justify-between font-bold text-xs border-t border-slate-200">
                  <span className="uppercase text-slate-900">Total Cost of Goods Sold</span>
                  <span className="font-mono text-slate-900">{formatCents(plReport.totalCogsCents)}</span>
                </div>
              </div>
            )}

            {/* Gross Profit Bar */}
            <div className="p-3 bg-slate-100 rounded border border-slate-300 flex items-center justify-between font-bold text-sm">
              <span className="text-slate-900 uppercase font-mono">GROSS PROFIT</span>
              <span className="font-mono text-slate-950">{formatCents(plReport.grossProfitCents)}</span>
            </div>

            {/* Operating Expenses */}
            <div>
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-900 text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                <span>OPERATING EXPENSES</span>
                <span>AUD</span>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {plReport.operatingExpenses.map((e) => (
                  <div key={e.id} className="py-2 flex items-center justify-between hover:bg-slate-50/50">
                    <span className="text-slate-700">
                      <span className="font-mono text-slate-400 mr-2">{e.code}</span>
                      {e.name}
                    </span>
                    <span className="font-mono text-slate-900">{formatCents(e.amountCents)}</span>
                  </div>
                ))}
                {plReport.operatingExpenses.length === 0 && (
                  <div className="py-2 text-slate-400 italic text-xs">No operating expenses in this period.</div>
                )}
              </div>
              <div className="pt-2 flex items-center justify-between font-bold text-xs border-t border-slate-200">
                <span className="uppercase text-slate-900">Total Operating Expenses</span>
                <span className="font-mono text-slate-900">{formatCents(plReport.totalOperatingExpenseCents)}</span>
              </div>
            </div>

            {/* Net Operating Profit Banner */}
            <div
              className={`p-4 rounded border flex items-center justify-between font-bold text-base ${
                plReport.netOperatingProfitCents >= 0
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="uppercase font-mono">NET OPERATING PROFIT</span>
                {plReport.netOperatingProfitCents >= 0 ? (
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 font-mono">
                    Surplus
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded bg-rose-200 text-rose-900 font-mono">
                    Deficit
                  </span>
                )}
              </div>
              <span className="font-mono text-lg">{formatCents(plReport.netOperatingProfitCents)}</span>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 2: BALANCE SHEET                                               */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === 'BALANCE_SHEET' && bsReport && (
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* Balance check banner */}
            <div
              className={`p-3 rounded border flex items-center justify-between text-xs font-mono ${
                bsReport.isBalanced
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="flex items-center gap-2">
                {bsReport.isBalanced ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                )}
                <span>
                  {bsReport.isBalanced
                    ? 'BALANCE SHEET INTEGRITY: Assets equal Liabilities + Equity (Balanced)'
                    : `IMBALANCE DETECTED: Discrepancy of ${formatCents(bsReport.discrepancyCents)}`}
                </span>
              </div>
              <span>A = L + E</span>
            </div>

            {/* ASSETS */}
            <div>
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-900 text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                <span>ASSETS</span>
                <span>AUD</span>
              </div>

              {/* Current Assets */}
              <div className="mt-3">
                <p className="text-[11px] font-mono uppercase font-bold text-slate-500 mb-1">Current Assets</p>
                <div className="divide-y divide-slate-100 text-xs">
                  {bsReport.assets.currentAssets.map((a) => (
                    <div key={a.id} className="py-2 flex items-center justify-between hover:bg-slate-50/50">
                      <span className="text-slate-700">
                        <span className="font-mono text-slate-400 mr-2">{a.code}</span>
                        {a.name}
                      </span>
                      <span className="font-mono text-slate-900">{formatCents(a.amountCents)}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 flex items-center justify-between text-xs font-semibold border-t border-slate-100">
                  <span className="text-slate-600">Total Current Assets</span>
                  <span className="font-mono">{formatCents(bsReport.assets.totalCurrentAssetsCents)}</span>
                </div>
              </div>

              {/* Non-Current Assets */}
              {bsReport.assets.nonCurrentAssets.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] font-mono uppercase font-bold text-slate-500 mb-1">Non-Current Assets</p>
                  <div className="divide-y divide-slate-100 text-xs">
                    {bsReport.assets.nonCurrentAssets.map((a) => (
                      <div key={a.id} className="py-2 flex items-center justify-between hover:bg-slate-50/50">
                        <span className="text-slate-700">
                          <span className="font-mono text-slate-400 mr-2">{a.code}</span>
                          {a.name}
                        </span>
                        <span className="font-mono text-slate-900">{formatCents(a.amountCents)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 flex items-center justify-between text-xs font-semibold border-t border-slate-100">
                    <span className="text-slate-600">Total Non-Current Assets</span>
                    <span className="font-mono">{formatCents(bsReport.assets.totalNonCurrentAssetsCents)}</span>
                  </div>
                </div>
              )}

              <div className="mt-4 p-3 bg-slate-100 rounded border border-slate-300 flex items-center justify-between font-bold text-sm">
                <span className="text-slate-900 uppercase font-mono">TOTAL ASSETS</span>
                <span className="font-mono text-slate-950">{formatCents(bsReport.totalAssetsCents)}</span>
              </div>
            </div>

            {/* LIABILITIES */}
            <div>
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-900 text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                <span>LIABILITIES</span>
                <span>AUD</span>
              </div>

              {/* Current Liabilities */}
              <div className="mt-3">
                <p className="text-[11px] font-mono uppercase font-bold text-slate-500 mb-1">Current Liabilities</p>
                <div className="divide-y divide-slate-100 text-xs">
                  {bsReport.liabilities.currentLiabilities.map((l) => (
                    <div key={l.id} className="py-2 flex items-center justify-between hover:bg-slate-50/50">
                      <span className="text-slate-700">
                        <span className="font-mono text-slate-400 mr-2">{l.code}</span>
                        {l.name}
                      </span>
                      <span className="font-mono text-slate-900">{formatCents(l.amountCents)}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 flex items-center justify-between text-xs font-semibold border-t border-slate-100">
                  <span className="text-slate-600">Total Current Liabilities</span>
                  <span className="font-mono">{formatCents(bsReport.liabilities.totalCurrentLiabilitiesCents)}</span>
                </div>
              </div>

              {/* Non-Current Liabilities */}
              {bsReport.liabilities.nonCurrentLiabilities.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] font-mono uppercase font-bold text-slate-500 mb-1">Non-Current Liabilities</p>
                  <div className="divide-y divide-slate-100 text-xs">
                    {bsReport.liabilities.nonCurrentLiabilities.map((l) => (
                      <div key={l.id} className="py-2 flex items-center justify-between hover:bg-slate-50/50">
                        <span className="text-slate-700">
                          <span className="font-mono text-slate-400 mr-2">{l.code}</span>
                          {l.name}
                        </span>
                        <span className="font-mono text-slate-900">{formatCents(l.amountCents)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 flex items-center justify-between text-xs font-semibold border-t border-slate-100">
                    <span className="text-slate-600">Total Non-Current Liabilities</span>
                    <span className="font-mono">{formatCents(bsReport.liabilities.totalNonCurrentLiabilitiesCents)}</span>
                  </div>
                </div>
              )}

              <div className="mt-4 p-3 bg-slate-50 rounded border border-slate-200 flex items-center justify-between font-bold text-xs">
                <span className="text-slate-900 uppercase font-mono">TOTAL LIABILITIES</span>
                <span className="font-mono text-slate-900">{formatCents(bsReport.liabilities.totalLiabilitiesCents)}</span>
              </div>
            </div>

            {/* EQUITY */}
            <div>
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-900 text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                <span>EQUITY</span>
                <span>AUD</span>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {bsReport.equity.accounts.map((eq) => (
                  <div key={eq.id} className="py-2 flex items-center justify-between hover:bg-slate-50/50">
                    <span className="text-slate-700">
                      <span className="font-mono text-slate-400 mr-2">{eq.code}</span>
                      {eq.name}
                    </span>
                    <span className="font-mono text-slate-900">{formatCents(eq.amountCents)}</span>
                  </div>
                ))}
                {/* Dynamically calculated Current Year Earnings */}
                <div className="py-2 flex items-center justify-between bg-emerald-50/40 px-2 rounded">
                  <span className="font-medium text-emerald-950">
                    Current Year Earnings (Unappropriated Net Income)
                  </span>
                  <span className="font-mono font-bold text-emerald-900">
                    {formatCents(bsReport.equity.currentYearEarningsCents)}
                  </span>
                </div>
              </div>
              <div className="mt-3 p-3 bg-slate-50 rounded border border-slate-200 flex items-center justify-between font-bold text-xs">
                <span className="text-slate-900 uppercase font-mono">TOTAL EQUITY</span>
                <span className="font-mono text-slate-900">{formatCents(bsReport.equity.totalEquityCents)}</span>
              </div>
            </div>

            {/* Total Liabilities & Equity Summary */}
            <div className="p-4 bg-slate-900 text-white rounded flex items-center justify-between font-bold text-base">
              <span className="uppercase font-mono">TOTAL LIABILITIES & EQUITY</span>
              <span className="font-mono text-lg">{formatCents(bsReport.totalLiabilitiesAndEquityCents)}</span>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 3: TRIAL BALANCE                                               */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === 'TRIAL_BALANCE' && tbReport && (
          <div className="space-y-4">
            <div
              className={`p-3 rounded border flex items-center justify-between text-xs font-mono ${
                tbReport.isBalanced
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="flex items-center gap-2">
                {tbReport.isBalanced ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                )}
                <span>
                  {tbReport.isBalanced
                    ? 'TRIAL BALANCE IN PERFECT EQUILIBRIUM: Total Debits == Total Credits'
                    : `OUT OF BALANCE BY: ${formatCents(Math.abs(tbReport.differenceCents))}`}
                </span>
              </div>
              <span>Difference: {formatCents(tbReport.differenceCents)}</span>
            </div>

            <div className="border border-slate-200 rounded overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-white font-mono text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3 w-20">Code</th>
                    <th className="py-2.5 px-3">Account Name</th>
                    <th className="py-2.5 px-3 w-28">Type</th>
                    <th className="py-2.5 px-3 w-24 text-center">Normal</th>
                    <th className="py-2.5 px-3 text-right w-36">Debit (AUD)</th>
                    <th className="py-2.5 px-3 text-right w-36">Credit (AUD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {tbReport.accounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-slate-50/60">
                      <td className="py-2 px-3 font-mono text-slate-600 font-bold">{acc.code}</td>
                      <td className="py-2 px-3 font-medium text-slate-900">{acc.name}</td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-500">{acc.type}</td>
                      <td className="py-2 px-3 text-center font-mono text-[10px] text-slate-400">
                        {acc.normalBalance}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-800">
                        {acc.debitsCents > 0 ? formatCents(acc.debitsCents) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-800">
                        {acc.creditsCents > 0 ? formatCents(acc.creditsCents) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100 font-mono font-bold text-xs border-t-2 border-slate-900">
                  <tr>
                    <td colSpan={4} className="py-3 px-3 uppercase text-slate-900">
                      TOTALS
                    </td>
                    <td className="py-3 px-3 text-right text-slate-950 font-bold">
                      {formatCents(tbReport.totalDebitsCents)}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-950 font-bold">
                      {formatCents(tbReport.totalCreditsCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 4: AGED RECEIVABLES (A/R)                                      */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === 'AGED_AR' && arReport && (
          <div className="space-y-6">
            {/* Aging Summary Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <p className="text-[10px] font-mono uppercase text-slate-500 font-bold">Total A/R</p>
                <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                  {formatCents(arReport.totalOutstandingCents)}
                </p>
              </div>
              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded">
                <p className="text-[10px] font-mono uppercase text-emerald-800 font-bold">Current</p>
                <p className="text-base font-bold font-mono text-emerald-900 mt-0.5">
                  {formatCents(arReport.totals.currentCents)}
                </p>
              </div>
              <div className="p-3 bg-amber-50/60 border border-amber-200 rounded">
                <p className="text-[10px] font-mono uppercase text-amber-800 font-bold">1–30 Days</p>
                <p className="text-base font-bold font-mono text-amber-900 mt-0.5">
                  {formatCents(arReport.totals.days1to30Cents)}
                </p>
              </div>
              <div className="p-3 bg-amber-50/60 border border-amber-200 rounded">
                <p className="text-[10px] font-mono uppercase text-amber-800 font-bold">31–60 Days</p>
                <p className="text-base font-bold font-mono text-amber-900 mt-0.5">
                  {formatCents(arReport.totals.days31to60Cents)}
                </p>
              </div>
              <div className="p-3 bg-rose-50/60 border border-rose-200 rounded">
                <p className="text-[10px] font-mono uppercase text-rose-800 font-bold">61–90 Days</p>
                <p className="text-base font-bold font-mono text-rose-900 mt-0.5">
                  {formatCents(arReport.totals.days61to90Cents)}
                </p>
              </div>
              <div className="p-3 bg-rose-100 border border-rose-300 rounded">
                <p className="text-[10px] font-mono uppercase text-rose-900 font-bold">90+ Days</p>
                <p className="text-base font-bold font-mono text-rose-950 mt-0.5">
                  {formatCents(arReport.totals.days90PlusCents)}
                </p>
              </div>
            </div>

            {/* Customers Aging Table */}
            <div className="border border-slate-200 rounded overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-white font-mono text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3 text-right">Current</th>
                    <th className="py-2.5 px-3 text-right">1–30 Days</th>
                    <th className="py-2.5 px-3 text-right">31–60 Days</th>
                    <th className="py-2.5 px-3 text-right">61–90 Days</th>
                    <th className="py-2.5 px-3 text-right">90+ Days</th>
                    <th className="py-2.5 px-3 text-right font-bold">Total Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {arReport.contacts.map((c) => {
                    const isExpanded = Boolean(expandedContacts[c.contactId]);
                    return (
                      <React.Fragment key={c.contactId}>
                        <tr
                          onClick={() => toggleContactExpand(c.contactId)}
                          className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                        >
                          <td className="py-2.5 px-3 font-medium text-slate-900 flex items-center gap-1.5">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                            <span>{c.contactName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({c.invoices.length} {c.invoices.length === 1 ? 'inv' : 'invs'})
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            {c.currentCents > 0 ? formatCents(c.currentCents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-700">
                            {c.days1to30Cents > 0 ? formatCents(c.days1to30Cents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-800">
                            {c.days31to60Cents > 0 ? formatCents(c.days31to60Cents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-rose-700 font-semibold">
                            {c.days61to90Cents > 0 ? formatCents(c.days61to90Cents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-rose-800 font-bold">
                            {c.days90PlusCents > 0 ? formatCents(c.days90PlusCents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-950">
                            {formatCents(c.totalCents)}
                          </td>
                        </tr>

                        {/* Expanded Invoices breakdown */}
                        {isExpanded && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={7} className="p-3 pl-8">
                              <table className="w-full text-[11px] bg-white border border-slate-200 rounded">
                                <thead className="bg-slate-100 text-slate-700 font-mono">
                                  <tr>
                                    <th className="py-1 px-2 text-left">Invoice #</th>
                                    <th className="py-1 px-2 text-left">Issue Date</th>
                                    <th className="py-1 px-2 text-left">Due Date</th>
                                    <th className="py-1 px-2 text-center">Days Overdue</th>
                                    <th className="py-1 px-2 text-right">Invoiced</th>
                                    <th className="py-1 px-2 text-right">Paid</th>
                                    <th className="py-1 px-2 text-right font-bold">Balance Due</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {c.invoices.map((inv) => (
                                    <tr key={inv.id}>
                                      <td className="py-1 px-2 font-mono font-medium text-slate-900">
                                        {inv.invoiceNumber}
                                      </td>
                                      <td className="py-1 px-2 text-slate-600">{formatDate(inv.issueDate)}</td>
                                      <td className="py-1 px-2 text-slate-600">{formatDate(inv.dueDate)}</td>
                                      <td className="py-1 px-2 text-center font-mono">
                                        {inv.daysOverdue > 0 ? (
                                          <span className="text-rose-700 font-bold">+{inv.daysOverdue}d</span>
                                        ) : (
                                          <span className="text-emerald-700">Current</span>
                                        )}
                                      </td>
                                      <td className="py-1 px-2 text-right font-mono text-slate-600">
                                        {formatCents(inv.totalCents)}
                                      </td>
                                      <td className="py-1 px-2 text-right font-mono text-slate-500">
                                        {formatCents(inv.amountPaidCents)}
                                      </td>
                                      <td className="py-1 px-2 text-right font-mono font-bold text-slate-900">
                                        {formatCents(inv.balanceDueCents)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {arReport.contacts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 text-xs italic">
                        No outstanding customer invoices as of {asOfDate}.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-100 font-mono font-bold text-xs border-t-2 border-slate-900">
                  <tr>
                    <td className="py-3 px-3 uppercase text-slate-900">TOTAL RECEIVABLES</td>
                    <td className="py-3 px-3 text-right">{formatCents(arReport.totals.currentCents)}</td>
                    <td className="py-3 px-3 text-right">{formatCents(arReport.totals.days1to30Cents)}</td>
                    <td className="py-3 px-3 text-right">{formatCents(arReport.totals.days31to60Cents)}</td>
                    <td className="py-3 px-3 text-right">{formatCents(arReport.totals.days61to90Cents)}</td>
                    <td className="py-3 px-3 text-right">{formatCents(arReport.totals.days90PlusCents)}</td>
                    <td className="py-3 px-3 text-right font-bold text-slate-950">
                      {formatCents(arReport.totalOutstandingCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 5: AGED PAYABLES (A/P)                                         */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === 'AGED_AP' && apReport && (
          <div className="space-y-6">
            {/* Aging Summary Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <p className="text-[10px] font-mono uppercase text-slate-500 font-bold">Total A/P</p>
                <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                  {formatCents(apReport.totalOutstandingCents)}
                </p>
              </div>
              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded">
                <p className="text-[10px] font-mono uppercase text-emerald-800 font-bold">Current</p>
                <p className="text-base font-bold font-mono text-emerald-900 mt-0.5">
                  {formatCents(apReport.totals.currentCents)}
                </p>
              </div>
              <div className="p-3 bg-amber-50/60 border border-amber-200 rounded">
                <p className="text-[10px] font-mono uppercase text-amber-800 font-bold">1–30 Days</p>
                <p className="text-base font-bold font-mono text-amber-900 mt-0.5">
                  {formatCents(apReport.totals.days1to30Cents)}
                </p>
              </div>
              <div className="p-3 bg-amber-50/60 border border-amber-200 rounded">
                <p className="text-[10px] font-mono uppercase text-amber-800 font-bold">31–60 Days</p>
                <p className="text-base font-bold font-mono text-amber-900 mt-0.5">
                  {formatCents(apReport.totals.days31to60Cents)}
                </p>
              </div>
              <div className="p-3 bg-rose-50/60 border border-rose-200 rounded">
                <p className="text-[10px] font-mono uppercase text-rose-800 font-bold">61–90 Days</p>
                <p className="text-base font-bold font-mono text-rose-900 mt-0.5">
                  {formatCents(apReport.totals.days61to90Cents)}
                </p>
              </div>
              <div className="p-3 bg-rose-100 border border-rose-300 rounded">
                <p className="text-[10px] font-mono uppercase text-rose-900 font-bold">90+ Days</p>
                <p className="text-base font-bold font-mono text-rose-950 mt-0.5">
                  {formatCents(apReport.totals.days90PlusCents)}
                </p>
              </div>
            </div>

            {/* Vendors Aging Table */}
            <div className="border border-slate-200 rounded overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-white font-mono text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Supplier / Vendor</th>
                    <th className="py-2.5 px-3 text-right">Current</th>
                    <th className="py-2.5 px-3 text-right">1–30 Days</th>
                    <th className="py-2.5 px-3 text-right">31–60 Days</th>
                    <th className="py-2.5 px-3 text-right">61–90 Days</th>
                    <th className="py-2.5 px-3 text-right">90+ Days</th>
                    <th className="py-2.5 px-3 text-right font-bold">Total Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {apReport.contacts.map((c) => {
                    const isExpanded = Boolean(expandedContacts[c.contactId]);
                    return (
                      <React.Fragment key={c.contactId}>
                        <tr
                          onClick={() => toggleContactExpand(c.contactId)}
                          className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                        >
                          <td className="py-2.5 px-3 font-medium text-slate-900 flex items-center gap-1.5">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                            <span>{c.contactName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({c.bills.length} {c.bills.length === 1 ? 'bill' : 'bills'})
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            {c.currentCents > 0 ? formatCents(c.currentCents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-700">
                            {c.days1to30Cents > 0 ? formatCents(c.days1to30Cents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-800">
                            {c.days31to60Cents > 0 ? formatCents(c.days31to60Cents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-rose-700 font-semibold">
                            {c.days61to90Cents > 0 ? formatCents(c.days61to90Cents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-rose-800 font-bold">
                            {c.days90PlusCents > 0 ? formatCents(c.days90PlusCents) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-950">
                            {formatCents(c.totalCents)}
                          </td>
                        </tr>

                        {/* Expanded Bills breakdown */}
                        {isExpanded && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={7} className="p-3 pl-8">
                              <table className="w-full text-[11px] bg-white border border-slate-200 rounded">
                                <thead className="bg-slate-100 text-slate-700 font-mono">
                                  <tr>
                                    <th className="py-1 px-2 text-left">Vendor Ref</th>
                                    <th className="py-1 px-2 text-left">Issue Date</th>
                                    <th className="py-1 px-2 text-left">Due Date</th>
                                    <th className="py-1 px-2 text-center">Days Overdue</th>
                                    <th className="py-1 px-2 text-right">Billed</th>
                                    <th className="py-1 px-2 text-right">Paid</th>
                                    <th className="py-1 px-2 text-right font-bold">Balance Due</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {c.bills.map((b) => (
                                    <tr key={b.id}>
                                      <td className="py-1 px-2 font-mono font-medium text-slate-900">
                                        {b.reference || '—'}
                                      </td>
                                      <td className="py-1 px-2 text-slate-600">{formatDate(b.issueDate)}</td>
                                      <td className="py-1 px-2 text-slate-600">{formatDate(b.dueDate)}</td>
                                      <td className="py-1 px-2 text-center font-mono">
                                        {b.daysOverdue > 0 ? (
                                          <span className="text-rose-700 font-bold">+{b.daysOverdue}d</span>
                                        ) : (
                                          <span className="text-emerald-700">Current</span>
                                        )}
                                      </td>
                                      <td className="py-1 px-2 text-right font-mono text-slate-600">
                                        {formatCents(b.totalCents)}
                                      </td>
                                      <td className="py-1 px-2 text-right font-mono text-slate-500">
                                        {formatCents(b.amountPaidCents)}
                                      </td>
                                      <td className="py-1 px-2 text-right font-mono font-bold text-slate-900">
                                        {formatCents(b.balanceDueCents)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {apReport.contacts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 text-xs italic">
                        No outstanding supplier bills as of {asOfDate}.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-100 font-mono font-bold text-xs border-t-2 border-slate-900">
                  <tr>
                    <td className="py-3 px-3 uppercase text-slate-900">TOTAL PAYABLES</td>
                    <td className="py-3 px-3 text-right">{formatCents(apReport.totals.currentCents)}</td>
                    <td className="py-3 px-3 text-right">{formatCents(apReport.totals.days1to30Cents)}</td>
                    <td className="py-3 px-3 text-right">{formatCents(apReport.totals.days31to60Cents)}</td>
                    <td className="py-3 px-3 text-right">{formatCents(apReport.totals.days61to90Cents)}</td>
                    <td className="py-3 px-3 text-right">{formatCents(apReport.totals.days90PlusCents)}</td>
                    <td className="py-3 px-3 text-right font-bold text-slate-950">
                      {formatCents(apReport.totalOutstandingCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 6: AUSTRALIAN BAS ENGINE (GST WORKSHEET)                       */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === 'BAS' && basReport && (
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* Status bar & Lock action */}
            <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-slate-700">
                  BAS TAX PERIOD: {basReport.startDate} to {basReport.endDate}
                </span>
                {basReport.isPeriodLocked ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                    <Lock className="w-3 h-3 text-amber-700" />
                    <span>LOCKED & FROZEN</span>
                  </span>
                ) : (
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300">
                    OPEN & DYNAMIC
                  </span>
                )}
              </div>

              {!basReport.isPeriodLocked && canLockPeriod && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLockModalOpen(true)}
                  className="no-print print:hidden inline-flex items-center gap-1.5 text-xs text-amber-800 border-amber-300 hover:bg-amber-50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock BAS Period</span>
                </Button>
              )}
            </div>

            {/* Official ATO BAS Worksheet Box Cards */}
            <div className="space-y-4">
              <h4 className="text-xs font-mono font-bold text-slate-900 uppercase tracking-wider pb-1 border-b border-slate-300">
                GST WORKSHEET CALCULATION (ATO FORM FORMAT)
              </h4>

              {/* G1 */}
              <div className="p-4 bg-white border border-slate-300 rounded flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-slate-900 text-white font-mono text-xs font-bold rounded">
                      G1
                    </span>
                    <span className="text-sm font-semibold text-slate-900">Total Sales</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Gross revenue from issued customer invoices and direct income receipts (GST inclusive).
                  </p>
                </div>
                <span className="font-mono text-base font-bold text-slate-900">
                  {formatCents(basReport.g1TotalSalesCents)}
                </span>
              </div>

              {/* G2 / G3 */}
              <div className="p-4 bg-white border border-slate-200 rounded flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-slate-200 text-slate-800 font-mono text-xs font-bold rounded">
                      G2 / G3
                    </span>
                    <span className="text-sm font-semibold text-slate-900">Export & GST-Free Sales</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Sales items specifically coded with GST-Free tax treatment.
                  </p>
                </div>
                <span className="font-mono text-sm text-slate-700">
                  {formatCents(basReport.g2G3GstFreeSalesCents)}
                </span>
              </div>

              {/* G10 Capital */}
              <div className="p-4 bg-white border border-slate-200 rounded flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-slate-200 text-slate-800 font-mono text-xs font-bold rounded">
                      G10
                    </span>
                    <span className="text-sm font-semibold text-slate-900">Capital Purchases</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Capital acquisitions and fixed assets purchased during this period.
                  </p>
                </div>
                <span className="font-mono text-sm text-slate-700">
                  {formatCents(basReport.g10CapitalPurchasesCents)}
                </span>
              </div>

              {/* G11 Non-Capital */}
              <div className="p-4 bg-white border border-slate-200 rounded flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-slate-200 text-slate-800 font-mono text-xs font-bold rounded">
                      G11
                    </span>
                    <span className="text-sm font-semibold text-slate-900">Non-Capital Purchases</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    General business expenses, supplier bills, direct spend, and employee claims.
                  </p>
                </div>
                <span className="font-mono text-sm text-slate-700">
                  {formatCents(basReport.g11NonCapitalPurchasesCents)}
                </span>
              </div>

              {/* 1A: GST on Sales */}
              <div className="p-4 bg-emerald-50/50 border border-emerald-300 rounded flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-emerald-800 text-white font-mono text-xs font-bold rounded">
                      1A
                    </span>
                    <span className="text-sm font-semibold text-emerald-950">GST on Sales (Collected)</span>
                  </div>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Net credit postings to account 2100 GST Collected minus reversals and customer credit notes.
                  </p>
                </div>
                <span className="font-mono text-base font-bold text-emerald-950">
                  {formatCents(basReport.oneAGstCents)}
                </span>
              </div>

              {/* 1B: GST on Purchases */}
              <div className="p-4 bg-blue-50/50 border border-blue-300 rounded flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-blue-800 text-white font-mono text-xs font-bold rounded">
                      1B
                    </span>
                    <span className="text-sm font-semibold text-blue-950">GST on Purchases (Paid)</span>
                  </div>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Net debit postings to account 2200 GST Paid minus vendor credits.
                  </p>
                </div>
                <span className="font-mono text-base font-bold text-blue-950">
                  {formatCents(basReport.oneBGstCents)}
                </span>
              </div>

              {/* Net GST Settlement Box */}
              <div
                className={`p-5 rounded-lg border-2 flex items-center justify-between ${
                  basReport.netGstType === 'PAYABLE'
                    ? 'bg-amber-50 border-amber-400 text-amber-950'
                    : 'bg-emerald-50 border-emerald-400 text-emerald-950'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold uppercase tracking-wider">
                      NET GST RESULT (BOX 1A MINUS BOX 1B)
                    </span>
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                        basReport.netGstType === 'PAYABLE'
                          ? 'bg-amber-200 text-amber-950'
                          : 'bg-emerald-200 text-emerald-950'
                      }`}
                    >
                      {basReport.netGstType === 'PAYABLE'
                        ? 'NET GST PAYABLE TO ATO'
                        : 'NET GST REFUND FROM ATO'}
                    </span>
                  </div>
                  <p className="text-xs mt-1 text-slate-700">
                    {basReport.netGstType === 'PAYABLE'
                      ? 'Payment must be remitted to the Australian Taxation Office by the BAS due date.'
                      : 'Refund will be credited to the registered corporate bank account.'}
                  </p>
                </div>
                <span className="font-mono text-2xl font-black">
                  {formatCents(Math.abs(basReport.netGstCents))}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Lock BAS Period Modal */}
      {basReport && (
        <Modal
          open={lockModalOpen}
          onClose={() => setLockModalOpen(false)}
          title="Lock Accounting Period (BAS)"
          size="lg"
        >
          <div className="space-y-4 text-xs text-slate-700">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-amber-900">Period Lock Warning</p>
                <p className="mt-0.5 text-amber-800">
                  Locking this BAS period will set the organization's accounting lock date to{' '}
                  <span className="font-mono font-bold">{basReport.endDate}</span>.
                </p>
                <p className="mt-1 text-amber-800">
                  No bills, invoices, expense claims, direct transactions, or manual journals dated on or before
                  this date may be created, edited, approved, or posted.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded font-mono space-y-1">
              <p>Organization: {basReport.organization.name}</p>
              <p>ABN: {formatABN(basReport.organization.abn)}</p>
              <p>Period: {basReport.periodLabel}</p>
              <p>Effective Lock Date: {basReport.endDate}</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setLockModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleLockBas}
                disabled={lockingPeriod}
                className="bg-amber-700 hover:bg-amber-800 text-white"
              >
                {lockingPeriod ? 'Locking...' : 'Confirm & Freeze Period'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default ReportsPage;
