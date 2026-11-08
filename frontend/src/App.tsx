import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { LoginPage } from '@/pages/LoginPage';
import { OnboardingModal } from '@/pages/OnboardingModal';
import { AppShell } from '@/components/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { ItemsPage } from '@/pages/ItemsPage';
import { BillsPage } from '@/pages/BillsPage';
import { InvoicesPage } from '@/pages/InvoicesPage';
import { AccountsPage } from '@/pages/AccountsPage';
import { LedgerPage } from '@/pages/LedgerPage';
import { ExpensesPage } from '@/pages/ExpensesPage';
import { BankingPage } from '@/pages/BankingPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { SettingsPage } from '@/pages/SettingsPage';

// ---------------------------------------------------------------------------
// Root guard — renders the correct view based on auth status
// ---------------------------------------------------------------------------

function AppRoutes() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
          <p className="text-sm font-light text-slate-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  if (status === 'onboarding') {
    return <OnboardingModal />;
  }

  // Authenticated — render the full app shell with routes
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/bills" element={<BillsPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/banking" element={<BankingPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// App — wraps everything in providers
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

