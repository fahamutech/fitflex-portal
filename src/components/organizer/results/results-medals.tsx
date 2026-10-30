'use client';
// Events S6 (spec §7.1, §7.7, §9.2 Medals): the event's medal templates with their artwork. Rules lock after an official release; names,
// descriptions and artwork stay editable. Artwork upload needs EVENTS_MEDAL_ART (artOn) and the owner or admin role (AC-G1).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Plus } from 'lucide-react';
import type { EventDocument, OrganizerRole } from '@/lib/api';
import { fmt } from '@/lib/events';
import { newIdempotencyKey } from '@/lib/events-ops';
import { resultsApi } from '@/lib/events-results-api';
import {
  BUILTIN_ART, MEDAL_TIERS, bi, knownKey, canVerifyResults, defaultArtKey, formatElapsed, parseTime, resultsErrorKey,
  type ArtConfirmation, type BuiltinArt, type MedalRule, type MedalTemplate, type MedalTier, type ResultsSummary,
} from '@/lib/events-results';
import { messages, type MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Input, Select, SkeletonCard, useToast } from '@/components/shared';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';
import { BuiltinMedal, MedalArtImage } from '@/components/organizer/results/parts';
import { MedalArtDialog } from '@/components/organizer/results/medal-art-dialog';
import { useWriteError } from '@/components/organizer/results/result-dialogs';
import { useApp } from '../../../../app/providers';

const listOf = (r: { items?: MedalTemplate[] } | MedalTemplate[]): MedalTemplate[] => (Array.isArray(r) ? r : r.items ?? []);

export function ruleSummary(rule: MedalRule, t: (k: MessageKey) => string): string {
  if (rule.type === 'placing') return fmt(t(rule.scope === 'overall' ? 'organizer.results.medals.rule.placingOverall' : 'organizer.results.medals.rule.placing'), { n: rule.top });
  if (rule.type === 'time_under') return fmt(t('organizer.results.medals.rule.timeUnder'), { time: formatElapsed(rule.maxElapsedMs) });
  return t('organizer.results.medals.rule.finish');
}

export function MedalsPanel({ doc, role, readOnly, summary, artOn }: { doc: EventDocument; role: OrganizerRole | null; readOnly: boolean; summary: ResultsSummary | null; artOn: boolean }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [items, setItems] = useState<MedalTemplate[] | null>(null);
  const [confirmation, setConfirmation] = useState<ArtConfirmation | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [edit, setEdit] = useState<MedalTemplate | 'new' | null>(null);
  const [artFor, setArtFor] = useState<MedalTemplate | null>(null);
  const [removeFor, setRemoveFor] = useState<MedalTemplate | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const rErr = useWriteError();
  const writable = canVerifyResults(role) && !readOnly;
  const anyOfficial = (summary?.perCategory ?? []).some(c => c.release?.stage === 'official');
  const virtual = doc.type === 'virtual';

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { const r = await resultsApi.medalTemplates(token, doc.id); setItems(listOf(r)); setConfirmation(r.artConfirmation ?? null); } catch (e) { setError(resultsErrorKey(e)); }
  }, [token, doc.id]);
  useEffect(() => { void load(); }, [load]);
  // "About N people would get this medal" on a released scope (§7.1 late template).
  useEffect(() => {
    if (!token || !items || !anyOfficial) return;
    let live = true;
    Promise.all(items.map(m => resultsApi.previewMedalTemplate(token, doc.id, m.id).then(p => [m.id, p.wouldReceive ?? p.count ?? 0] as const).catch(() => null)))
      .then(rs => { if (live) setCounts(Object.fromEntries(rs.filter((r): r is readonly [string, number] => !!r))); });
    return () => { live = false; };
  }, [token, items, anyOfficial, doc.id]);
  const catName = (id?: string | null) => (id ? (summary?.perCategory.find(c => c.categoryId === id)?.name ?? doc.categories.find(c => c.id === id)?.name ?? '—') : t('organizer.results.medals.allCategories'));

  async function removeArt() {
    if (!token || !removeFor) return;
    setBusy(true); rErr.clear();
    try { await resultsApi.removeArt(token, doc.id, removeFor.id, newIdempotencyKey()); setRemoveFor(null); toast.success(t('organizer.results.art.removed')); await load(); }
    catch (e) { rErr.fail(e); } finally { setBusy(false); }
  }
  async function useBuiltin(m: MedalTemplate) {
    if (!token) return;
    try { if (m.art?.source === 'custom') await resultsApi.removeArt(token, doc.id, m.id, newIdempotencyKey()); toast.success(t('organizer.results.art.removed')); await load(); }
    catch (e) { toast.error(t(resultsErrorKey(e))); }
  }

  if (error) return <div data-testid="medals-error"><Alert tone="error">{t(error)}</Alert><div className="mt-2"><Button variant="secondary" onClick={() => void load()}>{t('common.tryAgain')}</Button></div></div>;
  if (!items) return <div aria-busy="true"><SkeletonCard /></div>;
  return (
    <div className="space-y-4" data-testid="results-medals">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.medals.title')}</h3>
        {writable && <Button className="min-h-11" onClick={() => setEdit('new')} data-testid="medal-add"><Plus aria-hidden="true" className="h-4 w-4" />{t('organizer.results.medals.add')}</Button>}
      </div>
      {!artOn && <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="medals-builtin-only">{t('organizer.results.art.builtinOnly')}</p>}
      {items.length === 0 ? (
        <EmptyState title={t('organizer.results.medals.empty')} action={writable ? <Button onClick={() => setEdit('new')} data-testid="medal-add-finisher">{t('organizer.results.medals.addFinisher')}</Button> : undefined} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map(m => {
            const name = bi(m.name, locale);
            const generated = fmt(t('organizer.results.art.generatedAlt'), { name, tier: t(`organizer.results.medals.tier.${m.tier}` as MessageKey) });
            const custom = artOn && m.art?.source === 'custom' && !!m.art.artId;
            const alt = (locale === 'sw' ? m.art?.altText?.sw : m.art?.altText?.en) || generated;
            return (
              <Card key={m.id}><CardContent>
                <article className="space-y-3" aria-label={name} data-testid={`medal-${m.id}`}>
                  <div className="flex items-start gap-4">
                    <MedalArtImage art={custom ? m.art : { ...m.art, source: 'builtin' }} tier={m.tier} virtual={virtual} path={custom ? resultsApi.artPreviewPath(doc.id, m.id, 240) : null} alt={alt} customEnabled={artOn} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-base font-semibold text-[var(--color-fg-primary)] [overflow-wrap:anywhere]" data-testid={`medal-name-${m.id}`}>{name}</p>
                      <p className="flex flex-wrap gap-1.5">
                        <Badge tone="gray">{t(`organizer.results.medals.tier.${m.tier}` as MessageKey)}</Badge>
                        <Badge tone={custom ? 'brand' : 'gray'}>{t(custom ? 'organizer.results.art.source.custom' : 'organizer.results.art.source.builtin')}</Badge>
                        {m.status === 'inactive' && <Badge tone="warning">{t('organizer.results.medals.inactive')}</Badge>}
                      </p>
                      <p className="text-sm text-[var(--color-fg-secondary)]" data-testid={`medal-rule-${m.id}`}>{ruleSummary(m.rule, t)} · {catName(m.categoryId)}</p>
                      {!m.name.sw && <p className="text-xs text-[var(--color-warning-800)]" data-testid={`medal-sw-missing-${m.id}`}>{t('organizer.results.medals.swMissing')}</p>}
                      {m.awardedCount != null && <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('organizer.results.medals.awarded'), { n: m.awardedCount })}</p>}
                      {m.id in counts && <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid={`medal-preview-${m.id}`}>{fmt(t('organizer.results.medals.preview'), { n: counts[m.id] })}</p>}
                      {m.locked && <p className="flex items-center gap-1 text-xs text-[var(--color-fg-quaternary)]"><Lock aria-hidden="true" className="h-3.5 w-3.5" />{t('organizer.results.medals.locked')}</p>}
                    </div>
                  </div>
                  {writable && (
                    <div className="flex flex-wrap gap-2">
                      <Button className="min-h-11" variant="secondary" onClick={() => setEdit(m)} data-testid={`medal-edit-${m.id}`}>{t('organizer.results.medals.edit')}</Button>
                      {artOn && <Button className="min-h-11" variant="secondary" onClick={() => setArtFor(m)} data-testid={`medal-upload-${m.id}`}>{t(custom ? 'organizer.results.art.replace' : 'organizer.results.art.upload')}</Button>}
                      {artOn && custom && <Button className="min-h-11" variant="ghost" onClick={() => void useBuiltin(m)} data-testid={`medal-builtin-${m.id}`}>{t('organizer.results.art.useBuiltin')}</Button>}
                      {artOn && custom && <Button className="min-h-11" variant="ghost" onClick={() => setRemoveFor(m)} data-testid={`medal-remove-${m.id}`}>{t('organizer.results.art.remove')}</Button>}
                    </div>
                  )}
                </article>
              </CardContent></Card>
            );
          })}
        </div>
      )}
      {edit && <MedalDialog doc={doc} summary={summary} virtual={virtual} template={edit === 'new' ? null : edit} released={anyOfficial} suggestFinisher={edit === 'new' && items.length === 0}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast.success(t('organizer.results.medals.saved')); void load(); }} />}
      <MedalArtDialog confirmation={confirmation} open={!!artFor} onClose={() => setArtFor(null)} eventId={doc.id} template={artFor} medalName={artFor ? bi(artFor.name, locale) : ''} onDone={() => { setArtFor(null); void load(); }} />
      <ConfirmDialog open={!!removeFor} onClose={() => setRemoveFor(null)} onConfirm={() => void removeArt()} busy={busy} tone="danger"
        title={t('organizer.results.art.remove')} description={rErr.error ? t(rErr.error.key) : t('organizer.results.art.removeBody')} confirmLabel={t('organizer.results.art.remove')} cancelLabel={t('common.cancel')} />
    </div>
  );
}

// ── Add / edit a medal (§9.2 Medals) ──
function MedalDialog({ doc, summary, virtual, template, released, suggestFinisher, onClose, onSaved }: {
  doc: EventDocument; summary: ResultsSummary | null; virtual: boolean; template: MedalTemplate | null; released: boolean; suggestFinisher: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { t, token } = useApp();
  const editing = !!template;
  const locked = !!template?.locked;
  const [nameEn, setNameEn] = useState(template?.name.en ?? (suggestFinisher ? messages.en['organizer.results.medals.finisherName'] : ''));
  const [nameSw, setNameSw] = useState(template?.name.sw ?? (suggestFinisher ? messages.sw['organizer.results.medals.finisherName'] : ''));
  const [descEn, setDescEn] = useState(template?.description?.en ?? '');
  const [descSw, setDescSw] = useState(template?.description?.sw ?? '');
  const [tier, setTier] = useState<MedalTier>(template?.tier ?? 'finisher');
  const [ruleType, setRuleType] = useState<MedalRule['type']>(template?.rule.type ?? 'finish');
  const [scope, setScope] = useState<'category' | 'overall'>(template?.rule.type === 'placing' ? template.rule.scope : 'category');
  const [top, setTop] = useState(String(template?.rule.type === 'placing' ? template.rule.top : 3));
  const [under, setUnder] = useState(template?.rule.type === 'time_under' ? formatElapsed(template.rule.maxElapsedMs) : '');
  const [categoryId, setCategoryId] = useState(template?.categoryId ?? '');
  const [status, setStatus] = useState(template?.status ?? 'active');
  const [artKey, setArtKey] = useState<BuiltinArt>((template?.art?.artKey as BuiltinArt) ?? defaultArtKey(template?.tier ?? 'finisher', virtual));
  const [artTouched, setArtTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  const cats = useMemo(() => summary?.perCategory.map(c => ({ id: c.categoryId, name: c.name })) ?? doc.categories.filter(c => c.id).map(c => ({ id: c.id as string, name: c.name })), [summary, doc.categories]);
  const pUnder = under.trim() ? parseTime(under) : null;
  const topN = Number(top);
  const ruleOk = ruleType === 'finish' || (ruleType === 'placing' ? Number.isInteger(topN) && topN >= 1 && topN <= 10 : !!pUnder?.ok);
  const valid = nameEn.trim().length > 0 && nameEn.trim().length <= 60 && nameSw.trim().length <= 60 && descEn.length <= 140 && descSw.length <= 140 && ruleOk;
  const pickTier = (v: MedalTier) => { setTier(v); if (!artTouched && template?.art?.source !== 'custom') setArtKey(defaultArtKey(v, virtual)); };
  const rule = (): MedalRule => (ruleType === 'placing' ? { type: 'placing', scope, top: topN } : ruleType === 'time_under' && pUnder?.ok ? { type: 'time_under', maxElapsedMs: pUnder.ms } : { type: 'finish' });
  async function save() {
    if (!token) return;
    setBusy(true); err.clear();
    // Names, description, tier, art design and status stay editable after release; rule and category do not (409 template_locked).
    const base = { name: { en: nameEn.trim(), sw: nameSw.trim() }, description: { en: descEn.trim(), sw: descSw.trim() }, tier, status, ...(template?.art?.source === 'custom' && !artTouched ? {} : { artKey }) };
    try {
      if (editing) await resultsApi.updateMedalTemplate(token, doc.id, template!.id, locked ? base : { ...base, rule: rule(), categoryId: categoryId || null }, key.current);
      else await resultsApi.createMedalTemplate(token, doc.id, { ...base, rule: rule(), categoryId: categoryId || null }, key.current);
      onSaved();
    } catch (e) { err.fail(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={t(editing ? 'organizer.results.medals.edit' : 'organizer.results.medals.add')} size="lg">
      <div className="space-y-4" data-testid="medal-dialog">
        {err.view && <div data-testid="medal-error">{err.view}</div>}
        {released && !editing && <div data-testid="medal-released-note"><Alert tone="info">{t('organizer.results.medals.releasedNote')}</Alert></div>}
        {locked && <p className="flex items-center gap-1 text-sm text-[var(--color-fg-secondary)]"><Lock aria-hidden="true" className="h-4 w-4" />{t('organizer.results.medals.locked')}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${t('organizer.results.medals.name')} (EN)`} required><Input value={nameEn} maxLength={60} onChange={e => setNameEn(e.target.value)} data-testid="medal-name-en" /></Field>
          <Field label={`${t('organizer.results.medals.name')} (SW)`} hint={nameSw.trim() ? undefined : t('organizer.results.medals.swMissing')}><Input value={nameSw} maxLength={60} onChange={e => setNameSw(e.target.value)} data-testid="medal-name-sw" /></Field>
          <Field label={`${t('organizer.results.medals.description')} (EN)`} hint="≤ 140"><Input value={descEn} maxLength={140} onChange={e => setDescEn(e.target.value)} data-testid="medal-desc-en" /></Field>
          <Field label={`${t('organizer.results.medals.description')} (SW)`} hint="≤ 140"><Input value={descSw} maxLength={140} onChange={e => setDescSw(e.target.value)} data-testid="medal-desc-sw" /></Field>
          <Field label={t('organizer.results.medals.tier')}>
            <Select value={tier} onChange={e => pickTier(e.target.value as MedalTier)} data-testid="medal-tier">
              {MEDAL_TIERS.map(x => <option key={x} value={x}>{t(`organizer.results.medals.tier.${x}` as MessageKey)}</option>)}
            </Select>
          </Field>
          <Field label={t('organizer.results.medals.category')}>
            <Select value={categoryId} disabled={locked} onChange={e => setCategoryId(e.target.value)} data-testid="medal-category">
              <option value="">{t('organizer.results.medals.allCategories')}</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={t('organizer.results.medals.rule')}>
            <Select value={ruleType} disabled={locked} onChange={e => setRuleType(e.target.value as MedalRule['type'])} data-testid="medal-rule">
              <option value="finish">{t('organizer.results.medals.ruleType.finish')}</option>
              <option value="placing">{t('organizer.results.medals.ruleType.placing')}</option>
              <option value="time_under">{t('organizer.results.medals.ruleType.timeUnder')}</option>
            </Select>
          </Field>
          {editing && (
            <Field label={t('organizer.results.col.status')}>
              <Select value={status} onChange={e => setStatus(e.target.value as 'active' | 'inactive')} data-testid="medal-status">
                <option value="active">{t('organizer.results.medals.active')}</option><option value="inactive">{t('organizer.results.medals.inactive')}</option>
              </Select>
            </Field>
          )}
          {ruleType === 'placing' && (
            <>
              <Field label={t('organizer.results.medals.placingScope')}>
                <Select value={scope} disabled={locked} onChange={e => setScope(e.target.value as 'category' | 'overall')} data-testid="medal-scope">
                  <option value="category">{t('organizer.results.medals.scope.category')}</option><option value="overall">{t('organizer.results.medals.scope.overall')}</option>
                </Select>
              </Field>
              <Field label={t('organizer.results.medals.top')} hint="1–10"><Input inputMode="numeric" value={top} disabled={locked} onChange={e => setTop(e.target.value.replace(/\D/g, ''))} data-testid="medal-top" /></Field>
            </>
          )}
          {ruleType === 'time_under' && (
            <Field label={t('organizer.results.medals.underTime')} hint="H:MM:SS" error={pUnder && !pUnder.ok ? t('organizer.results.problem.time_invalid') : undefined}>
              <Input value={under} disabled={locked} className="font-mono" onChange={e => setUnder(e.target.value)} data-testid="medal-under" />
            </Field>
          )}
        </div>
        <fieldset className="space-y-2" data-testid="medal-art-picker">
          <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('organizer.results.art.title')}: {t('organizer.results.art.useBuiltin')}</legend>
          <div role="radiogroup" aria-label={t('organizer.results.art.builtinGroup')} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BUILTIN_ART.map(k => (
              <label key={k} className={`flex min-h-14 cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] p-2 ring-1 ring-inset focus-within:ring-2 focus-within:ring-[var(--color-brand-500)] ${artKey === k ? 'ring-2 ring-[var(--color-brand-600)]' : 'ring-[var(--color-border-secondary)]'}`}>
                <input type="radio" name="builtinArt" className="sr-only" checked={artKey === k} onChange={() => { setArtKey(k); setArtTouched(true); }} data-testid={`art-${k}`} />
                <span className="h-11 w-11 shrink-0"><BuiltinMedal artKey={k} /></span>
                <span className="text-xs text-[var(--color-fg-primary)]">{t(`organizer.results.art.builtin.${k}` as MessageKey)}</span>
              </label>
            ))}
          </div>
          {template?.art?.source === 'custom' && !artTouched && <p className="text-xs text-[var(--color-fg-quaternary)]">{t('organizer.results.art.customKept')}</p>}
        </fieldset>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={!valid} onClick={() => void save()} data-testid="medal-save">{t('organizer.results.medals.save')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
