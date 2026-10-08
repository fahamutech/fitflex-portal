'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ModerationCounts, ModerationEntityType, ModerationRow, ModerationStatus } from '@/lib/api';
import { ENTITY_TYPES, STATUS_KEY, STATUS_TAB_ORDER, STATUS_TONE, TYPE_KEY, dateTime, errorKey } from '@/lib/moderation';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Spinner } from '@/components/shared';
import { ModerationEntityView } from '@/components/moderation-entity';

const PAGE = 25;

/**
 * Listing moderation: gyms, trainers, vendors and products by moderation status,
 * and one listing at a time (?type=&item=) to see why it can or can't be listed
 * and to decide. The open listing lives in the URL, so it survives a refresh.
 */
export default function ModerationPage() {
  const { token, user, t } = useApp();
  const [type, setType] = useState<ModerationEntityType>('gym');
  const [status, setStatus] = useState<ModerationStatus>('pending');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ModerationRow[] | null>(null);
  const [counts, setCounts] = useState<ModerationCounts | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const sync = () => {
      const sp = new URLSearchParams(window.location.search);
      const ty = sp.get('type') as ModerationEntityType | null;
      if (ty && ENTITY_TYPES.includes(ty)) setType(ty);
      setOpenId(sp.get('item'));
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const open = (id: string | null) => {
    history.pushState(null, '', id ? `?type=${type}&item=${encodeURIComponent(id)}` : window.location.pathname);
    setOpenId(id);
  };

  const load = useCallback(async (cursor = 0) => {
    if (!token) return;
    const mine = ++seq.current;                       // a slower, older answer must not overwrite a newer one
    setError(null);
    try {
      const out = await api.moderationQueue(token, { entityType: type, status, q: q.trim() || undefined, cursor: cursor || undefined, limit: PAGE });
      if (mine !== seq.current) return;
      setRows(prev => (cursor && prev ? [...prev, ...out.items] : out.items));
      setCounts(out.counts);
      setNext(out.nextCursor);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(t(errorKey(err)));
      setRows([]);
    }
  }, [token, type, status, q, t]);

  useEffect(() => { setRows(null); const h = setTimeout(() => load(0), q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);

  if (!token || user?.userType !== 'admin') return null;

  if (openId) {
    return <ModerationEntityView entityType={type} entityId={openId} onBack={() => { open(null); load(0); }} onChanged={() => load(0)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('mod.title')}
        description={t('mod.description')}
        actions={<Button variant="secondary" size="sm" onClick={() => load(0)}><RefreshCw className="h-4 w-4" />{t('mod.refresh')}</Button>}
      />
      {error && <Alert tone="error"><span className="flex flex-wrap items-center justify-between gap-2">{error}<Button size="sm" variant="secondary" onClick={() => load(0)} data-testid="moderation-retry">{t('pro.retry')}</Button></span></Alert>}

      <div role="tablist" aria-label="Listing type" className="flex flex-wrap gap-1 border-b border-[var(--color-border-secondary)]">
        {ENTITY_TYPES.map(ty => (
          <button key={ty} role="tab" aria-selected={type === ty} onClick={() => { setType(ty); setRows(null); }} data-testid={`moderation-type-${ty}`}
            className={`-mb-px min-h-10 border-b-2 px-4 py-2 text-sm ${type === ty ? 'border-[var(--color-brand-600)] font-semibold text-[var(--color-fg-primary)]' : 'border-transparent text-[var(--color-fg-tertiary)]'}`}>
            {t(TYPE_KEY[ty])}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Moderation status" className="flex flex-wrap gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1">
          {STATUS_TAB_ORDER.map(s => (
            <button key={s} role="tab" aria-selected={status === s} onClick={() => { setStatus(s); setRows(null); }} data-testid={`moderation-tab-${s}`}
              className={`flex min-h-10 items-center gap-2 rounded-md px-3 py-1.5 text-sm ${status === s ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
              {t(STATUS_KEY[s])}
              <span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 text-xs tabular-nums">{counts ? (counts[s] ?? 0) : '·'}</span>
            </button>
          ))}
        </div>
        <input className="ui-input w-full sm:w-64" type="search" aria-label={t('mod.search')} placeholder={t('mod.search')} value={q} onChange={e => setQ(e.target.value)} data-testid="moderation-search" />
      </div>

      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : rows.length === 0 ? (error ? null : <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]" data-testid="moderation-empty">
              <ShieldCheck className="h-6 w-6" />
              {status === 'pending' ? t('mod.empty.pending') : t('mod.empty.other')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm" data-testid="moderation-table">
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                  <tr className="border-b border-[var(--color-border-secondary)]">
                    <th className="px-4 py-2.5 font-medium">{t('mod.col.name')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('mod.col.status')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('mod.col.decision')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {rows.map(r => (
                    <tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => open(r.id)} data-testid={`moderation-row-${r.id}`}>
                      <td className="max-w-[18rem] px-4 py-3 [overflow-wrap:anywhere]">
                        <button className="text-left font-medium text-[var(--color-fg-primary)] hover:underline" onClick={e => { e.stopPropagation(); open(r.id); }}>{r.name}</button>
                        {r.subtitle && <p className="text-xs text-[var(--color-fg-quaternary)]">{r.subtitle}</p>}
                      </td>
                      <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.moderationStatus]} dot>{t(STATUS_KEY[r.moderationStatus])}</Badge></td>
                      <td className="px-4 py-3 text-xs text-[var(--color-fg-tertiary)]">
                        {r.decidedAt ? <>{dateTime(r.decidedAt)}{r.reason && <p className="mt-0.5 max-w-xs truncate text-[var(--color-fg-secondary)]" title={r.reason}>{r.reason}</p>}</> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {next != null && <div className="flex justify-center"><Button variant="secondary" size="sm" onClick={() => load(next)} data-testid="moderation-more">{t('mod.more')}</Button></div>}
    </div>
  );
}
