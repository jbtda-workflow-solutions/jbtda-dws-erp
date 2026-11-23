import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  BookOpen,
  BarChart3,
  FileText,
  Receipt,
  Wallet,
  Users,
  Menu,
} from 'lucide-react';
import type { Role } from '@/api/client';
import { cn } from '@/lib/utils';

interface BottomTab {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  requiredModule?: string;
}

function getTabsForRole(role: Role | null, enabledModules?: string[]): BottomTab[] {
  const isEnabled = (mod?: string) =>
    !mod || !enabledModules || enabledModules.includes(mod);

  if (role === 'EMPLOYEE') {
    return [
      { label: 'Home', href: '/', icon: LayoutDashboard },
      { label: 'My Claims', href: '/expenses', icon: Wallet, requiredModule: 'EXPENSES' },
    ].filter((t) => isEnabled(t.requiredModule));
  }

  if (role === 'ACCOUNTANT' || role === 'AUDITOR') {
    return [
      { label: 'Home', href: '/', icon: LayoutDashboard },
      { label: 'Banking', href: '/banking', icon: Building2 },
      { label: 'Ledger', href: '/ledger', icon: BookOpen },
      { label: 'Reports', href: '/reports', icon: BarChart3 },
    ];
  }

  if (role === 'AR_SPECIALIST') {
    return [
      { label: 'Home', href: '/', icon: LayoutDashboard },
      { label: 'Invoices', href: '/invoices', icon: FileText, requiredModule: 'RECEIVABLES' },
      { label: 'Contacts', href: '/contacts', icon: Users },
      { label: 'Banking', href: '/banking', icon: Building2 },
    ].filter((t) => isEnabled(t.requiredModule));
  }

  if (role === 'AP_SPECIALIST') {
    return [
      { label: 'Home', href: '/', icon: LayoutDashboard },
      { label: 'Bills', href: '/bills', icon: Receipt, requiredModule: 'PAYABLES' },
      { label: 'Expenses', href: '/expenses', icon: Wallet, requiredModule: 'EXPENSES' },
      { label: 'Contacts', href: '/contacts', icon: Users },
    ].filter((t) => isEnabled(t.requiredModule));
  }

  // ADMIN & MANAGER default primary operational/financial tabs
  return [
    { label: 'Home', href: '/', icon: LayoutDashboard },
    { label: 'Banking', href: '/banking', icon: Building2 },
    { label: 'Invoices', href: '/invoices', icon: FileText, requiredModule: 'RECEIVABLES' },
    { label: 'Bills', href: '/bills', icon: Receipt, requiredModule: 'PAYABLES' },
  ].filter((t) => isEnabled(t.requiredModule));
}

interface MobileBottomNavProps {
  role: Role | null;
  enabledModules?: string[];
  onOpenMenu: () => void;
  menuOpen: boolean;
}

export function MobileBottomNav({
  role,
  enabledModules,
  onOpenMenu,
  menuOpen,
}: MobileBottomNavProps) {
  const location = useLocation();
  const tabs = getTabsForRole(role, enabledModules);

  return (
    <nav
      aria-label="Mobile navigation"
      className="no-print print:hidden md:hidden fixed bottom-0 inset-x-0 z-40 h-14 bg-obsidian-950 border-t border-white/[0.08] flex items-stretch justify-around px-1 select-none"
    >
      {tabs.map((tab) => {
        const active = location.pathname === tab.href && !menuOpen;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            to={tab.href}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[10px] font-medium transition-colors',
              active
                ? 'text-emerald-400'
                : 'text-slate-400 hover:text-slate-200',
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{tab.label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={onOpenMenu}
        className={cn(
          'flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[10px] font-medium transition-colors',
          menuOpen ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200',
        )}
      >
        <Menu className="w-4 h-4 shrink-0" />
        <span>More</span>
      </button>
    </nav>
  );
}
