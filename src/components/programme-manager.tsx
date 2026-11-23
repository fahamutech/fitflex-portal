'use client';
// Programmes P1, slice PO1 (docs/design/programmes-p1.md §3 in the parent repo): staff write FitFlex
// programmes — fixed-length, day-by-day plans of gym, home and rest days. The list, and one programme at a
// time (?id=<id>, or ?id=new). Same admin scope as the exercise library (PD-7). Authoring works while the
// member flag is off; the list says so. A live programme is changed only by making a new draft version.
import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, ApiError, Exercise } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import {
  blankDays, checkProgramme, MAX_SETS, MAX_WORKOUT_EXERCISES, Programme, ProgrammeDay, ProgrammeDayType, ProgrammeExercise,
  ProgrammeInput, ProgrammeStatus, ProgrammeWorkout, programmesApi, PROGRAMME_ENVIRONMENTS, PROGRAMME_EQUIPMENT, PROGRAMME_GOALS,
  PROGRAMME_LENGTH, PROGRAMME_LEVELS, WORKOUT_ACTIVITY_TYPES,
} from '@/lib/programmes';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, PageHeader, Spinner } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';

type T = (key: MessageKey) => string;
const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
/** A vocabulary word (goal, level, place, equipment, kind); an unknown id is shown in plain words. */
const word = (t: T, id: string) => t(`prog.v.${id}` as MessageKey) || id.replace(/_/g, ' ');
const TYPES: ProgrammeDayType[] = ['gym', 'home', 'rest'];
const STATUS_TONE: Record<ProgrammeStatus, 'warning' | 'success' | 'gray'> = { draft: 'warning', live: 'success', retired: 'gray' };

/** The server's refusal in staff words. */
function problem(t: T, e: unknown): string {
  if (!(e instanceof ApiError)) return t('prog.err.generic');
  const body = (e.body ?? {}) as { error?: string; field?: string; reason?: string };
  if (body.error === 'not_a_draft') return t('prog.err.notDraft');
  if (body.error === 'not_live') return t('prog.err.notLive');
  if (body.error === 'not_found') return t('prog.notFound');
  if (body.error === 'acl_forbidden' || e.status === 403) return t('prog.err.forbidden');
  if (body.error !== 'invalid_programme' && body.error !== 'not_ready_to_publish') return t('prog.err.generic');
  const day = /^days\[(\d+)\]/.exec(body.field ?? '');
  let what: string;
  if (day) {
    const n = Number(day[1]) + 1;
    const reason = body.reason ? t(`prog.err.r.${body.reason}` as MessageKey) : '';
    what = fill(reason || (body.error === 'not_ready_to_publish' ? t('prog.err.f.dayExercise') : t('prog.err.f.day')), { n });
  } else {
    const key = body.field === 'i18n.sw.title' ? 'swTitle' : body.field === 'i18n.sw.summary' ? 'swSummary' : body.field ?? '';
    what = t(`prog.err.f.${key}` as MessageKey) || body.field || '';
  }
  return fill(t(body.error === 'not_ready_to_publish' ? 'prog.err.notReady' : 'prog.err.invalid'), { problem: what });
}

const formatDate = (iso: string | null | undefined, locale: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(+d) ? '—' : d.toLocaleDateString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Dar_es_Salaam' });
};

export function ProgrammeManager() {
  const [openId, setOpenId] = useState<string | null>(null);
  // The open programme lives in the URL so it survives a refresh (static export: no dynamic routes).
  useEffect(() => {
    const sync = () => setOpenId(new URLSearchParams(window.location.search).get('id'));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const open = (id: string | null) => {
    history.pushState(null, '', id ? `?id=${encodeURIComponent(id)}` : window.location.pathname);
    setOpenId(id);
  };
  return openId ? <ProgrammeEditor key={openId} id={openId} onOpen={open} /> : <ProgrammeList onOpen={open} />;
}

// ── List ──────────────────────────────────────────────────────────────────

function ProgrammeList({ onOpen }: { onOpen: (id: string) => void }) {
  const { token, t, locale } = useApp();
  const [rows, setRows] = useState<Programme[] | null>(null);
  const [catalogueOn, setCatalogueOn] = useState(true);
  const [status, setStatus] = useState<ProgrammeStatus | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const r = await programmesApi.list(token);
      setRows(Array.isArray(r?.programmes) ? r.programmes : []);
      setCatalogueOn(r?.catalogueOn === true);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? t('prog.err.forbidden') : t('prog.loadError'));
      setRows(prev => prev ?? []);
    }
  }, [token, t]);
  useEffect(() => { void load(); }, [load]);

  const shown = (rows ?? []).filter(p => status === 'all' || p.status === status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('prog.title')}
        description={t('prog.description')}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('prog.refresh')}</Button>
            <Button size="sm" onClick={() => onOpen('new')} data-testid="programme-new"><Plus className="h-4 w-4" />{t('prog.new')}</Button>
          </>
        }
      />
      {!catalogueOn && rows !== null && <Alert tone="info"><span data-testid="programme-flag-off">{t('prog.flagOff')}</span></Alert>}
      {error && (
        <Alert tone="error">
          <span data-testid="programme-load-error">{error}</span>{' '}
          <button className="underline" onClick={() => void load()}>{t('prog.retry')}</button>
        </Alert>
      )}
      <Field label={t('prog.filter.status')}>
        <select className="ui-input w-48" value={status} onChange={e => setStatus(e.target.value as ProgrammeStatus | 'all')} data-testid="programme-status-filter">
          <option value="all">{t('prog.filter.all')}</option>
          {(['draft', 'live', 'retired'] as const).map(s => <option key={s} value={s}>{t(`prog.status.${s}`)}</option>)}
        </select>
      </Field>
      {rows === null ? (
        <div className="flex h-40 items-center justify-center" role="status" aria-label={t('prog.loading')}><Spinner className="h-6 w-6" /></div>
      ) : rows.length === 0 ? (
        !error && <EmptyState title={t('prog.empty.title')} body={t('prog.empty.body')}
          action={<Button size="sm" onClick={() => onOpen('new')}><Plus className="h-4 w-4" />{t('prog.new')}</Button>} />
      ) : shown.length === 0 ? (
        <EmptyState title={t('prog.noMatch')} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm" data-testid="programme-table">
              <thead className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-tertiary)]">
                <tr>
                  {(['title', 'goal', 'level', 'length', 'where', 'status', 'enrolled', 'updated'] as const).map(c => (
                    <th key={c} className="px-4 py-3 font-medium">{t(`prog.col.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(p => (
                  <tr key={p.id} className="border-b border-[var(--color-border-secondary)] last:border-0" data-testid={`programme-row-${p.id}`}>
                    <td className="px-4 py-3">
                      <button className="text-left font-medium text-[var(--color-fg-primary)] underline-offset-2 hover:underline" onClick={() => onOpen(p.id)} data-testid={`programme-open-${p.id}`}>
                        {locale === 'sw' && p.i18n?.sw?.title ? p.i18n.sw.title : p.title}
                      </button>
                    </td>
                    <td className="px-4 py-3">{word(t, p.goal)}</td>
                    <td className="px-4 py-3">{word(t, p.level)}</td>
                    <td className="px-4 py-3 tabular-nums">{fill(t('prog.days'), { n: p.lengthDays })}</td>
                    <td className="px-4 py-3">{word(t, p.environment)}</td>
                    <td className="px-4 py-3"><Badge tone={STATUS_TONE[p.status] ?? 'gray'} dot>{t(`prog.status.${p.status}` as MessageKey) || p.status}</Badge></td>
                    <td className="px-4 py-3 tabular-nums">{p.enrolled ?? 0}</td>
                    <td className="px-4 py-3">{formatDate(p.updatedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────

const NEW: ProgrammeInput = {
  title: '', summary: '', i18n: { sw: { title: '', summary: '' } },
  goal: 'stay_fit', level: 'beginner', environment: 'home', equipment: ['none'], lengthDays: 7, days: blankDays(7),
};

/** What is sent: trimmed text, empty Swahili left out, rest days without workouts. */
function toInput(f: ProgrammeInput): ProgrammeInput {
  const sw = { title: f.i18n?.sw?.title?.trim() || undefined, summary: f.i18n?.sw?.summary?.trim() || undefined };
  return {
    ...f,
    title: f.title.trim(),
    summary: f.summary?.trim() || null,
    i18n: sw.title || sw.summary ? { sw } : null,
    days: f.days.map(d => (d.type === 'rest' || !d.workout ? { day: d.day, type: d.type } : { day: d.day, type: d.type, workout: d.workout })),
  };
}

function ProgrammeEditor({ id, onOpen }: { id: string; onOpen: (id: string | null) => void }) {
  const { token, t } = useApp();
  const isNew = id === 'new';
  const [saved, setSaved] = useState<Programme | null>(null);
  const [f, setF] = useState<ProgrammeInput | null>(isNew ? NEW : null);
  const [library, setLibrary] = useState<Exercise[] | null>(null);
  const [libraryFailed, setLibraryFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dayOpen, setDayOpen] = useState<number | null>(null);
  const [clipboard, setClipboard] = useState<ProgrammeDay | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    if (!isNew) {
      programmesApi.get(token, id)
        .then(r => {
          if (!live) return;
          const p = r.programme;
          setSaved(p);
          setF({
            title: p.title ?? '', summary: p.summary ?? '',
            i18n: { sw: { title: p.i18n?.sw?.title ?? '', summary: p.i18n?.sw?.summary ?? '' } },
            goal: p.goal, level: p.level, environment: p.environment, equipment: p.equipment ?? [],
            lengthDays: p.lengthDays, days: blankDays(p.lengthDays, p.days ?? []),
          });
        })
        .catch(e => { if (live) setLoadError(problem(t, e)); });
    }
    api.adminExercises(token)
      .then(r => { if (live) setLibrary(Array.isArray(r?.exercises) ? r.exercises.filter(e => e.active !== false) : []); })
      .catch(() => { if (live) { setLibrary([]); setLibraryFailed(true); } });
    return () => { live = false; };
  }, [token, id, isNew, t]);

  const editable = isNew || saved?.status === 'draft';
  const check = useMemo(() => (f ? checkProgramme(toInput(f)) : { blocking: [], warnings: [] }), [f]);
  const set = <K extends keyof ProgrammeInput>(k: K, v: ProgrammeInput[K]) => setF(prev => (prev ? { ...prev, [k]: v } : prev));
  const setSw = (k: 'title' | 'summary', v: string) =>
    setF(prev => (prev ? { ...prev, i18n: { sw: { ...prev.i18n?.sw, [k]: v } } } : prev));
  const setDay = (n: number, d: ProgrammeDay) => setF(prev => (prev ? { ...prev, days: prev.days.map(x => (x.day === n ? { ...d, day: n } : x)) } : prev));
  const setLength = (raw: string) => {
    const n = Number(raw);
    setF(prev => {
      if (!prev) return prev;
      if (!Number.isInteger(n) || n < PROGRAMME_LENGTH.min || n > PROGRAMME_LENGTH.max) return { ...prev, lengthDays: n };
      return { ...prev, lengthDays: n, days: blankDays(n, prev.days) };
    });
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setDone(null);
    try { await action(); } catch (e) { setError(problem(t, e)); } finally { setBusy(false); }
  };

  /** Saves the form; a new programme becomes a draft with its own address. Returns the saved programme. */
  const save = async (): Promise<Programme> => {
    if (!token || !f) throw new Error('not ready');
    if (isNew) {
      const { programme } = await programmesApi.create(token, toInput(f));
      return programme;
    }
    const { programme } = await programmesApi.update(token, id, toInput(f));
    setSaved(programme);
    return programme;
  };

  const saveDraft = () => run(async () => {
    const p = await save();
    if (isNew) onOpen(p.id); else setDone(t('prog.saved'));
  });
  const publish = () => run(async () => {
    if (!token || !f || !window.confirm(fill(t('prog.publishConfirm'), { title: f.title.trim() }))) return;
    const p = await save();
    const { programme } = await programmesApi.publish(token, p.id);
    if (isNew) { onOpen(programme.id); return; }
    setSaved(programme);
    setDone(t('prog.published'));
  });
  const retire = () => run(async () => {
    if (!token || !saved || !window.confirm(fill(t('prog.retireConfirm'), { title: saved.title }))) return;
    const { programme } = await programmesApi.retire(token, saved.id);
    setSaved(programme);
    setDone(t('prog.retired'));
  });
  const newVersion = () => run(async () => {
    if (!token || !saved) return;
    const { programme } = await programmesApi.duplicate(token, saved.id);
    onOpen(programme.id);
  });

  if (loadError) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" size="sm" onClick={() => onOpen(null)}><ArrowLeft className="h-4 w-4" />{t('prog.back')}</Button>
        <Alert tone="error"><span data-testid="programme-editor-error">{loadError}</span></Alert>
      </div>
    );
  }
  if (!f) {
    return <div className="flex h-40 items-center justify-center" role="status" aria-label={t('prog.editor.loading')}><Spinner className="h-6 w-6" /></div>;
  }

  const openDay = dayOpen != null ? f.days.find(d => d.day === dayOpen) ?? null : null;

  return (
    <div className="space-y-6" data-testid="programme-editor">
      <div>
        <Button variant="secondary" size="sm" onClick={() => onOpen(null)} data-testid="programme-back"><ArrowLeft className="h-4 w-4" />{t('prog.back')}</Button>
      </div>
      <PageHeader
        title={<span className="flex items-center gap-2">{isNew ? t('prog.editor.new') : saved?.title}
          {saved && <Badge tone={STATUS_TONE[saved.status]} dot><span data-testid="programme-status">{t(`prog.status.${saved.status}`)}</span></Badge>}</span>}
        actions={
          <>
            {editable && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void saveDraft()} data-testid="programme-save">{busy ? t('prog.saving') : t('prog.save')}</Button>}
            {editable && <Button size="sm" disabled={busy || check.blocking.length > 0} onClick={() => void publish()} data-testid="programme-publish">{t('prog.publish')}</Button>}
            {saved && saved.status !== 'draft' && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void newVersion()} data-testid="programme-new-version"><Copy className="h-4 w-4" />{t('prog.newVersion')}</Button>}
            {saved?.status === 'live' && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void retire()} data-testid="programme-retire">{t('prog.retire')}</Button>}
          </>
        }
      />
      {error && <Alert tone="error"><span data-testid="programme-error">{error}</span></Alert>}
      {done && <Alert tone="success"><span data-testid="programme-done">{done}</span></Alert>}
      {saved?.status === 'live' && <Alert tone="info">{t('prog.readOnly.live')}</Alert>}
      {saved?.status === 'retired' && <Alert tone="info">{t('prog.readOnly.retired')}</Alert>}
      {editable && saved?.versionOf && <Alert tone="info">{t('prog.versionOf')}</Alert>}

      {editable && (check.blocking.length > 0 || check.warnings.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="programme-checks">
          {check.blocking.length > 0 && (
            <Alert tone="warning">
              <p className="font-medium">{t('prog.check.heading')}</p>
              <ul className="mt-1 list-disc pl-5">{check.blocking.map((c, i) => <li key={i}>{fill(t(c.key as MessageKey), { n: c.day ?? '' })}</li>)}</ul>
            </Alert>
          )}
          {check.warnings.length > 0 && (
            <Alert tone="info">
              <p className="font-medium">{t('prog.check.warnings')}</p>
              <ul className="mt-1 list-disc pl-5">{check.warnings.map((c, i) => <li key={i}>{fill(t(c.key as MessageKey), { n: c.day ?? '' })}</li>)}</ul>
            </Alert>
          )}
        </div>
      )}

      <Card>
        <CardContent className="space-y-5">
          <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('prog.details')}</h2>
          <fieldset disabled={!editable} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('prog.field.title')}>
                <input className="ui-input" value={f.title} maxLength={80} onChange={e => set('title', e.target.value)} data-testid="programme-title" />
              </Field>
              <Field label={t('prog.field.length')} hint={t('prog.field.lengthHint')}>
                <input className="ui-input" type="number" min={PROGRAMME_LENGTH.min} max={PROGRAMME_LENGTH.max} value={f.lengthDays}
                  onChange={e => setLength(e.target.value)} data-testid="programme-length" />
              </Field>
            </div>
            <Field label={t('prog.field.summary')} hint={t('prog.field.summaryHint')}>
              <textarea className="ui-input" rows={2} maxLength={400} value={f.summary ?? ''} onChange={e => set('summary', e.target.value)} data-testid="programme-summary" />
            </Field>
            <fieldset className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-4">
              <legend className="px-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('prog.sw.legend')}</legend>
              <p className="text-xs text-[var(--color-fg-quaternary)]">{t('prog.sw.hint')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('prog.field.swTitle')}>
                  <input className="ui-input" lang="sw" value={f.i18n?.sw?.title ?? ''} maxLength={80} onChange={e => setSw('title', e.target.value)} data-testid="programme-sw-title" />
                </Field>
                <Field label={t('prog.field.swSummary')}>
                  <textarea className="ui-input" lang="sw" rows={2} maxLength={400} value={f.i18n?.sw?.summary ?? ''} onChange={e => setSw('summary', e.target.value)} data-testid="programme-sw-summary" />
                </Field>
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              {([['goal', PROGRAMME_GOALS], ['level', PROGRAMME_LEVELS], ['environment', PROGRAMME_ENVIRONMENTS]] as const).map(([k, all]) => (
                <Field key={k} label={t(k === 'environment' ? 'prog.field.where' : `prog.field.${k}`)}>
                  <select className="ui-input" value={f[k]} onChange={e => set(k, e.target.value)} data-testid={`programme-${k}`}>
                    {all.map(v => <option key={v} value={v}>{word(t, v)}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <fieldset>
              <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('prog.field.equipment')}</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {PROGRAMME_EQUIPMENT.map(v => (
                  <label key={v} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={f.equipment.includes(v)} data-testid={`programme-equipment-${v}`}
                      onChange={e => {
                        // "No equipment" stands alone.
                        const next = e.target.checked ? (v === 'none' ? ['none'] : [...f.equipment.filter(x => x !== 'none'), v]) : f.equipment.filter(x => x !== v);
                        set('equipment', next);
                      }} />
                    {word(t, v)}
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('prog.grid.title')}</h2>
          {editable && <p className="text-xs text-[var(--color-fg-quaternary)]" id="programme-grid-hint">{t('prog.grid.hint')}</p>}
          {clipboard && (
            <Alert tone="info">
              <span className="flex flex-wrap items-center gap-3" data-testid="programme-paste-bar">
                {fill(t('prog.paste.bar'), { n: clipboard.day })}
                <Button size="sm" variant="secondary" onClick={() => setClipboard(null)} data-testid="programme-paste-done">{t('prog.paste.done')}</Button>
              </span>
            </Alert>
          )}
          <DayGrid
            days={f.days} t={t} editable={editable}
            onCycle={n => {
              const d = f.days.find(x => x.day === n)!;
              const type = TYPES[(TYPES.indexOf(d.type) + 1) % TYPES.length];
              setDay(n, { day: n, type, workout: type === 'rest' ? null : d.workout ?? null });
            }}
            onOpen={n => {
              if (clipboard && editable) { setDay(n, { ...clipboard, workout: clipboard.workout ? structuredClone(clipboard.workout) : null }); return; }
              setDayOpen(n);
            }}
          />
        </CardContent>
      </Card>

      {openDay && (
        <DayDialog
          day={openDay} t={t} editable={editable} library={library} libraryFailed={libraryFailed}
          onClose={() => setDayOpen(null)}
          onSave={d => { setDay(openDay.day, d); setDayOpen(null); }}
          onCopy={d => { setDay(openDay.day, d); setClipboard(d); setDayOpen(null); }}
        />
      )}
    </div>
  );
}

// ── Day grid ──────────────────────────────────────────────────────────────

function cellLabel(t: T, d: ProgrammeDay) {
  const type = t(`prog.type.${d.type}`);
  if (!d.workout) return fill(t('prog.cell.label'), { n: d.day, type });
  const workout = d.workout.estimatedDuration ? fill(t('prog.cell.minutes'), { workout: d.workout.name, minutes: d.workout.estimatedDuration }) : d.workout.name;
  return fill(t('prog.cell.labelWorkout'), { n: d.day, type, workout });
}

/** One cell per day, 7 per row. Arrow keys move; Space changes the type; Enter (or a click) opens the day. */
function DayGrid({ days, t, editable, onCycle, onOpen }: {
  days: ProgrammeDay[]; t: T; editable: boolean; onCycle: (n: number) => void; onOpen: (n: number) => void;
}) {
  const [focus, setFocus] = useState(1);
  const refs = useRef(new Map<number, HTMLDivElement>());
  const move = (n: number) => {
    const next = Math.min(Math.max(n, 1), days.length);
    setFocus(next);
    refs.current.get(next)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>, n: number) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    if (e.key in step) { e.preventDefault(); move(n + step[e.key]); return; }
    if (e.key === ' ' && editable) { e.preventDefault(); onCycle(n); return; }
    if (e.key === 'Enter') { e.preventDefault(); onOpen(n); }
  };
  const rows: ProgrammeDay[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return (
    <div role="grid" aria-label={t('prog.grid.title')} aria-describedby={editable ? 'programme-grid-hint' : undefined} className="space-y-2" data-testid="programme-grid">
      {rows.map((row, r) => (
        <div role="row" key={r} className="grid grid-cols-7 gap-2">
          {row.map(d => (
            <div
              key={d.day} role="gridcell" tabIndex={focus === d.day ? 0 : -1} aria-label={cellLabel(t, d)}
              ref={el => { if (el) refs.current.set(d.day, el); else refs.current.delete(d.day); }}
              onFocus={() => setFocus(d.day)} onClick={() => onOpen(d.day)} onKeyDown={e => onKey(e, d.day)}
              data-testid={`programme-day-${d.day}`} data-type={d.type}
              className={`min-h-[4.5rem] cursor-pointer rounded-[var(--radius-md)] border p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-brand)] ${
                d.type === 'rest' ? 'border-dashed border-[var(--color-border-secondary)] text-[var(--color-fg-quaternary)]'
                  : 'border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-fg-secondary)]'}`}
            >
              <div className="font-semibold tabular-nums text-[var(--color-fg-primary)]">{fill(t('prog.day.title'), { n: d.day })}</div>
              <div aria-hidden="true">{t(`prog.type.${d.type}`)}</div>
              {d.type !== 'rest' && (
                <div aria-hidden="true" className="mt-0.5 line-clamp-2 text-[var(--color-fg-tertiary)]">{d.workout?.name ?? t('prog.cell.noWorkout')}</div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── One day and its workout ───────────────────────────────────────────────

const exerciseFrom = (e: Exercise): ProgrammeExercise => ({
  exerciseName: e.name, libraryId: e.id, sets: Math.min(Math.max(e.defaultSets || 1, 1), MAX_SETS),
  reps: e.defaultDuration ? null : e.defaultReps ?? 10, duration: e.defaultDuration ?? null, tracksWeight: e.tracksWeight === true,
});

function DayDialog({ day, t, editable, library, libraryFailed, onClose, onSave, onCopy }: {
  day: ProgrammeDay; t: T; editable: boolean; library: Exercise[] | null; libraryFailed: boolean;
  onClose: () => void; onSave: (d: ProgrammeDay) => void; onCopy: (d: ProgrammeDay) => void;
}) {
  const [type, setType] = useState<ProgrammeDayType>(day.type);
  const [withWorkout, setWithWorkout] = useState(Boolean(day.workout));
  const [w, setW] = useState<ProgrammeWorkout>(() => day.workout
    ? structuredClone(day.workout)
    : { name: '', activityType: 'strength', estimatedDuration: 30, exercises: [] });
  const [problemShown, setProblemShown] = useState(false);
  const needsWorkout = type === 'home' || (type === 'gym' && withWorkout);
  const workoutOk = w.name.trim().length > 0 && w.exercises.length > 0;
  const result = (): ProgrammeDay => ({ day: day.day, type, workout: needsWorkout ? { ...w, name: w.name.trim() } : null });
  const setEx = (i: number, patch: Partial<ProgrammeExercise>) => setW(prev => ({ ...prev, exercises: prev.exercises.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const byId = useMemo(() => new Map((library ?? []).map(e => [e.id, e])), [library]);

  const done = () => {
    if (needsWorkout && !workoutOk) { setProblemShown(true); return; }
    onSave(result());
  };

  return (
    <Dialog open onClose={onClose} title={fill(t('prog.day.title'), { n: day.day })} size="xl">
      <div className="space-y-5" data-testid="programme-day-dialog">
        <fieldset disabled={!editable} className="space-y-5">
          <fieldset>
            <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('prog.day.type')}</legend>
            <div className="mt-1.5 flex flex-wrap gap-4">
              {TYPES.map(v => (
                <label key={v} className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="programme-day-type" checked={type === v} onChange={() => setType(v)} data-testid={`programme-day-type-${v}`} />
                  {t(`prog.type.${v}`)}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">{type === 'gym' ? t('prog.day.gymHelp') : type === 'rest' ? t('prog.day.restHelp') : ''}</p>
          </fieldset>
          {type === 'gym' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withWorkout} onChange={e => setWithWorkout(e.target.checked)} data-testid="programme-day-suggest" />
              {t('prog.day.suggest')}
            </label>
          )}
          {needsWorkout && (
            <div className="space-y-4">
              {problemShown && !workoutOk && <Alert tone="error"><span data-testid="programme-workout-problem">{t('prog.workout.needed')}</span></Alert>}
              {libraryFailed && <Alert tone="warning">{t('prog.workout.libraryError')}</Alert>}
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('prog.workout.name')}>
                  <input className="ui-input" maxLength={80} value={w.name} onChange={e => setW({ ...w, name: e.target.value })} data-testid="programme-workout-name" />
                </Field>
                <Field label={t('prog.workout.kind')}>
                  <select className="ui-input" value={w.activityType} onChange={e => setW({ ...w, activityType: e.target.value })} data-testid="programme-workout-kind">
                    {WORKOUT_ACTIVITY_TYPES.map(v => <option key={v} value={v}>{word(t, v)}</option>)}
                  </select>
                </Field>
                <Field label={t('prog.workout.minutes')}>
                  <input className="ui-input" type="number" min={1} max={600} value={w.estimatedDuration ?? ''}
                    onChange={e => setW({ ...w, estimatedDuration: e.target.value ? Number(e.target.value) : null })} data-testid="programme-workout-minutes" />
                </Field>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('prog.workout.exercises')}</legend>
                {w.exercises.length === 0 && <p className="text-sm text-[var(--color-fg-tertiary)]">{t('prog.workout.none')}</p>}
                {w.exercises.map((x, i) => {
                  const timed = x.duration != null;
                  return (
                    <div key={i} className="grid items-end gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-secondary)] p-2 sm:grid-cols-[2fr_5rem_9rem_6rem_auto]" data-testid={`programme-ex-${i}`}>
                      <Field label={t('prog.workout.pick')}>
                        <select className="ui-input" value={x.libraryId ?? ''} data-testid={`programme-ex-${i}-pick`}
                          onChange={e => { const lib = byId.get(e.target.value); if (lib) setEx(i, exerciseFrom(lib)); }}>
                          {x.libraryId && !byId.has(x.libraryId) && <option value={x.libraryId}>{x.exerciseName}</option>}
                          {!x.libraryId && <option value="">{x.exerciseName}</option>}
                          {(library ?? []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                      </Field>
                      <Field label={t('prog.workout.sets')}>
                        <input className="ui-input" type="number" min={1} max={MAX_SETS} value={x.sets} onChange={e => setEx(i, { sets: Number(e.target.value) })} data-testid={`programme-ex-${i}-sets`} />
                      </Field>
                      <Field label={t('prog.workout.measure')}>
                        <select className="ui-input" value={timed ? 'timed' : 'reps'}
                          onChange={e => setEx(i, e.target.value === 'timed' ? { duration: x.reps ?? 30, reps: null } : { reps: x.duration ?? 10, duration: null })}>
                          <option value="reps">{t('prog.workout.reps')}</option>
                          <option value="timed">{t('prog.workout.seconds')}</option>
                        </select>
                      </Field>
                      <Field label={timed ? t('prog.workout.amountSeconds') : t('prog.workout.amountReps')}>
                        <input className="ui-input" type="number" min={1} value={(timed ? x.duration : x.reps) ?? ''} data-testid={`programme-ex-${i}-amount`}
                          onChange={e => setEx(i, timed ? { duration: Number(e.target.value) } : { reps: Number(e.target.value) })} />
                      </Field>
                      <Button type="button" variant="secondary" size="sm" aria-label={`${t('prog.workout.remove')}: ${x.exerciseName}`}
                        onClick={() => setW(prev => ({ ...prev, exercises: prev.exercises.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  );
                })}
                <Button type="button" variant="secondary" size="sm" disabled={!library?.length || w.exercises.length >= MAX_WORKOUT_EXERCISES}
                  onClick={() => library?.[0] && setW(prev => ({ ...prev, exercises: [...prev.exercises, exerciseFrom(library[0])] }))} data-testid="programme-ex-add">
                  <Plus className="h-4 w-4" />{t('prog.workout.add')}
                </Button>
                {w.exercises.length >= MAX_WORKOUT_EXERCISES && <p className="text-xs text-[var(--color-fg-quaternary)]">{t('prog.workout.max')}</p>}
              </fieldset>
            </div>
          )}
        </fieldset>
      </div>
      <DialogFooter>
        {editable && <Button variant="secondary" onClick={() => { if (needsWorkout && !workoutOk) { setProblemShown(true); return; } onCopy(result()); }} data-testid="programme-day-copy"><Copy className="h-4 w-4" />{t('prog.day.copy')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('prog.day.cancel')}</Button>
        {editable && <Button onClick={done} data-testid="programme-day-done">{t('prog.day.done')}</Button>}
      </DialogFooter>
    </Dialog>
  );
}
