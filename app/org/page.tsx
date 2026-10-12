'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../providers';
import { api, ApiError, ORG_BILLING_ROLES, B2BInvoiceDetail, B2BOrgBilling, B2BPayment, B2BSponsorInvoice, B2BStatement } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Segmented, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { Aging, Balances, InvoiceDocument, InvoiceStatus, PrintButton, StatementTable, INVOICE_KIND, PAYMENT_METHOD, day } from '@/components/b2b-finance';
import { OrgPaying } from '@/components/b2b-collections';
import { money } from '@/lib/admin-utils';

type Tab = 'overview' | 'invoices' | 'pay' | 'payments' | 'statement';
type Org = { id: string; name: string; role: string };

const failed = (e: unknown, fallback: string) =>
  (e instanceof ApiError && e.status === 403 ? 'Your role in this organisation doesn’t include billing. Ask its owner or admin.' : fallback);

/**
 * An organisation's own billing: what it owes, its invoices and what each one
 * charges for, the payments FitFlex has recorded, its statement, and where
 * to pay. The organisation tells FitFlex when it has paid; FitFlex raises
 * invoices and records a payment once the money is confirmed.
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
  // The invoice a payment notice was started from.
  const [payFor, setPayFor] = useState<string | null>(null);
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
  const reload = () => {
    if (!token || !orgId) return;
    api.orgInvoices(token, orgId).then(r => setInvoices(r.items)).catch(() => undefined);
  };

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
            {(open.invoice.outstandingTzs ?? 0) > 0 && (
              <Button size="sm" className="print:hidden" onClick={() => { setPayFor(open.invoice.id); setOpen(null); setTab('pay'); }} data-testid="pay-this-invoice">I’ve paid this invoice</Button>
            )}
            <p className="text-xs text-[var(--color-fg-quaternary)] print:hidden">
              Sponsored passes are listed per person. Per-use benefits are totalled per benefit and person. Each visit, with its date and place, is under Insights.
            </p>
          </CardContent>
        </Card>
      )}

      {org && !open && (
        <>
          <Segmented className="print:hidden w-fit" value={tab} onChange={v => setTab(v as Tab)}
            options={[['overview', 'Overview'], ['invoices', 'Invoices'], ['pay', 'Pay'], ['payments', 'Payments'], ['statement', 'Statement']]} />

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
                    {Object.entries(overview.terms.passRates ?? {}).map(([tier, v]) => <div key={tier} data-testid={`terms-rate-${tier}`}>Sponsored {tier} pass: {money(v)} a person a month</div>)}
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

          {tab === 'pay' && (invoices ? <OrgPaying token={token} orgId={orgId} invoices={invoices} preselect={payFor} onChanged={reload} /> : <Spinner className="h-6 w-6" />)}

          {tab === 'payments' && (payments ? (
            <Card>
              <CardContent className="py-4">
                {payments.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">FitFlex hasn’t recorded a payment from you yet.</p> : (
                  <Table aria-label="Payments" data-testid="org-payments">
                    <THead>
                      <Tr>
                        <Th>Received</Th><Th>Receipt</Th><Th>How</Th><Th>Your reference</Th>
                        <Th className="!text-right">Amount</Th><Th className="!text-right">Not yet applied</Th><Th>Status</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {payments.map(p => (
                        <Tr key={p.id}>
                          <Td className="whitespace-nowrap">{day(p.receivedAt)}</Td>
                          <Td className="font-medium">{p.number}</Td>
                          <Td>{PAYMENT_METHOD[p.method] ?? p.method}</Td>
                          <Td>{p.reference}</Td>
                          <Td className="text-right">{money(p.amountTzs)}</Td>
                          <Td className="text-right">{p.unallocatedTzs ? money(p.unallocatedTzs) : ''}</Td>
                          <Td>{p.status === 'reversed' ? <Badge tone="danger">Reversed</Badge> : <Badge tone="success">Received</Badge>}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
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
          <Table aria-label={title} data-testid="org-invoices">
            <THead>
              <Tr>
                <Th>Number</Th><Th>For</Th><Th>Issued</Th><Th>Due</Th>
                <Th className="!text-right">Total</Th><Th className="!text-right">Still owed</Th><Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {invoices.map(i => (
                <Tr key={i.id}>
                  <Td><Button variant="link" className="h-auto px-0 text-left font-medium" onClick={() => onOpen(i.id)} data-testid={`org-invoice-${i.id}`}>{i.number}</Button></Td>
                  <Td>{INVOICE_KIND[i.kind] ?? i.kind} · {i.period}</Td>
                  <Td className="whitespace-nowrap">{day(i.issuedAt)}</Td>
                  <Td className="whitespace-nowrap">{i.totalTzs > 0 ? day(i.dueDate) : '—'}</Td>
                  <Td className="text-right">{money(i.totalTzs)}</Td>
                  <Td className="text-right">{i.outstandingTzs && i.outstandingTzs > 0 ? money(i.outstandingTzs) : ''}</Td>
                  <Td><InvoiceStatus invoice={i} /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
