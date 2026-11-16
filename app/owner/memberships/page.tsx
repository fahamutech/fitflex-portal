'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Gym } from '@/lib/api';
import { GYM_CUSTOM_PASSES } from '@/lib/flags';
import { classifyGymPassError, gymPassesApi, type GymPassFailure, type PassSummary } from '@/lib/gym-passes';
import { money } from '@/lib/admin-utils';
import { fill } from '@/components/communication-shared';
import { Alert, EmptyState, MetricCard, PageHeader, Segmented, Spinner } from '@/components/shared';
import { FailureView } from '@/components/gym-pass-shared';
import { GymPassPlans } from '@/components/gym-pass-plans';
import { GymPassSales } from '@/components/gym-pass-sales';
import { GymPassMemberships } from '@/components/gym-pass-memberships';
import { useApp } from '../../providers';

type Tab = 'plans' | 'sales' | 'memberships';

/**
 * Owner / gym staff: Membership & Pass Management (custom gym passes, flag NEXT_PUBLIC_GYM_CUSTOM_PASSES).
 * Plans need the `gyms` permission, sales and totals `payments`, people `members`; the server decides.
 */
export default function OwnerMembershipsPage() {
  const { token, user, hasPermission, t } = useApp();
  const can = (scope: string) => user?.userType !== 'gym_staff' || hasPermission(scope);
  const tabs = ([['plans', 'gyms'], ['sales', 'payments'], ['memberships', 'members']] as Array<[Tab, string]>).filter(([, scope]) => can(scope)).map(([id]) => id);

  const [gyms, setGyms] = useState<Gym[] | null>(null);
  const [gymId, setGymId] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  const [summary, setSummary] = useState<PassSummary | null>(null);
  const [pageFailure, setPageFailure] = useState<GymPassFailure | null>(null);
  const [gymsFailed, setGymsFailed] = useState(false);

  useEffect(() => {
    if (!GYM_CUSTOM_PASSES || !token) return;
    api.ownerGyms(token).then(list => { setGyms(list); setGymId(list[0]?.id ?? ''); }).catch(() => { setGyms([]); setGymsFailed(true); });
  }, [token]);

  const activeTab = tab && tabs.includes(tab) ? tab : tabs[0] ?? null;

  const loadSummary = useCallback(async () => {
    if (!GYM_CUSTOM_PASSES || !token || !gymId || !can('payments')) return;
    try { setSummary(await gymPassesApi.summary(token, gymId)); setPageFailure(null); }
    catch (e) { setSummary(null); const f = classifyGymPassError(e); if (f.kind === 'disabled' || f.kind === 'rate_limited') setPageFailure(f); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, gymId, user]);
  useEffect(() => { setSummary(null); void loadSummary(); }, [loadSummary]);

  if (!GYM_CUSTOM_PASSES || pageFailure?.kind === 'disabled') {
    return (
      <div className="space-y-6" data-testid="gp-off">
        <PageHeader title={t('gp.title')} />
        <EmptyState title={t('gp.off.title')} body={t('gp.off.body')} />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="gp-page">
      <PageHeader
        title={t('gp.title')}
        description={t('gp.subtitle')}
        actions={gyms && gyms.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            {t('gp.gym')}
            <select className="ui-input" value={gymId} onChange={e => setGymId(e.target.value)} data-testid="gp-gym-select">
              {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        ) : undefined}
      />
      {gymsFailed && <Alert tone="error">{t('gp.failed')}</Alert>}
      {pageFailure && <FailureView failure={pageFailure} onRetry={loadSummary} />}
      {gyms == null ? <Spinner className="h-6 w-6" /> : gyms.length === 0 ? (
        !gymsFailed && <EmptyState title={t('gp.noGyms')} />
      ) : !gymId || !activeTab ? (
        <Alert tone="warning">{t('gp.forbidden')}</Alert>
      ) : (
        <>
          {summary && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="gp-summary">
              <MetricCard label={t('gp.summary.plans')} value={summary.plans.active} sub={fill(t('gp.summary.plansOf'), { active: summary.plans.active, total: summary.plans.total })} />
              <MetricCard label={t('gp.summary.sales')} value={summary.sales.count} sub={fill(t('gp.summary.salesPending'), { n: summary.sales.pendingPayment })} />
              <MetricCard label={t('gp.summary.revenue')} value={money(summary.sales.revenueTzs)} sub={t('gp.summary.revenueHint')} />
              <MetricCard label={t('gp.summary.people')} value={summary.beneficiaries.active + summary.beneficiaries.pendingRegistration + summary.beneficiaries.suspended}
                sub={fill(t('gp.summary.peopleSplit'), { active: summary.beneficiaries.active, pending: summary.beneficiaries.pendingRegistration, suspended: summary.beneficiaries.suspended })} />
            </div>
          )}
          <div role="group" aria-label={t('gp.tabs')}>
            <Segmented value={activeTab} onChange={v => setTab(v as Tab)} options={tabs.map(id => [id, t(`gp.tab.${id}`)] as [string, string])} />
          </div>
          {activeTab === 'plans' && <GymPassPlans key={gymId} gymId={gymId} onChanged={loadSummary} />}
          {activeTab === 'sales' && <GymPassSales key={gymId} gymId={gymId} />}
          {activeTab === 'memberships' && <GymPassMemberships key={gymId} gymId={gymId} onChanged={loadSummary} />}
        </>
      )}
    </div>
  );
}
