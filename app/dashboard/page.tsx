'use client';
import { useEffect, useState } from 'react';
import {
  Users,
  CalendarCheck,
  TrendingUp,
  Banknote,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../providers';
import { api, DashboardResponse } from '@/lib/api';
import {
  MetricCard,
  Card,
  CardHeader,
  CardContent,
  Badge,
  PageHeader,
  Alert,
  Spinner,
  Button,
} from '@/components/shared';

export default function DashboardPage() {
  const { token, t } = useApp();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [gymId, setGymId] = useState('');
  const [memberType, setMemberType] = useState<'all' | 'direct' | 'fitflex'>('all');
  const [periodStart, setPeriodStart] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const load = () => {
    if (!token) return;
    setLoading(true);
    api.dashboard(token, { gymId, periodStart, periodEnd, memberType })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token, gymId, periodStart, periodEnd, memberType]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) return null;

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data)  return null;

  const payoutLabel = data.payout.flatFee
    ? 'Flat monthly fee'
    : `${data.payout.commissionPct ?? 0}% commission · ${
        data.payout.payoutDelayDays === 0 ? 'instant' : `T+${data.payout.payoutDelayDays}d`
      }`;
  const activeMemberType = data.memberType ?? memberType;
  const activeMemberTypeLabel =
    activeMemberType === 'direct'
      ? t('dash.memberType.direct')
      : activeMemberType === 'fitflex'
        ? t('dash.memberType.fitflex')
        : t('dash.memberType.all');

  return (
    <div className="space-y-6">

      {/* Page header */}
      <PageHeader
        title={data.gym.name}
        description={`${data.gym.tier} gym`}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('admin.action.refresh')}
          </Button>
        }
      />

      {/* Gym identity strip */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge tone="brand" dot>{data.gym.tier} tier</Badge>
          <span className="text-sm text-[var(--color-fg-quaternary)]">·</span>
          <span className="text-sm text-[var(--color-fg-tertiary)]">
            TZS {data.gym.perVisitRate.toLocaleString()} / visit
          </span>
          <span className="text-sm text-[var(--color-fg-quaternary)]">·</span>
          <Badge tone="gray">Band {data.payout.band}</Badge>
          <span className="text-sm text-[var(--color-fg-quaternary)] hidden sm:inline">{payoutLabel}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('dash.periodSettings')}</h2>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-fg-secondary)]">{t('dash.gym')}</span>
            <select className="ui-input" value={gymId} onChange={e => setGymId(e.target.value)}>
              <option value="">{t('dash.allGyms')}</option>
              {(data.gyms || [data.gym]).map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-fg-secondary)]">{t('dash.periodStart')}</span>
            <input className="ui-input" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-fg-secondary)]">{t('dash.periodEnd')}</span>
            <input className="ui-input" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--color-fg-secondary)]">{t('dash.memberType')}</span>
            <select className="ui-input" value={memberType} onChange={e => setMemberType(e.target.value as 'all' | 'direct' | 'fitflex')}>
              <option value="all">{t('dash.memberType.all')}</option>
              <option value="direct">{t('dash.memberType.direct')}</option>
              <option value="fitflex">{t('dash.memberType.fitflex')}</option>
            </select>
          </label>
        </CardContent>
      </Card>

      {/* Metric grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label={t('dash.today')}
          value={data.todayCount}
          icon={<CalendarCheck className="h-5 w-5" />}
          sub={t('dash.today.sub')}
        />
        <MetricCard
          label={t('dash.month')}
          value={data.monthVisits}
          icon={<Users className="h-5 w-5" />}
          sub={t('dash.month.sub')}
        />
        <MetricCard
          label={t('dash.band')}
          value={`Band ${data.payout.band}`}
          icon={<TrendingUp className="h-5 w-5" />}
          sub={`${t('dash.band.sub')} · ${payoutLabel}`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={t('dash.periodVisits')}
          value={data.periodVisits ?? 0}
          icon={<CalendarCheck className="h-5 w-5" />}
          sub={`${data.periodStart ?? periodStart} - ${data.periodEnd ?? periodEnd}`}
        />
        <MetricCard
          label={t('dash.periodMembers')}
          value={data.periodMembers ?? 0}
          icon={<Users className="h-5 w-5" />}
          sub={activeMemberTypeLabel}
        />
        <MetricCard
          label={t('dash.directMembers')}
          value={data.directMembers ?? 0}
          icon={<Users className="h-5 w-5" />}
          sub={`${data.directVisits ?? 0} ${t('dash.visits')}`}
        />
        <MetricCard
          label={t('dash.fitflexMembers')}
          value={data.fitflexMembers ?? 0}
          icon={<TrendingUp className="h-5 w-5" />}
          sub={`${data.fitflexVisits ?? 0} ${t('dash.visits')}`}
        />
      </div>

      {data.overall && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('dash.overallPerformance')}</h2>
          </CardHeader>
          <CardContent className="grid gap-y-3 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-[var(--color-fg-quaternary)]">{t('dash.gyms')}</dt>
              <dd className="mt-0.5 font-medium text-[var(--color-fg-primary)]">{data.overall.gymCount}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-quaternary)]">{t('dash.totalVisits')}</dt>
              <dd className="mt-0.5 font-medium text-[var(--color-fg-primary)]">{data.overall.totalVisits}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-quaternary)]">{t('dash.uniqueMembers')}</dt>
              <dd className="mt-0.5 font-medium text-[var(--color-fg-primary)]">{data.overall.uniqueMembers}</dd>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estimated payout card */}
      {!data.payout.flatFee && data.payout.net != null && (
        <MetricCard
          label={t('dash.netPayout')}
          value={`TZS ${data.payout.net.toLocaleString()}`}
          icon={<Banknote className="h-5 w-5" />}
          sub="Estimated net — subject to reconciliation"
        />
      )}

      {/* Payout details */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">Payout details</h2>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-y-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-[var(--color-fg-quaternary)]">Band</dt>
              <dd className="mt-0.5 font-medium text-[var(--color-fg-primary)]">{data.payout.band}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-quaternary)]">Commission</dt>
              <dd className="mt-0.5 font-medium text-[var(--color-fg-primary)]">
                {data.payout.flatFee ? '—' : `${data.payout.commissionPct ?? 0}%`}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-quaternary)]">Payout timing</dt>
              <dd className="mt-0.5 font-medium text-[var(--color-fg-primary)]">
                {data.payout.payoutDelayDays === 0 ? 'Instant' : `T+${data.payout.payoutDelayDays} days`}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-quaternary)]">Fee structure</dt>
              <dd className="mt-0.5 font-medium text-[var(--color-fg-primary)]">
                {data.payout.flatFee ? 'Flat monthly' : 'Per-visit commission'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

    </div>
  );
}
