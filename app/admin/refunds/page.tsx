'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Banknote } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ApiError, Refund, RefundStatus } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field, ErrorState } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { money } from '@/lib/admin-utils';
import { REFUND_STAGE_TONE, flagOnErrorKey, refundStageKey, whenText } from '@/lib/money-approval';
import { fill } from '@/components/communication-shared';
import type { MessageKey } from '@/lib/i18n';

type Filter = RefundStatus | 'all';
type Action = { refund: Refund; kind: 'approve' | 'reject' | 'paid' };

const FILTERS: Filter[] = ['approved', 'requested', 'paid', 'rejected', 'all'];
const FILTER_LABEL: Record<Filter, MessageKey> = {
  approved: 'refunds.filter.approved', requested: 'refunds.filter.requested', paid: 'refunds.filter.paid',
  rejected: 'refunds.filter.rejected', all: 'refunds.filter.all',
};
// A refund's status badge says what the filter for it says.
const STATUS_TONE: Record<RefundStatus, 'warning' | 'brand' | 'success' | 'gray'> = {
  requested: 'warning', approved: 'brand', paid: 'success', rejected: 'gray',
};
const KIND: Record<string, MessageKey> = {
  subscription: 'refunds.kind.subscription', trainer_booking: 'refunds.kind.trainer_booking', shop_order: 'refunds.kind.shop_order',
};
const REASON: Record<string, MessageKey> = {
  member_cancelled: 'refunds.reason.member_cancelled', trainer_cancelled: 'refunds.reason.trainer_cancelled',
  vendor_cancelled: 'refunds.reason.vendor_cancelled', cancelled_by_fitflex: 'refunds.reason.cancelled_by_fitflex',
  charged_twice: 'refunds.reason.charged_twice', not_activated: 'refunds.reason.not_activated',
  payment_error: 'refunds.reason.payment_error', sponsor_paid: 'refunds.reason.sponsor_paid', other: 'refunds.reason.other',
};
const ERRORS: Record<string, MessageKey> = {
  already_decided: 'refunds.err.already_decided',
  refund_not_approved: 'refunds.err.refund_not_approved',
  note_required: 'refunds.err.note_required',
  invalid_amount: 'refunds.err.invalid_amount',
  payment_reference_required: 'refunds.err.payment_reference_required',
};
/** A known server refusal by its code; anything else (network, unknown) the generic "did not save". */
const errorKey = (e: unknown): MessageKey => {
  const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
  return (code && ERRORS[code]) || 'money2.err.generic';
};

export default function RefundsPage() {
  const { token, user, t, locale } = useApp();
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  // Loading the list failing is its own state (one error with a retry), not a raw message.
  const [loadFailed, setLoadFailed] = useState(false);
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
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
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
      // Two-admin refusals (flag on only) have their own text; everything else keeps today's.
      const key = flagOnErrorKey(e);
      setActionError(t(key ?? errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  // MONEY_SECOND_APPROVER on: the admin who raised a refund doesn't approve it; the approver doesn't pay it.
  const approveBlocked = (r: Refund) => (r.secondApproverRequired && r.approveNotBy && r.approveNotBy === user.id ? t('money2.refundApproveBlockedOwn') : null);
  // payNotBy is the approver, or (policy-approved refunds) the admin who started it.
  const payBlocked = (r: Refund) => (r.secondApproverRequired && r.payNotBy && r.payNotBy === user.id
    ? t(r.decidedBy === 'policy' ? 'money2.refundPayBlockedStarted' : 'money2.refundPayBlockedOwn') : null);

  const isMe = (id: string | null | undefined) => !!id && id === user.id;
  const otherAdmin = (name: string | null | undefined) => name?.trim() || t('money2.otherAdmin');
  /**
   * Two-admin approval on: why this admin can't act (visible, not only a tooltip), or else who
   * raised / approved it. One line, so nothing is said twice.
   */
  const auditLine = (r: Refund): string | null => {
    if (!r.secondApproverRequired) return null;
    if (r.status === 'requested') {
      if (approveBlocked(r)) return approveBlocked(r);
      if (r.requestedRole === 'admin' && r.requestedBy) return isMe(r.requestedBy) ? t('refunds.raisedByYou') : t('refunds.raisedBy').replace('{who}', otherAdmin(r.requestedByName));
    }
    if (r.status === 'approved') {
      if (payBlocked(r)) return payBlocked(r);
      if (r.decidedBy && r.decidedBy !== 'policy') return isMe(r.decidedBy) ? t('refunds.approvedByYou') : t('refunds.approvedBy').replace('{who}', otherAdmin(r.decidedByName));
    }
    return null;
  };

  const shown = refunds.filter(r => filter === 'all' || r.status === filter);
  const count = (s: RefundStatus) => refunds.filter(r => r.status === s).length;
  const toPay = refunds.filter(r => r.status === 'approved').reduce((sum, r) => sum + r.amountTzs, 0);

  const kindText = (kind: string) => (KIND[kind] ? t(KIND[kind]) : kind);
  const columns: ColumnDef<Refund>[] = [
    {
      key: 'memberId', header: t('refunds.col.for'), sortable: true,
      cell: (r) => (
        <div>
          <div className="text-sm font-medium text-[var(--color-fg-primary)]">{r.member?.displayName || r.member?.email || r.memberId}</div>
          <div className="text-xs text-[var(--color-fg-quaternary)]">{r.member?.phone || '—'}</div>
        </div>
      ),
    },
    {
      key: 'kind', header: t('refunds.col.what'), sortable: true,
      cell: (r) => (
        <div>
          <Badge tone="brand">{kindText(r.kind)}</Badge>
          <div className="mt-1 text-xs text-[var(--color-fg-tertiary)]">{REASON[r.reasonCode] ? t(REASON[r.reasonCode]) : r.reasonCode}</div>
          {r.note && <div className="mt-0.5 max-w-[240px] text-xs text-[var(--color-fg-quaternary)]">“{r.note}”</div>}
        </div>
      ),
    },
    { key: 'amountTzs', header: t('refunds.col.amount'), sortable: true, align: 'right', cell: (r) => <span className="font-medium tabular-nums">{money(r.amountTzs)}</span> },
    { key: 'createdAt', header: t('refunds.col.raised'), sortable: true, cell: (r) => <span className="whitespace-nowrap text-xs tabular-nums">{whenText(r.createdAt, locale)}</span> },
    {
      key: 'status', header: t('refunds.col.status'), sortable: true,
      cell: (r) => (
        // One badge per row: with two-admin approval on, the stage says what the status says, more precisely.
        <div className="space-y-1 max-w-[14rem]">
          {r.secondApproverRequired && r.approvalStage ? (
            <span data-testid="refund-stage"><Badge tone={REFUND_STAGE_TONE[r.approvalStage] ?? 'warning'}>{t(refundStageKey(r.approvalStage))}</Badge></span>
          ) : (
            <span data-testid="refund-status"><Badge tone={STATUS_TONE[r.status] ?? 'gray'}>{FILTER_LABEL[r.status] ? t(FILTER_LABEL[r.status]) : r.status}</Badge></span>
          )}
          {auditLine(r) && (
            <div
              id={`refund-hint-${r.id}`}
              className={`text-xs ${approveBlocked(r) || payBlocked(r) ? 'font-medium text-[var(--color-warning-700)]' : 'text-[var(--color-fg-tertiary)]'}`}
              data-testid="refund-audit"
            >
              {auditLine(r)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'paymentReference', header: t('refunds.col.reference'),
      cell: (r) => (
        <div className="text-xs">
          {r.paymentReference || '—'}
          {r.paidTo && <div className="text-[var(--color-fg-quaternary)]">{fill(t('refunds.paidTo'), { who: r.paidTo })}</div>}
          {r.status === 'rejected' && r.decisionNote && <div className="max-w-[220px] text-[var(--color-fg-quaternary)]">{r.decisionNote}</div>}
        </div>
      ),
    },
  ];

  const title = t(action?.kind === 'paid' ? 'refunds.dialog.paidTitle' : action?.kind === 'approve' ? 'refunds.dialog.approveTitle' : 'refunds.dialog.rejectTitle');
  // Nothing loaded: one error with a retry instead of a zero count and an empty table.
  const nothingLoaded = loadFailed && !refunds.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('refunds.title')}
        description={nothingLoaded ? undefined : fill(t('refunds.summary'), { toPay: count('approved'), amount: money(toPay), toDecide: count('requested') })}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {t('refunds.refresh')}
          </Button>
        }
      />

      {/* A failed refresh keeps the rows already shown, with one message. */}
      {loadFailed && refunds.length > 0 && <Alert tone="error">{t('refunds.loadFailedTitle')}. {t('refunds.loadFailedBody')}</Alert>}

      {loading && !refunds.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : nothingLoaded ? (
        <div data-testid="refunds-load-error">
          <ErrorState title={t('refunds.loadFailedTitle')} message={t('refunds.loadFailedBody')} onRetry={load} retryLabel={t('common.tryAgain')} />
        </div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={shown}
              keyFn={(r) => r.id}
              label={t('refunds.title')}
              filterPlaceholder={t('refunds.search')}
              emptyState={t(filter === 'approved' ? 'refunds.empty.toPay' : 'refunds.empty.other')}
              extraFilters={
                <div className="flex flex-wrap gap-x-1 gap-y-5" role="group" aria-label={t('refunds.filtersLabel')}>
                  {FILTERS.map(f => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                      data-testid={`refund-filter-${f}`}
                      className={`hit-target px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
                        filter === f ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]' : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {t(FILTER_LABEL[f])}
                    </button>
                  ))}
                </div>
              }
              actions={(refund) => (
                <>
                  {refund.status === 'requested' && (
                    <>
                      {approveBlocked(refund) ? (
                        // A disabled button gets no hover in every browser: the wrapper carries the tooltip too.
                        <span title={approveBlocked(refund)!} data-testid="refund-approve-blocked">
                          {/* Name is the action; why it is blocked is the visible hint, read once via aria-describedby. */}
                          <Button variant="ghost" size="sm" disabled title={approveBlocked(refund)!} aria-label={t('payments.action.approve')} aria-describedby={`refund-hint-${refund.id}`} data-testid="refund-approve">
                            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                          </Button>
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => open(refund, 'approve')} title={t('payments.action.approve')} aria-label={t('payments.action.approve')} data-testid="refund-approve">
                          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => open(refund, 'reject')} title={t('payments.action.reject')} aria-label={t('payments.action.reject')} data-testid="refund-reject">
                        <XCircle aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                      </Button>
                    </>
                  )}
                  {refund.status === 'approved' && (payBlocked(refund) ? (
                    <span title={payBlocked(refund)!} data-testid="refund-paid-blocked">
                      <Button variant="ghost" size="sm" disabled title={payBlocked(refund)!} aria-describedby={`refund-hint-${refund.id}`} data-testid="refund-paid">
                        <Banknote aria-hidden="true" className="h-3.5 w-3.5" /> {t('refunds.markPaid')}
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => open(refund, 'paid')} data-testid="refund-paid">
                      <Banknote aria-hidden="true" className="h-3.5 w-3.5" /> {t('refunds.markPaid')}
                    </Button>
                  ))}
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
        description={action ? `${action.refund.member?.displayName || action.refund.memberId} · ${kindText(action.refund.kind)} · ${money(action.refund.amountTzs)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {actionError && <Alert tone="error">{actionError}</Alert>}
          {action?.kind === 'paid' && (
            <>
              <Field label={t('refunds.dialog.reference')} hint={t('refunds.dialog.referenceHint')}>
                <input className="ui-input" value={fields.reference} onChange={e => setFields({ ...fields, reference: e.target.value })} placeholder={t('refunds.dialog.referencePlaceholder')} />
              </Field>
              <Field label={t('refunds.dialog.paidTo')} hint={t('refunds.dialog.paidToHint')}>
                <input className="ui-input" value={fields.paidTo} onChange={e => setFields({ ...fields, paidTo: e.target.value })} />
              </Field>
            </>
          )}
          {action?.kind === 'approve' && (
            <>
              <Field label={t('payments.refund.amount')} hint={fill(t('refunds.dialog.upTo'), { amount: money(action.refund.amountTzs) })}>
                <input className="ui-input" inputMode="numeric" value={fields.amount} onChange={e => setFields({ ...fields, amount: e.target.value.replace(/[^0-9]/g, '') })} />
              </Field>
              {action.refund.kind === 'subscription' && (
                <label className="flex items-start gap-3 text-sm text-[var(--color-fg-primary)]">
                  <input type="checkbox" className="mt-1" checked={fields.endAccess} onChange={e => setFields({ ...fields, endAccess: e.target.checked })} />
                  {t('refunds.dialog.endAccess')}
                </label>
              )}
              <Field label={t('money2.noteOptional')}>
                <textarea className="ui-input min-h-[70px]" value={fields.note} onChange={e => setFields({ ...fields, note: e.target.value })} />
              </Field>
            </>
          )}
          {action?.kind === 'reject' && (
            <Field label={t('money2.reason')} hint={t('refunds.dialog.reasonHint')}>
              <textarea className="ui-input min-h-[90px]" value={fields.note} onChange={e => setFields({ ...fields, note: e.target.value })} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setAction(null)} disabled={busy}>{t('common.cancel')}</Button>
          <Button
            variant="primary" size="md" onClick={submit} data-testid="refund-submit"
            disabled={busy || (action?.kind === 'paid' && !fields.reference.trim()) || (action?.kind === 'reject' && !fields.note.trim()) || (action?.kind === 'approve' && !(Number(fields.amount) > 0))}
          >
            {busy ? t('money2.saving') : t(action?.kind === 'paid' ? 'refunds.markPaidSubmit' : action?.kind === 'approve' ? 'payments.action.approve' : 'payments.action.reject')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
