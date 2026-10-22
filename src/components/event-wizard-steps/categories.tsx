'use client';
import { fmt, newCategory, type CategoryForm } from '@/lib/events';
import { Button, Checkbox } from '@/components/shared';
import { CountedTextarea, DateField, RowCard, TextField, useErrorText, useFocusNewRow, type StepProps } from './fields';
import { useApp } from '../../../app/providers';

/** Step 3 Categories (spec §6.2): 1–12 repeatable rows. */
export function CategoriesStep({ form, update, errors, readOnly }: StepProps) {
  const { t } = useApp();
  const errText = useErrorText();
  useFocusNewRow(form.categories);
  const set = (i: number, patch: Partial<CategoryForm>) => update(f => ({ categories: f.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const remove = (i: number) => {
    update(f => ({ categories: f.categories.filter((_, j) => j !== i) }));
    const prev = form.categories[i - 1];
    setTimeout(() => { (prev ? document.querySelector<HTMLElement>(`[data-row="${prev.uid}"] input`) : document.querySelector<HTMLElement>('[data-testid="ev-add-category"]'))?.focus(); }, 0);
  };
  const name = (c: CategoryForm, i: number) => c.name.trim() || fmt(t('events.categories.unnamed'), { n: i + 1 });
  return (
    <div className="space-y-4">
      {errors.categories && <p className="text-sm text-[var(--color-error-700)]" id="ev-categories" tabIndex={-1}>{errText(errors.categories)}</p>}
      {form.categories.map((c, i) => {
        const p = `categories.${i}`;
        return (
          <div key={c.uid} data-row={c.uid}>
            <RowCard title={name(c, i)} readOnly={readOnly} onRemove={() => remove(i)} removeLabel={fmt(t('events.categories.remove'), { name: name(c, i) })} testId={`ev-category-${i}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField path={`${p}.name`} label={t('events.categories.name')} value={c.name} onChange={v => set(i, { name: v })} error={errors[`${p}.name`]} required readOnly={readOnly} maxLength={60} />
                <TextField path={`${p}.distanceKm`} label={t('events.categories.distance')} value={c.distanceKm} onChange={v => set(i, { distanceKm: v })} error={errors[`${p}.distanceKm`]} required readOnly={readOnly} inputMode="decimal" />
                <DateField path={`${p}.startsAt`} label={t('events.categories.start')} value={c.startsAt} onChange={v => set(i, { startsAt: v })} error={errors[`${p}.startsAt`]} readOnly={readOnly} timezone={form.timezone} />
                <div className="space-y-1">
                  <TextField path={`${p}.capacity`} label={t('events.categories.capacity')} value={c.noLimit ? '' : c.capacity} onChange={v => set(i, { capacity: v })} error={errors[`${p}.capacity`]} readOnly={readOnly || c.noLimit} inputMode="numeric" />
                  <Checkbox label={t('events.categories.noLimit')} checked={c.noLimit} onChange={e => set(i, { noLimit: e.target.checked })} disabled={readOnly} />
                </div>
                <CountedTextarea path={`${p}.eligibilityEn`} label={t('events.categories.eligibilityEn')} value={c.eligibilityEn} onChange={v => set(i, { eligibilityEn: v })} error={errors[`${p}.eligibilityEn`]} readOnly={readOnly} rows={3} max={500} />
                <CountedTextarea path={`${p}.eligibilitySw`} label={t('events.categories.eligibilitySw')} value={c.eligibilitySw} onChange={v => set(i, { eligibilitySw: v })} error={errors[`${p}.eligibilitySw`]} readOnly={readOnly} rows={3} max={500} />
                <TextField path={`${p}.minAge`} label={t('events.categories.minAge')} value={c.minAge} onChange={v => set(i, { minAge: v })} error={errors[`${p}.minAge`]} readOnly={readOnly} inputMode="numeric" hint={t('events.categories.minAgeHint')} />
              </div>
            </RowCard>
          </div>
        );
      })}
      {!readOnly && form.categories.length < 12 && (
        <Button type="button" variant="secondary" onClick={() => update(f => ({ categories: [...f.categories, newCategory()] }))} data-testid="ev-add-category">{t('events.categories.add')}</Button>
      )}
    </div>
  );
}
