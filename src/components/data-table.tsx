'use client';
import { ReactNode, useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Input } from './shared';

export type ColumnDef<T> = {
  key: string;
  header: string;
  sortable?: boolean;
  filterable?: boolean;
  cell: (row: T, index: number) => ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
};

type SortDir = 'asc' | 'desc' | null;

const PAGE_SIZES = [10, 25, 50];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyFn,
  actions,
  filterPlaceholder = 'Search…',
  emptyState,
  pageSize: defaultPageSize = 10,
  extraFilters,
  onRowClick,
}: {
  columns: ColumnDef<T>[];
  data: T[];
  keyFn?: (row: T, i: number) => string;
  actions?: (row: T) => ReactNode;
  filterPlaceholder?: string;
  emptyState?: ReactNode;
  pageSize?: number;
  extraFilters?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const [query, setQuery]         = useState('');
  const [sortKey, setSortKey]     = useState<string | null>(null);
  const [sortDir, setSortDir]     = useState<SortDir>(null);
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(defaultPageSize);

  /* Global text filter across all string-valued cells */
  const filtered = useMemo(() => {
    if (!query.trim()) return data;
    const q = query.toLowerCase();
    return data.filter(row =>
      columns.some(col => {
        const node = col.cell(row, 0);
        const str = typeof node === 'string' || typeof node === 'number' ? String(node).toLowerCase() : '';
        return str.includes(q);
      }) ||
      Object.values(row as Record<string, unknown>).some(v =>
        typeof v === 'string' && v.toLowerCase().includes(q)
      )
    );
  }, [data, query, columns]);

  /* Sorting */
  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const va = (a as Record<string, unknown>)[sortKey];
      const vb = (b as Record<string, unknown>)[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  /* Pagination */
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paged      = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function toggleSort(key: string) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return; }
    if (sortDir === 'asc') { setSortDir('desc'); return; }
    setSortKey(null); setSortDir(null);
  }

  function SortIcon({ col }: { col: ColumnDef<T> }) {
    if (!col.sortable) return null;
    if (sortKey !== col.key) return <ChevronsUpDown className="h-3.5 w-3.5 text-[var(--color-fg-disabled)]" />;
    if (sortDir === 'asc')   return <ChevronUp   className="h-3.5 w-3.5 text-[var(--color-brand-600)]" />;
    return <ChevronDown className="h-3.5 w-3.5 text-[var(--color-brand-600)]" />;
  }

  const hasActions = Boolean(actions);
  const visibleColumns = hasActions ? [...columns, { key: '__actions', header: '', sortable: false, cell: () => null, align: 'right' as const }] : columns;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-fg-disabled)] pointer-events-none" />
          <Input
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(1); }}
            placeholder={filterPlaceholder}
            className="!pl-9"
          />
        </div>
        {extraFilters && <div className="flex items-center gap-2 flex-wrap">{extraFilters}</div>}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)]">
        <table className="ui-table min-w-full">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    col.sortable && 'cursor-pointer select-none hover:bg-[var(--color-gray-100)]',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                  )}
                  onClick={() => col.sortable && toggleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {col.header}
                    <SortIcon col={col} />
                  </span>
                </th>
              ))}
              {hasActions && (
                <th className="text-right w-px whitespace-nowrap">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (hasActions ? 1 : 0)}
                  className="py-16 text-center text-sm text-[var(--color-fg-quaternary)]"
                >
                  {emptyState ?? 'No records found.'}
                </td>
              </tr>
            ) : (
              paged.map((row, i) => (
                <tr
                  key={keyFn ? keyFn(row, i) : (row.id ?? i)}
                  onClick={() => onRowClick?.(row)}
                  className={onRowClick ? 'cursor-pointer hover:bg-[var(--color-bg-tertiary)] transition-colors' : ''}
                >
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className={cn(
                        col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center',
                      )}
                    >
                      {col.cell(row, i)}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {actions!(row)}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-[var(--color-fg-tertiary)]">
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="ui-input !w-auto !py-1 !px-2"
          >
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="hidden sm:inline">
            {sorted.length === 0 ? '0' : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)}`} of {sorted.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            let p: number;
            if (totalPages <= 5) p = i + 1;
            else if (safePage <= 3) p = i + 1;
            else if (safePage >= totalPages - 2) p = totalPages - 4 + i;
            else p = safePage - 2 + i;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn(
                  'h-8 w-8 rounded-[var(--radius-md)] text-sm font-medium transition-colors',
                  p === safePage
                    ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-semibold'
                    : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]',
                )}
              >
                {p}
              </button>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
