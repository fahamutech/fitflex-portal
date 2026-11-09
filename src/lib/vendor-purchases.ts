// Vendor tools · S9: suppliers, receiving stock (GRN-000001…) and payables with instalments, for the portal.
// Design spec docs/design/vendor-purchases-s9.md (approved 2026-11-04); backend contract fitflex-functions#327.
// FitFlex moves no money for payables: these are records of what the vendor owes and says they paid.
// No strings here: every label is an i18n key.
import { API_BASE, ApiError, IDENTITY_V2_CLIENT, notifyUnauthorized, qs, request, type AgingBucket, type VendorTools } from '@/lib/api';
import type { Locale, MessageKey } from '@/lib/i18n';
import { addDays, eatDayOf, eatToday, fmt, receiptDay, saleMethodLabel } from '@/lib/vendor';

// ── Types (shapes from functions/vendor-purchases.mjs route descriptions) ──
export type PaymentState = 'paid' | 'part_paid' | 'unpaid';
export type InstalmentState = 'paid' | 'part_paid' | 'due' | 'overdue';
export type Person = { id: string; name: string | null };

export interface SupplierRow {
  id: string; name: string; phone: string | null; contactPerson: string | null;
  owedTzs: number; overdueTzs: number; nextDueDate: string | null; lastReceivedOn: string | null; archived: boolean;
}
export interface Supplier {
  id: string; name: string; phone: string | null; email: string | null; contactPerson: string | null;
  address: string | null; tin: string | null; note: string | null; archived?: boolean; archivedAt: string | null; createdAt: string; updatedAt: string;
}
export interface SupplierInput { name?: string; phone?: string | null; email?: string | null; contactPerson?: string | null; address?: string | null; tin?: string | null; note?: string | null }
export type Aging = Record<AgingBucket, number>;
export interface SupplierProfile {
  supplier: Supplier;
  totals: { purchasedTzs: number; purchaseCount: number; paidTzs: number; lastReceivedOn: string | null };
  owedTzs: number; overdueTzs: number; aging: Aging; asOf: string;
  openInstalments: Array<{ purchaseId: string; number: string; seq: number; dueDate: string; openTzs: number; daysOverdue: number }>;
}
export type SupplierFilter = 'active' | 'owing' | 'overdue' | 'archived';
export type SupplierSort = 'name' | 'owed' | 'recent';

export interface PurchaseLine {
  id: string; productId: string; variant: string | null; nameSnapshot: string; qty: number; unitCostTzs: number; lineTotalTzs: number;
  costUpdated: boolean; free: boolean; previousCostTzs?: number | null; costRestoredOnVoid: boolean | null;
}
export interface Instalment { id: string; seq: number; dueDate: string; amountTzs: number; coveredTzs: number; openTzs: number; state: InstalmentState; daysOverdue: number }
export interface PurchasePayment {
  id: string; amountTzs: number; paidOn: string; method: string; reference: string | null; note: string | null; atReceipt: boolean;
  recordedBy: Person | null; recordedAt: string; status: 'recorded' | 'voided';
  voidedBy: Person | null; voidedAt: string | null; voidReason: string | null; voidedWithPurchase: boolean;
}
export interface Purchase {
  id: string; number: string; status: 'received' | 'voided';
  supplier: { id: string; name: string; archived: boolean } | null;
  receivedOn: string; recordedAt: string; supplierInvoiceRef: string | null; note: string | null; createdBy: Person | null;
  totalTzs: number; paidTzs: number; balanceTzs: number; overdueTzs: number; paymentState: PaymentState;
  nextDue: { dueDate: string; openTzs: number; daysOverdue: number } | null;
  lines: PurchaseLine[]; instalments: Instalment[]; payments: PurchasePayment[];
  voidedBy: Person | null; voidedAt: string | null; voidReason: string | null;
}
export interface PurchaseRow {
  id: string; number: string; status: 'received' | 'voided'; receivedOn: string; recordedAt: string;
  supplier: { id: string; name: string } | null; totalTzs: number; paidTzs: number; balanceTzs: number; overdueTzs: number;
  paymentState: PaymentState; nextDueDate: string | null; lineCount: number; units: number; createdBy: Person | null;
}
export interface PurchasePage { purchases: PurchaseRow[]; nextCursor: string | null; summary: { count: number; totalTzs: number; paidTzs: number; balanceTzs: number; units: number } }
export interface PurchasesQuery {
  from?: string; to?: string; supplierId?: string; status?: 'received' | 'voided' | 'all'; payment?: 'open' | 'overdue' | 'paid' | 'all';
  createdBy?: 'me'; limit?: number; cursor?: string | null;
}
export interface ReceiveInput {
  clientRef: string; supplierId?: string; receivedOn?: string; supplierInvoiceRef?: string; note?: string;
  lines: Array<{ productId: string; variant?: string; qty: number; unitCostTzs: number }>;
  paidNow?: { amountTzs: number; method: string; reference?: string };
  dueDate?: string; schedule?: Array<{ dueDate: string; amountTzs: number }>;
}
export interface CostChange { productId: string; variant: string | null; name: string; fromTzs?: number | null; toTzs: number }
export interface LastCostRow { productId: string; variant: string | null; unitCostTzs: number; receivedOn: string; supplierName: string | null; number: string }
export interface PayablesRow {
  supplierId: string; name: string; owedTzs: number; overdueTzs: number; oldestDueDate: string | null; maxDaysOverdue: number;
  current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number;
}
export interface PayablesPage {
  asOf: string;
  totals: { owedTzs: number; overdueTzs: number; supplierCount: number; overdueSupplierCount: number; dueIn7DaysTzs: number } & Aging;
  rows: PayablesRow[]; nextCursor: string | null;
}
export type PayablesSort = 'overdue' | 'owed' | 'name';
export type CostKeptRow = { productId: string; variant: string | null; name: string };

const enc = encodeURIComponent;
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });

export const purchasesApi = {
  suppliers: (token: string, query: { q?: string; filter?: SupplierFilter; sort?: SupplierSort; limit?: number; cursor?: string | null } = {}) =>
    request<{ suppliers: SupplierRow[]; nextCursor: string | null }>(`/vendor/suppliers${qs({ ...query, limit: query.limit ?? 50 })}`, {}, token),
  createSupplier: (token: string, body: SupplierInput) => request<{ supplier: Supplier }>('/vendor/suppliers', post(body), token),
  supplier: (token: string, id: string) => request<SupplierProfile>(`/vendor/suppliers/${enc(id)}`, {}, token),
  updateSupplier: (token: string, id: string, body: SupplierInput & { archived?: boolean }) =>
    request<{ supplier: Supplier }>(`/vendor/suppliers/${enc(id)}`, put(body), token),
  /** 201 = received; 200 = the same clientRef answered again with the stored purchase (a replay looks like success). */
  receive: (token: string, body: ReceiveInput) => request<{ purchase: Purchase; costChanges: CostChange[] }>('/vendor/purchases', post(body), token),
  purchases: (token: string, query: PurchasesQuery = {}) =>
    request<PurchasePage>(`/vendor/purchases${qs({ ...query, limit: query.limit ?? 50 })}`, {}, token),
  purchase: (token: string, id: string) => request<{ purchase: Purchase }>(`/vendor/purchases/${enc(id)}`, {}, token),
  lastCosts: (token: string, productIds: string[]) =>
    request<{ rows: LastCostRow[] }>(`/vendor/purchases/last-costs${qs({ productIds: productIds.slice(0, 100).join(',') })}`, {}, token),
  voidPurchase: (token: string, id: string, reason: string) =>
    request<{ purchase: Purchase; costRestored: CostKeptRow[]; costKept: CostKeptRow[]; paymentsVoided: number }>(`/vendor/purchases/${enc(id)}/void`, post({ reason }), token),
  recordPayment: (token: string, id: string, body: { clientRef: string; amountTzs: number; paidOn?: string; method: string; reference?: string; note?: string }) =>
    request<{ purchase: Purchase; payment: PurchasePayment; covered: Array<{ seq: number; dueDate: string; amountTzs: number }> }>(`/vendor/purchases/${enc(id)}/payments`, post(body), token),
  voidPayment: (token: string, id: string, paymentId: string, reason: string) =>
    request<{ purchase: Purchase }>(`/vendor/purchases/${enc(id)}/payments/${enc(paymentId)}/void`, post({ reason }), token),
  changePlan: (token: string, id: string, schedule: Array<{ dueDate: string; amountTzs: number }>) =>
    request<{ purchase: Purchase }>(`/vendor/purchases/${enc(id)}/instalments`, put({ schedule }), token),
  payables: (token: string, query: { bucket?: AgingBucket | null; sort?: PayablesSort; limit?: number; cursor?: string | null } = {}) =>
    request<PayablesPage>(`/vendor/payables/aging${qs({ ...query, limit: query.limit ?? 50 })}`, {}, token),
  /** CSV of the purchase list (with its filters) or of the payables table, headers in `lang`. */
  csv: async (token: string, what: 'purchases' | 'payables', query: Record<string, unknown>, lang: Locale) => {
    const path = what === 'purchases' ? '/vendor/purchases' : '/vendor/payables/aging';
    const res = await fetch(`${API_BASE}${path}${qs({ ...query, cursor: undefined, limit: undefined, format: 'csv', lang })}`, {
      headers: { authorization: `Bearer ${token}`, 'x-fitflex-client': IDENTITY_V2_CLIENT },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 401) notifyUnauthorized();
      throw new ApiError(res.status, body);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? `${what}_${eatToday()}.csv`;
    return { blob: await res.blob(), fileName: name };
  },
};

// ── Gating (fails closed: missing or false = off) ──
/** The purchases tool is switched on (server: VENDOR_TOOLS + VENDOR_STOCK_LEDGER + VENDOR_PURCHASES). */
export const purchasesToolOn = (tools: VendorTools | null | undefined) => tools?.purchases === true;
/** This person may open purchases: tool on and the `purchases` permission. */
export const canPurchases = (me: { permissions?: string[]; tools?: VendorTools } | null | undefined) =>
  !!me && purchasesToolOn(me.tools) && !!me.permissions?.includes('purchases');

type Who = { userId: string | null | undefined; userType: string | null | undefined; vendorRole: string | null | undefined };
const voidsAny = (who: Who) => who.userType === 'vendor' || who.vendorRole === 'admin';
/**
 * The M2 rule (the server decides; this only hides the button): the vendor account and admin staff any purchase;
 * other `purchases` staff only one they recorded, on the EAT day they recorded it, and (security review on #327)
 * not when someone else recorded a payment on it.
 */
export function mayVoidPurchase(p: Pick<Purchase, 'status' | 'createdBy' | 'recordedAt' | 'payments'>, who: Who, now = new Date()) {
  if (p.status !== 'received') return false;
  if (voidsAny(who)) return true;
  if (!who.userId || p.createdBy?.id !== who.userId || eatDayOf(p.recordedAt) !== eatToday(now)) return false;
  return !p.payments.some(x => x.status === 'recorded' && x.recordedBy?.id && x.recordedBy.id !== who.userId);
}
export function mayVoidPurchasePayment(pay: Pick<PurchasePayment, 'status' | 'recordedBy' | 'recordedAt'>, who: Who, now = new Date()) {
  if (pay.status !== 'recorded') return false;
  if (voidsAny(who)) return true;
  return !!who.userId && pay.recordedBy?.id === who.userId && eatDayOf(pay.recordedAt) === eatToday(now);
}

// ── Money and plan maths (display only; the server computes every figure it stores) ──
export const MAX_QTY = 100_000;
export const MAX_UNIT_COST = 100_000_000;
export const MAX_TOTAL = 1_000_000_000;
export const MAX_INSTALMENTS = 12;
export const RECEIVED_BACK_DAYS = 30;
export const DUE_MAX_DAYS = 365;
export const DEFAULT_DUE_DAYS = 30;
export const MAX_INVOICE_REF = 60;
export const MAX_NOTE = 200;
export const REASON = { min: 3, max: 200 };

/** "YYYY-MM-DD" one calendar month later (31 Jan → 28/29 Feb). */
export function addMonths(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
/** Even split of `amount` into `n` instalments from `firstDue`, every 2 weeks or every month; the last takes the remainder. */
export function scheduleFor(amount: number, n: number, firstDue: string, every: '2w' | 'month') {
  const count = Math.max(1, Math.min(MAX_INSTALMENTS, Math.floor(n)));
  const each = Math.floor(amount / count);
  return Array.from({ length: count }, (_, i) => ({
    dueDate: every === 'month' ? addMonths(firstDue, i) : addDays(firstDue, 14 * i),
    amountTzs: i === count - 1 ? amount - each * (count - 1) : each,
  }));
}
/** Which open instalments a payment of `amount` covers, oldest due first (P-5; the plan is already in that order). */
export function coverPreview(instalments: readonly Instalment[], amount: number) {
  const out: Array<{ seq: number; dueDate: string; amountTzs: number; full: boolean }> = [];
  let left = amount;
  for (const i of instalments) {
    if (left <= 0) break;
    if (i.openTzs <= 0) continue;
    const take = Math.min(left, i.openTzs);
    out.push({ seq: i.seq, dueDate: i.dueDate, amountTzs: take, full: take === i.openTzs });
    left -= take;
  }
  return out;
}
export const paymentStateTone = (s: PaymentState, overdue: boolean) => (overdue ? 'warning' : s === 'paid' ? 'success' : s === 'part_paid' ? 'info' : 'gray') as 'warning' | 'success' | 'info' | 'gray';
export const paymentStateKey = (s: PaymentState, overdue: boolean) => `vendor.purchases.state.${overdue ? 'overdue' : s}` as MessageKey;

/** UAT L-1: the singular string (`<key>One`) when n is 1, else the plural; both exist in EN and SW. */
export const plural = (t: (k: MessageKey) => string, key: string, n: number) => t((n === 1 ? `${key}One` : key) as MessageKey);

/** An instalment's state in words (§4.5). */
export function instalmentText(i: Instalment, t: (k: MessageKey) => string, money: (n: number) => string, now = new Date()) {
  if (i.state === 'paid') return t('vendor.purchases.inst.paid');
  if (i.state === 'part_paid') return fmt(t('vendor.purchases.inst.part'), { covered: money(i.coveredTzs), amount: money(i.amountTzs) });
  if (i.state === 'overdue' || i.daysOverdue > 0) return fmt(plural(t, 'vendor.purchases.inst.overdue', i.daysOverdue), { n: i.daysOverdue });
  // The server's daysOverdue is never negative (0 when not due yet): count the days ahead from the due date (EAT).
  const days = Math.round((Date.parse(`${i.dueDate}T00:00:00Z`) - Date.parse(`${eatToday(now)}T00:00:00Z`)) / 86_400_000);
  return days <= 0 ? t('vendor.purchases.inst.dueToday') : fmt(plural(t, 'vendor.purchases.inst.dueIn', days), { n: days });
}

/** §8.6: an S9 refusal → its message key. `context` picks the receive-specific wording where the spec has two. The raw code is never shown. */
export function purchaseErrorKey(code: string | null, context: 'receive' | 'payment' | 'paymentVoid' | 'void' | 'plan' | 'supplier' = 'receive'): MessageKey {
  switch (code) {
    case 'product_not_found': case 'product_unavailable': case 'variant_not_found': return 'vendor.purchases.err.productGone';
    case 'supplier_archived': return 'vendor.purchases.err.supplierArchived';
    case 'supplier_required': return context === 'paymentVoid' ? 'vendor.purchases.err.noSupplierDebt' : 'vendor.purchases.needSupplier';
    case 'overpayment': return context === 'receive' ? 'vendor.purchases.err.overTotal' : 'vendor.purchases.err.overpayment';
    case 'nothing_owed': return 'vendor.purchases.err.nothingOwed';
    case 'insufficient_stock': return 'vendor.purchases.err.voidStock';
    case 'already_voided': return 'vendor.purchases.err.alreadyVoided';
    case 'purchase_voided': return 'vendor.purchases.err.purchaseVoided';
    case 'duplicate_supplier': return 'vendor.purchases.err.duplicateSupplier';
    case 'received_on_out_of_range': case 'due_date_out_of_range': case 'paid_on_out_of_range': return 'vendor.purchases.err.dateRange';
    case 'schedule_mismatch': return 'vendor.purchases.sumWrong';
    case 'reference_required': return 'vendor.pos.referenceRequired';
    case 'void_not_allowed': return 'vendor.purchases.askOwner';
    case 'supplier_has_balance': return 'vendor.suppliers.archiveOwes';
    case 'feature_disabled': return 'vendor.purchases.unavailable';
    case 'supplier_not_found': return 'vendor.suppliers.notFound';
    case 'purchase_not_found': case 'payment_not_found': return 'vendor.purchases.notFound';
    case 'reason_required': case 'reason_too_long': return 'vendor.purchases.voidReasonShort';
    case 'client_ref_reused': return 'vendor.purchases.err.refReused';
    default: return 'vendor.purchases.err.server';
  }
}
/** void_not_allowed has three reasons; has_others_payments (security review on #327) has its own words. */
export const voidRefusalKey = (reason: unknown): MessageKey => (reason === 'has_others_payments' ? 'vendor.purchases.err.hasOthersPayments' : 'vendor.purchases.askOwner');

// ── Text share (§6): never previous cost prices, the note or who recorded it ──
const W = 32;
const num = (n: number) => new Intl.NumberFormat('en-US').format(Number(n || 0));
const row = (label: string, amount: string) =>
  (label.length + 1 + amount.length > W ? `${label}\n${amount.padStart(W)}` : `${label}${' '.repeat(W - label.length - amount.length)}${amount}`);
export function purchaseText(p: Purchase, opts: { business: string; locale: Locale; t: (k: MessageKey) => string; money: (n: number) => string }) {
  const { t, locale } = opts;
  const rule = '-'.repeat(20);
  const out = [opts.business, fmt(t('vendor.purchases.grnTitle'), { number: p.number })];
  if (p.status === 'voided') out.push(t('vendor.purchases.state.voided'));
  if (p.supplier) out.push(fmt(t('vendor.purchases.textFrom'), { name: p.supplier.name }));
  out.push(fmt(t('vendor.purchases.receivedDate'), { date: receiptDay(p.receivedOn, locale) }));
  if (p.supplierInvoiceRef) out.push(fmt(t('vendor.purchases.invoiceLabel'), { ref: p.supplierInvoiceRef }));
  out.push(rule);
  for (const l of p.lines) {
    out.push(`${l.qty} x ${l.nameSnapshot}${l.variant ? ` (${l.variant})` : ''}`, row(`   @ ${num(l.unitCostTzs)}`, num(l.lineTotalTzs)));
  }
  out.push(rule, row(t('vendor.purchases.total'), opts.money(p.totalTzs)));
  for (const pay of p.payments.filter(x => x.status === 'recorded')) {
    out.push(row(`${t('vendor.purchases.paid')} (${saleMethodLabel(pay.method, t)})`, num(pay.amountTzs)));
  }
  if (p.status === 'received') {
    out.push(row(t('vendor.purchases.left'), num(p.balanceTzs)));
    for (const i of p.instalments.filter(x => x.openTzs > 0)) out.push(row(` ${receiptDay(i.dueDate, locale)}`, num(i.openTzs)));
  }
  out.push(rule, t('vendor.pos.notFiscal'));
  return out.join('\n');
}

// ── Receive stock draft (§4.9, Q-5): kept in this browser, per vendor and user; cleared on sign-out ──
const DRAFT_PREFIX = 'fitflex.vendor.purchaseDraft.';
export const draftKey = (vendorId: string, userId: string) => `${DRAFT_PREFIX}${vendorId}.${userId}`;
export function loadDraft<T>(key: string): (T & { savedAt: string }) | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveDraft(key: string, value: object) {
  try { localStorage.setItem(key, JSON.stringify({ ...value, savedAt: new Date().toISOString() })); } catch { /* storage full or blocked: the form still works */ }
}
export function clearDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
/** Sign-out: every receive-stock draft on this browser goes (it holds cost figures). */
export function clearAllPurchaseDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(DRAFT_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}
