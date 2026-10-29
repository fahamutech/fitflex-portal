// Partner hero photo and logo: admin side (design spec photo-hero-screens §43, §44.2; plan
// docs/plans/partner-hero-media-plan.md; backend functions#277, docs/partner-media-api.md).
//
// Types and requests for the "Partner photos" queue (/admin/partner-media) and the "Home photo and
// logo" dialog on the gyms, trainers and vendors pages, plus the rules and error texts both share.
// No user-facing strings here: every label is an i18n key (src/lib/i18n.ts, partnerMedia.*).
//
// - The server's PARTNER_MEDIA flag gates every route (404 feature_disabled while off); the portal's
//   own flag is NEXT_PUBLIC_PARTNER_MEDIA_ADMIN (src/lib/flags.ts).
// - The admin view of an item has no file URLs (`files` is null): previews come from `previewUrl`,
//   fetched with the admin's token and shown from a blob: URL. No public image URL reaches the DOM.
// - Owner decision O-P3 (2026-10-29): the partner is NOT notified when FitFlex sets their photo or logo.
import { API_BASE, ApiError, IDENTITY_V2_CLIENT, notifyUnauthorized, request } from './api';
import type { Locale, MessageKey } from './i18n';
import { receiptDateTime } from './vendor';

// ─── Contract ───────────────────────────────────────────────────────────────

export type PartnerSubjectType = 'gym' | 'trainer' | 'vendor';
export type PartnerMediaKind = 'hero' | 'logo';
export type PartnerMediaStatus = 'live' | 'replaced' | 'removed' | 'taken_down';
export type PartnerMediaTab = 'to_review' | 'live' | 'taken_down';
export type PlateChoice = 'auto' | 'light' | 'dark';
export type PlateTone = 'light' | 'dark';
export type PartnerPreviewWidth = 240 | 480 | 960;
export type TakedownReason = 'inappropriate' | 'rights' | 'other_brand' | 'not_own_logo' | 'person_request' | 'quality' | 'other';

export interface PartnerSubject { type: PartnerSubjectType; id: string; name: string | null }

/** MediaItem, admin view (docs/partner-media-api.md). */
export interface PartnerMediaItem {
  id: string;
  kind: PartnerMediaKind;
  subject: PartnerSubject;
  status: PartnerMediaStatus;
  origin: 'partner' | 'fitflex';
  review: { state: 'to_review' | 'reviewed'; at?: string | null; by?: string | null; byName?: string | null };
  takedown: { reason: TakedownReason | string; note?: string | null; at?: string | null; by?: string | null; byName?: string | null } | null;
  width?: number | null;
  height?: number | null;
  /** Photos only, each -1..1. */
  focal?: { x: number; y: number } | null;
  bright?: boolean;
  /** Logos only: the resolved plate and what was chosen. */
  plate?: PlateTone | null;
  plateChoice?: PlateChoice | null;
  /** Always null in the admin view. */
  files?: null | Record<string, string>;
  bytes?: Record<string, number> | null;
  uploadedBy?: string | null;
  uploadedByName?: string | null;
  uploadedByRole?: string | null;
  confirmationVersion?: string | null;
  rightsConfirmedBy?: string | null;
  rightsConfirmedAt?: string | null;
  rightsConfirmedByName?: string | null;
  ownLogoConfirmedBy?: string | null;
  ownLogoConfirmedAt?: string | null;
  ownLogoConfirmedByName?: string | null;
  revision: number;
  createdAt: string;
  updatedAt?: string | null;
  ownUpload?: boolean;
  /** Root-relative and authenticated ("/admin/partner-media/:id/preview"); null unless live. */
  previewUrl?: string | null;
  statusChangedAt?: string | null;
}

export interface PartnerMediaList { items: PartnerMediaItem[]; total: number; next: number | string | null }

export interface PartnerMediaLimits {
  hero: { minWidth: number; maxBytes: number; types: string[] };
  logo: { minSide: number; maxBytes: number; types: string[]; maxSide?: number };
}

export interface AdminConfirmation {
  adminConfirmation: {
    version: string;
    status: string;
    rights: { en: string; sw: string };
    partnerLogo: { en: string; sw: string };
  };
  limits?: PartnerMediaLimits;
}

export interface PartnerMediaQuery {
  tab?: PartnerMediaTab;
  subjectType?: PartnerSubjectType | '';
  kind?: PartnerMediaKind | '';
  q?: string;
  subjectId?: string;
  limit?: number;
  cursor?: number | string | null;
}

export interface PartnerMediaSetFields {
  subjectType: PartnerSubjectType;
  subjectId: string;
  kind: PartnerMediaKind;
  rightsConfirmed: boolean;
  /** Logos only. */
  partnerLogoConfirmed?: boolean;
  adminConfirmationVersion: string;
  /** Photos only. */
  focal?: { x: number; y: number };
  /** Logos only. */
  plate?: PlateChoice;
  /**
   * Only when the server asked for it (409 override_reason_required): the file matches one taken down at a
   * person's request, and putting it back needs a reason (≤ 500, audited). Contract: functions#277 6cc45ec.
   */
  overrideReason?: string;
}

// ─── Requests ───────────────────────────────────────────────────────────────

const authHeaders = (token: string) => ({ authorization: `Bearer ${token}`, 'x-fitflex-client': IDENTITY_V2_CLIENT });

export function listQuery(f: PartnerMediaQuery): string {
  const q = new URLSearchParams();
  q.set('tab', f.tab ?? 'to_review');
  if (f.subjectType) q.set('subjectType', f.subjectType);
  if (f.kind) q.set('kind', f.kind);
  if (f.q?.trim()) q.set('q', f.q.trim());
  if (f.subjectId) q.set('subjectId', f.subjectId);
  if (f.limit) q.set('limit', String(f.limit));
  if (f.cursor != null && f.cursor !== '') q.set('cursor', String(f.cursor));
  return q.toString();
}

export const partnerMediaApi = {
  /** moderation, moderation_decide or brand_media. */
  list: (token: string, f: PartnerMediaQuery = {}) =>
    request<PartnerMediaList>(`/admin/partner-media?${listQuery(f)}`, {}, token),
  /** brand_media: the texts an admin confirms when setting a partner's photo or logo. */
  confirmation: (token: string) => request<AdminConfirmation>('/admin/partner-media/confirmation', {}, token),
  /** moderation_decide: "Looks fine". */
  reviewed: (token: string, id: string, revision: number) =>
    request<{ item: PartnerMediaItem }>(`/admin/partner-media/${encodeURIComponent(id)}/reviewed`,
      { method: 'POST', body: JSON.stringify({ revision }) }, token),
  /** moderation_decide: take down a live item. The partner is told the reason (never the note in the push). */
  takeDown: (token: string, id: string, body: { revision: number; reason: TakedownReason; note?: string }) =>
    request<{ item: PartnerMediaItem }>(`/admin/partner-media/${encodeURIComponent(id)}/take-down`,
      { method: 'POST', body: JSON.stringify(body.note ? body : { revision: body.revision, reason: body.reason }) }, token),
  /** A live item's preview (WebP, no-store), fetched with the admin's token from its root-relative previewUrl. */
  preview: async (token: string, previewUrl: string, width: PartnerPreviewWidth, signal?: AbortSignal): Promise<Blob> => {
    const sep = previewUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${API_BASE}${previewUrl}${sep}w=${width}`, { headers: authHeaders(token), cache: 'no-store', signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 401) notifyUnauthorized();
      throw new ApiError(res.status, body);
    }
    return res.blob();
  },
  /**
   * brand_media: set a partner's photo or logo. Sends the ORIGINAL file (no browser resize or re-encode;
   * the server cleans it). XHR for upload progress; `signal` aborts it. Live at once, origin fitflex,
   * review reviewed; the partner is not notified (O-P3).
   */
  set: (
    token: string,
    file: File,
    fields: PartnerMediaSetFields,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<{ item: PartnerMediaItem }> => new Promise((resolve, reject) => {
    const form = new FormData();
    // Text fields first, the file last, so the server has every field before it reads the file.
    form.append('subjectType', fields.subjectType);
    form.append('subjectId', fields.subjectId);
    form.append('kind', fields.kind);
    form.append('rightsConfirmed', fields.rightsConfirmed ? 'true' : 'false');
    if (fields.kind === 'logo') form.append('partnerLogoConfirmed', fields.partnerLogoConfirmed ? 'true' : 'false');
    form.append('adminConfirmationVersion', fields.adminConfirmationVersion);
    if (fields.kind === 'hero' && fields.focal) {
      form.append('focalX', String(fields.focal.x));
      form.append('focalY', String(fields.focal.y));
    }
    if (fields.kind === 'logo') form.append('plate', fields.plate ?? 'auto');
    if (fields.overrideReason?.trim()) form.append('overrideReason', fields.overrideReason.trim());
    form.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/admin/partner-media`);
    const h = authHeaders(token);
    xhr.setRequestHeader('authorization', h.authorization);
    xhr.setRequestHeader('x-fitflex-client', h['x-fitflex-client']);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as { item: PartnerMediaItem });
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
  }),
};

// ─── Rules ──────────────────────────────────────────────────────────────────

/** Used until GET /admin/partner-media/confirmation answers (the server checks again). */
/** The server refuses photos over 50 megapixels (functions#277 hero-image-file HERO_LIMITS.maxPixels → 413 file_too_large { maxPixels }). */
export const HERO_MAX_PIXELS = 50_000_000;

export const DEFAULT_LIMITS: PartnerMediaLimits = {
  hero: { minWidth: 1080, maxBytes: 15 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  logo: { minSide: 256, maxBytes: 2 * 1024 * 1024, maxSide: 4000, types: ['image/png', 'image/jpeg', 'image/webp'] },
};
/**
 * The browser can only measure JPEG, PNG and WebP, and the spec's hint names only those (§43.5), so the
 * portal offers those three even though the server also takes HEIC/HEIF photos from the app.
 */
const BROWSER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const EXT_TYPE: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' };

export const NOTE_MAX = 500;
/** Reason for putting back a file taken down at a person's request (functions#277 OVERRIDE_REASON_MAX). */
export const OVERRIDE_REASON_MAX = 500;

/** §43.3: each reason and the kinds it applies to, in display order. `other` needs a note. */
export const TAKEDOWN_REASONS: ReadonlyArray<{ code: TakedownReason; kinds: PartnerMediaKind[] }> = [
  { code: 'inappropriate', kinds: ['hero', 'logo'] },
  { code: 'rights', kinds: ['hero', 'logo'] },
  { code: 'other_brand', kinds: ['hero'] },
  { code: 'not_own_logo', kinds: ['logo'] },
  { code: 'person_request', kinds: ['hero'] },
  { code: 'quality', kinds: ['hero', 'logo'] },
  { code: 'other', kinds: ['hero', 'logo'] },
];
export const reasonsFor = (kind: PartnerMediaKind) => TAKEDOWN_REASONS.filter(r => r.kinds.includes(kind)).map(r => r.code);

const REASON_SUFFIX: Record<TakedownReason, string> = {
  inappropriate: 'inappropriate', rights: 'rights', other_brand: 'otherBrand', not_own_logo: 'notOwnLogo',
  person_request: 'personRequest', quality: 'quality', other: 'other',
};
const isReason = (r: string): r is TakedownReason => r in REASON_SUFFIX;
/** Admin wording (§43.3 table). */
export const reasonLabelKey = (r: string): MessageKey => (isReason(r) ? `partnerMedia.reason.${REASON_SUFFIX[r]}` : 'partnerMedia.reason.other') as MessageKey;
/** What the partner reads (§44.1), shown as each option's hint. */
export const reasonPartnerKey = (r: string): MessageKey => (isReason(r) ? `partnerMedia.reasonPartner.${REASON_SUFFIX[r]}` : 'partnerMedia.reasonPartner.other') as MessageKey;

/** Can the Take down button be pressed? A reason; a note when it is `other`; never over 500 characters. */
export function takedownReady(reason: TakedownReason | '', note: string): boolean {
  if (!reason) return false;
  if (note.trim().length > NOTE_MAX) return false;
  return reason !== 'other' || note.trim().length > 0;
}

export type FileCheck =
  | { ok: true }
  | { ok: false; key: MessageKey; vars?: Record<string, string | number> };

/** Type and size, before the file is read (spec §43.5: checked in the browser first). */
export function checkFileBasics(kind: PartnerMediaKind, file: { name: string; type: string; size: number }, limits: PartnerMediaLimits = DEFAULT_LIMITS): FileCheck {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const type = file.type || EXT_TYPE[ext] || '';
  if (kind === 'logo' && (type === 'image/svg+xml' || ext === 'svg')) return { ok: false, key: 'partnerMedia.error.svg_not_allowed' };
  const allowed = limits[kind].types.filter(t => BROWSER_TYPES.includes(t));
  if (!allowed.includes(type)) return { ok: false, key: 'partnerMedia.error.unsupported_file_type' };
  const maxBytes = limits[kind].maxBytes;
  if (file.size > maxBytes) return { ok: false, key: 'partnerMedia.error.file_too_large', vars: { maxMb: Math.round(maxBytes / 1024 / 1024) } };
  return { ok: true };
}

/** Pixel size, once the browser has decoded it (the server checks again once the photo is upright). */
export function checkFileSize(kind: PartnerMediaKind, size: { width: number; height: number }, limits: PartnerMediaLimits = DEFAULT_LIMITS): FileCheck {
  if (kind === 'hero') {
    const minWidth = limits.hero.minWidth;
    if (size.width < minWidth) return { ok: false, key: 'partnerMedia.error.image_too_small.hero', vars: { minWidth } };
    if (size.width * size.height > HERO_MAX_PIXELS) return { ok: false, key: 'partnerMedia.error.too_many_pixels.photo', vars: { maxMp: HERO_MAX_PIXELS / 1_000_000 } };
    return { ok: true };
  }
  const { minSide } = limits.logo;
  const maxSide = limits.logo.maxSide ?? DEFAULT_LIMITS.logo.maxSide!;
  if (Math.min(size.width, size.height) < minSide) return { ok: false, key: 'partnerMedia.error.image_too_small.logo', vars: { minSide } };
  if (Math.max(size.width, size.height) > maxSide) return { ok: false, key: 'partnerMedia.error.too_many_pixels', vars: { maxSide } };
  return { ok: true };
}

/** `accept` for the file input. */
export const acceptFor = (kind: PartnerMediaKind, limits: PartnerMediaLimits = DEFAULT_LIMITS) =>
  limits[kind].types.filter(t => BROWSER_TYPES.includes(t)).join(',');

/**
 * Which plate Automatic picks (preview only; the server decides): dark when the alpha-weighted mean
 * luminance of the logo's pixels is above 0.6 (docs/partner-media-api.md), otherwise light.
 */
export function autoPlate(rgba: ArrayLike<number>): PlateTone {
  let sum = 0; let weight = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    if (a <= 0) continue;
    const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const l = 0.2126 * lin(rgba[i]) + 0.7152 * lin(rgba[i + 1]) + 0.0722 * lin(rgba[i + 2]);
    sum += l * a; weight += a;
  }
  return weight > 0 && sum / weight > 0.6 ? 'dark' : 'light';
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Every code functions#277 can answer on an admin route, mapped to its text (§44.1, §44.2). */
const ERROR_KEYS: Record<string, MessageKey> = {
  feature_disabled: 'partnerMedia.off.body',
  forbidden: 'partnerMedia.error.forbidden',
  acl_forbidden: 'partnerMedia.error.acl_forbidden',
  account_suspended: 'partnerMedia.error.forbidden',
  stale_revision: 'partnerMedia.stale',
  not_editable: 'partnerMedia.error.not_editable',
  media_gone: 'partnerMedia.gone',
  media_not_found: 'partnerMedia.gone',
  image_not_found: 'partnerMedia.gone',
  own_upload: 'partnerMedia.ownUpload',
  reason_required: 'partnerMedia.error.reason_required',
  invalid_reason: 'partnerMedia.error.reason_required',
  note_required: 'partnerMedia.error.note_required',
  note_too_long: 'partnerMedia.error.note_too_long',
  revision_required: 'partnerMedia.stale',
  invalid_revision: 'partnerMedia.stale',
  subject_not_found: 'partnerMedia.error.subject_not_found',
  invalid_subject_type: 'partnerMedia.error.subject_not_found',
  invalid_kind: 'partnerMedia.error.subject_not_found',
  invalid_tab: 'partnerMedia.loadError',
  invalid_width: 'partnerMedia.error.image_save_failed',
  confirmation_version_mismatch: 'partnerMedia.confirmChanged',
  rights_confirmation_required: 'partnerMedia.confirmRequired',
  partner_logo_confirmation_required: 'partnerMedia.confirmRequired',
  invalid_focal: 'partnerMedia.error.invalid_focal',
  invalid_plate: 'partnerMedia.error.invalid_plate',
  no_file_provided: 'partnerMedia.error.no_file_provided',
  unsupported_file_type: 'partnerMedia.error.unsupported_file_type',
  svg_not_allowed: 'partnerMedia.error.svg_not_allowed',
  image_too_small: 'partnerMedia.error.image_too_small.hero',
  file_too_large: 'partnerMedia.error.file_too_large',
  variant_over_budget: 'partnerMedia.error.variant_over_budget',
  image_save_failed: 'partnerMedia.error.image_save_failed',
  invalid_multipart: 'partnerMedia.error.image_save_failed',
  unknown_field: 'partnerMedia.error.image_save_failed',
  rate_limited: 'partnerMedia.error.rate_limited',
  image_taken_down_before: 'partnerMedia.error.image_taken_down_before',
  partner_media_failed: 'partnerMedia.error.image_save_failed',
  // Security review of functions#277 (6cc45ec).
  image_service_busy: 'partnerMedia.error.image_service_busy',
  rate_limit_unavailable: 'partnerMedia.error.rate_limit_unavailable',
  reinstate_requires_moderation_decide: 'partnerMedia.error.reinstate_requires_moderation_decide',
  override_reason_required: 'partnerMedia.error.override_reason_required',
  override_reason_too_long: 'partnerMedia.error.override_reason_too_long',
};
/** Exported for the mapping test. */
export const PARTNER_MEDIA_ERROR_CODES = Object.keys(ERROR_KEYS);

export const errorBody = (e: unknown) => (e instanceof ApiError && e.body && typeof e.body === 'object' ? (e.body as Record<string, unknown>) : null);
export const errorCode = (e: unknown): string | null => {
  const code = errorBody(e)?.error;
  return typeof code === 'string' ? code : null;
};
/** Not an answer from the server at all: offline, DNS, CORS, a dropped connection. */
export const isNetworkError = (e: unknown) => e instanceof TypeError;

type Translate = (key: MessageKey) => string;
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

export function partnerMediaErrorText(t: Translate, e: unknown, kind?: PartnerMediaKind): string {
  if (isNetworkError(e)) return t('partnerMedia.offline');
  const body = errorBody(e);
  const code = errorCode(e);
  if (!code) return fill(t('partnerMedia.error.unknown'), { code: e instanceof ApiError ? String(e.status) : 'network' });
  if (code === 'image_too_small') {
    if (kind === 'logo' || body?.minSide) return fill(t('partnerMedia.error.image_too_small.logo'), { minSide: Number(body?.minSide) || DEFAULT_LIMITS.logo.minSide });
    return fill(t('partnerMedia.error.image_too_small.hero'), { minWidth: Number(body?.minWidth) || DEFAULT_LIMITS.hero.minWidth });
  }
  if (code === 'file_too_large') {
    if (body?.maxSide) return fill(t('partnerMedia.error.too_many_pixels'), { maxSide: Number(body.maxSide) });
    if (body?.maxPixels) return fill(t('partnerMedia.error.too_many_pixels.photo'), { maxMp: Math.round(Number(body.maxPixels) / 1_000_000) });
    const max = Number(body?.maxBytes) || DEFAULT_LIMITS[kind ?? 'hero'].maxBytes;
    return fill(t('partnerMedia.error.file_too_large'), { maxMb: Math.round(max / 1024 / 1024) });
  }
  if (code === 'rate_limited') {
    if (body?.scope === 'person') return t('partnerMedia.error.rate_limited.person');
    if (body?.scope === 'partner') return t('partnerMedia.error.rate_limited.partner');
    if (body?.scope === 'partner_attempts') return t('partnerMedia.error.rate_limited.partnerAttempts');
  }
  const key = ERROR_KEYS[code];
  return key ? t(key) : fill(t('partnerMedia.error.unknown'), { code });
}

// ─── Display helpers ────────────────────────────────────────────────────────

export const SUBJECT_TYPE_KEY: Record<PartnerSubjectType, MessageKey> = {
  gym: 'partnerMedia.type.gym', trainer: 'partnerMedia.type.trainer', vendor: 'partnerMedia.type.vendor',
};
export const KIND_KEY: Record<PartnerMediaKind, MessageKey> = { hero: 'partnerMedia.kind.hero', logo: 'partnerMedia.kind.logo' };
/** That role's home headline (§25), as the app shows it under the partner's name. */
export const HEADLINE_KEYS: Record<PartnerSubjectType, { lead: MessageKey; accent: MessageKey }> = {
  gym: { lead: 'partnerMedia.headline.gym.lead', accent: 'partnerMedia.headline.gym.accent' },
  trainer: { lead: 'partnerMedia.headline.trainer.lead', accent: 'partnerMedia.headline.trainer.accent' },
  vendor: { lead: 'partnerMedia.headline.vendor.lead', accent: 'partnerMedia.headline.vendor.accent' },
};
/** The admin page that lists that kind of partner. */
export const SUBJECT_PAGE: Record<PartnerSubjectType, { href: string; labelKey: MessageKey }> = {
  gym: { href: '/admin/gyms/', labelKey: 'admin.nav.gyms' },
  trainer: { href: '/admin/trainers/', labelKey: 'admin.nav.trainers' },
  vendor: { href: '/admin/vendors/', labelKey: 'admin.nav.vendors' },
};
const ROLE_KEYS: Record<string, MessageKey> = {
  gym_operator: 'partnerMedia.role.gym_operator', gym_staff: 'partnerMedia.role.gym_staff', trainer: 'partnerMedia.role.trainer',
  vendor: 'partnerMedia.role.vendor', vendor_staff: 'partnerMedia.role.vendor_staff', admin: 'partnerMedia.role.admin',
};
export const roleLabel = (t: Translate, role: string | null | undefined) => (role && ROLE_KEYS[role] ? t(ROLE_KEYS[role]) : role || '—');

/**
 * "29 Oct 2026, 14:05" in English; Swahili uses the 12-hour clock with the part of the day,
 * "29 Okt 2026, 2:05 mchana" (the shared receipt clock in src/lib/vendor.ts). East Africa Time.
 */
export const eatDateTime = (iso: string | null | undefined, locale: Locale): string => receiptDateTime(iso, locale);

export { fill as fillTemplate };
