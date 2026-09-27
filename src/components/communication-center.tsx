'use client';
// Communication Center — shared by gym owners/staff (scope 'owner': their
// gym's direct members) and FitFlex admins (scope 'admin': every member,
// with area targeting). Overview, campaign list, the seven-step campaign
// flow and campaign detail, and message templates, all against the same
// backend endpoints.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Megaphone, Plus, RefreshCw, ArrowLeft, FileText } from 'lucide-react';
import { useApp } from '../../app/providers';
import {
  api, ApiError, CommsCampaign, CommsChannel, CommsContent, CommsDeepLink, CommsDraft, CommsLocale, CommsOverview, CommsStats,
  CommsPreview, CommsPurpose, CommsScope, CommsStatus, CommsTemplate, CommsText, Gym,
} from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, MetricCard, PageHeader, Segmented, Spinner } from './shared';
import { ConfirmDialog } from './dialog';
import {
  DEEP_LINKS, LOCALES, MessageCard, PURPOSES, PushCard, SENDER_VARIABLES, T, VARIABLES, errorText, fill, textOk,
  variablesIn, when,
} from './communication-shared';
import {
  BilingualText, TemplateDetail, TemplateEditor, TemplatePicker, TemplatesTab, contentFromTemplate,
} from './communication-templates';
import { WhatsAppAdmin } from './communication-whatsapp';
import { MemberTimeline, MessageLog, Recipients, StatsGrid } from './communication-history';

const TRANSACTIONAL: CommsPurpose[] = ['renewal', 'payment', 'announcement'];
const CHANNELS: CommsChannel[] = ['in_app', 'push', 'whatsapp'];
const STEPS = ['purpose', 'audience', 'message', 'channels', 'schedule', 'preview', 'confirm'] as const;
type Step = typeof STEPS[number];
const STATUS_TONE: Record<CommsStatus, 'gray' | 'warning' | 'brand' | 'success' | 'danger'> = {
  draft: 'gray', scheduled: 'warning', sending: 'brand', sent: 'success', partially_failed: 'warning', failed: 'danger', cancelled: 'gray',
};
const SKIP_REASONS = new Set([
  'in_app_marketing_off', 'push_marketing_off', 'whatsapp_marketing_not_opted_in', 'whatsapp_opted_out',
  'whatsapp_transactional_off', 'no_device', 'no_phone', 'push_disabled', 'whatsapp_not_configured', 'marketing_cap',
  'whatsapp_disabled', 'whatsapp_template_not_approved', 'invalid_phone',
]);

// ── audience conditions on top of a preset ──────────────────────────────────
type Refine = { expiresWithin?: number; noVisitFor?: number; plans: string[]; gender?: string; age?: [number, number | null]; area?: string };
const EMPTY_REFINE: Refine = { plans: [] };

function refineToFilter(r: Refine) {
  const all: unknown[] = [];
  if (r.expiresWithin != null) all.push({ field: 'daysUntilExpiry', op: 'between', value: [0, r.expiresWithin] });
  if (r.noVisitFor != null) {
    all.push({ any: [
      { field: 'lastVisitDaysAgo', op: 'gte', value: r.noVisitFor },
      { all: [{ field: 'lastVisitDaysAgo', op: 'exists', value: false }, { field: 'joinedDaysAgo', op: 'gte', value: r.noVisitFor }] },
    ] });
  }
  if (r.plans.length) all.push({ field: 'plan', op: 'in', value: [...r.plans].sort() });
  if (r.gender) all.push({ field: 'gender', op: 'eq', value: r.gender });
  if (r.age) all.push(r.age[1] == null ? { field: 'age', op: 'gte', value: r.age[0] } : { field: 'age', op: 'between', value: r.age });
  if (r.area?.trim()) all.push({ field: 'area', op: 'contains', value: r.area.trim() });
  return all.length ? { all } : undefined;
}

// ── entry ───────────────────────────────────────────────────────────────────
type View =
  | { kind: 'home'; tab?: string }
  | { kind: 'compose'; campaign?: CommsCampaign; templateId?: string }
  | { kind: 'detail'; id: string }
  | { kind: 'template'; id: string }
  | { kind: 'templateEdit'; id?: string }
  | { kind: 'member'; memberId: string; name: string | null; back: View };

export function CommunicationCenter({ scope }: { scope: CommsScope }) {
  const { token, t: translate, locale } = useApp();
  const t: T = useCallback((k: string) => translate(k as MessageKey), [translate]);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [gymId, setGymId] = useState<string | undefined>();
  const [gymsLoaded, setGymsLoaded] = useState(scope !== 'owner');

  useEffect(() => {
    if (!token || scope !== 'owner') return;
    api.ownerGyms(token)
      .then(g => { setGyms(g); setGymId(id => id ?? g[0]?.id); })
      .catch(() => setGyms([]))
      .finally(() => setGymsLoaded(true));
  }, [token, scope]);

  if (!token) return null;
  if (!gymsLoaded) return <Spinner />;
  if (scope === 'owner' && !gymId) {
    return <EmptyState title={t('comms.title')} body={t('comms.error.generic')} />;
  }
  const home = () => setView({ kind: 'home' });
  const templates = () => setView({ kind: 'home', tab: 'templates' });
  const openTemplate = (id: string) => setView({ kind: 'template', id });
  if (view.kind === 'compose') {
    return <Composer scope={scope} token={token} t={t} locale={locale} gymId={gymId} campaign={view.campaign}
      templateId={view.templateId} onClose={home} onDone={id => setView({ kind: 'detail', id })} />;
  }
  if (view.kind === 'template') {
    return <TemplateDetail key={view.id} scope={scope} token={token} t={t} gymId={gymId} id={view.id} onBack={templates}
      onUse={id => setView({ kind: 'compose', templateId: id })}
      onEdit={id => setView({ kind: 'templateEdit', id })}
      onCopied={id => setView({ kind: 'templateEdit', id })} />;
  }
  if (view.kind === 'templateEdit' && scope === 'owner') {
    return <TemplateEditor key={view.id ?? 'new'} token={token} t={t} gymId={gymId} id={view.id}
      onBack={view.id ? () => openTemplate(view.id!) : templates} onSaved={openTemplate} />;
  }
  // A member's messages, opened from the History tab or a campaign's recipients.
  const openMember = (memberId: string, name: string | null) => setView({ kind: 'member', memberId, name, back: view });
  if (view.kind === 'member') {
    return <MemberTimeline scope={scope} token={token} t={t} memberId={view.memberId} memberName={view.name}
      gymId={gymId} onBack={() => setView(view.back)} />;
  }
  if (view.kind === 'detail') {
    return <Detail scope={scope} token={token} t={t} id={view.id} onBack={home}
      onEdit={c => setView({ kind: 'compose', campaign: c })} onOpenMember={openMember} />;
  }
  return <Home scope={scope} token={token} t={t} gyms={gyms} gymId={gymId} setGymId={setGymId}
    initialTab={view.kind === 'home' ? view.tab : undefined}
    onOpenMember={(memberId, name) => setView({ kind: 'member', memberId, name, back: { kind: 'home', tab: 'history' } })}
    onNew={() => setView({ kind: 'compose' })} onOpen={id => setView({ kind: 'detail', id })}
    onOpenTemplate={openTemplate}
    onNewTemplate={scope === 'owner' ? () => setView({ kind: 'templateEdit' }) : undefined} />;
}

// ── home: overview + campaigns ─────────────────────────────────────────────
function Home({ scope, token, t, gyms, gymId, setGymId, initialTab, onNew, onOpen, onOpenTemplate, onNewTemplate, onOpenMember }: {
  scope: CommsScope; token: string; t: T; gyms: Gym[]; gymId?: string; setGymId: (id: string) => void;
  initialTab?: string; onNew: () => void; onOpen: (id: string) => void;
  onOpenTemplate: (id: string) => void; onNewTemplate?: () => void;
  onOpenMember: (memberId: string, name: string | null) => void;
}) {
  const [tab, setTab] = useState(initialTab ?? 'overview');
  const [overview, setOverview] = useState<CommsOverview | null>(null);
  const [campaigns, setCampaigns] = useState<CommsCampaign[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<CommsStatus | ''>('');
  // Campaign history filters beyond status.
  const [cf, setCf] = useState<{ purpose?: string; channel?: string; search?: string; from?: string; to?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const listQuery = useCallback((more?: string | null) => ({ gymId, status: status || undefined, ...cf, ...(more ? { cursor: more } : {}) }), [gymId, status, cf]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, list] = await Promise.all([
        api.commsOverview(token, scope, gymId),
        api.commsCampaigns(token, scope, listQuery()),
      ]);
      setOverview(o); setCampaigns(list.campaigns); setCursor(list.nextCursor ?? null); setError(null);
    } catch (e) { setError(errorText(t, e)); } finally { setLoading(false); }
  }, [token, scope, gymId, listQuery, t]);
  async function loadMore() {
    if (!cursor) return;
    try {
      const list = await api.commsCampaigns(token, scope, listQuery(cursor));
      setCampaigns(cs => [...cs, ...list.campaigns]); setCursor(list.nextCursor ?? null);
    } catch (e) { setError(errorText(t, e)); }
  }

  useEffect(() => { load(); }, [load]);

  const sent = overview ? (overview.campaigns.sent ?? 0) + (overview.campaigns.sending ?? 0) + (overview.campaigns.partially_failed ?? 0) : 0;
  return (
    <div data-testid="comms-home">
      <PageHeader
        title={t(scope === 'admin' ? 'comms.admin.title' : 'comms.title')}
        description={t(scope === 'admin' ? 'comms.admin.subtitle' : 'comms.subtitle')}
        actions={<>
          {gyms.length > 1 && (
            <select className="ui-input" aria-label={t('comms.gym')} value={gymId} onChange={e => setGymId(e.target.value)} data-testid="comms-gym">
              {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          <Button variant="secondary" onClick={load} aria-label={t('comms.retry')}><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={onNew} data-testid="comms-new"><Plus className="h-4 w-4" />{t('comms.new')}</Button>
        </>}
      />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <Segmented className="mb-4 w-fit" value={tab} onChange={setTab}
        options={[['overview', t('comms.tab.overview')], ['campaigns', t('comms.tab.campaigns')], ['templates', t('comms.tab.templates')],
          ['history', t('comms.tab.history')],
          ...(scope === 'admin' ? [['whatsapp', t('comms.tab.whatsapp')] as [string, string]] : [])]} />
      {tab === 'history' ? (
        <MessageLog scope={scope} token={token} t={t} gymId={gymId} onOpenMember={onOpenMember} />
      ) : tab === 'whatsapp' && scope === 'admin' ? (
        <WhatsAppAdmin token={token} t={t} />
      ) : tab === 'templates' ? (
        <TemplatesTab scope={scope} token={token} t={t} gymId={gymId} onOpen={onOpenTemplate} onNew={onNewTemplate} />
      ) : loading && !overview ? <Spinner /> : tab === 'overview' && overview ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label={t('comms.overview.members')} value={overview.members ?? '–'} />
            <MetricCard label={t('comms.overview.sent')} value={sent} />
            <MetricCard label={t('comms.overview.scheduled')} value={overview.campaigns.scheduled ?? 0} />
            <MetricCard label={t('comms.overview.drafts')} value={overview.campaigns.draft ?? 0} />
          </div>
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold">{t('comms.overview.channels')}</p>
            <div className="flex flex-wrap gap-3">
              {CHANNELS.map(ch => (
                <span key={ch} className="flex items-center gap-2 text-sm" data-testid={`channel-${ch}`}>
                  {t(`comms.channel.${ch}`)}
                  <Badge tone={overview.channels[ch] ? 'success' : 'gray'}>
                    {t(overview.channels[ch] ? 'comms.channel.on' : ch === 'whatsapp' ? 'comms.channel.soon' : 'comms.channel.off')}
                  </Badge>
                </span>
              ))}
            </div>
          </Card>
          <p className="text-sm font-semibold">{t('comms.overview.recent')}</p>
          <CampaignList t={t} campaigns={overview.recent} onOpen={onOpen} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(['', 'draft', 'scheduled', 'sending', 'sent', 'cancelled'] as const).map(s => (
              <Button key={s || 'all'} size="sm" variant={status === s ? 'primary' : 'secondary'} onClick={() => setStatus(s)} data-testid={`filter-${s || 'all'}`}>
                {s ? t(`comms.status.${s}`) : t('comms.filter.all')}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="campaign-filters">
            <Input placeholder={t('comms.history.searchCampaign')} defaultValue={cf.search ?? ''} data-testid="cf-search"
              onKeyDown={e => { if (e.key === 'Enter') setCf(f => ({ ...f, search: (e.target as HTMLInputElement).value.trim() || undefined })); }} />
            <select className="ui-input" value={cf.purpose ?? ''} onChange={e => setCf(f => ({ ...f, purpose: e.target.value || undefined }))} data-testid="cf-purpose" aria-label={t('comms.history.kind')}>
              <option value="">{t('comms.filter.allTypes')}</option>
              {PURPOSES.map(p => <option key={p} value={p}>{t(`comms.purpose.${p}`)}</option>)}
            </select>
            <select className="ui-input" value={cf.channel ?? ''} onChange={e => setCf(f => ({ ...f, channel: e.target.value || undefined }))} data-testid="cf-channel" aria-label={t('comms.history.channel')}>
              <option value="">{t('comms.filter.allChannels')}</option>
              {CHANNELS.map(c => <option key={c} value={c}>{t(`comms.channel.${c}`)}</option>)}
            </select>
            <Input type="date" value={cf.from ?? ''} aria-label={t('comms.history.from')} onChange={e => setCf(f => ({ ...f, from: e.target.value || undefined }))} data-testid="cf-from" />
            <Input type="date" value={cf.to ?? ''} aria-label={t('comms.history.to')} onChange={e => setCf(f => ({ ...f, to: e.target.value || undefined }))} data-testid="cf-to" />
          </div>
          <CampaignList t={t} campaigns={campaigns} onOpen={onOpen} />
          {cursor && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore} data-testid="campaigns-more">{t('comms.history.loadMore')}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CampaignList({ t, campaigns, onOpen }: { t: T; campaigns: CommsCampaign[]; onOpen: (id: string) => void }) {
  if (!campaigns.length) return <EmptyState title={t('comms.empty.title')} body={t('comms.empty.body')} />;
  return (
    <Card className="divide-y divide-[var(--color-border-secondary)]">
      {campaigns.map(c => (
        <button key={c.id} type="button" onClick={() => onOpen(c.id)} data-testid={`campaign-${c.id}`}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-bg-secondary)]">
          <Megaphone className="h-4 w-4 shrink-0 text-[var(--color-fg-quaternary)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{c.title || c.content?.title || t('comms.untitled')}</p>
            <p className="text-xs text-[var(--color-fg-quaternary)]">
              {[t(`comms.purpose.${c.purpose}`),
                c.status === 'scheduled' ? fill(t('comms.scheduledFor'), { when: when(c.scheduledAt) }) : when(c.createdAt),
                c.counts ? fill(t('comms.membersCount'), { n: c.stats?.targeted ?? c.counts.targeted }) : null].filter(Boolean).join(' · ')}
            </p>
            {c.stats && c.stats.totals.sent + c.stats.totals.failed > 0 && (
              <p className="text-xs text-[var(--color-fg-tertiary)]" data-testid={`campaign-stats-${c.id}`}>
                {[fill(t('comms.history.sentN'), { n: c.stats.totals.sent }), fill(t('comms.history.openedN'), { n: c.stats.totals.opened }),
                  c.stats.totals.failed ? fill(t('comms.history.failedN'), { n: c.stats.totals.failed }) : null].filter(Boolean).join(' · ')}
                {c.createdByName ? ` · ${fill(t('comms.history.createdBy'), { name: c.createdByName })}` : ''}
              </p>
            )}
          </div>
          <Badge tone={STATUS_TONE[c.status]} dot={c.status === 'sending'}>{t(`comms.status.${c.status}`)}</Badge>
        </button>
      ))}
    </Card>
  );
}

// ── composer ────────────────────────────────────────────────────────────────
function Composer({ scope, token, t, locale, gymId, campaign, templateId, onClose, onDone }: {
  scope: CommsScope; token: string; t: T; locale: CommsLocale; gymId?: string; campaign?: CommsCampaign;
  /** Start from this template (the "Use this template" button). */
  templateId?: string;
  onClose: () => void; onDone: (id: string) => void;
}) {
  const [step, setStep] = useState<Step>('purpose');
  const [purpose, setPurpose] = useState<CommsPurpose | undefined>(campaign?.purpose);
  const [preset, setPreset] = useState<string>(campaign?.audience?.preset ?? 'active');
  const [refine, setRefine] = useState<Refine>(EMPTY_REFINE);
  // A saved filter this form didn't build is kept untouched until cleared.
  const [savedFilter, setSavedFilter] = useState<unknown>(campaign?.audience?.filter);
  const [content, setContent] = useState<CommsContent>(campaign?.content
    ? { locale: 'en', ...campaign.content }
    : { title: '', body: '', deepLink: 'message', locale });
  const [tplId, setTplId] = useState<string | null>(campaign?.templateId ?? null);
  const [picking, setPicking] = useState(false);
  const [lang, setLang] = useState<CommsLocale>(content.locale ?? 'en');
  const [channels, setChannels] = useState<CommsChannel[]>(campaign?.channels?.length ? campaign.channels : ['in_app']);
  const [later, setLater] = useState(Boolean(campaign?.scheduledAt));
  const [scheduledAt, setScheduledAt] = useState<string>(campaign?.scheduledAt ? campaign.scheduledAt.slice(0, 16) : '');
  const [presets, setPresets] = useState<string[]>([]);
  const [available, setAvailable] = useState<Record<CommsChannel, boolean>>({ in_app: true, push: false, whatsapp: false });
  const [count, setCount] = useState<{ n: number; names: string[] } | null>(null);
  const [preview, setPreview] = useState<CommsPreview | null>(null);
  const [reach, setReach] = useState<CommsPreview | null>(null);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campaignId = useRef<string | undefined>(campaign?.id);
  const saved = useRef<string | undefined>(undefined);
  // One id per message: pressing Send again never sends twice.
  const sendRequestId = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  // State updates land on the next render, so a fast double-click could
  // start two saves; this ref stops the second one straight away.
  const inFlight = useRef(false);
  // WhatsApp only carries provider-approved templates: it can be picked only
  // when it's set up and the message started from a template approved for it.
  const [waReady, setWaReady] = useState(false);
  const usable = (ch: CommsChannel) => available[ch] && (ch !== 'whatsapp' || (Boolean(tplId) && waReady));

  function applyTemplate(tpl: CommsTemplate) {
    const next = contentFromTemplate(tpl, locale, content);
    const ready = Boolean(tpl.whatsapp?.ready);
    setWaReady(ready);
    if (!ready) setChannels(cs => cs.filter(c => c !== 'whatsapp'));
    setTplId(tpl.id);
    setContent(next);
    setPurpose(tpl.purpose);
    setLang(next.locale ?? 'en');
    setPicking(false);
  }

  // The template list doesn't say whether a template is approved for
  // WhatsApp; the template on its own does.
  function pickTemplate(tpl: CommsTemplate) {
    api.commsTemplate(token, scope, tpl.id).then(r => applyTemplate(r.template)).catch(() => applyTemplate(tpl));
  }

  function clearTemplate() {
    setTplId(null);
    setWaReady(false);
    setChannels(cs => cs.filter(c => c !== 'whatsapp'));
    setContent(c => ({ title: '', body: '', ctaLabel: '', deepLink: 'message', locale, translations: {},
      offerName: c.offerName, discount: c.discount, amountTzs: c.amountTzs }));
    setLang(locale);
  }

  useEffect(() => {
    if (templateId) {
      api.commsTemplate(token, scope, templateId).then(r => applyTemplate(r.template)).catch(e => setError(errorText(t, e)));
    } else if (campaign?.templateId) {
      // A draft started from a template: may it still go on WhatsApp?
      api.commsTemplate(token, scope, campaign.templateId)
        .then(r => { const ready = Boolean(r.template.whatsapp?.ready); setWaReady(ready); if (!ready) setChannels(cs => cs.filter(c => c !== 'whatsapp')); })
        .catch(() => setChannels(cs => cs.filter(c => c !== 'whatsapp')));
    }
  }, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.commsSegments(token, scope).then(c => setPresets(c.presets.map(p => p.key))).catch(() => setPresets([]));
    api.commsOverview(token, scope, gymId).then(o => setAvailable(o.channels)).catch(() => undefined);
  }, [token, scope, gymId]);

  const filter = savedFilter ?? refineToFilter(refine);
  const main: CommsLocale = content.locale ?? 'en';
  const texts: Partial<Record<CommsLocale, CommsText>> = {
    ...content.translations,
    [main]: { title: content.title, body: content.body, ctaLabel: content.ctaLabel },
  };
  const others = LOCALES.filter(l => l !== main);
  const draft: CommsDraft = useMemo(() => {
    const translations = Object.fromEntries(Object.entries(content.translations ?? {})
      .filter(([l, x]) => l !== main && x && (x.title.trim() || x.body.trim()))
      .map(([l, x]) => [l, { title: x!.title.trim(), body: x!.body.trim(), ...(x!.ctaLabel?.trim() ? { ctaLabel: x!.ctaLabel.trim() } : {}) }]));
    return {
      ...(scope === 'owner' && gymId ? { gymId } : {}),
      name: content.title.trim().slice(0, 80) || undefined,
      purpose,
      audience: { preset, ...(filter ? { filter } : {}) },
      content: {
        ...content,
        ctaLabel: content.ctaLabel?.trim() || undefined,
        offerName: content.offerName?.trim() || undefined,
        discount: content.discount?.trim() || undefined,
        translations: Object.keys(translations).length ? translations : undefined,
      },
      channels,
      templateId: tplId,
    };
  }, [scope, gymId, content, main, purpose, preset, filter, channels, tplId]);

  function setText(l: CommsLocale, x: CommsText) {
    setContent(c => l === (c.locale ?? 'en')
      ? { ...c, title: x.title, body: x.body, ctaLabel: x.ctaLabel }
      : { ...c, translations: { ...c.translations, [l]: x } });
  }
  function removeText(l: CommsLocale) {
    setContent(c => { const { [l]: _gone, ...rest } = c.translations ?? {}; return { ...c, translations: rest }; });
  }

  // Live "N members match" count.
  useEffect(() => {
    if (step !== 'audience') return;
    const timer = setTimeout(() => {
      api.commsAudiencePreview(token, scope, { gymId: scope === 'owner' ? gymId : undefined, preset, filter, purpose })
        .then(r => setCount({ n: r.count, names: r.sample.map(s => s.displayName || '').filter(Boolean) }))
        .catch(e => setError(errorText(t, e)));
    }, 400);
    return () => clearTimeout(timer);
  }, [step, token, scope, gymId, preset, JSON.stringify(filter), purpose]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setError(null);
    if (step === 'channels') {
      const all = CHANNELS.filter(usable);
      api.commsPreviewDraft(token, scope, { ...draft, channels: all }).then(setReach).catch(() => setReach(null));
    }
    if (step === 'preview') {
      setPreview(null);
      api.commsPreviewDraft(token, scope, draft).then(setPreview).catch(e => setError(errorText(t, e)));
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const used = variablesIn(Object.values(texts).map(x => `${x?.title} ${x?.body}`).join(' '));
  const unknown = used.filter(v => !VARIABLES.includes(v));
  const missing = [
    used.includes('offer_name') && !content.offerName?.trim() ? 'offer_name' : null,
    used.includes('discount') && !content.discount?.trim() ? 'discount' : null,
    used.includes('amount') && content.amountTzs == null ? 'amount' : null,
  ].filter(Boolean) as string[];
  const tooSoon = later && (!scheduledAt || new Date(scheduledAt).getTime() < Date.now() + 5 * 60_000);
  const largeSend = needsConfirm || (preview ? preview.counts.targeted >= preview.largeSendThreshold : false);

  const canContinue: Record<Step, boolean> = {
    purpose: Boolean(purpose),
    audience: (count?.n ?? 0) > 0,
    message: textOk(texts[main], true) && others.every(l => textOk(texts[l], false)) && !unknown.length && !missing.length,
    channels: channels.length > 0,
    schedule: !tooSoon,
    preview: Boolean(preview) && !preview!.warnings.some(w => w.code === 'nobody_reachable'),
    confirm: !busy && (!largeSend || confirmLarge),
  };
  const index = STEPS.indexOf(step);

  async function saveDraft() {
    const snapshot = JSON.stringify(draft);
    if (!campaignId.current) {
      campaignId.current = (await api.commsCreate(token, scope, draft)).campaign.id;
    } else if (snapshot !== saved.current) {
      const { gymId: _ignored, ...patch } = draft;
      await api.commsUpdate(token, scope, campaignId.current, patch);
    }
    saved.current = snapshot;
    return campaignId.current!;
  }

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      const id = await saveDraft();
      if (later) await api.commsSchedule(token, scope, id, new Date(scheduledAt).toISOString(), confirmLarge);
      else await api.commsSend(token, scope, id, sendRequestId.current, confirmLarge);
      onDone(id);
    } catch (e) {
      if (e instanceof ApiError && (e.body as any)?.error === 'confirm_large_send') setNeedsConfirm(true);
      setError(errorText(t, e));
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function onSaveDraft() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try { onDone(await saveDraft()); } catch (e) { setError(errorText(t, e)); } finally { inFlight.current = false; setBusy(false); }
  }

  const setR = (patch: Partial<Refine>) => { setSavedFilter(undefined); setRefine(r => ({ ...r, ...patch })); };
  const chip = (active: boolean) => (active ? 'primary' : 'secondary') as 'primary' | 'secondary';
  const targeted = preview?.counts.targeted ?? count?.n ?? 0;

  return (
    <div data-testid="comms-composer">
      <PageHeader
        title={t(`comms.step.${step}`)}
        description={fill(t('comms.stepOf'), { n: index + 1, total: STEPS.length })}
        actions={<Button variant="secondary" onClick={onClose}><ArrowLeft className="h-4 w-4" />{t('comms.backToList')}</Button>}
      />
      <div className="mb-4 h-1 w-full rounded bg-[var(--color-bg-tertiary)]">
        <div className="h-1 rounded bg-[var(--color-brand-500)]" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
      </div>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      <Card className="p-5 space-y-4">
        {step === 'purpose' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {PURPOSES.map(p => (
              <button key={p} type="button" onClick={() => setPurpose(p)} data-testid={`purpose-${p}`}
                className={`rounded-[var(--radius-lg)] border p-4 text-left ${purpose === p ? 'border-[var(--color-brand-500)] ring-1 ring-[var(--color-brand-500)]' : 'border-[var(--color-border-secondary)]'}`}>
                <p className="text-sm font-semibold">{t(`comms.purpose.${p}`)}</p>
                <p className="text-xs text-[var(--color-fg-quaternary)]">{t(`comms.purpose.${p}.body`)}</p>
              </button>
            ))}
          </div>
        )}

        {step === 'audience' && (
          <>
            <div data-testid="audience-count"><Alert tone="info">
              {count == null ? '…' : count.n === 0 ? t('comms.audience.none')
                : fill(t(count.n === 1 ? 'comms.audience.matchOne' : 'comms.audience.match'), { n: count.n })}
              {count && count.names.length > 0 && <span className="block text-xs font-normal">{fill(t('comms.audience.forExample'), { names: count.names.slice(0, 3).join(', ') })}</span>}
            </Alert></div>
            <Field label={t('comms.audience.who')} hint={presets.includes(preset) ? t(scope === 'admin' && preset === 'all' ? 'comms.admin.all.body' : `comms.preset.${preset}.body`) : undefined}>
              <div className="flex flex-wrap gap-2">
                {presets.map(p => <Button key={p} size="sm" variant={chip(preset === p)} onClick={() => setPreset(p)} data-testid={`preset-${p}`}>{t(`comms.preset.${p}`)}</Button>)}
              </div>
            </Field>
            <p className="text-sm font-semibold">{t('comms.audience.narrow')}</p>
            {savedFilter ? (
              <Alert tone="info">{t('comms.audience.customSetElsewhere')} <button type="button" className="underline" onClick={() => setSavedFilter(undefined)}>{t('comms.audience.clearCustom')}</button></Alert>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('comms.audience.expiresWithin')}>
                  <select className="ui-input" value={refine.expiresWithin ?? ''} onChange={e => setR({ expiresWithin: e.target.value ? Number(e.target.value) : undefined })} data-testid="refine-expires">
                    <option value="">—</option>{[3, 7, 14, 30].map(d => <option key={d} value={d}>{fill(t('comms.days'), { n: d })}</option>)}
                  </select>
                </Field>
                <Field label={t('comms.audience.noVisitFor')}>
                  <select className="ui-input" value={refine.noVisitFor ?? ''} onChange={e => setR({ noVisitFor: e.target.value ? Number(e.target.value) : undefined })} data-testid="refine-novisit">
                    <option value="">—</option>{[7, 14, 30, 60].map(d => <option key={d} value={d}>{fill(t('comms.days'), { n: d })}</option>)}
                  </select>
                </Field>
                <Field label={t('comms.audience.plan')}>
                  <div className="flex gap-3 text-sm">
                    {['daily', 'weekly', 'monthly'].map(p => (
                      <label key={p} className="flex items-center gap-1.5">
                        <input type="checkbox" checked={refine.plans.includes(p)}
                          onChange={() => setR({ plans: refine.plans.includes(p) ? refine.plans.filter(x => x !== p) : [...refine.plans, p] })} />
                        {t(`comms.plan.${p}`)}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label={t('comms.audience.gender')} hint={t('comms.audience.demographicsNote')}>
                  <select className="ui-input" value={refine.gender ?? ''} onChange={e => setR({ gender: e.target.value || undefined })}>
                    <option value="">—</option><option value="female">{t('comms.gender.female')}</option><option value="male">{t('comms.gender.male')}</option>
                  </select>
                </Field>
                <Field label={t('comms.audience.age')}>
                  <select className="ui-input" value={refine.age ? refine.age.join('-') : ''}
                    onChange={e => { const [a, b] = e.target.value.split('-'); setR({ age: e.target.value ? [Number(a), b ? Number(b) : null] : undefined }); }}>
                    <option value="">—</option>
                    {[[18, 25], [26, 35], [36, 50], [51, null]].map(([a, b]) => <option key={a} value={b == null ? `${a}` : `${a}-${b}`}>{b == null ? `${a}+` : `${a}–${b}`}</option>)}
                  </select>
                </Field>
                {scope === 'admin' && (
                  <Field label={t('comms.audience.area')} hint={t('comms.audience.areaHint')}>
                    <Input value={refine.area ?? ''} onChange={e => setR({ area: e.target.value })} placeholder="Arusha" data-testid="refine-area" />
                  </Field>
                )}
              </div>
            )}
          </>
        )}

        {step === 'message' && (
          <>
            {tplId ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="msg-template">
                <FileText className="h-4 w-4 text-[var(--color-brand-600)]" />
                <span className="flex-1">{t('comms.tpl.using')}</span>
                <Button size="sm" variant="secondary" onClick={() => setPicking(true)} data-testid="msg-change-template">{t('comms.tpl.change')}</Button>
                <Button size="sm" variant="ghost" onClick={clearTemplate} data-testid="msg-clear-template">{t('comms.tpl.blank')}</Button>
              </div>
            ) : (
              <button type="button" onClick={() => setPicking(true)} data-testid="msg-pick-template"
                className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-primary)] p-3 text-left hover:bg-[var(--color-bg-secondary)]">
                <FileText className="h-4 w-4 text-[var(--color-brand-600)]" />
                <span>
                  <span className="block text-sm font-medium">{t('comms.tpl.start')}</span>
                  <span className="block text-xs text-[var(--color-fg-quaternary)]">{t('comms.tpl.startBody')}</span>
                </span>
              </button>
            )}
            <BilingualText t={t} texts={texts} main={main} lang={lang} setLang={setLang} onChange={setText} onRemove={removeText} />
            {unknown.length > 0 && <Alert tone="error">{t('comms.msg.unknownVariable').replace('{name}', unknown[0])}</Alert>}
            {(purpose === 'promotion' || used.some(v => SENDER_VARIABLES.includes(v))) && (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-fg-quaternary)]">{t('comms.msg.offerBothLangs')}</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t('comms.var.offer_name')}><Input value={content.offerName ?? ''} onChange={e => setContent(c => ({ ...c, offerName: e.target.value }))} data-testid="msg-offer" /></Field>
                  <Field label={t('comms.var.discount')}><Input value={content.discount ?? ''} placeholder={t('comms.msg.discountHint')} onChange={e => setContent(c => ({ ...c, discount: e.target.value }))} data-testid="msg-discount" /></Field>
                  <Field label={t('comms.msg.amountTzs')}><Input inputMode="numeric" value={content.amountTzs ?? ''} onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); setContent(c => ({ ...c, amountTzs: Number.isNaN(n) ? undefined : n })); }} /></Field>
                </div>
              </div>
            )}
            {missing.length > 0 && <Alert tone="warning">{fill(t('comms.msg.fillIn'), { names: missing.map(v => t(`comms.var.${v}`)).join(', ') })}</Alert>}
            <Field label={t('comms.msg.opens')}>
              <select className="ui-input" value={content.deepLink ?? 'message'} onChange={e => setContent(c => ({ ...c, deepLink: e.target.value as CommsDeepLink }))} data-testid="msg-link">
                {DEEP_LINKS.map(d => <option key={d} value={d}>{t(`comms.link.${d}`)}</option>)}
              </select>
            </Field>
            <TemplatePicker open={picking} onClose={() => setPicking(false)} scope={scope} token={token} t={t}
              gymId={gymId} purpose={purpose} onPick={pickTemplate} />
          </>
        )}

        {step === 'channels' && (
          <div className="space-y-3">
            {CHANNELS.map(ch => {
              const on = usable(ch);
              const reached = reach?.counts.byChannel[ch]?.queued;
              return (
                <label key={ch} className={`flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 ${on ? '' : 'opacity-60'}`}>
                  <input type="checkbox" disabled={!on} checked={on && channels.includes(ch)} data-testid={`channel-${ch}`}
                    onChange={() => setChannels(cs => cs.includes(ch) ? cs.filter(c => c !== ch) : [...cs, ch])} />
                  <span>
                    <span className="block text-sm font-medium">{t(`comms.channel.${ch}`)}</span>
                    <span className="block text-xs text-[var(--color-fg-quaternary)]">
                      {!on ? t(ch !== 'whatsapp' ? 'comms.channel.pushOff' : available.whatsapp ? 'comms.channel.whatsappNeedsTemplate' : 'comms.channel.whatsappSoon')
                        : reached != null && reach ? fill(t('comms.channel.reaches'), { n: reached, total: reach.counts.targeted })
                        : t(`comms.channel.${ch}.body`)}
                    </span>
                  </span>
                </label>
              );
            })}
            {reach && Object.keys(reach.counts.skipped).length > 0 && (
              <p className="text-xs text-[var(--color-fg-quaternary)]">
                {Object.entries(reach.counts.skipped).map(([r, n]) => `${SKIP_REASONS.has(r) ? t(`comms.skip.${r}`) : r}: ${n}`).join(' · ')}
              </p>
            )}
          </div>
        )}

        {step === 'schedule' && (
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={!later} onChange={() => setLater(false)} data-testid="send-now" />{t('comms.schedule.now')}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={later} onChange={() => setLater(true)} data-testid="send-later" />{t('comms.schedule.later')}</label>
            {later && (
              <Field label={t('comms.schedule.pick')} error={tooSoon ? t('comms.schedule.tooSoon') : undefined}>
                <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} data-testid="schedule-at" />
              </Field>
            )}
          </div>
        )}

        {step === 'preview' && (!preview ? <Spinner /> : (
          <div className="space-y-4">
            <Warnings t={t} warnings={preview.warnings} />
            {preview.example ? (
              <>
                {preview.example.memberName && <p className="text-xs text-[var(--color-fg-quaternary)]">{fill(t('comms.preview.asSeenBy'), { name: preview.example.memberName })}</p>}
                {channels.includes('push') && (
                  <div data-testid="preview-push">
                    <p className="mb-1 text-xs font-semibold">{t('comms.channel.push')}</p>
                    <PushCard sender="FitFlex" title={preview.example.title} body={preview.example.body} />
                  </div>
                )}
                {channels.includes('in_app') && (
                  <div data-testid="preview-in-app">
                    <p className="mb-1 text-xs font-semibold">{t('comms.channel.in_app')}</p>
                    <MessageCard title={preview.example.title} body={preview.example.body} cta={preview.example.ctaLabel} />
                  </div>
                )}
              </>
            ) : <p className="text-sm">{t('comms.preview.none')}</p>}
          </div>
        ))}

        {step === 'confirm' && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <Summary label={t('comms.confirm.audience')} value={`${t(`comms.preset.${preset}`)} · ${fill(t(targeted === 1 ? 'comms.audience.matchOne' : 'comms.audience.match'), { n: targeted })}`} />
              {channels.map(ch => <Summary key={ch} label={t(`comms.channel.${ch}`)} value={fill(t('comms.channel.reaches'), { n: preview?.counts.byChannel[ch]?.queued ?? '–', total: targeted })} />)}
              <Summary label={t('comms.msg.title')} value={content.title} />
              <Summary label={t('comms.confirm.when')} value={later ? when(new Date(scheduledAt).toISOString()) : t('comms.schedule.now')} />
              <Summary label={t('comms.confirm.type')} value={t(purpose && TRANSACTIONAL.includes(purpose) ? 'comms.category.transactional' : 'comms.category.marketing')} />
            </dl>
            {preview && <Warnings t={t} warnings={preview.warnings.filter(w => w.code !== 'large_send')} />}
            {largeSend && (
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={confirmLarge} onChange={e => setConfirmLarge(e.target.checked)} data-testid="confirm-large" />
                {fill(t('comms.confirm.large'), { n: targeted })}
              </label>
            )}
            <p className="text-xs text-[var(--color-fg-quaternary)]">{t('comms.confirm.note')}</p>
          </div>
        )}
      </Card>

      <div className="mt-4 flex items-center gap-2">
        {index > 0 && <Button variant="secondary" disabled={busy} onClick={() => setStep(STEPS[index - 1])} data-testid="comms-back">{t('comms.back')}</Button>}
        <span className="flex-1" />
        {step === 'confirm' ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={onSaveDraft} data-testid="comms-save-draft">{t('comms.saveDraft')}</Button>
            <Button disabled={!canContinue.confirm} onClick={submit} data-testid="comms-submit">
              {busy ? <Spinner className="h-4 w-4" /> : t(later ? 'comms.scheduleCampaign' : 'comms.sendCampaign')}
            </Button>
          </>
        ) : (
          <Button disabled={!canContinue[step]} onClick={() => setStep(STEPS[index + 1])} data-testid="comms-next">{t('comms.next')}</Button>
        )}
      </div>
    </div>
  );
}

function Warnings({ t, warnings }: { t: T; warnings: CommsPreview['warnings'] }) {
  return (
    <>
      {warnings.map(w => (
        <Alert key={`${w.code}-${w.channel ?? ''}`} tone={w.code === 'nobody_reachable' ? 'error' : 'warning'}>
          {fill(t(`comms.warn.${w.code}`), { n: w.count ?? '', channel: w.channel ? t(`comms.channel.${w.channel}`) : '' })}
        </Alert>
      ))}
    </>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-fg-quaternary)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

// ── detail ──────────────────────────────────────────────────────────────────
function Detail({ scope, token, t, id, onBack, onEdit, onOpenMember }: {
  scope: CommsScope; token: string; t: T; id: string; onBack: () => void; onEdit: (c: CommsCampaign) => void;
  onOpenMember: (memberId: string, name: string | null) => void;
}) {
  const [data, setData] = useState<{ campaign: CommsCampaign; progress: Record<string, Record<string, number>>; stats: CommsStats | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null);

  const load = useCallback(() => {
    api.commsCampaign(token, scope, id).then(d => { setData(d); setError(null); }).catch(e => setError(errorText(t, e)));
  }, [token, scope, id, t]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    try { await fn(); after ? after() : load(); } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); setConfirm(null); }
  }

  const back = <Button variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" />{t('comms.backToList')}</Button>;
  if (!data) return <div><PageHeader title={t('comms.detail.title')} actions={back} />{error ? <Alert tone="error">{error}</Alert> : <Spinner />}</div>;
  const c = data.campaign;
  const delivered = !['draft', 'scheduled', 'cancelled'].includes(c.status);
  return (
    <div data-testid="comms-detail">
      <PageHeader title={c.content?.title || t('comms.untitled')} description={[t(`comms.purpose.${c.purpose}`), c.status === 'scheduled' ? fill(t('comms.scheduledFor'), { when: when(c.scheduledAt) }) : when(c.createdAt)].join(' · ')} actions={back} />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[c.status]} dot={c.status === 'sending'}>{t(`comms.status.${c.status}`)}</Badge>
        {c.status === 'sending' && <span className="text-sm text-[var(--color-fg-quaternary)]">{t('comms.detail.sending')}</span>}
        {(c.createdByName || c.template) && (
          <span className="text-xs text-[var(--color-fg-quaternary)]" data-testid="detail-origin">
            {[c.createdByName ? fill(t('comms.history.createdBy'), { name: c.createdByName }) : null,
              c.template ? fill(t('comms.history.fromTemplate'), { name: (c.template.system && t(`comms.tpl.${c.template.key}`)) || c.template.name }) : null,
              c.sentAt ? `${t('comms.history.at.sent')} ${when(c.sentAt)}` : null].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      {delivered && data.stats && <Card className="mb-4 p-4"><StatsGrid t={t} stats={data.stats} /></Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-2">
          <p className="text-sm font-semibold">{t('comms.detail.audience')}</p>
          <p className="text-sm">{t(`comms.preset.${c.audience?.preset ?? 'all'}`)}{c.audience?.filter ? ` · ${t('comms.detail.withConditions')}` : ''}</p>
          {c.counts && <p className="text-sm">{fill(t(c.counts.targeted === 1 ? 'comms.audience.matchOne' : 'comms.audience.match'), { n: c.counts.targeted })}</p>}
          <p className="text-xs text-[var(--color-fg-quaternary)]">{c.channels.map(ch => t(`comms.channel.${ch}`)).join(' · ')}</p>
        </Card>
        <div>
          <p className="mb-2 text-sm font-semibold">{t('comms.detail.message')}</p>
          <MessageCard title={c.content?.title ?? ''} body={c.content?.body ?? ''} cta={c.content?.ctaLabel} />
          {c.content && variablesIn(`${c.content.title} ${c.content.body}`).length > 0 && <p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">{t('comms.detail.personalised')}</p>}
        </div>
      </div>
      {delivered && (
        <Card className="mt-4 p-4" data-testid="delivery">
          <p className="mb-2 text-sm font-semibold">{t('comms.detail.delivery')}</p>
          {Object.keys(data.progress).length === 0 ? <p className="text-sm">{t('comms.detail.noDeliveries')}</p> : (
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(data.progress).map(([ch, counts]) => (
                  <tr key={ch} className="border-t border-[var(--color-border-secondary)]">
                    <td className="py-2 font-medium">{t(`comms.channel.${ch}`)}</td>
                    <td className="py-2">{Object.entries(counts).map(([s, n]) => `${t(`comms.msgStatus.${s}`)} ${n}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {c.counts && Object.keys(c.counts.skipped).length > 0 && (
            <div className="mt-3 text-xs text-[var(--color-fg-quaternary)]">
              <p className="font-semibold">{t('comms.detail.whySkipped')}</p>
              {Object.entries(c.counts.skipped).map(([r, n]) => <p key={r}>{SKIP_REASONS.has(r) ? t(`comms.skip.${r}`) : r}: {n}</p>)}
            </div>
          )}
        </Card>
      )}
      {delivered && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">{t('comms.history.recipientsTitle')}</p>
          <Recipients scope={scope} token={token} t={t} campaignId={c.id} onOpenMember={onOpenMember} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {c.status === 'draft' && <>
          <Button disabled={busy} onClick={() => onEdit(c)} data-testid="detail-edit">{t('comms.detail.edit')}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirm('delete')} data-testid="detail-delete">{t('comms.detail.delete')}</Button>
        </>}
        {c.status === 'scheduled' && <>
          <Button variant="secondary" disabled={busy} onClick={() => act(() => api.commsAction(token, scope, c.id, 'unschedule'))} data-testid="detail-unschedule">{t('comms.detail.unschedule')}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirm('cancel')} data-testid="detail-cancel">{t('comms.detail.cancel')}</Button>
        </>}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t(confirm === 'delete' ? 'comms.delete.title' : 'comms.cancel.title')}
        description={t(confirm === 'delete' ? 'comms.delete.body' : 'comms.cancel.body')}
        confirmLabel={t('comms.yes')}
        cancelLabel={t('comms.keep')}
        busy={busy}
        onConfirm={() => confirm === 'delete'
          ? act(() => api.commsDelete(token, scope, c.id), onBack)
          : act(() => api.commsAction(token, scope, c.id, 'cancel'))}
      />
    </div>
  );
}
