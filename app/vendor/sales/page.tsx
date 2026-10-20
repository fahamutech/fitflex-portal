'use client';
import { type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight, Copy, Receipt, RefreshCw } from 'lucide-react';
import { api, type VendorSale, type VendorSaleRow, type VendorSalesQuery, type VendorSaleSummary } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import {
  addDays, canCustomers, customerName, eatDateTime, eatToday, errorBody, errorCode, fmt, isRefusal, itemsKey, mayVoidSale, receiptDay,
  recordedOffline, saleMethodLabel, saleMethodsLabel, saleReceiptText,
} from '@/lib/vendor';
import { CreditBadges } from '@/components/vendor/customers/bits';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, PageHeader, Segmented, Select,
  SkeletonCard, SkeletonTable, Spinner, Table, TBody, Td, Textarea, Th, THead, Tr, useToast,
} from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../providers';

type Range = 'today' | '7d' | '30d' | 'custom';
const RANGES: Range[] = ['today', '7d', '30d', 'custom'];
type StatusFilter = 'all' | 'completed' | 'voided';
const STATUSES: StatusFilter[] = ['all', 'completed', 'voided'];
type KindFilter = 'all' | 'credit';
const REASON_MIN = 3;
const REASON_MAX = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A row's tap target: at least 44px tall. */
const refLink = 'inline-flex min-h-11 items-center whitespace-nowrap font-mono font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline';

function SaleBadges({ sale }: { sale: Pick<VendorSaleRow, 'status' | 'soldAt' | 'recordedAt' | 'lateRecorded' | 'hasOverride' | 'kind' | 'balanceTzs'> }) {
  const { t } = useApp();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sale.status === 'voided'
        ? <Badge tone="gray">{t('vendor.sales.voidedBadge')}</Badge>
        : <Badge tone="success">{t('vendor.sales.filter.completed')}</Badge>}
      {recordedOffline(sale) && <Badge tone="gray">{t('vendor.sales.offlineBadge')}</Badge>}
      {sale.hasOverride === true && <Badge tone="warning">{t('vendor.sales.priceChangedBadge')}</Badge>}
      {/* S4: "Pay later" and what is still owed (or "Paid off"). */}
      <CreditBadges sale={sale} />
    </span>
  );
}
/**
 * A summary tile that never cuts anything off (UAT D3): the label wraps, money may wrap between "TSh" and the
 * figure but is never truncated. Tiles size to the space they have (list column next to the open sale), not to
 * the viewport.
 */
function SummaryTile({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <Card className="min-w-0 p-4">
      <p className="text-sm font-medium text-[var(--color-fg-quaternary)] [overflow-wrap:anywhere]">{label}</p>
      {/* Money stays on one line ("TSh 1,234"); the grid gives each tile room for it. */}
      <p className="mt-1 whitespace-nowrap text-lg font-semibold tracking-tight tabular-nums text-[var(--color-fg-primary)]" data-testid={testId}>{value}</p>
    </Card>
  );
}
const TILE_GRID = 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))]';

/** The total, struck through when voided (the badge says "Voided" in words too). */
function Total({ sale }: { sale: Pick<VendorSaleRow, 'status' | 'totalTzs'> }) {
  return <span className={`whitespace-nowrap tabular-nums ${sale.status === 'voided' ? 'line-through text-[var(--color-fg-quaternary)]' : ''}`}>{money(sale.totalTzs)}</span>;
}

function SalesInner() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get('id');
  const today = eatToday();
  const rangeParam = params.get('range') as Range | null;
  const range: Range = rangeParam && RANGES.includes(rangeParam) ? rangeParam : 'today';
  const statusParam = params.get('status') as StatusFilter | null;
  const status: StatusFilter = statusParam && STATUSES.includes(statusParam) ? statusParam : 'all';
  const mine = params.get('mine') === '1';
  // S4: the pay-later filter needs customers switched on; one customer's sales need the `customers` permission too.
  const customersOn = vendor.me?.tools.customers === true;
  const kind: KindFilter = customersOn && params.get('kind') === 'credit' ? 'credit' : 'all';
  const customerId = canCustomers(vendor.me) ? params.get('customerId') : null;
  const fromParam = params.get('from') ?? '';
  const toParam = params.get('to') ?? '';
  const span = range === 'today' ? { from: today, to: today }
    : range === '7d' ? { from: addDays(today, -6), to: today }
    : range === '30d' ? { from: addDays(today, -29), to: today }
    : { from: DAY.test(fromParam) ? fromParam : today, to: DAY.test(toParam) ? toParam : today };

  const [sales, setSales] = useState<VendorSaleRow[] | null>(null);
  const [summary, setSummary] = useState<VendorSaleSummary | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [neverSold, setNeverSold] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const requestId = useRef(0);
  const lastOpened = useRef<string | null>(null);
  const focusRowOnClose = useRef<string | null>(null);

  const setParams = (patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    const url = s ? `${pathname}?${s}` : pathname;
    if (push) router.push(url, { scroll: false }); else router.replace(url, { scroll: false });
  };

  const query = useCallback((): VendorSalesQuery => ({
    from: span.from, to: span.to,
    ...(status !== 'all' ? { status } : {}),
    ...(mine ? { createdBy: 'me' as const } : {}),
    ...(kind === 'credit' ? { kind: 'credit' as const } : {}),
    ...(customerId ? { customerId } : {}),
  }), [span.from, span.to, status, mine, kind, customerId]);

  const load = useCallback(async () => {
    if (!token) return;
    const id = ++requestId.current;
    setFailed(false); setMoreFailed(false); setSales(null);
    try {
      const page = await api.vendorSales(token, { ...query(), limit: 50 });
      if (id !== requestId.current) return;
      setSales(page.sales ?? []); setNextCursor(page.nextCursor ?? null); setSummary(page.summary ?? null);
      // Nothing here: never sold at all, or only nothing in these dates? One row of the whole history tells.
      if (!page.sales?.length) {
        setNeverSold(false);
        api.vendorSales(token, { limit: 1 })
          .then(all => { if (id === requestId.current) setNeverSold((all.sales ?? []).length === 0); })
          .catch(() => {});
      }
    } catch (err) {
      if (id !== requestId.current) return;
      if (!vendor.handleError(err)) setFailed(true);
      setSales([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, query]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!token || !nextCursor) return;
    const id = requestId.current;
    setMoreBusy(true); setMoreFailed(false);
    try {
      const page = await api.vendorSales(token, { ...query(), limit: 50, cursor: nextCursor });
      if (id !== requestId.current) return;
      setSales(current => {
        const seen = new Set((current ?? []).map(s => s.id));
        return [...(current ?? []), ...(page.sales ?? []).filter(s => !seen.has(s.id))];
      });
      setNextCursor(page.nextCursor ?? null);
    } catch (err) {
      if (!vendor.handleError(err)) setMoreFailed(true);
    } finally {
      setMoreBusy(false);
    }
  }

  /** A void changes the row and the summary (voided sales leave the totals). */
  const updated = (sale: VendorSale) => {
    setSales(current => (current ?? []).map(s => (s.id === sale.id ? { ...s, status: sale.status, ...(typeof sale.balanceTzs === 'number' ? { balanceTzs: sale.balanceTzs } : {}) } : s)));
    if (!token) return;
    const id = requestId.current;
    api.vendorSales(token, { ...query(), limit: 1 }).then(p => { if (id === requestId.current) setSummary(p.summary ?? null); }).catch(() => {});
  };
  const open = (id: string) => { lastOpened.current = id; setParams({ id }, true); };
  const close = () => {
    focusRowOnClose.current = lastOpened.current ?? openId;
    setParams({ id: null }, true);
  };
  // Back to the row it came from (table on wide screens, card on phones), once the list shows again.
  useEffect(() => {
    const id = focusRowOnClose.current;
    if (openId || !id || sales == null) return;
    let tries = 0;
    const tryFocus = () => {
      const links = [document.getElementById(`sale-link-${id}`), document.getElementById(`sale-mlink-${id}`)];
      const el = links.find(x => x && x.offsetParent !== null);
      if (el) { el.focus(); focusRowOnClose.current = null; return; }
      if (++tries < 20) { requestAnimationFrame(tryFocus); return; }
      const heading = document.querySelector<HTMLElement>('[data-testid="sales-list"] h1');
      if (heading) { heading.tabIndex = -1; heading.focus(); }
      focusRowOnClose.current = null;
    };
    requestAnimationFrame(tryFocus);
  }, [openId, sales]);

  const shown = sales ?? [];
  const list = (
    // A container: table or cards follow the list column's own width (narrow next to an open sale).
    <div className="@container space-y-4" data-testid="sales-list">
      <div>
        <PageHeader
          title={t('vendor.nav.sales')}
          description={t('vendor.sales.portalDescription')}
          actions={<Button variant="secondary" size="sm" className="min-h-11" onClick={load} data-testid="sales-refresh"><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('admin.action.refresh')}</Button>}
        />
        <p className="-mt-4 mb-2 text-sm text-[var(--color-fg-tertiary)]" data-testid="sales-record-in-app">{t('vendor.sales.recordInApp')}</p>
      </div>
      <div data-testid="sales-money-notice"><Alert tone="info">{t('vendor.pos.moneyNotice')}</Alert></div>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <Segmented
          className="w-fit flex-wrap"
          value={range}
          onChange={v => setParams(v === 'custom' ? { range: v, from: span.from, to: span.to } : { range: v === 'today' ? null : v, from: null, to: null })}
          options={[['today', t('vendor.sales.today')], ['7d', t('vendor.stock.range.7d')], ['30d', t('vendor.stock.range.30d')], ['custom', t('vendor.stock.range.custom')]]}
        />
        {range === 'custom' && (
          <div className="flex flex-wrap gap-3">
            <Field label={t('vendor.stock.from')}>
              <Input type="date" value={span.from} max={span.to || today} onChange={e => DAY.test(e.target.value) && setParams({ from: e.target.value })} data-testid="sales-from" />
            </Field>
            <Field label={t('vendor.stock.to')}>
              <Input type="date" value={span.to} min={span.from} max={today} onChange={e => DAY.test(e.target.value) && setParams({ to: e.target.value })} data-testid="sales-to" />
            </Field>
          </div>
        )}
        <Field label={t('vendor.sales.colStatus')}>
          <Select value={status} onChange={e => setParams({ status: e.target.value === 'all' ? null : e.target.value })} data-testid="sales-status">
            {STATUSES.map(s => <option key={s} value={s}>{t(`vendor.sales.filter.${s}` as MessageKey)}</option>)}
          </Select>
        </Field>
        {customersOn && (
          <Field label={t('vendor.sales.colKind')}>
            <Select value={kind} onChange={e => setParams({ kind: e.target.value === 'credit' ? 'credit' : null })} data-testid="sales-kind">
              <option value="all">{t('vendor.sales.filter.all')}</option>
              <option value="credit">{t('vendor.sales.filter.credit')}</option>
            </Select>
          </Field>
        )}
        <Checkbox label={t('vendor.sales.filter.mine')} checked={mine} onChange={e => setParams({ mine: e.target.checked ? '1' : null })} data-testid="sales-mine" />
      </div>
      {customerId && (
        <div className="flex flex-wrap items-center gap-2" data-testid="sales-customer-filter">
          <Badge tone="brand">{fmt(t('vendor.sales.customerFilter'), { name: shown.find(s => s.customer)?.customer ? customerName(shown.find(s => s.customer)!.customer, t) : t('vendor.sales.oneCustomer') })}</Badge>
          <Button variant="link" size="sm" className="min-h-11" onClick={() => setParams({ customerId: null })} data-testid="sales-customer-clear">{t('vendor.sales.clearCustomer')}</Button>
        </div>
      )}

      {summary && sales != null && !failed && (
        <section aria-label={t('vendor.sales.title')} className="space-y-3" data-testid="sales-summary">
          <div className={TILE_GRID}>
            <SummaryTile label={t('vendor.sales.count')} value={summary.count} testId="sales-summary-count" />
            <SummaryTile label={t('vendor.sales.total')} value={money(summary.totalTzs)} testId="sales-summary-total" />
            {typeof summary.discountTzs === 'number' && <SummaryTile label={t('vendor.pos.discounts')} value={money(summary.discountTzs)} testId="sales-summary-discounts" />}
            {typeof summary.overrideCount === 'number' && <SummaryTile label={t('vendor.sales.overrideCount')} value={summary.overrideCount} testId="sales-summary-overrides" />}
            {typeof summary.lateCount === 'number' && <SummaryTile label={t('vendor.sales.lateCount')} value={summary.lateCount} testId="sales-summary-late" />}
            {/* S4 (customers holders only): pay-later money; byMethod + payLater = total. */}
            {typeof summary.payLaterTzs === 'number' && summary.payLaterTzs > 0 && <SummaryTile label={t('vendor.sales.payLaterTotal')} value={money(summary.payLaterTzs)} testId="sales-summary-paylater" />}
            {typeof summary.owedTzs === 'number' && summary.owedTzs > 0 && <SummaryTile label={t('vendor.pay.stillOwed')} value={money(summary.owedTzs)} testId="sales-summary-owed" />}
          </div>
          {summary.byMethod?.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-[var(--color-fg-secondary)]">{t('vendor.sales.byMethod')}</h2>
              <div className={TILE_GRID} data-testid="sales-by-method">
                {summary.byMethod.map(m => <SummaryTile key={m.method} label={saleMethodLabel(m.method, t)} value={money(m.amountTzs)} testId={`sales-by-method-${m.method}`} />)}
              </div>
            </div>
          )}
        </section>
      )}

      {sales == null ? (
        <div aria-busy="true" aria-label={t('vendor.sales.loading')}><SkeletonTable rows={6} columns={7} /></div>
      ) : failed ? (
        <ErrorState title={t('vendor.sales.failed')} onRetry={load} retryLabel={t('common.tryAgain')} />
      ) : shown.length === 0 ? (
        neverSold
          ? <EmptyState icon={<Receipt />} title={t('vendor.sales.emptyFirst')} body={t('vendor.sales.recordInApp')} />
          : <EmptyState icon={<Receipt />} title={t('vendor.sales.empty')} />
      ) : (
        <>
          <div className="hidden @4xl:block">
            <Table aria-label={t('vendor.nav.sales')} data-testid="vendor-sales-table">
              <THead>
                <Tr>
                  <Th>{t('vendor.sales.colReceipt')}</Th>
                  <Th>{t('vendor.sales.colTime')}</Th>
                  <Th>{t('vendor.sales.colItems')}</Th>
                  <Th>{t('vendor.sales.colPayment')}</Th>
                  <Th>{t('vendor.sales.colServedBy')}</Th>
                  <Th className="!text-right">{t('vendor.sales.colTotal')}</Th>
                  <Th>{t('vendor.sales.colStatus')}</Th>
                  <Th><span className="sr-only">{t('common.actions')}</span></Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map(s => (
                  <Tr key={s.id} className={`cursor-pointer hover:bg-[var(--color-bg-secondary)] ${s.id === openId ? 'bg-[var(--color-bg-secondary)]' : ''}`} onClick={() => open(s.id)} data-testid={`sale-row-${s.id}`}>
                    <Td>
                      <Link id={`sale-link-${s.id}`} href={`${pathname}?id=${encodeURIComponent(s.id)}`} onClick={e => { e.preventDefault(); e.stopPropagation(); open(s.id); }} className={refLink}>
                        {s.number}
                      </Link>
                      {s.customer && <span className="block text-xs text-[var(--color-fg-tertiary)] [overflow-wrap:anywhere]">{customerName(s.customer, t)}</span>}
                    </Td>
                    <Td className="whitespace-nowrap">{eatDateTime(s.soldAt, locale)}</Td>
                    <Td>{fmt(t(itemsKey(s.itemCount)), { n: s.itemCount })}</Td>
                    <Td>{saleMethodsLabel(s.methods, t) || '—'}</Td>
                    <Td>{s.createdBy?.name || '—'}</Td>
                    <Td className="whitespace-nowrap text-right"><Total sale={s} /></Td>
                    <Td><SaleBadges sale={s} /></Td>
                    <Td><ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--color-fg-quaternary)]" /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="space-y-3 @4xl:hidden" aria-label={t('vendor.nav.sales')}>
            {shown.map(s => (
              <li key={s.id}>
                <Card className="p-0">
                  <Link id={`sale-mlink-${s.id}`} href={`${pathname}?id=${encodeURIComponent(s.id)}`} onClick={e => { e.preventDefault(); open(s.id); }} className="block min-h-11 space-y-1 p-4" data-testid={`sale-card-${s.id}`}>
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="whitespace-nowrap font-mono font-semibold">{s.number}</span>
                      <SaleBadges sale={s} />
                    </span>
                    <span className="block font-semibold"><Total sale={s} /></span>
                    {s.customer && <span className="block text-sm [overflow-wrap:anywhere]">{customerName(s.customer, t)}</span>}
                    <span className="block text-sm text-[var(--color-fg-tertiary)]">{eatDateTime(s.soldAt, locale)}</span>
                    <span className="block text-sm text-[var(--color-fg-tertiary)]">{saleMethodsLabel(s.methods, t)}</span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {moreFailed && <Alert tone="error">{t('vendor.sales.failed')}</Alert>}
      {sales != null && !failed && nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={moreBusy} className="min-h-11" data-testid="sales-load-more">
            {moreBusy && <Spinner className="h-4 w-4" />}{moreFailed ? t('common.tryAgain') : t('vendor.stock.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );

  if (!openId) return list;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_480px]">
      <div className="hidden lg:block">{list}</div>
      <SaleDetail id={openId} onBack={close} onUpdated={updated} />
    </div>
  );
}

function SaleDetail({ id, onBack, onUpdated }: { id: string; onBack: () => void; onUpdated: (s: VendorSale) => void }) {
  const { token, t, locale, user } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [sale, setSale] = useState<VendorSale | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  /** Why the sale is shown again after a refused void (it was reloaded); stays until another sale opens. */
  const [notice, setNotice] = useState<MessageKey | null>(null);
  /** S4 (Q-2): customer payments still allocated to this pay-later sale; void them first. */
  const [blockers, setBlockers] = useState<Array<{ id: string; number: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (focus = true) => {
    if (!token) return;
    setState(s => (s === 'ready' ? s : 'loading'));
    try {
      const res = await api.vendorSale(token, id);
      setSale(res.sale); setState('ready');
      if (focus) setTimeout(() => headingRef.current?.focus(), 0);
    } catch (err) {
      if (errorCode(err) === 'sale_not_found') { setState('notFound'); return; }
      if (vendor.handleError(err)) return;
      setState((err as { status?: number }).status === 404 ? 'notFound' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);
  useEffect(() => { setNotice(null); void load(); }, [load]);

  const business = vendor.me?.businessName || t('vendor.shell.unnamed');

  async function copyText() {
    if (!sale) return;
    const text = saleReceiptText(sale, { business, locale, t, totalLabel: money(sale.totalTzs) });
    try { await navigator.clipboard.writeText(text); toast.success(t('vendor.sales.copied')); } catch { toast.error(t('vendor.saveFailed')); }
  }

  const openVoid = () => { setReason(''); setReasonError(null); setVoidError(null); setBlockers(null); setVoidOpen(true); };
  async function confirmVoid() {
    if (!token || !sale) return;
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) { setReasonError(t('vendor.sales.voidReasonMissing')); return; }
    setBusy(true); setVoidError(null);
    try {
      const res = await api.vendorVoidSale(token, sale.id, trimmed);
      setSale(res.sale); onUpdated(res.sale);
      setVoidOpen(false);
      toast.success(fmt(t('vendor.sales.voided'), { number: res.sale.number }));
    } catch (err) {
      // Voids are never queued: no answer means nothing changed; the dialog stays for Try again.
      if (!isRefusal(err)) { setVoidError(t('vendor.sales.voidOffline')); return; }
      const code = errorCode(err);
      if (code === 'reason_required' || code === 'reason_too_long') { setReasonError(t('vendor.sales.voidReasonMissing')); return; }
      if (code === 'sale_has_payments') {
        // The dialog stays and lists the payments to void first (with links when this person may open them).
        setBlockers(errorBody<{ payments?: Array<{ id: string; number: string }> }>(err)?.payments ?? []);
        return;
      }
      setVoidOpen(false);
      if (code === 'already_voided') {
        // Say so in the panel too (UAT): the reload alone looks like nothing happened.
        setNotice('vendor.sales.alreadyVoided');
        toast.info(t('vendor.sales.alreadyVoided'));
        try { const fresh = await api.vendorSale(token, sale.id); setSale(fresh.sale); onUpdated(fresh.sale); } catch { /* the toast still stands */ }
      } else if (code === 'has_refunds') {
        // Not sent by #214; kept for S7 refunds (spec §5.3), harmless until then.
        toast.error(t('vendor.sales.voidHasRefunds'));
      } else if (code === 'void_not_allowed') {
        const why = errorBody<{ reason?: string }>(err)?.reason;
        toast.error(t(why === 'too_old' ? 'vendor.sales.voidTooOld' : why === 'not_own' ? 'vendor.sales.voidNotOwn' : 'vendor.sales.err.voidNotAllowed'));
      } else if (code === 'vendor_permission_forbidden') {
        toast.error(t('vendor.sales.err.voidNotAllowed'));
        void vendor.refresh();
      } else if (code === 'sale_not_found') {
        setState('notFound');
      } else if (!vendor.handleError(err)) {
        toast.error(t('vendor.saveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  const backButton = (
    <Button variant="link" onClick={onBack} className="min-h-11 h-auto px-0 text-sm font-semibold" data-testid="sale-back">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.sales.back')}
    </Button>
  );
  if (state === 'loading') return <div className="space-y-4" aria-busy="true">{backButton}<SkeletonCard /><SkeletonCard /></div>;
  if (state === 'notFound') return <div className="space-y-4">{backButton}<ErrorState title={t('vendor.sales.notFound')} /></div>;
  if (state === 'error' || !sale) return <div className="space-y-4">{backButton}<ErrorState title={t('vendor.sales.failed')} onRetry={() => load()} retryLabel={t('common.tryAgain')} /></div>;

  const s = sale;
  const discounts = Number(s.lineDiscountTzs || 0) + Number(s.discountTzs || 0);
  const canVoid = mayVoidSale(s, { userId: user?.id, userType: user?.userType, vendorRole: vendor.me?.vendorRole });
  const credit = s.kind === 'credit';
  const seesCustomers = canCustomers(vendor.me);
  const customerHref = (extra = '') => (s.customer ? `/vendor/customers/?id=${encodeURIComponent(s.customer.id)}${extra}` : null);
  const row = 'flex justify-between gap-2';

  return (
    <div className="space-y-4" data-testid="sale-detail">
      {backButton}
      <Card>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 ref={headingRef} tabIndex={-1} className="whitespace-nowrap font-mono text-lg font-semibold outline-none" data-testid="sale-heading">{fmt(t('vendor.pos.receiptNo'), { number: s.number })}</h2>
            <SaleBadges sale={{ ...s, hasOverride: s.lines.some(l => l.priceChanged) }} />
          </div>
          <p className="font-medium">{business}</p>
          <p className="text-sm text-[var(--color-fg-tertiary)]">{eatDateTime(s.soldAt, locale)}</p>
          {recordedOffline(s) && <p className="text-sm text-[var(--color-fg-tertiary)]">{fmt(t('vendor.sales.recordedAt'), { time: eatDateTime(s.recordedAt, locale) })}</p>}
          {s.createdBy?.name && <p className="text-sm text-[var(--color-fg-tertiary)]">{fmt(t('vendor.pos.servedBy'), { name: s.createdBy.name })}</p>}
          {s.customer && (
            <p className="text-sm" data-testid="sale-customer">
              {seesCustomers && customerHref()
                ? <Link href={customerHref()!} className="inline-flex min-h-11 items-center font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline">{fmt(t('vendor.receipt.customer'), { name: customerName(s.customer, t) })}</Link>
                : fmt(t('vendor.receipt.customer'), { name: customerName(s.customer, t) })}
            </p>
          )}
        </CardContent>
      </Card>

      {notice && <div data-testid="sale-notice"><Alert tone="warning">{t(notice)}</Alert></div>}

      {s.status === 'voided' && (
        <div data-testid="sale-voided">
          <Alert tone="info">{fmt(t('vendor.sales.voidedBy'), { name: s.voidedBy?.name || '—', time: eatDateTime(s.voidedAt, locale), reason: s.voidReason || '—' })}</Alert>
        </div>
      )}

      <Card>
        <CardHeader><h3 className="font-semibold">{t('vendor.sales.colItems')}</h3></CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-[var(--color-border-secondary)]">
            {s.lines.map((l, i) => {
              const changed = l.unitPriceTzs !== l.listPriceTzs;
              return (
                <li key={`${l.nameSnapshot}-${l.variant ?? ''}-${i}`} className="space-y-0.5 px-6 py-3 text-sm" data-testid={`sale-line-${i}`}>
                  <div className={row}>
                    <span className="font-medium [overflow-wrap:anywhere]">{l.qty} × {l.nameSnapshot}{l.variant ? ` (${l.variant})` : ''}</span>
                    <span className="whitespace-nowrap tabular-nums">{money(l.qty * l.unitPriceTzs)}</span>
                  </div>
                  {(l.qty > 1 || changed) && <p className="whitespace-nowrap text-[var(--color-fg-tertiary)] tabular-nums">@ {money(l.unitPriceTzs)}</p>}
                  {changed && (
                    <p className="text-[var(--color-fg-tertiary)]" data-testid={`sale-line-${i}-changed`}>
                      {l.priceChangedBy?.name
                        ? fmt(t('vendor.pos.priceChangedBy'), { name: l.priceChangedBy.name, amount: money(l.listPriceTzs) })
                        : fmt(t('vendor.pos.priceChanged'), { amount: money(l.listPriceTzs) })}
                    </p>
                  )}
                  {l.discountTzs > 0 && (
                    <div className={`${row} text-[var(--color-fg-tertiary)]`}><span>{t('vendor.pos.lineDiscountShort')}</span><span className="whitespace-nowrap tabular-nums">−{money(l.discountTzs)}</span></div>
                  )}
                </li>
              );
            })}
          </ul>
          <dl className="space-y-1 border-t border-[var(--color-border-secondary)] px-6 py-3 text-sm">
            <div className={row}><dt>{t('vendor.pos.subtotal')}</dt><dd className="whitespace-nowrap tabular-nums">{money(s.subtotalTzs)}</dd></div>
            {discounts > 0 && <div className={row}><dt>{t('vendor.pos.discounts')}</dt><dd className="whitespace-nowrap tabular-nums" data-testid="sale-discounts">−{money(discounts)}</dd></div>}
            <div className={row}><dt className="font-semibold">{t('vendor.pos.total')}</dt><dd className="font-semibold" data-testid="sale-total"><Total sale={s} /></dd></div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="font-semibold">{t('vendor.sales.colPayment')}</h3></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {s.payments.map((p, i) => (
            <div key={i} className={row} data-testid={`sale-payment-${i}`}>
              <span className="[overflow-wrap:anywhere]">{saleMethodLabel(p.method, t)}{p.reference ? ` (${p.reference})` : ''}</span>
              <span className="whitespace-nowrap tabular-nums">{money(p.amountTzs)}</span>
            </div>
          ))}
          {!credit && s.changeTzs > 0 && <div className={row}><span>{t('vendor.pos.change')}</span><span className="whitespace-nowrap tabular-nums" data-testid="sale-change">{money(s.changeTzs)}</span></div>}
          {credit && (
            <div className="space-y-1 border-t border-[var(--color-border-secondary)] pt-2" data-testid="sale-credit">
              <div className={row}><span>{t('vendor.pos.credit.paidNow')}</span><span className="whitespace-nowrap tabular-nums">{money(s.paidAtSaleTzs ?? s.payments.reduce((n, p) => n + p.amountTzs, 0))}</span></div>
              {s.dueDate && <div className={row}><span>{t('vendor.receipt.dueBy')}</span><span className="whitespace-nowrap">{receiptDay(s.dueDate, locale)}</span></div>}
              {s.status === 'completed' && (Number(s.balanceTzs) > 0
                ? <div className={`${row} font-semibold`}><span>{t('vendor.pay.stillOwed')}</span><span className="whitespace-nowrap tabular-nums" data-testid="sale-balance">{money(s.balanceTzs)}</span></div>
                : <p><Badge tone="success">{t('vendor.sales.paidOffBadge')}</Badge></p>)}
              {(s.allocations ?? []).length > 0 && (
                <div className="space-y-1 pt-1" data-testid="sale-allocations">
                  <p className="font-medium">{t('vendor.sales.customerPayments')}</p>
                  {s.allocations!.map(a => (
                    <div key={a.paymentId} className={row}>
                      <span className="flex flex-wrap items-center gap-2">
                        {customerHref()
                          ? <Link href={customerHref(`&tab=payments&payment=${encodeURIComponent(a.paymentId)}`)!} className="inline-flex min-h-11 items-center font-mono font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline">{a.number}</Link>
                          : <span className="font-mono">{a.number}</span>}
                        <span className="text-[var(--color-fg-tertiary)]">{receiptDay(a.receivedOn, locale)}</span>
                        {a.voided && <Badge tone="gray">{t('vendor.sales.voidedBadge')}</Badge>}
                      </span>
                      <span className={`whitespace-nowrap tabular-nums ${a.voided ? 'line-through text-[var(--color-fg-quaternary)]' : ''}`}>{money(a.amountTzs)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="pt-2 text-[var(--color-fg-tertiary)]">{fmt(t(credit ? 'vendor.receipt.footerCredit' : 'vendor.pos.receiptFooter'), { business })}</p>
          <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="sale-not-fiscal">{t('vendor.pos.notFiscal')}</p>
        </CardContent>
      </Card>

      <Alert tone="info">{t('vendor.pos.moneyNotice')}</Alert>

      {s.note && (
        <Card>
          <CardHeader><h3 className="font-semibold">{t('vendor.sales.note')}</h3></CardHeader>
          <CardContent><p className="whitespace-pre-line text-sm [overflow-wrap:anywhere]">{s.note}</p></CardContent>
        </Card>
      )}

      {s.status === 'completed' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-11" onClick={copyText} data-testid="sale-copy">
            <Copy aria-hidden="true" className="h-4 w-4" />{t('vendor.sales.copyText')}
          </Button>
          {canVoid && (
            <Button variant="destructive" className="min-h-11" onClick={openVoid} data-testid="sale-void">{t('vendor.sales.void')}</Button>
          )}
        </div>
      )}

      <Dialog
        open={voidOpen}
        onClose={() => { if (!busy) setVoidOpen(false); }}
        title={fmt(t('vendor.sales.voidTitle'), { number: s.number })}
        description={t('vendor.sales.voidBody')}
      >
        <div className="space-y-3">
          {credit && <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="sale-void-credit">{t('vendor.sales.voidCreditBody')}</p>}
          {blockers && (
            <div data-testid="sale-void-blocked">
              <Alert tone="warning">
                <span>{fmt(t('vendor.sales.voidHasPayments'), { numbers: '' }).replace(/[:\s]+$/, '')}:</span>
                <span className="mt-1 flex flex-wrap gap-x-3">
                  {blockers.map(b => (seesCustomers && customerHref()
                    ? <Link key={b.id} href={customerHref(`&tab=payments&payment=${encodeURIComponent(b.id)}`)!} className="inline-flex min-h-11 items-center font-mono font-semibold underline underline-offset-4">{b.number}</Link>
                    : <span key={b.id} className="font-mono font-semibold">{b.number}</span>))}
                </span>
              </Alert>
            </div>
          )}
          {voidError && <Alert tone="error">{voidError}</Alert>}
          <Field label={t('vendor.sales.voidReason')} required error={reasonError ?? undefined} hint={`${reason.length}/${REASON_MAX}`}>
            <Textarea value={reason} maxLength={REASON_MAX} rows={3} onChange={e => { setReason(e.target.value); setReasonError(null); }} disabled={busy} data-testid="sale-void-reason" />
          </Field>
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="secondary" onClick={() => setVoidOpen(false)} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={confirmVoid} loading={busy} disabled={!reason.trim() || !!blockers} className="min-h-11" data-testid="sale-void-confirm">
            {voidError ? t('common.tryAgain') : t('vendor.sales.void')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

/** Vendor (or staff with `sales`), walk-in sales on: counter sales recorded in the app; ?id=<saleId> opens one. No POS here. */
export default function VendorSalesPage() {
  return <Suspense fallback={null}><SalesInner /></Suspense>;
}
