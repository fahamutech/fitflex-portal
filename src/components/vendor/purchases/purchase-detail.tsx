'use client';
// One purchase (GRN) in the portal (S9 §4.5, §5.3): items, money, instalments, payments; record payment, change
// instalments, copy as text, print, void purchase / payment (M2 visibility; the server decides).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Printer } from 'lucide-react';
import { money } from '@/lib/admin-utils';
import { receiptDateTime, eatDayOf, errorCode, fmt, receiptDay, saleMethodLabel } from '@/lib/vendor';
import { instalmentText, mayVoidPurchase, mayVoidPurchasePayment, purchasesApi, purchaseText, type Purchase, type PurchasePayment } from '@/lib/vendor-purchases';
import { Alert, Badge, Button, Card, CardContent, CardHeader, ErrorState, SkeletonCard, Table, TBody, Td, Th, THead, Tr, useToast } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { useApp } from '../../../../app/providers';
import { useOnline } from '../customers/bits';
import { linkCls, Meta, MoneyNotice, PaymentBadge, StatusBadge } from './bits';
import { ChangePlanDialog, RecordPaymentDialog, VoidPaymentDialog, VoidPurchaseDialog } from './purchase-dialogs';

export function PurchaseDetail({ id, onBack, onOpenSupplier }: {
  id: string; onBack: () => void; onOpenSupplier: (supplierId: string) => void;
}) {
  const { token, t, locale, user } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const online = useOnline();
  const focus = useFocusAfterRender();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'missing'>('loading');
  const [dialog, setDialog] = useState<'pay' | 'plan' | 'void' | null>(null);
  const [voidPay, setVoidPay] = useState<PurchasePayment | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const paymentsRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (quiet = false) => {
    if (!token) return;
    if (!quiet) setState('loading');
    try {
      const res = await purchasesApi.purchase(token, id);
      setPurchase(res.purchase); setState('ready');
    } catch (err) {
      const code = errorCode(err);
      if (code === 'purchase_not_found') { setState('missing'); return; }
      if (vendor.handleError(err)) { setState('failed'); return; }
      if (!quiet) setState('failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);
  useEffect(() => { void load(); }, [load]);
  // Page load (and right after Receive stock) → the GRN heading.
  useEffect(() => { if (state === 'ready') focus(() => headingRef.current); }, [state, focus]);

  if (state === 'loading') return <div aria-busy="true" aria-label={t('vendor.purchases.loadingOne')} className="space-y-4"><SkeletonCard /><SkeletonCard /></div>;
  if (state === 'missing') return (
    <div className="space-y-4">
      <Button variant="ghost" className="min-h-11" onClick={onBack}><ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.purchases.backToList')}</Button>
      <ErrorState title={t('vendor.purchases.notFound')} />
    </div>
  );
  if (state === 'failed' || !purchase) return <ErrorState title={t('vendor.purchases.err.server')} onRetry={() => load()} retryLabel={t('common.tryAgain')} />;

  const p = purchase;
  const canSeeCost = vendor.me?.tools?.canSeeCost === true;
  const who = { userId: user?.id, userType: user?.userType, vendorRole: vendor.me?.vendorRole };
  const voidable = mayVoidPurchase(p, who);
  const received = p.status === 'received';
  const suspended = vendor.me?.accountStatus === 'suspended';
  const recordedDay = eatDayOf(p.recordedAt);
  const business = vendor.me?.businessName || '';
  const text = purchaseText(p, { business, locale, t, money });
  const supplierName = p.supplier?.name ?? t('vendor.purchases.noSupplier');

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success(t('vendor.purchases.copied')); }
    catch { toast.error(t('vendor.purchases.err.server')); }
  };
  const print = () => {
    document.body.classList.add('ff-print-purchase');
    const done = () => { document.body.classList.remove('ff-print-purchase'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };
  const lineCostNote = (l: Purchase['lines'][number]) => {
    if (l.free) return <Badge tone="gray">{t('vendor.purchases.free')}</Badge>;
    if (!l.costUpdated) return null;
    if (l.costRestoredOnVoid === true) return <Badge tone="gray">{t('vendor.purchases.costRestored')}</Badge>;
    if (l.costRestoredOnVoid === false) return <Badge tone="gray">{t('vendor.purchases.costKept')}</Badge>;
    return <Badge tone="info">{canSeeCost && typeof l.previousCostTzs === 'number' ? fmt(t('vendor.purchases.costUpdatedFrom'), { from: money(l.previousCostTzs) }) : t('vendor.purchases.costUpdated')}</Badge>;
  };

  return (
    <div className="space-y-4" data-testid="purchase-detail">
      <div className="print:hidden">
        <Button variant="ghost" className="min-h-11" onClick={onBack} data-testid="purchase-back"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.purchases.backToList')}</Button>
      </div>
      <div className="space-y-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none [overflow-wrap:anywhere]" data-testid="purchase-heading">
          {fmt(t('vendor.purchases.grnTitle'), { number: p.number })}
        </h1>
        <div className="flex flex-wrap gap-2"><StatusBadge status={p.status} /><PaymentBadge state={p.paymentState} overdueTzs={p.overdueTzs} status={p.status} /></div>
      </div>
      {!received && p.voidedAt && (
        <div data-testid="purchase-voided-banner"><Alert tone="info">{fmt(t('vendor.purchases.voidedBy'), { name: p.voidedBy?.name ?? '—', time: receiptDateTime(p.voidedAt, locale), reason: p.voidReason ?? '' })}</Alert></div>
      )}

      <Card>
        <CardContent className="p-5">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Meta label={t('vendor.purchases.supplier')}>
              {p.supplier ? <button type="button" className={linkCls} onClick={() => onOpenSupplier(p.supplier!.id)} data-testid="purchase-supplier-link">{p.supplier.name}</button> : t('vendor.purchases.noSupplier')}
            </Meta>
            <Meta label={t('vendor.purchases.receivedOn')}>
              <span data-testid="purchase-received">{receiptDay(p.receivedOn, locale)}</span>
              {recordedDay && recordedDay !== p.receivedOn && <span className="block text-[var(--color-fg-tertiary)]" data-testid="purchase-recorded">{fmt(t('vendor.purchases.recordedAt'), { time: receiptDateTime(p.recordedAt, locale) })}</span>}
            </Meta>
            {p.supplierInvoiceRef && <Meta label={t('vendor.purchases.invoiceRef')}>{p.supplierInvoiceRef}</Meta>}
            <Meta label={t('vendor.purchases.col.recordedBy')}>{p.createdBy?.name ?? '—'}</Meta>
            {p.note && <Meta label={t('vendor.suppliers.label.note')}>{p.note}</Meta>}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="font-semibold">{t('vendor.purchases.col.items')}</h2></CardHeader>
        <CardContent className="p-0 @container">
          <div className="hidden @2xl:block">
            <Table aria-label={t('vendor.purchases.col.items')} data-testid="purchase-lines">
              <THead><Tr>
                <Th>{t('vendor.purchases.item')}</Th><Th className="!text-right">{t('vendor.purchases.col.qty')}</Th>
                <Th className="!text-right">{t('vendor.purchases.col.unitCost')}</Th><Th className="!text-right">{t('vendor.purchases.lineTotal')}</Th>
              </Tr></THead>
              <TBody>
                {p.lines.map(l => (
                  <Tr key={l.id} data-testid={`purchase-line-${l.productId}`}>
                    <Td><span className="[overflow-wrap:anywhere]">{l.nameSnapshot}{l.variant ? ` (${l.variant})` : ''}</span> <span className="ml-1 inline-flex">{lineCostNote(l)}</span></Td>
                    <Td className="text-right tabular-nums">{l.qty}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{money(l.unitCostTzs)}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{money(l.lineTotalTzs)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="divide-y divide-[var(--color-border-secondary)] @2xl:hidden">
            {p.lines.map(l => (
              <li key={l.id} className="space-y-1 px-5 py-3 text-sm">
                <p className="font-medium [overflow-wrap:anywhere]">{l.qty} × {l.nameSnapshot}{l.variant ? ` (${l.variant})` : ''}</p>
                <p className="flex flex-wrap justify-between gap-2 tabular-nums"><span>@ {money(l.unitCostTzs)}</span><span className="font-semibold">{money(l.lineTotalTzs)}</span></p>
                {lineCostNote(l)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <dl className="grid gap-3 grid-cols-2 sm:grid-cols-4" data-testid="purchase-money">
            <Meta label={t('vendor.purchases.total')}><span className="tabular-nums">{money(p.totalTzs)}</span></Meta>
            <Meta label={t('vendor.purchases.paid')}><span className="tabular-nums">{money(p.paidTzs)}</span></Meta>
            {received && <Meta label={t('vendor.purchases.left')}><span className="font-bold tabular-nums" data-testid="purchase-balance">{money(p.balanceTzs)}</span></Meta>}
            {received && p.overdueTzs > 0 && <Meta label={t('vendor.payables.overdue')}><span className="tabular-nums text-[var(--color-warning-700)]">{fmt(t('vendor.purchases.overdueAmount'), { amount: money(p.overdueTzs) })}</span></Meta>}
          </dl>
        </CardContent>
      </Card>

      {received && p.instalments.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold">{t('vendor.purchases.instalments')}</h2>
            {p.balanceTzs > 0 && !suspended && (
              <Button variant="ghost" size="sm" className="min-h-11 print:hidden" disabled={!online} onClick={() => setDialog('plan')} data-testid="purchase-change-plan">{t('vendor.purchases.changePlan')}</Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="purchase-instalments">
              {p.instalments.map(i => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm" data-testid={`instalment-${i.seq}`}>
                  <span>{fmt(t('vendor.purchases.instalmentN'), { n: i.seq })} · {receiptDay(i.dueDate, locale)} · <span className="tabular-nums">{money(i.amountTzs)}</span></span>
                  <Badge tone={i.state === 'paid' ? 'success' : i.state === 'part_paid' ? 'info' : i.state === 'overdue' ? 'warning' : 'gray'}>
                    <span data-testid={`instalment-${i.seq}-state`}>{instalmentText(i, t, money)}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><h2 ref={paymentsRef} tabIndex={-1} className="font-semibold outline-none" data-testid="purchase-payments-heading">{t('vendor.purchases.payments')}</h2></CardHeader>
        <CardContent className="p-0">
          {p.payments.length === 0 ? <p className="px-5 py-4 text-sm text-[var(--color-fg-tertiary)]">{t('vendor.purchases.noPayments')}</p> : (
            <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="purchase-payments">
              {p.payments.map(pay => {
                const voided = pay.status === 'voided';
                const canVoid = received && !suspended && mayVoidPurchasePayment(pay, who);
                return (
                  <li key={pay.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm" data-testid={`payment-${pay.id}`}>
                    <span className="min-w-0 space-y-0.5">
                      <span className={`block ${voided ? 'line-through text-[var(--color-fg-quaternary)]' : ''}`}>
                        {receiptDay(pay.paidOn, locale)} · {saleMethodLabel(pay.method, t)}{pay.reference ? ` (${pay.reference})` : ''} · <span className="tabular-nums font-semibold">{money(pay.amountTzs)}</span>
                      </span>
                      <span className="flex flex-wrap gap-1 text-[var(--color-fg-tertiary)]">
                        {pay.recordedBy?.name && <span>{fmt(t('vendor.purchases.recordedBy'), { name: pay.recordedBy.name })}</span>}
                        {pay.atReceipt && <Badge tone="gray">{t('vendor.purchases.atDelivery')}</Badge>}
                        {voided && <Badge tone="gray">{t('vendor.purchases.state.voided')}</Badge>}
                      </span>
                      {voided && pay.voidedAt && <span className="block text-[var(--color-fg-tertiary)] [overflow-wrap:anywhere]">{fmt(t('vendor.purchases.voidedBy'), { name: pay.voidedBy?.name ?? '—', time: receiptDateTime(pay.voidedAt, locale), reason: pay.voidReason ?? '' })}</span>}
                    </span>
                    {canVoid && (
                      <Button variant="ghost" size="sm" className="min-h-11 print:hidden" disabled={!online} onClick={() => setVoidPay(pay)}
                        aria-label={fmt(t('vendor.purchases.voidPaymentLabel'), { amount: money(pay.amountTzs), date: receiptDay(pay.paidOn, locale) })} data-testid={`payment-void-${pay.id}`}>
                        {t('vendor.purchases.voidPayment')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <MoneyNotice />

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap gap-2 bg-[var(--color-bg-secondary)] px-1 py-3 print:hidden" data-testid="purchase-actions">
        {received && p.balanceTzs > 0 && (
          <Button className="min-h-11" disabled={!online || suspended} onClick={() => setDialog('pay')} data-testid="purchase-record-payment">{t('vendor.purchases.recordPayment')}</Button>
        )}
        <Button variant="secondary" className="min-h-11" onClick={copy} data-testid="purchase-copy"><Copy aria-hidden="true" className="h-4 w-4" />{t('vendor.purchases.copyText')}</Button>
        <Button variant="secondary" className="min-h-11" onClick={print} data-testid="purchase-print"><Printer aria-hidden="true" className="h-4 w-4" />{t('vendor.purchases.print')}</Button>
        {received && (voidable
          ? <Button variant="destructive" className="min-h-11" disabled={!online || suspended} onClick={() => setDialog('void')}
              aria-label={fmt(t('vendor.purchases.voidLabel'), { number: p.number })} data-testid="purchase-void">{t('vendor.purchases.void')}</Button>
          : <p className="self-center text-sm text-[var(--color-fg-quaternary)]" data-testid="purchase-ask-owner">{t('vendor.purchases.askOwner')}</p>)}
      </div>

      {/* Print (§5.3): only this block prints (globals.css .ff-print-purchase). */}
      <pre className="ff-print-area hidden whitespace-pre-wrap font-mono text-sm" data-testid="purchase-print-area">{text}</pre>

      <RecordPaymentDialog open={dialog === 'pay'} purchase={p} onClose={() => setDialog(null)} onReload={() => load(true)}
        onSaved={(next, amount) => { setPurchase(next); setDialog(null); toast.success(fmt(t('vendor.purchases.paySaved'), { amount: money(amount) })); focus(() => paymentsRef.current); }} />
      <ChangePlanDialog open={dialog === 'plan'} purchase={p} onClose={() => setDialog(null)} onReload={() => load(true)}
        onSaved={next => { setPurchase(next); setDialog(null); toast.success(t('vendor.purchases.planSaved')); }} />
      <VoidPurchaseDialog open={dialog === 'void'} purchase={p} onClose={() => setDialog(null)} onReload={() => load(true)}
        onVoided={res => { setPurchase(res.purchase); setDialog(null); vendor.refreshCounts(); toast.success(fmt(t('vendor.purchases.voided'), { number: res.purchase.number })); focus(() => headingRef.current); }} />
      <VoidPaymentDialog payment={voidPay} purchase={p} onClose={() => setVoidPay(null)} onReload={() => load(true)}
        onVoided={next => { setPurchase(next); setVoidPay(null); toast.success(t('vendor.purchases.paymentVoided')); focus(() => paymentsRef.current); }} />
    </div>
  );
}
