import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  X,
  ArrowRight,
  Users,
  FileText,
  Receipt,
  BookOpen,
  Landmark,
  Wallet,
  Package,
  Building2,
  BarChart3,
  Settings,
  Plug,
  Terminal,
  LayoutDashboard,
} from 'lucide-react';
import {
  searchApi,
  type GlobalSearchResult,
  type SearchResultCategory,
  type Role,
} from '@/api/client';
import { cn } from '@/lib/utils';

interface QuickDestination {
  label: string;
  subtitle: string;
  href: string;
  icon: typeof LayoutDashboard;
  allowedRoles: Role[];
  requiredModule?: string;
}

const QUICK_DESTINATIONS: QuickDestination[] = [
  {
    label: 'Dashboard Home',
    subtitle: 'Role workbench overview & live KPIs',
    href: '/',
    icon: LayoutDashboard,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AR_SPECIALIST', 'AP_SPECIALIST', 'EMPLOYEE', 'AUDITOR'],
  },
  {
    label: 'Banking & Reconciliation',
    subtitle: 'Bank accounts, CSV statement import & matching',
    href: '/banking',
    icon: Building2,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AR_SPECIALIST', 'AP_SPECIALIST', 'AUDITOR'],
  },
  {
    label: 'Journal Ledger',
    subtitle: 'Posted journals, manual entries & recurring schedules',
    href: '/ledger',
    icon: BookOpen,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'AUDITOR'],
  },
  {
    label: 'Chart of Accounts',
    subtitle: 'GL accounts, system accounts & tracking dimensions',
    href: '/accounts',
    icon: Landmark,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'AUDITOR'],
  },
  {
    label: 'Reports & ATO BAS',
    subtitle: 'Trial Balance, P&L, Balance Sheet, Aged AR/AP & BAS',
    href: '/reports',
    icon: BarChart3,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AUDITOR'],
  },
  {
    label: 'Receivables & Invoices (AR)',
    subtitle: 'Quotes, customer invoices, credit notes & receipts',
    href: '/invoices',
    icon: FileText,
    requiredModule: 'RECEIVABLES',
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AR_SPECIALIST', 'AUDITOR'],
  },
  {
    label: 'Payables & Bills (AP)',
    subtitle: 'Purchase orders, vendor bills, vendor credits & .ABA runs',
    href: '/bills',
    icon: Receipt,
    requiredModule: 'PAYABLES',
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AP_SPECIALIST', 'AUDITOR'],
  },
  {
    label: 'Expenses & Claims',
    subtitle: 'Direct spend money & employee expense reimbursements',
    href: '/expenses',
    icon: Wallet,
    requiredModule: 'EXPENSES',
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AR_SPECIALIST', 'AP_SPECIALIST', 'EMPLOYEE', 'AUDITOR'],
  },
  {
    label: 'Contacts Directory',
    subtitle: 'Customers, vendors, ABNs & EFT banking profiles',
    href: '/contacts',
    icon: Users,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AR_SPECIALIST', 'AP_SPECIALIST', 'AUDITOR'],
  },
  {
    label: 'Items & Services Catalog',
    subtitle: 'Coded SKUs, default accounts & unit pricing',
    href: '/items',
    icon: Package,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AR_SPECIALIST', 'AP_SPECIALIST', 'AUDITOR'],
  },
  {
    label: 'Connectors Hub',
    subtitle: 'Google Workspace OAuth & scoped inbound API keys',
    href: '/connectors',
    icon: Plug,
    requiredModule: 'CONNECTORS',
    allowedRoles: ['ADMIN', 'ACCOUNTANT'],
  },
  {
    label: 'Workspace & Settings',
    subtitle: 'Company profile, team roles, audit log & bulk CSV import',
    href: '/settings',
    icon: Settings,
    allowedRoles: ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'AR_SPECIALIST', 'AP_SPECIALIST', 'EMPLOYEE', 'AUDITOR'],
  },
  {
    label: 'Developer Console',
    subtitle: 'Docs, API catalog, roadmap & database manager',
    href: '/developer',
    icon: Terminal,
    requiredModule: 'DEVELOPER_PORTAL',
    allowedRoles: ['ADMIN'],
  },
];

const CATEGORY_META: Record<
  SearchResultCategory,
  { label: string; icon: typeof FileText }
> = {
  CONTACT: { label: 'Contact', icon: Users },
  INVOICE: { label: 'Invoice', icon: FileText },
  QUOTE: { label: 'Quote', icon: FileText },
  BILL: { label: 'Bill', icon: Receipt },
  PURCHASE_ORDER: { label: 'PO', icon: Receipt },
  EXPENSE_CLAIM: { label: 'Claim', icon: Wallet },
  DIRECT_TRANSACTION: { label: 'Spend/Rec', icon: Wallet },
  ACCOUNT: { label: 'Account', icon: Landmark },
  JOURNAL: { label: 'Journal', icon: BookOpen },
  ITEM: { label: 'Item', icon: Package },
};

function formatAud(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}$${(abs / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  role: Role | null;
  enabledModules?: string[];
}

export function GlobalSearchModal({
  open,
  onClose,
  role,
  enabledModules,
}: GlobalSearchModalProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleDestinations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return QUICK_DESTINATIONS.filter((dest) => {
      if (role && !dest.allowedRoles.includes(role)) return false;
      if (dest.requiredModule && enabledModules && !enabledModules.includes(dest.requiredModule)) {
        return false;
      }
      if (!q) return true;
      return (
        dest.label.toLowerCase().includes(q) ||
        dest.subtitle.toLowerCase().includes(q)
      );
    }).slice(0, 6);
  }, [query, role, enabledModules]);

  // Reset & focus on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Debounced cross-module search
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      searchApi
        .query(trimmed, 18)
        .then((res) => {
          if (!cancelled) {
            setResults(res.results);
            setActiveIndex(0);
          }
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  // Combined selectable items for keyboard navigation
  const selectableItems = useMemo(() => {
    const items: Array<{ key: string; href: string }> = [];
    for (const r of results) {
      items.push({ key: `res-${r.category}-${r.id}`, href: r.href });
    }
    for (const d of visibleDestinations) {
      items.push({ key: `nav-${d.href}`, href: d.href });
    }
    return items;
  }, [results, visibleDestinations]);

  const handleSelect = (href: string) => {
    onClose();
    navigate(href);
  };

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((idx) =>
          selectableItems.length > 0 ? (idx + 1) % selectableItems.length : 0,
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((idx) =>
          selectableItems.length > 0
            ? (idx - 1 + selectableItems.length) % selectableItems.length
            : 0,
        );
      } else if (e.key === 'Enter') {
        const chosen = selectableItems[activeIndex];
        if (chosen) {
          e.preventDefault();
          handleSelect(chosen.href);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, selectableItems, activeIndex]);

  if (!open) return null;

  let runningIndex = 0;

  return createPortal(
    <div
      className="fixed inset-0 !mt-0 z-50 flex items-start justify-center bg-obsidian-950/60 backdrop-blur-[1px] pt-12 sm:pt-20 px-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-md border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Search Input Bar */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-200 bg-slate-50/60">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts, invoices, bills, accounts, journals, or $amount…"
            className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none min-h-[36px]"
          />
          {loading && (
            <div className="w-3.5 h-3.5 rounded-full border-2 border-forest-900 border-t-transparent animate-spin shrink-0" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/70"
            aria-label="Close search"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results & Quick Navigation Body */}
        <div className="overflow-y-auto divide-y divide-slate-100">
          {/* Live Record Results */}
          {query.trim().length >= 2 && (
            <div className="py-1.5">
              <div className="px-3.5 py-1 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Matching Records ({results.length})
                </span>
                <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
                  Tip: search exact AUD amounts like $450.00
                </span>
              </div>

              {!loading && results.length === 0 ? (
                <div className="px-3.5 py-4 text-xs text-slate-500">
                  No matching records found for <span className="font-mono text-slate-700">"{query}"</span>.
                </div>
              ) : (
                <div>
                  {results.map((r) => {
                    const idx = runningIndex++;
                    const meta = CATEGORY_META[r.category];
                    const Icon = meta.icon;
                    const isSelected = idx === activeIndex;
                    return (
                      <button
                        key={`res-${r.category}-${r.id}`}
                        type="button"
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => handleSelect(r.href)}
                        className={cn(
                          'w-full px-3.5 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 text-left flex items-center justify-between gap-3 transition-colors',
                          isSelected
                            ? 'bg-forest-50/80 text-slate-900'
                            : 'text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className="w-4 h-4 text-forest-700 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-900 truncate">
                                {r.title}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px] text-slate-600 shrink-0">
                                {meta.label}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 truncate">
                              {r.subtitle}
                              {r.date ? ` · ${r.date}` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {typeof r.amountCents === 'number' && (
                            <span className="font-mono text-xs font-medium tabular-nums text-slate-900">
                              {formatAud(r.amountCents)}
                            </span>
                          )}
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Quick Jump Workbenches */}
          {visibleDestinations.length > 0 && (
            <div className="py-1.5">
              <div className="px-3.5 py-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Go To Workbench
                </span>
              </div>
              {visibleDestinations.map((dest) => {
                const idx = runningIndex++;
                const Icon = dest.icon;
                const isSelected = idx === activeIndex;
                return (
                  <button
                    key={dest.href}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleSelect(dest.href)}
                    className={cn(
                      'w-full px-3.5 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 text-left flex items-center justify-between gap-3 transition-colors',
                      isSelected
                        ? 'bg-forest-50/80 text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-900 truncate">
                          {dest.label}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {dest.subtitle}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Keyboard Hints */}
        <div className="hidden sm:flex items-center justify-between px-3.5 py-2 bg-slate-50 border-t border-slate-200 text-[10px] font-mono text-slate-500">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>ESC Close</span>
          </div>
          <span>RBAC & Tenant Scoped</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
