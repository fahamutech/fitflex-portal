'use client';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Segmented, Spinner, Table, TBody, Td, Th, THead, Tr } from './shared';
import { FailureView, PURCHASE_TONE, useGymPassFormat } from './gym-pass-shared';
import { fill } from './communication-shared';
import { money } from '@/lib/admin-utils';
import { classifyGymPassError, gymPassesApi, type GymPassFailure, type PassSale } from '@/lib/gym-passes';
import { useApp } from '../../app/providers';
import type { MessageKey } from '@/lib/i18n';

const PAGE = 50;
const FILTERS = ['all', 'pending_payment', 'active', 'expired', 'cancelled'] as const;

/** Owner (scope payments): one row per purchase, newest first. */
export function GymPassSales({ gymId }: { gymId: string }) {
  const { token, t } = useApp();
  const fmtr = useGymPassFormat();
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('all');
  const [rows, setRows] = useState<PassSale[] | null>(null);
  const [more, setMore] = useState(false);
  const [failure, setFailure] = useState<GymPassFailure | null>(null);

  const load = useCallback(async (before?: string) => {
    if (!token) return;
    setFailure(null);
    try {
      const { sales } = await gymPassesApi.sales(token, gymId, { status: status === 'all' ? undefined : status, before, limit: PAGE });
      setRows(prev => (before && prev ? [...prev, ...sales] : sales));
      setMore(sales.length >= PAGE);
    } catch (e) { setRows(prev => prev ?? []); setFailure(classifyGymPassError(e)); }
  }, [token, gymId, status]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  const last = rows?.[rows.length - 1];
  return (
    <div className="space-y-4" data-testid="gp-sales">
      <div role="group" aria-label={t('gp.sales.filter')}>
        <Segmented value={status} onChange={v => setStatus(v as (typeof FILTERS)[number])}
          options={FILTERS.map(f => [f, f === 'all' ? t('gp.sales.all') : t(`gp.purchase.status.${f}` as MessageKey)] as [string, string])} />
      </div>
      {failure && <FailureView failure={failure} onRetry={() => load()} />}
      {rows == null ? <Spinner className="h-6 w-6" /> : rows.length === 0 ? (!failure && <EmptyState title={t('gp.sales.empty')} body={t('gp.sales.emptyBody')} />) : (
        <>
          <Table aria-label={t('gp.sales.table')}>
            <THead>
              <Tr>
                <Th>{t('gp.sales.col.buyer')}</Th><Th>{t('gp.sales.col.pass')}</Th><Th>{t('gp.sales.col.people')}</Th><Th>{t('gp.sales.col.price')}</Th>
                <Th>{t('gp.sales.col.payment')}</Th><Th>{t('gp.sales.col.status')}</Th><Th>{t('gp.sales.col.date')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map(s => (
                <Tr key={s.id} data-testid={`gp-sale-${s.id}`}>
                  <Td className="font-medium">{s.purchaser?.displayName || t('gp.sales.buyerUnknown')}</Td>
                  <Td>{s.plan.name}<div className="text-xs text-[var(--color-fg-quaternary)]">{t(`gp.category.${s.plan.category}`)} · {fmtr.duration(s.plan.durationValue, s.plan.durationUnit)}</div></Td>
                  <Td>{s.slots ? fill(t('gp.sales.slots'), { used: s.slots.used, limit: s.slots.limit }) : fmtr.people(s.plan.category, s.plan.beneficiaryLimit)}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{money(s.priceTzs, s.currency)}</Td>
                  <Td>{s.payment ? <Badge tone={s.payment.status === 'approved' ? 'success' : s.payment.status === 'pending' ? 'warning' : 'gray'}>{t(`gp.payment.status.${s.payment.status}` as MessageKey)}</Badge> : '—'}</Td>
                  <Td><Badge tone={PURCHASE_TONE[s.status] ?? 'gray'}>{t(`gp.purchase.status.${s.status}` as MessageKey)}</Badge></Td>
                  <Td className="whitespace-nowrap">{fmtr.date(s.createdAt ?? s.startsAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {more && last?.createdAt && <Button variant="secondary" size="md" onClick={() => load(last.createdAt)} data-testid="gp-sales-more">{t('gp.sales.loadMore')}</Button>}
        </>
      )}
    </div>
  );
}
