'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, PromotionOverview } from '@/lib/api';
import { TYPE_KEY as ENTITY_TYPE_KEY } from '@/lib/moderation';
import { TYPE_KEY, dateTime, errorKey } from '@/lib/promotions';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Card, CardContent, CardHeader, PageHeader, Spinner } from '@/components/shared';

/** Where moderation and promotion stand right now, and what needs a person. */
export default function PromotionOverviewPage() {
  const { token, user, t } = useApp();
  const [data, setData] = useState<PromotionOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { setData(await api.promotionOverview(token)); }
    catch (err) { setError(t(errorKey(err))); }
  }, [token, t]);
  useEffect(() => { load(); }, [load]);
  if (!token || user?.userType !== 'admin') return null;

  const tiles: Array<{ key: string; label: MessageKey; value: number | undefined; href: string; attention?: boolean }> = [
    { key: 'active', label: 'pro.tab.active', value: data?.active, href: '/admin/promotions' },
    { key: 'scheduled', label: 'pro.tab.scheduled', value: data?.scheduled, href: '/admin/promotions' },
    { key: 'requests', label: 'pro.ov.pendingRequests', value: data?.pendingPromotionRequests, href: '/admin/promotions', attention: true },
    { key: 'moderation', label: 'pro.ov.pendingModeration', value: data?.pendingModeration, href: '/admin/moderation', attention: true },
    { key: 'paused', label: 'pro.tab.paused', value: data?.paused, href: '/admin/promotions' },
    { key: 'drafts', label: 'pro.tab.draft', value: data?.drafts, href: '/admin/promotions' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('pro.ov.title')} description={t('pro.ov.description')}
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />{t('mod.refresh')}</Button>} />
      {error && <Alert tone="error"><span className="flex flex-wrap items-center justify-between gap-2">{error}<Button size="sm" variant="secondary" onClick={load} data-testid="overview-retry">{t('pro.retry')}</Button></span></Alert>}
      {!data && !error && <Spinner className="h-6 w-6" />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3" data-testid="overview-tiles">
            {tiles.map(tile => (
              <Link key={tile.key} href={tile.href} data-testid={`overview-${tile.key}`}
                className={`min-w-0 rounded-[var(--radius-lg)] border p-4 hover:bg-[var(--color-bg-secondary)] ${tile.attention && (tile.value ?? 0) > 0 ? 'border-[var(--color-warning-500)]' : 'border-[var(--color-border-secondary)]'}`}>
                <p className="text-sm text-[var(--color-fg-tertiary)]">{t(tile.label)}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">{tile.value ?? 0}</p>
              </Link>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader><h2 className="font-semibold">{t('pro.ov.expiring')}</h2></CardHeader>
              <CardContent>
                {(data.expiringSoon ?? []).length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="overview-expiring-empty">{t('pro.ov.noneExpiring')}</p> : (
                  <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="overview-expiring">
                    {(data.expiringSoon ?? []).map(p => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 [overflow-wrap:anywhere]">
                        <Link href={`/admin/promotions?item=${encodeURIComponent(p.id)}`} className="inline-flex min-h-10 items-center hover:underline">{t(ENTITY_TYPE_KEY[p.entityType])} · {t(TYPE_KEY[p.type])}</Link>
                        <span className="text-xs text-[var(--color-fg-tertiary)]">{dateTime(p.endsAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><h2 className="font-semibold">{t('pro.ov.recent')}</h2></CardHeader>
              <CardContent>
                {(data.recent ?? []).length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('pro.ov.noneRecent')}</p> : (
                  <ul className="space-y-2 text-sm" data-testid="overview-recent">
                    {(data.recent ?? []).map(e => (
                      <li key={e.id} className="[overflow-wrap:anywhere]"><span className="font-medium">{e.action.replace(/^(promotion|moderation|campaign)\./, '$1 · ').replace(/_/g, ' ')}</span>
                        <span className="block text-xs text-[var(--color-fg-quaternary)]">{dateTime(e.at)} · {e.actor}</span></li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
