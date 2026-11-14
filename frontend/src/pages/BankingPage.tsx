import React, { useEffect, useState, useMemo } from 'react';
import {
  Landmark,
  ArrowRightLeft,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Upload,
  Plus,
  RefreshCw,
  Sparkles,
  Link as LinkIcon,
  Trash2,
  Edit2,
  X,
} from 'lucide-react';
import {
  bankingApi,
  accountsApi,
  type BankAccountSummary,
  type BankTransfer,
  type BankStatementLine,
  type ReconciliationSuggestionItem,
  type AccountWithBalance,
  type TrackingCategory,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function BankingPage() {
  // Top Active Tab
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'RECONCILIATION' | 'TRANSFERS' | 'STATEMENTS'>('OVERVIEW');

  // Accounts state
  const [bankAccounts, setBankAccounts] = useState<BankAccountSummary[]>([]);
  const [totals, setTotals] = useState({ totalLedgerCents: 0, totalReconciledCents: 0 });
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Transfers state
  const [transfers, setTransfers] = useState<BankTransfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);

  // Statements & Reconciliation state
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [suggestions, setSuggestions] = useState<ReconciliationSuggestionItem[]>([]);
  const [unreconciledJournals, setUnreconciledJournals] = useState<any[]>([]);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [selectedStmtLineId, setSelectedStmtLineId] = useState<string | null>(null);

  // Statement list state (for Statements Tab)
  const [statementLines, setStatementLines] = useState<BankStatementLine[]>([]);
  const [statementFilterStatus, setStatementFilterStatus] = useState<'ALL' | 'UNRECONCILED' | 'RECONCILED'>('ALL');
  const [statementsLoading, setStatementsLoading] = useState(false);

  // All COA Accounts & Tracking (for on-the-fly reconciliation and transfer picker)
  const [allAccounts, setAllAccounts] = useState<AccountWithBalance[]>([]);
  const [trackingCategories, setTrackingCategories] = useState<TrackingCategory[]>([]);

  // Modals state
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEditAccountModalOpen, setIsEditAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccountSummary | null>(null);

  // Feedback notifications
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data Loading
  // ---------------------------------------------------------------------------

  const loadBankAccounts = async () => {
    try {
      setAccountsLoading(true);
      const res = await bankingApi.listAccounts();
      setBankAccounts(res.accounts);
      setTotals(res.totals);

      // Default selected bank account for reconciliation if none selected
      if (!selectedAccountId && res.accounts.length > 0) {
        setSelectedAccountId(res.accounts[0]!.id);
      }
    } catch (err: any) {
      setBannerError(err.message || 'Failed to load bank accounts.');
    } finally {
      setAccountsLoading(false);
    }
  };

  const loadTransfers = async () => {
    try {
      setTransfersLoading(true);
      const res = await bankingApi.listTransfers();
      setTransfers(res.transfers);
    } catch (err: any) {
      setBannerError(err.message || 'Failed to load transfers.');
    } finally {
      setTransfersLoading(false);
    }
  };

  const loadReconciliation = async (accountId: string) => {
    if (!accountId) return;
    try {
      setReconciliationLoading(true);
      const res = await bankingApi.getSuggestions({ bankAccountId: accountId });
      setSuggestions(res.suggestions);
      setUnreconciledJournals(res.unreconciledJournalEntries);

      // Auto-select first suggestion line if none selected
      if (res.suggestions.length > 0) {
        setSelectedStmtLineId(res.suggestions[0]!.statementLine.id);
      } else {
        setSelectedStmtLineId(null);
      }
    } catch (err: any) {
      setBannerError(err.message || 'Failed to load reconciliation data.');
    } finally {
      setReconciliationLoading(false);
    }
  };

  const loadStatementLines = async (accountId?: string, status?: string) => {
    try {
      setStatementsLoading(true);
      const params: any = {};
      if (accountId) params.bankAccountId = accountId;
      if (status === 'UNRECONCILED') params.isReconciled = false;
      if (status === 'RECONCILED') params.isReconciled = true;
      const res = await bankingApi.listStatements(params);
      setStatementLines(res.lines);
    } catch (err: any) {
      setBannerError(err.message || 'Failed to load statement lines.');
    } finally {
      setStatementsLoading(false);
    }
  };

  const loadAuxiliaryData = async () => {
    try {
      const [accRes, trackRes] = await Promise.all([
        accountsApi.list({ includeInactive: false }),
        accountsApi.listTrackingCategories(),
      ]);
      setAllAccounts(accRes.accounts);
      setTrackingCategories(trackRes.categories);
    } catch {
      // non-fatal
    }
  };

  useEffect(() => {
    loadBankAccounts();
    loadAuxiliaryData();
  }, []);

  useEffect(() => {
    if (activeTab === 'TRANSFERS') {
      loadTransfers();
    } else if (activeTab === 'RECONCILIATION' && selectedAccountId) {
      loadReconciliation(selectedAccountId);
    } else if (activeTab === 'STATEMENTS') {
      loadStatementLines(selectedAccountId, statementFilterStatus);
    }
  }, [activeTab, selectedAccountId]);

  // Selected statement item for reconciliation pane
  const currentSuggestion = useMemo(() => {
    return suggestions.find((s) => s.statementLine.id === selectedStmtLineId) ?? null;
  }, [suggestions, selectedStmtLineId]);

  // ---------------------------------------------------------------------------
  // Reconciliation Actions
  // ---------------------------------------------------------------------------

  const handleMatch = async (statementLineId: string, journalEntryId: string) => {
    try {
      setBannerError(null);
      await bankingApi.match({ statementLineId, journalEntryId });
      setBannerSuccess('Statement line reconciled successfully.');
      await loadReconciliation(selectedAccountId);
      await loadBankAccounts();
    } catch (err: any) {
      setBannerError(err.message || 'Failed to match statement line.');
    }
  };

  const handleUnmatch = async (statementLineId: string) => {
    try {
      setBannerError(null);
      await bankingApi.unmatch({ statementLineId });
      setBannerSuccess('Reconciliation reopened and line unmatched.');
      await loadReconciliation(selectedAccountId);
      await loadBankAccounts();
      if (activeTab === 'STATEMENTS') {
        await loadStatementLines(selectedAccountId, statementFilterStatus);
      }
    } catch (err: any) {
      setBannerError(err.message || 'Failed to unmatch line.');
    }
  };

  const handleDeleteStatementLine = async (id: string) => {
    if (!window.confirm('Delete this statement line? Only unreconciled lines can be deleted.')) return;
    try {
      setBannerError(null);
      await bankingApi.deleteStatementLine(id);
      setBannerSuccess('Statement line deleted.');
      if (activeTab === 'STATEMENTS') {
        await loadStatementLines(selectedAccountId, statementFilterStatus);
      }
      if (activeTab === 'RECONCILIATION') {
        await loadReconciliation(selectedAccountId);
      }
      await loadBankAccounts();
    } catch (err: any) {
      setBannerError(err.message || 'Failed to delete statement line.');
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Top Banner Notifications */}
      {bannerError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm px-4 py-3 rounded-[4px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{bannerError}</span>
          </div>
          <button onClick={() => setBannerError(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {bannerSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 rounded-[4px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{bannerSuccess}</span>
          </div>
          <button onClick={() => setBannerSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-slate-900">
            Banking & Accounts Hub
          </h1>
          <p className="text-xs text-slate-500 font-light mt-0.5">
            Multi-Account Cash & Card Management, Clean Inter-Account Transfers & Statement Reconciliation
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsTransferModalOpen(true)}
            className="flex items-center gap-1.5"
          >
            <ArrowRightLeft className="w-3.5 h-3.5 text-forest-700" />
            <span>Transfer Money</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5 text-forest-700" />
            <span>Import Statement (CSV)</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadBankAccounts();
              if (activeTab === 'RECONCILIATION' && selectedAccountId) loadReconciliation(selectedAccountId);
              if (activeTab === 'TRANSFERS') loadTransfers();
              if (activeTab === 'STATEMENTS') loadStatementLines(selectedAccountId, statementFilterStatus);
            }}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('OVERVIEW')}
          className={`px-4 py-2 text-xs border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'OVERVIEW'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          Accounts Overview Hub
        </button>

        <button
          onClick={() => setActiveTab('RECONCILIATION')}
          className={`px-4 py-2 text-xs border-b-2 -mb-px transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'RECONCILIATION'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <span>Reconciliation Workspace</span>
          {bankAccounts.some((a) => a.unreconciledLineCount > 0) && (
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded bg-amber-100 text-amber-800">
              {bankAccounts.reduce((acc, a) => acc + a.unreconciledLineCount, 0)}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('TRANSFERS')}
          className={`px-4 py-2 text-xs border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'TRANSFERS'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          Inter-Account Transfers
        </button>

        <button
          onClick={() => setActiveTab('STATEMENTS')}
          className={`px-4 py-2 text-xs border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'STATEMENTS'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          Statement Import & History
        </button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* TAB 1: ACCOUNTS OVERVIEW HUB */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-4">
          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-md p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Total Liquid Cash</span>
                <Landmark className="w-4 h-4 text-forest-700" />
              </div>
              <div className="text-xl font-bold text-slate-900 mt-2 font-mono tracking-tight">
                {formatCents(totals.totalLedgerCents)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">General Ledger balance across bank/card accounts</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Reconciled Position</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-xl font-bold text-slate-900 mt-2 font-mono tracking-tight">
                {formatCents(totals.totalReconciledCents)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Confirmed against bank statement lines</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Unreconciled Variance</span>
                <ArrowRightLeft className="w-4 h-4 text-amber-600" />
              </div>
              <div
                className={`text-xl font-bold mt-2 font-mono tracking-tight ${
                  totals.totalLedgerCents - totals.totalReconciledCents !== 0
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {formatCents(totals.totalLedgerCents - totals.totalReconciledCents)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Ledger balance minus statement confirmed</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Pending Reconciliation</span>
                <Sparkles className="w-4 h-4 text-forest-700" />
              </div>
              <div className="text-xl font-bold text-slate-900 mt-2 font-mono tracking-tight">
                {bankAccounts.reduce((acc, a) => acc + a.unreconciledLineCount, 0)}{' '}
                <span className="text-xs font-normal text-slate-500">statement lines</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Imported lines awaiting match or coding</p>
            </div>
          </div>

          {/* Accounts Table */}
          <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <h2 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Bank & Credit Card Accounts
              </h2>
              <span className="text-xs text-slate-500 font-mono">{bankAccounts.length} accounts configured</span>
            </div>

            {accountsLoading ? (
              <div className="p-8 text-center text-sm text-slate-500">Loading banking accounts…</div>
            ) : bankAccounts.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <Landmark className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm text-slate-600 font-medium">No bank or card accounts found.</p>
                <p className="text-xs text-slate-400">
                  Ensure Account 1000 or custom Asset/Liability accounts are flagged as bank accounts in Chart of Accounts.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-semibold">
                      <th className="py-2.5 px-4">Account</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">EFT / Banking Info</th>
                      <th className="py-2.5 px-3 text-right">Ledger Balance</th>
                      <th className="py-2.5 px-3 text-right">Reconciled Balance</th>
                      <th className="py-2.5 px-3 text-right">Difference</th>
                      <th className="py-2.5 px-3 text-center">Unreconciled Lines</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bankAccounts.map((account) => (
                      <tr key={account.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <span className="font-mono text-forest-800 bg-forest-50 px-1.5 py-0.5 rounded-[3px]">
                              {account.code}
                            </span>
                            <span>{account.name}</span>
                          </div>
                          {account.description && (
                            <p className="text-[11px] text-slate-400 truncate max-w-xs">{account.description}</p>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded-[3px] uppercase ${
                              account.type === 'ASSET'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {account.type}
                          </span>
                        </td>

                        <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                          {account.bankBsb || account.bankAccountNumber ? (
                            <div>
                              <span>BSB: {account.bankBsb || '—'}</span>
                              <span className="mx-1 text-slate-300">|</span>
                              <span>Acc: {account.bankAccountNumber || '—'}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">No BSB configured</span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-semibold text-slate-900">
                          {formatCents(account.ledgerBalanceCents)}
                        </td>

                        <td className="py-3 px-3 text-right font-mono text-slate-700">
                          {formatCents(account.reconciledBalanceCents)}
                        </td>

                        <td className="py-3 px-3 text-right font-mono">
                          <span
                            className={`px-1.5 py-0.5 rounded-[3px] font-semibold ${
                              account.unreconciledDifferenceCents === 0
                                ? 'text-emerald-700 bg-emerald-50'
                                : 'text-amber-800 bg-amber-50'
                            }`}
                          >
                            {formatCents(account.unreconciledDifferenceCents)}
                          </span>
                        </td>

                        <td className="py-3 px-3 text-center">
                          {account.unreconciledLineCount > 0 ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-900 font-mono font-bold rounded text-[11px]">
                              {account.unreconciledLineCount} pending
                            </span>
                          ) : (
                            <span className="text-emerald-700 flex items-center justify-center gap-1 text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Reconciled</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => {
                                setSelectedAccountId(account.id);
                                setActiveTab('RECONCILIATION');
                              }}
                              className="text-forest-800 hover:bg-forest-50"
                            >
                              Reconcile
                            </Button>

                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => {
                                setEditingAccount(account);
                                setIsEditAccountModalOpen(true);
                              }}
                              title="Edit Banking Config"
                            >
                              <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 2: RECONCILIATION WORKSPACE */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'RECONCILIATION' && (
        <div className="space-y-4">
          {/* Workspace Controls Header */}
          <div className="bg-white border border-slate-200 rounded-[4px] p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Select Bank Account:
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="text-xs font-semibold bg-slate-50 border border-slate-300 rounded-[4px] px-3 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
              >
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name} ({a.unreconciledLineCount} unreconciled)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center gap-1"
              >
                <Upload className="w-3.5 h-3.5 text-forest-700" />
                <span>Import CSV to this Account</span>
              </Button>

              <Button
                variant="outline"
                size="xs"
                onClick={() => loadReconciliation(selectedAccountId)}
                className="flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
                <span>Re-scan Matches</span>
              </Button>
            </div>
          </div>

          {/* Interactive Split-Pane Workspace */}
          {reconciliationLoading ? (
            <div className="bg-white border border-slate-200 rounded-[4px] p-12 text-center text-sm text-slate-500 shadow-sm">
              Scanning statement lines and calculating smart matches…
            </div>
          ) : suggestions.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-[4px] p-12 text-center space-y-3 shadow-sm">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <h3 className="text-base font-bold text-slate-800">Account is 100% Reconciled!</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                All statement lines for this account have been matched to General Ledger transactions or there are no imported statement lines.
              </p>
              <div className="pt-2">
                <Button size="sm" onClick={() => setIsImportModalOpen(true)}>
                  Upload New Statement CSV
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* LEFT COLUMN: Bank Statement Lines (5 cols) */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-[4px] shadow-sm overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                    Bank Statement Lines ({suggestions.length})
                  </span>
                  <span className="text-[11px] text-slate-500">Click to inspect</span>
                </div>

                <div className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
                  {suggestions.map((item) => {
                    const line = item.statementLine;
                    const isSelected = line.id === selectedStmtLineId;
                    const isDeposit = line.amountCents > 0;

                    return (
                      <div
                        key={line.id}
                        onClick={() => setSelectedStmtLineId(line.id)}
                        className={`p-3.5 cursor-pointer transition-colors text-xs ${
                          isSelected
                            ? 'bg-forest-50/80 border-l-4 border-l-forest-800'
                            : 'hover:bg-slate-50/70 border-l-4 border-l-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-slate-500 text-[11px]">{formatDate(line.statementDate)}</span>
                          <span
                            className={`font-mono font-bold ${
                              isDeposit ? 'text-emerald-700' : 'text-slate-900'
                            }`}
                          >
                            {isDeposit ? '+' : ''}
                            {formatCents(line.amountCents)}
                          </span>
                        </div>

                        <p className="font-medium text-slate-800 mt-1 line-clamp-2">{line.description}</p>

                        <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-100 text-[11px]">
                          <span className="text-slate-400 font-mono">{line.reference || 'No ref'}</span>
                          {item.suggestedMatch ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-forest-800 bg-forest-100/60 px-1.5 py-0.5 rounded-[3px]">
                              <Sparkles className="w-2.5 h-2.5" />
                              <span>{item.suggestedMatch.confidence} Match</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">No auto-match</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* RIGHT COLUMN: Matching & Coding Workbench (7 cols) */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-[4px] shadow-sm p-5 space-y-5">
                {currentSuggestion ? (
                  <>
                    {/* Active Statement Line Summary */}
                    <div className="bg-slate-50 border border-slate-200 rounded-[4px] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                          Active Statement Line
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {formatDate(currentSuggestion.statementLine.statementDate)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mt-1">
                        <h3 className="text-sm font-semibold text-slate-900">
                          {currentSuggestion.statementLine.description}
                        </h3>
                        <span
                          className={`font-mono text-base font-bold ${
                            currentSuggestion.statementLine.amountCents > 0
                              ? 'text-emerald-700'
                              : 'text-slate-900'
                          }`}
                        >
                          {currentSuggestion.statementLine.amountCents > 0 ? '+' : ''}
                          {formatCents(currentSuggestion.statementLine.amountCents)}
                        </span>
                      </div>

                      {currentSuggestion.statementLine.reference && (
                        <p className="text-xs text-slate-500 font-mono mt-1">
                          Ref: {currentSuggestion.statementLine.reference}
                        </p>
                      )}
                    </div>

                    {/* SUGGESTED MATCH CARD */}
                    {currentSuggestion.suggestedMatch ? (
                      <div className="border border-forest-300 bg-forest-50/40 rounded-[4px] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-forest-900">
                            <Sparkles className="w-4 h-4 text-forest-800" />
                            <span>Recommended Ledger Match</span>
                          </div>
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-[3px] bg-forest-200 text-forest-900 uppercase">
                            {currentSuggestion.suggestedMatch.confidence} Confidence (Score: {currentSuggestion.suggestedMatch.score})
                          </span>
                        </div>

                        <div className="bg-white border border-forest-200 rounded-[4px] p-3 text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold text-slate-900">
                              {currentSuggestion.suggestedMatch.journalEntry.entryNumber || 'Journal Entry'}
                            </span>
                            <span className="font-mono text-slate-500">
                              {formatDate(currentSuggestion.suggestedMatch.journalEntry.postedAt)}
                            </span>
                          </div>

                          <p className="text-slate-800">{currentSuggestion.suggestedMatch.journalEntry.description}</p>

                          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px]">
                            <span className="text-slate-500 uppercase font-semibold">
                              Type: {currentSuggestion.suggestedMatch.journalEntry.referenceType}
                            </span>
                            <span className="font-mono font-bold text-slate-900">
                              {formatCents(currentSuggestion.suggestedMatch.amountCents)}
                            </span>
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-600">Match Signals:</span>
                          {currentSuggestion.suggestedMatch.reasons.map((r, idx) => (
                            <span key={idx} className="bg-white border border-slate-200 px-1.5 py-0.5 rounded-[3px]">
                              {r}
                            </span>
                          ))}
                        </div>

                        <div className="pt-1">
                          <Button
                            size="sm"
                            className="w-full flex items-center justify-center gap-2"
                            onClick={() =>
                              handleMatch(
                                currentSuggestion.statementLine.id,
                                currentSuggestion.suggestedMatch!.journalEntry.id,
                              )
                            }
                          >
                            <LinkIcon className="w-4 h-4" />
                            <span>1-Click Match & Reconcile</span>
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-50 border border-dashed border-slate-300 rounded-[4px] p-4 text-center text-xs text-slate-500">
                        No automated 1:1 match was found in the General Ledger for this exact amount.
                        Use on-the-fly coding or pick from existing journal entries below.
                      </div>
                    )}

                    {/* ON-THE-FLY CODING / CREATE & RECONCILE */}
                    <div className="border border-slate-200 rounded-[4px] p-4 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                          On-the-Fly Direct Coding (Create & Reconcile)
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {currentSuggestion.statementLine.amountCents < 0 ? 'Spend Money' : 'Receive Money'}
                        </span>
                      </div>

                      <QuickCodeForm
                        statementLine={currentSuggestion.statementLine}
                        allAccounts={allAccounts}
                        trackingCategories={trackingCategories}
                        onSuccess={async () => {
                          setBannerSuccess('Transaction created and reconciled.');
                          await loadReconciliation(selectedAccountId);
                          await loadBankAccounts();
                        }}
                        onError={(msg) => setBannerError(msg)}
                      />
                    </div>

                    {/* MANUAL JOURNAL ENTRY PICKER */}
                    {unreconciledJournals.length > 0 && (
                      <div className="border border-slate-200 rounded-[4px] p-4 space-y-2.5">
                        <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider block">
                          Other Unreconciled Journal Entries on this Account ({unreconciledJournals.length})
                        </span>

                        <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto border border-slate-200 rounded-[4px]">
                          {unreconciledJournals.slice(0, 15).map((jnl) => (
                            <div
                              key={jnl.id}
                              className="p-2.5 text-xs flex items-center justify-between hover:bg-slate-50"
                            >
                              <div>
                                <div className="font-semibold text-slate-900 flex items-center gap-2">
                                  <span>{jnl.entryNumber || 'Journal'}</span>
                                  <span className="font-normal text-slate-500 text-[11px]">
                                    {formatDate(jnl.postedAt)}
                                  </span>
                                </div>
                                <p className="text-slate-600 text-[11px] line-clamp-1">{jnl.description}</p>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="font-mono font-bold text-slate-900">
                                  {formatCents(jnl.amountCents)}
                                </span>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  onClick={() => handleMatch(currentSuggestion.statementLine.id, jnl.id)}
                                >
                                  Match
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Select a statement line on the left to review match recommendations.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 3: INTER-ACCOUNT TRANSFERS */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'TRANSFERS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-[4px] p-4 shadow-sm">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Inter-Account Money Transfers</h2>
              <p className="text-xs text-slate-500">
                Move cash between operating, savings, reserve accounts, or settle corporate credit cards cleanly with zero P&L distortion.
              </p>
            </div>
            <Button size="sm" onClick={() => setIsTransferModalOpen(true)} className="flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              <span>Record Transfer</span>
            </Button>
          </div>

          <div className="bg-white border border-slate-200 rounded-[4px] shadow-sm overflow-hidden">
            {transfersLoading ? (
              <div className="p-8 text-center text-sm text-slate-500">Loading transfers…</div>
            ) : transfers.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <ArrowRightLeft className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm text-slate-600 font-medium">No inter-account transfers recorded yet.</p>
                <p className="text-xs text-slate-400">
                  Use "Record Transfer" to move funds between bank and card accounts.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-semibold">
                      <th className="py-2.5 px-4">Transfer Date</th>
                      <th className="py-2.5 px-3">From Account (Source)</th>
                      <th className="py-2.5 px-3">To Account (Destination)</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                      <th className="py-2.5 px-3">Reference / Description</th>
                      <th className="py-2.5 px-4 text-center">GL Journal</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transfers.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono text-slate-700">{formatDate(t.transferDate)}</td>

                        <td className="py-3 px-3">
                          <span className="font-mono text-slate-700 font-semibold bg-slate-100 px-1.5 py-0.5 rounded-[3px] mr-1.5">
                            {t.fromAccount?.code || '—'}
                          </span>
                          <span className="text-slate-800">{t.fromAccount?.name || 'Unknown'}</span>
                        </td>

                        <td className="py-3 px-3">
                          <span className="font-mono text-forest-800 font-semibold bg-forest-50 px-1.5 py-0.5 rounded-[3px] mr-1.5">
                            {t.toAccount?.code || '—'}
                          </span>
                          <span className="text-slate-800">{t.toAccount?.name || 'Unknown'}</span>
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                          {formatCents(t.amountCents)}
                        </td>

                        <td className="py-3 px-3 text-slate-600">
                          <div>{t.description || 'Inter-Account Transfer'}</div>
                          {t.reference && <div className="text-[11px] text-slate-400 font-mono">Ref: {t.reference}</div>}
                        </td>

                        <td className="py-3 px-4 text-center">
                          {t.journalEntry ? (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-[3px]">
                              <span>{t.journalEntry.entryNumber || 'POSTED'}</span>
                              {t.journalEntry.isReconciled && (
                                <span title="Reconciled">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={async () => {
                              if (!window.confirm('Reverse and delete this inter-account transfer? Its General Ledger journal will be automatically reversed.')) return;
                              try {
                                await bankingApi.deleteTransfer(t.id);
                                setBannerSuccess('Inter-account transfer reversed and deleted.');
                                await loadTransfers();
                                await loadBankAccounts();
                              } catch (err: any) {
                                setBannerError(err.message || 'Failed to delete transfer.');
                              }
                            }}
                            className="text-rose-600 hover:text-rose-800 hover:bg-rose-50 inline-flex items-center gap-1"
                            title="Reverse & Delete Transfer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Reverse</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 4: STATEMENTS IMPORT & HISTORY */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'STATEMENTS' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-[4px] p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Account:</label>
              <select
                value={selectedAccountId}
                onChange={(e) => {
                  setSelectedAccountId(e.target.value);
                  loadStatementLines(e.target.value, statementFilterStatus);
                }}
                className="text-xs font-semibold bg-slate-50 border border-slate-300 rounded-[4px] px-3 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
              >
                <option value="">All Bank Accounts</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name}
                  </option>
                ))}
              </select>

              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider ml-2">Status:</label>
              <select
                value={statementFilterStatus}
                onChange={(e) => {
                  const s = e.target.value as any;
                  setStatementFilterStatus(s);
                  loadStatementLines(selectedAccountId, s);
                }}
                className="text-xs font-semibold bg-slate-50 border border-slate-300 rounded-[4px] px-3 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
              >
                <option value="ALL">All Statuses</option>
                <option value="UNRECONCILED">Unreconciled Only</option>
                <option value="RECONCILED">Reconciled Only</option>
              </select>
            </div>

            <Button size="sm" onClick={() => setIsImportModalOpen(true)} className="flex items-center gap-1.5">
              <Upload className="w-4 h-4" />
              <span>Import Statement CSV</span>
            </Button>
          </div>

          <div className="bg-white border border-slate-200 rounded-[4px] shadow-sm overflow-hidden">
            {statementsLoading ? (
              <div className="p-8 text-center text-sm text-slate-500">Loading statement lines…</div>
            ) : statementLines.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm text-slate-600 font-medium">No statement lines found for the selected filter.</p>
                <p className="text-xs text-slate-400">Upload a CSV bank export to populate statement history.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-semibold">
                      <th className="py-2.5 px-4">Statement Date</th>
                      <th className="py-2.5 px-3">Narrative / Description</th>
                      <th className="py-2.5 px-3">Reference</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3">Matched Journal</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {statementLines.map((line) => (
                      <tr key={line.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono text-slate-700">{formatDate(line.statementDate)}</td>

                        <td className="py-3 px-3 font-medium text-slate-800">{line.description}</td>

                        <td className="py-3 px-3 font-mono text-slate-500 text-[11px]">{line.reference || '—'}</td>

                        <td
                          className={`py-3 px-3 text-right font-mono font-bold ${
                            line.amountCents > 0 ? 'text-emerald-700' : 'text-slate-900'
                          }`}
                        >
                          {line.amountCents > 0 ? '+' : ''}
                          {formatCents(line.amountCents)}
                        </td>

                        <td className="py-3 px-3 text-center">
                          {line.isReconciled ? (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-[3px] bg-emerald-50 text-emerald-800 border border-emerald-200 uppercase">
                              Reconciled
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-[3px] bg-amber-50 text-amber-800 border border-amber-200 uppercase">
                              Unreconciled
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 font-mono text-[11px]">
                          {line.matchedJournal ? (
                            <span className="text-slate-800 font-semibold">
                              {line.matchedJournal.entryNumber || 'Journal'}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {line.isReconciled ? (
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => handleUnmatch(line.id)}
                                className="text-amber-800 hover:bg-amber-50"
                                title="Reopen / Unmatch"
                              >
                                Unmatch
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => handleDeleteStatementLine(line.id)}
                                className="text-rose-600 hover:bg-rose-50"
                                title="Delete statement line"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 1: INTER-ACCOUNT TRANSFER */}
      {/* ------------------------------------------------------------------- */}
      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        bankAccounts={bankAccounts}
        onSuccess={async () => {
          setBannerSuccess('Inter-account transfer recorded successfully.');
          await loadBankAccounts();
          await loadTransfers();
        }}
        onError={(msg) => setBannerError(msg)}
      />

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 2: STATEMENT IMPORT (CSV) */}
      {/* ------------------------------------------------------------------- */}
      <ImportStatementModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        bankAccounts={bankAccounts}
        defaultAccountId={selectedAccountId}
        onSuccess={async (importedCount) => {
          setBannerSuccess(`Successfully imported ${importedCount} statement lines.`);
          await loadBankAccounts();
          if (activeTab === 'RECONCILIATION' && selectedAccountId) {
            await loadReconciliation(selectedAccountId);
          }
          if (activeTab === 'STATEMENTS') {
            await loadStatementLines(selectedAccountId, statementFilterStatus);
          }
        }}
        onError={(msg) => setBannerError(msg)}
      />

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 3: EDIT BANK ACCOUNT DETAILS */}
      {/* ------------------------------------------------------------------- */}
      {editingAccount && (
        <EditAccountModal
          isOpen={isEditAccountModalOpen}
          onClose={() => {
            setIsEditAccountModalOpen(false);
            setEditingAccount(null);
          }}
          account={editingAccount}
          onSuccess={async () => {
            setBannerSuccess('Bank account details updated.');
            await loadBankAccounts();
          }}
          onError={(msg) => setBannerError(msg)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENT: QuickCodeForm (On-the-Fly Create & Reconcile)
// ---------------------------------------------------------------------------

function QuickCodeForm({
  statementLine,
  allAccounts,
  trackingCategories,
  onSuccess,
  onError,
}: {
  statementLine: BankStatementLine;
  allAccounts: AccountWithBalance[];
  trackingCategories: TrackingCategory[];
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const isDeposit = statementLine.amountCents > 0;
  const [targetAccountId, setTargetAccountId] = useState('');
  const [description, setDescription] = useState(statementLine.description);
  const [taxTreatment, setTaxTreatment] = useState<'TAX_EXCLUSIVE' | 'TAX_INCLUSIVE' | 'GST_FREE'>('GST_FREE');
  const [trackingOptionId, setTrackingOptionId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-suggest default account (e.g. Bank Fees for negative lines, Interest for positive lines)
  useEffect(() => {
    setDescription(statementLine.description);
    if (!isDeposit) {
      const feeAcc = allAccounts.find(
        (a) => a.code === '6010' || a.name.toLowerCase().includes('bank fee') || a.name.toLowerCase().includes('charges'),
      );
      if (feeAcc) setTargetAccountId(feeAcc.id);
    } else {
      const intAcc = allAccounts.find(
        (a) => a.code === '8000' || a.name.toLowerCase().includes('interest'),
      );
      if (intAcc) setTargetAccountId(intAcc.id);
    }
  }, [statementLine, allAccounts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAccountId) {
      onError('Please select a target GL account for coding.');
      return;
    }

    try {
      setIsSubmitting(true);
      await bankingApi.createAndReconcile({
        statementLineId: statementLine.id,
        targetAccountId,
        description,
        taxTreatment,
        trackingOptionId: trackingOptionId || null,
      });
      onSuccess();
    } catch (err: any) {
      onError(err.message || 'Failed to create and reconcile transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 uppercase mb-1">
            Target Account (GL Code) *
          </label>
          <select
            value={targetAccountId}
            onChange={(e) => setTargetAccountId(e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-[4px] px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
            required
          >
            <option value="">Select Account…</option>
            {allAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name} ({a.type})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-700 uppercase mb-1">Tax Treatment</label>
          <select
            value={taxTreatment}
            onChange={(e) => setTaxTreatment(e.target.value as any)}
            className="w-full bg-white border border-slate-300 rounded-[4px] px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
          >
            <option value="GST_FREE">GST Free (0%)</option>
            <option value="TAX_EXCLUSIVE">Tax Exclusive (10% GST Added)</option>
            <option value="TAX_INCLUSIVE">Tax Inclusive (10% GST Included)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 uppercase mb-1">Transaction Narrative</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="text-xs py-1"
            placeholder="Description..."
            required
          />
        </div>

        {trackingCategories.length > 0 && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 uppercase mb-1">
              Cost Center / Tracking
            </label>
            <select
              value={trackingOptionId}
              onChange={(e) => setTrackingOptionId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-[4px] px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
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
          </div>
        )}
      </div>

      <div className="pt-2 flex justify-end">
        <Button size="xs" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Posting…' : 'Record & Reconcile Now'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENT: TransferModal (Module 7.2)
// ---------------------------------------------------------------------------

function TransferModal({
  isOpen,
  onClose,
  bankAccounts,
  onSuccess,
  onError,
}: {
  isOpen: boolean;
  onClose: () => void;
  bankAccounts: BankAccountSummary[];
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountStr, setAmountStr] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && bankAccounts.length >= 2) {
      setFromAccountId(bankAccounts[0]!.id);
      setToAccountId(bankAccounts[1]!.id);
    }
  }, [isOpen, bankAccounts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromAccountId || !toAccountId) {
      onError('Please select both source and destination accounts.');
      return;
    }
    if (fromAccountId === toAccountId) {
      onError('Source and destination accounts must be different.');
      return;
    }

    const numAmount = parseFloat(amountStr.replace(/[^0-9.]/g, ''));
    if (isNaN(numAmount) || numAmount <= 0) {
      onError('Please provide a positive transfer amount.');
      return;
    }

    const amountCents = Math.round(numAmount * 100);

    try {
      setIsSubmitting(true);
      await bankingApi.createTransfer({
        fromAccountId,
        toAccountId,
        transferDate,
        amountCents,
        reference: reference.trim() || null,
        description: description.trim() || null,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      onError(err.message || 'Failed to record transfer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="Record Inter-Account Transfer" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              From Account (Source / Credit) *
            </label>
            <select
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-[4px] px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
              required
            >
              <option value="">Select source account…</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name} ({formatCents(a.ledgerBalanceCents)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              To Account (Destination / Debit) *
            </label>
            <select
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-[4px] px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
              required
            >
              <option value="">Select destination account…</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name} ({formatCents(a.ledgerBalanceCents)})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Transfer Date *</label>
            <Input
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              className="text-xs"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Amount ($ AUD) *</label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.00"
              className="text-xs font-mono"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Reference (Optional)</label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TRF-SAVINGS-01"
              className="text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Description (Optional)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Reserve sweep to savings account"
              className="text-xs"
            />
          </div>
        </div>

        {/* GL Posting Invariant Notice */}
        <div className="bg-slate-50 border border-slate-200 rounded-[4px] p-3 text-[11px] text-slate-600 space-y-1">
          <div className="font-semibold text-slate-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-forest-700" />
            <span>Automatic Double-Entry Posting:</span>
          </div>
          <p>
            Posts an atomic 2-line journal entry: <code className="bg-white px-1 py-0.5 border rounded">DEBIT Destination Account</code> and <code className="bg-white px-1 py-0.5 border rounded">CREDIT Source Account</code> with zero GST or P&L distortion.
          </p>
        </div>

        <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Recording…' : 'Record Transfer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENT: ImportStatementModal (Module 7.3)
// ---------------------------------------------------------------------------

function ImportStatementModal({
  isOpen,
  onClose,
  bankAccounts,
  defaultAccountId,
  onSuccess,
  onError,
}: {
  isOpen: boolean;
  onClose: () => void;
  bankAccounts: BankAccountSummary[];
  defaultAccountId?: string;
  onSuccess: (importedCount: number) => void;
  onError: (msg: string) => void;
}) {
  const [bankAccountId, setBankAccountId] = useState(defaultAccountId || '');
  const [csvContent, setCsvContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (defaultAccountId) setBankAccountId(defaultAccountId);
    else if (bankAccounts.length > 0) setBankAccountId(bankAccounts[0]!.id);
  }, [defaultAccountId, bankAccounts]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) setCsvContent(content);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankAccountId) {
      onError('Please select a bank account.');
      return;
    }
    if (!csvContent.trim()) {
      onError('Please paste CSV text or select a CSV file to upload.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await bankingApi.importStatements({
        bankAccountId,
        csvContent,
      });
      onSuccess(res.importedCount);
      onClose();
      setCsvContent('');
    } catch (err: any) {
      onError(err.message || 'Failed to import CSV statement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="Import Bank Statement CSV" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
            Target Bank Account *
          </label>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-[4px] px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
            required
          >
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
            Upload CSV File from Bank Portal
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileUpload}
            className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-[4px] file:border-0 file:text-xs file:font-semibold file:bg-forest-50 file:text-forest-800 hover:file:bg-forest-100"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Supports standard Australian bank exports (CBA, Westpac, ANZ, NAB, Macquarie) with Date, Description, Reference, and Amount or Debit/Credit columns.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
            Or Paste Raw CSV Data Directly
          </label>
          <textarea
            value={csvContent}
            onChange={(e) => setCsvContent(e.target.value)}
            rows={8}
            placeholder={`Date,Description,Reference,Amount\n01/02/2026,"Office Supplies Pty Ltd",REF-101,-145.20\n02/02/2026,"Client Payment Acme Corp",INV-0012,2420.00`}
            className="w-full font-mono text-[11px] bg-slate-50 border border-slate-300 rounded-[4px] p-3 text-slate-800 focus:outline-none focus:ring-1 focus:ring-forest-800"
          />
        </div>

        <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Importing…' : 'Parse & Import Statement Lines'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENT: EditAccountModal
// ---------------------------------------------------------------------------

function EditAccountModal({
  isOpen,
  onClose,
  account,
  onSuccess,
  onError,
}: {
  isOpen: boolean;
  onClose: () => void;
  account: BankAccountSummary;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [bankBsb, setBankBsb] = useState(account.bankBsb || '');
  const [bankAccountNumber, setBankAccountNumber] = useState(account.bankAccountNumber || '');
  const [apcaUserId, setApcaUserId] = useState(account.apcaUserId || '');
  const [isBankAccount, setIsBankAccount] = useState(account.isBankAccount);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await bankingApi.updateAccount(account.id, {
        isBankAccount,
        bankBsb: bankBsb.trim() || null,
        bankAccountNumber: bankAccountNumber.trim() || null,
        apcaUserId: apcaUserId.trim() || null,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      onError(err.message || 'Failed to update account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} title={`Configure ${account.code} - ${account.name}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isBankAccount}
              onChange={(e) => setIsBankAccount(e.target.checked)}
              className="rounded-[3px] text-forest-800 focus:ring-forest-800"
            />
            <span className="font-semibold text-slate-800">Flag as Active Bank / Credit Card Account</span>
          </label>
          <p className="text-[11px] text-slate-400 mt-1 pl-5">
            When enabled, this account appears in the Banking Hub, Transfer selectors, and Statement Reconciliation.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">BSB Number</label>
            <Input
              value={bankBsb}
              onChange={(e) => setBankBsb(e.target.value)}
              placeholder="e.g. 082-001"
              className="text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Account Number</label>
            <Input
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              placeholder="e.g. 123456789"
              className="text-xs font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
            APCA User ID (Direct Entry)
          </label>
          <Input
            value={apcaUserId}
            onChange={(e) => setApcaUserId(e.target.value)}
            placeholder="e.g. 301500"
            className="text-xs font-mono"
          />
        </div>

        <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save Details'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
