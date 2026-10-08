// Promotions — labels, tones, tabs, error text and date helpers for the admin screens.
import type { GeoArea, Promotion, PromotionPlacement, PromotionStatus, PromotionType } from './api';
import type { MessageKey } from './i18n';
import type { BadgeTone } from './admin-utils';

export const PROMOTION_TYPES: PromotionType[] = ['featured', 'promoted', 'sponsored', 'recommended', 'campaign'];
export const PLACEMENTS: PromotionPlacement[] = ['gym_discovery', 'trainer_discovery', 'vendor_discovery', 'marketplace', 'search_results', 'home', 'campaign_page'];

export const TYPE_KEY: Record<PromotionType, MessageKey> = {
  featured: 'pro.type.featured', promoted: 'pro.type.promoted', sponsored: 'pro.type.sponsored', recommended: 'pro.type.recommended', campaign: 'pro.type.campaign',
};
export const TYPE_HINT_KEY: Record<PromotionType, MessageKey> = {
  featured: 'pro.type.featured.hint', promoted: 'pro.type.promoted.hint', sponsored: 'pro.type.sponsored.hint',
  recommended: 'pro.type.recommended.hint', campaign: 'pro.type.campaign.hint',
};
export const PLACEMENT_KEY: Record<PromotionPlacement, MessageKey> = {
  gym_discovery: 'pro.placement.gym_discovery', trainer_discovery: 'pro.placement.trainer_discovery', vendor_discovery: 'pro.placement.vendor_discovery',
  marketplace: 'pro.placement.marketplace', search_results: 'pro.placement.search_results', home: 'pro.placement.home', campaign_page: 'pro.placement.campaign_page',
};
export const STATUS_KEY: Record<PromotionStatus, MessageKey> = {
  draft: 'pro.status.draft', pending_approval: 'pro.status.pending_approval', approved: 'pro.status.approved', scheduled: 'pro.status.scheduled',
  active: 'pro.status.active', paused: 'pro.status.paused', expired: 'pro.status.expired', completed: 'pro.status.completed',
  rejected: 'pro.status.rejected', cancelled: 'pro.status.cancelled',
};
export const STATUS_TONE: Record<PromotionStatus, BadgeTone> = {
  draft: 'gray', pending_approval: 'warning', approved: 'brand', scheduled: 'brand', active: 'success', paused: 'warning',
  expired: 'gray', completed: 'gray', rejected: 'danger', cancelled: 'danger',
};
export const REL_KEY: Record<string, MessageKey> = {
  paid_advertising: 'pro.rel.paid_advertising', strategic_partner: 'pro.rel.strategic_partner', sponsor: 'pro.rel.sponsor',
  founding_partner: 'pro.rel.founding_partner', barter: 'pro.rel.barter', editorial: 'pro.rel.editorial', campaign: 'pro.rel.campaign',
};
export const COMMERCIAL_RELATIONSHIPS = ['paid_advertising', 'strategic_partner', 'sponsor', 'founding_partner', 'barter'];
export const NON_COMMERCIAL_RELATIONSHIPS = ['editorial', 'campaign'];

export const ACTION_KEY: Record<string, MessageKey> = {
  edit: 'pro.action.edit', submit: 'pro.action.submit', approve: 'pro.action.approve', reject: 'pro.action.reject', reopen: 'pro.action.reopen',
  schedule: 'pro.action.schedule', activate: 'pro.action.activate', pause: 'pro.action.pause', resume: 'pro.action.resume',
  cancel: 'pro.action.cancel', complete: 'pro.action.complete', edit_live: 'pro.action.edit_live',
};
/** Which scope an action needs. Everything else needs `promotions`. */
export const APPROVER_ACTIONS = ['approve', 'reject', 'schedule', 'activate'];
/** Actions that need a reason from the person doing them. */
export const REASON_REQUIRED = ['reject', 'cancel'];

export type Tab = 'active' | 'scheduled' | 'requests' | 'draft' | 'paused' | 'closed';
export const TABS: Tab[] = ['active', 'scheduled', 'requests', 'draft', 'paused', 'closed'];
export const TAB_KEY: Record<Tab, MessageKey> = {
  active: 'pro.tab.active', scheduled: 'pro.tab.scheduled', requests: 'pro.tab.requests', draft: 'pro.tab.draft', paused: 'pro.tab.paused', closed: 'pro.tab.closed',
};
/** Which tab a promotion belongs to, by what it really is right now (not just what is stored). */
export function tabOf(p: Pick<Promotion, 'status' | 'effectiveStatus'>): Tab {
  const s = p.effectiveStatus;
  if (s === 'active') return 'active';
  if (s === 'scheduled' || s === 'approved') return 'scheduled';
  if (s === 'pending_approval') return 'requests';
  if (s === 'draft') return 'draft';
  if (s === 'paused') return 'paused';
  return 'closed';
}

const ERRORS: Record<string, MessageKey> = {
  entity_not_promotable: 'pro.err.entity_not_promotable', placement_full: 'pro.err.placement_full', cannot_approve_own_submission: 'pro.err.cannot_approve_own_submission',
  promotion_expired: 'pro.err.promotion_expired', period_in_past: 'pro.err.period_in_past', end_before_start: 'pro.err.end_before_start',
  start_in_future: 'pro.err.start_in_future', start_not_in_future: 'pro.err.start_not_in_future', field_locked: 'pro.err.field_locked',
  not_editable: 'pro.err.not_editable', invalid_transition: 'pro.err.invalid_transition', reason_required: 'pro.err.reason_required',
  commercial_reference_required: 'pro.err.commercial_reference_required', outside_campaign_period: 'pro.err.outside_campaign_period',
  campaign_required: 'pro.err.campaign_required', campaign_closed: 'pro.err.campaign_closed', campaign_not_found: 'pro.err.campaign_not_found',
  sponsored_requires_commercial: 'pro.err.sponsored_requires_commercial', recommended_cannot_be_commercial: 'pro.err.recommended_cannot_be_commercial',
  relationship_required: 'pro.err.relationship_required', relationship_not_commercial: 'pro.err.relationship_not_commercial',
  relationship_requires_commercial: 'pro.err.relationship_requires_commercial', placement_not_valid_for_entity: 'pro.err.placement_not_valid_for_entity',
  placements_required: 'pro.err.placements_required', entity_not_found: 'pro.err.entity_not_found', entity_type_mismatch: 'pro.err.entity_type_mismatch',
  promotion_not_found: 'pro.err.promotion_not_found', partner_not_found: 'pro.err.partner_not_found', unknown_geo_area: 'pro.err.unknown_geo_area',
  promotions_outside_period: 'pro.err.promotions_outside_period', name_required: 'pro.err.name_required', invalid_max_slots: 'pro.err.invalid_max_slots',
  invalid_range: 'pro.err.invalid_range', range_too_long: 'pro.err.range_too_long',
  acl_forbidden: 'pro.err.acl_forbidden', invalid_priority: 'pro.err.invalid_priority', invalid_start: 'pro.err.invalid_start', invalid_end: 'pro.err.invalid_end',
};
export function errorKey(err: unknown): MessageKey {
  const code = (err as { body?: { error?: string } })?.body?.error ?? '';
  return ERRORS[code] ?? 'pro.err.generic';
}
export const errorCode = (err: unknown): string => (err as { body?: { error?: string } })?.body?.error ?? '';
export const errorBody = <T,>(err: unknown): T | undefined => (err as { body?: T })?.body;

export const dateTime = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const day = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** An ISO instant as the local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** A datetime-local value (the admin's own clock) as an ISO instant; empty or invalid gives ''. */
export function fromLocalInput(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** An area with its parents: "Stone Town · Zanzibar City · Zanzibar". */
export function areaPath(id: string, areas: GeoArea[]): string {
  const byId = new Map(areas.map(a => [a.id, a]));
  const parts: string[] = [];
  let cur = byId.get(id);
  while (cur && cur.level !== 'country') { parts.push(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
  return parts.join(' · ') || id;
}
export function scopeSummary(scope: { areaIds: string[]; radius?: { km: number } } | null | undefined, areas: GeoArea[], everywhere: string): string {
  const parts = (scope?.areaIds ?? []).map(id => areaPath(id, areas));
  if (scope?.radius) parts.push(`${scope.radius.km} km`);
  return parts.length ? parts.join('; ') : everywhere;
}

// ─── Analytics: EAT calendar days (UTC+3, no daylight saving) and null-safe ratios ───
const EAT_MS = 3 * 3600 * 1000;
/** Today's calendar day in East Africa Time as YYYY-MM-DD. */
export const eatToday = (now: number = Date.now()): string => new Date(now + EAT_MS).toISOString().slice(0, 10);
/** A calendar day plus (or minus) some days, still as YYYY-MM-DD. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** "8 Oct 2026" from a YYYY-MM-DD calendar day (no timezone shift). */
export const ymdLabel = (ymd: string): string =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const isYmd = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
/** A fraction 0..1 as "12.3%"; null (nothing to divide by) is a dash, never 0%. */
export const pct = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`);
/** `part` as a share of `whole`, or null when there is no whole. */
export const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
