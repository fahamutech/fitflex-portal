'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useApp } from '../../providers';
import { Button } from '@/components/shared';
import { Notice, SignedOutNotice, WebCheckinFrame } from '@/components/web-checkin-frame';
import { WEB_QR_CHECKIN } from '@/lib/flags';
import { fmt } from '@/lib/vendor';
import { CHECKIN_ROUTES, ERROR_KEYS, clearAll, formatEat, getOutcome, getQ, type Outcome } from '@/lib/web-checkin';

export default function WebCheckinDonePage() {
  return <WebCheckinFrame testId="web-checkin-done-page"><Done /></WebCheckinFrame>;
}

function Done() {
  const { t, locale } = useApp();
  const router = useRouter();
  const [outcome, setOutcomeState] = useState<Outcome | null | undefined>(undefined);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    if (!WEB_QR_CHECKIN) return;
    const o = getOutcome();
    // A reload loses the result and the token: start again from sign-in when the code is still there.
    if (!o && getQ()) { router.replace(CHECKIN_ROUTES.signin); return; }
    setOutcomeState(o);
  }, [router]);

  const finish = () => { clearAll(); setSignedOut(true); };
  if (signedOut) return <SignedOutNotice />;
  if (outcome === undefined) return null;
  if (!outcome) return <Notice testId="web-checkin-no-result" title={t('web.checkin.done.noResultTitle')} body={t('web.checkin.done.noResultBody')} />;

  const when = outcome.kind === 'success' ? formatEat(outcome.timestamp, locale) : null;
  const time = when ? `${when} ${t('web.checkin.tz.eat')}` : '';
  const ok = outcome.kind === 'success';
  const idem = ok && outcome.idempotent;
  return (
    <section className="space-y-4 pt-6 text-center" data-testid="web-checkin-done" data-outcome={ok ? (idem ? 'already' : 'success') : outcome.code}>
      {ok
        ? <CheckCircle2 aria-hidden="true" className="mx-auto h-12 w-12 text-[var(--color-success-600)]" />
        : <XCircle aria-hidden="true" className="mx-auto h-12 w-12 text-[var(--color-error-600)]" />}
      <h1 className="break-words text-2xl font-semibold tracking-tight text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">
        {ok ? t(idem ? 'web.checkin.done.idempotentTitle' : 'web.checkin.done.successTitle') : t('web.checkin.done.errorTitle')}
      </h1>
      {ok ? (
        <div className="space-y-1 break-words text-sm text-[var(--color-fg-secondary)] [overflow-wrap:anywhere]">
          <p data-testid="web-checkin-done-body">{fmt(t(idem ? 'web.checkin.done.idempotentBody' : 'web.checkin.done.successBody'), { name: outcome.gymName, time })}</p>
          {outcome.visitNumber !== null && <p data-testid="web-checkin-done-visit">{fmt(t('web.checkin.done.visitNumber'), { n: outcome.visitNumber })}</p>}
        </div>
      ) : (
        <p className="break-words text-sm text-[var(--color-fg-secondary)] [overflow-wrap:anywhere]" data-testid="web-checkin-done-error">{t(ERROR_KEYS[outcome.code])}</p>
      )}
      <Button type="button" size="lg" className="w-full" onClick={finish} data-testid="web-checkin-done-button">{t('web.checkin.done.button')}</Button>
    </section>
  );
}
