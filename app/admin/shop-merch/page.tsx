'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ImageIcon, Megaphone, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, type ShopProduct, type VendorSummary } from '@/lib/api';
import { eatDateTime, fmt, type Category } from '@/lib/vendor';
import {
  MERCH_EMPTY_KEY, MERCH_KINDS, MERCH_TABS, MERCH_TAB_KEY, PHASE_KEY, PHASE_TONE, bannersApi, errorCodeOf, errorKeyOf, headlineOf, phaseOf, tabOfBanner,
  type MerchTab, type ShopBanner,
} from '@/lib/shop-banners';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Segmented, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
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

type View = { item: string | null; edit: string | null; creating: boolean };
const viewOf = (search: string): View => {
  const sp = new URLSearchParams(search);
  return { item: sp.get('item'), edit: sp.get('edit'), creating: sp.get('new') === 'banner' };
};
const TAB_SET = new Set<string>(MERCH_TABS);

/**
 * Shop banners & flash sales (spec shop-home-phase2 §5.3): what sellers propose for the shop home and what
 * FitFlex staff create, by what it is now. One at a time in detail (?item=), create (?new=banner), edit (?edit=).
 * Banners only in slice 1; flash sales join the same queue in slice 4.
 */
export default function ShopMerchPage() {
  const { token, user, t, locale, hasPermission } = useApp();
  const [rows, setRows] = useState<ShopBanner[] | null>(null);
  const [serverCounts, setServerCounts] = useState<Partial<Record<MerchTab, number>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [tab, setTab] = useState<MerchTab>('requests');
  const [kind, setKind] = useState<string>('all');
  const [view, setView] = useState<View>({ item: null, edit: null, creating: false });
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

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const list = await bannersApi.adminList(token);
      setRows(list.items); setServerCounts(list.counts ?? null); setDisabled(false);
    }
    catch (err) {
      if (errorCodeOf(err) === 'feature_disabled') setDisabled(true);
      else setError(t(errorKeyOf(err, 'merchAdmin.loadFailed')));
      setRows([]);
    }
  }, [token, t]);
  useEffect(() => { void load(); }, [load]);

  // Pickers for the staff form. Each is optional: a failure leaves the list empty.
  const needsCatalogue = !!view.edit || view.creating;
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
        <BannerForm mode="staff" banner={editing} products={products} vendors={vendors} categories={categories}
          onCancel={() => go(view.edit ? `item=${encodeURIComponent(view.edit)}` : '')}
          onDone={b => { void load(); go(`item=${encodeURIComponent(b.id)}`); }} />
      </div>
    );
  }

  if (view.item) {
    return (
      <ShopMerchDetail key={view.item} id={view.item} fallback={rows?.find(r => r.id === view.item) ?? null} onBack={() => go('')}
        onEdit={id => go(`edit=${encodeURIComponent(id)}`)} onChanged={() => void load()} />
    );
  }

  const now = Date.now();
  const counts = (s: MerchTab) => serverCounts?.[s] ?? (rows ?? []).filter(r => tabOfBanner(r, now) === s).length;
  const shown = (rows ?? []).filter(r => tabOfBanner(r, now) === tab)
    // Requests: soonest to expire first (as the server sorts them); the rest by position, then start.
    .sort((a, b) => (tab === 'requests' ? (Date.parse(a.expiresAt ?? a.startsAt) - Date.parse(b.expiresAt ?? b.startsAt)) || a.id.localeCompare(b.id)
      : (a.position ?? 999) - (b.position ?? 999) || Date.parse(a.startsAt) - Date.parse(b.startsAt)));
  const expiresInDays = (b: ShopBanner) => {
    if (b.status !== 'pending_approval') return null;
    const exp = Date.parse(b.expiresAt ?? b.startsAt);
    if (!Number.isFinite(exp)) return null;
    const days = Math.ceil((exp - now) / 86_400_000);
    return days >= 0 && days <= 3 ? days : null;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('merchAdmin.title')}
        description={t('merchAdmin.description')}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()} data-testid="merch-refresh"><RefreshCw className="h-4 w-4" />{t('mod.refresh')}</Button>
            {hasPermission('promotions') && <Button size="sm" onClick={() => go('new=banner')} data-testid="merch-create-banner"><Plus className="h-4 w-4" />{t('merchAdmin.createBanner')}</Button>}
          </div>
        )}
      />
      {error && <Alert tone="error"><span className="flex flex-wrap items-center justify-between gap-2">{error}<Button size="sm" variant="secondary" onClick={() => void load()} data-testid="merch-retry">{t('common.tryAgain')}</Button></span></Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={t('merchAdmin.title')} className="flex max-w-full flex-wrap gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1 w-fit">
          {MERCH_TABS.map(s => (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => pickTab(s)} data-testid={`merch-tab-${s}`}
              className={`flex min-h-11 items-center gap-2 rounded-md px-3 py-1.5 text-sm ${tab === s ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
              {t(MERCH_TAB_KEY[s])}<span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 text-xs tabular-nums" data-testid={`merch-count-${s}`}>{rows ? counts(s) : '·'}</span>
            </button>
          ))}
        </div>
        {/* Room for flash sales (slice 4): the type filter shows once the queue holds more than one kind. */}
        {MERCH_KINDS.length > 1 && (
          <Segmented value={kind} onChange={setKind} options={[['all', t('merchAdmin.type.all')], ['banner', t('merchAdmin.type.banner')]]} />
        )}
      </div>
      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : shown.length === 0 ? (error ? null : (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]" data-testid="merch-empty">
              <Megaphone aria-hidden="true" className="h-6 w-6" />{t(MERCH_EMPTY_KEY[tab])}
            </div>
          )) : (
            <Table aria-label={t(MERCH_TAB_KEY[tab])} wrapperClassName="rounded-none border-0" className="min-w-[760px]" data-testid="merch-table">
              <THead>
                <Tr>
                  <Th>{t('merchAdmin.col.item')}</Th>
                  <Th>{t('merchAdmin.col.type')}</Th>
                  <Th>{t('merchAdmin.col.seller')}</Th>
                  <Th>{t('merchAdmin.col.dates')}</Th>
                  <Th>{t('merchAdmin.col.position')}</Th>
                  <Th>{t('merchAdmin.col.status')}</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map(b => {
                  const phase = phaseOf(b, now);
                  const days = expiresInDays(b);
                  const open = () => go(`item=${encodeURIComponent(b.id)}`);
                  return (
                    <Tr key={b.id} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') open(); }} onClick={open} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" data-testid={`merch-row-${b.id}`}>
                      <Td className="max-w-[20rem]">
                        <span className="flex items-center gap-3">
                          <Thumb banner={b} />
                          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{headlineOf(b, locale) || '—'}</span>
                        </span>
                      </Td>
                      <Td>{t('merchAdmin.type.banner')}</Td>
                      <Td className="[overflow-wrap:anywhere]">{b.origin === 'staff' ? t('merchAdmin.sellerFitflex') : b.vendorName || b.vendorId}{b.sellerSuspended && <p className="text-xs text-[var(--color-warning-700)]">{t('merchAdmin.sellerSuspendedShort')}</p>}</Td>
                      <Td className="whitespace-nowrap text-xs">{eatDateTime(b.startsAt, locale)}<br />→ {eatDateTime(b.endsAt, locale)}</Td>
                      <Td className="tabular-nums">{b.position ?? '—'}</Td>
                      <Td>
                        <Badge tone={PHASE_TONE[phase]} dot>{t(PHASE_KEY[phase])}</Badge>
                        {days != null && <p className="mt-1 text-xs text-[var(--color-warning-700)]" data-testid={`merch-expires-${b.id}`}>{days === 0 ? t('merchAdmin.expiresToday') : days === 1 ? t('merchAdmin.expiresInOne') : fmt(t('merchAdmin.expiresIn'), { n: days })}</p>}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
