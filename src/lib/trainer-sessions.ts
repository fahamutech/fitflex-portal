// Admin trainer sessions (functions#231): what an admin may do with a booking, and how refusals read.
import { ApiError, TrainerBooking } from './api';
import type { Locale, MessageKey } from './i18n';

export type SessionStatus = TrainerBooking['status'];
export type SessionAction = 'completed' | 'no_show' | 'cancelled';

export const SESSION_STATUSES: SessionStatus[] = ['payment_pending', 'payment_rejected', 'confirmed', 'completed', 'no_show', 'cancelled'];

export const STATUS_LABEL: Record<SessionStatus, MessageKey> = {
  payment_pending: 'tsess.status.payment_pending',
  payment_rejected: 'tsess.status.payment_rejected',
  confirmed: 'tsess.status.confirmed',
  completed: 'tsess.status.completed',
  no_show: 'tsess.status.no_show',
  cancelled: 'tsess.status.cancelled',
};

export const STATUS_TONE: Record<SessionStatus, 'warning' | 'danger' | 'brand' | 'success' | 'info' | 'gray'> = {
  payment_pending: 'warning',
  payment_rejected: 'danger',
  confirmed: 'brand',
  completed: 'success',
  no_show: 'info',
  cancelled: 'gray',
};

/** Statuses the booking was paid for: the only ones an admin moves between (owner decision 2026-10-20). */
const PAID: SessionStatus[] = ['confirmed', 'completed', 'no_show'];

/** A trainer statement past draft that holds this session (learned from a 409 booking_on_trainer_statement). */
export type StatementLock = { statementId?: string; statementStatus?: string };

export type Availability = {
  complete: boolean;
  noShow: boolean;
  cancel: boolean;
  /** Why nothing can be done, shown as text on the row. */
  why: 'cancelled' | 'unpaid' | 'locked' | null;
};

/**
 * What to offer on a row. With TRAINER_SESSION_OUTCOMES on the server sends `actions` (admin view); without it
 * (flag off) only status decides, and "didn't attend" is never offered. Cancel has no server hint: it is offered
 * on a paid session that is not known to be on a statement past draft.
 */
export function availability(b: TrainerBooking, lock?: StatementLock | null): Availability {
  const none = (why: Availability['why']): Availability => ({ complete: false, noShow: false, cancel: false, why });
  if (b.status === 'cancelled') return none('cancelled');
  if (!PAID.includes(b.status)) return none('unpaid');
  if (lock) return none('locked');
  if (b.actions) {
    // Admin view: a paid session with neither outcome open is on a statement past draft.
    if (!b.actions.canComplete && !b.actions.canMarkNoShow) return none('locked');
    return { complete: b.actions.canComplete && b.status !== 'completed', noShow: b.actions.canMarkNoShow, cancel: true, why: null };
  }
  return { complete: b.status === 'confirmed', noShow: false, cancel: true, why: null };
}

/** Session start (date + slot are East Africa Time) in ms, or NaN when it can't be read. */
export const sessionStartMs = (b: Pick<TrainerBooking, 'date' | 'slot'>) => Date.parse(`${b.date}T${b.slot}:00.000+03:00`);

const FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  timeZone: 'Africa/Dar_es_Salaam',
};

/** One format for every session time on the page, in East Africa Time. */
export function eatText(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'sw' ? 'sw-TZ' : 'en-GB', FORMAT).format(ms);
}

export function sessionWhen(b: Pick<TrainerBooking, 'date' | 'slot'>, locale: Locale): string {
  const ms = sessionStartMs(b);
  return Number.isNaN(ms) ? `${b.date || '—'} ${b.slot || ''}`.trim() : eatText(ms, locale);
}

export type RefusalBody = { error?: string; from?: string; startsAt?: string; statementId?: string; statementStatus?: string };

export const ERROR_KEY: Record<string, MessageKey> = {
  invalid_transition: 'tsess.err.invalid_transition',
  session_not_started: 'tsess.err.session_not_started',
  invalid_booking_time: 'tsess.err.invalid_booking_time',
  booking_cancelled: 'tsess.err.booking_cancelled',
  booking_on_trainer_statement: 'tsess.err.booking_on_trainer_statement',
  booking_changed: 'tsess.err.booking_changed',
  invalid_status: 'tsess.err.invalid_status',
  feature_disabled: 'tsess.err.feature_disabled',
  not_found: 'tsess.err.not_found',
  // functions#240: cancelling while a mobile-money prompt is live for the booking.
  payment_in_progress: 'tsess.err.payment_in_progress',
};

/** Refusals after which the list on screen is out of date and is loaded again. */
export const RELOAD_AFTER = new Set(['invalid_transition', 'booking_cancelled', 'booking_on_trainer_statement', 'booking_changed', 'not_found']);

export function refusalOf(e: unknown): { status: number | null; body: RefusalBody } {
  if (e instanceof ApiError) return { status: e.status, body: (e.body as RefusalBody | null) ?? {} };
  return { status: null, body: {} };
}
