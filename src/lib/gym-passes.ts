// Custom gym passes (backend functions#355, docs/custom-gym-passes-api.md): owner API client and helpers.
// Every route answers 404 { error: 'feature_disabled' } while the server's GYM_CUSTOM_PASSES flag is off.
// Contact values arrive MASKED from the server and are shown as given; nothing here tries to unmask them.
import { ApiError, request, API_BASE } from './api';
import type { MessageKey } from './i18n';

export type PassCategory = 'individual' | 'couples' | 'group';
export type DurationUnit = 'days' | 'weeks' | 'months';
export type PlanStatus = 'active' | 'inactive';
export type PurchaseStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled';

export interface PassPlan {
  id: string;
  gymId: string;
  name: string;
  description: string | null;
  category: PassCategory;
  durationValue: number;
  durationUnit: DurationUnit;
  beneficiaryLimit: number;
  priceTzs: number;
  currency: string;
  startPolicy?: string;
  terms: string | null;
  termsVersion?: number;
  status: PlanStatus;
  createdAt?: string;
  updatedAt?: string;
}

/** What the buyer saw and paid (the plan as it was at purchase). */
export interface PassSnapshot {
  name: string;
  description?: string | null;
  category: PassCategory;
  priceTzs: number;
  currency?: string;
  durationValue: number;
  durationUnit: DurationUnit;
  beneficiaryLimit: number;
}

export interface PassPlanInput {
  name: string;
  description: string | null;
  category: PassCategory;
  durationValue: number;
  durationUnit: DurationUnit;
  beneficiaryLimit: number;
  priceTzs: number;
  terms: string | null;
  status?: PlanStatus;
}

export interface PassSale {
  id: string;
  status: PurchaseStatus;
  plan: PassSnapshot;
  priceTzs: number;
  currency: string;
  purchaser: { id: string; displayName: string | null } | null;
  payment: { status: string; amountTzs: number; reference: string | null } | null;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt?: string;
  beneficiaryCounts?: { total: number; active: number; pending: number; suspended: number };
  slots?: { used: number; limit: number };
}

export type PersonStatus = 'awaiting_payment' | 'invited' | 'pending_registration' | 'active' | 'suspended' | 'removed';

export interface PassPerson {
  id: string;
  slot: number;
  isPurchaser: boolean;
  status: PersonStatus;
  userId: string | null;
  displayName: string | null;
  contactType: 'phone' | 'email' | null;
  /** Masked by the server until the person's first valid check-in. Show as given. */
  contact: string | null;
  subscriptionId: string | null;
  notifiedAt: string | null;
  notifiedVia: Array<'in_app' | 'whatsapp' | 'sms'>;
  claimedAt: string | null;
  removedAt: string | null;
  removedByRole: 'owner' | 'purchaser' | 'self' | 'erasure' | null;
  attendance?: { visits: number; lastVisitAt: string | null };
}

export interface PassMembership extends PassSale {
  beneficiaries: PassPerson[];
}

export interface PassVisit { id: string; gymId?: string; timestamp: string; method?: string; status?: string; businessDate?: string }

export interface PassSummary {
  gymId?: string;
  currency?: string;
  plans: { total: number; active: number };
  sales: { count: number; revenueTzs: number; pendingPayment: number };
  byCategory?: Record<string, { sales: number; revenueTzs: number; beneficiaries: number }>;
  beneficiaries: { active: number; pendingRegistration: number; suspended: number };
  memberships: { active: number; expired: number };
}

const g = (gymId: string) => `/owner/gyms/${encodeURIComponent(gymId)}`;
const qs = (q: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const body = (b: unknown) => ({ method: 'POST', body: JSON.stringify(b) });

export const gymPassesApi = {
  plans: (token: string, gymId: string) => request<{ plans: PassPlan[] }>(`${g(gymId)}/pass-plans`, {}, token),
  createPlan: (token: string, gymId: string, input: PassPlanInput) => request<{ plan: PassPlan }>(`${g(gymId)}/pass-plans`, body(input), token),
  updatePlan: (token: string, gymId: string, planId: string, input: Omit<PassPlanInput, 'status'>) =>
    request<{ plan: PassPlan }>(`${g(gymId)}/pass-plans/${encodeURIComponent(planId)}`, { method: 'PUT', body: JSON.stringify(input) }, token),
  setPlanStatus: (token: string, gymId: string, planId: string, status: PlanStatus) =>
    request<{ plan: PassPlan }>(`${g(gymId)}/pass-plans/${encodeURIComponent(planId)}/${status === 'active' ? 'activate' : 'deactivate'}`, { method: 'POST' }, token),
  sales: (token: string, gymId: string, q: { status?: string; before?: string; limit?: number } = {}) =>
    request<{ sales: PassSale[] }>(`${g(gymId)}/pass-sales${qs(q)}`, {}, token),
  summary: (token: string, gymId: string) => request<PassSummary>(`${g(gymId)}/pass-summary`, {}, token),
  memberships: (token: string, gymId: string, q: { state?: 'active' | 'expired'; before?: string; limit?: number } = {}) =>
    request<{ state: string; memberships: PassMembership[] }>(`${g(gymId)}/pass-memberships${qs(q)}`, {}, token),
  attendance: (token: string, gymId: string, purchaseId: string, beneficiaryId: string, limit = 50) =>
    request<{ beneficiaryId: string; visits: PassVisit[] }>(`${g(gymId)}/pass-purchases/${encodeURIComponent(purchaseId)}/beneficiaries/${encodeURIComponent(beneficiaryId)}/attendance${qs({ limit })}`, {}, token),
  personAction: (token: string, gymId: string, purchaseId: string, beneficiaryId: string, action: 'suspend' | 'resume' | 'remove') =>
    request<{ beneficiary: Partial<PassPerson> }>(`${g(gymId)}/pass-purchases/${encodeURIComponent(purchaseId)}/beneficiaries/${encodeURIComponent(beneficiaryId)}/${action}`, { method: 'POST' }, token),
  addPerson: (token: string, gymId: string, purchaseId: string, contact: { phone: string } | { email: string }) =>
    request<{ beneficiary: Partial<PassPerson> }>(`${g(gymId)}/pass-purchases/${encodeURIComponent(purchaseId)}/beneficiaries`, body(contact), token),
};

/** The server's answer to what a failed call means for the screen. */
export type GymPassFailure =
  | { kind: 'disabled' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | null }
  | { kind: 'message'; key: MessageKey; vars?: Record<string, string | number> };

const KNOWN: Record<string, MessageKey> = {
  plan_not_found: 'gp.err.plan_not_found',
  not_your_gym: 'gp.err.not_your_gym',
  pass_not_active: 'gp.err.pass_not_active',
  already_beneficiary: 'gp.err.already_beneficiary',
  cannot_add_person: 'gp.err.cannot_add_person',
  invalid_transition: 'gp.err.invalid_transition',
  cannot_remove_purchaser: 'gp.err.cannot_remove_purchaser',
  cannot_modify_purchaser: 'gp.err.cannot_modify_purchaser',
  invalid_contact: 'gp.err.invalid_contact',
  cannot_add_yourself: 'gp.err.cannot_add_yourself',
  not_found: 'gp.err.not_found',
  gym_not_found: 'gp.err.gym_not_found',
  acl_forbidden: 'gp.err.acl_forbidden',
};
const FIELD_KEYS = new Set(['name', 'description', 'terms', 'category', 'durationUnit', 'durationValue', 'priceTzs', 'beneficiaryLimit']);
const REASON_KEYS = new Set(['name_required', 'too_long', 'too_large', 'group_limit_required', 'group_limit_range', 'category_fixes_limit']);

/** Classify a failed call. 404 feature_disabled and 429 rate_limited get their own states; the rest map to a text. */
export function classifyGymPassError(err: unknown): GymPassFailure {
  if (!(err instanceof ApiError)) return { kind: 'message', key: 'gp.failed' };
  const b = (err.body ?? {}) as { error?: string; field?: string; reason?: string; limit?: number; retryAfterSeconds?: number };
  if (err.status === 404 && b.error === 'feature_disabled') return { kind: 'disabled' };
  if (err.status === 429 || b.error === 'rate_limited') {
    const n = Number(b.retryAfterSeconds);
    return { kind: 'rate_limited', retryAfterSeconds: Number.isFinite(n) && n > 0 ? Math.ceil(n) : null };
  }
  if (b.error === 'invalid_field') {
    if (b.reason && REASON_KEYS.has(b.reason)) return { kind: 'message', key: `gp.err.reason.${b.reason}` as MessageKey };
    if (b.field && FIELD_KEYS.has(b.field)) return { kind: 'message', key: 'gp.err.field', vars: { field: b.field } };
    return { kind: 'message', key: 'gp.generic' };
  }
  if (b.error === 'beneficiary_limit_exceeded') return { kind: 'message', key: 'gp.err.beneficiary_limit_exceeded', vars: { limit: b.limit ?? '' } };
  if (err.status === 403 && !(b.error && KNOWN[b.error])) return { kind: 'message', key: 'gp.forbidden' };
  if (b.error && KNOWN[b.error]) return { kind: 'message', key: KNOWN[b.error] };
  return { kind: 'message', key: 'gp.generic' };
}

/** Whole-number text → integer, or null when it is not a whole number. */
export const wholeNumber = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** The invite link's token: the part after # (never in the query string). Null when absent. */
export function inviteTokenFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const t = raw.trim();
  return t || null;
}

export type InvitePreview =
  | { kind: 'ok'; invitation: { status: 'pending' | 'expired'; contactType?: 'phone' | 'email'; gymName?: string | null; planName?: string; until?: string | null; buyerName?: string | null } }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | null }
  | { kind: 'disabled' }
  | { kind: 'error' };

/**
 * POST /gym-pass-invitations/preview { token }. No sign-in, no cookies, no referrer; the token travels only in the
 * request body and is never logged or stored. Never throws.
 */
export async function previewGymPassInvite(token: string, signal?: AbortSignal): Promise<InvitePreview> {
  try {
    const res = await fetch(`${API_BASE}/gym-pass-invitations/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
    });
    const b = await res.json().catch(() => null) as { invitation?: Record<string, unknown>; error?: string; retryAfterSeconds?: number } | null;
    if (res.ok) {
      return b?.invitation && typeof b.invitation === 'object'
        ? { kind: 'ok', invitation: b.invitation as never }
        : { kind: 'error' };
    }
    if (res.status === 404 && b?.error === 'feature_disabled') return { kind: 'disabled' };
    if (res.status === 404 || res.status === 400) return { kind: 'not_found' };
    if (res.status === 429) {
      const n = Number(b?.retryAfterSeconds ?? res.headers.get('Retry-After'));
      return { kind: 'rate_limited', retryAfterSeconds: Number.isFinite(n) && n > 0 ? Math.ceil(n) : null };
    }
    return { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}
