import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  ShieldCheck,
  Users,
  UserCheck,
  History,
  Lock,
  Unlock,
  Plus,
  Search,
  Trash2,
  Mail,
  Landmark,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  orgApi,
  ApiError,
  type Role,
  type MemberProfile,
  type OrganizationInvite,
  type AuditLogEntry,
} from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { StatusTag } from '@/components/ui/StatusTag';
import { cn } from '@/lib/utils';

type SettingsTab = 'profile' | 'governance' | 'team' | 'my-profile' | 'audit';

const ALL_ROLES: { value: Role; label: string; description: string }[] = [
  {
    value: 'ADMIN',
    label: 'ADMIN',
    description: 'Full entity control, lock dates, user invites, and CoA governance.',
  },
  {
    value: 'ACCOUNTANT',
    label: 'ACCOUNTANT',
    description: 'Full GL, manual journals, CoA management, AR/AP, and approvals.',
  },
  {
    value: 'MANAGER',
    label: 'MANAGER',
    description: 'Departmental oversight, PO approvals, and team expense claim approvals.',
  },
  {
    value: 'AR_SPECIALIST',
    label: 'AR SPECIALIST',
    description: 'Isolated to Customer Contacts, Quotes, Invoices, and Payments In.',
  },
  {
    value: 'AP_SPECIALIST',
    label: 'AP SPECIALIST',
    description: 'Isolated to Vendor Contacts, Purchase Orders, Bills, and Batch Payments.',
  },
  {
    value: 'EMPLOYEE',
    label: 'EMPLOYEE',
    description: 'Self-service Expense Claim submission and personal reimbursement banking only.',
  },
  {
    value: 'AUDITOR',
    label: 'AUDITOR',
    description: 'Strict read-only inspection across GL, Financial Statements, and Audit Log.',
  },
];

const AVAILABLE_MODULES = [
  {
    key: 'CORE_FINANCE',
    label: 'Core Financial Ledger, AR & AP',
    description: 'General Ledger, Chart of Accounts, Invoices, Bills, Contacts, and Financial Statements.',
    locked: true,
  },
  {
    key: 'EXPENSES',
    label: 'Spend Money & Employee Expense Claims',
    description: 'Direct bank/card spend coding and employee reimbursement workflows (Account 2050).',
    locked: false,
  },
  {
    key: 'FLEET',
    label: 'Fleet & Asset Management Extension',
    description: 'Dedicated vehicle/asset tracking dimensions and maintenance cost allocation.',
    locked: false,
  },
  {
    key: 'INVENTORY',
    label: 'Inventory & Catalog Extension',
    description: 'Standardized SKU items, unit pricing, and stock movement hooks.',
    locked: false,
  },
  {
    key: 'ATTACHMENTS',
    label: 'Cloud Storage Source Document Vault',
    description: 'PDF tax invoice and receipt attachment storage via Google Cloud Storage.',
    locked: false,
  },
];

const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July (Australian Standard FY)' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

function formatABN(abn?: string | null): string {
  if (!abn) return '—';
  const d = abn.replace(/\D/g, '');
  if (d.length !== 11) return abn;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 11)}`;
}

function formatDateTimeAU(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function SettingsPage() {
  const { organization, role, memberProfile, refreshSession } = useAuth();
  const isAdmin = role === 'ADMIN';
  const canViewGovernance =
    role === 'ADMIN' || role === 'ACCOUNTANT' || role === 'AUDITOR';
  const canViewAudit =
    role === 'ADMIN' || role === 'ACCOUNTANT' || role === 'AUDITOR';
  const canViewTeam = role !== 'EMPLOYEE';

  const [activeTab, setActiveTab] = useState<SettingsTab>(
    role === 'EMPLOYEE' ? 'my-profile' : 'profile',
  );

  // Banner feedback
  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Tab 1: Organization Profile & Remittance State
  // -------------------------------------------------------------------------
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [tradingName, setTradingName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [postcode, setPostcode] = useState('');
  const [bankBsb, setBankBsb] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [apcaUserId, setApcaUserId] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // -------------------------------------------------------------------------
  // Tab 2: Governance & Controls State
  // -------------------------------------------------------------------------
  const [lockDate, setLockDate] = useState('');
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(7);
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState(30);
  const [enforceTwoPersonApproval, setEnforceTwoPersonApproval] =
    useState(false);
  const [enabledModules, setEnabledModules] = useState<string[]>([
    'CORE_FINANCE',
    'EXPENSES',
  ]);
  const [savingGovernance, setSavingGovernance] = useState(false);

  // -------------------------------------------------------------------------
  // Tab 3: Team Members & Invites State
  // -------------------------------------------------------------------------
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [invites, setInvites] = useState<OrganizationInvite[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberProfile | null>(
    null,
  );

  // -------------------------------------------------------------------------
  // Tab 4: My Employee Profile State
  // -------------------------------------------------------------------------
  const [myJobTitle, setMyJobTitle] = useState('');
  const [myDepartment, setMyDepartment] = useState('');
  const [myBankBsb, setMyBankBsb] = useState('');
  const [myBankAccountNumber, setMyBankAccountNumber] = useState('');
  const [myBankAccountName, setMyBankAccountName] = useState('');
  const [savingMyProfile, setSavingMyProfile] = useState(false);

  // -------------------------------------------------------------------------
  // Tab 5: Immutable Audit Log State
  // -------------------------------------------------------------------------
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditEntityType, setAuditEntityType] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [selectedAuditEntry, setSelectedAuditEntry] =
    useState<AuditLogEntry | null>(null);

  // Sync local state when organization / memberProfile loads
  useEffect(() => {
    if (organization) {
      setName(organization.name ?? '');
      setLegalName(organization.legalName ?? '');
      setTradingName(organization.tradingName ?? '');
      setEmail(organization.email ?? '');
      setPhone(organization.phone ?? '');
      setAddressLine1(organization.addressLine1 ?? '');
      setAddressLine2(organization.addressLine2 ?? '');
      setCity(organization.city ?? '');
      setStateCode(organization.state ?? '');
      setPostcode(organization.postcode ?? '');
      setBankBsb(organization.bankBsb ?? '');
      setBankAccountNumber(organization.bankAccountNumber ?? '');
      setBankAccountName(organization.bankAccountName ?? '');
      setApcaUserId(organization.apcaUserId ?? '');
      setLockDate(
        organization.lockDate ? organization.lockDate.slice(0, 10) : '',
      );
      setFiscalYearStartMonth(organization.fiscalYearStartMonth ?? 7);
      setDefaultPaymentTermsDays(organization.defaultPaymentTermsDays ?? 30);
      setEnforceTwoPersonApproval(
        Boolean(organization.enforceTwoPersonApproval),
      );
      setEnabledModules(
        organization.enabledModules?.length
          ? organization.enabledModules
          : ['CORE_FINANCE', 'EXPENSES'],
      );
    }
  }, [organization]);

  useEffect(() => {
    if (memberProfile) {
      setMyJobTitle(memberProfile.jobTitle ?? '');
      setMyDepartment(memberProfile.department ?? '');
      setMyBankBsb(memberProfile.bankBsb ?? '');
      setMyBankAccountNumber(memberProfile.bankAccountNumber ?? '');
      setMyBankAccountName(memberProfile.bankAccountName ?? '');
    }
  }, [memberProfile]);

  const fetchTeam = useCallback(async () => {
    if (!canViewTeam) return;
    setLoadingTeam(true);
    try {
      const [mRes, iRes] = await Promise.all([
        orgApi.listMembers(),
        orgApi.listInvites(),
      ]);
      setMembers(mRes.members);
      setInvites(iRes.invites);
    } catch {
      // ignore
    } finally {
      setLoadingTeam(false);
    }
  }, [canViewTeam]);

  const fetchAuditLogs = useCallback(async () => {
    if (!canViewAudit) return;
    setLoadingAudit(true);
    try {
      const res = await orgApi.listAuditLogs({
        entityType: auditEntityType || undefined,
        search: auditSearch.trim() || undefined,
        limit: 100,
      });
      setAuditLogs(res.logs);
      setAuditTotal(res.totalCount);
    } catch {
      // ignore
    } finally {
      setLoadingAudit(false);
    }
  }, [canViewAudit, auditEntityType, auditSearch]);

  useEffect(() => {
    if (activeTab === 'team') {
      void fetchTeam();
    } else if (activeTab === 'audit') {
      void fetchAuditLogs();
    }
  }, [activeTab, fetchTeam, fetchAuditLogs]);

  // Save Handlers
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setBanner(null);
    try {
      await orgApi.updateProfile({
        name: name.trim(),
        legalName: legalName.trim() || null,
        tradingName: tradingName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        addressLine1: addressLine1.trim() || null,
        addressLine2: addressLine2.trim() || null,
        city: city.trim() || null,
        state: stateCode.trim() || null,
        postcode: postcode.trim() || null,
        bankBsb: bankBsb.trim() || null,
        bankAccountNumber: bankAccountNumber.trim() || null,
        bankAccountName: bankAccountName.trim() || null,
        apcaUserId: apcaUserId.trim() || null,
      });
      await refreshSession();
      setBanner({
        type: 'success',
        message: 'Entity corporate profile and EFT remittance details updated.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        message:
          err instanceof ApiError
            ? err.message
            : 'Failed to update entity profile.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveGovernance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGovernance(true);
    setBanner(null);
    try {
      await orgApi.updateProfile({
        lockDate: lockDate ? lockDate : null,
        fiscalYearStartMonth,
        defaultPaymentTermsDays,
        enforceTwoPersonApproval,
        enabledModules: Array.from(
          new Set(['CORE_FINANCE', ...enabledModules]),
        ),
      });
      await refreshSession();
      setBanner({
        type: 'success',
        message: 'Accounting period lock, approval policy, and feature modules saved.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        message:
          err instanceof ApiError
            ? err.message
            : 'Failed to update governance settings.',
      });
    } finally {
      setSavingGovernance(false);
    }
  };

  const handleSaveMyProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMyProfile(true);
    setBanner(null);
    try {
      await orgApi.updateMyProfile({
        jobTitle: myJobTitle.trim() || null,
        department: myDepartment.trim() || null,
        bankBsb: myBankBsb.trim() || null,
        bankAccountNumber: myBankAccountNumber.trim() || null,
        bankAccountName: myBankAccountName.trim() || null,
      });
      await refreshSession();
      setBanner({
        type: 'success',
        message: 'Your employee reimbursement profile has been updated.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        message:
          err instanceof ApiError
            ? err.message
            : 'Failed to update employee profile.',
      });
    } finally {
      setSavingMyProfile(false);
    }
  };

  const toggleModule = (modKey: string) => {
    if (modKey === 'CORE_FINANCE') return;
    setEnabledModules((prev) =>
      prev.includes(modKey)
        ? prev.filter((k) => k !== modKey)
        : [...prev, modKey],
    );
  };

  return (
    <div className="space-y-5">
      {/* Page Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
              Workspace Governance & Entity Controls
            </h1>
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              ABN {formatABN(organization?.abn)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage legal entity registration, EFT remittance banking, period lock dates, 7-tier RBAC access, and immutable system audit logs.
          </p>
        </div>

        {activeTab === 'team' && isAdmin && (
          <Button
            size="sm"
            onClick={() => setInviteModalOpen(true)}
            className="shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Invite or Assign User
          </Button>
        )}
      </div>

      {/* Connected Governance Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white rounded-md border border-slate-200 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 overflow-hidden">
        <div className="px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Registered Legal Entity
          </p>
          <p className="text-sm font-semibold text-slate-900 truncate mt-1">
            {organization?.legalName || organization?.name || '—'}
          </p>
          <p className="font-mono text-[11px] text-slate-500 mt-0.5">
            ABN {formatABN(organization?.abn)}
          </p>
        </div>

        <div className="px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Accounting Period Lock
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            {organization?.lockDate ? (
              <>
                <Lock className="w-3.5 h-3.5 text-amber-700" />
                <span className="font-mono text-sm font-semibold text-amber-900">
                  {new Date(organization.lockDate).toLocaleDateString('en-AU', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </>
            ) : (
              <>
                <Unlock className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-sm font-medium text-slate-600">
                  All Periods Open
                </span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            FY Starts Month {organization?.fiscalYearStartMonth ?? 7} (July)
          </p>
        </div>

        <div className="px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Approval Governance
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-forest-700" />
            <span className="text-sm font-semibold text-slate-900">
              {organization?.enforceTwoPersonApproval
                ? 'Strict Maker-Checker'
                : 'Adaptive 1-Click Post'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Your Role: <span className="font-mono font-medium">{role}</span>
          </p>
        </div>

        <div className="px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Primary EFT Settlement Bank
          </p>
          <p className="font-mono text-sm font-semibold text-slate-900 mt-1">
            {organization?.bankBsb && organization?.bankAccountNumber
              ? `BSB ${organization.bankBsb} · ${organization.bankAccountNumber}`
              : 'Not Configured'}
          </p>
          <p className="text-[11px] text-slate-500 truncate mt-0.5">
            {organization?.bankAccountName || 'Configure in Entity Profile'}
          </p>
        </div>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-3.5 py-2.5 rounded border text-xs',
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900',
          )}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-[11px] font-medium underline opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Horizontal Tab Bar */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {role !== 'EMPLOYEE' && (
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={cn(
              'inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              activeTab === 'profile'
                ? 'border-forest-900 text-forest-900'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <Building2 className="w-3.5 h-3.5" />
            Entity Profile & EFT Banking
          </button>
        )}

        {canViewGovernance && (
          <button
            type="button"
            onClick={() => setActiveTab('governance')}
            className={cn(
              'inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              activeTab === 'governance'
                ? 'border-forest-900 text-forest-900'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Period Locks & Feature Modules
          </button>
        )}

        {canViewTeam && (
          <button
            type="button"
            onClick={() => setActiveTab('team')}
            className={cn(
              'inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              activeTab === 'team'
                ? 'border-forest-900 text-forest-900'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <Users className="w-3.5 h-3.5" />
            Team & 7-Role RBAC
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('my-profile')}
          className={cn(
            'inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
            activeTab === 'my-profile'
              ? 'border-forest-900 text-forest-900'
              : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          <UserCheck className="w-3.5 h-3.5" />
          My Reimbursement Profile
        </button>

        {canViewAudit && (
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={cn(
              'inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              activeTab === 'audit'
                ? 'border-forest-900 text-forest-900'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <History className="w-3.5 h-3.5" />
            Immutable System Audit Log
          </button>
        )}
      </div>

      {/* =================================================================== */}
      {/* TAB 1: ENTITY PROFILE & EFT REMITTANCE BANKING */}
      {/* =================================================================== */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleSaveProfile}
            className="lg:col-span-2 bg-white rounded-md border border-slate-200 divide-y divide-slate-200"
          >
            <div className="p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Corporate Registration & ATO Identity
                </h2>
                <p className="text-xs text-slate-500">
                  Displayed on statutory tax invoices, purchase orders, and financial statements.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <Input
                  label="Workspace Display Name *"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isAdmin || savingProfile}
                />
                <Input
                  label="Registered Legal Entity Name"
                  placeholder="Acme Holdings Pty Ltd"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  disabled={!isAdmin || savingProfile}
                />
                <Input
                  label="Trading Name"
                  placeholder="Acme Industrial"
                  value={tradingName}
                  onChange={(e) => setTradingName(e.target.value)}
                  disabled={!isAdmin || savingProfile}
                />
                <Input
                  label="Australian Business Number (ABN)"
                  value={formatABN(organization?.abn)}
                  disabled
                  mono
                  hint="Verified ATO ABN (immutable after entity provisioning)."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
                <Input
                  label="Accounts / Remittance Email"
                  type="email"
                  placeholder="accounts@company.com.au"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={!isAdmin || savingProfile}
                />
                <Input
                  label="Corporate Phone"
                  placeholder="+61 2 9000 0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={!isAdmin || savingProfile}
                  mono
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
                <Input
                  label="Street Address Line 1"
                  placeholder="Level 14, 100 Barangaroo Ave"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  disabled={!isAdmin || savingProfile}
                />
                <Input
                  label="Street Address Line 2"
                  placeholder="Tower Two"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                  disabled={!isAdmin || savingProfile}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <Input
                  label="City / Suburb"
                  placeholder="Sydney"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  disabled={!isAdmin || savingProfile}
                />
                <Input
                  label="State / Territory"
                  placeholder="NSW"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                  maxLength={3}
                  disabled={!isAdmin || savingProfile}
                  mono
                />
                <Input
                  label="Postcode"
                  placeholder="2000"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  maxLength={4}
                  disabled={!isAdmin || savingProfile}
                  mono
                />
              </div>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Australian Bank Settlement & ABA Remittance Details
                </h2>
                <p className="text-xs text-slate-500">
                  Printed on customer tax invoices for EFT remittance and used as the header record in Australian `.ABA` batch payment files.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <Input
                  label="Bank Account Name"
                  placeholder="ACME HOLDINGS OPERATING A/C"
                  value={bankAccountName}
                  onChange={(e) => setBankAccountName(e.target.value)}
                  disabled={!isAdmin || savingProfile}
                />
                <Input
                  label="APCA Direct Entry User ID (6 digits)"
                  placeholder="000123"
                  value={apcaUserId}
                  onChange={(e) => setApcaUserId(e.target.value)}
                  maxLength={6}
                  mono
                  hint="Optional 6-digit APCA ID for ABA Cemtex header generation."
                  disabled={!isAdmin || savingProfile}
                />
                <Input
                  label="Australian Bank BSB"
                  placeholder="062-000"
                  value={bankBsb}
                  onChange={(e) => setBankBsb(e.target.value)}
                  mono
                  disabled={!isAdmin || savingProfile}
                />
                <Input
                  label="Bank Account Number"
                  placeholder="10948271"
                  value={bankAccountNumber}
                  onChange={(e) => setBankAccountNumber(e.target.value)}
                  mono
                  disabled={!isAdmin || savingProfile}
                />
              </div>
            </div>

            {isAdmin && (
              <div className="px-4 py-3 bg-slate-50 flex items-center justify-end gap-2">
                <Button type="submit" size="sm" loading={savingProfile}>
                  Save Entity Profile
                </Button>
              </div>
            )}
          </form>

          {/* Live Tax Invoice Remittance Slip Preview */}
          <div className="space-y-4">
            <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <div className="flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-forest-800" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                    Tax Invoice Header & EFT Slip Preview
                  </h3>
                </div>
                <StatusTag tone="info" label="LIVE PREVIEW" mono />
              </div>

              <div className="p-3.5 rounded bg-slate-50 border border-slate-200 space-y-3 text-xs">
                <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2.5">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {legalName || name || 'Entity Legal Name'}
                    </p>
                    {tradingName && (
                      <p className="text-[11px] text-slate-500">
                        Trading as {tradingName}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500 mt-1">
                      {[addressLine1, city, stateCode, postcode]
                        .filter(Boolean)
                        .join(', ') || 'Registered Address'}
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <p className="text-[10px] uppercase text-slate-400">
                      TAX INVOICE
                    </p>
                    <p className="text-[11px] font-semibold text-slate-800">
                      ABN {formatABN(organization?.abn)}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                    Electronic Funds Transfer (EFT) Remittance Advice
                  </p>
                  <div className="grid grid-cols-2 gap-y-1 text-[11px]">
                    <span className="text-slate-500">Account Name:</span>
                    <span className="font-mono font-medium text-slate-900 text-right truncate">
                      {bankAccountName || legalName || name || '—'}
                    </span>
                    <span className="text-slate-500">BSB:</span>
                    <span className="font-mono font-medium text-slate-900 text-right">
                      {bankBsb || '000-000'}
                    </span>
                    <span className="text-slate-500">Account No:</span>
                    <span className="font-mono font-medium text-slate-900 text-right">
                      {bankAccountNumber || '00000000'}
                    </span>
                    <span className="text-slate-500">Remittance Email:</span>
                    <span className="font-mono text-slate-800 text-right truncate">
                      {email || '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: GOVERNANCE, PERIOD LOCKS & FEATURE MODULES */}
      {/* =================================================================== */}
      {activeTab === 'governance' && canViewGovernance && (
        <form
          onSubmit={handleSaveGovernance}
          className="bg-white rounded-md border border-slate-200 divide-y divide-slate-200"
        >
          {/* Period Lock & Fiscal Calendar */}
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Accounting Period Lock & Fiscal Calendar
                </h2>
                <p className="text-xs text-slate-500">
                  Prevent backdated postings, edits, or reversals on or before the closed BAS/reporting lock date.
                </p>
              </div>
              {lockDate && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isAdmin || savingGovernance}
                  onClick={() => setLockDate('')}
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Clear Lock Date
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="Period Lock Date (Inclusive)"
                type="date"
                value={lockDate}
                onChange={(e) => setLockDate(e.target.value)}
                disabled={!isAdmin || savingGovernance}
                mono
                hint="Blocks all GL postings dated ≤ this date."
              />

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-700">
                  Fiscal Year Start Month
                </label>
                <select
                  value={fiscalYearStartMonth}
                  onChange={(e) =>
                    setFiscalYearStartMonth(Number(e.target.value))
                  }
                  disabled={!isAdmin || savingGovernance}
                  className="h-9 rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-forest-600"
                >
                  {MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  Australian ATO financial year begins 1 July.
                </p>
              </div>

              <Input
                label="Default Payment Terms (Days)"
                type="number"
                min={0}
                max={365}
                value={String(defaultPaymentTermsDays)}
                onChange={(e) =>
                  setDefaultPaymentTermsDays(Number(e.target.value) || 0)
                }
                disabled={!isAdmin || savingGovernance}
                mono
                hint="Default net days applied to new contacts."
              />
            </div>
          </div>

          {/* Maker-Checker Approval Policy */}
          <div className="p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Multi-Step Approval & Maker-Checker Policy
            </h2>
            <label className="flex items-start gap-3 p-3 rounded border border-slate-200 bg-slate-50/70 cursor-pointer">
              <input
                type="checkbox"
                checked={enforceTwoPersonApproval}
                onChange={(e) => setEnforceTwoPersonApproval(e.target.checked)}
                disabled={!isAdmin || savingGovernance}
                className="mt-0.5 rounded border-slate-300 text-forest-900 focus:ring-forest-600"
              />
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  Enforce Strict Two-Person Maker-Checker Approval
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  When enabled, the user who creates or submits a Bill, Invoice, Purchase Order, or Manual Journal cannot be the same user who approves and posts it to the General Ledger. When disabled, <span className="font-mono">ADMIN</span> and <span className="font-mono">ACCOUNTANT</span> roles can approve and post in a single click.
                </p>
              </div>
            </label>
          </div>

          {/* Per-Organization Feature Modules */}
          <div className="p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Enabled Business Service Modules
              </h2>
              <p className="text-xs text-slate-500">
                Activate or hide specialized domain modules for this corporate entity without redeploying the container.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {AVAILABLE_MODULES.map((mod) => {
                const checked =
                  mod.locked || enabledModules.includes(mod.key);
                return (
                  <label
                    key={mod.key}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded border transition-colors',
                      checked
                        ? 'border-forest-200 bg-forest-50/40'
                        : 'border-slate-200 bg-white',
                      !mod.locked && isAdmin ? 'cursor-pointer' : 'opacity-90',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={mod.locked || !isAdmin || savingGovernance}
                      onChange={() => toggleModule(mod.key)}
                      className="mt-0.5 rounded border-slate-300 text-forest-900 focus:ring-forest-600"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-900">
                          {mod.label}
                        </span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {mod.key}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {mod.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {isAdmin && (
            <div className="px-4 py-3 bg-slate-50 flex items-center justify-end">
              <Button type="submit" size="sm" loading={savingGovernance}>
                Save Governance & Modules
              </Button>
            </div>
          )}
        </form>
      )}

      {/* =================================================================== */}
      {/* TAB 3: TEAM MEMBERS & 7-ROLE RBAC */}
      {/* =================================================================== */}
      {activeTab === 'team' && canViewTeam && (
        <div className="space-y-5">
          {/* Active Team Members Table */}
          <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Authorized Workspace Members ({members.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Click any member row to inspect or modify their 7-tier role, department, or reimbursement bank details.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Member</th>
                    <th className="px-4 py-2.5">Assigned Role</th>
                    <th className="px-4 py-2.5">Department / Title</th>
                    <th className="px-4 py-2.5">Reimbursement Bank (2050)</th>
                    <th className="px-4 py-2.5 text-right">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {loadingTeam ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-slate-400"
                      >
                        Loading workspace members…
                      </td>
                    </tr>
                  ) : members.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-slate-400"
                      >
                        No members found.
                      </td>
                    </tr>
                  ) : (
                    members.map((m) => (
                      <tr
                        key={m.id}
                        onClick={() => setSelectedMember(m)}
                        className="h-10 hover:bg-slate-50/90 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-2">
                          <p className="font-medium text-slate-900">
                            {m.user?.name || 'User'}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {m.user?.email}
                          </p>
                        </td>
                        <td className="px-4 py-2">
                          <StatusTag
                            tone={
                              m.role === 'ADMIN'
                                ? 'posted'
                                : m.role === 'ACCOUNTANT'
                                  ? 'info'
                                  : m.role === 'AUDITOR'
                                    ? 'locked'
                                    : 'neutral'
                            }
                            label={m.role.replace(/_/g, ' ')}
                            mono
                          />
                        </td>
                        <td className="px-4 py-2 text-slate-700">
                          {m.department || m.jobTitle ? (
                            <span>
                              {[m.department, m.jobTitle]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-700">
                          {m.bankBsb && m.bankAccountNumber ? (
                            `BSB ${m.bankBsb} · ${m.bankAccountNumber}`
                          ) : (
                            <span className="text-slate-400 font-sans">
                              Not set
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-[11px] text-slate-500">
                          {m.createdAt
                            ? new Date(m.createdAt).toLocaleDateString('en-AU')
                            : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pending Email Invitations */}
          <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                Pending Google Workspace Invitations ({invites.length})
              </h2>
              <p className="text-xs text-slate-500">
                Invited users are automatically bound to this entity and role the moment they sign in with Google OAuth.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Invited Email</th>
                    <th className="px-4 py-2.5">Pre-Assigned Role</th>
                    <th className="px-4 py-2.5">Department / Title</th>
                    <th className="px-4 py-2.5">Expires</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {invites.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-slate-400"
                      >
                        No pending invitations.
                      </td>
                    </tr>
                  ) : (
                    invites.map((inv) => (
                      <tr key={inv.id} className="h-10 hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-slate-900">
                          <div className="flex items-center gap-2">
                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                            <span>{inv.email}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <StatusTag
                            tone="pending"
                            label={inv.role.replace(/_/g, ' ')}
                            mono
                          />
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          {[inv.department, inv.jobTitle]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                          {new Date(inv.expiresAt).toLocaleDateString('en-AU')}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={async () => {
                                await orgApi.revokeInvite(inv.id);
                                await fetchTeam();
                              }}
                              className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-800 font-medium"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Revoke
                            </button>
                          )}
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

      {/* =================================================================== */}
      {/* TAB 4: MY EMPLOYEE REIMBURSEMENT PROFILE */}
      {/* =================================================================== */}
      {activeTab === 'my-profile' && (
        <form
          onSubmit={handleSaveMyProfile}
          className="max-w-2xl bg-white rounded-md border border-slate-200 divide-y divide-slate-200"
        >
          <div className="p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                My Employee Profile & Reimbursement Bank Details
              </h2>
              <p className="text-xs text-slate-500">
                Used for settling approved out-of-pocket Employee Expense Claims from liability account <span className="font-mono">2050 Employee Reimbursements Payable</span> via Australian `.ABA` batch bank files.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Input
                label="Job Title / Position"
                placeholder="Senior Operations Manager"
                value={myJobTitle}
                onChange={(e) => setMyJobTitle(e.target.value)}
                disabled={savingMyProfile}
              />
              <Input
                label="Department / Cost Center"
                placeholder="Operations"
                value={myDepartment}
                onChange={(e) => setMyDepartment(e.target.value)}
                disabled={savingMyProfile}
              />
            </div>

            <div className="pt-2 border-t border-slate-200 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Australian Bank Account for Expense Reimbursements
              </p>
              <Input
                label="Account Holder Name"
                placeholder="J DELANEY-ABDY"
                value={myBankAccountName}
                onChange={(e) => setMyBankAccountName(e.target.value)}
                disabled={savingMyProfile}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <Input
                  label="Australian Bank BSB"
                  placeholder="062-000"
                  value={myBankBsb}
                  onChange={(e) => setMyBankBsb(e.target.value)}
                  mono
                  disabled={savingMyProfile}
                />
                <Input
                  label="Bank Account Number"
                  placeholder="12345678"
                  value={myBankAccountNumber}
                  onChange={(e) => setMyBankAccountNumber(e.target.value)}
                  mono
                  disabled={savingMyProfile}
                />
              </div>
            </div>
          </div>

          <div className="px-4 py-3 bg-slate-50 flex items-center justify-end">
            <Button type="submit" size="sm" loading={savingMyProfile}>
              Save My Reimbursement Details
            </Button>
          </div>
        </form>
      )}

      {/* =================================================================== */}
      {/* TAB 5: IMMUTABLE SYSTEM AUDIT LOG */}
      {/* =================================================================== */}
      {activeTab === 'audit' && canViewAudit && (
        <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
          <div className="p-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Append-Only System Audit Trail
              </h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                {auditTotal} events
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search actor, summary, action…"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="h-8 pl-8 pr-3 rounded border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-forest-600"
                />
              </div>

              <select
                value={auditEntityType}
                onChange={(e) => setAuditEntityType(e.target.value)}
                className="h-8 rounded border border-slate-300 bg-white px-2.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                <option value="">All Entity Types</option>
                <option value="ORGANIZATION">ORGANIZATION</option>
                <option value="ORGANIZATION_MEMBER">ORGANIZATION_MEMBER</option>
                <option value="ORGANIZATION_INVITE">ORGANIZATION_INVITE</option>
                <option value="ACCOUNT">ACCOUNT</option>
                <option value="TRACKING_CATEGORY">TRACKING_CATEGORY</option>
                <option value="JOURNAL_ENTRY">JOURNAL_ENTRY</option>
                <option value="INVOICE">INVOICE</option>
                <option value="BILL">BILL</option>
                <option value="CONTACT">CONTACT</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Timestamp (AEST/AEDT)</th>
                  <th className="px-4 py-2.5">Actor</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Entity</th>
                  <th className="px-4 py-2.5">Event Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {loadingAudit ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-slate-400"
                    >
                      Loading immutable audit log…
                    </td>
                  </tr>
                ) : auditLogs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-slate-400"
                    >
                      No audit events match your filter criteria.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedAuditEntry(log)}
                      className="h-9 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {formatDateTimeAU(log.createdAt)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="font-medium text-slate-900">
                          {log.actorName || 'System'}
                        </span>
                        {log.actorEmail && (
                          <span className="text-[11px] text-slate-400 ml-1.5">
                            ({log.actorEmail})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="font-mono text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {log.entityType}
                      </td>
                      <td className="px-4 py-2 text-slate-800 truncate max-w-md">
                        {log.summary}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* INVITE OR ASSIGN USER MODAL */}
      {/* =================================================================== */}
      <InviteUserModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        onSuccess={async (msg) => {
          setInviteModalOpen(false);
          setBanner({ type: 'success', message: msg });
          await fetchTeam();
        }}
      />

      {/* =================================================================== */}
      {/* RIGHT-HAND INSPECTOR DRAWER: TEAM MEMBER */}
      {/* =================================================================== */}
      <MemberInspectorDrawer
        member={selectedMember}
        isAdmin={isAdmin}
        onClose={() => setSelectedMember(null)}
        onUpdated={async () => {
          setSelectedMember(null);
          await fetchTeam();
          await refreshSession();
        }}
      />

      {/* =================================================================== */}
      {/* RIGHT-HAND INSPECTOR DRAWER: AUDIT LOG METADATA */}
      {/* =================================================================== */}
      <Drawer
        open={Boolean(selectedAuditEntry)}
        onClose={() => setSelectedAuditEntry(null)}
        title="Audit Event Inspector"
        subtitle={
          selectedAuditEntry
            ? `${selectedAuditEntry.action} · ${formatDateTimeAU(selectedAuditEntry.createdAt)}`
            : undefined
        }
      >
        {selectedAuditEntry && (
          <div className="p-5 space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded bg-slate-50 border border-slate-200">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">
                  Audit Event ID
                </p>
                <p className="font-mono text-slate-800 mt-0.5 break-all">
                  {selectedAuditEntry.id}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">
                  Timestamp
                </p>
                <p className="font-mono text-slate-800 mt-0.5">
                  {formatDateTimeAU(selectedAuditEntry.createdAt)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">
                  Actor
                </p>
                <p className="font-medium text-slate-900 mt-0.5">
                  {selectedAuditEntry.actorName || 'System'}
                </p>
                <p className="text-[11px] text-slate-500">
                  {selectedAuditEntry.actorEmail || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">
                  Target Entity
                </p>
                <p className="font-mono text-slate-800 mt-0.5">
                  {selectedAuditEntry.entityType}
                </p>
                <p className="font-mono text-[11px] text-slate-500 break-all">
                  {selectedAuditEntry.entityId}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Summary
              </p>
              <p className="p-3 rounded border border-slate-200 bg-white text-slate-900">
                {selectedAuditEntry.summary}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Structured Event Payload (JSON)
              </p>
              <pre className="p-3.5 rounded bg-obsidian-950 text-emerald-300 font-mono text-[11px] overflow-x-auto">
                {selectedAuditEntry.metadataJson
                  ? JSON.stringify(
                      JSON.parse(selectedAuditEntry.metadataJson),
                      null,
                      2,
                    )
                  : '// No additional JSON metadata recorded'}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Invite User Modal
// ---------------------------------------------------------------------------

function InviteUserModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('ACCOUNTANT');
  const [department, setDepartment] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim().includes('@')) {
      setError('Please enter a valid Google Workspace email address.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await orgApi.createInvite({
        email: email.trim(),
        role,
        department: department.trim() || null,
        jobTitle: jobTitle.trim() || null,
      });
      setEmail('');
      setDepartment('');
      setJobTitle('');
      if (res.status === 'added_immediately') {
        await onSuccess(
          `Existing user ${email.trim()} was bound immediately to this entity as ${role}.`,
        );
      } else {
        await onSuccess(
          `Invitation created for ${email.trim()} (${role}). Will auto-bind upon Google sign-in.`,
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to create invitation.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite or Assign Workspace User"
      description="If the user already has an account, they are added to this company immediately. Otherwise, a pending invite is claimed automatically when they sign in with Google."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Google Workspace Email Address *"
          type="email"
          placeholder="colleague@company.com.au"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          autoFocus
        />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-700">
            7-Tier RBAC Security Role *
          </label>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {ALL_ROLES.map((r) => (
              <label
                key={r.value}
                className={cn(
                  'flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors',
                  role === r.value
                    ? 'border-forest-700 bg-forest-50/50'
                    : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  checked={role === r.value}
                  onChange={() => setRole(r.value)}
                  className="mt-0.5 text-forest-900 focus:ring-forest-600"
                />
                <div>
                  <p className="font-mono text-xs font-semibold text-slate-900">
                    {r.label}
                  </p>
                  <p className="text-[11px] text-slate-500">{r.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Department"
            placeholder="Finance / Operations"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={loading}
          />
          <Input
            label="Job Title"
            placeholder="AP Officer"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            disabled={loading}
          />
        </div>

        {error && (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={loading}>
            Assign / Send Invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Member Inspector Drawer
// ---------------------------------------------------------------------------

function MemberInspectorDrawer({
  member,
  isAdmin,
  onClose,
  onUpdated,
}: {
  member: MemberProfile | null;
  isAdmin: boolean;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [role, setRole] = useState<Role>('EMPLOYEE');
  const [department, setDepartment] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [bankBsb, setBankBsb] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (member) {
      setRole(member.role);
      setDepartment(member.department ?? '');
      setJobTitle(member.jobTitle ?? '');
      setBankBsb(member.bankBsb ?? '');
      setBankAccountNumber(member.bankAccountNumber ?? '');
      setBankAccountName(member.bankAccountName ?? '');
      setError(null);
    }
  }, [member]);

  if (!member) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await orgApi.updateMember(member.id, {
        role,
        department: department.trim() || null,
        jobTitle: jobTitle.trim() || null,
        bankBsb: bankBsb.trim() || null,
        bankAccountNumber: bankAccountNumber.trim() || null,
        bankAccountName: bankAccountName.trim() || null,
      });
      await onUpdated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to update member.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    setError(null);
    try {
      await orgApi.removeMember(member.id);
      await onUpdated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to remove member.',
      );
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={Boolean(member)}
      onClose={onClose}
      title={member.user?.name || 'Workspace Member'}
      subtitle={member.user?.email}
      footer={
        isAdmin ? (
          <div className="flex items-center justify-between w-full">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => void handleRemove()}
              disabled={saving}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove from Entity
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                loading={saving}
                onClick={(e) => void handleSave(e)}
              >
                Save Changes
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      <form onSubmit={handleSave} className="p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-700">
            Assigned 7-Tier RBAC Role
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={!isAdmin || saving}
            className="w-full h-9 rounded border border-slate-300 bg-white px-3 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-forest-600"
          >
            {ALL_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.description}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={!isAdmin || saving}
          />
          <Input
            label="Job Title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            disabled={!isAdmin || saving}
          />
        </div>

        <div className="pt-3 border-t border-slate-200 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Employee Reimbursement Bank Account (Liability 2050)
          </p>
          <Input
            label="Account Name"
            value={bankAccountName}
            onChange={(e) => setBankAccountName(e.target.value)}
            disabled={!isAdmin || saving}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="BSB"
              value={bankBsb}
              onChange={(e) => setBankBsb(e.target.value)}
              mono
              disabled={!isAdmin || saving}
            />
            <Input
              label="Account Number"
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              mono
              disabled={!isAdmin || saving}
            />
          </div>
        </div>

        {error && (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}
      </form>
    </Drawer>
  );
}

