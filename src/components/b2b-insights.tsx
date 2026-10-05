'use client';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, RefreshCw } from 'lucide-react';
import {
  api, ApiError, B2BAnalyticsQuery, B2BBenefitAnalytics, B2BDashboard, B2BFinanceAnalytics, B2BPersonDetail, B2BPersonRow, B2BProgramAnalytics,
  B2BProviderAnalytics,
} from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, CardHeader, PageHeader, Segmented, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { Aging } from '@/components/b2b-finance';
import { money } from '@/lib/admin-utils';
import { OrgFrame, useMyOrganization } from '@/components/b2b-org';
import { useApp } from '../../app/providers';
import { MessageKey } from '@/lib/i18n';
import { OrgT, useOrgT } from '@/lib/org-i18n';

const BRAND = '#079455';
const SECOND = '#7a5af8';
const GRID = 'var(--color-border-secondary)';
const INK = 'var(--color-fg-quaternary)';

/** English labels, for the FitFlex admin console; this screen shows the `org.insights.period.*` messages. */
export const PERIODS: Array<[string, string]> = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['last_7_days', 'Last 7 days'], ['last_30_days', 'Last 30 days'], ['this_month', 'This month'], ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'], ['last_quarter', 'Last quarter'], ['year_to_date', 'Year to date'], ['last_year', 'Last year'], ['custom', 'Custom dates'],
];
const REPORTS: Array<{ key: string; needs: 'read' | 'people' | 'billing' }> = [
  { key: 'beneficiaries', needs: 'people' }, { key: 'usage', needs: 'people' }, { key: 'activity', needs: 'people' },
  { key: 'benefits', needs: 'read' }, { key: 'programs', needs: 'read' }, { key: 'providers', needs: 'read' },
  { key: 'invoices', needs: 'billing' }, { key: 'payments', needs: 'billing' },
];

const num = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US'));
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const cash = (v: number | null | undefined) => (v == null ? '—' : money(v));
const words = (s: string) => s.replace(/_/g, ' ');
const failed = (o: OrgT, e: unknown, fallback: MessageKey) => {
  const body = e instanceof ApiError ? (e.body as { error?: string; requiredPermission?: string } | null) : null;
  if (body?.error === 'forbidden') return o.t('org.insights.err.forbidden');
  if (body?.error === 'date_range_too_long') return o.t('org.insights.err.rangeTooLong');
  if (body?.error === 'invalid_date_range') return o.t('org.insights.err.invalidRange');
  return o.t(fallback);
};
const change = (o: OrgT, v: number | null): { direction: 'up' | 'down' | 'neutral'; label: string } | undefined =>
  (v == null ? undefined : { direction: v > 0 ? 'up' : v < 0 ? 'down' : 'neutral', label: o.t('org.insights.change', { v: `${v > 0 ? '+' : ''}${v}` }) });
/** A status the server names in snake case: its translation, or the words as sent. */
const status = (o: OrgT, prefix: string, v: string) => o.label(prefix, v, words(v));

/** Save text the server produced as a file. */
function saveCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function Kpi({ label, value, sub, trend }: { label: string; value: React.ReactNode; sub?: React.ReactNode; trend?: ReturnType<typeof change> }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-[var(--color-fg-quaternary)]">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-[var(--color-fg-tertiary)]">{sub}</div>}
        {trend && <div className={`mt-1 text-xs ${trend.direction === 'up' ? 'text-[var(--color-success-600)]' : trend.direction === 'down' ? 'text-[var(--color-error-600)]' : 'text-[var(--color-fg-quaternary)]'}`}>{trend.label}</div>}
      </CardContent>
    </Card>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`py-2 pr-3 font-medium ${right ? 'text-right' : ''}`}>{children}</th>;
}
const HEAD = 'border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]';
const ROW = 'border-b border-[var(--color-border-secondary)]';

export type InsightsCan = { people: boolean; billing: boolean; staff?: boolean };
type Tab = 'overview' | 'people' | 'benefits' | 'providers' | 'billing' | 'reports';

/**
 * An organisation's analytics: the period and filters at the top apply to
 * every tab. FitFlex staff open any organisation with the same screen.
 */
export function OrgInsights({ token, orgId, orgName, can }: { token: string; orgId: string; orgName: string; can: InsightsCan }) {
  const { t } = useApp();
  const o = useOrgT();
  const day = o.day;
  const [tab, setTab] = useState<Tab>('overview');
  const [preset, setPreset] = useState('this_month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [programId, setProgramId] = useState('');
  const [group, setGroup] = useState('');
  const [dash, setDash] = useState<B2BDashboard | null>(null);
  const [programs, setPrograms] = useState<B2BProgramAnalytics[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const range: B2BAnalyticsQuery | null = useMemo(() => {
    if (preset !== 'custom') return { period: preset };
    return custom.from && custom.to ? { from: custom.from, to: custom.to } : null;
  }, [preset, custom]);
  const query: B2BAnalyticsQuery | null = useMemo(() => (range ? { ...range, programId: programId || undefined, group: group || undefined } : null), [range, programId, group]);

  useEffect(() => {
    if (!query) return;
    let live = true;
    setError(null);
    api.orgDashboard(token, orgId, query).then(d => live && setDash(d)).catch(e => live && setError(failed(o, e, 'org.insights.err.figures')));
    return () => { live = false; };
  }, [token, orgId, query, tick]);
  useEffect(() => {
    if (!range) return;
    api.orgProgramAnalytics(token, orgId, range).then(r => setPrograms(r.items)).catch(() => setPrograms([]));
  }, [token, orgId, range, tick]);

  const tabs: Array<[Tab, string]> = [['overview', o.t('org.billing.tab.overview')], ...(can.people ? [['people', t('org.nav.people')] as [Tab, string]] : []), ['benefits', o.t('org.insights.tab.benefits')], ['providers', o.t('org.insights.tab.providers')],
    ...(can.billing ? [['billing', t('org.nav.billing')] as [Tab, string]] : []), ['reports', o.t('org.insights.tab.reports')]];

  return (
    <div className="space-y-5" data-testid="org-insights">
      <PageHeader title={t('org.nav.insights')} description={o.t('org.insights.description', { name: orgName })}
        actions={<Button variant="secondary" size="sm" onClick={() => setTick(n => n + 1)}><RefreshCw className="h-4 w-4" />{t('admin.action.refresh')}</Button>} />
      <div className="flex flex-wrap items-end gap-2" data-testid="insights-filters">
        <select className="ui-input !w-auto" aria-label={o.t('org.insights.period')} value={preset} onChange={e => setPreset(e.target.value)} data-testid="insights-period">
          {PERIODS.map(([k, label]) => <option key={k} value={k}>{o.label('org.insights.period', k, label)}</option>)}
        </select>
        {preset === 'custom' && (
          <>
            <input className="ui-input !w-auto" type="date" aria-label={o.t('org.common.from')} value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} />
            <input className="ui-input !w-auto" type="date" aria-label={o.t('org.common.to')} value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} />
          </>
        )}
        {programs.length > 1 && (
          <select className="ui-input !w-auto" aria-label={o.t('org.insights.programme')} value={programId} onChange={e => setProgramId(e.target.value)}>
            <option value="">{o.t('org.insights.allProgrammes')}</option>
            {programs.map(p => <option key={p.programId} value={p.programId}>{p.name}</option>)}
          </select>
        )}
        {dash && dash.beneficiaries.groups.length > 0 && (
          <select className="ui-input !w-auto" aria-label={o.t('org.common.group')} value={group} onChange={e => setGroup(e.target.value)}>
            <option value="">{o.t('org.insights.allGroups')}</option>
            {(group && !dash.beneficiaries.groups.includes(group) ? [group, ...dash.beneficiaries.groups] : dash.beneficiaries.groups).map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        {dash && <span className="pb-2 text-xs text-[var(--color-fg-quaternary)]">{o.t('org.insights.rangeNote', { from: day(dash.period.from), to: day(dash.period.to) })}</span>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Segmented className="w-fit max-w-full overflow-x-auto" value={tab} onChange={v => setTab(v as Tab)} options={tabs} />

      {!query ? <Alert tone="info">{o.t('org.insights.chooseDates')}</Alert> : (
        <>
          {tab === 'overview' && (dash ? <Overview d={dash} /> : !error && <Spinner className="h-6 w-6" />)}
          {tab === 'people' && can.people && <People token={token} orgId={orgId} query={query} tick={tick} />}
          {tab === 'benefits' && <Benefits token={token} orgId={orgId} query={query} programs={programs.filter(p => !programId || p.programId === programId)} tick={tick} />}
          {tab === 'providers' && <Providers token={token} orgId={orgId} query={query} tick={tick} />}
          {tab === 'billing' && can.billing && range && <Billing token={token} orgId={orgId} query={range} tick={tick} />}
          {tab === 'reports' && range && <Reports token={token} orgId={orgId} query={query} can={can} />}
        </>
      )}
    </div>
  );
}

function Overview({ d }: { d: B2BDashboard }) {
  const p = d.participation;
  const o = useOrgT();
  const { day, shortDay } = o;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="insights-kpis">
        <Kpi label={o.t('org.insights.kpi.people')} value={num(d.beneficiaries.total)} sub={o.t('org.insights.kpi.people.sub', { enrolled: num(d.beneficiaries.enrolled), pending: num(d.beneficiaries.pending), joined: num(d.beneficiaries.enrolledInPeriod) })} />
        <Kpi label={o.t('org.insights.kpi.used')} value={num(p.activeBeneficiaries)} sub={o.t('org.insights.kpi.used.sub', { pct: pct(p.utilisationRatePct), n: num(p.inactiveBeneficiaries) })} trend={change(o, p.changePct)} />
        <Kpi label={o.t('org.insights.kpi.visits')} value={num(d.usage.sponsoredVisits)} sub={o.t('org.insights.kpi.visits.sub', { uses: num(d.usage.uses), pass: num(d.usage.passCheckins) })} trend={change(o, d.usage.usesChangePct)} />
        <Kpi label={o.t('org.insights.kpi.spend')} value={cash(d.spend.sponsorTotalTzs)} sub={o.t('org.insights.kpi.spend.sub', { perUse: cash(d.spend.sponsorPerUseTzs), fees: cash(d.spend.sponsorPassFeesTzs) })} />
        <Kpi label={o.t('org.insights.kpi.costPerPerson')} value={cash(d.spend.costPerActiveBeneficiaryTzs)} sub={o.t('org.insights.kpi.costPerPerson.sub')} />
        <Kpi label={o.t('org.insights.kpi.costPerVisit')} value={cash(d.spend.costPerSponsoredVisitTzs)} sub={d.usage.averagePerActiveBeneficiary == null ? undefined : o.t('org.insights.kpi.costPerVisit.sub', { n: d.usage.averagePerActiveBeneficiary })} />
        <Kpi label={o.t('org.insights.kpi.benefitsInUse')} value={o.t('org.insights.kpi.xOfY', { x: num(d.benefits.usedInPeriod), y: num(d.benefits.active) })} sub={d.benefits.endingWithin30Days ? o.t('org.insights.kpi.ending', { n: d.benefits.endingWithin30Days }) : o.t('org.insights.kpi.activeUsed')} />
        <Kpi label={o.t('org.insights.kpi.providers')} value={num(d.providers.used)} sub={o.t('org.insights.kpi.providers.sub', { amount: cash(d.spend.memberPerUseTzs + d.spend.memberPassSharesTzs) })} />
      </div>

      <Card>
        <CardHeader><span className="text-sm font-semibold">{o.t('org.insights.chart.title', { bucket: o.label('org.insights.bucket', d.period.bucket) })}</span></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={d.trend.map(t => ({ ...t, visits: t.uses + t.passCheckins }))} margin={{ left: -16, right: 8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="bucket" tickFormatter={shortDay} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={v => shortDay(String(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" name={o.t('org.insights.kpi.visits')} dataKey="visits" stroke={BRAND} strokeWidth={2} fill={BRAND} fillOpacity={0.12} />
              <Area type="monotone" name={o.t('org.insights.chart.people')} dataKey="activeBeneficiaries" stroke={SECOND} strokeWidth={2} fill={SECOND} fillOpacity={0.08} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><span className="text-sm font-semibold">{o.t('org.insights.where')}</span></CardHeader>
          <CardContent>
            {d.providers.top.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.insights.noVisits')}</p> : (
              <table className="w-full text-sm" data-testid="insights-top-providers">
                <thead><tr className={HEAD}><Th>{o.t('org.insights.col.provider')}</Th><Th right>{o.t('org.insights.col.visits')}</Th><Th right>{o.t('org.insights.col.yourSpend')}</Th></tr></thead>
                <tbody>
                  {d.providers.top.map(r => (
                    <tr key={`${r.providerType}:${r.providerId}`} className={ROW}>
                      <td className="py-2 pr-3">{r.name ?? r.providerId}</td><td className="py-2 pr-3 text-right">{num(r.visits)}</td><td className="py-2 pr-3 text-right">{cash(r.sponsorTzs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><span className="text-sm font-semibold">{o.t('org.insights.activity')}</span></CardHeader>
          <CardContent className="space-y-1 text-sm" data-testid="insights-engagement">
            {([[o.t('org.insights.eng.active'), num(d.engagement.peopleWithActivity)], [o.t('org.insights.eng.checkins'), num(d.engagement.gymCheckins)], [o.t('org.insights.eng.workouts'), num(d.engagement.workouts)],
              [o.t('org.insights.eng.activities'), num(d.engagement.activities)], [o.t('org.insights.eng.steps'), num(d.engagement.steps)], [o.t('org.insights.eng.distance'), `${num(d.engagement.distanceKm)} km`], [o.t('org.insights.eng.activeMinutes'), num(d.engagement.activeMinutes)],
              [o.t('org.insights.eng.inChallenges'), num(d.engagement.peopleInChallenges)]] as Array<[string, string]>).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3"><span className="text-[var(--color-fg-tertiary)]">{label}</span><span className="font-medium">{value}</span></div>
            ))}
            <p className="pt-2 text-xs text-[var(--color-fg-quaternary)]">{o.t('org.insights.eng.note')}</p>
          </CardContent>
        </Card>
      </div>

      {d.billing && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="insights-billing-kpis">
          <Kpi label={o.t('org.insights.bill.invoiced')} value={cash(d.billing.invoicedTzs)} sub={o.n('org.insights.bill.invoices', d.billing.invoices, { n: num(d.billing.invoices) })} />
          <Kpi label={o.t('org.insights.bill.paid')} value={cash(d.billing.paidTzs)} sub={o.n('org.insights.bill.payments', d.billing.payments, { n: num(d.billing.payments) })} />
          <Kpi label={o.t('org.insights.bill.outstanding')} value={cash(d.billing.outstandingTzs)} sub={o.t('org.insights.bill.asOf', { date: day(d.billing.asOf) })} />
          <Kpi label={o.t('org.insights.bill.overdue')} value={<span className={d.billing.overdueTzs > 0 ? 'text-[var(--color-error-600)]' : ''}>{cash(d.billing.overdueTzs)}</span>} />
        </div>
      )}
    </div>
  );
}

function People({ token, orgId, query, tick }: { token: string; orgId: string; query: B2BAnalyticsQuery; tick: number }) {
  const [rows, setRows] = useState<B2BPersonRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [activity, setActivity] = useState('');
  const [sort, setSort] = useState('name');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const o = useOrgT();
  const day = o.day;
  useEffect(() => {
    let live = true;
    setError(null);
    const t = setTimeout(() => {
      api.orgPeopleAnalytics(token, orgId, { ...query, search: search || undefined, activity: activity || undefined, sort, limit: 200 })
        .then(r => { if (live) { setRows(r.items); setTotal(r.total); } }).catch(e => live && setError(failed(o, e, 'org.insights.err.people')));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [token, orgId, query, search, activity, sort, tick]);

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <input className="ui-input !w-64" placeholder={o.t('org.insights.people.searchPlaceholder')} aria-label={o.t('org.insights.people.searchLabel')} value={search} onChange={e => setSearch(e.target.value)} />
          <select className="ui-input !w-auto" aria-label={o.t('org.common.show')} value={activity} onChange={e => setActivity(e.target.value)}>
            <option value="">{o.t('org.insights.people.everyone')}</option><option value="active">{o.t('org.insights.kpi.used')}</option><option value="inactive">{o.t('org.insights.people.unused')}</option>
          </select>
          <select className="ui-input !w-auto" aria-label={o.t('org.insights.people.sort')} value={sort} onChange={e => setSort(e.target.value)}>
            <option value="name">{o.t('org.insights.people.sort.name')}</option><option value="uses">{o.t('org.insights.people.sort.uses')}</option><option value="spend">{o.t('org.insights.people.sort.spend')}</option><option value="last_active">{o.t('org.insights.people.sort.lastActive')}</option>
          </select>
          <span className="text-xs text-[var(--color-fg-quaternary)]">{rows ? o.t('org.insights.kpi.xOfY', { x: rows.length, y: total }) : ''}</span>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {!rows ? !error && <Spinner className="h-6 w-6" /> : rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.insights.people.none')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="insights-people">
              <thead>
                <tr className={HEAD}><Th>{o.t('org.common.name')}</Th><Th>{o.t('org.common.group')}</Th><Th>{o.t('org.common.status')}</Th><Th right>{o.t('org.insights.kpi.visits')}</Th><Th right>{o.t('org.insights.col.yourSpend')}</Th><Th right>{o.t('org.insights.people.col.allCheckins')}</Th><Th right>{o.t('org.insights.people.col.workouts')}</Th><Th right>{o.t('org.insights.eng.steps')}</Th><Th>{o.t('org.insights.people.col.lastActive')}</Th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.beneficiaryId} className={ROW}>
                    <td className="py-2 pr-3"><button className="text-left font-medium text-[var(--color-fg-brand)]" onClick={() => setOpen(r.beneficiaryId)} data-testid={`person-${r.beneficiaryId}`}>{r.name ?? r.externalReference ?? o.t('org.insights.people.notLinked')}</button></td>
                    <td className="py-2 pr-3">{r.group ?? ''}</td>
                    <td className="py-2 pr-3">{r.status === 'active' ? (r.active ? <Badge tone="success">{o.t('org.insights.kpi.used')}</Badge> : <Badge tone="gray">{o.t('org.insights.people.noUse')}</Badge>) : <Badge tone="warning">{status(o, 'org.personStatus', r.status)}</Badge>}</td>
                    <td className="py-2 pr-3 text-right">{num(r.sponsoredUses + r.passCheckins)}</td>
                    <td className="py-2 pr-3 text-right">{r.sponsorTzs ? cash(r.sponsorTzs) : ''}</td>
                    <td className="py-2 pr-3 text-right">{num(r.gymCheckins)}</td>
                    <td className="py-2 pr-3 text-right">{num(r.workouts)}</td>
                    <td className="py-2 pr-3 text-right">{num(r.steps)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.lastActiveDay ? day(r.lastActiveDay) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-[var(--color-fg-quaternary)]">
          {o.t('org.insights.people.note')}
        </p>
      </CardContent>
      {open && <Person token={token} orgId={orgId} beneficiaryId={open} query={query} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function Person({ token, orgId, beneficiaryId, query, onClose }: { token: string; orgId: string; beneficiaryId: string; query: B2BAnalyticsQuery; onClose: () => void }) {
  const [p, setP] = useState<B2BPersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const o = useOrgT();
  const day = o.day;
  useEffect(() => {
    api.orgPersonAnalytics(token, orgId, beneficiaryId, { period: query.period, from: query.from, to: query.to }).then(setP).catch(e => setError(failed(o, e, 'org.insights.err.person')));
  }, [token, orgId, beneficiaryId, query]);
  const section = (title: string, body: React.ReactNode) => (<div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-quaternary)]">{title}</div>{body}</div>);
  const none = (text: string) => <p className="text-sm text-[var(--color-fg-quaternary)]">{text}</p>;
  return (
    <Dialog open onClose={onClose} title={p?.beneficiary.name ?? o.t('org.insights.person.title')} description={p ? `${[p.beneficiary.group, status(o, 'org.personStatus', p.beneficiary.status)].filter(Boolean).join(' · ')} · ${o.t('org.common.range', { from: day(p.period.from), to: day(p.period.to) })}` : undefined} size="xl">
      {error && <Alert tone="error">{error}</Alert>}
      {!p ? !error && <Spinner className="h-6 w-6" /> : (
        <div className="space-y-4" data-testid="person-detail">
          {!p.beneficiary.linkedToAccount && <Alert tone="info">{o.t('org.insights.person.notJoined')}</Alert>}
          <div className="grid gap-3 sm:grid-cols-4">
            <Kpi label={o.t('org.insights.kpi.visits')} value={num(p.totals.uses + p.totals.passCheckins)} />
            <Kpi label={o.t('org.insights.person.youPaid')} value={cash(p.totals.sponsorTzs)} sub={p.totals.beneficiaryTzs ? o.t('org.insights.person.theyPaidAmount', { amount: cash(p.totals.beneficiaryTzs) }) : undefined} />
            <Kpi label={o.t('org.insights.person.otherVisits')} value={num(p.totals.otherGymVisits)} />
            <Kpi label={o.t('org.insights.eng.activities')} value={num(p.totals.activities)} />
          </div>
          {section(o.t('org.insights.person.sponsored'), p.sponsoredUsage.length === 0 && p.passCheckins.length === 0 ? none(o.t('org.insights.person.nonePeriod')) : (
            <table className="w-full text-sm">
              <thead><tr className={HEAD}><Th>{o.t('org.common.date')}</Th><Th>{o.t('org.common.what')}</Th><Th>{o.t('org.insights.person.where')}</Th><Th>{o.t('org.programmes.col.benefit')}</Th><Th right>{o.t('org.insights.person.youPaid')}</Th><Th right>{o.t('org.insights.person.theyPaid')}</Th></tr></thead>
              <tbody>
                {[...p.sponsoredUsage.map(r => ({ key: r.id, day: r.day, what: status(o, 'org.insights.service', r.serviceType), where: r.provider, benefit: r.benefitName, sponsor: r.sponsorTzs as number | null, member: r.memberTzs as number | null })),
                  ...p.passCheckins.map(r => ({ key: r.id, day: r.day, what: o.t('org.insights.person.passCheckin'), where: r.gym, benefit: r.benefitName, sponsor: null, member: null }))]
                  .sort((a, b) => b.day.localeCompare(a.day)).map(r => (
                    <tr key={r.key} className={ROW}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{day(r.day)}</td><td className="py-1.5 pr-3">{r.what}</td><td className="py-1.5 pr-3">{r.where ?? ''}</td><td className="py-1.5 pr-3">{r.benefit ?? ''}</td>
                      <td className="py-1.5 pr-3 text-right">{r.sponsor == null ? o.t('org.insights.person.inPassFee') : cash(r.sponsor)}</td><td className="py-1.5 pr-3 text-right">{r.member ? cash(r.member) : ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ))}
          {p.passes.length > 0 && section(o.t('org.insights.person.passes'), (
            <ul className="space-y-1 text-sm">{p.passes.map(e => <li key={`${e.period}-${e.benefitName}`}>{o.t('org.insights.person.passLine', { period: e.period, tier: e.passTier, status: status(o, 'org.insights.passStatus', e.status), amount: cash(e.sponsorTzs) })}{e.memberTzs ? o.t('org.insights.person.passLineThey', { amount: cash(e.memberTzs) }) : ''}</li>)}</ul>
          ))}
          {section(o.t('org.insights.person.challenges'), p.challenges.length === 0 ? none(o.t('org.insights.person.noChallenges')) : (
            <ul className="space-y-1 text-sm">{p.challenges.map(c => <li key={c.id}>{c.name} · {o.t('org.insights.kpi.xOfY', { x: num(c.progress), y: num(c.target) })} {c.completed ? <Badge tone="success">{o.t('org.challenges.completed')}</Badge> : <span className="text-[var(--color-fg-quaternary)]">({status(o, 'org.insights.phase', c.phase)})</span>}</li>)}</ul>
          ))}
          {section(o.t('org.insights.person.otherVisitsTitle'), p.otherGymVisits.length === 0 ? none(o.t('org.insights.person.nonePeriod')) : (
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">{p.otherGymVisits.map(v => <li key={v.id}>{day(v.day)} · {v.gym ?? o.t('org.insights.person.gym')}</li>)}</ul>
          ))}
          {section(o.t('org.insights.person.activities'), p.activities.length === 0 ? none(o.t('org.insights.person.nonePeriod')) : (
            <table className="w-full text-sm">
              <thead><tr className={HEAD}><Th>{o.t('org.common.date')}</Th><Th>{o.t('org.insights.person.col.activity')}</Th><Th right>{o.t('org.insights.person.col.minutes')}</Th><Th right>{o.t('org.insights.eng.distance')}</Th><Th right>{o.t('org.insights.eng.steps')}</Th><Th>{o.t('org.insights.person.col.recordedBy')}</Th></tr></thead>
              <tbody>
                {p.activities.map(a => (
                  <tr key={a.id} className={ROW}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{day(a.day)}</td><td className="py-1.5 pr-3 capitalize">{words(a.type)}{a.gym ? ` · ${a.gym}` : ''}</td>
                    <td className="py-1.5 pr-3 text-right">{a.durationMinutes ?? a.activeMinutes ?? ''}</td><td className="py-1.5 pr-3 text-right">{a.distanceKm ? `${a.distanceKm} km` : ''}</td>
                    <td className="py-1.5 pr-3 text-right">{a.steps ? num(a.steps) : ''}</td><td className="py-1.5 pr-3">{status(o, 'org.insights.person.source', a.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
          {p.totals.capped && <p className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.insights.person.capped')}</p>}
          <p className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.insights.person.notShown', { list: p.notShown.map(x => o.label('org.insights.notShown', x)).join(', ') })}</p>
        </div>
      )}
    </Dialog>
  );
}

function Benefits({ token, orgId, query, programs, tick }: { token: string; orgId: string; query: B2BAnalyticsQuery; programs: B2BProgramAnalytics[]; tick: number }) {
  const [rows, setRows] = useState<B2BBenefitAnalytics[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const o = useOrgT();
  const { t } = useApp();
  useEffect(() => {
    setError(null);
    api.orgBenefitAnalytics(token, orgId, { period: query.period, from: query.from, to: query.to, programId: query.programId }).then(r => setRows(r.items)).catch(e => setError(failed(o, e, 'org.insights.err.benefits')));
  }, [token, orgId, query, tick]);
  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><span className="text-sm font-semibold">{t('org.nav.programmes')}</span></CardHeader>
        <CardContent>
          {programs.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.insights.prog.none')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="insights-programs">
                <thead><tr className={HEAD}><Th>{o.t('org.insights.programme')}</Th><Th>{o.t('org.common.status')}</Th><Th right>{o.t('org.insights.prog.eligible')}</Th><Th right>{o.t('org.insights.kpi.used')}</Th><Th right>{o.t('org.insights.prog.participation')}</Th><Th right>{o.t('org.insights.col.visits')}</Th><Th right>{o.t('org.insights.col.yourSpend')}</Th><Th right>{o.t('org.insights.prog.budgetUsed')}</Th></tr></thead>
                <tbody>
                  {programs.map(p => (
                    <tr key={p.programId} className={ROW}>
                      <td className="py-2 pr-3 font-medium">{p.name}</td><td className="py-2 pr-3 capitalize">{status(o, 'org.status', p.status)}</td><td className="py-2 pr-3 text-right">{num(p.eligible)}</td>
                      <td className="py-2 pr-3 text-right">{num(p.activeBeneficiaries)}</td><td className="py-2 pr-3 text-right">{pct(p.participationPct)}</td><td className="py-2 pr-3 text-right">{num(p.uses + p.passCheckins)}</td>
                      <td className="py-2 pr-3 text-right">{cash(p.sponsorTotalTzs)}</td>
                      <td className="py-2 pr-3 text-right">{p.budget.budgetTzs == null ? o.t('org.insights.prog.noBudget') : o.t('org.insights.kpi.xOfY', { x: pct(p.budget.usedPct), y: cash(p.budget.budgetTzs) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">{o.t('org.insights.prog.note')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><span className="text-sm font-semibold">Benefits</span></CardHeader>
        <CardContent>
          {!rows ? !error && <Spinner className="h-6 w-6" /> : rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.programmes.noBenefits')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="insights-benefits">
                <thead><tr className={HEAD}><Th>{o.t('org.programmes.col.benefit')}</Th><Th right>{o.t('org.insights.prog.eligible')}</Th><Th right>{o.t('org.insights.ben.usedIt')}</Th><Th right>{o.t('org.insights.ben.reach')}</Th><Th right>{o.t('org.insights.ben.uses')}</Th><Th right>{o.t('org.insights.ben.perUser')}</Th><Th right>{o.t('org.insights.col.yourSpend')}</Th><Th right>{o.t('org.insights.ben.membersPaid')}</Th><Th>{o.t('org.insights.ben.allowance')}</Th></tr></thead>
                <tbody>
                  {rows.map(b => (
                    <tr key={b.benefitId} className={ROW}>
                      <td className="py-2 pr-3"><div className="font-medium">{b.name}</div><div className="text-xs text-[var(--color-fg-quaternary)]">{b.programName} · {status(o, 'org.insights.service', b.benefitType)}{b.status !== 'active' ? ` · ${status(o, 'org.status', b.status)}` : ''}</div></td>
                      <td className="py-2 pr-3 text-right">{num(b.eligible)}</td><td className="py-2 pr-3 text-right">{num(b.users)}</td><td className="py-2 pr-3 text-right">{pct(b.reachPct)}</td>
                      <td className="py-2 pr-3 text-right">{num(b.uses)}</td><td className="py-2 pr-3 text-right">{b.averageUsesPerUser ?? '—'}</td><td className="py-2 pr-3 text-right">{cash(b.sponsorTzs)}</td><td className="py-2 pr-3 text-right">{b.memberTzs ? cash(b.memberTzs) : ''}</td>
                      <td className="py-2 pr-3 text-xs">{b.allowance ? o.t('org.insights.ben.allowanceLine', { pct: pct(b.allowance.usedPct), atLimit: b.allowance.peopleAtLimit, near: b.allowance.peopleNearLimit }) : b.usageLimit ? o.t('org.insights.ben.notRunning') : o.t('org.programmes.usage.noLimit')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">{o.t('org.insights.ben.note')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Providers({ token, orgId, query, tick }: { token: string; orgId: string; query: B2BAnalyticsQuery; tick: number }) {
  const [rows, setRows] = useState<B2BProviderAnalytics[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const o = useOrgT();
  useEffect(() => {
    setError(null);
    api.orgProviderAnalytics(token, orgId, { period: query.period, from: query.from, to: query.to, programId: query.programId }).then(r => setRows(r.items)).catch(e => setError(failed(o, e, 'org.insights.err.providers')));
  }, [token, orgId, query, tick]);
  const staff = rows?.some(r => r.settlement);
  return (
    <Card>
      <CardContent className="py-4">
        {error && <Alert tone="error">{error}</Alert>}
        {!rows ? !error && <Spinner className="h-6 w-6" /> : rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.insights.noVisits')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="insights-providers">
              <thead><tr className={HEAD}><Th>{o.t('org.insights.col.provider')}</Th><Th>{o.t('org.insights.prov.location')}</Th><Th right>{o.t('org.insights.col.visits')}</Th><Th right>{o.t('org.insights.prov.people')}</Th><Th right>{o.t('org.insights.prov.cameBack')}</Th><Th right>{o.t('org.insights.prov.serviceValue')}</Th><Th right>{o.t('org.insights.prov.sponsorPaid')}</Th>{staff && <Th right>{o.t('org.insights.prov.notSettled')}</Th>}</tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.providerType}:${r.providerId}`} className={ROW}>
                    <td className="py-2 pr-3 font-medium">{r.name ?? r.providerId} <span className="text-xs font-normal text-[var(--color-fg-quaternary)]">{o.label('org.insights.providerType', r.providerType)}</span></td><td className="py-2 pr-3">{r.location ?? ''}</td>
                    <td className="py-2 pr-3 text-right">{num(r.visits)}</td><td className="py-2 pr-3 text-right">{num(r.people)}</td><td className="py-2 pr-3 text-right">{num(r.repeatPeople)}</td>
                    <td className="py-2 pr-3 text-right">{cash(r.serviceValueTzs)}</td><td className="py-2 pr-3 text-right">{cash(r.sponsorTzs)}</td>
                    {staff && <td className="py-2 pr-3 text-right">{r.settlement ? o.t('org.insights.kpi.xOfY', { x: num(r.settlement.notYetSettled), y: num(r.settlement.perUseVisits) }) : ''}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">
          {o.t('org.insights.prov.note')}{staff ? o.t('org.insights.prov.staffNote') : ''}
        </p>
      </CardContent>
    </Card>
  );
}

function Billing({ token, orgId, query, tick }: { token: string; orgId: string; query: B2BAnalyticsQuery; tick: number }) {
  const [f, setF] = useState<B2BFinanceAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const o = useOrgT();
  useEffect(() => {
    setError(null);
    api.orgFinanceAnalytics(token, orgId, query).then(setF).catch(e => setError(failed(o, e, 'org.insights.err.billing')));
  }, [token, orgId, query, tick]);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!f) return <Spinner className="h-6 w-6" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={o.t('org.insights.bill.invoiced')} value={cash(f.billing.invoicedTzs)} /><Kpi label={o.t('org.insights.bill.paid')} value={cash(f.billing.paidTzs)} />
        <Kpi label={o.t('org.insights.bill.outstanding')} value={cash(f.billing.outstandingTzs)} /><Kpi label={o.t('org.billing.bal.credit')} value={cash(f.billing.creditTzs)} />
      </div>
      <Aging aging={f.billing.aging} />
      <Card>
        <CardHeader><span className="text-sm font-semibold">{o.t('org.insights.bill.byMonth')}</span></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={f.months.map(m => ({ ...m, usage: m.sponsorPerUseTzs + m.sponsorPassFeesTzs }))} margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => (Number(v) >= 1_000_000 ? `${Number(v) / 1_000_000}m` : Number(v) >= 1000 ? `${Number(v) / 1000}k` : String(v))} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
              <Tooltip formatter={v => money(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar name={o.t('org.insights.bill.used')} dataKey="usage" fill={SECOND} radius={[4, 4, 0, 0]} />
              <Bar name={o.t('org.insights.bill.invoicedBar')} dataKey="invoicedTzs" fill={BRAND} radius={[4, 4, 0, 0]} />
              <Bar name={o.t('org.billing.status.paid')} dataKey="collectedTzs" fill="#98a2b3" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">{f.note}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Reports({ token, orgId, query, can }: { token: string; orgId: string; query: B2BAnalyticsQuery; can: InsightsCan }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const o = useOrgT();
  const get = async (report: string) => {
    setBusy(report); setError(null); setDone(null);
    try {
      const out = await api.orgExport(token, orgId, report, query);
      saveCsv(out.filename, out.csv);
      setDone(o.n('org.insights.report.done', out.rows, { n: out.rows.toLocaleString('en-US'), title: o.server(`org.insights.report.${report}`, 'title', out.title) }));
    } catch (e) {
      setError(failed(o, e, 'org.insights.err.report'));
    } finally {
      setBusy(null);
    }
  };
  const mine = REPORTS.filter(r => r.needs === 'read' || (r.needs === 'people' && can.people) || (r.needs === 'billing' && can.billing));
  return (
    <Card>
      <CardContent className="space-y-3 py-4" data-testid="insights-reports">
        {error && <Alert tone="error">{error}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}
        <ul className="divide-y divide-[var(--color-border-secondary)]">
          {mine.map(r => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><div className="text-sm font-medium">{o.label(`org.insights.report.${r.key}`, 'title')}</div><div className="text-xs text-[var(--color-fg-quaternary)]">{o.label(`org.insights.report.${r.key}`, 'about')}</div></div>
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => get(r.key)} data-testid={`export-${r.key}`}><Download className="h-4 w-4" />{busy === r.key ? o.t('org.insights.report.preparing') : o.t('org.insights.report.download')}</Button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.insights.report.note')}</p>
      </CardContent>
    </Card>
  );
}

/** Insights for an organisation's own users and for a company's HR login. */
export function OrgInsightsPage() {
  const state = useMyOrganization();
  const { t } = useApp();
  const o = useOrgT();
  return (
    <OrgFrame bare title={t('org.nav.insights')} description="" state={state}>
      {(mine, token) => (mine.permissions.includes('analytics.read')
        ? <OrgInsights token={token} orgId={mine.organization.id} orgName={mine.organization.tradingName || mine.organization.legalName}
          can={{ people: mine.permissions.includes('analytics.people'), billing: mine.permissions.includes('billing.read') }} />
        : <Alert tone="info">{o.t('org.insights.noRole')}</Alert>)}
    </OrgFrame>
  );
}
