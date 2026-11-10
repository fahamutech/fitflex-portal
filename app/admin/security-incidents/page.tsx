'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldQuestionMark } from 'lucide-react';
import { useApp } from '../../providers';
import type { MessageKey } from '@/lib/i18n';
import {
  SECURITY_INCIDENT_STATUSES, SecurityIncident, SecurityIncidentStatus, securityFailure, securityIncidentsApi,
} from '@/lib/security-incidents';
import { Alert, Button, Card, CardContent, EmptyState, ErrorState, PageHeader, Segmented, SkeletonTable, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { ProtectionBadge, SecurityForbidden, SecurityIncidentCase, SecurityOff, SecurityStatusBadge, eatLabel } from '@/components/security-incidents';
import { fill } from '@/components/communication-shared';

type ListState = 'loading' | 'ready' | 'off' | 'forbidden' | 'error';

/**
 * Security reports (S4b): members report a web check-in they do not recognise; staff with the
 * `security_incidents` scope acknowledge and resolve each report. The list, and one report at a time (?id=<id>).
 * While the server's SECURITY_INCIDENT_REPORTS is off the list answers 404 and the page says "not available yet".
 */
export default function SecurityIncidentsPage() {
  const { token, user, t, locale } = useApp();
  const [status, setStatus] = useState<SecurityIncidentStatus>('open');
  const [rows, setRows] = useState<SecurityIncident[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<ListState>('loading');
  const [more, setMore] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [openId, setOpenId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const gen = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);

  // The open report lives in the URL so it survives a refresh and can be shared.
  useEffect(() => {
    const sync = () => setOpenId(new URLSearchParams(window.location.search).get('id'));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const open = (id: string | null) => {
    history.pushState(null, '', id ? `?id=${encodeURIComponent(id)}` : window.location.pathname);
    setOpenId(id);
  };

  const load = useCallback(async () => {
    if (!token) return;
    const mine = ++gen.current;
    setState('loading'); setMore('idle');
    try {
      const page = await securityIncidentsApi.list(token, status);
      if (mine !== gen.current) return;
      setRows(page.incidents); setNext(page.next ?? null); setState('ready');
    } catch (err) {
      if (mine !== gen.current) return;
      const f = securityFailure(err, true);
      setRows([]); setNext(null);
      setState(f === 'off' || f === 'forbidden' ? f : 'error');
    }
  }, [token, status]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!token || !next) return;
    const mine = gen.current;
    setMore('loading');
    try {
      const page = await securityIncidentsApi.list(token, status, next);
      if (mine !== gen.current) return;
      setRows(r => [...r, ...page.incidents.filter(i => !r.some(x => x.id === i.id))]);
      setNext(page.next ?? null); setMore('idle');
    } catch {
      if (mine === gen.current) setMore('failed');
    }
  }

  // Back from a report: focus returns to the row that opened it, once the list is drawn again.
  useEffect(() => {
    if (openId || !returnTo || state === 'loading') return;
    tableRef.current?.querySelector<HTMLElement>(`[data-incident="${CSS.escape(returnTo)}"] button`)?.focus();
    setReturnTo(null);
  }, [openId, returnTo, state, rows]);

  if (!token || user?.userType !== 'admin') return null;

  if (openId) return <SecurityIncidentCase key={openId} id={openId} token={token} t={t} locale={locale} onBack={() => { setReturnTo(openId); open(null); void load(); }} />;

  const blocked = state === 'off' || state === 'forbidden';

  return (
    <div className="space-y-6" data-testid="secinc-page">
      <PageHeader
        title={t('secInc.title')}
        description={t('secInc.description')}
        actions={!blocked ? <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('secInc.refresh')}</Button> : undefined}
      />

      {state === 'off' ? <SecurityOff t={t} /> : state === 'forbidden' ? <SecurityForbidden t={t} /> : (
        <>
          <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="secinc-no-void">{t('secInc.noVoid')}</p>
          <div role="group" aria-label={t('secInc.filterLabel')} className="w-fit max-w-full overflow-x-auto" data-testid="secinc-filter">
            <Segmented
              value={status}
              options={SECURITY_INCIDENT_STATUSES.map(s => [s, t(`secInc.status.${s}` as MessageKey)])}
              onChange={v => setStatus(v as SecurityIncidentStatus)}
            />
          </div>

          {state === 'loading' ? <div role="status" aria-busy="true" aria-label={t('secInc.loading')} data-testid="secinc-loading"><SkeletonTable rows={4} columns={5} /></div>
            : state === 'error' ? <div data-testid="secinc-error"><ErrorState title={t('secInc.loadError')} message={t('secInc.loadErrorBody')} onRetry={() => void load()} retryLabel={t('secInc.retry')} /></div>
            : rows.length === 0 ? <div data-testid="secinc-empty"><EmptyState icon={<ShieldQuestionMark />} title={t(`secInc.empty.${status}` as MessageKey)} body={t('secInc.emptyBody')} /></div>
            : (
              <>
                <Card>
                  <CardContent className="p-0">
                    <div ref={tableRef}>
                    <Table aria-label={t('secInc.title')} wrapperClassName="rounded-none border-0" className="min-w-[760px]" data-testid="secinc-table">
                      <THead>
                        <Tr>
                          <Th>{t('secInc.col.reported')}</Th>
                          <Th>{t('secInc.col.gym')}</Th>
                          <Th>{t('secInc.col.checkin')}</Th>
                          <Th>{t('secInc.col.protection')}</Th>
                          <Th>{t('secInc.col.status')}</Th>
                        </Tr>
                      </THead>
                      <TBody>
                        {rows.map(r => (
                          <Tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => open(r.id)} data-incident={r.id} data-testid={`secinc-row-${r.id}`}>
                            <Td>
                              <Button variant="link" className="h-auto px-0 text-left font-medium text-inherit tabular-nums" onClick={e => { e.stopPropagation(); open(r.id); }}>
                                {eatLabel(r.reportedAt, locale, t)}<span className="sr-only">. {fill(t('secInc.open'), { id: r.id })}</span>
                              </Button>
                              <p className="text-xs text-[var(--color-fg-tertiary)]">{r.id}</p>
                            </Td>
                            <Td>{r.snapshot?.gymName || t('secInc.unknownGym')}</Td>
                            <Td className="tabular-nums">{eatLabel(r.snapshot?.occurredAt, locale, t)}</Td>
                            <Td><ProtectionBadge protection={r.protection} t={t} /></Td>
                            <Td><SecurityStatusBadge incident={r} t={t} /></Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                    </div>
                  </CardContent>
                </Card>
                {more === 'failed' && <Alert tone="error">{t('secInc.moreFailed')}</Alert>}
                {next && (
                  <Button variant="secondary" disabled={more === 'loading'} onClick={() => void loadMore()} data-testid="secinc-more">
                    {more === 'loading' ? t('secInc.working') : t('secInc.more')}
                  </Button>
                )}
              </>
            )}
        </>
      )}
    </div>
  );
}
