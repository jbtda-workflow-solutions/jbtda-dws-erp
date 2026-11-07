import React, { useEffect, useState, useMemo } from 'react';
import {
  BookOpen,
  Search,
  CheckCircle2,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  AlertCircle,
} from 'lucide-react';
import {
  ledgerApi,
  type JournalEntry,
  type AccountWithBalance,
  type LedgerTotals,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';

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

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LedgerPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [totals, setTotals] = useState<LedgerTotals>({
    totalDebitsCents: 0,
    totalCreditsCents: 0,
    isBalanced: true,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'ENTRIES' | 'ACCOUNTS'>('ENTRIES');

  // Filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [referenceTypeFilter, setReferenceTypeFilter] = useState<string>('ALL');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');

  // Fetch data
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, accountsRes] = await Promise.all([
        ledgerApi.list({
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          referenceType: referenceTypeFilter !== 'ALL' ? referenceTypeFilter : undefined,
          accountId: selectedAccountId !== 'ALL' ? selectedAccountId : undefined,
          search: search.trim() || undefined,
        }),
        ledgerApi.accounts(),
      ]);

      setEntries(entriesRes.entries);
      setTotals(entriesRes.totals);
      setTotalCount(entriesRes.totalCount);
      setAccounts(accountsRes.accounts);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load General Ledger data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [startDate, endDate, referenceTypeFilter, selectedAccountId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchData();
  };

  // Filter accounts by search in ACCOUNTS tab
  const filteredAccounts = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.toLowerCase();
    return accounts.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-slate-900">
            General Ledger
          </h1>
          <p className="text-sm font-light text-slate-500 mt-1">
            Complete double-entry audit trail and Chart of Accounts balances.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === 'ENTRIES' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('ENTRIES')}
            className="inline-flex items-center gap-1.5 text-xs h-8"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Journal Entries</span>
          </Button>
          <Button
            variant={activeTab === 'ACCOUNTS' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('ACCOUNTS')}
            className="inline-flex items-center gap-1.5 text-xs h-8"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Trial Balance</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-light text-slate-500">Total Entries</span>
            <BookOpen className="w-4 h-4 text-forest-700" />
          </div>
          <p className="text-xl font-mono font-medium text-slate-900 mt-1">
            {totalCount}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Posted double-entry records</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-light text-slate-500">Total Debits</span>
            <ArrowDownLeft className="w-4 h-4 text-slate-600" />
          </div>
          <p className="text-xl font-mono font-medium text-slate-900 mt-1">
            {formatCents(totals.totalDebitsCents)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Sum of all debit lines</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-light text-slate-500">Total Credits</span>
            <ArrowUpRight className="w-4 h-4 text-slate-600" />
          </div>
          <p className="text-xl font-mono font-medium text-slate-900 mt-1">
            {formatCents(totals.totalCreditsCents)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Sum of all credit lines</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-light text-slate-500">Ledger Health</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                totals.isBalanced
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {totals.isBalanced ? 'Balanced (ΣD = ΣC)' : 'Imbalance Detected'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Double-entry accounting invariant</p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        {/* Controls Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder={
                activeTab === 'ENTRIES'
                  ? 'Search description or memo…'
                  : 'Search account code or name…'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-9 pr-3 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 focus:border-forest-900 transition-colors"
            />
          </form>

          {activeTab === 'ENTRIES' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500 font-light">From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 px-2 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500 font-light">To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 px-2 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                />
              </div>

              <select
                value={referenceTypeFilter}
                onChange={(e) => setReferenceTypeFilter(e.target.value)}
                className="h-8 px-2 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 text-slate-700"
              >
                <option value="ALL">All Event Types</option>
                <option value="INVOICE">Invoices (AR)</option>
                <option value="PAYMENT_IN">Payments In (AR)</option>
                <option value="BILL">Bills (AP)</option>
                <option value="PAYMENT_OUT">Payments Out (AP)</option>
              </select>

              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="h-8 px-2 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 text-slate-700 max-w-[160px] truncate"
              >
                <option value="ALL">All Accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name}
                  </option>
                ))}
              </select>

              {(startDate || endDate || referenceTypeFilter !== 'ALL' || selectedAccountId !== 'ALL' || search) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setReferenceTypeFilter('ALL');
                    setSelectedAccountId('ALL');
                    setSearch('');
                  }}
                  className="text-xs h-8 py-0"
                >
                  Reset
                </Button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 text-xs flex items-center gap-2 border-b border-red-100">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tab 1: Journal Entries */}
        {activeTab === 'ENTRIES' && (
          <div>
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
                <p className="text-sm font-light text-slate-500">Loading journal entries…</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="py-20 text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-forest-50 flex items-center justify-center mx-auto mb-4">
                  <BookOpen className="w-5 h-5 text-forest-700" />
                </div>
                <p className="text-base font-medium text-slate-800">No journal entries found</p>
                <p className="text-sm font-light text-slate-400 mt-1 max-w-sm mx-auto">
                  {search || startDate || endDate || referenceTypeFilter !== 'ALL' || selectedAccountId !== 'ALL'
                    ? 'No entries match your search criteria. Try adjusting your filters.'
                    : 'Journal entries will appear here automatically when bills, invoices, or payments are processed.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {entries.map((entry) => {
                  const entryDebits = entry.lines
                    .filter((l) => l.entryType === 'DEBIT')
                    .reduce((sum, l) => sum + l.amountCents, 0);
                  const entryCredits = entry.lines
                    .filter((l) => l.entryType === 'CREDIT')
                    .reduce((sum, l) => sum + l.amountCents, 0);
                  const isEntryBalanced = entryDebits === entryCredits;

                  return (
                    <div key={entry.id} className="p-4 hover:bg-slate-50/50 transition-colors">
                      {/* Entry Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5">
                        <div className="flex items-center gap-2">
                          <ReferenceTypeBadge type={entry.referenceType} />
                          <p className="font-medium text-slate-900 text-xs">
                            {entry.description}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span className="font-mono text-slate-400">
                            {formatDateTime(entry.postedAt)}
                          </span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono ${
                              isEntryBalanced
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-red-50 text-red-700 font-bold'
                            }`}
                          >
                            {isEntryBalanced ? 'Balanced' : 'Imbalanced'}
                          </span>
                        </div>
                      </div>

                      {/* Entry Lines Sub-table */}
                      <div className="border border-slate-200/80 rounded-lg overflow-hidden bg-white text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50/80 text-slate-500 font-medium border-b border-slate-100">
                            <tr>
                              <th className="py-2 px-3">Account Code & Name</th>
                              <th className="py-2 px-3 text-right">Debit ($ AUD)</th>
                              <th className="py-2 px-3 text-right">Credit ($ AUD)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono">
                            {entry.lines.map((line) => (
                              <tr key={line.id} className="hover:bg-slate-50/40">
                                <td className="py-1.5 px-3 font-sans text-slate-800">
                                  <span className="font-mono font-medium text-forest-900 mr-2">
                                    {line.account.code}
                                  </span>
                                  <span>{line.account.name}</span>
                                </td>
                                <td className="py-1.5 px-3 text-right text-slate-800">
                                  {line.entryType === 'DEBIT'
                                    ? formatCents(line.amountCents)
                                    : '—'}
                                </td>
                                <td className="py-1.5 px-3 text-right text-slate-800">
                                  {line.entryType === 'CREDIT'
                                    ? formatCents(line.amountCents)
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Trial Balance / Accounts */}
        {activeTab === 'ACCOUNTS' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Account Name</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Normal Balance</th>
                  <th className="py-3 px-4 text-right">Total Debits</th>
                  <th className="py-3 px-4 text-right">Total Credits</th>
                  <th className="py-3 px-4 text-right">Net Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-forest-900">
                      {acc.code}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {acc.name}
                    </td>
                    <td className="py-3 px-4">
                      <AccountTypeBadge type={acc.type} />
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                      {acc.normalBalance}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-700">
                      {formatCents(acc.debitsCents)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-700">
                      {formatCents(acc.creditsCents)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                      {formatCents(acc.netBalanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-medium text-slate-900 border-t border-slate-200">
                <tr>
                  <td colSpan={4} className="py-3 px-4">
                    Trial Balance Totals
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold">
                    {formatCents(totals.totalDebitsCents)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold">
                    {formatCents(totals.totalCreditsCents)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                    {totals.isBalanced ? '$0.00 (Balanced)' : 'Imbalanced'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function ReferenceTypeBadge({ type }: { type: string }) {
  switch (type) {
    case 'INVOICE':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200">
          AR Invoice
        </span>
      );
    case 'PAYMENT_IN':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200">
          AR Payment
        </span>
      );
    case 'BILL':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-50 text-purple-700 border border-purple-200">
          AP Bill
        </span>
      );
    case 'PAYMENT_OUT':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-50 text-amber-700 border border-amber-200">
          AP Payment
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
          {type}
        </span>
      );
  }
}

function AccountTypeBadge({ type }: { type: string }) {
  switch (type) {
    case 'ASSET':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700">
          Asset
        </span>
      );
    case 'LIABILITY':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
          Liability
        </span>
      );
    case 'EQUITY':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
          Equity
        </span>
      );
    case 'REVENUE':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700">
          Revenue
        </span>
      );
    case 'EXPENSE':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
          Expense
        </span>
      );
    default:
      return <span className="text-[10px] text-slate-500">{type}</span>;
  }
}
