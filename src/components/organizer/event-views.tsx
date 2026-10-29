'use client';
import { useState } from 'react';
import type { EventDocument, OrganizerRole } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { FINANCE_ROLES, eventStatusOf, isPublishedLike } from '@/lib/events';
import { BIB_VIEW_ROLES, EXPORT_ROLES, KIT_ROLES, hasRole, opsOf } from '@/lib/events-ops';
import { Badge, Button, PageHeader, Segmented } from '@/components/shared';
import { EventRegistrationsTable } from '@/components/event-registrations-table';
import { EventOrdersTable } from '@/components/event-orders-table';
import { EventFinanceView } from '@/components/event-finance';
import { useDocumentTitle } from '@/components/organizer/page-states';
import { useEventsOptions } from '@/components/events-options';
import { useOrganizer } from '@/components/organizer-context';
import { KitDesk } from '@/components/organizer/kit-desk';
import { BibsView } from '@/components/organizer/bibs-view';
import { ExportView } from '@/components/organizer/export-view';
import { RegistrationDrawer } from '@/components/organizer/registration-drawer';
import { useApp } from '../../../app/providers';

/** S3 §6.1 role gating of the two event tabs. */
export const REGISTRATION_ROLES = new Set<OrganizerRole>(['owner', 'admin', 'ops', 'timing']);
export const ORDER_ROLES = new Set<OrganizerRole>(['owner', 'admin', 'finance']);
export type EventView = 'registrations' | 'orders' | 'finance' | 'kit' | 'bibs' | 'export';
/** S4 §6.1: the Finance tab is for finance, owner and admin only. */
export const canSeeView = (view: EventView, role: OrganizerRole | null | undefined) => !!role && (
  view === 'registrations' ? REGISTRATION_ROLES : view === 'finance' ? FINANCE_ROLES
  // Events S5 §2, §8.1: the venue tabs. Kit: owner/admin/ops; bibs: also timing (read); export: owner/admin.
  : view === 'kit' ? KIT_ROLES : view === 'bibs' ? BIB_VIEW_ROLES : view === 'export' ? EXPORT_ROLES : ORDER_ROLES).has(role);
/** Registrations exist once the event has been published (completed/cancelled keep their history). */
export const hasRegistrationData = (doc: Pick<EventDocument, 'status' | 'publishedAt'>) => isPublishedLike(doc.status) || doc.status === 'completed' || doc.status === 'cancelled' || doc.status === 'archived' || !!doc.publishedAt;

/** The tab strip shared by the wizard header and the two views (§6.1 "next to changes"). */
export function EventViewTabs({ view, role, onView, published = true }: { view: EventView | 'details'; role: OrganizerRole | null; onView: (v: EventView | null) => void; /** The venue tabs wait for a published event (§8.1). */ published?: boolean }) {
  const { t } = useApp();
  const eventsOptions = useEventsOptions();
  const registrationOn = !!eventsOptions?.registration;
  const kitOn = opsOf(eventsOptions).kit && published;
  const options: Array<[string, string]> = [['details', t('events.wizard.step.review')]];
  if (registrationOn && canSeeView('registrations', role)) options.push(['registrations', t('organizer.events.view.registrations')]);
  if (registrationOn && canSeeView('orders', role)) options.push(['orders', t('organizer.events.view.orders')]);
  if (registrationOn && canSeeView('finance', role)) options.push(['finance', t('events.finance.title')]);
  if (kitOn && hasRole(KIT_ROLES, role)) options.push(['kit', t('organizer.events.view.kit')]);
  if (kitOn && hasRole(BIB_VIEW_ROLES, role)) options.push(['bibs', t('organizer.events.view.bibs')]);
  if (kitOn && hasRole(EXPORT_ROLES, role)) options.push(['export', t('organizer.events.view.export')]);
  if (options.length === 1) return null;
  return <div data-testid="event-view-tabs" className="max-w-full overflow-x-auto"><Segmented className="w-fit" value={view} options={options} onChange={v => onView(v === 'details' ? null : (v as EventView))} /></div>;
}

const VIEW_TITLE: Record<EventView, MessageKey> = {
  registrations: 'organizer.events.view.registrations', orders: 'organizer.events.view.orders', finance: 'events.finance.title',
  kit: 'organizer.events.view.kit', bibs: 'organizer.events.view.bibs', export: 'organizer.events.view.export',
};

/** `/organizer/events?event=<id>&view=registrations|orders|finance|kit|bibs|export[&registration=<id>]` (S3 §6.3, S5 §8.1). */
export function OrganizerEventView({ doc, view, role, onView, onBack }: { doc: EventDocument; view: EventView; role: OrganizerRole | null; onView: (v: EventView | null) => void; onBack: () => void }) {
  const { t } = useApp();
  const org = useOrganizer();
  const st = eventStatusOf(doc.status);
  useDocumentTitle(`${doc.title} · ${t(VIEW_TITLE[view])}`);
  const published = hasRegistrationData(doc);
  const readOnly = org.organizer?.status === 'suspended';
  // S5 §8.5: `&registration=<id>` opens the drawer over the current view; closing keeps the view.
  const [regId, setRegId] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('registration')));
  const openReg = (id: string | null) => {
    setRegId(id);
    const q = new URLSearchParams(window.location.search);
    if (id) q.set('registration', id); else q.delete('registration');
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
  };
  return (
    <div className="space-y-4" data-testid={`organizer-view-${view}`}>
      <PageHeader title={doc.title} description={<Badge tone={st.tone}>{t(st.key)}</Badge>} actions={<Button variant="ghost" size="sm" onClick={onBack}>{t('events.wizard.back')}</Button>} />
      <EventViewTabs view={view} role={role} onView={onView} published={published} />
      {view === 'finance'
        ? <EventFinanceView eventId={doc.id} timezone={doc.timezone} timezoneAbbr={doc.timezoneAbbr} published={published} />
        : view === 'kit'
        ? <KitDesk doc={doc} role={role} readOnly={readOnly} onOpenRegistration={openReg} />
        : view === 'bibs'
        ? <BibsView doc={doc} role={role} readOnly={readOnly} onOpenRegistration={openReg} />
        : view === 'export'
        ? <ExportView doc={doc} readOnly={readOnly} />
        : view === 'registrations'
        ? <EventRegistrationsTable eventId={doc.id} timezone={doc.timezone} timezoneAbbr={doc.timezoneAbbr} fieldPolicy="organizer" published={published} onOpen={hasRole(KIT_ROLES, role) ? openReg : undefined} />
        : <EventOrdersTable eventId={doc.id} timezone={doc.timezone} timezoneAbbr={doc.timezoneAbbr} fieldPolicy="organizer" published={published} />}
      {regId && hasRole(BIB_VIEW_ROLES, role) && <RegistrationDrawer doc={doc} registrationId={regId} role={role} readOnly={readOnly} onClose={() => openReg(null)} />}
    </div>
  );
}
