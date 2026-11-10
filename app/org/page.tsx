'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../providers';
import { api, ApiError, ORG_BILLING_ROLES, B2BInvoiceDetail, B2BOrgBilling, B2BPayment, B2BSponsorInvoice, B2BStatement } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Segmented, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { Aging, Balances, InvoiceDocument, InvoiceStatus, PrintButton, StatementTable } from '@/components/b2b-finance';
import { OrgPaying } from '@/components/b2b-collections';
import { money } from '@/lib/admin-utils';
import { MessageKey } from '@/lib/i18n';
import { OrgT, useOrgT } from '@/lib/org-i18n';

type Tab = 'overview' | 'invoices' | 'pay' | 'payments' | 'statement';
type Org = { id: string; name: string; role: string };

const failed = (o: OrgT, e: unknown, fallback: MessageKey) =>
  o.t(e instanceof ApiError && e.status === 403 ? 'org.billing.forbidden' : fallback);

/**
 * An organisation's own billing: what it owes, its invoices and what each one
 * charges for, the payments FitFlex has recorded, its statement, and where
 * to pay. The organisation tells FitFlex when it has paid; FitFlex raises
 * invoices and records a payment once the money is confirmed.
 */
export default function OrganizationBillingPage() {
  const { token, t } = useApp();
  const o = useOrgT();
  const day = o.day;
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
      .catch(() => { setOrgs([]); setError(o.t('org.billing.loadOrgsFailed')); });
  }, [token]);

  useEffect(() => {
    if (!token || !orgId) return;
    setOpen(null);
    setError(null);
    setOverview(null); setInvoices(null); setPayments(null); setStatement(null);
    api.orgBilling(token, orgId).then(setOverview).catch(e => setError(failed(o, e, 'org.billing.loadFailed')));
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
      setError(failed(o, e, 'org.billing.openFailed'));
    }
  };
  const applyRange = async () => {
    if (!token) return;
    try {
      setStatement(await api.orgStatement(token, orgId, { from: range.from || undefined, to: range.to || undefined }));
    } catch (e) {
      setError(failed(o, e, 'org.billing.statementFailed'));
    }
  };

  if (!token) return null;
  if (orgs === null) return <Spinner className="h-6 w-6" />;
  const org = orgs.find(o => o.id === orgId);

  return (
    <div className="space-y-5" data-testid="org-billing">
      <div className="print:hidden">
        <PageHeader title={t('org.nav.billing')} description={org ? o.t('org.billing.description', { name: org.name }) : o.t('org.billing.descriptionNone')} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {orgs.length === 0 && !error && <Alert tone="info">{o.t('org.billing.noRole')}</Alert>}
      {orgs.length > 1 && (
        <select className="ui-input !w-auto print:hidden" value={orgId} onChange={e => setOrgId(e.target.value)} data-testid="org-picker">
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}

      {org && open && (
        <Card>
          <CardContent className="space-y-3 py-5">
            <Button variant="secondary" size="sm" onClick={() => setOpen(null)} className="print:hidden"><ArrowLeft className="h-4 w-4" />{o.t('org.common.back')}</Button>
            <InvoiceDocument detail={open} organizationName={org.name} />
            {(open.invoice.outstandingTzs ?? 0) > 0 && (
              <Button size="sm" className="print:hidden" onClick={() => { setPayFor(open.invoice.id); setOpen(null); setTab('pay'); }} data-testid="pay-this-invoice">{o.t('org.billing.paidThis')}</Button>
            )}
            <p className="text-xs text-[var(--color-fg-quaternary)] print:hidden">
              {o.t('org.billing.invoiceNote')}
            </p>
          </CardContent>
        </Card>
      )}

      {org && !open && (
        <>
          <Segmented className="print:hidden w-fit" value={tab} onChange={v => setTab(v as Tab)}
            options={(['overview', 'invoices', 'pay', 'payments', 'statement'] as Tab[]).map(k => [k, o.label('org.billing.tab', k)] as [string, string])} />

          {tab === 'overview' && (overview ? (
            <div className="space-y-4">
              <Balances b={overview} />
              <Aging aging={overview.aging} />
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardContent className="space-y-1 py-4 text-sm">
                    <div className="mb-1 font-semibold">{o.t('org.billing.terms')}</div>
                    <div>{o.t('org.billing.terms.prepaid', { when: overview.terms.prepaidTermsDays === 0 ? o.t('org.billing.terms.dueWhenIssued') : o.t('org.billing.terms.dueIn', { n: overview.terms.prepaidTermsDays }) })}</div>
                    <div>{o.t('org.billing.terms.usage', { n: overview.terms.usageTermsDays })}</div>
                    {overview.terms.platformFeeTzs != null && <div>{o.t('org.billing.terms.platformFee', { amount: money(overview.terms.platformFeeTzs) })}</div>}
                    {Object.entries(overview.terms.passRates ?? {}).map(([tier, v]) => <div key={tier} data-testid={`terms-rate-${tier}`}>{o.t('org.billing.terms.passRate', { tier, amount: money(v) })}</div>)}
                    <div className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.billing.terms.footer', { terms: overview.terms.reference ? `${o.t('org.billing.terms.agreement', { ref: overview.terms.reference })}${overview.terms.contractReference ? ` · ${overview.terms.contractReference}` : ''}` : o.t('org.billing.terms.standard') })}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-1 py-4 text-sm">
                    <div className="mb-1 font-semibold">{o.t('org.billing.sentTo')}</div>
                    <div>{overview.account.contactName ?? '—'}</div>
                    <div>{overview.account.email ?? '—'} {overview.account.phone ? `· ${overview.account.phone}` : ''}</div>
                    {overview.account.taxIdentificationNumber && <div>TIN {overview.account.taxIdentificationNumber}</div>}
                    <div className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.billing.changeContact')}</div>
                  </CardContent>
                </Card>
              </div>
              <InvoiceList invoices={overview.recentInvoices} onOpen={openInvoice} empty={o.t('org.billing.noInvoices')} title={o.t('org.billing.latest')} />
            </div>
          ) : <Spinner className="h-6 w-6" />)}

          {tab === 'invoices' && (invoices ? <InvoiceList invoices={invoices} onOpen={openInvoice} empty={o.t('org.billing.noInvoices')} /> : <Spinner className="h-6 w-6" />)}

          {tab === 'pay' && (invoices ? <OrgPaying token={token} orgId={orgId} invoices={invoices} preselect={payFor} onChanged={reload} /> : <Spinner className="h-6 w-6" />)}

          {tab === 'payments' && (payments ? (
            <Card>
              <CardContent className="py-4">
                {payments.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.billing.noPayments')}</p> : (
                  <Table aria-label={o.t('org.billing.tab.payments')} data-testid="org-payments">
                    <THead>
                      <Tr>
                        <Th>{o.t('org.billing.col.received')}</Th><Th>{o.t('org.billing.col.receipt')}</Th><Th>{o.t('org.common.how')}</Th><Th>{o.t('org.billing.col.yourReference')}</Th>
                        <Th className="!text-right">{o.t('org.common.amount')}</Th><Th className="!text-right">{o.t('org.billing.col.notApplied')}</Th><Th>{o.t('org.common.status')}</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {payments.map(p => (
                        <Tr key={p.id}>
                          <Td className="whitespace-nowrap">{day(p.receivedAt)}</Td>
                          <Td className="font-medium">{p.number}</Td>
                          <Td>{o.label('org.billing.method', p.method)}</Td>
                          <Td>{p.reference}</Td>
                          <Td className="text-right">{money(p.amountTzs)}</Td>
                          <Td className="text-right">{p.unallocatedTzs ? money(p.unallocatedTzs) : ''}</Td>
                          <Td>{p.status === 'reversed' ? <Badge tone="danger">{o.t('org.billing.reversed')}</Badge> : <Badge tone="success">{o.t('org.billing.received')}</Badge>}</Td>
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
                    <div className="font-semibold">{o.t('org.billing.statementTitle', { name: statement.organization.name })}</div>
                    <div className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.billing.asOf', { range: statement.from || statement.to ? o.t('org.common.range', { from: day(statement.from), to: day(statement.to) }) : o.t('org.billing.allDates'), date: day(statement.asOf) })}</div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 print:hidden">
                    <input className="ui-input !w-auto" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} aria-label={o.t('org.common.from')} />
                    <input className="ui-input !w-auto" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} aria-label={o.t('org.common.to')} />
                    <Button variant="secondary" size="sm" onClick={applyRange}>{o.t('org.common.show')}</Button>
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
  const o = useOrgT();
  const day = o.day;
  return (
    <Card>
      <CardContent className="py-4">
        {title && <div className="mb-2 text-sm font-semibold">{title}</div>}
        {invoices.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{empty}</p> : (
          <Table aria-label={title} data-testid="org-invoices">
            <THead>
              <Tr>
                <Th>{o.t('org.billing.col.number')}</Th><Th>{o.t('org.common.for')}</Th><Th>{o.t('org.common.issued')}</Th><Th>{o.t('org.common.due')}</Th>
                <Th className="!text-right">{o.t('org.common.total')}</Th><Th className="!text-right">{o.t('org.billing.col.stillOwed')}</Th><Th>{o.t('org.common.status')}</Th>
              </Tr>
            </THead>
            <TBody>
              {invoices.map(i => (
                <Tr key={i.id}>
                  <Td><Button variant="link" className="h-auto px-0 text-left font-medium" onClick={() => onOpen(i.id)} data-testid={`org-invoice-${i.id}`}>{i.number}</Button></Td>
                  <Td>{o.label('org.billing.kind', i.kind)} · {i.period}</Td>
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
