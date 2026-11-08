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
  itemId?: string | null;
  description: string;
  quantity?: number;
  unitPriceCents?: number;
  amountCents: number;
  taxTreatment: TaxTreatment;
  gstCents: number;
  totalCents: number;
  accountId?: string | null;
  trackingOptionId?: string | null;
}

export interface PaymentOut {
  id: string;
  organizationId: string;
  billId: string;
  paymentDate: string;
  amountCents: number;
  paymentMethod?: string;
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
    bsb?: string | null;
    bankAccountNumber?: string | null;
  };
  billNumber?: string;
  reference: string | null;
  issueDate: string;
  dueDate: string;
  status: BillStatus;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  amountPaidCents: number;
  notes: string | null;
  purchaseOrderId?: string | null;
  lineItems?: BillLineItem[];
  paymentsOut?: PaymentOut[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateBillLineItemInput {
  itemId?: string;
  description: string;
  quantity?: number;
  unitPriceCents?: number;
  amountCents?: number;
  taxTreatment: TaxTreatment;
  accountId?: string;
  trackingOptionId?: string;
}

export interface CreateBillInput {
  contactId: string;
  billNumber?: string;
  reference?: string | null;
  issueDate: string;
  dueDate: string;
  notes?: string | null;
  purchaseOrderId?: string;
  autoApprove?: boolean;
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

  update: (id: string, data: Partial<CreateBillInput>) =>
    request<{ bill: Bill }>('PATCH', `/bills/${id}`, data),

  delete: (id: string) =>
    request<{ message: string }>('DELETE', `/bills/${id}`),

  approve: (id: string) =>
    request<{ bill: Bill }>('POST', `/bills/${id}/approve`),

  void: (id: string) =>
    request<{ bill: Bill }>('POST', `/bills/${id}/void`),

  recordPayment: (
    billId: string,
    data: { paymentDate: string; amountCents: number; paymentMethod?: string; reference?: string | null },
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
  itemId?: string | null;
  description: string;
  quantity?: number;
  unitPriceCents?: number;
  amountCents: number;
  taxTreatment: TaxTreatment;
  gstCents: number;
  totalCents: number;
  accountId?: string | null;
  trackingOptionId?: string | null;
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
  reference?: string | null;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  amountPaidCents: number;
  notes: string | null;
  quoteId?: string | null;
  lineItems?: InvoiceLineItem[];
  paymentsIn?: any[];
  journalEntry?: any;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvoiceLineItemInput {
  itemId?: string;
  description: string;
  quantity?: number;
  unitPriceCents?: number;
  amountCents?: number;
  taxTreatment: TaxTreatment;
  accountId?: string;
  trackingOptionId?: string;
}

export interface CreateInvoiceInput {
  contactId: string;
  invoiceNumber?: string;
  reference?: string | null;
  issueDate: string;
  dueDate: string;
  notes?: string | null;
  quoteId?: string;
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

  update: (id: string, data: Partial<CreateInvoiceInput>) =>
    request<{ invoice: Invoice }>('PATCH', `/invoices/${id}`, data),

  delete: (id: string) =>
    request<{ message: string }>('DELETE', `/invoices/${id}`),

  issue: (id: string) =>
    request<{ invoice: Invoice; journalEntry?: any }>(
      'POST',
      `/invoices/${id}/issue`,
    ),

  void: (id: string) =>
    request<{ invoice: Invoice }>('POST', `/invoices/${id}/void`),

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
// Quotes & Estimates (Module 4)
// ---------------------------------------------------------------------------

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'INVOICED';

export interface QuoteLine {
  id: string;
  quoteId: string;
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxRatePercent: number;
  accountId?: string | null;
  trackingOptionId?: string | null;
}

export interface Quote {
  id: string;
  organizationId: string;
  contactId: string;
  contact?: Contact;
  quoteNumber: string;
  reference?: string | null;
  quoteDate: string;
  expiryDate?: string | null;
  status: QuoteStatus;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes?: string | null;
  terms?: string | null;
  lines: QuoteLine[];
  convertedInvoiceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuoteInput {
  contactId: string;
  quoteNumber?: string;
  reference?: string;
  quoteDate: string;
  expiryDate?: string;
  notes?: string;
  terms?: string;
  lines: Array<{
    itemId?: string;
    description: string;
    quantity?: number;
    unitPriceCents: number;
    taxRatePercent?: number;
    accountId?: string;
    trackingOptionId?: string;
  }>;
}

export const quoteApi = {
  list: (params?: { contactId?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.contactId) query.set('contactId', params.contactId);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    return request<{ quotes: Quote[] }>('GET', `/quotes${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => request<{ quote: Quote }>('GET', `/quotes/${id}`),

  create: (data: CreateQuoteInput) =>
    request<{ quote: Quote }>('POST', '/quotes', data),

  update: (id: string, data: Partial<CreateQuoteInput> & { status?: QuoteStatus }) =>
    request<{ quote: Quote }>('PATCH', `/quotes/${id}`, data),

  delete: (id: string) =>
    request<{ message: string }>('DELETE', `/quotes/${id}`),

  convertToInvoice: (id: string) =>
    request<{ message: string; invoice: Invoice }>('POST', `/quotes/${id}/convert-to-invoice`),
};

// ---------------------------------------------------------------------------
// Customer Credit Notes (Module 4)
// ---------------------------------------------------------------------------

export type CreditNoteStatus = 'DRAFT' | 'OPEN' | 'PARTIALLY_APPLIED' | 'APPLIED' | 'REFUNDED' | 'VOID';

export interface CreditNoteLine {
  id: string;
  creditNoteId: string;
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  accountId?: string | null;
  trackingOptionId?: string | null;
}

export interface CreditNote {
  id: string;
  organizationId: string;
  contactId: string;
  contact?: Contact;
  creditNoteNumber: string;
  reference?: string | null;
  creditNoteDate: string;
  status: CreditNoteStatus;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  remainingCents: number;
  notes?: string | null;
  lines: CreditNoteLine[];
  journalEntryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCreditNoteInput {
  contactId: string;
  creditNoteNumber: string;
  reference?: string;
  creditNoteDate: string;
  notes?: string;
  lines: Array<{
    itemId?: string;
    description: string;
    quantity?: number;
    unitPriceCents: number;
    taxRatePercent?: number;
    accountId?: string;
    trackingOptionId?: string;
  }>;
}

export const creditNoteApi = {
  list: (params?: { contactId?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.contactId) query.set('contactId', params.contactId);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    return request<{ creditNotes: CreditNote[] }>('GET', `/credit-notes${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => request<{ creditNote: CreditNote }>('GET', `/credit-notes/${id}`),

  create: (data: CreateCreditNoteInput) =>
    request<{ creditNote: CreditNote }>('POST', '/credit-notes', data),

  issue: (id: string) =>
    request<{ creditNote: CreditNote }>('POST', `/credit-notes/${id}/issue`),

  allocate: (id: string, data: { invoiceId: string; amountCents?: number }) =>
    request<{ message: string; creditNote: CreditNote; invoice: Invoice; allocatedCents: number }>(
      'POST',
      `/credit-notes/${id}/allocate`,
      data,
    ),

  refund: (id: string, data: { bankAccountId?: string; refundDate?: string }) =>
    request<{ message: string; creditNote: CreditNote; refundPayment: any }>(
      'POST',
      `/credit-notes/${id}/refund`,
      data,
    ),
};

// ---------------------------------------------------------------------------
// Purchase Orders (Module 5)
// ---------------------------------------------------------------------------

export type PurchaseOrderStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'BILLED' | 'REJECTED';

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxRatePercent: number;
  accountId?: string | null;
  trackingOptionId?: string | null;
}

export interface PurchaseOrder {
  id: string;
  organizationId: string;
  contactId: string;
  contact?: Contact;
  poNumber: string;
  reference?: string | null;
  orderDate: string;
  expectedDeliveryDate?: string | null;
  status: PurchaseOrderStatus;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes?: string | null;
  deliveryInstructions?: string | null;
  lines: PurchaseOrderLine[];
  convertedBillId?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePurchaseOrderInput {
  contactId: string;
  poNumber?: string;
  reference?: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  notes?: string;
  deliveryInstructions?: string;
  lines: Array<{
    itemId?: string;
    description: string;
    quantity?: number;
    unitPriceCents: number;
    taxRatePercent?: number;
    accountId?: string;
    trackingOptionId?: string;
  }>;
}

export const purchaseOrderApi = {
  list: (params?: { contactId?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.contactId) query.set('contactId', params.contactId);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    return request<{ purchaseOrders: PurchaseOrder[] }>('GET', `/purchase-orders${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => request<{ purchaseOrder: PurchaseOrder }>('GET', `/purchase-orders/${id}`),

  create: (data: CreatePurchaseOrderInput) =>
    request<{ purchaseOrder: PurchaseOrder }>('POST', '/purchase-orders', data),

  update: (id: string, data: Partial<CreatePurchaseOrderInput> & { status?: PurchaseOrderStatus }) =>
    request<{ purchaseOrder: PurchaseOrder }>('PATCH', `/purchase-orders/${id}`, data),

  delete: (id: string) =>
    request<{ message: string }>('DELETE', `/purchase-orders/${id}`),

  approve: (id: string) =>
    request<{ message: string; purchaseOrder: PurchaseOrder }>('POST', `/purchase-orders/${id}/approve`),

  reject: (id: string) =>
    request<{ message: string; purchaseOrder: PurchaseOrder }>('POST', `/purchase-orders/${id}/reject`),

  convertToBill: (id: string) =>
    request<{ message: string; bill: Bill }>('POST', `/purchase-orders/${id}/convert-to-bill`),
};

// ---------------------------------------------------------------------------
// Vendor Credits (Module 5)
// ---------------------------------------------------------------------------

export type VendorCreditStatus = 'DRAFT' | 'OPEN' | 'PARTIALLY_APPLIED' | 'APPLIED' | 'VOID';

export interface VendorCreditLine {
  id: string;
  vendorCreditId: string;
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  accountId?: string | null;
  trackingOptionId?: string | null;
}

export interface VendorCredit {
  id: string;
  organizationId: string;
  contactId: string;
  contact?: Contact;
  creditNumber: string;
  reference?: string | null;
  creditDate: string;
  status: VendorCreditStatus;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  remainingCents: number;
  notes?: string | null;
  lines: VendorCreditLine[];
  journalEntryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVendorCreditInput {
  contactId: string;
  creditNumber: string;
  reference?: string;
  creditDate: string;
  notes?: string;
  lines: Array<{
    itemId?: string;
    description: string;
    quantity?: number;
    unitPriceCents: number;
    taxRatePercent?: number;
    accountId?: string;
    trackingOptionId?: string;
  }>;
}

export const vendorCreditApi = {
  list: (params?: { contactId?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.contactId) query.set('contactId', params.contactId);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    return request<{ credits: VendorCredit[] }>('GET', `/vendor-credits${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => request<{ credit: VendorCredit }>('GET', `/vendor-credits/${id}`),

  create: (data: CreateVendorCreditInput) =>
    request<{ vendorCredit: VendorCredit }>('POST', '/vendor-credits', data),

  issue: (id: string) =>
    request<{ vendorCredit: VendorCredit }>('POST', `/vendor-credits/${id}/issue`),

  allocate: (id: string, data: { billId: string; amountCents?: number }) =>
    request<{ message: string; vendorCredit: VendorCredit; bill: Bill; allocatedCents: number }>(
      'POST',
      `/vendor-credits/${id}/allocate`,
      data,
    ),
};

// ---------------------------------------------------------------------------
// Batch Payments & .ABA File Export (Module 5)
// ---------------------------------------------------------------------------

export interface BatchPayment {
  id: string;
  organizationId: string;
  batchNumber: string;
  paymentDate: string;
  totalAmountCents: number;
  status: string;
  abaFileContent?: string | null;
  payments?: PaymentOut[];
  createdAt: string;
  updatedAt: string;
}

export const batchPaymentApi = {
  list: () => request<{ batchPayments: BatchPayment[] }>('GET', '/batch-payments'),

  get: (id: string) => request<{ batchPayment: BatchPayment }>('GET', `/batch-payments/${id}`),

  create: (data: {
    paymentDate: string;
    bankAccountId?: string;
    description?: string;
    billPayments?: Array<{ billId: string; amountCents?: number }>;
    expenseClaimPayments?: Array<{ expenseClaimId: string; amountCents?: number }>;
  }) =>
    request<{ message: string; batchPayment: BatchPayment; paymentsCount: number }>(
      'POST',
      '/batch-payments',
      data,
    ),

  downloadAbaUrl: (id: string) => `${BASE}/batch-payments/${id}/aba`,
};

// ---------------------------------------------------------------------------
// Recurring Invoices & Bills Schedules
// ---------------------------------------------------------------------------

export interface RecurringScheduleModel {
  id: string;
  organizationId: string;
  scheduleType: 'INVOICE' | 'BILL' | 'JOURNAL';
  name: string;
  contactId: string;
  contact?: Contact;
  frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ANNUALLY';
  startDate: string;
  endDate?: string | null;
  nextRunDate: string;
  autoPost: boolean;
  isActive: boolean;
  templateData: any;
  createdAt: string;
  updatedAt: string;
}

export const recurringInvoiceApi = {
  list: () => request<{ recurringInvoices: RecurringScheduleModel[] }>('GET', '/recurring-invoices'),
  create: (data: any) => request<{ recurringInvoice: RecurringScheduleModel }>('POST', '/recurring-invoices', data),
  update: (id: string, data: any) => request<{ recurringInvoice: RecurringScheduleModel }>('PATCH', `/recurring-invoices/${id}`, data),
  delete: (id: string) => request<{ message: string }>('DELETE', `/recurring-invoices/${id}`),
  run: (id: string) => request<{ message: string; invoice: Invoice }>('POST', `/recurring-invoices/${id}/run`),
};

export const recurringBillApi = {
  list: () => request<{ recurringBills: RecurringScheduleModel[] }>('GET', '/recurring-bills'),
  create: (data: any) => request<{ recurringBill: RecurringScheduleModel }>('POST', '/recurring-bills', data),
  update: (id: string, data: any) => request<{ recurringBill: RecurringScheduleModel }>('PATCH', `/recurring-bills/${id}`, data),
  delete: (id: string) => request<{ message: string }>('DELETE', `/recurring-bills/${id}`),
  run: (id: string) => request<{ message: string; bill: Bill }>('POST', `/recurring-bills/${id}/run`),
};

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

export type Account = AccountWithBalance;

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

export const accountApi = accountsApi;

// ---------------------------------------------------------------------------
// Module 6: Direct Transactions (Spend Money / Receive Money)
// ---------------------------------------------------------------------------

export type DirectTransactionType = 'SPEND_MONEY' | 'RECEIVE_MONEY';

export interface DirectTransactionLine {
  id: string;
  directTransactionId: string;
  description: string;
  accountId: string;
  account?: Account;
  taxTreatment: TaxTreatment;
  amountCents: number;
  taxAmountCents: number;
  trackingCategoryOptionId?: string | null;
  trackingCategoryOption?: TrackingOption | null;
  createdAt?: string;
}

export interface DirectTransaction {
  id: string;
  organizationId: string;
  type: DirectTransactionType;
  transactionNumber: string;
  transactionDate: string;
  bankAccountId: string;
  bankAccount?: Account;
  contactId?: string | null;
  contact?: Contact | null;
  reference?: string | null;
  description?: string | null;
  subtotalCents: number;
  taxTotalCents: number;
  totalAmountCents: number;
  journalEntryId?: string | null;
  journalEntry?: JournalEntry | null;
  lines: DirectTransactionLine[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDirectTransactionLineInput {
  description: string;
  accountId: string;
  taxTreatment?: TaxTreatment;
  amountCents: number;
  trackingOptionId?: string | null;
  trackingCategoryOptionId?: string | null;
}

export interface CreateDirectTransactionInput {
  type?: DirectTransactionType;
  transactionDate: string;
  bankAccountId: string;
  contactId?: string | null;
  reference?: string | null;
  description?: string | null;
  lines: CreateDirectTransactionLineInput[];
}

export const directTransactionApi = {
  list: (params?: {
    type?: DirectTransactionType;
    bankAccountId?: string;
    contactId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.bankAccountId) query.set('bankAccountId', params.bankAccountId);
    if (params?.contactId) query.set('contactId', params.contactId);
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<{ directTransactions: DirectTransaction[] }>(
      'GET',
      `/direct-transactions${qs ? `?${qs}` : ''}`,
    );
  },

  get: (id: string) =>
    request<{ directTransaction: DirectTransaction }>('GET', `/direct-transactions/${id}`),

  create: (data: CreateDirectTransactionInput) =>
    request<{
      message: string;
      directTransaction: DirectTransaction;
      journalEntryId: string;
    }>('POST', '/direct-transactions', data),
};

// ---------------------------------------------------------------------------
// Module 6: Employee Expense Claims & Reimbursements
// ---------------------------------------------------------------------------

export type ExpenseClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID';

export interface ExpenseClaimItem {
  id: string;
  expenseClaimId: string;
  expenseDate: string;
  merchant?: string | null;
  description: string;
  accountId: string;
  account?: Account;
  taxTreatment: TaxTreatment;
  amountCents: number;
  taxAmountCents: number;
  receiptUrl?: string | null;
  trackingCategoryOptionId?: string | null;
  trackingCategoryOption?: TrackingOption | null;
  createdAt?: string;
}

export interface ExpenseClaim {
  id: string;
  organizationId: string;
  claimNumber: string;
  memberId: string;
  member?: MemberProfile;
  title: string;
  description?: string | null;
  status: ExpenseClaimStatus;
  totalAmountCents: number;
  taxTotalCents: number;
  submittedAt?: string | null;
  approvedAt?: string | null;
  approvedById?: string | null;
  approvedBy?: MemberProfile | null;
  rejectedAt?: string | null;
  rejectedById?: string | null;
  rejectedBy?: MemberProfile | null;
  rejectionReason?: string | null;
  paidAt?: string | null;
  journalEntryId?: string | null;
  journalEntry?: JournalEntry | null;
  paymentJournalEntryId?: string | null;
  paymentJournalEntry?: JournalEntry | null;
  batchPaymentId?: string | null;
  batchPayment?: BatchPayment | null;
  items: ExpenseClaimItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpenseClaimItemInput {
  expenseDate: string;
  merchant: string;
  description: string;
  accountId?: string;
  taxTreatment?: TaxTreatment;
  amountCents: number;
  receiptUrl?: string | null;
  trackingOptionId?: string | null;
  trackingCategoryOptionId?: string | null;
}

export interface CreateExpenseClaimInput {
  title: string;
  notes?: string | null;
  description?: string | null;
  submitNow?: boolean;
  items: CreateExpenseClaimItemInput[];
}

export interface UpdateExpenseClaimInput {
  title?: string;
  notes?: string | null;
  description?: string | null;
  submitNow?: boolean;
  items?: Array<CreateExpenseClaimItemInput & { id?: string }>;
}

export const expenseClaimApi = {
  list: (params?: {
    status?: ExpenseClaimStatus | 'ALL';
    memberId?: string;
    scope?: 'my' | 'team' | 'all';
    search?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'ALL') query.set('status', params.status);
    if (params?.memberId) query.set('memberId', params.memberId);
    if (params?.scope) query.set('scope', params.scope);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<{ expenseClaims: ExpenseClaim[] }>(
      'GET',
      `/expense-claims${qs ? `?${qs}` : ''}`,
    );
  },

  get: (id: string) =>
    request<{ expenseClaim: ExpenseClaim }>('GET', `/expense-claims/${id}`),

  create: (data: CreateExpenseClaimInput) =>
    request<{ message: string; expenseClaim: ExpenseClaim }>('POST', '/expense-claims', data),

  update: (id: string, data: UpdateExpenseClaimInput) =>
    request<{ message: string; expenseClaim: ExpenseClaim }>(
      'PATCH',
      `/expense-claims/${id}`,
      data,
    ),

  delete: (id: string) =>
    request<{ message: string; deletedId: string }>('DELETE', `/expense-claims/${id}`),

  submit: (id: string) =>
    request<{ message: string; expenseClaim: ExpenseClaim }>(
      'POST',
      `/expense-claims/${id}/submit`,
    ),

  approve: (id: string) =>
    request<{
      message: string;
      expenseClaim: ExpenseClaim;
      journalEntryId: string;
    }>('POST', `/expense-claims/${id}/approve`),

  reject: (id: string, rejectionReason: string) =>
    request<{ message: string; expenseClaim: ExpenseClaim }>(
      'POST',
      `/expense-claims/${id}/reject`,
      { rejectionReason },
    ),

  pay: (
    id: string,
    data?: { bankAccountId?: string; paymentDate?: string; reference?: string },
  ) =>
    request<{
      message: string;
      expenseClaim: ExpenseClaim;
      journalEntryId: string;
    }>('POST', `/expense-claims/${id}/pay`, data || {}),
};

// ---------------------------------------------------------------------------
// Module 7 Banking, Transfers & Reconciliation Types & APIs
// ---------------------------------------------------------------------------

export interface BankAccountSummary {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  normalBalance: 'DEBIT' | 'CREDIT';
  description?: string | null;
  isBankAccount: boolean;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  apcaUserId?: string | null;
  ledgerBalanceCents: number;
  reconciledBalanceCents: number;
  unreconciledDifferenceCents: number;
  statementLineCount: number;
  unreconciledLineCount: number;
  lastReconciledAt?: string | null;
}

export interface BankTransfer {
  id: string;
  organizationId: string;
  fromAccountId: string;
  toAccountId: string;
  transferDate: string;
  amountCents: number;
  reference?: string | null;
  description?: string | null;
  createdByUserId?: string | null;
  createdAt: string;
  fromAccount?: { id: string; code: string; name: string; type: string } | null;
  toAccount?: { id: string; code: string; name: string; type: string } | null;
  journalEntry?: { id: string; entryNumber?: string | null; status: string; isReconciled: boolean } | null;
}

export interface BankStatementLine {
  id: string;
  organizationId: string;
  bankAccountId: string;
  statementDate: string;
  description: string;
  reference?: string | null;
  amountCents: number;
  isReconciled: boolean;
  matchedJournalId?: string | null;
  reconciledAt?: string | null;
  reconciledByUserId?: string | null;
  createdAt: string;
  matchedJournal?: {
    id: string;
    entryNumber?: string | null;
    description: string;
    referenceType: string;
  } | null;
}

export interface ReconciliationCandidate {
  score: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
  journalLineId: string;
  journalEntry: {
    id: string;
    entryNumber?: string | null;
    description: string;
    referenceType: string;
    referenceId: string;
    postedAt: string;
    status: string;
  };
  amountCents: number;
  entryType: 'DEBIT' | 'CREDIT';
}

export interface ReconciliationSuggestionItem {
  statementLine: BankStatementLine;
  suggestedMatch: ReconciliationCandidate | null;
  otherCandidates: ReconciliationCandidate[];
}

export interface CreateBankTransferInput {
  fromAccountId: string;
  toAccountId: string;
  transferDate: string;
  amountCents: number;
  reference?: string | null;
  description?: string | null;
}

export interface ImportStatementInput {
  bankAccountId: string;
  csvContent?: string;
  lines?: Array<{
    statementDate: string;
    description: string;
    reference?: string | null;
    amountCents: number;
  }>;
}

export interface CreateAndReconcileInput {
  statementLineId: string;
  targetAccountId: string;
  description?: string;
  taxTreatment?: TaxTreatment;
  trackingOptionId?: string | null;
}

export const bankingApi = {
  listAccounts: () =>
    request<{
      accounts: BankAccountSummary[];
      totals: { totalLedgerCents: number; totalReconciledCents: number };
    }>('GET', '/banking/accounts'),

  updateAccount: (
    id: string,
    data: {
      isBankAccount?: boolean;
      bankBsb?: string | null;
      bankAccountNumber?: string | null;
      apcaUserId?: string | null;
    },
  ) => request<{ account: any }>('PATCH', `/banking/accounts/${id}`, data),

  listTransfers: () =>
    request<{ transfers: BankTransfer[] }>('GET', '/banking/transfers'),

  createTransfer: (data: CreateBankTransferInput) =>
    request<{ message: string; transfer: BankTransfer }>('POST', '/banking/transfers', data),

  importStatements: (data: ImportStatementInput) =>
    request<{ message: string; importedCount: number }>('POST', '/banking/statements/import', data),

  listStatements: (params?: {
    bankAccountId?: string;
    isReconciled?: boolean;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.bankAccountId) query.set('bankAccountId', params.bankAccountId);
    if (params?.isReconciled !== undefined) query.set('isReconciled', String(params.isReconciled));
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return request<{ totalCount: number; lines: BankStatementLine[] }>(
      'GET',
      `/banking/statements${qs ? `?${qs}` : ''}`,
    );
  },

  deleteStatementLine: (id: string) =>
    request<{ ok: boolean; message: string }>('DELETE', `/banking/statements/${id}`),

  getSuggestions: (params: { bankAccountId: string; statementLineId?: string }) => {
    const query = new URLSearchParams();
    query.set('bankAccountId', params.bankAccountId);
    if (params.statementLineId) query.set('statementLineId', params.statementLineId);
    return request<{
      suggestions: ReconciliationSuggestionItem[];
      unreconciledJournalEntries: Array<{
        id: string;
        entryNumber?: string | null;
        description: string;
        referenceType: string;
        postedAt: string;
        amountCents: number;
        entryType: 'DEBIT' | 'CREDIT';
      }>;
    }>('GET', `/banking/reconciliation/suggestions?${query.toString()}`);
  },

  match: (data: { statementLineId: string; journalEntryId: string }) =>
    request<{ ok: boolean; message: string }>('POST', '/banking/reconciliation/match', data),

  unmatch: (data: { statementLineId: string }) =>
    request<{ ok: boolean; message: string }>('POST', '/banking/reconciliation/unmatch', data),

  createAndReconcile: (data: CreateAndReconcileInput) =>
    request<{
      message: string;
      journalEntry: any;
      statementLine: BankStatementLine;
    }>('POST', '/banking/reconciliation/create-and-reconcile', data),
};

// ---------------------------------------------------------------------------
// Module 8: Reports & Dashboard Types & API
// ---------------------------------------------------------------------------

export interface TrialBalanceAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: 'DEBIT' | 'CREDIT';
  debitsCents: number;
  creditsCents: number;
  netBalanceCents: number;
}

export interface TrialBalanceReport {
  asOfDate: string;
  totalDebitsCents: number;
  totalCreditsCents: number;
  isBalanced: boolean;
  differenceCents: number;
  accounts: TrialBalanceAccount[];
}

export interface PlRow {
  id: string;
  code: string;
  name: string;
  amountCents: number;
}

export interface ProfitAndLossReport {
  startDate: string;
  endDate: string;
  trackingOptionId: string | null;
  trackingOptionName: string | null;
  revenue: PlRow[];
  totalRevenueCents: number;
  costOfGoodsSold: PlRow[];
  totalCogsCents: number;
  grossProfitCents: number;
  operatingExpenses: PlRow[];
  totalOperatingExpenseCents: number;
  netOperatingProfitCents: number;
}

export interface BalanceSheetReport {
  asOfDate: string;
  assets: {
    currentAssets: PlRow[];
    totalCurrentAssetsCents: number;
    nonCurrentAssets: PlRow[];
    totalNonCurrentAssetsCents: number;
    totalAssetsCents: number;
  };
  liabilities: {
    currentLiabilities: PlRow[];
    totalCurrentLiabilitiesCents: number;
    nonCurrentLiabilities: PlRow[];
    totalNonCurrentLiabilitiesCents: number;
    totalLiabilitiesCents: number;
  };
  equity: {
    accounts: PlRow[];
    totalStaticEquityCents: number;
    currentYearEarningsCents: number;
    totalEquityCents: number;
  };
  totalAssetsCents: number;
  totalLiabilitiesAndEquityCents: number;
  isBalanced: boolean;
  discrepancyCents: number;
}

export interface AgedInvoiceItem {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  totalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  bucket: 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+';
}

export interface AgedArContact {
  contactId: string;
  contactName: string;
  contactEmail?: string | null;
  currentCents: number;
  days1to30Cents: number;
  days31to60Cents: number;
  days61to90Cents: number;
  days90PlusCents: number;
  totalCents: number;
  invoices: AgedInvoiceItem[];
}

export interface AgedReceivablesReport {
  asOfDate: string;
  totalOutstandingCents: number;
  totals: {
    currentCents: number;
    days1to30Cents: number;
    days31to60Cents: number;
    days61to90Cents: number;
    days90PlusCents: number;
  };
  contacts: AgedArContact[];
}

export interface AgedBillItem {
  id: string;
  reference?: string | null;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  totalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  bucket: 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+';
}

export interface AgedApContact {
  contactId: string;
  contactName: string;
  contactEmail?: string | null;
  currentCents: number;
  days1to30Cents: number;
  days31to60Cents: number;
  days61to90Cents: number;
  days90PlusCents: number;
  totalCents: number;
  bills: AgedBillItem[];
}

export interface AgedPayablesReport {
  asOfDate: string;
  totalOutstandingCents: number;
  totals: {
    currentCents: number;
    days1to30Cents: number;
    days31to60Cents: number;
    days61to90Cents: number;
    days90PlusCents: number;
  };
  contacts: AgedApContact[];
}

export interface BasReport {
  periodLabel: string;
  startDate: string;
  endDate: string;
  organization: {
    name: string;
    abn: string;
    lockDate: string | null;
  };
  isPeriodLocked: boolean;
  g1TotalSalesCents: number;
  g2G3GstFreeSalesCents: number;
  g10CapitalPurchasesCents: number;
  g11NonCapitalPurchasesCents: number;
  oneAGstCents: number;
  oneBGstCents: number;
  netGstCents: number;
  netGstType: 'PAYABLE' | 'REFUNDABLE';
  salesSummary: {
    invoicesCount: number;
    directIncomeCount: number;
  };
  purchasesSummary: {
    billsCount: number;
    directSpendCount: number;
    expenseClaimsCount: number;
  };
}

export interface DashboardSummary {
  organization: {
    id: string;
    name: string;
    lockDate: string | null;
  };
  cashPosition: {
    totalCashCents: number;
    accounts: Array<{
      id: string;
      code: string;
      name: string;
      balanceCents: number;
      bankBsb?: string | null;
      bankAccountNumber?: string | null;
    }>;
  };
  receivables: {
    totalOutstandingCents: number;
    overdueCents: number;
    openInvoicesCount: number;
    overdueInvoicesCount: number;
    aging: {
      currentCents: number;
      days1to30Cents: number;
      days31to60Cents: number;
      days61to90Cents: number;
      days90PlusCents: number;
    };
  };
  payables: {
    totalOutstandingCents: number;
    overdueCents: number;
    openBillsCount: number;
    overdueBillsCount: number;
    pendingReimbursementsCents: number;
    aging: {
      currentCents: number;
      days1to30Cents: number;
      days31to60Cents: number;
      days61to90Cents: number;
      days90PlusCents: number;
    };
  };
  approvalsQueue: {
    totalPending: number;
    pendingBillsCount: number;
    pendingPosCount: number;
    pendingClaimsCount: number;
    pendingJournalsCount: number;
  };
  performance: {
    mtdRevenueCents: number;
    mtdExpenseCents: number;
    mtdNetProfitCents: number;
    ytdRevenueCents: number;
    ytdExpenseCents: number;
    ytdNetProfitCents: number;
  };
  activeContactsCount: number;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    summary: string;
    actorName: string | null;
    actorEmail: string | null;
    createdAt: string;
  }>;
}

export const reportsApi = {
  getTrialBalance: (asOfDate?: string) => {
    const q = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : '';
    return request<TrialBalanceReport>('GET', `/reports/trial-balance${q}`);
  },

  getProfitAndLoss: (params?: {
    startDate?: string;
    endDate?: string;
    trackingOptionId?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.trackingOptionId) query.set('trackingOptionId', params.trackingOptionId);
    const qs = query.toString();
    return request<ProfitAndLossReport>('GET', `/reports/profit-and-loss${qs ? `?${qs}` : ''}`);
  },

  getBalanceSheet: (asOfDate?: string) => {
    const q = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : '';
    return request<BalanceSheetReport>('GET', `/reports/balance-sheet${q}`);
  },

  getAgedReceivables: (asOfDate?: string) => {
    const q = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : '';
    return request<AgedReceivablesReport>('GET', `/reports/aged-receivables${q}`);
  },

  getAgedPayables: (asOfDate?: string) => {
    const q = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : '';
    return request<AgedPayablesReport>('GET', `/reports/aged-payables${q}`);
  },

  getBas: (params?: {
    period?: 'MONTHLY' | 'QUARTERLY';
    year?: number;
    quarter?: number;
    month?: number;
    startDate?: string;
    endDate?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.period) query.set('period', params.period);
    if (params?.year) query.set('year', String(params.year));
    if (params?.quarter) query.set('quarter', String(params.quarter));
    if (params?.month) query.set('month', String(params.month));
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    const qs = query.toString();
    return request<BasReport>('GET', `/reports/bas${qs ? `?${qs}` : ''}`);
  },

  lockBasPeriod: (endDate: string) =>
    request<{ ok: boolean; message: string; lockDate: string | null }>(
      'POST',
      '/reports/bas/lock',
      { endDate },
    ),
};

export const dashboardApi = {
  getSummary: () => request<DashboardSummary>('GET', '/dashboard/summary'),
};



