'use client';
// Purchase detail dialogs (S9 §4.5, §5.3): record payment, change instalments, void purchase, void payment.
// Online only, never queued. FitFlex moves no money: these record what the vendor says they paid.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type VendorProduct } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { addDays, dayMonth, errorBody, errorCode, fmt, isRefusal, newClientRef, receiptDay, REFERENCE_REQUIRED } from '@/lib/vendor';
import {
  coverPreview, DUE_MAX_DAYS, MAX_NOTE, purchaseErrorKey, purchasesApi, REASON, voidRefusalKey, type Purchase, type PurchasePayment,
} from '@/lib/vendor-purchases';
import { Alert, Button, Field, Input, Textarea, useToast } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { AdjustStockDialog } from '@/components/vendor/adjust-stock-dialog';
import { useApp } from '../../../../app/providers';
import { rateLimitText, useOnline } from '../customers/bits';
import { InstalmentEditor, MethodPicker, MoneyNotice, planRowsValid, planSum, rowAmount, todayEat, type PlanRow } from './bits';

const digits = (v: string) => v.replace(/[^\d]/g, '');
const amountOf = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : 0);

// ── Record payment ──────────────────────────────────────────────────────────
export function RecordPaymentDialog({ open, purchase, onClose, onSaved, onReload }: {
  open: boolean; purchase: Purchase; onClose: () => void;
  onSaved: (p: Purchase, amount: number) => void; onReload: () => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const online = useOnline();
  const today = todayEat();
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reference?: string; date?: string }>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [balance, setBalance] = useState(purchase.balanceTzs);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef(newClientRef());

  useEffect(() => {
    if (!open) return;
    const next = purchase.instalments.find(i => i.openTzs > 0);
    setAmount(next ? String(next.openTzs) : ''); setPaidOn(todayEat()); setMethod('cash'); setReference(''); setNote('');
    setErrors({}); setAlert(null); setBalance(purchase.balanceTzs); setBusy(false);
    clientRef.current = newClientRef();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const changed = () => { clientRef.current = newClientRef(); setAlert(null); };

  const value = amountOf(amount);
  const over = value > balance;
  const refMissing = REFERENCE_REQUIRED.has(method) && !reference.trim();
  const preview = useMemo(() => (over ? [] : coverPreview(purchase.instalments, value)), [purchase.instalments, value, over]);
  const coverText = preview.map(c => (c.full
    ? fmt(t('vendor.purchases.payCoversFull'), { n: c.seq, date: dayMonth(c.dueDate, locale) })
    : fmt(t('vendor.purchases.payCoversPart'), { amount: money(c.amountTzs), n: c.seq }))).join(t('vendor.purchases.and'));
  const canSave = online && value > 0 && !over && !refMissing && !busy && paidOn >= purchase.receivedOn && paidOn <= today;
  const supplier = purchase.supplier?.name ?? t('vendor.purchases.noSupplier');

  async function save() {
    if (!token || !canSave) return;
    setBusy(true); setAlert(null); setErrors({});
    try {
      const res = await purchasesApi.recordPayment(token, purchase.id, {
        clientRef: clientRef.current, amountTzs: value, paidOn, method,
        ...(method !== 'cash' && reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onSaved(res.purchase, value);
    } catch (err) {
      if (!isRefusal(err)) { setAlert(t('vendor.purchases.err.server')); return; }
      const code = errorCode(err);
      const b = errorBody<{ balanceTzs?: number; earliest?: string; latest?: string }>(err);
      if (code === 'overpayment') {
        if (typeof b?.balanceTzs === 'number') setBalance(b.balanceTzs);
        setErrors({ amount: fmt(t('vendor.purchases.err.overpayment'), { amount: money(b?.balanceTzs ?? balance) }) });
        clientRef.current = newClientRef(); onReload();
      } else if (code === 'reference_required') setErrors({ reference: t('vendor.pos.referenceRequired') });
      else if (code === 'paid_on_out_of_range') setErrors({ date: fmt(t('vendor.purchases.err.dateRange'), { earliest: receiptDay(b?.earliest, locale), latest: receiptDay(b?.latest, locale) }) });
      else if (code === 'nothing_owed' || code === 'purchase_voided') { setAlert(t(purchaseErrorKey(code, 'payment'))); onReload(); }
      else if (code === 'client_ref_reused') { clientRef.current = newClientRef(); setAlert(t('vendor.purchases.err.refReused')); onReload(); }
      else {
        const limited = rateLimitText(err, t);
        if (limited) setAlert(limited);
        else if (vendor.handleError(err)) onClose();
        else setAlert(t(purchaseErrorKey(code, 'payment')));
      }
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={fmt(t('vendor.purchases.payTitle'), { supplier })} size="lg" sheetOnMobile testId="purchase-pay-dialog">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }} noValidate data-testid="purchase-pay-form">
        <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="pay-left">{fmt(t('vendor.purchases.leftToPay'), { amount: money(balance) })}</p>
        {alert && <div data-testid="purchase-pay-alert"><Alert tone="error">{alert}</Alert></div>}
        {!online && <Alert tone="warning">{t('vendor.purchases.offlineAction')}</Alert>}
        <Field label={t('vendor.purchases.payAmount')} required
          error={over ? <span role="alert" data-testid="pay-over">{fmt(t('vendor.purchases.err.overpayment'), { amount: money(balance) })}</span> : errors.amount}>
          <Input inputMode="numeric" value={amount} autoComplete="off" disabled={busy} onChange={e => { setAmount(digits(e.target.value)); changed(); }} data-testid="purchase-pay-amount" />
        </Field>
        <Button type="button" variant="secondary" size="sm" className="min-h-11" disabled={busy || balance <= 0} onClick={() => { setAmount(String(balance)); changed(); }} data-testid="purchase-pay-all">
          <span className="whitespace-nowrap">{fmt(t('vendor.purchases.payAll'), { amount: money(balance) })}</span>
        </Button>
        <Field label={t('vendor.purchases.paidOn')} required error={errors.date}>
          <Input type="date" value={paidOn} min={purchase.receivedOn} max={today} disabled={busy}
            onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { setPaidOn(e.target.value); changed(); } }} data-testid="purchase-pay-date" />
        </Field>
        <MethodPicker method={method} reference={reference} disabled={busy} testPrefix="purchase-pay"
          onMethod={m => { setMethod(m); setErrors(e => ({ ...e, reference: undefined })); changed(); }}
          onReference={r => { setReference(r); changed(); }}
          referenceError={errors.reference ?? (refMissing && reference !== '' ? t('vendor.pos.referenceRequired') : null)} />
        <Field label={t('vendor.purchases.note')}>
          <Textarea value={note} rows={2} maxLength={MAX_NOTE} disabled={busy} onChange={e => { setNote(e.target.value); changed(); }} data-testid="purchase-pay-note" />
        </Field>
        <p aria-live="polite" className="text-sm text-[var(--color-fg-secondary)] [overflow-wrap:anywhere]" data-testid="purchase-pay-covers">
          {preview.length ? fmt(t('vendor.purchases.payCovers'), { list: coverText }) : ''}
        </p>
        <MoneyNotice />
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} disabled={!canSave} className="min-h-11" data-testid="purchase-pay-save">
            <span className="whitespace-nowrap">{alert ? t('common.tryAgain') : fmt(t('vendor.purchases.savePayment'), { amount: money(value) })}</span>
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ── Change instalments (P-11) ──────────────────────────────────────────────
export function ChangePlanDialog({ open, purchase, onClose, onSaved, onReload }: {
  open: boolean; purchase: Purchase; onClose: () => void; onSaved: (p: Purchase) => void; onReload: () => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const online = useOnline();
  const today = todayEat();
  const maxDate = addDays(purchase.receivedOn, DUE_MAX_DAYS);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [alert, setAlert] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const balance = purchase.balanceTzs;

  useEffect(() => {
    if (!open) return;
    // Start from what is still open, each on its own date (a past date moves to today: the server needs today or later).
    const open_ = purchase.instalments.filter(i => i.openTzs > 0).map(i => ({ dueDate: i.dueDate < today ? today : i.dueDate, amount: String(i.openTzs) }));
    setRows(open_.length ? open_ : [{ dueDate: addDays(today, 30), amount: String(balance) }]);
    setAlert(null); setTried(false); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const kept = purchase.instalments.filter(i => i.coveredTzs > 0);
  const valid = planRowsValid(rows, today, maxDate) && planSum(rows) === balance;

  async function save() {
    setTried(true);
    if (!token || !valid || !online) return;
    setBusy(true); setAlert(null);
    try {
      const res = await purchasesApi.changePlan(token, purchase.id, rows.map(r => ({ dueDate: r.dueDate, amountTzs: rowAmount(r) })));
      onSaved(res.purchase);
    } catch (err) {
      if (!isRefusal(err)) { setAlert(t('vendor.purchases.err.server')); return; }
      const code = errorCode(err);
      const b = errorBody<{ expectedTzs?: number; earliest?: string; latest?: string }>(err);
      if (code === 'schedule_mismatch') { setAlert(fmt(t('vendor.purchases.sumWrong'), { left: money(b?.expectedTzs ?? balance) })); onReload(); }
      else if (code === 'due_date_out_of_range') setAlert(fmt(t('vendor.purchases.err.dateRange'), { earliest: receiptDay(b?.earliest, locale), latest: receiptDay(b?.latest, locale) }));
      else if (code === 'nothing_owed' || code === 'purchase_voided') { setAlert(t(purchaseErrorKey(code, 'plan'))); onReload(); }
      else {
        const limited = rateLimitText(err, t);
        if (limited) setAlert(limited);
        else if (vendor.handleError(err)) onClose();
        else setAlert(t(purchaseErrorKey(code, 'plan')));
      }
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('vendor.purchases.changePlan')} size="lg" sheetOnMobile testId="purchase-plan-dialog">
      <div className="space-y-4">
        <p className="text-sm">{fmt(t('vendor.purchases.paidSoFar'), { amount: money(purchase.paidTzs) })} · {fmt(t('vendor.purchases.mustAddUp'), { balance: money(balance) })}</p>
        {kept.length > 0 && (
          <section aria-labelledby="plan-kept" className="space-y-1">
            <h3 id="plan-kept" className="text-sm font-semibold">{t('vendor.purchases.keptRows')}</h3>
            <ul className="space-y-1 text-sm text-[var(--color-fg-tertiary)]" data-testid="plan-kept">
              {kept.map(i => <li key={i.id}>{fmt(t('vendor.purchases.instalmentN'), { n: i.seq })} · {receiptDay(i.dueDate, locale)} · {money(i.coveredTzs)}</li>)}
            </ul>
          </section>
        )}
        {alert && <div data-testid="purchase-plan-alert"><Alert tone="error">{alert}</Alert></div>}
        {!online && <Alert tone="warning">{t('vendor.purchases.offlineAction')}</Alert>}
        <InstalmentEditor left={balance} rows={rows} onRows={r => { setRows(r); setAlert(null); }} minDate={today} maxDate={maxDate}
          disabled={busy} showError={tried} testPrefix="change" defaultFirst={addDays(today, 30)} />
      </div>
      <DialogFooter className="flex-wrap">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
        <Button type="button" onClick={save} loading={busy} disabled={!online} className="min-h-11" data-testid="purchase-plan-save">{t('vendor.purchases.savePlan')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

// ── Void purchase (P-8) ────────────────────────────────────────────────────
type Short = { productId: string; variant: string | null; name: string; receivedQty: number; available: number };
export function VoidPurchaseDialog({ open, purchase, onClose, onVoided, onReload }: {
  open: boolean; purchase: Purchase; onClose: () => void;
  onVoided: (res: { purchase: Purchase }) => void; onReload: () => void;
}) {
  const { token, t } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const online = useOnline();
  const [reason, setReason] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [short, setShort] = useState<Short[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjust, setAdjust] = useState<{ product: VendorProduct; variant: string | null } | null>(null);

  useEffect(() => { if (open) { setReason(''); setAlert(null); setShort(null); setBusy(false); } }, [open]);
  const recorded = purchase.payments.filter(p => p.status === 'recorded');
  const paidSum = recorded.reduce((n, p) => n + p.amountTzs, 0);
  const costChanged = purchase.lines.some(l => l.costUpdated);
  const ok = reason.trim().length >= REASON.min && reason.trim().length <= REASON.max;
  const canCount = vendor.can('products');

  async function confirm() {
    if (!token || !ok || !online) return;
    setBusy(true); setAlert(null); setShort(null);
    try {
      const res = await purchasesApi.voidPurchase(token, purchase.id, reason.trim());
      onVoided(res);
    } catch (err) {
      if (!isRefusal(err)) { setAlert(t('vendor.purchases.err.server')); return; }
      const code = errorCode(err);
      const b = errorBody<{ lines?: Short[]; reason?: string }>(err);
      if (code === 'insufficient_stock') setShort(b?.lines ?? []);
      else if (code === 'void_not_allowed') setAlert(t(voidRefusalKey(b?.reason)));
      else if (code === 'already_voided') { toast.info(t('vendor.purchases.err.alreadyVoided')); onReload(); onClose(); }
      else if (code === 'reason_required' || code === 'reason_too_long') setAlert(t('vendor.purchases.voidReasonShort'));
      else {
        const limited = rateLimitText(err, t);
        if (limited) setAlert(limited);
        else if (vendor.handleError(err)) onClose();
        else setAlert(t(purchaseErrorKey(code, 'void')));
      }
    } finally { setBusy(false); }
  }

  async function openCount(line: Short) {
    if (!token) return;
    try {
      const products = await api.vendorProducts(token);
      const product = products.find(p => p.id === line.productId);
      if (product) setAdjust({ product, variant: line.variant });
    } catch (err) { if (!vendor.handleError(err)) toast.error(t('vendor.purchases.err.server')); }
  }

  const shortText = (s: Short) => fmt(t('vendor.purchases.err.voidStockLine'), { name: s.variant ? `${s.name} (${s.variant})` : s.name, received: s.receivedQty, available: s.available });

  return (
    <>
      <Dialog open={open && !adjust} onClose={() => { if (!busy) onClose(); }} title={fmt(t('vendor.purchases.voidTitle'), { number: purchase.number })} sheetOnMobile testId="purchase-void-dialog">
        <div className="space-y-3 text-sm">
          <p>{fmt(t('vendor.purchases.voidBody'), { number: purchase.number })}</p>
          {recorded.length > 0 && <p data-testid="void-payments-note">{fmt(t('vendor.purchases.voidPayments'), { n: recorded.length, amount: money(paidSum) })}</p>}
          {costChanged && <p data-testid="void-cost-note">{t('vendor.purchases.voidCost')}</p>}
          {short && (
            <div role="alert" className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-error-200)] bg-[var(--color-error-50)] p-3 text-[var(--color-error-800)]" data-testid="void-insufficient">
              <p>{fmt(t('vendor.purchases.err.voidStock'), { list: short.map(shortText).join('; ') })}</p>
              <ul className="space-y-1">
                {short.map(s => (
                  <li key={`${s.productId}:${s.variant ?? ''}`} className="flex flex-wrap items-center gap-2">
                    <span>{shortText(s)}</span>
                    {canCount && (
                      <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => openCount(s)} data-testid={`void-count-${s.productId}`}>
                        {fmt(t('vendor.purchases.countStock'), { name: s.name })}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {alert && <div data-testid="purchase-void-alert"><Alert tone="error">{alert}</Alert></div>}
          {!online && <Alert tone="warning">{t('vendor.purchases.offlineAction')}</Alert>}
          <Field label={t('vendor.purchases.voidReason')} required>
            <Textarea value={reason} rows={3} maxLength={REASON.max} disabled={busy} onChange={e => setReason(e.target.value)} data-testid="purchase-void-reason" />
          </Field>
        </div>
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
          <Button type="button" variant="destructive" onClick={confirm} loading={busy} disabled={!ok || !online} className="min-h-11" data-testid="purchase-void-confirm">{t('vendor.purchases.void')}</Button>
        </DialogFooter>
      </Dialog>
      {adjust && (
        <AdjustStockDialog open product={adjust.product} initialVariant={adjust.variant} initialReason="count"
          onClose={() => setAdjust(null)} onSaved={() => setAdjust(null)} onGone={() => setAdjust(null)} />
      )}
    </>
  );
}

// ── Void payment (P-10) ────────────────────────────────────────────────────
export function VoidPaymentDialog({ payment, purchase, onClose, onVoided, onReload }: {
  payment: PurchasePayment | null; purchase: Purchase; onClose: () => void; onVoided: (p: Purchase) => void; onReload: () => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const online = useOnline();
  const [reason, setReason] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); setAlert(null); setBusy(false); }, [payment?.id]);
  if (!payment) return null;
  const ok = reason.trim().length >= REASON.min && reason.trim().length <= REASON.max;

  async function confirm() {
    if (!token || !payment || !ok || !online) return;
    setBusy(true); setAlert(null);
    try {
      const res = await purchasesApi.voidPayment(token, purchase.id, payment.id, reason.trim());
      onVoided(res.purchase);
    } catch (err) {
      if (!isRefusal(err)) { setAlert(t('vendor.purchases.err.server')); return; }
      const code = errorCode(err);
      const b = errorBody<{ reason?: string }>(err);
      if (code === 'void_not_allowed') setAlert(t(voidRefusalKey(b?.reason)));
      else if (code === 'supplier_required') setAlert(t('vendor.purchases.err.noSupplierDebt'));
      else if (code === 'supplier_archived') setAlert(fmt(t('vendor.purchases.err.supplierArchived'), { name: purchase.supplier?.name ?? '' }));
      else if (code === 'already_voided' || code === 'purchase_voided') { setAlert(t(purchaseErrorKey(code, 'paymentVoid'))); onReload(); }
      else if (code === 'reason_required' || code === 'reason_too_long') setAlert(t('vendor.purchases.voidReasonShort'));
      else {
        const limited = rateLimitText(err, t);
        if (limited) setAlert(limited);
        else if (vendor.handleError(err)) onClose();
        else setAlert(t(purchaseErrorKey(code, 'paymentVoid')));
      }
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={fmt(t('vendor.purchases.voidPaymentTitle'), { amount: money(payment.amountTzs), date: receiptDay(payment.paidOn, locale) })} sheetOnMobile testId="payment-void-dialog">
      <div className="space-y-3 text-sm">
        <p>{t('vendor.purchases.voidPaymentBody')}</p>
        {alert && <div data-testid="payment-void-alert"><Alert tone="error">{alert}</Alert></div>}
        {!online && <Alert tone="warning">{t('vendor.purchases.offlineAction')}</Alert>}
        <Field label={t('vendor.purchases.voidReason')} required>
          <Textarea value={reason} rows={3} maxLength={REASON.max} disabled={busy} onChange={e => setReason(e.target.value)} data-testid="payment-void-reason" />
        </Field>
      </div>
      <DialogFooter className="flex-wrap">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
        <Button type="button" variant="destructive" onClick={confirm} loading={busy} disabled={!ok || !online} className="min-h-11" data-testid="payment-void-confirm">{t('vendor.purchases.voidPayment')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
