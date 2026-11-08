import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  FileText,
  Receipt,
  BookOpen,
  Landmark,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronsUpDown,
  Check,
  Plus,
  ShieldCheck,
  Lock,
  Building2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { orgApi, ApiError, type Role } from '@/api/client';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { StatusTag } from '@/components/ui/StatusTag';
import type { ReactNode } from 'react';

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  allowedRoles: Role[];
  requiredModule?: string;
}

interface NavGroup {
  groupLabel: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupLabel: 'Executive',
    items: [
      {
        label: 'Overview & KPIs',
        href: '/',
        icon: LayoutDashboard,
        allowedRoles: [
          'ADMIN',
          'ACCOUNTANT',
          'MANAGER',
          'AR_SPECIALIST',
          'AP_SPECIALIST',
          'EMPLOYEE',
          'AUDITOR',
        ],
      },
    ],
  },
  {
    groupLabel: 'General Ledger',
    items: [
      {
        label: 'Chart of Accounts',
        href: '/accounts',
        icon: Landmark,
        allowedRoles: ['ADMIN', 'ACCOUNTANT', 'AUDITOR'],
      },
      {
        label: 'Journal Ledger',
        href: '/ledger',
        icon: BookOpen,
        allowedRoles: ['ADMIN', 'ACCOUNTANT', 'AUDITOR'],
      },
    ],
  },
  {
    groupLabel: 'Operations & Sub-Ledgers',
    items: [
      {
        label: 'Contacts Directory',
        href: '/contacts',
        icon: Users,
        allowedRoles: [
          'ADMIN',
          'ACCOUNTANT',
          'MANAGER',
          'AR_SPECIALIST',
          'AP_SPECIALIST',
          'AUDITOR',
        ],
      },
      {
        label: 'Receivables (AR)',
        href: '/invoices',
        icon: FileText,
        allowedRoles: [
          'ADMIN',
          'ACCOUNTANT',
          'MANAGER',
          'AR_SPECIALIST',
          'AUDITOR',
        ],
      },
      {
        label: 'Payables (AP)',
        href: '/bills',
        icon: Receipt,
        allowedRoles: [
          'ADMIN',
          'ACCOUNTANT',
          'MANAGER',
          'AP_SPECIALIST',
          'AUDITOR',
        ],
      },
    ],
  },
  {
    groupLabel: 'Governance & Access',
    items: [
      {
        label: 'Workspace & Audit',
        href: '/settings',
        icon: Settings,
        allowedRoles: [
          'ADMIN',
          'ACCOUNTANT',
          'MANAGER',
          'AR_SPECIALIST',
          'AP_SPECIALIST',
          'EMPLOYEE',
          'AUDITOR',
        ],
      },
    ],
  },
];

function formatABN(abn?: string | null): string {
  if (!abn) return '—';
  const d = abn.replace(/\D/g, '');
  if (d.length !== 11) return abn;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 11)}`;
}

function validateABN(raw: string): boolean {
  const digits = raw.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const first = Number(digits[0]) - 1;
  const rest = digits.slice(1).split('').map(Number);
  const adjusted = [first, ...rest];
  const sum = adjusted.reduce((acc, d, i) => acc + d * (weights[i] ?? 0), 0);
  return sum % 89 === 0;
}

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const {
    user,
    organization,
    organizationId,
    role,
    memberships,
    switchOrganization,
    refreshSession,
    logout,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [switcherOpen, setSwitchingOpen] = useState(false);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [createOrgModalOpen, setCreateOrgModalOpen] = useState(false);

  const activeNavInfo = (() => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (item.href === location.pathname) {
          return { groupLabel: group.groupLabel, itemLabel: item.label };
        }
      }
    }
    return { groupLabel: 'Workspace', itemLabel: 'Overview' };
  })();

  const handleSwitchOrg = async (targetOrgId: string) => {
    if (targetOrgId === organizationId) {
      setSwitchingOpen(false);
      return;
    }
    setSwitchingOrgId(targetOrgId);
    try {
      await switchOrganization(targetOrgId);
      setSwitchingOpen(false);
      // Reload data on current route cleanly
      window.location.reload();
    } finally {
      setSwitchingOrgId(null);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-obsidian-950/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Obsidian Carbon Left Navigation Frame (#0B1311) */}
      {/* ------------------------------------------------------------------ */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-obsidian-950 border-r border-white/[0.08] transition-transform duration-150',
          'lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Top Brand Bar */}
        <div className="flex h-12 items-center justify-between px-4 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-6 h-6 rounded bg-forest-700 border border-emerald-500/30">
              <svg viewBox="0 0 32 32" fill="none" className="w-3.5 h-3.5">
                <path
                  d="M6 22V10h4l4 8 4-8h4v12h-3v-7.5l-3.5 7h-3L9 14.5V22H6z"
                  fill="#EAF3EE"
                />
              </svg>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-semibold text-white tracking-tight">
                JBTDA DWS
              </span>
              <span className="font-mono text-[10px] text-emerald-400/90 uppercase tracking-wider">
                LEDGER
              </span>
            </div>
          </div>
          <button
            className="lg:hidden text-slate-400 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Multi-Company Workspace Switcher */}
        <div className="relative p-2.5 border-b border-white/[0.08] shrink-0">
          <button
            type="button"
            onClick={() => setSwitchingOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded bg-obsidian-900 hover:bg-obsidian-800 border border-white/[0.08] text-left transition-colors"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <p className="text-xs font-medium text-white truncate">
                  {organization?.name ?? 'Select Organization'}
                </p>
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-slate-400 truncate">
                ABN {formatABN(organization?.abn)}
              </p>
            </div>
            <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>

          {/* Switcher Dropdown Menu */}
          {switcherOpen && (
            <div className="absolute left-2.5 right-2.5 top-full mt-1 z-50 rounded-md bg-obsidian-900 border border-white/15 shadow-2xl overflow-hidden">
              <div className="px-2.5 py-1.5 border-b border-white/[0.08]">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  Assigned Entities ({memberships.length})
                </p>
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-white/[0.05]">
                {memberships.map((m) => {
                  const isCurrent = m.organizationId === organizationId;
                  const isBusy = switchingOrgId === m.organizationId;
                  return (
                    <button
                      key={m.organizationId}
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleSwitchOrg(m.organizationId)}
                      className={cn(
                        'w-full px-2.5 py-2 text-left flex items-center justify-between gap-2 transition-colors',
                        isCurrent
                          ? 'bg-forest-900/60 text-white'
                          : 'text-slate-300 hover:bg-white/[0.05] hover:text-white',
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">
                          {m.organization.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[10px] text-slate-400">
                            {formatABN(m.organization.abn)}
                          </span>
                          <span className="font-mono text-[9px] uppercase px-1 py-0.2 rounded bg-white/10 text-emerald-300">
                            {m.role.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                      {isCurrent && (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="p-1.5 border-t border-white/[0.08] bg-obsidian-950/60">
                <button
                  type="button"
                  onClick={() => {
                    setSwitchingOpen(false);
                    setCreateOrgModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium text-emerald-400 hover:bg-white/[0.06] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create New Entity
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Domain-Grouped Navigation */}
        <nav className="flex-1 px-2.5 py-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter((item) => {
              if (!role) return true;
              if (!item.allowedRoles.includes(role)) return false;
              if (
                item.requiredModule &&
                organization?.enabledModules &&
                !organization.enabledModules.includes(item.requiredModule)
              ) {
                return false;
              }
              return true;
            });

            if (visibleItems.length === 0) return null;

            return (
              <div key={group.groupLabel}>
                <p className="px-2.5 mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  {group.groupLabel}
                </p>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const active = location.pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          'relative flex items-center gap-2.5 h-8 rounded px-2.5 text-xs transition-colors',
                          active
                            ? 'bg-obsidian-900 text-white font-medium'
                            : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-emerald-500" />
                        )}
                        <Icon
                          className={cn(
                            'w-3.5 h-3.5 shrink-0',
                            active ? 'text-emerald-400' : 'text-slate-400',
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User Identity & Sign-Out Footer */}
        <div className="p-2.5 border-t border-white/[0.08] bg-obsidian-950 shrink-0 space-y-2">
          <div className="px-2 py-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-200 truncate">
                {user?.name ?? 'Authenticated User'}
              </p>
              {role && (
                <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-forest-900 text-emerald-300 border border-emerald-500/30 shrink-0">
                  {role.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            {user?.email && (
              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                {user.email}
              </p>
            )}
          </div>
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/[0.05] hover:text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Main Content Frame */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Lean 48px (h-12) Top Context Bar */}
        <header className="flex h-12 items-center justify-between gap-4 px-4 lg:px-6 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* Breadcrumb Path */}
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="font-medium text-slate-900 truncate">
                {organization?.legalName || organization?.name || 'Organization'}
              </span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-500 hidden sm:inline">
                {activeNavInfo.groupLabel}
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-medium text-forest-900 truncate">
                {activeNavInfo.itemLabel}
              </span>
            </div>
          </div>

          {/* Right Governance Indicators & Quick Settings */}
          <div className="flex items-center gap-2 shrink-0">
            {organization?.lockDate && (
              <span
                title="Transactions on or before this date are locked"
                className="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-50 text-amber-900 border border-amber-200"
              >
                <Lock className="w-3 h-3 text-amber-700" />
                LOCKED ≤{' '}
                {new Date(organization.lockDate).toLocaleDateString('en-AU', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            )}

            {organization?.enforceTwoPersonApproval && (
              <span
                title="Maker-Checker 2-Person Approval is enforced"
                className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-forest-50 text-forest-900 border border-forest-200"
              >
                <ShieldCheck className="w-3 h-3 text-forest-700" />
                2-PERSON APPROVAL
              </span>
            )}

            {role && (
              <StatusTag
                label={role.replace(/_/g, ' ')}
                mono
                className="hidden sm:inline-flex"
              />
            )}

            <button
              type="button"
              onClick={() => navigate('/settings')}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded border text-xs font-medium transition-colors',
                location.pathname === '/settings'
                  ? 'bg-forest-900 text-white border-forest-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
              )}
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </header>

        {/* Scrollable Workbench Viewport */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* Create New Organization Modal (accessible from Company Switcher) */}
      <CreateEntityModal
        open={createOrgModalOpen}
        onClose={() => setCreateOrgModalOpen(false)}
        onCreated={async () => {
          setCreateOrgModalOpen(false);
          await refreshSession();
          window.location.reload();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self-Service Create New Entity Modal
// ---------------------------------------------------------------------------

function CreateEntityModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [abn, setAbn] = useState('');
  const [bankBsb, setBankBsb] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [errors, setErrors] = useState<{ name?: string; abn?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAbnChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    const parts: string[] = [];
    if (digits.length > 0) parts.push(digits.slice(0, 2));
    if (digits.length > 2) parts.push(digits.slice(2, 5));
    if (digits.length > 5) parts.push(digits.slice(5, 8));
    if (digits.length > 8) parts.push(digits.slice(8, 11));
    setAbn(parts.join(' '));
    if (errors.abn) setErrors((e) => ({ ...e, abn: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: { name?: string; abn?: string } = {};

    if (name.trim().length < 2) {
      nextErrors.name = 'Entity name must be at least 2 characters.';
    }
    const cleanAbn = abn.replace(/\s/g, '');
    if (!/^\d{11}$/.test(cleanAbn)) {
      nextErrors.abn = 'ABN must be 11 digits.';
    } else if (!validateABN(cleanAbn)) {
      nextErrors.abn = 'Invalid Australian Business Number (ATO checksum failed).';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    setSubmitError(null);
    try {
      await orgApi.create({
        name: name.trim(),
        legalName: legalName.trim() || name.trim(),
        abn: cleanAbn,
        bankBsb: bankBsb.trim() || null,
        bankAccountNumber: bankAccountNumber.trim() || null,
      });
      await onCreated();
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Failed to create entity. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Provision New Corporate Entity"
      description="Seeds the 10 protected system GL accounts and default cost-center dimensions automatically."
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Display / Trading Name *"
            placeholder="Acme Logistics"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            disabled={loading}
          />
          <Input
            label="Registered Legal Name"
            placeholder="Acme Logistics Pty Ltd"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            disabled={loading}
          />
        </div>

        <Input
          label="Australian Business Number (ABN) *"
          placeholder="51 824 753 556"
          value={abn}
          onChange={(e) => handleAbnChange(e.target.value)}
          error={errors.abn}
          hint="Validated against the official ATO modulus-89 checksum."
          mono
          disabled={loading}
        />

        <div className="pt-2 border-t border-slate-200">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-2">
            Primary Operating Bank Details (Optional — For Invoice EFT Remittance)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Australian Bank BSB"
              placeholder="062-000"
              value={bankBsb}
              onChange={(e) => setBankBsb(e.target.value)}
              mono
              disabled={loading}
            />
            <Input
              label="Bank Account Number"
              placeholder="10948271"
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              mono
              disabled={loading}
            />
          </div>
        </div>

        {submitError && (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {submitError}
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
            Provision Entity & Switch
          </Button>
        </div>
      </form>
    </Modal>
  );
}
