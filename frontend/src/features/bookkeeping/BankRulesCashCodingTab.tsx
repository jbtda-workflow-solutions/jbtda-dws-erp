import { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Sparkles,
  CheckSquare,
  Split,
  RefreshCw,
} from 'lucide-react';
import {
  bookkeepingApi,
  bankingApi,
  invoiceApi,
  billApi,
  type BankRule,
  type BankAccountSummary,
  type BankStatementLine,
  type AccountWithBalance,
  type Contact,
  type TrackingCategory,
  type TaxTreatment,
  type Invoice,
  type Bill,
  ApiError,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}$${(abs / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface BankRulesCashCodingTabProps {
  bankAccounts: BankAccountSummary[];
  accounts: AccountWithBalance[];
  contacts: Contact[];
  trackingCategories: TrackingCategory[];
  canWrite: boolean;
}

interface CashCodingDraft {
  selected: boolean;
  contactId: string;
  accountId: string;
  trackingOptionId: string;
  taxTreatment: TaxTreatment;
}

export function BankRulesCashCodingTab({
  bankAccounts,
  accounts,
  contacts,
  trackingCategories,
  canWrite,
}: BankRulesCashCodingTabProps) {
  const [selectedBankId, setSelectedBankId] = useState(bankAccounts[0]?.id ?? '');
  const [rules, setRules] = useState<BankRule[]>([]);
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CashCodingDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New Rule Modal
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleDir, setRuleDir] = useState<'SPEND' | 'RECEIVE'>('SPEND');
  const [ruleField, setRuleField] = useState<'ANY' | 'DESCRIPTION' | 'REFERENCE'>('ANY');
  const [ruleType, setRuleType] = useState<'CONTAINS' | 'EXACT' | 'STARTS_WITH'>('CONTAINS');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleContactId, setRuleContactId] = useState('');
  const [ruleAccountId, setRuleAccountId] = useState('');
  const [ruleTrackingId, setRuleTrackingId] = useState('');
  const [ruleTax, setRuleTax] = useState<TaxTreatment>('TAX_INCLUSIVE');

  // Split / Fee Match Modal
  const [splitLine, setSplitLine] = useState<BankStatementLine | null>(null);
  const [openInvoices, setOpenInvoices] = useState<Invoice[]>([]);
  const [openBills, setOpenBills] = useState<Bill[]>([]);
  const [splitAllocs, setSplitAllocs] = useState<Record<string, string>>({});
  const [feeAccountId, setFeeAccountId] = useState('');
  const [feeDollars, setFeeDollars] = useState('');
  const [feeTax, setFeeTax] = useState<TaxTreatment>('GST_FREE');

  const allTrackingOptions = trackingCategories.flatMap((c) =>
    c.options.map((o) => ({ id: o.id, label: `${c.name}: ${o.name}` })),
  );

  useEffect(() => {
    if (!selectedBankId && bankAccounts[0]) setSelectedBankId(bankAccounts[0].id);
  }, [bankAccounts, selectedBankId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesRes, stmtsRes] = await Promise.all([
        bookkeepingApi.listBankRules(),
        selectedBankId
          ? bankingApi.listStatements({ bankAccountId: selectedBankId, isReconciled: false })
          : Promise.resolve({ lines: [] as BankStatementLine[] }),
      ]);
      setRules(rulesRes.rules);
      setLines(stmtsRes.lines);

      const nextDrafts: Record<string, CashCodingDraft> = {};
      for (const l of stmtsRes.lines) {
        nextDrafts[l.id] = {
          selected: Boolean(l.suggestedAccountId),
          contactId: l.suggestedContactId ?? '',
          accountId: l.suggestedAccountId ?? '',
          trackingOptionId: l.suggestedTrackingOptionId ?? '',
          taxTreatment: (l.suggestedTaxTreatment as TaxTreatment) ?? 'TAX_INCLUSIVE',
        };
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load bank rules & statement lines.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [selectedBankId]);

  const handleApplyRules = async () => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await bookkeepingApi.applyBankRules(selectedBankId || undefined);
      setFeedback(`Scanned ${res.scannedLines} unreconciled line(s) and auto-coded ${res.matchedCount} via Bank Rules.`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to apply bank rules.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim() || !ruleValue.trim() || !ruleAccountId) {
      setError('Rule name, match text, and target GL account are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bookkeepingApi.createBankRule({
        name: ruleName.trim(),
        direction: ruleDir,
        matchField: ruleField,
        matchType: ruleType,
        matchValue: ruleValue.trim(),
        contactId: ruleContactId || null,
        accountId: ruleAccountId,
        trackingOptionId: ruleTrackingId || null,
        taxTreatment: ruleTax,
      });
      setRuleModalOpen(false);
      setRuleName('');
      setRuleValue('');
      setFeedback('Bank rule created.');
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create bank rule.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    setBusy(true);
    try {
      await bookkeepingApi.deleteBankRule(id);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete bank rule.');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkCashCode = async () => {
    const selectedItems = lines
      .filter((l) => drafts[l.id]?.selected && drafts[l.id]?.accountId)
      .map((l) => {
        const d = drafts[l.id]!;
        return {
          statementLineId: l.id,
          contactId: d.contactId || null,
          accountId: d.accountId,
          trackingOptionId: d.trackingOptionId || null,
          taxTreatment: d.taxTreatment,
          description: l.description,
        };
      });

    if (selectedItems.length === 0) {
      setError('Select at least one statement line with an assigned GL account.');
      return;
    }

    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await bookkeepingApi.cashCodingReconcile(selectedItems);
      setFeedback(`Bulk cash-coded and reconciled ${res.reconciledCount} bank line(s).`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cash coding reconciliation failed.');
    } finally {
      setBusy(false);
    }
  };

  const openSplitModal = async (line: BankStatementLine) => {
    setSplitLine(line);
    setSplitAllocs({});
    setFeeDollars('');
    setFeeAccountId(accounts.find((a) => a.type === 'EXPENSE')?.id ?? '');
    try {
      if (line.amountCents > 0) {
        const res = await invoiceApi.list();
        setOpenInvoices(
          (res.invoices || []).filter((i) => i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID'),
        );
      } else {
        const res = await billApi.list();
        setOpenBills(
          (res.bills || []).filter((b) => b.status === 'AWAITING_PAYMENT' || b.status === 'PARTIALLY_PAID'),
        );
      }
    } catch {
      // ignore
    }
  };

  const handleSplitSubmit = async () => {
    if (!splitLine) return;
    const isInflow = splitLine.amountCents > 0;
    const allocations = Object.entries(splitAllocs)
      .map(([documentId, dollars]) => ({
        documentId,
        amountCents: Math.round((Number(dollars) || 0) * 100),
      }))
      .filter((a) => a.amountCents > 0);

    if (allocations.length === 0) {
      setError('Enter at least one allocation amount.');
      return;
    }

    const feeCents = Math.round((Number(feeDollars) || 0) * 100);
    setBusy(true);
    setError(null);
    try {
      const res = await bookkeepingApi.splitMatchReconcile({
        statementLineId: splitLine.id,
        mode: isInflow ? 'INVOICES' : 'BILLS',
        allocations,
        adjustment:
          feeCents !== 0 && feeAccountId
            ? {
                accountId: feeAccountId,
                amountCents: feeCents,
                taxTreatment: feeTax,
                description: 'Bank / Merchant Fee Adjustment',
              }
            : undefined,
      });
      setSplitLine(null);
      setFeedback(`Split reconciliation posted (${res.entryNumber ?? res.journalId}).`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Split reconciliation failed.');
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = lines.filter((l) => drafts[l.id]?.selected && drafts[l.id]?.accountId).length;

  return (
    <div className="space-y-5">
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

      {/* Section 1: Deterministic Bank Rules */}
      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-slate-900">Deterministic Bank Rules ({rules.length})</h2>
            <p className="text-xs text-slate-500">
              Auto-populate Contact, GL Account, Tax Treatment, and Cost Centre on unreconciled bank lines.
            </p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void handleApplyRules()} disabled={busy}>
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-forest-700" />
                Apply Rules to Unreconciled
              </Button>
              <Button size="sm" onClick={() => setRuleModalOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                New Bank Rule
              </Button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Rule Name</th>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">Target Account</th>
                <th className="px-3 py-2">Tax</th>
                {canWrite && <th className="px-3 py-2 w-12" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-5 text-center text-slate-400">
                    No bank rules configured yet. Create rules for recurring merchants (e.g. AWS, Telstra, Stripe).
                  </td>
                </tr>
              ) : (
                rules.map((r) => {
                  const acc = accounts.find((a) => a.id === r.accountId);
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                        {r.direction} · {r.matchField} {r.matchType} "{r.matchValue}"
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {acc ? `${acc.code} ${acc.name}` : r.accountId}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{r.taxTreatment}</td>
                      {canWrite && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDeleteRule(r.id)}
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Bulk Cash Coding & Split Match Workbench */}
      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h2 className="text-sm font-medium text-slate-900">
                Cash Coding & Split Match ({lines.length} unreconciled)
              </h2>
              <p className="text-xs text-slate-500">
                Bulk-reconcile routine lines in one click, or use Split Match for multi-invoice/fee settlements.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedBankId}
              onChange={(e) => setSelectedBankId(e.target.value)}
              className="h-8 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
            >
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={() => void loadData()} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {canWrite && (
              <Button
                size="sm"
                loading={busy}
                disabled={selectedCount === 0}
                onClick={() => void handleBulkCashCode()}
              >
                <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
                Save & Reconcile ({selectedCount})
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Bank Description</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">GL Account</th>
                <th className="px-3 py-2">Tax</th>
                {canWrite && <th className="px-3 py-2 text-right">Split</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Loading unreconciled bank lines…
                  </td>
                </tr>
              ) : lines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    Zero unreconciled statement lines for this bank account.
                  </td>
                </tr>
              ) : (
                lines.map((line) => {
                  const d = drafts[line.id] ?? {
                    selected: false,
                    contactId: '',
                    accountId: '',
                    trackingOptionId: '',
                    taxTreatment: 'TAX_INCLUSIVE' as TaxTreatment,
                  };
                  return (
                    <tr key={line.id} className={d.selected ? 'bg-forest-50/40' : ''}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={d.selected}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [line.id]: { ...d, selected: e.target.checked },
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                        {new Date(line.statementDate).toLocaleDateString('en-AU')}
                      </td>
                      <td className="px-3 py-2 text-slate-900 max-w-[220px] truncate">
                        {line.description}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums font-medium whitespace-nowrap ${
                          line.amountCents >= 0 ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {formatMoney(line.amountCents)}
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={d.contactId}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [line.id]: { ...d, contactId: e.target.value },
                            }))
                          }
                          className="h-7 w-36 rounded border border-slate-200 px-1.5 text-xs"
                        >
                          <option value="">— Optional —</option>
                          {contacts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={d.accountId}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [line.id]: { ...d, accountId: e.target.value, selected: Boolean(e.target.value) },
                            }))
                          }
                          className="h-7 w-44 rounded border border-slate-200 px-1.5 text-xs"
                        >
                          <option value="">Select Account…</option>
                          {accounts
                            .filter((a) => !a.isBankAccount)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} {a.name}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={d.taxTreatment}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [line.id]: { ...d, taxTreatment: e.target.value as TaxTreatment },
                            }))
                          }
                          className="h-7 w-28 rounded border border-slate-200 px-1.5 text-xs font-mono"
                        >
                          <option value="TAX_INCLUSIVE">GST Inc</option>
                          <option value="GST_FREE">GST Free</option>
                        </select>
                      </td>
                      {canWrite && (
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void openSplitModal(line)}
                            title="Split across multiple invoices/bills with bank fee adjustment"
                          >
                            <Split className="w-3 h-3 mr-1" />
                            Split
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Bank Rule Modal */}
      <Modal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title="Create Deterministic Bank Rule"
        size="lg"
      >
        <form onSubmit={handleCreateRule} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Rule Name *</label>
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="e.g. AWS Cloud Hosting"
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Direction</label>
              <select
                value={ruleDir}
                onChange={(e) => setRuleDir(e.target.value as 'SPEND' | 'RECEIVE')}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
              >
                <option value="SPEND">Money Out (Spend)</option>
                <option value="RECEIVE">Money In (Receive)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Match Field</label>
              <select
                value={ruleField}
                onChange={(e) => setRuleField(e.target.value as 'ANY' | 'DESCRIPTION' | 'REFERENCE')}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
              >
                <option value="ANY">Description or Reference</option>
                <option value="DESCRIPTION">Description Only</option>
                <option value="REFERENCE">Reference Only</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Operator</label>
              <select
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as 'CONTAINS' | 'EXACT' | 'STARTS_WITH')}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
              >
                <option value="CONTAINS">Contains</option>
                <option value="STARTS_WITH">Starts With</option>
                <option value="EXACT">Exact Match</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Match Text *</label>
              <input
                type="text"
                value={ruleValue}
                onChange={(e) => setRuleValue(e.target.value)}
                placeholder="AMAZON WEB SERVICES"
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs font-mono"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Target GL Account *</label>
              <select
                value={ruleAccountId}
                onChange={(e) => setRuleAccountId(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
                required
              >
                <option value="">Select Account…</option>
                {accounts
                  .filter((a) => !a.isBankAccount)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tax Treatment</label>
              <select
                value={ruleTax}
                onChange={(e) => setRuleTax(e.target.value as TaxTreatment)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
              >
                <option value="TAX_INCLUSIVE">GST Inclusive (10%)</option>
                <option value="GST_FREE">GST Free (0%)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Default Contact (Optional)</label>
              <select
                value={ruleContactId}
                onChange={(e) => setRuleContactId(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
              >
                <option value="">None</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cost Centre (Optional)</label>
              <select
                value={ruleTrackingId}
                onChange={(e) => setRuleTrackingId(e.target.value)}
                className="w-full h-9 rounded border border-slate-200 px-2.5 text-xs"
              >
                <option value="">None</option>
                {allTrackingOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <Button type="button" size="sm" variant="outline" onClick={() => setRuleModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy}>
              Save Bank Rule
            </Button>
          </div>
        </form>
      </Modal>

      {/* Split & Fee-Adjusted Reconciliation Modal */}
      <Modal
        open={Boolean(splitLine)}
        onClose={() => setSplitLine(null)}
        title="Split & Fee-Adjusted Bank Match"
        description={
          splitLine
            ? `Bank line: ${splitLine.description} (${formatMoney(splitLine.amountCents)})`
            : undefined
        }
        size="3xl"
      >
        {splitLine && (
          <div className="space-y-4">
            <div className="max-h-56 overflow-y-auto border border-slate-200 rounded divide-y divide-slate-100">
              {(splitLine.amountCents > 0 ? openInvoices : openBills).map((doc: any) => {
                const due = doc.totalCents - doc.amountPaidCents;
                const label = splitLine.amountCents > 0 ? doc.invoiceNumber : doc.reference || 'Vendor Bill';
                return (
                  <div key={doc.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        <span className="font-mono mr-1.5">{label}</span>
                        {doc.contact?.name}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">
                        Balance Due: {formatMoney(due)}
                      </p>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={splitAllocs[doc.id] ?? ''}
                      onChange={(e) =>
                        setSplitAllocs((prev) => ({ ...prev, [doc.id]: e.target.value }))
                      }
                      className="w-28 h-8 rounded border border-slate-200 px-2 text-right font-mono text-xs"
                    />
                  </div>
                );
              })}
            </div>

            <div className="rounded border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
              <p className="text-[11px] font-mono uppercase tracking-wider text-slate-600">
                Optional Bank / Merchant Fee or Rounding Adjustment
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <select
                  value={feeAccountId}
                  onChange={(e) => setFeeAccountId(e.target.value)}
                  className="h-8 rounded border border-slate-200 bg-white px-2 text-xs"
                >
                  <option value="">Select Fee Account…</option>
                  {accounts
                    .filter((a) => a.type === 'EXPENSE' || a.type === 'REVENUE')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Fee $ (e.g. 15.00)"
                  value={feeDollars}
                  onChange={(e) => setFeeDollars(e.target.value)}
                  className="h-8 rounded border border-slate-200 bg-white px-2 text-right font-mono text-xs"
                />
                <select
                  value={feeTax}
                  onChange={(e) => setFeeTax(e.target.value as TaxTreatment)}
                  className="h-8 rounded border border-slate-200 bg-white px-2 text-xs font-mono"
                >
                  <option value="GST_FREE">GST Free</option>
                  <option value="TAX_INCLUSIVE">GST Inclusive</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <Button size="sm" variant="outline" onClick={() => setSplitLine(null)}>
                Cancel
              </Button>
              <Button size="sm" loading={busy} onClick={() => void handleSplitSubmit()}>
                Post Split Reconciliation
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
