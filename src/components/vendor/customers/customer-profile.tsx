'use client';
// One customer (S4 §5): header, what they owe (with aging), totals, open pay-later sales and activity
// (shop sales, app orders, payments). Record payment, void payment, edit, archive/restore, copy statement.
// A-02: an app customer shows no phone, email or address anywhere here.
import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Pencil, Phone } from 'lucide-react';
import {
  api, type VendorCustomer, type VendorCustomerOrder, type VendorCustomerPayment, type VendorCustomerProfile, type VendorPhoneDuplicate,
  type VendorSaleRow,
} from '@/lib/api';
import { money } from '@/lib/admin-utils';
import {
  canWalkInSales, customerName, eatDateTime, eatDayOf, errorBody, errorCode, fmt, isRefusal, receiptDay, saleMethodLabel, statusKey, statusTone,
} from '@/lib/vendor';
import { Alert, Badge, Button, Card, CardContent, CardHeader, ErrorState, Segmented, SkeletonCard, Spinner } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useToast } from '@/components/ui/toast';
import { useApp } from '../../../../app/providers';
import { AgingTiles, CreditBadges, linkCls, MoneyTile, OverdueBadge, rateLimitText, SourceBadge, TILE_GRID, useOnline } from './bits';
import { CustomerFormDialog } from './customer-form-dialog';
import { CustomerSaleDialog } from './customer-sale-dialog';
import { PaymentDialog } from './payment-dialog';
import { RecordPaymentDialog } from './record-payment-dialog';
import { StatementDialog } from './statement-dialog';

type Tab = 'sales' | 'orders' | 'payments';
const TABS: Tab[] = ['sales', 'orders', 'payments'];
const PAGE = 20;
type Paged<T> = { rows: T[] | null; next: string | null; failed: boolean; busy: boolean };
const emptyPage = <T,>(): Paged<T> => ({ rows: null, next: null, failed: false, busy: false });

export function CustomerProfile({
  id, tab, paymentId, onBack, onTab, onPayment, onOpenCustomer, initialDuplicate,
}: {
  id: string;
  tab: string | null;
  paymentId: string | null;
  onBack: () => void;
  onTab: (tab: Tab) => void;
  onPayment: (paymentId: string | null) => void;
  onOpenCustomer: (id: string) => void;
  /** Saved just now with a phone another customer has (Q-7: a warning, never a block). */
  initialDuplicate: VendorPhoneDuplicate;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const online = useOnline();
  const activeTab: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'sales';
  const [customer, setCustomer] = useState<VendorCustomerProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  const [sales, setSales] = useState<Paged<VendorSaleRow>>(emptyPage);
  const [orders, setOrders] = useState<Paged<VendorCustomerOrder>>(emptyPage);
  const [payments, setPayments] = useState<Paged<VendorCustomerPayment>>(emptyPage);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveNote, setArchiveNote] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<VendorPhoneDuplicate>(initialDuplicate);
  /** The balance right after a payment was saved (shown on its receipt). */
  const [owedAfter, setOwedAfter] = useState<number | null>(null);
  /** A sale opened read-only here (staff with `customers` but not `sales`). */
  const [saleOpen, setSaleOpen] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focused = useRef<string | null>(null);
  const cursors = useRef<Record<Tab, string | null>>({ sales: null, orders: null, payments: null });
  /** A newer load of the same list wins (a refresh while Load more is running). */
  const generation = useRef<Record<Tab, number>>({ sales: 0, orders: 0, payments: 0 });

  const loadProfile = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.vendorCustomer(token, id);
      setCustomer(res.customer); setState('ready');
    } catch (err) {
      if (errorCode(err) === 'customer_not_found') { setState('notFound'); return; }
      if (vendor.handleError(err)) return;
      setState(s => (s === 'ready' ? s : (err as { status?: number }).status === 404 ? 'notFound' : 'error'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  /** One activity list; `more` appends the next page. A failure stays inside the list (the header still shows). */
  const loadList = useCallback(async (which: Tab, more = false) => {
    if (!token) return;
    const setter = ({ sales: setSales, orders: setOrders, payments: setPayments } as unknown as Record<Tab, Dispatch<SetStateAction<Paged<unknown>>>>)[which];
    const cursor = more ? cursors.current[which] : null;
    if (more && !cursor) return;
    const gen = ++generation.current[which];
    setter(p => (more ? { ...p, busy: true, failed: false } : emptyPage<unknown>()));
    try {
      if (which === 'sales') {
        const r = await api.vendorCustomerSales(token, id, { limit: PAGE, cursor });
        if (gen !== generation.current.sales) return;
        cursors.current.sales = r.nextCursor ?? null;
        setSales(p => ({ rows: [...(more ? p.rows ?? [] : []), ...(r.sales ?? [])], next: r.nextCursor ?? null, failed: false, busy: false }));
      } else if (which === 'orders') {
        const r = await api.vendorCustomerOrders(token, id, { limit: PAGE, cursor });
        if (gen !== generation.current.orders) return;
        cursors.current.orders = r.nextCursor ?? null;
        setOrders(p => ({ rows: [...(more ? p.rows ?? [] : []), ...(r.orders ?? [])], next: r.nextCursor ?? null, failed: false, busy: false }));
      } else {
        const r = await api.vendorCustomerPayments(token, id, { limit: PAGE, cursor });
        if (gen !== generation.current.payments) return;
        cursors.current.payments = r.nextCursor ?? null;
        setPayments(p => ({ rows: [...(more ? p.rows ?? [] : []), ...(r.payments ?? [])], next: r.nextCursor ?? null, failed: false, busy: false }));
      }
    } catch (err) {
      if (gen !== generation.current[which]) return;
      if (vendor.handleError(err)) return;
      setter(p => ({ ...p, rows: p.rows ?? [], failed: true, busy: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  useEffect(() => {
    setState('loading'); setCustomer(null); setDuplicate(initialDuplicate); setArchiveNote(null);
    setSales(emptyPage()); setOrders(emptyPage()); setPayments(emptyPage());
    void loadProfile();
    // Shop sales tell whether there is pay-later history (the owed card shows "All paid off").
    void loadList('sales');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);
  useEffect(() => {
    if (activeTab === 'orders' && orders.rows == null && !orders.busy) void loadList('orders');
    if (activeTab === 'payments' && payments.rows == null && !payments.busy) void loadList('payments');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id, orders.rows, payments.rows]);

  // Opening a profile moves focus to the name heading, once per customer (after it is on screen).
  useEffect(() => {
    if (state !== 'ready' || focused.current === id || !headingRef.current) return;
    focused.current = id;
    headingRef.current.focus();
  }, [state, id]);

  /** After a payment or a void: balance, open sales, shop sales and payments all change. */
  const refreshMoney = () => { void loadProfile(); void loadList('sales'); void loadList('payments'); };

  async function setArchived(archived: boolean) {
    if (!token || !customer) return;
    setArchiveBusy(true); setArchiveNote(null);
    try {
      const res = await api.vendorUpdateCustomer(token, customer.id, { archived, updatedAt: customer.updatedAt });
      setArchiveOpen(false);
      toast.success(t(archived ? 'vendor.customers.archived' : 'vendor.customers.restored'));
      setCustomer(c => (c ? { ...c, ...res.customer } : c));
      void loadProfile();
    } catch (err) {
      setArchiveOpen(false);
      if (!isRefusal(err)) { setArchiveNote(t('vendor.customers.saveOffline')); return; }
      const code = errorCode(err);
      if (code === 'customer_has_balance') {
        const owed = errorBody<{ owedTzs?: number }>(err)?.owedTzs ?? customer.owedTzs;
        setArchiveNote(fmt(t('vendor.customers.archiveHasBalance'), { amount: money(owed) }));
      } else if (code === 'customer_changed') {
        setArchiveNote(t('vendor.customers.changedElsewhere')); void loadProfile();
      } else {
        const limited = rateLimitText(err, t);
        if (limited) setArchiveNote(limited);
        else if (!vendor.handleError(err)) setArchiveNote(t('vendor.saveFailed'));
      }
    } finally {
      setArchiveBusy(false);
    }
  }

  const backButton = (
    <Button variant="link" onClick={onBack} className="min-h-11 h-auto px-0 text-sm font-semibold" data-testid="customer-back">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.customers.back')}
    </Button>
  );
  if (state === 'loading') return <div className="space-y-4" aria-busy="true" aria-label={t('vendor.customers.loading')}>{backButton}<SkeletonCard /><SkeletonCard /></div>;
  if (state === 'notFound') return <div className="space-y-4">{backButton}<ErrorState title={t('vendor.customers.notFound')} /></div>;
  if (state === 'error' || !customer) {
    return <div className="space-y-4">{backButton}<ErrorState title={t('vendor.customers.failed')} onRetry={loadProfile} retryLabel={t('common.tryAgain')} /></div>;
  }

  const c = customer;
  const name = customerName(c, t);
  const manual = c.source === 'manual';
  const hasCredit = c.owedTzs > 0 || c.openSales.length > 0 || (sales.rows ?? []).some(s => s.kind === 'credit');
  const salesLinks = canWalkInSales(vendor.me);
  const ordersLinks = vendor.can('orders');
  const payDisabledWhy = c.archived ? t('vendor.pay.archived') : c.owedTzs <= 0 ? t('vendor.pay.nothingOwed') : !online ? t('vendor.pay.offline') : null;
  // With `sales`: the Sales page (void, copy receipt). Without: a read-only view of this customer's sale.
  const saleRef = (saleId: string, number: string) => (salesLinks
    ? <Link href={`/vendor/sales/?id=${encodeURIComponent(saleId)}`} className={`${linkCls} font-mono`}>{number}</Link>
    : <button type="button" className={`${linkCls} font-mono`} onClick={() => setSaleOpen(saleId)} data-testid={`customer-sale-open-${saleId}`}>{number}</button>);

  const listState = (p: Paged<unknown>, which: Tab, empty: string, body: ReactNode) => (
    p.rows == null ? <div className="p-6" aria-busy="true"><Spinner /></div>
      : p.failed && !p.rows.length ? (
        <div className="space-y-2 p-6" data-testid={`customer-${which}-failed`}>
          <Alert tone="error">{t('vendor.customers.activityFailed')}</Alert>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => loadList(which)}>{t('common.tryAgain')}</Button>
        </div>
      )
      : !p.rows.length ? <p className="px-6 py-5 text-sm text-[var(--color-fg-tertiary)]">{empty}</p>
      : (
        <>
          {body}
          {p.failed && <div className="px-6 pb-2"><Alert tone="error">{t('vendor.customers.activityFailed')}</Alert></div>}
          {p.next && (
            <div className="flex justify-center p-4">
              <Button variant="secondary" className="min-h-11" disabled={p.busy} onClick={() => loadList(which, true)} data-testid={`customer-${which}-more`}>
                {p.busy && <Spinner className="h-4 w-4" />}{t('vendor.stock.loadMore')}
              </Button>
            </div>
          )}
        </>
      )
  );
  const li = 'flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-6 py-3';

  return (
    <div className="space-y-4" data-testid="customer-profile">
      {backButton}
      {duplicate && (
        <div data-testid="customer-duplicate">
          <Alert tone="warning">
            <span className="flex flex-wrap items-center gap-x-3">
              <span>{fmt(t('vendor.customers.phoneDuplicate'), { name: duplicate.name || t('vendor.orders.buyerUnnamed') })}</span>
              <button type="button" className={linkCls} onClick={() => onOpenCustomer(duplicate.id)} data-testid="customer-duplicate-open">{t('vendor.customers.open')}</button>
            </span>
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Left: who, what they owe, totals, note. */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="space-y-3">
              <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none [overflow-wrap:anywhere]" data-testid="customer-heading">{name}</h1>
              <div className="flex flex-wrap gap-1.5">
                <SourceBadge source={c.source} />
                {c.archived && <Badge tone="gray">{t('vendor.customers.badge.archived')}</Badge>}
              </div>
              {manual ? (
                <dl className="space-y-1 text-sm" data-testid="customer-contact">
                  {c.phone && (
                    <div>
                      <a href={`tel:${c.phone}`} className={linkCls} aria-label={fmt(t('vendor.customers.call'), { name })}>
                        <Phone aria-hidden="true" className="mr-1.5 h-4 w-4" />{c.phone}
                      </a>
                    </div>
                  )}
                  {c.email && <div className="[overflow-wrap:anywhere]">{c.email}</div>}
                  {c.address && <div className="[overflow-wrap:anywhere]">{c.address}</div>}
                </dl>
              ) : (
                <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="customer-app-hint">{t('vendor.customers.appContactHint')}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="min-h-11" onClick={() => setEditOpen(true)} disabled={c.forgotten && !manual} data-testid="customer-edit">
                  <Pencil aria-hidden="true" className="h-4 w-4" />{t('vendor.customers.editTitle')}
                </Button>
                <Button variant="secondary" className="min-h-11" onClick={() => setStatementOpen(true)} data-testid="customer-statement">
                  <Copy aria-hidden="true" className="h-4 w-4" />{t('vendor.statement.copy')}
                </Button>
                {c.archived ? (
                  <Button variant="secondary" className="min-h-11" onClick={() => setArchived(false)} loading={archiveBusy} data-testid="customer-restore">{t('vendor.customers.restore')}</Button>
                ) : (
                  <Button variant="ghost" className="min-h-11 text-[var(--color-error-700)]" data-testid="customer-archive"
                    onClick={() => {
                      if (c.owedTzs > 0) { setArchiveNote(fmt(t('vendor.customers.archiveHasBalance'), { amount: money(c.owedTzs) })); return; }
                      setArchiveNote(null); setArchiveOpen(true);
                    }}>
                    {t('vendor.customers.archive')}
                  </Button>
                )}
              </div>
              {archiveNote && <div data-testid="customer-archive-note"><Alert tone="warning">{archiveNote}</Alert></div>}
            </CardContent>
          </Card>

          {hasCredit && (
            <Card data-testid="customer-owed">
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.customers.owes')}</span>
                  <span className="whitespace-nowrap text-2xl font-semibold tabular-nums" data-testid="customer-owed-value">{money(c.owedTzs)}</span>
                </div>
                {c.overdueTzs > 0 && (
                  <p data-testid="customer-overdue">
                    <Badge tone="warning"><span className="whitespace-nowrap">{fmt(t('vendor.customers.overdueAmount'), { amount: money(c.overdueTzs) })}</span></Badge>
                  </p>
                )}
                {c.owedTzs <= 0 && <Alert tone="success">{t('vendor.customers.paidOff')}</Alert>}
                <AgingTiles aging={c.aging} testId="customer-aging" />
                <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('vendor.customers.asOf'), { date: receiptDay(c.asOf, locale) })}</p>
                <div className="space-y-1">
                  <Button className="min-h-11 w-full" onClick={() => setPayOpen(true)} disabled={!!payDisabledWhy} data-testid="customer-record-payment">{t('vendor.pay.record')}</Button>
                  {payDisabledWhy && <p className="text-xs text-[var(--color-fg-tertiary)]">{payDisabledWhy}</p>}
                </div>
              </CardContent>
            </Card>
          )}

          <div className={TILE_GRID} data-testid="customer-totals">
            <MoneyTile label={t('vendor.customers.shopSales')} value={money(c.totals.shopSalesTzs)} sub={fmt(t('vendor.customers.count'), { n: c.totals.shopSalesCount })} testId="customer-total-shop" />
            {!manual && <MoneyTile label={t('vendor.customers.appOrders')} value={money(c.totals.appOrdersTzs)} sub={fmt(t('vendor.customers.count'), { n: c.totals.appOrdersCount })} testId="customer-total-app" />}
            <MoneyTile label={t('vendor.customers.lastPurchase')} value={c.totals.lastPurchaseAt ? receiptDay(eatDayOf(c.totals.lastPurchaseAt), locale) : '—'} testId="customer-last" />
          </div>

          {c.note && (
            <Card>
              <CardContent>
                <p className="text-xs font-medium text-[var(--color-fg-quaternary)]">{t('vendor.customers.note')}</p>
                <p className="whitespace-pre-line text-sm text-[var(--color-fg-tertiary)] [overflow-wrap:anywhere]" data-testid="customer-note-text">{c.note}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: open pay-later sales and activity. */}
        <div className="min-w-0 space-y-4">
          {c.openSales.length > 0 && (
            <Card>
              <CardHeader><h2 className="font-semibold">{t('vendor.customers.openSales')}</h2></CardHeader>
              <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="customer-open-sales">
                {c.openSales.map(s => (
                  <li key={s.id} className={li} data-testid={`open-sale-${s.id}`}>
                    <span className="space-y-0.5">
                      {saleRef(s.id, s.number)}
                      <span className="block text-sm text-[var(--color-fg-tertiary)]">
                        {eatDateTime(s.soldAt, locale)} · {fmt(t('vendor.customers.dueOn'), { date: receiptDay(s.dueDate, locale) })}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {s.overdue && <OverdueBadge days={s.daysOverdue} />}
                      <span className="whitespace-nowrap font-semibold tabular-nums">{money(s.balanceTzs)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader className="flex-wrap">
              <Segmented
                className="w-fit flex-wrap"
                value={activeTab}
                onChange={v => onTab(v as Tab)}
                options={[['sales', t('vendor.customers.shopSales')], ['orders', t('vendor.customers.appOrders')], ['payments', t('vendor.customers.payments')]]}
              />
            </CardHeader>
            <div data-testid={`customer-tab-${activeTab}`}>
              {activeTab === 'sales' && listState(sales, 'sales', t('vendor.customers.noSales'), (
                <ul className="divide-y divide-[var(--color-border-secondary)]">
                  {(sales.rows ?? []).map(s => (
                    <li key={s.id} className={li} data-testid={`customer-sale-${s.id}`}>
                      <span className="space-y-0.5">
                        {saleRef(s.id, s.number)}
                        <span className="block text-sm text-[var(--color-fg-tertiary)]">{eatDateTime(s.soldAt, locale)}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {s.status === 'voided' && <Badge tone="gray">{t('vendor.sales.voidedBadge')}</Badge>}
                        <CreditBadges sale={s} />
                        <span className={`whitespace-nowrap font-semibold tabular-nums ${s.status === 'voided' ? 'line-through text-[var(--color-fg-quaternary)]' : ''}`}>{money(s.totalTzs)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
              {activeTab === 'orders' && listState(orders, 'orders', t('vendor.customers.noOrders'), (
                <ul className="divide-y divide-[var(--color-border-secondary)]">
                  {(orders.rows ?? []).map(o => (
                    <li key={o.id} className={li} data-testid={`customer-order-${o.id}`}>
                      <span className="space-y-0.5">
                        {ordersLinks
                          ? <Link href={`/vendor/orders/?id=${encodeURIComponent(o.id)}`} className={`${linkCls} font-mono`}>{o.shortRef}</Link>
                          : <span className="whitespace-nowrap font-mono font-semibold">{o.shortRef}</span>}
                        <span className="block text-sm text-[var(--color-fg-tertiary)]">{eatDateTime(o.createdAt, locale)}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={statusTone(o.status)}>{t(statusKey(o.status))}</Badge>
                        <span className="whitespace-nowrap font-semibold tabular-nums">{money(o.totalTzs)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
              {activeTab === 'payments' && listState(payments, 'payments', t('vendor.customers.noPayments'), (
                <ul className="divide-y divide-[var(--color-border-secondary)]">
                  {(payments.rows ?? []).map(p => (
                    <li key={p.id}>
                      <button type="button" className={`${li} w-full text-left hover:bg-[var(--color-bg-secondary)]`} onClick={() => { setOwedAfter(null); onPayment(p.id); }} data-testid={`customer-payment-${p.id}`}>
                        <span className="space-y-0.5">
                          <span className="whitespace-nowrap font-mono font-semibold text-[var(--color-brand-700)]">{p.number}</span>
                          <span className="block text-sm text-[var(--color-fg-tertiary)]">
                            {receiptDay(p.receivedOn, locale)} · {saleMethodLabel(p.method, t)}
                            {p.allocations.length > 0 && ` · ${fmt(t('vendor.pay.paidSales'), { numbers: p.allocations.map(a => a.saleNumber).join(', ') })}`}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          {p.status === 'voided' && <Badge tone="gray">{t('vendor.sales.voidedBadge')}</Badge>}
                          <span className={`whitespace-nowrap font-semibold tabular-nums ${p.status === 'voided' ? 'line-through text-[var(--color-fg-quaternary)]' : ''}`}>{money(p.amountTzs)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <CustomerFormDialog
        open={editOpen}
        customer={c as VendorCustomer}
        onClose={() => setEditOpen(false)}
        onReload={() => { setEditOpen(false); void loadProfile().then(() => setEditOpen(true)); }}
        onSaved={(saved, dup) => {
          setEditOpen(false); setDuplicate(dup);
          setCustomer(cur => (cur ? { ...cur, ...saved } : cur));
          toast.success(t('vendor.customers.saved'));
          void loadProfile();
        }}
      />
      <RecordPaymentDialog
        open={payOpen}
        customer={c}
        onClose={() => setPayOpen(false)}
        onStale={() => { void loadProfile(); }}
        onSaved={(payment, stillOwed) => {
          setPayOpen(false);
          setOwedAfter(stillOwed);
          refreshMoney();
          // The receipt of what was just saved, with Copy / Done (§1.4).
          onPayment(payment.id);
        }}
      />
      <CustomerSaleDialog customerId={c.id} saleId={saleOpen} onClose={() => setSaleOpen(null)} />
      <StatementDialog open={statementOpen} customer={c} onClose={() => setStatementOpen(false)} />
      <PaymentDialog
        customerId={c.id}
        paymentId={paymentId}
        customerLabel={name}
        stillOwedTzs={owedAfter ?? c.owedTzs}
        onClose={() => { setOwedAfter(null); onPayment(null); }}
        onVoided={() => { setOwedAfter(null); refreshMoney(); }}
      />
      <Dialog
        open={archiveOpen}
        onClose={() => { if (!archiveBusy) setArchiveOpen(false); }}
        title={fmt(t('vendor.customers.archiveTitle'), { name })}
        description={t('vendor.customers.archiveBody')}
      >
        <DialogFooter className="flex-wrap">
          <Button variant="secondary" className="min-h-11" onClick={() => setArchiveOpen(false)} disabled={archiveBusy}>{t('common.cancel')}</Button>
          <Button variant="destructive" className="min-h-11" onClick={() => setArchived(true)} loading={archiveBusy} data-testid="customer-archive-confirm">{t('vendor.customers.archive')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
