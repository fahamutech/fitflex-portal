'use client';
// Communication history in the Communication Center (M8): a campaign's
// numbers, the filterable message log (History tab), who a campaign went
// to, one member's timeline, and any message in full. Everything is read
// from the backend's history API, which only returns what this gym (or, for
// admins, FitFlex) sent.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy } from 'lucide-react';
import {
  api, CommsChannel, CommsHistoryFilters, CommsMessage, CommsOutcome, CommsRecipient, CommsScope, CommsStats,
  CommsTimelineItem,
} from '@/lib/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Spinner } from './shared';
import { Dialog } from './dialog';
import { PURPOSES, T, errorText, fill, when } from './communication-shared';

const CHANNELS: CommsChannel[] = ['in_app', 'push', 'whatsapp'];
const STATUS_FILTERS = ['reached', 'pending', 'opened', 'failed', 'skipped'];
const FAILURES = new Set([
  'invalid_recipient', 'recipient_opted_out', 'template_not_approved', 'provider_unavailable', 'provider_failed',
  'rate_limited', 'push_failed', 'push_disabled', 'push_unavailable', 'no_device', 'whatsapp_template_missing', 'channel_not_supported',
]);
const SKIPS = new Set([
  'in_app_marketing_off', 'push_marketing_off', 'whatsapp_marketing_not_opted_in', 'whatsapp_opted_out',
  'whatsapp_transactional_off', 'no_device', 'no_phone', 'push_disabled', 'whatsapp_not_configured', 'marketing_cap',
  'whatsapp_disabled', 'whatsapp_template_not_approved', 'invalid_phone',
  'account_suspended', 'member_not_found', 'not_gym_member',
]);
const STATUS_TONE: Record<string, 'gray' | 'warning' | 'brand' | 'success' | 'danger'> = {
  queued: 'warning', sending: 'warning', sent: 'brand', delivered: 'success', read: 'success', clicked: 'success', failed: 'danger', skipped: 'gray',
};
const OUTCOME_TONE: Record<CommsOutcome, 'gray' | 'warning' | 'success' | 'danger'> = {
  reached: 'success', pending: 'warning', failed: 'danger', skipped: 'gray',
};

/** Why a message didn't go out, in words. */
export function whyNot(t: T, m: Pick<CommsMessage, 'failureReason' | 'skipReason'>): string {
  if (m.failureReason) return FAILURES.has(m.failureReason) ? t(`comms.failure.${m.failureReason}`) : m.failureReason;
  if (m.skipReason) return SKIPS.has(m.skipReason) ? t(`comms.skip.${m.skipReason}`) : m.skipReason;
  return '';
}

export function OutcomeBadge({ t, outcome }: { t: T; outcome: CommsOutcome }) {
  return <Badge tone={OUTCOME_TONE[outcome]}>{t(`comms.outcome.${outcome}`)}</Badge>;
}

function StatusChip({ t, m, onOpen }: { t: T; m: CommsMessage; onOpen?: (id: string) => void }) {
  const reason = whyNot(t, m);
  return (
    <button type="button" onClick={() => onOpen?.(m.id)} data-testid={`msg-${m.id}`}
      className="flex items-center gap-2 rounded-[var(--radius-md)] px-1 py-0.5 text-left text-xs hover:bg-[var(--color-bg-secondary)]">
      <span className="w-16 shrink-0 text-[var(--color-fg-tertiary)]">{t(`comms.channel.${m.channel}`)}</span>
      <Badge tone={STATUS_TONE[m.status]}>{t(`comms.msgStatus.${m.status}`)}</Badge>
      {reason && <span className={m.status === 'failed' ? 'text-[var(--color-error-600)]' : 'text-[var(--color-fg-quaternary)]'}>{reason}</span>}
    </button>
  );
}

/** A campaign's numbers from the ledger. */
export function StatsGrid({ t, stats }: { t: T; stats: CommsStats }) {
  const x = stats.totals;
  const cells: Array<[string, number]> = [
    ['targeted', stats.targeted ?? 0], ['sent', x.sent], ['delivered', x.delivered], ['opened', x.opened], ['clicked', x.clicked], ['failed', x.failed],
    ...(x.skipped ? [['skipped', x.skipped] as [string, number]] : []), ...(x.pending ? [['pending', x.pending] as [string, number]] : []),
  ];
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8" data-testid="stats">
      {cells.map(([k, n]) => (
        <div key={k} data-testid={`stat-${k}`}>
          <p className={`text-lg font-semibold ${k === 'failed' && n > 0 ? 'text-[var(--color-error-600)]' : ''}`}>{n}</p>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t(`comms.stat.${k}`)}</p>
        </div>
      ))}
    </div>
  );
}

// ── filters ────────────────────────────────────────────────────────────────
type Filters = Omit<CommsHistoryFilters, 'cursor' | 'limit'>;

function FilterBar({ t, filters, onChange, show }: {
  t: T; filters: Filters; onChange: (f: Filters) => void;
  show: { search?: boolean; category?: boolean; type?: boolean; dates?: boolean };
}) {
  const [search, setSearch] = useState(filters.search ?? '');
  const set = (patch: Filters) => onChange({ ...filters, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="history-filters">
      {show.search && (
        <Field label={t('comms.history.searchMember')}>
          <Input value={search} onChange={e => setSearch(e.target.value)} data-testid="hist-search"
            onKeyDown={e => { if (e.key === 'Enter') set({ search: search.trim() || undefined }); }}
            onBlur={() => { if ((filters.search ?? '') !== search.trim()) set({ search: search.trim() || undefined }); }} />
        </Field>
      )}
      <Field label={t('comms.history.channel')}>
        <select className="ui-input" value={filters.channel ?? ''} onChange={e => set({ channel: e.target.value || undefined })} data-testid="hist-channel">
          <option value="">{t('comms.filter.allChannels')}</option>
          {CHANNELS.map(c => <option key={c} value={c}>{t(`comms.channel.${c}`)}</option>)}
        </select>
      </Field>
      <Field label={t('comms.history.status')}>
        <select className="ui-input" value={filters.status ?? ''} onChange={e => set({ status: e.target.value || undefined })} data-testid="hist-status">
          <option value="">{t('comms.filter.all')}</option>
          {STATUS_FILTERS.map(s => <option key={s} value={s}>{t(`comms.historyFilter.${s}`)}</option>)}
        </select>
      </Field>
      {show.category && (
        <Field label={t('comms.history.type')}>
          <select className="ui-input" value={filters.category ?? ''} onChange={e => set({ category: e.target.value || undefined })} data-testid="hist-category">
            <option value="">{t('comms.filter.allTypes')}</option>
            {['transactional', 'marketing'].map(c => <option key={c} value={c}>{t(`comms.category.${c}`)}</option>)}
          </select>
        </Field>
      )}
      {show.type && (
        <Field label={t('comms.history.kind')}>
          <select className="ui-input" value={filters.messageType ?? ''} onChange={e => set({ messageType: e.target.value || undefined })} data-testid="hist-type">
            <option value="">{t('comms.filter.all')}</option>
            {PURPOSES.map(p => <option key={p} value={p}>{t(`comms.purpose.${p}`)}</option>)}
          </select>
        </Field>
      )}
      {show.dates && (
        <>
          <Field label={t('comms.history.from')}><Input type="date" value={filters.from ?? ''} onChange={e => set({ from: e.target.value || undefined })} data-testid="hist-from" /></Field>
          <Field label={t('comms.history.to')}><Input type="date" value={filters.to ?? ''} onChange={e => set({ to: e.target.value || undefined })} data-testid="hist-to" /></Field>
        </>
      )}
    </div>
  );
}

/** Loads pages of a history list; a new filter starts over. */
function usePaged<I>(load: (f: CommsHistoryFilters) => Promise<{ items: I[]; nextCursor: string | null }>, filters: Filters, t: T) {
  const [items, setItems] = useState<I[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  const key = JSON.stringify(filters);

  const fetchPage = useCallback(async (from: string | null, g: number) => {
    setBusy(true);
    try {
      const r = await load({ ...filters, ...(from ? { cursor: from } : {}), limit: 25 });
      if (g !== gen.current) return;
      setItems(prev => (from ? [...(prev ?? []), ...r.items] : r.items));
      setCursor(r.nextCursor);
      setError(null);
    } catch (e) { if (g === gen.current) setError(errorText(t, e)); } finally { if (g === gen.current) setBusy(false); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const g = ++gen.current; setItems(null); fetchPage(null, g); }, [fetchPage]);
  return { items, error, busy, more: cursor ? () => fetchPage(cursor, gen.current) : null };
}

function More({ t, paged }: { t: T; paged: { busy: boolean; more: (() => void) | null } }) {
  if (!paged.more) return null;
  return (
    <div className="mt-3 flex justify-center">
      <Button variant="secondary" disabled={paged.busy} onClick={paged.more} data-testid="history-more">
        {paged.busy ? <Spinner className="h-4 w-4" /> : t('comms.history.loadMore')}
      </Button>
    </div>
  );
}

function Empty({ t, filtered, emptyKey }: { t: T; filtered: boolean; emptyKey: string }) {
  return <EmptyState title={t(emptyKey)} body={filtered ? t('comms.history.tryOtherFilters') : undefined} />;
}

// ── the message log (History tab) ─────────────────────────────────────────
export function MessageLog({ scope, token, t, gymId, onOpenMember }: {
  scope: CommsScope; token: string; t: T; gymId?: string; onOpenMember: (memberId: string, name: string | null) => void;
}) {
  const [filters, setFilters] = useState<Filters>(scope === 'owner' && gymId ? { gymId } : {});
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setFilters(f => ({ ...f, gymId: scope === 'owner' ? gymId : undefined })); }, [gymId, scope]);
  const paged = usePaged(f => api.commsMessages(token, scope, f).then(r => ({ items: r.messages, nextCursor: r.nextCursor })), filters, t);
  const filtered = Object.entries(filters).some(([k, v]) => k !== 'gymId' && v);
  return (
    <div className="space-y-3" data-testid="message-log">
      <p className="text-sm text-[var(--color-fg-tertiary)]">{t(scope === 'owner' ? 'comms.history.logIntro' : 'comms.history.logIntroAdmin')}</p>
      <FilterBar t={t} filters={filters} onChange={setFilters} show={{ search: true, category: true, type: true, dates: true }} />
      {paged.error && <Alert tone="error">{paged.error}</Alert>}
      {!paged.items ? <Spinner /> : !paged.items.length ? <Empty t={t} filtered={filtered} emptyKey="comms.history.noMessages" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-fg-quaternary)]">
                <th className="px-4 py-2">{t('comms.history.at.created')}</th>
                <th className="px-4 py-2">{t('comms.history.member')}</th>
                <th className="px-4 py-2">{t('comms.history.message')}</th>
                <th className="px-4 py-2">{t('comms.history.channelAndStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map(m => (
                <tr key={m.id} className="border-t border-[var(--color-border-secondary)] align-top" data-testid={`log-${m.id}`}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs">{when(m.createdAt)}</td>
                  <td className="px-4 py-2">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpenMember(m.memberId, m.memberName)} data-testid={`member-${m.memberId}`}>
                      {m.memberName || t('comms.history.unknownMember')}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <span className="block max-w-xs truncate">{m.title}</span>
                    <span className="text-xs text-[var(--color-fg-quaternary)]">{[m.campaignName, t(`comms.purpose.${m.messageType}`)].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="px-4 py-2"><StatusChip t={t} m={m} onOpen={setOpen} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <More t={t} paged={paged} />
      <MessageDialog scope={scope} token={token} t={t} id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ── who a campaign went to ────────────────────────────────────────────────
export function Recipients({ scope, token, t, campaignId, onOpenMember }: {
  scope: CommsScope; token: string; t: T; campaignId: string; onOpenMember: (memberId: string, name: string | null) => void;
}) {
  const [filters, setFilters] = useState<Filters>({});
  const [open, setOpen] = useState<string | null>(null);
  const paged = usePaged(f => api.commsRecipients(token, scope, campaignId, f).then(r => ({ items: r.recipients, nextCursor: r.nextCursor })), filters, t);
  return (
    <div className="space-y-3" data-testid="recipients">
      <FilterBar t={t} filters={filters} onChange={setFilters} show={{ search: true }} />
      {paged.error && <Alert tone="error">{paged.error}</Alert>}
      {!paged.items ? <Spinner /> : !paged.items.length
        ? <Empty t={t} filtered={Object.values(filters).some(Boolean)} emptyKey="comms.history.noRecipients" />
        : (
          <Card className="divide-y divide-[var(--color-border-secondary)]">
            {paged.items.map((r: CommsRecipient) => (
              <div key={r.memberId} className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid={`recipient-${r.memberId}`}>
                <button type="button" className="w-40 text-left text-sm font-medium hover:underline" onClick={() => onOpenMember(r.memberId, r.memberName)}>
                  {r.memberName || t('comms.history.unknownMember')}
                </button>
                <div className="flex-1 space-y-0.5">{r.channels.map(m => <StatusChip key={m.id} t={t} m={m} onOpen={setOpen} />)}</div>
                <OutcomeBadge t={t} outcome={r.outcome} />
              </div>
            ))}
          </Card>
        )}
      <More t={t} paged={paged} />
      <MessageDialog scope={scope} token={token} t={t} id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ── one member's timeline ─────────────────────────────────────────────────
export function MemberTimeline({ scope, token, t, memberId, memberName, gymId, onBack }: {
  scope: CommsScope; token: string; t: T; memberId: string; memberName: string | null; gymId?: string; onBack: () => void;
}) {
  const [filters, setFilters] = useState<Filters>({});
  const [open, setOpen] = useState<string | null>(null);
  const paged = usePaged(f => api.commsMemberHistory(token, scope, memberId, { ...f, gymId: scope === 'owner' ? gymId : undefined })
    .then(r => ({ items: r.items, nextCursor: r.nextCursor })), filters, t);
  const back = <Button variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" />{t('comms.history.back')}</Button>;
  return (
    <div data-testid="member-timeline">
      <PageHeader title={memberName || t('comms.history.unknownMember')} description={t('comms.history.memberTitle')} actions={back} />
      <div className="space-y-3">
        <FilterBar t={t} filters={filters} onChange={setFilters} show={{ category: true, dates: true }} />
        {paged.error && <Alert tone="error">{paged.error}</Alert>}
        {!paged.items ? <Spinner /> : !paged.items.length
          ? <Empty t={t} filtered={Object.values(filters).some(Boolean)} emptyKey="comms.history.noneYet" />
          : paged.items.map((i: CommsTimelineItem) => (
            <Card key={i.key} className="space-y-2 p-4" data-testid={`comm-${i.key}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.title || t('comms.untitled')}</p>
                  <p className="text-xs text-[var(--color-fg-quaternary)]">
                    {[when(i.createdAt), i.campaignName, t(`comms.purpose.${i.messageType}`), t(`comms.category.${i.category}`)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <OutcomeBadge t={t} outcome={i.outcome} />
              </div>
              {i.body && <p className="line-clamp-2 text-sm">{i.body}</p>}
              <div className="space-y-0.5">{i.channels.map(m => <StatusChip key={m.id} t={t} m={m} onOpen={setOpen} />)}</div>
            </Card>
          ))}
        <More t={t} paged={paged} />
      </div>
      <MessageDialog scope={scope} token={token} t={t} id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ── one message in full ───────────────────────────────────────────────────
export function MessageDialog({ scope, token, t, id, onClose }: {
  scope: CommsScope; token: string; t: T; id: string | null; onClose: () => void;
}) {
  const [m, setM] = useState<CommsMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setM(null); setError(null);
    if (!id) return;
    api.commsMessage(token, scope, id).then(r => setM(r.message)).catch(e => setError(errorText(t, e)));
  }, [id, token, scope, t]);

  const row = (label: string, value: React.ReactNode, testId?: string) => (
    <div className="flex gap-3 py-1 text-sm" data-testid={testId}>
      <span className="w-36 shrink-0 text-[var(--color-fg-quaternary)]">{label}</span>
      <span className="min-w-0 flex-1 break-all">{value}</span>
    </div>
  );
  const times: Array<[string, string | null | undefined]> = m
    ? [['created', m.createdAt], ['sent', m.sentAt], ['delivered', m.deliveredAt], ['opened', m.openedAt], ['clicked', m.clickedAt], ['failed', m.failedAt], ['nextAttempt', m.nextAttemptAt]]
    : [];
  return (
    <Dialog open={id != null} onClose={onClose} title={m?.memberName || t('comms.history.message')} description={m?.campaignName ?? undefined} size="lg">
      {!m ? (error ? <Alert tone="error">{error}</Alert> : <Spinner />) : (
        <div className="space-y-3" data-testid="message-detail">
          <div className="flex items-center gap-2">
            <span className="text-sm">{t(`comms.channel.${m.channel}`)}</span>
            <Badge tone={STATUS_TONE[m.status]}>{t(`comms.msgStatus.${m.status}`)}</Badge>
          </div>
          {m.status === 'queued' && m.failureReason && (
            <Alert tone="warning">{fill(t('comms.history.lastTryFailed'), { reason: whyNot(t, m) })}</Alert>
          )}
          {(m.status === 'failed' || m.status === 'skipped') && (
            <Alert tone={m.status === 'failed' ? 'error' : 'info'}>
              {whyNot(t, m)}{m.status === 'failed' ? ` — ${t(m.failurePermanent ? 'comms.history.notRetried' : 'comms.history.retried')}` : ''}
            </Alert>
          )}
          <Card className="p-3">
            <p className="font-semibold">{m.title}</p>
            <p className="mt-1 whitespace-pre-line text-sm">{m.body}</p>
          </Card>
          <div>
            {times.filter(([, v]) => v).map(([k, v]) => <div key={k}>{row(t(`comms.history.at.${k}`), when(v))}</div>)}
            {row(t('comms.history.type'), `${t(`comms.purpose.${m.messageType}`)} · ${t(`comms.category.${m.category}`)}`)}
            {m.template && row(t('comms.history.template'), (m.template.system && m.template.key && t(`comms.tpl.${m.template.key}`)) || m.template.name)}
            {m.locale && row(t('comms.history.language'), t(`comms.lang.${m.locale}`))}
            {m.attempts > 1 && row(t('comms.history.attempts'), m.attempts)}
          </div>
          <div>
            <p className="text-sm font-semibold">{t('comms.history.provider')}</p>
            {row(t('comms.history.via'), t(`comms.provider.${m.provider.name}`))}
            {m.provider.templateName && row(t('comms.history.providerTemplate'), `${m.provider.templateName} (${m.provider.language ?? '–'})`)}
            {m.provider.devices != null && row(t('comms.history.devices'), fill(t('comms.history.devicesValue'), { n: m.provider.devices, failed: m.provider.failedDevices ?? 0 }))}
            {m.provider.errors?.length ? row(t('comms.history.providerErrors'), m.provider.errors.join(', ')) : null}
            {m.provider.messageId && row(t('comms.history.reference'), (
              <span className="inline-flex items-center gap-1">
                <code className="text-xs">{m.provider.messageId}</code>
                <button type="button" aria-label={t('comms.history.copy')} onClick={() => navigator.clipboard?.writeText(m.provider.messageId!)}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </span>
            ), 'provider-ref')}
          </div>
        </div>
      )}
    </Dialog>
  );
}
