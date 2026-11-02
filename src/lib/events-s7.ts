// Events S7: small pure helpers shared by the offline desk, the waitlist cards and the admin tabs. No strings: only i18n keys.
import { ApiError } from '@/lib/api';
import { errorCode, errorKey } from '@/lib/events';
import type { MessageKey } from '@/lib/i18n';

/** Refusals introduced by S7 (spec §3.13, §4.9, §6.1); anything else falls back to the shared events map. */
const S7_ERRORS: Record<string, MessageKey> = {
  device_limit_reached: 'events.s7.error.device_limit_reached',
  bib_range_overlap: 'events.s7.error.bib_range_overlap',
  bib_range_invalid: 'events.s7.error.bib_range_invalid',
  event_not_open: 'events.s7.error.event_not_open',
  kit_not_provided: 'events.s7.error.kit_not_provided',
  desk_update_required: 'events.s7.error.desk_update_required',
  device_not_found: 'events.s7.error.device_not_found',
  device_not_active: 'events.s7.error.device_not_active',
  device_revoked: 'events.s7.error.device_not_active',
  already_ended: 'events.s7.error.already_ended',
  not_in_review: 'events.s7.error.not_in_review',
  note_required: 'events.s7.error.note_required',
  snapshot_too_large: 'organizer.kitOffline.prepare.tooLarge',
  forbidden_role: 'organizer.forbidden.body',
  rate_limited: 'events.s7.error.rate_limited',
  too_many_items: 'events.s7.error.too_many_items',
  invalid_batch: 'events.s7.error.invalid_batch',
  payment_pending: 'events.s7.error.payment_pending',
  tickets_unavailable: 'events.s7.error.tickets_unavailable',
  waitlist_closed: 'events.s7.error.waitlist_closed',
  scan_not_found: 'events.s7.error.not_in_review',
  reason_required: 'events.s7.error.reason_required',
  invalid_state: 'events.s7.error.invalid_state',
  invalid_transition: 'events.s7.error.invalid_state',
};
export const s7ErrorKey = (err: unknown): MessageKey => S7_ERRORS[errorCode(err) ?? ''] ?? errorKey(err);
export const s7CodeKey = (code: string | null | undefined): MessageKey => S7_ERRORS[code ?? ''] ?? 'common.somethingWrong';
export const isNetworkError = (err: unknown) => !(err instanceof ApiError);

/** Reason rules shared by every S7 admin and organizer write (10 to 300 characters, trimmed). */
export const REASON_MIN = 10;
export const REASON_MAX = 300;
export const reasonValid = (v: string) => v.trim().length >= REASON_MIN && v.trim().length <= REASON_MAX;

export const timeOf = (iso: string | null | undefined, locale: 'en' | 'sw'): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'sw' ? 'sw-TZ' : 'en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' }).format(d);
};
export const clockOf = (ms: number | string | null | undefined, locale: 'en' | 'sw'): string => {
  if (ms == null) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'sw' ? 'sw-TZ' : 'en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
};
