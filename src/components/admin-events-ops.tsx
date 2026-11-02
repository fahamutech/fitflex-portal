'use client';
// Events S7 (spec §6.3, H17, AC-H17): the Operations tab on /admin/events. Four sections: Setup (read-only), Jobs (read-only), Organizer integrations and Event controls.
// Every action asks for a reason (10 to 300 characters, optional Swahili text for the organizer); the dangerous ones (revoke all clients, turn off all webhooks) also need
// the organizer's name typed. Nothing here changes a server flag: those are the owner's, in the server settings (the Setup card says so).
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AdminEventRow } from '@/lib/api';
import { adminS7Api, type HealthResponse, type OrganizerIntegrationRow } from '@/lib/events-s7-api';
import { eventDateTime, fmt, isFeatureOff } from '@/lib/events';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, Input, Select, SkeletonTable, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { ReasonTypedDialog } from '@/components/events-s7-dialogs';
import { useEventsOptions } from '@/components/events-options';
import { PageError } from '@/components/organizer/page-states';
import { useApp } from '../../app/providers';

type Action = 'apiOn' | 'apiOff' | 'revokeAll' | 'disableAll' | 'rate';
type OrgRow = OrganizerIntegrationRow & { clients?: Array<{ id: string; name?: string | null; ratePerMinute?: number | null }> };
const FEATURE: Record<Action, string> = { apiOn: 'API', apiOff: 'API', revokeAll: 'API', disableAll: 'webhooks', rate: 'API' };

export function AdminEventsOps() {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const options = useEventsOptions();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState<'ok' | 'error'>('ok');
  const [paused, setPaused] = useState<AdminEventRow[]>([]);
  const [act, setAct] = useState<{ action: Action; org: OrgRow } | null>(null);
  const [rate, setRate] = useState('');
  const [clientId, setClientId] = useState('');
  const seq = useRef(0);

  useEffect(() => { if (token) adminS7Api.health(token, { days: 1 }).then(setHealth).catch(() => setHealth(null)); }, [token]);
  useEffect(() => { if (token) api.adminEvents(token, { status: 'registration_closed', limit: 50 }).then(p => setPaused(p.items ?? [])).catch(() => setPaused([])); }, [token]);
  const loadOrgs = useCallback(async () => {
    if (!token) return;
    const n = ++seq.current;
    setState('ok');
    try { const p = await adminS7Api.organizers(token, { ...(q.trim() ? { q: q.trim() } : {}) }); if (n === seq.current) setOrgs((p.items ?? []) as OrgRow[]); }
    catch { if (n === seq.current) setState('error'); }
  }, [token, q]);
  useEffect(() => { const h = setTimeout(() => void loadOrgs(), q ? 250 : 0); return () => clearTimeout(h); }, [loadOrgs, q]);

  const flagChips: Array<[string, boolean]> = [
    ['registration', !!options?.registration], ['kit', !!options?.ops?.kit], ['kitOffline', !!options?.ops?.kitOffline], ['api', !!options?.ops?.api], ['webhooks', !!options?.ops?.webhooks],
    ['results', !!options?.results?.enabled], ['rewards', !!options?.results?.rewards], ['waitlist', !!options?.waitlist?.enabled], ['analytics', !!options?.analytics?.enabled],
  ];
  const columns: ColumnDef<OrgRow>[] = [
    { key: 'name', header: t('admin.events.ops.col.organizer'), cell: o => <span className="font-medium [overflow-wrap:anywhere]">{o.name}</span> },
    { key: 'status', header: t('admin.events.ops.col.status'), cell: o => (o.status === 'suspended' ? <Badge tone="danger">{t('admin.events.ops.suspended')}</Badge> : <Badge tone="success">{o.status}</Badge>) },
    { key: 'api', header: t('admin.events.ops.col.api'), cell: o => <Badge tone={o.apiAccessEnabled ? 'success' : 'gray'}>{t(o.apiAccessEnabled ? 'admin.events.health.on' : 'admin.events.health.off')}</Badge> },
    { key: 'clients', header: t('admin.events.ops.col.clients'), cell: o => o.activeClients },
    { key: 'endpoints', header: t('admin.events.ops.col.endpoints'), cell: o => o.activeEndpoints },
    ...((orgs ?? []).some(o => o.lastFailureAt) ? [{ key: 'lastFailureAt', header: t('admin.events.ops.col.lastFailure'), cell: (o: OrgRow) => (o.lastFailureAt ? eventDateTime(o.lastFailureAt, 'Africa/Dar_es_Salaam', locale) : '—') }] : []),
  ];
  const label = (a: Action): MessageKey => (a === 'apiOn' ? 'admin.events.ops.apiOn' : a === 'apiOff' ? 'admin.events.ops.apiOff' : a === 'revokeAll' ? 'admin.events.ops.revokeAll' : a === 'disableAll' ? 'admin.events.ops.disableAll' : 'admin.events.ops.rateAction');
  const dangerous = act?.action === 'revokeAll' || act?.action === 'disableAll';
  const rateNum = Number(rate);
  const rateOk = Number.isInteger(rateNum) && rateNum >= 1 && rateNum <= 600;
  const needsClient = act?.action === 'rate';
  const rateExtra = needsClient ? (
    <div className="space-y-3">
      {act!.org.clients && act!.org.clients.length > 0
        ? <Field label={t('admin.events.ops.client')} required><Select value={clientId} onChange={e => setClientId(e.target.value)} data-testid="ops-client">
            <option value="">—</option>{act!.org.clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.id}{c.ratePerMinute ? ` (${c.ratePerMinute})` : ''}</option>)}
          </Select></Field>
        : <Field label={t('admin.events.ops.client')} required><Input value={clientId} onChange={e => setClientId(e.target.value.trim())} className="font-mono" autoComplete="off" data-testid="ops-client" /></Field>}
      <Field label={t('admin.events.ops.rate')} error={rate && !rateOk ? t('admin.events.ops.rateRange') : undefined} required>
        <Input inputMode="numeric" value={rate} onChange={e => setRate(e.target.value.replace(/\D/g, ''))} data-testid="ops-rate" />
      </Field>
    </div>
  ) : null;

  async function run(r: { reason: string; reasonSw?: string; key: string }) {
    if (!token || !act) return;
    const base = { reason: r.reason }; // the contract takes a reason only on these routes (no Swahili text)
    const id = act.org.id;
    try {
      if (act.action === 'apiOn' || act.action === 'apiOff') { await adminS7Api.setApiAccess(token, id, { enabled: act.action === 'apiOn', ...base }, r.key); toast.success(t('admin.events.ops.result.api')); }
      else if (act.action === 'revokeAll') { const out = await adminS7Api.revokeAllClients(token, id, base, r.key); toast.success(fmt(t('admin.events.ops.result.revoked'), { n: Number(out.revoked ?? (out as { count?: number }).count ?? 0) })); }
      else if (act.action === 'disableAll') { const out = await adminS7Api.disableAllWebhooks(token, id, base, r.key); toast.success(fmt(t('admin.events.ops.result.disabled'), { n: Number(out.disabled ?? (out as { count?: number }).count ?? 0) })); }
      else { await adminS7Api.setClientRate(token, clientId, { rateLimitPerMinute: rateNum }, r.key); toast.success(t('admin.events.ops.result.rate')); }
    } catch (err) {
      // A 404 feature_disabled says which feature is off (AC-H17); the dialog keeps its inputs.
      if (isFeatureOff(err)) throw Object.assign(new Error('feature_off'), { featureOff: FEATURE[act.action] });
      throw err;
    }
    setAct(null); await loadOrgs();
  }

  return (
    <div className="space-y-4" data-testid="admin-ops">
      <Card data-testid="ops-setup"><CardHeader><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.health.group.setup')}</h2></CardHeader><CardContent className="space-y-3">
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('admin.events.ops.setupNote')}</p>
        <ul className="flex flex-wrap gap-2">{flagChips.map(([name, on]) => <li key={name}><Badge tone={on ? 'success' : 'gray'} dot>{name}: {t(on ? 'admin.events.health.on' : 'admin.events.health.off')}</Badge></li>)}</ul>
        {options?.payments?.blockedReason && <div data-testid="ops-payments-blocked"><Alert tone="warning">{t(`events.payments.blocked.${options.payments.blockedReason}` as MessageKey)}</Alert></div>}
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-[var(--color-fg-quaternary)]">{t('admin.events.health.setup.alerts')}</dt><dd>{t(health?.setup?.alertsConfigured ? 'admin.events.health.configured' : 'admin.events.health.notConfigured')}</dd></div>
          <div><dt className="text-[var(--color-fg-quaternary)]">{t('admin.events.health.setup.retention')}</dt><dd>{t(health?.setup?.retentionConfigured ? 'admin.events.health.configured' : 'admin.events.health.notConfigured')}</dd></div>
        </dl>
      </CardContent></Card>

      <Card data-testid="ops-jobs"><CardHeader><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.ops.jobs.title')}</h2></CardHeader><CardContent>
        {(health?.jobs ?? []).length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('admin.events.health.empty')}</p> : (
          <DataTable columns={[
            { key: 'name', header: t('admin.events.health.jobs.job'), cell: j => <span className="font-mono text-xs [overflow-wrap:anywhere]">{j.name}</span> },
            { key: 'schedule', header: t('admin.events.health.jobs.schedule'), cell: j => j.schedule ?? '—' },
            { key: 'lastRunAt', header: t('admin.events.health.jobs.lastRun'), cell: j => (j.lastRunAt ? eventDateTime(j.lastRunAt, 'Africa/Dar_es_Salaam', locale) : t('admin.events.health.jobs.never')) },
            { key: 'outcome', header: t('admin.events.health.jobs.outcome'), cell: j => <span className="inline-flex items-center gap-2">{j.outcome ?? '—'}{j.late && <Badge tone="warning">{t('admin.events.health.late')}</Badge>}</span> },
          ]} data={health!.jobs ?? []} keyFn={j => j.name} label={t('admin.events.ops.jobs.title')} dense />
        )}
      </CardContent></Card>

      <Card data-testid="ops-orgs"><CardHeader><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.ops.orgs.title')}</h2></CardHeader><CardContent className="space-y-3">
        <Field label={t('admin.events.ops.orgs.search')}><Input type="search" value={q} onChange={e => setQ(e.target.value)} data-testid="ops-search" /></Field>
        {state === 'error' ? <PageError onRetry={() => void loadOrgs()} /> : !orgs ? <div aria-busy="true"><SkeletonTable rows={3} /></div> : (
          <DataTable columns={columns} data={orgs} keyFn={o => o.id} label={t('admin.events.ops.orgs.title')} dense emptyState={t('admin.events.ops.orgs.empty')}
            actions={o => (
              <div className="flex flex-wrap justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setAct({ action: o.apiAccessEnabled ? 'apiOff' : 'apiOn', org: o })} aria-label={`${t(o.apiAccessEnabled ? 'admin.events.ops.apiOff' : 'admin.events.ops.apiOn')}: ${o.name}`} data-testid={`ops-api-${o.id}`}>{t(o.apiAccessEnabled ? 'admin.events.ops.apiOff' : 'admin.events.ops.apiOn')}</Button>
                <Button variant="ghost" size="sm" onClick={() => setAct({ action: 'revokeAll', org: o })} aria-label={`${t('admin.events.ops.revokeAll')}: ${o.name}`} data-testid={`ops-revoke-${o.id}`}>{t('admin.events.ops.revokeAll')}</Button>
                <Button variant="ghost" size="sm" onClick={() => setAct({ action: 'disableAll', org: o })} aria-label={`${t('admin.events.ops.disableAll')}: ${o.name}`} data-testid={`ops-webhooks-${o.id}`}>{t('admin.events.ops.disableAll')}</Button>
                <Button variant="ghost" size="sm" onClick={() => { setRate(''); setClientId(''); setAct({ action: 'rate', org: o }); }} aria-label={`${t('admin.events.ops.rateAction')}: ${o.name}`} data-testid={`ops-rate-${o.id}`}>{t('admin.events.ops.rateAction')}</Button>
              </div>
            )} />
        )}
      </CardContent></Card>

      <Card data-testid="ops-paused"><CardHeader><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.ops.pausedList')}</h2></CardHeader><CardContent>
        {paused.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('admin.events.ops.pausedList.none')}</p> : (
          <ul className="divide-y divide-[var(--color-border-secondary)]">{paused.map(e => <li key={e.id} className="flex min-h-11 items-center justify-between gap-2 py-1 text-sm"><span className="[overflow-wrap:anywhere]">{e.title}</span><Link href={`/admin/events?event=${encodeURIComponent(e.id)}`} className="text-[var(--color-brand-700)] underline">{t('events.list.open')}</Link></li>)}</ul>
        )}
      </CardContent></Card>

      <ReasonTypedDialog open={!!act} onClose={() => setAct(null)} title={act ? t(label(act.action)) : ''} confirmLabel={act ? t(label(act.action)) : ''} testId="ops-dialog" tone={dangerous ? 'danger' : 'primary'}
        body={act ? <strong className="[overflow-wrap:anywhere]">{act.org.name}</strong> : undefined} reasonLabel={t('admin.events.ops.reason')} noReason={needsClient}
        typed={dangerous && act ? [act.org.name] : undefined} typedLabel={t('admin.events.ops.typeName')} extra={rateExtra} extraValid={!needsClient || (rateOk && !!clientId)}
        errorText={err => { const f = (err as { featureOff?: string }).featureOff; return f ? fmt(t('admin.events.ops.featureOff'), { feature: f }) : null; }}
        onConfirm={run} />
    </div>
  );
}
