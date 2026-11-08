import React, { useEffect, useState, useMemo } from 'react';
import {
  CreditCard,
  Plus,
  Search,
  Building2,
  AlertCircle,
  Trash2,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Download,
  Calendar,
  Check,
  Send,
  ArrowRight,
  Receipt,
  FileCheck2,
  User,
  DollarSign,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  Landmark,
  Edit2,
  Layers,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import {
  directTransactionApi,
  expenseClaimApi,
  batchPaymentApi,
  accountApi,
  contactApi,
  orgApi,
  type DirectTransaction,
  type DirectTransactionLine,
  type DirectTransactionType,
  type ExpenseClaim,
  type ExpenseClaimItem,
  type ExpenseClaimStatus,
  type Account,
  type Contact,
  type TrackingCategory,
  type TaxTreatment,
  type Role,
  ApiError,
} from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { StatusTag, type StatusTagTone } from '@/components/ui/StatusTag';
import { PipelineRibbon, type PipelineStage } from '@/components/ui/PipelineRibbon';

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatBsb(bsb?: string | null): string {
  if (!bsb) return '—';
  const digits = bsb.replace(/\D/g, '');
  if (digits.length === 6) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;
  }
  return bsb;
}

type TabKey =
  | 'DIRECT_SPEND'
  | 'APPROVALS'
  | 'REIMBURSEMENTS'
  | 'MY_CLAIMS'
  | 'MY_BANKING';

interface DirectLineDraft {
  id: string;
  accountId: string;
  description: string;
  amount: string;
  taxTreatment: TaxTreatment;
  trackingOptionId?: string;
}

interface ExpenseItemDraft {
  id: string;
  expenseDate: string;
  merchant: string;
  description: string;
  accountId: string;
  amount: string;
  taxTreatment: TaxTreatment;
  trackingOptionId?: string;
}

export function ExpensesPage() {
  const { role, user, memberProfile, organization, refreshSession } = useAuth();

  // Tab state — default based on user's role
  const isElevatedFinance =
    role === 'ADMIN' || role === 'ACCOUNTANT' || role === 'AP_SPECIALIST';
  const isManager = role === 'MANAGER';

  const defaultTab: TabKey = isElevatedFinance
    ? 'DIRECT_SPEND'
    : isManager
      ? 'APPROVALS'
      : 'MY_CLAIMS';

  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);

  // Common reference data
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [trackingCategories, setTrackingCategories] = useState<TrackingCategory[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(false);

  // Tab 1: Direct Transactions State
  const [directTransactions, setDirectTransactions] = useState<DirectTransaction[]>([]);
  const [loadingDirect, setLoadingDirect] = useState(false);
  const [directSearch, setDirectSearch] = useState('');
  const [directBankFilter, setDirectBankFilter] = useState('');
  const [openDirectModal, setOpenDirectModal] = useState(false);

  // Tab 2 & 4: Expense Claims State
  const [myClaims, setMyClaims] = useState<ExpenseClaim[]>([]);
  const [teamClaims, setTeamClaims] = useState<ExpenseClaim[]>([]);
  const [approvedClaims, setApprovedClaims] = useState<ExpenseClaim[]>([]);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [claimsSearch, setClaimsSearch] = useState('');
  const [claimStatusFilter, setClaimStatusFilter] = useState<ExpenseClaimStatus | 'ALL'>('ALL');

  // Modals & Drawers
  const [openClaimModal, setOpenClaimModal] = useState(false);
  const [editingClaim, setEditingClaim] = useState<ExpenseClaim | null>(null);
  const [claimToSubmit, setClaimToSubmit] = useState<ExpenseClaim | null>(null);
  const [claimToApprove, setClaimToApprove] = useState<ExpenseClaim | null>(null);
  const [claimToReject, setClaimToReject] = useState<ExpenseClaim | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [claimToPay, setClaimToPay] = useState<ExpenseClaim | null>(null);
  const [openBatchModal, setOpenBatchModal] = useState(false);
  const [selectedClaimIdsForBatch, setSelectedClaimIdsForBatch] = useState<string[]>([]);

  // Slide-over inspection drawer
  const [inspectClaim, setInspectClaim] = useState<ExpenseClaim | null>(null);
  const [inspectDirectTxn, setInspectDirectTxn] = useState<DirectTransaction | null>(null);

  // Banking profile state
  const [bankingBsb, setBankingBsb] = useState(memberProfile?.bankBsb || '');
  const [bankingAccountNumber, setBankingAccountNumber] = useState(
    memberProfile?.bankAccountNumber || '',
  );
  const [bankingAccountName, setBankingAccountName] = useState(
    memberProfile?.bankAccountName || '',
  );
  const [bankingJobTitle, setBankingJobTitle] = useState(memberProfile?.jobTitle || '');
  const [bankingDepartment, setBankingDepartment] = useState(memberProfile?.department || '');
  const [savingBanking, setSavingBanking] = useState(false);
  const [bankingSuccess, setBankingSuccess] = useState<string | null>(null);
  const [bankingError, setBankingError] = useState<string | null>(null);

  // Operation action feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Sync member profile when loaded
  useEffect(() => {
    if (memberProfile) {
      setBankingBsb(memberProfile.bankBsb || '');
      setBankingAccountNumber(memberProfile.bankAccountNumber || '');
      setBankingAccountName(memberProfile.bankAccountName || '');
      setBankingJobTitle(memberProfile.jobTitle || '');
      setBankingDepartment(memberProfile.department || '');
    }
  }, [memberProfile]);

  // Load Reference Accounts, Contacts, and Tracking Categories
  const loadReferenceData = async () => {
    try {
      setLoadingRefs(true);
      const [accRes, contRes, trackRes] = await Promise.all([
        accountApi.list({ includeInactive: false }),
        contactApi.list(),
        accountApi.listTrackingCategories(),
      ]);
      setAccounts(accRes.accounts);
      setContacts(contRes.contacts);
      setTrackingCategories(trackRes.categories);
    } catch (err: any) {
      console.error('Failed to load reference metadata:', err);
    } finally {
      setLoadingRefs(false);
    }
  };

  // Load Direct Transactions
  const loadDirectTransactions = async () => {
    if (!isElevatedFinance && role !== 'AUDITOR') return;
    try {
      setLoadingDirect(true);
      const res = await directTransactionApi.list({
        bankAccountId: directBankFilter || undefined,
        search: directSearch || undefined,
      });
      setDirectTransactions(res.directTransactions);
    } catch (err: any) {
      console.error('Failed to load direct transactions:', err);
    } finally {
      setLoadingDirect(false);
    }
  };

  // Load Claims
  const loadClaimsData = async () => {
    try {
      setLoadingClaims(true);
      // 1. My claims
      const myRes = await expenseClaimApi.list({ scope: 'my' });
      setMyClaims(myRes.expenseClaims);

      // 2. Team approvals (if manager or elevated)
      if (isManager || isElevatedFinance || role === 'AUDITOR') {
        const teamRes = await expenseClaimApi.list({
          scope: 'team',
          status: 'SUBMITTED',
        });
        setTeamClaims(teamRes.expenseClaims);
      }

      // 3. Approved claims for reimbursement
      if (isElevatedFinance || role === 'AUDITOR') {
        const approvedRes = await expenseClaimApi.list({
          status: 'APPROVED',
        });
        setApprovedClaims(approvedRes.expenseClaims);
      }
    } catch (err: any) {
      console.error('Failed to load claims:', err);
    } finally {
      setLoadingClaims(false);
    }
  };

  useEffect(() => {
    void loadReferenceData();
  }, []);

  useEffect(() => {
    if (activeTab === 'DIRECT_SPEND') {
      void loadDirectTransactions();
    } else if (
      activeTab === 'APPROVALS' ||
      activeTab === 'REIMBURSEMENTS' ||
      activeTab === 'MY_CLAIMS'
    ) {
      void loadClaimsData();
    }
  }, [activeTab, directBankFilter, directSearch]);

  // Bank accounts list
  const bankAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => a.isBankAccount || (a.type === 'ASSET' && a.code.startsWith('10')),
      ),
    [accounts],
  );

  // Expense accounts list
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'EXPENSE'),
    [accounts],
  );

  // Pipeline stages for My Claims
  const myClaimsPipeline = useMemo(() => {
    const counts = {
      ALL: myClaims.length,
      DRAFT: 0,
      SUBMITTED: 0,
      APPROVED: 0,
      PAID: 0,
      REJECTED: 0,
    };
    const totals = {
      ALL: 0,
      DRAFT: 0,
      SUBMITTED: 0,
      APPROVED: 0,
      PAID: 0,
      REJECTED: 0,
    };

    for (const c of myClaims) {
      totals.ALL += c.totalAmountCents;
      if (c.status in counts) {
        counts[c.status as keyof typeof counts]++;
        totals[c.status as keyof typeof totals] += c.totalAmountCents;
      }
    }

    const stages: PipelineStage<ExpenseClaimStatus | 'ALL'>[] = [
      {
        id: 'ALL',
        label: 'All Claims',
        count: counts.ALL,
        amountCents: totals.ALL,
      },
      {
        id: 'DRAFT',
        label: 'Draft',
        count: counts.DRAFT,
        amountCents: totals.DRAFT,
      },
      {
        id: 'SUBMITTED',
        label: 'Submitted',
        count: counts.SUBMITTED,
        amountCents: totals.SUBMITTED,
        tone: 'amber',
      },
      {
        id: 'APPROVED',
        label: 'Approved',
        count: counts.APPROVED,
        amountCents: totals.APPROVED,
        tone: 'emerald',
      },
      {
        id: 'PAID',
        label: 'Reimbursed',
        count: counts.PAID,
        amountCents: totals.PAID,
        tone: 'emerald',
      },
      {
        id: 'REJECTED',
        label: 'Rejected',
        count: counts.REJECTED,
        amountCents: totals.REJECTED,
        tone: 'rose',
      },
    ];

    return stages;
  }, [myClaims]);

  // Filtered my claims
  const filteredMyClaims = useMemo(() => {
    return myClaims.filter((c) => {
      const matchStatus =
        claimStatusFilter === 'ALL' || c.status === claimStatusFilter;
      const matchSearch =
        !claimsSearch ||
        c.claimNumber.toLowerCase().includes(claimsSearch.toLowerCase()) ||
        c.title.toLowerCase().includes(claimsSearch.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [myClaims, claimStatusFilter, claimsSearch]);

  // Handler: Update Employee Personal Banking
  const handleSaveBanking = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBanking(true);
    setBankingError(null);
    setBankingSuccess(null);

    try {
      await orgApi.updateMyProfile({
        bankBsb: bankingBsb.trim() || null,
        bankAccountNumber: bankingAccountNumber.trim() || null,
        bankAccountName: bankingAccountName.trim() || null,
        jobTitle: bankingJobTitle.trim() || null,
        department: bankingDepartment.trim() || null,
      });
      setBankingSuccess('Reimbursement banking profile saved successfully.');
      await refreshSession();
    } catch (err: any) {
      setBankingError(err.message || 'Failed to update reimbursement profile.');
    } finally {
      setSavingBanking(false);
    }
  };

  // Handler: Submit claim
  const handleConfirmSubmit = async () => {
    if (!claimToSubmit) return;
    try {
      setActionError(null);
      await expenseClaimApi.submit(claimToSubmit.id);
      setActionSuccess(`Claim ${claimToSubmit.claimNumber} submitted for approval.`);
      setClaimToSubmit(null);
      void loadClaimsData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit claim.');
    }
  };

  // Handler: Approve claim
  const handleConfirmApprove = async () => {
    if (!claimToApprove) return;
    try {
      setActionError(null);
      await expenseClaimApi.approve(claimToApprove.id);
      setActionSuccess(
        `Claim ${claimToApprove.claimNumber} approved and posted to General Ledger (2050 Reimbursements Payable).`,
      );
      setClaimToApprove(null);
      void loadClaimsData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to approve claim.');
    }
  };

  // Handler: Reject claim
  const handleConfirmReject = async () => {
    if (!claimToReject || !rejectionReason.trim()) return;
    try {
      setActionError(null);
      await expenseClaimApi.reject(claimToReject.id, rejectionReason.trim());
      setActionSuccess(`Claim ${claimToReject.claimNumber} has been rejected.`);
      setClaimToReject(null);
      setRejectionReason('');
      void loadClaimsData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to reject claim.');
    }
  };

  // Handler: Pay Single Claim
  const handleConfirmPaySingle = async (bankAccountId: string) => {
    if (!claimToPay) return;
    try {
      setActionError(null);
      await expenseClaimApi.pay(claimToPay.id, {
        bankAccountId,
        paymentDate: new Date().toISOString().slice(0, 10),
        reference: `EFT-${claimToPay.claimNumber}`,
      });
      setActionSuccess(
        `Reimbursement for claim ${claimToPay.claimNumber} posted to General Ledger.`,
      );
      setClaimToPay(null);
      void loadClaimsData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to settle reimbursement.');
    }
  };

  // Handler: Execute Batch .ABA Payout
  const handleExecuteBatchPayment = async (bankAccountId: string) => {
    if (selectedClaimIdsForBatch.length === 0) return;
    try {
      setActionError(null);
      const res = await batchPaymentApi.create({
        paymentDate: new Date().toISOString().slice(0, 10),
        bankAccountId,
        description: `Employee Reimbursements Run ${new Date().toISOString().slice(0, 10)}`,
        expenseClaimPayments: selectedClaimIdsForBatch.map((id) => ({
          expenseClaimId: id,
        })),
      });

      setActionSuccess(
        `Batch payment run created with ${res.paymentsCount} reimbursement disbursements. .ABA file ready for download.`,
      );
      setOpenBatchModal(false);
      setSelectedClaimIdsForBatch([]);
      void loadClaimsData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to execute batch reimbursement.');
    }
  };

  // Helper status badge tone
  const getStatusTone = (status: ExpenseClaimStatus): StatusTagTone => {
    switch (status) {
      case 'DRAFT':
        return 'draft';
      case 'SUBMITTED':
        return 'amber';
      case 'APPROVED':
        return 'emerald';
      case 'PAID':
        return 'forest';
      case 'REJECTED':
        return 'rose';
      default:
        return 'slate';
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
              Expenses & Out-of-Pocket Claims
            </h1>
            <StatusTag tone="slate" mono className="text-xs">
              MODULE 06
            </StatusTag>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Direct card & bank spend money recording, employee out-of-pocket claims,
            maker-checker approvals, and APCA Cemtex .ABA reimbursement runs.
          </p>
        </div>

        {/* Action Header Buttons */}
        <div className="flex items-center gap-2">
          {isElevatedFinance && (
            <Button
              variant="outline"
              onClick={() => setOpenDirectModal(true)}
              className="text-xs flex items-center gap-1.5"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Record Spend Money</span>
            </Button>
          )}

          <Button
            variant="primary"
            onClick={() => {
              setEditingClaim(null);
              setOpenClaimModal(true);
            }}
            className="text-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Expense Claim</span>
          </Button>
        </div>
      </div>

      {/* Global Alerts */}
      {actionSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button
            onClick={() => setActionSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-rose-700 hover:text-rose-900 text-xs font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Role-Aware Tabs Bar */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {isElevatedFinance && (
          <button
            onClick={() => setActiveTab('DIRECT_SPEND')}
            className={`px-3.5 py-2 text-xs font-medium border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'DIRECT_SPEND'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Direct Spend Money</span>
            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full font-mono">
              {directTransactions.length}
            </span>
          </button>
        )}

        {(isManager || isElevatedFinance || role === 'AUDITOR') && (
          <button
            onClick={() => setActiveTab('APPROVALS')}
            className={`px-3.5 py-2 text-xs font-medium border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'APPROVALS'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Team Approvals Queue</span>
            {teamClaims.length > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded-full font-mono font-semibold">
                {teamClaims.length}
              </span>
            )}
          </button>
        )}

        {(isElevatedFinance || role === 'AUDITOR') && (
          <button
            onClick={() => setActiveTab('REIMBURSEMENTS')}
            className={`px-3.5 py-2 text-xs font-medium border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'REIMBURSEMENTS'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            <span>Reimbursement Payouts</span>
            {approvedClaims.length > 0 && (
              <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded-full font-mono font-semibold">
                {approvedClaims.length}
              </span>
            )}
          </button>
        )}

        <button
          onClick={() => setActiveTab('MY_CLAIMS')}
          className={`px-3.5 py-2 text-xs font-medium border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
            activeTab === 'MY_CLAIMS'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>My Out-of-Pocket Claims</span>
          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full font-mono">
            {myClaims.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('MY_BANKING')}
          className={`px-3.5 py-2 text-xs font-medium border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
            activeTab === 'MY_BANKING'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>My Reimbursement Banking</span>
          {!memberProfile?.bankBsb && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: DIRECT SPEND MONEY                                                 */}
      {/* ========================================================================= */}
      {activeTab === 'DIRECT_SPEND' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-3 border border-slate-200 rounded">
            <div className="flex items-center gap-3 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search transaction #, payee, or memo..."
                  value={directSearch}
                  onChange={(e) => setDirectSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <select
                value={directBankFilter}
                onChange={(e) => setDirectBankFilter(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-slate-700 focus:outline-none"
              >
                <option value="">All Bank & Card Accounts</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} - {b.name}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="outline"
              onClick={() => loadDirectTransactions()}
              className="text-xs flex items-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </Button>
          </div>

          {/* Transactions Table */}
          <div className="border border-slate-200 rounded bg-white overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Transaction #</th>
                    <th className="py-2.5 px-3">Source Account</th>
                    <th className="py-2.5 px-3">Payee / Reference</th>
                    <th className="py-2.5 px-3 text-right">Subtotal</th>
                    <th className="py-2.5 px-3 text-right">GST</th>
                    <th className="py-2.5 px-3 text-right">Total Amount</th>
                    <th className="py-2.5 px-3 text-center">GL Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingDirect ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        Loading direct transactions...
                      </td>
                    </tr>
                  ) : directTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        No direct transactions found. Click "Record Spend Money" to add one.
                      </td>
                    </tr>
                  ) : (
                    directTransactions.map((tx) => (
                      <tr
                        key={tx.id}
                        className="hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {formatDate(tx.transactionDate)}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900 font-mono">
                          {tx.transactionNumber}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          <span className="font-mono text-slate-500 mr-1.5">
                            {tx.bankAccount?.code}
                          </span>
                          {tx.bankAccount?.name}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          <div className="font-medium">
                            {tx.contact?.name || tx.reference || '—'}
                          </div>
                          {tx.description && (
                            <div className="text-[11px] text-slate-400 truncate max-w-xs">
                              {tx.description}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                          {formatCents(tx.subtotalCents)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                          {formatCents(tx.taxTotalCents)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                          {formatCents(tx.totalAmountCents)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <StatusTag tone="emerald" mono className="text-[11px]">
                            POSTED
                          </StatusTag>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            variant="ghost"
                            onClick={() => setInspectDirectTxn(tx)}
                            className="p-1 h-7 w-7 text-slate-600 hover:text-slate-900"
                            title="Inspect Transaction & GL Entry"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: TEAM APPROVALS QUEUE                                               */}
      {/* ========================================================================= */}
      {activeTab === 'APPROVALS' && (
        <div className="space-y-4">
          <div className="bg-white p-4 border border-slate-200 rounded flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Pending Expense Approvals
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Review submitted claims. Approval automatically posts debits to
                applicable expense accounts and credit to 2050 (Employee Reimbursements Payable).
              </p>
            </div>

            <Button
              variant="outline"
              onClick={() => loadClaimsData()}
              className="text-xs flex items-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh Queue</span>
            </Button>
          </div>

          <div className="border border-slate-200 rounded bg-white overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">Submitted</th>
                  <th className="py-2.5 px-3">Claim #</th>
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3">Title / Description</th>
                  <th className="py-2.5 px-3 text-center">Items</th>
                  <th className="py-2.5 px-3 text-right">Total Amount</th>
                  <th className="py-2.5 px-3 text-center">EFT Banking</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingClaims ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Loading approvals queue...
                    </td>
                  </tr>
                ) : teamClaims.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      No pending claims awaiting approval. Your queue is clear.
                    </td>
                  </tr>
                ) : (
                  teamClaims.map((claim) => {
                    const isSelf = claim.memberId === memberProfile?.id;
                    const hasBanking =
                      !!claim.member?.bankBsb && !!claim.member?.bankAccountNumber;

                    return (
                      <tr
                        key={claim.id}
                        className="hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {formatDate(claim.submittedAt || claim.createdAt)}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                          {claim.claimNumber}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          <div className="font-medium">
                            {claim.member?.user?.name || 'Employee'}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {claim.member?.department || claim.member?.jobTitle || 'Staff'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-800 max-w-xs">
                          <div className="font-medium truncate">{claim.title}</div>
                          {claim.description && (
                            <div className="text-[11px] text-slate-400 truncate">
                              {claim.description}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                          {claim.items.length}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                          {formatCents(claim.totalAmountCents)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {hasBanking ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-mono">
                              <Check className="w-3 h-3" />
                              {formatBsb(claim.member?.bankBsb)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                              <AlertTriangle className="w-3 h-3" />
                              No BSB
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              onClick={() => setInspectClaim(claim)}
                              className="p-1 h-7 text-xs flex items-center gap-1"
                              title="Inspect Lines"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>

                            {isSelf && organization?.enforceTwoPersonApproval ? (
                              <span
                                className="text-[11px] text-slate-400 italic px-2"
                                title="Organization enforces two-person approval. Another manager or admin must approve."
                              >
                                Self-claim
                              </span>
                            ) : (
                              <>
                                <Button
                                  variant="outline"
                                  onClick={() => setClaimToReject(claim)}
                                  className="h-7 px-2 text-xs text-rose-700 hover:text-rose-900 border-rose-200 hover:bg-rose-50"
                                >
                                  Reject
                                </Button>
                                <Button
                                  variant="primary"
                                  onClick={() => setClaimToApprove(claim)}
                                  className="h-7 px-2.5 text-xs flex items-center gap-1"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Approve</span>
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: REIMBURSEMENT PAYOUTS                                              */}
      {/* ========================================================================= */}
      {activeTab === 'REIMBURSEMENTS' && (
        <div className="space-y-4">
          <div className="bg-white p-4 border border-slate-200 rounded flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Approved Claims Ready for Payout
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Settling claims credits your bank account and clears account 2050 (Employee
                Reimbursements Payable). Select multiple claims to generate an APCA Cemtex .ABA file.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                disabled={selectedClaimIdsForBatch.length === 0}
                onClick={() => setOpenBatchModal(true)}
                className="text-xs flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  Create .ABA Pay Run ({selectedClaimIdsForBatch.length})
                </span>
              </Button>
            </div>
          </div>

          <div className="border border-slate-200 rounded bg-white overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={
                        approvedClaims.length > 0 &&
                        selectedClaimIdsForBatch.length === approvedClaims.length
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedClaimIdsForBatch(approvedClaims.map((c) => c.id));
                        } else {
                          setSelectedClaimIdsForBatch([]);
                        }
                      }}
                      className="rounded border-slate-300"
                    />
                  </th>
                  <th className="py-2.5 px-3">Approved Date</th>
                  <th className="py-2.5 px-3">Claim #</th>
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3">Title</th>
                  <th className="py-2.5 px-3 text-right">Reimbursement Total</th>
                  <th className="py-2.5 px-3 text-center">Bank Account (BSB / Acc)</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingClaims ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Loading approved claims...
                    </td>
                  </tr>
                ) : approvedClaims.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      No approved claims pending reimbursement.
                    </td>
                  </tr>
                ) : (
                  approvedClaims.map((claim) => {
                    const isSelected = selectedClaimIdsForBatch.includes(claim.id);
                    const hasEft =
                      !!claim.member?.bankBsb && !!claim.member?.bankAccountNumber;

                    return (
                      <tr
                        key={claim.id}
                        className={`hover:bg-slate-50/50 transition-colors ${
                          isSelected ? 'bg-slate-50/80' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedClaimIdsForBatch((prev) => [...prev, claim.id]);
                              } else {
                                setSelectedClaimIdsForBatch((prev) =>
                                  prev.filter((id) => id !== claim.id),
                                );
                              }
                            }}
                            className="rounded border-slate-300"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {formatDate(claim.approvedAt || claim.updatedAt)}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                          {claim.claimNumber}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          <div className="font-medium">
                            {claim.member?.user?.name || 'Staff Member'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {claim.member?.bankAccountName || 'Account Name Missing'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-800 font-medium max-w-xs truncate">
                          {claim.title}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                          {formatCents(claim.totalAmountCents)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {hasEft ? (
                            <span className="font-mono text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                              {formatBsb(claim.member?.bankBsb)} ····{' '}
                              {claim.member?.bankAccountNumber?.slice(-4)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-rose-700 bg-rose-50 px-2 py-0.5 rounded font-medium inline-flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              Missing Banking
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              onClick={() => setInspectClaim(claim)}
                              className="p-1 h-7 w-7 text-slate-600"
                              title="Inspect Details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setClaimToPay(claim)}
                              className="h-7 px-2 text-xs flex items-center gap-1"
                            >
                              <DollarSign className="w-3 h-3" />
                              <span>Settle</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: MY OUT-OF-POCKET CLAIMS                                            */}
      {/* ========================================================================= */}
      {activeTab === 'MY_CLAIMS' && (
        <div className="space-y-4">
          {/* Pipeline Ribbon */}
          <PipelineRibbon
            stages={myClaimsPipeline}
            activeStageId={claimStatusFilter}
            onSelectStage={(id) => setClaimStatusFilter(id)}
          />

          {/* Search bar */}
          <div className="flex items-center justify-between gap-3 bg-white p-3 border border-slate-200 rounded">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search my claims by # or title..."
                value={claimsSearch}
                onChange={(e) => setClaimsSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>

            <Button
              variant="outline"
              onClick={() => loadClaimsData()}
              className="text-xs flex items-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </Button>
          </div>

          {/* Table */}
          <div className="border border-slate-200 rounded bg-white overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Claim #</th>
                  <th className="py-2.5 px-3">Title / Business Purpose</th>
                  <th className="py-2.5 px-3 text-center">Items</th>
                  <th className="py-2.5 px-3 text-right">Tax (GST)</th>
                  <th className="py-2.5 px-3 text-right">Total Amount</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingClaims ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Loading claims...
                    </td>
                  </tr>
                ) : filteredMyClaims.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      No expense claims found. Click "New Expense Claim" above to submit an out-of-pocket claim.
                    </td>
                  </tr>
                ) : (
                  filteredMyClaims.map((claim) => (
                    <tr
                      key={claim.id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {formatDate(claim.createdAt)}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                        {claim.claimNumber}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800 max-w-sm">
                        <div className="font-medium truncate">{claim.title}</div>
                        {claim.description && (
                          <div className="text-[11px] text-slate-400 truncate">
                            {claim.description}
                          </div>
                        )}
                        {claim.status === 'REJECTED' && claim.rejectionReason && (
                          <div className="text-[11px] text-rose-700 bg-rose-50 p-1 rounded mt-1">
                            Reason: {claim.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                        {claim.items.length}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                        {formatCents(claim.taxTotalCents)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                        {formatCents(claim.totalAmountCents)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <StatusTag
                          tone={getStatusTone(claim.status)}
                          mono
                          className="text-[11px]"
                        >
                          {claim.status}
                        </StatusTag>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            onClick={() => setInspectClaim(claim)}
                            className="p-1 h-7 w-7 text-slate-600"
                            title="Inspect Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>

                          {claim.status === 'DRAFT' && (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setEditingClaim(claim);
                                  setOpenClaimModal(true);
                                }}
                                className="h-7 px-2 text-xs flex items-center gap-1"
                              >
                                <Edit2 className="w-3 h-3" />
                                <span>Edit</span>
                              </Button>

                              <Button
                                variant="primary"
                                onClick={() => setClaimToSubmit(claim)}
                                className="h-7 px-2.5 text-xs flex items-center gap-1"
                              >
                                <Send className="w-3 h-3" />
                                <span>Submit</span>
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: MY REIMBURSEMENT BANKING                                           */}
      {/* ========================================================================= */}
      {activeTab === 'MY_BANKING' && (
        <div className="max-w-2xl bg-white border border-slate-200 rounded p-6 shadow-xs space-y-6">
          <div>
            <div className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-slate-900" />
              <h2 className="text-base font-semibold text-slate-900">
                Employee Reimbursement Banking Profile
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Your direct deposit details are used by Finance to disburse approved out-of-pocket
              reimbursements via automated APCA Cemtex .ABA bank runs.
            </p>
          </div>

          {bankingSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{bankingSuccess}</span>
            </div>
          )}

          {bankingError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{bankingError}</span>
            </div>
          )}

          <form onSubmit={handleSaveBanking} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Bank BSB (6 Digits)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 083-004"
                  value={bankingBsb}
                  onChange={(e) => setBankingBsb(e.target.value)}
                  mono
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Standard Australian Bank State Branch code.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Number (Up to 9 Digits)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 12345678"
                  value={bankingAccountNumber}
                  onChange={(e) => setBankingAccountNumber(e.target.value)}
                  mono
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Account Name / Payee Name
              </label>
              <Input
                type="text"
                placeholder="e.g. J Delaney-Abdy"
                value={bankingAccountName}
                onChange={(e) => setBankingAccountName(e.target.value)}
                required
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Must match the name on your bank account for APCA verification.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Department
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Engineering, Sales, Operations"
                  value={bankingDepartment}
                  onChange={(e) => setBankingDepartment(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Job Title
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Senior Software Engineer"
                  value={bankingJobTitle}
                  onChange={(e) => setBankingJobTitle(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <Button
                variant="primary"
                type="submit"
                disabled={savingBanking}
                className="text-xs"
              >
                {savingBanking ? 'Saving Profile...' : 'Save Reimbursement Banking'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RECORD DIRECT SPEND MONEY                                          */}
      {/* ========================================================================= */}
      <RecordDirectSpendModal
        open={openDirectModal}
        onClose={() => setOpenDirectModal(false)}
        bankAccounts={bankAccounts}
        expenseAccounts={expenseAccounts}
        contacts={contacts}
        trackingCategories={trackingCategories}
        onSuccess={() => {
          setOpenDirectModal(false);
          setActionSuccess('Direct spend money transaction recorded and posted to GL.');
          void loadDirectTransactions();
        }}
      />

      {/* ========================================================================= */}
      {/* MODAL: CREATE / EDIT EXPENSE CLAIM                                        */}
      {/* ========================================================================= */}
      <CreateEditClaimModal
        open={openClaimModal}
        onClose={() => {
          setOpenClaimModal(false);
          setEditingClaim(null);
        }}
        claim={editingClaim}
        expenseAccounts={expenseAccounts}
        trackingCategories={trackingCategories}
        onSuccess={() => {
          setOpenClaimModal(false);
          setEditingClaim(null);
          setActionSuccess('Expense claim saved successfully.');
          void loadClaimsData();
        }}
      />

      {/* ========================================================================= */}
      {/* MODAL: CONFIRM CLAIM SUBMISSION                                           */}
      {/* ========================================================================= */}
      <Modal
        open={!!claimToSubmit}
        onClose={() => setClaimToSubmit(null)}
        title="Submit Claim for Approval"
      >
        <div className="space-y-3 text-xs text-slate-600">
          <p>
            Are you sure you want to submit claim{' '}
            <strong className="text-slate-900 font-mono">
              {claimToSubmit?.claimNumber}
            </strong>{' '}
            ({formatCents(claimToSubmit?.totalAmountCents || 0)}) for manager review?
          </p>
          <p className="text-slate-500">
            Once submitted, line items cannot be modified unless rejected by your reviewer.
          </p>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="outline" onClick={() => setClaimToSubmit(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmSubmit}>
              Submit Now
            </Button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: CONFIRM CLAIM APPROVAL                                             */}
      {/* ========================================================================= */}
      <Modal
        open={!!claimToApprove}
        onClose={() => setClaimToApprove(null)}
        title="Approve Out-of-Pocket Claim"
      >
        <div className="space-y-4 text-xs text-slate-600">
          <p>
            You are approving claim{' '}
            <strong className="text-slate-900 font-mono">
              {claimToApprove?.claimNumber}
            </strong>{' '}
            submitted by{' '}
            <strong className="text-slate-900">
              {claimToApprove?.member?.user?.name || 'Employee'}
            </strong>{' '}
            for a total of{' '}
            <strong className="text-slate-900 font-mono">
              {formatCents(claimToApprove?.totalAmountCents || 0)}
            </strong>
            .
          </p>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] space-y-1">
            <div className="text-slate-500 font-semibold mb-1">
              General Ledger Posting Preview:
            </div>
            <div className="flex justify-between text-slate-800">
              <span>DEBIT Expense Accounts (Net)</span>
              <span>
                {formatCents(
                  (claimToApprove?.totalAmountCents || 0) -
                    (claimToApprove?.taxTotalCents || 0),
                )}
              </span>
            </div>
            {(claimToApprove?.taxTotalCents || 0) > 0 && (
              <div className="flex justify-between text-slate-800">
                <span>DEBIT 2200 GST Paid</span>
                <span>{formatCents(claimToApprove?.taxTotalCents || 0)}</span>
              </div>
            )}
            <div className="flex justify-between text-forest-800 font-semibold border-t border-slate-200 pt-1">
              <span>CREDIT 2050 Employee Reimbursements Payable</span>
              <span>{formatCents(claimToApprove?.totalAmountCents || 0)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setClaimToApprove(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmApprove}>
              Confirm Approval & Post GL
            </Button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: REJECT CLAIM                                                       */}
      {/* ========================================================================= */}
      <Modal
        open={!!claimToReject}
        onClose={() => {
          setClaimToReject(null);
          setRejectionReason('');
        }}
        title="Reject Expense Claim"
      >
        <div className="space-y-3 text-xs">
          <p className="text-slate-600">
            Please provide a reason for rejecting claim{' '}
            <strong className="text-slate-900 font-mono">
              {claimToReject?.claimNumber}
            </strong>
            . The employee will be able to review the note and resubmit.
          </p>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Rejection Reason / Guidance
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Please attach tax invoice showing GST breakdown for merchant Uber."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full text-xs p-2 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setClaimToReject(null);
                setRejectionReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!rejectionReason.trim()}
              onClick={handleConfirmReject}
            >
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: SINGLE CLAIM SETTLEMENT                                            */}
      {/* ========================================================================= */}
      <SettleSingleClaimModal
        open={!!claimToPay}
        onClose={() => setClaimToPay(null)}
        claim={claimToPay}
        bankAccounts={bankAccounts}
        onConfirm={handleConfirmPaySingle}
      />

      {/* ========================================================================= */}
      {/* MODAL: BATCH .ABA REIMBURSEMENT PAY RUN                                  */}
      {/* ========================================================================= */}
      <CreateBatchModal
        open={openBatchModal}
        onClose={() => setOpenBatchModal(false)}
        selectedClaimIds={selectedClaimIdsForBatch}
        approvedClaims={approvedClaims}
        bankAccounts={bankAccounts}
        onConfirm={handleExecuteBatchPayment}
      />

      {/* ========================================================================= */}
      {/* DRAWER: INSPECT CLAIM DETAILS                                             */}
      {/* ========================================================================= */}
      <InspectClaimDrawer
        claim={inspectClaim}
        onClose={() => setInspectClaim(null)}
      />

      {/* ========================================================================= */}
      {/* DRAWER: INSPECT DIRECT TRANSACTION DETAILS                                */}
      {/* ========================================================================= */}
      <InspectDirectTxnDrawer
        transaction={inspectDirectTxn}
        onClose={() => setInspectDirectTxn(null)}
      />
    </div>
  );
}

// =============================================================================
// SUB-COMPONENT: RECORD DIRECT SPEND MODAL
// =============================================================================

interface RecordDirectSpendModalProps {
  open: boolean;
  onClose: () => void;
  bankAccounts: Account[];
  expenseAccounts: Account[];
  contacts: Contact[];
  trackingCategories: TrackingCategory[];
  onSuccess: () => void;
}

function RecordDirectSpendModal({
  open,
  onClose,
  bankAccounts,
  expenseAccounts,
  contacts,
  trackingCategories,
  onSuccess,
}: RecordDirectSpendModalProps) {
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || '');
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [contactId, setContactId] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<DirectLineDraft[]>([
    {
      id: '1',
      accountId: expenseAccounts[0]?.id || '',
      description: '',
      amount: '',
      taxTreatment: 'TAX_EXCLUSIVE',
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bankAccounts.length > 0 && !bankAccountId) {
      setBankAccountId(bankAccounts[0]!.id);
    }
    if (expenseAccounts.length > 0 && lines[0] && !lines[0].accountId) {
      setLines((prev) => [
        { ...prev[0]!, accountId: expenseAccounts[0]!.id },
        ...prev.slice(1),
      ]);
    }
  }, [bankAccounts, expenseAccounts]);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        accountId: expenseAccounts[0]?.id || '',
        description: '',
        amount: '',
        taxTreatment: 'TAX_EXCLUSIVE',
      },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length === 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, field: keyof DirectLineDraft, val: any) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: val } : l)),
    );
  };

  // Live calculation
  const totals = useMemo(() => {
    let subtotalCents = 0;
    let gstCents = 0;

    for (const l of lines) {
      const val = parseFloat(l.amount) || 0;
      const cents = Math.round(val * 100);
      if (cents <= 0) continue;

      if (l.taxTreatment === 'TAX_EXCLUSIVE') {
        const sub = cents;
        const gst = Math.round(sub * 0.1);
        subtotalCents += sub;
        gstCents += gst;
      } else if (l.taxTreatment === 'TAX_INCLUSIVE') {
        const total = cents;
        const gst = Math.round(total - total / 1.1);
        const sub = total - gst;
        subtotalCents += sub;
        gstCents += gst;
      } else {
        subtotalCents += cents;
      }
    }

    return {
      subtotalCents,
      gstCents,
      totalCents: subtotalCents + gstCents,
    };
  }, [lines]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankAccountId) {
      setError('Please select a payment bank account.');
      return;
    }

    const processedLines = lines
      .map((l) => {
        const val = parseFloat(l.amount) || 0;
        const cents = Math.round(val * 100);
        return {
          accountId: l.accountId,
          description: l.description.trim() || 'Direct Expense',
          amountCents: cents,
          taxTreatment: l.taxTreatment,
          trackingOptionId: l.trackingOptionId || null,
        };
      })
      .filter((l) => l.amountCents > 0);

    if (processedLines.length === 0) {
      setError('Please provide at least one line with an amount greater than zero.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await directTransactionApi.create({
        type: 'SPEND_MONEY',
        transactionDate,
        bankAccountId,
        contactId: contactId || null,
        reference: reference.trim() || null,
        description: description.trim() || null,
        lines: processedLines,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to record direct spend transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record Direct Spend Money (Card / Bank)"
      size="5xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Paid From (Bank / Card Account) *
            </label>
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="w-full p-2 bg-white border border-slate-200 rounded font-mono focus:outline-none"
              required
            >
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} - {b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Transaction Date *
            </label>
            <Input
              type="date"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Payee / Contact
            </label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="w-full p-2 bg-white border border-slate-200 rounded focus:outline-none"
            >
              <option value="">Select or leave blank...</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Reference / Card Receipt #
            </label>
            <Input
              type="text"
              placeholder="e.g. CARD-4921 or Receipt #1049"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            General Memo
          </label>
          <Input
            type="text"
            placeholder="e.g. Monthly cloud hosting card debit"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Multi-Line Items */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">
              Account Allocation & Lines
            </span>
            <Button
              type="button"
              variant="ghost"
              onClick={addLine}
              className="text-[11px] h-6 px-2 text-slate-600 hover:text-slate-900"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Line
            </Button>
          </div>

          <div className="space-y-2">
            {lines.map((l, idx) => (
              <div
                key={l.id}
                className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded border border-slate-200"
              >
                <div className="col-span-3">
                  <select
                    value={l.accountId}
                    onChange={(e) => updateLine(l.id, 'accountId', e.target.value)}
                    className="w-full p-1.5 bg-white border border-slate-200 rounded font-mono text-[11px]"
                    required
                  >
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-3">
                  <input
                    type="text"
                    placeholder="Description"
                    value={l.description}
                    onChange={(e) => updateLine(l.id, 'description', e.target.value)}
                    className="w-full p-1.5 bg-white border border-slate-200 rounded text-[11px]"
                  />
                </div>

                <div className="col-span-2">
                  <select
                    value={l.taxTreatment}
                    onChange={(e) =>
                      updateLine(l.id, 'taxTreatment', e.target.value as TaxTreatment)
                    }
                    className="w-full p-1.5 bg-white border border-slate-200 rounded text-[11px]"
                  >
                    <option value="TAX_EXCLUSIVE">Tax Exclusive</option>
                    <option value="TAX_INCLUSIVE">Tax Inclusive</option>
                    <option value="GST_FREE">GST Free</option>
                  </select>
                </div>

                <div className="col-span-3">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={l.amount}
                    onChange={(e) => updateLine(l.id, 'amount', e.target.value)}
                    className="w-full p-1.5 bg-white border border-slate-200 rounded text-right font-mono text-[11px]"
                    required
                  />
                </div>

                <div className="col-span-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeLine(l.id)}
                    disabled={lines.length === 1}
                    className="text-slate-400 hover:text-rose-600 disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Calculation Box */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1.5 font-mono text-[11px]">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal (Excl. GST):</span>
            <span>{formatCents(totals.subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Australian GST (10%):</span>
            <span>{formatCents(totals.gstCents)}</span>
          </div>
          <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1 text-xs">
            <span>Total Payment Amount:</span>
            <span>{formatCents(totals.totalCents)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || totals.totalCents <= 0}
          >
            {submitting ? 'Recording & Posting GL...' : 'Post Spend Money'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// =============================================================================
// SUB-COMPONENT: CREATE / EDIT EXPENSE CLAIM MODAL
// =============================================================================

interface CreateEditClaimModalProps {
  open: boolean;
  onClose: () => void;
  claim: ExpenseClaim | null;
  expenseAccounts: Account[];
  trackingCategories: TrackingCategory[];
  onSuccess: () => void;
}

function CreateEditClaimModal({
  open,
  onClose,
  claim,
  expenseAccounts,
  trackingCategories,
  onSuccess,
}: CreateEditClaimModalProps) {
  const [title, setTitle] = useState(claim?.title || '');
  const [notes, setNotes] = useState(claim?.description || '');
  const [items, setItems] = useState<ExpenseItemDraft[]>([
    {
      id: '1',
      expenseDate: new Date().toISOString().slice(0, 10),
      merchant: '',
      description: '',
      accountId: expenseAccounts[0]?.id || '',
      amount: '',
      taxTreatment: 'TAX_INCLUSIVE',
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (claim) {
      setTitle(claim.title);
      setNotes(claim.description || '');
      if (claim.items.length > 0) {
        setItems(
          claim.items.map((it) => ({
            id: it.id,
            expenseDate: it.expenseDate.slice(0, 10),
            merchant: it.merchant || '',
            description: it.description,
            accountId: it.accountId,
            amount: (it.amountCents / 100).toFixed(2),
            taxTreatment: it.taxTreatment,
            trackingOptionId: it.trackingCategoryOptionId || undefined,
          })),
        );
      }
    } else {
      setTitle('');
      setNotes('');
      setItems([
        {
          id: '1',
          expenseDate: new Date().toISOString().slice(0, 10),
          merchant: '',
          description: '',
          accountId: expenseAccounts[0]?.id || '',
          amount: '',
          taxTreatment: 'TAX_INCLUSIVE',
        },
      ]);
    }
  }, [claim, expenseAccounts]);

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        expenseDate: new Date().toISOString().slice(0, 10),
        merchant: '',
        description: '',
        accountId: expenseAccounts[0]?.id || '',
        amount: '',
        taxTreatment: 'TAX_INCLUSIVE',
      },
    ]);
  };

  const removeItem = (id: string) => {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const updateItem = (id: string, field: keyof ExpenseItemDraft, val: any) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: val } : it)),
    );
  };

  const totals = useMemo(() => {
    let subtotalCents = 0;
    let gstCents = 0;

    for (const it of items) {
      const val = parseFloat(it.amount) || 0;
      const cents = Math.round(val * 100);
      if (cents <= 0) continue;

      if (it.taxTreatment === 'TAX_INCLUSIVE') {
        const total = cents;
        const gst = Math.round(total - total / 1.1);
        const sub = total - gst;
        subtotalCents += sub;
        gstCents += gst;
      } else if (it.taxTreatment === 'TAX_EXCLUSIVE') {
        const sub = cents;
        const gst = Math.round(sub * 0.1);
        subtotalCents += sub;
        gstCents += gst;
      } else {
        subtotalCents += cents;
      }
    }

    return {
      subtotalCents,
      gstCents,
      totalCents: subtotalCents + gstCents,
    };
  }, [items]);

  const handleSave = async (submitNow: boolean) => {
    if (!title.trim()) {
      setError('Please provide a title for this expense claim.');
      return;
    }

    const processedItems = items
      .map((it) => {
        const val = parseFloat(it.amount) || 0;
        const cents = Math.round(val * 100);
        return {
          expenseDate: it.expenseDate,
          merchant: it.merchant.trim() || 'General Merchant',
          description: it.description.trim() || 'Out of pocket expense',
          accountId: it.accountId || undefined,
          amountCents: cents,
          taxTreatment: it.taxTreatment,
          trackingOptionId: it.trackingOptionId || null,
        };
      })
      .filter((it) => it.amountCents > 0);

    if (processedItems.length === 0) {
      setError('Please provide at least one expense item with an amount.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (claim) {
        await expenseClaimApi.update(claim.id, {
          title: title.trim(),
          notes: notes.trim() || null,
          submitNow,
          items: processedItems,
        });
      } else {
        await expenseClaimApi.create({
          title: title.trim(),
          notes: notes.trim() || null,
          submitNow,
          items: processedItems,
        });
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to save expense claim.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={claim ? `Edit Claim ${claim.claimNumber}` : 'New Out-of-Pocket Expense Claim'}
      size="5xl"
    >
      <div className="space-y-4 text-xs">
        {error && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded">
            {error}
          </div>
        )}

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Claim Title / Summary *
          </label>
          <Input
            type="text"
            placeholder="e.g. Sydney Client Presentation & Travel Expenses"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Business Purpose / Notes
          </label>
          <Input
            type="text"
            placeholder="e.g. Reimbursable travel expenses incurred during Q2 audit meetings"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* Expense Items */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">
              Receipt Items & Purchases
            </span>
            <Button
              type="button"
              variant="ghost"
              onClick={addItem}
              className="text-[11px] h-6 px-2 text-slate-600 hover:text-slate-900"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Item
            </Button>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {items.map((it) => (
              <div
                key={it.id}
                className="p-2 bg-slate-50 border border-slate-200 rounded space-y-2"
              >
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-3">
                    <input
                      type="date"
                      value={it.expenseDate}
                      onChange={(e) => updateItem(it.id, 'expenseDate', e.target.value)}
                      className="w-full p-1.5 bg-white border border-slate-200 rounded text-[11px]"
                    />
                  </div>

                  <div className="col-span-4">
                    <input
                      type="text"
                      placeholder="Merchant (e.g. Uber, Qantas)"
                      value={it.merchant}
                      onChange={(e) => updateItem(it.id, 'merchant', e.target.value)}
                      className="w-full p-1.5 bg-white border border-slate-200 rounded text-[11px]"
                      required
                    />
                  </div>

                  <div className="col-span-5">
                    <input
                      type="text"
                      placeholder="Item description"
                      value={it.description}
                      onChange={(e) => updateItem(it.id, 'description', e.target.value)}
                      className="w-full p-1.5 bg-white border border-slate-200 rounded text-[11px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4">
                    <select
                      value={it.accountId}
                      onChange={(e) => updateItem(it.id, 'accountId', e.target.value)}
                      className="w-full p-1.5 bg-white border border-slate-200 rounded font-mono text-[11px]"
                    >
                      {expenseAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} - {a.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-3">
                    <select
                      value={it.taxTreatment}
                      onChange={(e) =>
                        updateItem(it.id, 'taxTreatment', e.target.value as TaxTreatment)
                      }
                      className="w-full p-1.5 bg-white border border-slate-200 rounded text-[11px]"
                    >
                      <option value="TAX_INCLUSIVE">GST Inclusive (Default)</option>
                      <option value="TAX_EXCLUSIVE">GST Exclusive</option>
                      <option value="GST_FREE">GST Free</option>
                    </select>
                  </div>

                  <div className="col-span-4">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Amount $"
                      value={it.amount}
                      onChange={(e) => updateItem(it.id, 'amount', e.target.value)}
                      className="w-full p-1.5 bg-white border border-slate-200 rounded text-right font-mono text-[11px]"
                      required
                    />
                  </div>

                  <div className="col-span-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      disabled={items.length === 1}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Totals Summary */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1 font-mono text-[11px]">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal (Excl. GST):</span>
            <span>{formatCents(totals.subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Australian GST Component:</span>
            <span>{formatCents(totals.gstCents)}</span>
          </div>
          <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1 text-xs">
            <span>Total Claim Amount:</span>
            <span>{formatCents(totals.totalCents)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => handleSave(false)}
          >
            Save as Draft
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitting || totals.totalCents <= 0}
            onClick={() => handleSave(true)}
          >
            {submitting ? 'Submitting...' : 'Submit for Approval'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// SUB-COMPONENT: SETTLE SINGLE CLAIM MODAL
// =============================================================================

interface SettleSingleClaimModalProps {
  open: boolean;
  onClose: () => void;
  claim: ExpenseClaim | null;
  bankAccounts: Account[];
  onConfirm: (bankAccountId: string) => void;
}

function SettleSingleClaimModal({
  open,
  onClose,
  claim,
  bankAccounts,
  onConfirm,
}: SettleSingleClaimModalProps) {
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || '');

  useEffect(() => {
    if (bankAccounts.length > 0 && !bankAccountId) {
      setBankAccountId(bankAccounts[0]!.id);
    }
  }, [bankAccounts]);

  if (!claim) return null;

  return (
    <Modal open={open} onClose={onClose} title="Settle Single Reimbursement" size="lg">
      <div className="space-y-4 text-xs text-slate-600">
        <p>
          Disburse reimbursement for claim{' '}
          <strong className="text-slate-900 font-mono">{claim.claimNumber}</strong> to{' '}
          <strong className="text-slate-900">
            {claim.member?.user?.name || 'Staff Member'}
          </strong>
          .
        </p>

        <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-500">Employee Banking:</span>
            <span className="font-mono text-slate-800">
              BSB: {formatBsb(claim.member?.bankBsb)} · Acc:{' '}
              {claim.member?.bankAccountNumber || 'None'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Account Name:</span>
            <span className="font-medium text-slate-800">
              {claim.member?.bankAccountName || 'Missing'}
            </span>
          </div>
          <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1 text-xs">
            <span>Reimbursement Amount:</span>
            <span className="font-mono">{formatCents(claim.totalAmountCents)}</span>
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Pay From Operating Bank Account
          </label>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="w-full p-2 bg-white border border-slate-200 rounded font-mono focus:outline-none"
            required
          >
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} - {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(bankAccountId)}
            disabled={!bankAccountId}
          >
            Confirm Payout & Post GL
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// SUB-COMPONENT: BATCH .ABA PAY RUN MODAL
// =============================================================================

interface CreateBatchModalProps {
  open: boolean;
  onClose: () => void;
  selectedClaimIds: string[];
  approvedClaims: ExpenseClaim[];
  bankAccounts: Account[];
  onConfirm: (bankAccountId: string) => void;
}

function CreateBatchModal({
  open,
  onClose,
  selectedClaimIds,
  approvedClaims,
  bankAccounts,
  onConfirm,
}: CreateBatchModalProps) {
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || '');

  useEffect(() => {
    if (bankAccounts.length > 0 && !bankAccountId) {
      setBankAccountId(bankAccounts[0]!.id);
    }
  }, [bankAccounts]);

  const selectedClaims = useMemo(
    () => approvedClaims.filter((c) => selectedClaimIds.includes(c.id)),
    [approvedClaims, selectedClaimIds],
  );

  const totalCents = useMemo(
    () => selectedClaims.reduce((acc, c) => acc + c.totalAmountCents, 0),
    [selectedClaims],
  );

  const missingBanking = useMemo(
    () =>
      selectedClaims.filter(
        (c) => !c.member?.bankBsb || !c.member?.bankAccountNumber,
      ),
    [selectedClaims],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create APCA Cemtex .ABA Reimbursement Run"
      size="4xl"
    >
      <div className="space-y-4 text-xs text-slate-600">
        <p>
          You are preparing an automated EFT batch payment run for{' '}
          <strong className="text-slate-900">{selectedClaims.length}</strong> approved
          claims totaling{' '}
          <strong className="text-slate-900 font-mono">
            {formatCents(totalCents)}
          </strong>
          .
        </p>

        {missingBanking.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Warning: Missing Employee Banking Details</span>
            </div>
            <p className="text-[11px]">
              {missingBanking.length} claim(s) belong to employees who have not yet
              configured their BSB or account number. Please ensure their banking details
              are updated before uploading to your bank.
            </p>
          </div>
        )}

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Source Operating Bank Account
          </label>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="w-full p-2 bg-white border border-slate-200 rounded font-mono focus:outline-none"
            required
          >
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} - {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="p-3 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] space-y-1">
          <div className="text-slate-500 font-semibold mb-1">
            Batch Settlement Journal Posting:
          </div>
          <div className="flex justify-between text-slate-800">
            <span>DEBIT 2050 Employee Reimbursements Payable</span>
            <span>{formatCents(totalCents)}</span>
          </div>
          <div className="flex justify-between text-forest-800 font-semibold border-t border-slate-200 pt-1">
            <span>CREDIT Selected Bank Account</span>
            <span>{formatCents(totalCents)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(bankAccountId)}
            disabled={!bankAccountId || selectedClaims.length === 0}
          >
            Generate .ABA & Settle Run
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// SUB-COMPONENT: INSPECT CLAIM DRAWER
// =============================================================================

function InspectClaimDrawer({
  claim,
  onClose,
}: {
  claim: ExpenseClaim | null;
  onClose: () => void;
}) {
  if (!claim) return null;

  return (
    <Drawer
      open={!!claim}
      onClose={onClose}
      title={`Claim ${claim.claimNumber}`}
      subtitle={claim.title}
      badge={
        <StatusTag tone="emerald" mono className="text-xs">
          {claim.status}
        </StatusTag>
      }
    >
      <div className="space-y-6 text-xs">
        {/* Header Metadata */}
        <div className="bg-slate-50 border border-slate-200 rounded p-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-500">Employee:</span>
            <span className="font-semibold text-slate-900">
              {claim.member?.user?.name || 'Staff Member'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Department / Role:</span>
            <span className="text-slate-700">
              {claim.member?.department || claim.member?.jobTitle || 'General Staff'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Created:</span>
            <span className="font-mono text-slate-700">{formatDate(claim.createdAt)}</span>
          </div>
          {claim.submittedAt && (
            <div className="flex justify-between">
              <span className="text-slate-500">Submitted:</span>
              <span className="font-mono text-slate-700">
                {formatDate(claim.submittedAt)}
              </span>
            </div>
          )}
          {claim.approvedAt && (
            <div className="flex justify-between">
              <span className="text-slate-500">Approved:</span>
              <span className="font-mono text-emerald-800 font-medium">
                {formatDate(claim.approvedAt)} by{' '}
                {claim.approvedBy?.user?.name || 'Manager'}
              </span>
            </div>
          )}
          {claim.paidAt && (
            <div className="flex justify-between">
              <span className="text-slate-500">Reimbursed (Paid):</span>
              <span className="font-mono text-forest-800 font-medium">
                {formatDate(claim.paidAt)}
              </span>
            </div>
          )}
        </div>

        {/* Line Items */}
        <div className="space-y-2">
          <h4 className="font-semibold text-slate-900">Receipt Items</h4>
          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2.5">Date</th>
                  <th className="py-2 px-2.5">Merchant / Description</th>
                  <th className="py-2 px-2.5">Account</th>
                  <th className="py-2 px-2.5 text-right">GST</th>
                  <th className="py-2 px-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {claim.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2 px-2.5 font-mono text-slate-600">
                      {formatDate(it.expenseDate)}
                    </td>
                    <td className="py-2 px-2.5 text-slate-800">
                      <div className="font-medium">{it.merchant || 'Merchant'}</div>
                      <div className="text-[11px] text-slate-500">{it.description}</div>
                    </td>
                    <td className="py-2 px-2.5 font-mono text-slate-600">
                      {it.account ? `${it.account.code} - ${it.account.name}` : 'Expense'}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono text-slate-600">
                      {formatCents(it.taxAmountCents)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-semibold text-slate-900">
                      {formatCents(it.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Claim Totals */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] space-y-1">
          <div className="flex justify-between text-slate-600">
            <span>Net Expense:</span>
            <span>{formatCents(claim.totalAmountCents - claim.taxTotalCents)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>GST Component:</span>
            <span>{formatCents(claim.taxTotalCents)}</span>
          </div>
          <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1 text-xs">
            <span>Total Payable:</span>
            <span>{formatCents(claim.totalAmountCents)}</span>
          </div>
        </div>

        {/* Journal Entries */}
        {claim.journalEntry && (
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
              <FileCheck2 className="w-4 h-4 text-emerald-600" />
              <span>Approval Journal Entry ({claim.journalEntry.entryNumber})</span>
            </h4>
            <div className="border border-slate-200 rounded overflow-hidden">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-1.5 px-2">Account</th>
                    <th className="py-1.5 px-2 text-right">Debit</th>
                    <th className="py-1.5 px-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {claim.journalEntry.lines?.map((jl) => (
                    <tr key={jl.id}>
                      <td className="py-1.5 px-2">
                        {jl.account?.code} - {jl.account?.name}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-900">
                        {jl.entryType === 'DEBIT' ? formatCents(jl.amountCents) : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-900">
                        {jl.entryType === 'CREDIT' ? formatCents(jl.amountCents) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

// =============================================================================
// SUB-COMPONENT: INSPECT DIRECT TRANSACTION DRAWER
// =============================================================================

function InspectDirectTxnDrawer({
  transaction,
  onClose,
}: {
  transaction: DirectTransaction | null;
  onClose: () => void;
}) {
  if (!transaction) return null;

  return (
    <Drawer
      open={!!transaction}
      onClose={onClose}
      title={`Transaction ${transaction.transactionNumber}`}
      subtitle={transaction.description || 'Direct Spend Money'}
      badge={
        <StatusTag tone="emerald" mono className="text-xs">
          POSTED
        </StatusTag>
      }
    >
      <div className="space-y-6 text-xs">
        <div className="bg-slate-50 border border-slate-200 rounded p-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-500">Date:</span>
            <span className="font-mono text-slate-800">
              {formatDate(transaction.transactionDate)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Source Account:</span>
            <span className="font-mono text-slate-900 font-semibold">
              {transaction.bankAccount?.code} - {transaction.bankAccount?.name}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Payee / Contact:</span>
            <span className="text-slate-800">
              {transaction.contact?.name || transaction.reference || '—'}
            </span>
          </div>
          {transaction.reference && (
            <div className="flex justify-between">
              <span className="text-slate-500">Reference:</span>
              <span className="font-mono text-slate-700">{transaction.reference}</span>
            </div>
          )}
        </div>

        {/* Lines */}
        <div className="space-y-2">
          <h4 className="font-semibold text-slate-900">Distribution Lines</h4>
          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2.5">Account</th>
                  <th className="py-2 px-2.5">Description</th>
                  <th className="py-2 px-2.5 text-right">GST</th>
                  <th className="py-2 px-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transaction.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 px-2.5 font-mono text-slate-700">
                      {l.account ? `${l.account.code} - ${l.account.name}` : 'Expense'}
                    </td>
                    <td className="py-2 px-2.5 text-slate-800">{l.description}</td>
                    <td className="py-2 px-2.5 text-right font-mono text-slate-600">
                      {formatCents(l.taxAmountCents)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-semibold text-slate-900">
                      {formatCents(l.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] space-y-1">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal (Net):</span>
            <span>{formatCents(transaction.subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Australian GST (2200):</span>
            <span>{formatCents(transaction.taxTotalCents)}</span>
          </div>
          <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1 text-xs">
            <span>Total Payment Amount:</span>
            <span>{formatCents(transaction.totalAmountCents)}</span>
          </div>
        </div>

        {/* Journal Entry */}
        {transaction.journalEntry && (
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
              <FileCheck2 className="w-4 h-4 text-emerald-600" />
              <span>Posted Journal Entry ({transaction.journalEntry.entryNumber})</span>
            </h4>
            <div className="border border-slate-200 rounded overflow-hidden">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-1.5 px-2">Account</th>
                    <th className="py-1.5 px-2 text-right">Debit</th>
                    <th className="py-1.5 px-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transaction.journalEntry.lines?.map((jl) => (
                    <tr key={jl.id}>
                      <td className="py-1.5 px-2">
                        {jl.account?.code} - {jl.account?.name}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-900">
                        {jl.entryType === 'DEBIT' ? formatCents(jl.amountCents) : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-900">
                        {jl.entryType === 'CREDIT' ? formatCents(jl.amountCents) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
