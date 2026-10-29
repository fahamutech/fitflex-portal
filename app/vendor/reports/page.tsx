'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import { eatToday } from '@/lib/vendor';
import {
  autoGroupBy, bucketCount, CHANNELS, channelKey, GROUP_BYS, GROUPED, NO_CHANNEL, presetKey, presetOf, presetRange, PRESETS,
  PRODUCT_SORTS, rangeProblem, rangeProblemKey, REPORT_LIMITS, REPORT_VIEWS, reportAccess, viewKey,
  type ProductSort, type ReportChannel, type ReportGroupBy, type ReportPreset, type ReportQuery, type ReportView,
} from '@/lib/vendor-reports';
import { Button, Field, Input, PageHeader, Segmented, Select, useToast } from '@/components/shared';
import { useVendor } from '@/components/vendor-context';
import { OverviewView, SalesView, type ViewProps } from '@/components/vendor/reports/sales-views';
import { ProductsView, ProfitView, StockView } from '@/components/vendor/reports/stock-views';
import { CustomersView, MethodsView, PayoutsView } from '@/components/vendor/reports/money-views';
import { ExportDialog } from '@/components/vendor/reports/export-dialog';
import { useApp } from '../../providers';

const presetBtn = (on: boolean, disabled: boolean) =>
  `inline-flex min-h-11 items-center rounded-[var(--radius-md)] px-3 text-sm font-medium transition-colors ${on
    ? 'bg-[var(--color-bg-primary)] text-[var(--color-fg-primary)] shadow-[var(--shadow-xs)]'
    : 'text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-secondary)]'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`;

/**
 * Vendor reports (S6, spec docs/design/vendor-reports-s6.md §2.1): one page, the view and period in the URL
 * (?view, ?from, ?to, ?channel, ?groupBy, ?sort; static export, query strings). Missing or invalid values fall back to
 * Overview · This month · All · auto grouping, rewritten with replace. A view change is a push (browser back moves
 * between views); period and channel changes are replace. The Shell guards the area (tools.reports and the `reports`
 * permission, failing closed); sections the person may not see are not offered at all.
 */
function ReportsInner() {
  const { t } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = reportAccess(vendor.me);
  const today = eatToday();

  // ── Read the URL, falling back on anything invalid ──
  const rawView = params.get('view');
  const knownView = REPORT_VIEWS.includes(rawView as ReportView) ? (rawView as ReportView) : null;
  const view: ReportView = knownView && access.views.includes(knownView) ? knownView : 'overview';
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const hasRange = rawFrom != null || rawTo != null;
  const rangeOk = hasRange && !rangeProblem(rawFrom, rawTo, today);
  const { from, to } = rangeOk ? { from: rawFrom!, to: rawTo! } : presetRange('thisMonth', today);
  const rawChannel = params.get('channel');
  const channel: ReportChannel = CHANNELS.includes(rawChannel as ReportChannel) ? (rawChannel as ReportChannel) : 'all';
  const rawGroup = params.get('groupBy');
  const groupOk = GROUP_BYS.includes(rawGroup as ReportGroupBy) && bucketCount(from, to, rawGroup as ReportGroupBy) <= REPORT_LIMITS.maxBuckets;
  const groupBy: ReportGroupBy | undefined = groupOk ? (rawGroup as ReportGroupBy) : undefined;
  const rawSort = params.get('sort');
  const sort: ProductSort = PRODUCT_SORTS.includes(rawSort as ProductSort) ? (rawSort as ProductSort) : 'revenue';

  const setParams = useCallback((patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    const url = s ? `${pathname}?${s}` : pathname;
    if (push) router.push(url, { scroll: false }); else router.replace(url, { scroll: false });
  }, [params, pathname, router]);

  // Rewrite what was invalid (replace). A section this person may not open: Overview with "no access".
  const fixed = useRef<string | null>(null);
  useEffect(() => {
    const patch: Record<string, string | null> = {};
    if (rawView != null && rawView !== view) patch.view = view === 'overview' ? null : view;
    if (hasRange && !rangeOk) { patch.from = null; patch.to = null; }
    if (rawChannel != null && rawChannel !== channel) patch.channel = null;
    if (rawGroup != null && !groupOk) patch.groupBy = null;
    if (rawSort != null && rawSort !== sort) patch.sort = null;
    if (!Object.keys(patch).length) return;
    const sig = params.toString();
    if (fixed.current === sig) return;
    fixed.current = sig;
    if (knownView && knownView !== view) toast.error(t('vendor.reports.noAccess'));
    setParams(patch);
  }, [rawView, view, knownView, hasRange, rangeOk, rawChannel, channel, rawGroup, groupOk, rawSort, sort, params, setParams, toast, t]);

  // ── Controls ──
  const [walkInSeen, setWalkInSeen] = useState(false);
  const onWalkIn = useCallback((seen: boolean) => { if (seen) setWalkInSeen(true); }, []);
  const walkInShown = vendor.me?.tools.walkInSales === true || walkInSeen;
  const preset: ReportPreset = presetOf(from, to, today);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const customProblem = custom ? rangeProblem(custom.from, custom.to, today) : null;
  const periodRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    headingRef.current?.focus();
  }, [view]);

  const periodOff = view === 'stock';
  const effectiveGroup = groupBy ?? autoGroupBy(from, to);
  const choosePreset = (p: ReportPreset) => {
    if (periodOff) return;
    if (p === 'custom') { setCustom({ from, to }); return; }
    setCustom(null);
    const r = presetRange(p, today);
    setParams({ from: r.from, to: r.to, groupBy: null });
  };
  const applyCustom = () => {
    if (!custom || customProblem) return;
    setParams({ from: custom.from, to: custom.to, groupBy: null });
    setCustom(null);
  };
  const tryPeriod = useCallback(() => { periodRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, []);

  const query: ReportQuery = { from, to, channel, groupBy };
  const props: ViewProps = { query, walkInShown, onTryPeriod: tryPeriod, onWalkIn };
  const [exportOpen, setExportOpen] = useState(false);
  // The current view first, then the rest the person may open; Summary (PDF) stands for the Overview.
  const exportViews = [view, ...access.views.filter(v => v !== view)];

  const showChannel = walkInShown && !NO_CHANNEL.has(view);
  const showGroup = GROUPED.has(view);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('vendor.reports.title')}
        actions={
          <Button variant="secondary" className="min-h-11" onClick={() => setExportOpen(true)} data-testid="report-export">
            <Download aria-hidden="true" className="h-4 w-4" />{t('vendor.reports.export')}
          </Button>
        }
      />

      {/* View switch: a Segmented from md, a Select below it (9 Swahili labels do not fit a row at 375px). */}
      <div className="hidden md:block">
        <Segmented
          className="w-fit flex-wrap" value={view}
          onChange={v => setParams({ view: v === 'overview' ? null : v, sort: null }, true)}
          options={access.views.map(v => [v, t(viewKey(v))])}
        />
      </div>
      <div className="md:hidden">
        <Field label={t('vendor.reports.viewLabel')}>
          <Select value={view} onChange={e => setParams({ view: e.target.value === 'overview' ? null : e.target.value, sort: null }, true)} data-testid="report-view-select">
            {access.views.map(v => <option key={v} value={v}>{t(viewKey(v))}</option>)}
          </Select>
        </Field>
      </div>

      <div className="space-y-3 rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] p-4">
        <div role="group" aria-label={t('vendor.reports.period')} aria-disabled={periodOff || undefined} ref={periodRef} data-testid="report-presets">
          <p className="mb-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.reports.period')}</p>
          <div className="flex flex-wrap gap-0.5 rounded-[var(--radius-lg)] bg-[var(--color-bg-tertiary)] p-1 w-fit">
            {PRESETS.map(p => {
              const on = !periodOff && (p === 'custom' ? !!custom || preset === 'custom' : !custom && preset === p);
              return (
                <button key={p} type="button" aria-pressed={on} aria-disabled={periodOff || undefined} disabled={periodOff}
                  className={presetBtn(on, periodOff)} onClick={() => choosePreset(p)}>
                  {t(presetKey(p))}
                </button>
              );
            })}
          </div>
        </div>
        {custom && !periodOff && (
          <div className="flex flex-wrap items-end gap-3" data-testid="report-custom">
            <Field label={t('vendor.reports.from')}>
              <Input type="date" value={custom.from} max={today} onChange={e => setCustom(c => c && { ...c, from: e.target.value })} aria-invalid={!!customProblem} data-testid="report-from" />
            </Field>
            <Field label={t('vendor.reports.to')}>
              <Input type="date" value={custom.to} max={today} onChange={e => setCustom(c => c && { ...c, to: e.target.value })} aria-invalid={!!customProblem} data-testid="report-to" />
            </Field>
            <Button className="min-h-11" onClick={applyCustom} disabled={!!customProblem} data-testid="report-apply">{t('vendor.reports.apply')}</Button>
            {customProblem && <p role="alert" className="basis-full text-sm font-medium text-[var(--color-error-700)]" data-testid="report-custom-error">{t(rangeProblemKey(customProblem))}</p>}
          </div>
        )}
        {(showChannel || showGroup) && (
          <div className="flex flex-wrap gap-4">
            {showChannel && (
              <div role="group" aria-label={t('vendor.reports.channel')}>
                <p className="mb-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.reports.channel')}</p>
                <Segmented className="w-fit" value={channel} onChange={v => setParams({ channel: v === 'all' ? null : v })}
                  options={CHANNELS.map(c => [c, t(channelKey(c))])} />
              </div>
            )}
            {showGroup && (
              <Field label={t('vendor.reports.group')}>
                <Select value={effectiveGroup} onChange={e => setParams({ groupBy: e.target.value })} data-testid="report-group">
                  {GROUP_BYS.map(g => {
                    const tooMany = bucketCount(from, to, g) > REPORT_LIMITS.maxBuckets;
                    return <option key={g} value={g} disabled={tooMany}>{t(`vendor.reports.group.${g}` as MessageKey)}{tooMany ? ` · ${t('vendor.reports.groupTooMany')}` : ''}</option>;
                  })}
                </Select>
              </Field>
            )}
          </div>
        )}
      </div>

      <section aria-labelledby="report-view-heading" className="space-y-4">
        <h2 id="report-view-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-[var(--color-fg-primary)] outline-none" data-testid="report-view-heading">
          {t(viewKey(view))}
        </h2>
        {view === 'overview' && <OverviewView {...props} />}
        {view === 'sales' && <SalesView {...props} />}
        {view === 'products' && <ProductsView {...props} sort={sort} onSort={s => setParams({ sort: s === 'revenue' ? null : s })} />}
        {view === 'stock' && <StockView />}
        {view === 'profit' && <ProfitView {...props} />}
        {view === 'payouts' && <PayoutsView {...props} />}
        {view === 'customers' && <CustomersView {...props} />}
        {view === 'methods' && <MethodsView {...props} />}
      </section>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} views={exportViews} query={query} />
    </div>
  );
}

export default function VendorReportsPage() {
  return <Suspense fallback={null}><ReportsInner /></Suspense>;
}
