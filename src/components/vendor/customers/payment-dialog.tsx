'use client';
// One customer payment (S4 §7.2, §6.4): the receipt, Copy text (never for a voided payment) and Void.
import { useCallback, useEffect, useState } from 'react';
import { api, type VendorCustomerPayment } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { t as translate, type Locale } from '@/lib/i18n';
import { eatDateTime, errorBody, errorCode, fmt, isRefusal, mayVoidPayment, paymentReceiptText, receiptDay, saleMethodLabel } from '@/lib/vendor';
import { Alert, Badge, Button, ErrorState, Field, Segmented, SkeletonCard, Textarea } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useToast } from '@/components/ui/toast';
import { useApp } from '../../../../app/providers';
import { rateLimitText } from './bits';

const REASON_MIN = 3;
const REASON_MAX = 200;

export function PaymentDialog({
  customerId, paymentId, customerLabel, stillOwedTzs, onClose, onVoided,
}: {
  customerId: string;
  /** null = closed. */
  paymentId: string | null;
  customerLabel: string;
  /** The customer's balance now (for "Still owed"). */
  stillOwedTzs: number | null;
  onClose: () => void;
  onVoided: () => void;
}) {
  const { token, t, locale, user } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [payment, setPayment] = useState<VendorCustomerPayment | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  const [lang, setLang] = useState<Locale>(locale);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !paymentId) return;
    setState('loading');
    try {
      const res = await api.vendorCustomerPayment(token, customerId, paymentId);
      setPayment(res.payment); setState('ready');
    } catch (err) {
      if (errorCode(err) === 'payment_not_found' || errorCode(err) === 'customer_not_found') { setState('notFound'); return; }
      if (vendor.handleError(err)) { onClose(); return; }
      setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, customerId, paymentId]);
  useEffect(() => { setNotice(null); setLang(locale); void load(); }, [load, locale]);

  if (!paymentId) return null;
  const business = vendor.me?.businessName || t('vendor.shell.unnamed');
  const p = payment;
  const canVoid = !!p && mayVoidPayment(p, { userId: user?.id, userType: user?.userType, vendorRole: vendor.me?.vendorRole });

  async function copy() {
    if (!p) return;
    const tl = (k: Parameters<typeof t>[0]) => translate(lang, k);
    const text = paymentReceiptText(p, { business, customer: customerLabel, stillOwedTzs, locale: lang, t: tl, money });
    try { await navigator.clipboard.writeText(text); toast.success(t('vendor.sales.copied')); } catch { toast.error(t('vendor.saveFailed')); }
  }

  async function confirmVoid() {
    if (!token || !p) return;
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) { setReasonError(t('vendor.pay.voidReasonMissing')); return; }
    setBusy(true); setVoidError(null);
    try {
      const res = await api.vendorVoidCustomerPayment(token, customerId, p.id, trimmed);
      setPayment(res.payment); setVoidOpen(false);
      toast.success(fmt(t('vendor.pay.voided'), { number: res.payment.number }));
      onVoided();
    } catch (err) {
      if (!isRefusal(err)) { setVoidError(t('vendor.pay.voidOffline')); return; }
      const code = errorCode(err);
      if (code === 'reason_required' || code === 'reason_too_long') { setReasonError(t('vendor.pay.voidReasonMissing')); return; }
      const limited = rateLimitText(err, t);
      if (limited) { setVoidError(limited); return; }
      setVoidOpen(false);
      if (code === 'already_voided') {
        setNotice(t('vendor.pay.alreadyVoided'));
        toast.info(t('vendor.pay.alreadyVoided'));
        void load(); onVoided();
      } else if (code === 'void_not_allowed') {
        const why = errorBody<{ reason?: string }>(err)?.reason;
        toast.error(t(why === 'too_old' ? 'vendor.pay.voidTooOld' : why === 'not_own' ? 'vendor.pay.voidNotOwn' : 'vendor.pay.voidNotAllowed'));
      } else if (code === 'customer_archived') {
        toast.error(t('vendor.pay.voidArchived'));
      } else if (code === 'payment_not_found') {
        setState('notFound');
      } else if (code === 'vendor_permission_forbidden') {
        toast.error(t('vendor.customers.noAccess')); void vendor.refresh();
      } else if (!vendor.handleError(err)) {
        toast.error(t('vendor.saveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  const row = 'flex justify-between gap-3';
  return (
    <>
      <Dialog open={!voidOpen} onClose={onClose} title={p ? fmt(t('vendor.pay.receiptTitle'), { number: p.number }) : t('vendor.customers.payments')}>
        <div className="space-y-4" data-testid="payment-detail">
          {state === 'loading' && <div aria-busy="true"><SkeletonCard /></div>}
          {state === 'notFound' && <ErrorState title={t('vendor.pay.notFound')} />}
          {state === 'error' && <ErrorState title={t('vendor.pay.loadFailed')} onRetry={load} retryLabel={t('common.tryAgain')} />}
          {state === 'ready' && p && (
            <>
              {notice && <Alert tone="warning">{notice}</Alert>}
              {p.status === 'voided' && (
                <div data-testid="payment-voided">
                  <Badge tone="gray">{t('vendor.sales.voidedBadge')}</Badge>
                  <Alert tone="info" className="mt-2">
                    {fmt(t('vendor.pay.voidedBy'), { name: p.voidedBy?.name || '—', time: eatDateTime(p.voidedAt, locale), reason: p.voidReason || '—' })}
                  </Alert>
                </div>
              )}
              <dl className="space-y-1 text-sm">
                <div className={row}><dt>{t('vendor.pay.date')}</dt><dd>{receiptDay(p.receivedOn, locale)}</dd></div>
                <div className={row}><dt>{t('vendor.customers.customer')}</dt><dd className="text-right [overflow-wrap:anywhere]">{customerLabel}</dd></div>
                <div className={row}>
                  <dt className="[overflow-wrap:anywhere]">{saleMethodLabel(p.method, t)}{p.reference ? ` (${p.reference})` : ''}</dt>
                  <dd className={`whitespace-nowrap font-semibold tabular-nums ${p.status === 'voided' ? 'line-through' : ''}`} data-testid="payment-amount">{money(p.amountTzs)}</dd>
                </div>
              </dl>
              {p.allocations.length > 0 && (
                <div className="space-y-1 text-sm" data-testid="payment-allocations">
                  <p className="font-semibold">{t('vendor.pay.paidTowards')}</p>
                  {p.allocations.map(a => (
                    <div key={a.saleId} className={row}><span className="font-mono">{a.saleNumber}</span><span className="whitespace-nowrap tabular-nums">{money(a.amountTzs)}</span></div>
                  ))}
                </div>
              )}
              {p.status === 'recorded' && stillOwedTzs != null && (
                <div className={`${row} border-t border-[var(--color-border-secondary)] pt-2 text-sm font-semibold`}>
                  <span>{t('vendor.pay.stillOwed')}</span><span className="whitespace-nowrap tabular-nums" data-testid="payment-still-owed">{money(stillOwedTzs)}</span>
                </div>
              )}
              {p.recordedBy?.name && <p className="text-sm text-[var(--color-fg-tertiary)]">{fmt(t('vendor.pay.recordedBy'), { name: p.recordedBy.name })}</p>}
              {p.note && <p className="whitespace-pre-line text-sm text-[var(--color-fg-tertiary)] [overflow-wrap:anywhere]">{p.note}</p>}
              <p className="text-xs text-[var(--color-fg-quaternary)]">{t('vendor.pos.notFiscal')}</p>
              <Alert tone="info">{t('vendor.pay.notice')}</Alert>
              {p.status === 'recorded' && (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <p className="mb-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.pos.receiptLanguage')}</p>
                    <Segmented value={lang} onChange={v => setLang(v as Locale)} options={[['en', 'English'], ['sw', 'Kiswahili']]} />
                  </div>
                  <Button variant="secondary" className="min-h-11" onClick={copy} data-testid="payment-copy">{t('vendor.sales.copyText')}</Button>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter className="flex-wrap">
          {canVoid && (
            <Button variant="destructive" className="min-h-11" onClick={() => { setReason(''); setReasonError(null); setVoidError(null); setVoidOpen(true); }} data-testid="payment-void">
              {t('vendor.pay.void')}
            </Button>
          )}
          <Button variant="secondary" className="min-h-11" onClick={onClose} data-testid="payment-done">{t('vendor.pay.done')}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={voidOpen && !!p}
        onClose={() => { if (!busy) setVoidOpen(false); }}
        title={p ? fmt(t('vendor.pay.voidTitle'), { number: p.number }) : ''}
        description={t('vendor.pay.voidBody')}
      >
        <div className="space-y-3">
          {voidError && <Alert tone="error">{voidError}</Alert>}
          <Field label={t('vendor.sales.voidReason')} required error={reasonError ?? undefined} hint={`${reason.length}/${REASON_MAX}`}>
            <Textarea value={reason} maxLength={REASON_MAX} rows={3} onChange={e => { setReason(e.target.value); setReasonError(null); }} disabled={busy} data-testid="payment-void-reason" />
          </Field>
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="secondary" onClick={() => setVoidOpen(false)} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={confirmVoid} loading={busy} disabled={!reason.trim()} className="min-h-11" data-testid="payment-void-confirm">
            {voidError ? t('common.tryAgain') : t('vendor.pay.void')}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
