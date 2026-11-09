'use client';
import { useEffect, useState } from 'react';
import { api, Gym, PublicReview, ReviewSummary } from '@/lib/api';
import { Alert, Card, CardContent, EmptyState, PageHeader, Spinner } from '@/components/shared';
import { fill } from '@/components/communication-shared';
import { ReviewSummaryPanel, Stars } from '@/components/reviews';
import { useApp } from '../../providers';

/** Owner / gym staff: what members say about their gym. Read-only. */
export default function OwnerReviewsPage() {
  const { token, locale, t } = useApp();
  const reviewCount = (n: number) => (n === 1 ? t('ownerReviews.countOne') : fill(t('ownerReviews.countMany'), { n }));

  const [gyms, setGyms] = useState<Gym[] | null>(null);
  const [gymId, setGymId] = useState<string>('');
  const [data, setData] = useState<{ summary: ReviewSummary; reviews: PublicReview[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.ownerGyms(token)
      .then(list => { setGyms(list); setGymId(list[0]?.id ?? ''); })
      .catch(() => { setGyms([]); setError(true); });
  }, [token]);

  useEffect(() => {
    if (!token || !gymId) return;
    setData(null);
    setError(false);
    api.ownerGymReviews(token, gymId)
      .then(res => setData({ summary: res.summary, reviews: res.reviews }))
      .catch(() => setError(true));
  }, [token, gymId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('ownerReviews.title')}
        description={t('ownerReviews.subtitle')}
        actions={gyms && gyms.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            {t('dash.gym')}
            <select className="ui-input" value={gymId} onChange={e => setGymId(e.target.value)} data-testid="review-gym-select">
              {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        ) : undefined}
      />
      {error && <Alert tone="error">{t('ownerReviews.failed')}</Alert>}
      {gyms == null ? <Spinner className="h-6 w-6" /> : gyms.length === 0 ? (
        <EmptyState title={t('ownerReviews.noGyms')} />
      ) : data == null ? (!error && <Spinner className="h-6 w-6" />) : (
        <Card>
          <CardContent className="space-y-4">
            <ReviewSummaryPanel summary={data.summary} labels={{ none: t('ownerReviews.none'), reviews: reviewCount }} />
            {data.summary.reviewCount === 0 && <p className="text-sm text-[var(--color-fg-quaternary)]">{t('ownerReviews.noneHint')}</p>}
            <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="owner-review-list">
              {data.reviews.map(r => (
                <li key={r.id} className="py-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Stars rating={r.rating} />
                    <span className="font-medium">{r.memberName}</span>
                    <span className="text-xs text-[var(--color-fg-quaternary)]">
                      {new Date(r.createdAt).toLocaleDateString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { dateStyle: 'medium' })}
                    </span>
                  </p>
                  {r.text && <p className="mt-1 whitespace-pre-line">{r.text}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
