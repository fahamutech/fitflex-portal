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
import { MEMBER_PASSTHROUGH, canPayByMobileMoney, instructionsText, formatTzs, MEMBER_ROUTES, MemberApiError, memberApi, type MemberCode, type PaymentOptions } from '@/lib/member-api';
import { ERROR_KEYS, type CheckinCode } from '@/lib/web-checkin';
import type { MessageKey } from '@/lib/i18n';

/**
 * What is being paid. `create` makes the payment request (once; it is then reused for retries); without it,
 * `paymentId` is an existing request. `manual` allows the Lipa Namba path (passes only: the server takes the
 * transaction ID when the request is created).
 */
export interface PayTarget {
  label: string; amountTzs: number; product: 'FITFLEX_PASS' | 'TRAINER_SERVICE' | 'EVENT_ORDER'; paymentId?: string;
  create?: (extra?: { reference: string; payerPhone: string }) => Promise<string>; manual?: boolean;
  doneTitleKey?: MessageKey; doneBody?: string; doneHref?: string;
}
type Step = 'form' | 'waiting' | 'slow' | 'done' | 'failed' | 'held' | 'manual_done';

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
  const manual = !mobile && target.manual && target.create && options?.manual?.enabled ? options.manual : null;
  const [phone, setPhone] = useState(defaultPhone);
  const [reference, setReference] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MemberCode | null>(null);
  const paymentId = useRef<string | null>(target.paymentId ?? null);
  const polls = useRef(0);
  const timer = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const amount = formatTzs(target.amountTzs, locale);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useEffect(() => { if (step !== 'form') headingRef.current?.focus(); }, [step]);

  /** The payment request to pay: the existing one, or a new one for this pass (created once, then reused). */
  async function ensureRequest(extra?: { reference: string; payerPhone: string }): Promise<string> {
    if (paymentId.current) return paymentId.current;
    if (!target.create) throw new MemberApiError(409, 'payment_not_pending');
    paymentId.current = await target.create(extra);
    return paymentId.current;
  }

  async function check() {
    if (!paymentId.current) return;
    try {
      const r = await memberApi.refreshMobileMoney(paymentId.current);
      if (r.state === 'completed') { setStep('done'); return; }
      if (r.state === 'failed') { setStep('failed'); return; }
      if (r.state === 'held') { setStep('held'); return; }
    } catch { /* a failed check is retried on the next tick */ }
    polls.current += 1;
    if (polls.current >= POLL_MAX) { setStep('slow'); return; }
    timer.current = window.setTimeout(() => { void check(); }, POLL_MS);
  }

  async function sendMobile(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setError(null); setBusy(true);
    try {
      const id = await ensureRequest();
      const r = await memberApi.payByMobileMoney(id, phone.trim());
      if (r.state === 'completed') { setStep('done'); return; }
      polls.current = 0; setStep('waiting');
      timer.current = window.setTimeout(() => { void check(); }, POLL_MS);
    } catch (err) {
      setError(err instanceof MemberApiError ? err.code : 'unknown');
    } finally { setBusy(false); }
  }

  async function sendManual(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null); setBusy(true);
    try {
      await ensureRequest({ reference: reference.trim(), payerPhone: phone.trim() });
      setStep('manual_done');
    } catch (err) {
      setError(err instanceof MemberApiError ? err.code : 'unknown');
    } finally { setBusy(false); }
  }

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
        <Link href={target.doneHref ?? MEMBER_ROUTES.home} className={primaryBtn}>{t('member.pay.backToday')}</Link>
      </section>
    );
  }
  if (step === 'manual_done' || step === 'held' || step === 'slow') {
    const [title, body] = step === 'manual_done' ? ['member.pay.manualDoneTitle', 'member.pay.manualDoneBody']
      : step === 'held' ? ['member.pay.heldTitle', 'member.pay.heldBody'] : ['member.pay.slowTitle', 'member.pay.slowBody'];
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
          <input className={input} value={phone} onChange={e => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required data-testid="member-pay-phone" />
          <span className={`font-normal ${muted}`}>{t('member.pay.phoneHint')}</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryBtn} disabled={busy || !phone.trim()} data-testid="member-pay-send">{busy ? t('member.pay.sending') : t('member.pay.send')}</button>
          <button type="button" className={ghostBtn} onClick={onBack}>{t('member.pay.cancel')}</button>
        </div>
      </form>
    );
  }
  if (manual) {
    return (
      <form onSubmit={sendManual} noValidate className={`${card} flex flex-col gap-5`} data-testid="member-pay-manual">
        {Summary}
        <div>
          <h2 className="text-xl font-extrabold">{t('member.pay.manualTitle')}</h2>
          <p className={`mt-1 ${muted}`}>{fmt(t('member.pay.manualBody'), { amount })}</p>
        </div>
        <dl className="grid gap-3 rounded-2xl border border-[#1e293b] bg-[#020617] p-4 sm:grid-cols-2">
          <div><dt className={`text-sm ${muted}`}>{t('member.pay.manualNumber')}</dt><dd className="font-mono text-xl font-bold">{manual.lipaNamba}</dd></div>
          <div><dt className={`text-sm ${muted}`}>{t('member.pay.manualName')}</dt><dd className="font-bold">{manual.accountName}{manual.network ? ` · ${manual.network}` : ''}</dd></div>
        </dl>
        {instructionsText(manual, locale) && <p className={`text-sm ${muted}`}>{instructionsText(manual, locale)}</p>}
        {ErrorBox}
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {t('member.pay.manualRef')}
          <input className={`${input} font-mono uppercase`} value={reference} onChange={e => setReference(e.target.value)} autoComplete="off" required data-testid="member-pay-reference" />
          <span className={`font-normal ${muted}`}>{t('member.pay.manualRefHint')}</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {t('member.pay.manualPhone')}
          <input className={input} value={phone} onChange={e => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required data-testid="member-pay-payer-phone" />
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryBtn} disabled={busy || !reference.trim() || !phone.trim()} data-testid="member-pay-manual-submit">{t('member.pay.manualSubmit')}</button>
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
