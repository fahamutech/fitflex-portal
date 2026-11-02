'use client';
// Events S7: a labelled on/off switch with a 44 px target. A real checkbox with role="switch", so keyboard and screen readers work without extra code.
import type { ReactNode } from 'react';

export function SwitchControl({ checked, onChange, label, help, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode; disabled?: boolean; testId?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
      <input type="checkbox" role="switch" className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-brand-600)]" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} data-testid={testId} />
      <span className="min-w-0 text-sm">
        <span className="block font-medium text-[var(--color-fg-primary)]">{label}</span>
        {help && <span className="block text-[var(--color-fg-quaternary)]">{help}</span>}
      </span>
    </label>
  );
}
