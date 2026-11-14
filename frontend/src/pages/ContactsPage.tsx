import React, { useEffect, useState, useMemo } from 'react';
import {
  Users,
  Plus,
  Search,
  Building2,
  Mail,
  Phone,
  MapPin,
  Clock,
  Edit2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  CreditCard,
  History,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  contactApi,
  accountsApi,
  type Contact,
  type ContactType,
  type Contact360Response,
  type AccountWithBalance,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { StatusTag } from '@/components/ui/StatusTag';

/**
 * Validate Australian Business Number (11 digits, ATO modulus 89 algorithm).
 */
function validateABN(abn: string): boolean {
  const digits = abn.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const adjusted = [Number(digits[0]) - 1, ...digits.slice(1).split('').map(Number)];
  const sum = adjusted.reduce((acc, d, i) => acc + d * weights[i]!, 0);
  return sum % 89 === 0;
}

function formatABN(abn?: string | null): string {
  if (!abn) return '—';
  const d = abn.replace(/\D/g, '');
  if (d.length !== 11) return abn;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 11)}`;
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const CONTACT_TYPE_TONES: Record<ContactType, 'forest' | 'amber' | 'emerald'> = {
  CUSTOMER: 'forest',
  VENDOR: 'amber',
  BOTH: 'emerald',
};

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  CUSTOMER: 'Customer',
  VENDOR: 'Vendor',
  BOTH: 'Customer & Vendor',
};

export function ContactsPage() {
  const { role } = useAuth();
  const isAdmin = role === 'ADMIN';
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [glAccounts, setGlAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ContactType>('ALL');

  // Contact 360 Drawer state
  const [drawerContactId, setDrawerContactId] = useState<string | null>(null);
  const [drawerData, setDrawerData] = useState<Contact360Response | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Create / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [modalFormError, setModalFormError] = useState<string | null>(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // Form Fields
  const [formType, setFormType] = useState<ContactType>('CUSTOMER');
  const [formName, setFormName] = useState('');
  const [formLegalName, setFormLegalName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formBillingAddress, setFormBillingAddress] = useState('');
  const [formAbn, setFormAbn] = useState('');
  const [formPaymentTermsDays, setFormPaymentTermsDays] = useState(30);
  const [formRequiresInvoice, setFormRequiresInvoice] = useState(true);
  const [formDefaultRevenueAccountId, setFormDefaultRevenueAccountId] = useState('');
  const [formDefaultExpenseAccountId, setFormDefaultExpenseAccountId] = useState('');
  const [formBankBsb, setFormBankBsb] = useState('');
  const [formBankAccountNumber, setFormBankAccountNumber] = useState('');
  const [formBankAccountName, setFormBankAccountName] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);

  // Load Contacts and GL Accounts on mount
  const fetchContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resContacts, resAccounts] = await Promise.all([
        contactApi.list(),
        accountsApi.list(),
      ]);
      setContacts(resContacts.contacts);
      setGlAccounts(resAccounts.accounts);
    } catch (err: any) {
      setError(err.message || 'Failed to load contacts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchContacts();
  }, []);

  // Filtered GL Accounts for dropdowns
  const revenueAccounts = useMemo(() => {
    return glAccounts.filter((a) => a.type === 'REVENUE' && a.isActive);
  }, [glAccounts]);

  const expenseAccounts = useMemo(() => {
    return glAccounts.filter((a) => a.type === 'EXPENSE' && a.isActive);
  }, [glAccounts]);

  // Load 360 data when drawer opens
  useEffect(() => {
    if (!drawerContactId) {
      setDrawerData(null);
      setDrawerError(null);
      return;
    }

    let isCurrent = true;
    setDrawerLoading(true);
    setDrawerError(null);

    contactApi
      .get360(drawerContactId)
      .then((data) => {
        if (isCurrent) setDrawerData(data);
      })
      .catch((err: any) => {
        if (isCurrent) setDrawerError(err.message || 'Failed to load Contact 360 view.');
      })
      .finally(() => {
        if (isCurrent) setDrawerLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [drawerContactId]);

  // Filtered Contacts
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      const matchesType =
        typeFilter === 'ALL' ||
        c.type === typeFilter ||
        c.type === 'BOTH';

      const q = search.trim().toLowerCase();
      const cleanDigits = q.replace(/\s/g, '');
      const matchesSearch =
        q === '' ||
        c.name.toLowerCase().includes(q) ||
        (c.legalName && c.legalName.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.abn && cleanDigits.length > 0 && c.abn.includes(cleanDigits)) ||
        (c.bankBsb && c.bankBsb.includes(cleanDigits));

      return matchesType && matchesSearch;
    });
  }, [contacts, typeFilter, search]);

  // KPI Metrics
  const metrics = useMemo(() => {
    const total = contacts.length;
    const customers = contacts.filter((c) => c.type === 'CUSTOMER' && c.isActive).length;
    const vendors = contacts.filter((c) => c.type === 'VENDOR' && c.isActive).length;
    const both = contacts.filter((c) => c.type === 'BOTH' && c.isActive).length;
    return { total, customers, vendors, both };
  }, [contacts]);

  // Modal Open Handlers
  const handleOpenCreate = () => {
    setEditingContact(null);
    setFormType('CUSTOMER');
    setFormName('');
    setFormLegalName('');
    setFormEmail('');
    setFormPhone('');
    setFormBillingAddress('');
    setFormAbn('');
    setFormPaymentTermsDays(30);
    setFormRequiresInvoice(true);
    setFormDefaultRevenueAccountId('');
    setFormDefaultExpenseAccountId('');
    setFormBankBsb('');
    setFormBankAccountNumber('');
    setFormBankAccountName('');
    setFormIsActive(true);
    setModalFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormType(contact.type);
    setFormName(contact.name);
    setFormLegalName(contact.legalName ?? '');
    setFormEmail(contact.email ?? '');
    setFormPhone(contact.phone ?? '');
    setFormBillingAddress(contact.billingAddress ?? '');
    setFormAbn(contact.abn ?? '');
    setFormPaymentTermsDays(contact.paymentTermsDays);
    setFormRequiresInvoice(contact.requiresInvoiceForPayment);
    setFormDefaultRevenueAccountId(contact.defaultRevenueAccountId ?? '');
    setFormDefaultExpenseAccountId(contact.defaultExpenseAccountId ?? '');
    setFormBankBsb(contact.bankBsb ?? '');
    setFormBankAccountNumber(contact.bankAccountNumber ?? '');
    setFormBankAccountName(contact.bankAccountName ?? '');
    setFormIsActive(contact.isActive);
    setModalFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmitModal = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalFormError(null);

    // Validate ABN if entered
    if (formAbn.trim().length > 0 && !validateABN(formAbn)) {
      setModalFormError('Invalid Australian Business Number (ABN). Please check the 11-digit number.');
      return;
    }

    setModalSubmitting(true);
    try {
      const payload = {
        type: formType,
        name: formName.trim(),
        legalName: formLegalName.trim() || null,
        email: formEmail.trim() || null,
        phone: formPhone.trim() || null,
        billingAddress: formBillingAddress.trim() || null,
        abn: formAbn.trim() || null,
        paymentTermsDays: Number(formPaymentTermsDays) || 30,
        requiresInvoiceForPayment: formRequiresInvoice,
        defaultRevenueAccountId: formDefaultRevenueAccountId || null,
        defaultExpenseAccountId: formDefaultExpenseAccountId || null,
        bankBsb: formBankBsb.trim() || null,
        bankAccountNumber: formBankAccountNumber.trim() || null,
        bankAccountName: formBankAccountName.trim() || null,
      };

      if (editingContact) {
        const res = await contactApi.update(editingContact.id, {
          ...payload,
          isActive: formIsActive,
        });
        setContacts((prev) =>
          prev.map((c) => (c.id === res.contact.id ? res.contact : c)),
        );
        if (drawerContactId === res.contact.id) {
          void contactApi.get360(res.contact.id).then((d) => setDrawerData(d));
        }
      } else {
        const res = await contactApi.create(payload);
        setContacts((prev) => [res.contact, ...prev]);
      }

      setIsModalOpen(false);
    } catch (err: any) {
      setModalFormError(err.message || 'Failed to save contact.');
    } finally {
      setModalSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-slate-900">
            Contacts Directory
          </h1>
          <p className="text-xs font-light text-slate-500 mt-0.5">
            Centralized customer and vendor records with Australian ABN, EFT banking, and 360° ledger history.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="inline-flex items-center gap-1.5 h-8 text-xs font-medium">
          <Plus className="w-3.5 h-3.5" />
          <span>New Contact</span>
        </Button>
      </div>

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-md p-3.5">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Contacts</p>
          <p className="text-xl font-semibold text-slate-900 font-mono tabular-nums mt-1">
            {metrics.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-md p-3.5">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Customers</p>
          <p className="text-xl font-semibold text-forest-900 font-mono tabular-nums mt-1">
            {metrics.customers}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-md p-3.5">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Vendors / Suppliers</p>
          <p className="text-xl font-semibold text-amber-700 font-mono tabular-nums mt-1">
            {metrics.vendors}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-md p-3.5">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Dual Role (Both)</p>
          <p className="text-xl font-semibold text-emerald-700 font-mono tabular-nums mt-1">
            {metrics.both}
          </p>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="bg-white border border-slate-200 rounded-md p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, legal entity, email, ABN, or BSB…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-forest-900 focus:border-forest-900 font-light"
          />
        </div>

        {/* Type Filter Pills */}
        <div className="flex items-center gap-1 bg-slate-50 p-1 rounded border border-slate-200 self-start sm:self-auto text-xs font-medium text-slate-600">
          {(['ALL', 'CUSTOMER', 'VENDOR', 'BOTH'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 rounded transition-colors text-[11px] font-medium ${
                typeFilter === t
                  ? 'bg-white text-forest-950 shadow-xs border border-slate-200'
                  : 'hover:text-slate-900 text-slate-600'
              }`}
            >
              {t === 'ALL' ? 'All' : CONTACT_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 flex items-center gap-2.5 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Contacts Table */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
            <p className="text-xs font-light text-slate-500">Loading contacts directory…</p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-500">
              <Users className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-800">No contacts found</p>
            <p className="text-xs font-light text-slate-400 mt-1 max-w-sm mx-auto">
              {search || typeFilter !== 'ALL'
                ? 'Try adjusting your search query or role filter.'
                : 'Create your first customer or vendor contact to begin generating quotes, invoices, and bills.'}
            </p>
            {!search && typeFilter === 'ALL' && (
              <Button onClick={handleOpenCreate} size="sm" className="mt-4 text-xs h-8">
                Add Contact
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Entity & Legal Name</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4 font-mono">ABN</th>
                  <th className="py-2.5 px-4 font-mono">EFT Banking</th>
                  <th className="py-2.5 px-4">Payment Terms</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredContacts.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setDrawerContactId(c.id)}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                          <Building2 className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{c.name}</p>
                          {c.legalName && c.legalName !== c.name && (
                            <p className="text-[11px] text-slate-400 font-light">{c.legalName}</p>
                          )}
                          {c.email && (
                            <p className="text-[11px] text-slate-400 font-light flex items-center gap-1 mt-0.5">
                              <Mail className="w-2.5 h-2.5 text-slate-400" />
                              <span>{c.email}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusTag
                        label={CONTACT_TYPE_LABELS[c.type]}
                        tone={CONTACT_TYPE_TONES[c.type]}
                      />
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-700">
                      {c.abn ? formatABN(c.abn) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px]">
                      {c.bankBsb && c.bankAccountNumber ? (
                        <div>
                          <span className="text-slate-800 font-medium">BSB {c.bankBsb}</span>
                          <span className="text-slate-400 ml-1.5">Acct {c.bankAccountNumber}</span>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>Net {c.paymentTermsDays} days</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <StatusTag
                        label={c.isActive ? 'Active' : 'Inactive'}
                        tone={c.isActive ? 'emerald' : 'slate'}
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div
                        className="inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDrawerContactId(c.id)}
                          className="h-7 px-2 text-[11px] text-slate-600 hover:text-slate-900"
                          title="Open 360 View"
                        >
                          <History className="w-3 h-3 mr-1 text-slate-400" />
                          <span>360°</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(c)}
                          className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900"
                          title="Edit Contact"
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Contact 360 Detail Drawer */}
      <Drawer
        open={Boolean(drawerContactId)}
        onClose={() => setDrawerContactId(null)}
        title={drawerData?.contact.name ?? 'Contact 360° Profile'}
        width="xl"
      >
        {drawerLoading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
            <p className="text-xs font-light text-slate-500">Loading Contact 360 ledger history…</p>
          </div>
        ) : drawerError ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <p>{drawerError}</p>
          </div>
        ) : drawerData ? (
          <div className="space-y-6">
            {/* Header Identity Card */}
            <div className="bg-slate-50 border border-slate-200 rounded p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">
                      {drawerData.contact.name}
                    </h3>
                    <StatusTag
                      label={CONTACT_TYPE_LABELS[drawerData.contact.type]}
                      tone={CONTACT_TYPE_TONES[drawerData.contact.type]}
                    />
                  </div>
                  {drawerData.contact.legalName && (
                    <p className="text-xs text-slate-500 font-light mt-0.5">
                      Legal: {drawerData.contact.legalName}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      handleOpenEdit(drawerData.contact);
                    }}
                    className="h-7 text-xs px-2.5"
                  >
                    <Edit2 className="w-3 h-3 mr-1" />
                    <span>Edit Profile</span>
                  </Button>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (!window.confirm(`Delete contact "${drawerData.contact.name}"? Contacts with linked transactions cannot be deleted and should be marked Inactive instead.`)) return;
                        try {
                          await contactApi.delete(drawerData.contact.id);
                          setContacts((prev) => prev.filter((c) => c.id !== drawerData.contact.id));
                          setDrawerContactId(null);
                        } catch (err: any) {
                          alert(err.message || 'Failed to delete contact.');
                        }
                      }}
                      className="h-7 text-xs px-2.5 text-rose-700 border-rose-200 hover:bg-rose-50"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      <span>Delete</span>
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 pt-2 border-t border-slate-200">
                {drawerData.contact.abn && (
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-forest-700 shrink-0" />
                    <span className="font-mono">ABN {formatABN(drawerData.contact.abn)}</span>
                  </div>
                )}
                {drawerData.contact.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{drawerData.contact.email}</span>
                  </div>
                )}
                {drawerData.contact.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{drawerData.contact.phone}</span>
                  </div>
                )}
                {drawerData.contact.billingAddress && (
                  <div className="flex items-center gap-1.5 sm:col-span-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{drawerData.contact.billingAddress}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Vendor EFT Remittance Card (for AP batch payments) */}
            <div className="border border-slate-200 rounded p-3.5 bg-white space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                  <span>EFT Bank Remittance (.ABA Ready)</span>
                </p>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Australian Cemtex</span>
              </div>
              {drawerData.contact.bankBsb && drawerData.contact.bankAccountNumber ? (
                <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded border border-slate-100 text-xs font-mono">
                  <div>
                    <span className="block text-[10px] text-slate-400 font-sans uppercase">BSB Number</span>
                    <span className="font-medium text-slate-800">{drawerData.contact.bankBsb}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 font-sans uppercase">Account Number</span>
                    <span className="font-medium text-slate-800">{drawerData.contact.bankAccountNumber}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 font-sans uppercase">Account Name</span>
                    <span className="font-medium text-slate-800 truncate block">
                      {drawerData.contact.bankAccountName || drawerData.contact.name}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">
                  No EFT banking details configured. Edit contact to add BSB and Account Number for automated .ABA supplier payments.
                </p>
              )}
            </div>

            {/* Financial Ledger Standing Tiles */}
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-slate-200 rounded p-3 bg-white">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-forest-700" />
                    <span>Outstanding AR</span>
                  </span>
                  <span className="text-[10px] uppercase font-mono">Receivables</span>
                </div>
                <p className="text-lg font-semibold font-mono text-slate-900 mt-1">
                  {formatCents(drawerData.summary.totalOutstandingArCents)}
                </p>

                {/* Aging breakdown */}
                <div className="mt-2.5 pt-2 border-t border-slate-100 grid grid-cols-4 gap-1 text-[10px] font-mono">
                  <div>
                    <span className="block text-slate-400 font-sans">Current</span>
                    <span className="text-slate-700">{formatCents(drawerData.summary.arAging.currentCents)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-sans">1–30d</span>
                    <span className="text-slate-700">{formatCents(drawerData.summary.arAging.days30Cents)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-sans">31–60d</span>
                    <span className="text-slate-700">{formatCents(drawerData.summary.arAging.days60Cents)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-sans">61d+</span>
                    <span className="text-amber-700 font-medium">
                      {formatCents(drawerData.summary.arAging.days90PlusCents)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded p-3 bg-white">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5 text-amber-700" />
                    <span>Outstanding AP</span>
                  </span>
                  <span className="text-[10px] uppercase font-mono">Payables</span>
                </div>
                <p className="text-lg font-semibold font-mono text-slate-900 mt-1">
                  {formatCents(drawerData.summary.totalOutstandingApCents)}
                </p>

                {/* Aging breakdown */}
                <div className="mt-2.5 pt-2 border-t border-slate-100 grid grid-cols-4 gap-1 text-[10px] font-mono">
                  <div>
                    <span className="block text-slate-400 font-sans">Current</span>
                    <span className="text-slate-700">{formatCents(drawerData.summary.apAging.currentCents)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-sans">1–30d</span>
                    <span className="text-slate-700">{formatCents(drawerData.summary.apAging.days30Cents)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-sans">31–60d</span>
                    <span className="text-slate-700">{formatCents(drawerData.summary.apAging.days60Cents)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-sans">61d+</span>
                    <span className="text-amber-700 font-medium">
                      {formatCents(drawerData.summary.apAging.days90PlusCents)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Unified Chronological Activity History */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-slate-500" />
                <span>Chronological Transaction Feed</span>
              </p>

              {drawerData.activity.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded text-xs text-slate-400">
                  No historical invoices, bills, quotes or payments recorded for this contact yet.
                </div>
              ) : (
                <div className="border border-slate-200 rounded overflow-hidden divide-y divide-slate-100 text-xs">
                  {drawerData.activity.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 bg-white hover:bg-slate-50/75 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          {formatDate(item.date)}
                        </span>
                        <StatusTag
                          label={item.docType.replace('_', ' ')}
                          tone={
                            item.docType === 'INVOICE' ||
                            item.docType === 'PAYMENT_IN' ||
                            item.docType === 'RECEIVE_MONEY'
                              ? 'forest'
                              : item.docType === 'BILL' ||
                                item.docType === 'PAYMENT_OUT' ||
                                item.docType === 'SPEND_MONEY'
                              ? 'amber'
                              : 'slate'
                          }
                        />
                        <div className="min-w-0">
                          <p className="font-mono font-medium text-slate-800 truncate">
                            {item.referenceNumber}
                          </p>
                          {item.details && (
                            <p className="text-[10px] text-slate-400 truncate">{item.details}</p>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-mono font-semibold text-slate-900 block">
                          {formatCents(item.amountCents)}
                        </span>
                        {item.status && (
                          <span className="text-[10px] text-slate-400 font-medium">
                            {item.status}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>

      {/* Create / Edit Contact Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingContact ? `Edit Contact: ${editingContact.name}` : 'New Commercial Contact'}
        size="2xl"
      >
        <form onSubmit={handleSubmitModal} className="space-y-4">
          {modalFormError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <p>{modalFormError}</p>
            </div>
          )}

          {/* Section 1: Entity Core Identity */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              1. Entity & Commercial Classification
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contact Role <span className="text-red-500">*</span>
                </label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as ContactType)}
                  className="w-full text-xs rounded border border-slate-200 py-1.5 px-2 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900"
                >
                  <option value="CUSTOMER">Customer (AR)</option>
                  <option value="VENDOR">Vendor / Supplier (AP)</option>
                  <option value="BOTH">Customer & Vendor (Dual)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Display / Trading Name <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Acme Corp"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Legal Entity Name
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Acme Holdings Pty Ltd"
                  value={formLegalName}
                  onChange={(e) => setFormLegalName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Australian ABN (11 digits)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 51 824 753 556"
                  value={formAbn}
                  onChange={(e) => setFormAbn(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Primary Email
                </label>
                <Input
                  type="email"
                  placeholder="accounts@acme.com.au"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Phone Number
                </label>
                <Input
                  type="text"
                  placeholder="+61 2 9000 0000"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Billing / Street Address
              </label>
              <Input
                type="text"
                placeholder="Suite 101, 100 George St, Sydney NSW 2000"
                value={formBillingAddress}
                onChange={(e) => setFormBillingAddress(e.target.value)}
              />
            </div>
          </div>

          {/* Section 2: Payment Policy & Default GL Accounts */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              2. Commercial Terms & General Ledger Defaults
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Payment Terms (Net Days)
                </label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={formPaymentTermsDays}
                  onChange={(e) => setFormPaymentTermsDays(Number(e.target.value))}
                  className="font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Default Revenue Account
                </label>
                <select
                  value={formDefaultRevenueAccountId}
                  onChange={(e) => setFormDefaultRevenueAccountId(e.target.value)}
                  className="w-full text-xs rounded border border-slate-200 py-1.5 px-2 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
                >
                  <option value="">— Select Revenue Account —</option>
                  {revenueAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Default Expense Account
                </label>
                <select
                  value={formDefaultExpenseAccountId}
                  onChange={(e) => setFormDefaultExpenseAccountId(e.target.value)}
                  className="w-full text-xs rounded border border-slate-200 py-1.5 px-2 bg-white focus:outline-none focus:ring-1 focus:ring-forest-900 font-mono"
                >
                  <option value="">— Select Expense Account —</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="requiresInvoiceForPayment"
                checked={formRequiresInvoice}
                onChange={(e) => setFormRequiresInvoice(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-forest-900 focus:ring-forest-900"
              />
              <label htmlFor="requiresInvoiceForPayment" className="text-xs text-slate-700 cursor-pointer">
                Strict Invoice Policy: Incoming or outgoing payments must be matched to an approved tax invoice / bill
              </label>
            </div>
          </div>

          {/* Section 3: Vendor EFT Banking Details (for .ABA batch runs) */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              3. Australian EFT Banking Details (For AP Batch .ABA Export)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bank BSB (6 digits)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 012-345"
                  value={formBankBsb}
                  onChange={(e) => setFormBankBsb(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Account Number
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 12345678"
                  value={formBankAccountNumber}
                  onChange={(e) => setFormBankAccountNumber(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Account Name
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Acme Corp Pty Ltd"
                  value={formBankAccountName}
                  onChange={(e) => setFormBankAccountName(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Status for editing */}
          {editingContact && (
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">Contact Active State</span>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-forest-900 focus:ring-forest-900"
                />
                <span>Active contact (available for document selection)</span>
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={modalSubmitting || !formName.trim()}
              className="text-xs h-8"
            >
              {modalSubmitting ? 'Saving…' : editingContact ? 'Update Contact' : 'Create Contact'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
export default ContactsPage;
