'use client';
// Shared pieces of the vendor Reports page (S6): the data hook (latest request wins, one failure per view), the
// header line, small figure tiles, states and the bar chart with its spoken summary. Every label is an i18n key.
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { canWalkInSales, errorBody, errorCode, fmt } from '@/lib/vendor';
import {
  bucketWords, channelKey, reportClock, periodWords, rangeProblemKey, reportsApi,
  type ReportGroupBy, type ReportHead, type ReportOf, type ReportQuery, type ReportView,
} from '@/lib/vendor-reports';
import { Button, Card, EmptyState, ErrorState, Skeleton, SkeletonCard, SkeletonTable } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { useToast } from '@/components/ui/toast';
import { useApp } from '../../../../app/providers';

export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'invalid'; messageKey: MessageKey }
  /** The server switched the area or this section off: nothing is shown while /vendor/me is asked again. */
  | { state: 'off' }
  | { state: 'ready'; data: T };

const RANGE_REASONS: Record<string, 'invalid' | 'future' | 'toBeforeFrom' | 'tooLong'> = {
  from_and_to_required: 'invalid', invalid_date: 'invalid', future: 'future', to_before_from: 'toBeforeFrom', too_long: 'tooLong',
};

/**
 * One report section. Changing the query cancels the request in flight; only the latest answer renders (§11).
 * Refusals go to the vendor area's shared handler (no access, feature switched off); cost_not_allowed and
 * payout_not_allowed say "no access" and ask /vendor/me again, so the section disappears.
 */
export function useReport<V extends ReportView>(view: V, query: ReportQuery, enabled = true) {
  const { token, t } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [value, setValue] = useState<Loaded<ReportOf[V]>>({ state: 'loading' });
  const seq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const key = JSON.stringify([view, query]);
  const load = useCallback(async () => {
    if (!token || !enabled) return;
    const id = ++seq.current;
    inFlight.current?.abort();
    const ctl = new AbortController();
    inFlight.current = ctl;
    setValue({ state: 'loading' });
    try {
      const data = await reportsApi.get(token, view, query, ctl.signal);
      if (id === seq.current) setValue({ state: 'ready', data });
    } catch (err) {
      if (id !== seq.current || (err instanceof DOMException && err.name === 'AbortError')) return;
      const code = errorCode(err);
      if (code === 'invalid_range') {
        const reason = RANGE_REASONS[String(errorBody<{ reason?: string }>(err)?.reason ?? '')] ?? 'invalid';
        setValue({ state: 'invalid', messageKey: rangeProblemKey(reason) });
        return;
      }
      if (code === 'too_many_buckets') { setValue({ state: 'invalid', messageKey: 'vendor.reports.groupTooMany' }); return; }
      if (code === 'cost_not_allowed' || code === 'payout_not_allowed') {
        toast.error(t('vendor.reports.noAccess'));
        void vendor.refresh();
        setValue({ state: 'failed' });
        return;
      }
      if (code === 'feature_disabled') {
        // Reports (or this section's tool) switched off: leave loading, then the Shell sends the person home
        // once /vendor/me says so, or the page drops the section (spec §0.1: never "feature off").
        setValue({ state: 'off' });
        vendor.handleError(err);
        return;
      }
      if (!vendor.handleError(err)) setValue({ state: 'failed' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, enabled, key]);
  useEffect(() => {
    void load();
    // A newer request (or leaving the view) makes any answer still on its way stale.
    return () => { seq.current += 1; inFlight.current?.abort(); };
  }, [load]);
  return [value, load] as const;
}

/** Tell the page whether the answer says walk-in data exists in the period (the channel control shows then, §0.1). */
export function useWalkInSeen(value: Loaded<{ channels: { walkIn: boolean } }>, onWalkIn: (seen: boolean) => void) {
  const seen = value.state === 'ready' ? value.data.channels.walkIn : null;
  useEffect(() => { if (seen != null) onWalkIn(seen); }, [seen, onWalkIn]);
}

/** "1–31 Oct 2026 (so far) · All sales · Updated 2:05 pm" (spec §3). */
export function HeaderLine({ head, view }: { head: ReportHead; view: ReportView }) {
  const { t, locale } = useApp();
  const channel = view === 'payouts' ? t('vendor.reports.channel.appOnly')
    : view === 'customers' ? t('vendor.reports.channel.allChannels')
    : head.channel === 'all' ? t('vendor.reports.channel.allSales') : t(channelKey(head.channel));
  const period = `${periodWords(head.from, head.to, locale)}${head.inProgress ? ` ${t('vendor.reports.inProgress')}` : ''}`;
  return (
    <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="report-header-line">
      {period} · {channel} · <span aria-live="polite">{fmt(t('vendor.reports.updated'), { time: reportClock(head.generatedAt, locale) })}</span>
    </p>
  );
}

/** A headline figure (a smaller MetricCard; figures wrap rather than truncate). */
export function Figure({ label, value, sub, testId, strong = false }: { label: string; value: ReactNode; sub?: ReactNode; testId?: string; strong?: boolean }) {
  return (
    <Card data-testid={testId}>
      <div className="p-4 sm:p-5">
        <p className="text-sm font-medium text-[var(--color-fg-quaternary)] [overflow-wrap:anywhere]">{label}</p>
        <p className={`mt-1 tabular-nums tracking-tight text-[var(--color-fg-primary)] ${strong ? 'text-2xl font-semibold' : 'text-xl font-semibold'}`}>{value}</p>
        {sub && <p className="mt-1 text-sm text-[var(--color-fg-quaternary)] [overflow-wrap:anywhere]">{sub}</p>}
      </div>
    </Card>
  );
}
export const figureGrid = 'grid gap-3 grid-cols-2 lg:grid-cols-4';

/** Money going out (discounts, refunds, commission, cost): one format everywhere, "−TSh 39,000" (§0.4, UAT D11). */
export const minus = (n: number) => (n > 0 ? `\u2212${money(n)}` : money(0));
/** A percentage with one decimal, "25.0%" (UAT D12); "—" when there is none. */
export const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(1)}%`);

/** "1 sale" / "3 sales" (UAT D10): the one-key for n = 1, else the many-key; {n} and the other values filled in. */
export function plural(t: (k: MessageKey) => string, n: number, one: MessageKey, many: MessageKey, vars: Record<string, string | number> = {}) {
  return fmt(t(n === 1 ? one : many), { n, ...vars });
}

/**
 * Profit of a row (UAT D1): never "TSh 0" for a product without a cost price.
 * - profitTzs null, or the row has a costTzs that is null → unknown, said as "No cost price".
 * - Interim, until the backend sends null: a 0 with no cost information on the row → unknown ("—" only; a
 *   Products row carries no costTzs, so it cannot say why).
 */
export function ProfitCell({ row }: { row: { profitTzs?: number | null; costTzs?: number | null } }) {
  const { t } = useApp();
  const noCost = row.profitTzs === null || ('costTzs' in row && row.costTzs == null);
  if (noCost) {
    return (
      <span data-testid="profit-unknown">
        <span aria-hidden="true">—</span>
        <span className="block text-xs text-[var(--color-fg-quaternary)]">{t('vendor.reports.profit.noCostHeading')}</span>
      </span>
    );
  }
  if (row.profitTzs == null || (row.profitTzs === 0 && !('costTzs' in row))) return <span data-testid="profit-unknown">—</span>;
  return <>{money(row.profitTzs)}</>;
}

export function ViewLoading({ cards = 4 }: { cards?: number }) {
  const { t } = useApp();
  return (
    <div className="space-y-4" aria-busy="true" aria-label={t('vendor.reports.loading')} data-testid="report-loading">
      <div className={figureGrid}>{Array.from({ length: cards }, (_, i) => <SkeletonCard key={i} lines={2} />)}</div>
      <SkeletonTable rows={5} columns={5} />
    </div>
  );
}
export function CardLoading() {
  const { t } = useApp();
  return <div aria-busy="true" aria-label={t('vendor.reports.loading')}><Skeleton className="h-24 w-full" /></div>;
}
export function ViewFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useApp();
  return <ErrorState title={t('vendor.reports.failed')} onRetry={onRetry} retryLabel={t('common.tryAgain')} />;
}
export function NoSales({ from, to, onTryPeriod, hasEverSold }: { from: string; to: string; onTryPeriod: () => void; hasEverSold?: boolean }) {
  const { t, locale } = useApp();
  const vendor = useVendor();
  // UAT D2: a vendor who has never sold sees the first-use message with the actions their permissions allow.
  // Only when the server says so (hasEverSold === false); absent → the period message as before.
  if (hasEverSold === false) {
    const sales = canWalkInSales(vendor.me);
    const products = vendor.can('products');
    return (
      <div data-testid="report-empty-first">
        <EmptyState
          icon={<BarChart3 />}
          title={t('vendor.reports.emptyFirst')}
          action={(sales || products) ? (
            <div className="flex flex-wrap justify-center gap-2">
              {sales && <Link href="/vendor/sales/" className={actionLinkCls} data-testid="report-empty-sale">{t('vendor.reports.recordSale')}</Link>}
              {products && <Link href="/vendor/products/" className={actionLinkCls} data-testid="report-empty-products">{t('vendor.reports.addProducts')}</Link>}
            </div>
          ) : undefined}
        />
      </div>
    );
  }
  return (
    <div data-testid="report-empty">
      <EmptyState
        icon={<BarChart3 />}
        title={fmt(t('vendor.reports.empty'), { period: periodWords(from, to, locale) })}
        action={<Button variant="secondary" className="min-h-11" onClick={onTryPeriod}>{t('vendor.reports.tryPeriod')}</Button>}
      />
    </div>
  );
}

/** Loading / failed / range refused / ready, for a whole view. */
export function ViewState<T>({ value, onRetry, children, cards }: { value: Loaded<T>; onRetry: () => void; children: (data: T) => ReactNode; cards?: number }) {
  const { t } = useApp();
  if (value.state === 'loading') return <ViewLoading cards={cards} />;
  if (value.state === 'failed') return <ViewFailed onRetry={onRetry} />;
  if (value.state === 'off') return <div data-testid="report-off" />;
  if (value.state === 'invalid') return <p role="alert" className="text-sm font-medium text-[var(--color-error-700)]" data-testid="report-range-error">{t(value.messageKey)}</p>;
  return <>{children(value.data)}</>;
}

// ── Chart ──

export type ChartRow = { start: string; end: string; app?: number; shop?: number; value?: number };
const APP_FILL = 'var(--color-brand-600)';
const SHOP_FILL = 'var(--color-gray-400)';
const GRID = 'var(--color-border-secondary)';
const INK = 'var(--color-fg-quaternary)';

/**
 * Bars per bucket: stacked App / Shop when the shop channel shows, else one series. One tab stop with the spoken
 * summary (§12); the numbers are always in the table below it.
 */
export function ReportBarChart({
  rows, groupBy, from, to, figureKey, twoSeries, testId,
}: { rows: ChartRow[]; groupBy: ReportGroupBy | undefined; from: string; to: string; figureKey: MessageKey; twoSeries: boolean; testId?: string }) {
  const { t, locale } = useApp();
  const total = (r: ChartRow) => (twoSeries ? (r.app ?? 0) + (r.shop ?? 0) : r.value ?? 0);
  const top = rows.reduce<ChartRow | null>((best, r) => (!best || total(r) > total(best) ? r : best), null);
  const sum = rows.reduce((s, r) => s + total(r), 0);
  const groupWord = t(`vendor.reports.group.${groupBy ?? 'day'}` as MessageKey).toLowerCase();
  const summary = fmt(t('vendor.reports.chartSummary'), {
    figure: t(figureKey), group: groupWord, period: periodWords(from, to, locale),
    date: top ? bucketWords(top.start, top.end, groupBy, locale) : '—', amount: money(top ? total(top) : 0), total: money(sum),
  });
  const data = rows.map(r => ({ ...r, label: bucketWords(r.start, r.end, groupBy, locale) }));
  const tsh = (v: unknown) => money(Number(v));
  return (
    <div role="img" tabIndex={0} aria-label={summary} className="h-[200px] w-full sm:h-[260px]" data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: INK, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis tick={{ fill: INK, fontSize: 12 }} tickLine={false} axisLine={false} width={72} tickFormatter={v => new Intl.NumberFormat('en-US').format(Number(v))} />
          <Tooltip formatter={tsh} cursor={{ fill: 'var(--color-bg-tertiary)' }} />
          {twoSeries ? (
            <>
              <Legend />
              <Bar dataKey="app" stackId="n" name={t('vendor.reports.channel.app')} fill={APP_FILL} isAnimationActive={false} />
              <Bar dataKey="shop" stackId="n" name={t('vendor.reports.channel.walkIn')} fill={SHOP_FILL} isAnimationActive={false} />
            </>
          ) : <Bar dataKey="value" name={t(figureKey)} fill={APP_FILL} isAnimationActive={false} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const numCell = 'whitespace-nowrap text-right tabular-nums';
export const linkCls = 'inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline';
/** A link styled as a secondary button (≥44px). */
export const actionLinkCls = 'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 text-sm font-semibold text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-secondary)]';
/** A link inside an Alert: underlined, with a tap target of at least 44px (UAT D7). */
export const alertLinkCls = 'inline-flex min-h-11 items-center font-semibold underline underline-offset-4';
/** "Product · variant" with "(removed)". */
export function productLabel(row: { name: string | null; variant: string | null; removed: boolean }, t: (k: MessageKey) => string) {
  const name = row.name || '—';
  return `${name}${row.variant ? ` · ${row.variant}` : ''}${row.removed ? ` ${t('vendor.reports.removed')}` : ''}`;
}
