// Labels and small helpers for the gym settlement screens.
import type { BadgeTone } from '@/lib/admin-utils';
import type { GymSettlement, GymSettlementStatus, SettlementAdjustment } from '@/lib/api';

export const STATEMENT_STATUS: Record<GymSettlementStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  submitted: { label: 'Submitted', tone: 'warning' },
  approved: { label: 'Approved', tone: 'brand' },
  payable: { label: 'Ready to pay', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  voided: { label: 'Voided', tone: 'danger' },
};

// The order finance works through a month.
export const STATEMENT_TABS: GymSettlementStatus[] = ['draft', 'submitted', 'approved', 'payable', 'paid'];

export const BRACKET_LABEL: Record<string, string> = {
  none: '—', daily: 'Daily rate', weekly: 'One week', double_weekly: 'Two weeks', monthly: 'Month',
};

export const FUNDING_LABEL: Record<string, string> = { platform_pass: 'Pass', b2b_benefit: 'Sponsored' };

export const ADJUSTMENT_TYPE_LABEL: Record<SettlementAdjustment['type'], string> = {
  correction: 'Correction', clawback: 'Clawback', manual: 'Manual', carry_forward: 'Carried forward',
};

export const ADJUSTMENT_STATUS: Record<SettlementAdjustment['status'], { label: string; tone: BadgeTone }> = {
  proposed: { label: 'Proposed', tone: 'warning' },
  applied: { label: 'Applied', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

const VISIT_REASON: Record<string, string> = {
  eligible: 'Counted', duplicate_same_day: 'Same gym again that day', second_gym_same_day: 'Second gym that day',
  over_allowance: 'Over the visit allowance', outside_member_cycle: 'Outside the member’s cycle', disputed: 'Disputed',
  flagged: 'Flagged', voided: 'Voided', no_rate_card: 'No rate card', unknown_status: 'Unknown status',
  not_consumed: 'Did not use a visit', wrong_subscription_type: 'Not a pass or sponsored visit',
};
export const visitReason = (code: string) => VISIT_REASON[code] ?? code.replace(/_/g, ' ');

const SKIP_REASON: Record<string, string> = {
  no_approved_payment: 'No approved payment for the subscription',
  rule_missing: 'A settlement rule is missing',
  held_visits: 'Has disputed, flagged or unrated visits',
};
export const skipReason = (code: string) => SKIP_REASON[code] ?? code.replace(/_/g, ' ');

const NOT_PAYABLE: Record<string, string> = {
  no_owner_account: 'the gym has no owner account',
  payout_account_cooling_off: 'its payout account was changed recently and is still in its waiting period',
  payout_account_not_verified: 'it has no verified payout account',
  legacy_payout_details_missing: 'it has no payout details',
  kyc_not_started: 'its owner has not started verification',
};

const ERRORS: Record<string, string> = {
  invalid_status: 'This statement has already moved on. Refresh to see where it stands.',
  invalid_month: 'Choose a month.',
  settlement_run_in_progress: 'A settlement run is already in progress. Try again in a minute.',
  period_not_finished: 'A live run is only possible once the month has ended.',
  invalid_period: 'Choose a month.',
  run_not_locked: 'The run behind this statement has not finished.',
  pending_adjustments: 'Apply or reject the proposed adjustments first.',
  reason_required: 'Write a reason.',
  cannot_approve_own_submission: 'You submitted this statement, so someone else has to approve it.',
  cannot_approve_own_adjustment: 'You proposed this adjustment, so someone else has to apply it.',
  not_on_hold: 'This statement is not on hold.',
  on_hold: 'This statement is on hold. Release it first.',
  nothing_to_pay: 'There is nothing to pay on this statement.',
  payment_reference_required: 'Enter the payment reference.',
  shadow_statement: 'Shadow statements are for checking only and cannot be changed.',
  amount_must_be_whole_nonzero_tzs: 'Enter a whole amount in TZS that is not zero.',
  clawback_must_be_negative: 'A clawback takes money back, so the amount must be negative.',
  forbidden: 'You don’t have permission to do that.',
  acl_forbidden: 'You don’t have permission to do that.',
};

export function settlementError(err: unknown) {
  const body = (err as { body?: { error?: string; reason?: string } })?.body;
  const code = body?.error ?? '';
  if (code === 'not_payable') {
    const why = NOT_PAYABLE[body?.reason ?? ''] ?? (body?.reason?.startsWith('kyc_') ? 'its owner’s verification is not approved' : 'it does not pass the payout check');
    return `This gym can’t be paid yet: ${why}.`;
  }
  return ERRORS[code] ?? 'Something went wrong.';
}

export const period = (s: Pick<GymSettlement, 'periodStartDate'>) => {
  const [y, m] = s.periodStartDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export const shortDay = (date: string | null | undefined) => {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** Signed TZS: "−TZS 3,500" for money taken off. */
export const signed = (value: number) => `${value < 0 ? '−' : ''}TZS ${new Intl.NumberFormat('en-US').format(Math.abs(value || 0))}`;

/** The month before this one, as "YYYY-MM" — the one that is usually settled. */
export function lastMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
