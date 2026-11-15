'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Globe } from 'lucide-react';
import { useApp } from '../providers';
import { Button, Card, CardContent } from '@/components/shared';
import { fill } from '@/components/communication-shared';
import { GYM_CUSTOM_PASSES, MEMBER_PORTAL } from '@/lib/flags';
import { inviteTokenFromHash, previewGymPassInvite, type InvitePreview } from '@/lib/gym-passes';

type View = { kind: 'loading' } | InvitePreview | { kind: 'off' };

/**
 * Landing page for a gym pass invitation: <base>/gym-pass/#<token>. The token is only ever in the address hash: it is
 * read once, removed from the address bar, kept in memory, and sent only in the body of the preview request. It is not
 * logged, stored, put in a query string or passed to analytics. The link alone attaches nobody: the person signs up or
 * signs in and verifies the invited contact.
 */
export default function GymPassInvitePage() {
  const { ready, locale, setLocale, t } = useApp();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const tokenRef = useRef<string | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) { setView({ kind: 'not_found' }); return; }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setView({ kind: 'loading' });
    const r = await previewGymPassInvite(token, ctl.signal);
    if (!ctl.signal.aborted) setView(r);
  }, []);

  // On mount, before any flag or ready check: take the token out of the address bar and history entry, whatever the
  // flag says. It is kept in memory only when the page is on.
  useEffect(() => {
    if (tokenRef.current !== undefined) return;
    let h = '';
    try { h = window.location.hash; } catch { /* unreadable address */ }
    tokenRef.current = GYM_CUSTOM_PASSES ? inviteTokenFromHash(h) : null;
    if (h) {
      try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); } catch { /* not allowed: leave it */ }
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!GYM_CUSTOM_PASSES) { setView({ kind: 'off' }); return; }
    // One request per visit: an effect that runs twice (development) must not ask twice.
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [ready, load]);

  const toggle = (
    <button
      type="button" data-testid="gp-invite-lang"
      onClick={() => setLocale(locale === 'sw' ? 'en' : 'sw')}
      aria-label={`${t('gp.invite.langToggle')}: ${locale === 'sw' ? 'English' : 'Kiswahili'}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-xs font-semibold text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]"
    >
      <Globe aria-hidden="true" className="h-4 w-4" />
      <span aria-hidden="true">{locale === 'sw' ? 'SW' : 'EN'}</span>
    </button>
  );

  const centered = (testId: string, title: string, body?: string, action?: React.ReactNode) => (
    <div className="space-y-3 py-12 text-center" data-testid={testId}>
      <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{title}</h1>
      {body && <p className="text-sm text-[var(--color-fg-tertiary)]">{body}</p>}
      {action}
    </div>
  );

  // Sign-up and contact verification happen in the FitFlex app. Where the member portal is on, people who already have
  // an account can also sign in on the web; the portal has no sign-up of its own.
  const signIn = !MEMBER_PORTAL ? null : (
    <Link href="/m/signin/" data-testid="gp-invite-signin" className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand-600)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-700)]">
      {t('gp.invite.signIn')}
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-3" data-testid="gp-invite-page">
      <div className="flex justify-end">{toggle}</div>
      <div role="status" aria-live="polite">
        {view.kind === 'loading' && GYM_CUSTOM_PASSES && <p className="py-16 text-center text-sm text-[var(--color-fg-tertiary)]" data-testid="gp-invite-loading">{t('gp.invite.loading')}</p>}
      </div>
      {(view.kind === 'off' || view.kind === 'disabled') && centered('gp-invite-off', t('gp.invite.off.title'), t('gp.invite.off.body'))}
      {view.kind === 'not_found' && centered('gp-invite-not-found', t('gp.invite.notFoundTitle'), t('gp.invite.notFoundBody'))}
      {view.kind === 'rate_limited' && centered('gp-invite-rate-limited', t('gp.invite.rateLimited'), fill(t('gp.invite.rateLimitedBody'), { n: view.retryAfterSeconds ?? 60 }), <Button onClick={() => void load()}>{t('gp.invite.retry')}</Button>)}
      {view.kind === 'error' && centered('gp-invite-error', t('gp.invite.errorTitle'), t('gp.invite.errorBody'), <Button onClick={() => void load()}>{t('gp.invite.retry')}</Button>)}
      {view.kind === 'ok' && view.invitation.status === 'expired' && centered('gp-invite-expired', t('gp.invite.expiredTitle'), t('gp.invite.expiredBody'), signIn)}
      {view.kind === 'ok' && view.invitation.status === 'pending' && (
        <article className="space-y-4 py-6" data-testid="gp-invite-ok">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg-primary)]">{t('gp.invite.title')}</h1>
          <p className="text-sm text-[var(--color-fg-secondary)]">{t('gp.invite.lead')}</p>
          <Card>
            <CardContent className="space-y-1 text-sm">
              {view.invitation.buyerName && <p data-testid="gp-invite-from">{fill(t('gp.invite.from'), { name: view.invitation.buyerName })}</p>}
              {view.invitation.gymName && <p data-testid="gp-invite-gym">{fill(t('gp.invite.gym'), { name: view.invitation.gymName })}</p>}
              {view.invitation.planName && <p data-testid="gp-invite-plan">{fill(t('gp.invite.pass'), { name: view.invitation.planName })}</p>}
              {view.invitation.until && <p data-testid="gp-invite-until">{fill(t('gp.invite.until'), { date: new Date(view.invitation.until).toLocaleDateString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { dateStyle: 'medium' }) })}</p>}
            </CardContent>
          </Card>
          <p className="text-sm text-[var(--color-fg-secondary)]">{t('gp.invite.steps')}</p>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('gp.invite.noAccount')}</p>
          {signIn}
        </article>
      )}
    </div>
  );
}
