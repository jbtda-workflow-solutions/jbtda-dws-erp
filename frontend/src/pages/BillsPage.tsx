import React, { useEffect, useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Building2,
  AlertCircle,
  Trash2,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  CreditCard,
  FileSpreadsheet,
  Download,
  Calendar,
  RotateCcw,
  Check,
  Send,
  ArrowRight,
  Receipt,
  FileCheck2,
} from 'lucide-react';
import {
  billApi,
  purchaseOrderApi,
  vendorCreditApi,
  batchPaymentApi,
  recurringBillApi,
  contactApi,
  accountApi,
  itemApi,
  type Bill,
  type PaymentOut,
  type BillStatus,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type VendorCredit,
  type BatchPayment,
  type RecurringScheduleModel,
  type Contact,
  type Account,
  type Item,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusTag } from '@/components/ui/StatusTag';

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

type APTab = 'BILLS' | 'PURCHASE_ORDERS' | 'VENDOR_CREDITS' | 'BATCH_PAYMENTS' | 'RECURRING';

export function BillsPage() {
  const [activeTab, setActiveTab] = useState<APTab>('BILLS');

  // Bills State
  const [bills, setBills] = useState<Bill[]>([]);
  const [loadingBills, setLoadingBills] = useState(true);
  const [billError, setBillError] = useState<string | null>(null);
  const [billSearch, setBillSearch] = useState('');
  const [billStatusFilter, setBillStatusFilter] = useState<'ALL' | BillStatus>('ALL');

  // Purchase Orders State
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loadingPOs, setLoadingPOs] = useState(false);
  const [poError, setPoError] = useState<string | null>(null);
  const [poSearch, setPoSearch] = useState('');
  const [poStatusFilter, setPoStatusFilter] = useState<'ALL' | PurchaseOrderStatus>('ALL');

  // Vendor Credits State
  const [vendorCredits, setVendorCredits] = useState<VendorCredit[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [creditSearch, setCreditSearch] = useState('');

  // Batch Payments State
  const [batchPayments, setBatchPayments] = useState<BatchPayment[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Recurring Bills State
  const [recurringBills, setRecurringBills] = useState<RecurringScheduleModel[]>([]);
  const [loadingRecurring, setLoadingRecurring] = useState(false);
  const [recurringError, setRecurringError] = useState<string | null>(null);

  // Modals
  const [isCreateBillOpen, setIsCreateBillOpen] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);

  const [isCreatePOOpen, setIsCreatePOOpen] = useState(false);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);

  const [isCreateCreditOpen, setIsCreateCreditOpen] = useState(false);
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null);
  const [allocatingCredit, setAllocatingCredit] = useState<VendorCredit | null>(null);

  const [isCreateBatchOpen, setIsCreateBatchOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const [isCreateRecurringOpen, setIsCreateRecurringOpen] = useState(false);

  // Fetch functions
  const fetchBills = async () => {
    setLoadingBills(true);
    setBillError(null);
    try {
      const res = await billApi.list();
      setBills(res.bills);
    } catch (err) {
      if (err instanceof ApiError) setBillError(err.message);
      else setBillError('Failed to load bills.');
    } finally {
      setLoadingBills(false);
    }
  };

  const fetchPOs = async () => {
    setLoadingPOs(true);
    setPoError(null);
    try {
      const res = await purchaseOrderApi.list();
      setPurchaseOrders(res.purchaseOrders);
    } catch (err) {
      if (err instanceof ApiError) setPoError(err.message);
      else setPoError('Failed to load purchase orders.');
    } finally {
      setLoadingPOs(false);
    }
  };

  const fetchCredits = async () => {
    setLoadingCredits(true);
    setCreditError(null);
    try {
      const res = await vendorCreditApi.list();
      setVendorCredits(res.credits);
    } catch (err) {
      if (err instanceof ApiError) setCreditError(err.message);
      else setCreditError('Failed to load vendor credits.');
    } finally {
      setLoadingCredits(false);
    }
  };

  const fetchBatches = async () => {
    setLoadingBatches(true);
    setBatchError(null);
    try {
      const res = await batchPaymentApi.list();
      setBatchPayments(res.batchPayments);
    } catch (err) {
      if (err instanceof ApiError) setBatchError(err.message);
      else setBatchError('Failed to load batch payments.');
    } finally {
      setLoadingBatches(false);
    }
  };

  const fetchRecurring = async () => {
    setLoadingRecurring(true);
    setRecurringError(null);
    try {
      const res = await recurringBillApi.list();
      setRecurringBills(res.recurringBills);
    } catch (err) {
      if (err instanceof ApiError) setRecurringError(err.message);
      else setRecurringError('Failed to load recurring bills.');
    } finally {
      setLoadingRecurring(false);
    }
  };

  useEffect(() => {
    void fetchBills();
  }, []);

  useEffect(() => {
    if (activeTab === 'PURCHASE_ORDERS') void fetchPOs();
    else if (activeTab === 'VENDOR_CREDITS') void fetchCredits();
    else if (activeTab === 'BATCH_PAYMENTS') void fetchBatches();
    else if (activeTab === 'RECURRING') void fetchRecurring();
  }, [activeTab]);

  // Filters
  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      const matchesStatus =
        billStatusFilter === 'ALL' || b.status === billStatusFilter;
      const q = billSearch.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        (b.reference && b.reference.toLowerCase().includes(q)) ||
        (b.contact && b.contact.name.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [bills, billStatusFilter, billSearch]);

  const filteredPOs = useMemo(() => {
    return purchaseOrders.filter((po) => {
      const matchesStatus =
        poStatusFilter === 'ALL' || po.status === poStatusFilter;
      const q = poSearch.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        po.poNumber.toLowerCase().includes(q) ||
        (po.contact && po.contact.name.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [purchaseOrders, poStatusFilter, poSearch]);

  const filteredCredits = useMemo(() => {
    return vendorCredits.filter((vc) => {
      const q = creditSearch.trim().toLowerCase();
      return (
        q === '' ||
        vc.creditNumber.toLowerCase().includes(q) ||
        (vc.contact && vc.contact.name.toLowerCase().includes(q))
      );
    });
  }, [vendorCredits, creditSearch]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-slate-900">
            Accounts Payable
          </h1>
          <p className="text-sm font-light text-slate-500 mt-1">
            Complete procurement lifecycle: Purchase Orders, Vendor Bills, Vendor Credits, Recurring Schedules, and Australian .ABA Batch Bank Exports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'BILLS' && (
            <Button
              onClick={() => setIsCreateBillOpen(true)}
              className="inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>New Bill</span>
            </Button>
          )}
          {activeTab === 'PURCHASE_ORDERS' && (
            <Button
              onClick={() => setIsCreatePOOpen(true)}
              className="inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>New Purchase Order</span>
            </Button>
          )}
          {activeTab === 'VENDOR_CREDITS' && (
            <Button
              onClick={() => setIsCreateCreditOpen(true)}
              className="inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>New Vendor Credit</span>
            </Button>
          )}
          {activeTab === 'BATCH_PAYMENTS' && (
            <Button
              onClick={() => setIsCreateBatchOpen(true)}
              className="inline-flex items-center gap-2"
            >
              <CreditCard className="w-4 h-4" />
              <span>New .ABA Batch Run</span>
            </Button>
          )}
          {activeTab === 'RECURRING' && (
            <Button
              onClick={() => setIsCreateRecurringOpen(true)}
              className="inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>New Recurring Bill</span>
            </Button>
          )}
        </div>
      </div>

      {/* AP Navigation Tabs */}
      <div className="flex items-center border-b border-slate-200 gap-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('BILLS')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'BILLS'
              ? 'border-forest-900 text-forest-950 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Vendor Bills</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
            {bills.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('PURCHASE_ORDERS')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'PURCHASE_ORDERS'
              ? 'border-forest-900 text-forest-950 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          <span>Purchase Orders</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
            {purchaseOrders.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('VENDOR_CREDITS')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'VENDOR_CREDITS'
              ? 'border-forest-900 text-forest-950 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Vendor Credits</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
            {vendorCredits.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('BATCH_PAYMENTS')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'BATCH_PAYMENTS'
              ? 'border-forest-900 text-forest-950 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Download className="w-4 h-4" />
          <span>.ABA Batch Payments</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
            {batchPayments.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('RECURRING')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'RECURRING'
              ? 'border-forest-900 text-forest-950 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Recurring Bills</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
            {recurringBills.length}
          </span>
        </button>
      </div>

      {/* TAB 1: VENDOR BILLS */}
      {activeTab === 'BILLS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={billSearch}
                onChange={(e) => setBillSearch(e.target.value)}
                placeholder="Search by vendor name or reference…"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-forest-900 font-light"
              />
            </div>

            <div className="flex items-center bg-slate-100 p-1 rounded-lg text-xs font-medium text-slate-600">
              {(['ALL', 'DRAFT', 'AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID'] as const).map(
                (st) => (
                  <button
                    key={st}
                    onClick={() => setBillStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      billStatusFilter === st
                        ? 'bg-white text-forest-900 shadow-xs font-medium'
                        : 'hover:text-slate-900'
                    }`}
                  >
                    {st.replace('_', ' ')}
                  </button>
                ),
              )}
            </div>
          </div>

          {billError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{billError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingBills ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
                <p className="text-xs">Loading bills…</p>
              </div>
            ) : filteredBills.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <FileSpreadsheet className="w-12 h-12 text-slate-300 mb-3" />
                <p className="text-sm font-medium text-slate-800">No vendor bills found</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Record vendor bills to track accounts payable and automatically post expense entries.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Vendor</th>
                      <th className="py-3 px-4">Reference</th>
                      <th className="py-3 px-4">Issue Date</th>
                      <th className="py-3 px-4">Due Date</th>
                      <th className="py-3 px-4 text-right">Subtotal</th>
                      <th className="py-3 px-4 text-right">GST</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Paid</th>
                      <th className="py-3 px-4 text-right">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBills.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{b.contact?.name ?? 'Unknown Vendor'}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">{b.reference ?? '—'}</td>
                        <td className="py-3 px-4 text-slate-600">{formatDate(b.issueDate)}</td>
                        <td className="py-3 px-4 text-slate-600">{formatDate(b.dueDate)}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {formatCents(b.subtotalCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {formatCents(b.gstCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                          {formatCents(b.totalCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-700">
                          {formatCents(b.amountPaidCents)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <BillStatusBadge status={b.status} />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedBillId(b.id)}
                            className="inline-flex items-center gap-1.5 text-xs py-1 h-7"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
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

      {/* TAB 2: PURCHASE ORDERS */}
      {activeTab === 'PURCHASE_ORDERS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search PO # or vendor…"
                value={poSearch}
                onChange={(e) => setPoSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-forest-900"
              />
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              {(['ALL', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'BILLED', 'REJECTED'] as const).map(
                (st) => (
                  <button
                    key={st}
                    onClick={() => setPoStatusFilter(st)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      poStatusFilter === st
                        ? 'bg-forest-900 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {st.replace('_', ' ')}
                  </button>
                ),
              )}
            </div>
          </div>

          {poError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{poError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingPOs ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
                <p className="text-xs">Loading purchase orders…</p>
              </div>
            ) : filteredPOs.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <FileCheck2 className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-800">No purchase orders found</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Create purchase orders to authorize supplier procurement and convert to bills upon approval.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">PO #</th>
                      <th className="py-3 px-4">Vendor</th>
                      <th className="py-3 px-4">Order Date</th>
                      <th className="py-3 px-4 text-right">Subtotal</th>
                      <th className="py-3 px-4 text-right">GST</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPOs.map((po) => (
                      <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-slate-900">{po.poNumber}</td>
                        <td className="py-3 px-4 text-slate-800 font-medium">{po.contact?.name ?? '—'}</td>
                        <td className="py-3 px-4 text-slate-600">{formatDate(po.orderDate)}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {formatCents(po.subtotalCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {formatCents(po.taxCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                          {formatCents(po.totalCents)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <StatusTag
                            variant={
                              po.status === 'APPROVED' || po.status === 'BILLED'
                                ? 'emerald'
                                : po.status === 'PENDING_APPROVAL'
                                ? 'amber'
                                : po.status === 'REJECTED'
                                ? 'rose'
                                : 'slate'
                            }
                          >
                            {po.status}
                          </StatusTag>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedPOId(po.id)}
                            className="inline-flex items-center gap-1.5 text-xs py-1 h-7"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
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

      {/* TAB 3: VENDOR CREDITS */}
      {activeTab === 'VENDOR_CREDITS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search vendor credits…"
                value={creditSearch}
                onChange={(e) => setCreditSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-forest-900"
              />
            </div>
          </div>

          {creditError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{creditError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingCredits ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
                <p className="text-xs">Loading vendor credits…</p>
              </div>
            ) : filteredCredits.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <RotateCcw className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-800">No vendor credits found</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Record supplier credit notes and allocate them to offset open vendor bills.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Credit #</th>
                      <th className="py-3 px-4">Vendor</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Remaining</th>
                      <th className="py-3 px-4 text-right">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCredits.map((vc) => (
                      <tr key={vc.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-slate-900">{vc.creditNumber}</td>
                        <td className="py-3 px-4 text-slate-800 font-medium">{vc.contact?.name ?? '—'}</td>
                        <td className="py-3 px-4 text-slate-600">{formatDate(vc.creditDate)}</td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                          {formatCents(vc.totalCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-forest-900">
                          {formatCents(vc.remainingCents)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <StatusTag
                            variant={
                              vc.status === 'APPLIED'
                                ? 'emerald'
                                : vc.status === 'OPEN' || vc.status === 'PARTIALLY_APPLIED'
                                ? 'amber'
                                : 'slate'
                            }
                          >
                            {vc.status}
                          </StatusTag>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {vc.status === 'OPEN' && vc.remainingCents > 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setAllocatingCredit(vc)}
                                className="inline-flex items-center gap-1 text-xs py-1 h-7 text-forest-800 border-forest-200 hover:bg-forest-50"
                              >
                                <ArrowRight className="w-3.5 h-3.5 text-forest-700" />
                                <span>Allocate</span>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedCreditId(vc.id)}
                              className="inline-flex items-center gap-1.5 text-xs py-1 h-7"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View</span>
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

      {/* TAB 4: BATCH PAYMENTS (.ABA FILE EXPORT) */}
      {activeTab === 'BATCH_PAYMENTS' && (
        <div className="space-y-4">
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
            <Download className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-950">
              <p className="font-medium">Australian APCA-Compliant .ABA Bank File Engine</p>
              <p className="mt-0.5 text-emerald-800 font-light">
                Group multiple unpaid vendor bills into an atomic batch payment run. Exports a certified 120-character CEMTEX .ABA file formatted for direct upload into ANZ Transactive, CommBiz, NAB Connect, and Westpac Online.
              </p>
            </div>
          </div>

          {batchError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{batchError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingBatches ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
                <p className="text-xs">Loading batch payment runs…</p>
              </div>
            ) : batchPayments.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <Download className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-800">No batch payment runs recorded</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Click &ldquo;New .ABA Batch Run&rdquo; to select approved vendor bills and generate an APCA file.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Batch #</th>
                      <th className="py-3 px-4">Execution Date</th>
                      <th className="py-3 px-4 text-right">Total Disbursed</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {batchPayments.map((batch) => (
                      <tr key={batch.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900">{batch.batchNumber}</td>
                        <td className="py-3 px-4 font-sans text-slate-600">{formatDate(batch.paymentDate)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-900">
                          {formatCents(batch.totalAmountCents)}
                        </td>
                        <td className="py-3 px-4 text-center font-sans">
                          <StatusTag variant="emerald">{batch.status}</StatusTag>
                        </td>
                        <td className="py-3 px-4 text-right font-sans">
                          <div className="flex items-center justify-end gap-2">
                            <a
                              href={batchPaymentApi.downloadAbaUrl(batch.id)}
                              download={`ABA-${batch.batchNumber}.aba`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download .ABA</span>
                            </a>
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

      {/* TAB 5: RECURRING BILLS */}
      {activeTab === 'RECURRING' && (
        <div className="space-y-4">
          {recurringError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{recurringError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingRecurring ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
                <p className="text-xs">Loading recurring bill schedules…</p>
              </div>
            ) : recurringBills.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <Calendar className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-800">No recurring bill schedules</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Schedule recurring supplier obligations (rent, cloud leases, retainers) with automated bill drafting.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Schedule Name</th>
                      <th className="py-3 px-4">Vendor</th>
                      <th className="py-3 px-4">Frequency</th>
                      <th className="py-3 px-4">Next Due Date</th>
                      <th className="py-3 px-4 text-center">Auto-Approve</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recurringBills.map((sched) => (
                      <tr key={sched.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900">{sched.name}</td>
                        <td className="py-3 px-4 text-slate-700">{sched.contact?.name ?? '—'}</td>
                        <td className="py-3 px-4">
                          <StatusTag variant="slate">{sched.frequency}</StatusTag>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">{formatDate(sched.nextRunDate)}</td>
                        <td className="py-3 px-4 text-center">
                          {sched.autoPost ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                              <Check className="w-3.5 h-3.5 text-emerald-600" /> Yes
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">Draft Only</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                await recurringBillApi.run(sched.id);
                                void fetchBills();
                                void fetchRecurring();
                                alert(`Successfully generated bill for ${sched.name}`);
                              } catch (err: any) {
                                alert(err.message || 'Failed to trigger schedule');
                              }
                            }}
                            className="inline-flex items-center gap-1.5 text-xs py-1 h-7 text-forest-900 border-forest-200 hover:bg-forest-50"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Run Now</span>
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

      {/* Bill Modals */}
      {isCreateBillOpen && (
        <CreateBillModal
          open={isCreateBillOpen}
          onClose={() => setIsCreateBillOpen(false)}
          onCreated={(newBill) => {
            setBills((prev) => [newBill, ...prev]);
            setIsCreateBillOpen(false);
          }}
        />
      )}

      {selectedBillId && (
        <BillDetailModal
          billId={selectedBillId}
          onClose={() => setSelectedBillId(null)}
          onBillUpdated={(upd) => {
            setBills((prev) => prev.map((b) => (b.id === upd.id ? upd : b)));
          }}
        />
      )}

      {/* PO Modals */}
      {isCreatePOOpen && (
        <CreatePOModal
          open={isCreatePOOpen}
          onClose={() => setIsCreatePOOpen(false)}
          onCreated={(newPO) => {
            setPurchaseOrders((prev) => [newPO, ...prev]);
            setIsCreatePOOpen(false);
          }}
        />
      )}

      {selectedPOId && (
        <PODetailModal
          poId={selectedPOId}
          onClose={() => setSelectedPOId(null)}
          onPOUpdated={(upd) => {
            setPurchaseOrders((prev) => prev.map((p) => (p.id === upd.id ? upd : p)));
          }}
          onConvertedToBill={() => {
            setSelectedPOId(null);
            void fetchPOs();
            void fetchBills();
            setActiveTab('BILLS');
          }}
        />
      )}

      {/* Vendor Credit Modals */}
      {isCreateCreditOpen && (
        <CreateVendorCreditModal
          open={isCreateCreditOpen}
          onClose={() => setIsCreateCreditOpen(false)}
          onCreated={(newVc) => {
            setVendorCredits((prev) => [newVc, ...prev]);
            setIsCreateCreditOpen(false);
          }}
        />
      )}

      {selectedCreditId && (
        <VendorCreditDetailModal
          creditId={selectedCreditId}
          onClose={() => setSelectedCreditId(null)}
          onCreditUpdated={(upd) => {
            setVendorCredits((prev) => prev.map((c) => (c.id === upd.id ? upd : c)));
          }}
          onAllocate={(c) => {
            setSelectedCreditId(null);
            setAllocatingCredit(c);
          }}
        />
      )}

      {allocatingCredit && (
        <AllocateVendorCreditModal
          open={Boolean(allocatingCredit)}
          credit={allocatingCredit}
          onClose={() => setAllocatingCredit(null)}
          onAllocated={() => {
            setAllocatingCredit(null);
            void fetchCredits();
            void fetchBills();
          }}
        />
      )}

      {/* Batch Payment Modal */}
      {isCreateBatchOpen && (
        <CreateBatchPaymentModal
          open={isCreateBatchOpen}
          onClose={() => setIsCreateBatchOpen(false)}
          onCreated={() => {
            setIsCreateBatchOpen(false);
            void fetchBatches();
            void fetchBills();
          }}
        />
      )}

      {/* Recurring Schedule Modal */}
      {isCreateRecurringOpen && (
        <CreateRecurringBillModal
          open={isCreateRecurringOpen}
          onClose={() => setIsCreateRecurringOpen(false)}
          onCreated={() => {
            setIsCreateRecurringOpen(false);
            void fetchRecurring();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function BillStatusBadge({ status }: { status: BillStatus }) {
  switch (status) {
    case 'DRAFT':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full">
          <span>Draft</span>
        </span>
      );
    case 'PENDING_APPROVAL':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
          <span>Pending Approval</span>
        </span>
      );
    case 'AWAITING_PAYMENT':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
          <Clock className="w-3 h-3 text-amber-600" />
          <span>Awaiting Payment</span>
        </span>
      );
    case 'PARTIALLY_PAID':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-cyan-800 bg-cyan-50 border border-cyan-200 px-2.5 py-0.5 rounded-full">
          <Clock className="w-3 h-3 text-cyan-600" />
          <span>Partially Paid</span>
        </span>
      );
    case 'PAID':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>Paid</span>
        </span>
      );
    case 'VOID':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full line-through">
          <span>Void</span>
        </span>
      );
    default:
      return null;
  }
}

function CreateBillModal({ open, onClose, onCreated }: CreateBillModalProps) {
  const [vendors, setVendors] = useState<Contact[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(true);

  // Form fields
  const [contactId, setContactId] = useState('');
  const [reference, setReference] = useState('');
  const [issueDate, setIssueDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState('');

  const [lineItems, setLineItems] = useState<LineItemDraft[]>([
    {
      id: '1',
      description: 'Consulting services',
      amount: '100.00',
      taxTreatment: 'TAX_EXCLUSIVE',
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch vendors on load
  useEffect(() => {
    async function loadVendors() {
      try {
        const res = await contactApi.list();
        const vendorList = res.contacts.filter(
          (c) => c.type === 'VENDOR' || c.type === 'BOTH',
        );
        setVendors(vendorList);
        if (vendorList.length > 0) {
          setContactId(vendorList[0]!.id);
          // Set due date based on contact paymentTermsDays
          const days = vendorList[0]!.paymentTermsDays || 30;
          const d = new Date();
          d.setDate(d.getDate() + days);
          setDueDate(d.toISOString().slice(0, 10));
        }
      } catch {
        setError('Failed to load vendors.');
      } finally {
        setLoadingVendors(false);
      }
    }
    void loadVendors();
  }, []);

  const handleVendorChange = (id: string) => {
    setContactId(id);
    const selected = vendors.find((v) => v.id === id);
    if (selected) {
      const days = selected.paymentTermsDays || 30;
      const d = new Date(issueDate || Date.now());
      d.setDate(d.getDate() + days);
      setDueDate(d.toISOString().slice(0, 10));
    }
  };

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        description: '',
        amount: '',
        taxTreatment: 'TAX_EXCLUSIVE',
      },
    ]);
  };

  const removeLineItem = (id: string) => {
    if (lineItems.length === 1) return;
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateLineItem = (
    id: string,
    field: keyof LineItemDraft,
    val: string,
  ) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: val } : item)),
    );
  };

  // Preview computations
  const previewTotals = useMemo(() => {
    let subtotalCents = 0;
    let gstCents = 0;

    for (const item of lineItems) {
      const val = parseFloat(item.amount) || 0;
      const cents = Math.round(val * 100);
      if (cents <= 0) continue;

      if (item.taxTreatment === 'TAX_EXCLUSIVE') {
        const sub = cents;
        const gst = Math.round(sub * 0.1);
        subtotalCents += sub;
        gstCents += gst;
      } else if (item.taxTreatment === 'TAX_INCLUSIVE') {
        const total = cents;
        const gst = Math.round(total - total / 1.1);
        const sub = total - gst;
        subtotalCents += sub;
        gstCents += gst;
      } else {
        // GST_FREE
        subtotalCents += cents;
      }
    }

    const totalCents = subtotalCents + gstCents;
    return { subtotalCents, gstCents, totalCents };
  }, [lineItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId) {
      setError('Please select a vendor.');
      return;
    }

    const payloadLineItems = [];
    for (const item of lineItems) {
      if (!item.description.trim()) {
        setError('Line item description cannot be empty.');
        return;
      }
      const dollars = parseFloat(item.amount);
      if (isNaN(dollars) || dollars <= 0) {
        setError('Line item amount must be a positive number.');
        return;
      }
      payloadLineItems.push({
        description: item.description.trim(),
        amountCents: Math.round(dollars * 100),
        taxTreatment: item.taxTreatment,
      });
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await billApi.create({
        contactId,
        reference: reference.trim() || null,
        issueDate,
        dueDate,
        notes: notes.trim() || null,
        lineItems: payloadLineItems,
      });
      onCreated(res.bill);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to record bill. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record New Bill"
      description="Create a vendor bill with line items and automatic double-entry ledger posting."
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5 mt-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700">
              Vendor Contact
            </label>
            {loadingVendors ? (
              <div className="h-10 rounded-lg border border-slate-200 bg-slate-50 flex items-center px-3 text-xs text-slate-400">
                Loading vendors…
              </div>
            ) : vendors.length === 0 ? (
              <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                No vendors found. Please create a vendor in Contacts first.
              </div>
            ) : (
              <select
                value={contactId}
                onChange={(e) => handleVendorChange(e.target.value)}
                className="w-full h-10 px-3 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-forest-900"
                required
              >
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} {v.abn ? `(ABN: ${v.abn})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <Input
            label="Vendor Reference / Invoice #"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="INV-98214"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Issue Date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
          />
          <Input
            label="Due Date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </div>

        {/* Dynamic Line Items Table */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-800">Line Items</span>
            <button
              type="button"
              onClick={addLineItem}
              className="text-xs font-medium text-forest-700 hover:text-forest-900 inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Line</span>
            </button>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {lineItems.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-center gap-2 bg-slate-50/75 p-2 rounded-lg border border-slate-200/60"
              >
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) =>
                      updateLineItem(item.id, 'description', e.target.value)
                    }
                    placeholder={`Description ${idx + 1}`}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                    required
                  />
                </div>

                <div className="w-28">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={item.amount}
                    onChange={(e) =>
                      updateLineItem(item.id, 'amount', e.target.value)
                    }
                    placeholder="0.00"
                    className="w-full px-2.5 py-1.5 text-xs text-right font-mono rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                    required
                  />
                </div>

                <div className="w-36">
                  <select
                    value={item.taxTreatment}
                    onChange={(e) =>
                      updateLineItem(
                        item.id,
                        'taxTreatment',
                        e.target.value as TaxTreatment,
                      )
                    }
                    className="w-full py-1.5 px-2 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                  >
                    <option value="TAX_EXCLUSIVE">Tax Exclusive (10%)</option>
                    <option value="TAX_INCLUSIVE">Tax Inclusive (10%)</option>
                    <option value="GST_FREE">GST Free (0%)</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => removeLineItem(item.id)}
                  disabled={lineItems.length === 1}
                  className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-slate-400"
                  title="Remove item"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Real-time Subtotal, GST, Total Breakdown */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 space-y-1 text-xs">
            <div className="flex justify-between text-slate-500">
              <span>Subtotal (excl. GST):</span>
              <span className="font-mono">{formatCents(previewTotals.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>GST (10%):</span>
              <span className="font-mono">{formatCents(previewTotals.gstCents)}</span>
            </div>
            <div className="flex justify-between text-slate-900 font-medium text-sm pt-1.5 border-t border-slate-200">
              <span>Total Payable:</span>
              <span className="font-mono text-forest-950 font-bold">
                {formatCents(previewTotals.totalCents)}
              </span>
            </div>
          </div>
        </div>

        <Input
          label="Notes (Optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Payment instructions or internal notes"
        />

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || vendors.length === 0}
          >
            {submitting ? 'Recording…' : 'Record Bill & Post to Ledger'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bill Detail Modal
// ---------------------------------------------------------------------------

interface BillDetailModalProps {
  billId: string;
  onClose: () => void;
  onBillUpdated?: (bill: Bill) => void;
}

function BillDetailModal({ billId, onClose, onBillUpdated }: BillDetailModalProps) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [journalEntry, setJournalEntry] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await billApi.get(billId);
        setBill(res.bill);
        setJournalEntry(res.journalEntry);
      } catch (err) {
        if (err instanceof ApiError) setError(err.message);
        else setError('Failed to load bill details.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [billId]);

  const handlePaymentSuccess = (updatedBill: Bill) => {
    setBill(updatedBill);
    if (onBillUpdated) onBillUpdated(updatedBill);
    setIsPayModalOpen(false);
  };

  const balanceDue = bill ? bill.totalCents - bill.amountPaidCents : 0;
  const canPay = bill && (bill.status === 'AWAITING_PAYMENT' || bill.status === 'PARTIALLY_PAID') && balanceDue > 0;

  return (
    <>
      <Modal
        open={Boolean(billId)}
        onClose={onClose}
        title="Bill Details & General Ledger Posting"
        description="View vendor bill information, payment history, and double-entry transaction record."
        maxWidth="max-w-2xl"
      >
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
            <p className="text-xs text-slate-500">Loading details…</p>
          </div>
        ) : error || !bill ? (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 text-xs">
            {error ?? 'Bill not found'}
          </div>
        ) : (
          <div className="space-y-5 mt-4 text-xs">
            {/* Header Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
              <div>
                <p className="text-slate-400">Vendor</p>
                <p className="font-medium text-slate-900 mt-0.5">{bill.contact?.name}</p>
              </div>
              <div>
                <p className="text-slate-400">Reference</p>
                <p className="font-mono text-slate-900 mt-0.5">{bill.reference ?? '—'}</p>
              </div>
              <div>
                <p className="text-slate-400">Issue Date</p>
                <p className="text-slate-900 mt-0.5">{formatDate(bill.issueDate)}</p>
              </div>
              <div>
                <p className="text-slate-400">Due Date</p>
                <p className="text-slate-900 mt-0.5">{formatDate(bill.dueDate)}</p>
              </div>
            </div>

            {/* Financial Balance Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
              <div>
                <p className="text-slate-400">Total Payable</p>
                <p className="font-mono font-medium text-slate-900 mt-0.5">{formatCents(bill.totalCents)}</p>
              </div>
              <div>
                <p className="text-slate-400">Amount Paid</p>
                <p className="font-mono font-medium text-emerald-700 mt-0.5">{formatCents(bill.amountPaidCents)}</p>
              </div>
              <div>
                <p className="text-slate-400">Balance Due</p>
                <p className="font-mono font-bold text-forest-950 mt-0.5">{formatCents(balanceDue)}</p>
              </div>
              <div>
                <p className="text-slate-400">Status</p>
                <div className="mt-0.5"><BillStatusBadge status={bill.status} /></div>
              </div>
            </div>

            {/* Line items list */}
            <div className="space-y-2">
              <p className="font-medium text-slate-900">Line Items</p>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3">Tax Treatment</th>
                      <th className="py-2.5 px-3 text-right">Subtotal</th>
                      <th className="py-2.5 px-3 text-right">GST</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bill.lineItems?.map((li) => (
                      <tr key={li.id}>
                        <td className="py-2 px-3 text-slate-800">{li.description}</td>
                        <td className="py-2 px-3 text-slate-500">
                          {li.taxTreatment.replace('_', ' ')}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {formatCents(li.amountCents)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {formatCents(li.gstCents)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-900 font-medium">
                          {formatCents(li.totalCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payments Out History */}
            {bill.paymentsOut && bill.paymentsOut.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5 font-medium text-slate-900">
                  <CreditCard className="w-3.5 h-3.5 text-forest-700" />
                  <span>Payments Recorded ({bill.paymentsOut.length})</span>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Payment Date</th>
                        <th className="py-2 px-3">Bank Reference</th>
                        <th className="py-2 px-3 text-right">Amount Paid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {bill.paymentsOut.map((p: PaymentOut) => (
                        <tr key={p.id}>
                          <td className="py-2 px-3 text-slate-800 font-sans">{formatDate(p.paymentDate)}</td>
                          <td className="py-2 px-3 text-slate-600">{p.reference ?? '—'}</td>
                          <td className="py-2 px-3 text-right text-emerald-700 font-medium">
                            {formatCents(p.amountCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Double-Entry GL record */}
            {journalEntry && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5 font-medium text-slate-900">
                  <FileText className="w-3.5 h-3.5 text-forest-700" />
                  <span>Double-Entry Journal Entry ({journalEntry.referenceType})</span>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Account</th>
                        <th className="py-2 px-3 text-right">Debit</th>
                        <th className="py-2 px-3 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {journalEntry.lines?.map((line: any) => (
                        <tr key={line.id}>
                          <td className="py-2 px-3 font-sans text-slate-800">
                            {line.account?.code} - {line.account?.name}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700">
                            {line.entryType === 'DEBIT'
                              ? formatCents(line.amountCents)
                              : '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700">
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
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {canPay && (
                <Button
                  onClick={() => setIsPayModalOpen(true)}
                  className="inline-flex items-center gap-1.5"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Record Payment</span>
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Payment Modal */}
      {isPayModalOpen && bill && (
        <RecordPaymentModal
          open={isPayModalOpen}
          bill={bill}
          onClose={() => setIsPayModalOpen(false)}
          onPaymentRecorded={handlePaymentSuccess}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Record Payment Modal (Phase 5)
// ---------------------------------------------------------------------------

interface RecordPaymentModalProps {
  open: boolean;
  bill: Bill;
  onClose: () => void;
  onPaymentRecorded: (updatedBill: Bill) => void;
}

function RecordPaymentModal({
  open,
  bill,
  onClose,
  onPaymentRecorded,
}: RecordPaymentModalProps) {
  const remainingCents = bill.totalCents - bill.amountPaidCents;
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState((remainingCents / 100).toFixed(2));
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmountCents = Math.round((parseFloat(amount) || 0) * 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (parsedAmountCents <= 0) {
      setError('Payment amount must be greater than $0.00.');
      return;
    }

    if (parsedAmountCents > remainingCents) {
      setError(
        `Payment amount cannot exceed the balance due (${formatCents(remainingCents)}).`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await billApi.recordPayment(bill.id, {
        paymentDate,
        amountCents: parsedAmountCents,
        reference: reference.trim() || null,
      });
      onPaymentRecorded(res.bill);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to record payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record Payment Out"
      description={`Record an outgoing payment to ${bill.contact?.name} for bill ${bill.reference ?? bill.id.slice(0, 8)}.`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 mt-3">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex items-center justify-between text-xs">
          <span className="text-slate-500">Remaining Balance:</span>
          <span className="font-mono font-bold text-forest-950">
            {formatCents(remainingCents)}
          </span>
        </div>

        <Input
          label="Payment Date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          required
        />

        <Input
          label="Amount Paid ($ AUD)"
          type="number"
          step="0.01"
          min="0.01"
          max={(remainingCents / 100).toFixed(2)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />

        <Input
          label="Bank Transaction Reference (Optional)"
          placeholder="e.g. EFT-10941, Direct Debit"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Recording…' : 'Record Payment & Post GL'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}



// ---------------------------------------------------------------------------
// Create Purchase Order Modal (Module 5.1)
// ---------------------------------------------------------------------------

interface CreatePOModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (po: PurchaseOrder) => void;
}

function CreatePOModal({ open, onClose, onCreated }: CreatePOModalProps) {
  const [vendors, setVendors] = useState<Contact[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);

  const [contactId, setContactId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [reference, setReference] = useState('');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');

  const [lines, setLines] = useState<Array<{
    id: string;
    itemId?: string;
    description: string;
    quantity: number;
    unitPrice: string;
    taxRatePercent: number;
    accountId?: string;
  }>>([
    {
      id: '1',
      description: 'Equipment Procurement',
      quantity: 1,
      unitPrice: '250.00',
      taxRatePercent: 10,
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [cRes, iRes, aRes] = await Promise.all([
          contactApi.list(),
          itemApi.list(),
          accountApi.list(),
        ]);
        const vList = cRes.contacts.filter((c) => c.type === 'SUPPLIER' || c.type === 'BOTH');
        setVendors(vList);
        if (vList.length > 0) setContactId(vList[0].id);

        setItems(iRes.items.filter((it) => it.isActive && it.isPurchased));
        setExpenseAccounts(aRes.accounts.filter((a) => (a.type === 'EXPENSE' || a.type === 'ASSET') && a.isActive));
      } catch {
        setError('Failed to load initial data.');
      }
    }
    void load();
  }, []);

  const handleItemSelect = (index: number, itemId: string) => {
    const found = items.find((i) => i.id === itemId);
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        return {
          ...l,
          itemId,
          description: found ? (found.description || found.name) : l.description,
          unitPrice: found ? (found.purchasePriceCents / 100).toFixed(2) : l.unitPrice,
          accountId: found?.purchaseAccountId || l.accountId,
        };
      }),
    );
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        description: '',
        quantity: 1,
        unitPrice: '0.00',
        taxRatePercent: 10,
      },
    ]);
  };

  const removeLine = (index: number) => {
    if (lines.length === 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const totals = useMemo(() => {
    let subtotalCents = 0;
    let taxCents = 0;
    for (const l of lines) {
      const priceCents = Math.round((parseFloat(l.unitPrice) || 0) * 100);
      const lineSub = priceCents * (l.quantity || 1);
      const lineTax = l.taxRatePercent === 10 ? Math.round(lineSub * 0.1) : 0;
      subtotalCents += lineSub;
      taxCents += lineTax;
    }
    return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
  }, [lines]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!contactId) {
      setError('Please select a supplier/vendor.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await purchaseOrderApi.create({
        contactId,
        poNumber: poNumber.trim() || undefined,
        reference: reference.trim() || undefined,
        orderDate,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        deliveryInstructions: deliveryInstructions.trim() || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description.trim(),
          quantity: l.quantity,
          unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100),
          taxRatePercent: l.taxRatePercent,
          accountId: l.accountId || undefined,
        })),
      });
      onCreated(res.purchaseOrder);
    } catch (err: any) {
      setError(err.message || 'Failed to create purchase order.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Purchase Order" maxWidth="max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs mt-3">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Supplier / Vendor *</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="w-full h-8 px-2.5 rounded border border-slate-200 bg-white"
              required
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <Input
            label="PO Number (leave blank for auto PO-XXXX)"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="Auto-generated"
            mono
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Order Date *"
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            required
          />
          <Input
            label="Expected Delivery Date"
            type="date"
            value={expectedDeliveryDate}
            onChange={(e) => setExpectedDeliveryDate(e.target.value)}
          />
        </div>

        {/* Lines */}
        <div className="space-y-2 pt-2 border-t">
          <div className="flex justify-between items-center">
            <p className="font-medium text-slate-900">Procurement Items</p>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Line
            </Button>
          </div>

          {lines.map((l, idx) => (
            <div key={l.id} className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded">
              <div className="col-span-3">
                <select
                  value={l.itemId || ''}
                  onChange={(e) => handleItemSelect(idx, e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-200 bg-white text-[11px]"
                >
                  <option value="">(Catalog Item)</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.code} - {it.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-4">
                <input
                  type="text"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLines((prev) => prev.map((item, i) => (i === idx ? { ...item, description: val } : item)));
                  }}
                  className="w-full h-8 px-2 rounded border border-slate-200 bg-white text-[11px]"
                  required
                />
              </div>
              <div className="col-span-1">
                <input
                  type="number"
                  min="1"
                  value={l.quantity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 1;
                    setLines((prev) => prev.map((item, i) => (i === idx ? { ...item, quantity: val } : item)));
                  }}
                  className="w-full h-8 px-1 rounded border border-slate-200 bg-white text-[11px] text-center"
                />
              </div>
              <div className="col-span-2">
                <input
                  type="number"
                  step="0.01"
                  value={l.unitPrice}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLines((prev) => prev.map((item, i) => (i === idx ? { ...item, unitPrice: val } : item)));
                  }}
                  className="w-full h-8 px-2 rounded border border-slate-200 bg-white text-[11px] font-mono text-right"
                />
              </div>
              <div className="col-span-1 text-center font-mono text-slate-500 text-[11px]">
                {l.taxRatePercent}%
              </div>
              <div className="col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  disabled={lines.length === 1}
                  className="text-slate-400 hover:text-rose-600 disabled:opacity-30"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

          <div className="flex justify-end pt-2 text-right">
            <div className="w-56 space-y-1">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal:</span>
                <span className="font-mono">{formatCents(totals.subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>GST:</span>
                <span className="font-mono">{formatCents(totals.taxCents)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900 border-t pt-1">
                <span>Total PO:</span>
                <span className="font-mono">{formatCents(totals.totalCents)}</span>
              </div>
            </div>
          </div>
        </div>

        <Input
          label="Delivery Instructions"
          placeholder="Dock 3, deliver between 8am-4pm"
          value={deliveryInstructions}
          onChange={(e) => setDeliveryInstructions(e.target.value)}
        />

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save Purchase Order
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Purchase Order Detail Modal (Approve + Convert to Bill)
// ---------------------------------------------------------------------------

interface PODetailModalProps {
  poId: string;
  onClose: () => void;
  onPOUpdated: (po: PurchaseOrder) => void;
  onConvertedToBill: () => void;
}

function PODetailModal({
  poId,
  onClose,
  onPOUpdated,
  onConvertedToBill,
}: PODetailModalProps) {
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await purchaseOrderApi.get(poId);
        setPo(res.purchaseOrder);
      } catch (err: any) {
        setError(err.message || 'Failed to load PO details.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [poId]);

  const handleApprove = async () => {
    if (!po) return;
    setActionLoading(true);
    try {
      const res = await purchaseOrderApi.approve(po.id);
      setPo(res.purchaseOrder);
      onPOUpdated(res.purchaseOrder);
    } catch (err: any) {
      alert(err.message || 'Failed to approve purchase order.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConvert = async () => {
    if (!po) return;
    setActionLoading(true);
    try {
      await purchaseOrderApi.convertToBill(po.id);
      onConvertedToBill();
    } catch (err: any) {
      alert(err.message || 'Failed to convert PO to bill.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Modal open={Boolean(poId)} onClose={onClose} title={`Purchase Order ${po?.poNumber ?? ''}`} maxWidth="max-w-2xl">
      {loading ? (
        <div className="py-12 flex justify-center">
          <div className="w-6 h-6 border-2 border-forest-900 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error || !po ? (
        <div className="p-4 bg-red-50 text-red-700 text-xs">{error ?? 'PO not found'}</div>
      ) : (
        <div className="space-y-4 text-xs mt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded">
            <div>
              <p className="text-slate-400">Supplier</p>
              <p className="font-medium text-slate-900">{po.contact?.name}</p>
            </div>
            <div>
              <p className="text-slate-400">Order Date</p>
              <p className="text-slate-900">{formatDate(po.orderDate)}</p>
            </div>
            <div>
              <p className="text-slate-400">Delivery Date</p>
              <p className="text-slate-900">{formatDate(po.expectedDeliveryDate || '')}</p>
            </div>
            <div>
              <p className="text-slate-400">Status</p>
              <StatusTag variant={po.status === 'APPROVED' ? 'emerald' : 'slate'}>{po.status}</StatusTag>
            </div>
          </div>

          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 border-b">
                <tr>
                  <th className="py-2 px-3">Description</th>
                  <th className="py-2 px-3 text-center">Qty</th>
                  <th className="py-2 px-3 text-right">Unit Price</th>
                  <th className="py-2 px-3 text-right">Subtotal</th>
                  <th className="py-2 px-3 text-right">GST</th>
                  <th className="py-2 px-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {po.lines?.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 px-3 font-sans text-slate-800">{l.description}</td>
                    <td className="py-2 px-3 text-center text-slate-600">{l.quantity}</td>
                    <td className="py-2 px-3 text-right text-slate-600">{formatCents(l.unitPriceCents)}</td>
                    <td className="py-2 px-3 text-right text-slate-600">{formatCents(l.subtotalCents)}</td>
                    <td className="py-2 px-3 text-right text-slate-600">{formatCents(l.taxCents)}</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-900">{formatCents(l.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center pt-3 border-t">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <div className="flex items-center gap-2">
              {po.status === 'PENDING_APPROVAL' && (
                <Button onClick={handleApprove} loading={actionLoading} className="inline-flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Approve PO</span>
                </Button>
              )}
              {po.status === 'APPROVED' && (
                <Button onClick={handleConvert} loading={actionLoading} className="inline-flex items-center gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Convert to Vendor Bill</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create Vendor Credit Modal (Module 5.4)
// ---------------------------------------------------------------------------

interface CreateVendorCreditModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (vc: VendorCredit) => void;
}

function CreateVendorCreditModal({ open, onClose, onCreated }: CreateVendorCreditModalProps) {
  const [vendors, setVendors] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [creditNumber, setCreditNumber] = useState('');
  const [reference, setReference] = useState('');
  const [creditDate, setCreditDate] = useState(new Date().toISOString().slice(0, 10));

  const [lines, setLines] = useState([
    {
      id: '1',
      description: 'Supplier Rebate / Return Credit',
      quantity: 1,
      unitPrice: '100.00',
      taxRatePercent: 10,
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await contactApi.list();
        const vList = res.contacts.filter((c) => c.type === 'SUPPLIER' || c.type === 'BOTH');
        setVendors(vList);
        if (vList.length > 0) setContactId(vList[0].id);
      } catch {
        setError('Failed to load vendors.');
      }
    }
    void load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId) {
      setError('Please select a supplier.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await vendorCreditApi.create({
        contactId,
        creditNumber: creditNumber.trim() || `VCR-${Math.floor(1000 + Math.random() * 9000)}`,
        reference: reference.trim() || undefined,
        creditDate,
        lines: lines.map((l) => ({
          description: l.description.trim(),
          quantity: l.quantity,
          unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100),
          taxRatePercent: l.taxRatePercent,
        })),
      });
      onCreated(res.vendorCredit);
    } catch (err: any) {
      setError(err.message || 'Failed to create vendor credit.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record Vendor Credit Note" maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs mt-3">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Supplier *</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="w-full h-8 px-2.5 rounded border border-slate-200 bg-white"
              required
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <Input
            label="Vendor Credit #"
            placeholder="VCR-XXXX"
            value={creditNumber}
            onChange={(e) => setCreditNumber(e.target.value)}
            mono
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Credit Date *"
            type="date"
            value={creditDate}
            onChange={(e) => setCreditDate(e.target.value)}
            required
          />
          <Input
            label="Supplier Reference"
            placeholder="e.g. Return authorization, Credit memo"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        <div className="space-y-2 pt-2 border-t">
          <p className="font-medium text-slate-900">Line Items</p>
          {lines.map((l, i) => (
            <div key={l.id} className="grid grid-cols-12 gap-2 bg-slate-50 p-2 rounded">
              <div className="col-span-7">
                <input
                  type="text"
                  placeholder="Reason / Description"
                  value={l.description}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLines((prev) => prev.map((item, idx) => (idx === i ? { ...item, description: val } : item)));
                  }}
                  className="w-full h-8 px-2 rounded border border-slate-200 bg-white"
                  required
                />
              </div>
              <div className="col-span-3">
                <input
                  type="number"
                  step="0.01"
                  placeholder="Amount"
                  value={l.unitPrice}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLines((prev) => prev.map((item, idx) => (idx === i ? { ...item, unitPrice: val } : item)));
                  }}
                  className="w-full h-8 px-2 rounded border border-slate-200 bg-white font-mono text-right"
                  required
                />
              </div>
              <div className="col-span-2 text-center text-slate-500 font-mono text-[11px] pt-2">
                +10% GST
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save & Post Vendor Credit
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Vendor Credit Detail Modal
// ---------------------------------------------------------------------------

interface VendorCreditDetailModalProps {
  creditId: string;
  onClose: () => void;
  onCreditUpdated: (vc: VendorCredit) => void;
  onAllocate: (vc: VendorCredit) => void;
}

function VendorCreditDetailModal({
  creditId,
  onClose,
  onCreditUpdated,
  onAllocate,
}: VendorCreditDetailModalProps) {
  const [credit, setCredit] = useState<VendorCredit | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await vendorCreditApi.get(creditId);
        setCredit(res.credit);
      } catch (err: any) {
        setError(err.message || 'Failed to load credit.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [creditId]);

  const handleIssue = async () => {
    if (!credit) return;
    setIssuing(true);
    try {
      const res = await vendorCreditApi.issue(credit.id);
      setCredit(res.vendorCredit);
      onCreditUpdated(res.vendorCredit);
    } catch (err: any) {
      alert(err.message || 'Failed to issue vendor credit.');
    } finally {
      setIssuing(false);
    }
  };

  return (
    <Modal open={Boolean(creditId)} onClose={onClose} title={`Vendor Credit ${credit?.creditNumber ?? ''}`} maxWidth="max-w-2xl">
      {loading ? (
        <div className="py-12 flex justify-center">
          <div className="w-6 h-6 border-2 border-forest-900 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error || !credit ? (
        <div className="p-4 bg-red-50 text-red-700 text-xs">{error ?? 'Credit not found'}</div>
      ) : (
        <div className="space-y-4 text-xs mt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded">
            <div>
              <p className="text-slate-400">Supplier</p>
              <p className="font-medium text-slate-900">{credit.contact?.name}</p>
            </div>
            <div>
              <p className="text-slate-400">Date</p>
              <p className="text-slate-900">{formatDate(credit.creditDate)}</p>
            </div>
            <div>
              <p className="text-slate-400">Total Credit</p>
              <p className="font-mono font-bold text-slate-900">{formatCents(credit.totalCents)}</p>
            </div>
            <div>
              <p className="text-slate-400">Remaining</p>
              <p className="font-mono font-bold text-forest-900">{formatCents(credit.remainingCents)}</p>
            </div>
          </div>

          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 border-b">
                <tr>
                  <th className="py-2 px-3">Description</th>
                  <th className="py-2 px-3 text-right">Subtotal</th>
                  <th className="py-2 px-3 text-right">GST</th>
                  <th className="py-2 px-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {credit.lines?.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 px-3 font-sans text-slate-800">{l.description}</td>
                    <td className="py-2 px-3 text-right text-slate-600">{formatCents(l.subtotalCents)}</td>
                    <td className="py-2 px-3 text-right text-slate-600">{formatCents(l.taxCents)}</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-900">{formatCents(l.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center pt-3 border-t">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <div className="flex items-center gap-2">
              {credit.status === 'DRAFT' && (
                <Button onClick={handleIssue} loading={issuing}>
                  Issue & Post AP Credit
                </Button>
              )}
              {credit.status === 'OPEN' && credit.remainingCents > 0 && (
                <Button onClick={() => onAllocate(credit)} className="inline-flex items-center gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Allocate to Unpaid Bill</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Allocate Vendor Credit Modal (Module 5.4)
// ---------------------------------------------------------------------------

interface AllocateVendorCreditModalProps {
  open: boolean;
  credit: VendorCredit;
  onClose: () => void;
  onAllocated: () => void;
}

function AllocateVendorCreditModal({
  open,
  credit,
  onClose,
  onAllocated,
}: AllocateVendorCreditModalProps) {
  const [openBills, setOpenBills] = useState<Bill[]>([]);
  const [selectedBillId, setSelectedBillId] = useState('');
  const [amount, setAmount] = useState((credit.remainingCents / 100).toFixed(2));
  const [allocating, setAllocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await billApi.list({ contactId: credit.contactId });
        const eligible = res.bills.filter((b) => b.status === 'AWAITING_PAYMENT' || b.status === 'PARTIALLY_PAID');
        setOpenBills(eligible);
        if (eligible.length > 0) setSelectedBillId(eligible[0].id);
      } catch {
        setError('Failed to load eligible vendor bills.');
      }
    }
    void load();
  }, [credit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBillId) {
      setError('Please select an open bill.');
      return;
    }
    const amtCents = Math.round((parseFloat(amount) || 0) * 100);
    if (amtCents <= 0 || amtCents > credit.remainingCents) {
      setError('Invalid allocation amount.');
      return;
    }

    setAllocating(true);
    try {
      await vendorCreditApi.allocate(credit.id, {
        billId: selectedBillId,
        amountCents: amtCents,
      });
      onAllocated();
    } catch (err: any) {
      setError(err.message || 'Failed to allocate credit.');
    } finally {
      setAllocating(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Allocate Vendor Credit to Open Bill" maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs mt-3">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-slate-50 p-3 rounded flex justify-between">
          <span className="text-slate-500">Available Credit:</span>
          <span className="font-mono font-bold text-forest-900">{formatCents(credit.remainingCents)}</span>
        </div>

        <div>
          <label className="block font-medium text-slate-700 mb-1">Target Vendor Bill *</label>
          {openBills.length === 0 ? (
            <div className="p-2.5 bg-amber-50 text-amber-800 rounded">
              This vendor has no awaiting payment bills to apply credit against.
            </div>
          ) : (
            <select
              value={selectedBillId}
              onChange={(e) => setSelectedBillId(e.target.value)}
              className="w-full h-8 px-2.5 rounded border border-slate-200 bg-white"
              required
            >
              {openBills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.reference || b.id.slice(0, 8)} — Balance: {formatCents(b.totalCents - b.amountPaidCents)}
                </option>
              ))}
            </select>
          )}
        </div>

        <Input
          label="Amount to Allocate ($ AUD) *"
          type="number"
          step="0.01"
          max={(credit.remainingCents / 100).toFixed(2)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={allocating}>
            Cancel
          </Button>
          <Button type="submit" loading={allocating} disabled={openBills.length === 0}>
            Apply Credit
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create Batch Payment Run (.ABA Export) Modal (Module 5.5)
// ---------------------------------------------------------------------------

interface CreateBatchPaymentModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateBatchPaymentModal({
  open,
  onClose,
  onCreated,
}: CreateBatchPaymentModalProps) {
  const [unpaidBills, setUnpaidBills] = useState<Bill[]>([]);
  const [bankAccounts, setBankAccounts] = useState<Account[]>([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('Supplier Run');
  const [selectedBillIds, setSelectedBillIds] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [bRes, aRes] = await Promise.all([
          billApi.list({ status: 'AWAITING_PAYMENT' }),
          accountApi.list(),
        ]);
        setUnpaidBills(bRes.bills);
        const banks = aRes.accounts.filter((a) => a.type === 'ASSET' && a.code.startsWith('10'));
        setBankAccounts(banks);
        if (banks.length > 0) setSelectedBankId(banks[0].id);

        const initialSel: Record<string, boolean> = {};
        for (const b of bRes.bills) {
          initialSel[b.id] = true;
        }
        setSelectedBillIds(initialSel);
      } catch {
        setError('Failed to load eligible bills.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const totalBatchCents = useMemo(() => {
    return unpaidBills
      .filter((b) => selectedBillIds[b.id])
      .reduce((sum, b) => sum + (b.totalCents - b.amountPaidCents), 0);
  }, [unpaidBills, selectedBillIds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const billPayments = unpaidBills
      .filter((b) => selectedBillIds[b.id])
      .map((b) => ({
        billId: b.id,
        amountCents: b.totalCents - b.amountPaidCents,
      }));

    if (billPayments.length === 0) {
      setError('Please select at least one bill for the batch payment run.');
      return;
    }

    setSubmitting(true);
    try {
      await batchPaymentApi.create({
        paymentDate,
        bankAccountId: selectedBankId || undefined,
        description: description.trim() || undefined,
        billPayments,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Failed to generate batch payment run.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Execute .ABA Batch Payment Run" maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs mt-3">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Disbursement Bank Account</label>
            <select
              value={selectedBankId}
              onChange={(e) => setSelectedBankId(e.target.value)}
              className="w-full h-8 px-2.5 rounded border border-slate-200 bg-white"
            >
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
              ))}
            </select>
          </div>
          <Input
            label="Payment Date *"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            required
          />
        </div>

        <Input
          label="Payment Run Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Bill Selection Table */}
        <div className="space-y-2 pt-2 border-t">
          <div className="flex justify-between items-center">
            <p className="font-medium text-slate-900">Select Bills to Disburse</p>
            <span className="font-mono font-bold text-forest-900">
              Total: {formatCents(totalBatchCents)}
            </span>
          </div>

          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 border-b">
                <tr>
                  <th className="py-2 px-3 w-8"></th>
                  <th className="py-2 px-3">Supplier</th>
                  <th className="py-2 px-3">Reference</th>
                  <th className="py-2 px-3 text-right">Balance Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unpaidBills.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedBillIds[b.id])}
                        onChange={(e) =>
                          setSelectedBillIds((prev) => ({ ...prev, [b.id]: e.target.checked }))
                        }
                        className="rounded border-slate-300 text-forest-900"
                      />
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-800">{b.contact?.name}</td>
                    <td className="py-2 px-3 font-mono text-slate-600">{b.reference ?? '—'}</td>
                    <td className="py-2 px-3 text-right font-mono text-slate-900">
                      {formatCents(b.totalCents - b.amountPaidCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Generate Batch & Export .ABA
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create Recurring Bill Modal (Module 5.3)
// ---------------------------------------------------------------------------

interface CreateRecurringBillModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateRecurringBillModal({
  open,
  onClose,
  onCreated,
}: CreateRecurringBillModalProps) {
  const [vendors, setVendors] = useState<Contact[]>([]);
  const [name, setName] = useState('');
  const [contactId, setContactId] = useState('');
  const [frequency, setFrequency] = useState<'MONTHLY' | 'WEEKLY' | 'QUARTERLY' | 'ANNUALLY'>('MONTHLY');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [autoPost, setAutoPost] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await contactApi.list();
        const vList = res.contacts.filter((c) => c.type === 'SUPPLIER' || c.type === 'BOTH');
        setVendors(vList);
        if (vList.length > 0) setContactId(vList[0].id);
      } catch {
        setError('Failed to load suppliers.');
      }
    }
    void load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !contactId) {
      setError('Please provide a schedule name and supplier.');
      return;
    }

    setSubmitting(true);
    try {
      await recurringBillApi.create({
        name: name.trim(),
        contactId,
        frequency,
        startDate,
        autoPost,
        templateData: {
          lineItems: [
            {
              description: `${name.trim()} - Periodic Supplier Obligation`,
              amountCents: 200000,
              taxTreatment: 'TAX_EXCLUSIVE',
            },
          ],
        },
      });
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Failed to create recurring bill.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Recurring Bill Schedule" maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs mt-3">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Input
          label="Schedule Name *"
          placeholder="Monthly Office Lease"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div>
          <label className="block font-medium text-slate-700 mb-1">Supplier *</label>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="w-full h-8 px-2.5 rounded border border-slate-200 bg-white"
            required
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as any)}
              className="w-full h-8 px-2 rounded border border-slate-200 bg-white"
            >
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="ANNUALLY">Annually</option>
            </select>
          </div>
          <Input
            label="First Run Date *"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="autoPostBill"
            checked={autoPost}
            onChange={(e) => setAutoPost(e.target.checked)}
            className="rounded border-slate-300 text-forest-900 focus:ring-forest-900"
          />
          <label htmlFor="autoPostBill" className="text-slate-700 select-none">
            Auto-Approve and post to GL upon schedule trigger
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save Schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}
