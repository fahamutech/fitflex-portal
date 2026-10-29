'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import { money } from '@/lib/admin-utils';
import { eatDateTime, eatDay, fmt } from '@/lib/vendor';
import { PHASE_TONE, phaseOf, type AuditRow } from '@/lib/shop-banners';
import {
  SALE_HIST_KEY, SALE_PHASE_KEY, SALE_REJECT_CODES, SALE_REJECT_KEY, discountPctOf, saleCan, saleErrorCode, saleMessageOf, saleReasonText, salesApi,
  type AdminPriceCheck, type FlashSale, type SaleRejectCode,
} from '@/lib/flash-sales';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Checkbox, Field, Radio, Spinner, Textarea } from './shared';
import { Dialog } from './dialog';
import { SalePriceBlock, SaleThumb } from './flash-sale-form';
import { useToast } from './ui/toast';
import { useApp } from '../../app/providers';

const NOTE_MIN = 10;
const NOTE_MAX = 500;

/** H1: whoever created, sent or changed a sale can't decide it (server: 403 cannot_approve_own_submission). */
export function workedOnSale(s: FlashSale, userId: string | undefined): 'created' | 'worked' | null {
  if (userId && (userId === s.createdBy || userId === s.submittedBy)) return 'created';
  if (userId && (s.editedBy ?? []).includes(userId)) return 'worked';
  return s.ownItem ? 'worked' : null;
}

/**
 * One flash sale in the merch queue (spec §5.3.2, §8.5): the product card in sale state, the prices, the window in
 * Tanzania time, the price check (14-day rule, 30-day price history, "−N% (TSh … off), seller pays"), its history,
 * and only what this admin may do. Approve is disabled when the price check fails, the regular price moved since
 * sending, or this admin had a hand in it; the server checks all of it again.
 */
export function FlashSaleDetail({ id, fallback, onBack, onEdit, onChanged }: {
  id: string; fallback?: FlashSale | null; onBack: () => void; onEdit: (id: string) => void; onChanged: () => void;
}) {
  const { token, t, locale, user, hasPermission } = useApp();
  const toast = useToast();
  const ownHintId = useId();
  const blockHintId = useId();
  const [sale, setSale] = useState<FlashSale | null>(fallback ?? null);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [check, setCheck] = useState<AdminPriceCheck | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'end' | 'withdraw' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const deps = { money: (n: number) => money(n), when: (iso: string) => eatDateTime(iso, locale), day: (ymd: string) => eatDay(ymd, locale) };

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { const r = await salesApi.adminGet(token, id); setSale(r.sale); setHistory(r.history); setCheck(r.priceCheck); setLoaded(true); }
    catch (err) {
      if (saleErrorCode(err) === 'sale_not_found') setNotFound(true);
      else setError(t(saleMessageOf(err, deps, 'merchAdmin.loadFailed', 'admin').key));
    }
  }, [token, id, t]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  if (notFound) return <div className="space-y-4"><Alert tone="warning">{t('merch.notYours')}</Alert><Button variant="secondary" onClick={onBack}>{t('merchAdmin.back')}</Button></div>;
  if (!sale) return error ? <Alert tone="error">{error}</Alert> : <Spinner className="h-6 w-6" />;

  const phase = phaseOf(sale);
  const canApproveScope = hasPermission('promotions_approve');
  const own = workedOnSale(sale, user?.id);
  const pending = phase === 'pending';
  const showDecide = pending && canApproveScope;
  const decideBlocked = showDecide && !!own;
  const priceMoved = !!(check?.priceChangedSinceSubmit ?? sale.priceChangedSinceSubmit);
  const fails = !!check && !check.passes14DayRule;
  // Approve waits for the price check (the detail answer) and is blocked when it fails or the price moved (§8.5).
  const approveBlocked = decideBlocked || !loaded || !check || fails || priceMoved || !saleCan(sale, 'approve');
  const was = sale.wasPriceTzs ?? sale.regularPriceTzs;
  const pct = sale.discountPct ?? discountPctOf(was, sale.salePriceTzs);
  const saving = sale.savingTzs ?? was - sale.salePriceTzs;
  const line = check?.discountLine ?? { pct: pct ?? 0, savingTzs: saving, sellerPays: true };

  const after = async (doneKey: MessageKey, next?: FlashSale | null) => {
    setDialog(null); setNotice(null);
    toast.success(t(doneKey));
    if (next?.id) setSale(next);
    await load();
    onChanged();
  };
  /** 409 sale_changed (or the price moved): close, reload and say why; never decide on what wasn't seen. */
  const stale = (err: unknown) => {
    setDialog(null);
    setNotice(t(saleMessageOf(err, deps, 'merchAdmin.actionFailed', 'admin').key));
    void load(); onChanged();
  };
  const simple = async (fn: () => Promise<FlashSale>, doneKey: MessageKey) => {
    if (busy) return;
    setBusy(true);
    try { await after(doneKey, await fn()); }
    catch (err) { const m = saleMessageOf(err, deps, 'merchAdmin.actionFailed', 'admin'); toast.error(fmt(t(m.key), m.vars)); }
    finally { setBusy(false); }
  };
  const row = (label: string, value: React.ReactNode, testId?: string) => (
    <div className="grid gap-1 py-2 sm:grid-cols-3 [&>*]:min-w-0 [overflow-wrap:anywhere]"><dt className="text-sm text-[var(--color-fg-tertiary)]">{label}</dt><dd className="text-sm sm:col-span-2" data-testid={testId}>{value}</dd></div>
  );
  const person = (idv?: string | null, name?: string | null) => name || idv || '';
  const seller = sale.vendorName || sale.vendorId;
  const histLine = (h: { at: string; fromTzs: number | null; toTzs: number | null; field: string; raised: boolean }) => fmt(t(h.field === 'discountPriceTzs' ? 'merchAdmin.priceHistDiscount' : h.raised ? 'merchAdmin.priceHistRaised' : 'merchAdmin.priceHistLowered'), {
    date: eatDay(h.at, locale), from: h.fromTzs == null ? '—' : money(h.fromTzs), to: h.toTzs == null ? '—' : money(h.toTzs),
  });

  return (
    <div className="space-y-6" data-testid="sale-detail">
      <Button variant="link" onClick={onBack} className="-ml-2 h-auto min-h-10 gap-1.5 px-2 text-sm font-normal text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)] hover:no-underline" data-testid="merch-back">
        <ArrowLeft className="h-4 w-4" />{t('merchAdmin.back')}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="warning"><span data-testid="sale-stale">{notice}</span></Alert>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-full [overflow-wrap:anywhere]">
          <p className="text-xs uppercase tracking-wide text-[var(--color-fg-quaternary)]">{t('merchAdmin.type.sale')} · {seller}{sale.origin === 'staff' ? ` · ${t('merchAdmin.setByFitflex')}` : ''}</p>
          <h1 className="text-xl font-semibold" data-testid="sale-title">{sale.productName || sale.productId}</h1>
          {saleReasonText(sale, t) && <p className="mt-1 text-sm text-[var(--color-fg-tertiary)]" data-testid="sale-reason">{fmt(t('merch.line.reason'), { reason: saleReasonText(sale, t) })}</p>}
        </div>
        <Badge tone={PHASE_TONE[phase]} dot><span data-testid="sale-status">{t(SALE_PHASE_KEY[phase])}</span></Badge>
      </div>
      {sale.sellerSuspended && <Alert tone="warning">{t('merchAdmin.saleSellerSuspended')}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          {/* 1. Preview: the product card in sale state */}
          <Card>
            <CardContent className="p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-quaternary)]">{t('merch.banner.preview')}</p>
              <div className="flex max-w-xs items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] p-3" data-testid="sale-preview">
                <SaleThumb src={sale.productImage} className="h-16 w-16" />
                <div className="min-w-0 space-y-1">
                  <p className="line-clamp-2 text-sm font-medium">{sale.productName || sale.productId}</p>
                  <SalePriceBlock sale={sale.salePriceTzs} was={was} pct={pct} />
                  <p className="text-xs text-[var(--color-fg-tertiary)]">{fmt(t('merch.sale.line.ends'), { date: eatDateTime(sale.endsAt, locale) })}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 2. Details */}
          <Card>
            <CardHeader><h2 className="font-semibold">{t('merchAdmin.details')}</h2></CardHeader>
            <CardContent>
              <dl className="divide-y divide-[var(--color-border-secondary)]" data-testid="sale-terms">
                {row(t('merch.sale.product'), sale.productName || sale.productId, 'sale-product')}
                {row(t('merchAdmin.col.seller'), seller, 'sale-seller')}
                {row(t('merchAdmin.regularNow'), money(sale.regularPriceTzs), 'sale-regular-now')}
                {sale.discountPriceTzs != null && sale.discountPriceTzs > 0 && sale.discountPriceTzs < sale.regularPriceTzs && row(t('merchAdmin.standingDiscount'), money(sale.discountPriceTzs), 'sale-standing')}
                {row(t('merchAdmin.salePrice'), money(sale.salePriceTzs), 'sale-price')}
                {row(t('merchAdmin.col.discount'), pct != null ? fmt(t('merchAdmin.discountCell'), { pct, saving: money(saving) }) : '—', 'sale-discount')}
                {row(t('merchAdmin.col.dates'), `${eatDateTime(sale.startsAt, locale)} → ${eatDateTime(sale.endsAt, locale)} (${t('merch.dates.tzNote')})`, 'sale-dates')}
                {phase === 'pending' && sale.expiresAt && row(t('merchAdmin.expiresAt'), eatDateTime(sale.expiresAt, locale), 'sale-expires')}
                {row(t('merchAdmin.people'), [
                  sale.createdBy && `${t('merchAdmin.sale.createdBy')}: ${person(sale.createdBy, sale.createdByName)}`,
                  sale.submittedBy && `${t('merchAdmin.sale.submittedBy')}: ${person(sale.submittedBy, sale.submittedByName)}`,
                  sale.approvedBy && `${t('merchAdmin.sale.approvedBy')}: ${person(sale.approvedBy, sale.approvedByName)}`,
                  sale.endedBy && `${t('merchAdmin.endedBy')}: ${person(sale.endedBy, sale.endedByName)}`,
                ].filter(Boolean).join(' · ') || '—')}
              </dl>
            </CardContent>
          </Card>

          {/* 3. Price check (spec §8.5) */}
          <Card>
            <CardHeader><h2 className="font-semibold">{t('merchAdmin.priceCheck')}</h2></CardHeader>
            <CardContent className="space-y-3" >
              <div data-testid="sale-price-check" className="space-y-3">
                <p className="text-sm">{fmt(t('merchAdmin.regularNowLine'), { price: money(sale.regularPriceTzs) })}</p>
                {!loaded ? <Spinner className="h-5 w-5" /> : check ? (
                  <>
                    <p className={`flex items-start gap-2 text-sm font-medium ${check.passes14DayRule ? 'text-[var(--color-success-700)]' : 'text-[var(--color-error-700)]'}`} data-testid="sale-rule-result">
                      {check.passes14DayRule ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
                      {check.passes14DayRule ? t('merchAdmin.pass') : fmt(t('merchAdmin.fail'), {
                        date: check.raisedOn ? eatDay(check.raisedOn, locale) : eatDateTime(check.raisedAt, locale), earliest: eatDateTime(check.earliestStart, locale),
                      })}
                    </p>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-quaternary)]">{t('merchAdmin.priceHistory')}</p>
                      {check.priceHistory.length === 0
                        ? <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="sale-price-history-empty">{t('merchAdmin.priceHistoryNone')}</p>
                        : <ul className="mt-1 space-y-1 text-sm tabular-nums" data-testid="sale-price-history">{check.priceHistory.map((h, i) => <li key={`${h.at}-${i}`}>{histLine(h)}</li>)}</ul>}
                    </div>
                  </>
                ) : <p className="text-sm text-[var(--color-fg-tertiary)]">{t('merchAdmin.priceCheckMissing')}</p>}
                <p className="text-sm font-semibold" data-testid="sale-discount-line">{fmt(t('merchAdmin.sellerPays'), { pct: line.pct, saving: money(line.savingTzs) })}</p>
                {priceMoved && <Alert tone="error"><span data-testid="sale-price-moved">{t('merchAdmin.priceMoved')}</span></Alert>}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <Card className="self-start">
          <CardHeader><h2 className="font-semibold">{t('merchAdmin.actions')}</h2></CardHeader>
          <CardContent className="space-y-3">
            {!canApproveScope && <p className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="merch-no-approve">{t('merchAdmin.noApprove')}</p>}
            {decideBlocked && <p id={ownHintId} className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="merch-own-item">{t(own === 'worked' ? 'merchAdmin.saleOwnWork' : 'merchAdmin.saleOwnItem')}</p>}
            {showDecide && !decideBlocked && (fails || priceMoved) && (
              <p id={blockHintId} className="rounded-[var(--radius-md)] bg-[var(--color-error-50)] p-3 text-sm text-[var(--color-error-700)]" data-testid="sale-approve-blocked">
                {priceMoved ? t('merchAdmin.priceMoved') : fmt(t('merchAdmin.fail'), { date: check?.raisedOn ? eatDay(check.raisedOn, locale) : eatDateTime(check?.raisedAt, locale), earliest: eatDateTime(check?.earliestStart, locale) })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {showDecide && (
                <>
                  <Button size="sm" disabled={approveBlocked} aria-describedby={decideBlocked ? ownHintId : fails || priceMoved ? blockHintId : undefined} onClick={() => setDialog('approve')} data-testid="merch-approve">{t('merchAdmin.approve')}</Button>
                  <Button size="sm" variant="secondary" disabled={decideBlocked || !saleCan(sale, 'reject')} aria-describedby={decideBlocked ? ownHintId : undefined} onClick={() => setDialog('reject')} data-testid="merch-reject">{t('merchAdmin.reject')}</Button>
                </>
              )}
              {saleCan(sale, 'submit') && <Button size="sm" loading={busy} onClick={() => void simple(() => salesApi.adminSubmit(token!, sale.id), 'merchAdmin.sale.done.sent')} data-testid="merch-submit">{t('merch.send')}</Button>}
              {saleCan(sale, 'end') && <Button size="sm" variant="secondary" onClick={() => setDialog('end')} data-testid="merch-end">{t('merchAdmin.end')}</Button>}
              {saleCan(sale, 'edit') && sale.origin === 'staff' && <Button size="sm" variant="secondary" onClick={() => onEdit(sale.id)} data-testid="merch-edit">{t('merch.action.edit')}</Button>}
              {saleCan(sale, 'withdraw') && sale.origin === 'staff' && <Button size="sm" variant="ghost" onClick={() => setDialog('withdraw')} data-testid="merch-withdraw">{t('merch.action.withdraw')}</Button>}
            </div>
            {!showDecide && !(sale.allowedActions ?? []).length && <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="merch-no-actions">{t('merchAdmin.saleNoActions')}</p>}
          </CardContent>
        </Card>
      </div>

      {history.length > 0 && (
        <Card>
          <CardHeader><h2 className="font-semibold">{t('merchAdmin.history')}</h2></CardHeader>
          <CardContent>
            <ol className="space-y-3" data-testid="merch-history">
              {history.map((h, i) => {
                const verb = String(h.action ?? '').replace(/^flash_sale\./, '');
                const note = typeof h.after?.note === 'string' ? h.after.note : typeof h.after?.reason === 'string' ? h.after.reason : null;
                return (
                  <li key={h.id ?? i} className="border-l-2 border-[var(--color-border-secondary)] pl-3 text-sm [overflow-wrap:anywhere]">
                    <p className="font-medium">{t(SALE_HIST_KEY[verb] ?? 'merchAdmin.hist.other')}</p>
                    <p className="text-xs text-[var(--color-fg-quaternary)]">{eatDateTime(h.at ?? h.createdAt, locale)} · {h.actorName || h.actor || '—'}</p>
                    {note && <p className="mt-1 text-[var(--color-fg-secondary)]">{note}</p>}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {dialog === 'approve' && <ApproveSaleDialog sale={sale} onClose={() => setDialog(null)} onDone={s => after('merchAdmin.sale.done.approved', s)} onStale={stale} />}
      {dialog === 'reject' && <RejectSaleDialog sale={sale} onClose={() => setDialog(null)} onDone={s => after('merchAdmin.done.rejected', s)} onStale={stale} />}
      {dialog === 'end' && <EndSaleDialog sale={sale} onClose={() => setDialog(null)} onDone={s => after('merchAdmin.sale.done.ended', s)} />}
      <Dialog open={dialog === 'withdraw'} onClose={() => setDialog(null)} title={t('merch.withdrawSale.title')} description={t('merch.sale.withdrawBody')} size="sm">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialog(null)}>{t('merch.sale.keep')}</Button>
          <Button variant="destructive" loading={busy} onClick={() => void simple(() => salesApi.adminWithdraw(token!, sale.id), 'merch.sale.withdrawn')} data-testid="merch-withdraw-confirm">{t('merch.withdraw.confirm')}</Button>
        </div>
      </Dialog>
    </div>
  );
}

function useSaleAction(onDone: (s: FlashSale) => void, onStale?: (err: unknown) => void) {
  const { t, locale } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<FlashSale>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { onDone(await fn()); }
    catch (err) {
      if (saleErrorCode(err) === 'sale_changed' && onStale) { onStale(err); return; }
      const m = saleMessageOf(err, { money: n => money(n), when: iso => eatDateTime(iso, locale), day: ymd => eatDay(ymd, locale) }, 'merchAdmin.actionFailed', 'admin');
      setError(fmt(t(m.key), m.vars)); setBusy(false);
    }
  };
  return { busy, error, run };
}
const footer = 'flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4';

function ApproveSaleDialog({ sale, onClose, onDone, onStale }: { sale: FlashSale; onClose: () => void; onDone: (s: FlashSale) => void; onStale: (err: unknown) => void }) {
  const { token, t } = useApp();
  const [ok, setOk] = useState(false);
  const { busy, error, run } = useSaleAction(onDone, onStale);
  return (
    <Dialog open onClose={onClose} title={t('merchAdmin.approve')} description={t('merchAdmin.approveSaleHint')} size="md">
      <form onSubmit={e => { e.preventDefault(); if (ok && token) void run(() => salesApi.adminApprove(token, sale)); }} className="space-y-3" data-testid="merch-approve-dialog">
        {error && <Alert tone="error"><span data-testid="merch-approve-error">{error}</span></Alert>}
        <fieldset className="flex flex-col">
          <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merchAdmin.checklist')}</legend>
          <Checkbox checked={ok} onChange={e => setOk(e.target.checked)} label={t('merchAdmin.check.sale')} data-testid="merch-check-sale" />
        </fieldset>
        <div className={footer}>
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={!ok} loading={busy} data-testid="merch-approve-confirm">{t('merchAdmin.approve')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function RejectSaleDialog({ sale, onClose, onDone, onStale }: { sale: FlashSale; onClose: () => void; onDone: (s: FlashSale) => void; onStale: (err: unknown) => void }) {
  const { token, t } = useApp();
  const [code, setCode] = useState<SaleRejectCode | null>(null);
  const [note, setNote] = useState('');
  const { busy, error, run } = useSaleAction(onDone, onStale);
  const n = note.trim().length;
  const noteNeeded = code === 'other';
  const noteOk = noteNeeded ? n >= NOTE_MIN : n === 0 || n >= NOTE_MIN;
  const ok = !!code && noteOk;
  return (
    <Dialog open onClose={onClose} title={t('merchAdmin.reject')} description={t('merchAdmin.reason.noteHint')} size="md">
      <form onSubmit={e => { e.preventDefault(); if (ok && code && token) void run(() => salesApi.adminReject(token, sale, code, note)); }} className="space-y-3" data-testid="merch-reject-dialog">
        {error && <Alert tone="error">{error}</Alert>}
        <fieldset className="flex flex-col">
          <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merchAdmin.reason')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></legend>
          {SALE_REJECT_CODES.map(r => <Radio key={r} name="sale-reject-reason" checked={code === r} onChange={() => setCode(r)} label={t(SALE_REJECT_KEY[r])} data-testid={`merch-reason-${r}`} />)}
        </fieldset>
        <Field label={t('merchAdmin.reason.note')} hint={fmt(t('merchAdmin.noteLength'), { min: NOTE_MIN, max: NOTE_MAX })} required={noteNeeded}
          error={n > 0 && !noteOk ? fmt(t('merchAdmin.noteLength'), { min: NOTE_MIN, max: NOTE_MAX }) : undefined}>
          <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={NOTE_MAX} data-testid="merch-reject-note" />
        </Field>
        <div className={footer}>
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="destructive" disabled={!ok} loading={busy} data-testid="merch-reject-confirm">{t('merchAdmin.reject')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function EndSaleDialog({ sale, onClose, onDone }: { sale: FlashSale; onClose: () => void; onDone: (s: FlashSale) => void }) {
  const { token, t } = useApp();
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSaleAction(onDone);
  const ok = reason.trim().length >= NOTE_MIN;
  return (
    <Dialog open onClose={onClose} title={t('merch.endSale.title')} description={t('merchAdmin.end.saleHint')} size="md">
      <form onSubmit={e => { e.preventDefault(); if (ok && token) void run(() => salesApi.adminEnd(token, sale.id, reason.trim())); }} className="space-y-3" data-testid="merch-end-dialog">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('merchAdmin.reason')} hint={`${t('merchAdmin.reason.noteHint')} ${fmt(t('merchAdmin.noteLength'), { min: NOTE_MIN, max: NOTE_MAX })}`} required>
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={NOTE_MAX} data-testid="merch-end-reason" />
        </Field>
        <div className={footer}>
          <Button type="button" variant="secondary" onClick={onClose}>{t('merch.sale.keep')}</Button>
          <Button type="submit" variant="destructive" disabled={!ok} loading={busy} data-testid="merch-end-confirm">{t('merchAdmin.end')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

