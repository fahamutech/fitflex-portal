'use client';
import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { useApp } from '../../providers';
import { api, BookKeepingEntry } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { money, formatDateTime } from '@/lib/admin-utils';

type DateRange = 'today' | 'week' | '30d' | '90d' | '1y' | 'custom' | 'all';
const DATE_PRESETS: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '1y', label: '1 year' },
  { key: 'custom', label: 'Custom' },
  { key: 'all', label: 'All' },
];

function getStartDate(range: DateRange): Date | null {
  const now = new Date();
  switch (range) {
    case 'today': { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
    case 'week': { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d; }
    case '30d': { const d = new Date(now); d.setDate(d.getDate() - 30); return d; }
    case '90d': { const d = new Date(now); d.setDate(d.getDate() - 90); return d; }
    case '1y': { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; }
    default: return null;
  }
}

export default function BookKeepingPage() {
  const { token, user } = useApp();
  const [entries, setEntries] = useState<BookKeepingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [dateRange, setDateRange]   = useState<DateRange>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.bookKeeping(token);
      setEntries(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const dateFiltered = useMemo(() => {
    if (dateRange === 'all') return entries;
    if (dateRange === 'custom') {
      const from = customFrom ? new Date(customFrom).getTime() : 0;
      const to = customTo ? new Date(customTo + 'T23:59:59').getTime() : Date.now();
      return entries.filter(e => {
        const t = new Date(e.date).getTime();
        return t >= from && t <= to;
      });
    }
    const start = getStartDate(dateRange);
    if (!start) return entries;
    const startMs = start.getTime();
    return entries.filter(e => new Date(e.date).getTime() >= startMs);
  }, [entries, dateRange, customFrom, customTo]);

  const filtered = useMemo(() => {
    if (typeFilter === 'all') return dateFiltered;
    return dateFiltered.filter(e => e.type === typeFilter);
  }, [dateFiltered, typeFilter]);

  const totalIncome = useMemo(() =>
    dateFiltered.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0),
    [dateFiltered]
  );

  const totalExpense = useMemo(() =>
    dateFiltered.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0),
    [dateFiltered]
  );

  const netBalance = totalIncome - totalExpense;

  if (!token || user?.userType !== 'admin') return null;

  const columns: ColumnDef<BookKeepingEntry>[] = [
    { key: 'date', header: 'Date', sortable: true, cell: (r) => <span className="text-sm">{formatDateTime(r.date)}</span> },
    { key: 'type', header: 'Type', sortable: true, cell: (r) => (
      <Badge tone={r.type === 'income' ? 'success' : 'danger'}>
        {r.type === 'income' ? 'IN' : 'OUT'}
      </Badge>
    )},
    { key: 'category', header: 'Category', sortable: true, cell: (r) => (
      <span className="text-sm capitalize">{r.category.replace(/_/g, ' ')}</span>
    )},
    { key: 'description', header: 'Description', sortable: false, cell: (r) => (
      <span className="text-sm text-[var(--color-fg-secondary)]">{r.description}</span>
    )},
    { key: 'amount', header: 'Amount', sortable: true, align: 'right', cell: (r) => (
      <span className={`tabular-nums font-medium ${r.type === 'income' ? 'text-[var(--color-success-700)]' : 'text-[var(--color-error-700)]'}`}>
        {r.type === 'income' ? '+' : '-'}{money(r.amount)}
      </span>
    )},
    { key: 'reference', header: 'Reference', sortable: false, cell: (r) => (
      <span className="text-xs text-[var(--color-fg-quaternary)]">{r.reference || '—'}</span>
    )},
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Book Keeping"
        description="Financial overview — money in (subscriptions) vs money out (gym payouts)."
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {/* Date range picker */}
      <div className="flex flex-wrap items-center gap-2">
        {DATE_PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => setDateRange(p.key)}
            className={`px-3 py-1.5 text-xs rounded-[var(--radius-lg)] font-medium border transition-colors ${
              dateRange === p.key
                ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border-[var(--color-brand-200)]'
                : 'text-[var(--color-fg-tertiary)] border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-tertiary)]'
            }`}
          >
            {p.label}
          </button>
        ))}
        {dateRange === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              className="ui-input !h-8 !text-xs !px-2"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
            />
            <span className="text-xs text-[var(--color-fg-quaternary)]">to</span>
            <input
              type="date"
              className="ui-input !h-8 !text-xs !px-2"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-[var(--radius-lg)] bg-[var(--color-success-50)] flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-[var(--color-success-600)]" />
            </div>
            <div>
              <p className="text-xs text-[var(--color-fg-quaternary)]">Money In</p>
              <p className="text-2xl font-bold tabular-nums text-[var(--color-success-700)]">{money(totalIncome)}</p>
              <p className="text-xs text-[var(--color-fg-quaternary)]">From subscriptions</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-[var(--radius-lg)] bg-[var(--color-error-50)] flex items-center justify-center">
              <TrendingDown className="h-6 w-6 text-[var(--color-error-600)]" />
            </div>
            <div>
              <p className="text-xs text-[var(--color-fg-quaternary)]">Money Out</p>
              <p className="text-2xl font-bold tabular-nums text-[var(--color-error-700)]">{money(totalExpense)}</p>
              <p className="text-xs text-[var(--color-fg-quaternary)]">Gym payouts</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-5 flex items-center gap-4">
            <div className={`h-12 w-12 rounded-[var(--radius-lg)] flex items-center justify-center ${netBalance >= 0 ? 'bg-[var(--color-brand-50)]' : 'bg-[var(--color-warning-50)]'}`}>
              <DollarSign className={`h-6 w-6 ${netBalance >= 0 ? 'text-[var(--color-brand-600)]' : 'text-[var(--color-warning-600)]'}`} />
            </div>
            <div>
              <p className="text-xs text-[var(--color-fg-quaternary)]">Net Balance</p>
              <p className={`text-2xl font-bold tabular-nums ${netBalance >= 0 ? 'text-[var(--color-brand-700)]' : 'text-[var(--color-warning-700)]'}`}>
                {money(netBalance)}
              </p>
              <p className="text-xs text-[var(--color-fg-quaternary)]">{netBalance >= 0 ? 'Profit' : 'Deficit'}</p>
            </div>
          </div>
        </Card>
      </div>

      {loading && !entries.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={filtered}
              keyFn={(r) => r.id}
              filterPlaceholder="Search transactions..."
              emptyState="No transactions found."
              extraFilters={
                <div className="flex gap-1">
                  {(['all', 'income', 'expense'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setTypeFilter(f)}
                      className={`px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
                        typeFilter === f
                          ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
                          : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {f === 'all' ? 'All' : f === 'income' ? 'Money In' : 'Money Out'}
                    </button>
                  ))}
                </div>
              }
            />
          </div>
        </Card>
      )}
    </div>
  );
}
