'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileUp } from 'lucide-react';
import { eatDateTime, fmt } from '@/lib/vendor';
import { entityKey, errorText, importApi, importOpen, type ImportBatch } from '@/lib/vendor-import';
import { EmptyState, ErrorState, PageHeader, SkeletonCard } from '@/components/shared';
import { StatusBadge, TemplatePanel, primaryLinkCls, linkBtnCls, Btn } from '@/components/vendor/import/parts';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../providers';

/**
 * Smart Import home: my imports (newest first), the entry to a new import and the templates. The Shell guards the area
 * (tools.import and the `import` permission, failing closed); the server decides everything else.
 */
export default function VendorImportPage() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState<string | null>(null);
  const requestId = useRef(0);
  const allowed = importOpen(vendor.me);

  const load = useCallback(async (next?: string | null) => {
    if (!token || !allowed) return;
    const req = ++requestId.current;
    if (next) { setMoreBusy(true); setMoreFailed(null); } else setState('loading');
    try {
      const res = await importApi.list(token, { cursor: next });
      if (req !== requestId.current) return;
      setBatches(cur => (next ? [...cur, ...res.batches] : res.batches));
      setCursor(res.nextCursor ?? null);
      setState('ready');
    } catch (err) {
      if (req !== requestId.current || vendor.handleError(err)) return;
      if (next) setMoreFailed(errorText(err, locale, t)); else setState('error');
    } finally { if (req === requestId.current) setMoreBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, allowed, locale]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6" data-testid="import-home">
      <PageHeader
        title={t('vendor.import.title')}
        description={t('vendor.import.subtitle')}
        actions={<Link href="/vendor/import/new/" className={primaryLinkCls} data-testid="import-start"><FileUp aria-hidden="true" className="h-4 w-4" />{t('vendor.import.start')}</Link>}
      />

      <section aria-labelledby="import-history-title" aria-busy={state === 'loading'}>
        <h2 id="import-history-title" className="mb-3 text-base font-semibold text-[var(--color-fg-primary)]">{t('vendor.import.history')}</h2>
        {state === 'loading' && <div role="status" aria-label={t('vendor.import.loading')}><SkeletonCard lines={2} /></div>}
        {state === 'error' && <ErrorState title={t('vendor.import.loadError')} onRetry={() => load()} retryLabel={t('vendor.import.retry')} />}
        {state === 'ready' && batches.length === 0 && (
          <EmptyState
            title={t('vendor.import.empty.title')}
            body={t('vendor.import.empty.body')}
            action={<Link href="/vendor/import/new/" className={primaryLinkCls}>{t('vendor.import.start')}</Link>}
          />
        )}
        {state === 'ready' && batches.length > 0 && (
          <ul className="space-y-3" data-testid="import-list">
            {batches.map(b => {
              const c = b.counts;
              const open = ['mapping_required', 'ready', 'applying'].includes(b.status);
              const action = t(open ? 'vendor.import.row.resume' : 'vendor.import.row.view');
              return (
                <li key={b.id} className="rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] p-4" data-testid="import-item" data-batch={b.id}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{b.filename}</p>
                      <p className="mt-0.5 text-sm text-[var(--color-fg-quaternary)]">{t(entityKey(b.entity))} · {eatDateTime(b.createdAt, locale)}</p>
                      {c && <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">{fmt(t('vendor.import.row.summary'), { applied: c.applied, problems: c.invalid + c.failed, total: c.total })}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusBadge status={b.status} />
                      <Link href={`/vendor/import/batch/?id=${encodeURIComponent(b.id)}`} className={linkBtnCls} aria-label={fmt(t('vendor.import.row.open'), { action, name: b.filename })}>{action}</Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {state === 'ready' && cursor && (
          <div className="mt-3 flex flex-col items-start gap-2">
            {moreFailed && <p role="alert" className="text-sm text-[var(--color-error-700)]">{moreFailed}</p>}
            <Btn variant="secondary" onClick={() => load(cursor)} loading={moreBusy}>{t('vendor.import.loadMore')}</Btn>
          </div>
        )}
      </section>

      <TemplatePanel />
    </div>
  );
}
