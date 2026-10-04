'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import {
  api, ApiError, B2BAgreement, B2BBillingAccount, B2BBillingDashboard, B2BInvoiceDetail, B2BPayment, B2BReconciliation,
  B2BSponsorInvoice, B2BStatement,
} from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, Field, PageHeader, Segmented, Spinner } from '@/components/shared';
import { Aging, Balances, InvoiceDocument, InvoiceStatus, PrintButton, StatementTable, INVOICE_KIND, PAYMENT_METHOD, day } from '@/components/b2b-finance';
import { money } from '@/lib/admin-utils';

type Tab = 'invoices' | 'payments' | 'statement' | 'agreement';

const ERRORS: Record<string, string> = {
  cannot_settle_own_invoice: 'You issued this invoice, so someone else has to record its payment.',
  cannot_issue_own_note: 'You drafted this note, so someone else has to issue it.',
  payment_reference_in_use: 'That reference is already recorded as a payment of a different amount. Apply that payment instead.',
  payment_reference_required: 'Enter the bank or mobile-money reference.',
  invalid_amount: 'Enter a whole amount in TZS, more than zero.',
  exceeds_outstanding: 'That is more than is still owed on the invoice.',
  exceeds_unallocated: 'That is more than is left on the payment.',
  invoice_not_open: 'That invoice is already paid, or isn’t issued yet.',
  payment_settled_invoices: 'This payment completed an invoice, and a paid invoice is final. Raise a debit note for what is owed instead.',
  invoice_has_payments: 'Money or a credit is already applied to this invoice. Reverse the payment first, or correct it with a note.',
  credit_exceeds_invoice: 'A credit can’t be more than the invoice less the credits already raised on it.',
  reason_required: 'Say why.',
  vat_rate_required: 'Enter the VAT rate as a percentage. Use 0 for none.',
  invalid_transition: 'That isn’t possible in this state.',
  agreement_dates_overlap: 'Those dates overlap an agreement that has already ended.',
  agreement_in_force: 'An agreement in force can’t be edited. End it and activate a new one.',
  invalid_effective_from: 'Enter the start date.',
  invalid_payment_terms: 'Payment terms are a number of days between 0 and 365.',
  invalid_platform_fee: 'Enter the monthly fee in whole TZS.',
  invalid_email: 'That email address doesn’t look right.',
  organization_not_active: 'The organisation is not active.',
  acl_forbidden: 'Your permissions don’t include this.',
};
const said = (e: unknown, fallback: string) => {
  const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
  return (code && ERRORS[code]) || fallback;
};
const thisMonth = () => {
  const eat = new Date(Date.now() + 3 * 3_600_000);
  return `${eat.getUTCFullYear()}-${String(eat.getUTCMonth() + 1).padStart(2, '0')}`;
};
const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

/**
 * FitFlex finance: what organisations have been invoiced, what they have
 * paid and what they owe; and per organisation its agreement, invoices,
 * payments and statement. Customer billing only: gym and trainer settlement
 * are separate and are shown here just for comparison.
 */
export default function B2BBillingPage() {
  const { token, user, hasPermission } = useApp();
  const [dash, setDash] = useState<B2BBillingDashboard | null>(null);
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [period, setPeriod] = useState(thisMonth());
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    try {
      setDash(await api.adminB2BBilling(token, period));
      setError(null);
    } catch {
      setError('Could not load billing.');
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, period]);
  useEffect(() => {
    if (!token) return;
    api.b2bOrganizations(token, { limit: 100 }).then(r => setOrgs(r.items.map(o => ({ id: o.id, name: o.tradingName || o.legalName })))).catch(() => undefined);
  }, [token]);

  if (!token || user?.userType !== 'admin') return null;
  const can = { bill: hasPermission('b2b_billing'), approve: hasPermission('b2b_billing_approve'), pay: hasPermission('b2b_payments') };

  if (org) return <OrganizationBilling token={token} org={org} can={can} userId={user.id} onBack={() => { setOrg(null); load(); }} />;

  return (
    <div className="space-y-5" data-testid="b2b-billing">
      <PageHeader title="B2B billing" description="What organisations have been invoiced, what they have paid and what they owe."
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
      {error && <Alert tone="error">{error}</Alert>}
      {!dash ? <Spinner className="h-6 w-6" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="billing-totals">
            {([['Invoiced', dash.totals.invoicedTzs], ['Collected', dash.totals.collectedTzs], ['Outstanding', dash.totals.outstandingTzs],
              ['Overdue', dash.totals.overdueTzs], ['Credit on accounts', dash.totals.creditTzs]] as Array<[string, number]>).map(([label, value]) => (
              <Card key={label}><CardContent className="py-4">
                <div className="text-xs text-[var(--color-fg-quaternary)]">{label}</div>
                <div className={`mt-1 text-lg font-semibold ${label === 'Overdue' && value > 0 ? 'text-[var(--color-error-600)]' : ''}`}>{money(value)}</div>
              </CardContent></Card>
            ))}
          </div>
          <Aging aging={dash.aging} />

          <Card>
            <CardContent className="space-y-2 py-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">Month</div>
                <input className="ui-input !w-auto" type="month" value={period} onChange={e => e.target.value && setPeriod(e.target.value)} data-testid="billing-period" />
              </div>
              <div>Drafts waiting to be issued for {dash.currentPeriod.period}: <span className="font-medium">{dash.currentPeriod.draftInvoices}</span> ({money(dash.currentPeriod.draftTotalTzs)})</div>
              <div className="grid gap-2 sm:grid-cols-3" data-testid="billed-vs-providers">
                <div className="rounded-lg border border-[var(--color-border-secondary)] px-3 py-2">
                  <div className="text-xs text-[var(--color-fg-quaternary)]">Billed to organisations</div>
                  <div className="font-medium">{money(dash.billedAgainstProviders.billedTzs)}</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border-secondary)] px-3 py-2">
                  <div className="text-xs text-[var(--color-fg-quaternary)]">Owed to gyms and trainers for the same activity</div>
                  <div className="font-medium">{money(dash.billedAgainstProviders.providerObligations.totalTzs)}</div>
                  <div className="text-xs text-[var(--color-fg-quaternary)]">
                    Gym visits {money(dash.billedAgainstProviders.providerObligations.gymVisitsTzs)} · passes {money(dash.billedAgainstProviders.providerObligations.sponsoredPassesTzs)} · trainers {money(dash.billedAgainstProviders.providerObligations.trainerSessionsTzs)}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--color-border-secondary)] px-3 py-2">
                  <div className="text-xs text-[var(--color-fg-quaternary)]">Difference</div>
                  <div className="font-medium">{money(dash.billedAgainstProviders.differenceTzs)}</div>
                </div>
              </div>
              <p className="text-xs text-[var(--color-fg-quaternary)]">
                Billing and provider settlement are separate. The difference is not revenue or profit: it leaves out members’ own shares, VAT, unpaid invoices and months not yet settled.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Organisations</div>
                <select className="ui-input !w-auto" value="" onChange={(e) => { const o = orgs.find(x => x.id === e.target.value); if (o) setOrg(o); }} data-testid="billing-open-org">
                  <option value="">Open an organisation…</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              {dash.organizations.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">Nothing has been invoiced yet.</p> : (
                <table className="w-full text-sm" data-testid="billing-organizations">
                  <thead>
                    <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                      <th className="py-2 pr-3">Organisation</th><th className="py-2 pr-3 text-right">Invoiced</th><th className="py-2 pr-3 text-right">Collected</th>
                      <th className="py-2 pr-3 text-right">Outstanding</th><th className="py-2 pr-3 text-right">Overdue</th><th className="py-2 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.organizations.map(o => (
                      <tr key={o.organizationId} className="border-b border-[var(--color-border-secondary)]">
                        <td className="py-2 pr-3"><button className="font-medium text-[var(--color-fg-brand)]" onClick={() => setOrg({ id: o.organizationId, name: o.name })}>{o.name}</button></td>
                        <td className="py-2 pr-3 text-right">{money(o.invoicedTzs)}</td>
                        <td className="py-2 pr-3 text-right">{money(o.collectedTzs)}</td>
                        <td className="py-2 pr-3 text-right">{money(o.outstandingTzs)}</td>
                        <td className={`py-2 pr-3 text-right ${o.overdueTzs > 0 ? 'text-[var(--color-error-600)]' : ''}`}>{o.overdueTzs ? money(o.overdueTzs) : ''}</td>
                        <td className="py-2 text-right">{o.creditTzs ? money(o.creditTzs) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

type Can = { bill: boolean; approve: boolean; pay: boolean };

function OrganizationBilling({ token, org, can, userId, onBack }: { token: string; org: { id: string; name: string }; can: Can; userId: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('invoices');
  const [statement, setStatement] = useState<B2BStatement | null>(null);
  const [invoices, setInvoices] = useState<B2BSponsorInvoice[] | null>(null);
  const [payments, setPayments] = useState<B2BPayment[] | null>(null);
  const [agreements, setAgreements] = useState<{ agreements: B2BAgreement[]; inForce: B2BAgreement | null } | null>(null);
  const [account, setAccount] = useState<B2BBillingAccount | null>(null);
  const [open, setOpen] = useState<B2BInvoiceDetail | null>(null);
  const [trace, setTrace] = useState<B2BReconciliation | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One free-text field and one amount field serve each action, as on the programme billing panel.
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [payment, setPayment] = useState({ amount: '', method: 'bank_transfer', reference: '', receivedAt: '', mode: 'auto' as 'auto' | 'choose' | 'hold' });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState<B2BPayment | null>(null);
  const [feePeriod, setFeePeriod] = useState(thisMonth());
  const [draft, setDraft] = useState({ effectiveFrom: '', prepaidTermsDays: '0', usageTermsDays: '14', platformFee: '', vatPct: '', contractReference: '' });
  const [contact, setContact] = useState({ contactName: '', email: '', phone: '' });

  const load = async () => {
    const [s, i, p, a, acc] = await Promise.all([
      api.adminB2BStatement(token, org.id, { from: range.from || undefined, to: range.to || undefined }),
      api.adminB2BInvoices(token, { organizationId: org.id, limit: 100 }),
      api.adminB2BPayments(token, org.id),
      api.adminB2BAgreements(token, org.id),
      api.adminB2BBillingAccount(token, org.id),
    ]);
    setStatement(s); setInvoices(i.items); setPayments(p.items); setAgreements(a); setAccount(acc.account);
    setContact({ contactName: acc.account.contactName ?? '', email: acc.account.email ?? '', phone: acc.account.phone ?? '' });
  };
  useEffect(() => {
    load().catch(() => setError('Could not load this organisation’s billing.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  const run = async (fn: () => Promise<string | void>, fallback: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const told = await fn();
      if (told) setNotice(told);
      await load();
    } catch (e) {
      setError(said(e, fallback));
    } finally {
      setBusy(false);
    }
  };
  const view = (invoiceId: string) => run(async () => {
    setTrace(null); setText(''); setAmount('');
    setOpen(await api.adminB2BInvoiceDetail(token, invoiceId));
  }, 'Could not open that invoice.');
  const refreshOpen = async (invoiceId: string) => setOpen(await api.adminB2BInvoiceDetail(token, invoiceId));

  const openInvoices = (invoices ?? []).filter(i => i.totalTzs > 0 && (i.status === 'issued' || i.status === 'partially_paid'));

  const record = () => run(async () => {
    const amountTzs = whole(payment.amount);
    const allocations = payment.mode === 'choose'
      ? Object.entries(picked).filter(([, v]) => whole(v) > 0).map(([invoiceId, v]) => ({ invoiceId, amountTzs: whole(v) }))
      : undefined;
    const r = await api.recordB2BPayment(token, org.id, {
      amountTzs, method: payment.method, reference: payment.reference.trim(),
      receivedAt: payment.receivedAt ? new Date(`${payment.receivedAt}T09:00:00`).toISOString() : undefined,
      autoAllocate: payment.mode === 'auto', allocations,
    });
    setPayment({ ...payment, amount: '', reference: '' }); setPicked({});
    if (r.existing) return `That reference was already recorded as ${r.payment.number}. Nothing was recorded twice.`;
    const skipped = r.skipped?.length ? ` ${r.skipped.length} invoice(s) you issued were skipped: someone else has to settle those.` : '';
    return `${r.payment.number} recorded. ${money(r.payment.allocatedTzs)} applied to invoices, ${money(r.payment.unallocatedTzs)} left on the account.${skipped}`;
  }, 'Could not record the payment.');

  const inv = open?.invoice;
  const isNote = inv?.kind === 'credit_note' || inv?.kind === 'debit_note';

  return (
    <div className="space-y-5" data-testid="org-billing-admin">
      <div className="print:hidden">
        <PageHeader title={org.name} description="Agreement, invoices, payments and statement."
          actions={<Button variant="secondary" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />All organisations</Button>} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {statement && !open && <div className="print:hidden"><Balances b={statement} /></div>}

      {open && inv && (
        <Card>
          <CardContent className="space-y-3 py-5">
            <Button variant="secondary" size="sm" onClick={() => { setOpen(null); setTrace(null); }} className="print:hidden"><ArrowLeft className="h-4 w-4" />Back</Button>
            <InvoiceDocument detail={open} organizationName={org.name} actions={(
              <div className="space-y-3 border-t border-[var(--color-border-secondary)] pt-3" data-testid="invoice-actions">
                {inv.status === 'draft' && (
                  <div className="flex flex-wrap items-end gap-2">
                    {!isNote && <Field label="VAT rate %"><input className="ui-input !w-28" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="18" data-testid="invoice-vat" /></Field>}
                    {isNote ? (
                      <Button size="sm" disabled={busy || !can.approve || inv.createdBy === userId} data-testid="note-issue"
                        onClick={() => run(async () => { await api.issueB2BNote(token, inv.id); await refreshOpen(inv.id); }, 'Could not issue the note.')}>Issue note</Button>
                    ) : (
                      <Button size="sm" disabled={busy || !can.bill || amount.trim() === '' || Number.isNaN(Number(amount))} data-testid="invoice-issue"
                        onClick={() => run(async () => { await api.issueB2BInvoice(token, inv.id, Math.round(Number(amount) * 100)); await refreshOpen(inv.id); }, 'Could not issue the invoice.')}>Issue</Button>
                    )}
                    {isNote && inv.createdBy === userId && <span className="text-xs text-[var(--color-fg-quaternary)]">You drafted this note. Someone else has to issue it.</span>}
                  </div>
                )}
                {(inv.status === 'draft' || inv.status === 'issued') && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Reason (to void)"><input className="ui-input !w-72" value={text} onChange={e => setText(e.target.value)} data-testid="invoice-reason" /></Field>
                    <Button size="sm" variant="secondary" disabled={busy || !can.bill || !text.trim()} data-testid="invoice-void"
                      onClick={() => run(async () => { await api.voidB2BInvoice(token, inv.id, text.trim()); await refreshOpen(inv.id); }, 'Could not void the invoice.')}>Void</Button>
                  </div>
                )}
                {!isNote && ['issued', 'partially_paid', 'paid'].includes(inv.status) && inv.totalTzs > 0 && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Correction amount (TZS)"><input className="ui-input !w-40" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} data-testid="note-amount" /></Field>
                    <Field label="Why"><input className="ui-input !w-72" value={text} onChange={e => setText(e.target.value)} data-testid="note-reason" /></Field>
                    {(['credit', 'debit'] as const).map(type => (
                      <Button key={type} size="sm" variant="secondary" disabled={busy || !can.bill || !(whole(amount) > 0) || !text.trim()} data-testid={`note-${type}`}
                        onClick={() => run(async () => {
                          const { note } = await api.createB2BNote(token, inv.id, { type, amountTzs: whole(amount), reason: text.trim() });
                          setAmount(''); setText(''); await refreshOpen(inv.id);
                          return `${type === 'credit' ? 'Credit' : 'Debit'} note drafted (${money(note.totalTzs)}). Someone else has to issue it.`;
                        }, 'Could not draft the note.')}>{type === 'credit' ? 'Draft credit note' : 'Draft debit note'}</Button>
                    ))}
                  </div>
                )}
                <Button size="sm" variant="secondary" disabled={busy} data-testid="invoice-trace"
                  onClick={() => run(async () => setTrace(await api.adminB2BReconciliation(token, inv.id)), 'Could not trace the invoice.')}>Trace to usage</Button>
              </div>
            )} />
            {trace && (
              <div className="space-y-2 border-t border-[var(--color-border-secondary)] pt-3 text-xs print:hidden" data-testid="invoice-reconciliation">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={trace.checks.linesAddUp ? 'success' : 'danger'}>{trace.checks.linesAddUp ? 'Lines add up to the total' : 'Lines do not add up'}</Badge>
                  <Badge tone={trace.checks.usageMatchesLedger ? 'success' : 'danger'}>{trace.checks.usageMatchesLedger ? 'Usage matches the ledger' : 'Usage differs from the ledger'}</Badge>
                  {trace.checks.reversedSinceInvoiced.length > 0 && <Badge tone="warning">{trace.checks.reversedSinceInvoiced.length} reversed since; credited on the next usage invoice</Badge>}
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border-secondary)] text-left text-[var(--color-fg-quaternary)]">
                      <th className="py-1 pr-2">Line</th><th className="py-1 pr-2 text-right">Charged</th><th className="py-1 pr-2">What it charges for</th><th className="py-1">Provider side (separate)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.lines.map(l => (
                      <tr key={l.lineId} className="border-b border-[var(--color-border-secondary)] align-top">
                        <td className="py-1 pr-2">{l.description}</td>
                        <td className="py-1 pr-2 text-right">{money(l.amountTzs)}</td>
                        <td className="py-1 pr-2">
                          {l.consumption && `${l.consumption.sourceType === 'gym_checkin' ? 'Gym visit' : 'Trainer session'} on ${l.consumption.businessDate} · value ${money(l.consumption.grossTzs)} · sponsor ${money(l.consumption.sponsorTzs)} · ${l.consumption.status}`}
                          {l.entitlement && `${l.entitlement.passTier} pass · list ${money(l.entitlement.listPriceTzs)} · fee ${money(l.entitlement.feeTzs)} · sponsor ${money(l.entitlement.sponsorTzs)} · member ${money(l.entitlement.memberTzs)} · ${l.entitlement.status}`}
                          {!l.consumption && !l.entitlement && (l.kind === 'fee' ? 'The agreement’s platform fee' : 'A correction')}
                        </td>
                        <td className="py-1">
                          {!l.provider ? '—'
                            : l.provider.outcome === 'not_settled_yet' ? 'Not settled yet'
                              : l.provider.gymsOwedTzs != null ? `Gyms owed ${money(l.provider.gymsOwedTzs)} for this pass`
                                : `${l.provider.outcome}${l.provider.statementStatus ? ` · statement ${l.provider.statementStatus}` : ''}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!open && (
        <>
          <Segmented className="w-fit print:hidden" value={tab} onChange={v => setTab(v as Tab)}
            options={[['invoices', 'Invoices'], ['payments', 'Payments'], ['statement', 'Statement'], ['agreement', 'Agreement and account']]} />

          {tab === 'invoices' && (
            <Card>
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Platform fee for"><input className="ui-input !w-auto" type="month" value={feePeriod} onChange={e => setFeePeriod(e.target.value)} /></Field>
                  <Button size="sm" variant="secondary" disabled={busy || !can.bill} data-testid="fee-prepare"
                    onClick={() => run(async () => {
                      const r = await api.prepareB2BFee(token, org.id, feePeriod);
                      if (!r.invoice) return r.reason === 'no_agreement' ? 'No agreement is in force for that month.' : 'The agreement for that month has no platform fee.';
                      return r.added ? `Drafted a platform-fee invoice of ${money(r.invoice.totalTzs)}.` : 'That month’s platform fee is already invoiced.';
                    }, 'Could not prepare the fee.')}>Prepare platform fee</Button>
                  <span className="text-xs text-[var(--color-fg-quaternary)]">Pass and per-use invoices are prepared on each programme, under B2B organisations.</span>
                </div>
                {!invoices ? <Spinner className="h-5 w-5" /> : invoices.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No invoices yet.</p> : (
                  <table className="w-full text-sm" data-testid="admin-invoices">
                    <thead>
                      <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                        <th className="py-2 pr-3">Number</th><th className="py-2 pr-3">For</th><th className="py-2 pr-3">Due</th>
                        <th className="py-2 pr-3 text-right">Total</th><th className="py-2 pr-3 text-right">Still owed</th><th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(i => (
                        <tr key={i.id} className="border-b border-[var(--color-border-secondary)]">
                          <td className="py-2 pr-3"><button className="font-medium text-[var(--color-fg-brand)]" onClick={() => view(i.id)} data-testid={`admin-invoice-${i.id}`}>{i.number}</button></td>
                          <td className="py-2 pr-3">{INVOICE_KIND[i.kind] ?? i.kind} · {i.period}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{i.totalTzs > 0 ? day(i.dueDate) : '—'}</td>
                          <td className="py-2 pr-3 text-right">{money(i.totalTzs)}</td>
                          <td className="py-2 pr-3 text-right">{i.outstandingTzs ? money(i.outstandingTzs) : ''}</td>
                          <td className="py-2"><InvoiceStatus invoice={i} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}

          {tab === 'payments' && (
            <div className="space-y-4">
              <Card>
                <CardContent className="space-y-3 py-4" data-testid="payment-form">
                  <div className="text-sm font-semibold">Record a payment</div>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Amount (TZS)"><input className="ui-input" inputMode="numeric" value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} data-testid="payment-amount" /></Field>
                    <Field label="How it was paid">
                      <select className="ui-input" value={payment.method} onChange={e => setPayment({ ...payment, method: e.target.value })} data-testid="payment-method">
                        {Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </Field>
                    <Field label="Bank or mobile-money reference"><input className="ui-input" value={payment.reference} onChange={e => setPayment({ ...payment, reference: e.target.value })} data-testid="payment-reference" /></Field>
                    <Field label="Received on (blank = today)"><input className="ui-input" type="date" value={payment.receivedAt} onChange={e => setPayment({ ...payment, receivedAt: e.target.value })} /></Field>
                  </div>
                  <Segmented className="w-fit" value={payment.mode} onChange={v => setPayment({ ...payment, mode: v as typeof payment.mode })}
                    options={[['auto', 'Settle the oldest invoices first'], ['choose', 'Choose invoices'], ['hold', 'Keep on the account']]} />
                  {payment.mode === 'choose' && (openInvoices.length === 0 ? <p className="text-xs text-[var(--color-fg-quaternary)]">No invoice is waiting for payment.</p> : (
                    <ul className="space-y-1 text-sm">
                      {openInvoices.map(i => (
                        <li key={i.id} className="flex flex-wrap items-center gap-2">
                          <span className="w-56">{i.number} · owed {money(i.outstandingTzs)}</span>
                          <input className="ui-input !w-40" inputMode="numeric" placeholder="Amount to apply" value={picked[i.id] ?? ''} onChange={e => setPicked({ ...picked, [i.id]: e.target.value })} data-testid={`payment-apply-${i.id}`} />
                        </li>
                      ))}
                    </ul>
                  ))}
                  <Button size="sm" disabled={busy || !can.pay || !(whole(payment.amount) > 0) || !payment.reference.trim()} onClick={record} data-testid="payment-record">Record payment</Button>
                  <p className="text-xs text-[var(--color-fg-quaternary)]">The same reference is one payment: recording it again changes nothing. Whoever issued an invoice can’t record its payment. Anything not applied stays on the account as credit.</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  {!payments ? <Spinner className="h-5 w-5" /> : payments.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No payments recorded.</p> : (
                    <table className="w-full text-sm" data-testid="admin-payments">
                      <thead>
                        <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                          <th className="py-2 pr-3">Received</th><th className="py-2 pr-3">Receipt</th><th className="py-2 pr-3">How · reference</th>
                          <th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3 text-right">Not applied</th><th className="py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map(p => (
                          <tr key={p.id} className="border-b border-[var(--color-border-secondary)]">
                            <td className="py-2 pr-3 whitespace-nowrap">{day(p.receivedAt)}</td>
                            <td className="py-2 pr-3 font-medium">{p.number}</td>
                            <td className="py-2 pr-3">{PAYMENT_METHOD[p.method] ?? p.method} · {p.reference}{p.status === 'reversed' ? ` · reversed: ${p.reversalReason}` : ''}</td>
                            <td className="py-2 pr-3 text-right">{money(p.amountTzs)}</td>
                            <td className="py-2 pr-3 text-right">{p.unallocatedTzs ? money(p.unallocatedTzs) : ''}</td>
                            <td className="py-2 text-right">
                              {p.status === 'reversed' ? <Badge tone="danger">Reversed</Badge> : (
                                <span className="flex justify-end gap-2">
                                  {p.unallocatedTzs > 0 && <Button size="sm" variant="secondary" disabled={busy || !can.pay} onClick={() => { setApplying(p); setPicked({}); }} data-testid={`payment-apply-open-${p.id}`}>Apply</Button>}
                                  <Button size="sm" variant="secondary" disabled={busy || !can.approve} data-testid={`payment-reverse-${p.id}`}
                                    onClick={() => { const why = window.prompt('Why is this payment being reversed?'); if (why?.trim()) run(async () => { await api.reverseB2BPayment(token, p.id, why.trim()); }, 'Could not reverse the payment.'); }}>Reverse</Button>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {applying && (
                    <div className="mt-3 space-y-2 border-t border-[var(--color-border-secondary)] pt-3 text-sm" data-testid="payment-apply-panel">
                      <div className="font-semibold">Apply {applying.number}: {money(applying.unallocatedTzs)} left</div>
                      {openInvoices.length === 0 ? <p className="text-xs text-[var(--color-fg-quaternary)]">No invoice is waiting for payment.</p> : openInvoices.map(i => (
                        <div key={i.id} className="flex flex-wrap items-center gap-2">
                          <span className="w-56">{i.number} · owed {money(i.outstandingTzs)}</span>
                          <input className="ui-input !w-40" inputMode="numeric" placeholder="Amount to apply" value={picked[i.id] ?? ''} onChange={e => setPicked({ ...picked, [i.id]: e.target.value })} />
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy || !Object.values(picked).some(v => whole(v) > 0)}
                          onClick={() => run(async () => {
                            await api.allocateB2BPayment(token, applying.id, Object.entries(picked).filter(([, v]) => whole(v) > 0).map(([invoiceId, v]) => ({ invoiceId, amountTzs: whole(v) })));
                            setApplying(null); setPicked({});
                          }, 'Could not apply the payment.')}>Apply</Button>
                        <Button size="sm" variant="secondary" onClick={() => setApplying(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'statement' && (statement ? (
            <Card>
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="font-semibold">Statement of account · {statement.organization.name}</div>
                    <div className="text-xs text-[var(--color-fg-quaternary)]">{statement.from || statement.to ? `${day(statement.from)} to ${day(statement.to)}` : 'All dates'} · as of {day(statement.asOf)}</div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 print:hidden">
                    <input className="ui-input !w-auto" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} aria-label="From" />
                    <input className="ui-input !w-auto" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} aria-label="To" />
                    <Button variant="secondary" size="sm" onClick={() => run(async () => undefined, 'Could not load the statement.')}>Show</Button>
                    <PrintButton />
                  </div>
                </div>
                <Aging aging={statement.aging} />
                <StatementTable statement={statement} onOpen={view} />
              </CardContent>
            </Card>
          ) : <Spinner className="h-5 w-5" />)}

          {tab === 'agreement' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="space-y-3 py-4 text-sm" data-testid="agreement-panel">
                  <div className="font-semibold">Commercial agreement</div>
                  {agreements?.inForce
                    ? <div>In force: <span className="font-medium">{agreements.inForce.reference}</span> · invoices in advance due in {agreements.inForce.prepaidTermsDays} days, after the month in {agreements.inForce.usageTermsDays} days{agreements.inForce.platformFeeTzs ? ` · platform fee ${money(agreements.inForce.platformFeeTzs)} a month` : ''}</div>
                    : <div className="text-[var(--color-fg-quaternary)]">None in force: FitFlex standard terms apply (advance invoices due on issue, usage invoices in 14 days, no platform fee).</div>}
                  <ul className="space-y-1">
                    {agreements?.agreements.map(a => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{a.reference} · {day(a.effectiveFrom)} to {a.effectiveTo ? day(a.effectiveTo) : 'open'}{a.platformFeeTzs ? ` · fee ${money(a.platformFeeTzs)}` : ''}</span>
                        <span className="flex items-center gap-2">
                          <Badge tone={a.status === 'active' ? 'success' : 'gray'}>{a.status === 'active' ? 'In force' : a.status === 'draft' ? 'Draft' : 'Ended'}</Badge>
                          {a.status === 'draft' && <Button size="sm" disabled={busy || !can.bill} onClick={() => run(async () => { await api.activateB2BAgreement(token, a.id); }, 'Could not activate the agreement.')} data-testid={`agreement-activate-${a.id}`}>Activate</Button>}
                          {a.status === 'active' && <Button size="sm" variant="secondary" disabled={busy || !can.bill} onClick={() => { if (window.confirm('End this agreement today? Invoices already issued keep its terms.')) run(async () => { await api.endB2BAgreement(token, a.id); }, 'Could not end the agreement.'); }}>End</Button>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-3 border-t border-[var(--color-border-secondary)] pt-3 sm:grid-cols-2">
                    <Field label="Starts on"><input className="ui-input" type="date" value={draft.effectiveFrom} onChange={e => setDraft({ ...draft, effectiveFrom: e.target.value })} data-testid="agreement-from" /></Field>
                    <Field label="Contract reference (optional)"><input className="ui-input" value={draft.contractReference} onChange={e => setDraft({ ...draft, contractReference: e.target.value })} /></Field>
                    <Field label="Days to pay advance invoices"><input className="ui-input" inputMode="numeric" value={draft.prepaidTermsDays} onChange={e => setDraft({ ...draft, prepaidTermsDays: e.target.value })} /></Field>
                    <Field label="Days to pay usage invoices"><input className="ui-input" inputMode="numeric" value={draft.usageTermsDays} onChange={e => setDraft({ ...draft, usageTermsDays: e.target.value })} /></Field>
                    <Field label="Platform fee a month, TZS incl. VAT (optional)"><input className="ui-input" inputMode="numeric" value={draft.platformFee} onChange={e => setDraft({ ...draft, platformFee: e.target.value })} data-testid="agreement-fee" /></Field>
                    <Field label="Usual VAT rate % (optional)" hint="Offered when an invoice is issued."><input className="ui-input" inputMode="decimal" value={draft.vatPct} onChange={e => setDraft({ ...draft, vatPct: e.target.value })} /></Field>
                  </div>
                  <Button size="sm" disabled={busy || !can.bill || !draft.effectiveFrom} data-testid="agreement-create"
                    onClick={() => run(async () => {
                      const { agreement } = await api.createB2BAgreement(token, org.id, {
                        effectiveFrom: draft.effectiveFrom, prepaidTermsDays: whole(draft.prepaidTermsDays), usageTermsDays: whole(draft.usageTermsDays),
                        platformFeeTzs: draft.platformFee.trim() ? whole(draft.platformFee) : null,
                        vatRateBps: draft.vatPct.trim() ? Math.round(Number(draft.vatPct) * 100) : null,
                        contractReference: draft.contractReference.trim() || null,
                      });
                      return `${agreement.reference} drafted. Activate it to put it in force.`;
                    }, 'Could not draft the agreement.')}>Draft agreement</Button>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-3 py-4 text-sm" data-testid="account-panel">
                  <div className="font-semibold">Invoices are sent to</div>
                  {account && account.source !== 'billing_account' && (
                    <p className="text-xs text-[var(--color-fg-quaternary)]">Using {account.source === 'corporate_account' ? 'the company’s billing contact from Corporate' : 'the organisation’s own contact'} until one is saved here.</p>
                  )}
                  <Field label="Contact name"><input className="ui-input" value={contact.contactName} onChange={e => setContact({ ...contact, contactName: e.target.value })} /></Field>
                  <Field label="Email"><input className="ui-input" type="email" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} data-testid="account-email" /></Field>
                  <Field label="Phone"><input className="ui-input" value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></Field>
                  {account?.taxIdentificationNumber && <div className="text-xs text-[var(--color-fg-quaternary)]">TIN {account.taxIdentificationNumber}</div>}
                  <Button size="sm" disabled={busy || !can.bill} data-testid="account-save"
                    onClick={() => run(async () => { await api.setB2BBillingAccount(token, org.id, contact); return 'Billing contact saved.'; }, 'Could not save the billing contact.')}>Save</Button>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
