'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Ban, Undo2, ShieldCheck } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ApiError, PaymentRequest, PaymentStatusValue } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field, Select } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter, ConfirmDialog } from '@/components/dialog';
import { money, statusTone, statusLabel, formatDateTime } from '@/lib/admin-utils';
import { fill } from '@/components/communication-shared';
import {
  DECIDED_STATUSES, PAYMENT_STATUSES, PAYMENT_STAGE_TONE, flagOnErrorKey, moneyErrorKey, paymentStageKey, paymentStatusKey, whenText,
} from '@/lib/money-approval';

type PaymentFilter = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all';
type KindFilter = 'all' | 'trainer_pass';

/** A trainer pass is known by its subscription type; `note` can be edited. */
function isTrainerPass(payment: PaymentRequest): boolean {
  return payment.subscription?.type === 'trainer_pass' || (!payment.subscription && payment.note === 'trainer_pass');
}

/**
 * A FitFlex Pass upgrade pays the difference to move the member's running plan
 * to a higher tier; its note is `upgrade:<plan id>:<tier it was>` (the server
 * keeps it as it is). Null for any other payment.
 */
function upgradeOf(payment: PaymentRequest): { fromTier: string | null } | null {
  const m = /^upgrade:[^:]+(?::(.+))?$/.exec(payment.note || '');
  return m ? { fromTier: m[1] || null } : null;
}

function paymentTierLabel(payment: PaymentRequest): string {
  const up = upgradeOf(payment);
  if (up) {
    const to = (payment.tier || '').toUpperCase();
    return up.fromTier ? `UPGRADE · ${up.fromTier.toUpperCase()} → ${to}` : `UPGRADE → ${to}`;
  }
  if (payment.bookingGroupId) return 'TRAINER SESSION';
  if (payment.orderId) return 'SHOP ORDER';
  const plan = (payment.subscription?.plan || payment.plan || '').toUpperCase();
  if (isTrainerPass(payment)) return plan ? `TRAINER PASS · ${plan}` : 'TRAINER PASS';
  if (payment.subscription?.type === 'direct_sub') return plan ? `GYM PLAN · ${plan}` : 'GYM PLAN';
  const tier = payment.tier || payment.subscription?.tier;
  return typeof tier === 'string' && tier.trim() ? tier.toUpperCase() : '—';
}

/** What an admin reads in the note column of an upgrade: the member's plan keeps its end date. */
function upgradeNoteText(payment: PaymentRequest): string | null {
  if (!upgradeOf(payment)) return null;
  const ends = payment.subscription?.expiresAt;
  return ends ? `Pays the difference; plan stays until ${formatDateTime(ends)}` : 'Pays the difference; plan keeps its end date';
}

export default function PaymentsPage() {
  const { token, user, t, locale } = useApp();
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [filter, setFilter]     = useState<PaymentFilter>('pending');
  const [kind, setKind]         = useState<KindFilter>('all');
  const [actionTarget, setActionTarget] = useState<{ payment: PaymentRequest; action: 'approved' | 'rejected' | 'cancelled' } | null>(null);
  const [editTarget, setEditTarget] = useState<PaymentRequest | null>(null);
  const [editFields, setEditFields] = useState<{ reference: string; note: string }>({ reference: '', note: '' });
  // Refunding a confirmed pass or plan payment (sessions and orders are refunded by cancelling them).
  const [refundTarget, setRefundTarget] = useState<PaymentRequest | null>(null);
  const [refundFields, setRefundFields] = useState<{ amount: string; note: string }>({ amount: '', note: '' });
  const [refundError, setRefundError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A1 second approver (MONEY_SECOND_APPROVER): only rows with secondApproverRequired offer these.
  const [verifyTarget, setVerifyTarget] = useState<PaymentRequest | null>(null);
  const [verifyFields, setVerifyFields] = useState<{ reference: string; note: string }>({ reference: '', note: '' });
  const [changeTarget, setChangeTarget] = useState<PaymentRequest | null>(null);
  const [changeFields, setChangeFields] = useState<{ status: PaymentStatusValue | ''; reason: string }>({ status: '', reason: '' });
  const [confirmTarget, setConfirmTarget] = useState<PaymentRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PaymentRequest | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setPayments(await api.paymentRequests(token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const filtered = payments
    .filter(p => filter === 'all' || p.status === filter)
    .filter(p => kind === 'all' || isTrainerPass(p));

  async function handleAction() {
    if (!token || !actionTarget) return;
    setBusy(true);
    try {
      await api.updatePayment(token, actionTarget.payment.id, { status: actionTarget.action });
      setActionTarget(null);
      await load();
    } catch (e) {
      const key = flagOnErrorKey(e, !!actionTarget.payment.secondApproverRequired);
      if (key) setActionTarget(null);
      setError(key ? t(key) : e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit() {
    if (!token || !editTarget) return;
    setBusy(true);
    try {
      await api.updatePayment(token, editTarget.id, { reference: editFields.reference, note: editFields.note });
      setEditTarget(null);
      await load();
    } catch (e) {
      const key = flagOnErrorKey(e, !!editTarget.secondApproverRequired);
      setError(key ? t(key) : e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    if (!token || !refundTarget) return;
    setBusy(true);
    try {
      const raised = await api.raiseRefund(token, { paymentRequestId: refundTarget.id, amountTzs: Number(refundFields.amount), note: refundFields.note.trim() || undefined });
      setRefundTarget(null);
      // With two-admin approval on, an admin-raised refund waits for a different admin to approve it.
      setNotice(raised?.refund?.status === 'requested' ? t('money2.notice.refundNeedsApproval') : 'Refund raised. Record the payment under Refunds once you have sent it.');
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
      setRefundError(code === 'refund_already_requested' ? 'This payment already has a refund. See Refunds.'
        : code === 'amount_exceeds_payment' ? 'The refund can\'t be more than the payment.'
        : e instanceof Error ? e.message : 'The refund was not raised. Try again.');
    } finally {
      setBusy(false);
    }
  }

  /** Runs one second-approver action: closes its dialog, reloads and shows a notice, or keeps the dialog open with the error. */
  async function runApproval(action: () => Promise<PaymentRequest>, close: () => void, success: (p: PaymentRequest) => string) {
    if (!token) return;
    setBusy(true);
    setDialogError(null);
    try {
      const updated = await action();
      close();
      setError(null);
      setNotice(success(updated));
      await load();
    } catch (e) {
      setDialogError(t(moneyErrorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  const handleVerify = () => verifyTarget && runApproval(
    () => api.verifyPayment(token!, verifyTarget.id, { reference: verifyFields.reference.trim() || undefined, note: verifyFields.note.trim() || undefined }),
    () => setVerifyTarget(null),
    () => t('money2.notice.verified'),
  );
  const handleRequestChange = () => changeTarget && changeFields.status && runApproval(
    () => api.requestPaymentChange(token!, changeTarget.id, { status: changeFields.status as PaymentStatusValue, reason: changeFields.reason.trim() }),
    () => setChangeTarget(null),
    () => t('money2.notice.changeRequested'),
  );
  const handleConfirmChange = () => confirmTarget && runApproval(
    () => api.confirmPaymentChange(token!, confirmTarget.id),
    () => setConfirmTarget(null),
    (p) => fill(t('money2.notice.changeConfirmed'), { status: statusText(p.status) }),
  );
  const handleCancelChange = () => cancelTarget && runApproval(
    () => api.cancelPaymentChange(token!, cancelTarget.id, { reason: cancelReason.trim() || undefined }),
    () => setCancelTarget(null),
    () => t('money2.notice.changeCancelled'),
  );

  if (!token || user?.userType !== 'admin') return null;

  const statusText = (s: string | null | undefined) =>
    s && (PAYMENT_STATUSES as string[]).includes(s) ? t(paymentStatusKey(s as PaymentStatusValue)) : (s || '—');
  const who = (id: string | null | undefined) => (id && id === user.id ? t('money2.you') : fill(t('money2.otherAdmin'), { id: id || '—' }));
  const isDecided = (p: PaymentRequest) => (DECIDED_STATUSES as string[]).includes(p.status);
  /** Why Approve is not offered to this admin on a two-admin payment, or null. */
  const approveBlocked = (p: PaymentRequest): string | null => {
    if (!p.secondApproverRequired) return null;
    if (p.approvalStage === 'awaiting_verification' || !p.verifiedBy) return t('money2.approveBlockedUnverified');
    if (p.approveNotBy && p.approveNotBy === user.id) return t('money2.approveBlockedOwn');
    return null;
  };
  // Reference is fixed once verified or decided (the server refuses a change).
  const referenceLocked = (p: PaymentRequest | null) => !!p?.secondApproverRequired && (isDecided(p) || !!p.verifiedBy);

  const columns: ColumnDef<PaymentRequest>[] = [
    {
      key: 'memberId', header: 'Member', sortable: true,
      cell: (p) => (
        <div>
          <div className="font-medium text-[var(--color-fg-primary)] text-sm">{p.member?.displayName || p.member?.email || p.memberId}</div>
          <div className="text-xs text-[var(--color-fg-quaternary)] font-mono">{p.id.slice(0, 20)}…</div>
        </div>
      ),
    },
    {
      key: 'tier', header: 'Tier', sortable: true,
      cell: (p) => (
        <div>
          <Badge tone={upgradeOf(p) ? 'gray' : isTrainerPass(p) ? 'warning' : 'brand'}>{paymentTierLabel(p)}</Badge>
          {p.gym && <div className="mt-1 text-xs text-[var(--color-fg-tertiary)]">{p.gym.name}</div>}
        </div>
      ),
    },
    { key: 'amountTzs', header: 'Amount', sortable: true, align: 'right', cell: (p) => <span className="tabular-nums font-medium">{money(p.amountTzs)}</span> },
    { key: 'requestedAt', header: 'Date', sortable: true, cell: (p) => <span className="text-xs tabular-nums whitespace-nowrap">{formatDateTime(p.requestedAt)}</span> },
    {
      key: 'status', header: 'Status', sortable: true,
      cell: (p) => (
        <div className="space-y-1">
          {/* Awaiting verification / second approval are a more precise "Pending": show the stage alone.
              A change request sits on a decided payment, so its status still adds something. */}
          {!(p.secondApproverRequired && (p.approvalStage === 'awaiting_verification' || p.approvalStage === 'awaiting_second_approval')) && (
            <div data-testid="payment-status"><Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge></div>
          )}
          {p.secondApproverRequired && p.approvalStage && (
            <div data-testid="payment-stage"><Badge tone={PAYMENT_STAGE_TONE[p.approvalStage]}>{t(paymentStageKey(p.approvalStage))}</Badge></div>
          )}
          {p.secondApproverRequired && p.verifiedBy && (
            <div className="text-xs text-[var(--color-fg-tertiary)]" data-testid="payment-verified-by">
              {fill(t('money2.verifiedBy'), { who: who(p.verifiedBy), time: whenText(p.verifiedAt, locale) })}
            </div>
          )}
          {p.secondApproverRequired && p.changeRequestedBy && (
            <div className="max-w-[260px] text-xs text-[var(--color-fg-tertiary)]" data-testid="payment-change-requested-by">
              {fill(t('money2.changeRequestedBy'), { who: who(p.changeRequestedBy), status: statusText(p.changeRequestedStatus), time: whenText(p.changeRequestedAt, locale) })}
              {p.changeRequestReason && <div className="text-[var(--color-fg-quaternary)]">“{p.changeRequestReason}”</div>}
            </div>
          )}
        </div>
      ),
    },
    { key: 'reference', header: 'Reference', cell: (p) => <span className="text-xs">{p.reference || '—'}</span> },
    { key: 'note', header: 'Note', cell: (p) => <span className="text-xs max-w-[200px] truncate block">{upgradeNoteText(p) ?? (p.note || '—')}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description={`${payments.length} payment requests total. ${payments.filter(p => p.status === 'pending').length} pending.`}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {loading && !payments.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={filtered}
              keyFn={(p) => p.id}
              filterPlaceholder="Search payments..."
              emptyState="No payments found."
              extraFilters={
                <div className="flex flex-wrap gap-1">
                  {(['pending', 'approved', 'rejected', 'cancelled', 'all'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
                        filter === f ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]' : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                  <span className="mx-1 w-px self-stretch bg-[var(--color-border-secondary)]" aria-hidden />
                  {([['all', 'All types'], ['trainer_pass', 'Trainer passes']] as const).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setKind(k)}
                      className={`px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
                        kind === k ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]' : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
              actions={(payment) => (
                <>
                  {payment.status === 'pending' && payment.secondApproverRequired && !payment.verifiedBy && (
                    <Button
                      variant="ghost" size="sm" data-testid="payment-verify"
                      onClick={() => { setVerifyTarget(payment); setDialogError(null); setNotice(null); setVerifyFields({ reference: payment.reference || '', note: '' }); }}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> {t('money2.verify')}
                    </Button>
                  )}
                  {payment.status === 'pending' && (
                    <>
                      {approveBlocked(payment) ? (
                        // A disabled button gets no hover in every browser: the wrapper carries the tooltip too.
                        <span title={approveBlocked(payment)!} data-testid="payment-approve-blocked">
                          <Button variant="ghost" size="sm" disabled aria-label={approveBlocked(payment)!} title={approveBlocked(payment)!} data-testid="payment-approve">
                            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                          </Button>
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setActionTarget({ payment, action: 'approved' })} title="Approve" data-testid="payment-approve">
                          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setActionTarget({ payment, action: 'rejected' })} title="Reject">
                        <XCircle className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setActionTarget({ payment, action: 'cancelled' })} title="Cancel">
                        <Ban className="h-3.5 w-3.5 text-[var(--color-fg-quaternary)]" />
                      </Button>
                    </>
                  )}
                  {payment.secondApproverRequired && isDecided(payment) && !payment.changeRequestedBy && !(payment.orderId && payment.status === 'approved') && (
                    <Button
                      variant="ghost" size="sm" data-testid="payment-request-change"
                      onClick={() => { setChangeTarget(payment); setDialogError(null); setNotice(null); setChangeFields({ status: '', reason: '' }); }}
                    >
                      {t('money2.requestChange')}
                    </Button>
                  )}
                  {payment.secondApproverRequired && payment.changeRequestedBy && (
                    <>
                      {payment.confirmChangeNotBy && payment.confirmChangeNotBy === user.id ? (
                        <span title={t('money2.confirmChangeBlockedOwn')} data-testid="payment-confirm-change-blocked">
                          <Button variant="ghost" size="sm" disabled title={t('money2.confirmChangeBlockedOwn')} data-testid="payment-confirm-change">
                            {t('money2.confirmChange')}
                          </Button>
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" data-testid="payment-confirm-change" onClick={() => { setConfirmTarget(payment); setDialogError(null); setNotice(null); }}>
                          {t('money2.confirmChange')}
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm" data-testid="payment-cancel-change"
                        onClick={() => { setCancelTarget(payment); setCancelReason(''); setDialogError(null); setNotice(null); }}
                      >
                        {t('money2.cancelChange')}
                      </Button>
                    </>
                  )}
                  {payment.status === 'approved' && payment.subscriptionId && (
                    <Button
                      variant="ghost" size="sm" title="Refund this payment" data-testid="payment-refund"
                      onClick={() => { setRefundTarget(payment); setRefundError(null); setNotice(null); setRefundFields({ amount: String(payment.amountTzs), note: '' }); }}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => { setEditTarget(payment); setEditFields({ reference: payment.reference || '', note: upgradeOf(payment) ? '' : (payment.note || '') }); }}>
                    Edit
                  </Button>
                </>
              )}
            />
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        onConfirm={handleAction}
        title={actionTarget ? `${actionTarget.action.charAt(0).toUpperCase() + actionTarget.action.slice(1)} payment` : ''}
        description={`Set payment for ${actionTarget?.payment.member?.displayName || actionTarget?.payment.memberId} (${money(actionTarget?.payment.amountTzs)}${actionTarget && (isTrainerPass(actionTarget.payment) || upgradeOf(actionTarget.payment)) ? ` — ${paymentTierLabel(actionTarget.payment).toLowerCase()}${actionTarget.payment.gym ? ` at ${actionTarget.payment.gym.name}` : ''}` : ''}) to "${actionTarget?.action}"?${actionTarget?.action === 'approved' && isTrainerPass(actionTarget.payment) ? ' The pass period starts now.' : ''}${actionTarget?.action === 'approved' && upgradeOf(actionTarget.payment) ? ' The plan is upgraded now and keeps its end date.' : ''}`}
        confirmLabel={actionTarget?.action === 'approved' ? 'Approve' : actionTarget?.action === 'rejected' ? 'Reject' : 'Cancel payment'}
        tone={actionTarget?.action === 'approved' ? 'primary' : 'danger'}
        busy={busy}
      />

      <Dialog
        open={!!refundTarget}
        onClose={() => setRefundTarget(null)}
        title="Refund this payment"
        description={refundTarget ? `${refundTarget.member?.displayName || refundTarget.memberId} · ${paymentTierLabel(refundTarget)} · paid ${money(refundTarget.amountTzs)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {refundError && <Alert tone="error">{refundError}</Alert>}
          <Field label="Amount to refund (TZS)">
            <input className="ui-input" inputMode="numeric" value={refundFields.amount} onChange={e => setRefundFields({ ...refundFields, amount: e.target.value.replace(/[^0-9]/g, '') })} />
          </Field>
          <Field label="Why" hint="For example: charged twice on 1 October.">
            <textarea className="ui-input min-h-[70px]" value={refundFields.note} onChange={e => setRefundFields({ ...refundFields, note: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setRefundTarget(null)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleRefund} disabled={busy || !(Number(refundFields.amount) > 0)}>{busy ? 'Saving...' : 'Raise refund'}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit payment details" size="sm">
        <div className="space-y-4">
          <Field label="Reference" hint={referenceLocked(editTarget) ? t('money2.referenceLocked') : undefined}>
            <input className="ui-input" value={editFields.reference} disabled={referenceLocked(editTarget)} onChange={e => setEditFields({ ...editFields, reference: e.target.value })} placeholder="Payment reference..." />
          </Field>
          <Field label="Note">
            <textarea className="ui-input min-h-[80px]" value={editFields.note} onChange={e => setEditFields({ ...editFields, note: e.target.value })} placeholder="Admin note..." />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setEditTarget(null)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleEdit} disabled={busy}>{busy ? 'Saving...' : 'Update'}</Button>
        </DialogFooter>
      </Dialog>

      {/* A1 second approver (MONEY_SECOND_APPROVER on only). */}
      <Dialog
        open={!!verifyTarget}
        onClose={() => setVerifyTarget(null)}
        title={t('money2.verifyTitle')}
        description={verifyTarget ? `${verifyTarget.member?.displayName || verifyTarget.memberId} · ${paymentTierLabel(verifyTarget)} · ${money(verifyTarget.amountTzs)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-fg-secondary)]">{t('money2.verifyBody')}</p>
          {dialogError && <Alert tone="error">{dialogError}</Alert>}
          <Field label={t('money2.reference')} hint={t('money2.referenceHint')}>
            <input className="ui-input" data-testid="verify-reference" value={verifyFields.reference} onChange={e => setVerifyFields({ ...verifyFields, reference: e.target.value })} />
          </Field>
          {verifyTarget && !upgradeOf(verifyTarget) && (
            <Field label={t('money2.noteOptional')}>
              <textarea className="ui-input min-h-[70px]" data-testid="verify-note" value={verifyFields.note} onChange={e => setVerifyFields({ ...verifyFields, note: e.target.value })} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setVerifyTarget(null)} disabled={busy}>{t('money2.close')}</Button>
          <Button variant="primary" size="md" onClick={handleVerify} disabled={busy} data-testid="verify-submit">{busy ? t('money2.saving') : t('money2.verifySubmit')}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={!!changeTarget}
        onClose={() => setChangeTarget(null)}
        title={t('money2.requestChange')}
        description={changeTarget ? `${changeTarget.member?.displayName || changeTarget.memberId} · ${paymentTierLabel(changeTarget)} · ${money(changeTarget.amountTzs)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {changeTarget && <p className="text-sm text-[var(--color-fg-secondary)]">{fill(t('money2.requestChangeBody'), { status: statusText(changeTarget.status) })}</p>}
          {dialogError && <Alert tone="error">{dialogError}</Alert>}
          <Field label={t('money2.newStatus')} required>
            <Select data-testid="change-status" value={changeFields.status} onChange={e => setChangeFields({ ...changeFields, status: e.target.value as PaymentStatusValue | '' })}>
              <option value="">{t('money2.chooseStatus')}</option>
              {PAYMENT_STATUSES.filter(s => s !== changeTarget?.status).map(s => <option key={s} value={s}>{t(paymentStatusKey(s))}</option>)}
            </Select>
          </Field>
          <Field label={t('money2.reason')} hint={t('money2.reasonHint')} required>
            <textarea className="ui-input min-h-[80px]" data-testid="change-reason" value={changeFields.reason} onChange={e => setChangeFields({ ...changeFields, reason: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setChangeTarget(null)} disabled={busy}>{t('money2.close')}</Button>
          <Button
            variant="primary" size="md" onClick={handleRequestChange} data-testid="change-submit"
            disabled={busy || !changeFields.status || !changeFields.reason.trim()}
          >
            {busy ? t('money2.saving') : t('money2.requestChangeSubmit')}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        title={t('money2.confirmChangeTitle')}
        description={confirmTarget ? `${confirmTarget.member?.displayName || confirmTarget.memberId} · ${paymentTierLabel(confirmTarget)} · ${money(confirmTarget.amountTzs)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {confirmTarget && (
            <p className="text-sm text-[var(--color-fg-secondary)]">
              {fill(t('money2.confirmChangeBody'), { from: statusText(confirmTarget.status), to: statusText(confirmTarget.changeRequestedStatus), reason: confirmTarget.changeRequestReason || '—' })}
            </p>
          )}
          {confirmTarget && (
            <p className="text-xs text-[var(--color-fg-tertiary)]">
              {fill(t('money2.changeRequestedBy'), { who: who(confirmTarget.changeRequestedBy), status: statusText(confirmTarget.changeRequestedStatus), time: whenText(confirmTarget.changeRequestedAt, locale) })}
            </p>
          )}
          {dialogError && <Alert tone="error">{dialogError}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setConfirmTarget(null)} disabled={busy}>{t('money2.close')}</Button>
          <Button variant="primary" size="md" onClick={handleConfirmChange} disabled={busy} data-testid="confirm-change-submit">{busy ? t('money2.saving') : t('money2.confirmChange')}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={t('money2.cancelChangeTitle')}
        description={cancelTarget ? `${cancelTarget.member?.displayName || cancelTarget.memberId} · ${paymentTierLabel(cancelTarget)} · ${money(cancelTarget.amountTzs)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {cancelTarget && <p className="text-sm text-[var(--color-fg-secondary)]">{fill(t('money2.cancelChangeBody'), { status: statusText(cancelTarget.status) })}</p>}
          {dialogError && <Alert tone="error">{dialogError}</Alert>}
          <Field label={t('money2.reasonOptional')}>
            <textarea className="ui-input min-h-[70px]" data-testid="cancel-change-reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setCancelTarget(null)} disabled={busy}>{t('money2.keepRequest')}</Button>
          <Button variant="destructive" size="md" onClick={handleCancelChange} disabled={busy} data-testid="cancel-change-submit">{busy ? t('money2.saving') : t('money2.cancelChange')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
