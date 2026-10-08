'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, PlacementLimit } from '@/lib/api';
import { PLACEMENTS, PLACEMENT_KEY, TYPE_KEY, errorKey } from '@/lib/promotions';
import { Alert, Badge, Button, Card, CardContent, Field, PageHeader, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';

/** How many promotions each placement holds, how hard a promotion may push, and how ties rotate. */
export default function PromotionLimitsPage() {
  const { token, user, t, hasPermission } = useApp();
  const [rows, setRows] = useState<PlacementLimit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState<PlacementLimit | null>(null);
  const canEdit = hasPermission('campaigns');

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { setRows((await api.placementLimits(token)).limits); }
    catch (err) { setError(t(errorKey(err))); setRows([]); }
  }, [token, t]);
  useEffect(() => { load(); }, [load]);
  if (!token || user?.userType !== 'admin') return null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('pro.lim.title')} description={t('pro.lim.description')}
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />{t('mod.refresh')}</Button>} />
      {error && <Alert tone="error"><span className="flex flex-wrap items-center justify-between gap-2">{error}<Button size="sm" variant="secondary" onClick={load} data-testid="limits-retry">{t('pro.retry')}</Button></span></Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!canEdit && <Alert tone="info">{t('pro.lim.viewOnly')}</Alert>}
      {rows == null ? <Spinner className="h-6 w-6" /> : (error && rows.length === 0) ? null : PLACEMENTS.map(pl => (
        <Card key={pl}>
          <CardContent className="p-0">
            <h2 className="border-b border-[var(--color-border-secondary)] px-4 py-3 font-semibold">{t(PLACEMENT_KEY[pl])}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm" data-testid={`limits-${pl}`}>
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                  <tr><th className="px-4 py-2 font-medium">{t('pro.col.type')}</th><th className="px-4 py-2 font-medium">{t('pro.lim.slots')}</th>
                    <th className="px-4 py-2 font-medium">{t('pro.lim.boost')}</th><th className="px-4 py-2 font-medium">{t('pro.lim.rotation')}</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {rows.filter(r => r.placement === pl).map(r => (
                    <tr key={r.promotionType} data-testid={`limit-${pl}-${r.promotionType}`}>
                      <td className="px-4 py-2.5">{t(TYPE_KEY[r.promotionType])}</td>
                      <td className="px-4 py-2.5 tabular-nums">{r.used} / {r.maxSlots} <Badge tone={r.source === 'config' ? 'brand' : 'gray'}>{r.source === 'config' ? t('pro.lim.custom') : t('pro.lim.default')}</Badge></td>
                      <td className="px-4 py-2.5 tabular-nums">{Math.round((r.maxBoostFraction ?? 0) * 100)}%</td>
                      <td className="px-4 py-2.5 text-xs">{r.rotationMode === 'none' ? t('pro.lim.noRotation') : t('pro.lim.every').replace('{minutes}', String(r.rotationWindowMinutes))}</td>
                      <td className="px-4 py-2.5 text-right">{canEdit && <Button size="sm" variant="secondary" onClick={() => { setNotice(null); setEdit(r); }} data-testid={`limit-edit-${pl}-${r.promotionType}`}>{t('pro.action.edit')}</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
      {edit && <LimitDialog row={edit} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); setNotice(t('pro.saved')); await load(); }} />}
    </div>
  );
}

function LimitDialog({ row, onClose, onDone }: { row: PlacementLimit; onClose: () => void; onDone: () => void }) {
  const { token, t } = useApp();
  const [slots, setSlots] = useState(String(row.maxSlots));
  const [boost, setBoost] = useState(String(Math.round(row.maxBoostFraction * 100)));
  const [mode, setMode] = useState<'none' | 'time_slice'>(row.rotationMode);
  const [minutes, setMinutes] = useState(String(row.rotationWindowMinutes));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true); setError(null);
    try {
      await api.setPlacementLimit(token, row.placement, row.promotionType, {
        maxSlots: Number(slots), maxBoostFraction: Number(boost) / 100, rotationMode: mode, rotationWindowMinutes: Number(minutes),
      });
      onDone();
    } catch (err) { setError(t(errorKey(err))); setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={`${t(PLACEMENT_KEY[row.placement])} · ${t(TYPE_KEY[row.promotionType])}`} description={t('pro.lim.editHint')} size="sm">
      <form onSubmit={submit} className="space-y-4" data-testid="limit-dialog">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('pro.lim.slots')}><input className="ui-input" type="number" min={0} max={1000} value={slots} onChange={e => setSlots(e.target.value)} data-testid="limit-slots" /></Field>
        <Field label={t('pro.lim.boostPct')} hint={t('pro.lim.boostHint')}><input className="ui-input" type="number" min={0} max={100} value={boost} onChange={e => setBoost(e.target.value)} data-testid="limit-boost" /></Field>
        <Field label={t('pro.lim.rotation')}>
          <select className="ui-input" value={mode} onChange={e => setMode(e.target.value as 'none' | 'time_slice')}>
            <option value="time_slice">{t('pro.lim.rotate')}</option><option value="none">{t('pro.lim.noRotation')}</option>
          </select>
        </Field>
        {mode === 'time_slice' && <Field label={t('pro.lim.window')}><input className="ui-input" type="number" min={1} value={minutes} onChange={e => setMinutes(e.target.value)} /></Field>}
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>{t('pro.cancel')}</Button>
          <Button type="submit" disabled={busy} data-testid="limit-save">{t('pro.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
