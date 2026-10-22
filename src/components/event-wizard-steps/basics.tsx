'use client';
import { EVENT_TYPES, typeKey } from '@/lib/events';
import { Field, Radio, Select } from '@/components/shared';
import { ImageUpload } from '@/components/image-upload';
import { CountedTextarea, DateField, TextField, useErrorText, type StepProps } from './fields';
import { useApp } from '../../../app/providers';

/** Step 1 Basics (spec §6.2). */
export function BasicsStep({ form, update, errors, readOnly, token, options, onTitleBlur }: StepProps) {
  const { t } = useApp();
  const errText = useErrorText();
  const timezones = options?.timezones?.length ? options.timezones : [form.timezone || 'Africa/Dar_es_Salaam'];
  return (
    <div className="space-y-4">
      <TextField path="title" label={t('events.basics.title')} value={form.title} onChange={v => update({ title: v })} error={errors.title} required readOnly={readOnly} maxLength={80} onBlur={onTitleBlur} />
      <fieldset>
        <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('events.basics.type')} <span aria-hidden="true" className="text-[var(--color-error-600)]">*</span></legend>
        <div className="flex flex-wrap gap-x-6" id="ev-type">
          {EVENT_TYPES.map(type => (
            <Radio key={type} name="event-type" value={type} checked={form.type === type} onChange={() => update({ type })} disabled={readOnly} label={t(typeKey(type))} invalid={!!errors.type} data-testid={`ev-type-${type}`} />
          ))}
        </div>
        {errors.type && <p className="text-xs text-[var(--color-error-700)]">{errText(errors.type)}</p>}
      </fieldset>
      <CountedTextarea path="descriptionEn" label={t('events.basics.descriptionEn')} value={form.descriptionEn} onChange={v => update({ descriptionEn: v })} error={errors.descriptionEn} required readOnly={readOnly} max={4000} />
      <CountedTextarea path="descriptionSw" label={t('events.basics.descriptionSw')} value={form.descriptionSw} onChange={v => update({ descriptionSw: v })} error={errors.descriptionSw} required readOnly={readOnly} max={4000} hint={t('events.basics.descriptionSwHint')} />
      <Field label={t('events.basics.timezone')} required error={errText(errors.timezone)}>
        <Select id="ev-timezone" value={form.timezone} onChange={e => update({ timezone: e.target.value })} disabled={readOnly} data-testid="ev-timezone">
          {timezones.map(z => <option key={z} value={z}>{z}</option>)}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField path="startsAt" label={t('events.basics.starts')} value={form.startsAt} onChange={v => update({ startsAt: v })} error={errors.startsAt} required readOnly={readOnly} timezone={form.timezone} />
        <DateField path="endsAt" label={t('events.basics.ends')} value={form.endsAt} onChange={v => update({ endsAt: v })} error={errors.endsAt} required readOnly={readOnly} timezone={form.timezone} />
        <DateField path="registrationOpensAt" label={t('events.basics.regOpens')} value={form.registrationOpensAt} onChange={v => update({ registrationOpensAt: v })} error={errors.registrationOpensAt} readOnly={readOnly} timezone={form.timezone} hint={t('events.basics.regOpensHint')} />
        <DateField path="registrationClosesAt" label={t('events.basics.regCloses')} value={form.registrationClosesAt} onChange={v => update({ registrationClosesAt: v })} error={errors.registrationClosesAt} required readOnly={readOnly} timezone={form.timezone} />
      </div>
      <Field label={t('events.basics.cover')} hint={t('events.basics.coverHint')}>
        <div id="ev-heroImageUrl">
          <ImageUpload token={token} maxFiles={1} disabled={readOnly} value={form.heroImageUrl ? [form.heroImageUrl] : []} thumbnails={form.heroThumbUrl ? [form.heroThumbUrl] : []}
            onChange={(imgs, thumbs) => update({ heroImageUrl: imgs[0] ?? '', heroThumbUrl: thumbs[0] ?? '', ...(imgs[0] ? {} : { coverAlt: '' }) })} />
        </div>
      </Field>
      {form.heroImageUrl && (
        <TextField path="coverAlt" label={t('events.basics.coverAlt')} value={form.coverAlt} onChange={v => update({ coverAlt: v })} error={errors.coverAlt} required readOnly={readOnly} maxLength={120} />
      )}
    </div>
  );
}
