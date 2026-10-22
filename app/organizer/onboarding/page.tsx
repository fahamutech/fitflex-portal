'use client';
import { EVENTS_MODULE } from '@/lib/flags';
import { Card, CardContent, CardHeader, PageHeader } from '@/components/shared';
import { useOrganizer } from '@/components/organizer-context';
import { EventsUnavailable, OrganizerStatusBadge, PageError, PageLoading, useDocumentTitle } from '@/components/organizer/page-states';
import { OrganizerChecklist, OrganizerIntro } from '@/components/organizer-kyc';
import { useApp } from '../../providers';

/**
 * Organizer onboarding (spec §4): state A (request access) for a person with no organizer, state B (checklist over
 * /me/kyc/*) while draft or info requested, state C (status card) otherwise. Two columns 2:1 on desktop.
 */
export default function OrganizerOnboardingPage() {
  const { t } = useApp();
  const org = useOrganizer();
  useDocumentTitle(t('organizer.onboarding.title'));

  if (!EVENTS_MODULE || org.status === 'off') return <EventsUnavailable />;
  if (org.status === 'loading' || org.status === 'none') return <PageLoading />;
  if (org.status === 'error') return <PageError onRetry={() => void org.reload()} />;

  return (
    <div className="space-y-6" data-testid="organizer-onboarding">
      <PageHeader title={t('organizer.onboarding.title')} actions={org.organizer ? <OrganizerStatusBadge status={org.organizer.status} /> : undefined} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {org.status === 'no_organizer' ? <OrganizerIntro onCreated={() => void org.reload()} /> : <OrganizerChecklist />}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('organizer.next.title')}</h2></CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--color-fg-secondary)]">
                <li>{t('organizer.next.step1')}</li>
                <li>{t('organizer.next.step2')}</li>
                <li>{t('organizer.next.step3')}</li>
              </ol>
            </CardContent>
          </Card>
          <Card id="organizer-help">
            <CardHeader><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('organizer.help.title')}</h2></CardHeader>
            <CardContent><p className="text-sm text-[var(--color-fg-secondary)]">{t('organizer.help.body')}</p></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
