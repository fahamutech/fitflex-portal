'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, linkCls, muted, primaryBtn } from '@/components/member/member-frame';
import { fmt } from '@/components/member/member-shared';
import { MEMBER_ROUTES, MemberApiError, memberApi, type MemberSession } from '@/lib/member-api';

export default function MemberCheckInPage() {
  return <MemberFrame testId="member-checkin-page">{s => <CheckIn session={s} />}</MemberFrame>;
}

// The QR is drawn here in the browser: the rotating token never leaves the page (no image service, no address).
function CheckIn({ session }: { session: MemberSession | null }) {
  const { t } = useApp();
  const [svg, setSvg] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'no_pass'>('loading');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const expiresAt = useRef(0);
  const fetching = useRef(false);

  const fetchQr = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const qr = await memberApi.qr();
      const markup = await QRCode.toString(qr.token, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#101828', light: '#ffffff' } });
      expiresAt.current = Date.parse(qr.expiresAt) || Date.now() + (qr.rotatesEverySeconds || 60) * 1000;
      setSvg(markup); setState('ready');
    } catch (e) {
      setState(e instanceof MemberApiError && e.code === 'active_subscription_required' ? 'no_pass' : 'error');
    } finally { fetching.current = false; }
  }, []);

  useEffect(() => { void fetchQr(); }, [fetchQr]);

  // Count down, fetch a new code when this one ends; pause while the tab is hidden.
  useEffect(() => {
    if (state !== 'ready') return;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      const left = Math.max(0, Math.ceil((expiresAt.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) void fetchQr();
    };
    tick();
    const id = window.setInterval(tick, 1000);
    const onVis = () => tick();
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [state, fetchQr]);

  const code = session?.user.publicId;
  return (
    <div className="mx-auto max-w-md">
      <PageTitle title={t('member.qr.title')} />
      {state === 'loading' ? <Loading />
        : state === 'error' ? <LoadError onRetry={() => { setState('loading'); void fetchQr(); }} />
        : state === 'no_pass' ? (
          <div className={`${card} flex flex-col gap-4`} data-testid="member-qr-no-pass">
            <p>{t('member.err.active_subscription_required')}</p>
            <Link href={MEMBER_ROUTES.pass} className={`${primaryBtn} self-start`}>{t('member.today.choosePass')}</Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-3xl bg-[#f7f5f0] p-6 text-[#101828]" data-testid="member-qr">
            <p className="text-center text-sm text-[#475467]">{t('member.qr.body')}</p>
            <div role="img" aria-label={t('member.qr.alt')} className="w-full max-w-[280px] rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
            {code && <p className="font-mono text-lg font-bold tracking-widest">{fmt(t('member.qr.code'), { code })}</p>}
            <p role="status" aria-live="off" className="text-sm tabular-nums text-[#475467]">{fmt(t('member.qr.refreshesIn'), { n: secondsLeft })}</p>
          </div>
        )}
      <p className={`mt-6 text-sm ${muted}`}>{t('member.qr.scanNote')}</p>
      <Link href={MEMBER_ROUTES.home} className={`${linkCls} mt-4 inline-block`}>{t('member.pay.backToday')}</Link>
    </div>
  );
}
