'use client';
// Events S4 (design spec docs/design/events-s4-payments-and-tickets.md §6.4, §6.8): the payment panel of an event order.
// `AdminOrderPaymentPanel` sits in the admin order dialog (timeline, masked payer details, repair); the corporate variant is
// `CorporatePaymentSection` for billing users on /org/events and /hr/events (how to pay, send for checking, status, refund).
// Money is whole TZS (`money()` prints "TSh"). Payer phone and transaction ID reach admins with the `payments` scope only.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Printer, Wrench } from 'lucide-react';
import {
  api, type AdminEventOrderPayment, type CorporateEventOrderDetail, type EventCancelPreview, type EventPaymentState, type EventPaymentView, type EventRefundView, type EventsOptions,
} from '@/lib/api';
import { money } from '@/lib/admin-utils';
import {
  CORPORATE_NOTE_MAX, MEMBER_CANCEL_REASONS, attentionReasonKey, errorBody, errorCode, errorKey, eventDateTime, fmt, memberCancelReasonKey, newPaymentIdempotencyKey, rejectCodeKey,
  maskContact, refundScopeKey, todayEat, trackEventsS4Analytics, type Tone,
} from '@/lib/events';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, Checkbox, Field, Input, Select, Textarea, useToast } from '@/components/shared';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../app/providers';

/** Pill of a payment's member-facing state (§3.3). Text-first, never colour alone. */
export const PAYMENT_STATE: Record<EventPaymentState, { key: MessageKey; tone: Tone }> = {
  submitted: { key: 'events.order.payment.state.submitted', tone: 'warning' },
  processing: { key: 'events.order.payment.state.processing', tone: 'warning' },
  confirmed: { key: 'events.order.payment.state.confirmed', tone: 'success' },
  rejected: { key: 'events.order.payment.state.rejected', tone: 'danger' },
  failed: { key: 'events.order.payment.state.failed', tone: 'danger' },
  expired: { key: 'events.order.payment.state.expired', tone: 'gray' },
  needs_attention: { key: 'payments.event.attention', tone: 'warning' },
};
const paymentStateOf = (state: string | null | undefined) => PAYMENT_STATE[(state ?? 'submitted') as EventPaymentState] ?? PAYMENT_STATE.submitted;
const REFUND_STATUS_TONE: Record<string, Tone> = { requested: 'warning', approved: 'brand', paid: 'success', rejected: 'gray' };

/** Refund rows of an order: status, scope, amount and the payout reference once sent (§6.4). */
export function EventRefundList({ refunds, refundsHref }: { refunds: EventRefundView[]; refundsHref?: string }) {
  const { t, locale } = useApp();
  if (!refunds.length) return null;
  return (
    <ul className="space-y-2" data-testid="order-refunds">
      {refunds.map(r => {
        const scope = refundScopeKey(r.scope);
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] px-3 py-2" data-testid={`order-refund-${r.id}`}>
            <Badge tone={REFUND_STATUS_TONE[r.status] ?? 'gray'}>{t(`refunds.filter.${r.status}` as 'refunds.filter.paid')}</Badge>
            {scope && <span>{t(scope)}</span>}
            <span className="font-medium tabular-nums">{money(r.amountTzs, r.currency)}</span>
            {r.status === 'paid' && r.paymentReference && <span className="text-xs text-[var(--color-fg-tertiary)]">{t('refunds.col.reference')}: <span className="font-mono">{r.paymentReference}</span></span>}
            {r.status === 'rejected' && r.rejectionNote && <span className="text-xs text-[var(--color-fg-tertiary)]">{r.rejectionNote}</span>}
            {r.paidAt && <span className="text-xs text-[var(--color-fg-quaternary)]">{new Date(r.paidAt).toLocaleDateString(locale === 'sw' ? 'sw-TZ' : 'en-GB')}</span>}
          </li>
        );
      })}
      {refundsHref && <li><Link href={refundsHref} className="text-sm font-medium text-[var(--color-brand-700)] underline" data-testid="order-refunds-link">{t('events.order.refunds.open')}</Link></li>}
    </ul>
  );
}

// ═══════════════════════════ Admin order dialog (§6.4) ═══════════════════════════

/**
 * "Payment" section of the admin order dialog: status, expected vs received, the payer details (full with the `payments`
 * scope, masked without), a timeline, the hold history, repair and a way to raise a refund for an unfulfilled payment.
 */
export function AdminOrderPaymentPanel({ eventId, orderId, orderReference, orderStatus, payment, tickets, refunds, timezone, timezoneAbbr, onChanged }: {
  eventId: string; orderId: string; orderReference: string; orderStatus: string; payment: AdminEventOrderPayment | null | undefined;
  tickets: { issued: number; cancelled: number } | null | undefined; refunds: EventRefundView[] | undefined; timezone: string; timezoneAbbr?: string | null; onChanged: () => void;
}) {
  const { t, token, locale, hasPermission } = useApp();
  const toast = useToast();
  const canPayments = hasPermission('payments');
  const [busy, setBusy] = useState<'repair' | 'refund' | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [note, setNote] = useState('');
  const when = (iso: string | null | undefined) => eventDateTime(iso, timezone, locale, timezoneAbbr);
  useEffect(() => { trackEventsS4Analytics('payment_panel_viewed'); }, [orderId]);

  async function repair() {
    if (!token) return;
    setBusy('repair');
    try { await api.repairEventPayment(token, eventId, orderId); toast.success(t('payments.event.repair.done')); onChanged(); }
    catch (err) { toast.error(t(errorKey(err))); }
    finally { setBusy(null); }
  }
  async function raiseRefund() {
    if (!token || !payment?.id || note.trim().length < 5) return;
    setBusy('refund');
    try { await api.raiseEventPaymentRefund(token, { eventPaymentId: payment.id, note: note.trim() }); toast.success(t('events.order.payment.refundRaised')); setRefundOpen(false); setNote(''); onChanged(); }
    catch (err) { toast.error(t(errorCode(err) === 'payment_not_unfulfilled' ? 'events.error.payment_not_unfulfilled' : errorKey(err))); }
    finally { setBusy(null); }
  }

  const st = payment ? paymentStateOf(payment.state) : null;
  const attention = payment?.state === 'needs_attention';
  const hasRefund = !!payment?.refundId || (refunds ?? []).length > 0;
  const canRaise = canPayments && attention && !hasRefund && !!payment?.id && orderStatus !== 'confirmed';
  // Staff with `events` but not `payments` never see the payer's number or transaction ID (§6.1): masked, never the raw value.
  const phone = payment?.payerPhone ? (canPayments ? payment.payerPhone : maskContact(payment.payerPhone)) : null;
  const reference = payment?.reference ? (canPayments ? payment.reference : '•••') : null;
  return (
    <section className="space-y-3 rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] p-4" aria-labelledby={`pay-h-${orderId}`} data-testid="order-payment-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`pay-h-${orderId}`} className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.order.payment.title')}</h3>
        {st && <span data-testid="order-payment-state"><Badge tone={st.tone}>{t(st.key)}</Badge></span>}
        {payment?.late && <Badge tone="warning">{t('events.order.payment.late')}</Badge>}
        {payment?.repairable && <span data-testid="order-payment-repair-badge"><Badge tone="danger">{t('payments.event.repair.badge')}</Badge></span>}
      </div>
      {!payment ? <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="order-payment-none">{t('events.order.payment.none')}</p> : (
        <>
          {attention && (
            <div data-testid="order-payment-attention">
              <Alert tone="warning">
                {t(attentionReasonKey(payment.failureReason))}
                {hasRefund && (
                  <> · <Link href={`/admin/refunds?order=${encodeURIComponent(orderReference)}`} className="underline" data-testid="order-payment-refund-link">{t('events.order.refunds.open')}</Link></>
                )}
              </Alert>
            </div>
          )}
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="order-payment-facts">
            <dt className="text-[var(--color-fg-quaternary)]">{t('events.order.payment.method')}</dt>
            <dd>{t(`events.order.payment.method.${payment.method}` as 'events.order.payment.method.manual')}</dd>
            <dt className="text-[var(--color-fg-quaternary)]">{t('payments.event.expected')}</dt>
            <dd className="tabular-nums">{payment.expectedTzs != null ? money(payment.expectedTzs, payment.currency) : '—'}</dd>
            <dt className="text-[var(--color-fg-quaternary)]">{t('events.order.payment.received')}</dt>
            <dd className="tabular-nums">{money(payment.amountTzs, payment.currency)}</dd>
            {reference && (<><dt className="text-[var(--color-fg-quaternary)]">{t('payments.col.reference')}</dt><dd className="font-mono" data-testid="order-payment-reference">{reference}</dd></>)}
            {payment.payerPhone !== undefined && (
              <>
                <dt className="text-[var(--color-fg-quaternary)]">{t('manualPay.payerPhone')}</dt>
                <dd className="font-mono" data-testid="order-payment-phone">{phone ?? '—'}</dd>
              </>
            )}
          </dl>
          {!canPayments && <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="order-payment-masked">{t('events.order.payment.maskedPhone')}</p>}

          <ol className="space-y-1 border-l-2 border-[var(--color-border-secondary)] pl-4 text-sm" data-testid="order-payment-timeline" aria-label={t('events.order.payment.timeline')}>
            {payment.submittedAt && <li>{t('events.order.payment.timeline.submitted')} · {when(payment.submittedAt)}</li>}
            {payment.verifiedAt && <li>{t('events.order.payment.timeline.verified')} · {payment.verifiedByName ?? t('money2.otherAdmin')} · {when(payment.verifiedAt)}</li>}
            {payment.state === 'confirmed' && payment.decidedAt && <li>{t('events.order.payment.timeline.approved')} · {payment.decidedByName ?? t('money2.otherAdmin')} · {when(payment.decidedAt)}</li>}
            {(payment.state === 'rejected' || payment.state === 'failed') && payment.decidedAt && (
              <li>{t('events.order.payment.timeline.rejected')} · {payment.decidedByName ?? t('money2.otherAdmin')} · {when(payment.decidedAt)}{payment.rejectCode ? ` · ${t(rejectCodeKey(payment.rejectCode))}` : ''}{payment.memberNote ? ` · “${payment.memberNote}”` : ''}</li>
            )}
            {payment.ticketsIssuedAt && <li>{t('events.order.payment.timeline.tickets')} · {when(payment.ticketsIssuedAt)}</li>}
            {(payment.holdHistory ?? []).map((h, i) => <li key={i} className="text-[var(--color-fg-tertiary)]">{fmt(t('events.order.payment.holdExtended'), { time: when(h.holdExpiresAt) })}</li>)}
          </ol>
          <div className="flex flex-wrap gap-2">
            {canPayments && <Link href="/admin/payments?kind=event_order" className="inline-flex" data-testid="order-payment-open-payments"><Button variant="secondary" size="sm">{t('events.order.payment.openPayments')}</Button></Link>}
            {canPayments && payment.repairable && (
              <Button variant="secondary" size="sm" loading={busy === 'repair'} onClick={() => void repair()} data-testid="order-payment-repair"><Wrench aria-hidden="true" className="h-3.5 w-3.5" />{t('payments.event.repair.action')}</Button>
            )}
            {canRaise && <Button variant="secondary" size="sm" onClick={() => setRefundOpen(true)} data-testid="order-payment-raise-refund">{t('events.order.payment.raiseRefund')}</Button>}
          </div>
        </>
      )}
      {tickets && <p className="text-sm" data-testid="order-tickets-summary">{fmt(t('events.order.tickets.summary'), { n: tickets.issued, m: tickets.cancelled })}</p>}
      {!!refunds?.length && <EventRefundList refunds={refunds} refundsHref={canPayments ? `/admin/refunds?order=${encodeURIComponent(orderReference)}` : undefined} />}

      <Dialog open={refundOpen} onClose={() => setRefundOpen(false)} title={t('events.order.payment.raiseRefund')} description={t('events.order.payment.raiseRefund.body')} size="sm">
        <Field label={t('events.order.payment.raiseRefund.note')} required hint={t('events.order.cancelPaid.noteHint')}>
          <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={500} data-testid="order-payment-refund-note" />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setRefundOpen(false)} disabled={busy === 'refund'}>{t('common.cancel')}</Button>
          <Button loading={busy === 'refund'} disabled={note.trim().length < 5} onClick={() => void raiseRefund()} data-testid="order-payment-refund-confirm">{t('events.order.payment.raiseRefund.confirm')}</Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}

// ═══════════════════════════ Corporate order (§6.8) ═══════════════════════════

type Props = {
  token: string; orgId: string; doc: CorporateEventOrderDetail; options: EventsOptions | null | undefined; canBilling: boolean; onChanged: () => void;
};

/** The reference of the order to quote when paying (order reference, `EV-…`), also the print summary's heading. */
function HowToPay({ doc, ready }: { doc: CorporateEventOrderDetail; ready: boolean }) {
  const { t } = useApp();
  const ins = doc.next?.instructions ?? null;
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); };
  if (!ready || !ins) {
    return <div data-testid="corp-pay-not-configured"><Alert tone="warning">{t('corp.events.pay.notConfigured')}</Alert></div>;
  }
  const row = (label: string, value: string | null | undefined, id: string, copyable = false) => (value ? (
    <>
      <dt className="text-[var(--color-fg-quaternary)]">{label}</dt>
      <dd className="flex items-center gap-2 font-medium"><span data-testid={id}>{value}</span>{copyable && <Button type="button" variant="ghost" size="sm" onClick={() => copy(value)} aria-label={`${t('common.copy')}: ${label}`}>{t('common.copy')}</Button>}</dd>
    </>
  ) : null);
  return (
    <Card data-testid="corp-pay-howto" className="corp-print-area">
      <CardContent className="space-y-3">
        <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('corp.events.pay.title')}</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {row(t('corp.events.col.reference'), doc.order.reference, 'corp-pay-ref', true)}
          {row(t('corp.events.col.event'), doc.event.title, 'corp-pay-event')}
          {row(t('corp.events.col.places'), String(doc.registrations.length), 'corp-pay-places')}
          {row(t('corp.events.pay.amountDue'), money(ins.amountTzs ?? doc.order.totalTzs, doc.order.currency), 'corp-pay-amount', true)}
          {row(t('corp.events.pay.bankName'), ins.bankName, 'corp-pay-bank')}
          {row(t('corp.events.pay.accountName'), ins.accountName, 'corp-pay-account-name')}
          {row(t('corp.events.pay.accountNumber'), ins.accountNumber, 'corp-pay-account-number', true)}
          {row(t('corp.events.pay.branch'), ins.branch, 'corp-pay-branch')}
          {row(t('corp.events.pay.lipaNamba'), ins.lipaNamba, 'corp-pay-lipa', true)}
          {row(t('corp.events.pay.lipaNambaName'), ins.lipaNambaName, 'corp-pay-lipa-name')}
        </dl>
        {ins.notes && <p className="text-sm text-[var(--color-fg-secondary)]">{ins.notes}</p>}
        <p className="text-sm text-[var(--color-fg-secondary)]">{fmt(t('corp.events.pay.steps'), { ref: doc.order.reference })}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => window.print()} data-testid="corp-pay-print"><Printer aria-hidden="true" className="h-4 w-4" />{t('corp.events.pay.print')}</Button>
      </CardContent>
    </Card>
  );
}

/**
 * The payment part of a corporate order page. Billing users (owner, admin, finance) see how to pay and tell FitFlex they
 * paid; others see a notice. The order and payment states drive what shows (submitted, rejected, expired, confirmed, refund).
 */
export function CorporatePaymentSection({ token, orgId, doc, options, canBilling, onChanged }: Props) {
  const { t, locale } = useApp();
  const toast = useToast();
  const { order, event } = doc;
  const payment = doc.payment ?? null;
  const tz = event.timezone;
  const [method, setMethod] = useState<'bank_transfer' | 'mobile_money'>('bank_transfer');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lateOpen, setLateOpen] = useState(false);
  const keyRef = useRef(newPaymentIdempotencyKey());
  const prefilled = useRef<string | null>(null);

  const paymentOn = options?.payment === 'manual';
  const graceHours = options?.hold?.lateGraceHours ?? 24;
  const withinGrace = order.status === 'expired' && !!order.closedAt && Date.now() - Date.parse(order.closedAt) < graceHours * 3_600_000;
  const submitted = payment?.state === 'submitted' || payment?.state === 'processing';

  // After a rejection the form returns prefilled with what was sent (§6.8 "Try again").
  useEffect(() => {
    if (payment?.state === 'rejected' && prefilled.current !== payment.id) {
      prefilled.current = payment.id;
      setReference(payment.reference ?? ''); if (payment.payerMethod) setMethod(payment.payerMethod); if (payment.paidOn) setPaidOn(payment.paidOn);
    }
  }, [payment]);

  // Poll the cheap status route every 30 s while the payment is under review (§3.5); reload the page data when it moved.
  const known = useRef({ pay: payment?.state ?? null, order: order.status });
  known.current = { pay: payment?.state ?? null, order: order.status };
  useEffect(() => {
    if (!submitted) return;
    const h = setInterval(() => {
      api.corporateEventPaymentStatus(token, orgId, order.id).then(s => {
        if ((s.payment?.state ?? null) !== known.current.pay || s.order.status !== known.current.order) onChanged();
      }).catch(() => undefined);
    }, 30_000);
    return () => clearInterval(h);
  }, [submitted, token, orgId, order.id, onChanged]);

  const today = todayEat();
  const refOk = reference.trim().length >= 4;
  const dateOk = !!paidOn && paidOn <= today;
  const formOk = refOk && dateOk && note.length <= CORPORATE_NOTE_MAX && !!doc.next?.instructions;

  const submit = useCallback(async (retried = false) => {
    setBusy(true); setFormError(null);
    try {
      await api.submitCorporateEventPayment(token, orgId, order.id, { method, reference: reference.trim(), paidOn, ...(note.trim() ? { note: note.trim() } : {}) }, keyRef.current);
      keyRef.current = newPaymentIdempotencyKey();
      toast.success(t('corp.events.pay.sent'));
      setLateOpen(false); setNote('');
      onChanged();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'idempotency_key_reused' && !retried) { keyRef.current = newPaymentIdempotencyKey(); setBusy(false); return submit(true); }
      if (code === 'payment_in_progress') onChanged();
      const body = errorBody<{ retryAfterSeconds?: number }>(err);
      setFormError(code === 'rate_limited' && body?.retryAfterSeconds ? t('corp.events.rateLimited') : t(errorKey(err)));
    } finally { setBusy(false); }
  }, [token, orgId, order.id, method, reference, paidOn, note, onChanged, toast, t]);

  const showForm = canBilling && paymentOn && (
    (order.status === 'awaiting_payment' && (!payment || payment.canRetry || ['rejected', 'failed', 'expired'].includes(payment.state))) ||
    (order.status === 'expired' && withinGrace && lateOpen && !payment)
  );

  return (
    <div className="space-y-4" data-testid="corp-payment">
      {order.status === 'awaiting_payment' && !canBilling && paymentOn && <div data-testid="corp-pay-billing-gate"><Alert tone="info">{t('corp.events.pay.billingOnly')}</Alert></div>}

      {payment?.state === 'rejected' && (
        <div data-testid="corp-pay-rejected">
          <Alert tone="error">
            <p className="font-semibold">{t('corp.events.pay.rejected')}</p>
            <p>{t(rejectCodeKey(payment.rejectCode))}{payment.memberNote ? ` — ${payment.memberNote}` : ''}</p>
            {payment.canRetry && <p>{t('corp.events.pay.tryAgain')}</p>}
          </Alert>
        </div>
      )}
      {payment?.state === 'needs_attention' && <div data-testid="corp-pay-attention"><Alert tone="warning">{t(payment.refundId ? 'corp.events.pay.attentionRefund' : 'corp.events.pay.attention')}</Alert></div>}

      {submitted && payment && (
        <Card data-testid="corp-pay-submitted"><CardContent className="space-y-2">
          <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('corp.events.pay.submitted')}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {payment.payerMethod && (<><dt className="text-[var(--color-fg-quaternary)]">{t('corp.events.pay.method')}</dt><dd>{t(payment.payerMethod === 'bank_transfer' ? 'corp.events.pay.method.bank' : 'corp.events.pay.method.momo')}</dd></>)}
            <dt className="text-[var(--color-fg-quaternary)]">{t('corp.events.pay.reference')}</dt><dd className="font-mono" data-testid="corp-pay-submitted-ref">{payment.reference ?? '—'}</dd>
            {payment.paidOn && (<><dt className="text-[var(--color-fg-quaternary)]">{t('corp.events.pay.paidOn')}</dt><dd>{payment.paidOn}</dd></>)}
            <dt className="text-[var(--color-fg-quaternary)]">{t('corp.events.pay.sentAt')}</dt><dd>{eventDateTime(payment.submittedAt, tz, locale, event.timezoneAbbr)}</dd>
            {order.status === 'awaiting_payment' && (<><dt className="text-[var(--color-fg-quaternary)]">{t('corp.events.col.heldUntil')}</dt><dd>{eventDateTime(order.holdExpiresAt, tz, locale, event.timezoneAbbr)}</dd></>)}
          </dl>
          {options?.manualConfirmHours ? <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('corp.events.pay.confirmWithin'), { hours: options.manualConfirmHours })}</p> : null}
        </CardContent></Card>
      )}

      {order.status === 'expired' && payment && submitted && <div data-testid="corp-pay-expired-submitted"><Alert tone="info">{t('corp.events.pay.expiredSubmitted')}</Alert></div>}
      {order.status === 'expired' && !payment && withinGrace && paymentOn && canBilling && !lateOpen && (
        <div data-testid="corp-pay-late">
          <Alert tone="info"><span className="flex flex-wrap items-center gap-2">{t('corp.events.pay.late.body')}<Button variant="secondary" size="sm" onClick={() => setLateOpen(true)} data-testid="corp-pay-already-paid">{t('corp.events.pay.late.action')}</Button></span></Alert>
        </div>
      )}

      {order.status === 'confirmed' && <div data-testid="corp-pay-confirmed"><Alert tone="success">{t('corp.events.pay.confirmed')}</Alert></div>}

      {showForm && (
        <div className="space-y-4" data-testid="corp-pay-form">
          {order.status === 'expired' && <Alert tone="warning">{t('corp.events.pay.late.warning')}</Alert>}
          <HowToPay doc={doc} ready={!!doc.next?.instructions} />
          <Card><CardContent className="space-y-4">
            {formError && <div data-testid="corp-pay-error"><Alert tone="error">{formError}</Alert></div>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('corp.events.pay.method')} required>
                <Select value={method} onChange={e => setMethod(e.target.value as 'bank_transfer' | 'mobile_money')} data-testid="corp-pay-method" disabled={!doc.next?.instructions}>
                  <option value="bank_transfer">{t('corp.events.pay.method.bank')}</option>
                  <option value="mobile_money">{t('corp.events.pay.method.momo')}</option>
                </Select>
              </Field>
              <Field label={t('corp.events.pay.reference')} required hint={reference && !refOk ? t('corp.events.pay.reference.short') : undefined}>
                <Input value={reference} onChange={e => setReference(e.target.value)} maxLength={60} data-testid="corp-pay-reference" disabled={!doc.next?.instructions} />
              </Field>
              <Field label={t('corp.events.pay.paidOn')} required error={paidOn && !dateOk ? t('corp.events.pay.paidOn.future') : undefined}>
                <Input type="date" value={paidOn} max={today} onChange={e => setPaidOn(e.target.value)} data-testid="corp-pay-paid-on" disabled={!doc.next?.instructions} />
              </Field>
            </div>
            <Field label={t('corp.events.pay.note')} hint={fmt(t('events.basics.counter'), { n: note.length, max: CORPORATE_NOTE_MAX })}>
              <Textarea rows={2} value={note} onChange={e => setNote(e.target.value.slice(0, CORPORATE_NOTE_MAX))} data-testid="corp-pay-note" disabled={!doc.next?.instructions} />
            </Field>
            <Alert tone="info">{fmt(t('corp.events.pay.manual'), { time: eventDateTime(order.holdExpiresAt, tz, locale, event.timezoneAbbr) })}</Alert>
            <Button loading={busy} disabled={!formOk} onClick={() => void submit()} data-testid="corp-pay-submit">{t('corp.events.pay.submit')}</Button>
          </CardContent></Card>
        </div>
      )}
    </div>
  );
}

/** The refund card of a cancelled or refunded corporate order (§6.8). */
export function CorporateRefundCard({ refunds }: { refunds: EventRefundView[] | undefined }) {
  const { t } = useApp();
  if (!refunds?.length) return null;
  return (
    <Card data-testid="corp-refund-card"><CardContent className="space-y-3">
      <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('corp.events.refund.title')}</h3>
      <EventRefundList refunds={refunds} />
      <p className="text-xs text-[var(--color-fg-quaternary)]">{t('corp.events.refund.note')}</p>
    </CardContent></Card>
  );
}

/**
 * Cancel a corporate order after payment (§3.12.2, §6.8): the preview states the policy and the refund, a reason is required,
 * and a no-refund outcome needs an explicit tick. `expectedRefundTzs` goes back as an equality check only.
 */
export function CorporateCancelDialog({ open, token, orgId, orderId, onClose, onDone }: { open: boolean; token: string; orgId: string; orderId: string; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useApp();
  const toast = useToast();
  const [preview, setPreview] = useState<EventCancelPreview | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    setState('loading');
    try { setPreview(await api.corporateEventCancelPreview(token, orgId, orderId)); setState('ok'); } catch { setState('error'); }
  }, [token, orgId, orderId]);
  useEffect(() => { if (open) { setReason(''); setAck(false); setNotice(null); void load(); } }, [open, load]);

  async function confirm() {
    if (!preview || !reason) return;
    setBusy(true); setNotice(null);
    try {
      const out = await api.cancelCorporateEventOrder(token, orgId, orderId, reason, preview.refundTzs);
      toast.success(t(out?.requested ? 'corp.events.cancel.requested' : 'events.action.done'));
      onDone();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'refund_changed') { setNotice(t('events.error.refund_changed')); setAck(false); await load(); }
      else setNotice(t(errorKey(err)));
    } finally { setBusy(false); }
  }
  const blocked = !!preview && (!preview.eligible || preview.mode === 'closed' || !!preview.blocked);
  const noRefund = preview?.mode === 'none' || (preview?.mode === 'auto' && preview.refundTzs === 0);
  const needsAck = !!preview && !blocked && noRefund;
  const policyText = preview?.policy?.text?.[locale] ?? '';
  return (
    <Dialog open={open} onClose={onClose} title={t('corp.events.order.cancel')} description={t('corp.events.order.cancel.paidBody')} size="md">
      <div className="space-y-4 text-sm" data-testid="corp-cancel-dialog">
        {notice && <div data-testid="corp-cancel-notice"><Alert tone="warning">{notice}</Alert></div>}
        {state === 'loading' && <p aria-busy="true">{t('common.loading')}</p>}
        {state === 'error' && <Alert tone="error">{t('common.somethingWrong')} <Button variant="link" size="sm" onClick={() => void load()}>{t('common.tryAgain')}</Button></Alert>}
        {state === 'ok' && preview && (
          <>
            {blocked ? (
              <div data-testid="corp-cancel-blocked"><Alert tone="warning">{t(`events.cancel.blocked.${preview.blocked ?? 'cancellation_window_closed'}` as MessageKey)}</Alert></div>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1" data-testid="corp-cancel-preview">
                <dt className="text-[var(--color-fg-quaternary)]">{t('events.cancel.paid')}</dt><dd className="tabular-nums">{money(preview.paidTzs, preview.currency)}</dd>
                <dt className="text-[var(--color-fg-quaternary)]">{t('events.cancel.refund')}</dt>
                <dd className="font-semibold tabular-nums" data-testid="corp-cancel-refund">{preview.mode === 'manual_review' ? t('events.cancel.manualReview') : preview.refundTzs > 0 ? `${money(preview.refundTzs, preview.currency)} (${preview.percent}%)` : t('events.cancel.noRefund')}</dd>
                {preview.deadlineAt && (<><dt className="text-[var(--color-fg-quaternary)]">{t('events.cancel.deadline')}</dt><dd>{eventDateTime(preview.deadlineAt, 'Africa/Dar_es_Salaam', locale)}</dd></>)}
              </dl>
            )}
            {policyText && <p className="text-[var(--color-fg-secondary)]" data-testid="corp-cancel-policy">{policyText}</p>}
            {!blocked && (
              <>
                <Field label={t('corp.events.order.cancel.reason')} required>
                  <Select value={reason} onChange={e => setReason(e.target.value)} data-testid="corp-cancel-reason">
                    <option value="">—</option>
                    {MEMBER_CANCEL_REASONS.map(r => <option key={r} value={r}>{t(memberCancelReasonKey(r))}</option>)}
                  </Select>
                </Field>
                {needsAck && <Checkbox label={t('events.cancel.noRefund.ack')} checked={ack} onChange={e => setAck(e.target.checked)} data-testid="corp-cancel-ack" />}
              </>
            )}
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        {state === 'ok' && !blocked && <Button variant="destructive" loading={busy} disabled={!reason || (needsAck && !ack)} onClick={() => void confirm()} data-testid="corp-cancel-confirm">{t('corp.events.order.cancel')}</Button>}
      </DialogFooter>
    </Dialog>
  );
}

/** Resend a claim invitation (§3.10): warns that the old link stops working; honours the daily limit. */
export function ResendInvitationDialog({ target, token, orgId, orderId, onClose, onDone }: { target: { id: string; name: string } | null; token: string; orgId: string; orderId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!target) return;
    setBusy(true);
    try {
      const out = await api.resendCorporateClaimInvitation(token, orgId, orderId, target.id);
      toast[out.sent ? 'success' : 'error'](t(out.sent ? 'corp.events.invite.resend.done' : 'corp.events.invite.resend.failed'));
      onDone();
    } catch (err) {
      toast.error(t(errorCode(err) === 'resend_limit_reached' ? 'events.error.resend_limit_reached' : errorKey(err)));
      onClose();
    } finally { setBusy(false); }
  }
  return (
    <ConfirmDialog open={!!target} onClose={onClose} onConfirm={() => void go()} busy={busy} tone="primary" title={`${t('corp.events.invite.resend')}${target ? ` · ${target.name}` : ''}`}
      description={t('corp.events.invite.resend.warn')} confirmLabel={t('corp.events.invite.resend')} />
  );
}

export type { EventPaymentView };
