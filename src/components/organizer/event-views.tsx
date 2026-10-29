'use client';
import type { EventDocument, OrganizerRole } from '@/lib/api';
import { FINANCE_ROLES, eventStatusOf, isPublishedLike } from '@/lib/events';
import { Badge, Button, PageHeader, Segmented } from '@/components/shared';
import { EventRegistrationsTable } from '@/components/event-registrations-table';
import { EventOrdersTable } from '@/components/event-orders-table';
import { EventFinanceView } from '@/components/event-finance';
import { useDocumentTitle } from '@/components/organizer/page-states';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../../app/providers';

/** S3 §6.1 role gating of the two event tabs. */
export const REGISTRATION_ROLES = new Set<OrganizerRole>(['owner', 'admin', 'ops', 'timing']);
export const ORDER_ROLES = new Set<OrganizerRole>(['owner', 'admin', 'finance']);
export type EventView = 'registrations' | 'orders' | 'finance';
/** S4 §6.1: the Finance tab is for finance, owner and admin only. */
export const canSeeView = (view: EventView, role: OrganizerRole | null | undefined) => !!role && (view === 'registrations' ? REGISTRATION_ROLES : view === 'finance' ? FINANCE_ROLES : ORDER_ROLES).has(role);
/** Registrations exist once the event has been published (completed/cancelled keep their history). */
export const hasRegistrationData = (doc: Pick<EventDocument, 'status' | 'publishedAt'>) => isPublishedLike(doc.status) || doc.status === 'completed' || doc.status === 'cancelled' || doc.status === 'archived' || !!doc.publishedAt;

/** The tab strip shared by the wizard header and the two views (§6.1 "next to changes"). */
export function EventViewTabs({ view, role, onView }: { view: EventView | 'details'; role: OrganizerRole | null; onView: (v: EventView | null) => void }) {
  const { t } = useApp();
  const registrationOn = !!useEventsOptions()?.registration;
  const options: Array<[string, string]> = [['details', t('events.wizard.step.review')]];
  if (registrationOn && canSeeView('registrations', role)) options.push(['registrations', t('organizer.events.view.registrations')]);
  if (registrationOn && canSeeView('orders', role)) options.push(['orders', t('organizer.events.view.orders')]);
  if (registrationOn && canSeeView('finance', role)) options.push(['finance', t('events.finance.title')]);
  if (options.length === 1) return null;
  return <div data-testid="event-view-tabs"><Segmented className="w-fit" value={view} options={options} onChange={v => onView(v === 'details' ? null : (v as EventView))} /></div>;
}

/** `/organizer/events?event=<id>&view=registrations|orders` (§6.3). */
export function OrganizerEventView({ doc, view, role, onView, onBack }: { doc: EventDocument; view: EventView; role: OrganizerRole | null; onView: (v: EventView | null) => void; onBack: () => void }) {
  const { t } = useApp();
  const st = eventStatusOf(doc.status);
  useDocumentTitle(`${doc.title} · ${t(view === 'orders' ? 'organizer.events.view.orders' : view === 'finance' ? 'events.finance.title' : 'organizer.events.view.registrations')}`);
  const published = hasRegistrationData(doc);
  return (
    <div className="space-y-4" data-testid={`organizer-view-${view}`}>
      <PageHeader title={doc.title} description={<Badge tone={st.tone}>{t(st.key)}</Badge>} actions={<Button variant="ghost" size="sm" onClick={onBack}>{t('events.wizard.back')}</Button>} />
      <EventViewTabs view={view} role={role} onView={onView} />
      {view === 'finance'
        ? <EventFinanceView eventId={doc.id} timezone={doc.timezone} timezoneAbbr={doc.timezoneAbbr} published={published} />
        : view === 'registrations'
        ? <EventRegistrationsTable eventId={doc.id} timezone={doc.timezone} timezoneAbbr={doc.timezoneAbbr} fieldPolicy="organizer" published={published} />
        : <EventOrdersTable eventId={doc.id} timezone={doc.timezone} timezoneAbbr={doc.timezoneAbbr} fieldPolicy="organizer" published={published} />}
    </div>
  );
}
