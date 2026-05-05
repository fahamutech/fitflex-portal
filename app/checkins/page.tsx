'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../providers';
import { api, CheckIn } from '@/lib/api';
import { Card, CardHeader, PageHeader, Badge, EmptyState, Button, Spinner } from '@/components/shared';

function passTierTone(tier: string | null): 'brand' | 'warning' | 'gray' {
  if (!tier) return 'gray';
  if (tier.toLowerCase().includes('premium')) return 'brand';
  if (tier.toLowerCase().includes('standard')) return 'warning';
  return 'gray';
}

export default function CheckinsPage() {
  const { token, t } = useApp();
  const [rows, setRows]       = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!token) return;
    setLoading(true);
    api.recentCheckIns(token)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('checkins.heading')}
        description="Live feed — auto-refreshes every 10 seconds."
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('admin.action.refresh')}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">Check-ins</span>
            {!loading && (
              <Badge tone="gray">{rows.length}</Badge>
            )}
          </div>
          {loading && <Spinner className="h-4 w-4" />}
        </CardHeader>

        {rows.length === 0 && !loading ? (
          <div className="px-6 pb-6">
            <EmptyState
              title={t('checkins.empty')}
              body="Check-ins will appear here as members scan in at your gym."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>{t('checkins.col.time')}</th>
                  <th>{t('checkins.col.member')}</th>
                  <th>{t('checkins.col.tier')}</th>
                  <th>{t('checkins.col.visit')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="tabular-nums whitespace-nowrap">
                      {new Date(r.timestamp).toLocaleString()}
                    </td>
                    <td className="font-medium text-[var(--color-fg-primary)]">
                      {r.memberPhone ?? r.memberEmail ?? r.memberId}
                    </td>
                    <td>
                      <Badge tone={passTierTone(r.passTier)}>
                        {r.passTier ?? 'Direct'}
                      </Badge>
                    </td>
                    <td className="tabular-nums">
                      {r.visitNumberInCycle != null ? `#${r.visitNumberInCycle}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
