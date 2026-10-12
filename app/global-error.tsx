'use client';
import './globals.css';
import { t, type Locale } from '@/lib/i18n';

// Last resort when the root layout itself fails. It replaces the layout, so there is no Providers/Shell here:
// read the saved language directly and render plain markup.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  let locale: Locale = 'en';
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('locale') === 'sw') locale = 'sw';
  } catch { /* storage blocked: stay on English */ }
  return (
    <html lang={locale}>
      <body>
        <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{t(locale, 'common.somethingWrong')}</h1>
          <p className="text-sm text-[var(--color-fg-quaternary)]">{t(locale, 'common.errorBody')}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-2 inline-flex h-10 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-brand-600)] bg-[var(--color-brand-600)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-700)]"
          >
            {t(locale, 'common.tryAgain')}
          </button>
        </div>
      </body>
    </html>
  );
}
