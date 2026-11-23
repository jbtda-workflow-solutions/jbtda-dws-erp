import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, Printer } from 'lucide-react';
import {
  bookkeepingApi,
  type BankRecSummaryResponse,
  type BankAccountSummary,
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

interface BankRecReportTabProps {
  bankAccounts: BankAccountSummary[];
}

export function BankRecReportTab({ bankAccounts }: BankRecReportTabProps) {
  const [bankAccountId, setBankAccountId] = useState<string>(bankAccounts[0]?.id ?? '');
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<BankRecSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bankAccountId && bankAccounts[0]) {
      setBankAccountId(bankAccounts[0].id);
    }
  }, [bankAccounts, bankAccountId]);

  const loadSummary = async () => {
    if (!bankAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await bookkeepingApi.getReconciliationSummary({ bankAccountId, asOfDate });
      setReport(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load reconciliation summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (bankAccountId) void loadSummary();
  }, [bankAccountId, asOfDate]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-end justify-between gap-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 max-w-xl">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Bank Account
            </label>
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
            >
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Reconciliation Date
            </label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 bg-white px-2.5 text-xs font-mono text-slate-800"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void loadSummary()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5 mr-1.5" />
            Print Proof
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {/* Proof Banner */}
          <div
            className={`rounded-md border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              report.summary.isBalanced
                ? 'border-emerald-200 bg-emerald-50/70'
                : 'border-amber-200 bg-amber-50/70'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {report.summary.isBalanced ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {report.summary.isBalanced
                    ? 'Bank Reconciliation Proof Balanced'
                    : 'Reconciliation Items Outstanding'}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {report.bankAccount.code} {report.bankAccount.name} as at {report.asOfDate} ·{' '}
                  {report.unreconciledStatementCount} unreconciled statement line(s) ·{' '}
                  {report.unreconciledLedgerCount} unpresented ledger entry(s)
                </p>
              </div>
            </div>
            {report.duplicateStatementLineIds.length > 0 && (
              <span className="px-2.5 py-1 rounded bg-rose-100 border border-rose-200 text-xs font-mono text-rose-800 shrink-0">
                ⚠ {report.duplicateStatementLineIds.length} potential duplicate line(s)
              </span>
            )}
          </div>

          {/* Proof Schedule Table */}
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-600">
                Statement vs. General Ledger Proof
              </h3>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {[
                { label: 'Imported Statement Balance (All Lines)', val: report.summary.statementImportedBalanceCents },
                { label: 'Reconciled Statement Balance', val: report.summary.reconciledStatementCents, bold: true },
                { label: 'General Ledger Balance (Account ' + report.bankAccount.code + ')', val: report.summary.ledgerBalanceCents },
                { label: 'Less: Unreconciled Ledger Deposits', val: -report.summary.unreconciledDepositsCents },
                { label: 'Plus: Unpresented Ledger Payments', val: report.summary.unreconciledPaymentsCents },
                { label: 'Reconciled General Ledger Balance', val: report.summary.reconciledLedgerCents, bold: true },
                { label: 'Reconciliation Variance (Statement - GL)', val: report.summary.varianceCents, highlight: true },
              ].map((row) => (
                <div
                  key={row.label}
                  className={`px-4 py-2.5 flex items-center justify-between ${
                    row.highlight ? 'bg-slate-50 font-semibold' : row.bold ? 'font-medium' : ''
                  }`}
                >
                  <span className="text-slate-700">{row.label}</span>
                  <span
                    className={`font-mono tabular-nums ${
                      row.highlight && row.val !== 0 ? 'text-rose-700' : 'text-slate-900'
                    }`}
                  >
                    {formatMoney(row.val)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Outstanding Lists */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/60">
                <h4 className="text-xs font-medium text-slate-800">
                  Unreconciled Statement Lines ({report.unreconciledStatementCount})
                </h4>
              </div>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs text-left">
                  <tbody className="divide-y divide-slate-100">
                    {report.unreconciledStatementLines.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-center text-slate-400">
                          All imported statement lines are reconciled.
                        </td>
                      </tr>
                    ) : (
                      report.unreconciledStatementLines.map((sl) => {
                        const isDup = report.duplicateStatementLineIds.includes(sl.id);
                        return (
                          <tr key={sl.id} className={isDup ? 'bg-rose-50/40' : ''}>
                            <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                              {new Date(sl.statementDate).toLocaleDateString('en-AU')}
                            </td>
                            <td className="px-3 py-2 text-slate-800 truncate max-w-[200px]">
                              {sl.description}
                              {isDup && (
                                <span className="ml-1.5 text-[10px] font-mono text-rose-700">
                                  [DUP?]
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                              {formatMoney(sl.amountCents)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/60">
                <h4 className="text-xs font-medium text-slate-800">
                  Unpresented Ledger Entries ({report.unreconciledLedgerCount})
                </h4>
              </div>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs text-left">
                  <tbody className="divide-y divide-slate-100">
                    {report.unreconciledLedgerItems.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-center text-slate-400">
                          All posted bank ledger entries are reconciled.
                        </td>
                      </tr>
                    ) : (
                      report.unreconciledLedgerItems.map((je) => (
                        <tr key={je.id}>
                          <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                            {new Date(je.postedAt).toLocaleDateString('en-AU')}
                          </td>
                          <td className="px-3 py-2 text-slate-800 truncate max-w-[200px]">
                            <span className="font-mono text-slate-500 mr-1">{je.entryNumber}</span>
                            {je.description}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                            {formatMoney(je.amountCents)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
