'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, AdminReview, ReviewAction, ReviewKind, ReviewStatus } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Segmented, Spinner } from '@/components/shared';
import { Stars } from '@/components/reviews';

type Tab = 'all' | ReviewStatus;
const TABS: [Tab, string][] = [['all', 'All'], ['published', 'Published'], ['flagged', 'Flagged'], ['hidden', 'Hidden']];
const STATUS_TONE: Record<ReviewStatus, 'success' | 'warning' | 'gray'> = { published: 'success', flagged: 'warning', hidden: 'gray' };
// What each state allows. Flagged and hidden reviews don't count toward a rating.
const ACTIONS: Record<ReviewStatus, [ReviewAction, string][]> = {
  published: [['flag', 'Flag'], ['hide', 'Hide']],
  flagged: [['restore', 'Restore'], ['hide', 'Hide']],
  hidden: [['restore', 'Restore']],
};

/** Admin: member reviews of gyms and trainers — hide, flag or restore. */
export default function AdminReviewsPage() {
  const { token } = useApp();
  const [kind, setKind] = useState<ReviewKind>('gym');
  const [tab, setTab] = useState<Tab>('all');
  const [rows, setRows] = useState<AdminReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setError(null);
    setRows(null);
    try { setRows(await api.adminReviews(token, kind, tab === 'all' ? undefined : tab)); } catch { setError('Could not load reviews.'); setRows([]); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, kind, tab]);

  const moderate = async (r: AdminReview, action: ReviewAction) => {
    if (!token) return;
    if (action === 'hide' && !window.confirm('Hide this review? It disappears from the app and stops counting toward the rating. This is logged.')) return;
    setBusyId(r.id);
    try { await api.moderateReview(token, kind, r.id, action); await load(); } catch { setError('Could not update that review.'); } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        description="What members say about gyms and trainers. Flagged and hidden reviews don’t count toward ratings."
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={kind} options={[['gym', 'Gyms'], ['trainer', 'Trainers']]} onChange={v => setKind(v as ReviewKind)} />
        <div role="tablist" className="flex gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1">
          {TABS.map(([value, label]) => (
            <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === value ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-[var(--color-fg-quaternary)]">No reviews here.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="review-list">
              {rows.map(r => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                      <Stars rating={r.rating} />
                      <span className="font-medium">{(kind === 'gym' ? r.gymName : r.trainerName) ?? 'Removed'}</span>
                    </p>
                    {r.text && <p className="mt-1 whitespace-pre-line">“{r.text}”</p>}
                    <p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">
                      {r.memberName ?? 'A member'} · {new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                      {r.moderatedAt ? ` · last moderated ${new Date(r.moderatedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {ACTIONS[r.status].map(([action, label]) => (
                      <Button key={action} size="sm" variant={action === 'hide' ? 'destructive' : 'secondary'}
                        disabled={busyId === r.id} onClick={() => moderate(r, action)}>{label}</Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
