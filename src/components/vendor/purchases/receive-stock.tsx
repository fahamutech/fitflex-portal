'use client';
// Receive stock (S9 §4.2, §5.2): who it came from, what came in at what unit cost, what was paid, and the plan for the
// rest. Online only; the form is kept as a local draft (Q-5) and cleared on success, Discard and sign-out. The server
// computes every total and the GRN number; the client only previews.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { api, type ProductLookupMatch, type VendorProduct } from '@/lib/api';
import { barcodesOf, looksLikeCode, matchLocal } from '@/lib/barcode-rules';
import { money } from '@/lib/admin-utils';
import {
  addDays, dayMonth, receiptDateTime, eatToday, errorBody, errorCode, fmt, isRefusal, newClientRef, receiptDay, REFERENCE_REQUIRED,
  saleMethodLabel, tracksVariantStock, variantsOf,
} from '@/lib/vendor';
import {
  clearDraft, DEFAULT_DUE_DAYS, draftKey, DUE_MAX_DAYS, loadDraft, MAX_INVOICE_REF, MAX_NOTE, MAX_QTY, MAX_TOTAL, MAX_UNIT_COST,
  plural, purchaseErrorKey, purchasesApi, RECEIVED_BACK_DAYS, saveDraft, scheduleFor, type LastCostRow, type ReceiveInput, type SupplierRow,
} from '@/lib/vendor-purchases';
import { Alert, Badge, Button, Card, CardContent, ErrorState, Field, Input, PageHeader, Segmented, Select, SkeletonCard, Spinner, Textarea, useToast } from '@/components/shared';
import { barcodeErrorText, serverMessage, type BarcodeRefusal } from '../barcodes/barcode-messages';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { useApp } from '../../../../app/providers';
import { rateLimitText, useOnline } from '../customers/bits';
import { InstalmentEditor, MethodPicker, MoneyNotice, planRowsValid, planSum, rowAmount, type PlanRow } from './bits';
import { SupplierFormDialog } from './supplier-form-dialog';

type Line = { key: string; productId: string; variant: string; qty: string; cost: string; costTouched: boolean };
type SupplierPick = { id: string; name: string; phone: string | null; owedTzs: number };
type PayMode = 'full' | 'part' | 'none';
type Form = {
  supplier: SupplierPick | null; noSupplier: boolean; lines: Line[];
  receivedOn: string; invoiceRef: string; note: string;
  payMode: PayMode; payTouched: boolean; method: string; reference: string; paidNow: string;
  planMode: 'single' | 'split'; dueDate: string; rows: PlanRow[];
};
type Errors = { supplier?: string; date?: string; paidNow?: string; reference?: string; plan?: string; lines: Record<string, string> };

const lineKey = () => `l${Math.random().toString(36).slice(2, 10)}`;
const blankLine = (): Line => ({ key: lineKey(), productId: '', variant: '', qty: '1', cost: '', costTouched: false });
const intOf = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
const digits = (v: string) => v.replace(/[^\d]/g, '');
const dupKey = (productId: string, variant: string) => `${productId}\u0000${variant}`;
const freshForm = (today: string): Form => ({
  supplier: null, noSupplier: false, lines: [blankLine()], receivedOn: today, invoiceRef: '', note: '',
  payMode: 'full', payTouched: false, method: 'cash', reference: '', paidNow: '',
  planMode: 'single', dueDate: addDays(today, DEFAULT_DUE_DAYS), rows: [],
});

const optionCls = (active: boolean) => `flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm ${active ? 'bg-[var(--color-brand-50)]' : 'hover:bg-[var(--color-bg-secondary)]'}`;

/**
 * What Enter with a code did (S8 §6.2): added (input clears), choose (several SKU matches: the listbox shows only
 * those), a status to show under the input, or pass (normal text: today's Enter, the highlighted hit).
 */
export type CodeOutcome =
  | { kind: 'added' }
  | { kind: 'choose'; ids: string[] }
  | { kind: 'notFound'; code: string }
  | { kind: 'status'; tone: 'warning' | 'error'; text: string; retry?: boolean }
  | { kind: 'pass' }
  | { kind: 'none' };

/** A searchable product picker (name or SKU; archived products are not offered). With `onCode` (S8), Enter matches codes. */
function ProductCombobox({ products, addedIds, onPick, label, inputTestId, autoFocus, onCode, onAddCode }: {
  products: VendorProduct[]; addedIds: Set<string>; onPick: (p: VendorProduct) => void; label: string; inputTestId: string; autoFocus?: boolean;
  /** S8 (tools.barcodes): resolve the typed / scanned text on Enter. */
  onCode?: (text: string, hasTextHit: boolean) => Promise<CodeOutcome>;
  /** S8: "Add this code to a product" for an unknown code; left out for people without `products`. */
  onAddCode?: (code: string) => void;
}) {
  const { t } = useApp();
  const listId = useId();
  const statusId = `${listId}-status`;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [restrict, setRestrict] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [status, setStatus] = useState<{ node: ReactNode; text: string; retry?: string } | null>(null);
  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => (restrict
    ? products.filter(p => restrict.includes(p.id))
    : products.filter(p => !needle || p.name.toLowerCase().includes(needle) || String(p.sku ?? '').toLowerCase().includes(needle)).slice(0, 8)), [products, needle, restrict]);
  const pick = (p: VendorProduct) => { onPick(p); setQ(''); setOpen(false); setRestrict(null); setStatus(null); };

  async function runCode(text: string, fallback: VendorProduct | null) {
    if (!onCode || busyRef.current) return;
    busyRef.current = true; setBusy(true); setStatus(null);
    let out: CodeOutcome;
    try { out = await onCode(text, !!fallback); } finally { busyRef.current = false; setBusy(false); }
    if (out.kind === 'added') { setQ(''); setRestrict(null); setOpen(false); }
    else if (out.kind === 'pass') { if (fallback) pick(fallback); }
    else if (out.kind === 'choose') {
      setRestrict(out.ids); setOpen(true); setActive(0);
      setStatus({ node: <span>{t('vendor.scan.pickMatch')}</span>, text: t('vendor.scan.pickMatch') });
    } else if (out.kind === 'notFound') {
      const code = out.code;
      setOpen(false);
      setStatus({
        text: fmt(t('vendor.scan.notFound'), { code }),
        node: (
          <Alert tone="warning">
            <span className="block [overflow-wrap:anywhere]">{fmt(t('vendor.scan.notFound'), { code })}</span>
            {onAddCode
              ? <Button type="button" variant="secondary" size="sm" className="mt-2 min-h-11 whitespace-normal" onClick={() => onAddCode(code)} data-testid={`${inputTestId}-add-code`}>{t('vendor.scan.addToProduct')}</Button>
              : <span className="mt-1 block font-normal text-[var(--color-fg-tertiary)]" data-testid={`${inputTestId}-ask-products`}>{t('vendor.scan.askProducts')}</span>}
          </Alert>
        ),
      });
    } else if (out.kind === 'status') {
      setOpen(false);
      setStatus({ text: out.text, retry: out.retry ? text : undefined, node: <Alert tone={out.tone}><span className="block [overflow-wrap:anywhere]">{out.text}</span></Alert> });
    }
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && onCode && q.trim() && !restrict) {
      // S8 §6.2: code → SKU → lookup → today's highlighted hit. One code at a time: Enter waits for the answer.
      e.preventDefault();
      void runCode(q, open && hits[active] ? hits[active] : null);
    }
    else if (e.key === 'Enter' && open && hits[active]) { e.preventDefault(); pick(hits[active]); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  };
  return (
    <div className="relative">
      <div className="relative">
        <Input role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-label={label}
          aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
          aria-busy={busy || undefined} aria-describedby={status ? statusId : undefined} className={busy ? 'pr-10' : undefined}
          value={q} placeholder={t('vendor.purchases.searchProduct')} autoComplete="off" autoFocus={autoFocus} data-focus="product"
          onChange={e => { setQ(e.target.value); setOpen(true); setActive(0); setRestrict(null); setStatus(null); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey} data-testid={inputTestId} />
        {busy && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center" data-testid={`${inputTestId}-busy`}>
            <Spinner className="h-4 w-4" /><span className="sr-only">{fmt(t('vendor.scan.looking'), { code: q.trim() })}</span>
          </span>
        )}
      </div>
      {status && (
        <div id={statusId} role="status" aria-live="polite" className="mt-2 space-y-2 text-sm" data-testid={`${inputTestId}-status`}>
          {status.node}
          {status.retry && <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => void runCode(status.retry!, null)} data-testid={`${inputTestId}-retry`}>{t('common.tryAgain')}</Button>}
        </div>
      )}
      {open && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-lg)]">
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-[var(--color-fg-tertiary)]">{t('vendor.purchases.noProductMatch')}</li>}
          {hits.map((p, i) => {
            const vs = variantsOf(p);
            return (
              <li key={p.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={optionCls(i === active)}
                onMouseDown={e => { e.preventDefault(); pick(p); }} data-testid={`product-option-${p.id}`}>
                <span className="min-w-0 [overflow-wrap:anywhere]">{p.name}{vs.length ? ` · ${fmt(plural(t, 'vendor.purchases.variantCount', vs.length), { n: vs.length })}` : ''}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--color-fg-tertiary)]">
                  {p.status === 'paused' && <Badge tone="gray">{t('vendor.products.status.paused')}</Badge>}
                  {addedIds.has(p.id) && !vs.length && <Badge tone="info">{t('vendor.purchases.added')}</Badge>}
                  <span className="tabular-nums">{t('vendor.purchases.stockNow')} {p.stock ?? 0}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Choose the supplier: search, Add supplier, or No supplier (only when paid in full). */
function SupplierPicker({ form, onChoose, onNone, onAdd, error }: {
  form: Form; onChoose: (s: SupplierPick | null) => void; onNone: () => void; onAdd: (name: string) => void; error?: string;
}) {
  const { token, t } = useApp();
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!token || !open) return;
    const timer = setTimeout(() => {
      const query = q.trim();
      purchasesApi.suppliers(token, { q: query.length >= 2 ? query : undefined, filter: 'active', sort: query.length >= 2 ? 'name' : 'recent', limit: 20 })
        .then(r => setRows(r.suppliers ?? [])).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [token, q, open]);

  if (form.supplier) {
    const s = form.supplier;
    return (
      <div className="space-y-1" data-testid="receive-supplier-chosen">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold [overflow-wrap:anywhere]">{s.name}{s.phone ? ` · …${s.phone.slice(-3)}` : ''}</span>
          <Button type="button" variant="secondary" size="sm" className="min-h-11" data-focus="supplier" aria-label={fmt(t('vendor.purchases.supplierChosen'), { name: s.name })}
            onClick={() => onChoose(null)} data-testid="receive-supplier-change">{t('vendor.purchases.change')}</Button>
        </div>
        {s.owedTzs > 0 && <p className="text-sm text-[var(--color-info-700)]">{fmt(t('vendor.purchases.alreadyOwe'), { amount: money(s.owedTzs) })}</p>}
        {error && <p role="alert" className="text-sm text-[var(--color-error-700)]" data-testid="receive-supplier-error">{error}</p>}
      </div>
    );
  }
  if (form.noSupplier) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2" data-testid="receive-no-supplier">
        <span><span className="font-semibold">{t('vendor.purchases.noSupplier')}</span><span className="block text-xs text-[var(--color-fg-tertiary)]">{t('vendor.purchases.noSupplierHelp')}</span></span>
        <Button type="button" variant="secondary" size="sm" className="min-h-11" data-focus="supplier" onClick={() => onChoose(null)} data-testid="receive-supplier-change">{t('vendor.purchases.change')}</Button>
      </div>
    );
  }
  const options: Array<{ kind: 'row'; row: SupplierRow } | { kind: 'add' } | { kind: 'none' }> = [...rows.map(row => ({ kind: 'row' as const, row })), { kind: 'add' }, { kind: 'none' }];
  const choose = (o: (typeof options)[number]) => {
    setOpen(false);
    if (o.kind === 'row') onChoose({ id: o.row.id, name: o.row.name, phone: o.row.phone, owedTzs: o.row.owedTzs });
    else if (o.kind === 'add') onAdd(q.trim());
    else onNone();
  };
  return (
    <div className="relative space-y-1">
      <Input role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-label={t('vendor.purchases.chooseSupplier')}
        aria-invalid={error ? true : undefined} aria-activedescendant={open ? `${listId}-${active}` : undefined}
        value={q} placeholder={t('vendor.purchases.chooseSupplier')} autoComplete="off" data-focus="supplier"
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(options.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); choose(options[active]); }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
        }}
        data-testid="receive-supplier-search" />
      {open && (
        <ul id={listId} role="listbox" aria-label={t('vendor.purchases.chooseSupplier')} className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-lg)]">
          {rows.length === 0 && q.trim().length >= 2 && <li className="px-3 py-2 text-sm text-[var(--color-fg-tertiary)]">{t('vendor.purchases.supplierSearchEmpty')}</li>}
          {options.map((o, i) => (
            <li key={o.kind === 'row' ? o.row.id : o.kind} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={optionCls(i === active)}
              onMouseDown={e => { e.preventDefault(); choose(o); }} data-testid={o.kind === 'row' ? `supplier-option-${o.row.id}` : `supplier-option-${o.kind}`}>
              {o.kind === 'row' ? (
                <><span className="min-w-0 [overflow-wrap:anywhere]">{o.row.name}{o.row.phone ? ` · ${o.row.phone}` : ''}</span>
                  {o.row.owedTzs > 0 && <span className="shrink-0 text-xs tabular-nums">{fmt(t('vendor.suppliers.youOwe'), { amount: money(o.row.owedTzs) })}</span>}</>
              ) : o.kind === 'add' ? (
                <span className="inline-flex items-center gap-2 font-semibold text-[var(--color-brand-700)]"><UserPlus aria-hidden="true" className="h-4 w-4" />{t('vendor.suppliers.add')}</span>
              ) : (
                <span><span className="font-medium">{t('vendor.purchases.noSupplier')}</span><span className="block text-xs text-[var(--color-fg-tertiary)]">{t('vendor.purchases.noSupplierHelp')}</span></span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-[var(--color-error-700)]" data-testid="receive-supplier-error">{error}</p>}
    </div>
  );
}

export function ReceiveStock({ initialSupplierId }: { initialSupplierId: string | null }) {
  const { token, t, locale, user } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const router = useRouter();
  const online = useOnline();
  const focus = useFocusAfterRender();
  const today = eatToday();
  const earliest = addDays(today, -RECEIVED_BACK_DAYS);
  const canSeeCost = vendor.me?.tools?.canSeeCost === true;
  const suspended = vendor.me?.accountStatus === 'suspended';
  const key = vendor.me && user?.id ? draftKey(vendor.me.vendorId, user.id) : null;

  // Every product (archived too, so a scanned code of an archived product says so); lines use the others only.
  const [allProducts, setAllProducts] = useState<VendorProduct[] | null>(null);
  const products = useMemo(() => (allProducts ? allProducts.filter(p => p.status !== 'archived') : null), [allProducts]);
  const [productsFailed, setProductsFailed] = useState(false);
  const [form, setForm] = useState<Form>(() => freshForm(today));
  const [dirty, setDirty] = useState(false);
  const [draftOffer, setDraftOffer] = useState<(Form & { savedAt: string }) | null>(null);
  const [lastCosts, setLastCosts] = useState<Record<string, LastCostRow>>({});
  const [errors, setErrors] = useState<Errors>({ lines: {} });
  const [tried, setTried] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveAlert, setSaveAlert] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [addSupplier, setAddSupplier] = useState<string | null>(null);
  const clientRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // ── load: products, the supplier from ?supplier=, and any draft on this device ──
  const loadProducts = useCallback(async (): Promise<VendorProduct[] | null> => {
    if (!token) return null;
    setProductsFailed(false);
    try { const list = await api.vendorProducts(token); setAllProducts(list); return list; }
    // Staff of a suspended vendor get 403 vendor_suspended here: the shared handler shows the suspended banner;
    // the form stays empty with Review disabled (the server refuses writes too).
    catch (err) { if (vendor.handleError(err)) setAllProducts([]); else setProductsFailed(true); return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { void loadProducts(); }, [loadProducts]);
  useEffect(() => {
    if (!key) return;
    const d = loadDraft<Form>(key);
    if (d && Array.isArray(d.lines)) setDraftOffer(d);
  }, [key]);
  useEffect(() => {
    if (!token || !initialSupplierId) return;
    purchasesApi.supplier(token, initialSupplierId).then(res => {
      if (res.supplier.archivedAt) return;
      setForm(f => (f.supplier ? f : { ...f, supplier: { id: res.supplier.id, name: res.supplier.name, phone: res.supplier.phone, owedTzs: res.owedTzs }, noSupplier: false, payMode: f.payTouched ? f.payMode : 'none' }));
    }).catch(() => undefined);
  }, [token, initialSupplierId]);
  useEffect(() => { focus(() => headingRef.current); }, [focus]);

  // Any edit: the form is dirty, the clientRef is spent (a new body is a new purchase), errors on that part clear.
  const update = (patch: Partial<Form> | ((f: Form) => Form)) => {
    setForm(f => (typeof patch === 'function' ? patch(f) : { ...f, ...patch }));
    setDirty(true); clientRef.current = null; setSaveAlert(null);
  };
  // Draft: debounced 500 ms, after the first change; never holds a clientRef.
  useEffect(() => {
    if (!dirty || !key) return;
    const timer = setTimeout(() => saveDraft(key, form), 500);
    return () => clearTimeout(timer);
  }, [form, dirty, key]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const byId = useMemo(() => new Map((products ?? []).map(p => [p.id, p])), [products]);
  const productIds = useMemo(() => [...new Set(form.lines.map(l => l.productId).filter(Boolean))].sort(), [form.lines]);
  const idsKey = productIds.join(',');
  useEffect(() => {
    if (!token || !productIds.length) return;
    const missing = productIds.filter(id => !(`${id}\u0000*` in lastCosts));
    if (!missing.length) return;
    // `${id}\0*` marks "asked" (answered or failed), so the prefill waits for the last purchase cost first.
    const mark = (rows: LastCostRow[]) => setLastCosts(cur => {
      const next = { ...cur };
      for (const id of missing) next[`${id}\u0000*`] = { productId: id, variant: null, unitCostTzs: -1, receivedOn: '', supplierName: null, number: '' };
      for (const r of rows) next[dupKey(r.productId, r.variant ?? '')] = r;
      return next;
    });
    purchasesApi.lastCosts(token, missing).then(res => mark(res.rows ?? [])).catch(() => mark([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, idsKey]);

  const lastOf = (l: Line) => lastCosts[dupKey(l.productId, l.variant)] ?? null;
  const currentCostOf = (l: Line): number | null => {
    const p = byId.get(l.productId);
    if (!p) return null;
    if (l.variant) { const v = variantsOf(p).find(x => x.name === l.variant); return v?.costTzs ?? null; }
    return p.costTzs ?? null;
  };
  const prefillOf = (l: Line): number | null => {
    const last = lastOf(l);
    if (last && last.unitCostTzs >= 0) return last.unitCostTzs;
    if (!canSeeCost) return null;
    const p = byId.get(l.productId);
    if (!p) return null;
    if (l.variant) { const v = variantsOf(p).find(x => x.name === l.variant); return v?.effectiveCostTzs ?? v?.costTzs ?? p.costTzs ?? null; }
    return p.costTzs ?? null;
  };
  // Prefill unit costs the person hasn't typed (last purchase cost, else the product's cost when allowed).
  useEffect(() => {
    setForm(f => {
      let changed = false;
      const lines = f.lines.map(l => {
        if (!l.productId || l.costTouched || l.cost !== '' || !(`${l.productId}\u0000*` in lastCosts)) return l;
        const p = byId.get(l.productId);
        if (p && tracksVariantStock(p) && !l.variant) return l;
        const v = prefillOf(l);
        if (v == null) return l;
        changed = true;
        return { ...l, cost: String(v) };
      });
      return changed ? { ...f, lines } : f;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCosts, byId, form.lines.map(l => `${l.key}:${l.productId}:${l.variant}`).join('|')]);

  // ── lines ──
  const nameOf = (l: Line) => { const p = byId.get(l.productId); return p ? (l.variant ? `${p.name} (${l.variant})` : p.name) : ''; };
  const needsVariant = (l: Line) => { const p = byId.get(l.productId); return !!p && tracksVariantStock(p) && !l.variant; };
  const stockNow = (l: Line) => {
    const p = byId.get(l.productId);
    if (!p) return null;
    if (l.variant && tracksVariantStock(p)) return variantsOf(p).find(v => v.name === l.variant)?.stock ?? 0;
    return Number(p.stock ?? 0);
  };
  const focusLine = (k: string, what: 'qty' | 'product' | 'variant' | 'cost') => focus(() => document.querySelector<HTMLElement>(`[data-line="${k}"] [data-focus="${what}"]`));
  /** Same product + variant twice → one line with the quantities added (P-1, AC-11). No focus change. */
  const mergeLines = (f: Form, k: string): { form: Form; into: string | null } => {
    const l = f.lines.find(x => x.key === k);
    if (!l?.productId || needsVariant(l)) return { form: f, into: null };
    const other = f.lines.find(x => x.key !== k && x.productId === l.productId && x.variant === l.variant);
    if (!other) return { form: f, into: null };
    const qty = (Number.isFinite(intOf(other.qty)) ? intOf(other.qty) : 0) + (Number.isFinite(intOf(l.qty)) ? intOf(l.qty) : 1);
    return { form: { ...f, lines: f.lines.filter(x => x.key !== k).map(x => (x.key === other.key ? { ...x, qty: String(Math.min(MAX_QTY, qty)) } : x)) }, into: other.key };
  };
  const mergeInto = (f: Form, k: string): Form => {
    const { form: next, into } = mergeLines(f, k);
    if (into) focusLine(into, 'qty');
    return next;
  };
  const setLine = (k: string, patch: Partial<Line>) => {
    update(f => ({ ...f, lines: f.lines.map(l => (l.key === k ? { ...l, ...patch } : l)) }));
    setErrors(e => { const lines = { ...e.lines }; delete lines[k]; return { ...e, lines }; });
  };
  const pickProduct = (k: string, p: VendorProduct) => {
    update(f => mergeInto({ ...f, lines: f.lines.map(l => (l.key === k ? { ...l, productId: p.id, variant: '', cost: '', costTouched: false } : l)) }, k));
    setErrors(e => { const lines = { ...e.lines }; delete lines[k]; return { ...e, lines }; });
    if (tracksVariantStock(p)) focusLine(k, 'variant'); else focusLine(k, 'qty');
  };
  const pickVariant = (k: string, variant: string) => {
    update(f => mergeInto({ ...f, lines: f.lines.map(l => (l.key === k ? { ...l, variant, cost: l.costTouched ? l.cost : '' } : l)) }, k));
  };
  const addRow = () => { const l = blankLine(); update(f => ({ ...f, lines: [...f.lines, l] })); focusLine(l.key, 'product'); };

  // ── S8 §6.2: Enter with a code in an item search (USB / keyboard-wedge scanner or typed) ──
  const barcodesOn = vendor.me?.tools?.barcodes === true;
  const canAddCode = barcodesOn && vendor.can('products');
  const [announce, setAnnounce] = useState('');
  const [addCode, setAddCode] = useState<{ code: string; lineKey: string } | null>(null);
  const say = (text: string) => setAnnounce(a => (a === text ? `${text}\u00a0` : text));
  /** Put a matched product on line k (or +1 on its line), keep an empty item search at the end and move focus to it. */
  const scanAdd = (k: string, p: VendorProduct, variant: string | null) => {
    const vs = variantsOf(p);
    const v = variant && vs.some(x => x.name === variant) ? variant : '';
    const pickVariantNow = tracksVariantStock(p) && !v;
    const existing = pickVariantNow ? undefined : form.lines.find(l => l.key !== k && l.productId === p.id && l.variant === v);
    const qty = existing ? Math.min(MAX_QTY, (Number.isFinite(intOf(existing.qty)) ? intOf(existing.qty) : 0) + 1) : 1;
    const tail = blankLine();
    update(f => {
      let next: Form = { ...f, lines: f.lines.map(l => (l.key === k ? { ...l, productId: p.id, variant: v, qty: '1', cost: '', costTouched: false } : l)) };
      if (!pickVariantNow) {
        // mergeLines reads byId, which may not hold a product found by the lookup yet: merge by id + variant here.
        const other = next.lines.find(x => x.key !== k && x.productId === p.id && x.variant === v);
        if (other) next = { ...next, lines: next.lines.filter(x => x.key !== k).map(x => (x.key === other.key ? { ...x, qty: String(qty) } : x)) };
      }
      if (!next.lines.some(l => !l.productId)) next = { ...next, lines: [...next.lines, tail] };
      return next;
    });
    setErrors(e => { const lines = { ...e.lines }; delete lines[k]; return { ...e, lines }; });
    if (pickVariantNow) focusLine(k, 'variant');
    else focus(() => { const all = document.querySelectorAll<HTMLElement>('[data-testid="receive-lines"] input[data-focus="product"]'); return all[all.length - 1]; });
    say(fmt(t('vendor.scan.addedLine'), { name: v ? `${p.name} (${v})` : p.name, qty }));
  };
  const archivedOutcome = (name: string): CodeOutcome => ({ kind: 'status', tone: 'warning', text: fmt(t('vendor.scan.archived'), { name }) });
  /** One product chosen by a code: archived → refused; else added. */
  const takeMatch = (k: string, p: VendorProduct, variant: string | null): CodeOutcome => {
    if (p.status === 'archived') return archivedOutcome(p.name);
    scanAdd(k, p, variant);
    return { kind: 'added' };
  };
  const resolveCode = async (k: string, raw: string, hasTextHit: boolean): Promise<CodeOutcome> => {
    const text = raw.trim();
    const list = allProducts ?? [];
    // 1–2: the loaded list first (barcode by codeKey, then exact SKU).
    const local = matchLocal(list, text);
    if (local?.kind === 'barcode') return takeMatch(k, local.product, local.variant);
    if (local?.kind === 'sku') {
      const live = local.products.filter(p => p.status !== 'archived');
      if (!live.length) return archivedOutcome(local.products[0].name);
      if (live.length === 1) return takeMatch(k, live[0], null);
      return { kind: 'choose', ids: live.map(p => p.id) };
    }
    // 4: plain text (spaces, too short or long) keeps today's Enter.
    if (!looksLikeCode(text) || !token) return { kind: 'pass' };
    // 3: ask the server (a code saved on another device, or a SKU not in this list).
    let matches: ProductLookupMatch[];
    try {
      matches = (await api.vendorProductLookup(token, text)).matches ?? [];
    } catch (err) {
      const code = errorCode(err);
      if (code === 'rate_limited') {
        const s = Number(errorBody<{ retryAfterSeconds?: number }>(err)?.retryAfterSeconds) || 60;
        return { kind: 'status', tone: 'warning', text: fmt(t('vendor.scan.rateLimited'), { s }) };
      }
      if (code === 'feature_disabled') { toast.error(t('vendor.barcodes.unavailable')); void vendor.refresh(); return hasTextHit ? { kind: 'pass' } : { kind: 'none' }; }
      if (code === 'code_required' || code === 'invalid_code') return hasTextHit ? { kind: 'pass' } : { kind: 'notFound', code: text };
      if (err instanceof Error && isRefusal(err) && (err as { status?: number }).status === 403) {
        if (!['vendor_suspended', 'vendor_staff_inactive', 'account_suspended'].includes(code ?? '')) toast.error(t('vendor.purchases.noAccess'));
        else vendor.handleError(err);
        return { kind: 'none' };
      }
      if (isRefusal(err) && vendor.handleError(err)) return { kind: 'none' };
      return { kind: 'status', tone: 'error', text: t('vendor.scan.lookupFailed'), retry: true };
    }
    if (!matches.length) return hasTextHit ? { kind: 'pass' } : { kind: 'notFound', code: text };
    // A product the list doesn't have yet (added on another device): load the list again, once.
    let fresh = list;
    if (matches.some(m => !fresh.some(p => p.id === m.productId))) fresh = (await loadProducts()) ?? fresh;
    const found = matches.map(m => ({ m, p: fresh.find(p => p.id === m.productId) })).filter((x): x is { m: ProductLookupMatch; p: VendorProduct } => !!x.p);
    if (!found.length) return { kind: 'notFound', code: text };
    if (found.length === 1) {
      const { m, p } = found[0];
      if (m.status === 'archived' || p.status === 'archived') return archivedOutcome(m.name || p.name);
      return takeMatch(k, p, m.variant);
    }
    const live = found.filter(x => x.m.status !== 'archived' && x.p.status !== 'archived');
    if (!live.length) return archivedOutcome(found[0].m.name);
    if (live.length === 1) return takeMatch(k, live[0].p, live[0].m.variant);
    return { kind: 'choose', ids: live.map(x => x.p.id) };
  };
  const removeRow = (k: string) => update(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter(l => l.key !== k) : [blankLine()] }));

  // ── money ──
  const chosen = form.lines.filter(l => l.productId);
  const lineOk = (l: Line) => {
    const q = intOf(l.qty); const c = intOf(l.cost);
    return !needsVariant(l) && Number.isInteger(q) && q >= 1 && q <= MAX_QTY && Number.isInteger(c) && c >= 0 && c <= MAX_UNIT_COST;
  };
  const total = chosen.reduce((n, l) => n + (lineOk(l) ? intOf(l.qty) * intOf(l.cost) : 0), 0);
  const units = chosen.reduce((n, l) => n + (Number.isFinite(intOf(l.qty)) ? intOf(l.qty) : 0), 0);
  const paidNowValue = form.payMode === 'full' ? total : form.payMode === 'part' ? (Number.isFinite(intOf(form.paidNow)) ? intOf(form.paidNow) : 0) : 0;
  const left = Math.max(0, total - paidNowValue);
  const maxDue = addDays(form.receivedOn, DUE_MAX_DAYS);
  const refNeeded = paidNowValue > 0 && REFERENCE_REQUIRED.has(form.method);
  const costChangeCount = canSeeCost ? chosen.filter(l => lineOk(l) && intOf(l.cost) > 0 && intOf(l.cost) !== currentCostOf(l)).length : 0;
  const supplierName = form.supplier?.name ?? null;

  /** The first thing still missing (shown above Review), or null when it can be reviewed. */
  const missing = ((): string | null => {
    if (!chosen.length) return t('vendor.purchases.needItem');
    if (chosen.some(l => !lineOk(l))) return t('vendor.purchases.needFix');
    if (total > MAX_TOTAL) return t('vendor.purchases.needFix');
    if (form.receivedOn < earliest || form.receivedOn > today) return t('vendor.purchases.needFix');
    if (!form.supplier && left > 0) return t('vendor.purchases.needSupplier');
    if (form.payMode === 'part' && (paidNowValue < 1 || paidNowValue >= total)) return fmt(t('vendor.purchases.paidNowRange'), { max: money(Math.max(1, total - 1)) });
    if (refNeeded && !form.reference.trim()) return t('vendor.pos.referenceRequired');
    if (left > 0 && form.planMode === 'single' && !(form.dueDate >= form.receivedOn && form.dueDate <= maxDue)) return t('vendor.purchases.needFix');
    if (left > 0 && form.planMode === 'split' && (!planRowsValid(form.rows, form.receivedOn, maxDue) || planSum(form.rows) !== left)) return fmt(t('vendor.purchases.sumWrong'), { left: money(left) });
    if (!online) return t('vendor.purchases.offline');
    return null;
  })();

  function review() {
    setTried(true);
    const lineErrors: Record<string, string> = {};
    for (const l of chosen) {
      if (needsVariant(l)) lineErrors[l.key] = t('vendor.stock.pickVariant');
      else if (!lineOk(l)) lineErrors[l.key] = !Number.isInteger(intOf(l.qty)) || intOf(l.qty) < 1 || intOf(l.qty) > MAX_QTY ? t('vendor.purchases.invalidQty') : t('vendor.purchases.invalidCost');
    }
    setErrors(e => ({ ...e, lines: lineErrors }));
    const first = chosen.find(l => lineErrors[l.key]);
    if (first) { focusLine(first.key, needsVariant(first) ? 'variant' : 'qty'); return; }
    if (!form.supplier && left > 0 && chosen.length) { setErrors(e => ({ ...e, supplier: t('vendor.purchases.needSupplier') })); focus(() => document.querySelector<HTMLElement>('[data-focus="supplier"]')); return; }
    if (missing) return;
    setSaveAlert(null);
    setConfirmOpen(true);
  }

  const body = (): ReceiveInput => {
    const lines = chosen.map(l => ({ productId: l.productId, ...(l.variant ? { variant: l.variant } : {}), qty: intOf(l.qty), unitCostTzs: intOf(l.cost) }));
    const out: ReceiveInput = { clientRef: clientRef.current!, lines, receivedOn: form.receivedOn };
    if (form.supplier) out.supplierId = form.supplier.id;
    if (form.invoiceRef.trim()) out.supplierInvoiceRef = form.invoiceRef.trim();
    if (form.note.trim()) out.note = form.note.trim();
    if (paidNowValue > 0) out.paidNow = { amountTzs: paidNowValue, method: form.method, ...(form.method !== 'cash' && form.reference.trim() ? { reference: form.reference.trim() } : {}) };
    if (left > 0) {
      if (form.planMode === 'split') out.schedule = form.rows.map(r => ({ dueDate: r.dueDate, amountTzs: rowAmount(r) }));
      else out.dueDate = form.dueDate;
    }
    return out;
  };

  async function confirm() {
    if (!token || saving) return;
    // Made on the first Confirm tap, reused on Try again (never two GRNs for one delivery).
    if (!clientRef.current) clientRef.current = newClientRef();
    setSaving(true); setSaveAlert(null);
    try {
      const res = await purchasesApi.receive(token, body());
      if (key) clearDraft(key);
      setDirty(false);
      vendor.refreshCounts();
      toast.success(fmt(t('vendor.purchases.saved'), { number: res.purchase.number }));
      router.replace(`/vendor/purchases/?id=${encodeURIComponent(res.purchase.id)}`);
    } catch (err) {
      if (!isRefusal(err)) { setSaveAlert(t(online ? 'vendor.purchases.err.server' : 'vendor.purchases.offline')); return; }
      const code = errorCode(err);
      const b = errorBody<{ productId?: string; index?: number; earliest?: string; latest?: string; totalTzs?: number; expectedTzs?: number }>(err);
      // A refusal saved nothing: the next try is a new purchase.
      clientRef.current = null;
      const lineFor = () => (b?.productId ? chosen.find(l => l.productId === b.productId) : typeof b?.index === 'number' ? chosen[b.index] : undefined);
      const closeAnd = (fn: () => void) => { setConfirmOpen(false); fn(); };
      if (code === 'product_not_found' || code === 'product_unavailable' || code === 'variant_not_found') {
        const l = lineFor();
        closeAnd(() => { if (l) { setErrors(e => ({ ...e, lines: { ...e.lines, [l.key]: fmt(t('vendor.purchases.err.productGone'), { name: nameOf(l) }) } })); focusLine(l.key, 'product'); } });
        void loadProducts();
      } else if (code === 'variant_required') {
        const l = lineFor();
        closeAnd(() => { if (l) { setErrors(e => ({ ...e, lines: { ...e.lines, [l.key]: t('vendor.stock.pickVariant') } })); focusLine(l.key, 'variant'); } });
        void loadProducts();
      } else if (code === 'invalid_quantity' || code === 'invalid_cost' || code === 'invalid_line') {
        const l = lineFor();
        closeAnd(() => { if (l) { setErrors(e => ({ ...e, lines: { ...e.lines, [l.key]: t(code === 'invalid_cost' ? 'vendor.purchases.invalidCost' : 'vendor.purchases.invalidQty') } })); focusLine(l.key, 'qty'); } });
      } else if (code === 'supplier_archived' || code === 'supplier_not_found' || code === 'supplier_required') {
        closeAnd(() => {
          setErrors(e => ({ ...e, supplier: code === 'supplier_required' ? t('vendor.purchases.needSupplier') : fmt(t(purchaseErrorKey(code)), { name: supplierName ?? '' }) }));
          focus(() => document.querySelector<HTMLElement>('[data-focus="supplier"]'));
        });
      } else if (code === 'overpayment') {
        closeAnd(() => setErrors(e => ({ ...e, paidNow: fmt(t('vendor.purchases.err.overTotal'), { amount: money(b?.totalTzs ?? total) }) })));
      } else if (code === 'reference_required' || code === 'reference_too_long') {
        closeAnd(() => setErrors(e => ({ ...e, reference: t('vendor.pos.referenceRequired') })));
      } else if (code === 'schedule_mismatch' || code === 'invalid_schedule' || code === 'due_date_out_of_range') {
        closeAnd(() => setErrors(e => ({ ...e, plan: code === 'due_date_out_of_range'
          ? fmt(t('vendor.purchases.err.dateRange'), { earliest: receiptDay(b?.earliest, locale), latest: receiptDay(b?.latest, locale) })
          : fmt(t('vendor.purchases.sumWrong'), { left: money(b?.expectedTzs ?? left) }) })));
      } else if (code === 'received_on_out_of_range') {
        closeAnd(() => setErrors(e => ({ ...e, date: fmt(t('vendor.purchases.err.dateRange'), { earliest: receiptDay(b?.earliest, locale), latest: receiptDay(b?.latest, locale) }) })));
      } else if (code === 'feature_disabled') {
        toast.error(t('vendor.purchases.unavailable'));
        void vendor.refresh();
        router.replace('/vendor/');
      } else {
        const limited = rateLimitText(err, t);
        if (limited) setSaveAlert(limited);
        else if (vendor.handleError(err)) setConfirmOpen(false);
        else setSaveAlert(t(purchaseErrorKey(code)));
      }
    } finally {
      setSaving(false);
    }
  }

  const leave = (keep: boolean) => {
    if (!keep && key) clearDraft(key);
    setDirty(false); setLeaveOpen(false);
    router.push('/vendor/purchases/');
  };
  const close = () => (dirty ? setLeaveOpen(true) : router.push('/vendor/purchases/'));

  const setPayMode = (m: PayMode) => {
    update(f => ({ ...f, payMode: m, payTouched: true }));
    setErrors(e => ({ ...e, paidNow: undefined, supplier: undefined }));
  };
  const chooseSupplier = (s: SupplierPick | null) => {
    update(f => ({ ...f, supplier: s, noSupplier: false, payMode: s && !f.payTouched ? 'none' : f.payMode }));
    setErrors(e => ({ ...e, supplier: undefined }));
    if (!s) focus(() => document.querySelector<HTMLElement>('[data-focus="supplier"]'));
  };

  // ── render ──
  const planList = (form.planMode === 'split' ? form.rows.map(r => ({ dueDate: r.dueDate, amountTzs: rowAmount(r) })) : [{ dueDate: form.dueDate, amountTzs: left }])
    .map(r => `${dayMonth(r.dueDate, locale)} ${money(r.amountTzs)}`).join(', ');

  return (
    <div className="space-y-4 pb-24 lg:pb-0" data-testid="receive-stock">
      <PageHeader
        title={<span ref={headingRef} tabIndex={-1} className="outline-none" data-testid="receive-heading">{t('vendor.purchases.receive')}</span>}
        actions={<Button variant="ghost" className="min-h-11" onClick={close} aria-label={t('vendor.purchases.close')} data-testid="receive-close"><X aria-hidden="true" className="h-5 w-5" /></Button>}
      />
      {dirty && key && <p className="-mt-4 text-xs text-[var(--color-fg-quaternary)]" data-testid="receive-draft-saved">{t('vendor.purchases.draftSaved')}</p>}
      {draftOffer && (
        <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-info-200)] bg-[var(--color-info-50)] p-3 text-sm text-[var(--color-info-800)]" data-testid="receive-draft-offer">
          <p>{fmt(t('vendor.purchases.draftFound'), { time: receiptDateTime(draftOffer.savedAt, locale) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="min-h-11" onClick={() => {
              const { savedAt: _savedAt, ...rest } = draftOffer; void _savedAt;
              setForm({ ...freshForm(today), ...rest, lines: rest.lines?.length ? rest.lines : [blankLine()] }); setDirty(true); setDraftOffer(null);
            }} data-testid="receive-draft-continue">{t('vendor.purchases.continue')}</Button>
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => { if (key) clearDraft(key); setDraftOffer(null); }} data-testid="receive-draft-discard">{t('vendor.purchases.startAgain')}</Button>
          </div>
        </div>
      )}

      {productsFailed ? <ErrorState title={t('vendor.purchases.err.server')} onRetry={loadProducts} retryLabel={t('common.tryAgain')} />
        : products == null ? <div aria-busy="true" className="space-y-4"><SkeletonCard /><SkeletonCard /></div> : (
        <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
          {/* Items: 2/3 on large screens. */}
          <section aria-labelledby="receive-items" className="space-y-3 lg:col-span-2">
            <h2 id="receive-items" className="font-semibold">{t('vendor.purchases.items')}</h2>
            {chosen.length === 0 && <p className="text-sm text-[var(--color-fg-tertiary)]">{t('vendor.purchases.noItems')}</p>}
            <ol className="space-y-3" data-testid="receive-lines">
              {form.lines.map((l, idx) => {
                const p = byId.get(l.productId);
                const vs = p ? variantsOf(p) : [];
                const tracked = !!p && tracksVariantStock(p);
                const name = nameOf(l) || fmt(t('vendor.purchases.itemN'), { n: idx + 1 });
                const qty = intOf(l.qty); const cost = intOf(l.cost);
                const now = stockNow(l);
                const last = lastOf(l);
                const current = currentCostOf(l);
                const notice = !p || !Number.isInteger(cost) ? null
                  : cost === 0 ? t('vendor.purchases.freeLine')
                  : canSeeCost ? (cost !== current ? (current == null ? fmt(t('vendor.purchases.costWillBeSet'), { to: money(cost) }) : fmt(t('vendor.purchases.costWillChange'), { from: money(current), to: money(cost) })) : null)
                  : fmt(t('vendor.purchases.costWillBeSet'), { to: money(cost) });
                const err = errors.lines[l.key];
                const isLast = idx === form.lines.length - 1;
                return (
                  <li key={l.key} data-line={l.key} data-testid={`receive-line-${idx}`}>
                    <Card className={err ? 'border-[var(--color-error-300)]' : undefined}>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            {p ? <p className="font-semibold [overflow-wrap:anywhere]" data-focus="product" tabIndex={-1}>{p.name}</p>
                              : <ProductCombobox products={products} addedIds={new Set(chosen.map(c => c.productId))} label={fmt(t('vendor.purchases.itemN'), { n: idx + 1 })}
                                  onPick={pp => pickProduct(l.key, pp)} inputTestId={`receive-product-${idx}`}
                                  onCode={barcodesOn ? (text, hasTextHit) => resolveCode(l.key, text, hasTextHit) : undefined}
                                  onAddCode={canAddCode ? code => setAddCode({ code, lineKey: l.key }) : undefined} />}
                          </div>
                          <Button type="button" variant="ghost" className="min-h-11 min-w-11 px-2" aria-label={fmt(t('vendor.purchases.removeLine'), { name })}
                            onClick={() => removeRow(l.key)} data-testid={`receive-remove-${idx}`}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>
                        </div>
                        {p && (
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)_auto]">
                            {vs.length > 0 && (
                              <Field label={t('vendor.stock.variantLabel')} required={tracked}>
                                <Select value={l.variant} onChange={e => pickVariant(l.key, e.target.value)} data-focus="variant" data-testid={`receive-variant-${idx}`}>
                                  <option value="">{tracked ? t('vendor.stock.pickVariant') : t('vendor.purchases.noVariant')}</option>
                                  {vs.map(v => <option key={v.name} value={v.name}>{tracked ? `${v.name} · ${v.stock ?? 0}` : v.name}</option>)}
                                </Select>
                              </Field>
                            )}
                            <div className="flex flex-col gap-1.5">
                              <span className="text-sm font-medium text-[var(--color-fg-secondary)]" id={`${l.key}-qty-label`}>{t('vendor.purchases.qty')}</span>
                              <div className="flex items-center gap-1">
                                <Button type="button" variant="secondary" className="min-h-11 min-w-11 px-2" aria-label={fmt(t('vendor.purchases.oneFewer'), { name })}
                                  disabled={!Number.isInteger(qty) || qty <= 1} onClick={() => setLine(l.key, { qty: String(qty - 1) })} data-testid={`receive-minus-${idx}`}><Minus aria-hidden="true" className="h-4 w-4" /></Button>
                                <Input inputMode="numeric" className="w-24 text-center" value={l.qty} aria-label={fmt(t('vendor.purchases.qtyFor'), { name })} aria-invalid={err ? true : undefined}
                                  data-focus="qty" onChange={e => setLine(l.key, { qty: digits(e.target.value) })} data-testid={`receive-qty-${idx}`} />
                                <Button type="button" variant="secondary" className="min-h-11 min-w-11 px-2" aria-label={fmt(t('vendor.purchases.oneMore'), { name })}
                                  disabled={Number.isInteger(qty) && qty >= MAX_QTY} onClick={() => setLine(l.key, { qty: String((Number.isInteger(qty) ? qty : 0) + 1) })} data-testid={`receive-plus-${idx}`}><Plus aria-hidden="true" className="h-4 w-4" /></Button>
                              </div>
                            </div>
                            <Field label={t('vendor.purchases.unitCost')} hint={last && last.unitCostTzs >= 0 ? fmt(t('vendor.purchases.lastCost'), { amount: money(last.unitCostTzs), supplier: last.supplierName ?? t('vendor.purchases.noSupplier'), date: dayMonth(last.receivedOn, locale) }) : undefined}>
                              <Input inputMode="numeric" value={l.cost} aria-label={fmt(t('vendor.purchases.unitCostFor'), { name })} data-focus="cost"
                                onChange={e => setLine(l.key, { cost: digits(e.target.value), costTouched: true })}
                                onKeyDown={e => { if (e.key === 'Enter' && isLast) { e.preventDefault(); addRow(); } }} data-testid={`receive-cost-${idx}`} />
                            </Field>
                            <div className="flex flex-col gap-1 sm:items-end">
                              <span className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.purchases.lineTotal')}</span>
                              <span className="whitespace-nowrap text-lg font-semibold tabular-nums" data-testid={`receive-line-total-${idx}`}>{lineOk(l) ? money(qty * cost) : '—'}</span>
                              {now != null && Number.isInteger(qty) && (!tracked || l.variant) && (
                                <span className="whitespace-nowrap text-xs text-[var(--color-fg-tertiary)]" data-testid={`receive-stock-${idx}`}>{fmt(t('vendor.purchases.stockChange'), { from: now, to: now + qty })}</span>
                              )}
                            </div>
                          </div>
                        )}
                        {notice && <p className="text-sm text-[var(--color-info-700)]" data-testid={`receive-cost-notice-${idx}`}>{notice}</p>}
                        {err && <p role="alert" className="text-sm text-[var(--color-error-700)]" data-testid={`receive-line-error-${idx}`}>{err}</p>}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ol>
            <Button type="button" variant="secondary" className="min-h-11" onClick={addRow} data-testid="receive-add-row"><Plus aria-hidden="true" className="h-4 w-4" />{t('vendor.purchases.addItem')}</Button>
          </section>

          {/* Supplier, details and payment: 1/3, sticky on large screens. */}
          <div className="space-y-4 lg:sticky lg:top-4">
            <Card>
              <CardContent className="space-y-2 p-4">
                <h2 className="font-semibold">{t('vendor.purchases.supplier')}</h2>
                <SupplierPicker form={form} error={errors.supplier} onChoose={chooseSupplier}
                  onNone={() => { update(f => ({ ...f, supplier: null, noSupplier: true, payMode: 'full', payTouched: true })); setErrors(e => ({ ...e, supplier: undefined })); }}
                  onAdd={name => setAddSupplier(name)} />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-4">
                <h2 className="font-semibold">{t('vendor.purchases.details')}</h2>
                <Field label={t('vendor.purchases.receivedOn')} required error={errors.date}>
                  <Input type="date" value={form.receivedOn} min={earliest} max={today}
                    onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { update({ receivedOn: e.target.value }); setErrors(x => ({ ...x, date: undefined })); } }} data-testid="receive-date" />
                </Field>
                <Field label={t('vendor.purchases.invoiceRef')}>
                  <Input value={form.invoiceRef} maxLength={MAX_INVOICE_REF} onChange={e => update({ invoiceRef: e.target.value })} data-testid="receive-invoice" />
                </Field>
                <Field label={t('vendor.purchases.note')} hint={`${form.note.length}/${MAX_NOTE}`}>
                  <Textarea value={form.note} rows={2} maxLength={MAX_NOTE} onChange={e => update({ note: e.target.value })} data-testid="receive-note" />
                </Field>
              </CardContent>
            </Card>

            {chosen.length > 0 && (
              <Card>
                <CardContent className="space-y-3 p-4" data-testid="receive-payment">
                  <h2 className="font-semibold">{t('vendor.purchases.payment')}</h2>
                  <p aria-live="polite" className="flex items-baseline justify-between gap-2">
                    <span className="text-sm">{t('vendor.purchases.total')}</span>
                    <span className="whitespace-nowrap text-xl font-bold tabular-nums" data-testid="receive-total">{money(total)}</span>
                  </p>
                  {total > 0 && (
                    <div role="group" aria-label={t('vendor.purchases.payment')}>
                      <Segmented className="w-full flex-wrap [&>button]:flex-1 [&>button]:whitespace-normal" value={form.payMode} onChange={v => setPayMode(v as PayMode)}
                        options={[['full', t('vendor.purchases.paidFull')], ['part', t('vendor.purchases.paidPart')], ['none', t('vendor.purchases.notPaid')]]} />
                    </div>
                  )}
                  {total > 0 && form.payMode !== 'none' && (
                    <>
                      {form.payMode === 'part' && (
                        <Field label={t('vendor.purchases.paidNow')} required error={errors.paidNow ?? (tried && (paidNowValue < 1 || paidNowValue >= total) ? fmt(t('vendor.purchases.paidNowRange'), { max: money(Math.max(1, total - 1)) }) : undefined)}>
                          <Input inputMode="numeric" value={form.paidNow} onChange={e => { update({ paidNow: digits(e.target.value) }); setErrors(x => ({ ...x, paidNow: undefined })); }} data-testid="receive-paid-now" />
                        </Field>
                      )}
                      {form.payMode === 'full' && errors.paidNow && <p role="alert" className="text-sm text-[var(--color-error-700)]">{errors.paidNow}</p>}
                      <MethodPicker method={form.method} reference={form.reference} testPrefix="receive"
                        onMethod={m => { update({ method: m }); setErrors(x => ({ ...x, reference: undefined })); }}
                        onReference={r => { update({ reference: r }); setErrors(x => ({ ...x, reference: undefined })); }}
                        referenceError={errors.reference ?? (tried && refNeeded && !form.reference.trim() ? t('vendor.pos.referenceRequired') : null)} />
                    </>
                  )}
                  {left > 0 && (
                    <div className="space-y-3">
                      <p aria-live="polite" className="font-semibold" data-testid="receive-left">{fmt(t('vendor.purchases.leftToPay'), { amount: money(left) })}</p>
                      {form.planMode === 'single' ? (
                        <>
                          <Field label={t('vendor.purchases.payBy')} required>
                            <Input type="date" value={form.dueDate} min={form.receivedOn} max={maxDue} onChange={e => update({ dueDate: e.target.value })} data-testid="receive-due" />
                          </Field>
                          <Button type="button" variant="link" className="min-h-11" data-testid="receive-split"
                            onClick={() => update(f => ({ ...f, planMode: 'split', rows: scheduleFor(left, 2, f.dueDate, 'month').map(r => ({ dueDate: r.dueDate, amount: String(r.amountTzs) })) }))}>
                            {t('vendor.purchases.split')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <InstalmentEditor left={left} rows={form.rows} onRows={rows => { update({ rows }); setErrors(x => ({ ...x, plan: undefined })); }} minDate={form.receivedOn} maxDate={maxDue}
                            showError={tried} testPrefix="receive" defaultFirst={addDays(form.receivedOn, DEFAULT_DUE_DAYS)} />
                          <Button type="button" variant="link" className="min-h-11" onClick={() => update({ planMode: 'single' })} data-testid="receive-single">{t('vendor.purchases.oneDate')}</Button>
                        </>
                      )}
                      {errors.plan && <p role="alert" className="text-sm text-[var(--color-error-700)]" data-testid="receive-plan-error">{errors.plan}</p>}
                    </div>
                  )}
                  <MoneyNotice />
                </CardContent>
              </Card>
            )}

            <div className="fixed inset-x-0 bottom-0 z-20 space-y-1 border-t border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
              {missing && <p className="text-sm text-[var(--color-fg-tertiary)]" aria-live="polite" data-testid="receive-missing">{missing}</p>}
              <Button className="min-h-11 w-full" onClick={review} disabled={!online || suspended || !chosen.length} data-testid="receive-review">
                <span className="whitespace-normal">{fmt(t('vendor.purchases.review'), { amount: money(total) })}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog focusTitle open={confirmOpen} onClose={() => { if (!saving) setConfirmOpen(false); }}
        title={supplierName ? fmt(plural(t, 'vendor.purchases.confirmTitle', units), { units, supplier: supplierName }) : fmt(plural(t, 'vendor.purchases.confirmTitleNoSupplier', units), { units })} sheetOnMobile testId="receive-confirm">
        <div className="space-y-3 text-sm" data-testid="receive-confirm-body">
          <ul className="space-y-1">
            {chosen.map(l => <li key={l.key} className="[overflow-wrap:anywhere]">{intOf(l.qty)} × {nameOf(l)} · <span className="tabular-nums">{money(intOf(l.qty) * intOf(l.cost))}</span></li>)}
          </ul>
          <p className="flex justify-between gap-2 font-semibold"><span>{t('vendor.purchases.total')}</span><span className="tabular-nums">{money(total)}</span></p>
          {paidNowValue > 0 && <p className="flex justify-between gap-2"><span>{fmt(t('vendor.purchases.confirmPaidNow'), { method: saleMethodLabel(form.method, t) })}</span><span className="tabular-nums">{money(paidNowValue)}</span></p>}
          {left > 0 && (
            <p data-testid="receive-confirm-plan">{fmt(t('vendor.purchases.leftToPay'), { amount: money(left) })}{form.planMode === 'split' ? ` · ${fmt(plural(t, 'vendor.purchases.confirmPlan', form.rows.length), { n: form.rows.length, list: planList })}` : ` · ${t('vendor.purchases.payBy')} ${receiptDay(form.dueDate, locale)}`}</p>
          )}
          {costChangeCount > 0 && <p>{fmt(plural(t, 'vendor.purchases.costChanges', costChangeCount), { n: costChangeCount })}</p>}
          {saving && <p aria-live="polite">{t('vendor.purchases.saving')}</p>}
          {saveAlert && <div data-testid="receive-confirm-alert"><Alert tone="error">{saveAlert}</Alert></div>}
        </div>
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)} disabled={saving} className="min-h-11">{t('vendor.purchases.back')}</Button>
          <Button type="button" onClick={confirm} loading={saving} className="min-h-11" data-testid="receive-confirm-save">
            {saveAlert ? t('common.tryAgain') : t('vendor.purchases.confirm')}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog focusTitle open={leaveOpen} onClose={() => setLeaveOpen(false)} title={t('vendor.purchases.leaveTitle')} size="sm" testId="receive-leave">
        <p className="text-sm">{t('vendor.purchases.draftSaved')}</p>
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => setLeaveOpen(false)}>{t('common.cancel')}</Button>
          <Button type="button" variant="destructive" className="min-h-11" onClick={() => leave(false)} data-testid="receive-leave-discard">{t('vendor.purchases.discard')}</Button>
          <Button type="button" className="min-h-11" onClick={() => leave(true)} data-testid="receive-leave-keep">{t('vendor.purchases.keepDraft')}</Button>
        </DialogFooter>
      </Dialog>

      <p className="sr-only" aria-live="polite" data-testid="receive-scan-live">{announce}</p>
      {addCode && products && canAddCode && (
        <AddCodeDialog code={addCode.code} products={products}
          onClose={() => setAddCode(null)}
          onAdded={(p, variant) => {
            setAllProducts(cur => (cur ?? []).map(x => (x.id === p.id ? { ...x, barcodes: p.barcodes } : x)));
            const k = addCode.lineKey;
            setAddCode(null);
            // The line the code was typed in, else (it was used meanwhile) the empty item search at the end.
            const target = form.lines.find(l => l.key === k && !l.productId) ?? form.lines.find(l => !l.productId);
            if (target) scanAdd(target.key, p, variant);
            else { const l = blankLine(); update(f => ({ ...f, lines: [...f.lines, l] })); scanAdd(l.key, p, variant); }
          }} />
      )}

      <SupplierFormDialog open={addSupplier != null} supplier={null} initialName={addSupplier ?? ''} onClose={() => setAddSupplier(null)}
        onSaved={s => { setAddSupplier(null); toast.success(t('vendor.suppliers.saved')); chooseSupplier({ id: s.id, name: s.name, phone: s.phone, owedTzs: 0 }); }} />
    </div>
  );
}

/**
 * S8 §6.2 "Add this code to a product" (people with `products`): product → For → Add code. Sends addBarcodes, so a stale
 * list never removes anyone else's code; the line is then added as if the code had matched.
 */
function AddCodeDialog({ code, products, onClose, onAdded }: {
  code: string; products: VendorProduct[]; onClose: () => void; onAdded: (p: VendorProduct, variant: string | null) => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const labelId = useId();
  const [product, setProduct] = useState<VendorProduct | null>(null);
  const [forVariant, setForVariant] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vs = product ? variantsOf(product) : [];

  async function save() {
    if (!token || !product || saving) return;
    setSaving(true); setError(null);
    try {
      const res = await api.vendorAddBarcodes(token, product.id, [forVariant ? { code, variant: forVariant } : { code }]);
      toast.success(fmt(t('vendor.scan.codeAdded'), { name: product.name }));
      onAdded({ ...product, barcodes: Array.isArray(res?.barcodes) ? res.barcodes : [...barcodesOf(product), { code, variant: forVariant || null }] }, forVariant || null);
    } catch (err) {
      const c = errorCode(err);
      const b = errorBody<BarcodeRefusal>(err);
      if (c === 'feature_disabled') { toast.error(t('vendor.barcodes.unavailable')); void vendor.refresh(); onClose(); return; }
      if (isRefusal(err) && vendor.handleError(err)) { onClose(); return; }
      setError(barcodeErrorText(t, b) ?? (isRefusal(err) ? serverMessage(b, locale) : null) ?? t('vendor.barcodes.err.server'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={() => { if (!saving) onClose(); }} title={t('vendor.scan.addToProduct')} sheetOnMobile testId="add-code-dialog">
      <div className="space-y-4">
        <p className="text-sm">{t('vendor.barcodes.field')}: <span className="font-mono tabular-nums [overflow-wrap:anywhere]" data-testid="add-code-value">{code}</span></p>
        <div className="space-y-1.5">
          <p id={labelId} className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.scan.chooseProduct')}</p>
          {product ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold [overflow-wrap:anywhere]" data-testid="add-code-chosen">{product.name}</span>
              <Button type="button" variant="secondary" size="sm" className="min-h-11" disabled={saving}
                onClick={() => { setProduct(null); setForVariant(''); setError(null); }} data-testid="add-code-change">{t('vendor.purchases.change')}</Button>
            </div>
          ) : (
            <ProductCombobox products={products} addedIds={new Set()} label={t('vendor.scan.chooseProduct')} inputTestId="add-code-product"
              onPick={p => { setProduct(p); setForVariant(''); setError(null); }} />
          )}
        </div>
        {product && vs.length > 0 && (
          <Field label={t('vendor.barcodes.for')}>
            <Select value={forVariant} disabled={saving} onChange={e => setForVariant(e.target.value)} data-testid="add-code-for">
              <option value="">{t('vendor.barcodes.wholeProduct')}</option>
              {vs.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
            </Select>
          </Field>
        )}
        {product && <p className="text-sm [overflow-wrap:anywhere]" data-testid="add-code-confirm-text">{fmt(t('vendor.scan.confirmAddTitle'), { code, name: forVariant ? `${product.name} (${forVariant})` : product.name })}</p>}
        {error && <div data-testid="add-code-error"><Alert tone="error">{error}</Alert></div>}
      </div>
      <DialogFooter className="flex-wrap">
        <Button type="button" variant="secondary" className="min-h-11" disabled={saving} onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" className="min-h-11" disabled={!product} loading={saving} onClick={save} data-testid="add-code-save">{t('vendor.scan.confirmAdd')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
