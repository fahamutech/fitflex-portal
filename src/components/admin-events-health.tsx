'use client';
// Events S7 (spec §5.5): the Health tab on /admin/events (FitFlex admin, scope `events`). Read-only. Counts of events, not people. One response feeds
// every group; a group the server could not compute arrives as `{ error }` and shows its own error while the rest render. Payment cards exist only when
// the response carries a `payments` block (scope `payments`). A feature that is off says "Off" and hides its cards.
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type AdminEventRow } from '@/lib/api';
import { adminS7Api, type HealthResponse } from '@/lib/events-s7-api';
import { eventDateTime, fmt, isFeatureOff, isForbidden } from '@/lib/events';
import { clockOf, scheduleText } from '@/lib/events-s7';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, CardHeader, EmptyState, MetricCard, Select, Segmented, SkeletonCard } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { EventsUnavailable, OrganizerForbidden, PageError } from '@/components/organizer/page-states';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../app/providers';

type Json = Record<string, unknown>;
type Tile = { key: MessageKey; value: ReactNode; sub?: ReactNode; href?: string; tone?: 'warn' };
const isErr = (v: unknown): v is { error: string } => !!v && typeof v === 'object' && 'error' in (v as Json) && !!(v as Json).error;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Funnel step names → card keys (PRD §14 names; unknown names fall back to the name itself, which is data, not copy). */
const FUNNEL: Array<[RegExp, MessageKey]> = [
  [/list/i, 'admin.events.health.card.listViews'], [/detail|view/i, 'admin.events.health.card.detailViews'], [/start|begin/i, 'admin.events.health.card.registrationStarts'],
  [/order/i, 'admin.events.health.card.ordersCreated'], [/pay|confirm/i, 'admin.events.health.card.paymentsConfirmed'],
];

export function AdminEventsHealth() {
  const { t, token, locale } = useApp();
  const options = useEventsOptions();
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const [eventId, setEventId] = useState('');
  const [events, setEvents] = useState<AdminEventRow[]>([]);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error' | 'off' | 'forbidden'>('loading');

  useEffect(() => { if (token) api.adminEvents(token, { limit: 50 }).then(p => setEvents(p.items ?? [])).catch(() => undefined); }, [token]);
  const load = useCallback(async () => {
    if (!token) return;
    setState('loading');
    try { setData(await adminS7Api.health(token, { days: Number(days) as 1 | 7 | 30, ...(eventId ? { eventId } : {}) })); setState('ok'); }
    catch (err) { setState(isFeatureOff(err) ? 'off' : (err as { status?: number })?.status === 403 || isForbidden(err) ? 'forbidden' : 'error'); }
  }, [token, days, eventId]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'off') return <div data-testid="health-off"><EventsUnavailable /></div>;
  if (state === 'forbidden') return <OrganizerForbidden backHref="/admin/events" />;

  const hoursAge = (hours: number | null | undefined) => { if (hours == null) return undefined; const txt = hours >= 48 ? fmt(t('admin.events.health.age.days'), { n: Math.round(hours / 24) }) : fmt(t('admin.events.health.age.hours'), { n: Math.round(hours) }); return fmt(t('admin.events.health.oldest'), { age: txt }); };
  const daysAge = (days: number | null | undefined) => (days == null ? undefined : fmt(t('admin.events.health.oldest'), { age: fmt(t('admin.events.health.age.days'), { n: Math.round(days) }) }));
  const minutesAge = (m: number | null | undefined) => (m == null ? undefined : fmt(t('admin.events.health.oldest'), { age: fmt(t('admin.events.health.age.minutes'), { n: Math.round(m) }) }));
  type D = NonNullable<HealthResponse[keyof Pick<HealthResponse, 'refunds'>]> & Json;
  const groups: Array<{ id: string; title: MessageKey; off?: boolean; data: unknown; tiles: (d: Json) => Tile[] }> = data ? [
    { id: 'funnel', title: 'admin.events.health.group.funnel', data: data.funnel ?? null, tiles: () => {
      const steps = (Array.isArray(data.funnel) ? data.funnel : []) as Array<{ name: string; count: number; ratioToPrevious?: number | null }>;
      return steps.map((st, i) => {
        const known = FUNNEL.find(([re]) => re.test(st.name));
        const ratio = st.ratioToPrevious ?? (i > 0 && steps[i - 1].count ? st.count / steps[i - 1].count : null);
        return { key: (known?.[1] ?? 'admin.events.health.card.detailViews') as MessageKey, value: st.count.toLocaleString(), sub: ratio != null ? fmt(t('admin.events.health.ratio'), { pct: Math.round(ratio * 100) }) : undefined };
      });
    } },
    ...(data.payments !== undefined ? [{ id: 'payments', title: 'admin.events.health.group.payments' as MessageKey, data: data.payments, tiles: (d: Json): Tile[] => {
      const mw = d.manualWaiting as { count?: number; oldestAgeHours?: number | null } | undefined; const rc = d.reconciliationRequired as { count?: number; oldestAgeHours?: number | null } | undefined;
      return [
        { key: 'admin.events.health.card.manualWaiting', value: mw?.count ?? 0, sub: hoursAge(mw?.oldestAgeHours) },
        { key: 'admin.events.health.card.paymentsRejected', value: num(d.rejected) ?? 0 }, { key: 'admin.events.health.card.lateCases', value: num(d.lateCases) ?? 0 },
        { key: 'admin.events.health.card.reconciliation', value: rc?.count ?? 0, sub: hoursAge(rc?.oldestAgeHours) },
      ];
    } }] : []),
    { id: 'refunds', title: 'admin.events.health.group.refunds', data: data.refunds, tiles: d => { const r = d.requestedNotPaid as { count?: number; oldestAgeDays?: number | null } | undefined; return [
      { key: 'admin.events.health.card.refundsRequested', value: r?.count ?? 0, sub: daysAge(r?.oldestAgeDays) }, { key: 'admin.events.health.card.refundBatchesStuck', value: num(d.batchesStuck) ?? 0 },
    ]; } },
    { id: 'webhooks', title: 'admin.events.health.group.webhooks', off: !options?.ops?.webhooks, data: data.webhooks, tiles: d => [
      { key: 'admin.events.health.card.webhooksPending', value: num(d.pending) ?? 0, sub: minutesAge(num(d.oldestPendingAgeMinutes)) },
      { key: 'admin.events.health.card.webhooksFailed', value: num(d.failedLast24h) ?? 0 }, { key: 'admin.events.health.card.webhooksGaveUp', value: num(d.gaveUp) ?? 0 }, { key: 'admin.events.health.card.webhooksDisabled', value: num(d.endpointsAutoDisabled) ?? 0 },
    ] },
    { id: 'kit', title: 'admin.events.health.group.kit', off: !options?.ops?.kit, data: data.kit, tiles: d => [
      { key: 'admin.events.health.card.kitCollected', value: `${num(d.collected) ?? 0} / ${num(d.confirmed) ?? 0}` }, { key: 'admin.events.health.card.kitExceptions', value: num(d.exceptions) ?? 0 },
      ...(options?.ops?.kitOffline ? [{ key: 'admin.events.health.card.kitDesks' as MessageKey, value: num(d.offlineDesksActive) ?? 0 }, { key: 'admin.events.health.card.kitUnsent' as MessageKey, value: num(d.unsentScansReported) ?? 0 }, { key: 'admin.events.health.card.kitToCheck' as MessageKey, value: num(d.scansToCheck) ?? 0 }] : []),
    ] },
    { id: 'results', title: 'admin.events.health.group.results', off: !options?.results?.enabled, data: data.results, tiles: d => {
      const w = d.waitingForVerification as { count?: number; oldestAgeHours?: number | null } | undefined; const o = d.openDisputes as { count?: number; oldestAgeDays?: number | null } | undefined; return [
        { key: 'admin.events.health.card.resultsWaiting', value: w?.count ?? 0, sub: hoursAge(w?.oldestAgeHours) },
        { key: 'admin.events.health.card.resultsDisputes', value: o?.count ?? 0, sub: daysAge(o?.oldestAgeDays), href: '/admin/events?tab=disputes' },
        { key: 'admin.events.health.card.resultsReleases', value: num(d.releasesInPeriod) ?? 0 },
      ]; } },
    { id: 'rewards', title: 'admin.events.health.group.rewards', off: !options?.results?.rewards, data: data.rewards, tiles: d => [
      { key: 'admin.events.health.card.rewardsTasks', value: num(d.awardTasksFailed) ?? 0, sub: num(d.oldestAwardTaskAgeMinutes) != null ? minutesAge(num(d.oldestAwardTaskAgeMinutes)) : undefined, href: '/admin/event-rewards' },
      { key: 'admin.events.health.card.rewardsRedemptions', value: num(d.redemptionsWaiting) ?? 0 }, { key: 'admin.events.health.card.rewardsDuplicates', value: num(d.duplicatePreventionIncidents) ?? 0 },
    ] },
    { id: 'waitlist', title: 'admin.events.health.group.waitlist', off: !options?.waitlist?.enabled, data: data.waitlist, tiles: d => [
      { key: 'admin.events.health.card.waitlistWaiting', value: num(d.waiting) ?? 0 }, { key: 'admin.events.health.card.waitlistOffers', value: num(d.offersOpen) ?? 0 },
      { key: 'admin.events.health.card.waitlistBought', value: num(d.converted) ?? 0 }, { key: 'admin.events.health.card.waitlistLapsed', value: num(d.expired) ?? 0 },
      { key: 'admin.events.health.card.waitlistPromoter', value: d.promoterLastRunAt ? eventDateTime(String(d.promoterLastRunAt), 'Africa/Dar_es_Salaam', locale) : t('admin.events.health.jobs.never') },
    ] },
  ] : [];
  void ({} as D);

  const jobColumns: ColumnDef<NonNullable<HealthResponse['jobs']>[number]>[] = [
    { key: 'name', header: t('admin.events.health.jobs.job'), cell: j => <span className="font-mono text-xs [overflow-wrap:anywhere]">{j.name}</span> },
    { key: 'schedule', header: t('admin.events.health.jobs.schedule'), cell: j => scheduleText(j.schedule, t) },
    { key: 'lastRunAt', header: t('admin.events.health.jobs.lastRun'), cell: j => (j.lastRunAt ? eventDateTime(j.lastRunAt, 'Africa/Dar_es_Salaam', locale) : t('admin.events.health.jobs.never')) },
    { key: 'outcome', header: t('admin.events.health.jobs.outcome'), cell: j => <span className="inline-flex items-center gap-2">{j.outcome ?? '—'}{j.late && <Badge tone="warning">{t('admin.events.health.late')}</Badge>}{j.flagOn === false && <Badge tone="gray">{t('admin.events.health.off')}</Badge>}</span> },
  ];
  const errColumns: ColumnDef<NonNullable<HealthResponse['errors']>[number]>[] = [
    { key: 'group', header: t('admin.events.health.errors.group'), cell: e => e.group }, { key: 'class', header: t('admin.events.health.errors.class'), cell: e => e.class ?? '—' }, { key: 'count', header: t('admin.events.health.errors.count'), cell: e => e.count },
  ];
  const setup = data?.setup;
  const flags = Object.entries(setup?.flags ?? {});

  return (
    <div className="space-y-4" data-testid="admin-health">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented className="w-fit max-w-full overflow-x-auto" value={days} onChange={v => setDays(v as typeof days)} options={[['1', t('admin.events.health.period.1')], ['7', t('admin.events.health.period.7')], ['30', t('admin.events.health.period.30')]]} />
        <Select size="sm" aria-label={t('admin.events.health.event')} value={eventId} onChange={e => setEventId(e.target.value)} data-testid="health-event">
          <option value="">{t('admin.events.health.allEvents')}</option>
          {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
        </Select>
        {data && <span className="text-sm text-[var(--color-fg-quaternary)]" data-testid="health-updated">{fmt(t('admin.events.health.updated'), { time: clockOf(data.generatedAt, locale) })}</span>}
      </div>
      <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="health-counts-note">{t('admin.events.health.countsNote')}</p>
      {data && setup && setup.alertsConfigured === false && <div data-testid="health-alerts-off"><Alert tone="warning">{t('admin.events.health.alertsOff')}</Alert></div>}
      {data && data.rolledUpAt && <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="health-rollup">{fmt(t('admin.events.health.funnelNote'), { time: clockOf(data.rolledUpAt, locale) })}</p>}
      {state === 'error' ? <PageError onRetry={() => void load()} /> : state === 'loading' || !data ? <div aria-busy="true" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div> : (
        <>
          {groups.map(gr => {
            const failed = isErr(gr.data);
            const tiles = !failed && !gr.off && gr.data ? gr.tiles(gr.data as Json) : [];
            return (
              <section key={gr.id} aria-label={t(gr.title)} className="space-y-2" data-testid={`health-group-${gr.id}`}>
                <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t(gr.title)} {gr.off && <Badge tone="gray">{t('admin.events.health.off')}</Badge>}</h2>
                {failed ? <div data-testid={`health-group-${gr.id}-error`}><Alert tone="error"><span className="flex flex-wrap items-center gap-3">{t('admin.events.health.groupError')}<Button size="sm" variant="secondary" onClick={() => void load()}>{t('common.tryAgain')}</Button></span></Alert></div>
                  : gr.off ? null
                  : tiles.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('admin.events.health.empty')}</p>
                  : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {tiles.map((tile, i) => (
                        <div key={`${tile.key}-${i}`} role="group" aria-label={t(tile.key)} data-testid={`health-card-${tile.key.split('.').pop()}`}>
                          <MetricCard wrapLabel label={t(tile.key)} value={tile.value} sub={tile.sub} />
                          {tile.href && <Link href={tile.href} className="mt-1 inline-flex min-h-11 items-center text-sm text-[var(--color-brand-700)] underline">{t(tile.href.includes('disputes') ? 'admin.events.health.link.disputes' : 'admin.events.health.link.rewards')}</Link>}
                        </div>
                      ))}
                    </div>
                  )}
              </section>
            );
          })}
          <section aria-label={t('admin.events.health.group.jobs')} className="space-y-2" data-testid="health-group-jobs">
            <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.health.group.jobs')}</h2>
            <Card><CardContent>{(data.jobs ?? []).length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('admin.events.health.empty')}</p> : <DataTable columns={jobColumns} data={data.jobs ?? []} keyFn={j => j.name} label={t('admin.events.health.group.jobs')} dense />}</CardContent></Card>
          </section>
          {(data.alerts ?? []).length > 0 && (
            <section aria-label={t('admin.events.health.group.alerts')} className="space-y-2" data-testid="health-group-alerts">
              <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.health.group.alerts')}</h2>
              <ul className="space-y-1">{(data.alerts ?? []).map((a, i) => <li key={`${a.rule}-${i}`}><Alert tone={a.severity === 'high' ? 'error' : 'warning'}><span className="font-mono text-xs">{a.rule}</span> {a.subject ?? ''}</Alert></li>)}</ul>
            </section>
          )}
          <section aria-label={t('admin.events.health.group.errors')} className="space-y-2" data-testid="health-group-errors">
            <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.health.group.errors')}</h2>
            <Card><CardContent>{(data.errors ?? []).length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('admin.events.health.errors.none')}</p> : <DataTable columns={errColumns} data={data.errors ?? []} keyFn={(e, i) => `${e.group}-${e.class}-${i}`} label={t('admin.events.health.group.errors')} dense />}</CardContent></Card>
          </section>
          <section aria-label={t('admin.events.health.group.setup')} className="space-y-2" data-testid="health-group-setup">
            <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.health.group.setup')}</h2>
            <Card><CardHeader><span className="text-sm text-[var(--color-fg-secondary)]">{t('admin.events.ops.setupNote')}</span></CardHeader><CardContent className="space-y-3">
              <ul className="flex flex-wrap gap-2" aria-label={t('admin.events.health.setup.flags')}>
                {flags.map(([name, on]) => <li key={name}><Badge tone={on ? 'success' : 'gray'} dot><span className="font-mono text-xs">{name}</span>: {t(on ? 'admin.events.health.on' : 'admin.events.health.off')}</Badge></li>)}
              </ul>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-[var(--color-fg-quaternary)]">{t('admin.events.health.setup.retention')}</dt><dd data-testid="health-retention">{t(setup?.retentionConfigured ? 'admin.events.health.configured' : 'admin.events.health.notConfigured')}</dd></div>
                <div><dt className="text-[var(--color-fg-quaternary)]">{t('admin.events.health.setup.alerts')}</dt><dd>{t(setup?.alertsConfigured ? 'admin.events.health.configured' : 'admin.events.health.notConfigured')}</dd></div>
                <div><dt className="text-[var(--color-fg-quaternary)]">{t('admin.events.health.setup.consent')}</dt><dd className="font-mono">{setup?.consentTextVersion ?? '—'}</dd></div>
                {options?.payments?.blockedReason && <div><dt className="text-[var(--color-fg-quaternary)]">{t('admin.events.health.setup.payments')}</dt><dd>{t(`events.payments.blocked.${options.payments.blockedReason}` as MessageKey)}</dd></div>}
              </dl>
            </CardContent></Card>
          </section>
          {groups.every(gr => gr.off || !gr.data) && (data.jobs ?? []).length === 0 && <EmptyState title={t('admin.events.health.empty')} />}
        </>
      )}
    </div>
  );
}
