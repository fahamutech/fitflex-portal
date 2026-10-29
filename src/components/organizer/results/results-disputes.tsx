'use client';
// Events S6 (spec §6.7, §9.2 Disputes): questions about results. Owner and admin resolve; timing only reads.
// "Correct the result" and its dispute resolution commit together on the server (`outcome: 'upheld'` with `correction`).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventDocument, OrganizerRole } from '@/lib/api';
import { eventDateTime } from '@/lib/events';
import { resultsApi } from '@/lib/events-results-api';
import { canVerifyResults, formatElapsed, resultsErrorKey, rowStatus, type DisputeRow, type ResultDetail } from '@/lib/events-results';
import { newIdempotencyKey } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Select, SkeletonTable, Textarea, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { StatusBadge } from '@/components/organizer/results/parts';
import { CorrectDialog, useWriteError } from '@/components/organizer/results/result-dialogs';
import { useApp } from '../../../../app/providers';

const NOTE_MIN = 10; const NOTE_MAX = 500;

export function ResultsDisputes({ doc, role, readOnly, onChanged, onOpenResult }: {
  doc: EventDocument; role: OrganizerRole | null; readOnly: boolean; onChanged: () => void; onOpenResult: (registrationId: string) => void;
}) {
  const { t, token, locale } = useApp();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<DisputeRow[] | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [selected, setSelected] = useState<DisputeRow | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    setRows(null); setError(null);
    try { setRows((await resultsApi.disputes(token, doc.id, status || undefined)).items ?? []); } catch (e) { setError(resultsErrorKey(e)); }
  }, [token, doc.id, status]);
  useEffect(() => { void load(); }, [load]);
  const cols: ColumnDef<DisputeRow>[] = [
    { key: 'bib', header: t('organizer.results.col.bib'), cell: r => <span className="font-mono">{r.bibNumber ?? '—'}</span> },
    { key: 'name', header: t('organizer.results.col.name'), cell: r => r.displayName ?? '—' },
    { key: 'reason', header: t('organizer.results.dispute.col.reason'), cell: r => t(`organizer.results.dispute.reason.${r.reasonCode}` as MessageKey) },
    { key: 'raised', header: t('organizer.results.dispute.col.raised'), cell: r => eventDateTime(r.createdAt, doc.timezone, locale, doc.timezoneAbbr) },
    { key: 'ends', header: t('organizer.results.dispute.col.ends'), cell: r => eventDateTime(r.windowEndsAt, doc.timezone, locale, doc.timezoneAbbr) },
    { key: 'status', header: t('organizer.results.col.status'), cell: r => <Badge tone={r.status === 'open' ? 'warning' : 'gray'}>{t(`organizer.results.dispute.status.${r.status}` as MessageKey)}</Badge> },
  ];
  return (
    <div className="space-y-3" data-testid="results-disputes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.disputes.title')}</h3>
        <Select size="sm" className="max-w-[12rem]" aria-label={t('organizer.results.filter.status')} value={status} onChange={e => setStatus(e.target.value)} data-testid="disputes-filter">
          <option value="open">{t('organizer.results.dispute.status.open')}</option>
          <option value="">{t('organizer.results.filter.allStatuses')}</option>
        </Select>
      </div>
      {error && <Alert tone="error">{t(error)}</Alert>}
      <Card><CardContent>
        {!rows && !error ? <SkeletonTable /> : rows && rows.length === 0
          ? <div data-testid="disputes-empty"><EmptyState title={t('organizer.results.disputes.empty')} /></div>
          : <DataTable columns={cols} data={rows ?? []} keyFn={r => r.id} label={t('organizer.results.disputes.tableLabel')} dense pageSize={25} onRowClick={r => setSelected(r)}
              actions={r => <Button variant="ghost" size="sm" aria-label={`${t('organizer.results.open')}: ${r.displayName ?? r.bibNumber ?? ''}`} onClick={e => { e.stopPropagation(); setSelected(r); }} data-testid={`dispute-open-${r.id}`}>{t('organizer.results.open')}</Button>} />}
      </CardContent></Card>
      {selected && <DisputePanel doc={doc} dispute={selected} resolvable={canVerifyResults(role) && !readOnly} onClose={() => setSelected(null)} onOpenResult={onOpenResult}
        onResolved={() => { setSelected(null); void load(); onChanged(); }} />}
    </div>
  );
}

function DisputePanel({ doc, dispute, resolvable, onClose, onResolved, onOpenResult }: {
  doc: EventDocument; dispute: DisputeRow; resolvable: boolean; onClose: () => void; onResolved: () => void; onOpenResult: (registrationId: string) => void;
}) {
  const { t, token } = useApp();
  const toast = useToast();
  const [detail, setDetail] = useState<ResultDetail | null>(null);
  const [mode, setMode] = useState<'correct' | 'nochange' | 'dqstands' | null>(null);
  const live = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!token || !dispute.registrationId) return;
    resultsApi.detail(token, doc.id, dispute.registrationId).then(setDetail).catch(() => setDetail(null));
  }, [token, doc.id, dispute.registrationId]);
  const open = dispute.status === 'open';
  const isDq = detail ? rowStatus(detail) === 'dq' : false;
  const finish = (msg: MessageKey) => { toast.success(t(msg)); if (live.current) live.current.textContent = t(msg); onResolved(); };
  return (
    <Dialog open onClose={onClose} title={t('organizer.results.dispute.panelTitle')} description={`${dispute.displayName ?? ''}${dispute.bibNumber ? ` · ${dispute.bibNumber}` : ''}`} size="lg">
      <div className="space-y-4" data-testid="dispute-panel">
        <p ref={live} role="status" aria-live="polite" className="sr-only" />
        <section className="space-y-1" aria-labelledby="dp-r">
          <h3 id="dp-r" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.dispute.theirReason')}</h3>
          <p className="text-sm" data-testid="dispute-reason">{t(`organizer.results.dispute.reason.${dispute.reasonCode}` as MessageKey)}</p>
          {dispute.note && <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="dispute-note">{dispute.note}</p>}
        </section>
        {detail && (
          <section className="space-y-1" aria-labelledby="dp-res" data-testid="dispute-result">
            <h3 id="dp-res" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.drawer.title')}</h3>
            <p className="flex flex-wrap items-center gap-2 text-sm"><StatusBadge row={detail} /><span className="font-mono">{formatElapsed(detail.elapsedMs ?? detail.netElapsedMs ?? detail.gunElapsedMs)}</span></p>
            {detail.linkedRun && <p className="text-sm text-[var(--color-fg-secondary)]">{((detail.linkedRun.distanceMeters ?? 0) / 1000).toFixed(2)} km · {formatElapsed(detail.linkedRun.elapsedMs)} · {t('organizer.results.flag.privateRoute')}</p>}
            {dispute.registrationId && <Button variant="link" size="sm" onClick={() => { onClose(); onOpenResult(dispute.registrationId!); }}>{t('organizer.results.dispute.openResult')}</Button>}
          </section>
        )}
        {!open && dispute.resolutionNote && <p className="text-sm text-[var(--color-fg-secondary)]">{dispute.resolutionNote}</p>}
        {open && resolvable && (
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={() => setMode('correct')} data-testid="dispute-correct">{t('organizer.results.disputes.outcome.upheld')}</Button>
            <Button className="min-h-11" variant="secondary" onClick={() => setMode('nochange')} data-testid="dispute-nochange">{t('organizer.results.disputes.outcome.rejected')}</Button>
            {isDq && <Button className="min-h-11" variant="secondary" onClick={() => setMode('dqstands')} data-testid="dispute-dqstands">{t('organizer.results.disputes.outcome.dq')}</Button>}
          </div>
        )}
        {open && !resolvable && <p className="text-sm text-[var(--color-fg-quaternary)]">{t('organizer.results.dispute.readOnly')}</p>}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>{t('events.reg.drawer.close')}</Button></div>
      </div>
      <CorrectDialog open={mode === 'correct'} onClose={() => setMode(null)} row={detail} title={t('organizer.results.disputes.outcome.upheld')}
        onSubmit={async (body, key) => {
          if (!token || !detail) return;
          await resultsApi.resolveDispute(token, doc.id, dispute.id, { outcome: 'upheld', note: body.note, correction: { expectedRevision: detail.revision ?? 0, ...body } }, key);
          setMode(null); finish('organizer.results.dispute.resolved');
        }} />
      <NoteDialog open={mode === 'nochange' || mode === 'dqstands'} onClose={() => setMode(null)} title={t(mode === 'dqstands' ? 'organizer.results.disputes.outcome.dq' : 'organizer.results.disputes.outcome.rejected')}
        onSubmit={async (note, key) => { if (!token) return; await resultsApi.resolveDispute(token, doc.id, dispute.id, { outcome: 'rejected', note }, key); setMode(null); finish('organizer.results.dispute.resolved'); }} />
    </Dialog>
  );
}

function NoteDialog({ open, onClose, title, onSubmit }: { open: boolean; onClose: () => void; title: string; onSubmit: (note: string, key: string) => Promise<void> }) {
  const { t } = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setNote(''); setBusy(false); err.clear(); key.current = newIdempotencyKey(); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const n = note.trim().length;
  async function go() { setBusy(true); err.clear(); try { await onSubmit(note.trim(), key.current); } catch (e) { err.fail(e); } finally { setBusy(false); } }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={title} size="md">
      <div className="space-y-3" data-testid="dispute-note-dialog">
        {err.view}
        <Field label={t('organizer.results.dispute.note')} hint={`${n}/${NOTE_MAX}`} required>
          <Textarea rows={3} maxLength={NOTE_MAX} value={note} onChange={e => setNote(e.target.value)} data-testid="dispute-note-input" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={n < NOTE_MIN || n > NOTE_MAX} onClick={() => void go()} data-testid="dispute-note-confirm">{t('organizer.results.dispute.resolve')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
