import React, { useEffect, useState, useMemo } from 'react';
import {
  Package,
  Plus,
  Search,
  Tag,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Layers,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Eye,
  ShieldCheck,
  Archive,
} from 'lucide-react';
import {
  itemApi,
  accountsApi,
  type Item,
  type TaxTreatment,
  type AccountWithBalance,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { StatusTag, resolveStatusTone } from '@/components/ui/StatusTag';

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  TAX_EXCLUSIVE: 'Tax Exclusive (+10% GST)',
  TAX_INCLUSIVE: 'Tax Inclusive (Incl. GST)',
  GST_FREE: 'GST-Free (0%)',
};

const TAX_TREATMENT_BADGES: Record<TaxTreatment, string> = {
  TAX_EXCLUSIVE: '+GST',
  TAX_INCLUSIVE: 'Inc GST',
  GST_FREE: 'GST Free',
};

export function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [glAccounts, setGlAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SALES' | 'PURCHASE' | 'ARCHIVED'>('ALL');

  // Item Drawer state
  const [drawerItemId, setDrawerItemId] = useState<string | null>(null);

  // Create / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [modalFormError, setModalFormError] = useState<string | null>(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // Form Fields
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formIsSold, setFormIsSold] = useState(true);
  const [formSaleDescription, setFormSaleDescription] = useState('');
  const [formSaleUnitPriceDollars, setFormSaleUnitPriceDollars] = useState('0.00');
  const [formSaleTaxTreatment, setFormSaleTaxTreatment] = useState<TaxTreatment>('TAX_EXCLUSIVE');
  const [formIncomeAccountId, setFormIncomeAccountId] = useState('');
  const [formIsPurchased, setFormIsPurchased] = useState(true);
  const [formPurchaseDescription, setFormPurchaseDescription] = useState('');
  const [formPurchaseUnitPriceDollars, setFormPurchaseUnitPriceDollars] = useState('0.00');
  const [formPurchaseTaxTreatment, setFormPurchaseTaxTreatment] = useState<TaxTreatment>('TAX_EXCLUSIVE');
  const [formExpenseAccountId, setFormExpenseAccountId] = useState('');
  const [formIsTrackedInventory, setFormIsTrackedInventory] = useState(false);
  const [formIsActive, setFormIsActive] = useState(true);

  // Delete / Archive confirmation modal
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resItems, resAccounts] = await Promise.all([
        itemApi.list({ includeInactive: true }),
        accountsApi.list(),
      ]);
      setItems(resItems.items);
      setGlAccounts(resAccounts.accounts);
    } catch (err: any) {
      setError(err.message || 'Failed to load catalog items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  const revenueAccounts = useMemo(() => {
    return glAccounts.filter((a) => a.type === 'REVENUE' && a.isActive);
  }, [glAccounts]);

  const expenseAccounts = useMemo(() => {
    return glAccounts.filter((a) => a.type === 'EXPENSE' && a.isActive);
  }, [glAccounts]);

  const selectedDrawerItem = useMemo(() => {
    if (!drawerItemId) return null;
    return items.find((i) => i.id === drawerItemId) ?? null;
  }, [items, drawerItemId]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Type filter
      if (typeFilter === 'ARCHIVED') {
        if (item.isActive) return false;
      } else {
        if (!item.isActive) return false;
        if (typeFilter === 'SALES' && !item.isSold) return false;
        if (typeFilter === 'PURCHASE' && !item.isPurchased) return false;
      }

      // Search filter
      const q = search.trim().toLowerCase();
      if (!q) return true;

      return (
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.saleDescription && item.saleDescription.toLowerCase().includes(q)) ||
        (item.purchaseDescription && item.purchaseDescription.toLowerCase().includes(q))
      );
    });
  }, [items, typeFilter, search]);

  // KPI Metrics
  const metrics = useMemo(() => {
    const active = items.filter((i) => i.isActive);
    const total = active.length;
    const sales = active.filter((i) => i.isSold).length;
    const purchases = active.filter((i) => i.isPurchased).length;
    const tracked = active.filter((i) => i.isTrackedInventory).length;
    return { total, sales, purchases, tracked };
  }, [items]);

  // Modal Open Handlers
  const handleOpenCreate = () => {
    setEditingItem(null);
    setFormCode('');
    setFormName('');
    setFormIsSold(true);
    setFormSaleDescription('');
    setFormSaleUnitPriceDollars('0.00');
    setFormSaleTaxTreatment('TAX_EXCLUSIVE');
    setFormIncomeAccountId(revenueAccounts[0]?.id ?? '');
    setFormIsPurchased(true);
    setFormPurchaseDescription('');
    setFormPurchaseUnitPriceDollars('0.00');
    setFormPurchaseTaxTreatment('TAX_EXCLUSIVE');
    setFormExpenseAccountId(expenseAccounts[0]?.id ?? '');
    setFormIsTrackedInventory(false);
    setFormIsActive(true);
    setModalFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: Item) => {
    setEditingItem(item);
    setFormCode(item.code);
    setFormName(item.name);
    setFormIsSold(item.isSold);
    setFormSaleDescription(item.saleDescription ?? '');
    setFormSaleUnitPriceDollars((item.saleUnitPriceCents / 100).toFixed(2));
    setFormSaleTaxTreatment(item.saleTaxTreatment);
    setFormIncomeAccountId(item.incomeAccountId ?? '');
    setFormIsPurchased(item.isPurchased);
    setFormPurchaseDescription(item.purchaseDescription ?? '');
    setFormPurchaseUnitPriceDollars((item.purchaseUnitPriceCents / 100).toFixed(2));
    setFormPurchaseTaxTreatment(item.purchaseTaxTreatment);
    setFormExpenseAccountId(item.expenseAccountId ?? '');
    setFormIsTrackedInventory(item.isTrackedInventory);
    setFormIsActive(item.isActive);
    setModalFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmitModal = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalFormError(null);

    const saleCents = Math.round(parseFloat(formSaleUnitPriceDollars || '0') * 100);
    const purchaseCents = Math.round(parseFloat(formPurchaseUnitPriceDollars || '0') * 100);

    if (isNaN(saleCents) || saleCents < 0) {
      setModalFormError('Sale unit price must be a valid non-negative number.');
      return;
    }

    if (isNaN(purchaseCents) || purchaseCents < 0) {
      setModalFormError('Purchase unit price must be a valid non-negative number.');
      return;
    }

    setModalSubmitting(true);
    try {
      const payload = {
        code: formCode.trim().toUpperCase(),
        name: formName.trim(),
        isSold: formIsSold,
        saleDescription: formSaleDescription.trim() || null,
        saleUnitPriceCents: saleCents,
        saleTaxTreatment: formSaleTaxTreatment,
        incomeAccountId: formIsSold && formIncomeAccountId ? formIncomeAccountId : null,
        isPurchased: formIsPurchased,
        purchaseDescription: formPurchaseDescription.trim() || null,
        purchaseUnitPriceCents: purchaseCents,
        purchaseTaxTreatment: formPurchaseTaxTreatment,
        expenseAccountId: formIsPurchased && formExpenseAccountId ? formExpenseAccountId : null,
        isTrackedInventory: formIsTrackedInventory,
      };

      if (editingItem) {
        const res = await itemApi.update(editingItem.id, {
          ...payload,
          isActive: formIsActive,
        });
        setItems((prev) => prev.map((i) => (i.id === res.item.id ? res.item : i)));
      } else {
        const res = await itemApi.create(payload);
        setItems((prev) => [res.item, ...prev]);
      }

      setIsModalOpen(false);
    } catch (err: any) {
      setModalFormError(err.message || 'Failed to save catalog item.');
    } finally {
      setModalSubmitting(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete) return;
    setDeleteLoading(true);
    try {
      const res = await itemApi.delete(itemToDelete.id);
      await fetchItems();
      setItemToDelete(null);
      if (drawerItemId === itemToDelete.id) {
        setDrawerItemId(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete/archive item.');
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Products & Services Catalog
            </h1>
            <StatusTag label="Master Data" tone="forest" />
          </div>
          <p className="text-xs font-light text-slate-500 mt-1">
            Standardized items catalog with sales and purchase pricing, tax treatments, and pre-coded GL accounts.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="inline-flex items-center gap-1.5 h-8 text-xs font-medium">
          <Plus className="w-3.5 h-3.5" />
          <span>New Item</span>
        </Button>
      </div>

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded p-3.5 shadow-sm">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Active Catalog</p>
          <p className="text-xl font-semibold text-slate-900 font-mono tabular-nums mt-1">
            {metrics.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3.5 shadow-sm">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Sales Items</p>
          <p className="text-xl font-semibold text-forest-900 font-mono tabular-nums mt-1">
            {metrics.sales}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3.5 shadow-sm">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Purchase Items</p>
          <p className="text-xl font-semibold text-amber-700 font-mono tabular-nums mt-1">
            {metrics.purchases}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3.5 shadow-sm">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Tracked Inventory</p>
          <p className="text-xl font-semibold text-slate-700 font-mono tabular-nums mt-1">
            {metrics.tracked}
          </p>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="bg-white border border-slate-200 rounded p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by SKU code, item name, or description…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-forest-900 focus:border-forest-900 font-light"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 bg-slate-50 p-1 rounded border border-slate-200 self-start sm:self-auto text-xs font-medium text-slate-600">
          {(['ALL', 'SALES', 'PURCHASE', 'ARCHIVED'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 rounded transition-colors text-[11px] font-medium ${
                typeFilter === t
                  ? 'bg-white text-forest-950 shadow-xs border border-slate-200'
                  : 'hover:text-slate-900 text-slate-600'
              }`}
            >
              {t === 'ALL'
                ? 'All Active'
                : t === 'SALES'
                ? 'Sales Items'
                : t === 'PURCHASE'
                ? 'Purchases'
                : 'Archived'}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 flex items-center gap-2.5 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Items Table */}
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
            <p className="text-xs font-light text-slate-500">Loading catalog items…</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-500">
              <Package className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-800">No items found</p>
            <p className="text-xs font-light text-slate-400 mt-1 max-w-sm mx-auto">
              {search || typeFilter !== 'ALL'
                ? 'Try adjusting your search query or filter criteria.'
                : 'Create your first product or service item to enable fast line-item autocompletion in invoices and bills.'}
            </p>
            {!search && typeFilter === 'ALL' && (
              <Button onClick={handleOpenCreate} size="sm" className="mt-4 text-xs h-8">
                Create Catalog Item
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-4 font-mono">Code / SKU</th>
                  <th className="py-2.5 px-4">Item Name</th>
                  <th className="py-2.5 px-4">Sales Rate & Account</th>
                  <th className="py-2.5 px-4">Purchase Cost & Account</th>
                  <th className="py-2.5 px-4 text-center">Tracked</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setDrawerItemId(item.id)}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                  >
                    <td className="py-2.5 px-4 font-mono font-medium text-forest-900">
                      {item.code}
                    </td>
                    <td className="py-2.5 px-4">
                      <div>
                        <p className="font-medium text-slate-900">{item.name}</p>
                        {item.saleDescription && (
                          <p className="text-[11px] text-slate-400 font-light truncate max-w-xs">
                            {item.saleDescription}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      {item.isSold ? (
                        <div>
                          <div className="flex items-center gap-1.5 font-mono text-[11px]">
                            <span className="font-semibold text-slate-900">
                              {formatCents(item.saleUnitPriceCents)}
                            </span>
                            <span className="text-[10px] text-slate-400 font-sans">
                              ({TAX_TREATMENT_BADGES[item.saleTaxTreatment]})
                            </span>
                          </div>
                          {item.incomeAccount && (
                            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                              {item.incomeAccount.code} — {item.incomeAccount.name}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300 italic text-[11px]">Not sold</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {item.isPurchased ? (
                        <div>
                          <div className="flex items-center gap-1.5 font-mono text-[11px]">
                            <span className="font-semibold text-slate-900">
                              {formatCents(item.purchaseUnitPriceCents)}
                            </span>
                            <span className="text-[10px] text-slate-400 font-sans">
                              ({TAX_TREATMENT_BADGES[item.purchaseTaxTreatment]})
                            </span>
                          </div>
                          {item.expenseAccount && (
                            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                              {item.expenseAccount.code} — {item.expenseAccount.name}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300 italic text-[11px]">Not purchased</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      {item.isTrackedInventory ? (
                        <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono font-medium text-emerald-800 bg-emerald-50 rounded border border-emerald-200">
                          Tracked
                        </span>
                      ) : (
                        <span className="text-slate-300 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <StatusTag
                        label={item.isActive ? 'Active' : 'Archived'}
                        tone={item.isActive ? 'emerald' : 'slate'}
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div
                        className="inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDrawerItemId(item.id)}
                          className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900"
                          title="Inspect Item"
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(item)}
                          className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900"
                          title="Edit Item"
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setItemToDelete(item)}
                          className="h-7 w-7 p-0 text-slate-400 hover:text-red-700"
                          title="Delete or Archive Item"
                        >
                          <Trash2 className="w-3 h-3" />
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

      {/* Item Inspector Drawer */}
      <Drawer
        open={Boolean(drawerItemId)}
        onClose={() => setDrawerItemId(null)}
        title={selectedDrawerItem ? `${selectedDrawerItem.code} — ${selectedDrawerItem.name}` : 'Item Details'}
        width="lg"
      >
        {selectedDrawerItem && (
          <div className="space-y-6">
            <div className="bg-slate-50 border border-slate-200 rounded p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono text-xs font-semibold text-forest-900 bg-forest-50 px-1.5 py-0.5 rounded border border-forest-200">
                    {selectedDrawerItem.code}
                  </span>
                  <h3 className="text-base font-semibold text-slate-900 mt-1.5">
                    {selectedDrawerItem.name}
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    handleOpenEdit(selectedDrawerItem);
                  }}
                  className="h-7 text-xs px-2.5"
                >
                  <Edit2 className="w-3 h-3 mr-1" />
                  <span>Edit Item</span>
                </Button>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                <StatusTag
                  label={selectedDrawerItem.isActive ? 'Active Catalog Item' : 'Archived'}
                  tone={selectedDrawerItem.isActive ? 'emerald' : 'slate'}
                />
                {selectedDrawerItem.isTrackedInventory && (
                  <StatusTag label="Tracked Inventory" tone="forest" />
                )}
              </div>
            </div>

            {/* Sales Configuration */}
            <div className="border border-slate-200 rounded p-4 bg-white space-y-3">
              <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-forest-700" />
                <span>Sales Specifications (AR Quotes & Invoices)</span>
              </p>

              {selectedDrawerItem.isSold ? (
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-3 bg-slate-50 p-2.5 rounded border border-slate-100">
                    <div>
                      <span className="block text-[10px] text-slate-400 uppercase">Unit Selling Price</span>
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        {formatCents(selectedDrawerItem.saleUnitPriceCents)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400 uppercase">Tax Treatment</span>
                      <span className="font-medium text-slate-800">
                        {TAX_TREATMENT_LABELS[selectedDrawerItem.saleTaxTreatment]}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="block text-[10px] text-slate-400 uppercase mb-0.5">Sale Description</span>
                    <p className="text-slate-700 bg-slate-50/50 p-2 rounded border border-slate-100">
                      {selectedDrawerItem.saleDescription || '—'}
                    </p>
                  </div>

                  <div>
                    <span className="block text-[10px] text-slate-400 uppercase mb-0.5">Pre-Coded Revenue Account</span>
                    <p className="font-mono text-slate-800">
                      {selectedDrawerItem.incomeAccount
                        ? `${selectedDrawerItem.incomeAccount.code} — ${selectedDrawerItem.incomeAccount.name}`
                        : 'Default Revenue (4000 Sales Revenue)'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">This item is not configured for sales.</p>
              )}
            </div>

            {/* Purchase Configuration */}
            <div className="border border-slate-200 rounded p-4 bg-white space-y-3">
              <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-amber-700" />
                <span>Purchase Specifications (AP Purchase Orders & Bills)</span>
              </p>

              {selectedDrawerItem.isPurchased ? (
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-3 bg-slate-50 p-2.5 rounded border border-slate-100">
                    <div>
                      <span className="block text-[10px] text-slate-400 uppercase">Unit Purchase Cost</span>
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        {formatCents(selectedDrawerItem.purchaseUnitPriceCents)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400 uppercase">Tax Treatment</span>
                      <span className="font-medium text-slate-800">
                        {TAX_TREATMENT_LABELS[selectedDrawerItem.purchaseTaxTreatment]}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="block text-[10px] text-slate-400 uppercase mb-0.5">Purchase Description</span>
                    <p className="text-slate-700 bg-slate-50/50 p-2 rounded border border-slate-100">
                      {selectedDrawerItem.purchaseDescription || '—'}
                    </p>
                  </div>

                  <div>
                    <span className="block text-[10px] text-slate-400 uppercase mb-0.5">Pre-Coded Expense Account</span>
                    <p className="font-mono text-slate-800">
                      {selectedDrawerItem.expenseAccount
                        ? `${selectedDrawerItem.expenseAccount.code} — ${selectedDrawerItem.expenseAccount.name}`
                        : 'Default Expense (6000 Operating Expenses)'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">This item is not configured for purchasing.</p>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Create / Edit Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingItem ? `Edit Item: ${editingItem.code}` : 'New Products & Services Catalog Item'}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSubmitModal} className="space-y-4">
          {modalFormError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <p>{modalFormError}</p>
            </div>
          )}

          {/* Core Item Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Item Code / SKU <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. IT-CONSULT-HR"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                className="font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Item Display Name <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. Senior IT Consulting (Hourly)"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Section: I Sell This Item */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isSold"
                checked={formIsSold}
                onChange={(e) => setFormIsSold(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-forest-900 focus:ring-forest-900"
              />
              <label htmlFor="isSold" className="text-xs font-semibold text-slate-900 cursor-pointer">
                I Sell This Item (Customer Invoices & Quotes)
              </label>
            </div>

            {formIsSold && (
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Sale Unit Price (AUD)
                    </label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formSaleUnitPriceDollars}
                        onChange={(e) => setFormSaleUnitPriceDollars(e.target.value)}
                        className="pl-6 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Sale Tax Treatment
                    </label>
                    <select
                      value={formSaleTaxTreatment}
                      onChange={(e) => setFormSaleTaxTreatment(e.target.value as TaxTreatment)}
                      className="w-full text-xs rounded border border-slate-200 py-1.5 px-2 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                    >
                      <option value="TAX_EXCLUSIVE">Tax Exclusive (+10% GST)</option>
                      <option value="TAX_INCLUSIVE">Tax Inclusive (Incl. GST)</option>
                      <option value="GST_FREE">GST-Free (0%)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Income Account (Revenue)
                    </label>
                    <select
                      value={formIncomeAccountId}
                      onChange={(e) => setFormIncomeAccountId(e.target.value)}
                      className="w-full text-xs rounded border border-slate-200 py-1.5 px-2 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
                    >
                      <option value="">— Select Revenue Account —</option>
                      {revenueAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Default Sales Description
                  </label>
                  <Input
                    type="text"
                    placeholder="Appears automatically on customer invoices and quotes"
                    value={formSaleDescription}
                    onChange={(e) => setFormSaleDescription(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section: I Purchase This Item */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isPurchased"
                checked={formIsPurchased}
                onChange={(e) => setFormIsPurchased(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-forest-900 focus:ring-forest-900"
              />
              <label htmlFor="isPurchased" className="text-xs font-semibold text-slate-900 cursor-pointer">
                I Purchase This Item (Vendor Bills & Purchase Orders)
              </label>
            </div>

            {formIsPurchased && (
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Purchase Unit Cost (AUD)
                    </label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formPurchaseUnitPriceDollars}
                        onChange={(e) => setFormPurchaseUnitPriceDollars(e.target.value)}
                        className="pl-6 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Purchase Tax Treatment
                    </label>
                    <select
                      value={formPurchaseTaxTreatment}
                      onChange={(e) => setFormPurchaseTaxTreatment(e.target.value as TaxTreatment)}
                      className="w-full text-xs rounded border border-slate-200 py-1.5 px-2 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                    >
                      <option value="TAX_EXCLUSIVE">Tax Exclusive (+10% GST)</option>
                      <option value="TAX_INCLUSIVE">Tax Inclusive (Incl. GST)</option>
                      <option value="GST_FREE">GST-Free (0%)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Expense Account
                    </label>
                    <select
                      value={formExpenseAccountId}
                      onChange={(e) => setFormExpenseAccountId(e.target.value)}
                      className="w-full text-xs rounded border border-slate-200 py-1.5 px-2 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
                    >
                      <option value="">— Select Expense Account —</option>
                      {expenseAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Default Purchase Description
                  </label>
                  <Input
                    type="text"
                    placeholder="Appears automatically on vendor bills and purchase orders"
                    value={formPurchaseDescription}
                    onChange={(e) => setFormPurchaseDescription(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Reserved flag for Inventory Module */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
              <input
                type="checkbox"
                checked={formIsTrackedInventory}
                onChange={(e) => setFormIsTrackedInventory(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-forest-900 focus:ring-forest-900"
              />
              <span>Track physical inventory quantities (Module 8 Inventory Plug-In Hook)</span>
            </label>

            {editingItem && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-forest-900 focus:ring-forest-900"
                />
                <span>Active item</span>
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={modalSubmitting || !formCode.trim() || !formName.trim()}
              className="text-xs h-8"
            >
              {modalSubmitting ? 'Saving…' : editingItem ? 'Update Item' : 'Create Item'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete / Archive Confirmation Modal */}
      <Modal
        open={Boolean(itemToDelete)}
        onClose={() => setItemToDelete(null)}
        title="Confirm Delete or Archive"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            Are you sure you want to delete or archive item{' '}
            <span className="font-mono font-semibold text-slate-900">{itemToDelete?.code}</span>?
          </p>
          <p className="text-[11px] text-slate-400">
            If this item has been used in past invoices or bills, it will be safely archived (marked inactive)
            so historical financial records remain intact. If it has never been used, it will be deleted.
          </p>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setItemToDelete(null)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteItem}
              disabled={deleteLoading}
              className="text-xs h-8"
            >
              {deleteLoading ? 'Processing…' : 'Proceed'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
export default ItemsPage;

