'use client';
// Events S4 (design spec docs/design/events-s4-payments-and-tickets.md §3.14, §6.6, §7.4, decisions D25, D28): the organizer
// Finance tab. Totals only (paid, refunded, refunds pending, held, commission, expected net, by ticket type): never a payer
// name, phone, transaction ID, payment method or a per-order row. It makes no promise about when the organizer is paid.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, type EventFinance } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { eventDateTime, fmt, isFeatureOff, isForbidden, trackEventsS4Analytics } from '@/lib/events';
import { Alert, Button, Card, CardContent, EmptyState, MetricCard, SkeletonTable } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { EventsUnavailable, OrganizerForbidden, PageError } from '@/components/organizer/page-states';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../app/providers';

export function EventFinanceView({ eventId, timezone, timezoneAbbr, published }: { eventId: string; timezone: string | null | undefined; timezoneAbbr?: string | null; published: boolean }) {
  const { t, token, locale } = useApp();
  const options = useEventsOptions();
  const [data, setData] = useState<EventFinance | null>(null);
  const [state, setState] = useState<'ok' | 'error' | 'off' | 'forbidden'>('ok');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!token || !published) return;
    setState('ok'); setBusy(true);
    try { setData(await api.organizerEventFinance(token, eventId)); trackEventsS4Analytics('finance_viewed'); }
    catch (err) { setState(isFeatureOff(err) ? 'off' : isForbidden(err) ? 'forbidden' : 'error'); }
    finally { setBusy(false); }
  }, [token, eventId, published]);
  useEffect(() => { void load(); }, [load]);

  if (options === undefined) return <div aria-busy="true"><SkeletonTable /></div>;
  if (!options?.registration || state === 'off') return <EventsUnavailable />;
  if (!published) return <div data-testid="finance-not-published"><EmptyState title={t('organizer.reg.notPublished')} /></div>;
  if (state === 'forbidden') return <OrganizerForbidden backHref="/organizer/events" />;
  if (state === 'error') return <PageError onRetry={() => void load()} />;
  if (!data) return <div aria-busy="true" data-testid="finance-loading"><SkeletonTable rows={3} /></div>;

  const cur = data.currency;
  const nothingYet = data.paidTzs === 0 && data.refundedTzs === 0 && data.refundPendingTzs === 0 && data.awaitingPaymentTzs === 0;
  const columns: ColumnDef<EventFinance['byTicketType'][number]>[] = [
    { key: 'name', header: t('organizer.reg.col.ticket'), sortable: true, cell: r => r.name },
    { key: 'sold', header: t('events.finance.sold'), sortable: true, align: 'right', cell: r => r.sold },
    { key: 'grossTzs', header: t('events.finance.collected'), sortable: true, align: 'right', cell: r => money(r.grossTzs, cur) },
  ];
  return (
    <div className="space-y-4" data-testid="organizer-finance">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{t('events.finance.title')}</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--color-fg-quaternary)]" data-testid="finance-as-of">{fmt(t('events.finance.asOf'), { time: eventDateTime(data.asOf, timezone, locale, timezoneAbbr) })}</span>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void load()} data-testid="finance-refresh"><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('common.refresh')}</Button>
        </div>
      </div>
      {nothingYet ? (
        <div data-testid="finance-empty"><EmptyState title={t('events.finance.empty')} /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="finance-metrics">
            <div data-testid="finance-paid"><MetricCard label={t('events.finance.paid')} value={money(data.paidTzs, cur)} wrapLabel /></div>
            <div data-testid="finance-refunded"><MetricCard label={t('events.finance.refunded')} value={money(data.refundedTzs, cur)} wrapLabel /></div>
            <div data-testid="finance-refund-pending"><MetricCard label={t('events.finance.refundPending')} value={money(data.refundPendingTzs, cur)} wrapLabel /></div>
            <div data-testid="finance-awaiting"><MetricCard label={t('events.finance.awaiting')} value={money(data.awaitingPaymentTzs, cur)} wrapLabel /></div>
            <div data-testid="finance-commission"><MetricCard label={fmt(t('events.finance.commission'), { pct: data.commissionPct ?? 0 })} value={money(data.commissionTzs, cur)} wrapLabel sub={data.commissionPct == null ? t('events.finance.commissionNotSet') : undefined} /></div>
            <div className="ring-2 ring-[var(--color-brand-500)] rounded-[var(--radius-xl)]" data-testid="finance-net"><MetricCard label={t('events.finance.net')} value={money(data.expectedNetTzs, cur)} wrapLabel /></div>
          </div>
          <Card><CardContent>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.finance.byTicket')}</h3>
            <DataTable columns={columns} data={data.byTicketType} keyFn={r => r.ticketTypeId} label={t('events.finance.byTicket')} dense emptyState={t('events.finance.empty')} />
          </CardContent></Card>
        </>
      )}
      <Alert tone="info">{t('events.finance.note')}</Alert>
      <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="finance-privacy">{t('events.finance.privacy')}</p>
    </div>
  );
}
