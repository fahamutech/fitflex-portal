'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ImageIcon, Megaphone, Plus, RefreshCw, Search } from 'lucide-react';
import { useApp } from '../../providers';
import { api, type ShopProduct, type VendorSummary } from '@/lib/api';
import { eatDateTime, fmt, type Category } from '@/lib/vendor';
import {
  MERCH_EMPTY_KEY, MERCH_KINDS, MERCH_TABS, MERCH_TAB_KEY, PHASE_KEY, PHASE_TONE, bannersApi, errorCodeOf, errorKeyOf, headlineOf, phaseOf, tabOfBanner,
  type BannerConfirmation, type MerchTab, type ShopBanner,
} from '@/lib/shop-banners';
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

type View = { item: string | null; edit: string | null; creating: boolean };
const viewOf = (search: string): View => {
  const sp = new URLSearchParams(search);
  return { item: sp.get('item'), edit: sp.get('edit'), creating: sp.get('new') === 'banner' };
};
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
 * Shop banners & flash sales (spec shop-home-phase2 §5.3): what sellers propose for the shop home and what
 * FitFlex staff create, by what it is now. One at a time in detail (?item=), create (?new=banner), edit (?edit=).
 * Banners only in slice 1; flash sales join the same queue in slice 4.
 */
export default function ShopMerchPage() {
  const { token, user, t, locale, hasPermission } = useApp();
  const [rows, setRows] = useState<ShopBanner[] | null>(null);
  const [serverCounts, setServerCounts] = useState<Partial<Record<MerchTab, number>> | null>(null);
  const [confirmation, setConfirmation] = useState<BannerConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [tab, setTab] = useState<MerchTab>('requests');
  const [kind, setKind] = useState<string>('all');
  const [query, setQuery] = useState('');
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
      setRows(list.items); setServerCounts(list.counts ?? null); setConfirmation(list.confirmation ?? null); setDisabled(false);
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
        <BannerForm mode="staff" banner={editing} confirmation={confirmation} onConfirmationStale={() => void load()} products={products} vendors={vendors} categories={categories}
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
  const needle = query.trim().toLowerCase();
  const shown = (rows ?? []).filter(r => tabOfBanner(r, now) === tab)
    .filter(r => kind === 'all' || kind === 'banner')
    .filter(r => !needle || [r.vendorName, r.targetName, r.headlineLead?.en, r.headlineLead?.sw, r.headlineAccent?.en, r.headlineAccent?.sw]
      .some(v => String(v ?? '').toLowerCase().includes(needle)))
    // Requests: soonest to expire first (as the server sorts them); the rest by position, then start.
    .sort((a, b) => (tab === 'requests' ? (Date.parse(a.expiresAt ?? a.startsAt) - Date.parse(b.expiresAt ?? b.startsAt)) || a.id.localeCompare(b.id)
      : (a.position ?? 999) - (b.position ?? 999) || Date.parse(a.startsAt) - Date.parse(b.startsAt)));
  // Under 72 hours to expiry: warn; under a day, in hours (spec §5.3.1, QA1 #5).
  const expiryText = (b: ShopBanner): string | null => {
    if (phaseOf(b, now) !== 'pending') return null;
    const left = Date.parse(b.expiresAt ?? b.startsAt) - now;
    if (!Number.isFinite(left) || left <= 0 || left >= 72 * HOUR) return null;
    if (left < HOUR) return t('merchAdmin.expiresSoon');
    if (left < 24 * HOUR) { const h = Math.floor(left / HOUR); return h === 1 ? t('merchAdmin.expiresInOneHour') : fmt(t('merchAdmin.expiresInHours'), { n: h }); }
    const d = Math.floor(left / (24 * HOUR));
    return d === 1 ? t('merchAdmin.expiresInOne') : fmt(t('merchAdmin.expiresIn'), { n: d });
  };
  const sentText = (b: ShopBanner) => relative(b.submittedAt ?? b.createdAt, now, locale);
  const seller = (b: ShopBanner) => (b.origin === 'staff' ? t('merchAdmin.sellerFitflex') : b.vendorName || b.vendorId || '');

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
        {/* Type filter (spec §5.3.1). Flash sales join it in slice 4. */}
        <div role="group" aria-label={t('merchAdmin.col.type')} data-testid="merch-type-filter">
          <Segmented value={kind} onChange={setKind} options={[['all', t('merchAdmin.type.all')], ...MERCH_KINDS.map(k => [k, t('merchAdmin.type.banner')] as [string, string])]} />
        </div>
        <div className="relative w-full sm:w-72">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-fg-quaternary)]" />
          <Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('merchAdmin.search')} aria-label={t('merchAdmin.search')} className="pl-9" data-testid="merch-search" />
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : shown.length === 0 ? (error ? null : (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]" data-testid="merch-empty">
              <Megaphone aria-hidden="true" className="h-6 w-6" />{t(MERCH_EMPTY_KEY[tab])}
            </div>
          )) : (
            <>
            {/* Phones: stacked cards (spec §5.3.1, QA1 #6). */}
            <ul className="divide-y divide-[var(--color-border-secondary)] sm:hidden" aria-label={t(MERCH_TAB_KEY[tab])} data-testid="merch-cards">
              {shown.map(b => {
                const phase = phaseOf(b, now);
                const exp = expiryText(b);
                return (
                  <li key={b.id}>
                    <button type="button" onClick={() => go(`item=${encodeURIComponent(b.id)}`)} className="flex w-full min-h-11 items-start gap-3 p-4 text-left hover:bg-[var(--color-bg-secondary)]" data-testid={`merch-card-${b.id}`}>
                      <Thumb banner={b} />
                      <span className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]">
                        <span className="block font-medium">{headlineOf(b, locale) || '—'}</span>
                        <span className="block text-xs text-[var(--color-fg-tertiary)]">{t('merchAdmin.type.banner')} · {seller(b)}</span>
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
                  <Th>{t('merchAdmin.col.position')}</Th>
                  <Th>{t('merchAdmin.col.status')}</Th>
                  <Th>{t('merchAdmin.col.sent')}</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map(b => {
                  const phase = phaseOf(b, now);
                  const exp = expiryText(b);
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
                      <Td className="[overflow-wrap:anywhere]">{seller(b)}{b.sellerSuspended && <p className="text-xs text-[var(--color-warning-700)]">{t('merchAdmin.sellerSuspendedShort')}</p>}</Td>
                      <Td className="whitespace-nowrap text-xs">{eatDateTime(b.startsAt, locale)}<br />→ {eatDateTime(b.endsAt, locale)}</Td>
                      <Td className="tabular-nums">{b.position ?? '—'}</Td>
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
