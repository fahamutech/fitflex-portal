// Shop flash sales (Shop home Phase 2, slice 4; flag SHOP_FLASH_SALES on the server).
// Types and requests for the admin merch queue (/admin/shop-merch, kind flash_sale) and the vendor's own
// sales (/vendor/promotions?tab=sales), plus the price maths, labels and error text both screens share.
// Contract: fitflex-functions docs/shop-flash-sales-api.md. Spec: docs/design/shop-home-phase2.md §4, §8, §10.4, §10.9 (parent repo).
// No user-facing strings here: every label is an i18n key.
import { API_BASE, ApiError, qs, request } from './api';
import type { MessageKey } from './i18n';
import { isNetworkError, type AuditRow, type BannerEffectiveStatus, type BannerPhase, type BannerStatus, type MerchTab, type VendorGroup } from './shop-banners';

// ─── Contract ───────────────────────────────────────────────────────────────

export type SaleOrigin = 'vendor' | 'staff';
export type SaleAction = 'edit' | 'submit' | 'withdraw' | 'end' | 'approve' | 'reject';

/** The sale view (vendor and admin); the admin view adds the fields marked admin. */
export interface FlashSale {
  id: string;
  origin: SaleOrigin;
  vendorId: string;
  productId: string;
  productName?: string | null;
  productImage?: string | null;
  salePriceTzs: number;
  /** The product's priceTzs now. */
  regularPriceTzs: number;
  /** The product's standing discount now, or null. */
  discountPriceTzs?: number | null;
  /** priceTzs snapshot at approval; null until approved. */
  wasPriceTzs?: number | null;
  /** floor((regular − sale) × 100 / regular), regular = wasPriceTzs once approved. */
  discountPct?: number | null;
  savingTzs?: number | null;
  startsAt: string;
  endsAt: string;
  status: BannerStatus;
  effectiveStatus?: BannerEffectiveStatus;
  statusReason: string | null;
  statusReasonNote?: string | null;
  expiresAt?: string | null;
  revision?: number | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  decidedAt?: string | null;
  endedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Vendor view only. */
  endedByFitflex?: boolean;
  allowedActions?: SaleAction[];
  // Admin view
  vendorName?: string | null;
  sellerSuspended?: boolean;
  createdBy?: string | null; createdByName?: string | null;
  submittedBy?: string | null; submittedByName?: string | null;
  approvedBy?: string | null; approvedByName?: string | null;
  decidedBy?: string | null; decidedByName?: string | null;
  endedBy?: string | null; endedByName?: string | null;
  editedBy?: string[] | null;
  ownItem?: boolean;
  regularPriceTzsAtSubmit?: number | null;
  discountPriceTzsAtSubmit?: number | null;
  priceChangedSinceSubmit?: boolean;
}

export interface SaleInput { productId: string; salePriceTzs: number; startsAt: string; endsAt: string }
export type SalePatch = Partial<Omit<SaleInput, 'productId'>>;

export interface SaleRules { minDiscountPct: number; minLengthMs: number; maxLengthMs: number; minLeadMs: number; priceRaiseLookbackDays: number }
export type SaleList = { items: FlashSale[]; total?: number; nextCursor: number | string | null; counts?: Partial<Record<MerchTab, number>> | null };
export type VendorSaleList = SaleList & {
  vendor?: { canPropose: boolean; reason: string | null } | null;
  proposalExpiryDays?: number;
  openProposals?: { open: number; max: number } | null;
  rules?: SaleRules | null;
};
export type SaleLock = { saleId: string; startsAt: string; endsAt: string; effectiveStatus?: string };
/** GET /vendor/flash-sales/price-check. */
export interface PriceCheck {
  ok: boolean;
  productId: string;
  regularPriceTzs: number;
  discountPriceTzs: number | null;
  effectivePriceTzs: number;
  maxSalePriceTzs: number;
  raisedAt: string | null;
  /** Tanzania date YYYY-MM-DD. */
  raisedOn: string | null;
  earliestStart: string | null;
  lockedBy: SaleLock | null;
  /** Review 2026-10-29 (functions#285): a new or copied product needs 14 days of price history; when it was listed. */
  listedAt?: string | null;
}
export type PriceHistoryRow = { at: string; fromTzs: number | null; toTzs: number | null; field: 'priceTzs' | 'discountPriceTzs'; raised: boolean };
/** GET /admin/flash-sales/:id priceCheck. */
export interface AdminPriceCheck {
  passes14DayRule: boolean;
  raisedAt: string | null;
  raisedOn: string | null;
  earliestStart: string | null;
  priceHistory: PriceHistoryRow[];
  discountLine: { pct: number; savingTzs: number; sellerPays: boolean } | null;
  priceChangedSinceSubmit: boolean;
}

function listOf(body: unknown): SaleList & Record<string, unknown> {
  if (Array.isArray(body)) return { items: body as FlashSale[], nextCursor: null };
  const b = (body ?? {}) as Record<string, unknown>;
  return { ...b, items: (Array.isArray(b.items) ? b.items : []) as FlashSale[], nextCursor: (b.nextCursor as number | string | null) ?? null };
}
const oneOf = (body: unknown): FlashSale => ((body as { sale?: FlashSale } | null)?.sale ?? body) as FlashSale;
async function allPages<L extends SaleList>(fetchPage: (cursor?: number | string) => Promise<L>): Promise<L> {
  const first = await fetchPage();
  const items = [...first.items];
  let cursor = first.nextCursor;
  for (let i = 0; i < 9 && cursor != null; i += 1) {
    const next = await fetchPage(cursor);
    items.push(...next.items);
    cursor = next.nextCursor;
  }
  return { ...first, items, nextCursor: cursor };
}
const post = (body: unknown = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) });
const enc = encodeURIComponent;

export const salesApi = {
  // Admin: read with `promotions` or `promotions_approve`; create/edit/submit/withdraw FitFlex-created ones with
  // `promotions`; approve, reject, end with `promotions_approve` (never one's own for approve/reject).
  adminList: (token: string, f: { tab?: MerchTab; limit?: number } = {}) =>
    allPages(async cursor => listOf(await request<unknown>(`/admin/shop-merch${qs({ kind: 'flash_sale', tab: f.tab, limit: f.limit ?? 100, cursor })}`, {}, token))),
  adminProbe: async (token: string) => listOf(await request<unknown>(`/admin/shop-merch${qs({ kind: 'flash_sale', limit: 1 })}`, {}, token)),
  adminGet: async (token: string, id: string) => {
    const body = await request<{ sale: FlashSale; history?: AuditRow[]; priceCheck?: AdminPriceCheck | null }>(`/admin/flash-sales/${enc(id)}`, {}, token);
    return { sale: oneOf(body), history: Array.isArray(body?.history) ? body.history : [], priceCheck: body?.priceCheck ?? null };
  },
  adminCreate: async (token: string, body: SaleInput) => oneOf(await request<unknown>('/admin/flash-sales', post(body), token)),
  adminUpdate: async (token: string, id: string, body: SalePatch) => oneOf(await request<unknown>(`/admin/flash-sales/${enc(id)}`, patch(body), token)),
  adminSubmit: async (token: string, id: string) => oneOf(await request<unknown>(`/admin/flash-sales/${enc(id)}/submit`, post(), token)),
  adminWithdraw: async (token: string, id: string) => oneOf(await request<unknown>(`/admin/flash-sales/${enc(id)}/withdraw`, post(), token)),
  /** Names the revision reviewed (409 sale_changed when it moved). The checklist is shown, not sent (contract: `{ revision }`). */
  adminApprove: async (token: string, s: FlashSale) => oneOf(await request<unknown>(`/admin/flash-sales/${enc(s.id)}/approve`, post({ revision: s.revision }), token)),
  adminReject: async (token: string, s: FlashSale, code: SaleRejectCode, note: string) =>
    oneOf(await request<unknown>(`/admin/flash-sales/${enc(s.id)}/reject`, post({ revision: s.revision, code, ...(note.trim() ? { note: note.trim() } : {}) }), token)),
  adminEnd: async (token: string, id: string, note: string) => oneOf(await request<unknown>(`/admin/flash-sales/${enc(id)}/end`, post({ note }), token)),

  // Vendor, and vendor staff with `products` (404 feature_disabled while SHOP_FLASH_SALES is off).
  vendorList: (token: string) =>
    allPages(async cursor => listOf(await request<unknown>(`/vendor/flash-sales${qs({ limit: 100, cursor })}`, {}, token)) as VendorSaleList),
  vendorProbe: async (token: string) => listOf(await request<unknown>(`/vendor/flash-sales${qs({ limit: 1 })}`, {}, token)),
  vendorPriceCheck: (token: string, productId: string, startsAt?: string, signal?: AbortSignal) =>
    request<PriceCheck>(`/vendor/flash-sales/price-check${qs({ productId, startsAt })}`, { signal }, token),
  vendorCreate: async (token: string, body: SaleInput) => oneOf(await request<unknown>('/vendor/flash-sales', post(body), token)),
  vendorUpdate: async (token: string, id: string, body: SalePatch) => oneOf(await request<unknown>(`/vendor/flash-sales/${enc(id)}`, patch(body), token)),
  vendorSubmit: async (token: string, id: string) => oneOf(await request<unknown>(`/vendor/flash-sales/${enc(id)}/submit`, post(), token)),
  vendorWithdraw: async (token: string, id: string) => oneOf(await request<unknown>(`/vendor/flash-sales/${enc(id)}/withdraw`, post(), token)),
  vendorEnd: async (token: string, id: string) => oneOf(await request<unknown>(`/vendor/flash-sales/${enc(id)}/end`, post(), token)),
};

/** May this caller do it now? Only the server's allowedActions (fails closed when absent). */
export const saleCan = (s: FlashSale, a: SaleAction) => Array.isArray(s.allowedActions) && s.allowedActions.includes(a);

// ─── Price maths (the same rules as the server; the server re-checks everything) ──

export const MIN_DISCOUNT_PCT = 5;
export const HOUR_MS = 3_600_000;
export const DEFAULT_RULES: SaleRules = { minDiscountPct: 5, minLengthMs: HOUR_MS, maxLengthMs: 7 * 24 * HOUR_MS, minLeadMs: HOUR_MS, priceRaiseLookbackDays: 14 };

/** floor((regular − sale) × 100 / regular); null when it can't be worked out. */
export function discountPctOf(regular: number, sale: number): number | null {
  if (!(regular > 0) || !Number.isFinite(sale)) return null;
  return Math.floor(((regular - sale) * 100) / regular);
}
/** The most a sale may cost: floor(regular × (100 − min) / 100). */
export const maxSalePriceOf = (regular: number, minPct = MIN_DISCOUNT_PCT) => Math.floor((regular * (100 - minPct)) / 100);
/** The standing seller discount when it counts (0 < discount < price), else null. */
export const standingDiscountOf = (regular: number, discount: number | null | undefined) =>
  discount != null && discount > 0 && discount < regular ? discount : null;

export type SaleFieldError = { key: MessageKey; vars?: Record<string, string | number> };
export type SaleErrors = Partial<Record<'productId' | 'salePriceTzs' | 'startsAt' | 'endsAt', SaleFieldError>>;

/**
 * Field checks before sending (spec §8.3): a whole price ≥ 1; at least 5% off the regular price (no maximum);
 * below the standing discount; start at least an hour away (when it changed); 1 hour to 7 days long.
 * `money` formats amounts for the messages.
 */
export function validateSale(d: { productId: string; salePrice: string; startsAt: string; endsAt: string }, prices: { regular: number; discount: number | null } | null,
  money: (n: number) => string, opts: { now?: number; checkStart?: boolean; rules?: SaleRules } = {}): SaleErrors {
  const now = opts.now ?? Date.now();
  const rules = opts.rules ?? DEFAULT_RULES;
  const e: SaleErrors = {};
  if (!d.productId) e.productId = { key: 'merch.sale.pickProduct' };
  const raw = d.salePrice.replace(/[,\s]/g, '');
  const sale = Number(raw);
  if (!raw || !Number.isFinite(sale) || sale <= 0) e.salePriceTzs = { key: 'merch.sale.enterPrice' };
  else if (!Number.isInteger(sale)) e.salePriceTzs = { key: 'merch.sale.wholeNumber' };
  else if (prices) {
    const max = maxSalePriceOf(prices.regular, rules.minDiscountPct);
    const standing = standingDiscountOf(prices.regular, prices.discount);
    if (sale > max) e.salePriceTzs = { key: 'merch.sale.min5', vars: { max: money(max) } };
    else if (standing != null && sale >= standing) e.salePriceTzs = { key: 'merch.sale.belowDiscount', vars: { discount: money(standing) } };
  }
  const start = Date.parse(d.startsAt); const end = Date.parse(d.endsAt);
  if (!d.startsAt || !Number.isFinite(start)) e.startsAt = { key: 'merch.required' };
  else if (opts.checkStart !== false && start < now + rules.minLeadMs - 60_000) e.startsAt = { key: 'merch.dates.startSoon' };
  if (!d.endsAt || !Number.isFinite(end)) e.endsAt = { key: 'merch.required' };
  else if (Number.isFinite(start) && end <= start) e.endsAt = { key: 'merch.dates.endAfter' };
  else if (Number.isFinite(start) && (end - start < rules.minLengthMs || end - start > rules.maxLengthMs)) e.endsAt = { key: 'merch.sale.length' };
  return e;
}
/** The whole-TSh price typed into the field ("69,000" → 69000), or NaN. */
export const parsePrice = (text: string) => { const raw = text.replace(/[,\s]/g, ''); return raw ? Number(raw) : NaN; };

/** A product photo address: absolute as sent, root-relative ones are on the API server. */
export const productImageUrl = (src: string | null | undefined) => (!src ? null : src.startsWith('/') ? `${API_BASE}${src}` : src);

// ─── Labels (sale-only keys: Swahili agrees with "ofa", class N, not the banner's li-/ma- forms) ──

export const SALE_PHASE_KEY: Record<BannerPhase, MessageKey> = {
  draft: 'merch.sale.status.draft', pending: 'merch.status.pending', scheduled: 'merch.status.approved', live: 'merch.status.live', ended: 'merch.status.ended',
  rejected: 'merch.status.rejected', expired: 'merch.status.expired', withdrawn: 'merch.status.withdrawn',
};
export const SALE_GROUP_KEY: Record<VendorGroup, MessageKey> = {
  live: 'merch.sale.group.live', scheduled: 'merch.sale.group.scheduled', waiting: 'merch.sale.group.waiting', drafts: 'merch.sale.group.drafts', past: 'merch.sale.group.past',
};
export const SALE_HIST_KEY: Record<string, MessageKey> = {
  created: 'merchAdmin.sale.hist.created', updated: 'merchAdmin.sale.hist.updated', submitted: 'merchAdmin.sale.hist.submitted', approved: 'merchAdmin.sale.hist.approved',
  rejected: 'merchAdmin.hist.rejected', withdrawn: 'merchAdmin.sale.hist.withdrawn', ended: 'merchAdmin.sale.hist.ended', expired: 'merchAdmin.sale.hist.expired',
};

// ─── Reasons ────────────────────────────────────────────────────────────────

/** Admin reject reasons for sales (server: price_not_credible | product | timing | other). */
export const SALE_REJECT_CODES = ['price_not_credible', 'product', 'timing', 'other'] as const;
export type SaleRejectCode = typeof SALE_REJECT_CODES[number];
export const SALE_REJECT_KEY: Record<SaleRejectCode, MessageKey> = {
  price_not_credible: 'merchAdmin.saleReason.price', product: 'merchAdmin.saleReason.product', timing: 'merchAdmin.saleReason.timing', other: 'merchAdmin.saleReason.other',
};
/** The reason line in the reader's language: rejected → the code's label, then the note; ended by FitFlex → the note. */
export function saleReasonText(s: Pick<FlashSale, 'status' | 'effectiveStatus' | 'statusReason' | 'statusReasonNote'>, t: (k: MessageKey) => string): string {
  const code = s.statusReason ?? '';
  const note = (s.statusReasonNote ?? '').trim();
  const label = (s.effectiveStatus ?? s.status) === 'rejected' && code in SALE_REJECT_KEY ? t(SALE_REJECT_KEY[code as SaleRejectCode]) : '';
  return label && note ? `${label}: ${note}` : label || note;
}

// ─── Server refusals ────────────────────────────────────────────────────────

export type SaleErrorBody = {
  error?: string; field?: string; reason?: string;
  maxSalePriceTzs?: number; regularPriceTzs?: number; effectivePriceTzs?: number; discountPriceTzs?: number | null; minDiscountPct?: number;
  raisedAt?: string; raisedOn?: string; earliestStart?: string; listedAt?: string; fromTzs?: number; toTzs?: number;
  saleId?: string; startsAt?: string; endsAt?: string; effectiveStatus?: string;
  retryAfterSeconds?: number; open?: number; max?: number; revision?: number; regularPriceTzsAtSubmit?: number; currentStatus?: string;
};
export const saleErrorBody = (err: unknown): SaleErrorBody | null => (err instanceof ApiError ? ((err.body as SaleErrorBody | null) ?? null) : null);
export const saleErrorCode = (err: unknown): string | null => saleErrorBody(err)?.error ?? null;

/** A refusal in words, with the server's numbers filled in. */
export type SaleMessage = { key: MessageKey; vars: Record<string, string | number>; field?: keyof SaleErrors };

const PLAIN: Record<string, [MessageKey, (keyof SaleErrors)?]> = {
  cannot_approve_own_submission: ['merchAdmin.saleOwnWork'],
  sale_changed: ['merchAdmin.saleChanged'],
  revision_required: ['merchAdmin.saleChanged'],
  proposal_expired: ['merchAdmin.proposalExpired'],
  reason_code_required: ['merchAdmin.reasonRequired'],
  invalid_reason_code: ['merchAdmin.reasonRequired'],
  note_required: ['merchAdmin.noteRequired'],
  invalid_note: ['merchAdmin.noteTooLong'],
  end_before_start: ['merch.dates.endAfter', 'endsAt'],
  sale_length_out_of_range: ['merch.sale.length', 'endsAt'],
  product_not_found: ['merch.sale.productGone', 'productId'],
  not_your_product: ['merch.sale.notYourProduct', 'productId'],
  product_not_eligible: ['merch.sale.productNotEligible', 'productId'],
  product_not_editable: ['merch.sale.productFixed', 'productId'],
  invalid_field: ['merch.sale.enterPrice', 'salePriceTzs'],
  invalid_date: ['merch.required', 'startsAt'],
  not_editable: ['merch.sale.notEditable'],
  invalid_transition: ['merch.sale.notEditable'],
  sale_not_found: ['merch.notYours'],
  vendor_not_found: ['merch.sale.vendorNotFound'],
  vendor_suspended: ['merch.sale.suspended'],
  vendor_not_approved: ['merch.pendingBody'],
  feature_disabled: ['merch.unavailable'],
  vendor_permission_forbidden: ['merch.noPermission'],
  forbidden: ['merch.noPermission'],
  acl_forbidden: ['merch.noPermission'],
};

/** Refusals worded for staff (the seller's state, not "your account"). */
const ADMIN_PLAIN: Record<string, MessageKey> = {
  vendor_not_approved: 'merchAdmin.saleSellerNotApproved',
  vendor_suspended: 'merchAdmin.saleSellerSuspended',
  vendor_not_found: 'merchAdmin.saleSellerNotFound',
};

/** When a start date refusal says the earliest allowed start (14-day rule, short price history), else null. */
export function earliestStartOf(err: unknown): string | null {
  const b = saleErrorBody(err);
  return b && (b.error === 'price_raised_recently' || b.error === 'price_history_too_short') && b.earliestStart ? b.earliestStart : null;
}

/**
 * Every refusal the contract lists, worded with its numbers; anything unknown → `fallback`
 * (generic "Couldn't save. Try again."). `money` and `when`/`day` format amounts, times and Tanzania dates.
 * `audience: 'admin'` words the seller's state for staff ("This seller isn't approved").
 */
export function saleMessageOf(err: unknown, fmt: { money: (n: number) => string; when: (iso: string) => string; day: (ymd: string) => string },
  fallback: MessageKey = 'merch.saveFailed', audience: 'vendor' | 'admin' = 'vendor'): SaleMessage {
  if (isNetworkError(err)) return { key: 'merch.sale.notSentOffline', vars: {} };
  const b = saleErrorBody(err) ?? {};
  const code = b.error ?? '';
  if (audience === 'admin' && ADMIN_PLAIN[code]) return { key: ADMIN_PLAIN[code], vars: {} };
  switch (code) {
    case 'discount_out_of_range':
      if (b.reason === 'not_below_effective') return { key: 'merch.sale.belowDiscount', vars: { discount: fmt.money(b.effectivePriceTzs ?? b.discountPriceTzs ?? 0) }, field: 'salePriceTzs' };
      return { key: 'merch.sale.min5', vars: { max: fmt.money(b.maxSalePriceTzs ?? 0) }, field: 'salePriceTzs' };
    case 'price_raised_recently':
      return { key: 'merch.sale.raised', vars: { date: b.raisedOn ? fmt.day(b.raisedOn) : fmt.when(b.raisedAt ?? ''), earliest: fmt.when(b.earliestStart ?? '') }, field: 'startsAt' };
    case 'price_history_too_short':
      return { key: b.listedAt ? 'merch.sale.historyShort' : 'merch.sale.historyShortNoDate', vars: { listed: fmt.when(b.listedAt ?? ''), earliest: fmt.when(b.earliestStart ?? '') }, field: 'startsAt' };
    case 'sale_overlap':
      // Without its dates the clash is still named, just not when.
      return b.startsAt && b.endsAt
        ? { key: 'merch.sale.overlap', vars: { start: fmt.when(b.startsAt), end: fmt.when(b.endsAt) }, field: 'startsAt' }
        : { key: 'merch.sale.overlapNoDates', vars: {}, field: 'startsAt' };
    case 'sale_conflict':
      return { key: 'vendor.priceLocked', vars: { start: fmt.when(b.startsAt ?? ''), end: fmt.when(b.endsAt ?? '') } };
    case 'start_too_soon':
      return { key: b.earliestStart ? 'merch.sale.startFrom' : 'merch.dates.startSoon', vars: { earliest: fmt.when(b.earliestStart ?? '') }, field: 'startsAt' };
    case 'rate_limited':
      if (!b.retryAfterSeconds) return { key: 'merch.rateLimited', vars: {} };
      { const n = Math.max(1, Math.ceil(b.retryAfterSeconds)); return n === 1 ? { key: 'merch.sale.rateLimitedOne', vars: {} } : { key: 'merch.sale.rateLimited', vars: { n } }; }
    case 'too_many_open_proposals':
      return { key: 'merch.sale.tooManyOpen', vars: { open: b.open ?? '—', max: b.max ?? '—' } };
    default: {
      if (code === 'sale_changed' && b.reason === 'product_price_changed') return { key: 'merchAdmin.priceMoved', vars: {} };
      const hit = PLAIN[code];
      return hit ? { key: hit[0], vars: {}, field: hit[1] } : { key: fallback, vars: {} };
    }
  }
}
