'use client';
// Automations (M9) in the owner's Communication Center: the gym's messages
// that send themselves — welcome, reminders before a membership ends, when
// it has ended, a failed payment, 14 days without a visit. Switch each on or
// off, choose channels and template, preview it, and see who it went to.

import { useCallback, useEffect, useState } from 'react';
import { api, CommsAutomation, CommsAutomationRun, CommsChannel, CommsTemplate, CommsTemplatePreview } from '@/lib/api';
import { Alert, Badge, Button, Card, Spinner } from './shared';
import { MessageCard, T, errorText, fill, when } from './communication-shared';
import { whyNot } from './communication-history';

const CHANNELS: CommsChannel[] = ['in_app', 'push', 'whatsapp'];

export function automationTitle(t: T, a: Pick<CommsAutomation, 'trigger' | 'offsetDays'>) {
  if (a.trigger === 'membership_expiring' && a.offsetDays === 1) return t('comms.auto.title.membership_expiring_1');
  return fill(t(`comms.auto.title.${a.trigger}`), { n: a.offsetDays });
}

const templateLabel = (t: T, a: CommsAutomation) =>
  (a.template?.system && a.template.key && t(`comms.tpl.${a.template.key}`)) || a.template?.name || '—';

function pausedText(t: T, a: CommsAutomation) {
  if (a.status !== 'paused') return null;
  const m = /^too_many_members:(\d+)$/.exec(a.pausedReason || '');
  return m ? fill(t('comms.auto.pausedTooMany'), { n: m[1] }) : t('comms.auto.pausedTemplate');
}

export function AutomationsTab({ token, t, gymId }: { token: string; t: T; gymId?: string }) {
  const [list, setList] = useState<CommsAutomation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.commsAutomations(token, gymId).then(r => { setList(r.automations); setError(null); }).catch(e => setError(errorText(t, e)));
  }, [token, gymId, t]);
  useEffect(() => { load(); }, [load]);

  async function update(a: CommsAutomation, body: Parameters<typeof api.commsAutomationUpdate>[2]) {
    setBusy(a.id); setError(null);
    try {
      const r = await api.commsAutomationUpdate(token, a.id, body);
      setList(l => l?.map(x => (x.id === a.id ? r.automation : x)) ?? null);
    } catch (e) {
      const code = (e as { body?: { error?: string } })?.body?.error;
      setError(code === 'template_needs_values' ? t('comms.auto.templateNeedsValues') : errorText(t, e));
    } finally { setBusy(null); }
  }

  if (!list) return error ? <Alert tone="error">{error}</Alert> : <Spinner />;
  return (
    <div className="space-y-3" data-testid="automations">
      <p className="text-sm text-[var(--color-fg-tertiary)]">{t('comms.auto.intro')}</p>
      {error && <Alert tone="error">{error}</Alert>}
      {list.map(a => {
        const key = `${a.trigger}-${a.offsetDays}`;
        const paused = pausedText(t, a);
        const expanded = open === a.id;
        return (
          <Card key={a.id} className="p-4" data-testid={`automation-${key}`}>
            <div className="flex items-start gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(expanded ? null : a.id)} data-testid={`automation-open-${key}`}>
                <p className="font-medium">{automationTitle(t, a)}</p>
                <p className="text-xs text-[var(--color-fg-quaternary)]">
                  {templateLabel(t, a)} · {a.channels.map(c => t(`comms.channel.${c}`)).join(', ')}
                  {a.stats && (a.stats.fired || a.stats.failed) ? ` · ${fill(t('comms.auto.sentTo'), { n: a.stats.fired })}` : ''}
                  {a.stats?.failed ? ` · ${fill(t('comms.history.failedN'), { n: a.stats.failed })}` : ''}
                </p>
              </button>
              <label className="flex items-center gap-2 text-sm">
                <Badge tone={a.status === 'enabled' ? 'success' : a.status === 'paused' ? 'warning' : 'gray'}>{t(`comms.auto.status.${a.status}`)}</Badge>
                <input type="checkbox" role="switch" aria-label={automationTitle(t, a)} checked={a.status === 'enabled'} disabled={busy === a.id}
                  onChange={e => update(a, { status: e.target.checked ? 'enabled' : 'disabled' })} data-testid={`automation-switch-${key}`} />
              </label>
            </div>
            {paused && <Alert tone="warning" className="mt-2">{paused}</Alert>}
            {expanded && <AutomationDetail token={token} t={t} a={a} gymId={gymId} busy={busy === a.id} onUpdate={body => update(a, body)} />}
          </Card>
        );
      })}
    </div>
  );
}

function AutomationDetail({ token, t, a, gymId, busy, onUpdate }: {
  token: string; t: T; a: CommsAutomation; gymId?: string; busy: boolean;
  onUpdate: (body: { channels?: CommsChannel[]; templateId?: string }) => void;
}) {
  const [preview, setPreview] = useState<CommsTemplatePreview | null>(null);
  const [runs, setRuns] = useState<CommsAutomationRun[] | null>(null);
  const [templates, setTemplates] = useState<CommsTemplate[]>([]);
  const [lang, setLang] = useState<'en' | 'sw'>('en');
  useEffect(() => {
    api.commsAutomationPreview(token, a.id).then(setPreview).catch(() => setPreview(null));
    api.commsAutomationRuns(token, a.id).then(r => setRuns(r.runs)).catch(() => setRuns([]));
  }, [token, a.id, a.template?.id]);
  useEffect(() => {
    api.commsTemplates(token, 'owner', { gymId }).then(r => setTemplates(r.templates)).catch(() => setTemplates([]));
  }, [token, gymId]);
  const shown = preview?.byLocale[lang] ?? (preview ? Object.values(preview.byLocale)[0] : undefined);
  return (
    <div className="mt-4 space-y-4 border-t border-[var(--color-border-secondary)] pt-4" data-testid="automation-detail">
      <p className="text-sm">{fill(t(`comms.auto.when.${a.trigger}`), { n: a.offsetDays })}</p>
      {a.trigger === 'membership_expiring' && <p className="text-xs text-[var(--color-fg-quaternary)]">{t('comms.auto.replacesPlatform')}</p>}
      <div>
        <p className="mb-1 text-sm font-semibold">{t('comms.auto.channels')}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {CHANNELS.map(c => (
            <label key={c} className="flex items-center gap-1.5">
              <input type="checkbox" disabled={busy || (a.channels.length === 1 && a.channels.includes(c))} checked={a.channels.includes(c)} data-testid={`automation-channel-${c}`}
                onChange={() => onUpdate({ channels: a.channels.includes(c) ? a.channels.filter(x => x !== c) : CHANNELS.filter(x => x === c || a.channels.includes(x)) })} />
              {t(`comms.channel.${c}`)}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">{t('comms.auto.channelsNote')}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('comms.auto.message')}</p>
          <select className="ui-input" value={a.template?.id ?? ''} disabled={busy} data-testid="automation-template"
            onChange={e => e.target.value && onUpdate({ templateId: e.target.value })}>
            {!templates.some(x => x.id === a.template?.id) && a.template && <option value={a.template.id}>{templateLabel(t, a)}</option>}
            {templates.map(x => <option key={x.id} value={x.id}>{(x.system && t(`comms.tpl.${x.key}`)) || x.name}</option>)}
          </select>
          {preview && Object.keys(preview.byLocale).length > 1 && (
            <div className="flex gap-2">
              {(Object.keys(preview.byLocale) as Array<'en' | 'sw'>).map(l => (
                <Button key={l} size="sm" variant={lang === l ? 'primary' : 'secondary'} onClick={() => setLang(l)}>{t(`comms.lang.${l}`)}</Button>
              ))}
            </div>
          )}
          {shown ? <MessageCard title={shown.in_app.title} body={shown.in_app.body} cta={shown.in_app.ctaLabel} /> : <Spinner />}
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">{t('comms.auto.recent')}</p>
          {!runs ? <Spinner /> : !runs.length ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('comms.auto.noneYet')}</p> : (
            <div className="space-y-2" data-testid="automation-runs">
              {runs.map(r => (
                <div key={r.id} className="text-sm">
                  <p className="font-medium">{r.memberName || t('comms.history.unknownMember')} <span className="text-xs font-normal text-[var(--color-fg-quaternary)]">{when(r.createdAt)}</span></p>
                  {r.channels.map(c => (
                    <p key={c.id} className="text-xs text-[var(--color-fg-tertiary)]">
                      {t(`comms.channel.${c.channel}`)} · {t(`comms.msgStatus.${c.status}`)}
                      {c.reason ? ` · ${whyNot(t, c.status === 'failed' ? { failureReason: c.reason, skipReason: null } : { failureReason: null, skipReason: c.reason })}` : ''}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
