'use client';
// Events S6 (spec §6.3, §6.4, §6.6, §9.2): the dialogs of the Results tab. Each attempt owns one Idempotency-Key and reuses it on Retry
// (§9.3 "offline or 5xx on a write stays on screen"); a stale revision says so and asks for a reload (AC-S4).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { errorBody, errorCode, fmt } from '@/lib/events';
import { newIdempotencyKey } from '@/lib/events-ops';
import { resultsApi } from '@/lib/events-results-api';
import {
  CORRECT_REASONS, DQ_REASONS, REJECT_REASONS, countOf, formatElapsed, parseTime, resultsErrorKey, retryAfterOf,
  type BulkPreview, type ReleasePreview, type ResultRow,
} from '@/lib/events-results';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../../../app/providers';

const NOTE_MIN = 10; const NOTE_MAX = 300;

/** Error line for a failed write: the refusal's sentence, with the wait time for a 429. */
export function useWriteError() {
  const { t } = useApp();
  const [error, setError] = useState<{ key: MessageKey; wait: number | null; stale: boolean; extra: Record<string, string | number> } | null>(null);
  const fail = (err: unknown) => setError({ extra: Object.fromEntries(Object.entries(errorBody(err) ?? {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number')) as Record<string, string | number>, key: resultsErrorKey(err), wait: errorCode(err) === 'rate_limited' ? retryAfterOf(err) : null, stale: errorCode(err) === 'result_changed' || errorCode(err) === 'preview_stale' });
  const view = error && <Alert tone="error">{error.wait ? fmt(t('organizer.results.error.rate_limited_wait'), { seconds: error.wait }) : fmt(t(error.key), error.extra)}</Alert>;
  return { error, fail, clear: () => setError(null), view };
}

// ── Release (§6.4, §9.2) ──
export function ReleaseDialog({ open, onClose, eventId, categoryId, categoryName, stage, onDone }: {
  open: boolean; onClose: () => void; eventId: string; categoryId: string | null; categoryName: string; stage: 'provisional' | 'official'; onDone: () => void;
}) {
  const { t, token } = useApp();
  const [preview, setPreview] = useState<ReleasePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [markDns, setMarkDns] = useState(false);
  const [leaveOut, setLeaveOut] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  const warnId = useId();
  useEffect(() => {
    if (!open || !token) return;
    setPreview(null); setMarkDns(false); setLeaveOut(false); setTyped(''); setBusy(false); err.clear(); key.current = newIdempotencyKey();
    setLoading(true);
    resultsApi.previewRelease(token, eventId, { categoryId, stage }).then(setPreview).catch(e => err.fail(e)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, eventId, categoryId, stage]);
  const unsettled = countOf(preview?.unsettled);
  const willMark = markDns ? (preview?.willMarkDns ?? preview?.noResult ?? 0) : 0;
  // The server's resultCount = finished + DNF + DNS + DQ (+ runners marked DNS). Results still waiting for review are NOT in it, so the typed number matches it.
  const published = (preview?.finished ?? 0) + (preview?.dnf ?? 0) + (preview?.dns ?? 0) + (preview?.dq ?? 0) + willMark;
  const anything = published + (stage === 'provisional' ? unsettled : 0);
  const blocked = stage === 'official' && unsettled > 0 && !leaveOut;
  const ready = !!preview && !blocked && anything > 0 && typed.trim() === String(published);
  async function go() {
    if (!token || !preview) return;
    setBusy(true); err.clear();
    try {
      await resultsApi.release(token, eventId, { categoryId, stage, previewHash: preview.previewHash, markRemainingDns: markDns, leaveUnsettledOut: leaveOut }, key.current);
      onDone();
    } catch (e) { err.fail(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={`${t('organizer.results.release.title')} · ${categoryName}`} size="md">
      <div className="space-y-4" data-testid="release-dialog">
        {err.view && <div data-testid="release-error">{err.view}</div>}
        <p data-autofocus tabIndex={-1} className="text-sm font-medium text-[var(--color-fg-primary)] outline-none">{t(stage === 'official' ? 'organizer.results.release.official' : 'organizer.results.release.provisional')}</p>
        {loading && <p className="text-sm text-[var(--color-fg-quaternary)]" aria-busy="true">{t('common.loading')}</p>}
        {preview && (
          <dl className="grid grid-cols-2 gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-4 text-sm sm:grid-cols-3" data-testid="release-preview">
            {(['finished', 'dnf', 'dns', 'dq', 'noResult'] as const).map(k => (
              <div key={k}><dt className="text-[var(--color-fg-quaternary)]">{t(`organizer.results.status.${k}` as MessageKey)}</dt><dd className="font-semibold text-[var(--color-fg-primary)]" data-testid={`release-count-${k}`}>{preview[k] ?? 0}</dd></div>
            ))}
            <div><dt className="text-[var(--color-fg-quaternary)]">{t('organizer.results.release.unsettled')}</dt><dd className="font-semibold text-[var(--color-fg-primary)]" data-testid="release-count-unsettled">{unsettled}</dd></div>
          </dl>
        )}
        {preview && stage === 'official' && (
          <div className="space-y-1">
            <Checkbox label={t('organizer.results.release.markDns')} checked={markDns} onChange={e => setMarkDns(e.target.checked)} data-testid="release-mark-dns" />
            <Checkbox label={t('organizer.results.release.leaveOut')} checked={leaveOut} onChange={e => setLeaveOut(e.target.checked)} data-testid="release-leave-out" />
            {blocked && <div data-testid="release-blocked"><Alert tone="warning">{fmt(t('organizer.results.release.blocked'), { n: unsettled })}</Alert></div>}
          </div>
        )}
        {stage === 'official' && <p id={warnId} className="text-sm text-[var(--color-fg-secondary)]" data-testid="release-warn">{t('organizer.results.release.warn')}</p>}
        {preview && (
          <Field label={fmt(t('organizer.results.release.type'), { n: published })} hint={t('organizer.results.release.typeHint')} required>
            <Input inputMode="numeric" autoComplete="off" value={typed} aria-describedby={warnId} onChange={e => setTyped(e.target.value.replace(/\D/g, ''))} data-testid="release-type" />
          </Field>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant={stage === 'official' ? 'destructive' : 'primary'} loading={busy} disabled={!ready} onClick={() => void go()} data-testid="release-confirm">
          {t(stage === 'official' ? 'organizer.results.release.official' : 'organizer.results.release.provisional')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ── Approve all clean (§6.3) ──
export function BulkApproveDialog({ open, onClose, eventId, categoryId, onDone }: { open: boolean; onClose: () => void; eventId: string; categoryId?: string; onDone: (count: number) => void }) {
  const { t, token } = useApp();
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (!open || !token) return;
    setPreview(null); setBusy(false); err.clear(); key.current = newIdempotencyKey(); setLoading(true);
    resultsApi.previewBulk(token, eventId, { ...(categoryId ? { categoryId } : {}), filter: 'pending_clean' }).then(setPreview).catch(e => err.fail(e)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, eventId, categoryId]);
  async function go() {
    if (!token || !preview) return;
    setBusy(true); err.clear();
    try { await resultsApi.applyBulk(token, eventId, { ...(categoryId ? { categoryId } : {}), filter: 'pending_clean', previewHash: preview.previewHash }, key.current); onDone(preview.count); }
    catch (e) { if (errorCode(e) === 'preview_stale') setPreview(null); err.fail(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={fmt(t('organizer.results.action.approveClean'), { n: preview?.count ?? 0 })} size="md">
      <div className="space-y-3" data-testid="bulk-approve-dialog">
        {err.view}
        {loading && <p className="text-sm text-[var(--color-fg-quaternary)]" aria-busy="true">{t('common.loading')}</p>}
        {preview && (
          <div aria-live="polite" className="space-y-2">
            <p className="text-sm text-[var(--color-fg-primary)]" data-testid="bulk-approve-count">{fmt(t('organizer.results.bulk.count'), { n: preview.count })}</p>
            {(preview.excludedFlagged ?? 0) > 0 && <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="bulk-approve-excluded">{fmt(t('organizer.results.bulk.excluded'), { n: preview.excludedFlagged ?? 0 })}</p>}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={!preview || preview.count === 0} onClick={() => void go()} data-testid="bulk-approve-confirm">{fmt(t('organizer.results.action.approveClean'), { n: preview?.count ?? 0 })}</Button>
      </DialogFooter>
    </Dialog>
  );
}

// ── Reject / disqualify (reason + note) ──
/** `verifyDq`: verifying a disqualification that came in with a file needs its reason too. Admin exceptions always carry a note of 10 to 300. */
export function DecisionDialog({ open, onClose, mode, name, noteRequired = false, onSubmit }: {
  open: boolean; onClose: () => void; mode: 'reject' | 'disqualify' | 'verifyDq'; name: string; noteRequired?: boolean;
  onSubmit: (body: { reasonCode: string; note?: string }, key: string) => Promise<void>;
}) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setReason(''); setNote(''); setBusy(false); err.clear(); key.current = newIdempotencyKey(); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);
  const reasons: readonly string[] = mode === 'reject' ? REJECT_REASONS : DQ_REASONS;
  const noteLen = note.trim().length;
  const noteMax = mode === 'reject' ? 120 : NOTE_MAX;
  const noteOk = mode === 'verifyDq' ? true : noteRequired ? noteLen >= NOTE_MIN && noteLen <= NOTE_MAX : noteLen <= noteMax && (mode === 'reject' || noteLen === 0 || noteLen >= NOTE_MIN);
  const valid = !!reason && noteOk;
  async function go() {
    setBusy(true); err.clear();
    try { await onSubmit({ reasonCode: reason, ...(note.trim() && mode !== 'verifyDq' ? { note: note.trim() } : {}) }, key.current); } catch (e) { err.fail(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t(mode === 'reject' ? 'organizer.results.reject.title' : 'organizer.results.disqualify.title')} description={name} size="md">
      <div className="space-y-4" data-testid={`${mode}-dialog`}>
        {err.view}
        {mode !== 'reject' && <p className="text-sm text-[var(--color-fg-secondary)]">{t('organizer.results.disqualify.warn')}</p>}
        <Field label={t('organizer.results.correct.reason')} required>
          <Select value={reason} onChange={e => setReason(e.target.value)} data-testid="decision-reason">
            <option value="">—</option>
            {reasons.map(r => <option key={r} value={r}>{t(`organizer.results.reason.${r}` as MessageKey)}</option>)}
          </Select>
        </Field>
        {mode !== 'verifyDq' && (
          <Field label={t(mode === 'reject' ? 'organizer.results.reject.note' : 'organizer.results.disqualify.note')} hint={`${noteLen}/${noteMax}`} required={noteRequired}>
            <Textarea rows={3} maxLength={noteMax} value={note} onChange={e => setNote(e.target.value)} data-testid="decision-note" />
          </Field>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant="destructive" loading={busy} disabled={!valid} onClick={() => void go()} data-testid="decision-confirm">{t(mode === 'reject' ? 'organizer.results.action.reject' : 'organizer.results.action.disqualify')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

// ── Correct (§6.6, §9.2) ──
export type CorrectionBody = { netTime?: string; gunTime?: string; finishStatus?: string; reasonCode: string; note: string };
export function CorrectDialog({ open, onClose, row, title, submitLabel, onSubmit }: {
  open: boolean; onClose: () => void; row: ResultRow | null; title?: string; submitLabel?: string; onSubmit: (body: CorrectionBody, key: string) => Promise<void>;
}) {
  const { t } = useApp();
  const [net, setNet] = useState('');
  const [gun, setGun] = useState('');
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const err = useWriteError();
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setNet(''); setGun(''); setStatus(''); setReason(''); setNote(''); setBusy(false); err.clear(); key.current = newIdempotencyKey(); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.registrationId]);
  const pNet = useMemo(() => (net.trim() ? parseTime(net) : null), [net]);
  const pGun = useMemo(() => (gun.trim() ? parseTime(gun) : null), [gun]);
  const timeErr = (p: ReturnType<typeof parseTime> | null) => (p && !p.ok ? t(p.reason === 'range' ? 'organizer.results.problem.time_out_of_range' : 'organizer.results.problem.time_invalid') : undefined);
  const changed = (pNet?.ok ?? false) || (pGun?.ok ?? false) || (!!status && status !== row?.finishStatus);
  const noteLen = note.trim().length;
  const valid = changed && !(pNet && !pNet.ok) && !(pGun && !pGun.ok) && !!reason && noteLen >= NOTE_MIN && noteLen <= NOTE_MAX;
  async function go() {
    setBusy(true); err.clear();
    try {
      await onSubmit({ ...(pNet?.ok ? { netTime: pNet.text } : {}), ...(pGun?.ok ? { gunTime: pGun.text } : {}), ...(status && status !== row?.finishStatus ? { finishStatus: status } : {}), reasonCode: reason, note: note.trim() }, key.current);
    } catch (e) { err.fail(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={title ?? t('organizer.results.correct.title')} description={row ? `${row.displayName ?? ''} ${row.bibNumber ? `· ${row.bibNumber}` : ''}` : undefined} size="lg">
      <div className="space-y-4" data-testid="correct-dialog">
        {err.view && <div data-testid="correct-error">{err.error?.stale ? <Alert tone="error">{t('organizer.results.error.result_changed')}</Alert> : err.view}</div>}
        <dl className="grid grid-cols-3 gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="correct-current">
          <div><dt className="text-[var(--color-fg-quaternary)]">{t('organizer.results.col.net')}</dt><dd className="font-mono">{formatElapsed(row?.netElapsedMs)}</dd></div>
          <div><dt className="text-[var(--color-fg-quaternary)]">{t('organizer.results.col.gun')}</dt><dd className="font-mono">{formatElapsed(row?.gunElapsedMs)}</dd></div>
          <div><dt className="text-[var(--color-fg-quaternary)]">{t('organizer.results.col.status')}</dt><dd>{row?.finishStatus ? t(`organizer.results.status.${row.finishStatus}` as MessageKey) : '—'}</dd></div>
        </dl>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('organizer.results.correct.newNet')} hint="H:MM:SS" error={timeErr(pNet)}><Input value={net} inputMode="numeric" onChange={e => setNet(e.target.value)} className="font-mono" data-testid="correct-net" /></Field>
          <Field label={t('organizer.results.correct.newGun')} hint="H:MM:SS" error={timeErr(pGun)}><Input value={gun} inputMode="numeric" onChange={e => setGun(e.target.value)} className="font-mono" data-testid="correct-gun" /></Field>
          <Field label={t('organizer.results.correct.newStatus')}>
            <Select value={status} onChange={e => setStatus(e.target.value)} data-testid="correct-status">
              <option value="">{t('organizer.results.correct.keep')}</option>
              {(['finished', 'dnf', 'dns'] as const).map(s => <option key={s} value={s}>{t(`organizer.results.status.${s}` as MessageKey)}</option>)}
            </Select>
          </Field>
          <Field label={t('organizer.results.correct.reason')} required>
            <Select value={reason} onChange={e => setReason(e.target.value)} data-testid="correct-reason">
              <option value="">—</option>
              {CORRECT_REASONS.map(r => <option key={r} value={r}>{t(`organizer.results.reason.${r}` as MessageKey)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={t('organizer.results.correct.note')} hint={`${noteLen}/${NOTE_MAX}`} required>
          <Textarea rows={3} maxLength={NOTE_MAX} value={note} onChange={e => setNote(e.target.value)} data-testid="correct-note" />
        </Field>
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('organizer.results.correct.warn')}</p>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={!valid} onClick={() => void go()} data-testid="correct-confirm">{submitLabel ?? t('organizer.results.action.correct')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Whether a failed write was a stale revision, to offer "Reload". */
export const isStale = (e: { stale: boolean } | null) => !!e?.stale;
