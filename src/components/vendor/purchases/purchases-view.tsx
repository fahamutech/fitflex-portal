'use client';
// Purchases (S9 §5.1): metric row, filters (EAT dates on receivedOn, supplier, status, payment, mine), CSV, the GRN
// table (cards below md) with Load more. Figures come from the server; the list summary is over the whole filter.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Download, Truck } from 'lucide-react';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { eatToday, errorCode, fmt, receiptDay } from '@/lib/vendor';
import { paymentStateKey, purchasesApi, type PayablesPage, type PurchasePage, type PurchaseRow, type PurchasesQuery, type SupplierRow } from '@/lib/vendor-purchases';
import { Alert, Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select, Skeleton, SkeletonTable, Spinner, Table, TBody, Td, Th, THead, Tr, useToast } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { saveBlob } from '@/components/vendor/documents/share-menu';
import { useApp } from '../../../../app/providers';
import { MoneyTile, rateLimitText, TILE_GRID } from '../customers/bits';
import { linkCls, PaymentBadge, StatusBadge } from './bits';

export type ListFilters = { from: string; to: string; supplierId: string; status: 'all' | 'received' | 'voided'; payment: 'all' | 'open' | 'overdue' | 'paid'; mine: boolean };
const toQuery = (f: ListFilters): PurchasesQuery => ({
  from: f.from || undefined, to: f.to || undefined, supplierId: f.supplierId || undefined,
  status: f.status === 'all' ? undefined : f.status, payment: f.payment === 'all' ? undefined : f.payment, createdBy: f.mine ? 'me' : undefined,
});

/** The GRN rows as a table (≥ md) and cards (below), for the list and a supplier's profile. */
export function PurchaseRows({ rows, onOpen, showSupplier = true }: { rows: PurchaseRow[]; onOpen: (id: string) => void; showSupplier?: boolean }) {
  const { t, locale } = useApp();
  const supplierName = (r: PurchaseRow) => r.supplier?.name ?? t('vendor.purchases.noSupplier');
  const stateWord = (r: PurchaseRow) => (r.status === 'voided' ? t('vendor.purchases.state.voided') : t(paymentStateKey(r.paymentState, r.overdueTzs > 0)));
  const rowLabel = (r: PurchaseRow) => fmt(t('vendor.purchases.rowLabel'), { number: r.number, supplier: supplierName(r), date: receiptDay(r.receivedOn, locale), amount: money(r.totalTzs), state: stateWord(r) });
  return (
    <div className="@container">
      <div className="hidden @3xl:block">
        <Table aria-label={t('vendor.purchases.segPurchases')} data-testid="purchases-table">
          <caption className="sr-only">{t('vendor.purchases.segPurchases')}</caption>
          <THead>
            <Tr>
              <Th>{t('vendor.purchases.col.number')}</Th>
              <Th>{t('vendor.purchases.col.received')}</Th>
              {showSupplier && <Th>{t('vendor.purchases.supplier')}</Th>}
              <Th className="!text-right">{t('vendor.purchases.col.items')}</Th>
              <Th className="!text-right">{t('vendor.purchases.total')}</Th>
              <Th className="!text-right">{t('vendor.purchases.paid')}</Th>
              <Th className="!text-right">{t('vendor.purchases.left')}</Th>
              <Th>{t('vendor.purchases.col.payment')}</Th>
              <Th>{t('vendor.purchases.col.recordedBy')}</Th>
              <Th><span className="sr-only">{t('common.actions')}</span></Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map(r => (
              <Tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => onOpen(r.id)} data-testid={`purchase-row-${r.id}`}>
                <Td><Link href={`/vendor/purchases/?id=${encodeURIComponent(r.id)}`} aria-label={rowLabel(r)} onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(r.id); }} className={`${linkCls} font-mono`}>{r.number}</Link></Td>
                <Td className="whitespace-nowrap">{receiptDay(r.receivedOn, locale)}</Td>
                {showSupplier && <Td className="[overflow-wrap:anywhere]">{supplierName(r)}</Td>}
                <Td className="text-right tabular-nums">{r.units}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{money(r.totalTzs)}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{money(r.paidTzs)}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{r.status === 'voided' ? '—' : money(r.balanceTzs)}</Td>
                <Td><span className="flex flex-wrap gap-1">{r.status === 'voided' ? <StatusBadge status="voided" /> : <PaymentBadge state={r.paymentState} overdueTzs={r.overdueTzs} status={r.status} />}</span></Td>
                <Td className="[overflow-wrap:anywhere]">{r.createdBy?.name ?? '—'}</Td>
                <Td><ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--color-fg-quaternary)]" /></Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
      <ul className="space-y-3 @3xl:hidden" aria-label={t('vendor.purchases.segPurchases')}>
        {rows.map(r => (
          <li key={r.id}>
            <Card className="p-0">
              <Link href={`/vendor/purchases/?id=${encodeURIComponent(r.id)}`} aria-label={rowLabel(r)} onClick={e => { e.preventDefault(); onOpen(r.id); }} className="block min-h-16 space-y-1 p-4" data-testid={`purchase-card-${r.id}`}>
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-mono font-semibold">{r.number}</span>
                  <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{money(r.totalTzs)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)]">
                  {showSupplier && <span className="[overflow-wrap:anywhere]">{supplierName(r)}</span>}
                  <span>{receiptDay(r.receivedOn, locale)}</span>
                  {r.status === 'voided' ? <StatusBadge status="voided" /> : <PaymentBadge state={r.paymentState} overdueTzs={r.overdueTzs} status={r.status} />}
                </span>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PurchasesView({ filters, onFilters, onOpen, onReceive }: {
  filters: ListFilters; onFilters: (patch: Partial<ListFilters>) => void; onOpen: (id: string) => void; onReceive: () => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [page, setPage] = useState<PurchasePage | null>(null);
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [owed, setOwed] = useState<PayablesPage['totals'] | null | 'failed'>(null);
  const [month, setMonth] = useState<number | null | 'failed'>(null);
  const requestId = useRef(0);
  const query = toQuery(filters);
  const key = JSON.stringify(query);

  // Metric row: each figure is its own request; a failure stays in its tile.
  const loadMetrics = useCallback(async () => {
    if (!token) return;
    setOwed(null); setMonth(null);
    const today = eatToday();
    purchasesApi.payables(token, { limit: 1 }).then(r => setOwed(r.totals)).catch(err => { if (!vendor.handleError(err)) setOwed('failed'); });
    purchasesApi.purchases(token, { from: `${today.slice(0, 8)}01`, to: today, limit: 1 }).then(r => setMonth(r.summary?.totalTzs ?? 0)).catch(() => setMonth('failed'));
    purchasesApi.suppliers(token, { filter: 'active', sort: 'name', limit: 200 }).then(r => setSuppliers(r.suppliers ?? [])).catch(() => setSuppliers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { void loadMetrics(); }, [loadMetrics]);

  const load = useCallback(async () => {
    if (!token) return;
    const id = ++requestId.current;
    setPage(null); setFailed(null); setMoreFailed(false);
    try {
      const res = await purchasesApi.purchases(token, query);
      if (id !== requestId.current) return;
      setPage(res); setRows(res.purchases ?? []);
    } catch (err) {
      if (id !== requestId.current) return;
      if (vendor.handleError(err)) { setPage({ purchases: [], nextCursor: null, summary: { count: 0, totalTzs: 0, paidTzs: 0, balanceTzs: 0, units: 0 } }); setRows([]); return; }
      setFailed(rateLimitText(err, t) ?? t('vendor.purchases.failed'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, key]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!token || !page?.nextCursor) return;
    const id = requestId.current;
    setMoreBusy(true); setMoreFailed(false);
    try {
      const res = await purchasesApi.purchases(token, { ...query, cursor: page.nextCursor });
      if (id !== requestId.current) return;
      setRows(cur => { const seen = new Set(cur.map(r => r.id)); return [...cur, ...res.purchases.filter(r => !seen.has(r.id))]; });
      setPage(p => (p ? { ...p, nextCursor: res.nextCursor ?? null } : p));
    } catch (err) {
      if (!vendor.handleError(err)) setMoreFailed(true);
    } finally { setMoreBusy(false); }
  }

  async function exportCsv() {
    if (!token) return;
    setExporting(true);
    try {
      const { blob, fileName } = await purchasesApi.csv(token, 'purchases', query as Record<string, unknown>, locale);
      saveBlob(blob, fileName);
      toast.success(t('vendor.purchases.exported'));
    } catch (err) {
      const limited = errorCode(err) === 'rate_limited' ? rateLimitText(err, t) : null;
      if (limited) toast.error(limited);
      else if (!vendor.handleError(err)) toast.error(t('vendor.purchases.exportFailed'));
    } finally { setExporting(false); }
  }

  const tile = (label: string, v: number | null | 'failed', testId: string) => (
    <MoneyTile label={label} testId={testId} value={v === null ? <Skeleton className="h-6 w-20" /> : v === 'failed' ? '—' : money(v)} />
  );
  const unfiltered = !filters.from && !filters.to && !filters.supplierId && filters.status === 'all' && filters.payment === 'all' && !filters.mine;

  return (
    <div className="space-y-4" data-testid="purchases-view">
      <div className={TILE_GRID} data-testid="purchases-metrics">
        {tile(t('vendor.payables.youOwe'), owed === null || owed === 'failed' ? owed : owed.owedTzs, 'metric-owed')}
        {tile(t('vendor.payables.overdue'), owed === null || owed === 'failed' ? owed : owed.overdueTzs, 'metric-overdue')}
        {tile(t('vendor.payables.dueSoon'), owed === null || owed === 'failed' ? owed : owed.dueIn7DaysTzs, 'metric-due-soon')}
        {tile(t('vendor.purchases.metric.thisMonth'), month, 'metric-month')}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <Field label={t('vendor.purchases.filter.from')}>
          <Input type="date" value={filters.from} max={filters.to || undefined} onChange={e => onFilters({ from: e.target.value })} data-testid="purchases-from" />
        </Field>
        <Field label={t('vendor.purchases.filter.to')}>
          <Input type="date" value={filters.to} min={filters.from || undefined} onChange={e => onFilters({ to: e.target.value })} data-testid="purchases-to" />
        </Field>
        <Field label={t('vendor.purchases.supplier')}>
          <Select value={filters.supplierId} onChange={e => onFilters({ supplierId: e.target.value })} data-testid="purchases-supplier">
            <option value="">{t('vendor.purchases.filter.allSuppliers')}</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label={t('vendor.purchases.filter.status')}>
          <Select value={filters.status} onChange={e => onFilters({ status: e.target.value as ListFilters['status'] })} data-testid="purchases-status">
            <option value="all">{t('vendor.purchases.filter.status.all')}</option>
            <option value="received">{t('vendor.purchases.state.received')}</option>
            <option value="voided">{t('vendor.purchases.state.voided')}</option>
          </Select>
        </Field>
        <Field label={t('vendor.purchases.filter.paymentLabel')}>
          <Select value={filters.payment} onChange={e => onFilters({ payment: e.target.value as ListFilters['payment'] })} data-testid="purchases-payment">
            {(['all', 'open', 'overdue', 'paid'] as const).map(p => <option key={p} value={p}>{t(`vendor.purchases.filter.payment.${p}` as MessageKey)}</option>)}
          </Select>
        </Field>
        <Checkbox label={t('vendor.purchases.filter.mine')} checked={filters.mine} onChange={e => onFilters({ mine: e.target.checked })} data-testid="purchases-mine" />
        <Button variant="secondary" className="min-h-11 md:ml-auto" onClick={exportCsv} loading={exporting} data-testid="purchases-export">
          <Download aria-hidden="true" className="h-4 w-4" />{t('vendor.purchases.exportCsv')}
        </Button>
      </div>

      {failed ? (
        <ErrorState title={failed} onRetry={load} retryLabel={t('common.tryAgain')} />
      ) : !page ? (
        <div aria-busy="true" aria-label={t('vendor.purchases.loading')}><SkeletonTable rows={5} columns={8} /></div>
      ) : rows.length === 0 ? (
        unfiltered
          ? <EmptyState icon={<Truck />} title={t('vendor.purchases.empty')} action={<Button className="min-h-11" onClick={onReceive}>{t('vendor.purchases.receive')}</Button>} />
          : <EmptyState icon={<Truck />} title={t('vendor.purchases.emptyFilter')} />
      ) : (
        <PurchaseRows rows={rows} onOpen={onOpen} />
      )}
      {moreFailed && <Alert tone="error">{t('vendor.purchases.failed')}</Alert>}
      {page?.nextCursor && !failed && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={moreBusy} className="min-h-11" data-testid="purchases-load-more">
            {moreBusy && <Spinner className="h-4 w-4" />}{moreFailed ? t('common.tryAgain') : t('vendor.stock.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
