'use client';
// Events S6 (spec §9.1 to §9.3): the Results tab of an organizer event. Sections: Overview, Import, Results, Disputes, Medals, Settings.
// Deep link: `/organizer/events?event=<id>&view=results[&section=…][&registration=<id>][&category=<id>]` (query params only: static export).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag, Lock } from 'lucide-react';
import type { EventDocument, OrganizerRole } from '@/lib/api';
import { fmt } from '@/lib/events';
import { resultsApi } from '@/lib/events-results-api';
import {
  DISPUTE_WINDOW_DAYS, canEnterResults, canVerifyResults, isResultSection, resultsOf, resultsOpenFor, sectionsFor,
  type CategoryResultsSummary, type ResultSection, type ResultsSummary, type ResultsSettings,
} from '@/lib/events-results';
import { newIdempotencyKey } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Card, CardContent, EmptyState, Field, Input, MetricCard, Radio, Segmented, Select, SkeletonCard, useToast } from '@/components/shared';
import { ConfirmDialog } from '@/components/dialog';
import { useEventsOptions } from '@/components/events-options';
import { OrganizerForbidden, useDocumentTitle } from '@/components/organizer/page-states';
import { StageBadge } from '@/components/organizer/results/parts';
import { BulkApproveDialog, ReleaseDialog, useWriteError } from '@/components/organizer/results/result-dialogs';
import { ResultsImport } from '@/components/organizer/results/results-import';
import { ResultsTable } from '@/components/organizer/results/results-table';
import { ResultsDisputes } from '@/components/organizer/results/results-disputes';
import { MedalsPanel } from '@/components/organizer/results/results-medals';
import { useApp } from '../../../../app/providers';

type Params = Partial<Record<'section' | 'registration' | 'category' | 'status', string | null>>;
function readParam(name: string) { return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name); }

export function ResultsView({ doc, role, readOnly }: { doc: EventDocument; role: OrganizerRole | null; readOnly: boolean }) {
  const { t, token } = useApp();
  const options = useEventsOptions();
  const flags = resultsOf(options);
  useDocumentTitle(`${doc.title} · ${t('organizer.events.view.results')}`);
  const sections = sectionsFor(role, flags.rewards);
  // The requested section is kept as asked and resolved against what this role and the server flags allow (the flags arrive after first render).
  const [requested, setSection] = useState<string | null>(() => readParam('section'));
  const section: ResultSection = isResultSection(requested) && sections.includes(requested) ? requested : role === 'timing' ? 'import' : 'overview';
  const [registration, setRegistration] = useState<string | null>(() => readParam('registration'));
  const [category, setCategory] = useState<string>(() => readParam('category') ?? '');
  const [status, setStatus] = useState<string>(() => readParam('status') ?? '');
  const [summary, setSummary] = useState<ResultsSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'partial' | 'forbidden'>('loading');
  const stageRef = useRef<HTMLHeadingElement>(null);

  const setParams = useCallback((p: Params) => {
    const q = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(p)) { if (v) q.set(k, v); else q.delete(k); }
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
  }, []);
  const go = useCallback((s: ResultSection, extra: { category?: string; status?: string } = {}) => {
    setSection(s); setRegistration(null);
    if (extra.category !== undefined) setCategory(extra.category);
    if (extra.status !== undefined) setStatus(extra.status);
    setParams({ section: s, registration: null, category: extra.category ?? category, status: extra.status ?? status });
  }, [category, status, setParams]);
  const openRegistration = useCallback((id: string | null) => { setRegistration(id); setParams({ registration: id }); }, [setParams]);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    try { setSummary(await resultsApi.summary(token, doc.id)); setState('ok'); }
    catch (err) { setState((err as { status?: number })?.status === 403 ? 'forbidden' : 'partial'); }
  }, [token, doc.id]);
  useEffect(() => { if (options && flags.enabled && resultsOpenFor(doc.status)) void loadSummary(); }, [options, flags.enabled, doc.status, loadSummary]);

  if (options === undefined) return <div aria-busy="true"><SkeletonCard /></div>;
  if (!flags.enabled) return <div data-testid="results-unavailable"><EmptyState icon={<Flag />} title={t('organizer.results.unavailable')} /></div>;
  if (!canEnterResults(role)) return <OrganizerForbidden backHref="/organizer/events" />;
  if (!resultsOpenFor(doc.status)) return <div data-testid="results-not-started"><EmptyState icon={<Flag />} title={t('organizer.results.notStarted')} /></div>;
  if (state === 'forbidden') return <OrganizerForbidden backHref="/organizer/events" />;
  const owner = canVerifyResults(role);
  const disputes = summary?.disputesOpen ?? 0;

  return (
    <div className="space-y-4" data-testid="results-view">
      <h2 ref={stageRef} tabIndex={-1} className="text-lg font-semibold text-[var(--color-fg-primary)] outline-none">{t('organizer.events.view.results')}</h2>
      {readOnly && <div data-testid="results-suspended"><Alert tone="warning"><span className="inline-flex items-center gap-2"><Lock aria-hidden="true" className="h-4 w-4" />{t('organizer.results.suspended')}</span></Alert></div>}
      {doc.status === 'cancelled' && <Alert tone="warning">{t('organizer.results.cancelled')}</Alert>}
      <div className="max-w-full overflow-x-auto" data-testid="results-sections">
        <Segmented className="w-fit" value={section} onChange={v => go(v as ResultSection)}
          options={sections.map(s => [s, s === 'disputes' && disputes > 0 && owner ? `${t('organizer.results.section.disputes')} (${disputes})` : t(`organizer.results.section.${s}` as MessageKey)] as [string, string])} />
      </div>
      {state === 'partial' && section === 'overview' && <div data-testid="results-partial"><Alert tone="warning">{t('organizer.results.partial')}</Alert></div>}
      {section === 'overview' && <Overview doc={doc} role={role} readOnly={readOnly} summary={summary} loading={state === 'loading'} onChanged={() => void loadSummary()} go={go} focusHeading={() => stageRef.current?.focus()} />}
      {section === 'import' && <ResultsImport doc={doc} role={role} readOnly={readOnly} summary={summary} onApplied={() => void loadSummary()} go={go} />}
      {section === 'results' && <ResultsTable doc={doc} role={role} readOnly={readOnly} summary={summary} category={category} status={status} registration={registration}
        onFilters={(c, s) => { setCategory(c); setStatus(s); setParams({ category: c, status: s }); }} onOpen={openRegistration} onChanged={() => void loadSummary()} />}
      {section === 'disputes' && <ResultsDisputes doc={doc} role={role} readOnly={readOnly} onChanged={() => void loadSummary()} onOpenResult={id => { go('results'); openRegistration(id); }} />}
      {section === 'medals' && flags.rewards && <MedalsPanel doc={doc} role={role} readOnly={readOnly} summary={summary} artOn={flags.medalArt} />}
      {section === 'settings' && owner && <ResultsSettingsCard doc={doc} readOnly={readOnly} summary={summary} onSaved={() => void loadSummary()} />}
    </div>
  );
}

// ── Overview (§9.2) ──
const STEPS = ['import', 'review', 'release', 'medals'] as const;
function currentStep(s: ResultsSummary | null): number {
  const cats = s?.perCategory ?? [];
  if (!cats.length || cats.every(c => c.finished + c.dnf + c.dns + c.dq + c.pending + c.rejected === 0)) return 0;
  if (cats.some(c => c.pending > 0)) return 1;
  if (cats.every(c => c.release?.stage === 'official')) return 3;
  return 2;
}

function Overview({ doc, role, readOnly, summary, loading, onChanged, go, focusHeading }: {
  doc: EventDocument; role: OrganizerRole | null; readOnly: boolean; summary: ResultsSummary | null; loading: boolean; onChanged: () => void;
  go: (s: ResultSection, extra?: { category?: string; status?: string }) => void; focusHeading: () => void;
}) {
  const { t, token } = useApp();
  const toast = useToast();
  const owner = canVerifyResults(role) && !readOnly;
  const [release, setRelease] = useState<{ cat: CategoryResultsSummary; stage: 'provisional' | 'official' } | null>(null);
  const [bulk, setBulk] = useState<CategoryResultsSummary | null>(null);
  const [withdraw, setWithdraw] = useState<CategoryResultsSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const wErr = useWriteError();
  const live = useRef<HTMLParagraphElement>(null);
  const announce = (text: string) => { if (live.current) live.current.textContent = text; };
  const step = currentStep(summary);
  const withdrawKey = useRefKey();
  if (loading) return <div aria-busy="true" className="grid gap-4 lg:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>;
  const cats = summary?.perCategory ?? [];
  async function doWithdraw() {
    if (!token || !withdraw) return;
    setBusy(true); wErr.clear();
    try { await resultsApi.withdrawRelease(token, doc.id, { categoryId: withdraw.categoryId }, withdrawKey.current()); setWithdraw(null); toast.success(t('organizer.results.withdraw.done')); announce(t('organizer.results.withdraw.done')); onChanged(); }
    catch (e) { wErr.fail(e); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4" data-testid="results-overview">
      <p ref={live} role="status" aria-live="polite" className="sr-only" data-testid="results-live" />
      <ol className="flex flex-wrap gap-2 text-sm" aria-label={t('organizer.results.stepsLabel')} data-testid="results-steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} data-step={s} className={i === step ? 'rounded-full bg-[var(--color-brand-50)] px-3 py-1 font-semibold text-[var(--color-brand-700)] ring-1 ring-[var(--color-brand-200)]' : 'rounded-full px-3 py-1 text-[var(--color-fg-tertiary)]'}>
            {i + 1} {t(`organizer.results.step.${s}` as MessageKey)}
          </li>
        ))}
      </ol>
      {cats.length === 0 ? <EmptyState title={t('organizer.results.empty')} action={canEnterResults(role) && !readOnly ? <Button onClick={() => go('import')}>{t('organizer.results.section.import')}</Button> : undefined} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cats.map(c => {
            const stage = c.release?.stage ?? 'none';
            const settled = c.finished + c.dnf + c.dns + c.dq + c.rejected;
            const total = Math.max(c.confirmed, settled + c.pending);
            const pct = total ? Math.round((settled / total) * 100) : 0;
            return (
              <Card key={c.categoryId}><CardContent>
                <section className="space-y-3" aria-labelledby={`cat-${c.categoryId}`} data-testid={`results-cat-${c.categoryId}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id={`cat-${c.categoryId}`} className="font-semibold text-[var(--color-fg-primary)]">{c.name}{c.distanceMeters ? ` · ${c.distanceMeters / 1000}K` : ''}</h3>
                    <span data-testid={`results-stage-${c.categoryId}`}><StageBadge stage={stage} /></span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <MetricCard wrapLabel label={t('organizer.results.status.finished')} value={c.finished} />
                    <MetricCard wrapLabel label={t('organizer.results.status.dnf')} value={c.dnf} />
                    <MetricCard wrapLabel label={t('organizer.results.status.dns')} value={c.dns} />
                    <MetricCard wrapLabel label={t('organizer.results.status.dq')} value={c.dq} />
                    <MetricCard wrapLabel label={t('organizer.results.status.pending')} value={c.pending} />
                    <MetricCard wrapLabel label={t('organizer.results.status.noResult')} value={c.noResult} />
                  </div>
                  <div>
                    <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={settled} aria-label={fmt(t('organizer.results.settledOf'), { a: settled, b: total })} className="h-2 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
                      <div className="h-full bg-[var(--color-brand-600)]" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-fg-quaternary)]" data-testid={`results-settled-${c.categoryId}`}>{fmt(t('organizer.results.settledOf'), { a: settled, b: total })}</p>
                  </div>
                  {c.flagged > 0 && <p className="text-sm text-[var(--color-fg-secondary)]">{fmt(t('organizer.results.flaggedCount'), { n: c.flagged })}</p>}
                  {c.release?.releasedAt && <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('organizer.results.releasedBy'), { name: c.release.releasedBy?.name ?? '—' })}</p>}
                  <div className="flex flex-wrap gap-2">
                    {owner && stage !== 'official' && <Button className="min-h-11" variant="secondary" onClick={() => setRelease({ cat: c, stage: 'provisional' })} data-testid={`release-prov-${c.categoryId}`}>{t('organizer.results.release.provisional')}</Button>}
                    {owner && stage !== 'official' && <Button className="min-h-11" onClick={() => setRelease({ cat: c, stage: 'official' })} data-testid={`release-off-${c.categoryId}`}>{t('organizer.results.release.official')}</Button>}
                    {owner && c.pending > 0 && <Button className="min-h-11" variant="secondary" onClick={() => setBulk(c)} data-testid={`approve-clean-${c.categoryId}`}>{fmt(t('organizer.results.action.approveClean'), { n: c.pending - c.flagged })}</Button>}
                    {owner && stage === 'provisional' && <Button className="min-h-11" variant="ghost" onClick={() => setWithdraw(c)} data-testid={`withdraw-${c.categoryId}`}>{t('organizer.results.release.withdraw')}</Button>}
                    {canEnterResults(role) && !readOnly && <Button className="min-h-11" variant="ghost" onClick={() => go('import', { category: c.categoryId })}>{t('organizer.results.section.import')}</Button>}
                  </div>
                </section>
              </CardContent></Card>
            );
          })}
        </div>
      )}
      {release && (
        <ReleaseDialog open onClose={() => setRelease(null)} eventId={doc.id} categoryId={release.cat.categoryId} categoryName={release.cat.name} stage={release.stage}
          onDone={() => { setRelease(null); toast.success(t('organizer.results.release.done')); announce(t('organizer.results.release.done')); focusHeading(); onChanged(); }} />
      )}
      {bulk && (
        <BulkApproveDialog open onClose={() => setBulk(null)} eventId={doc.id} categoryId={bulk.categoryId}
          onDone={n => { setBulk(null); toast.success(fmt(t('organizer.results.bulk.done'), { n })); announce(fmt(t('organizer.results.bulk.done'), { n })); onChanged(); }} />
      )}
      <ConfirmDialog open={!!withdraw} onClose={() => setWithdraw(null)} onConfirm={() => void doWithdraw()} busy={busy} tone="danger"
        title={t('organizer.results.release.withdraw')} description={wErr.error ? undefined : t('organizer.results.withdraw.body')} confirmLabel={t('organizer.results.release.withdraw')} cancelLabel={t('common.cancel')} />
      {wErr.view}
    </div>
  );
}

/** One Idempotency-Key per attempt: a new key only after a success (the same key rides a retry). */
function useRefKey() {
  const k = useRef(newIdempotencyKey());
  return { current: () => k.current };
}

// ── Settings (§9.2 Settings, §8.1 PATCH results-settings) ──
function ResultsSettingsCard({ doc, readOnly, summary, onSaved }: { doc: EventDocument; readOnly: boolean; summary: ResultsSummary | null; onSaved: () => void }) {
  const { t, token } = useApp();
  const toast = useToast();
  const s = summary?.settings ?? {};
  const locked = summary?.perCategory?.some(c => c.release?.stage === 'official') ?? false;
  const [basis, setBasis] = useState<'net' | 'gun'>(s.timeBasis ?? 'net');
  const [cutoff, setCutoff] = useState(s.cutoffMinutes ? String(s.cutoffMinutes) : '');
  const [days, setDays] = useState(String(Math.round((s.disputeWindowHours ?? 168) / 24)));
  const [names, setNames] = useState<'initial' | 'bib_only'>(s.publicNames ?? 'initial');
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  // Reset the form only when the SAVED settings really change, never because a refresh returned the same values (that would drop unsaved edits).
  const savedKey = JSON.stringify(s);
  useEffect(() => { setBasis(s.timeBasis ?? 'net'); setCutoff(s.cutoffMinutes ? String(s.cutoffMinutes) : ''); setDays(String(Math.round((s.disputeWindowHours ?? 168) / 24))); setNames(s.publicNames ?? 'initial'); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  const cutoffNum = cutoff.trim() ? Number(cutoff) : null;
  const cutoffOk = cutoffNum === null || (Number.isInteger(cutoffNum) && cutoffNum >= 1 && cutoffNum <= 1440);
  const dayOptions = Array.from(new Set([...DISPUTE_WINDOW_DAYS, Number(days)])).sort((a, b) => a - b);
  async function save() {
    if (!token) return;
    setBusy(true); err.clear();
    // After the first official release only extending the dispute window is allowed (§8.1 `settings_locked`).
    const body: ResultsSettings = locked ? { disputeWindowHours: Number(days) * 24 } : { timeBasis: basis, cutoffMinutes: cutoffNum, disputeWindowHours: Number(days) * 24, publicNames: names };
    try { await resultsApi.saveSettings(token, doc.id, body, key.current); key.current = newIdempotencyKey(); toast.success(t('organizer.results.settings.saved')); onSaved(); }
    catch (e) { err.fail(e); } finally { setBusy(false); }
  }
  const dis = readOnly || busy;
  return (
    <Card><CardContent>
      <div className="space-y-4" data-testid="results-settings">
        <h3 className="font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.section.settings')}</h3>
        {locked && <div data-testid="settings-locked"><Alert tone="info">{t('organizer.results.settings.locked')}</Alert></div>}
        {err.view}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('organizer.results.import.basis')}>
            <Select value={basis} disabled={dis || locked} onChange={e => setBasis(e.target.value as 'net' | 'gun')} data-testid="settings-basis">
              <option value="net">{t('organizer.results.basis.net')}</option><option value="gun">{t('organizer.results.basis.gun')}</option>
            </Select>
          </Field>
          <Field label={t('organizer.results.settings.cutoff')} error={cutoffOk ? undefined : t('organizer.results.settings.cutoffInvalid')}>
            <Input inputMode="numeric" value={cutoff} disabled={dis || locked} onChange={e => setCutoff(e.target.value.replace(/\D/g, ''))} data-testid="settings-cutoff" />
          </Field>
          <Field label={t('organizer.results.settings.disputeWindow')}>
            <Select value={days} disabled={dis} onChange={e => setDays(e.target.value)} data-testid="settings-window">
              {dayOptions.map(d => <option key={d} value={d}>{fmt(t('organizer.results.settings.days'), { n: d })}</option>)}
            </Select>
          </Field>
        </div>
        <fieldset className="space-y-1" disabled={dis || locked}>
          <legend className="mb-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('organizer.results.settings.names')}</legend>
          <div className="min-h-11"><Radio name="publicNames" label={t('organizer.results.settings.names.initial')} checked={names === 'initial'} onChange={() => setNames('initial')} data-testid="settings-names-initial" /></div>
          <div className="min-h-11"><Radio name="publicNames" label={t('organizer.results.settings.names.bib')} checked={names === 'bib_only'} onChange={() => setNames('bib_only')} data-testid="settings-names-bib" /></div>
        </fieldset>
        {!readOnly && <div className="flex justify-end"><Button loading={busy} disabled={!cutoffOk} onClick={() => void save()} data-testid="settings-save">{t('organizer.results.settings.save')}</Button></div>}
      </div>
    </CardContent></Card>
  );
}

