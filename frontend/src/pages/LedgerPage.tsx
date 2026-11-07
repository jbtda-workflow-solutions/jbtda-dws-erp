import React, { useEffect, useState, useMemo } from 'react';
import {
  BookOpen,
  Search,
  CheckCircle2,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  AlertCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  ledgerApi,
  type JournalEntry,
  type AccountWithBalance,
  type LedgerTotals,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

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

  // Manual Journal Entry Modal
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

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
          <Button
            size="sm"
            onClick={() => setIsManualModalOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs h-8 ml-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Journal Entry</span>
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
                <option value="MANUAL">Manual Journals</option>
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
      {/* Create Manual Journal Entry Modal */}
      <CreateManualJournalEntryModal
        open={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        accounts={accounts}
        onSuccess={() => {
          setIsManualModalOpen(false);
          void fetchData();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function ReferenceTypeBadge({ type }: { type: string }) {
  switch (type) {
    case 'MANUAL':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
          Manual Journal
        </span>
      );
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

// ---------------------------------------------------------------------------
// Create Manual Journal Entry Modal
// ---------------------------------------------------------------------------

interface ManualLineState {
  id: string;
  accountId: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: string;
}

interface CreateManualJournalEntryModalProps {
  open: boolean;
  onClose: () => void;
  accounts: AccountWithBalance[];
  onSuccess: () => void;
}

function CreateManualJournalEntryModal({
  open,
  onClose,
  accounts,
  onSuccess,
}: CreateManualJournalEntryModalProps) {
  const [description, setDescription] = useState('');
  const [postedAt, setPostedAt] = useState(() => new Date().toISOString().split('T')[0]);
  const [lines, setLines] = useState<ManualLineState[]>([
    { id: '1', accountId: '', entryType: 'DEBIT', amount: '' },
    { id: '2', accountId: '', entryType: 'CREDIT', amount: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setDescription('');
    setPostedAt(new Date().toISOString().split('T')[0]);
    setLines([
      { id: '1', accountId: '', entryType: 'DEBIT', amount: '' },
      { id: '2', accountId: '', entryType: 'CREDIT', amount: '' },
    ]);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now() + Math.random()),
        accountId: '',
        entryType: prev.length % 2 === 0 ? 'DEBIT' : 'CREDIT',
        amount: '',
      },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, field: keyof ManualLineState, value: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );
  };

  // Calculations
  const sumDebitsCents = useMemo(() => {
    return lines
      .filter((l) => l.entryType === 'DEBIT')
      .reduce((sum, l) => sum + Math.round((parseFloat(l.amount) || 0) * 100), 0);
  }, [lines]);

  const sumCreditsCents = useMemo(() => {
    return lines
      .filter((l) => l.entryType === 'CREDIT')
      .reduce((sum, l) => sum + Math.round((parseFloat(l.amount) || 0) * 100), 0);
  }, [lines]);

  const isBalanced = sumDebitsCents > 0 && sumDebitsCents === sumCreditsCents;
  const imbalanceCents = Math.abs(sumDebitsCents - sumCreditsCents);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!description.trim()) {
      setError('Please provide a memo/description for this journal entry.');
      return;
    }

    if (!isBalanced) {
      setError('Journal entry must be balanced. Total Debits must equal Total Credits.');
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.accountId) {
        setError(`Line ${i + 1} is missing an account.`);
        return;
      }
      const amtCents = Math.round((parseFloat(l.amount) || 0) * 100);
      if (amtCents <= 0) {
        setError(`Line ${i + 1} must have an amount greater than $0.00.`);
        return;
      }
    }

    setLoading(true);
    try {
      await ledgerApi.createManualEntry({
        description: description.trim(),
        postedAt: new Date(postedAt).toISOString(),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          entryType: l.entryType,
          amountCents: Math.round((parseFloat(l.amount) || 0) * 100),
        })),
      });

      resetForm();
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to post manual journal entry.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New Manual Journal Entry"
      description="Post an adjusting or general double-entry journal entry directly to the General Ledger."
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg flex items-center gap-2 border border-red-100">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Description / Memo <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Month-end depreciation adjustment, bank fee reallocation"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-8 px-3 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Posting Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              value={postedAt}
              onChange={(e) => setPostedAt(e.target.value)}
              className="w-full h-8 px-3 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
            />
          </div>
        </div>

        {/* Lines Editor */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">
              Journal Lines ({lines.length})
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLine}
              className="text-xs h-7 px-2 inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>Add Line</span>
            </Button>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3">Account</th>
                  <th className="py-2 px-3 w-28">Type</th>
                  <th className="py-2 px-3 w-32 text-right">Amount ($ AUD)</th>
                  <th className="py-2 px-2 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line, idx) => (
                  <tr key={line.id} className="hover:bg-slate-50/50">
                    <td className="p-2">
                      <select
                        value={line.accountId}
                        onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}
                        className="w-full h-8 px-2 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                      >
                        <option value="">Select Account…</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.code} - {acc.name} ({acc.type})
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="p-2">
                      <select
                        value={line.entryType}
                        onChange={(e) =>
                          updateLine(
                            line.id,
                            'entryType',
                            e.target.value as 'DEBIT' | 'CREDIT',
                          )
                        }
                        className="w-full h-8 px-2 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-medium"
                      >
                        <option value="DEBIT">DEBIT</option>
                        <option value="CREDIT">CREDIT</option>
                      </select>
                    </td>

                    <td className="p-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={line.amount}
                        onChange={(e) => updateLine(line.id, 'amount', e.target.value)}
                        className="w-full h-8 px-2 text-right font-mono text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                      />
                    </td>

                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length <= 2}
                        className="text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                        title={lines.length <= 2 ? 'Minimum 2 lines required' : 'Remove line'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-mono text-xs">
                <tr>
                  <td colSpan={2} className="py-2.5 px-3 font-sans font-medium text-slate-700">
                    Total Debits / Credits
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-slate-600">
                        Debits: {formatCents(sumDebitsCents)}
                      </span>
                      <span className="text-slate-600">
                        Credits: {formatCents(sumCreditsCents)}
                      </span>
                    </div>
                  </td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan={4} className="py-2 px-3 border-t border-slate-200/80">
                    <div className="flex items-center justify-between font-sans">
                      <span className="text-[11px] text-slate-500">Balance Status:</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium font-mono ${
                          isBalanced
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}
                      >
                        {isBalanced
                          ? 'Balanced (ΣDebits = ΣCredits)'
                          : `Out of Balance by ${formatCents(imbalanceCents)}`}
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <Button type="button" variant="outline" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!isBalanced || !description.trim() || loading}
            className="inline-flex items-center gap-1.5"
          >
            {loading ? (
              <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <BookOpen className="w-3.5 h-3.5" />
            )}
            <span>Post Journal Entry</span>
          </Button>
        </div>
      </form>
    </Modal>
  );
}
