'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ImageIcon, Megaphone, Plus } from 'lucide-react';
import { api, type VendorProduct } from '@/lib/api';
import { eatDateTime, fmt } from '@/lib/vendor';
import {
  AUDIENCE_KEY, PHASE_KEY, PHASE_TONE, VENDOR_GROUPS, VENDOR_GROUP_KEY, bannersApi, canDo, errorCodeOf, errorKeyOf, headlineOf, isNetworkError, phaseOf,
  targetLabelOf, vendorGroupOf, type ShopBanner,
} from '@/lib/shop-banners';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonCard } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { BannerForm } from '@/components/shop-banner-form';
import { useBannerPhoto } from '@/components/shop-banner-preview';
import { forgetBannersAvailability } from '@/components/shop-banners-gate';
import { useToast } from '@/components/ui/toast';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../providers';

type View = { item: string | null; edit: string | null; creating: boolean; copy: string | null };
const viewOf = (search: string): View => {
  const sp = new URLSearchParams(search);
  return { item: sp.get('item'), edit: sp.get('edit'), creating: sp.get('new') === 'banner', copy: sp.get('copy') };
};
const PAST_SHOWN = 10;

function CardThumb({ banner }: { banner: ShopBanner }) {
  const src = useBannerPhoto(banner, 480);
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className="aspect-[16/10] w-full shrink-0 rounded-[var(--radius-lg)] object-cover sm:w-40" />
    : <span className="flex aspect-[16/10] w-full shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-bg-tertiary)] sm:w-40"><ImageIcon aria-hidden="true" className="h-5 w-5 text-[var(--color-fg-quaternary)]" /></span>;
}
const linkCls = 'inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline';

/**
 * A business's own shop banners (spec shop-home-phase2 §5.2): propose one, see where each stands and why,
 * change or withdraw it before it goes live. FitFlex approves every banner. Flash sales join in slice 4.
 */
export default function VendorPromotionsPage() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [rows, setRows] = useState<ShopBanner[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'offline' | 'off'>('loading');
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [view, setView] = useState<View>({ item: null, edit: null, creating: false, copy: null });
  const [showAllPast, setShowAllPast] = useState(false);
  const [withdrawing, setWithdrawing] = useState<ShopBanner | null>(null);
  const [ending, setEnding] = useState<ShopBanner | null>(null);
  const [standing, setStanding] = useState<{ canPropose: boolean; reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const me = vendor.me;
  // The list's own answer wins (vendor.canPropose / reason); /vendor/me is the first guess.
  const approved = standing ? standing.reason !== 'vendor_not_approved' : !me?.approvalStatus || me.approvalStatus === 'approved';
  const suspended = standing ? standing.reason === 'vendor_suspended' : me?.accountStatus === 'suspended';

  useEffect(() => {
    const sync = () => setView(viewOf(window.location.search));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const go = (q: string) => { history.pushState(null, '', q ? `?${q}` : window.location.pathname); setView(viewOf(q ? `?${q}` : '')); };

  const load = useCallback(async () => {
    if (!token) return;
    setState('loading');
    try {
      const list = await bannersApi.vendorList(token);
      setRows(list.items); setStanding(list.vendor ?? null); setState('ready');
    }
    catch (err) {
      if (errorCodeOf(err) === 'feature_disabled') { forgetBannersAvailability(); setState('off'); return; }
      if (vendor.handleError(err)) return;
      setState(isNetworkError(err) ? 'offline' : 'failed');
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  // Own products that can be linked: on sale, approved and in stock (spec §5.2.3 field 7).
  useEffect(() => {
    if (!token || !(view.creating || view.edit || view.copy)) return;
    api.vendorProducts(token)
      .then(list => setProducts((Array.isArray(list) ? list : []).filter(p => p.status === 'active' && (p.approvalStatus ?? 'approved') === 'approved' && (p.stock ?? 0) > 0)))
      .catch(() => setProducts([]));
  }, [token, view.creating, view.edit, view.copy]);

  // A deep link (?item=, e.g. from a notification) scrolls to that card.
  useEffect(() => {
    if (!view.item || !rows) return;
    document.getElementById(`banner-card-${view.item}`)?.scrollIntoView({ block: 'center' });
  }, [view.item, rows]);

  const grouped = useMemo(() => {
    const now = Date.now();
    const by = Object.fromEntries(VENDOR_GROUPS.map(g => [g, [] as ShopBanner[]])) as Record<(typeof VENDOR_GROUPS)[number], ShopBanner[]>;
    for (const b of rows ?? []) by[vendorGroupOf(b, now)].push(b);
    for (const g of VENDOR_GROUPS) by[g].sort((a, b) => Date.parse(b.submittedAt ?? b.createdAt ?? b.startsAt) - Date.parse(a.submittedAt ?? a.createdAt ?? a.startsAt));
    return by;
  }, [rows]);

  async function withdraw(b: ShopBanner) {
    if (!token || busy) return;
    setBusy(true);
    try {
      const next = await bannersApi.vendorWithdraw(token, b.id);
      setRows(cur => (cur ?? []).map(r => (r.id === b.id ? { ...r, ...next, status: next?.status ?? 'withdrawn' } : r)));
      toast.success(t('merch.withdrawn'));
      setWithdrawing(null);
      void load();
    } catch (err) {
      if (!vendor.handleError(err)) toast.error(t(errorKeyOf(err)));
    } finally { setBusy(false); }
  }
  async function end(b: ShopBanner) {
    if (!token || busy) return;
    setBusy(true);
    try { await bannersApi.vendorEnd(token, b.id); toast.success(t('merch.ended')); setEnding(null); void load(); }
    catch (err) { if (!vendor.handleError(err)) toast.error(t(errorKeyOf(err))); }
    finally { setBusy(false); }
  }
  async function submit(b: ShopBanner) {
    if (!token || busy) return;
    setBusy(true);
    try { await bannersApi.vendorSubmit(token, b.id); toast.success(t('merch.sent')); void load(); }
    catch (err) { if (!vendor.handleError(err)) toast.error(t(errorKeyOf(err))); }
    finally { setBusy(false); }
  }

  const header = <PageHeader title={t('merch.title')} description={t('merch.entry.subtitle')} />;

  if (state === 'off') {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState icon={<Megaphone className="h-6 w-6" />} title={t('merch.unavailable')} action={<Link href="/vendor/" className={linkCls} data-testid="merch-unavailable-back">{t('merch.back')}</Link>} />
      </div>
    );
  }
  if (!approved) {
    return (
      <div className="space-y-6" data-testid="merch-pending-vendor">
        {header}
        <EmptyState icon={<Megaphone className="h-6 w-6" />} title={t('merch.pendingTitle')} body={t('merch.pendingBody')} />
      </div>
    );
  }

  const formView = view.creating || view.edit || view.copy;
  if (formView) {
    const editing = view.edit ? rows?.find(r => r.id === view.edit) ?? null : null;
    const template = view.copy ? rows?.find(r => r.id === view.copy) ?? null : null;
    if (view.edit && rows && (!editing || !canDo(editing, 'edit'))) {
      return <div className="space-y-4">{header}<Alert tone="warning">{t(editing ? 'merch.notEditable' : 'merch.notYours')}</Alert><Button variant="secondary" onClick={() => go('')}>{t('merch.back')}</Button></div>;
    }
    if ((view.edit || view.copy) && !rows) return <div className="space-y-4">{header}<SkeletonCard /></div>;
    return (
      <div className="space-y-6">
        <Button variant="link" onClick={() => go('')} className="-ml-2 h-auto min-h-11 gap-1.5 px-2 text-sm font-normal text-[var(--color-fg-tertiary)] hover:no-underline" data-testid="merch-form-back">
          <ArrowLeft className="h-4 w-4" />{t('merch.back')}
        </Button>
        <PageHeader title={t(editing ? 'merch.banners.edit' : 'merch.banners.propose')} />
        {suspended && <Alert tone="error">{t('merch.suspended')}</Alert>}
        <BannerForm mode="vendor" banner={editing} template={template} vendorId={me?.vendorId} vendorName={me?.businessName} products={products}
          onCancel={() => go('')} onDone={() => { go(''); void load(); }} />
      </div>
    );
  }

  const audiences = (b: ShopBanner) => (b.audienceRoles ?? []).map(r => (AUDIENCE_KEY[r] ? t(AUDIENCE_KEY[r]) : r)).join(', ');
  const extraLine = (b: ShopBanner) => {
    const p = phaseOf(b);
    if (p === 'pending') return fmt(t('merch.line.expires'), { date: eatDateTime(b.expiresAt ?? b.startsAt, locale) });
    if (p === 'scheduled') return fmt(t('merch.line.starts'), { date: eatDateTime(b.startsAt, locale) });
    if (p === 'live') return fmt(t('merch.line.ends'), { date: eatDateTime(b.endsAt, locale) });
    if (p === 'rejected') return b.statusReason ? fmt(t('merch.line.reason'), { reason: b.statusReason }) : t('merch.status.rejected');
    if (p === 'expired') return t('merch.line.notReviewed');
    if (p === 'withdrawn') return t('merch.line.youWithdrew');
    if (p === 'ended') return (b.endedByFitflex ?? !!b.statusReason) && b.statusReason ? fmt(t('merch.line.endedByFitflex'), { reason: b.statusReason }) : fmt(t('merch.line.endedOn'), { date: eatDateTime(b.endsAt, locale) });
    return t('merch.line.draft');
  };
  const targetLine = (b: ShopBanner) => b.target?.type === 'vendor_store' ? t('merch.line.linksStore')
    : fmt(t('merch.line.linksProduct'), { product: b.targetName || products.find(p => p.id === b.target?.value)?.name || targetLabelOf(b) || t('merch.line.oneProduct') });

  const card = (b: ShopBanner) => {
    const p = phaseOf(b);
    const headline = headlineOf(b, locale) || '—';
    return (
      <Card key={b.id} id={`banner-card-${b.id}`} className={view.item === b.id ? 'ring-2 ring-[var(--color-brand-500)]' : undefined} data-testid={`banner-card-${b.id}`}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row">
          <CardThumb banner={b} />
          <div className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">{headline}</h3>
              <Badge tone={PHASE_TONE[p]} dot><span data-testid={`banner-status-${b.id}`}>{t(PHASE_KEY[p])}</span></Badge>
            </div>
            <p className="text-xs text-[var(--color-fg-tertiary)]">{eatDateTime(b.startsAt, locale)} → {eatDateTime(b.endsAt, locale)}</p>
            <p className="text-sm text-[var(--color-fg-secondary)]" data-testid={`banner-line-${b.id}`}>{extraLine(b)}</p>
            <p className="text-xs text-[var(--color-fg-tertiary)]">{targetLine(b)}</p>
            <p className="text-xs text-[var(--color-fg-tertiary)]">{fmt(t('merch.line.shownTo'), { audiences: audiences(b) })}</p>
            <div className="flex flex-wrap gap-1 pt-1">
              {canDo(b, 'submit') && <Button size="sm" className="min-h-11" disabled={busy || suspended} onClick={() => void submit(b)} aria-label={fmt(t('merch.action.sendA11y'), { headline })} data-testid={`banner-submit-${b.id}`}>{t('merch.send')}</Button>}
              {canDo(b, 'edit') && <Button size="sm" variant="ghost" className="min-h-11" disabled={suspended} onClick={() => go(`edit=${encodeURIComponent(b.id)}`)} aria-label={fmt(t('merch.action.editA11y'), { headline })} data-testid={`banner-edit-${b.id}`}>{t('merch.action.edit')}</Button>}
              {canDo(b, 'end') && <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setEnding(b)} aria-label={fmt(t('merch.action.endA11y'), { headline })} data-testid={`banner-end-${b.id}`}>{t('merch.action.endNow')}</Button>}
              {canDo(b, 'withdraw') && <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setWithdrawing(b)} aria-label={fmt(t('merch.action.withdrawA11y'), { headline })} data-testid={`banner-withdraw-${b.id}`}>{t('merch.action.withdraw')}</Button>}
              {vendorGroupOf(b) === 'past' && <Button size="sm" variant="ghost" className="min-h-11" disabled={suspended} onClick={() => go(`copy=${encodeURIComponent(b.id)}`)} data-testid={`banner-copy-${b.id}`}>{t('merch.action.copy')}</Button>}
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
      <PageHeader
        title={t('merch.title')}
        description={t('merch.entry.subtitle')}
        actions={<Button onClick={() => go('new=banner')} disabled={suspended || state !== 'ready'} className="min-h-11 max-sm:w-full" data-testid="merch-propose"><Plus className="h-4 w-4" />{t('merch.banners.propose')}</Button>}
      />
      {/* Flash sales join as a second tab in slice 4. */}
      <div role="tablist" aria-label={t('merch.title')} className="flex w-fit gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1">
        <button role="tab" aria-selected="true" className="flex min-h-11 items-center rounded-md bg-[var(--color-bg-primary)] px-3 text-sm font-semibold shadow-sm">{t('merch.tab.banners')}</button>
      </div>
      {suspended && <Alert tone="error">{t('merch.suspended')}</Alert>}
      {itemMissing && <Alert tone="warning">{t('merch.notYours')}</Alert>}
      {state === 'loading' && <div className="space-y-3" aria-busy="true"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      {state === 'failed' && <ErrorState title={t('merch.banners.error')} onRetry={() => void load()} retryLabel={t('common.tryAgain')} />}
      {state === 'offline' && <ErrorState title={t('merch.offlineTitle')} message={t('merch.offlineBody')} onRetry={() => void load()} retryLabel={t('common.tryAgain')} />}
      {state === 'ready' && total === 0 && (
        <EmptyState icon={<Megaphone className="h-6 w-6" />} title={t('merch.banners.emptyTitle')} body={t('merch.banners.emptyBody')}
          action={!suspended ? <Button onClick={() => go('new=banner')} className="min-h-11" data-testid="merch-propose-empty">{t('merch.banners.propose')}</Button> : undefined} />
      )}
      {state === 'ready' && total > 0 && VENDOR_GROUPS.map(g => {
        const list = grouped[g];
        if (!list.length) return null;
        const shown = g === 'past' && !showAllPast ? list.slice(0, PAST_SHOWN) : list;
        return (
          <section key={g} className="space-y-3" data-testid={`merch-group-${g}`} aria-labelledby={`merch-group-${g}-h`}>
            <h2 id={`merch-group-${g}-h`} className="text-sm font-semibold uppercase tracking-wide text-[var(--color-fg-tertiary)]">{t(VENDOR_GROUP_KEY[g])} · {list.length}</h2>
            <div className="grid gap-3 lg:grid-cols-2">{shown.map(card)}</div>
            {g === 'past' && list.length > PAST_SHOWN && !showAllPast && <Button variant="ghost" className="min-h-11" onClick={() => setShowAllPast(true)}>{t('merch.action.showMore')}</Button>}
          </section>
        );
      })}

      <Dialog open={!!ending} onClose={() => setEnding(null)} title={t('merch.endBanner.title')} description={t('merch.endBanner.body')} size="sm">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setEnding(null)} data-testid="banner-end-keep">{t('merch.withdraw.keep')}</Button>
          <Button variant="destructive" loading={busy} onClick={() => ending && void end(ending)} data-testid="banner-end-confirm">{t('merch.action.endNow')}</Button>
        </div>
      </Dialog>
      <Dialog open={!!withdrawing} onClose={() => setWithdrawing(null)} title={t('merch.withdrawBanner.title')} description={t('merch.withdraw.body')} size="sm">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setWithdrawing(null)} data-testid="banner-withdraw-keep">{t('merch.withdraw.keep')}</Button>
          <Button variant="destructive" loading={busy} onClick={() => withdrawing && void withdraw(withdrawing)} data-testid="banner-withdraw-confirm">{t('merch.withdraw.confirm')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
