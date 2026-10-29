'use client';
// Products (§6), Stock value (§8.1) and Profit (§8.2) of the vendor Reports page (S6). Cost, profit and margin show
// only when the server sent them (canSeeCost); they are never shown as zero. Days of cover come from the server.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatNumber, money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { eatDayOf, fmt } from '@/lib/vendor';
import {
  bucketWords, clock12, coverText, dayShort, PRODUCT_SORTS, reportsApi,
  type ProductRow, type ProductSort, type ProfitReport, type ReportQuery, type StockReport, type StockRow,
} from '@/lib/vendor-reports';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Input, Segmented, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import { Figure, figureGrid, HeaderLine, minus, NoSales, numCell, pct, productLabel, ReportBarChart, useReport, useWalkInSeen, ViewState } from './bits';
import type { ViewProps } from './sales-views';

const SORT_KEYS: Record<ProductSort, MessageKey> = { revenue: 'vendor.reports.best', units: 'vendor.reports.mostUnits', slow: 'vendor.reports.slow' };

function CoverCell({ row }: { row: ProductRow }) {
  const { t } = useApp();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="cover">
      <span>{coverText(row, t)}</span>
      {row.coverState === 'soon' && <Badge tone="warning">{t('vendor.reports.reorderSoon')}</Badge>}
    </span>
  );
}

export function ProductsView({ query, onTryPeriod, onWalkIn, sort, onSort }: ViewProps & { sort: ProductSort; onSort: (s: ProductSort) => void }) {
  const { t, locale, token } = useApp();
  const vendor = useVendor();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const id = setTimeout(() => setQ(search.trim().slice(0, 80)), 300); return () => clearTimeout(id); }, [search]);
  const [value, retry] = useReport('products', { ...query, sort, q, limit: 50 });
  useWalkInSeen(value, onWalkIn);
  const [more, setMore] = useState<{ rows: ProductRow[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { setMore(null); }, [value]);

  const loadMore = async (cursor: string) => {
    if (!token) return;
    setLoadingMore(true);
    try {
      const page = await reportsApi.get(token, 'products', { ...query, sort, q, limit: 50, cursor });
      setMore(m => ({ rows: [...(m?.rows ?? []), ...page.rows], cursor: page.nextCursor }));
    } catch (err) { vendor.handleError(err); } finally { setLoadingMore(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented className="w-fit flex-wrap" value={sort} onChange={v => onSort(v as ProductSort)} options={PRODUCT_SORTS.map(s => [s, t(SORT_KEYS[s])])} />
        <Input type="search" value={search} onChange={e => setSearch(e.target.value)} maxLength={80} aria-label={t('vendor.reports.searchProducts')}
          placeholder={t('vendor.reports.searchProducts')} className="sm:max-w-xs" data-testid="products-search" />
      </div>
      <ViewState value={value} onRetry={retry}>
        {d => {
          const rows = [...d.rows, ...(more?.rows ?? [])];
          const next = more ? more.cursor : d.nextCursor;
          const cost = rows.some(r => 'profitTzs' in r);
          if (!rows.length && !q && sort !== 'slow') return <><HeaderLine head={d} view="products" /><NoSales from={d.from} to={d.to} onTryPeriod={onTryPeriod} /></>;
          const lastSold = (r: ProductRow) => (r.lastSoldAt ? dayShort(eatDayOf(r.lastSoldAt), locale) : t('vendor.reports.never'));
          const units = (r: ProductRow) => (r.noSalesInPeriod && sort === 'slow' ? t('vendor.reports.noSalesPeriod') : formatNumber(r.unitsSold));
          return (
            <>
              <HeaderLine head={d} view="products" />
              <div className="hidden md:block">
                <Table aria-label={t(SORT_KEYS[sort])} data-testid="products-table">
                  <THead>
                    <Tr>
                      <Th>{t('vendor.reports.product')}</Th>
                      <Th className="!text-right">{t('vendor.reports.unitsSold')}</Th>
                      <Th className="!text-right">{t('vendor.reports.revenue')}</Th>
                      <Th>{t('vendor.reports.lastSold')}</Th>
                      <Th className="!text-right">{t('vendor.reports.inStock')}</Th>
                      <Th className="min-w-24">{t('vendor.reports.cover')}</Th>
                      {cost && <Th className="!text-right">{t('vendor.reports.profit')}</Th>}
                    </Tr>
                  </THead>
                  <TBody>
                    {rows.map(r => (
                      <Tr key={`${r.productId}:${r.variant ?? ''}`} data-testid="product-row">
                        <Th scope="row" className="!font-medium [overflow-wrap:anywhere]">{productLabel(r, t)}</Th>
                        <Td className={numCell}>
                          {units(r)}
                          <span className="block text-xs text-[var(--color-fg-quaternary)]">{t('vendor.reports.channel.app')} {formatNumber(r.appUnits)} · {t('vendor.reports.channel.walkIn')} {formatNumber(r.walkInUnits)}</span>
                        </Td>
                        <Td className={numCell}>{money(r.netRevenueTzs)}</Td>
                        <Td className="whitespace-nowrap">{lastSold(r)}</Td>
                        <Td className={numCell}>{r.stock == null ? '—' : formatNumber(r.stock)}</Td>
                        <Td><CoverCell row={r} /></Td>
                        {cost && <Td className={numCell}>{r.profitTzs == null ? '—' : money(r.profitTzs)}</Td>}
                      </Tr>
                    ))}
                  </TBody>
                  {sort === 'revenue' && (
                    <tfoot>
                      <Tr data-testid="products-total-row">
                        <Th scope="row">{t('vendor.owed.totalRow')}</Th>
                        <Td className={numCell}>{formatNumber(d.totals.unitsSold)}</Td>
                        <Td className={numCell}>{money(d.totals.netRevenueTzs)}</Td>
                        <Td /><Td /><Td />{cost && <Td />}
                      </Tr>
                    </tfoot>
                  )}
                </Table>
              </div>
              <ul className="space-y-3 md:hidden" aria-label={t(SORT_KEYS[sort])}>
                {rows.map(r => (
                  <li key={`${r.productId}:${r.variant ?? ''}`}>
                    <Card><CardContent className="space-y-1 pt-4 text-sm">
                      <p className="font-semibold [overflow-wrap:anywhere]">{productLabel(r, t)}</p>
                      <p className="tabular-nums">{units(r)} · {money(r.netRevenueTzs)}</p>
                      <p className="text-[var(--color-fg-quaternary)]">{t('vendor.reports.lastSold')}: {lastSold(r)}</p>
                      <CoverCell row={r} />
                    </CardContent></Card>
                  </li>
                ))}
              </ul>
              {next && (
                <Button variant="secondary" className="min-h-11" onClick={() => loadMore(next)} disabled={loadingMore} aria-busy={loadingMore} data-testid="products-more">
                  {loadingMore && <Spinner className="h-4 w-4" />}{t('vendor.reports.loadMore')}
                </Button>
              )}
            </>
          );
        }}
      </ViewState>
    </div>
  );
}

type StockSort = 'value' | 'stock' | 'name';
const STOCK_SORTERS: Record<StockSort, (a: StockRow, b: StockRow) => number> = {
  value: (a, b) => b.valueAtRetailTzs - a.valueAtRetailTzs,
  stock: (a, b) => b.stock - a.stock,
  name: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.variant ?? '').localeCompare(String(b.variant ?? '')),
};

export function StockView() {
  const { t, locale } = useApp();
  const vendor = useVendor();
  const [value, retry] = useReport('stock', {});
  const [sort, setSort] = useState<StockSort>('value');
  const sortHeader = (key: StockSort, label: string, right = false) => (
    <Th aria-sort={sort === key ? (key === 'name' ? 'ascending' : 'descending') : 'none'} className={right ? '!text-right' : undefined}>
      <button type="button" className="inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline" onClick={() => setSort(key)}>{label}</button>
    </Th>
  );
  return (
    <ViewState value={value} onRetry={retry}>
      {(d: StockReport) => {
        const cost = d.totals.atCostTzs !== undefined;
        const rows = [...d.rows].sort(STOCK_SORTERS[sort]);
        return (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="stock-as-of">{fmt(t('vendor.reports.stock.asOf'), { time: clock12(d.asOf, locale) })}</p>
            <div className={figureGrid}>
              <Figure strong label={t('vendor.reports.stock.atRetail')} value={money(d.totals.atRetailTzs)} testId="stock-retail" />
              {cost && <Figure strong label={t('vendor.reports.stock.atCost')} value={money(d.totals.atCostTzs)} testId="stock-cost" />}
              <Figure label={t('vendor.reports.stock.units')} value={formatNumber(d.totals.units)} testId="stock-units" />
              <Figure label={t('vendor.reports.stock.products')} value={formatNumber(d.totals.products)} testId="stock-products" />
            </div>
            {cost && d.costUnknown && d.costUnknown.count > 0 && (
              <Alert tone="warning" className="!font-normal">
                <span data-testid="stock-cost-unknown">{fmt(t('vendor.reports.stock.costUnknown'), { n: d.costUnknown.count })}</span>
                {vendor.can('products') && <> <Link className="font-semibold underline underline-offset-4" href="/vendor/products/">{t('vendor.reports.addCost')}</Link></>}
              </Alert>
            )}
            <Table aria-label={t('vendor.reports.view.stock')} data-testid="stock-table">
              <THead>
                <Tr>
                  {sortHeader('name', t('vendor.reports.product'))}
                  <Th>{t('vendor.reports.variant')}</Th>
                  {sortHeader('stock', t('vendor.reports.inStock'), true)}
                  <Th className="!text-right">{t('vendor.reports.sellingPrice')}</Th>
                  {sortHeader('value', t('vendor.reports.stock.atRetail'), true)}
                  {cost && <Th className="!text-right">{t('vendor.reports.costPrice')}</Th>}
                  {cost && <Th className="!text-right">{t('vendor.reports.stock.atCost')}</Th>}
                </Tr>
              </THead>
              <TBody>
                {rows.map(r => (
                  <Tr key={`${r.productId}:${r.variant ?? ''}`} data-testid="stock-row">
                    <Th scope="row" className="!font-medium [overflow-wrap:anywhere]">{r.name || '—'}</Th>
                    <Td>{r.variant ?? '—'}</Td>
                    <Td className={numCell}>{formatNumber(r.stock)}</Td>
                    <Td className={numCell}>{money(r.priceTzs)}</Td>
                    <Td className={numCell}>{money(r.valueAtRetailTzs)}</Td>
                    {cost && <Td className={numCell}>{r.costTzs == null ? <Badge tone="warning">{t('vendor.reports.unknown')}</Badge> : money(r.costTzs)}</Td>}
                    {cost && <Td className={numCell}>{r.valueAtCostTzs == null ? '—' : money(r.valueAtCostTzs)}</Td>}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        );
      }}
    </ViewState>
  );
}

export function ProfitView({ query, onTryPeriod, onWalkIn }: ViewProps) {
  const { t, locale } = useApp();
  const vendor = useVendor();
  const [value, retry] = useReport('profit', query);
  useWalkInSeen(value, onWalkIn);
  const content = useMemo(() => (d: ProfitReport) => {
    const s = d.totals;
    const empty = !s.netExVatTzs && !s.costTzs && !d.uncosted.qty && !d.uncosted.revenueTzs;
    return (
      <div className="space-y-4">
        <HeaderLine head={d} view="profit" />
        {empty ? <NoSales from={d.from} to={d.to} onTryPeriod={onTryPeriod} /> : (
          <>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-5" data-testid="profit-strip">
              <Figure label={t('vendor.reports.netExVat')} value={money(s.netExVatTzs)} testId="profit-net" />
              <Figure label={t('vendor.reports.commission')} value={minus(s.commissionTzs)} testId="profit-commission" />
              <Figure label={t('vendor.reports.cogs')} value={minus(s.costTzs)} testId="profit-cost" />
              <Figure strong label={t('vendor.reports.profit')} value={money(s.profitTzs)} sub={t('vendor.reports.profitHint')} testId="profit-profit" />
              <Figure label={t('vendor.reports.margin')} value={pct(s.marginPct)} testId="profit-margin" />
            </div>
            {d.hasVat && <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="profit-novat">{t('vendor.reports.profit.noVat')}</p>}
            {d.uncosted.qty > 0 && (
              <Alert tone="warning" className="!font-normal">
                <span data-testid="profit-uncosted">{fmt(t('vendor.reports.profit.uncosted'), { n: formatNumber(d.uncosted.qty), amount: money(d.uncosted.revenueTzs) })}</span>
                {vendor.can('products') && <> <Link className="font-semibold underline underline-offset-4" href="/vendor/products/">{t('vendor.reports.addCost')}</Link></>}
              </Alert>
            )}
            <Card><CardContent className="pt-6">
              <ReportBarChart rows={d.buckets.map(b => ({ start: b.start, end: b.end, value: b.profitTzs }))} groupBy={d.groupBy} from={d.from} to={d.to} figureKey="vendor.reports.profit" twoSeries={false} testId="profit-chart" />
            </CardContent></Card>
            <Table aria-label={t('vendor.reports.profit.byPeriod')} data-testid="profit-table">
              <THead>
                <Tr>
                  <Th>{t('vendor.reports.period')}</Th>
                  <Th className="!text-right">{t('vendor.reports.netExVat')}</Th>
                  <Th className="!text-right">{t('vendor.reports.commission')}</Th>
                  <Th className="!text-right">{t('vendor.reports.cogs')}</Th>
                  <Th className="!text-right">{t('vendor.reports.profit')}</Th>
                  <Th className="!text-right">{t('vendor.reports.margin')}</Th>
                  <Th className="!text-right">{t('vendor.reports.uncostedSales')}</Th>
                </Tr>
              </THead>
              <TBody>
                {d.buckets.map(b => (
                  <Tr key={b.start}>
                    <Th scope="row" className="!font-normal whitespace-nowrap">{bucketWords(b.start, b.end, d.groupBy, locale)}</Th>
                    <Td className={numCell}>{money(b.netExVatTzs)}</Td>
                    <Td className={numCell}>{minus(b.commissionTzs)}</Td>
                    <Td className={numCell}>{minus(b.costTzs)}</Td>
                    <Td className={`${numCell} font-semibold`}>{money(b.profitTzs)}</Td>
                    <Td className={numCell}>{pct(b.marginPct)}</Td>
                    <Td className={numCell}>{money(b.uncostedRevenueTzs)}</Td>
                  </Tr>
                ))}
              </TBody>
              <tfoot>
                <Tr>
                  <Th scope="row">{t('vendor.owed.totalRow')}</Th>
                  <Td className={numCell}>{money(s.netExVatTzs)}</Td>
                  <Td className={numCell}>{minus(s.commissionTzs)}</Td>
                  <Td className={numCell}>{minus(s.costTzs)}</Td>
                  <Td className={`${numCell} font-semibold`}>{money(s.profitTzs)}</Td>
                  <Td className={numCell}>{pct(s.marginPct)}</Td>
                  <Td className={numCell}>{money(d.uncosted.revenueTzs)}</Td>
                </Tr>
              </tfoot>
            </Table>
            <Card>
              <CardHeader><h3 className="text-base font-semibold">{t('vendor.reports.profit.byProduct')}</h3></CardHeader>
              <CardContent className="space-y-4">
                <Table aria-label={t('vendor.reports.profit.byProduct')} data-testid="profit-products">
                  <THead>
                    <Tr>
                      <Th>{t('vendor.reports.product')}</Th>
                      <Th className="!text-right">{t('vendor.reports.unitsSold')}</Th>
                      <Th className="!text-right">{t('vendor.reports.netExVat')}</Th>
                      <Th className="!text-right">{t('vendor.reports.cogs')}</Th>
                      <Th className="!text-right">{t('vendor.reports.profit')}</Th>
                      <Th className="!text-right">{t('vendor.reports.margin')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {d.byProduct.map(p => (
                      <Tr key={`${p.productId}:${p.variant ?? ''}`}>
                        <Th scope="row" className="!font-medium [overflow-wrap:anywhere]">{productLabel(p, t)}</Th>
                        <Td className={numCell}>{formatNumber(p.units)}</Td>
                        <Td className={numCell}>{money(p.netExVatTzs)}</Td>
                        <Td className={numCell}>{minus(p.costTzs)}</Td>
                        <Td className={numCell}>{money(p.profitTzs)}</Td>
                        <Td className={numCell}>{pct(p.marginPct)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                {d.uncostedProducts.length > 0 && (
                  <div data-testid="profit-nocost">
                    <h4 className="mb-2 text-sm font-semibold">{t('vendor.reports.profit.noCostHeading')}</h4>
                    <ul className="space-y-1 text-sm">
                      {d.uncostedProducts.map(p => (
                        <li key={`${p.productId}:${p.variant ?? ''}`} className="flex justify-between gap-3">
                          <span className="[overflow-wrap:anywhere]">{productLabel(p, t)} · {fmt(t('vendor.reports.unitsN'), { n: formatNumber(p.units) })}</span>
                          <span className="tabular-nums">{money(p.revenueTzs)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  }, [t, locale, vendor, onTryPeriod]);
  return <ViewState value={value} onRetry={retry}>{content}</ViewState>;
}

