'use client';
import { Field } from '@/components/shared';
import type { TrainerPassConfig, TrainerPassPeriod } from '@/lib/api';

const PERIODS: { id: TrainerPassPeriod; label: string }[] = [
  { id: 'daily', label: 'Daily pass (TZS)' },
  { id: 'weekly', label: 'Weekly pass (TZS)' },
  { id: 'monthly', label: 'Monthly pass (TZS)' },
];

/** Options from the saved config, reading the older single-fee shape too. */
export function trainerPassOptions(config?: TrainerPassConfig | null): Partial<Record<TrainerPassPeriod, number>> {
  if (!config) return {};
  if (config.options) return config.options;
  if (config.period && (config.feeTzs ?? 0) > 0) return { [config.period]: config.feeTzs };
  return {};
}

/** "Enabled + a fee for at least one period" — the rule the form enforces. */
export function trainerPassError(config?: TrainerPassConfig | null): string | null {
  if (!config?.enabled) return null;
  const options = trainerPassOptions(config);
  return PERIODS.some(p => (options[p.id] ?? 0) > 0) ? null : 'Set a fee for at least one period.';
}

/**
 * Trainer pass section of the gym form: the gym sells any of daily / weekly /
 * monthly passes to external trainers. Only trainers see these prices; with
 * no trainer pass, trainers use the gym's member rates.
 */
export function TrainerPassFields({
  value,
  onChange,
  error,
}: {
  value?: TrainerPassConfig | null;
  onChange: (next: TrainerPassConfig) => void;
  error?: string | null;
}) {
  const enabled = value?.enabled === true;
  const options = trainerPassOptions(value);
  const setFee = (period: TrainerPassPeriod, raw: string) => {
    const fee = raw === '' ? 0 : Math.max(0, Number(raw) || 0);
    onChange({ enabled, options: { ...options, [period]: fee } });
  };
  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3">
      <label className="flex items-center gap-3 text-sm text-[var(--color-fg-primary)]">
        <input
          aria-label="Sell trainer passes"
          type="checkbox"
          checked={enabled}
          onChange={e => onChange({ enabled: e.target.checked, options })}
        />
        Sell trainer passes
      </label>
      <p className="text-xs text-[var(--color-fg-tertiary)]">
        Only trainers see these prices. Leave a period empty to not sell it. Without a trainer pass, trainers use the member rates above; trainers linked to this gym train free.
      </p>
      {enabled && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PERIODS.map(p => (
            <Field key={p.id} label={p.label}>
              <input
                aria-label={p.label}
                className="ui-input"
                type="number"
                min={0}
                value={options[p.id] || ''}
                placeholder="Not sold"
                onChange={e => setFee(p.id, e.target.value)}
              />
            </Field>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-[var(--color-error-600)]">{error}</p>}
    </div>
  );
}
