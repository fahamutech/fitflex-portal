'use client';
import { Plus, Trash2 } from 'lucide-react';
import { POLICY_PRESETS, POLICY_TIERS_MAX, fieldId, newPolicyTier, policyFromForm, refundPolicyLine, type Errors, type EventForm } from '@/lib/events';
import { Alert, Button, Field, Input, Radio } from '@/components/shared';
import { CountedTextarea, TextField, useErrorText } from '@/components/event-wizard-steps/fields';
import { useApp } from '../../app/providers';

type Props = {
  form: EventForm;
  update: (patch: Partial<EventForm> | ((f: EventForm) => Partial<EventForm>)) => void;
  errors: Errors;
  readOnly: boolean;
};

/**
 * Events S4 (spec §6.7, D24): the five refund presets of the wizard Terms step. `full_until_days` takes a whole number of
 * days (1 to 365); `tiered` takes up to three steps (days before the event strictly decreasing, percent not rising);
 * `custom` keeps the English and Swahili text. A read-only sentence generated from the inputs shows what members will read.
 */
export function RefundPolicyEditor({ form, update, errors, readOnly }: Props) {
  const { t, locale } = useApp();
  const errText = useErrorText();
  const generated = refundPolicyLine(policyFromForm(form), locale, t);
  const setTier = (i: number, patch: Partial<EventForm['policyTiers'][number]>) => update(f => ({ policyTiers: f.policyTiers.map((tier, j) => (j === i ? { ...tier, ...patch } : tier)) }));
  const choose = (p: (typeof POLICY_PRESETS)[number]) => update(f => ({
    policyPreset: p,
    // Starting tiered with one empty step means the editor is never an empty box with only an "Add" button.
    ...(p === 'tiered' && f.policyTiers.length === 0 ? { policyTiers: [newPolicyTier()] } : {}),
  }));
  return (
    <div className="space-y-4" data-testid="ev-refund-policy">
      <fieldset>
        <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('events.terms.policy')} <span aria-hidden="true" className="text-[var(--color-error-600)]">*</span></legend>
        <div className="flex flex-col" id="ev-policyPreset">
          {POLICY_PRESETS.map(p => (
            <div key={p} className="py-0.5">
              <Radio name="refund-policy" value={p} checked={form.policyPreset === p} onChange={() => choose(p)} disabled={readOnly}
                label={t(`events.terms.policy.${p}` as 'events.terms.policy.custom')} invalid={!!errors.policyPreset} data-testid={`ev-policy-${p}`} />
              <p className="ml-7 text-xs text-[var(--color-fg-quaternary)]">{t(`events.terms.policy.${p}.desc` as 'events.terms.policy.custom.desc')}</p>
            </div>
          ))}
        </div>
        {errors.policyPreset && <p className="text-xs text-[var(--color-error-700)]">{errText(errors.policyPreset)}</p>}
      </fieldset>

      {form.policyPreset === 'full_until_days' && (
        <div className="max-w-xs" data-testid="ev-policy-days">
          <TextField path="policyDays" label={t('events.terms.policy.days')} value={form.policyDays} onChange={v => update({ policyDays: v.replace(/[^0-9]/g, '') })}
            error={errors.policyDays} required readOnly={readOnly} inputMode="numeric" maxLength={3} testId="ev-policyDays" />
        </div>
      )}

      {form.policyPreset === 'tiered' && (
        <div className="space-y-3" data-testid="ev-policy-tiers" id="ev-policyTiers" tabIndex={-1}>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('events.terms.policy.example')}</p>
          {errors.policyTiers && <p className="text-xs text-[var(--color-error-700)]" role="alert">{errText(errors.policyTiers)}</p>}
          {form.policyTiers.map((tier, i) => (
            <div key={tier.uid} data-row={tier.uid} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]" data-testid={`ev-tier-${i}`}>
              <TextField path={`policyTiers.${i}.daysBefore`} label={t('events.terms.policy.days')} value={tier.daysBefore} onChange={v => setTier(i, { daysBefore: v.replace(/[^0-9]/g, '') })}
                error={errors[`policyTiers.${i}.daysBefore`]} required readOnly={readOnly} inputMode="numeric" maxLength={3} testId={`ev-tier-${i}-days`} />
              <TextField path={`policyTiers.${i}.percent`} label={t('events.terms.policy.percent')} value={tier.percent} onChange={v => setTier(i, { percent: v.replace(/[^0-9]/g, '') })}
                error={errors[`policyTiers.${i}.percent`]} required readOnly={readOnly} inputMode="numeric" maxLength={3} testId={`ev-tier-${i}-percent`} />
              {!readOnly && form.policyTiers.length > 1 && (
                <div className="sm:pt-7">
                  <Button type="button" variant="ghost" size="sm" aria-label={t('events.terms.policy.removeTier')} onClick={() => update(f => ({ policyTiers: f.policyTiers.filter((_, j) => j !== i) }))} data-testid={`ev-tier-${i}-remove`}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!readOnly && form.policyTiers.length < POLICY_TIERS_MAX && (
            <Button type="button" variant="secondary" size="sm" onClick={() => update(f => ({ policyTiers: [...f.policyTiers, newPolicyTier(f.policyTiers[f.policyTiers.length - 1])] }))} data-testid="ev-tier-add">
              <Plus aria-hidden="true" className="h-4 w-4" />{t('events.terms.policy.addTier')}
            </Button>
          )}
        </div>
      )}

      {form.policyPreset === 'custom' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <CountedTextarea path="policyEn" label={t('events.terms.policyEn')} value={form.policyEn} onChange={v => update({ policyEn: v })} error={errors.policyEn} required readOnly={readOnly} rows={5} max={5000} />
          <CountedTextarea path="policySw" label={t('events.terms.policySw')} value={form.policySw} onChange={v => update({ policySw: v })} error={errors.policySw} required readOnly={readOnly} rows={5} max={5000} />
        </div>
      )}

      {form.policyPreset && (
        <Field label={t('events.terms.policy.generated')}>
          <Input id={fieldId('policyGenerated')} readOnly value={generated} placeholder="—" aria-live="polite" data-testid="ev-policy-generated" />
        </Field>
      )}
      <Alert tone="info">{t('events.terms.policy.draft')}</Alert>
    </div>
  );
}
