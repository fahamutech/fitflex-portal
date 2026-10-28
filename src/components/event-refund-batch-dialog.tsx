'use client';
// Events S4 (design spec docs/design/events-s4-payments-and-tickets.md §6.5, decisions D12, D27): an admin cancels an
// event that may have paid orders. The first step is the existing reason and note; when paid orders exist a second part
// states what will happen (unpaid orders released, paid orders cancelled and their tickets revoked, refunds raised as
// requests for a second admin to approve), the numbers are repeated in a confirmation, and the result links to the batch.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type EventCancelImpact, type EventRefundBatchResult } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { CANCEL_REASONS, cancelReasonKey, errorCode, errorKey, fmt, trackEventsS4Analytics } from '@/lib/events';
import { Alert, Button, Checkbox, Field, Select, Textarea } from '@/components/shared';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../app/providers';

type Phase = 'form' | 'confirm' | 'done';

export function EventCancelWithRefundsDialog({ open, eventId, onClose, onCancelled }: { open: boolean; eventId: string; onClose: () => void; onCancelled: () => void }) {
  const { t, token } = useApp();
  const [impact, setImpact] = useState<EventCancelImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<string>('organizer_decision');
  const [noteEn, setNoteEn] = useState('');
  const [noteSw, setNoteSw] = useState('');
  const [raise, setRaise] = useState(true);
  const [phase, setPhase] = useState<Phase>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<EventRefundBatchResult | null>(null);
  const [raised, setRaised] = useState(false);

  const loadImpact = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setImpact(await api.adminEventCancelPreview(token, eventId)); }
    // Without the preview route (older backend, or nothing to preview) the plain S2 cancel still works.
    catch { setImpact(null); }
    finally { setLoading(false); }
  }, [token, eventId]);
  useEffect(() => {
    if (!open) return;
    setPhase('form'); setError(null); setBatch(null); setRaised(false); setRaise(true); setReason('organizer_decision'); setNoteEn(''); setNoteSw('');
    void loadImpact();
  }, [open, loadImpact]);

  const paid = impact?.paidOrders ?? 0;
  const willRaise = paid > 0 && raise;

  async function run() {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const body = { reason, note: { en: noteEn.trim(), sw: noteSw.trim() }, ...(impact && paid > 0 ? { refundPaidOrders: raise, ...(raise ? { expectedRefundableTzs: impact.refundableTzs } : {}) } : {}) };
      const out = await api.adminCancelEvent(token, eventId, body);
      let result: EventRefundBatchResult | null = out.batch ?? (out.batchId ? { batchId: out.batchId, created: out.created ?? 0, existing: out.existing ?? 0, remaining: out.remaining ?? 0, amountTzs: out.amountTzs ?? 0 } : null);
      // The cancel answer does not always carry the batch (the spec names only `{ status }`); the batch route is idempotent, so ask it for the numbers.
      if (!result && willRaise && impact) {
        try { result = await api.adminEventRefundBatch(token, eventId, { expectedRefundableTzs: impact.refundableTzs }); } catch (err) { setError(t(errorKey(err))); }
      }
      setBatch(result); setRaised(willRaise);
      if (result) trackEventsS4Analytics('refund_batch_created', { count: result.created });
      setPhase('done');
      onCancelled();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'refundable_changed') { setError(t('events.error.refundable_changed')); await loadImpact(); setPhase('form'); }
      else { setError(t(errorKey(err))); setPhase('form'); }
    } finally { setBusy(false); }
  }
  async function continueBatch() {
    if (!token || !impact) return;
    setBusy(true); setError(null);
    try { setBatch(await api.adminEventRefundBatch(token, eventId, { expectedRefundableTzs: impact.refundableTzs })); }
    catch (err) { setError(t(errorKey(err))); }
    finally { setBusy(false); }
  }

  const summary = impact && (impact.awaitingOrders > 0 || paid > 0) ? fmt(t('events.cancel.impact'), { awaiting: impact.awaitingOrders, paid, places: impact.paidPlaces, total: money(impact.refundableTzs, '').trim() }) : '';
  const confirmLabel = willRaise ? t('events.cancel.confirmRefund') : t('events.cancel.action');

  return (
    <>
      <Dialog open={open && phase !== 'confirm'} onClose={onClose} title={t('events.cancel.title')} description={phase === 'done' ? undefined : t('events.cancel.body')} size="md">
        {phase === 'done' ? (
          <div className="space-y-3" data-testid="cancel-event-result">
            {error && <Alert tone="error">{error}</Alert>}
            <Alert tone="success">
              {raised && batch ? fmt(t('events.cancel.done'), { created: batch.created + batch.existing }) : t('events.cancel.doneOnly')}
            </Alert>
            {raised && batch && batch.remaining > 0 && (
              <div className="flex flex-wrap items-center gap-2" data-testid="cancel-event-remaining">
                <span className="text-sm">{fmt(t('events.cancel.remaining'), { n: batch.remaining })}</span>
                <Button variant="secondary" size="sm" loading={busy} onClick={() => void continueBatch()} data-testid="cancel-event-continue">{t('events.cancel.continue')}</Button>
              </div>
            )}
            {raised && batch && (
              <Link href={`/admin/refunds?batch=${encodeURIComponent(batch.batchId)}`} className="inline-flex" data-testid="cancel-event-review"><Button variant="primary" size="sm">{t('events.cancel.reviewRefunds')}</Button></Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {error && <div data-testid="cancel-event-error"><Alert tone="error">{error}</Alert></div>}
            <Field label={t('events.cancel.reason')} required>
              <Select value={reason} onChange={e => setReason(e.target.value)} data-testid="cancel-reason">
                {CANCEL_REASONS.map(r => <option key={r} value={r}>{t(cancelReasonKey(r))}</option>)}
              </Select>
            </Field>
            <Field label={t('events.cancel.noteEn')}><Textarea rows={3} value={noteEn} onChange={e => setNoteEn(e.target.value)} maxLength={500} data-testid="cancel-note-en" /></Field>
            <Field label={t('events.cancel.noteSw')}><Textarea rows={3} value={noteSw} onChange={e => setNoteSw(e.target.value)} maxLength={500} data-testid="cancel-note-sw" /></Field>
            {loading ? <p className="text-sm text-[var(--color-fg-quaternary)]" aria-busy="true">{t('common.loading')}</p> : impact && (impact.awaitingOrders > 0 || paid > 0) && (
              <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3" data-testid="cancel-event-impact">
                <p className="text-sm" data-testid="cancel-event-summary">{summary}</p>
                {impact.awaitingWithSubmittedPayment > 0 && <div data-testid="cancel-event-submitted"><Alert tone="warning">{fmt(t('events.cancel.submittedWarning'), { n: impact.awaitingWithSubmittedPayment })}</Alert></div>}
                {paid > 0 && (
                  <>
                    <Checkbox checked={raise} onChange={e => setRaise(e.target.checked)} data-testid="cancel-event-raise"
                      label={fmt(t('events.cancel.raiseRefunds'), { paid, total: money(impact.refundableTzs, '').trim() })} />
                    <p className="text-xs text-[var(--color-fg-quaternary)]">{t('events.cancel.raiseRefunds.hint')}</p>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {phase === 'done' ? <Button variant="secondary" onClick={onClose} data-testid="cancel-event-close">{t('events.common.close')}</Button> : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="destructive" disabled={loading} onClick={() => (paid > 0 ? setPhase('confirm') : void run())} loading={busy && paid === 0} data-testid="cancel-confirm">{confirmLabel}</Button>
            </>
          )}
        </DialogFooter>
      </Dialog>
      <ConfirmDialog
        open={open && phase === 'confirm'}
        onClose={() => setPhase('form')}
        onConfirm={() => void run()}
        busy={busy}
        title={confirmLabel}
        description={<span data-testid="cancel-event-confirm-numbers">{summary}{willRaise ? '' : ` ${t('events.cancel.noRefundsRaised')}`}</span>}
        confirmLabel={confirmLabel}
      />
    </>
  );
}
