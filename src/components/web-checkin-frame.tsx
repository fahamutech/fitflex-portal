'use client';
import { useEffect, useRef } from 'react';
import { Globe } from 'lucide-react';
import { useApp } from '../../app/providers';
import { WEB_QR_CHECKIN } from '@/lib/flags';

/** Common frame for /g/signin, /g/confirm and /g/done: language toggle, narrow column, the flag-off state. */
export function WebCheckinFrame({ testId, children }: { testId: string; children: React.ReactNode }) {
  const { ready, locale, setLocale, t } = useApp();
  const langChosen = useRef(false);

  // The saved choice is applied by the app; with none, follow the browser once (as on the gym page).
  useEffect(() => {
    if (!ready || langChosen.current) return;
    langChosen.current = true;
    let saved: string | null = null;
    try { saved = localStorage.getItem('locale'); } catch { /* storage blocked */ }
    if (saved !== 'en' && saved !== 'sw') {
      const nav = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
      if (nav.toLowerCase().startsWith('sw') && locale !== 'sw') setLocale('sw');
    }
  }, [ready, locale, setLocale]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-3" data-testid={testId}>
      <div className="flex justify-end">
        <button
          type="button"
          data-testid="web-checkin-lang-toggle"
          onClick={() => setLocale(locale === 'sw' ? 'en' : 'sw')}
          aria-label={`${t('web.gym.langToggle')}: ${t(locale === 'sw' ? 'web.gym.switchToEn' : 'web.gym.switchToSw')}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-xs font-semibold text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]"
        >
          <Globe aria-hidden="true" className="h-4 w-4" />
          <span aria-hidden="true">{locale === 'sw' ? 'SW' : 'EN'}</span>
        </button>
      </div>
      {!ready ? null : WEB_QR_CHECKIN ? children : <Notice testId="web-checkin-flag-off" title={t('web.checkin.unavailableTitle')} body={t('web.checkin.unavailableBody')} />}
    </div>
  );
}

export function Notice({ title, body, testId, action }: { title: string; body?: string; testId: string; action?: React.ReactNode }) {
  return (
    <div className="space-y-3 py-12 text-center" data-testid={testId}>
      <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{title}</h1>
      {body && <p className="text-sm text-[var(--color-fg-tertiary)]">{body}</p>}
      {action}
    </div>
  );
}

export function SignedOutNotice() {
  const { t } = useApp();
  return <Notice testId="web-checkin-signed-out" title={t('web.checkin.done.signedOutTitle')} body={t('web.checkin.done.signedOutBody')} />;
}
