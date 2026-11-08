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
  Send,
  FileSpreadsheet,
  CreditCard,
  ArrowDownLeft,
  Calendar,
  ArrowRight,
  RotateCcw,
  Check,
  X,
} from 'lucide-react';
import {
  invoiceApi,
  quoteApi,
  creditNoteApi,
  recurringInvoiceApi,
  contactApi,
  accountApi,
  itemApi,
  type Invoice,
  type InvoiceStatus,
  type Quote,
  type QuoteStatus,
  type CreditNote,
  type RecurringScheduleModel,
  type Contact,
  type PaymentIn,
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

type ARTab = 'INVOICES' | 'QUOTES' | 'CREDIT_NOTES' | 'RECURRING';

export function InvoicesPage() {
  const [activeTab, setActiveTab] = useState<ARTab>('INVOICES');

  // Invoices state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'ALL' | InvoiceStatus>('ALL');

  // Quotes state
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteSearch, setQuoteSearch] = useState('');
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<'ALL' | QuoteStatus>('ALL');

  // Credit Notes state
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loadingCreditNotes, setLoadingCreditNotes] = useState(false);
  const [creditNoteError, setCreditNoteError] = useState<string | null>(null);
  const [creditNoteSearch, setCreditNoteSearch] = useState('');

  // Recurring state
  const [recurringSchedules, setRecurringSchedules] = useState<RecurringScheduleModel[]>([]);
  const [loadingRecurring, setLoadingRecurring] = useState(false);
  const [recurringError, setRecurringError] = useState<string | null>(null);

  // Modals & Drawers
  const [isCreateInvoiceOpen, setIsCreateInvoiceOpen] = useState(false);
  const [isDirectPaymentModalOpen, setIsDirectPaymentModalOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);

  const [isCreateQuoteOpen, setIsCreateQuoteOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);

  const [isCreateCreditNoteOpen, setIsCreateCreditNoteOpen] = useState(false);
  const [selectedCreditNoteId, setSelectedCreditNoteId] = useState<string | null>(null);
  const [allocatingCreditNote, setAllocatingCreditNote] = useState<CreditNote | null>(null);

  const [isCreateRecurringOpen, setIsCreateRecurringOpen] = useState(false);

  // Initial load
  const fetchInvoices = async () => {
    setLoadingInvoices(true);
    setInvoiceError(null);
    try {
      const res = await invoiceApi.list();
      setInvoices(res.invoices);
    } catch (err) {
      if (err instanceof ApiError) setInvoiceError(err.message);
      else setInvoiceError('Failed to load invoices.');
    } finally {
      setLoadingInvoices(false);
    }
  };

  const fetchQuotes = async () => {
    setLoadingQuotes(true);
    setQuoteError(null);
    try {
      const res = await quoteApi.list();
      setQuotes(res.quotes);
    } catch (err) {
      if (err instanceof ApiError) setQuoteError(err.message);
      else setQuoteError('Failed to load quotes.');
    } finally {
      setLoadingQuotes(false);
    }
  };

  const fetchCreditNotes = async () => {
    setLoadingCreditNotes(true);
    setCreditNoteError(null);
    try {
      const res = await creditNoteApi.list();
      setCreditNotes(res.creditNotes);
    } catch (err) {
      if (err instanceof ApiError) setCreditNoteError(err.message);
      else setCreditNoteError('Failed to load credit notes.');
    } finally {
      setLoadingCreditNotes(false);
    }
  };

  const fetchRecurring = async () => {
    setLoadingRecurring(true);
    setRecurringError(null);
    try {
      const res = await recurringInvoiceApi.list();
      setRecurringSchedules(res.recurringInvoices);
    } catch (err) {
      if (err instanceof ApiError) setRecurringError(err.message);
      else setRecurringError('Failed to load recurring schedules.');
    } finally {
      setLoadingRecurring(false);
    }
  };

  useEffect(() => {
    void fetchInvoices();
  }, []);

  useEffect(() => {
    if (activeTab === 'QUOTES') void fetchQuotes();
    else if (activeTab === 'CREDIT_NOTES') void fetchCreditNotes();
    else if (activeTab === 'RECURRING') void fetchRecurring();
  }, [activeTab]);

  // Filtered Invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const matchesStatus =
        invoiceStatusFilter === 'ALL' || inv.status === invoiceStatusFilter;
      const q = invoiceSearch.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        (inv.contact && inv.contact.name.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [invoices, invoiceStatusFilter, invoiceSearch]);

  // Filtered Quotes
  const filteredQuotes = useMemo(() => {
    return quotes.filter((qItem) => {
      const matchesStatus =
        quoteStatusFilter === 'ALL' || qItem.status === quoteStatusFilter;
      const q = quoteSearch.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        qItem.quoteNumber.toLowerCase().includes(q) ||
        (qItem.contact && qItem.contact.name.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [quotes, quoteStatusFilter, quoteSearch]);

  // Filtered Credit Notes
  const filteredCreditNotes = useMemo(() => {
    return creditNotes.filter((cnItem) => {
      const q = creditNoteSearch.trim().toLowerCase();
      return (
        q === '' ||
        cnItem.creditNoteNumber.toLowerCase().includes(q) ||
        (cnItem.contact && cnItem.contact.name.toLowerCase().includes(q))
      );
    });
  }, [creditNotes, creditNoteSearch]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-slate-900">
            Accounts Receivable
          </h1>
          <p className="text-sm font-light text-slate-500 mt-1">
            End-to-end revenue lifecycle: Quotes, Invoices, Credit Notes, and Recurring Billing with automatic double-entry GL posting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'INVOICES' && (
            <>
              <Button
                variant="outline"
                onClick={() => setIsDirectPaymentModalOpen(true)}
                className="inline-flex items-center gap-1.5"
              >
                <ArrowDownLeft className="w-4 h-4 text-emerald-700" />
                <span>Receive Payment</span>
              </Button>
              <Button
                onClick={() => setIsCreateInvoiceOpen(true)}
                className="inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>New Invoice</span>
              </Button>
            </>
          )}
          {activeTab === 'QUOTES' && (
            <Button
              onClick={() => setIsCreateQuoteOpen(true)}
              className="inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>New Quote</span>
            </Button>
          )}
          {activeTab === 'CREDIT_NOTES' && (
            <Button
              onClick={() => setIsCreateCreditNoteOpen(true)}
              className="inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>New Credit Note</span>
            </Button>
          )}
          {activeTab === 'RECURRING' && (
            <Button
              onClick={() => setIsCreateRecurringOpen(true)}
              className="inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>New Recurring Schedule</span>
            </Button>
          )}
        </div>
      </div>

      {/* AR Navigation Tabs */}
      <div className="flex items-center border-b border-slate-200 gap-1">
        <button
          onClick={() => setActiveTab('INVOICES')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'INVOICES'
              ? 'border-forest-900 text-forest-950 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Customer Invoices</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
            {invoices.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('QUOTES')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'QUOTES'
              ? 'border-forest-900 text-forest-950 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Quotes & Estimates</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
            {quotes.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('CREDIT_NOTES')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'CREDIT_NOTES'
              ? 'border-forest-900 text-forest-950 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Credit Notes</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
            {creditNotes.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('RECURRING')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'RECURRING'
              ? 'border-forest-900 text-forest-950 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Recurring Invoices</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
            {recurringSchedules.length}
          </span>
        </button>
      </div>

      {/* TAB 1: INVOICES */}
      {activeTab === 'INVOICES' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by invoice # or customer…"
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-forest-900"
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              {(['ALL', 'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const).map(
                (status) => (
                  <button
                    key={status}
                    onClick={() => setInvoiceStatusFilter(status)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      invoiceStatusFilter === status
                        ? 'bg-forest-900 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {status.replace('_', ' ')}
                  </button>
                ),
              )}
            </div>
          </div>

          {invoiceError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{invoiceError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingInvoices ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
                <p className="text-xs">Loading customer invoices…</p>
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-2xl bg-forest-50 flex items-center justify-center mb-3">
                  <FileSpreadsheet className="w-6 h-6 text-forest-800" />
                </div>
                <p className="text-sm font-medium text-slate-800">No customer invoices found</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  {invoiceSearch || invoiceStatusFilter !== 'ALL'
                    ? 'Try adjusting your search query or status filter.'
                    : 'Create customer invoices to bill clients and automatically post accounts receivable.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Invoice #</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Issue Date</th>
                      <th className="py-3 px-4">Due Date</th>
                      <th className="py-3 px-4 text-right">Subtotal</th>
                      <th className="py-3 px-4 text-right">GST</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-slate-900">
                          {inv.invoiceNumber}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <div>
                              <p className="font-medium text-slate-800">
                                {inv.contact?.name ?? 'Unknown Customer'}
                              </p>
                              {inv.contact?.email && (
                                <p className="text-[11px] text-slate-400">{inv.contact.email}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">{formatDate(inv.issueDate)}</td>
                        <td className="py-3 px-4 text-slate-600">{formatDate(inv.dueDate)}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {formatCents(inv.subtotalCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {formatCents(inv.gstCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                          {formatCents(inv.totalCents)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <InvoiceStatusBadge status={inv.status} />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {(inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPaymentInvoice(inv)}
                                className="inline-flex items-center gap-1 text-xs py-1 h-7 text-forest-800 border-forest-200 hover:bg-forest-50"
                              >
                                <CreditCard className="w-3.5 h-3.5 text-forest-700" />
                                <span>Record Payment</span>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedInvoiceId(inv.id)}
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

      {/* TAB 2: QUOTES */}
      {activeTab === 'QUOTES' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by quote # or customer…"
                value={quoteSearch}
                onChange={(e) => setQuoteSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-forest-900"
              />
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              {(['ALL', 'DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'INVOICED'] as const).map(
                (st) => (
                  <button
                    key={st}
                    onClick={() => setQuoteStatusFilter(st)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      quoteStatusFilter === st
                        ? 'bg-forest-900 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {st}
                  </button>
                ),
              )}
            </div>
          </div>

          {quoteError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{quoteError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingQuotes ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
                <p className="text-xs">Loading quotes…</p>
              </div>
            ) : filteredQuotes.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <FileSpreadsheet className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-800">No quotes found</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Create formal sales quotes for prospective clients with 1-click conversion to invoices.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Quote #</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Expiry Date</th>
                      <th className="py-3 px-4 text-right">Subtotal</th>
                      <th className="py-3 px-4 text-right">GST</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredQuotes.map((qItem) => (
                      <tr key={qItem.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-slate-900">
                          {qItem.quoteNumber}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-800">{qItem.contact?.name ?? '—'}</p>
                        </td>
                        <td className="py-3 px-4 text-slate-600">{formatDate(qItem.quoteDate)}</td>
                        <td className="py-3 px-4 text-slate-600">{formatDate(qItem.expiryDate || '')}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {formatCents(qItem.subtotalCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600">
                          {formatCents(qItem.taxCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                          {formatCents(qItem.totalCents)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <StatusTag
                            variant={
                              qItem.status === 'ACCEPTED' || qItem.status === 'INVOICED'
                                ? 'emerald'
                                : qItem.status === 'SENT'
                                ? 'amber'
                                : qItem.status === 'DECLINED' || qItem.status === 'EXPIRED'
                                ? 'rose'
                                : 'slate'
                            }
                          >
                            {qItem.status}
                          </StatusTag>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedQuoteId(qItem.id)}
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

      {/* TAB 3: CREDIT NOTES */}
      {activeTab === 'CREDIT_NOTES' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search credit notes…"
                value={creditNoteSearch}
                onChange={(e) => setCreditNoteSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-forest-900"
              />
            </div>
          </div>

          {creditNoteError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{creditNoteError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingCreditNotes ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
                <p className="text-xs">Loading credit notes…</p>
              </div>
            ) : filteredCreditNotes.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <RotateCcw className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-800">No credit notes found</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Issue customer credit notes for billing adjustments, refunds, or contra-AR settlements.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Credit Note #</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Remaining</th>
                      <th className="py-3 px-4 text-right">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCreditNotes.map((cnItem) => (
                      <tr key={cnItem.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-slate-900">
                          {cnItem.creditNoteNumber}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-800">{cnItem.contact?.name ?? '—'}</p>
                        </td>
                        <td className="py-3 px-4 text-slate-600">{formatDate(cnItem.creditNoteDate)}</td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                          {formatCents(cnItem.totalCents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-forest-900">
                          {formatCents(cnItem.remainingCents)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <StatusTag
                            variant={
                              cnItem.status === 'APPLIED'
                                ? 'emerald'
                                : cnItem.status === 'OPEN' || cnItem.status === 'PARTIALLY_APPLIED'
                                ? 'amber'
                                : cnItem.status === 'REFUNDED'
                                ? 'cyan'
                                : 'slate'
                            }
                          >
                            {cnItem.status}
                          </StatusTag>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {cnItem.status === 'OPEN' && cnItem.remainingCents > 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setAllocatingCreditNote(cnItem)}
                                className="inline-flex items-center gap-1 text-xs py-1 h-7 text-forest-800 border-forest-200 hover:bg-forest-50"
                              >
                                <ArrowRight className="w-3.5 h-3.5 text-forest-700" />
                                <span>Allocate</span>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedCreditNoteId(cnItem.id)}
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

      {/* TAB 4: RECURRING INVOICES */}
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
                <p className="text-xs">Loading recurring schedules…</p>
              </div>
            ) : recurringSchedules.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <Calendar className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-800">No recurring invoice schedules</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Automate monthly retainers and recurring billing schedules with optional auto-post GL.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Schedule Name</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Frequency</th>
                      <th className="py-3 px-4">Next Run Date</th>
                      <th className="py-3 px-4 text-center">Auto-Issue</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recurringSchedules.map((sched) => (
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
                                await recurringInvoiceApi.run(sched.id);
                                void fetchInvoices();
                                void fetchRecurring();
                                alert(`Successfully generated invoice for ${sched.name}`);
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

      {/* Modals */}
      {isCreateInvoiceOpen && (
        <CreateInvoiceModal
          open={isCreateInvoiceOpen}
          onClose={() => setIsCreateInvoiceOpen(false)}
          onCreated={(newInv) => {
            setInvoices((prev) => [newInv, ...prev]);
            setIsCreateInvoiceOpen(false);
          }}
        />
      )}

      {selectedInvoiceId && (
        <InvoiceDetailModal
          invoiceId={selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          onInvoiceUpdated={(upd) => {
            setInvoices((prev) => prev.map((i) => (i.id === upd.id ? upd : i)));
          }}
          onRecordPayment={(inv) => {
            setSelectedInvoiceId(null);
            setPaymentInvoice(inv);
          }}
        />
      )}

      {paymentInvoice && (
        <RecordPaymentInModal
          open={Boolean(paymentInvoice)}
          onClose={() => setPaymentInvoice(null)}
          invoice={paymentInvoice}
          onPaymentRecorded={(updatedInv) => {
            setInvoices((prev) => prev.map((i) => (i.id === updatedInv.id ? updatedInv : i)));
            setPaymentInvoice(null);
          }}
        />
      )}

      {isDirectPaymentModalOpen && (
        <ReceiveDirectPaymentModal
          open={isDirectPaymentModalOpen}
          onClose={() => setIsDirectPaymentModalOpen(false)}
          onSuccess={() => {
            setIsDirectPaymentModalOpen(false);
            void fetchInvoices();
          }}
        />
      )}

      {/* Quote Modals */}
      {isCreateQuoteOpen && (
        <CreateQuoteModal
          open={isCreateQuoteOpen}
          onClose={() => setIsCreateQuoteOpen(false)}
          onCreated={(newQ) => {
            setQuotes((prev) => [newQ, ...prev]);
            setIsCreateQuoteOpen(false);
          }}
        />
      )}

      {selectedQuoteId && (
        <QuoteDetailModal
          quoteId={selectedQuoteId}
          onClose={() => setSelectedQuoteId(null)}
          onQuoteUpdated={(updQ) => {
            setQuotes((prev) => prev.map((q) => (q.id === updQ.id ? updQ : q)));
          }}
          onConvertedToInvoice={() => {
            setSelectedQuoteId(null);
            void fetchQuotes();
            void fetchInvoices();
            setActiveTab('INVOICES');
          }}
        />
      )}

      {/* Credit Note Modals */}
      {isCreateCreditNoteOpen && (
        <CreateCreditNoteModal
          open={isCreateCreditNoteOpen}
          onClose={() => setIsCreateCreditNoteOpen(false)}
          onCreated={(newCn) => {
            setCreditNotes((prev) => [newCn, ...prev]);
            setIsCreateCreditNoteOpen(false);
          }}
        />
      )}

      {selectedCreditNoteId && (
        <CreditNoteDetailModal
          creditNoteId={selectedCreditNoteId}
          onClose={() => setSelectedCreditNoteId(null)}
          onCreditNoteUpdated={(upd) => {
            setCreditNotes((prev) => prev.map((c) => (c.id === upd.id ? upd : c)));
          }}
          onAllocate={(cn) => {
            setSelectedCreditNoteId(null);
            setAllocatingCreditNote(cn);
          }}
        />
      )}

      {allocatingCreditNote && (
        <AllocateCreditNoteModal
          open={Boolean(allocatingCreditNote)}
          creditNote={allocatingCreditNote}
          onClose={() => setAllocatingCreditNote(null)}
          onAllocated={() => {
            setAllocatingCreditNote(null);
            void fetchCreditNotes();
            void fetchInvoices();
          }}
        />
      )}

      {/* Recurring Schedule Modal */}
      {isCreateRecurringOpen && (
        <CreateRecurringScheduleModal
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
// Status Badges
// ---------------------------------------------------------------------------

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
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
    case 'ISSUED':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
          <Clock className="w-3 h-3 text-amber-600" />
          <span>Issued</span>
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

function CreateInvoiceModal({
  open,
  onClose,
  onCreated,
}: CreateInvoiceModalProps) {
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  // Form fields
  const [contactId, setContactId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState('');

  const [lineItems, setLineItems] = useState<LineItemDraft[]>([
    {
      id: '1',
      description: 'Professional Services',
      amount: '500.00',
      taxTreatment: 'TAX_EXCLUSIVE',
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch customers on load
  useEffect(() => {
    async function loadCustomers() {
      try {
        const res = await contactApi.list();
        const customerList = res.contacts.filter(
          (c) => c.type === 'CUSTOMER' || c.type === 'BOTH',
        );
        setCustomers(customerList);
        if (customerList.length > 0) {
          setContactId(customerList[0]!.id);
          const days = customerList[0]!.paymentTermsDays || 14;
          const d = new Date();
          d.setDate(d.getDate() + days);
          setDueDate(d.toISOString().slice(0, 10));
        }
      } catch {
        setError('Failed to load customers.');
      } finally {
        setLoadingCustomers(false);
      }
    }
    void loadCustomers();
  }, []);

  const handleCustomerChange = (id: string) => {
    setContactId(id);
    const selected = customers.find((c) => c.id === id);
    if (selected) {
      const days = selected.paymentTermsDays || 14;
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
    value: string,
  ) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  // Real-time GST calculation preview
  const previewTotals = useMemo(() => {
    let subtotalCents = 0;
    let gstCents = 0;

    for (const item of lineItems) {
      const dollars = parseFloat(item.amount) || 0;
      const rawCents = Math.round(dollars * 100);

      if (rawCents <= 0) continue;

      switch (item.taxTreatment) {
        case 'TAX_EXCLUSIVE': {
          const gst = Math.round(rawCents * 0.1);
          subtotalCents += rawCents;
          gstCents += gst;
          break;
        }
        case 'TAX_INCLUSIVE': {
          const subtotal = Math.round(rawCents / 1.1);
          const gst = rawCents - subtotal;
          subtotalCents += subtotal;
          gstCents += gst;
          break;
        }
        case 'GST_FREE': {
          subtotalCents += rawCents;
          break;
        }
      }
    }

    return {
      subtotalCents,
      gstCents,
      totalCents: subtotalCents + gstCents,
    };
  }, [lineItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!contactId) {
      setError('Please select a customer.');
      return;
    }

    // Validate line items
    const parsedLineItems = [];
    for (const item of lineItems) {
      if (!item.description.trim()) {
        setError('All line items must have a description.');
        return;
      }
      const dollars = parseFloat(item.amount);
      if (isNaN(dollars) || dollars <= 0) {
        setError('Line item amount must be a positive number.');
        return;
      }
      parsedLineItems.push({
        description: item.description.trim(),
        amountCents: Math.round(dollars * 100),
        taxTreatment: item.taxTreatment,
      });
    }

    setSubmitting(true);
    try {
      const res = await invoiceApi.create({
        contactId,
        invoiceNumber: invoiceNumber.trim() || undefined,
        issueDate,
        dueDate,
        notes: notes.trim() || null,
        lineItems: parsedLineItems,
      });
      onCreated(res.invoice);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to create invoice.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Customer Invoice"
      description="Create a draft invoice with line items and automatic GST computation."
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4 mt-2">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Customer Selection */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Customer <span className="text-red-500">*</span>
            </label>
            {loadingCustomers ? (
              <div className="text-xs text-slate-400 py-2">Loading customers…</div>
            ) : customers.length === 0 ? (
              <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded-md">
                No customer contacts found. Add a contact with type CUSTOMER or BOTH first.
              </div>
            ) : (
              <select
                value={contactId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                required
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.abn ? `(ABN: ${c.abn})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Optional Custom Invoice Number */}
          <Input
            label="Invoice Number (Leave blank to auto-generate)"
            placeholder="e.g. INV-1001"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

        {/* Dynamic Line Items Section */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-700">
              Line Items
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLineItem}
              className="inline-flex items-center gap-1 text-xs py-1 h-7"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Item</span>
            </Button>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {lineItems.map((item, idx) => (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200/80"
              >
                <div className="col-span-12 sm:col-span-5">
                  <input
                    type="text"
                    placeholder={`Description #${idx + 1}`}
                    value={item.description}
                    onChange={(e) =>
                      updateLineItem(item.id, 'description', e.target.value)
                    }
                    className="w-full text-xs rounded border border-slate-200 px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                    required
                  />
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="Amount ($)"
                    value={item.amount}
                    onChange={(e) =>
                      updateLineItem(item.id, 'amount', e.target.value)
                    }
                    className="w-full text-xs rounded border border-slate-200 px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
                    required
                  />
                </div>
                <div className="col-span-5 sm:col-span-3">
                  <select
                    value={item.taxTreatment}
                    onChange={(e) =>
                      updateLineItem(item.id, 'taxTreatment', e.target.value)
                    }
                    className="w-full text-xs rounded border border-slate-200 px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                  >
                    <option value="TAX_EXCLUSIVE">Tax Exclusive (10% GST)</option>
                    <option value="TAX_INCLUSIVE">Tax Inclusive (GST incl.)</option>
                    <option value="GST_FREE">GST Free (0%)</option>
                  </select>
                </div>
                <div className="col-span-1 flex justify-end">
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
              </div>
            ))}
          </div>

          {/* Real-time Subtotal, GST, Total Breakdown */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 space-y-1 text-xs">
            <div className="flex justify-between text-slate-500">
              <span>Subtotal (excl. GST):</span>
              <span className="font-mono">
                {formatCents(previewTotals.subtotalCents)}
              </span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>GST (10%):</span>
              <span className="font-mono">
                {formatCents(previewTotals.gstCents)}
              </span>
            </div>
            <div className="flex justify-between text-slate-900 font-medium text-sm pt-1.5 border-t border-slate-200">
              <span>Total Amount:</span>
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
          placeholder="Payment instructions or terms for the customer"
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
            disabled={submitting || customers.length === 0}
          >
            {submitting ? 'Saving…' : 'Save as Draft Invoice'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Invoice Detail Modal & Issue Action
// ---------------------------------------------------------------------------

interface InvoiceDetailModalProps {
  invoiceId: string;
  onClose: () => void;
  onInvoiceUpdated?: (invoice: Invoice) => void;
  onRecordPayment?: (invoice: Invoice) => void;
}

function InvoiceDetailModal({
  invoiceId,
  onClose,
  onInvoiceUpdated,
  onRecordPayment,
}: InvoiceDetailModalProps) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [journalEntry, setJournalEntry] = useState<any | null>(null);
  const [payments, setPayments] = useState<PaymentIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [invRes, pmtRes] = await Promise.all([
          invoiceApi.get(invoiceId),
          invoiceApi.getPayments(invoiceId).catch(() => ({ payments: [] })),
        ]);
        setInvoice(invRes.invoice);
        setJournalEntry(invRes.journalEntry);
        setPayments(pmtRes.payments);
      } catch (err) {
        if (err instanceof ApiError) setError(err.message);
        else setError('Failed to load invoice details.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [invoiceId]);

  const handleIssueInvoice = async () => {
    if (!invoice) return;
    setIssuing(true);
    setError(null);
    try {
      const res = await invoiceApi.issue(invoice.id);
      setInvoice(res.invoice);
      setJournalEntry(res.journalEntry);
      if (onInvoiceUpdated) onInvoiceUpdated(res.invoice);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to issue invoice.');
    } finally {
      setIssuing(false);
    }
  };

  const isDraft = invoice?.status === 'DRAFT';
  const remainingDueCents = invoice ? invoice.totalCents - invoice.amountPaidCents : 0;
  const canPay = invoice?.status === 'ISSUED' || invoice?.status === 'PARTIALLY_PAID';

  return (
    <Modal
      open={Boolean(invoiceId)}
      onClose={onClose}
      title={`Invoice ${invoice?.invoiceNumber ?? ''}`}
      description="View invoice line items, customer payment status, and the double-entry General Ledger record."
      maxWidth="max-w-2xl"
    >
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2">
          <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
          <p className="text-xs text-slate-500">Loading invoice details…</p>
        </div>
      ) : error || !invoice ? (
        <div className="p-4 rounded-lg bg-red-50 text-red-700 text-xs">
          {error ?? 'Invoice not found'}
        </div>
      ) : (
        <div className="space-y-5 mt-4 text-xs">
          {/* Header Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
            <div>
              <p className="text-slate-400">Customer</p>
              <p className="font-medium text-slate-900 mt-0.5">
                {invoice.contact?.name}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Invoice Number</p>
              <p className="font-mono font-medium text-slate-900 mt-0.5">
                {invoice.invoiceNumber}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Issue Date</p>
              <p className="text-slate-900 mt-0.5">{formatDate(invoice.issueDate)}</p>
            </div>
            <div>
              <p className="text-slate-400">Due Date</p>
              <p className="text-slate-900 mt-0.5">{formatDate(invoice.dueDate)}</p>
            </div>
          </div>

          {/* Financial Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <p className="text-slate-400">Subtotal</p>
              <p className="font-mono font-medium text-slate-900 mt-0.5">
                {formatCents(invoice.subtotalCents)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">GST (10%)</p>
              <p className="font-mono font-medium text-slate-900 mt-0.5">
                {formatCents(invoice.gstCents)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Total Invoiced</p>
              <p className="font-mono font-bold text-forest-950 mt-0.5">
                {formatCents(invoice.totalCents)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Paid to Date</p>
              <p className="font-mono font-medium text-emerald-700 mt-0.5">
                {formatCents(invoice.amountPaidCents)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Balance Due</p>
              <p className={`font-mono font-bold mt-0.5 ${remainingDueCents > 0 ? 'text-amber-800' : 'text-slate-900'}`}>
                {formatCents(remainingDueCents)}
              </p>
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
                  {invoice.lineItems?.map((li) => (
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

          {/* Payments Received History */}
          {payments.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1.5 font-medium text-slate-900">
                <CreditCard className="w-3.5 h-3.5 text-forest-700" />
                <span>Customer Payments Received ({payments.length})</span>
              </div>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3">Payment Date</th>
                      <th className="py-2 px-3">Reference / Transaction</th>
                      <th className="py-2 px-3 text-right">Amount Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 px-3 font-sans text-slate-800">
                          {formatDate(p.paymentDate)}
                        </td>
                        <td className="py-2 px-3 font-sans text-slate-600">
                          {p.reference || '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-emerald-700">
                          {formatCents(p.amountCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Draft notice or Double-Entry GL record */}
          {isDraft ? (
            <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-800 space-y-1">
              <p className="font-medium">Draft Invoice Notice</p>
              <p className="text-[11px] text-amber-700">
                This invoice is currently in DRAFT status and has not yet been posted to the General Ledger. Click &ldquo;Issue Invoice&rdquo; below to confirm issuance and post Accounts Receivable (Debit A/R 1200, Credit Revenue 4000, Credit GST Collected 2100).
              </p>
            </div>
          ) : journalEntry ? (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1.5 font-medium text-slate-900">
                <FileText className="w-3.5 h-3.5 text-forest-700" />
                <span>
                  Double-Entry Journal Entry ({journalEntry.referenceType})
                </span>
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
          ) : null}

          {/* Modal Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <Button variant="outline" onClick={onClose} disabled={issuing}>
              Close
            </Button>
            <div className="flex items-center gap-2">
              {canPay && onRecordPayment && (
                <Button
                  variant="outline"
                  onClick={() => onRecordPayment(invoice)}
                  className="inline-flex items-center gap-1.5 text-forest-800 border-forest-200 hover:bg-forest-50"
                >
                  <CreditCard className="w-3.5 h-3.5 text-forest-700" />
                  <span>Record Payment</span>
                </Button>
              )}
              {isDraft && (
                <Button
                  onClick={handleIssueInvoice}
                  disabled={issuing}
                  className="inline-flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{issuing ? 'Issuing…' : 'Issue Invoice & Post GL'}</span>
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
// Record Customer Payment In Modal
// ---------------------------------------------------------------------------

interface RecordPaymentInModalProps {
  open: boolean;
  onClose: () => void;
  invoice: Invoice;
  onPaymentRecorded: (invoice: Invoice) => void;
}

function RecordPaymentInModal({
  open,
  onClose,
  invoice,
  onPaymentRecorded,
}: RecordPaymentInModalProps) {
  const remainingCents = invoice.totalCents - invoice.amountPaidCents;
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState((remainingCents / 100).toFixed(2));
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(parsedAmountCents) || parsedAmountCents <= 0) {
      setError('Please enter a valid positive payment amount.');
      return;
    }

    if (parsedAmountCents > remainingCents) {
      setError(
        `Payment amount cannot exceed remaining balance of ${formatCents(remainingCents)}.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await invoiceApi.recordPayment(invoice.id, {
        paymentDate,
        amountCents: parsedAmountCents,
        reference: reference.trim() || null,
      });
      onPaymentRecorded(res.invoice);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to record customer payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record Customer Payment"
      description={`Record incoming payment from ${invoice.contact?.name} for invoice ${invoice.invoiceNumber}.`}
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
          label="Amount Received ($ AUD)"
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
          placeholder="e.g. Osko / Direct Deposit, Ref #9812"
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
// Receive Direct / Unallocated Payment Modal (Without or With Invoice)
// ---------------------------------------------------------------------------

interface ReceiveDirectPaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function ReceiveDirectPaymentModal({
  open,
  onClose,
  onSuccess,
}: ReceiveDirectPaymentModalProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [selectedContactId, setSelectedContactId] = useState('');

  const [customerInvoices, setCustomerInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const [allocationMode, setAllocationMode] = useState<'UNALLOCATED' | 'INVOICE'>('UNALLOCATED');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');

  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load customer contacts
  useEffect(() => {
    let mounted = true;
    setLoadingContacts(true);
    contactApi
      .list({ type: 'CUSTOMER' })
      .then((res) => {
        if (!mounted) return;
        setContacts(res.contacts);
        if (res.contacts.length > 0 && !selectedContactId) {
          setSelectedContactId(res.contacts[0].id);
        }
      })
      .catch(() => {
        if (mounted) setError('Failed to load customer list.');
      })
      .finally(() => {
        if (mounted) setLoadingContacts(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const selectedContact = useMemo(() => {
    return contacts.find((c) => c.id === selectedContactId) || null;
  }, [contacts, selectedContactId]);

  // Load open invoices for selected customer
  useEffect(() => {
    if (!selectedContactId) {
      setCustomerInvoices([]);
      return;
    }

    let mounted = true;
    setLoadingInvoices(true);
    invoiceApi
      .list()
      .then((res) => {
        if (!mounted) return;
        const openInvs = res.invoices.filter(
          (inv) =>
            inv.contactId === selectedContactId &&
            (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID'),
        );
        setCustomerInvoices(openInvs);

        if (selectedContact?.requiresInvoiceForPayment) {
          setAllocationMode('INVOICE');
          if (openInvs.length > 0) {
            setSelectedInvoiceId(openInvs[0].id);
          } else {
            setSelectedInvoiceId('');
          }
        } else {
          setAllocationMode('UNALLOCATED');
          setSelectedInvoiceId('');
        }
      })
      .catch(() => {
        if (mounted) setError('Failed to load customer invoices.');
      })
      .finally(() => {
        if (mounted) setLoadingInvoices(false);
      });

    return () => {
      mounted = false;
    };
  }, [selectedContactId, selectedContact]);

  const selectedInvoice = useMemo(() => {
    return customerInvoices.find((i) => i.id === selectedInvoiceId) || null;
  }, [customerInvoices, selectedInvoiceId]);

  const remainingCents = selectedInvoice
    ? selectedInvoice.totalCents - selectedInvoice.amountPaidCents
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedContactId) {
      setError('Please select a customer.');
      return;
    }

    const amtNum = parseFloat(amount);
    if (!amtNum || amtNum <= 0) {
      setError('Please enter a valid payment amount greater than $0.00.');
      return;
    }

    const amountCents = Math.round(amtNum * 100);

    if (selectedContact?.requiresInvoiceForPayment && allocationMode !== 'INVOICE') {
      setError(
        'This customer has requiresInvoiceForPayment policy enabled. Payments must be allocated against an issued invoice.',
      );
      return;
    }

    if (allocationMode === 'INVOICE') {
      if (!selectedInvoiceId) {
        setError('Please select an open invoice to allocate this payment against.');
        return;
      }
      if (amountCents > remainingCents) {
        setError(
          `Payment amount exceeds the invoice remaining balance (${formatCents(remainingCents)}).`,
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      await paymentInApi.create({
        contactId: selectedContactId,
        invoiceId: allocationMode === 'INVOICE' ? selectedInvoiceId : null,
        paymentDate: new Date(paymentDate).toISOString(),
        amountCents,
        reference: reference.trim() || undefined,
      });

      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to record payment in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receive Customer Payment"
      description="Record an incoming payment from a customer with direct General Ledger posting (Debit 1000 Bank, Credit 1200 AR)."
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 mt-3">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Customer Select */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Customer <span className="text-red-500">*</span>
          </label>
          {loadingContacts ? (
            <div className="h-9 bg-slate-100 animate-pulse rounded-lg" />
          ) : (
            <select
              value={selectedContactId}
              onChange={(e) => setSelectedContactId(e.target.value)}
              className="w-full h-9 px-3 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
              required
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.requiresInvoiceForPayment ? '• (Requires Invoice)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Customer Policy Note */}
        {selectedContact && (
          <div
            className={`p-2.5 rounded-lg text-xs border ${
              selectedContact.requiresInvoiceForPayment
                ? 'bg-amber-50/80 text-amber-900 border-amber-200'
                : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}
          >
            {selectedContact.requiresInvoiceForPayment ? (
              <p>
                <strong>Strict Policy Active:</strong> This customer's settings require all payments to be allocated against an issued invoice.
              </p>
            ) : (
              <p>
                <strong>Flexible Policy:</strong> This customer permits unallocated payments / direct deposits without an invoice.
              </p>
            )}
          </div>
        )}

        {/* Allocation Mode */}
        {selectedContact && !selectedContact.requiresInvoiceForPayment && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Payment Allocation
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setAllocationMode('UNALLOCATED');
                  setSelectedInvoiceId('');
                }}
                className={`py-1.5 px-3 rounded-lg border text-center transition-colors ${
                  allocationMode === 'UNALLOCATED'
                    ? 'bg-forest-900 text-white border-forest-900 font-medium'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                No Invoice (Deposit / Retainer)
              </button>
              <button
                type="button"
                onClick={() => {
                  setAllocationMode('INVOICE');
                  if (customerInvoices.length > 0 && !selectedInvoiceId) {
                    setSelectedInvoiceId(customerInvoices[0].id);
                  }
                }}
                className={`py-1.5 px-3 rounded-lg border text-center transition-colors ${
                  allocationMode === 'INVOICE'
                    ? 'bg-forest-900 text-white border-forest-900 font-medium'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Match to Open Invoice
              </button>
            </div>
          </div>
        )}

        {/* Open Invoice Select (if applicable) */}
        {(allocationMode === 'INVOICE' || selectedContact?.requiresInvoiceForPayment) && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Select Open Invoice <span className="text-red-500">*</span>
            </label>
            {loadingInvoices ? (
              <div className="h-9 bg-slate-100 animate-pulse rounded-lg" />
            ) : customerInvoices.length === 0 ? (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                This customer has no open (ISSUED or PARTIALLY_PAID) invoices.
              </div>
            ) : (
              <select
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                className="w-full h-9 px-3 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                required
              >
                {customerInvoices.map((inv) => {
                  const bal = inv.totalCents - inv.amountPaidCents;
                  return (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} — Balance Due: {formatCents(bal)} (Total: {formatCents(inv.totalCents)})
                    </option>
                  );
                })}
              </select>
            )}

            {selectedInvoice && (
              <div className="mt-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200/80 flex items-center justify-between text-xs">
                <span className="text-slate-500">Invoice Remaining Balance:</span>
                <span className="font-mono font-bold text-forest-950">
                  {formatCents(remainingCents)}
                </span>
              </div>
            )}
          </div>
        )}

        <Input
          label="Payment Date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          required
        />

        <Input
          label="Amount Received ($ AUD)"
          type="number"
          step="0.01"
          min="0.01"
          max={
            allocationMode === 'INVOICE' && remainingCents > 0
              ? (remainingCents / 100).toFixed(2)
              : undefined
          }
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />

        <Input
          label="Bank Transaction Reference (Optional)"
          placeholder="e.g. Bank remittance ref, Osko, Direct deposit"
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
          <Button
            type="submit"
            disabled={
              submitting ||
              (allocationMode === 'INVOICE' && customerInvoices.length === 0)
            }
          >
            {submitting ? 'Recording…' : 'Record Payment & Post GL'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}



// ---------------------------------------------------------------------------
// Create Quote Modal (Module 4.1)
// ---------------------------------------------------------------------------

interface CreateQuoteModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (quote: Quote) => void;
}

function CreateQuoteModal({ open, onClose, onCreated }: CreateQuoteModalProps) {
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([]);

  const [contactId, setContactId] = useState('');
  const [quoteNumber, setQuoteNumber] = useState('');
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState('');

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
      description: 'Consulting Services',
      quantity: 1,
      unitPrice: '150.00',
      taxRatePercent: 10,
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [cRes, iRes, aRes] = await Promise.all([
          contactApi.list(),
          itemApi.list(),
          accountApi.list(),
        ]);
        const custs = cRes.contacts.filter((c) => c.type === 'CUSTOMER' || c.type === 'BOTH');
        setCustomers(custs);
        if (custs.length > 0) setContactId(custs[0].id);

        setItems(iRes.items.filter((it) => it.isActive && it.isSold));
        setRevenueAccounts(aRes.accounts.filter((a) => a.type === 'REVENUE' && a.isActive));
      } catch {
        setError('Failed to load initial form data.');
      }
    }
    void loadData();
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
          unitPrice: found ? (found.salesPriceCents / 100).toFixed(2) : l.unitPrice,
          accountId: found?.salesAccountId || l.accountId,
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
      setError('Please select a customer.');
      return;
    }
    for (const l of lines) {
      if (!l.description.trim()) {
        setError('All lines must have a description.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await quoteApi.create({
        contactId,
        quoteNumber: quoteNumber.trim() || undefined,
        quoteDate,
        expiryDate: expiryDate || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description.trim(),
          quantity: l.quantity || 1,
          unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100),
          taxRatePercent: l.taxRatePercent,
          accountId: l.accountId || undefined,
        })),
      });
      onCreated(res.quote);
    } catch (err: any) {
      setError(err.message || 'Failed to create quote.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Sales Quote / Estimate" maxWidth="max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs mt-3">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Customer *</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="w-full h-8 px-2.5 rounded border border-slate-200 bg-white"
              required
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Quote Number (leave blank for auto QTE-XXXX)"
            value={quoteNumber}
            onChange={(e) => setQuoteNumber(e.target.value)}
            placeholder="Auto-generated"
            mono
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Quote Date *"
            type="date"
            value={quoteDate}
            onChange={(e) => setQuoteDate(e.target.value)}
            required
          />
          <Input
            label="Expiry Date"
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
          />
        </div>

        {/* Lines */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <p className="font-medium text-slate-900">Line Items</p>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Line
            </Button>
          </div>

          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={line.id} className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded">
                <div className="col-span-3">
                  <select
                    value={line.itemId || ''}
                    onChange={(e) => handleItemSelect(idx, e.target.value)}
                    className="w-full h-8 px-2 rounded border border-slate-200 bg-white text-[11px]"
                  >
                    <option value="">(Catalog Item)</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} - {it.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-4">
                  <input
                    type="text"
                    placeholder="Description"
                    value={line.description}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, description: val } : l)));
                    }}
                    className="w-full h-8 px-2 rounded border border-slate-200 bg-white text-[11px]"
                    required
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 1;
                      setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, quantity: val } : l)));
                    }}
                    className="w-full h-8 px-1.5 rounded border border-slate-200 bg-white text-[11px] text-center"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Price"
                    value={line.unitPrice}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, unitPrice: val } : l)));
                    }}
                    className="w-full h-8 px-2 rounded border border-slate-200 bg-white text-[11px] font-mono text-right"
                  />
                </div>
                <div className="col-span-1 text-center font-mono text-[11px] text-slate-500">
                  {line.taxRatePercent}%
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
          </div>

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
                <span>Total Quote:</span>
                <span className="font-mono">{formatCents(totals.totalCents)}</span>
              </div>
            </div>
          </div>
        </div>

        <Input
          label="Client Notes / Terms"
          placeholder="Quote valid for 30 days."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save Quote
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Quote Detail Modal (with 1-Click Convert to Invoice)
// ---------------------------------------------------------------------------

interface QuoteDetailModalProps {
  quoteId: string;
  onClose: () => void;
  onQuoteUpdated: (quote: Quote) => void;
  onConvertedToInvoice: () => void;
}

function QuoteDetailModal({
  quoteId,
  onClose,
  onQuoteUpdated,
  onConvertedToInvoice,
}: QuoteDetailModalProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await quoteApi.get(quoteId);
        setQuote(res.quote);
      } catch (err: any) {
        setError(err.message || 'Failed to load quote details.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [quoteId]);

  const handleConvert = async () => {
    if (!quote) return;
    setConverting(true);
    try {
      await quoteApi.convertToInvoice(quote.id);
      onConvertedToInvoice();
    } catch (err: any) {
      alert(err.message || 'Failed to convert quote to invoice.');
    } finally {
      setConverting(false);
    }
  };

  const handleUpdateStatus = async (status: QuoteStatus) => {
    if (!quote) return;
    try {
      const res = await quoteApi.update(quote.id, { status });
      setQuote(res.quote);
      onQuoteUpdated(res.quote);
    } catch (err: any) {
      alert(err.message || 'Failed to update quote status.');
    }
  };

  return (
    <Modal open={Boolean(quoteId)} onClose={onClose} title={`Quote ${quote?.quoteNumber ?? ''}`} maxWidth="max-w-2xl">
      {loading ? (
        <div className="py-12 flex justify-center">
          <div className="w-6 h-6 border-2 border-forest-900 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error || !quote ? (
        <div className="p-4 bg-red-50 text-red-700 text-xs">{error ?? 'Quote not found'}</div>
      ) : (
        <div className="space-y-4 text-xs mt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded">
            <div>
              <p className="text-slate-400">Customer</p>
              <p className="font-medium text-slate-900">{quote.contact?.name}</p>
            </div>
            <div>
              <p className="text-slate-400">Quote Date</p>
              <p className="text-slate-900">{formatDate(quote.quoteDate)}</p>
            </div>
            <div>
              <p className="text-slate-400">Expiry Date</p>
              <p className="text-slate-900">{formatDate(quote.expiryDate || '')}</p>
            </div>
            <div>
              <p className="text-slate-400">Status</p>
              <StatusTag variant={quote.status === 'ACCEPTED' ? 'emerald' : 'slate'}>{quote.status}</StatusTag>
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
                {quote.lines?.map((l) => (
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
            <div className="flex items-center gap-2">
              {quote.status === 'DRAFT' && (
                <Button variant="outline" size="sm" onClick={() => handleUpdateStatus('SENT')}>
                  Mark as Sent
                </Button>
              )}
              {quote.status === 'SENT' && (
                <>
                  <Button variant="outline" size="sm" onClick={() => handleUpdateStatus('ACCEPTED')}>
                    Mark as Accepted
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleUpdateStatus('DECLINED')}>
                    Mark as Declined
                  </Button>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {quote.status !== 'INVOICED' && (
                <Button onClick={handleConvert} loading={converting} className="inline-flex items-center gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Convert to Customer Invoice</span>
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
// Create Credit Note Modal (Module 4.4)
// ---------------------------------------------------------------------------

interface CreateCreditNoteModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (creditNote: CreditNote) => void;
}

function CreateCreditNoteModal({ open, onClose, onCreated }: CreateCreditNoteModalProps) {
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([]);

  const [contactId, setContactId] = useState('');
  const [creditNoteNumber, setCreditNoteNumber] = useState('');
  const [reference, setReference] = useState('');
  const [creditNoteDate, setCreditNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const [lines, setLines] = useState<Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: string;
    taxRatePercent: number;
    accountId?: string;
  }>>([
    {
      id: '1',
      description: 'Fee Adjustment / Billing Credit',
      quantity: 1,
      unitPrice: '100.00',
      taxRatePercent: 10,
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [cRes, aRes] = await Promise.all([contactApi.list(), accountApi.list()]);
        const custs = cRes.contacts.filter((c) => c.type === 'CUSTOMER' || c.type === 'BOTH');
        setCustomers(custs);
        if (custs.length > 0) setContactId(custs[0].id);
        setRevenueAccounts(aRes.accounts.filter((a) => a.type === 'REVENUE' && a.isActive));
      } catch {
        setError('Failed to load customers.');
      }
    }
    void loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!contactId) {
      setError('Please select a customer.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await creditNoteApi.create({
        contactId,
        creditNoteNumber: creditNoteNumber.trim() || `CRN-${Math.floor(1000 + Math.random() * 9000)}`,
        reference: reference.trim() || undefined,
        creditNoteDate,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          description: l.description.trim(),
          quantity: l.quantity,
          unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100),
          taxRatePercent: l.taxRatePercent,
          accountId: l.accountId || undefined,
        })),
      });
      onCreated(res.creditNote);
    } catch (err: any) {
      setError(err.message || 'Failed to create credit note.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Issue Customer Credit Note" maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs mt-3">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Customer *</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="w-full h-8 px-2.5 rounded border border-slate-200 bg-white"
              required
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <Input
            label="Credit Note Number"
            placeholder="CRN-XXXX"
            value={creditNoteNumber}
            onChange={(e) => setCreditNoteNumber(e.target.value)}
            mono
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Credit Date *"
            type="date"
            value={creditNoteDate}
            onChange={(e) => setCreditNoteDate(e.target.value)}
            required
          />
          <Input
            label="External Reference"
            placeholder="e.g. Return ref, Goodwill adjustment"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        <div className="space-y-2 pt-2 border-t">
          <p className="font-medium text-slate-900">Credit Items</p>
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
            Save & Post Credit Note
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Credit Note Detail Modal
// ---------------------------------------------------------------------------

interface CreditNoteDetailModalProps {
  creditNoteId: string;
  onClose: () => void;
  onCreditNoteUpdated: (cn: CreditNote) => void;
  onAllocate: (cn: CreditNote) => void;
}

function CreditNoteDetailModal({
  creditNoteId,
  onClose,
  onCreditNoteUpdated,
  onAllocate,
}: CreditNoteDetailModalProps) {
  const [creditNote, setCreditNote] = useState<CreditNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await creditNoteApi.get(creditNoteId);
        setCreditNote(res.creditNote);
      } catch (err: any) {
        setError(err.message || 'Failed to load credit note.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [creditNoteId]);

  const handleIssue = async () => {
    if (!creditNote) return;
    setIssuing(true);
    try {
      const res = await creditNoteApi.issue(creditNote.id);
      setCreditNote(res.creditNote);
      onCreditNoteUpdated(res.creditNote);
    } catch (err: any) {
      alert(err.message || 'Failed to issue credit note.');
    } finally {
      setIssuing(false);
    }
  };

  return (
    <Modal open={Boolean(creditNoteId)} onClose={onClose} title={`Credit Note ${creditNote?.creditNoteNumber ?? ''}`} maxWidth="max-w-2xl">
      {loading ? (
        <div className="py-12 flex justify-center">
          <div className="w-6 h-6 border-2 border-forest-900 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error || !creditNote ? (
        <div className="p-4 bg-red-50 text-red-700 text-xs">{error ?? 'Not found'}</div>
      ) : (
        <div className="space-y-4 text-xs mt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded">
            <div>
              <p className="text-slate-400">Customer</p>
              <p className="font-medium text-slate-900">{creditNote.contact?.name}</p>
            </div>
            <div>
              <p className="text-slate-400">Credit Date</p>
              <p className="text-slate-900">{formatDate(creditNote.creditNoteDate)}</p>
            </div>
            <div>
              <p className="text-slate-400">Total Credit</p>
              <p className="font-mono font-bold text-slate-900">{formatCents(creditNote.totalCents)}</p>
            </div>
            <div>
              <p className="text-slate-400">Remaining Balance</p>
              <p className="font-mono font-bold text-forest-900">{formatCents(creditNote.remainingCents)}</p>
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
                {creditNote.lines?.map((l) => (
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

          <div className="flex items-center justify-between pt-3 border-t">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <div className="flex items-center gap-2">
              {creditNote.status === 'DRAFT' && (
                <Button onClick={handleIssue} loading={issuing}>
                  Issue Credit Note & Post Contra-AR
                </Button>
              )}
              {creditNote.status === 'OPEN' && creditNote.remainingCents > 0 && (
                <Button onClick={() => onAllocate(creditNote)} className="inline-flex items-center gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Allocate to Open Invoice</span>
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
// Allocate Credit Note Modal (Module 4.4)
// ---------------------------------------------------------------------------

interface AllocateCreditNoteModalProps {
  open: boolean;
  creditNote: CreditNote;
  onClose: () => void;
  onAllocated: () => void;
}

function AllocateCreditNoteModal({
  open,
  creditNote,
  onClose,
  onAllocated,
}: AllocateCreditNoteModalProps) {
  const [openInvoices, setOpenInvoices] = useState<Invoice[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [amount, setAmount] = useState((creditNote.remainingCents / 100).toFixed(2));
  const [allocating, setAllocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadInvoices() {
      try {
        const res = await invoiceApi.list({ contactId: creditNote.contactId });
        const eligible = res.invoices.filter((inv) => inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID');
        setOpenInvoices(eligible);
        if (eligible.length > 0) setSelectedInvoiceId(eligible[0].id);
      } catch {
        setError('Failed to load eligible customer invoices.');
      }
    }
    void loadInvoices();
  }, [creditNote]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoiceId) {
      setError('Please select an open invoice.');
      return;
    }
    const amtCents = Math.round((parseFloat(amount) || 0) * 100);
    if (amtCents <= 0 || amtCents > creditNote.remainingCents) {
      setError('Invalid allocation amount.');
      return;
    }

    setAllocating(true);
    try {
      await creditNoteApi.allocate(creditNote.id, {
        invoiceId: selectedInvoiceId,
        amountCents: amtCents,
      });
      onAllocated();
    } catch (err: any) {
      setError(err.message || 'Failed to allocate credit note.');
    } finally {
      setAllocating(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Allocate Credit Note to Open Invoice" maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs mt-3">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-slate-50 p-3 rounded flex justify-between">
          <span className="text-slate-500">Available Credit Balance:</span>
          <span className="font-mono font-bold text-forest-900">{formatCents(creditNote.remainingCents)}</span>
        </div>

        <div>
          <label className="block font-medium text-slate-700 mb-1">Target Customer Invoice *</label>
          {openInvoices.length === 0 ? (
            <div className="p-2.5 bg-amber-50 text-amber-800 rounded">
              This customer has no open invoices to apply credit against.
            </div>
          ) : (
            <select
              value={selectedInvoiceId}
              onChange={(e) => setSelectedInvoiceId(e.target.value)}
              className="w-full h-8 px-2.5 rounded border border-slate-200 bg-white"
              required
            >
              {openInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — Balance: {formatCents(inv.totalCents - inv.amountPaidCents)}
                </option>
              ))}
            </select>
          )}
        </div>

        <Input
          label="Amount to Allocate ($ AUD) *"
          type="number"
          step="0.01"
          max={(creditNote.remainingCents / 100).toFixed(2)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={allocating}>
            Cancel
          </Button>
          <Button type="submit" loading={allocating} disabled={openInvoices.length === 0}>
            Apply Credit
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create Recurring Schedule Modal (Module 4.3)
// ---------------------------------------------------------------------------

interface CreateRecurringScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateRecurringScheduleModal({
  open,
  onClose,
  onCreated,
}: CreateRecurringScheduleModalProps) {
  const [customers, setCustomers] = useState<Contact[]>([]);
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
        const custs = res.contacts.filter((c) => c.type === 'CUSTOMER' || c.type === 'BOTH');
        setCustomers(custs);
        if (custs.length > 0) setContactId(custs[0].id);
      } catch {
        setError('Failed to load customers.');
      }
    }
    void load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !contactId) {
      setError('Please provide a schedule name and customer.');
      return;
    }

    setSubmitting(true);
    try {
      await recurringInvoiceApi.create({
        name: name.trim(),
        contactId,
        frequency,
        startDate,
        autoPost,
        templateData: {
          lineItems: [
            {
              description: `${name.trim()} - Periodic Retainer`,
              amountCents: 150000,
              taxTreatment: 'TAX_EXCLUSIVE',
            },
          ],
        },
      });
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Failed to create schedule.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Recurring Invoice Schedule" maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs mt-3">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Input
          label="Schedule Name *"
          placeholder="Monthly Cloud Retainer"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div>
          <label className="block font-medium text-slate-700 mb-1">Customer *</label>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="w-full h-8 px-2.5 rounded border border-slate-200 bg-white"
            required
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
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
            id="autoPost"
            checked={autoPost}
            onChange={(e) => setAutoPost(e.target.checked)}
            className="rounded border-slate-300 text-forest-900 focus:ring-forest-900"
          />
          <label htmlFor="autoPost" className="text-slate-700 select-none">
            Auto-Issue and post to GL upon schedule trigger
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
