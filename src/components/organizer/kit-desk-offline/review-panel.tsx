'use client';
// Events S7 offline kit desk (spec §3.6 review state, §3.7 "what review shows", §3.15 bib exceptions): scans that need a person to look. Owner and admin read the
// server list and mark items as checked; ops see only the outcomes returned to their own desk and are told to ask an owner or admin (§2).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { kitOfflineApi, type ReviewRow } from '@/lib/events-s7-api';
import { eventDateTime, fmt } from '@/lib/events';
import { newIdempotencyKey } from '@/lib/events-ops';
import { REASON_MAX, reasonValid, s7ErrorKey } from '@/lib/events-s7';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Segmented, SkeletonCard, Textarea } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { PageError } from '@/components/organizer/page-states';
import type { LocalScan } from './desk-logic';
import { useApp } from '../../../../app/providers';

const OUTCOME_KEY: Record<string, MessageKey> = {
  duplicate: 'organizer.kitOffline.review.duplicate', revoked_after_scan: 'organizer.kitOffline.review.revoked', event_closed: 'organizer.kitOffline.review.closed',
  after_revoke: 'organizer.kitOffline.review.afterRevoke', organizer_suspended: 'organizer.kitOffline.review.suspended',
};

export function bibReviewText(t: (k: MessageKey) => string, bib: { outcome: string; claimed?: string | null; number?: string | null }): string {
  const n = bib.claimed ?? bib.number ?? '';
  if (bib.outcome === 'taken') return fmt(t('organizer.kitOffline.review.bib.taken'), { bib: n });
  if (bib.outcome === 'out_of_range') return fmt(t('organizer.kitOffline.review.bib.outOfRange'), { bib: n });
  if (bib.outcome === 'registration_has_other') return fmt(t('organizer.kitOffline.review.bib.hasOther'), { bib: bib.number ?? n });
  return fmt(t('organizer.kitOffline.review.bib.other'), { bib: n, reason: bib.outcome.replace(/_/g, ' ') });
}

export function ReviewPanel({ eventId, timezone, canCheck, local, active, onChanged }: {
  eventId: string; timezone: string; /** Owner and admin. */ canCheck: boolean; /** This desk's own outcomes (what ops may see). */ local: LocalScan[]; active: boolean; onChanged?: () => void;
}) {
  const { t, token, locale } = useApp();
  const [filter, setFilter] = useState<'needs_review' | 'checked' | 'manual'>('needs_review');
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [counts, setCounts] = useState<{ needsReview: number; checked: number } | null>(null);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState<ReviewRow | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const key = useRef(newIdempotencyKey());

  const load = useCallback(async () => {
    if (!token || !canCheck) return;
    setError(false);
    try {
      const page = await kitOfflineApi.review(token, eventId, { status: filter, limit: 50 });
      setRows(page.items ?? []); setCounts(page.counts ?? null);
    } catch { setError(true); }
  }, [token, eventId, canCheck, filter]);
  useEffect(() => { if (active) void load(); }, [load, active]);

  async function mark() {
    if (!token || !checking) return;
    setBusy(true); setProblem(null);
    try { await kitOfflineApi.check(token, eventId, checking.id, note.trim() ? { note: note.trim() } : {}, key.current); setChecking(null); setNote(''); key.current = newIdempotencyKey(); await load(); onChanged?.(); }
    catch (err) { setProblem(s7ErrorKey(err)); } finally { setBusy(false); }
  }
  const noteNeeded = checking?.outcome === 'revoked_after_scan';
  const noteOk = noteNeeded ? reasonValid(note) : !note.trim() || reasonValid(note);

  if (!canCheck) {
    const mine = local.filter(s => s.state === 'needs_review');
    return (
      <div className="space-y-3" data-testid="offline-review">
        <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{t('organizer.kitOffline.review.title')}</h2>
        <Alert tone="info">{t('organizer.kitOffline.review.askOwner')}</Alert>
        {mine.length === 0 ? <EmptyState title={t('organizer.kitOffline.review.empty')} /> : (
          <ul className="divide-y divide-[var(--color-border-secondary)] rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)]" data-testid="offline-review-local">
            {mine.map(s => (
              <li key={s.clientRef} className="p-3 text-sm">
                <p className="font-semibold text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{s.name}</p>
                <p className="text-[var(--color-fg-secondary)]">{s.outcome && OUTCOME_KEY[s.outcome] ? t(OUTCOME_KEY[s.outcome]) : s.bibOutcome ? bibReviewText(t, { outcome: s.bibOutcome as never, claimed: s.bibClaim }) : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="offline-review">
      <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{t('organizer.kitOffline.review.title')}</h2>
      <Segmented className="w-fit max-w-full overflow-x-auto" value={filter} onChange={v => { setRows(null); setFilter(v as typeof filter); }}
        options={[['needs_review', `${t('organizer.kitOffline.review.filter.needs')}${counts ? ` (${counts.needsReview})` : ''}`], ['checked', t('organizer.kitOffline.review.filter.checked')], ['manual', t('organizer.kitOffline.review.filter.manual')]]} />
      {error ? <PageError onRetry={() => void load()} /> : !rows ? <SkeletonCard /> : rows.length === 0 ? <EmptyState title={t('organizer.kitOffline.review.empty')} /> : (
        <ul className="space-y-3" data-testid="offline-review-list">
          {rows.map(r => (
            <li key={r.id}>
              <Card><CardContent className="space-y-2" data-testid="offline-review-row">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{r.card?.displayName ?? '—'}{r.card?.bibNumber ? ` · ${r.card.bibNumber}` : ''}</p>
                    <p className="text-sm text-[var(--color-fg-quaternary)]">{r.card?.categoryName ?? ''}{r.deviceLabel ? ` · ${r.deviceLabel}` : ''}</p>
                  </div>
                  <Badge tone={r.reviewStatus === 'checked' ? 'success' : 'warning'}>{r.reviewStatus === 'checked' ? t('organizer.kitOffline.review.filter.checked') : t('organizer.kitOffline.review.filter.needs')}</Badge>
                </div>
                {OUTCOME_KEY[r.outcome] && <p className="text-sm text-[var(--color-fg-secondary)]">{t(OUTCOME_KEY[r.outcome])}</p>}
                {r.bibOutcome && <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="offline-review-bib">{bibReviewText(t, { outcome: r.bibOutcome, claimed: r.bibClaimed })}</p>}
                <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('organizer.kitOffline.review.times'), { device: eventDateTime(r.deviceTime, timezone, locale), received: eventDateTime(r.receivedAt, timezone, locale) })}</p>
                {r.winner && <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('organizer.kitOffline.review.winner'), { time: eventDateTime(r.winner.collectedAt, timezone, locale), desk: r.winner.deviceLabel ?? r.winner.method ?? '—' })}</p>}
                {r.note && <p className="text-sm text-[var(--color-fg-secondary)]">{r.note}</p>}
                <div className="flex flex-wrap gap-2">
                  {r.bibOutcome && <Link href={`/organizer/events/?event=${encodeURIComponent(eventId)}&view=bibs`} className="inline-flex"><Button size="sm" variant="secondary">{t('organizer.kitOffline.review.bib.fix')}</Button></Link>}
                  {r.reviewStatus === 'needs_review' && <Button size="sm" variant="secondary" onClick={() => { setNote(''); setProblem(null); setChecking(r); }} data-testid="offline-review-check">{t('organizer.kitOffline.review.check')}</Button>}
                </div>
              </CardContent></Card>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!checking} onClose={() => { if (!busy) setChecking(null); }} title={t('organizer.kitOffline.review.check')} size="md">
        <div className="space-y-3" data-testid="offline-review-dialog">
          {problem && <div role="alert"><Alert tone="error">{t(problem)}</Alert></div>}
          <Field label={t('organizer.kitOffline.review.note')} hint={`${note.trim().length}/${REASON_MAX}`} error={noteNeeded && !noteOk ? t('organizer.kitOffline.review.noteRequired') : undefined} required={noteNeeded}>
            <Textarea rows={3} maxLength={REASON_MAX} value={note} onChange={e => setNote(e.target.value)} data-testid="offline-review-note" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setChecking(null)} disabled={busy}>{t('common.cancel')}</Button>
          <Button loading={busy} disabled={!noteOk} onClick={() => void mark()} data-testid="offline-review-confirm">{t('organizer.kitOffline.review.check')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
