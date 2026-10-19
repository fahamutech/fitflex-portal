// Small helpers for the vendor area (S2). No strings here: every label is an i18n key.
import { ApiError, type ProductVariant, type VendorOrder } from '@/lib/api';
import type { BadgeTone } from '@/lib/admin-utils';
import type { Locale, MessageKey } from '@/lib/i18n';

/** Fill `{name}` placeholders. */
export function fmt(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** The `error` code of an API refusal, else null (network, unknown). */
export function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? ((err.body as { error?: string } | null)?.error ?? null) : null;
}
export function errorBody<T = Record<string, unknown>>(err: unknown): (T & { error?: string }) | null {
  return err instanceof ApiError ? ((err.body as (T & { error?: string }) | null) ?? null) : null;
}
/** A refusal the server answered (4xx); otherwise the request may not have arrived (network, 5xx). */
export const isRefusal = (err: unknown) => err instanceof ApiError && err.status >= 400 && err.status < 500;

// ── Order statuses (mirrors the server's order lifecycle) ──
export const canonicalStatus = (status: string | null | undefined) =>
  status === 'confirmed' ? 'accepted' : status === 'fulfilled' ? 'delivered' : (status ?? '');
const KNOWN_STATUSES = new Set(['pending', 'accepted', 'processing', 'packed', 'dispatched', 'ready_for_pickup', 'delivered', 'cancelled']);
export const statusKey = (status: string | null | undefined) => {
  const s = canonicalStatus(status);
  return (KNOWN_STATUSES.has(s) ? `shop.orderStatus.${s}` : 'shop.orderStatus.unknown') as MessageKey;
};
export const markStatusKey = (status: string) => `vendor.markStatus.${canonicalStatus(status)}` as MessageKey;
export function statusTone(status: string | null | undefined): BadgeTone {
  const s = canonicalStatus(status);
  if (s === 'delivered') return 'success';
  if (s === 'cancelled') return 'gray';
  if (s === 'pending') return 'warning';
  return 'brand';
}
export const isTerminal = (status: string | null | undefined) => ['delivered', 'cancelled'].includes(canonicalStatus(status));
export const isPaid = (order: Pick<VendorOrder, 'paymentStatus'>) => order.paymentStatus === 'paid';
/** Money going back to the buyer (shown next to the status). */
export const isRefundState = (paymentStatus: string | null) => paymentStatus === 'refund_pending' || paymentStatus === 'refunded';

/**
 * Which tab an order sits in; the same rules as the server's orderTab() (functions
 * src/shared/vendor-order-view.mjs), first match wins:
 * cancelled = my part cancelled, or the whole order cancelled, or a refund pending/done (an expired unpaid order too);
 * delivered = my part delivered; open = paid and neither; unpaid and not cancelled → only in "all" (null).
 */
export type OrderTab = 'open' | 'delivered' | 'cancelled' | 'all';
export function orderTab(order: Pick<VendorOrder, 'status' | 'orderStatus' | 'paymentStatus'>): 'open' | 'delivered' | 'cancelled' | null {
  if (canonicalStatus(order.status) === 'cancelled' || canonicalStatus(order.orderStatus) === 'cancelled' || isRefundState(order.paymentStatus)) return 'cancelled';
  if (canonicalStatus(order.status) === 'delivered') return 'delivered';
  if (order.paymentStatus === 'paid') return 'open';
  return null;
}
export const inOrderTab = (order: VendorOrder, tab: OrderTab) => tab === 'all' || orderTab(order) === tab;
/** Open = paid, and neither delivered nor cancelled (see orderTab). */
export const isOpenOrder = (order: VendorOrder) => orderTab(order) === 'open';
/** Still waiting for the buyer's payment: in no tab but "all". */
export const isAwaitingPayment = (order: Pick<VendorOrder, 'status' | 'orderStatus' | 'paymentStatus'>) =>
  orderTab(order) === null && (order.paymentStatus === 'pending' || order.paymentStatus == null);

/** Server-side counts of my orders (GET /vendor/orders when paged); absent on older servers. */
export type OrderCounts = { open: number; delivered: number; cancelled: number; all: number; waitingAccept: number };
export function countsOf(value: unknown): OrderCounts | null {
  const c = value as Partial<OrderCounts> | null | undefined;
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  return c && ok(c.open) && ok(c.delivered) && ok(c.cancelled) && ok(c.all) && ok(c.waitingAccept) ? (c as OrderCounts) : null;
}

/** "1 item" / "3 items". */
export const itemsKey = (n: number) => (n === 1 ? 'vendor.orders.itemsCountOne' : 'vendor.orders.itemsCount') as MessageKey;
export const paymentKey = (status: string | null) =>
  (['paid', 'pending', 'refund_pending', 'refunded', 'failed'].includes(status ?? '') ? `vendor.orders.payment.${status}` : 'vendor.orders.payment.unknown') as MessageKey;
export const methodKey = (method: string | null) =>
  (['mpesa', 'airtel_money', 'mixx', 'card', 'bank'].includes(method ?? '') ? `vendor.orders.method.${method}` : null) as MessageKey | null;
/** A payment method or provider code as people say it ("mpesa" → M-Pesa); unknown values are shown as given. */
export function payLabel(code: string | null | undefined, t: (k: MessageKey) => string) {
  if (!code) return '';
  const key = methodKey(code.toLowerCase().replace(/[\s-]+/g, '_').replace(/^m_?pesa$/, 'mpesa').replace(/^airtel$/, 'airtel_money'));
  return key ? t(key) : code;
}

/** Q-8: no human order number yet; both apps show the last 6 characters, uppercase. */
export const shortRefOf = (id: string | null | undefined) => String(id ?? '').slice(-6).toUpperCase();

// ── Dates, East Africa Time ──
const EAT = 'Africa/Dar_es_Salaam';
const intlLocale = (locale: Locale) => (locale === 'sw' ? 'sw-TZ' : 'en-GB');
/** "19 Oct, 14:05" in EAT. */
export function eatDateTime(iso: string | null | undefined, locale: Locale) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const day = date.toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'short', timeZone: EAT });
  const time = date.toLocaleTimeString(intlLocale(locale), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: EAT });
  return `${day}, ${time}`;
}
/** "19 Oct 2026" in EAT. */
export function eatDay(iso: string | null | undefined, locale: Locale) {
  if (!iso) return '—';
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00+03:00` : iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: EAT });
}
/** "6 Oct" / "6 Okt" for a calendar day "YYYY-MM-DD", in the chosen language. */
export function dayMonth(day: string | null | undefined, locale: Locale) {
  if (!day) return '—';
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Today's EAT calendar day, "YYYY-MM-DD". */
export const eatToday = (now = new Date()) => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ── Products ──
/** Stock-history notes the server writes itself (codes) → i18n key; anything else is the person's own note. */
const SYSTEM_NOTES: Record<string, MessageKey> = {
  product_form: 'vendor.stock.fromProductForm',
  product_created: 'vendor.stock.note.productCreated',
  variants_tracked: 'vendor.stock.note.variantsTracked',
};
export const systemNoteKey = (note: string | null | undefined): MessageKey | null => (note && SYSTEM_NOTES[note]) || null;

/** A category key ("supplements_nutrition") in the chosen language, from GET /shop/categories; else made readable. */
export type Category = { key: string; en: string; sw: string };
export function categoryLabel(key: string | null | undefined, categories: Category[], locale: Locale) {
  if (!key) return '';
  const hit = categories.find(c => c.key === key);
  if (hit) return locale === 'sw' ? hit.sw || hit.en : hit.en;
  const readable = key.replace(/_/g, ' ');
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

/** The product's variants as objects (older rows may hold other shapes; they are ignored). */
export function variantsOf(product: { variants?: unknown }): ProductVariant[] {
  const raw = product.variants as unknown;
  return Array.isArray(raw) ? (raw.filter(v => v && typeof v === 'object' && typeof (v as ProductVariant).name === 'string') as ProductVariant[]) : [];
}
/** Every variant counts its own stock (O-1): the product's stock is their sum. */
export const tracksVariantStock = (product: { variants?: unknown }) => {
  const vs = variantsOf(product);
  return vs.length > 0 && vs.every(v => typeof v.stock === 'number');
};
export const lowKey = (productId: string, variant?: string | null) => `${productId}::${variant ?? ''}`;

/** A client reference for one stock entry (8–100 characters); reused on retries of the same entry. */
export function newClientRef() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Permissions a vendor user needs for each area. */
export const VENDOR_AREAS = [
  { href: '/vendor', permission: null },
  { href: '/vendor/products', permission: 'products' },
  { href: '/vendor/orders', permission: 'orders' },
  { href: '/vendor/payouts', permission: 'payments' },
] as const;

/** The products page's query string, remembered so stock history can go back to the same filters. */
export const PRODUCTS_QS_KEY = 'vendor.products.qs';

/** Why a partner can't be paid yet, as an i18n key in their own voice ("you have…"). */
export function payoutWhyKey(reason: string | null | undefined): MessageKey {
  if (reason === 'kyc_not_started' || reason === 'payout_account_not_verified' || reason === 'payout_account_cooling_off') return `payout.why.${reason}` as MessageKey;
  if (reason?.startsWith('kyc_')) return 'payout.why.kyc_other';
  return 'payout.why.other';
}
