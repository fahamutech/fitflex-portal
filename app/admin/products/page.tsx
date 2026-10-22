'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Calculator, ChevronDown, ChevronRight, Plus, RefreshCw, Save } from 'lucide-react';
import { useApp } from '../../providers';
import { AdminProductFilters, api, AdminProductDraft, ApiError, PRODUCT_AGE_BANDS, ProductAgeBand, ProductStats, ProductStatsRecompute, ShopProduct, VendorSummary } from '@/lib/api';
import { formatDateTime, formatNumber, money } from '@/lib/admin-utils';
import { variantsOf } from '@/lib/vendor';
import { Alert, Badge, Button, Card, CardContent, Checkbox, Field, Input, PageHeader, Select, Spinner, Table, TBody, Td, Textarea, Th, THead, Tr } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';

/** Cost and reorder level as typed: '' clears (sent as null). */
type PrivateDraft = { cost: string; reorder: string; variants: Record<string, { cost: string; reorder: string }> };
const asText = (v: number | null | undefined) => (v == null ? '' : String(v));
const parseWhole = (text: string): number | null | 'invalid' => {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : 'invalid';
};
/** The ledger is on when the server sends the private keys at all. */
const hasPrivate = (p: ShopProduct) => 'costTzs' in p || 'reorderLevel' in p;
function draftOf(p: ShopProduct): PrivateDraft {
  return {
    cost: asText(p.costTzs), reorder: asText(p.reorderLevel),
    variants: Object.fromEntries(variantsOf(p).map(v => [v.name, { cost: asText(v.costTzs), reorder: asText(v.reorderLevel) }])),
  };
}

/** Shop personalisation (S2): the server sends the target keys at all only when it knows them. */
const hasTargets = (p: ShopProduct) => 'targetGender' in p || 'targetAgeBands' in p;
const BAND_KEY = { '18_29': 'products.target.band.18_29', '30_44': 'products.target.band.30_44', '45_59': 'products.target.band.45_59', '60_plus': 'products.target.band.60_plus' } as const;
const BAND_A11Y = { '18_29': 'products.target.a11y.18_29', '30_44': 'products.target.a11y.30_44', '45_59': 'products.target.a11y.45_59', '60_plus': 'products.target.a11y.60_plus' } as const;
const NO_FILTERS: AdminProductFilters = {};
const GENDER_FILTERS = ['everyone', 'women', 'men'] as const;
const BAND_FILTERS = ['all', ...PRODUCT_AGE_BANDS] as const;
/** Filters live in the URL (?targetGender=…&targetAgeBand=…) so refresh and Back keep them. Unknown values are dropped (the server would 400). */
function filtersFrom(params: URLSearchParams): AdminProductFilters {
  const g = params.get('targetGender'), b = params.get('targetAgeBand');
  return {
    ...((GENDER_FILTERS as readonly string[]).includes(g ?? '') ? { targetGender: g as AdminProductFilters['targetGender'] } : {}),
    ...((BAND_FILTERS as readonly string[]).includes(b ?? '') ? { targetAgeBand: b as AdminProductFilters['targetAgeBand'] } : {}),
  };
}
const STATUS_KEY = { active: 'vendor.products.status.active', paused: 'vendor.products.status.paused', archived: 'vendor.products.status.archived' } as const;

/** Ratings to two places, counts whole. */
const statText = (key: keyof ProductStats, v: number | null | undefined) => formatNumber(v, key === 'rating' ? 2 : 0);

/** One-off stats recompute: the dry run being reviewed, then the applied result. */
type Recompute = { preview: ProductStatsRecompute; result: ProductStatsRecompute | null; applying: boolean; error: string | null };

const EMPTY_PRODUCT: AdminProductDraft = {
  vendorId: '', name: '', description: '', category: '', brand: '',
  priceTzs: 0, stock: 0, approvalStatus: 'pending', homepageVisible: false,
  homepagePriority: 0,
};

export default function ProductsPage() {
  return <Suspense fallback={null}><ProductsInner /></Suspense>;
}

function ProductsInner() {
  const { token, user, t } = useApp();
  const params = useSearchParams();
  // Read from the URL when the page opens (refresh, Back, a shared link); kept in state so quick changes never use a stale URL.
  const [filters, setFilters] = useState<AdminProductFilters>(() => filtersFrom(new URLSearchParams(params.toString())));
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<AdminProductDraft>({ ...EMPTY_PRODUCT });
  const [privates, setPrivates] = useState<Record<string, PrivateDraft>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [openVariants, setOpenVariants] = useState<Set<string>>(new Set());
  const [checkingStats, setCheckingStats] = useState(false);
  const [recompute, setRecompute] = useState<Recompute | null>(null);
  // Sticky: once the server has sent target fields, keep the filters even when a filter matches nothing.
  const [targetsShown, setTargetsShown] = useState(false);
  const filtering = Boolean(filters.targetGender || filters.targetAgeBand);
  const vendorName = (id: string) => {
    const v = vendors.find(x => x.id === id);
    return v?.vendorProfile?.businessName || v?.displayName || id;
  };
  const privateOf = (p: ShopProduct) => privates[p.id] ?? draftOf(p);
  const editPrivate = (p: ShopProduct, patch: (d: PrivateDraft) => PrivateDraft) => {
    setPrivates(cur => ({ ...cur, [p.id]: patch(cur[p.id] ?? draftOf(p)) }));
    setFieldErrors(cur => Object.fromEntries(Object.entries(cur).filter(([k]) => !k.startsWith(`${p.id}:`))));
  };

  async function load(nextFilters: AdminProductFilters = filters) {
    if (!token) return;
    setLoading(true);
    try {
      const [productRows, vendorRows] = await Promise.all([
        api.adminProducts(token, nextFilters),
        api.adminVendors(token),
      ]);
      setProducts(productRows);
      if (productRows.some(hasTargets)) setTargetsShown(true);
      setVendors(vendorRows);
      setPrivates({});
      setFieldErrors({});
      setError(null);
    } catch {
      setError(t('products.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filters]);

  function updateDraft(id: string, patch: Partial<ShopProduct>) {
    setProducts((current) => current.map((product) => (
      product.id === id ? { ...product, ...patch } : product
    )));
  }

  async function save(product: ShopProduct) {
    if (!token) return;
    // Private fields (stock ledger on only): checked here, cleared with an empty box.
    let privateBody = {};
    if (hasPrivate(product)) {
      const d = privateOf(product);
      const errors: Record<string, string> = {};
      const cost = parseWhole(d.cost), reorder = parseWhole(d.reorder);
      if (cost === 'invalid') errors[`${product.id}:costTzs`] = t('products.invalidNumber');
      if (reorder === 'invalid') errors[`${product.id}:reorderLevel`] = t('products.invalidNumber');
      // Only what the admin changed against the loaded values: untouched private fields are never sent.
      const variants: Array<{ name: string; costTzs?: number | null; reorderLevel?: number | null }> = [];
      for (const v of variantsOf(product)) {
        const vd = d.variants[v.name] ?? { cost: asText(v.costTzs), reorder: asText(v.reorderLevel) };
        const vc = parseWhole(vd.cost), vr = parseWhole(vd.reorder);
        if (vc === 'invalid') errors[`${product.id}:${v.name}:costTzs`] = t('products.invalidNumber');
        if (vr === 'invalid') errors[`${product.id}:${v.name}:reorderLevel`] = t('products.invalidNumber');
        const change: { name: string; costTzs?: number | null; reorderLevel?: number | null } = { name: v.name };
        if (vc !== 'invalid' && vc !== (v.costTzs ?? null)) change.costTzs = vc;
        if (vr !== 'invalid' && vr !== (v.reorderLevel ?? null)) change.reorderLevel = vr;
        if ('costTzs' in change || 'reorderLevel' in change) variants.push(change);
      }
      if (Object.keys(errors).length) { setFieldErrors(cur => ({ ...cur, ...errors })); return; }
      privateBody = {
        ...(cost !== 'invalid' && cost !== (product.costTzs ?? null) ? { costTzs: cost } : {}),
        ...(reorder !== 'invalid' && reorder !== (product.reorderLevel ?? null) ? { reorderLevel: reorder } : {}),
        ...(variants.length ? { variants } : {}),
      };
    }
    setSavingId(product.id);
    setSuccess(null);
    try {
      const updated = await api.updateProductListing(token, product.id, {
        homepageVisible: product.homepageVisible !== false,
        homepagePriority: Number(product.homepagePriority || 0),
        approvalStatus: product.approvalStatus || 'pending',
        ...privateBody,
      });
      updateDraft(product.id, updated);
      setPrivates(cur => { const next = { ...cur }; delete next[product.id]; return next; });
      setSuccess(t('products.saved'));
      setError(null);
    } catch (cause) {
      const body = cause instanceof ApiError ? (cause.body as { error?: string; field?: string } | null) : null;
      if (body?.error === 'invalid_field' && (body.field === 'costTzs' || body.field === 'reorderLevel')) {
        setFieldErrors(cur => ({ ...cur, [`${product.id}:${body.field}`]: t('products.invalidNumber') }));
      } else if (body?.error === 'duplicate_variant' || body?.error === 'variant_not_found' || (body?.error === 'invalid_field' && body.field === 'variants')) {
        setError(t('products.variantChanged'));
        await load();
      } else {
        setError(cause instanceof Error ? cause.message : t('products.error'));
      }
    } finally {
      setSavingId(null);
    }
  }

  async function createProduct() {
    if (!token || !draft.vendorId || !draft.name.trim() || draft.priceTzs <= 0) return;
    setSavingId('new');
    setSuccess(null);
    try {
      const created = await api.createAdminProduct(token, draft);
      setProducts((current) => [created, ...current]);
      setDraft({ ...EMPTY_PRODUCT });
      setCreateOpen(false);
      setError(null);
      setSuccess(t('products.created'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('products.error'));
    } finally {
      setSavingId(null);
    }
  }

  const recomputeError = (cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 403) return t('products.recompute.forbidden');
    if (cause instanceof ApiError && cause.status === 409 && (cause.body as { error?: string } | null)?.error === 'recompute_in_progress') return t('products.recompute.inProgress');
    return t('products.recompute.error');
  };

  /** Dry run first (apply false): nothing is written until the admin applies from the review. */
  async function previewRecompute() {
    if (!token) return;
    setCheckingStats(true);
    setSuccess(null);
    try {
      const preview = await api.recomputeProductStats(token, { apply: false });
      setRecompute({ preview, result: null, applying: false, error: null });
      setError(null);
    } catch (cause) {
      setError(recomputeError(cause));
    } finally {
      setCheckingStats(false);
    }
  }

  async function applyRecompute() {
    if (!token || !recompute || recompute.applying) return;
    setRecompute({ ...recompute, applying: true, error: null });
    try {
      const result = await api.recomputeProductStats(token, { apply: true });
      setRecompute(cur => cur && { ...cur, result, applying: false });
    } catch (cause) {
      setRecompute(cur => cur && { ...cur, applying: false, error: recomputeError(cause) });
    }
  }

  const closeRecompute = () => { if (!recompute?.applying) setRecompute(null); };

  /** Sets the filters (the effect above reloads) and mirrors them into the URL, keeping any other query params. */
  function applyFilters(next: AdminProductFilters) {
    setFilters(next);
    setSuccess(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('targetGender'); url.searchParams.delete('targetAgeBand');
    if (next.targetGender) url.searchParams.set('targetGender', next.targetGender);
    if (next.targetAgeBand) url.searchParams.set('targetAgeBand', next.targetAgeBand);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  const bandsText = (bands: ProductAgeBand[] | undefined) =>
    bands && bands.length ? bands.map(b => t(BAND_KEY[b])).join(', ') : t('products.target.allAges');
  const bandsA11y = (bands: ProductAgeBand[] | undefined) =>
    bands && bands.length ? bands.map(b => t(BAND_A11Y[b])).join(', ') : t('products.target.allAges');
  const genderText = (g: ShopProduct['targetGender']) =>
    g === 'women' ? t('products.target.women') : g === 'men' ? t('products.target.men') : t('products.target.everyone');

  if (!token || user?.userType !== 'admin') return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('products.title')}
        description={t('products.description')}
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('admin.action.refresh')}
          </Button>
          <Button variant="secondary" size="sm" onClick={previewRecompute} loading={checkingStats}>
            {!checkingStats && <Calculator aria-hidden="true" className="h-4 w-4" />}
            {checkingStats ? t('products.recompute.checking') : t('products.recompute.action')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />{t('products.create')}
          </Button>
        </div>}
      />

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {targetsShown && (
        <Card><CardContent>
          <div className="grid gap-4 sm:grid-cols-[12rem_12rem_auto] sm:items-end" data-testid="product-target-filters">
            <Field label={t('products.target.madeFor')}>
              <Select aria-label={t('products.target.filterMadeFor')} value={filters.targetGender ?? ''}
                onChange={e => applyFilters({ ...filters, targetGender: (e.target.value || undefined) as AdminProductFilters['targetGender'] })}>
                <option value="">{t('products.target.filterAny')}</option>
                <option value="everyone">{t('products.target.everyone')}</option>
                <option value="women">{t('products.target.women')}</option>
                <option value="men">{t('products.target.men')}</option>
              </Select>
            </Field>
            <Field label={t('products.target.ageGroup')}>
              <Select aria-label={t('products.target.filterAgeGroup')} value={filters.targetAgeBand ?? ''}
                onChange={e => applyFilters({ ...filters, targetAgeBand: (e.target.value || undefined) as AdminProductFilters['targetAgeBand'] })}>
                <option value="">{t('products.target.filterAny')}</option>
                <option value="all">{t('products.target.allAges')}</option>
                {PRODUCT_AGE_BANDS.map(b => <option key={b} value={b}>{t(BAND_KEY[b])}</option>)}
              </Select>
            </Field>
            {filtering && (
              <div className="pb-1">
                <Button variant="ghost" size="sm" className="min-h-11" onClick={() => applyFilters(NO_FILTERS)}>{t('products.target.clearFilters')}</Button>
              </div>
            )}
          </div>
          <p className="mt-3 text-sm text-[var(--color-fg-secondary)]" data-testid="product-target-note">{t('products.target.note')}</p>
        </CardContent></Card>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : products.length === 0 ? (
        <Card><p className="py-8 text-center text-sm text-[var(--color-fg-tertiary)]">{t(filtering ? 'products.target.noMatch' : 'products.empty')}</p></Card>
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <Card key={product.id}><CardContent>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_10rem_11rem_auto] md:items-end">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-[var(--color-fg-primary)]">{product.name}</h2>
                    <Badge tone={product.status === 'active' ? 'success' : 'gray'}>{STATUS_KEY[product.status] ? t(STATUS_KEY[product.status]) : product.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-fg-tertiary)]">
                    {t('products.vendor')}: {vendorName(product.vendorId)} · {t('products.stock')}: {product.stock}
                    {hasPrivate(product) && <> · {t('vendor.stock.reorderLevel')}: {product.reorderLevel ?? '—'} · {t('vendor.costPrice')}: {product.costTzs == null ? '—' : money(product.costTzs)}</>}
                  </p>
                  {hasTargets(product) && (
                    <p className="mt-1 text-xs text-[var(--color-fg-tertiary)]" data-testid={`product-targets-${product.id}`}>
                      {t('products.target.madeFor')}: {genderText(product.targetGender)} · {t('products.target.ageGroup')}: <span aria-hidden="true">{bandsText(product.targetAgeBands)}</span><span className="sr-only">{bandsA11y(product.targetAgeBands)}</span>
                    </p>
                  )}
                  {hasPrivate(product) && product.reorderLevel != null && product.stock <= product.reorderLevel && (
                    <div className="mt-1"><Badge tone="warning">{t('vendor.stock.lowBadge')}</Badge></div>
                  )}
                </div>
                <Checkbox
                  aria-label={`${t('listing.visible')}: ${product.name}`}
                  label={t('listing.visible')}
                  checked={product.homepageVisible !== false}
                  onChange={(event) => updateDraft(product.id, { homepageVisible: event.target.checked })}
                />
                <Field label={t('products.approval')}>
                  <Select
                    aria-label={`${t('products.approval')}: ${product.name}`}
                    value={product.approvalStatus || 'pending'}
                    onChange={(event) => updateDraft(product.id, { approvalStatus: event.target.value as ShopProduct['approvalStatus'] })}
                  >
                    <option value="pending">{t('products.pending')}</option>
                    <option value="approved">{t('products.approved')}</option>
                    <option value="rejected">{t('products.rejected')}</option>
                  </Select>
                </Field>
                <Field label={t('listing.priority')} hint={t('listing.priorityHint')}>
                  <Input
                    aria-label={`${t('listing.priority')}: ${product.name}`}
                    type="number"
                    min="0"
                    value={product.homepagePriority || 0}
                    onChange={(event) => updateDraft(product.id, { homepagePriority: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => save(product)}
                  disabled={savingId === product.id}
                >
                  <Save className="h-4 w-4" />
                  {t('products.save')}
                </Button>
              </div>
              {hasPrivate(product) && (
                <div className="mt-4 space-y-3 border-t border-[var(--color-border-secondary)] pt-4" data-testid={`product-private-${product.id}`}>
                  <div className="grid gap-4 sm:grid-cols-2 md:max-w-xl">
                    <Field label={t('products.costPrice')} error={fieldErrors[`${product.id}:costTzs`]}>
                      <Input aria-label={`${t('products.costPrice')}: ${product.name}`} type="number" min="0" step="1" inputMode="numeric"
                        value={privateOf(product).cost} onChange={e => editPrivate(product, d => ({ ...d, cost: e.target.value }))} data-testid={`product-cost-${product.id}`} />
                    </Field>
                    <Field label={t('products.reorderLevel')} error={fieldErrors[`${product.id}:reorderLevel`]}>
                      <Input aria-label={`${t('products.reorderLevel')}: ${product.name}`} type="number" min="0" step="1" inputMode="numeric"
                        value={privateOf(product).reorder} onChange={e => editPrivate(product, d => ({ ...d, reorder: e.target.value }))} data-testid={`product-reorder-${product.id}`} />
                    </Field>
                  </div>
                  {variantsOf(product).length > 0 && (
                    <div>
                      <Button variant="ghost" size="sm" className="min-h-11" aria-expanded={openVariants.has(product.id)}
                        onClick={() => setOpenVariants(cur => { const n = new Set(cur); if (n.has(product.id)) n.delete(product.id); else n.add(product.id); return n; })}>
                        {openVariants.has(product.id) ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
                        {t('products.variants')}
                      </Button>
                      {openVariants.has(product.id) && (
                        <ul className="mt-2 space-y-3">
                          {variantsOf(product).map(v => {
                            const vd = privateOf(product).variants[v.name] ?? { cost: '', reorder: '' };
                            const setV = (patch: Partial<{ cost: string; reorder: string }>) =>
                              editPrivate(product, d => ({ ...d, variants: { ...d.variants, [v.name]: { ...(d.variants[v.name] ?? { cost: '', reorder: '' }), ...patch } } }));
                            return (
                              <li key={v.name} className="grid gap-3 sm:grid-cols-[10rem_1fr_1fr] sm:items-end">
                                <p className="text-sm font-medium">{v.name} · {t('products.stock')}: {v.stock ?? '—'}</p>
                                <Field label={t('products.costPrice')} error={fieldErrors[`${product.id}:${v.name}:costTzs`]}>
                                  <Input aria-label={`${t('products.costPrice')}: ${product.name} · ${v.name}`} type="number" min="0" step="1" inputMode="numeric" value={vd.cost} onChange={e => setV({ cost: e.target.value })} />
                                </Field>
                                <Field label={t('products.reorderLevel')} error={fieldErrors[`${product.id}:${v.name}:reorderLevel`]}>
                                  <Input aria-label={`${t('products.reorderLevel')}: ${product.name} · ${v.name}`} type="number" min="0" step="1" inputMode="numeric" value={vd.reorder} onChange={e => setV({ reorder: e.target.value })} />
                                </Field>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent></Card>
          ))}
        </div>
      )}

      {recompute && (() => {
        const shown = recompute.result ?? recompute.preview;
        const counts: Array<[string, number]> = [
          [t('products.recompute.checked'), shown.checked],
          [t(recompute.result ? 'products.recompute.changed' : 'products.recompute.willChange'), shown.changed.length],
          [t('products.recompute.unchanged'), shown.unchanged],
        ];
        const cols: Array<[keyof ProductStats, string]> = [
          ['rating', t('products.recompute.colRating')],
          ['reviewCount', t('products.recompute.colReviews')],
          ['soldCount', t('products.recompute.colSold')],
        ];
        return (
          <Dialog open onClose={closeRecompute} size="xl" title={t('products.recompute.title')} description={t('products.recompute.explain')}>
            <div className="space-y-4" data-testid="product-stats-recompute">
              <dl className="grid grid-cols-3 gap-3">
                {counts.map(([label, n]) => (
                  <div key={label} className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] px-4 py-3">
                    <dt className="text-xs text-[var(--color-fg-tertiary)]">{label}</dt>
                    <dd className="mt-1 text-lg font-semibold text-[var(--color-fg-primary)]">{formatNumber(n)}</dd>
                  </div>
                ))}
              </dl>
              {recompute.result && (
                <Alert tone="success">
                  {t('products.recompute.applied').replace('{when}', formatDateTime(recompute.result.appliedAt))}
                  {recompute.result.runId && <span className="block text-xs font-normal">{t('products.recompute.runId').replace('{id}', recompute.result.runId)}</span>}
                </Alert>
              )}
              {recompute.error && <Alert tone="error">{recompute.error}</Alert>}
              {shown.changed.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--color-fg-tertiary)]">{t('products.recompute.empty')}</p>
              ) : (
                <Table aria-label={t('products.recompute.tableLabel')}>
                  <THead>
                    <Tr>
                      <Th>{t('products.recompute.colProduct')}</Th>
                      {cols.map(([key, label]) => <Th key={key}>{label}</Th>)}
                    </Tr>
                  </THead>
                  <TBody>
                    {shown.changed.map(row => (
                      <Tr key={row.productId} data-testid={`recompute-row-${row.productId}`}>
                        <Td>
                          <div className="font-medium text-[var(--color-fg-primary)]">{row.name}</div>
                          <div className="text-xs text-[var(--color-fg-tertiary)]">{t('products.vendor')}: {vendorName(row.vendorId)}</div>
                        </Td>
                        {cols.map(([key]) => {
                          const before = statText(key, row.before?.[key]), after = statText(key, row.after?.[key]);
                          const same = before === after;
                          return (
                            <Td key={key} aria-label={t('vendor.products.wasNow').replace('{old}', before).replace('{new}', after)}>
                              <span className={same ? 'text-[var(--color-fg-tertiary)]' : 'text-[var(--color-fg-quaternary)] line-through'}>{before}</span>
                              {!same && <> <span aria-hidden="true">→</span> <span className="font-semibold text-[var(--color-fg-primary)]">{after}</span></>}
                            </Td>
                          );
                        })}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
              {!recompute.result && shown.changed.length > 0 && (
                <p className="text-sm text-[var(--color-fg-secondary)]">{t('products.recompute.applyWarning')}</p>
              )}
            </div>
            <DialogFooter>
              {recompute.result || shown.changed.length === 0 ? (
                <Button variant="secondary" onClick={closeRecompute}>{t('common.close')}</Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={closeRecompute} disabled={recompute.applying}>{t('admin.action.cancel')}</Button>
                  <Button variant="destructive" onClick={applyRecompute} loading={recompute.applying}>{t('products.recompute.apply')}</Button>
                </>
              )}
            </DialogFooter>
          </Dialog>
        );
      })()}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('products.createTitle')}
        description={t('products.createDescription')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('products.vendor')}>
            <Select aria-label={t('products.vendor')} value={draft.vendorId} onChange={(event) => setDraft({ ...draft, vendorId: event.target.value })}>
              <option value="">{t('products.selectVendor')}</option>
              {vendors.filter((vendor) => vendor.approvalStatus === 'approved' && vendor.accountStatus === 'active').map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.vendorProfile?.businessName || vendor.displayName || vendor.email || vendor.id}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('products.name')}>
            <Input aria-label={t('products.name')} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={t('products.category')}>
            <Input aria-label={t('products.category')} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
          </Field>
          <Field label={t('products.brand')}>
            <Input aria-label={t('products.brand')} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} />
          </Field>
          <Field label={t('products.price')}>
            <Input aria-label={t('products.price')} type="number" min="1" value={draft.priceTzs || ''} onChange={(event) => setDraft({ ...draft, priceTzs: Number(event.target.value) || 0 })} />
          </Field>
          <Field label={t('products.stock')}>
            <Input aria-label={t('products.stock')} type="number" min="0" value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: Number(event.target.value) || 0 })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('products.productDescription')}>
              <Textarea aria-label={t('products.productDescription')} className="!min-h-24" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </Field>
          </div>
          <Field label={t('products.approval')}>
            <Select aria-label={t('products.approval')} value={draft.approvalStatus} onChange={(event) => setDraft({ ...draft, approvalStatus: event.target.value as AdminProductDraft['approvalStatus'] })}>
              <option value="pending">{t('products.pending')}</option>
              <option value="approved">{t('products.approved')}</option>
            </Select>
          </Field>
          <div className="self-end pb-3">
            <Checkbox label={t('listing.visible')} checked={draft.homepageVisible} onChange={(event) => setDraft({ ...draft, homepageVisible: event.target.checked })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>{t('admin.action.cancel')}</Button>
          <Button variant="primary" onClick={createProduct} disabled={savingId === 'new' || !draft.vendorId || !draft.name.trim() || draft.priceTzs <= 0}>
            {t('products.create')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
