'use client';
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight, History, PackageOpen, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { api, type LowStockRow, type ProductStock, type VendorProduct } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { categoryLabel, fmt, lowKey, PRODUCTS_QS_KEY, tracksVariantStock, variantsOf, type Category } from '@/lib/vendor';
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Segmented, Select, SkeletonCard, SkeletonTable, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { AdjustStockDialog } from '@/components/vendor/adjust-stock-dialog';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../providers';

const STATUSES = ['all', 'active', 'paused', 'archived', 'pending', 'rejected'] as const;
type StatusFilter = typeof STATUSES[number];

function statusBadge(p: VendorProduct, t: (k: MessageKey) => string) {
  if (p.approvalStatus === 'pending') return <Badge tone="warning">{t('vendor.products.pendingApproval')}</Badge>;
  if (p.approvalStatus === 'rejected') return <Badge tone="danger">{t('vendor.products.rejected')}</Badge>;
  if (p.status === 'active') return <Badge tone="success">{t('vendor.products.status.active')}</Badge>;
  return <Badge tone="gray">{t(p.status === 'paused' ? 'vendor.products.status.paused' : 'vendor.products.status.archived')}</Badge>;
}
const matchesStatus = (p: VendorProduct, s: StatusFilter) =>
  s === 'all' ? true : s === 'pending' || s === 'rejected' ? p.approvalStatus === s : p.status === s && p.approvalStatus !== 'pending' && p.approvalStatus !== 'rejected';

function ProductsInner() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ledger = vendor.me?.tools.stockLedger === true;
  const canSeeCost = vendor.me?.tools.canSeeCost === true;

  const [rows, setRows] = useState<VendorProduct[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [low, setLow] = useState<LowStockRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adjust, setAdjust] = useState<{ product: VendorProduct; variant: string | null } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => { api.shopCategories().then(r => setCategories(Array.isArray(r?.categories) ? r.categories : [])).catch(() => setCategories([])); }, []);

  const filterParam = params.get('filter');
  const q = params.get('q') ?? '';
  const statusParam = params.get('status') as StatusFilter | null;
  const status: StatusFilter = statusParam && (STATUSES as readonly string[]).includes(statusParam) ? statusParam : 'all';

  useEffect(() => { try { sessionStorage.setItem(PRODUCTS_QS_KEY, params.toString()); } catch { /* storage off */ } }, [params]);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const load = useCallback(async () => {
    if (!token) return;
    setFailed(false);
    try {
      setRows(await api.vendorProducts(token));
    } catch (err) {
      if (!vendor.handleError(err)) setFailed(true);
      setRows(r => r ?? []);
    }
    if (ledger) {
      api.vendorLowStock(token).then(r => setLow(Array.isArray(r) ? r : [])).catch(err => { vendor.handleError(err); setLow([]); });
    } else setLow([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ledger]);
  useEffect(() => { void load(); }, [load]);

  const lowSet = useMemo(() => new Set(low.map(r => lowKey(r.productId, r.variant))), [low]);
  const isLow = (p: VendorProduct) => lowSet.has(lowKey(p.id, null)) || variantsOf(p).some(v => lowSet.has(lowKey(p.id, v.name)));
  const lowProducts = (rows ?? []).filter(isLow);
  const showCost = canSeeCost && (rows ?? []).some(r => 'costTzs' in r);
  // S6 UAT D7: products without a cost price (client-side; Reports links here from "Add cost prices"). Only for
  // people who see cost; a variant without its own cost uses the product's (as the stock value report does).
  const noCost = (p: VendorProduct) => {
    const vs = variantsOf(p);
    return vs.length ? vs.some(v => (v.effectiveCostTzs ?? v.costTzs ?? p.costTzs) == null) : p.costTzs == null;
  };
  const noCostProducts = showCost ? (rows ?? []).filter(noCost) : [];
  // While the list loads, keep the asked-for filter (showCost is not known yet); a person who can't see cost gets all.
  const filter: 'all' | 'low' | 'noCost' = filterParam === 'low' && ledger ? 'low'
    : filterParam === 'noCost' && canSeeCost && (rows === null || showCost) ? 'noCost' : 'all';

  const shown = (rows ?? []).filter(p =>
    (filter !== 'low' || isLow(p))
    && (filter !== 'noCost' || noCost(p))
    && matchesStatus(p, status)
    && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));

  /** A refused change told us the real stock: show it on the row (the variant's, or the product's). */
  function applyKnownStock(productId: string, variant: string | null, stock: number) {
    setRows(current => (current ?? []).map(p => {
      if (p.id !== productId) return p;
      if (!variant) return { ...p, stock };
      const vs = variantsOf(p).map(v => (v.name === variant ? { ...v, stock } : v));
      const total = vs.every(v => typeof v.stock === 'number') ? vs.reduce((n, v) => n + Number(v.stock), 0) : p.stock;
      return { ...p, stock: total, variants: vs };
    }));
    // The Low stock badge follows the new number: low when at or below the reorder level (a variant
    // without its own level uses the product's, as on the server).
    const product = (rows ?? []).find(p => p.id === productId);
    if (!product) return;
    const v = variant ? variantsOf(product).find(x => x.name === variant) : null;
    const reorder = variant ? (v?.effectiveReorderLevel ?? v?.reorderLevel ?? product.reorderLevel ?? null) : (product.reorderLevel ?? null);
    setLow(current => {
      const rest = current.filter(r => !(r.productId === productId && (r.variant ?? null) === (variant ?? null)));
      return reorder != null && stock <= reorder
        ? [...rest, { productId, name: product.name, variant: variant ?? null, stock, reorderLevel: reorder }]
        : rest;
    });
  }

  function applyStock(stock: ProductStock) {
    setRows(current => (current ?? []).map(p => p.id !== stock.id ? p : {
      ...p, stock: stock.stock,
      variants: variantsOf(p).map(v => ({ ...v, stock: stock.variants.find(s => s.name === v.name)?.stock ?? v.stock })),
    }));
    if (token && ledger) api.vendorLowStock(token).then(r => setLow(Array.isArray(r) ? r : [])).catch(() => {});
  }

  const price = (p: VendorProduct) => {
    const discounted = p.discountPriceTzs != null && p.discountPriceTzs > 0 && p.discountPriceTzs < p.priceTzs;
    if (!discounted) return <span className="tabular-nums">{money(p.priceTzs)}</span>;
    return (
      <span className="tabular-nums" aria-label={fmt(t('vendor.products.wasNow'), { old: money(p.priceTzs), new: money(p.discountPriceTzs) })}>
        <span aria-hidden="true">{money(p.discountPriceTzs)} <s className="text-xs text-[var(--color-fg-quaternary)]">{money(p.priceTzs)}</s></span>
      </span>
    );
  };
  const stockText = (p: VendorProduct) => tracksVariantStock(p)
    ? fmt(t('vendor.products.stockAcross'), { n: p.stock, m: variantsOf(p).length })
    : String(p.stock ?? 0);
  const dash = (v: number | null | undefined, asMoney = false) => (v == null ? '—' : asMoney ? money(v) : String(v));
  const historyHref = (p: VendorProduct, variant?: string | null) =>
    `/vendor/products/history/?id=${encodeURIComponent(p.id)}${variant ? `&variant=${encodeURIComponent(variant)}` : ''}`;
  const linkBtn = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-3.5 text-sm font-semibold text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]';
  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const actions = (p: VendorProduct, variant: string | null = null) => ledger ? (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" className="min-h-11 max-md:flex-1" aria-label={fmt(t('vendor.stock.adjustFor'), { name: variant ? `${p.name} · ${variant}` : p.name })}
        onClick={() => setAdjust({ product: p, variant })} data-testid={`adjust-${p.id}${variant ? `-${variant}` : ''}`}>
        <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />{t('vendor.stock.adjust')}
      </Button>
      {!variant && (
        <Link href={historyHref(p)} className={`${linkBtn} max-md:flex-1`} aria-label={fmt(t('vendor.stock.historyFor'), { name: p.name })} data-testid={`history-${p.id}`}>
          <History aria-hidden="true" className="h-4 w-4" />{t('vendor.stock.historyShort')}
        </Link>
      )}
    </div>
  ) : null;

  const body = () => {
    if (rows == null) return (<div aria-busy="true"><SkeletonTable rows={6} columns={6} className="hidden md:block" /><div className="space-y-3 md:hidden"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div></div>);
    if (failed) return <ErrorState title={t('vendor.products.failed')} onRetry={load} retryLabel={t('common.tryAgain')} />;
    if (rows.length === 0) return <EmptyState icon={<PackageOpen />} title={t('vendor.products.empty')} body={t('vendor.products.emptyBody')} />;
    if (shown.length === 0) {
      if (filter === 'low' && !q && status === 'all') return <EmptyState title={t('vendor.stock.lowEmpty')} action={<Button variant="secondary" size="sm" onClick={() => setParam({ filter: null })}>{t('vendor.stock.all')}</Button>} />;
      if (filter === 'noCost' && !q && status === 'all') return <EmptyState title={t('vendor.products.noCostEmpty')} action={<Button variant="secondary" size="sm" onClick={() => setParam({ filter: null })}>{t('vendor.stock.all')}</Button>} />;
      return <EmptyState title={t('vendor.products.noMatch')} action={<Button variant="secondary" size="sm" onClick={() => setParam({ filter: null, q: null, status: null })}>{t('vendor.products.clearFilters')}</Button>} />;
    }
    return (
      <>
        {/* Desktop and tablet: a table */}
        <div className="hidden md:block">
          <Table aria-label={t('vendor.nav.products')} data-testid="vendor-products-table">
            <THead>
              <Tr>
                <Th>{t('vendor.products.colProduct')}</Th>
                <Th className="!text-right">{t('vendor.products.colPrice')}</Th>
                <Th className="!text-right">{t('vendor.products.colStock')}</Th>
                {ledger && <Th className="!text-right">{t('vendor.stock.reorderLevel')}</Th>}
                {showCost && <Th className="!text-right" data-testid="cost-column">{t('vendor.costPrice')}</Th>}
                <Th>{t('vendor.products.colStatus')}</Th>
                {ledger && <Th>{t('vendor.products.colActions')}</Th>}
              </Tr>
            </THead>
            <TBody>
              {shown.map(p => {
                const vs = variantsOf(p);
                const open = expanded.has(p.id);
                return (
                  <Fragment key={p.id}>
                    <Tr data-testid={`product-row-${p.id}`}>
                      <Td>
                        <div className="flex items-center gap-3">
                          {vs.length > 0 ? (
                            <button type="button" onClick={() => toggle(p.id)} aria-expanded={open}
                              aria-label={fmt(t('vendor.products.showVariants'), { name: p.name })}
                              className="-m-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]">
                              {open ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
                            </button>
                          ) : <span className="w-9 shrink-0" />}
                          {p.images?.[0]
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={p.images[0]} alt="" className="h-10 w-10 shrink-0 rounded-[var(--radius-md)] object-cover bg-[var(--color-bg-tertiary)]" />
                            : <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-[var(--radius-md)] bg-[var(--color-bg-tertiary)]" />}
                          <div className="min-w-0">
                            <p className="font-medium text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{p.name}</p>
                            <p className="text-xs text-[var(--color-fg-quaternary)]">
                              {[categoryLabel(p.category, categories, locale), vs.length ? fmt(t('vendor.products.variantsCount'), { n: vs.length }) : null].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap text-right">{price(p)}</Td>
                      <Td className="text-right">
                        <span className="tabular-nums">{stockText(p)}</span>
                        {isLow(p) && <div className="mt-1"><Badge tone="warning">{t('vendor.stock.lowBadge')}</Badge></div>}
                      </Td>
                      {ledger && <Td className="text-right tabular-nums">{dash(p.reorderLevel)}</Td>}
                      {showCost && <Td className="whitespace-nowrap text-right tabular-nums">{dash(p.costTzs, true)}</Td>}
                      <Td>{statusBadge(p, t)}</Td>
                      {ledger && <Td>{actions(p)}</Td>}
                    </Tr>
                    {open && vs.map(v => (
                      <Tr key={`${p.id}-${v.name}`} className="bg-[var(--color-bg-secondary)]" data-testid={`variant-row-${p.id}-${v.name}`}>
                        <Td><span className="pl-24 text-sm text-[var(--color-fg-secondary)]">{v.name}</span></Td>
                        <Td />
                        <Td className="text-right">
                          <span className="tabular-nums">{dash(v.stock)}</span>
                          {lowSet.has(lowKey(p.id, v.name)) && <div className="mt-1"><Badge tone="warning">{t('vendor.stock.lowBadge')}</Badge></div>}
                        </Td>
                        {ledger && <Td className="text-right tabular-nums">{dash(v.effectiveReorderLevel ?? v.reorderLevel)}</Td>}
                        {showCost && <Td className="whitespace-nowrap text-right tabular-nums">{dash(v.effectiveCostTzs ?? v.costTzs, true)}</Td>}
                        <Td />
                        {ledger && <Td>{typeof v.stock === 'number' ? actions(p, v.name) : null}</Td>}
                      </Tr>
                    ))}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        </div>

        {/* Phones: cards */}
        <ul className="space-y-3 md:hidden" aria-label={t('vendor.nav.products')}>
          {shown.map(p => (
            <li key={p.id}>
              <Card className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{p.name}</p>
                  {statusBadge(p, t)}
                </div>
                <p className="text-sm">{price(p)}</p>
                <p className="text-sm text-[var(--color-fg-secondary)]">
                  {t('vendor.products.colStock')}: <span className="tabular-nums">{stockText(p)}</span>
                  {isLow(p) && <span className="ml-2"><Badge tone="warning">{t('vendor.stock.lowBadge')}</Badge></span>}
                </p>
                {(ledger || showCost) && (
                  <p className="text-xs text-[var(--color-fg-tertiary)]">
                    {[ledger ? `${t('vendor.stock.reorderLevel')}: ${dash(p.reorderLevel)}` : null, showCost ? `${t('vendor.costPrice')}: ${dash(p.costTzs, true)}` : null].filter(Boolean).join(' · ')}
                  </p>
                )}
                {variantsOf(p).length > 0 && (
                  <ul className="space-y-1 border-t border-[var(--color-border-secondary)] pt-2 text-sm">
                    {variantsOf(p).map(v => (
                      <li key={v.name} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{v.name} · <span className="tabular-nums">{dash(v.stock)}</span>
                          {lowSet.has(lowKey(p.id, v.name)) && <span className="ml-2"><Badge tone="warning">{t('vendor.stock.lowBadge')}</Badge></span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {actions(p)}
              </Card>
            </li>
          ))}
        </ul>
      </>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('vendor.nav.products')}
        description={t('vendor.products.description')}
        actions={<Button variant="secondary" size="sm" className="min-h-11" onClick={load}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('admin.action.refresh')}</Button>}
      />
      <p className="-mt-3 text-sm text-[var(--color-fg-tertiary)]">{t('vendor.products.editInApp')}</p>

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <Input
          type="search"
          aria-label={t('vendor.products.search')}
          placeholder={t('vendor.products.search')}
          value={q}
          onChange={e => setParam({ q: e.target.value || null })}
          className="md:max-w-xs"
          data-testid="products-search"
        />
        <Select aria-label={t('vendor.products.statusFilter')} value={status} onChange={e => setParam({ status: e.target.value === 'all' ? null : e.target.value })} className="md:max-w-[14rem]" data-testid="products-status">
          <option value="all">{t('vendor.products.status.all')}</option>
          <option value="active">{t('vendor.products.status.active')}</option>
          <option value="paused">{t('vendor.products.status.paused')}</option>
          <option value="archived">{t('vendor.products.status.archived')}</option>
          <option value="pending">{t('vendor.products.pendingApproval')}</option>
          <option value="rejected">{t('vendor.products.rejected')}</option>
        </Select>
        {(ledger || showCost) && (
          <Segmented
            className="w-fit flex-wrap"
            value={filter}
            onChange={v => setParam({ filter: v === 'all' ? null : v })}
            options={[
              ['all', t('vendor.stock.all')],
              ...(ledger ? [['low', fmt(t('vendor.stock.lowFilter'), { n: lowProducts.length })] as [string, string]] : []),
              ...(showCost ? [['noCost', fmt(t('vendor.products.noCostFilter'), { n: noCostProducts.length })] as [string, string]] : []),
            ]}
          />
        )}
      </div>

      {body()}

      {adjust && (
        <AdjustStockDialog
          open
          product={adjust.product}
          initialVariant={adjust.variant}
          onClose={() => setAdjust(null)}
          onSaved={applyStock}
          onGone={load}
          onStockKnown={(variant, stock) => applyKnownStock(adjust.product.id, variant, stock)}
        />
      )}
    </div>
  );
}

/** Vendor (or staff with `products`): products, stock and the stock tools. Adding and editing stay in the app. */
export default function VendorProductsPage() {
  return <Suspense fallback={null}><ProductsInner /></Suspense>;
}
