'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Banknote } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ApiError, Refund, RefundStatus } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { money, formatDateTime } from '@/lib/admin-utils';

type Filter = RefundStatus | 'all';
type Action = { refund: Refund; kind: 'approve' | 'reject' | 'paid' };

const FILTERS: Array<[Filter, string]> = [
  ['approved', 'To pay'], ['requested', 'To decide'], ['paid', 'Paid'], ['rejected', 'Rejected'], ['all', 'All'],
];
const STATUS: Record<RefundStatus, { label: string; tone: 'warning' | 'brand' | 'success' | 'gray' }> = {
  requested: { label: 'To decide', tone: 'warning' },
  approved: { label: 'To pay', tone: 'brand' },
  paid: { label: 'Paid', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'gray' },
};
const KIND: Record<string, string> = { subscription: 'Pass or plan', trainer_booking: 'Trainer session', shop_order: 'Shop order' };
const REASON: Record<string, string> = {
  member_cancelled: 'Cancelled by the member', trainer_cancelled: 'Cancelled by the trainer', vendor_cancelled: 'Cancelled by the vendor',
  cancelled_by_fitflex: 'Cancelled by FitFlex', charged_twice: 'Charged twice', not_activated: 'Never activated',
  payment_error: 'Payment error', other: 'Other',
};
const ERRORS: Record<string, string> = {
  already_decided: 'This refund has already been decided. Refresh to see it.',
  refund_not_approved: 'Only an approved refund can be marked as paid.',
  note_required: 'Write a reason. The member will see it.',
  invalid_amount: 'Enter an amount above zero and no more than was asked for.',
  payment_reference_required: 'Enter the payment reference.',
};
const errorText = (e: unknown, fallback: string) => {
  const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
  return (code && ERRORS[code]) || (e instanceof Error ? e.message : fallback);
};

export default function RefundsPage() {
  const { token, user } = useApp();
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('approved');
  const [action, setAction] = useState<Action | null>(null);
  const [fields, setFields] = useState({ amount: '', note: '', endAccess: false, reference: '', paidTo: '' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setRefunds((await api.refunds(token)).refunds);
      setError(null);
    } catch (e) {
      setError(errorText(e, 'Failed to load refunds'));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  function open(refund: Refund, kind: Action['kind']) {
    setAction({ refund, kind });
    setActionError(null);
    setFields({ amount: String(refund.amountTzs), note: '', endAccess: false, reference: '', paidTo: refund.member?.phone || '' });
  }

  async function submit() {
    if (!token || !action) return;
    setBusy(true);
    try {
      const { refund, kind } = action;
      if (kind === 'paid') {
        await api.markRefundPaid(token, refund.id, { paymentReference: fields.reference.trim(), paidTo: fields.paidTo.trim() || undefined });
      } else if (kind === 'approve') {
        await api.decideRefund(token, refund.id, {
          decision: 'approve', amountTzs: Number(fields.amount), note: fields.note.trim() || undefined,
          endAccess: refund.kind === 'subscription' ? fields.endAccess : undefined,
        });
      } else {
        await api.decideRefund(token, refund.id, { decision: 'reject', note: fields.note.trim() });
      }
      setAction(null);
      await load();
    } catch (e) {
      setActionError(errorText(e, 'That did not save. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const shown = refunds.filter(r => filter === 'all' || r.status === filter);
  const count = (s: RefundStatus) => refunds.filter(r => r.status === s).length;
  const toPay = refunds.filter(r => r.status === 'approved').reduce((sum, r) => sum + r.amountTzs, 0);

  const columns: ColumnDef<Refund>[] = [
    {
      key: 'memberId', header: 'For', sortable: true,
      cell: (r) => (
        <div>
          <div className="text-sm font-medium text-[var(--color-fg-primary)]">{r.member?.displayName || r.member?.email || r.memberId}</div>
          <div className="text-xs text-[var(--color-fg-quaternary)]">{r.member?.phone || '—'}</div>
        </div>
      ),
    },
    {
      key: 'kind', header: 'What', sortable: true,
      cell: (r) => (
        <div>
          <Badge tone="brand">{KIND[r.kind] ?? r.kind}</Badge>
          <div className="mt-1 text-xs text-[var(--color-fg-tertiary)]">{REASON[r.reasonCode] ?? r.reasonCode}</div>
          {r.note && <div className="mt-0.5 max-w-[240px] text-xs text-[var(--color-fg-quaternary)]">“{r.note}”</div>}
        </div>
      ),
    },
    { key: 'amountTzs', header: 'Amount', sortable: true, align: 'right', cell: (r) => <span className="font-medium tabular-nums">{money(r.amountTzs)}</span> },
    { key: 'createdAt', header: 'Raised', sortable: true, cell: (r) => <span className="whitespace-nowrap text-xs tabular-nums">{formatDateTime(r.createdAt)}</span> },
    { key: 'status', header: 'Status', sortable: true, cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
    {
      key: 'paymentReference', header: 'Reference',
      cell: (r) => (
        <div className="text-xs">
          {r.paymentReference || '—'}
          {r.paidTo && <div className="text-[var(--color-fg-quaternary)]">to {r.paidTo}</div>}
          {r.status === 'rejected' && r.decisionNote && <div className="max-w-[220px] text-[var(--color-fg-quaternary)]">{r.decisionNote}</div>}
        </div>
      ),
    },
  ];

  const title = action?.kind === 'paid' ? 'Record refund payment' : action?.kind === 'approve' ? 'Approve refund' : 'Reject refund';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description={`${count('approved')} to pay (${money(toPay)}), ${count('requested')} waiting for a decision.`}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading && !refunds.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={shown}
              keyFn={(r) => r.id}
              filterPlaceholder="Search refunds..."
              emptyState={filter === 'approved' ? 'No refunds waiting to be paid.' : 'No refunds here.'}
              extraFilters={
                <div className="flex flex-wrap gap-1">
                  {FILTERS.map(([f, label]) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      data-testid={`refund-filter-${f}`}
                      className={`px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
                        filter === f ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]' : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
              actions={(refund) => (
                <>
                  {refund.status === 'requested' && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => open(refund, 'approve')} title="Approve" data-testid="refund-approve">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => open(refund, 'reject')} title="Reject" data-testid="refund-reject">
                        <XCircle className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                      </Button>
                    </>
                  )}
                  {refund.status === 'approved' && (
                    <Button variant="ghost" size="sm" onClick={() => open(refund, 'paid')} data-testid="refund-paid">
                      <Banknote className="h-3.5 w-3.5" /> Mark paid
                    </Button>
                  )}
                </>
              )}
            />
          </div>
        </Card>
      )}

      <Dialog
        open={!!action}
        onClose={() => setAction(null)}
        title={title}
        description={action ? `${action.refund.member?.displayName || action.refund.memberId} · ${KIND[action.refund.kind] ?? action.refund.kind} · ${money(action.refund.amountTzs)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {actionError && <Alert tone="error">{actionError}</Alert>}
          {action?.kind === 'paid' && (
            <>
              <Field label="Payment reference" hint="The mobile-money or bank reference of the refund you sent.">
                <input className="ui-input" value={fields.reference} onChange={e => setFields({ ...fields, reference: e.target.value })} placeholder="e.g. MPESA QX12AB34" />
              </Field>
              <Field label="Paid to" hint="The number or account the money went to.">
                <input className="ui-input" value={fields.paidTo} onChange={e => setFields({ ...fields, paidTo: e.target.value })} />
              </Field>
            </>
          )}
          {action?.kind === 'approve' && (
            <>
              <Field label="Amount to refund (TZS)" hint={`Up to ${money(action.refund.amountTzs)}.`}>
                <input className="ui-input" inputMode="numeric" value={fields.amount} onChange={e => setFields({ ...fields, amount: e.target.value.replace(/[^0-9]/g, '') })} />
              </Field>
              {action.refund.kind === 'subscription' && (
                <label className="flex items-start gap-3 text-sm text-[var(--color-fg-primary)]">
                  <input type="checkbox" className="mt-1" checked={fields.endAccess} onChange={e => setFields({ ...fields, endAccess: e.target.checked })} />
                  End the pass or plan now. Leave unticked when refunding a duplicate payment.
                </label>
              )}
              <Field label="Note (optional)">
                <textarea className="ui-input min-h-[70px]" value={fields.note} onChange={e => setFields({ ...fields, note: e.target.value })} />
              </Field>
            </>
          )}
          {action?.kind === 'reject' && (
            <Field label="Reason" hint="The member sees this.">
              <textarea className="ui-input min-h-[90px]" value={fields.note} onChange={e => setFields({ ...fields, note: e.target.value })} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setAction(null)} disabled={busy}>Cancel</Button>
          <Button
            variant="primary" size="md" onClick={submit} data-testid="refund-submit"
            disabled={busy || (action?.kind === 'paid' && !fields.reference.trim()) || (action?.kind === 'reject' && !fields.note.trim()) || (action?.kind === 'approve' && !(Number(fields.amount) > 0))}
          >
            {busy ? 'Saving...' : action?.kind === 'paid' ? 'Mark as paid' : action?.kind === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
