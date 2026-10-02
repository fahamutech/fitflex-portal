'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Undo2 } from 'lucide-react';
import { useApp } from '../../../providers';
import { api, ApiError, B2BConsumption, B2BConsumptionFilters, B2BOrganization, B2BUsageMoney } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, PageHeader, Spinner } from '@/components/shared';

const TONE: Record<string, 'success' | 'warning' | 'gray' | 'danger'> = {
  approved: 'success', pending: 'warning', rejected: 'danger', reversed: 'gray', cancelled: 'gray',
};
const SERVICE: Record<string, string> = { gym_access: 'Gym visit', trainer_session: 'Trainer session' };
const SOURCE: Record<string, string> = { gym_checkin: 'Check-in', trainer_booking: 'Trainer booking' };
const tzs = (n?: number | null) => (n == null ? '—' : `TZS ${n.toLocaleString('en-US')}`);
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam', dateStyle: 'medium', timeStyle: 'short' });
const EMPTY: B2BConsumptionFilters = { organizationId: '', status: '', serviceType: '', userId: '', providerId: '', from: '', to: '' };

type Detail = { consumption: B2BConsumption; sourceEvent: Record<string, unknown> | null; settlementCandidate: Record<string, unknown> };

/**
 * The benefit consumption ledger: every time a sponsor's benefit covered (or
 * was refused for) a gym visit or trainer session. FitFlex only. Rows are
 * never deleted; a mistake is reversed, which keeps the record and gives the
 * allowance back.
 */
export default function AdminB2BUsagePage() {
  const { token } = useApp();
  const [orgs, setOrgs] = useState<B2BOrganization[]>([]);
  const [filters, setFilters] = useState<B2BConsumptionFilters>(EMPTY);
  const [rows, setRows] = useState<B2BConsumption[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<B2BUsageMoney | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (f = filters) => {
    if (!token) return;
    setError(null);
    try {
      const r = await api.adminB2BConsumptions(token, { ...f, limit: 100 });
      setRows(r.items);
      setTotal(r.total);
      setTotals(r.totals);
    } catch {
      setError('Could not load benefit usage.');
      setRows([]);
    }
  };
  useEffect(() => {
    if (!token) return;
    api.b2bOrganizations(token, { limit: 100 }).then(r => setOrgs(r.items)).catch(() => setOrgs([]));
    load(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const inspect = async (row: B2BConsumption) => {
    if (!token) return;
    setReason('');
    setError(null);
    try {
      setDetail(await api.adminB2BConsumption(token, row.id));
    } catch {
      setError('Could not load that record.');
    }
  };

  const reverse = async () => {
    if (!token || !detail) return;
    setBusy(true);
    setError(null);
    try {
      await api.reverseB2BConsumption(token, detail.consumption.id, reason);
      setDetail(await api.adminB2BConsumption(token, detail.consumption.id));
      setReason('');
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { error?: string })?.error : null;
      setError(code === 'reason_required' ? 'Say why it is being reversed.'
        : code === 'acl_forbidden' ? 'Reversing a gym visit also voids the visit. You need the Payments permission for that.'
        : code === 'checkin_not_voided' ? 'The visit could not be voided, so nothing was reversed.'
        : 'Could not reverse that record.');
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof B2BConsumptionFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  const c = detail?.consumption;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Benefit usage"
        description="Every gym visit and trainer session a sponsor's benefit covered, and what the sponsor and the member each owe."
        actions={(
          <div className="flex gap-2">
            <Link href="/admin/b2b"><Button variant="secondary" size="sm"><ArrowLeft className="h-4 w-4" />Organisations</Button></Link>
            <Button variant="secondary" size="sm" onClick={() => load()}><RefreshCw className="h-4 w-4" />Refresh</Button>
          </div>
        )}
      />
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="grid gap-3 sm:grid-cols-4" data-testid="usage-filters">
            <Field label="Organisation">
              <select className="ui-input" value={filters.organizationId} onChange={set('organizationId')} data-testid="usage-org">
                <option value="">All</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.legalName}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="ui-input" value={filters.status} onChange={set('status')} data-testid="usage-status">
                <option value="">All</option>
                {Object.keys(TONE).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Service">
              <select className="ui-input" value={filters.serviceType} onChange={set('serviceType')}>
                <option value="">All</option>
                {Object.entries(SERVICE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Member user ID"><input className="ui-input" value={filters.userId} onChange={set('userId')} placeholder="usr_…" /></Field>
            <Field label="Provider ID (gym or trainer)"><input className="ui-input" value={filters.providerId} onChange={set('providerId')} /></Field>
            <Field label="From"><input className="ui-input" type="date" value={filters.from} onChange={set('from')} /></Field>
            <Field label="To"><input className="ui-input" type="date" value={filters.to} onChange={set('to')} /></Field>
            <div className="flex items-end gap-2">
              <Button type="submit" data-testid="usage-apply">Apply</Button>
              <Button type="button" variant="secondary" onClick={() => { setFilters(EMPTY); load(EMPTY); }}>Clear</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{total} record{total === 1 ? '' : 's'}</span>
              {totals && (
                <span className="text-xs text-[var(--color-fg-quaternary)]" data-testid="usage-totals">
                  Covered: {tzs(totals.grossTzs)} · sponsors {tzs(totals.sponsorTzs)} · members {tzs(totals.beneficiaryTzs)}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {rows == null ? <Spinner className="h-6 w-6" /> : rows.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-quaternary)]">No benefit usage matches.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="usage-list">
                {rows.map(r => (
                  <li key={r.id}>
                    <button onClick={() => inspect(r)} data-testid={`usage-${r.id}`}
                      className={`flex w-full items-start justify-between gap-3 py-2.5 text-left ${c?.id === r.id ? 'text-[var(--color-fg-brand)]' : ''}`}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.beneficiaryName ?? r.beneficiaryId} · {r.providerName ?? r.providerId}</span>
                        <span className="block truncate text-xs text-[var(--color-fg-quaternary)]">
                          {SERVICE[r.serviceType] ?? r.serviceType} · {r.benefitName} · {r.organizationName} · {when(r.consumedAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={TONE[r.status] ?? 'gray'}>{r.status}</Badge>
                        <span className="text-xs text-[var(--color-fg-quaternary)]">{r.status === 'rejected' ? r.rejectionReason?.replace(/_/g, ' ') : `sponsor ${tzs(r.sponsorTzs)}`}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          {!c || !detail ? (
            <Card><CardContent className="py-12 text-center text-sm text-[var(--color-fg-quaternary)]">Choose a record to see its details.</CardContent></Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{SERVICE[c.serviceType] ?? c.serviceType}</span>
                  <Badge tone={TONE[c.status] ?? 'gray'}>{c.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm" data-testid="usage-detail">
                <dl className="space-y-1">
                  {([
                    ['Beneficiary', c.beneficiaryName ?? c.beneficiaryId],
                    ['Organisation', c.organizationName],
                    ['Programme', c.programName],
                    ['Benefit', c.benefitName],
                    ['Provider', `${c.providerName ?? c.providerId} (${c.providerType})`],
                    ['When', when(c.consumedAt)],
                    ['Source', `${SOURCE[c.sourceType] ?? c.sourceType} ${c.sourceId}`],
                    ['Service value', tzs(c.grossTzs)],
                    ['Sponsor pays', tzs(c.sponsorTzs)],
                    ['Member pays', tzs(c.beneficiaryTzs)],
                    ['Uses left after', (() => {
                      const left = (c.rulesSnapshot as { remainingAfter?: { uses?: number | null } } | null)?.remainingAfter?.uses;
                      return c.status === 'rejected' ? null : left == null ? 'no count limit' : String(left);
                    })()],
                    ['Refused because', c.rejectionReason?.replace(/_/g, ' ')],
                    ['Verified', c.verifiedAt ? when(c.verifiedAt) : null],
                    ['Reversed', c.reversedAt ? `${when(c.reversedAt)} by ${c.reversedBy}: ${c.reversalReason}` : null],
                  ] as const).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                    <div key={k} className="flex gap-2"><dt className="w-32 shrink-0 text-[var(--color-fg-quaternary)]">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
                  ))}
                </dl>
                {!detail.sourceEvent && c.status !== 'rejected' && <p className="text-xs text-[var(--color-fg-quaternary)]">The source record wasn’t found.</p>}
                {c.status === 'approved' && (
                  <div className="space-y-2 border-t border-[var(--color-border-secondary)] pt-3">
                    <input className="ui-input" placeholder="Why is it being reversed? (required)" value={reason} onChange={e => setReason(e.target.value)} data-testid="reverse-reason" />
                    <Button variant="secondary" size="sm" disabled={busy || !reason.trim()} onClick={reverse} data-testid="reverse-button"><Undo2 className="h-4 w-4" />Reverse</Button>
                    <p className="text-xs text-[var(--color-fg-quaternary)]">The record is kept and marked reversed. The member gets the allowance back, and it leaves the sponsor’s total.</p>
                    {c.sourceType === 'gym_checkin' && (
                      <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="reverse-voids-visit">This also voids the gym visit, which can’t be undone. The gym isn’t paid for it; if it was already paid, the amount is taken off its next statement.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
