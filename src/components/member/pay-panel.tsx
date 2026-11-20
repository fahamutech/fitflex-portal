'use client';
// Paying for a FitFlex Pass on the web (design: Portal-Pass and Portal-Pay-Mobile). The pass is paid only when the
// server says so (decision P2): the page asks the phone to approve, then reads the result back from
// /me/payments/:id/mobile-money/refresh. Nothing here marks anything paid on its own.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { useApp } from '../../../app/providers';
import { card, ghostBtn, input, muted, primaryBtn } from './member-frame';
import { fmt } from './member-shared';
import { MEMBER_PASSTHROUGH, MOMO_WALLETS, canPayByMobileMoney, formatTzs, MEMBER_ROUTES, MemberApiError, memberApi, momoWalletGuess, type MemberCode, type MomoWallet, type PaymentOptions } from '@/lib/member-api';
import { ERROR_KEYS, type CheckinCode } from '@/lib/web-checkin';
import type { MessageKey } from '@/lib/i18n';

/**
 * What is being paid. `create` makes the payment request (once; it is then reused for retries); without it,
 * `paymentId` is an existing request. It is paid by the phone prompt (AzamPay, the only payment method).
 */
export interface PayTarget {
  label: string; amountTzs: number; product: 'FITFLEX_PASS' | 'GYM_SUBSCRIPTION' | 'TRAINER_SERVICE' | 'EVENT_ORDER'; paymentId?: string;
  /** Makes the request and answers its id and the amount the server set on it (what is then shown). */
  create?: () => Promise<{ id: string; amountTzs: number }>;
  doneTitleKey?: MessageKey; doneBody?: string; doneHref?: string;
}
type Step = 'form' | 'waiting' | 'slow' | 'done' | 'failed' | 'held' | 'expired';

const POLL_MS = 4000;
const POLL_MAX = 45; // about three minutes, then "still waiting"

/** The message for an error code: the member portal's own, else the shared sign-in/check-in one. */
export function errorKey(code: MemberCode): MessageKey {
  const own = `member.err.${code}` as MessageKey;
  return (MEMBER_ERR.has(code) ? own : ERROR_KEYS[code as CheckinCode]) ?? 'web.checkin.err.unknown';
}
const MEMBER_ERR = MEMBER_PASSTHROUGH;

export function PayPanel({ target, options, defaultPhone, onBack }: { target: PayTarget; options: PaymentOptions | null; defaultPhone: string; onBack: () => void }) {
  const { t, locale } = useApp();
  const mobile = canPayByMobileMoney(options, target.product);
  // AzamPay asks which wallet pays (the same rule as the mobile app's picker): guessed from the number until the member
  // picks one; a pick wins and is never changed by later typing.
  const picksWallet = options?.provider === 'azampay';
  const [phone, setPhone] = useState(defaultPhone);
  const [wallet, setWallet] = useState<MomoWallet | null>(() => momoWalletGuess(defaultPhone));
  const [walletPicked, setWalletPicked] = useState(false);
  const [walletError, setWalletError] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MemberCode | null>(null);
  const paymentId = useRef<string | null>(target.paymentId ?? null);
  const polls = useRef(0);
  const timer = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The amount the server set on the request once it exists (it always charges that one); the page's price before.
  const [serverAmount, setServerAmount] = useState<number | null>(null);
  const amount = formatTzs(serverAmount ?? target.amountTzs, locale);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useEffect(() => { if (step !== 'form') headingRef.current?.focus(); }, [step]);

  /** The payment request to pay: the existing one, or a new one for this pass (created once, then reused). */
  async function ensureRequest(): Promise<string> {
    if (paymentId.current) return paymentId.current;
    if (!target.create) throw new MemberApiError(409, 'payment_not_pending');
    const made = await target.create();
    paymentId.current = made.id;
    if (Number.isFinite(made.amountTzs)) setServerAmount(made.amountTzs);
    return made.id;
  }

  async function check() {
    if (!paymentId.current) return;
    try {
      const r = await memberApi.refreshMobileMoney(paymentId.current);
      if (r.state === 'completed') { setStep('done'); return; }
      if (r.state === 'failed') { setStep('failed'); return; }
      if (r.state === 'held') { setStep('held'); return; }
      // The prompt was not answered in time and the server gave the request back: it can be sent again.
      if (r.state === 'none') { setStep('expired'); return; }
    } catch { /* a failed check is retried on the next tick */ }
    polls.current += 1;
    if (polls.current >= POLL_MAX) { setStep('slow'); return; }
    timer.current = window.setTimeout(() => { void check(); }, POLL_MS);
  }

  async function sendMobile(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (timer.current) window.clearTimeout(timer.current);
    setError(null); setWalletError(false);
    if (picksWallet && !wallet) { setWalletError(true); setStep('form'); return; }
    setBusy(true);
    try {
      const id = await ensureRequest();
      const r = await memberApi.payByMobileMoney(id, phone.trim(), picksWallet ? wallet : null);
      if (r.state === 'completed') { setStep('done'); return; }
      polls.current = 0; setStep('waiting');
      timer.current = window.setTimeout(() => { void check(); }, POLL_MS);
    } catch (err) {
      const code: MemberCode = err instanceof MemberApiError ? err.code : 'unknown';
      // The server could not tell the wallet from the number: ask for it beside the wallet choice.
      if (picksWallet && code === 'network_required') setWalletError(true); else setError(code);
      setStep('form');
    } finally { setBusy(false); }
  }
  const phoneChanged = (v: string) => { setPhone(v); if (picksWallet && !walletPicked) setWallet(momoWalletGuess(v)); };

  const checkNow = () => { if (timer.current) window.clearTimeout(timer.current); polls.current = 0; setStep('waiting'); void check(); };
  const retry = () => { if (timer.current) window.clearTimeout(timer.current); setStep('form'); };

  const Summary = (
    <p className="text-lg font-bold tabular-nums" data-testid="member-pay-summary">{fmt(t('member.pay.summary'), { tier: target.label, amount })}</p>
  );
  const ErrorBox = error && (
    <div role="alert" data-testid="member-pay-error" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]">{t(errorKey(error))}</div>
  );

  if (step === 'done') {
    return (
      <section className={`${card} flex flex-col items-center gap-4 text-center`} data-testid="member-pay-done">
        <CheckCircle2 aria-hidden="true" className="h-16 w-16 text-[#3dd98e]" />
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">{t(target.doneTitleKey ?? 'member.pay.doneTitle')}</h2>
        <p>{target.doneBody ?? fmt(t('member.pay.doneBody'), { tier: target.label })}</p>
        <Link href={target.doneHref ?? MEMBER_ROUTES.home} className={primaryBtn}>{t(target.doneHref ? 'member.pay.done' : 'member.pay.backToday')}</Link>
      </section>
    );
  }
  if (step === 'expired') {
    return (
      <section className={`${card} flex flex-col gap-4`} data-testid="member-pay-expired">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">{t('member.pay.expiredTitle')}</h2>
        <p className={muted}>{t('member.pay.expiredBody')}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void sendMobile()} data-testid="member-pay-send-again">{busy ? t('member.pay.sending') : t('member.pay.sendAgain')}</button>
          <Link href={MEMBER_ROUTES.home} className={ghostBtn}>{t('member.pay.backToday')}</Link>
        </div>
      </section>
    );
  }
  if (step === 'held' || step === 'slow') {
    const [title, body] = step === 'held' ? ['member.pay.heldTitle', 'member.pay.heldBody'] : ['member.pay.slowTitle', 'member.pay.slowBody'];
    return (
      <section className={`${card} flex flex-col gap-4`} data-testid={`member-pay-${step}`}>
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">{t(title as MessageKey)}</h2>
        <p className={muted}>{t(body as MessageKey)}</p>
        <div className="flex flex-wrap gap-3">
          {step === 'slow' && <button type="button" className={primaryBtn} onClick={checkNow}>{t('member.pay.checkNow')}</button>}
          <Link href={MEMBER_ROUTES.home} className={ghostBtn}>{t('member.pay.backToday')}</Link>
        </div>
      </section>
    );
  }
  if (step === 'failed') {
    return (
      <section className={`${card} flex flex-col gap-4`} data-testid="member-pay-failed">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">{t('member.pay.failedTitle')}</h2>
        <p className={muted}>{t('member.pay.failedBody')}</p>
        <button type="button" className={`${primaryBtn} self-start`} onClick={retry}>{t('member.pay.tryAgain')}</button>
      </section>
    );
  }
  if (step === 'waiting') {
    return (
      <section className={`${card} flex flex-col items-center gap-4 text-center`} data-testid="member-pay-waiting">
        <div aria-hidden="true" className="h-20 w-20 animate-spin rounded-full border-[6px] border-[#1e293b] border-t-[#c8f04a] motion-reduce:animate-none" />
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">{t('member.pay.waitTitle')}</h2>
        <p>{fmt(t('member.pay.waitBody'), { amount, phone: phone.trim() })}</p>
        <p role="status" className={`rounded-xl border border-[#1e293b] px-4 py-3 text-sm ${muted}`}>{t('member.pay.waitStatus')}</p>
        <button type="button" className={ghostBtn} onClick={checkNow}>{t('member.pay.checkNow')}</button>
      </section>
    );
  }

  // step === 'form'
  if (mobile) {
    return (
      <form onSubmit={sendMobile} noValidate className={`${card} flex flex-col gap-5`} data-testid="member-pay-mobile">
        {Summary}
        {options?.environment === 'sandbox' && <p className="rounded-xl bg-[#fef0c7] px-4 py-2 text-sm text-[#7a2e0e]">{t('member.pay.sandbox')}</p>}
        {ErrorBox}
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {t('member.pay.phone')}
          <input className={input} value={phone} onChange={e => phoneChanged(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required data-testid="member-pay-phone" />
          <span className={`font-normal ${muted}`}>{t('member.pay.phoneHint')}</span>
        </label>
        {picksWallet && (
          <fieldset className="flex flex-col gap-2" data-testid="member-pay-wallets" aria-describedby={walletError ? 'member-pay-wallet-error' : undefined}>
            <legend className="mb-2 text-sm font-semibold">{t('member.pay.wallet')}</legend>
            <div className="flex flex-wrap gap-2">
              {MOMO_WALLETS.map(w => (
                <label key={w} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold ${wallet === w ? 'border-2 border-[#c8f04a]' : 'border border-[#334155]'}`}>
                  <input type="radio" name="member-pay-wallet" value={w} checked={wallet === w} disabled={busy} className="h-5 w-5 accent-[#c8f04a]"
                    onChange={() => { setWallet(w); setWalletPicked(true); setWalletError(false); }} data-testid={`member-pay-wallet-${w}`} />
                  {t(`member.pay.wallet.${w}` as MessageKey)}
                </label>
              ))}
            </div>
            {walletError && <p id="member-pay-wallet-error" role="alert" className="text-sm text-[#ff8a6b]" data-testid="member-pay-wallet-error">{t('member.err.network_required')}</p>}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryBtn} disabled={busy || !phone.trim()} data-testid="member-pay-send">{busy ? t('member.pay.sending') : t('member.pay.send')}</button>
          <button type="button" className={ghostBtn} onClick={onBack}>{t('member.pay.cancel')}</button>
        </div>
      </form>
    );
  }
  return (
    <section className={`${card} flex flex-col gap-4`} data-testid="member-pay-not-on-web">
      {Summary}
      <p>{t('member.pay.notOnWeb')}</p>
      <button type="button" className={`${ghostBtn} self-start`} onClick={onBack}>{t('member.pay.cancel')}</button>
    </section>
  );
}
