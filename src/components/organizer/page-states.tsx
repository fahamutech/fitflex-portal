'use client';
import Link from 'next/link';
import { ReactNode, useEffect } from 'react';
import { Flag, Lock, ShieldCheck } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import { EVENTS_MODULE } from '@/lib/flags';
import { ORGANIZER_STATUS, eventsAreaOpen, staffAreaOpen } from '@/lib/events';
import { Badge, Button, EmptyState, ErrorState, SkeletonCard, SkeletonTable } from '@/components/shared';
import { useOrganizer } from '@/components/organizer-context';
import { useApp } from '../../../app/providers';

/** document.title = "{page} · FitFlex" (spec §3). */
export function useDocumentTitle(title: string) {
  useEffect(() => { if (title) document.title = `${title} · FitFlex`; }, [title]);
}

/** Flag off, or the server's EVENTS_MODULE off (§3, §4.4). */
export function EventsUnavailable() {
  const { t } = useApp();
  return (
    <div data-testid="events-unavailable">
      <EmptyState icon={<Flag />} title={t('events.unavailable.title')} body={t('events.unavailable.body')} />
    </div>
  );
}

/** 403 `not_your_organizer` / `forbidden` / `forbidden_role` (§3). */
export function OrganizerForbidden({ backHref = '/organizer' }: { backHref?: string }) {
  const { t } = useApp();
  return (
    <div data-testid="organizer-forbidden">
      <EmptyState
        icon={<Lock />}
        title={t('organizer.forbidden.title')}
        body={t('organizer.forbidden.body')}
        action={<Button variant="secondary" onClick={() => { window.location.assign(backHref); }}>{t('organizer.backToOverview')}</Button>}
      />
    </div>
  );
}

/** Organizer not verified yet: events and staff wait (§4.4). */
export function OrganizerGate() {
  const { t } = useApp();
  return (
    <div data-testid="organizer-gate">
      <EmptyState
        icon={<ShieldCheck />}
        title={t('organizer.gate.title')}
        body={t('organizer.gate.body')}
        action={<Link href="/organizer/onboarding" className="inline-flex"><Button variant="primary">{t('organizer.gate.action')}</Button></Link>}
      />
    </div>
  );
}

export function PageLoading({ table = false }: { table?: boolean }) {
  return (
    <div className="space-y-4" aria-busy="true" data-testid="organizer-page-loading">
      <SkeletonCard />
      {table ? <SkeletonTable /> : <SkeletonCard />}
    </div>
  );
}

export function PageError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useApp();
  return <ErrorState title={t('common.somethingWrong')} message={t('common.errorBody')} onRetry={onRetry} retryLabel={onRetry ? t('common.tryAgain') : undefined} />;
}

export function OrganizerStatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useApp();
  const s = ORGANIZER_STATUS[(status ?? 'draft') as keyof typeof ORGANIZER_STATUS] ?? ORGANIZER_STATUS.draft;
  return <span data-testid="organizer-status-badge"><Badge tone={s.tone}>{t(s.key as MessageKey)}</Badge></span>;
}

/**
 * The shared gate for an organizer page (§3, §4.4): flag, server flag, load state, then the page's own rule.
 * `area` decides who may see the page: events (verified or suspended) · staff (verified owner/admin) · any (overview).
 */
export function OrganizerPage({ area, children }: { area: 'overview' | 'events' | 'staff'; children: ReactNode }) {
  const org = useOrganizer();
  if (!EVENTS_MODULE || org.status === 'off') return <EventsUnavailable />;
  if (org.status === 'loading' || org.status === 'none') return <PageLoading />;
  if (org.status === 'error') return <PageError onRetry={() => void org.reload()} />;
  if (org.status === 'no_organizer') return <OrganizerGate />;
  const status = org.organizer?.status ?? null;
  if (area === 'events' && !eventsAreaOpen(status)) return <OrganizerGate />;
  // Staff: verified owner/admin only. Not verified → gate; verified but ops/finance/timing → forbidden (§9.2).
  if (area === 'staff' && !staffAreaOpen(status, org.role)) return status === 'active' ? <OrganizerForbidden /> : <OrganizerGate />;
  return <>{children}</>;
}
