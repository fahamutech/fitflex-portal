'use client';
// App sales after commission (§7, canSeeOrderMoney), Customers and money owed (§8.3) and Payment methods (§8.4)
// of the vendor Reports page (S6). Read only; the payout engine is not involved.
import Link from 'next/link';
import { formatNumber, money } from '@/lib/admin-utils';
import { AGING_BUCKETS, agingKey, fmt, payLabel, saleMethodLabel } from '@/lib/vendor';
import { periodWords, type CustomersReport, type MethodsReport, type PayoutsReport } from '@/lib/vendor-reports';
import { Badge, Card, CardContent, CardHeader, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import { Figure, figureGrid, HeaderLine, linkCls, minus, NoSales, numCell, pct, plural, useReport, useWalkInSeen, ViewState } from './bits';
import type { ViewProps } from './sales-views';

export function PayoutsView({ query, onTryPeriod }: ViewProps) {
  const { t, locale } = useApp();
  const vendor = useVendor();
  const [value, retry] = useReport('payouts', query);
  return (
    <ViewState value={value} onRetry={retry}>
      {(d: PayoutsReport) => {
        const s = d.status;
        const empty = !d.totals.orderCount && !s.notDelivered.orders;
        const ordersN = (n: number) => plural(t, n, 'vendor.reports.ordersOne', 'vendor.reports.ordersN', { n: formatNumber(n) });
        return (
          <div className="space-y-4">
            <HeaderLine head={d} view="payouts" />
            <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="payouts-basis">{t('vendor.reports.payouts.basis')}</p>
            {empty ? <NoSales from={d.from} to={d.to} hasEverSold={d.hasEverSold} onTryPeriod={onTryPeriod} /> : (
              <>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                  <Figure label={t('vendor.reports.appSales')} value={money(d.totals.grossTzs)} sub={ordersN(d.totals.orderCount)} testId="payouts-gross" />
                  <Figure label={t('vendor.reports.commission')} value={minus(d.totals.commissionTzs)} testId="payouts-commission" />
                  <Figure strong label={t('vendor.reports.youReceive')} value={money(d.totals.payoutTzs)} testId="payouts-receive" />
                </div>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                  <Figure label={t('vendor.reports.payouts.notDelivered')} value={money(s.notDelivered.payoutTzs)} sub={ordersN(s.notDelivered.orders)} testId="payouts-not-delivered" />
                  <Figure label={t('vendor.reports.payouts.waiting')} value={money(s.waiting.payoutTzs)} sub={ordersN(s.waiting.orders)} testId="payouts-waiting" />
                  <Figure label={t('vendor.reports.payouts.paidOut')} value={money(s.paidOut.payoutTzs)} sub={ordersN(s.paidOut.orders)} testId="payouts-paid" />
                </div>
                <Table aria-label={t('vendor.reports.payouts.byWeek')} data-testid="payouts-weeks">
                  <THead>
                    <Tr>
                      <Th>{t('vendor.reports.week')}</Th>
                      <Th className="!text-right">{t('vendor.reports.orders')}</Th>
                      <Th className="!text-right">{t('vendor.reports.appSales')}</Th>
                      <Th className="!text-right">{t('vendor.reports.commission')}</Th>
                      <Th className="!text-right">{t('vendor.reports.youReceive')}</Th>
                      <Th>{t('vendor.reports.statement')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {d.weeks.map(w => {
                      const badge = !w.statement
                        ? <Badge tone="gray">{t('vendor.reports.payouts.noStatement')}</Badge>
                        : w.statement.status === 'paid'
                          ? <Badge tone="success">{t('vendor.reports.payouts.paidOut')}</Badge>
                          : <Badge tone="info">{t('vendor.reports.payouts.awaiting')}</Badge>;
                      return (
                        <Tr key={`${w.periodStartDate}:${w.statement?.id ?? ''}`} data-testid="payouts-week">
                          <Th scope="row" className="!font-normal whitespace-nowrap">{periodWords(w.periodStartDate, w.periodEndDate, locale)}</Th>
                          <Td className={numCell}>{formatNumber(w.orderCount)}</Td>
                          <Td className={numCell}>{money(w.grossTzs)}</Td>
                          <Td className={numCell}>{minus(w.commissionTzs)}</Td>
                          <Td className={`${numCell} font-semibold`}>{money(w.payoutTzs)}</Td>
                          <Td>
                            <span className="inline-flex flex-wrap items-center gap-2">
                              {badge}
                              {w.statement && vendor.can('payments') && (
                                <Link className={linkCls} href={`/vendor/payouts/?id=${encodeURIComponent(w.statement.id)}`}>{t('vendor.reports.openStatement')}</Link>
                              )}
                            </span>
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </>
            )}
            <p className="text-xs text-[var(--color-fg-quaternary)]">{t('vendor.reports.payouts.reconcile')}</p>
          </div>
        );
      }}
    </ViewState>
  );
}

export function CustomersView({ query }: ViewProps) {
  const { t } = useApp();
  const [value, retry] = useReport('customers', query);
  return (
    <ViewState value={value} onRetry={retry}>
      {(d: CustomersReport) => (
        <div className="space-y-4">
          <HeaderLine head={d} view="customers" />
          <div className={figureGrid}>
            <Figure strong label={t('vendor.owed.title')} value={money(d.owedTzs)} sub={t('vendor.reports.now')} testId="cust-owed" />
            <Figure label={t('vendor.owed.overdue')} value={money(d.overdueTzs)} sub={t('vendor.reports.now')} testId="cust-overdue" />
            <Figure label={t('vendor.reports.cust.creditSales')} value={money(d.creditSales.totalTzs)} sub={plural(t, d.creditSales.count, 'vendor.reports.countOne', 'vendor.reports.countN', { n: formatNumber(d.creditSales.count) })} testId="cust-credit" />
            <Figure label={t('vendor.reports.cust.collected')} value={money(d.collectedTzs)} testId="cust-collected" />
          </div>
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm">
              <p data-testid="cust-buyers">
                <span className="font-semibold">{t('vendor.reports.cust.buyers')}:</span>{' '}
                {t('vendor.reports.channel.walkIn')} {formatNumber(d.buyers.shop)} · {t('vendor.reports.channel.app')} {formatNumber(d.buyers.app)}
              </p>
              <p data-testid="cust-aging">
                <span className="font-semibold">{t('vendor.owed.buckets')}:</span>{' '}
                {AGING_BUCKETS.map(b => `${t(agingKey(b))} ${money(d.aging[b])}`).join(' · ')}
              </p>
              <Link className={linkCls} href="/vendor/customers/?view=owed">{t('vendor.reports.cust.openOwed')}</Link>
            </CardContent>
          </Card>
        </div>
      )}
    </ViewState>
  );
}

function ShareBar({ pctValue }: { pctValue: number }) {
  return (
    <span aria-hidden="true" className="block h-2 w-full max-w-24 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
      <span className="block h-full rounded-full bg-[var(--color-brand-600)]" style={{ width: `${Math.max(0, Math.min(100, pctValue))}%` }} />
    </span>
  );
}

/**
 * One group of payment methods. From md a table; below it (375px, UAT D3) one card per method, so nothing is
 * clipped and nothing scrolls sideways.
 */
function MethodGroup({ title, rows, testId, note }: { title: string; rows: Array<{ key: string; label: string; amountTzs: number; count: number; sharePct: number }>; testId: string; note?: string }) {
  const { t } = useApp();
  return (
    <Card data-testid={testId} className="min-w-0">
      <CardHeader><h3 className="text-base font-semibold">{title}</h3></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">—</p> : (
          <>
            <div className="hidden md:block">
              <Table aria-label={title}>
                <THead><Tr><Th>{t('vendor.reports.method')}</Th><Th className="!text-right">{t('vendor.reports.amount')}</Th><Th className="min-w-32">{t('vendor.reports.share')}</Th><Th className="!text-right">{t('vendor.reports.count')}</Th></Tr></THead>
                <TBody>
                  {rows.map(r => (
                    <Tr key={r.key}>
                      <Th scope="row" className="!font-medium">{r.label}</Th>
                      <Td className={numCell}>{money(r.amountTzs)}</Td>
                      <Td><span className="flex items-center gap-2"><ShareBar pctValue={r.sharePct} /><span className="tabular-nums">{pct(r.sharePct)}</span></span></Td>
                      <Td className={numCell}>{formatNumber(r.count)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="space-y-2 md:hidden" aria-label={title} data-testid={`${testId}-cards`}>
              {rows.map(r => (
                <li key={r.key} className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-semibold [overflow-wrap:anywhere]">{r.label}</span>
                    <span className="tabular-nums font-semibold">{money(r.amountTzs)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <ShareBar pctValue={r.sharePct} />
                    <span className="tabular-nums">{pct(r.sharePct)}</span>
                    <span className="text-[var(--color-fg-quaternary)]">· {t('vendor.reports.count')} {formatNumber(r.count)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {note && <p className="text-xs text-[var(--color-fg-quaternary)]">{note}</p>}
      </CardContent>
    </Card>
  );
}

export function MethodsView({ query, onTryPeriod, onWalkIn }: ViewProps) {
  const { t } = useApp();
  const [value, retry] = useReport('methods', query);
  useWalkInSeen(value, onWalkIn);
  return (
    <ViewState value={value} onRetry={retry}>
      {(d: MethodsReport) => (
        <div className="space-y-4">
          <HeaderLine head={d} view="methods" />
          {!d.byYou.length && !d.viaFitFlex.length ? <NoSales from={d.from} to={d.to} hasEverSold={d.hasEverSold} onTryPeriod={onTryPeriod} /> : (
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <MethodGroup
                title={t('vendor.reports.methods.byYou')} testId="methods-you"
                rows={d.byYou.map(r => ({ key: r.method, label: r.method === 'cash' ? t('vendor.reports.methods.netOfChange') : saleMethodLabel(r.method, t), amountTzs: r.amountTzs, count: r.count, sharePct: r.sharePct }))}
                note={t('vendor.pos.moneyNotice')}
              />
              <MethodGroup
                title={t('vendor.reports.methods.viaFitFlex')} testId="methods-fitflex"
                rows={d.viaFitFlex.map(r => ({ key: r.paymentMethod, label: payLabel(r.paymentMethod, t) || t('vendor.pos.method.other'), amountTzs: r.amountTzs, count: r.count, sharePct: r.sharePct }))}
              />
            </div>
          )}
        </div>
      )}
    </ViewState>
  );
}
