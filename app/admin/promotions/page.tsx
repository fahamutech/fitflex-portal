'use client';
import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, GeoArea, Promotion } from '@/lib/api';
import { TYPE_KEY as ENTITY_TYPE_KEY } from '@/lib/moderation';
import { PLACEMENT_KEY, STATUS_KEY, STATUS_TONE, TABS, TAB_KEY, Tab, TYPE_KEY, dateTime, errorKey, tabOf } from '@/lib/promotions';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Spinner } from '@/components/shared';
import { PromotionWizard } from '@/components/promotion-wizard';
import { PromotionDetailView } from '@/components/promotion-detail';

/**
 * Promotions: every promotion by what it is right now, one at a time in detail
 * (?item=), and the create/edit wizard (?new=1, ?edit=). The view is in the URL.
 */
export default function PromotionsPage() {
  const { token, user, t, hasPermission } = useApp();
  const [rows, setRows] = useState<Promotion[] | null>(null);
  const [tab, setTab] = useState<Tab>('active');
  const [areas, setAreas] = useState<GeoArea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<{ item: string | null; edit: string | null; creating: boolean }>({ item: null, edit: null, creating: false });

  useEffect(() => {
    const sync = () => {
      const sp = new URLSearchParams(window.location.search);
      setView({ item: sp.get('item'), edit: sp.get('edit'), creating: sp.get('new') === '1' });
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const go = (qs: string) => { history.pushState(null, '', qs ? `?${qs}` : window.location.pathname); setView({ item: new URLSearchParams(qs).get('item'), edit: new URLSearchParams(qs).get('edit'), creating: new URLSearchParams(qs).get('new') === '1' }); };

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const all: Promotion[] = [];
      let cursor: number | undefined;
      for (let i = 0; i < 10; i += 1) {                       // 100 a page, up to 1000: far more than is run at once
        const page = await api.promotions(token, { cursor });
        all.push(...page.items);
        if (page.nextCursor == null) break;
        cursor = page.nextCursor;
      }
      setRows(all);
    } catch (err) {
      setError(t(errorKey(err)));
      setRows([]);
    }
  }, [token, t]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (token) api.geoAreas(token).then(r => setAreas(r.areas)).catch(() => setAreas([])); }, [token]);

  if (!token || user?.userType !== 'admin') return null;

  if (view.creating || view.edit) {
    return <PromotionWizard editId={view.edit} onClose={() => go(view.edit ? `item=${view.edit}` : '')} onSaved={id => { load(); go(`item=${id}`); }} />;
  }
  if (view.item) {
    return <PromotionDetailView id={view.item} areas={areas} onBack={() => { go(''); load(); }} onEdit={id => go(`edit=${encodeURIComponent(id)}`)} onChanged={load} />;
  }

  const counts = (s: Tab) => (rows ?? []).filter(r => tabOf(r) === s).length;
  const shown = (rows ?? []).filter(r => tabOf(r) === tab);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pro.title')}
        description={t('pro.description')}
        actions={(
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />{t('mod.refresh')}</Button>
            {hasPermission('promotions') && <Button size="sm" onClick={() => go('new=1')} data-testid="promotion-new"><Plus className="h-4 w-4" />{t('pro.new')}</Button>}
          </div>
        )}
      />
      {error && <Alert tone="error"><span className="flex flex-wrap items-center justify-between gap-2">{error}<Button size="sm" variant="secondary" onClick={load} data-testid="promotion-retry">{t('pro.retry')}</Button></span></Alert>}
      <div role="tablist" className="flex flex-wrap gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1 w-fit max-w-full">
        {TABS.map(s => (
          <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)} data-testid={`promotion-tab-${s}`}
            className={`flex min-h-10 items-center gap-2 rounded-md px-3 py-1.5 text-sm ${tab === s ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
            {t(TAB_KEY[s])}<span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 text-xs tabular-nums">{rows ? counts(s) : '·'}</span>
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : shown.length === 0 ? (error ? null :
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]" data-testid="promotion-empty">
              <Megaphone className="h-6 w-6" />{tab === 'requests' ? t('pro.empty.requests') : t('pro.empty.other')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" data-testid="promotion-table">
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                  <tr className="border-b border-[var(--color-border-secondary)]">
                    <th className="px-4 py-2.5 font-medium">{t('pro.col.entity')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('pro.col.type')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('pro.col.placements')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('pro.col.period')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('pro.col.priority')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('pro.col.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {shown.map(p => (
                    <tr key={p.id} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') go(`item=${encodeURIComponent(p.id)}`); }} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => go(`item=${encodeURIComponent(p.id)}`)} data-testid={`promotion-row-${p.id}`}>
                      <td className="max-w-[18rem] px-4 py-3 [overflow-wrap:anywhere]">
                        <span className="font-medium">{p.entity?.name ?? p.entityId}</span>
                        <p className="text-xs text-[var(--color-fg-quaternary)]">{t(ENTITY_TYPE_KEY[p.entityType])}</p>
                      </td>
                      <td className="px-4 py-3">{t(TYPE_KEY[p.type])}{p.isCommercial && <span className="ml-2"><Badge tone="warning">{t('pro.commercial')}</Badge></span>}</td>
                      <td className="max-w-[14rem] px-4 py-3 text-xs">{(p.placements ?? []).map(pl => t(PLACEMENT_KEY[pl])).join(', ')}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">{dateTime(p.startsAt)}<br />→ {dateTime(p.endsAt)}</td>
                      <td className="px-4 py-3 tabular-nums">{p.priority}</td>
                      <td className="px-4 py-3"><Badge tone={STATUS_TONE[p.effectiveStatus]} dot>{t(STATUS_KEY[p.effectiveStatus])}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
