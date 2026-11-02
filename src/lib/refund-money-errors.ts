// Phase 1 · split refund scopes and the second person on statement payments.
// Maps the codes the server sends to the refund and payout screens onto readable text (refundMoney.*).
// Nothing here gates a button: when REFUND_SPLIT_SCOPES is off the old `payments` scope still works,
// so the server's answer is the only source of truth.
import type { MessageKey } from './i18n';
import { errorCode } from './money-approval';

const CODES = ['cannot_approve_own_request', 'cannot_pay_own_approval', 'cannot_pay_own_request', 'approver_unknown', 'reason_required'];

/** The key for a refund or payout refusal this slice explains, or null (the page keeps its existing message). */
export function refundMoneyErrorKey(err: unknown): MessageKey | null {
  const code = errorCode(err);
  if (CODES.includes(code)) return `refundMoney.err.${code}` as MessageKey;
  if (code === 'acl_forbidden') {
    const scope = (err as { body?: { requiredScope?: string } } | null)?.body?.requiredScope;
    return (scope === 'refunds_approve' || scope === 'refunds_pay' ? `refundMoney.err.missing_scope.${scope}` : 'refundMoney.err.missing_scope') as MessageKey;
  }
  return null;
}

/**
 * Statement payouts (gym, trainer, vendor): only the two second-person codes get new text, worded for a statement.
 * Everything else (reason_required on a void or hold, acl_forbidden, ...) keeps the screen's existing, more specific message.
 */
export function statementPayErrorKey(err: unknown): MessageKey | null {
  const code = errorCode(err);
  return code === 'cannot_pay_own_approval' || code === 'approver_unknown' ? (`refundMoney.stmt.${code}` as MessageKey) : null;
}
