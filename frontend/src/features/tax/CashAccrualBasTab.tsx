import { useState, useEffect } from 'react';
import { RefreshCw, Printer } from 'lucide-react';
import { taxCloseApi, type BasBasisResponse, ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';

function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}$${(abs / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function CashAccrualBasTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [basis, setBasis] = useState<'CASH' | 'ACCRUAL'>('CASH');
  const [startDate, setStartDate] = useState(`${today.slice(0, 4)}-07-01`);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState<BasBasisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBas = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await taxCloseApi.getBasBasis({ basis, startDate, endDate });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to compute BAS worksheet.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBas();
  }, [basis, startDate, endDate]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-white p-3.5 flex flex-col lg:flex-row lg:items-end justify-between gap-3 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              ATO Accounting Basis
            </label>
            <div className="inline-flex rounded border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setBasis('CASH')}
                className={`px-3 py-1.5 rounded font-medium transition-colors ${
                  basis === 'CASH'
                    ? 'bg-forest-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Cash Basis
              </button>
              <button
                type="button"
                onClick={() => setBasis('ACCRUAL')}
                className={`px-3 py-1.5 rounded font-medium transition-colors ${
                  basis === 'ACCRUAL'
                    ? 'bg-forest-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Accrual Basis
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void loadBas()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Recalculate
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5 mr-1.5" />
            Print BAS Worksheet
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {data && (
        <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-slate-900">
                ATO Business Activity Statement — {data.basis === 'CASH' ? 'Cash Basis' : 'Accrual Basis'}
              </h2>
              <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                {data.period.startDate} to {data.period.endDate} ·{' '}
                {data.basis === 'CASH'
                  ? 'Recognizes GST on actual payment receipt/disbursement dates'
                  : 'Recognizes GST on invoice/bill issue dates'}
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            {[
              { code: 'G1', label: 'Total Sales (including any GST)', val: data.boxes.g1TotalSalesCents },
              { code: 'G3', label: 'Other GST-Free Sales', val: data.boxes.g3GstFreeSalesCents },
              { code: 'G11', label: 'Non-Capital Purchases', val: data.boxes.g11NonCapitalPurchasesCents },
              { code: '1A', label: 'GST on Sales (Payable to ATO)', val: data.boxes.box1aGstOnSalesCents, bold: true },
              { code: '1B', label: 'GST on Purchases (Input Tax Credits)', val: data.boxes.box1bGstOnPurchasesCents, bold: true },
              {
                code: 'NET',
                label:
                  data.boxes.netGstPayableCents >= 0
                    ? 'Net GST Payable to ATO (1A - 1B)'
                    : 'Net GST Refundable from ATO (1A - 1B)',
                val: data.boxes.netGstPayableCents,
                highlight: true,
              },
            ].map((row) => (
              <div
                key={row.code}
                className={`px-4 py-3 flex items-center justify-between gap-3 ${
                  row.highlight ? 'bg-forest-50/70 font-semibold' : row.bold ? 'font-medium' : ''
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 w-12 text-center">
                    {row.code}
                  </span>
                  <span className="text-slate-800">{row.label}</span>
                </div>
                <span className="font-mono text-sm tabular-nums text-slate-900">
                  {formatMoney(row.val)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
