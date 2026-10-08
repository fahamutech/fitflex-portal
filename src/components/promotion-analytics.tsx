'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Info } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../../app/providers';
import { api, PromotionAnalyticsDetail, PromotionMetrics } from '@/lib/api';
import { TYPE_KEY as ENTITY_TYPE_KEY } from '@/lib/moderation';
import { PLACEMENT_KEY, STATUS_KEY, STATUS_TONE, TYPE_KEY, errorKey, pct, ratio, ymdLabel } from '@/lib/promotions';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Card, CardContent, CardHeader, Spinner } from '@/components/shared';

// Colour-blind-safe pair (Okabe-Ito blue and vermillion) that also differ by line style and marker.
const C_IMPRESSIONS = '#0072B2';
const C_CLICKS = '#D55E00';
const GRID = 'var(--color-border-secondary)';
const INK = 'var(--color-fg-quaternary)';
const num = (n: number | null | undefined) => new Intl.NumberFormat('en-US').format(Number(n || 0));

/** The headline numbers. A rate with nothing to divide by is a dash, never 0%. */
export function MetricTiles({ totals, testId = 'pan-tiles' }: { totals: PromotionMetrics; testId?: string }) {
  const { t } = useApp();
  const tiles: Array<{ key: string; label: MessageKey; value: string; sub?: string }> = [
    { key: 'impressions', label: 'pan.tile.impressions', value: num(totals.impressions) },
    { key: 'searchAppearances', label: 'pan.tile.searchAppearances', value: num(totals.searchAppearances) },
    { key: 'clicks', label: 'pan.tile.clicks', value: num(totals.clicks) },
    { key: 'ctr', label: 'pan.tile.ctr', value: pct(totals.clickThroughRate) },
    { key: 'views', label: 'pan.tile.views', value: num(totals.detailViews), sub: `${t('pan.tile.viewRate')}: ${pct(totals.viewRate)}` },
    { key: 'saves', label: 'pan.tile.saves', value: num(totals.saves) },
    { key: 'bookingClicks', label: 'pan.tile.bookingClicks', value: num(totals.bookingClicks) },
    { key: 'subscriptionClicks', label: 'pan.tile.subscriptionClicks', value: num(totals.subscriptionClicks) },
    { key: 'purchases', label: 'pan.tile.purchases', value: num(totals.purchases), sub: money(totals.purchaseValueTzs) },
    { key: 'uniqueViewers', label: 'pan.tile.uniqueViewers', value: num(totals.uniqueViewers) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid={testId}>
      {tiles.map(tile => (
        <div key={tile.key} className="min-w-0 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-4" data-testid={`pan-tile-${tile.key}`}>
          <p className="text-sm text-[var(--color-fg-tertiary)]">{t(tile.label)}</p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums" data-testid={`pan-value-${tile.key}`}>{tile.value}</p>
          {tile.sub && <p className="mt-0.5 truncate text-xs text-[var(--color-fg-quaternary)]" data-testid={`pan-sub-${tile.key}`}>{tile.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/** What the apps cannot see yet, driven by the server's own list. */
export function NotTrackedNotice({ items }: { items: string[] }) {
  const { t } = useApp();
  if (!items.length) return null;
  const names = items.map(i => { const k = `pan.notTracked.${i}` as MessageKey; const label = t(k); return label === k ? i.replace(/_/g, ' ') : label; });
  return (
    <div role="note" className="flex gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] p-4 text-sm" data-testid="pan-not-tracked">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-fg-tertiary)]" aria-hidden />
      <div>
        <p className="font-medium">{t('pan.notTracked.title')}</p>
        <p className="mt-1 text-[var(--color-fg-tertiary)]">{t('pan.notTracked.body').replace('{items}', names.join(', '))}</p>
      </div>
    </div>
  );
}

const FUNNEL_KEY: Record<string, MessageKey> = {
  impressions: 'pan.funnel.impressions', clicks: 'pan.funnel.clicks', detailViews: 'pan.funnel.detailViews', actionClicks: 'pan.funnel.actionClicks', conversions: 'pan.funnel.conversions',
};

/** One promotion's performance over a range: tiles, daily chart, funnel and placements. */
export function PromotionPerformanceView({ id, from, to, onBack }: { id: string; from?: string; to?: string; onBack: () => void }) {
  const { token, t } = useApp();
  const [data, setData] = useState<PromotionAnalyticsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    setData(null); setError(null);
    api.promotionAnalyticsDetail(token, id, { from, to })
      .then(d => { if (live) setData(d); })
      .catch(err => { if (live) setError(t(errorKey(err))); });
    return () => { live = false; };
  }, [token, id, from, to, t]);

  const p = data?.promotion;
  const daily = (data?.daily ?? []).map(d => ({ day: d.day, impressions: d.impressions ?? 0, clicks: d.clicks ?? 0 }));
  const anyDaily = daily.some(d => d.impressions > 0 || d.clicks > 0);
  const funnel = data?.funnel ?? [];

  return (
    <div className="space-y-6" data-testid="pan-detail">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)]" data-testid="pan-back">
        <ArrowLeft className="h-4 w-4" />{t('pro.back')}
      </button>
      {error && <Alert tone="error">{error}</Alert>}
      {!data && !error && <Spinner className="h-6 w-6" />}
      {data && p && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-[var(--color-fg-quaternary)]">{t(ENTITY_TYPE_KEY[p.entityType])} · {t(TYPE_KEY[p.type])}</p>
              <h1 className="break-words text-xl font-semibold" data-testid="pan-name">{p.entityName ?? p.entityId}</h1>
              <p className="mt-1 text-sm text-[var(--color-fg-tertiary)]" data-testid="pan-period">{t('pan.detail.period').replace('{from}', ymdLabel(data.range.from)).replace('{to}', ymdLabel(data.range.to))}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/admin/promotions?item=${encodeURIComponent(p.id)}`} className="text-sm text-[var(--color-fg-brand)] hover:underline" data-testid="pan-open-promotion">{t('pan.openPromotion')}</Link>
              <Badge tone={STATUS_TONE[p.status] ?? 'gray'} dot><span data-testid="pan-status">{STATUS_KEY[p.status] ? t(STATUS_KEY[p.status]) : p.status}</span></Badge>
            </div>
          </div>

          <MetricTiles totals={data.totals} />
          <NotTrackedNotice items={data.notTracked} />

          <Card>
            <CardHeader><h2 className="font-semibold">{t('pan.detail.daily')}</h2></CardHeader>
            <CardContent>
              {!anyDaily ? <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="pan-daily-empty">{t('pan.detail.dailyEmpty')}</p> : (
                <>
                  <div role="img" aria-label={t('pan.detail.daily')} className="h-[260px] w-full" data-testid="pan-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={daily} margin={{ left: -12, right: 8, top: 8 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="day" tickFormatter={d => String(d).slice(5)} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
                        <Tooltip labelFormatter={v => ymdLabel(String(v))} />
                        <Line type="monotone" name={t('pan.series.impressions')} dataKey="impressions" stroke={C_IMPRESSIONS} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                        <Line type="monotone" name={t('pan.series.clicks')} dataKey="clicks" stroke={C_CLICKS} strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-fg-tertiary)]" aria-hidden>
                    <li className="flex items-center gap-2"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C_IMPRESSIONS} strokeWidth="2" /></svg>{t('pan.series.impressions')}</li>
                    <li className="flex items-center gap-2"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C_CLICKS} strokeWidth="2" strokeDasharray="6 3" /></svg>{t('pan.series.clicks')}</li>
                  </ul>
                  <table className="sr-only" data-testid="pan-daily-table">
                    <caption>{t('pan.detail.dailyTable')}</caption>
                    <thead><tr><th>{t('pan.col.day')}</th><th>{t('pan.series.impressions')}</th><th>{t('pan.series.clicks')}</th></tr></thead>
                    <tbody>{daily.map(d => <tr key={d.day}><td>{d.day}</td><td>{d.impressions}</td><td>{d.clicks}</td></tr>)}</tbody>
                  </table>
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><div><h2 className="font-semibold">{t('pan.detail.funnel')}</h2><p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">{t('pan.detail.funnelHint')}</p></div></CardHeader>
              <CardContent>
                <ol className="space-y-3" data-testid="pan-funnel">
                  {funnel.map((s, i) => {
                    const top = funnel[0]?.count ?? 0;
                    const prev = i > 0 ? funnel[i - 1].count : null;
                    const step = prev == null ? null : ratio(s.count, prev);
                    return (
                      <li key={s.step} data-testid={`pan-funnel-${s.step}`}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0">{t(FUNNEL_KEY[s.step] ?? 'pan.funnel.impressions')}</span>
                          <span className="shrink-0 tabular-nums"><span className="font-semibold" data-testid={`pan-funnel-count-${s.step}`}>{num(s.count)}</span>
                            {i > 0 && <span className="ml-2 text-xs text-[var(--color-fg-quaternary)]" data-testid={`pan-funnel-pct-${s.step}`}>{t('pan.funnel.of').replace('{pct}', pct(step))}</span>}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-[var(--color-bg-tertiary)]" aria-hidden>
                          <div className="h-2 rounded-full" style={{ width: `${top > 0 ? Math.max(s.count > 0 ? 2 : 0, Math.round((s.count / top) * 100)) : 0}%`, background: C_IMPRESSIONS }} />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><h2 className="font-semibold">{t('pan.detail.placements')}</h2></CardHeader>
              <CardContent className="p-0">
                {data.byPlacement.length === 0 ? <p className="p-6 text-sm text-[var(--color-fg-quaternary)]" data-testid="pan-placements-empty">{t('pan.detail.noPlacements')}</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-sm" data-testid="pan-placements">
                      <thead className="text-left text-xs text-[var(--color-fg-tertiary)]"><tr className="border-b border-[var(--color-border-secondary)]">
                        <th className="px-4 py-2.5 font-medium">{t('pan.col.placement')}</th><th className="px-4 py-2.5 text-right font-medium">{t('pan.col.impressions')}</th>
                        <th className="px-4 py-2.5 text-right font-medium">{t('pan.col.clicks')}</th><th className="px-4 py-2.5 text-right font-medium">{t('pan.col.ctr')}</th></tr></thead>
                      <tbody className="divide-y divide-[var(--color-border-secondary)]">
                        {data.byPlacement.map(r => (
                          <tr key={r.placement} data-testid={`pan-placement-${r.placement}`}>
                            <td className="px-4 py-3">{PLACEMENT_KEY[r.placement] ? t(PLACEMENT_KEY[r.placement]) : r.placement}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{num(r.impressions)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{num(r.clicks)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{pct(r.clickThroughRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
