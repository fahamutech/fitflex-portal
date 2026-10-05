'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, RecoveryFilter, RecoveryRow } from '@/lib/api';
import { RECOVERY_FILTERS, RECOVERY_TONE, whenText } from '@/lib/recovery';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Spinner } from '@/components/shared';
import { RecoveryCase } from '@/components/account-recovery';
import { fill } from '@/components/communication-shared';
import type { MessageKey } from '@/lib/i18n';

/**
 * Account recovery: people who lost every verified number and email and forgot
 * their PIN ask to move their account to a new number or email. The queue,
 * and one request at a time (?id=<id>) to compare answers with the account.
 */
export default function AccountRecoveryPage() {
  const { token, user, t, locale } = useApp();
  const [rows, setRows] = useState<RecoveryRow[] | null>(null);
  const [filter, setFilter] = useState<RecoveryFilter>('open');
  const [off, setOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // The open request lives in the URL so it survives a refresh and can be shared.
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
    setError(null);
    try {
      setRows((await api.recoveries(token, filter)).recoveries);
      setOff(false);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) setOff(true);
      else setError(t('rec.loadError'));
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filter]);
  useEffect(() => { load(); }, [load]);

  if (!token || user?.userType !== 'admin') return null;

  if (openId) return <RecoveryCase id={openId} token={token} t={t} locale={locale} onBack={() => { open(null); load(); }} />;

  const kind = (type: string) => t(type === 'email' ? 'rec.email' : 'rec.phone');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('rec.title')}
        description={t('rec.description')}
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />{t('rec.refresh')}</Button>}
      />
      {error && <Alert tone="error">{error}</Alert>}

      {off ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center" data-testid="rec-off">
            <KeyRound className="h-6 w-6 text-[var(--color-fg-quaternary)]" />
            <p className="font-medium">{t('rec.off')}</p>
            <p className="text-sm text-[var(--color-fg-quaternary)]">{t('rec.offBody')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div role="tablist" className="flex flex-wrap gap-1 self-start rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1 w-fit">
            {RECOVERY_FILTERS.map(f => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => { setRows(null); setFilter(f); }} data-testid={`rec-tab-${f}`}
                className={`rounded-md px-3 py-1.5 text-sm ${filter === f ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
                {t(`rec.filter.${f}` as MessageKey)}
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]">
                  <KeyRound className="h-6 w-6" />{t('rec.empty')}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm" data-testid="rec-table">
                    <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                      <tr className="border-b border-[var(--color-border-secondary)]">
                        <th className="px-4 py-2.5 font-medium">{t('rec.col.name')}</th>
                        <th className="px-4 py-2.5 font-medium">{t('rec.col.asked')}</th>
                        <th className="px-4 py-2.5 font-medium">{t('rec.col.moveTo')}</th>
                        <th className="px-4 py-2.5 font-medium">{t('rec.col.wait')}</th>
                        <th className="px-4 py-2.5 font-medium">{t('rec.col.answers')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-secondary)]">
                      {rows.map(r => (
                        <tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => open(r.id)} data-testid={`rec-row-${r.id}`}>
                          <td className="px-4 py-3">
                            <button className="text-left font-medium hover:underline" onClick={e => { e.stopPropagation(); open(r.id); }}>{r.claimedName}</button>
                            <p className="text-xs text-[var(--color-fg-quaternary)]">{t('rec.accountName')}: {r.accountName || '—'}</p>
                          </td>
                          <td className="px-4 py-3 text-xs tabular-nums">{whenText(r.createdAt, locale)}</td>
                          <td className="px-4 py-3">{kind(r.newIdentifierType)}</td>
                          <td className="px-4 py-3">
                            {r.status !== 'open' ? <Badge tone={RECOVERY_TONE[r.status]}>{t(`rec.status.${r.status}` as MessageKey)}</Badge>
                              : r.ready ? <Badge tone="success">{t('rec.ready')}</Badge>
                              : <span className="text-xs">{fill(t('rec.canDecideAfter'), { time: whenText(r.waitUntil, locale) })}</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={r.answered ? 'brand' : 'gray'}>{t(r.answered ? 'rec.answered' : 'rec.notAnswered')}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
