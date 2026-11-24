'use client';
// Paying on the member web pages (design: Portal-Pass and Portal-Pay-Mobile). A request is paid only when the server
// says so (decision P2): the page starts a payment (a phone prompt, a bank checkout or AzamPay's payment page), then
// reads the result back from the server's refresh route. Nothing here marks anything paid on its own.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { useApp } from '../../../app/providers';
import { card, ghostBtn, input, linkCls, muted, primaryBtn } from './member-frame';
import { fmt } from './member-shared';
import {
  MEMBER_PASSTHROUGH, MOMO_WALLETS, canPayByMobileMoney, formatTzs, httpsUrl, MEMBER_ROUTES, MemberApiError, memberApi, momoWalletGuess,
  type MemberCode, type MomoWallet, type PayMethod, type PayReply, type PaymentOptions,
} from '@/lib/member-api';
import { ERROR_KEYS, type CheckinCode } from '@/lib/web-checkin';
import type { MessageKey } from '@/lib/i18n';

/**
 * What is being paid. `create` makes the payment request (once; it is then reused for retries); without it,
 * `paymentId` is an existing request. It is paid through AzamPay, the only payment method.
 */
export interface PayTarget {
  label: string; amountTzs: number; product: 'FITFLEX_PASS' | 'GYM_SUBSCRIPTION' | 'TRAINER_SERVICE' | 'EVENT_ORDER' | 'SHOP_ORDER'; paymentId?: string;
  /** Makes the request and answers its id and the amount the server set on it (what is then shown). */
  create?: () => Promise<{ id: string; amountTzs: number }>;
  doneTitleKey?: MessageKey; doneBody?: string; doneHref?: string;
}
type Step = 'form' | 'waiting' | 'slow' | 'done' | 'failed' | 'held' | 'expired';

const POLL_MS = 4000;
const POLL_MAX = 45; // about three minutes, then "still waiting"
// The server's own rules for a bank checkout (PAYMENTS_AZAMPAY.md): checked here first so no request is made for a typo.
const ACCOUNT_RE = /^[A-Za-z0-9\-/ ]{5,30}$/;
const OTP_RE = /^[A-Za-z0-9]{4,12}$/;
// How a payer gets the one-time code from their own bank (AzamPay's steps). A bank without steps here shows none.
const BANK_STEPS: Record<string, MessageKey[]> = {
  CRDB: ['member.pay.bank.steps.CRDB.1', 'member.pay.bank.steps.CRDB.2', 'member.pay.bank.steps.CRDB.3', 'member.pay.bank.steps.CRDB.4', 'member.pay.bank.steps.CRDB.5'],
  NMB: ['member.pay.bank.steps.NMB.1', 'member.pay.bank.steps.NMB.2', 'member.pay.bank.steps.NMB.3', 'member.pay.bank.steps.NMB.4'],
};
const METHOD_KEYS: Record<PayMethod, MessageKey> = {
  mobile_money: 'member.pay.method.mobile_money', bank: 'member.pay.method.bank', page: 'member.pay.method.page',
};
// Refusals that all mean "not this way, now": one message.
const METHOD_UNAVAILABLE = new Set<string>(['not_payable_this_way', 'return_not_configured', 'invalid_return_to', 'invalid_language']);

/** The message for an error code: the member portal's own, else the shared sign-in/check-in one. */
export function errorKey(code: MemberCode): MessageKey {
  if (METHOD_UNAVAILABLE.has(code)) return 'member.err.method_unavailable';
  const own = `member.err.${code}` as MessageKey;
  return (MEMBER_ERR.has(code) ? own : ERROR_KEYS[code as CheckinCode]) ?? 'web.checkin.err.unknown';
}
const MEMBER_ERR = MEMBER_PASSTHROUGH;
const radioCard = (on: boolean) => `flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold ${on ? 'border-2 border-[#c8f04a]' : 'border border-[#334155]'}`;

export function PayPanel({ target, options, defaultPhone, onBack }: { target: PayTarget; options: PaymentOptions | null; defaultPhone: string; onBack: () => void }) {
  const { t, locale } = useApp();
  const payable = canPayByMobileMoney(options, target.product);
  // AzamPay asks which wallet pays (the same rule as the mobile app's picker): guessed from the number until the member
  // picks one; a pick wins and is never changed by later typing.
  const picksWallet = options?.provider === 'azampay';
  const [phone, setPhone] = useState(defaultPhone);
  const [wallet, setWallet] = useState<MomoWallet | null>(() => momoWalletGuess(defaultPhone));
  const [walletPicked, setWalletPicked] = useState(false);
  const [walletError, setWalletError] = useState(false);
  const [picked, setPicked] = useState<PayMethod>('mobile_money');
  const [bank, setBank] = useState<string>(() => (options?.bank?.providers?.length === 1 ? options.bank.providers[0] : ''));
  const [account, setAccount] = useState('');
  // The bank's one-time code: held only in this field's state until it is sent, then cleared. Never stored or logged.
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MemberCode | null>(null);
  // The way the open attempt was started (what the waiting screen says) and, for the payment page, where it is.
  const [sent, setSent] = useState<PayMethod>('mobile_money');
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const paymentId = useRef<string | null>(target.paymentId ?? null);
  const polls = useRef(0);
  const timer = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The amount the server set on the request once it exists (it always charges that one); the page's price before.
  const [serverAmount, setServerAmount] = useState<number | null>(null);
  const amountTzs = serverAmount ?? target.amountTzs;
  const amount = formatTzs(amountTzs, locale);

  // The ways to pay the server lists now. An older server lists none (no `methods` key): mobile money only, as before.
  const listed = Array.isArray(options?.methods) ? options.methods : null;
  const banks = (options?.bank?.providers ?? []).filter((b): b is string => typeof b === 'string' && b.length > 0);
  const bankMax = options?.bank?.maxAmountTzs;
  const offered = (listed ?? []).filter((m): m is PayMethod =>
    m === 'mobile_money'
    || (m === 'bank' && banks.length > 0 && !(typeof bankMax === 'number' && amountTzs > bankMax))
    || (m === 'page' && !!options?.page?.returnTo?.includes('web')));
  const ways: PayMethod[] = offered.length > 1 && offered.includes('mobile_money') ? offered : ['mobile_money'];
  const method = ways.includes(picked) ? picked : 'mobile_money';

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useEffect(() => { if (step !== 'form') headingRef.current?.focus(); }, [step]);

  /** The payment request to pay: the existing one, or a new one for this purchase (created once, then reused). */
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
      // A server that lists `methods` has the one refresh for every method; an older one only the mobile-money refresh.
      const r = await (listed ? memberApi.refreshPayment : memberApi.refreshMobileMoney)(paymentId.current);
      if (r.state === 'completed') { setStep('done'); return; }
      if (r.state === 'failed') { setStep('failed'); return; }
      if (r.state === 'held') { setStep('held'); return; }
      // The attempt was not answered in time and the server gave the request back: it can be paid again.
      if (r.state === 'none') { setStep('expired'); return; }
      setPageUrl(httpsUrl(r.checkoutUrl));
    } catch { /* a failed check is retried on the next tick */ }
    polls.current += 1;
    if (polls.current >= POLL_MAX) { setStep('slow'); return; }
    timer.current = window.setTimeout(() => { void check(); }, POLL_MS);
  }

  /** Start one attempt with `call`, then wait for the server to say how it went. */
  async function start(kind: PayMethod, call: (id: string) => Promise<PayReply>) {
    if (timer.current) window.clearTimeout(timer.current);
    setBusy(true);
    try {
      const id = await ensureRequest();
      const r = await call(id);
      if (r.state === 'completed') { setStep('done'); return; }
      const url = httpsUrl(r.checkoutUrl);
      // The payment page is opened only at an https address the server answered; anything else is not followed.
      if (kind === 'page' && !url) throw new MemberApiError(503, 'provider_unavailable');
      // An attempt that was already out (another way) is the one being waited for.
      setSent(r.method === 'mobile_money' || r.method === 'bank' || r.method === 'page' ? r.method : kind);
      setPageUrl(url);
      polls.current = 0; setStep('waiting');
      timer.current = window.setTimeout(() => { void check(); }, POLL_MS);
      if (kind === 'page' && url) window.location.assign(url);
    } catch (err) {
      const code: MemberCode = err instanceof MemberApiError ? err.code : 'unknown';
      // The server could not tell the wallet from the number: ask for it beside the wallet choice.
      if (kind === 'mobile_money' && picksWallet && code === 'network_required') setWalletError(true); else setError(code);
      setStep('form');
    } finally { setBusy(false); }
  }

  async function sendMobile() {
    if (busy) return;
    setError(null); setWalletError(false);
    if (picksWallet && !wallet) { setWalletError(true); setStep('form'); return; }
    await start('mobile_money', id => memberApi.payByMobileMoney(id, phone.trim(), picksWallet ? wallet : null));
  }
  async function sendBank() {
    if (busy) return;
    setError(null);
    const code = otp.trim();
    const problem: MemberCode | null = !banks.includes(bank) ? 'invalid_bank' : !ACCOUNT_RE.test(account.trim()) ? 'invalid_account_number'
      : !phone.trim() ? 'invalid_phone' : !OTP_RE.test(code) ? 'invalid_otp' : null;
    if (problem) { setError(problem); return; }
    // The code is single-use: it leaves this page in the request below and is cleared whatever the answer.
    setOtp('');
    await start('bank', id => memberApi.payByBank(id, { bank, accountNumber: account.trim(), phone: phone.trim(), otp: code }));
  }
  async function sendPage() {
    if (busy) return;
    setError(null);
    const language = options?.page?.languages?.includes(locale) ? locale : undefined;
    await start('page', id => memberApi.checkoutPage(id, { returnTo: 'web', ...(language ? { language } : {}) }));
  }
  const submit = (e: React.FormEvent) => { e.preventDefault(); void (method === 'bank' ? sendBank() : method === 'page' ? sendPage() : sendMobile()); };
  const phoneChanged = (v: string) => { setPhone(v); if (picksWallet && !walletPicked) setWallet(momoWalletGuess(v)); };

  const checkNow = () => { if (timer.current) window.clearTimeout(timer.current); polls.current = 0; setStep('waiting'); void check(); };
  const retry = () => { if (timer.current) window.clearTimeout(timer.current); setStep('form'); };

  const Summary = (
    <p className="text-lg font-bold tabular-nums" data-testid="member-pay-summary">{fmt(t('member.pay.summary'), { tier: target.label, amount })}</p>
  );
  const ErrorBox = error && (
    <div role="alert" data-testid="member-pay-error" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]">{t(errorKey(error))}</div>
  );
  const PageLink = pageUrl && (
    <a href={pageUrl} rel="noopener noreferrer" className={linkCls} data-testid="member-pay-page-link">{t('member.pay.page.openAgain')}</a>
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
    const prompt = sent === 'mobile_money';
    return (
      <section className={`${card} flex flex-col gap-4`} data-testid="member-pay-expired">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">{t(prompt ? 'member.pay.expiredTitle' : 'member.pay.notDoneTitle')}</h2>
        <p className={muted}>{t(prompt ? 'member.pay.expiredBody' : 'member.pay.notDoneBody')}</p>
        <div className="flex flex-wrap gap-3">
          {prompt
            ? <button type="button" className={primaryBtn} disabled={busy} onClick={() => void sendMobile()} data-testid="member-pay-send-again">{busy ? t('member.pay.sending') : t('member.pay.sendAgain')}</button>
            : <button type="button" className={primaryBtn} onClick={retry} data-testid="member-pay-try-again">{t('member.pay.tryAgain')}</button>}
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
        <div className="flex flex-wrap items-center gap-3">
          {step === 'slow' && <button type="button" className={primaryBtn} onClick={checkNow}>{t(sent === 'mobile_money' ? 'member.pay.checkNow' : 'member.pay.checkAgain')}</button>}
          <Link href={MEMBER_ROUTES.home} className={ghostBtn}>{t('member.pay.backToday')}</Link>
          {step === 'slow' && PageLink}
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
    const prompt = sent === 'mobile_money';
    return (
      <section className={`${card} flex flex-col items-center gap-4 text-center`} data-testid="member-pay-waiting">
        <div aria-hidden="true" className="h-20 w-20 animate-spin rounded-full border-[6px] border-[#1e293b] border-t-[#c8f04a] motion-reduce:animate-none" />
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">{t(prompt ? 'member.pay.waitTitle' : 'member.pay.confirmTitle')}</h2>
        <p>{prompt ? fmt(t('member.pay.waitBody'), { amount, phone: phone.trim() }) : fmt(t(sent === 'bank' ? 'member.pay.bank.waitBody' : 'member.pay.page.waitBody'), { amount })}</p>
        <p role="status" className={`rounded-xl border border-[#1e293b] px-4 py-3 text-sm ${muted}`}>{t('member.pay.waitStatus')}</p>
        {PageLink}
        <button type="button" className={ghostBtn} onClick={checkNow}>{t(prompt ? 'member.pay.checkNow' : 'member.pay.checkAgain')}</button>
      </section>
    );
  }

  // step === 'form'
  if (!payable) {
    return (
      <section className={`${card} flex flex-col gap-4`} data-testid="member-pay-not-on-web">
        {Summary}
        <p>{t('member.pay.notOnWeb')}</p>
        <button type="button" className={`${ghostBtn} self-start`} onClick={onBack}>{t('member.pay.cancel')}</button>
      </section>
    );
  }
  const steps = BANK_STEPS[bank] ?? null;
  const sendLabel = method === 'bank' ? fmt(t('member.pay.bank.send'), { amount }) : method === 'page' ? t('member.pay.page.send') : t('member.pay.send');
  const canSend = method === 'page' ? true : method === 'bank' ? !!(bank && account.trim() && phone.trim() && otp.trim()) : !!phone.trim();
  return (
    <form onSubmit={submit} noValidate className={`${card} flex flex-col gap-5`} data-testid="member-pay-mobile" data-method={method}>
      {Summary}
      {options?.environment === 'sandbox' && <p className="rounded-xl bg-[#fef0c7] px-4 py-2 text-sm text-[#7a2e0e]">{t('member.pay.sandbox')}</p>}
      {ErrorBox}
      {ways.length > 1 && (
        <fieldset className="flex flex-col gap-2" data-testid="member-pay-methods">
          <legend className="mb-2 text-sm font-semibold">{t('member.pay.method')}</legend>
          <div className="flex flex-wrap gap-2">
            {ways.map(m => (
              <label key={m} className={radioCard(method === m)}>
                <input type="radio" name="member-pay-method" value={m} checked={method === m} disabled={busy} className="h-5 w-5 accent-[#c8f04a]"
                  onChange={() => { setPicked(m); setError(null); setWalletError(false); }} data-testid={`member-pay-method-${m}`} />
                {t(METHOD_KEYS[m])}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {method === 'page' && <p className={muted} data-testid="member-pay-page-intro">{fmt(t('member.pay.page.body'), { amount })}</p>}
      {method === 'bank' && (
        <>
          <fieldset className="flex flex-col gap-2" data-testid="member-pay-banks">
            <legend className="mb-2 text-sm font-semibold">{t('member.pay.bank.choose')}</legend>
            <div className="flex flex-wrap gap-2">
              {banks.map(b => (
                <label key={b} className={radioCard(bank === b)}>
                  <input type="radio" name="member-pay-bank" value={b} checked={bank === b} disabled={busy} className="h-5 w-5 accent-[#c8f04a]"
                    onChange={() => { setBank(b); setError(null); }} data-testid={`member-pay-bank-${b}`} />
                  {b}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t('member.pay.bank.account')}
            <input className={input} value={account} onChange={e => setAccount(e.target.value)} inputMode="text" autoComplete="off" required data-testid="member-pay-account" />
          </label>
        </>
      )}
      {method !== 'page' && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {t(method === 'bank' ? 'member.pay.bank.phone' : 'member.pay.phone')}
          <input className={input} value={phone} onChange={e => phoneChanged(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required data-testid="member-pay-phone" />
          {method === 'mobile_money' && <span className={`font-normal ${muted}`}>{t('member.pay.phoneHint')}</span>}
        </label>
      )}
      {method === 'mobile_money' && picksWallet && (
        <fieldset className="flex flex-col gap-2" data-testid="member-pay-wallets" aria-describedby={walletError ? 'member-pay-wallet-error' : undefined}>
          <legend className="mb-2 text-sm font-semibold">{t('member.pay.wallet')}</legend>
          <div className="flex flex-wrap gap-2">
            {MOMO_WALLETS.map(w => (
              <label key={w} className={radioCard(wallet === w)}>
                <input type="radio" name="member-pay-wallet" value={w} checked={wallet === w} disabled={busy} className="h-5 w-5 accent-[#c8f04a]"
                  onChange={() => { setWallet(w); setWalletPicked(true); setWalletError(false); }} data-testid={`member-pay-wallet-${w}`} />
                {t(`member.pay.wallet.${w}` as MessageKey)}
              </label>
            ))}
          </div>
          {walletError && <p id="member-pay-wallet-error" role="alert" className="text-sm text-[#ff8a6b]" data-testid="member-pay-wallet-error">{t('member.err.network_required')}</p>}
        </fieldset>
      )}
      {method === 'bank' && (
        <>
          {steps && (
            <div className="flex flex-col gap-2 rounded-2xl border border-[#1e293b] bg-[#020617] px-4 py-3.5 text-sm" data-testid="member-pay-bank-steps">
              <strong>{t('member.pay.bank.stepsTitle')}</strong>
              <ol className="list-decimal pl-5 text-[#cbd5e1]">{steps.map(k => <li key={k}>{t(k)}</li>)}</ol>
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t('member.pay.bank.otp')}
            <input className={`${input} font-mono`} value={otp} onChange={e => setOtp(e.target.value)} inputMode="text" autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} required data-testid="member-pay-otp" />
            <span className={`font-normal ${muted}`}>{t('member.pay.bank.otpHint')}</span>
          </label>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryBtn} disabled={busy || !canSend} data-testid="member-pay-send">{busy ? t(method === 'page' ? 'member.pay.page.opening' : 'member.pay.sending') : sendLabel}</button>
        <button type="button" className={ghostBtn} onClick={onBack}>{t('member.pay.cancel')}</button>
      </div>
    </form>
  );
}
