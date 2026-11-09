'use client';
// S8 §6.1: view, add and remove a product's barcodes (per product or per variant). A USB / keyboard-wedge scanner types
// the code and presses Enter: Enter adds the code to the list and keeps focus in the input, so several items can be
// scanned one after another. Save sends the whole list (PUT /vendor/products/:id { barcodes }); nothing else of the
// product is edited here (S2 Q-6 stands). Shown only while tools.barcodes is true and the person has `products`.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { api, type BarcodeInput, type VendorProduct } from '@/lib/api';
import { barcodesOf, codeKey, hasBarcodesKey, MAX_BARCODES_PER_PRODUCT, validateBarcode } from '@/lib/barcode-rules';
import { errorBody, errorCode, fmt, isRefusal, variantsOf } from '@/lib/vendor';
import { Alert, Button, Input, Select, useToast } from '@/components/shared';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { useApp } from '../../../../app/providers';
import { barcodeErrorText, serverMessage, type BarcodeRefusal } from './barcode-messages';

type Row = { key: string; code: string; variant: string | null };
const rowKey = () => `b${Math.random().toString(36).slice(2, 10)}`;
const sig = (rows: Array<{ code: string; variant: string | null }>) => JSON.stringify(rows.map(r => [codeKey(r.code), r.variant ?? '']));

export function BarcodesDialog({ product, onClose, onSaved, onStale }: {
  product: VendorProduct;
  onClose: () => void;
  /** The product with its saved codes (the server's answer). */
  onSaved: (p: VendorProduct) => void;
  /** The row has no `barcodes` key, or the server ignored the codes: load the products and tools again. */
  onStale: () => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const focus = useFocusAfterRender();
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errId = `${inputId}-error`;
  const variants = variantsOf(product);
  const initial = useMemo(() => barcodesOf(product).map(b => ({ key: rowKey(), code: b.code, variant: b.variant || null })), [product]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [text, setText] = useState('');
  const [forVariant, setForVariant] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirty = sig(rows) !== sig(initial);
  // Contract check #214: a row without the `barcodes` key (loaded while the tool was off) has unknown codes. Sending a
  // full list from it would wipe the stored ones, so editing waits for a reload that carries the key.
  const known = hasBarcodesKey(product);
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;
  useEffect(() => { if (!known) onStaleRef.current(); }, [known]);
  const locked = saving || !known;
  const forLabel = (v: string | null) => v || t('vendor.barcodes.wholeProduct');

  function add() {
    if (!known) return;
    const v = validateBarcode(text);
    let error: string | null = null;
    if ('error' in v) error = barcodeErrorText(t, v);
    else if (rows.some(r => codeKey(r.code) === v.codeKey)) error = t('vendor.barcodes.err.duplicate');
    else if (rows.length >= MAX_BARCODES_PER_PRODUCT) error = fmt(t('vendor.barcodes.err.tooMany'), { max: MAX_BARCODES_PER_PRODUCT });
    if (error || 'error' in v) { setInputError(error); inputRef.current?.focus(); return; }
    setRows(rs => [...rs, { key: rowKey(), code: v.code, variant: forVariant || null }]);
    setText(''); setInputError(null); setAlert(null);
    inputRef.current?.focus();
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); if (!saving) add(); }
  };
  const remove = (k: string) => {
    setRows(rs => rs.filter(r => r.key !== k));
    setRowErrors(es => { const n = { ...es }; delete n[k]; return n; });
    setAlert(null);
    focus(() => inputRef.current);
  };

  const requestClose = () => {
    if (saving || discardOpen) return;
    if (dirty) setDiscardOpen(true); else onClose();
  };

  async function save() {
    if (!token || saving || !known) return;
    setSaving(true); setAlert(null); setRowErrors({});
    const body: BarcodeInput[] = rows.map(r => (r.variant ? { code: r.code, variant: r.variant } : { code: r.code }));
    try {
      const res = await api.vendorSetBarcodes(token, product.id, body);
      // The tool was switched off after the page loaded: the server ignored the codes (200 with no `barcodes` key).
      if (!hasBarcodesKey(res)) { toast.error(t('vendor.barcodes.unavailable')); void vendor.refresh(); onStale(); onClose(); return; }
      toast.success(t('vendor.barcodes.saved'));
      onSaved({ ...product, barcodes: res.barcodes });
      onClose();
    } catch (err) {
      const code = errorCode(err);
      const b = errorBody<BarcodeRefusal>(err);
      if (code === 'feature_disabled') { toast.error(t('vendor.barcodes.unavailable')); void vendor.refresh(); onClose(); return; }
      if (err && isRefusal(err) && vendor.handleError(err)) { onClose(); return; }
      const text = barcodeErrorText(t, b);
      const row = b?.code != null ? rows.find(r => codeKey(r.code) === codeKey(b.code)) : undefined;
      // A barcode_in_use without a holder (name null) is about the save, not a row: its `code` is just the first one sent.
      const rowLevel = code !== 'too_many_barcodes' && !(code === 'barcode_in_use' && !b?.name);
      if (text && row && rowLevel) {
        setRowErrors({ [row.key]: text });
        focus(() => document.querySelector<HTMLElement>(`[data-barcode-row="${row.key}"] button`));
      } else {
        // Anything else (incl. 409 save_conflict when a save raced): the server's text if it sent one; the dialog stays open.
        setAlert(text ?? (isRefusal(err) ? serverMessage(b, locale) : null) ?? t('vendor.barcodes.err.server'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open onClose={requestClose} title={fmt(t('vendor.barcodes.dialogTitle'), { name: product.name })}
        description={t('vendor.barcodes.help')} sheetOnMobile testId="barcodes-dialog">
        <div className="space-y-4">
          {!known && <div data-testid="barcodes-stale"><Alert tone="info">{t('vendor.barcodes.unavailableNow')}</Alert></div>}
          {rows.length === 0
            ? <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="barcodes-none">{t('vendor.barcodes.none')}</p>
            : (
              <ul aria-label={t('vendor.barcodes.listLabel')} className="divide-y divide-[var(--color-border-secondary)] rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)]" data-testid="barcodes-list">
                {rows.map(r => {
                  const e = rowErrors[r.key];
                  return (
                    <li key={r.key} data-barcode-row={r.key} className="flex flex-wrap items-center gap-2 px-3 py-1.5" data-testid="barcode-row">
                      <span className="min-w-0 flex-1">
                        {/* Read as "Barcode 6 2 0 1 …, Whole product" (digits one by one, §9). */}
                        <span className="sr-only">{fmt(t('vendor.barcodes.rowLabel'), { code: r.code.split('').join(' '), for: forLabel(r.variant) })}</span>
                        <span aria-hidden="true">
                          <span className="font-mono tabular-nums [overflow-wrap:anywhere]" data-testid="barcode-code">{r.code}</span>
                          <span className="text-sm text-[var(--color-fg-tertiary)]"> · {forLabel(r.variant)}</span>
                        </span>
                      </span>
                      <Button type="button" variant="ghost" className="min-h-11 min-w-11 px-2" disabled={locked}
                        aria-label={fmt(t('vendor.barcodes.remove'), { code: r.code })} aria-describedby={e ? `${r.key}-err` : undefined}
                        onClick={() => remove(r.key)} data-testid="barcode-remove">
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </Button>
                      {e && <p id={`${r.key}-err`} role="alert" className="w-full text-sm text-[var(--color-error-700)]" data-testid="barcode-row-error">{e}</p>}
                    </li>
                  );
                })}
              </ul>
            )}

          <div className="space-y-1.5">
            <label htmlFor={inputId} className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.barcodes.field')}</label>
            <Input id={inputId} ref={inputRef} value={text} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={locked}
              aria-invalid={inputError ? true : undefined} aria-describedby={inputError ? errId : hintId}
              onChange={e => { setText(e.target.value); setInputError(null); }} onKeyDown={onKey} data-testid="barcode-input" />
            {inputError
              ? <p id={errId} role="alert" className="text-xs text-[var(--color-error-700)]" data-testid="barcode-input-error">{inputError}</p>
              : <p id={hintId} className="text-xs text-[var(--color-fg-quaternary)]">{t('vendor.barcodes.scannerHint')}</p>}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {variants.length > 0 && (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label htmlFor={`${inputId}-for`} className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.barcodes.for')}</label>
                <Select id={`${inputId}-for`} value={forVariant} disabled={locked} onChange={e => setForVariant(e.target.value)} data-testid="barcode-for">
                  <option value="">{t('vendor.barcodes.wholeProduct')}</option>
                  {variants.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                </Select>
              </div>
            )}
            <Button type="button" variant="secondary" className="min-h-11" disabled={locked} onClick={add} data-testid="barcode-add">{t('vendor.barcodes.add')}</Button>
          </div>
          {alert && <div data-testid="barcodes-alert"><Alert tone="error">{alert}</Alert></div>}
        </div>
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="secondary" className="min-h-11" disabled={saving} onClick={requestClose} data-testid="barcodes-cancel">{t('common.cancel')}</Button>
          <Button type="button" className="min-h-11" loading={saving} disabled={!known} onClick={save} data-testid="barcodes-save">{t('vendor.barcodes.save')}</Button>
        </DialogFooter>
      </Dialog>
      <ConfirmDialog open={discardOpen} onClose={() => setDiscardOpen(false)} onConfirm={() => { setDiscardOpen(false); onClose(); }}
        title={t('vendor.barcodes.discardTitle')} confirmLabel={t('vendor.purchases.discard')} cancelLabel={t('merch.discard.keep')} />
    </>
  );
}
