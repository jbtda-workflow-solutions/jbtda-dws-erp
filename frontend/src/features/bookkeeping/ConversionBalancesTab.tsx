import { useState } from 'react';
import { Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  bookkeepingApi,
  type AccountWithBalance,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';

interface ConversionRow {
  accountId: string;
  debitDollars: string;
  creditDollars: string;
}

function toCents(raw: string): number {
  const n = Number(raw.replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ConversionBalancesTab({ accounts }: { accounts: AccountWithBalance[] }) {
  const [conversionDate, setConversionDate] = useState(
    `${new Date().getFullYear()}-07-01`,
  );
  const [notes, setNotes] = useState('Opening balances migrated from prior accounting system');
  const [rows, setRows] = useState<ConversionRow[]>([
    { accountId: accounts.find((a) => a.code === '1000')?.id ?? '', debitDollars: '', creditDollars: '' },
    { accountId: accounts.find((a) => a.code === '3000')?.id ?? '', debitDollars: '', creditDollars: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const totalDebits = rows.reduce((s, r) => s + toCents(r.debitDollars), 0);
  const totalCredits = rows.reduce((s, r) => s + toCents(r.creditDollars), 0);
  const diff = totalDebits - totalCredits;
  const isBalanced = totalDebits > 0 && diff === 0;

  const updateRow = (idx: number, patch: Partial<ConversionRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    const validLines = rows
      .filter((r) => r.accountId && (toCents(r.debitDollars) > 0 || toCents(r.creditDollars) > 0))
      .map((r) => ({
        accountId: r.accountId,
        debitCents: toCents(r.debitDollars),
        creditCents: toCents(r.creditDollars),
      }));

    if (validLines.length < 2 || !isBalanced) {
      setError('Enter at least 2 accounts where Total Debits strictly equal Total Credits.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await bookkeepingApi.postConversionBalances({
        conversionDate,
        notes,
        lines: validLines,
      });
      setSuccess(`Conversion balances posted as journal ${res.entryNumber ?? res.journalId}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to post conversion balances.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-white p-4 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-slate-900">
            Opening / Conversion Balances (Migration Wizard)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Enter your closing Trial Balance from Xero, MYOB, or QuickBooks as of your conversion date.
            Posts an atomic, balanced double-entry <code className="font-mono">CONVERSION_BALANCE</code> journal.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Conversion Date
            </label>
            <input
              type="date"
              value={conversionDate}
              onChange={(e) => setConversionDate(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Reference / Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
            />
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">GL Account</th>
                <th className="px-3 py-2 text-right w-40">Debit (AUD $)</th>
                <th className="px-3 py-2 text-right w-40">Credit (AUD $)</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2">
                    <select
                      value={r.accountId}
                      onChange={(e) => updateRow(idx, { accountId: e.target.value })}
                      className="w-full h-8 rounded border border-slate-200 px-2 text-xs"
                    >
                      <option value="">Select Account…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name} ({a.type})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={r.debitDollars}
                      onChange={(e) =>
                        updateRow(idx, { debitDollars: e.target.value, creditDollars: '' })
                      }
                      className="w-full h-8 rounded border border-slate-200 px-2 text-right font-mono text-xs"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={r.creditDollars}
                      onChange={(e) =>
                        updateRow(idx, { creditDollars: e.target.value, debitDollars: '' })
                      }
                      className="w-full h-8 rounded border border-slate-200 px-2 text-right font-mono text-xs"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={rows.length <= 2}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setRows((prev) => [...prev, { accountId: '', debitDollars: '', creditDollars: '' }])
            }
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Account Row
          </Button>

          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            <span>Debits: <strong>{formatMoney(totalDebits)}</strong></span>
            <span>Credits: <strong>{formatMoney(totalCredits)}</strong></span>
            {isBalanced ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Balanced
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" /> Out by {formatMoney(Math.abs(diff))}
              </span>
            )}
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

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button
            size="sm"
            loading={submitting}
            disabled={!isBalanced}
            onClick={() => void handleSubmit()}
          >
            Post Opening Conversion Balances
          </Button>
        </div>
      </div>
    </div>
  );
}
