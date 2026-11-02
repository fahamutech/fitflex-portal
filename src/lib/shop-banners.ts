// Shop banners (Shop home Phase 2, slice 1; flag SHOP_BANNERS on the server).
// Types and requests for the admin merch queue (/admin/shop-merch) and the vendor's own
// banners (/vendor/promotions), plus the labels, tabs, checks and error text both screens share.
// Spec: docs/design/shop-home-phase2.md §4, §5, §10 (parent repo). No user-facing strings here: every label is an i18n key.
import { API_BASE, ApiError, IDENTITY_V2_CLIENT, notifyUnauthorized, qs, request } from './api';
import type { BadgeTone } from './admin-utils';
import { messages, type MessageKey } from './i18n';

// ─── Contract ───────────────────────────────────────────────────────────────

/** Text in both languages. Every banner text field is required in both (owner 2026-10-20), except the subline. */
export type Bilingual = { en: string; sw: string };
export type BannerOrigin = 'vendor' | 'staff';
export type BannerStatus = 'draft' | 'pending_approval' | 'approved' | 'ended' | 'rejected' | 'withdrawn' | 'expired';
/** The stored status as clients see it: approved → live inside its window; time-lapsed states applied. */
export type BannerEffectiveStatus = BannerStatus | 'live';
export type BannerTargetType = 'product' | 'vendor_store' | 'category' | 'results';
/** results: value is the Results query ({ search?, category?, brand?, vendorId?, … }); the others: an id or key. */
export type BannerTarget = { type: BannerTargetType; value: string | Record<string, string | boolean> | null };
export type BannerAction = 'edit' | 'image' | 'submit' | 'withdraw' | 'end' | 'approve' | 'reject' | 'position';

/** Public copies exist only after approval; before that the photo is private (previewUrl, fetched with the token). */
export interface BannerImage {
  id?: string;
  uploadedBy?: string | null;
  uploadedByName?: string | null;
  confirmationVersion?: string | null;
  /** Model release reference (required with product_models). */
  consentRef?: string | null;
  licenceRef?: string | null;
  width?: number;
  height?: number;
  people?: BannerPeople | null;
  focal?: { x: number; y: number } | null;
  rightsConfirmedAt?: string | null;
  peopleConfirmedAt?: string | null;
  rightsConfirmedBy?: string | null;
  rightsConfirmedByName?: string | null;
  peopleConfirmedBy?: string | null;
  peopleConfirmedByName?: string | null;
  /** Root-relative and authenticated (e.g. /admin/shop-banners/<id>/image); ?w=240|480|960. */
  previewUrl?: string | null;
  public?: { url1x?: string | null; url2x?: string | null; urlWide?: string | null } | null;
  // The brief's flat shape (image{url1x,url2x,urlWide}); accepted too.
  url1x?: string | null;
  url2x?: string | null;
  urlWide?: string | null;
}

export interface ShopBanner {
  id: string;
  origin: BannerOrigin;
  vendorId: string | null;
  vendorName?: string | null;
  sellerSuspended?: boolean;
  image: BannerImage | null;
  imageAlt: Bilingual | null;
  headlineLead: Bilingual | null;
  headlineAccent: Bilingual | null;
  subline: Bilingual | null;
  ctaLabel: Bilingual | null;
  target: BannerTarget | null;
  targetName?: string | null;
  audienceRoles: string[];
  startsAt: string;
  endsAt: string;
  position: number | null;
  status: BannerStatus;
  effectiveStatus?: BannerEffectiveStatus;
  /** A code (revision 2): image|people|text|claim|link|other (rejected), window_passed|ended_by_vendor|ended_by_fitflex (ended), not_reviewed_in_time|start_passed (expired). */
  statusReason: string | null;
  /** The text FitFlex wrote (reject note, end note). statusReason is the code (revision 2). */
  statusReasonNote?: string | null;
  /** Fixed button label key (DD-P2-1), when the server sends it. */
  ctaKey?: string | null;
  /** The revision the reviewer is looking at (sent back on approve/reject; 409 banner_changed if it moved). */
  revision?: number | string | null;
  updatedAt?: string | null;
  /** People who changed the banner or uploaded its photo (H1: they can't decide on it either), when the server sends them. */
  editedBy?: string[] | null;
  /** Vendor view: FitFlex ended it (statusReason is then FitFlex's reason). */
  endedByFitflex?: boolean;
  createdBy?: string | null;
  createdByName?: string | null;
  submittedBy?: string | null;
  submittedByName?: string | null;
  approvedBy?: string | null;
  approvedByName?: string | null;
  endedByName?: string | null;
  /** Admin view: this admin created or sent it (cannot approve or reject it). */
  ownItem?: boolean;
  /** What this caller may do now, decided by the server. */
  allowedActions?: BannerAction[];
  createdAt?: string | null;
  submittedAt?: string | null;
  /** When it actually ended (early or at its end); the "Ended {date}" line uses this, not endsAt (QA1 #3). */
  endedAt?: string | null;
  expiresAt?: string | null;
}

/** What a create or edit sends (every key is a known field: the server refuses unknown ones). The image goes separately. */
export interface BannerInput {
  imageAlt: Bilingual;
  headlineLead: Bilingual;
  headlineAccent: Bilingual;
  subline: Bilingual | null;
  /** The fixed button label (DD-P2-1); vendors and staff pick from the list, never free text (422 cta_label_not_allowed). */
  ctaKey: WireCtaKey;
  target: BannerTarget;
  audienceRoles: string[];
  startsAt: string;
  endsAt: string;
}

/** Who is in the photo, as the uploader declares it (owner Q-2: models allowed in product shots). */
export type BannerPeople = 'none' | 'product_models';
export interface BannerImageFields {
  people: BannerPeople;
  /** "I have the right to use this image …" — always required. */
  rightsConfirmed: boolean;
  /** "The people are models … never presented as FitFlex members, trainers or partners" — required with models. */
  peopleConfirmed: boolean;
  /** The confirmation texts' version the uploader accepted (list response `confirmation.version`). */
  confirmationVersion: string;
  /** Model release reference; required with product_models (≤ 200). */
  consentRef?: string;
  /** Optional licence note, e.g. "own shoot" (≤ 200). */
  licenceRef?: string;
}
/** The rights and models texts the uploader accepts, as the server sends them (show exactly as sent). */
export type BannerConfirmation = {
  version: string;
  /** draft_pending_counsel: draft wording pending Tanzanian counsel and Swahili native review. */
  status?: string | null;
  rights: Bilingual;
  models: Bilingual;
};
export const REF_MAX = 200;

/** Audience roles a banner can be shown to (spec §5.2.3 field 8). */
export const AUDIENCE_ROLES = ['member', 'trainer', 'owner'] as const;
export const AUDIENCE_KEY: Record<string, MessageKey> = {
  member: 'merch.audience.member', trainer: 'merch.audience.trainer', owner: 'merch.audience.owner',
};
/** Admin approve checklist (server REVIEW_CHECKS). */
export const REVIEW_CHECKS = ['people', 'text', 'languages'] as const;
/** Admin reject reasons (server REJECT_CODES). */
export const REJECT_CODES = ['image', 'people', 'text', 'claim', 'link', 'other'] as const;
export type RejectCode = typeof REJECT_CODES[number];

export type BannerList = { items: ShopBanner[]; nextCursor: number | string | null; counts?: Partial<Record<MerchTab | 'drafts', number>> | null; confirmation?: BannerConfirmation | null };
export type VendorBannerList = BannerList & {
  vendor?: { canPropose: boolean; reason: string | null } | null; proposalExpiryDays?: number;
  /** How many proposals are open (draft, pending, scheduled) and the most allowed (409 too_many_open_proposals above it). */
  openProposals?: { open: number; max: number } | null;
};
export type AuditRow = { id?: string | number; action: string; actor?: string | null; actorName?: string | null; at?: string; createdAt?: string; after?: Record<string, unknown> | null };

/** Lists come back as { items } (or a bare array from an older shape). */
function listOf(body: unknown): BannerList & Record<string, unknown> {
  if (Array.isArray(body)) return { items: body as ShopBanner[], nextCursor: null };
  const b = (body ?? {}) as Record<string, unknown>;
  const items = Array.isArray(b.items) ? b.items : Array.isArray(b.banners) ? b.banners : [];
  return { ...b, items: items as ShopBanner[], nextCursor: (b.nextCursor as number | null) ?? null };
}
function oneOf(body: unknown): ShopBanner {
  const b = body as { banner?: ShopBanner; item?: ShopBanner } | null;
  return (b?.banner ?? b?.item ?? body) as ShopBanner;
}
/** Every page (100 at a time, at most 10 pages: far more than are ever proposed at once). */
async function allPages(fetchPage: (cursor?: number | string) => Promise<BannerList & Record<string, unknown>>) {
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

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body ?? {}) });
const enc = encodeURIComponent;

/** Multipart image upload with progress (XHR), shared by the admin and vendor routes. The server checks size and type again. */
function uploadImage(path: string, token: string, file: File, fields: BannerImageFields, opts: { onProgress?: (f: number) => void; signal?: AbortSignal } = {}): Promise<ShopBanner> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // Text fields first, the file last, so the server has every field before it reads the file.
    form.append('people', fields.people);
    form.append('confirmationVersion', fields.confirmationVersion);
    form.append('rightsConfirmed', fields.rightsConfirmed ? 'true' : 'false');
    if (fields.people === 'product_models') {
      form.append('peopleConfirmed', fields.peopleConfirmed ? 'true' : 'false');
      if (fields.consentRef?.trim()) form.append('consentRef', fields.consentRef.trim());
    }
    if (fields.licenceRef?.trim()) form.append('licenceRef', fields.licenceRef.trim());
    form.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-fitflex-client', IDENTITY_V2_CLIENT);
    xhr.upload.onprogress = e => { if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(oneOf(body));
      if (xhr.status === 401) notifyUnauthorized();
      reject(new ApiError(xhr.status, body));
    };
    xhr.onerror = () => reject(new TypeError('network_error'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    if (opts.signal) {
      if (opts.signal.aborted) { xhr.abort(); return; }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/** A private banner photo (before approval there is no public copy), fetched with the session token. */
export async function fetchBannerPhoto(token: string, previewUrl: string, width: 240 | 480 | 960, signal?: AbortSignal): Promise<Blob> {
  const sep = previewUrl.includes('?') ? '&' : '?';
  const res = await fetch(`${API_BASE}${previewUrl}${sep}w=${width}`, {
    headers: { authorization: `Bearer ${token}`, 'x-fitflex-client': IDENTITY_V2_CLIENT }, cache: 'no-store', signal,
  });
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  return res.blob();
}
/** The public address of a banner photo, when it has one (approved banners). Root-relative /storage/… addresses are on the API server. */
export const publicPhoto = (img: BannerImage | null | undefined, wide = false): string | null => {
  if (!img) return null;
  const p = img.public ?? img;
  const url = (wide ? p.urlWide || p.url2x || p.url1x : p.url1x || p.url2x || p.urlWide) || null;
  return url && url.startsWith('/') ? `${API_BASE}${url}` : url;
};

/**
 * What the reviewer saw (H2): the server refuses a decision on a banner that changed since (409 banner_changed).
 * (functions#227 revision 2: revision, or updatedAt as a fallback, and imageId; missing → 400 revision_required.)
 */
function seenRevision(b: ShopBanner): Record<string, unknown> {
  return {
    ...(b.revision != null ? { revision: b.revision } : b.updatedAt ? { updatedAt: b.updatedAt } : {}),
    ...(b.image?.id ? { imageId: b.image.id } : {}),
  };
}

export const bannersApi = {
  // Admin (list/detail: `promotions` or `promotions_approve`; create, edit, photo, send, withdraw: `promotions`;
  // approve, reject, end, position: `promotions_approve`, never on one's own).
  adminList: (token: string, f: { tab?: MerchTab | 'drafts'; status?: BannerEffectiveStatus; limit?: number } = {}) =>
    allPages(async cursor => listOf(await request<unknown>(`/admin/shop-merch${qs({ kind: 'banner', tab: f.tab, status: f.status, limit: f.limit ?? 100, cursor })}`, {}, token))),
  adminProbe: async (token: string) => listOf(await request<unknown>(`/admin/shop-merch${qs({ kind: 'banner', limit: 1 })}`, {}, token)),
  adminGet: async (token: string, id: string) => {
    const body = await request<{ banner: ShopBanner; history?: AuditRow[] }>(`/admin/shop-banners/${enc(id)}`, {}, token);
    return { banner: oneOf(body), history: Array.isArray(body?.history) ? body.history : [] };
  },
  adminCreate: async (token: string, body: BannerInput) => oneOf(await request<unknown>('/admin/shop-banners', json(body), token)),
  adminUpdate: async (token: string, id: string, body: Partial<BannerInput>) => oneOf(await request<unknown>(`/admin/shop-banners/${enc(id)}`, patch(body), token)),
  adminSubmit: async (token: string, id: string) => oneOf(await request<unknown>(`/admin/shop-banners/${enc(id)}/submit`, json({}), token)),
  adminWithdraw: async (token: string, id: string) => oneOf(await request<unknown>(`/admin/shop-banners/${enc(id)}/withdraw`, json({}), token)),
  adminApprove: async (token: string, b: ShopBanner, checks: readonly string[]) =>
    oneOf(await request<unknown>(`/admin/shop-banners/${enc(b.id)}/approve`, json({ checks, ...seenRevision(b) }), token)),
  /** code + note apart (review #5): the label is rendered from the code in each reader's language. */
  adminReject: async (token: string, b: ShopBanner, code: RejectCode, note: string) =>
    oneOf(await request<unknown>(`/admin/shop-banners/${enc(b.id)}/reject`, json({ code, ...(note.trim() ? { note: note.trim() } : {}), ...seenRevision(b) }), token)),
  adminEnd: async (token: string, id: string, note: string) => oneOf(await request<unknown>(`/admin/shop-banners/${enc(id)}/end`, json({ note }), token)),
  adminPosition: async (token: string, id: string, position: number | null) =>
    oneOf(await request<unknown>(`/admin/shop-banners/${enc(id)}/position`, json({ position }), token)),
  adminUploadImage: (token: string, id: string, file: File, fields: BannerImageFields, opts?: { onProgress?: (f: number) => void; signal?: AbortSignal }) =>
    uploadImage(`/admin/shop-banners/${enc(id)}/image`, token, file, fields, opts),

  // Vendor and vendor staff with `products` (404 feature_disabled while SHOP_BANNERS is off).
  vendorList: (token: string) =>
    allPages(async cursor => listOf(await request<unknown>(`/vendor/shop-banners${qs({ limit: 100, cursor })}`, {}, token))) as Promise<VendorBannerList>,
  vendorProbe: async (token: string) => listOf(await request<unknown>(`/vendor/shop-banners${qs({ limit: 1 })}`, {}, token)),
  vendorCreate: async (token: string, body: BannerInput) => oneOf(await request<unknown>('/vendor/shop-banners', json(body), token)),
  vendorUpdate: async (token: string, id: string, body: Partial<BannerInput>) => oneOf(await request<unknown>(`/vendor/shop-banners/${enc(id)}`, patch(body), token)),
  vendorSubmit: async (token: string, id: string) => oneOf(await request<unknown>(`/vendor/shop-banners/${enc(id)}/submit`, json({}), token)),
  vendorWithdraw: async (token: string, id: string) => oneOf(await request<unknown>(`/vendor/shop-banners/${enc(id)}/withdraw`, json({}), token)),
  vendorEnd: async (token: string, id: string) => oneOf(await request<unknown>(`/vendor/shop-banners/${enc(id)}/end`, json({}), token)),
  vendorUploadImage: (token: string, id: string, file: File, fields: BannerImageFields, opts?: { onProgress?: (f: number) => void; signal?: AbortSignal }) =>
    uploadImage(`/vendor/shop-banners/${enc(id)}/image`, token, file, fields, opts),
};

// ─── State and labels ───────────────────────────────────────────────────────

/** What a banner is right now: the server's effective status when sent, else worked out from the stored one and the clock. */
export type BannerPhase = 'draft' | 'pending' | 'scheduled' | 'live' | 'ended' | 'rejected' | 'expired' | 'withdrawn';
export function phaseOf(b: Pick<ShopBanner, 'status' | 'startsAt' | 'endsAt' | 'effectiveStatus' | 'expiresAt'>, now = Date.now()): BannerPhase {
  const s = b.effectiveStatus ?? b.status;
  switch (s) {
    case 'draft': return 'draft';
    case 'pending_approval': {
      // Left undecided past its expiry: expired (the server's job writes it down later).
      const exp = Date.parse(b.expiresAt ?? '');
      return !b.effectiveStatus && Number.isFinite(exp) && exp <= now ? 'expired' : 'pending';
    }
    case 'live': return 'live';
    case 'approved': {
      const start = Date.parse(b.startsAt); const end = Date.parse(b.endsAt);
      if (Number.isFinite(end) && end <= now) return 'ended';
      if (!b.effectiveStatus && Number.isFinite(start) && start <= now) return 'live';
      return 'scheduled';
    }
    case 'rejected': return 'rejected';
    case 'withdrawn': return 'withdrawn';
    case 'expired': return 'expired';
    default: return 'ended';
  }
}
export const PHASE_KEY: Record<BannerPhase, MessageKey> = {
  draft: 'merch.status.draft', pending: 'merch.status.pending', scheduled: 'merch.status.approved', live: 'merch.status.live', ended: 'merch.status.ended',
  rejected: 'merch.status.rejected', expired: 'merch.status.expired', withdrawn: 'merch.status.withdrawn',
};
export const PHASE_TONE: Record<BannerPhase, BadgeTone> = {
  draft: 'gray', pending: 'warning', scheduled: 'brand', live: 'success', ended: 'default', rejected: 'danger', expired: 'gray', withdrawn: 'gray',
};

/** Admin queue tabs (spec §5.3.1, server ADMIN_TABS). Drafts = FitFlex banners not sent yet (a vendor's drafts are never listed). */
export type MerchTab = 'requests' | 'scheduled' | 'live' | 'closed' | 'drafts';
export const MERCH_TABS: MerchTab[] = ['requests', 'scheduled', 'live', 'closed', 'drafts'];
export const MERCH_TAB_KEY: Record<MerchTab, MessageKey> = {
  requests: 'merchAdmin.tab.requests', scheduled: 'merchAdmin.tab.scheduled', live: 'merchAdmin.tab.live', closed: 'merchAdmin.tab.closed', drafts: 'merchAdmin.tab.drafts',
};
export const MERCH_EMPTY_KEY: Record<MerchTab, MessageKey> = {
  requests: 'merchAdmin.empty.requests', scheduled: 'merchAdmin.empty.scheduled', live: 'merchAdmin.empty.live', closed: 'merchAdmin.empty.closed', drafts: 'merchAdmin.empty.drafts',
};
/** Banners and flash sales share the lifecycle (spec §4.1), so any item with these fields works. */
export type PhasedItem = Pick<ShopBanner, 'status' | 'startsAt' | 'endsAt' | 'effectiveStatus' | 'expiresAt'>;
export function tabOfBanner(b: PhasedItem, now = Date.now()): MerchTab {
  const p = phaseOf(b, now);
  if (p === 'pending') return 'requests';
  if (p === 'draft') return 'drafts';
  if (p === 'scheduled') return 'scheduled';
  if (p === 'live') return 'live';
  return 'closed';
}
/** Kinds in the merch queue (the type filter shows when the server has more than one switched on). */
export const MERCH_KINDS = ['banner', 'flash_sale'] as const;
export type MerchKind = typeof MERCH_KINDS[number];

/** Vendor list groups (spec §5.2.2), in display order. */
export type VendorGroup = 'live' | 'scheduled' | 'waiting' | 'drafts' | 'past';
export const VENDOR_GROUPS: VendorGroup[] = ['live', 'scheduled', 'waiting', 'drafts', 'past'];
export const VENDOR_GROUP_KEY: Record<VendorGroup, MessageKey> = {
  live: 'merch.group.live', scheduled: 'merch.group.scheduled', waiting: 'merch.group.waiting', drafts: 'merch.group.drafts', past: 'merch.group.past',
};
export function vendorGroupOf(b: PhasedItem, now = Date.now()): VendorGroup {
  const p = phaseOf(b, now);
  if (p === 'live') return 'live';
  if (p === 'scheduled') return 'scheduled';
  if (p === 'pending') return 'waiting';
  if (p === 'draft') return 'drafts';
  return 'past';
}
/**
 * What may be done now. The server's allowedActions win when sent; otherwise the lifecycle (spec §4.1):
 * edit draft/pending/rejected/scheduled/live (a scheduled or live one goes back for approval), send a draft,
 * withdraw before it goes live, end a live one.
 */
export function canDo(b: ShopBanner, action: BannerAction, now = Date.now()): boolean {
  if (Array.isArray(b.allowedActions)) return b.allowedActions.includes(action);
  const p = phaseOf(b, now);
  switch (action) {
    case 'edit': return ['draft', 'pending', 'rejected', 'scheduled', 'live'].includes(p);
    case 'image': return ['draft', 'pending', 'rejected', 'scheduled', 'live'].includes(p);
    case 'submit': return p === 'draft';
    case 'withdraw': return ['draft', 'pending', 'scheduled'].includes(p);
    case 'end': return p === 'live';
    default: return false;
  }
}
/** Editing it sends it back for approval (and takes it off the shop until then). */
export const editResends = (b: ShopBanner, now = Date.now()) => ['scheduled', 'live'].includes(phaseOf(b, now));

/** The text in one language, falling back to the other (vendor text is data, both are required). */
export const pick = (text: Bilingual | null | undefined, locale: 'en' | 'sw') => (text ? (locale === 'sw' ? text.sw || text.en : text.en || text.sw) : '');
export const headlineOf = (b: Pick<ShopBanner, 'headlineLead' | 'headlineAccent'>, locale: 'en' | 'sw') =>
  [pick(b.headlineLead, locale), pick(b.headlineAccent, locale)].filter(Boolean).join(' ');

// ─── Call to action (DD-P2-1: chosen from a fixed list, never typed) ────────

export type CtaKey = 'viewProduct' | 'visitStore' | 'shopNow' | 'viewAll';
export const CTA_KEY: Record<CtaKey, MessageKey> = {
  viewProduct: 'shop.banner.cta.viewProduct', visitStore: 'shop.banner.cta.visitStore', shopNow: 'shop.banner.cta.shopNow', viewAll: 'shop.banner.cta.viewAll',
};
/** The server's label for each target when none is sent (DEFAULT_CTA); staff may pick another from the short list. */
export const CTA_FOR_TARGET: Record<BannerTargetType, CtaKey[]> = {
  product: ['viewProduct', 'shopNow'],
  vendor_store: ['visitStore', 'shopNow'],
  category: ['shopNow', 'viewAll'],
  results: ['viewAll', 'shopNow'],
};
/** The key the server takes (ctaKey). */
export type WireCtaKey = 'view_product' | 'visit_store' | 'shop_now' | 'view_all';
export const WIRE_CTA: Record<CtaKey, WireCtaKey> = { viewProduct: 'view_product', visitStore: 'visit_store', shopNow: 'shop_now', viewAll: 'view_all' };
const FROM_WIRE: Record<string, CtaKey> = Object.fromEntries(Object.entries(WIRE_CTA).map(([k, v]) => [v, k as CtaKey]));
/** Both languages of a CTA label, whatever the screen language is. */
export const ctaLabelOf = (key: CtaKey): Bilingual => ({ en: messages.en[CTA_KEY[key]], sw: messages.sw[CTA_KEY[key]] });
/** Which fixed label a saved banner uses (matches the English text), else null. */
export function ctaKeyOf(label: Bilingual | null | undefined, wire?: string | null): CtaKey | null {
  if (wire && FROM_WIRE[wire]) return FROM_WIRE[wire];
  if (!label) return null;
  return (Object.keys(CTA_KEY) as CtaKey[]).find(k => messages.en[CTA_KEY[k]] === label.en) ?? null;
}
export const TARGET_KEY: Record<BannerTargetType, MessageKey> = {
  product: 'merchAdmin.target.product', vendor_store: 'merchAdmin.target.store', category: 'merchAdmin.target.category', results: 'merchAdmin.target.results',
};

// ─── Checks the server makes too (spec §5.2.3; functions src/shared/shop-banner-rules.mjs) ──────

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIN_W = 1600;
export const IMAGE_MIN_H = 1000;
/** Lead + accent together (P1 §6.3). */
export const HEADLINE_MAX = { en: 32, sw: 42 } as const;
export const SUBLINE_MAX = { en: 70, sw: 90 } as const;
export const ALT_MAX = { en: 160, sw: 200 } as const;
const HOUR = 3_600_000;

// Banner text rules (DD-P2-2), the same lists as the server (functions#227 revision 2, "Text rules"). Checked on
// normalised text: NFKC (fullwidth digits and %), format characters removed, whitespace collapsed.
const normalise = (v: string) => v.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
const D = '\\p{Nd}';
const re = (src: string) => new RegExp(src, 'iu');
// Links, handles and phone numbers (checked first, as on the server).
const TLDS = 'com|net|org|info|biz|shop|store|app|io|me|co|tz|ke|ug|rw|bi|africa|online|site|website|xyz|link|ly|tv|club|fit|fitness';
const CONTACT_PATTERNS = [
  /https?:\/\//iu, /\bwww\./iu,
  re(`[\\p{L}\\p{N}-]\\.(?:${TLDS})\\b`),
  /\b(?:dot|nukta)\s+com\b/iu,
  /(?:^|[^\p{L}\p{N}])@[\p{L}\p{N}_.]{2,}/u,
  re(`\\+\\s*25[45]`),
  re(`(?:^|[^${D}])0[167]${D}{2}[\\s-]?${D}{3}[\\s-]?${D}{3}`),
  re(`${D}(?:[\\s-]?${D}){8,}`),
];
// Prices, percentages, amounts and deal words.
const PRICE_PATTERNS = [
  /[%٪﹪]/u, /\/=/u, re(`${D}\\s*\\/-`),
  re(`\\b(?:tsh|tshs|tzs|ksh|shs?|sh)\\.?\\s*${D}`),
  re(`${D}[${D},.\\s]*\\s*(?:tsh|tshs|tzs|ksh|shs?|shilingi|bob)\\b`),
  re(`\\b(?:bei|price)\\s*:?\\s*${D}`),
  /\b(?:shilingi|asilimia|percent|per\s*cent|pct|elfu|laki|milioni|million|punguzo|bure|nusu\s+bei|half\s+price|discount)\b/iu,
  re(`${D}{1,3}(?:[,.]${D}{3})+`),
  re(`${D}{4,}`),
];
export const hasContact = (s: string) => { const v = normalise(s); return CONTACT_PATTERNS.some(p => p.test(v)); };
export const hasPrice = (s: string) => { const v = normalise(s); return PRICE_PATTERNS.some(p => p.test(v)); };

export type BannerTextField = 'imageAlt' | 'headlineLead' | 'headlineAccent' | 'subline';
export type FieldError = { key: MessageKey; vars?: Record<string, string | number> };
/** Field id → error. Field ids are `${field}.${lang}`, plus target, audienceRoles, startsAt, endsAt, image, people, rights, peopleConfirm. */
export type FormErrors = Record<string, FieldError>;

export interface BannerDraft {
  imageAlt: Bilingual;
  headlineLead: Bilingual;
  headlineAccent: Bilingual;
  subline: Bilingual;
  targetType: BannerTargetType;
  /** product id, vendor id or category key; for results, the search words (may be empty: all products). */
  targetValue: string;
  cta: CtaKey;
  audienceRoles: string[];
  startsAt: string;
  endsAt: string;
}

export function validateDraft(d: BannerDraft, opts: { now?: number; checkStart?: boolean } = {}): FormErrors {
  const now = opts.now ?? Date.now();
  const e: FormErrors = {};
  const langs = ['en', 'sw'] as const;
  const required: BannerTextField[] = ['headlineLead', 'headlineAccent', 'imageAlt'];
  for (const f of required) for (const l of langs) if (!d[f][l].trim()) e[`${f}.${l}`] = { key: 'merch.required' };
  // The subline is optional, but once one language has it the other must too.
  for (const l of langs) {
    const other = l === 'en' ? 'sw' : 'en';
    if (!d.subline[l].trim() && d.subline[other].trim()) e[`subline.${l}`] = { key: l === 'en' ? 'merch.banner.addEnglish' : 'merch.banner.addSwahili' };
  }
  for (const l of langs) {
    const len = (d.headlineLead[l].trim() + ' ' + d.headlineAccent[l].trim()).trim().length;
    if (len > HEADLINE_MAX[l] && !e[`headlineAccent.${l}`]) e[`headlineAccent.${l}`] = { key: 'merch.banner.tooLong', vars: { n: HEADLINE_MAX[l] } };
    if (d.subline[l].trim().length > SUBLINE_MAX[l]) e[`subline.${l}`] = { key: 'merch.banner.sublineTooLong', vars: { n: SUBLINE_MAX[l] } };
    if (d.imageAlt[l].trim().length > ALT_MAX[l]) e[`imageAlt.${l}`] = { key: 'merch.banner.altTooLong', vars: { n: ALT_MAX[l] } };
  }
  for (const f of ['headlineLead', 'headlineAccent', 'subline', 'imageAlt'] as const) for (const l of langs) {
    const v = d[f][l];
    if (!v.trim() || e[`${f}.${l}`]) continue;
    if (hasContact(v)) e[`${f}.${l}`] = { key: 'merch.banner.noLinks' };
    else if (hasPrice(v)) e[`${f}.${l}`] = { key: 'merch.banner.noPrices' };
  }
  if (d.targetType !== 'results' && !d.targetValue.trim()) e.target = { key: d.targetType === 'product' ? 'merch.banner.pickProduct' : 'merch.required' };
  if (d.audienceRoles.length === 0) e.audienceRoles = { key: 'merch.banner.pickOne' };
  const start = Date.parse(d.startsAt); const end = Date.parse(d.endsAt);
  if (!d.startsAt || !Number.isFinite(start)) e.startsAt = { key: 'merch.required' };
  else if (opts.checkStart !== false && start < now + HOUR - 60_000) e.startsAt = { key: 'merch.dates.startSoon' };
  if (!d.endsAt || !Number.isFinite(end)) e.endsAt = { key: 'merch.required' };
  else if (Number.isFinite(start) && end <= start) e.endsAt = { key: 'merch.dates.endAfter' };
  return e;
}

/** Order of the fields on the form, so focus can move to the first one in error (spec §11.3). */
export const FIELD_ORDER = [
  'image', 'people', 'rights', 'peopleConfirm', 'consentRef',
  'headlineLead.en', 'headlineLead.sw', 'headlineAccent.en', 'headlineAccent.sw', 'subline.en', 'subline.sw', 'imageAlt.en', 'imageAlt.sw',
  'target', 'audienceRoles', 'startsAt', 'endsAt',
];

/** The request body. Vendors leave the button label to the server (it follows the target); staff send the one they picked. */
export const draftToInput = (d: BannerDraft, mode: 'vendor' | 'staff'): BannerInput => {
  const trim = (b: Bilingual): Bilingual => ({ en: b.en.trim(), sw: b.sw.trim() });
  const sub = trim(d.subline);
  const value: BannerTarget['value'] = d.targetType === 'results' ? (d.targetValue.trim() ? { search: d.targetValue.trim() } : {}) : d.targetValue.trim();
  return {
    imageAlt: trim(d.imageAlt), headlineLead: trim(d.headlineLead), headlineAccent: trim(d.headlineAccent),
    subline: sub.en || sub.sw ? sub : null,
    // Vendors get the label for their target; staff pick from the short list. Never free text.
    ctaKey: WIRE_CTA[mode === 'vendor' ? CTA_FOR_TARGET[d.targetType][0] : d.cta],
    target: { type: d.targetType, value },
    audienceRoles: d.audienceRoles, startsAt: d.startsAt, endsAt: d.endsAt,
  };
};
const empty = (): Bilingual => ({ en: '', sw: '' });
const targetText = (t: BannerTarget | null | undefined): string => {
  if (!t || t.value == null) return '';
  if (typeof t.value === 'string') return t.value;
  return typeof t.value.search === 'string' ? t.value.search : '';
};
export function draftOf(b: ShopBanner | null, defaults: { targetType: BannerTargetType; targetValue?: string }): BannerDraft {
  if (!b) {
    return {
      imageAlt: empty(), headlineLead: empty(), headlineAccent: empty(), subline: empty(),
      targetType: defaults.targetType, targetValue: defaults.targetValue ?? '', cta: CTA_FOR_TARGET[defaults.targetType][0],
      audienceRoles: [...AUDIENCE_ROLES], startsAt: '', endsAt: '',
    };
  }
  const type = b.target?.type ?? defaults.targetType;
  return {
    imageAlt: { ...empty(), ...b.imageAlt }, headlineLead: { ...empty(), ...b.headlineLead }, headlineAccent: { ...empty(), ...b.headlineAccent }, subline: { ...empty(), ...b.subline },
    targetType: type, targetValue: targetText(b.target) || defaults.targetValue || '', cta: ctaKeyOf(b.ctaLabel, b.ctaKey) ?? CTA_FOR_TARGET[type][0],
    audienceRoles: b.audienceRoles?.length ? [...b.audienceRoles] : [...AUDIENCE_ROLES], startsAt: b.startsAt ?? '', endsAt: b.endsAt ?? '',
  };
}
/** "Links to" for a list or detail: the product's name when the server sends it. */
export const targetLabelOf = (b: ShopBanner) => b.targetName || targetText(b.target) || '';

// ─── Server refusals ────────────────────────────────────────────────────────

export const errorCodeOf = (err: unknown): string | null => (err instanceof ApiError ? ((err.body as { error?: string } | null)?.error ?? null) : null);
export const errorFieldOf = (err: unknown): string | null => (err instanceof ApiError ? ((err.body as { field?: string } | null)?.field ?? null) : null);
export const isNetworkError = (err: unknown) => err instanceof TypeError;

const ERROR_KEY: Record<string, MessageKey> = {
  // Admin decisions
  cannot_approve_own_submission: 'merchAdmin.ownWork',
  banner_changed: 'merchAdmin.bannerChanged',
  revision_required: 'merchAdmin.bannerChanged',
  reason_code_required: 'merchAdmin.reasonRequired',
  invalid_reason_code: 'merchAdmin.reasonRequired',
  note_required: 'merchAdmin.noteRequired',
  invalid_note: 'merchAdmin.noteTooLong',
  invalid_cta_key: 'merch.banner.ctaNotAllowed',
  confirmation_version_mismatch: 'merch.banner.confirmationChanged',
  consent_reference_required: 'merch.banner.consentRequired',
  invalid_reference: 'merch.banner.refTooLong',
  rate_limited: 'merch.rateLimited',
  too_many_open_proposals: 'merch.tooManyOpen',
  cta_label_not_allowed: 'merch.banner.ctaNotAllowed',
  image_people_unconfirmed: 'merchAdmin.peopleUnconfirmed',
  review_checks_required: 'merchAdmin.checksRequired',
  proposal_expired: 'merchAdmin.proposalExpired',
  invalid_position: 'merchAdmin.positionRange',
  reason_required: 'merchAdmin.reasonRequired',
  // Text
  price_claim_in_text: 'merch.banner.noPrices',
  contact_in_text: 'merch.banner.noLinks',
  missing_translation: 'merch.banner.missingTranslation',
  headline_too_long: 'merch.banner.tooLongShort',
  text_too_long: 'merch.banner.textTooLong',
  // Link, audience, dates
  target_not_owned: 'merch.banner.targetNotOwned',
  target_not_eligible: 'merch.banner.targetNotEligible',
  target_type_not_allowed: 'merch.banner.targetNotOwned',
  target_required: 'merch.banner.pickProduct',
  audience_required: 'merch.banner.pickOne',
  start_too_soon: 'merch.dates.startSoon',
  start_required: 'merch.required',
  end_required: 'merch.required',
  end_before_start: 'merch.dates.endAfter',
  // Photo
  image_required: 'merch.banner.imageRequired',
  rights_confirmation_required: 'merch.confirmRequired',
  people_confirmation_required: 'merch.confirmRequired',
  unsupported_file_type: 'merch.banner.imageType',
  image_too_small: 'merch.banner.imageSize',
  file_too_large: 'merch.banner.imageWeight',
  storage_service_unavailable: 'merch.banner.storageDown',
  // State
  not_editable: 'merch.notEditable',
  invalid_transition: 'merch.notEditable',
  banner_not_found: 'merch.notYours',
  vendor_suspended: 'merch.suspended',
  vendor_not_approved: 'merch.pendingBody',
  feature_disabled: 'merch.unavailable',
  vendor_permission_forbidden: 'merch.noPermission',
  forbidden: 'merch.noPermission',
  acl_forbidden: 'merch.noPermission',
};
/** A refusal in the user's language; anything unknown is the generic "Couldn't save. Try again." */
export function errorKeyOf(err: unknown, fallback: MessageKey = 'merch.saveFailed'): MessageKey {
  if (isNetworkError(err)) return 'merch.notSentOffline';
  const code = errorCodeOf(err);
  return (code && ERROR_KEY[code]) || fallback;
}
const FIELD_OF_CODE: Record<string, string> = {
  image_people_unconfirmed: 'peopleConfirm', people_confirmation_required: 'peopleConfirm', rights_confirmation_required: 'rights',
  consent_reference_required: 'consentRef', invalid_reference: 'consentRef', confirmation_version_mismatch: 'rights',
  image_required: 'image', unsupported_file_type: 'image', image_too_small: 'image', file_too_large: 'image', no_file_provided: 'image',
  target_not_owned: 'target', target_not_eligible: 'target', target_type_not_allowed: 'target', target_required: 'target',
  audience_required: 'audienceRoles', start_too_soon: 'startsAt', start_required: 'startsAt', end_required: 'endsAt', end_before_start: 'endsAt',
};
/**
 * Where a refusal belongs on the form. Text refusals carry `field` "headlineLead.sw"; without a
 * language, the language that is empty (missing_translation) or that has the price is used.
 */
export function formFieldOf(err: unknown, d: BannerDraft): string | null {
  const code = errorCodeOf(err);
  if (code && FIELD_OF_CODE[code]) return FIELD_OF_CODE[code];
  if (!code || !['price_claim_in_text', 'contact_in_text', 'missing_translation', 'headline_too_long', 'text_too_long'].includes(code)) return null;
  const raw = errorFieldOf(err);
  if (!raw) return null;
  const [field, lang] = raw.split('.') as [BannerTextField, string | undefined];
  if (!['imageAlt', 'headlineLead', 'headlineAccent', 'subline'].includes(field)) return null;
  if (lang === 'en' || lang === 'sw') return `${field}.${lang}`;
  if (code === 'missing_translation') return `${field}.${d[field].en.trim() ? 'sw' : 'en'}`;
  return `${field}.${hasPrice(d[field].sw) && !hasPrice(d[field].en) ? 'sw' : 'en'}`;
}

// ─── Reasons (review #5): code and note apart; the label comes from the code in the reader's language ──

export const REJECT_KEY: Record<RejectCode, MessageKey> = {
  image: 'merchAdmin.reason.image', people: 'merchAdmin.reason.people', text: 'merchAdmin.reason.text',
  claim: 'merchAdmin.reason.claim', link: 'merchAdmin.reason.link', other: 'merchAdmin.reason.other',
};
/**
 * The reason line in the reader's language (revision 2: statusReason is the code, statusReasonNote the text):
 * rejected → the code's label, then the note; ended by FitFlex → the note. Other codes carry no text.
 */
export function reasonText(b: Pick<ShopBanner, 'status' | 'effectiveStatus' | 'statusReason' | 'statusReasonNote'>, t: (k: MessageKey) => string): string {
  const code = b.statusReason ?? '';
  const note = (b.statusReasonNote ?? '').trim();
  // Rejected: always the category (QA1 #4 / UAT D2), then the note when there is one.
  const label = (b.effectiveStatus ?? b.status) === 'rejected' && code in REJECT_KEY ? t(REJECT_KEY[code as RejectCode]) : '';
  return label && note ? `${label}: ${note}` : label || note;
}
