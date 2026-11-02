'use client';
// Events S7 (spec §6.4, H11, AC-H11): "Recent redemptions" under the code lookup on /admin/event-rewards. Reward, masked person, state, claimed and redeemed times.
// The list never carries a code and this table never shows one. Hidden when the server does not have the route yet.
import { useEffect, useState } from 'react';
import { adminS7Api, type RedemptionRow } from '@/lib/events-s7-api';
import { eventDateTime } from '@/lib/events';
import { knownKey } from '@/lib/events-results';
import { Badge, Card, CardContent, CardHeader, SkeletonTable } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { useApp } from '../../app/providers';

export function RecentRedemptions() {
  const { t, token, locale } = useApp();
  const [rows, setRows] = useState<RedemptionRow[] | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!token) return;
    adminS7Api.redemptions(token, { limit: 20 }).then(p => setRows(p.items ?? [])).catch(() => setHidden(true));
  }, [token]);
  if (hidden) return null;
  const title = (r: RedemptionRow) => (typeof r.reward === 'string' ? r.reward : (locale === 'sw' ? r.reward?.sw || r.reward?.en : r.reward?.en || r.reward?.sw) ?? '—');
  const when = (iso: string | null | undefined) => (iso ? eventDateTime(iso, 'Africa/Dar_es_Salaam', locale) : '—');
  const columns: ColumnDef<RedemptionRow>[] = [
    { key: 'reward', header: t('admin.events.redemptions.col.reward'), cell: r => <span className="[overflow-wrap:anywhere]">{title(r)}</span> },
    { key: 'person', header: t('admin.events.redemptions.col.person'), cell: r => r.person ?? '—' },
    { key: 'state', header: t('admin.events.redemptions.col.state'), cell: r => <Badge tone={r.codeState === 'redeemed' ? 'success' : r.needsReview ? 'warning' : 'gray'}>{r.codeState ? t(knownKey(`admin.rewards.redemption.${r.codeState}`, 'admin.rewards.redemption.expired')) : '—'}</Badge> },
    { key: 'claimed', header: t('admin.events.redemptions.col.claimed'), cell: r => when(r.claimedAt) },
    { key: 'redeemed', header: t('admin.events.redemptions.col.redeemed'), cell: r => when(r.redeemedAt) },
  ];
  return (
    <Card data-testid="admin-redemptions">
      <CardHeader><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.redemptions.title')}</h2></CardHeader>
      <CardContent>
        {!rows ? <div aria-busy="true"><SkeletonTable rows={3} /></div> : <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('admin.events.redemptions.title')} dense emptyState={t('admin.events.redemptions.empty')} />}
      </CardContent>
    </Card>
  );
}
