'use client';
// Events S7 (spec §6.4, H10, AC-H10): the admin's list of open result questions across events. Filter chips Open, Older than 7 days, Organizer suspended. A row opens
// the event's Results view, where the existing admin result drawer holds the resolve action (reason and notice). "May resolve" is the server's answer (D59): after
// 7 days, or when the organizer is suspended or inactive.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminS7Api, type DisputeListRow } from '@/lib/events-s7-api';
import { eventDateTime, isFeatureOff } from '@/lib/events';
import { Badge, Button, Card, CardContent, Segmented, SkeletonTable } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { EventsUnavailable, PageError } from '@/components/organizer/page-states';
import { useApp } from '../../app/providers';

type Chip = 'open' | 'old' | 'suspended';

export function AdminEventsDisputes() {
  const { t, token, locale } = useApp();
  const [chip, setChip] = useState<Chip>('open');
  const [rows, setRows] = useState<DisputeListRow[] | null>(null);
  const [state, setState] = useState<'ok' | 'error' | 'off'>('ok');

  const load = useCallback(async () => {
    if (!token) return;
    setRows(null); setState('ok');
    try {
      const q = { status: 'open', ...(chip === 'old' ? { olderThanDays: 7 } : {}), ...(chip === 'suspended' ? { organizerStatus: 'suspended' } : {}), limit: 100 };
      const out: DisputeListRow[] = []; let cursor: string | null = null;
      for (let i = 0; i < 10; i++) { const p = await adminS7Api.disputes(token, { ...q, cursor }); out.push(...(p.items ?? [])); cursor = p.nextCursor ?? null; if (!cursor) break; }
      setRows(out);
    } catch (err) { setState(isFeatureOff(err) ? 'off' : 'error'); }
  }, [token, chip]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'off') return <EventsUnavailable />;
  const columns: ColumnDef<DisputeListRow>[] = [
    { key: 'eventTitle', header: t('admin.events.disputes.col.event'), sortable: true, cell: r => <span className="font-medium [overflow-wrap:anywhere]">{r.eventTitle}</span> },
    { key: 'organizerName', header: t('admin.events.disputes.col.organizer'), cell: r => r.organizerName },
    { key: 'openedAt', header: t('admin.events.disputes.col.opened'), sortable: true, cell: r => eventDateTime(r.openedAt, 'Africa/Dar_es_Salaam', locale) },
    { key: 'ageDays', header: t('admin.events.disputes.col.age'), sortable: true, cell: r => r.ageDays },
    { key: 'status', header: t('admin.events.disputes.col.status'), cell: r => (r.adminMayResolve ? <Badge tone="warning" dot>{t('admin.events.disputes.mayResolve')}</Badge> : <Badge tone="gray">{t('admin.events.disputes.chip.open')}</Badge>) },
  ];
  return (
    <div className="space-y-4" data-testid="admin-disputes">
      <Segmented className="w-fit max-w-full overflow-x-auto" value={chip} onChange={v => setChip(v as Chip)}
        options={[['open', t('admin.events.disputes.chip.open')], ['old', t('admin.events.disputes.chip.old')], ['suspended', t('admin.events.disputes.chip.suspended')]]} />
      {state === 'error' ? <PageError onRetry={() => void load()} /> : !rows ? <div aria-busy="true"><SkeletonTable /></div> : (
        <Card><CardContent>
          <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('admin.events.disputes.title')} dense emptyState={t('admin.events.disputes.empty')} defaultSort={{ key: 'ageDays', dir: 'desc' }}
            actions={r => <Link href={`/admin/events?event=${encodeURIComponent(r.eventId)}&view=results`} className="inline-flex"><Button variant="ghost" size="sm" aria-label={`${t('admin.events.disputes.open')}: ${r.eventTitle}`} data-testid={`dispute-open-${r.id}`}>{t('admin.events.disputes.open')}</Button></Link>} />
        </CardContent></Card>
      )}
    </div>
  );
}
