'use client';
// Partner photos (design spec photo-hero-screens §40, §43; backend functions#277): pieces shared by the
// review queue (partner-media-review.tsx) and the "Home photo and logo" dialog (partner-media-set-dialog.tsx).
//
// - Previews are fetched as blobs with the admin's token from the item's root-relative previewUrl and shown
//   from object URLs, one request at a time, cached for the visit and revoked on unmount (§43.6, AC-P37).
// - The band preview draws the app's home band at its real size with the real scrim, the partner's name as
//   the eyebrow, that role's headline (§25) and the logo plate (§40.2).
import {
  createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { useApp } from '../../app/providers';
import {
  errorCode, fillTemplate as fill, HEADLINE_KEYS, isNetworkError, KIND_KEY, NOTE_MAX, partnerMediaApi, partnerMediaErrorText,
  reasonLabelKey, reasonPartnerKey, reasonsFor, takedownReady,
  type PartnerMediaItem, type PartnerPreviewWidth, type PartnerSubject, type PlateTone, type TakedownReason,
} from '@/lib/partner-media';
import type { MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { focalToObjectPosition } from './photo-panel';
import { ScaledFrame } from './hero-image-manager';
import { Alert, Field, Radio, Textarea, useToast, type ToastApi } from './shared';
import { Dialog, DialogFooter } from './dialog';
import { Button } from './shared';

type T = (key: MessageKey) => string;

/* ── Authenticated previews ─────────────────────────────────────────────── */
type PreviewStatus = { url?: string; failed?: boolean };

export class PreviewStore {
  private entries = new Map<string, PreviewStatus>();
  private started = new Set<string>();
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private token: string | null) {}
  /** (Re)opens after a close: React strict mode unmounts and remounts once in development. */
  open() { this.closed = false; this.started.clear(); }
  private key(url: string, w: PartnerPreviewWidth) { return `${url}@${w}`; }
  get(url: string, w: PartnerPreviewWidth) { return this.entries.get(this.key(url, w)); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach(fn => fn()); }
  load(url: string, w: PartnerPreviewWidth) {
    const k = this.key(url, w);
    if (this.started.has(k) || !this.token || this.closed) return;
    this.started.add(k);
    const token = this.token;
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      try {
        const blob = await partnerMediaApi.preview(token, url, w);
        if (this.closed) return;
        this.entries.set(k, { url: URL.createObjectURL(blob) });
      } catch {
        this.entries.set(k, { failed: true });
        this.started.delete(k); // a later view may try again
      }
      this.emit();
    });
  }
  close() {
    this.closed = true;
    this.entries.forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
    this.entries.clear();
    this.listeners.clear();
  }
}
const PreviewCtx = createContext<PreviewStore | null>(null);

/** Gives its children one preview cache; object URLs are revoked when it unmounts. */
export function PartnerPreviewProvider({ children }: { children: ReactNode }) {
  const { token } = useApp();
  const store = useMemo(() => new PreviewStore(token), [token]);
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  return <PreviewCtx.Provider value={store}>{children}</PreviewCtx.Provider>;
}

/** The object URL of a live item's preview (nothing for a deleted file). */
export function usePreview(item: Pick<PartnerMediaItem, 'previewUrl'> | null | undefined, w: PartnerPreviewWidth, visible = true): PreviewStatus {
  const store = useContext(PreviewCtx);
  const [, bump] = useState(0);
  const url = item?.previewUrl ?? null;
  useEffect(() => store?.subscribe(() => bump(n => n + 1)), [store]);
  useEffect(() => { if (store && url && visible) store.load(url, w); }, [store, url, w, visible]);
  return (url && store?.get(url, w)) || {};
}

/** Visible yet? (lazy previews) */
export function useInView<E extends Element>(): [React.RefObject<E | null>, boolean] {
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

/* ── Labels ─────────────────────────────────────────────────────────────── */
export const subjectName = (t: T, s: PartnerSubject | null | undefined) => s?.name || s?.id || t('partnerMedia.unknownPerson');
export const itemAlt = (t: T, item: Pick<PartnerMediaItem, 'kind' | 'subject'>) =>
  fill(t('partnerMedia.preview.alt'), { kind: t(KIND_KEY[item.kind]), name: subjectName(t, item.subject) });

/* ── Logo plate (§40.2) ─────────────────────────────────────────────────── */
export function LogoPlate({ src, tone, large, placed, alt = '', testId }: { src?: string; tone: PlateTone; large?: boolean; placed?: boolean; alt?: string; testId?: string }) {
  return (
    <span
      className={cn('partner-plate', tone === 'dark' && 'partner-plate--dark', large && 'partner-plate--large', placed && 'partner-plate--placed')}
      aria-hidden={alt ? undefined : true}
      data-testid={testId}
      data-tone={tone}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={alt} />}
    </span>
  );
}

/* ── Band preview (§40.1, §43.2) ────────────────────────────────────────── */
export type BandKind = 'band' | 'wide';
const BAND_SIZE: Record<BandKind, { w: number; h: number; label: MessageKey }> = {
  band: { w: 342, h: 240, label: 'partnerMedia.preview.phone' },
  wide: { w: 960, h: 220, label: 'partnerMedia.preview.wide' },
};

/**
 * The partner's home band as the app draws it: photo (or the navy ground when there is none), the real scrim,
 * the partner's name as eyebrow, the role's headline and, when there is a logo, the plate. Decorative: the
 * figure's caption names it.
 */
export function BandPreview({ kind, subject, photoSrc, focal, logo }: {
  kind: BandKind; subject: PartnerSubject; photoSrc?: string; focal?: { x: number; y: number } | null;
  logo?: { src?: string; tone: PlateTone } | null;
}) {
  const { t } = useApp();
  const textRef = useRef<HTMLDivElement>(null);
  const [textTop, setTextTop] = useState<number | null>(null);
  useEffect(() => { if (textRef.current) setTextTop(textRef.current.offsetTop); }, [kind, subject.name]);
  const h = HEADLINE_KEYS[subject.type];
  const scrim = kind === 'wide' ? 'horizontal' : 'vertical';
  return (
    <div
      className={cn('hero-preview', `hero-preview--partner-${kind}`, `hero-preview--${scrim}`)}
      style={textTop != null ? ({ '--hero-preview-text-top': `${textTop}px` } as React.CSSProperties) : undefined}
      aria-hidden="true"
      data-testid={`partner-band-${kind}`}
    >
      {photoSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoSrc} alt="" className="hero-preview__img" style={{ objectPosition: focalToObjectPosition(focal ?? { x: 0, y: 0 }) }} data-testid={`partner-band-${kind}-img`} />
      )}
      <div className="hero-preview__scrim" />
      {logo && <LogoPlate src={logo.src} tone={logo.tone} placed testId={`partner-band-${kind}-plate`} />}
      <div ref={textRef} className="hero-preview__content">
        <p className="hero-preview__eyebrow">{subjectName(t, subject)}</p>
        <p className="hero-preview__headline">{t(h.lead)} <span className="hero-preview__accent">{t(h.accent)}</span></p>
      </div>
    </div>
  );
}

export function BandFigure(props: Parameters<typeof BandPreview>[0]) {
  const { t } = useApp();
  const spec = BAND_SIZE[props.kind];
  return (
    <figure className="space-y-1">
      <ScaledFrame width={spec.w} height={spec.h}><BandPreview {...props} /></ScaledFrame>
      <figcaption className="text-xs text-[var(--color-fg-tertiary)]">{t(spec.label)}</figcaption>
    </figure>
  );
}

/** The logo on both plates at 2× (§43.2 logo cards). */
export function BothPlates({ src, alt }: { src?: string; alt: string }) {
  const { t } = useApp();
  return (
    <div className="flex flex-wrap items-end gap-4" data-testid="partner-both-plates">
      {(['light', 'dark'] as const).map(tone => (
        <figure key={tone} className="space-y-1">
          <LogoPlate src={src} tone={tone} large alt={tone === 'light' ? alt : ''} testId={`partner-plate-${tone}`} />
          <figcaption className="text-xs text-[var(--color-fg-tertiary)]">{t(tone === 'light' ? 'partnerMedia.plate.light' : 'partnerMedia.plate.dark')}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/** "File deleted" in place of a preview (taken down: the bytes are gone). */
export function FileDeleted() {
  const { t } = useApp();
  return (
    <div className="flex aspect-[342/240] w-full items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-sm text-[var(--color-fg-tertiary)]" data-testid="partner-file-deleted">
      {t('partnerMedia.fileDeleted')}
    </div>
  );
}

/* ── Outcome of an action (§43.2 states) ────────────────────────────────── */
export type ActionOutcome = 'done' | 'stale' | 'gone' | 'failed';

/** Says what happened after a failed Looks fine / Take down and tells the caller whether to reload or drop the item. */
export function reportActionError(t: T, toast: ToastApi, e: unknown, kind?: PartnerMediaItem['kind']): ActionOutcome {
  const code = errorCode(e);
  if (code === 'stale_revision' || code === 'not_editable' || code === 'revision_required' || code === 'invalid_revision') { toast.warning(t('partnerMedia.stale')); return 'stale'; }
  if (code === 'media_gone' || code === 'media_not_found' || code === 'image_not_found') { toast.warning(t('partnerMedia.gone')); return 'gone'; }
  toast.error(isNetworkError(e) ? t('partnerMedia.offline') : partnerMediaErrorText(t, e, kind));
  return 'failed';
}

/* ── Takedown dialog (§43.3) ────────────────────────────────────────────── */
export function TakedownDialog({ item, onClose, onDone }: {
  item: PartnerMediaItem | null;
  onClose: () => void;
  /** After the request: 'done' (moved to Taken down), 'stale' (reload it) or 'gone' (drop it). */
  onDone: (outcome: Exclude<ActionOutcome, 'failed'>, item: PartnerMediaItem | null) => void;
}) {
  const { t, token } = useApp();
  const toast = useToast();
  const [reason, setReason] = useState<TakedownReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ reason?: string; note?: string; general?: string }>({});
  const legendId = useId();

  useEffect(() => { if (item) { setReason(''); setNote(''); setBusy(false); setFieldError({}); } }, [item]);
  if (!item) return null;
  const name = subjectName(t, item.subject);
  const ready = takedownReady(reason, note);

  async function submit() {
    if (!token || !item || !reason || !ready) return;
    setBusy(true); setFieldError({});
    try {
      const res = await partnerMediaApi.takeDown(token, item.id, { revision: item.revision, reason, note: note.trim() || undefined });
      toast.success(fill(t('partnerMedia.takeDown.done'), { name }));
      onDone('done', res.item);
    } catch (e) {
      const code = errorCode(e);
      if (code === 'reason_required' || code === 'invalid_reason') setFieldError({ reason: t('partnerMedia.error.reason_required') });
      else if (code === 'note_required') setFieldError({ note: t('partnerMedia.error.note_required') });
      else if (code === 'note_too_long') setFieldError({ note: t('partnerMedia.error.note_too_long') });
      else {
        const outcome = reportActionError(t, toast, e, item.kind);
        if (outcome === 'stale' || outcome === 'gone') { onDone(outcome, null); return; }
        setFieldError({ general: partnerMediaErrorText(t, e, item.kind) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => { if (!busy) onClose(); }}
      title={t(item.kind === 'logo' ? 'partnerMedia.takeDown.titleLogo' : 'partnerMedia.takeDown.titleHero')}
      description={fill(t('partnerMedia.takeDown.body'), { name })}
      size="md"
    >
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(); }} noValidate data-testid="partner-takedown-form">
        {fieldError.general && <Alert tone="error">{fieldError.general}</Alert>}
        <fieldset className="space-y-1" aria-describedby={fieldError.reason ? `${legendId}-err` : undefined}>
          <legend id={legendId} className="text-sm font-medium text-[var(--color-fg-secondary)]">
            {t('partnerMedia.takeDown.reason')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span>
          </legend>
          {reasonsFor(item.kind).map((code, i) => (
            <div key={code}>
              <Radio
                name="partner-takedown-reason"
                value={code}
                checked={reason === code}
                onChange={() => { setReason(code); setFieldError({}); }}
                disabled={busy}
                label={t(reasonLabelKey(code))}
                description={t(reasonPartnerKey(code))}
                aria-required
                invalid={!!fieldError.reason}
                data-autofocus={i === 0 ? true : undefined}
                data-testid={`partner-reason-${code}`}
              />
            </div>
          ))}
          {fieldError.reason && <p id={`${legendId}-err`} className="text-xs text-[var(--color-error-700)]">{fieldError.reason}</p>}
        </fieldset>
        <Field label={t('partnerMedia.takeDown.note')} hint={t('partnerMedia.takeDown.noteHint')} error={fieldError.note} required={reason === 'other'}>
          <Textarea
            value={note}
            onChange={e => { setNote(e.target.value); setFieldError({}); }}
            maxLength={NOTE_MAX}
            rows={3}
            disabled={busy}
            data-testid="partner-takedown-note"
          />
        </Field>
        <p className="-mt-2 text-right text-xs text-[var(--color-fg-quaternary)]" aria-live="polite" data-testid="partner-takedown-count">
          {fill(t('partnerMedia.takeDown.noteCount'), { n: note.length, max: NOTE_MAX })}
        </p>
      </form>
      <DialogFooter>
        <Button variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant="destructive" className="min-h-11" onClick={() => void submit()} disabled={!ready} loading={busy} data-testid="partner-takedown-submit">
          {t('partnerMedia.takeDown')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
