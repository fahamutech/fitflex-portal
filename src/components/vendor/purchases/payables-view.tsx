'use client';
// Owed to suppliers (S9 §5.5): the S4 owed-view layout with supplier wording. Totals come from the server over every
// supplier (never summed on the client). FitFlex moves no money for payables.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronRight, Download, HandCoins } from 'lucide-react';
import type { AgingBucket } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { AGING_BUCKETS, agingKey, errorCode, fmt, receiptDay } from '@/lib/vendor';
import { purchasesApi, type PayablesPage, type PayablesRow, type PayablesSort } from '@/lib/vendor-purchases';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, SkeletonTable, Spinner, Table, TBody, Td, Th, THead, Tr, useToast } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { saveBlob } from '@/components/vendor/documents/share-menu';
import { useApp } from '../../../../app/providers';
import { MoneyTile, rateLimitText, TILE_GRID } from '../customers/bits';
import { linkCls, MoneyNotice } from './bits';

export const PAYABLES_SORTS: PayablesSort[] = ['overdue', 'owed', 'name'];
const bucketBtn = 'min-w-0 rounded-[var(--radius-xl)] border p-4 text-left transition-colors min-h-11';

export function PayablesView({ bucket, sort, onParams, onOpen }: {
  bucket: AgingBucket | null; sort: PayablesSort;
  onParams: (patch: Record<string, string | null>) => void; onOpen: (supplierId: string) => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [page, setPage] = useState<PayablesPage | null>(null);
  const [rows, setRows] = useState<PayablesRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const id = ++requestId.current;
    setPage(null); setFailed(false); setMoreFailed(false);
    try {
      const res = await purchasesApi.payables(token, { bucket, sort });
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
      const res = await purchasesApi.payables(token, { bucket, sort, cursor: page.nextCursor });
      if (id !== requestId.current) return;
      setRows(cur => { const seen = new Set(cur.map(r => r.supplierId)); return [...cur, ...res.rows.filter(r => !seen.has(r.supplierId))]; });
      setPage(p => (p ? { ...p, nextCursor: res.nextCursor ?? null } : p));
    } catch (err) {
      if (!vendor.handleError(err)) setMoreFailed(true);
    } finally { setMoreBusy(false); }
  }

  async function exportCsv() {
    if (!token) return;
    setExporting(true);
    try {
      const { blob, fileName } = await purchasesApi.csv(token, 'payables', { bucket, sort }, locale);
      saveBlob(blob, fileName);
      toast.success(t('vendor.purchases.exported'));
    } catch (err) {
      const limited = errorCode(err) === 'rate_limited' ? rateLimitText(err, t) : null;
      if (limited) toast.error(limited);
      else if (!vendor.handleError(err)) toast.error(t('vendor.purchases.exportFailed'));
    } finally { setExporting(false); }
  }

  const sortHeader = (key: PayablesSort, label: string, right = false) => {
    const active = sort === key;
    const dir = key === 'name' ? 'ascending' : 'descending';
    return (
      <Th className={right ? '!text-right' : undefined} aria-sort={active ? dir : 'none'}>
        <button type="button" onClick={() => onParams({ psort: key === 'overdue' ? null : key })} className={`inline-flex min-h-11 items-center gap-1 font-semibold ${right ? 'flex-row-reverse' : ''}`} data-testid={`payables-sort-${key}`}>
          {label}
          {active && (dir === 'ascending' ? <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />)}
        </button>
      </Th>
    );
  };

  if (failed) return <ErrorState title={t('vendor.payables.failed')} onRetry={load} retryLabel={t('common.tryAgain')} />;
  if (!page) return <div aria-busy="true" aria-label={t('vendor.payables.loading')}><SkeletonTable rows={5} columns={8} /></div>;
  const totals = page.totals;
  if (totals.owedTzs <= 0 && !bucket) return <EmptyState icon={<HandCoins />} title={t('vendor.payables.empty')} />;

  return (
    <div className="@container space-y-4" data-testid="payables-view">
      <section aria-label={t('vendor.payables.title')} className="space-y-2">
        <div className={TILE_GRID}>
          <MoneyTile label={t('vendor.payables.total')} value={money(totals.owedTzs)} testId="payables-total" />
          <MoneyTile label={t('vendor.payables.overdue')} value={money(totals.overdueTzs)} testId="payables-overdue" />
          <MoneyTile label={t('vendor.payables.suppliersYouOwe')} value={totals.supplierCount} testId="payables-suppliers" />
          <MoneyTile label={t('vendor.payables.dueSoon')} value={money(totals.dueIn7DaysTzs)} testId="payables-due-soon" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="payables-as-of">{fmt(t('vendor.customers.asOf'), { date: receiptDay(page.asOf, locale) })}</p>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={exportCsv} loading={exporting} data-testid="payables-export">
            <Download aria-hidden="true" className="h-4 w-4" />{t('vendor.purchases.exportCsv')}
          </Button>
        </div>
      </section>

      <div role="group" aria-label={t('vendor.payables.buckets')} className="space-y-2">
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))]" data-testid="payables-buckets">
          {AGING_BUCKETS.map(b => {
            const on = bucket === b;
            return (
              <button key={b} type="button" aria-pressed={on} onClick={() => onParams({ bucket: on ? null : b })}
                aria-label={`${t(agingKey(b))}, ${money(totals[b])}`}
                className={`${bucketBtn} ${on ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)]' : 'border-[var(--color-border-canvas)] bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-secondary)]'}`}
                data-testid={`payables-bucket-${b}`}>
                <span className="block text-sm font-medium text-[var(--color-fg-quaternary)] [overflow-wrap:anywhere]">{t(agingKey(b))}</span>
                <span className={`mt-1 block whitespace-nowrap text-lg font-semibold tabular-nums ${totals[b] ? 'text-[var(--color-fg-primary)]' : 'text-[var(--color-fg-quaternary)]'}`}>{money(totals[b])}</span>
              </button>
            );
          })}
        </div>
        {bucket && <Button variant="secondary" size="sm" className="min-h-11" onClick={() => onParams({ bucket: null })} data-testid="payables-bucket-all">{t('vendor.suppliers.filter.all')}</Button>}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<HandCoins />} title={t('vendor.payables.emptyBucket')} />
      ) : (
        <>
          <div className="hidden @4xl:block">
            <Table aria-label={t('vendor.payables.title')} data-testid="payables-table">
              <caption className="sr-only">{t('vendor.payables.title')}</caption>
              <THead>
                <Tr>
                  {sortHeader('name', t('vendor.purchases.supplier'))}
                  {AGING_BUCKETS.map(b => <Th key={b} className="!text-right min-w-24">{t(agingKey(b))}</Th>)}
                  {sortHeader('owed', t('vendor.payables.total'), true)}
                  {sortHeader('overdue', t('vendor.payables.oldestDue'))}
                  <Th><span className="sr-only">{t('common.actions')}</span></Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map(r => (
                  <Tr key={r.supplierId} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => onOpen(r.supplierId)} data-testid={`payables-row-${r.supplierId}`}>
                    <Td>
                      <Link href={`?supplier=${encodeURIComponent(r.supplierId)}`} onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(r.supplierId); }} className={`${linkCls} [overflow-wrap:anywhere]`}>{r.name}</Link>
                    </Td>
                    {AGING_BUCKETS.map(b => <Td key={b} className={`whitespace-nowrap text-right tabular-nums ${r[b] ? '' : 'text-[var(--color-fg-quaternary)]'}`}>{r[b] ? money(r[b]) : '—'}</Td>)}
                    <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{money(r.owedTzs)}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="inline-flex flex-col gap-1">
                        <span>{receiptDay(r.oldestDueDate, locale)}</span>
                        {r.maxDaysOverdue > 0 && <Badge tone="warning">{fmt(t('vendor.suppliers.daysOverdue'), { n: r.maxDaysOverdue })}</Badge>}
                      </span>
                    </Td>
                    <Td><ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--color-fg-quaternary)]" /></Td>
                  </Tr>
                ))}
              </TBody>
              <tfoot>
                <Tr className="border-t-2 border-[var(--color-border-primary)] font-semibold" data-testid="payables-totals-row">
                  <Th scope="row">{t('vendor.payables.totalRow')}</Th>
                  {AGING_BUCKETS.map(b => <Td key={b} className="whitespace-nowrap text-right tabular-nums">{money(totals[b])}</Td>)}
                  <Td className="whitespace-nowrap text-right tabular-nums">{money(totals.owedTzs)}</Td>
                  <Td /><Td />
                </Tr>
              </tfoot>
            </Table>
          </div>
          <ul className="space-y-3 @4xl:hidden" aria-label={t('vendor.payables.title')}>
            {rows.map(r => (
              <li key={r.supplierId}>
                <Card className="p-0">
                  <Link href={`?supplier=${encodeURIComponent(r.supplierId)}`} onClick={e => { e.preventDefault(); onOpen(r.supplierId); }} className="block min-h-14 space-y-1 p-4" data-testid={`payables-card-${r.supplierId}`}>
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{r.name}</span>
                      <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{money(r.owedTzs)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-fg-tertiary)]">
                      {r.overdueTzs > 0 && <span className="whitespace-nowrap">{fmt(t('vendor.purchases.overdueAmount'), { amount: money(r.overdueTzs) })}</span>}
                      <span>{t('vendor.payables.oldestDue')}: {receiptDay(r.oldestDueDate, locale)}</span>
                      {r.maxDaysOverdue > 0 && <Badge tone="warning">{fmt(t('vendor.suppliers.daysOverdue'), { n: r.maxDaysOverdue })}</Badge>}
                    </span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {moreFailed && <Alert tone="error">{t('vendor.payables.failed')}</Alert>}
      {page.nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={moreBusy} className="min-h-11" data-testid="payables-load-more">
            {moreBusy && <Spinner className="h-4 w-4" />}{moreFailed ? t('common.tryAgain') : t('vendor.stock.loadMore')}
          </Button>
        </div>
      )}
      <MoneyNotice />
    </div>
  );
}
