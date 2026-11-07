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
} from 'lucide-react';
import {
  invoiceApi,
  contactApi,
  type Invoice,
  type InvoiceStatus,
  type TaxTreatment,
  type Contact,
  type PaymentIn,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | InvoiceStatus>('ALL');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);

  const fetchInvoices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoiceApi.list();
      setInvoices(res.invoices);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load invoices. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchInvoices();
  }, []);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const matchesStatus =
        statusFilter === 'ALL' || inv.status === statusFilter;

      const q = search.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        (inv.contact && inv.contact.name.toLowerCase().includes(q));

      return matchesStatus && matchesSearch;
    });
  }, [invoices, statusFilter, search]);

  const handleInvoiceCreated = (newInvoice: Invoice) => {
    setInvoices((prev) => [newInvoice, ...prev]);
    setIsCreateModalOpen(false);
  };

  const handleInvoiceUpdated = (updated: Invoice) => {
    setInvoices((prev) =>
      prev.map((i) => (i.id === updated.id ? updated : i)),
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-slate-900">
            Invoices
          </h1>
          <p className="text-sm font-light text-slate-500 mt-1">
            Accounts Receivable — Create customer invoices and post automatically to the General Ledger upon issuance.
          </p>
        </div>
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>New Invoice</span>
        </Button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by invoice # or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-forest-900"
          />
        </div>

        {/* Status Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {(['ALL', 'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const).map(
            (status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === status
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

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Invoices Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
            <p className="text-xs">Loading customer invoices…</p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-forest-50 flex items-center justify-center mb-3">
              <FileSpreadsheet className="w-6 h-6 text-forest-800" />
            </div>
            <p className="text-sm font-medium text-slate-800">
              No customer invoices found
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              {search || statusFilter !== 'ALL'
                ? 'Try adjusting your search query or status filter.'
                : 'Create customer invoices to bill clients and automatically post accounts receivable.'}
            </p>
            {!search && statusFilter === 'ALL' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreateModalOpen(true)}
                className="mt-4"
              >
                Create your first invoice
              </Button>
            )}
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
                  <tr
                    key={inv.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
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
                            <p className="text-[11px] text-slate-400">
                              {inv.contact.email}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {formatDate(inv.issueDate)}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {formatDate(inv.dueDate)}
                    </td>
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

      {/* Create Modal */}
      {isCreateModalOpen && (
        <CreateInvoiceModal
          open={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={handleInvoiceCreated}
        />
      )}

      {/* Detail Modal */}
      {selectedInvoiceId && (
        <InvoiceDetailModal
          invoiceId={selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          onInvoiceUpdated={handleInvoiceUpdated}
          onRecordPayment={(inv) => {
            setSelectedInvoiceId(null);
            setPaymentInvoice(inv);
          }}
        />
      )}

      {/* Record Payment Modal */}
      {paymentInvoice && (
        <RecordPaymentInModal
          open={Boolean(paymentInvoice)}
          onClose={() => setPaymentInvoice(null)}
          invoice={paymentInvoice}
          onPaymentRecorded={(updatedInv) => {
            handleInvoiceUpdated(updatedInv);
            setPaymentInvoice(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  switch (status) {
    case 'DRAFT':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full">
          <span>Draft</span>
        </span>
      );
    case 'ISSUED':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full">
          <Clock className="w-3 h-3" />
          <span>Issued</span>
        </span>
      );
    case 'PARTIALLY_PAID':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full">
          <span>Partially Paid</span>
        </span>
      );
    case 'PAID':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
          <CheckCircle2 className="w-3 h-3" />
          <span>Paid</span>
        </span>
      );
    case 'VOID':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
          <span>Void</span>
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Create Invoice Modal
// ---------------------------------------------------------------------------

interface LineItemDraft {
  id: string;
  description: string;
  amount: string;
  taxTreatment: TaxTreatment;
}

interface CreateInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (invoice: Invoice) => void;
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

