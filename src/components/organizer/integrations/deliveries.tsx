'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §7.5, §8.7): the delivery log. Every delivery with its
// attempts, a redacted response snippet, and a bounded manual retry.
import { useCallback, useEffect, useState } from 'react';
import { api, type WebhookDeliveryDetail, type WebhookDeliveryRow, type WebhookEndpointRow } from '@/lib/api';
import { errorKey, eventDateTime, fmt, isFeatureOff } from '@/lib/events';
import { hostOf, isRateLimited } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Input, Select, SkeletonTable, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../../../app/providers';

const STATUSES = ['pending', 'failed', 'dead', 'delivered'] as const;
/** The delivery's own message id (the outbox id): `outboxEventId`, or `eventId` while the backend still sends that name. */
const outboxId = (r: Pick<WebhookDeliveryRow, 'eventId' | 'outboxEventId'>) => r.outboxEventId ?? r.eventId ?? '';
const statusKey = (d: Pick<WebhookDeliveryRow, 'status' | 'nextAttemptAt'>): MessageKey =>
  d.status === 'delivered' ? 'integrations.deliveries.status.delivered'
  : d.status === 'dead' ? 'integrations.deliveries.status.dead'
  : d.status === 'failed' ? (d.nextAttemptAt ? 'integrations.deliveries.status.retrying' : 'integrations.deliveries.status.failed')
  : 'integrations.deliveries.status.pending';
const statusTone = (s: string) => (s === 'delivered' ? 'success' : s === 'dead' ? 'danger' : s === 'failed' ? 'warning' : 'info') as 'success' | 'danger' | 'warning' | 'info';

export function DeliveriesTab({ endpoints, initialEndpoint, onUnavailable }: { endpoints: WebhookEndpointRow[]; initialEndpoint: string | null; onUnavailable: () => void }) {
  const { t, token, locale } = useApp();
  const [rows, setRows] = useState<WebhookDeliveryRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [endpointId, setEndpointId] = useState(initialEndpoint ?? '');
  const [status, setStatus] = useState('');
  const [eventId, setEventId] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => setQ(eventId.trim()), 350); return () => clearTimeout(h); }, [eventId]);

  const load = useCallback(async (cursor: string | null = null) => {
    if (!token) return;
    setError(false);
    try {
      const page = await api.webhookDeliveries(token, { endpointId: endpointId || undefined, status: status || undefined, eventId: q || undefined, cursor });
      setRows(prev => (cursor ? [...(prev ?? []), ...(page.items ?? [])] : (page.items ?? [])));
      setNext(page.nextCursor ?? null);
    } catch (err) { if (isFeatureOff(err)) onUnavailable(); else setError(true); }
  }, [token, endpointId, status, q, onUnavailable]);
  useEffect(() => { setRows(null); void load(null); }, [load]);

  const host = (id: string) => { const e = endpoints.find(x => x.id === id); return e ? hostOf(e.url) : id; };
  if (error) return <Alert tone="error"><span className="flex flex-wrap items-center gap-3">{t('common.somethingWrong')}<Button size="sm" variant="secondary" onClick={() => void load(null)}>{t('common.tryAgain')}</Button></span></Alert>;
  if (!rows) return <div aria-busy="true"><SkeletonTable /></div>;
  const tz = 'Africa/Dar_es_Salaam';
  const columns: ColumnDef<WebhookDeliveryRow>[] = [
    { key: 'time', header: t('integrations.col.time'), cell: r => eventDateTime(r.lastAttemptAt ?? r.createdAt, tz, locale) },
    { key: 'eventType', header: t('integrations.col.eventType'), cell: r => <span className="font-mono text-xs">{r.eventType}</span> },
    { key: 'outboxEventId', header: t('integrations.col.eventId'), cell: r => <code className="break-all text-xs">{outboxId(r)}</code> },
    { key: 'endpointId', header: t('integrations.col.endpoint'), cell: r => host(r.endpointId) },
    { key: 'status', header: t('integrations.col.status'), cell: r => <span data-testid="delivery-status"><Badge tone={statusTone(r.status)} dot>{t(statusKey(r))}</Badge></span> },
    { key: 'attemptCount', header: t('integrations.col.attempts'), align: 'right', cell: r => r.attemptCount },
    { key: 'responseCode', header: t('integrations.col.code'), cell: r => r.responseCode ?? '—' },
    { key: 'nextAttemptAt', header: t('integrations.col.next'), cell: r => (r.nextAttemptAt && r.status !== 'delivered' && r.status !== 'dead' ? eventDateTime(r.nextAttemptAt, tz, locale) : '—') },
  ];
  const filters = (
    <>
      <Select size="sm" aria-label={t('integrations.deliveries.filter.endpoint')} value={endpointId} onChange={e => setEndpointId(e.target.value)} data-testid="deliveries-filter-endpoint">
        <option value="">{t('integrations.deliveries.filter.all')}</option>
        {endpoints.map(e => <option key={e.id} value={e.id}>{hostOf(e.url)}</option>)}
      </Select>
      <Select size="sm" aria-label={t('integrations.deliveries.filter.status')} value={status} onChange={e => setStatus(e.target.value)} data-testid="deliveries-filter-status">
        <option value="">{t('integrations.deliveries.filter.all')}</option>
        {STATUSES.map(s => <option key={s} value={s}>{t(statusKey({ status: s, nextAttemptAt: null }))}</option>)}
      </Select>
      <Input size="sm" value={eventId} onChange={e => setEventId(e.target.value)} placeholder={t('integrations.deliveries.filter.eventId')} aria-label={t('integrations.deliveries.filter.eventId')} data-testid="deliveries-filter-event" />
    </>
  );
  return (
    <div className="space-y-4" data-testid="deliveries-tab">
      {rows.length === 0 && !endpointId && !status && !q
        ? <div data-testid="deliveries-empty"><EmptyState title={t('integrations.deliveries.empty')} /></div>
        : (
          <Card><CardContent>
            <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('integrations.deliveries.title')} dense pageSize={25} extraFilters={filters} emptyState={t('integrations.deliveries.empty')}
              onRowClick={r => setOpenId(r.id)}
              actions={r => <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setOpenId(r.id); }} data-testid={`delivery-open-${r.id}`}>{t('integrations.action.details')}</Button>} />
            {next && <div className="mt-3 flex justify-center"><Button variant="secondary" onClick={() => void load(next)} data-testid="deliveries-more">{t('events.bibs.loadMore')}</Button></div>}
          </CardContent></Card>
        )}
      <DeliveryDrawer id={openId} host={host} onClose={() => setOpenId(null)} onChanged={() => void load(null)} />
    </div>
  );
}

function DeliveryDrawer({ id, host, onClose, onChanged }: { id: string | null; host: (id: string) => string; onClose: () => void; onChanged: () => void }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [data, setData] = useState<WebhookDeliveryDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!id || !token) return;
    try { setData(await api.webhookDelivery(token, id)); } catch { setFailed(true); }
  }, [id, token]);
  useEffect(() => { setData(null); setFailed(false); setMsg(null); void load(); }, [load]);
  async function retry() {
    if (!token || !id) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.retryWebhookDelivery(token, id);
      setMsg(t(r.alreadyQueued ? 'integrations.deliveries.retry.already' : 'integrations.deliveries.retry.queued'));
      toast.success(t(r.alreadyQueued ? 'integrations.deliveries.retry.already' : 'integrations.deliveries.retry.queued'));
      await load(); onChanged();
    } catch (err) { setMsg(isRateLimited(err) ? t('errors.events.rate_limited') : t(errorKey(err))); } finally { setBusy(false); }
  }
  const tz = 'Africa/Dar_es_Salaam';
  const d = data?.delivery ?? null;
  const attempts = data?.attempts ?? [];
  const left = data?.manualRetriesLeft;
  return (
    <Dialog open={!!id} onClose={onClose} title={d ? d.eventType : ''} description={d ? `${host(d.endpointId)} · ${outboxId(d)}` : undefined} size="xl">
      <div className="space-y-4" data-testid="delivery-drawer">
        {failed && <Alert tone="error">{t('common.somethingWrong')}</Alert>}
        {!d && !failed && <SkeletonTable rows={3} />}
        {d && (
          <>
            <p className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone={statusTone(d.status)} dot>{t(statusKey(d))}</Badge>
              <span>{t('integrations.col.attempts')}: {d.attemptCount}</span>
              {d.responseCode != null && <span>{t('integrations.col.code')}: {d.responseCode}</span>}
            </p>
            <section aria-labelledby="att-h" className="space-y-2">
              <h3 id="att-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('integrations.deliveries.attempts')}</h3>
              <div className="overflow-x-auto">
                <table className="ui-table w-full text-sm" data-testid="attempts-table">
                  <thead><tr><th scope="col" className="text-left">#</th><th scope="col" className="text-left">{t('integrations.col.time')}</th><th scope="col" className="text-left">{t('integrations.col.status')}</th><th scope="col" className="text-left">{t('integrations.col.code')}</th><th scope="col" className="text-left">{t('integrations.col.duration')}</th></tr></thead>
                  <tbody>
                    {attempts.map(a => (
                      <tr key={a.attemptNo + a.startedAt}>
                        <td>{a.attemptNo}</td><td>{eventDateTime(a.startedAt, tz, locale)}</td>
                        <td><span data-testid="attempt-outcome">{t(`integrations.deliveries.outcome.${a.outcome}` as MessageKey)}</span>{a.responseSnippet && <code className="mt-1 block break-all text-xs text-[var(--color-fg-quaternary)]" data-testid="attempt-snippet">{a.responseSnippet}</code>}</td>
                        <td>{a.responseCode ?? '—'}</td><td>{a.durationMs ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {data?.payload !== undefined && data?.payload !== null && (
              <section aria-labelledby="pay-h" className="space-y-2">
                <h3 id="pay-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('integrations.deliveries.payload')}</h3>
                <pre className="max-h-64 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-xs" data-testid="delivery-payload">{JSON.stringify(data.payload, null, 2)}</pre>
              </section>
            )}
            {msg && <div role="status" data-testid="delivery-msg"><Alert tone="info">{msg}</Alert></div>}
            {left != null && d.status !== 'delivered' && <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="delivery-left">{fmt(t('integrations.deliveries.retry.left'), { n: left })}</p>}
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>{t('integrations.action.close')}</Button>
        <Button loading={busy} disabled={!d || d.status === 'delivered' || left === 0} onClick={() => void retry()} data-testid="delivery-retry">{t('integrations.deliveries.retry')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
