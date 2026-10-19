'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, History, SlidersHorizontal } from 'lucide-react';
import { api, type LowStockRow, type StockMovement, type StockMovementPage, type VendorProduct } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { addDays, eatDateTime, eatToday, errorCode, fmt, lowKey, PRODUCTS_QS_KEY, shortRefOf, variantsOf } from '@/lib/vendor';
import { Alert, Badge, Button, Card, CardContent, EmptyState, ErrorState, Field, Input, PageHeader, Segmented, Select, SkeletonCard, SkeletonTable, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { AdjustStockDialog } from '@/components/vendor/adjust-stock-dialog';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../providers';

const KNOWN_REASONS = new Set(['count', 'restock', 'returned', 'found', 'damaged', 'expired', 'lost', 'other', 'reserve', 'release']);
type Range = '7d' | '30d' | 'custom';

function HistoryInner() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const ledger = vendor.me?.tools.stockLedger === true;

  const [product, setProduct] = useState<VendorProduct | null>(null);
  const [productState, setProductState] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  const [low, setLow] = useState<LowStockRow[]>([]);
  const [variant, setVariant] = useState(params.get('variant') ?? '');
  const today = eatToday();
  const [range, setRange] = useState<Range>('30d');
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [page, setPage] = useState<StockMovementPage | null>(null);
  const [rows, setRows] = useState<StockMovement[]>([]);
  const [rowsState, setRowsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [backQs, setBackQs] = useState('');

  useEffect(() => { try { setBackQs(sessionStorage.getItem(PRODUCTS_QS_KEY) ?? ''); } catch { /* storage off */ } }, []);
  // No stock ledger, no history: back to the list.
  useEffect(() => { if (vendor.me && !ledger) router.replace('/vendor/products/'); }, [vendor.me, ledger, router]);

  const loadProduct = useCallback(async () => {
    if (!token || !id) { setProductState('notFound'); return; }
    setProductState('loading');
    try {
      const all = await api.vendorProducts(token);
      const found = all.find(p => p.id === id) ?? null;
      setProduct(found);
      setProductState(found ? 'ready' : 'notFound');
      api.vendorLowStock(token).then(r => setLow(Array.isArray(r) ? r : [])).catch(() => setLow([]));
    } catch (err) {
      if (!vendor.handleError(err)) setProductState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);
  useEffect(() => { void loadProduct(); }, [loadProduct]);

  const span = useMemo(() => (range === '7d' ? { from: addDays(today, -6), to: today } : range === '30d' ? { from: addDays(today, -29), to: today } : { from, to }), [range, from, to, today]);

  const loadRows = useCallback(async (cursor?: string) => {
    if (!token || !id || !ledger) return;
    if (cursor) { setMoreBusy(true); setMoreFailed(false); } else setRowsState('loading');
    try {
      const res = await api.vendorStockMovements(token, id, { from: span.from || undefined, to: span.to || undefined, variant: variant || undefined, limit: 50, cursor });
      setPage(res);
      setRows(current => (cursor ? [...current, ...res.rows] : res.rows));
      setRowsState('ready');
    } catch (err) {
      if (vendor.handleError(err)) return;
      if (errorCode(err) === 'product_not_found' || errorCode(err) === 'not_your_product') { setProductState('notFound'); return; }
      if (cursor) setMoreFailed(true); else setRowsState('error');
    } finally {
      setMoreBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, ledger, span.from, span.to, variant]);
  useEffect(() => { void loadRows(); }, [loadRows]);

  const backHref = `/vendor/products/${backQs ? `?${backQs}` : ''}`;
  const back = (
    <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-700)] hover:underline">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.products.back')}
    </Link>
  );

  if (productState === 'loading') return <div className="space-y-4" aria-busy="true">{back}<SkeletonCard /><SkeletonTable rows={5} columns={6} /></div>;
  if (productState === 'error') return <div className="space-y-4">{back}<ErrorState title={t('vendor.stock.historyFailed')} onRetry={loadProduct} retryLabel={t('common.tryAgain')} /></div>;
  if (productState === 'notFound' || !product) {
    return <div className="space-y-4">{back}<ErrorState title={t('vendor.stock.notFound')} /></div>;
  }

  const vs = variantsOf(product);
  const lowSet = new Set(low.map(r => lowKey(r.productId, r.variant)));
  const selected = variant ? vs.find(v => v.name === variant) : null;
  const currentStock = selected ? selected.stock : product.stock;
  const reorder = selected ? (selected.effectiveReorderLevel ?? selected.reorderLevel) : product.reorderLevel;
  const isLow = variant ? lowSet.has(lowKey(product.id, variant)) : (lowSet.has(lowKey(product.id, null)) || vs.some(v => lowSet.has(lowKey(product.id, v.name))));
  const canOrders = vendor.can('orders');

  const reasonText = (r: StockMovement) => t((KNOWN_REASONS.has(r.reason) ? `vendor.stock.reason.${r.reason}` : 'vendor.stock.reason.unknown') as MessageKey);
  const delta = (d: number) => (d > 0
    ? <span className="font-semibold tabular-nums text-[var(--color-success-700)]" aria-label={fmt(t('vendor.stock.deltaIn'), { n: d })}>+{d}</span>
    : <span className="font-semibold tabular-nums text-[var(--color-fg-primary)]" aria-label={fmt(t('vendor.stock.deltaOut'), { n: Math.abs(d) })}>−{Math.abs(d)}</span>);
  const actor = (r: StockMovement) => (r.actor ? fmt(t('vendor.stock.by'), { name: r.actor.name || '—' }) : t('vendor.stock.bySystem'));
  const note = (r: StockMovement) => (r.note === 'product_form' ? t('vendor.stock.fromProductForm') : r.note);
  const orderRef = (r: StockMovement) => {
    if (r.document?.type !== 'order') return null;
    const label = fmt(t('vendor.stock.order'), { ref: r.document.number || shortRefOf(r.document.id) });
    return canOrders
      ? <Link href={`/vendor/orders/?id=${encodeURIComponent(r.document.id)}`} className="font-medium text-[var(--color-brand-700)] underline-offset-4 hover:underline">{label}</Link>
      : <span>{label}</span>;
  };

  return (
    <div className="space-y-5">
      {back}
      <PageHeader title={t('vendor.stock.history')} description={variant ? `${product.name} · ${variant}` : product.name} />

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.stock.current')}</p>
              <p className="text-2xl font-semibold tabular-nums" data-testid="history-current">{currentStock ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.stock.reorderLevel')}</p>
              <p className="text-lg font-semibold tabular-nums">{reorder ?? '—'}</p>
            </div>
            {isLow && <Badge tone="warning">{t('vendor.stock.lowBadge')}</Badge>}
          </div>
          <Button onClick={() => setAdjustOpen(true)} className="min-h-11 max-sm:w-full" data-testid="history-adjust">
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />{t('vendor.stock.adjust')}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <Segmented
          className="w-fit flex-wrap"
          value={range}
          onChange={v => setRange(v as Range)}
          options={[['7d', t('vendor.stock.range.7d')], ['30d', t('vendor.stock.range.30d')], ['custom', t('vendor.stock.range.custom')]]}
        />
        {range === 'custom' && (
          <div className="flex flex-wrap gap-3">
            <Field label={t('vendor.stock.from')}><Input type="date" value={from} max={to || today} onChange={e => setFrom(e.target.value)} /></Field>
            <Field label={t('vendor.stock.to')}><Input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} /></Field>
          </div>
        )}
        {vs.length > 0 && (
          <Field label={t('vendor.stock.variantLabel')}>
            <Select value={variant} onChange={e => setVariant(e.target.value)} data-testid="history-variant">
              <option value="">{t('vendor.stock.allVariants')}</option>
              {vs.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
            </Select>
          </Field>
        )}
      </div>

      {rowsState === 'loading' && <div aria-busy="true" aria-label={t('vendor.stock.loading')}><SkeletonTable rows={5} columns={6} /></div>}
      {rowsState === 'error' && <ErrorState title={t('vendor.stock.historyFailed')} onRetry={() => loadRows()} retryLabel={t('common.tryAgain')} />}
      {rowsState === 'ready' && page && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.stock.opening')}</p><p className="text-xl font-semibold tabular-nums" data-testid="history-opening">{page.openingStock}</p></CardContent></Card>
            <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.stock.closing')}</p><p className="text-xl font-semibold tabular-nums" data-testid="history-closing">{page.closingStock}</p></CardContent></Card>
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={<History />} title={t('vendor.stock.historyEmpty')}
              action={<Button variant="secondary" size="sm" onClick={() => setAdjustOpen(true)}>{t('vendor.stock.adjust')}</Button>} />
          ) : (
            <>
              <div className="hidden md:block">
                <Table aria-label={t('vendor.stock.history')} data-testid="history-table">
                  <THead>
                    <Tr>
                      <Th>{t('vendor.stock.colTime')}</Th>
                      <Th>{t('vendor.stock.colReason')}</Th>
                      <Th className="!text-right">{t('vendor.stock.colChange')}</Th>
                      <Th className="!text-right">{t('vendor.stock.colBeforeAfter')}</Th>
                      <Th>{t('vendor.stock.colBy')}</Th>
                      <Th>{t('vendor.stock.colNote')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {rows.map(r => (
                      <Tr key={r.id} data-testid={`movement-${r.id}`}>
                        <Td className="whitespace-nowrap">{eatDateTime(r.createdAt, locale)}</Td>
                        <Td>
                          <div>{reasonText(r)}{r.variant && !variant ? ` · ${r.variant}` : ''}</div>
                          {orderRef(r) && <div className="text-sm">{orderRef(r)}</div>}
                        </Td>
                        <Td className="text-right">{delta(r.delta)}</Td>
                        <Td className="whitespace-nowrap text-right tabular-nums">{r.stockBefore ?? '—'} → {r.stockAfter ?? '—'}</Td>
                        <Td>{actor(r)}</Td>
                        <Td className="max-w-xs whitespace-pre-line [overflow-wrap:anywhere]">{note(r) ?? ''}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
              <ul className="space-y-3 md:hidden" aria-label={t('vendor.stock.history')}>
                {rows.map(r => (
                  <li key={r.id}>
                    <Card className="space-y-1 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{reasonText(r)}{r.variant && !variant ? ` · ${r.variant}` : ''}</p>
                        {delta(r.delta)}
                      </div>
                      <p className="text-sm text-[var(--color-fg-tertiary)]">
                        <span className="tabular-nums">{r.stockBefore ?? '—'} → {r.stockAfter ?? '—'}</span> · {eatDateTime(r.createdAt, locale)} · {actor(r)}
                      </p>
                      {note(r) && <p className="whitespace-pre-line text-sm [overflow-wrap:anywhere]">{note(r)}</p>}
                      {orderRef(r) && <p className="text-sm">{orderRef(r)}</p>}
                    </Card>
                  </li>
                ))}
              </ul>
              {moreFailed && <Alert tone="error">{t('vendor.stock.historyFailed')}</Alert>}
              {page.nextCursor && (
                <div className="flex justify-center">
                  <Button variant="secondary" onClick={() => loadRows(page.nextCursor!)} disabled={moreBusy} className="min-h-11" data-testid="history-load-more">
                    {moreBusy && <Spinner className="h-4 w-4" />}{moreFailed ? t('common.tryAgain') : t('vendor.stock.loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {adjustOpen && (
        <AdjustStockDialog
          open
          product={product}
          initialVariant={variant || null}
          onClose={() => setAdjustOpen(false)}
          onSaved={stock => {
            setProduct(p => p && ({ ...p, stock: stock.stock, variants: variantsOf(p).map(v => ({ ...v, stock: stock.variants.find(s => s.name === v.name)?.stock ?? v.stock })) }));
            void loadRows();
            if (token) api.vendorLowStock(token).then(r => setLow(Array.isArray(r) ? r : [])).catch(() => {});
          }}
          onGone={loadProduct}
        />
      )}
    </div>
  );
}

/** One product's stock history (?id=<productId>&variant=<name>). */
export default function StockHistoryPage() {
  return <Suspense fallback={null}><HistoryInner /></Suspense>;
}
