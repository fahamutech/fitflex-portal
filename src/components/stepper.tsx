'use client';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A row of numbered steps. A step is clickable once it has been reached
 * (`maxReached`), so an admin can go back to change an earlier answer but is
 * not let past a step that is not valid yet.
 */
export function Stepper({ steps, current, maxReached, onStep }: {
  steps: Array<{ key: string; label: string }>; current: number; maxReached: number; onStep: (index: number) => void;
}) {
  return (
    <div>
    <ol className="flex gap-1 sm:flex-wrap sm:gap-x-1 sm:gap-y-2" aria-label="Steps" data-testid="stepper">
      {steps.map((s, i) => {
        const done = i < current;
        const reachable = i <= maxReached;
        return (
          <li key={s.key} className="min-w-0 flex-1 sm:flex-none">
            <button type="button" disabled={!reachable} onClick={() => onStep(i)} aria-current={i === current ? 'step' : undefined}
              data-testid={`step-${s.key}`} aria-label={`${i + 1}. ${s.label}`}
              className={cn(
                'flex h-10 w-full items-center sm:w-auto justify-center gap-2 rounded-full text-sm transition-colors sm:px-3',
                i === current ? 'bg-[var(--color-brand-600)] font-semibold text-white'
                  : reachable ? 'bg-[var(--color-bg-secondary)] text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]'
                    : 'text-[var(--color-fg-quaternary)]',
              )}>
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums',
                i === current ? 'bg-white/25' : done ? 'bg-[var(--color-brand-600)] text-white' : 'bg-[var(--color-bg-tertiary)]')}>
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
    <p className="mt-2 text-sm font-medium sm:hidden" aria-hidden data-testid="stepper-current">{current + 1} / {steps.length} · {steps[current]?.label}</p>
    </div>
  );
}
