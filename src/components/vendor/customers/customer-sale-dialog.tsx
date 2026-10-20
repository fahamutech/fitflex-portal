'use client';
// One shop sale of this customer, read-only (GET /vendor/customers/:id/sales/:saleId), for staff who hold
// `customers` but not `sales`. No void and no copy receipt here: those stay on the Sales page (needs `sales`).
import { useCallback, useEffect, useState } from 'react';
import { api, type VendorSale } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { eatDateTime, errorCode, fmt, receiptDay, saleMethodLabel } from '@/lib/vendor';
import { Alert, Badge, Button, ErrorState, SkeletonCard } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import { CreditBadges } from './bits';

export function CustomerSaleDialog({ customerId, saleId, onClose }: { customerId: string; saleId: string | null; onClose: () => void }) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [sale, setSale] = useState<VendorSale | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading');

  const load = useCallback(async () => {
    if (!token || !saleId) return;
    setState('loading'); setSale(null);
    try {
      const res = await api.vendorCustomerSale(token, customerId, saleId);
      setSale(res.sale); setState('ready');
    } catch (err) {
      const code = errorCode(err);
      if (code === 'sale_not_found' || code === 'customer_not_found') { setState('notFound'); return; }
      if (vendor.handleError(err)) { onClose(); return; }
      setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, customerId, saleId]);
  useEffect(() => { void load(); }, [load]);

  if (!saleId) return null;
  const s = sale;
  const row = 'flex justify-between gap-3';
  const credit = s?.kind === 'credit';
  const paidNow = s ? (s.paidAtSaleTzs ?? s.payments.reduce((n, p) => n + p.amountTzs, 0)) : 0;
  return (
    <Dialog open onClose={onClose} title={s ? fmt(t('vendor.pos.receiptNo'), { number: s.number }) : t('vendor.customers.shopSales')}>
      <div className="space-y-4 text-sm" data-testid="customer-sale-detail">
        {state === 'loading' && <div aria-busy="true"><SkeletonCard /></div>}
        {state === 'notFound' && <ErrorState title={t('vendor.sales.notFound')} />}
        {state === 'error' && <ErrorState title={t('vendor.sales.failed')} onRetry={load} retryLabel={t('common.tryAgain')} />}
        {state === 'ready' && s && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {s.status === 'voided' && <Badge tone="gray">{t('vendor.sales.voidedBadge')}</Badge>}
              <CreditBadges sale={s} />
            </div>
            <p className="text-[var(--color-fg-tertiary)]">{eatDateTime(s.soldAt, locale)}</p>
            {s.status === 'voided' && (
              <Alert tone="info">{fmt(t('vendor.sales.voidedBy'), { name: s.voidedBy?.name || '—', time: eatDateTime(s.voidedAt, locale), reason: s.voidReason || '—' })}</Alert>
            )}
            <ul className="space-y-1">
              {s.lines.map((l, i) => (
                <li key={i} className={row}>
                  <span className="[overflow-wrap:anywhere]">{l.qty} × {l.nameSnapshot}{l.variant ? ` (${l.variant})` : ''}</span>
                  <span className="whitespace-nowrap tabular-nums">{money(l.lineTotalTzs)}</span>
                </li>
              ))}
            </ul>
            <div className={`${row} border-t border-[var(--color-border-secondary)] pt-2 font-semibold`}>
              <span>{t('vendor.pos.total')}</span><span className="whitespace-nowrap tabular-nums" data-testid="customer-sale-total">{money(s.totalTzs)}</span>
            </div>
            {s.payments.map((p, i) => (
              <div key={i} className={row}>
                <span className="[overflow-wrap:anywhere]">{saleMethodLabel(p.method, t)}{p.reference ? ` (${p.reference})` : ''}</span>
                <span className="whitespace-nowrap tabular-nums">{money(p.amountTzs)}</span>
              </div>
            ))}
            {credit && (
              <div className="space-y-1">
                <div className={row}><span>{t('vendor.pos.credit.paidNow')}</span><span className="whitespace-nowrap tabular-nums">{money(paidNow)}</span></div>
                {s.dueDate && <div className={row}><span>{t('vendor.receipt.dueBy')}</span><span className="whitespace-nowrap">{receiptDay(s.dueDate, locale)}</span></div>}
                {s.status === 'completed' && Number(s.balanceTzs) > 0 && (
                  <div className={`${row} font-semibold`}><span>{t('vendor.pay.stillOwed')}</span><span className="whitespace-nowrap tabular-nums" data-testid="customer-sale-balance">{money(s.balanceTzs)}</span></div>
                )}
              </div>
            )}
            <Alert tone="info">{t('vendor.pos.moneyNotice')}</Alert>
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" className="min-h-11" onClick={onClose} data-testid="customer-sale-close">{t('common.close')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
