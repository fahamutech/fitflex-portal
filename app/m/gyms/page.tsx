'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Heart, Search } from 'lucide-react';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, ghostBtn, linkCls, muted, primaryBtn } from '@/components/member/member-frame';
import { fmt, passOf, revealPanel } from '@/components/member/member-shared';
import { formatNumber, formatSlot, MEMBER_ROUTES, memberApi, type Gym, type MeResponse, type Pass } from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';

export default function MemberGymsPage() {
  return <MemberFrame testId="member-gyms-page">{() => <Gyms />}</MemberFrame>;
}

// Which gym levels a pass's gymAccess lets in (same table as the server's check-in rules).
const COVERS: Record<string, string[]> = {
  online: ['online'], standard: ['standard'], midtier: ['standard', 'midtier'],
  premium: ['standard', 'midtier', 'premium'], luxury_executive: ['standard', 'midtier', 'premium', 'luxury_executive'],
};
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const TIER_KEYS: Record<string, MessageKey> = {
  standard: 'member.gyms.tier.standard', midtier: 'member.gyms.tier.midtier', premium: 'member.gyms.tier.premium', luxury_executive: 'member.gyms.tier.luxury_executive',
};

function hoursOf(g: Gym, day: string): { open: string; close: string } | null {
  const h = g.operatingHours as Record<string, unknown> | null | undefined;
  const w = (h?.[day] ?? h?.default) as { open?: string; close?: string } | undefined;
  return w?.open && w?.close ? { open: w.open, close: w.close } : null;
}

function Gyms() {
  const { t, locale } = useApp();
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [covers, setCovers] = useState<string[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [q, setQ] = useState('');
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [onlyCovered, setOnlyCovered] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [g, f, me, passes] = await Promise.all([
        memberApi.gyms(), memberApi.favoriteGymIds().catch(() => []),
        memberApi.me().catch(() => null as MeResponse | null), memberApi.passes().catch(() => [] as Pass[]),
      ]);
      const pass = passOf(me);
      const tier = pass?.status === 'active' ? pass.tier : null;
      const access = tier ? passes.find(p => p.key === tier)?.gymAccess : null;
      setGyms(g); setFavs(new Set(f)); setCovers(access ? COVERS[access] ?? null : null);
      setSelectedId(g[0]?.id ?? null); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return gyms.filter(g =>
      (!needle || `${g.name} ${g.location ?? ''}`.toLowerCase().includes(needle))
      && (!onlyFavs || favs.has(g.id))
      && (!onlyCovered || !covers || covers.includes(g.tier ?? '')));
  }, [gyms, q, onlyFavs, onlyCovered, favs, covers]);

  const toggleFav = async (id: string) => {
    const on = !favs.has(id);
    setFavs(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
    try { await memberApi.setFavorite(id, on); }
    catch { setFavs(prev => { const n = new Set(prev); if (on) n.delete(id); else n.add(id); return n; }); }
  };

  if (state === 'loading') return <Loading />;
  if (state === 'error') return <LoadError onRetry={load} />;
  const selected = shown.find(g => g.id === selectedId) ?? shown[0] ?? null;
  const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-[#c8f04a] bg-[#1e293b] font-semibold' : 'border-[#334155] text-[#cbd5e1]'}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle eyebrow={t('member.gyms.eyebrow')} title={t('member.gyms.title')} />
        <p className={`mb-6 ${muted}`}>{fmt(t('member.gyms.count'), { n: gyms.length })}</p>
      </div>
      <div role="search" className="mb-6 flex flex-wrap items-center gap-2.5">
        <label className="flex min-h-12 flex-[1_1_320px] items-center gap-2.5 rounded-full border border-[#334155] bg-[#0f172a] px-4">
          <Search aria-hidden="true" className="h-4 w-4 text-[#aab4c4]" />
          <input type="search" aria-label={t('member.gyms.search')} placeholder={t('member.gyms.searchPlaceholder')} value={q} onChange={e => setQ(e.target.value)}
            className="flex-1 bg-transparent py-3 text-base text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none" data-testid="member-gyms-search" />
        </label>
        {covers && <button type="button" aria-pressed={onlyCovered} className={chip(onlyCovered)} onClick={() => setOnlyCovered(v => !v)} data-testid="member-gyms-filter-covered">{t('member.gyms.filter.covered')}</button>}
        <button type="button" aria-pressed={onlyFavs} className={chip(onlyFavs)} onClick={() => setOnlyFavs(v => !v)} data-testid="member-gyms-filter-favs">{t('member.gyms.filter.favourites')}</button>
      </div>

      {shown.length === 0 ? <p className={`${card} ${muted}`} data-testid="member-gyms-empty">{t('member.gyms.empty')}</p> : (
        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]">
          <ul className="flex flex-col gap-3" data-testid="member-gyms-list">
            {shown.map(g => {
              const on = selected?.id === g.id;
              const thumb = g.thumbnail || g.thumbnails?.[0] || g.images?.[0];
              return (
                <li key={g.id}>
                  <button type="button" onClick={() => { setSelectedId(g.id); revealPanel('member-gym-detail'); }} aria-pressed={on} data-testid={`member-gym-${g.id}`}
                    className={`flex w-full gap-4 rounded-[20px] bg-[#0f172a] p-4 text-left ${on ? 'border-2 border-[#c8f04a]' : 'border border-[#1e293b]'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {thumb ? <img src={thumb} alt="" className="h-20 w-20 flex-none rounded-xl object-cover" /> : <span aria-hidden="true" className="h-20 w-20 flex-none rounded-xl bg-[#1e293b]" />}
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center gap-2"><strong className="truncate text-base">{g.name}</strong>{favs.has(g.id) && <Heart aria-label={t('member.gyms.saved')} className="h-4 w-4 flex-none fill-[#ff8a6b] text-[#ff8a6b]" />}</span>
                      <span className="text-sm text-[#cbd5e1]">{[g.location, g.tier && TIER_KEYS[g.tier] ? t(TIER_KEYS[g.tier]) : null, g.rating ? fmt(t('member.gyms.rating'), { rating: formatNumber(g.rating, locale), n: g.reviewCount ?? 0 }) : null].filter(Boolean).join(' · ')}</span>
                      {covers && <span className={`text-sm ${covers.includes(g.tier ?? '') ? 'text-[#3dd98e]' : 'text-[#fec84b]'}`}>{t(covers.includes(g.tier ?? '') ? 'member.gyms.covered' : 'member.gyms.notCovered')}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && <GymDetail gym={selected} fav={favs.has(selected.id)} onFav={() => void toggleFav(selected.id)} covered={covers ? covers.includes(selected.tier ?? '') : null} />}
        </div>
      )}
    </>
  );
}

function GymDetail({ gym, fav, onFav, covered }: { gym: Gym; fav: boolean; onFav: () => void; covered: boolean | null }) {
  const { t, locale } = useApp();
  const facilities = [...(gym.amenities ?? []), ...(gym.equipment ?? [])].slice(0, 12);
  const c = gym.coordinates;
  const maps = c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && (c.lat !== 0 || c.lng !== 0) ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}` : null;
  const image = gym.images?.[0];
  return (
    <section aria-labelledby="gym-detail" className={`${card} flex flex-col gap-4 lg:sticky lg:top-4`} data-testid="member-gym-detail">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image && <img src={image} alt="" className="h-48 w-full rounded-2xl object-cover" />}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="gym-detail" className="text-2xl font-extrabold">{gym.name}</h2>
          <span className={muted}>{[gym.location, gym.tier && TIER_KEYS[gym.tier] ? t(TIER_KEYS[gym.tier]) : null].filter(Boolean).join(' · ')}</span>
          {gym.verified && <span className="self-start rounded-full bg-[#134e48] px-2.5 py-0.5 text-xs font-bold text-[#ccfbef]">{t('member.gyms.verified')}</span>}
        </div>
        <button type="button" aria-pressed={fav} aria-label={t(fav ? 'member.gyms.saved' : 'member.gyms.save')} onClick={onFav} data-testid="member-gym-fav"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-[#334155]">
          <Heart aria-hidden="true" className={`h-5 w-5 ${fav ? 'fill-[#ff8a6b] text-[#ff8a6b]' : 'text-[#cbd5e1]'}`} />
        </button>
      </div>
      {covered !== null && <p className={covered ? 'text-[#3dd98e]' : 'text-[#fec84b]'}>{t(covered ? 'member.gyms.covered' : 'member.gyms.notCovered')}</p>}
      {gym.operatingHours && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-[#94a3b8]">{t('member.gyms.hours')}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm tabular-nums">
            {DAYS.map(d => { const h = hoursOf(gym, d); return (
              <div key={d} className="contents"><dt className={muted}>{t(`member.gyms.day.${d}` as MessageKey)}</dt><dd>{h ? `${formatSlot(h.open, locale)} – ${formatSlot(h.close, locale)}` : t('member.gyms.closed')}</dd></div>
            ); })}
          </dl>
        </div>
      )}
      {facilities.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-[#94a3b8]">{t('member.gyms.facilities')}</h3>
          <ul className="flex flex-wrap gap-2">{facilities.map(f => <li key={f} className="rounded-full bg-[#1e293b] px-3 py-1 text-sm">{f}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2.5">
        <Link href={MEMBER_ROUTES.checkIn} className={primaryBtn}>{t('member.gyms.showQr')}</Link>
        {maps && <a href={maps} target="_blank" rel="noopener noreferrer" className={ghostBtn}>{t('member.gyms.directions')}</a>}
        <Link href={`${MEMBER_ROUTES.trainers}?gym=${encodeURIComponent(gym.id)}`} className={`${linkCls} self-center px-2`}>{t('member.gyms.trainersHere')}</Link>
      </div>
    </section>
  );
}
