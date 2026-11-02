'use client';
// Events S7 (spec §4.9 "Admin", AC-W16): the FitFlex admin's masked waitlist view on an event. First name and last initial, place in line, status, joined time.
// No contact data. Removing an entry needs a reason (optional Swahili text, shown to the person) and tells the person.
import { useCallback, useEffect, useState } from 'react';
import { waitlistApi, type AdminWaitlistEntry } from '@/lib/events-s7-api';
import { eventDateTime, isFeatureOff } from '@/lib/events';
import type { MessageKey } from '@/lib/i18n';
import { Badge, Button, Card, CardContent, CardHeader, SkeletonTable, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { ReasonTypedDialog } from '@/components/events-s7-dialogs';
import { PageError } from '@/components/organizer/page-states';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../app/providers';

const LIVE = new Set(['waiting', 'offered']);

export function AdminEventWaitlist({ eventId, timezone }: { eventId: string; timezone: string }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const options = useEventsOptions();
  const [rows, setRows] = useState<AdminWaitlistEntry[] | null>(null);
  const [state, setState] = useState<'ok' | 'hidden' | 'error'>('ok');
  const [target, setTarget] = useState<AdminWaitlistEntry | null>(null);
  const on = !!options?.waitlist?.enabled;

  const load = useCallback(async () => {
    if (!token) return;
    setState('ok');
    try { const out: AdminWaitlistEntry[] = []; let cursor: string | null = null; for (let i = 0; i < 10; i++) { const p = await waitlistApi.adminList(token, eventId, { cursor, limit: 100 }); out.push(...(p.items ?? [])); cursor = p.nextCursor ?? null; if (!cursor) break; } setRows(out); }
    catch (err) { setState(isFeatureOff(err) ? 'hidden' : 'error'); }
  }, [token, eventId]);
  useEffect(() => { if (on) void load(); }, [on, load]);
  if (!on || state === 'hidden') return null;

  const columns: ColumnDef<AdminWaitlistEntry>[] = [
    { key: 'seq', header: t('admin.events.waitlist.col.seq'), cell: r => r.seq },
    { key: 'name', header: t('admin.events.waitlist.col.name'), cell: r => <span className="[overflow-wrap:anywhere]">{r.name ?? r.displayName ?? '—'}</span> },
    { key: 'status', header: t('admin.events.waitlist.col.status'), cell: r => <Badge tone={r.status === 'offered' ? 'warning' : r.status === 'waiting' ? 'info' : 'gray'}>{t(`admin.events.waitlist.status.${r.status}` as MessageKey)}</Badge> },
    { key: 'joinedAt', header: t('admin.events.waitlist.col.joined'), cell: r => eventDateTime(r.joinedAt, timezone, locale) },
  ];
  return (
    <Card data-testid="admin-waitlist">
      <CardHeader><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.waitlist.title')}</h2></CardHeader>
      <CardContent>
        {state === 'error' ? <PageError onRetry={() => void load()} /> : !rows ? <div aria-busy="true"><SkeletonTable rows={3} /></div> : (
          <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('admin.events.waitlist.title')} dense emptyState={t('admin.events.waitlist.empty')}
            actions={r => (LIVE.has(r.status) ? <Button variant="ghost" size="sm" onClick={() => setTarget(r)} aria-label={`${t('admin.events.waitlist.remove')}: ${r.name ?? r.displayName ?? ''}`} data-testid={`admin-waitlist-remove-${r.id}`}>{t('admin.events.waitlist.remove')}</Button> : null)} />
        )}
      </CardContent>
      <ReasonTypedDialog open={!!target} onClose={() => setTarget(null)} title={t('admin.events.waitlist.remove')} confirmLabel={t('admin.events.waitlist.remove')} testId="admin-waitlist-dialog"
        reasonLabel={t('admin.events.waitlist.reason')} reasonSwLabel={t('admin.events.waitlist.reasonSw')}
        onConfirm={async r => {
          if (!token || !target) return;
          await waitlistApi.adminRemove(token, eventId, target.id, { reason: r.reason, ...(r.reasonSw ? { reasonSw: r.reasonSw } : {}) }, r.key);
          toast.success(t('admin.events.waitlist.removed')); setTarget(null); await load();
        }} />
    </Card>
  );
}
