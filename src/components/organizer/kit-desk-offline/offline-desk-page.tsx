'use client';
// Events S7 (spec docs/design/events-s7-hardening-and-pilot.md §3.14): `/organizer/kit-desk?event=<id>`, the kit desk that keeps working with no internet.
// It is a separate route so the S5 desk stays untouched. While the connection is good it simply embeds that S5 desk (the online path is always preferred);
// when the connection goes it scans from the saved ticket list and saves provisional scans, which are sent later. Nothing is final until the server says so.
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CloudOff, RefreshCw, Send, Wifi } from 'lucide-react';
import { api, type EventDocument } from '@/lib/api';
import { EVENTS_MODULE } from '@/lib/flags';
import { eventDateTime, eventStatusOf, fmt } from '@/lib/events';
import { KIT_ROLES, hasRole } from '@/lib/events-ops';
import { clockOf } from '@/lib/events-s7';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Segmented, SkeletonCard } from '@/components/shared';
import { ConfirmDialog } from '@/components/dialog';
import { ReasonTypedDialog } from '@/components/events-s7-dialogs';
import { useEventsOptions } from '@/components/events-options';
import { useOrganizer } from '@/components/organizer-context';
import { EventsUnavailable, OrganizerForbidden, OrganizerGate, PageError, PageLoading, useDocumentTitle } from '@/components/organizer/page-states';
import { KitDesk } from '@/components/organizer/kit-desk';
import { useKitDesk } from './use-kit-desk';
import { PrepareCard } from './prepare-card';
import { ScanPanel } from './scan-panel';
import { ReviewPanel } from './review-panel';
import { DevicesPanel } from './devices-panel';
import { storageSupported } from './desk-store';
import { useApp } from '../../../../app/providers';

type Tab = 'scan' | 'review' | 'desks';

function Inner() {
  const { t, token, user, locale } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const eventId = params.get('event') ?? '';
  const org = useOrganizer();
  const options = useEventsOptions();
  const [doc, setDoc] = useState<EventDocument | null>(null);
  const [tab, setTab] = useState<Tab>('scan');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const desk = useKitDesk({ eventId, token, userId: user?.id ?? null, enabled: !!eventId && EVENTS_MODULE });
  const meta = desk.meta;
  useDocumentTitle(`${doc?.title ?? meta?.eventTitle ?? t('organizer.kitOffline.title')} · ${t('organizer.kitOffline.title')}`);

  // The event document is read online only; offline the saved header (status, timezone, points) is enough.
  useEffect(() => {
    if (!token || !eventId || !desk.online) return;
    let live = true;
    api.organizerEvent(token, eventId).then(d => { if (live) setDoc(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [token, eventId, desk.online]);

  const role = org.role ?? ((meta?.role as typeof org.role) ?? null);
  const suspended = (org.organizer?.status ?? (meta?.organizerSuspended ? 'suspended' : null)) === 'suspended';
  const timezone = doc?.timezone ?? meta?.event?.timezone ?? 'Africa/Dar_es_Salaam';
  const canSetBlock = role === 'owner' || role === 'admin';
  const canCheck = role === 'owner' || role === 'admin';

  if (!EVENTS_MODULE) return <EventsUnavailable />;
  if (!eventId) return <PageError />;
  if (desk.phase === 'loading') return <PageLoading />;
  if (org.status === 'off') return <EventsUnavailable />;
  if (org.status === 'no_organizer') return <OrganizerGate />;
  // Offline, the organizer call fails; a desk saved on this device carries the role it was prepared with (the server re-checks every call anyway).
  if ((org.status === 'loading' || org.status === 'none') && !meta) return <PageLoading />;
  if (org.status === 'error' && !meta) return <PageError onRetry={() => void org.reload()} />;
  if (!hasRole(KIT_ROLES, role)) return <OrganizerForbidden backHref="/organizer/events" />;
  if (options === undefined && !meta) return <PageLoading />;
  if (options && !options.ops?.kitOffline) return <div data-testid="offline-unavailable"><EventsUnavailable /></div>;
  if (options === null && !meta) return <PageError />;

  const statusBadge = meta?.event?.status ?? doc?.status;
  const sb = statusBadge ? eventStatusOf(statusBadge) : null;
  const modeLabel = desk.sending ? t('organizer.kitOffline.mode.sending') : desk.mode === 'online' ? t('organizer.kitOffline.mode.online') : desk.mode === 'weak' ? t('organizer.kitOffline.mode.weak') : t('organizer.kitOffline.mode.offline');
  const back = () => router.push(`/organizer/events?event=${encodeURIComponent(eventId)}&view=kit`);
  const clockWrong = !desk.clock.ok;

  return (
    <div className="space-y-4" data-testid="offline-desk" data-mode={desk.mode}>
      <PageHeader title={doc?.title ?? meta?.eventTitle ?? t('organizer.kitOffline.title')}
        description={<span className="flex flex-wrap items-center gap-2">{sb && <Badge tone={sb.tone}>{t(sb.key)}</Badge>}
          <span role="status" aria-live="polite" data-testid="offline-mode-chip"><Badge tone={desk.mode === 'online' && !desk.sending ? 'success' : 'warning'} dot>{desk.mode === 'online' ? <Wifi aria-hidden="true" className="mr-1 inline h-3 w-3" /> : <CloudOff aria-hidden="true" className="mr-1 inline h-3 w-3" />}{modeLabel}</Badge></span>
          {desk.shellReady && <Badge tone="success" dot><span data-testid="offline-works">{t('organizer.kitOffline.prepare.ready')}</span></Badge>}</span>}
        actions={<Button variant="ghost" size="sm" onClick={back}>{t('events.wizard.back')}</Button>} />

      {/* Banners (§3.14 states) */}
      {desk.phase === 'unsupported' && <div data-testid="offline-storage-blocked"><Alert tone="warning">{t('organizer.kitOffline.prepare.blocked')} <Button size="sm" variant="secondary" onClick={back}>{t('organizer.kitOffline.entry.online')}</Button></Alert></div>}
      {desk.mode !== 'online' && (
        <div role="status" className="sticky top-0 z-10" data-testid="offline-banner">
          <Alert tone="warning"><span className="flex items-start gap-2"><CloudOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{desk.mode === 'weak' ? t('organizer.kitOffline.mode.weak') : t('organizer.kitOffline.banner.offline')}</span></Alert>
        </div>
      )}
      {meta && clockWrong && (
        <div role="alert" data-testid="offline-clock"><Alert tone="error"><p className="font-semibold">{t('organizer.kitOffline.clock.title')}</p><p>{t('organizer.kitOffline.clock.body')}</p>
          {'expected' in desk.clock && <p className="mt-1 font-mono text-xs">{clockOf(Date.now(), locale)} / {clockOf(desk.clock.expected, locale)}</p>}</Alert></div>
      )}
      {meta && meta.status === 'revoked' && <div role="alert" data-testid="offline-removed"><Alert tone="error">{t('organizer.kitOffline.removed.banner')}</Alert></div>}
      {meta && meta.status !== 'revoked' && desk.listExpired && <div data-testid="offline-expired"><Alert tone="warning">{t('organizer.kitOffline.list.expired')}</Alert></div>}
      {desk.updateNeeded && <div role="alert" data-testid="offline-update-needed"><Alert tone="warning"><span className="flex flex-wrap items-center gap-3">{t('organizer.kitOffline.update.banner')}<Button size="sm" variant="secondary" onClick={() => void desk.refreshShell()}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('organizer.kitOffline.update.button')}</Button></span></Alert></div>}
      {desk.swUpdate && !desk.updateNeeded && <div role="status" data-testid="offline-sw-update"><Alert tone="info"><span className="flex flex-wrap items-center gap-3">{t('events.s7.update.ready')}<Button size="sm" variant="secondary" disabled={!!desk.sending} onClick={desk.applyUpdate}>{t('organizer.kitOffline.update.button')}</Button></span></Alert></div>}
      {suspended && <Alert tone="warning">{t('events.kit.suspended')}</Alert>}

      {!meta ? (
        <PrepareCard doc={doc} desk={desk} canSetBlock={canSetBlock} staffName={user?.displayName ?? null} userId={user?.id ?? null} role={role} readOnly={suspended} />
      ) : (
        <>
          {/* Sync bar */}
          <Card><CardContent>
            <div className="flex flex-wrap items-center justify-between gap-3" data-testid="offline-syncbar">
              <div className="space-y-0.5 text-sm" role="status" aria-live="polite">
                <p className="font-medium text-[var(--color-fg-primary)]" data-testid="offline-pending">{fmt(t('organizer.kitOffline.pending.count'), { n: desk.stats.pending })}</p>
                {desk.stats.oldestPendingAt && <p className="text-[var(--color-fg-quaternary)]">{fmt(t('organizer.kitOffline.pending.oldest'), { time: clockOf(desk.stats.oldestPendingAt, locale) })}</p>}
                <p className="text-[var(--color-fg-quaternary)]" data-testid="offline-list-time">{meta.listWiped ? t('organizer.kitOffline.list.expired') : fmt(t('organizer.kitOffline.prepare.done'), { count: meta.rowCount, time: clockOf(meta.snapshotTakenAt, locale) })} · {meta.label}</p>
                {user?.displayName && meta.staffName && user.displayName !== meta.staffName && <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('organizer.kitOffline.signedAs'), { name: meta.staffName })}</p>}
                {desk.sending && <p data-testid="offline-sending">{fmt(t('organizer.kitOffline.send.progress'), { done: desk.sending.done, total: desk.sending.total })}</p>}
                {desk.lastSummary && !desk.sending && <p data-testid="offline-summary">{fmt(t('organizer.kitOffline.send.done'), { accepted: desk.lastSummary.accepted, review: desk.lastSummary.review })}</p>}
                {desk.sendFailed && <p className="text-[var(--color-error-700)]" data-testid="offline-send-failed">{t('organizer.kitOffline.send.failed')}</p>}
                {desk.stats.review > 0 && <button type="button" className="min-h-11 text-left text-[var(--color-warning-800)] underline" onClick={() => setTab('review')} data-testid="offline-review-chip"><AlertTriangle aria-hidden="true" className="mr-1 inline h-3 w-3" />{t('organizer.kitOffline.review.title')} ({desk.stats.review})</button>}
              </div>
              <Button size="lg" className="min-h-14" loading={!!desk.sending} disabled={!desk.online || desk.stats.pending === 0} onClick={() => void desk.sendNow()} data-testid="offline-send"><Send aria-hidden="true" className="h-4 w-4" />{t('organizer.kitOffline.send.now')}</Button>
            </div>
          </CardContent></Card>

          <Segmented className="w-fit max-w-full overflow-x-auto" value={tab} onChange={v => setTab(v as Tab)}
            options={[['scan', t('organizer.kitOffline.tab.scan')], ['review', `${t('organizer.kitOffline.review.title')}${desk.stats.review ? ` (${desk.stats.review})` : ''}`], ['desks', t('organizer.kitOffline.devices.title')]]} />

          {tab === 'scan' && (desk.mode === 'online' && doc && meta.status === 'active' && !desk.listExpired
            ? <div data-testid="offline-online-desk"><KitDesk embedded doc={doc} role={role} readOnly={suspended} onOpenRegistration={id => router.push(`/organizer/events?event=${encodeURIComponent(eventId)}&view=kit&registration=${encodeURIComponent(id)}`)} /></div>
            : <ScanPanel desk={desk} timezone={timezone} readOnly={suspended} />)}
          {tab === 'review' && <ReviewPanel eventId={eventId} timezone={timezone} canCheck={canCheck} local={desk.scans} active={tab === 'review'} onChanged={() => setReloadKey(k => k + 1)} />}
          {tab === 'desks' && <DevicesPanel eventId={eventId} timezone={timezone} mode="organizer" reloadKey={reloadKey} canRemove={canCheck} />}

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border-secondary)] pt-3 text-sm" data-testid="offline-footer">
            {desk.scans.some(s => s.state === 'confirmed' || s.state === 'needs_review' || s.state === 'rejected') && <Button variant="ghost" size="sm" onClick={() => void desk.clearSent()} data-testid="offline-clear-sent">{t('events.s7.clearSent')}</Button>}
            {!meta.listWiped && <Button variant="ghost" size="sm" onClick={() => setWipeOpen(true)} data-testid="offline-wipe">{t('organizer.kitOffline.wipe.link')}</Button>}
            {desk.stats.pending > 0 && <Button variant="ghost" size="sm" onClick={() => setDiscardOpen(true)} data-testid="offline-discard">{t('organizer.kitOffline.discard.title')}</Button>}
            <span className="text-[var(--color-fg-quaternary)]">{eventDateTime(meta.expiresAt, timezone, locale)}</span>
          </div>
        </>
      )}

      <ReasonTypedDialog open={discardOpen} onClose={() => setDiscardOpen(false)} title={t('organizer.kitOffline.discard.title')} testId="offline-discard-dialog" noReason confirmLabel={t('organizer.kitOffline.discard.title')}
        body={fmt(t('organizer.kitOffline.discard.body'), { n: desk.stats.pending })} typed={[String(desk.stats.pending)]} typedLabel={t('events.s7.discard.typed')}
        onConfirm={async () => { await desk.discardUnsent(); setDiscardOpen(false); }} />
      <ConfirmDialog open={wipeOpen} onClose={() => setWipeOpen(false)} onConfirm={() => { void desk.removeList(); setWipeOpen(false); }} title={t('organizer.kitOffline.wipe.link')} description={t('events.s7.wipe.body')} confirmLabel={t('organizer.kitOffline.wipe.link')} cancelLabel={t('common.cancel')} />
    </div>
  );
}

/** Whether this browser can keep the desk at all; the entry buttons use it to decide what to offer. */
export const deskStorageOk = () => storageSupported();

export function OfflineKitDeskPage() {
  return <Suspense fallback={<SkeletonCard />}><Inner /></Suspense>;
}
void useMemo;
