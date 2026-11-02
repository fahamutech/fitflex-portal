'use client';
// Events S7 (spec §4.9, §4.10, AC-W15): the organizer's waitlist card. Counts only: no names, no positions, no promote or reorder controls.
// Owner and admin may stop or resume new sign-ups and close the waitlist (typed word, tells everyone waiting, cannot be undone); ops and finance read.
import { useCallback, useEffect, useRef, useState } from 'react';
import { waitlistApi, type OrganizerWaitlist } from '@/lib/events-s7-api';
import { eventDateTime, fmt, isFeatureOff } from '@/lib/events';
import { newIdempotencyKey } from '@/lib/events-ops';
import { s7ErrorKey } from '@/lib/events-s7';
import { Alert, Button, Card, CardContent, CardHeader, SkeletonCard, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { ReasonTypedDialog } from '@/components/events-s7-dialogs';
import { SwitchControl } from '@/components/events-s7-switch';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../../app/providers';
import type { WaitlistCounts } from '@/lib/events-s7-api';

export function WaitlistCard({ eventId, timezone, canWrite, readOnly }: { eventId: string; timezone: string; canWrite: boolean; readOnly: boolean }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const options = useEventsOptions();
  const [data, setData] = useState<OrganizerWaitlist | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'hidden' | 'error'>('loading');
  const [closeOpen, setCloseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const on = !!options?.waitlist?.enabled;

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await waitlistApi.organizer(token, eventId)); setState('ok'); }
    catch (err) { setState(isFeatureOff(err) ? 'hidden' : 'error'); }
  }, [token, eventId]);
  useEffect(() => { if (on) void load(); }, [on, load]);

  async function toggle(enabled: boolean) {
    if (!token) return;
    setBusy(true);
    try { await waitlistApi.setEnabled(token, eventId, enabled, key.current); key.current = newIdempotencyKey(); toast.success(t('organizer.waitlist.saved')); await load(); }
    catch (err) { toast.error(t(s7ErrorKey(err))); } finally { setBusy(false); }
  }

  if (!on || state === 'hidden') return null;
  if (state === 'loading') return <SkeletonCard lines={2} />;
  if (state === 'error' || !data) return <Card><CardContent><Alert tone="error">{t('common.errorBody')} <Button size="sm" variant="secondary" onClick={() => void load()}>{t('common.tryAgain')}</Button></Alert></CardContent></Card>;

  const closed = !!data.closedAt;
  const totalLive = data.byTicketType.reduce((n, r) => n + r.waiting + r.offered, 0);
  const columns: ColumnDef<WaitlistCounts>[] = [
    { key: 'name', header: t('organizer.waitlist.col.type'), cell: r => <span className="font-medium [overflow-wrap:anywhere]">{r.name}</span> },
    { key: 'waiting', header: t('organizer.waitlist.col.waiting'), cell: r => r.waiting },
    { key: 'offered', header: t('organizer.waitlist.col.offered'), cell: r => r.offered },
    { key: 'converted', header: t('organizer.waitlist.col.converted'), cell: r => r.converted },
    { key: 'expired', header: t('organizer.waitlist.col.expired'), cell: r => r.expired },
    { key: 'left', header: t('organizer.waitlist.col.left'), cell: r => r.left },
  ];
  return (
    <Card data-testid="waitlist-card">
      <CardHeader><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('organizer.waitlist.title')}</h2></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="waitlist-note">{t('organizer.waitlist.note')}</p>
        {closed && <div data-testid="waitlist-closed"><Alert tone="info">{fmt(t('organizer.waitlist.closedAt'), { time: eventDateTime(data.closedAt, timezone, locale) })}</Alert></div>}
        {!closed && !data.enabled && <p className="text-sm text-[var(--color-warning-800)]" data-testid="waitlist-paused">{t('organizer.waitlist.paused')}</p>}
        <DataTable columns={columns} data={data.byTicketType} keyFn={r => r.ticketTypeId} label={t('organizer.waitlist.title')} dense emptyState={t('organizer.waitlist.empty')} />
        {totalLive === 0 && <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="waitlist-empty">{t('organizer.waitlist.empty')}</p>}
        {canWrite && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SwitchControl checked={data.enabled && !closed} onChange={v => void toggle(v)} label={t('organizer.waitlist.toggle')} disabled={busy || readOnly || closed} testId="waitlist-toggle" />
            <Button variant="destructive" disabled={readOnly || closed} onClick={() => setCloseOpen(true)} data-testid="waitlist-close">{t('organizer.waitlist.close')}</Button>
          </div>
        )}
      </CardContent>
      <ReasonTypedDialog open={closeOpen} onClose={() => setCloseOpen(false)} title={t('organizer.waitlist.close')} body={t('organizer.waitlist.closeBody')} noReason confirmLabel={t('organizer.waitlist.close')}
        testId="waitlist-close-dialog" typed={['CLOSE', 'FUNGA']} typedLabel={t('organizer.waitlist.closeTyped')}
        onConfirm={async r => { if (!token) return; await waitlistApi.close(token, eventId, r.key); setCloseOpen(false); toast.success(t('organizer.waitlist.closeDone')); await load(); }} />
    </Card>
  );
}
