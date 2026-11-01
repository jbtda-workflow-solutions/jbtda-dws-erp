import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  FileText,
  Receipt,
  BookOpen,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Contacts', href: '/contacts', icon: Users },
  { label: 'Invoices', href: '/invoices', icon: FileText },
  { label: 'Bills', href: '/bills', icon: Receipt },
  { label: 'General Ledger', href: '/ledger', icon: BookOpen },
];

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { logout, role } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* ------------------------------------------------------------------ */}
      {/* Mobile backdrop */}
      {/* ------------------------------------------------------------------ */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Sidebar */}
      {/* ------------------------------------------------------------------ */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-forest-900 transition-transform duration-200',
          'lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-3 px-5 shrink-0">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-forest-50/15">
            <svg viewBox="0 0 32 32" fill="none" className="w-4 h-4">
              <path
                d="M6 22V10h4l4 8 4-8h4v12h-3v-7.5l-3.5 7h-3L9 14.5V22H6z"
                fill="#EAF3EE"
              />
            </svg>
          </div>
          <span className="text-sm font-medium text-forest-50 tracking-tight">
            JBTDA DWS
          </span>
          <button
            className="ml-auto lg:hidden text-forest-50/70 hover:text-forest-50"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-forest-50/15 text-white font-medium'
                    : 'text-forest-50/70 hover:bg-forest-50/10 hover:text-forest-50',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
                {active && (
                  <ChevronRight className="ml-auto w-3 h-3 opacity-50" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-forest-50/10 shrink-0">
          {role && (
            <p className="px-3 mb-2 text-xs text-forest-50/40 uppercase tracking-wider">
              {role.replace(/_/g, ' ')}
            </p>
          )}
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-forest-50/70 hover:bg-forest-50/10 hover:text-forest-50 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Main content area */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="flex lg:hidden h-14 items-center gap-3 px-4 bg-white border-b border-slate-200 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-slate-900">JBTDA DWS</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

