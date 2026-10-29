// Vendor reports (vendor business tools S6; spec docs/design/vendor-reports-s6.md, decided 2026-10-22).
// Contract: fitflex-functions #275 (functions/vendor-reports.mjs, src/services/vendor-report-service.mjs).
// Read only. The server computes every figure; the portal never sums pages. Cost, profit and margin keys are
// ABSENT (not null) for people who may not see cost: every optional field below is typed optional, and the UI
// hides the section rather than showing 0. No strings here: every label is an i18n key.
import { API_BASE, ApiError, IDENTITY_V2_CLIENT, notifyUnauthorized, qs, request, type VendorTools } from '@/lib/api';
import type { Locale, MessageKey } from '@/lib/i18n';
import { addDays, eatToday, RECEIPT_MONTHS, swDayPeriod } from '@/lib/vendor';

// ── Views, sections, query ──

export type ReportView = 'overview' | 'sales' | 'products' | 'stock' | 'profit' | 'payouts' | 'customers' | 'methods';
export const REPORT_VIEWS: readonly ReportView[] = ['overview', 'sales', 'products', 'stock', 'profit', 'payouts', 'customers', 'methods'];
export type ReportSection = 'summary' | 'sales' | 'products' | 'stock-value' | 'profit' | 'marketplace-net' | 'customers' | 'payment-methods';
export const SECTION_OF: Record<ReportView, ReportSection> = {
  overview: 'summary', sales: 'sales', products: 'products', stock: 'stock-value', profit: 'profit',
  payouts: 'marketplace-net', customers: 'customers', methods: 'payment-methods',
};
export const viewKey = (view: ReportView) => `vendor.reports.view.${view}` as MessageKey;

export type ReportChannel = 'all' | 'app' | 'walk_in';
export const CHANNELS: readonly ReportChannel[] = ['all', 'app', 'walk_in'];
export const channelKey = (c: ReportChannel) => (c === 'walk_in' ? 'vendor.reports.channel.walkIn' : `vendor.reports.channel.${c}`) as MessageKey;
export type ReportGroupBy = 'day' | 'week' | 'month';
export const GROUP_BYS: readonly ReportGroupBy[] = ['day', 'week', 'month'];
export type ProductSort = 'revenue' | 'units' | 'slow';
export const PRODUCT_SORTS: readonly ProductSort[] = ['revenue', 'units', 'slow'];

/** Channel is ignored by these (the header says "All channels" / "App only" instead). */
export const NO_CHANNEL = new Set<ReportView>(['stock', 'payouts', 'customers']);
/** Grouping applies to these only. */
export const GROUPED = new Set<ReportView>(['overview', 'sales', 'profit']);

export const REPORT_LIMITS = { maxDays: 366, maxBuckets: 120 } as const;

// ── Shapes (exactly as #275 answers) ──

export interface ReportHead {
  from: string;
  to: string;
  channel: ReportChannel;
  groupBy?: ReportGroupBy;
  generatedAt: string;
  timezone: string;
  inProgress: boolean;
  channels: { app: boolean; walkIn: boolean };
  /** UAT D2 (backend adding it; name to be confirmed): false = this vendor has never sold. Absent = unknown. */
  hasEverSold?: boolean;
}
export interface Voided { count: number; totalTzs: number }
export interface ChannelTotals { grossTzs: number; discountTzs: number; refundTzs: number; netTzs: number; vatIncludedTzs: number; count: number; itemsSold: number }
export interface SalesTotals {
  grossTzs: number; discountTzs: number; refundTzs: number; netTzs: number; vatIncludedTzs: number;
  saleCount: number; orderCount: number; itemsSold: number; voided: Voided;
}
export interface MethodYou { method: string; amountTzs: number; count: number; sharePct: number }
export interface MethodFitFlex { paymentMethod: string; amountTzs: number; count: number; sharePct: number }
export interface TopProduct { productId: string; variant: string | null; name: string | null; removed: boolean; unitsSold: number; netRevenueTzs: number }

export interface SummaryReport extends ReportHead {
  sales: SalesTotals & { buckets: Array<{ start: string; end: string; netTzs: number }> };
  topProducts: TopProduct[];
  slowCount: number;
  methods: { byYou: MethodYou[]; viaFitFlex: MethodFitFlex[] };
  stock?: { atRetailTzs: number; units: number; atCostTzs?: number; costUnknownCount?: number };
  profit?: { profitTzs: number; marginPct: number | null; netExVatTzs: number; commissionTzs: number; costTzs: number; uncosted: { qty: number; revenueTzs: number } };
  payouts?: { grossTzs: number; commissionTzs: number; payoutTzs: number; paidOutTzs: number; waitingTzs: number; notDeliveredTzs: number };
  customers?: { owedTzs: number; overdueTzs: number; collectedTzs: number };
}
export interface SalesReport extends ReportHead {
  totals: SalesTotals;
  byChannel: { app: ChannelTotals; walkIn: ChannelTotals };
  buckets: Array<{ start: string; end: string; netTzs: number; app: ChannelTotals; walkIn: ChannelTotals }>;
}
export type CoverState = 'ok' | 'soon' | 'none' | 'out' | 'untracked';
export interface ProductRow {
  productId: string; variant: string | null; name: string | null; removed: boolean;
  unitsSold: number; appUnits: number; walkInUnits: number; netRevenueTzs: number;
  lastSoldAt: string | null; stock: number | null; avgDailyUnits30: number; daysOfCover: number | null; coverState: CoverState;
  noSalesInPeriod: boolean;
  /** canSeeCost only. null = no cost price (UAT D1; the backend is moving from 0 to null). */
  profitTzs?: number | null;
}
export interface ProductsReport extends ReportHead {
  sort: ProductSort;
  rows: ProductRow[];
  totals: { unitsSold: number; netRevenueTzs: number };
  slowCount: number;
  nextCursor: string | null;
}
export interface StockRow {
  productId: string; variant: string | null; name: string | null; stock: number; priceTzs: number; valueAtRetailTzs: number;
  costTzs?: number | null; valueAtCostTzs?: number | null;
}
export interface StockReport extends ReportHead {
  asOf: string;
  totals: { atRetailTzs: number; units: number; products: number; atCostTzs?: number };
  costUnknown?: { count: number; units: number; retailTzs: number };
  rows: StockRow[];
}
export interface ProfitFigures { netExVatTzs: number; commissionTzs: number; costTzs: number; profitTzs: number; marginPct: number | null }
export interface ProfitReport extends ReportHead {
  totals: ProfitFigures;
  uncosted: { lineCount: number; qty: number; revenueTzs: number; netExVatTzs: number };
  hasVat: boolean;
  buckets: Array<ProfitFigures & { start: string; end: string; uncostedRevenueTzs: number }>;
  byChannel: { app: ProfitFigures; walkIn: ProfitFigures };
  byProduct: Array<Omit<ProfitFigures, 'profitTzs' | 'costTzs'> & {
    productId: string; variant: string | null; name: string | null; removed: boolean; units: number;
    profitTzs: number | null; costTzs?: number | null;
  }>;
  uncostedProducts: Array<{ productId: string; variant: string | null; name: string | null; removed: boolean; units: number; revenueTzs: number }>;
}
export interface PayoutState { orders: number; grossTzs: number; commissionTzs: number; payoutTzs: number }
export interface PayoutsReport extends ReportHead {
  basis: 'delivered';
  totals: { orderCount: number; grossTzs: number; commissionTzs: number; payoutTzs: number };
  status: { notDelivered: PayoutState; waiting: PayoutState; paidOut: PayoutState };
  weeks: Array<{
    periodStartDate: string; periodEndDate: string; orderCount: number; grossTzs: number; commissionTzs: number; payoutTzs: number;
    paidOut: boolean; statement: { id: string; status: string; finalNetTzs: number } | null;
  }>;
}
export interface CustomersReport extends ReportHead {
  asOf: string;
  owedTzs: number;
  overdueTzs: number;
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number };
  creditSales: { count: number; totalTzs: number };
  collectedTzs: number;
  buyers: { shop: number; app: number };
}
export interface MethodsReport extends ReportHead { byYou: MethodYou[]; viaFitFlex: MethodFitFlex[] }

export type ReportOf = {
  overview: SummaryReport; sales: SalesReport; products: ProductsReport; stock: StockReport; profit: ProfitReport;
  payouts: PayoutsReport; customers: CustomersReport; methods: MethodsReport;
};

// ── Access (spec §0.1, §0.2; all fail closed) ──

export interface ReportAccess {
  /** tools.reports === true and the `reports` permission. */
  open: boolean;
  cost: boolean;
  payout: boolean;
  customers: boolean;
  stock: boolean;
  views: ReportView[];
}
export function reportAccess(me: { permissions?: string[]; tools?: VendorTools } | null | undefined): ReportAccess {
  const tools = me?.tools;
  const perms = me?.permissions ?? [];
  const open = !!me && tools?.reports === true && perms.includes('reports');
  const cost = open && tools?.canSeeCost === true;
  const payout = open && tools?.canSeeOrderMoney === true;
  const customers = open && tools?.customers === true && perms.includes('customers');
  const stock = open && tools?.stockLedger === true;
  const views = !open ? [] : REPORT_VIEWS.filter(v =>
    (v !== 'stock' || stock) && (v !== 'profit' || cost) && (v !== 'payouts' || payout) && (v !== 'customers' || customers));
  return { open, cost, payout, customers, stock, views };
}

// ── Periods, EAT calendar days (spec §3; server owns the bucketing, this mirrors it for the controls) ──

export type ReportPreset = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'custom';
export const PRESETS: readonly ReportPreset[] = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'custom'];
export const presetKey = (p: ReportPreset) => `vendor.reports.preset.${p}` as MessageKey;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: string | null | undefined): v is string =>
  !!v && DAY_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000) + 1;
/** Monday of the EAT week of `day`. */
export const weekStart = (day: string) => addDays(day, -((new Date(dayMs(day)).getUTCDay() + 6) % 7));
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const monthEnd = (day: string) => {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export function presetRange(preset: Exclude<ReportPreset, 'custom'>, today = eatToday()): { from: string; to: string } {
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'thisWeek': return { from: weekStart(today), to: today };
    case 'lastWeek': { const s = addDays(weekStart(today), -7); return { from: s, to: addDays(s, 6) }; }
    case 'thisMonth': return { from: monthStart(today), to: today };
    case 'lastMonth': { const end = addDays(monthStart(today), -1); return { from: monthStart(end), to: end }; }
  }
}
/** Which preset a range is, else custom. */
export function presetOf(from: string, to: string, today = eatToday()): ReportPreset {
  for (const p of PRESETS) {
    if (p === 'custom') continue;
    const r = presetRange(p, today);
    if (r.from === from && r.to === to) return p;
  }
  return 'custom';
}
/** The server's auto grouping: ≤31 days by day, ≤26 weeks by week, else by month. */
export const autoGroupBy = (from: string, to: string): ReportGroupBy => {
  const days = daysBetween(from, to);
  return days <= 31 ? 'day' : days <= 182 ? 'week' : 'month';
};
export function bucketCount(from: string, to: string, groupBy: ReportGroupBy) {
  let n = 0;
  for (let key = groupBy === 'week' ? weekStart(from) : groupBy === 'month' ? monthStart(from) : from; key <= to; n += 1) {
    const end = groupBy === 'week' ? addDays(key, 6) : groupBy === 'month' ? monthEnd(key) : key;
    key = addDays(end, 1);
  }
  return n;
}
export type RangeProblem = 'invalid' | 'future' | 'toBeforeFrom' | 'tooLong';
export function rangeProblem(from: string | null | undefined, to: string | null | undefined, today = eatToday()): RangeProblem | null {
  if (!isDay(from) || !isDay(to)) return 'invalid';
  if (to > today) return 'future';
  if (to < from) return 'toBeforeFrom';
  if (daysBetween(from, to) > REPORT_LIMITS.maxDays) return 'tooLong';
  return null;
}
export const rangeProblemKey = (p: RangeProblem): MessageKey =>
  p === 'tooLong' ? 'vendor.reports.rangeTooLong' : p === 'future' ? 'vendor.reports.rangeFuture' : p === 'toBeforeFrom' ? 'vendor.reports.rangeOrder' : 'vendor.reports.rangeInvalid';

// ── Words for dates and times (EAT; 12-hour clock plus the day part, glossary 2026-10-20) ──

const monthName = (locale: Locale, m: number) => RECEIPT_MONTHS[locale === 'sw' ? 'sw' : 'en'][m - 1];
const parts = (day: string) => day.slice(0, 10).split('-').map(Number) as [number, number, number];

/** "14 Oct 2026". */
export function dayWords(day: string | null | undefined, locale: Locale) {
  if (!isDay(day?.slice(0, 10))) return '—';
  const [y, m, d] = parts(day!);
  return `${d} ${monthName(locale, m)} ${y}`;
}
/** "14 Oct" (no year). */
export function dayShort(day: string | null | undefined, locale: Locale) {
  if (!isDay(day?.slice(0, 10))) return '—';
  const [, m, d] = parts(day!);
  return `${d} ${monthName(locale, m)}`;
}
/** "1–31 Oct 2026", "28 Sep – 4 Oct 2026", "14 Oct 2026". */
export function periodWords(from: string, to: string, locale: Locale) {
  if (!isDay(from) || !isDay(to)) return '—';
  if (from === to) return dayWords(from, locale);
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${monthName(locale, m2)} ${y2}`;
  if (y1 === y2) return `${d1} ${monthName(locale, m1)} – ${d2} ${monthName(locale, m2)} ${y2}`;
  return `${dayWords(from, locale)} – ${dayWords(to, locale)}`;
}
/** A bucket's label: a day "14 Oct", a week "13–19 Oct", a month "Oct 2026". */
export function bucketWords(start: string, end: string, groupBy: ReportGroupBy | undefined, locale: Locale) {
  if (groupBy === 'month') { const [y, m] = parts(start); return `${monthName(locale, m)} ${y}`; }
  if (start === end) return dayShort(start, locale);
  const [, m1, d1] = parts(start);
  const [, m2, d2] = parts(end);
  return m1 === m2 ? `${d1}–${d2} ${monthName(locale, m2)}` : `${d1} ${monthName(locale, m1)} – ${d2} ${monthName(locale, m2)}`;
}
/**
 * The time of day in EAT, as the rest of the portal and the report PDF write it: English 24-hour "14:05";
 * Swahili 12-hour with the part of the day "2:05 mchana" (glossary 2026-10-20).
 */
export function reportClock(iso: string | null | undefined, locale: Locale) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms + 3 * 3_600_000); // EAT has no DST: read the UTC fields of the shifted time.
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return locale === 'sw' ? `${h % 12 === 0 ? 12 : h % 12}:${mm} ${swDayPeriod(h)}` : `${String(h).padStart(2, '0')}:${mm}`;
}

/** Days of cover in words (spec §6, Q-9): the server's coverState and daysOfCover, never recomputed here. */
export function coverText(row: Pick<ProductRow, 'coverState' | 'daysOfCover'>, t: (k: MessageKey) => string) {
  switch (row.coverState) {
    case 'untracked': return '—';
    case 'out': return t('vendor.reports.outOfStock');
    case 'none': return t('vendor.reports.coverNoSales');
    default: {
      const n = row.daysOfCover ?? 0;
      if (n < 1) return t('vendor.reports.coverUnderOne');
      return n === 1 ? t('vendor.reports.coverOneDay') : t('vendor.reports.coverDays').replace('{n}', String(n));
    }
  }
}

// ── API ──

export interface ReportQuery {
  from?: string; to?: string; channel?: ReportChannel; groupBy?: ReportGroupBy;
  sort?: ProductSort; q?: string; limit?: number; cursor?: string | null;
}
/** What each section takes (stock value: no period; App sales after commission and customers: no channel). */
export function queryFor(view: ReportView, q: ReportQuery): ReportQuery {
  if (view === 'stock') return {};
  const base: ReportQuery = { from: q.from, to: q.to };
  if (!NO_CHANNEL.has(view) && q.channel && q.channel !== 'all') base.channel = q.channel;
  if (GROUPED.has(view) && q.groupBy) base.groupBy = q.groupBy;
  if (view === 'products') Object.assign(base, { sort: q.sort, q: q.q || undefined, limit: q.limit, cursor: q.cursor || undefined });
  return base;
}

/** The server's slug (functions src/shared/vendor-documents.mjs slug()). */
const slug = (text: string | null | undefined) =>
  String(text || 'document').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'document';
/**
 * The server's file name (src/shared/vendor-reports.mjs reportFileName): {business-slug}_{section}_{from}_{to}.{ext},
 * one date when from = to; the summary PDF is "report"; stock value is dated today. Used when the browser cannot read
 * Content-Disposition (cross-origin, the header is not exposed).
 */
export function reportFileName(name: string | null | undefined, view: ReportView, from: string | undefined, to: string | undefined, today = eatToday()) {
  const section = view === 'overview' ? 'report' : SECTION_OF[view];
  const ext = view === 'overview' ? 'pdf' : 'csv';
  const [a, b] = view === 'stock' ? [today, null] : [from ?? '', to ?? null];
  return `${slug(name || 'vendor')}_${section}_${a}${b && b !== a ? `_${b}` : ''}.${ext}`;
}

export const reportsApi = {
  get: <V extends ReportView>(token: string, view: V, query: ReportQuery, signal?: AbortSignal) =>
    request<ReportOf[V]>(`/vendor/reports/${SECTION_OF[view]}${qs(queryFor(view, query))}`, { signal }, token),
  /** CSV of a section, or the summary as PDF (overview). → the file and the server's file name. */
  file: async (token: string, view: ReportView, query: ReportQuery, lang: Locale, fileBaseName?: string | null) => {
    const format = view === 'overview' ? 'pdf' : 'csv';
    const q = { ...queryFor(view, { ...query, cursor: null, limit: undefined }), format, lang };
    const res = await fetch(`${API_BASE}/vendor/reports/${SECTION_OF[view]}${qs(q)}`, {
      headers: { authorization: `Bearer ${token}`, 'x-fitflex-client': IDENTITY_V2_CLIENT },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 401) notifyUnauthorized();
      throw new ApiError(res.status, body);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? reportFileName(fileBaseName, view, query.from, query.to);
    return { blob: await res.blob(), fileName: name };
  },
};
