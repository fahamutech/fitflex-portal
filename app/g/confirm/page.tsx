'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../providers';
import { Alert, Button, Spinner } from '@/components/shared';
import { Notice, SignedOutNotice, WebCheckinFrame } from '@/components/web-checkin-frame';
import { WEB_QR_CHECKIN } from '@/lib/flags';
import { fmt } from '@/lib/vendor';
import {
  CHECKIN_ROUTES, ERROR_KEYS, clearAll, confirmCheckin, getQ, getSessionToken, newIdempotencyKey, previewCheckin, setOutcome,
  setResumeCode, type CheckinCode, type Preview,
} from '@/lib/web-checkin';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: Preview }
  | { kind: 'error'; code: CheckinCode }
  | { kind: 'no_code' }
  | { kind: 'signed_out' };

export default function WebCheckinConfirmPage() {
  return <WebCheckinFrame testId="web-checkin-confirm-page"><Confirm /></WebCheckinFrame>;
}

function Confirm() {
  const { t } = useApp();
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [renewed, setRenewed] = useState(false);
  const sending = useRef(false);
  const started = useRef(false);
  // One key per confirm attempt on this screen; the same key is reused if the person taps again after a failure.
  const keyRef = useRef<string | null>(null);

  const backToSignIn = useCallback((code: CheckinCode) => { setResumeCode(code); router.replace(CHECKIN_ROUTES.signin); }, [router]);

  const load = useCallback(async () => {
    setView({ kind: 'loading' });
    const r = await previewCheckin();
    if (r.ok) { setView({ kind: 'ready', preview: r.preview }); return; }
    if (r.code === 'unauthorized') { backToSignIn('unauthorized'); return; }
    setView({ kind: 'error', code: r.code });
  }, [backToSignIn]);

  useEffect(() => {
    if (!WEB_QR_CHECKIN || started.current) return;
    started.current = true;
    if (!getSessionToken()) {
      if (getQ()) router.replace(CHECKIN_ROUTES.signin); else setView({ kind: 'no_code' });
      return;
    }
    void load();
  }, [load, router]);

  async function confirm() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setRenewed(false);
    keyRef.current = keyRef.current ?? newIdempotencyKey();
    const r = await confirmCheckin(keyRef.current);
    if (r.ok) { setOutcome(r.outcome); router.replace(CHECKIN_ROUTES.done); return; }
    if (r.code === 'unauthorized') { backToSignIn('unauthorized'); return; }
    if (r.code === 'intent_expired' || r.code === 'invalid_intent') {
      // Renew the link with the stored code and ask again; nothing is confirmed without another tap.
      sending.current = false;
      setBusy(false);
      await load();
      setRenewed(true);
      return;
    }
    if (r.code === 'network' || r.code === 'server_error' || r.code === 'rate_limited') {
      // Not decided on the server as far as we know: stay here so the same tap can be repeated with the same key.
      sending.current = false;
      setBusy(false);
      setView({ kind: 'error', code: r.code });
      return;
    }
    setOutcome({ kind: 'error', code: r.code });
    router.replace(CHECKIN_ROUTES.done);
  }

  if (view.kind === 'signed_out') return <SignedOutNotice />;
  if (view.kind === 'no_code') return <Notice testId="web-checkin-no-code" title={t('web.checkin.noCodeTitle')} body={t('web.checkin.noCodeBody')} />;
  if (view.kind === 'loading') {
    return <p className="py-16 text-center text-sm text-[var(--color-fg-tertiary)]" role="status" data-testid="web-checkin-loading">{t('web.checkin.confirm.loading')}</p>;
  }
  if (view.kind === 'error') {
    const unavailable = view.code === 'unavailable';
    return (
      <Notice
        testId="web-checkin-confirm-error"
        title={unavailable ? t('web.checkin.unavailableTitle') : t(ERROR_KEYS[view.code])}
        body={unavailable ? t('web.checkin.unavailableBody') : undefined}
        action={!unavailable && (
          <Button onClick={() => void load()} data-testid="web-checkin-retry">{t('web.checkin.confirm.retry')}</Button>
        )}
      />
    );
  }

  const p = view.preview;
  const name = p.gymName;
  const signOut = () => { clearAll(); setView({ kind: 'signed_out' }); };
  const cancel = (
    <Button type="button" variant="secondary" className="w-full" onClick={signOut} data-testid="web-checkin-cancel">{t('web.checkin.confirm.cancel')}</Button>
  );

  if (p.alreadyCheckedIn) {
    return (
      <section className="space-y-4 pt-4" data-testid="web-checkin-already">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg-primary)]">{t('web.checkin.confirm.already')}</h1>
        <p className="text-sm text-[var(--color-fg-secondary)]">{fmt(t('web.checkin.confirm.alreadyBody'), { name })}</p>
        <Button type="button" size="lg" className="w-full" onClick={signOut} data-testid="web-checkin-already-done">{t('web.checkin.done.button')}</Button>
      </section>
    );
  }

  return (
    <section className="space-y-4 pt-4" data-testid="web-checkin-confirm">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg-primary)]" data-testid="web-checkin-confirm-title">
        {fmt(t('web.checkin.confirm.title'), { name })}
      </h1>
      {renewed && <Alert tone="info"><span data-testid="web-checkin-renewed">{t('web.checkin.confirm.renewed')}</span></Alert>}
      {p.eligible ? (
        <div className="space-y-1 text-sm text-[var(--color-fg-secondary)]" data-testid="web-checkin-eligible">
          <p>{t('web.checkin.confirm.eligible')}</p>
          {p.visitsLeft !== null && <p className="font-medium text-[var(--color-fg-primary)]" data-testid="web-checkin-visits-left">{fmt(t('web.checkin.confirm.visitsLeft'), { n: p.visitsLeft })}</p>}
        </div>
      ) : (
        <div className="space-y-2" data-testid="web-checkin-ineligible">
          <Alert tone="warning"><span data-testid="web-checkin-reason" data-code={p.reason ?? 'unknown'}>{t(ERROR_KEYS[p.reason ?? 'unknown'])}</span></Alert>
          <p className="text-sm text-[var(--color-fg-tertiary)]">{t('web.checkin.confirm.cannot')} {t('web.checkin.confirm.buyHint')}</p>
        </div>
      )}
      <Button
        type="button" size="lg" className="w-full" disabled={!p.eligible || busy} aria-busy={busy} onClick={() => void confirm()}
        data-testid="web-checkin-confirm-button"
      >
        {busy ? <><Spinner className="h-4 w-4 text-white" /> {t('web.checkin.confirm.sending')}</> : t('web.checkin.confirm.button')}
      </Button>
      {cancel}
      <p className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] px-4 py-3 text-xs text-[var(--color-fg-tertiary)]" data-testid="web-checkin-confirm-notproof">
        {t('web.checkin.confirm.notProof')}
      </p>
    </section>
  );
}
