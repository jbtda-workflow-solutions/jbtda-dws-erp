import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Sparkles,
  Scale,
  ArrowRightLeft,
  SlidersHorizontal,
} from 'lucide-react';
import {
  accountsApi,
  bankingApi,
  contactApi,
  type AccountWithBalance,
  type BankAccountSummary,
  type Contact,
  type TrackingCategory,
} from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { AccountTransactionsTab } from '@/features/bookkeeping/AccountTransactionsTab';
import { BankRulesCashCodingTab } from '@/features/bookkeeping/BankRulesCashCodingTab';
import { BankRecReportTab } from '@/features/bookkeeping/BankRecReportTab';
import { FindRecodeTab } from '@/features/bookkeeping/FindRecodeTab';
import { ConversionBalancesTab } from '@/features/bookkeeping/ConversionBalancesTab';

type BookkeepingTab = 'REGISTER' | 'CASH_CODING' | 'REC_REPORT' | 'FIND_RECODE' | 'CONVERSION';

export function BookkeepingPage() {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canWrite = role === 'ADMIN' || role === 'ACCOUNTANT';

  const initialTab = (searchParams.get('tab') as BookkeepingTab | null) ?? 'REGISTER';
  const [activeTab, setActiveTab] = useState<BookkeepingTab>(initialTab);

  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountSummary[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [trackingCategories, setTrackingCategories] = useState<TrackingCategory[]>([]);

  useEffect(() => {
    const paramTab = searchParams.get('tab') as BookkeepingTab | null;
    if (paramTab && paramTab !== activeTab) {
      setActiveTab(paramTab);
    }
  }, [searchParams]);

  useEffect(() => {
    Promise.all([
      accountsApi.list(),
      bankingApi.listAccounts(),
      contactApi.list(),
      accountsApi.listTrackingCategories(),
    ])
      .then(([accRes, bankRes, contactRes, tcRes]) => {
        setAccounts(accRes.accounts || []);
        setBankAccounts(bankRes.accounts || []);
        setContacts(contactRes.contacts || []);
        setTrackingCategories(tcRes.categories || []);
      })
      .catch(() => {
        // tolerant load
      });
  }, []);

  const switchTab = (tab: BookkeepingTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const tabs: Array<{ key: BookkeepingTab; label: string; icon: typeof BookOpen; writeOnly?: boolean }> = [
    { key: 'REGISTER', label: 'Account Transactions', icon: BookOpen },
    { key: 'CASH_CODING', label: 'Bank Rules & Cash Coding', icon: Sparkles },
    { key: 'REC_REPORT', label: 'Bank Rec Proof', icon: Scale },
    { key: 'FIND_RECODE', label: 'Find & Recode', icon: ArrowRightLeft, writeOnly: true },
    { key: 'CONVERSION', label: 'Conversion Balances', icon: SlidersHorizontal, writeOnly: true },
  ];

  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-slate-200">
        <h1 className="text-xl font-medium tracking-tight text-slate-900">
          Bookkeeping Workbench
        </h1>
        <p className="text-xs font-light text-slate-500 mt-1">
          Interactive account register, deterministic bank rules, bulk cash coding, split reconciliation, Find & Recode, and conversion balances.
        </p>
      </div>

      {/* Responsive Horizontal Sub-Navigation Tab Bar */}
      <div className="border-b border-slate-200 overflow-x-auto no-print">
        <div className="flex items-center gap-1 min-w-max">
          {tabs
            .filter((t) => !t.writeOnly || canWrite)
            .map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => switchTab(t.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2.5 min-h-[40px] text-xs transition-colors border-b-2 whitespace-nowrap ${
                    active
                      ? 'border-forest-900 text-forest-900 font-medium'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
        </div>
      </div>

      {activeTab === 'REGISTER' && (
        <AccountTransactionsTab
          accounts={accounts}
          trackingCategories={trackingCategories}
          initialAccountId={searchParams.get('accountId') ?? ''}
          initialStartDate={searchParams.get('startDate') ?? ''}
          initialEndDate={searchParams.get('endDate') ?? ''}
        />
      )}

      {activeTab === 'CASH_CODING' && (
        <BankRulesCashCodingTab
          bankAccounts={bankAccounts}
          accounts={accounts}
          contacts={contacts}
          trackingCategories={trackingCategories}
          canWrite={canWrite}
        />
      )}

      {activeTab === 'REC_REPORT' && <BankRecReportTab bankAccounts={bankAccounts} />}

      {activeTab === 'FIND_RECODE' && canWrite && (
        <FindRecodeTab accounts={accounts} trackingCategories={trackingCategories} />
      )}

      {activeTab === 'CONVERSION' && canWrite && <ConversionBalancesTab accounts={accounts} />}
    </div>
  );
}
