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
  RotateCcw,
  Calendar,
  Play,
  Pause,
  Eye,
  Check,
  Tag,
  RefreshCw,
} from 'lucide-react';
import {
  ledgerApi,
  accountsApi,
  type JournalEntry,
  type AccountWithBalance,
  type LedgerTotals,
  type LedgerStatusCounts,
  type RecurringSchedule,
  type TrackingCategory,
  type JournalStatus,
  type Role,
  ApiError,
} from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { StatusTag, resolveStatusTone } from '@/components/ui/StatusTag';

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

type TabType =
  | 'POSTED'
  | 'PENDING_APPROVAL'
  | 'DRAFT'
  | 'REVERSED'
  | 'ALL'
  | 'RECURRING'
  | 'ACCOUNTS';

export function LedgerPage() {
  const { role } = useAuth();
  const canApproveOrPost = role === 'ADMIN' || role === 'ACCOUNTANT';

  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<TabType>('POSTED');

  // Journal Entries Data
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [trackingCategories, setTrackingCategories] = useState<TrackingCategory[]>([]);
  const [totals, setTotals] = useState<LedgerTotals>({
    totalDebitsCents: 0,
    totalCreditsCents: 0,
    isBalanced: true,
  });
  const [statusCounts, setStatusCounts] = useState<LedgerStatusCounts>({
    POSTED: 0,
    PENDING_APPROVAL: 0,
    DRAFT: 0,
    REVERSED: 0,
    ALL: 0,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [referenceTypeFilter, setReferenceTypeFilter] = useState<string>('ALL');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');
  const [selectedTrackingOptionId, setSelectedTrackingOptionId] = useState<string>('ALL');

  // Recurring Schedules State
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);

  // Manual Journal Entry Modal
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

  // Inspector Drawer State
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerReversesEntry, setDrawerReversesEntry] = useState<{
    id: string;
    entryNumber: string | null;
    description: string;
    postedAt: string;
    status: JournalStatus;
  } | null>(null);
  const [drawerReversedByEntry, setDrawerReversedByEntry] = useState<{
    id: string;
    entryNumber: string | null;
    description: string;
    postedAt: string;
    status: JournalStatus;
  } | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // 1-Click Reversal Modal State
  const [reversalTarget, setReversalTarget] = useState<JournalEntry | null>(null);
  const [reversalDate, setReversalDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [reversalReason, setReversalReason] = useState('');
  const [reversalLoading, setReversalLoading] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Fetch Master Data (Accounts & Dimensions)
  const fetchMasterData = async () => {
    try {
      const [accountsRes, catRes] = await Promise.all([
        ledgerApi.accounts(),
        accountsApi.listTrackingCategories(),
      ]);
      setAccounts(accountsRes.accounts);
      setTrackingCategories(catRes.categories);
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    void fetchMasterData();
  }, []);

  // Fetch Journal Entries
  const fetchEntries = async () => {
    if (activeTab === 'RECURRING' || activeTab === 'ACCOUNTS') return;

    setLoading(true);
    setError(null);
    try {
      const statusParam = activeTab === 'ALL' ? 'ALL' : activeTab;
      const res = await ledgerApi.list({
        status: statusParam,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        referenceType: referenceTypeFilter !== 'ALL' ? referenceTypeFilter : undefined,
        accountId: selectedAccountId !== 'ALL' ? selectedAccountId : undefined,
        trackingOptionId:
          selectedTrackingOptionId !== 'ALL' ? selectedTrackingOptionId : undefined,
        search: search.trim() || undefined,
      });

      setEntries(res.entries);
      setTotals(res.totals);
      setStatusCounts(res.statusCounts);
      setTotalCount(res.totalCount);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load journal entries.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Recurring Schedules
  const fetchRecurringSchedules = async () => {
    setSchedulesLoading(true);
    try {
      const res = await ledgerApi.listRecurring();
      setSchedules(res.schedules);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load recurring schedules.');
    } finally {
      setSchedulesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'RECURRING') {
      void fetchRecurringSchedules();
    } else if (activeTab === 'ACCOUNTS') {
      void fetchMasterData();
    } else {
      void fetchEntries();
    }
  }, [
    activeTab,
    startDate,
    endDate,
    referenceTypeFilter,
    selectedAccountId,
    selectedTrackingOptionId,
  ]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'RECURRING') {
      void fetchRecurringSchedules();
    } else {
      void fetchEntries();
    }
  };

  // Inspect Entry in Drawer
  const openInspector = async (entry: JournalEntry) => {
    setSelectedEntry(entry);
    setDrawerOpen(true);
    setDrawerReversesEntry(null);
    setDrawerReversedByEntry(null);
    setDrawerLoading(true);

    try {
      const res = await ledgerApi.get(entry.id);
      setSelectedEntry(res.entry);
      setDrawerReversesEntry(res.reversesEntry || null);
      setDrawerReversedByEntry(res.reversedByEntry || null);
    } catch {
      // keep initial entry
    } finally {
      setDrawerLoading(false);
    }
  };

  // Quick Approve PENDING_APPROVAL Entry
  const handleApproveEntry = async (entryId: string) => {
    setError(null);
    try {
      const res = await ledgerApi.approve(entryId);
      setFeedback(`Approved and posted journal ${res.entry.entryNumber || res.entry.id}.`);
      if (selectedEntry?.id === entryId) {
        setSelectedEntry(res.entry);
      }
      void fetchEntries();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to approve journal entry.');
    }
  };

  // Quick Delete DRAFT Entry
  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this draft journal entry?')) return;
    setError(null);
    try {
      const res = await ledgerApi.deleteEntry(entryId);
      setFeedback(res.message || 'Draft journal deleted successfully.');
      setDrawerOpen(false);
      void fetchEntries();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to delete draft journal.');
    }
  };

  // Open Reversal Modal
  const openReversalModal = (entry: JournalEntry) => {
    setReversalTarget(entry);
    setReversalDate(new Date().toISOString().slice(0, 10));
    setReversalReason('');
    setReversalError(null);
  };

  // Submit Reversal
  const handleReversalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversalTarget) return;

    setReversalLoading(true);
    setReversalError(null);

    try {
      const res = await ledgerApi.reverse(reversalTarget.id, {
        reversalDate: reversalDate ? new Date(reversalDate).toISOString() : undefined,
        reason: reversalReason.trim() || undefined,
      });

      setReversalTarget(null);
      setDrawerOpen(false);
      setFeedback(
        `Successfully reversed ${res.original.entryNumber} via contra-journal ${res.reversal.entryNumber}.`,
      );
      void fetchEntries();
    } catch (err) {
      if (err instanceof ApiError) setReversalError(err.message);
      else setReversalError('Failed to reverse journal entry.');
    } finally {
      setReversalLoading(false);
    }
  };

  // Recurring Schedule Actions
  const handleRunRecurringNow = async (scheduleId: string) => {
    try {
      const res = await ledgerApi.runRecurring(scheduleId);
      setFeedback(res.message);
      void fetchRecurringSchedules();
      void fetchEntries();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to execute recurring schedule.');
    }
  };

  const handleToggleRecurringActive = async (s: RecurringSchedule) => {
    try {
      await ledgerApi.updateRecurring(s.id, { isActive: !s.isActive });
      void fetchRecurringSchedules();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to toggle schedule.');
    }
  };

  const handleDeleteRecurring = async (scheduleId: string) => {
    if (!confirm('Are you sure you want to delete this recurring schedule?')) return;
    try {
      await ledgerApi.deleteRecurring(scheduleId);
      setFeedback('Recurring schedule deleted.');
      void fetchRecurringSchedules();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to delete schedule.');
    }
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
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-slate-900 tracking-tight">
            General Ledger & Adjusting Journals
          </h1>
          <p className="text-xs text-slate-500 font-light mt-0.5">
            Complete double-entry accounting audit trail, manual adjustments, approvals, 1-click reversals & recurring schedules
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'RECURRING' ? (
            <Button
              size="sm"
              onClick={() => setIsRecurringModalOpen(true)}
              disabled={!canApproveOrPost}
              className="inline-flex items-center gap-1.5 text-xs h-8"
              title={
                canApproveOrPost
                  ? 'Configure new recurring journal template'
                  : 'Only Admin and Accountant can create recurring schedules'
              }
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Recurring Schedule</span>
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setIsManualModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs h-8"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Journal Entry</span>
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded border border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-light text-slate-500">Total Entries</span>
            <BookOpen className="w-4 h-4 text-forest-700" />
          </div>
          <p className="text-lg font-mono font-medium text-slate-900 mt-1">
            {totalCount}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">Double-entry ledger records</p>
        </div>

        <div className="bg-white p-3.5 rounded border border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-light text-slate-500">Total Debits</span>
            <ArrowDownLeft className="w-4 h-4 text-slate-600" />
          </div>
          <p className="text-lg font-mono font-medium text-slate-900 mt-1">
            {formatCents(totals.totalDebitsCents)}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">Sum of all posted debits</p>
        </div>

        <div className="bg-white p-3.5 rounded border border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-light text-slate-500">Total Credits</span>
            <ArrowUpRight className="w-4 h-4 text-slate-600" />
          </div>
          <p className="text-lg font-mono font-medium text-slate-900 mt-1">
            {formatCents(totals.totalCreditsCents)}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">Sum of all posted credits</p>
        </div>

        <div className="bg-white p-3.5 rounded border border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-light text-slate-500">Ledger Invariant</span>
            <CheckCircle2
              className={`w-4 h-4 ${
                totals.isBalanced ? 'text-emerald-600' : 'text-rose-600'
              }`}
            />
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <StatusTag
              label={totals.isBalanced ? 'Balanced (ΣD = ΣC)' : 'Imbalance Detected'}
              tone={totals.isBalanced ? 'emerald' : 'rose'}
              mono
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Zero integer-cent discrepancy</p>
        </div>
      </div>

      {/* Feedback & Error Banners */}
      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-xs flex items-center justify-between">
          <span>{feedback}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold ml-2 text-sm"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Workbench Container */}
      <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
        {/* Navigation Tabs Bar */}
        <div className="border-b border-slate-200 bg-slate-50/70 px-4 pt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('POSTED')}
              className={`px-3 py-1.5 text-xs border-b-2 transition-colors inline-flex items-center gap-1.5 -mb-px ${
                activeTab === 'POSTED'
                  ? 'border-forest-900 text-forest-900 font-medium bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Posted</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800">
                {statusCounts.POSTED}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('PENDING_APPROVAL')}
              className={`px-3 py-1.5 text-xs border-b-2 transition-colors inline-flex items-center gap-1.5 -mb-px ${
                activeTab === 'PENDING_APPROVAL'
                  ? 'border-forest-900 text-forest-900 font-medium bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Pending Approval</span>
              {statusCounts.PENDING_APPROVAL > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-100 text-amber-800 font-bold">
                  {statusCounts.PENDING_APPROVAL}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('DRAFT')}
              className={`px-3 py-1.5 text-xs border-b-2 transition-colors inline-flex items-center gap-1.5 -mb-px ${
                activeTab === 'DRAFT'
                  ? 'border-forest-900 text-forest-900 font-medium bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Drafts</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-200 text-slate-700">
                {statusCounts.DRAFT}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('REVERSED')}
              className={`px-3 py-1.5 text-xs border-b-2 transition-colors inline-flex items-center gap-1.5 -mb-px ${
                activeTab === 'REVERSED'
                  ? 'border-forest-900 text-forest-900 font-medium bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Reversed</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-200 text-slate-600">
                {statusCounts.REVERSED}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ALL')}
              className={`px-3 py-1.5 text-xs border-b-2 transition-colors inline-flex items-center gap-1.5 -mb-px ${
                activeTab === 'ALL'
                  ? 'border-forest-900 text-forest-900 font-medium bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>All Entries</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-600">
                {statusCounts.ALL}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-1 pb-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('RECURRING')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors inline-flex items-center gap-1.5 ${
                activeTab === 'RECURRING'
                  ? 'bg-forest-900 text-white'
                  : 'text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Recurring Schedules</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ACCOUNTS')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors inline-flex items-center gap-1.5 ${
                activeTab === 'ACCOUNTS'
                  ? 'bg-forest-900 text-white'
                  : 'text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Trial Balance</span>
            </button>
          </div>
        </div>

        {/* Filters Bar (for Entries tabs) */}
        {activeTab !== 'RECURRING' && activeTab !== 'ACCOUNTS' && (
          <div className="p-3 bg-white border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
            {/* Search */}
            <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search description or entry #…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-7 pl-8 pr-3 text-xs rounded border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
              />
            </form>

            {/* Filter Pickers */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500 font-light">From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-7 px-2 text-xs rounded border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
                />
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500 font-light">To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-7 px-2 text-xs rounded border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
                />
              </div>

              {/* Event Type */}
              <select
                value={referenceTypeFilter}
                onChange={(e) => setReferenceTypeFilter(e.target.value)}
                className="h-7 px-2 text-xs rounded border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 text-slate-700"
              >
                <option value="ALL">All Event Types</option>
                <option value="MANUAL">Manual Journals</option>
                <option value="MANUAL_REVERSAL">Reversal Contra-Journals</option>
                <option value="INVOICE">Invoices (AR)</option>
                <option value="PAYMENT_IN">Receipts In (AR)</option>
                <option value="BILL">Bills (AP)</option>
                <option value="PAYMENT_OUT">Payments Out (AP)</option>
                <option value="EXPENSE_CLAIM">Expense Claims</option>
                <option value="DIRECT_TRANSACTION">Spend/Receive Money</option>
                <option value="ACCOUNT_BALANCE_SWEEP">Balance Sweeps</option>
                <option value="RECURRING_SCHEDULE">Recurring Executions</option>
              </select>

              {/* Account Filter */}
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="h-7 px-2 text-xs rounded border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 text-slate-700 max-w-[150px] truncate"
              >
                <option value="ALL">All Accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name}
                  </option>
                ))}
              </select>

              {/* Dimension Filter */}
              {trackingCategories.length > 0 && (
                <select
                  value={selectedTrackingOptionId}
                  onChange={(e) => setSelectedTrackingOptionId(e.target.value)}
                  className="h-7 px-2 text-xs rounded border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 text-slate-700 max-w-[160px] truncate"
                >
                  <option value="ALL">All Dimensions</option>
                  {trackingCategories.map((cat) => (
                    <optgroup key={cat.id} label={cat.name}>
                      {cat.options.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {cat.name}: {opt.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}

              {(startDate ||
                endDate ||
                referenceTypeFilter !== 'ALL' ||
                selectedAccountId !== 'ALL' ||
                selectedTrackingOptionId !== 'ALL' ||
                search) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setReferenceTypeFilter('ALL');
                    setSelectedAccountId('ALL');
                    setSelectedTrackingOptionId('ALL');
                    setSearch('');
                  }}
                  className="text-xs h-7 px-2 py-0"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Tab Content: Journal Entries (POSTED, PENDING_APPROVAL, DRAFT, REVERSED, ALL) */}
        {activeTab !== 'RECURRING' && activeTab !== 'ACCOUNTS' && (
          <div>
            {loading ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-forest-800" />
                <p className="text-xs text-slate-500 font-light">Loading journal entries…</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="py-16 text-center px-6">
                <BookOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-800">No journal entries found</p>
                <p className="text-xs text-slate-400 font-light mt-1 max-w-sm mx-auto">
                  {search ||
                  startDate ||
                  endDate ||
                  referenceTypeFilter !== 'ALL' ||
                  selectedAccountId !== 'ALL' ||
                  selectedTrackingOptionId !== 'ALL'
                    ? 'No entries match your search criteria. Try adjusting or resetting filters.'
                    : 'Journal entries will appear here automatically when transactions or adjustments are posted.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-medium">
                      <th className="py-2.5 px-3 w-28">Entry #</th>
                      <th className="py-2.5 px-3 w-28">Date</th>
                      <th className="py-2.5 px-3">Description / Memo</th>
                      <th className="py-2.5 px-3 w-32">Event Type</th>
                      <th className="py-2.5 px-3 w-24">Status</th>
                      <th className="py-2.5 px-3 text-right w-32">Debit ($ AUD)</th>
                      <th className="py-2.5 px-3 text-right w-32">Credit ($ AUD)</th>
                      <th className="py-2.5 px-3 text-right w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-light text-slate-700">
                    {entries.map((entry) => {
                      const debits = entry.lines
                        .filter((l) => l.entryType === 'DEBIT')
                        .reduce((sum, l) => sum + l.amountCents, 0);
                      const credits = entry.lines
                        .filter((l) => l.entryType === 'CREDIT')
                        .reduce((sum, l) => sum + l.amountCents, 0);

                      return (
                        <tr
                          key={entry.id}
                          className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                          onClick={() => void openInspector(entry)}
                        >
                          <td className="py-2.5 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                            {entry.entryNumber || '—'}
                          </td>

                          <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                            {formatDate(entry.postedAt)}
                          </td>

                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900 max-w-md truncate">
                              {entry.description}
                            </div>
                            {entry.reversesEntryId && (
                              <span className="inline-flex items-center text-[10px] text-amber-700 font-mono mt-0.5">
                                ↳ Reversal Contra-Entry
                              </span>
                            )}
                            {entry.reversedById && (
                              <span className="inline-flex items-center text-[10px] text-rose-600 font-mono mt-0.5">
                                ↳ Reversed by Contra-Journal
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-3">
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                              {entry.referenceType}
                            </span>
                          </td>

                          <td className="py-2.5 px-3">
                            <StatusTag
                              label={entry.status}
                              tone={resolveStatusTone(entry.status)}
                              mono
                            />
                          </td>

                          <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900 whitespace-nowrap">
                            {formatCents(debits)}
                          </td>

                          <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900 whitespace-nowrap">
                            {formatCents(credits)}
                          </td>

                          <td
                            className="py-2.5 px-3 text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => void openInspector(entry)}
                                className="p-1 text-slate-400 hover:text-slate-800 rounded hover:bg-slate-100 transition-colors"
                                title="Inspect journal entry"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {entry.status === 'POSTED' &&
                                !entry.reversedById &&
                                !entry.reversesEntryId &&
                                entry.referenceType !== 'MANUAL_REVERSAL' &&
                                !entry.referenceType.endsWith('_VOID') && (
                                <button
                                  type="button"
                                  onClick={() => openReversalModal(entry)}
                                  disabled={!canApproveOrPost}
                                  className="p-1 text-slate-400 hover:text-amber-700 rounded hover:bg-amber-50 transition-colors disabled:opacity-30"
                                  title={
                                    canApproveOrPost
                                      ? '1-Click Contra-Journal Reversal'
                                      : 'Only Admin and Accountant can reverse journals'
                                  }
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {entry.status === 'PENDING_APPROVAL' && canApproveOrPost && (
                                <button
                                  type="button"
                                  onClick={() => void handleApproveEntry(entry.id)}
                                  className="p-1 text-emerald-600 hover:text-emerald-800 rounded hover:bg-emerald-50 transition-colors"
                                  title="Approve & Post"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {(((entry.status === 'DRAFT' ||
                                entry.status === 'PENDING_APPROVAL') &&
                                canApproveOrPost) ||
                                role === 'ADMIN') && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteEntry(entry.id)}
                                    className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                                    title={
                                      entry.status === 'DRAFT' || entry.status === 'PENDING_APPROVAL'
                                        ? 'Delete Draft'
                                        : 'Admin Force-Delete Journal Entry'
                                    }
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Recurring Schedules */}
        {activeTab === 'RECURRING' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-slate-900">
                  Automated Recurring Adjusting Journals
                </h2>
                <p className="text-xs text-slate-500 font-light mt-0.5">
                  Configure scheduled month-end depreciation, prepaid expenses amortization, or monthly accruals
                </p>
              </div>

              <Button
                size="sm"
                onClick={() => setIsRecurringModalOpen(true)}
                disabled={!canApproveOrPost}
                className="text-xs h-7"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                <span>New Schedule</span>
              </Button>
            </div>

            {schedulesLoading ? (
              <div className="py-12 text-center text-xs text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin text-forest-800 mx-auto mb-2" />
                Loading recurring schedules…
              </div>
            ) : schedules.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-slate-200 rounded p-6">
                <Calendar className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-medium text-slate-800">
                  No recurring journal templates configured
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5 max-w-sm mx-auto">
                  Automate recurring journal entries for depreciation, rent prepayments, or periodic accruals.
                </p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-medium">
                      <th className="py-2 px-3">Template Name</th>
                      <th className="py-2 px-3 w-28">Cadence</th>
                      <th className="py-2 px-3 w-28">Next Run</th>
                      <th className="py-2 px-3 w-28">Last Run</th>
                      <th className="py-2 px-3 w-28">Execution</th>
                      <th className="py-2 px-3 w-24">State</th>
                      <th className="py-2 px-3 text-right w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-light text-slate-700">
                    {schedules.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          <div>{s.name}</div>
                          {s.template?.description && (
                            <div className="text-[11px] text-slate-400 truncate max-w-xs">
                              {s.template.description}
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 px-3">
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {s.frequency}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 font-mono text-slate-700">
                          {formatDate(s.nextRunDate)}
                        </td>

                        <td className="py-2.5 px-3 font-mono text-slate-500">
                          {s.lastRunDate ? formatDate(s.lastRunDate) : 'Never'}
                        </td>

                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono ${
                              s.autoPost
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {s.autoPost ? 'Auto-Post' : 'Create Draft'}
                          </span>
                        </td>

                        <td className="py-2.5 px-3">
                          <StatusTag
                            label={s.isActive ? 'Active' : 'Paused'}
                            tone={s.isActive ? 'emerald' : 'draft'}
                            mono
                          />
                        </td>

                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => void handleRunRecurringNow(s.id)}
                              disabled={!canApproveOrPost}
                              className="p-1 text-slate-500 hover:text-emerald-700 rounded hover:bg-emerald-50 transition-colors disabled:opacity-30"
                              title="Trigger manual run now"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleToggleRecurringActive(s)}
                              disabled={!canApproveOrPost}
                              className="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100 transition-colors disabled:opacity-30"
                              title={s.isActive ? 'Pause schedule' : 'Activate schedule'}
                            >
                              <Pause className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDeleteRecurring(s.id)}
                              disabled={!canApproveOrPost}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors disabled:opacity-30"
                              title="Delete schedule"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Trial Balance */}
        {activeTab === 'ACCOUNTS' && (
          <div>
            <div className="p-3 border-b border-slate-200 bg-white flex items-center justify-between">
              <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter accounts by code or name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-7 pl-8 pr-3 text-xs rounded border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                />
              </form>
              <div className="text-xs text-slate-500 font-mono">
                {filteredAccounts.length} accounts listed
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-medium">
                    <th className="py-2.5 px-3 w-28">Code</th>
                    <th className="py-2.5 px-3">Account Name</th>
                    <th className="py-2.5 px-3 w-28">Classification</th>
                    <th className="py-2.5 px-3 w-24">Balance Side</th>
                    <th className="py-2.5 px-3 text-right w-32">Total Debits</th>
                    <th className="py-2.5 px-3 text-right w-32">Total Credits</th>
                    <th className="py-2.5 px-3 text-right w-36">Net Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-light text-slate-700">
                  {filteredAccounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-forest-900">
                        {acc.code}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">
                        {acc.name}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusTag
                          label={acc.type}
                          tone={resolveStatusTone(acc.type)}
                          mono
                        />
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                        {acc.normalBalance}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {formatCents(acc.debitsCents)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {formatCents(acc.creditsCents)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900">
                        {formatCents(acc.netBalanceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-medium text-slate-900 border-t border-slate-200">
                  <tr>
                    <td colSpan={4} className="py-3 px-3 font-semibold">
                      Trial Balance Totals
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold">
                      {formatCents(totals.totalDebitsCents)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold">
                      {formatCents(totals.totalCreditsCents)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                      {totals.isBalanced ? '$0.00 (Balanced)' : 'Imbalanced'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Right-Hand Slide-Over Inspector Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={selectedEntry?.entryNumber || 'Journal Inspection'}
        subtitle={selectedEntry?.description}
        badge={
          selectedEntry && (
            <StatusTag
              label={selectedEntry.status}
              tone={resolveStatusTone(selectedEntry.status)}
              mono
            />
          )
        }
        footer={
          selectedEntry && (
            <div className="flex items-center justify-between w-full">
              <div className="text-[11px] font-mono text-slate-500">
                Ref: {selectedEntry.referenceType} ({selectedEntry.referenceId})
              </div>
              <div className="flex items-center gap-2">
                {selectedEntry.status === 'POSTED' &&
                  !selectedEntry.reversedById &&
                  !selectedEntry.reversesEntryId &&
                  selectedEntry.referenceType !== 'MANUAL_REVERSAL' &&
                  !selectedEntry.referenceType.endsWith('_VOID') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openReversalModal(selectedEntry)}
                    disabled={!canApproveOrPost}
                    className="text-xs h-7"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    <span>1-Click Reversal</span>
                  </Button>
                )}

                {selectedEntry.status === 'PENDING_APPROVAL' && canApproveOrPost && (
                  <Button
                    size="sm"
                    onClick={() => void handleApproveEntry(selectedEntry.id)}
                    className="text-xs h-7"
                  >
                    <Check className="w-3.5 h-3.5 mr-1" />
                    <span>Approve & Post</span>
                  </Button>
                )}

                {(((selectedEntry.status === 'DRAFT' ||
                  selectedEntry.status === 'PENDING_APPROVAL') &&
                  canApproveOrPost) ||
                  role === 'ADMIN') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleDeleteEntry(selectedEntry.id)}
                      className="text-xs h-7 text-rose-700 hover:bg-rose-50 border-rose-200"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      <span>
                        {selectedEntry.status === 'DRAFT' || selectedEntry.status === 'PENDING_APPROVAL'
                          ? 'Delete'
                          : 'Force Delete'}
                      </span>
                    </Button>
                  )}
              </div>
            </div>
          )
        }
      >
        {selectedEntry && (
          <div className="space-y-5">
            {/* Context Notice for Contra Reversals */}
            {drawerReversesEntry && (
              <div className="p-3 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-900 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Contra Reversal Entry</span>
                </div>
                <p className="text-[11px]">
                  This journal reverses entry{' '}
                  <span className="font-mono font-bold">
                    {drawerReversesEntry.entryNumber || drawerReversesEntry.id}
                  </span>{' '}
                  posted on {formatDate(drawerReversesEntry.postedAt)} (
                  {drawerReversesEntry.description}).
                </p>
              </div>
            )}

            {drawerReversedByEntry && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-700" />
                  <span>Entry Voided via Reversal</span>
                </div>
                <p className="text-[11px]">
                  This journal was reversed on{' '}
                  {formatDate(drawerReversedByEntry.postedAt)} by contra-journal{' '}
                  <span className="font-mono font-bold">
                    {drawerReversedByEntry.entryNumber || drawerReversedByEntry.id}
                  </span>
                  .
                </p>
              </div>
            )}

            {/* Metadata Summary Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded border border-slate-200">
              <div>
                <span className="text-[10px] text-slate-500 font-light">Posting Date</span>
                <p className="font-mono font-medium text-slate-900 mt-0.5">
                  {formatDateTime(selectedEntry.postedAt)}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-light">Event Type</span>
                <p className="font-mono font-medium text-slate-900 mt-0.5">
                  {selectedEntry.referenceType}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-light">Created By</span>
                <p className="font-mono text-slate-700 mt-0.5">
                  {selectedEntry.createdByUserId || 'System'}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-light">Approved By</span>
                <p className="font-mono text-slate-700 mt-0.5">
                  {selectedEntry.approvedByUserId || 'Auto-posted'}
                </p>
              </div>
            </div>

            {/* Double-Entry Journal Lines Breakdown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900">
                  Double-Entry Ledger Lines ({selectedEntry.lines.length})
                </h3>
                {drawerLoading && (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                )}
              </div>

              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-medium">
                      <th className="py-2 px-3">Account & Dimension</th>
                      <th className="py-2 px-3 text-right w-28">Debit</th>
                      <th className="py-2 px-3 text-right w-28">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-light text-slate-700">
                    {selectedEntry.lines.map((line) => (
                      <tr key={line.id} className="hover:bg-slate-50/40">
                        <td className="py-2 px-3">
                          <div className="font-sans text-slate-900">
                            <span className="font-mono font-medium text-forest-900 mr-1.5">
                              {line.account.code}
                            </span>
                            <span>{line.account.name}</span>
                          </div>
                          {line.description && (
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {line.description}
                            </div>
                          )}
                          {line.trackingOption && (
                            <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                              <Tag className="w-2.5 h-2.5 text-slate-500" />
                              <span>
                                {line.trackingOption.trackingCategory?.name || 'Dimension'}:{' '}
                                {line.trackingOption.name}
                              </span>
                            </div>
                          )}
                        </td>

                        <td className="py-2 px-3 text-right font-mono font-medium text-slate-900 whitespace-nowrap">
                          {line.entryType === 'DEBIT' ? formatCents(line.amountCents) : '—'}
                        </td>

                        <td className="py-2 px-3 text-right font-mono font-medium text-slate-900 whitespace-nowrap">
                          {line.entryType === 'CREDIT' ? formatCents(line.amountCents) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50/90 font-mono text-xs border-t border-slate-200">
                    <tr>
                      <td className="py-2 px-3 font-sans font-medium text-slate-800">
                        Total Sum
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900">
                        {formatCents(
                          selectedEntry.lines
                            .filter((l) => l.entryType === 'DEBIT')
                            .reduce((sum, l) => sum + l.amountCents, 0),
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900">
                        {formatCents(
                          selectedEntry.lines
                            .filter((l) => l.entryType === 'CREDIT')
                            .reduce((sum, l) => sum + l.amountCents, 0),
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* 1-Click Reversal Modal */}
      <Modal
        open={Boolean(reversalTarget)}
        onClose={() => setReversalTarget(null)}
        title="1-Click Contra-Journal Reversal"
        description="Creates an immutable contra-journal entry with inverted debits and credits, preserving complete audit traceability."
      >
        {reversalTarget && (
          <form onSubmit={handleReversalSubmit} className="space-y-4 pt-2 text-xs">
            {reversalError && (
              <div className="p-3 bg-rose-50 text-rose-800 rounded flex items-center gap-2 border border-rose-200">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{reversalError}</span>
              </div>
            )}

            <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1">
              <span className="text-[11px] text-slate-500 font-light">Target Journal</span>
              <p className="font-mono font-semibold text-slate-900">
                {reversalTarget.entryNumber || reversalTarget.id} — {reversalTarget.description}
              </p>
              <p className="text-[11px] text-slate-500">
                Original Date: {formatDate(reversalTarget.postedAt)} · Event: {reversalTarget.referenceType}
              </p>
              {reversalTarget.referenceType !== 'MANUAL' && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                  Bidirectional Sub-Ledger Cascade: Reversing this journal will also void or revert the linked {reversalTarget.referenceType} record in its module.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reversal Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                required
                value={reversalDate}
                onChange={(e) => setReversalDate(e.target.value)}
                className="w-full h-8 px-3 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Must be on or after any configured Period Lock Date.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reason for Reversal
              </label>
              <input
                type="text"
                placeholder="e.g. Month-end accrual reversal, coding reclassification"
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                className="w-full h-8 px-3 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReversalTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={reversalLoading}
                className="inline-flex items-center gap-1.5"
              >
                {reversalLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                <span>Post Reversal Contra-Journal</span>
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Manual Journal Entry Composer Modal */}
      <CreateManualJournalEntryModal
        open={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        accounts={accounts}
        trackingCategories={trackingCategories}
        canApproveOrPost={canApproveOrPost}
        onSuccess={() => {
          setIsManualModalOpen(false);
          setFeedback('Journal entry recorded successfully.');
          void fetchEntries();
        }}
      />

      {/* Recurring Journal Template Modal */}
      <CreateRecurringJournalModal
        open={isRecurringModalOpen}
        onClose={() => setIsRecurringModalOpen(false)}
        accounts={accounts}
        trackingCategories={trackingCategories}
        onSuccess={() => {
          setIsRecurringModalOpen(false);
          setFeedback('Recurring journal template created.');
          void fetchRecurringSchedules();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Manual Journal Entry Modal Component
// ---------------------------------------------------------------------------

interface ManualLineState {
  id: string;
  accountId: string;
  trackingOptionId: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: string;
  description: string;
}

interface CreateManualJournalEntryModalProps {
  open: boolean;
  onClose: () => void;
  accounts: AccountWithBalance[];
  trackingCategories: TrackingCategory[];
  canApproveOrPost: boolean;
  onSuccess: () => void;
}

function CreateManualJournalEntryModal({
  open,
  onClose,
  accounts,
  trackingCategories,
  canApproveOrPost,
  onSuccess,
}: CreateManualJournalEntryModalProps) {
  const [description, setDescription] = useState('');
  const [postedAt, setPostedAt] = useState(() => new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<'POSTED' | 'DRAFT' | 'PENDING_APPROVAL'>('POSTED');
  const [lines, setLines] = useState<ManualLineState[]>([
    {
      id: '1',
      accountId: '',
      trackingOptionId: '',
      entryType: 'DEBIT',
      amount: '',
      description: '',
    },
    {
      id: '2',
      accountId: '',
      trackingOptionId: '',
      entryType: 'CREDIT',
      amount: '',
      description: '',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setDescription('');
    setPostedAt(new Date().toISOString().split('T')[0]);
    setStatus(canApproveOrPost ? 'POSTED' : 'PENDING_APPROVAL');
    setLines([
      {
        id: '1',
        accountId: '',
        trackingOptionId: '',
        entryType: 'DEBIT',
        amount: '',
        description: '',
      },
      {
        id: '2',
        accountId: '',
        trackingOptionId: '',
        entryType: 'CREDIT',
        amount: '',
        description: '',
      },
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
        trackingOptionId: '',
        entryType: prev.length % 2 === 0 ? 'DEBIT' : 'CREDIT',
        amount: '',
        description: '',
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
        setError(`Line ${i + 1} is missing an account selection.`);
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
        status: canApproveOrPost ? status : 'PENDING_APPROVAL',
        lines: lines.map((l) => ({
          accountId: l.accountId,
          trackingOptionId: l.trackingOptionId || null,
          entryType: l.entryType,
          amountCents: Math.round((parseFloat(l.amount) || 0) * 100),
          description: l.description?.trim() || null,
        })),
      });

      resetForm();
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to record manual journal entry.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New Manual Adjusting Journal"
      description="Post an adjusting double-entry journal directly to the General Ledger or save as draft."
      size="5xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
        {error && (
          <div className="p-3 bg-rose-50 text-rose-800 rounded flex items-center gap-2 border border-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
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
              className="w-full h-8 px-3 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
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
              className="w-full h-8 px-3 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
            />
          </div>
        </div>

        {canApproveOrPost && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Posting Action
            </label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as 'POSTED' | 'DRAFT' | 'PENDING_APPROVAL')
              }
              className="w-full sm:w-64 h-8 px-2 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
            >
              <option value="POSTED">Post Immediately to General Ledger</option>
              <option value="DRAFT">Save as Draft (No GL Impact)</option>
              <option value="PENDING_APPROVAL">Submit for Team Approval</option>
            </select>
          </div>
        )}

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
              className="text-xs h-6 px-2 inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>Add Line</span>
            </Button>
          </div>

          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2.5">Account</th>
                  <th className="py-2 px-2 w-32">Dimension</th>
                  <th className="py-2 px-2 w-24">Type</th>
                  <th className="py-2 px-2 w-28 text-right">Amount ($ AUD)</th>
                  <th className="py-2 px-2 w-36">Line Memo</th>
                  <th className="py-2 px-1.5 w-8 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line) => (
                  <tr key={line.id} className="hover:bg-slate-50/50">
                    <td className="p-1.5">
                      <select
                        value={line.accountId}
                        onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}
                        className="w-full h-7 px-1.5 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                      >
                        <option value="">Select Account…</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.code} - {acc.name} ({acc.type})
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="p-1.5">
                      <select
                        value={line.trackingOptionId}
                        onChange={(e) =>
                          updateLine(line.id, 'trackingOptionId', e.target.value)
                        }
                        className="w-full h-7 px-1.5 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 text-slate-700"
                      >
                        <option value="">None</option>
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
                    </td>

                    <td className="p-1.5">
                      <select
                        value={line.entryType}
                        onChange={(e) =>
                          updateLine(
                            line.id,
                            'entryType',
                            e.target.value as 'DEBIT' | 'CREDIT',
                          )
                        }
                        className="w-full h-7 px-1.5 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-semibold"
                      >
                        <option value="DEBIT">DEBIT</option>
                        <option value="CREDIT">CREDIT</option>
                      </select>
                    </td>

                    <td className="p-1.5 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={line.amount}
                        onChange={(e) => updateLine(line.id, 'amount', e.target.value)}
                        className="w-full h-7 px-2 text-right font-mono text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                      />
                    </td>

                    <td className="p-1.5">
                      <input
                        type="text"
                        placeholder="Optional memo"
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.id, 'description', e.target.value)
                        }
                        className="w-full h-7 px-2 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                      />
                    </td>

                    <td className="p-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length <= 2}
                        className="text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
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
                  <td
                    colSpan={3}
                    className="py-2 px-3 font-sans font-medium text-slate-700"
                  >
                    Total Sums
                  </td>
                  <td className="py-2 px-2 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-slate-600">
                        D: {formatCents(sumDebitsCents)}
                      </span>
                      <span className="text-slate-600">
                        C: {formatCents(sumCreditsCents)}
                      </span>
                    </div>
                  </td>
                  <td colSpan={2} className="py-2 px-2 text-right font-sans">
                    <StatusTag
                      label={
                        isBalanced
                          ? 'Balanced'
                          : `Diff: ${formatCents(imbalanceCents)}`
                      }
                      tone={isBalanced ? 'emerald' : 'rose'}
                      mono
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
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
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BookOpen className="w-3.5 h-3.5" />
            )}
            <span>
              {status === 'POSTED'
                ? 'Post Journal Entry'
                : status === 'DRAFT'
                  ? 'Save Draft'
                  : 'Submit for Approval'}
            </span>
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create Recurring Journal Modal Component
// ---------------------------------------------------------------------------

interface CreateRecurringJournalModalProps {
  open: boolean;
  onClose: () => void;
  accounts: AccountWithBalance[];
  trackingCategories: TrackingCategory[];
  onSuccess: () => void;
}

function CreateRecurringJournalModal({
  open,
  onClose,
  accounts,
  trackingCategories,
  onSuccess,
}: CreateRecurringJournalModalProps) {
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<
    'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY'
  >('MONTHLY');
  const [startDate, setStartDate] = useState(
    () => new Date().toISOString().split('T')[0],
  );
  const [autoPost, setAutoPost] = useState(false);
  const [templateDesc, setTemplateDesc] = useState('');
  const [lines, setLines] = useState<ManualLineState[]>([
    {
      id: '1',
      accountId: '',
      trackingOptionId: '',
      entryType: 'DEBIT',
      amount: '',
      description: '',
    },
    {
      id: '2',
      accountId: '',
      trackingOptionId: '',
      entryType: 'CREDIT',
      amount: '',
      description: '',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setFrequency('MONTHLY');
    setStartDate(new Date().toISOString().split('T')[0]);
    setAutoPost(false);
    setTemplateDesc('');
    setLines([
      {
        id: '1',
        accountId: '',
        trackingOptionId: '',
        entryType: 'DEBIT',
        amount: '',
        description: '',
      },
      {
        id: '2',
        accountId: '',
        trackingOptionId: '',
        entryType: 'CREDIT',
        amount: '',
        description: '',
      },
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
        trackingOptionId: '',
        entryType: prev.length % 2 === 0 ? 'DEBIT' : 'CREDIT',
        amount: '',
        description: '',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please provide a schedule name.');
      return;
    }

    if (!templateDesc.trim()) {
      setError('Please provide a template description/memo.');
      return;
    }

    if (!isBalanced) {
      setError('Template journal lines must balance (Sum of Debits === Sum of Credits).');
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
      await ledgerApi.createRecurring({
        name: name.trim(),
        frequency,
        startDate: new Date(startDate).toISOString(),
        autoPost,
        template: {
          description: templateDesc.trim(),
          lines: lines.map((l) => ({
            accountId: l.accountId,
            trackingOptionId: l.trackingOptionId || null,
            entryType: l.entryType,
            amountCents: Math.round((parseFloat(l.amount) || 0) * 100),
            description: l.description?.trim() || null,
          })),
        },
      });

      resetForm();
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to create recurring schedule.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New Recurring Journal Schedule"
      description="Set up an automated schedule for depreciation, amortizations, or recurring month-end accruals."
      size="5xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
        {error && (
          <div className="p-3 bg-rose-50 text-rose-800 rounded flex items-center gap-2 border border-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Schedule Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Monthly Equipment Depreciation"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-8 px-3 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Cadence <span className="text-red-500">*</span>
            </label>
            <select
              value={frequency}
              onChange={(e) =>
                setFrequency(
                  e.target.value as
                    | 'WEEKLY'
                    | 'FORTNIGHTLY'
                    | 'MONTHLY'
                    | 'QUARTERLY'
                    | 'ANNUALLY',
                )
              }
              className="w-full h-8 px-2 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
            >
              <option value="WEEKLY">Weekly</option>
              <option value="FORTNIGHTLY">Fortnightly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="ANNUALLY">Annually</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              First Execution Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-8 px-3 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
            />
          </div>

          <div className="pt-4">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoPost}
                onChange={(e) => setAutoPost(e.target.checked)}
                className="rounded border-slate-300 text-forest-800 focus:ring-forest-900"
              />
              <span className="text-xs font-medium text-slate-800">
                Auto-Post Directly to General Ledger
              </span>
            </label>
            <p className="text-[10px] text-slate-400 ml-6">
              If unchecked, creates a draft journal for manual review before posting.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Template Description / Memo <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Fixed asset depreciation for office IT hardware"
            value={templateDesc}
            onChange={(e) => setTemplateDesc(e.target.value)}
            className="w-full h-8 px-3 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
          />
        </div>

        {/* Lines Editor */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">
              Template Journal Lines ({lines.length})
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLine}
              className="text-xs h-6 px-2 inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>Add Line</span>
            </Button>
          </div>

          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2.5">Account</th>
                  <th className="py-2 px-2 w-32">Dimension</th>
                  <th className="py-2 px-2 w-24">Type</th>
                  <th className="py-2 px-2 w-28 text-right">Amount ($ AUD)</th>
                  <th className="py-2 px-2 w-36">Line Memo</th>
                  <th className="py-2 px-1.5 w-8 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line) => (
                  <tr key={line.id} className="hover:bg-slate-50/50">
                    <td className="p-1.5">
                      <select
                        value={line.accountId}
                        onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}
                        className="w-full h-7 px-1.5 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                      >
                        <option value="">Select Account…</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.code} - {acc.name} ({acc.type})
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="p-1.5">
                      <select
                        value={line.trackingOptionId}
                        onChange={(e) =>
                          updateLine(line.id, 'trackingOptionId', e.target.value)
                        }
                        className="w-full h-7 px-1.5 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 text-slate-700"
                      >
                        <option value="">None</option>
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
                    </td>

                    <td className="p-1.5">
                      <select
                        value={line.entryType}
                        onChange={(e) =>
                          updateLine(
                            line.id,
                            'entryType',
                            e.target.value as 'DEBIT' | 'CREDIT',
                          )
                        }
                        className="w-full h-7 px-1.5 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-semibold"
                      >
                        <option value="DEBIT">DEBIT</option>
                        <option value="CREDIT">CREDIT</option>
                      </select>
                    </td>

                    <td className="p-1.5 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={line.amount}
                        onChange={(e) => updateLine(line.id, 'amount', e.target.value)}
                        className="w-full h-7 px-2 text-right font-mono text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                      />
                    </td>

                    <td className="p-1.5">
                      <input
                        type="text"
                        placeholder="Optional memo"
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.id, 'description', e.target.value)
                        }
                        className="w-full h-7 px-2 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                      />
                    </td>

                    <td className="p-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length <= 2}
                        className="text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
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
                  <td
                    colSpan={3}
                    className="py-2 px-3 font-sans font-medium text-slate-700"
                  >
                    Template Debits / Credits
                  </td>
                  <td className="py-2 px-2 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-slate-600">
                        D: {formatCents(sumDebitsCents)}
                      </span>
                      <span className="text-slate-600">
                        C: {formatCents(sumCreditsCents)}
                      </span>
                    </div>
                  </td>
                  <td colSpan={2} className="py-2 px-2 text-right font-sans">
                    <StatusTag
                      label={isBalanced ? 'Balanced' : 'Imbalanced'}
                      tone={isBalanced ? 'emerald' : 'rose'}
                      mono
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <Button type="button" variant="outline" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!isBalanced || !name.trim() || !templateDesc.trim() || loading}
            className="inline-flex items-center gap-1.5"
          >
            {loading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Calendar className="w-3.5 h-3.5" />
            )}
            <span>Save Recurring Schedule</span>
          </Button>
        </div>
      </form>
    </Modal>
  );
}
