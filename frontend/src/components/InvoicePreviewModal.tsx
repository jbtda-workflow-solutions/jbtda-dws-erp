import React from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Building2, Landmark, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusTag } from '@/components/ui/StatusTag';
import { type Invoice } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';

interface InvoicePreviewModalProps {
  open: boolean;
  onClose: () => void;
  invoice: Invoice;
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

export function InvoicePreviewModal({
  open,
  onClose,
  invoice,
}: InvoicePreviewModalProps) {
  const { organization } = useAuth();

  if (!open) return null;

  const isDraft = invoice.status === 'DRAFT';
  const remainingDueCents = invoice.totalCents - invoice.amountPaidCents;

  const handlePrint = () => {
    window.print();
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
              Tax Invoice Preview — {invoice.invoiceNumber}
            </h3>
            {isDraft && (
              <span className="text-[11px] font-mono text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded">
                Draft Mode
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
          {/* Printable Document Sheet (A4 Landscape aspect ratio: 297mm x 210mm) */}
          <div
            id="invoice-print-sheet"
            className="printable-invoice bg-white w-full max-w-[1100px] shadow-lg border border-slate-300 p-8 text-slate-800 text-xs relative flex flex-col justify-between min-h-[640px]"
          >
            {/* Draft Watermark for Compliance */}
            {isDraft && (
              <div className="draft-watermark pointer-events-none absolute inset-0 flex items-center justify-center opacity-10 select-none z-0">
                <span className="text-6xl sm:text-8xl font-black text-rose-700 uppercase -rotate-12 tracking-widest border-8 border-rose-700 p-8 rounded-2xl">
                  DRAFT — NOT A TAX INVOICE
                </span>
              </div>
            )}

            <div className="relative z-10 space-y-6">
              {/* Header: Issuer Details (Left) vs Invoice Meta (Right) */}
              <div className="grid grid-cols-12 gap-6 pb-6 border-b-2 border-slate-900">
                <div className="col-span-7 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-forest-900 shrink-0" />
                    <h1 className="text-xl font-bold tracking-tight text-slate-950 uppercase">
                      {organization?.tradingName || organization?.legalName || organization?.name || 'Enterprise'}
                    </h1>
                  </div>
                  {organization?.legalName && organization.legalName !== organization.tradingName && (
                    <p className="text-slate-600 font-medium">
                      {organization.legalName}
                    </p>
                  )}
                  <p className="font-mono text-slate-700">
                    <span className="font-semibold text-slate-900">ABN:</span>{' '}
                    {formatABN(organization?.abn)}
                  </p>
                  {(organization?.addressLine1 || organization?.city) && (
                    <p className="text-slate-600">
                      {[
                        organization?.addressLine1,
                        organization?.addressLine2,
                        organization?.city,
                        organization?.state,
                        organization?.postcode,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  )}
                  {(organization?.email || organization?.phone) && (
                    <p className="text-slate-500 text-[11px]">
                      {[organization?.email, organization?.phone].filter(Boolean).join(' • ')}
                    </p>
                  )}
                </div>

                <div className="col-span-5 text-right space-y-1">
                  <h2 className="text-2xl font-black tracking-tight text-slate-950 uppercase">
                    {isDraft ? 'INVOICE (DRAFT)' : 'TAX INVOICE'}
                  </h2>
                  <div className="pt-1 space-y-0.5 font-mono text-xs">
                    <p>
                      <span className="font-sans text-slate-500">Invoice No:</span>{' '}
                      <span className="font-bold text-slate-900">{invoice.invoiceNumber}</span>
                    </p>
                    <p>
                      <span className="font-sans text-slate-500">Issue Date:</span>{' '}
                      <span className="text-slate-900">{formatDate(invoice.issueDate)}</span>
                    </p>
                    <p>
                      <span className="font-sans text-slate-500">Due Date:</span>{' '}
                      <span className="font-bold text-slate-900">{formatDate(invoice.dueDate)}</span>
                    </p>
                    <div className="pt-1 flex justify-end">
                      <StatusTag label={invoice.status.replace(/_/g, ' ')} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bill To Customer Information Card */}
              <div className="grid grid-cols-12 gap-6 bg-slate-50/80 p-3.5 rounded border border-slate-200">
                <div className="col-span-7 space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
                    BILL TO (CUSTOMER)
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {invoice.contact?.name || 'Customer'}
                  </p>
                  {invoice.contact?.abn && (
                    <p className="font-mono text-slate-700">
                      <span className="text-slate-500 font-sans">ABN:</span> {formatABN(invoice.contact.abn)}
                    </p>
                  )}
                  {invoice.contact?.email && (
                    <p className="text-slate-600">{invoice.contact.email}</p>
                  )}
                </div>

                <div className="col-span-5 text-right space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
                    PAYMENT TERMS & STATUS
                  </p>
                  <p className="text-xs text-slate-800">
                    Net {invoice.contact?.paymentTermsDays ?? 14} Days
                  </p>
                  <p className="font-mono text-xs font-semibold text-slate-900">
                    Amount Due:{' '}
                    <span className={remainingDueCents > 0 ? 'text-amber-800 font-bold' : 'text-emerald-700'}>
                      {formatCents(remainingDueCents)}
                    </span>
                  </p>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="border border-slate-300 rounded overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 text-slate-700 border-b border-slate-300 text-[11px] uppercase tracking-wider font-semibold">
                    <tr>
                      <th className="py-2 px-3 w-10 text-center">#</th>
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3 text-center w-16">Qty</th>
                      <th className="py-2 px-3 text-right w-24">Unit Price</th>
                      <th className="py-2 px-3 text-center w-28">Tax Rate</th>
                      <th className="py-2 px-3 text-right w-28">Subtotal</th>
                      <th className="py-2 px-3 text-right w-24">GST (10%)</th>
                      <th className="py-2 px-3 text-right w-28">Total AUD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {invoice.lineItems?.map((li, idx) => (
                      <tr key={li.id} className="hover:bg-slate-50/50">
                        <td className="py-2 px-3 text-center font-mono text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          {li.description}
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-800">
                          {li.quantity || 1}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700">
                          {li.unitPriceCents != null
                            ? formatCents(li.unitPriceCents)
                            : formatCents(Math.round(li.amountCents / (li.quantity || 1)))}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-600 text-[11px]">
                          {li.taxTreatment === 'TAX_EXCLUSIVE'
                            ? '10% Excl.'
                            : li.taxTreatment === 'TAX_INCLUSIVE'
                              ? '10% Incl.'
                              : '0% Free'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700">
                          {formatCents(li.amountCents)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700">
                          {formatCents(li.gstCents)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold text-slate-950">
                          {formatCents(li.totalCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom Section: Remittance Slip (Left) & Financial Totals (Right) */}
            <div className="relative z-10 pt-6 mt-6 border-t-2 border-slate-900 grid grid-cols-12 gap-6">
              {/* Australian EFT Remittance Advice */}
              <div className="col-span-7 bg-slate-50 p-3.5 rounded border border-slate-200 space-y-2">
                <div className="flex items-center gap-1.5 text-forest-900 font-semibold text-xs uppercase tracking-wider">
                  <Landmark className="w-3.5 h-3.5" />
                  <span>How to Pay — Direct Electronic Funds Transfer (EFT)</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500">Account Name:</span>
                    <p className="font-semibold text-slate-900">
                      {organization?.bankAccountName || organization?.tradingName || organization?.legalName || 'Trading Account'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Payment Reference:</span>
                    <p className="font-mono font-bold text-forest-950">
                      {invoice.invoiceNumber}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">BSB Number:</span>
                    <p className="font-mono font-bold text-slate-900">
                      {organization?.bankBsb || '— (Add in Settings)'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Account Number:</span>
                    <p className="font-mono font-bold text-slate-900">
                      {organization?.bankAccountNumber || '— (Add in Settings)'}
                    </p>
                  </div>
                </div>
                {invoice.notes && (
                  <p className="text-[11px] text-slate-600 pt-1 border-t border-slate-200 italic">
                    Note: {invoice.notes}
                  </p>
                )}
              </div>

              {/* Financial Totals Calculation Box */}
              <div className="col-span-5 bg-white p-3 rounded border border-slate-300 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-slate-600 font-sans">
                  <span>Subtotal (excl. GST):</span>
                  <span className="font-mono font-medium text-slate-900">
                    {formatCents(invoice.subtotalCents)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 font-sans">
                  <span>Australian GST (10%):</span>
                  <span className="font-mono font-medium text-slate-900">
                    {formatCents(invoice.gstCents)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-950 font-bold text-sm pt-1.5 border-t-2 border-slate-900">
                  <span className="font-sans">Total Invoiced:</span>
                  <span className="font-mono text-forest-950">
                    {formatCents(invoice.totalCents)}
                  </span>
                </div>
                {invoice.amountPaidCents > 0 && (
                  <div className="flex justify-between text-emerald-700 font-sans pt-1">
                    <span>Less Amount Paid:</span>
                    <span className="font-mono font-medium">
                      -{formatCents(invoice.amountPaidCents)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-900 font-bold text-sm pt-1.5 border-t border-slate-200">
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
          /* Hide everything except the printable invoice sheet */
          body * {
            visibility: hidden;
          }
          #invoice-print-sheet,
          #invoice-print-sheet * {
            visibility: visible;
          }
          #invoice-print-sheet {
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
