// Thin client for the bfast-functions backend.

const BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://fitflex-faas.bfast.smartstock.co.tz';
/** The API server address (for feature modules that build their own requests, e.g. src/lib/shop-banners.ts). */
export const API_BASE = BASE;

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API ${status}`);
    this.status = status;
    this.body = body;
  }
}

let _onUnauthorized: (() => void) | null = null;
/** Tell the session a request came back 401 (for XHR uploads outside request()). */
export function notifyUnauthorized() { _onUnauthorized?.(); }

/** Register a callback invoked when any API call returns 401. */
export function setOnUnauthorized(cb: (() => void) | null) {
  _onUnauthorized = cb;
}

let _onPasswordChangeRequired: (() => void) | null = null;

/**
 * Register a callback invoked when any API call answers 403 password_change_required:
 * the session belongs to someone who must replace the start password an admin set.
 */
export function setOnPasswordChangeRequired(cb: (() => void) | null) {
  _onPasswordChangeRequired = cb;
}

/** Fewest characters the backend accepts for a portal password (POST /auth/portal/password). */
export const PORTAL_PASSWORD_MIN_LENGTH = 10;

/**
 * True when the session token carries `pwc: true` (must choose their own password first).
 * Reads the JWT payload only; the server still decides, and a token that cannot be read counts as false.
 */
export function tokenRequiresPasswordChange(token: string | null | undefined): boolean {
  if (!token) return false;
  const part = token.split('.')[1];
  if (!part) return false;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return payload?.pwc === true;
  } catch {
    return false;
  }
}

// Identity V2 (decision C3b): this build understands persons and personas.
// The backend ignores the header unless its V2 flags are on.
export const IDENTITY_V2_CLIENT = 'identity-v2';

type SessionResult = { token: string; user: { id: string; userType: string; gymId?: string; email?: string; portalUser?: boolean; aclPermissions?: string[]; organizationUser?: boolean; organizationRoles?: string[] } };

// The portal never registers anyone. It asks for an admin profile first (as it
// always has), then for an existing gym owner profile, then an existing gym
// staff profile. Only "no such profile" moves on to the next role; any other
// refusal (suspended, email not verified, …) is final.
const PORTAL_SIGN_IN_ROLES = [
  { requestedRole: 'admin' },
  { requestedRole: 'gym_operator', existingOnly: true },
  { requestedRole: 'gym_staff', existingOnly: true },
  // A business that sells on FitFlex, and its staff (vendor portal, S2). Never created here.
  { requestedRole: 'vendor', existingOnly: true },
  { requestedRole: 'vendor_staff', existingOnly: true },
];
/** Session user types that open the vendor area (/vendor). */
export const VENDOR_USER_TYPES = new Set(['vendor', 'vendor_staff']);
const NO_SUCH_PROFILE = new Set(['admin_self_registration_not_allowed', 'profile_not_found']);
/** Roles in a B2B organisation that see its billing (invoices, payments, statement). */
export const ORG_BILLING_ROLES = new Set(['owner', 'admin', 'finance']);
/** Roles that see the organisation's people (beneficiaries). Everyone sees its programmes. */
export const ORG_PEOPLE_ROLES = new Set(['owner', 'admin', 'manager', 'hr', 'analyst']);

/** How a person is named when adding them: the email or mobile number of their FitFlex account, or their user id. */
export type UserContact = { userId?: string; email?: string; phone?: string };
export function userContact(text: string): UserContact {
  const value = text.trim();
  if (value.includes('@')) return { email: value };
  if (/^usr_/i.test(value)) return { userId: value };
  return { phone: value };
}

/** A persona (User row) of the signed-in Person, as the backend returns it. */
export interface PersonaSummary {
  id: string;
  userType: string;
  displayName?: string | null;
  approvalStatus?: string;
  accountStatus?: string;
  onboardingCompleted?: boolean;
  portalOnly?: boolean;
}

export type InviteRole = 'member' | 'staff' | 'trainer';

/** An invitation as the organisation that sent it sees it (Identity V2 · I6). */
export interface GymInvitation {
  id: string;
  role: InviteRole;
  status: 'pending' | 'claimed' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  identifierType: 'phone' | 'email';
  identifierValue?: string;
  expiresAt: string;
  createdAt: string;
  plan?: { tier: string; durationUnit: 'D' | 'W' | 'M'; startDate: string; endDate: string };
  paidAmountTzs?: number | null;
  /** A paid invitation that expired unaccepted: re-issue it or record the refund. */
  needsResolution?: boolean;
}

export interface GymInvitationInput {
  role: InviteRole;
  phone?: string;
  email?: string;
  aclPermissions?: string[];
  durationUnit?: 'D' | 'W' | 'M';
  startDate?: string;
  endDate?: string;
  tier?: string;
  paidAmount?: number;
}

export async function request<T>(
  path: string,
  opts: RequestInit = {},
  token?: string,
  /** Return true when a 401 body is a business refusal, not a dead session (no sign-out). */
  isRefusal401?: (body: unknown) => boolean,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      'x-fitflex-client': IDENTITY_V2_CLIENT,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {})
    }
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && _onUnauthorized && !isRefusal401?.(body)) {
      _onUnauthorized();
    }
    if (res.status === 403 && (body as { error?: string } | null)?.error === 'password_change_required') {
      _onPasswordChangeRequired?.();
    }
    throw new ApiError(res.status, body);
  }
  return body as T;
}

/** "?a=1&b=2" from the set values of `params`, or "". */
export function qs(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Group routes of a company's HR, or of a B2B organisation's own users. */
const groupsBase = (orgId?: string) => (orgId ? `/b2b/organizations/${encodeURIComponent(orgId)}/groups` : '/corporate/groups');

/** A PIN is always exactly four digits. */
export const isPin = (pin: string) => /^[0-9]{4}$/.test(pin);

/** The sign-in password the app derives from a PIN; the portal must send the same. */
export const passwordForPin = (pin: string) => `fitflex-pin:${pin}`;


// ─── Moderation (admin, 'moderation' / 'moderation_decide' scopes) ───
export type ModerationEntityType = 'gym' | 'trainer' | 'vendor' | 'product';
export type ModerationStatus = 'pending' | 'approved' | 'rejected' | 'suspended' | 'hidden';
export type ModerationAction = 'approve' | 'reject' | 'suspend' | 'hide' | 'restore' | 'reopen' | 'require_review';
export type ModerationCounts = Record<ModerationStatus, number>;
export type ModerationRow = {
  entityType: ModerationEntityType; id: string; name: string; subtitle: string | null; status: string; tier?: string | null;
  moderationStatus: ModerationStatus; reason: string | null; decidedBy: string | null; decidedAt: string | null;
};
export type ModerationList = { items: ModerationRow[]; total: number; nextCursor: number | null; counts: ModerationCounts };
export type ModerationEvent = {
  id: string; entityType: ModerationEntityType; entityId: string; action: ModerationAction;
  fromStatus: ModerationStatus | null; toStatus: ModerationStatus; reason: string | null; actor: string; at: string;
};
export type ModerationDetail = {
  entityType: ModerationEntityType;
  summary: { id: string; name: string; subtitle: string | null; status: string; tier?: string | null };
  moderationStatus: ModerationStatus; reason: string | null; decidedBy: string | null; decidedAt: string | null;
  eligibility: { ok: boolean; reasons: string[] };
  history: ModerationEvent[];
  allowedActions: Array<{ action: ModerationAction; reasonRequired: boolean }>;
};
export type ModerationDecision = { entityType: ModerationEntityType; entityId: string; from: ModerationStatus; to: ModerationStatus; heldPromotions: number };


// ─── Promotions (admin: 'promotions', 'promotions_approve', 'campaigns' scopes) ───
export type PromotionType = 'featured' | 'promoted' | 'sponsored' | 'recommended' | 'campaign';
export type PromotionStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'active' | 'paused' | 'expired' | 'completed' | 'rejected' | 'cancelled';
export type PromotionPlacement = 'gym_discovery' | 'trainer_discovery' | 'vendor_discovery' | 'marketplace' | 'search_results' | 'home' | 'campaign_page';
export type GeoScope = { areaIds: string[]; radius?: { lat: number; lng: number; km: number } };
export type PromotionEntity = { id: string; name: string; subtitle: string | null; status: string };
export type Promotion = {
  id: string; entityType: ModerationEntityType; entityId: string; type: PromotionType; status: PromotionStatus; effectiveStatus: PromotionStatus;
  statusReason: string | null; campaignId: string | null; partnerRef: string | null; startsAt: string; endsAt: string; priority: number; boostWeight: number;
  geoScope: GeoScope; audience: Record<string, unknown>; categories: string[]; isCommercial: boolean; relationshipType: string | null;
  commercialRef: string | null; disclosureLabel: string | null; notes: string | null; createdBy: string; submittedBy: string | null; approvedBy: string | null;
  placements: PromotionPlacement[]; label: string | null; entity: PromotionEntity | null; createdAt: string; updatedAt: string;
};
export type PromotionList = { items: Promotion[]; total: number; nextCursor: number | null };
export type CapacityRow = { placement: PromotionPlacement; type: PromotionType; max: number; used: number; available: number; full: boolean };
export type AuditEntry = { id: string; at: string; actor: string; action: string; target: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
export type PromotionDetail = {
  promotion: Promotion; eligibility: { ok: boolean; reasons: string[] }; capacity: CapacityRow[]; history: AuditEntry[]; allowedActions: string[];
};
export type PromotionPreview = {
  entity: PromotionEntity; eligibility: { ok: boolean; reasons: string[] }; capacity: CapacityRow[]; canApprove: boolean;
  warnings: Array<{ code: string; reasons?: string[]; capacity?: CapacityRow[] }>;
};
export type PromotionInput = {
  entityType: ModerationEntityType; entityId: string; type: PromotionType; placements: PromotionPlacement[]; startsAt: string; endsAt: string;
  priority: number; boostWeight: number; geoScope: GeoScope; categories: string[]; campaignId?: string | null; partnerRef?: string | null;
  isCommercial: boolean; relationshipType?: string | null; commercialRef?: string | null; disclosureLabel?: string | null; notes?: string | null;
};
export type PromotionReference = {
  entityTypes: ModerationEntityType[];
  promotionTypes: Record<PromotionType, { label: string; disclosure: string; commercial: 'required' | 'forbidden' | 'either' }>;
  relationshipTypes: Record<string, string>;
  placements: Record<PromotionPlacement, { label: string; entityTypes: ModerationEntityType[] }>;
  defaultLimits: Record<PromotionType, number>; defaultMaxBoostFraction: number; maxPriority: number;
};
export type PromotionOverview = {
  active: number; scheduled: number; paused: number; drafts: number; pendingPromotionRequests: number; pendingModeration: number;
  moderation: ModerationCounts; expiringSoon: Array<{ id: string; entityType: ModerationEntityType; entityId: string; type: PromotionType; endsAt: string }>;
  recent: AuditEntry[];
};
export type PlacementLimit = {
  placement: PromotionPlacement; label: string; promotionType: PromotionType; entityTypes: ModerationEntityType[]; maxSlots: number;
  source: 'config' | 'default'; maxBoostFraction: number; rotationMode: 'none' | 'time_slice'; rotationWindowMinutes: number; used: number;
};
export type PromotionCampaign = {
  id: string; name: string; description: string | null; status: 'draft' | 'active' | 'ended' | 'cancelled'; statusReason: string | null;
  startsAt: string; endsAt: string; geoScope: GeoScope; createdBy: string; createdAt: string; updatedAt: string; promotionCount?: number;
};
export type PromotionMetrics = {
  impressions: number; searchAppearances: number; clicks: number; detailViews: number; saves: number; bookingClicks: number; subscriptionClicks: number;
  bookings: number; subscriptions: number; purchases: number; purchaseValueTzs: number; bookingValueTzs?: number; subscriptionValueTzs?: number; uniqueViewers: number;
  clickThroughRate: number | null; viewRate: number | null; conversions: number; conversionRate: number | null;
};
export type PromotionAnalyticsRef = {
  id: string; type: PromotionType; status: PromotionStatus; entityType: ModerationEntityType; entityId: string; entityName: string | null;
  startsAt: string; endsAt: string; campaignId: string | null; isCommercial: boolean;
};
export type PromotionAnalyticsItem = PromotionMetrics & { promotion: PromotionAnalyticsRef };
export type PromotionAnalyticsRange = { from: string; to: string };
export type PromotionAnalytics = { range: PromotionAnalyticsRange; totals: PromotionMetrics; items: PromotionAnalyticsItem[]; notTracked: string[]; unverifiedEvents?: number };
export type PromotionAnalyticsFilters = { from?: string; to?: string; type?: PromotionType; entityType?: ModerationEntityType; campaignId?: string; placement?: PromotionPlacement };
export type PromotionFunnelStep = { step: 'impressions' | 'clicks' | 'detailViews' | 'actionClicks' | 'conversions'; count: number };
export type PromotionAnalyticsDetail = {
  promotion: PromotionAnalyticsRef; range: PromotionAnalyticsRange; totals: PromotionMetrics;
  daily: Array<{ day: string } & Partial<PromotionMetrics>>; byPlacement: Array<{ placement: PromotionPlacement } & PromotionMetrics>;
  funnel: PromotionFunnelStep[]; notTracked: string[]; unverifiedEvents?: number;
};
export type CampaignAnalytics = {
  campaign: { id: string; name: string; status: string; startsAt: string; endsAt: string }; range: PromotionAnalyticsRange;
  totals: PromotionMetrics; items: PromotionAnalyticsItem[]; notTracked: string[]; unverifiedEvents?: number;
};
export type GeoArea = { id: string; level: 'country' | 'region' | 'city' | 'district'; name: string; parentId: string | null; active?: boolean; /** Place name per language, when the backend sends it. */ names?: { en?: string | null; sw?: string | null } | null };
export type EntityMatch = {
  entityType: ModerationEntityType; id: string; name: string; subtitle: string | null; status: string; moderationStatus: ModerationStatus;
  promotable: boolean; reasons: string[]; placements: PromotionPlacement[];
};
export type PartnerMatch = { id: string; name: string; legalName: string; type: string; status: string };

export const api = {
  firebaseSession: (idToken: string, requestedRole: 'member' | 'trainer' | 'gym_owner' | 'gym_operator' | 'admin' = 'gym_operator') =>
    request<{ token: string; user: { id: string; userType: string; gymId?: string; email?: string; portalUser?: boolean; aclPermissions?: string[] } }>(
      '/auth/firebase/session', { method: 'POST', body: JSON.stringify({ idToken, requestedRole }) }
    ),
  portalSession: async (idToken: string): Promise<SessionResult> => {
    let refused: unknown;
    for (const role of PORTAL_SIGN_IN_ROLES) {
      try {
        return await request<SessionResult>('/auth/firebase/session', { method: 'POST', body: JSON.stringify({ idToken, ...role }) });
      } catch (err) {
        const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
        // A vendor staff profile the business owner turned off: say so, not the generic "suspended".
        if (role.requestedRole === 'vendor_staff' && code === 'account_suspended') {
          throw new ApiError((err as ApiError).status, { error: 'vendor_staff_inactive' });
        }
        // A business account that FitFlex suspended: say it is the business.
        if (role.requestedRole === 'vendor' && code === 'account_suspended') {
          throw new ApiError((err as ApiError).status, { error: 'vendor_account_suspended' });
        }
        if (!code || !NO_SUCH_PROFILE.has(code)) throw err;
        refused = err;
      }
    }
    // Not FitFlex staff and not a gym: someone who looks after billing for a B2B
    // organisation signs in with the account they already have. Nothing is
    // created, and an account with no such organisation is refused as before.
    try {
      const session = await request<SessionResult>('/auth/firebase/session', { method: 'POST', body: JSON.stringify({ idToken, requestedRole: 'member', existingOnly: true }) });
      const { organizations } = await request<{ organizations: Array<{ id: string; role: string }> }>('/b2b/me/organizations', {}, session.token);
      // Any role in an organisation opens its area; what each role sees is decided there and on the server.
      if (organizations.length) return { token: session.token, user: { ...session.user, organizationUser: true, organizationRoles: [...new Set(organizations.map(o => o.role))] } };
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
      if (code && !NO_SUCH_PROFILE.has(code)) throw err;
    }
    throw refused;
  },
  // ─── Identity V2 · I7a: number or email + PIN (404 while V2_PIN_LOGIN is off) ───
  authOptions: () => request<{ pinLogin?: boolean }>('/auth/options'),
  /** A wrong PIN is a 401 refusal, not a dead session: never signs anyone out. */
  pinLogin: (body: { phone?: string; email?: string; pin: string }) =>
    request<PinLoginResult>('/auth/pin/login', { method: 'POST', body: JSON.stringify(body) }, undefined, () => true),

  /** The B2B organisations this session's person belongs to, with their role in each. */
  myOrganizations: (token: string) =>
    request<{ organizations: Array<{ id: string; role: string }> }>('/b2b/me/organizations', {}, token, () => true),

  /** Product categories with English and Swahili names (public). */
  shopCategories: () => request<{ categories: Array<{ key: string; en: string; sw: string }> }>('/shop/categories'),

  // ─── Vendor portal (S2): the signed-in vendor or vendor staff ───
  vendorMe: (token: string) => request<VendorMe>('/vendor/me', {}, token),
  vendorProducts: (token: string) => request<VendorProduct[]>('/vendor/products', {}, token),
  vendorLowStock: (token: string) => request<LowStockRow[]>('/vendor/stock/low', {}, token),
  vendorAdjustStock: (token: string, productId: string, body: StockAdjustmentInput) =>
    request<{ movement: StockMovement; product: ProductStock }>(`/vendor/products/${encodeURIComponent(productId)}/stock-adjustments`, { method: 'POST', body: JSON.stringify(body) }, token),
  vendorStockMovements: (token: string, productId: string, query: { from?: string; to?: string; variant?: string; limit?: number; cursor?: string }) =>
    request<StockMovementPage>(`/vendor/products/${encodeURIComponent(productId)}/stock-movements${qs(query)}`, {}, token),
  /** Always paged: newest first, `limit` 1–200; `nextCursor` null on the last page. */
  vendorOrders: (token: string, page: { limit?: number; cursor?: string | null } = {}) =>
    request<{ orders: VendorOrder[]; nextCursor: string | null; counts?: unknown }>(`/vendor/orders${qs({ limit: page.limit ?? 50, cursor: page.cursor })}`, {}, token),
  vendorOrder: (token: string, id: string) => request<VendorOrder>(`/vendor/orders/${encodeURIComponent(id)}`, {}, token),
  vendorOrderStatus: (token: string, id: string, body: { status: string; reason?: string }) =>
    request<VendorOrder>(`/vendor/orders/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify(body) }, token),
  // Walk-in (counter) sales, S3: read, detail, void. Recording happens in the app (no POS in the portal).
  vendorSales: (token: string, query: VendorSalesQuery = {}) =>
    request<VendorSalePage>(`/vendor/sales${qs({ ...query, limit: query.limit ?? 50 })}`, {}, token),
  vendorSale: (token: string, id: string) => request<{ sale: VendorSale }>(`/vendor/sales/${encodeURIComponent(id)}`, {}, token),
  vendorVoidSale: (token: string, id: string, reason: string) =>
    request<{ sale: VendorSale }>(`/vendor/sales/${encodeURIComponent(id)}/void`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
  // ─── Vendor customers, pay-later balances, customer payments, aging (S4) ───
  vendorCustomers: (token: string, query: VendorCustomersQuery = {}) =>
    request<VendorCustomerPage>(`/vendor/customers${qs({ ...query, limit: query.limit ?? 50 })}`, {}, token),
  vendorCreateCustomer: (token: string, body: VendorCustomerInput & { clientRef?: string }) =>
    request<{ customer: VendorCustomer; phoneDuplicate: VendorPhoneDuplicate }>('/vendor/customers', { method: 'POST', body: JSON.stringify(body) }, token),
  vendorUpdateCustomer: (token: string, id: string, body: Partial<VendorCustomerInput> & { archived?: boolean; updatedAt?: string }) =>
    request<{ customer: VendorCustomer; phoneDuplicate: VendorPhoneDuplicate }>(`/vendor/customers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  vendorCustomer: (token: string, id: string) =>
    request<{ customer: VendorCustomerProfile }>(`/vendor/customers/${encodeURIComponent(id)}`, {}, token),
  vendorCustomerSales: (token: string, id: string, page: { limit?: number; cursor?: string | null } = {}) =>
    request<VendorSalePage>(`/vendor/customers/${encodeURIComponent(id)}/sales${qs({ limit: page.limit ?? 20, cursor: page.cursor })}`, {}, token),
  /** One walk-in sale of this customer (read-only; for staff with `customers` but not `sales`). */
  vendorCustomerSale: (token: string, id: string, saleId: string) =>
    request<{ sale: VendorSale }>(`/vendor/customers/${encodeURIComponent(id)}/sales/${encodeURIComponent(saleId)}`, {}, token),
  vendorCustomerOrders: (token: string, id: string, page: { limit?: number; cursor?: string | null } = {}) =>
    request<{ orders: VendorCustomerOrder[]; nextCursor: string | null }>(`/vendor/customers/${encodeURIComponent(id)}/orders${qs({ limit: page.limit ?? 20, cursor: page.cursor })}`, {}, token),
  vendorCustomerPayments: (token: string, id: string, page: { from?: string; limit?: number; cursor?: string | null } = {}) =>
    request<{ payments: VendorCustomerPayment[]; nextCursor: string | null }>(`/vendor/customers/${encodeURIComponent(id)}/payments${qs({ from: page.from, limit: page.limit ?? 20, cursor: page.cursor })}`, {}, token),
  vendorCustomerPayment: (token: string, id: string, paymentId: string) =>
    request<{ payment: VendorCustomerPayment }>(`/vendor/customers/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`, {}, token),
  vendorRecordCustomerPayment: (token: string, id: string, body: VendorCustomerPaymentInput) =>
    request<{ payment: VendorCustomerPayment; customer: VendorCustomerMoney & { asOf: string } }>(`/vendor/customers/${encodeURIComponent(id)}/payments`, { method: 'POST', body: JSON.stringify(body) }, token),
  vendorVoidCustomerPayment: (token: string, id: string, paymentId: string, reason: string) =>
    request<{ payment: VendorCustomerPayment; customer: VendorCustomerMoney & { asOf: string } }>(
      `/vendor/customers/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/void`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
  vendorReceivablesAging: (token: string, query: { bucket?: AgingBucket | null; sort?: 'overdue' | 'owed' | 'name'; limit?: number; cursor?: string | null } = {}) =>
    request<VendorAgingPage>(`/vendor/receivables/aging${qs({ ...query, limit: query.limit ?? 50 })}`, {}, token),
  vendorPayments: (token: string) => request<VendorPayments>('/vendor/payments', {}, token),
  vendorStatements: (token: string) => request<VendorStatementList>('/vendor/statements', {}, token),
  vendorStatement: (token: string, id: string) =>
    request<{ statement: VendorStatement; lines: PartnerSettlementLine[] }>(`/vendor/statements/${encodeURIComponent(id)}`, {}, token),

  // ─── Identity V2 personas (404 while the backend flags are off) ───
  myPersonas: (token: string) =>
    request<{ personas: PersonaSummary[]; activePersonaId: string }>('/me/personas', {}, token),
  // Identity V2 · I6: invitations. Every route is 404 while the backend flag is off.
  myInvitations: (token: string) => request<{ invitations: unknown[] }>('/me/invitations', {}, token),
  gymLookupPerson: (token: string, gymId: string, contact: { phone?: string; email?: string }) =>
    request<{ found: boolean; maskedName: string | null }>(`/orgs/gym/${encodeURIComponent(gymId)}/people/lookup`, { method: 'POST', body: JSON.stringify(contact) }, token),
  /** `token` (the link) is returned once, and only for a newly created invitation. */
  gymCreateInvitation: (token: string, gymId: string, body: GymInvitationInput) =>
    request<{ created: boolean; invitation: GymInvitation; token?: string }>(`/orgs/gym/${encodeURIComponent(gymId)}/invitations`, { method: 'POST', body: JSON.stringify(body) }, token),
  gymInvitations: (token: string, gymId: string) =>
    request<{ invitations: GymInvitation[] }>(`/orgs/gym/${encodeURIComponent(gymId)}/invitations`, {}, token),
  gymInvitationAction: (token: string, gymId: string, invitationId: string, action: 'cancel' | 'resend' | 'reissue' | 'refunded') =>
    request<{ invitation: GymInvitation; token?: string }>(`/orgs/gym/${encodeURIComponent(gymId)}/invitations/${encodeURIComponent(invitationId)}/${action}`, { method: 'POST', body: '{}' }, token),
  switchPersona: (token: string, personaId: string) =>
    request<{ token: string; user: { id: string; userType: string; gymId?: string; email?: string; portalUser?: boolean; aclPermissions?: string[] }; personas: PersonaSummary[] }>(
      '/auth/switch-persona', { method: 'POST', body: JSON.stringify({ personaId }) }, token
    ),
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; userType: string; gymId?: string; portalUser?: boolean; aclPermissions?: string[] } }>(
      '/auth/login', { method: 'POST', body: JSON.stringify({ email, password, requestedRole: 'admin' }) }
    ),
  /** Replace the start password an admin set (sessions with `pwc: true`). Ends every earlier session on success. */
  changePortalPassword: (token: string, newPassword: string) =>
    request<SessionResult>('/auth/portal/password', { method: 'POST', body: JSON.stringify({ newPassword }) }, token),
  // ─── Portal user management (admin only) ───
  listPortalUsers: (token: string) => request<PortalUser[]>('/admin/portal-users', {}, token),
  createPortalUser: (token: string, data: { email: string; password: string; displayName?: string; aclPermissions: string[] }) =>
    request<PortalUser>('/admin/portal-users', { method: 'POST', body: JSON.stringify(data) }, token),
  updatePortalUser: (token: string, id: string, data: { aclPermissions?: string[]; accountStatus?: string; displayName?: string; portalUser?: boolean }) =>
    request<PortalUser>(`/admin/portal-users/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token),
  deletePortalUser: (token: string, id: string) =>
    request<{ ok: boolean }>(`/admin/portal-users/${id}`, { method: 'DELETE' }, token),
  dashboard: (token: string, filters?: { gymId?: string; periodStart?: string; periodEnd?: string; memberType?: 'all' | 'direct' | 'fitflex' }) => {
    const q = new URLSearchParams();
    if (filters?.gymId) q.set('gymId', filters.gymId);
    if (filters?.periodStart) q.set('periodStart', filters.periodStart);
    if (filters?.periodEnd) q.set('periodEnd', filters.periodEnd);
    if (filters?.memberType) q.set('memberType', filters.memberType);
    const s = q.toString();
    return request<DashboardResponse>(`/operator/dashboard${s ? '?' + s : ''}`, {}, token);
  },
  recentCheckIns: (token: string) => request<CheckIn[]>('/operator/checkins', {}, token),
  /** `gymId` is needed when the operator works at more than one gym (else `gym_required`). */
  checkIn: (token: string, qrToken: string, gymId?: string) =>
    // An expired member QR comes back as 401 { failure: 'invalid_or_expired_qr' };
    // that is the member's QR, not the operator's session, so stay signed in.
    request<CheckInResult>('/operator/checkins', { method: 'POST', body: JSON.stringify(gymId ? { qrToken, gymId } : { qrToken }) }, token,
      body => typeof (body as { failure?: unknown } | null)?.failure === 'string'),
  /** Slimmed list — no `images`/`thumbnails` arrays, only a single `thumbnail` field. */
  adminGyms: (token: string) => request<Gym[]>('/admin/gyms', {}, token),
  // ── Communications: a gym's messages to its direct members (scope 'owner')
  // and FitFlex-wide messages (scope 'admin'). Same shapes for both. ──
  commsOverview: (token: string, scope: CommsScope, gymId?: string) =>
    request<CommsOverview>(`/${scope}/communications/overview${gymId ? `?gymId=${encodeURIComponent(gymId)}` : ''}`, {}, token),
  /** FitFlex (admin) can ask for the trainer audiences with recipients 'trainers'. */
  commsSegments: (token: string, scope: CommsScope, recipients: CommsRecipients = 'members') =>
    request<CommsCatalog>(`/${scope}/communications/segments${recipients === 'trainers' ? '?recipients=trainers' : ''}`, {}, token),
  commsAudiencePreview: (token: string, scope: CommsScope, body: { gymId?: string; recipients?: CommsRecipients; preset?: string | null; filter?: unknown; purpose?: string }) =>
    request<CommsAudiencePreview>(`/${scope}/communications/audience/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** Campaign history. Filters: gymId, status, purpose, channel, from, to, search; cursor paging. */
  commsCampaigns: (token: string, scope: CommsScope, opts: Record<string, string | undefined> = {}) =>
    request<{ campaigns: CommsCampaign[]; nextCursor: string | null }>(`/${scope}/communications/campaigns${qs(opts)}`, {}, token),
  commsCampaign: (token: string, scope: CommsScope, id: string) =>
    request<{ campaign: CommsCampaign; progress: Record<string, Record<string, number>>; stats: CommsStats | null }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}`, {}, token),
  // History (M8): the message log, one message, a campaign's recipients, a member's timeline, counts.
  commsMessages: (token: string, scope: CommsScope, filters: CommsHistoryFilters = {}) =>
    request<{ messages: CommsMessage[]; nextCursor: string | null }>(`/${scope}/communications/messages${qs(filters)}`, {}, token),
  commsMessage: (token: string, scope: CommsScope, id: string) =>
    request<{ message: CommsMessage }>(`/${scope}/communications/messages/${encodeURIComponent(id)}`, {}, token),
  commsRecipients: (token: string, scope: CommsScope, campaignId: string, filters: CommsHistoryFilters = {}) =>
    request<{ recipients: CommsRecipient[]; nextCursor: string | null }>(`/${scope}/communications/campaigns/${encodeURIComponent(campaignId)}/recipients${qs(filters)}`, {}, token),
  commsMemberHistory: (token: string, scope: CommsScope, memberId: string, filters: CommsHistoryFilters = {}) =>
    request<{ memberId: string; items: CommsTimelineItem[]; nextCursor: string | null }>(`/${scope}/members/${encodeURIComponent(memberId)}/communications${qs(filters)}`, {}, token),
  commsSummary: (token: string, scope: CommsScope, filters: CommsHistoryFilters = {}) =>
    request<CommsStats & { byDay: Array<{ day: string; messages: number }> }>(`/${scope}/communications/summary${qs(filters)}`, {}, token),
  commsPreviewDraft: (token: string, scope: CommsScope, body: CommsDraft) =>
    request<CommsPreview>(`/${scope}/communications/campaigns/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsCreate: (token: string, scope: CommsScope, body: CommsDraft) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsUpdate: (token: string, scope: CommsScope, id: string, body: Partial<CommsDraft>) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  commsDelete: (token: string, scope: CommsScope, id: string) =>
    request<{ ok: boolean }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }, token),
  /** Any campaign copied into a new draft (same audience, message and channels). */
  commsDuplicate: (token: string, scope: CommsScope, id: string) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }, token),
  commsAction: (token: string, scope: CommsScope, id: string, action: 'cancel' | 'unschedule') =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/${action}`, { method: 'POST' }, token),
  commsSchedule: (token: string, scope: CommsScope, id: string, scheduledAt: string, confirmLargeSend = false) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/schedule`, {
      method: 'POST', body: JSON.stringify({ scheduledAt, ...(confirmLargeSend ? { confirmLargeSend: true } : {}) }),
    }, token),
  commsSend: (token: string, scope: CommsScope, id: string, sendRequestId: string, confirmLargeSend = false) =>
    request<{ campaign: CommsCampaign; replayed?: boolean }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/send`, {
      method: 'POST', body: JSON.stringify({ sendRequestId, ...(confirmLargeSend ? { confirmLargeSend: true } : {}) }),
    }, token),
  // Templates: FitFlex's (read-only) and, for gyms, their own.
  commsTemplates: (token: string, scope: CommsScope, opts: { gymId?: string; group?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.gymId) q.set('gymId', opts.gymId);
    if (opts.group) q.set('group', opts.group);
    const qs = q.toString();
    return request<{ templates: CommsTemplate[] }>(`/${scope}/communications/templates${qs ? `?${qs}` : ''}`, {}, token);
  },
  commsTemplate: (token: string, scope: CommsScope, id: string) =>
    request<{ template: CommsTemplate }>(`/${scope}/communications/templates/${encodeURIComponent(id)}`, {}, token),
  commsTemplatePreview: (token: string, scope: CommsScope, id: string, body: { gymId?: string; values?: CommsTemplateValues } = {}) =>
    request<CommsTemplatePreview>(`/${scope}/communications/templates/${encodeURIComponent(id)}/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsTemplatePreviewNew: (token: string, scope: CommsScope, body: CommsTemplateDraft & { values?: CommsTemplateValues }) =>
    request<CommsTemplatePreview>(`/${scope}/communications/templates/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsTemplateCreate: (token: string, body: CommsTemplateDraft) =>
    request<{ template: CommsTemplate }>('/owner/communications/templates', { method: 'POST', body: JSON.stringify(body) }, token),
  commsTemplateUpdate: (token: string, id: string, body: Partial<CommsTemplateDraft>) =>
    request<{ template: CommsTemplate }>(`/owner/communications/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  commsTemplateDuplicate: (token: string, id: string, opts: { gymId?: string; name?: string } = {}) =>
    request<{ template: CommsTemplate }>(`/owner/communications/templates/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: JSON.stringify(opts) }, token),
  // WhatsApp (FitFlex admins): provider status, kill switch, approved-template registry, test send.
  waStatus: (token: string) => request<WhatsAppStatus>('/admin/communications/whatsapp', {}, token),
  waSetEnabled: (token: string, enabled: boolean) =>
    request<WhatsAppStatus>('/admin/communications/whatsapp', { method: 'PUT', body: JSON.stringify({ enabled }) }, token),
  waRegistry: (token: string) => request<WhatsAppRegistry>('/admin/communications/whatsapp/templates', {}, token),
  waRegister: (token: string, body: { providerTemplateName: string; language: CommsLocale; category: WhatsAppCategory; variables: string[]; approvalStatus?: WhatsAppApproval }) =>
    request<{ template: WhatsAppRegistryRow }>('/admin/communications/whatsapp/templates', { method: 'POST', body: JSON.stringify(body) }, token),
  waUpdate: (token: string, id: string, body: { approvalStatus?: WhatsAppApproval; variables?: string[]; category?: WhatsAppCategory }) =>
    request<{ template: WhatsAppRegistryRow }>(`/admin/communications/whatsapp/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  waSync: (token: string) =>
    request<WhatsAppRegistry & { synced: number }>('/admin/communications/whatsapp/templates/sync', { method: 'POST' }, token),
  waTest: (token: string, body: { phone: string; templateName: string; language: CommsLocale; parameters: string[] }) =>
    request<{ ok: boolean; providerMessageId: string }>('/admin/communications/whatsapp/test', { method: 'POST', body: JSON.stringify(body) }, token),
  // Analytics: delivery, engagement and attributed revenue.
  commsAnalytics: (token: string, scope: CommsScope, opts: { days?: number; gymId?: string } = {}) =>
    request<CommsResults>(`/${scope}/communications/analytics${qs(opts)}`, {}, token),
  commsCampaignAnalytics: (token: string, scope: CommsScope, id: string) =>
    request<CommsResults>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/analytics`, {}, token),
  commsAutomationAnalytics: (token: string, id: string, days = 30) =>
    request<CommsResults>(`/owner/communications/automations/${encodeURIComponent(id)}/analytics${qs({ days })}`, {}, token),
  // Automations (gym owners): lifecycle messages that send themselves.
  commsAutomations: (token: string, gymId?: string) =>
    request<{ automations: CommsAutomation[] }>(`/owner/communications/automations${qs({ gymId })}`, {}, token),
  commsAutomationUpdate: (token: string, id: string, body: { status?: 'enabled' | 'disabled'; channels?: CommsChannel[]; templateId?: string }) =>
    request<{ automation: CommsAutomation }>(`/owner/communications/automations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  commsAutomationRuns: (token: string, id: string) =>
    request<{ runs: CommsAutomationRun[] }>(`/owner/communications/automations/${encodeURIComponent(id)}/runs`, {}, token),
  commsAutomationPreview: (token: string, id: string) =>
    request<CommsTemplatePreview>(`/owner/communications/automations/${encodeURIComponent(id)}/preview`, { method: 'POST' }, token),
  commsTemplateArchive: (token: string, id: string) =>
    request<{ ok: boolean }>(`/owner/communications/templates/${encodeURIComponent(id)}/archive`, { method: 'POST' }, token),

  // ── Challenges: FitFlex admin (scope 'admin') and company HR ('corporate') ──
  creatorChallenges: (token: string, scope: ChallengeApiScope) =>
    request<{ challenges: ManagedChallenge[] }>(`/${scope}/challenges`, {}, token),
  createChallenge: (token: string, scope: ChallengeApiScope, body: ChallengeInput) =>
    request<{ challenge: ManagedChallenge }>(`/${scope}/challenges`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateChallenge: (token: string, scope: ChallengeApiScope, id: string, body: Partial<ChallengeInput>) =>
    request<{ challenge: ManagedChallenge }>(`/${scope}/challenges/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  challengeAction: (token: string, scope: ChallengeApiScope, id: string, action: 'cancel' | 'close' | 'archive' | 'publish' | 'pause' | 'resume') =>
    request<{ challenge: ManagedChallenge }>(`/${scope}/challenges/${encodeURIComponent(id)}/${action}`, { method: 'POST' }, token),
  challengeParticipation: (token: string, scope: ChallengeApiScope, id: string) =>
    request<ChallengeParticipation>(`/${scope}/challenges/${encodeURIComponent(id)}/participants`, {}, token),
  challengeStandings: (token: string, scope: ChallengeApiScope, id: string) =>
    request<ChallengeStandings>(`/${scope}/challenges/${encodeURIComponent(id)}/leaderboard`, {}, token),
  // ─── Exercise library (admin, 'exercises' scope) ───
  adminExercises: (token: string) =>
    request<{ exercises: Exercise[]; options: ExerciseOptions }>('/admin/exercises', {}, token),
  createExercise: (token: string, body: ExerciseInput) =>
    request<{ exercise: Exercise }>('/admin/exercises', { method: 'POST', body: JSON.stringify(body) }, token),
  updateExercise: (token: string, id: string, body: Partial<ExerciseInput>) =>
    request<{ exercise: Exercise }>(`/admin/exercises/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  resetExercise: (token: string, id: string) =>
    request<{ exercise: Exercise }>(`/admin/exercises/${encodeURIComponent(id)}/reset`, { method: 'POST' }, token),
  exportExercises: (token: string) =>
    request<{ csv: string; count: number }>('/admin/exercises/export', {}, token),
  /** A preview unless `dryRun` is false; only then is anything saved. */
  importExercises: (token: string, csv: string, dryRun: boolean) =>
    request<ExerciseImportResult>('/admin/exercises/import', { method: 'POST', body: JSON.stringify({ csv, dryRun }) }, token),
  // ─── Gym settlements (admin; reads need 'payments', each step its own scope) ───
  settlementRuns: (token: string, mode?: SettlementMode) =>
    request<SettlementRun[]>(`/admin/settlements/runs${qs({ mode })}`, {}, token),
  settlementRun: (token: string, id: string) =>
    request<{ run: SettlementRun; statements: GymSettlement[] }>(`/admin/settlements/runs/${encodeURIComponent(id)}`, {}, token),
  runSettlement: (token: string, body: { month: string; mode: SettlementMode }) =>
    request<{ run: SettlementRun; alreadyRun?: boolean }>('/admin/settlements/runs', { method: 'POST', body: JSON.stringify(body) }, token),
  settlementStatements: (token: string, filters: { mode?: SettlementMode; status?: GymSettlementStatus; gymId?: string } = {}) =>
    request<GymSettlement[]>(`/admin/settlements/statements${qs(filters)}`, {}, token),
  settlementStatement: (token: string, id: string) =>
    request<GymSettlementDetail>(`/admin/settlements/statements/${encodeURIComponent(id)}`, {}, token),
  settlementStep: (token: string, id: string, step: SettlementStep, body: { reason?: string; paymentReference?: string; receiptUrl?: string } = {}) =>
    request<unknown>(`/admin/settlements/statements/${encodeURIComponent(id)}/${step}`, { method: 'POST', body: JSON.stringify(body) }, token),
  proposeSettlementAdjustment: (token: string, id: string, body: { amountTzs: number; type: 'correction' | 'clawback' | 'manual'; reason: string }) =>
    request<{ adjustment: SettlementAdjustment }>(`/admin/settlements/statements/${encodeURIComponent(id)}/adjustments`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** Differences from voided check-ins: waiting for a draft statement, about to be raised, or needing a person. Nothing is changed. */
  settlementClawbacks: (token: string) => request<SettlementClawbacks>('/admin/settlements/clawbacks', {}, token),
  decideSettlementAdjustment: (token: string, id: string, decision: 'apply' | 'reject', reason?: string) =>
    request<unknown>(`/admin/settlements/adjustments/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body: JSON.stringify({ reason }) }, token),

  // ─── Settlement configuration (admin, 'payments' scope) ───
  settlementConfig: (token: string) => request<SettlementConfig>('/admin/settlement-config', {}, token),
  draftPassTierVersion: (token: string, body: { tierKey: string; priceTzs: number; visitAllowance: number; reason?: string }) =>
    request<unknown>('/admin/settlement-config/pass-tiers', { method: 'POST', body: JSON.stringify(body) }, token),
  draftSettlementRule: (token: string, body: Partial<SettlementRuleValues> & { scopeType: SettlementRuleScope; scopeId?: string | null; name?: string; reason?: string }) =>
    request<unknown>('/admin/settlement-config/rules', { method: 'POST', body: JSON.stringify(body) }, token),
  draftGymRateCard: (token: string, body: { gymId: string; retailDailyTzs: number; retailWeeklyTzs: number; retailMonthlyTzs: number; reason?: string }) =>
    request<unknown>('/admin/settlement-config/rate-cards', { method: 'POST', body: JSON.stringify(body) }, token),
  draftMissingRateCards: (token: string) =>
    request<{ drafted: GymRateCard[]; skipped: Array<{ gymId: string; reason: string }> }>('/admin/settlement-config/rate-cards/draft-missing', { method: 'POST' }, token),
  activateSettlementConfig: (token: string, kind: SettlementConfigKind, id: string, effectiveFrom: string) =>
    request<unknown>(`/admin/settlement-config/${kind}/${encodeURIComponent(id)}/activate`, { method: 'POST', body: JSON.stringify({ effectiveFrom }) }, token),
  rejectSettlementConfig: (token: string, kind: SettlementConfigKind, id: string, reason: string) =>
    request<unknown>(`/admin/settlement-config/${kind}/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }, token),

  // ─── Gym settlements (owner / gym staff with 'payments') ───
  ownerSettlements: (token: string, gymId?: string) =>
    request<OwnerStatement[]>(`/owner/settlements${qs({ gymId })}`, {}, token),
  ownerSettlement: (token: string, id: string) =>
    request<OwnerStatementDetail>(`/owner/settlements/${encodeURIComponent(id)}`, {}, token),

  // ─── Account recovery (admin, 'account_recovery' scope; 404 not_found while the backend flag is off) ───
  recoveries: (token: string, status: RecoveryFilter = 'open') =>
    request<{ recoveries: RecoveryRow[] }>(`/admin/account-recoveries${qs({ status })}`, {}, token),
  recovery: (token: string, id: string) =>
    request<RecoveryDetail>(`/admin/account-recoveries/${encodeURIComponent(id)}`, {}, token),
  recoveryNote: (token: string, id: string, note: string) =>
    request<{ added: boolean }>(`/admin/account-recoveries/${encodeURIComponent(id)}/note`, { method: 'POST', body: JSON.stringify({ note }) }, token),
  recoveryDecide: (token: string, id: string, body: { decision: 'approve' | 'refuse'; reason?: RecoveryRefusalReason; note?: string }) =>
    request<{ status: 'completed' | 'refused' }>(`/admin/account-recoveries/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify(body) }, token),


  // ─── Moderation ───
  moderationQueue: (token: string, f: { entityType: ModerationEntityType; status?: ModerationStatus; q?: string; cursor?: number; limit?: number }) => {
    const q = new URLSearchParams({ entityType: f.entityType });
    if (f.status) q.set('status', f.status);
    if (f.q) q.set('q', f.q);
    if (f.cursor) q.set('cursor', String(f.cursor));
    if (f.limit) q.set('limit', String(f.limit));
    return request<ModerationList>(`/admin/moderation?${q.toString()}`, {}, token);
  },
  moderationCounts: (token: string, entityType?: ModerationEntityType) =>
    request<{ counts: ModerationCounts }>(`/admin/moderation/counts${entityType ? `?entityType=${entityType}` : ''}`, {}, token),
  moderationDetail: (token: string, entityType: ModerationEntityType, id: string) =>
    request<ModerationDetail>(`/admin/moderation/${entityType}/${encodeURIComponent(id)}`, {}, token),
  moderationDecide: (token: string, entityType: ModerationEntityType, id: string, action: ModerationAction, reason?: string) =>
    request<ModerationDecision>(`/admin/moderation/${entityType}/${encodeURIComponent(id)}/${action === 'require_review' ? 'require-review' : action}`,
      { method: 'POST', body: JSON.stringify({ reason: reason?.trim() || undefined }) }, token),


  // ─── Promotions ───
  promotionReference: (token: string) => request<PromotionReference>('/admin/promotion-reference', {}, token),
  promotionOverview: (token: string) => request<PromotionOverview>('/admin/promotion-overview', {}, token),
  promotions: (token: string, f: { cursor?: number; limit?: number; campaignId?: string } = {}) => {
    const q = new URLSearchParams();
    if (f.cursor) q.set('cursor', String(f.cursor));
    q.set('limit', String(f.limit ?? 100));
    if (f.campaignId) q.set('campaignId', f.campaignId);
    return request<PromotionList>(`/admin/promotions?${q.toString()}`, {}, token);
  },
  promotionDetail: (token: string, id: string) => request<PromotionDetail>(`/admin/promotions/${encodeURIComponent(id)}`, {}, token),
  createPromotion: (token: string, body: PromotionInput) => request<{ promotion: Promotion }>('/admin/promotions', { method: 'POST', body: JSON.stringify(body) }, token),
  updatePromotion: (token: string, id: string, body: Partial<PromotionInput> & { notes?: string | null }) =>
    request<{ promotion: Promotion }>(`/admin/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  promotionAction: (token: string, id: string, action: 'submit' | 'approve' | 'reject' | 'reopen' | 'schedule' | 'activate' | 'pause' | 'resume' | 'cancel' | 'complete', reason?: string) =>
    request<{ promotion: Promotion; warnings?: Array<{ code: string }> }>(`/admin/promotions/${encodeURIComponent(id)}/${action}`,
      { method: 'POST', body: JSON.stringify({ reason: reason?.trim() || undefined }) }, token),
  previewPromotion: (token: string, body: { id: string } | PromotionInput) => request<PromotionPreview>('/admin/promotion-preview', { method: 'POST', body: JSON.stringify(body) }, token),
  searchPromotionEntities: (token: string, entityType: ModerationEntityType, q: string) =>
    request<{ items: EntityMatch[]; total: number }>(`/admin/promotion-entities?entityType=${entityType}&q=${encodeURIComponent(q)}`, {}, token),
  searchPromotionPartners: (token: string, q: string) =>
    request<{ items: PartnerMatch[]; total: number }>(`/admin/promotion-partners?q=${encodeURIComponent(q)}`, {}, token),
  geoAreas: (token: string) => request<{ areas: GeoArea[] }>('/admin/geo-areas', {}, token),
  /** Usable areas for any signed-in role (docs/shop-near-you-api.md); 404 feature_disabled while SHOP_NEAR_YOU is off. */
  shopAreas: (token: string) => request<{ areas: GeoArea[] }>('/shop/areas', {}, token),
  placementLimits: (token: string) => request<{ limits: PlacementLimit[] }>('/admin/promotion-limits', {}, token),
  setPlacementLimit: (token: string, placement: PromotionPlacement, type: PromotionType, body: { maxSlots: number; maxBoostFraction?: number | null; rotationMode?: 'none' | 'time_slice'; rotationWindowMinutes?: number }) =>
    request<{ limit: PlacementLimit }>(`/admin/promotion-limits/${placement}/${type}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  promotionCampaigns: (token: string) => request<{ items: PromotionCampaign[]; total: number }>('/admin/promotion-campaigns?limit=100', {}, token),
  promotionCampaign: (token: string, id: string) => request<{ campaign: PromotionCampaign; promotions: Promotion[] }>(`/admin/promotion-campaigns/${encodeURIComponent(id)}`, {}, token),
  createPromotionCampaign: (token: string, body: { name: string; description?: string; startsAt: string; endsAt: string; geoScope: GeoScope }) =>
    request<{ campaign: PromotionCampaign }>('/admin/promotion-campaigns', { method: 'POST', body: JSON.stringify(body) }, token),
  updatePromotionCampaign: (token: string, id: string, body: Partial<{ name: string; description: string; startsAt: string; endsAt: string; geoScope: GeoScope }>) =>
    request<{ campaign: PromotionCampaign }>(`/admin/promotion-campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  promotionCampaignAction: (token: string, id: string, action: 'start' | 'end' | 'cancel', reason?: string) =>
    request<{ campaign: PromotionCampaign; openPromotions: string[] }>(`/admin/promotion-campaigns/${encodeURIComponent(id)}/${action}`,
      { method: 'POST', body: JSON.stringify({ reason: reason?.trim() || undefined }) }, token),
  promotionAnalytics: (token: string, f: PromotionAnalyticsFilters = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
    return request<PromotionAnalytics>(`/admin/promotion-analytics?${q.toString()}`, {}, token);
  },
  promotionAnalyticsDetail: (token: string, id: string, f: { from?: string; to?: string } = {}) => {
    const q = new URLSearchParams();
    if (f.from) q.set('from', f.from);
    if (f.to) q.set('to', f.to);
    return request<PromotionAnalyticsDetail>(`/admin/promotions/${encodeURIComponent(id)}/analytics?${q.toString()}`, {}, token);
  },
  campaignAnalytics: (token: string, id: string, f: { from?: string; to?: string } = {}) => {
    const q = new URLSearchParams();
    if (f.from) q.set('from', f.from);
    if (f.to) q.set('to', f.to);
    return request<CampaignAnalytics>(`/admin/promotion-campaigns/${encodeURIComponent(id)}/analytics?${q.toString()}`, {}, token);
  },

  // ─── Partner KYC / KYB review (admin, 'kyc' scope) ───
  kycCases: (token: string, filters: { status?: KycCaseStatus; partnerType?: KycPartnerType } = {}) => {
    const q = new URLSearchParams();
    if (filters.status) q.set('status', filters.status);
    if (filters.partnerType) q.set('partnerType', filters.partnerType);
    const s = q.toString();
    return request<KycCaseRow[]>(`/admin/kyc/cases${s ? '?' + s : ''}`, {}, token);
  },
  kycCase: (token: string, id: string) => request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}`, {}, token),
  claimKycCase: (token: string, id: string) =>
    request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}/claim`, { method: 'POST' }, token),
  decideKycCase: (token: string, id: string, body: { decision: KycDecision; reasonCode?: string; reasonNote?: string; override?: boolean }) =>
    request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify(body) }, token),
  reviewKycDocument: (token: string, id: string, documentId: string, body: { decision: 'accept' | 'reject'; note?: string }) =>
    request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/review`, { method: 'POST', body: JSON.stringify(body) }, token),
  reviewKycSettlementAccount: (token: string, id: string, accountId: string, body: { decision: 'verify' | 'reject'; note?: string }) =>
    request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}/settlement-accounts/${encodeURIComponent(accountId)}/review`, { method: 'POST', body: JSON.stringify(body) }, token),
  recordKycSiteVisit: (token: string, gymId: string, body: { result: 'passed' | 'failed'; score: number; maxScore?: number; tier: string; visitedOn?: string; notes?: string }) =>
    request<{ check: KycCheck; gymTier: string | null; tierMatches: boolean }>(`/admin/kyc/gyms/${encodeURIComponent(gymId)}/site-visit`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** A KYC document's file, fetched with the session token (it has no public URL). */
  kycDocumentFile: async (token: string, id: string, documentId: string): Promise<Blob> => {
    const res = await fetch(`${BASE}/admin/kyc/cases/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/file`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 401 && _onUnauthorized) _onUnauthorized();
      throw new ApiError(res.status, body);
    }
    return res.blob();
  },
  /** Earned rewards to hand out: FitFlex admin ('admin') or company HR ('corporate'). */
  rewardQueue: (token: string, scope: ChallengeApiScope, filters: { status?: RewardStatus; challengeId?: string } = {}) => {
    const q = new URLSearchParams();
    if (filters.status) q.set('status', filters.status);
    if (filters.challengeId) q.set('challengeId', filters.challengeId);
    const s = q.toString();
    return request<RewardQueue>(`/${scope}/rewards${s ? '?' + s : ''}`, {}, token);
  },
  setRewardStatus: (token: string, scope: ChallengeApiScope, id: string, body: { status: RewardStatus; reference?: string; note?: string }) =>
    request<{ reward: RewardAward }>(`/${scope}/rewards/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify(body) }, token),
  // ── Groups (company HR, or a B2B organisation's own users with `orgId`) and moderation (admin) ──
  corporateGroups: (token: string, orgId?: string) => request<{ groups: SocialGroup[] }>(groupsBase(orgId), {}, token),
  createCorporateGroup: (token: string, body: GroupInput, orgId?: string) =>
    request<{ group: SocialGroup }>(groupsBase(orgId), { method: 'POST', body: JSON.stringify(body) }, token),
  corporateGroup: (token: string, id: string, orgId?: string) =>
    request<{ group: SocialGroup; members: GroupMember[] }>(`${groupsBase(orgId)}/${encodeURIComponent(id)}`, {}, token),
  updateCorporateGroup: (token: string, id: string, body: Partial<GroupInput>, orgId?: string) =>
    request<{ group: SocialGroup; members: GroupMember[] }>(`${groupsBase(orgId)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  archiveCorporateGroup: (token: string, id: string, orgId?: string) =>
    request<{ archived: boolean }>(`${groupsBase(orgId)}/${encodeURIComponent(id)}/archive`, { method: 'POST' }, token),
  corporateGroupMember: (token: string, id: string, userId: string, action: GroupMemberAction, orgId?: string) =>
    request<{ group: SocialGroup; members: GroupMember[] }>(`${groupsBase(orgId)}/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/${action}`, { method: 'POST' }, token),
  socialReports: (token: string, status: SocialReportStatus) =>
    request<{ reports: SocialReport[] }>(`/admin/social/reports?${new URLSearchParams({ status })}`, {}, token),
  resolveSocialReport: (token: string, id: string, action: 'remove' | 'dismiss' | 'clear_username') =>
    request<{ resolved: boolean }>(`/admin/social/reports/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify({ action }) }, token),
  // ─── Gym and trainer reviews ───
  /** Admin: every review of one kind, newest first (max 200), optionally one status. */
  adminReviews: (token: string, kind: ReviewKind, status?: ReviewStatus) =>
    request<AdminReview[]>(`/admin/${kind}-reviews${qs({ status })}`, {}, token),
  moderateReview: (token: string, kind: ReviewKind, id: string, action: ReviewAction) =>
    request<{ ok: boolean; reviewId: string; status: ReviewStatus }>(
      `/admin/${kind}-reviews/${encodeURIComponent(id)}/moderate`, { method: 'POST', body: JSON.stringify({ action }) }, token),
  /** Owner / gym staff: published reviews for one of their gyms. */
  ownerGymReviews: (token: string, gymId: string) =>
    request<{ gymId: string; summary: ReviewSummary; reviews: PublicReview[] }>(`/operator/gym-reviews${qs({ gymId })}`, {}, token),
  /** HR: the company's staff (for eligibility by department or person). */
  corporateStaff: (token: string) =>
    request<{ employees: CorporateEmployee[] }>('/corporate/staff', {}, token),
  provisionCorporateStaff: (token: string, body: { displayName: string; phone?: string; email?: string; department?: string }) =>
    request<{ employee: CorporateEmployee }>('/corporate/staff', { method: 'POST', body: JSON.stringify(body) }, token),
  setCorporateStaffStatus: (token: string, employeeId: string, status: string) =>
    request<{ employee: CorporateEmployee }>(`/corporate/staff/${encodeURIComponent(employeeId)}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  /** Link an employee to their FitFlex member account (by email, mobile number or user id); `null` unlinks. */
  linkCorporateStaff: (token: string, employeeId: string, contact: UserContact | null) =>
    request<{ employee: CorporateEmployee }>(`/corporate/staff/${encodeURIComponent(employeeId)}/link`, { method: 'POST', body: JSON.stringify(contact ?? { userId: null }) }, token),
  /** HR sign-in: email + password (not Firebase). */
  hrLogin: (email: string, password: string) =>
    request<{ token: string; user: { id: string; userType: string; email?: string; displayName?: string; corporateId?: string } }>(
      '/auth/login', { method: 'POST', body: JSON.stringify({ email, password, requestedRole: 'corporate_hr' }) }
    ),
  // ── Companies and their HR logins (admin) ──
  corporateAccounts: (token: string) =>
    request<CorporateAccount[]>('/admin/corporate', {}, token),
  hrUsers: (token: string, corporateId: string) =>
    request<{ hrUsers: HrUser[] }>(`/admin/corporate/${encodeURIComponent(corporateId)}/hr-users`, {}, token),
  createHrUser: (token: string, corporateId: string, body: { displayName: string; email: string; password: string }) =>
    request<{ hrUser: HrUser }>(`/admin/corporate/${encodeURIComponent(corporateId)}/hr-users`, { method: 'POST', body: JSON.stringify(body) }, token),
  setHrUserStatus: (token: string, corporateId: string, userId: string, status: 'active' | 'suspended') =>
    request<{ hrUser: HrUser }>(`/admin/corporate/${encodeURIComponent(corporateId)}/hr-users/${encodeURIComponent(userId)}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  // ── B2B organisations (admin, 'b2b' scope) ──
  b2bReference: () => request<B2BReference>('/b2b/reference'),
  b2bOrganizations: (token: string, params: { type?: string; status?: string; search?: string; limit?: number; cursor?: number | null } = {}) =>
    request<Paged<B2BOrganization>>(`/admin/b2b/organizations${qs(params)}`, {}, token),
  createB2BOrganization: (token: string, body: Partial<B2BOrganization>) =>
    request<{ organization: B2BOrganization }>('/admin/b2b/organizations', { method: 'POST', body: JSON.stringify(body) }, token),
  b2bOrganization: (token: string, id: string) =>
    request<{ organization: B2BOrganization; access: { role: string; permissions: string[] } }>(`/b2b/organizations/${encodeURIComponent(id)}`, {}, token),
  updateB2BOrganization: (token: string, id: string, body: Partial<B2BOrganization>) =>
    request<{ organization: B2BOrganization }>(`/b2b/organizations/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  setB2BOrganizationStatus: (token: string, id: string, status: string, reason?: string) =>
    request<{ organization: B2BOrganization }>(`/admin/b2b/organizations/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) }, token),
  syncCorporateOrganizations: (token: string) =>
    request<{ created: number; existing: number }>('/admin/b2b/corporate-sync', { method: 'POST' }, token),
  b2bOrganizationUsers: (token: string, id: string, params: { status?: string; limit?: number } = {}) =>
    request<Paged<B2BOrganizationUser>>(`/b2b/organizations/${encodeURIComponent(id)}/users${qs(params)}`, {}, token),
  addB2BOrganizationUser: (token: string, id: string, body: UserContact & { role: string; permissions?: string[] }) =>
    request<{ organizationUser: B2BOrganizationUser }>(`/b2b/organizations/${encodeURIComponent(id)}/users`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateB2BOrganizationUser: (token: string, id: string, orgUserId: string, body: { role?: string; status?: string; permissions?: string[] }) =>
    request<{ organizationUser: B2BOrganizationUser }>(`/b2b/organizations/${encodeURIComponent(id)}/users/${encodeURIComponent(orgUserId)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  b2bBeneficiaries: (token: string, id: string, params: { status?: string; search?: string; limit?: number } = {}) =>
    request<Paged<B2BBeneficiary>>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiaries${qs(params)}`, {}, token),
  // Programme lifecycle: how long each has left, and its renewal.
  b2bProgramLifecycle: (token: string, id: string) =>
    request<{ today: string; items: B2BProgramLifecycle[] }>(`/b2b/organizations/${encodeURIComponent(id)}/program-lifecycle`, {}, token),
  prepareB2BProgramRenewal: (token: string, id: string, programId: string) =>
    request<{ program: B2BProgram; existing?: boolean; benefits: B2BBenefit[]; skipped: Array<{ name: string; reason: string }>; discountNotCarriedOver?: boolean }>(
      `/b2b/organizations/${encodeURIComponent(id)}/programs/${encodeURIComponent(programId)}/renewal`, { method: 'POST', body: '{}' }, token),
  // Many people at once; those who have not joined FitFlex yet are invited.
  importB2BBeneficiaries: (token: string, id: string, body: { rawText: string; dryRun?: boolean }) =>
    request<B2BImportResult>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiaries/import`, { method: 'POST', body: JSON.stringify(body) }, token),
  b2bBeneficiaryInvites: (token: string, id: string) =>
    request<{ items: B2BBeneficiaryInvite[]; invited: number; emailConfigured: boolean; smsConfigured: boolean }>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiary-invites`, {}, token),
  cancelB2BBeneficiaryInvite: (token: string, id: string, inviteId: string) =>
    request<{ invite: B2BBeneficiaryInvite }>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiary-invites/${encodeURIComponent(inviteId)}/cancel`, { method: 'POST', body: '{}' }, token),
  resendB2BBeneficiaryInvite: (token: string, id: string, inviteId: string) =>
    request<{ invite: B2BBeneficiaryInvite; sent: { email: boolean; sms: boolean }; emailConfigured: boolean; smsConfigured: boolean }>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiary-invites/${encodeURIComponent(inviteId)}/resend`, { method: 'POST', body: '{}' }, token),
  enrollB2BBeneficiary: (token: string, id: string, body: UserContact & { beneficiaryType?: string; externalReference?: string; groupName?: string; status?: string }) =>
    request<{ beneficiary: B2BBeneficiary }>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiaries`, { method: 'POST', body: JSON.stringify(body) }, token),
  setB2BBeneficiaryStatus: (token: string, id: string, beneficiaryId: string, status: string) =>
    request<{ beneficiary: B2BBeneficiary }>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiaries/${encodeURIComponent(beneficiaryId)}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  // ── B2B wellness programmes and benefits ──
  b2bProgramReference: () => request<B2BProgramReference>('/b2b/programs/reference'),
  adminB2BPrograms: (token: string, params: { status?: string; organizationId?: string; limit?: number } = {}) =>
    request<Paged<B2BProgram>>(`/admin/b2b/programs${qs(params)}`, {}, token),
  b2bPrograms: (token: string, orgId: string) =>
    request<Paged<B2BProgram>>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs?limit=100`, {}, token),
  b2bProgram: (token: string, orgId: string, programId: string) =>
    request<{ program: B2BProgram; benefits: B2BBenefit[] }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}`, {}, token),
  createB2BProgram: (token: string, orgId: string, body: B2BProgramInput) =>
    request<{ program: B2BProgram }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateB2BProgram: (token: string, orgId: string, programId: string, body: Partial<B2BProgramInput>) =>
    request<{ program: B2BProgram }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  setB2BProgramStatus: (token: string, orgId: string, programId: string, status: string, reason?: string) =>
    request<{ program: B2BProgram }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) }, token),
  b2bProgramEligibility: (token: string, orgId: string, programId: string, params: { benefitId?: string; include?: 'all'; limit?: number } = {}) =>
    request<Paged<B2BEligibilityRow> & { counts: { beneficiaries: number; wouldBeEligible: number; eligibleToday: number } }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/eligibility${qs(params)}`, {}, token),
  createB2BBenefit: (token: string, orgId: string, programId: string, body: B2BBenefitInput) =>
    request<{ benefit: B2BBenefit }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/benefits`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateB2BBenefit: (token: string, orgId: string, programId: string, benefitId: string, body: Partial<B2BBenefitInput>) =>
    request<{ benefit: B2BBenefit }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/benefits/${encodeURIComponent(benefitId)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  setB2BBenefitStatus: (token: string, orgId: string, programId: string, benefitId: string, status: string) =>
    request<{ benefit: B2BBenefit }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/benefits/${encodeURIComponent(benefitId)}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  // ── B2B benefit usage (consumption ledger) ──
  b2bProgramUsage: (token: string, orgId: string, programId: string, params: { from?: string; to?: string } = {}) =>
    request<B2BProgramUsage>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/usage${qs(params)}`, {}, token),
  adminB2BConsumptions: (token: string, params: B2BConsumptionFilters = {}) =>
    request<Paged<B2BConsumption> & { totals: B2BUsageMoney }>(`/admin/b2b/consumptions${qs(params)}`, {}, token),
  adminB2BConsumption: (token: string, id: string) =>
    request<{ consumption: B2BConsumption; sourceEvent: Record<string, unknown> | null; settlementCandidate: Record<string, unknown> }>(`/admin/b2b/consumptions/${encodeURIComponent(id)}`, {}, token),
  reverseB2BConsumption: (token: string, id: string, reason: string) =>
    request<{ consumption: B2BConsumption }>(`/admin/b2b/consumptions/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
  // ── B2B billing and financial management (Phase 5) ──
  adminB2BBilling: (token: string, period?: string) => request<B2BBillingDashboard>(`/admin/b2b/billing${qs({ period })}`, {}, token),
  adminB2BAgreements: (token: string, orgId: string) =>
    request<{ agreements: B2BAgreement[]; inForce: B2BAgreement | null }>(`/admin/b2b/organizations/${encodeURIComponent(orgId)}/agreements`, {}, token),
  createB2BAgreement: (token: string, orgId: string, body: B2BAgreementInput) =>
    request<{ agreement: B2BAgreement }>(`/admin/b2b/organizations/${encodeURIComponent(orgId)}/agreements`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** `version` is the agreement's `updatedAt` as the admin saw it: 409 agreement_changed if it has changed since. */
  activateB2BAgreement: (token: string, id: string, version: string) =>
    request<{ agreement: B2BAgreement }>(`/admin/b2b/agreements/${encodeURIComponent(id)}/activate`, { method: 'POST', body: JSON.stringify({ version }) }, token),
  endB2BAgreement: (token: string, id: string, effectiveTo?: string) =>
    request<{ agreement: B2BAgreement }>(`/admin/b2b/agreements/${encodeURIComponent(id)}/end`, { method: 'POST', body: JSON.stringify({ effectiveTo }) }, token),
  adminB2BBillingAccount: (token: string, orgId: string) =>
    request<{ account: B2BBillingAccount }>(`/admin/b2b/organizations/${encodeURIComponent(orgId)}/billing-account`, {}, token),
  setB2BBillingAccount: (token: string, orgId: string, body: Partial<Pick<B2BBillingAccount, 'contactName' | 'email' | 'phone'>>) =>
    request<{ account: B2BBillingAccount }>(`/admin/b2b/organizations/${encodeURIComponent(orgId)}/billing-account`, { method: 'PUT', body: JSON.stringify(body) }, token),
  prepareB2BFee: (token: string, orgId: string, period: string) =>
    request<{ invoice: B2BSponsorInvoice | null; added: number; reason?: string }>(`/admin/b2b/organizations/${encodeURIComponent(orgId)}/invoices/prepare-fee`, { method: 'POST', body: JSON.stringify({ period }) }, token),
  adminB2BStatement: (token: string, orgId: string, range: { from?: string; to?: string } = {}) =>
    request<B2BStatement>(`/admin/b2b/organizations/${encodeURIComponent(orgId)}/statement${qs(range)}`, {}, token),
  adminB2BPayments: (token: string, organizationId?: string) =>
    request<{ items: B2BPayment[]; total: number }>(`/admin/b2b/payments${qs({ organizationId, limit: 200 })}`, {}, token),
  recordB2BPayment: (token: string, orgId: string, body: B2BPaymentInput) =>
    request<{ payment: B2BPayment; invoices?: B2BSponsorInvoice[]; existing?: boolean; skipped?: Array<{ invoiceId: string; reason: string }> }>(
      `/admin/b2b/organizations/${encodeURIComponent(orgId)}/payments`, { method: 'POST', body: JSON.stringify(body) }, token),
  allocateB2BPayment: (token: string, paymentId: string, allocations: Array<{ invoiceId: string; amountTzs: number }>) =>
    request<{ payment: B2BPayment }>(`/admin/b2b/payments/${encodeURIComponent(paymentId)}/allocate`, { method: 'POST', body: JSON.stringify({ allocations }) }, token),
  reverseB2BPayment: (token: string, paymentId: string, reason: string) =>
    request<{ payment: B2BPayment }>(`/admin/b2b/payments/${encodeURIComponent(paymentId)}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
  createB2BNote: (token: string, invoiceId: string, body: { type: 'credit' | 'debit'; amountTzs: number; reason: string }) =>
    request<{ note: B2BSponsorInvoice }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}/notes`, { method: 'POST', body: JSON.stringify(body) }, token),
  issueB2BNote: (token: string, noteId: string) =>
    request<{ note: B2BSponsorInvoice }>(`/admin/b2b/notes/${encodeURIComponent(noteId)}/issue`, { method: 'POST', body: '{}' }, token),
  applyB2BCredit: (token: string, noteId: string, allocations: Array<{ invoiceId: string; amountTzs: number }>) =>
    request<{ invoices: B2BSponsorInvoice[] }>(`/admin/b2b/notes/${encodeURIComponent(noteId)}/apply`, { method: 'POST', body: JSON.stringify({ allocations }) }, token),
  adminB2BInvoiceDetail: (token: string, invoiceId: string) =>
    request<B2BInvoiceDetail>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}`, {}, token),
  adminB2BReconciliation: (token: string, invoiceId: string) =>
    request<B2BReconciliation>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}/reconciliation`, {}, token),
  // The organisation's own billing (billing.read: owner, admin, finance).
  myB2BOrganizations: (token: string) =>
    request<{ organizations: Array<{ id: string; legalName: string; tradingName?: string | null; role: string; status: string }> }>('/b2b/me/organizations', {}, token),
  orgBilling: (token: string, orgId: string) => request<B2BOrgBilling>(`/b2b/organizations/${encodeURIComponent(orgId)}/billing`, {}, token),
  orgInvoices: (token: string, orgId: string) =>
    request<{ items: B2BSponsorInvoice[]; total: number }>(`/b2b/organizations/${encodeURIComponent(orgId)}/invoices${qs({ limit: 100 })}`, {}, token),
  orgInvoice: (token: string, orgId: string, invoiceId: string) =>
    request<B2BInvoiceDetail>(`/b2b/organizations/${encodeURIComponent(orgId)}/invoices/${encodeURIComponent(invoiceId)}`, {}, token),
  orgPayments: (token: string, orgId: string) =>
    request<{ items: B2BPayment[]; total: number }>(`/b2b/organizations/${encodeURIComponent(orgId)}/payments${qs({ limit: 200 })}`, {}, token),
  orgStatement: (token: string, orgId: string, range: { from?: string; to?: string } = {}) =>
    request<B2BStatement>(`/b2b/organizations/${encodeURIComponent(orgId)}/statement${qs(range)}`, {}, token),
  // Paying (Phase 6): where to pay, "we have paid" notices, the hold.
  orgPaying: (token: string, orgId: string) => request<B2BOrgPaying>(`/b2b/organizations/${encodeURIComponent(orgId)}/paying`, {}, token),
  submitPaymentNotice: (token: string, orgId: string, body: B2BPaymentNoticeInput) =>
    request<{ notice: B2BPaymentNotice; existing?: boolean }>(`/b2b/organizations/${encodeURIComponent(orgId)}/payment-notices`, { method: 'POST', body: JSON.stringify(body) }, token),
  withdrawPaymentNotice: (token: string, orgId: string, noticeId: string) =>
    request<{ notice: B2BPaymentNotice }>(`/b2b/organizations/${encodeURIComponent(orgId)}/payment-notices/${encodeURIComponent(noticeId)}/withdraw`, { method: 'POST', body: '{}' }, token),
  // Analytics and reporting. `query` carries the period (period= or from=&to=) and filters.
  orgDashboard: (token: string, orgId: string, query: B2BAnalyticsQuery = {}) =>
    request<B2BDashboard>(`/b2b/organizations/${encodeURIComponent(orgId)}/analytics/dashboard${qs(query)}`, {}, token),
  orgPeopleAnalytics: (token: string, orgId: string, query: B2BAnalyticsQuery & { search?: string; activity?: string; sort?: string; limit?: number; cursor?: number } = {}) =>
    request<{ period: B2BPeriod; items: B2BPersonRow[]; total: number; nextCursor: number | null }>(`/b2b/organizations/${encodeURIComponent(orgId)}/analytics/people${qs(query)}`, {}, token),
  orgPersonAnalytics: (token: string, orgId: string, beneficiaryId: string, query: B2BAnalyticsQuery = {}) =>
    request<B2BPersonDetail>(`/b2b/organizations/${encodeURIComponent(orgId)}/analytics/people/${encodeURIComponent(beneficiaryId)}${qs(query)}`, {}, token),
  orgProgramAnalytics: (token: string, orgId: string, query: B2BAnalyticsQuery = {}) =>
    request<{ period: B2BPeriod; items: B2BProgramAnalytics[] }>(`/b2b/organizations/${encodeURIComponent(orgId)}/analytics/programs${qs(query)}`, {}, token),
  orgBenefitAnalytics: (token: string, orgId: string, query: B2BAnalyticsQuery = {}) =>
    request<{ period: B2BPeriod; items: B2BBenefitAnalytics[] }>(`/b2b/organizations/${encodeURIComponent(orgId)}/analytics/benefits${qs(query)}`, {}, token),
  orgProviderAnalytics: (token: string, orgId: string, query: B2BAnalyticsQuery = {}) =>
    request<{ period: B2BPeriod; items: B2BProviderAnalytics[]; totals: { providers: number; visits: number; serviceValueTzs: number } }>(`/b2b/organizations/${encodeURIComponent(orgId)}/analytics/providers${qs(query)}`, {}, token),
  orgFinanceAnalytics: (token: string, orgId: string, query: B2BAnalyticsQuery = {}) =>
    request<B2BFinanceAnalytics>(`/b2b/organizations/${encodeURIComponent(orgId)}/analytics/finance${qs(query)}`, {}, token),
  orgExport: (token: string, orgId: string, report: string, query: B2BAnalyticsQuery = {}) =>
    request<{ filename: string; title: string; rows: number; csv: string }>(`/b2b/organizations/${encodeURIComponent(orgId)}/analytics/export/${encodeURIComponent(report)}${qs(query)}`, {}, token),
  adminB2BAnalytics: (token: string, query: B2BAnalyticsQuery = {}) => request<B2BAnalyticsOverview>(`/admin/b2b/analytics${qs(query)}`, {}, token),
  adminB2BDataQuality: (token: string) => request<B2BDataQuality>('/admin/b2b/analytics/data-quality', {}, token),
  // Operations: recurring jobs, exceptions and work waiting on a person.
  adminB2BOps: (token: string) => request<B2BOpsOverview>('/admin/b2b/ops', {}, token),
  adminB2BJobRuns: (token: string, job: string) => request<{ job: string; items: B2BJobRun[] }>(`/admin/b2b/ops/jobs/${encodeURIComponent(job)}/runs${qs({ limit: 20 })}`, {}, token),
  runB2BJob: (token: string, job: string) =>
    request<{ job: string; outcome?: 'ok' | 'failed'; failure?: string | null; skipped?: string; processed?: number; succeeded?: number; failed?: number }>(`/admin/b2b/ops/jobs/${encodeURIComponent(job)}/run`, { method: 'POST', body: '{}' }, token),
  pauseB2BJob: (token: string, job: string, body: { paused: boolean; reason?: string }) =>
    request<{ job: string; paused: boolean }>(`/admin/b2b/ops/jobs/${encodeURIComponent(job)}/pause`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminB2BExceptions: (token: string, query: { status?: string; severity?: string; type?: string; limit?: number } = {}) =>
    request<{ items: B2BOpsException[]; total: number }>(`/admin/b2b/ops/exceptions${qs(query)}`, {}, token),
  setB2BExceptionStatus: (token: string, id: string, body: { status: 'open' | 'investigating' | 'resolved' | 'ignored'; resolution?: string }) =>
    request<{ exception: B2BOpsException }>(`/admin/b2b/ops/exceptions/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify(body) }, token),
  retryB2BException: (token: string, id: string) =>
    request<{ exception: B2BOpsException; run: { outcome?: 'ok' | 'failed'; failure?: string | null; skipped?: string } }>(`/admin/b2b/ops/exceptions/${encodeURIComponent(id)}/retry`, { method: 'POST', body: '{}' }, token),
  // Collections (FitFlex staff).
  adminB2BCollections: (token: string) => request<B2BCollectionsQueue>('/admin/b2b/collections', {}, token),
  adminB2BPaymentInstructions: (token: string) => request<B2BAdminPaymentInstructions>('/admin/b2b/payment-instructions', {}, token),
  /** Only REQUESTS the change (202): `instructions` stay the ones in force, the request is in `pendingChange`. */
  setB2BPaymentInstructions: (token: string, body: Partial<B2BPaymentInstructions>) =>
    request<B2BAdminPaymentInstructions>('/admin/b2b/payment-instructions', { method: 'PUT', body: JSON.stringify(body) }, token),
  /**
   * A different admin from the requester puts the waiting change in force. `changeId` is the change the
   * admin is looking at: 409 change_superseded (with the current changeId) if another request replaced it.
   */
  confirmB2BPaymentInstructions: (token: string, changeId: string) =>
    request<B2BAdminPaymentInstructions>('/admin/b2b/payment-instructions/confirm', { method: 'POST', body: JSON.stringify({ changeId }) }, token),
  /** Drops the waiting change (the requester withdraws it, or another admin declines it); same `changeId` rule as confirm. */
  cancelB2BPaymentInstructions: (token: string, changeId: string, reason?: string) =>
    request<B2BAdminPaymentInstructions>('/admin/b2b/payment-instructions/cancel', { method: 'POST', body: JSON.stringify(reason ? { changeId, reason } : { changeId }) }, token),
  confirmB2BPaymentNotice: (token: string, noticeId: string, body: { amountTzs?: number; note?: string } = {}) =>
    request<{ notice: B2BPaymentNotice; payment?: B2BPayment; skipped?: Array<{ invoiceId: string; reason: string }> }>(
      `/admin/b2b/payment-notices/${encodeURIComponent(noticeId)}/confirm`, { method: 'POST', body: JSON.stringify(body) }, token),
  rejectB2BPaymentNotice: (token: string, noticeId: string, reason: string) =>
    request<{ notice: B2BPaymentNotice }>(`/admin/b2b/payment-notices/${encodeURIComponent(noticeId)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
  remindB2BInvoice: (token: string, invoiceId: string) =>
    request<{ sent: boolean; recipients?: number; emailedTo?: string | null }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}/remind`, { method: 'POST', body: '{}' }, token),
  setB2BBillingHold: (token: string, orgId: string, body: { onHold: boolean; reason?: string }) =>
    request<{ organizationId: string; onHold: boolean; holdReason: string | null }>(`/admin/b2b/organizations/${encodeURIComponent(orgId)}/billing-hold`, { method: 'POST', body: JSON.stringify(body) }, token),
  // ── B2B sponsor billing (FitFlex admin) ──
  prepareB2BInvoice: (token: string, programId: string, kind: 'prepaid' | 'usage', period: string) =>
    request<{ invoice: B2BSponsorInvoice | null; added: number; credited?: number }>(`/admin/b2b/programs/${encodeURIComponent(programId)}/invoices/prepare`, { method: 'POST', body: JSON.stringify({ kind, period }) }, token),
  adminB2BInvoices: (token: string, params: { organizationId?: string; programId?: string; period?: string; kind?: string; status?: string; limit?: number } = {}) =>
    request<Paged<B2BSponsorInvoice>>(`/admin/b2b/invoices${qs(params)}`, {}, token),
  adminB2BInvoice: (token: string, invoiceId: string) =>
    request<{ invoice: B2BSponsorInvoice; lines: B2BSponsorInvoiceLine[] }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}`, {}, token),
  issueB2BInvoice: (token: string, invoiceId: string, vatRateBps: number) =>
    request<{ invoice: B2BSponsorInvoice }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}/issue`, { method: 'POST', body: JSON.stringify({ vatRateBps }) }, token),
  payB2BInvoice: (token: string, invoiceId: string, paymentReference: string) =>
    request<{ invoice: B2BSponsorInvoice }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}/paid`, { method: 'POST', body: JSON.stringify({ paymentReference }) }, token),
  voidB2BInvoice: (token: string, invoiceId: string, reason: string) =>
    request<{ invoice: B2BSponsorInvoice }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}/void`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
  b2bEntitlements: (token: string, programId: string, period?: string) =>
    request<{ period: string; counts: Record<string, number>; entitlements: B2BPassEntitlement[] }>(`/admin/b2b/programs/${encodeURIComponent(programId)}/entitlements${qs({ period })}`, {}, token),
  convertCorporateToProgram: (token: string, corporateId: string) =>
    request<{ organizationId: string; program: B2BProgram; benefit: B2BBenefit }>(`/admin/b2b/corporate/${encodeURIComponent(corporateId)}/convert`, { method: 'POST' }, token),
  /** Internal product analytics (aggregates only). Days are member-local (EAT), inclusive. */
  adminAnalytics: (token: string, from: string, to: string) => {
    const qs = new URLSearchParams({ from, to });
    return request<AnalyticsOverview>(`/admin/analytics?${qs}`, {}, token);
  },
  /** Full gym record (with `images`/`thumbnails`) — fetch on demand for the detail/edit views. */
  /** Pass the admin token to include trainer-pass pricing (hidden from anonymous callers). */
  getGym: (id: string, token?: string) => request<Gym>(`/gyms/${id}`, {}, token),
  saveGym: (token: string, gym: Partial<Gym>) =>
    request<Gym>('/admin/gyms', { method: 'POST', body: JSON.stringify(gym) }, token),
  deleteGym: (token: string, id: string) =>
    request<{ ok: boolean; gym: Gym }>(`/admin/gyms/${id}`, { method: 'DELETE' }, token),
  gymOwners: (token: string) => request<GymOwner[]>('/admin/gym-owners', {}, token),
  /** Lightweight owner refs (id/displayName/email/gymIds) — use for owner-name lookups instead of the full gymOwners() list. */
  gymOwnerRefs: (token: string) => request<GymOwnerRef[]>('/admin/gym-owners?refs=true', {}, token),
  saveGymOwner: (token: string, owner: Partial<GymOwner>) =>
    request<GymOwner>('/admin/gym-owners', { method: 'POST', body: JSON.stringify(owner) }, token),
  deleteGymOwner: (token: string, id: string) =>
    request<{ ok: boolean; owner: GymOwner }>(`/admin/gym-owners/${id}`, { method: 'DELETE' }, token),
  adminTrainers: (token: string) => request<TrainerProfile[]>('/admin/trainers', {}, token),
  /** Lightweight trainer refs (id/displayName/email/gymIds) — use for trainer-name/assignment lookups instead of the full adminTrainers() list. */
  adminTrainerRefs: (token: string) => request<TrainerRef[]>('/admin/trainers?refs=true', {}, token),
  saveTrainer: (token: string, trainer: Partial<TrainerProfile>) =>
    request<TrainerProfile>('/admin/trainers', { method: 'POST', body: JSON.stringify(trainer) }, token),
  deleteTrainer: (token: string, id: string) =>
    request<{ ok: boolean; trainer: TrainerProfile }>(`/admin/trainers/${id}`, { method: 'DELETE' }, token),
  /** Target filters (S2) are sent only when set; older backends ignore them. */
  adminProducts: (token: string, filters: AdminProductFilters = {}) => {
    const q = new URLSearchParams();
    if (filters.targetGender) q.set('targetGender', filters.targetGender);
    if (filters.targetAgeBand) q.set('targetAgeBand', filters.targetAgeBand);
    const qs = q.toString();
    return request<ShopProduct[]>(`/admin/products${qs ? `?${qs}` : ''}`, {}, token);
  },
  createAdminProduct: (token: string, product: AdminProductDraft) =>
    request<ShopProduct>('/admin/products', { method: 'POST', body: JSON.stringify(product) }, token),
  /** With the stock ledger on the server also takes the private fields (null clears one). */
  updateProductListing: (token: string, id: string, listing: {
    homepageVisible: boolean; homepagePriority: number; approvalStatus?: 'pending' | 'approved' | 'rejected';
    costTzs?: number | null; reorderLevel?: number | null;
    variants?: Array<{ name: string; costTzs?: number | null; reorderLevel?: number | null }>;
  }) =>
    request<ShopProduct>(`/admin/products/${id}/listing`, { method: 'PUT', body: JSON.stringify(listing) }, token),
  /** Works rating/reviewCount/soldCount out again from real reviews and orders; writes only with apply true. */
  recomputeProductStats: (token: string, body: { apply?: boolean; productIds?: string[] } = {}) =>
    request<ProductStatsRecompute>('/admin/shop/product-stats/recompute', { method: 'POST', body: JSON.stringify(body) }, token),
  adminVendors: (token: string) => request<VendorSummary[]>('/admin/vendors', {}, token),
  updateAdminVendor: (token: string, id: string, patch: Partial<Pick<VendorSummary, 'approvalStatus' | 'accountStatus' | 'approvalNote' | 'commissionPct'>> & VendorAreasPatch) =>
    request<VendorSummary>(`/admin/vendors/${id}`, { method: 'PUT', body: JSON.stringify(patch) }, token),
  trainerBookings: (token: string) => request<TrainerBooking[]>('/admin/trainer-bookings', {}, token),
  /** `no_show` only with TRAINER_SESSION_OUTCOMES on (functions#231); flag off it is 400 invalid_status. */
  updateTrainerBooking: (token: string, id: string, status: 'confirmed' | 'completed' | 'cancelled' | 'no_show') =>
    request<TrainerBooking>(`/admin/trainer-bookings/${id}`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  paymentRequests: (token: string) => request<PaymentRequest[]>('/admin/payment-requests', {}, token),
  // Trainer and vendor payouts: weekly statements on the same path as gym statements.
  partnerSettlements: (token: string, kind: PayoutKind) => request<{ statements: PartnerSettlement[] }>(`/admin/${kind}-settlements`, {}, token),
  partnerSettlement: (token: string, kind: PayoutKind, id: string) =>
    request<PartnerSettlementDetail>(`/admin/${kind}-settlements/${encodeURIComponent(id)}`, {}, token),
  preparePartnerSettlements: (token: string, kind: PayoutKind, periodStart?: string) =>
    request<{ periodStartDate: string; periodEndDate: string; prepared: number; rebuilt: number; skipped: number; removed: number }>(
      `/admin/${kind}-settlements/prepare`, { method: 'POST', body: JSON.stringify(periodStart ? { periodStart } : {}) }, token),
  partnerSettlementAction: (token: string, kind: PayoutKind, id: string, action: PartnerSettlementAction, body: { reason?: string; paymentReference?: string } = {}) =>
    request<{ statement: PartnerSettlement }>(`/admin/${kind}-settlements/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(body) }, token),
  refunds: (token: string, status?: RefundStatus) =>
    request<{ refunds: Refund[] }>(`/admin/refunds${status ? `?status=${status}` : ''}`, {}, token),
  raiseRefund: (token: string, body: { paymentRequestId: string; amountTzs?: number; note?: string }) =>
    request<{ refund: Refund }>('/admin/refunds', { method: 'POST', body: JSON.stringify(body) }, token),
  decideRefund: (token: string, id: string, body: { decision: 'approve' | 'reject'; note?: string; amountTzs?: number; endAccess?: boolean }) =>
    request<{ refund: Refund }>(`/admin/refunds/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify(body) }, token),
  markRefundPaid: (token: string, id: string, body: { paymentReference: string; paidTo?: string }) =>
    request<{ refund: Refund }>(`/admin/refunds/${encodeURIComponent(id)}/paid`, { method: 'POST', body: JSON.stringify(body) }, token),
  decidePayment: (token: string, id: string, decision: 'approve' | 'reject', reference?: string, note?: string) =>
    request<PaymentRequest>(`/admin/payment-requests/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, reference, note })
    }, token),
  updatePayment: (token: string, id: string, patch: Pick<Partial<PaymentRequest>, 'status' | 'reference' | 'note'>) =>
    request<PaymentRequest>(`/admin/payment-requests/${id}`, { method: 'POST', body: JSON.stringify(patch) }, token),
  // A1 second approver (MONEY_SECOND_APPROVER; 404 feature_disabled while off).
  verifyPayment: (token: string, id: string, body: { reference?: string; note?: string }) =>
    request<PaymentRequest>(`/admin/payment-requests/${encodeURIComponent(id)}/verify`, { method: 'POST', body: JSON.stringify(body) }, token),
  requestPaymentChange: (token: string, id: string, body: { status: PaymentStatusValue; reason: string }) =>
    request<PaymentRequest>(`/admin/payment-requests/${encodeURIComponent(id)}/change-request`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** amountTzs (the amount actually received) is required when a shop-order payment becomes approved. */
  confirmPaymentChange: (token: string, id: string, body: { amountTzs?: number } = {}) =>
    request<PaymentRequest>(`/admin/payment-requests/${encodeURIComponent(id)}/change-request/confirm`, { method: 'POST', body: JSON.stringify(body) }, token),
  cancelPaymentChange: (token: string, id: string, body: { reason?: string }) =>
    request<PaymentRequest>(`/admin/payment-requests/${encodeURIComponent(id)}/change-request/cancel`, { method: 'POST', body: JSON.stringify(body) }, token),
  members: (token: string) => request<MemberSummary[]>('/admin/members', {}, token),
  saveMember: (token: string, member: Partial<MemberSummary>) =>
    request<MemberSummary>('/admin/members', { method: 'POST', body: JSON.stringify(member) }, token),
  setMemberStatus: (token: string, id: string, status: 'active' | 'suspended') =>
    request<MemberSummary>(`/admin/members/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  memberPayments: (token: string, memberId: string) =>
    request<PaymentRequest[]>(`/admin/members/${memberId}/payments`, {}, token),
  adminMemberQr: (token: string, memberId: string) =>
    request<{ token: string; expiresAt: string; rotatesEverySeconds: number }>(`/admin/members/${memberId}/qr`, {}, token),
  adminMemberCheckins: (token: string, memberId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const q = qs.toString();
    return request<MemberCheckinRecord[]>(`/admin/members/${memberId}/checkins${q ? '?' + q : ''}`, {}, token);
  },
  roleApprovals: (token: string) => request<RoleApproval[]>('/admin/role-approvals?status=all', {}, token),
  decideRoleApproval: (token: string, id: string, decision: 'approve' | 'reject', note?: string) =>
    request<RoleApproval>(`/admin/role-approvals/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, note })
    }, token),
  gymUsageSummary: (token: string) => request<GymUsageSummary[]>('/admin/gym-usage', {}, token),
  gymVisitDetails: (token: string, gymId: string) => request<GymVisitRecord[]>(`/admin/gym-usage/${gymId}/visits`, {}, token),
  bookKeeping: (token: string) => request<BookKeepingEntry[]>('/admin/book-keeping', {}, token),
  listInvoices: (token: string, params?: { gymId?: string; status?: string; ownerId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.gymId) qs.set('gymId', params.gymId);
    if (params?.status) qs.set('status', params.status);
    if (params?.ownerId) qs.set('ownerId', params.ownerId);
    const q = qs.toString();
    return request<Invoice[]>(`/admin/invoices${q ? '?' + q : ''}`, {}, token);
  },
  createInvoice: (token: string, data: { gymId: string; amount: number; note?: string; periodStart?: string; periodEnd?: string }) =>
    request<Invoice>('/admin/invoices', { method: 'POST', body: JSON.stringify(data) }, token),
  updateInvoice: (token: string, id: string, data: { receiptUrl?: string; paymentReference?: string; status?: string; note?: string }) =>
    request<Invoice>(`/admin/invoices/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token),
  periodDistribution: (token: string) => request<PeriodDistribution[]>('/admin/distributions/periods', {}, token),
  getSettings: (token: string) => request<PlatformSettings>('/admin/settings', {}, token),
  updateSettings: (token: string, data: Partial<PlatformSettings>) =>
    request<PlatformSettings>('/admin/settings', { method: 'PUT', body: JSON.stringify(data) }, token),
  paymentOptions: (token: string) => request<PaymentOptions>('/payments/options', {}, token),
  getSpecialties: () => request<string[]>('/settings/specialties'),
  /** Public: the FitFlex Pass tiers on sale today (fitflex-functions#189 lists only sellable tiers). */
  subscriptionTiers: () => request<unknown>('/subscription-tiers'),
  adminGetSpecialties: (token: string) => request<string[]>('/admin/settings/specialties', {}, token),
  adminSaveSpecialty: (token: string, name: string) =>
    request<string[]>('/admin/settings/specialties', { method: 'POST', body: JSON.stringify({ name }) }, token),
  adminDeleteSpecialty: (token: string, name: string) =>
    request<string[]>(`/admin/settings/specialties/${encodeURIComponent(name)}`, { method: 'DELETE' }, token),

  // ─── Owner/Operator role ───
  ownerGyms: (token: string) => request<Gym[]>('/owner/gyms', {}, token),
  ownerInvoices: (token: string) => request<Invoice[]>('/owner/invoices', {}, token),
  ownerEarnings: (token: string) => request<OwnerEarnings>('/owner/earnings', {}, token),
  ownerGymCheckins: (token: string, gymId: string) => request<CheckIn[]>(`/owner/gyms/${gymId}/checkins`, {}, token),
  ownerUpdateGym: (token: string, gymId: string, data: Partial<Gym>) =>
    request<Gym>(`/owner/gyms/${gymId}`, { method: 'PUT', body: JSON.stringify(data) }, token),
  ownerMembers: (token: string, gymId?: string) =>
    request<{ members: any[]; stats: Record<string, number> }>(`/owner/members${gymId ? `?gymId=${encodeURIComponent(gymId)}` : ''}`, {}, token),
  ownerCreateMember: (token: string, data: { displayName: string; email?: string; phone?: string; initialPassword?: string; gymId?: string; paidAmount?: number; durationUnit: 'D' | 'W' | 'M'; startDate: string; endDate: string; tier?: string }) =>
    request<{ member: any; subscription: any }>('/owner/members', { method: 'POST', body: JSON.stringify(data) }, token),
  ownerStaff: (token: string) => request<any[]>('/owner/staff', {}, token),
  ownerCreateStaff: (token: string, data: { displayName: string; email: string; password: string; gymIds: string[]; aclPermissions: string[] }) =>
    request<any>('/owner/staff', { method: 'POST', body: JSON.stringify(data) }, token),
  ownerTrainers: (token: string, gymId?: string) =>
    request<TrainerProfile[]>(`/owner/trainers${gymId ? `?gymId=${encodeURIComponent(gymId)}` : ''}`, {}, token),
  ownerPendingTrainers: (token: string) => request<TrainerProfile[]>('/owner/trainers/pending', {}, token),
  ownerDecideTrainer: (token: string, trainerId: string, gymId: string, decision: 'approve' | 'reject') =>
    request<TrainerProfile>(`/owner/trainers/${trainerId}/decision`, { method: 'POST', body: JSON.stringify({ gymId, decision }) }, token),

  // ─── Trainer role ───
  trainerProfile: (token: string) => request<TrainerProfile>('/trainer/me', {}, token),
  trainerUpdateProfile: (token: string, data: Partial<TrainerProfile>) =>
    request<TrainerProfile>('/trainer/me', { method: 'PUT', body: JSON.stringify(data) }, token),
  trainerMyBookings: (token: string) => request<TrainerBooking[]>('/trainer/bookings', {}, token),
  trainerCompleteBooking: (token: string, id: string) =>
    request<TrainerBooking>(`/trainer/bookings/${id}/complete`, { method: 'POST' }, token),

  // ─── Member role ───
  memberMe: (token: string) => request<MemberMeResponse>('/me', {}, token),
  memberProfile: (token: string, data: Partial<MemberProfile>) =>
    request<{ user: MemberSummary }>('/me/profile', { method: 'POST', body: JSON.stringify(data) }, token),
  memberCheckins: (token: string) => request<CheckIn[]>('/me/checkins', {}, token),
  memberBookings: (token: string) => request<TrainerBooking[]>('/me/trainer-bookings', {}, token),
  memberCreateBooking: (token: string, data: { trainerId: string; gymId: string; date: string; slot: string }) =>
    request<{ booking: TrainerBooking; trainer: TrainerProfile }>('/me/trainer-bookings', { method: 'POST', body: JSON.stringify(data) }, token),
  memberMyPayments: (token: string) => request<PaymentRequest[]>('/me/payments', {}, token),
  memberSubscribe: (token: string, data: { tier: string; type?: string; homeGymId?: string }) =>
    request<{ subscription: any; paymentRequest: PaymentRequest | null }>('/me/subscribe', { method: 'POST', body: JSON.stringify(data) }, token),
  memberQr: (token: string) => request<{ token: string; expiresAt: string }>('/me/qr', {}, token),

  // ─── Public ───
  publicGyms: () => request<Gym[]>('/gyms'),
  publicTrainers: (q?: string, specialty?: string) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (specialty) qs.set('specialty', specialty);
    const s = qs.toString();
    return request<TrainerProfile[]>(`/trainers${s ? '?' + s : ''}`);
  },
  publicPasses: () => request<any[]>('/passes'),

  // ─── App photos (admin, 'brand_media' scope; every route 404 feature_disabled while HERO_IMAGES_CMS is off) ───
  adminHeroImages: (token: string) => request<HeroImagesState>('/admin/hero-images', {}, token),
  /**
   * Uploads the ORIGINAL photo file (no browser resize or re-encode; the server cleans it and makes
   * the app sizes). Uses XHR for upload progress; `signal` aborts it.
   */
  uploadHeroImage: (
    token: string,
    file: File,
    fields: HeroImageUploadFields,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<{ image: HeroImage }> => new Promise((resolve, reject) => {
    const form = new FormData();
    // Text fields first, the file last, so the server has every field before it reads the file.
    form.append('source', fields.source);
    form.append('photographer', fields.photographer);
    form.append('licence', fields.licence);
    if (fields.licenceRef) form.append('licenceRef', fields.licenceRef);
    form.append('people', fields.people);
    if (fields.consentRef) form.append('consentRef', fields.consentRef);
    form.append('rightsConfirmed', fields.rightsConfirmed ? 'true' : 'false');
    form.append('noFacesConfirmed', fields.noFacesConfirmed ? 'true' : 'false');
    form.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/admin/hero-images`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-fitflex-client', IDENTITY_V2_CLIENT);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as { image: HeroImage });
      if (xhr.status === 401 && _onUnauthorized) _onUnauthorized();
      reject(new ApiError(xhr.status, body));
    };
    xhr.onerror = () => reject(new TypeError('network_error'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    if (opts.signal) {
      if (opts.signal.aborted) { xhr.abort(); return; }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  }),
  /** A private (cleaned) photo, fetched with the session token: drafts have no public address. */
  heroImagePreview: async (token: string, id: string, width?: HeroPreviewWidth, signal?: AbortSignal): Promise<Blob> => {
    const res = await fetch(`${BASE}/admin/hero-images/${encodeURIComponent(id)}/preview${qs({ w: width })}`, {
      headers: { authorization: `Bearer ${token}`, 'x-fitflex-client': IDENTITY_V2_CLIENT },
      cache: 'no-store',
      signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 401 && _onUnauthorized) _onUnauthorized();
      throw new ApiError(res.status, body);
    }
    return res.blob();
  },
  updateHeroImage: (token: string, id: string, body: HeroImagePatch) =>
    request<{ image: HeroImage; inLiveSnapshot?: boolean }>(
      `/admin/hero-images/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  /** Fast takedown: re-publishes the live snapshot without this photo. Drafts are untouched (the next publish brings it back). */
  unpublishHeroImage: (token: string, id: string, note?: string) =>
    request<{ publication: HeroPublication; removedFromSlots: string[]; rollbackBlockedBefore?: number }>(`/admin/hero-images/${encodeURIComponent(id)}/unpublish`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) }, token),
  /** Sets a slot's DRAFT photos in order ([] = the app's built-in photo). Nothing changes in the apps until publish. */
  setHeroSlot: (token: string, slotId: string, imageIds: string[]) =>
    request<{ slot: { id: string; draft: string[] } }>(
      `/admin/hero-slots/${encodeURIComponent(slotId)}`, { method: 'PUT', body: JSON.stringify({ imageIds }) }, token),
  publishHeroSlots: (token: string, note?: string) =>
    request<{ publication: HeroPublication }>('/admin/hero-slots/publish', { method: 'POST', body: JSON.stringify(note ? { note } : {}) }, token),
  rollbackHeroSlots: (token: string, publicationId: number) =>
    request<{ publication: HeroPublication }>('/admin/hero-slots/rollback', { method: 'POST', body: JSON.stringify({ publicationId }) }, token),
  /** Public, no sign-in: the published app photos. An empty `slots` means "use the built-in photos". */
  appHeroImages: async (signal?: AbortSignal): Promise<HeroManifest> => {
    // No custom headers: a plain GET needs no CORS preflight and stays cacheable.
    const res = await fetch(`${BASE}/app/hero-images`, { signal });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    return res.json() as Promise<HeroManifest>;
  },

  /**
   * Uploads a single file (image) to the Zebra storage service via the
   * backend's multipart proxy (`POST /storage`). Returns the persisted URL
   * to store in place of a base64 data URL.
   */
  uploadFile: async (token: string, file: Blob, filename: string): Promise<UploadedFile> => {
    const form = new FormData();
    form.append('file', file, filename);
    const res = await fetch(`${BASE}/storage/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, body);
    // `url`/`thumbnailUrl` from the backend are root-relative to the API
    // server (e.g. `/storage/<cid>/<filename>`), not the portal's own
    // origin — resolve them against the API base so <img src> works from
    // the portal domain.
    return { ...body, url: `${BASE}${body.url}`, thumbnailUrl: `${BASE}${body.thumbnailUrl}` } as UploadedFile;
  },
};

// ─── App photos (design spec photo-hero-screens §36–§37; backend functions#216) ───
export type HeroPeople = 'none' | 'hands_backs' | 'unclear_faces';
export type HeroImageStatus = 'draft' | 'published' | 'retired';
export type HeroPreviewWidth = 240 | 480 | 960;
export type HeroLuminance = { mean: number; maxPatch: number };

export interface HeroImage {
  id: string;
  sourceId: string;
  status: HeroImageStatus;
  width: number;
  height: number;
  /** Each -1..1 (Flutter Alignment). */
  focal: { x: number; y: number };
  focalX: number;
  focalY: number;
  variants: Record<string, unknown> | null;
  /** Not a scalar: per text zone. Use `brightWarning` for the badge. */
  textZoneLuminance: { vertical: HeroLuminance; horizontal: HeroLuminance } | null;
  /** vertical = phone layouts (bottom 55%), horizontal = the desktop panel (left 50%). */
  brightWarning: { vertical: boolean; horizontal: boolean };
  source: string;
  photographer: string;
  licence: string;
  licenceRef: string | null;
  people: HeroPeople;
  consentRef: string | null;
  rightsConfirmedBy: string;
  rightsConfirmedByName: string | null;
  rightsConfirmedAt: string;
  noFacesConfirmedBy: string;
  noFacesConfirmedByName: string | null;
  noFacesConfirmedAt: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Root-relative and authenticated: fetch with the token, never put it in an <img>. */
  previewUrl: string;
  /** Public copies exist on storage (a failed publish can make them without the photo ever going live). */
  hasPublicFiles?: boolean;
  /** In the current live snapshot (GET /admin/hero-images only; null elsewhere). `status: 'published'` = has been live. */
  live?: boolean | null;
  /** Publication id of this photo's latest unpublish; older snapshots holding it can't be put back. */
  unpublishedInPublication?: number | null;
}

export interface HeroSlot {
  id: string;
  area: string;
  surface: 'mobile' | 'portal';
  variant: 'full' | 'compact' | 'footer' | 'panel' | string;
  aspectHint: number;
  maxImages: number;
  /** Image ids, in order. */
  draft: string[];
  published: string[];
  brightWarning: boolean;
}

export interface HeroPublication {
  id: number;
  publishedBy: string;
  publishedByName?: string | null;
  publishedAt: string;
  note: string | null;
  rolledBackFrom: number | null;
  /** slotId → image ids. */
  slots: Record<string, string[]>;
}

export interface HeroImagesState {
  areas: string[];
  images: HeroImage[];
  slots: HeroSlot[];
  /** The last 20, newest first. */
  publications: HeroPublication[];
}

export interface HeroImageUploadFields {
  source: string;
  photographer: string;
  licence: string;
  licenceRef?: string;
  people: HeroPeople;
  consentRef?: string;
  rightsConfirmed: boolean;
  noFacesConfirmed: boolean;
}

export type HeroImagePatch = Partial<{
  focal: { x: number; y: number };
  source: string;
  photographer: string;
  licence: string;
  licenceRef: string | null;
  people: HeroPeople;
  consentRef: string | null;
  status: 'retired';
  /** Required again whenever source, photographer, licence, licenceRef, people or consentRef change. */
  rightsConfirmed: boolean;
  noFacesConfirmed: boolean;
}>;

export interface HeroManifestEntry {
  id: string;
  sourceId: string;
  url: string;
  url1x: string;
  urlWide: string;
  urlAvif: string | null;
  width: number;
  height: number;
  bytes: number;
  focal: { x: number; y: number };
}
export interface HeroManifest {
  version: number;
  publishedAt?: string;
  slots: Record<string, HeroManifestEntry[]>;
}

/**
 * A published app photo's address. The server sends root-relative `/storage/<cid>/<file>`; anything
 * else (absolute, protocol-relative, other paths) is refused so the portal only ever loads FitFlex's files.
 */
export function heroAssetUrl(path: string | null | undefined): string | null {
  // No percent-escapes (so no %2e / %2f smuggling), no "..", and no "." segment.
  const m = typeof path === 'string' ? /^\/storage\/([A-Za-z0-9._~-]+)\/([A-Za-z0-9._~-]+)$/.exec(path) : null;
  if (!m || [m[1], m[2]].some(seg => seg === '.' || seg.includes('..'))) return null;
  return `${BASE}${path}`;
}

export interface UploadedFile {
  cid: string | null;
  filename: string | null;
  url: string;
  thumbnailCid: string | null;
  thumbnailFilename: string | null;
  thumbnailUrl: string;
}

export interface PortalUser {
  id: string;
  email: string | null;
  displayName: string | null;
  userType: string;
  accountStatus: 'active' | 'suspended';
  portalUser: boolean;
  aclPermissions: string[];
  createdAt?: string;
  isEnvAdmin?: boolean;
  /** Still has the start password an admin set; asked to choose their own at the next sign-in. */
  passwordChangeRequired?: boolean;
}

export interface DashboardResponse {
  gym: { id: string; name: string; tier: string; perVisitRate: number };
  gyms?: Array<{ id: string; name: string; tier: string; perVisitRate: number }>;
  todayCount: number;
  monthVisits: number;
  periodStart?: string;
  periodEnd?: string;
  memberType?: 'all' | 'direct' | 'fitflex';
  periodVisits?: number;
  periodMembers?: number;
  directVisits?: number;
  directMembers?: number;
  fitflexVisits?: number;
  fitflexMembers?: number;
  overall?: {
    gymCount: number;
    totalVisits: number;
    uniqueMembers: number;
    directVisits: number;
    directMembers: number;
    fitflexVisits: number;
    fitflexMembers: number;
  };
  gymSummaries?: Array<{
    gymId: string;
    gymName: string;
    tier: string;
    totalVisits: number;
    uniqueMembers: number;
    directVisits: number;
    directMembers: number;
    fitflexVisits: number;
    fitflexMembers: number;
  }>;
  /** What FitFlex pays the gym. Null for staff without the payments permission. */
  settlement?: {
    rates: { dailyTzs: number; weeklyTzs: number; monthlyTzs: number } | null;
    latest: OwnerStatement | null;
    awaitingPaymentTzs: number;
    lastPaid: { periodStartDate: string; payableTzs: number; paidAt: string | null } | null;
  } | null;
}

export interface CheckIn {
  id: string;
  memberId: string;
  memberPublicId?: string;
  /** The visitor's name (when the gym's server shows names) and username. */
  displayName?: string | null;
  username?: string | null;
  memberPhone: string | null;
  memberEmail?: string | null;
  timestamp: string;
  passTier: string | null;
  visitNumberInCycle: number | null;
  gymTier: string;
}

export interface CheckInResult {
  ok: boolean;
  failure?: string;
  /** Some refusals (not_your_gym, operator_not_assigned_to_gym, member_not_found) use `error`. */
  error?: string;
  checkin?: CheckIn;
  visitNumberInCycle?: number;
  /** True when the member already checked in at this gym today: the existing visit is returned, no new one is used. */
  idempotent?: boolean;
}

export interface Gym {
  id: string;
  name: string;
  tier: string;
  location: string;
  perVisitRate: number;
  ratePerDay?: number;
  ratePerWeek?: number;
  ratePerMonth?: number;
  commissionRate: number;
  status: string;
  accessMode?: 'free_online' | 'paid_visit';
  venueType?: 'physical';
  coordinates?: { lat: number | null; lng: number | null };
  /** Only present on the full record (GET /gyms/:id or ?full=true) — absent from the slimmed admin list. */
  images?: string[];
  /** Small WebP previews, parallel to `images` (same index = same photo). Only present on the full record. */
  thumbnails?: string[];
  /** Single pre-generated thumbnail for list rows — present on the slimmed admin list response. */
  thumbnail?: string | null;
  amenities?: string[];
  equipment?: string[];
  verified?: boolean;
  homepageVisible?: boolean;
  homepagePriority?: number;
  /** Trainer passes the owner sells — only trainers (and admins) see them. */
  trainerPass?: TrainerPassConfig;
}

export type TrainerPassPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * Gym trainer passes: any of daily/weekly/monthly, each with its own fee in
 * TZS. `feeTzs`/`period` mirror the first option for older app builds.
 */
export interface TrainerPassConfig {
  enabled: boolean;
  options?: Partial<Record<TrainerPassPeriod, number>>;
  feeTzs?: number;
  period?: TrainerPassPeriod;
}

/** Trainer social profiles, stored as bare handles. */
export interface TrainerSocialLinks {
  instagram?: string;
  facebook?: string;
  twitter?: string;
}

export interface GymVisitRecord {
  gymId: string;
  gymName: string;
  memberId: string;
  memberName?: string;
  memberEmail?: string;
  date: string;
  billingType: 'day' | 'week' | 'month';
  rate: number;
}

export interface GymUsageSummary {
  gymId: string;
  gymName: string;
  location: string;
  totalVisits: number;
  uniqueMembers: number;
  dayVisits: number;
  weekVisits: number;
  monthVisits: number;
  totalOwed: number;
  totalPaid: number;
  balance: number;
}

export interface BookKeepingEntry {
  id: string;
  date: string;
  type: 'income' | 'expense';
  category: string;
  description: string;
  amount: number;
  reference?: string;
  gymId?: string;
  memberId?: string;
}

export interface SubscriptionTierConfig {
  key: string;
  label: string;
  monthlyPrice: number;
  /** -1 = unlimited; a whole number above zero = visits a month. Null (not set): the tier isn't sold and holders can't check in. */
  visits: number | null;
  gymAccess: string;
}

export interface PayoutBandConfig {
  key: string;
  label: string;
  minVisits: number;
  maxVisits: number;
  payoutTiming: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  commissionPct: number;
}

export interface PlatformSettings {
  id: string;
  subscriptionTiers: SubscriptionTierConfig[];
  payoutBands: PayoutBandConfig[];
  paymentPeriodDays: number;
  payoutModel: 'commission' | 'discounted_rate';
  currency: string;
  /** Slice A3: the Lipa Namba members pay manually; null when not saved. */
  manualPayment?: ManualPaymentSettings | null;
  updatedAt: string;
}

/** Slice A3 (PUT /admin/settings `manualPayment`; null clears it). */
export interface ManualPaymentSettings {
  lipaNamba: string;
  accountName: string;
  network?: string | null;
  instructions?: { en: string | null; sw: string | null } | null;
}

/** GET /payments/options. `manual` is present only while MANUAL_PAY_INSTRUCTIONS is on. */
export interface PaymentOptions {
  manual?: {
    enabled: boolean;
    lipaNamba: string | null;
    accountName: string | null;
    network: string | null;
    instructions: { en: string | null; sw: string | null } | null;
    referenceRequired: boolean;
  };
  [key: string]: unknown;
}

export interface PeriodMemberDetail {
  memberId: string;
  memberName: string;
  visitCount: number;
  billingType: string;
  amount: number;
}

export interface PeriodGymBreakdown {
  gymId: string;
  gymName: string;
  location: string;
  totalVisits: number;
  uniqueMembers: number;
  totalOwed: number;
  totalPaid: number;
  balance: number;
  members: PeriodMemberDetail[];
  invoice: Invoice | null;
}

export interface PeriodDistribution {
  periodStart: string;
  periodEnd: string;
  periodDays: number;
  gyms: PeriodGymBreakdown[];
  totalOwed: number;
  totalPaid: number;
  balance: number;
}

export interface Invoice {
  id: string;
  gymId: string;
  gymName: string;
  ownerId: string | null;
  ownerName: string | null;
  amount: number;
  status: 'unpaid' | 'paid';
  note: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  receiptUrl: string | null;
  paymentReference: string | null;
  createdAt: string;
  createdBy: string;
  paidAt: string | null;
}

export type PayoutKind = 'trainer' | 'vendor';
export type PartnerSettlementAction = 'submit' | 'reject' | 'approve' | 'hold' | 'release' | 'payable' | 'pay' | 'void-request' | 'void-request/cancel' | 'void';

/** A trainer's or vendor's weekly payout statement. */
export interface PartnerSettlement {
  id: string;
  periodStartDate: string;
  periodEndDate: string;
  commissionTzs: number;
  finalNetTzs: number;
  status: GymSettlementStatus;
  submittedBy: string | null;
  holdReason: string | null;
  rejectReason: string | null;
  voidReason: string | null;
  /** Someone has asked for this statement to be voided; a different person has to confirm. */
  voidRequestedBy?: string | null;
  voidRequestedAt?: string | null;
  voidRequestReason?: string | null;
  paymentReference: string | null;
  paidAt: string | null;
  destinationSnapshot: { method?: string | null; provider?: string | null; accountName?: string | null; accountLast4?: string | null } | null;
  // Trainer statements.
  trainer?: { id: string; displayName: string | null; fullName?: string | null; nickname?: string | null; userId: string | null } | null;
  sessionCount?: number;
  listTzs?: number;
  // Vendor statements.
  vendor?: { id: string; businessName: string | null } | null;
  orderCount?: number;
  salesTzs?: number;
}

export interface PartnerSettlementLine {
  id: string;
  commissionTzs: number;
  payoutTzs: number;
  voided: boolean;
  // A trainer's session.
  bookingId?: string;
  memberName?: string | null;
  date?: string;
  slot?: string | null;
  basis?: 'completed' | 'took_place';
  listPriceTzs?: number;
  memberPaidTzs?: number;
  // A vendor's share of a delivered order.
  orderId?: string;
  deliveredOn?: string;
  itemCount?: number;
  salesTzs?: number;
}

export interface PartnerSettlementDetail {
  statement: PartnerSettlement;
  lines: PartnerSettlementLine[];
  /** Whether the partner can be paid right now, and why not. */
  payout: { ok: boolean; reason?: string; until?: string | null; destination?: PartnerSettlement['destinationSnapshot'] };
}

export type RefundStatus = 'requested' | 'approved' | 'paid' | 'rejected';
export type RefundKind = 'subscription' | 'trainer_booking' | 'shop_order';

/** Money FitFlex owes back to a payer: requested → approved → paid, or rejected. */
export interface Refund {
  id: string;
  memberId: string;
  kind: RefundKind;
  subscriptionId: string | null;
  bookingId: string | null;
  orderId: string | null;
  paymentRequestId: string | null;
  amountTzs: number;
  currency: string;
  reasonCode: string;
  note: string | null;
  status: RefundStatus;
  requestedBy: string | null;
  requestedRole: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  paidTo: string | null;
  createdAt: string;
  member?: { id: string; displayName: string | null; phone: string | null; email: string | null } | null;
  /** MONEY_SECOND_APPROVER on only (absent while it is off). */
  secondApproverRequired?: boolean;
  approvalStage?: RefundApprovalStage | null;
  /** The admin who may not approve it (raised it). */
  approveNotBy?: string | null;
  /** The admin who may not mark it paid (approved it). */
  payNotBy?: string | null;
  /** Display names (functions#206; null for members, policy or unknown; absent on older servers). */
  requestedByName?: string | null;
  decidedByName?: string | null;
  paidByName?: string | null;
}

/** A1 second approver: where a payment or refund stands (flag MONEY_SECOND_APPROVER on only). */
export type PaymentApprovalStage = 'awaiting_verification' | 'awaiting_second_approval' | 'change_requested';
export type RefundApprovalStage = 'awaiting_approval' | 'awaiting_payment';
export type PaymentStatusValue = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface PaymentRequest {
  id: string;
  memberId: string;
  /** Null when the request pays for a trainer booking or a shop order instead. */
  subscriptionId: string | null;
  /** Set when the request pays for a group of trainer booking slots. */
  bookingGroupId?: string | null;
  /** Set when the request pays for a marketplace order. */
  orderId?: string | null;
  plan?: string | null;
  currency?: string | null;
  tier: string | null;
  amountTzs: number;
  status: string;
  provider: string;
  reference: string | null;
  /** Slice A3: the transaction ID the member typed (upper case); null when none. */
  memberReference?: string | null;
  /** Slice A3: the number the member says they paid from (+255… E.164); null when none. */
  payerPhone?: string | null;
  note?: string | null;
  /** The gym a gym-bound request pays for (trainer pass / gym plan). */
  gymId?: string | null;
  gym?: { id: string; name: string } | null;
  requestedAt: string;
  decidedAt: string | null;
  member?: { email?: string | null; phone?: string | null; displayName?: string | null };
  subscription?: {
    tier?: string | null;
    /** 'platform_pass' | 'direct_sub' | 'trainer_pass' | … */
    type?: string | null;
    plan?: string | null;
    status: string;
    renewsAt?: string;
    expiresAt?: string | null;
  } | null;
  /** Columns (null unless used): who checked the money arrived, and a pending change request. */
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  changeRequestedStatus?: PaymentStatusValue | null;
  changeRequestedBy?: string | null;
  changeRequestedAt?: string | null;
  changeRequestReason?: string | null;
  /** MONEY_SECOND_APPROVER on only (absent while it is off). */
  secondApproverRequired?: boolean;
  approvalStage?: PaymentApprovalStage | null;
  /** The admin who may not approve it (verified it). */
  approveNotBy?: string | null;
  /** The admin who may not confirm the requested change (requested it). */
  confirmChangeNotBy?: string | null;
  /**
   * Display names of the admins above (functions#206; null for members, policy or unknown; absent on older servers).
   * Without a name the portal says "another admin", never the raw id.
   */
  verifiedByName?: string | null;
  changeRequestedByName?: string | null;
  /** The admin who decided it (the row column; the list spreads the whole row). */
  decidedBy?: string | null;
  decidedByName?: string | null;
}

export interface MemberProfile {
  fitnessGoal?: string | null;
  fitnessLevel?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  preferredWorkoutTimes?: string[];
}

export interface MemberSummary {
  id: string;
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  userType: string;
  accountStatus?: 'active' | 'suspended';
  memberProfile?: MemberProfile | null;
  subscription?: { tier?: string | null; status: string; renewsAt: string } | null;
  pendingPayment?: PaymentRequest | null;
}

export interface RoleApproval {
  id: string;
  email?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  userType: 'gym_operator' | 'trainer' | 'vendor';
  approvalStatus?: 'pending_approval' | 'approved' | 'rejected';
  verified?: boolean;
  approvalNote?: string | null;
  createdAt?: string;
}

export interface GymOwner {
  id: string;
  email?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  userType: 'gym_operator';
  gymId?: string | null;
  gymIds?: string[];
  gym?: Gym | null;
  gyms?: Gym[];
  accountStatus?: 'active' | 'suspended';
  approvalStatus?: 'pending_approval' | 'approved' | 'rejected';
}

export interface TrainerProfile {
  id: string;
  userId?: string | null;
  email?: string | null;
  /** The name clients see: the nickname when the trainer chose one, otherwise their own name. */
  displayName: string;
  /** The trainer's own name. */
  fullName?: string | null;
  /** The optional name the trainer chose for clients to see. */
  nickname?: string | null;
  photoUrl?: string | null;
  images?: string[];
  imageThumbnails?: string[];
  specialties: string[];
  bio?: string;
  rating?: number;
  reviewCount?: number;
  hourlyRateTzs: number;
  experienceYears?: number;
  gymIds: string[];
  gyms?: Gym[];
  status: 'active' | 'inactive' | 'suspended';
  sessionRateCurrency?: 'TZS' | 'USD';
  approvalStatus?: 'pending_approval' | 'approved' | 'rejected';
  verified?: boolean;
  homepageVisible?: boolean;
  homepagePriority?: number;
  availability?: Array<{ day?: string; date?: string; gymId?: string; gymName?: string; slots: string[] }>;
  socialLinks?: TrainerSocialLinks;
}

export interface ShopProduct {
  id: string;
  vendorId: string;
  name: string;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  priceTzs: number;
  discountPriceTzs?: number | null;
  stock: number;
  images?: string[];
  status: 'active' | 'paused' | 'archived';
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  homepageVisible?: boolean;
  homepagePriority?: number;
  /** Private, stock ledger on only (absent otherwise): what the vendor paid for one. */
  costTzs?: number | null;
  /** Private, stock ledger on only (absent otherwise). */
  reorderLevel?: number | null;
  variants?: ProductVariant[] | unknown;
  /** Shop personalisation (S2), set by the vendor in the app. Absent on older backends. null = everyone. */
  targetGender?: ProductTargetGender | null;
  /** Shop personalisation (S2). Absent on older backends. Empty = all ages. */
  targetAgeBands?: ProductAgeBand[];
}

export type ProductTargetGender = 'women' | 'men';
export type ProductAgeBand = '18_29' | '30_44' | '45_59' | '60_plus';
/** GET /admin/products filters (S2). 'everyone' = untagged gender, 'all' = no age bands. */
export interface AdminProductFilters {
  targetGender?: ProductTargetGender | 'everyone';
  targetAgeBand?: ProductAgeBand | 'all';
}
export const PRODUCT_AGE_BANDS: ProductAgeBand[] = ['18_29', '30_44', '45_59', '60_plus'];

/** A product option ("variant"). Private and effective fields come only with the stock ledger on. */
export interface ProductVariant {
  name: string;
  stock?: number | null;
  costTzs?: number | null;
  reorderLevel?: number | null;
  effectiveCostTzs?: number | null;
  effectiveReorderLevel?: number | null;
}

// ─── Vendor portal (S2) ───

/** GET /vendor/me: who I am in my business. */
export interface VendorMe {
  vendorId: string;
  businessName: string | null;
  userType: 'vendor' | 'vendor_staff';
  vendorRole: string | null;
  permissions: string[];
  approvalStatus: string | null;
  accountStatus: string | null;
  tools: VendorTools;
}

/** The vendor tools switched on (same object as GET /vendor/tools/options). */
export interface VendorTools {
  portal?: boolean;
  stockLedger?: boolean;
  buyerContact?: boolean;
  canSeeCost?: boolean;
  /** Shop banners (SHOP_BANNERS): merch.banners. When absent the portal asks GET /vendor/shop-banners once. */
  merch?: { banners?: boolean };
  /** S5 (VENDOR_DOCUMENTS): share links, PDF, the document view and order invoices. Missing = off. */
  documents?: boolean;
  /** S5 (VENDOR_VAT): tax details, VAT codes and VAT on documents. Missing = off. */
  vat?: boolean;
  /** S5: VAT applies to this vendor's new sales now (registered, verified, certificate standing). */
  vatInForce?: boolean;
  [tool: string]: unknown;
}

export interface VendorProduct extends ShopProduct {
  variants?: ProductVariant[];
}

export interface LowStockRow { productId: string; name: string; variant: string | null; stock: number; reorderLevel: number }

export type StockReason = 'count' | 'restock' | 'returned' | 'found' | 'damaged' | 'expired' | 'lost' | 'other';

export interface StockAdjustmentInput {
  variant?: string;
  reason: StockReason;
  quantity: number;
  expectedStock?: number;
  direction?: 'in' | 'out';
  note?: string;
  clientRef: string;
}

/** A product's stock as the stock endpoints return it (no private fields). */
export interface ProductStock { id: string; stock: number; variants: Array<{ name: string; stock: number | null }> }

export interface StockMovement {
  id: string;
  productId: string;
  variant: string | null;
  reason: string;
  kind?: string;
  delta: number;
  stockBefore: number | null;
  stockAfter: number | null;
  note: string | null;
  actor: { id: string; name: string | null } | null;
  orderId?: string | null;
  document: { type: string; id: string; number: string | null; shortRef?: string | null } | null;
  createdAt: string;
}

export interface StockMovementPage {
  productId: string;
  variant: string | null;
  openingStock: number;
  closingStock: number;
  rows: StockMovement[];
  nextCursor: string | null;
}

/** A marketplace order as its vendor sees it (server allowlist; own lines and own status only). */
export interface VendorOrder {
  id: string;
  shortRef: string;
  createdAt: string | null;
  /** This vendor's own fulfilment status. */
  status: string;
  /** The combined, customer-facing status. */
  orderStatus: string;
  nextStatuses: string[];
  timeline: Array<{ status: string; at: string | null; reason?: string }>;
  items: Array<{ productId: string | null; name: string | null; variant: string | null; qty: number; priceTzs: number; image: string | null; commissionTzs?: number | null; vendorPayoutTzs?: number | null }>;
  totalTzs: number;
  paymentStatus: string | null;
  paymentMethod: string | null;
  deliveryMethod: string | null;
  note: string | null;
  pickupGymId: string | null;
  pickupGym: { id: string; name: string | null } | null;
  /** customerLinked (S4, being added on the backend): the buyer is an app customer of mine whose profile can open. */
  /** forgotten (S4, being added on the backend): the buyer deleted their FitFlex account — show "Deleted member". */
  buyer: { customerId: string | null; customerLinked?: boolean; forgotten?: boolean; displayName: string | null; phone?: string | null; contactVisibleUntil?: string | null };
  deliveryAddress?: string | null;
}

/** GET /vendor/sales query. from/to are EAT days (YYYY-MM-DD, inclusive, on soldAt). */
export interface VendorSalesQuery {
  from?: string;
  to?: string;
  status?: 'completed' | 'voided' | 'all';
  createdBy?: 'me';
  /** S4: cash | credit (pay later) | all. */
  kind?: 'cash' | 'credit';
  /** S4: one customer's sales; only for callers who also hold `customers`. */
  customerId?: string;
  limit?: number;
  cursor?: string | null;
}
export type VendorSalePerson = { id: string; name: string | null } | null;
/** A row of GET /vendor/sales. */
export interface VendorSaleRow {
  id: string;
  number: string;
  soldAt: string;
  recordedAt: string;
  status: 'completed' | 'voided';
  totalTzs: number;
  itemCount: number;
  methods: string[];
  createdBy: VendorSalePerson;
  /** A line was sold at another price than the shop's. (#214 always sends it; the UI still copes if absent.) */
  hasOverride: boolean;
  /** Line discounts + sale discount. */
  discountTzs: number;
  /** recordedAt − soldAt > 5 min (the UI falls back to comparing them if absent). */
  lateRecorded: boolean;
  /** S4: cash | credit (pay later). Older servers omit these four. */
  kind?: 'cash' | 'credit';
  /** Still owed now; 0 for cash. */
  balanceTzs?: number;
  dueDate?: string | null;
  /** Never contact details. forgotten (being added on the backend): the app buyer deleted their account. */
  customer?: { id: string; name: string | null; forgotten?: boolean } | null;
}
/** Completed sales over the whole from/to/createdBy range (not the page, not the status filter); cash net of change. */
export interface VendorSaleSummary {
  count: number;
  totalTzs: number;
  voidedCount: number;
  byMethod: Array<{ method: string; amountTzs: number }>;
  /** Completed: line + sale discounts. (#214 always sends these three; the UI hides a tile if one is absent.) */
  discountTzs: number;
  /** Completed sales with a changed price. */
  overrideCount: number;
  /** All sales in the range (voided too) recorded > 5 min after soldAt. */
  lateCount: number;
  /** S4, only for callers who also hold `customers`: what completed pay-later sales left owing at the counter (byMethod + payLaterTzs = totalTzs). */
  payLaterTzs?: number;
  /** S4, only for callers who also hold `customers`: completed pay-later sales in the range, still owed now. */
  owedTzs?: number;
}
export interface VendorSalePage { sales: VendorSaleRow[]; nextCursor: string | null; summary?: VendorSaleSummary | null }
/** A walk-in sale (GET /vendor/sales/:id, POST …/void). Never carries cost. */
export interface VendorSale {
  id: string;
  number: string;
  status: 'completed' | 'voided';
  /** cash, or credit = pay later (S4). */
  kind: 'cash' | 'credit';
  soldAt: string;
  recordedAt: string;
  /** Σ qty × unitPriceTzs, before discounts. */
  subtotalTzs: number;
  /** Σ line discounts. */
  lineDiscountTzs: number;
  /** Whole-sale discount, after line discounts. */
  discountTzs: number;
  totalTzs: number;
  paidTzs: number;
  changeTzs: number;
  note: string | null;
  createdBy: VendorSalePerson;
  voidedBy: VendorSalePerson;
  voidedAt: string | null;
  voidReason: string | null;
  /** recordedAt − soldAt > 5 min (the UI falls back to comparing them if absent). */
  lateRecorded: boolean;
  lines: Array<{
    nameSnapshot: string;
    variant: string | null;
    qty: number;
    listPriceTzs: number;
    unitPriceTzs: number;
    priceChanged: boolean;
    priceChangedBy: VendorSalePerson;
    discountTzs: number;
    lineTotalTzs: number;
  }>;
  payments: Array<{ method: string; amountTzs: number; reference: string | null }>;
  /** S4 pay later. Older servers omit these. */
  customer?: { id: string; name: string | null; forgotten?: boolean } | null;
  dueDate?: string | null;
  /** Still owed now; 0 for cash. */
  balanceTzs?: number;
  /** Paid at the counter. */
  paidAtSaleTzs?: number;
  /** Customer payments towards this sale; only for callers who also hold `customers`. */
  allocations?: Array<{ paymentId: string; number: string; amountTzs: number; receivedOn: string; voided: boolean }>;
}

// ─── Vendor customers (S4) ───
export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';
export type VendorAging = Record<AgingBucket, number>;
export type VendorCustomerFilter = 'all' | 'owes' | 'overdue' | 'manual' | 'marketplace' | 'archived';
export type VendorCustomerSort = 'name' | 'owed' | 'overdue' | 'recent';
export interface VendorCustomersQuery {
  q?: string;
  filter?: VendorCustomerFilter;
  bucket?: AgingBucket;
  sort?: VendorCustomerSort;
  limit?: number;
  cursor?: string | null;
}
/** Money owed by one customer, EAT days. */
export interface VendorCustomerMoney {
  owedTzs: number;
  /** Balance of sales past their due date. */
  overdueTzs: number;
  oldestDueDate: string | null;
  /** 0 when nothing is overdue. */
  maxDaysOverdue: number;
  aging: VendorAging;
}
/** A row of GET /vendor/customers (caller holds `customers`). */
export interface VendorCustomerRow extends VendorCustomerMoney {
  id: string;
  /** manual = walk-in (the vendor's own record) · marketplace = app buyer. */
  source: 'manual' | 'marketplace';
  name: string | null;
  /** Walk-in customers only (A-02: never for app customers). */
  phone: string | null;
  archived: boolean;
  /** The app buyer deleted their FitFlex account: name is null, show "Deleted member". */
  forgotten: boolean;
  lastPurchaseAt: string | null;
}
export interface VendorCustomerPage { customers: VendorCustomerRow[]; nextCursor: string | null; asOf?: string }
/** A customer record. App customers never carry phone, email, address or a user id (A-02). */
export interface VendorCustomer {
  id: string;
  source: 'manual' | 'marketplace';
  name: string | null;
  forgotten: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface VendorCustomerOpenSale {
  id: string;
  number: string;
  soldAt: string;
  dueDate: string;
  totalTzs: number;
  balanceTzs: number;
  /** 0 when not yet due. */
  daysOverdue: number;
  overdue: boolean;
}
/** GET /vendor/customers/:id. */
export interface VendorCustomerProfile extends VendorCustomer, VendorCustomerMoney {
  lastPurchaseAt: string | null;
  totals: { shopSalesTzs: number; shopSalesCount: number; appOrdersTzs: number; appOrdersCount: number; lastPurchaseAt: string | null };
  asOf: string;
  /** Oldest due first. */
  openSales: VendorCustomerOpenSale[];
}
export interface VendorCustomerInput { name: string | null; phone: string | null; email: string | null; address: string | null; note: string | null }
export type VendorPhoneDuplicate = { id: string; name: string | null } | null;
/** A paid app order of an app customer (own lines only; never contact details). */
export interface VendorCustomerOrder {
  id: string;
  shortRef: string;
  createdAt: string | null;
  status: string;
  orderStatus: string;
  tab: 'open' | 'delivered' | 'cancelled';
  paymentStatus: string | null;
  totalTzs: number;
  itemCount: number;
}
export interface VendorCustomerPayment {
  id: string;
  /** PMT-000001, continuous per vendor. */
  number: string;
  customerId: string;
  status: 'recorded' | 'voided';
  amountTzs: number;
  method: string;
  reference: string | null;
  /** EAT day. */
  receivedOn: string;
  note: string | null;
  clientRef: string;
  recordedAt: string;
  recordedBy: VendorSalePerson;
  allocations: Array<{ saleId: string; saleNumber: string; amountTzs: number }>;
  voidedAt: string | null;
  voidedBy: VendorSalePerson;
  voidReason: string | null;
}
export interface VendorCustomerPaymentInput {
  clientRef: string;
  amountTzs: number;
  method: string;
  reference?: string;
  receivedOn?: string;
  note?: string;
  /** Manual; omitted → oldest due first. */
  allocations?: Array<{ saleId: string; amountTzs: number }>;
}
export interface VendorAgingRow extends VendorAging {
  customerId: string;
  name: string | null;
  /** Being added on the backend: the app buyer deleted their account ("Deleted member"). */
  forgotten?: boolean;
  source: 'manual' | 'marketplace';
  owedTzs: number;
  overdueTzs: number;
  oldestDueDate: string | null;
  maxDaysOverdue: number;
  openSaleCount: number;
  overdueSaleCount: number;
}
/** GET /vendor/receivables/aging: totals cover every customer who owes, not the bucket filter or the page. */
export interface VendorAgingPage {
  asOf: string;
  totals: VendorAging & { owedTzs: number; overdueTzs: number; customerCount: number; overdueCustomerCount: number; openSaleCount: number; overdueSaleCount: number };
  rows: VendorAgingRow[];
  nextCursor: string | null;
}

export interface VendorPayments { todaySalesTzs: number; pendingSettlementTzs: number; [figure: string]: unknown }

/** A vendor's own payout statement (partner view: no staff ids, `paidTo` instead of the snapshot). */
export interface VendorStatement extends Omit<PartnerSettlement, 'destinationSnapshot' | 'submittedBy'> {
  onHold?: boolean;
  paidTo?: { method: string | null; provider: string | null; accountLast4: string | null } | null;
}

export interface VendorStatementList { statements: VendorStatement[]; payoutReady: boolean; payoutBlockedBy: string | null }

/** POST /auth/pin/login: a session, or a step to finish in the app. */
export interface PinLoginResult {
  token?: string;
  user?: { id: string; userType: string; gymId?: string; email?: string; portalUser?: boolean; aclPermissions?: string[]; displayName?: string | null };
  personas?: PersonaSummary[];
  setupRequired?: boolean;
  startPin?: boolean;
  onboarding?: boolean;
}

export interface AdminProductDraft {
  vendorId: string;
  name: string;
  description?: string;
  category?: string;
  brand?: string;
  priceTzs: number;
  stock: number;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  homepageVisible?: boolean;
  homepagePriority?: number;
}

/** A product's stored marketplace stats, as POST /admin/shop/product-stats/recompute reports them (rating to 2 decimals). */
export interface ProductStats { rating: number; reviewCount: number; soldCount: number }
/**
 * POST /admin/shop/product-stats/recompute (functions#220): a dry run (apply false) or the applied run.
 * Errors: 403 non-admin; 409 recompute_in_progress (another apply running); 400 invalid_apply / invalid_product_ids / too_many_product_ids.
 */
export interface ProductStatsRecompute {
  dryRun: boolean;
  checked: number;
  changed: Array<{ productId: string; name: string; vendorId: string; before: ProductStats; after: ProductStats }>;
  unchanged: number;
  appliedAt?: string;
  runId?: string;
}

export interface VendorSummary {
  id: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  userType: 'vendor';
  approvalStatus: 'pending_approval' | 'approved' | 'rejected';
  approvalNote?: string | null;
  accountStatus: 'active' | 'suspended';
  /** The vendor's KYC case status; null if they haven't started. */
  kycStatus?: KycCaseStatus | null;
  /** Existing vendors predate KYC and keep working without it. */
  kycExempt?: boolean;
  /** The marketplace commission FitFlex takes on this vendor's sales (percent). */
  commissionPct?: number;
  productCount: number;
  pendingProductCount: number;
  createdAt?: string;
  vendorProfile?: {
    businessName?: string | null;
    businessCategory?: string | null;
    address?: string | null;
    status?: string | null;
    /** Free text the vendor typed (list or comma text); shown so admins can map it to areas. */
    deliveryRegions?: string[] | string | null;
    /** "Based in": a city or district GeoArea id (docs/shop-near-you-api.md). Absent when not set. */
    cityId?: string | null;
    /** The region the vendor is based in; the server fills it from cityId. */
    regionId?: string | null;
    /** "Delivers to": GeoArea ids of any level; the country id = nationwide; [] = doesn't deliver. */
    deliveryAreaIds?: string[] | null;
    /** Read-only: who set the area fields last. */
    areasSource?: 'vendor' | 'admin' | 'backfill' | null;
  } | null;
}

/** Admin vendor area mapping (PUT /admin/vendors/:id): null clears cityId/regionId, [] clears deliveryAreaIds. */
export type VendorAreasPatch = { cityId?: string | null; regionId?: string | null; deliveryAreaIds?: string[] };

/** Lightweight owner projection (id/displayName/email/gymIds) for pages that only need owner names, e.g. the gyms table's owner column and owner-select dropdown. */
export interface GymOwnerRef {
  id: string;
  displayName?: string | null;
  email?: string | null;
  gymId?: string | null;
  gymIds?: string[];
}

/** Lightweight trainer projection (id/displayName/email/gymIds) for pages that only need trainer names and gym links, e.g. the gyms table's trainer-select dropdown. */
export interface TrainerRef {
  id: string;
  displayName?: string | null;
  fullName?: string | null;
  nickname?: string | null;
  email?: string | null;
  gymIds?: string[];
}

export interface TrainerBooking {
  id: string;
  memberId: string;
  trainerId: string;
  gymId: string;
  date: string;
  slot: string;
  amountTzs: number;
  /** `payment_pending` / `payment_rejected` while its payment is open; `no_show` with TRAINER_SESSION_OUTCOMES on (functions#231). */
  status: 'payment_pending' | 'payment_rejected' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  /** What the caller may do now; present only with TRAINER_SESSION_OUTCOMES on (missing = flag off). */
  actions?: { canComplete: boolean; canMarkNoShow: boolean };
  createdAt?: string;
  member?: { email?: string | null; phone?: string | null; displayName?: string | null } | null;
  trainer?: TrainerProfile | null;
  gym?: Gym | null;
}

export interface OwnerEarnings {
  totalPaid: number;
  totalPending: number;
  paidCount: number;
  pendingCount: number;
}

export interface MemberCheckinRecord {
  id: string;
  memberId: string;
  gymId: string;
  timestamp: string;
  method: string;
  subscriptionType: string;
  passTier: string | null;
  visitNumberInCycle: number | null;
  gymTier: string;
  visitConsumed: boolean;
  gym: Gym | null;
}

export interface MemberMeResponse {
  user: MemberSummary;
  subscription: { id: string; type: string; tier: string | null; status: string; renewsAt: string; expiresAt: string } | null;
  pendingPayment: PaymentRequest | null;
  visitsUsed: number;
  visitCap: number | null;
}

// ── Internal analytics ──────────────────────────────────────────────────
/** Share 0–1, or null when there was nothing to measure. */
export type Rate = number | null;
export interface WorkoutTally { due: number; completed: number; skipped: number; missed: number; completionRate: Rate }
export interface CompletionTally { evaluated: number; met: number; completionRate: Rate }
export interface AnalyticsOverview {
  period: { from: string; to: string; days: number };
  generatedAt: string;
  members: number;
  dailyActive: {
    series: { day: string; members: number }[];
    averageDaily: number; activeInPeriod: number; activeLast7Days: number; stickiness: Rate;
  };
  activityLogging: {
    activities: number; membersLogging: number; loggingRate: Rate; perLoggingMember: number | null;
    byOrigin: { device: number; fitflex: number; manual: number };
  };
  workouts: WorkoutTally & { trainerAssigned: WorkoutTally; selfPlanned: WorkoutTally; completedInPeriod: number };
  challenges: {
    running: number; byCreator: Record<string, number>; joinsInPeriod: number; participants: number;
    participationRate: Rate; finishedEntries: number; completionRate: Rate; leaderboardOptInRate: Rate;
  };
  streaks: {
    distributionAtEnd: { from: number; to: number | null; members: number }[];
    onStreakAtStart: number; unbrokenThroughPeriod: number; streakRetention: Rate;
    weeklyRetention: { week: string; active: number; activeNextWeek: number; retention: Rate }[];
  };
  goals: {
    membersWithGoals: number; periodsEvaluated: number; periodsMet: number; completionRate: Rate;
    byType: Record<string, CompletionTally>; byPeriod: Record<string, CompletionTally>;
  };
  trainers: {
    activeConnections: number; trainersWithClients: number; requests: number; accepted: number; declined: number;
    pending: number; acceptanceRate: Rate; clientsSharingData: number; workoutsAssigned: number;
    trainersAssigning: number; assignedCompletionRate: Rate;
  };
  gyms: {
    checkins: number; membersVisiting: number; visitRate: Rate; visitsPerVisitingMember: number | null;
    gymsVisited: number; topGyms: { gymId: string; name: string | null; checkins: number; members: number }[];
    gymChallenges: number; gymChallengeParticipants: number; membersSharingWithGyms: number;
  };
}

// ── Challenge management (admin + HR) ───────────────────────────────────
export type ChallengeScope = 'admin' | 'corporate';
/** Where the challenge and reward routes live: FitFlex admin, a company's HR, or a B2B organisation's own users. */
export type ChallengeApiScope = ChallengeScope | `b2b/organizations/${string}`;
export type ChallengeType = 'steps' | 'distance_km' | 'workouts' | 'active_minutes' | 'consistency' | 'gym_attendance';
export type ChallengeMode = 'individual' | 'teams' | 'gym_vs_gym' | 'department';
export type RewardFunding = 'fitflex' | 'company' | 'partner';
export interface SocialGroup {
  id: string;
  name: string;
  description: string | null;
  ownerType: 'member' | 'trainer' | 'gym' | 'corporate';
  joinPolicy: 'open' | 'approval';
  discoverable: boolean;
  memberCount: number;
  inviteCode?: string;
  pending?: number;
  canManage?: boolean;
}
export interface GroupInput { name: string; description?: string; joinPolicy: 'open' | 'approval'; discoverable: boolean }
export interface GroupMember { id: string; displayName: string | null; role: 'admin' | 'member'; status: 'active' | 'pending' }
export type GroupMemberAction = 'approve' | 'remove' | 'make_admin' | 'make_member';
export type ReviewKind = 'gym' | 'trainer';
export type ReviewStatus = 'published' | 'flagged' | 'hidden';
export type ReviewAction = 'hide' | 'flag' | 'restore';
/** A review as admins see it: full member name and moderation state. */
export interface AdminReview {
  id: string;
  gymId?: string;
  trainerId?: string;
  gymName?: string | null;
  trainerName?: string | null;
  memberId: string;
  memberName: string | null;
  rating: number;
  text: string | null;
  status: ReviewStatus;
  moderatedBy?: string | null;
  moderatedAt?: string | null;
  createdAt: string;
}
/** A published review as the public sees it: first name + initial only. */
export interface PublicReview {
  id: string;
  rating: number;
  text: string | null;
  memberName: string;
  memberPhotoUrl: string | null;
  createdAt: string;
}
export interface ReviewSummary {
  averageRating: number | null;
  reviewCount: number;
  distribution: Record<string, number>;
}
export type SocialReportStatus = 'open' | 'actioned' | 'dismissed';
export interface SocialReport {
  id: string;
  targetType: 'user' | 'activity' | 'comment' | 'group';
  targetId: string;
  reason: string | null;
  status: SocialReportStatus;
  createdAt: string;
  reporter: string | null;
  target: { text?: string; author?: string | null; authorUsername?: string | null; removed?: boolean; displayName?: string | null; username?: string | null; name?: string; archived?: boolean; owner?: string | null; type?: string; title?: string | null } | null;
}
export type RewardType = 'points' | 'discount' | 'gym_pass' | 'trainer_session' | 'vendor_voucher' | 'corporate_reward' | 'badge' | 'certificate' | 'other';
export type RewardRule = 'finishers' | 'top' | 'team';
export interface RewardItem {
  id: string;
  type: RewardType;
  label: string;
  value: string | null;
  rule: RewardRule;
  topN: number | null;
}
export type RewardItemInput = Omit<RewardItem, 'id'> & { id?: string };
export type RewardStatus = 'pending' | 'approved' | 'issued' | 'rejected';
export interface RewardHistoryEntry { status: RewardStatus; at: string; by: string | null; byName?: string | null; note?: string; reference?: string }
/** One member's earned reward, as a fulfilment queue sees it (never their activity). */
export interface RewardAward {
  id: string;
  challenge: { id: string; name: string | null; endDate: string | null };
  reward: { id: string; type: RewardType; label: string; value: string | null; rule: RewardRule };
  rank: number | null;
  status: RewardStatus;
  earnedAt: string;
  issuedAt: string | null;
  reference: string | null;
  note: string | null;
  member: { id: string; displayName: string | null; department?: string | null };
  funder: string;
  history: RewardHistoryEntry[];
}
export interface RewardQueue { rewards: RewardAward[]; counts: Record<RewardStatus, number> }
export type Eligibility =
  | { kind: 'all' }
  | { kind: 'tiers'; tiers: string[] }
  | { kind: 'departments'; departments: string[] }
  | { kind: 'employees'; employeeIds: string[] };
export interface ChallengeInput {
  name: string;
  description?: string | null;
  type: ChallengeType;
  target: number;
  startDate: string;
  endDate: string;
  rewardItems: RewardItemInput[];
  rewardFunding?: RewardFunding;
  eligibility?: Eligibility;
  mode?: ChallengeMode;
  teams?: string[];
  /** Save without publishing: nobody sees it until it is published. */
  draft?: boolean;
}
export interface ManagedChallenge {
  id: string;
  name: string;
  description?: string | null;
  type: ChallengeType;
  target: number;
  startDate: string;
  endDate: string;
  rewards: string[];
  rewardItems?: RewardItem[] | null;
  rewardFunding?: RewardFunding | null;
  eligibility: Eligibility | null;
  mode?: ChallengeMode;
  /** `paused` takes no new people; those already in carry on. */
  status: 'draft' | 'active' | 'paused' | 'closed' | 'cancelled' | 'archived';
  phase: 'draft' | 'upcoming' | 'active' | 'ended' | 'cancelled';
  participantCount: number;
  teams?: { id: string; name: string }[];
}
export interface ChallengeSummary {
  eligible: number | null;
  joined: number;
  participationRate: Rate;
  /** null (with `resultsHidden`) while too few people take part for results to be shown. */
  completed: number | null;
  completionRate: Rate;
  averageProgress: number | null;
  /** Company challenges: completion and progress are withheld until `minGroupSize` people take part. */
  resultsHidden?: boolean;
}
export interface DepartmentParticipation {
  department: string | null;
  other: boolean;
  eligible: number;
  joined: number;
  participationRate: Rate;
  completed?: number;
  averageProgress?: number;
}
export interface ChallengeParticipation {
  summary: ChallengeSummary;
  byDepartment?: DepartmentParticipation[];
  minGroupSize?: number;
}
export interface ChallengeStandings {
  teams: { rank: number; teamId: string; name: string; members: number; averageCompletion: number }[];
  hiddenTeams: number;
  minTeamSize: number;
  participants: number;
}
export interface CorporateEmployee {
  id: string;
  displayName: string;
  department?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Their FitFlex member account, once linked; benefits only work for a linked employee. */
  userId?: string | null;
  status: string;
}
export interface CorporateAccount {
  id: string;
  companyName: string;
  status: string;
  seatLimit?: number;
  industrySector?: string;
}
export interface Paged<T> {
  items: T[];
  total: number;
  nextCursor: number | null;
}
export type B2BOrganizationStatus = 'pending' | 'active' | 'suspended' | 'inactive';
export interface B2BReference {
  organizationTypes: Record<string, string>;
  organizationStatuses: Record<B2BOrganizationStatus, B2BOrganizationStatus[]>;
  organizationUserRoles: string[];
  organizationUserStatuses: string[];
  permissions: string[];
  beneficiaryTypes: Record<string, string>;
  beneficiaryStatuses: Record<string, string[]>;
  industrySectors: Record<string, string>;
}
export interface B2BOrganization {
  id: string;
  organizationType: string;
  legalName: string;
  tradingName?: string | null;
  industrySector?: string | null;
  registrationNumber?: string | null;
  taxIdentificationNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: Record<string, string> | null;
  status: B2BOrganizationStatus;
  statusReason?: string | null;
  legacyCorporateId?: string | null;
  /** 'corporate' = mapped from a CorporateAccount, which owns `managedFields`. */
  source: 'b2b' | 'corporate';
  managedFields: string[];
  kyc: { supported: boolean; caseId: string | null; status: string | null };
  createdAt?: string;
}
export interface B2BOrganizationUser {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  permissions: string[];
  status: 'active' | 'suspended' | 'removed';
  source: 'b2b' | 'corporate_hr';
  readOnly: boolean;
  user: { displayName: string | null; email: string | null; userType: string } | null;
}
export interface B2BBeneficiary {
  id: string;
  organizationId: string;
  userId: string | null;
  displayName: string | null;
  externalReference: string | null;
  beneficiaryType: string;
  groupName: string | null;
  status: 'pending' | 'active' | 'suspended' | 'inactive';
  enrolledAt: string | null;
  source: 'b2b' | 'corporate_employee';
  readOnly: boolean;
}
export type B2BProgramStatus = 'draft' | 'pending' | 'active' | 'paused' | 'expired' | 'cancelled';
export interface B2BProgramReference {
  programTypes: Record<string, string>;
  programStatuses: Record<B2BProgramStatus, B2BProgramStatus[]>;
  benefitTypes: Record<string, { label: string; fulfilledBy: string; providerKeys: string[] }>;
  benefitStatuses: Record<string, string[]>;
  fundingTypes: Record<string, string>;
  /** Funding each benefit type may have; a per-use benefit is fully sponsored. Absent on an older API. */
  fundingByBenefitType?: Record<string, string[]>;
  usagePeriods: string[];
  eligibilityScopes: string[];
}
export interface B2BEligibility {
  scope: 'all' | 'groups' | 'selected';
  groups: string[];
  beneficiaryIds: string[];
  beneficiaryTypes: string[];
  enrolledOnOrBefore: string | null;
}
export interface B2BProgramInput {
  name: string;
  description?: string | null;
  programType?: string;
  startDate: string;
  endDate?: string | null;
  eligibility?: Partial<B2BEligibility>;
  budgetTzs?: number | null;
  /** Discount on the pass tier's price, basis points. FitFlex admins only. */
  discountBps?: number;
}
export interface B2BProgram extends B2BProgramInput {
  id: string;
  organizationId: string;
  programType: string;
  endDate: string | null;
  eligibility: B2BEligibility;
  status: B2BProgramStatus;
  effectiveStatus: B2BProgramStatus;
  statusReason?: string | null;
  budgetTzs: number | null;
  activatedAt?: string | null;
  createdAt?: string;
}
export interface B2BProviderRules {
  scope: 'all' | 'selected';
  gymIds?: string[];
  gymTiers?: string[];
  trainerIds?: string[];
  vendorIds?: string[];
  productCategories?: string[];
  challengeIds?: string[];
}
export interface B2BBenefitInput {
  name: string;
  description?: string | null;
  benefitType: string;
  fundingType: string;
  sponsorAmountTzs?: number | null;
  sponsorShareBps?: number | null;
  sponsorCapTzs?: number | null;
  beneficiaryAmountTzs?: number | null;
  usageLimit?: number | null;
  usagePeriod: string;
  periodSponsorCapTzs?: number | null;
  eligibility?: { groups: string[]; beneficiaryTypes: string[] } | null;
  providerRules?: B2BProviderRules;
  startDate?: string | null;
  endDate?: string | null;
  terms?: string | null;
  /** Sponsored pass only: the pass tier the member gets. */
  passTier?: string | null;
  /** Sponsored pass only, set by FitFlex: the fee per person per month, instead of the pass price less the programme's discount. */
  fixedFeeTzs?: number | null;
}
export interface B2BBenefit extends B2BBenefitInput {
  id: string;
  programId: string;
  status: 'draft' | 'active' | 'inactive';
  providerRules: B2BProviderRules;
  validity: { startDate: string; endDate: string | null };
  fundingSummary: string;
}
export interface B2BEligibilityRow {
  beneficiary: { id: string; displayName: string | null; userId: string | null; beneficiaryType: string; groupName: string | null; status: string; source: string };
  wouldBeEligible: boolean;
  reason: string | null;
  eligibleToday: boolean;
  todayReason: string | null;
}
export interface B2BUsageMoney { grossTzs: number; sponsorTzs: number; beneficiaryTzs: number }
export interface B2BUsageRow extends B2BUsageMoney { uses: number }
export interface B2BProgramUsage {
  program: { id: string; name: string; status: string; statusReason: string | null };
  budget: { budgetTzs: number | null; spentTzs: number; remainingTzs: number | null };
  totals: B2BUsageRow;
  byStatus: Record<string, number>;
  byBenefit: (B2BUsageRow & { benefitId: string; benefitName: string | null })[];
  byProvider: (B2BUsageRow & { providerType: string; providerId: string; providerName: string | null })[];
  byBeneficiary: (B2BUsageRow & { beneficiaryId: string; beneficiaryName: string | null })[];
}
export interface B2BConsumptionFilters {
  organizationId?: string; programId?: string; benefitId?: string; beneficiaryId?: string; userId?: string;
  providerId?: string; serviceType?: string; status?: string; from?: string; to?: string; limit?: number; cursor?: number | null;
}
export interface B2BConsumption extends B2BUsageMoney {
  id: string;
  organizationId: string; organizationName: string | null;
  programId: string; programName: string | null;
  benefitId: string; benefitName: string | null;
  beneficiaryId: string; beneficiaryName: string | null; userId: string | null;
  sourceType: string; sourceId: string; serviceType: string;
  providerType: string; providerId: string; providerName: string | null;
  consumedAt: string; businessDate: string; quantity: number;
  status: 'pending' | 'approved' | 'rejected' | 'reversed' | 'cancelled';
  rejectionReason: string | null;
  verifiedAt: string | null;
  reversedAt: string | null; reversedBy: string | null; reversalReason: string | null;
  rulesSnapshot: Record<string, unknown> | null;
}
export interface B2BSponsorInvoice {
  id: string;
  number: string;
  organizationId: string;
  programId: string | null;
  period: string;
  kind: 'prepaid' | 'usage' | 'fee' | 'credit_note' | 'debit_note';
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
  /** EAT day the invoice falls due; null for a credit. */
  dueDate?: string | null;
  amountPaidTzs?: number;
  /** What is still owed (negative: credit still to apply). */
  outstandingTzs?: number;
  overdue?: boolean;
  relatedInvoiceId?: string | null;
  reason?: string | null;
  createdBy?: string | null;
  /** VAT-inclusive. */
  totalTzs: number;
  vatRateBps: number | null;
  vatTzs: number | null;
  issuedAt: string | null;
  /** Who issued it (FitFlex admin views only). The same person can't record it as paid. */
  issuedBy?: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  voidReason: string | null;
}
export interface B2BSponsorInvoiceLine {
  id: string;
  kind: 'pass' | 'usage' | 'credit';
  description: string;
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  quantity: number;
  amountTzs: number;
}
export interface B2BPassEntitlement {
  id: string;
  beneficiaryId: string;
  beneficiaryName: string | null;
  period: string;
  passTier: string;
  feeTzs: number;
  sponsorTzs: number;
  memberTzs: number;
  status: 'invoiced' | 'scheduled' | 'awaiting_link' | 'awaiting_member' | 'active' | 'void';
}
export interface HrUser {
  id: string;
  displayName: string;
  email: string;
  accountStatus: 'active' | 'suspended';
  createdAt?: string;
}

// ── Communications ──────────────────────────────────────────────────────
export type CommsScope = 'owner' | 'admin';
export type CommsChannel = 'in_app' | 'push' | 'whatsapp' | 'sms';
export type CommsPurpose = 'promotion' | 'renewal' | 'payment' | 'announcement' | 'engagement' | 'general';
export type CommsStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'partially_failed' | 'failed' | 'cancelled';
export type CommsDeepLink = 'message' | 'membership' | 'renewal' | 'payment' | 'gym';
export type CommsLocale = 'en' | 'sw';
export interface CommsText { title: string; body: string; ctaLabel?: string }
/** The main language's text is inline; the other language, if written, is in `translations`. */
export interface CommsContent {
  title: string; body: string; ctaLabel?: string; deepLink?: CommsDeepLink;
  offerName?: string; discount?: string; amountTzs?: number;
  locale?: CommsLocale; translations?: Partial<Record<CommsLocale, CommsText>>;
}
export type CommsTemplateGroup = 'membership' | 'payment' | 'marketing' | 'engagement' | 'general';
export interface CommsTemplate {
  id: string; key: string; system: boolean; gymId: string | null; name: string;
  group: CommsTemplateGroup; purpose: CommsPurpose; category: string; deepLink: CommsDeepLink;
  bodies: Partial<Record<CommsLocale, CommsText>>; variables: string[]; status: string;
  basedOn: string | null; updatedAt: string | null;
  /** Only on a single template (GET …/templates/:id): whether it's approved for WhatsApp. */
  whatsapp?: { ready: boolean; byLocale: Partial<Record<CommsLocale, { ready: boolean; reason?: string }>> };
}
export interface CommsTemplateDraft {
  gymId?: string; name: string; purpose: CommsPurpose; group?: CommsTemplateGroup; deepLink?: CommsDeepLink;
  bodies: Partial<Record<CommsLocale, CommsText>>;
}
export type WhatsAppApproval = 'pending' | 'approved' | 'rejected' | 'paused';
export type WhatsAppCategory = 'utility' | 'marketing' | 'authentication';
export interface WhatsAppStatus {
  /** Never includes credentials — only which environment variables are missing. */
  provider: { name: string; configured: boolean; setup?: { reason: string; wanted: string | null; missing: string[] } };
  enabled: boolean; available: boolean;
  webhook: { path: string; secretSet: boolean };
  members: { withPhone: number; marketingOptedIn: number; optedOut: number };
  templates: Record<WhatsAppApproval, number>;
  last7Days: Record<string, number>;
}
export interface WhatsAppRegistryRow {
  id: string; provider: string; providerTemplateName: string; language: CommsLocale; category: WhatsAppCategory;
  variables: string[]; approvalStatus: WhatsAppApproval; lastSyncedAt: string | null; updatedAt: string | null;
}
export interface WhatsAppExpected {
  templateKey: string; providerTemplateName: string; language: CommsLocale; category: WhatsAppCategory;
  variables: string[]; body: string; registered: { id: string; approvalStatus: WhatsAppApproval } | null;
}
export interface WhatsAppRegistry { provider: string; templates: WhatsAppRegistryRow[]; expected: WhatsAppExpected[] }
export interface CommsTemplateValues { offerName?: string; discount?: string; amountTzs?: number }
export interface CommsTemplatePreview {
  senderName: string; sampleMember: string;
  byLocale: Partial<Record<CommsLocale, {
    in_app: { title: string; body: string; ctaLabel: string | null; deepLink: CommsDeepLink };
    push: { title: string; body: string; truncated: boolean };
  }>>;
  whatsapp: { ready: boolean; byLocale: Partial<Record<CommsLocale, { ready: boolean; reason?: string }>> };
  needsValues: string[];
}
/** Who a FitFlex message goes to; gym messages always go to members. */
export type CommsRecipients = 'members' | 'trainers';
export interface CommsAudience { preset?: string | null; filter?: unknown; recipients?: CommsRecipients }
export interface CommsDraft {
  gymId?: string; name?: string; purpose?: CommsPurpose; audience?: CommsAudience;
  content?: CommsContent; channels?: CommsChannel[]; templateId?: string | null;
}
export interface CommsCounts {
  targeted: number; queued: number; skipped: Record<string, number>;
  byChannel: Partial<Record<CommsChannel, { queued: number; skipped: number }>>;
}
export interface CommsCampaign {
  id: string; senderType: 'gym' | 'platform'; gymId: string | null; name: string; purpose: CommsPurpose;
  category: 'transactional' | 'marketing'; status: CommsStatus; audience?: CommsAudience; content?: CommsContent;
  channels: CommsChannel[]; scheduledAt: string | null; sentAt: string | null; createdAt: string;
  counts: CommsCounts | null; title?: string | null; preset?: string | null; recipients?: CommsRecipients; templateId?: string | null;
  /** History: who created it and its delivery numbers from the ledger. */
  createdByName?: string | null; stats?: CommsStats | null;
  template?: { id: string; key: string; name: string; system: boolean } | null;
}
export type CommsMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'clicked' | 'failed' | 'skipped';
export interface CommsTotals { pending: number; sent: number; delivered: number; opened: number; clicked: number; failed: number; skipped: number }
export interface CommsStats {
  targeted?: number; messages: number;
  byChannel: Partial<Record<CommsChannel, Partial<Record<CommsMessageStatus | 'opened', number>>>>;
  totals: CommsTotals;
}
export interface CommsMessage {
  id: string; campaignId: string | null; automationRunId: string | null; campaignName: string | null;
  senderType: 'gym' | 'platform'; gymId: string | null; memberId: string; memberName: string | null;
  channel: CommsChannel; category: 'transactional' | 'marketing'; messageType: CommsPurpose;
  title: string; body: string; locale: string | null; deepLink: string | null;
  status: CommsMessageStatus; skipReason: string | null; failureReason: string | null; failurePermanent: boolean; attempts: number;
  /** Who delivered it and their reference — never credentials. */
  provider: { name: 'inbox' | 'fcm' | 'whatsapp' | 'sms'; messageId: string | null; templateName?: string | null; language?: string | null; devices?: number | null; failedDevices?: number; errors?: string[]; parameters?: string[] };
  createdAt: string | null; sentAt: string | null; deliveredAt: string | null; openedAt: string | null;
  clickedAt: string | null; failedAt: string | null; nextAttemptAt: string | null;
  /** Only on a single message. */
  notificationId?: string | null;
  campaign?: { id: string; name: string; purpose: CommsPurpose; status: CommsStatus } | null;
  template?: { id: string; key: string | null; name: string | null; system: boolean } | null;
}
export type CommsOutcome = 'reached' | 'pending' | 'failed' | 'skipped';
/** Results. A null count means there's no data for it (shown as "—"), never zero. */
export interface CommsResults {
  period?: { from: string; to: string; days?: number };
  attribution: { model: 'last_touch'; clickWindowDays: number; openWindowDays: number };
  members: {
    recipients: number; sent: number; delivered: number | null; failed: number;
    opened: number; clicked: number; ctaCompleted?: number | null; renewed: number; paid: number;
  };
  revenue: { currency: 'TZS'; attributedTzs: number; payments: number };
  channels: Partial<Record<CommsChannel, { messages: number; sent: number; delivered: number | null; opened: number; clicked: number; failed: number; skipped: number; pending: number }>>;
  reasons?: { failed: Record<string, number>; skipped: Record<string, number> };
  conversions?: Array<{ paymentId: string; memberId: string; memberName: string | null; amountTzs: number; paidAt: string | null; via: 'click' | 'open'; touchAt: string | null; renewal: boolean }>;
  sources?: Array<{
    type: 'campaign' | 'automation'; id: string; name: string | null; purpose?: CommsPurpose | null; trigger?: CommsAutomationTrigger | null;
    offsetDays?: number | null; lastSentAt: string | null; recipients: number; sent: number; opened: number; clicked: number; paid: number; attributedTzs: number;
  }>;
}
export type CommsAutomationTrigger = 'membership_activated' | 'membership_expiring' | 'membership_expired' | 'payment_failed' | 'member_inactive';
export interface CommsAutomation {
  id: string; gymId: string; name: string; trigger: CommsAutomationTrigger; offsetDays: number;
  conditions: Record<string, unknown> | null; channels: CommsChannel[];
  /** 'paused' = stopped by the engine; see pausedReason. */
  status: 'enabled' | 'disabled' | 'paused'; pausedReason: string | null;
  template: { id: string; key: string | null; name: string | null; system: boolean; purpose: CommsPurpose | null } | null;
  lastRunAt: string | null; updatedAt: string | null;
  stats?: { fired: number; skipped: number; messages: number; reached: number; failed: number; opened: number };
}
export interface CommsAutomationRun {
  id: string; memberId: string; memberName: string | null; occurrenceKey: string; status: 'queued' | 'skipped';
  context: Record<string, unknown> | null; createdAt: string | null;
  channels: Array<{ id: string; channel: CommsChannel; status: CommsMessageStatus; reason: string | null }>;
}
export interface CommsTimelineItem {
  key: string; campaignId: string | null; automationRunId: string | null; campaignName: string | null;
  memberId: string; memberName: string | null; category: string; messageType: CommsPurpose;
  title: string; body: string; locale: string | null; createdAt: string | null; outcome: CommsOutcome; channels: CommsMessage[];
}
export interface CommsRecipient { memberId: string; memberName: string | null; outcome: CommsOutcome; channels: CommsMessage[] }
export interface CommsHistoryFilters {
  memberId?: string; campaignId?: string; channel?: string; category?: string; messageType?: string;
  status?: string; from?: string; to?: string; search?: string; gymId?: string; cursor?: string; limit?: number;
}
export interface CommsOverview {
  senderType: 'gym' | 'platform'; members: number | null;
  /** FitFlex only: active trainers FitFlex can message. */
  trainers?: number | null;
  campaigns: Partial<Record<CommsStatus, number>>;
  recent: CommsCampaign[]; channels: Record<CommsChannel, boolean>;
  limits: { largeSendThreshold: number; marketingWeeklyCap: number };
}
export interface CommsCatalog {
  scope: 'gym' | 'platform' | 'trainers';
  presets: Array<{ key: string; filter: unknown }>;
  fields: Array<{ key: string; type: string; ops: string[]; values?: string[] }>;
}
export interface CommsAudiencePreview {
  count: number; category: string;
  channels: Record<CommsChannel, { eligible: number; excluded: Record<string, number> }>;
  sample: Array<{ id: string; displayName: string | null; status: string }>;
}
export interface CommsPreview {
  category: string; counts: CommsCounts; largeSendThreshold: number;
  example: { memberName: string | null; title: string; body: string; ctaLabel: string | null; deepLink: CommsDeepLink } | null;
  /** `empty_value`: placeholder `variable` is blank for `count` of `of` recipients. */
  warnings: Array<{ code: string; count?: number; channel?: CommsChannel; variable?: string; of?: number }>;
}

// ── Partner KYC / KYB ────────────────────────────────────────────────────
export type KycPartnerType = 'gym_owner' | 'trainer' | 'vendor' | 'corporate';
export type KycCaseStatus = 'draft' | 'submitted' | 'in_review' | 'info_requested' | 'approved' | 'rejected' | 'suspended';
export type KycDecision = 'approve' | 'reject' | 'request_info' | 'suspend' | 'reinstate' | 'reopen';
export type KycItemStatus = 'complete' | 'submitted' | 'missing' | 'incomplete' | 'file_missing' | 'rejected' | 'expired' | 'failed' | 'mismatch';

export interface KycCaseRow {
  id: string;
  partnerType: KycPartnerType;
  subjectId: string;
  partnerName: string | null;
  legalName: string | null;
  status: KycCaseStatus;
  tier: number;
  round: number;
  submittedAt: string | null;
  updatedAt: string;
  createdAt: string;
  /** Uploaded documents waiting for review (e.g. renewals on an approved case). */
  documentsToReview?: number;
}

export interface KycAddress { line1?: string; line2?: string; city?: string; region?: string; country?: string; postalCode?: string }

export interface KycCase {
  id: string;
  partnerType: KycPartnerType;
  userId: string | null;
  corporateId: string | null;
  status: KycCaseStatus;
  tier: number;
  round: number;
  legalName: string | null;
  tradingName: string | null;
  entityType: string | null;
  registrationNumber: string | null;
  registrationAuthority: string | null;
  incorporatedOn: string | null;
  registeredAddress: KycAddress | null;
  businessActivity: string | null;
  tin: string | null;
  submittedAt: string | null;
  reviewerId: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  reverifyAt: string | null;
  updatedAt: string;
}

export interface KycPerson {
  id: string;
  role: string;
  fullName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  idType: string | null;
  idNumber: string | null;
  idExpiresOn: string | null;
  phone: string | null;
  email: string | null;
  address: KycAddress | null;
  position: string | null;
  relationship: string | null;
  authority: string | null;
  ownershipPct: number | null;
  status: string;
}

export interface KycDocument {
  id: string;
  requirementKey: string;
  docType: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'superseded';
  hasFile: boolean;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  documentNumber: string | null;
  issuer: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  details: Record<string, unknown>;
  reviewNote: string | null;
  reviewedAt: string | null;
  supersedesId: string | null;
  round: number;
  createdAt: string;
}

export interface KycSettlementAccount {
  id: string;
  method: 'bank' | 'mobile_money';
  provider: string;
  accountName: string;
  accountNumber: string;
  branch: string | null;
  currency: string;
  status: 'pending_verification' | 'verified' | 'rejected' | 'disabled';
  isPrimary: boolean;
  createdAt: string;
}

export interface KycCheck {
  id: string;
  checkType: string;
  targetType: string;
  targetId: string | null;
  method: string;
  provider: string | null;
  result: 'pending' | 'passed' | 'failed' | 'inconclusive';
  evidence: Record<string, unknown>;
  note: string | null;
  performedAt: string | null;
  createdAt: string;
}

export interface KycEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  targetType: string | null;
  targetId: string | null;
  actorId: string | null;
  actorRole: string | null;
  reasonCode: string | null;
  note: string | null;
  data: Record<string, unknown>;
  at: string;
}

export interface KycChecklistItem {
  key: string;
  by: 'partner' | 'reviewer';
  status: KycItemStatus;
  gymId?: string;
  gymName?: string;
  requirementKey?: string;
  /** Collected if given, never required (e.g. a vendor's business licence). */
  optional?: boolean;
  missingFields?: string[];
  note?: string | null;
  expiresOn?: string | null;
  score?: number;
  maxScore?: number | null;
  gymTier?: string | null;
  vettedTier?: string;
  expectedIdType?: string;
}

export interface KycChecklist {
  partnerType: KycPartnerType;
  tier: number;
  sections: Array<{ key: string; items: KycChecklistItem[] }>;
  missing: string[];
  awaitingReview: string[];
  readyToSubmit: boolean;
  complete: boolean;
}

export interface KycCaseDetail {
  partnerType: KycPartnerType;
  case: KycCase;
  people: KycPerson[];
  documents: KycDocument[];
  settlementAccounts: KycSettlementAccount[];
  checklist: KycChecklist;
  checks: KycCheck[];
  agreements: Array<{ id: string; agreementType: string; version: string; status: string; acceptedAt: string; acceptedIp?: string | null; acceptedUserAgent?: string | null }>;
  events: KycEvent[];
}

// ─── Gym settlements ───
export type SettlementMode = 'live' | 'shadow';
export type GymSettlementStatus = 'draft' | 'submitted' | 'approved' | 'payable' | 'paid' | 'voided';
export type SettlementStep = 'submit' | 'reject' | 'approve' | 'hold' | 'release' | 'payable' | 'pay' | 'void-request' | 'void-request/cancel' | 'void';

export interface SettlementRunException { subscriptionId: string; memberId: string; reason: string; missing?: string[] }

export interface SettlementRun {
  id: string;
  mode: SettlementMode;
  periodStartDate: string;
  periodEndDate: string;
  status: 'draft' | 'locked' | 'failed';
  engineVersion: string;
  error?: string | null;
  createdAt?: string;
  lockedAt?: string | null;
  configurationSnapshot?: {
    stats?: { candidateCycles: number; settledCycles: number; skippedCycles: number; statements: number; b2bCycles: number; payableVisits: number; totalPreliminaryTzs: number; totalFinalTzs: number };
    exceptions?: SettlementRunException[];
  } | null;
}

export interface GymSettlement {
  id: string;
  runId: string;
  mode: SettlementMode;
  gymId: string;
  gymName: string | null;
  periodStartDate: string;
  periodEndDate: string;
  memberCycleCount: number;
  qualifyingVisitCount: number;
  heldVisitCount: number;
  preliminaryTzs: number;
  networkAdjustmentTzs: number;
  adjustmentsTzs: number;
  carryForwardTzs: number;
  finalNetTzs: number;
  status: GymSettlementStatus;
  holdReason?: string | null;
  rejectReason?: string | null;
  voidReason?: string | null;
  voidedAt?: string | null;
  /** Someone has asked for this statement to be voided; a different person has to confirm. */
  voidRequestedBy?: string | null;
  voidRequestedAt?: string | null;
  voidRequestReason?: string | null;
  destinationSnapshot?: { accountLast4?: string; method?: string; provider?: string; accountName?: string } | null;
  submittedBy?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  paymentReference?: string | null;
  receiptUrl?: string | null;
}

export interface GymSettlementLine {
  id: string;
  memberId: string;
  member: { publicId: string | null; displayName: string | null } | null;
  fundingType: 'platform_pass' | 'b2b_benefit' | null;
  qualifyingVisitCount: number;
  heldVisitCount: number;
  bracket: string | null;
  rawPreliminaryTzs: number;
  preliminaryTzs: number;
  monotonicGuardApplied: boolean;
  networkAdjustmentTzs: number;
  finalTzs: number;
  rateCardSnapshot?: { wholesaleDailyTzs?: number; wholesaleWeeklyTzs?: number; wholesaleMonthlyTzs?: number } | null;
}

export interface SettlementVisit {
  id: string;
  lineId: string | null;
  checkinId: string;
  businessDate: string | null;
  outcome: string;
  eligibility: string;
  allowanceSlot: number | null;
}

export interface SettlementAdjustment {
  id: string;
  gymSettlementId: string;
  amountTzs: number;
  type: 'correction' | 'clawback' | 'manual' | 'carry_forward';
  reason: string;
  status: 'proposed' | 'applied' | 'rejected' | 'voided';
  createdBy: string;
  createdAt?: string;
  appliedAt?: string | null;
  rejectReason?: string | null;
}

export interface GymSettlementDetail {
  statement: GymSettlement;
  lines: GymSettlementLine[];
  visits: SettlementVisit[];
  adjustments: SettlementAdjustment[];
}

// ─── Settlement configuration ───
export type SettlementConfigKind = 'pass-tiers' | 'rules' | 'rate-cards';
export type SettlementConfigStatus = 'draft' | 'active' | 'rejected';
export type SettlementRuleScope = 'global' | 'pass_tier' | 'gym_tier' | 'gym';

interface SettlementConfigRow {
  id: string;
  version: number;
  status: SettlementConfigStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reason: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  createdAt?: string;
}

export interface PassTierVersion extends SettlementConfigRow { tierKey: string; priceTzs: number; visitAllowance: number }

export interface SettlementRuleValues {
  networkPayoutBps: number | null;
  dailyDiscountBps: number | null; weeklyDiscountBps: number | null; monthlyDiscountBps: number | null;
  dailyCeilingTzs: number | null; weeklyCeilingTzs: number | null; monthlyCeilingTzs: number | null;
}

export interface SettlementRule extends SettlementConfigRow, SettlementRuleValues {
  name: string | null;
  scopeType: SettlementRuleScope | 'special_contract';
  scopeId: string | null;
}

export interface GymRateCard extends SettlementConfigRow, Omit<SettlementRuleValues, 'networkPayoutBps'> {
  gymId: string;
  gymTier: string;
  retailDailyTzs: number; retailWeeklyTzs: number; retailMonthlyTzs: number;
}

export interface SettlementConfig { passTierVersions: PassTierVersion[]; rules: SettlementRule[]; rateCards: GymRateCard[] }

// ─── Gym settlements, as the gym's owner sees them ───
export type OwnerStatementStatus = 'preparing' | 'in_review' | 'approved' | 'payment_due' | 'paid';

export interface OwnerStatement {
  id: string;
  gymId: string;
  gymName: string | null;
  periodStartDate: string;
  periodEndDate: string;
  status: OwnerStatementStatus;
  onHold: boolean;
  members: number;
  visits: number;
  earnedTzs: number;
  networkAdjustmentTzs: number;
  adjustmentsTzs: number;
  carriedForwardTzs: number;
  payableTzs: number;
  paidAt: string | null;
  paymentReference: string | null;
  receiptUrl: string | null;
  payoutAccountLast4: string | null;
}

export interface OwnerStatementLine {
  memberCode: string | null;
  funding: 'pass' | 'sponsored';
  visits: number;
  visitDates: string[];
  bracket: string | null;
  rates: { dailyTzs: number; weeklyTzs: number; monthlyTzs: number } | null;
  earnedTzs: number;
  networkAdjustmentTzs: number;
  finalTzs: number;
}

export interface OwnerStatementDetail {
  statement: OwnerStatement;
  lines: OwnerStatementLine[];
  adjustments: Array<{ amountTzs: number; type: string; reason: string; appliedAt: string | null }>;
}

export interface SettlementClawbackItem {
  gymId: string;
  gymName: string | null;
  memberCycleSettlementId: string;
  amountTzs: number;
  type: 'clawback' | 'correction';
  reason: string;
}

export interface SettlementClawbacks {
  raised: SettlementClawbackItem[];
  pending: SettlementClawbackItem[];
  skipped: Array<{ memberCycleSettlementId: string; memberId: string; reason: string }>;
}

// ── B2B billing and financial management (Phase 5) ──
export type B2BAging = Record<'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'over90', number>;
export interface B2BBalances {
  outstandingTzs: number; overdueTzs: number; seatBillsTzs: number; creditTzs: number; balanceTzs: number;
  unallocatedPaymentsTzs: number; unappliedCreditNotesTzs: number; aging: B2BAging; asOf: string;
}
export interface B2BAgreement {
  id: string; organizationId: string; reference: string; contractReference: string | null;
  status: 'draft' | 'active' | 'ended'; effectiveFrom: string; effectiveTo: string | null;
  billingCycle: string; currency: string; prepaidTermsDays: number; usageTermsDays: number;
  platformFeeTzs: number | null; vatRateBps: number | null; notes: string | null;
  /** The organisation's agreed fee per person per month for a sponsored pass, by tier. */
  passRates?: Record<string, number> | null;
  /** Who drafted it, who last changed it and everyone who ever edited it: none of them can activate it. */
  createdBy?: string | null; updatedBy?: string | null; editors?: string[] | null;
  /** Sent back as `version` when activating. */
  updatedAt?: string | null;
}
export interface B2BAgreementInput {
  effectiveFrom: string; effectiveTo?: string | null; prepaidTermsDays?: number; usageTermsDays?: number;
  platformFeeTzs?: number | null; vatRateBps?: number | null; contractReference?: string | null;
  passRates?: Record<string, number> | null;
}
export interface B2BBillingAccount {
  organizationId: string; contactName: string | null; email: string | null; phone: string | null;
  taxIdentificationNumber: string | null; registrationNumber: string | null; currency: string;
  source: 'billing_account' | 'corporate_account' | 'organization';
  onHold?: boolean; holdReason?: string | null;
}
export interface B2BAnalyticsQuery { period?: string; from?: string; to?: string; programId?: string; benefitId?: string; providerId?: string; group?: string }
export interface B2BPeriod { preset: string; from: string; to: string; days: number; previous: { from: string; to: string }; bucket: 'day' | 'week' | 'month'; timezone: string }
export interface B2BUsageMoney { uses: number; grossTzs: number; sponsorTzs: number; beneficiaryTzs: number }
export interface B2BDashboard {
  organization: { id: string; name: string }; period: B2BPeriod; freshness: string; generatedAt: string;
  beneficiaries: { total: number; enrolled: number; pending: number; suspended: number; inactive: number; linkedToAccount: number; enrolledInPeriod: number; groups: string[] };
  participation: { activeBeneficiaries: number; previousActiveBeneficiaries: number; changePct: number | null; utilisationRatePct: number | null; inactiveBeneficiaries: number };
  usage: B2BUsageMoney & { passCheckins: number; sponsoredVisits: number; usesChangePct: number | null; averagePerActiveBeneficiary: number | null };
  spend: {
    sponsorPerUseTzs: number; sponsorPassFeesTzs: number; sponsorTotalTzs: number; memberPerUseTzs: number; memberPassSharesTzs: number; serviceValueTzs: number;
    passes: number; passesStarted: number; costPerActiveBeneficiaryTzs: number | null; costPerSponsoredVisitTzs: number | null;
  };
  benefits: { active: number; usedInPeriod: number; endingWithin30Days: number; total: number };
  providers: { used: number; top: Array<{ providerType: string; providerId: string; name: string | null; visits: number; uses: number; passCheckins: number; sponsorTzs: number }> };
  engagement: { peopleWithActivity: number; activities: number; workouts: number; steps: number; distanceKm: number; activeMinutes: number; gymCheckins: number; peopleInChallenges: number };
  trend: Array<{ bucket: string; uses: number; sponsorTzs: number; passCheckins: number; activities: number; activeBeneficiaries: number }>;
  billing?: { invoicedTzs: number; invoices: number; paidTzs: number; payments: number; outstandingTzs: number; overdueTzs: number; creditTzs: number; aging: B2BAging; asOf: string };
}
export interface B2BPersonRow {
  beneficiaryId: string; name: string | null; externalReference: string | null; group: string | null; beneficiaryType: string; status: string; enrolledAt: string | null;
  linkedToAccount: boolean; active: boolean; sponsoredUses: number; passCheckins: number; sponsorTzs: number; memberTzs: number; serviceValueTzs: number;
  gymCheckins: number; activities: number; workouts: number; steps: number; activeMinutes: number; lastActiveDay: string | null;
}
export interface B2BPersonDetail {
  period: B2BPeriod;
  beneficiary: { id: string; name: string | null; externalReference: string | null; group: string | null; beneficiaryType: string; status: string; enrolledAt: string | null; linkedToAccount: boolean };
  totals: B2BUsageMoney & { passCheckins: number; activities: number; otherGymVisits: number; capped: boolean };
  byBenefit: Array<B2BUsageMoney & { benefitId: string; benefitName: string | null }>;
  passes: Array<{ period: string; passTier: string; status: string; sponsorTzs: number; memberTzs: number; benefitName: string | null; startedAt: string | null }>;
  sponsoredUsage: Array<{ id: string; day: string; benefitName: string | null; serviceType: string; providerType: string; provider: string | null; quantity: number; serviceValueTzs: number; sponsorTzs: number; memberTzs: number }>;
  passCheckins: Array<{ id: string; day: string; gym: string | null; passTier: string | null; benefitName: string | null }>;
  otherGymVisits: Array<{ id: string; day: string; gym: string | null }>;
  activities: Array<{ id: string; day: string; type: string; source: string; durationMinutes: number | null; distanceKm: number | null; steps: number | null; activeMinutes: number | null; intensity: string | null; gym: string | null }>;
  challenges: Array<{ id: string; name: string; type: string; target: number; endDate: string; phase: string; progress: number; completed: boolean }>;
  notShown: string[];
}
export interface B2BBenefitAnalytics {
  benefitId: string; name: string; benefitType: string; status: string; programId: string; programName: string | null; fundingType: string;
  usageLimit: number | null; usagePeriod: string | null; eligible: number; users: number; uses: number; reachPct: number | null; averageUsesPerUser: number | null;
  serviceValueTzs: number; sponsorTzs: number; memberTzs: number; passes: number | null; passesStarted: number | null;
  allowance: { windowStart: string; windowEnd: string | null; consumedUnits: number; availableUnits: number; usedPct: number | null; peopleAtLimit: number; peopleNearLimit: number } | null;
}
export interface B2BProgramAnalytics {
  programId: string; name: string; programType: string; status: string; startDate: string; endDate: string | null; benefits: number; activeBenefits: number;
  eligible: number; activeBeneficiaries: number; participationPct: number | null; uses: number; passCheckins: number; serviceValueTzs: number;
  sponsorPerUseTzs: number; sponsorPassFeesTzs: number; sponsorTotalTzs: number; memberTzs: number;
  budget: { budgetTzs: number | null; committedTzs: number; remainingTzs: number | null; usedPct: number | null };
}
export interface B2BProviderAnalytics {
  providerType: string; providerId: string; name: string | null; location: string | null; visits: number; uses: number; passCheckins: number; people: number; repeatPeople: number;
  serviceValueTzs: number; sponsorTzs: number; memberTzs: number; settlement?: { perUseVisits: number; inLiveSettlement: number; notYetSettled: number };
}
export interface B2BFinanceAnalytics {
  period: B2BPeriod; billing: NonNullable<B2BDashboard['billing']>; note: string;
  months: Array<{ month: string; invoicedTzs: number; creditNotesTzs: number; collectedTzs: number; sponsorPerUseTzs: number; sponsorPassFeesTzs: number; memberTzs: number; serviceValueTzs: number }>;
}
export interface B2BAnalyticsOverview {
  period: B2BPeriod; generatedAt: string;
  organizations: { total: number; active: number; createdInPeriod: number; withUsage: number; byStatus: Array<{ status: string; count: number }>; byType: Array<{ organizationType: string; count: number }> };
  beneficiaries: { total: number; enrolled: number; linkedToAccount: number; active: number; utilisationRatePct: number | null };
  usage: B2BUsageMoney & { passCheckins: number; usesChangePct: number | null };
  billing: { invoicedTzs: number; collectedTzs: number };
  topOrganizations: Array<B2BUsageMoney & { organizationId: string; name: string | null; passCheckins: number; activeBeneficiaries: number }>;
  topProviders: Array<B2BUsageMoney & { providerType: string; providerId: string; name: string | null; people: number; organizations: number }>;
  trend: Array<{ bucket: string; uses: number; sponsorTzs: number }>;
}
export interface B2BProgramLifecycle {
  programId: string; status: string; endDate: string | null; daysLeft: number | null; endingSoon: boolean; canRenew: boolean;
  renewal: { programId: string; status: string; startDate: string; endDate: string | null } | null; renewalOf: string | null;
}
export interface B2BImportResult {
  dryRun?: boolean; importId?: string; total: number; enrolled: number; invited: number; unchanged: number; rejected: number; withoutEmail: number; withoutPhone: number; emailConfigured: boolean; smsConfigured: boolean;
  /** False when FitFlex can't send email codes, so email-only people can't confirm their email. Absent on older backends. */
  emailCodesAvailable?: boolean;
  problems: Array<{ line: number; name: string | null; contact: string | null; problem: string }>;
}
export interface B2BBeneficiaryInvite {
  id: string; organizationId: string; email: string | null; phone: string | null; displayName: string | null; externalReference: string | null; groupName: string | null;
  beneficiaryType: string; status: 'invited' | 'enrolled' | 'cancelled'; invitedAt: string; emailsSent: number; lastEmailAt: string | null; nextEmailAt: string | null;
  emailFailures: number; lastEmailError: string | null; smsSent: number; lastSmsAt: string | null; nextSmsAt: string | null; smsFailures: number; canResend: boolean;
}
export interface B2BJobRun {
  id: string; job: string; status: 'running' | 'ok' | 'failed'; slot: string | null; trigger: 'schedule' | 'catch_up' | 'retry' | 'manual' | null; triggeredBy: string | null;
  attempt: number; startedAt: string; finishedAt: string | null; processed: number | null; succeeded: number | null; failed: number | null; error: string | null;
}
export interface B2BJobStatus {
  name: string; title: string; description: string | null; domain: 'finance' | 'operations'; schedule: { type: 'daily'; utc: string } | { type: 'every'; minutes: number };
  state: 'ok' | 'running' | 'delayed' | 'retrying' | 'failed' | 'paused'; paused: boolean; pauseReason: string | null; currentSlotDone: boolean | null; attemptsThisSlot: number;
  nextDue: string; lastSuccessAt: string | null;
  lastRun: { id: string; status: string; trigger: string | null; startedAt: string; finishedAt: string | null; processed: number | null; succeeded: number | null; failed: number | null; error: string | null } | null;
}
export interface B2BOpsException {
  id: string; type: string; severity: 'low' | 'medium' | 'high'; status: 'open' | 'investigating' | 'retrying' | 'resolved' | 'ignored' | 'permanently_failed'; title: string;
  job: string | null; entityType: string | null; entityId: string | null; organizationId: string | null; detail: Record<string, unknown> | null;
  occurrences: number; retryCount: number; detectedAt: string; lastSeenAt: string; resolvedAt: string | null; resolution: string | null; resolvedBy: string | null;
}
export interface B2BOpsOverview {
  generatedAt: string;
  jobs: { total: number; ok: number; running: number; delayed: number; retrying: number; failed: number; paused: number; items: B2BJobStatus[] };
  exceptions: { live: number; bySeverity: Record<string, number>; byStatus: Record<string, number>; oldestDetectedAt: string | null; mostUrgent: B2BOpsException[] };
  /** Whether staff are emailed about exceptions. Absent on older servers. */
  alerts?: { recipients: number; emailConfigured: boolean; active: boolean } | null;
  pending: {
    billing: { draftInvoices: number; draftsOlderThan7Days: number; paymentNoticesToCheck: number; overdueInvoices: number; organizationsOnHold: number; paymentsNotFullyApplied: number };
    usage: { holdsOlderThan1Hour: number; passesAwaitingMemberPayment: number; passesAwaitingAccountLink: number };
    people: { beneficiariesPending: number; employeesNotLinked: number; invitesWaiting?: number; invitesNotDelivered?: number; importsWithRejectedRowsLast7Days?: number };
    programmes?: { renewalDraftsToReview: number; endingWithin30Days: number };
  };
}
export interface B2BDataQuality { checkedAt: string; issues: number; checks: Array<{ key: string; severity: 'low' | 'medium' | 'high'; title: string; count: number; examples: string[] }> }
export interface B2BPaymentInstructions {
  bankName: string | null; accountName: string | null; accountNumber: string | null; branch: string | null; swiftCode: string | null;
  lipaNamba: string | null; lipaNambaName: string | null; notes: string | null; updatedAt?: string | null;
}
/** A change to the payment details asked for by one admin, waiting for a different admin to confirm it. */
export interface B2BPaymentInstructionsChange {
  /** Names this request; confirm and cancel send it back. */
  changeId: string;
  instructions: Pick<B2BPaymentInstructions, 'bankName' | 'accountName' | 'accountNumber' | 'branch' | 'swiftCode' | 'lipaNamba' | 'lipaNambaName' | 'notes'>;
  requestedBy: string; requestedAt: string;
}
export interface B2BAdminPaymentInstructions {
  instructions: B2BPaymentInstructions; configured: boolean; pendingChange: B2BPaymentInstructionsChange | null;
}
export interface B2BPaymentNotice {
  id: string; organizationId: string; organizationName?: string | null; amountTzs: number; method: string; reference: string; paidOn: string;
  invoiceIds: string[]; invoices?: Array<{ id: string; number: string; totalTzs: number; outstandingTzs: number; status: string; dueDate: string | null }>;
  note: string | null; proofUrl: string | null; status: 'submitted' | 'confirmed' | 'rejected' | 'withdrawn';
  submittedAt: string; decidedAt: string | null; decisionNote: string | null; paymentId: string | null;
}
export interface B2BPaymentNoticeInput {
  amountTzs: number; method: string; reference: string; paidOn?: string; invoiceIds?: string[]; note?: string; proofUrl?: string;
}
export interface B2BOrgPaying {
  instructions: B2BPaymentInstructions; configured: boolean; canPay: boolean; onHold: boolean; holdReason: string | null; notices: B2BPaymentNotice[];
}
export interface B2BCollectionsQueue {
  today: string;
  notices: B2BPaymentNotice[];
  overdue: Array<{
    id: string; number: string; kind: string; organizationId: string; organizationName: string | null; dueDate: string; daysOverdue: number;
    totalTzs: number; outstandingTzs: number; lastReminder: { stage: string; sentAt: string; count: number } | null; onHold: boolean;
  }>;
  onHold: Array<{ organizationId: string; organizationName: string | null; holdReason: string | null; holdAt: string | null }>;
  totals: { noticesToCheck: number; overdueInvoices: number; overdueTzs: number; organizationsOnHold: number };
}
export interface B2BPayment {
  id: string; number: string; organizationId: string; amountTzs: number; method: string; reference: string;
  receivedAt: string; status: 'received' | 'reversed'; allocatedTzs: number; unallocatedTzs: number;
  reversalReason?: string | null; note?: string | null; recordedBy?: string | null;
}
export interface B2BPaymentInput {
  amountTzs: number; method: string; reference: string; receivedAt?: string; note?: string;
  autoAllocate?: boolean; allocations?: Array<{ invoiceId: string; amountTzs: number }>;
}
export interface B2BStatementEntry {
  at: string; day: string; type: 'invoice' | 'credit_note' | 'debit_note' | 'payment' | 'payment_reversal' | 'seat_bill' | 'seat_bill_payment';
  reference: string; description: string; status: string; dueDate?: string | null; invoiceId?: string;
  chargeTzs: number; creditTzs: number; balanceTzs: number;
}
export interface B2BStatement extends B2BBalances {
  organization: { id: string; name: string }; from: string | null; to: string | null;
  openingBalanceTzs: number; closingBalanceTzs: number; entries: B2BStatementEntry[];
  totals: { chargesTzs: number; creditsTzs: number };
}
export interface B2BInvoiceSettlement {
  id: string; amountTzs: number; createdAt: string; paymentNumber: string | null; method: string | null;
  reference: string | null; receivedAt: string | null; creditNoteNumber: string | null;
}
export interface B2BInvoiceDetail {
  invoice: B2BSponsorInvoice;
  lines: Array<{ kind: string; description?: string | null; beneficiaryName?: string | null; quantity: number; amountTzs: number; benefitId?: string | null }>;
  settlements: B2BInvoiceSettlement[];
  relatedInvoice: { id: string; number: string } | null;
  notes: Array<{ id: string; number: string; kind: string; status: string; totalTzs: number; reason: string | null }>;
}
export interface B2BOrgBilling extends B2BBalances {
  organization: { id: string; name: string };
  account: B2BBillingAccount;
  terms: { reference: string | null; contractReference?: string | null; billingCycle: string; prepaidTermsDays: number; usageTermsDays: number; platformFeeTzs: number | null; passRates?: Record<string, number> | null; effectiveFrom?: string; effectiveTo?: string | null };
  recentInvoices: B2BSponsorInvoice[];
}
export interface B2BBillingDashboard {
  asOf: string;
  totals: { invoicedTzs: number; creditNotesTzs: number; collectedTzs: number; outstandingTzs: number; overdueTzs: number; creditTzs: number };
  aging: B2BAging;
  organizations: Array<{ organizationId: string; name: string; status: string; invoicedTzs: number; creditNotesTzs: number; collectedTzs: number; outstandingTzs: number; overdueTzs: number; creditTzs: number; aging: B2BAging }>;
  currentPeriod: { period: string; draftInvoices: number; draftTotalTzs: number };
  billedAgainstProviders: {
    period: string; billedTzs: number; differenceTzs: number; note: string;
    providerObligations: { gymVisitsTzs: number; sponsoredPassesTzs: number; trainerSessionsTzs: number; totalTzs: number };
  };
}
export interface B2BReconciliation {
  invoice: B2BSponsorInvoice;
  lines: Array<{
    lineId: string; kind: string; description: string; amountTzs: number; active: boolean;
    consumption: { id: string; status: string; businessDate: string; sourceType: string; sourceId: string; providerType: string; providerId: string; grossTzs: number; sponsorTzs: number; beneficiaryTzs: number } | null;
    entitlement: { id: string; status: string; passTier: string; listPriceTzs: number; discountBps: number; feeTzs: number; priceBasis?: string | null; sponsorTzs: number; memberTzs: number; subscriptionId: string | null } | null;
    provider: { outcome?: string; statementId?: string | null; statementStatus?: string | null; gymsOwedTzs?: number; collectedForPassTzs?: number } | null;
  }>;
  settlements: B2BInvoiceSettlement[];
  checks: { linesAddUp: boolean; linesTotalTzs: number; invoiceTotalTzs: number; usageMatchesLedger: boolean; reversedSinceInvoiced: string[]; amountPaidTzs: number; outstandingTzs: number };
}

export type RecoveryStatus = 'open' | 'cancelled' | 'refused' | 'completed';
export type RecoveryFilter = RecoveryStatus | 'all';
export type RecoveryRefusalReason = 'evidence_insufficient' | 'details_do_not_match' | 'other';
export type RecoveryRow = {
  id: string; status: RecoveryStatus; tier: string | null; claimedName: string; accountName: string | null;
  newIdentifierType: 'phone' | 'email'; createdAt: string; waitUntil: string; ready: boolean; answered: boolean;
};
export type RecoveryDetail = {
  recovery: {
    id: string; status: RecoveryStatus; tier: string | null; claimedName: string;
    oldIdentifier: { type: string; masked: string };
    newIdentifier: { type: 'phone' | 'email'; value: string };
    evidence: { homeGym?: string; plan?: string; lastCheckin?: string; paymentRef?: string; other?: string };
    createdAt: string; waitUntil: string; ready: boolean;
    cancelledBy: string | null; decisionReason: string | null; decisionNote: string | null;
    decidedBy: string | null; decidedAt: string | null; requestIp: string | null;
  };
  account: {
    registeredAt: string | null;
    personas: Array<{ id: string; userType: string; displayName: string | null; approvalStatus: string | null }>;
    subscription: { type: string | null; tier: string | null; status: string | null; startedAt: string | null; expiresAt: string | null; homeGym: string | null; paymentRef: string | null } | null;
    lastCheckins: Array<{ at: string; gym: string | null }>;
    payments: Array<{ reference: string; amountTzs: number; status: string; at: string }>;
    identifiers: Array<{ type: string; masked: string; status: string; verified: boolean }>;
  };
  events: Array<{ kind: string; actor: string | null; detail: Record<string, unknown> | null; createdAt: string }>;
};

// ─── Exercise library ───
export interface ExerciseTranslation { name?: string; description?: string; instructions?: string[] }
export interface ExerciseInput {
  name: string;
  description?: string;
  category: string;
  targetAreas: string[];
  secondaryAreas?: string[];
  movementPattern?: string | null;
  difficulty: string;
  equipment: string[];
  environment: string[];
  suitableGoals: string[];
  defaultSets: number;
  /** Counted in reps, or timed in seconds — one or the other. */
  defaultReps?: number | null;
  defaultDuration?: number | null;
  restSeconds: number;
  tracksWeight?: boolean;
  instructions: string[];
  alternatives?: string[];
  active?: boolean;
  i18n?: { sw?: ExerciseTranslation };
}
export interface Exercise extends ExerciseInput {
  id: string;
  active: boolean;
  alternatives: string[];
  secondaryAreas: string[];
  /** `builtin` ships with FitFlex, `edited` is a built-in FitFlex changed, `custom` was added here. */
  source: 'builtin' | 'edited' | 'custom';
  updatedAt?: string | null;
}
/** One row of an imported exercise file and what happens to it. */
export interface ExerciseImportRow {
  /** The line of the file the row starts on. */
  line: number;
  id: string | null;
  name: string;
  action: 'create' | 'update' | 'unchanged' | 'error';
  /** For an update: the fields that change. */
  changed?: string[];
  error?: 'invalid_exercise' | 'unknown_id' | 'listed_twice';
  field?: string;
}
export interface ExerciseImportResult {
  applied: boolean;
  summary: { create: number; update: number; unchanged: number; errors: number };
  rows: ExerciseImportRow[];
  unknownColumns: string[];
}
export interface ExerciseOptions {
  categories: string[];
  targetAreaGroups: { id: string; areas: string[] }[];
  movementPatterns: string[];
  difficulties: string[];
  equipment: string[];
  environments: string[];
  goals: string[];
}
