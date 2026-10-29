'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §5.1, §8.7): the API clients tab. Create with a scope
// picker, secret shown once, rotate with an overlap choice, revoke with the client's name typed. Owner may grant
// `webhooks:manage`; an admin may not (D38).
import { useCallback, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { api, type ApiClientDetail, type ApiClientRow, type ApiClientUsage, type ApiScope, type OrganizerEventRow } from '@/lib/api';
import { errorKey, eventDateTime, fmt, isFeatureOff, relativeTime } from '@/lib/events';
import { API_SCOPES, EXPIRING_SOON_DAYS, EXPIRY_DAYS, riskKey, scopeKey } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, Checkbox, EmptyState, Field, Input, Radio, Select, SkeletonTable, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { SecretOnceDialog } from '@/components/secret-once-dialog';
import { RotateDialog } from '@/components/organizer/integrations/rotate-dialog';
import { useApp } from '../../../../app/providers';

const daysLeft = (iso: string | null) => (iso ? Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000) : null);
const asRow = (d: ApiClientDetail): ApiClientRow & { usage?: ApiClientUsage } => ({ ...d.client, usage: d.usage });

export function ApiClientsTab({ role, readOnly, createRequest, onUnavailable }: { role: string | null; readOnly: boolean; createRequest: number; onUnavailable: () => void }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<ApiClientRow[] | null>(null);
  // D39: the server says whether this organisation may use the API at all; shown up front, not after a failed create.
  const [accessEnabled, setAccessEnabled] = useState(true);
  const [error, setError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<{ client: ApiClientRow; value: string } | null>(null);
  const [rotateFor, setRotateFor] = useState<ApiClientRow | null>(null);
  const [revokeFor, setRevokeFor] = useState<ApiClientRow | null>(null);
  const [detailFor, setDetailFor] = useState<ApiClientRow | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(false);
    try { const out = await api.apiClients(token); setRows(out.items ?? []); setAccessEnabled(out.accessEnabled !== false); }
    catch (err) { if (isFeatureOff(err)) onUnavailable(); else setError(true); }
  }, [token, onUnavailable]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (createRequest > 0 && !readOnly && accessEnabled) setCreateOpen(true); }, [createRequest, readOnly, accessEnabled]);

  if (error) return <Alert tone="error"><span className="flex flex-wrap items-center gap-3">{t('common.somethingWrong')}<Button size="sm" variant="secondary" onClick={() => void load()}>{t('common.tryAgain')}</Button></span></Alert>;
  if (!rows) return <div aria-busy="true"><SkeletonTable /></div>;

  const statusBadge = (r: ApiClientRow) => {
    if (r.status === 'revoked') return <Badge tone="gray">{t('integrations.clients.revoked')}</Badge>;
    if (r.status === 'expired') return <Badge tone="danger">{t('integrations.clients.expired')}</Badge>;
    if (r.rotation?.inGrace) return <Badge tone="info">{t('integrations.clients.rotating')}</Badge>;
    return <Badge tone="success">{t('integrations.clients.active')}</Badge>;
  };
  const columns: ColumnDef<ApiClientRow>[] = [
    { key: 'name', header: t('integrations.col.name'), sortable: true, cell: r => <span className="font-medium text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{r.name}</span> },
    { key: 'clientId', header: t('integrations.col.clientId'), cell: r => (
      <span className="inline-flex items-center gap-1">
        <code className="break-all text-xs" data-testid="client-id">{r.clientId}</code>
        <Button variant="ghost" size="sm" aria-label={t('integrations.action.copyId')} onClick={() => { void navigator.clipboard?.writeText(r.clientId).then(() => toast.success(t('integrations.action.copied'))).catch(() => undefined); }}><Copy aria-hidden="true" className="h-3.5 w-3.5" /></Button>
      </span>
    ) },
    { key: 'environment', header: t('integrations.col.environment'), cell: r => <Badge tone={r.environment === 'live' ? 'warning' : 'info'}>{t(r.environment === 'live' ? 'integrations.clients.live' : 'integrations.clients.test')}</Badge> },
    { key: 'scopes', header: t('integrations.col.scopes'), cell: r => (
      <span className="flex flex-wrap items-center gap-1">
        {r.scopes.slice(0, 2).map(s => <Badge key={s} tone="gray"><span className="font-mono text-[11px]">{s}</span></Badge>)}
        {r.scopes.length > 2 && <Badge tone="gray">{fmt(t('integrations.moreScopes'), { n: r.scopes.length - 2 })}</Badge>}
      </span>
    ) },
    { key: 'expiresAt', header: t('integrations.col.expires'), sortable: true, cell: r => {
      const d = daysLeft(r.expiresAt);
      if (r.status === 'expired' || (d != null && d <= 0)) return <Badge tone="danger">{t('integrations.clients.expired')}</Badge>;
      if (r.status === 'active' && d != null && d < EXPIRING_SOON_DAYS) return <Badge tone="warning" dot>{fmt(t('integrations.clients.expiresIn'), { days: d })}</Badge>;
      return r.expiresAt ? eventDateTime(r.expiresAt, 'Africa/Dar_es_Salaam', locale) : '—';
    } },
    { key: 'lastUsedAt', header: t('integrations.col.lastUsed'), cell: r => (r.lastUsedAt ? fmt(t('integrations.clients.lastUsed'), { time: relativeTime(r.lastUsedAt, locale) }) : t('integrations.clients.never')) },
    { key: 'status', header: t('integrations.col.status'), cell: statusBadge },
  ];

  return (
    <div className="space-y-4" data-testid="clients-tab">
      {!accessEnabled && <div data-testid="clients-not-enabled"><Alert tone="info">{t('integrations.clients.notEnabled')}</Alert></div>}
      {rows.length === 0 ? (
        <div data-testid="clients-empty"><EmptyState title={t('integrations.clients.empty')} action={!readOnly && accessEnabled ? <Button onClick={() => setCreateOpen(true)}>{t('integrations.clients.new')}</Button> : undefined} /></div>
      ) : (
        <Card><CardContent>
          <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('integrations.tab.clients')} dense pageSize={25} emptyState={t('integrations.clients.empty')}
            actions={r => (
              <>
                <Button variant="ghost" size="sm" onClick={() => setDetailFor(r)} data-testid={`client-details-${r.id}`}>{t('integrations.action.details')}</Button>
                {r.status === 'active' && !readOnly && <Button variant="ghost" size="sm" onClick={() => setRotateFor(r)} data-testid={`client-rotate-${r.id}`}>{t('integrations.action.rotate')}</Button>}
                {r.status === 'active' && !readOnly && <Button variant="ghost" size="sm" onClick={() => setRevokeFor(r)} data-testid={`client-revoke-${r.id}`}>{t('integrations.action.revoke')}</Button>}
              </>
            )} />
        </CardContent></Card>
      )}

      <CreateClientDialog open={createOpen} onClose={() => setCreateOpen(false)} owner={role === 'owner'}
        onCreated={(client, value) => { setCreateOpen(false); setSecret({ client, value }); void load(); }} />
      <SecretOnceDialog open={!!secret} onClose={() => setSecret(null)} secretLabel={t('integrations.secret.secret')} secret={secret?.value ?? ''} clientId={secret?.client.clientId} docsHref="/organizer/integrations?tab=docs" />
      <RotateDialog name={rotateFor?.name ?? null} onClose={() => setRotateFor(null)} rotate={async grace => {
        if (!token || !rotateFor) return;
        const out = await api.rotateApiClient(token, rotateFor.id, grace);
        setSecret({ client: out.client ?? rotateFor, value: out.clientSecret }); setRotateFor(null); void load();
      }} />
      <RevokeDialog client={revokeFor} onClose={() => setRevokeFor(null)} onRevoked={() => { setRevokeFor(null); toast.success(t('integrations.clients.revoked')); void load(); }} />
      <DetailsDialog client={detailFor} onClose={() => setDetailFor(null)} />
    </div>
  );
}

function CreateClientDialog({ open, onClose, owner, onCreated }: { open: boolean; onClose: () => void; owner: boolean; onCreated: (client: ApiClientRow, secret: string) => void }) {
  const { t, token } = useApp();
  const [name, setName] = useState('');
  const [env, setEnv] = useState<'sandbox' | 'live'>('sandbox');
  const [liveOk, setLiveOk] = useState(false);
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [allEvents, setAllEvents] = useState(true);
  const [events, setEvents] = useState<OrganizerEventRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<number>(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(''); setEnv('sandbox'); setLiveOk(false); setScopes([]); setAllEvents(true); setPicked([]); setExpiry(90); setError(null); setBusy(false);
  }, [open]);
  useEffect(() => {
    if (!open || !token || allEvents || events.length) return;
    api.organizerEvents(token, { limit: 50 }).then(p => setEvents(p.items ?? [])).catch(() => setEvents([]));
  }, [open, token, allEvents, events.length]);
  const pickEnv = (e: 'sandbox' | 'live') => { setEnv(e); if (e === 'sandbox') setScopes(cur => cur.filter(x => x !== 'webhooks:manage')); };
  const toggle = (s: ApiScope) => setScopes(cur => (cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]));
  const valid = name.trim().length >= 1 && name.trim().length <= 60 && scopes.length > 0 && (env === 'sandbox' || liveOk) && (allEvents || picked.length > 0);
  async function create() {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const out = await api.createApiClient(token, { name: name.trim(), environment: env, scopes, expiresInDays: expiry, ...(allEvents || env === 'sandbox' ? {} : { eventIds: picked }) });
      onCreated(out.client, out.clientSecret);
    } catch (err) {
      setError(errorKey(err));
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('integrations.clients.new')} size="lg">
      <div className="space-y-5" data-testid="client-dialog">
        {error && <div data-testid="client-error"><Alert tone="error">{t(error)}</Alert></div>}
        <Field label={t('integrations.clients.name')} required><Input value={name} maxLength={60} onChange={e => setName(e.target.value)} data-testid="client-name" /></Field>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-semibold text-[var(--color-fg-primary)]">{t('integrations.clients.environment')}</legend>
          <div className="min-h-11"><Radio name="clientEnv" label={t('integrations.clients.test')} checked={env === 'sandbox'} onChange={() => pickEnv('sandbox')} data-testid="client-env-sandbox" /></div>
          <div className="min-h-11"><Radio name="clientEnv" label={t('integrations.clients.live')} checked={env === 'live'} onChange={() => pickEnv('live')} data-testid="client-env-live" /></div>
          {env === 'live' && <Checkbox label={t('integrations.clients.live.warn')} checked={liveOk} onChange={e => setLiveOk(e.target.checked)} data-testid="client-live-ack" />}
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-semibold text-[var(--color-fg-primary)]">{t('integrations.clients.scopes')}</legend>
          {API_SCOPES.filter(({ scope }) => scope !== 'webhooks:manage' || (owner && env === 'live')).map(({ scope, risk, ownerOnly, comingSoon }) => {
            const disabled = !!comingSoon;
            return (
              <div key={scope} className="flex flex-wrap items-start justify-between gap-2" data-testid={`scope-row-${scope}`}>
                <Checkbox label={t(scopeKey(scope))} description={undefined} checked={scopes.includes(scope)} disabled={disabled} onChange={() => toggle(scope)} data-testid={`scope-${scope}`} />
                <Badge tone={risk === 'high' ? 'danger' : risk === 'write' ? 'warning' : 'gray'}>{t(riskKey(risk))}</Badge>
              </div>
            );
          })}
        </fieldset>
        {env === 'live' && (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-semibold text-[var(--color-fg-primary)]">{t('integrations.clients.events.label')}</legend>
            <div className="min-h-11"><Radio name="clientEvents" label={t('integrations.clients.events.all')} checked={allEvents} onChange={() => setAllEvents(true)} /></div>
            <div className="min-h-11"><Radio name="clientEvents" label={t('integrations.clients.events.selected')} checked={!allEvents} onChange={() => setAllEvents(false)} data-testid="client-events-selected" /></div>
            {!allEvents && events.map(e => <Checkbox key={e.id} label={e.title} checked={picked.includes(e.id)} onChange={() => setPicked(cur => (cur.includes(e.id) ? cur.filter(x => x !== e.id) : [...cur, e.id]))} />)}
          </fieldset>
        )}
        <Field label={t('integrations.clients.expiry')}>
          <Select value={String(expiry)} onChange={e => setExpiry(Number(e.target.value))} data-testid="client-expiry">
            {EXPIRY_DAYS.map(d => <option key={d} value={d}>{fmt(t('integrations.clients.expiry.days'), { days: d })}</option>)}
          </Select>
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('integrations.action.cancel')}</Button>
        <Button loading={busy} disabled={!valid} onClick={() => void create()} data-testid="client-create">{t('integrations.action.create')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

function RevokeDialog({ client, onClose, onRevoked }: { client: ApiClientRow | null; onClose: () => void; onRevoked: () => void }) {
  const { t, token } = useApp();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  useEffect(() => { if (client) { setTyped(''); setError(null); setBusy(false); } }, [client]);
  async function go() {
    if (!token || !client) return;
    setBusy(true); setError(null);
    try { await api.revokeApiClient(token, client.id); onRevoked(); }
    catch (err) { setError(errorKey(err)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={!!client} onClose={() => { if (!busy) onClose(); }} title={fmt(t('integrations.revoke.title'), { name: client?.name ?? '' })} description={t('integrations.revoke.body')} size="md">
      <div className="space-y-3" data-testid="revoke-dialog">
        {error && <Alert tone="error">{t(error)}</Alert>}
        <Field label={t('integrations.revoke.type')} required><Input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" data-testid="revoke-type" /></Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('integrations.action.cancel')}</Button>
        <Button variant="destructive" loading={busy} disabled={!client || typed.trim() !== client.name} onClick={() => void go()} data-testid="revoke-confirm">{t('integrations.action.revoke')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

function DetailsDialog({ client, onClose }: { client: ApiClientRow | null; onClose: () => void }) {
  const { t, token, locale } = useApp();
  const [detail, setDetail] = useState<(ApiClientRow & { usage?: ApiClientUsage }) | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setDetail(null); setFailed(false);
    if (!client || !token) return;
    let live = true;
    api.apiClient(token, client.id).then(d => { if (live) setDetail(asRow(d)); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [client, token]);
  const c = detail ?? client;
  const days = detail?.usage?.days ?? [];
  const max = Math.max(1, ...days.map(d => d.requests));
  return (
    <Dialog open={!!client} onClose={onClose} title={c?.name ?? ''} description={c?.clientId} size="lg">
      <div className="space-y-5" data-testid="client-details">
        {c?.rotation?.inGrace && c.rotation.graceEndsAt && <Alert tone="info">{fmt(t('integrations.clients.inGrace'), { time: eventDateTime(c.rotation.graceEndsAt, 'Africa/Dar_es_Salaam', locale) })}</Alert>}
        <ul className="flex flex-wrap gap-2">{(c?.scopes ?? []).map(s => <li key={s}><Badge tone="gray"><span className="font-mono text-[11px]">{s}</span></Badge></li>)}</ul>
        <section aria-labelledby="usage-h" className="space-y-2">
          <h3 id="usage-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('integrations.usage.title')}</h3>
          {failed ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('common.somethingWrong')}</p> : days.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('integrations.usage.none')}</p> : (
            <>
              <div className="flex h-16 items-end gap-0.5" aria-hidden="true">
                {days.map(d => <div key={d.day} className="flex-1 rounded-t bg-[var(--color-brand-500)]" style={{ height: `${Math.max(4, Math.round((d.requests / max) * 100))}%` }} />)}
              </div>
              <table className="ui-table w-full text-sm" data-testid="usage-table">
                <caption className="sr-only">{t('integrations.usage.title')}</caption>
                <thead><tr><th scope="col" className="text-left">{t('integrations.usage.day')}</th><th scope="col" className="text-right">{t('integrations.usage.requests')}</th><th scope="col" className="text-right">{t('integrations.usage.errors')}</th><th scope="col" className="text-right">{t('integrations.usage.limited')}</th></tr></thead>
                <tbody>{days.slice(-10).map(d => <tr key={d.day}><td>{d.day}</td><td className="text-right">{d.requests}</td><td className="text-right">{d.errors}</td><td className="text-right">{d.rateLimited}</td></tr>)}</tbody>
              </table>
            </>
          )}
        </section>
      </div>
      <DialogFooter><Button variant="secondary" onClick={onClose}>{t('integrations.action.close')}</Button></DialogFooter>
    </Dialog>
  );
}
