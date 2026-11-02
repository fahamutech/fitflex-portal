'use client';
import { useApp } from '../../app/providers';
import { REASON_MAX } from '@/lib/admin-reason';
import { Field, Textarea } from './shared';

/**
 * The reason an admin gives for a sensitive action (stored in the audit log). Always offered; the server
 * decides when it is required (flag ADMIN_REASONS_REQUIRED) and answers 400 reason_required if it is missing.
 */
export function ReasonField({ value, onChange, error, testId = 'admin-reason' }: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  testId?: string;
}) {
  const { t } = useApp();
  return (
    <div className="text-left">
      <Field label={t('adminReason.label')} hint={t('adminReason.hint')} error={error ?? undefined}>
        <Textarea rows={3} maxLength={REASON_MAX} value={value} onChange={e => onChange(e.target.value)} data-testid={testId} />
      </Field>
    </div>
  );
}
