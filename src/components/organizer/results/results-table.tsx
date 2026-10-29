'use client';
// Events S6 (spec §6.3, §6.6, §9.2 Results table): the organizer's results with filters, a server cursor, and a drawer per runner.
// The route of a linked run is never shown here (only distance, time, checks and flags: §5.4).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import type { EventDocument, OrganizerRole } from '@/lib/api';
import { eventDateTime, fmt } from '@/lib/events';
import { newIdempotencyKey } from '@/lib/events-ops';
import { resultsApi } from '@/lib/events-results-api';
import {
  RESULT_FLAGS, canEnterResults, canVerifyResults, flagKey, formatElapsed, parseTime, resultsErrorKey, rowStatus, rowTime, sourceKey,
  type ResultDetail, type ResultRow, type ResultsSummary,
} from '@/lib/events-results';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Input, Select, SkeletonCard, SkeletonTable, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { FlagChip, StageBadge, StatusBadge } from '@/components/organizer/results/parts';
import { BulkApproveDialog, CorrectDialog, DecisionDialog, useWriteError } from '@/components/organizer/results/result-dialogs';
import { useApp } from '../../../../app/providers';

const STATUS_FILTERS = ['pending_verification', 'verified', 'rejected', 'dnf', 'dns', 'dq', 'no_result'] as const;
const STATUS_LABEL: Record<(typeof STATUS_FILTERS)[number], MessageKey> = {
  pending_verification: 'organizer.results.status.pending', verified: 'organizer.results.filter.verified', rejected: 'organizer.results.status.rejected',
  dnf: 'organizer.results.status.dnf', dns: 'organizer.results.status.dns', dq: 'organizer.results.status.dq', no_result: 'organizer.results.status.noResult',
};

export function ResultsTable({ doc, role, readOnly, summary, category, status, registration, onFilters, onOpen, onChanged }: {
  doc: EventDocument; role: OrganizerRole | null; readOnly: boolean; summary: ResultsSummary | null; category: string; status: string; registration: string | null;
  onFilters: (category: string, status: string) => void; onOpen: (id: string | null) => void; onChanged: () => void;
}) {
  const { t, token, locale } = useApp();
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [flag, setFlag] = useState('');
  const [q, setQ] = useState('');
  const [bulk, setBulk] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const live = useRef<HTMLParagraphElement>(null);
  const query = q.trim().length >= 2 ? q.trim() : '';
  const owner = canVerifyResults(role) && !readOnly;

  const load = useCallback(async (cursor: string | null) => {
    if (!token) return;
    if (!cursor) { setRows(null); setError(null); } else setLoadingMore(true);
    try {
      const page = await resultsApi.results(token, doc.id, { ...(category ? { categoryId: category } : {}), ...(status ? { status } : {}), ...(flag ? { flag } : {}), ...(query ? { q: query } : {}), cursor, limit: 50 });
      setRows(cur => (cursor ? [...(cur ?? []), ...(page.items ?? [])] : (page.items ?? [])));
      setNext(page.nextCursor ?? null);
    } catch (e) { setError(resultsErrorKey(e)); } finally { setLoadingMore(false); }
  }, [token, doc.id, category, status, flag, query]);
  useEffect(() => { void load(null); }, [load]);

  const columns: ColumnDef<ResultRow>[] = [
    { key: 'bib', header: t('organizer.results.col.bib'), sortable: true, cell: r => <span className="font-mono">{r.bibNumber ?? '—'}</span> },
    { key: 'name', header: t('organizer.results.col.name'), cell: r => r.displayName ?? '—' },
    { key: 'category', header: t('organizer.results.col.category'), cell: r => r.categoryName ?? '—' },
    { key: 'status', header: t('organizer.results.col.status'), cell: r => (
      <span className="flex flex-wrap items-center gap-1"><StatusBadge row={r} />{r.disputeOpen && <StageBadge stage="disputed" />}</span>
    ) },
    { key: 'time', header: t('organizer.results.col.time'), cell: r => <span className="font-mono">{formatElapsed(rowTime(r))}</span> },
    { key: 'source', header: t('organizer.results.col.source'), cell: r => (r.sourceType ? <span>{t(sourceKey(r.sourceType))}{r.sourceLabel ? ` · ${r.sourceLabel}` : ''}</span> : '—') },
    { key: 'rank', header: t('organizer.results.col.rank'), cell: r => r.overallRank ?? '—' },
    { key: 'flags', header: t('organizer.results.col.flags'), cell: r => (r.flags?.length ? <span className="flex flex-wrap gap-1">{r.flags.map(f => <FlagChip key={f} label={t(flagKey(f))} />)}</span> : '—') },
    { key: 'updated', header: t('organizer.results.col.updated'), cell: r => eventDateTime(r.updatedAt, doc.timezone, locale, doc.timezoneAbbr) },
  ];
  const filters = (
    <>
      <Select size="sm" aria-label={t('organizer.results.filter.category')} value={category} onChange={e => onFilters(e.target.value, status)} data-testid="results-filter-category">
        <option value="">{t('organizer.results.filter.allCategories')}</option>
        {(summary?.perCategory ?? doc.categories.filter(c => c.id).map(c => ({ categoryId: c.id as string, name: c.name }))).map(c => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
      </Select>
      <Select size="sm" aria-label={t('organizer.results.filter.status')} value={status} onChange={e => onFilters(category, e.target.value)} data-testid="results-filter-status">
        <option value="">{t('organizer.results.filter.allStatuses')}</option>
        {STATUS_FILTERS.map(s => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
      </Select>
      <Select size="sm" aria-label={t('organizer.results.filter.flag')} value={flag} onChange={e => setFlag(e.target.value)} data-testid="results-filter-flag">
        <option value="">{t('organizer.results.filter.allFlags')}</option>
        {RESULT_FLAGS.map(f => <option key={f} value={f}>{t(flagKey(f))}</option>)}
      </Select>
      <Input aria-label={t('organizer.results.filter.search')} placeholder={t('organizer.results.filter.search')} value={q} onChange={e => setQ(e.target.value)} className="max-w-[14rem]" data-testid="results-search" />
    </>
  );
  if (error) return <div data-testid="results-error"><Alert tone="error">{t(error)}</Alert><div className="mt-2"><Button variant="secondary" onClick={() => void load(null)}>{t('common.tryAgain')}</Button></div></div>;
  return (
    <div className="space-y-3" data-testid="results-table-view">
      <p ref={live} role="status" aria-live="polite" className="sr-only" />
      {owner && status === 'pending_verification' && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-3" data-testid="results-bulk-bar">
          <Button className="min-h-11" onClick={() => setBulk(true)} data-testid="results-approve-clean">{t('organizer.results.action.approveCleanAll')}</Button>
          <span className="text-sm text-[var(--color-fg-secondary)]">{t('organizer.results.bulk.hint')}</span>
        </div>
      )}
      <Card><CardContent>
        {!rows ? <SkeletonTable /> : rows.length === 0 && !status && !category && !flag && !query
          ? <EmptyState title={t('organizer.results.empty')} />
          : (
            <>
              <DataTable columns={columns} data={rows} keyFn={r => r.registrationId} label={t('organizer.results.tableLabel')} dense pageSize={25} extraFilters={filters} emptyState={t('organizer.results.filter.none')}
                actions={r => <Button variant="ghost" size="sm" aria-label={`${t('organizer.results.open')}: ${r.displayName ?? r.bibNumber ?? ''}`} onClick={e => { e.stopPropagation(); onOpen(r.registrationId); }} data-testid={`result-open-${r.registrationId}`}>{t('organizer.results.open')}</Button>}
                onRowClick={r => onOpen(r.registrationId)} />
              {next && <div className="mt-3 flex justify-center"><Button variant="secondary" loading={loadingMore} onClick={() => void load(next)} data-testid="results-more">{t('organizer.results.loadMore')}</Button></div>}
            </>
          )}
      </CardContent></Card>
      {registration && <ResultDrawer doc={doc} registrationId={registration} role={role} readOnly={readOnly} onClose={() => onOpen(null)} onChanged={() => { void load(null); onChanged(); }} />}
      {bulk && <BulkApproveDialog open onClose={() => setBulk(false)} eventId={doc.id} categoryId={category || undefined}
        onDone={n => { setBulk(false); if (live.current) live.current.textContent = fmt(t('organizer.results.bulk.done'), { n }); void load(null); onChanged(); }} />}
    </div>
  );
}

// ── The result drawer (§9.2) ──
function ResultDrawer({ doc, registrationId, role, readOnly, onClose, onChanged }: {
  doc: EventDocument; registrationId: string; role: OrganizerRole | null; readOnly: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [d, setD] = useState<ResultDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');
  const [dialog, setDialog] = useState<'correct' | 'reject' | 'disqualify' | 'enter' | null>(null);
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const live = useRef<HTMLParagraphElement>(null);
  const verifyKey = useRef(newIdempotencyKey());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const writable = !readOnly;
  const owner = canVerifyResults(role) && writable;
  const entry = canEnterResults(role) && writable;

  const load = useCallback(async () => {
    if (!token) return;
    try { setD(await resultsApi.detail(token, doc.id, registrationId)); setState('ok'); }
    catch (e) { setState((e as { status?: number })?.status === 404 ? 'notfound' : 'error'); }
  }, [token, doc.id, registrationId]);
  useEffect(() => { setState('loading'); void load(); }, [load]);
  useEffect(() => { if (state === 'ok') headingRef.current?.focus(); }, [state]);
  const announce = (text: string) => { if (live.current) live.current.textContent = text; };
  const done = async (msg: MessageKey) => { setDialog(null); toast.success(t(msg)); announce(t(msg)); verifyKey.current = newIdempotencyKey(); await load(); onChanged(); };

  const s = d ? rowStatus(d) : 'noResult';
  const rev = d?.revision ?? 0;
  async function verify() {
    if (!token || !d?.resultId) return;
    setBusy(true); err.clear();
    try { await resultsApi.verify(token, doc.id, d.resultId, { expectedRevision: rev, ...(d.finishStatus === 'dq' ? { reasonCode: 'other' } : {}) }, verifyKey.current); await done('organizer.results.verified'); }
    catch (e) { err.fail(e); } finally { setBusy(false); }
  }
  const canDecide = owner && !!d?.resultId && s === 'pending';
  const canCorrect = owner && !!d?.resultId && (d.verificationStatus === 'verified' || d.verificationStatus === 'corrected' || d.verificationStatus === 'disqualified');
  const canDq = owner && !!d?.resultId && (s === 'pending' || s === 'finished');
  const canEnter = entry && (!d?.resultId || ['rejected', 'dnf', 'dns', 'noResult'].includes(s) || (s === 'pending' && d?.sourceType !== 'timing_provider'));

  return (
    <Dialog open onClose={onClose} title={t('organizer.results.drawer.title')} description={d ? `${d.displayName ?? ''}${d.bibNumber ? ` · ${d.bibNumber}` : ''}` : undefined} size="lg">
      <div className="space-y-5" data-testid="result-drawer">
        <p ref={live} role="status" aria-live="polite" className="sr-only" data-testid="drawer-live" />
        {state === 'loading' && <div aria-busy="true"><SkeletonCard /></div>}
        {state === 'error' && <Alert tone="error">{t('common.somethingWrong')}</Alert>}
        {state === 'notfound' && <div data-testid="drawer-notfound"><Alert tone="warning">{t('events.reg.drawer.notFound')}</Alert></div>}
        {state === 'ok' && d && (
          <>
            <section className="space-y-2" aria-labelledby="rd-h">
              <h3 id="rd-h" ref={headingRef} tabIndex={-1} className="flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--color-fg-primary)] outline-none">
                {d.categoryName} <StatusBadge row={d} /> <StageBadge stage={d.disputeOpen ? 'disputed' : d.stage} />
              </h3>
              <dl className="grid grid-cols-2 gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-4 text-sm sm:grid-cols-4" data-testid="drawer-numbers">
                <div><dt className="text-[var(--color-fg-quaternary)]">{t('organizer.results.col.net')}</dt><dd className="font-mono" data-testid="drawer-net">{formatElapsed(d.netElapsedMs)}</dd></div>
                <div><dt className="text-[var(--color-fg-quaternary)]">{t('organizer.results.col.gun')}</dt><dd className="font-mono" data-testid="drawer-gun">{formatElapsed(d.gunElapsedMs)}</dd></div>
                <div><dt className="text-[var(--color-fg-quaternary)]">{t('organizer.results.col.rank')}</dt><dd data-testid="drawer-rank">{d.overallRank ?? '—'}{d.categoryRank ? ` / ${d.categoryRank}` : ''}</dd></div>
                <div><dt className="text-[var(--color-fg-quaternary)]">{t('organizer.results.col.source')}</dt><dd data-testid="drawer-source">{d.sourceType ? t(sourceKey(d.sourceType)) : '—'}{d.sourceLabel ? ` · ${d.sourceLabel}` : ''}</dd></div>
              </dl>
              {d.withinCutoff === false && <p className="text-sm text-[var(--color-fg-secondary)]">{t('organizer.results.overCutoff')}</p>}
              {(d.flags ?? []).length > 0 && <p className="flex flex-wrap gap-1" data-testid="drawer-flags">{d.flags!.map(f => <FlagChip key={f} label={t(flagKey(f))} />)}</p>}
            </section>

            <section className="space-y-2" aria-labelledby="rd-rev-h">
              <h3 id="rd-rev-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.drawer.revisions')}</h3>
              {(d.revisions ?? []).length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('organizer.results.drawer.noRevisions')}</p> : (
                <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="drawer-revisions">
                  {d.revisions!.map(r => (
                    <li key={r.revision} className="space-y-0.5 py-2">
                      <p className="flex flex-wrap items-center gap-2"><Badge tone="gray">{fmt(t('organizer.results.drawer.revision'), { n: r.revision })}</Badge>
                        <span className="font-mono">{formatElapsed(r.netElapsedMs ?? r.gunElapsedMs)}</span>
                        {r.verificationStatus && <span>{t(`organizer.results.vstatus.${r.verificationStatus}` as MessageKey)}</span>}</p>
                      <p className="text-[var(--color-fg-quaternary)]">{r.by?.name ?? '—'} · {eventDateTime(r.at, doc.timezone, locale, doc.timezoneAbbr)}{r.reasonCode ? ` · ${t(`organizer.results.reason.${['timing_error', 'wrong_bib', 'late_data'].includes(r.reasonCode) ? r.reasonCode : r.reasonCode === 'replaced_by_participant' ? 'replaced' : 'other'}` as MessageKey)}` : ''}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {d.linkedRun && (
              <section className="space-y-1" aria-labelledby="rd-run-h" data-testid="drawer-run">
                <h3 id="rd-run-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.drawer.run')}</h3>
                <p className="text-sm text-[var(--color-fg-secondary)]">{((d.linkedRun.distanceMeters ?? 0) / 1000).toFixed(2)} km · {formatElapsed(d.linkedRun.elapsedMs)}</p>
                <p className="flex items-center gap-1 text-sm text-[var(--color-fg-quaternary)]"><Lock aria-hidden="true" className="h-3.5 w-3.5" />{t('organizer.results.flag.privateRoute')}</p>
              </section>
            )}

            {(d.disputes ?? []).length > 0 && (
              <section className="space-y-1" aria-labelledby="rd-disp-h" data-testid="drawer-disputes">
                <h3 id="rd-disp-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.disputes.title')}</h3>
                <ul className="space-y-1 text-sm">{d.disputes!.map(x => <li key={x.id}><Badge tone={x.status === 'open' ? 'warning' : 'gray'}>{t(`organizer.results.dispute.status.${x.status}` as MessageKey)}</Badge> {t(`organizer.results.dispute.reason.${x.reasonCode}` as MessageKey)}</li>)}</ul>
              </section>
            )}

            {err.view && <div data-testid="drawer-error">{err.error?.stale ? (
              <Alert tone="error"><span className="flex flex-wrap items-center gap-3">{t('organizer.results.error.result_changed')}<Button size="sm" variant="secondary" onClick={() => { err.clear(); void load(); }} data-testid="drawer-reload">{t('organizer.results.reload')}</Button></span></Alert>
            ) : err.view}</div>}

            {(owner || entry) && (
              <section className="space-y-2" aria-labelledby="rd-act-h">
                <h3 id="rd-act-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('organizer.results.drawer.actions')}</h3>
                <div className="flex flex-wrap gap-2">
                  {canDecide && <Button className="min-h-11" loading={busy} onClick={() => void verify()} data-testid="act-verify">{t('organizer.results.action.verify')}</Button>}
                  {canDecide && <Button className="min-h-11" variant="secondary" onClick={() => setDialog('reject')} data-testid="act-reject">{t('organizer.results.action.reject')}</Button>}
                  {canCorrect && <Button className="min-h-11" variant="secondary" onClick={() => setDialog('correct')} data-testid="act-correct">{t('organizer.results.action.correct')}</Button>}
                  {canDq && <Button className="min-h-11" variant="destructive" onClick={() => setDialog('disqualify')} data-testid="act-dq">{t('organizer.results.action.disqualify')}</Button>}
                  {canEnter && <Button className="min-h-11" variant="secondary" onClick={() => setDialog('enter')} data-testid="act-enter">{t('organizer.results.action.enter')}</Button>}
                </div>
                {entry && !owner && <p className="text-sm text-[var(--color-fg-quaternary)]">{t('organizer.results.timing.note')}</p>}
              </section>
            )}
          </>
        )}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose} data-testid="drawer-close">{t('events.reg.drawer.close')}</Button></div>
      </div>

      <DecisionDialog open={dialog === 'reject'} onClose={() => setDialog(null)} mode="reject" name={d?.displayName ?? ''}
        onSubmit={async (body, key) => { if (!token || !d?.resultId) return; await resultsApi.reject(token, doc.id, d.resultId, { expectedRevision: rev, reasonCode: body.reasonCode, ...(body.note ? { note: body.note } : {}) }, key); await done('organizer.results.rejected'); }} />
      <DecisionDialog open={dialog === 'disqualify'} onClose={() => setDialog(null)} mode="disqualify" name={d?.displayName ?? ''}
        onSubmit={async (body, key) => { if (!token || !d?.resultId) return; await resultsApi.disqualify(token, doc.id, d.resultId, { expectedRevision: rev, reasonCode: body.reasonCode, note: body.note ?? '' }, key); await done('organizer.results.disqualified'); }} />
      <CorrectDialog open={dialog === 'correct'} onClose={() => setDialog(null)} row={d}
        onSubmit={async (body, key) => { if (!token || !d?.resultId) return; await resultsApi.correct(token, doc.id, d.resultId, { expectedRevision: rev, ...body }, key); await done('organizer.results.corrected'); }} />
      <EntryDialog open={dialog === 'enter'} onClose={() => setDialog(null)} row={d} role={role}
        onSubmit={async (body, key) => { if (!token) return; await resultsApi.enterResult(token, doc.id, registrationId, body, key); await done('organizer.results.entered'); }} />
    </Dialog>
  );
}

// ── Manual entry (§6.3): provisional until an owner or admin verifies it ──
function EntryDialog({ open, onClose, row, role, onSubmit }: {
  open: boolean; onClose: () => void; row: ResultRow | null; role: OrganizerRole | null;
  onSubmit: (body: { finishStatus: string; netTime?: string; gunTime?: string; sourceLabel?: string }, key: string) => Promise<void>;
}) {
  const { t } = useApp();
  const [status, setStatus] = useState('finished');
  const [net, setNet] = useState('');
  const [gun, setGun] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setStatus('finished'); setNet(''); setGun(''); setLabel(''); setBusy(false); err.clear(); key.current = newIdempotencyKey(); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.registrationId]);
  const pNet = net.trim() ? parseTime(net) : null;
  const pGun = gun.trim() ? parseTime(gun) : null;
  const finished = status === 'finished';
  const valid = !finished || ((pNet?.ok ?? false) || (pGun?.ok ?? false)) && !(pNet && !pNet.ok) && !(pGun && !pGun.ok);
  const timeErr = (p: ReturnType<typeof parseTime> | null) => (p && !p.ok ? t(p.reason === 'range' ? 'organizer.results.problem.time_out_of_range' : 'organizer.results.problem.time_invalid') : undefined);
  async function go() {
    setBusy(true); err.clear();
    try { await onSubmit({ finishStatus: status, ...(finished && pNet?.ok ? { netTime: pNet.text } : {}), ...(finished && pGun?.ok ? { gunTime: pGun.text } : {}), ...(label.trim() ? { sourceLabel: label.trim() } : {}) }, key.current); }
    catch (e) { err.fail(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('organizer.results.entry.title')} description={row ? `${row.displayName ?? ''}${row.bibNumber ? ` · ${row.bibNumber}` : ''}` : undefined} size="md">
      <div className="space-y-4" data-testid="entry-dialog">
        {err.view}
        <Alert tone="info">{t(role === 'timing' ? 'organizer.results.entry.provisionalTiming' : 'organizer.results.entry.provisional')}</Alert>
        <Field label={t('organizer.results.col.status')} required>
          <Select value={status} onChange={e => setStatus(e.target.value)} data-testid="entry-status">
            {(['finished', 'dnf', 'dns'] as const).map(s => <option key={s} value={s}>{t(`organizer.results.status.${s}` as MessageKey)}</option>)}
          </Select>
        </Field>
        {finished && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('organizer.results.correct.newNet')} hint="H:MM:SS" error={timeErr(pNet)}><Input value={net} inputMode="numeric" className="font-mono" onChange={e => setNet(e.target.value)} data-testid="entry-net" /></Field>
            <Field label={t('organizer.results.correct.newGun')} hint="H:MM:SS" error={timeErr(pGun)}><Input value={gun} inputMode="numeric" className="font-mono" onChange={e => setGun(e.target.value)} data-testid="entry-gun" /></Field>
          </div>
        )}
        <Field label={t('organizer.results.import.provider')}><Input value={label} maxLength={60} onChange={e => setLabel(e.target.value)} data-testid="entry-label" /></Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={!valid} onClick={() => void go()} data-testid="entry-confirm">{t('organizer.results.entry.save')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
