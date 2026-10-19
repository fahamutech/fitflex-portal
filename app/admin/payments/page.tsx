'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Ban, Undo2, ShieldCheck, Pencil } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ApiError, PaymentRequest, PaymentStatusValue } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field, Select, ErrorState } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter, ConfirmDialog } from '@/components/dialog';
import { ApproveWithReferenceDialog, TransactionIdCell, approvesWithMemberReference } from '@/components/member-reference';
import { money, statusTone } from '@/lib/admin-utils';
import { fill } from '@/components/communication-shared';
import type { MessageKey } from '@/lib/i18n';
import {
  DECIDED_STATUSES, PAYMENT_STATUSES, PAYMENT_STAGE_TONE, errorCode, expectedAmount, flagOnErrorKey, moneyErrorKey, paymentStageKey, paymentStatusKey, whenText,
} from '@/lib/money-approval';

type PaymentFilter = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all';
type KindFilter = 'all' | 'trainer_pass';
type Translate = (key: MessageKey) => string;

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

const upper = (s: string) => s.toLocaleUpperCase();

/** What the payment is for, as the type badge shows it (kind only; the detail goes on the line below). */
function paymentKindLabel(payment: PaymentRequest, t: Translate): string {
  if (upgradeOf(payment)) return upper(t('payments.kind.upgrade'));
  if (payment.bookingGroupId) return upper(t('payments.kind.trainerSession'));
  if (payment.orderId) return upper(t('payments.kind.shopOrder'));
  if (isTrainerPass(payment)) return upper(t('payments.kind.trainerPass'));
  if (payment.subscription?.type === 'direct_sub') return upper(t('payments.kind.gymPlan'));
  const tier = payment.tier || payment.subscription?.tier;
  return typeof tier === 'string' && tier.trim() ? upper(tier) : '—';
}

/** The line under the badge: the tier change of an upgrade ("BASIC → PRO") or a plan's period ("WEEKLY"); else null. */
function paymentDetail(payment: PaymentRequest): string | null {
  const up = upgradeOf(payment);
  if (up) {
    const to = upper(payment.tier || '');
    return up.fromTier ? `${upper(up.fromTier)} → ${to}` : `→ ${to}`;
  }
  if (isTrainerPass(payment) || payment.subscription?.type === 'direct_sub') {
    const plan = upper(payment.subscription?.plan || payment.plan || '');
    return plan || null;
  }
  return null;
}

/** The whole label, for dialog descriptions: kind plus its detail. */
function paymentLabel(payment: PaymentRequest, t: Translate): string {
  const detail = paymentDetail(payment);
  return detail ? `${paymentKindLabel(payment, t)} · ${detail}` : paymentKindLabel(payment, t);
}

/** Sentence case for a line that may start with a filled-in name ("another admin asked…"). */
const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

export default function PaymentsPage() {
  const { token, user, t, locale } = useApp();
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  // Loading the list failing is shown as its own state; `error` is for actions on a row.
  const [loadFailed, setLoadFailed] = useState(false);
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
  // Confirming a shop-order payment as approved needs the amount actually received.
  const [confirmAmount, setConfirmAmount] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setPayments(await api.paymentRequests(token));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const filtered = payments
    .filter(p => filter === 'all' || p.status === filter)
    .filter(p => kind === 'all' || isTrainerPass(p));

  /** `reference`: from the member transaction-ID dialog (slice A3); recorded with the approval. */
  async function handleAction(reference?: string) {
    if (!token || !actionTarget) return;
    setBusy(true);
    try {
      await api.updatePayment(token, actionTarget.payment.id, { status: actionTarget.action, ...(reference ? { reference } : {}) });
      setActionTarget(null);
      setError(null);
      await load();
    } catch (e) {
      // A3: a transaction ID already on another pending/approved payment has its own message; else A1's flag-on errors.
      const used = actionTarget.action === 'approved' && errorCode(e) === 'reference_already_used';
      const key = used ? 'manualPay.err.referenceUsed' as const : flagOnErrorKey(e, !!actionTarget.payment.secondApproverRequired);
      if (key) setActionTarget(null);
      setError(t(key ?? 'money2.err.generic'));
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
      setError(null);
      await load();
    } catch (e) {
      setError(t(flagOnErrorKey(e, !!editTarget.secondApproverRequired) ?? 'money2.err.generic'));
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
      setNotice(raised?.refund?.status === 'requested' ? t('money2.notice.refundNeedsApproval') : t('money2.notice.refundRaised'));
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
      setRefundError(t(code === 'refund_already_requested' ? 'payments.refund.err.already'
        : code === 'amount_exceeds_payment' ? 'payments.refund.err.exceeds'
        : 'payments.refund.err.generic'));
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
      const expected = errorCode(e) === 'amount_mismatch' ? expectedAmount(e) : null;
      setDialogError(expected != null ? fill(t('money2.err.amount_mismatch_expected'), { amount: money(expected) }) : t(moneyErrorKey(e)));
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
    () => api.confirmPaymentChange(token!, confirmTarget.id, needsAmount(confirmTarget) ? { amountTzs: Number(confirmAmount) } : {}),
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
  const isMe = (id: string | null | undefined) => !!id && id === user.id;
  /** Another admin by name when the API sends one; never the raw id. */
  const otherAdmin = (name: string | null | undefined) => name?.trim() || t('money2.otherAdmin');
  const verifiedLine = (p: PaymentRequest) => (isMe(p.verifiedBy)
    ? fill(t('money2.verifiedByYou'), { time: whenText(p.verifiedAt, locale) })
    : fill(t('money2.verifiedBy'), { who: otherAdmin(p.verifiedByName), time: whenText(p.verifiedAt, locale) }));
  const changeLine = (p: PaymentRequest) => (isMe(p.changeRequestedBy)
    ? fill(t('money2.changeRequestedByYou'), { status: statusText(p.changeRequestedStatus), time: whenText(p.changeRequestedAt, locale) })
    : cap(fill(t('money2.changeRequestedBy'), { who: otherAdmin(p.changeRequestedByName), status: statusText(p.changeRequestedStatus), time: whenText(p.changeRequestedAt, locale) })));
  const needsAmount = (p: PaymentRequest | null) => !!p?.orderId && p.changeRequestedStatus === 'approved';
  const isDecided = (p: PaymentRequest) => (DECIDED_STATUSES as string[]).includes(p.status);
  /** Why Approve is not offered to this admin on a two-admin payment (full sentence, for the tooltip), or null. */
  const approveBlocked = (p: PaymentRequest): string | null => {
    if (!p.secondApproverRequired) return null;
    if (p.approvalStage === 'awaiting_verification' || !p.verifiedBy) return t('money2.approveBlockedUnverified');
    if (p.approveNotBy && p.approveNotBy === user.id) return t('money2.approveBlockedOwn');
    return null;
  };
  /** The same reason as short visible text under the status (the line above it already says who verified). */
  const approveHint = (p: PaymentRequest): string | null => {
    if (p.status !== 'pending' || !approveBlocked(p)) return null;
    return t(!p.verifiedBy || p.approvalStage === 'awaiting_verification' ? 'money2.approveHintUnverified' : 'money2.approveHintOwn');
  };
  const confirmBlocked = (p: PaymentRequest) => !!p.secondApproverRequired && !!p.changeRequestedBy && !!p.confirmChangeNotBy && p.confirmChangeNotBy === user.id;
  // Reference is fixed once verified or decided (the server refuses a change).
  const referenceLocked = (p: PaymentRequest | null) => !!p?.secondApproverRequired && (isDecided(p) || !!p.verifiedBy);
  const memberName = (p: PaymentRequest) => p.member?.displayName || p.member?.email || p.memberId;
  const upgradeNote = (p: PaymentRequest) => {
    if (!upgradeOf(p)) return null;
    const ends = p.subscription?.expiresAt;
    return ends ? fill(t('payments.upgradeNote'), { date: whenText(ends, locale) }) : t('payments.upgradeNoteNoDate');
  };
  const hintId = (p: PaymentRequest) => `payment-hint-${p.id}`;
  const twoAdminStage = (p: PaymentRequest) => p.secondApproverRequired && (p.approvalStage === 'awaiting_verification' || p.approvalStage === 'awaiting_second_approval');

  // Fits 1280px with the actions pinned: the date sits under the member, the note under the type.
  const columns: ColumnDef<PaymentRequest>[] = [
    {
      // Sorts by date (the line under the name); newest first by default.
      key: 'requestedAt', header: t('payments.col.memberDate'), sortable: true,
      cell: (p) => (
        <div className="min-w-[7.5rem] max-w-[10rem]">
          <div className="font-medium text-[var(--color-fg-primary)] text-sm" title={p.id}>{memberName(p)}</div>
          <div className="text-xs tabular-nums whitespace-nowrap text-[var(--color-fg-tertiary)]" data-testid="payment-date">{whenText(p.requestedAt, locale)}</div>
        </div>
      ),
    },
    {
      key: 'tier', header: t('payments.col.type'), sortable: true,
      cell: (p) => {
        const note = upgradeNote(p) ?? (p.note || '');
        return (
          <div className="max-w-[8.5rem]">
            <span className="whitespace-nowrap"><Badge tone={upgradeOf(p) ? 'gray' : isTrainerPass(p) ? 'warning' : 'brand'}>{paymentKindLabel(p, t)}</Badge></span>
            {paymentDetail(p) && <div className="mt-1 text-xs font-medium text-[var(--color-fg-secondary)]" data-testid="payment-detail">{paymentDetail(p)}</div>}
            {p.gym && <div className="mt-1 truncate text-xs text-[var(--color-fg-tertiary)]" title={p.gym.name}>{p.gym.name}</div>}
            {/* Long notes are cut to one line; the full text is in the tooltip and in Edit. */}
            {note && <div className="mt-1 truncate text-xs text-[var(--color-fg-quaternary)]" title={note} data-testid="payment-note">{note}</div>}
          </div>
        );
      },
    },
    { key: 'amountTzs', header: t('payments.col.amount'), sortable: true, align: 'right', cell: (p) => <span className="tabular-nums font-medium whitespace-nowrap">{money(p.amountTzs)}</span> },
    {
      key: 'status', header: t('payments.col.status'), sortable: true,
      cell: (p) => (
        <div className="space-y-1 min-w-[8.5rem] max-w-[11rem]">
          {/* Awaiting verification / second approval are a more precise "Pending": show the stage alone.
              A change request sits on a decided payment, so its status still adds something. */}
          <div className="flex flex-wrap gap-1">
            {!twoAdminStage(p) && (
              <span data-testid="payment-status"><Badge tone={statusTone(p.status)}>{statusText(p.status)}</Badge></span>
            )}
            {p.secondApproverRequired && p.approvalStage && (
              <span data-testid="payment-stage"><Badge tone={PAYMENT_STAGE_TONE[p.approvalStage] ?? 'warning'}>{t(paymentStageKey(p.approvalStage))}</Badge></span>
            )}
          </div>
          {/* One audit line: a waiting change request matters more than who verified. */}
          {p.secondApproverRequired && p.changeRequestedBy ? (
            <div className="text-xs text-[var(--color-fg-tertiary)]" data-testid="payment-change-requested-by">
              {changeLine(p)}
              {p.changeRequestReason && (
                <div className="truncate text-[var(--color-fg-quaternary)]" title={p.changeRequestReason}>“{p.changeRequestReason}”</div>
              )}
            </div>
          ) : p.secondApproverRequired && p.verifiedBy ? (
            <div className="text-xs text-[var(--color-fg-tertiary)]" data-testid="payment-verified-by">{verifiedLine(p)}</div>
          ) : null}
          {/* Why Approve / Confirm change is not open to this admin: visible, not only a tooltip. */}
          {approveHint(p) && (
            <div id={hintId(p)} className="text-xs font-medium text-[var(--color-warning-700)]" data-testid="payment-approve-hint">{approveHint(p)}</div>
          )}
          {!approveHint(p) && confirmBlocked(p) && (
            <div id={hintId(p)} className="text-xs font-medium text-[var(--color-warning-700)]" data-testid="payment-confirm-hint">{t('money2.confirmHintOwn')}</div>
          )}
        </div>
      ),
    },
    { key: 'reference', header: t('payments.col.reference'), cell: (p) => <TransactionIdCell payment={p} /> },
  ];
  const iconBtn = 'w-9 px-0 justify-center';

  const filterButton = (active: boolean) => `px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
    active ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]' : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
  }`;

  /** Facts to check before deciding: amount, transaction ID and who verified it (same for passes, plans and shop orders). */
  const decisionFacts = (p: PaymentRequest) => {
    const ref = p.reference || p.memberReference;
    return (
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] px-3 py-2 text-left text-xs" data-testid="decision-facts">
        <dt className="text-[var(--color-fg-tertiary)]">{t('payments.col.member')}</dt>
        <dd className="font-medium text-[var(--color-fg-primary)]">{memberName(p)} · {paymentLabel(p, t)}{p.gym ? ` · ${p.gym.name}` : ''}</dd>
        <dt className="text-[var(--color-fg-tertiary)]">{t('payments.dialog.amount')}</dt>
        <dd className="font-medium tabular-nums text-[var(--color-fg-primary)]">{money(p.amountTzs)}</dd>
        {ref && (
          <>
            <dt className="text-[var(--color-fg-tertiary)]">{t('payments.dialog.reference')}</dt>
            <dd className="font-mono font-semibold text-[var(--color-fg-primary)]" data-testid="decision-reference">{ref}</dd>
          </>
        )}
        {p.secondApproverRequired && p.verifiedBy && (
          <>
            <dt className="text-[var(--color-fg-tertiary)]">{t('payments.dialog.verifiedBy')}</dt>
            <dd className="text-[var(--color-fg-primary)]" data-testid="decision-verified-by">
              {isMe(p.verifiedBy) ? cap(t('money2.you')) : otherAdmin(p.verifiedByName)} · {whenText(p.verifiedAt, locale)}
            </dd>
          </>
        )}
      </dl>
    );
  };
  const decisionBody = (target: { payment: PaymentRequest; action: 'approved' | 'rejected' | 'cancelled' }) => {
    const p = target.payment;
    const sentences = [t(target.action === 'approved' ? 'payments.dialog.approveBody' : target.action === 'rejected' ? 'payments.dialog.rejectBody' : 'payments.dialog.cancelBody')];
    if (target.action === 'approved') {
      if (p.orderId) sentences.push(t('payments.dialog.orderPaid'));
      else if (upgradeOf(p)) sentences.push(t('payments.dialog.upgradeNow'));
      else if (isTrainerPass(p)) sentences.push(t('payments.dialog.passStarts'));
    }
    return <div><p>{sentences.join(' ')}</p>{decisionFacts(p)}</div>;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('payments.title')}
        description={loadFailed && !payments.length ? undefined
          : fill(t('payments.summary'), { total: payments.length, pending: payments.filter(p => p.status === 'pending').length })}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {t('payments.refresh')}
          </Button>
        }
      />

      {/* A failed refresh keeps the rows already shown, with one message. */}
      {loadFailed && payments.length > 0 && <Alert tone="error">{t('payments.loadFailedTitle')}. {t('payments.loadFailedBody')}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {loading && !payments.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : loadFailed && !payments.length ? (
        // Nothing loaded: one error with a retry, not an empty table.
        <div data-testid="payments-load-error">
          <ErrorState title={t('payments.loadFailedTitle')} message={t('payments.loadFailedBody')} onRetry={load} retryLabel={t('common.tryAgain')} />
        </div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={filtered}
              keyFn={(p) => p.id}
              label={t('payments.title')}
              stickyActions
              dense
              defaultSort={{ key: 'requestedAt', dir: 'desc' }}
              filterPlaceholder={t('payments.search')}
              emptyState={t('payments.empty')}
              extraFilters={
                <div className="flex flex-wrap gap-1" role="group" aria-label={t('payments.filtersLabel')}>
                  {(['pending', 'approved', 'rejected', 'cancelled', 'all'] as const).map(f => (
                    <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={filterButton(filter === f)}>
                      {f === 'all' ? t('payments.filter.all') : t(paymentStatusKey(f))}
                    </button>
                  ))}
                  <span className="mx-1 w-px self-stretch bg-[var(--color-border-secondary)]" aria-hidden />
                  {([['all', 'payments.type.all'], ['trainer_pass', 'payments.type.trainerPass']] as const).map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={filterButton(kind === k)}>
                      {t(label)}
                    </button>
                  ))}
                </div>
              }
              actions={(payment) => (
                <>
                  {payment.status === 'pending' && payment.secondApproverRequired && !payment.verifiedBy && (
                    <Button
                      variant="ghost" size="sm" data-testid="payment-verify" title={t('money2.verify')}
                      className="max-[1439px]:w-9 max-[1439px]:px-0 max-[1439px]:justify-center"
                      onClick={() => { setVerifyTarget(payment); setDialogError(null); setNotice(null); setVerifyFields({ reference: payment.reference || payment.memberReference || '', note: '' }); }}
                    >
                      {/* Icon only below 1440px so the row fits; the word stays as the accessible name. */}
                      <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" /> <span className="max-[1439px]:sr-only">{t('money2.verify')}</span>
                    </Button>
                  )}
                  {payment.status === 'pending' && (
                    <>
                      {approveBlocked(payment) ? (
                        // A disabled button gets no hover in every browser: the wrapper carries the tooltip too;
                        // the reason is also visible text under the status (approveHint).
                        <span title={approveBlocked(payment)!} data-testid="payment-approve-blocked">
                          <Button variant="ghost" size="sm" className={iconBtn} disabled aria-label={approveBlocked(payment)!} aria-describedby={hintId(payment)} title={approveBlocked(payment)!} data-testid="payment-approve">
                            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                          </Button>
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" className={iconBtn} onClick={() => setActionTarget({ payment, action: 'approved' })} title={t('payments.action.approve')} aria-label={t('payments.action.approve')} data-testid="payment-approve">
                          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setActionTarget({ payment, action: 'rejected' })} title={t('payments.action.reject')} aria-label={t('payments.action.reject')} data-testid="payment-reject" className={iconBtn}>
                        <XCircle aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setActionTarget({ payment, action: 'cancelled' })} title={t('payments.action.cancel')} aria-label={t('payments.action.cancel')} data-testid="payment-cancel" className={iconBtn}>
                        <Ban aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-fg-tertiary)]" />
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
                      {confirmBlocked(payment) ? (
                        <span title={t('money2.confirmChangeBlockedOwn')} data-testid="payment-confirm-change-blocked">
                          <Button variant="ghost" size="sm" disabled title={t('money2.confirmChangeBlockedOwn')} aria-describedby={hintId(payment)} data-testid="payment-confirm-change">
                            {t('money2.confirmChange')}
                          </Button>
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" data-testid="payment-confirm-change" onClick={() => { setConfirmTarget(payment); setConfirmAmount(''); setDialogError(null); setNotice(null); }}>
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
                      variant="ghost" size="sm" title={t('payments.action.refund')} aria-label={t('payments.action.refund')} data-testid="payment-refund" className={iconBtn}
                      onClick={() => { setRefundTarget(payment); setRefundError(null); setNotice(null); setRefundFields({ amount: String(payment.amountTzs), note: '' }); }}
                    >
                      <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="sm" title={t('payments.action.edit')} aria-label={t('payments.action.edit')} data-testid="payment-edit" className={iconBtn}
                    onClick={() => { setEditTarget(payment); setEditFields({ reference: payment.reference || '', note: upgradeOf(payment) ? '' : (payment.note || '') }); }}
                  >
                    <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            />
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!actionTarget && !approvesWithMemberReference(actionTarget)}
        onClose={() => setActionTarget(null)}
        onConfirm={() => handleAction()}
        title={t(actionTarget?.action === 'approved' ? 'payments.dialog.approveTitle' : actionTarget?.action === 'rejected' ? 'payments.dialog.rejectTitle' : 'payments.dialog.cancelTitle')}
        description={actionTarget ? decisionBody(actionTarget) : undefined}
        confirmLabel={t(actionTarget?.action === 'approved' ? 'payments.action.approve' : actionTarget?.action === 'rejected' ? 'payments.action.reject' : 'payments.action.cancel')}
        cancelLabel={actionTarget?.action === 'cancelled' ? t('payments.dialog.keep') : undefined}
        tone={actionTarget?.action === 'approved' ? 'primary' : 'danger'}
        busy={busy}
      />

      <ApproveWithReferenceDialog
        payment={approvesWithMemberReference(actionTarget) ? actionTarget!.payment : null}
        verifiedText={actionTarget?.payment.secondApproverRequired && actionTarget.payment.verifiedBy ? verifiedLine(actionTarget.payment) : null}
        busy={busy}
        onClose={() => setActionTarget(null)}
        onConfirm={(reference) => handleAction(reference)}
      />

      <Dialog
        open={!!refundTarget}
        onClose={() => setRefundTarget(null)}
        title={t('payments.action.refund')}
        description={refundTarget ? fill(t('payments.refund.description'), { member: memberName(refundTarget), kind: paymentLabel(refundTarget, t), amount: money(refundTarget.amountTzs) }) : ''}
        size="sm"
      >
        <div className="space-y-4">
          {refundError && <Alert tone="error">{refundError}</Alert>}
          <Field label={t('payments.refund.amount')}>
            <input className="ui-input" inputMode="numeric" value={refundFields.amount} onChange={e => setRefundFields({ ...refundFields, amount: e.target.value.replace(/[^0-9]/g, '') })} />
          </Field>
          <Field label={t('payments.refund.why')} hint={t('payments.refund.whyHint')}>
            <textarea className="ui-input min-h-[70px]" value={refundFields.note} onChange={e => setRefundFields({ ...refundFields, note: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setRefundTarget(null)} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="primary" size="md" onClick={handleRefund} disabled={busy || !(Number(refundFields.amount) > 0)}>{busy ? t('money2.saving') : t('payments.refund.submit')}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} title={t('payments.edit.title')} size="sm">
        <div className="space-y-4">
          <Field label={t('payments.edit.reference')} hint={referenceLocked(editTarget) ? t('money2.referenceLocked') : undefined}>
            <input className="ui-input font-mono" value={editFields.reference} disabled={referenceLocked(editTarget)} onChange={e => setEditFields({ ...editFields, reference: e.target.value })} />
          </Field>
          <Field label={t('payments.edit.note')}>
            <textarea className="ui-input min-h-[80px]" value={editFields.note} onChange={e => setEditFields({ ...editFields, note: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setEditTarget(null)} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="primary" size="md" onClick={handleEdit} disabled={busy}>{busy ? t('money2.saving') : t('payments.edit.save')}</Button>
        </DialogFooter>
      </Dialog>

      {/* A1 second approver (MONEY_SECOND_APPROVER on only). */}
      <Dialog
        open={!!verifyTarget}
        onClose={() => setVerifyTarget(null)}
        title={t('money2.verifyTitle')}
        description={verifyTarget ? `${memberName(verifyTarget)} · ${paymentLabel(verifyTarget, t)} · ${money(verifyTarget.amountTzs)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-fg-secondary)]">{t(verifyTarget?.orderId ? 'money2.verifyBodyOrder' : 'money2.verifyBody')}</p>
          {verifyTarget && (verifyTarget.memberReference || verifyTarget.payerPhone) && (
            // What the member says they paid with: match it against the till statement.
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-4 py-3 text-sm text-[var(--color-info-800)]" data-testid="verify-member-details">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {verifyTarget.memberReference && (
                  <>
                    <dt>{t('money2.memberRef')}</dt>
                    <dd className="font-mono font-semibold" data-testid="verify-member-reference">{verifyTarget.memberReference}</dd>
                  </>
                )}
                {verifyTarget.payerPhone && (
                  <>
                    <dt>{t('money2.payerPhone')}</dt>
                    <dd className="font-mono font-semibold" data-testid="verify-payer-phone">{verifyTarget.payerPhone}</dd>
                  </>
                )}
              </dl>
              <p className="mt-2 text-xs">{t('money2.matchStatement')}</p>
            </div>
          )}
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
        description={changeTarget ? `${memberName(changeTarget)} · ${paymentLabel(changeTarget, t)} · ${money(changeTarget.amountTzs)}` : ''}
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
        description={confirmTarget ? `${memberName(confirmTarget)} · ${paymentLabel(confirmTarget, t)} · ${money(confirmTarget.amountTzs)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {confirmTarget && (
            <p className="text-sm text-[var(--color-fg-secondary)]">
              {fill(t(confirmTarget.orderId ? 'money2.confirmChangeBodyOrder' : 'money2.confirmChangeBody'), { from: statusText(confirmTarget.status), to: statusText(confirmTarget.changeRequestedStatus), reason: confirmTarget.changeRequestReason || '—' })}
            </p>
          )}
          {confirmTarget && (
            <p className="text-xs text-[var(--color-fg-tertiary)]">
              {changeLine(confirmTarget)}
            </p>
          )}
          {dialogError && <Alert tone="error">{dialogError}</Alert>}
          {needsAmount(confirmTarget) && (
            <Field label={t('money2.amountReceived')} hint={t('money2.amountReceivedHint')} required>
              <input className="ui-input" inputMode="numeric" data-testid="confirm-change-amount" value={confirmAmount} onChange={e => setConfirmAmount(e.target.value.replace(/[^0-9]/g, ''))} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setConfirmTarget(null)} disabled={busy}>{t('money2.close')}</Button>
          <Button variant="primary" size="md" onClick={handleConfirmChange} disabled={busy || (needsAmount(confirmTarget) && !(Number(confirmAmount) > 0))} data-testid="confirm-change-submit">{busy ? t('money2.saving') : t('money2.confirmChange')}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={t('money2.cancelChangeTitle')}
        description={cancelTarget ? `${memberName(cancelTarget)} · ${paymentLabel(cancelTarget, t)} · ${money(cancelTarget.amountTzs)}` : ''}
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
