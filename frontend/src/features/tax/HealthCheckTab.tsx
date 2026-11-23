import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Lock,
  Download,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import {
  taxCloseApi,
  reportsApi,
  type TaxHealthCheckResponse,
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

export function HealthCheckTab({ canWrite }: { canWrite: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(`${today.slice(0, 4)}-07-01`);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState<TaxHealthCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await taxCloseApi.getHealthCheck({ startDate, endDate });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to run period close health check.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHealth();
  }, [startDate, endDate]);

  const handleLockPeriod = async () => {
    if (!window.confirm(`Lock accounting period on or before ${endDate}? No backdated postings will be permitted.`)) {
      return;
    }
    setLocking(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await reportsApi.lockBasPeriod(endDate);
      setFeedback(res.message || `Accounting period locked up to ${endDate}.`);
      await loadHealth();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to lock period.');
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-md border border-slate-200 bg-white p-3.5 flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md flex-1">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Period Start
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Period End
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void loadHealth()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Re-Run Checks
          </Button>
          <a
            href={taxCloseApi.workpaperPackUrl(endDate)}
            download
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800"
          >
            <Download className="w-3.5 h-3.5 text-forest-700" />
            Export EOFY Workpaper Pack (.CSV)
          </a>
          {canWrite && (
            <Button size="sm" loading={locking} onClick={() => void handleLockPeriod()}>
              <Lock className="w-3.5 h-3.5 mr-1.5" />
              Lock Period ≤ {endDate}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {feedback}
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {/* Readiness Banner */}
          <div className="rounded-md border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                Period-Close & BAS Readiness Score
              </p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="font-mono text-3xl font-semibold text-slate-900">
                  {data.readinessScorePercent}%
                </span>
                <span className="text-xs text-slate-500">
                  {data.organization.lockDate
                    ? `Current Lock Date: ${data.organization.lockDate}`
                    : 'No accounting period lock date configured'}
                </span>
              </div>
            </div>
            <div className="w-full sm:w-56 h-2.5 rounded bg-slate-100 overflow-hidden">
              <div
                style={{ width: `${data.readinessScorePercent}%` }}
                className={`h-full ${
                  data.readinessScorePercent === 100
                    ? 'bg-emerald-600'
                    : data.readinessScorePercent >= 60
                      ? 'bg-amber-500'
                      : 'bg-rose-600'
                }`}
              />
            </div>
          </div>

          {/* Diagnostic Checklist */}
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
            {data.checklist.map((item) => {
              const Icon =
                item.status === 'PASS'
                  ? CheckCircle2
                  : item.status === 'FAIL'
                    ? XCircle
                    : item.status === 'WARN'
                      ? AlertTriangle
                      : Info;
              const iconColor =
                item.status === 'PASS'
                  ? 'text-emerald-600'
                  : item.status === 'FAIL'
                    ? 'text-rose-600'
                    : item.status === 'WARN'
                      ? 'text-amber-600'
                      : 'text-slate-500';
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  className="px-4 py-3 min-h-[52px] flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900">{item.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{item.detail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {item.count}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </Link>
              );
            })}
          </div>

          {/* GST Exception Drill-Down Tables */}
          {(data.gstExceptions.billsMissingVendorAbn.length > 0 ||
            data.gstExceptions.invoicesMissingCustomerAbn.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.gstExceptions.billsMissingVendorAbn.length > 0 && (
                <div className="rounded-md border border-rose-200 bg-white overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-rose-200 bg-rose-50/70">
                    <h3 className="text-xs font-medium text-rose-900">
                      GST Input Credits Claimed Without Vendor ABN ({data.gstExceptions.billsMissingVendorAbn.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <tbody className="divide-y divide-slate-100">
                        {data.gstExceptions.billsMissingVendorAbn.map((b) => (
                          <tr key={b.id}>
                            <td className="px-3 py-2 font-mono text-slate-500">{b.issueDate}</td>
                            <td className="px-3 py-2 font-medium text-slate-900">{b.contactName}</td>
                            <td className="px-3 py-2 text-right font-mono text-rose-700">
                              GST {formatMoney(b.gstCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {data.gstExceptions.invoicesMissingCustomerAbn.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-white overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-amber-200 bg-amber-50/70">
                    <h3 className="text-xs font-medium text-amber-900">
                      $1,000+ Tax Invoices Missing Customer ABN ({data.gstExceptions.invoicesMissingCustomerAbn.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <tbody className="divide-y divide-slate-100">
                        {data.gstExceptions.invoicesMissingCustomerAbn.map((i) => (
                          <tr key={i.id}>
                            <td className="px-3 py-2 font-mono text-slate-500">{i.invoiceNumber}</td>
                            <td className="px-3 py-2 font-medium text-slate-900">{i.contactName}</td>
                            <td className="px-3 py-2 text-right font-mono text-slate-800">
                              {formatMoney(i.totalCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
