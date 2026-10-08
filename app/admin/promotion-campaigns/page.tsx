'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, CampaignAnalytics, GeoArea, Promotion, PromotionCampaign } from '@/lib/api';
import { MetricTiles, NotTrackedNotice } from '@/components/promotion-analytics';
import { TYPE_KEY as ENTITY_TYPE_KEY } from '@/lib/moderation';
import { PLACEMENT_KEY, STATUS_KEY, STATUS_TONE, TYPE_KEY, addDays, dateTime, eatToday, errorBody, errorKey, scopeSummary } from '@/lib/promotions';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, PageHeader, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { DateTimeInput } from '@/components/datetime-input';
import { AreaPicker } from '@/components/area-picker';
import type { BadgeTone } from '@/lib/admin-utils';

const STATUS_C: Record<PromotionCampaign['status'], { key: MessageKey; tone: BadgeTone }> = {
  draft: { key: 'pro.camp.status.draft', tone: 'gray' }, active: { key: 'pro.camp.status.active', tone: 'success' },
  ended: { key: 'pro.camp.status.ended', tone: 'gray' }, cancelled: { key: 'pro.camp.status.cancelled', tone: 'danger' },
};

/** Campaigns: a named, time-boxed push; the promotions that belong to it; start, end or cancel it. */
export default function CampaignsPage() {
  const { token, user, t, hasPermission } = useApp();
  const canManage = hasPermission('campaigns');
  const [rows, setRows] = useState<PromotionCampaign[] | null>(null);
  const [areas, setAreas] = useState<GeoArea[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setOpenId(new URLSearchParams(window.location.search).get('item'));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const open = (id: string | null) => { history.pushState(null, '', id ? `?item=${encodeURIComponent(id)}` : window.location.pathname); setOpenId(id); };

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { setRows((await api.promotionCampaigns(token)).items); }
    catch (err) { setError(t(errorKey(err))); setRows([]); }
  }, [token, t]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (token) api.geoAreas(token).then(r => setAreas(r.areas)).catch(() => setAreas([])); }, [token]);
  if (!token || user?.userType !== 'admin') return null;

  if (openId) return <CampaignView id={openId} areas={areas} canManage={canManage} onBack={() => { open(null); load(); }} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('pro.camp.title')} description={t('pro.camp.description')}
        actions={(
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />{t('mod.refresh')}</Button>
            {canManage && <Button size="sm" onClick={() => setDialog('create')} data-testid="campaign-new"><Plus className="h-4 w-4" />{t('pro.camp.new')}</Button>}
          </div>
        )} />
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-[var(--color-fg-quaternary)]" data-testid="campaign-empty">{t('pro.camp.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm" data-testid="campaign-table">
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]"><tr className="border-b border-[var(--color-border-secondary)]">
                  <th className="px-4 py-2.5 font-medium">{t('mod.col.name')}</th><th className="px-4 py-2.5 font-medium">{t('pro.col.period')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('pro.camp.promotions')}</th><th className="px-4 py-2.5 font-medium">{t('pro.col.status')}</th></tr></thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {rows.map(c => (
                    <tr key={c.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => open(c.id)} data-testid={`campaign-row-${c.id}`}>
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">{dateTime(c.startsAt)}<br />→ {dateTime(c.endsAt)}</td>
                      <td className="px-4 py-3 tabular-nums">{c.promotionCount ?? 0}</td>
                      <td className="px-4 py-3"><Badge tone={STATUS_C[c.status].tone} dot>{t(STATUS_C[c.status].key)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {dialog === 'create' && <CampaignDialog areas={areas} onClose={() => setDialog(null)} onDone={async c => { setDialog(null); await load(); open(c.id); }} />}
    </div>
  );
}

function CampaignView({ id, areas, canManage, onBack }: { id: string; areas: GeoArea[]; canManage: boolean; onBack: () => void }) {
  const { token, t, hasPermission } = useApp();
  const [data, setData] = useState<{ campaign: PromotionCampaign; promotions: Promotion[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await api.promotionCampaign(token, id)); } catch (err) { setError(t(errorKey(err))); }
  }, [token, id, t]);
  useEffect(() => { load(); }, [load]);

  // Performance over the last 30 days; a missing permission (403) just hides the section.
  const canSeePerformance = hasPermission('promotion_analytics');
  const [perf, setPerf] = useState<CampaignAnalytics | null>(null);
  useEffect(() => {
    if (!token || !canSeePerformance) return;
    let live = true;
    const to = eatToday();
    api.campaignAnalytics(token, id, { from: addDays(to, -29), to }).then(r => { if (live) setPerf(r?.totals ? r : null); }).catch(() => { if (live) setPerf(null); });
    return () => { live = false; };
  }, [token, id, canSeePerformance]);

  const act = async (action: 'start' | 'end' | 'cancel', why?: string) => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const out = await api.promotionCampaignAction(token, id, action, why);
      setNotice(out.openPromotions.length ? `${t('pro.saved')} ${t('pro.camp.openPromotions').replace('{count}', String(out.openPromotions.length))}` : t('pro.saved'));
      setDialog(null); setReason('');
      await load();
    } catch (err) { setError(t(errorKey(err))); }
    setBusy(false);
  };

  const c = data?.campaign;
  return (
    <div className="space-y-6" data-testid="campaign-detail">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)]" data-testid="campaign-back"><ArrowLeft className="h-4 w-4" />{t('pro.back')}</button>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!data && !error && <Spinner className="h-6 w-6" />}
      {c && data && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold" data-testid="campaign-name">{c.name}</h1>
              {c.description && <p className="text-sm text-[var(--color-fg-tertiary)]">{c.description}</p>}
              <p className="mt-1 text-sm text-[var(--color-fg-tertiary)]">{dateTime(c.startsAt)} → {dateTime(c.endsAt)} · {scopeSummary(c.geoScope, areas, t('pro.everywhere'))}</p>
              {c.statusReason && <p className="mt-1 text-sm">{c.statusReason}</p>}
            </div>
            <Badge tone={STATUS_C[c.status].tone} dot><span data-testid="campaign-status">{t(STATUS_C[c.status].key)}</span></Badge>
          </div>
          {canManage && (c.status === 'draft' || c.status === 'active') && (
            <div className="flex flex-wrap gap-2">
              {c.status === 'draft' && <Button size="sm" onClick={() => act('start')} disabled={busy} data-testid="campaign-start">{t('pro.camp.start')}</Button>}
              {c.status === 'active' && <Button size="sm" onClick={() => act('end')} disabled={busy} data-testid="campaign-end">{t('pro.camp.end')}</Button>}
              <Button size="sm" variant="secondary" onClick={() => setDialog('edit')} data-testid="campaign-edit">{t('pro.action.edit')}</Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog('cancel')} data-testid="campaign-cancel">{t('pro.action.cancel')}</Button>
            </div>
          )}
          {canSeePerformance && perf && (
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{t('pan.campaign.title')}</h2>
                <Link href={`/admin/promotion-analytics?campaignId=${encodeURIComponent(id)}`} className="text-sm text-[var(--color-fg-brand)] hover:underline" data-testid="campaign-performance-link">{t('pan.campaign.perPromotion')}</Link>
              </CardHeader>
              <CardContent className="space-y-4" data-testid="campaign-performance">
                <p className="text-xs text-[var(--color-fg-quaternary)]">{t('pan.last30')}</p>
                <MetricTiles totals={perf.totals} testId="campaign-performance-tiles" />
                <NotTrackedNotice items={perf.notTracked} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><h2 className="font-semibold">{t('pro.camp.promotions')}</h2></CardHeader>
            <CardContent className="p-0">
              {data.promotions.length === 0 ? <p className="p-6 text-sm text-[var(--color-fg-quaternary)]">{t('pro.camp.noPromotions')}</p> : (
                <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="campaign-promotions">
                  {data.promotions.map(p => (
                    <li key={p.id}>
                      <a className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-[var(--color-bg-secondary)]" href={`/admin/promotions/?item=${encodeURIComponent(p.id)}`}>
                        <span><span className="font-medium">{p.entity?.name ?? p.entityId}</span> <span className="text-xs text-[var(--color-fg-quaternary)]">{t(ENTITY_TYPE_KEY[p.entityType])} · {t(TYPE_KEY[p.type])} · {p.placements.map(pl => t(PLACEMENT_KEY[pl])).join(', ')}</span></span>
                        <Badge tone={STATUS_TONE[p.effectiveStatus]} dot>{t(STATUS_KEY[p.effectiveStatus])}</Badge>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {dialog === 'edit' && <CampaignDialog campaign={c} areas={areas} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); setNotice(t('pro.saved')); await load(); }} />}
          {dialog === 'cancel' && (
            <Dialog open onClose={() => setDialog(null)} title={t('pro.camp.cancelTitle')} description={t('pro.camp.cancelHint')} size="sm">
              <form onSubmit={e => { e.preventDefault(); act('cancel', reason); }} className="space-y-4" data-testid="campaign-cancel-dialog">
                <Field label={t('pro.reason')}><textarea className="ui-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} required maxLength={1000} data-testid="campaign-reason" /></Field>
                <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
                  <Button type="button" variant="secondary" onClick={() => setDialog(null)}>{t('pro.cancel')}</Button>
                  <Button type="submit" disabled={busy || !reason.trim()} data-testid="campaign-cancel-confirm">{t('pro.confirm')}</Button>
                </div>
              </form>
            </Dialog>
          )}
        </>
      )}
    </div>
  );
}

function CampaignDialog({ campaign, areas, onClose, onDone }: { campaign?: PromotionCampaign; areas: GeoArea[]; onClose: () => void; onDone: (c: PromotionCampaign) => void }) {
  const { token, t } = useApp();
  const [name, setName] = useState(campaign?.name ?? '');
  const [description, setDescription] = useState(campaign?.description ?? '');
  const [startsAt, setStartsAt] = useState(campaign?.startsAt ?? '');
  const [endsAt, setEndsAt] = useState(campaign?.endsAt ?? '');
  const [areaIds, setAreaIds] = useState<string[]>(campaign?.geoScope?.areaIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = !!name.trim() && !!startsAt && !!endsAt && new Date(endsAt) > new Date(startsAt);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !ok) return;
    setBusy(true); setError(null);
    const body = { name: name.trim(), description: description.trim(), startsAt, endsAt, geoScope: { areaIds } };
    try {
      onDone(campaign ? (await api.updatePromotionCampaign(token, campaign.id, body)).campaign : (await api.createPromotionCampaign(token, body)).campaign);
    } catch (err) {
      const b = errorBody<{ promotionIds?: string[] }>(err);
      setError(t(errorKey(err)) + (b?.promotionIds?.length ? ` (${b.promotionIds.length})` : ''));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={campaign ? t('pro.camp.edit') : t('pro.camp.new')} size="md">
      <form onSubmit={submit} className="space-y-4" data-testid="campaign-dialog">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('mod.col.name')}><input className="ui-input" value={name} onChange={e => setName(e.target.value)} maxLength={120} required data-testid="campaign-name-input" /></Field>
        <Field label={t('pro.wiz.commercial.notes')}><textarea className="ui-input" rows={2} value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('pro.wiz.schedule.start')}><DateTimeInput value={startsAt} onChange={setStartsAt} data-testid="campaign-start-input" /></Field>
          <Field label={t('pro.wiz.schedule.end')}><DateTimeInput value={endsAt} onChange={setEndsAt} min={startsAt || undefined} data-testid="campaign-end-input" /></Field>
        </div>
        <Field label={t('pro.wiz.targeting.areas')} hint={t('pro.wiz.targeting.areasHint')}><AreaPicker areas={areas} value={areaIds} onChange={setAreaIds} /></Field>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>{t('pro.cancel')}</Button>
          <Button type="submit" disabled={busy || !ok} data-testid="campaign-save">{t('pro.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
