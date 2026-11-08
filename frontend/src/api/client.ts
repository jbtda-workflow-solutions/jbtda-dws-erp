/**
 * Typed API client for the Fastify backend.
 *
 * All requests are sent with credentials: 'include' so the HttpOnly session
 * cookie is automatically attached.
 */

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Enterprise 7-Tier Roles & Organizations
// ---------------------------------------------------------------------------

export type Role =
  | 'ADMIN'
  | 'ACCOUNTANT'
  | 'MANAGER'
  | 'AR_SPECIALIST'
  | 'AP_SPECIALIST'
  | 'EMPLOYEE'
  | 'AUDITOR';

export interface Organization {
  id: string;
  name: string;
  legalName?: string | null;
  tradingName?: string | null;
  abn: string;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  apcaUserId?: string | null;
  defaultPaymentTermsDays?: number;
  fiscalYearStartMonth?: number;
  lockDate?: string | null;
  enforceTwoPersonApproval?: boolean;
  enabledModules?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MemberProfile {
  id: string;
  organizationId?: string;
  userId?: string;
  role: Role;
  jobTitle?: string | null;
  department?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  createdAt?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
  };
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  role: Role;
  jobTitle?: string | null;
  department?: string | null;
  organization: Organization;
}

export interface OrganizationInvite {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  department?: string | null;
  jobTitle?: string | null;
  invitedByUserId: string;
  acceptedAt?: string | null;
  expiresAt: string;
  createdAt: string;
  invitedBy?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadataJson: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthResponse {
  status: 'authenticated' | 'onboarding';
  organizationId?: string;
  role?: Role;
  user?: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
  };
  organization?: Organization;
  memberProfile?: MemberProfile;
  memberships?: OrganizationMembership[];
}

export const authApi = {
  me: () => request<AuthResponse>('GET', '/auth/me'),

  loginWithGoogle: (idToken: string) =>
    request<AuthResponse>('POST', '/auth/google', { idToken }),

  switchOrganization: (organizationId: string) =>
    request<{
      status: 'authenticated';
      organization: Organization;
      organizationId: string;
      role: Role;
    }>('POST', '/auth/switch-organization', { organizationId }),

  logout: () => request<{ status: string }>('DELETE', '/auth/logout'),
};

// ---------------------------------------------------------------------------
// Organization & Workspace Governance API
// ---------------------------------------------------------------------------

export interface CreateOrganizationInput {
  name: string;
  legalName?: string | null;
  tradingName?: string | null;
  abn: string;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
}

export interface UpdateOrganizationProfileInput {
  name?: string;
  legalName?: string | null;
  tradingName?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  apcaUserId?: string | null;
  defaultPaymentTermsDays?: number;
  fiscalYearStartMonth?: number;
  lockDate?: string | null;
  enforceTwoPersonApproval?: boolean;
  enabledModules?: string[];
}

export const orgApi = {
  create: (data: CreateOrganizationInput) =>
    request<{ organization: Organization; role: Role }>(
      'POST',
      '/organizations',
      data,
    ),

  listUserOrganizations: () =>
    request<{
      organizations: Array<{
        membershipId: string;
        organizationId: string;
        role: Role;
        jobTitle?: string | null;
        department?: string | null;
        organization: Organization;
        isActiveSession: boolean;
      }>;
    }>('GET', '/users/organizations'),

  getProfile: () =>
    request<{ organization: Organization; memberProfile: MemberProfile }>(
      'GET',
      '/organizations/profile',
    ),

  updateProfile: (data: UpdateOrganizationProfileInput) =>
    request<{ organization: Organization }>(
      'PATCH',
      '/organizations/profile',
      data,
    ),

  updateMyProfile: (data: {
    jobTitle?: string | null;
    department?: string | null;
    bankBsb?: string | null;
    bankAccountNumber?: string | null;
    bankAccountName?: string | null;
  }) =>
    request<{ memberProfile: MemberProfile }>(
      'PATCH',
      '/organizations/my-profile',
      data,
    ),

  listMembers: () =>
    request<{ members: MemberProfile[] }>('GET', '/organizations/members'),

  updateMember: (
    id: string,
    data: {
      role?: Role;
      jobTitle?: string | null;
      department?: string | null;
      bankBsb?: string | null;
      bankAccountNumber?: string | null;
      bankAccountName?: string | null;
    },
  ) =>
    request<{ member: MemberProfile }>(
      'PATCH',
      `/organizations/members/${id}`,
      data,
    ),

  removeMember: (id: string) =>
    request<{ deleted: boolean }>('DELETE', `/organizations/members/${id}`),

  listInvites: () =>
    request<{ invites: OrganizationInvite[] }>(
      'GET',
      '/organizations/invites',
    ),

  createInvite: (data: {
    email: string;
    role: Role;
    department?: string | null;
    jobTitle?: string | null;
  }) =>
    request<{
      status: 'added_immediately' | 'invite_created';
      member?: MemberProfile;
      invite?: OrganizationInvite;
    }>('POST', '/organizations/invites', data),

  revokeInvite: (id: string) =>
    request<{ revoked: boolean }>('DELETE', `/organizations/invites/${id}`),

  listAuditLogs: (params?: {
    entityType?: string;
    action?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.entityType) query.set('entityType', params.entityType);
    if (params?.action) query.set('action', params.action);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return request<{ logs: AuditLogEntry[]; totalCount: number }>(
      'GET',
      `/audit-logs${qs ? `?${qs}` : ''}`,
    );
  },
};

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export type ContactType = 'CUSTOMER' | 'VENDOR' | 'BOTH';

export interface Contact {
  id: string;
  organizationId: string;
  type: ContactType;
  name: string;
  legalName?: string | null;
  email: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  abn: string | null;
  paymentTermsDays: number;
  requiresInvoiceForPayment: boolean;
  defaultRevenueAccountId?: string | null;
  defaultExpenseAccountId?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContactInput {
  type: ContactType;
  name: string;
  email?: string | null;
  abn?: string | null;
  paymentTermsDays?: number;
  requiresInvoiceForPayment?: boolean;
}

export interface UpdateContactInput {
  type?: ContactType;
  name?: string;
  email?: string | null;
  abn?: string | null;
  paymentTermsDays?: number;
  requiresInvoiceForPayment?: boolean;
  isActive?: boolean;
}

export const contactApi = {
  list: (params?: {
    type?: ContactType;
    search?: string;
    isActive?: boolean;
  }) => {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.search) query.set('search', params.search);
    if (params?.isActive !== undefined)
      query.set('isActive', String(params.isActive));
    const qs = query.toString();
    return request<{ contacts: Contact[] }>(
      'GET',
      `/contacts${qs ? `?${qs}` : ''}`,
    );
  },

  get: (id: string) => request<{ contact: Contact }>('GET', `/contacts/${id}`),

  create: (data: CreateContactInput) =>
    request<{ contact: Contact }>('POST', '/contacts', data),

  update: (id: string, data: UpdateContactInput) =>
    request<{ contact: Contact }>('PATCH', `/contacts/${id}`, data),
};

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

export type BillStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'AWAITING_PAYMENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'VOID';
export type TaxTreatment = 'TAX_EXCLUSIVE' | 'TAX_INCLUSIVE' | 'GST_FREE';

export interface BillLineItem {
  id: string;
  billId: string;
  organizationId: string;
  description: string;
  amountCents: number;
  taxTreatment: TaxTreatment;
  gstCents: number;
  totalCents: number;
}

export interface PaymentOut {
  id: string;
  organizationId: string;
  billId: string;
  paymentDate: string;
  amountCents: number;
  reference: string | null;
  createdAt: string;
}

export interface Bill {
  id: string;
  organizationId: string;
  contactId: string;
  contact?: {
    id: string;
    name: string;
    email: string | null;
    abn: string | null;
  };
  reference: string | null;
  issueDate: string;
  dueDate: string;
  status: BillStatus;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  amountPaidCents: number;
  notes: string | null;
  lineItems?: BillLineItem[];
  paymentsOut?: PaymentOut[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateBillLineItemInput {
  description: string;
  amountCents: number;
  taxTreatment: TaxTreatment;
}

export interface CreateBillInput {
  contactId: string;
  reference?: string | null;
  issueDate: string;
  dueDate: string;
  notes?: string | null;
  lineItems: CreateBillLineItemInput[];
}

export const billApi = {
  list: (params?: {
    status?: BillStatus;
    contactId?: string;
    search?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.contactId) query.set('contactId', params.contactId);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<{ bills: Bill[] }>('GET', `/bills${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) =>
    request<{ bill: Bill; journalEntry?: any }>('GET', `/bills/${id}`),

  create: (data: CreateBillInput) =>
    request<{ bill: Bill }>('POST', '/bills', data),

  recordPayment: (
    billId: string,
    data: { paymentDate: string; amountCents: number; reference?: string | null },
  ) =>
    request<{ paymentOut: PaymentOut; bill: Bill; journalEntry?: any }>(
      'POST',
      `/bills/${billId}/payments`,
      data,
    ),

  listPayments: (billId: string) =>
    request<{ payments: PaymentOut[] }>('GET', `/bills/${billId}/payments`),
};

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type InvoiceStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'ISSUED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'VOID';

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  organizationId: string;
  description: string;
  amountCents: number;
  taxTreatment: TaxTreatment;
  gstCents: number;
  totalCents: number;
}

export interface Invoice {
  id: string;
  organizationId: string;
  contactId: string;
  contact?: {
    id: string;
    name: string;
    email: string | null;
    abn: string | null;
    paymentTermsDays: number;
  };
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  amountPaidCents: number;
  notes: string | null;
  lineItems?: InvoiceLineItem[];
  paymentsIn?: any[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvoiceLineItemInput {
  description: string;
  amountCents: number;
  taxTreatment: TaxTreatment;
}

export interface CreateInvoiceInput {
  contactId: string;
  invoiceNumber?: string;
  issueDate: string;
  dueDate: string;
  notes?: string | null;
  lineItems: CreateInvoiceLineItemInput[];
}

export const invoiceApi = {
  list: (params?: {
    status?: InvoiceStatus;
    contactId?: string;
    search?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.contactId) query.set('contactId', params.contactId);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<{ invoices: Invoice[] }>(
      'GET',
      `/invoices${qs ? `?${qs}` : ''}`,
    );
  },

  get: (id: string) =>
    request<{ invoice: Invoice; journalEntry?: any }>('GET', `/invoices/${id}`),

  create: (data: CreateInvoiceInput) =>
    request<{ invoice: Invoice }>('POST', '/invoices', data),

  issue: (id: string) =>
    request<{ invoice: Invoice; journalEntry?: any }>(
      'POST',
      `/invoices/${id}/issue`,
    ),

  recordPayment: (
    id: string,
    data: { paymentDate: string; amountCents: number; reference?: string | null },
  ) =>
    request<{ paymentIn: PaymentIn; invoice: Invoice; journalEntry: any }>(
      'POST',
      `/invoices/${id}/payments`,
      data,
    ),

  getPayments: (id: string) =>
    request<{ payments: PaymentIn[] }>('GET', `/invoices/${id}/payments`),
};

// ---------------------------------------------------------------------------
// Payments In
// ---------------------------------------------------------------------------

export interface PaymentIn {
  id: string;
  organizationId: string;
  invoiceId: string | null;
  contactId: string;
  paymentDate: string;
  amountCents: number;
  reference: string | null;
  createdAt: string;
}

export interface RecordPaymentInInput {
  contactId: string;
  invoiceId?: string | null;
  paymentDate: string;
  amountCents: number;
  reference?: string | null;
}

export const paymentInApi = {
  create: (data: RecordPaymentInInput) =>
    request<{ paymentIn: PaymentIn; invoice?: Invoice; journalEntry: any }>(
      'POST',
      '/payments-in',
      data,
    ),
};

// ---------------------------------------------------------------------------
// General Ledger
// ---------------------------------------------------------------------------

export type EntryType = 'DEBIT' | 'CREDIT';
export type NormalBalance = 'DEBIT' | 'CREDIT';
export type AccountType =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'EXPENSE';

export interface JournalLineAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
}

export interface JournalLine {
  id: string;
  journalEntryId: string;
  organizationId: string;
  accountId: string;
  entryType: EntryType;
  amountCents: number;
  account: JournalLineAccount;
}

export interface JournalEntry {
  id: string;
  organizationId: string;
  description: string;
  referenceType: string;
  referenceId: string;
  postedAt: string;
  lines: JournalLine[];
}

export interface LedgerTotals {
  totalDebitsCents: number;
  totalCreditsCents: number;
  isBalanced: boolean;
}

export interface AccountWithBalance {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  description: string | null;
  isSystem?: boolean;
  systemKey?: string | null;
  parentId?: string | null;
  isBankAccount?: boolean;
  defaultTaxTreatment?: TaxTreatment;
  isActive: boolean;
  debitsCents: number;
  creditsCents: number;
  netBalanceCents: number;
  lineCount: number;
}

export const ledgerApi = {
  list: (params?: {
    startDate?: string;
    endDate?: string;
    accountId?: string;
    referenceType?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.accountId) query.set('accountId', params.accountId);
    if (params?.referenceType) query.set('referenceType', params.referenceType);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return request<{
      entries: JournalEntry[];
      totalCount: number;
      totals: LedgerTotals;
    }>('GET', `/ledger${qs ? `?${qs}` : ''}`);
  },

  accounts: () =>
    request<{ accounts: AccountWithBalance[] }>('GET', '/ledger/accounts'),

  createManualEntry: (data: CreateManualJournalEntryInput) =>
    request<{ entry: JournalEntry }>('POST', '/ledger/entries', data),
};

// ---------------------------------------------------------------------------
// Chart of Accounts Workbench (Module 2)
// ---------------------------------------------------------------------------

export interface CreateAccountInput {
  code: string;
  name: string;
  type: AccountType;
  description?: string | null;
  parentId?: string | null;
  defaultTaxTreatment?: TaxTreatment;
  isBankAccount?: boolean;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
}

export interface UpdateAccountInput {
  code?: string;
  name?: string;
  description?: string | null;
  parentId?: string | null;
  defaultTaxTreatment?: TaxTreatment;
  isBankAccount?: boolean;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  isActive?: boolean;
}

export interface DecommissionAccountInput {
  targetAccountId: string;
  memo?: string;
}

export const accountsApi = {
  list: (params?: { type?: string; includeInactive?: boolean; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.type && params.type !== 'ALL') query.set('type', params.type);
    if (params?.includeInactive) query.set('includeInactive', 'true');
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<{ accounts: AccountWithBalance[] }>('GET', `/accounts${qs ? `?${qs}` : ''}`);
  },
  create: (data: CreateAccountInput) =>
    request<{ account: AccountWithBalance }>('POST', '/accounts', data),
  update: (id: string, data: UpdateAccountInput) =>
    request<{ account: AccountWithBalance }>('PATCH', `/accounts/${id}`, data),
  decommission: (id: string, data: DecommissionAccountInput) =>
    request<{ sweepJournalEntryId?: string; balanceSweptCents: number; account: AccountWithBalance }>(
      'POST',
      `/accounts/${id}/decommission`,
      data,
    ),
  seed: () =>
    request<{ ok: boolean; message: string }>('POST', '/accounts/seed'),
};

export interface CreateManualJournalLineInput {
  accountId: string;
  entryType: EntryType;
  amountCents: number;
}

export interface CreateManualJournalEntryInput {
  description: string;
  postedAt: string;
  lines: CreateManualJournalLineInput[];
}
