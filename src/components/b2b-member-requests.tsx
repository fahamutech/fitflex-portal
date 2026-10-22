'use client';
import { useApp } from '../../app/providers';
import type { B2BMemberRequest } from '@/lib/api';
import type { Locale, MessageKey } from '@/lib/i18n';
import { Badge, Button } from '@/components/shared';

/**
 * Adds by user ID that wait for the member to accept in the app (fitflex-functions#241).
 * An organisation user or company HR who names someone only by user ID gets a request,
 * not a person on the list; these bits show that request and let them withdraw it.
 */

type T = (k: MessageKey) => string;

// Error codes of the member-request flow whose text lives in i18n (English + Swahili).
export const MEMBER_REQUEST_ERRORS: Partial<Record<string, MessageKey>> = {
  member_request_pending: 'b2b.errors.memberRequestPending',
  member_request_not_pending: 'b2b.errors.memberRequestNotPending',
  member_request_not_found: 'b2b.errors.memberRequestNotFound',
  member_consent_unavailable: 'b2b.errors.memberConsentUnavailable',
};

/** Fill `{key}` placeholders. */
export const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), text);

export const requestName = (t: T, r: Pick<B2BMemberRequest, 'displayName'>) => r.displayName || t('b2b.memberRequest.someone');

/** "Request sent. {name} must accept in the FitFlex app before they're added." */
export const requestSentNotice = (t: T, r: Pick<B2BMemberRequest, 'displayName'>) =>
  fill(t('b2b.memberRequest.sent'), { name: requestName(t, r) });

const expiryDay = (locale: Locale, iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? iso : d.toLocaleDateString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The "Waiting for member" badge and when the request runs out. */
export function PendingMemberStatus({ request }: { request: B2BMemberRequest }) {
  const { t, locale } = useApp();
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid={`member-request-${request.id}`}>
      <Badge tone="warning">{t('b2b.memberRequest.waiting')}</Badge>
      {request.expiresAt && (
        <span className="text-xs text-[var(--color-fg-quaternary)]">{fill(t('b2b.memberRequest.expires'), { date: expiryDay(locale, request.expiresAt) })}</span>
      )}
    </span>
  );
}

/** Withdraw, after a confirm. `onWithdraw` makes the call; the caller reloads and reports. */
export function WithdrawRequestButton({ request, disabled, onWithdraw }: { request: B2BMemberRequest; disabled?: boolean; onWithdraw: () => void }) {
  const { t } = useApp();
  return (
    <Button
      size="sm" variant="secondary" disabled={disabled} data-testid={`member-request-withdraw-${request.id}`}
      onClick={() => { if (window.confirm(fill(t('b2b.memberRequest.withdrawConfirm'), { name: requestName(t, request) }))) onWithdraw(); }}
    >
      {t('b2b.memberRequest.withdraw')}
    </Button>
  );
}
