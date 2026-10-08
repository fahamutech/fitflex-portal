'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ModerationEntityType, PromotionAnalytics, PromotionPlacement, PromotionType } from '@/lib/api';
import { TYPE_KEY as ENTITY_TYPE_KEY } from '@/lib/moderation';
import { PLACEMENTS, PLACEMENT_KEY, PROMOTION_TYPES, STATUS_KEY, STATUS_TONE, TYPE_KEY, addDays, eatToday, errorKey, isYmd, pct } from '@/lib/promotions';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, Field, PageHeader, Spinner } from '@/components/shared';
import { MetricTiles, NotTrackedNotice, PromotionPerformanceView } from '@/components/promotion-analytics';

const ENTITY_TYPES: ModerationEntityType[] = ['gym', 'trainer', 'vendor', 'product'];
const PRESETS: Array<{ days: number; key: MessageKey }> = [{ days: 7, key: 'pan.last7' }, { days: 30, key: 'pan.last30' }, { days: 90, key: 'pan.last90' }];
const num = (n: number) => new Intl.NumberFormat('en-US').format(n);
const FILTERS = ['type', 'placement', 'entityType', 'campaignId'] as const;

/**
 * Promotion performance: what promoted listings earned over a date range, per promotion,
 * and one promotion in detail (?item=). Everything, range and filters included, is in the URL.
 */
export default function PromotionAnalyticsPage() {
  const { token, user, t } = useApp();
  const [sp, setSp] = useState<URLSearchParams>(() => new URLSearchParams());
  const [data, setData] = useState<PromotionAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const sync = () => { setSp(new URLSearchParams(window.location.search)); setSynced(true); };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const update = (mut: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(sp.toString());
    mut(q);
    const qs = q.toString();
    history.pushState(null, '', qs ? `?${qs}` : window.location.pathname);
    setSp(q);
  };

  const today = eatToday();
  const rawFrom = sp.get('from'); const rawTo = sp.get('to');
  const to = isYmd(rawTo) ? rawTo : today;
  const from = isYmd(rawFrom) ? rawFrom : addDays(to, -29);
  const type = sp.get('type') as PromotionType | null;
  const placement = sp.get('placement') as PromotionPlacement | null;
  const entityType = sp.get('entityType') as ModerationEntityType | null;
  const campaignId = sp.get('campaignId');
  const item = sp.get('item');
  const badRange = from > to;
  const filterKey = [from, to, type, placement, entityType, campaignId].join('|');

  const load = useCallback(async (live: () => boolean) => {
    if (!token) return;
    if (badRange) { setData(null); setError(t('pro.err.invalid_range')); return; }
    setError(null);
    try {
      const out = await api.promotionAnalytics(token, { from, to, type: type ?? undefined, placement: placement ?? undefined, entityType: entityType ?? undefined, campaignId: campaignId ?? undefined });
      if (live()) setData(out);
    } catch (err) { if (live()) { setError(t(errorKey(err))); setData(null); } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filterKey, badRange, t]);
  useEffect(() => {
    if (item || !synced) return;
    let live = true;
    setData(null);
    load(() => live);
    return () => { live = false; };
  }, [load, tick, item, synced]);

  const range = useMemo(() => ({ from, to }), [from, to]);
  if (!token || user?.userType !== 'admin') return null;

  if (item) {
    return <PromotionPerformanceView id={item} from={range.from} to={range.to} onBack={() => update(q => q.delete('item'))} />;
  }

  const activePreset = PRESETS.find(p => to === today && from === addDays(today, -(p.days - 1)))?.days;
  const hasFilters = FILTERS.some(k => sp.get(k));
  const setFilter = (k: (typeof FILTERS)[number], v: string) => update(q => { if (v) q.set(k, v); else q.delete(k); });
  const select = (label: MessageKey, k: (typeof FILTERS)[number], value: string | null, options: Array<[string, string]>, testId: string) => (
    <Field label={t(label)}>
      <select className="ui-input" value={value ?? ''} onChange={e => setFilter(k, e.target.value)} data-testid={testId}>
        <option value="">{t('pan.filter.all')}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('pan.title')} description={t('pan.description')}
        actions={<Button variant="secondary" size="sm" onClick={() => setTick(n => n + 1)}><RefreshCw className="h-4 w-4" />{t('mod.refresh')}</Button>} />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('pan.from')}><input type="date" className="ui-input" value={from} max={to} onChange={e => e.target.value && update(q => { q.set('from', e.target.value); q.set('to', to); })} data-testid="pan-from" /></Field>
            <Field label={t('pan.to')}><input type="date" className="ui-input" value={to} min={from} onChange={e => e.target.value && update(q => { q.set('from', from); q.set('to', e.target.value); })} data-testid="pan-to" /></Field>
            <div className="flex flex-wrap gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-tertiary)] p-1" role="group">
              {PRESETS.map(p => (
                <button key={p.days} type="button" aria-pressed={activePreset === p.days} data-testid={`pan-preset-${p.days}`}
                  onClick={() => update(q => { q.set('to', today); q.set('from', addDays(today, -(p.days - 1))); })}
                  className={`rounded-md px-3 py-1.5 text-sm ${activePreset === p.days ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>{t(p.key)}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {select('pan.filter.type', 'type', type, PROMOTION_TYPES.map(v => [v, t(TYPE_KEY[v])]), 'pan-filter-type')}
            {select('pan.filter.placement', 'placement', placement, PLACEMENTS.map(v => [v, t(PLACEMENT_KEY[v])]), 'pan-filter-placement')}
            {select('pan.filter.listing', 'entityType', entityType, ENTITY_TYPES.map(v => [v, t(ENTITY_TYPE_KEY[v])]), 'pan-filter-listing')}
          </div>
          {(campaignId || hasFilters) && (
            <div className="flex flex-wrap items-center gap-2">
              {campaignId && <Badge tone="brand"><span data-testid="pan-campaign-chip">{t('pan.filter.campaign')}</span></Badge>}
              <Button variant="secondary" size="sm" onClick={() => update(q => FILTERS.forEach(k => q.delete(k)))} data-testid="pan-clear">{t('pan.filter.clear')}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}
      {!data && !error && <Spinner className="h-6 w-6" />}
      {data && (
        <>
          <MetricTiles totals={data.totals} />
          <NotTrackedNotice items={data.notTracked} />
          <Card>
            <CardContent className="p-0">
              <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
                <h2 className="font-semibold">{t('pan.perPromotion')}</h2>
                <p className="text-xs text-[var(--color-fg-quaternary)]">{t('pan.tableHint')} {t('pan.noRate')}</p>
              </div>
              {data.items.length === 0 ? <p className="p-10 text-center text-sm text-[var(--color-fg-quaternary)]" data-testid="pan-empty">{t('pan.empty')}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm" data-testid="pan-table">
                    <thead className="text-left text-xs text-[var(--color-fg-tertiary)]"><tr className="border-b border-[var(--color-border-secondary)]">
                      <th className="px-4 py-2.5 font-medium">{t('pan.col.listing')}</th><th className="px-4 py-2.5 font-medium">{t('pan.col.type')}</th><th className="px-4 py-2.5 font-medium">{t('pan.col.status')}</th>
                      {(['impressions', 'clicks', 'ctr', 'views', 'saves', 'actionClicks', 'purchases'] as const).map(c => <th key={c} className="px-4 py-2.5 text-right font-medium">{t(`pan.col.${c}` as MessageKey)}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-[var(--color-border-secondary)]">
                      {data.items.map(r => (
                        <tr key={r.promotion.id} tabIndex={0} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" data-testid={`pan-row-${r.promotion.id}`}
                          onClick={() => update(q => q.set('item', r.promotion.id))}
                          onKeyDown={e => { if (e.key === 'Enter') update(q => q.set('item', r.promotion.id)); }}>
                          <td className="px-4 py-3"><span className="font-medium">{r.promotion.entityName ?? r.promotion.entityId}</span>
                            <p className="text-xs text-[var(--color-fg-quaternary)]">{t(ENTITY_TYPE_KEY[r.promotion.entityType])}</p></td>
                          <td className="px-4 py-3">{t(TYPE_KEY[r.promotion.type])}</td>
                          <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.promotion.status] ?? 'gray'} dot>{STATUS_KEY[r.promotion.status] ? t(STATUS_KEY[r.promotion.status]) : r.promotion.status}</Badge></td>
                          <td className="px-4 py-3 text-right tabular-nums" data-testid="pan-cell-impressions">{num(r.impressions)}</td>
                          <td className="px-4 py-3 text-right tabular-nums" data-testid="pan-cell-clicks">{num(r.clicks)}</td>
                          <td className="px-4 py-3 text-right tabular-nums" data-testid="pan-cell-ctr">{pct(r.clickThroughRate)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{num(r.detailViews)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{num(r.saves)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{num(r.bookingClicks + r.subscriptionClicks)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{num(r.purchases)}{r.purchases > 0 && <span className="block text-xs text-[var(--color-fg-quaternary)]">{money(r.purchaseValueTzs)}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
