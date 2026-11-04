'use client';
// Small pieces shared by the S9 purchases screens. Every label is an i18n key; badges always say the state in words.
import { type ReactNode } from 'react';
import { money } from '@/lib/admin-utils';
import { addDays, eatToday, fmt, PAYMENT_METHODS, REFERENCE_REQUIRED, saleMethodLabel } from '@/lib/vendor';
import { MAX_INSTALMENTS, paymentStateKey, paymentStateTone, scheduleFor, type PaymentState } from '@/lib/vendor-purchases';
import { Alert, Badge, Button, Field, Input, Select } from '@/components/shared';
import { useApp } from '../../../../app/providers';

export const chip = 'inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
export const chipOn = 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]';
export const chipOff = 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-secondary)]';
export const linkCls = 'inline-flex min-h-11 items-center font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline';

/** Received / Voided. */
export function StatusBadge({ status }: { status: 'received' | 'voided' }) {
  const { t } = useApp();
  return <Badge tone={status === 'voided' ? 'gray' : 'success'}><span className="whitespace-nowrap">{t(`vendor.purchases.state.${status}`)}</span></Badge>;
}
/** Paid / Part paid / Unpaid, or Overdue when money on it is late. Nothing on a voided purchase. */
export function PaymentBadge({ state, overdueTzs, status }: { state: PaymentState; overdueTzs: number; status: 'received' | 'voided' }) {
  const { t } = useApp();
  if (status === 'voided') return null;
  const overdue = overdueTzs > 0;
  return <Badge tone={paymentStateTone(state, overdue)}><span className="whitespace-nowrap" data-testid="payment-badge">{t(paymentStateKey(state, overdue))}</span></Badge>;
}

/** "FitFlex does not pay suppliers…" — on Receive stock, Record payment and the purchase detail (AC-21). */
export function MoneyNotice() {
  const { t } = useApp();
  return <div data-testid="purchases-money-notice"><Alert tone="info">{t('vendor.purchases.moneyNotice')}</Alert></div>;
}

/** S3 method chips + the reference field (required for mobile money and bank). */
export function MethodPicker({
  method, reference, onMethod, onReference, disabled, referenceError, testPrefix,
}: {
  method: string; reference: string; onMethod: (m: string) => void; onReference: (r: string) => void;
  disabled?: boolean; referenceError?: string | null; testPrefix: string;
}) {
  const { t } = useApp();
  const needsRef = REFERENCE_REQUIRED.has(method);
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.pay.method')}</legend>
        <div className="flex flex-wrap gap-2" data-testid={`${testPrefix}-methods`}>
          {PAYMENT_METHODS.map(m => (
            <button key={m} type="button" aria-pressed={method === m} className={`${chip} ${method === m ? chipOn : chipOff}`}
              onClick={() => onMethod(m)} disabled={disabled} data-testid={`${testPrefix}-method-${m}`}>
              {saleMethodLabel(m, t)}
            </button>
          ))}
        </div>
      </fieldset>
      {method !== 'cash' && (
        <Field label={t(needsRef ? 'vendor.pos.reference' : 'vendor.pos.referenceOptional')} required={needsRef} error={referenceError ?? undefined}>
          <Input value={reference} maxLength={100} autoComplete="off" className="uppercase"
            onChange={e => onReference(e.target.value.toUpperCase())} disabled={disabled} data-testid={`${testPrefix}-reference`} />
        </Field>
      )}
    </div>
  );
}

export type PlanRow = { dueDate: string; amount: string };
export const rowAmount = (r: PlanRow) => (/^\d+$/.test(r.amount.trim()) ? Number(r.amount.trim()) : 0);
export const planSum = (rows: PlanRow[]) => rows.reduce((n, r) => n + rowAmount(r), 0);

/**
 * The instalment editor (§4.2): number of instalments, first due date, every 2 weeks / month, Split evenly, then one
 * editable due date + amount per row. The live sum line is a polite live region; it turns into an error when it
 * doesn't add up to `left`.
 */
export function InstalmentEditor({
  left, rows, onRows, minDate, maxDate, disabled, showError, testPrefix, defaultFirst,
}: {
  left: number; rows: PlanRow[]; onRows: (rows: PlanRow[]) => void; minDate: string; maxDate: string;
  disabled?: boolean; showError?: boolean; testPrefix: string; defaultFirst: string;
}) {
  const { t } = useApp();
  const count = rows.length || 2;
  const first = rows[0]?.dueDate || defaultFirst;
  const sum = planSum(rows);
  const wrong = sum !== left;
  const fill = (n: number, firstDue: string, every: '2w' | 'month') =>
    onRows(scheduleFor(left, n, firstDue, every).map(r => ({ dueDate: r.dueDate, amount: String(r.amountTzs) })));
  const everyOf = (): '2w' | 'month' => (rows.length > 1 && addDays(rows[0].dueDate, 14) === rows[1].dueDate ? '2w' : 'month');
  const setRow = (i: number, patch: Partial<PlanRow>) => onRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3" data-testid={`${testPrefix}-plan`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('vendor.purchases.instalmentCount')}>
          <Select value={String(count)} disabled={disabled} onChange={e => fill(Number(e.target.value), first, everyOf())} data-testid={`${testPrefix}-plan-count`}>
            {Array.from({ length: MAX_INSTALMENTS - 1 }, (_, i) => i + 2).map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Field label={t('vendor.purchases.firstDue')}>
          <Input type="date" value={first} min={minDate} max={maxDate} disabled={disabled}
            onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) fill(count, e.target.value, everyOf()); }} data-testid={`${testPrefix}-plan-first`} />
        </Field>
        <Field label={t('vendor.purchases.every')}>
          <Select value={everyOf()} disabled={disabled} onChange={e => fill(count, first, e.target.value as '2w' | 'month')} data-testid={`${testPrefix}-plan-every`}>
            <option value="2w">{t('vendor.purchases.every2w')}</option>
            <option value="month">{t('vendor.purchases.everyMonth')}</option>
          </Select>
        </Field>
      </div>
      <Button type="button" variant="secondary" size="sm" className="min-h-11" disabled={disabled} onClick={() => fill(count, first, everyOf())} data-testid={`${testPrefix}-plan-even`}>
        {t('vendor.purchases.splitEvenly')}
      </Button>
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
            <span className="text-sm font-medium text-[var(--color-fg-secondary)] sm:pb-3">{fmt(t('vendor.purchases.instalmentN'), { n: i + 1 })}</span>
            <Input type="date" aria-label={fmt(t('vendor.purchases.instalmentDue'), { n: i + 1 })} value={r.dueDate} min={minDate} max={maxDate} disabled={disabled}
              onChange={e => setRow(i, { dueDate: e.target.value })} data-testid={`${testPrefix}-plan-date-${i}`} />
            <Input inputMode="numeric" aria-label={fmt(t('vendor.purchases.instalmentAmount'), { n: i + 1 })} value={r.amount} disabled={disabled} autoComplete="off"
              onChange={e => setRow(i, { amount: e.target.value.replace(/[^\d]/g, '') })} data-testid={`${testPrefix}-plan-amount-${i}`} />
          </li>
        ))}
      </ol>
      <p aria-live={wrong && showError ? 'assertive' : 'polite'} className={`text-sm ${wrong ? 'text-[var(--color-error-700)]' : 'text-[var(--color-fg-tertiary)]'}`} data-testid={`${testPrefix}-plan-sum`}>
        {wrong && showError
          ? fmt(t('vendor.purchases.sumWrong'), { left: money(left) })
          : fmt(t('vendor.purchases.sumCheck'), { sum: money(sum), left: money(left) })}
      </p>
    </div>
  );
}

/** Rows that every due date is inside [min, max] and every amount ≥ 1. */
export const planRowsValid = (rows: PlanRow[], min: string, max: string) =>
  rows.length >= 1 && rows.length <= MAX_INSTALMENTS && rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) && r.dueDate >= min && r.dueDate <= max && rowAmount(r) >= 1);

export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-[var(--color-fg-quaternary)]">{label}</dt>
      <dd className="text-sm text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export const todayEat = () => eatToday();
