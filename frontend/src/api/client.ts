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
  defaultRevenueAccount?: { id: string; code: string; name: string; type: string } | null;
  defaultExpenseAccount?: { id: string; code: string; name: string; type: string } | null;
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
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  abn?: string | null;
  paymentTermsDays?: number;
  requiresInvoiceForPayment?: boolean;
  defaultRevenueAccountId?: string | null;
  defaultExpenseAccountId?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
}

export interface UpdateContactInput {
  type?: ContactType;
  name?: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  abn?: string | null;
  paymentTermsDays?: number;
  requiresInvoiceForPayment?: boolean;
  defaultRevenueAccountId?: string | null;
  defaultExpenseAccountId?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  isActive?: boolean;
}

export interface ContactAgingBuckets {
  currentCents: number;
  days30Cents: number;
  days60Cents: number;
  days90PlusCents: number;
}

export interface ContactActivityItem {
  id: string;
  date: string;
  docType: 'INVOICE' | 'BILL' | 'PAYMENT_IN' | 'PAYMENT_OUT' | 'QUOTE';
  referenceNumber: string;
  amountCents: number;
  status?: string;
  details?: string;
}

export interface Contact360Response {
  contact: Contact;
  summary: {
    totalOutstandingArCents: number;
    totalOutstandingApCents: number;
    arAging: ContactAgingBuckets;
    apAging: ContactAgingBuckets;
  };
  activity: ContactActivityItem[];
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

  get360: (id: string) => request<Contact360Response>('GET', `/contacts/${id}/360`),

  create: (data: CreateContactInput) =>
    request<{ contact: Contact }>('POST', '/contacts', data),

  update: (id: string, data: UpdateContactInput) =>
    request<{ contact: Contact }>('PATCH', `/contacts/${id}`, data),
};

// ---------------------------------------------------------------------------
// Products & Services Catalog (Module 3)
// ---------------------------------------------------------------------------

export interface Item {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  isSold: boolean;
  saleDescription: string | null;
  saleUnitPriceCents: number;
  saleTaxTreatment: TaxTreatment;
  incomeAccountId: string | null;
  incomeAccount?: { id: string; code: string; name: string; type: string } | null;
  isPurchased: boolean;
  purchaseDescription: string | null;
  purchaseUnitPriceCents: number;
  purchaseTaxTreatment: TaxTreatment;
  expenseAccountId: string | null;
  expenseAccount?: { id: string; code: string; name: string; type: string } | null;
  isTrackedInventory: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemInput {
  code: string;
  name: string;
  isSold?: boolean;
  saleDescription?: string | null;
  saleUnitPriceCents?: number;
  saleTaxTreatment?: TaxTreatment;
  incomeAccountId?: string | null;
  isPurchased?: boolean;
  purchaseDescription?: string | null;
  purchaseUnitPriceCents?: number;
  purchaseTaxTreatment?: TaxTreatment;
  expenseAccountId?: string | null;
  isTrackedInventory?: boolean;
}

export interface UpdateItemInput {
  code?: string;
  name?: string;
  isSold?: boolean;
  saleDescription?: string | null;
  saleUnitPriceCents?: number;
  saleTaxTreatment?: TaxTreatment;
  incomeAccountId?: string | null;
  isPurchased?: boolean;
  purchaseDescription?: string | null;
  purchaseUnitPriceCents?: number;
  purchaseTaxTreatment?: TaxTreatment;
  expenseAccountId?: string | null;
  isTrackedInventory?: boolean;
  isActive?: boolean;
}

export const itemApi = {
  list: (params?: {
    type?: 'ALL' | 'SALES' | 'PURCHASE';
    search?: string;
    includeInactive?: boolean;
  }) => {
    const query = new URLSearchParams();
    if (params?.type && params.type !== 'ALL') query.set('type', params.type);
    if (params?.search) query.set('search', params.search);
    if (params?.includeInactive) query.set('includeInactive', 'true');
    const qs = query.toString();
    return request<{ items: Item[] }>('GET', `/items${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => request<{ item: Item }>('GET', `/items/${id}`),

  create: (data: CreateItemInput) =>
    request<{ item: Item }>('POST', '/items', data),

  update: (id: string, data: UpdateItemInput) =>
    request<{ item: Item }>('PATCH', `/items/${id}`, data),

  delete: (id: string) =>
    request<{ ok: boolean; message: string }>('DELETE', `/items/${id}`),
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

export type JournalStatus = 'POSTED' | 'PENDING_APPROVAL' | 'DRAFT' | 'REVERSED';

export interface TrackingOption {
  id: string;
  trackingCategoryId: string;
  name: string;
  code?: string | null;
  isActive: boolean;
}

export interface TrackingCategory {
  id: string;
  organizationId: string;
  name: string;
  isActive: boolean;
  options: TrackingOption[];
  createdAt: string;
  updatedAt: string;
}

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
  trackingOptionId?: string | null;
  description?: string | null;
  entryType: EntryType;
  amountCents: number;
  account: JournalLineAccount;
  trackingOption?: {
    id: string;
    name: string;
    trackingCategory?: { id: string; name: string };
  } | null;
}

export interface JournalEntry {
  id: string;
  organizationId: string;
  entryNumber?: string | null;
  description: string;
  referenceType: string;
  referenceId: string;
  status: JournalStatus;
  reversesEntryId?: string | null;
  reversedById?: string | null;
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
  postedAt: string;
  createdAt?: string;
  lines: JournalLine[];
}

export interface LedgerTotals {
  totalDebitsCents: number;
  totalCreditsCents: number;
  isBalanced: boolean;
}

export interface LedgerStatusCounts {
  POSTED: number;
  PENDING_APPROVAL: number;
  DRAFT: number;
  REVERSED: number;
  ALL: number;
}

export interface RecurringSchedule {
  id: string;
  organizationId: string;
  scheduleType: string;
  name: string;
  frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
  startDate: string;
  nextRunDate: string;
  lastRunDate?: string | null;
  autoPost: boolean;
  isActive: boolean;
  templatePayloadJson: string;
  template?: {
    description: string;
    lines: CreateManualJournalLineInput[];
  };
  createdAt: string;
  updatedAt: string;
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
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  defaultTaxTreatment?: TaxTreatment;
  isActive: boolean;
  debitsCents: number;
  creditsCents: number;
  netBalanceCents: number;
  lineCount: number;
}

export interface CreateManualJournalLineInput {
  accountId: string;
  trackingOptionId?: string | null;
  entryType: EntryType;
  amountCents: number;
  description?: string | null;
}

export interface CreateManualJournalEntryInput {
  description: string;
  postedAt?: string;
  status?: 'POSTED' | 'DRAFT' | 'PENDING_APPROVAL';
  lines: CreateManualJournalLineInput[];
}

export const ledgerApi = {
  list: (params?: {
    status?: string;
    startDate?: string;
    endDate?: string;
    accountId?: string;
    trackingOptionId?: string;
    referenceType?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'ALL') query.set('status', params.status);
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.accountId) query.set('accountId', params.accountId);
    if (params?.trackingOptionId) query.set('trackingOptionId', params.trackingOptionId);
    if (params?.referenceType && params.referenceType !== 'ALL') query.set('referenceType', params.referenceType);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return request<{
      entries: JournalEntry[];
      totalCount: number;
      statusCounts: LedgerStatusCounts;
      totals: LedgerTotals;
    }>('GET', `/ledger${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) =>
    request<{
      entry: JournalEntry;
      reversesEntry?: {
        id: string;
        entryNumber: string | null;
        description: string;
        postedAt: string;
        status: JournalStatus;
      } | null;
      reversedByEntry?: {
        id: string;
        entryNumber: string | null;
        description: string;
        postedAt: string;
        status: JournalStatus;
      } | null;
    }>('GET', `/ledger/${id}`),

  accounts: () =>
    request<{ accounts: AccountWithBalance[] }>('GET', '/ledger/accounts'),

  createManualEntry: (data: CreateManualJournalEntryInput) =>
    request<{ entry: JournalEntry }>('POST', '/ledger/entries', data),

  approve: (id: string) =>
    request<{ entry: JournalEntry }>('POST', `/ledger/${id}/approve`),

  reverse: (id: string, data?: { reversalDate?: string; reason?: string }) =>
    request<{ original: JournalEntry; reversal: JournalEntry }>(
      'POST',
      `/ledger/${id}/reverse`,
      data ?? {},
    ),

  deleteEntry: (id: string) =>
    request<{ ok: boolean; message: string }>('DELETE', `/ledger/${id}`),

  listRecurring: () =>
    request<{ schedules: RecurringSchedule[] }>('GET', '/ledger/recurring'),

  createRecurring: (data: {
    name: string;
    frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
    startDate: string;
    autoPost: boolean;
    template: {
      description: string;
      lines: CreateManualJournalLineInput[];
    };
  }) =>
    request<{ schedule: RecurringSchedule }>('POST', '/ledger/recurring', data),

  updateRecurring: (
    id: string,
    data: {
      name?: string;
      frequency?: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
      autoPost?: boolean;
      isActive?: boolean;
    },
  ) =>
    request<{ schedule: RecurringSchedule }>('PATCH', `/ledger/recurring/${id}`, data),

  deleteRecurring: (id: string) =>
    request<{ ok: boolean }>('DELETE', `/ledger/recurring/${id}`),

  runRecurring: (id: string) =>
    request<{ ok: boolean; message: string; entry: JournalEntry }>(
      'POST',
      `/ledger/recurring/${id}/run`,
    ),
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
  targetAccountId?: string | null;
  postedAt?: string;
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

  delete: (id: string) =>
    request<{ ok: boolean; message: string }>('DELETE', `/accounts/${id}`),

  decommission: (id: string, data: DecommissionAccountInput) =>
    request<{ sweepJournalId?: string | null; account: AccountWithBalance }>(
      'POST',
      `/accounts/${id}/decommission`,
      data,
    ),

  seed: () =>
    request<{ ok: boolean; message: string }>('POST', '/accounts/seed'),

  listTrackingCategories: () =>
    request<{ categories: TrackingCategory[] }>('GET', '/tracking-categories'),

  createTrackingCategory: (data: {
    name: string;
    options?: Array<{ name: string; code?: string | null }>;
  }) =>
    request<{ category: TrackingCategory }>('POST', '/tracking-categories', data),

  addTrackingOption: (
    categoryId: string,
    data: { name: string; code?: string | null },
  ) =>
    request<{ option: TrackingOption }>(
      'POST',
      `/tracking-categories/${categoryId}/options`,
      data,
    ),

  updateTrackingOption: (
    optionId: string,
    data: { name?: string; code?: string | null; isActive?: boolean },
  ) =>
    request<{ option: TrackingOption }>(
      'PATCH',
      `/tracking-options/${optionId}`,
      data,
    ),

  deleteTrackingCategory: (categoryId: string) =>
    request<{ ok: boolean; message: string }>(
      'DELETE',
      `/tracking-categories/${categoryId}`,
    ),
};
