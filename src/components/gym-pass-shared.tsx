'use client';
import { Alert, Button, EmptyState } from './shared';
import { fill } from './communication-shared';
import { useApp } from '../../app/providers';
import type { MessageKey } from '@/lib/i18n';
import type { BadgeTone } from '@/lib/admin-utils';
import type { DurationUnit, GymPassFailure, PassCategory, PersonStatus, PurchaseStatus } from '@/lib/gym-passes';

export const PURCHASE_TONE: Record<PurchaseStatus, BadgeTone> = { pending_payment: 'warning', active: 'success', expired: 'gray', cancelled: 'danger' };
export const PERSON_TONE: Record<PersonStatus, BadgeTone> = { awaiting_payment: 'warning', invited: 'brand', pending_registration: 'brand', active: 'success', suspended: 'warning', removed: 'gray' };

/** The text a failed call shows (never a raw error code). */
export function useFailureText() {
  const { t } = useApp();
  return (f: Exclude<GymPassFailure, { kind: 'disabled' }>): string => {
    if (f.kind === 'rate_limited') return f.retryAfterSeconds ? fill(t('gp.rate.limited'), { n: f.retryAfterSeconds }) : t('gp.rate.limitedNoWait');
    const vars = { ...(f.vars ?? {}) };
    if (f.key === 'gp.err.field' && typeof vars.field === 'string') vars.field = t(`gp.err.field.${vars.field}` as MessageKey);
    return fill(t(f.key), vars);
  };
}

/** A failed call as a banner: 404 feature_disabled is a friendly "not available yet", 429 shows the wait. */
export function FailureView({ failure, onRetry }: { failure: GymPassFailure; onRetry?: () => void }) {
  const { t } = useApp();
  const text = useFailureText();
  if (failure.kind === 'disabled') {
    return <div data-testid="gp-disabled"><EmptyState title={t('gp.off.title')} body={t('gp.off.body')} /></div>;
  }
  return (
    <div className="space-y-2" data-testid={failure.kind === 'rate_limited' ? 'gp-rate-limited' : 'gp-failure'}>
      <Alert tone={failure.kind === 'rate_limited' ? 'warning' : 'error'}>{text(failure)}</Alert>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>{t('gp.retry')}</Button>}
    </div>
  );
}

export function useGymPassFormat() {
  const { t, locale } = useApp();
  const dateLocale = locale === 'sw' ? 'sw-TZ' : 'en-GB';
  const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(dateLocale, { dateStyle: 'medium' }) : '—');
  const dateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const duration = (n: number, unit: DurationUnit) => {
    if (n === 1) return t(`gp.duration.${unit === 'days' ? 'day' : unit === 'weeks' ? 'week' : 'month'}` as MessageKey);
    return fill(t(`gp.duration.${unit}` as MessageKey), { n });
  };
  const people = (category: PassCategory, limit: number) => (limit === 1 ? t('gp.peopleOne') : fill(t('gp.peopleCount'), { n: limit }));
  return { date, dateTime, duration, people, t };
}
