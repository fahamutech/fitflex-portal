'use client';
import { useApp } from '../../app/providers';
import { api, ApiError, type B2BMemberRequest } from '@/lib/api';
import type { Locale, MessageKey } from '@/lib/i18n';
import { Badge, Button } from '@/components/shared';

/**
 * Adds that wait for the member to accept in the app: by user ID (fitflex-functions#241) and,
 * since consent slice (a) (functions#283), by email or mobile number too. An organisation user
 * or company HR who names someone gets a request, not a person on the list; these bits show
 * that request and let them withdraw it.
 *
 * Privacy: until the member accepts, the organisation learns nothing about who is behind it.
 * The backend sends no name (displayName null). By user ID an unknown id or one that isn't a
 * member gets the same 202 with id null (no row, no withdraw). By email or number a request is
 * always stored (id set, userId null) whoever is behind the contact, and a decline still shows
 * as waiting until it would have expired. The screens must not show any difference: the same
 * neutral "Request sent" text, and the row names only what the organisation typed.
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
  const body = (e.body ?? {}) as { error?: string; retryAfter?: string; retryAfterSeconds?: number; scope?: string };
  // The organisation's own hourly cap on requests (functions#283 security review): says when, never who.
  if (body.error === 'rate_limited' && body.scope === 'organization') {
    const minutes = typeof body.retryAfterSeconds === 'number' ? Math.max(1, Math.ceil(body.retryAfterSeconds / 60)) : null;
    return minutes ? fill(t('b2b.errors.orgRateLimited'), { minutes: String(minutes) }) : t('b2b.errors.orgRateLimitedSoon');
  }
  if (body.error === 'member_request_cooldown') {
    const until = body.retryAfter
      ?? (typeof body.retryAfterSeconds === 'number' ? new Date(Date.now() + body.retryAfterSeconds * 1000).toISOString() : null);
    return until ? fill(t('b2b.errors.memberRequestCooldown'), { date: dayText(locale, until) }) : t('b2b.errors.rateLimited');
  }
  const key = body.error ? PLAIN[body.error] : undefined;
  return key ? t(key) : null;
}

/**
 * How a waiting request is named in a list: never a name the member hasn't shared; only what the organisation
 * typed (the email or number, or the user ID). The contact is shown in full: the organisation entered it itself.
 */
export const requestLabel = (t: T, r: Pick<B2BMemberRequest, 'displayName' | 'userId' | 'contact' | 'contactType'>) => {
  if (r.displayName) return r.displayName;
  if (r.contact) {
    const phone = r.contactType ? r.contactType === 'phone' : !r.contact.includes('@');
    return fill(t(phone ? 'b2b.memberRequest.phone' : 'b2b.memberRequest.email'), { contact: r.contact });
  }
  return r.userId ? fill(t('b2b.memberRequest.userId'), { userId: r.userId }) : t('b2b.memberRequest.someone');
};

/**
 * Withdraw a request (DELETE …/member-requests/:id). A 409 member_request_not_pending with requestStatus
 * 'cancelled' or 'expired' means it is already gone (a second withdraw, or it ran out): treated as withdrawn
 * (functions#283 security review; a request by contact never answers 'declined'). Anything else is thrown.
 */
export async function withdrawMemberRequest(token: string, orgId: string, requestId: string): Promise<void> {
  try {
    await api.cancelB2BMemberRequest(token, orgId, requestId);
  } catch (e) {
    const body = e instanceof ApiError ? (e.body ?? {}) as { error?: string; requestStatus?: string } : {};
    if (body.error === 'member_request_not_pending' && (body.requestStatus === 'cancelled' || body.requestStatus === 'expired')) return;
    throw e;
  }
}

/** "Request sent. They'll be added once they accept in the FitFlex app." Same text whatever came back. */
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
