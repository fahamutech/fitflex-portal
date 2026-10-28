'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';
import type { EventRefundPolicy, EventsOptions } from '@/lib/api';
import { eventTime, fieldId, fmt, formatShillings, parseShillings, tzAbbr, type EventForm, type Errors, type FieldError } from '@/lib/events';
import { Button, Field, Input, Textarea } from '@/components/shared';
import { DateTimeInput } from '@/components/datetime-input';
import { useApp } from '../../../app/providers';

/** What every wizard step receives (spec §6.2). `update` patches the form; `errors` are already filtered to what should show. */
export type StepProps = {
  form: EventForm;
  update: (patch: Partial<EventForm> | ((f: EventForm) => Partial<EventForm>)) => void;
  errors: Errors;
  readOnly: boolean;
  token: string;
  options: EventsOptions | null;
  /** The saved refund policy with the server-built sentence (S4 review item 15). */
  savedPolicy?: EventRefundPolicy | null;
  /** Explicit save hooks (the title creates the draft on blur, §6.2). */
  onTitleBlur?: () => void;
};

export function useErrorText() {
  const { t } = useApp();
  return (e: FieldError | undefined) => (e ? fmt(t(e.key), e.vars ?? {}) : undefined);
}

/** A labelled text input bound to a form path (id = fieldId(path), so the review list can focus it). */
export function TextField({ path, label, value, onChange, error, hint, required, readOnly, type = 'text', maxLength, inputMode, placeholder, onBlur, testId }: {
  path: string; label: ReactNode; value: string; onChange: (v: string) => void; error?: FieldError; hint?: ReactNode; required?: boolean; readOnly?: boolean;
  type?: string; maxLength?: number; inputMode?: 'numeric' | 'tel' | 'url' | 'email' | 'decimal' | 'text'; placeholder?: string; onBlur?: () => void; testId?: string;
}) {
  const errText = useErrorText();
  return (
    <Field label={label} error={errText(error)} hint={hint} required={required}>
      <Input id={fieldId(path)} type={type} value={value} onChange={e => onChange(e.target.value)} disabled={readOnly} maxLength={maxLength} inputMode={inputMode} placeholder={placeholder} onBlur={onBlur} data-testid={testId ?? fieldId(path)} />
    </Field>
  );
}

/** A textarea with a character counter (descriptions, terms). */
export function CountedTextarea({ path, label, value, onChange, error, hint, required, readOnly, rows = 6, max, testId }: {
  path: string; label: ReactNode; value: string; onChange: (v: string) => void; error?: FieldError; hint?: ReactNode; required?: boolean; readOnly?: boolean; rows?: number; max: number; testId?: string;
}) {
  const { t } = useApp();
  const errText = useErrorText();
  const counter = fmt(t('events.basics.counter'), { n: value.length, max });
  return (
    <Field label={label} error={errText(error)} hint={<>{hint ? <>{hint} · </> : null}<span aria-live="polite">{counter}</span></>} required={required}>
      <Textarea id={fieldId(path)} rows={rows} value={value} onChange={e => onChange(e.target.value)} disabled={readOnly} data-testid={testId ?? fieldId(path)} />
    </Field>
  );
}

/** A date-and-time field in the browser's clock, with the event-timezone reading next to it ("= 06:30 EAT"). */
export function DateField({ path, label, value, onChange, error, hint, required, readOnly, timezone, testId }: {
  path: string; label: ReactNode; value: string; onChange: (iso: string) => void; error?: FieldError; hint?: ReactNode; required?: boolean; readOnly?: boolean; timezone: string; testId?: string;
}) {
  const { t, locale } = useApp();
  const errText = useErrorText();
  const inTz = value ? fmt(t('events.basics.inEventTz'), { time: eventTime(value, timezone, locale), tz: tzAbbr(timezone, new Date(value)) }) : '';
  return (
    <Field label={label} error={errText(error)} hint={<>{hint}{hint && inTz ? ' · ' : ''}<span aria-live="polite" data-testid={`${fieldId(path)}-tz`}>{inTz}</span></>} required={required}>
      {readOnly
        ? <Input id={fieldId(path)} value={value ? `${eventTime(value, timezone, locale)} ${tzAbbr(timezone, new Date(value))}` : ''} disabled readOnly />
        : <DateTimeInput id={fieldId(path)} value={value} onChange={onChange} data-testid={testId ?? fieldId(path)} />}
    </Field>
  );
}

/** Whole-shilling money input: thousands separators on blur, `inputMode=numeric`, hint about decimals (§6.3). */
export function MoneyField({ path, label, value, onChange, error, readOnly, testId }: {
  path: string; label: ReactNode; value: string; onChange: (v: string) => void; error?: FieldError; readOnly?: boolean; testId?: string;
}) {
  const { t } = useApp();
  const errText = useErrorText();
  const parsed = parseShillings(value);
  const free = parsed === 0;
  return (
    <Field label={label} error={errText(error)} hint={<>{t('events.tickets.priceHint')}{free ? <> · <span className="font-medium text-[var(--color-success-700)]">{t('events.tickets.free')}</span></> : null}</>} required>
      <Input id={fieldId(path)} value={value} inputMode="numeric" disabled={readOnly} data-testid={testId ?? fieldId(path)}
        onChange={e => onChange(e.target.value)}
        onBlur={() => { const n = parseShillings(value); if (n != null && !Number.isNaN(n)) onChange(formatShillings(n)); }} />
    </Field>
  );
}

/** A repeatable row card: labelled by its name field, with a remove button that moves focus sensibly (§6.3). */
export function RowCard({ title, onRemove, removeLabel, readOnly, children, testId }: { title: string; onRemove?: () => void; removeLabel: string; readOnly?: boolean; children: ReactNode; testId?: string }) {
  const headingId = useRef(`row-${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] p-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="text-sm font-semibold text-[var(--color-fg-primary)]">{title}</h3>
        {!readOnly && onRemove && <Button type="button" variant="ghost" size="sm" aria-label={removeLabel} onClick={onRemove}>{removeLabel}</Button>}
      </div>
      {children}
    </section>
  );
}

/** Moves focus to the first field of the newest row after "Add" (§6.3). */
export function useFocusNewRow<T extends { uid: string }>(rows: T[]) {
  const prev = useRef(rows.length);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (rows.length > prev.current) setPending(rows[rows.length - 1].uid);
    prev.current = rows.length;
  }, [rows]);
  useEffect(() => {
    if (!pending) return;
    const el = document.querySelector<HTMLElement>(`[data-row="${pending}"] input, [data-row="${pending}"] textarea, [data-row="${pending}"] select`);
    el?.focus();
    setPending(null);
  }, [pending]);
}

