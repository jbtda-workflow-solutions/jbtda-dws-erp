import React, { useEffect, useState, useMemo } from 'react';
import {
  Users,
  Plus,
  Search,
  Building2,
  Mail,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Edit2,
} from 'lucide-react';
import { contactApi, type Contact, type ContactType, ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

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

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ContactType>('ALL');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const fetchContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await contactApi.list();
      setContacts(res.contacts);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load contacts. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchContacts();
  }, []);

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
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.abn && cleanDigits.length > 0 && c.abn.includes(cleanDigits));

      return matchesType && matchesSearch;
    });
  }, [contacts, typeFilter, search]);

  const handleOpenCreate = () => {
    setEditingContact(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (contact: Contact) => {
    setEditingContact(contact);
    setIsModalOpen(true);
  };

  const handleSaved = (savedContact: Contact) => {
    setContacts((prev) => {
      const index = prev.findIndex((c) => c.id === savedContact.id);
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = savedContact;
        return copy;
      }
      return [savedContact, ...prev];
    });
    setIsModalOpen(false);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-slate-900">
            Contacts
          </h1>
          <p className="text-sm font-light text-slate-500 mt-1">
            Manage your customers, vendors, and billing terms.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="inline-flex items-center gap-2">
          <Plus className="w-4 h-4" />
          <span>New Contact</span>
        </Button>
      </div>

      {/* Filters bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or ABN…"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-forest-900 focus:border-transparent font-light"
          />
        </div>

        {/* Type Filter Tabs */}
        <div className="flex items-center bg-slate-100 p-1 rounded-lg self-start sm:self-auto text-xs font-medium text-slate-600">
          {(['ALL', 'CUSTOMER', 'VENDOR', 'BOTH'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                typeFilter === t
                  ? 'bg-white text-forest-950 shadow-sm'
                  : 'hover:text-slate-900'
              }`}
            >
              {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Contacts List / Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-forest-900 border-t-transparent animate-spin" />
            <p className="text-sm font-light text-slate-500">Loading contacts…</p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="py-20 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-forest-50 flex items-center justify-center mx-auto mb-4">
              <Users className="w-5 h-5 text-forest-700" />
            </div>
            <p className="text-base font-medium text-slate-800">No contacts found</p>
            <p className="text-sm font-light text-slate-400 mt-1 max-w-sm mx-auto">
              {search || typeFilter !== 'ALL'
                ? 'Try adjusting your search query or filter criteria.'
                : 'Get started by creating your first customer or vendor contact.'}
            </p>
            {!search && typeFilter === 'ALL' && (
              <Button onClick={handleOpenCreate} className="mt-4">
                Add Contact
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="py-3.5 px-4 lg:px-6">Name</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4">ABN</th>
                  <th className="py-3.5 px-4">Payment Terms</th>
                  <th className="py-3.5 px-4">Invoice Policy</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 lg:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-light text-slate-700">
                {filteredContacts.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/75 transition-colors">
                    <td className="py-3.5 px-4 lg:px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-forest-50 flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4 text-forest-800" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{c.name}</p>
                          {c.email && (
                            <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                              <Mail className="w-3 h-3" />
                              <span>{c.email}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <ContactTypeBadge type={c.type} />
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600">
                      {c.abn ? formatAbn(c.abn) : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Net {c.paymentTermsDays} days</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs">
                      {c.requiresInvoiceForPayment ? (
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          <FileText className="w-3.5 h-3.5 text-slate-400" />
                          <span>Invoice Required</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">Direct payment allowed</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {c.isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                          <XCircle className="w-3 h-3" />
                          <span>Inactive</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 lg:px-6 text-right">
                      <button
                        onClick={() => handleOpenEdit(c)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        title="Edit Contact"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <ContactFormModal
          open={isModalOpen}
          contact={editingContact}
          onClose={() => setIsModalOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contact Type Badge
// ---------------------------------------------------------------------------

function ContactTypeBadge({ type }: { type: ContactType }) {
  switch (type) {
    case 'CUSTOMER':
      return (
        <span className="inline-flex items-center text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
          Customer
        </span>
      );
    case 'VENDOR':
      return (
        <span className="inline-flex items-center text-xs font-medium text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md">
          Vendor
        </span>
      );
    case 'BOTH':
      return (
        <span className="inline-flex items-center text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md">
          Customer & Vendor
        </span>
      );
  }
}

function formatAbn(abn: string): string {
  const digits = abn.replace(/\s/g, '');
  if (digits.length !== 11) return abn;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
}

// ---------------------------------------------------------------------------
// Create / Edit Contact Modal
// ---------------------------------------------------------------------------

interface ContactFormModalProps {
  open: boolean;
  contact: Contact | null;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
}

function ContactFormModal({
  open,
  contact,
  onClose,
  onSaved,
}: ContactFormModalProps) {
  const isEditing = contact !== null;

  const [name, setName] = useState(contact?.name ?? '');
  const [type, setType] = useState<ContactType>(contact?.type ?? 'CUSTOMER');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [abn, setAbn] = useState(contact?.abn ? formatAbn(contact.abn) : '');
  const [paymentTermsDays, setPaymentTermsDays] = useState(
    contact?.paymentTermsDays ?? 30,
  );
  const [requiresInvoiceForPayment, setRequiresInvoiceForPayment] = useState(
    contact?.requiresInvoiceForPayment ?? true,
  );
  const [isActive, setIsActive] = useState(contact?.isActive ?? true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abnError = useMemo(() => {
    const trimmed = abn.trim();
    if (!trimmed) return null;
    const clean = trimmed.replace(/\s/g, '');
    if (clean.length > 0 && !validateABN(clean)) {
      return 'Invalid Australian Business Number (11 digits required)';
    }
    return null;
  }, [abn]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Contact name is required.');
      return;
    }
    if (abnError) {
      setError('Please provide a valid ABN or leave it blank.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const cleanAbn = abn.trim() ? abn.replace(/\s/g, '') : null;
      const cleanEmail = email.trim() ? email.trim() : null;

      if (isEditing && contact) {
        const res = await contactApi.update(contact.id, {
          name: name.trim(),
          type,
          email: cleanEmail,
          abn: cleanAbn,
          paymentTermsDays: Number(paymentTermsDays),
          requiresInvoiceForPayment,
          isActive,
        });
        onSaved(res.contact);
      } else {
        const res = await contactApi.create({
          name: name.trim(),
          type,
          email: cleanEmail,
          abn: cleanAbn,
          paymentTermsDays: Number(paymentTermsDays),
          requiresInvoiceForPayment,
        });
        onSaved(res.contact);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to save contact. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit Contact' : 'New Contact'}
      description={
        isEditing
          ? 'Update contact details, payment terms, or status.'
          : 'Add a new customer or vendor to your organization directory.'
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 mt-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <Input
          label="Contact Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Supplies Pty Ltd"
          required
        />

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-700">
            Contact Type
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['CUSTOMER', 'VENDOR', 'BOTH'] as const).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setType(t)}
                className={`py-2 text-xs font-medium rounded-lg border transition-colors ${
                  type === t
                    ? 'border-forest-900 bg-forest-50 text-forest-950'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t === 'CUSTOMER'
                  ? 'Customer'
                  : t === 'VENDOR'
                  ? 'Vendor'
                  : 'Both'}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Email Address (Optional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="accounts@example.com.au"
        />

        <Input
          label="Australian Business Number (ABN, Optional)"
          value={abn}
          onChange={(e) => setAbn(e.target.value)}
          placeholder="e.g. 51 824 753 556"
          error={abnError ?? undefined}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Payment Terms (Days)"
            type="number"
            min={0}
            max={365}
            value={paymentTermsDays}
            onChange={(e) => setPaymentTermsDays(Number(e.target.value))}
            placeholder="30"
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700">
              Invoice Policy
            </label>
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requiresInvoiceForPayment}
                onChange={(e) => setRequiresInvoiceForPayment(e.target.checked)}
                className="w-4 h-4 rounded text-forest-900 focus:ring-forest-900 border-slate-300"
              />
              <span className="text-xs text-slate-600 font-light">
                Require invoice before recording payment
              </span>
            </label>
          </div>
        </div>

        {isEditing && (
          <div className="pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded text-forest-900 focus:ring-forest-900 border-slate-300"
              />
              <span className="text-xs font-medium text-slate-700">
                Contact is active
              </span>
            </label>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={loading || Boolean(abnError)}>
            {loading ? 'Saving…' : isEditing ? 'Update Contact' : 'Create Contact'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

