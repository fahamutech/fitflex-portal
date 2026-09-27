'use client';
// WhatsApp, for FitFlex admins (the WhatsApp tab of /admin/communications):
// whether a provider is set up (never its credentials), the kill switch,
// who has opted in or out, the registry of provider-approved templates the
// FitFlex templates need, and a test send for going live.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  api, CommsLocale, WhatsAppApproval, WhatsAppExpected, WhatsAppRegistry, WhatsAppStatus,
} from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, MetricCard, Spinner } from './shared';
import { ConfirmDialog } from './dialog';
import { T, errorText, fill } from './communication-shared';

const APPROVALS: WhatsAppApproval[] = ['pending', 'approved', 'rejected', 'paused'];
const APPROVAL_TONE: Record<WhatsAppApproval, 'gray' | 'warning' | 'success' | 'danger'> = {
  pending: 'warning', approved: 'success', rejected: 'danger', paused: 'gray',
};

export function WhatsAppAdmin({ token, t }: { token: string; t: T }) {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [registry, setRegistry] = useState<WhatsAppRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.waStatus(token), api.waRegistry(token)]);
      setStatus(s); setRegistry(r); setError(null);
    } catch (e) { setError(errorText(t, e)); }
  }, [token, t]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); await load(); if (done) setNotice(done); } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); }
  }

  if (!status || !registry) return error ? <Alert tone="error">{error}</Alert> : <Spinner />;
  const configured = status.provider.configured;
  const setup = status.provider.setup;
  return (
    <div className="space-y-4" data-testid="wa-admin">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card className="space-y-3 p-4" data-testid="wa-status">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{t('comms.wa.provider')}</p>
          <Badge tone={status.available ? 'success' : configured ? 'warning' : 'gray'}>
            {t(status.available ? 'comms.wa.live' : configured ? 'comms.wa.paused' : 'comms.wa.notSetUp')}
          </Badge>
          <span className="flex-1" />
          <Button size="sm" variant="secondary" onClick={load} aria-label={t('comms.retry')}><RefreshCw className="h-4 w-4" /></Button>
        </div>
        {configured ? (
          <p className="text-sm">{fill(t('comms.wa.using'), { name: status.provider.name })}</p>
        ) : (
          <Alert tone="info">
            {t(`comms.wa.reason.${setup?.reason ?? 'no_provider'}`)}
            {setup?.missing?.length ? <span className="block text-xs">{fill(t('comms.wa.missing'), { names: setup.missing.join(', ') })}</span> : null}
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>{t('comms.wa.killSwitch')}</span>
          <Badge tone={status.enabled ? 'success' : 'danger'}>{t(status.enabled ? 'comms.wa.sendingOn' : 'comms.wa.sendingOff')}</Badge>
          {status.enabled
            ? <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmPause(true)} data-testid="wa-pause">{t('comms.wa.pause')}</Button>
            : <Button size="sm" disabled={busy} onClick={() => act(() => api.waSetEnabled(token, true), t('comms.wa.resumed'))} data-testid="wa-resume">{t('comms.wa.resume')}</Button>}
        </div>
        <p className="text-xs text-[var(--color-fg-quaternary)]">
          {t(status.webhook.secretSet ? 'comms.wa.webhookReady' : 'comms.wa.webhookMissing')} <code>{status.webhook.path}?token=…</code>
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label={t('comms.wa.withPhone')} value={status.members.withPhone} />
        <MetricCard label={t('comms.wa.optedIn')} value={status.members.marketingOptedIn} />
        <MetricCard label={t('comms.wa.optedOut')} value={status.members.optedOut} />
      </div>
      {Object.keys(status.last7Days).length > 0 && (
        <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="wa-last7">
          {t('comms.wa.last7')}: {Object.entries(status.last7Days).map(([s, n]) => `${t(`comms.msgStatus.${s}`)} ${n}`).join(' · ')}
        </p>
      )}

      <Card className="p-4" data-testid="wa-templates">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{t('comms.wa.templates')}</p>
          <span className="flex-1" />
          <Button size="sm" variant="secondary" disabled={!configured || busy} data-testid="wa-sync"
            onClick={() => act(async () => { const r = await api.waSync(token); setNotice(fill(t('comms.wa.synced'), { n: r.synced })); })}>
            {t('comms.wa.sync')}
          </Button>
        </div>
        <p className="mb-3 text-xs text-[var(--color-fg-quaternary)]">{t(configured ? 'comms.wa.templatesHelp' : 'comms.wa.templatesNeedProvider')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-fg-quaternary)]">
                <th className="py-2 pr-3">{t('comms.wa.col.template')}</th>
                <th className="py-2 pr-3">{t('comms.wa.col.providerName')}</th>
                <th className="py-2 pr-3">{t('comms.wa.col.variables')}</th>
                <th className="py-2">{t('comms.wa.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {registry.expected.map(e => (
                <ExpectedRow key={`${e.providerTemplateName}-${e.language}`} t={t} e={e} disabled={!configured || busy}
                  onRegister={() => act(() => api.waRegister(token, { providerTemplateName: e.providerTemplateName, language: e.language, category: e.category, variables: e.variables }))}
                  onStatus={s => act(() => api.waUpdate(token, e.registered!.id, { approvalStatus: s }))} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {configured && <TestSend t={t} registry={registry} disabled={busy || !status.available}
        onSend={(body) => act(() => api.waTest(token, body), t('comms.wa.testSent'))} />}

      <ConfirmDialog
        open={confirmPause}
        onClose={() => setConfirmPause(false)}
        title={t('comms.wa.pauseTitle')}
        description={t('comms.wa.pauseBody')}
        confirmLabel={t('comms.wa.pause')}
        cancelLabel={t('comms.keep')}
        busy={busy}
        onConfirm={() => act(async () => { await api.waSetEnabled(token, false); setConfirmPause(false); }, t('comms.wa.pausedNotice'))}
      />
    </div>
  );
}

function ExpectedRow({ t, e, disabled, onRegister, onStatus }: {
  t: T; e: WhatsAppExpected; disabled: boolean; onRegister: () => void; onStatus: (s: WhatsAppApproval) => void;
}) {
  return (
    <tr className="border-t border-[var(--color-border-secondary)] align-top" data-testid={`wa-row-${e.providerTemplateName}-${e.language}`}>
      <td className="py-2 pr-3">
        <span className="block font-medium">{t(`comms.tpl.${e.templateKey}`) || e.templateKey}</span>
        <span className="text-xs text-[var(--color-fg-quaternary)]">{t(`comms.lang.${e.language}`)} · {t(`comms.wa.cat.${e.category}`)}</span>
      </td>
      <td className="py-2 pr-3"><code className="text-xs">{e.providerTemplateName}</code></td>
      <td className="py-2 pr-3 text-xs">{e.variables.map((v, i) => `{{${i + 1}}} ${t(`comms.var.${v}`)}`).join(', ')}</td>
      <td className="py-2">
        {e.registered ? (
          <div className="flex items-center gap-2">
            <Badge tone={APPROVAL_TONE[e.registered.approvalStatus]}>{t(`comms.wa.approval.${e.registered.approvalStatus}`)}</Badge>
            <select className="ui-input h-8 py-0 text-xs" value={e.registered.approvalStatus} disabled={disabled}
              onChange={ev => onStatus(ev.target.value as WhatsAppApproval)} aria-label={t('comms.wa.col.status')}>
              {APPROVALS.map(s => <option key={s} value={s}>{t(`comms.wa.approval.${s}`)}</option>)}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Badge tone="gray">{t('comms.wa.notRegistered')}</Badge>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={onRegister}>{t('comms.wa.register')}</Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function TestSend({ t, registry, disabled, onSend }: {
  t: T; registry: WhatsAppRegistry; disabled: boolean;
  onSend: (body: { phone: string; templateName: string; language: CommsLocale; parameters: string[] }) => void;
}) {
  const approved = registry.expected.filter(e => e.registered?.approvalStatus === 'approved');
  const [phone, setPhone] = useState('');
  const [pick, setPick] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const chosen = approved.find(e => `${e.providerTemplateName}|${e.language}` === pick) ?? null;
  return (
    <Card className="space-y-3 p-4" data-testid="wa-test">
      <p className="text-sm font-semibold">{t('comms.wa.test')}</p>
      <p className="text-xs text-[var(--color-fg-quaternary)]">{t('comms.wa.testHelp')}</p>
      {!approved.length ? <p className="text-sm">{t('comms.wa.testNone')}</p> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('comms.wa.testPhone')}><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0712 345 678" data-testid="wa-test-phone" /></Field>
            <Field label={t('comms.wa.col.template')}>
              <select className="ui-input" value={pick} data-testid="wa-test-template"
                onChange={e => { setPick(e.target.value); setParams([]); }}>
                <option value="">—</option>
                {approved.map(e => <option key={`${e.providerTemplateName}|${e.language}`} value={`${e.providerTemplateName}|${e.language}`}>{e.providerTemplateName} ({e.language})</option>)}
              </select>
            </Field>
          </div>
          {chosen && (
            <div className="grid gap-3 sm:grid-cols-2">
              {chosen.variables.map((v, i) => (
                <Field key={v} label={`{{${i + 1}}} ${t(`comms.var.${v}`)}`}>
                  <Input value={params[i] ?? ''} maxLength={200} onChange={e => setParams(p => { const n = [...p]; n[i] = e.target.value; return n; })} />
                </Field>
              ))}
            </div>
          )}
          <Button disabled={disabled || !phone.trim() || !chosen} data-testid="wa-test-send"
            onClick={() => chosen && onSend({ phone: phone.trim(), templateName: chosen.providerTemplateName, language: chosen.language, parameters: chosen.variables.map((_, i) => params[i] ?? '') })}>
            {t('comms.wa.testSend')}
          </Button>
        </>
      )}
    </Card>
  );
}
