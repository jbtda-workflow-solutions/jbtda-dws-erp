import { useState } from 'react';
import { Search, ArrowRightLeft } from 'lucide-react';
import {
  bookkeepingApi,
  type FindRecodeLine,
  type AccountWithBalance,
  type TrackingCategory,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface FindRecodeTabProps {
  accounts: AccountWithBalance[];
  trackingCategories: TrackingCategory[];
}

export function FindRecodeTab({ accounts, trackingCategories }: FindRecodeTabProps) {
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<FindRecodeLine[]>([]);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const [targetAccountId, setTargetAccountId] = useState('');
  const [targetTrackingOptionId, setTargetTrackingOptionId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('Bookkeeping reclassification');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const allTrackingOptions = trackingCategories.flatMap((c) =>
    c.options.map((o) => ({ id: o.id, label: `${c.name}: ${o.name}` })),
  );

  const nonSystemAccounts = accounts.filter((a) => !a.isSystem);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await bookkeepingApi.previewFindRecode({
        accountId: sourceAccountId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search.trim() || undefined,
      });
      setLines(res.lines);
      setSelectedIds({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  };

  const chosenIds = Object.entries(selectedIds)
    .filter(([, checked]) => checked)
    .map(([id]) => id);

  const handleApply = async () => {
    if (chosenIds.length === 0) {
      setError('Select at least one posted journal line to recode.');
      return;
    }
    if (!targetAccountId && !targetTrackingOptionId) {
      setError('Choose a target GL account or target cost centre.');
      return;
    }

    setApplying(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await bookkeepingApi.applyFindRecode({
        lineIds: chosenIds,
        targetAccountId: targetAccountId || undefined,
        targetTrackingOptionId: targetTrackingOptionId ? targetTrackingOptionId : undefined,
        effectiveDate,
        reason,
      });
      setSuccess(
        `Posted reclassification journal ${res.entryNumber ?? res.journalId} covering ${res.recodedLineCount} line(s).`,
      );
      await handleSearch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Find & Recode failed.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-white p-4 space-y-3">
        <div>
          <h2 className="text-sm font-medium text-slate-900">Find & Recode (Batch Reclassification)</h2>
          <p className="text-xs text-slate-500">
            Search posted non-system GL lines and reclassify them in one atomic, audit-trailed journal entry.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <select
            value={sourceAccountId}
            onChange={(e) => setSourceAccountId(e.target.value)}
            className="h-9 rounded border border-slate-200 px-2.5 text-xs"
          >
            <option value="">Any Custom Account</option>
            {nonSystemAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search narration…"
            className="h-9 rounded border border-slate-200 px-2.5 text-xs"
          />
          <Button size="sm" loading={loading} onClick={() => void handleSearch()}>
            <Search className="w-3.5 h-3.5 mr-1.5" />
            Find Lines
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {success}
        </div>
      )}

      {/* Results + Recode Action Bar */}
      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="p-3.5 border-b border-slate-200 bg-slate-50/70 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 items-end">
          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">
              Recode To Account
            </label>
            <select
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              className="w-full h-8 rounded border border-slate-200 bg-white px-2 text-xs"
            >
              <option value="">Keep Current Account</option>
              {nonSystemAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">
              Recode To Cost Centre
            </label>
            <select
              value={targetTrackingOptionId}
              onChange={(e) => setTargetTrackingOptionId(e.target.value)}
              className="w-full h-8 rounded border border-slate-200 bg-white px-2 text-xs"
            >
              <option value="">Keep Current Dimension</option>
              {allTrackingOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">
              Reclass Date
            </label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full h-8 rounded border border-slate-200 bg-white px-2 text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">
              Audit Reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-8 rounded border border-slate-200 bg-white px-2 text-xs"
            />
          </div>
          <Button
            size="sm"
            loading={applying}
            disabled={chosenIds.length === 0}
            onClick={() => void handleApply()}
          >
            <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />
            Recode Selected ({chosenIds.length})
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={lines.length > 0 && chosenIds.length === lines.length}
                    onChange={(e) => {
                      const next: Record<string, boolean> = {};
                      if (e.target.checked) lines.forEach((l) => (next[l.id] = true));
                      setSelectedIds(next);
                    }}
                  />
                </th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Journal</th>
                <th className="px-3 py-2">Current Account</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Use the filters above and click "Find Lines" to locate transactions to recode.
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.id} className={selectedIds[l.id] ? 'bg-forest-50/40' : ''}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedIds[l.id])}
                        onChange={(e) =>
                          setSelectedIds((prev) => ({ ...prev, [l.id]: e.target.checked }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                      {new Date(l.journalEntry.postedAt).toLocaleDateString('en-AU')}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">
                      {l.journalEntry.entryNumber || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-mono text-slate-500 mr-1">{l.account.code}</span>
                      {l.account.name}
                    </td>
                    <td className="px-3 py-2 text-slate-700 max-w-[260px] truncate">
                      {l.description || l.journalEntry.description}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{l.entryType}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                      {formatMoney(l.amountCents)}
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
