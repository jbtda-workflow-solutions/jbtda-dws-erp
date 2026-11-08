import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  FileText,
  Receipt,
  BookOpen,
  Landmark,
  Package,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronsUpDown,
  ChevronDown,
  Check,
  Plus,
  ShieldCheck,
  Lock,
  Building2,
  User,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { orgApi, ApiError, type Role } from '@/api/client';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { ReactNode } from 'react';

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  allowedRoles: Role[];
  requiredModule?: string;
  badge?: string;
}

interface NavGroup {
  groupKey: string;
  groupLabel: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'general-ledger',
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
    groupKey: 'operations',
    groupLabel: 'Operations',
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
        label: 'Items & Services',
        href: '/items',
        icon: Package,
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
      {
        label: 'Expenses & Claims',
        href: '/expenses',
        icon: Wallet,
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
    groupKey: 'governance',
    groupLabel: 'Governance',
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

  // Dropdown states
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Switching org state & modals
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [createOrgModalOpen, setCreateOrgModalOpen] = useState(false);

  const headerRef = useRef<HTMLElement>(null);

  // Close all menus on location change
  useEffect(() => {
    setActiveDropdown(null);
    setSwitcherOpen(false);
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Click-outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
        setSwitcherOpen(false);
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSwitchOrg = async (targetOrgId: string) => {
    if (targetOrgId === organizationId) {
      setSwitcherOpen(false);
      return;
    }
    setSwitchingOrgId(targetOrgId);
    try {
      await switchOrganization(targetOrgId);
      setSwitcherOpen(false);
      window.location.reload();
    } finally {
      setSwitchingOrgId(null);
    }
  };

  const toggleDropdown = (key: string) => {
    setSwitcherOpen(false);
    setUserMenuOpen(false);
    setActiveDropdown((current) => (current === key ? null : key));
  };

  const toggleSwitcher = () => {
    setActiveDropdown(null);
    setUserMenuOpen(false);
    setSwitcherOpen((v) => !v);
  };

  const toggleUserMenu = () => {
    setActiveDropdown(null);
    setSwitcherOpen(false);
    setUserMenuOpen((v) => !v);
  };

  // Filter items by role
  const isItemVisible = (item: NavItem) => {
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
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden font-sans">
      {/* ------------------------------------------------------------------ */}
      {/* High-Contrast Corporate Precision Static Header (#0B1311)         */}
      {/* ------------------------------------------------------------------ */}
      <header
        ref={headerRef}
        className="flex h-12 items-center justify-between px-3 md:px-4 bg-obsidian-950 border-b border-white/[0.08] text-white shrink-0 z-40 select-none relative"
      >
        {/* Left Section: Brand & Multi-Company Switcher & Primary Nav */}
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          {/* Brand Monogram & Name */}
          <Link
            to="/"
            className="flex items-center gap-2 shrink-0 hover:opacity-90 transition-opacity focus:outline-none"
            title="JBTDA Digital Workflow Solutions — Enterprise Ledger"
          >
            <div className="flex items-center justify-center w-6 h-6 rounded bg-forest-700 border border-emerald-500/30">
              <svg viewBox="0 0 32 32" fill="none" className="w-3.5 h-3.5">
                <path
                  d="M6 22V10h4l4 8 4-8h4v12h-3v-7.5l-3.5 7h-3L9 14.5V22H6z"
                  fill="#EAF3EE"
                />
              </svg>
            </div>
            <div className="flex items-baseline gap-1.5 hidden sm:flex">
              <span className="text-xs font-semibold text-white tracking-tight">
                JBTDA DWS
              </span>
              <span className="font-mono text-[10px] text-emerald-400/90 uppercase tracking-wider">
                LEDGER
              </span>
            </div>
          </Link>

          <span className="h-4 w-px bg-white/10 shrink-0 hidden sm:block" />

          {/* Multi-Company Workspace Switcher Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={toggleSwitcher}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors border',
                switcherOpen
                  ? 'bg-obsidian-900 border-white/20 text-white'
                  : 'bg-obsidian-900/60 hover:bg-obsidian-900 border-white/[0.08] text-slate-200',
              )}
            >
              <Building2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <div className="max-w-[120px] md:max-w-[160px] truncate">
                <span className="text-xs font-medium text-white truncate block">
                  {organization?.name ?? 'Select Entity'}
                </span>
              </div>
              <ChevronsUpDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>

            {/* Switcher Dropdown Menu */}
            {switcherOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded bg-obsidian-900 border border-white/15 shadow-2xl overflow-hidden">
                <div className="px-3 py-1.5 border-b border-white/[0.08] bg-obsidian-950/40">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    Assigned Corporate Entities ({memberships.length})
                  </p>
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-white/[0.05]">
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
                          'w-full px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors',
                          isCurrent
                            ? 'bg-forest-900/70 text-white font-medium'
                            : 'text-slate-300 hover:bg-white/[0.05] hover:text-white',
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-xs truncate">{m.organization.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 font-mono text-[10px] text-slate-400">
                            <span>ABN {formatABN(m.organization.abn)}</span>
                            <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-white/10 text-emerald-300">
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
                <div className="p-1.5 border-t border-white/[0.08] bg-obsidian-950">
                  <button
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      setCreateOrgModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium text-emerald-400 hover:bg-white/[0.06] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Provision New Entity
                  </button>
                </div>
              </div>
            )}
          </div>

          <span className="h-4 w-px bg-white/10 shrink-0 hidden md:block" />

          {/* Top Header Navigation Dropdowns (Desktop) */}
          <nav className="hidden md:flex items-center gap-1">
            {/* Overview Direct Link */}
            <Link
              to="/"
              className={cn(
                'flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium transition-colors',
                location.pathname === '/'
                  ? 'bg-white/[0.10] text-white border border-white/15'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]',
              )}
            >
              <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
              <span>Overview</span>
            </Link>

            {/* Navigation Groups with Dropdowns */}
            {NAV_GROUPS.map((group) => {
              const visibleItems = group.items.filter(isItemVisible);
              if (visibleItems.length === 0) return null;

              const isGroupActive = visibleItems.some(
                (item) => item.href === location.pathname,
              );
              const isOpen = activeDropdown === group.groupKey;

              return (
                <div key={group.groupKey} className="relative">
                  <button
                    type="button"
                    onClick={() => toggleDropdown(group.groupKey)}
                    className={cn(
                      'flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium transition-colors border',
                      isOpen
                        ? 'bg-obsidian-900 text-white border-white/20'
                        : isGroupActive
                          ? 'bg-white/[0.08] text-white border-white/15 font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-white/[0.05] border-transparent',
                    )}
                  >
                    <span>{group.groupLabel}</span>
                    <ChevronDown
                      className={cn(
                        'w-3 h-3 text-slate-400 transition-transform duration-150',
                        isOpen && 'rotate-180 text-white',
                      )}
                    />
                    {isGroupActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
                    )}
                  </button>

                  {/* Group Dropdown Menu */}
                  {isOpen && (
                    <div className="absolute left-0 top-full mt-1.5 z-50 w-52 rounded bg-obsidian-900 border border-white/15 shadow-2xl py-1 divide-y divide-white/[0.05]">
                      <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-obsidian-950/40">
                        {group.groupLabel}
                      </div>
                      <div className="py-0.5">
                        {visibleItems.map((item) => {
                          const active = location.pathname === item.href;
                          const Icon = item.icon;
                          return (
                            <Link
                              key={item.href}
                              to={item.href}
                              onClick={() => setActiveDropdown(null)}
                              className={cn(
                                'flex items-center justify-between px-3 py-1.5 text-xs transition-colors',
                                active
                                  ? 'bg-forest-900/60 text-white font-medium'
                                  : 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Icon
                                  className={cn(
                                    'w-3.5 h-3.5 shrink-0',
                                    active ? 'text-emerald-400' : 'text-slate-400',
                                  )}
                                />
                                <span className="truncate">{item.label}</span>
                              </div>
                              {active && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Right Section: Governance Badges, Settings, and User Account */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Lock Date Status */}
          {organization?.lockDate && (
            <span
              title="Transactions on or before this date are locked"
              className="hidden lg:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30"
            >
              <Lock className="w-3 h-3 text-amber-400" />
              LOCKED ≤{' '}
              {new Date(organization.lockDate).toLocaleDateString('en-AU', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          )}

          {/* 2-Person Approval Badge */}
          {organization?.enforceTwoPersonApproval && (
            <span
              title="Maker-Checker 2-Person Approval is enforced"
              className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
            >
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              2-PERSON APPROVAL
            </span>
          )}

          {/* Active Role Tag */}
          {role && (
            <span className="hidden sm:inline-flex font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-forest-900/80 text-emerald-300 border border-emerald-500/30">
              {role.replace(/_/g, ' ')}
            </span>
          )}

          {/* Settings Quick Link */}
          <button
            type="button"
            onClick={() => navigate('/settings')}
            title="Workspace Governance & Settings"
            className={cn(
              'inline-flex items-center justify-center w-7 h-7 rounded border transition-colors',
              location.pathname === '/settings'
                ? 'bg-forest-900 text-white border-emerald-500/40'
                : 'bg-obsidian-900 border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.06]',
            )}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {/* User Account Menu Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={toggleUserMenu}
              className={cn(
                'flex items-center gap-1.5 h-7 px-2 rounded border transition-colors',
                userMenuOpen
                  ? 'bg-obsidian-900 border-white/20 text-white'
                  : 'bg-obsidian-900 border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.06]',
              )}
            >
              <User className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-medium max-w-[80px] md:max-w-[110px] truncate hidden sm:inline">
                {user?.name?.split(' ')[0] ?? 'User'}
              </span>
              <ChevronDown
                className={cn(
                  'w-3 h-3 text-slate-400 transition-transform duration-150',
                  userMenuOpen && 'rotate-180',
                )}
              />
            </button>

            {/* User Popover Menu */}
            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded bg-obsidian-900 border border-white/15 shadow-2xl py-1 divide-y divide-white/[0.08]">
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold text-white truncate">
                    {user?.name ?? 'Authenticated User'}
                  </p>
                  {user?.email && (
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {user.email}
                    </p>
                  )}
                  {role && (
                    <div className="mt-1.5">
                      <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-forest-900 text-emerald-300 border border-emerald-500/30">
                        {role.replace(/_/g, ' ')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigate('/settings');
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors text-left"
                  >
                    <Settings className="w-3.5 h-3.5 text-slate-400" />
                    <span>Workspace Governance</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 transition-colors text-left"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-400" />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Mobile Hamburger Toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="md:hidden flex items-center justify-center w-7 h-7 rounded border border-white/[0.08] bg-obsidian-900 text-slate-300 hover:text-white"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Mobile Navigation Dropdown Drawer                                  */}
      {/* ------------------------------------------------------------------ */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-obsidian-950 border-b border-white/[0.12] px-3 py-2 z-30 shadow-2xl space-y-3">
          <Link
            to="/"
            onClick={() => setMobileMenuOpen(false)}
            className={cn(
              'flex items-center gap-2 px-2.5 py-1.5 rounded text-xs',
              location.pathname === '/'
                ? 'bg-forest-900 text-white font-medium'
                : 'text-slate-300 hover:bg-white/[0.05]',
            )}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Overview & KPIs</span>
          </Link>

          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter(isItemVisible);
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.groupKey} className="space-y-1">
                <p className="px-2.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
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
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          'flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors',
                          active
                            ? 'bg-forest-900 text-white font-medium'
                            : 'text-slate-300 hover:bg-white/[0.05]',
                        )}
                      >
                        <Icon className="w-3.5 h-3.5 text-slate-400" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Main Content Workbench Viewport                                    */}
      {/* ------------------------------------------------------------------ */}
      <main className="flex-1 overflow-y-auto min-w-0 bg-slate-50">
        <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Lean Corporate Precision Static Footer (#0B1311, h-7)              */}
      {/* ------------------------------------------------------------------ */}
      <footer className="h-7 bg-obsidian-950 border-t border-white/[0.08] px-3 md:px-4 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0 z-40 select-none">
        {/* Left: Active Entity & Connectivity */}
        <div className="flex items-center gap-2 truncate min-w-0">
          <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
          <span className="text-slate-300 font-medium truncate">
            {organization?.legalName || organization?.name || 'JBTDA DWS ERP'}
          </span>
          {organization?.abn && (
            <>
              <span className="text-white/20 hidden sm:inline">•</span>
              <span className="text-slate-400 hidden sm:inline truncate">
                ABN {formatABN(organization.abn)}
              </span>
            </>
          )}
          <span className="text-white/20 hidden md:inline">•</span>
          <span className="text-slate-500 hidden md:inline truncate">
            Cloud SQL (Unix Socket)
          </span>
        </div>

        {/* Center: System Determinism & Governance Badges */}
        <div className="hidden lg:flex items-center gap-2 text-slate-400 text-[10px]">
          <span>Deterministic Ledger Engine</span>
          <span className="text-white/20">•</span>
          <span>Zero-LLM Runtime</span>
          <span className="text-white/20">•</span>
          <span>ATO Mod-89</span>
        </div>

        {/* Right: Version & Corporate Precision branding */}
        <div className="flex items-center gap-2 shrink-0 text-[11px]">
          <Link
            to="/settings"
            className="hover:text-emerald-400 transition-colors hidden sm:inline"
          >
            Audit Log
          </Link>
          <span className="text-white/20 hidden sm:inline">•</span>
          <span className="text-slate-400 font-mono">v0.17.0</span>
          <span className="text-white/20">•</span>
          <span className="text-emerald-400/90 font-medium hidden xs:inline">
            Corporate Precision
          </span>
        </div>
      </footer>

      {/* ------------------------------------------------------------------ */}
      {/* Self-Service Provision Corporate Entity Modal                      */}
      {/* ------------------------------------------------------------------ */}
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
