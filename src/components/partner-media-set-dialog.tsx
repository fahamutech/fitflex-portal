'use client';
// "Home photo and logo" for one partner (design spec photo-hero-screens §43.5; backend functions#277), opened
// from the gyms, trainers and vendors admin pages.
//
// - Reads only that partner's live items (GET /admin/partner-media?tab=live&subjectId=), which every one of
//   moderation, moderation_decide and brand_media may do.
// - brand_media sets a photo or logo: the ORIGINAL file is sent (no resize or re-encode), with the server's
//   admin confirmation texts ticked. Live at once, origin fitflex, never in To review.
// - Owner decision O-P3 (2026-10-29): the partner is NOT notified, so no copy here says they will be.
// - moderation_decide can take down a live item from here (same dialog as the queue).
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, ImageUp, Upload } from 'lucide-react';
import { useApp } from '../../app/providers';
import { ApiError } from '@/lib/api';
import { PARTNER_MEDIA_ADMIN } from '@/lib/flags';
import {
  acceptFor, autoPlate, checkFileBasics, checkFileSize, DEFAULT_LIMITS, errorBody, errorCode, fillTemplate as fill, isNetworkError,
  OVERRIDE_REASON_MAX, partnerMediaApi, partnerMediaErrorText,
  type AdminConfirmation, type PartnerMediaItem, type PartnerMediaKind, type PartnerMediaLimits, type PartnerSubject, type PlateChoice, type PlateTone,
} from '@/lib/partner-media';
import { cn } from '@/lib/cn';
import { FocalPointPicker } from './hero-image-manager';
import { Alert, Button, Checkbox, EmptyState, ErrorState, Field, Segmented, SkeletonCard, Spinner, Textarea, useToast } from './shared';
import { Dialog, DialogFooter } from './dialog';
import {
  BandFigure, BothPlates, itemAlt, PartnerPreviewProvider, subjectName, TakedownDialog, usePreview,
} from './partner-media-shared';

/** May this admin open the dialog at all? (flag on, and any of the three scopes) */
export function usePartnerMediaEntry(): boolean {
  const { hasPermission } = useApp();
  return PARTNER_MEDIA_ADMIN && (hasPermission('brand_media') || hasPermission('moderation') || hasPermission('moderation_decide'));
}

/** The row action: an icon button that opens the dialog. Renders nothing when the admin may not use it. */
export function PartnerMediaRowAction({ subject, onOpen }: { subject: PartnerSubject; onOpen: (s: PartnerSubject) => void }) {
  const { t } = useApp();
  const allowed = usePartnerMediaEntry();
  if (!allowed) return null;
  return (
    <Button
      variant="ghost" size="sm" className="min-h-11 min-w-11"
      title={t('partnerMedia.rowAction')} aria-label={`${t('partnerMedia.rowAction')}: ${subjectName(t, subject)}`}
      onClick={(e) => { e.stopPropagation(); onOpen(subject); }}
      data-testid={`partner-media-row-${subject.type}-${subject.id}`}
    >
      <ImageUp aria-hidden="true" className="h-4 w-4" />
    </Button>
  );
}

/* ── Current live item for one kind ───────────────────────────────────── */
function Current({ item, kind, subject, logoItem, photoItem }: {
  item: PartnerMediaItem | null; kind: PartnerMediaKind; subject: PartnerSubject; logoItem: PartnerMediaItem | null; photoItem: PartnerMediaItem | null;
}) {
  const { t } = useApp();
  const photo = usePreview(photoItem, 960);
  const logo = usePreview(logoItem, 240);
  const plate = logoItem ? { src: logo.url, tone: (logoItem.plate === 'dark' ? 'dark' : 'light') as PlateTone } : null;
  if (!item) {
    return <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid={`partner-set-none-${kind}`}>{t(kind === 'hero' ? 'partnerMedia.none.hero' : 'partnerMedia.none.logo')}</p>;
  }
  const own = kind === 'hero' ? photo : logo;
  return (
    <div className="space-y-3" data-testid={`partner-set-current-${kind}`}>
      {own.failed && <p className="text-sm text-[var(--color-error-700)]">{t('partnerMedia.preview.failed')}</p>}
      {!own.url && !own.failed && <p className="text-sm text-[var(--color-fg-tertiary)]">{t('partnerMedia.preview.loading')}</p>}
      {own.url && <span className="sr-only">{itemAlt(t, item)}</span>}
      {kind === 'logo' && <BothPlates src={logo.url} alt={itemAlt(t, item)} />}
      <BandFigure kind="band" subject={subject} photoSrc={photo.url} focal={photoItem?.focal} logo={plate} />
    </div>
  );
}

/* ── Set form (inside the dialog) ─────────────────────────────────────── */
type Chosen = { file: File; url: string; width: number; height: number; autoTone?: PlateTone };

function readImage(file: File): Promise<{ url: string; width: number; height: number; autoTone: PlateTone } | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let autoTone: PlateTone = 'light';
      try {
        // Automatic plate preview (the server decides): read a small copy of the pixels.
        const c = document.createElement('canvas');
        const s = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight));
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        const ctx = c.getContext('2d');
        if (ctx) { ctx.drawImage(img, 0, 0, c.width, c.height); autoTone = autoPlate(ctx.getImageData(0, 0, c.width, c.height).data); }
      } catch { /* keep light */ }
      resolve({ url, width: img.naturalWidth, height: img.naturalHeight, autoTone });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const FILE_CODES = new Set(['image_too_small', 'unsupported_file_type', 'svg_not_allowed', 'file_too_large', 'no_file_provided', 'variant_over_budget']);

function SetForm({ kind, subject, confirmation, onReloadConfirmation, photoItem, onCancel, onSaved }: {
  kind: PartnerMediaKind; subject: PartnerSubject; confirmation: AdminConfirmation;
  onReloadConfirmation: () => Promise<AdminConfirmation | null>;
  /** The live photo, for the logo's band preview. */
  photoItem: PartnerMediaItem | null;
  onCancel: () => void; onSaved: (item: PartnerMediaItem) => void;
}) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const limits: PartnerMediaLimits = confirmation.limits ?? DEFAULT_LIMITS;
  const texts = confirmation.adminConfirmation;
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [focal, setFocal] = useState({ x: 0, y: 0 });
  const [plate, setPlate] = useState<PlateChoice>('auto');
  const [rights, setRights] = useState(false);
  const [partnerLogo, setPartnerLogo] = useState(false);
  const [wordingChanged, setWordingChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [general, setGeneral] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** The server asked for a reason to put back a file taken down at a person's request (409 override_reason_required). */
  const [needsOverride, setNeedsOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hintId = useId();
  const photo = usePreview(kind === 'logo' ? photoItem : null, 960);

  // Local object URLs are this form's own; free them when the file changes or the form closes.
  useEffect(() => () => { if (chosen) URL.revokeObjectURL(chosen.url); }, [chosen]);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function pick(file: File | null | undefined) {
    if (!file || busy) return;
    setGeneral(null); setChosen(null);
    const basic = checkFileBasics(kind, file, limits);
    if (!basic.ok) { setFileError(fill(t(basic.key), basic.vars ?? {})); return; }
    setReading(true);
    const img = await readImage(file);
    setReading(false);
    if (!img) { setFileError(t('partnerMedia.error.unsupported_file_type')); return; }
    const size = checkFileSize(kind, img, limits);
    if (!size.ok) { URL.revokeObjectURL(img.url); setFileError(fill(t(size.key), size.vars ?? {})); return; }
    setFileError(null);
    setFocal({ x: 0, y: 0 });
    setNeedsOverride(false); setOverrideReason(''); setOverrideError(null);
    setChosen({ file, ...img });
  }

  const overrideOk = !needsOverride || (overrideReason.trim().length > 0 && overrideReason.trim().length <= OVERRIDE_REASON_MAX);
  const valid = !!chosen && !fileError && rights && (kind === 'hero' || partnerLogo) && overrideOk;

  async function submit() {
    if (!token || !chosen || !valid) return;
    setBusy(true); setGeneral(null); setProgress(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { item } = await partnerMediaApi.set(token, chosen.file, {
        subjectType: subject.type, subjectId: subject.id, kind,
        rightsConfirmed: rights, partnerLogoConfirmed: kind === 'logo' ? partnerLogo : undefined,
        adminConfirmationVersion: texts.version,
        focal: kind === 'hero' ? focal : undefined, plate: kind === 'logo' ? plate : undefined,
        overrideReason: needsOverride ? overrideReason : undefined,
      }, { onProgress: setProgress, signal: ctrl.signal });
      toast.success(fill(t('partnerMedia.saveAndShow.done'), { name: subjectName(t, subject) }));
      onSaved(item);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const code = errorCode(e);
      if (code === 'confirmation_version_mismatch') {
        // The wording changed: fetch it again and ask for both ticks again (AC-P26).
        await onReloadConfirmation();
        setRights(false); setPartnerLogo(false); setWordingChanged(true);
      } else if (code === 'override_reason_required') {
        // The file matches one taken down at a person's request: ask why it can go back, then send it again.
        setNeedsOverride(true); setOverrideError(needsOverride ? t('partnerMedia.error.override_reason_required') : null);
      } else if (code === 'override_reason_too_long') {
        setNeedsOverride(true); setOverrideError(t('partnerMedia.error.override_reason_too_long'));
      } else if (code && FILE_CODES.has(code)) {
        setFileError(partnerMediaErrorText(t, e, kind));
      } else {
        if (isNetworkError(e)) toast.error(t('partnerMedia.offline'));
        setGeneral(partnerMediaErrorText(t, e, kind));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  const tone: PlateTone = plate === 'auto' ? chosen?.autoTone ?? 'light' : plate;
  // "Automatic (light)": the tone in lower case inside the brackets.
  const toneLabel = t(tone === 'dark' ? 'partnerMedia.plate.dark' : 'partnerMedia.plate.light').toLocaleLowerCase(locale === 'sw' ? 'sw' : 'en');
  const pct = Math.round(progress * 100);
  const lang = locale === 'sw' ? 'sw' : 'en';

  return (
    <form className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-4" onSubmit={e => { e.preventDefault(); void submit(); }} noValidate data-testid={`partner-set-form-${kind}`}>
      {general && <Alert tone="error">{general}</Alert>}
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('partnerMedia.file')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></p>
        <div
          className={cn(
            'flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center',
            dragOver ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)]' : 'border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]',
          )}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); void pick(e.dataTransfer.files?.[0]); }}
          data-testid="partner-set-drop"
        >
          <ImagePlus aria-hidden="true" className="h-6 w-6 text-[var(--color-fg-quaternary)]" />
          <p className="text-sm text-[var(--color-fg-tertiary)]">{t('partnerMedia.file.drop')}</p>
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => inputRef.current?.click()} disabled={busy} aria-describedby={hintId} data-autofocus data-testid="partner-set-choose">
            <Upload aria-hidden="true" className="h-4 w-4" />{t('partnerMedia.file.choose')}
          </Button>
          <input
            ref={inputRef} type="file" accept={acceptFor(kind, limits)} className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }}
            data-testid="partner-set-file"
          />
          {reading && <p className="text-xs text-[var(--color-fg-tertiary)]">{t('partnerMedia.file.reading')}</p>}
          {chosen && (
            <p className="text-sm font-medium text-[var(--color-fg-primary)] [overflow-wrap:anywhere]" data-testid="partner-set-chosen">
              {fill(t('partnerMedia.file.chosen'), { name: chosen.file.name, size: formatBytes(chosen.file.size), w: chosen.width, h: chosen.height })}
            </p>
          )}
        </div>
        {fileError
          ? <p id={hintId} className="text-xs text-[var(--color-error-700)]" data-testid="partner-set-file-error">{fileError}</p>
          : <p id={hintId} className="text-xs text-[var(--color-fg-quaternary)]">{t(kind === 'hero' ? 'partnerMedia.file.hintHero' : 'partnerMedia.file.hintLogo')}</p>}
      </div>

      {chosen && kind === 'hero' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <FocalPointPicker src={chosen.url} value={focal} onChange={setFocal} alt={itemAlt(t, { kind, subject })} />
          <div className="min-w-0 space-y-3">
            <BandFigure kind="band" subject={subject} photoSrc={chosen.url} focal={focal} />
            <BandFigure kind="wide" subject={subject} photoSrc={chosen.url} focal={focal} />
          </div>
        </div>
      )}
      {chosen && kind === 'logo' && (
        <div className="space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('partnerMedia.plate')}</legend>
            <Segmented
              value={plate}
              onChange={v => setPlate(v as PlateChoice)}
              options={[
                ['auto', plate === 'auto' ? fill(t('partnerMedia.plate.autoIs'), { tone: toneLabel }) : t('partnerMedia.plate.auto')],
                ['light', t('partnerMedia.plate.light')],
                ['dark', t('partnerMedia.plate.dark')],
              ]}
              className="w-fit max-w-full overflow-x-auto"
            />
          </fieldset>
          <BothPlates src={chosen.url} alt={itemAlt(t, { kind, subject })} />
          <BandFigure kind="band" subject={subject} photoSrc={photo.url} focal={photoItem?.focal} logo={{ src: chosen.url, tone }} />
        </div>
      )}

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('partnerMedia.confirmations')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></legend>
        {wordingChanged && <Alert tone="warning">{t('partnerMedia.confirmChanged')}</Alert>}
        <Checkbox checked={rights} onChange={e => setRights(e.target.checked)} disabled={busy} label={texts.rights[lang]} aria-required data-testid="partner-set-rights" />
        {kind === 'logo' && (
          <Checkbox checked={partnerLogo} onChange={e => setPartnerLogo(e.target.checked)} disabled={busy} label={texts.partnerLogo[lang]} aria-required data-testid="partner-set-partner-logo" />
        )}
      </fieldset>

      {needsOverride && (
        <div className="space-y-2" data-testid="partner-set-override">
          <Alert tone="warning">{t('partnerMedia.override.notice')}</Alert>
          <Field label={t('partnerMedia.override.label')} hint={t('partnerMedia.override.hint')} error={overrideError ?? undefined} required>
            <Textarea
              value={overrideReason}
              onChange={e => { setOverrideReason(e.target.value); setOverrideError(null); }}
              maxLength={OVERRIDE_REASON_MAX} rows={3} disabled={busy}
              data-testid="partner-set-override-reason"
            />
          </Field>
        </div>
      )}

      {busy && (
        <div className="space-y-1" data-testid="partner-set-progress">
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t(kind === 'hero' ? 'partnerMedia.setPhoto' : 'partnerMedia.setLogo')} className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
            <div className="h-full bg-[var(--color-brand-600)] transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-[var(--color-fg-tertiary)]">{pct >= 100 ? t('partnerMedia.preparing') : fill(t('partnerMedia.uploading'), { n: pct })}</p>
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" className="min-h-11" onClick={() => { abortRef.current?.abort(); onCancel(); }} data-testid="partner-set-cancel">{t('common.cancel')}</Button>
        <Button type="submit" className="min-h-11" disabled={!valid} loading={busy} data-testid="partner-set-submit">{t('partnerMedia.saveAndShow')}</Button>
      </div>
    </form>
  );
}

/* ── The dialog ───────────────────────────────────────────────────────── */
type Status = 'loading' | 'ready' | 'off' | 'error';

function Body({ subject }: { subject: PartnerSubject }) {
  const { t, token, hasPermission } = useApp();
  const canBrand = hasPermission('brand_media');
  const canDecide = hasPermission('moderation_decide');
  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState<{ hero: PartnerMediaItem | null; logo: PartnerMediaItem | null }>({ hero: null, logo: null });
  const [confirmation, setConfirmation] = useState<AdminConfirmation | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [setting, setSetting] = useState<PartnerMediaKind | null>(null);
  const [takingDown, setTakingDown] = useState<PartnerMediaItem | null>(null);
  // useApp().t is a new function on every provider render: read it through a ref so loads don't repeat.
  const tRef = useRef(t);
  tRef.current = t;

  const loadConfirmation = useCallback(async () => {
    if (!token || !canBrand) return null;
    try {
      const c = await partnerMediaApi.confirmation(token);
      setConfirmation(c); setConfirmError(null);
      return c;
    } catch (e) {
      setConfirmError(partnerMediaErrorText(tRef.current, e));
      return null;
    }
  }, [token, canBrand]);

  const load = useCallback(async (quiet = false) => {
    if (!token) return;
    if (!quiet) setStatus('loading');
    try {
      const res = await partnerMediaApi.list(token, { tab: 'live', subjectType: subject.type, subjectId: subject.id, limit: 10 });
      const mine = res.items.filter(i => i.subject.id === subject.id && i.status === 'live');
      setLive({ hero: mine.find(i => i.kind === 'hero') ?? null, logo: mine.find(i => i.kind === 'logo') ?? null });
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && errorBody(e)?.error === 'feature_disabled') { setStatus('off'); return; }
      setLoadError(partnerMediaErrorText(tRef.current, e));
      setStatus('error');
    }
  }, [token, subject.type, subject.id]);

  useEffect(() => { void load(); void loadConfirmation(); }, [load, loadConfirmation]);

  let content: ReactNode;
  if (status === 'loading') content = <div className="space-y-4" aria-busy="true" data-testid="partner-set-loading"><SkeletonCard /><SkeletonCard /></div>;
  else if (status === 'off') content = <EmptyState icon={<ImageUp />} title={t('partnerMedia.off.title')} body={t('partnerMedia.off.body')} />;
  else if (status === 'error') content = <ErrorState title={t('partnerMedia.loadError')} message={loadError ?? undefined} onRetry={() => void load()} retryLabel={t('common.tryAgain')} />;
  else {
    content = (
      <div className="space-y-6">
        {(['hero', 'logo'] as const).map(kind => {
          const item = live[kind];
          const headingId = `partner-set-${kind}-heading`;
          return (
            <section key={kind} aria-labelledby={headingId} className="space-y-3" data-testid={`partner-set-section-${kind}`}>
              <h3 id={headingId} className="text-base font-semibold text-[var(--color-fg-primary)]">{t(kind === 'hero' ? 'partnerMedia.kind.hero' : 'partnerMedia.kind.logo')}</h3>
              <Current item={item} kind={kind} subject={subject} photoItem={live.hero} logoItem={live.logo} />
              {setting !== kind && (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {canBrand && (
                    <Button variant="secondary" className="min-h-11" onClick={() => setSetting(kind)} disabled={!confirmation} data-testid={`partner-set-open-${kind}`}>
                      {t(kind === 'hero' ? 'partnerMedia.setPhoto' : 'partnerMedia.setLogo')}
                    </Button>
                  )}
                  {item && canDecide && (
                    <Button variant="destructive" className="min-h-11" onClick={() => setTakingDown(item)} data-testid={`partner-set-take-down-${kind}`}>
                      {t('partnerMedia.takeDown')}
                    </Button>
                  )}
                </div>
              )}
              {canBrand && !confirmation && !confirmError && setting !== kind && <p className="flex items-center gap-2 text-xs text-[var(--color-fg-tertiary)]"><Spinner className="h-4 w-4" />{t('common.loading')}</p>}
              {setting === kind && confirmation && (
                <SetForm
                  kind={kind} subject={subject} confirmation={confirmation} onReloadConfirmation={loadConfirmation} photoItem={live.hero}
                  onCancel={() => setSetting(null)}
                  onSaved={() => { setSetting(null); void load(true); }}
                />
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <Alert tone="info">{t('partnerMedia.setDialog.note')}</Alert>
        {subject.type === 'vendor' && <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="partner-set-vendor-hint">{t('partnerMedia.setDialog.vendorHint')}</p>}
        {!canBrand && <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="partner-set-no-brand">{t('partnerMedia.noBrandMedia')}</p>}
        {confirmError && <Alert tone="error">{confirmError}</Alert>}
        {content}
      </div>
      <TakedownDialog
        item={takingDown}
        onClose={() => setTakingDown(null)}
        onDone={() => { setTakingDown(null); void load(true); }}
      />
    </>
  );
}

export function PartnerMediaSetDialog({ subject, onClose }: { subject: PartnerSubject | null; onClose: () => void }) {
  const { t } = useApp();
  if (!subject) return null;
  return (
    <PartnerPreviewProvider>
      <Dialog open onClose={onClose} title={fill(t('partnerMedia.setDialog.title'), { name: subjectName(t, subject) })} size="lg">
        <Body subject={subject} />
        <DialogFooter>
          <Button variant="secondary" className="min-h-11" onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </Dialog>
    </PartnerPreviewProvider>
  );
}

/* ── Gym detail dialog section (§43.5): the live thumbnails and Manage ── */
function DetailThumbs({ subject }: { subject: PartnerSubject }) {
  const { t, token } = useApp();
  const [live, setLive] = useState<{ hero: PartnerMediaItem | null; logo: PartnerMediaItem | null } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    partnerMediaApi.list(token, { tab: 'live', subjectType: subject.type, subjectId: subject.id, limit: 10 })
      .then(r => {
        if (!alive) return;
        const mine = r.items.filter(i => i.subject.id === subject.id && i.status === 'live');
        setLive({ hero: mine.find(i => i.kind === 'hero') ?? null, logo: mine.find(i => i.kind === 'logo') ?? null });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [token, subject.type, subject.id]);
  const photo = usePreview(live?.hero, 240);
  const logo = usePreview(live?.logo, 240);
  if (failed) return <p className="text-sm text-[var(--color-fg-tertiary)]">{t('partnerMedia.loadError')}</p>;
  if (!live) return <Spinner className="h-4 w-4" />;
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="partner-detail-thumbs">
      {live.hero ? (
        // eslint-disable-next-line @next/next/no-img-element
        <span className="inline-block h-12 w-20 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)]">{photo.url && <img src={photo.url} alt={itemAlt(t, live.hero)} className="h-full w-full object-cover" />}</span>
      ) : <span className="text-sm text-[var(--color-fg-tertiary)]">{t('partnerMedia.none.hero')}</span>}
      {live.logo ? (
        <span className={cn('partner-plate', live.logo.plate === 'dark' && 'partner-plate--dark')}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo.url && <img src={logo.url} alt={itemAlt(t, live.logo)} />}
        </span>
      ) : <span className="text-sm text-[var(--color-fg-tertiary)]">{t('partnerMedia.none.logo')}</span>}
    </div>
  );
}

export function PartnerMediaDetailSection({ subject, onManage }: { subject: PartnerSubject; onManage: (s: PartnerSubject) => void }) {
  const { t } = useApp();
  const allowed = usePartnerMediaEntry();
  if (!allowed) return null;
  return (
    <section className="space-y-2" aria-labelledby="partner-detail-section-heading" data-testid="partner-detail-section">
      <h3 id="partner-detail-section-heading" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('partnerMedia.rowAction')}</h3>
      <PartnerPreviewProvider><DetailThumbs subject={subject} /></PartnerPreviewProvider>
      <Button variant="secondary" className="min-h-11" onClick={() => onManage(subject)} data-testid="partner-detail-manage">{t('partnerMedia.manage')}</Button>
    </section>
  );
}
