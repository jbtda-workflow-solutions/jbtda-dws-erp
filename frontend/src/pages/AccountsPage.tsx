import React, { useEffect, useState, useMemo } from 'react';
import {
  Landmark,
  Search,
  Plus,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Sparkles,
  CreditCard,
  Layers,
  Edit2,
  Trash2,
  ArrowRightLeft,
  Tag,
} from 'lucide-react';
import {
  accountsApi,
  type AccountWithBalance,
  type AccountType,
  type TaxTreatment,
  type TrackingCategory,
  type TrackingOption,
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
  // Top Active Tab: 'COA' or 'TRACKING'
  const [activeTab, setActiveTab] = useState<'COA' | 'TRACKING'>('COA');

  // Chart of Accounts State
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filters
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  // Create Account Modal state
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

  // Edit Account Modal state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<AccountWithBalance | null>(null);
  const [editName, setEditName] = useState('');
  const [editParentId, setEditParentId] = useState<string>('');
  const [editTaxTreatment, setEditTaxTreatment] = useState<TaxTreatment>('TAX_EXCLUSIVE');
  const [editIsBankAccount, setEditIsBankAccount] = useState(false);
  const [editBankBsb, setEditBankBsb] = useState('');
  const [editBankAccountNumber, setEditBankAccountNumber] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // Balance Sweep & Decommission Modal state
  const [isSweepOpen, setIsSweepOpen] = useState(false);
  const [sweepAccount, setSweepAccount] = useState<AccountWithBalance | null>(null);
  const [sweepTargetAccountId, setSweepTargetAccountId] = useState<string>('');
  const [sweepDate, setSweepDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);

  // Tracking Dimensions State
  const [categories, setCategories] = useState<TrackingCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [isAddCatOpen, setIsAddCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatOptions, setNewCatOptions] = useState('');
  const [catActionLoading, setCatActionLoading] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);

  // Add Option to Category modal
  const [selectedCatForOption, setSelectedCatForOption] = useState<TrackingCategory | null>(null);
  const [newOptionName, setNewOptionName] = useState('');
  const [newOptionCode, setNewOptionCode] = useState('');

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

  const fetchTrackingCategories = async () => {
    setCategoriesLoading(true);
    try {
      const res = await accountsApi.listTrackingCategories();
      setCategories(res.categories);
    } catch (err) {
      if (err instanceof ApiError) setCatError(err.message);
      else setCatError('Failed to load tracking categories.');
    } finally {
      setCategoriesLoading(false);
    }
  };

  useEffect(() => {
    void fetchAccounts();
  }, [selectedType, includeInactive]);

  useEffect(() => {
    if (activeTab === 'TRACKING') {
      void fetchTrackingCategories();
    }
  }, [activeTab]);

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

  // Open Edit Modal
  const openEditModal = (acc: AccountWithBalance) => {
    setEditAccount(acc);
    setEditName(acc.name);
    setEditParentId(acc.parentId || '');
    setEditTaxTreatment(acc.defaultTaxTreatment || 'TAX_EXCLUSIVE');
    setEditIsBankAccount(Boolean(acc.isBankAccount));
    setEditBankBsb(acc.bankBsb || '');
    setEditBankAccountNumber(acc.bankAccountNumber || '');
    setEditDescription(acc.description || '');
    setEditIsActive(acc.isActive);
    setEditError(null);
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAccount) return;
    setEditLoading(true);
    setEditError(null);

    try {
      await accountsApi.update(editAccount.id, {
        name: editName.trim(),
        parentId: editParentId ? editParentId : null,
        defaultTaxTreatment: editTaxTreatment,
        isBankAccount: editIsBankAccount,
        bankBsb: editIsBankAccount && editBankBsb ? editBankBsb.trim() : null,
        bankAccountNumber: editIsBankAccount && editBankAccountNumber ? editBankAccountNumber.trim() : null,
        description: editDescription.trim() || null,
        isActive: editIsActive,
      });

      setIsEditOpen(false);
      setFeedback(`Account ${editAccount.code} updated successfully.`);
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) setEditError(err.message);
      else setEditError('Failed to update account.');
    } finally {
      setEditLoading(false);
    }
  };

  // Open Sweep Modal
  const openSweepModal = (acc: AccountWithBalance) => {
    setSweepAccount(acc);
    const candidate = accounts.find(
      (a) => a.id !== acc.id && a.type === acc.type && a.isActive && (a.id === acc.parentId || !a.parentId),
    );
    setSweepTargetAccountId(candidate ? candidate.id : '');
    setSweepDate(new Date().toISOString().slice(0, 10));
    setSweepError(null);
    setIsSweepOpen(true);
  };

  const handleSweepSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sweepAccount) return;
    setSweepLoading(true);
    setSweepError(null);

    try {
      const res = await accountsApi.decommission(sweepAccount.id, {
        targetAccountId: sweepTargetAccountId || null,
        postedAt: sweepDate ? new Date(sweepDate).toISOString() : undefined,
      });

      setIsSweepOpen(false);
      setFeedback(
        res.sweepJournalId
          ? `Account ${sweepAccount.code} balance successfully swept into target account and marked inactive.`
          : `Account ${sweepAccount.code} successfully marked inactive (zero balance).`,
      );
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) setSweepError(err.message);
      else setSweepError('Failed to decommission account.');
    } finally {
      setSweepLoading(false);
    }
  };

  // Direct Delete for unused custom accounts
  const handleDeleteAccount = async (acc: AccountWithBalance) => {
    if (!confirm(`Are you sure you want to permanently delete custom account ${acc.code} - ${acc.name}?`)) {
      return;
    }
    setError(null);
    try {
      const res = await accountsApi.delete(acc.id);
      setFeedback(res.message);
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to delete account.');
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

  // Tracking Dimension Category Handlers
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setCatActionLoading(true);
    setCatError(null);

    try {
      const options = newCatOptions
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((name) => ({ name }));

      await accountsApi.createTrackingCategory({
        name: newCatName.trim(),
        options: options.length > 0 ? options : undefined,
      });

      setIsAddCatOpen(false);
      setNewCatName('');
      setNewCatOptions('');
      setFeedback('Tracking category created successfully.');
      await fetchTrackingCategories();
    } catch (err) {
      if (err instanceof ApiError) setCatError(err.message);
      else setCatError('Failed to create tracking category.');
    } finally {
      setCatActionLoading(false);
    }
  };

  const handleAddOption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCatForOption || !newOptionName.trim()) return;
    setCatActionLoading(true);
    setCatError(null);

    try {
      await accountsApi.addTrackingOption(selectedCatForOption.id, {
        name: newOptionName.trim(),
        code: newOptionCode.trim() || null,
      });

      setSelectedCatForOption(null);
      setNewOptionName('');
      setNewOptionCode('');
      setFeedback('Tracking option added successfully.');
      await fetchTrackingCategories();
    } catch (err) {
      if (err instanceof ApiError) setCatError(err.message);
      else setCatError('Failed to add tracking option.');
    } finally {
      setCatActionLoading(false);
    }
  };

  const handleToggleOptionStatus = async (opt: TrackingOption) => {
    try {
      await accountsApi.updateTrackingOption(opt.id, { isActive: !opt.isActive });
      await fetchTrackingCategories();
    } catch (err) {
      if (err instanceof ApiError) setCatError(err.message);
    }
  };

  const handleDeleteCategory = async (cat: TrackingCategory) => {
    if (!confirm(`Are you sure you want to remove or archive tracking category "${cat.name}"?`)) {
      return;
    }
    setCatError(null);
    try {
      const res = await accountsApi.deleteTrackingCategory(cat.id);
      setFeedback(res.message);
      await fetchTrackingCategories();
    } catch (err) {
      if (err instanceof ApiError) setCatError(err.message);
      else setCatError('Failed to delete category.');
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

  // Candidates for Sweep destination
  const sweepDestinationCandidates = useMemo(() => {
    if (!sweepAccount) return [];
    return accounts.filter(
      (a) => a.id !== sweepAccount.id && a.type === sweepAccount.type && a.isActive,
    );
  }, [accounts, sweepAccount]);

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-medium text-slate-900 tracking-tight">
            Chart of Accounts & Cost Dimensions
          </h1>
          <p className="text-xs text-slate-500 font-light mt-0.5">
            General Ledger financial architecture, live running balances, cost center tags & decommissioning sweeps
          </p>
        </div>

        {activeTab === 'COA' ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
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
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setIsAddCatOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs h-8"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Tracking Dimension</span>
            </Button>
          </div>
        )}
      </div>

      {/* Sub-Navigation Tab Bar */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('COA')}
          className={`px-4 py-2 text-xs border-b-2 -mb-px transition-colors ${
            activeTab === 'COA'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          Chart of Accounts
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('TRACKING')}
          className={`px-4 py-2 text-xs border-b-2 -mb-px transition-colors ${
            activeTab === 'TRACKING'
              ? 'border-forest-900 text-forest-900 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          Tracking Dimensions
        </button>
      </div>

      {/* Feedback & Error banners */}
      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md text-xs flex items-center justify-between">
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
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {catError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{catError}</span>
        </div>
      )}

      {activeTab === 'COA' ? (
        <>
          {/* Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <div className="bg-white p-3 rounded-md border border-slate-200">
              <span className="text-[11px] font-light text-slate-500">Total Accounts</span>
              <p className="text-lg font-mono font-medium text-slate-900 mt-0.5">
                {metrics.count}
              </p>
            </div>

            <div className="bg-white p-3 rounded-md border border-slate-200">
              <span className="text-[11px] font-light text-slate-500">Assets</span>
              <p className="text-lg font-mono font-medium text-emerald-700 mt-0.5">
                {formatCents(metrics.totalAssetsCents)}
              </p>
            </div>

            <div className="bg-white p-3 rounded-md border border-slate-200">
              <span className="text-[11px] font-light text-slate-500">Liabilities</span>
              <p className="text-lg font-mono font-medium text-amber-700 mt-0.5">
                {formatCents(metrics.totalLiabilitiesCents)}
              </p>
            </div>

            <div className="bg-white p-3 rounded-md border border-slate-200">
              <span className="text-[11px] font-light text-slate-500">Equity</span>
              <p className="text-lg font-mono font-medium text-slate-700 mt-0.5">
                {formatCents(metrics.totalEquityCents)}
              </p>
            </div>

            <div className="bg-white p-3 rounded-md border border-slate-200">
              <span className="text-[11px] font-light text-slate-500">Revenue</span>
              <p className="text-lg font-mono font-medium text-forest-800 mt-0.5">
                {formatCents(metrics.totalRevenueCents)}
              </p>
            </div>

            <div className="bg-white p-3 rounded-md border border-slate-200">
              <span className="text-[11px] font-light text-slate-500">Expenses</span>
              <p className="text-lg font-mono font-medium text-rose-700 mt-0.5">
                {formatCents(metrics.totalExpensesCents)}
              </p>
            </div>
          </div>

          {/* Main Table Container */}
          <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
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
                  <span>Show Archived</span>
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
                      <th className="py-2.5 px-4 text-right w-28">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-light text-slate-700">
                    {accounts.map((acc) => (
                      <tr
                        key={acc.id}
                        className={`hover:bg-slate-50/60 transition-colors ${
                          !acc.isActive ? 'bg-slate-50/40 opacity-70' : ''
                        }`}
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
                            {!acc.isActive && (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] bg-slate-200 text-slate-600 font-mono">
                                Inactive
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

                        {/* Actions column */}
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(acc)}
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                              title="Edit account properties"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            {!acc.isSystem && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openSweepModal(acc)}
                                  className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded transition-colors"
                                  title="Decommission & Balance Sweep"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5" />
                                </button>

                                {acc.lineCount === 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAccount(acc)}
                                    className="p-1 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                                    title="Delete unused custom account"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Tracking Categories & Dimensions Management Tab */
        <div className="space-y-4">
          <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3 text-xs text-slate-600 flex items-start gap-2.5">
            <Tag className="w-4 h-4 text-forest-800 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-slate-800">
                Dimensional Accounting (Cost Centers & Segments)
              </p>
              <p className="text-slate-500 font-light mt-0.5 leading-relaxed">
                Tracking Dimensions allow assigning line items across General Ledger journals, invoices, and bills to business units (e.g. <em>Department: Engineering</em>, <em>Project: Alpha</em>) without creating hundreds of duplicate accounts.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categoriesLoading ? (
              <div className="col-span-2 p-12 text-center text-xs text-slate-400">
                <RefreshCw className="w-5 h-5 mx-auto animate-spin text-forest-800 mb-2" />
                Loading Tracking Dimensions…
              </div>
            ) : categories.length === 0 ? (
              <div className="col-span-2 p-12 bg-white rounded-md border border-slate-200 text-center">
                <Layers className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-800">
                  No tracking dimensions defined
                </p>
                <p className="text-xs text-slate-400 font-light mt-1 max-w-sm mx-auto">
                  Create dimensions like "Department", "Project", or "Fleet Vehicle" with selectable options.
                </p>
                <Button
                  size="sm"
                  onClick={() => setIsAddCatOpen(true)}
                  className="mt-4 text-xs h-8"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Create First Dimension
                </Button>
              </div>
            ) : (
              categories.map((cat) => (
                <div
                  key={cat.id}
                  className="bg-white rounded-md border border-slate-200 p-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
                      <div>
                        <h3 className="text-sm font-medium text-slate-900">{cat.name}</h3>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {cat.options.length} options defined
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedCatForOption(cat)}
                          className="text-xs h-7 px-2"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add Option
                        </Button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat)}
                          className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                          title="Archive or delete dimension"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 min-h-[80px]">
                      {cat.options.length === 0 ? (
                        <p className="text-xs text-slate-400 italic py-2">
                          No options added to this dimension yet.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {cat.options.map((opt) => (
                            <span
                              key={opt.id}
                              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono border ${
                                opt.isActive
                                  ? 'bg-slate-50 border-slate-200 text-slate-800'
                                  : 'bg-slate-100/60 border-slate-200 text-slate-400 line-through'
                              }`}
                            >
                              <span>{opt.name}</span>
                              {opt.code && (
                                <span className="text-[10px] text-slate-400">({opt.code})</span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleToggleOptionStatus(opt)}
                                className="text-slate-400 hover:text-slate-700 ml-0.5"
                                title={opt.isActive ? 'Archive Option' : 'Reactivate Option'}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Create Account Modal */}
      <Modal
        open={isCreateOpen}
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
                <option value="ASSET">ASSET (Debit balance)</option>
                <option value="LIABILITY">LIABILITY (Credit balance)</option>
                <option value="EQUITY">EQUITY (Credit balance)</option>
                <option value="REVENUE">REVENUE (Credit balance)</option>
                <option value="EXPENSE">EXPENSE (Debit balance)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Account Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              placeholder="e.g. Workshop Tools & Supplies, Marketing Retainers"
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
                <option value="">None (Top-Level Account)</option>
                {parentAccountCandidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {p.name}
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
              variant="outline"
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

      {/* Edit Account Modal */}
      <Modal
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title={editAccount ? `Edit Account: ${editAccount.code}` : 'Edit Account'}
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          {editError && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
              {editError}
            </div>
          )}

          {editAccount?.isSystem && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded text-xs flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                This is a <strong>Protected System Account</strong> ({editAccount.systemKey}). Code and classification cannot be changed.
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Account Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Parent Account
              </label>
              <select
                value={editParentId}
                onChange={(e) => setEditParentId(e.target.value)}
                className="w-full h-8 px-2.5 text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
              >
                <option value="">None (Top-Level Account)</option>
                {accounts
                  .filter((a) => editAccount && a.id !== editAccount.id && a.type === editAccount.type && !a.parentId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} - {p.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Default Tax Treatment
              </label>
              <select
                value={editTaxTreatment}
                onChange={(e) => setEditTaxTreatment(e.target.value as TaxTreatment)}
                className="w-full h-8 px-2.5 text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
              >
                <option value="TAX_EXCLUSIVE">Tax Exclusive (10% GST on net)</option>
                <option value="TAX_INCLUSIVE">Tax Inclusive (10% GST in gross)</option>
                <option value="GST_FREE">GST Free (0% GST)</option>
              </select>
            </div>
          </div>

          {editAccount?.type === 'ASSET' && (
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 space-y-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editIsBankAccount}
                  onChange={(e) => setEditIsBankAccount(e.target.checked)}
                  className="rounded border-slate-300 text-forest-800 focus:ring-forest-900"
                />
                <span>Designate as Operating Bank Account</span>
              </label>

              {editIsBankAccount && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">Bank BSB</label>
                    <Input
                      type="text"
                      placeholder="e.g. 062-000"
                      value={editBankBsb}
                      onChange={(e) => setEditBankBsb(e.target.value)}
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">Account Number</label>
                    <Input
                      type="text"
                      placeholder="e.g. 12345678"
                      value={editBankAccountNumber}
                      onChange={(e) => setEditBankAccountNumber(e.target.value)}
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
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
            />
          </div>

          {!editAccount?.isSystem && (
            <div className="pt-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="rounded border-slate-300 text-forest-800 focus:ring-forest-900"
                />
                <span>Account is Active (Available for sub-ledger postings)</span>
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEditOpen(false)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={editLoading}
              className="text-xs h-8"
            >
              {editLoading ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Balance Sweep & Decommission Modal */}
      <Modal
        open={isSweepOpen}
        onClose={() => setIsSweepOpen(false)}
        title={sweepAccount ? `Decommission Account: ${sweepAccount.code}` : 'Decommission Account'}
      >
        <form onSubmit={handleSweepSubmit} className="space-y-4">
          {sweepError && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
              {sweepError}
            </div>
          )}

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Account:</span>
              <span className="font-medium text-slate-800">
                {sweepAccount?.code} - {sweepAccount?.name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Current Net Balance:</span>
              <span className="font-mono font-medium text-slate-900">
                {sweepAccount ? formatCents(sweepAccount.netBalanceCents) : '—'}
              </span>
            </div>
          </div>

          {sweepAccount && sweepAccount.netBalanceCents !== 0 ? (
            <>
              <p className="text-xs text-slate-600 font-light">
                This account has a live non-zero balance. To safely decommission it, an automated <strong>Balance Sweep Journal</strong> will be posted to transfer all funds into the target account of the same classification, bringing this account to zero before archiving it.
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Destination Target Account <span className="text-red-500">*</span>
                </label>
                <select
                  value={sweepTargetAccountId}
                  onChange={(e) => setSweepTargetAccountId(e.target.value)}
                  required
                  className="w-full h-8 px-2.5 text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                >
                  <option value="">Select target account to absorb balance…</option>
                  {sweepDestinationCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} - {c.name} ({formatCents(c.netBalanceCents)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Sweep Journal Effective Date
                </label>
                <Input
                  type="date"
                  value={sweepDate}
                  onChange={(e) => setSweepDate(e.target.value)}
                  required
                  className="text-xs font-mono h-8"
                />
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-600 font-light">
              This account currently has a <strong>$0.00 balance</strong>. Decommissioning will immediately mark it inactive and preserve historical journal records.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsSweepOpen(false)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="amber"
              size="sm"
              disabled={sweepLoading || (sweepAccount?.netBalanceCents !== 0 && !sweepTargetAccountId)}
              className="text-xs h-8"
            >
              {sweepLoading ? 'Sweeping…' : 'Confirm & Decommission'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* New Tracking Dimension Modal */}
      <Modal
        open={isAddCatOpen}
        onClose={() => setIsAddCatOpen(false)}
        title="Create New Tracking Dimension"
      >
        <form onSubmit={handleCreateCategory} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Dimension Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              placeholder="e.g. Department, Project, Fleet Vehicle, Region"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Initial Options (one per line)
            </label>
            <textarea
              rows={4}
              placeholder="e.g.&#10;Operations&#10;Marketing&#10;Engineering&#10;Executive"
              value={newCatOptions}
              onChange={(e) => setNewCatOptions(e.target.value)}
              className="w-full p-2.5 text-xs rounded border border-slate-300 bg-white font-mono focus:outline-none focus:ring-1 focus:ring-forest-900"
            />
            <span className="text-[10px] text-slate-400">
              You can add or toggle more options at any time.
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsAddCatOpen(false)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={catActionLoading || !newCatName.trim()}
              className="text-xs h-8"
            >
              {catActionLoading ? 'Creating…' : 'Create Dimension'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add Option to Dimension Modal */}
      <Modal
        open={Boolean(selectedCatForOption)}
        onClose={() => setSelectedCatForOption(null)}
        title={selectedCatForOption ? `Add Option to ${selectedCatForOption.name}` : 'Add Option'}
      >
        <form onSubmit={handleAddOption} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Option Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              placeholder="e.g. Sydney Office, Truck-04, Project Delta"
              value={newOptionName}
              onChange={(e) => setNewOptionName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Optional Dimension Code
            </label>
            <Input
              type="text"
              placeholder="e.g. SYD, TRK-04, PRJ-D"
              value={newOptionCode}
              onChange={(e) => setNewOptionCode(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedCatForOption(null)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={catActionLoading || !newOptionName.trim()}
              className="text-xs h-8"
            >
              {catActionLoading ? 'Adding…' : 'Add Option'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
