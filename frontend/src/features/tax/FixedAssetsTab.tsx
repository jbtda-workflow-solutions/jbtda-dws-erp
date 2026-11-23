import { useState, useEffect } from 'react';
import { Plus, Play, RefreshCw } from 'lucide-react';
import {
  taxCloseApi,
  accountsApi,
  type FixedAssetRecord,
  type AccountWithBalance,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StatusTag } from '@/components/ui/StatusTag';

function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}$${(abs / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function FixedAssetsTab({ canWrite }: { canWrite: boolean }) {
  const [assets, setAssets] = useState<FixedAssetRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Create Asset Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [assetNumber, setAssetNumber] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Office & Computer Equipment');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [costDollars, setCostDollars] = useState('');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('48');
  const [method, setMethod] = useState<'STRAIGHT_LINE' | 'DIMINISHING_VALUE'>('STRAIGHT_LINE');
  const [ratePercent, setRatePercent] = useState('25');
  const [assetAccountId, setAssetAccountId] = useState('');
  const [accumAccountId, setAccumAccountId] = useState('');
  const [depExpAccountId, setDepExpAccountId] = useState('');

  // Run Depreciation Modal
  const [depOpen, setDepOpen] = useState(false);
  const [depDate, setDepDate] = useState(new Date().toISOString().slice(0, 10));
  const [depMonths, setDepMonths] = useState('1');

  // Dispose Modal
  const [disposingAsset, setDisposingAsset] = useState<FixedAssetRecord | null>(null);
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [proceedsDollars, setProceedsDollars] = useState('0');
  const [bankAccountId, setBankAccountId] = useState('');
  const [gainLossAccountId, setGainLossAccountId] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [assetsRes, accRes] = await Promise.all([
        taxCloseApi.listFixedAssets(),
        accountsApi.list(),
      ]);
      setAssets(assetsRes.assets || []);
      const accs = accRes.accounts || [];
      setAccounts(accs);
      if (!assetAccountId) {
        setAssetAccountId(accs.find((a) => a.type === 'ASSET' && !a.isBankAccount)?.id ?? accs[0]?.id ?? '');
        setAccumAccountId(accs.find((a) => a.type === 'ASSET' && !a.isBankAccount)?.id ?? accs[0]?.id ?? '');
        setDepExpAccountId(accs.find((a) => a.type === 'EXPENSE')?.id ?? accs[0]?.id ?? '');
        setBankAccountId(accs.find((a) => a.isBankAccount || a.code === '1000')?.id ?? '');
        setGainLossAccountId(accs.find((a) => a.type === 'REVENUE' || a.type === 'EXPENSE')?.id ?? '');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load fixed assets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    const costCents = Math.round((Number(costDollars) || 0) * 100);
    if (!assetNumber.trim() || !name.trim() || costCents <= 0) {
      setError('Asset number, name, and positive cost are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await taxCloseApi.createFixedAsset({
        assetNumber: assetNumber.trim(),
        name: name.trim(),
        category,
        purchaseDate,
        costCents,
        usefulLifeMonths: Number(usefulLifeMonths) || 60,
        depreciationMethod: method,
        depreciationRateBps: Math.round((Number(ratePercent) || 20) * 100),
        assetAccountId,
        accumulatedDepAccountId: accumAccountId,
        depExpenseAccountId: depExpAccountId,
      });
      setCreateOpen(false);
      setAssetNumber('');
      setName('');
      setCostDollars('');
      setFeedback('Fixed asset registered.');
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create fixed asset.');
    } finally {
      setBusy(false);
    }
  };

  const handleRunDepreciation = async () => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await taxCloseApi.runDepreciation({
        asOfDate: depDate,
        months: Number(depMonths) || 1,
      });
      setDepOpen(false);
      setFeedback(
        `Posted depreciation journal ${res.entryNumber ?? res.journalId}: ${formatMoney(res.totalDepCents)} across ${res.depreciatedAssetsCount} asset(s).`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Depreciation run failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDispose = async () => {
    if (!disposingAsset) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const proceedsCents = Math.round((Number(proceedsDollars) || 0) * 100);
      const res = await taxCloseApi.disposeFixedAsset(disposingAsset.id, {
        disposalDate,
        disposalProceedsCents: proceedsCents,
        bankAccountId: proceedsCents > 0 ? bankAccountId : undefined,
        gainLossAccountId,
      });
      setDisposingAsset(null);
      setFeedback(
        `Disposed ${disposingAsset.assetNumber} (Journal ${res.entryNumber ?? res.journalId}, Net Gain/Loss: ${formatMoney(res.gainOrLossCents)}).`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Asset disposal failed.');
    } finally {
      setBusy(false);
    }
  };

  const totalCost = assets.filter((a) => a.status === 'ACTIVE').reduce((s, a) => s + a.costCents, 0);
  const totalWdv = assets
    .filter((a) => a.status === 'ACTIVE')
    .reduce((s, a) => s + a.writtenDownValueCents, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-900">ATO Fixed Asset Register</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Active Cost: <strong className="font-mono text-slate-800">{formatMoney(totalCost)}</strong> · Written-Down Value:{' '}
            <strong className="font-mono text-forest-900">{formatMoney(totalWdv)}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {canWrite && (
            <>
              <Button size="sm" variant="outline" onClick={() => setDepOpen(true)}>
                <Play className="w-3.5 h-3.5 mr-1.5 text-forest-700" />
                Run Depreciation
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Register Asset
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {feedback}
        </div>
      )}

      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Asset #</th>
                <th className="px-3 py-2">Name & Category</th>
                <th className="px-3 py-2">Purchased</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Accum. Dep</th>
                <th className="px-3 py-2 text-right">WDV</th>
                <th className="px-3 py-2">Status</th>
                {canWrite && <th className="px-3 py-2 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No fixed assets registered yet.
                  </td>
                </tr>
              ) : (
                assets.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-mono text-slate-800 whitespace-nowrap">{a.assetNumber}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">{a.name}</p>
                      <p className="text-[11px] text-slate-500">{a.category}</p>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                      {new Date(a.purchaseDate).toLocaleDateString('en-AU')}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                      {a.depreciationMethod === 'DIMINISHING_VALUE'
                        ? `DV ${(a.depreciationRateBps / 100).toFixed(1)}%`
                        : `SL ${a.usefulLifeMonths}m`}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(a.costCents)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                      {formatMoney(a.accumulatedDepCents)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-slate-900">
                      {formatMoney(a.writtenDownValueCents)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusTag
                        label={a.status}
                        tone={a.status === 'ACTIVE' ? 'emerald' : 'slate'}
                      />
                    </td>
                    {canWrite && (
                      <td className="px-3 py-2 text-right">
                        {a.status === 'ACTIVE' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDisposingAsset(a)}
                          >
                            Dispose
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Register Fixed Asset Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Register ATO Fixed Asset"
        size="xl"
      >
        <form onSubmit={handleCreateAsset} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Asset Number *</label>
              <input
                type="text"
                value={assetNumber}
                onChange={(e) => setAssetNumber(e.target.value)}
                placeholder="FA-0001"
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Asset Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MacBook Pro 16-inch"
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Purchase Date *</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cost Ex-GST (AUD $) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={costDollars}
                onChange={(e) => setCostDollars(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-right font-mono text-xs"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">ATO Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as 'STRAIGHT_LINE' | 'DIMINISHING_VALUE')}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
              >
                <option value="STRAIGHT_LINE">Prime Cost (Straight-Line)</option>
                <option value="DIMINISHING_VALUE">Diminishing Value</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Useful Life (Months)</label>
              <input
                type="number"
                min="1"
                value={usefulLifeMonths}
                onChange={(e) => setUsefulLifeMonths(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-right font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Annual Rate (%)</label>
              <input
                type="number"
                step="0.5"
                min="1"
                max="100"
                value={ratePercent}
                onChange={(e) => setRatePercent(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-right font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Asset Account</label>
              <select
                value={assetAccountId}
                onChange={(e) => setAssetAccountId(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2 text-xs"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Accum. Dep Account</label>
              <select
                value={accumAccountId}
                onChange={(e) => setAccumAccountId(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2 text-xs"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Dep. Expense Account</label>
              <select
                value={depExpAccountId}
                onChange={(e) => setDepExpAccountId(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2 text-xs"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy}>
              Register Asset
            </Button>
          </div>
        </form>
      </Modal>

      {/* Run Depreciation Modal */}
      <Modal
        open={depOpen}
        onClose={() => setDepOpen(false)}
        title="Run ATO Depreciation Journal"
        size="md"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Journal Posting Date</label>
            <input
              type="date"
              value={depDate}
              onChange={(e) => setDepDate(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Number of Months (1–12)</label>
            <input
              type="number"
              min="1"
              max="12"
              value={depMonths}
              onChange={(e) => setDepMonths(e.target.value)}
              className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <Button size="sm" variant="outline" onClick={() => setDepOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={busy} onClick={() => void handleRunDepreciation()}>
              Post Depreciation Journal
            </Button>
          </div>
        </div>
      </Modal>

      {/* Dispose Asset Modal */}
      <Modal
        open={Boolean(disposingAsset)}
        onClose={() => setDisposingAsset(null)}
        title={`Dispose Asset ${disposingAsset?.assetNumber ?? ''}`}
        size="md"
      >
        {disposingAsset && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600">
              Current Written-Down Value:{' '}
              <strong className="font-mono text-slate-900">
                {formatMoney(disposingAsset.writtenDownValueCents)}
              </strong>
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Disposal Date</label>
              <input
                type="date"
                value={disposalDate}
                onChange={(e) => setDisposalDate(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Disposal Proceeds (AUD $)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={proceedsDollars}
                onChange={(e) => setProceedsDollars(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-right font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Gain/Loss GL Account</label>
              <select
                value={gainLossAccountId}
                onChange={(e) => setGainLossAccountId(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2 text-xs"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <Button size="sm" variant="outline" onClick={() => setDisposingAsset(null)}>
                Cancel
              </Button>
              <Button size="sm" loading={busy} onClick={() => void handleDispose()}>
                Post Asset Disposal
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
