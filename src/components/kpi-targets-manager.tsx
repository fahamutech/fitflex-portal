'use client';
// FR-K01: KPI targets for Programmes & Nutrition and the WhatsApp funnel. Admins with the `analytics`
// scope see every target, change a target or baseline, and confirm it (no longer an assumption).
// Every change is written to the audit log by the backend.
import { useCallback, useEffect, useState } from 'react';
import { Pencil, RefreshCw } from 'lucide-react';
import { useApp } from '../../app/providers';
import { ApiError } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { KPI_RANGE, KpiTarget, kpiTargetsApi, KpiTargetPatch } from '@/lib/kpi-targets';
import { Alert, Badge, Button, Card, CardContent, Field, PageHeader, Spinner } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';

type T = (key: MessageKey) => string;
const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
const kpiName = (t: T, id: string) => t(`kpi.name.${id}` as MessageKey) || id;

/** "25%", "+20%", "25% lower", "+5 points", "400". */
export function kpiValue(t: T, unit: KpiTarget['unit'], n: number | null, locale: string) {
  if (n == null) return '—';
  const abs = Math.abs(n).toLocaleString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { maximumFractionDigits: 2 });
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return fill(t(`kpi.unit.${unit}` as MessageKey), { n: unit === 'percent_change' || unit === 'points' ? abs : (n < 0 ? '−' : '') + abs, sign });
}

const when = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Dar_es_Salaam' }) : '';

export function KpiTargetsManager() {
  const { token, t, locale } = useApp();
  const [rows, setRows] = useState<KpiTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<KpiTarget | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const r = await kpiTargetsApi.list(token);
      setRows(Array.isArray(r?.targets) ? r.targets : []);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? t('kpi.forbidden') : t('kpi.loadError'));
      setRows(prev => prev ?? []);
    }
  }, [token, t]);
  useEffect(() => { void load(); }, [load]);

  const areas = (['programmes', 'whatsapp'] as const).map(area => ({ area, items: (rows ?? []).filter(r => r.area === area) }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('kpi.title')}
        description={t('kpi.description')}
        actions={<Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('kpi.refresh')}</Button>}
      />
      {error && (
        <Alert tone="error">
          <span data-testid="kpi-error">{error}</span>{' '}
          <button className="underline" onClick={() => void load()}>{t('kpi.retry')}</button>
        </Alert>
      )}
      {done && <Alert tone="success"><span data-testid="kpi-done">{done}</span></Alert>}
      {rows === null ? (
        <div className="flex h-40 items-center justify-center" role="status" aria-label={t('kpi.loading')}><Spinner className="h-6 w-6" /></div>
      ) : areas.filter(a => a.items.length).map(({ area, items }) => (
        <Card key={area}>
          <CardContent className="overflow-x-auto p-0">
            <h2 className="px-4 pt-4 text-base font-semibold text-[var(--color-fg-primary)]">{t(`kpi.area.${area}`)}</h2>
            <table className="mt-2 w-full text-sm" data-testid={`kpi-table-${area}`}>
              <thead className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-tertiary)]">
                <tr>
                  {(['kpi', 'baseline', 'draft', 'target', 'status', 'changed'] as const).map(c => (
                    <th key={c} className="px-4 py-3 font-medium">{t(`kpi.col.${c}`)}</th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {items.map(r => (
                  <tr key={r.id} className="border-b border-[var(--color-border-secondary)] last:border-0" data-testid={`kpi-row-${r.id}`}>
                    <td className="px-4 py-3 font-medium text-[var(--color-fg-primary)]">{kpiName(t, r.id)}</td>
                    <td className="px-4 py-3">{r.baseline || '—'}</td>
                    <td className="px-4 py-3 tabular-nums text-[var(--color-fg-tertiary)]">{kpiValue(t, r.unit, r.draftTarget, locale)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums" data-testid={`kpi-target-${r.id}`}>{kpiValue(t, r.unit, r.target, locale)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={r.assumption ? 'warning' : 'success'} dot>{t(r.assumption ? 'kpi.status.assumption' : 'kpi.status.confirmed')}</Badge>
                      {!r.assumption && r.confirmedBy && (
                        <div className="mt-1 text-xs text-[var(--color-fg-tertiary)]">{fill(t('kpi.confirmedBy'), { who: r.confirmedBy, date: when(r.confirmedAt, locale) })}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-fg-tertiary)]">
                      {r.updatedBy ? fill(t('kpi.changedBy'), { who: r.updatedBy, date: when(r.updatedAt, locale) }) : t('kpi.never')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" size="sm" onClick={() => { setDone(null); setEditing(r); }} data-testid={`kpi-edit-${r.id}`}
                        aria-label={`${t('kpi.edit')}: ${kpiName(t, r.id)}`}><Pencil className="h-4 w-4" />{t('kpi.edit')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
      {editing && (
        <KpiEdit
          row={editing} t={t}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); setDone(t('kpi.saved')); await load(); }}
        />
      )}
    </div>
  );
}

function KpiEdit({ row, t, onClose, onSaved }: { row: KpiTarget; t: T; onClose: () => void; onSaved: () => Promise<void> }) {
  const { token } = useApp();
  const range = KPI_RANGE[row.unit];
  const [target, setTarget] = useState(String(row.target));
  const [baseline, setBaseline] = useState(row.baseline ?? '');
  const [confirmed, setConfirmed] = useState(!row.assumption);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetError = fill(t('kpi.err.target'), { min: range.min, max: range.max });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const n = Number(target);
    if (target.trim() === '' || !Number.isFinite(n) || n < range.min || n > range.max || Math.round(n * 100) !== n * 100) {
      setError(targetError);
      return;
    }
    const body: KpiTargetPatch = {};
    if (n !== row.target) body.target = n;
    if ((baseline.trim() || null) !== (row.baseline ?? null)) body.baseline = baseline.trim() || null;
    if (confirmed === row.assumption) body.confirmed = confirmed;
    if (!Object.keys(body).length) { setError(t('kpi.err.nothing')); return; }
    setBusy(true);
    setError(null);
    try {
      await kpiTargetsApi.update(token, row.id, body);
      await onSaved();
    } catch (err) {
      const b = (err instanceof ApiError ? err.body : null) as { error?: string; field?: string } | null;
      setError(b?.field === 'target' ? targetError : b?.field === 'baseline' ? t('kpi.err.baseline')
        : b?.error === 'nothing_to_change' ? t('kpi.err.nothing') : err instanceof ApiError && err.status === 403 ? t('kpi.forbidden') : t('kpi.err.generic'));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={fill(t('kpi.editTitle'), { name: kpiName(t, row.id) })} size="md">
      <form onSubmit={save} className="space-y-4" data-testid="kpi-form">
        {error && <Alert tone="error"><span data-testid="kpi-form-error">{error}</span></Alert>}
        <Field label={t('kpi.field.target')} hint={fill(t('kpi.field.targetHint'), { min: range.min, max: range.max })}>
          <input className="ui-input" type="number" step="any" inputMode="decimal" value={target}
            onChange={e => setTarget(e.target.value)} data-testid="kpi-field-target" />
        </Field>
        <Field label={t('kpi.field.baseline')} hint={t('kpi.field.baselineHint')}>
          <input className="ui-input" maxLength={40} value={baseline} onChange={e => setBaseline(e.target.value)} data-testid="kpi-field-baseline" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="kpi-field-confirmed" />
          {t('kpi.field.confirmed')}
        </label>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>{t('kpi.cancel')}</Button>
          <Button type="submit" disabled={busy} data-testid="kpi-save">{busy ? t('kpi.saving') : t('kpi.save')}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
