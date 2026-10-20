'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ImagePlus, Info, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ShopProduct, VendorSummary } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { fmt, categoryLabel, type Category } from '@/lib/vendor';
import {
  AUDIENCE_KEY, AUDIENCE_ROLES, CTA_FOR_TARGET, CTA_KEY, FIELD_ORDER, IMAGE_MAX_BYTES, IMAGE_MIN_H, IMAGE_MIN_W, IMAGE_TYPES, TARGET_KEY,
  bannersApi, canDo, ctaLabelOf, draftOf, draftToInput, editResends, errorCodeOf, errorKeyOf, formFieldOf, isNetworkError, validateDraft,
  type BannerDraft, type BannerPeople, type BannerTargetType, type FormErrors, type ShopBanner,
} from '@/lib/shop-banners';
import { Alert, Button, Card, CardContent, Checkbox, Field, Input, Radio, Select } from './shared';
import { Dialog, DialogFooter } from './dialog';
import { SearchableSelect } from './searchable-select';
import { BannerPreview, useBannerPhoto } from './shop-banner-preview';
import { useToast } from './ui/toast';
import { useApp } from '../../app/providers';

// ── Tanzania time (EAT, UTC+3, no daylight saving): the form shows and takes it as such (spec §5.2.3 field 9) ──
const EAT_MS = 3 * 3_600_000;
const toEatInput = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + EAT_MS).toISOString().slice(0, 16) : ''; };
const fromEatInput = (text: string) => { if (!text) return ''; const t = Date.parse(`${text}:00+03:00`); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

function EatDateTime({ id, value, onChange, invalid, describedBy, testId }: { id: string; value: string; onChange: (iso: string) => void; invalid?: boolean; describedBy?: string; testId: string }) {
  const [text, setText] = useState(toEatInput(value));
  useEffect(() => { if (fromEatInput(text) !== value) setText(toEatInput(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input id={id} type="datetime-local" className="ui-input" value={text} aria-invalid={invalid || undefined} aria-describedby={describedBy}
      onChange={e => { setText(e.target.value); onChange(fromEatInput(e.target.value)); }} data-testid={testId} />
  );
}

type ChosenImage = { file: File; url: string; width: number; height: number };
function readSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export type BannerFormMode = 'vendor' | 'staff';

/**
 * Propose (vendor) or create (staff) a banner, or change one that may still be changed (spec §5.2.3, §5.3.3).
 * Every text in English and Swahili; no prices or percentages; the button label comes from the target.
 * Vendor: saved as a draft, the photo is uploaded, then it is sent for approval. Staff: created, the photo
 * is uploaded, and another admin approves it.
 */
export function BannerForm({ mode, banner, template, vendorId, vendorName, products, vendors, categories, onCancel, onDone }: {
  mode: BannerFormMode;
  banner: ShopBanner | null;
  /** "Copy to new": a past banner's text, link and audience (no photo, no dates). */
  template?: ShopBanner | null;
  /** Vendor mode: the business's own id (the store target). */
  vendorId?: string;
  /** Vendor mode: "From {business}" on the preview. */
  vendorName?: string | null;
  /** Products that may be linked: vendor = own active, approved, in-stock ones; staff = all. */
  products: ShopProduct[];
  vendors?: VendorSummary[];
  categories?: Category[];
  onCancel: () => void;
  onDone: (b: ShopBanner) => void;
}) {
  const { token, t, locale } = useApp();
  const toast = useToast();
  const uid = useId();
  const fid = (f: string) => `${uid}-${f.replace('.', '-')}`;
  const isVendor = mode === 'vendor';
  const initial = useMemo(() => {
    if (banner || !template) return draftOf(banner, { targetType: 'product' });
    return { ...draftOf(template, { targetType: 'product' }), startsAt: '', endsAt: '' };
  }, [banner, template]);
  const [d, setD] = useState<BannerDraft>(initial);
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [imageError, setImageError] = useState<MessageKey | null>(null);
  const [people, setPeople] = useState<BannerPeople | ''>('');
  const [rights, setRights] = useState(false);
  const [modelsOk, setModelsOk] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [saved, setSaved] = useState<ShopBanner | null>(banner);
  const [confirmResend, setConfirmResend] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  const savedPhoto = useBannerPhoto(saved, 960);
  const hasImage = !!image || !!saved?.image;
  const needsUpload = !!image;
  // A live banner's photo can't be swapped (the server allows a new photo before it goes live only).
  const canChangeImage = !saved || canDo(saved, 'image');
  const resends = !!saved && editResends(saved);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial) || !!image;

  const set = (patch: Partial<BannerDraft>) => { setD(cur => ({ ...cur, ...patch })); setGeneral(null); };
  const setText = (field: 'imageAlt' | 'headlineLead' | 'headlineAccent' | 'subline', lang: 'en' | 'sw', value: string) => {
    setD(cur => ({ ...cur, [field]: { ...cur[field], [lang]: value } }));
    setErrors(e => { const { [`${field}.${lang}`]: _gone, ...rest } = e; return rest; }); // eslint-disable-line @typescript-eslint/no-unused-vars
    setGeneral(null);
  };
  const setTarget = (type: BannerTargetType, value = '') => {
    set({ targetType: type, targetValue: type === 'vendor_store' && isVendor ? (vendorId ?? '') : value, cta: CTA_FOR_TARGET[type][0] });
    setErrors(e => { const { target: _gone, ...rest } = e; return rest; }); // eslint-disable-line @typescript-eslint/no-unused-vars
  };

  async function pick(file: File | undefined | null) {
    if (!file) return;
    setImageError(null);
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) { setImageError('merch.banner.imageType'); return; }
    if (file.size > IMAGE_MAX_BYTES) { setImageError('merch.banner.imageWeight'); return; }
    const size = await readSize(file);
    if (!size) { setImageError('merch.banner.imageType'); return; }
    if (size.width < IMAGE_MIN_W || size.height < IMAGE_MIN_H) { setImageError('merch.banner.imageSize'); return; }
    setImage({ file, url: URL.createObjectURL(file), ...size });
    setErrors(e => { const { image: _gone, ...rest } = e; return rest; }); // eslint-disable-line @typescript-eslint/no-unused-vars
  }

  function localErrors(): FormErrors {
    const e = validateDraft(d, { checkStart: !saved || d.startsAt !== saved.startsAt });
    if (!hasImage) e.image = { key: 'merch.banner.imageRequired' };
    if (imageError) e.image = { key: imageError };
    if (needsUpload) {
      if (!people) e.people = { key: 'merch.banner.pickPeople' };
      if (!rights) e.rights = { key: 'merch.confirmRequired' };
      if (people === 'product_models' && !modelsOk) e.peopleConfirm = { key: 'merch.confirmRequired' };
    }
    return e;
  }

  const focusFirst = (e: FormErrors) => {
    const first = FIELD_ORDER.find(f => e[f]);
    if (first) requestAnimationFrame(() => document.getElementById(fid(first))?.focus());
  };

  async function save() {
    if (!token || busy) return;
    const e = localErrors();
    setErrors(e);
    if (Object.keys(e).length) { focusFirst(e); return; }
    if (resends && !confirmResend) { setConfirmResend(true); return; }
    setConfirmResend(false);
    setBusy(true); setGeneral(null);
    const input = draftToInput(d, mode);
    let current = saved;
    try {
      // 1. The banner itself.
      if (!current) current = isVendor ? await bannersApi.vendorCreate(token, input) : await bannersApi.adminCreate(token, input);
      else current = isVendor ? await bannersApi.vendorUpdate(token, current.id, input) : await bannersApi.adminUpdate(token, current.id, input);
      setSaved(current);
      // 2. Its photo, with the rights and people confirmations.
      if (image && people) {
        setProgress(0);
        try {
          current = await (isVendor ? bannersApi.vendorUploadImage : bannersApi.adminUploadImage)(
            token, current.id, image.file, { people, rightsConfirmed: rights, peopleConfirmed: people === 'product_models' && modelsOk },
            { onProgress: setProgress },
          );
          setSaved(current);
          setImage(null);
        } catch (err) {
          setProgress(null);
          const code = errorCodeOf(err);
          const field = code === 'people_confirmation_required' ? 'peopleConfirm' : code === 'rights_confirmation_required' ? 'rights' : 'image';
          const fe: FormErrors = { [field]: { key: field === 'image' ? (isNetworkError(err) ? 'merch.banner.uploadFailed' : errorKeyOf(err, 'merch.banner.uploadFailed')) : 'merch.confirmRequired' } };
          setErrors(fe); focusFirst(fe);
          setBusy(false);
          return;
        }
        setProgress(null);
      }
      // 3. Send it for approval: a draft (new, or rejected and changed) goes to FitFlex (vendor) or to another admin (staff).
      //    Pending ones stay pending; scheduled and live ones went back to pending with the edit.
      if (current.status === 'draft') current = isVendor ? await bannersApi.vendorSubmit(token, current.id) : await bannersApi.adminSubmit(token, current.id);
      toast.success(t(isVendor ? 'merch.sent' : 'merchAdmin.created'));
      onDone(current);
    } catch (err) {
      const field = formFieldOf(err, d);
      if (field) {
        const max = (err as { body?: { max?: number } })?.body?.max;
        const fe: FormErrors = { [field]: { key: errorKeyOf(err), ...(max ? { vars: { n: max } } : {}) } };
        setErrors(fe); focusFirst(fe);
      }
      else if (isNetworkError(err)) { setGeneral(t('merch.notSentOffline')); toast.error(t('merch.notSentOffline')); }
      else setGeneral(t(errorKeyOf(err)));
    } finally {
      setBusy(false);
    }
  }

  const err = (f: string) => (errors[f] ? fmt(t(errors[f].key), errors[f].vars ?? {}) : undefined);

  const biField = (field: 'headlineLead' | 'headlineAccent' | 'subline' | 'imageAlt', label: MessageKey, opts: { required: boolean; hint?: MessageKey; max?: { en: number; sw: number } }) => (
    <fieldset className="space-y-2" data-testid={`banner-field-${field}`}>
      <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t(label)}{opts.required && <span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span>}</legend>
      {opts.hint && <p className="text-xs text-[var(--color-fg-quaternary)]">{t(opts.hint)}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {(['en', 'sw'] as const).map(l => (
          <Field key={l} label={t(l === 'en' ? 'merch.field.en' : 'merch.field.sw')} error={err(`${field}.${l}`)} required={opts.required}
            hint={opts.max ? fmt(t('merch.banner.count'), { n: (d.headlineLead[l] + (field === 'subline' || field === 'imageAlt' ? '' : ' ') + d.headlineAccent[l]).trim().length, max: opts.max[l] }) : undefined}>
            <Input id={fid(`${field}.${l}`)} lang={l} value={d[field][l]} onChange={e => setText(field, l, e.target.value)} disabled={busy} maxLength={field === 'imageAlt' ? 200 : 120}
              data-testid={`banner-${field}-${l}`} />
          </Field>
        ))}
      </div>
    </fieldset>
  );

  const productOptions = products.map(p => ({ value: p.id, label: p.name, sub: !isVendor ? vendors?.find(v => v.id === p.vendorId)?.displayName ?? undefined : undefined }));
  const targetTypes: BannerTargetType[] = isVendor ? ['product', 'vendor_store'] : ['product', 'vendor_store', 'category', 'results'];
  const ctaChoices = CTA_FOR_TARGET[d.targetType];
  const look = {
    imageUrl: image?.url ?? savedPhoto, wideImageUrl: image?.url ?? savedPhoto,
    headlineLead: d.headlineLead, headlineAccent: d.headlineAccent, subline: d.subline, ctaLabel: ctaLabelOf(d.cta),
    vendorName: isVendor ? vendorName || t('vendor.shell.unnamed') : null,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,560px)_minmax(0,400px)] [&>*]:min-w-0" data-testid="banner-form">
      <form noValidate onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-6">
        {general && <Alert tone="error">{general}</Alert>}
        {resends && <Alert tone="warning">{t('merch.resend.body')}</Alert>}
        {saved?.status === 'rejected' && saved.statusReason && <Alert tone="warning">{fmt(t('merch.line.reason'), { reason: saved.statusReason })}</Alert>}

        {/* 1–3. Image, people, confirmations */}
        <Card><CardContent className="space-y-4 p-5">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merch.banner.image')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></p>
            <div className={cn('flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center',
              errors.image ? 'border-[var(--color-error-600)]' : 'border-[var(--color-border-primary)]', 'bg-[var(--color-bg-secondary)]')}>
              <ImagePlus aria-hidden="true" className="h-6 w-6 text-[var(--color-fg-quaternary)]" />
              <Button id={fid('image')} type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy || !canChangeImage}
                aria-describedby={`${fid('image')}-hint`} aria-invalid={!!errors.image || undefined} data-testid="banner-choose-image">
                <Upload aria-hidden="true" className="h-4 w-4" />{t(hasImage ? 'merch.banner.replaceImage' : 'merch.banner.chooseImage')}
              </Button>
              <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} data-testid="banner-file-input" />
              {image && <p className="text-sm font-medium [overflow-wrap:anywhere]" data-testid="banner-file-chosen">{fmt(t('merch.banner.fileChosen'), { name: image.file.name, w: image.width, h: image.height })}</p>}
            </div>
            <p id={`${fid('image')}-hint`} className={cn('text-xs', errors.image || imageError ? 'text-[var(--color-error-700)]' : 'text-[var(--color-fg-quaternary)]')} data-testid="banner-image-msg">
              {imageError ? t(imageError) : err('image') ?? `${t('merch.banner.imageHelp')} ${t('merch.banner.imageRules')}`}
            </p>
            {progress != null && (
              <div role="progressbar" aria-label={t('merch.banner.uploading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
                className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
                <div className="h-full bg-[var(--color-brand-600)] transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>

          {(needsUpload || !saved) && (
            <>
              <fieldset className="space-y-1" aria-describedby={errors.people ? `${fid('people')}-err` : undefined}>
                <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merch.banner.people')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></legend>
                <div className="flex flex-col">
                  <Radio id={fid('people')} name={`${uid}-people`} checked={people === 'none'} onChange={() => { setPeople('none'); setModelsOk(false); }} disabled={busy} label={t('merch.banner.peopleNone')} invalid={!!errors.people} data-testid="banner-people-none" />
                  <Radio name={`${uid}-people`} checked={people === 'product_models'} onChange={() => setPeople('product_models')} disabled={busy} label={t('merch.banner.peopleModels')} invalid={!!errors.people} data-testid="banner-people-models" />
                </div>
                {errors.people && <p id={`${fid('people')}-err`} className="text-xs text-[var(--color-error-700)]">{err('people')}</p>}
              </fieldset>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merch.banner.confirmations')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></legend>
                <Checkbox id={fid('rights')} checked={rights} onChange={e => { setRights(e.target.checked); setErrors(x => { const { rights: _g, ...r } = x; return r; }); }} disabled={busy} label={t('merch.banner.rights')} invalid={!!errors.rights} aria-required data-testid="banner-rights" />
                {errors.rights && <p className="text-xs text-[var(--color-error-700)]" data-testid="banner-rights-error">{err('rights')}</p>}
                {people === 'product_models' && (
                  <>
                    <Checkbox id={fid('peopleConfirm')} checked={modelsOk} onChange={e => { setModelsOk(e.target.checked); setErrors(x => { const { peopleConfirm: _g, ...r } = x; return r; }); }} disabled={busy} label={t('merch.banner.modelsConfirm')} invalid={!!errors.peopleConfirm} aria-required data-testid="banner-models-confirm" />
                    {errors.peopleConfirm && <p className="text-xs text-[var(--color-error-700)]" data-testid="banner-models-error">{err('peopleConfirm')}</p>}
                  </>
                )}
              </fieldset>
            </>
          )}
        </CardContent></Card>

        {/* 4–6. Text, both languages */}
        <Card><CardContent className="space-y-5 p-5">
          <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm text-[var(--color-fg-secondary)]" data-testid="banner-text-rule">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t('merch.banner.textRule')}
          </p>
          {biField('headlineLead', 'merch.banner.lead', { required: true })}
          {biField('headlineAccent', 'merch.banner.accent', { required: true, hint: 'merch.banner.accentHelp', max: { en: 32, sw: 42 } })}
          {biField('subline', 'merch.banner.subline', { required: false })}
          {biField('imageAlt', 'merch.banner.alt', { required: true, hint: 'merch.banner.altHelp' })}
        </CardContent></Card>

        {/* 7–9. Link, audience, dates */}
        <Card><CardContent className="space-y-5 p-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merch.banner.target')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></legend>
            {isVendor ? (
              <div className="flex flex-col">
                <Radio name={`${uid}-target`} checked={d.targetType === 'product'} onChange={() => setTarget('product')} disabled={busy} label={t('merch.banner.targetProduct')} data-testid="banner-target-product" />
                <Radio name={`${uid}-target`} checked={d.targetType === 'vendor_store'} onChange={() => setTarget('vendor_store')} disabled={busy} label={t('merch.banner.targetStore')} data-testid="banner-target-store" />
              </div>
            ) : (
              <Select aria-label={t('merch.banner.target')} value={d.targetType} onChange={e => setTarget(e.target.value as BannerTargetType)} disabled={busy} data-testid="banner-target-type">
                {targetTypes.map(tt => <option key={tt} value={tt}>{t(TARGET_KEY[tt])}</option>)}
              </Select>
            )}
            <div id={fid('target')} tabIndex={-1} className="outline-none">
              {d.targetType === 'product' && (
                products.length === 0
                  ? <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="banner-no-products">{t(isVendor ? 'merch.banner.noProducts' : 'merchAdmin.noProducts')}</p>
                  : <div data-testid="banner-product-picker"><SearchableSelect options={productOptions} value={d.targetValue} onChange={v => { set({ targetValue: String(v) }); setErrors(x => { const { target: _g, ...r } = x; return r; }); }} placeholder={t('merch.banner.pickProduct')} ariaLabel={t('merch.banner.pickProduct')} disabled={busy} /></div>
              )}
              {!isVendor && d.targetType === 'vendor_store' && (
                <SearchableSelect options={(vendors ?? []).map(v => ({ value: v.id, label: v.displayName || v.id }))} value={d.targetValue} onChange={v => set({ targetValue: String(v) })} placeholder={t('merchAdmin.pickVendor')} ariaLabel={t('merchAdmin.pickVendor')} disabled={busy} />
              )}
              {!isVendor && d.targetType === 'category' && (
                <Select aria-label={t('merchAdmin.target.category')} value={d.targetValue} onChange={e => set({ targetValue: e.target.value })} disabled={busy} data-testid="banner-target-category">
                  <option value="">{t('merchAdmin.pickCategory')}</option>
                  {(categories ?? []).map(c => <option key={c.key} value={c.key}>{categoryLabel(c.key, categories ?? [], locale)}</option>)}
                </Select>
              )}
              {!isVendor && d.targetType === 'results' && (
                <Field label={t('merchAdmin.resultsQuery')} hint={t('merchAdmin.resultsQueryHint')}>
                  <Input value={d.targetValue} onChange={e => set({ targetValue: e.target.value })} disabled={busy} maxLength={80} data-testid="banner-target-results" />
                </Field>
              )}
              {errors.target && <p className="mt-1 text-xs text-[var(--color-error-700)]" data-testid="banner-target-error">{err('target')}</p>}
            </div>
            {isVendor || ctaChoices.length === 1 ? (
              <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="banner-cta">{fmt(t('merch.banner.button'), { label: t(CTA_KEY[d.cta]) })}</p>
            ) : (
              <Field label={t('merchAdmin.ctaLabel')}>
                <Select value={d.cta} onChange={e => set({ cta: e.target.value as BannerDraft['cta'] })} disabled={busy} data-testid="banner-cta-select">
                  {ctaChoices.map(c => <option key={c} value={c}>{t(CTA_KEY[c])}</option>)}
                </Select>
              </Field>
            )}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merch.banner.showTo')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></legend>
            <div className="flex flex-wrap gap-x-6">
              {AUDIENCE_ROLES.map((r, i) => (
                <Checkbox key={r} id={i === 0 ? fid('audienceRoles') : undefined} checked={d.audienceRoles.includes(r)} disabled={busy} invalid={!!errors.audienceRoles}
                  onChange={e => { set({ audienceRoles: e.target.checked ? [...d.audienceRoles, r] : d.audienceRoles.filter(x => x !== r) }); setErrors(x => { const { audienceRoles: _g, ...rest } = x; return rest; }); }}
                  label={t(AUDIENCE_KEY[r])} data-testid={`banner-audience-${r}`} />
              ))}
            </div>
            {errors.audienceRoles && <p className="text-xs text-[var(--color-error-700)]" data-testid="banner-audience-error">{err('audienceRoles')}</p>}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            {(['startsAt', 'endsAt'] as const).map(k => (
              <div key={k} className="flex flex-col gap-1.5">
                <label htmlFor={fid(k)} className="text-sm font-medium text-[var(--color-fg-secondary)]">{t(k === 'startsAt' ? 'merch.dates.starts' : 'merch.dates.ends')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></label>
                <EatDateTime id={fid(k)} value={d[k]} onChange={v => { set({ [k]: v }); setErrors(x => { const { [k]: _g, ...r } = x; return r; }); }} invalid={!!errors[k]} describedBy={`${fid(k)}-msg`} testId={`banner-${k}`} />
                <span id={`${fid(k)}-msg`} className={cn('text-xs', errors[k] ? 'text-[var(--color-error-700)]' : 'text-[var(--color-fg-quaternary)]')} data-testid={`banner-${k}-msg`}>{err(k) ?? t('merch.dates.tzNote')}</span>
              </div>
            ))}
          </div>
        </CardContent></Card>

        <Alert tone="info">{isVendor ? t('merch.reviewNoteBanner') : t('merchAdmin.createNote')}</Alert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => (dirty && !busy ? setConfirmDiscard(true) : onCancel())} data-testid="banner-cancel">{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} className="max-sm:w-full" data-testid="banner-submit">{t(isVendor ? 'merch.send' : saved ? 'merchAdmin.saveBanner' : 'merchAdmin.createBanner')}</Button>
        </div>
      </form>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <BannerPreview look={look} layouts={['phone']} />
      </div>

      <Dialog open={confirmResend} onClose={() => setConfirmResend(false)} title={t('merch.resend.title')} description={t('merch.resend.body')} size="sm">
        <DialogFooter>
          <Button variant="secondary" onClick={() => setConfirmResend(false)} data-testid="banner-resend-keep">{t('merch.resend.keep')}</Button>
          <Button onClick={() => void save()} data-testid="banner-resend-confirm">{t('merch.resend.confirm')}</Button>
        </DialogFooter>
      </Dialog>
      <Dialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title={t('merch.discard.title')} size="sm">
        <DialogFooter>
          <Button variant="secondary" onClick={() => setConfirmDiscard(false)} data-testid="banner-discard-keep">{t('merch.discard.keep')}</Button>
          <Button variant="destructive" onClick={() => { setConfirmDiscard(false); onCancel(); }} data-testid="banner-discard-confirm">{t('merch.discard.confirm')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
