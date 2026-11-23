import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, ExternalLink, Search, CheckCircle2, Clock } from 'lucide-react';
import {
  bookkeepingApi,
  type AccountTransactionsResponse,
  type AccountWithBalance,
  type TrackingCategory,
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

interface AccountTransactionsTabProps {
  accounts: AccountWithBalance[];
  trackingCategories: TrackingCategory[];
  initialAccountId?: string;
  initialStartDate?: string;
  initialEndDate?: string;
}

export function AccountTransactionsTab({
  accounts,
  trackingCategories,
  initialAccountId = '',
  initialStartDate = '',
  initialEndDate = '',
}: AccountTransactionsTabProps) {
  const [accountId, setAccountId] = useState(initialAccountId);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [trackingOptionId, setTrackingOptionId] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AccountTransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialAccountId) setAccountId(initialAccountId);
  }, [initialAccountId]);

  const loadRegister = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await bookkeepingApi.getAccountTransactions({
        accountId: accountId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        trackingOptionId: trackingOptionId || undefined,
        search: search.trim() || undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load account transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRegister();
  }, [accountId, startDate, endDate, trackingOptionId]);

  const allTrackingOptions = trackingCategories.flatMap((c) =>
    c.options.map((o) => ({ id: o.id, label: `${c.name}: ${o.name}` })),
  );

  return (
    <div className="space-y-4">
      {/* Filter Toolbar */}
      <div className="rounded-md border border-slate-200 bg-white p-3.5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              GL Account
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-none focus:border-forest-700"
            >
              <option value="">All Accounts (Full Register)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 bg-white px-2.5 text-xs font-mono text-slate-800"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 bg-white px-2.5 text-xs font-mono text-slate-800"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Cost Centre
            </label>
            <select
              value={trackingOptionId}
              onChange={(e) => setTrackingOptionId(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
            >
              <option value="">All Dimensions</option>
              {allTrackingOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Search Narration / Ref
            </label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void loadRegister();
                  }}
                  placeholder="JNL, invoice, text…"
                  className="w-full h-9 rounded border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-800"
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadRegister()} disabled={loading}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </div>

        {/* Summary Strip */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
            <div className="rounded bg-slate-50 px-3 py-2 border border-slate-100">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Opening Balance</p>
              <p className="font-mono text-sm font-medium tabular-nums text-slate-900 mt-0.5">
                {data.account ? formatMoney(data.openingBalanceCents) : '—'}
              </p>
            </div>
            <div className="rounded bg-slate-50 px-3 py-2 border border-slate-100">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Period Debits</p>
              <p className="font-mono text-sm font-medium tabular-nums text-slate-900 mt-0.5">
                {formatMoney(data.totalDebitsCents)}
              </p>
            </div>
            <div className="rounded bg-slate-50 px-3 py-2 border border-slate-100">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Period Credits</p>
              <p className="font-mono text-sm font-medium tabular-nums text-slate-900 mt-0.5">
                {formatMoney(data.totalCreditsCents)}
              </p>
            </div>
            <div className="rounded bg-forest-50/60 px-3 py-2 border border-forest-200">
              <p className="text-[10px] uppercase tracking-wider text-forest-900">Closing Balance</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-forest-900 mt-0.5">
                {data.closingBalanceCents !== null ? formatMoney(data.closingBalanceCents) : `${data.count} lines`}
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Account Transactions Register Table */}
      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Journal #</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                {data?.account && <th className="px-3 py-2 text-right">Running Bal</th>}
                <th className="px-3 py-2 text-center">Rec</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    Loading account register…
                  </td>
                </tr>
              ) : !data || data.transactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No posted transactions found for the selected filter.
                  </td>
                </tr>
              ) : (
                data.transactions.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                      {new Date(row.postedAt).toLocaleDateString('en-AU')}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-800 whitespace-nowrap">
                      {row.entryNumber || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setAccountId(row.accountId)}
                        className="text-left hover:text-forest-900 hover:underline"
                        title="Filter register to this account"
                      >
                        <span className="font-mono text-slate-500 mr-1">{row.accountCode}</span>
                        <span className="text-slate-800 font-medium">{row.accountName}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-700 max-w-[280px] truncate">
                      {row.description}
                      {row.trackingOptionName && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono text-slate-600">
                          {row.trackingOptionName}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        to={row.sourceHref}
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-forest-800 hover:underline"
                      >
                        {row.referenceType.replace(/_/g, ' ')}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {row.debitCents > 0 ? formatMoney(row.debitCents) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {row.creditCents > 0 ? formatMoney(row.creditCents) : '—'}
                    </td>
                    {data.account && (
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                        {row.runningBalanceCents !== null ? formatMoney(row.runningBalanceCents) : '—'}
                      </td>
                    )}
                    <td className="px-3 py-2 text-center">
                      {row.isReconciled ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mx-auto" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-slate-300 mx-auto" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
