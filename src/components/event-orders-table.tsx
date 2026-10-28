'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type EventOrderRow, type EventsPage } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { ORDER_STATUSES, eventDateTime, isFeatureOff, orderStatusOf } from '@/lib/events';
import { Badge, Button, Card, CardContent, EmptyState, Select, SkeletonTable } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { EventsUnavailable, PageError } from '@/components/organizer/page-states';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../app/providers';

export type OrdersFieldPolicy = 'organizer' | 'admin';

/**
 * Orders of one event (S3 §6.3 / §6.5): reference, purchaser (masked member name or the organisation), places, total,
 * FitFlex fee, status, held-until / closed, created. Admins may open a row (§6.5 dialog); organizers only read.
 */
export function EventOrdersTable({ eventId, timezone, timezoneAbbr, fieldPolicy, published, onOpen, reloadKey = 0 }: {
  eventId: string; timezone: string | null | undefined; timezoneAbbr?: string | null; fieldPolicy: OrdersFieldPolicy; published: boolean;
  onOpen?: (order: EventOrderRow) => void; reloadKey?: number;
}) {
  const { t, token, locale } = useApp();
  const [rows, setRows] = useState<EventOrderRow[] | null>(null);
  const [error, setError] = useState(false);
  // S3 §7.1: the table exists only while the server says registration is on; a 404 feature_disabled says the same.
  const options = useEventsOptions();
  const [off, setOff] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    if (!token || !published) { setRows([]); return; }
    setError(false);
    try {
      const out: EventOrderRow[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const query = { status: status || undefined, cursor, limit: 50 };
        const page: EventsPage<EventOrderRow> = fieldPolicy === 'admin' ? await api.adminEventOrders(token, eventId, query) : await api.organizerEventOrders(token, eventId, query);
        out.push(...(page.items ?? []));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      setRows(out);
    } catch (err) { if (isFeatureOff(err)) setOff(true); else setError(true); }
  }, [token, eventId, status, fieldPolicy, published]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  if (options === undefined) return <div aria-busy="true"><SkeletonTable /></div>;
  if (!options?.registration || off) return <EventsUnavailable />;
  if (!published) return <div data-testid="orders-not-published"><EmptyState title={t('organizer.reg.notPublished')} /></div>;
  if (error) return <PageError onRetry={() => void load()} />;
  if (!rows) return <div aria-busy="true"><SkeletonTable /></div>;

  const columns: ColumnDef<EventOrderRow>[] = [
    { key: 'reference', header: t('corp.events.col.reference'), sortable: true, cell: r => <span className="font-mono text-xs">{r.reference}</span> },
    { key: 'purchaser', header: t('organizer.orders.col.purchaser'), cell: r => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>{r.purchaser?.label ?? '—'}</span>
        {r.purchaser?.type === 'organization' && <Badge tone="brand">{t('organizer.orders.organisation')}</Badge>}
      </span>
    ) },
    { key: 'placesCount', header: t('corp.events.col.places'), sortable: true, align: 'right', cell: r => r.placesCount },
    { key: 'totalTzs', header: t('corp.events.col.total'), sortable: true, align: 'right', cell: r => money(r.totalTzs, r.currency) },
    { key: 'feesTzs', header: t('organizer.orders.col.fees'), align: 'right', cell: r => (r.feesTzs ? money(r.feesTzs, r.currency) : '—') },
    { key: 'status', header: t('corp.events.col.status'), sortable: true, cell: r => { const s = orderStatusOf(r.status); return <Badge tone={s.tone}>{t(s.key)}</Badge>; } },
    { key: 'holdExpiresAt', header: `${t('corp.events.col.heldUntil')} / ${t('organizer.orders.col.closed')}`, cell: r => (
      r.status === 'awaiting_payment' ? eventDateTime(r.holdExpiresAt, timezone, locale, timezoneAbbr) : r.closedAt ? eventDateTime(r.closedAt, timezone, locale, timezoneAbbr) : '—'
    ) },
    { key: 'createdAt', header: t('corp.events.col.created'), sortable: true, cell: r => eventDateTime(r.createdAt, timezone, locale, timezoneAbbr) },
  ];
  const filters = (
    <Select size="sm" aria-label={t('corp.events.col.status')} value={status} onChange={e => setStatus(e.target.value)} data-testid="orders-filter-status">
      <option value="">{t('events.list.allStatuses')}</option>
      {ORDER_STATUSES.map(s => <option key={s} value={s}>{t(orderStatusOf(s).key)}</option>)}
    </Select>
  );
  return (
    <div className="space-y-3" data-testid={`${fieldPolicy}-orders`}>
      <Card><CardContent>
        <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('organizer.events.view.orders')} dense pageSize={25} extraFilters={filters}
          defaultSort={{ key: 'createdAt', dir: 'desc' }} emptyState={t('organizer.orders.empty')} onRowClick={onOpen}
          actions={onOpen ? r => <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); onOpen(r); }} data-testid={`order-open-${r.id}`}>{t('events.list.open')}</Button> : undefined} />
      </CardContent></Card>
      {fieldPolicy === 'organizer' && <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="orders-footer">{t('organizer.orders.footer')}</p>}
    </div>
  );
}
