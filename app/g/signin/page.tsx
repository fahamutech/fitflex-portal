'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../providers';
import { Alert, Button, Field, Spinner } from '@/components/shared';
import { Notice, WebCheckinFrame } from '@/components/web-checkin-frame';
import { WEB_QR_CHECKIN } from '@/lib/flags';
import { CHECKIN_ROUTES, ERROR_KEYS, getQ, getSessionToken, pinLoginAvailable, signInWithPin, takeResumeCode, type CheckinCode } from '@/lib/web-checkin';

type Avail = 'checking' | 'yes' | 'no';

export default function WebCheckinSignInPage() {
  return <WebCheckinFrame testId="web-checkin-signin-page"><SignIn /></WebCheckinFrame>;
}

function SignIn() {
  const { t } = useApp();
  const router = useRouter();
  const [hasCode, setHasCode] = useState<boolean | null>(null);
  const [avail, setAvail] = useState<Avail>('checking');
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [error, setError] = useState<CheckinCode | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!WEB_QR_CHECKIN) return;
    if (getSessionToken()) { router.replace(CHECKIN_ROUTES.confirm); return; }
    const has = !!getQ();
    setHasCode(has);
    const resumed = takeResumeCode();
    if (resumed) setError(resumed);
    if (!has) return;
    let live = true;
    // Only a definite "PIN sign-in is off" hides the form; a failed or slow check leaves it usable.
    void pinLoginAvailable().then(a => { if (live) setAvail(a === 'off' ? 'no' : 'yes'); });
    return () => { live = false; };
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    setError(null);
    if (!/^\d{4}$/.test(pin)) { setPinError(true); pinRef.current?.focus(); return; }
    setPinError(false);
    sending.current = true;
    setBusy(true);
    const r = await signInWithPin(identifier, pin);
    setPin('');
    if (r.ok) { router.replace(CHECKIN_ROUTES.confirm); return; }
    sending.current = false;
    setBusy(false);
    // 404 on sign-in means PIN sign-in is switched off on the server: say so rather than "wrong PIN".
    if (r.code === 'unavailable') setAvail('no');
    // Locked and switched-off look the same to the person: do not reveal which.
    setError(r.code === 'pin_reset_required' ? 'locked' : r.code);
    if (r.code === 'wrong_pin') pinRef.current?.focus();
  }

  if (hasCode === null || (hasCode && avail === 'checking')) {
    return <p className="py-16 text-center text-sm text-[var(--color-fg-tertiary)]" role="status" data-testid="web-checkin-checking">{t('web.checkin.signin.checking')}</p>;
  }
  if (!hasCode) return <Notice testId="web-checkin-no-code" title={t('web.checkin.noCodeTitle')} body={t('web.checkin.noCodeBody')} />;
  if (avail === 'no') return <Notice testId="web-checkin-pin-off" title={t('web.checkin.signin.notReadyTitle')} body={t('web.checkin.signin.notReadyBody')} />;

  return (
    <form onSubmit={submit} className="space-y-4 pt-4" noValidate data-testid="web-checkin-signin-form">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg-primary)]">{t('web.checkin.signin.title')}</h1>
        <p className="text-sm text-[var(--color-fg-tertiary)]">{t('web.checkin.signin.intro')}</p>
      </header>
      {error && <Alert tone="error"><span data-testid="web-checkin-signin-error" data-code={error}>{t(ERROR_KEYS[error])}</span></Alert>}
      <Field label={t('web.checkin.signin.identifier')} required>
        <input
          type="text" inputMode="email" className="ui-input" value={identifier} required
          onChange={e => setIdentifier(e.target.value)} autoComplete="off" name="ff-checkin-contact" autoCapitalize="none" spellCheck={false}
          data-testid="web-checkin-identifier"
        />
      </Field>
      <Field label={t('web.checkin.signin.pin')} required error={pinError ? t('web.checkin.signin.pinFormat') : undefined}>
        <input
          ref={pinRef} type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} className="ui-input" value={pin} required
          onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(false); }}
          autoComplete="one-time-code" name="ff-checkin-code" data-testid="web-checkin-pin"
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={busy || !identifier.trim()} data-testid="web-checkin-signin-submit">
        {busy ? <><Spinner className="h-4 w-4 text-white" /> {t('web.checkin.signin.busy')}</> : t('web.checkin.signin.submit')}
      </Button>
      <p className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] px-4 py-3 text-xs text-[var(--color-fg-tertiary)]" data-testid="web-checkin-signin-notproof">
        {t('web.checkin.signin.notProof')}
      </p>
    </form>
  );
}
