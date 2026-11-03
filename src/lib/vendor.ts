// Small helpers for the vendor area (S2). No strings here: every label is an i18n key.
import {
  ApiError, type AgingBucket, type ProductVariant, type VendorCustomerOpenSale, type VendorCustomerPayment, type VendorCustomerProfile, type VendorOrder,
  type VendorSale, type VendorTools,
} from '@/lib/api';
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

/** Permissions (and, for some, a switched-on vendor tool) a vendor user needs for each area. */
export const VENDOR_AREAS: ReadonlyArray<{ href: string; permission: string | null; tool?: keyof VendorTools; nav?: false; quietWhenOff?: true; noAccessKey?: MessageKey }> = [
  { href: '/vendor', permission: null },
  { href: '/vendor/products', permission: 'products' },
  // Shop banners (Phase 2 S1): owner + staff with `products` (spec Q-10). The nav item also waits for the
  // server to have SHOP_BANNERS on (useShopBannersAvailable); a deep link with it off shows "isn't available yet".
  { href: '/vendor/promotions', permission: 'products' },
  { href: '/vendor/orders', permission: 'orders' },
  // S3: walk-in sales need the tool on (fails closed: missing = off) and the `sales` permission.
  { href: '/vendor/sales', permission: 'sales', tool: 'walkInSales' },
  // S4: customers need the tool on (fails closed) and the `customers` permission.
  { href: '/vendor/customers', permission: 'customers', tool: 'customers' },
  // S6: reports need the tool on (fails closed) and the `reports` permission. With the tool off a deep link goes
  // home with no message (spec §0.1, AC-1); without the permission it says "no access" (AC-3).
  { href: '/vendor/reports', permission: 'reports', tool: 'reports', quietWhenOff: true, noAccessKey: 'vendor.reports.noAccess' },
  { href: '/vendor/payouts', permission: 'payments' },
  // S5: the document view needs documents switched on (fails closed); each kind checks its own permission on the
  // page (sale: sales or customers · payment, statement: customers · order: orders). Not a nav item.
  { href: '/vendor/documents', permission: null, tool: 'documents', nav: false },
  // S5: tax details need VAT switched on and the owner (who has every permission) or staff with `payments` (read only).
  { href: '/vendor/settings/tax', permission: 'payments', tool: 'vat' },
];
/** Whether this person may open an area: its permission, and its tool switched on (=== true). */
export function vendorAreaOpen(area: (typeof VENDOR_AREAS)[number], permissions: readonly string[], tools: VendorTools | null | undefined) {
  if (area.permission && !permissions.includes(area.permission)) return false;
  if (area.tool && tools?.[area.tool] !== true) return false;
  return true;
}
/** Documents (links, PDF, the document view) are switched on (S5; fails closed: missing = off). */
export const documentsOn = (me: { tools?: VendorTools } | null | undefined) => !!me && me.tools?.documents === true;
/** Customers, balances and payments are open for this person (S4): tool on and `customers` permission. */
export const canCustomers = (me: { permissions?: string[]; tools?: VendorTools } | null | undefined) =>
  !!me && me.tools?.customers === true && !!me.permissions?.includes('customers');
/** Walk-in sales are open for this person (S3): tool on and `sales` permission. */
export const canWalkInSales = (me: { permissions?: string[]; tools?: VendorTools } | null | undefined) =>
  !!me && me.tools?.walkInSales === true && !!me.permissions?.includes('sales');

// ── Walk-in sales (S3) ──
const SALE_METHOD_KEYS: Record<string, MessageKey> = {
  cash: 'vendor.pos.method.cash',
  mpesa: 'vendor.orders.method.mpesa',
  airtel_money: 'vendor.orders.method.airtel_money',
  mixx: 'vendor.orders.method.mixx',
  halopesa: 'vendor.pos.method.halopesa',
  card: 'vendor.orders.method.card',
  bank: 'vendor.orders.method.bank',
  other: 'vendor.pos.method.other',
};
/** A walk-in payment method code in the chosen language; an unknown code falls back to "Other". */
export const saleMethodLabel = (method: string, t: (k: MessageKey) => string) => t(SALE_METHOD_KEYS[method] ?? 'vendor.pos.method.other');
/** "Cash + M-Pesa". */
export const saleMethodsLabel = (methods: string[] | null | undefined, t: (k: MessageKey) => string) =>
  (methods ?? []).map(m => saleMethodLabel(m, t)).join(' + ');
/** Recorded offline: it reached FitFlex more than 5 minutes after it was sold. */
export const recordedOffline = (sale: { soldAt?: string | null; recordedAt?: string | null; lateRecorded?: boolean }) => {
  // The server's own mark wins when it sends one (security follow-up on #214).
  if (typeof sale.lateRecorded === 'boolean') return sale.lateRecorded;
  const sold = Date.parse(sale.soldAt ?? ''); const rec = Date.parse(sale.recordedAt ?? '');
  return Number.isFinite(sold) && Number.isFinite(rec) && rec - sold > 5 * 60_000;
};
/** The EAT calendar day "YYYY-MM-DD" of a timestamp. */
export const eatDayOf = (iso: string | null | undefined) => {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? eatToday(new Date(ms)) : null;
};
/**
 * Who may void a completed sale (security follow-up on #214; the server decides, this only hides the button):
 * the vendor account and admin-role staff any sale; other staff only their own, on the EAT day it was sold.
 */
export function mayVoidSale(
  sale: { status: string; soldAt: string; createdBy: { id: string } | null },
  who: { userId: string | null | undefined; userType: string | null | undefined; vendorRole: string | null | undefined },
  now = new Date(),
) {
  if (sale.status !== 'completed') return false;
  if (who.userType === 'vendor' || who.vendorRole === 'admin') return true;
  return !!who.userId && sale.createdBy?.id === who.userId && eatDayOf(sale.soldAt) === eatToday(now);
}

const RECEIPT_WIDTH = 32;
const amountOnly = (n: number) => new Intl.NumberFormat('en-US').format(Number(n || 0));
/** "label      amount", padded to 32 characters where it fits (WhatsApp on phones). */
function receiptRow(label: string, amount: string) {
  // Too long for one line (e.g. a method with its reference): label alone, then the amount in the right-hand column.
  if (label.length + 1 + amount.length > RECEIPT_WIDTH) return `${label}\n${amount.padStart(RECEIPT_WIDTH)}`;
  return `${label}${' '.repeat(RECEIPT_WIDTH - label.length - amount.length)}${amount}`;
}

// The app's receipt clock (fitflexmobile lib/shared/formatters.dart formatDateTime / formatTimeOfDay), in EAT:
// en "19 Oct 2026, 14:05"; sw a 12-hour clock with the part of the day, "19 Okt 2026, 2:05 mchana".
export const RECEIPT_MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
} as const;
export const swDayPeriod = (h: number) => (h >= 5 && h < 12 ? 'asubuhi' : h >= 12 && h < 16 ? 'mchana' : h >= 16 && h < 19 ? 'jioni' : 'usiku');
/** "19 Oct 2026, 14:05" / "19 Okt 2026, 2:05 mchana" in EAT, as the app writes it on receipts. */
export function receiptDateTime(iso: string | null | undefined, locale: Locale) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms + 3 * 3_600_000); // EAT has no DST: read the UTC fields of the shifted time.
  const [h, m] = [d.getUTCHours(), d.getUTCMinutes()];
  const mm = String(m).padStart(2, '0');
  const time = locale === 'sw' ? `${h % 12 === 0 ? 12 : h % 12}:${mm} ${swDayPeriod(h)}` : `${String(h).padStart(2, '0')}:${mm}`;
  return `${d.getUTCDate()} ${RECEIPT_MONTHS[locale === 'sw' ? 'sw' : 'en'][d.getUTCMonth()]} ${d.getUTCFullYear()}, ${time}`;
}
/**
 * "19 Oct, 14:05" / "19 Okt, 2:05 mchana" in EAT: eatDateTime with the Swahili time of day on a 12-hour clock
 * and its part of the day (glossary, decided 2026-10-20; the app's formatTimeOfDay). Used on the flash sale screens.
 */
export function eatWhen(iso: string | null | undefined, locale: Locale) {
  if (locale !== 'sw') return eatDateTime(iso, locale);
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms + 3 * 3_600_000); // EAT has no DST: read the UTC fields of the shifted time.
  const h = d.getUTCHours();
  return `${d.getUTCDate()} ${RECEIPT_MONTHS.sw[d.getUTCMonth()]}, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${swDayPeriod(h)}`;
}
/**
 * The receipt as plain text (spec §4.2), in the language `t` speaks. Not a TRA fiscal receipt; no customer
 * details, no marketing line. `totalLabel` is the formatted total ("TSh 95,000").
 */
export function saleReceiptText(
  sale: Pick<VendorSale, 'number' | 'soldAt' | 'subtotalTzs' | 'lineDiscountTzs' | 'discountTzs' | 'totalTzs' | 'changeTzs' | 'createdBy' | 'lines' | 'payments'>
    & Partial<Pick<VendorSale, 'kind' | 'customer' | 'dueDate' | 'paidAtSaleTzs'>>,
  opts: { business: string; locale: Locale; t: (k: MessageKey) => string; totalLabel: string },
) {
  const { t } = opts;
  const rule = '-'.repeat(20);
  const credit = sale.kind === 'credit';
  const out: string[] = [opts.business, fmt(t('vendor.pos.receiptNo'), { number: sale.number }), receiptDateTime(sale.soldAt, opts.locale)];
  // S4: the customer's name only, never phone, email or address.
  if (sale.customer) out.push(fmt(t('vendor.receipt.customer'), { name: customerName(sale.customer, t) }));
  out.push(rule);
  for (const line of sale.lines) {
    const name = `${line.qty} x ${line.nameSnapshot}${line.variant ? ` (${line.variant})` : ''}`;
    const gross = amountOnly(line.qty * line.unitPriceTzs);
    if (line.qty > 1 || line.priceChanged || line.unitPriceTzs !== line.listPriceTzs) {
      out.push(name, receiptRow(`   @ ${amountOnly(line.unitPriceTzs)}`, gross));
    } else {
      out.push(receiptRow(name, gross));
    }
    if (line.discountTzs > 0) out.push(receiptRow(`   ${t('vendor.pos.lineDiscountShort')}`, `-${amountOnly(line.discountTzs)}`));
  }
  out.push(rule, receiptRow(t('vendor.pos.subtotal'), amountOnly(sale.subtotalTzs)));
  const discounts = Number(sale.lineDiscountTzs || 0) + Number(sale.discountTzs || 0);
  if (discounts > 0) out.push(receiptRow(t('vendor.pos.discounts'), `-${amountOnly(discounts)}`));
  out.push(receiptRow(t('vendor.pos.total'), opts.totalLabel));
  for (const p of sale.payments) {
    const method = saleMethodLabel(p.method, t);
    out.push(receiptRow(p.reference ? `${method} (${p.reference})` : method, amountOnly(p.amountTzs)));
  }
  if (credit) {
    // Pay later (S4 §7.1): what was paid at the counter and the balance it left; never change.
    const paidNow = sale.paidAtSaleTzs ?? sale.payments.reduce((n, p) => n + p.amountTzs, 0);
    out.push(
      receiptRow(t('vendor.pos.credit.paidNow'), amountOnly(paidNow)),
      receiptRow(t('vendor.receipt.balanceDue'), amountOnly(Math.max(0, sale.totalTzs - paidNow))),
    );
    if (sale.dueDate) out.push(receiptRow(t('vendor.receipt.dueBy'), receiptDay(sale.dueDate, opts.locale)));
  } else if (sale.changeTzs > 0) out.push(receiptRow(t('vendor.pos.change'), amountOnly(sale.changeTzs)));
  out.push(rule);
  if (sale.createdBy?.name) out.push(fmt(t('vendor.pos.servedBy'), { name: sale.createdBy.name }));
  out.push(fmt(t(credit ? 'vendor.receipt.footerCredit' : 'vendor.pos.receiptFooter'), { business: opts.business }), t('vendor.pos.notFiscal'));
  return out.join('\n');
}

// ── Customers, pay later, payments (S4) ──
export const AGING_BUCKETS: readonly AgingBucket[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus'];
export const agingKey = (bucket: AgingBucket) => `vendor.aging.${bucket}` as MessageKey;
export const isAgingBucket = (v: string | null | undefined): v is AgingBucket => !!v && (AGING_BUCKETS as readonly string[]).includes(v);

/** A customer's name as shown: an app buyer who deleted their account is "Deleted member"; no name → "FitFlex member". */
export function customerName(c: { name?: string | null; forgotten?: boolean } | null | undefined, t: (k: MessageKey) => string) {
  if (c?.forgotten) return t('vendor.customers.deletedMember');
  return c?.name?.trim() || t('vendor.orders.buyerUnnamed');
}

/** An order's buyer as shown: deleted account → "Deleted member"; no name → "FitFlex member" (same rule as customers). */
export const buyerName = (order: Pick<VendorOrder, 'buyer'>, t: (k: MessageKey) => string) =>
  customerName({ name: order.buyer?.displayName ?? null, forgotten: order.buyer?.forgotten === true }, t);

/**
 * Tanzanian mobile number → +255XXXXXXXXX, as the server stores it (07…, 06…, 7…, 6…, 255…, +255…, with
 * spaces, dashes, dots or brackets). Anything else → null. The server checks again.
 */
export function normalisePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s\-().]/g, '');
  let local: string | null = null;
  if (/^\+255\d{9}$/.test(s)) local = s.slice(4);
  else if (/^255\d{9}$/.test(s)) local = s.slice(3);
  else if (/^0\d{9}$/.test(s)) local = s.slice(1);
  else if (/^\d{9}$/.test(s)) local = s;
  return local && /^[67]\d{8}$/.test(local) ? `+255${local}` : null;
}
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

/** Walk-in payment methods in the S3 order; one per customer payment. */
export const PAYMENT_METHODS = ['cash', 'mpesa', 'airtel_money', 'mixx', 'halopesa', 'card', 'bank', 'other'] as const;
/** Mobile money and bank need a transaction reference (S3 rule); card and other may have one; cash none. */
export const REFERENCE_REQUIRED = new Set(['mpesa', 'airtel_money', 'mixx', 'halopesa', 'bank']);

/** Client mirror of the server's oldest-due-first allocation: `open` is already oldest due first. */
export function allocateOldestFirst(open: readonly VendorCustomerOpenSale[], amount: number) {
  const out: Array<{ sale: VendorCustomerOpenSale; amountTzs: number }> = [];
  let left = amount;
  for (const sale of open) {
    if (left <= 0) break;
    const take = Math.min(left, sale.balanceTzs);
    if (take > 0) out.push({ sale, amountTzs: take });
    left -= take;
  }
  return out;
}

/**
 * Who may void a customer payment (the server decides; this only hides the button): the vendor account and
 * admin-role staff any payment; other staff only one they recorded, on the EAT day it was received.
 */
export function mayVoidPayment(
  payment: Pick<VendorCustomerPayment, 'status' | 'receivedOn' | 'recordedBy'>,
  who: { userId: string | null | undefined; userType: string | null | undefined; vendorRole: string | null | undefined },
  now = new Date(),
) {
  if (payment.status !== 'recorded') return false;
  if (who.userType === 'vendor' || who.vendorRole === 'admin') return true;
  return !!who.userId && payment.recordedBy?.id === who.userId && payment.receivedOn === eatToday(now);
}

/** "22 Oct 2026" / "22 Okt 2026" for a calendar day, as the app writes it on receipts. */
export function receiptDay(day: string | null | undefined, locale: Locale) {
  const [y, m, d] = String(day ?? '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${d} ${RECEIPT_MONTHS[locale === 'sw' ? 'sw' : 'en'][m - 1]} ${y}`;
}

/** Payment receipt (spec §7.2) in the language `t` speaks. Customer name only; voided payments are never shared. */
export function paymentReceiptText(
  payment: Pick<VendorCustomerPayment, 'number' | 'receivedOn' | 'method' | 'reference' | 'amountTzs' | 'allocations'>,
  opts: { business: string; customer: string; stillOwedTzs: number | null; locale: Locale; t: (k: MessageKey) => string; money: (n: number) => string },
) {
  const { t } = opts;
  const rule = '-'.repeat(20);
  const method = saleMethodLabel(payment.method, t);
  const out: string[] = [
    opts.business, fmt(t('vendor.pay.receiptTitle'), { number: payment.number }), receiptDay(payment.receivedOn, opts.locale),
    fmt(t('vendor.receipt.customer'), { name: opts.customer }), rule,
    receiptRow(payment.reference ? `${method} (${payment.reference})` : method, amountOnly(payment.amountTzs)),
  ];
  if (payment.allocations.length) {
    out.push(`${t('vendor.pay.paidTowards')}:`);
    for (const a of payment.allocations) out.push(receiptRow(a.saleNumber, amountOnly(a.amountTzs)));
  }
  out.push(rule);
  if (opts.stillOwedTzs != null) out.push(receiptRow(t('vendor.pay.stillOwed'), opts.money(opts.stillOwedTzs)));
  out.push(fmt(t('vendor.pos.receiptFooter'), { business: opts.business }), t('vendor.pos.notFiscal'));
  return out.join('\n');
}

/**
 * Customer statement (spec §7.3): open pay-later sales, recorded payments of the last 90 days, total owed and
 * the overdue aging line (zero buckets left out). Never phone, email or address.
 */
export function statementText(
  customer: Pick<VendorCustomerProfile, 'name' | 'forgotten' | 'owedTzs' | 'aging' | 'asOf' | 'openSales'>,
  payments: ReadonlyArray<Pick<VendorCustomerPayment, 'number' | 'receivedOn' | 'amountTzs' | 'status'>>,
  opts: { business: string; locale: Locale; t: (k: MessageKey) => string; money: (n: number) => string },
) {
  const { t, locale } = opts;
  const rule = '-'.repeat(20);
  const out: string[] = [
    opts.business, fmt(t('vendor.statement.title'), { name: customerName(customer, t) }), fmt(t('vendor.customers.asOf'), { date: receiptDay(customer.asOf, locale) }), rule,
  ];
  if (customer.openSales.length) {
    out.push(`${t('vendor.customers.openSales')}:`);
    for (const s of customer.openSales) {
      out.push(receiptRow(s.number, amountOnly(s.balanceTzs)));
      out.push(`  ${fmt(t('vendor.statement.soldOn'), { date: receiptDay(eatDayOf(s.soldAt), locale) })} · ${fmt(t('vendor.customers.dueOn'), { date: receiptDay(s.dueDate, locale) })}`);
      if (s.daysOverdue > 0) out.push(`  ${fmt(t('vendor.customers.daysOverdue'), { n: s.daysOverdue })}`);
    }
    out.push(rule);
  }
  const recorded = payments.filter(p => p.status === 'recorded');
  if (recorded.length) {
    out.push(`${t('vendor.statement.recentPayments')}:`);
    for (const p of recorded) out.push(receiptRow(`${p.number} ${receiptDay(p.receivedOn, locale)}`, amountOnly(p.amountTzs)));
    out.push(rule);
  }
  if (customer.owedTzs > 0) {
    out.push(receiptRow(t('vendor.statement.totalOwed'), opts.money(customer.owedTzs)));
    const overdue = AGING_BUCKETS.filter(b => b !== 'current' && customer.aging[b] > 0)
      .map(b => `${t(agingKey(b))} ${opts.money(customer.aging[b])}`);
    if (overdue.length) out.push(`${t('vendor.owed.overdue')}: ${overdue.join(' · ')}`);
  } else {
    out.push(t('vendor.statement.nothingOwed'));
  }
  out.push(t('vendor.pos.notFiscal'));
  return out.join('\n');
}

/** The products page's query string, remembered so stock history can go back to the same filters. */
export const PRODUCTS_QS_KEY = 'vendor.products.qs';

/** Why a partner can't be paid yet, as an i18n key in their own voice ("you have…"). */
export function payoutWhyKey(reason: string | null | undefined): MessageKey {
  if (reason === 'kyc_not_started' || reason === 'payout_account_not_verified' || reason === 'payout_account_cooling_off') return `payout.why.${reason}` as MessageKey;
  if (reason?.startsWith('kyc_')) return 'payout.why.kyc_other';
  return 'payout.why.other';
}
