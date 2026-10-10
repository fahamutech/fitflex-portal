'use client';
import { Globe } from 'lucide-react';
import { useApp } from '../../app/providers';

/**
 * One-tap English <-> Swahili switch. Always visible (no menu to open); the
 * page re-renders in place and the choice is remembered.
 */
export function LanguageToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useApp();
  const next = locale === 'sw' ? 'en' : 'sw';
  const label = t(next === 'sw' ? 'common.switchToSwahili' : 'common.switchToEnglish');
  return (
    <button
      type="button"
      data-testid="lang-toggle"
      onClick={() => setLocale(next)}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-2 text-xs font-semibold text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors ${className}`}
    >
      <Globe aria-hidden="true" className="h-4 w-4" />
      <span aria-hidden="true">{locale === 'sw' ? 'SW' : 'EN'}</span>
    </button>
  );
}
