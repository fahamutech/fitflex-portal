'use client';
import { Spinner } from '@/components/shared';
import { useApp } from './providers';

// Route-level placeholder while a page's code or data is loading.
export default function Loading() {
  const { t } = useApp();
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-16">
      <Spinner className="h-8 w-8 text-[var(--color-brand-600)]" />
      <span className="text-sm text-[var(--color-fg-quaternary)]">{t('common.loading')}</span>
    </div>
  );
}
