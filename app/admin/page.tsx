'use client';
/*
 * Admin overview (Phase 2B S3).
 *
 * What needs attention first, then the key figures, two charts and recent activity.
 * Every figure comes from a call another admin page already makes; nothing here changes data.
 * Each source loads on its own: one that fails is named in a notice with a retry, one that is
 * switched off on the server (404) or outside the person's scopes (403) is simply not drawn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { useApp } from '../providers';
import { api, type AnalyticsOverview, type Gym, type KycCaseRow, type MemberSummary, type PaymentRequest, type Refund, type RoleApproval } from '@/lib/api';
import { heldPaymentsApi, type HeldPayment } from '@/lib/held-payments';
import { securityIncidentsApi, type SecurityIncident } from '@/lib/security-incidents';
import { auditApi, NO_AUDIT_FILTERS, type AuditEntry } from '@/lib/audit-log';
import { EVENTS_MODULE } from '@/lib/flags';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, FeatureCard, PageHeader, QueueCard, Segmented, SkeletonCard,
  Table, TBody, Td, Th, THead, Tr,
} from '@/components/shared';
import { formatNumber, money, statusLabel, statusTone } from '@/lib/admin-utils';

/* Chart colours mirror the design tokens (SVG attributes cannot read CSS variables reliably). */
const CHART = { line: '#102d24', grid: '#e5eae4', axis: '#5b6b64' };

const PERIODS: Array<[string, string]> = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']];

type Data = {
  gyms?: Gym[];
  members?: MemberSummary[];
  payments?: PaymentRequest[];
  approvals?: RoleApproval[];
  refunds?: Refund[];
  held?: HeldPayment[];
  kyc?: KycCaseRow[];
  moderationPending?: number;
  eventsSubmitted?: number;
  security?: { incidents: SecurityIncident[]; more: boolean };
  audit?: AuditEntry[];
};
type SourceKey = keyof Data;

const SOURCE_NAME: Record<SourceKey | 'analytics', string> = {
  gyms: 'Gyms', members: 'Members', payments: 'Payments', approvals: 'Role approvals', refunds: 'Refunds',
  held: 'Held payments', kyc: 'Partner verification', moderationPending: 'Moderation', eventsSubmitted: 'Events',
  security: 'Security reports', audit: 'Recent admin activity', analytics: 'Active members',
};

/** Not there for this person or this server: leave the tile out without calling it an error. */
const notAvailable = (err: unknown) => {
  const status = (err as { status?: number } | null)?.status;
  return status === 403 || status === 404;
};

/** East Africa Time calendar day, `daysAgo` days back (the analytics endpoint takes EAT days). */
const eatDay = (daysAgo = 0) => new Date(Date.now() + 3 * 3600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Dar_es_Salaam' }) : '—';

/** "Oldest 2 days" for a queue tile; null when nothing has a date. */
function oldest(dates: Array<string | null | undefined>, now: number): string | null {
  const times = dates.map(d => (d ? new Date(d).getTime() : NaN)).filter(t => !Number.isNaN(t));
  if (!times.length) return null;
  const minutes = Math.max(0, Math.round((now - Math.min(...times)) / 60_000));
  if (minutes < 60) return 'Oldest under 1 hour';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Oldest ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `Oldest ${days} ${days === 1 ? 'day' : 'days'}`;
}

export default function AdminOverviewPage() {
  const { token, user, hasPermission } = useApp();
  const isAdmin = !!token && user?.userType === 'admin';
  const [data, setData] = useState<Data>({});
  const [failed, setFailed] = useState<SourceKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [days, setDays] = useState('30');
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [analyticsState, setAnalyticsState] = useState<'loading' | 'ok' | 'error' | 'off'>('loading');
  const run = useRef(0);

  const can = useMemo(() => ({
    gyms: hasPermission('gyms'),
    members: hasPermission('members'),
    payments: hasPermission('payments'),
    approvals: hasPermission('approvals'),
    kyc: hasPermission('kyc'),
    moderation: hasPermission('moderation') || hasPermission('moderation_decide'),
    events: EVENTS_MODULE && hasPermission('events'),
    security: hasPermission('security_incidents'),
    audit: hasPermission('audit'),
    analytics: hasPermission('analytics'),
  }), [hasPermission]);

  const load = useCallback(async () => {
    if (!token || !isAdmin) return;
    const mine = ++run.current;
    setLoading(true);
    const tasks: Array<[SourceKey, Promise<Data[SourceKey]>]> = [];
    if (can.gyms) tasks.push(['gyms', api.adminGyms(token)]);
    if (can.members) tasks.push(['members', api.members(token)]);
    if (can.payments) {
      tasks.push(['payments', api.paymentRequests(token)]);
      tasks.push(['refunds', api.refunds(token, 'requested').then(r => r.refunds)]);
      tasks.push(['held', heldPaymentsApi.list(token, 'open').then(r => r.items)]);
    }
    if (can.approvals) tasks.push(['approvals', api.roleApprovals(token)]);
    if (can.kyc) tasks.push(['kyc', api.kycCases(token)]);
    if (can.moderation) tasks.push(['moderationPending', api.moderationCounts(token).then(r => Number(r.counts?.pending) || 0)]);
    if (can.events) tasks.push(['eventsSubmitted', api.adminEventsSummary(token).then(r => Number(r?.submitted) || 0)]);
    if (can.security) tasks.push(['security', securityIncidentsApi.list(token, 'open').then(r => ({ incidents: r.incidents ?? [], more: !!r.next }))]);
    if (can.audit) tasks.push(['audit', auditApi.list(token, NO_AUDIT_FILTERS).then(r => r.items.slice(0, 6))]);

    const settled = await Promise.allSettled(tasks.map(([, p]) => p));
    if (mine !== run.current) return;
    const next: Data = {};
    const bad: SourceKey[] = [];
    settled.forEach((result, i) => {
      const key = tasks[i][0];
      if (result.status === 'fulfilled') (next as Record<string, unknown>)[key] = result.value;
      else if (!notAvailable(result.reason)) bad.push(key);
    });
    setData(next);
    setFailed(bad);
    setUpdatedAt(Date.now());
    setLoading(false);
  }, [token, isAdmin, can]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!token || !isAdmin || !can.analytics) { setAnalyticsState('off'); return; }
    let live = true;
    setAnalyticsState('loading');
    api.adminAnalytics(token, eatDay(Number(days) - 1), eatDay())
      .then(r => { if (live) { setAnalytics(r); setAnalyticsState('ok'); } })
      .catch(err => { if (live) setAnalyticsState(notAvailable(err) ? 'off' : 'error'); });
    return () => { live = false; };
  }, [token, isAdmin, can.analytics, days, updatedAt]);

  const now = updatedAt ?? Date.now();
  const queues = useMemo(() => {
    const list: Array<{ key: string; href: string; count: number; label: string; note: string | null }> = [];
    if (data.payments) {
      const pending = data.payments.filter(p => p.status === 'pending');
      list.push({ key: 'payments', href: '/admin/payments', count: pending.length, label: 'Payments to approve', note: oldest(pending.map(p => p.requestedAt), now) });
    }
    if (data.refunds) list.push({ key: 'refunds', href: '/admin/refunds', count: data.refunds.length, label: 'Refunds to decide', note: oldest(data.refunds.map(r => r.createdAt), now) });
    if (data.held) list.push({ key: 'held', href: '/admin/payments-held', count: data.held.length, label: 'Held payments', note: oldest(data.held.map(h => h.at), now) });
    if (data.kyc) {
      const waiting = data.kyc.filter(k => k.status === 'submitted' || k.status === 'in_review');
      list.push({ key: 'kyc', href: '/admin/kyc', count: waiting.length, label: 'Partner verification', note: oldest(waiting.map(k => k.submittedAt), now) });
    }
    if (data.approvals) {
      const waiting = data.approvals.filter(a => a.approvalStatus === 'pending_approval');
      list.push({ key: 'approvals', href: '/admin/approvals', count: waiting.length, label: 'Role approvals', note: null });
    }
    if (data.moderationPending != null) list.push({ key: 'moderation', href: '/admin/moderation', count: data.moderationPending, label: 'Listings to moderate', note: null });
    if (data.eventsSubmitted != null) list.push({ key: 'events', href: '/admin/events', count: data.eventsSubmitted, label: 'Events to review', note: null });
    if (data.security) list.push({ key: 'security', href: '/admin/security-incidents', count: data.security.incidents.length, label: data.security.more ? 'Security reports (first page)' : 'Security reports', note: oldest(data.security.incidents.map(s => s.reportedAt), now) });
    return list;
  }, [data, now]);
  const waitingTotal = queues.reduce((sum, q) => sum + q.count, 0);

  const figures = useMemo(() => {
    const payments = data.payments ?? [];
    const members = data.members ?? [];
    const gyms = data.gyms ?? [];
    const byStatus = (s: string) => payments.filter(p => p.status === s).length;
    return {
      activeMembers: members.filter(m => (m.accountStatus || 'active') === 'active').length,
      suspendedMembers: members.filter(m => m.accountStatus === 'suspended').length,
      physicalGyms: gyms.filter(g => g.accessMode !== 'free_online').length,
      onlineGyms: gyms.filter(g => g.accessMode === 'free_online').length,
      approvedValue: payments.filter(p => p.status === 'approved').reduce((sum, p) => sum + p.amountTzs, 0),
      statuses: [
        ['approved', byStatus('approved')], ['pending', byStatus('pending')], ['rejected', byStatus('rejected')], ['cancelled', byStatus('cancelled')],
      ] as Array<[string, number]>,
    };
  }, [data]);

  if (!isAdmin) return null;

  const firstLoad = loading && updatedAt == null;
  const series = analytics?.dailyActive.series ?? [];
  const peak = series.reduce<{ day: string; members: number } | null>((best, p) => (!best || p.members > best.members ? p : best), null);
  const statusTotal = figures.statuses.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="space-y-6" data-testid="admin-overview">
      <PageHeader
        title="Overview"
        description={updatedAt ? `Updated ${dayTime(new Date(updatedAt).toISOString())}` : 'Loading the latest figures…'}
        actions={
          <Button variant="secondary" size="sm" onClick={load} loading={loading && !firstLoad} disabled={loading} data-testid="overview-refresh">
            {!(loading && !firstLoad) && <RefreshCw aria-hidden="true" className="h-4 w-4" />}
            Refresh
          </Button>
        }
      />

      {failed.length > 0 && (
        <div data-testid="overview-partial">
          <Alert tone="warning">
            <span>These didn&apos;t load: {failed.map(k => SOURCE_NAME[k]).join(', ')}. The rest of the page is up to date. </span>
            <button type="button" onClick={load} className="font-semibold underline underline-offset-2">Try again</button>
          </Alert>
        </div>
      )}

      {firstLoad ? (
        <div className="space-y-4" aria-busy="true" data-testid="overview-loading">
          <SkeletonCard lines={4} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
        </div>
      ) : (
        <>
          {queues.length > 0 && (
            <FeatureCard
              title="Needs attention"
              aside={<span className="rounded-full bg-[var(--color-forest)] px-3 py-1 text-sm font-semibold text-white" data-testid="overview-waiting-total">{waitingTotal === 0 ? 'Nothing waiting' : `${formatNumber(waitingTotal)} waiting`}</span>}
            >
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]" data-testid="overview-queues">
                {queues.map(q => (
                  <div key={q.key} data-testid={`queue-${q.key}`} className="flex [&>a]:flex-1">
                    <QueueCard href={q.href} count={q.count} label={q.label} note={q.count > 0 ? q.note : 'Nothing waiting'} />
                  </div>
                ))}
              </div>
            </FeatureCard>
          )}

          <section aria-label="Key figures" className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
            {data.members && <Figure label="Members" value={formatNumber(data.members.length)} sub={`${formatNumber(figures.activeMembers)} active · ${formatNumber(figures.suspendedMembers)} suspended`} />}
            {data.gyms && <Figure label="Gyms" value={formatNumber(data.gyms.length)} sub={`${formatNumber(figures.physicalGyms)} physical · ${formatNumber(figures.onlineGyms)} online`} />}
            {data.payments && <Figure label="Approved value" value={money(figures.approvedValue)} sub={`${formatNumber(data.payments.length)} payment requests in all`} compact />}
            {analyticsState === 'ok' && analytics && <Figure dark label="Active in last 7 days" value={formatNumber(analytics.dailyActive.activeLast7Days)} sub={`Average ${formatNumber(Math.round(analytics.dailyActive.averageDaily))} a day over ${analytics.period.days} days`} />}
          </section>

          {(analyticsState !== 'off' || data.payments) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {analyticsState !== 'off' && (
                <Card data-testid="overview-active-chart">
                  <CardHeader className="flex-wrap">
                    <div>
                      <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">Active members per day</h2>
                      <p className="text-sm text-[var(--color-fg-tertiary)]">
                        {analyticsState === 'ok' && peak ? `Highest ${formatNumber(peak.members)} on ${shortDay(peak.day)}` : analyticsState === 'error' ? 'Didn’t load' : 'Loading…'}
                      </p>
                    </div>
                    <Segmented value={days} options={PERIODS} onChange={setDays} />
                  </CardHeader>
                  <CardContent>
                    {analyticsState === 'error' ? (
                      <p className="py-10 text-center text-sm text-[var(--color-fg-tertiary)]">Active members didn&apos;t load. Use Refresh to try again, or open Analytics.</p>
                    ) : series.length === 0 ? (
                      <p className="py-10 text-center text-sm text-[var(--color-fg-tertiary)]">{analyticsState === 'loading' ? 'Loading…' : 'No member activity in this period yet.'}</p>
                    ) : (
                      <div role="img" aria-label={`Active members per day over ${series.length} days, from ${shortDay(series[0].day)} to ${shortDay(series[series.length - 1].day)}${peak ? `; highest ${peak.members} on ${shortDay(peak.day)}` : ''}`}>
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                            <CartesianGrid stroke={CHART.grid} vertical={false} />
                            <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 12, fill: CHART.axis }} axisLine={false} tickLine={false} minTickGap={32} />
                            <YAxis tick={{ fontSize: 12, fill: CHART.axis }} axisLine={false} tickLine={false} allowDecimals={false} />
                            <Tooltip labelFormatter={(d) => shortDay(String(d))} formatter={(v) => [formatNumber(Number(v)), 'Active members']} />
                            <Line type="monotone" dataKey="members" stroke={CHART.line} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {data.payments && (
                <Card data-testid="overview-payment-status">
                  <CardHeader>
                    <div>
                      <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">Payment requests by status</h2>
                      <p className="text-sm text-[var(--color-fg-tertiary)]">{formatNumber(statusTotal)} requests in all</p>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {statusTotal === 0 ? (
                      <p className="py-10 text-center text-sm text-[var(--color-fg-tertiary)]">No payment requests yet.</p>
                    ) : (
                      <dl className="m-0 space-y-4">
                        {figures.statuses.map(([status, n]) => (
                          <div key={status} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-3 text-sm">
                            <dt className="text-[var(--color-fg-secondary)]">{statusLabel(status)}</dt>
                            <dd className="m-0 h-3 overflow-hidden rounded-full bg-[var(--color-gray-200)]" aria-hidden="true">
                              <span className="block h-full rounded-full bg-[var(--color-forest)]" style={{ width: `${statusTotal ? (n / statusTotal) * 100 : 0}%` }} />
                            </dd>
                            <dd className="m-0 text-right font-semibold tabular-nums text-[var(--color-fg-primary)]">{formatNumber(n)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {data.payments && (
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">Recent payment requests</h2>
                <Link href="/admin/payments">
                  <Button variant="secondary" size="sm" className="whitespace-nowrap">View all <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /></Button>
                </Link>
              </CardHeader>
              {data.payments.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-[var(--color-fg-tertiary)]">No payment requests yet.</p>
              ) : (
                <Table aria-label="Recent payment requests" wrapperClassName="rounded-none border-0">
                  <THead><Tr><Th>Member</Th><Th>Pass</Th><Th className="text-right">Amount</Th><Th>Requested</Th><Th>Status</Th></Tr></THead>
                  <TBody>
                    {data.payments.slice(0, 6).map(p => (
                      <Tr key={p.id}>
                        <Td><span className="font-semibold text-[var(--color-fg-primary)]">{p.member?.displayName || p.member?.email || p.memberId}</span></Td>
                        <Td><Badge tone="brand">{(p.tier ?? '—').toUpperCase()}</Badge></Td>
                        <Td className="whitespace-nowrap text-right font-medium tabular-nums">{money(p.amountTzs)}</Td>
                        <Td className="whitespace-nowrap tabular-nums">{dayTime(p.requestedAt)}</Td>
                        <Td><Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge></Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          )}

          {data.audit && (
            <Card data-testid="overview-audit">
              <CardHeader>
                <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">Recent admin activity</h2>
                <Link href="/admin/audit">
                  <Button variant="secondary" size="sm" className="whitespace-nowrap">Audit log <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /></Button>
                </Link>
              </CardHeader>
              {data.audit.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-[var(--color-fg-tertiary)]">No admin activity recorded yet.</p>
              ) : (
                <Table aria-label="Recent admin activity" wrapperClassName="rounded-none border-0">
                  <THead><Tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>On</Th></Tr></THead>
                  <TBody>
                    {data.audit.map(a => (
                      <Tr key={a.id}>
                        <Td className="whitespace-nowrap tabular-nums">{dayTime(a.at)}</Td>
                        <Td className="[overflow-wrap:anywhere]">{a.actor || '—'}</Td>
                        <Td className="font-medium text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{a.action}</Td>
                        <Td className="[overflow-wrap:anywhere]">{a.target || '—'}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          )}

          {queues.length === 0 && !data.members && !data.gyms && !data.payments && !data.audit && analyticsState === 'off' && failed.length === 0 && (
            <Card><CardContent><p className="py-6 text-center text-sm text-[var(--color-fg-tertiary)]" data-testid="overview-empty">Nothing on the overview is open to your role. Use the menu to go to your pages.</p></CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}

/** A key figure. Never a bare number: the label says what it is and the line under it gives the context. */
function Figure({ label, value, sub, dark = false, compact = false }: { label: string; value: string; sub?: string; dark?: boolean; compact?: boolean }) {
  return (
    <div className={dark
      ? 'flex flex-col gap-1 rounded-[var(--radius-xl)] bg-[var(--color-forest)] p-5 text-white'
      : 'flex flex-col gap-1 rounded-[var(--radius-xl)] bg-[var(--color-bg-primary)] p-5 shadow-[var(--shadow-sm)]'}>
      <p className={dark ? 'text-sm text-white/75' : 'text-sm text-[var(--color-fg-tertiary)]'}>{label}</p>
      <p className={`${compact ? 'text-[1.75rem] leading-9' : 'text-[2.5rem] leading-[2.75rem]'} font-extrabold tracking-tight tabular-nums ${dark ? 'text-[var(--color-lime)]' : 'text-[var(--color-fg-primary)]'}`}>{value}</p>
      {sub && <p className={dark ? 'text-sm text-white/75' : 'text-sm text-[var(--color-fg-tertiary)]'}>{sub}</p>}
    </div>
  );
}
