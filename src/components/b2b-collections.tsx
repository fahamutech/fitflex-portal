'use client';
import { useEffect, useState } from 'react';
import {
  api, ApiError, B2BCollectionsQueue, B2BOrgPaying, B2BPaymentInstructions, B2BPaymentNotice, B2BSponsorInvoice,
} from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, Field, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { PAYMENT_METHOD, day } from '@/components/b2b-finance';
import { money } from '@/lib/admin-utils';
import { useOrgT } from '@/lib/org-i18n';

const ERRORS: Record<string, string> = {
  invalid_amount: 'Enter a whole amount in TZS, more than zero.',
  payment_reference_required: 'Enter the bank or mobile-money reference.',
  payment_reference_in_use: 'That reference has already been used for a different amount.',
  paid_on_in_future: 'The payment date can’t be in the future.',
  invalid_paid_on: 'Enter the date you paid.',
  invoice_not_payable: 'One of those invoices is already paid or isn’t issued.',
  invoice_not_found: 'One of those invoices wasn’t found.',
  notice_already_decided: 'This notice has already been decided.',
  cannot_confirm_own_notice: 'You sent this notice, so someone else has to confirm it.',
  reason_required: 'Say why.',
  invoice_not_chaseable: 'Only an issued invoice with money owed and a due date can be chased.',
  forbidden: 'Your role doesn’t include this.',
  acl_forbidden: 'Your permissions don’t include this.',
};
const said = (e: unknown, fallback: string) => {
  const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
  return (code && ERRORS[code]) || fallback;
};
const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
const todayEat = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const NOTICE_TONE: Record<B2BPaymentNotice['status'], 'warning' | 'success' | 'danger' | 'gray'> = { submitted: 'warning', confirmed: 'success', rejected: 'danger', withdrawn: 'gray' };
const STAGE: Record<string, string> = { before3: '3 days before', due: 'Due day', plus7: '7 days late', plus14: '14 days late', plus30: '30 days late', manual: 'Sent by hand' };

/** FitFlex's bank and Lipa Namba details, as an organisation sees them. */
export function PaymentDetails({ instructions, configured }: { instructions: B2BPaymentInstructions; configured: boolean }) {
  const o = useOrgT();
  const row = (label: string, value: string | null) => (value ? <div><span className="text-[var(--color-fg-quaternary)]">{label}: </span><span className="font-medium">{value}</span></div> : null);
  return (
    <Card>
      <CardContent className="space-y-1 py-4 text-sm" data-testid="payment-details">
        <div className="mb-1 font-semibold">{o.t('org.pay.howTo')}</div>
        {!configured ? <p className="text-[var(--color-fg-quaternary)]">{o.t('org.pay.notConfigured')}</p> : (
          <>
            {instructions.accountNumber && (
              <div className="space-y-0.5">
                {row(o.t('org.pay.bank'), instructions.bankName)}
                {row(o.t('org.pay.accountName'), instructions.accountName)}
                {row(o.t('org.pay.accountNumber'), instructions.accountNumber)}
                {row(o.t('org.pay.branch'), instructions.branch)}
                {row('SWIFT', instructions.swiftCode)}
              </div>
            )}
            {instructions.lipaNamba && <div className="pt-1">{row('Lipa Namba', [instructions.lipaNamba, instructions.lipaNambaName].filter(Boolean).join(' · '))}</div>}
            {instructions.notes && <p className="pt-1 text-[var(--color-fg-tertiary)]">{instructions.notes}</p>}
          </>
        )}
        <p className="pt-1 text-xs text-[var(--color-fg-quaternary)]">{o.t('org.pay.quote')}</p>
      </CardContent>
    </Card>
  );
}

/**
 * An organisation's "Pay" tab: where to pay, the form that tells FitFlex a
 * payment has been made, and what became of earlier notices.
 */
export function OrgPaying({ token, orgId, invoices, preselect, onChanged }: {
  token: string; orgId: string; invoices: B2BSponsorInvoice[]; preselect?: string | null; onChanged?: () => void;
}) {
  const o = useOrgT();
  const day = o.day;
  const [paying, setPaying] = useState<B2BOrgPaying | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = invoices.filter(i => (i.outstandingTzs ?? 0) > 0);
  const blank = () => {
    const chosen = preselect && open.some(i => i.id === preselect) ? [preselect] : [];
    return { amount: chosen.length ? String(open.find(i => i.id === chosen[0])?.outstandingTzs ?? '') : '', method: 'bank_transfer', reference: '', paidOn: todayEat(), invoiceIds: chosen, note: '', proof: null as File | null };
  };
  const [f, setF] = useState(blank);

  const load = () => api.orgPaying(token, orgId).then(setPaying).catch(e => setError(o.err('org.pay.err', e, 'org.pay.loadFailed')));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPaying(null); setError(null); setDone(null); setF(blank()); load(); }, [token, orgId, preselect]);

  const toggle = (id: string) => {
    const invoiceIds = f.invoiceIds.includes(id) ? f.invoiceIds.filter(x => x !== id) : [...f.invoiceIds, id];
    const total = open.filter(i => invoiceIds.includes(i.id)).reduce((n, i) => n + (i.outstandingTzs ?? 0), 0);
    setF({ ...f, invoiceIds, amount: total ? String(total) : f.amount });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountTzs = whole(f.amount);
    if (!Number.isFinite(amountTzs) || amountTzs <= 0) return setError(o.t('org.pay.err.invalid_amount'));
    setBusy(true); setError(null); setDone(null);
    try {
      const proofUrl = f.proof ? (await api.uploadFile(token, f.proof, f.proof.name)).url : undefined;
      const out = await api.submitPaymentNotice(token, orgId, {
        amountTzs, method: f.method, reference: f.reference.trim(), paidOn: f.paidOn, invoiceIds: f.invoiceIds, note: f.note.trim() || undefined, proofUrl,
      });
      setDone(o.t(out.existing ? 'org.pay.doneExisting' : 'org.pay.done'));
      setF({ ...blank(), invoiceIds: [], amount: '' });
      await load();
      onChanged?.();
    } catch (err) {
      setError(o.err('org.pay.err', err, 'org.pay.sendFailed'));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (id: string) => {
    setError(null);
    try { await api.withdrawPaymentNotice(token, orgId, id); await load(); } catch (err) { setError(o.err('org.pay.err', err, 'org.pay.withdrawFailed')); }
  };

  if (!paying) return error ? <Alert tone="error">{error}</Alert> : <Spinner className="h-6 w-6" />;
  return (
    <div className="space-y-4" data-testid="org-paying">
      {paying.onHold && (
        <Alert tone="error">
          {o.t('org.pay.onHold', { reason: paying.holdReason ? `: ${paying.holdReason}` : '.' })}
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <PaymentDetails instructions={paying.instructions} configured={paying.configured} />
        <Card>
          <CardContent className="py-4">
            <div className="mb-2 text-sm font-semibold">{o.t('org.pay.tellUs')}</div>
            {!paying.canPay ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.pay.cannotPay')}</p> : (
              <form className="space-y-3" onSubmit={submit} data-testid="payment-notice-form">
                {open.length > 0 && (
                  <Field label={o.t('org.pay.whichInvoices')} hint={o.t('org.pay.whichInvoicesHint')}>
                    <div className="max-h-40 space-y-1 overflow-auto">
                      {open.map(i => (
                        <label key={i.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" aria-label={i.number ?? i.id} checked={f.invoiceIds.includes(i.id)} onChange={() => toggle(i.id)} />
                          <span>{o.t('org.pay.invoiceOwed', { number: i.number, amount: money(i.outstandingTzs ?? 0) })}{i.dueDate ? o.t('org.pay.invoiceDue', { date: day(i.dueDate) }) : ''}</span>
                        </label>
                      ))}
                    </div>
                  </Field>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={o.t('org.pay.amountPaid')}><input className="ui-input" inputMode="numeric" required value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} data-testid="notice-amount" /></Field>
                  <Field label={o.t('org.pay.datePaid')}><input className="ui-input" type="date" required max={todayEat()} value={f.paidOn} onChange={e => setF({ ...f, paidOn: e.target.value })} /></Field>
                  <Field label={o.t('org.common.how')}>
                    <select className="ui-input" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>
                      {Object.keys(PAYMENT_METHOD).map(k => <option key={k} value={k}>{o.label('org.billing.method', k)}</option>)}
                    </select>
                  </Field>
                  <Field label={o.t('org.pay.reference')}><input className="ui-input" required maxLength={200} value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} data-testid="notice-reference" /></Field>
                </div>
                <Field label={o.t('org.common.noteOptional')}><input className="ui-input" maxLength={1000} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
                <Field label={o.t('org.pay.proof')} hint={o.t('org.pay.proofHint')}>
                  <input type="file" accept="image/*" className="text-sm" onChange={e => setF({ ...f, proof: e.target.files?.[0] ?? null })} />
                </Field>
                <Button type="submit" disabled={busy} data-testid="notice-send">{busy ? o.t('org.pay.sending') : o.t('org.pay.send')}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="mb-2 text-sm font-semibold">{o.t('org.pay.notices')}</div>
          {paying.notices.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.common.noneYet')}</p> : (
            <table className="w-full text-sm" data-testid="org-notices">
              <thead>
                <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                  <th className="py-2 pr-3">{o.t('org.pay.paidOn')}</th><th className="py-2 pr-3">{o.t('org.common.how')}</th><th className="py-2 pr-3">{o.t('org.common.reference')}</th><th className="py-2 pr-3">{o.t('org.common.for')}</th>
                  <th className="py-2 pr-3 text-right">{o.t('org.common.amount')}</th><th className="py-2 pr-3">{o.t('org.common.status')}</th><th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {paying.notices.map(n => (
                  <tr key={n.id} className="border-b border-[var(--color-border-secondary)] align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{day(n.paidOn)}</td>
                    <td className="py-2 pr-3">{o.label('org.billing.method', n.method)}</td>
                    <td className="py-2 pr-3">{n.reference}</td>
                    <td className="py-2 pr-3">{n.invoices?.length ? n.invoices.map(i => i.number).join(', ') : o.t('org.pay.oldestFirst')}</td>
                    <td className="py-2 pr-3 text-right">{money(n.amountTzs)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={NOTICE_TONE[n.status]}>{o.label('org.pay.notice', n.status)}</Badge>
                      {n.status === 'rejected' && n.decisionNote && <div className="mt-1 text-xs text-[var(--color-fg-tertiary)]">{n.decisionNote}</div>}
                    </td>
                    <td className="py-2 text-right">{n.status === 'submitted' && paying.canPay && <Button variant="secondary" size="sm" onClick={() => withdraw(n.id)}>{o.t('org.pay.withdraw')}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Can = { bill: boolean; approve: boolean; pay: boolean };

/**
 * FitFlex staff: payment notices to check against the statement, invoices
 * past due and what has been sent about them, organisations on hold, and
 * the payment details organisations are shown.
 */
export function CollectionsPanel({ token, can, onOpenOrganization, onChanged }: {
  token: string; can: Can; onOpenOrganization: (org: { id: string; name: string }) => void; onChanged?: () => void;
}) {
  const [q, setQ] = useState<B2BCollectionsQueue | null>(null);
  const [details, setDetails] = useState<{ instructions: B2BPaymentInstructions; configured: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ notice: B2BPaymentNotice; action: 'confirm' | 'reject' } | null>(null);
  const [holding, setHolding] = useState<{ id: string; name: string; onHold: boolean } | null>(null);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    try {
      const [queue, d] = await Promise.all([api.adminB2BCollections(token), api.adminB2BPaymentInstructions(token)]);
      setQ(queue); setDetails(d); setError(null);
    } catch (e) {
      setError(said(e, 'Could not load collections.'));
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);
  const changed = async () => { await load(); onChanged?.(); };

  const remind = async (invoiceId: string, number: string) => {
    setError(null); setInfo(null);
    try {
      const out = await api.remindB2BInvoice(token, invoiceId);
      setInfo(`Reminder for ${number} sent to ${out.recipients ?? 0} portal user${out.recipients === 1 ? '' : 's'}${out.emailedTo ? ` and ${out.emailedTo}` : ''}.`);
      await load();
    } catch (e) {
      setError(said(e, 'Could not send the reminder.'));
    }
  };

  if (!q || !details) return error ? <Alert tone="error">{error}</Alert> : <Spinner className="h-6 w-6" />;
  return (
    <Card>
      <CardContent className="space-y-4 py-4" data-testid="collections">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Collections</div>
            <div className="text-xs text-[var(--color-fg-quaternary)]">
              {q.totals.noticesToCheck} payment notice{q.totals.noticesToCheck === 1 ? '' : 's'} to check · {q.totals.overdueInvoices} overdue invoice{q.totals.overdueInvoices === 1 ? '' : 's'} ({money(q.totals.overdueTzs)}) · {q.totals.organizationsOnHold} on hold
            </div>
          </div>
          {can.approve && <Button variant="secondary" size="sm" onClick={() => setEditing(true)} data-testid="edit-payment-details">{details.configured ? 'Payment details' : 'Set payment details'}</Button>}
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {info && <Alert tone="success">{info}</Alert>}
        {!details.configured && <Alert tone="warning">Organisations can’t see where to pay yet. Set FitFlex’s bank or Lipa Namba details.</Alert>}

        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-quaternary)]">Payment notices to check</div>
          {q.notices.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">Nothing to check.</p> : (
            <table className="w-full text-sm" data-testid="notices-to-check">
              <thead>
                <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                  <th className="py-2 pr-3">Organisation</th><th className="py-2 pr-3">Paid on</th><th className="py-2 pr-3">How</th><th className="py-2 pr-3">Reference</th>
                  <th className="py-2 pr-3">For</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {q.notices.map(n => (
                  <tr key={n.id} className="border-b border-[var(--color-border-secondary)] align-top">
                    <td className="py-2 pr-3"><button className="font-medium text-[var(--color-fg-brand)]" onClick={() => onOpenOrganization({ id: n.organizationId, name: n.organizationName ?? n.organizationId })}>{n.organizationName ?? n.organizationId}</button></td>
                    <td className="py-2 pr-3 whitespace-nowrap">{day(n.paidOn)}</td>
                    <td className="py-2 pr-3">{PAYMENT_METHOD[n.method] ?? n.method}</td>
                    <td className="py-2 pr-3">
                      {n.reference}
                      {n.note && <div className="text-xs text-[var(--color-fg-quaternary)]">{n.note}</div>}
                      {n.proofUrl && <a className="text-xs text-[var(--color-fg-brand)]" href={n.proofUrl} target="_blank" rel="noreferrer">View proof</a>}
                    </td>
                    <td className="py-2 pr-3">{n.invoices?.length ? n.invoices.map(i => `${i.number} (${money(i.outstandingTzs)} owed)`).join(', ') : 'Oldest invoices first'}</td>
                    <td className="py-2 pr-3 text-right">{money(n.amountTzs)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {can.pay && (
                        <span className="inline-flex gap-2">
                          <Button size="sm" onClick={() => setDeciding({ notice: n, action: 'confirm' })} data-testid={`confirm-${n.id}`}>Confirm</Button>
                          <Button size="sm" variant="secondary" onClick={() => setDeciding({ notice: n, action: 'reject' })}>Not found</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-quaternary)]">Overdue invoices</div>
          {q.overdue.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">Nothing is overdue.</p> : (
            <table className="w-full text-sm" data-testid="overdue-invoices">
              <thead>
                <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                  <th className="py-2 pr-3">Organisation</th><th className="py-2 pr-3">Invoice</th><th className="py-2 pr-3">Due</th><th className="py-2 pr-3 text-right">Days late</th>
                  <th className="py-2 pr-3 text-right">Owed</th><th className="py-2 pr-3">Last reminder</th><th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {q.overdue.map(i => (
                  <tr key={i.id} className="border-b border-[var(--color-border-secondary)]">
                    <td className="py-2 pr-3">
                      <button className="font-medium text-[var(--color-fg-brand)]" onClick={() => onOpenOrganization({ id: i.organizationId, name: i.organizationName ?? i.organizationId })}>{i.organizationName ?? i.organizationId}</button>
                      {i.onHold && <span className="ml-2"><Badge tone="danger">On hold</Badge></span>}
                    </td>
                    <td className="py-2 pr-3">{i.number}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{day(i.dueDate)}</td>
                    <td className="py-2 pr-3 text-right">{i.daysOverdue}</td>
                    <td className="py-2 pr-3 text-right">{money(i.outstandingTzs)}</td>
                    <td className="py-2 pr-3">{i.lastReminder ? `${STAGE[i.lastReminder.stage] ?? i.lastReminder.stage} · ${day(i.lastReminder.sentAt)}` : 'None yet'}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <span className="inline-flex gap-2">
                        {can.bill && <Button size="sm" variant="secondary" onClick={() => remind(i.id, i.number)} data-testid={`remind-${i.id}`}>Remind now</Button>}
                        {can.approve && !i.onHold && <Button size="sm" variant="secondary" onClick={() => setHolding({ id: i.organizationId, name: i.organizationName ?? i.organizationId, onHold: true })}>Put on hold</Button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">
            Reminders go out automatically 3 days before the due day, on it, and 7, 14 and 30 days after. Nothing is put on hold automatically and no late fee is charged.
          </p>
        </div>

        {q.onHold.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-quaternary)]">On hold</div>
            <ul className="space-y-1 text-sm" data-testid="on-hold">
              {q.onHold.map(h => (
                <li key={h.organizationId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-secondary)] px-3 py-2">
                  <span><span className="font-medium">{h.organizationName ?? h.organizationId}</span> · since {day(h.holdAt)}{h.holdReason ? ` · ${h.holdReason}` : ''}</span>
                  {can.approve && <Button size="sm" variant="secondary" onClick={() => setHolding({ id: h.organizationId, name: h.organizationName ?? h.organizationId, onHold: false })}>Lift hold</Button>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      {deciding && <DecideNotice token={token} notice={deciding.notice} action={deciding.action} onClose={() => setDeciding(null)} onDone={async (m) => { setDeciding(null); setInfo(m); await changed(); }} />}
      {holding && <HoldDialog token={token} org={holding} onClose={() => setHolding(null)} onDone={async (m) => { setHolding(null); setInfo(m); await changed(); }} />}
      {editing && <PaymentDetailsDialog token={token} current={details.instructions} onClose={() => setEditing(false)} onDone={async () => { setEditing(false); setInfo('Payment details saved.'); await load(); }} />}
    </Card>
  );
}

function DecideNotice({ token, notice, action, onClose, onDone }: { token: string; notice: B2BPaymentNotice; action: 'confirm' | 'reject'; onClose: () => void; onDone: (message: string) => void }) {
  const [amount, setAmount] = useState(String(notice.amountTzs));
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (action === 'reject') {
        await api.rejectB2BPaymentNotice(token, notice.id, text);
        return onDone('The organisation has been told the payment was not found.');
      }
      const amountTzs = whole(amount);
      if (!Number.isFinite(amountTzs) || amountTzs <= 0) { setBusy(false); return setError(ERRORS.invalid_amount); }
      const out = await api.confirmB2BPaymentNotice(token, notice.id, { amountTzs, note: text.trim() || undefined });
      const left = out.payment?.unallocatedTzs ?? 0;
      const own = out.skipped?.some(s => s.reason === 'cannot_settle_own_invoice');
      onDone(`Payment ${out.payment?.number ?? ''} recorded.${left ? ` ${money(left)} is on the account as credit${own ? ' because you issued the invoice; a colleague has to apply it' : ''}.` : ''}`);
    } catch (err) {
      setError(said(err, action === 'confirm' ? 'Could not confirm the payment.' : 'Could not reject the notice.'));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={action === 'confirm' ? 'Confirm payment' : 'Payment not found'} size="md">
      <form className="space-y-3" onSubmit={go} data-testid="decide-notice">
        <p className="text-sm text-[var(--color-fg-tertiary)]">
          {notice.organizationName} · {PAYMENT_METHOD[notice.method] ?? notice.method} · {notice.reference} · paid {day(notice.paidOn)}
        </p>
        {error && <Alert tone="error">{error}</Alert>}
        {action === 'confirm' ? (
          <>
            <Field label="Amount on the statement (TZS)" hint={`The organisation said ${money(notice.amountTzs)}. Record what actually arrived.`}>
              <input className="ui-input" inputMode="numeric" required value={amount} onChange={e => setAmount(e.target.value)} data-testid="confirm-amount" />
            </Field>
            <Field label="Note (optional, internal)"><input className="ui-input" maxLength={1000} value={text} onChange={e => setText(e.target.value)} /></Field>
            <p className="text-xs text-[var(--color-fg-quaternary)]">Only confirm once you have seen the money on the bank or mobile-money statement. This records the payment and settles the invoices.</p>
          </>
        ) : (
          <Field label="Why" hint="The organisation sees this."><textarea className="ui-input" rows={3} required maxLength={500} value={text} onChange={e => setText(e.target.value)} data-testid="reject-reason" /></Field>
        )}
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} data-testid="decide-submit">{action === 'confirm' ? 'Confirm and record' : 'Tell the organisation'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function HoldDialog({ token, org, onClose, onDone }: { token: string; org: { id: string; name: string; onHold: boolean }; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.setB2BBillingHold(token, org.id, { onHold: org.onHold, reason: reason.trim() || undefined });
      onDone(org.onHold ? `${org.name} is on hold.` : `The hold on ${org.name} is lifted.`);
    } catch (err) {
      setError(said(err, 'Could not change the hold.'));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={org.onHold ? `Put ${org.name} on hold` : `Lift the hold on ${org.name}`} size="md">
      <form className="space-y-3" onSubmit={go} data-testid="hold-form">
        {error && <Alert tone="error">{error}</Alert>}
        {org.onHold ? (
          <>
            <p className="text-sm text-[var(--color-fg-tertiary)]">No new sponsored-pass invoices are prepared and pay-per-use benefits stop being funded until you lift it. Passes already paid for carry on. The organisation sees the reason.</p>
            <Field label="Reason"><textarea className="ui-input" rows={2} required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} data-testid="hold-reason" /></Field>
          </>
        ) : <p className="text-sm text-[var(--color-fg-tertiary)]">Sponsored passes and pay-per-use benefits resume straight away.</p>}
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{org.onHold ? 'Put on hold' : 'Lift hold'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

const DETAIL_FIELDS: Array<[keyof B2BPaymentInstructions, string]> = [
  ['bankName', 'Bank'], ['accountName', 'Account name'], ['accountNumber', 'Account number'], ['branch', 'Branch'], ['swiftCode', 'SWIFT code'],
  ['lipaNamba', 'Lipa Namba'], ['lipaNambaName', 'Lipa Namba name'],
];

function PaymentDetailsDialog({ token, current, onClose, onDone }: { token: string; current: B2BPaymentInstructions; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries([...DETAIL_FIELDS.map(([k]) => k), 'notes'].map(k => [k, (current[k as keyof B2BPaymentInstructions] as string | null) ?? ''])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.setB2BPaymentInstructions(token, f);
      onDone();
    } catch (err) {
      setError(said(err, 'Could not save the payment details.'));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title="FitFlex payment details" description="Shown to every organisation on its Billing page and in reminder emails." size="lg">
      <form className="space-y-3" onSubmit={go} data-testid="payment-details-form">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          {DETAIL_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}><input className="ui-input" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} data-testid={`details-${k}`} /></Field>
          ))}
        </div>
        <Field label="Anything else organisations should know (optional)"><textarea className="ui-input" rows={2} maxLength={1000} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} data-testid="details-save">Save</Button>
        </div>
      </form>
    </Dialog>
  );
}
