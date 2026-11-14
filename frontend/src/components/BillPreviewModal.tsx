import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Building2, Landmark, AlertCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusTag } from '@/components/ui/StatusTag';
import {
  type Bill,
  type Account,
  type TrackingCategory,
  accountApi,
} from '@/api/client';
import { useAuth } from '@/hooks/useAuth';

interface BillPreviewModalProps {
  open: boolean;
  onClose: () => void;
  bill: Bill;
  accounts?: Array<{ id: string; code: string; name: string }>;
  trackingCategories?: TrackingCategory[];
}

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

function formatABN(raw?: string | null): string {
  if (!raw) return '—';
  const clean = raw.replace(/\D/g, '');
  if (clean.length === 11) {
    return `${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5, 8)} ${clean.slice(8, 11)}`;
  }
  return raw;
}

function formatBSB(raw?: string | null): string {
  if (!raw) return '—';
  const clean = raw.replace(/\D/g, '');
  if (clean.length === 6) {
    return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`;
  }
  return raw;
}

export function BillPreviewModal({
  open,
  onClose,
  bill,
  accounts: propAccounts,
  trackingCategories: propTrackingCategories,
}: BillPreviewModalProps) {
  const { organization } = useAuth();
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name: string }>>(
    propAccounts || []
  );
  const [trackingCategories, setTrackingCategories] = useState<TrackingCategory[]>(
    propTrackingCategories || []
  );

  useEffect(() => {
    if (propAccounts) setAccounts(propAccounts);
  }, [propAccounts]);

  useEffect(() => {
    if (propTrackingCategories) setTrackingCategories(propTrackingCategories);
  }, [propTrackingCategories]);

  useEffect(() => {
    if (!open) return;
    if (propAccounts && propTrackingCategories) return;
    async function loadMetadata() {
      try {
        const [aRes, tRes] = await Promise.all([
          !propAccounts ? accountApi.list() : Promise.resolve({ accounts: [] }),
          !propTrackingCategories ? accountApi.listTrackingCategories() : Promise.resolve({ categories: [] }),
        ]);
        if (!propAccounts && aRes.accounts) {
          setAccounts(aRes.accounts);
        }
        if (!propTrackingCategories && tRes.categories) {
          setTrackingCategories(tRes.categories);
        }
      } catch {
        // Silently tolerate if metadata fetch fails
      }
    }
    void loadMetadata();
  }, [open, propAccounts, propTrackingCategories]);

  if (!open) return null;

  const isDraft = bill.status === 'DRAFT' || bill.status === 'PENDING_APPROVAL';
  const remainingDueCents = bill.totalCents - bill.amountPaidCents;

  const handlePrint = () => {
    window.print();
  };

  const getAccountLabel = (accountId?: string | null) => {
    if (!accountId) return '—';
    const acct = accounts.find((a) => a.id === accountId);
    return acct ? `${acct.code} - ${acct.name}` : '—';
  };

  const getTrackingLabel = (optionId?: string | null) => {
    if (!optionId) return '—';
    for (const cat of trackingCategories) {
      const opt = cat.options.find((o) => o.id === optionId);
      if (opt) return opt.name;
    }
    return '—';
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 !mt-0 flex items-center justify-center p-2 sm:p-4 bg-obsidian-950/70 backdrop-blur-[2px] overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-6xl bg-slate-100 rounded-md shadow-2xl border border-slate-300 flex flex-col max-h-[96vh] overflow-hidden my-auto">
        {/* Top Control Bar (Screen Only - Hidden in Print) */}
        <div className="no-print px-5 py-3 bg-obsidian-950 text-white flex items-center justify-between border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-forest-900 text-emerald-300 border border-emerald-500/30">
              Landscape A4
            </span>
            <h3 className="text-sm font-medium tracking-tight">
              Vendor Bill & Remittance Voucher — {bill.billNumber || bill.reference || 'Bill'}
            </h3>
            {isDraft && (
              <span className="text-[11px] font-mono text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded">
                Draft / Pending Approval
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handlePrint}
              size="sm"
              className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save PDF (Landscape A4)</span>
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors ml-2"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Viewport for Screen Viewing */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex justify-center bg-slate-200/80">
          {/* Print Sheet Document */}
          <div
            id="bill-print-sheet"
            className="bg-white text-slate-900 shadow-xl border border-slate-300 p-8 sm:p-10 w-full max-w-[297mm] min-h-[210mm] flex flex-col justify-between font-sans relative"
            style={{ boxSizing: 'border-box' }}
          >
            {/* Watermark for Draft Bills */}
            {isDraft && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-0 overflow-hidden"
                aria-hidden="true"
              >
                <div className="transform -rotate-25 text-red-500/10 font-mono text-7xl sm:text-8xl font-black tracking-widest border-8 border-red-500/10 px-12 py-6 rounded-2xl uppercase">
                  DRAFT VOUCHER
                </div>
              </div>
            )}

            <div className="relative z-10 space-y-6">
              {/* Header: Supplier Info & Document Meta */}
              <div className="flex justify-between items-start border-b-2 border-slate-900 pb-5">
                {/* Left: Supplier / Vendor */}
                <div className="space-y-1.5 max-w-md">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-forest-800 shrink-0" />
                    <h1 className="text-xl font-bold tracking-tight text-slate-950 font-mono">
                      {bill.contact?.name || 'Vendor / Supplier'}
                    </h1>
                  </div>
                  <div className="text-xs text-slate-600 space-y-0.5">
                    <p className="font-mono">
                      <span className="font-semibold text-slate-700">ABN: </span>
                      {formatABN(bill.contact?.abn)}
                    </p>
                    {bill.contact?.email && (
                      <p>
                        <span className="font-semibold text-slate-700">Email: </span>
                        {bill.contact.email}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: Document Identification */}
                <div className="text-right space-y-1">
                  <h2 className="text-2xl font-black tracking-tight text-slate-950 font-mono uppercase">
                    VENDOR BILL VOUCHER
                  </h2>
                  <div className="inline-block mt-0.5">
                    <StatusTag
                      tone={
                        bill.status === 'PAID'
                          ? 'emerald'
                          : bill.status === 'AWAITING_PAYMENT'
                            ? 'neutral'
                            : bill.status === 'PARTIALLY_PAID'
                              ? 'amber'
                              : 'rose'
                      }
                      label={bill.status.replace(/_/g, ' ')}
                    />
                  </div>
                  <div className="text-xs text-slate-600 font-mono space-y-0.5 pt-1">
                    <p>
                      <span className="font-sans font-semibold text-slate-700">Vendor Ref: </span>
                      <span className="font-bold text-slate-900">{bill.reference || '—'}</span>
                    </p>
                    {bill.billNumber && (
                      <p>
                        <span className="font-sans font-semibold text-slate-700">Internal Bill #: </span>
                        <span>{bill.billNumber}</span>
                      </p>
                    )}
                    <p>
                      <span className="font-sans font-semibold text-slate-700">Issue Date: </span>
                      <span>{formatDate(bill.issueDate)}</span>
                    </p>
                    <p>
                      <span className="font-sans font-semibold text-slate-700">Due Date: </span>
                      <span className="font-bold text-slate-900">{formatDate(bill.dueDate)}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Purchaser / Organization Card */}
              <div className="bg-slate-50 border border-slate-200 rounded p-4 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-[10px] font-mono uppercase font-bold text-slate-400 tracking-wider">
                    Purchaser / Billed To
                  </p>
                  <p className="font-bold text-slate-900 text-sm mt-0.5 font-mono">
                    {organization?.name || 'Company Name'}
                  </p>
                  {organization?.legalName && organization.legalName !== organization.name && (
                    <p className="text-slate-600 italic text-[11px]">{organization.legalName}</p>
                  )}
                  <p className="font-mono text-slate-700 mt-1">
                    <span className="font-semibold">ABN: </span>
                    {formatABN(organization?.abn)}
                  </p>
                </div>
                <div className="space-y-0.5 text-right font-mono text-[11px] text-slate-600">
                  {(organization?.addressLine1 || organization?.city) && (
                    <p className="font-sans">
                      {[
                        organization.addressLine1,
                        organization.addressLine2,
                        organization.city,
                        organization.state,
                        organization.postcode,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  )}
                  {organization?.email && <p>Email: {organization.email}</p>}
                  {organization?.phone && <p>Phone: {organization.phone}</p>}
                </div>
              </div>

              {/* Wide Landscape Line Items Schedule */}
              <div className="border border-slate-300 rounded overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-900 text-white font-mono text-[11px] uppercase">
                    <tr>
                      <th className="py-2.5 px-3 w-10 text-center">#</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3">Account Code</th>
                      <th className="py-2.5 px-3">Cost Center</th>
                      <th className="py-2.5 px-3 text-right w-16">Qty</th>
                      <th className="py-2.5 px-3 text-right w-24">Unit Price</th>
                      <th className="py-2.5 px-3 text-right w-20">Tax</th>
                      <th className="py-2.5 px-3 text-right w-24">Subtotal</th>
                      <th className="py-2.5 px-3 text-right w-20">GST</th>
                      <th className="py-2.5 px-3 text-right w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {bill.lineItems && bill.lineItems.length > 0 ? (
                      bill.lineItems.map((item, idx) => {
                        const qty = item.quantity || 1;
                        const unitPriceCents =
                          item.unitPriceCents !== undefined && item.unitPriceCents > 0
                            ? Number(item.unitPriceCents)
                            : Math.round(Number(item.amountCents) / qty);
                        return (
                          <tr key={item.id} className={idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'}>
                            <td className="py-2 px-3 text-center font-mono text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-3 text-slate-900 font-medium">
                              {item.description}
                            </td>
                            <td className="py-2 px-3 text-slate-700 font-mono text-[11px]">
                              {getAccountLabel(item.accountId)}
                            </td>
                            <td className="py-2 px-3 text-slate-700 font-sans text-[11px]">
                              {getTrackingLabel(item.trackingOptionId)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-700">
                              {qty}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-700">
                              {formatCents(unitPriceCents)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-600 text-[10px]">
                              {item.taxTreatment === 'TAX_EXCLUSIVE'
                                ? 'GST (10%)'
                                : item.taxTreatment === 'TAX_INCLUSIVE'
                                  ? 'GST (Incl)'
                                  : 'GST-Free'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-700">
                              {formatCents(Number(item.amountCents))}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-700">
                              {formatCents(Number(item.gstCents))}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-slate-950">
                              {formatCents(Number(item.totalCents))}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={10} className="py-4 text-center text-slate-400">
                          No line items recorded on this bill.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom Section: Vendor Remittance Details & Financial Totals */}
            <div className="relative z-10 pt-6 border-t-2 border-slate-900 grid grid-cols-12 gap-6 items-start mt-6">
              {/* Vendor EFT Remittance Advice & Banking Details */}
              <div className="col-span-7 bg-slate-50 border border-slate-200 rounded p-4 space-y-2.5">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                  <Landmark className="w-4 h-4 text-forest-800" />
                  <h4 className="font-mono font-bold text-xs uppercase tracking-wider text-slate-900">
                    Vendor EFT Remittance Advice
                  </h4>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono">
                  <div>
                    <span className="text-slate-500 font-sans block text-[11px]">Payee Name:</span>
                    <span className="font-semibold text-slate-900">{bill.contact?.name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[11px]">Payment Reference:</span>
                    <span className="font-semibold text-slate-900 font-mono">
                      {bill.reference || bill.billNumber || bill.id.slice(0, 8)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[11px]">BSB:</span>
                    <span className="font-bold text-slate-900 font-mono">
                      {formatBSB(bill.contact?.bsb)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block text-[11px]">Account Number:</span>
                    <span className="font-bold text-slate-900 font-mono">
                      {bill.contact?.bankAccountNumber || '—'}
                    </span>
                  </div>
                </div>

                {bill.paymentsOut && bill.paymentsOut.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 text-[11px]">
                    <span className="font-semibold text-slate-700 block mb-1">
                      Payment History ({bill.paymentsOut.length} disbursement{bill.paymentsOut.length > 1 ? 's' : ''}):
                    </span>
                    <div className="space-y-0.5 font-mono text-slate-600">
                      {bill.paymentsOut.map((p) => (
                        <div key={p.id} className="flex justify-between">
                          <span>{formatDate(p.paymentDate)} {p.reference ? `(${p.reference})` : ''}</span>
                          <span className="font-semibold text-emerald-700">{formatCents(p.amountCents)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {bill.notes && (
                  <p className="text-[11px] text-slate-600 pt-1 border-t border-slate-200 italic">
                    Note: {bill.notes}
                  </p>
                )}
              </div>

              {/* Financial Totals Calculation Box */}
              <div className="col-span-5 bg-white p-4 rounded border border-slate-300 space-y-1.5 text-xs font-mono shadow-sm">
                <div className="flex justify-between text-slate-600 font-sans">
                  <span>Subtotal (excl. GST):</span>
                  <span className="font-mono font-medium text-slate-900">
                    {formatCents(bill.subtotalCents)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 font-sans">
                  <span>Australian GST (10%):</span>
                  <span className="font-mono font-medium text-slate-900">
                    {formatCents(bill.gstCents)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-950 font-bold text-sm pt-2 border-t-2 border-slate-900">
                  <span className="font-sans">Total Bill Payable:</span>
                  <span className="font-mono text-forest-950">
                    {formatCents(bill.totalCents)}
                  </span>
                </div>
                {bill.amountPaidCents > 0 && (
                  <div className="flex justify-between text-emerald-700 font-sans pt-1">
                    <span>Less Amount Paid:</span>
                    <span className="font-mono font-medium">
                      -{formatCents(bill.amountPaidCents)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-900 font-bold text-sm pt-2 border-t border-slate-200">
                  <span className="font-sans">Balance Due (AUD):</span>
                  <span className={`font-mono ${remainingDueCents > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>
                    {formatCents(remainingDueCents)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Global CSS Print Styles injected strictly for this component */}
      <style>{`
        @media print {
          /* Hide everything except the printable bill sheet */
          body * {
            visibility: hidden;
          }
          #bill-print-sheet,
          #bill-print-sheet * {
            visibility: visible;
          }
          #bill-print-sheet {
            position: fixed;
            left: 0;
            top: 0;
            width: 100vw;
            height: 100vh;
            max-width: none !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 10mm 15mm !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A4 landscape;
            margin: 8mm;
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}
