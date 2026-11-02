'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { errorCode } from '@/lib/vendor';
import { auditApi, auditText, NO_AUDIT_FILTERS, type AuditEntry, type AuditFilters } from '@/lib/audit-log';
import { whenText } from '@/lib/money-approval';
import {
  Alert, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, SkeletonTable, Table, TBody, Td, Th, THead, Tr,
} from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../providers';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'invalid';

/**
 * Audit log viewer (admin audit S2): GET /admin/audit-log, scope `audit`, newest first, keyset pagination.
 * Everything shown is plain text (React-escaped): reasons and before/after values are typed or recorded by people.
 * The server has already removed credentials from before/after.
 */
export default function AuditLogPage() {
  const { token, t, locale } = useApp();
  const [draft, setDraft] = useState<AuditFilters>(NO_AUDIT_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(NO_AUDIT_FILTERS);
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [more, setMore] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [open, setOpen] = useState<AuditEntry | null>(null);
  // A newer first-page load makes an older answer (or a load-more started before it) stale.
  const gen = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const mine = ++gen.current;
    setState('loading'); setMore('idle');
    try {
      const page = await auditApi.list(token, applied);
      if (mine !== gen.current) return;
      setItems(page.items); setCursor(page.nextCursor ?? null); setState('ready');
    } catch (err) {
      if (mine !== gen.current) return;
      setItems([]); setCursor(null);
      if (err instanceof ApiError && err.status === 403 && errorCode(err) === 'acl_forbidden') setState('forbidden');
      else if (err instanceof ApiError && err.status === 400 && errorCode(err) === 'invalid_filter') setState('invalid');
      else setState('error');
    }
  }, [token, applied]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!token || !cursor || more === 'busy') return;
    const mine = gen.current;
    setMore('busy');
    try {
      const page = await auditApi.list(token, applied, cursor);
      if (mine !== gen.current) return;
      setItems(prev => [...prev, ...page.items]); setCursor(page.nextCursor ?? null); setMore('idle');
    } catch {
      if (mine === gen.current) setMore('failed');
    }
  }

  const set = (patch: Partial<AuditFilters>) => setDraft(d => ({ ...d, ...patch }));
  const apply = () => setApplied({ ...draft });
  const clear = () => { setDraft(NO_AUDIT_FILTERS); setApplied({ ...NO_AUDIT_FILTERS }); };

  return (
    <div className="space-y-4" data-testid="audit-log">
      <PageHeader
        title={t('auditLog.title')}
        description={t('auditLog.intro')}
        actions={state !== 'forbidden' ? (
          <Button variant="secondary" className="min-h-11" onClick={() => void load()}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('admin.action.refresh')}</Button>
        ) : undefined}
      />
      <p className="text-xs text-[var(--color-fg-tertiary)]" data-testid="audit-append-only">{t('auditLog.appendOnly')}</p>

      {state === 'forbidden' ? (
        <div data-testid="audit-forbidden"><Alert tone="error">{t('auditLog.forbidden')}</Alert></div>
      ) : (
        <>
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={e => { e.preventDefault(); apply(); }}
            data-testid="audit-filters"
          >
            <Field label={t('auditLog.filter.actor')}><Input value={draft.actor} onChange={e => set({ actor: e.target.value })} data-testid="audit-f-actor" /></Field>
            <Field label={t('auditLog.filter.action')}><Input value={draft.action} onChange={e => set({ action: e.target.value })} data-testid="audit-f-action" /></Field>
            <Field label={t('auditLog.filter.target')}><Input value={draft.target} onChange={e => set({ target: e.target.value })} data-testid="audit-f-target" /></Field>
            <Field label={t('auditLog.filter.from')}><Input type="datetime-local" value={draft.from} onChange={e => set({ from: e.target.value })} data-testid="audit-f-from" /></Field>
            <Field label={t('auditLog.filter.to')}><Input type="datetime-local" value={draft.to} onChange={e => set({ to: e.target.value })} data-testid="audit-f-to" /></Field>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
              <Button type="submit" className="min-h-11" data-testid="audit-apply">{t('auditLog.filter.apply')}</Button>
              <Button type="button" variant="secondary" className="min-h-11" onClick={clear} data-testid="audit-clear">{t('auditLog.filter.clear')}</Button>
            </div>
          </form>

          {state === 'loading' ? <div aria-busy="true"><SkeletonTable rows={6} columns={5} /></div>
            : state === 'error' ? <div data-testid="audit-error"><ErrorState title={t('auditLog.loadFailed')} onRetry={() => void load()} retryLabel={t('common.tryAgain')} /></div>
            : state === 'invalid' ? <div data-testid="audit-invalid"><Alert tone="error">{t('auditLog.invalidFilter')}</Alert></div>
            : items.length === 0 ? <div data-testid="audit-empty"><EmptyState title={t('auditLog.empty')} /></div>
            : (
              <>
                <Card className="p-0">
                  <Table aria-label={t('auditLog.title')} data-testid="audit-table">
                    <THead>
                      <Tr>
                        <Th>{t('auditLog.col.time')}</Th>
                        <Th>{t('auditLog.col.actor')}</Th>
                        <Th>{t('auditLog.col.action')}</Th>
                        <Th>{t('auditLog.col.target')}</Th>
                        <Th>{t('auditLog.col.reason')}</Th>
                        <Th><span className="sr-only">{t('auditLog.details')}</span></Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {items.map(r => (
                        <Tr key={r.id} data-testid={`audit-row-${r.id}`}>
                          <Td className="whitespace-nowrap text-xs">{whenText(r.at, locale)}</Td>
                          <Td><span className="font-mono text-xs break-all">{r.actor ?? '—'}</span></Td>
                          <Td><span className="font-mono text-xs">{r.action}</span></Td>
                          <Td><span className="font-mono text-xs break-all">{r.target ?? '—'}</span></Td>
                          <Td className="max-w-[20rem] text-xs">
                            {r.reason
                              ? <span className="whitespace-pre-wrap break-words" data-testid="audit-reason">{r.reason}</span>
                              : <span className="text-[var(--color-fg-tertiary)]">{t('auditLog.noReason')}</span>}
                          </Td>
                          <Td>
                            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setOpen(r)} data-testid="audit-details">{t('auditLog.details')}</Button>
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </Card>
                {more === 'failed' && <div data-testid="audit-more-error"><Alert tone="error">{t('auditLog.loadMoreFailed')}</Alert></div>}
                {cursor ? (
                  <div className="flex justify-center">
                    <Button variant="secondary" className="min-h-11" onClick={() => void loadMore()} disabled={more === 'busy'} data-testid="audit-more">{t('auditLog.loadMore')}</Button>
                  </div>
                ) : (
                  <p className="text-center text-xs text-[var(--color-fg-tertiary)]" data-testid="audit-end">{t('auditLog.end')}</p>
                )}
              </>
            )}
        </>
      )}

      <Dialog open={!!open} onClose={() => setOpen(null)} title={t('auditLog.detail.title')} size="lg">
        {open && (
          <div className="space-y-4 px-6 py-5" data-testid="audit-detail">
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-[var(--color-fg-tertiary)]">{t('auditLog.col.time')}</dt><dd>{whenText(open.at, locale)}</dd></div>
              <div><dt className="text-xs text-[var(--color-fg-tertiary)]">{t('auditLog.detail.id')}</dt><dd className="font-mono text-xs break-all">{open.id}</dd></div>
              <div><dt className="text-xs text-[var(--color-fg-tertiary)]">{t('auditLog.col.actor')}</dt><dd className="font-mono text-xs break-all">{open.actor ?? '—'}</dd></div>
              <div><dt className="text-xs text-[var(--color-fg-tertiary)]">{t('auditLog.col.action')}</dt><dd className="font-mono text-xs">{open.action}</dd></div>
              <div><dt className="text-xs text-[var(--color-fg-tertiary)]">{t('auditLog.col.target')}</dt><dd className="font-mono text-xs break-all">{open.target ?? '—'}</dd></div>
              <div><dt className="text-xs text-[var(--color-fg-tertiary)]">{t('auditLog.col.reason')}</dt><dd className="whitespace-pre-wrap break-words">{open.reason ?? t('auditLog.noReason')}</dd></div>
            </dl>
            {(['before', 'after'] as const).map(k => {
              const text = auditText(open[k]);
              return (
                <div key={k}>
                  <h4 className="mb-1 text-xs font-semibold text-[var(--color-fg-secondary)]">{t(k === 'before' ? 'auditLog.detail.before' : 'auditLog.detail.after')}</h4>
                  {text
                    ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 font-mono text-xs" data-testid={`audit-${k}`}>{text}</pre>
                    : <p className="text-xs text-[var(--color-fg-tertiary)]" data-testid={`audit-${k}`}>{t('auditLog.detail.none')}</p>}
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter><Button variant="secondary" onClick={() => setOpen(null)}>{t('common.close')}</Button></DialogFooter>
      </Dialog>
    </div>
  );
}
