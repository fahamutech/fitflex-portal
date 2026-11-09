'use client';
// Member portal frame (/m): the dark member look from the design canvas ("Pulse": slate navy, volt accent), a header
// with Today / Pass / My QR, the language switch and sign-out. It also guards: flag off → "not available yet" and no
// request; no member session → the member sign-in page.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Globe, QrCode, UserRound } from 'lucide-react';
import { useApp } from '../../../app/providers';
import { EVENTS_MODULE, MEMBER_PORTAL } from '@/lib/flags';
import { loadSession, MEMBER_ROUTES, setOnSessionEnded, touchSession, watchOtherTabs, type MemberSession } from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';
import { BrandLogo } from '@/components/brand-logo';

// Events appear only in builds with the events module (NEXT_PUBLIC_EVENTS_MODULE), as on the staff side.
const NAV: Array<{ href: string; key: MessageKey }> = [
  { href: MEMBER_ROUTES.home, key: 'member.nav.today' },
  { href: MEMBER_ROUTES.pass, key: 'member.nav.pass' },
  { href: MEMBER_ROUTES.gyms, key: 'member.nav.gyms' },
  { href: MEMBER_ROUTES.trainers, key: 'member.nav.trainers' },
  { href: MEMBER_ROUTES.challenges, key: 'member.nav.challenges' },
  ...(EVENTS_MODULE ? [{ href: MEMBER_ROUTES.events, key: 'member.nav.events' as MessageKey }] : []),
  { href: MEMBER_ROUTES.activity, key: 'member.nav.activity' },
  { href: MEMBER_ROUTES.orders, key: 'member.nav.orders' },
];

export const card = 'rounded-3xl border border-[#1e293b] bg-[#0f172a] p-6';
export const muted = 'text-[#aab4c4]';
export const primaryBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#c8f04a] px-6 text-base font-extrabold text-[#020617] hover:bg-[#d7f57a] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c8f04a]';
export const ghostBtn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#475569] px-5 text-sm font-bold text-[#f1f5f9] hover:bg-[#1e293b] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c8f04a]';
export const input = 'min-h-12 w-full rounded-xl border border-[#334155] bg-[#020617] px-3 text-base text-[#f1f5f9] placeholder:text-[#64748b] focus:border-[#c8f04a] focus:outline-none';
export const linkCls = 'font-semibold text-[#c8f04a] underline-offset-4 hover:underline';

/** The whole member page: dark ground, language switch, and (when signed in) the header nav. */
export function MemberFrame({ testId, needsSession = true, children }: {
  testId: string; needsSession?: boolean; children: (session: MemberSession | null) => React.ReactNode;
}) {
  const { ready, locale, setLocale, t } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<MemberSession | null | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;
    setSession(MEMBER_PORTAL ? loadSession() : null);
  }, [ready]);

  // A 401 from any member call ends the member session: back to sign-in. So does a sign-out (or a staff sign-in or
  // sign-out) in another tab. Using a page pushes the idle limit back.
  useEffect(() => {
    const ended = () => { setSession(null); router.replace(MEMBER_ROUTES.signin); };
    setOnSessionEnded(ended);
    const stop = watchOtherTabs(ended);
    if (loadSession()) touchSession();
    return () => { setOnSessionEnded(null); stop(); };
  }, [router, pathname]);

  useEffect(() => {
    if (MEMBER_PORTAL && needsSession && session === null) router.replace(MEMBER_ROUTES.signin);
  }, [needsSession, session, router]);

  const here = (pathname || '').replace(/\/?$/, '/');
  // On a phone the page links scroll sideways: keep the current one in view.
  useEffect(() => {
    document.querySelector<HTMLElement>('[data-member-mobile-nav] [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [here, session]);
  const showNav = MEMBER_PORTAL && !!session && needsSession;

  return (
    <div className="min-h-screen bg-[#020617] text-[#f1f5f9]" data-testid={testId} style={{ colorScheme: 'dark' }}>
      <header className="border-b border-[#1e293b]">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link href={MEMBER_ROUTES.home} className="flex items-center gap-2.5 font-extrabold">
            <BrandLogo className="h-8 w-8 rounded-lg" />
            <span>FitFlex</span>
          </Link>
          {showNav && (
            <nav aria-label={t('member.nav.label')} className="ml-4 hidden gap-1 xl:flex">
              {NAV.map(n => (
                <Link key={n.href} href={n.href} aria-current={here === n.href ? 'page' : undefined}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${here === n.href ? 'bg-[#1e293b] text-[#f1f5f9]' : 'text-[#aab4c4] hover:text-[#f1f5f9]'}`}>
                  {t(n.key)}
                </Link>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-1">
            {showNav && (
              <Link href={MEMBER_ROUTES.checkIn} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#c8f04a] px-4 text-sm font-extrabold text-[#020617]">
                <QrCode aria-hidden="true" className="h-4 w-4" />{t('member.nav.checkIn')}
              </Link>
            )}
            <button type="button" data-testid="member-lang-toggle" onClick={() => setLocale(locale === 'sw' ? 'en' : 'sw')}
              aria-label={`${t('member.lang.label')}: ${locale === 'sw' ? 'English' : 'Kiswahili'}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-[#cbd5e1] hover:bg-[#1e293b]">
              <Globe aria-hidden="true" className="h-4 w-4" /><span aria-hidden="true">{locale === 'sw' ? 'SW' : 'EN'}</span>
            </button>
            {showNav && (
              <Link href={MEMBER_ROUTES.me} aria-label={t('member.nav.me')} aria-current={here === MEMBER_ROUTES.me ? 'page' : undefined} data-testid="member-nav-me"
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full border ${here === MEMBER_ROUTES.me ? 'border-[#c8f04a]' : 'border-[#334155]'} hover:bg-[#1e293b]`}>
                <UserRound aria-hidden="true" className="h-5 w-5" />
              </Link>
            )}
          </div>
        </div>
        {showNav && (
          <nav aria-label={t('member.nav.label')} data-member-mobile-nav="" className="flex gap-1 overflow-x-auto px-4 pb-2 xl:hidden">
            {NAV.map(n => (
              <Link key={n.href} href={n.href} aria-current={here === n.href ? 'page' : undefined}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${here === n.href ? 'bg-[#1e293b]' : 'text-[#aab4c4]'}`}>{t(n.key)}</Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {!ready || session === undefined ? <Loading />
          : !MEMBER_PORTAL ? <Unavailable />
          : needsSession && !session ? <Loading />
          : children(session)}
      </main>
    </div>
  );
}

export function Loading() {
  const { t } = useApp();
  return <p role="status" aria-busy="true" className={`py-16 text-center ${muted}`}>{t('member.loading')}</p>;
}

function Unavailable() {
  const { t } = useApp();
  return (
    <div className="py-16 text-center" data-testid="member-flag-off">
      <h1 className="text-2xl font-extrabold">{t('member.unavailable.title')}</h1>
      <p className={`mt-2 ${muted}`}>{t('member.unavailable.body')}</p>
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useApp();
  return (
    <div role="alert" className={`${card} text-center`} data-testid="member-load-error">
      <p>{t('member.error.load')}</p>
      <button type="button" className={`${ghostBtn} mt-4`} onClick={onRetry}>{t('member.retry')}</button>
    </div>
  );
}

export function PageTitle({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      {eyebrow && <span className="font-mono text-xs uppercase tracking-[0.12em] text-[#94a3b8]">{eyebrow}</span>}
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
    </div>
  );
}
