import React, { useEffect, useState, useMemo } from 'react';
import {
  Landmark,
  Search,
  Plus,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Building,
  CreditCard,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  accountsApi,
  type AccountWithBalance,
  type AccountType,
  type TaxTreatment,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { StatusTag } from '@/components/ui/StatusTag';

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expense',
};

const ACCOUNT_TYPE_TONES: Record<AccountType, 'emerald' | 'amber' | 'slate' | 'forest' | 'rose'> = {
  ASSET: 'emerald',
  LIABILITY: 'amber',
  EQUITY: 'slate',
  REVENUE: 'forest',
  EXPENSE: 'rose',
};

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filters
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  // Create Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createCode, setCreateCode] = useState('');
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState<AccountType>('EXPENSE');
  const [createParentId, setCreateParentId] = useState<string>('');
  const [createTaxTreatment, setCreateTaxTreatment] = useState<TaxTreatment>('TAX_EXCLUSIVE');
  const [createIsBankAccount, setCreateIsBankAccount] = useState(false);
  const [createBankBsb, setCreateBankBsb] = useState('');
  const [createBankAccountNumber, setCreateBankAccountNumber] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const fetchAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await accountsApi.list({
        type: selectedType !== 'ALL' ? selectedType : undefined,
        includeInactive,
        search: search.trim() || undefined,
      });
      setAccounts(res.accounts);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load Chart of Accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAccounts();
  }, [selectedType, includeInactive]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchAccounts();
  };

  const handleSeedAccounts = async () => {
    setSeeding(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await accountsApi.seed();
      setFeedback(res.message);
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to seed system accounts.');
    } finally {
      setSeeding(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError(null);

    try {
      await accountsApi.create({
        code: createCode.trim(),
        name: createName.trim(),
        type: createType,
        parentId: createParentId ? createParentId : null,
        defaultTaxTreatment: createTaxTreatment,
        isBankAccount: createIsBankAccount,
        bankBsb: createIsBankAccount && createBankBsb ? createBankBsb.trim() : null,
        bankAccountNumber: createIsBankAccount && createBankAccountNumber ? createBankAccountNumber.trim() : null,
        description: createDescription.trim() || null,
      });

      setIsCreateOpen(false);
      // Reset form
      setCreateCode('');
      setCreateName('');
      setCreateType('EXPENSE');
      setCreateParentId('');
      setCreateTaxTreatment('TAX_EXCLUSIVE');
      setCreateIsBankAccount(false);
      setCreateBankBsb('');
      setCreateBankAccountNumber('');
      setCreateDescription('');
      setFeedback(`Account ${createCode} created successfully.`);
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) {
        setCreateError(err.message);
      } else {
        setCreateError('Failed to create account. Please check your inputs.');
      }
    } finally {
      setCreateLoading(false);
    }
  };

  // Group / Summary metrics
  const metrics = useMemo(() => {
    let totalAssetsCents = 0;
    let totalLiabilitiesCents = 0;
    let totalEquityCents = 0;
    let totalRevenueCents = 0;
    let totalExpensesCents = 0;

    for (const acc of accounts) {
      if (acc.type === 'ASSET') totalAssetsCents += acc.netBalanceCents;
      else if (acc.type === 'LIABILITY') totalLiabilitiesCents += acc.netBalanceCents;
      else if (acc.type === 'EQUITY') totalEquityCents += acc.netBalanceCents;
      else if (acc.type === 'REVENUE') totalRevenueCents += acc.netBalanceCents;
      else if (acc.type === 'EXPENSE') totalExpensesCents += acc.netBalanceCents;
    }

    return {
      totalAssetsCents,
      totalLiabilitiesCents,
      totalEquityCents,
      totalRevenueCents,
      totalExpensesCents,
      count: accounts.length,
    };
  }, [accounts]);

  // Filter available parents for sub-accounts
  const parentAccountCandidates = useMemo(() => {
    return accounts.filter((a) => a.type === createType && !a.parentId);
  }, [accounts, createType]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-slate-900 tracking-tight">
            Chart of Accounts
          </h1>
          <p className="text-xs text-slate-500 font-light mt-0.5">
            General Ledger structure, account categories & live running balances
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSeedAccounts}
            disabled={seeding || loading}
            className="inline-flex items-center gap-1.5 text-xs h-8"
            title="Verifies and initializes the 10 Protected Australian Core GL Accounts"
          >
            <Sparkles className={`w-3.5 h-3.5 text-forest-700 ${seeding ? 'animate-spin' : ''}`} />
            <span>{seeding ? 'Seeding…' : 'Seed System Accounts'}</span>
          </Button>

          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs h-8"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Account</span>
          </Button>
        </div>
      </div>

      {/* Feedback & Error banners */}
      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between">
          <span>{feedback}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-sm">
          <span className="text-[11px] font-light text-slate-500">Total Accounts</span>
          <p className="text-lg font-mono font-medium text-slate-900 mt-0.5">
            {metrics.count}
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-sm">
          <span className="text-[11px] font-light text-slate-500">Assets</span>
          <p className="text-lg font-mono font-medium text-emerald-700 mt-0.5">
            {formatCents(metrics.totalAssetsCents)}
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-sm">
          <span className="text-[11px] font-light text-slate-500">Liabilities</span>
          <p className="text-lg font-mono font-medium text-amber-700 mt-0.5">
            {formatCents(metrics.totalLiabilitiesCents)}
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-sm">
          <span className="text-[11px] font-light text-slate-500">Equity</span>
          <p className="text-lg font-mono font-medium text-slate-700 mt-0.5">
            {formatCents(metrics.totalEquityCents)}
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-sm">
          <span className="text-[11px] font-light text-slate-500">Revenue</span>
          <p className="text-lg font-mono font-medium text-forest-800 mt-0.5">
            {formatCents(metrics.totalRevenueCents)}
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-sm">
          <span className="text-[11px] font-light text-slate-500">Expenses</span>
          <p className="text-lg font-mono font-medium text-rose-700 mt-0.5">
            {formatCents(metrics.totalExpensesCents)}
          </p>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        {/* Controls Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search */}
          <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search code, name or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-9 pr-3 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 focus:border-forest-900 transition-colors"
            />
          </form>

          {/* Classification Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(['ALL', 'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                  selectedType === t
                    ? 'bg-forest-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t === 'ALL' ? 'All Types' : ACCOUNT_TYPE_LABELS[t as AccountType]}
              </button>
            ))}

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-500 ml-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="rounded border-slate-300 text-forest-800 focus:ring-forest-900"
              />
              <span>Archived</span>
            </label>
          </div>
        </div>

        {/* Accounts Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-xs text-slate-400">
              <RefreshCw className="w-5 h-5 mx-auto animate-spin text-forest-800 mb-2" />
              Loading Chart of Accounts…
            </div>
          ) : accounts.length === 0 ? (
            <div className="p-12 text-center">
              <Landmark className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-800">
                No accounts found in this organization
              </p>
              <p className="text-xs text-slate-400 font-light mt-1 max-w-sm mx-auto">
                Initialize the 10 Protected Australian Core GL Accounts to enable automatic sub-ledger postings.
              </p>
              <Button
                size="sm"
                onClick={handleSeedAccounts}
                disabled={seeding}
                className="mt-4 text-xs h-8"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1" />
                {seeding ? 'Initializing…' : 'Initialize Core Accounts'}
              </Button>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70 text-slate-500 font-medium">
                  <th className="py-2.5 px-4 w-28">Code</th>
                  <th className="py-2.5 px-4">Account Name</th>
                  <th className="py-2.5 px-4 w-32">Classification</th>
                  <th className="py-2.5 px-4 w-24">Balance Side</th>
                  <th className="py-2.5 px-4 w-32">Tax Treatment</th>
                  <th className="py-2.5 px-4 w-24 text-center">Protected</th>
                  <th className="py-2.5 px-4 text-right w-36">Live Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-light text-slate-700">
                {accounts.map((acc) => (
                  <tr
                    key={acc.id}
                    className="hover:bg-slate-50/60 transition-colors"
                  >
                    {/* Code */}
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                      {acc.code}
                    </td>

                    {/* Name & Memo */}
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1.5">
                        {acc.parentId && (
                          <span className="text-slate-400 text-[10px] mr-1">↳</span>
                        )}
                        <span className="font-medium text-slate-800">{acc.name}</span>
                        {acc.isBankAccount && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-sky-50 text-sky-700 border border-sky-200"
                            title={acc.bankBsb ? `BSB: ${acc.bankBsb}` : 'Bank Account'}
                          >
                            <CreditCard className="w-2.5 h-2.5 mr-1" />
                            Bank
                          </span>
                        )}
                      </div>
                      {acc.description && (
                        <p className="text-[11px] text-slate-400 font-light truncate max-w-md">
                          {acc.description}
                        </p>
                      )}
                    </td>

                    {/* Type badge */}
                    <td className="py-2.5 px-4">
                      <StatusTag
                        tone={ACCOUNT_TYPE_TONES[acc.type]}
                        label={ACCOUNT_TYPE_LABELS[acc.type]}
                      />
                    </td>

                    {/* Normal Balance */}
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                      {acc.normalBalance}
                    </td>

                    {/* Tax Treatment */}
                    <td className="py-2.5 px-4 text-slate-600">
                      {acc.defaultTaxTreatment ? acc.defaultTaxTreatment.replace('_', ' ') : '—'}
                    </td>

                    {/* System Account badge */}
                    <td className="py-2.5 px-4 text-center">
                      {acc.isSystem ? (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 font-mono"
                          title={`System Protected: ${acc.systemKey || 'Core'}`}
                        >
                          <ShieldCheck className="w-3 h-3 text-slate-600" />
                          System
                        </span>
                      ) : (
                        <span className="text-slate-300 text-[11px]">Custom</span>
                      )}
                    </td>

                    {/* Live Balance */}
                    <td className="py-2.5 px-4 text-right font-mono font-medium">
                      <span
                        className={
                          acc.netBalanceCents < 0
                            ? 'text-rose-600'
                            : acc.netBalanceCents > 0
                            ? 'text-slate-900'
                            : 'text-slate-400'
                        }
                      >
                        {formatCents(acc.netBalanceCents)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Account Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New GL Account"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {createError && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
              {createError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Account Code <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. 1020, 6150"
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
                required
                className="font-mono text-xs"
              />
              <span className="text-[10px] text-slate-400">2–12 alphanumeric chars</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Classification <span className="text-red-500">*</span>
              </label>
              <select
                value={createType}
                onChange={(e) => setCreateType(e.target.value as AccountType)}
                className="w-full h-8 px-2.5 text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
              >
                <option value="ASSET">Asset</option>
                <option value="LIABILITY">Liability</option>
                <option value="EQUITY">Equity</option>
                <option value="REVENUE">Revenue</option>
                <option value="EXPENSE">Expense</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Account Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              placeholder="e.g. Marketing & Advertising Expenses"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Parent Account (Sub-Account of)
              </label>
              <select
                value={createParentId}
                onChange={(e) => setCreateParentId(e.target.value)}
                className="w-full h-8 px-2.5 text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
              >
                <option value="">(None — Top-level Account)</option>
                {parentAccountCandidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Default Tax Treatment
              </label>
              <select
                value={createTaxTreatment}
                onChange={(e) => setCreateTaxTreatment(e.target.value as TaxTreatment)}
                className="w-full h-8 px-2.5 text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
              >
                <option value="TAX_EXCLUSIVE">Tax Exclusive (10% GST on net)</option>
                <option value="TAX_INCLUSIVE">Tax Inclusive (10% GST in gross)</option>
                <option value="GST_FREE">GST Free (0% GST)</option>
              </select>
            </div>
          </div>

          {/* Bank Account Checkbox */}
          {createType === 'ASSET' && (
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 space-y-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createIsBankAccount}
                  onChange={(e) => setCreateIsBankAccount(e.target.checked)}
                  className="rounded border-slate-300 text-forest-800 focus:ring-forest-900"
                />
                <span>Designate as Operating Bank Account</span>
              </label>

              {createIsBankAccount && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">Bank BSB</label>
                    <Input
                      type="text"
                      placeholder="e.g. 062-000"
                      value={createBankBsb}
                      onChange={(e) => setCreateBankBsb(e.target.value)}
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">Account Number</label>
                    <Input
                      type="text"
                      placeholder="e.g. 12345678"
                      value={createBankAccountNumber}
                      onChange={(e) => setCreateBankAccountNumber(e.target.value)}
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Description / Notes
            </label>
            <Input
              type="text"
              placeholder="Operational description or guidance for staff postings"
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createLoading}
              className="text-xs h-8"
            >
              {createLoading ? 'Creating…' : 'Create Account'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

