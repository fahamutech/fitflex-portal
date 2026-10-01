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

// ── configuration ───────────────────────────────────────────────────────────

export const PASS_TIER_KEYS = ['basic', 'pro', 'premium', 'executive'] as const;
export const SETTLED_GYM_TIERS = ['standard', 'midtier', 'premium', 'luxury_executive'] as const;

const TIER_LABEL: Record<string, string> = {
  basic: 'Basic', pro: 'Pro', premium: 'Premium', executive: 'Executive',
  standard: 'Standard', midtier: 'Mid-tier', luxury_executive: 'Luxury / Executive', online: 'Online',
};
export const tierLabel = (key: string | null | undefined) => (key ? TIER_LABEL[key] ?? key : '—');

/** Basis points as a percentage: 2500 → "25%". */
export const percent = (bps: number | null | undefined) => (bps == null ? '—' : `${bps / 100}%`);

/** What the gym is paid for a rate: the discounted retail rate, up to the ceiling. */
export const wholesale = (retailTzs: number, discountBps: number | null, ceilingTzs: number | null) =>
  (discountBps == null || ceilingTzs == null ? null : Math.min(Math.floor((retailTzs * (10000 - discountBps)) / 10000), ceilingTzs));

/** Today in East Africa Time, "YYYY-MM-DD": the earliest date a replacement can start. */
export const todayEAT = (now = new Date()) => new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);

const CONFIG_ERRORS: Record<string, string> = {
  cannot_approve_own_draft: 'You drafted this, so someone else has to activate it.',
  approver_required: 'You don’t have permission to do that.',
  acl_forbidden: 'You don’t have permission to do that.',
  not_a_draft: 'This is no longer a draft. Refresh to see where it stands.',
  not_found: 'This draft no longer exists.',
  effective_from_in_past: 'The start date can’t be in the past: a version is already in force.',
  invalid_effective_from: 'Choose a start date.',
  overlaps_later_version: 'A version already starts on or after that date. Choose a later date.',
  rule_missing: 'This gym’s tier has no active discount or ceiling rule for that date. Activate the rule first.',
  special_contract_reserved: 'Special contracts can’t be activated yet.',
  tier_key_required: 'Choose a pass.',
  price_must_be_whole_tzs: 'Enter the price as a whole amount in TZS.',
  allowance_must_be_whole_number: 'Enter the number of visits as a whole number.',
  retail_must_be_whole_tzs: 'Enter all three retail rates as whole amounts in TZS.',
  gym_not_found: 'Choose a gym.',
  invalid_scope: 'Choose what the rule applies to.',
  scope_id_mismatch: 'Choose what the rule applies to.',
  rule_has_no_values: 'Fill in at least one value.',
  invalid_rule_value: 'Percentages must be between 0 and 100, amounts whole TZS.',
  network_rule_scope: 'The network share can only be set for all gyms or for a pass.',
  reimbursement_rule_scope: 'Discounts and ceilings can’t be set per pass.',
};

export function configError(err: unknown) {
  const code = (err as { body?: { error?: string } })?.body?.error ?? '';
  return CONFIG_ERRORS[code] ?? 'Something went wrong.';
}
