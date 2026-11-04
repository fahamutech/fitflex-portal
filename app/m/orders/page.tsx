'use client';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, muted } from '@/components/member/member-frame';
import { fmt } from '@/components/member/member-shared';
import { formatDate, formatTzs, memberApi, type Gym, type ShopOrder } from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';

export default function MemberOrdersPage() {
  return <MemberFrame testId="member-orders-page">{() => <Orders />}</MemberFrame>;
}

// Where an order is on its way to the member (server: src/shared/order-lifecycle.mjs). Pickup orders only show
// the gym-pickup steps; the status is read as stored (legacy confirmed = accepted, fulfilled = delivered).
const RANK: Record<string, number> = { pending: 0, confirmed: 1, accepted: 1, processing: 1, packed: 1, dispatched: 2, ready_for_pickup: 3, delivered: 4, fulfilled: 4 };
const STEPS: MessageKey[] = ['member.orders.step.placed', 'member.orders.step.accepted', 'member.orders.step.onWay', 'member.orders.step.ready', 'member.orders.step.collected'];
const isClosed = (o: ShopOrder) => o.status === 'cancelled' || RANK[o.status] === 4;
// The order id exactly as the seller and the gym desk see it.
const shortId = (id: string) => id;

function statusKey(o: ShopOrder): MessageKey {
  if (o.status === 'cancelled') return 'member.orders.status.cancelled';
  if (o.status === 'ready_for_pickup') return 'member.orders.status.ready_for_pickup';
  if (RANK[o.status] === 4) return 'member.orders.status.delivered';
  if (o.status === 'pending') return 'member.orders.status.pending';
  return 'member.orders.status.inProgress';
}

function Orders() {
  const { t } = useApp();
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [gyms, setGyms] = useState<Map<string, Gym>>(new Map());
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tab, setTab] = useState<'active' | 'past'>('active');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [o, g] = await Promise.all([memberApi.shopOrders(), memberApi.gyms().catch(() => [])]);
      setOrders(o);
      setGyms(new Map(g.map(x => [x.id, x]))); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <Loading />;
  if (state === 'error') return <LoadError onRetry={load} />;
  const active = orders.filter(o => !isClosed(o));
  const past = orders.filter(isClosed);
  const list = tab === 'active' ? active : past;
  const tabCls = (on: boolean) => `min-h-11 whitespace-nowrap border-b-[3px] px-4 text-[15px] ${on ? 'border-[#c8f04a] font-bold text-[#f1f5f9]' : 'border-transparent text-[#aab4c4]'}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle eyebrow={t('member.orders.eyebrow')} title={t('member.orders.title')} />
        <p className={`mb-6 text-sm ${muted}`}>{t('member.orders.intro')}</p>
      </div>
      <div role="tablist" aria-label={t('member.orders.title')} className="mb-5 flex gap-1 border-b border-[#1e293b]">
        <button type="button" role="tab" aria-selected={tab === 'active'} className={tabCls(tab === 'active')} onClick={() => setTab('active')} data-testid="member-orders-tab-active">{fmt(t('member.orders.active'), { n: active.length })}</button>
        <button type="button" role="tab" aria-selected={tab === 'past'} className={tabCls(tab === 'past')} onClick={() => setTab('past')} data-testid="member-orders-tab-past">{fmt(t('member.orders.past'), { n: past.length })}</button>
      </div>
      <div role="tabpanel" className="flex flex-col gap-4" data-testid="member-orders-list">
        {list.length === 0 ? <p className={`${card} ${muted}`}>{t('member.orders.empty')}</p> : list.map(o => <OrderCard key={o.id} order={o} gym={o.pickupGymId ? gyms.get(o.pickupGymId) ?? null : null} />)}
      </div>
      {tab === 'past' && past.length > 0 && <p className={`mt-6 text-sm ${muted}`}>{t('member.orders.orderAgain')}</p>}
    </>
  );
}

function OrderCard({ order, gym }: { order: ShopOrder; gym: Gym | null }) {
  const { t, locale } = useApp();
  const ready = order.status === 'ready_for_pickup';
  const rank = RANK[order.status] ?? 0;
  const names = order.items.map(i => i.qty > 1 ? fmt(t('member.orders.itemQty'), { name: i.name ?? t('member.unknown'), n: i.qty }) : (i.name ?? t('member.unknown'))).join(', ');
  const gymName = order.pickupGym?.name ?? gym?.name ?? null;
  const paid = order.paymentStatus === 'paid' || !order.paymentStatus;
  return (
    <section aria-labelledby={`o-${order.id}`} data-testid={`member-order-${order.id}`}
      className={`flex flex-col gap-4 rounded-3xl bg-[#0f172a] p-6 ${ready ? 'border-2 border-[#ff8a6b]' : 'border border-[#1e293b]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={`o-${order.id}`} className="text-xl font-extrabold">{names || fmt(t('member.orders.items'), { n: order.items.length })}</h2>
          <span className={`text-sm ${muted}`}>
            {fmt(t('member.orders.number'), { id: shortId(order.id) })} · {formatDate(order.createdAt, locale)} · {fmt(t(paid ? 'member.orders.paid' : 'member.orders.unpaid'), { amount: formatTzs(order.totalTzs, locale) })}
          </span>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${ready ? 'bg-[#3a1d14] text-[#ffd2c4]' : order.status === 'cancelled' ? 'bg-[#1e293b] text-[#94a3b8]' : 'bg-[#1e293b] text-[#cbd5e1]'}`}>{t(statusKey(order))}</span>
      </div>
      {order.status !== 'cancelled' && rank < 4 && order.deliveryMethod !== 'home_delivery' && (
        <ol aria-label={t('member.orders.title')} className="grid grid-cols-5 gap-2 text-xs sm:text-sm">
          {STEPS.map((k, i) => (
            <li key={k} aria-current={i === rank ? 'step' : undefined} className="flex flex-col gap-1.5">
              <span aria-hidden="true" className={`h-1.5 rounded-full ${i < rank ? 'bg-[#3dd98e]' : i === rank ? 'bg-[#c8f04a]' : 'bg-[#1e293b]'}`} />
              <span className={i <= rank ? 'font-semibold' : muted}>{t(k)}</span>
            </li>
          ))}
        </ol>
      )}
      {order.deliveryMethod === 'home_delivery'
        ? <p className={`text-sm ${muted}`}>{t('member.orders.homeDelivery')}</p>
        : gymName && order.status !== 'cancelled' && rank < 4 && (
          <div className="flex flex-col gap-1 rounded-2xl border border-[#1e293b] bg-[#020617] px-4 py-3.5">
            <span className={`text-sm ${muted}`}>{t('member.orders.collectAt')}</span>
            <strong>{gymName}</strong>
            {ready && <span className="text-sm text-[#cbd5e1]">{t('member.orders.collectHint')} <strong className="font-mono tracking-wider">{shortId(order.id)}</strong></span>}
          </div>
        )}
    </section>
  );
}
