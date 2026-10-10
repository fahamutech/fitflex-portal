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
import { Aging, day } from '@/components/b2b-finance';
import { money } from '@/lib/admin-utils';
import { OrgFrame, useMyOrganization } from '@/components/b2b-org';

const BRAND = '#079455';
const SECOND = '#7a5af8';
const GRID = 'var(--color-border-secondary)';
const INK = 'var(--color-fg-quaternary)';

export const PERIODS: Array<[string, string]> = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['last_7_days', 'Last 7 days'], ['last_30_days', 'Last 30 days'], ['this_month', 'This month'], ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'], ['last_quarter', 'Last quarter'], ['year_to_date', 'Year to date'], ['last_year', 'Last year'], ['custom', 'Custom dates'],
];
const REPORTS: Array<{ key: string; title: string; about: string; needs: 'read' | 'people' | 'billing' }> = [
  { key: 'beneficiaries', title: 'Beneficiaries', about: 'Each person with their usage and activity totals.', needs: 'people' },
  { key: 'usage', title: 'Sponsored usage', about: 'Every sponsored visit and session: who, when, where and what it cost.', needs: 'people' },
  { key: 'activity', title: 'Member activity', about: 'Every workout and activity your people recorded.', needs: 'people' },
  { key: 'benefits', title: 'Benefit utilisation', about: 'Each benefit: who could use it, who did, and its cost.', needs: 'read' },
  { key: 'programs', title: 'Programme performance', about: 'Each programme side by side.', needs: 'read' },
  { key: 'providers', title: 'Provider utilisation', about: 'Each gym and trainer your people used.', needs: 'read' },
  { key: 'invoices', title: 'Invoices', about: 'Invoices issued in the period.', needs: 'billing' },
  { key: 'payments', title: 'Payments', about: 'Payments FitFlex received in the period.', needs: 'billing' },
];
const SERVICE: Record<string, string> = { gym_access: 'Gym visit', trainer_session: 'Trainer session', sponsored_pass: 'Sponsored pass' };

const num = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US'));
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const cash = (v: number | null | undefined) => (v == null ? '—' : money(v));
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const words = (s: string) => s.replace(/_/g, ' ');
const failed = (e: unknown, fallback: string) => {
  const body = e instanceof ApiError ? (e.body as { error?: string; requiredPermission?: string } | null) : null;
  if (body?.error === 'forbidden') return 'Your role doesn’t include this. Ask your organisation’s owner or admin.';
  if (body?.error === 'date_range_too_long') return 'That range is too long. Choose 800 days or fewer.';
  if (body?.error === 'invalid_date_range') return 'Choose a start date and an end date, in that order.';
  if (body?.error === 'report_too_large') return 'That report is too big to download in one file (over 50,000 rows). Choose a shorter period, or one programme or group.';
  return fallback;
};
const change = (v: number | null): { direction: 'up' | 'down' | 'neutral'; label: string } | undefined =>
  (v == null ? undefined : { direction: v > 0 ? 'up' : v < 0 ? 'down' : 'neutral', label: `${v > 0 ? '+' : ''}${v}% on the period before` });

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
    api.orgDashboard(token, orgId, query).then(d => live && setDash(d)).catch(e => live && setError(failed(e, 'Could not load the figures.')));
    return () => { live = false; };
  }, [token, orgId, query, tick]);
  useEffect(() => {
    if (!range) return;
    api.orgProgramAnalytics(token, orgId, range).then(r => setPrograms(r.items)).catch(() => setPrograms([]));
  }, [token, orgId, range, tick]);

  const tabs: Array<[Tab, string]> = [['overview', 'Overview'], ...(can.people ? [['people', 'People'] as [Tab, string]] : []), ['benefits', 'Programmes & benefits'], ['providers', 'Gyms & trainers'],
    ...(can.billing ? [['billing', 'Billing'] as [Tab, string]] : []), ['reports', 'Reports']];

  return (
    <div className="space-y-5" data-testid="org-insights">
      <PageHeader title="Insights" description={`${orgName} · who is taking part, what is being used, and what it costs.`}
        actions={<Button variant="secondary" size="sm" onClick={() => setTick(t => t + 1)}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
      <div className="flex flex-wrap items-end gap-2" data-testid="insights-filters">
        <select className="ui-input !w-auto" aria-label="Period" value={preset} onChange={e => setPreset(e.target.value)} data-testid="insights-period">
          {PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {preset === 'custom' && (
          <>
            <input className="ui-input !w-auto" type="date" aria-label="From" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} />
            <input className="ui-input !w-auto" type="date" aria-label="To" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} />
          </>
        )}
        {programs.length > 1 && (
          <select className="ui-input !w-auto" aria-label="Programme" value={programId} onChange={e => setProgramId(e.target.value)}>
            <option value="">All programmes</option>
            {programs.map(p => <option key={p.programId} value={p.programId}>{p.name}</option>)}
          </select>
        )}
        {dash && dash.beneficiaries.groups.length > 0 && (
          <select className="ui-input !w-auto" aria-label="Group" value={group} onChange={e => setGroup(e.target.value)}>
            <option value="">All groups</option>
            {(group && !dash.beneficiaries.groups.includes(group) ? [group, ...dash.beneficiaries.groups] : dash.beneficiaries.groups).map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        {dash && <span className="pb-2 text-xs text-[var(--color-fg-quaternary)]">{day(dash.period.from)} to {day(dash.period.to)} · East Africa Time · live figures</span>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Segmented className="w-fit max-w-full overflow-x-auto" value={tab} onChange={v => setTab(v as Tab)} options={tabs} />

      {!query ? <Alert tone="info">Choose a start date and an end date.</Alert> : (
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
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="insights-kpis">
        <Kpi label="People on your list" value={num(d.beneficiaries.total)} sub={`${num(d.beneficiaries.enrolled)} enrolled · ${num(d.beneficiaries.pending)} pending · ${num(d.beneficiaries.enrolledInPeriod)} joined this period`} />
        <Kpi label="Used a benefit" value={num(p.activeBeneficiaries)} sub={`${pct(p.utilisationRatePct)} of enrolled · ${num(p.inactiveBeneficiaries)} did not`} trend={change(p.changePct)} />
        <Kpi label="Sponsored visits" value={num(d.usage.sponsoredVisits)} sub={`${num(d.usage.uses)} pay-per-use · ${num(d.usage.passCheckins)} on sponsored passes`} trend={change(d.usage.usesChangePct)} />
        <Kpi label="Your spend on usage" value={cash(d.spend.sponsorTotalTzs)} sub={`${cash(d.spend.sponsorPerUseTzs)} per use · ${cash(d.spend.sponsorPassFeesTzs)} pass fees`} />
        <Kpi label="Cost per person who used a benefit" value={cash(d.spend.costPerActiveBeneficiaryTzs)} sub="An operating figure, not a return on investment" />
        <Kpi label="Cost per sponsored visit" value={cash(d.spend.costPerSponsoredVisitTzs)} sub={d.usage.averagePerActiveBeneficiary == null ? undefined : `${d.usage.averagePerActiveBeneficiary} visits per person on average`} />
        <Kpi label="Benefits in use" value={`${num(d.benefits.usedInPeriod)} of ${num(d.benefits.active)}`} sub={d.benefits.endingWithin30Days ? `${d.benefits.endingWithin30Days} ending within 30 days` : 'active benefits used this period'} />
        <Kpi label="Gyms and trainers used" value={num(d.providers.used)} sub={`Members paid ${cash(d.spend.memberPerUseTzs + d.spend.memberPassSharesTzs)} themselves`} />
      </div>

      <Card>
        <CardHeader><span className="text-sm font-semibold">Sponsored visits and people using benefits, by {d.period.bucket}</span></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={d.trend.map(t => ({ ...t, visits: t.uses + t.passCheckins }))} margin={{ left: -16, right: 8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="bucket" tickFormatter={shortDay} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={v => shortDay(String(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" name="Sponsored visits" dataKey="visits" stroke={BRAND} strokeWidth={2} fill={BRAND} fillOpacity={0.12} />
              <Area type="monotone" name="People using a benefit" dataKey="activeBeneficiaries" stroke={SECOND} strokeWidth={2} fill={SECOND} fillOpacity={0.08} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><span className="text-sm font-semibold">Where people went</span></CardHeader>
          <CardContent>
            {d.providers.top.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No sponsored visits in this period.</p> : (
              <table className="w-full text-sm" data-testid="insights-top-providers">
                <thead><tr className={HEAD}><Th>Gym or trainer</Th><Th right>Visits</Th><Th right>Your spend</Th></tr></thead>
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
          <CardHeader><span className="text-sm font-semibold">Activity on FitFlex</span></CardHeader>
          <CardContent className="space-y-1 text-sm" data-testid="insights-engagement">
            {([['People who were active', num(d.engagement.peopleWithActivity)], ['Gym check-ins (all, sponsored or not)', num(d.engagement.gymCheckins)], ['Workouts recorded', num(d.engagement.workouts)],
              ['Activities recorded', num(d.engagement.activities)], ['Steps', num(d.engagement.steps)], ['Distance', `${num(d.engagement.distanceKm)} km`], ['Active minutes', num(d.engagement.activeMinutes)],
              ['People in your challenges', num(d.engagement.peopleInChallenges)]] as Array<[string, string]>).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3"><span className="text-[var(--color-fg-tertiary)]">{label}</span><span className="font-medium">{value}</span></div>
            ))}
            <p className="pt-2 text-xs text-[var(--color-fg-quaternary)]">What your people recorded, whoever paid. These are counts of activity, not health results.</p>
          </CardContent>
        </Card>
      </div>

      {d.billing && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="insights-billing-kpis">
          <Kpi label="Invoiced this period" value={cash(d.billing.invoicedTzs)} sub={`${num(d.billing.invoices)} invoice${d.billing.invoices === 1 ? '' : 's'}`} />
          <Kpi label="Paid this period" value={cash(d.billing.paidTzs)} sub={`${num(d.billing.payments)} payment${d.billing.payments === 1 ? '' : 's'}`} />
          <Kpi label="Outstanding now" value={cash(d.billing.outstandingTzs)} sub={`as of ${day(d.billing.asOf)}`} />
          <Kpi label="Overdue now" value={<span className={d.billing.overdueTzs > 0 ? 'text-[var(--color-error-600)]' : ''}>{cash(d.billing.overdueTzs)}</span>} />
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
  useEffect(() => {
    let live = true;
    setError(null);
    const t = setTimeout(() => {
      api.orgPeopleAnalytics(token, orgId, { ...query, search: search || undefined, activity: activity || undefined, sort, limit: 200 })
        .then(r => { if (live) { setRows(r.items); setTotal(r.total); } }).catch(e => live && setError(failed(e, 'Could not load people.')));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [token, orgId, query, search, activity, sort, tick]);

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <input className="ui-input !w-64" placeholder="Search by name, reference or group" aria-label="Search people" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="ui-input !w-auto" aria-label="Show" value={activity} onChange={e => setActivity(e.target.value)}>
            <option value="">Everyone</option><option value="active">Used a benefit</option><option value="inactive">Enrolled, did not use a benefit</option>
          </select>
          <select className="ui-input !w-auto" aria-label="Sort" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="name">By name</option><option value="uses">Most visits first</option><option value="spend">Highest spend first</option><option value="last_active">Most recently active</option>
          </select>
          <span className="text-xs text-[var(--color-fg-quaternary)]">{rows ? `${rows.length} of ${total}` : ''}</span>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {!rows ? !error && <Spinner className="h-6 w-6" /> : rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">Nobody matches.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="insights-people">
              <thead>
                <tr className={HEAD}><Th>Name</Th><Th>Group</Th><Th>Status</Th><Th right>Sponsored visits</Th><Th right>Your spend</Th><Th right>All gym check-ins</Th><Th right>Workouts</Th><Th right>Steps</Th><Th>Last active</Th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.beneficiaryId} className={ROW}>
                    <td className="py-2 pr-3"><button className="text-left font-medium text-[var(--color-fg-brand)]" onClick={() => setOpen(r.beneficiaryId)} data-testid={`person-${r.beneficiaryId}`}>{r.name ?? r.externalReference ?? 'Not linked yet'}</button></td>
                    <td className="py-2 pr-3">{r.group ?? ''}</td>
                    <td className="py-2 pr-3">{r.status === 'active' ? (r.active ? <Badge tone="success">Used a benefit</Badge> : <Badge tone="gray">No use yet</Badge>) : <Badge tone="warning">{words(r.status)}</Badge>}</td>
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
          You see what your people do on FitFlex, including activity you didn’t pay for. You never see their weight or height, or anything another employer, insurer or club gives them. Each person is told this in the app.
        </p>
      </CardContent>
      {open && <Person token={token} orgId={orgId} beneficiaryId={open} query={query} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function Person({ token, orgId, beneficiaryId, query, onClose }: { token: string; orgId: string; beneficiaryId: string; query: B2BAnalyticsQuery; onClose: () => void }) {
  const [p, setP] = useState<B2BPersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.orgPersonAnalytics(token, orgId, beneficiaryId, { period: query.period, from: query.from, to: query.to }).then(setP).catch(e => setError(failed(e, 'Could not load this person.')));
  }, [token, orgId, beneficiaryId, query]);
  const section = (title: string, body: React.ReactNode) => (<div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-quaternary)]">{title}</div>{body}</div>);
  const none = (text: string) => <p className="text-sm text-[var(--color-fg-quaternary)]">{text}</p>;
  return (
    <Dialog open onClose={onClose} title={p?.beneficiary.name ?? 'Person'} description={p ? `${[p.beneficiary.group, words(p.beneficiary.status)].filter(Boolean).join(' · ')} · ${day(p.period.from)} to ${day(p.period.to)}` : undefined} size="xl">
      {error && <Alert tone="error">{error}</Alert>}
      {!p ? !error && <Spinner className="h-6 w-6" /> : (
        <div className="space-y-4" data-testid="person-detail">
          {!p.beneficiary.linkedToAccount && <Alert tone="info">This person hasn’t joined FitFlex with the details you gave, so there is nothing to show yet.</Alert>}
          <div className="grid gap-3 sm:grid-cols-4">
            <Kpi label="Sponsored visits" value={num(p.totals.uses + p.totals.passCheckins)} />
            <Kpi label="You paid" value={cash(p.totals.sponsorTzs)} sub={p.totals.beneficiaryTzs ? `They paid ${cash(p.totals.beneficiaryTzs)}` : undefined} />
            <Kpi label="Other gym visits" value={num(p.totals.otherGymVisits)} />
            <Kpi label="Activities recorded" value={num(p.totals.activities)} />
          </div>
          {section('Sponsored visits and sessions', p.sponsoredUsage.length === 0 && p.passCheckins.length === 0 ? none('None in this period.') : (
            <table className="w-full text-sm">
              <thead><tr className={HEAD}><Th>Date</Th><Th>What</Th><Th>Where</Th><Th>Benefit</Th><Th right>You paid</Th><Th right>They paid</Th></tr></thead>
              <tbody>
                {[...p.sponsoredUsage.map(r => ({ key: r.id, day: r.day, what: SERVICE[r.serviceType] ?? words(r.serviceType), where: r.provider, benefit: r.benefitName, sponsor: r.sponsorTzs as number | null, member: r.memberTzs as number | null })),
                  ...p.passCheckins.map(r => ({ key: r.id, day: r.day, what: 'Check-in on sponsored pass', where: r.gym, benefit: r.benefitName, sponsor: null, member: null }))]
                  .sort((a, b) => b.day.localeCompare(a.day)).map(r => (
                    <tr key={r.key} className={ROW}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{day(r.day)}</td><td className="py-1.5 pr-3">{r.what}</td><td className="py-1.5 pr-3">{r.where ?? ''}</td><td className="py-1.5 pr-3">{r.benefit ?? ''}</td>
                      <td className="py-1.5 pr-3 text-right">{r.sponsor == null ? 'in pass fee' : cash(r.sponsor)}</td><td className="py-1.5 pr-3 text-right">{r.member ? cash(r.member) : ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ))}
          {p.passes.length > 0 && section('Sponsored passes', (
            <ul className="space-y-1 text-sm">{p.passes.map(e => <li key={`${e.period}-${e.benefitName}`}>{e.period} · {e.passTier} pass · {words(e.status)} · you {cash(e.sponsorTzs)}{e.memberTzs ? ` · they ${cash(e.memberTzs)}` : ''}</li>)}</ul>
          ))}
          {section('Your challenges', p.challenges.length === 0 ? none('Not in any of your challenges.') : (
            <ul className="space-y-1 text-sm">{p.challenges.map(c => <li key={c.id}>{c.name} · {num(c.progress)} of {num(c.target)} {c.completed ? <Badge tone="success">Completed</Badge> : <span className="text-[var(--color-fg-quaternary)]">({words(c.phase)})</span>}</li>)}</ul>
          ))}
          {section('Other gym visits (not paid for by you)', p.otherGymVisits.length === 0 ? none('None in this period.') : (
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">{p.otherGymVisits.map(v => <li key={v.id}>{day(v.day)} · {v.gym ?? 'Gym'}</li>)}</ul>
          ))}
          {section('Activities they recorded', p.activities.length === 0 ? none('None in this period.') : (
            <table className="w-full text-sm">
              <thead><tr className={HEAD}><Th>Date</Th><Th>Activity</Th><Th right>Minutes</Th><Th right>Distance</Th><Th right>Steps</Th><Th>Recorded by</Th></tr></thead>
              <tbody>
                {p.activities.map(a => (
                  <tr key={a.id} className={ROW}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{day(a.day)}</td><td className="py-1.5 pr-3 capitalize">{words(a.type)}{a.gym ? ` · ${a.gym}` : ''}</td>
                    <td className="py-1.5 pr-3 text-right">{a.durationMinutes ?? a.activeMinutes ?? ''}</td><td className="py-1.5 pr-3 text-right">{a.distanceKm ? `${a.distanceKm} km` : ''}</td>
                    <td className="py-1.5 pr-3 text-right">{a.steps ? num(a.steps) : ''}</td><td className="py-1.5 pr-3">{a.source === 'device' ? 'Phone or watch' : a.source === 'manual' ? 'Entered by hand' : words(a.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
          {p.totals.capped && <p className="text-xs text-[var(--color-fg-quaternary)]">Only the latest 300 of each list are shown. Use a shorter period or the reports for everything.</p>}
          <p className="text-xs text-[var(--color-fg-quaternary)]">Not shown: {p.notShown.join(', ')}.</p>
        </div>
      )}
    </Dialog>
  );
}

function Benefits({ token, orgId, query, programs, tick }: { token: string; orgId: string; query: B2BAnalyticsQuery; programs: B2BProgramAnalytics[]; tick: number }) {
  const [rows, setRows] = useState<B2BBenefitAnalytics[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    api.orgBenefitAnalytics(token, orgId, { period: query.period, from: query.from, to: query.to, programId: query.programId }).then(r => setRows(r.items)).catch(e => setError(failed(e, 'Could not load benefits.')));
  }, [token, orgId, query, tick]);
  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><span className="text-sm font-semibold">Programmes</span></CardHeader>
        <CardContent>
          {programs.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No programmes yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="insights-programs">
                <thead><tr className={HEAD}><Th>Programme</Th><Th>Status</Th><Th right>Eligible</Th><Th right>Used a benefit</Th><Th right>Participation</Th><Th right>Visits</Th><Th right>Your spend</Th><Th right>Budget used</Th></tr></thead>
                <tbody>
                  {programs.map(p => (
                    <tr key={p.programId} className={ROW}>
                      <td className="py-2 pr-3 font-medium">{p.name}</td><td className="py-2 pr-3 capitalize">{words(p.status)}</td><td className="py-2 pr-3 text-right">{num(p.eligible)}</td>
                      <td className="py-2 pr-3 text-right">{num(p.activeBeneficiaries)}</td><td className="py-2 pr-3 text-right">{pct(p.participationPct)}</td><td className="py-2 pr-3 text-right">{num(p.uses + p.passCheckins)}</td>
                      <td className="py-2 pr-3 text-right">{cash(p.sponsorTotalTzs)}</td>
                      <td className="py-2 pr-3 text-right">{p.budget.budgetTzs == null ? 'No budget set' : `${pct(p.budget.usedPct)} of ${cash(p.budget.budgetTzs)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">Budget used counts pay-per-use spend over the programme’s whole life, not just this period.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><span className="text-sm font-semibold">Benefits</span></CardHeader>
        <CardContent>
          {!rows ? !error && <Spinner className="h-6 w-6" /> : rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No benefits yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="insights-benefits">
                <thead><tr className={HEAD}><Th>Benefit</Th><Th right>Eligible</Th><Th right>Used it</Th><Th right>Reach</Th><Th right>Uses</Th><Th right>Per user</Th><Th right>Your spend</Th><Th right>Members paid</Th><Th>Allowance now</Th></tr></thead>
                <tbody>
                  {rows.map(b => (
                    <tr key={b.benefitId} className={ROW}>
                      <td className="py-2 pr-3"><div className="font-medium">{b.name}</div><div className="text-xs text-[var(--color-fg-quaternary)]">{b.programName} · {SERVICE[b.benefitType] ?? words(b.benefitType)}{b.status !== 'active' ? ` · ${words(b.status)}` : ''}</div></td>
                      <td className="py-2 pr-3 text-right">{num(b.eligible)}</td><td className="py-2 pr-3 text-right">{num(b.users)}</td><td className="py-2 pr-3 text-right">{pct(b.reachPct)}</td>
                      <td className="py-2 pr-3 text-right">{num(b.uses)}</td><td className="py-2 pr-3 text-right">{b.averageUsesPerUser ?? '—'}</td><td className="py-2 pr-3 text-right">{cash(b.sponsorTzs)}</td><td className="py-2 pr-3 text-right">{b.memberTzs ? cash(b.memberTzs) : ''}</td>
                      <td className="py-2 pr-3 text-xs">{b.allowance ? `${pct(b.allowance.usedPct)} used · ${b.allowance.peopleAtLimit} at limit · ${b.allowance.peopleNearLimit} near it` : b.usageLimit ? 'Not running today' : 'No limit'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">Reach is the share of eligible people who used the benefit at all. Allowance is for the current day, week or month the limit runs over, whatever period is selected above.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Providers({ token, orgId, query, tick }: { token: string; orgId: string; query: B2BAnalyticsQuery; tick: number }) {
  const [rows, setRows] = useState<B2BProviderAnalytics[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    api.orgProviderAnalytics(token, orgId, { period: query.period, from: query.from, to: query.to, programId: query.programId }).then(r => setRows(r.items)).catch(e => setError(failed(e, 'Could not load gyms and trainers.')));
  }, [token, orgId, query, tick]);
  const staff = rows?.some(r => r.settlement);
  return (
    <Card>
      <CardContent className="py-4">
        {error && <Alert tone="error">{error}</Alert>}
        {!rows ? !error && <Spinner className="h-6 w-6" /> : rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No sponsored visits in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="insights-providers">
              <thead><tr className={HEAD}><Th>Gym or trainer</Th><Th>Location</Th><Th right>Visits</Th><Th right>People</Th><Th right>Came back</Th><Th right>Service value</Th><Th right>Sponsor paid</Th>{staff && <Th right>Not yet in settlement</Th>}</tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.providerType}:${r.providerId}`} className={ROW}>
                    <td className="py-2 pr-3 font-medium">{r.name ?? r.providerId} <span className="text-xs font-normal text-[var(--color-fg-quaternary)]">{r.providerType}</span></td><td className="py-2 pr-3">{r.location ?? ''}</td>
                    <td className="py-2 pr-3 text-right">{num(r.visits)}</td><td className="py-2 pr-3 text-right">{num(r.people)}</td><td className="py-2 pr-3 text-right">{num(r.repeatPeople)}</td>
                    <td className="py-2 pr-3 text-right">{cash(r.serviceValueTzs)}</td><td className="py-2 pr-3 text-right">{cash(r.sponsorTzs)}</td>
                    {staff && <td className="py-2 pr-3 text-right">{r.settlement ? `${num(r.settlement.notYetSettled)} of ${num(r.settlement.perUseVisits)}` : ''}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">
          Service value is the list price of pay-per-use visits; check-ins on a sponsored pass are covered by the pass fee.{staff ? ' Settlement progress is shown to FitFlex staff only; what a provider is paid is settled separately from what the organisation is billed.' : ''}
        </p>
      </CardContent>
    </Card>
  );
}

function Billing({ token, orgId, query, tick }: { token: string; orgId: string; query: B2BAnalyticsQuery; tick: number }) {
  const [f, setF] = useState<B2BFinanceAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    api.orgFinanceAnalytics(token, orgId, query).then(setF).catch(e => setError(failed(e, 'Could not load billing.')));
  }, [token, orgId, query, tick]);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!f) return <Spinner className="h-6 w-6" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Invoiced this period" value={cash(f.billing.invoicedTzs)} /><Kpi label="Paid this period" value={cash(f.billing.paidTzs)} />
        <Kpi label="Outstanding now" value={cash(f.billing.outstandingTzs)} /><Kpi label="Credit on account" value={cash(f.billing.creditTzs)} />
      </div>
      <Aging aging={f.billing.aging} />
      <Card>
        <CardHeader><span className="text-sm font-semibold">By month</span></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={f.months.map(m => ({ ...m, usage: m.sponsorPerUseTzs + m.sponsorPassFeesTzs }))} margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => (Number(v) >= 1_000_000 ? `${Number(v) / 1_000_000}m` : Number(v) >= 1000 ? `${Number(v) / 1000}k` : String(v))} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
              <Tooltip formatter={v => money(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar name="Used (your share)" dataKey="usage" fill={SECOND} radius={[4, 4, 0, 0]} />
              <Bar name="Invoiced" dataKey="invoicedTzs" fill={BRAND} radius={[4, 4, 0, 0]} />
              <Bar name="Paid" dataKey="collectedTzs" fill="#98a2b3" radius={[4, 4, 0, 0]} />
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
  const get = async (report: string) => {
    setBusy(report); setError(null); setDone(null);
    try {
      const out = await api.orgExport(token, orgId, report, query);
      saveCsv(out.filename, out.csv);
      setDone(`${out.title}: ${out.rows.toLocaleString('en-US')} row${out.rows === 1 ? '' : 's'} downloaded.`);
    } catch (e) {
      setError(failed(e, 'Could not make that report.'));
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
              <div><div className="text-sm font-medium">{r.title}</div><div className="text-xs text-[var(--color-fg-quaternary)]">{r.about}</div></div>
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => get(r.key)} data-testid={`export-${r.key}`}><Download className="h-4 w-4" />{busy === r.key ? 'Preparing…' : 'Download CSV'}</Button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--color-fg-quaternary)]">Reports cover the period and filters selected above and open in Excel or Google Sheets. Each download is recorded. For a PDF, print the page from your browser.</p>
      </CardContent>
    </Card>
  );
}

/** Insights for an organisation's own users and for a company's HR login. */
export function OrgInsightsPage() {
  const state = useMyOrganization();
  return (
    <OrgFrame bare title="Insights" description="" state={state}>
      {(mine, token) => (mine.permissions.includes('analytics.read')
        ? <OrgInsights token={token} orgId={mine.organization.id} orgName={mine.organization.tradingName || mine.organization.legalName}
          can={{ people: mine.permissions.includes('analytics.people'), billing: mine.permissions.includes('billing.read') }} />
        : <Alert tone="info">Your role doesn’t include insights. Ask your organisation’s owner or admin.</Alert>)}
    </OrgFrame>
  );
}
