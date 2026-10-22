'use client';
import dynamic from 'next/dynamic';
import { fmt, newPoint, type PointForm } from '@/lib/events';
import { Button, Checkbox, Field } from '@/components/shared';
import { CountedTextarea, DateField, RowCard, TextField, useErrorText, useFocusNewRow, type StepProps } from './fields';
import { useApp } from '../../../app/providers';

const LocationPicker = dynamic(() => import('@/components/location-picker').then(m => ({ default: m.LocationPicker })), {
  ssr: false, loading: () => <div aria-busy="true" className="h-[200px] animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-bg-tertiary)]" />,
});

/** Step 5 Kit & collection points (spec §6.2): off → nothing to collect; on → 1–10 points with 1–5 windows each. */
export function KitStep({ form, update, errors, readOnly }: StepProps) {
  const { t } = useApp();
  const errText = useErrorText();
  useFocusNewRow(form.collectionPoints);
  const set = (i: number, patch: Partial<PointForm>) => update(f => ({ collectionPoints: f.collectionPoints.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const setWindow = (i: number, w: number, patch: Partial<{ opensAt: string; closesAt: string }>) =>
    set(i, { windows: form.collectionPoints[i].windows.map((win, k) => (k === w ? { ...win, ...patch } : win)) });
  const name = (p: PointForm, i: number) => p.name.trim() || fmt(t('events.kit.unnamed'), { n: i + 1 });
  return (
    <div className="space-y-4">
      <Checkbox label={t('events.kit.toggle')} checked={form.hasKit} disabled={readOnly} data-testid="ev-hasKit"
        onChange={e => update(f => ({ hasKit: e.target.checked, collectionPoints: e.target.checked && !f.collectionPoints.length ? [newPoint()] : f.collectionPoints }))} />
      {!form.hasKit ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('events.kit.none')}</p> : (
        <>
          {errors.collectionPoints && <p className="text-sm text-[var(--color-error-700)]" id="ev-collectionPoints" tabIndex={-1}>{errText(errors.collectionPoints)}</p>}
          {form.collectionPoints.map((pt, i) => {
            const p = `collectionPoints.${i}`;
            return (
              <div key={pt.uid} data-row={pt.uid}>
                <RowCard title={name(pt, i)} readOnly={readOnly} onRemove={() => update(f => ({ collectionPoints: f.collectionPoints.filter((_, j) => j !== i) }))} removeLabel={fmt(t('common.remove'), { name: name(pt, i) })} testId={`ev-point-${i}`}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField path={`${p}.name`} label={t('events.kit.pointName')} value={pt.name} onChange={v => set(i, { name: v })} error={errors[`${p}.name`]} required readOnly={readOnly} maxLength={60} />
                    <TextField path={`${p}.address`} label={t('events.venue.address')} value={pt.address} onChange={v => set(i, { address: v })} error={errors[`${p}.address`]} required readOnly={readOnly} maxLength={200} />
                  </div>
                  {!readOnly && (
                    <Field label={t('events.venue.pin')}><div><LocationPicker lat={pt.lat} lng={pt.lng} onChange={(lat, lng) => set(i, { lat, lng })} height="200px" /></div></Field>
                  )}
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('events.kit.windows')}</legend>
                    {errors[`${p}.windows`] && <p className="text-xs text-[var(--color-error-700)]" id={`ev-collectionPoints-${i}-windows`} tabIndex={-1}>{errText(errors[`${p}.windows`])}</p>}
                    {pt.windows.map((w, k) => (
                      <div key={k} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <DateField path={`${p}.windows.${k}.opensAt`} label={t('events.kit.opensAt')} value={w.opensAt} onChange={v => setWindow(i, k, { opensAt: v })} error={errors[`${p}.windows.${k}`]} readOnly={readOnly} timezone={form.timezone} />
                        <DateField path={`${p}.windows.${k}.closesAt`} label={t('events.kit.closesAt')} value={w.closesAt} onChange={v => setWindow(i, k, { closesAt: v })} readOnly={readOnly} timezone={form.timezone} />
                        {!readOnly && pt.windows.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => set(i, { windows: pt.windows.filter((_, j) => j !== k) })} aria-label={fmt(t('common.remove'), { name: `${t('events.kit.windows')} ${k + 1}` })}>{t('organizer.staff.remove.action')}</Button>}
                      </div>
                    ))}
                    {!readOnly && pt.windows.length < 5 && <Button type="button" variant="secondary" size="sm" onClick={() => set(i, { windows: [...pt.windows, { opensAt: '', closesAt: '' }] })}>{t('events.kit.addWindow')}</Button>}
                  </fieldset>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <CountedTextarea path={`${p}.instructionsEn`} label={t('events.kit.instructionsEn')} value={pt.instructionsEn} onChange={v => set(i, { instructionsEn: v })} error={errors[`${p}.instructionsEn`]} required readOnly={readOnly} rows={3} max={600} />
                    <CountedTextarea path={`${p}.instructionsSw`} label={t('events.kit.instructionsSw')} value={pt.instructionsSw} onChange={v => set(i, { instructionsSw: v })} error={errors[`${p}.instructionsSw`]} required readOnly={readOnly} rows={3} max={600} />
                  </div>
                </RowCard>
              </div>
            );
          })}
          {!readOnly && form.collectionPoints.length < 10 && <Button type="button" variant="secondary" onClick={() => update(f => ({ collectionPoints: [...f.collectionPoints, newPoint()] }))} data-testid="ev-add-point">{t('events.kit.add')}</Button>}
          <div className="grid gap-4 sm:grid-cols-2">
            <CountedTextarea path="inclusionsEn" label={t('events.kit.inclusionsEn')} value={form.inclusionsEn} onChange={v => update({ inclusionsEn: v })} error={errors.inclusionsEn} readOnly={readOnly} rows={3} max={600} />
            <CountedTextarea path="inclusionsSw" label={t('events.kit.inclusionsSw')} value={form.inclusionsSw} onChange={v => update({ inclusionsSw: v })} error={errors.inclusionsSw} readOnly={readOnly} rows={3} max={600} />
          </div>
        </>
      )}
    </div>
  );
}
