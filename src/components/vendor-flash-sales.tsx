'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Zap } from 'lucide-react';
import { api, type VendorProduct } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { eatDateTime, eatDay, fmt } from '@/lib/vendor';
import { PHASE_TONE, VENDOR_GROUPS, isNetworkError, phaseOf, vendorGroupOf } from '@/lib/shop-banners';
import {
  SALE_GROUP_KEY, SALE_PHASE_KEY, discountPctOf, saleCan, saleErrorCode, saleMessageOf, saleReasonText, salesApi,
  type FlashSale, type SaleRules,
} from '@/lib/flash-sales';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonCard } from './shared';
import { Dialog } from './dialog';
import { FlashSaleForm, SalePriceBlock, SaleThumb } from './flash-sale-form';
import { forgetBannersAvailability } from './shop-banners-gate';
import { useToast } from './ui/toast';
import { useVendor } from './vendor-context';
import { useApp } from '../../app/providers';

type View = { item: string | null; edit: string | null; creating: boolean; copy: string | null; product: string | null };
const viewOf = (search: string): View => {
  const sp = new URLSearchParams(search);
  return { item: sp.get('item'), edit: sp.get('edit'), creating: sp.get('new') === 'sale', copy: sp.get('copy'), product: sp.get('product') };
};
const PAST_SHOWN = 10;
const linkCls = 'inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline';

/**
 * A business's own flash sales (spec shop-home-phase2 §8.3, §4): propose one on an own product with the live
 * "% off · buyers save" line and the 14-day rule, see where each stands and why, change, send, withdraw or end it.
 * FitFlex approves every sale; sales FitFlex set on the business's products are shown read-only.
 * Every URL keeps tab=sales so Back returns here.
 */
export function VendorFlashSales({ tabs }: { tabs: ReactNode }) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [rows, setRows] = useState<FlashSale[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'offline' | 'off'>('loading');
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [view, setView] = useState<View>({ item: null, edit: null, creating: false, copy: null, product: null });
  const [showAllPast, setShowAllPast] = useState(false);
  const [withdrawing, setWithdrawing] = useState<FlashSale | null>(null);
  const [ending, setEnding] = useState<FlashSale | null>(null);
  const [standing, setStanding] = useState<{ canPropose: boolean; reason: string | null } | null>(null);
  const [openProposals, setOpenProposals] = useState<{ open: number; max: number } | null>(null);
  const [rules, setRules] = useState<SaleRules | null>(null);
  const [busy, setBusy] = useState(false);
  const deps = { money: (n: number) => money(n), when: (iso: string) => eatDateTime(iso, locale), day: (ymd: string) => eatDay(ymd, locale) };

  const me = vendor.me;
  const approved = standing ? standing.reason !== 'vendor_not_approved' : !me?.approvalStatus || me.approvalStatus === 'approved';
  const suspended = standing ? standing.reason === 'vendor_suspended' : me?.accountStatus === 'suspended';
  const mayChange = approved && !suspended;
  const full = !!openProposals && openProposals.max > 0 && openProposals.open >= openProposals.max;

  useEffect(() => {
    const sync = () => setView(viewOf(window.location.search));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const go = (q: string) => { const next = `?tab=sales${q ? `&${q}` : ''}`; history.pushState(null, '', next); setView(viewOf(next)); };

  const load = useCallback(async () => {
    if (!token) return;
    setState('loading');
    try {
      const list = await salesApi.vendorList(token);
      setRows(list.items); setStanding(list.vendor ?? null); setOpenProposals(list.openProposals ?? null); setRules(list.rules ?? null); setState('ready');
    } catch (err) {
      if (saleErrorCode(err) === 'feature_disabled') { forgetBannersAvailability(); setState('off'); return; }
      if (vendor.handleError(err)) return;
      setState(isNetworkError(err) ? 'offline' : 'failed');
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  // Own products a sale can be on: on sale and approved. Out of stock is allowed (the form warns).
  useEffect(() => {
    if (!token || !(view.creating || view.edit || view.copy)) return;
    api.vendorProducts(token)
      .then(list => setProducts((Array.isArray(list) ? list : []).filter(p => p.status === 'active' && (p.approvalStatus ?? 'approved') === 'approved')))
      .catch(() => setProducts([]));
  }, [token, view.creating, view.edit, view.copy]);

  useEffect(() => {
    if (!view.item || !rows) return;
    document.getElementById(`sale-card-${view.item}`)?.scrollIntoView({ block: 'center' });
  }, [view.item, rows]);

  const grouped = useMemo(() => {
    const now = Date.now();
    const by = Object.fromEntries(VENDOR_GROUPS.map(g => [g, [] as FlashSale[]])) as Record<(typeof VENDOR_GROUPS)[number], FlashSale[]>;
    for (const s of rows ?? []) by[vendorGroupOf(s, now)].push(s);
    for (const g of VENDOR_GROUPS) by[g].sort((a, b) => Date.parse(b.submittedAt ?? b.createdAt ?? b.startsAt) - Date.parse(a.submittedAt ?? a.createdAt ?? a.startsAt));
    return by;
  }, [rows]);

  const act = async (fn: () => Promise<FlashSale>, doneKey: 'merch.sale.withdrawn' | 'merch.sale.ended' | 'merch.sale.sent', after?: () => void) => {
    if (!token || busy) return;
    setBusy(true);
    try { await fn(); toast.success(t(doneKey)); after?.(); void load(); }
    catch (err) { if (!vendor.handleError(err)) { const m = saleMessageOf(err, deps); toast.error(fmt(t(m.key), m.vars)); } }
    finally { setBusy(false); }
  };

  const header = <PageHeader title={t('merch.entry.title')} description={t('merch.entry.subtitle')}
    actions={mayChange && state === 'ready' && !(view.creating || view.edit || view.copy)
      ? <Button onClick={() => go('new=sale')} disabled={full} className="min-h-11 max-sm:w-full" data-testid="sale-propose"><Plus className="h-4 w-4" />{t('merch.sales.propose')}</Button>
      : undefined} />;

  if (state === 'off') {
    return (
      <div className="space-y-6">
        {header}{tabs}
        <EmptyState icon={<Zap className="h-6 w-6" />} title={t('merch.unavailable')} action={<Link href="/vendor/" className={linkCls} data-testid="sale-unavailable-back">{t('merch.back')}</Link>} />
      </div>
    );
  }
  const pendingNotice = (
    <div className="rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] p-5" data-testid="sale-pending-vendor">
      <p className="font-semibold">{t('merch.pendingTitle')}</p>
      <p className="mt-1 text-sm text-[var(--color-fg-tertiary)]">{t('merch.pendingBody')}</p>
    </div>
  );

  const formView = view.creating || view.edit || view.copy;
  if (formView) {
    if (!approved) return <div className="space-y-6">{header}{pendingNotice}<Button variant="secondary" onClick={() => go('')}>{t('merch.back')}</Button></div>;
    const editing = view.edit ? rows?.find(r => r.id === view.edit) ?? null : null;
    const template = view.copy ? rows?.find(r => r.id === view.copy) ?? null : null;
    if (view.edit && rows && (!editing || !saleCan(editing, 'edit'))) {
      return <div className="space-y-4">{header}<Alert tone="warning">{t(editing ? 'merch.sale.notEditable' : 'merch.notYours')}</Alert><Button variant="secondary" onClick={() => go('')}>{t('merch.back')}</Button></div>;
    }
    if ((view.edit || view.copy) && !rows) return <div className="space-y-4">{header}<SkeletonCard /></div>;
    return (
      <div className="mx-auto max-w-[960px] space-y-6">
        <Button variant="link" onClick={() => go('')} className="-ml-2 h-auto min-h-11 gap-1.5 px-2 text-sm font-normal text-[var(--color-fg-tertiary)] hover:no-underline" data-testid="sale-form-back">
          <ArrowLeft className="h-4 w-4" />{t('merch.back')}
        </Button>
        <PageHeader title={t(editing ? 'merch.sales.edit' : 'merch.sales.propose')} />
        {suspended && <Alert tone="error">{t('merch.sale.suspended')}</Alert>}
        <FlashSaleForm mode="vendor" sale={editing} template={template} initialProductId={view.product} products={products} rules={rules}
          onCancel={() => go('')} onDone={() => { go(''); void load(); }} />
      </div>
    );
  }

  const extraLine = (s: FlashSale) => {
    const p = phaseOf(s);
    if (p === 'pending') return fmt(t('merch.sale.line.expires'), { date: eatDateTime(s.expiresAt ?? s.startsAt, locale) });
    if (p === 'scheduled') return fmt(t('merch.sale.line.starts'), { date: eatDateTime(s.startsAt, locale) });
    if (p === 'live') return fmt(t('merch.sale.line.ends'), { date: eatDateTime(s.endsAt, locale) });
    if (p === 'rejected') return saleReasonText(s, t) ? fmt(t('merch.line.reason'), { reason: saleReasonText(s, t) }) : t('merch.status.rejected');
    if (p === 'expired') return t('merch.sale.line.notReviewed');
    if (p === 'withdrawn') return t('merch.sale.line.youWithdrew');
    if (p === 'ended') {
      const on = fmt(t('merch.sale.line.endedOn'), { date: eatDateTime(s.endedAt ?? s.endsAt, locale) });
      // Contract rev 2: FitFlex suspended the seller, so the sale ended.
      if (s.statusReason === 'vendor_suspended') return `${on} · ${t('merch.sale.endedSuspended')}`;
      const byFitflex = s.endedByFitflex ?? s.statusReason === 'ended_by_fitflex';
      if (!byFitflex) return on;
      const why = saleReasonText(s, t);
      return `${on} · ${why ? fmt(t('merch.sale.endedByFitflexReason'), { reason: why }) : t('merch.sale.endedByFitflex')}`;
    }
    return t('merch.sale.line.draft');
  };

  const card = (s: FlashSale) => {
    const p = phaseOf(s);
    const name = s.productName || s.productId;
    const was = s.wasPriceTzs ?? s.regularPriceTzs;
    const pct = s.discountPct ?? discountPctOf(was, s.salePriceTzs);
    return (
      <Card key={s.id} id={`sale-card-${s.id}`} className={view.item === s.id ? 'ring-2 ring-[var(--color-brand-500)]' : undefined} data-testid={`sale-card-${s.id}`}>
        <div className="flex gap-3 p-4">
          <SaleThumb src={s.productImage} className="h-16 w-16" />
          <div className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">{name}</h3>
              <Badge tone={PHASE_TONE[p]} dot><span data-testid={`sale-status-${s.id}`}>{t(SALE_PHASE_KEY[p])}</span></Badge>
            </div>
            <SalePriceBlock sale={s.salePriceTzs} was={was} pct={pct} size="sm" testId={`sale-price-${s.id}`} />
            <p className="text-xs text-[var(--color-fg-tertiary)]">{eatDateTime(s.startsAt, locale)} → {eatDateTime(s.endsAt, locale)} ({t('merch.dates.tzNote')})</p>
            <p className="text-sm text-[var(--color-fg-secondary)]" data-testid={`sale-line-${s.id}`}>{extraLine(s)}</p>
            {s.origin === 'staff' && <p className="text-xs text-[var(--color-fg-tertiary)]" data-testid={`sale-staff-${s.id}`}>{t('merch.sale.setByFitflex')}</p>}
            <div className="flex flex-wrap gap-1 pt-1">
              {mayChange && saleCan(s, 'submit') && <Button size="sm" className="min-h-11" disabled={busy} onClick={() => void act(() => salesApi.vendorSubmit(token!, s.id), 'merch.sale.sent')} aria-label={fmt(t('merch.sale.sendA11y'), { product: name })} data-testid={`sale-submit-${s.id}`}>{t('merch.send')}</Button>}
              {mayChange && saleCan(s, 'edit') && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => go(`edit=${encodeURIComponent(s.id)}`)} aria-label={fmt(t('merch.sale.editA11y'), { product: name })} data-testid={`sale-edit-${s.id}`}>{t('merch.action.edit')}</Button>}
              {saleCan(s, 'end') && <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setEnding(s)} aria-label={fmt(t('merch.sale.endA11y'), { product: name })} data-testid={`sale-end-${s.id}`}>{t('merch.action.endNow')}</Button>}
              {saleCan(s, 'withdraw') && <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setWithdrawing(s)} aria-label={fmt(t('merch.sale.withdrawA11y'), { product: name })} data-testid={`sale-withdraw-${s.id}`}>{t('merch.action.withdraw')}</Button>}
              {mayChange && s.origin === 'vendor' && vendorGroupOf(s) === 'past' && <Button size="sm" variant="ghost" className="min-h-11" disabled={full} onClick={() => go(`copy=${encodeURIComponent(s.id)}`)} data-testid={`sale-copy-${s.id}`}>{t('merch.action.copy')}</Button>}
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const total = rows?.length ?? 0;
  const itemMissing = !!view.item && state === 'ready' && !rows?.some(r => r.id === view.item);

  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      {header}
      {tabs}
      {suspended && <Alert tone="error">{t('merch.sale.suspended')}</Alert>}
      {!approved && !suspended && pendingNotice}
      {approved && openProposals && openProposals.max > 0 && (
        <p className={full ? 'text-sm font-medium text-[var(--color-warning-700)]' : 'text-sm text-[var(--color-fg-tertiary)]'} data-testid="sale-open-proposals">
          {full ? t('merch.sale.openFull') : fmt(t('merch.openProposals'), { open: openProposals.open, max: openProposals.max })}
        </p>
      )}
      {itemMissing && <Alert tone="warning">{t('merch.notYours')}</Alert>}
      {state === 'loading' && <div className="space-y-3" aria-busy="true"><SkeletonCard /><SkeletonCard /></div>}
      {state === 'failed' && <ErrorState title={t('merch.sales.error')} onRetry={() => void load()} retryLabel={t('common.tryAgain')} />}
      {state === 'offline' && <ErrorState title={t('merch.offlineTitle')} message={t('merch.sales.offlineBody')} onRetry={() => void load()} retryLabel={t('common.tryAgain')} />}
      {state === 'ready' && total === 0 && approved && (
        <EmptyState icon={<Zap className="h-6 w-6" />} title={t('merch.sales.emptyTitle')} body={t('merch.sales.emptyBody')}
          action={mayChange ? <Button onClick={() => go('new=sale')} className="min-h-11" data-testid="sale-propose-empty">{t('merch.sales.propose')}</Button> : undefined} />
      )}
      {state === 'ready' && total > 0 && VENDOR_GROUPS.map(g => {
        const list = grouped[g];
        if (!list.length) return null;
        const shown = g === 'past' && !showAllPast ? list.slice(0, PAST_SHOWN) : list;
        return (
          <section key={g} className="space-y-3" data-testid={`sale-group-${g}`} aria-labelledby={`sale-group-${g}-h`}>
            <h2 id={`sale-group-${g}-h`} className="text-sm font-semibold uppercase tracking-wide text-[var(--color-fg-tertiary)]">{t(SALE_GROUP_KEY[g])} · {list.length}</h2>
            <div className="grid gap-3 lg:grid-cols-2">{shown.map(card)}</div>
            {g === 'past' && list.length > PAST_SHOWN && !showAllPast && <Button variant="ghost" className="min-h-11" onClick={() => setShowAllPast(true)}>{t('merch.action.showMore')}</Button>}
          </section>
        );
      })}

      {/* Owner ruling 2026-10-29: a vendor may end a sale FitFlex set on its products too (when the server allows "end"). */}
      <Dialog open={!!ending} onClose={() => setEnding(null)} title={t('merch.endSale.title')} description={t('merch.endSale.body')} size="sm">
        {ending?.origin === 'staff' && <p className="mb-3 text-sm text-[var(--color-fg-secondary)]" data-testid="sale-end-staff-note">{t('merch.sale.endStaffNote')}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setEnding(null)} data-testid="sale-end-keep">{t('merch.sale.keep')}</Button>
          <Button variant="destructive" loading={busy} onClick={() => ending && void act(() => salesApi.vendorEnd(token!, ending.id), 'merch.sale.ended', () => setEnding(null))} data-testid="sale-end-confirm">{t('merch.action.endNow')}</Button>
        </div>
      </Dialog>
      <Dialog open={!!withdrawing} onClose={() => setWithdrawing(null)} title={t('merch.withdrawSale.title')} description={t('merch.sale.withdrawBody')} size="sm">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setWithdrawing(null)} data-testid="sale-withdraw-keep">{t('merch.sale.keep')}</Button>
          <Button variant="destructive" loading={busy} onClick={() => withdrawing && void act(() => salesApi.vendorWithdraw(token!, withdrawing.id), 'merch.sale.withdrawn', () => setWithdrawing(null))} data-testid="sale-withdraw-confirm">{t('merch.withdraw.confirm')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
