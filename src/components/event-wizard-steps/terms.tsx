'use client';
import type { ParticipantFieldKey, ParticipantFieldPolicy } from '@/lib/api';
import { DUPLICATE_POLICIES, FIELD_POLICIES, PARTICIPANT_FIELD_KEYS, POLICY_PRESETS, effectiveParticipantFields, fmt, hasMinAge, minAgeCategory, newScheduleItem, newSponsor, type ScheduleForm, type SponsorForm } from '@/lib/events';
import { Alert, Button, Field, Radio } from '@/components/shared';
import { ImageUpload } from '@/components/image-upload';
import { CountedTextarea, DateField, RowCard, TextField, useErrorText, type StepProps } from './fields';
import { useApp } from '../../../app/providers';

/** Step 6 Terms & refund policy, contacts, sponsors, schedule (spec §6.2). */
export function TermsStep({ form, update, errors, readOnly, token }: StepProps) {
  const { t } = useApp();
  const errText = useErrorText();
  const setSponsor = (i: number, patch: Partial<SponsorForm>) => update(f => ({ sponsors: f.sponsors.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const setItem = (i: number, patch: Partial<ScheduleForm>) => update(f => ({ schedule: f.schedule.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <CountedTextarea path="termsEn" label={t('events.terms.termsEn')} value={form.termsEn} onChange={v => update({ termsEn: v })} error={errors.termsEn} required readOnly={readOnly} rows={10} max={20000} />
        <CountedTextarea path="termsSw" label={t('events.terms.termsSw')} value={form.termsSw} onChange={v => update({ termsSw: v })} error={errors.termsSw} required readOnly={readOnly} rows={10} max={20000} />
      </div>
      <Alert tone="info">{t('events.terms.legalNote')}</Alert>

      <fieldset>
        <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('events.terms.policy')} <span aria-hidden="true" className="text-[var(--color-error-600)]">*</span></legend>
        <div className="flex flex-col" id="ev-policyPreset">
          {POLICY_PRESETS.map(p => (
            <Radio key={p} name="refund-policy" value={p} checked={form.policyPreset === p} onChange={() => update({ policyPreset: p })} disabled={readOnly} label={t(`events.terms.policy.${p}` as 'events.terms.policy.custom')} invalid={!!errors.policyPreset} data-testid={`ev-policy-${p}`} />
          ))}
        </div>
        {errors.policyPreset && <p className="text-xs text-[var(--color-error-700)]">{errText(errors.policyPreset)}</p>}
      </fieldset>
      {form.policyPreset === 'custom' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <CountedTextarea path="policyEn" label={t('events.terms.policyEn')} value={form.policyEn} onChange={v => update({ policyEn: v })} error={errors.policyEn} required readOnly={readOnly} rows={5} max={5000} />
          <CountedTextarea path="policySw" label={t('events.terms.policySw')} value={form.policySw} onChange={v => update({ policySw: v })} error={errors.policySw} required readOnly={readOnly} rows={5} max={5000} />
        </div>
      )}

      <ParticipantFieldsSection form={form} update={update} errors={errors} readOnly={readOnly} />

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField path="contactEmail" label={t('events.terms.contactEmail')} value={form.contactEmail} onChange={v => update({ contactEmail: v })} error={errors.contactEmail} required readOnly={readOnly} type="email" inputMode="email" />
        <TextField path="contactPhone" label={t('events.terms.contactPhone')} value={form.contactPhone} onChange={v => update({ contactPhone: v })} error={errors.contactPhone} readOnly={readOnly} type="tel" inputMode="tel" />
        <TextField path="contactWhatsapp" label={t('events.terms.contactWhatsapp')} value={form.contactWhatsapp} onChange={v => update({ contactWhatsapp: v })} error={errors.contactWhatsapp} readOnly={readOnly} type="tel" inputMode="tel" />
      </div>

      <section className="space-y-3" aria-labelledby="ev-sponsors-h">
        <h3 id="ev-sponsors-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.terms.sponsors')}</h3>
        {errors.sponsors && <p className="text-xs text-[var(--color-error-700)]">{errText(errors.sponsors)}</p>}
        {form.sponsors.map((sp, i) => {
          const title = sp.name.trim() || fmt(t('events.terms.sponsorUnnamed'), { n: i + 1 });
          return (
            <div key={sp.uid} data-row={sp.uid}>
              <RowCard title={title} readOnly={readOnly} onRemove={() => update(f => ({ sponsors: f.sponsors.filter((_, j) => j !== i) }))} removeLabel={fmt(t('common.remove'), { name: title })} testId={`ev-sponsor-${i}`}>
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField path={`sponsors.${i}.name`} label={t('events.terms.sponsorName')} value={sp.name} onChange={v => setSponsor(i, { name: v })} error={errors[`sponsors.${i}.name`]} required readOnly={readOnly} maxLength={60} />
                  <TextField path={`sponsors.${i}.url`} label={t('events.terms.sponsorUrl')} value={sp.url} onChange={v => setSponsor(i, { url: v })} error={errors[`sponsors.${i}.url`]} readOnly={readOnly} type="url" placeholder="https://" />
                  <Field label={t('events.terms.sponsorLogo')}>
                    <div><ImageUpload token={token} maxFiles={1} disabled={readOnly} value={sp.logoUrl ? [sp.logoUrl] : []} thumbnails={sp.logoUrl ? [sp.logoUrl] : []} onChange={imgs => setSponsor(i, { logoUrl: imgs[0] ?? '' })} /></div>
                  </Field>
                </div>
              </RowCard>
            </div>
          );
        })}
        {!readOnly && form.sponsors.length < 10 && <Button type="button" variant="secondary" size="sm" onClick={() => update(f => ({ sponsors: [...f.sponsors, newSponsor()] }))} data-testid="ev-add-sponsor">{t('events.terms.addSponsor')}</Button>}
      </section>

      <section className="space-y-3" aria-labelledby="ev-schedule-h">
        <h3 id="ev-schedule-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.terms.schedule')}</h3>
        {errors.schedule && <p className="text-xs text-[var(--color-error-700)]">{errText(errors.schedule)}</p>}
        {form.schedule.map((it, i) => {
          const title = it.labelEn.trim() || fmt(t('events.terms.scheduleUnnamed'), { n: i + 1 });
          return (
            <div key={it.uid} data-row={it.uid}>
              <RowCard title={title} readOnly={readOnly} onRemove={() => update(f => ({ schedule: f.schedule.filter((_, j) => j !== i) }))} removeLabel={fmt(t('common.remove'), { name: title })} testId={`ev-schedule-${i}`}>
                <div className="grid gap-4 sm:grid-cols-3">
                  <DateField path={`schedule.${i}.at`} label={t('events.terms.scheduleTime')} value={it.at} onChange={v => setItem(i, { at: v })} error={errors[`schedule.${i}.at`]} required readOnly={readOnly} timezone={form.timezone} />
                  <TextField path={`schedule.${i}.labelEn`} label={t('events.terms.scheduleLabelEn')} value={it.labelEn} onChange={v => setItem(i, { labelEn: v })} error={errors[`schedule.${i}.labelEn`]} required readOnly={readOnly} maxLength={80} />
                  <TextField path={`schedule.${i}.labelSw`} label={t('events.terms.scheduleLabelSw')} value={it.labelSw} onChange={v => setItem(i, { labelSw: v })} error={errors[`schedule.${i}.labelSw`]} required readOnly={readOnly} maxLength={80} />
                </div>
              </RowCard>
            </div>
          );
        })}
        {!readOnly && form.schedule.length < 20 && <Button type="button" variant="secondary" size="sm" onClick={() => update(f => ({ schedule: [...f.schedule, newScheduleItem()] }))} data-testid="ev-add-schedule">{t('events.terms.addSchedule')}</Button>}
      </section>
    </div>
  );
}

const FIELD_LABEL: Record<ParticipantFieldKey, 'events.terms.fields.phone' | 'events.terms.fields.email' | 'events.terms.fields.dob' | 'events.terms.fields.gender' | 'events.terms.fields.emergency' | 'events.terms.fields.kit'> = {
  phone: 'events.terms.fields.phone', email: 'events.terms.fields.email', dateOfBirth: 'events.terms.fields.dob', gender: 'events.terms.fields.gender',
  emergencyContact: 'events.terms.fields.emergency', kitSize: 'events.terms.fields.kit',
};

/**
 * S3 §6.4 "Participant details you collect": one 3-way radio row per §3.3 key (DOB locked to Required when a category
 * has a minimum age; kit size only with a kit), the phone/email both-off rule, and the duplicate policy (D20).
 */
export function ParticipantFieldsSection({ form, update, errors, readOnly }: Pick<StepProps, 'form' | 'update' | 'errors' | 'readOnly'>) {
  const { t } = useApp();
  const errText = useErrorText();
  const effective = effectiveParticipantFields(form);
  const dobLocked = hasMinAge(form);
  const set = (key: ParticipantFieldKey, value: ParticipantFieldPolicy) => update(f => ({ participantFields: { ...f.participantFields, [key]: value } }));
  const rows = PARTICIPANT_FIELD_KEYS.filter(k => k !== 'kitSize' || form.hasKit);
  return (
    <section className="space-y-3" aria-labelledby="ev-participant-fields-h" data-testid="ev-participant-fields">
      <h3 id="ev-participant-fields-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.terms.fields.title')}</h3>
      <p className="text-sm text-[var(--color-fg-quaternary)]">{t('events.terms.fields.intro')}</p>
      <div className="space-y-2">
        {rows.map(key => {
          const locked = key === 'dateOfBirth' && dobLocked;
          return (
            <fieldset key={key} className="grid gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] px-3 py-2 sm:grid-cols-[minmax(160px,1fr)_auto] sm:items-center" data-testid={`ev-field-${key}`}>
              <legend className="sr-only">{t(FIELD_LABEL[key])}</legend>
              <div>
                <span className="text-sm font-medium text-[var(--color-fg-secondary)]" aria-hidden="true">{t(FIELD_LABEL[key])}</span>
                {locked && <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="ev-field-dob-locked">{fmt(t('events.terms.fields.dob.locked'), { category: minAgeCategory(form) })}</p>}
              </div>
              <div className="flex flex-wrap gap-x-4">
                {FIELD_POLICIES.map(p => (
                  <Radio key={p} name={`pf-${key}`} value={p} checked={effective[key] === p} disabled={readOnly || locked} onChange={() => set(key, p)}
                    label={t(`events.terms.fields.${p}` as 'events.terms.fields.required')} data-testid={`ev-field-${key}-${p}`} />
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      {errors['participantFields.contact'] && <p className="text-xs text-[var(--color-error-700)]" id="ev-participantFields-contact" tabIndex={-1} data-testid="ev-contact-policy-error">{errText(errors['participantFields.contact'])}</p>}

      <fieldset>
        <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('events.terms.duplicate')}</legend>
        <div className="flex flex-col" id="ev-duplicatePolicy">
          {DUPLICATE_POLICIES.map(p => (
            <Radio key={p} name="duplicate-policy" value={p} checked={form.duplicatePolicy === p} disabled={readOnly} onChange={() => update({ duplicatePolicy: p })}
              label={t(p === 'allow' ? 'events.terms.duplicate.allow' : 'events.terms.duplicate.one')} data-testid={`ev-duplicate-${p}`} />
          ))}
        </div>
      </fieldset>
    </section>
  );
}
