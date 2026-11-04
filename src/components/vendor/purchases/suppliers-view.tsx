'use client';
// Suppliers (S9 §5.4): server search (name, phone, contact person), filters, sort, Load more. Filters live in the URL.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Truck, UserPlus } from 'lucide-react';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { fmt, receiptDay } from '@/lib/vendor';
import { purchasesApi, type SupplierFilter, type SupplierRow, type SupplierSort } from '@/lib/vendor-purchases';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Segmented, Select, SkeletonTable, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import { rateLimitText } from '../customers/bits';
import { linkCls } from './bits';

export const SUPPLIER_FILTERS: SupplierFilter[] = ['active', 'owing', 'overdue', 'archived'];
export const SUPPLIER_SORTS: SupplierSort[] = ['name', 'owed', 'recent'];
const FILTER_KEY: Record<SupplierFilter, MessageKey> = {
  active: 'vendor.suppliers.filter.all', owing: 'vendor.suppliers.filter.owing', overdue: 'vendor.suppliers.filter.overdue', archived: 'vendor.suppliers.filter.archived',
};

export function SuppliersView({
  q, filter, sort, online, onParams, onOpen, onAdd,
}: {
  q: string; filter: SupplierFilter; sort: SupplierSort; online: boolean;
  onParams: (patch: Record<string, string | null>) => void; onOpen: (id: string) => void; onAdd: () => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [rows, setRows] = useState<SupplierRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [search, setSearch] = useState(q);
  const requestId = useRef(0);

  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => {
    if (search.trim() === q) return;
    const timer = setTimeout(() => onParams({ q: search.trim().length >= 2 ? search.trim() : null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const load = useCallback(async () => {
    if (!token) return;
    const id = ++requestId.current;
    setRows(null); setFailed(null); setMoreFailed(false);
    try {
      const page = await purchasesApi.suppliers(token, { q: q || undefined, filter, sort });
      if (id !== requestId.current) return;
      setRows(page.suppliers ?? []); setNext(page.nextCursor ?? null);
    } catch (err) {
      if (id !== requestId.current) return;
      if (vendor.handleError(err)) { setRows([]); return; }
      setFailed(rateLimitText(err, t) ?? t('vendor.suppliers.failed')); setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, q, filter, sort]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!token || !next) return;
    const id = requestId.current;
    setMoreBusy(true); setMoreFailed(false);
    try {
      const page = await purchasesApi.suppliers(token, { q: q || undefined, filter, sort, cursor: next });
      if (id !== requestId.current) return;
      setRows(cur => { const seen = new Set((cur ?? []).map(r => r.id)); return [...(cur ?? []), ...page.suppliers.filter(r => !seen.has(r.id))]; });
      setNext(page.nextCursor ?? null);
    } catch (err) {
      if (!vendor.handleError(err)) setMoreFailed(true);
    } finally { setMoreBusy(false); }
  }

  const owes = (r: SupplierRow) => (r.owedTzs > 0 ? fmt(t('vendor.suppliers.youOwe'), { amount: money(r.owedTzs) }) : t('vendor.payables.nothingOwed'));
  const rowLabel = (r: SupplierRow) => fmt(t('vendor.suppliers.rowLabel'), {
    name: r.name, amount: money(r.owedTzs), overdue: r.overdueTzs > 0 ? fmt(t('vendor.purchases.overdueAmount'), { amount: money(r.overdueTzs) }) : '',
  }).replace(/,\s*$/, '');
  const shown = rows ?? [];
  const contact = (r: SupplierRow) => r.contactPerson || r.phone || '—';

  return (
    <div className="@container space-y-4" data-testid="suppliers-view">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="min-w-0 lg:w-80">
          <Field label={t('vendor.suppliers.search')}>
            <Input type="search" value={search} placeholder={t('vendor.suppliers.searchHint')} onChange={e => setSearch(e.target.value)} maxLength={80} data-testid="suppliers-search" />
          </Field>
        </div>
        <Field label={t('vendor.suppliers.sort')}>
          <Select value={sort} onChange={e => onParams({ ssort: e.target.value === 'name' ? null : e.target.value })} data-testid="suppliers-sort">
            {SUPPLIER_SORTS.map(s => <option key={s} value={s}>{t(`vendor.suppliers.sort.${s}` as MessageKey)}</option>)}
          </Select>
        </Field>
        <Button className="min-h-11 lg:ml-auto" onClick={onAdd} disabled={!online} data-testid="suppliers-add">
          <UserPlus aria-hidden="true" className="h-4 w-4" />{t('vendor.suppliers.add')}
        </Button>
      </div>
      <div role="group" aria-label={t('vendor.suppliers.filterLabel')}>
        <Segmented className="w-fit flex-wrap" value={filter} onChange={v => onParams({ sfilter: v === 'active' ? null : v })} options={SUPPLIER_FILTERS.map(f => [f, t(FILTER_KEY[f])])} />
      </div>

      {rows == null ? (
        <div aria-busy="true" aria-label={t('vendor.suppliers.loading')}><SkeletonTable rows={5} columns={6} /></div>
      ) : failed ? (
        <ErrorState title={failed} onRetry={load} retryLabel={t('common.tryAgain')} />
      ) : shown.length === 0 ? (
        !q && filter === 'active'
          ? <EmptyState icon={<Truck />} title={t('vendor.suppliers.empty')} action={<Button className="min-h-11" onClick={onAdd} disabled={!online}>{t('vendor.suppliers.add')}</Button>} />
          : <EmptyState icon={<Truck />} title={t('vendor.suppliers.emptyFilter')} />
      ) : (
        <>
          <div className="hidden @3xl:block">
            <Table aria-label={t('vendor.suppliers.title')} data-testid="suppliers-table">
              <caption className="sr-only">{t('vendor.suppliers.title')}</caption>
              <THead>
                <Tr>
                  <Th>{t('vendor.suppliers.col.name')}</Th>
                  <Th>{t('vendor.suppliers.col.contact')}</Th>
                  <Th>{t('vendor.suppliers.col.phone')}</Th>
                  <Th className="!text-right">{t('vendor.suppliers.col.owed')}</Th>
                  <Th className="!text-right">{t('vendor.payables.overdue')}</Th>
                  <Th>{t('vendor.suppliers.col.lastDelivery')}</Th>
                  <Th><span className="sr-only">{t('common.actions')}</span></Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map(r => (
                  <Tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => onOpen(r.id)} data-testid={`supplier-row-${r.id}`}>
                    <Td>
                      <Link href={`?supplier=${encodeURIComponent(r.id)}`} aria-label={rowLabel(r)} onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(r.id); }} className={`${linkCls} [overflow-wrap:anywhere]`}>{r.name}</Link>
                      {r.archived && <span className="ml-2"><Badge tone="gray">{t('vendor.suppliers.archivedBadge')}</Badge></span>}
                    </Td>
                    <Td className="[overflow-wrap:anywhere]">{r.contactPerson || '—'}</Td>
                    <Td className="whitespace-nowrap">{r.phone || '—'}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{r.owedTzs > 0 ? money(r.owedTzs) : '—'}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {r.overdueTzs > 0 ? <span className="inline-flex flex-col items-end gap-1"><span className="tabular-nums">{money(r.overdueTzs)}</span><Badge tone="warning">{t('vendor.payables.overdue')}</Badge></span> : '—'}
                    </Td>
                    <Td className="whitespace-nowrap">{receiptDay(r.lastReceivedOn, locale)}</Td>
                    <Td><ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--color-fg-quaternary)]" /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="space-y-3 @3xl:hidden" aria-label={t('vendor.suppliers.title')}>
            {shown.map(r => (
              <li key={r.id}>
                <Card className="p-0">
                  <Link href={`?supplier=${encodeURIComponent(r.id)}`} aria-label={rowLabel(r)} onClick={e => { e.preventDefault(); onOpen(r.id); }} className="block min-h-14 space-y-1 p-4" data-testid={`supplier-card-${r.id}`}>
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{r.name}</span>
                      <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums">{owes(r)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)]">
                      <span className="[overflow-wrap:anywhere]">{contact(r)}</span>
                      {r.archived && <Badge tone="gray">{t('vendor.suppliers.archivedBadge')}</Badge>}
                      {r.overdueTzs > 0 && <Badge tone="warning">{fmt(t('vendor.purchases.overdueAmount'), { amount: money(r.overdueTzs) })}</Badge>}
                    </span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {moreFailed && <Alert tone="error">{t('vendor.suppliers.failed')}</Alert>}
      {rows != null && !failed && next && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={moreBusy} className="min-h-11" data-testid="suppliers-load-more">
            {moreBusy && <Spinner className="h-4 w-4" />}{moreFailed ? t('common.tryAgain') : t('vendor.stock.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
