'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../providers';
import { api, ApiError, ORG_BILLING_ROLES, B2BInvoiceDetail, B2BOrgBilling, B2BPayment, B2BSponsorInvoice, B2BStatement } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Segmented, Spinner } from '@/components/shared';
import { Aging, Balances, InvoiceDocument, InvoiceStatus, PrintButton, StatementTable, INVOICE_KIND, PAYMENT_METHOD, day } from '@/components/b2b-finance';
import { money } from '@/lib/admin-utils';

type Tab = 'overview' | 'invoices' | 'payments' | 'statement';
type Org = { id: string; name: string; role: string };

const failed = (e: unknown, fallback: string) =>
  (e instanceof ApiError && e.status === 403 ? 'Your role in this organisation doesn’t include billing. Ask its owner or admin.' : fallback);

/**
 * An organisation's own billing: what it owes, its invoices and what each one
 * charges for, the payments FitFlex has recorded, and its statement. Read
 * only; FitFlex raises invoices and records payments.
 */
export default function OrganizationBillingPage() {
  const { token } = useApp();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<B2BOrgBilling | null>(null);
  const [invoices, setInvoices] = useState<B2BSponsorInvoice[] | null>(null);
  const [payments, setPayments] = useState<B2BPayment[] | null>(null);
  const [statement, setStatement] = useState<B2BStatement | null>(null);
  const [open, setOpen] = useState<B2BInvoiceDetail | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.myB2BOrganizations(token)
      .then((r) => {
        const mine = r.organizations.filter(o => ORG_BILLING_ROLES.has(o.role)).map(o => ({ id: o.id, name: o.tradingName || o.legalName, role: o.role }));
        setOrgs(mine);
        setOrgId(id => id || mine[0]?.id || '');
      })
      .catch(() => { setOrgs([]); setError('Could not load your organisations.'); });
  }, [token]);

  useEffect(() => {
    if (!token || !orgId) return;
    setOpen(null);
    setError(null);
    setOverview(null); setInvoices(null); setPayments(null); setStatement(null);
    api.orgBilling(token, orgId).then(setOverview).catch(e => setError(failed(e, 'Could not load billing.')));
    api.orgInvoices(token, orgId).then(r => setInvoices(r.items)).catch(() => setInvoices([]));
    api.orgPayments(token, orgId).then(r => setPayments(r.items)).catch(() => setPayments([]));
    api.orgStatement(token, orgId).then(setStatement).catch(() => undefined);
  }, [token, orgId]);

  const openInvoice = async (invoiceId: string) => {
    if (!token) return;
    try {
      setOpen(await api.orgInvoice(token, orgId, invoiceId));
    } catch (e) {
      setError(failed(e, 'Could not open that invoice.'));
    }
  };
  const applyRange = async () => {
    if (!token) return;
    try {
      setStatement(await api.orgStatement(token, orgId, { from: range.from || undefined, to: range.to || undefined }));
    } catch (e) {
      setError(failed(e, 'Could not load the statement.'));
    }
  };

  if (!token) return null;
  if (orgs === null) return <Spinner className="h-6 w-6" />;
  const org = orgs.find(o => o.id === orgId);

  return (
    <div className="space-y-5" data-testid="org-billing">
      <div className="print:hidden">
        <PageHeader title="Billing" description={org ? `${org.name} · what you owe FitFlex, your invoices and payments.` : 'Your organisation’s billing with FitFlex.'} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {orgs.length === 0 && !error && <Alert tone="info">Your role doesn’t include billing. The organisation’s owner or admin can give you the finance role.</Alert>}
      {orgs.length > 1 && (
        <select className="ui-input !w-auto print:hidden" value={orgId} onChange={e => setOrgId(e.target.value)} data-testid="org-picker">
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}

      {org && open && (
        <Card>
          <CardContent className="space-y-3 py-5">
            <Button variant="secondary" size="sm" onClick={() => setOpen(null)} className="print:hidden"><ArrowLeft className="h-4 w-4" />Back</Button>
            <InvoiceDocument detail={open} organizationName={org.name} />
            <p className="text-xs text-[var(--color-fg-quaternary)] print:hidden">
              Sponsored passes are listed per person. Per-use benefits are totalled per benefit and person; FitFlex doesn’t show when or where a member trained.
            </p>
          </CardContent>
        </Card>
      )}

      {org && !open && (
        <>
          <Segmented className="print:hidden w-fit" value={tab} onChange={v => setTab(v as Tab)}
            options={[['overview', 'Overview'], ['invoices', 'Invoices'], ['payments', 'Payments'], ['statement', 'Statement']]} />

          {tab === 'overview' && (overview ? (
            <div className="space-y-4">
              <Balances b={overview} />
              <Aging aging={overview.aging} />
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardContent className="space-y-1 py-4 text-sm">
                    <div className="mb-1 font-semibold">Payment terms</div>
                    <div>Invoices raised in advance (passes, platform fee): {overview.terms.prepaidTermsDays === 0 ? 'due when issued' : `due in ${overview.terms.prepaidTermsDays} days`}</div>
                    <div>Invoices raised after the month (per-use benefits): due in {overview.terms.usageTermsDays} days</div>
                    {overview.terms.platformFeeTzs != null && <div>Platform fee: {money(overview.terms.platformFeeTzs)} a month</div>}
                    <div className="text-xs text-[var(--color-fg-quaternary)]">{overview.terms.reference ? `Agreement ${overview.terms.reference}${overview.terms.contractReference ? ` · ${overview.terms.contractReference}` : ''}` : 'FitFlex standard terms'} · billed monthly · amounts include VAT</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-1 py-4 text-sm">
                    <div className="mb-1 font-semibold">Invoices are sent to</div>
                    <div>{overview.account.contactName ?? '—'}</div>
                    <div>{overview.account.email ?? '—'} {overview.account.phone ? `· ${overview.account.phone}` : ''}</div>
                    {overview.account.taxIdentificationNumber && <div>TIN {overview.account.taxIdentificationNumber}</div>}
                    <div className="text-xs text-[var(--color-fg-quaternary)]">To change this, contact FitFlex.</div>
                  </CardContent>
                </Card>
              </div>
              <InvoiceList invoices={overview.recentInvoices} onOpen={openInvoice} empty="No invoices yet." title="Latest invoices" />
            </div>
          ) : <Spinner className="h-6 w-6" />)}

          {tab === 'invoices' && (invoices ? <InvoiceList invoices={invoices} onOpen={openInvoice} empty="No invoices yet." /> : <Spinner className="h-6 w-6" />)}

          {tab === 'payments' && (payments ? (
            <Card>
              <CardContent className="py-4">
                {payments.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">FitFlex hasn’t recorded a payment from you yet.</p> : (
                  <table className="w-full text-sm" data-testid="org-payments">
                    <thead>
                      <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                        <th className="py-2 pr-3">Received</th><th className="py-2 pr-3">Receipt</th><th className="py-2 pr-3">How</th><th className="py-2 pr-3">Your reference</th>
                        <th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3 text-right">Not yet applied</th><th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map(p => (
                        <tr key={p.id} className="border-b border-[var(--color-border-secondary)]">
                          <td className="py-2 pr-3 whitespace-nowrap">{day(p.receivedAt)}</td>
                          <td className="py-2 pr-3 font-medium">{p.number}</td>
                          <td className="py-2 pr-3">{PAYMENT_METHOD[p.method] ?? p.method}</td>
                          <td className="py-2 pr-3">{p.reference}</td>
                          <td className="py-2 pr-3 text-right">{money(p.amountTzs)}</td>
                          <td className="py-2 pr-3 text-right">{p.unallocatedTzs ? money(p.unallocatedTzs) : ''}</td>
                          <td className="py-2">{p.status === 'reversed' ? <Badge tone="danger">Reversed</Badge> : <Badge tone="success">Received</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          ) : <Spinner className="h-6 w-6" />)}

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
                    <Button variant="secondary" size="sm" onClick={applyRange}>Show</Button>
                    <PrintButton />
                  </div>
                </div>
                <StatementTable statement={statement} onOpen={openInvoice} />
              </CardContent>
            </Card>
          ) : <Spinner className="h-6 w-6" />)}
        </>
      )}
    </div>
  );
}

function InvoiceList({ invoices, onOpen, empty, title }: { invoices: B2BSponsorInvoice[]; onOpen: (id: string) => void; empty: string; title?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        {title && <div className="mb-2 text-sm font-semibold">{title}</div>}
        {invoices.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{empty}</p> : (
          <table className="w-full text-sm" data-testid="org-invoices">
            <thead>
              <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                <th className="py-2 pr-3">Number</th><th className="py-2 pr-3">For</th><th className="py-2 pr-3">Issued</th><th className="py-2 pr-3">Due</th>
                <th className="py-2 pr-3 text-right">Total</th><th className="py-2 pr-3 text-right">Still owed</th><th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(i => (
                <tr key={i.id} className="border-b border-[var(--color-border-secondary)]">
                  <td className="py-2 pr-3"><button className="font-medium text-[var(--color-fg-brand)]" onClick={() => onOpen(i.id)} data-testid={`org-invoice-${i.id}`}>{i.number}</button></td>
                  <td className="py-2 pr-3">{INVOICE_KIND[i.kind] ?? i.kind} · {i.period}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{day(i.issuedAt)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{i.totalTzs > 0 ? day(i.dueDate) : '—'}</td>
                  <td className="py-2 pr-3 text-right">{money(i.totalTzs)}</td>
                  <td className="py-2 pr-3 text-right">{i.outstandingTzs && i.outstandingTzs > 0 ? money(i.outstandingTzs) : ''}</td>
                  <td className="py-2"><InvoiceStatus invoice={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
