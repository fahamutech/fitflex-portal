'use client';
// The customer list (S4 §2): server search (name or phone digits), filters, sort, Load more. Filters live in
// the URL. Phone is shown for walk-in customers only (A-02).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, UserPlus, Users } from 'lucide-react';
import { api, type VendorCustomerFilter, type VendorCustomerRow, type VendorCustomerSort } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { customerName, eatDayOf, fmt, receiptDay } from '@/lib/vendor';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Segmented, Select, SkeletonTable, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import { linkCls, OverdueBadge, rateLimitText, SourceBadge } from './bits';

export const FILTERS: VendorCustomerFilter[] = ['all', 'owes', 'overdue', 'manual', 'marketplace', 'archived'];
export const SORTS: VendorCustomerSort[] = ['name', 'owed', 'overdue', 'recent'];
const FILTER_KEYS: Record<VendorCustomerFilter, MessageKey> = {
  all: 'vendor.customers.filter.all', owes: 'vendor.customers.filter.owe', overdue: 'vendor.customers.filter.overdue',
  manual: 'vendor.customers.filter.shop', marketplace: 'vendor.customers.filter.app', archived: 'vendor.customers.filter.archived',
};
const SEARCH_DEBOUNCE_MS = 300;

export function CustomersList({
  q, filter, sort, onParams, onOpen, onAdd, online,
}: {
  q: string;
  filter: VendorCustomerFilter;
  sort: VendorCustomerSort;
  onParams: (patch: Record<string, string | null>) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
  online: boolean;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [rows, setRows] = useState<VendorCustomerRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [search, setSearch] = useState(q);
  const requestId = useRef(0);

  // Keep the box in step with the URL (back/forward), and send typing to the URL after a pause.
  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => {
    if (search.trim() === q) return;
    const timer = setTimeout(() => onParams({ q: search.trim() || null }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const load = useCallback(async () => {
    if (!token) return;
    const id = ++requestId.current;
    setRows(null); setFailed(null); setMoreFailed(false);
    try {
      const page = await api.vendorCustomers(token, { q: q || undefined, filter, sort, limit: 50 });
      if (id !== requestId.current) return;
      setRows(page.customers ?? []); setNext(page.nextCursor ?? null);
    } catch (err) {
      if (id !== requestId.current) return;
      if (vendor.handleError(err)) { setRows([]); return; }
      setFailed(rateLimitText(err, t) ?? t('vendor.customers.failed'));
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, q, filter, sort]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!token || !next) return;
    const id = requestId.current;
    setMoreBusy(true); setMoreFailed(false);
    try {
      const page = await api.vendorCustomers(token, { q: q || undefined, filter, sort, limit: 50, cursor: next });
      if (id !== requestId.current) return;
      setRows(cur => {
        const seen = new Set((cur ?? []).map(r => r.id));
        return [...(cur ?? []), ...(page.customers ?? []).filter(r => !seen.has(r.id))];
      });
      setNext(page.nextCursor ?? null);
    } catch (err) {
      if (!vendor.handleError(err)) setMoreFailed(true);
    } finally {
      setMoreBusy(false);
    }
  }

  const typeLabel = (r: VendorCustomerRow) => t(r.source === 'manual' ? 'vendor.customers.badge.shop' : 'vendor.customers.badge.app');
  const rowLabel = (r: VendorCustomerRow) => fmt(t('vendor.customers.rowLabel'), {
    name: customerName(r, t), type: typeLabel(r), amount: money(r.owedTzs),
    status: r.overdueTzs > 0 ? t('vendor.customers.overdueBadge') : r.archived ? t('vendor.customers.badge.archived') : '',
  }).replace(/,\s*$/, '');
  const lastBought = (r: VendorCustomerRow) => (r.lastPurchaseAt ? receiptDay(eatDayOf(r.lastPurchaseAt), locale) : '—');
  const shown = rows ?? [];
  const firstEver = !q && filter === 'all';

  return (
    <div className="@container space-y-4" data-testid="customers-list">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="min-w-0 lg:w-80">
          <Field label={t('vendor.customers.search')}>
            <Input type="search" value={search} placeholder={t('vendor.customers.searchHint')} onChange={e => setSearch(e.target.value)} maxLength={80} data-testid="customers-search" />
          </Field>
        </div>
        <Field label={t('vendor.customers.sort')}>
          <Select value={sort} onChange={e => onParams({ sort: e.target.value === 'name' ? null : e.target.value })} data-testid="customers-sort">
            {SORTS.map(s => <option key={s} value={s}>{t(`vendor.customers.sort.${s}` as MessageKey)}</option>)}
          </Select>
        </Field>
      </div>
      <div role="group" aria-label={t('vendor.customers.filterLabel')}>
        <Segmented className="w-fit flex-wrap" value={filter} onChange={v => onParams({ filter: v === 'all' ? null : v })}
          options={FILTERS.map(f => [f, t(FILTER_KEYS[f])])} />
      </div>

      {rows == null ? (
        <div aria-busy="true" aria-label={t('vendor.customers.loading')}><SkeletonTable rows={6} columns={6} /></div>
      ) : failed ? (
        <ErrorState title={failed} onRetry={load} retryLabel={t('common.tryAgain')} />
      ) : shown.length === 0 ? (
        q ? <EmptyState icon={<Users />} title={fmt(t('vendor.customers.noMatch'), { q })} />
          : firstEver ? (
            <EmptyState icon={<Users />} title={t('vendor.customers.emptyFirst')}
              action={<Button className="min-h-11" onClick={onAdd} disabled={!online}><UserPlus aria-hidden="true" className="h-4 w-4" />{t('vendor.customers.add')}</Button>} />
          ) : <EmptyState icon={<Users />} title={t('vendor.customers.empty')} />
      ) : (
        <>
          <div className="hidden @4xl:block">
            <Table aria-label={t('vendor.nav.customers')} data-testid="customers-table">
              <THead>
                <Tr>
                  <Th>{t('vendor.customers.name')}</Th>
                  <Th>{t('vendor.customers.colType')}</Th>
                  <Th>{t('vendor.customers.colPhone')}</Th>
                  <Th>{t('vendor.customers.lastPurchase')}</Th>
                  <Th className="!text-right">{t('vendor.customers.colOwed')}</Th>
                  <Th className="!text-right">{t('vendor.owed.overdue')}</Th>
                  <Th><span className="sr-only">{t('common.actions')}</span></Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map(r => (
                  <Tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => onOpen(r.id)} data-testid={`customer-row-${r.id}`}>
                    <Td>
                      <Link href={`?id=${encodeURIComponent(r.id)}`} aria-label={rowLabel(r)} onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(r.id); }} className={`${linkCls} [overflow-wrap:anywhere]`}>
                        {customerName(r, t)}
                      </Link>
                      {r.archived && <span className="ml-2"><Badge tone="gray">{t('vendor.customers.badge.archived')}</Badge></span>}
                    </Td>
                    <Td><SourceBadge source={r.source} /></Td>
                    <Td className="whitespace-nowrap">{r.source === 'manual' && r.phone ? r.phone : '—'}</Td>
                    <Td className="whitespace-nowrap">{lastBought(r)}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{r.owedTzs > 0 ? money(r.owedTzs) : '—'}</Td>
                    <Td className="whitespace-nowrap text-right">{r.overdueTzs > 0 ? <span className="inline-flex flex-col items-end gap-1"><span className="tabular-nums">{money(r.overdueTzs)}</span><OverdueBadge /></span> : '—'}</Td>
                    <Td><ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--color-fg-quaternary)]" /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="space-y-3 @4xl:hidden" aria-label={t('vendor.nav.customers')}>
            {shown.map(r => (
              <li key={r.id}>
                <Card className="p-0">
                  <Link href={`?id=${encodeURIComponent(r.id)}`} aria-label={rowLabel(r)} onClick={e => { e.preventDefault(); onOpen(r.id); }} className="block min-h-16 space-y-1 p-4" data-testid={`customer-card-${r.id}`}>
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-semibold">{customerName(r, t)}</span>
                      {r.owedTzs > 0 && <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{money(r.owedTzs)}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)]">
                      <SourceBadge source={r.source} />
                      {r.archived && <Badge tone="gray">{t('vendor.customers.badge.archived')}</Badge>}
                      {r.lastPurchaseAt && <span>{fmt(t('vendor.customers.lastBought'), { date: lastBought(r) })}</span>}
                      {r.overdueTzs > 0 && <OverdueBadge />}
                    </span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {moreFailed && <Alert tone="error">{t('vendor.customers.failed')}</Alert>}
      {rows != null && !failed && next && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={moreBusy} className="min-h-11" data-testid="customers-load-more">
            {moreBusy && <Spinner className="h-4 w-4" />}{moreFailed ? t('common.tryAgain') : t('vendor.stock.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
