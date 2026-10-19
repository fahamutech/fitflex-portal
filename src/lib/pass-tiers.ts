// FitFlex Pass tiers: the sellable rule from fitflex-functions#189 (Settings is the
// only price source, fail closed), mirrored here so the portal never offers a tier
// the backend refuses, and admins see why a tier isn't on sale before they save.
//
// Backend rule (settings-service.mjs, PR #189 at 7c5a1ab):
//   configured = row in Settings with a key, not switched off, visits -1 or a whole number > 0,
//                and gymAccess one of PASS_GYM_ACCESS (otherwise check-in refuses: tier_not_configured)
//   sellable   = configured and monthlyPrice a whole number > 0
//   PUT /admin/settings refuses any row that isn't sellable:
//     400 { error: 'invalid_subscription_tier', tier, field, reason?, allowed?, hint? }
//   and (functions#206) an empty list or one with nothing on sale:
//     400 { error: 'invalid_subscription_tier', tier: null, field: 'subscriptionTiers', reason: 'empty' | 'none_on_sale' }
//   and a held tier removed, renamed or switched off: 409 { error: 'tier_in_use', tier, holders }
import { ApiError, SubscriptionTierConfig } from './api';
import type { MessageKey } from './i18n';

/** PASS_GYM_ACCESS in the backend (PR #189): any other value makes the tier unusable. */
export const GYM_ACCESS_VALUES = ['online', 'standard', 'midtier', 'premium', 'luxury_executive'] as const;
export type GymAccess = typeof GYM_ACCESS_VALUES[number];

export const GYM_ACCESS_LABEL: Record<GymAccess, MessageKey> = {
  online: 'tiers.gymAccess.online',
  standard: 'tiers.gymAccess.standard',
  midtier: 'tiers.gymAccess.midtier',
  premium: 'tiers.gymAccess.premium',
  luxury_executive: 'tiers.gymAccess.luxury_executive',
};

/** -1 is how Settings stores "unlimited visits". */
export const UNLIMITED_VISITS = -1;

// Same coercion as the backend (Number(...)); missing, null and '' are "not set".
const num = (v: unknown) => (v === undefined || v === null || v === '' ? NaN : Number(v));

export const visitsValid = (v: unknown) => { const n = num(v); return n === UNLIMITED_VISITS || (Number.isInteger(n) && n > 0); };
export const priceValid = (v: unknown) => { const n = num(v); return Number.isInteger(n) && n > 0; };
export const gymAccessValid = (v: unknown) => (GYM_ACCESS_VALUES as readonly string[]).includes(String(v ?? ''));

/** Usable by members already holding it (check-in): the backend's "configured". */
export const tierConfigured = (t: SubscriptionTierConfig) => !!t.key?.trim() && visitsValid(t.visits) && gymAccessValid(t.gymAccess);
/** May be sold today: the backend's "sellable". */
export const tierSellable = (t: SubscriptionTierConfig) => tierConfigured(t) && priceValid(t.monthlyPrice);

export type TierField = 'key' | 'monthlyPrice' | 'visits' | 'gymAccess';

/** Problems that stop the Settings form from saving, by field: the same checks, in the same order, as the backend's save. */
export function tierErrors(t: SubscriptionTierConfig, all: SubscriptionTierConfig[]): Partial<Record<TierField, MessageKey>> {
  const out: Partial<Record<TierField, MessageKey>> = {};
  const key = t.key?.trim() ?? '';
  if (!key) out.key = 'tiers.err.key';
  else if (all.filter(o => (o.key?.trim() ?? '') === key).length > 1) out.key = 'tiers.err.duplicateKey';
  if (!priceValid(t.monthlyPrice)) out.monthlyPrice = 'tiers.err.price';
  if (!visitsValid(t.visits)) out.visits = 'tiers.err.visits';
  if (!gymAccessValid(t.gymAccess)) out.gymAccess = 'tiers.err.gymAccess';
  return out;
}

/** The status a tier shows in Settings: a short badge, and (when not on sale) what that means for holders. */
export function tierStatus(t: SubscriptionTierConfig): { key: MessageKey; hint: MessageKey | null; tone: 'success' | 'warning' | 'danger' } {
  if (!tierConfigured(t)) return { key: 'tiers.status.notConfiguredShort', hint: 'tiers.status.notConfiguredHint', tone: 'danger' };
  if (!priceValid(t.monthlyPrice)) return { key: 'tiers.status.offSaleShort', hint: 'tiers.status.offSaleHint', tone: 'warning' };
  return { key: 'tiers.status.onSale', hint: null, tone: 'success' };
}

/** A tier from GET /subscription-tiers (only sellable tiers are listed, PR #189). */
export type PublicTier = { key: string; label: string; monthlyPrice: number; visits: number; gymAccess?: string };

/** Keeps only well-formed rows, so a stale or odd response can't offer a tier the backend refuses. */
export function sellableFrom(rows: unknown): PublicTier[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is PublicTier =>
    !!r && typeof r === 'object' && typeof (r as PublicTier).key === 'string' && !!(r as PublicTier).key
    && priceValid((r as PublicTier).monthlyPrice) && visitsValid((r as PublicTier).visits));
}

/** Error codes from PR #189 that the portal translates wherever it sells or uses a pass. */
const TIER_ERROR_KEYS: Record<string, MessageKey> = {
  tier_not_available: 'tiers.err.tier_not_available',
  tier_not_configured: 'tiers.err.tier_not_configured',
};

/** The message key for a tier error from the API, or null if the error is something else. */
export function tierErrorKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiError)) return null;
  const code = (err.body as { error?: string } | null)?.error ?? '';
  return TIER_ERROR_KEYS[code] ?? null;
}

const SAVE_FIELD_KEYS: Record<string, MessageKey> = {
  key: 'tiers.err.key',
  monthlyPrice: 'tiers.err.price',
  visits: 'tiers.err.visits',
  gymAccess: 'tiers.err.gymAccess',
  subscriptionTiers: 'tiers.err.list',
};

/**
 * The backend's refusal of a Settings save (400 invalid_subscription_tier, PR #189): which tier
 * (its key, or "#n" when the key is missing; null for the whole list) and the message for the field.
 */
export function settingsTierError(err: unknown): { tier: string | null; field: string; key: MessageKey } | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { error?: string; tier?: string | null; field?: string; reason?: string } | null;
  if (body?.error !== 'invalid_subscription_tier') return null;
  const field = body.field ?? 'subscriptionTiers';
  // functions#206: an empty list, or one with nothing on sale, is refused as a whole.
  const noneOnSale = field === 'subscriptionTiers' && (body.reason === 'empty' || body.reason === 'none_on_sale');
  const key = noneOnSale ? 'tiers.err.noneOnSale'
    : field === 'key' && body.reason === 'duplicate' ? 'tiers.err.duplicateKey' : SAVE_FIELD_KEYS[field] ?? 'tiers.err.list';
  return { tier: body.tier ?? null, field, key };
}

/**
 * functions#206: removing, renaming or switching off a tier that passes or accounts still hold is
 * refused as a whole (409 { error: 'tier_in_use', tier, holders }); nothing is saved. Null otherwise.
 */
export function tierInUse(err: unknown): { tier: string; holders: number | null } | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { error?: string; tier?: string; holders?: number } | null;
  if (body?.error !== 'tier_in_use') return null;
  return { tier: typeof body.tier === 'string' ? body.tier : '', holders: typeof body.holders === 'number' ? body.holders : null };
}

/** Replaces {name} placeholders in a translated string. */
export const fillIn = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
