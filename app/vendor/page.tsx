'use client';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { api, type LowStockRow, type VendorOrder, type VendorPayments, type VendorStatementList } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { eatDateTime, fmt, isOpenOrder, payoutWhyKey, statusKey, statusTone } from '@/lib/vendor';
import { Badge, Button, Card, CardContent, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../providers';

type Loaded<T> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; data: T };

/** One independent request per card: a failure stays inside its card. */
function useLoad<T>(enabled: boolean, fetcher: () => Promise<T>) {
  const vendor = useVendor();
  const [value, setValue] = useState<Loaded<T>>({ state: 'loading' });
  const run = useCallback(async () => {
    if (!enabled) return;
    setValue({ state: 'loading' });
    try { setValue({ state: 'ready', data: await fetcher() }); }
    catch (err) { if (!vendor.handleError(err)) setValue({ state: 'failed' }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useEffect(() => { void run(); }, [run]);
  return [value, run] as const;
}

function Tile({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <Card data-testid={testId}>
      <div className="p-5 sm:p-6">
        <p className="text-sm font-medium text-[var(--color-fg-quaternary)]">{label}</p>
        <div className="mt-2">{children}</div>
      </div>
    </Card>
  );
}

const linkCls = 'inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline';

/** Vendor dashboard: what needs doing today. Each card shows only with its permission. */
export default function VendorDashboardPage() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const canPay = vendor.can('payments');
  const canOrders = vendor.can('orders');
  const canLow = vendor.can('products') && vendor.me?.tools.stockLedger === true;

  const [payments, retryPayments] = useLoad<VendorPayments>(!!token && canPay, () => api.vendorPayments(token!));
  const [statements, retryStatements] = useLoad<VendorStatementList>(!!token && canPay, () => api.vendorStatements(token!));
  const [orders, retryOrders] = useLoad<VendorOrder[]>(!!token && canOrders, async () => (await api.vendorOrders(token!, { limit: 50 })).orders);
  const [low, retryLow] = useLoad<LowStockRow[]>(!!token && canLow, () => api.vendorLowStock(token!));

  const failed = (retry: () => void) => (
    <div className="space-y-2" role="alert">
      <p className="text-sm text-[var(--color-error-700)]">{t('vendor.dash.cardFailed')}</p>
      <Button variant="secondary" size="sm" className="min-h-11" onClick={retry}>{t('common.tryAgain')}</Button>
    </div>
  );
  const loading = <div aria-busy="true"><Skeleton className="h-8 w-24" /></div>;
  const value = (v: ReactNode, testId?: string) => <p className="text-3xl font-semibold tracking-tight tabular-nums text-[var(--color-fg-primary)]" data-testid={testId}>{v}</p>;

  if (!canPay && !canOrders && !vendor.can('products')) {
    return (
      <div className="space-y-6">
        <PageHeader title={vendor.me?.businessName || t('vendor.nav.dashboard')} />
        <EmptyState icon={<Inbox />} title={t('vendor.dash.nothingForYou')} />
      </div>
    );
  }

  const openOrders = orders.state === 'ready' ? orders.data.filter(isOpenOrder) : [];
  const toAct = [...openOrders].sort((a, b) => Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? '')).slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader title={t('vendor.nav.dashboard')} description={vendor.me?.businessName ?? undefined} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canPay && (
          <Tile label={t('vendor.dash.salesToday')} testId="dash-sales">
            {payments.state === 'loading' ? loading : payments.state === 'failed' ? failed(retryPayments) : (
              <>{value(money(payments.data.todaySalesTzs), 'dash-sales-value')}<p className="mt-1 text-sm text-[var(--color-fg-quaternary)]">{t('vendor.dash.salesHint')}</p></>
            )}
          </Tile>
        )}
        {canOrders && (
          <Tile label={t('vendor.dash.openOrders')} testId="dash-open-orders">
            {orders.state === 'loading' ? loading : orders.state === 'failed' ? failed(retryOrders) : (
              <>{value(openOrders.length, 'dash-open-orders-value')}<Link href="/vendor/orders/?status=open" className={linkCls}>{t('vendor.dash.viewAll')}</Link></>
            )}
          </Tile>
        )}
        {canLow && (
          <Tile label={t('vendor.dash.lowStock')} testId="dash-low-stock">
            {low.state === 'loading' ? loading : low.state === 'failed' ? failed(retryLow) : (
              <>{value(low.data.length, 'dash-low-value')}<Link href="/vendor/products/?filter=low" className={linkCls}>{t('vendor.dash.viewAll')}</Link></>
            )}
          </Tile>
        )}
        {canPay && (
          <Tile label={t('vendor.dash.waitingPayout')} testId="dash-payout">
            {payments.state === 'loading' ? loading : payments.state === 'failed' ? failed(retryPayments) : (
              <>
                {value(money(payments.data.pendingSettlementTzs))}
                {statements.state === 'failed' && <Button variant="link" size="sm" className="min-h-11" onClick={retryStatements}>{t('common.tryAgain')}</Button>}
                {statements.state === 'ready' && statements.data.payoutReady === false && (
                  <div className="mt-2 space-y-1">
                    <Badge tone="warning">{t('vendor.dash.payoutBlocked')}</Badge>
                    <p className="text-sm text-[var(--color-fg-tertiary)]">{fmt(t('vendor.payouts.blocked'), { reason: t(payoutWhyKey(statements.data.payoutBlockedBy)) })}</p>
                  </div>
                )}
              </>
            )}
          </Tile>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {canOrders && (
          <Card>
            <CardHeader>
              <h2 className="font-semibold">{t('vendor.dash.toAct')}</h2>
              <Link href="/vendor/orders/" className={linkCls}>{t('vendor.dash.viewAll')}</Link>
            </CardHeader>
            <CardContent className="p-0">
              {orders.state === 'loading' ? <div className="p-6">{loading}</div> : orders.state === 'failed' ? <div className="p-6">{failed(retryOrders)}</div> : toAct.length === 0 ? (
                <p className="px-6 py-5 text-sm text-[var(--color-fg-tertiary)]">{t('vendor.dash.noOpenOrders')}</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="dash-to-act">
                  {toAct.map(o => (
                    <li key={o.id}>
                      <Link href={`/vendor/orders/?id=${encodeURIComponent(o.id)}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-6 py-3 hover:bg-[var(--color-bg-secondary)]">
                        <span>
                          <span className="font-mono font-semibold">{o.shortRef}</span>
                          <span className="block text-xs text-[var(--color-fg-tertiary)]">{eatDateTime(o.createdAt, locale)} · {fmt(t('vendor.orders.itemsCount'), { n: o.items.reduce((n, i) => n + i.qty, 0) })}</span>
                        </span>
                        <Badge tone={statusTone(o.status)}>{t(statusKey(o.status))}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        {canLow && (
          <Card>
            <CardHeader>
              <h2 className="font-semibold">{t('vendor.dash.lowStock')}</h2>
              <Link href="/vendor/products/?filter=low" className={linkCls}>{t('vendor.dash.viewAll')}</Link>
            </CardHeader>
            <CardContent className="p-0">
              {low.state === 'loading' ? <div className="p-6">{loading}</div> : low.state === 'failed' ? <div className="p-6">{failed(retryLow)}</div> : low.data.length === 0 ? (
                <p className="px-6 py-5 text-sm text-[var(--color-fg-tertiary)]">{t('vendor.stock.lowEmpty')}</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="dash-low-list">
                  {low.data.slice(0, 5).map(r => (
                    <li key={`${r.productId}-${r.variant ?? ''}`}>
                      <Link href={`/vendor/products/history/?id=${encodeURIComponent(r.productId)}${r.variant ? `&variant=${encodeURIComponent(r.variant)}` : ''}`}
                        className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-6 py-3 hover:bg-[var(--color-bg-secondary)]">
                        <span className="[overflow-wrap:anywhere]">{r.name}{r.variant ? ` · ${r.variant}` : ''}</span>
                        <span className="text-sm tabular-nums text-[var(--color-fg-tertiary)]">{r.stock} / {r.reorderLevel}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
