'use client';
// Events S7 (spec §6.4, H18, AC-H18): "Per race settings". A table of the event's races (time basis, cut-off minutes, virtual distance tolerance in %) with
// "Same for all races" at the top. Saves through the existing PATCH results-settings { categories: [...] }. After the first official release the fields
// disable and say why (only a longer time to ask can change, which the event-level card still offers). Race ids come from the event; the body never carries a user id.
import { useEffect, useRef, useState } from 'react';
import type { EventDocument } from '@/lib/api';
import { newIdempotencyKey } from '@/lib/events-ops';
import { resultsApi } from '@/lib/events-results-api';
import type { RaceSettings, ResultsSummary, TimeBasis } from '@/lib/events-results';
import { Alert, Button, Card, CardContent, Field, Input, Select, useToast } from '@/components/shared';
import { useWriteError } from '@/components/organizer/results/result-dialogs';
import { useApp } from '../../../../app/providers';

type Row = { basis: TimeBasis; cutoff: string; tol: string };
const EMPTY: Row = { basis: 'net', cutoff: '', tol: '' };

/** What the organizer saved: `perCategory[].rulesOverride` (null = unset); `rules` is the resolved fallback. */
function savedRows(doc: EventDocument, summary: ResultsSummary | null): Record<string, Row> {
  const out: Record<string, Row> = {};
  for (const cat of doc.categories) {
    if (!cat.id) continue;
    const v = (() => { const pc = summary?.perCategory.find(c => c.categoryId === cat.id) as { rules?: RaceSettings; rulesOverride?: RaceSettings } | undefined; return pc?.rulesOverride ?? pc?.rules; })();
    out[cat.id] = { basis: v?.timeBasis === 'gun' ? 'gun' : 'net', cutoff: v?.cutoffMinutes ? String(v.cutoffMinutes) : '', tol: v?.virtualDistanceToleranceBps != null ? String(v.virtualDistanceToleranceBps / 100) : '' };
  }
  return out;
}

export function PerRaceSettings({ doc, readOnly, summary, onSaved }: { doc: EventDocument; readOnly: boolean; summary: ResultsSummary | null; onSaved: () => void }) {
  const { t, token } = useApp();
  const toast = useToast();
  const cats = doc.categories.filter(c => !!c.id);
  const locked = summary?.perCategory?.some(c => c.release?.stage === 'official') ?? false;
  const savedKey = JSON.stringify(summary?.perCategory?.map(c => (c as { rulesOverride?: unknown; rules?: unknown }).rulesOverride ?? (c as { rules?: unknown }).rules ?? null) ?? null);
  const [rows, setRows] = useState<Record<string, Row>>(() => savedRows(doc, summary));
  const [same, setSame] = useState(false);
  const [all, setAll] = useState<Row>(EMPTY);
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  // Reset only when the SAVED values really change, never because a refresh returned the same ones (that would drop unsent edits).
  useEffect(() => { setRows(savedRows(doc, summary)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const set = (id: string, patch: Partial<Row>) => setRows(r => ({ ...r, [id]: { ...(r[id] ?? EMPTY), ...patch } }));
  const cutoffOk = (v: string) => !v.trim() || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 1440);
  const tolOk = (v: string) => !v.trim() || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 5);
  const effective = (id: string): Row => (same ? all : rows[id] ?? EMPTY);
  const valid = cats.every(c => cutoffOk(effective(c.id!).cutoff) && tolOk(effective(c.id!).tol));

  async function save() {
    if (!token) return;
    setBusy(true); err.clear();
    const categories: RaceSettings[] = cats.map(c => {
      const r = effective(c.id!);
      // A cleared field is sent as null (back to the event default); omitting it would leave the saved value in place.
      return { id: c.id!, timeBasis: r.basis, cutoffMinutes: r.cutoff.trim() ? Number(r.cutoff) : null, virtualDistanceToleranceBps: r.tol.trim() ? Math.round(Number(r.tol) * 100) : null };
    });
    try { await resultsApi.saveSettings(token, doc.id, { categories }, key.current); key.current = newIdempotencyKey(); toast.success(t('organizer.results.perRace.saved')); onSaved(); }
    catch (e) { err.fail(e); } finally { setBusy(false); }
  }

  if (cats.length === 0) return null;
  const dis = readOnly || busy || locked;
  const controls = (r: Row, patch: (p: Partial<Row>) => void, suffix: string) => (
    <>
      <Field label={t('organizer.results.perRace.col.basis')}>
        <Select value={r.basis} disabled={dis} onChange={e => patch({ basis: e.target.value as TimeBasis })} data-testid={`per-race-basis-${suffix}`}>
          <option value="net">{t('organizer.results.basis.net')}</option><option value="gun">{t('organizer.results.basis.gun')}</option>
        </Select>
      </Field>
      <Field label={t('organizer.results.perRace.col.cutoff')} error={cutoffOk(r.cutoff) ? undefined : t('organizer.results.settings.cutoffInvalid')}>
        <Input inputMode="numeric" value={r.cutoff} disabled={dis} onChange={e => patch({ cutoff: e.target.value.replace(/\D/g, '') })} data-testid={`per-race-cutoff-${suffix}`} />
      </Field>
      <Field label={t('organizer.results.perRace.col.tolerance')} error={tolOk(r.tol) ? undefined : t('organizer.results.perRace.toleranceInvalid')}>
        <Input inputMode="decimal" value={r.tol} disabled={dis} onChange={e => patch({ tol: e.target.value.replace(/[^\d.]/g, '') })} data-testid={`per-race-tolerance-${suffix}`} />
      </Field>
    </>
  );
  return (
    <Card><CardContent>
      <div className="space-y-4" data-testid="results-per-race">
        <h3 className="font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.perRace.title')}</h3>
        {locked && <Alert tone="info">{t('organizer.results.perRace.locked')}</Alert>}
        {err.view}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={same} disabled={dis} onChange={e => setSame(e.target.checked)} data-testid="per-race-same" />
          {t('organizer.results.perRace.same')}
        </label>
        {same ? (
          <div className="grid gap-4 sm:grid-cols-3" data-testid="per-race-all">{controls(all, p => setAll(a => ({ ...a, ...p })), 'all')}</div>
        ) : (
          <ul className="space-y-4">
            {cats.map(c => (
              <li key={c.id} className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3" data-testid={`per-race-${c.id}`}>
                <p className="font-medium text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{c.name}</p>
                <div className="grid gap-4 sm:grid-cols-3">{controls(rows[c.id!] ?? EMPTY, p => set(c.id!, p), c.id!)}</div>
              </li>
            ))}
          </ul>
        )}
        {!readOnly && !locked && <div className="flex justify-end"><Button loading={busy} disabled={!valid} onClick={() => void save()} data-testid="per-race-save">{t('organizer.results.settings.save')}</Button></div>}
      </div>
    </CardContent></Card>
  );
}
