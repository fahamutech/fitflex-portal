'use client';
// Events S6 (spec §6.2, §9.2 Import): CSV in, a preview with plain-language problems, an Apply that is enabled only when there are none.
// The file is read as text; the server parses, checks and applies atomically. Ranks in the file are ignored by the server (D52).
import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { EventDocument, OrganizerRole } from '@/lib/api';
import { eventDateTime, fmt } from '@/lib/events';
import { newIdempotencyKey, saveBlob } from '@/lib/events-ops';
import { resultsApi } from '@/lib/events-results-api';
import {
  IMPORT_COLUMNS, RESULTS_CSV_MAX_BYTES, RESULTS_SAMPLE_CSV, canEnterResults, countOf, problemKey, warningKey,
  type ImportPreview, type ImportRecord, type ResultSection, type ResultsSummary, type SourceType, type TimeBasis,
} from '@/lib/events-results';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Card, CardContent, EmptyState, Field, Input, Radio, Select, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { useWriteError } from '@/components/organizer/results/result-dialogs';
import { useApp } from '../../../../app/providers';

type Props = {
  doc: EventDocument; role: OrganizerRole | null; readOnly: boolean; summary: ResultsSummary | null; onApplied: () => void;
  go: (s: ResultSection, extra?: { category?: string; status?: string }) => void;
};

export function ResultsImport({ doc, role, readOnly, summary, onApplied, go }: Props) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [source, setSource] = useState<SourceType>('timing_provider');
  const [provider, setProvider] = useState('');
  const [basis, setBasis] = useState<TimeBasis>(summary?.settings?.timeBasis ?? 'net');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [past, setPast] = useState<ImportRecord[] | null>(null);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const writable = canEnterResults(role) && !readOnly;
  useEffect(() => { if (summary?.settings?.timeBasis) setBasis(summary.settings.timeBasis); }, [summary?.settings?.timeBasis]);

  const loadPast = async () => { if (!token) return; try { setPast((await resultsApi.imports(token, doc.id)).items ?? []); } catch { setPast([]); } };
  useEffect(() => { void loadPast(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, doc.id]);

  const reset = () => { setPreview(null); setDone(null); err.clear(); key.current = newIdempotencyKey(); };
  async function pick(f: File | undefined) {
    reset(); setFile(null); setFileError(false);
    if (!f) return;
    if (f.size > RESULTS_CSV_MAX_BYTES || !(f.type === 'text/csv' || /\.csv$/i.test(f.name))) { setFileError(true); return; }
    setFile({ name: f.name, text: await f.text() });
  }
  const body = () => ({ csv: file!.text, sourceType: source, ...(provider.trim() ? { sourceLabel: provider.trim() } : {}), timeBasis: basis });
  async function check() {
    if (!token || !file) return;
    setChecking(true); reset();
    try { setPreview(await resultsApi.previewImport(token, doc.id, body())); }
    catch (e) { err.fail(e); } finally { setChecking(false); }
  }
  const problems = preview ? (preview.rows?.problems ?? preview.problemsTotal ?? preview.problems?.length ?? 0) : 0;
  const ok = preview?.rows?.ok ?? 0;
  const warnings = preview?.rows?.warnings ?? preview?.warnings?.length ?? 0;
  const willAdd = (preview?.willCreate ?? 0) + (preview?.willRevise ?? 0);
  async function apply() {
    if (!token || !file || !preview) return;
    setApplying(true); err.clear();
    try {
      await resultsApi.applyImport(token, doc.id, { ...body(), previewHash: preview.previewHash }, key.current);
      const text = fmt(t('organizer.results.import.done'), { n: willAdd });
      setDone(text); toast.success(text);
      if (live.current) live.current.textContent = text;
      setPreview(null); setFile(null); key.current = newIdempotencyKey();
      onApplied(); void loadPast();
      requestAnimationFrame(() => summaryRef.current?.focus());
    } catch (e) { if (e && (e as { body?: { error?: string } }).body?.error === 'preview_stale') setPreview(null); err.fail(e); }
    finally { setApplying(false); }
  }

  const pastCols: ColumnDef<ImportRecord>[] = [
    { key: 'fileName', header: t('organizer.results.import.col.file'), cell: r => r.fileName ?? '—' },
    { key: 'rows', header: t('organizer.results.import.col.rows'), cell: r => r.rowCount ?? 0 },
    { key: 'by', header: t('organizer.results.import.col.by'), cell: r => r.createdBy?.name ?? '—' },
    { key: 'at', header: t('organizer.results.import.col.at'), cell: r => eventDateTime(r.createdAt, doc.timezone, locale, doc.timezoneAbbr) },
  ];
  const probCols: ColumnDef<{ line: number; bib?: string | null; code: string }>[] = [
    { key: 'line', header: t('organizer.results.import.line'), cell: r => r.line },
    { key: 'bib', header: t('organizer.results.col.bib'), cell: r => r.bib ?? '—' },
    { key: 'problem', header: t('organizer.results.import.problem'), cell: r => t(problemKey(r.code)) },
  ];
  const unmatched = countOf(preview?.unmatchedRegistrations);

  return (
    <div className="space-y-4" data-testid="results-import">
      <p ref={live} role="status" aria-live="polite" className="sr-only" data-testid="import-live" />
      {done && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-success-50)] p-4 text-sm text-[var(--color-success-800)]" data-testid="import-done">
          <p ref={summaryRef} tabIndex={-1} className="font-medium outline-none">{done}</p>
          <Button variant="secondary" size="sm" onClick={() => go('results', { status: 'pending_verification' })} data-testid="import-review">{t('organizer.results.import.review')}</Button>
        </div>
      )}
      {writable && (
        <Card><CardContent>
          <div className="space-y-4">
            <h3 className="font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.import.title')}</h3>
            {err.view && <div data-testid="import-error">{err.view}</div>}
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('organizer.results.import.source')}</legend>
              <div className="min-h-11"><Radio name="importSource" label={t('organizer.results.import.source.timing')} checked={source === 'timing_provider'} onChange={() => { setSource('timing_provider'); reset(); }} data-testid="import-source-timing" /></div>
              <div className="min-h-11"><Radio name="importSource" label={t('organizer.results.import.source.team')} checked={source === 'organizer_verified'} onChange={() => { setSource('organizer_verified'); reset(); }} data-testid="import-source-team" /></div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('organizer.results.import.provider')}><Input value={provider} maxLength={60} onChange={e => { setProvider(e.target.value); reset(); }} data-testid="import-provider" /></Field>
              <Field label={t('organizer.results.import.basis')}>
                <Select value={basis} onChange={e => { setBasis(e.target.value as TimeBasis); reset(); }} data-testid="import-basis">
                  <option value="net">{t('organizer.results.basis.net')}</option><option value="gun">{t('organizer.results.basis.gun')}</option>
                </Select>
              </Field>
            </div>
            <Field label={t('organizer.results.import.file')} hint={t('organizer.results.import.fileHint')} error={fileError ? t('organizer.results.import.tooBig') : undefined}>
              <input type="file" accept=".csv,text/csv" onChange={e => void pick(e.target.files?.[0])} className="block w-full text-sm" data-testid="import-file" />
            </Field>
            {file && <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="import-filename">{file.name}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="min-h-11" loading={checking} disabled={!file} onClick={() => void check()} data-testid="import-check"><Upload aria-hidden="true" className="h-4 w-4" />{t('organizer.results.import.check')}</Button>
              <Button variant="ghost" className="min-h-11" onClick={() => saveBlob(new Blob([RESULTS_SAMPLE_CSV], { type: 'text/csv;charset=utf-8' }), 'results-sample.csv')} data-testid="import-sample"><Download aria-hidden="true" className="h-4 w-4" />{t('organizer.results.import.sample')}</Button>
            </div>
            <details className="text-sm text-[var(--color-fg-secondary)]">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('organizer.results.import.columns')}</summary>
              <ul className="list-disc space-y-1 pl-5">{IMPORT_COLUMNS.map(c => <li key={c}><span className="font-mono">{c}</span>: {t(`organizer.results.import.column.${c}` as MessageKey)}</li>)}</ul>
            </details>
          </div>
        </CardContent></Card>
      )}
      {preview && (
        <Card><CardContent>
          <div className="space-y-4" aria-live="polite" data-testid="import-preview">
            <p className="font-medium text-[var(--color-fg-primary)]" data-testid="import-summary">{fmt(t('organizer.results.import.summary'), { ok, problems, warnings })}</p>
            {preview.byStatus && (
              <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="import-bystatus">
                {(['finished', 'dnf', 'dns', 'dq'] as const).map(k => `${t(`organizer.results.status.${k}` as MessageKey)}: ${preview.byStatus?.[k] ?? 0}`).join(' · ')}
              </p>
            )}
            {problems === 0 && willAdd === 0 && (preview.unchanged ?? 0) > 0 && <div data-testid="import-nothing-new"><Alert tone="info">{t('organizer.results.import.nothingNew')}</Alert></div>}
            {unmatched > 0 && (
              <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="import-unmatched">
                {fmt(t('organizer.results.import.unmatched'), { n: unmatched })}{' '}
                <Button variant="link" size="sm" onClick={() => go('results', { status: 'no_result' })}>{t('organizer.results.import.showThem')}</Button>
              </p>
            )}
            {(preview.warnings ?? []).length > 0 && (
              <ul className="space-y-1 text-sm text-[var(--color-fg-secondary)]" data-testid="import-warnings">
                {Array.from(new Set((preview.warnings ?? []).map(w => w.code))).map(c => <li key={c}>{t(warningKey(c))}</li>)}
              </ul>
            )}
            {problems > 0 && (
              <div className="space-y-2" data-testid="import-problems">
                <Alert tone="warning">{t('organizer.results.import.fixFirst')}</Alert>
                <DataTable columns={probCols} data={preview.problems ?? []} keyFn={(r, i) => `${r.line}-${i}`} label={t('organizer.results.import.problemsLabel')} dense pageSize={25} />
              </div>
            )}
            <div className="flex justify-end">
              <Button className="min-h-11" loading={applying} disabled={problems > 0 || willAdd === 0} onClick={() => void apply()} data-testid="import-apply">
                {fmt(t('organizer.results.import.apply'), { n: willAdd })}
              </Button>
            </div>
          </div>
        </CardContent></Card>
      )}
      <Card><CardContent>
        <div className="space-y-3">
          <h3 className="font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.import.past')}</h3>
          {past && past.length === 0
            ? <EmptyState title={t('organizer.results.import.pastEmpty')} />
            : <DataTable columns={pastCols} data={past ?? []} keyFn={r => r.id} label={t('organizer.results.import.pastLabel')} dense pageSize={10} />}
        </div>
      </CardContent></Card>
    </div>
  );
}
