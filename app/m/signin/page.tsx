'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '../../providers';
import { MemberFrame, card, input, linkCls, muted, primaryBtn } from '@/components/member/member-frame';
import { loadSession, MEMBER_ROUTES, signIn, type MemberCode } from '@/lib/member-api';
import { ERROR_KEYS, pinLoginAvailable, type CheckinCode } from '@/lib/web-checkin';
import type { MessageKey } from '@/lib/i18n';

export default function MemberSignInPage() {
  return <MemberFrame testId="member-signin-page" needsSession={false}>{() => <SignInForm />}</MemberFrame>;
}

function messageFor(code: MemberCode): MessageKey {
  if (code === 'not_member') return 'member.signin.notMember';
  if (code === 'unavailable') return 'member.signin.unavailable';
  return ERROR_KEYS[code as CheckinCode] ?? 'web.checkin.err.unknown';
}

function SignInForm() {
  const { t } = useApp();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [error, setError] = useState<MemberCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(false);
  const [available, setAvailable] = useState(true);
  const sending = useRef(false);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loadSession()) { router.replace(MEMBER_ROUTES.home); return; }
    let live = true;
    // Only a definite "PIN sign-in is off" hides the form; a failed or slow check leaves it usable.
    void pinLoginAvailable().then(a => { if (live && a === 'off') setAvailable(false); });
    return () => { live = false; };
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    setError(null);
    if (!/^\d{4}$/.test(pin)) { setPinError(true); pinRef.current?.focus(); return; }
    setPinError(false);
    sending.current = true; setBusy(true);
    const r = await signIn(identifier, pin, keep);
    setPin('');
    if (r.ok) { router.replace(MEMBER_ROUTES.home); return; }
    sending.current = false; setBusy(false);
    if (r.code === 'unavailable') { setAvailable(false); return; }
    // Locked and switched-off look the same to the person: do not reveal which.
    setError(r.code === 'pin_reset_required' ? 'locked' : r.code);
    if (r.code === 'wrong_pin') pinRef.current?.focus();
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-extrabold tracking-tight">{t('member.signin.title')}</h1>
      <p className={`mt-2 ${muted}`}>{t('member.signin.intro')}</p>
      {!available ? (
        <div role="alert" className={`${card} mt-6`} data-testid="member-signin-unavailable">{t('member.signin.unavailable')}</div>
      ) : (
        <form onSubmit={submit} noValidate className={`${card} mt-6 flex flex-col gap-5`}>
          {error && <div role="alert" data-testid="member-signin-error" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]">{t(messageFor(error))}</div>}
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t('member.signin.identifier')}
            <input className={input} value={identifier} onChange={e => setIdentifier(e.target.value)} required
              autoComplete="username" inputMode="email" placeholder={t('member.signin.identifierHint')} data-testid="member-signin-identifier" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t('member.signin.pin')}
            <input ref={pinRef} className={`${input} tracking-[0.5em]`} value={pin} required type="password" inputMode="numeric" maxLength={4}
              autoComplete="current-password" aria-invalid={pinError || undefined} aria-describedby="member-pin-hint"
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} data-testid="member-signin-pin" />
            <span id="member-pin-hint" className={`font-normal ${pinError ? 'text-[#ff8a6b]' : muted}`}>{pinError ? t('member.signin.pinInvalid') : t('member.signin.pinHint')}</span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} className="mt-0.5 h-5 w-5 flex-none accent-[#c8f04a]" data-testid="member-signin-keep" />
            <span className="flex flex-col">{t('member.signin.keep')}<span className={`text-xs ${muted}`}>{t('member.signin.keepHint')}</span></span>
          </label>
          <button type="submit" className={primaryBtn} disabled={busy || !identifier.trim()} data-testid="member-signin-submit">
            {busy ? t('member.signin.busy') : t('member.signin.submit')}
          </button>
          <p className={`text-sm ${muted}`}>{t('member.signin.forgot')}</p>
        </form>
      )}
      <p className={`mt-6 text-sm ${muted}`}><Link href="/login/" className={linkCls}>{t('member.signin.staff')}</Link></p>
    </div>
  );
}
