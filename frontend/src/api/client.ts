/**
 * Typed API client for the Fastify backend.
 *
 * All requests are sent with credentials: 'include' so the HttpOnly session
 * cookie is automatically attached. The Vite dev proxy forwards /api/* to
 * http://localhost:8080.
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

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthResponse {
  status: 'authenticated' | 'onboarding';
  organizationId?: string;
  role?: string;
  user?: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string;
  };
  organization?: {
    id: string;
    name: string;
    abn: string;
  };
}

export const authApi = {
  me: () => request<AuthResponse>('GET', '/auth/me'),

  loginWithGoogle: (idToken: string) =>
    request<AuthResponse>('POST', '/auth/google', { idToken }),

  logout: () => request<{ status: string }>('DELETE', '/auth/logout'),
};

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export interface Organization {
  id: string;
  name: string;
  abn: string;
  createdAt: string;
}

export const orgApi = {
  create: (data: { name: string; abn: string }) =>
    request<{ organization: Organization; role: string }>('POST', '/organizations', data),
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
  email: string | null;
  abn: string | null;
  paymentTermsDays: number;
  requiresInvoiceForPayment: boolean;
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
  list: (params?: { type?: ContactType; search?: string; isActive?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.search) query.set('search', params.search);
    if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
    const qs = query.toString();
    return request<{ contacts: Contact[] }>('GET', `/contacts${qs ? `?${qs}` : ''}`);
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

export type BillStatus = 'AWAITING_PAYMENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
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
  list: (params?: { status?: BillStatus; contactId?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.contactId) query.set('contactId', params.contactId);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<{ bills: Bill[] }>('GET', `/bills${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => request<{ bill: Bill; journalEntry?: any }>('GET', `/bills/${id}`),

  create: (data: CreateBillInput) =>
    request<{ bill: Bill }>('POST', '/bills', data),
};

