'use client';
// Overview (§4) and Sales (§5) of the vendor Reports page (S6). Server figures only.
import Link from 'next/link';
import { money, formatNumber } from '@/lib/admin-utils';
import { fmt, payLabel, saleMethodLabel } from '@/lib/vendor';
import { bucketWords, type ReportQuery, type SalesReport, type SummaryReport } from '@/lib/vendor-reports';
import { Alert, Card, CardContent, CardHeader, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import {
  Figure, figureGrid, HeaderLine, minus, NoSales, numCell, productLabel, ReportBarChart, useReport, useWalkInSeen, ViewState,
} from './bits';

/** walkInShown: the Shop channel shows (tool on, or the server saw walk-in data in the period). */
export type ViewProps = { query: ReportQuery; walkInShown: boolean; onTryPeriod: () => void; onWalkIn: (seen: boolean) => void };

const salesEmpty = (s: { netTzs: number; grossTzs: number; saleCount: number; orderCount: number; refundTzs: number; voided: { count: number } }) =>
  !s.grossTzs && !s.netTzs && !s.saleCount && !s.orderCount && !s.refundTzs && !s.voided.count;

function MethodsCompact({ data }: { data: SummaryReport['methods'] }) {
  const { t } = useApp();
  const group = (title: string, rows: Array<{ label: string; amountTzs: number; sharePct: number }>, testId: string) => (
    <div data-testid={testId}>
      <h4 className="mb-1 text-sm font-semibold text-[var(--color-fg-secondary)]">{title}</h4>
      {rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">—</p> : (
        <ul className="space-y-1 text-sm">
          {rows.map(r => (
            <li key={r.label} className="flex justify-between gap-3">
              <span>{r.label}</span><span className="tabular-nums">{money(r.amountTzs)} · {r.sharePct}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {group(t('vendor.reports.methods.byYou'), data.byYou.map(r => ({ label: saleMethodLabel(r.method, t), amountTzs: r.amountTzs, sharePct: r.sharePct })), 'overview-methods-you')}
      {group(t('vendor.reports.methods.viaFitFlex'), data.viaFitFlex.map(r => ({ label: payLabel(r.paymentMethod, t) || t('vendor.pos.method.other'), amountTzs: r.amountTzs, sharePct: r.sharePct })), 'overview-methods-fitflex')}
    </div>
  );
}

export function OverviewView({ query, onTryPeriod, onWalkIn }: ViewProps) {
  const { t, locale } = useApp();
  const [value, retry] = useReport('overview', query);
  useWalkInSeen(value, onWalkIn);
  return (
    <ViewState value={value} onRetry={retry}>
      {d => {
        const s = d.sales;
        const cards = [
          <Figure key="net" strong testId="ov-net" label={t('vendor.reports.net')} value={money(s.netTzs)}
            sub={fmt(t('vendor.reports.grossShort'), { g: money(s.grossTzs), d: money(s.discountTzs) })} />,
          <Figure key="items" testId="ov-items" label={t('vendor.reports.itemsSold')} value={formatNumber(s.itemsSold)} />,
          ...(d.profit ? [<Figure key="profit" testId="ov-profit" label={t('vendor.reports.profit')} value={money(d.profit.profitTzs)} sub={t('vendor.reports.profitHint')} />] : []),
          ...(d.customers ? [<Figure key="owed" testId="ov-owed" label={t('vendor.owed.title')} value={money(d.customers.owedTzs)} />] : []),
          <Figure key="count" testId="ov-count" label={t('vendor.reports.salesCount')} value={formatNumber(s.saleCount + s.orderCount)} />,
        ].slice(0, 4);
        return (
          <div className="space-y-4">
            <HeaderLine head={d} view="overview" />
            {salesEmpty(s) ? <NoSales from={d.from} to={d.to} onTryPeriod={onTryPeriod} /> : (
              <>
                <div className={figureGrid}>{cards}</div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="lg:col-span-2">
                    <CardHeader><h3 className="text-base font-semibold">{fmt(t('vendor.reports.netBy'), { group: t(`vendor.reports.group.${d.groupBy ?? 'day'}`).toLowerCase() })}</h3></CardHeader>
                    <CardContent className="space-y-3">
                      <ReportBarChart rows={s.buckets.map(b => ({ start: b.start, end: b.end, value: b.netTzs }))} groupBy={d.groupBy} from={d.from} to={d.to} figureKey="vendor.reports.net" twoSeries={false} testId="ov-chart" />
                      <Table aria-label={t('vendor.reports.sales.table')} data-testid="ov-buckets">
                        <THead><Tr><Th>{t('vendor.reports.period')}</Th><Th className="!text-right">{t('vendor.reports.net')}</Th></Tr></THead>
                        <TBody>{s.buckets.map(b => <Tr key={b.start}><Th scope="row" className="!font-normal">{bucketWords(b.start, b.end, d.groupBy, locale)}</Th><Td className={numCell}>{money(b.netTzs)}</Td></Tr>)}</TBody>
                      </Table>
                    </CardContent>
                  </Card>
                  <Card data-testid="ov-top">
                    <CardHeader><h3 className="text-base font-semibold">{t('vendor.reports.top5')}</h3></CardHeader>
                    <CardContent>
                      <ol className="space-y-2 text-sm">
                        {d.topProducts.map(p => (
                          <li key={`${p.productId}:${p.variant ?? ''}`} className="flex justify-between gap-3">
                            <span className="[overflow-wrap:anywhere]">{productLabel(p, t)}</span>
                            <span className="shrink-0 text-right tabular-nums">{money(p.netRevenueTzs)}<span className="block text-xs text-[var(--color-fg-quaternary)]">{fmt(t('vendor.reports.unitsN'), { n: formatNumber(p.unitsSold) })}</span></span>
                          </li>
                        ))}
                      </ol>
                      <p className="mt-3 text-sm text-[var(--color-fg-quaternary)]" data-testid="ov-slow">{fmt(t('vendor.reports.slowCount'), { n: d.slowCount })}</p>
                    </CardContent>
                  </Card>
                </div>
                <Card>
                  <CardHeader><h3 className="text-base font-semibold">{t('vendor.reports.view.methods')}</h3></CardHeader>
                  <CardContent><MethodsCompact data={d.methods} /></CardContent>
                </Card>
                {d.payouts && (
                  <Card data-testid="ov-payouts">
                    <CardHeader><h3 className="text-base font-semibold">{t('vendor.reports.view.payouts')}</h3></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <dl className="grid gap-2 sm:grid-cols-3">
                        <div><dt className="text-[var(--color-fg-quaternary)]">{t('vendor.reports.gross')}</dt><dd className="tabular-nums font-semibold">{money(d.payouts.grossTzs)}</dd></div>
                        <div><dt className="text-[var(--color-fg-quaternary)]">{t('vendor.reports.commission')}</dt><dd className="tabular-nums font-semibold">{minus(d.payouts.commissionTzs)}</dd></div>
                        <div><dt className="text-[var(--color-fg-quaternary)]">{t('vendor.reports.youReceive')}</dt><dd className="tabular-nums font-semibold">{money(d.payouts.payoutTzs)}</dd></div>
                      </dl>
                      <p className="text-[var(--color-fg-tertiary)]">{t('vendor.reports.payouts.paidOut')}: {money(d.payouts.paidOutTzs)} · {t('vendor.reports.payouts.waiting')}: {money(d.payouts.waitingTzs)}</p>
                      <p className="text-xs text-[var(--color-fg-quaternary)]">{t('vendor.reports.payouts.basis')}</p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        );
      }}
    </ViewState>
  );
}

export function SalesView({ query, onTryPeriod, onWalkIn, walkInShown }: ViewProps) {
  const { t, locale } = useApp();
  const vendor = useVendor();
  const [value, retry] = useReport('sales', query);
  useWalkInSeen(value, onWalkIn);
  return (
    <ViewState value={value} onRetry={retry}>
      {(d: SalesReport) => {
        const s = d.totals;
        const shop = walkInShown || d.channels.walkIn;
        const vat = s.vatIncludedTzs > 0;
        const count = (b: { app: { count: number }; walkIn: { count: number } }) => b.app.count + b.walkIn.count;
        const total = d.byChannel.app.netTzs + d.byChannel.walkIn.netTzs;
        const share = (n: number) => (total ? `${Math.round((n * 1000) / total) / 10}%` : '—');
        const voidedText = fmt(t('vendor.reports.voided'), { n: s.voided.count, amount: money(s.voided.totalTzs) });
        return (
          <div className="space-y-4">
            <HeaderLine head={d} view="sales" />
            {salesEmpty(s) ? <NoSales from={d.from} to={d.to} onTryPeriod={onTryPeriod} /> : (
              <>
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" data-testid="sales-strip">
                  <Figure label={t('vendor.reports.gross')} value={money(s.grossTzs)} testId="sales-gross" />
                  <Figure label={t('vendor.reports.discounts')} value={minus(s.discountTzs)} testId="sales-discounts" />
                  <Figure label={t('vendor.reports.refunds')} value={minus(s.refundTzs)} testId="sales-refunds" />
                  <Figure strong label={t('vendor.reports.net')} value={money(s.netTzs)} testId="sales-net" />
                  {vat && <Figure label={t('vendor.reports.vatIncluded')} value={money(s.vatIncludedTzs)} testId="sales-vat" />}
                  <Figure label={t('vendor.reports.salesCount')} value={formatNumber(s.saleCount + s.orderCount)} testId="sales-count" />
                  <Figure label={t('vendor.reports.itemsSold')} value={formatNumber(s.itemsSold)} testId="sales-items" />
                </div>
                {s.voided.count > 0 && (
                  <Alert tone="info" className="!font-normal">
                    <span data-testid="sales-voided">
                      {vendor.can('sales')
                        ? <Link className="underline underline-offset-4" href={`/vendor/sales/?status=voided&range=custom&from=${d.from}&to=${d.to}`}>{voidedText}</Link>
                        : voidedText}
                    </span>
                  </Alert>
                )}
                <Card>
                  <CardContent className="pt-6">
                    <ReportBarChart
                      rows={d.buckets.map(b => (shop ? { start: b.start, end: b.end, app: b.app.netTzs, shop: b.walkIn.netTzs } : { start: b.start, end: b.end, value: b.netTzs }))}
                      groupBy={d.groupBy} from={d.from} to={d.to} figureKey="vendor.reports.net" twoSeries={shop} testId="sales-chart"
                    />
                  </CardContent>
                </Card>
                <Table aria-label={t('vendor.reports.sales.table')} data-testid="sales-table">
                  <caption className="sr-only">{t('vendor.reports.sales.table')}</caption>
                  <THead>
                    <Tr>
                      <Th>{t('vendor.reports.period')}</Th>
                      {shop && <Th className="!text-right">{t('vendor.reports.appNet')}</Th>}
                      {shop && <Th className="!text-right">{t('vendor.reports.shopNet')}</Th>}
                      <Th className="!text-right">{t('vendor.reports.gross')}</Th>
                      <Th className="!text-right">{t('vendor.reports.discounts')}</Th>
                      <Th className="!text-right">{t('vendor.reports.refunds')}</Th>
                      <Th className="!text-right">{t('vendor.reports.net')}</Th>
                      {vat && <Th className="!text-right">{t('vendor.reports.vatIncluded')}</Th>}
                      <Th className="!text-right">{t('vendor.reports.salesCount')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {d.buckets.map(b => (
                      <Tr key={b.start}>
                        <Th scope="row" className="!font-normal whitespace-nowrap">{bucketWords(b.start, b.end, d.groupBy, locale)}</Th>
                        {shop && <Td className={numCell}>{money(b.app.netTzs)}</Td>}
                        {shop && <Td className={numCell}>{money(b.walkIn.netTzs)}</Td>}
                        <Td className={numCell}>{money(b.app.grossTzs + b.walkIn.grossTzs)}</Td>
                        <Td className={numCell}>{minus(b.app.discountTzs + b.walkIn.discountTzs)}</Td>
                        <Td className={numCell}>{minus(b.app.refundTzs + b.walkIn.refundTzs)}</Td>
                        <Td className={`${numCell} font-semibold`}>{money(b.netTzs)}</Td>
                        {vat && <Td className={numCell}>{money(b.app.vatIncludedTzs + b.walkIn.vatIncludedTzs)}</Td>}
                        <Td className={numCell}>{formatNumber(count(b))}</Td>
                      </Tr>
                    ))}
                  </TBody>
                  <tfoot>
                    <Tr data-testid="sales-total-row">
                      <Th scope="row">{t('vendor.owed.totalRow')}</Th>
                      {shop && <Td className={numCell}>{money(d.byChannel.app.netTzs)}</Td>}
                      {shop && <Td className={numCell}>{money(d.byChannel.walkIn.netTzs)}</Td>}
                      <Td className={numCell}>{money(s.grossTzs)}</Td>
                      <Td className={numCell}>{minus(s.discountTzs)}</Td>
                      <Td className={numCell}>{minus(s.refundTzs)}</Td>
                      <Td className={`${numCell} font-semibold`}>{money(s.netTzs)}</Td>
                      {vat && <Td className={numCell}>{money(s.vatIncludedTzs)}</Td>}
                      <Td className={numCell}>{formatNumber(s.saleCount + s.orderCount)}</Td>
                    </Tr>
                  </tfoot>
                </Table>
                {shop && (
                  <Card data-testid="sales-split">
                    <CardHeader><h3 className="text-base font-semibold">{t('vendor.reports.channel')}</h3></CardHeader>
                    <CardContent>
                      <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                        {([['app', d.byChannel.app], ['walkIn', d.byChannel.walkIn]] as const).map(([k, c]) => (
                          <div key={k}>
                            <dt className="font-semibold">{t(k === 'app' ? 'vendor.reports.channel.app' : 'vendor.reports.channel.walkIn')}</dt>
                            <dd className="tabular-nums">{money(c.netTzs)} · {t('vendor.reports.share')} {share(c.netTzs)} · {fmt(t('vendor.reports.countN'), { n: formatNumber(c.count) })}</dd>
                          </div>
                        ))}
                      </dl>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        );
      }}
    </ViewState>
  );
}

