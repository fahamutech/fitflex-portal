'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { errorBody, errorCode } from '@/lib/vendor';
import { HELD_REFUND_REASONS, heldPaymentsApi, type HeldPayment, type HeldStatus } from '@/lib/held-payments';
import { money } from '@/lib/admin-utils';
import { moneyErrorKey, whenText } from '@/lib/money-approval';
import { fill } from '@/components/communication-shared';
import {
  Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonTable, Table, TBody, Td, Textarea, Th, THead, Tr, useToast,
} from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { useApp } from '../../providers';

const NOTE_MAX = 500;
const HELD_REASONS = ['request_closed', 'amount_mismatch', 'transaction_mismatch', 'reference_already_used', 'sandbox_not_settled'];
const REQUEST_STATUS: Record<string, MessageKey> = {
  cancelled: 'heldPayments.status.cancelled', rejected: 'heldPayments.status.rejected', pending: 'heldPayments.status.pending',
};
const REFUND_STATUS: Record<string, MessageKey> = {
  requested: 'refunds.filter.requested', approved: 'refunds.filter.approved', paid: 'refunds.filter.paid', rejected: 'refunds.filter.rejected',
};
const REASON_LABEL: Record<string, MessageKey> = {
  payment_error: 'refunds.reason.payment_error', cancelled_by_fitflex: 'refunds.reason.cancelled_by_fitflex',
  charged_twice: 'refunds.reason.charged_twice', other: 'refunds.reason.other',
};
/** Refusals with their own text; the refund-scope ones (own request / own approval) use the shared money texts. */
const KNOWN: MessageKey[] = [
  'heldPayments.err.amount_unknown', 'heldPayments.err.invalid_amount', 'heldPayments.err.amount_exceeds_payment', 'heldPayments.err.transaction_id_required',
  'heldPayments.err.reason_code_required', 'heldPayments.err.invalid_reason', 'heldPayments.err.payment_not_found', 'heldPayments.err.not_held',
  'heldPayments.err.not_refundable', 'heldPayments.err.refund_already_requested', 'heldPayments.err.use_event_refund', 'heldPayments.err.nothing_to_refund',
  'heldPayments.err.feature_disabled',
];
/** Codes after which the row on screen is out of date, so the list is reloaded. */
const STALE = ['not_held', 'not_refundable', 'refund_already_requested', 'payment_not_found', 'use_event_refund', 'nothing_to_refund'];

/**
 * Held payments (admin audit M5): money a provider confirmed that no payment request could take. A refund is raised
 * (never paid) here; approval and payment stay on the Refunds screen. Dormant until the server flag
 * HELD_PAYMENTS_WORKLIST is on (404 feature_disabled => "not switched on", not an error). Scope `payments`.
 */
export default function HeldPaymentsPage() {
  const { token, t, locale } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState<HeldStatus>('open');
  const [items, setItems] = useState<HeldPayment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'off'>('loading');
  const [refunding, setRefunding] = useState<HeldPayment | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setState('loading');
    try {
      setItems((await heldPaymentsApi.list(token, status)).items); setState('ready');
    } catch (err) {
      // Only the server's own 404 feature_disabled is "off"; any other failure (incl. a plain 404) is a load error with a retry.
      if (err instanceof ApiError && err.status === 404 && errorCode(err) === 'feature_disabled') { setState('off'); return; }
      setState('error');
    }
  }, [token, status]);
  useEffect(() => { void load(); }, [load]);

  const header = (
    <PageHeader
      title={t('heldPayments.title')}
      description={t('heldPayments.intro')}
      actions={state === 'ready' || state === 'error' ? (
        <Button variant="secondary" className="min-h-11" onClick={load}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('admin.action.refresh')}</Button>
      ) : undefined}
    />
  );

  if (state === 'off') return <div>{header}<div data-testid="held-off"><EmptyState title={t('heldPayments.off')} /></div></div>;

  const heldText = (r: string) => t((HELD_REASONS.includes(r) ? `heldPayments.held.${r}` : 'heldPayments.held.other') as MessageKey);

  return (
    <div className="space-y-4" data-testid="held-payments">
      {header}
      <div className="max-w-xs">
        <Field label={t('heldPayments.filter.label')}>
          <Select value={status} onChange={e => setStatus(e.target.value as HeldStatus)} data-testid="held-filter">
            <option value="open">{t('heldPayments.filter.open')}</option>
            <option value="resolved">{t('heldPayments.filter.resolved')}</option>
          </Select>
        </Field>
      </div>
      {state === 'loading' ? <div aria-busy="true"><SkeletonTable rows={5} columns={5} /></div>
        : state === 'error' ? <ErrorState title={t('heldPayments.loadFailed')} onRetry={load} retryLabel={t('common.tryAgain')} />
        : items.length === 0 ? <EmptyState title={t(status === 'open' ? 'heldPayments.empty' : 'heldPayments.emptyResolved')} />
        : (
          <Card className="p-0">
            <Table aria-label={t('heldPayments.title')} data-testid="held-table">
              <THead>
                <Tr>
                  <Th>{t('heldPayments.col.tx')}</Th>
                  <Th className="!text-right">{t('heldPayments.col.amount')}</Th>
                  <Th>{t('heldPayments.col.who')}</Th>
                  <Th>{t('heldPayments.col.status')}</Th>
                  <Th>{t('heldPayments.col.action')}</Th>
                </Tr>
              </THead>
              <TBody>
                {items.map(r => (
                  <Tr key={`${r.paymentRequestId}|${r.transactionId}`} data-testid={`held-row-${r.transactionId ?? r.paymentRequestId}`}>
                    <Td>
                      <div className="font-mono text-xs">{r.transactionId ?? '—'}</div>
                      <div className="mt-1 text-xs text-[var(--color-fg-tertiary)]">{heldText(r.reason)}</div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {r.amountTzs != null && r.amountReceivedKnown ? money(r.amountTzs) : <Badge tone="warning">{t('heldPayments.amountUnknown')}</Badge>}
                    </Td>
                    <Td>
                      <div className="font-mono text-xs">{r.memberId ?? '—'}</div>
                      <div className="mt-1 whitespace-nowrap text-xs text-[var(--color-fg-tertiary)]">{whenText(r.at, locale)}</div>
                    </Td>
                    <Td>
                      <Badge tone="gray">{fill(t('heldPayments.request'), { status: REQUEST_STATUS[r.requestStatus] ? t(REQUEST_STATUS[r.requestStatus]) : r.requestStatus })}</Badge>
                      {r.refundStatus && (
                        <div className="mt-1 text-xs text-[var(--color-fg-tertiary)]">
                          {fill(t('heldPayments.refundStatus'), { status: REFUND_STATUS[r.refundStatus] ? t(REFUND_STATUS[r.refundStatus]) : r.refundStatus })}
                        </div>
                      )}
                    </Td>
                    <Td>
                      {r.refundable ? (
                        <Button size="sm" className="min-h-11" onClick={() => setRefunding(r)} data-testid="held-refund">{t('heldPayments.refund')}</Button>
                      ) : (
                        <span className="max-w-[18rem] text-xs text-[var(--color-fg-tertiary)]" data-testid="held-no-refund">
                          {r.notRefundableReason ? t(`heldPayments.no.${r.notRefundableReason}` as MessageKey) : '—'}
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      {refunding && (
        <RefundDialog
          item={refunding}
          onClose={() => setRefunding(null)}
          onStale={() => { void load(); }}
          onDone={async () => { setRefunding(null); toast.success(t('heldPayments.done')); await load(); }}
        />
      )}
    </div>
  );
}

function RefundDialog({ item, onClose, onDone, onStale }: { item: HeldPayment; onClose: () => void; onDone: () => void; onStale: () => void }) {
  const { token, t } = useApp();
  const unknown = !item.amountReceivedKnown || item.amountTzs == null;
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refusal(err: unknown): string {
    if (err instanceof ApiError && err.status === 403 && errorBody(err)?.error === 'forbidden') return t('heldPayments.err.forbidden');
    const code = errorCode(err);
    if (code) {
      const own = `heldPayments.err.${code}` as MessageKey;
      if (KNOWN.includes(own)) { if (STALE.includes(code)) onStale(); return t(own); }
      if (code === 'cannot_approve_own_request' || code === 'cannot_pay_own_approval') return t(moneyErrorKey(err));
    }
    return t('heldPayments.err.generic');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !item.transactionId) return;
    if (!reasonCode) { setError(t('heldPayments.reason.required')); return; }
    if (reasonCode === 'other' && !note.trim()) { setError(t('heldPayments.note.required')); return; }
    const stated = Math.round(Number(amount));
    if (unknown && !(Number.isFinite(stated) && stated > 0)) { setError(t('heldPayments.amount.required')); return; }
    setBusy(true); setError(null);
    try {
      await heldPaymentsApi.refund(token, item.paymentRequestId, {
        transactionId: item.transactionId, reasonCode,
        ...(unknown ? { amountTzs: stated } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone();
    } catch (err) {
      setError(refusal(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={t('heldPayments.dialog.title')} description={t('heldPayments.dialog.body')}>
      <form onSubmit={submit} className="space-y-4" data-testid="held-dialog" noValidate>
        <div className="font-mono text-xs text-[var(--color-fg-tertiary)]">{item.transactionId}</div>
        <Field label={t('heldPayments.reason')} required>
          <Select value={reasonCode} onChange={e => { setReasonCode(e.target.value); setError(null); }} data-testid="held-reason">
            <option value="">{t('heldPayments.reason.choose')}</option>
            {HELD_REFUND_REASONS.map(c => <option key={c} value={c}>{t(REASON_LABEL[c])}</option>)}
          </Select>
        </Field>
        {unknown && (
          <Field label={t('heldPayments.amount')} required hint={t('heldPayments.amount.hint')}>
            <Input type="number" inputMode="numeric" min={1} step={1} value={amount} onChange={e => { setAmount(e.target.value); setError(null); }} data-testid="held-amount" />
          </Field>
        )}
        <Field label={t('heldPayments.note')} required={reasonCode === 'other'} hint={`${note.length}/${NOTE_MAX}`}>
          <Textarea rows={3} maxLength={NOTE_MAX} value={note} onChange={e => { setNote(e.target.value); setError(null); }} data-testid="held-note" />
        </Field>
        {error && <div data-testid="held-error"><Alert tone="error">{error}</Alert></div>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" variant="destructive" className="min-h-11" loading={busy} data-testid="held-submit">
            {unknown ? t('heldPayments.confirmUnknown') : fill(t('heldPayments.confirm'), { amount: money(item.amountTzs) })}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
