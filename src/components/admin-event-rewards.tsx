'use client';
// Events S6 (spec §7.4, §7.6, §7.7, §9.4): the FitFlex-only reward desk (scope `events`): Definitions, Redemptions, Ledger, Tasks and the
// Medal art moderation queue. Rewards are digital and FitFlex-funded at launch: the value field is shown disabled (D45) and nothing here
// moves money. No screen calls anything "points" or shows a combined balance (AC-W1).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Gift } from 'lucide-react';
import { api, type AdminEventRow } from '@/lib/api';
import { eventDateTime, fmt } from '@/lib/events';
import { newIdempotencyKey } from '@/lib/events-ops';
import { resultsApi } from '@/lib/events-results-api';
import {
  ACHIEVEMENT_KEYS, ART_TAKEDOWN_REASONS, knownKey, REWARD_TRIGGERS, bi, resultsErrorKey, resultsOf,
  type AdminMedalArt, type ArtTakedownReason, type AwardTask, type LedgerRow, type MedalTemplate, type RedemptionHit, type RewardDefinition, type RewardSummaryRow,
} from '@/lib/events-results';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Input, MetricCard, PageHeader, Segmented, Select, SkeletonTable, Textarea, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';
import { useEventsOptions } from '@/components/events-options';
import { useDocumentTitle } from '@/components/organizer/page-states';
import { BuiltinMedal, useAuthedImage } from '@/components/organizer/results/parts';
import { useWriteError } from '@/components/organizer/results/result-dialogs';
import { useApp } from '../../app/providers';

const TABS = ['definitions', 'redemptions', 'ledger', 'tasks', 'medalArt'] as const;
type Tab = (typeof TABS)[number];
const pageItems = <T,>(r: { items?: T[] } | T[] | null | undefined): T[] => (Array.isArray(r) ? r : r?.items ?? []);

export function EventRewardDesk() {
  const { t } = useApp();
  const options = useEventsOptions();
  const flags = resultsOf(options);
  useDocumentTitle(t('admin.rewards.title'));
  const tabs = TABS.filter(x => x !== 'medalArt' || flags.medalArt);
  const initial = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState<Tab>(() => ((TABS as readonly string[]).includes(initial ?? '') ? (initial as Tab) : 'definitions'));
  if (options === undefined) return <div aria-busy="true"><SkeletonTable /></div>;
  if (!flags.rewards) return <div data-testid="rewards-unavailable"><EmptyState icon={<Gift />} title={t('organizer.results.unavailable')} /></div>;
  const go = (v: string) => { setTab(v as Tab); const q = new URLSearchParams(window.location.search); q.set('tab', v); window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`); };
  return (
    <div className="space-y-4" data-testid="reward-desk">
      <PageHeader title={t('admin.rewards.title')} description={t('admin.rewards.subtitle')} />
      <div className="max-w-full overflow-x-auto"><Segmented className="w-fit" value={tab} onChange={go} options={tabs.map(x => [x, t(`admin.rewards.tab.${x}` as MessageKey)] as [string, string])} /></div>
      {tab === 'definitions' && <Definitions />}
      {tab === 'redemptions' && <Redemptions />}
      {tab === 'ledger' && <Ledger />}
      {tab === 'tasks' && <Tasks />}
      {tab === 'medalArt' && flags.medalArt && <MedalArtQueue />}
    </div>
  );
}

// ── Definitions + summary strip ──
function Definitions() {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<RewardDefinition[] | null>(null);
  const [summary, setSummary] = useState<{ rows: RewardSummaryRow[]; most: Array<{ userId: string; count: number }> } | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [edit, setEdit] = useState<RewardDefinition | 'new' | null>(null);
  const [confirm, setConfirm] = useState<{ row: RewardDefinition; action: 'pause' | 'end' } | null>(null);
  const [busy, setBusy] = useState(false);
  const cErr = useWriteError();
  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { setRows(pageItems(await resultsApi.rewardDefinitions(token))); } catch (e) { setError(resultsErrorKey(e)); }
    try {
      const s = await resultsApi.rewardSummary(token);
      setSummary({ rows: s.items ?? [], most: s.mostEarnedThisWeek ?? [] });
    } catch { setSummary(null); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const sum = (k: 'earned' | 'redeemed' | 'expired' | 'reversed' | 'needsReview') => (summary?.rows ?? []).reduce((a, r) => a + (r[k] ?? 0), 0);
  async function act() {
    if (!token || !confirm) return;
    setBusy(true); cErr.clear();
    try { await resultsApi.rewardAction(token, confirm.row.id, confirm.action, newIdempotencyKey()); setConfirm(null); toast.success(t('admin.rewards.updated')); await load(); }
    catch (e) { cErr.fail(e); } finally { setBusy(false); }
  }
  async function activate(r: RewardDefinition) {
    if (!token) return;
    try { await resultsApi.rewardAction(token, r.id, 'activate', newIdempotencyKey()); toast.success(t('admin.rewards.updated')); await load(); } catch (e) { toast.error(t(resultsErrorKey(e))); }
  }
  const cols: ColumnDef<RewardDefinition>[] = [
    { key: 'title', header: t('admin.rewards.col.title'), cell: r => <span className="font-medium [overflow-wrap:anywhere]">{bi(r.title, locale)}</span> },
    { key: 'trigger', header: t('admin.rewards.col.trigger'), cell: r => t(`admin.rewards.trigger.${r.triggerType}` as MessageKey) },
    { key: 'type', header: t('admin.rewards.col.type'), cell: r => t(`admin.rewards.redeemMode.${r.redeemMode}` as MessageKey) },
    { key: 'status', header: t('admin.rewards.col.status'), cell: r => <Badge tone={r.status === 'active' ? 'success' : r.status === 'paused' ? 'warning' : 'gray'}>{t(`admin.rewards.status.${r.status}` as MessageKey)}</Badge> },
    { key: 'cap', header: t('admin.rewards.col.cap'), cell: r => `${r.capUsed ?? 0} / ${r.capTotal ?? '∞'}` },
    { key: 'window', header: t('admin.rewards.col.window'), cell: r => `${r.startsAt?.slice(0, 10) ?? '—'} – ${r.endsAt?.slice(0, 10) ?? '—'}` },
  ];
  return (
    <div className="space-y-4" data-testid="rewards-definitions">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="rewards-summary">
        <MetricCard wrapLabel label={t('admin.rewards.sum.earned')} value={sum('earned')} />
        <MetricCard wrapLabel label={t('admin.rewards.sum.redeemed')} value={sum('redeemed')} />
        <MetricCard wrapLabel label={t('admin.rewards.sum.expired')} value={sum('expired')} />
        <MetricCard wrapLabel label={t('admin.rewards.sum.reversed')} value={sum('reversed')} />
        <MetricCard wrapLabel label={t('admin.rewards.needsReview')} value={sum('needsReview')} />
      </div>
      <div className="flex justify-end"><Button className="min-h-11" onClick={() => setEdit('new')} data-testid="reward-new">{t('admin.rewards.new')}</Button></div>
      {error && <Alert tone="error">{t(error)}</Alert>}
      <Card><CardContent>
        {!rows && !error ? <SkeletonTable /> : rows && rows.length === 0 ? <EmptyState title={t('admin.rewards.empty')} /> : (
          <DataTable columns={cols} data={rows ?? []} keyFn={r => r.id} label={t('admin.rewards.definitionsLabel')} dense pageSize={25}
            actions={r => (
              <>
                {r.status !== 'ended' && <Button variant="ghost" size="sm" onClick={() => setEdit(r)} data-testid={`reward-edit-${r.id}`}>{t('admin.rewards.edit')}</Button>}
                {(r.status === 'draft' || r.status === 'paused') && <Button variant="ghost" size="sm" onClick={() => void activate(r)} data-testid={`reward-activate-${r.id}`}>{t('admin.rewards.activate')}</Button>}
                {r.status === 'active' && <Button variant="ghost" size="sm" onClick={() => setConfirm({ row: r, action: 'pause' })} data-testid={`reward-pause-${r.id}`}>{t('admin.rewards.pause')}</Button>}
                {r.status !== 'ended' && <Button variant="ghost" size="sm" onClick={() => setConfirm({ row: r, action: 'end' })} data-testid={`reward-end-${r.id}`}>{t('admin.rewards.end')}</Button>}
              </>
            )} />
        )}
      </CardContent></Card>
      {(summary?.most ?? []).length > 0 && (
        <Card><CardContent>
          <div className="space-y-2" data-testid="rewards-most">
            <h3 className="font-semibold text-[var(--color-fg-primary)]">{t('admin.rewards.mostEarned')}</h3>
            <DataTable columns={[
              { key: 'u', header: t('admin.rewards.col.member'), cell: (r: { userId: string; count: number }) => <span className="font-mono text-xs">{r.userId}</span> },
              { key: 'c', header: t('admin.rewards.col.count'), cell: (r: { userId: string; count: number }) => r.count },
            ]} data={summary!.most} keyFn={r => r.userId} label={t('admin.rewards.mostEarned')} dense pageSize={10} />
          </div>
        </CardContent></Card>
      )}
      {edit && <DefinitionDialog row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast.success(t('admin.rewards.updated')); void load(); }} />}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => void act()} busy={busy} tone="danger"
        title={t(confirm?.action === 'end' ? 'admin.rewards.end' : 'admin.rewards.pause')} description={cErr.error ? t(cErr.error.key) : t(confirm?.action === 'end' ? 'admin.rewards.endBody' : 'admin.rewards.pauseBody')}
        confirmLabel={t(confirm?.action === 'end' ? 'admin.rewards.end' : 'admin.rewards.pause')} cancelLabel={t('common.cancel')} />
    </div>
  );
}

function DefinitionDialog({ row, onClose, onSaved }: { row: RewardDefinition | null; onClose: () => void; onSaved: () => void }) {
  const { t, token } = useApp();
  const editing = !!row;
  const [titleEn, setTitleEn] = useState(row?.title.en ?? ''); const [titleSw, setTitleSw] = useState(row?.title.sw ?? '');
  const [termsEn, setTermsEn] = useState(row?.terms?.en ?? ''); const [termsSw, setTermsSw] = useState(row?.terms?.sw ?? '');
  const [trigger, setTrigger] = useState(row?.triggerType ?? 'event_finish');
  const [eventId, setEventId] = useState(row?.triggerEventId ?? ''); const [ref, setRef] = useState(row?.triggerRef ?? '');
  const [mode, setMode] = useState(row?.redeemMode ?? 'certificate'); const [reversal, setReversal] = useState(row?.reversalPolicy ?? 'revoke_unredeemed');
  const [capTotal, setCapTotal] = useState(row?.capTotal ? String(row.capTotal) : ''); const [capUser, setCapUser] = useState(String(row?.capPerUser ?? 1));
  const [startsAt, setStartsAt] = useState(row?.startsAt?.slice(0, 10) ?? ''); const [endsAt, setEndsAt] = useState(row?.endsAt?.slice(0, 10) ?? '');
  const [expiry, setExpiry] = useState(row?.expiryDays ? String(row.expiryDays) : ''); const [funding, setFunding] = useState(row?.fundingNote ?? 'FitFlex');
  const [status, setStatus] = useState<'draft' | 'active'>(row?.status === 'active' ? 'active' : 'draft');
  const [events, setEvents] = useState<AdminEventRow[]>([]); const [templates, setTemplates] = useState<MedalTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (token && trigger !== 'achievement') api.adminEvents(token, { limit: 50 }).then(p => setEvents(p.items ?? [])).catch(() => setEvents([])); }, [token, trigger]);
  useEffect(() => {
    if (!token || trigger !== 'medal' || !eventId) { setTemplates([]); return; }
    resultsApi.medalTemplates(token, eventId).then(r => setTemplates(pageItems(r))).catch(() => setTemplates([]));
  }, [token, trigger, eventId]);
  const num = (v: string) => (v.trim() ? Number(v) : null);
  const valid = titleEn.trim() && titleSw.trim() && termsEn.trim() && termsSw.trim() && funding.trim()
    && (trigger !== 'medal' || (eventId && ref)) && (trigger !== 'achievement' || ref) && Number(capUser) >= 1
    && (!capTotal || Number(capTotal) >= 1) && (!expiry || Number(expiry) >= 1);
  async function save() {
    if (!token) return;
    setBusy(true); err.clear();
    // `valueTzs` is never sent (422 value_not_allowed_yet). A PATCH carries ONLY what changed: touching a trigger field of a reward that already
    // has ledger entries is 409 definition_locked, so unchanged trigger fields must not ride along.
    const full: Record<string, unknown> = {
      issuerType: 'fitflex', title: { en: titleEn.trim(), sw: titleSw.trim() }, terms: { en: termsEn.trim(), sw: termsSw.trim() },
      triggerType: trigger, triggerEventId: trigger === 'achievement' ? null : eventId || null, triggerRef: trigger === 'event_finish' ? null : ref || null,
      redeemMode: mode, reversalPolicy: reversal, capTotal: num(capTotal), capPerUser: Number(capUser), startsAt: startsAt || null, endsAt: endsAt || null,
      expiryDays: num(expiry), fundingNote: funding.trim(),
    };
    const before: Record<string, unknown> | null = row ? {
      title: { en: row.title.en ?? '', sw: row.title.sw ?? '' }, terms: { en: row.terms?.en ?? '', sw: row.terms?.sw ?? '' }, triggerType: row.triggerType, triggerEventId: row.triggerEventId ?? null, triggerRef: row.triggerRef ?? null,
      redeemMode: row.redeemMode, reversalPolicy: row.reversalPolicy ?? 'revoke_unredeemed', capTotal: row.capTotal ?? null, capPerUser: row.capPerUser ?? 1, startsAt: row.startsAt?.slice(0, 10) || null, endsAt: row.endsAt?.slice(0, 10) || null,
      expiryDays: row.expiryDays ?? null, fundingNote: row.fundingNote ?? '',
    } : null;
    const body = before ? Object.fromEntries(Object.entries(full).filter(([k, v]) => k !== 'issuerType' && JSON.stringify(v) !== JSON.stringify(before[k]))) : { ...full, status };
    try {
      if (row) { if (Object.keys(body).length === 0) { onClose(); return; } await resultsApi.updateRewardDefinition(token, row.id, body, key.current); }
      else await resultsApi.createRewardDefinition(token, body, key.current);
      onSaved();
    } catch (e) { err.fail(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={t(editing ? 'admin.rewards.edit' : 'admin.rewards.new')} size="lg">
      <div className="space-y-4" data-testid="reward-dialog">
        {err.view && <div data-testid="reward-error">{err.view}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${t('admin.rewards.col.title')} (EN)`} required><Input value={titleEn} maxLength={80} onChange={e => setTitleEn(e.target.value)} data-testid="reward-title-en" /></Field>
          <Field label={`${t('admin.rewards.col.title')} (SW)`} required><Input value={titleSw} maxLength={80} onChange={e => setTitleSw(e.target.value)} data-testid="reward-title-sw" /></Field>
          <Field label={`${t('admin.rewards.terms')} (EN)`} required><Textarea rows={3} value={termsEn} maxLength={500} onChange={e => setTermsEn(e.target.value)} data-testid="reward-terms-en" /></Field>
          <Field label={`${t('admin.rewards.terms')} (SW)`} required><Textarea rows={3} value={termsSw} maxLength={500} onChange={e => setTermsSw(e.target.value)} data-testid="reward-terms-sw" /></Field>
          <Field label={t('admin.rewards.col.trigger')}>
            <Select value={trigger} disabled={editing} onChange={e => { setTrigger(e.target.value as typeof trigger); setRef(''); setEventId(''); }} data-testid="reward-trigger">
              {REWARD_TRIGGERS.map(x => <option key={x} value={x}>{t(`admin.rewards.trigger.${x}` as MessageKey)}</option>)}
            </Select>
          </Field>
          {trigger !== 'achievement' && (
            <Field label={t('admin.rewards.event')}>
              <Select value={eventId} disabled={editing} onChange={e => { setEventId(e.target.value); setRef(''); }} data-testid="reward-event">
                <option value="">{trigger === 'event_finish' ? t('admin.rewards.anyEvent') : '—'}</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
              </Select>
            </Field>
          )}
          {trigger === 'medal' && (
            <Field label={t('admin.rewards.medal')} required>
              <Select value={ref} disabled={editing || !eventId} onChange={e => setRef(e.target.value)} data-testid="reward-medal">
                <option value="">—</option>{templates.map(m => <option key={m.id} value={m.id}>{bi(m.name, 'en')}</option>)}
              </Select>
            </Field>
          )}
          {trigger === 'achievement' && (
            <Field label={t('admin.rewards.achievement')} required>
              <Select value={ref} disabled={editing} onChange={e => setRef(e.target.value)} data-testid="reward-achievement">
                <option value="">—</option>{ACHIEVEMENT_KEYS.map(k => <option key={k} value={k}>{t(`admin.rewards.achievement.${k}` as MessageKey)}</option>)}
              </Select>
            </Field>
          )}
          <Field label={t('admin.rewards.col.type')}>
            <Select value={mode} onChange={e => setMode(e.target.value as typeof mode)} data-testid="reward-mode">
              <option value="certificate">{t('admin.rewards.redeemMode.certificate')}</option><option value="perk">{t('admin.rewards.redeemMode.perk')}</option>
            </Select>
          </Field>
          <Field label={t('admin.rewards.reversal')}>
            <Select value={reversal} onChange={e => setReversal(e.target.value as typeof reversal)} data-testid="reward-reversal">
              <option value="revoke_unredeemed">{t('admin.rewards.reversal.revoke_unredeemed')}</option><option value="revoke_all">{t('admin.rewards.reversal.revoke_all')}</option>
            </Select>
          </Field>
          <Field label={t('admin.rewards.capTotal')}><Input inputMode="numeric" value={capTotal} onChange={e => setCapTotal(e.target.value.replace(/\D/g, ''))} data-testid="reward-cap-total" /></Field>
          <Field label={t('admin.rewards.capUser')}><Input inputMode="numeric" value={capUser} onChange={e => setCapUser(e.target.value.replace(/\D/g, ''))} data-testid="reward-cap-user" /></Field>
          <Field label={t('admin.rewards.startsAt')}><Input type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} data-testid="reward-starts" /></Field>
          <Field label={t('admin.rewards.endsAt')}><Input type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} data-testid="reward-ends" /></Field>
          <Field label={t('admin.rewards.expiry')}><Input inputMode="numeric" value={expiry} onChange={e => setExpiry(e.target.value.replace(/\D/g, ''))} data-testid="reward-expiry" /></Field>
          <Field label={t('admin.rewards.funding')} hint={t('admin.rewards.fundingHint')} required><Input value={funding} maxLength={120} onChange={e => setFunding(e.target.value)} data-testid="reward-funding" /></Field>
          <Field label={t('admin.rewards.value')} hint={t('admin.rewards.valueLocked')}><Input disabled value="" placeholder="—" data-testid="reward-value" /></Field>
          {!editing && (
            <Field label={t('admin.rewards.col.status')}>
              <Select value={status} onChange={e => setStatus(e.target.value as 'draft' | 'active')} data-testid="reward-status">
                <option value="draft">{t('admin.rewards.status.draft')}</option><option value="active">{t('admin.rewards.status.active')}</option>
              </Select>
            </Field>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={!valid} onClick={() => void save()} data-testid="reward-save">{t('admin.rewards.save')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

// ── Redemptions: code lookup, Mark as used, Cancel (§7.6) ──
function Redemptions() {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [hit, setHit] = useState<RedemptionHit | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  async function lookup() {
    if (!token || !code.trim()) return;
    setBusy(true); err.clear(); setNotFound(false); setHit(null);
    try { const out = await resultsApi.lookupRedemption(token, code.trim().toUpperCase()); setHit((out.redemption ?? out) as RedemptionHit); key.current = newIdempotencyKey(); }
    catch (e) { if ((e as { status?: number })?.status === 404) setNotFound(true); else err.fail(e); } finally { setBusy(false); }
  }
  async function act(kind: 'redeem' | 'cancel') {
    if (!token || !hit) return;
    setBusy(true); err.clear();
    try {
      if (kind === 'redeem') await resultsApi.redeem(token, hit.id, note.trim() || undefined, key.current); else await resultsApi.cancelRedemption(token, hit.id, key.current);
      toast.success(t(kind === 'redeem' ? 'admin.rewards.markedUsed' : 'admin.rewards.cancelled')); setHit(null); setCode(''); setNote(''); key.current = newIdempotencyKey();
    } catch (e) { err.fail(e); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4" data-testid="rewards-redemptions">
      <Card><CardContent>
        <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void lookup(); }}>
          <div className="min-w-[14rem] flex-1"><Field label={t('admin.rewards.lookup')}><Input value={code} autoComplete="off" spellCheck={false} onChange={e => setCode(e.target.value.toUpperCase())} className="font-mono uppercase" data-testid="redeem-code" /></Field></div>
          <Button type="submit" className="min-h-11" loading={busy && !hit} disabled={!code.trim()} data-testid="redeem-lookup">{t('admin.rewards.lookupButton')}</Button>
        </form>
      </CardContent></Card>
      {err.view && <div data-testid="redeem-error">{err.view}</div>}
      {notFound && <div data-testid="redeem-notfound"><Alert tone="warning">{t('admin.rewards.codeNotFound')}</Alert></div>}
      {hit && (
        <Card><CardContent>
          <div className="space-y-3" data-testid="redeem-card">
            <p className="text-base font-semibold text-[var(--color-fg-primary)]">{bi(hit.title, locale)}</p>
            <p className="text-sm text-[var(--color-fg-secondary)]">{hit.member ?? '—'} · <Badge tone={hit.status === 'reserved' ? 'warning' : 'gray'}>{t(knownKey(`admin.rewards.redemption.${hit.status}`, 'admin.rewards.needsReview'))}</Badge>{hit.expiresAt ? ` · ${eventDateTime(hit.expiresAt, 'Africa/Dar_es_Salaam', locale)}` : ''}</p>
            {hit.needsReview && <Badge tone="warning">{t('admin.rewards.needsReview')}</Badge>}
            {hit.status === 'reserved' && (
              <>
                <Field label={t('admin.rewards.note')} hint="≤ 200"><Input value={note} maxLength={200} onChange={e => setNote(e.target.value)} data-testid="redeem-note" /></Field>
                <div className="flex flex-wrap gap-2">
                  <Button className="min-h-11" loading={busy} onClick={() => void act('redeem')} data-testid="redeem-use">{t('admin.rewards.markUsed')}</Button>
                  <Button className="min-h-11" variant="secondary" disabled={busy} onClick={() => void act('cancel')} data-testid="redeem-cancel">{t('admin.rewards.cancelRedemption')}</Button>
                </div>
              </>
            )}
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

// ── Ledger (read only; names masked by the server) ──
function Ledger() {
  const { t, token, locale } = useApp();
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [defs, setDefs] = useState<RewardDefinition[]>([]);
  const [definitionId, setDefinitionId] = useState(''); const [userId, setUserId] = useState(''); const [entryType, setEntryType] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  useEffect(() => { if (token) resultsApi.rewardDefinitions(token).then(r => setDefs(pageItems(r))).catch(() => setDefs([])); }, [token]);
  const load = useCallback(async (cursor: string | null) => {
    if (!token) return;
    if (!cursor) { setRows(null); setError(null); }
    try {
      const p = await resultsApi.rewardLedger(token, { ...(definitionId ? { definitionId } : {}), ...(userId.trim() ? { userId: userId.trim() } : {}), ...(entryType ? { entryType } : {}), cursor });
      setRows(cur => (cursor ? [...(cur ?? []), ...(p.items ?? [])] : (p.items ?? []))); setNext(p.nextCursor ?? null);
    } catch (e) { setError(resultsErrorKey(e)); }
  }, [token, definitionId, userId, entryType]);
  useEffect(() => { void load(null); }, [load]);
  const cols: ColumnDef<LedgerRow>[] = [
    { key: 'when', header: t('admin.rewards.col.when'), cell: r => eventDateTime(r.occurredAt, 'Africa/Dar_es_Salaam', locale) },
    { key: 'type', header: t('admin.rewards.col.entry'), cell: r => t(`admin.rewards.ledger.${['earn', 'redeem', 'expire', 'reverse'].includes(r.entryType) ? r.entryType : 'other'}` as MessageKey) },
    { key: 'reward', header: t('admin.rewards.col.reward'), cell: r => bi(r.titleOf as { en?: string; sw?: string } | string | null, locale) },
    { key: 'member', header: t('admin.rewards.col.member'), cell: r => r.member ?? '—' },
    { key: 'units', header: t('admin.rewards.col.units'), cell: r => (r.units != null && r.units > 0 ? `+${r.units}` : String(r.units ?? '')) },
    { key: 'why', header: t('admin.rewards.col.why'), cell: r => (r.reverses ? fmt(t('admin.rewards.reverses'), { id: typeof r.reverses === 'string' ? r.reverses : r.reverses.id ?? '' }) : r.sourceType ? t(knownKey(`admin.rewards.source.${r.sourceType}`, 'admin.rewards.source.other')) : '—') },
  ];
  return (
    <div className="space-y-3" data-testid="rewards-ledger">
      {error && <Alert tone="error">{t(error)}</Alert>}
      <Card><CardContent>
        {!rows && !error ? <SkeletonTable /> : (
          <>
            <DataTable columns={cols} data={rows ?? []} keyFn={r => r.id} label={t('admin.rewards.ledgerLabel')} dense pageSize={25} emptyState={t('admin.rewards.ledgerEmpty')}
              extraFilters={(
                <>
                  <Select size="sm" aria-label={t('admin.rewards.col.reward')} value={definitionId} onChange={e => setDefinitionId(e.target.value)} data-testid="ledger-definition">
                    <option value="">{t('admin.rewards.allRewards')}</option>{defs.map(d => <option key={d.id} value={d.id}>{bi(d.title, locale)}</option>)}
                  </Select>
                  <Select size="sm" aria-label={t('admin.rewards.col.entry')} value={entryType} onChange={e => setEntryType(e.target.value)} data-testid="ledger-type">
                    <option value="">{t('admin.rewards.allEntries')}</option>{['earn', 'redeem', 'expire', 'reverse'].map(x => <option key={x} value={x}>{t(`admin.rewards.ledger.${x}` as MessageKey)}</option>)}
                  </Select>
                  <Input aria-label={t('admin.rewards.memberId')} placeholder={t('admin.rewards.memberId')} value={userId} onChange={e => setUserId(e.target.value)} className="max-w-[12rem]" data-testid="ledger-user" />
                </>
              )} />
            {next && <div className="mt-3 flex justify-center"><Button variant="secondary" onClick={() => void load(next)}>{t('organizer.results.loadMore')}</Button></div>}
          </>
        )}
      </CardContent></Card>
    </div>
  );
}

// ── Failed award tasks ──
function Tasks() {
  const { t, token } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<AwardTask[] | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const load = useCallback(async () => { if (!token) return; setError(null); try { setRows(pageItems(await resultsApi.awardTasks(token, 'failed'))); } catch (e) { setError(resultsErrorKey(e)); } }, [token]);
  useEffect(() => { void load(); }, [load]);
  async function retry(id: string) {
    if (!token) return;
    try { await resultsApi.retryAwardTask(token, id, newIdempotencyKey()); toast.success(t('admin.rewards.retried')); await load(); } catch (e) { toast.error(t(resultsErrorKey(e))); }
  }
  const cols: ColumnDef<AwardTask>[] = [
    { key: 'reason', header: t('admin.rewards.col.reason'), cell: r => r.reason ?? '—' },
    { key: 'attempts', header: t('admin.rewards.col.attempts'), cell: r => r.attempts ?? 0 },
    { key: 'err', header: t('admin.rewards.col.error'), cell: r => <span className="font-mono text-xs">{r.lastError ?? '—'}</span> },
  ];
  return (
    <div className="space-y-3" data-testid="rewards-tasks">
      {error && <Alert tone="error">{t(error)}</Alert>}
      <Card><CardContent>
        {!rows && !error ? <SkeletonTable /> : rows && rows.length === 0 ? <EmptyState title={t('admin.rewards.tasksEmpty')} /> : (
          <DataTable columns={cols} data={rows ?? []} keyFn={r => r.id} label={t('admin.rewards.tasksLabel')} dense pageSize={25}
            actions={r => <Button variant="ghost" size="sm" onClick={() => void retry(r.id)} data-testid={`task-retry-${r.id}`}>{t('admin.rewards.retry')}</Button>} />
        )}
      </CardContent></Card>
    </div>
  );
}

// ── Medal art moderation queue (§7.7, AC-G5): show-now, then Looks fine or Take down ──
function ArtPreview({ id, w, alt }: { id: string; w: 240 | 480; alt: string }) {
  const img = useAuthedImage(resultsApi.medalArtPreviewPath(id, w), true);
  const size = w === 240 ? 'h-[120px] w-[120px]' : 'h-[240px] w-[240px]';
  return (
    <span className={`inline-flex shrink-0 overflow-hidden rounded-full bg-[var(--color-bg-secondary)] ${size}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img.url ? <img src={img.url} alt={alt} className="h-full w-full object-cover" /> : <BuiltinMedal artKey="finisher_gold" label={img.failed ? alt : undefined} />}
    </span>
  );
}

function MedalArtQueue() {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [filter, setFilter] = useState<'to_review' | 'all' | 'taken_down'>('to_review');
  const [rows, setRows] = useState<AdminMedalArt[] | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [down, setDown] = useState<AdminMedalArt | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    setRows(null); setError(null);
    try { setRows(pageItems(await resultsApi.medalArtQueue(token, filter === 'to_review' ? { reviewState: 'to_review', status: 'live' } : filter === 'taken_down' ? { status: 'taken_down' } : {}))); }
    catch (e) { setError(resultsErrorKey(e)); }
  }, [token, filter]);
  useEffect(() => { void load(); }, [load]);
  async function reviewed(a: AdminMedalArt) {
    if (!token) return;
    try { await resultsApi.medalArtReviewed(token, a.id, newIdempotencyKey()); toast.success(t('admin.medalArt.reviewedDone')); await load(); } catch (e) { toast.error(t(resultsErrorKey(e))); }
  }
  return (
    <div className="space-y-4" data-testid="medal-art-queue">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-[var(--color-fg-primary)]">{t('admin.medalArt.title')}</h3>
        <Segmented value={filter} onChange={v => setFilter(v as typeof filter)} options={[['to_review', t('admin.medalArt.toReview')], ['all', t('admin.medalArt.all')], ['taken_down', t('admin.medalArt.takenDown')]]} />
      </div>
      {error && <Alert tone="error">{t(error)}</Alert>}
      {!rows && !error && <SkeletonTable />}
      {rows && rows.length === 0 && <div data-testid="medal-art-empty"><EmptyState title={t('admin.medalArt.empty')} /></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {(rows ?? []).map(a => {
          const alt = (locale === 'sw' ? a.altText?.sw : a.altText?.en) || fmt(t('organizer.results.art.generatedAlt'), { name: a.eventTitle ?? '', tier: t(`organizer.results.medals.tier.${a.tier ?? 'other'}` as MessageKey) });
          return (
            <Card key={a.id}><CardContent>
              <article className="space-y-3" aria-label={`${a.eventTitle ?? ''} · ${a.organizerName ?? ''}`} data-testid={`art-card-${a.id}`}>
                <div className="flex flex-wrap items-start gap-4">
                  {a.status !== 'taken_down' && <ArtPreview id={a.id} w={240} alt={alt} />}
                  {a.status !== 'taken_down' && <ArtPreview id={a.id} w={480} alt={alt} />}
                </div>
                <p className="text-sm font-medium text-[var(--color-fg-primary)]">{a.eventTitle ?? '—'} · {a.organizerName ?? '—'}</p>
                <p className="text-sm text-[var(--color-fg-secondary)]">{a.categoryName ?? t('organizer.results.medals.allCategories')} · {t(`organizer.results.medals.tier.${a.tier ?? 'other'}` as MessageKey)}</p>
                {a.confirmedAt && <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('admin.medalArt.confirmedAt'), { when: eventDateTime(a.confirmedAt, 'Africa/Dar_es_Salaam', locale) })}</p>}
                <p className="flex flex-wrap gap-1.5">
                  <Badge tone={a.reviewState === 'reviewed' ? 'success' : 'warning'}>{t(a.reviewState === 'reviewed' ? 'admin.medalArt.reviewed' : 'admin.medalArt.toReview')}</Badge>
                  {a.status === 'taken_down' && <Badge tone="danger">{t('admin.medalArt.takenDown')}</Badge>}
                  {(a.organizerTakedowns30d ?? 0) > 0 && <Badge tone={a.highlightOrganizer ? 'danger' : 'gray'}>{fmt(t('admin.medalArt.takedownCount'), { n: a.organizerTakedowns30d ?? 0 })}</Badge>}
                  {a.highlightOrganizer && <Badge tone="danger">{t('admin.medalArt.highlight')}</Badge>}
                </p>
                {a.status === 'live' && (
                  <div className="flex flex-wrap gap-2">
                    {a.reviewState !== 'reviewed' && <Button className="min-h-11" variant="secondary" onClick={() => void reviewed(a)} data-testid={`art-fine-${a.id}`}>{t('admin.medalArt.looksFine')}</Button>}
                    <Button className="min-h-11" variant="destructive" onClick={() => setDown(a)} data-testid={`art-down-${a.id}`}>{t('admin.medalArt.takeDown')}</Button>
                  </div>
                )}
              </article>
            </CardContent></Card>
          );
        })}
      </div>
      {down && <TakeDownDialog art={down} onClose={() => setDown(null)} onDone={() => { setDown(null); toast.success(t('admin.medalArt.takenDownDone')); void load(); }} />}
    </div>
  );
}

function TakeDownDialog({ art, onClose, onDone }: { art: AdminMedalArt; onClose: () => void; onDone: () => void }) {
  const { t, token } = useApp();
  const [reason, setReason] = useState<ArtTakedownReason | ''>('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  const valid = !!reason && note.length <= 200 && (reason !== 'other' || note.trim().length > 0);
  async function go() {
    if (!token || !reason) return;
    setBusy(true); err.clear();
    try { await resultsApi.medalArtTakeDown(token, art.id, { reason, ...(note.trim() ? { note: note.trim() } : {}) }, key.current); onDone(); }
    catch (e) { err.fail(e); } finally { setBusy(false); setOpen(false); }
  }
  return (
    <>
      <Dialog open={!open} onClose={() => { if (!busy) onClose(); }} title={t('admin.medalArt.takeDown')} description={art.eventTitle ?? undefined} size="md">
        <div className="space-y-4" data-testid="takedown-dialog">
          {err.view}
          <p className="text-sm text-[var(--color-fg-secondary)]">{t('admin.medalArt.takeDownBody')}</p>
          <Field label={t('admin.medalArt.reason')} required>
            <Select value={reason} onChange={e => setReason(e.target.value as ArtTakedownReason)} data-testid="takedown-reason">
              <option value="">—</option>{ART_TAKEDOWN_REASONS.map(r => <option key={r} value={r}>{t(`admin.medalArt.reason.${r}` as MessageKey)}</option>)}
            </Select>
          </Field>
          <Field label={t('admin.rewards.note')} hint={`${note.length}/200`} required={reason === 'other'}><Textarea rows={2} maxLength={200} value={note} onChange={e => setNote(e.target.value)} data-testid="takedown-note" /></Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="destructive" disabled={!valid} loading={busy} onClick={() => setOpen(true)} data-testid="takedown-next">{t('admin.medalArt.takeDown')}</Button>
        </DialogFooter>
      </Dialog>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={() => void go()} busy={busy} tone="danger"
        title={t('admin.medalArt.takeDownConfirmTitle')} description={t('admin.medalArt.takeDownConfirmBody')} confirmLabel={t('admin.medalArt.takeDown')} cancelLabel={t('common.cancel')} />
    </>
  );
}
