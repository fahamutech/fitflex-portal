'use client';
import Link from 'next/link';
import { useApp } from './providers';

export default function NotFound() {
  const { t } = useApp();
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <p className="text-5xl font-semibold tracking-tight text-[var(--color-brand-700)]" aria-hidden="true">404</p>
      <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{t('common.notFoundTitle')}</h1>
      <p className="text-sm text-[var(--color-fg-quaternary)]">{t('common.notFoundBody')}</p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-brand-600)] bg-[var(--color-brand-600)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-xs)] hover:bg-[var(--color-brand-700)]"
      >
        {t('common.goHome')}
      </Link>
    </div>
  );
}
