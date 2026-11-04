'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dumbbell, Footprints, MapPin, Smartphone } from 'lucide-react';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, ghostBtn, input, muted } from '@/components/member/member-frame';
import { errorKey } from '@/components/member/pay-panel';
import { fmt, revealPanel } from '@/components/member/member-shared';
import { formatDate, formatNumber, MemberApiError, memberApi, memberApi3, type Activity, type Checkin, type MemberCode, type RoutePoint } from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';

export default function MemberActivityPage() {
  return <MemberFrame testId="member-activity-page">{() => <ActivityPage />}</MemberFrame>;
}

type Period = 'week' | 'month' | '90';
type Filter = 'all' | 'runs' | 'workouts' | 'visits';
type Row = { kind: 'activity'; at: string; a: Activity } | { kind: 'visit'; at: string; v: Checkin };

const TYPE_KEYS: Record<string, MessageKey> = {
  running: 'member.activity.type.running', walking: 'member.activity.type.walking', cycling: 'member.activity.type.cycling',
  workout: 'member.activity.type.workout', strength: 'member.activity.type.strength',
};
const MEMBER_SOURCES = new Set(['device', 'fitflex', 'manual']);
const isMove = (a: Activity) => ['running', 'walking', 'cycling'].includes(a.type);

/** Start of the period in East Africa time (week from Monday). */
function periodStart(p: Period, now = new Date()): number {
  const eat = new Date(+now + 3 * 3600_000);
  const d = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()));
  if (p === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  else if (p === 'month') d.setUTCDate(1);
  else d.setUTCDate(d.getUTCDate() - 89);
  return +d - 3 * 3600_000;
}

function ActivityPage() {
  const { t, locale } = useApp();
  const [acts, setActs] = useState<Activity[]>([]);
  const [visits, setVisits] = useState<Checkin[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [period, setPeriod] = useState<Period>('month');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [a, v] = await Promise.all([memberApi3.activities(), memberApi.checkins().catch(() => [])]);
      setActs(a); setVisits(v); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const from = periodStart(period);
  const inPeriod = useMemo(() => ({
    acts: acts.filter(a => +new Date(a.startedAt) >= from),
    visits: visits.filter(v => +new Date(v.timestamp) >= from && v.status !== 'voided'),
  }), [acts, visits, from]);

  const rows: Row[] = useMemo(() => {
    const r: Row[] = [];
    if (filter !== 'visits') for (const a of inPeriod.acts) {
      if (filter === 'runs' && !isMove(a)) continue;
      if (filter === 'workouts' && isMove(a)) continue;
      r.push({ kind: 'activity', at: a.startedAt, a });
    }
    if (filter === 'all' || filter === 'visits') for (const v of inPeriod.visits) r.push({ kind: 'visit', at: v.timestamp, v });
    return r.sort((x, y) => y.at.localeCompare(x.at));
  }, [inPeriod, filter]);

  if (state === 'loading') return <Loading />;
  if (state === 'error') return <LoadError onRetry={load} />;

  const km = inPeriod.acts.reduce((n, a) => n + (isMove(a) ? a.distanceKm ?? 0 : 0), 0);
  const workouts = inPeriod.acts.filter(a => !isMove(a) && a.source !== 'device').length;
  const minutes = inPeriod.acts.reduce((n, a) => n + (a.activeMinutes ?? a.durationMinutes ?? 0), 0);
  const selected = acts.find(a => a.id === selectedId) ?? null;
  const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-[#c8f04a] bg-[#1e293b] font-semibold' : 'border-[#334155] text-[#cbd5e1]'}`;
  const tiles: Array<[MessageKey, string]> = [
    ['member.activity.stat.visits', String(inPeriod.visits.length)],
    ['member.activity.stat.distance', fmt(t('member.activity.km'), { n: formatNumber(km, locale) })],
    ['member.activity.stat.workouts', String(workouts)],
    ['member.activity.stat.time', minutes >= 60 ? fmt(t('member.activity.hm'), { h: Math.floor(minutes / 60), m: minutes % 60 }) : fmt(t('member.activity.min'), { m: minutes })],
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle eyebrow={t('member.activity.eyebrow')} title={t('member.activity.title')} />
        <p className={`mb-6 text-sm ${muted}`}>{t('member.activity.recordInApp')}</p>
      </div>
      <div role="group" aria-label={t('member.activity.title')} className="mb-5 flex flex-wrap gap-2">
        {(['week', 'month', '90'] as Period[]).map(p => (
          <button key={p} type="button" aria-pressed={period === p} className={chip(period === p)} onClick={() => setPeriod(p)} data-testid={`member-activity-period-${p}`}>{t(`member.activity.period.${p}` as MessageKey)}</button>
        ))}
      </div>
      <div className="mb-4 grid gap-4 tabular-nums [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]" data-testid="member-activity-stats">
        {tiles.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1 rounded-[20px] border border-[#1e293b] bg-[#0f172a] p-5">
            <span className={`text-sm ${muted}`}>{t(k)}</span><strong className="text-3xl font-black">{v}</strong>
          </div>
        ))}
      </div>
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr))]">
        <section aria-labelledby="act-list" className={`${card} flex flex-col gap-1`}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="act-list" className="text-xl font-extrabold">{t(`member.activity.period.${period}` as MessageKey)}</h2>
            <label className={`flex items-center gap-2 text-sm ${muted}`}>{t('member.activity.show')}
              <select className={`${input} min-h-10 w-auto py-1 text-sm`} value={filter} onChange={e => setFilter(e.target.value as Filter)} data-testid="member-activity-filter">
                {(['all', 'runs', 'workouts', 'visits'] as Filter[]).map(f => <option key={f} value={f}>{t(`member.activity.filter.${f}` as MessageKey)}</option>)}
              </select>
            </label>
          </div>
          {rows.length === 0 ? <p className={muted}>{t('member.activity.empty')}</p> : (
            <ul className="flex flex-col" data-testid="member-activity-list">
              {rows.map(r => r.kind === 'visit' ? (
                <li key={`v-${r.v.id}`} className="flex items-center gap-3.5 border-b border-[#1e293b] py-3">
                  <span aria-hidden="true" className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-[#1e293b]"><MapPin className="h-5 w-5 text-[#c8f04a]" /></span>
                  <span className="flex flex-1 flex-col"><strong>{fmt(t('member.activity.visit'), { gym: r.v.gym?.name ?? t('member.unknown') })}</strong><span className={`text-sm ${muted}`}>{formatDate(r.v.timestamp, locale, true)}</span></span>
                </li>
              ) : (
                <li key={r.a.id}>
                  <button type="button" onClick={() => { setSelectedId(r.a.id); revealPanel('member-activity-detail'); }} aria-pressed={selected?.id === r.a.id} data-testid={`member-activity-${r.a.id}`}
                    className={`flex w-full items-center gap-3.5 rounded-xl px-2 py-3 text-left ${selected?.id === r.a.id ? 'bg-[#1e293b]' : 'border-b border-[#1e293b]'}`}>
                    <span aria-hidden="true" className={`flex h-12 w-12 flex-none items-center justify-center rounded-xl ${isMove(r.a) ? 'bg-[#020617]' : 'bg-[#134e48]'}`}>
                      {r.a.source === 'device' ? <Smartphone className="h-5 w-5 text-[#aab4c4]" /> : isMove(r.a) ? <Footprints className="h-5 w-5 text-[#c8f04a]" /> : <Dumbbell className="h-5 w-5 text-[#ccfbef]" />}
                    </span>
                    <span className="flex flex-1 flex-col">
                      <strong>{t(TYPE_KEYS[r.a.type] ?? 'member.activity.type.other')}</strong>
                      <span className={`text-sm ${muted}`}>{formatDate(r.a.startedAt, locale, true)}{r.a.source === 'device' ? ` · ${r.a.deviceName ? fmt(t('member.activity.synced'), { device: r.a.deviceName }) : t('member.activity.syncedPhone')}` : ''}</span>
                    </span>
                    <span className="text-right text-sm tabular-nums">
                      {r.a.distanceKm ? <strong>{fmt(t('member.activity.km'), { n: formatNumber(r.a.distanceKm, locale) })}</strong>
                        : r.a.steps ? fmt(t('member.activity.steps'), { n: r.a.steps.toLocaleString(locale === 'sw' ? 'sw-TZ' : 'en-GB') })
                        : r.a.durationMinutes ? fmt(t('member.activity.min'), { m: r.a.durationMinutes }) : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {selected ? <ActivityDetail key={selected.id} a={selected} onDeleted={() => { setActs(x => x.filter(y => y.id !== selected.id)); setSelectedId(null); }} />
          : <p className={`${card} ${muted}`}>{t('member.activity.detailHint')}</p>}
      </div>
    </>
  );
}

/** Draws the run's GPS track as an SVG line (equirectangular projection; fine at city scale). */
function RouteSvg({ segments, label }: { segments: RoutePoint[][]; label: string }) {
  const pts = segments.flat();
  if (pts.length < 2) return null;
  const lat0 = pts.reduce((n, p) => n + p[0], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map(p => p[1] * k), ys = pts.map(p => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 600, H = 260, pad = 16;
  const scale = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1e-9), (H - 2 * pad) / Math.max(maxY - minY, 1e-9));
  const ox = (W - (maxX - minX) * scale) / 2, oy = (H - (maxY - minY) * scale) / 2;
  const path = segments.map(seg => seg.map((p, i) => `${i ? 'L' : 'M'}${(ox + (p[1] * k - minX) * scale).toFixed(1)} ${(oy + (-p[0] - minY) * scale).toFixed(1)}`).join(' ')).join(' ');
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-2xl border border-[#1e293b] bg-[#020617]" data-testid="member-activity-route">
      <path d={path} fill="none" stroke="#c8f04a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActivityDetail({ a, onDeleted }: { a: Activity; onDeleted: () => void }) {
  const { t, locale } = useApp();
  const [route, setRoute] = useState<RoutePoint[][] | null | 'none'>(a.hasRoute ? null : 'none');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<MemberCode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!a.hasRoute) return;
    let live = true;
    memberApi3.activityRoute(a.id).then(r => { if (live) setRoute(r.length ? r : 'none'); }).catch(() => { if (live) setRoute('none'); });
    return () => { live = false; };
  }, [a.id, a.hasRoute]);

  const secs = a.movingSeconds ?? (a.durationMinutes ? a.durationMinutes * 60 : null);
  const time = secs != null ? `${Math.floor(secs / 3600) ? `${Math.floor(secs / 3600)}:` : ''}${String(Math.floor((secs % 3600) / 60)).padStart(Math.floor(secs / 3600) ? 2 : 1, '0')}:${String(secs % 60).padStart(2, '0')}` : null;
  const pace = secs && a.distanceKm ? (() => { const p = secs / a.distanceKm; return `${Math.floor(p / 60)}:${String(Math.round(p % 60)).padStart(2, '0')}`; })() : null;
  const stats: Array<[MessageKey, string | null]> = [
    ['member.activity.stat.distance', a.distanceKm ? fmt(t('member.activity.km'), { n: formatNumber(a.distanceKm, locale, 2) }) : null],
    ['member.activity.time', time],
    ['member.activity.pace', pace ? fmt(t('member.activity.paceValue'), { p: pace }) : null],
    ['member.activity.calories', a.calories ? formatNumber(Math.round(a.calories), locale, 0) : null],
    ['member.activity.climb', a.elevationGainM ? fmt(t('member.activity.metres'), { n: Math.round(a.elevationGainM) }) : null],
  ];

  async function del() {
    setBusy(true); setError(null);
    try { await memberApi3.deleteActivity(a.id); onDeleted(); }
    catch (e) { setError(e instanceof MemberApiError ? e.code : 'unknown'); setBusy(false); }
  }

  return (
    <section aria-labelledby="act-detail" className={`${card} flex flex-col gap-4 lg:sticky lg:top-4`} data-testid="member-activity-detail">
      <div className="flex flex-col gap-1">
        <h2 id="act-detail" className="text-2xl font-extrabold">{t(TYPE_KEYS[a.type] ?? 'member.activity.type.other')}</h2>
        <span className={muted}>{formatDate(a.startedAt, locale, true)}</span>
      </div>
      {a.hasRoute && route === null ? <p role="status" className={muted}>{t('member.loading')}</p>
        : route && route !== 'none' ? <RouteSvg segments={route} label={t('member.activity.routeAlt')} />
        : isMove(a) ? <p className={`text-sm ${muted}`}>{t('member.activity.noRoute')}</p> : null}
      <dl className="grid gap-3 tabular-nums [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))]">
        {stats.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex flex-col"><dt className="text-sm text-[#94a3b8]">{t(k)}</dt><dd className="text-xl font-extrabold">{v}</dd></div>
        ))}
      </dl>
      {a.notes && <p className="text-sm text-[#cbd5e1]">{a.notes}</p>}
      <p className={`text-sm ${muted}`}>{t('member.activity.viewOnly')}</p>
      {error && <div role="alert" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]">{t(errorKey(error))}</div>}
      {/* Trainer and gym records belong to that relationship (server: 403 not_member_owned): no delete for them. */}
      {!MEMBER_SOURCES.has(a.source ?? 'manual') ? null : confirming ? (
        <div role="alertdialog" aria-labelledby="del-q" className="flex flex-col gap-3 rounded-2xl border border-[#5c2a1d] p-4">
          <p id="del-q">{t('member.activity.deleteConfirm')}</p>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" disabled={busy} onClick={() => void del()} data-testid="member-activity-delete-yes"
              className="inline-flex min-h-11 items-center rounded-full border border-[#ff8a6b] px-5 text-sm font-bold text-[#ff8a6b]">{t('member.activity.deleteYes')}</button>
            <button type="button" className={ghostBtn} onClick={() => setConfirming(false)}>{t('member.activity.deleteNo')}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} data-testid="member-activity-delete"
          className="inline-flex min-h-11 items-center self-start rounded-full border border-[#5c2a1d] px-5 text-sm font-bold text-[#ff8a6b]">{t('member.activity.delete')}</button>
      )}
    </section>
  );
}
