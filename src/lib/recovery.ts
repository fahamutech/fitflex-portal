// Account recovery (admin): small helpers shared by the queue and the case view.
import type { RecoveryFilter, RecoveryRefusalReason, RecoveryStatus } from './api';
import type { Locale, MessageKey } from './i18n';

export const RECOVERY_FILTERS: RecoveryFilter[] = ['open', 'completed', 'refused', 'cancelled', 'all'];
export const REFUSAL_REASONS: RecoveryRefusalReason[] = ['evidence_insufficient', 'details_do_not_match', 'other'];
export const RECOVERY_TONE: Record<RecoveryStatus, 'warning' | 'success' | 'danger' | 'gray'> = {
  open: 'warning', completed: 'success', refused: 'danger', cancelled: 'gray',
};

export const whenText = (iso: string | null | undefined, locale: Locale) =>
  iso ? new Date(iso).toLocaleString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** The translation key for an error the decision/note routes answer with. */
export function recoveryErrorKey(err: unknown): MessageKey {
  const code = (err as { body?: { error?: string } })?.body?.error ?? '';
  const key = `rec.err.${code}` as MessageKey;
  return KNOWN_ERRORS.includes(code) ? key : 'rec.err.generic';
}
const KNOWN_ERRORS = [
  'waiting_period_not_over', 'evidence_missing', 'recovery_not_open', 'identifier_in_use', 'cannot_decide_own_recovery',
  'reason_required', 'partner_recovery_not_available', 'staff_recovery_not_available', 'recovery_not_available',
  'not_found', 'note_required',
];

export const canDecideAt = (err: unknown) => (err as { body?: { canDecideAt?: string } })?.body?.canDecideAt ?? null;
