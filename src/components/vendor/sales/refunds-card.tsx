'use client';
// S7 (docs/design/vendor-refunds-s7.md §5.1, §5.3): the Refunds card on the portal sale detail and the Undo dialog.
// Every refund of the sale (active and undone) is read by id (GET /vendor/refunds/:id stays readable when the refunds
// tool is off, §0.2), so the card shows the same rows read only when the flag is off. Undo needs the tool on and the
// M2 rule (mayRevertRefund mirrors it; the server decides). Walk-in money never passes through FitFlex.
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, type VendorRefund, type VendorSale } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import {
  canCustomers, customerName, documentsOn, eatDateTime, errorBody, errorCode, fmt, isRefusal, mayRevertRefund, refundErrorKey, refundsOn, saleMethodLabel,
} from '@/lib/vendor';
import { documentHref } from '@/lib/vendor-documents';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, Table, TBody, Td, Textarea, Th, THead, Tr, useToast } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';

const REASON_MIN = 3;
const REASON_MAX = 200;
const linkCls = 'inline-flex min-h-11 items-center whitespace-nowrap font-mono font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline';
const alertLinkCls = 'inline-flex min-h-11 items-center font-semibold underline underline-offset-4';

type Row = { id: string; number: string; status: 'active' | 'reverted'; refundedAt: string; amountTzs: number; detail: VendorRefund | null };
const restockedUnits = (r: VendorRefund | null) => (r ? r.lines.filter(l => l.restock).reduce((n, l) => n + l.qty, 0) : null);

export function RefundsCard({
  sale, onSaleChanged, focusRefundId, onFocused,
}: {
  sale: VendorSale;
  onSaleChanged: (sale: VendorSale) => void;
  /** After a refund is saved: focus its row once it shows (§3.3). */
  focusRefundId: string | null;
  onFocused: () => void;
}) {
  const { token, t, locale, user } = useApp();
  const vendor = useVendor();
  const on = refundsOn(vendor.me);
  const docs = documentsOn(vendor.me);
  const summaries = sale.refunds ?? [];
  const [details, setDetails] = useState<Record<string, VendorRefund>>({});
  const [undo, setUndo] = useState<VendorRefund | null>(null);
  /** After an undo: back to that row (its Undo button is gone). */
  const [undoneId, setUndoneId] = useState<string | null>(null);
  const focusId = focusRefundId ?? undoneId;
  const sig = summaries.map(r => `${r.id}:${r.status}`).join(',');

  // The extra columns (paid back, method, back in stock) come from each refund; a failed read leaves "—".
  useEffect(() => {
    if (!token || !summaries.length) return;
    let alive = true;
    const missing = summaries.filter(r => details[r.id]?.status !== r.status);
    if (!missing.length) return;
    Promise.all(missing.map(r => api.vendorRefund(token, r.id).then(x => x.refund).catch(() => null)))
      .then(list => {
        if (!alive) return;
        setDetails(cur => {
          const next = { ...cur };
          for (const r of list) if (r) next[r.id] = r;
          return next;
        });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sig]);

  // §3.3: focus the new row (table on wide panels, card on narrow ones) once it has rendered.
  useEffect(() => {
    if (!focusId) return;
    let tries = 0;
    const done = () => { onFocused(); setUndoneId(null); };
    const tryFocus = () => {
      const el = [document.getElementById(`refund-row-${focusId}`), document.getElementById(`refund-card-${focusId}`)].find(x => x && x.offsetParent !== null);
      if (el) { el.focus(); done(); return; }
      if (++tries < 20) requestAnimationFrame(tryFocus); else done();
    };
    // After the dialog has closed and handed focus back.
    requestAnimationFrame(() => requestAnimationFrame(tryFocus));
  }, [focusId, onFocused, sig]);

  if (!summaries.length) return null;

  const rows: Row[] = summaries.map(r => ({ ...r, detail: details[r.id] ?? null }));
  const who = { userId: user?.id, userType: user?.userType, vendorRole: vendor.me?.vendorRole };
  const canUndo = (r: Row) => on && sale.status === 'completed' && !!r.detail && mayRevertRefund({ status: r.status, refundedAt: r.refundedAt, createdBy: r.detail.createdBy }, who);
  const statusWord = (r: Row) => t(r.status === 'reverted' ? 'vendor.refunds.status.reverted' : 'vendor.refunds.status.active');
  const amount = (r: Row) => (
    <span className={`whitespace-nowrap tabular-nums ${r.status === 'reverted' ? 'line-through text-[var(--color-fg-quaternary)]' : ''}`}>{money(r.amountTzs)}</span>
  );
  const number = (r: Row) => (docs
    ? <Link href={documentHref('credit_note', r.id, null, sale.id)} className={linkCls} data-testid={`refund-doc-${r.id}`}>{r.number}</Link>
    : <span className="whitespace-nowrap font-mono font-semibold">{r.number}</span>);
  const method = (r: Row) => (r.detail?.method && r.detail.paidOutTzs > 0 ? `${saleMethodLabel(r.detail.method, t)}${r.detail.reference ? ` (${r.detail.reference})` : ''}` : '—');
  const label = (r: Row) => fmt(t('vendor.refunds.rowLabel'), { number: r.number, amount: money(r.amountTzs), date: eatDateTime(r.refundedAt, locale), status: statusWord(r) });
  const undoButton = (r: Row, full = false) => (canUndo(r) ? (
    <Button variant="ghost" className={`min-h-11 text-[var(--color-error-700)] ${full ? 'w-full' : ''}`} onClick={() => setUndo(r.detail)}
      aria-label={fmt(t('vendor.refunds.a11y.undo'), { number: r.number })} data-testid={`refund-undo-${r.id}`}>
      {t('vendor.refunds.revert')}
    </Button>
  ) : null);

  return (
    <Card data-testid="sale-refunds">
      <CardHeader><h3 className="font-semibold">{t('vendor.refunds.section')}</h3></CardHeader>
      <CardContent className="@container space-y-2">
        <div className="hidden @3xl:block">
          <Table aria-label={t('vendor.refunds.section')} data-testid="sale-refunds-table">
            <THead>
              <Tr>
                <Th>{t('vendor.refunds.colCreditNote')}</Th>
                <Th>{t('vendor.refunds.colDate')}</Th>
                <Th className="!text-right">{t('vendor.refunds.colAmount')}</Th>
                <Th className="!text-right">{t('vendor.refunds.colPaidBack')}</Th>
                <Th>{t('vendor.refunds.colMethod')}</Th>
                <Th className="!text-right min-w-24">{t('vendor.refunds.colRestocked')}</Th>
                <Th>{t('vendor.refunds.colStatus')}</Th>
                <Th><span className="sr-only">{t('common.actions')}</span></Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map(r => (
                <Tr key={r.id} id={`refund-row-${r.id}`} tabIndex={-1} aria-label={label(r)} className="outline-none focus:bg-[var(--color-bg-secondary)]" data-testid={`refund-row-${r.id}`}>
                  <Td>{number(r)}</Td>
                  <Td className="whitespace-nowrap">{eatDateTime(r.refundedAt, locale)}</Td>
                  <Td className="text-right">{amount(r)}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{r.detail ? money(r.detail.paidOutTzs) : '—'}</Td>
                  <Td>{method(r)}</Td>
                  <Td className="text-right tabular-nums">{restockedUnits(r.detail) ?? '—'}</Td>
                  <Td><Badge tone="gray">{statusWord(r)}</Badge></Td>
                  <Td>{undoButton(r)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
        <ul className="space-y-2 @3xl:hidden" aria-label={t('vendor.refunds.section')}>
          {rows.map(r => (
            <li key={r.id} id={`refund-card-${r.id}`} tabIndex={-1} aria-label={label(r)} className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-600)]" data-testid={`refund-card-${r.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {number(r)}
                <Badge tone="gray">{statusWord(r)}</Badge>
              </div>
              <p className="flex flex-wrap gap-x-2 text-[var(--color-fg-tertiary)]">
                <span>{eatDateTime(r.refundedAt, locale)}</span>
                <span aria-hidden="true">·</span>{amount(r)}
                {r.detail && r.detail.paidOutTzs > 0 && <><span aria-hidden="true">·</span><span>{method(r)}</span></>}
                {(restockedUnits(r.detail) ?? 0) > 0 && <><span aria-hidden="true">·</span><span>{fmt(t('vendor.refunds.unitsBack'), { n: restockedUnits(r.detail) ?? 0 })}</span></>}
              </p>
              {undoButton(r, true)}
            </li>
          ))}
        </ul>
      </CardContent>
      {undo && (
        <UndoDialog
          refund={undo}
          sale={sale}
          onClose={() => setUndo(null)}
          onDone={(refund, fresh) => {
            setDetails(cur => ({ ...cur, [refund.id]: refund }));
            onSaleChanged(fresh);
            setUndo(null);
            setUndoneId(refund.id);
          }}
        />
      )}
    </Card>
  );
}

/** §5.3 / §4.5: undo needs a reason; errors stay inside the dialog. */
function UndoDialog({ refund, sale, onClose, onDone }: { refund: VendorRefund; sale: VendorSale; onClose: () => void; onDone: (refund: VendorRefund, sale: VendorSale) => void }) {
  const { token, t } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  /** A request went out and no answer came back: a later 409 already_reverted means that one worked. */
  const lostAnswer = useRef(false);
  const credit = refund.saleKind === 'credit' && refund.balanceReducedTzs > 0;
  const restocked = refund.lines.some(l => l.restock);
  const who = customerName(refund.customer ?? sale.customer, t);

  const reload = useCallback(async () => {
    if (!token) return null;
    const [r, s] = await Promise.all([api.vendorRefund(token, refund.id), api.vendorSale(token, sale.id)]);
    return { refund: r.refund, sale: s.sale };
  }, [token, refund.id, sale.id]);

  async function confirm() {
    if (!token) return;
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) { setReasonError(t('vendor.refunds.reasonMissing')); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.vendorRevertRefund(token, refund.id, trimmed);
      toast.success(fmt(t('vendor.refunds.reverted'), { number: res.refund.number }));
      onDone(res.refund, res.sale);
    } catch (err) {
      if (!isRefusal(err)) {
        // Never queued; the request may still have arrived, so Try again sends it again.
        lostAnswer.current = true;
        setError(t(err instanceof ApiError && err.status >= 500 ? 'vendor.refunds.err.server' : 'vendor.refunds.offline'));
        return;
      }
      const code = errorCode(err);
      if (code === 'reason_required' || code === 'reason_too_long') { setReasonError(t(code === 'reason_too_long' ? 'vendor.refunds.reasonTooLong' : 'vendor.refunds.reasonMissing')); return; }
      if (code === 'rate_limited') { setError(t('vendor.refunds.err.tooFast')); return; }
      if (code === 'already_reverted') {
        // A retry after a lost answer: the first request did it (functions#318 review). Either way, show the undone state.
        try {
          const fresh = await reload();
          if (lostAnswer.current) toast.success(fmt(t('vendor.refunds.reverted'), { number: refund.number }));
          else toast.info(t('vendor.refunds.err.alreadyReverted'));
          if (fresh) onDone(fresh.refund, fresh.sale);
        } catch { setError(t('vendor.refunds.err.alreadyReverted')); }
        return;
      }
      if (code === 'insufficient_stock') {
        const body = errorBody<{ productId?: string; variant?: string | null; available?: number }>(err);
        const line = refund.lines.find(l => l.productId === body?.productId && (l.variant ?? null) === (body?.variant ?? null)) ?? refund.lines.find(l => l.productId === body?.productId);
        const name = line ? `${line.nameSnapshot}${line.variant ? ` (${line.variant})` : ''}` : '—';
        const q = new URLSearchParams({ id: body?.productId ?? '' });
        if (body?.variant) q.set('variant', body.variant);
        setError(
          <span data-testid="refund-undo-stock">
            <span className="block">{fmt(t('vendor.refunds.err.revertStock'), { available: body?.available ?? 0, name })}</span>
            {vendor.can('products') && body?.productId && <Link href={`/vendor/products/history/?${q.toString()}`} className={alertLinkCls}>{t('vendor.refunds.countStock')}</Link>}
          </span>,
        );
        return;
      }
      if (code === 'customer_archived') {
        const id = errorBody<{ customerId?: string }>(err)?.customerId ?? refund.customer?.id;
        setError(
          <span data-testid="refund-undo-archived">
            <span className="block">{fmt(t('vendor.refunds.err.customerArchived'), { name: who })}</span>
            {canCustomers(vendor.me) && id && <Link href={`/vendor/customers/?id=${encodeURIComponent(id)}`} className={alertLinkCls}>{t('vendor.refunds.openCustomer')}</Link>}
          </span>,
        );
        return;
      }
      if (code === 'vendor_permission_forbidden') { setError(t('vendor.refunds.askOwner')); void vendor.refresh(); return; }
      if (code === 'feature_disabled') { toast.error(t('vendor.refunds.unavailable')); void vendor.refresh(); onClose(); return; }
      if (code === 'vendor_suspended' && vendor.handleError(err)) { onClose(); return; }
      setError(t(refundErrorKey(code)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={fmt(t('vendor.refunds.revertTitle'), { number: refund.number })}>
      <div className="space-y-3 text-sm" data-testid="refund-undo-dialog">
        <p>{fmt(t('vendor.refunds.revertBody'), { amount: money(refund.amountTzs) })}</p>
        {credit && <p data-testid="refund-undo-credit">{fmt(t('vendor.refunds.revertCredit'), { amount: money(refund.balanceReducedTzs), name: who })}</p>}
        {restocked && <p data-testid="refund-undo-restock">{t('vendor.refunds.revertStock')}</p>}
        {error && <div role="alert" aria-live="assertive"><Alert tone="error">{error}</Alert></div>}
        <Field label={t('vendor.refunds.revertReason')} required error={reasonError ?? undefined} hint={`${reason.length}/${REASON_MAX}`}>
          <Textarea value={reason} maxLength={REASON_MAX} rows={3} disabled={busy} onChange={e => { setReason(e.target.value); setReasonError(null); }} data-testid="refund-undo-reason" />
        </Field>
      </div>
      <DialogFooter className="flex-wrap">
        <Button variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant="destructive" className="min-h-11" onClick={confirm} loading={busy} aria-busy={busy} disabled={reason.trim().length < REASON_MIN} data-testid="refund-undo-confirm">
          {error && lostAnswer.current ? t('common.tryAgain') : t('vendor.refunds.revert')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
