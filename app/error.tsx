'use client';
import { ErrorState } from '@/components/shared';
import { useApp } from './providers';

// Catches render errors inside a page. Shows a generic message only: the raw error is never put on screen.
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useApp();
  return (
    <div className="mx-auto max-w-xl py-12">
      <ErrorState title={t('common.somethingWrong')} message={t('common.errorBody')} onRetry={reset} retryLabel={t('common.tryAgain')} />
    </div>
  );
}
