'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Package } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ShopProduct, VendorSummary } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { eatDateTime, eatDay, fmt } from '@/lib/vendor';
import {
  DEFAULT_RULES, HOUR_MS, discountPctOf, maxSalePriceOf, parsePrice, productImageUrl, saleErrorCode, saleMessageOf, saleReasonText, salesApi, standingDiscountOf, validateSale,
  type FlashSale, type PriceCheck, type SaleErrors, type SaleRules,
} from '@/lib/flash-sales';
import { Alert, Button, Card, CardContent, Field, Input } from './shared';
import { Dialog, DialogFooter } from './dialog';
import { SearchableSelect } from './searchable-select';
import { EatDateTime } from './shop-banner-form';
import { useToast } from './ui/toast';
import { useApp } from '../../app/providers';

/** Fuel tokens (design system V2): sale price and the "−N%" badge. Never colour alone: the text says it. */
const FUEL_TEXT = 'text-[var(--color-fuel)]';
const FUEL_BADGE = 'inline-flex items-center rounded-full bg-[var(--color-fuel-50)] px-2 py-0.5 text-xs font-semibold text-[var(--color-fuel)] ring-1 ring-inset ring-[var(--color-fuel-200)]';

/** A product photo, or a placeholder. */
export function SaleThumb({ src, className }: { src: string | null | undefined; className?: string }) {
  const url = productImageUrl(src);
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" className={cn('shrink-0 rounded-[var(--radius-md)] object-cover', className)} />
    : <span className={cn('flex shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-tertiary)]', className)}><Package aria-hidden="true" className="h-4 w-4 text-[var(--color-fg-quaternary)]" /></span>;
}

/**
 * The sale price block (spec §8.1): sale price in Fuel, the struck "was" price on its own line, the "−N%" badge.
 * Read once by a screen reader: "Sale price {sale}, was {old}, {pct} percent off".
 */
export function SalePriceBlock({ sale, was, pct, size = 'md', testId }: { sale: number; was: number; pct: number | null; size?: 'sm' | 'md'; testId?: string }) {
  const { t } = useApp();
  return (
    <span className="inline-flex flex-col" role="group" aria-label={fmt(t('shop.a11y.salePrice'), { sale: money(sale), old: money(was), pct: pct ?? '—' })} data-testid={testId}>
      <span aria-hidden="true" className="flex flex-wrap items-center gap-2">
        <span className={cn('font-extrabold tabular-nums', FUEL_TEXT, size === 'md' ? 'text-base' : 'text-sm')}>{money(sale)}</span>
        {pct != null && <span className={FUEL_BADGE}>−{pct}%</span>}
      </span>
      <s aria-hidden="true" className="text-xs tabular-nums text-[var(--color-fg-quaternary)]">{money(was)}</s>
    </span>
  );
}

const fmtDeps = (locale: 'en' | 'sw') => ({ money: (n: number) => money(n), when: (iso: string) => eatDateTime(iso, locale), day: (ymd: string) => eatDay(ymd, locale) });

type CheckState = { state: 'idle' | 'loading' | 'done' | 'failed'; result: PriceCheck | null };

/**
 * Propose (vendor) or create (staff) a flash sale, or change one that may still be changed (spec §8.3, §5.3.3).
 * Sale price with live "% off · buyers save" (pct = floor((regular − sale) / regular × 100)), at least 5% off,
 * below any standing discount, no maximum; Tanzania-time window of 1 hour to 7 days; the 14-day rule checked
 * with the server as soon as product and start are set (vendor). Saved as a draft, then sent for approval
 * (vendor: to FitFlex; staff: to another admin). The server re-checks every rule.
 */
export function FlashSaleForm({ mode, sale, template, initialProductId, products, vendors, rules, onCancel, onDone }: {
  mode: 'vendor' | 'staff';
  sale: FlashSale | null;
  /** "Copy to new": a past sale's product and price (no dates). */
  template?: FlashSale | null;
  /** Pre-filled product (the products list "Start a flash sale"). */
  initialProductId?: string | null;
  /** Vendor: own active, approved products. Staff: every vendor's products. */
  products: ShopProduct[];
  vendors?: VendorSummary[];
  rules?: SaleRules | null;
  onCancel: () => void;
  onDone: (s: FlashSale) => void;
}) {
  const { token, t, locale } = useApp();
  const toast = useToast();
  const uid = useId();
  const fid = (f: string) => `${uid}-${f}`;
  const isVendor = mode === 'vendor';
  const r = rules ?? DEFAULT_RULES;
  const initial = useMemo(() => ({
    productId: sale?.productId ?? template?.productId ?? initialProductId ?? '',
    salePrice: sale ? String(sale.salePriceTzs) : template ? String(template.salePriceTzs) : '',
    startsAt: sale?.startsAt ?? '',
    endsAt: sale?.endsAt ?? '',
  }), [sale, template, initialProductId]);
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<SaleErrors>({});
  const [errVars, setErrVars] = useState<Partial<Record<keyof SaleErrors, Record<string, string | number>>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<FlashSale | null>(sale);
  const [check, setCheck] = useState<CheckState>({ state: 'idle', result: null });
  const [confirmResend, setConfirmResend] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const checkSeq = useRef(0);

  const product = products.find(p => p.id === d.productId) ?? null;
  const fixedProduct = !!saved; // productId can't change after create (400 product_not_editable)
  const resends = !!saved && (saved.effectiveStatus ?? saved.status) === 'approved';
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  // 14-day rule and one-sale-per-product check (vendor; GET /vendor/flash-sales/price-check). Staff get it on create.
  useEffect(() => {
    if (!isVendor || !token || !d.productId) { setCheck({ state: 'idle', result: null }); return; }
    const seq = ++checkSeq.current;
    const ctrl = new AbortController();
    setCheck(c => ({ state: 'loading', result: c.result?.productId === d.productId ? c.result : null }));
    const timer = window.setTimeout(() => {
      salesApi.vendorPriceCheck(token, d.productId, d.startsAt || undefined, ctrl.signal)
        .then(res => { if (seq === checkSeq.current) setCheck({ state: 'done', result: res }); })
        .catch(err => { if (seq === checkSeq.current && !(err instanceof DOMException && err.name === 'AbortError')) setCheck({ state: 'failed', result: null }); });
    }, 300);
    return () => { window.clearTimeout(timer); ctrl.abort(); };
  }, [isVendor, token, d.productId, d.startsAt]);

  const res = check.state === 'done' ? check.result : null;
  // The server's prices win (they are "now"); the product row is the first guess.
  const regular = res?.regularPriceTzs ?? (saved && saved.productId === d.productId ? saved.regularPriceTzs : undefined) ?? product?.priceTzs ?? null;
  const discount = res ? res.discountPriceTzs : (saved && saved.productId === d.productId ? saved.discountPriceTzs ?? null : product?.discountPriceTzs ?? null);
  const standing = regular != null ? standingDiscountOf(regular, discount) : null;
  const prices = regular != null ? { regular, discount } : null;
  const salePrice = parsePrice(d.salePrice);
  const livePct = regular != null && Number.isInteger(salePrice) && salePrice > 0 && salePrice < regular ? discountPctOf(regular, salePrice) : null;
  // Another sale holds the product (the one being edited never counts against itself).
  const lock = res?.lockedBy && res.lockedBy.saleId !== saved?.id ? res.lockedBy : null;
  const raised = !!res?.raisedAt && !!res.earliestStart;
  const checkBlocks = isVendor && (check.state === 'loading' || raised || !!lock);

  const set = (patch: Partial<typeof d>) => {
    setD(cur => ({ ...cur, ...patch }));
    setErrors(e => { const next = { ...e }; for (const k of Object.keys(patch)) delete next[(k === 'salePrice' ? 'salePriceTzs' : k) as keyof SaleErrors]; return next; });
    setGeneral(null);
  };
  const startOnEarliest = () => {
    if (!res?.earliestStart) return;
    const earliest = Math.max(Date.parse(res.earliestStart), Date.now() + r.minLeadMs);
    const start = Date.parse(d.startsAt); const end = Date.parse(d.endsAt);
    const len = Number.isFinite(start) && Number.isFinite(end) && end - start >= r.minLengthMs && end - start <= r.maxLengthMs ? end - start : 24 * HOUR_MS;
    set({ startsAt: new Date(earliest).toISOString(), endsAt: new Date(earliest + len).toISOString() });
  };

  const deps = fmtDeps(locale);
  function localErrors(): SaleErrors {
    return validateSale(d, prices, deps.money, { rules: r, checkStart: !saved || d.startsAt !== saved.startsAt });
  }
  const focusFirst = (e: SaleErrors) => {
    const first = (['productId', 'salePriceTzs', 'startsAt', 'endsAt'] as const).find(f => e[f]);
    if (first) requestAnimationFrame(() => document.getElementById(fid(first))?.focus());
  };

  async function save() {
    if (!token || busy) return;
    const e = localErrors();
    setErrors(e); setErrVars({});
    if (Object.keys(e).length) { focusFirst(e); return; }
    if (checkBlocks) return;
    if (resends && !confirmResend) { setConfirmResend(true); return; }
    setConfirmResend(false);
    setBusy(true); setGeneral(null);
    const body = { salePriceTzs: salePrice, startsAt: d.startsAt, endsAt: d.endsAt };
    let current = saved;
    try {
      if (!current) current = isVendor ? await salesApi.vendorCreate(token, { productId: d.productId, ...body }) : await salesApi.adminCreate(token, { productId: d.productId, ...body });
      else if (dirty || current.status !== 'draft') current = isVendor ? await salesApi.vendorUpdate(token, current.id, body) : await salesApi.adminUpdate(token, current.id, body);
      setSaved(current);
      // A draft (new, or rejected and changed) is sent: to FitFlex (vendor) or another admin (staff). Pending stays pending;
      // a scheduled one went back to pending with the edit.
      if (current.status === 'draft') current = isVendor ? await salesApi.vendorSubmit(token, current.id) : await salesApi.adminSubmit(token, current.id);
      toast.success(t(isVendor ? 'merch.sent' : 'merchAdmin.saleCreated'));
      onDone(current);
    } catch (err) {
      const m = saleMessageOf(err, deps);
      if (m.field) {
        const fe: SaleErrors = { [m.field]: { key: m.key, vars: m.vars } };
        setErrors(fe); setErrVars({ [m.field]: m.vars }); focusFirst(fe);
      } else {
        setGeneral(fmt(t(m.key), m.vars));
        if (saleErrorCode(err) === null) toast.error(fmt(t(m.key), m.vars));
      }
    } finally {
      setBusy(false);
    }
  }

  const err = (f: keyof SaleErrors) => (errors[f] ? fmt(t(errors[f]!.key), errors[f]!.vars ?? errVars[f] ?? {}) : undefined);
  // The price rules show while typing (S4-AC-02/03): under 5% off, or not below the standing discount.
  const livePriceErr = d.salePrice ? validateSale({ ...d, startsAt: '', endsAt: '' }, prices, deps.money, { rules: r }).salePriceTzs : undefined;
  const priceErr = err('salePriceTzs') ?? (livePriceErr ? fmt(t(livePriceErr.key), livePriceErr.vars ?? {}) : undefined);
  const productOptions = products.map(p => ({
    value: p.id, label: p.name,
    sub: [!isVendor ? vendors?.find(v => v.id === p.vendorId)?.displayName ?? undefined : undefined, money(p.priceTzs)].filter(Boolean).join(' · '),
  }));
  const submitLabel: MessageKey = isVendor ? 'merch.send' : saved ? 'merchAdmin.saveSale' : 'merchAdmin.createSale';

  return (
    <div className="max-w-[640px] space-y-6" data-testid="sale-form">
      <form noValidate onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-6">
        {general && <Alert tone="error"><span data-testid="sale-general-error">{general}</span></Alert>}
        {resends && <Alert tone="warning">{t('merch.resend.body')}</Alert>}
        {saved?.status === 'rejected' && saleReasonText(saved, t) && <Alert tone="warning">{fmt(t('merch.line.reason'), { reason: saleReasonText(saved, t) })}</Alert>}

        <Card><CardContent className="space-y-5 p-5">
          {/* 1. Product */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fid('productId')} className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merch.sale.product')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></label>
            {fixedProduct
              ? <p id={fid('productId')} tabIndex={-1} className="text-sm font-medium" data-testid="sale-product-fixed">{saved?.productName || product?.name || saved?.productId}</p>
              : products.length === 0
                ? <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="sale-no-products">{t(isVendor ? 'merch.sale.noProducts' : 'merchAdmin.noProducts')}</p>
                : <div id={fid('productId')} tabIndex={-1} data-testid="sale-product-picker"><SearchableSelect options={productOptions} value={d.productId} onChange={v => set({ productId: String(v) })}
                    placeholder={t('merch.sale.pickProduct')} ariaLabel={t('merch.sale.product')} disabled={busy} /></div>}
            {errors.productId && <span className="text-xs text-[var(--color-error-700)]" data-testid="sale-product-error">{err('productId')}</span>}
            {product && (product.stock ?? 0) <= 0 && <p className="text-xs text-[var(--color-warning-700)]" data-testid="sale-oos">{t('merch.sale.oos')}</p>}
          </div>

          {/* 2. Regular price (read-only) */}
          {regular != null && (
            <div className="space-y-0.5 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="sale-regular">
              <p>{fmt(t('merch.sale.regular'), { price: money(regular) })}</p>
              {standing != null && <p className="text-[var(--color-fg-tertiary)]" data-testid="sale-current-discount">{fmt(t('merch.sale.currentDiscount'), { price: money(standing) })}</p>}
            </div>
          )}

          {/* 3. Sale price with live % and TSh */}
          <Field label={t('merch.sale.price')} required error={priceErr}
            hint={livePct != null && regular != null
              ? <span className={cn('font-semibold', FUEL_TEXT)} data-testid="sale-live">{fmt(t('merch.sale.live'), { pct: livePct, saving: money(regular - salePrice) })}</span>
              : regular != null ? fmt(t('merch.sale.maxHint'), { max: money(maxSalePriceOf(regular, r.minDiscountPct)) }) : undefined}>
            <Input id={fid('salePriceTzs')} inputMode="numeric" autoComplete="off" value={d.salePrice} disabled={busy}
              onChange={e => set({ salePrice: e.target.value.replace(/[^\d,]/g, '') })} data-testid="sale-price" />
          </Field>
          {priceErr && livePct != null && regular != null && (
            <p className={cn('-mt-3 text-xs font-semibold', FUEL_TEXT)} data-testid="sale-live">{fmt(t('merch.sale.live'), { pct: livePct, saving: money(regular - salePrice) })}</p>
          )}

          {/* 4. Window, Tanzania time */}
          <div className="grid gap-4 sm:grid-cols-2">
            {(['startsAt', 'endsAt'] as const).map(k => (
              <div key={k} className="flex flex-col gap-1.5">
                <label htmlFor={fid(k)} className="text-sm font-medium text-[var(--color-fg-secondary)]">{t(k === 'startsAt' ? 'merch.dates.starts' : 'merch.dates.ends')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></label>
                <EatDateTime id={fid(k)} value={d[k]} onChange={v => set({ [k]: v })} invalid={!!errors[k]} describedBy={`${fid(k)}-msg`} testId={`sale-${k}`} />
                <span id={`${fid(k)}-msg`} className={cn('text-xs', errors[k] ? 'text-[var(--color-error-700)]' : 'text-[var(--color-fg-quaternary)]')} data-testid={`sale-${k}-msg`}>{err(k) ?? t('merch.dates.tzNote')}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--color-fg-tertiary)]">{t('merch.sale.length')}</p>
        </CardContent></Card>

        {/* The 14-day rule and one sale per product (spec §8.3), above the buttons */}
        {isVendor && raised && res && (
          <Alert tone="error">
            <span className="flex flex-col items-start gap-2" data-testid="sale-raised">
              <span>{fmt(t('merch.sale.raised'), { date: res.raisedOn ? eatDay(res.raisedOn, locale) : eatDateTime(res.raisedAt, locale), earliest: eatDateTime(res.earliestStart, locale) })}</span>
              <Button type="button" size="sm" variant="secondary" onClick={startOnEarliest} data-testid="sale-start-on">{fmt(t('merch.sale.startOn'), { date: eatDateTime(new Date(Math.max(Date.parse(res.earliestStart!), Date.now() + r.minLeadMs)).toISOString(), locale) })}</Button>
            </span>
          </Alert>
        )}
        {isVendor && lock && <Alert tone="error"><span data-testid="sale-overlap">{fmt(t('merch.sale.overlap'), { start: eatDateTime(lock.startsAt, locale), end: eatDateTime(lock.endsAt, locale) })}</span></Alert>}
        {isVendor && check.state === 'failed' && <Alert tone="warning"><span data-testid="sale-check-failed">{t('merch.sale.checkFailed')}</span></Alert>}

        {/* Always-visible notes (S4-AC-06) */}
        <Alert tone="info">
          <ul className="list-disc space-y-1 pl-4" data-testid="sale-notes">
            <li>{t(isVendor ? 'merch.sale.youPay' : 'merchAdmin.saleSellerPays')}</li>
            <li>{t('merch.sale.rule14')}</li>
            <li>{t(isVendor ? 'merch.reviewNoteSale' : 'merchAdmin.saleCreateNote')}</li>
          </ul>
        </Alert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => (dirty && !busy ? setConfirmDiscard(true) : onCancel())} data-testid="sale-cancel">{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} disabled={checkBlocks} className="max-sm:w-full" data-testid="sale-submit">{t(submitLabel)}</Button>
        </div>
      </form>

      <Dialog open={confirmResend} onClose={() => setConfirmResend(false)} title={t('merch.resend.title')} description={t('merch.resend.body')} size="sm">
        <DialogFooter>
          <Button variant="secondary" onClick={() => setConfirmResend(false)} data-testid="sale-resend-keep">{t('merch.resend.keep')}</Button>
          <Button onClick={() => void save()} data-testid="sale-resend-confirm">{t('merch.resend.confirm')}</Button>
        </DialogFooter>
      </Dialog>
      <Dialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title={t('merch.discard.title')} size="sm">
        <DialogFooter>
          <Button variant="secondary" onClick={() => setConfirmDiscard(false)} data-testid="sale-discard-keep">{t('merch.discard.keep')}</Button>
          <Button variant="destructive" onClick={() => { setConfirmDiscard(false); onCancel(); }} data-testid="sale-discard-confirm">{t('merch.discard.confirm')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
