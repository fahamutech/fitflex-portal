'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ProductStock, type StockReason, type VendorProduct } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { errorBody, errorCode, fmt, isRefusal, newClientRef, variantsOf } from '@/lib/vendor';
import { Alert, Button, Field, Input, Radio, Textarea, useToast } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../../app/providers';
import { useVendor } from '../vendor-context';

/** S1 order: Counted first, then the ways stock comes in, then the ways it goes out, then Other. */
const REASONS: StockReason[] = ['count', 'restock', 'returned', 'found', 'damaged', 'expired', 'lost', 'other'];
const IN = new Set<StockReason>(['restock', 'returned', 'found']);
const OUT = new Set<StockReason>(['damaged', 'expired', 'lost']);
const NOTE_MAX = 200;

/**
 * Change one product's (or one variant's) stock with a reason. The entry keeps one clientRef across
 * retries, so a request that reached the server is never applied twice.
 */
export function AdjustStockDialog({
  product, initialVariant, open, onClose, onSaved, onGone,
}: {
  product: VendorProduct;
  initialVariant?: string | null;
  open: boolean;
  onClose: () => void;
  /** The product's new stock, from the server's answer. */
  onSaved: (stock: ProductStock) => void;
  /** The product (or its variants) changed under us: reload the list. */
  onGone: () => void;
}) {
  const { token, t } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const variants = useMemo(() => variantsOf(product), [product]);
  const hasVariants = variants.length > 0;

  const [variant, setVariant] = useState('');
  const [reason, setReason] = useState<StockReason | ''>('');
  const [direction, setDirection] = useState<'in' | 'out' | ''>('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [network, setNetwork] = useState(false);
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  /** Stock the server told us about after a refusal; overrides the row's figure. */
  const [currentOverride, setCurrentOverride] = useState<number | null>(null);
  const clientRef = useRef<string>('');
  const qtyRef = useRef<HTMLInputElement>(null);
  // Focus the quantity once the form is enabled again (after a refused count).
  const [focusQty, setFocusQty] = useState(false);
  useEffect(() => {
    if (focusQty && !busy) { qtyRef.current?.focus(); setFocusQty(false); }
  }, [focusQty, busy]);

  useEffect(() => {
    if (!open) return;
    setVariant(initialVariant ?? ''); setReason(''); setDirection(''); setQty(''); setNote('');
    setStale(false); setNetwork(false); setQtyError(null); setNoteError(null); setVariantError(null); setFormError(null);
    setCurrentOverride(null);
    clientRef.current = newClientRef();
  }, [open, initialVariant]);

  const rowStock = hasVariants
    ? (variant ? variants.find(v => v.name === variant)?.stock ?? null : null)
    : Number(product.stock ?? 0);
  const current = currentOverride ?? rowStock;
  const n = qty.trim() === '' ? NaN : Number(qty);
  const whole = Number.isInteger(n);
  const goesIn = reason !== '' && (IN.has(reason) || (reason === 'other' && direction === 'in'));
  const goesOut = reason !== '' && (OUT.has(reason) || (reason === 'other' && direction === 'out'));
  const after = current == null || !whole ? null : reason === 'count' ? n : goesIn ? current + n : goesOut ? current - n : null;
  const insufficient = goesOut && whole && current != null && n > current;
  const qtyValid = reason === 'count' ? whole && n >= 0 : whole && n >= 1;
  const ready = (!hasVariants || !!variant) && current != null && reason !== '' && (reason !== 'other' || direction !== '')
    && qtyValid && !insufficient && (reason !== 'other' || note.trim() !== '') && note.length <= NOTE_MAX;

  // Changing what the entry says makes it a new entry (a new clientRef), except a plain retry.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setNetwork(false); clientRef.current = newClientRef(); };

  async function save() {
    if (!token || !ready) return;
    setBusy(true); setFormError(null); setQtyError(null); setNoteError(null); setVariantError(null);
    try {
      const res = await api.vendorAdjustStock(token, product.id, {
        ...(hasVariants ? { variant } : {}),
        reason,
        quantity: n,
        ...(reason === 'count' ? { expectedStock: current ?? 0 } : {}),
        ...(reason === 'other' ? { direction: direction as 'in' | 'out' } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        clientRef: clientRef.current,
      });
      toast.success(fmt(t('vendor.stock.updated'), { before: res.movement.stockBefore ?? '—', after: res.movement.stockAfter ?? '—' }));
      onSaved(res.product);
      vendor.refreshCounts();
      onClose();
    } catch (err) {
      const code = errorCode(err);
      const body = errorBody<{ currentStock?: number }>(err);
      if (!isRefusal(err)) {
        // Maybe it never arrived: keep everything, retry with the same clientRef.
        setNetwork(true);
      } else if (code === 'stock_changed') {
        if (typeof body?.currentStock === 'number') setCurrentOverride(body.currentStock);
        setStale(true); setQty(''); clientRef.current = newClientRef();
        setFocusQty(true);
      } else if (code === 'insufficient_stock') {
        if (typeof body?.currentStock === 'number') setCurrentOverride(body.currentStock);
        clientRef.current = newClientRef();
      } else if (code === 'note_required') {
        setNoteError(t('vendor.stock.noteMissing'));
      } else if (code === 'note_too_long') {
        setNoteError(t('vendor.stock.noteTooLong'));
      } else if (code === 'invalid_quantity') {
        setQtyError(t('vendor.stock.quantityInvalid'));
      } else if (code === 'variant_required' || code === 'variant_not_found') {
        setVariantError(t('vendor.stock.pickVariant'));
        setVariant('');
        onGone();
      } else if (code === 'client_ref_reused') {
        clientRef.current = newClientRef();
        setFormError(t('vendor.saveFailed'));
      } else if (code === 'not_your_product' || (err as { status?: number }).status === 403) {
        if (!vendor.handleError(err)) toast.error(t('vendor.stock.notAllowed'));
        onClose();
      } else if ((err as { status?: number }).status === 404) {
        if (!vendor.handleError(err)) toast.error(t('vendor.stock.notFound'));
        onGone();
        onClose();
      } else {
        setFormError(t('vendor.saveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  const deltaText = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '0');
  const preview = current == null || !whole || reason === '' ? null
    : reason === 'count'
      ? (n === current ? t('vendor.stock.noDifference') : fmt(t('vendor.stock.difference'), { delta: deltaText(n - current) }))
      : after != null && (goesIn || goesOut) ? fmt(t('vendor.stock.after'), { n: after }) : null;
  const qtyLabel = reason === 'count' ? t('vendor.stock.counted') : goesOut ? t('vendor.stock.quantityOut') : t('vendor.stock.quantityIn');

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('vendor.stock.adjust')} description={product.name}>
      <div className="space-y-5" data-testid="adjust-stock-dialog">
        {stale && <Alert tone="warning">{t('vendor.stock.changed')}</Alert>}
        {network && <Alert tone="error">{t('vendor.networkError')} {t('vendor.stock.nothingSaved')}</Alert>}
        {formError && <Alert tone="error">{formError}</Alert>}

        {hasVariants && (
          <Field label={t('vendor.stock.variantLabel')} required error={variantError ?? undefined}>
            <select
              className="ui-input ui-select"
              value={variant}
              onChange={e => { edit(setVariant)(e.target.value); setCurrentOverride(null); setVariantError(null); }}
              disabled={busy}
              data-autofocus
              data-testid="adjust-variant"
            >
              <option value="">{t('vendor.stock.pickVariant')}</option>
              {variants.map(v => <option key={v.name} value={v.name}>{`${v.name} · ${v.stock ?? '—'}`}</option>)}
            </select>
          </Field>
        )}

        {current != null && (
          <div>
            <p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.stock.current')}</p>
            <p className="text-2xl font-semibold tabular-nums text-[var(--color-fg-primary)]" data-testid="adjust-current">{current}</p>
          </div>
        )}

        <fieldset disabled={busy}>
          <legend className="mb-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.stock.reasonLabel')}</legend>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {REASONS.map(r => (
              <Radio
                key={r}
                name="stock-reason"
                value={r}
                checked={reason === r}
                onChange={() => { edit(setReason)(r); setQtyError(null); }}
                label={t(`vendor.stock.reason.${r}` as MessageKey)}
                data-testid={`adjust-reason-${r}`}
              />
            ))}
          </div>
        </fieldset>

        {reason === 'other' && (
          <fieldset disabled={busy}>
            <legend className="mb-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.stock.direction')}</legend>
            <div className="flex flex-wrap gap-x-6">
              <Radio name="stock-direction" value="in" checked={direction === 'in'} onChange={() => edit(setDirection)('in')} label={t('vendor.stock.add')} data-testid="adjust-direction-in" />
              <Radio name="stock-direction" value="out" checked={direction === 'out'} onChange={() => edit(setDirection)('out')} label={t('vendor.stock.remove')} data-testid="adjust-direction-out" />
            </div>
          </fieldset>
        )}

        {reason !== '' && (
          <Field
            label={qtyLabel}
            required
            error={qtyError ?? (insufficient && current != null ? fmt(t('vendor.stock.insufficient'), { n: current }) : qty !== '' && !qtyValid ? (reason === 'count' ? t('vendor.stock.countInvalid') : t('vendor.stock.quantityInvalid')) : undefined)}
          >
            <Input
              ref={qtyRef}
              type="number"
              inputMode="numeric"
              min={reason === 'count' ? 0 : 1}
              step={1}
              value={qty}
              onChange={e => { edit(setQty)(e.target.value); setQtyError(null); setStale(false); }}
              disabled={busy}
              data-testid="adjust-quantity"
            />
          </Field>
        )}
        <p aria-live="polite" className="min-h-5 text-sm font-medium text-[var(--color-fg-secondary)]" data-testid="adjust-preview">{preview ?? ''}</p>

        <Field
          label={reason === 'other' ? t('vendor.stock.noteRequired') : t('vendor.stock.note')}
          required={reason === 'other'}
          error={noteError ?? undefined}
          hint={fmt(t('vendor.stock.noteCount'), { n: note.length })}
        >
          <Textarea
            value={note}
            maxLength={NOTE_MAX}
            rows={3}
            onChange={e => { edit(setNote)(e.target.value); setNoteError(null); }}
            disabled={busy}
            data-testid="adjust-note"
          />
        </Field>
      </div>
      <DialogFooter className="flex-wrap">
        <Button variant="secondary" onClick={onClose} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
        <Button onClick={save} disabled={!ready} loading={busy} className="min-h-11" data-testid="adjust-save">
          {network ? t('common.tryAgain') : reason === 'count' ? t('vendor.stock.saveCount') : t('vendor.stock.save')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
