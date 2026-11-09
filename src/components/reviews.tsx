'use client';
import type { ReviewSummary } from '@/lib/api';
import { useApp } from '../../app/providers';

/** Five stars filled in proportion to the rating, so an average of 4.5 shows four and a half. */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  const { t } = useApp();
  const value = Math.max(0, Math.min(5, rating));
  const label = Number.isInteger(value) ? `${value}` : value.toFixed(1);
  return (
    <span role="img" aria-label={t('ui.stars').replace('{n}', label)} className={`relative inline-block whitespace-nowrap tracking-tight ${className ?? ''}`}>
      <span className="text-[var(--color-gray-300)]">★★★★★</span>
      <span aria-hidden className="absolute inset-y-0 left-0 overflow-hidden text-[var(--color-warning-500)]" style={{ width: `${(value / 5) * 100}%` }}>★★★★★</span>
    </span>
  );
}

/** Average, count and a 5→1 star distribution. */
export function ReviewSummaryPanel({ summary, labels }: {
  summary: ReviewSummary;
  labels: { none: string; reviews: (n: number) => string };
}) {
  if (!summary.reviewCount || summary.averageRating == null) {
    return <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="reviews-empty">{labels.none}</p>;
  }
  return (
    <div className="flex items-center gap-6" data-testid="reviews-summary">
      <div className="text-center">
        <div className="text-3xl font-semibold">{summary.averageRating.toFixed(1)}</div>
        <Stars rating={summary.averageRating} />
        <div className="text-xs text-[var(--color-fg-quaternary)]">{labels.reviews(summary.reviewCount)}</div>
      </div>
      <div className="flex-1 space-y-1">
        {[5, 4, 3, 2, 1].map(star => {
          const count = summary.distribution[String(star)] ?? 0;
          return (
            <div key={star} className="flex items-center gap-2 text-xs">
              <span className="w-3">{star}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--color-bg-tertiary)]">
                <div className="h-full bg-[var(--color-warning-500)]" style={{ width: `${(count / summary.reviewCount) * 100}%` }} />
              </div>
              <span className="w-6 text-right text-[var(--color-fg-quaternary)]">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
