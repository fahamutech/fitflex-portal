'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, GymSettlementDetail, SettlementAdjustment, SettlementStep } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import {
  ADJUSTMENT_STATUS, ADJUSTMENT_TYPE_LABEL, BRACKET_LABEL, FUNDING_LABEL, STATEMENT_STATUS,
  period, settlementError, shortDay, signed, visitReason,
} from '@/lib/settlements';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, Input, MetricCard, Spinner } from '@/components/shared';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';

type Ask =
  | { kind: 'confirm'; step: SettlementStep; title: string; description: string; label: string }
  | { kind: 'reason'; step: 'reject' | 'hold' | 'void'; title: string; description: string; label: string }
  | { kind: 'pay' }
  | { kind: 'adjust' }
  | { kind: 'reject-adjustment'; adjustment: SettlementAdjustment };

const th = 'px-4 py-2.5 font-medium';

/** One gym statement: its totals, the members and visits behind it, adjustments, and the next step. */
export function SettlementStatementView({ statementId, onBack }: { statementId: string; onBack: () => void }) {
  const { token, user, hasPermission } = useApp();
  const [detail, setDetail] = useState<GymSettlementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [openLine, setOpenLine] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setDetail(await api.settlementStatement(token, statementId));
    } catch (err) {
      setError((err as { status?: number })?.status === 404 ? 'This statement no longer exists.' : settlementError(err));
    }
  }, [token, statementId]);
  useEffect(() => { load(); }, [load]);

  /** Run one action, then show the statement as it now stands. */
  const act = async (work: (t: string) => Promise<unknown>, done: string) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work(token);
      setAsk(null);
      setNotice(done);
    } catch (err) {
      setAsk(null);
      setError(settlementError(err));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const back = <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)]" data-testid="settlement-back"><ArrowLeft className="h-4 w-4" />All statements</button>;

  if (!detail) {
    return <div className="space-y-4">{back}{error ? <Alert tone="error">{error}</Alert> : <Spinner className="h-6 w-6" />}</div>;
  }

  const { statement: s, lines, visits, adjustments } = detail;
  const live = s.mode === 'live';
  const canPrepare = live && hasPermission('settlements_prepare');
  const canApprove = live && hasPermission('settlements_approve');
  const canPay = live && hasPermission('settlements_pay');
  const held = !!s.holdReason;
  const proposed = adjustments.filter(a => a.status === 'proposed');
  const ownSubmission = s.status === 'submitted' && !!user?.id && s.submittedBy === user.id;
  const visitsOf = (lineId: string) => visits.filter(v => v.lineId === lineId);

  const step = (name: SettlementStep, done: string, body = {}) => act(t => api.settlementStep(t, s.id, name, body), done);

  return (
    <div className="space-y-6">
      {back}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{s.gymName || 'Unnamed gym'}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg-quaternary)]">
            {period(s)}
            <Badge tone={STATEMENT_STATUS[s.status].tone}>{STATEMENT_STATUS[s.status].label}</Badge>
            {held && s.status !== 'voided' && <Badge tone="danger">On hold</Badge>}
            {!live && <Badge tone="gray">Shadow</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="settlement-actions">
          {held && canApprove && s.status !== 'voided' && (
            <Button size="sm" onClick={() => setAsk({ kind: 'confirm', step: 'release', title: 'Release the hold?', description: 'The statement carries on from where it was.', label: 'Release' })}>Release hold</Button>
          )}
          {s.status === 'draft' && canPrepare && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setAsk({ kind: 'adjust' })} data-testid="settlement-adjust">Add adjustment</Button>
              <Button size="sm" disabled={proposed.length > 0} title={proposed.length ? 'Apply or reject the proposed adjustments first' : undefined}
                onClick={() => setAsk({ kind: 'confirm', step: 'submit', title: 'Submit for approval?', description: 'The amounts are fixed from here. Any shortfall carried forward from earlier months is taken off first.', label: 'Submit' })} data-testid="settlement-submit">Submit for approval</Button>
            </>
          )}
          {s.status === 'submitted' && canApprove && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setAsk({ kind: 'reason', step: 'reject', title: 'Send back to draft', description: 'Say what needs fixing. The person who prepared it sees this.', label: 'Send back' })} data-testid="settlement-reject">Send back</Button>
              <Button size="sm" disabled={ownSubmission} title={ownSubmission ? 'You submitted this statement, so someone else has to approve it' : undefined}
                onClick={() => setAsk({ kind: 'confirm', step: 'approve', title: 'Approve this statement?', description: `${money(s.finalNetTzs)} to ${s.gymName || 'this gym'} for ${period(s)}.`, label: 'Approve' })} data-testid="settlement-approve">Approve</Button>
            </>
          )}
          {s.status === 'approved' && canPay && !held && (
            <Button size="sm" onClick={() => setAsk({ kind: 'confirm', step: 'payable', title: 'Clear for payment?', description: 'Checks that the gym’s owner is verified and has a verified payout account, then fixes the account to pay.', label: 'Clear for payment' })} data-testid="settlement-payable">Clear for payment</Button>
          )}
          {s.status === 'payable' && canPay && (
            <Button size="sm" onClick={() => setAsk({ kind: 'pay' })} data-testid="settlement-pay">Record payment</Button>
          )}
          {canApprove && ['draft', 'submitted', 'approved'].includes(s.status) && (
            <Button size="sm" variant="ghost" onClick={() => setAsk({ kind: 'reason', step: 'void', title: 'Void this statement', description: `${s.gymName || 'This gym'} will never be paid for ${period(s)} on this statement, and its visits are not settled again. This can’t be undone. To pay later instead, put it on hold.`, label: 'Void statement' })} data-testid="settlement-void">Void</Button>
          )}
          {!held && canPrepare && ['draft', 'submitted', 'approved', 'payable'].includes(s.status) && (
            <Button size="sm" variant="ghost" onClick={() => setAsk({ kind: 'reason', step: 'hold', title: 'Put on hold', description: 'A statement on hold can’t be paid until it is released.', label: 'Put on hold' })} data-testid="settlement-hold">Put on hold</Button>
          )}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!live && <Alert tone="info">This is a shadow statement: a trial calculation that can’t be submitted, approved or paid.</Alert>}
      {s.status === 'voided' && <Alert tone="error">Voided{s.voidedAt ? ` on ${shortDay(s.voidedAt)}` : ''}: {s.voidReason}. Nothing is paid on this statement.</Alert>}
      {held && s.status !== 'voided' && <Alert tone="warning">On hold: {s.holdReason}</Alert>}
      {s.status === 'draft' && s.rejectReason && <Alert tone="warning">Sent back: {s.rejectReason}</Alert>}
      {s.carryForwardTzs > 0 && <Alert tone="info">{money(s.carryForwardTzs)} could not be recovered from this statement and is carried forward to the gym’s next one.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Earned at the gym’s rates" value={money(s.preliminaryTzs)} sub={`${s.qualifyingVisitCount} visits · ${s.memberCycleCount} members`} />
        <MetricCard label="Network adjustment" value={signed(-s.networkAdjustmentTzs)} sub="Member caps applied" />
        <MetricCard label="Adjustments" value={signed(s.adjustmentsTzs)} sub={proposed.length ? `${proposed.length} waiting for a decision` : 'Corrections and clawbacks'} />
        <MetricCard label={s.status === 'paid' ? 'Paid' : s.status === 'voided' ? 'Not paid (voided)' : 'To pay'} value={<span data-testid="settlement-net">{money(s.finalNetTzs)}</span>} sub={s.heldVisitCount ? `${s.heldVisitCount} visits held back` : undefined} />
      </div>

      {(s.status === 'payable' || s.status === 'paid') && (
        <Card>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
            <div><p className="text-xs text-[var(--color-fg-tertiary)]">Payout account</p><p className="font-medium">{[s.destinationSnapshot?.provider, s.destinationSnapshot?.accountName].filter(Boolean).join(' · ') || '—'}{s.destinationSnapshot?.accountLast4 ? ` ····${s.destinationSnapshot.accountLast4}` : ''}</p></div>
            <div><p className="text-xs text-[var(--color-fg-tertiary)]">Payment reference</p><p className="font-medium">{s.paymentReference || '—'}</p></div>
            <div><p className="text-xs text-[var(--color-fg-tertiary)]">Paid on</p><p className="font-medium">{s.paidAt ? shortDay(s.paidAt) : '—'}{s.receiptUrl && <a className="ml-2 underline" href={s.receiptUrl} target="_blank" rel="noreferrer">Receipt</a>}</p></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><div><h2 className="font-semibold">Members</h2><p className="text-sm text-[var(--color-fg-quaternary)]">One row per member cycle at this gym. Open a row for the check-ins behind it.</p></div></CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? <p className="p-6 text-sm text-[var(--color-fg-quaternary)]">No member visits on this statement.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" data-testid="settlement-lines">
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                  <tr className="border-b border-[var(--color-border-secondary)]">
                    <th className={th}>Member</th>
                    <th className={th}>Paid by</th>
                    <th className={`${th} text-right`}>Visits</th>
                    <th className={th}>Rate used</th>
                    <th className={`${th} text-right`}>Earned</th>
                    <th className={`${th} text-right`}>Network adj.</th>
                    <th className={`${th} text-right`}>Final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {lines.map(l => {
                    const isOpen = openLine === l.id;
                    return (
                      <Fragment key={l.id}>
                        <tr className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => setOpenLine(isOpen ? null : l.id)} data-testid={`settlement-line-${l.id}`}>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1.5 font-medium">
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              {l.member?.displayName || l.member?.publicId || 'Member'}
                            </span>
                            {l.member?.displayName && l.member.publicId && <span className="ml-5 text-xs text-[var(--color-fg-quaternary)]">{l.member.publicId}</span>}
                          </td>
                          <td className="px-4 py-3">{FUNDING_LABEL[l.fundingType ?? ''] ?? '—'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{l.qualifyingVisitCount}{l.heldVisitCount > 0 && <span className="ml-1 text-xs text-[var(--color-warning-700)]">+{l.heldVisitCount} held</span>}</td>
                          <td className="px-4 py-3">{BRACKET_LABEL[l.bracket ?? ''] ?? l.bracket ?? '—'}{l.monotonicGuardApplied && <span className="ml-1 text-xs text-[var(--color-fg-quaternary)]">(raised so more visits never pay less)</span>}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(l.preliminaryTzs)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{l.networkAdjustmentTzs ? signed(-l.networkAdjustmentTzs) : '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{money(l.finalTzs)}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={7} className="bg-[var(--color-bg-secondary)] px-4 py-3">
                              {l.rateCardSnapshot && (
                                <p className="mb-2 text-xs text-[var(--color-fg-tertiary)]">
                                  Gym’s rates: daily {money(l.rateCardSnapshot.wholesaleDailyTzs)} · weekly {money(l.rateCardSnapshot.wholesaleWeeklyTzs)} · monthly {money(l.rateCardSnapshot.wholesaleMonthlyTzs)}
                                </p>
                              )}
                              <ul className="flex flex-wrap gap-2 text-xs">
                                {visitsOf(l.id).map(v => (
                                  <li key={v.id} className="rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] px-2 py-1">
                                    {shortDay(v.businessDate)}
                                    {v.outcome !== 'payable' && <span className="ml-1 text-[var(--color-warning-700)]">· {visitReason(v.eligibility)}</span>}
                                  </li>
                                ))}
                                {visitsOf(l.id).length === 0 && <li className="text-[var(--color-fg-quaternary)]">No check-ins recorded on this line.</li>}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div><h2 className="font-semibold">Adjustments</h2><p className="text-sm text-[var(--color-fg-quaternary)]">Corrections, clawbacks and amounts carried forward. A proposed adjustment changes nothing until someone else applies it.</p></div></CardHeader>
        <CardContent className="p-0">
          {adjustments.length === 0 ? <p className="p-6 text-sm text-[var(--color-fg-quaternary)]">No adjustments.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="settlement-adjustments">
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                  <tr className="border-b border-[var(--color-border-secondary)]">
                    <th className={th}>Type</th>
                    <th className={th}>Reason</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={th}>Status</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {adjustments.map(a => {
                    const own = !!user?.id && a.createdBy === user.id;
                    return (
                      <tr key={a.id} data-testid={`settlement-adjustment-${a.id}`}>
                        <td className="whitespace-nowrap px-4 py-3">{ADJUSTMENT_TYPE_LABEL[a.type] ?? a.type}</td>
                        <td className="px-4 py-3">{a.reason}{a.status === 'rejected' && a.rejectReason && <p className="text-xs text-[var(--color-fg-quaternary)]">Rejected: {a.rejectReason}</p>}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{signed(a.amountTzs)}</td>
                        <td className="px-4 py-3"><Badge tone={ADJUSTMENT_STATUS[a.status].tone}>{ADJUSTMENT_STATUS[a.status].label}</Badge></td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {a.status === 'proposed' && canApprove && (
                            <span className="flex justify-end gap-2">
                              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsk({ kind: 'reject-adjustment', adjustment: a })}>Reject</Button>
                              <Button size="sm" disabled={busy || own || s.status !== 'draft'} title={own ? 'You proposed this adjustment, so someone else has to apply it' : undefined}
                                onClick={() => act(t => api.decideSettlementAdjustment(t, a.id, 'apply'), 'Adjustment applied.')} data-testid={`settlement-adjustment-apply-${a.id}`}>Apply</Button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {ask?.kind === 'confirm' && (
        <ConfirmDialog open tone="primary" busy={busy} title={ask.title} description={ask.description} confirmLabel={ask.label}
          onClose={() => setAsk(null)} onConfirm={() => step(ask.step, DONE[ask.step])} />
      )}
      {ask?.kind === 'reason' && (
        <ReasonDialog title={ask.title} description={ask.description} label={ask.label} busy={busy} onClose={() => setAsk(null)}
          onSubmit={reason => step(ask.step, DONE[ask.step], { reason })} />
      )}
      {ask?.kind === 'reject-adjustment' && (
        <ReasonDialog title="Reject adjustment" description={`${ADJUSTMENT_TYPE_LABEL[ask.adjustment.type]} of ${signed(ask.adjustment.amountTzs)}`} label="Reject" busy={busy} onClose={() => setAsk(null)}
          onSubmit={reason => act(t => api.decideSettlementAdjustment(t, ask.adjustment.id, 'reject', reason), 'Adjustment rejected.')} />
      )}
      {ask?.kind === 'pay' && (
        <PayDialog amount={money(s.finalNetTzs)} gym={s.gymName || 'this gym'} busy={busy} onClose={() => setAsk(null)}
          onSubmit={body => step('pay', DONE.pay, body)} />
      )}
      {ask?.kind === 'adjust' && (
        <AdjustDialog busy={busy} onClose={() => setAsk(null)}
          onSubmit={body => act(t => api.proposeSettlementAdjustment(t, s.id, body), 'Adjustment proposed. Someone else has to apply it.')} />
      )}
    </div>
  );
}

const DONE: Record<SettlementStep, string> = {
  submit: 'Submitted for approval.', reject: 'Sent back to draft.', approve: 'Approved.', hold: 'Put on hold.',
  release: 'Hold released.', payable: 'Cleared for payment.', pay: 'Payment recorded.', void: 'Statement voided.',
};

function ReasonDialog({ title, description, label, busy, onClose, onSubmit }: {
  title: string; description: string; label: string; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open onClose={onClose} title={title} description={description} size="sm">
      <Field label="Reason">
        <textarea className="ui-input min-h-24" value={reason} onChange={e => setReason(e.target.value)} data-testid="settlement-reason" />
      </Field>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => onSubmit(reason.trim())} disabled={busy || !reason.trim()} data-testid="settlement-reason-submit">{label}</Button>
      </DialogFooter>
    </Dialog>
  );
}

function PayDialog({ amount, gym, busy, onClose, onSubmit }: {
  amount: string; gym: string; busy: boolean; onClose: () => void; onSubmit: (body: { paymentReference: string; receiptUrl?: string }) => void;
}) {
  const [reference, setReference] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  return (
    <Dialog open onClose={onClose} title="Record payment" description={`Confirm that ${amount} was sent to ${gym}. A paid statement is final.`} size="sm">
      <div className="space-y-4">
        <Field label="Payment reference" hint="The bank or mobile money transaction reference.">
          <Input value={reference} onChange={e => setReference(e.target.value)} data-testid="settlement-pay-reference" />
        </Field>
        <Field label="Receipt link (optional)">
          <Input value={receiptUrl} onChange={e => setReceiptUrl(e.target.value)} placeholder="https://" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => onSubmit({ paymentReference: reference.trim(), ...(receiptUrl.trim() ? { receiptUrl: receiptUrl.trim() } : {}) })} disabled={busy || !reference.trim()} data-testid="settlement-pay-submit">Record payment</Button>
      </DialogFooter>
    </Dialog>
  );
}

function AdjustDialog({ busy, onClose, onSubmit }: {
  busy: boolean; onClose: () => void; onSubmit: (body: { amountTzs: number; type: 'correction' | 'clawback' | 'manual'; reason: string }) => void;
}) {
  const [type, setType] = useState<'correction' | 'clawback' | 'manual'>('correction');
  const [direction, setDirection] = useState<'add' | 'deduct'>('deduct');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const value = Number(amount);
  const valid = Number.isInteger(value) && value > 0 && !!reason.trim();
  const deduct = type === 'clawback' || direction === 'deduct';
  return (
    <Dialog open onClose={onClose} title="Add adjustment" description="Changes what the gym is paid on this statement. Someone else has to apply it before it counts." size="sm">
      <div className="space-y-4">
        <Field label="Type" hint={type === 'clawback' ? 'Takes back money already paid for a visit that was later voided.' : undefined}>
          <select className="ui-input" value={type} onChange={e => setType(e.target.value as typeof type)} data-testid="settlement-adjust-type">
            <option value="correction">Correction</option>
            <option value="clawback">Clawback</option>
            <option value="manual">Manual</option>
          </select>
        </Field>
        {type !== 'clawback' && (
          <Field label="Direction">
            <select className="ui-input" value={direction} onChange={e => setDirection(e.target.value as typeof direction)}>
              <option value="deduct">Take off the statement</option>
              <option value="add">Add to the statement</option>
            </select>
          </Field>
        )}
        <Field label="Amount (TZS)">
          <Input type="number" min={1} step={1} value={amount} onChange={e => setAmount(e.target.value)} data-testid="settlement-adjust-amount" />
        </Field>
        <Field label="Reason">
          <textarea className="ui-input min-h-20" value={reason} onChange={e => setReason(e.target.value)} data-testid="settlement-adjust-reason" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => onSubmit({ amountTzs: deduct ? -value : value, type, reason: reason.trim() })} disabled={busy || !valid} data-testid="settlement-adjust-submit">Propose</Button>
      </DialogFooter>
    </Dialog>
  );
}
