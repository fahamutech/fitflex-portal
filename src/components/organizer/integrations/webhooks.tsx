'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §7, §8.7): the webhook endpoints tab. HTTPS only
// (the server refuses private addresses), an explicit event list (no wildcard), secret shown once, handshake before any event,
// test send, health, auto-disable notice.
import { useCallback, useEffect, useState } from 'react';
import { api, type WebhookAttempt, type WebhookEndpointRow, type WebhookTestResult } from '@/lib/api';
import { errorKey, eventDateTime, fmt, isFeatureOff, relativeTime } from '@/lib/events';
import { HEALTH_TONE, WEBHOOK_EVENT_GROUPS, WEBHOOK_EVENT_TYPES, healthKey, hostOf, urlErrorKey } from '@/lib/events-ops';
import { messages, type MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, Checkbox, EmptyState, Field, Input, SkeletonTable, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { SecretOnceDialog } from '@/components/secret-once-dialog';
import { RotateDialog } from '@/components/organizer/integrations/rotate-dialog';
import { useApp } from '../../../../app/providers';

export function WebhooksTab({ readOnly, createRequest, onUnavailable, focusId }: { readOnly: boolean; createRequest: number; onUnavailable: () => void; focusId: string | null }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<WebhookEndpointRow[] | null>(null);
  const [error, setError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [rotateFor, setRotateFor] = useState<WebhookEndpointRow | null>(null);
  const [detailFor, setDetailFor] = useState<WebhookEndpointRow | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error' | 'info'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(false);
    try { setRows((await api.webhookEndpoints(token)).items ?? []); }
    catch (err) { if (isFeatureOff(err)) onUnavailable(); else setError(true); }
  }, [token, onUnavailable]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (createRequest > 0 && !readOnly) setCreateOpen(true); }, [createRequest, readOnly]);
  useEffect(() => { if (focusId && rows) setDetailFor(rows.find(r => r.id === focusId) ?? null); }, [focusId, rows]);

  async function verifyNow(row: WebhookEndpointRow) {
    if (!token) return;
    setBusyId(row.id); setNotice(null);
    try {
      const r = await api.verifyWebhookEndpoint(token, row.id);
      const host = r.host || hostOf(row.url);
      setNotice(r.ok
        ? { tone: 'success', text: fmt(t('integrations.webhooks.verify.ok'), { host }) }
        : { tone: 'warning', text: r.reason ? fmt(t('integrations.webhooks.verify.fail'), { host, reason: reasonText(r.reason) }) : fmt(t('integrations.webhooks.verify.failShort'), { host }) });
    } catch (err) { setNotice({ tone: 'error', text: t(errorKey(err)) }); }
    setBusyId(null); await load();
  }
  /** The handshake's failure `reason` is a code (timeout, http_503, …): words when we have them, the code otherwise. */
  const reasonText = (reason: string) => (`integrations.deliveries.outcome.${reason}` in messages.en ? t(`integrations.deliveries.outcome.${reason}` as MessageKey) : reason);
  async function sendTest(row: WebhookEndpointRow) {
    if (!token) return;
    setBusyId(row.id); setNotice(null);
    try {
      const r: WebhookTestResult = await api.testWebhookEndpoint(token, row.id);
      const ok = r.ok ?? r.outcome === 'success';
      setNotice(ok
        ? { tone: 'success', text: fmt(t('integrations.webhooks.test.ok'), { code: r.responseCode ? ` (${r.responseCode})` : '' }) }
        : { tone: 'error', text: fmt(t('integrations.webhooks.test.fail'), { reason: t(`integrations.deliveries.outcome.${r.outcome ?? 'http_error'}` as MessageKey) }) });
    } catch (err) { setNotice({ tone: 'error', text: t(errorKey(err)) }); }
    setBusyId(null); await load();
  }
  async function setState(row: WebhookEndpointRow, action: 'disable' | 'enable') {
    if (!token) return;
    setBusyId(row.id); setNotice(null);
    try { await api.setWebhookEndpointState(token, row.id, action); }
    catch (err) { setNotice({ tone: 'error', text: t(errorKey(err)) }); }
    setBusyId(null); await load();
  }

  if (error) return <Alert tone="error"><span className="flex flex-wrap items-center gap-3">{t('common.somethingWrong')}<Button size="sm" variant="secondary" onClick={() => void load()}>{t('common.tryAgain')}</Button></span></Alert>;
  if (!rows) return <div aria-busy="true"><SkeletonTable /></div>;

  const columns: ColumnDef<WebhookEndpointRow>[] = [
    { key: 'url', header: t('integrations.col.url'), cell: r => <span title={r.url} className="font-medium text-[var(--color-fg-primary)] [overflow-wrap:anywhere]" data-testid="endpoint-host">{r.host ?? hostOf(r.url)}</span> },
    { key: 'events', header: t('integrations.col.events'), cell: r => <span title={r.events.join('\n')}>{r.events.length}</span> },
    { key: 'health', header: t('integrations.col.health'), cell: r => <Badge tone={HEALTH_TONE[r.health] ?? 'gray'} dot>{t(healthKey(r.health))}</Badge> },
    { key: 'lastSuccessAt', header: t('integrations.col.lastSuccess'), cell: r => (r.lastSuccessAt ? relativeTime(r.lastSuccessAt, locale) : '—') },
    { key: 'pending', header: t('integrations.col.pending'), align: 'right', cell: r => r.pending },
    { key: 'failed', header: t('integrations.col.failed24'), align: 'right', cell: r => r.last24h?.failed ?? 0 },
  ];
  return (
    <div className="space-y-4" data-testid="webhooks-tab">
      {notice && <div role="status" data-testid="webhook-notice"><Alert tone={notice.tone}>{notice.text}</Alert></div>}
      {rows.filter(r => r.status === 'disabled' && r.disabledReason === 'auto_failures').map(r => (
        <div key={r.id} data-testid="webhook-auto-disabled">
          <Alert tone="error">
            <span className="flex flex-wrap items-center gap-3">
              <span><strong>{hostOf(r.url)}</strong>: {fmt(t('integrations.webhooks.autoDisabled'), { time: r.disabledAt ? eventDateTime(r.disabledAt, 'Africa/Dar_es_Salaam', locale) : '—' })}</span>
              {!readOnly && <Button size="sm" variant="secondary" loading={busyId === r.id} onClick={() => void setState(r, 'enable')} data-testid={`endpoint-enable-again-${r.id}`}>{t('integrations.webhooks.enableAgain')}</Button>}
            </span>
          </Alert>
        </div>
      ))}
      {rows.length === 0 ? (
        <div data-testid="webhooks-empty"><EmptyState title={t('integrations.webhooks.empty')} action={!readOnly ? <Button onClick={() => setCreateOpen(true)}>{t('integrations.webhooks.new')}</Button> : undefined} /></div>
      ) : (
        <Card><CardContent>
          <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('integrations.tab.webhooks')} dense pageSize={25} emptyState={t('integrations.webhooks.empty')}
            actions={r => (
              <>
                <Button variant="ghost" size="sm" onClick={() => setDetailFor(r)} data-testid={`endpoint-details-${r.id}`}>{t('integrations.action.details')}</Button>
                {!readOnly && r.status === 'active' && !r.verifiedAt && <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => void verifyNow(r)} data-testid={`endpoint-verify-${r.id}`}>{t('integrations.webhooks.verify')}</Button>}
                {!readOnly && r.status === 'active' && !!r.verifiedAt && <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => void sendTest(r)} data-testid={`endpoint-test-${r.id}`}>{t('integrations.webhooks.test')}</Button>}
                {!readOnly && r.status === 'active' && <Button variant="ghost" size="sm" onClick={() => void setState(r, 'disable')} data-testid={`endpoint-disable-${r.id}`}>{t('integrations.webhooks.disable')}</Button>}
                {!readOnly && r.status === 'disabled' && <Button variant="ghost" size="sm" onClick={() => void setState(r, 'enable')} data-testid={`endpoint-enable-${r.id}`}>{t('integrations.webhooks.enable')}</Button>}
                {!readOnly && <Button variant="ghost" size="sm" onClick={() => setRotateFor(r)} data-testid={`endpoint-rotate-${r.id}`}>{t('integrations.webhooks.rotate')}</Button>}
              </>
            )} />
        </CardContent></Card>
      )}
      <CreateEndpointDialog open={createOpen} onClose={() => setCreateOpen(false)}
        onCreated={(endpoint, value) => {
          setCreateOpen(false); setSecret(value);
          setNotice(endpoint.verifiedAt
            ? { tone: 'success', text: fmt(t('integrations.webhooks.verify.ok'), { host: hostOf(endpoint.url) }) }
            : { tone: 'info', text: t('integrations.webhooks.created') });
          void load();
        }} />
      <SecretOnceDialog open={secret !== null} onClose={() => setSecret(null)} secretLabel={t('integrations.secret.signing')} secret={secret ?? ''} docsHref="/organizer/integrations?tab=docs" />
      <RotateDialog name={rotateFor ? hostOf(rotateFor.url) : null} onClose={() => setRotateFor(null)} rotate={async grace => {
        if (!token || !rotateFor) return;
        const out = await api.rotateWebhookSecret(token, rotateFor.id, grace);
        setSecret(out.signingSecret); setRotateFor(null); void load();
      }} />
      <EndpointDetails row={detailFor} onClose={() => setDetailFor(null)} />
    </div>
  );
}

function CreateEndpointDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (endpoint: WebhookEndpointRow, secret: string) => void }) {
  const { t, token } = useApp();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [urlError, setUrlError] = useState<MessageKey | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  useEffect(() => { if (open) { setUrl(''); setEvents([]); setDescription(''); setUrlError(null); setError(null); setBusy(false); } }, [open]);
  const all = events.length === WEBHOOK_EVENT_TYPES.length;
  const toggle = (type: string) => setEvents(cur => (cur.includes(type) ? cur.filter(x => x !== type) : [...cur, type]));
  async function create() {
    if (!token) return;
    setBusy(true); setUrlError(null); setError(null);
    try {
      const out = await api.createWebhookEndpoint(token, { url: url.trim(), events, ...(description.trim() ? { description: description.trim() } : {}) });
      onCreated(out.endpoint, out.signingSecret);
    } catch (err) {
      const k = urlErrorKey(err);
      if (k) setUrlError(k); else setError(errorKey(err));
    } finally { setBusy(false); }
  }
  const httpsHint = url.trim() !== '' && !/^https:\/\//i.test(url.trim());
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('integrations.webhooks.new')} description={t('integrations.webhooks.verify.pending')} size="lg">
      <div className="space-y-5" data-testid="endpoint-dialog">
        {error && <Alert tone="error">{t(error)}</Alert>}
        <Field label={t('integrations.webhooks.url')} error={urlError ? t(urlError) : httpsHint ? t('integrations.url.error.not_https') : undefined} required>
          <Input type="url" inputMode="url" value={url} onChange={e => { setUrl(e.target.value); setUrlError(null); }} placeholder="https://" autoComplete="off" data-testid="endpoint-url" />
        </Field>
        <fieldset className="space-y-3">
          <legend className="mb-1 flex w-full items-center justify-between text-sm font-semibold text-[var(--color-fg-primary)]">
            {t('integrations.webhooks.events')}
            <Button type="button" variant="link" size="sm" onClick={() => setEvents(all ? [] : [...WEBHOOK_EVENT_TYPES])} data-testid="endpoint-select-all">{t('integrations.webhooks.selectAll')}</Button>
          </legend>
          {WEBHOOK_EVENT_GROUPS.map(g => (
            <div key={g.key} className="space-y-0.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-quaternary)]">{t(g.key)}</p>
              {g.types.map(type => <Checkbox key={type} label={<span className="font-mono text-xs">{type}</span>} checked={events.includes(type)} onChange={() => toggle(type)} data-testid={`endpoint-event-${type}`} />)}
            </div>
          ))}
        </fieldset>
        <Field label={t('integrations.webhooks.description')}><Input value={description} maxLength={120} onChange={e => setDescription(e.target.value)} data-testid="endpoint-description" /></Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('integrations.action.cancel')}</Button>
        <Button loading={busy} disabled={!url.trim() || events.length === 0 || httpsHint} onClick={() => void create()} data-testid="endpoint-create">{t('integrations.action.create')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

function EndpointDetails({ row, onClose }: { row: WebhookEndpointRow | null; onClose: () => void }) {
  const { t, token, locale } = useApp();
  const [attempts, setAttempts] = useState<WebhookAttempt[] | null>(null);
  useEffect(() => {
    setAttempts(null);
    if (!row || !token) return;
    let live = true;
    api.webhookEndpoint(token, row.id).then(p => { if (live) setAttempts((p.attempts ?? []).slice(0, 10)); }).catch(() => { if (live) setAttempts([]); });
    return () => { live = false; };
  }, [row, token]);
  return (
    <Dialog open={!!row} onClose={onClose} title={row ? hostOf(row.url) : ''} description={row?.url} size="lg">
      <div className="space-y-4" data-testid="endpoint-details">
        {row && (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={HEALTH_TONE[row.health] ?? 'gray'} dot>{t(healthKey(row.health))}</Badge>
              <span>{t('integrations.col.pending')}: {row.pending}</span>
              <span>{t('integrations.col.failed24')}: {row.last24h?.failed ?? 0}</span>
              {row.secretHint && <code className="text-xs" data-testid="endpoint-secret-hint">{row.secretHint}</code>}
              {row.rotation?.inGrace && row.rotation.graceEndsAt && <span data-testid="endpoint-in-grace">{fmt(t('integrations.clients.inGrace'), { time: eventDateTime(row.rotation.graceEndsAt, 'Africa/Dar_es_Salaam', locale) })}</span>}
            </p>
            <ul className="flex flex-wrap gap-2">{row.events.map(e => <li key={e}><Badge tone="gray"><span className="font-mono text-[11px]">{e}</span></Badge></li>)}</ul>
            <section aria-labelledby="ep-recent" className="space-y-2">
              <h3 id="ep-recent" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('integrations.webhooks.recent')}</h3>
              {!attempts ? <SkeletonTable rows={2} /> : attempts.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('integrations.deliveries.empty')}</p> : (
                <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="endpoint-attempts">
                  {attempts.map(a => <li key={a.attemptNo + a.startedAt} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{eventDateTime(a.startedAt, 'Africa/Dar_es_Salaam', locale)}</span><span>{a.responseCode ?? '—'} · {t(`integrations.deliveries.outcome.${a.outcome}` as MessageKey)}</span></li>)}
                </ul>
              )}
            </section>
            <p className="text-xs text-[var(--color-fg-quaternary)]">{t('integrations.webhooks.signing')}</p>
          </>
        )}
      </div>
      <DialogFooter><Button variant="secondary" onClick={onClose}>{t('integrations.action.close')}</Button></DialogFooter>
    </Dialog>
  );
}
