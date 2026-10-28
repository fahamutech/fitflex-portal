'use client';
import { useApp } from '../../app/providers';
import { ApiError, type B2BMemberRequest } from '@/lib/api';
import type { Locale, MessageKey } from '@/lib/i18n';
import { Badge, Button } from '@/components/shared';

/**
 * Adds by user ID that wait for the member to accept in the app (fitflex-functions#241).
 * An organisation user or company HR who names someone only by user ID gets a request,
 * not a person on the list; these bits show that request and let them withdraw it.
 *
 * Privacy: until the member accepts, the organisation learns nothing about who the id
 * belongs to. The backend sends no name (displayName null), and an unknown id or one that
 * isn't a member gets the same 202 with id null. The screens must not show the difference:
 * the same neutral "Request sent" text either way, and no row or withdraw for an id-null answer.
 */

type T = (k: MessageKey) => string;

// Error codes of the member-request flow whose text needs no values.
const PLAIN: Partial<Record<string, MessageKey>> = {
  member_request_pending: 'b2b.errors.memberRequestPending',
  member_request_not_pending: 'b2b.errors.memberRequestNotPending',
  member_request_not_found: 'b2b.errors.memberRequestNotFound',
  member_consent_unavailable: 'b2b.errors.memberConsentUnavailable',
  member_request_limit: 'b2b.errors.memberRequestLimit',
  rate_limited: 'b2b.errors.rateLimited',
};

/** Fill `{key}` placeholders. */
export const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), text);

const dayText = (locale: Locale, iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? iso : d.toLocaleDateString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The text for a member-request error (incl. the 429s), or null when the error is something else. */
export function memberRequestError(e: unknown, t: T, locale: Locale): string | null {
  if (!(e instanceof ApiError)) return null;
  const body = (e.body ?? {}) as { error?: string; retryAfter?: string; retryAfterSeconds?: number };
  if (body.error === 'member_request_cooldown') {
    const until = body.retryAfter
      ?? (typeof body.retryAfterSeconds === 'number' ? new Date(Date.now() + body.retryAfterSeconds * 1000).toISOString() : null);
    return until ? fill(t('b2b.errors.memberRequestCooldown'), { date: dayText(locale, until) }) : t('b2b.errors.rateLimited');
  }
  const key = body.error ? PLAIN[body.error] : undefined;
  return key ? t(key) : null;
}

/** How a waiting request is named in a list: never a name the member hasn't shared; the user ID the org typed. */
export const requestLabel = (t: T, r: Pick<B2BMemberRequest, 'displayName' | 'userId'>) =>
  r.displayName || (r.userId ? fill(t('b2b.memberRequest.userId'), { userId: r.userId }) : t('b2b.memberRequest.someone'));

/** "Request sent. The member must accept in the FitFlex app before they're added." Same text whatever came back. */
export const requestSentNotice = (t: T) => t('b2b.memberRequest.sent');

/** Waiting requests that can be shown (something was stored, so it has an id). */
export const shownRequests = (list: B2BMemberRequest[] | null | undefined) => (list ?? []).filter(r => !!r.id);

/** The "Waiting for member" badge and when the request runs out. */
export function PendingMemberStatus({ request }: { request: B2BMemberRequest }) {
  const { t, locale } = useApp();
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid={`member-request-${request.id}`}>
      <Badge tone="warning">{t('b2b.memberRequest.waiting')}</Badge>
      {request.expiresAt && (
        <span className="text-xs text-[var(--color-fg-quaternary)]">{fill(t('b2b.memberRequest.expires'), { date: dayText(locale, request.expiresAt) })}</span>
      )}
    </span>
  );
}

/** Withdraw, after a confirm. `onWithdraw` makes the call; the caller reloads and reports. Nothing for a request with no id. */
export function WithdrawRequestButton({ request, disabled, onWithdraw }: { request: B2BMemberRequest; disabled?: boolean; onWithdraw: () => void }) {
  const { t } = useApp();
  if (!request.id) return null;
  return (
    <Button
      size="sm" variant="secondary" disabled={disabled} data-testid={`member-request-withdraw-${request.id}`}
      onClick={() => { if (window.confirm(fill(t('b2b.memberRequest.withdrawConfirm'), { name: requestLabel(t, request) }))) onWithdraw(); }}
    >
      {t('b2b.memberRequest.withdraw')}
    </Button>
  );
}
