'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ImageIcon, Megaphone, Plus, RefreshCw, Search } from 'lucide-react';
import { useApp } from '../../providers';
import { api, type ShopProduct, type VendorSummary } from '@/lib/api';
import { eatDateTime, fmt, type Category } from '@/lib/vendor';
import {
  MERCH_EMPTY_KEY, MERCH_TABS, MERCH_TAB_KEY, PHASE_KEY, PHASE_TONE, bannersApi, errorCodeOf, errorKeyOf, headlineOf, phaseOf, tabOfBanner,
  type BannerConfirmation, type MerchKind, type MerchTab, type ShopBanner,
} from '@/lib/shop-banners';
import { discountPctOf, salesApi, saleErrorCode, type FlashSale } from '@/lib/flash-sales';
import { money } from '@/lib/admin-utils';
import { FlashSaleDetail } from '@/components/flash-sale-detail';
import { FlashSaleForm, SaleThumb } from '@/components/flash-sale-form';
import { Alert, Badge, Button, Card, CardContent, Input, PageHeader, Segmented, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { ShopMerchDetail } from '@/components/shop-merch-detail';
import { BannerForm } from '@/components/shop-banner-form';
import { useBannerPhoto } from '@/components/shop-banner-preview';

/** A small photo for the queue: public once approved, else the private copy fetched with the session. */
function Thumb({ banner }: { banner: ShopBanner }) {
  const src = useBannerPhoto(banner, 240);
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className="h-10 w-16 shrink-0 rounded-[var(--radius-md)] object-cover" />
    : <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-tertiary)]"><ImageIcon aria-hidden="true" className="h-4 w-4 text-[var(--color-fg-quaternary)]" /></span>;
}

/** ?item=, ?edit= and ?new= name a banner, or a flash sale with kind=flash_sale (new=sale). */
type View = { item: string | null; edit: string | null; creating: MerchKind | null; kind: MerchKind };
const viewOf = (search: string): View => {
  const sp = new URLSearchParams(search);
  const nw = sp.get('new');
  return { item: sp.get('item'), edit: sp.get('edit'), creating: nw === 'banner' ? 'banner' : nw === 'sale' ? 'flash_sale' : null, kind: sp.get('kind') === 'flash_sale' ? 'flash_sale' : 'banner' };
};
/** One row in the queue: a banner or a flash sale. */
type Row = { kind: 'banner'; id: string; b: ShopBanner } | { kind: 'flash_sale'; id: string; s: FlashSale };
const itemOf = (r: Row) => (r.kind === 'banner' ? r.b : r.s);
const qItem = (r: { kind: MerchKind; id: string }) => `item=${encodeURIComponent(r.id)}${r.kind === 'flash_sale' ? '&kind=flash_sale' : ''}`;
const TAB_SET = new Set<string>(MERCH_TABS);
const HOUR = 3_600_000;
/** "2 hours ago" / "saa 2 zilizopita" in the reader's language. */
function relative(iso: string | null | undefined, now: number, locale: string): string | null {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return null;
  const sec = Math.round((at - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale === 'sw' ? 'sw' : 'en', { numeric: 'auto' });
  const abs = Math.abs(sec);
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(sec / 3600), 'hour');
  return rtf.format(Math.round(sec / 86_400), 'day');
}

/**
 * Shop banners & flash sales (spec shop-home-phase2 §5.3, §8.5): what sellers propose for the shop home and what
 * FitFlex staff create, by what it is now. One at a time in detail (?item=[&kind=flash_sale]), create
 * (?new=banner|sale), edit (?edit=). Each kind shows only while the server has it on (SHOP_BANNERS, SHOP_FLASH_SALES).
 */
export default function ShopMerchPage() {
  const { token, user, t, locale, hasPermission } = useApp();
  const [rows, setRows] = useState<ShopBanner[] | null>(null);
  const [sales, setSales] = useState<FlashSale[] | null>(null);
  const [serverCounts, setServerCounts] = useState<Partial<Record<MerchTab, number>> | null>(null);
  const [saleCounts, setSaleCounts] = useState<Partial<Record<MerchTab, number>> | null>(null);
  const [kindsOn, setKindsOn] = useState<{ banner: boolean; flash_sale: boolean }>({ banner: true, flash_sale: true });
  const [confirmation, setConfirmation] = useState<BannerConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [tab, setTab] = useState<MerchTab>('requests');
  const [kind, setKind] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>({ item: null, edit: null, creating: null, kind: 'banner' });
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    const sync = () => {
      setView(viewOf(window.location.search));
      const tb = new URLSearchParams(window.location.search).get('tab');
      if (tb && TAB_SET.has(tb)) setTab(tb as MerchTab);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const go = (q: string) => { history.pushState(null, '', q ? `?${q}` : `?tab=${tab}`); setView(viewOf(q ? `?${q}` : '')); };
  const pickTab = (next: MerchTab) => { setTab(next); history.replaceState(null, '', `?tab=${next}`); };

  // Both kinds at once; a kind switched off on the server (404 feature_disabled) is simply left out.
  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const [b, s] = await Promise.allSettled([bannersApi.adminList(token), salesApi.adminList(token)]);
    const bannerOff = b.status === 'rejected' && errorCodeOf(b.reason) === 'feature_disabled';
    const saleOff = s.status === 'rejected' && saleErrorCode(s.reason) === 'feature_disabled';
    setKindsOn({ banner: !bannerOff, flash_sale: !saleOff });
    setDisabled(bannerOff && saleOff);
    if (b.status === 'fulfilled') { setRows(b.value.items); setServerCounts(b.value.counts ?? null); setConfirmation(b.value.confirmation ?? null); }
    else setRows([]);
    if (s.status === 'fulfilled') { setSales(s.value.items); setSaleCounts(s.value.counts ?? null); }
    else setSales([]);
    const failed = [b.status === 'rejected' && !bannerOff ? b.reason : null, s.status === 'rejected' && !saleOff ? s.reason : null].find(Boolean);
    if (failed) setError(t(errorKeyOf(failed, 'merchAdmin.loadFailed')));
  }, [token, t]);
  useEffect(() => { void load(); }, [load]);

  // Pickers for the staff form. Each is optional: a failure leaves the list empty.
  const needsCatalogue = !!view.edit || !!view.creating;
  useEffect(() => {
    if (!token || !needsCatalogue) return;
    if (hasPermission('shop') || hasPermission('promotions')) {
      api.adminProducts(token).then(setProducts).catch(() => setProducts([]));
      api.adminVendors(token).then(setVendors).catch(() => setVendors([]));
    }
    api.shopCategories().then(r => setCategories(r.categories ?? [])).catch(() => setCategories([]));
  }, [token, needsCatalogue, hasPermission]);

  if (!token || user?.userType !== 'admin') return null;

  if (disabled) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('merchAdmin.title')} />
        <Alert tone="info" className="max-w-xl" >{t('merch.unavailable')}</Alert>
      </div>
    );
  }

  // Flash sale: create (?new=sale) or edit a FitFlex-created one (?edit=&kind=flash_sale).
  if (view.creating === 'flash_sale' || (view.edit && view.kind === 'flash_sale')) {
    const editing = view.edit ? sales?.find(r => r.id === view.edit) ?? null : null;
    if (view.edit && !editing) return sales == null ? <Spinner className="h-6 w-6" /> : <Alert tone="warning">{t('merch.notYours')}</Alert>;
    if (editing && editing.origin !== 'staff') return <Alert tone="warning">{t('merch.sale.notEditable')}</Alert>;
    const back = () => go(view.edit ? qItem({ kind: 'flash_sale', id: view.edit }) : '');
    return (
      <div className="space-y-6">
        <Button variant="link" onClick={back} className="-ml-2 h-auto min-h-10 gap-1.5 px-2 text-sm font-normal text-[var(--color-fg-tertiary)] hover:no-underline">
          <ArrowLeft className="h-4 w-4" />{t('merchAdmin.back')}
        </Button>
        <PageHeader title={t(editing ? 'merchAdmin.editSale' : 'merchAdmin.createSale')} description={t('merchAdmin.saleCreateNote')} />
        {/* Any vendor's product that is on sale and approved; the server checks eligibility again. */}
        <FlashSaleForm mode="staff" sale={editing} vendors={vendors}
          products={products.filter(p => p.status === 'active' && (p.approvalStatus ?? 'approved') === 'approved')}
          onCancel={back} onDone={s => { void load(); go(qItem({ kind: 'flash_sale', id: s.id })); }} />
      </div>
    );
  }

  if (view.creating || view.edit) {
    const editing = view.edit ? rows?.find(r => r.id === view.edit) ?? null : null;
    if (view.edit && !editing) return rows == null ? <Spinner className="h-6 w-6" /> : <Alert tone="warning">{t('merch.notYours')}</Alert>;
    if (editing && editing.origin !== 'staff') return <Alert tone="warning">{t('merch.notEditable')}</Alert>;
    return (
      <div className="space-y-6">
        <Button variant="link" onClick={() => go(view.edit ? `item=${encodeURIComponent(view.edit)}` : '')} className="-ml-2 h-auto min-h-10 gap-1.5 px-2 text-sm font-normal text-[var(--color-fg-tertiary)] hover:no-underline">
          <ArrowLeft className="h-4 w-4" />{t('merchAdmin.back')}
        </Button>
        <PageHeader title={t(editing ? 'merchAdmin.editBanner' : 'merchAdmin.createBanner')} description={t('merchAdmin.createNote')} />
        <BannerForm mode="staff" banner={editing} confirmation={confirmation} onConfirmationStale={() => void load()} products={products} vendors={vendors} categories={categories}
          onCancel={() => go(view.edit ? `item=${encodeURIComponent(view.edit)}` : '')}
          onDone={b => { void load(); go(`item=${encodeURIComponent(b.id)}`); }} />
      </div>
    );
  }

  if (view.item && view.kind === 'flash_sale') {
    return (
      <FlashSaleDetail key={view.item} id={view.item} fallback={sales?.find(r => r.id === view.item) ?? null} onBack={() => go('')}
        onEdit={id => go(`edit=${encodeURIComponent(id)}&kind=flash_sale`)} onChanged={() => void load()} />
    );
  }
  if (view.item) {
    return (
      <ShopMerchDetail key={view.item} id={view.item} fallback={rows?.find(r => r.id === view.item) ?? null} onBack={() => go('')}
        onEdit={id => go(`edit=${encodeURIComponent(id)}`)} onChanged={() => void load()} />
    );
  }

  const now = Date.now();
  const both = kindsOn.banner && kindsOn.flash_sale;
  const wants = (k: MerchKind) => kindsOn[k] && (kind === 'all' || kind === k);
  const all: Row[] = [
    ...(rows ?? []).map(b => ({ kind: 'banner' as const, id: b.id, b })),
    ...(sales ?? []).map(s => ({ kind: 'flash_sale' as const, id: s.id, s })),
  ];
  const loaded = rows != null && sales != null;
  const counts = (s: MerchTab) =>
    (wants('banner') ? serverCounts?.[s] ?? (rows ?? []).filter(r => tabOfBanner(r, now) === s).length : 0)
    + (wants('flash_sale') ? saleCounts?.[s] ?? (sales ?? []).filter(r => tabOfBanner(r, now) === s).length : 0);
  const needle = query.trim().toLowerCase();
  const words = (r: Row) => (r.kind === 'banner'
    ? [r.b.vendorName, r.b.targetName, r.b.headlineLead?.en, r.b.headlineLead?.sw, r.b.headlineAccent?.en, r.b.headlineAccent?.sw]
    : [r.s.vendorName, r.s.productName]);
  const shown = all.filter(r => tabOfBanner(itemOf(r), now) === tab)
    .filter(r => wants(r.kind))
    .filter(r => !needle || words(r).some(v => String(v ?? '').toLowerCase().includes(needle)))
    // Requests: soonest to expire first (as the server sorts them); the rest by position (banners), then start.
    .sort((x, y) => {
      const a = itemOf(x); const b = itemOf(y);
      if (tab === 'requests') return (Date.parse(a.expiresAt ?? a.startsAt) - Date.parse(b.expiresAt ?? b.startsAt)) || a.id.localeCompare(b.id);
      const pa = x.kind === 'banner' ? x.b.position ?? 999 : 999; const pb = y.kind === 'banner' ? y.b.position ?? 999 : 999;
      return pa - pb || Date.parse(a.startsAt) - Date.parse(b.startsAt);
    });
  // Under 72 hours to expiry: warn; under a day, in hours (spec §5.3.1, QA1 #5).
  const expiryText = (b: ShopBanner | FlashSale): string | null => {
    if (phaseOf(b, now) !== 'pending') return null;
    const left = Date.parse(b.expiresAt ?? b.startsAt) - now;
    if (!Number.isFinite(left) || left <= 0 || left >= 72 * HOUR) return null;
    if (left < HOUR) return t('merchAdmin.expiresSoon');
    // Rounded to the nearest hour or day (QA2 #2): ~5 h reads "5 hours", ~2 days "2 days".
    const h = Math.round(left / HOUR);
    if (h < 24) return h === 1 ? t('merchAdmin.expiresInOneHour') : fmt(t('merchAdmin.expiresInHours'), { n: h });
    const d = Math.max(1, Math.round(left / (24 * HOUR)));
    return d === 1 ? t('merchAdmin.expiresInOne') : fmt(t('merchAdmin.expiresIn'), { n: d });
  };
  const sentText = (b: ShopBanner | FlashSale) => relative(b.submittedAt ?? b.createdAt, now, locale);
  // A staff banner has no seller ("FitFlex"); a staff flash sale is still on a seller's product.
  const seller = (r: Row) => (r.kind === 'banner'
    ? (r.b.origin === 'staff' ? t('merchAdmin.sellerFitflex') : r.b.vendorName || r.b.vendorId || '')
    : `${r.s.vendorName || r.s.vendorId}${r.s.origin === 'staff' ? ` · ${t('merchAdmin.setByFitflex')}` : ''}`);
  const titleOf = (r: Row) => (r.kind === 'banner' ? headlineOf(r.b, locale) : r.s.productName || r.s.productId) || '—';
  const typeOf = (r: Row) => t(r.kind === 'banner' ? 'merchAdmin.type.banner' : 'merchAdmin.type.sale');
  // "−24% · TSh 69,000" (spec §5.3.1).
  const discountOf = (r: Row) => {
    if (r.kind !== 'flash_sale') return '—';
    const pct = r.s.discountPct ?? discountPctOf(r.s.wasPriceTzs ?? r.s.regularPriceTzs, r.s.salePriceTzs);
    return fmt(t('merchAdmin.discountShort'), { pct: pct ?? '—', price: money(r.s.salePriceTzs) });
  };
  const thumb = (r: Row) => (r.kind === 'banner' ? <Thumb banner={r.b} /> : <SaleThumb src={r.s.productImage} className="h-10 w-16" />);
  const suspended = (r: Row) => !!itemOf(r).sellerSuspended;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('merchAdmin.title')}
        description={t('merchAdmin.description')}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" className="min-h-11" onClick={() => void load()} data-testid="merch-refresh"><RefreshCw className="h-4 w-4" />{t('mod.refresh')}</Button>
            {hasPermission('promotions') && kindsOn.banner && <Button size="sm" className="min-h-11" onClick={() => go('new=banner')} data-testid="merch-create-banner"><Plus className="h-4 w-4" />{t('merchAdmin.createBanner')}</Button>}
            {hasPermission('promotions') && kindsOn.flash_sale && <Button size="sm" className="min-h-11" onClick={() => go('new=sale')} data-testid="merch-create-sale"><Plus className="h-4 w-4" />{t('merchAdmin.createSale')}</Button>}
          </div>
        )}
      />
      {error && <Alert tone="error"><span className="flex flex-wrap items-center justify-between gap-2">{error}<Button size="sm" variant="secondary" onClick={() => void load()} data-testid="merch-retry">{t('common.tryAgain')}</Button></span></Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={t('merchAdmin.title')} className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1 w-fit">
          {MERCH_TABS.map(s => (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => pickTab(s)} data-testid={`merch-tab-${s}`}
              className={`flex min-h-11 items-center gap-2 rounded-md px-3 py-1.5 text-sm ${tab === s ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
              {t(MERCH_TAB_KEY[s])}<span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 text-xs tabular-nums" data-testid={`merch-count-${s}`}>{loaded ? counts(s) : '·'}</span>
            </button>
          ))}
        </div>
        {/* Type filter (spec §5.3.1): All · Banners · Flash sales, while both are switched on. */}
        <div role="group" aria-label={t('merchAdmin.col.type')} data-testid="merch-type-filter">
          <Segmented value={kind} onChange={setKind} options={both
            ? [['all', t('merchAdmin.type.all')], ['banner', t('merchAdmin.type.banners')], ['flash_sale', t('merchAdmin.type.sales')]]
            : [['all', t('merchAdmin.type.all')], kindsOn.flash_sale ? ['flash_sale', t('merchAdmin.type.sales')] : ['banner', t('merchAdmin.type.banners')]]} />
        </div>
        <div className="relative w-full sm:w-72">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-fg-quaternary)]" />
          <Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('merchAdmin.search')} aria-label={t('merchAdmin.search')} style={{ paddingInlineStart: '2.5rem' }} data-testid="merch-search" />
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {!loaded ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : shown.length === 0 ? (error ? null : (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]" data-testid="merch-empty">
              <Megaphone aria-hidden="true" className="h-6 w-6" />{t(needle ? (both && kind === 'all' ? 'merchAdmin.noMatchesAny' : wants('flash_sale') && !wants('banner') ? 'merchAdmin.noMatchesSales' : 'merchAdmin.noMatches') : MERCH_EMPTY_KEY[tab])}
            </div>
          )) : (
            <>
            {/* Phones: stacked cards (spec §5.3.1, QA1 #6). */}
            <ul className="divide-y divide-[var(--color-border-secondary)] sm:hidden" aria-label={t(MERCH_TAB_KEY[tab])} data-testid="merch-cards">
              {shown.map(r => {
                const b = itemOf(r);
                const phase = phaseOf(b, now);
                const exp = expiryText(b);
                return (
                  <li key={`${r.kind}-${r.id}`}>
                    <button type="button" onClick={() => go(qItem(r))} className="flex w-full min-h-11 items-start gap-3 p-4 text-left hover:bg-[var(--color-bg-secondary)]" data-testid={`merch-card-${b.id}`}>
                      {thumb(r)}
                      <span className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]">
                        <span className="block font-medium">{titleOf(r)}</span>
                        <span className="block text-xs text-[var(--color-fg-tertiary)]">{typeOf(r)} · {seller(r)}</span>
                        {r.kind === 'flash_sale' && <span className="block text-xs font-semibold text-[var(--color-fuel)]">{discountOf(r)}</span>}
                        <span className="block text-xs text-[var(--color-fg-tertiary)]">{eatDateTime(b.startsAt, locale)} → {eatDateTime(b.endsAt, locale)}</span>
                        <span className="flex flex-wrap items-center gap-2"><Badge tone={PHASE_TONE[phase]} dot>{t(PHASE_KEY[phase])}</Badge>
                          {sentText(b) && <span className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('merchAdmin.sentAgo'), { when: sentText(b)! })}</span>}</span>
                        {exp && <span className="block text-xs text-[var(--color-warning-700)]">{exp}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="hidden sm:block">
            <Table aria-label={t(MERCH_TAB_KEY[tab])} wrapperClassName="rounded-none border-0" className="min-w-[860px]" data-testid="merch-table">
              <THead>
                <Tr>
                  <Th>{t('merchAdmin.col.item')}</Th>
                  <Th>{t('merchAdmin.col.type')}</Th>
                  <Th>{t('merchAdmin.col.seller')}</Th>
                  <Th>{t('merchAdmin.col.dates')}</Th>
                  {wants('flash_sale') && <Th>{t('merchAdmin.col.discount')}</Th>}
                  {wants('banner') && <Th>{t('merchAdmin.col.position')}</Th>}
                  <Th>{t('merchAdmin.col.status')}</Th>
                  <Th>{t('merchAdmin.col.sent')}</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map(r => {
                  const b = itemOf(r);
                  const phase = phaseOf(b, now);
                  const exp = expiryText(b);
                  const open = () => go(qItem(r));
                  return (
                    <Tr key={`${r.kind}-${r.id}`} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') open(); }} onClick={open} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" data-testid={`merch-row-${b.id}`}>
                      <Td className="max-w-[20rem]">
                        <span className="flex items-center gap-3">
                          {thumb(r)}
                          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{titleOf(r)}</span>
                        </span>
                      </Td>
                      <Td>{typeOf(r)}</Td>
                      <Td className="[overflow-wrap:anywhere]">{seller(r)}{suspended(r) && <p className="text-xs text-[var(--color-warning-700)]">{t('merchAdmin.sellerSuspendedShort')}</p>}</Td>
                      <Td className="whitespace-nowrap text-xs">{eatDateTime(b.startsAt, locale)}<br />→ {eatDateTime(b.endsAt, locale)}</Td>
                      {wants('flash_sale') && <Td className="whitespace-nowrap tabular-nums" data-testid={`merch-discount-${b.id}`}>{discountOf(r)}</Td>}
                      {wants('banner') && <Td className="tabular-nums">{r.kind === 'banner' ? r.b.position ?? '—' : '—'}</Td>}
                      <Td>
                        <Badge tone={PHASE_TONE[phase]} dot>{t(PHASE_KEY[phase])}</Badge>
                      </Td>
                      <Td className="text-xs">
                        <span className="whitespace-nowrap">{sentText(b) ?? '—'}</span>
                        {exp && <p className="mt-1 text-xs text-[var(--color-warning-700)]" data-testid={`merch-expires-${b.id}`}>{exp}</p>}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
