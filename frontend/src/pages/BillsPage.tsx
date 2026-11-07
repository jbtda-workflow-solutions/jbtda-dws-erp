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
} from 'lucide-react';
import {
  billApi,
  contactApi,
  type Bill,
  type BillStatus,
  type TaxTreatment,
  type Contact,
  type PaymentOut,
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

export function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | BillStatus>('ALL');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);

  const fetchBills = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await billApi.list();
      setBills(res.bills);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load bills. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchBills();
  }, []);

  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      const matchesStatus =
        statusFilter === 'ALL' || b.status === statusFilter;

      const q = search.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        (b.reference && b.reference.toLowerCase().includes(q)) ||
        (b.contact && b.contact.name.toLowerCase().includes(q));

      return matchesStatus && matchesSearch;
    });
  }, [bills, statusFilter, search]);

  const handleBillCreated = (newBill: Bill) => {
    setBills((prev) => [newBill, ...prev]);
    setIsCreateModalOpen(false);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-slate-900">
            Bills
          </h1>
          <p className="text-sm font-light text-slate-500 mt-1">
            Accounts Payable — Record vendor bills and post automatically to the General Ledger.
          </p>
        </div>
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>New Bill</span>
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by vendor name or reference…"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-forest-900 focus:border-transparent font-light"
          />
        </div>

        <div className="flex items-center bg-slate-100 p-1 rounded-lg self-start sm:self-auto text-xs font-medium text-slate-600">
          {(['ALL', 'AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID'] as const).map(
            (st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  statusFilter === st
                    ? 'bg-white text-forest-950 shadow-sm'
                    : 'hover:text-slate-900'
                }`}
              >
                {st === 'ALL'
                  ? 'All'
                  : st === 'AWAITING_PAYMENT'
                  ? 'Awaiting Payment'
                  : st === 'PARTIALLY_PAID'
                  ? 'Partially Paid'
                  : 'Paid'}
              </button>
            ),
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Bills Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
            <p className="text-sm font-light text-slate-500">Loading bills…</p>
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="py-20 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-forest-50 flex items-center justify-center mx-auto mb-4">
              <FileSpreadsheet className="w-5 h-5 text-forest-700" />
            </div>
            <p className="text-base font-medium text-slate-800">No bills found</p>
            <p className="text-sm font-light text-slate-400 mt-1 max-w-sm mx-auto">
              {search || statusFilter !== 'ALL'
                ? 'Try adjusting your search query or filter.'
                : 'Get started by recording a vendor bill with line items and automatic GST posting.'}
            </p>
            {!search && statusFilter === 'ALL' && (
              <Button onClick={() => setIsCreateModalOpen(true)} className="mt-4">
                Record First Bill
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="py-3.5 px-4 lg:px-6">Vendor</th>
                  <th className="py-3.5 px-4">Reference</th>
                  <th className="py-3.5 px-4">Issue Date</th>
                  <th className="py-3.5 px-4">Due Date</th>
                  <th className="py-3.5 px-4 text-right">Subtotal</th>
                  <th className="py-3.5 px-4 text-right">GST</th>
                  <th className="py-3.5 px-4 text-right">Total</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 lg:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-light text-slate-700">
                {filteredBills.map((b) => (
                  <tr
                    key={b.id}
                    className="hover:bg-slate-50/75 transition-colors"
                  >
                    <td className="py-3.5 px-4 lg:px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-forest-50 flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4 text-forest-800" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">
                            {b.contact?.name ?? 'Unknown Vendor'}
                          </p>
                          {b.contact?.email && (
                            <p className="text-xs text-slate-400">
                              {b.contact.email}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-700">
                      {b.reference ?? '—'}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600">
                      {formatDate(b.issueDate)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600">
                      {formatDate(b.dueDate)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-600">
                      {formatCents(b.subtotalCents)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-600">
                      {formatCents(b.gstCents)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-xs font-medium text-slate-900">
                      {formatCents(b.totalCents)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <BillStatusBadge status={b.status} />
                    </td>
                    <td className="py-3.5 px-4 lg:px-6 text-right">
                      <button
                        onClick={() => setSelectedBillId(b.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
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
        <CreateBillModal
          open={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={handleBillCreated}
        />
      )}

      {/* Detail Modal */}
      {selectedBillId && (
        <BillDetailModal
          billId={selectedBillId}
          onClose={() => setSelectedBillId(null)}
          onBillUpdated={(updated) => {
            setBills((prev) =>
              prev.map((b) => (b.id === updated.id ? updated : b)),
            );
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
    case 'AWAITING_PAYMENT':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full">
          <Clock className="w-3 h-3" />
          <span>Awaiting Payment</span>
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
// Create Bill Modal
// ---------------------------------------------------------------------------

interface LineItemDraft {
  id: string;
  description: string;
  amount: string; // user typed dollars string e.g. "100.00"
  taxTreatment: TaxTreatment;
}

interface CreateBillModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (bill: Bill) => void;
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

