'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight, ClipboardList, Copy, Phone, RefreshCw } from 'lucide-react';
import { api, type VendorOrder } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import {
  canonicalStatus, eatDateTime, errorCode, fmt, isOpenOrder, isPaid, isRefusal, isTerminal,
  markStatusKey, methodKey, paymentKey, statusKey, statusTone,
} from '@/lib/vendor';
import { Alert, Badge, Button, Card, CardContent, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, Segmented, SkeletonCard, SkeletonTable, Spinner, Table, TBody, Td, Textarea, Th, THead, Tr, useToast } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../providers';

type Tab = 'open' | 'delivered' | 'cancelled' | 'all';
const TABS: Tab[] = ['open', 'delivered', 'cancelled', 'all'];
const inTab = (o: VendorOrder, tab: Tab) => tab === 'all' ? true
  : tab === 'open' ? isOpenOrder(o)
  : isPaid(o) && canonicalStatus(o.status) === tab;
const REASON_MAX = 200;

function deliveryLine(o: VendorOrder, t: (k: MessageKey) => string) {
  if (o.deliveryMethod === 'gym_pickup') {
    return o.pickupGym?.name ? fmt(t('vendor.orders.delivery.pickup'), { gym: o.pickupGym.name }) : t('vendor.orders.pickupGymUnknown');
  }
  return t('vendor.orders.delivery.home');
}
function StatusBadge({ status }: { status: string }) {
  const { t } = useApp();
  return <Badge tone={statusTone(status)}>{t(statusKey(status))}</Badge>;
}
const itemCount = (o: VendorOrder) => o.items.reduce((n, i) => n + Number(i.qty || 0), 0);

function OrdersInner() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get('id');
  const tabParam = params.get('status') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'open';
  const q = params.get('q') ?? '';

  const [orders, setOrders] = useState<VendorOrder[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const lastOpened = useRef<string | null>(null);

  const setParams = (patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    const url = s ? `${pathname}?${s}` : pathname;
    if (push) router.push(url, { scroll: false }); else router.replace(url, { scroll: false });
  };

  const load = useCallback(async () => {
    if (!token) return;
    setFailed(false); setMoreFailed(false);
    try {
      const page = await api.vendorOrders(token, { limit: 50 });
      setOrders(page.orders); setNextCursor(page.nextCursor ?? null);
    } catch (err) {
      if (!vendor.handleError(err)) setFailed(true);
      setOrders(o => o ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!token || !nextCursor) return;
    setMoreBusy(true); setMoreFailed(false);
    try {
      const page = await api.vendorOrders(token, { limit: 50, cursor: nextCursor });
      setOrders(current => {
        const seen = new Set((current ?? []).map(o => o.id));
        return [...(current ?? []), ...page.orders.filter(o => !seen.has(o.id))];
      });
      setNextCursor(page.nextCursor ?? null);
    } catch (err) {
      if (!vendor.handleError(err)) setMoreFailed(true);
    } finally {
      setMoreBusy(false);
    }
  }

  const updated = (order: VendorOrder) => {
    setOrders(current => (current ?? []).map(o => (o.id === order.id ? order : o)));
    vendor.refreshCounts();
  };
  const open = (id: string) => { lastOpened.current = id; setParams({ id }, true); };
  const close = () => {
    setParams({ id: null }, true);
    const id = lastOpened.current ?? openId;
    // Back to the row it came from (the table on wide screens, the card on phones).
    setTimeout(() => {
      const links = [document.getElementById(`order-link-${id}`), document.getElementById(`order-mlink-${id}`)];
      links.find(el => el && el.offsetParent !== null)?.focus();
    }, 50);
  };

  const all = orders ?? [];
  const searched = all.filter(o => !q.trim() || o.shortRef.toLowerCase().includes(q.trim().toLowerCase().replace(/^#/, '')));
  const count = (tb: Tab) => searched.filter(o => inTab(o, tb)).length;
  const shown = searched.filter(o => inTab(o, tab));
  const emptyKey: Record<Tab, MessageKey> = { open: 'vendor.orders.emptyOpen', delivered: 'vendor.orders.emptyDelivered', cancelled: 'vendor.orders.emptyCancelled', all: 'vendor.orders.emptyAll' };

  const list = (
    <div className="space-y-4">
      <PageHeader
        title={t('vendor.nav.orders')}
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('admin.action.refresh')}</Button>}
      />
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Segmented
          className="w-fit flex-wrap"
          value={tab}
          onChange={v => setParams({ status: v === 'open' ? null : v })}
          options={TABS.map(tb => [tb, fmt(t(`vendor.orders.tab.${tb}` as MessageKey), { n: count(tb) })] as [string, string])}
        />
        <Input type="search" aria-label={t('vendor.orders.search')} placeholder={t('vendor.orders.search')} value={q}
          onChange={e => setParams({ q: e.target.value || null })} className="md:max-w-xs" data-testid="orders-search" />
      </div>

      {orders == null ? (
        <div aria-busy="true"><SkeletonTable rows={6} columns={6} /></div>
      ) : failed ? (
        <ErrorState title={t('vendor.orders.failed')} onRetry={load} retryLabel={t('common.tryAgain')} />
      ) : shown.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title={t(emptyKey[tab])} />
      ) : (
        <>
          <div className="hidden md:block">
            <Table aria-label={t('vendor.nav.orders')} data-testid="vendor-orders-table">
              <THead>
                <Tr>
                  <Th>{t('vendor.orders.colRef')}</Th>
                  <Th>{t('vendor.orders.colPlaced')}</Th>
                  <Th>{t('vendor.orders.colBuyer')}</Th>
                  <Th>{t('vendor.orders.colItems')}</Th>
                  <Th className="!text-right">{t('vendor.orders.colTotal')}</Th>
                  <Th>{t('vendor.orders.colDelivery')}</Th>
                  <Th>{t('vendor.products.colStatus')}</Th>
                  <Th><span className="sr-only">{t('common.actions')}</span></Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map(o => (
                  <Tr key={o.id} className={`cursor-pointer hover:bg-[var(--color-bg-secondary)] ${o.id === openId ? 'bg-[var(--color-bg-secondary)]' : ''}`} onClick={() => open(o.id)} data-testid={`order-row-${o.id}`}>
                    <Td>
                      <Link id={`order-link-${o.id}`} href={`${pathname}?id=${encodeURIComponent(o.id)}`} onClick={e => { e.preventDefault(); e.stopPropagation(); open(o.id); }}
                        className="font-mono font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline">
                        {o.shortRef}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">{eatDateTime(o.createdAt, locale)}</Td>
                    <Td>{o.buyer?.displayName || t('vendor.orders.buyerUnnamed')}</Td>
                    <Td>{fmt(t('vendor.orders.itemsCount'), { n: itemCount(o) })}{o.items[0]?.name ? <span className="block text-xs text-[var(--color-fg-quaternary)]">{o.items[0].name}</span> : null}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{money(o.totalTzs)}</Td>
                    <Td>{deliveryLine(o, t)}</Td>
                    <Td>{isPaid(o) ? <StatusBadge status={o.status} /> : <Badge tone="gray">{t('vendor.orders.awaitingPayment')}</Badge>}</Td>
                    <Td><ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--color-fg-quaternary)]" /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="space-y-3 md:hidden" aria-label={t('vendor.nav.orders')}>
            {shown.map(o => (
              <li key={o.id}>
                <Card className="p-0">
                  <Link id={`order-mlink-${o.id}`} href={`${pathname}?id=${encodeURIComponent(o.id)}`} onClick={e => { e.preventDefault(); open(o.id); }} className="block space-y-1 p-4" data-testid={`order-card-${o.id}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold">{o.shortRef}</span>
                      {isPaid(o) ? <StatusBadge status={o.status} /> : <Badge tone="gray">{t('vendor.orders.awaitingPayment')}</Badge>}
                    </span>
                    <span className="block text-sm">{o.buyer?.displayName || t('vendor.orders.buyerUnnamed')}</span>
                    <span className="block text-sm text-[var(--color-fg-tertiary)]">{fmt(t('vendor.orders.itemsCount'), { n: itemCount(o) })} · {money(o.totalTzs)}</span>
                    <span className="block text-sm text-[var(--color-fg-tertiary)]">{deliveryLine(o, t)}</span>
                    <span className="block text-xs text-[var(--color-fg-quaternary)]">{eatDateTime(o.createdAt, locale)}</span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {moreFailed && <Alert tone="error">{t('vendor.orders.failed')}</Alert>}
      {orders != null && !failed && nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={moreBusy} className="min-h-11" data-testid="orders-load-more">
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
      <OrderDetail id={openId} onBack={close} onUpdated={updated} />
    </div>
  );
}

function OrderDetail({ id, onBack, onUpdated }: { id: string; onBack: () => void; onUpdated: (o: VendorOrder) => void }) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [order, setOrder] = useState<VendorOrder | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  const [moved, setMoved] = useState(false);
  const [move, setMove] = useState<{ status: string; cancel: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (focus = true) => {
    if (!token) return;
    setState(s => (s === 'ready' ? s : 'loading'));
    try {
      const o = await api.vendorOrder(token, id);
      setOrder(o); setState('ready');
      if (focus) setTimeout(() => headingRef.current?.focus(), 0);
    } catch (err) {
      if (vendor.handleError(err)) return;
      setState(errorCode(err) === 'order_not_found' || (err as { status?: number }).status === 404 ? 'notFound' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);
  useEffect(() => { setMoved(false); void load(); }, [load]);

  async function confirmMove() {
    if (!token || !order || !move) return;
    if (move.cancel && !reason.trim()) { setReasonError(t('vendor.orders.reasonMissing')); return; }
    setBusy(true); setMoveError(null);
    try {
      const next = await api.vendorOrderStatus(token, order.id, { status: move.status, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      setOrder(next); onUpdated(next); setMoved(false);
      toast.success(fmt(t('vendor.orders.moved'), { status: t(statusKey(next.status)) }));
      setMove(null);
    } catch (err) {
      const code = errorCode(err);
      if (!isRefusal(err)) { setMoveError(t('vendor.networkError')); return; }
      setMove(null);
      if (code === 'invalid_transition' || code === 'status_is_final') {
        setMoved(true);
        void load(false);
      } else if (code === 'order_not_found') {
        setState('notFound');
      } else if (!vendor.handleError(err)) {
        if ((err as { status?: number }).status === 403) toast.error(t('vendor.noAccess'));
        else toast.error(t('vendor.saveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  const backButton = (
    <Button variant="link" onClick={onBack} className="min-h-11 h-auto px-0 text-sm font-semibold" data-testid="order-back">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.orders.back')}
    </Button>
  );
  if (state === 'loading') return <div className="space-y-4" aria-busy="true">{backButton}<SkeletonCard /><SkeletonCard /></div>;
  if (state === 'notFound') return <div className="space-y-4">{backButton}<ErrorState title={t('vendor.orders.notFound')} /></div>;
  if (state === 'error' || !order) return <div className="space-y-4">{backButton}<ErrorState title={t('vendor.orders.failed')} onRetry={() => load()} retryLabel={t('common.tryAgain')} /></div>;

  const o = order;
  const paid = isPaid(o);
  const suspended = vendor.me?.accountStatus === 'suspended';
  const showMoney = o.items.some(i => 'commissionTzs' in i);
  const sum = (key: 'commissionTzs' | 'vendorPayoutTzs') => o.items.reduce((n, i) => n + Number(i[key] ?? 0), 0);
  const contactOn = vendor.me?.tools.buyerContact === true;
  const phone = o.buyer?.phone || null;
  const address = typeof o.deliveryAddress === 'string' ? o.deliveryAddress : o.deliveryAddress ? String(o.deliveryAddress) : null;
  const differs = canonicalStatus(o.orderStatus) !== canonicalStatus(o.status);
  const methodLabel = methodKey(o.paymentMethod);

  return (
    <div className="space-y-4" data-testid="order-detail">
      {backButton}
      <Card>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">{fmt(t('vendor.orders.ref'), { ref: o.shortRef })}</h2>
            {paid ? <StatusBadge status={o.status} /> : <Badge tone="gray">{t('vendor.orders.awaitingPayment')}</Badge>}
          </div>
          <p className="text-sm text-[var(--color-fg-tertiary)]">{eatDateTime(o.createdAt, locale)}</p>
          {differs && <p className="text-sm text-[var(--color-fg-tertiary)]">{fmt(t('vendor.orders.overall'), { status: t(statusKey(o.orderStatus)) })}</p>}
        </CardContent>
      </Card>

      {moved && <Alert tone="warning">{t('vendor.orders.movedElsewhere')}</Alert>}

      {!paid && o.status !== 'cancelled' && <Alert tone="info">{t('vendor.orders.awaitingPaymentHint')}</Alert>}
      {paid && (o.nextStatuses.length > 0 || !isTerminal(o.status)) && (
        <Card>
          <CardHeader><h3 className="font-semibold">{t('vendor.orders.nextStep')}</h3></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {o.nextStatuses.map((s, i) => (
              <Button key={s} variant={i === 0 ? 'primary' : 'secondary'} className="min-h-11 h-auto whitespace-normal" disabled={suspended}
                onClick={() => { setMove({ status: s, cancel: false }); setReason(''); setReasonError(null); setMoveError(null); }} data-testid={`order-move-${s}`}>
                {t(markStatusKey(s))}
              </Button>
            ))}
            {!isTerminal(o.status) && (
              <Button variant="ghost" className="min-h-11 h-auto whitespace-normal text-[var(--color-error-700)]" disabled={suspended}
                onClick={() => { setMove({ status: 'cancelled', cancel: true }); setReason(''); setReasonError(null); setMoveError(null); }} data-testid="order-cancel">
                {t('vendor.orders.cancelMine')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><h3 className="font-semibold">{t('vendor.orders.yourItems')}</h3></CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-[var(--color-border-secondary)]">
            {o.items.map((item, idx) => (
              <li key={`${item.productId}-${item.variant}-${idx}`} className="flex gap-3 px-6 py-3">
                {item.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={item.image} alt="" className="h-10 w-10 shrink-0 rounded-[var(--radius-md)] object-cover" />
                  : <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-[var(--radius-md)] bg-[var(--color-bg-tertiary)]" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">{item.name}</p>
                  {item.variant && <p className="text-xs text-[var(--color-fg-tertiary)]">{fmt(t('vendor.orders.variant'), { name: item.variant })}</p>}
                  <p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.orders.qty')} {item.qty} · {t('vendor.orders.unitPrice')} {money(item.priceTzs)}</p>
                </div>
                <p className="whitespace-nowrap text-sm font-medium tabular-nums">{money(item.priceTzs * item.qty)}</p>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-[var(--color-border-secondary)] px-6 py-3 text-sm">
            <div className="flex justify-between gap-2"><dt>{t('vendor.orders.subtotal')}</dt><dd className="font-semibold tabular-nums" data-testid="order-subtotal">{money(o.totalTzs)}</dd></div>
            {showMoney && <div className="flex justify-between gap-2"><dt>{t('vendor.orders.commission')}</dt><dd className="tabular-nums">{money(sum('commissionTzs'))}</dd></div>}
            {showMoney && <div className="flex justify-between gap-2"><dt>{t('vendor.orders.youReceive')}</dt><dd className="font-semibold tabular-nums" data-testid="order-you-receive">{money(sum('vendorPayoutTzs'))}</dd></div>}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="font-semibold">{t('vendor.orders.payment')}</h3></CardHeader>
        <CardContent className="text-sm">
          {t(paymentKey(o.paymentStatus))}{methodLabel ? ` · ${t(methodLabel)}` : ''}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="font-semibold">{t('vendor.orders.buyerDelivery')}</h3></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p data-testid="order-buyer">{o.buyer?.displayName || t('vendor.orders.buyerUnnamed')}</p>
          <p>{deliveryLine(o, t)}</p>
          {phone && (
            <a href={`tel:${phone.replace(/\s+/g, '')}`} aria-label={fmt(t('vendor.orders.callBuyer'), { phone })}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] px-4 font-semibold text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-secondary)]" data-testid="order-call">
              <Phone aria-hidden="true" className="h-4 w-4" />{fmt(t('vendor.orders.call'), { phone })}
            </a>
          )}
          {address && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.orders.address')}</p>
              <p className="whitespace-pre-line [overflow-wrap:anywhere]" data-testid="order-address">{address}</p>
              <Button variant="secondary" size="sm" className="min-h-11" onClick={async () => {
                try { await navigator.clipboard.writeText(address); toast.success(t('vendor.orders.copied')); } catch { toast.error(t('vendor.saveFailed')); }
              }}>
                <Copy aria-hidden="true" className="h-4 w-4" />{t('vendor.orders.copyAddress')}
              </Button>
            </div>
          )}
          {(phone || address) && o.buyer?.contactVisibleUntil && (
            <p className="text-xs text-[var(--color-fg-tertiary)]">{fmt(t('vendor.orders.contactUntil'), { date: eatDateTime(o.buyer.contactVisibleUntil, locale) })}</p>
          )}
          {contactOn && !phone && !address && isTerminal(o.status) && (
            <p className="text-xs text-[var(--color-fg-tertiary)]" data-testid="order-contact-hidden">{t('vendor.orders.contactHidden')}</p>
          )}
          {o.note && (
            <blockquote className="border-l-4 border-[var(--color-border-primary)] pl-3">
              <p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.orders.buyerNote')}</p>
              <p className="whitespace-pre-line [overflow-wrap:anywhere]">{o.note}</p>
            </blockquote>
          )}
        </CardContent>
      </Card>

      {o.timeline.length > 0 && (
        <Card>
          <CardHeader><h3 className="font-semibold">{t('vendor.orders.timeline')}</h3></CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {o.timeline.map((e, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>{t(statusKey(e.status))}{e.reason ? ` · ${e.reason}` : ''}</span>
                  <span className="text-[var(--color-fg-tertiary)]">{eatDateTime(e.at, locale)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!move}
        onClose={() => { if (!busy) setMove(null); }}
        title={move?.cancel ? t('vendor.orders.cancelTitle') : move ? t(markStatusKey(move.status)) : ''}
        description={move?.cancel ? t('vendor.orders.cancelBody') : fmt(t('vendor.orders.ref'), { ref: o.shortRef })}
      >
        <div className="space-y-3">
          {moveError && <Alert tone="error">{moveError}</Alert>}
          <Field label={move?.cancel ? t('vendor.orders.reasonRequired') : t('vendor.orders.reasonOptional')} required={move?.cancel} error={reasonError ?? undefined}>
            <Textarea value={reason} maxLength={REASON_MAX} rows={3} onChange={e => { setReason(e.target.value); setReasonError(null); }} disabled={busy} data-testid="order-move-reason" />
          </Field>
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="secondary" onClick={() => setMove(null)} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
          <Button variant={move?.cancel ? 'destructive' : 'primary'} onClick={confirmMove} loading={busy} className="min-h-11" data-testid="order-move-confirm">
            {moveError ? t('common.tryAgain') : move?.cancel ? t('vendor.orders.cancelMine') : t('vendor.orders.confirm')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

/** Vendor (or staff with `orders`): my part of marketplace orders; ?id=<orderId> opens one. */
export default function VendorOrdersPage() {
  return <Suspense fallback={null}><OrdersInner /></Suspense>;
}
