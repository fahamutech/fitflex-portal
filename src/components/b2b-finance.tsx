'use client';
import { ReactNode } from 'react';
import { Printer } from 'lucide-react';
import { B2BAging, B2BBalances, B2BInvoiceDetail, B2BSponsorInvoice, B2BStatement } from '@/lib/api';
import { Badge, Button, Card, CardContent } from '@/components/shared';
import { money } from '@/lib/admin-utils';
import { useOrgT } from '@/lib/org-i18n';

/** Shared pieces of B2B billing: used by FitFlex finance and by the organisation's own billing area. */

/** English labels, for the FitFlex admin console. Screens an organisation sees use the `org.billing.kind.*` messages. */
export const INVOICE_KIND: Record<string, string> = {
  prepaid: 'Sponsored passes', usage: 'Per-use benefits', fee: 'Platform fee', credit_note: 'Credit note', debit_note: 'Debit note',
};
const STATUS_TONE: Record<string, 'gray' | 'warning' | 'brand' | 'success' | 'danger'> = {
  draft: 'gray', issued: 'warning', partially_paid: 'brand', paid: 'success', void: 'gray',
};
export const PAYMENT_METHOD: Record<string, string> = {
  bank_transfer: 'Bank transfer', mobile_money: 'Mobile money', lipa_namba: 'Lipa Namba', cheque: 'Cheque', cash: 'Cash', card: 'Card', other: 'Other',
};
const AGING_KEYS: Array<keyof B2BAging> = ['current', 'days1to30', 'days31to60', 'days61to90', 'over90'];

export const day = (v?: string | null) => (v ? new Date(v.length === 10 ? `${v}T00:00:00` : v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** A credit is settled when it has been applied; an invoice past its due date is overdue. */
export function InvoiceStatus({ invoice }: { invoice: B2BSponsorInvoice }) {
  const o = useOrgT();
  if (invoice.overdue) return <Badge tone="danger">{o.t('org.billing.status.overdue')}</Badge>;
  const credit = invoice.totalTzs < 0;
  const label = credit && invoice.status === 'issued' ? o.t('org.billing.status.creditAvailable') : credit && invoice.status === 'paid' ? o.t('org.billing.status.applied') : o.label('org.billing.status', invoice.status);
  return <Badge tone={STATUS_TONE[invoice.status] ?? 'gray'}>{label}</Badge>;
}

export function Balances({ b }: { b: B2BBalances }) {
  const o = useOrgT();
  const cells: Array<[string, number, string?]> = [
    [o.t('org.billing.bal.outstanding'), b.outstandingTzs],
    [o.t('org.billing.bal.overdue'), b.overdueTzs, b.overdueTzs > 0 ? 'text-[var(--color-error-600)]' : undefined],
    [o.t('org.billing.bal.credit'), b.creditTzs],
    [o.t('org.billing.bal.balance'), b.balanceTzs],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-4" data-testid="billing-balances">
      {cells.map(([label, value, tone]) => (
        <Card key={label}>
          <CardContent className="py-4">
            <div className="text-xs text-[var(--color-fg-quaternary)]">{label}</div>
            <div className={`mt-1 text-lg font-semibold ${tone ?? 'text-[var(--color-fg-primary)]'}`}>{money(value)}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function Aging({ aging }: { aging: B2BAging }) {
  const o = useOrgT();
  return (
    <div className="grid gap-2 text-sm sm:grid-cols-5" data-testid="billing-aging">
      {AGING_KEYS.map(key => (
        <div key={key} className="rounded-lg border border-[var(--color-border-secondary)] px-3 py-2">
          <div className="text-xs text-[var(--color-fg-quaternary)]">{o.label('org.billing.aging', key)}</div>
          <div className={`font-medium ${key !== 'current' && aging[key] > 0 ? 'text-[var(--color-error-600)]' : ''}`}>{money(aging[key])}</div>
        </div>
      ))}
    </div>
  );
}

/** Hide everything but the document when the page is printed. */
export function PrintButton() {
  const o = useOrgT();
  return <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden"><Printer className="h-4 w-4" />{o.t('org.billing.print')}</Button>;
}

export function StatementTable({ statement, onOpen }: { statement: B2BStatement; onOpen?: (invoiceId: string) => void }) {
  const o = useOrgT();
  const day = o.day;
  return (
    <div className="overflow-x-auto" data-testid="billing-statement">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
            <th className="py-2 pr-3">{o.t('org.common.date')}</th><th className="py-2 pr-3">{o.t('org.billing.st.document')}</th><th className="py-2 pr-3">{o.t('org.billing.st.details')}</th><th className="py-2 pr-3">{o.t('org.common.due')}</th>
            <th className="py-2 pr-3 text-right">{o.t('org.billing.st.charge')}</th><th className="py-2 pr-3 text-right">{o.t('org.billing.st.credit')}</th><th className="py-2 text-right">{o.t('org.billing.bal.balance')}</th>
          </tr>
        </thead>
        <tbody>
          {(statement.from || statement.openingBalanceTzs !== 0) && (
            <tr className="border-b border-[var(--color-border-secondary)]">
              <td className="py-2 pr-3" colSpan={6}>{o.t('org.billing.st.broughtForward')}</td>
              <td className="py-2 text-right">{money(statement.openingBalanceTzs)}</td>
            </tr>
          )}
          {statement.entries.map((e, i) => (
            <tr key={`${e.reference}-${e.type}-${i}`} className="border-b border-[var(--color-border-secondary)]">
              <td className="py-2 pr-3 whitespace-nowrap">{day(e.day)}</td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {e.invoiceId && onOpen
                  ? <button className="font-medium text-[var(--color-fg-brand)] print:text-black" onClick={() => onOpen(e.invoiceId!)}>{e.reference}</button>
                  : <span className="font-medium">{e.reference}</span>}
                <div className="text-xs text-[var(--color-fg-quaternary)]">{o.label('org.billing.entry', e.type)}</div>
              </td>
              <td className="py-2 pr-3">{e.description}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{e.dueDate ? day(e.dueDate) : ''}</td>
              <td className="py-2 pr-3 text-right">{e.chargeTzs ? money(e.chargeTzs) : ''}</td>
              <td className="py-2 pr-3 text-right">{e.creditTzs ? money(e.creditTzs) : ''}</td>
              <td className="py-2 text-right font-medium">{money(e.balanceTzs)}</td>
            </tr>
          ))}
          {statement.entries.length === 0 && <tr><td className="py-4 text-[var(--color-fg-quaternary)]" colSpan={7}>{o.t('org.billing.st.empty')}</td></tr>}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2 pr-3 font-semibold" colSpan={4}>{o.t('org.billing.st.closing')}</td>
            <td className="py-2 pr-3 text-right">{money(statement.totals.chargesTzs)}</td>
            <td className="py-2 pr-3 text-right">{money(statement.totals.creditsTzs)}</td>
            <td className="py-2 text-right font-semibold">{money(statement.closingBalanceTzs)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * One invoice or note as a document: who it is for, what it charges, what
 * has been paid and what is left. `actions` are the reader's buttons.
 */
export function InvoiceDocument({ detail, organizationName, actions }: { detail: B2BInvoiceDetail; organizationName?: string; actions?: ReactNode }) {
  const o = useOrgT();
  const day = o.day;
  const inv = detail.invoice;
  const paid = inv.amountPaidTzs ?? 0;
  const lineLabel = (l: B2BInvoiceDetail['lines'][number]) => {
    const name = l.beneficiaryName ?? o.t('org.billing.doc.member');
    return l.description ?? (l.kind === 'pass' ? o.t('org.billing.doc.passLine', { name }) : l.kind === 'credit' ? o.t('org.billing.doc.creditLine') : o.t('org.billing.doc.usageLine', { name }));
  };
  return (
    <div className="space-y-4 text-sm" data-testid="invoice-document">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-[var(--color-fg-quaternary)]">{o.label('org.billing.kind', inv.kind)} · {inv.period}</div>
          <div className="text-xl font-semibold text-[var(--color-fg-primary)]">{inv.number}</div>
          {organizationName && <div>{organizationName}</div>}
          {detail.relatedInvoice && <div className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.billing.doc.raisedOn', { number: detail.relatedInvoice.number })}{inv.reason ? `: ${inv.reason}` : ''}</div>}
        </div>
        <div className="flex items-center gap-2"><InvoiceStatus invoice={inv} /><PrintButton /></div>
      </div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-4">
        {([[o.t('org.common.issued'), day(inv.issuedAt)], [o.t('org.common.due'), inv.totalTzs > 0 ? day(inv.dueDate) : '—'], [o.t('org.billing.doc.totalVat'), money(inv.totalTzs)],
          [o.t('org.billing.doc.vat'), inv.vatRateBps != null ? `${inv.vatRateBps / 100}% = ${money(inv.vatTzs)}` : o.t('org.billing.doc.vatLater')]] as Array<[string, string]>).map(([k, v]) => (
          <div key={k}><dt className="text-xs text-[var(--color-fg-quaternary)]">{k}</dt><dd className="font-medium">{v}</dd></div>
        ))}
      </dl>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
            <th className="py-2 pr-3">{o.t('org.common.what')}</th><th className="py-2 pr-3 text-right">{o.t('org.billing.doc.quantity')}</th><th className="py-2 text-right">{o.t('org.common.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((l, i) => (
            <tr key={i} className="border-b border-[var(--color-border-secondary)]">
              <td className="py-2 pr-3">{lineLabel(l)}</td>
              <td className="py-2 pr-3 text-right">{l.quantity || ''}</td>
              <td className="py-2 text-right">{money(l.amountTzs)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td className="py-2 font-semibold" colSpan={2}>{o.t('org.common.total')}</td><td className="py-2 text-right font-semibold">{money(inv.totalTzs)}</td></tr>
        </tfoot>
      </table>
      {detail.settlements.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold">{o.t('org.billing.doc.settlements')}</div>
          <ul className="space-y-1">
            {detail.settlements.map(s => (
              <li key={s.id} className="flex justify-between gap-2">
                <span>{s.creditNoteNumber ? o.t('org.billing.doc.creditNote', { number: s.creditNoteNumber }) : `${s.paymentNumber} · ${o.label('org.billing.method', s.method, String(s.method))} · ${s.reference} · ${day(s.receivedAt)}`}</span>
                <span>{money(s.amountTzs)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {detail.notes.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold">{o.t('org.billing.doc.notes')}</div>
          <ul className="space-y-1">
            {detail.notes.map(n => (
              <li key={n.id} className="flex justify-between gap-2">
                <span>{n.number} · {o.label('org.billing.kind', n.kind)}{n.status === 'draft' ? o.t('org.billing.doc.draftNote') : ''}{n.reason ? ` · ${n.reason}` : ''}</span>
                <span>{money(n.totalTzs)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {inv.totalTzs > 0 && inv.status !== 'draft' && inv.status !== 'void' && (
        <div className="flex justify-end gap-6 border-t border-[var(--color-border-secondary)] pt-3">
          <span>{o.t('org.billing.doc.paidOrCredited')} <span className="font-medium">{money(paid)}</span></span>
          <span>{o.t('org.billing.doc.stillOwed')} <span className="font-semibold">{money(inv.outstandingTzs ?? inv.totalTzs - paid)}</span></span>
        </div>
      )}
      {actions && <div className="print:hidden">{actions}</div>}
    </div>
  );
}
