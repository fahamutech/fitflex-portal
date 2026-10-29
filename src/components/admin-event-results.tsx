'use client';
// Events S6 (spec §9.1, §6.6, §2): the FitFlex admin's read-only Results block for an event, with the exception actions (correct or
// disqualify, both with a reason and the current revision). Admin disputes are not listed here: the spec gives no list route for them.
import { useCallback, useEffect, useState } from 'react';
import { eventDateTime } from '@/lib/events';
import { resultsApi } from '@/lib/events-results-api';
import { formatElapsed, resultsErrorKey, rowStatus, rowTime, sourceKey, type ResultRow, type ResultsSummary } from '@/lib/events-results';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Card, CardContent, EmptyState, Input, MetricCard, SkeletonTable, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { StageBadge, StatusBadge } from '@/components/organizer/results/parts';
import { CorrectDialog, DecisionDialog } from '@/components/organizer/results/result-dialogs';
import { useApp } from '../../app/providers';

export function AdminEventResults({ eventId, timezone, timezoneAbbr }: { eventId: string; timezone: string; timezoneAbbr?: string | null }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [summary, setSummary] = useState<ResultsSummary | null>(null);
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<{ kind: 'correct' | 'disqualify'; row: ResultRow } | null>(null);
  const query = q.trim().length >= 2 ? q.trim() : '';
  const load = useCallback(async (cursor: string | null) => {
    if (!token) return;
    if (!cursor) { setRows(null); setError(null); }
    try {
      const page = await resultsApi.adminResults(token, eventId, { ...(query ? { q: query } : {}), cursor, limit: 50 });
      setRows(cur => (cursor ? [...(cur ?? []), ...(page.items ?? [])] : (page.items ?? []))); setNext(page.nextCursor ?? null);
    } catch (e) { setError(resultsErrorKey(e)); }
  }, [token, eventId, query]);
  useEffect(() => { void load(null); }, [load]);
  useEffect(() => { if (token) resultsApi.adminSummary(token, eventId).then(setSummary).catch(() => setSummary(null)); }, [token, eventId, rows]);
  const cols: ColumnDef<ResultRow>[] = [
    { key: 'bib', header: t('organizer.results.col.bib'), cell: r => <span className="font-mono">{r.bibNumber ?? '—'}</span> },
    { key: 'name', header: t('organizer.results.col.name'), cell: r => r.displayName ?? '—' },
    { key: 'status', header: t('organizer.results.col.status'), cell: r => <StatusBadge row={r} /> },
    { key: 'time', header: t('organizer.results.col.time'), cell: r => <span className="font-mono">{formatElapsed(rowTime(r))}</span> },
    { key: 'source', header: t('organizer.results.col.source'), cell: r => (r.sourceType ? t(sourceKey(r.sourceType)) : '—') },
    { key: 'updated', header: t('organizer.results.col.updated'), cell: r => eventDateTime(r.updatedAt, timezone, locale, timezoneAbbr) },
  ];
  return (
    <div className="space-y-4" data-testid="admin-event-results">
      <p className="text-sm text-[var(--color-fg-secondary)]">{t('admin.results.exceptionNote')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-results-summary">
        {(summary?.perCategory ?? []).map(c => (
          <Card key={c.categoryId}><CardContent>
            <div className="space-y-2">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--color-fg-primary)]">{c.name} <StageBadge stage={c.release?.stage ?? 'none'} /></p>
              <div className="grid grid-cols-3 gap-2">
                <MetricCard wrapLabel label={t('organizer.results.status.finished')} value={c.finished} />
                <MetricCard wrapLabel label={t('organizer.results.status.pending')} value={c.pending} />
                <MetricCard wrapLabel label={t('organizer.results.status.dq')} value={c.dq} />
              </div>
            </div>
          </CardContent></Card>
        ))}
      </div>
      {error && <Alert tone="error">{t(error)}</Alert>}
      <Card><CardContent>
        {!rows && !error ? <SkeletonTable /> : rows && rows.length === 0 && !query ? <EmptyState title={t('organizer.results.empty')} /> : (
          <>
            <DataTable columns={cols} data={rows ?? []} keyFn={r => r.registrationId} label={t('organizer.results.tableLabel')} dense pageSize={25} emptyState={t('organizer.results.filter.none')}
              extraFilters={<Input aria-label={t('organizer.results.filter.search')} placeholder={t('organizer.results.filter.search')} value={q} onChange={e => setQ(e.target.value)} className="max-w-[14rem]" data-testid="admin-results-search" />}
              actions={r => rowStatus(r) === 'noResult' || !r.resultId ? null : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'correct', row: r })} data-testid={`admin-correct-${r.registrationId}`}>{t('organizer.results.action.correct')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'disqualify', row: r })} data-testid={`admin-dq-${r.registrationId}`}>{t('organizer.results.action.disqualify')}</Button>
                </>
              )} />
            {next && <div className="mt-3 flex justify-center"><Button variant="secondary" onClick={() => void load(next)}>{t('organizer.results.loadMore')}</Button></div>}
          </>
        )}
      </CardContent></Card>
      <CorrectDialog open={dialog?.kind === 'correct'} onClose={() => setDialog(null)} row={dialog?.row ?? null}
        onSubmit={async (body, key) => { if (!token || !dialog?.row.resultId) return; await resultsApi.adminCorrect(token, eventId, dialog.row.resultId, { expectedRevision: dialog.row.revision ?? 0, ...body }, key); setDialog(null); toast.success(t('organizer.results.corrected')); void load(null); }} />
      <DecisionDialog open={dialog?.kind === 'disqualify'} onClose={() => setDialog(null)} mode="disqualify" name={dialog?.row.displayName ?? ''}
        onSubmit={async (body, key) => { if (!token || !dialog?.row.resultId) return; await resultsApi.adminDisqualify(token, eventId, dialog.row.resultId, { expectedRevision: dialog.row.revision ?? 0, reasonCode: body.reasonCode, note: body.note ?? '' }, key); setDialog(null); toast.success(t('organizer.results.disqualified')); void load(null); }} />
    </div>
  );
}
