'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §8.4): bib numbers. Single assign / change / release,
// bulk by rule (preview, then an atomic apply) and CSV import (dry run, then an all-or-nothing apply).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api, type BibBulkPreview, type BibImportPreview, type BibRow, type EventDocument, type OrganizerRole } from '@/lib/api';
import { errorCode, errorKey, fmt, isFeatureOff, isForbidden } from '@/lib/events';
import { BIB_CSV_MAX_BYTES, BIB_SAMPLE_CSV, canOverrideKit, newIdempotencyKey, saveBlob } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Input, MetricCard, Select, SkeletonTable, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { EventsUnavailable, OrganizerForbidden, PageError } from '@/components/organizer/page-states';
import { BibDialog, ReasonDialog } from '@/components/organizer/ops-dialogs';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../../app/providers';

const FILTERS = ['', 'assigned', 'unassigned'] as const;

export function BibsView({ doc, role, readOnly, onOpenRegistration }: { doc: EventDocument; role: OrganizerRole | null; readOnly: boolean; onOpenRegistration: (registrationId: string) => void }) {
  const { t, token } = useApp();
  const toast = useToast();
  const options = useEventsOptions();
  const eventId = doc.id;
  const [rows, setRows] = useState<BibRow[] | null>(null);
  const [counts, setCounts] = useState<{ assigned: number; unassigned: number } | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'ok' | 'off' | 'forbidden' | 'error'>('ok');
  const [categoryId, setCategoryId] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [bibFor, setBibFor] = useState<BibRow | null>(null);
  const [releaseFor, setReleaseFor] = useState<BibRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const live = useRef<HTMLParagraphElement>(null);
  const owner = canOverrideKit(role); // owner/admin: change, release, bulk, import
  const canAssign = !readOnly && (role === 'owner' || role === 'admin' || role === 'ops');
  useEffect(() => { const h = setTimeout(() => setQ(search.trim()), 350); return () => clearTimeout(h); }, [search]);

  const load = useCallback(async (cursor: string | null = null) => {
    if (!token) return;
    try {
      const page = await api.eventBibs(token, eventId, { cursor, limit: 50, categoryId: categoryId || undefined, filter: filter || undefined, q: q || undefined });
      setRows(prev => (cursor ? [...(prev ?? []), ...(page.items ?? [])] : (page.items ?? [])));
      setNext(page.nextCursor ?? null); setCounts(page.counts ?? null); setState('ok');
    } catch (err) { setState(isFeatureOff(err) ? 'off' : isForbidden(err) ? 'forbidden' : 'error'); }
  }, [token, eventId, categoryId, filter, q]);
  useEffect(() => { setRows(null); void load(null); }, [load]);

  async function more() { setLoadingMore(true); try { await load(next); } finally { setLoadingMore(false); } }
  function announce(text: string) { if (live.current) live.current.textContent = text; }

  if (options === undefined) return <div aria-busy="true"><SkeletonTable /></div>;
  if (!options?.ops?.kit || state === 'off') return <EventsUnavailable />;
  if (state === 'forbidden') return <OrganizerForbidden backHref="/organizer/events" />;
  if (state === 'error') return <PageError onRetry={() => { setState('ok'); void load(null); }} />;
  if (!rows) return <div aria-busy="true"><SkeletonTable /></div>;

  const columns: ColumnDef<BibRow>[] = [
    { key: 'displayName', header: t('events.bibs.col.participant'), sortable: true, cell: r => <span className="font-medium text-[var(--color-fg-primary)]">{r.displayName}</span> },
    { key: 'categoryName', header: t('events.bibs.col.category'), sortable: true, cell: r => r.categoryName },
    { key: 'bibNumber', header: t('events.bibs.col.bib'), sortable: true, cell: r => (
      <span className="inline-flex flex-wrap items-center gap-2">
        {r.bibNumber ? <span className="font-mono font-semibold" data-testid="bib-number">{r.bibNumber}</span> : <span className="text-[var(--color-fg-quaternary)]">—</span>}
        {r.warnings?.includes('bib_changed_after_collection') && <Badge tone="warning" dot>{t('events.bibs.warn.changedAfterKit')}</Badge>}
      </span>
    ) },
    { key: 'kit', header: t('events.bibs.col.kit'), cell: r => t(`events.kit.state.${r.kit?.state ?? 'not_ready'}` as MessageKey) },
    { key: 'assignedAt', header: t('events.bibs.col.assignedAt'), cell: r => (r.assignedAt ? new Date(r.assignedAt).toLocaleDateString() : '—') },
  ];
  const filters = (
    <>
      {doc.categories.length > 1 && (
        <Select size="sm" aria-label={t('events.bibs.filter.category')} value={categoryId} onChange={e => setCategoryId(e.target.value)} data-testid="bibs-filter-category">
          <option value="">{t('events.bibs.filter.allCategories')}</option>
          {doc.categories.filter(c => c.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}
      <Select size="sm" aria-label={t('events.bibs.col.bib')} value={filter} onChange={e => setFilter(e.target.value as (typeof FILTERS)[number])} data-testid="bibs-filter-state">
        <option value="">{t('events.bibs.filter.all')}</option>
        <option value="assigned">{t('events.bibs.filter.assigned')}</option>
        <option value="unassigned">{t('events.bibs.filter.unassigned')}</option>
      </Select>
      <Input size="sm" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('events.bibs.search')} aria-label={t('events.bibs.search')} data-testid="bibs-search" />
    </>
  );

  async function saveBib(row: BibRow, body: { bibNumber: string; reason?: string; replace?: boolean }, key: string) {
    if (!token) return;
    await api.assignEventBib(token, eventId, { registrationId: row.registrationId, ...body }, key);
    setBibFor(null); toast.success(t('events.bibs.saved')); announce(t('events.bibs.saved')); await load(null);
  }

  return (
    <div className="space-y-4" data-testid="bibs-view">
      <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{t('events.bibs.title')}</h2>
      <p ref={live} role="status" aria-live="polite" className="sr-only" />
      {readOnly && <Alert tone="warning">{t('events.kit.suspended')}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:max-w-xl" data-testid="bibs-counts">
          <MetricCard label={t('events.bibs.filter.assigned')} value={counts?.assigned ?? 0} />
          <MetricCard label={t('events.bibs.filter.unassigned')} value={counts?.unassigned ?? 0} />
        </div>
        {owner && !readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setBulkOpen(true)} data-testid="bibs-bulk">{t('events.bibs.bulk.title')}</Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)} data-testid="bibs-import"><Upload aria-hidden="true" className="h-4 w-4" />{t('events.bibs.import.title')}</Button>
            <Button variant="ghost" onClick={() => saveBlob(new Blob([BIB_SAMPLE_CSV], { type: 'text/csv;charset=utf-8' }), 'bib-numbers-sample.csv')} data-testid="bibs-sample"><Download aria-hidden="true" className="h-4 w-4" />{t('events.bibs.import.sample')}</Button>
          </div>
        )}
      </div>
      <Card><CardContent>
        {rows.length === 0 && !q && !filter && !categoryId
          ? <div data-testid="bibs-empty"><EmptyState title={t('events.bibs.empty')} /></div>
          : (
            <>
              <DataTable columns={columns} data={rows} keyFn={r => r.registrationId} label={t('events.bibs.tableLabel')} dense pageSize={25} extraFilters={filters} emptyState={t('events.bibs.empty')}
                actions={r => (
                  <>
                    {canAssign && (!r.bibNumber || owner) && (
                      <Button variant="ghost" size="sm" onClick={() => setBibFor(r)} data-testid={`bib-${r.bibNumber ? 'change' : 'assign'}-${r.registrationId}`}>{r.bibNumber ? t('events.bibs.change') : t('events.bibs.assign')}</Button>
                    )}
                    {canAssign && owner && r.bibNumber && r.assignmentId && (
                      <Button variant="ghost" size="sm" onClick={() => setReleaseFor(r)} data-testid={`bib-release-${r.registrationId}`}>{t('events.bibs.release')}</Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => onOpenRegistration(r.registrationId)}>{t('events.reg.open')}</Button>
                  </>
                )} />
              {next && <div className="mt-3 flex justify-center"><Button variant="secondary" loading={loadingMore} onClick={() => void more()} data-testid="bibs-more">{t('events.bibs.loadMore')}</Button></div>}
              {counts && <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">{fmt(t('events.bibs.counts'), counts)}</p>}
            </>
          )}
      </CardContent></Card>

      <BibDialog open={!!bibFor} onClose={() => setBibFor(null)} name={bibFor?.displayName ?? ''} current={bibFor?.bibNumber ?? null} onSave={(body, key) => saveBib(bibFor!, body, key)} />
      <ReasonDialog open={!!releaseFor} onClose={() => setReleaseFor(null)} testId="bib-release-dialog" tone="danger" title={t('events.bibs.release.title')} body={releaseFor ? `${releaseFor.displayName} · ${releaseFor.bibNumber}` : undefined}
        label={t('events.bibs.releaseReason')} confirmLabel={t('events.bibs.release')}
        onConfirm={async (reason, key) => {
          if (!token || !releaseFor?.assignmentId) return;
          await api.releaseEventBib(token, eventId, releaseFor.assignmentId, reason, key);
          setReleaseFor(null); toast.success(t('events.bibs.released')); announce(t('events.bibs.released')); await load(null);
        }} />
      <BulkDialog open={bulkOpen} onClose={() => setBulkOpen(false)} doc={doc} eventId={eventId} onDone={n => { setBulkOpen(false); toast.success(fmt(t('events.bibs.bulk.done'), { count: n })); announce(fmt(t('events.bibs.bulk.done'), { count: n })); void load(null); }} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} eventId={eventId} onDone={n => { setImportOpen(false); toast.success(fmt(t('events.bibs.import.done'), { count: n })); announce(fmt(t('events.bibs.import.done'), { count: n })); void load(null); }} />
    </div>
  );
}

/** §8.4 bulk by rule: Preview first; Apply stays disabled until a fresh preview exists (any edit makes it stale). */
function BulkDialog({ open, onClose, doc, eventId, onDone }: { open: boolean; onClose: () => void; doc: EventDocument; eventId: string; onDone: (count: number) => void }) {
  const { t, token } = useApp();
  const [categoryId, setCategoryId] = useState('');
  const [start, setStart] = useState(''); const [end, setEnd] = useState(''); const [prefix, setPrefix] = useState(''); const [pad, setPad] = useState('');
  const [order, setOrder] = useState<'registered_at' | 'last_name'>('registered_at');
  const [preview, setPreview] = useState<BibBulkPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setCategoryId(''); setStart(''); setEnd(''); setPrefix(''); setPad(''); setOrder('registered_at'); setPreview(null); setError(null); key.current = newIdempotencyKey(); } }, [open]);
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPreview(null); setError(null); };
  const startN = Number(start);
  const valid = /^\d+$/.test(start) && startN >= 0 && (!end || (/^\d+$/.test(end) && Number(end) >= startN)) && (!pad || /^\d+$/.test(pad)) && prefix.length <= 8 && /^[A-Za-z0-9-]*$/.test(prefix);
  const body = () => ({ ...(categoryId ? { categoryId } : {}), start: startN, ...(end ? { end: Number(end) } : {}), ...(prefix ? { prefix: prefix.toUpperCase() } : {}), ...(pad ? { padTo: Number(pad) } : {}), order, onlyUnassigned: true as const });
  async function doPreview() {
    if (!token) return;
    setBusy(true); setError(null);
    try { setPreview(await api.previewEventBibsBulk(token, eventId, body())); }
    catch (err) { setError(errorKey(err)); } finally { setBusy(false); }
  }
  async function apply() {
    if (!token || !preview) return;
    setBusy(true); setError(null);
    try { await api.applyEventBibsBulk(token, eventId, { ...body(), previewHash: preview.previewHash }, key.current); onDone(preview.count); }
    catch (err) { if (errorCode(err) === 'preview_stale') { setPreview(null); setError('events.bibs.bulk.stale'); } else setError(errorKey(err)); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('events.bibs.bulk.title')} size="lg">
      <div className="space-y-4" data-testid="bulk-dialog">
        {error && <div data-testid="bulk-error"><Alert tone="error">{t(error)}</Alert></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('events.bibs.filter.category')}>
            <Select value={categoryId} onChange={e => edit(setCategoryId)(e.target.value)} data-testid="bulk-category">
              <option value="">{t('events.bibs.filter.allCategories')}</option>
              {doc.categories.filter(c => c.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={t('events.bibs.bulk.order')}>
            <Select value={order} onChange={e => edit(setOrder)(e.target.value as 'registered_at' | 'last_name')} data-testid="bulk-order">
              <option value="registered_at">{t('events.bibs.bulk.order.registered_at')}</option>
              <option value="last_name">{t('events.bibs.bulk.order.last_name')}</option>
            </Select>
          </Field>
          <Field label={t('events.bibs.bulk.start')} required><Input inputMode="numeric" value={start} onChange={e => edit(setStart)(e.target.value)} data-testid="bulk-start" /></Field>
          <Field label={t('events.bibs.bulk.end')}><Input inputMode="numeric" value={end} onChange={e => edit(setEnd)(e.target.value)} data-testid="bulk-end" /></Field>
          <Field label={t('events.bibs.bulk.prefix')}><Input value={prefix} maxLength={8} onChange={e => edit(setPrefix)(e.target.value.toUpperCase())} className="font-mono uppercase" data-testid="bulk-prefix" /></Field>
          <Field label={t('events.bibs.bulk.pad')}><Input inputMode="numeric" value={pad} onChange={e => edit(setPad)(e.target.value)} data-testid="bulk-pad" /></Field>
        </div>
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('events.bibs.bulk.onlyNew')}</p>
        {preview && (
          <div className="space-y-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-4" data-testid="bulk-preview" aria-live="polite">
            <p className="font-medium text-[var(--color-fg-primary)]">{fmt(t('events.bibs.bulk.summary'), { count: preview.count, first: preview.first ?? '—', last: preview.last ?? '—' })}</p>
            {preview.shortfall > 0 && <Alert tone="warning">{fmt(t('events.bibs.bulk.shortfall'), { count: preview.shortfall })}</Alert>}
            {preview.conflicts.length > 0 && <Alert tone="warning">{fmt(t('events.bibs.bulk.conflicts'), { count: preview.conflicts.length })}</Alert>}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('events.kit.cancel')}</Button>
        <Button variant="secondary" loading={busy && !preview} disabled={!valid} onClick={() => void doPreview()} data-testid="bulk-preview-btn">{t('events.bibs.bulk.preview')}</Button>
        <Button loading={busy && !!preview} disabled={!preview || preview.count === 0 || preview.shortfall > 0 || preview.conflicts.length > 0} onClick={() => void apply()} data-testid="bulk-apply">{t('events.bibs.bulk.apply')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

/** §8.4 CSV import: the file is read as text and sent for a dry run; Apply is enabled only when no row has a problem. */
function ImportDialog({ open, onClose, eventId, onDone }: { open: boolean; onClose: () => void; eventId: string; onDone: (count: number) => void }) {
  const { t, token } = useApp();
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<BibImportPreview | null>(null);
  const [fileError, setFileError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setCsv(null); setPreview(null); setFileError(false); setError(null); key.current = newIdempotencyKey(); } }, [open]);
  async function pick(file: File | undefined) {
    setPreview(null); setError(null); setFileError(false); setCsv(null);
    if (!file) return;
    if (file.size > BIB_CSV_MAX_BYTES || !(file.type === 'text/csv' || /\.csv$/i.test(file.name))) { setFileError(true); return; }
    const text = await file.text();
    setCsv(text);
    if (!token) return;
    setBusy(true);
    try { setPreview(await api.previewEventBibsImport(token, eventId, text)); }
    catch (err) { setError(errorKey(err)); } finally { setBusy(false); }
  }
  const bad = preview ? (preview.bad ?? preview.rows.filter(r => r.status === 'error').length) : 0;
  const ok = preview ? (preview.ok ?? preview.rows.filter(r => r.status === 'ok').length) : 0;
  const problemText = (code?: string) => (code && `events.bibs.error.${code}` in KNOWN ? t(`events.bibs.error.${code}` as MessageKey) : code ?? '');
  async function apply() {
    if (!token || csv == null || !preview?.previewHash) return;
    setBusy(true); setError(null);
    try { await api.applyEventBibsImport(token, eventId, { csv, previewHash: preview.previewHash }, key.current); onDone(ok); }
    catch (err) { setError(errorKey(err)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('events.bibs.import.title')} description={t('events.bibs.import.help')} size="lg">
      <div className="space-y-4" data-testid="import-dialog">
        {error && <Alert tone="error">{t(error)}</Alert>}
        <Field label={t('events.bibs.import.file')} error={fileError ? t('events.bibs.import.tooBig') : undefined}>
          <input type="file" accept=".csv,text/csv" onChange={e => void pick(e.target.files?.[0])} className="block w-full text-sm" data-testid="import-file" />
        </Field>
        {preview && (
          <div className="space-y-3" aria-live="polite" data-testid="import-preview">
            <p className="font-medium text-[var(--color-fg-primary)]" data-testid="import-result">{fmt(t('events.bibs.import.result'), { ok, bad })}</p>
            {bad > 0 && (
              <>
                <Alert tone="warning">{t('events.bibs.import.fix')}</Alert>
                <table className="ui-table w-full text-sm" data-testid="import-problems">
                  <thead><tr><th scope="col" className="text-left">{t('events.bibs.import.line')}</th><th scope="col" className="text-left">{t('events.bibs.import.problem')}</th></tr></thead>
                  <tbody>
                    {preview.rows.filter(r => r.status === 'error').map(r => (
                      <tr key={r.line}><td>{r.line}</td><td>{problemText(r.code)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('events.kit.cancel')}</Button>
        <Button loading={busy && !!preview} disabled={!preview || bad > 0 || ok === 0 || !preview.previewHash} onClick={() => void apply()} data-testid="import-apply">{t('events.bibs.bulk.apply')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
const KNOWN: Record<string, true> = {
  'events.bibs.error.bib_taken': true, 'events.bibs.error.bib_invalid': true, 'events.bibs.error.bib_duplicate_in_file': true, 'events.bibs.error.registration_not_found': true,
  'events.bibs.error.registration_not_confirmed': true, 'events.bibs.error.already_assigned': true,
};
