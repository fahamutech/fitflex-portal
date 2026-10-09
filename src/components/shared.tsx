'use client';
import { ButtonHTMLAttributes, Children, HTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes, TdHTMLAttributes, TextareaHTMLAttributes, ThHTMLAttributes, cloneElement, forwardRef, isValidElement, useId } from 'react';
import { cn } from '@/lib/cn';

/* ─────────────────────────────────────────────
   Button  —  Untitled UI style
   ───────────────────────────────────────────── */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link';
type BtnSize    = 'sm' | 'md' | 'lg';

const btnVariants: Record<BtnVariant, string> = {
  primary:     'bg-[var(--color-brand-600)] text-white border border-[var(--color-brand-600)] hover:bg-[var(--color-brand-700)] hover:border-[var(--color-brand-700)] shadow-[var(--shadow-xs)]',
  secondary:   'bg-[var(--color-bg-primary)] text-[var(--color-fg-secondary)] border border-[var(--color-border-primary)] hover:bg-[var(--color-bg-secondary)] shadow-[var(--shadow-xs)]',
  ghost:       'text-[var(--color-fg-secondary)] border border-transparent hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-fg-primary)]',
  destructive: 'bg-[var(--color-error-600)] text-white border border-[var(--color-error-600)] hover:bg-[var(--color-error-700)] shadow-[var(--shadow-xs)]',
  link:        'text-[var(--color-brand-700)] underline-offset-4 hover:underline border border-transparent p-0 h-auto',
};

const btnSizes: Record<BtnSize, string> = {
  sm: 'h-9 max-sm:h-10 px-3.5 text-sm  gap-1.5',
  md: 'h-10 px-4   text-sm  gap-2',
  lg: 'h-11 px-5   text-base gap-2',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize; /** Shows a spinner, sets aria-busy and disables the button. */ loading?: boolean }
>(({ variant = 'primary', size = 'md', className, loading = false, disabled, children, ...rest }, ref) => (
  <button
    ref={ref}
    {...rest}
    disabled={disabled || loading}
    aria-busy={loading || rest['aria-busy'] || undefined}
    className={cn(
      'inline-flex items-center justify-center font-semibold rounded-[var(--radius-lg)] transition-colors duration-100',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      btnVariants[variant],
      btnSizes[size],
      className,
    )}
  >
    {loading && <Spinner className="h-4 w-4 mr-2 text-current" />}
    {children}
  </button>
));
Button.displayName = 'Button';

/* ─────────────────────────────────────────────
   Card  —  Untitled UI surface card
   ───────────────────────────────────────────── */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        'rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   CardHeader / CardContent / CardFooter
   ───────────────────────────────────────────── */
export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn('flex items-center justify-between gap-3 px-6 py-5 border-b border-[var(--color-border-secondary)]', className)}>
      {children}
    </div>
  );
}

export function CardContent({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn('px-6 py-5', className)}>{children}</div>;
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn('flex items-center gap-3 px-6 py-4 border-t border-[var(--color-border-secondary)]', className)}>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MetricCard  —  Dashboard stat tile
   ───────────────────────────────────────────── */
export function MetricCard({
  label,
  value,
  sub,
  icon,
  trend,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  trend?: { direction: 'up' | 'down' | 'neutral'; label: string };
}) {
  const trendColors = {
    up:      'text-[var(--color-success-700)] bg-[var(--color-success-50)]',
    down:    'text-[var(--color-error-700)]   bg-[var(--color-error-50)]',
    neutral: 'text-[var(--color-fg-tertiary)] bg-[var(--color-bg-tertiary)]',
  };
  return (
    <Card>
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--color-fg-quaternary)] truncate">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-fg-primary)] tabular-nums">
              {value}
            </p>
            {sub && <p className="mt-1 text-sm text-[var(--color-fg-quaternary)] truncate">{sub}</p>}
            {trend && (
              <span className={cn('mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', trendColors[trend.direction])}>
                {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '—'}
                {trend.label}
              </span>
            )}
          </div>
          {icon && (
            <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] text-[var(--color-fg-brand)]">
              {icon}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────
   Badge  —  Untitled UI badge pill
   ───────────────────────────────────────────── */
type BadgeTone = 'default' | 'success' | 'danger' | 'warning' | 'brand' | 'gray';

const badgeTones: Record<BadgeTone, string> = {
  default: 'bg-[var(--color-bg-tertiary)]   text-[var(--color-fg-tertiary)]   ring-[var(--color-border-secondary)]',
  gray:    'bg-[var(--color-gray-100)]      text-[var(--color-gray-700)]      ring-[var(--color-gray-200)]',
  brand:   'bg-[var(--color-brand-50)]      text-[var(--color-brand-700)]     ring-[var(--color-brand-200)]',
  success: 'bg-[var(--color-success-50)]    text-[var(--color-success-700)]   ring-[var(--color-success-200)]',
  danger:  'bg-[var(--color-error-50)]      text-[var(--color-error-700)]     ring-[var(--color-error-200)]',
  warning: 'bg-[var(--color-warning-50)]    text-[var(--color-warning-700)]   ring-[var(--color-warning-200)]',
};

export function Badge({
  children,
  tone = 'default',
  dot = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  const dotColors: Record<BadgeTone, string> = {
    default: 'bg-[var(--color-fg-disabled)]',
    gray:    'bg-[var(--color-gray-500)]',
    brand:   'bg-[var(--color-brand-500)]',
    success: 'bg-[var(--color-success-500)]',
    danger:  'bg-[var(--color-error-500)]',
    warning: 'bg-[var(--color-warning-500)]',
  };
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
      badgeTones[tone],
    )}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotColors[tone])} />}
      {children}
    </span>
  );
}

/* ─────────────────────────────────────────────
   Field + Input  —  form controls
   ───────────────────────────────────────────── */
type ControlAria = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false'; 'aria-required'?: boolean | 'true' | 'false' };

export function Field({
  label,
  children,
  hint,
  error,
  required,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Marks the control aria-required and shows a required asterisk after the label. */
  required?: boolean;
}) {
  // Tie the label to a single native control (or a component that takes an id), so it has an accessible name.
  const id = useId();
  const child = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<ControlAria>) : null;
  // Native controls and the shared Input/Select/Textarea (acceptsId) are real form controls we can wire up.
  const isControl = !!child && ((typeof child.type === 'string' && ['input', 'select', 'textarea'].includes(child.type)) || (child.type as { acceptsId?: boolean }).acceptsId === true);
  const takesId = isControl && !child!.props.id;
  const controlId = takesId ? id : child?.props.id;
  const hintId = !error && hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  let control: ReactNode = children;
  if (child && isControl) {
    const describedBy = [child.props['aria-describedby'], errorId, hintId].filter(Boolean).join(' ') || undefined;
    const extra: ControlAria = {};
    if (takesId) extra.id = id;
    if (describedBy) extra['aria-describedby'] = describedBy;
    if (error && child.props['aria-invalid'] === undefined) extra['aria-invalid'] = true;
    if (required && child.props['aria-required'] === undefined) extra['aria-required'] = true;
    control = cloneElement(child, extra);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-sm font-medium text-[var(--color-fg-secondary)]">
        {label}
        {required && <span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span>}
      </label>
      {control}
      {error && <span id={errorId} className="text-xs text-[var(--color-error-600)]">{error}</span>}
      {!error && hint && <span id={hintId} className="text-xs text-[var(--color-fg-quaternary)]">{hint}</span>}
    </div>
  );
}

type ControlSize = 'sm' | 'md';
const controlSizeClass = (size: ControlSize) => (size === 'sm' ? 'ui-input-sm' : undefined);

export const Input = Object.assign(
  forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { /** sm = compact (about 32px, 12px text). Default md. */ size?: ControlSize }>(
    ({ className, size = 'md', ...rest }, ref) => (
      <input ref={ref} {...rest} className={cn('ui-input', controlSizeClass(size), className)} />
    ),
  ),
  { acceptsId: true },
);
Input.displayName = 'Input';

/** Styled native <select> with the Input look and a chevron. */
export const Select = Object.assign(
  forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: ControlSize }>(
    ({ className, size = 'md', children, ...rest }, ref) => (
      <select ref={ref} {...rest} className={cn('ui-input ui-select', controlSizeClass(size), className)}>
        {children}
      </select>
    ),
  ),
  { acceptsId: true },
);
Select.displayName = 'Select';

/** Multi-line text input with the Input look. */
export const Textarea = Object.assign(
  forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: ControlSize }>(
    ({ className, size = 'md', ...rest }, ref) => (
      <textarea ref={ref} {...rest} className={cn('ui-input ui-textarea', controlSizeClass(size), className)} />
    ),
  ),
  { acceptsId: true },
);
Textarea.displayName = 'Textarea';

/* ─────────────────────────────────────────────
   Table family  —  wraps .ui-table
   ───────────────────────────────────────────── */
/**
 * Scrollable table. Pass `aria-label` (what the table lists) so the horizontally
 * scrollable region is a named landmark that keyboard users can focus and scroll.
 */
export function Table({ className, wrapperClassName, children, 'aria-label': ariaLabel, ...rest }: HTMLAttributes<HTMLTableElement> & { wrapperClassName?: string; 'aria-label'?: string }) {
  return (
    <div
      role={ariaLabel ? 'region' : undefined}
      aria-label={ariaLabel}
      tabIndex={0}
      className={cn('overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)]', wrapperClassName)}
    >
      <table {...rest} className={cn('ui-table min-w-full', className)}>{children}</table>
    </div>
  );
}
export function THead({ children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) { return <thead {...rest}>{children}</thead>; }
export function TBody({ children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...rest}>{children}</tbody>; }
export function Tr({ children, ...rest }: HTMLAttributes<HTMLTableRowElement>) { return <tr {...rest}>{children}</tr>; }
export function Th({ scope = 'col', children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) { return <th scope={scope} {...rest}>{children}</th>; }
export function Td({ children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) { return <td {...rest}>{children}</td>; }

/* ─────────────────────────────────────────────
   Divider
   ───────────────────────────────────────────── */
export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-[var(--color-border-secondary)]', className)} />;
}

/* ─────────────────────────────────────────────
   EmptyState
   ───────────────────────────────────────────── */
export function EmptyState({ title, body, action }: { title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] px-6 py-12 text-center">
      <div className="text-sm font-semibold text-[var(--color-fg-secondary)]">{title}</div>
      {body && <div className="max-w-xs text-sm text-[var(--color-fg-quaternary)]">{body}</div>}
      {action}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Spinner
   ───────────────────────────────────────────── */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin h-5 w-5 text-[var(--color-fg-disabled)]', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/* ─────────────────────────────────────────────
   PageHeader  —  consistent page title area
   ───────────────────────────────────────────── */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 mb-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-[var(--color-fg-quaternary)]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Alert  —  inline feedback banner
   ───────────────────────────────────────────── */
type AlertTone = 'info' | 'success' | 'warning' | 'error';

const alertStyles: Record<AlertTone, string> = {
  info:    'bg-[var(--color-info-50)]    border-[var(--color-info-200)]    text-[var(--color-info-800)]',
  success: 'bg-[var(--color-success-50)] border-[var(--color-success-200)] text-[var(--color-success-800)]',
  warning: 'bg-[var(--color-warning-50)] border-[var(--color-warning-200)] text-[var(--color-warning-800)]',
  error:   'bg-[var(--color-error-50)]   border-[var(--color-error-200)]   text-[var(--color-error-800)]',
};

export function Alert({
  tone = 'info',
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-[var(--radius-lg)] border px-4 py-3 text-sm font-medium',
        alertStyles[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Avatar  —  user avatar with initials fallback
   ───────────────────────────────────────────── */
export function Avatar({ name, src, size = 'md' }: { name?: string | null; src?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const initials = (name ?? '?')
    .split(' ')
    .filter(w => w.length > 0)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const sz = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-11 w-11 text-base' }[size];
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name ?? ''} className={cn('rounded-full object-cover bg-[var(--color-bg-tertiary)]', sz)} />
  ) : (
    <span className={cn('inline-flex items-center justify-center rounded-full bg-[var(--color-brand-100)] font-semibold text-[var(--color-brand-700)]', sz)}>
      {initials}
    </span>
  );
}

/* ─────────────────────────────────────────────
   Segmented  —  tab-style toggle group
   ───────────────────────────────────────────── */
export function Segmented({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-0.5 rounded-[var(--radius-lg)] bg-[var(--color-bg-tertiary)] p-1', className)}>
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            'rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap',
            value === id
              ? 'bg-[var(--color-bg-primary)] text-[var(--color-fg-primary)] shadow-[var(--shadow-xs)]'
              : 'text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-secondary)]',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Stat  (legacy compat shim → MetricCard)
   ───────────────────────────────────────────── */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <MetricCard label={label} value={value} sub={sub} />;
}
