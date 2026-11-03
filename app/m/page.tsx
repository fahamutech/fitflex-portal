'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { QrCode } from 'lucide-react';
import { useApp } from '../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, ghostBtn, linkCls, muted, primaryBtn } from '@/components/member/member-frame';
import { fmt, isActive, nameOf, tierLabel } from '@/components/member/member-shared';
import { formatDate, formatTzs, MEMBER_ROUTES, memberApi, type Checkin, type MeResponse, type Pass } from '@/lib/member-api';

export default function MemberTodayPage() {
  return <MemberFrame testId="member-today-page">{() => <Today />}</MemberFrame>;
}

function Today() {
  const { t, locale } = useApp();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [passes, setPasses] = useState<Pass[]>([]);
  const [visits, setVisits] = useState<Checkin[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [m, p, c] = await Promise.all([memberApi.me(), memberApi.passes().catch(() => []), memberApi.checkins().catch(() => [])]);
      setMe(m); setPasses(p); setVisits(c.slice(0, 5)); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <Loading />;
  if (state === 'error' || !me) return <LoadError onRetry={load} />;

  const sub = me.subscription;
  const active = isActive(me);
  const cap = me.visitCap;
  const pending = me.pendingPayment;
  const name = nameOf(me);

  return (
    <>
      <PageTitle eyebrow={formatDate(new Date().toISOString(), locale)} title={name ? fmt(t('member.today.greeting'), { name }) : t('member.today.greetingNoName')} />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <section aria-labelledby="today-pass" className={`${card} flex flex-col gap-3`} data-testid="member-today-pass">
          <h2 id="today-pass" className="text-sm font-semibold uppercase tracking-wider text-[#94a3b8]">{t('member.today.passTitle')}</h2>
          {sub && active ? (
            <>
              <p className="text-3xl font-black">{tierLabel(sub.tier, passes)}</p>
              {cap != null ? (
                <>
                  <p className="text-lg font-semibold tabular-nums">{fmt(t('member.today.visitsLeft'), { left: Math.max(0, cap - me.visitsUsed), cap })}</p>
                  <div className="h-2 rounded-full bg-[#1e293b]" aria-hidden="true">
                    <div className="h-2 rounded-full bg-[#c8f04a]" style={{ width: `${Math.min(100, (me.visitsUsed / Math.max(1, cap)) * 100)}%` }} />
                  </div>
                </>
              ) : <p className="tabular-nums">{fmt(t('member.today.visitsUsed'), { used: me.visitsUsed })}</p>}
              {sub.expiresAt && <p className={muted}>{fmt(t('member.today.until'), { date: formatDate(sub.expiresAt, locale) })}</p>}
              <Link href={MEMBER_ROUTES.pass} className={`${linkCls} mt-1 self-start`}>{t('member.today.managePass')}</Link>
            </>
          ) : (
            <>
              <p>{t('member.today.noPass')}</p>
              <Link href={MEMBER_ROUTES.pass} className={`${primaryBtn} self-start`}>{t('member.today.choosePass')}</Link>
            </>
          )}
        </section>

        <section aria-labelledby="today-qr" className={`${card} flex flex-col gap-3`}>
          <h2 id="today-qr" className="text-sm font-semibold uppercase tracking-wider text-[#94a3b8]">{t('member.today.qrTitle')}</h2>
          <p>{t('member.today.qrBody')}</p>
          <Link href={MEMBER_ROUTES.checkIn} className={`${primaryBtn} self-start`}><QrCode aria-hidden="true" className="h-5 w-5" />{t('member.today.showQr')}</Link>
        </section>

        {pending && (
          <section aria-labelledby="today-pending" className="flex flex-col gap-3 rounded-3xl border-2 border-[#ff8a6b] bg-[#0f172a] p-6" data-testid="member-today-pending">
            <h2 id="today-pending" className="text-lg font-extrabold">{t('member.today.pendingTitle')}</h2>
            <p>{fmt(t('member.today.pendingBody'), { amount: formatTzs(pending.amountTzs, locale), tier: tierLabel(pending.tier, passes) })}</p>
            <Link href={MEMBER_ROUTES.pass} className={`${ghostBtn} self-start`}>{t('member.today.pendingOpen')}</Link>
          </section>
        )}

        <section aria-labelledby="today-visits" className={`${card} flex flex-col gap-1`}>
          <h2 id="today-visits" className="mb-2 text-sm font-semibold uppercase tracking-wider text-[#94a3b8]">{t('member.today.recentTitle')}</h2>
          {visits.length === 0 ? <p className={muted}>{t('member.today.noVisits')}</p> : (
            <ul className="divide-y divide-[#1e293b]">
              {visits.map(v => (
                <li key={v.id} className="flex justify-between gap-3 py-2.5">
                  <span className="font-semibold">{v.gym?.name ?? '—'}</span>
                  <span className={`${muted} tabular-nums`}>{formatDate(v.timestamp, locale, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className={`mt-8 text-sm ${muted}`}>{t('member.getApp')}</p>
    </>
  );
}
