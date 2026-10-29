'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §3.2, decision D33): the payout schedule of an event,
// a Card at the top of step 4 "Ticket types". Two options only, nothing pre-selected, required at submit, locked after submit.
import { Lock } from 'lucide-react';
import { PAYOUT_SCHEDULES, payoutKey } from '@/lib/events-ops';
import { fieldId } from '@/lib/events';
import type { PayoutSchedule } from '@/lib/api';
import { Card, CardContent, Radio } from '@/components/shared';
import { useErrorText, type StepProps } from './fields';
import { useApp } from '../../../app/providers';

export function PayoutScheduleCard({ form, update, errors, options, locked }: Pick<StepProps, 'form' | 'update' | 'errors' | 'options'> & { locked: boolean }) {
  const { t } = useApp();
  const errText = useErrorText();
  const choices: PayoutSchedule[] = (options?.payoutSchedules?.length ? options.payoutSchedules : PAYOUT_SCHEDULES).filter((s): s is PayoutSchedule => PAYOUT_SCHEDULES.includes(s));
  const error = errText(errors.payoutSchedule);
  const errId = 'ev-payoutSchedule-error';
  return (
    <Card data-testid="payout-card">
      <CardContent className="space-y-3">
        <fieldset aria-describedby={error ? errId : undefined} className="space-y-3">
          <legend className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.payout.title')}<span aria-hidden="true" className="ml-0.5 text-[var(--color-error-600)]">*</span></legend>
          <p className="text-sm text-[var(--color-fg-secondary)]">{t('events.payout.help')}</p>
          {locked ? (
            <div className="space-y-2" data-testid="payout-readonly">
              <p className="text-base font-medium text-[var(--color-fg-primary)]" data-testid="payout-value">{form.payoutSchedule ? t(payoutKey(form.payoutSchedule)) : t('events.payout.notSet')}</p>
              <p className="flex items-center gap-2 text-sm text-[var(--color-fg-quaternary)]" data-testid="payout-locked"><Lock aria-hidden="true" className="h-4 w-4 shrink-0" />{t('events.payout.locked')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {choices.map((choice, i) => (
                <div key={choice} className="min-h-11">
                  <Radio name="payoutSchedule" id={i === 0 ? fieldId('payoutSchedule') : undefined} value={choice} label={t(payoutKey(choice))} checked={form.payoutSchedule === choice}
                    onChange={() => update({ payoutSchedule: choice })} data-testid={`payout-${choice}`} />
                </div>
              ))}
            </div>
          )}
          {error && <p id={errId} role="alert" className="text-sm text-[var(--color-error-700)]" data-testid="payout-error">{error}</p>}
        </fieldset>
        <p className="text-xs text-[var(--color-fg-quaternary)]">{t('events.payout.note')}</p>
      </CardContent>
    </Card>
  );
}
