'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../providers';
import { api, CheckIn } from '@/lib/api';
import { Card, CardHeader, PageHeader, Badge, EmptyState, Button, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';

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
          <Table aria-label={t('checkins.heading')} wrapperClassName="rounded-none border-0">
            <THead>
              <Tr>
                <Th>{t('checkins.col.time')}</Th>
                <Th>{t('checkins.col.member')}</Th>
                <Th>{t('checkins.col.tier')}</Th>
                <Th>{t('checkins.col.visit')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map(r => (
                <Tr key={r.id}>
                  <Td className="tabular-nums whitespace-nowrap">
                    {new Date(r.timestamp).toLocaleString()}
                  </Td>
                  <Td className="font-medium !text-[var(--color-fg-primary)]">
                    {r.memberPublicId ?? r.memberId}
                  </Td>
                  <Td>
                    <Badge tone={passTierTone(r.passTier)}>
                      {r.passTier ?? 'Direct'}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums">
                    {r.visitNumberInCycle != null ? `#${r.visitNumberInCycle}` : '—'}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
