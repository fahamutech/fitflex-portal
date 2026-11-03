'use client';
// S7 refund dialog (docs/design/vendor-refunds-s7.md §5.2, §4.2–4.6, §7): choose lines, quantities, restock, reason
// and how the money goes back, then confirm. The client NEVER sends amounts (functions#318): the preview mirrors the
// server's M-2 / M-4 rules for display only and the server's figures win. Online only: nothing is ever queued. The
// clientRef is made at the first Confirm and reused on Try again, so a refund whose answer was lost is answered
// 200 (replay) instead of being made twice. Walk-in money never passes through FitFlex.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { api, ApiError, type VendorRefund, type VendorSale } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import {
  customerName, errorBody, errorCode, fmt, isRefusal, newClientRef, PAYMENT_METHODS, REFERENCE_REQUIRED, refundErrorKey, refundShare, saleMethodLabel, splitRefund,
} from '@/lib/vendor';
import { Alert, Button, Checkbox, Field, Input, SkeletonTable, Table, TBody, Td, Textarea, Th, THead, Tr, useToast } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';

const REASON_MIN = 3;
const REASON_MAX = 200;
const REFERENCE_MAX = 100;
const REASONS = ['returned', 'faulty', 'wrong', 'mind', 'other'] as const;
type ReasonPill = (typeof REASONS)[number];
type Line = VendorSale['lines'][number];

const chipCls = (on: boolean) =>
  `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${on
    ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
    : 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-secondary)]'}`;

const lineName = (l: Pick<Line, 'nameSnapshot' | 'variant'>) => `${l.nameSnapshot}${l.variant ? ` (${l.variant})` : ''}`;
const sold = (l: Line) => l.qty;
const refundedOf = (l: Line) => Number(l.refundedQty ?? 0);
const refundableOf = (l: Line) => (l.id ? Number(l.refundableQty ?? Math.max(0, l.qty - refundedOf(l))) : 0);
const lineNetOf = (l: Line) => Number(l.lineNetTzs ?? l.lineTotalTzs);
/** The VAT already given back on a line, assuming the cumulative rule (display only). */
const vatPreview = (l: Line, q: number) => {
  const vat = Number(l.vatTzs ?? 0);
  if (!vat || q <= 0) return 0;
  const a = refundedOf(l);
  const before = refundShare(vat, sold(l), 0, 0, a);
  return refundShare(vat, sold(l), a, before, q);
};

export function RefundDialog({
  saleId, saleNumber, onClose, onSaved,
}: {
  saleId: string;
  saleNumber: string;
  onClose: () => void;
  onSaved: (refund: VendorRefund, sale: VendorSale) => void;
}) {
  const { token, t } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [sale, setSale] = useState<VendorSale | null>(null);
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading');
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [pill, setPill] = useState<ReasonPill | null>(null);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [reference, setReference] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  /** Lines another refund took first (409 refund_exceeds_sold), and deleted products (400 restock_unavailable). */
  const [exceeded, setExceeded] = useState<Set<string>>(new Set());
  const [restockGone, setRestockGone] = useState<Set<string>>(new Set());
  const [fieldError, setFieldError] = useState<{ reason?: string; method?: string; reference?: string }>({});
  /** Refused or not answered: shown on the step that is open. */
  const [banner, setBanner] = useState<{ tone: 'error' | 'warning'; text: string; retry?: boolean } | null>(null);
  const [voided, setVoided] = useState(false);
  const clientRef = useRef<{ ref: string; sig: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef<string | null>('heading');

  // ── Always read the sale again on open: the counters must be fresh (§4.6, §5.4) ──
  const fetchSale = useCallback(async () => {
    if (!token) return null;
    const res = await api.vendorSale(token, saleId);
    return res.sale;
  }, [token, saleId]);
  const reload = useCallback(async () => {
    setLoad('loading');
    try {
      const fresh = await fetchSale();
      if (!fresh) return;
      setSale(fresh);
      setMethod(m => (m === 'cash' && fresh.payments[0]?.method ? fresh.payments[0].method : m));
      setLoad('ready');
    } catch (err) {
      if (vendor.handleError(err)) { onClose(); return; }
      setLoad('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSale]);
  useEffect(() => { void reload(); }, [reload]);

  // Focus after render (never from timers): heading on open and on step change, first invalid field after an error.
  useEffect(() => {
    const target = focusNext.current;
    if (!target || load !== 'ready') return;
    focusNext.current = null;
    if (target === 'heading') headingRef.current?.focus();
    else if (target === 'reason') reasonRef.current?.focus();
    else if (target === 'reference') referenceRef.current?.focus();
    else document.getElementById(target)?.focus();
  });

  const lines = sale?.lines ?? [];
  const picked = lines.filter(l => l.id && (qty[l.id] ?? 0) > 0);
  const preview = useMemo(() => {
    let total = 0; let vat = 0;
    const per: Record<string, number> = {};
    for (const l of lines) {
      if (!l.id) continue;
      const q = qty[l.id] ?? 0;
      const amount = refundShare(lineNetOf(l), sold(l), refundedOf(l), Number(l.refundedTzs ?? 0), q);
      per[l.id] = amount; total += amount; vat += Math.min(vatPreview(l, q), amount);
    }
    return { per, total, vat, ...splitRefund(total, sale ?? {}) };
  }, [lines, qty, sale]);
  const payBack = preview.paidOutTzs;
  const credit = sale?.kind === 'credit';
  const customer = customerName(sale?.customer, t);
  const refNeeded = payBack > 0 && REFERENCE_REQUIRED.has(method);
  const missing: MessageKey | null = !picked.length ? 'vendor.refunds.selectSome'
    : reason.trim().length < REASON_MIN ? 'vendor.refunds.reasonMissing'
    : refNeeded && !reference.trim() ? 'vendor.pos.referenceRequired'
    : null;
  const dirty = picked.length > 0 || reason.trim().length > 0;

  const setLineQty = (l: Line, n: number) => {
    if (!l.id) return;
    const v = Math.max(0, Math.min(refundableOf(l), Math.floor(Number.isFinite(n) ? n : 0)));
    setQty(cur => ({ ...cur, [l.id!]: v }));
    if (v > 0 && restock[l.id] === undefined && !restockGone.has(l.id)) setRestock(cur => ({ ...cur, [l.id!]: true }));
  };
  const refundAll = () => {
    const next: Record<string, number> = {};
    const nextRestock = { ...restock };
    for (const l of lines) if (l.id && refundableOf(l) > 0) { next[l.id] = refundableOf(l); if (nextRestock[l.id] === undefined && !restockGone.has(l.id)) nextRestock[l.id] = true; }
    setQty(next); setRestock(nextRestock);
  };
  const choosePill = (p: ReasonPill) => {
    setPill(p);
    setFieldError(f => ({ ...f, reason: undefined }));
    if (p === 'other') { setReason(''); reasonRef.current?.focus(); return; }
    setReason(t(`vendor.refunds.reason.${p}` as MessageKey));
  };

  // ── Close: never while saving; ask first when picks exist (Escape too) ──
  const requestClose = () => {
    if (busy) return;
    if (asking) { setAsking(false); return; }
    if (dirty) { setAsking(true); return; }
    onClose();
  };

  const review = () => {
    setTried(true);
    if (missing) {
      focusNext.current = missing === 'vendor.refunds.reasonMissing' ? 'reason' : missing === 'vendor.pos.referenceRequired' ? 'reference' : (picked[0]?.id ? null : `refund-qty-${lines.find(l => l.id && refundableOf(l) > 0)?.id}`);
      setFieldError(f => ({ ...f, ...(missing === 'vendor.refunds.reasonMissing' ? { reason: t(missing) } : {}), ...(missing === 'vendor.pos.referenceRequired' ? { reference: t(missing) } : {}) }));
      return;
    }
    setBanner(null);
    focusNext.current = 'heading';
    setStep('confirm');
  };
  const backToChoose = (focus: string = 'heading') => { focusNext.current = focus; setStep('choose'); };

  async function save() {
    if (!token || !sale) return;
    const body = {
      lines: picked.map(l => ({ saleLineId: l.id!, qty: qty[l.id!], restock: restockGone.has(l.id!) ? false : restock[l.id!] !== false })),
      reason: reason.trim(),
      // Always sent: the server judges it on its own paid-back figure and ignores it when nothing is paid back.
      method,
      ...(method !== 'cash' && reference.trim() ? { reference: reference.trim() } : {}),
    };
    const sig = JSON.stringify(body);
    if (!clientRef.current || clientRef.current.sig !== sig) clientRef.current = { ref: newClientRef(), sig };
    setBusy(true); setBanner(null);
    try {
      const res = await api.vendorRefundSale(token, sale.id, { clientRef: clientRef.current.ref, ...body });
      toast.success(fmt(t('vendor.refunds.saved'), { number: res.refund.number }));
      onSaved(res.refund, res.sale);
    } catch (err) {
      if (!isRefusal(err)) {
        // No answer (or 5xx): the dialog stays on Confirm; Try again sends the same clientRef.
        setBanner({ tone: 'error', text: t(err instanceof ApiError && err.status >= 500 ? 'vendor.refunds.err.server' : 'vendor.refunds.offline'), retry: true });
        return;
      }
      const code = errorCode(err);
      if (code === 'refund_exceeds_sold') {
        const rows = errorBody<{ lines?: Array<{ saleLineId: string; refundableQty: number }> }>(err)?.lines ?? [];
        const hit = new Set(rows.map(r => r.saleLineId));
        setExceeded(hit);
        setQty(cur => {
          const next = { ...cur };
          for (const r of rows) next[r.saleLineId] = Math.min(next[r.saleLineId] ?? 0, Math.max(0, r.refundableQty));
          return next;
        });
        try { const fresh = await fetchSale(); if (fresh) setSale(fresh); } catch { /* the clamped picks still stand */ }
        setBanner({ tone: 'warning', text: t('vendor.refunds.err.exceeds') });
        backToChoose(rows[0] ? `refund-qty-${rows[0].saleLineId}` : 'heading');
        return;
      }
      if (code === 'sale_voided') { setVoided(true); setBanner({ tone: 'error', text: t('vendor.refunds.err.saleVoided') }); backToChoose(); return; }
      if (code === 'restock_unavailable') {
        const id = errorBody<{ saleLineId?: string }>(err)?.saleLineId;
        if (id) { setRestockGone(cur => new Set(cur).add(id)); setRestock(cur => ({ ...cur, [id]: false })); }
        backToChoose(id ? `refund-restock-${id}` : 'heading');
        return;
      }
      if (code === 'method_required' || code === 'invalid_method') { setFieldError({ method: t('vendor.refunds.method') }); backToChoose(`refund-method-${method}`); return; }
      if (code === 'reference_required' || code === 'reference_too_long') {
        setFieldError({ reference: t('vendor.pos.referenceRequired') }); backToChoose('reference'); return;
      }
      if (code === 'reason_required' || code === 'reason_too_long') { setFieldError({ reason: t('vendor.refunds.reasonMissing') }); backToChoose('reason'); return; }
      if (code === 'client_ref_reused') { clientRef.current = null; setBanner({ tone: 'error', text: t('vendor.refunds.err.server'), retry: true }); return; }
      if (code === 'rate_limited') { setBanner({ tone: 'warning', text: t('vendor.refunds.err.tooFast'), retry: true }); return; }
      if (code === 'refund_not_allowed') { toast.error(t('vendor.refunds.askOwner')); onClose(); return; }
      if (code === 'feature_disabled') { toast.error(t('vendor.refunds.unavailable')); void vendor.refresh(); onClose(); return; }
      if (code === 'sale_not_found') { toast.error(t('vendor.sales.notFound')); onClose(); return; }
      if (code === 'line_not_on_sale') { void reload(); setBanner({ tone: 'warning', text: t('vendor.refunds.err.exceeds') }); backToChoose(); return; }
      if (vendor.handleError(err)) { onClose(); return; }
      setBanner({ tone: 'error', text: t(refundErrorKey(code)) });
    } finally {
      setBusy(false);
    }
  }

  const title = fmt(t('vendor.refunds.title'), { number: saleNumber });
  const summary = (
    <dl className="space-y-1 text-sm" aria-live="polite" data-testid="refund-summary">
      <div className="flex justify-between gap-2"><dt>{t('vendor.refunds.total')}</dt><dd className="whitespace-nowrap font-semibold tabular-nums" data-testid="refund-total">{money(preview.total)}</dd></div>
      {credit && preview.balanceReducedTzs > 0 && (
        <div className="flex justify-between gap-2"><dt className="[overflow-wrap:anywhere]">{fmt(t('vendor.refunds.offBalance'), { name: customer })}</dt><dd className="whitespace-nowrap tabular-nums" data-testid="refund-off-balance">−{money(preview.balanceReducedTzs)}</dd></div>
      )}
      <div className="flex justify-between gap-2 font-semibold text-[var(--color-success-700)]"><dt>{t('vendor.refunds.payBack')}</dt><dd className="whitespace-nowrap tabular-nums" data-testid="refund-pay-back">{money(payBack)}</dd></div>
      {preview.vat > 0 && <p className="text-[var(--color-fg-tertiary)]">{fmt(t('vendor.documents.includesVat'), { amount: money(preview.vat) })}</p>}
    </dl>
  );
  const notice = <div data-testid="refund-money-notice"><Alert tone="info">{t('vendor.refunds.moneyNotice')}</Alert></div>;
  const bannerEl = banner && (
    <div role="alert" aria-live="assertive" data-testid="refund-banner"><Alert tone={banner.tone}>{banner.text}</Alert></div>
  );

  const stepper = (l: Line) => {
    const id = l.id!;
    const n = qty[id] ?? 0;
    const max = refundableOf(l);
    const name = lineName(l);
    return (
      <div className="flex items-center gap-1">
        <Button type="button" variant="secondary" className="min-h-11 w-11 shrink-0 px-0" onClick={() => setLineQty(l, n - 1)} disabled={busy || n <= 0}
          aria-label={fmt(t('vendor.refunds.decrease'), { name })} data-testid={`refund-dec-${id}`}><Minus aria-hidden="true" className="h-4 w-4" /></Button>
        <Input id={`refund-qty-${id}`} type="number" inputMode="numeric" min={0} max={max} step={1} value={n} disabled={busy}
          onChange={e => setLineQty(l, Number(e.target.value))}
          aria-label={fmt(t('vendor.refunds.qtyLabel'), { name })} aria-describedby={`refund-qty-${id}-value`}
          aria-invalid={exceeded.has(id) || undefined}
          className={`min-h-11 w-16 text-center tabular-nums ${exceeded.has(id) ? 'border-[var(--color-warning-600)]' : ''}`} data-testid={`refund-qty-${id}`} />
        <span id={`refund-qty-${id}-value`} className="sr-only">{fmt(t('vendor.refunds.a11y.qtyValue'), { qty: n, refundable: max })}</span>
        <Button type="button" variant="secondary" className="min-h-11 w-11 shrink-0 px-0" onClick={() => setLineQty(l, n + 1)} disabled={busy || n >= max}
          aria-label={fmt(t('vendor.refunds.increase'), { name })} data-testid={`refund-inc-${id}`}><Plus aria-hidden="true" className="h-4 w-4" /></Button>
      </div>
    );
  };
  const restockSwitch = (l: Line) => {
    const id = l.id!;
    if ((qty[id] ?? 0) <= 0) return null;
    const gone = restockGone.has(id);
    const on = !gone && restock[id] !== false;
    return (
      <div className="space-y-1">
        <Checkbox id={`refund-restock-${id}`} role="switch" aria-checked={on} checked={on} disabled={busy || gone}
          onChange={e => setRestock(cur => ({ ...cur, [id]: e.target.checked }))}
          label={t('vendor.refunds.restock')} aria-label={fmt(t('vendor.refunds.a11y.restock'), { name: lineName(l) })} data-testid={`refund-restock-${id}`} />
        {gone
          ? <p role="alert" className="text-xs font-medium text-[var(--color-error-700)]" data-testid={`refund-restock-gone-${id}`}>{fmt(t('vendor.refunds.err.restockUnavailable'), { name: lineName(l) })}</p>
          : !on && <p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.refunds.restockOff')}</p>}
      </div>
    );
  };
  const lineNote = (l: Line) => (exceeded.has(l.id ?? '') ? <p className="text-xs font-medium text-[var(--color-warning-700)]">{t('vendor.refunds.err.exceeds')}</p> : null);

  const chooseStep = sale && (
    <div className="space-y-5" data-testid="refund-choose">
      <h3 ref={headingRef} tabIndex={-1} className="font-semibold outline-none" data-testid="refund-step-heading">{t('vendor.refunds.pickItems')}</h3>
      {bannerEl}
      <Button type="button" variant="ghost" className="min-h-11 w-full sm:w-auto" onClick={refundAll} disabled={busy || voided} data-testid="refund-all">{t('vendor.refunds.refundAll')}</Button>
      <div className="@container">
        <div className="hidden @xl:block">
          <Table aria-label={t('vendor.refunds.pickItems')} data-testid="refund-lines-table">
            <THead>
              <Tr>
                <Th>{t('vendor.refunds.colItem')}</Th>
                <Th className="!text-right">{t('vendor.refunds.colSold')}</Th>
                <Th className="!text-right">{t('vendor.refunds.colRefunded')}</Th>
                <Th>{t('vendor.refunds.colQty')}</Th>
                <Th className="min-w-24">{t('vendor.refunds.restock')}</Th>
                <Th className="!text-right">{t('vendor.refunds.colAmount')}</Th>
              </Tr>
            </THead>
            <TBody>
              {lines.map((l, i) => (
                <Tr key={l.id ?? i} data-testid={`refund-line-${l.id ?? i}`} className={exceeded.has(l.id ?? '') ? 'bg-[var(--color-warning-50)]' : ''}>
                  <Th scope="row" className="!font-medium [overflow-wrap:anywhere]">{lineName(l)}{lineNote(l)}</Th>
                  <Td className="text-right tabular-nums">{sold(l)}</Td>
                  <Td className="text-right tabular-nums">{refundedOf(l)}</Td>
                  <Td>{refundableOf(l) > 0 && !voided ? stepper(l) : <span className="text-[var(--color-fg-tertiary)]">{t('vendor.refunds.lineAllDone')}</span>}</Td>
                  <Td>{l.id && restockSwitch(l)}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{l.id && (qty[l.id] ?? 0) > 0 ? money(preview.per[l.id]) : '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
        <ul className="space-y-2 @xl:hidden" aria-label={t('vendor.refunds.pickItems')}>
          {lines.map((l, i) => (
            <li key={l.id ?? i} className={`space-y-2 rounded-[var(--radius-lg)] border p-3 text-sm ${exceeded.has(l.id ?? '') ? 'border-[var(--color-warning-600)]' : 'border-[var(--color-border-secondary)]'}`} data-testid={`refund-card-line-${l.id ?? i}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium [overflow-wrap:anywhere]">{lineName(l)}</span>
                <span className="whitespace-nowrap tabular-nums">{l.id && (qty[l.id] ?? 0) > 0 ? money(preview.per[l.id]) : ''}</span>
              </div>
              <p className="text-[var(--color-fg-tertiary)]">{fmt(t('vendor.refunds.soldRefunded'), { sold: sold(l), refunded: refundedOf(l) })}</p>
              {lineNote(l)}
              {refundableOf(l) > 0 && !voided ? stepper(l) : <p className="text-[var(--color-fg-tertiary)]">{t('vendor.refunds.lineAllDone')}</p>}
              {l.id && restockSwitch(l)}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <div role="group" aria-label={t('vendor.refunds.a11y.reasonGroup')} className="flex flex-wrap gap-2">
          {REASONS.map(p => (
            <button key={p} type="button" aria-pressed={pill === p} className={chipCls(pill === p)} onClick={() => choosePill(p)} disabled={busy} data-testid={`refund-reason-${p}`}>
              {t(`vendor.refunds.reason.${p}` as MessageKey)}
            </button>
          ))}
        </div>
        <Field label={t('vendor.refunds.reason')} required error={fieldError.reason ?? (tried && reason.trim().length < REASON_MIN ? t('vendor.refunds.reasonMissing') : undefined)} hint={`${reason.length}/${REASON_MAX}`}>
          <Textarea ref={reasonRef} value={reason} maxLength={REASON_MAX} rows={2} disabled={busy}
            onChange={e => { setReason(e.target.value); setFieldError(f => ({ ...f, reason: undefined })); }} data-testid="refund-reason" />
        </Field>
      </div>

      {picked.length > 0 && (
        <section aria-labelledby="refund-money-heading" className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-4">
          <h4 id="refund-money-heading" className="font-semibold">{t('vendor.refunds.moneyBack')}</h4>
          {summary}
          {payBack > 0 ? (
            <div className="space-y-3">
              <div role="group" aria-label={t('vendor.refunds.method')} className="space-y-1">
                <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.refunds.method')}</p>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_METHODS.map(m => (
                    <button key={m} id={`refund-method-${m}`} type="button" aria-pressed={method === m} className={chipCls(method === m)} disabled={busy}
                      onClick={() => { setMethod(m); setFieldError(f => ({ ...f, method: undefined, reference: undefined })); }} data-testid={`refund-method-${m}`}>
                      {saleMethodLabel(m, t)}
                    </button>
                  ))}
                </div>
                {fieldError.method && <p role="alert" className="text-sm font-medium text-[var(--color-error-700)]">{fieldError.method}</p>}
              </div>
              {method !== 'cash' && (
                <Field label={refNeeded ? t('vendor.pos.reference') : t('vendor.pos.referenceOptional')} required={refNeeded}
                  error={fieldError.reference ?? (tried && refNeeded && !reference.trim() ? t('vendor.pos.referenceRequired') : undefined)} hint={t('vendor.pos.referenceHint')}>
                  <Input ref={referenceRef} value={reference} maxLength={REFERENCE_MAX} disabled={busy} className="min-h-11"
                    onChange={e => { setReference(e.target.value); setFieldError(f => ({ ...f, reference: undefined })); }} data-testid="refund-reference" />
                </Field>
              )}
            </div>
          ) : (
            <Alert tone="info"><span data-testid="refund-nothing-back">{t('vendor.refunds.nothingBack')}</span></Alert>
          )}
        </section>
      )}
      {notice}
    </div>
  );

  const confirmStep = sale && (
    <div className="space-y-4" data-testid="refund-confirm">
      <h3 ref={headingRef} tabIndex={-1} className="font-semibold outline-none [overflow-wrap:anywhere]" data-testid="refund-step-heading">
        {fmt(t('vendor.refunds.confirmTitle'), { amount: money(preview.total), number: saleNumber })}
      </h3>
      {bannerEl}
      <ul className="space-y-1 text-sm" data-testid="refund-confirm-lines">
        {picked.map(l => {
          const back = !restockGone.has(l.id!) && restock[l.id!] !== false;
          return (
            <li key={l.id} className="[overflow-wrap:anywhere]">
              {qty[l.id!]} × {lineName(l)} · <span className="tabular-nums">{money(preview.per[l.id!])}</span> · {t(back ? 'vendor.refunds.backInStock' : 'vendor.refunds.notBackInStock')}
            </li>
          );
        })}
      </ul>
      {summary}
      {payBack > 0 && (
        <p className="text-sm" data-testid="refund-confirm-method">{fmt(t('vendor.refunds.refundedBy'), { method: saleMethodLabel(method, t) })}{method !== 'cash' && reference.trim() ? ` (${reference.trim()})` : ''}</p>
      )}
      <p className="text-sm text-[var(--color-fg-tertiary)]">{fmt(t('vendor.refunds.reasonLabel'), { reason: reason.trim() })}</p>
      {notice}
      <p className="text-sm">{t('vendor.refunds.confirmBody')}</p>
    </div>
  );

  return (
    <Dialog open onClose={requestClose} title={title} size="lg" sheetOnMobile testId="refund-dialog">
      {load === 'loading' && <div aria-busy="true" aria-label={t('vendor.refunds.loading')} data-testid="refund-loading"><SkeletonTable rows={3} columns={4} /></div>}
      {load === 'error' && (
        <div className="space-y-3" data-testid="refund-load-failed">
          <Alert tone="error">{t('vendor.refunds.loadFailed')}</Alert>
          <Button variant="secondary" className="min-h-11" onClick={() => void reload()}>{t('common.tryAgain')}</Button>
        </div>
      )}
      {load === 'ready' && (step === 'choose' ? chooseStep : confirmStep)}
      {asking ? (
        <DialogFooter className="sticky bottom-0 flex-wrap">
          <p className="mr-auto text-sm font-medium" role="alert" data-testid="refund-discard">{t('vendor.refunds.discardTitle')}</p>
          <Button variant="secondary" className="min-h-11" onClick={() => setAsking(false)} data-testid="refund-stay">{t('vendor.refunds.stay')}</Button>
          <Button variant="destructive" className="min-h-11" onClick={onClose} data-testid="refund-leave">{t('vendor.refunds.discard')}</Button>
        </DialogFooter>
      ) : load === 'ready' && step === 'choose' ? (
        <DialogFooter className="sticky bottom-0 flex-wrap">
          {missing && <p className="mr-auto text-sm text-[var(--color-fg-tertiary)]" data-testid="refund-missing">{t(missing)}</p>}
          <Button variant="secondary" className="min-h-11" onClick={requestClose} data-testid="refund-cancel">{t('common.cancel')}</Button>
          <Button className="min-h-11" onClick={review} disabled={voided || !!missing} data-testid="refund-review">
            {fmt(t('vendor.refunds.review'), { amount: money(preview.total) })}
          </Button>
        </DialogFooter>
      ) : load === 'ready' ? (
        <DialogFooter className="sticky bottom-0 flex-wrap">
          <Button variant="secondary" className="min-h-11" onClick={() => backToChoose()} disabled={busy} data-testid="refund-back">{t('vendor.refunds.back')}</Button>
          <Button className="min-h-11" onClick={save} loading={busy} aria-busy={busy} data-testid="refund-confirm-button">
            {busy ? t('vendor.refunds.saving') : banner?.retry ? t('common.tryAgain') : fmt(t('vendor.refunds.confirm'), { amount: money(preview.total) })}
          </Button>
        </DialogFooter>
      ) : null}
    </Dialog>
  );
}
