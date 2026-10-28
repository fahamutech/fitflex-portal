'use client';
// Events S4 (design spec docs/design/events-s4-payments-and-tickets.md §6.2, decisions D23, D26): the dialogs an admin
// uses to decide an event-order payment. Approving needs the amount actually received, typed from the till statement
// (empty by default: a person reads the statement, the page never rubber-stamps). The backend checks it against the
// order and refuses a difference (409 amount_mismatch, nothing written). Rejecting needs one of five reasons.
import { useEffect, useState } from 'react';
import { api, type EventPaymentDecision, type EventRejectCode, type PaymentRequest } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { MEMBER_NOTE_MAX, REJECT_CODES, fmt, parseAmountReceived, rejectCodeKey, trackEventsS4Analytics } from '@/lib/events';
import { errorCode, expectedAmount, moneyErrorKey } from '@/lib/money-approval';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../app/providers';

export type EventDecisionResult = { decision: 'approve' | 'reject'; response: EventPaymentDecision & Partial<PaymentRequest> };

const memberName = (p: PaymentRequest) => p.member?.displayName || p.member?.email || p.memberId;

/** Text for a refusal of the decision route: the typed expected amount for a mismatch, else the money-approval mapping. */
function decisionErrorText(err: unknown, t: (k: MessageKey) => string): string {
  // The shop-order wording of `amount_required` does not fit event payments.
  if (errorCode(err) === 'amount_required') return t('payments.event.err.amount_required');
  const expected = errorCode(err) === 'amount_mismatch' ? expectedAmount(err) : null;
  return expected != null ? fmt(t('money2.err.amount_mismatch_expected'), { amount: money(expected) }) : t(moneyErrorKey(err));
}

export function EventApproveDialog({ payment, verifiedText, onClose, onDone }: { payment: PaymentRequest | null; verifiedText?: string | null; onClose: () => void; onDone: (r: EventDecisionResult) => void }) {
  const { t, token } = useApp();
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setAmount(''); setError(null); setReference(payment ? (payment.reference || payment.memberReference || '') : ''); }, [payment]);
  if (!payment) return null;
  const eo = payment.eventOrder;
  const memberRef = payment.memberReference || '';
  const locked = !!payment.secondApproverRequired && !!payment.verifiedBy;
  const typed = parseAmountReceived(amount);
  const expected = eo?.expectedTzs ?? payment.amountTzs;

  async function confirm() {
    if (!token || typed == null || !payment) return;
    setBusy(true); setError(null);
    try {
      const response = await api.decideEventPayment(token, payment.id, { decision: 'approve', amountTzs: typed, ...(reference.trim() ? { reference: reference.trim() } : {}) });
      trackEventsS4Analytics('event_payment_decided', { outcome: response.event?.outcome ?? 'confirmed' });
      onDone({ decision: 'approve', response });
    } catch (err) { setError(decisionErrorText(err, t)); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={t('payments.event.approveTitle')} description={`${memberName(payment)} · ${money(payment.amountTzs)}`} size="md">
      <div className="space-y-4" data-testid="event-approve-dialog">
        <div data-testid="event-approve-summary">
          <Alert tone="info">
            <p className="font-semibold">{eo?.eventTitle ?? t('payments.kind.eventOrder')} · {eo?.reference}</p>
            <p>{eo ? fmt(t('payments.event.places'), { n: eo.placesCount }) : ''}{eo?.organizationName ? ` · ${eo.organizationName}` : ''}</p>
            <p>{t('payments.event.expected')}: <strong data-testid="event-approve-expected">{money(expected)}</strong></p>
          </Alert>
        </div>
        {eo?.lateOutcome === 'would_rehold' && <div data-testid="event-approve-late-rehold"><Alert tone="info">{t('payments.event.late.rehold')}</Alert></div>}
        {eo?.lateOutcome === 'would_refund' && <div data-testid="event-approve-late-refund"><Alert tone="warning">{fmt(t('payments.event.late.refund'), { amount: money(expected) })}</Alert></div>}
        {(memberRef || payment.payerPhone) && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-4 py-3" data-testid="event-approve-member-details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
              {memberRef && (<><dt className="font-medium text-[var(--color-brand-700)]">{t('manualPay.memberRef')}</dt><dd className="font-mono font-semibold select-all text-[var(--color-fg-primary)]">{memberRef}</dd></>)}
              {payment.payerPhone && (<><dt className="font-medium text-[var(--color-brand-700)]">{t('manualPay.payerPhone')}</dt><dd className="font-mono font-semibold select-all text-[var(--color-fg-primary)]">{payment.payerPhone}</dd></>)}
            </dl>
            <p className="mt-2 text-xs text-[var(--color-fg-tertiary)]">{t('money2.matchStatement')}</p>
          </div>
        )}
        {verifiedText && <p className="text-xs text-[var(--color-fg-tertiary)]" data-testid="event-approve-verified-by">{verifiedText}</p>}
        {error && <div data-testid="event-approve-error"><Alert tone="error">{error}</Alert></div>}
        <Field label={t('payments.event.amountReceived')} hint={t('payments.event.amountReceived.hint')} required>
          <Input inputMode="numeric" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9,]/g, ''))} data-testid="event-approve-amount" placeholder="" />
        </Field>
        <Field label={t('manualPay.referenceToRecord')} hint={locked ? t('money2.referenceLocked') : t('manualPay.referenceHint')}>
          <Input className="font-mono" value={reference} disabled={locked} onChange={e => setReference(e.target.value)} data-testid="event-approve-reference" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={typed == null} onClick={() => void confirm()} data-testid="event-approve-confirm">{t('payments.event.confirm')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

export function EventRejectDialog({ payment, onClose, onDone }: { payment: PaymentRequest | null; onClose: () => void; onDone: (r: EventDecisionResult) => void }) {
  const { t, token } = useApp();
  const [code, setCode] = useState<EventRejectCode | ''>('');
  const [memberNote, setMemberNote] = useState('');
  const [memberNoteSw, setMemberNoteSw] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setCode(''); setMemberNote(''); setMemberNoteSw(''); setNote(''); setError(null); }, [payment]);
  if (!payment) return null;
  const needsNote = code === 'other';
  const ok = !!code && (!needsNote || memberNote.trim().length > 0 || memberNoteSw.trim().length > 0);
  async function reject() {
    if (!token || !code || !payment) return;
    setBusy(true); setError(null);
    try {
      const response = await api.decideEventPayment(token, payment.id, {
        decision: 'reject', reasonCode: code, ...(memberNote.trim() ? { memberNote: memberNote.trim() } : {}), ...(memberNoteSw.trim() ? { memberNoteSw: memberNoteSw.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      });
      trackEventsS4Analytics('event_payment_decided', { outcome: 'rejected' });
      onDone({ decision: 'reject', response });
    } catch (err) { setError(errorCode(err) === 'note_required' ? t('payments.event.reject.noteRequired') : decisionErrorText(err, t)); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={t('payments.event.rejectTitle')} description={`${memberName(payment)} · ${money(payment.amountTzs)}`} size="md">
      <div className="space-y-4" data-testid="event-reject-dialog">
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('payments.event.reject.hint')}</p>
        {error && <div data-testid="event-reject-error"><Alert tone="error">{error}</Alert></div>}
        <Field label={t('payments.event.reject.reason')} required>
          <Select value={code} onChange={e => setCode(e.target.value as EventRejectCode | '')} data-testid="event-reject-reason">
            <option value="">—</option>
            {REJECT_CODES.map(c => <option key={c} value={c}>{t(rejectCodeKey(c))}</option>)}
          </Select>
        </Field>
        <Field label={t('payments.event.reject.memberNote')} hint={`${t('payments.event.reject.memberNote.hint')} · ${fmt(t('events.basics.counter'), { n: memberNote.length, max: MEMBER_NOTE_MAX })}`} required={needsNote}>
          <Textarea rows={2} value={memberNote} onChange={e => setMemberNote(e.target.value.slice(0, MEMBER_NOTE_MAX))} data-testid="event-reject-member-note" />
        </Field>
        <Field label={t('payments.event.reject.memberNoteSw')} hint={`${t('payments.event.reject.memberNote.hint')} · ${fmt(t('events.basics.counter'), { n: memberNoteSw.length, max: MEMBER_NOTE_MAX })}`}>
          <Textarea rows={2} value={memberNoteSw} onChange={e => setMemberNoteSw(e.target.value.slice(0, MEMBER_NOTE_MAX))} data-testid="event-reject-member-note-sw" />
        </Field>
        <Field label={t('money2.noteOptional')}>
          <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={500} data-testid="event-reject-note" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant="destructive" loading={busy} disabled={!ok} onClick={() => void reject()} data-testid="event-reject-confirm">{t('payments.action.reject')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
