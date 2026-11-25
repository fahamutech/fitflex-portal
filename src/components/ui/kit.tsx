'use client';
/*
 * Phase 2B S1: layout pieces the page slices (S2 onward) build with.
 * Presentation only: no data loading, no strings of their own (every label is passed in, so the
 * caller supplies English and Swahili), no new dependencies.
 * Import from '@/components/shared'.
 */
import { ButtonHTMLAttributes, HTMLAttributes, ReactNode, useId } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/* ── Toolbar: one row for search, filters and page actions; wraps on narrow screens ── */
export function Toolbar({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
    </div>
  );
}

/* ── FilterChip: a pressable filter. Selected = forest fill, so it never competes with the lime
      primary button. State is exposed with aria-pressed, not colour alone. ── */
export function FilterChip({
  selected = false,
  count,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; count?: number }) {
  return (
    <button
      type="button"
      {...rest}
      aria-pressed={selected}
      className={cn(
        'hit-target inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-forest)] focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-[var(--color-forest)] bg-[var(--color-forest)] text-white'
          : 'border-[var(--color-border-input)] bg-[var(--color-bg-primary)] text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-secondary)]',
        className,
      )}
    >
      {children}
      {typeof count === 'number' && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

/* ── Tabs: splits a page that holds several tables. The caller owns the state. ── */
export type TabItem<K extends string = string> = { key: K; label: ReactNode; count?: number };

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  idBase,
  className,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Names the tab list for assistive tech. */
  label: string;
  /** Prefix shared with TabPanel so each tab and its panel point at each other. */
  idBase: string;
  className?: string;
}) {
  const move = (from: number, step: number) => {
    const next = items[(from + step + items.length) % items.length];
    onChange(next.key);
    // The tab exists already (only its selected state changes), so focus can move at once.
    document.getElementById(`${idBase}-tab-${next.key}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-[var(--radius-2xl)] bg-[var(--color-bg-tertiary)] p-1', className)}>
      {items.map((item, i) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            id={`${idBase}-tab-${item.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${item.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i, 1); }
              if (e.key === 'ArrowLeft')  { e.preventDefault(); move(i, -1); }
            }}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-forest)] focus-visible:ring-offset-2',
              selected
                ? 'bg-[var(--color-bg-primary)] text-[var(--color-fg-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)]',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && <span className="tabular-nums">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, tabKey, active, children, className }: { idBase: string; tabKey: string; active: boolean; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${tabKey}`} aria-labelledby={`${idBase}-tab-${tabKey}`} hidden={!active} className={className}>
      {active ? children : null}
    </div>
  );
}

/* ── KeyValueList: record detail as label and value pairs; one column on phones ── */
export function KeyValueList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]', className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-[var(--color-fg-tertiary)]">{item.label}</dt>
          <dd className="m-0 font-semibold text-[var(--color-fg-primary)] [overflow-wrap:anywhere] max-sm:mb-2">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── FeatureCard: the one lime card on a page (the thing that matters most right now).
      Use at most one per page; everything inside it is forest text or a white tile. ── */
export function FeatureCard({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-4 rounded-[var(--radius-2xl)] bg-[var(--color-lime)] p-5 text-[var(--color-on-lime)]', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-xl font-semibold leading-7">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ── QueueCard: a "needs attention" tile. A count never stands alone: it carries its label and,
      when known, the age of the oldest item. Zero is drawn quieter, not hidden. ── */
export function QueueCard({ href, count, label, note }: { href: string; count: number; label: ReactNode; note?: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-[5.75rem] flex-col gap-1 rounded-[var(--radius-xl)] px-4 py-3.5 text-[var(--color-fg-primary)] transition-shadow hover:shadow-[var(--shadow-md)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-forest)] focus-visible:ring-offset-2',
        count > 0 ? 'bg-[var(--color-bg-primary)]' : 'bg-white/55',
      )}
    >
      <span className="text-[1.75rem] font-extrabold leading-[2.125rem] tracking-tight tabular-nums">{count}</span>
      <span className="text-sm font-semibold">{label}</span>
      {note && <span className="text-[0.8125rem] leading-[1.125rem] text-[var(--color-fg-tertiary)]">{note}</span>}
    </Link>
  );
}

/* ── FormSection: a titled block of a long form ── */
export function FormSection({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-4 border-t border-[var(--color-border-secondary)] pt-6 first:border-t-0 first:pt-0', className)}>
      <div>
        <h2 id={headingId} className="text-base font-semibold text-[var(--color-fg-primary)]">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-[var(--color-fg-tertiary)]">{description}</p>}
      </div>
      {children}
    </section>
  );
}
