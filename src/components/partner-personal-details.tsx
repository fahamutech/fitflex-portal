'use client';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/providers';
import { ApiError, PartnerPersonalDetails as Details } from '@/lib/api';
import { Alert, Button, Spinner } from '@/components/shared';
import type { MessageKey } from '@/lib/i18n';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; details: Details }
  | { kind: 'unavailable' }
  | { kind: 'hidden' }
  | { kind: 'error' };

const GENDER_KEYS: Record<NonNullable<Details['gender']>, MessageKey> = {
  male: 'admin.partner.gender.male',
  female: 'admin.partner.gender.female',
  other: 'admin.partner.gender.other',
};

/**
 * View-only date of birth, age and gender for a trainer or gym owner.
 * Every successful read is audited on the server, so nothing is requested
 * until the admin presses "Show personal details". Read-only: no inputs.
 */
export function PartnerPersonalDetails({
  subjectId,
  load,
  testId,
}: {
  /** Trainer profile id or owner user id; a change resets the section. */
  subjectId: string;
  load: () => Promise<{ personalDetails: Details }>;
  testId: string;
}) {
  const { t } = useApp();
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => { setState({ kind: 'idle' }); }, [subjectId]);

  async function show() {
    setState({ kind: 'loading' });
    try {
      const res = await load();
      setState({ kind: 'loaded', details: res.personalDetails });
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
      if (e instanceof ApiError && e.status === 404 && code === 'feature_disabled') setState({ kind: 'unavailable' });
      else if (e instanceof ApiError && e.status === 403 && code === 'acl_forbidden') setState({ kind: 'hidden' });
      else setState({ kind: 'error' });
    }
  }

  if (state.kind === 'hidden') return null;

  const notGiven = <span className="text-[var(--color-fg-quaternary)]">{t('admin.partner.notGiven')}</span>;
  const d = state.kind === 'loaded' ? state.details : null;

  return (
    <section
      data-testid={testId}
      aria-label={t('admin.partner.personalDetails')}
      className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('admin.partner.personalDetails')}</p>
        {(state.kind === 'idle' || state.kind === 'error') && (
          <Button type="button" variant="secondary" size="sm" onClick={show}>
            {t('admin.partner.showPersonalDetails')}
          </Button>
        )}
        {state.kind === 'loading' && <Spinner className="h-4 w-4" />}
      </div>
      {state.kind === 'idle' && (
        <p className="text-xs text-[var(--color-fg-tertiary)]">{t('admin.partner.personalDetailsHint')}</p>
      )}
      {state.kind === 'unavailable' && (
        <p className="text-xs text-[var(--color-fg-quaternary)]">{t('admin.partner.personalDetailsUnavailable')}</p>
      )}
      {state.kind === 'error' && <Alert tone="error">{t('admin.partner.personalDetailsError')}</Alert>}
      {d && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-[var(--color-fg-tertiary)]">{t('admin.member.dateOfBirth')}</dt>
            <dd data-testid={`${testId}-dob`} className="text-[var(--color-fg-primary)]">{d.dateOfBirth || notGiven}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-fg-tertiary)]">{t('admin.partner.age')}</dt>
            <dd data-testid={`${testId}-age`} className="text-[var(--color-fg-primary)]">{d.age ?? notGiven}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-fg-tertiary)]">{t('admin.member.gender')}</dt>
            <dd data-testid={`${testId}-gender`} className="text-[var(--color-fg-primary)]">
              {d.gender && GENDER_KEYS[d.gender] ? t(GENDER_KEYS[d.gender]) : notGiven}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
