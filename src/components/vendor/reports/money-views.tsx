'use client';
// App sales after commission (§7, canSeeOrderMoney), Customers and money owed (§8.3) and Payment methods (§8.4)
// of the vendor Reports page (S6). Read only; the payout engine is not involved.
import Link from 'next/link';
import { AGING_BUCKETS, agingKey, canWalkInSales, documentsOn, fmt, payLabel, saleMethodLabel } from '@/lib/vendor';
import { documentHref } from '@/lib/vendor-documents';
import { dayWords, periodWords, type CustomersReport, type MethodsReport, type PayoutsReport, type RefundsReport } from '@/lib/vendor-reports';
import { Badge, Card, CardContent, CardHeader, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import { Figure, figureGrid, HeaderLine, linkCls, minus, NoSales, numCell, pct, plural, qty, tsh, useReport, useWalkInSeen, ViewState } from './bits';
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
        const ordersN = (n: number) => plural(t, n, 'vendor.reports.ordersOne', 'vendor.reports.ordersN', { n: qty(n) });
        return (
          <div className="space-y-4">
            <HeaderLine head={d} view="payouts" />
            <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="payouts-basis">{t('vendor.reports.payouts.basis')}</p>
            {empty ? <NoSales from={d.from} to={d.to} hasEverSold={d.hasEverSold} onTryPeriod={onTryPeriod} /> : (
              <>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                  <Figure label={t('vendor.reports.appSales')} value={tsh(d.totals.grossTzs)} sub={ordersN(d.totals.orderCount)} testId="payouts-gross" />
                  <Figure label={t('vendor.reports.commission')} value={minus(d.totals.commissionTzs)} testId="payouts-commission" />
                  <Figure strong label={t('vendor.reports.youReceive')} value={tsh(d.totals.payoutTzs)} testId="payouts-receive" />
                </div>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                  <Figure label={t('vendor.reports.payouts.notDelivered')} value={tsh(s.notDelivered.payoutTzs)} sub={ordersN(s.notDelivered.orders)} testId="payouts-not-delivered" />
                  <Figure label={t('vendor.reports.payouts.waiting')} value={tsh(s.waiting.payoutTzs)} sub={ordersN(s.waiting.orders)} testId="payouts-waiting" />
                  <Figure label={t('vendor.reports.payouts.paidOut')} value={tsh(s.paidOut.payoutTzs)} sub={ordersN(s.paidOut.orders)} testId="payouts-paid" />
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
                          <Td className={numCell}>{qty(w.orderCount)}</Td>
                          <Td className={numCell}>{tsh(w.grossTzs)}</Td>
                          <Td className={numCell}>{minus(w.commissionTzs)}</Td>
                          <Td className={`${numCell} font-semibold`}>{tsh(w.payoutTzs)}</Td>
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
            <Figure strong label={t('vendor.owed.title')} value={tsh(d.owedTzs)} sub={t('vendor.reports.now')} testId="cust-owed" />
            <Figure label={t('vendor.owed.overdue')} value={tsh(d.overdueTzs)} sub={t('vendor.reports.now')} testId="cust-overdue" />
            <Figure label={t('vendor.reports.cust.creditSales')} value={tsh(d.creditSales.totalTzs)} testId="cust-credit"
              sub={<>
                {plural(t, d.creditSales.count, 'vendor.reports.countOne', 'vendor.reports.countN', { n: qty(d.creditSales.count) })}
                {/* S7: what refunds took off pay-later balances in the period (not money). */}
                {!!d.refundedOffTzs && <span className="block" data-testid="cust-refunded-off">{fmt(t('vendor.reports.cust.refundedOff'), { amount: tsh(d.refundedOffTzs) })}</span>}
              </>} />
            <Figure label={t('vendor.reports.cust.collected')} value={tsh(d.collectedTzs)} testId="cust-collected" />
          </div>
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm">
              <p data-testid="cust-buyers">
                <span className="font-semibold">{t('vendor.reports.cust.buyers')}:</span>{' '}
                {t('vendor.reports.channel.walkIn')} {qty(d.buyers.shop)} · {t('vendor.reports.channel.app')} {qty(d.buyers.app)}
              </p>
              <p data-testid="cust-aging">
                <span className="font-semibold">{t('vendor.owed.buckets')}:</span>{' '}
                {AGING_BUCKETS.map(b => `${t(agingKey(b))} ${tsh(d.aging[b])}`).join(' · ')}
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
function MethodGroup({ title, rows, testId, note }: { title: string; rows: Array<{ key: string; label: string; amountTzs: number; count: number; sharePct?: number }>; testId: string; note?: string }) {
  // The paid-back group (S7) has no share: it is never summed with money in.
  const shares = rows.some(r => r.sharePct != null);
  const { t } = useApp();
  return (
    <Card data-testid={testId} className="min-w-0">
      <CardHeader><h3 className="text-base font-semibold">{title}</h3></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">—</p> : (
          <>
            <div className="hidden md:block">
              <Table aria-label={title}>
                <THead><Tr><Th>{t('vendor.reports.method')}</Th><Th className="!text-right">{t('vendor.reports.amount')}</Th>{shares && <Th className="min-w-32">{t('vendor.reports.share')}</Th>}<Th className="!text-right">{t('vendor.reports.count')}</Th></Tr></THead>
                <TBody>
                  {rows.map(r => (
                    <Tr key={r.key}>
                      <Th scope="row" className="!font-medium">{r.label}</Th>
                      <Td className={numCell}>{tsh(r.amountTzs)}</Td>
                      {shares && <Td><span className="flex items-center gap-2"><ShareBar pctValue={r.sharePct ?? 0} /><span className="tabular-nums">{pct(r.sharePct)}</span></span></Td>}
                      <Td className={numCell}>{qty(r.count)}</Td>
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
                    <span className="tabular-nums font-semibold">{tsh(r.amountTzs)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {shares && <><ShareBar pctValue={r.sharePct ?? 0} /><span className="tabular-nums">{pct(r.sharePct)}</span></>}
                    <span className="text-[var(--color-fg-quaternary)]">{shares ? '· ' : ''}{t('vendor.reports.count')} {qty(r.count)}</span>
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
          {!d.byYou.length && !d.viaFitFlex.length && !d.paidBack?.length ? <NoSales from={d.from} to={d.to} hasEverSold={d.hasEverSold} onTryPeriod={onTryPeriod} /> : (
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
              {/* S7: money the vendor paid back on refunds, its own group (balance taken off a pay-later sale is not money). */}
              {!!d.paidBack?.length && (
                <MethodGroup
                  title={t('vendor.reports.methods.paidBack')} testId="methods-paid-back"
                  rows={d.paidBack.map(r => ({ key: r.method, label: saleMethodLabel(r.method, t), amountTzs: r.amountTzs, count: r.count }))}
                  note={t('vendor.refunds.moneyNotice')}
                />
              )}
            </div>
          )}
        </div>
      )}
    </ViewState>
  );
}

/**
 * Refunds (S6 §8.5, S7 §5.5): credit notes made in the period and undos made in it (Undone rows are negative, U+2212),
 * with the totals the server computed. Read only.
 */
export function RefundsView({ query, onTryPeriod }: ViewProps) {
  const { t, locale } = useApp();
  const vendor = useVendor();
  const [value, retry] = useReport('refunds', query);
  const docs = documentsOn(vendor.me) && canWalkInSales(vendor.me);
  const sales = canWalkInSales(vendor.me);
  return (
    <ViewState value={value} onRetry={retry}>
      {(d: RefundsReport) => {
        const typeWord = (type: string) => t(type === 'revert' ? 'vendor.reports.refunds.type.revert' : 'vendor.reports.refunds.type.refund');
        const cn = (r: RefundsReport['rows'][number]) => (docs
          ? <Link className={linkCls} href={documentHref('credit_note', r.refundId, null, r.saleId)}>{r.number}</Link>
          : <span className="font-mono">{r.number}</span>);
        const saleRef = (r: RefundsReport['rows'][number]) => (sales
          ? <Link className={linkCls} href={`/vendor/sales/?id=${encodeURIComponent(r.saleId)}`}>{r.saleNumber}</Link>
          : <span className="font-mono">{r.saleNumber}</span>);
        const method = (m: string | null) => (m ? saleMethodLabel(m, t) : '—');
        return (
          <div className="space-y-4">
            <HeaderLine head={d} view="refunds" />
            {!d.rows.length ? (
              d.hasEverSold === false
                ? <NoSales from={d.from} to={d.to} hasEverSold={false} onTryPeriod={onTryPeriod} />
                : <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="refunds-empty">{fmt(t('vendor.reports.refunds.empty'), { period: periodWords(d.from, d.to, locale) })}</p>
            ) : (
              <>
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
                  <Figure label={t('vendor.reports.refunds')} value={qty(d.totals.count)} testId="refunds-count" />
                  <Figure strong label={t('vendor.reports.amount')} value={tsh(d.totals.amountTzs)} testId="refunds-amount" />
                  <Figure label={t('vendor.reports.refunds.paidBack')} value={tsh(d.totals.paidOutTzs)} testId="refunds-paid-back" />
                  <Figure label={t('vendor.reports.refunds.offBalances')} value={tsh(d.totals.balanceReducedTzs)} testId="refunds-off-balances" />
                  <Figure label={t('vendor.reports.refunds.restocked')} value={qty(d.totals.restockedUnits)} testId="refunds-restocked" />
                  <Figure label={t('vendor.reports.refunds.undoneCount')} value={qty(d.totals.revertedCount)} testId="refunds-undone" />
                </div>
                <div className="hidden md:block">
                  <Table aria-label={t('vendor.reports.refunds.byEvent')} data-testid="refunds-table">
                    <THead>
                      <Tr>
                        <Th>{t('vendor.reports.refunds.colDate')}</Th>
                        <Th>{t('vendor.reports.refunds.colCreditNote')}</Th>
                        <Th>{t('vendor.reports.refunds.colSale')}</Th>
                        <Th>{t('vendor.reports.refunds.colType')}</Th>
                        <Th className="!text-right">{t('vendor.reports.amount')}</Th>
                        <Th className="!text-right">{t('vendor.reports.refunds.paidBack')}</Th>
                        <Th>{t('vendor.reports.method')}</Th>
                        <Th className="!text-right min-w-24">{t('vendor.reports.refunds.restocked')}</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {d.rows.map(r => (
                        <Tr key={`${r.type}:${r.refundId}`} data-testid={`refunds-row-${r.type}-${r.refundId}`}>
                          <Th scope="row" className="!font-normal whitespace-nowrap">{dayWords(r.date, locale)}</Th>
                          <Td>{cn(r)}</Td>
                          <Td>{saleRef(r)}</Td>
                          <Td>{r.type === 'revert' ? <Badge tone="gray">{typeWord(r.type)}</Badge> : typeWord(r.type)}</Td>
                          <Td className={numCell}>{tsh(r.amountTzs)}</Td>
                          <Td className={numCell}>{tsh(r.paidOutTzs)}</Td>
                          <Td>{method(r.method)}</Td>
                          <Td className={numCell}>{qty(r.restockedUnits)}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </div>
                <ul className="space-y-2 md:hidden" aria-label={t('vendor.reports.refunds.byEvent')} data-testid="refunds-cards">
                  {d.rows.map(r => (
                    <li key={`${r.type}:${r.refundId}`} className="space-y-1 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {cn(r)}
                        {r.type === 'revert' ? <Badge tone="gray">{typeWord(r.type)}</Badge> : <span>{typeWord(r.type)}</span>}
                      </div>
                      <p className="flex flex-wrap gap-x-2 text-[var(--color-fg-tertiary)]">
                        <span>{dayWords(r.date, locale)}</span><span aria-hidden="true">·</span>{saleRef(r)}
                      </p>
                      <p className="flex flex-wrap gap-x-2">
                        <span className="font-semibold tabular-nums">{tsh(r.amountTzs)}</span>
                        <span aria-hidden="true">·</span><span>{t('vendor.reports.refunds.paidBack')} {tsh(r.paidOutTzs)}</span>
                        {r.method && <><span aria-hidden="true">·</span><span>{method(r.method)}</span></>}
                        <span aria-hidden="true">·</span><span>{t('vendor.reports.refunds.restocked')} {qty(r.restockedUnits)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      }}
    </ViewState>
  );
}
