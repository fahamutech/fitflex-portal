'use client';
// "Owed to you" (S4 §10): pay-later money only (app orders are paid through FitFlex and never appear).
// Totals come from the server over every customer who owes; the client never sums pages.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronRight, HandCoins } from 'lucide-react';
import { api, type AgingBucket, type VendorAgingPage, type VendorAgingRow } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { AGING_BUCKETS, agingKey, customerName, fmt, receiptDay } from '@/lib/vendor';
import { Alert, Button, Card, EmptyState, ErrorState, SkeletonTable, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import { linkCls, MoneyTile, OverdueBadge, TILE_GRID } from './bits';

export type AgingSort = 'overdue' | 'owed' | 'name';
export const AGING_SORTS: AgingSort[] = ['overdue', 'owed', 'name'];
const bucketBtn = 'min-w-0 rounded-[var(--radius-xl)] border p-4 text-left transition-colors min-h-11';

export function OwedView({
  bucket, sort, onParams, onOpen,
}: {
  bucket: AgingBucket | null;
  sort: AgingSort;
  onParams: (patch: Record<string, string | null>) => void;
  onOpen: (id: string) => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [page, setPage] = useState<VendorAgingPage | null>(null);
  const [rows, setRows] = useState<VendorAgingRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const id = ++requestId.current;
    setPage(null); setFailed(false); setMoreFailed(false);
    try {
      const res = await api.vendorReceivablesAging(token, { bucket, sort, limit: 50 });
      if (id !== requestId.current) return;
      setPage(res); setRows(res.rows ?? []);
    } catch (err) {
      if (id !== requestId.current) return;
      if (!vendor.handleError(err)) setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, bucket, sort]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!token || !page?.nextCursor) return;
    const id = requestId.current;
    setMoreBusy(true); setMoreFailed(false);
    try {
      const res = await api.vendorReceivablesAging(token, { bucket, sort, limit: 50, cursor: page.nextCursor });
      if (id !== requestId.current) return;
      setRows(cur => {
        const seen = new Set(cur.map(r => r.customerId));
        return [...cur, ...(res.rows ?? []).filter(r => !seen.has(r.customerId))];
      });
      setPage(p => (p ? { ...p, nextCursor: res.nextCursor ?? null } : p));
    } catch (err) {
      if (!vendor.handleError(err)) setMoreFailed(true);
    } finally {
      setMoreBusy(false);
    }
  }

  const sortHeader = (key: AgingSort, label: string, right = false) => {
    const active = sort === key;
    // name A–Z; owed and overdue largest first.
    const dir = key === 'name' ? 'ascending' : 'descending';
    return (
      <Th className={right ? '!text-right' : undefined} aria-sort={active ? dir : 'none'}>
        <button type="button" onClick={() => onParams({ sort: key === 'overdue' ? null : key })} className={`inline-flex min-h-11 items-center gap-1 font-semibold ${right ? 'flex-row-reverse' : ''}`} data-testid={`owed-sort-${key}`}>
          {label}
          {active && (dir === 'ascending' ? <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />)}
        </button>
      </Th>
    );
  };

  if (failed) return <ErrorState title={t('vendor.owed.failed')} onRetry={load} retryLabel={t('common.tryAgain')} />;
  if (!page) return <div aria-busy="true" aria-label={t('vendor.owed.loading')}><SkeletonTable rows={5} columns={8} /></div>;
  const totals = page.totals;
  if (totals.owedTzs <= 0 && !bucket) return <EmptyState icon={<HandCoins />} title={t('vendor.owed.empty')} />;

  return (
    <div className="@container space-y-4" data-testid="owed-view">
      <section aria-label={t('vendor.owed.title')} className="space-y-2">
        <div className={TILE_GRID}>
          <MoneyTile label={t('vendor.owed.total')} value={money(totals.owedTzs)} testId="owed-total" />
          <MoneyTile label={t('vendor.owed.overdue')} value={money(totals.overdueTzs)} testId="owed-overdue" />
          <MoneyTile label={t('vendor.owed.customers')} value={totals.customerCount} testId="owed-customers" />
        </div>
        <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="owed-as-of">{fmt(t('vendor.customers.asOf'), { date: receiptDay(page.asOf, locale) })}</p>
      </section>

      <div role="group" aria-label={t('vendor.owed.buckets')} className="space-y-2">
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))]" data-testid="owed-buckets">
          {AGING_BUCKETS.map(b => {
            const on = bucket === b;
            return (
              <button key={b} type="button" aria-pressed={on} onClick={() => onParams({ bucket: on ? null : b })}
                aria-label={`${t(agingKey(b))}, ${money(totals[b])}`}
                className={`${bucketBtn} ${on ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)]' : 'border-[var(--color-border-canvas)] bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-secondary)]'}`}
                data-testid={`owed-bucket-${b}`}>
                <span className="block text-sm font-medium text-[var(--color-fg-quaternary)] [overflow-wrap:anywhere]">{t(agingKey(b))}</span>
                <span className={`mt-1 block whitespace-nowrap text-lg font-semibold tabular-nums ${totals[b] ? 'text-[var(--color-fg-primary)]' : 'text-[var(--color-fg-quaternary)]'}`}>{money(totals[b])}</span>
              </button>
            );
          })}
        </div>
        {bucket && (
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => onParams({ bucket: null })} data-testid="owed-bucket-all">{t('vendor.customers.filter.all')}</Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<HandCoins />} title={t('vendor.owed.emptyBucket')} />
      ) : (
        <>
          <div className="hidden @4xl:block">
            <Table aria-label={t('vendor.owed.title')} data-testid="owed-table">
              <THead>
                <Tr>
                  {sortHeader('name', t('vendor.customers.customer'))}
                  {AGING_BUCKETS.map(b => <Th key={b} className="!text-right">{t(agingKey(b))}</Th>)}
                  {sortHeader('owed', t('vendor.owed.total'), true)}
                  {sortHeader('overdue', t('vendor.owed.oldestDue'))}
                  <Th><span className="sr-only">{t('common.actions')}</span></Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map(r => (
                  <Tr key={r.customerId} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => onOpen(r.customerId)} data-testid={`owed-row-${r.customerId}`}>
                    <Td>
                      <Link href={`?id=${encodeURIComponent(r.customerId)}`} onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(r.customerId); }} className={`${linkCls} [overflow-wrap:anywhere]`}>
                        {customerName({ name: r.name }, t)}
                      </Link>
                    </Td>
                    {AGING_BUCKETS.map(b => <Td key={b} className={`whitespace-nowrap text-right tabular-nums ${r[b] ? '' : 'text-[var(--color-fg-quaternary)]'}`}>{r[b] ? money(r[b]) : '—'}</Td>)}
                    <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{money(r.owedTzs)}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="inline-flex flex-col gap-1">
                        <span>{receiptDay(r.oldestDueDate, locale)}</span>
                        {r.maxDaysOverdue > 0 && <OverdueBadge days={r.maxDaysOverdue} />}
                      </span>
                    </Td>
                    <Td><ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--color-fg-quaternary)]" /></Td>
                  </Tr>
                ))}
              </TBody>
              <tfoot>
                <Tr className="border-t-2 border-[var(--color-border-primary)] font-semibold" data-testid="owed-totals-row">
                  <Th scope="row">{t('vendor.owed.totalRow')}</Th>
                  {AGING_BUCKETS.map(b => <Td key={b} className="whitespace-nowrap text-right tabular-nums">{money(totals[b])}</Td>)}
                  <Td className="whitespace-nowrap text-right tabular-nums">{money(totals.owedTzs)}</Td>
                  <Td /><Td />
                </Tr>
              </tfoot>
            </Table>
          </div>
          <ul className="space-y-3 @4xl:hidden" aria-label={t('vendor.owed.title')}>
            {rows.map(r => (
              <li key={r.customerId}>
                <Card className="p-0">
                  <Link href={`?id=${encodeURIComponent(r.customerId)}`} onClick={e => { e.preventDefault(); onOpen(r.customerId); }} className="block min-h-16 space-y-1 p-4" data-testid={`owed-card-${r.customerId}`}>
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-semibold">{customerName({ name: r.name }, t)}</span>
                      <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{money(r.owedTzs)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-fg-tertiary)]">
                      {r.overdueTzs > 0 && <span className="whitespace-nowrap">{fmt(t('vendor.customers.overdueAmount'), { amount: money(r.overdueTzs) })}</span>}
                      <span>{t('vendor.owed.oldestDue')}: {receiptDay(r.oldestDueDate, locale)}</span>
                      {r.maxDaysOverdue > 0 && <OverdueBadge days={r.maxDaysOverdue} />}
                    </span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {moreFailed && <Alert tone="error">{t('vendor.owed.failed')}</Alert>}
      {page.nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={moreBusy} className="min-h-11" data-testid="owed-load-more">
            {moreBusy && <Spinner className="h-4 w-4" />}{moreFailed ? t('common.tryAgain') : t('vendor.stock.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
