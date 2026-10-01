'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, B2BPassEntitlement, B2BProgram, B2BSponsorInvoice, B2BSponsorInvoiceLine } from '@/lib/api';
import { Alert, Badge, Button, Spinner } from '@/components/shared';

const ERRORS: Record<string, string> = {
  period_not_open: 'Flat fees can only be prepared for this month or next month.',
  period_not_ended: 'Per-use charges are invoiced after the month has ended.',
  program_not_active: 'Activate the programme first.',
  organization_not_active: 'The organisation is not active.',
  no_sponsored_pass: 'This programme has no active sponsored pass to invoice.',
  vat_rate_required: 'Enter the VAT rate as a percentage. Use 0 for none.',
  payment_reference_required: 'Enter the sponsor’s payment reference.',
  reason_required: 'Say why the invoice is being voided.',
  invalid_transition: 'That isn’t possible for an invoice in this state.',
};
const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? ERRORS[(err.body as { error?: string })?.error ?? ''] ?? fallback : fallback;

const TONE: Record<string, 'success' | 'warning' | 'gray' | 'danger'> = {
  draft: 'gray', issued: 'warning', paid: 'success', void: 'danger',
  active: 'success', awaiting_member: 'warning', awaiting_link: 'warning', scheduled: 'gray', invoiced: 'gray',
};
const PASS_STATE: Record<string, string> = {
  invoiced: 'Waiting for the sponsor to pay',
  scheduled: 'Starts when the month begins',
  awaiting_link: 'Not linked to a FitFlex account',
  awaiting_member: 'Waiting for the member’s share',
  active: 'Pass running',
};
const tzs = (n?: number | null) => (n == null ? '—' : `TZS ${n.toLocaleString('en-US')}`);
/** This month and its neighbours as "YYYY-MM", in East Africa Time. */
function months() {
  const eat = new Date(Date.now() + 3 * 3_600_000);
  const at = (delta: number) => {
    const d = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  return { last: at(-1), current: at(0), next: at(1) };
}

/**
 * Sponsor billing for one programme: who is covered by a sponsored pass this
 * month, and the invoices to the sponsor. FitFlex prepares, issues and settles
 * invoices here; this never pays a gym or trainer.
 */
export function B2BBilling({ token, program, hasPass }: { token: string; program: B2BProgram; hasPass: boolean }) {
  const { last, current, next } = months();
  const [invoices, setInvoices] = useState<B2BSponsorInvoice[] | null>(null);
  const [covered, setCovered] = useState<{ counts: Record<string, number>; entitlements: B2BPassEntitlement[] } | null>(null);
  const [open, setOpen] = useState<{ invoice: B2BSponsorInvoice; lines: B2BSponsorInvoiceLine[] } | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [list, people] = await Promise.all([
      api.adminB2BInvoices(token, { programId: program.id, limit: 100 }),
      hasPass ? api.b2bEntitlements(token, program.id, current) : Promise.resolve(null),
    ]);
    setInvoices(list.items);
    setCovered(people);
  };
  useEffect(() => {
    setOpen(null);
    load().catch(() => { setError('Could not load billing.'); setInvoices([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program.id]);

  const run = async (fn: () => Promise<string | void>, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const said = await fn();
      if (said) setNotice(said);
      await load();
    } catch (err) {
      setError(message(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const prepare = (kind: 'prepaid' | 'usage', period: string) => run(async () => {
    const r = await api.prepareB2BInvoice(token, program.id, kind, period);
    if (!r.invoice) return 'Nothing new to invoice.';
    return `${r.added} item${r.added === 1 ? '' : 's'} added${r.credited ? `, ${r.credited} credited` : ''}. Draft ${r.invoice.number} now totals ${tzs(r.invoice.totalTzs)}.`;
  }, 'Could not prepare the invoice.');

  const inspect = (inv: B2BSponsorInvoice) => run(async () => {
    setInput('');
    setOpen(await api.adminB2BInvoice(token, inv.id));
  }, 'Could not load the invoice.');

  const act = (fn: () => Promise<{ invoice: B2BSponsorInvoice }>, fallback: string) => run(async () => {
    const { invoice } = await fn();
    setInput('');
    setOpen(await api.adminB2BInvoice(token, invoice.id));
  }, fallback);

  const inv = open?.invoice;
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border-secondary)] p-3" data-testid="billing-panel">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {hasPass && (
        <div data-testid="billing-covered">
          <div className="mb-1 text-xs font-semibold">Covered in {current}</div>
          {covered == null ? <Spinner className="h-5 w-5" /> : covered.entitlements.length === 0 ? (
            <p className="text-xs text-[var(--color-fg-quaternary)]">Nobody yet. Prepare this month’s flat fees to nominate everyone eligible.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {covered.entitlements.map(e => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{e.beneficiaryName ?? e.beneficiaryId} <span className="text-[var(--color-fg-quaternary)]">· sponsor {tzs(e.sponsorTzs)} · member {tzs(e.memberTzs)}</span></span>
                  <Badge tone={TONE[e.status] ?? 'gray'}>{PASS_STATE[e.status] ?? e.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {hasPass && <Button size="sm" variant="secondary" disabled={busy} onClick={() => prepare('prepaid', current)} data-testid="billing-prepare-current">Prepare flat fees · {current}</Button>}
        {hasPass && <Button size="sm" variant="secondary" disabled={busy} onClick={() => prepare('prepaid', next)}>Prepare flat fees · {next}</Button>}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => prepare('usage', last)} data-testid="billing-prepare-usage">Prepare per-use charges · {last}</Button>
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold">Invoices</div>
        {invoices == null ? <Spinner className="h-5 w-5" /> : invoices.length === 0 ? (
          <p className="text-xs text-[var(--color-fg-quaternary)]">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="billing-invoices">
            {invoices.map(i => (
              <li key={i.id}>
                <button className={`flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left ${inv?.id === i.id ? 'text-[var(--color-fg-brand)]' : ''}`} onClick={() => inspect(i)} data-testid={`invoice-${i.id}`}>
                  <span><span className="font-medium">{i.number}</span> <span className="text-xs text-[var(--color-fg-quaternary)]">{i.kind === 'prepaid' ? 'Flat fees' : 'Per use'} · {i.period}</span></span>
                  <span className="flex items-center gap-2"><span className="text-xs">{tzs(i.totalTzs)}</span><Badge tone={TONE[i.status] ?? 'gray'}>{i.status}</Badge></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && inv && (
        <div className="space-y-2 border-t border-[var(--color-border-secondary)] pt-3 text-sm" data-testid="invoice-detail">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{inv.number}</span>
            <span className="text-xs text-[var(--color-fg-quaternary)]">
              Total {tzs(inv.totalTzs)} incl. VAT{inv.vatRateBps != null ? ` · VAT ${inv.vatRateBps / 100}% = ${tzs(inv.vatTzs)}` : ' · VAT stated when issued'}
            </span>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {open.lines.map(l => (
              <li key={l.id} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{l.description}</span>
                <span className="shrink-0">{tzs(l.amountTzs)}</span>
              </li>
            ))}
          </ul>
          {inv.status === 'paid' && <p className="text-xs text-[var(--color-fg-quaternary)]">Paid, reference {inv.paymentReference}.</p>}
          {inv.status === 'void' && <p className="text-xs text-[var(--color-fg-quaternary)]">Voided: {inv.voidReason}</p>}
          {(inv.status === 'draft' || inv.status === 'issued') && (
            <div className="flex flex-wrap items-center gap-2">
              <input className="ui-input w-auto flex-1" value={input} onChange={e => setInput(e.target.value)} data-testid="invoice-input"
                placeholder={inv.status === 'draft' ? 'VAT rate %, e.g. 18 (to issue) or a reason (to void)' : 'Payment reference (to mark paid) or a reason (to void)'} />
              {inv.status === 'draft' && (
                <Button size="sm" disabled={busy || input.trim() === '' || Number.isNaN(Number(input))} data-testid="invoice-issue"
                  onClick={() => act(() => api.issueB2BInvoice(token, inv.id, Math.round(Number(input) * 100)), 'Could not issue the invoice.')}>Issue</Button>
              )}
              {inv.status === 'issued' && (
                <Button size="sm" disabled={busy || !input.trim()} data-testid="invoice-pay"
                  onClick={() => act(() => api.payB2BInvoice(token, inv.id, input.trim()), 'Could not record the payment.')}>Mark paid</Button>
              )}
              <Button size="sm" variant="secondary" disabled={busy || !input.trim()} data-testid="invoice-void"
                onClick={() => act(() => api.voidB2BInvoice(token, inv.id, input.trim()), 'Could not void the invoice.')}>Void</Button>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-[var(--color-fg-quaternary)]">
        Flat fees are invoiced in advance for everyone nominated. When the sponsor’s payment is recorded, fully sponsored passes start and other members can pay their share to unlock. Per-use charges are invoiced after the month.
      </p>
    </div>
  );
}
