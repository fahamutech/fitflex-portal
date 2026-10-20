'use client';
// Record money a customer paid towards pay-later sales (S4 §6.1–6.2). Online only, never queued. FitFlex never
// holds this money. A payment above what is owed is refused (O-8: no customer credit).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type VendorCustomerPayment, type VendorCustomerProfile } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import {
  addDays, allocateOldestFirst, customerName, eatToday, errorBody, errorCode, fmt, isRefusal, newClientRef, PAYMENT_METHODS,
  REFERENCE_REQUIRED, receiptDay, saleMethodLabel,
} from '@/lib/vendor';
import { Alert, Button, Field, Input, Textarea } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useToast } from '@/components/ui/toast';
import { useApp } from '../../../../app/providers';
import { rateLimitText, useOnline } from './bits';

const BACK_DAYS = 30;
const MAX_REFERENCE = 100;
const MAX_NOTE = 200;
const chip = 'inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border px-3 text-sm font-medium transition-colors';
const chipOn = 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]';
const chipOff = 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-secondary)]';

export function RecordPaymentDialog({
  open, customer, onClose, onSaved, onStale,
}: {
  open: boolean;
  customer: VendorCustomerProfile;
  onClose: () => void;
  /** Saved: the payment and the customer's new balance. */
  onSaved: (payment: VendorCustomerPayment, stillOwedTzs: number) => void;
  /** The balance or the open sales changed meanwhile: reload the profile (the dialog stays open). */
  onStale: () => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const online = useOnline();
  const today = eatToday();
  const earliest = addDays(today, -BACK_DAYS);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(today);
  const [note, setNote] = useState('');
  const [manual, setManual] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<{ amount?: string; reference?: string; date?: string; alloc?: string }>({});
  const [alert, setAlert] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  /** The server's owed figure after a refused over-payment (the profile reloads behind). */
  const [owedOverride, setOwedOverride] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef(newClientRef());

  useEffect(() => {
    if (!open) return;
    setAmount(''); setMethod('cash'); setReference(''); setReceivedOn(eatToday()); setNote('');
    setManual(false); setAlloc({}); setErrors({}); setAlert(null); setOwedOverride(null); setBusy(false);
    clientRef.current = newClientRef();
  }, [open]);
  useEffect(() => { setOwedOverride(null); }, [customer.owedTzs]);

  // Any change makes it another payment: a fresh reference (a retry of the same payment keeps it).
  const changed = () => { clientRef.current = newClientRef(); setAlert(null); };

  const owed = owedOverride ?? customer.owedTzs;
  const open_ = customer.openSales;
  const value = /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : 0;
  const over = value > owed;
  const needsRef = REFERENCE_REQUIRED.has(method);
  const refMissing = needsRef && !reference.trim();
  const preview = useMemo(() => (over ? [] : allocateOldestFirst(open_, value)), [open_, value, over]);
  const manualRows = open_.map(s => ({ sale: s, amountTzs: /^\d+$/.test((alloc[s.id] ?? '').trim()) ? Number(alloc[s.id]) : 0 }));
  const manualSum = manualRows.reduce((n, r) => n + r.amountTzs, 0);
  const manualOver = manualRows.some(r => r.amountTzs > r.sale.balanceTzs);
  const mismatch = manual && (manualSum !== value || manualOver);
  const canSave = online && value > 0 && !over && !refMissing && !mismatch && !busy;

  async function save() {
    if (!token || !canSave) return;
    setBusy(true); setAlert(null); setErrors({});
    try {
      const res = await api.vendorRecordCustomerPayment(token, customer.id, {
        clientRef: clientRef.current,
        amountTzs: value,
        method,
        ...(method !== 'cash' && reference.trim() ? { reference: reference.trim().toUpperCase() } : {}),
        receivedOn,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(manual ? { allocations: manualRows.filter(r => r.amountTzs > 0).map(r => ({ saleId: r.sale.id, amountTzs: r.amountTzs })) } : {}),
      });
      toast.success(fmt(t('vendor.pay.saved'), { number: res.payment.number }));
      onSaved(res.payment, res.customer?.owedTzs ?? Math.max(0, owed - value));
    } catch (err) {
      // No answer: nothing may have been recorded; Try again re-sends the same reference (never two payments).
      if (!isRefusal(err)) { setAlert({ tone: 'error', text: t('vendor.pay.failed') }); return; }
      const code = errorCode(err);
      const body = errorBody<{ owedTzs?: number }>(err);
      if (code === 'overpayment') {
        if (typeof body?.owedTzs === 'number') setOwedOverride(body.owedTzs);
        onStale();
      } else if (code === 'allocation_stale' || code === 'invalid_allocation' || code === 'allocation_mismatch') {
        setAlloc({});
        setErrors({ alloc: t('vendor.pay.allocStale') });
        onStale();
      } else if (code === 'reference_required') {
        setErrors({ reference: t('vendor.pos.referenceRequired') });
      } else if (code === 'received_on_invalid') {
        setErrors({ date: t('vendor.pay.dateInvalid') });
      } else if (code === 'invalid_payment' || code === 'note_too_long') {
        setAlert({ tone: 'error', text: t('vendor.pay.invalid') });
      } else if (code === 'customer_archived') {
        setAlert({ tone: 'warning', text: t('vendor.pay.archived') });
      } else if (code === 'client_ref_reused') {
        // Same reference, other details: a payment may already be saved. Check before trying again.
        clientRef.current = newClientRef();
        setAlert({ tone: 'warning', text: t('vendor.pay.refReused') });
        onStale();
      } else if (code === 'vendor_permission_forbidden') {
        toast.error(t('vendor.customers.noAccess'));
        void vendor.refresh();
        onClose();
      } else {
        const limited = rateLimitText(err, t);
        if (limited) setAlert({ tone: 'warning', text: limited });
        else if (code === 'customer_not_found') setAlert({ tone: 'error', text: t('vendor.customers.notFound') });
        else if (!vendor.handleError(err)) setAlert({ tone: 'error', text: t('vendor.pay.failed') });
        else onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  const name = customerName(customer, t);
  const oldest = open_[0];

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={fmt(t('vendor.pay.title'), { name })} size="lg">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }} noValidate data-testid="pay-form">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.customers.owes')}</span>
          <span className="whitespace-nowrap text-xl font-semibold tabular-nums" data-testid="pay-owed">{money(owed)}</span>
        </div>

        {alert && <div data-testid="pay-alert"><Alert tone={alert.tone}>{alert.text}</Alert></div>}
        {!online && <Alert tone="warning">{t('vendor.pay.offline')}</Alert>}

        <Field label={t('vendor.pay.amount')} required error={over ? fmt(t('vendor.pay.overOwed'), { owed: money(owed) }) : errors.amount}>
          <Input inputMode="numeric" value={amount} autoComplete="off"
            onChange={e => { setAmount(e.target.value.replace(/[^\d]/g, '')); changed(); }} disabled={busy} data-testid="pay-amount" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${chip} ${chipOff}`} onClick={() => { setAmount(String(owed)); changed(); }} disabled={busy || owed <= 0} data-testid="pay-all-owed">
            <span className="whitespace-nowrap">{fmt(t('vendor.pay.allOwed'), { amount: money(owed) })}</span>
          </button>
          {open_.length > 1 && oldest && (
            <button type="button" className={`${chip} ${chipOff}`} onClick={() => { setAmount(String(oldest.balanceTzs)); changed(); }} disabled={busy} data-testid="pay-oldest">
              <span className="whitespace-nowrap">{fmt(t('vendor.pay.oldest'), { amount: money(oldest.balanceTzs) })}</span>
            </button>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.pay.method')}</legend>
          <div className="flex flex-wrap gap-2" data-testid="pay-methods">
            {PAYMENT_METHODS.map(m => (
              <button key={m} type="button" aria-pressed={method === m} className={`${chip} ${method === m ? chipOn : chipOff}`}
                onClick={() => { setMethod(m); setErrors(e => ({ ...e, reference: undefined })); changed(); }} disabled={busy} data-testid={`pay-method-${m}`}>
                {saleMethodLabel(m, t)}
              </button>
            ))}
          </div>
        </fieldset>

        {method !== 'cash' && (
          <Field label={t(needsRef ? 'vendor.pos.reference' : 'vendor.pos.referenceOptional')} required={needsRef}
            error={errors.reference ?? (refMissing && reference !== '' ? t('vendor.pos.referenceRequired') : undefined)} hint={t('vendor.pos.referenceHint')}>
            <Input value={reference} maxLength={MAX_REFERENCE} autoComplete="off" className="uppercase"
              onChange={e => { setReference(e.target.value.toUpperCase()); changed(); }} disabled={busy} data-testid="pay-reference" />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('vendor.pay.date')} required error={errors.date}>
            <Input type="date" value={receivedOn} min={earliest} max={today}
              onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { setReceivedOn(e.target.value); changed(); } }} disabled={busy} data-testid="pay-date" />
          </Field>
          <Field label={t('vendor.customers.note')}>
            <Textarea value={note} maxLength={MAX_NOTE} rows={1} onChange={e => { setNote(e.target.value); changed(); }} disabled={busy} data-testid="pay-note" />
          </Field>
        </div>

        <section className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-4" aria-labelledby="pay-applies-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="pay-applies-heading" className="text-sm font-semibold">{t('vendor.pay.appliesTo')}</h3>
            {open_.length > 0 && (
              <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy}
                onClick={() => {
                  // Start the manual split from the oldest-first preview, so it already adds up.
                  if (!manual) setAlloc(Object.fromEntries(preview.map(p => [p.sale.id, String(p.amountTzs)])));
                  setManual(m => !m); setErrors(e => ({ ...e, alloc: undefined })); changed();
                }}
                data-testid="pay-choose-sales">
                {t(manual ? 'vendor.pay.oldestFirst' : 'vendor.pay.chooseSales')}
              </Button>
            )}
          </div>
          {errors.alloc && <Alert tone="warning">{errors.alloc}</Alert>}
          {manual ? (
            <div className="space-y-3" data-testid="pay-manual">
              {open_.map(s => (
                <Field key={s.id} label={`${s.number} · ${fmt(t('vendor.customers.dueOn'), { date: receiptDay(s.dueDate, locale) })} · ${money(s.balanceTzs)}`}
                  error={manualRows.find(r => r.sale.id === s.id)!.amountTzs > s.balanceTzs ? fmt(t('vendor.pay.allocTooMuch'), { amount: money(s.balanceTzs) }) : undefined}>
                  <Input inputMode="numeric" value={alloc[s.id] ?? ''} autoComplete="off"
                    onChange={e => { setAlloc(a => ({ ...a, [s.id]: e.target.value.replace(/[^\d]/g, '') })); changed(); }} disabled={busy} data-testid={`pay-alloc-${s.id}`} />
                </Field>
              ))}
              {mismatch && value > 0 && (
                <p role="alert" className="text-sm text-[var(--color-error-700)]" data-testid="pay-alloc-mismatch">{fmt(t('vendor.pay.allocMismatch'), { amount: money(value) })}</p>
              )}
            </div>
          ) : (
            <ul className="space-y-1 text-sm" aria-live="polite" data-testid="pay-preview">
              {preview.map(({ sale, amountTzs }) => (
                <li key={sale.id} className="[overflow-wrap:anywhere]">
                  {amountTzs >= sale.balanceTzs
                    ? fmt(t('vendor.pay.paysOff'), { number: sale.number, amount: money(sale.balanceTzs) })
                    : fmt(t('vendor.pay.paysPart'), { amount: money(amountTzs), number: sale.number, left: money(sale.balanceTzs - amountTzs) })}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div data-testid="pay-notice"><Alert tone="info">{t('vendor.pay.notice')}</Alert></div>

        <DialogFooter className="flex-wrap">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} disabled={!canSave} className="min-h-11" data-testid="pay-save">
            <span className="whitespace-nowrap">{alert?.tone === 'error' ? t('common.tryAgain') : fmt(t('vendor.pay.save'), { amount: money(value) })}</span>
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
