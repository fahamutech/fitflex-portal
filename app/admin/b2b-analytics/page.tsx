'use client';
import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, B2BAnalyticsOverview, B2BDataQuality } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, CardHeader, PageHeader, Spinner } from '@/components/shared';
import { OrgInsights, PERIODS } from '@/components/b2b-insights';
import { day } from '@/components/b2b-finance';
import { money } from '@/lib/admin-utils';

const BRAND = '#079455';
const num = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US'));
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const HEAD = 'border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]';
const ROW = 'border-b border-[var(--color-border-secondary)]';
const TONE: Record<string, 'danger' | 'warning' | 'gray'> = { high: 'danger', medium: 'warning', low: 'gray' };

/**
 * FitFlex staff: the whole B2B book for a period, the records that need a
 * second look, and any one organisation's insights exactly as it sees them.
 */
export default function B2BAnalyticsPage() {
  const { token, user, hasPermission } = useApp();
  const [period, setPeriod] = useState('this_month');
  const [data, setData] = useState<B2BAnalyticsOverview | null>(null);
  const [quality, setQuality] = useState<B2BDataQuality | null>(null);
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setError(null);
    api.adminB2BAnalytics(token, { period }).then(setData).catch(() => setError('Could not load B2B insights.'));
    api.adminB2BDataQuality(token).then(setQuality).catch(() => setQuality(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, period]);
  useEffect(() => {
    if (!token) return;
    api.b2bOrganizations(token, { limit: 100 }).then(r => setOrgs(r.items.map(o => ({ id: o.id, name: o.tradingName || o.legalName })))).catch(() => undefined);
  }, [token]);

  if (!token || user?.userType !== 'admin') return null;
  if (org) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" size="sm" onClick={() => setOrg(null)}><ArrowLeft className="h-4 w-4" />All organisations</Button>
        <OrgInsights token={token} orgId={org.id} orgName={org.name} can={{ people: true, billing: hasPermission('b2b_billing') || hasPermission('b2b_billing_approve') || hasPermission('b2b_payments') || hasPermission('b2b'), staff: true }} />
      </div>
    );
  }

  const cards: Array<[string, string, string]> = data ? [
    ['Organisations', num(data.organizations.total), `${num(data.organizations.active)} active · ${num(data.organizations.withUsage)} with usage · ${num(data.organizations.createdInPeriod)} new`],
    ['People covered', num(data.beneficiaries.total), `${num(data.beneficiaries.enrolled)} enrolled · ${num(data.beneficiaries.linkedToAccount)} with an account`],
    ['Used a benefit', num(data.beneficiaries.active), data.beneficiaries.utilisationRatePct == null ? '' : `${data.beneficiaries.utilisationRatePct}% of enrolled`],
    ['Sponsored visits', num(data.usage.uses + data.usage.passCheckins), `${num(data.usage.uses)} pay-per-use · ${num(data.usage.passCheckins)} on passes${data.usage.usesChangePct == null ? '' : ` · ${data.usage.usesChangePct > 0 ? '+' : ''}${data.usage.usesChangePct}% on the period before`}`],
    ['Sponsor share of usage', money(data.usage.sponsorTzs), `Service value ${money(data.usage.grossTzs)} · members ${money(data.usage.beneficiaryTzs)}`],
    ['Invoiced / collected', `${money(data.billing.invoicedTzs)} / ${money(data.billing.collectedTzs)}`, 'In the period, from invoices and payments'],
  ] : [];

  return (
    <div className="space-y-5" data-testid="b2b-analytics">
      <PageHeader title="B2B insights" description="Across every organisation: who is covered, what is used, and where the records need a second look."
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <select className="ui-input !w-auto" aria-label="Period" value={period} onChange={e => setPeriod(e.target.value)} data-testid="analytics-period">
          {PERIODS.filter(([k]) => k !== 'custom').map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select className="ui-input !w-auto" value="" onChange={(e) => { const o = orgs.find(x => x.id === e.target.value); if (o) setOrg(o); }} data-testid="analytics-open-org">
          <option value="">Open an organisation…</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {data && <span className="text-xs text-[var(--color-fg-quaternary)]">{day(data.period.from)} to {day(data.period.to)} · East Africa Time · live figures</span>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!data ? !error && <Spinner className="h-6 w-6" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="analytics-kpis">
            {cards.map(([label, value, sub]) => (
              <Card key={label}><CardContent className="py-4">
                <div className="text-xs text-[var(--color-fg-quaternary)]">{label}</div>
                <div className="mt-1 text-xl font-semibold">{value}</div>
                <div className="mt-0.5 text-xs text-[var(--color-fg-tertiary)]">{sub}</div>
              </CardContent></Card>
            ))}
          </div>
          <Card>
            <CardHeader><span className="text-sm font-semibold">Verified pay-per-use usage, by {data.period.bucket}</span></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.trend} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid stroke="var(--color-border-secondary)" vertical={false} />
                  <XAxis dataKey="bucket" tickFormatter={shortDay} tick={{ fontSize: 11, fill: 'var(--color-fg-quaternary)' }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-fg-quaternary)' }} tickLine={false} axisLine={false} />
                  <Tooltip labelFormatter={v => shortDay(String(v))} formatter={v => [v, 'Uses']} />
                  <Area type="monotone" dataKey="uses" stroke={BRAND} strokeWidth={2} fill={BRAND} fillOpacity={0.12} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><span className="text-sm font-semibold">Organisations by usage</span></CardHeader>
              <CardContent>
                {data.topOrganizations.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No sponsored usage in this period.</p> : (
                  <table className="w-full text-sm" data-testid="analytics-top-orgs">
                    <thead><tr className={HEAD}><th className="py-2 pr-3">Organisation</th><th className="py-2 pr-3 text-right">Visits</th><th className="py-2 pr-3 text-right">People</th><th className="py-2 text-right">Sponsor share</th></tr></thead>
                    <tbody>
                      {data.topOrganizations.map(o => (
                        <tr key={o.organizationId} className={ROW}>
                          <td className="py-2 pr-3"><button className="text-left font-medium text-[var(--color-fg-brand)]" onClick={() => setOrg({ id: o.organizationId, name: o.name ?? o.organizationId })}>{o.name ?? o.organizationId}</button></td>
                          <td className="py-2 pr-3 text-right">{num(o.uses + o.passCheckins)}</td><td className="py-2 pr-3 text-right">{num(o.activeBeneficiaries)}</td><td className="py-2 text-right">{money(o.sponsorTzs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><span className="text-sm font-semibold">Gyms and trainers by sponsored usage</span></CardHeader>
              <CardContent>
                {data.topProviders.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No sponsored usage in this period.</p> : (
                  <table className="w-full text-sm" data-testid="analytics-top-providers">
                    <thead><tr className={HEAD}><th className="py-2 pr-3">Provider</th><th className="py-2 pr-3 text-right">Uses</th><th className="py-2 pr-3 text-right">People</th><th className="py-2 pr-3 text-right">Organisations</th><th className="py-2 text-right">Service value</th></tr></thead>
                    <tbody>
                      {data.topProviders.map(p => (
                        <tr key={`${p.providerType}:${p.providerId}`} className={ROW}>
                          <td className="py-2 pr-3">{p.name ?? p.providerId} <span className="text-xs text-[var(--color-fg-quaternary)]">{p.providerType}</span></td>
                          <td className="py-2 pr-3 text-right">{num(p.uses)}</td><td className="py-2 pr-3 text-right">{num(p.people)}</td><td className="py-2 pr-3 text-right">{num(p.organizations)}</td><td className="py-2 text-right">{money(p.grossTzs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">Service value is the list price of what was used. What providers are owed and paid is on the settlement pages.</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <span className="text-sm font-semibold">Records that need a second look</span>
          {quality && <span className="ml-2 text-xs text-[var(--color-fg-quaternary)]">{quality.issues === 0 ? 'Nothing found' : `${quality.issues} kind${quality.issues === 1 ? '' : 's'} of problem`} · checked {new Date(quality.checkedAt).toLocaleString('en-GB')}</span>}
        </CardHeader>
        <CardContent>
          {!quality ? <p className="text-sm text-[var(--color-fg-quaternary)]">Your permissions don’t include the data checks, or they could not be run.</p> : (
            <table className="w-full text-sm" data-testid="data-quality">
              <thead><tr className={HEAD}><th className="py-2 pr-3">Check</th><th className="py-2 pr-3">Severity</th><th className="py-2 pr-3 text-right">Found</th><th className="py-2">Examples</th></tr></thead>
              <tbody>
                {[...quality.checks].sort((a, b) => b.count - a.count).map(c => (
                  <tr key={c.key} className={ROW}>
                    <td className="py-2 pr-3">{c.title}</td>
                    <td className="py-2 pr-3">{c.count > 0 ? <Badge tone={TONE[c.severity]}>{c.severity}</Badge> : <Badge tone="success">ok</Badge>}</td>
                    <td className="py-2 pr-3 text-right">{num(c.count)}</td>
                    <td className="py-2 font-mono text-xs text-[var(--color-fg-tertiary)]">{c.examples.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">These are reported, not repaired. Nothing here changes a record.</p>
        </CardContent>
      </Card>
    </div>
  );
}
