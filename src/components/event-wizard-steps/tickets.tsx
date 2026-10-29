'use client';
import { fmt, newTicket, type TicketForm } from '@/lib/events';
import { Button, Checkbox } from '@/components/shared';
import { DateField, MoneyField, RowCard, TextField, useErrorText, type StepProps } from './fields';
import { PayoutScheduleCard } from './payout';
import { useApp } from '../../../app/providers';

/** Step 4 Ticket types (spec §6.2): 1–6 per category, grouped under each category. Currency fixed to TZS (D4). */
export function TicketsStep({ form, update, errors, readOnly, options, payoutLocked }: StepProps) {
  const { t } = useApp();
  const errText = useErrorText();
  const setTicket = (ci: number, ti: number, patch: Partial<TicketForm>) =>
    update(f => ({ categories: f.categories.map((c, j) => (j === ci ? { ...c, ticketTypes: c.ticketTypes.map((tt, k) => (k === ti ? { ...tt, ...patch } : tt)) } : c)) }));
  const add = (ci: number) => update(f => ({ categories: f.categories.map((c, j) => (j === ci ? { ...c, ticketTypes: [...c.ticketTypes, newTicket()] } : c)) }));
  const remove = (ci: number, ti: number) => update(f => ({ categories: f.categories.map((c, j) => (j === ci ? { ...c, ticketTypes: c.ticketTypes.filter((_, k) => k !== ti) } : c)) }));
  const payout = <PayoutScheduleCard form={form} update={update} errors={errors} options={options} locked={readOnly || !!payoutLocked} />;
  if (!form.categories.length) return <div className="space-y-6">{payout}<p className="text-sm text-[var(--color-fg-quaternary)]">{t('events.tickets.noCategories')}</p></div>;
  return (
    <div className="space-y-6">
      {payout}
      {form.categories.map((c, ci) => {
        const cp = `categories.${ci}`;
        return (
          <section key={c.uid} className="space-y-3" aria-label={c.name || fmt(t('events.categories.unnamed'), { n: ci + 1 })}>
            <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{c.name || fmt(t('events.categories.unnamed'), { n: ci + 1 })}</h3>
            {errors[`${cp}.ticketTypes`] && <p className="text-sm text-[var(--color-error-700)]" id={`ev-categories-${ci}-ticketTypes`} tabIndex={-1}>{errText(errors[`${cp}.ticketTypes`])}</p>}
            {c.ticketTypes.map((tt, ti) => {
              const p = `${cp}.ticketTypes.${ti}`;
              const title = tt.name.trim() || fmt(t('events.tickets.unnamed'), { n: ti + 1 });
              return (
                <div key={tt.uid} data-row={tt.uid}>
                  <RowCard title={title} readOnly={readOnly} onRemove={() => remove(ci, ti)} removeLabel={fmt(t('common.remove'), { name: title })} testId={`ev-ticket-${ci}-${ti}`}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField path={`${p}.name`} label={t('events.tickets.name')} value={tt.name} onChange={v => setTicket(ci, ti, { name: v })} error={errors[`${p}.name`]} required readOnly={readOnly} maxLength={40} />
                      <MoneyField path={`${p}.priceText`} label={t('events.tickets.price')} value={tt.priceText} onChange={v => setTicket(ci, ti, { priceText: v })} error={errors[`${p}.priceText`]} readOnly={readOnly} />
                      <div className="space-y-1">
                        <TextField path={`${p}.capacity`} label={t('events.tickets.capacity')} value={tt.noLimit ? '' : tt.capacity} onChange={v => setTicket(ci, ti, { capacity: v })} error={errors[`${p}.capacity`]} readOnly={readOnly || tt.noLimit} inputMode="numeric" hint={t('events.tickets.capacityHint')} />
                        <Checkbox label={t('events.categories.noLimit')} checked={tt.noLimit} onChange={e => setTicket(ci, ti, { noLimit: e.target.checked })} disabled={readOnly} />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <TextField path={`${p}.minPerOrder`} label={t('events.tickets.minPerOrder')} value={tt.minPerOrder} onChange={v => setTicket(ci, ti, { minPerOrder: v })} error={errors[`${p}.minPerOrder`]} readOnly={readOnly} inputMode="numeric" />
                        <TextField path={`${p}.maxPerOrder`} label={t('events.tickets.maxPerOrder')} value={tt.maxPerOrder} onChange={v => setTicket(ci, ti, { maxPerOrder: v })} error={errors[`${p}.maxPerOrder`]} readOnly={readOnly} inputMode="numeric" />
                      </div>
                      <DateField path={`${p}.saleOpensAt`} label={t('events.tickets.saleOpens')} value={tt.saleOpensAt} onChange={v => setTicket(ci, ti, { saleOpensAt: v })} error={errors[`${p}.saleOpensAt`]} readOnly={readOnly} timezone={form.timezone} />
                      <DateField path={`${p}.saleClosesAt`} label={t('events.tickets.saleCloses')} value={tt.saleClosesAt} onChange={v => setTicket(ci, ti, { saleClosesAt: v })} error={errors[`${p}.saleClosesAt`]} readOnly={readOnly} timezone={form.timezone} />
                    </div>
                  </RowCard>
                </div>
              );
            })}
            {!readOnly && c.ticketTypes.length < 6 && <Button type="button" variant="secondary" size="sm" onClick={() => add(ci)} data-testid={`ev-add-ticket-${ci}`}>{t('events.tickets.add')}</Button>}
          </section>
        );
      })}
    </div>
  );
}
