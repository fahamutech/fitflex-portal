// A1 · second approver on money (MONEY_SECOND_APPROVER). Small helpers shared by
// the admin Payments and Refunds pages. While the flag is off the server sends no
// approvalStage and the new routes answer 404 feature_disabled, so none of this shows.
import type { PaymentApprovalStage, PaymentStatusValue, RefundApprovalStage } from './api';
import type { Locale, MessageKey } from './i18n';

export const PAYMENT_STATUSES: PaymentStatusValue[] = ['pending', 'approved', 'rejected', 'cancelled'];
export const DECIDED_STATUSES: PaymentStatusValue[] = ['approved', 'rejected', 'cancelled'];

// Every stage is still work to do, so none is green (green reads as done).
export const PAYMENT_STAGE_TONE: Record<PaymentApprovalStage, 'warning' | 'danger'> = {
  awaiting_verification: 'warning',
  awaiting_second_approval: 'warning',
  change_requested: 'danger',
};
export const REFUND_STAGE_TONE: Record<RefundApprovalStage, 'warning'> = {
  awaiting_approval: 'warning',
  awaiting_payment: 'warning',
};

export const paymentStageKey = (s: PaymentApprovalStage) => `money2.stage.${s}` as MessageKey;
export const refundStageKey = (s: RefundApprovalStage) => `money2.refundStage.${s}` as MessageKey;
export const paymentStatusKey = (s: PaymentStatusValue) => `money2.status.${s}` as MessageKey;

/** The error code the server answered with, or ''. */
export const errorCode = (err: unknown): string =>
  (err as { body?: { error?: string } } | null)?.body?.error ?? '';

/**
 * Error codes of the second-approver workflow (payments and refunds), each with
 * its own text. Anything else: `money2.err.generic`.
 */
const KNOWN_ERRORS = [
  // verify
  'already_decided', 'already_verified', 'payment_changed',
  // change request
  'invalid_status', 'reason_required', 'no_change', 'not_decided', 'change_already_requested', 'payment_already_confirmed',
  // confirm / cancel
  'cannot_confirm_own_request', 'change_not_requested', 'reference_already_used', 'amount_required', 'amount_mismatch',
  // decision / update with the flag on
  'verification_required', 'cannot_approve_own_verification', 'reference_differs_from_verification', 'change_requires_confirmation',
  // refunds with the flag on
  'cannot_approve_own_request', 'cannot_pay_own_approval', 'cannot_pay_own_request',
  // security fix on functions#184: a provider-confirmed reference cannot be edited
  'reference_locked_provider',
  // the flag is off on the server, or the row is gone
  'feature_disabled', 'not_found',
  // Events S4 (spec §3.7, §3.17): event payment decisions and event refunds
  'order_amount_mismatch', 'order_buyer_mismatch', 'currency_mismatch', 'payment_row_mismatch', 'reason_code_required', 'note_required',
  'order_not_found', 'payment_not_unfulfilled', 'refundable_changed', 'rate_limited',
  // Events S4 review: event change requests, scope refusals, custom policies
  'event_payment_change_not_allowed', 'forbidden', 'payments_scope_required', 'policy_not_evaluable', 'refund_changed',
];

/**
 * Codes only the flag-on server sends on the routes that existed before A1
 * (approve/edit a payment, approve/pay a refund). Those routes keep their
 * current error text for every other code, so nothing changes with the flag off.
 */
export const FLAG_ON_ONLY_ERRORS = [
  'verification_required', 'cannot_approve_own_verification', 'reference_differs_from_verification', 'change_requires_confirmation',
  'cannot_approve_own_request', 'cannot_pay_own_approval', 'cannot_pay_own_request', 'reference_locked_provider',
];

/**
 * Codes the old routes could already send. They get the new text only on a
 * two-admin row (secondApproverRequired), so the flag-off page is unchanged.
 */
const TWO_ADMIN_ROW_ERRORS = ['reference_already_used'];

/** The amount the server expected, when it answers amount_mismatch with one. */
export const expectedAmount = (err: unknown): number | null => {
  const v = (err as { body?: { expectedTzs?: number } } | null)?.body?.expectedTzs;
  return typeof v === 'number' ? v : null;
};

/**
 * Trainer session outcomes (functions#231): approving a booking group's payment is refused with
 * 409 group_slot_rebooked when a rejected session's slot was booked by someone else since.
 * Returns the booking ids the server listed (possibly none), or null for any other error.
 */
export const rebookedBookingIds = (err: unknown): string[] | null => {
  if (errorCode(err) !== 'group_slot_rebooked') return null;
  const ids = (err as { body?: { bookingIds?: unknown } } | null)?.body?.bookingIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
};

export function moneyErrorKey(err: unknown): MessageKey {
  const code = errorCode(err);
  return (KNOWN_ERRORS.includes(code) ? `money2.err.${code}` : 'money2.err.generic') as MessageKey;
}

/** The key for an error only the flag-on server sends, or null (keep the page's existing message). */
export function flagOnErrorKey(err: unknown, twoAdminRow = false): MessageKey | null {
  const code = errorCode(err);
  if (FLAG_ON_ONLY_ERRORS.includes(code) || (twoAdminRow && TWO_ADMIN_ROW_ERRORS.includes(code))) return `money2.err.${code}` as MessageKey;
  return null;
}

export const whenText = (iso: string | null | undefined, locale: Locale) =>
  iso ? new Date(iso).toLocaleString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
