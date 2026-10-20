'use client';
// Admin "App photos" (design spec photo-hero-screens §36–§38; plan slice 5; backend functions#216).
//
// - Nothing reaches the apps until Publish: editing a place (slot) changes its draft only.
// - Photos are private until published, so every thumbnail and preview here is fetched with the
//   admin's token and shown from a blob: URL (AC-N18); no public or unauthenticated image URL is
//   ever put in the DOM.
// - The upload sends the ORIGINAL file (no browser resize or re-encode, AC-N7); the server rotates
//   it, strips metadata and makes the app sizes.
// - Any admin with the brand_media scope publishes alone (owner decision D-4); the server audits
//   every write and History puts back any earlier version.
// - Owner decision 2026-10-19: only photos without people for now (HERO_PEOPLE_ALLOWED).
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Images, Upload } from 'lucide-react';
import { useApp } from '../../app/providers';
import {
  api, ApiError,
  type HeroImage, type HeroImagePatch, type HeroImagesState, type HeroPeople, type HeroPreviewWidth, type HeroPublication, type HeroSlot,
} from '@/lib/api';
import { messages, type Locale, type MessageKey } from '@/lib/i18n';
import { fmt } from '@/lib/vendor';
import { cn } from '@/lib/cn';
import { focalToObjectPosition, PhotoPanel } from './photo-panel';
import {
  Alert, Badge, Button, Card, CardContent, Checkbox, EmptyState, ErrorState, Field, Input, PageHeader, Radio, Segmented, Select,
  SkeletonCard, SkeletonTable, Spinner, Table, TBody, Td, Textarea, Th, THead, Tr, useToast,
} from './shared';
import { ConfirmDialog, Dialog, DialogFooter } from './dialog';

type T = (key: MessageKey) => string;

/* ── Rules shared with the server (functions#216 HERO_LIMITS) ─────────────── */
export const HERO_MAX_BYTES = 15 * 1024 * 1024;
export const HERO_MAX_PIXELS = 50_000_000;
export const HERO_MIN_WIDTH = 1080;
export const HERO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const HERO_ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i;
const TEXT_MAX = 200;
const NOTE_MAX = 200;

/** Every people value the server knows, in display order. */
const PEOPLE_OPTIONS: Array<{ value: HeroPeople; key: MessageKey }> = [
  { value: 'none', key: 'heroImages.people.none' },
  { value: 'hands_backs', key: 'heroImages.people.handsBacks' },
  { value: 'unclear_faces', key: 'heroImages.people.unclearFaces' },
];
/** Owner decision 2026-10-19: only photos without people for now. Widen this to offer the others again. */
export const HERO_PEOPLE_ALLOWED: readonly HeroPeople[] = ['none'];
const ONLY_NO_PEOPLE = HERO_PEOPLE_ALLOWED.length === 1 && HERO_PEOPLE_ALLOWED[0] === 'none';
/** While only "No people" is allowed the box says exactly that; the wider wording returns with the other options. */
const FACES_CONFIRM_KEY: MessageKey = ONLY_NO_PEOPLE ? 'heroImages.faces.confirm' : 'heroImages.faces.confirmUnclear';

/** Areas in display order when the server does not send them (spec §36.2). */
const DEFAULT_AREAS = ['preSignIn', 'members', 'partners', 'footers', 'portal'];
const AREA_KEYS: Record<string, MessageKey> = {
  preSignIn: 'heroImages.area.preSignIn', members: 'heroImages.area.members', partners: 'heroImages.area.partners',
  footers: 'heroImages.area.footers', portal: 'heroImages.area.portal', other: 'heroImages.area.other',
};

const hasKey = (k: string): k is MessageKey => k in messages.en;
const slotLabel = (t: T, id: string) => (hasKey(`heroImages.slot.${id}`) ? t(`heroImages.slot.${id}` as MessageKey) : id);
const slotWhere = (t: T, id: string) => (hasKey(`heroImages.slot.${id}.where`) ? t(`heroImages.slot.${id}.where` as MessageKey) : fmt(t('heroImages.slot.unknown.where'), { id }));
const isKnownSlot = (id: string) => hasKey(`heroImages.slot.${id}`) && hasKey(`heroImages.slot.${id}.where`);

const sameList = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((v, i) => v === b[i]);
const photoAlt = (t: T, img: HeroImage | undefined) => (img ? fmt(t('heroImages.photoBy'), { photographer: img.photographer, source: img.source }) : '');
/** Which text zone a slot's brightness reads: the panel is horizontal, phone layouts vertical. */
const brightFor = (img: HeroImage | undefined, slot?: Pick<HeroSlot, 'variant'>) =>
  !!img && (slot ? (slot.variant === 'panel' ? img.brightWarning?.horizontal : img.brightWarning?.vertical) : (img.brightWarning?.vertical || img.brightWarning?.horizontal));
/** status 'published' = has been in a live snapshot (functions#216); "Live" comes from `live`. */
type LibraryState = 'draft' | 'published' | 'retired';
const libraryState = (img: HeroImage): LibraryState => (img.status === 'retired' ? 'retired' : img.status === 'published' ? 'published' : 'draft');
/** In the current live snapshot: the server's `live`, else worked out from the slots. */
const isLiveImage = (img: HeroImage, slots: HeroSlot[]) => (typeof img.live === 'boolean' ? img.live : slots.some(s => s.published.includes(img.id)));
const placesList = (t: T, ids: unknown) => (Array.isArray(ids) ? ids.map(id => slotLabel(t, String(id))).join(', ') : '');

const EAT = 'Africa/Dar_es_Salaam';
/** "19 Oct 2026, 14:05" in East Africa Time. */
function eatDateTimeYear(iso: string | null | undefined, locale: Locale) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const l = locale === 'sw' ? 'sw-TZ' : 'en-GB';
  const day = d.toLocaleDateString(l, { day: '2-digit', month: 'short', year: 'numeric', timeZone: EAT });
  const time = d.toLocaleTimeString(l, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: EAT });
  return `${day}, ${time}`;
}

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ── Errors: every code functions#216 can answer, in English and Swahili ─── */
export type HeroErrorContext = 'load' | 'upload' | 'edit' | 'retire' | 'unpublish' | 'slot' | 'publish' | 'rollback' | 'preview';
const ERROR_KEYS: Record<string, MessageKey> = {
  rights_confirmation_required: 'heroImages.error.confirmRequired',
  no_faces_confirmation_required: 'heroImages.error.confirmRequired',
  image_too_small: 'heroImages.error.imageTooSmall',
  unsupported_file_type: 'heroImages.error.unsupportedFileType',
  file_too_large: 'heroImages.error.fileTooLarge',
  storage_service_unavailable: 'heroImages.error.storageUnavailable',
  unknown_slot: 'heroImages.error.unknownSlot',
  too_many_images: 'heroImages.error.tooManyImages',
  image_retired: 'heroImages.error.imageRetired',
  licence_details_required: 'heroImages.error.licenceDetailsRequired',
  invalid_people: 'heroImages.error.invalidPeople',
  people_not_allowed: 'heroImages.error.peopleNotAllowed',
  invalid_reference: 'heroImages.error.invalidReference',
  no_file_provided: 'heroImages.error.noFileProvided',
  invalid_multipart: 'heroImages.error.invalidMultipart',
  unknown_field: 'heroImages.error.unknownField',
  invalid_focal: 'heroImages.error.invalidFocal',
  invalid_status: 'heroImages.error.invalidStatus',
  nothing_to_change: 'heroImages.error.nothingToChange',
  invalid_image_ids: 'heroImages.error.invalidImageIds',
  duplicate_image: 'heroImages.error.duplicateImage',
  image_not_found: 'heroImages.error.imageNotFound',
  image_in_draft: 'heroImages.error.imageInDraft',
  image_not_live: 'heroImages.error.imageNotLive',
  image_save_failed: 'heroImages.error.imageSaveFailed',
  image_unpublished: 'heroImages.error.imageUnpublished',
  invalid_note: 'heroImages.error.invalidNote',
  drafts_changed: 'heroImages.error.draftsChanged',
  variant_over_budget: 'heroImages.error.variantOverBudget',
  stored_file_mismatch: 'heroImages.error.storedFileMismatch',
  invalid_publication_id: 'heroImages.error.invalidPublicationId',
  publication_not_found: 'heroImages.error.publicationNotFound',
  already_current: 'heroImages.error.alreadyCurrent',
  feature_disabled: 'heroImages.error.featureDisabled',
  invalid_width: 'heroImages.error.invalidWidth',
  acl_forbidden: 'heroImages.error.aclForbidden',
};
/** Every code the screen maps (exported for the e2e mapping test). */
export const HERO_ERROR_CODES = Object.keys(ERROR_KEYS);

const errorBody = (e: unknown) => (e instanceof ApiError && e.body && typeof e.body === 'object' ? (e.body as Record<string, unknown>) : null);
export const heroErrorCode = (e: unknown): string | null => {
  const code = errorBody(e)?.error;
  return typeof code === 'string' ? code : null;
};
/** Not an answer from the server at all: offline, DNS, CORS, a dropped connection. */
const isNetworkError = (e: unknown) => e instanceof TypeError;

export function heroErrorText(t: T, e: unknown, ctx: HeroErrorContext): string {
  if (isNetworkError(e)) return t('heroImages.offline');
  const body = errorBody(e);
  const code = heroErrorCode(e);
  if (!code) return fmt(t('heroImages.error.unknown'), { code: e instanceof ApiError ? String(e.status) : 'network' });
  if (code === 'image_retired' && (ctx === 'edit' || ctx === 'retire' || ctx === 'unpublish')) return t('heroImages.error.imageRetiredEdit');
  if (code === 'image_retired' && ctx === 'rollback') return t('heroImages.error.imageRetiredRollback');
  if (code === 'file_too_large' && body?.maxPixels) return t('heroImages.error.tooManyPixels');
  if (code === 'image_in_draft' && Array.isArray(body?.slotIds) && body!.slotIds.length) return fmt(t('heroImages.error.imageInDraftSlots'), { places: placesList(t, body!.slotIds) });
  if (code === 'storage_service_unavailable' && body?.reason === 'upload_timeout') return t('heroImages.error.uploadTimeout');
  if (code === 'people_not_allowed' && (ctx === 'slot' || ctx === 'publish' || ctx === 'rollback')) return t('heroImages.error.peopleNotAllowedPhotos');
  if (code === 'too_many_images') return fmt(t('heroImages.error.tooManyImages'), { max: Number(body?.maxImages) || '' });
  const key = ERROR_KEYS[code];
  return key ? t(key) : fmt(t('heroImages.error.unknown'), { code });
}

/* ── Authenticated thumbnails: blob URLs, one request at a time, cached for the visit ── */
type ThumbStatus = { url?: string; failed?: boolean };
class ThumbStore {
  private entries = new Map<string, ThumbStatus>();
  private started = new Set<string>();
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private token: string | null) {}
  /** (Re)opens after a close: React strict mode unmounts and remounts once in development. */
  open() { this.closed = false; this.started.clear(); }
  key(id: string, w: HeroPreviewWidth) { return `${id}@${w}`; }
  get(id: string, w: HeroPreviewWidth) { return this.entries.get(this.key(id, w)); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach(fn => fn()); }
  load(id: string, w: HeroPreviewWidth) {
    const k = this.key(id, w);
    if (this.started.has(k) || !this.token || this.closed) return;
    this.started.add(k);
    const token = this.token;
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      try {
        const blob = await api.heroImagePreview(token, id, w);
        if (this.closed) return;
        this.entries.set(k, { url: URL.createObjectURL(blob) });
      } catch {
        this.entries.set(k, { failed: true });
        this.started.delete(k); // a later view may try again
      }
      this.emit();
    });
  }
  /** Revokes every object URL (the manager unmounted). */
  close() {
    this.closed = true;
    this.entries.forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
    this.entries.clear();
    this.listeners.clear();
  }
}
const ThumbCtx = createContext<ThumbStore | null>(null);

function useThumb(id: string | undefined, w: HeroPreviewWidth, visible = true): ThumbStatus {
  const store = useContext(ThumbCtx);
  const [, bump] = useState(0);
  useEffect(() => store?.subscribe(() => bump(n => n + 1)), [store]);
  useEffect(() => { if (store && id && visible) store.load(id, w); }, [store, id, w, visible]);
  return (id && store?.get(id, w)) || {};
}

/** Visible yet? (lazy thumbnails) */
function useInView<E extends Element>(): [React.RefObject<E | null>, boolean] {
  const ref = useRef<E>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function HeroThumb({ image, id, className, width = 240 }: { image?: HeroImage; id: string; className?: string; width?: HeroPreviewWidth }) {
  const { t } = useApp();
  const [ref, seen] = useInView<HTMLSpanElement>();
  const thumb = useThumb(image ? id : undefined, width, seen);
  return (
    <span ref={ref} className={cn('relative inline-block shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)]', className ?? 'h-10 w-16')} data-testid="hero-thumb" data-image-id={id}>
      {thumb.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb.url} alt={photoAlt(t, image)} className="h-full w-full object-cover" style={{ objectPosition: focalToObjectPosition(image?.focal) }} />
      ) : (
        <span className="sr-only">{image ? photoAlt(t, image) : id}</span>
      )}
    </span>
  );
}

function ThumbRow({ ids, images, slot, emptyText }: { ids: string[]; images: Map<string, HeroImage>; slot?: HeroSlot; emptyText: string }) {
  const { t } = useApp();
  if (!ids.length) return <span className="text-sm text-[var(--color-fg-tertiary)]">{emptyText}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {ids.map(id => (
        <span key={id} className="inline-flex items-center gap-1">
          <HeroThumb id={id} image={images.get(id)} />
          {brightFor(images.get(id), slot) && <Badge tone="warning">{t('heroImages.bright')}</Badge>}
        </span>
      ))}
    </span>
  );
}

/* ── HeroPreview: a fixed-size frame with the real scrim (spec §36.5) ─────── */
// Lighter rule (owner 2026-10-20; spec §5, §5.3, §33): the photo is clear and only the text has a
// scrim, exactly as the app (mobile#199/#201) and the portal login panel draw it. The portal sign-in
// slot ('panel') renders the login's own PhotoPanel, so the two cannot drift.
export type HeroPreviewKind = 'phone' | 'band' | 'footer' | 'desktop' | 'panel';
const PREVIEW_SIZE: Record<HeroPreviewKind, { w: number; h: number; label: MessageKey; scrim: 'vertical' | 'footer' | 'horizontal' | 'login' }> = {
  phone: { w: 390, h: 300, label: 'heroImages.preview.phone', scrim: 'vertical' },
  band: { w: 342, h: 180, label: 'heroImages.preview.band', scrim: 'vertical' },
  // Full width, 48% of a 390 x 844 phone (FFPhotoFooter: 48% of the viewport, clamped 320–440).
  footer: { w: 390, h: 405, label: 'heroImages.preview.footer', scrim: 'footer' },
  desktop: { w: 960, h: 320, label: 'heroImages.preview.desktop', scrim: 'horizontal' },
  // The login panel at 1280 x 800: 55% of the width, full height.
  panel: { w: 704, h: 800, label: 'heroImages.preview.desktop', scrim: 'login' },
};
/** The login row the sign-in panel preview is laid out in (the panel takes its left 55%). */
const LOGIN_ROW = { w: 1280, h: 800 };

/** Draws `children` at its real CSS size, scaled down (never up) to fit the column. */
export function ScaledFrame({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / width || 1));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={ref} className="w-full">
      <div style={{ width: width * scale, height: height * scale }} className="overflow-hidden">
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div>
      </div>
    </div>
  );
}

export function HeroPreview({ kind, src, focal, textScale = 1 }: { kind: HeroPreviewKind; src?: string; focal: { x: number; y: number }; textScale?: number }) {
  const { t } = useApp();
  const spec = PREVIEW_SIZE[kind];
  const textRef = useRef<HTMLDivElement>(null);
  const [textTop, setTextTop] = useState<number | null>(null);
  // The ramp ends at the first text line (the footer: at the top of the mark), and moves with it at 1.3×.
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    const measure = () => setTextTop(text.offsetTop);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(text);
    return () => ro.disconnect();
  }, [textScale, kind]);

  if (spec.scrim === 'login') {
    return (
      <div
        className={cn('hero-preview-login flex flex-col lg:flex-row', textScale !== 1 && 'hero-preview-login--large')}
        style={{ width: LOGIN_ROW.w, height: LOGIN_ROW.h }}
        data-testid="hero-preview-login-row"
      >
        <PhotoPanel
          previewImage={{ src, objectPosition: focalToObjectPosition(focal) }}
          eyebrow={t('login.hero.eyebrow')}
          headlineLead={t('login.hero.lead')}
          headlineAccent={t('login.hero.accent')}
          subline={t('login.hero.sub')}
          data-testid={`hero-preview-${kind}`}
        />
      </div>
    );
  }
  return (
    <div
      className={cn('hero-preview', `hero-preview--${kind}`, `hero-preview--${spec.scrim}`)}
      style={{ '--hero-preview-scale': String(textScale), ...(textTop != null ? { '--hero-preview-text-top': `${textTop}px` } : {}) } as React.CSSProperties}
      data-testid={`hero-preview-${kind}`}
      data-text-top={textTop ?? undefined}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" role="presentation" className="hero-preview__img" style={{ objectPosition: focalToObjectPosition(focal) }} data-testid={`hero-preview-${kind}-img`} />
      )}
      <div className="hero-preview__scrim" aria-hidden="true" data-testid={`hero-preview-${kind}-scrim`} />
      {kind === 'footer' ? (
        <div ref={textRef} className="hero-preview__lockup" data-testid="hero-preview-footer-lockup">
          <span className="hero-preview__plate" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/fitflex-icon.png" alt="" className="hero-preview__mark" />
          </span>
          <p className="hero-preview__brand">{t('heroImages.preview.footerBrand')}</p>
          <p className="hero-preview__tagline">{t('heroImages.preview.footerTagline')}</p>
        </div>
      ) : (
        <div ref={textRef} className="hero-preview__content" data-testid={`hero-preview-${kind}-text`}>
          <p className="hero-preview__eyebrow">{t('heroImages.preview.sampleEyebrow')}</p>
          <p className="hero-preview__headline">
            {t('heroImages.preview.sampleLead')} <span className="hero-preview__accent">{t('heroImages.preview.sampleAccent')}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function PreviewCard({ kind, src, focal }: { kind: HeroPreviewKind; src?: string; focal: { x: number; y: number } }) {
  const { t } = useApp();
  const [big, setBig] = useState(false);
  const spec = PREVIEW_SIZE[kind];
  return (
    <figure className="space-y-2" data-testid={`hero-preview-card-${kind}`}>
      <ScaledFrame width={spec.w} height={spec.h}>
        <HeroPreview kind={kind} src={src} focal={focal} textScale={big ? 1.3 : 1} />
      </ScaledFrame>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-fg-tertiary)]">
        <span>{t(spec.label)} · {fmt(t('heroImages.preview.size'), { w: spec.w, h: spec.h })}</span>
        <Checkbox checked={big} onChange={e => setBig(e.target.checked)} label={t('heroImages.preview.scale')} />
      </figcaption>
    </figure>
  );
}

function PreviewSet({ image, kinds }: { image: HeroImage; kinds: HeroPreviewKind[] }) {
  const { t } = useApp();
  const big = useThumb(image.id, 960);
  return (
    <div className="space-y-4">
      {(image.brightWarning?.vertical || image.brightWarning?.horizontal) && <Alert tone="warning">{t('heroImages.brightWarning')}</Alert>}
      {!big.url && !big.failed && <p className="flex items-center gap-2 text-sm text-[var(--color-fg-tertiary)]"><Spinner className="h-4 w-4" />{t('heroImages.preview.loading')}</p>}
      {big.failed && <p className="text-sm text-[var(--color-error-700)]">{t('heroImages.preview.failed')}</p>}
      {kinds.map(k => <PreviewCard key={k} kind={k} src={big.url} focal={image.focal} />)}
    </div>
  );
}

/* ── FocalPointPicker (spec §36.5) ───────────────────────────────────────── */
const clamp1 = (n: number) => Math.round(Math.max(-1, Math.min(1, n)) * 1000) / 1000;
const pctFrom = (v: number) => Math.round((v + 1) * 50);

export function FocalPointPicker({ src, value, onChange, alt }: { src?: string; value: { x: number; y: number }; onChange: (v: { x: number; y: number }) => void; alt: string }) {
  const { t } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hintId = useId();
  const [announce, setAnnounce] = useState('');
  const describe = (v: { x: number; y: number }) =>
    `${fmt(t('heroImages.focal.fromLeft'), { n: pctFrom(v.x) })}, ${fmt(t('heroImages.focal.fromTop'), { n: pctFrom(v.y) })}`;
  // Polite, debounced: say where the point is once it stops moving.
  useEffect(() => {
    const id = window.setTimeout(() => setAnnounce(describe(value)), 500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.x, value.y]);

  const fromPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    if (!r.width || !r.height) return;
    onChange({ x: clamp1(((e.clientX - r.left) / r.width) * 2 - 1), y: clamp1(((e.clientY - r.top) / r.height) * 2 - 1) });
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.02 : 0.1; // 1% / 5% of the width or height (-1..1 spans 100%)
    let next: { x: number; y: number } | null = null;
    if (e.key === 'ArrowLeft') next = { x: value.x - step, y: value.y };
    else if (e.key === 'ArrowRight') next = { x: value.x + step, y: value.y };
    else if (e.key === 'ArrowUp') next = { x: value.x, y: value.y - step };
    else if (e.key === 'ArrowDown') next = { x: value.x, y: value.y + step };
    else if (e.key === 'Home') next = { x: 0, y: 0 };
    if (!next) return;
    e.preventDefault();
    onChange({ x: clamp1(next.x), y: clamp1(next.y) });
  };
  return (
    <div className="space-y-3">
      <div
        ref={ref}
        role="group"
        aria-label={t('heroImages.focal')}
        aria-describedby={hintId}
        tabIndex={0}
        className="focal-picker"
        onKeyDown={onKeyDown}
        onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); fromPointer(e); }}
        onPointerMove={e => { if (dragging.current) fromPointer(e); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        data-testid="focal-picker"
        data-x={value.x}
        data-y={value.y}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="focal-picker__img" draggable={false} />
        ) : (
          <div className="flex aspect-[3/2] w-full items-center justify-center"><Spinner className="h-6 w-6" /></div>
        )}
        <span className="focal-picker__mark" style={{ left: `${pctFrom(value.x)}%`, top: `${pctFrom(value.y)}%` }} aria-hidden="true" />
      </div>
      <p id={hintId} className="text-sm text-[var(--color-fg-tertiary)]">{t('heroImages.focal.hint')} {t('heroImages.focal.keys')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('heroImages.focal.x')} hint={fmt(t('heroImages.focal.fromLeft'), { n: pctFrom(value.x) })}>
          <input
            type="range" min={-100} max={100} step={1}
            value={Math.round(value.x * 100)}
            aria-valuetext={fmt(t('heroImages.focal.fromLeft'), { n: pctFrom(value.x) })}
            onChange={e => onChange({ x: clamp1(Number(e.target.value) / 100), y: value.y })}
            className="min-h-11 w-full accent-[var(--color-brand-600)]"
            data-testid="focal-x"
          />
        </Field>
        <Field label={t('heroImages.focal.y')} hint={fmt(t('heroImages.focal.fromTop'), { n: pctFrom(value.y) })}>
          <input
            type="range" min={-100} max={100} step={1}
            value={Math.round(value.y * 100)}
            aria-valuetext={fmt(t('heroImages.focal.fromTop'), { n: pctFrom(value.y) })}
            onChange={e => onChange({ x: value.x, y: clamp1(Number(e.target.value) / 100) })}
            className="min-h-11 w-full accent-[var(--color-brand-600)]"
            data-testid="focal-y"
          />
        </Field>
      </div>
      <p className="sr-only" aria-live="polite" data-testid="focal-live">{announce}</p>
    </div>
  );
}

/* ── Licence fields, shared by upload and edit (spec §36.4) ───────────────── */
type LicenceForm = { source: string; photographer: string; licence: string; licenceRef: string; people: HeroPeople | ''; partnerGym: boolean; consentRef: string };
const RIGHTS_FIELDS = ['source', 'photographer', 'licence', 'licenceRef', 'people', 'consentRef'] as const;

function licenceErrors(f: LicenceForm): Partial<Record<keyof LicenceForm, MessageKey>> {
  const e: Partial<Record<keyof LicenceForm, MessageKey>> = {};
  for (const k of ['source', 'photographer', 'licence'] as const) {
    if (!f[k].trim()) e[k] = 'heroImages.required';
    else if (f[k].trim().length > TEXT_MAX) e[k] = 'heroImages.error.textTooLong';
  }
  if (f.licenceRef.trim().length > TEXT_MAX) e.licenceRef = 'heroImages.error.textTooLong';
  if (!f.people || !HERO_PEOPLE_ALLOWED.includes(f.people)) e.people = 'heroImages.required';
  if (f.partnerGym && !f.consentRef.trim()) e.consentRef = 'heroImages.required';
  else if (f.consentRef.trim().length > TEXT_MAX) e.consentRef = 'heroImages.error.textTooLong';
  return e;
}

function LicenceFields({ form, set, disabled, showErrors, serverErrors }: {
  form: LicenceForm; set: (patch: Partial<LicenceForm>) => void; disabled?: boolean;
  showErrors: Partial<Record<keyof LicenceForm, boolean>>; serverErrors: Partial<Record<keyof LicenceForm, string>>;
}) {
  const { t } = useApp();
  const errs = licenceErrors(form);
  const err = (k: keyof LicenceForm) => serverErrors[k] ?? (showErrors[k] && errs[k] ? t(errs[k]!) : undefined);
  const peopleHelpId = useId();
  return (
    <>
      <Field label={t('heroImages.source')} hint={t('heroImages.source.hint')} error={err('source')} required>
        <Input value={form.source} onChange={e => set({ source: e.target.value })} disabled={disabled} maxLength={TEXT_MAX} data-testid="hero-source" />
      </Field>
      <Field label={t('heroImages.photographer')} error={err('photographer')} required>
        <Input value={form.photographer} onChange={e => set({ photographer: e.target.value })} disabled={disabled} maxLength={TEXT_MAX} data-testid="hero-photographer" />
      </Field>
      <Field label={t('heroImages.licence')} hint={t('heroImages.licence.hint')} error={err('licence')} required>
        <Input value={form.licence} onChange={e => set({ licence: e.target.value })} disabled={disabled} maxLength={TEXT_MAX} data-testid="hero-licence" />
      </Field>
      <Field label={t('heroImages.licenceRef')} error={err('licenceRef')}>
        <Input value={form.licenceRef} onChange={e => set({ licenceRef: e.target.value })} disabled={disabled} maxLength={TEXT_MAX} data-testid="hero-licence-ref" />
      </Field>
      <fieldset className="space-y-1" aria-describedby={ONLY_NO_PEOPLE ? peopleHelpId : undefined}>
        <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">
          {t('heroImages.people')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span>
        </legend>
        {ONLY_NO_PEOPLE && <p id={peopleHelpId} className="text-xs text-[var(--color-fg-quaternary)]" data-testid="hero-people-only-none">{t('heroImages.people.onlyNone')}</p>}
        <div className="flex flex-wrap gap-x-6">
          {PEOPLE_OPTIONS.filter(o => HERO_PEOPLE_ALLOWED.includes(o.value)).map(o => (
            <Radio
              key={o.value}
              name="hero-people"
              value={o.value}
              checked={form.people === o.value}
              onChange={() => set({ people: o.value })}
              disabled={disabled}
              label={t(o.key)}
              data-testid={`hero-people-${o.value}`}
            />
          ))}
        </div>
        {err('people') && <p className="text-xs text-[var(--color-error-700)]">{err('people')}</p>}
      </fieldset>
      <Checkbox checked={form.partnerGym} onChange={e => set({ partnerGym: e.target.checked })} disabled={disabled} label={t('heroImages.partnerGym')} data-testid="hero-partner-gym" />
      {form.partnerGym && (
        <Field label={t('heroImages.consentRef')} hint={t('heroImages.consentRef.hint')} error={err('consentRef')} required>
          <Input value={form.consentRef} onChange={e => set({ consentRef: e.target.value })} disabled={disabled} maxLength={TEXT_MAX} data-testid="hero-consent-ref" />
        </Field>
      )}
    </>
  );
}

function Confirmations({ rights, faces, setRights, setFaces, disabled, rightsError, facesError }: {
  rights: boolean; faces: boolean; setRights: (v: boolean) => void; setFaces: (v: boolean) => void; disabled?: boolean; rightsError?: string; facesError?: string;
}) {
  const { t } = useApp();
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('heroImages.confirmations')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></legend>
      <Checkbox checked={rights} onChange={e => setRights(e.target.checked)} disabled={disabled} label={t('heroImages.rights.confirm')} invalid={!!rightsError} aria-required data-testid="hero-rights" />
      {rightsError && <p className="text-xs text-[var(--color-error-700)]">{rightsError}</p>}
      <Checkbox checked={faces} onChange={e => setFaces(e.target.checked)} disabled={disabled} label={t(FACES_CONFIRM_KEY)} invalid={!!facesError} aria-required data-testid="hero-faces" />
      {facesError && <p className="text-xs text-[var(--color-error-700)]">{facesError}</p>}
    </fieldset>
  );
}

/** Field-level server errors from an upload or edit refusal; anything else goes in the dialog's Alert. */
function fieldErrorsFrom(t: T, e: unknown, ctx: HeroErrorContext) {
  const code = heroErrorCode(e);
  const text = heroErrorText(t, e, ctx);
  const out: { file?: string; rights?: string; faces?: string; fields: Partial<Record<keyof LicenceForm, string>>; general?: string } = { fields: {} };
  if (code === 'image_too_small' || code === 'unsupported_file_type' || code === 'file_too_large' || code === 'no_file_provided') out.file = text;
  else if (code === 'rights_confirmation_required') out.rights = text;
  else if (code === 'no_faces_confirmation_required') out.faces = text;
  else if (code === 'licence_details_required') {
    const fields = (errorBody(e)?.fields as string[] | undefined) ?? ['source', 'photographer', 'licence'];
    for (const f of fields) if (f === 'source' || f === 'photographer' || f === 'licence') out.fields[f] = t('heroImages.required');
    out.general = text;
  } else if (code === 'invalid_people' || code === 'people_not_allowed') out.fields.people = text;
  else out.general = text;
  return out;
}

/* ── Upload dialog (spec §36.4) ───────────────────────────────────────────── */
type ChosenFile = { file: File; width: number; height: number };

/** Reads the pixel size locally (the server checks again). */
function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

const EMPTY_LICENCE: LicenceForm = {
  source: '', photographer: '', licence: '', licenceRef: '', people: ONLY_NO_PEOPLE ? 'none' : '', partnerGym: false, consentRef: '',
};

function UploadDialog({ open, onClose, onUploaded }: { open: boolean; onClose: () => void; onUploaded: (image: HeroImage) => void }) {
  const { t, token } = useApp();
  const toast = useToast();
  const [chosen, setChosen] = useState<ChosenFile | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [reading, setReading] = useState(false);
  const [form, setForm] = useState<LicenceForm>(EMPTY_LICENCE);
  const [touched, setTouched] = useState<Partial<Record<keyof LicenceForm, boolean>>>({});
  const [rights, setRights] = useState(false);
  const [faces, setFaces] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [server, setServer] = useState<ReturnType<typeof fieldErrorsFrom> | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileHintId = useId();
  const incompleteId = useId();

  useEffect(() => {
    if (!open) return;
    setChosen(null); setFileError(undefined); setForm(EMPTY_LICENCE); setTouched({}); setRights(false); setFaces(false);
    setBusy(false); setProgress(0); setServer(null);
  }, [open]);

  async function pick(file: File | undefined | null) {
    if (!file) return;
    setServer(null); setChosen(null);
    const typeOk = (HERO_ACCEPTED_TYPES as readonly string[]).includes(file.type) || (!file.type && HERO_ACCEPTED_EXT.test(file.name));
    if (!typeOk) { setFileError(t('heroImages.error.unsupportedFileType')); return; }
    if (file.size > HERO_MAX_BYTES) { setFileError(t('heroImages.error.fileTooLarge')); return; }
    setReading(true);
    const size = await readImageSize(file);
    setReading(false);
    if (!size) { setFileError(t('heroImages.error.unsupportedFileType')); return; }
    if (size.width * size.height > HERO_MAX_PIXELS) { setFileError(t('heroImages.error.tooManyPixels')); return; }
    if (size.width < HERO_MIN_WIDTH) { setFileError(t('heroImages.error.imageTooSmall')); return; }
    setFileError(undefined);
    setChosen({ file, ...size });
  }

  const errs = licenceErrors(form);
  const valid = !!chosen && !fileError && Object.keys(errs).length === 0 && rights && faces;

  async function submit() {
    if (!valid || !token || !chosen) {
      setTouched({ source: true, photographer: true, licence: true, licenceRef: true, people: true, consentRef: true });
      return;
    }
    setBusy(true); setServer(null); setProgress(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { image } = await api.uploadHeroImage(token, chosen.file, {
        source: form.source.trim(), photographer: form.photographer.trim(), licence: form.licence.trim(),
        licenceRef: form.licenceRef.trim() || undefined, people: form.people as HeroPeople,
        consentRef: form.partnerGym ? form.consentRef.trim() || undefined : undefined,
        rightsConfirmed: rights, noFacesConfirmed: faces,
      }, { onProgress: setProgress, signal: ctrl.signal });
      toast.success(t('heroImages.uploaded'));
      onUploaded(image);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (isNetworkError(e)) toast.error(t('heroImages.offline'));
      setServer(fieldErrorsFrom(t, e, 'upload'));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  const close = () => { if (busy) abortRef.current?.abort(); onClose(); };
  const set = (patch: Partial<LicenceForm>) => {
    setForm(f => ({ ...f, ...patch }));
    setTouched(tt => ({ ...tt, ...Object.fromEntries(Object.keys(patch).map(k => [k, true])) }));
    setServer(null);
  };

  return (
    <Dialog open={open} onClose={close} title={t('heroImages.upload')} size="lg">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(); }} data-testid="hero-upload-form" noValidate>
        {server?.general && <Alert tone="error">{server.general}</Alert>}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('heroImages.file')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></p>
          <div
            className={cn(
              'flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center',
              dragOver ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)]' : 'border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]',
            )}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (!busy) void pick(e.dataTransfer.files?.[0]); }}
            data-testid="hero-drop-zone"
          >
            <ImagePlus aria-hidden="true" className="h-6 w-6 text-[var(--color-fg-quaternary)]" />
            <p className="text-sm text-[var(--color-fg-tertiary)]">{t('heroImages.file.drop')}</p>
            <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}
              aria-describedby={fileHintId} data-autofocus data-testid="hero-choose-file">
              <Upload aria-hidden="true" className="h-4 w-4" />{t('heroImages.chooseFile')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={HERO_ACCEPTED_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }}
              data-testid="hero-file-input"
            />
            {reading && <p className="text-xs text-[var(--color-fg-tertiary)]">{t('heroImages.file.reading')}</p>}
            {chosen && (
              <p className="text-sm font-medium text-[var(--color-fg-primary)] [overflow-wrap:anywhere]" data-testid="hero-file-chosen">
                {fmt(t('heroImages.file.chosen'), { name: chosen.file.name, size: formatBytes(chosen.file.size), w: chosen.width, h: chosen.height })}
              </p>
            )}
          </div>
          {(fileError || server?.file)
            ? <p id={fileHintId} className="text-xs text-[var(--color-error-700)]" data-testid="hero-file-error">{server?.file ?? fileError}</p>
            : <p id={fileHintId} className="text-xs text-[var(--color-fg-quaternary)]">{t('heroImages.file.hint')}</p>}
        </div>

        <LicenceFields form={form} set={set} disabled={busy} showErrors={touched} serverErrors={server?.fields ?? {}} />
        <Confirmations
          rights={rights} faces={faces}
          setRights={v => { setRights(v); setServer(null); }} setFaces={v => { setFaces(v); setServer(null); }}
          disabled={busy} rightsError={server?.rights} facesError={server?.faces}
        />

        {busy && (
          <div className="space-y-1">
            <div
              role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
              aria-label={t('heroImages.upload')}
              className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]"
              data-testid="hero-upload-progress"
            >
              <div className="h-full bg-[var(--color-brand-600)] transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-xs text-[var(--color-fg-tertiary)]">{fmt(t('heroImages.upload.progress'), { n: Math.round(progress * 100) })}</p>
          </div>
        )}
        {!valid && !busy && <p id={incompleteId} className="text-xs text-[var(--color-fg-quaternary)]">{t('heroImages.upload.incomplete')}</p>}
      </form>
      <DialogFooter>
        <Button variant="secondary" onClick={close} data-testid="hero-upload-cancel">{t('common.cancel')}</Button>
        <Button onClick={() => void submit()} disabled={!valid} loading={busy} aria-describedby={!valid ? incompleteId : undefined} data-testid="hero-upload-submit">
          {t('heroImages.upload.submit')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ── Edit view: focal point, previews, licence details (spec §36.5) ───────── */
function EditDialog({ image, onClose, onSaved }: { image: HeroImage | null; onClose: () => void; onSaved: () => void }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [focal, setFocal] = useState({ x: 0, y: 0 });
  const [form, setForm] = useState<LicenceForm>(EMPTY_LICENCE);
  const [initial, setInitial] = useState<LicenceForm>(EMPTY_LICENCE);
  const [rights, setRights] = useState(false);
  const [faces, setFaces] = useState(false);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<ReturnType<typeof fieldErrorsFrom> | null>(null);
  const big = useThumb(image?.id, 960);

  useEffect(() => {
    if (!image) return;
    const f: LicenceForm = {
      source: image.source ?? '', photographer: image.photographer ?? '', licence: image.licence ?? '', licenceRef: image.licenceRef ?? '',
      people: HERO_PEOPLE_ALLOWED.includes(image.people) ? image.people : '', partnerGym: !!image.consentRef, consentRef: image.consentRef ?? '',
    };
    setInitial({ ...f, people: image.people });
    // Only the allowed answers can be picked: an older photo with people must be re-answered (owner 2026-10-19).
    setForm({ ...f, people: f.people || (ONLY_NO_PEOPLE ? 'none' : '') });
    setFocal({ x: image.focal?.x ?? image.focalX ?? 0, y: image.focal?.y ?? image.focalY ?? 0 });
    setRights(false); setFaces(false); setBusy(false); setServer(null);
  }, [image]);

  if (!image) return null;
  const consentOf = (f: LicenceForm) => (f.partnerGym ? f.consentRef.trim() : '');
  const changedRights = RIGHTS_FIELDS.filter(k => (k === 'consentRef' ? consentOf(form) !== consentOf(initial) : String(form[k]).trim() !== String(initial[k]).trim()));
  const focalChanged = focal.x !== (image.focal?.x ?? 0) || focal.y !== (image.focal?.y ?? 0);
  const needsConfirm = changedRights.length > 0;
  const errs = licenceErrors(form);
  const valid = Object.keys(errs).length === 0 && (!needsConfirm || (rights && faces));
  const retired = image.status === 'retired';

  async function save() {
    if (!token || !image || !valid) return;
    const patch: HeroImagePatch = {};
    if (focalChanged) patch.focal = focal;
    for (const k of changedRights) {
      if (k === 'consentRef') patch.consentRef = consentOf(form) || null;
      else if (k === 'licenceRef') patch.licenceRef = form.licenceRef.trim() || null;
      else if (k === 'people') patch.people = form.people as HeroPeople;
      else patch[k] = form[k].trim();
    }
    if (needsConfirm) { patch.rightsConfirmed = rights; patch.noFacesConfirmed = faces; }
    if (!Object.keys(patch).length) { onClose(); return; }
    setBusy(true); setServer(null);
    try {
      await api.updateHeroImage(token, image.id, patch);
      toast.success(t('heroImages.edit.saved'));
      onSaved();
    } catch (e) {
      if (isNetworkError(e)) toast.error(t('heroImages.offline'));
      setServer(fieldErrorsFrom(t, e, 'edit'));
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<LicenceForm>) => { setForm(f => ({ ...f, ...patch })); setServer(null); };
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={t('heroImages.edit.title')} description={photoAlt(t, image)} size="full">
      <div className="space-y-6" data-testid="hero-edit">
        {server?.general && <Alert tone="error">{server.general}</Alert>}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('heroImages.focal')}</h3>
            <FocalPointPicker src={big.url} value={focal} onChange={setFocal} alt={photoAlt(t, image)} />
          </div>
          <div className="min-w-0 space-y-3">
            <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('heroImages.preview')}</h3>
            <PreviewSet image={{ ...image, focal }} kinds={['phone', 'band', 'desktop']} />
          </div>
        </div>
        <section className="space-y-4" aria-labelledby="hero-edit-details">
          <h3 id="hero-edit-details" className="text-base font-semibold text-[var(--color-fg-primary)]">{t('heroImages.details')}</h3>
          <p className="text-xs text-[var(--color-fg-tertiary)]">
            {fmt(t('heroImages.uploadedBy'), { name: image.createdByName ?? t('heroImages.history.unknownPerson'), date: eatDateTimeYear(image.createdAt, locale) })}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <LicenceFields form={form} set={set} disabled={busy || retired} showErrors={{ source: true, photographer: true, licence: true, licenceRef: true, people: true, consentRef: true }} serverErrors={server?.fields ?? {}} />
          </div>
          {(needsConfirm || server?.rights || server?.faces) && (
            <div className="space-y-2" data-testid="hero-edit-reconfirm">
              <Alert tone="info">{t('heroImages.edit.reconfirm')}</Alert>
              <Confirmations rights={rights} faces={faces} setRights={setRights} setFaces={setFaces} disabled={busy} rightsError={server?.rights} facesError={server?.faces} />
            </div>
          )}
        </section>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button onClick={() => void save()} disabled={!valid || retired} loading={busy} data-testid="hero-edit-save">{t('heroImages.save')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ── Choose photos for a place (spec §36.2) ───────────────────────────────── */
function ChooseDialog({ slot, images, onClose, onSaved }: { slot: HeroSlot | null; images: HeroImage[]; onClose: () => void; onSaved: () => void }) {
  const { t, token } = useApp();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (slot) { setSelected(slot.draft); setError(null); setBusy(false); } }, [slot]);
  if (!slot) return null;
  const choosable = images.filter(i => i.status !== 'retired');
  const byId = new Map(images.map(i => [i.id, i]));
  const full = selected.length >= slot.maxImages;
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : s.length < slot.maxImages ? [...s, id] : s));
  const move = (i: number, d: -1 | 1) => setSelected(s => { const n = [...s]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  async function save() {
    if (!token || !slot) return;
    setBusy(true); setError(null);
    try {
      await api.setHeroSlot(token, slot.id, selected);
      toast.success(t('heroImages.savedDraft'));
      onSaved();
    } catch (e) {
      if (isNetworkError(e)) toast.error(t('heroImages.offline'));
      setError(heroErrorText(t, e, 'slot'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={fmt(t('heroImages.choose.title'), { place: slotLabel(t, slot.id) })} description={t('heroImages.savedDraft')} size="xl">
      <div className="space-y-4" data-testid="hero-choose">
        {error && <Alert tone="error">{error}</Alert>}
        {slot.maxImages > 1 && (
          <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="hero-choose-count">
            {fmt(t('heroImages.countOfMax'), { n: selected.length, max: slot.maxImages })} · {fmt(t('heroImages.choose.max'), { max: slot.maxImages })}
          </p>
        )}
        {!choosable.length ? <p className="text-sm text-[var(--color-fg-tertiary)]">{t('heroImages.choose.noPhotos')}</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {choosable.map(img => {
              const on = selected.includes(img.id);
              return (
                <li key={img.id} className={cn('rounded-[var(--radius-lg)] border p-2', on ? 'border-[var(--color-brand-600)]' : 'border-[var(--color-border-secondary)]')}>
                  <HeroThumb id={img.id} image={img} className="aspect-[3/2] w-full" />
                  <Checkbox checked={on} disabled={!on && full} onChange={() => toggle(img.id)} label={photoAlt(t, img)} data-testid={`hero-choose-${img.id}`} />
                  {brightFor(img, slot) && <Badge tone="warning">{t('heroImages.bright')}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
        <section aria-labelledby="hero-choose-selected" className="space-y-2">
          <h3 id="hero-choose-selected" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('heroImages.choose.selected')}</h3>
          {!selected.length ? <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="hero-choose-none">{t('heroImages.choose.none')}</p> : (
            <ol className="space-y-2" data-testid="hero-choose-order">
              {selected.map((id, i) => (
                <li key={id} className="flex items-center gap-3" data-image-id={id}>
                  <span className="w-5 text-sm tabular-nums text-[var(--color-fg-tertiary)]">{i + 1}.</span>
                  <HeroThumb id={id} image={byId.get(id)} />
                  <span className="min-w-0 flex-1 truncate text-sm">{photoAlt(t, byId.get(id)) || id}</span>
                  <Button variant="ghost" size="sm" className="min-h-11" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t('heroImages.moveUp')}: ${photoAlt(t, byId.get(id))}`}><ArrowUp aria-hidden="true" className="h-4 w-4" />{t('heroImages.moveUp')}</Button>
                  <Button variant="ghost" size="sm" className="min-h-11" onClick={() => move(i, 1)} disabled={i === selected.length - 1} aria-label={`${t('heroImages.moveDown')}: ${photoAlt(t, byId.get(id))}`}><ArrowDown aria-hidden="true" className="h-4 w-4" />{t('heroImages.moveDown')}</Button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <DialogFooter className="flex-wrap">
        <Button variant="ghost" className="mr-auto" onClick={() => setSelected([])} disabled={busy || !selected.length} data-testid="hero-use-built-in">{t('heroImages.useBuiltIn')}</Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button onClick={() => void save()} loading={busy} disabled={sameList(selected, slot.draft)} data-testid="hero-choose-save">{t('heroImages.save')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

function SlotPreviewDialog({ slot, image, onClose }: { slot: HeroSlot | null; image?: HeroImage; onClose: () => void }) {
  const { t } = useApp();
  if (!slot || !image) return null;
  const kinds: HeroPreviewKind[] = slot.id === 'footerPool' || slot.variant === 'band' ? ['footer'] : slot.variant === 'panel' ? ['panel'] : ['phone', 'band', 'desktop'];
  return (
    <Dialog open onClose={onClose} title={fmt(t('heroImages.preview.title'), { place: slotLabel(t, slot.id) })} description={photoAlt(t, image)} size="xl">
      <div data-testid="hero-slot-preview"><PreviewSet image={image} kinds={kinds} /></div>
      <DialogFooter><Button variant="secondary" onClick={onClose}>{t('common.close')}</Button></DialogFooter>
    </Dialog>
  );
}

/* ── Before → after lists (publish and put back) ─────────────────────────── */
type SlotChange = { slotId: string; before: string[]; after: string[] };
function diffSlots(before: Record<string, string[]>, after: Record<string, string[]>, order: string[]): SlotChange[] {
  const ids = [...order, ...Object.keys({ ...before, ...after }).filter(k => !order.includes(k))];
  return ids.filter(id => !sameList(before[id] ?? [], after[id] ?? [])).map(id => ({ slotId: id, before: before[id] ?? [], after: after[id] ?? [] }));
}

function ChangeList({ changes, images, slots }: { changes: SlotChange[]; images: Map<string, HeroImage>; slots: Map<string, HeroSlot> }) {
  const { t } = useApp();
  return (
    <ul className="divide-y divide-[var(--color-border-secondary)] text-left" data-testid="hero-change-list">
      {changes.map(c => (
        <li key={c.slotId} className="space-y-2 py-3" data-slot-id={c.slotId}>
          <p className="text-sm font-semibold text-[var(--color-fg-primary)]">{slotLabel(t, c.slotId)}</p>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
            <span className="text-[var(--color-fg-tertiary)]">{t('heroImages.before')}</span>
            <ThumbRow ids={c.before} images={images} slot={slots.get(c.slotId)} emptyText={t('heroImages.builtIn')} />
            <span className="text-[var(--color-fg-tertiary)]">{t('heroImages.after')}</span>
            <ThumbRow ids={c.after} images={images} slot={slots.get(c.slotId)} emptyText={t('heroImages.builtIn')} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PublishDialog({ open, changes, images, slots, onClose, onPublished }: {
  open: boolean; changes: SlotChange[]; images: Map<string, HeroImage>; slots: Map<string, HeroSlot>; onClose: () => void; onPublished: (p: HeroPublication) => void;
}) {
  const { t, token } = useApp();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setNote(''); setBusy(false); setError(null); } }, [open]);
  async function publish() {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const { publication } = await api.publishHeroSlots(token, note.trim() || undefined);
      toast.success(fmt(t('heroImages.published'), { id: publication.id }));
      onPublished(publication);
    } catch (e) {
      if (isNetworkError(e)) toast.error(t('heroImages.offline'));
      setError(heroErrorText(t, e, 'publish'));
    } finally {
      setBusy(false);
    }
  }
  // Not dismissable while the server builds the public files.
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('heroImages.publish.title')} description={fmt(t('heroImages.publish.count'), { n: changes.length })} size="lg">
      <div className="space-y-4" data-testid="hero-publish-dialog">
        {error && (
          <Alert tone="error">
            <p>{t('heroImages.error.publishFailed')}</p>
            <p className="mt-1 font-normal" data-testid="hero-publish-error">{error}</p>
          </Alert>
        )}
        <ChangeList changes={changes} images={images} slots={slots} />
        <Field label={t('heroImages.publish.note')} hint={t('heroImages.publish.noteHint')}>
          <Textarea value={note} onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))} maxLength={NOTE_MAX} rows={2} disabled={busy} data-testid="hero-publish-note" />
        </Field>
        <p className="text-sm text-[var(--color-fg-tertiary)]">{t('heroImages.publish.when')}</p>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button onClick={() => void publish()} loading={busy} data-testid="hero-publish-confirm">{error ? t('common.tryAgain') : t('heroImages.publish')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
function PlacesTab({ state, images, onChoose, onPreview }: { state: HeroImagesState; images: Map<string, HeroImage>; onChoose: (s: HeroSlot) => void; onPreview: (s: HeroSlot) => void }) {
  const { t } = useApp();
  const areas = state.areas?.length ? state.areas : DEFAULT_AREAS;
  const groups = new Map<string, HeroSlot[]>();
  for (const s of state.slots) {
    const area = isKnownSlot(s.id) && areas.includes(s.area) && AREA_KEYS[s.area] ? s.area : 'other';
    groups.set(area, [...(groups.get(area) ?? []), s]);
  }
  const order = [...areas.filter(a => AREA_KEYS[a]), 'other'];
  return (
    <div className="space-y-6" data-testid="hero-places">
      {order.filter(a => groups.get(a)?.length).map(area => (
        <Card key={area} data-testid={`hero-area-${area}`}>
          <CardContent className="space-y-1">
            <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t(AREA_KEYS[area])}</h2>
            <ul className="divide-y divide-[var(--color-border-secondary)]">
              {groups.get(area)!.map(slot => {
                const changed = !sameList(slot.draft, slot.published);
                return (
                  <li key={slot.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:justify-between" data-testid={`hero-slot-${slot.id}`}>
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{slotLabel(t, slot.id)}</h3>
                        {changed && <Badge tone="warning">{t('heroImages.changed')}</Badge>}
                        {slot.maxImages > 1 && <span className="text-xs text-[var(--color-fg-tertiary)]" data-testid="hero-slot-count">{fmt(t('heroImages.countOfMax'), { n: slot.draft.length, max: slot.maxImages })}</span>}
                      </div>
                      <p className="text-sm text-[var(--color-fg-tertiary)]">{slotWhere(t, slot.id)}</p>
                      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
                        <span className="text-xs font-medium text-[var(--color-fg-tertiary)]">{t('heroImages.livePhotos')}</span>
                        <span data-testid="hero-slot-published"><ThumbRow ids={slot.published} images={images} slot={slot} emptyText={t('heroImages.empty')} /></span>
                        {changed && (
                          <>
                            <span className="text-xs font-medium text-[var(--color-fg-tertiary)]">{t('heroImages.draftPhotos')}</span>
                            <span data-testid="hero-slot-draft"><ThumbRow ids={slot.draft} images={images} slot={slot} emptyText={t('heroImages.empty')} /></span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="secondary" className="min-h-11" onClick={() => onChoose(slot)} aria-label={`${t('heroImages.choose')}: ${slotLabel(t, slot.id)}`} data-testid={`hero-choose-btn-${slot.id}`}>{t('heroImages.choose')}</Button>
                      <Button variant="ghost" className="min-h-11" onClick={() => onPreview(slot)} disabled={!slot.draft.length} aria-label={`${t('heroImages.preview')}: ${slotLabel(t, slot.id)}`} data-testid={`hero-preview-btn-${slot.id}`}>{t('heroImages.preview')}</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LibraryTab({ state, onUpload, onEdit, onRetire, onUnpublish }: {
  state: HeroImagesState; onUpload: () => void; onEdit: (i: HeroImage) => void; onRetire: (i: HeroImage) => void; onUnpublish: (i: HeroImage) => void;
}) {
  const { t } = useApp();
  const [filter, setFilter] = useState<'all' | LibraryState>('all');
  const filterId = useId();
  if (!state.images.length) {
    return <EmptyState icon={<Images />} title={t('heroImages.library.empty')} action={<Button onClick={onUpload}>{t('heroImages.upload')}</Button>} />;
  }
  const sorted = [...state.images].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const shown = sorted.filter(i => filter === 'all' || libraryState(i) === filter);
  const usedIn = (id: string) => state.slots.filter(s => s.draft.includes(id) || s.published.includes(id)).length;
  const inDraft = (id: string) => state.slots.some(s => s.draft.includes(id));
  const draftPlaces = (id: string) => state.slots.filter(s => s.draft.includes(id)).map(s => s.id);
  const STATUS: Record<LibraryState, { key: MessageKey; tone: 'default' | 'success' | 'gray' }> = {
    draft: { key: 'heroImages.status.draft', tone: 'default' },
    published: { key: 'heroImages.status.published', tone: 'success' },
    retired: { key: 'heroImages.status.retired', tone: 'gray' },
  };
  const PEOPLE_KEY = Object.fromEntries(PEOPLE_OPTIONS.map(o => [o.value, o.key])) as Record<HeroPeople, MessageKey>;
  return (
    <div className="space-y-4" data-testid="hero-library">
      <div className="flex max-w-xs items-center gap-3">
        <label htmlFor={filterId} className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('heroImages.filter')}</label>
        <Select id={filterId} value={filter} onChange={e => setFilter(e.target.value as typeof filter)} data-testid="hero-library-filter">
          <option value="all">{t('heroImages.filter.all')}</option>
          <option value="draft">{t('heroImages.status.draft')}</option>
          <option value="published">{t('heroImages.status.published')}</option>
          <option value="retired">{t('heroImages.status.retired')}</option>
        </Select>
      </div>
      {!shown.length ? <p className="text-sm text-[var(--color-fg-tertiary)]">{t('heroImages.library.noMatch')}</p> : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(img => {
            const st = STATUS[libraryState(img)];
            const blocked = inDraft(img.id);
            const live = isLiveImage(img, state.slots);
            const retireHintId = `hero-retire-hint-${img.id}`;
            return (
              <li key={img.id}>
                <Card className="overflow-hidden" data-testid={`hero-image-${img.id}`}>
                  <HeroThumb id={img.id} image={img} className="block aspect-[3/2] w-full rounded-none" />
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={st.tone}>{t(st.key)}</Badge>
                      {live && <Badge tone="brand">{t('heroImages.live')}</Badge>}
                      {!live && img.unpublishedInPublication != null && <Badge tone="gray">{t('heroImages.removedFromApp')}</Badge>}
                      {PEOPLE_KEY[img.people] && <Badge tone="gray">{t(PEOPLE_KEY[img.people])}</Badge>}
                      {brightFor(img) && <Badge tone="warning">{t('heroImages.bright')}</Badge>}
                    </div>
                    <p className="text-sm text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{photoAlt(t, img)}</p>
                    <p className="text-xs text-[var(--color-fg-tertiary)]">{fmt(t('heroImages.usedIn'), { n: usedIn(img.id) })}</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button variant="secondary" className="min-h-11" onClick={() => onEdit(img)} disabled={img.status === 'retired'} aria-label={`${t('heroImages.edit')}: ${photoAlt(t, img)}`} data-testid={`hero-edit-${img.id}`}>{t('heroImages.edit')}</Button>
                      {live && (
                        <Button variant="secondary" className="min-h-11" onClick={() => onUnpublish(img)} aria-label={`${t('heroImages.unpublish')}: ${photoAlt(t, img)}`} data-testid={`hero-unpublish-${img.id}`}>{t('heroImages.unpublish')}</Button>
                      )}
                      {img.status !== 'retired' && (
                        <Button
                          variant="ghost" className="min-h-11"
                          onClick={() => onRetire(img)} disabled={blocked}
                          title={blocked ? fmt(t('heroImages.retire.blockedIn'), { places: placesList(t, draftPlaces(img.id)) }) : undefined}
                          aria-describedby={blocked ? retireHintId : undefined}
                          aria-label={`${t('heroImages.retire')}: ${photoAlt(t, img)}`}
                          data-testid={`hero-retire-${img.id}`}
                        >{t('heroImages.retire')}</Button>
                      )}
                    </div>
                    {blocked && img.status !== 'retired' && <p id={retireHintId} className="text-xs text-[var(--color-fg-tertiary)]">{fmt(t('heroImages.retire.blockedIn'), { places: placesList(t, draftPlaces(img.id)) })}</p>}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HistoryTab({ state, onRollback }: { state: HeroImagesState; onRollback: (p: HeroPublication) => void }) {
  const { t, locale } = useApp();
  const pubs = state.publications;
  if (!pubs.length) return <EmptyState title={t('heroImages.history.empty')} />;
  const order = state.slots.map(s => s.id);
  return (
    <Table aria-label={t('heroImages.history.table')} data-testid="hero-history">
      <THead>
        <Tr>
          <Th>{t('heroImages.history.version')}</Th>
          <Th>{t('heroImages.history.when')}</Th>
          <Th>{t('heroImages.history.by')}</Th>
          <Th>{t('heroImages.history.note')}</Th>
          <Th>{t('heroImages.history.changes')}</Th>
          <Th><span className="sr-only">{t('heroImages.history.putBack')}</span></Th>
        </Tr>
      </THead>
      <TBody>
        {pubs.map((p, i) => {
          const n = diffSlots(pubs[i + 1]?.slots ?? {}, p.slots ?? {}, order).length;
          return (
            <Tr key={p.id} data-testid={`hero-version-${p.id}`}>
              <Td>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium tabular-nums">#{p.id}</span>
                  {i === 0 && <Badge tone="success">{t('heroImages.history.current')}</Badge>}
                  {p.rolledBackFrom != null && <Badge tone="gray">{fmt(t('heroImages.history.fromRollback'), { id: p.rolledBackFrom })}</Badge>}
                </span>
              </Td>
              <Td className="whitespace-nowrap">{eatDateTimeYear(p.publishedAt, locale)}</Td>
              <Td>{p.publishedByName || t('heroImages.history.unknownPerson')}</Td>
              <Td className="max-w-xs [overflow-wrap:anywhere]">{p.note || '—'}</Td>
              <Td className="whitespace-nowrap">{fmt(t('heroImages.history.places'), { n })}</Td>
              <Td>
                {i > 0 && (
                  <Button variant="secondary" size="sm" className="min-h-11 whitespace-nowrap" onClick={() => onRollback(p)} data-testid={`hero-rollback-${p.id}`}>
                    {t('heroImages.rollback')}
                  </Button>
                )}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

/* ── The screen ──────────────────────────────────────────────────────────── */
type Tab = 'places' | 'library' | 'history';
type Status = 'loading' | 'ready' | 'off' | 'error';

export function HeroImageManager() {
  const { t, token } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<HeroImagesState | null>(null);
  const [tab, setTab] = useState<Tab>('places');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [rollbackTo, setRollbackTo] = useState<HeroPublication | null>(null);
  const [retiring, setRetiring] = useState<HeroImage | null>(null);
  const [unpublishing, setUnpublishing] = useState<HeroImage | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const publishHintId = useId();

  const store = useMemo(() => new ThumbStore(token), [token]);
  useEffect(() => { store.open(); return () => store.close(); }, [store]);

  const load = useCallback(async (quiet = false) => {
    if (!token) return;
    if (!quiet) setStatus('loading');
    try {
      const next = await api.adminHeroImages(token);
      setState(next);
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setStatus('off'); return; }
      if (isNetworkError(e)) toast.error(t('heroImages.offline'));
      setLoadError(e instanceof ApiError && e.status === 403 ? heroErrorText(t, e, 'load') : null);
      setStatus('error');
    }
  }, [token, t, toast]);
  useEffect(() => { void load(); }, [load]);

  const images = useMemo(() => new Map((state?.images ?? []).map(i => [i.id, i])), [state]);
  const slots = useMemo(() => new Map((state?.slots ?? []).map(s => [s.id, s])), [state]);
  const order = useMemo(() => (state?.slots ?? []).map(s => s.id), [state]);
  const pending = useMemo(() => (state ? state.slots.filter(s => !sameList(s.draft, s.published)).map(s => ({ slotId: s.id, before: s.published, after: s.draft })) : []), [state]);

  async function runAction(kind: 'rollback' | 'retire' | 'unpublish') {
    if (!token) return;
    setActionBusy(true); setActionError(null);
    try {
      if (kind === 'rollback' && rollbackTo) {
        await api.rollbackHeroSlots(token, rollbackTo.id);
        toast.success(fmt(t('heroImages.rollback.done'), { id: rollbackTo.id }));
        setRollbackTo(null);
      } else if (kind === 'retire' && retiring) {
        const res = await api.updateHeroImage(token, retiring.id, { status: 'retired' });
        toast.success(res.inLiveSnapshot ? t('heroImages.retired.live') : t('heroImages.retired'));
        setRetiring(null);
      } else if (kind === 'unpublish' && unpublishing) {
        await api.unpublishHeroImage(token, unpublishing.id);
        // Drafts are untouched: say so when a place still has it chosen (the next publish brings it back).
        const stillDrafted = state?.slots.filter(sl => sl.draft.includes(unpublishing.id)).map(sl => sl.id) ?? [];
        toast.success(stillDrafted.length
          ? fmt(t('heroImages.unpublish.doneStillDrafted'), { places: placesList(t, stillDrafted) })
          : t('heroImages.unpublish.done'));
        setUnpublishing(null);
      }
      await load(true);
    } catch (e) {
      if (isNetworkError(e)) toast.error(t('heroImages.offline'));
      const lead = kind === 'rollback' ? t('heroImages.error.rollbackFailed') : kind === 'unpublish' ? t('heroImages.error.unpublishFailed') : '';
      const why = heroErrorText(t, e, kind);
      setActionError(lead ? `${lead} ${why}` : why);
    } finally {
      setActionBusy(false);
    }
  }

  const header = (
    <PageHeader
      title={t('heroImages.title')}
      description={t('heroImages.subtitle')}
      actions={status === 'ready' ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setUploadOpen(true)} data-testid="hero-upload-open"><Upload aria-hidden="true" className="h-4 w-4" />{t('heroImages.upload')}</Button>
          <div className="flex flex-col items-end">
            <Button onClick={() => setPublishOpen(true)} disabled={!pending.length} aria-describedby={!pending.length ? publishHintId : undefined} data-testid="hero-publish-open">{t('heroImages.publish')}</Button>
            {!pending.length && <span id={publishHintId} className="mt-1 text-xs text-[var(--color-fg-tertiary)]" data-testid="hero-publish-none">{t('heroImages.publish.none')}</span>}
          </div>
        </div>
      ) : undefined}
    />
  );

  let body: ReactNode;
  if (status === 'loading') {
    body = <div className="space-y-4" aria-busy="true" data-testid="hero-loading"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonTable rows={3} /></div>;
  } else if (status === 'off') {
    body = <EmptyState icon={<Images />} title={t('heroImages.off.title')} body={t('heroImages.off.body')} />;
  } else if (status === 'error' || !state) {
    body = <ErrorState title={t('heroImages.loadError')} message={loadError ?? undefined} onRetry={() => void load()} retryLabel={t('common.tryAgain')} />;
  } else {
    const editImage = editing ? images.get(editing) ?? null : null;
    const chooseSlot = choosing ? slots.get(choosing) ?? null : null;
    const previewSlot = previewing ? slots.get(previewing) ?? null : null;
    const rollbackChanges = rollbackTo ? diffSlots(state.publications[0]?.slots ?? {}, rollbackTo.slots ?? {}, order) : [];
    body = (
      <div className="space-y-6">
        <Alert tone="info">{t('heroImages.remoteNote')}</Alert>
        <nav aria-label={t('heroImages.tabs')}>
          <Segmented
            value={tab}
            onChange={v => setTab(v as Tab)}
            options={[['places', t('heroImages.tab.places')], ['library', t('heroImages.tab.library')], ['history', t('heroImages.tab.history')]]}
            className="w-fit"
          />
        </nav>
        {tab === 'places' && <PlacesTab state={state} images={images} onChoose={s => setChoosing(s.id)} onPreview={s => setPreviewing(s.id)} />}
        {tab === 'library' && (
          <LibraryTab
            state={state}
            onUpload={() => setUploadOpen(true)}
            onEdit={i => setEditing(i.id)}
            onRetire={i => { setActionError(null); setRetiring(i); }}
            onUnpublish={i => { setActionError(null); setUnpublishing(i); }}
          />
        )}
        {tab === 'history' && <HistoryTab state={state} onRollback={p => { setActionError(null); setRollbackTo(p); }} />}

        <EditDialog image={editImage} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(true); }} />
        <ChooseDialog slot={chooseSlot} images={state.images} onClose={() => setChoosing(null)} onSaved={() => { setChoosing(null); void load(true); }} />
        <SlotPreviewDialog slot={previewSlot} image={previewSlot ? images.get(previewSlot.draft[0]) : undefined} onClose={() => setPreviewing(null)} />
        <PublishDialog
          open={publishOpen} changes={pending} images={images} slots={slots}
          onClose={() => setPublishOpen(false)}
          onPublished={() => { setPublishOpen(false); setTab('history'); void load(true); }}
        />
        <ConfirmDialog
          open={!!rollbackTo}
          onClose={() => { if (!actionBusy) setRollbackTo(null); }}
          onConfirm={() => void runAction('rollback')}
          title={fmt(t('heroImages.rollback.title'), { id: rollbackTo?.id ?? '' })}
          description={(
            <div className="space-y-2" data-testid="hero-rollback-confirm">
              {actionError && <Alert tone="error">{actionError}</Alert>}
              {rollbackChanges.length ? (
                <>
                  <p>{fmt(t('heroImages.publish.count'), { n: rollbackChanges.length })}</p>
                  <ChangeList changes={rollbackChanges} images={images} slots={slots} />
                </>
              ) : <p>{t('heroImages.rollback.same')}</p>}
            </div>
          )}
          confirmLabel={t('heroImages.rollback.confirm')}
          tone="primary"
          busy={actionBusy}
        />
        <ConfirmDialog
          open={!!retiring}
          onClose={() => { if (!actionBusy) setRetiring(null); }}
          onConfirm={() => void runAction('retire')}
          title={t('heroImages.retire.title')}
          description={(
            <div className="space-y-2" data-testid="hero-retire-confirm">
              {actionError && <Alert tone="error">{actionError}</Alert>}
              <p>{t('heroImages.retire.body')}</p>
            </div>
          )}
          confirmLabel={t('heroImages.retire')}
          busy={actionBusy}
        />
        <ConfirmDialog
          open={!!unpublishing}
          onClose={() => { if (!actionBusy) setUnpublishing(null); }}
          onConfirm={() => void runAction('unpublish')}
          title={t('heroImages.unpublish.title')}
          description={(
            <div className="space-y-2" data-testid="hero-unpublish-confirm">
              {actionError && <Alert tone="error">{actionError}</Alert>}
              <p>{t('heroImages.unpublish.body')}</p>
            </div>
          )}
          confirmLabel={t('heroImages.unpublish')}
          busy={actionBusy}
        />
      </div>
    );
  }

  return (
    <ThumbCtx.Provider value={store}>
      <div data-testid="hero-images-page">
        {header}
        {body}
        <UploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={image => { setUploadOpen(false); setTab('library'); void load(true).then(() => setEditing(image.id)); }}
        />
      </div>
    </ThumbCtx.Provider>
  );
}
