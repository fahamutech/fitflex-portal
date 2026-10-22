'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { api, type OrganizerSummary } from '@/lib/api';
import { canManageEvents, errorKey, eventDateTime, eventStatusOf, fmt } from '@/lib/events';
import { Alert, Badge, Button, Card, CardContent, CardHeader, EmptyState, MetricCard, PageHeader } from '@/components/shared';
import { useOrganizer } from '@/components/organizer-context';
import { OrganizerPage, OrganizerStatusBadge, PageError, PageLoading, useDocumentTitle } from '@/components/organizer/page-states';
import { useApp } from '../providers';

/** Organizer overview (spec §5): four metric cards, the three soonest events, and a get-started checklist. */
function OverviewInner() {
  const { t, token, locale } = useApp();
  const org = useOrganizer();
  const [summary, setSummary] = useState<OrganizerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(t('organizer.overview.title'));

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { setSummary(await api.organizerSummary(token)); } catch (err) { setError(t(errorKey(err))); }
  }, [token, t]);
  useEffect(() => { void load(); }, [load]);

  const organizer = org.organizer!;
  const canCreate = canManageEvents(organizer.status, org.role);
  if (error) return <PageError onRetry={() => void load()} />;
  if (!summary) return <PageLoading />;

  const next = (summary.nextEvents ?? []).filter(e => e.status !== 'archived').slice(0, 3);
  const showGetStarted = (summary.publishedTotal ?? 0) < 1;

  return (
    <div className="space-y-6" data-testid="organizer-overview">
      <PageHeader title={t('organizer.overview.title')} description={organizer.name} actions={<OrganizerStatusBadge status={organizer.status} />} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="organizer-metrics">
        <MetricCard wrapLabel label={t('organizer.overview.events')} value={summary.eventsTotal ?? 0} sub={fmt(t('organizer.overview.published'), { n: summary.publishedTotal ?? 0 })} />
        <MetricCard wrapLabel label={t('organizer.overview.registrations')} value={summary.registrationsTotal ?? 0} sub={t('organizer.overview.comingSoon')} />
        <MetricCard wrapLabel label={t('organizer.overview.awaitingPayment')} value={summary.awaitingPaymentTotal ?? 0} sub={t('organizer.overview.comingSoon')} />
        <MetricCard wrapLabel label={t('organizer.overview.confirmed')} value={summary.confirmedTotal ?? 0} sub={t('organizer.overview.comingSoon')} />
      </div>

      <Card>
        <CardHeader><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('organizer.overview.nextUp')}</h2></CardHeader>
        <CardContent>
          {next.length === 0 ? (
            <EmptyState
              icon={<Flag />}
              title={t('organizer.overview.noEvents.title')}
              body={t('organizer.overview.noEvents.body')}
              action={canCreate ? <Link href="/organizer/events?event=new" className="inline-flex"><Button data-testid="overview-create-event">{t('events.list.new')}</Button></Link> : undefined}
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="overview-next-up">
              {next.map(e => {
                const st = eventStatusOf(e.status);
                return (
                  <li key={e.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--color-fg-primary)]">{e.title}</p>
                      <p className="text-xs text-[var(--color-fg-quaternary)]">{eventDateTime(e.startsAt, e.timezone, locale, e.timezoneAbbr)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={st.tone}>{t(st.key)}</Badge>
                      <Link href={`/organizer/events?event=${encodeURIComponent(e.id)}`} className="text-sm font-medium text-[var(--color-brand-700)] underline-offset-4 hover:underline">{t('events.list.open')}</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {showGetStarted && (
        <Card data-testid="overview-get-started">
          <CardHeader><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('organizer.overview.getStarted')}</h2></CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--color-fg-secondary)]">
              <li><Link href="/organizer/onboarding" className="text-[var(--color-brand-700)] underline-offset-4 hover:underline">{t('nav.organizer.onboarding')}</Link></li>
              <li>{canCreate ? <Link href="/organizer/events?event=new" className="text-[var(--color-brand-700)] underline-offset-4 hover:underline">{t('organizer.status.createFirst')}</Link> : t('organizer.status.createFirst')}</li>
              <li>{canCreate ? <Link href="/organizer/staff" className="text-[var(--color-brand-700)] underline-offset-4 hover:underline">{t('organizer.status.inviteStaff')}</Link> : t('organizer.status.inviteStaff')}</li>
            </ol>
            {organizer.status !== 'active' && <Alert tone="info" className="mt-4">{t('organizer.gate.body')}</Alert>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function OrganizerOverviewPage() {
  return <OrganizerPage area="overview"><OverviewInner /></OrganizerPage>;
}
