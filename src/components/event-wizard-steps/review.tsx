'use client';
import type { EventDocument } from '@/lib/api';
import { fieldId, fmt, stepKey, stepOfPath, type Errors, type WizardStep } from '@/lib/events';
import { Alert, Checkbox } from '@/components/shared';
import { EventReviewSummary } from '@/components/event-review-summary';
import { useApp } from '../../../app/providers';

/** Step 7 Review & submit (spec §6.2): summary, remaining problems as links, permit warning, confirmation. */
export function ReviewStep({ doc, errors, onEdit, permitOnFile, confirmed, setConfirmed, readOnly }: {
  doc: EventDocument; errors: Errors; onEdit: (step: WizardStep, path?: string) => void; permitOnFile: boolean | null; confirmed: boolean; setConfirmed: (v: boolean) => void; readOnly: boolean;
}) {
  const { t, locale } = useApp();
  const problems = Object.entries(errors);
  return (
    <div className="space-y-4">
      {problems.length > 0 && (
        <Alert tone="warning">
          <p className="font-semibold">{t('events.review.problems')}</p>
          <ul role="list" className="mt-2 list-disc space-y-1 pl-5 font-normal" data-testid="review-problems">
            {problems.map(([path, e]) => (
              <li key={path}>
                <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => onEdit(stepOfPath(path), path)} data-testid={`review-problem-${fieldId(path)}`}>
                  {t(stepKey(stepOfPath(path)))}: {fmt(t(e.key), e.vars ?? {})}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {permitOnFile === false && <div data-testid="review-permit-missing"><Alert tone="warning">{t('events.review.permitMissing')}</Alert></div>}
      <EventReviewSummary doc={doc} lang={locale} onEdit={readOnly ? undefined : step => onEdit(step)} />
      {!readOnly && (
        <Checkbox label={t('events.review.confirm')} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="review-confirm" />
      )}
    </div>
  );
}
