'use client';
// The checked rows (preview), problem rows first, paged by cursor. Read only. Used by step "Check" and in the result.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fmt } from '@/lib/vendor';
import {
  hasMessageKey, errorText, fieldKey, importApi, rowErrorText, rowStatusKey, rowStatusTone, valueText, type ApplyState, type ImportCounts, type ImportRow,
} from '@/lib/vendor-import';
import { Badge, EmptyState, ErrorState, SkeletonCard } from '@/components/shared';
import { IssueList, Btn } from './parts';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';

const FILTERS = ['all', 'invalid', 'needs_review', 'valid'] as const;
type Filter = (typeof FILTERS)[number];
const applyTone = (s: ApplyState) => (s === 'applied' ? 'success' : s === 'failed' ? 'danger' : 'gray');

export function RowsList({ batchId, counts, showApplyState = false, version }: { batchId: string; counts: ImportCounts | null; showApplyState?: boolean; /** Reload when this changes (after a mapping save or an apply). */ version: string }) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (next?: string | null) => {
    if (!token) return;
    const req = ++requestId.current;
    if (next) { setMoreBusy(true); setMoreFailed(null); } else setState('loading');
    try {
      const res = await importApi.preview(token, batchId, { status: filter === 'all' ? undefined : filter, cursor: next });
      if (req !== requestId.current) return;
      setRows(cur => (next ? [...cur, ...res.rows] : res.rows));
      setCursor(res.nextCursor ?? null);
      setState('ready');
    } catch (err) {
      if (req !== requestId.current || vendor.handleError(err)) return;
      if (next) setMoreFailed(errorText(err, locale, t)); else setState('error');
    } finally { if (req === requestId.current) setMoreBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, batchId, filter, version, locale]);
  useEffect(() => { void load(); }, [load]);

  const label = (f: Filter) => (f === 'all' ? t('vendor.import.filter.all') : t(`vendor.import.count.${f}` as 'vendor.import.count.valid')) + (f !== 'all' && counts ? ` (${counts[f]})` : '');

  return (
    <div className="space-y-3" aria-busy={state === 'loading'}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('vendor.import.filter.label')}>
        {FILTERS.map(f => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            data-testid={`import-filter-${f}`}
            className={`inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border px-3 text-sm font-medium [overflow-wrap:anywhere] ${filter === f
              ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]'
              : 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-secondary)]'}`}
          >
            {label(f)}
          </button>
        ))}
      </div>
      {state === 'loading' && <div role="status" aria-label={t('vendor.import.rowsLoading')}><SkeletonCard lines={3} /></div>}
      {state === 'error' && <ErrorState title={t('vendor.import.rowsError')} onRetry={() => load()} retryLabel={t('vendor.import.retry')} />}
      {state === 'ready' && rows.length === 0 && <EmptyState title={t('vendor.import.rowsEmpty')} />}
      {state === 'ready' && rows.length > 0 && (
        <ul className="space-y-3" data-testid="import-rows">
          {rows.map(row => {
            const values = Object.entries(row.values ?? {}).map(([k, v]) => [k, valueText(k, v)] as const).filter(([, v]) => v !== null);
            const failure = rowErrorText(row, locale, t);
            return (
              <li key={row.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] p-3 sm:p-4" data-testid="import-row" data-row-status={row.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--color-fg-primary)]">{fmt(t('vendor.import.rowNo'), { n: row.rowNo })}</span>
                  <Badge tone={rowStatusTone(row.status)}>{t(rowStatusKey(row.status))}</Badge>
                  {showApplyState && row.applyState !== 'pending' && <Badge tone={applyTone(row.applyState)}>{t(`vendor.import.applyState.${row.applyState}` as 'vendor.import.applyState.applied')}</Badge>}
                </div>
                {values.length > 0 && (
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                    {values.map(([k, v]) => (
                      <div key={k} className="flex min-w-0 gap-2">
                        <dt className="shrink-0 text-[var(--color-fg-quaternary)]">{hasMessageKey(fieldKey(k)) ? t(fieldKey(k)) : k}:</dt>
                        <dd className="min-w-0 text-[var(--color-fg-primary)] [overflow-wrap:anywhere] line-clamp-2">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <IssueList issues={row.issues} />
                {failure && <p className="mt-2 text-sm font-medium text-[var(--color-error-700)] [overflow-wrap:anywhere]" data-testid="import-row-failure">{failure}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {state === 'ready' && cursor && (
        <div className="flex flex-col items-start gap-2">
          {moreFailed && <p role="alert" className="text-sm text-[var(--color-error-700)]">{moreFailed}</p>}
          <Btn variant="secondary" onClick={() => load(cursor)} loading={moreBusy} data-testid="import-rows-more">{t('vendor.import.loadMore')}</Btn>
        </div>
      )}
    </div>
  );
}
