'use client';
// Where AzamPay's payment page sends a member back (returnTo "web"):
//   /m/payment-return?paymentRequestId=<id>&result=success|failed
// Arriving here proves nothing: the address can be typed by anyone. The page asks the server where the request stands
// (POST /me/payments/:id/refresh, the signed-in member's own requests only) and shows that. `result` only picks the
// sentence shown while the payment is not confirmed yet. Neither value from the address is ever shown on the page.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { useApp } from '../../providers';
import { Loading, MemberFrame, PageTitle, card, ghostBtn, muted, primaryBtn } from '@/components/member/member-frame';
import { MEMBER_ROUTES, MemberApiError, memberApi, paymentIdFrom } from '@/lib/member-api';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';

export default function MemberPaymentReturnPage() {
  return <MemberFrame testId="member-payment-return-page">{() => <PaymentReturn />}</MemberFrame>;
}

type View = 'checking' | 'completed' | 'confirming' | 'failed' | 'held' | 'not_done' | 'not_found' | 'error';
const POLL_MS = 4000;
const POLL_MAX = 15; // about a minute on its own, then the member checks again by hand

/** Where to pay again, by what the request was for (the server's product kind; anything else is the pass page). */
function payAgainHref(productType: string | null | undefined): string {
  if (productType === 'SHOP_ORDER') return MEMBER_ROUTES.orders;
  if (productType === 'EVENT_ORDER') return MEMBER_ROUTES.events;
  if (productType === 'TRAINER_SERVICE') return MEMBER_ROUTES.trainers;
  return MEMBER_ROUTES.pass;
}

function PaymentReturn() {
  const { t } = useApp();
  const [view, setView] = useState<View>('checking');
  const [hintFailed, setHintFailed] = useState(false);
  const [again, setAgain] = useState<string>(MEMBER_ROUTES.pass);
  const [busy, setBusy] = useState(false);
  const id = useRef<string | null>(null);
  const polls = useRef(0);
  const timer = useRef<number | null>(null);
  const started = useRef(false);
  const alive = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterRender = useFocusAfterRender();

  const shown = useRef<View>('checking');
  // The heading of a new answer takes focus (once React has rendered it); asking again without a change moves nothing.
  const show = useCallback((v: View) => {
    if (shown.current === v) return;
    shown.current = v; setView(v); focusAfterRender(() => headingRef.current);
  }, [focusAfterRender]);

  const check = useCallback(async (byHand = false) => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!id.current) { show('not_found'); return; }
    if (byHand) { polls.current = 0; setBusy(true); }
    try {
      const r = await memberApi.refreshPayment(id.current);
      setAgain(payAgainHref(r.paymentRequest?.productType));
      if (r.state === 'completed') { show('completed'); return; }
      if (r.state === 'failed') { show('failed'); return; }
      if (r.state === 'held') { show('held'); return; }
      if (r.state === 'none') { show('not_done'); return; }
      // Still open: say so once, then keep asking quietly for a while.
      show('confirming');
      polls.current += 1;
      if (alive.current && polls.current < POLL_MAX) timer.current = window.setTimeout(() => { void check(); }, POLL_MS);
    } catch (e) {
      // Someone else's request, an unknown one, or paying switched off: the same neutral answer for all of them.
      if (e instanceof MemberApiError && (e.status === 404 || e.status === 403 || e.status === 400)) { show('not_found'); return; }
      if (e instanceof MemberApiError && e.status === 401) return; // the session ended: the frame goes to sign-in
      show('error');
    } finally { if (byHand) setBusy(false); }
  }, [show]);

  useEffect(() => {
    // Read once from the address (no search-params hook, so the page stays static). Both values are untrusted.
    alive.current = true;
    if (!started.current) {
      started.current = true;
      const q = new URLSearchParams(window.location.search);
      id.current = paymentIdFrom(q.get('paymentRequestId'));
      setHintFailed(q.get('result') === 'failed');
      void check();
    }
    return () => { alive.current = false; if (timer.current) window.clearTimeout(timer.current); };
  }, [check]);

  const title = <PageTitle title={t('member.return.title')} />;
  if (view === 'checking') return <div className="mx-auto max-w-xl">{title}<Loading /></div>;

  const heading = (text: string) => <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">{text}</h2>;
  const checkAgain = <button type="button" className={primaryBtn} disabled={busy} onClick={() => void check(true)} data-testid="member-return-check">{busy ? t('member.return.checking') : t('member.pay.checkAgain')}</button>;
  const home = <Link href={MEMBER_ROUTES.home} className={ghostBtn}>{t('member.pay.backToday')}</Link>;
  const payAgain = <Link href={again} className={primaryBtn} data-testid="member-return-pay-again">{t('member.return.payAgain')}</Link>;

  return (
    <div className="mx-auto max-w-xl">
      {title}
      {view === 'completed' ? (
        <section className={`${card} flex flex-col items-center gap-4 text-center`} data-testid="member-return-completed">
          <CheckCircle2 aria-hidden="true" className="h-16 w-16 text-[#3dd98e]" />
          {heading(t('member.pay.doneTitle'))}
          <p>{t('member.return.doneBody')}</p>
          <Link href={MEMBER_ROUTES.home} className={primaryBtn}>{t('member.pay.backToday')}</Link>
        </section>
      ) : view === 'confirming' ? (
        <section className={`${card} flex flex-col gap-4`} data-testid="member-return-confirming">
          {heading(t('member.return.confirmingTitle'))}
          <p className={muted}>{t(hintFailed ? 'member.return.confirmingFailedHint' : 'member.return.confirmingBody')}</p>
          <div className="flex flex-wrap gap-3">
            {checkAgain}
            {hintFailed && <Link href={again} className={ghostBtn} data-testid="member-return-pay-again">{t('member.return.payAgain')}</Link>}
            {home}
          </div>
        </section>
      ) : view === 'failed' || view === 'not_done' ? (
        <section className={`${card} flex flex-col gap-4`} data-testid={`member-return-${view}`}>
          {heading(t(view === 'failed' ? 'member.pay.failedTitle' : 'member.pay.notDoneTitle'))}
          <p className={muted}>{t(view === 'failed' ? 'member.return.failedBody' : 'member.pay.notDoneBody')}</p>
          <div className="flex flex-wrap gap-3">{payAgain}{home}</div>
        </section>
      ) : view === 'held' ? (
        <section className={`${card} flex flex-col gap-4`} data-testid="member-return-held">
          {heading(t('member.pay.heldTitle'))}
          <p className={muted}>{t('member.return.heldBody')}</p>
          <div className="flex flex-wrap gap-3">{home}</div>
        </section>
      ) : view === 'not_found' ? (
        <section className={`${card} flex flex-col gap-4`} data-testid="member-return-not-found">
          {heading(t('member.return.notFoundTitle'))}
          <p className={muted}>{t('member.return.notFoundBody')}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={MEMBER_ROUTES.pass} className={primaryBtn}>{t('member.nav.pass')}</Link>
            {home}
          </div>
        </section>
      ) : (
        <section role="alert" className={`${card} flex flex-col gap-4`} data-testid="member-return-error">
          {heading(t('member.return.errorTitle'))}
          <p className={muted}>{t('member.error.load')}</p>
          <div className="flex flex-wrap gap-3">{checkAgain}{home}</div>
        </section>
      )}
    </div>
  );
}
