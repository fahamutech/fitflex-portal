'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Play, RefreshCw, Wallet } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, GymSettlementStatus, PartnerSettlement, PartnerSettlementAction, PartnerSettlementDetail, PartnerSettlementLine, PayoutKind } from '@/lib/api';
import { money, trainerNames } from '@/lib/admin-utils';
import { STATEMENT_STATUS, STATEMENT_TABS, shortDay } from '@/lib/settlements';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, Input, PageHeader, Spinner, Table, TBody, Td, Textarea, Th, THead, Tr } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';

/** What differs between a trainer's and a vendor's weekly statement. */
const KIND = {
  trainer: {
    title: 'Trainer payouts',
    description: 'What each trainer is owed for a week of sessions. A statement is prepared, approved by someone else, then paid to the trainer’s verified payout account.',
    who: 'trainer', column: 'Trainer', unnamed: 'Unnamed trainer',
    nameOf: (s: PartnerSettlement) => trainerNames(s.trainer).shown,
    ownNameOf: (s: PartnerSettlement) => trainerNames(s.trainer).own,
    labelOf: (s: PartnerSettlement) => trainerNames(s.trainer).label,
    countOf: (s: PartnerSettlement) => s.sessionCount ?? 0, countLabel: 'Sessions', unit: ['session', 'sessions'],
    grossOf: (s: PartnerSettlement) => s.listTzs ?? 0, grossLabel: 'At their price', grossCard: 'Sessions at the trainer’s price',
    netCard: 'To pay the trainer', linesTitle: 'Sessions',
    emptyAll: 'No statements yet. Prepare last week to create drafts for trainers with sessions to pay.',
    nothing: 'No sessions to pay',
    voidHint: 'This statement will not be paid. Its sessions go onto the next statement prepared.',
    noAccount: 'the trainer has no account',
  },
  vendor: {
    title: 'Vendor payouts',
    description: 'What each vendor is owed for a week of delivered orders, after FitFlex’s commission. A statement is prepared, approved by someone else, then paid to the vendor’s verified payout account.',
    who: 'vendor', column: 'Vendor', unnamed: 'Unnamed vendor',
    nameOf: (s: PartnerSettlement) => s.vendor?.businessName,
    ownNameOf: (_s: PartnerSettlement) => '',
    labelOf: (s: PartnerSettlement) => s.vendor?.businessName,
    countOf: (s: PartnerSettlement) => s.orderCount ?? 0, countLabel: 'Orders', unit: ['order', 'orders'],
    grossOf: (s: PartnerSettlement) => s.salesTzs ?? 0, grossLabel: 'Sales', grossCard: 'Sales of the vendor’s items',
    netCard: 'To pay the vendor', linesTitle: 'Delivered orders',
    emptyAll: 'No statements yet. Prepare last week to create drafts for vendors with delivered orders.',
    nothing: 'No delivered orders to pay',
    voidHint: 'This statement will not be paid. Its orders go onto the next statement prepared.',
    noAccount: 'the vendor has no account',
  },
} as const;

const ERRORS: Record<string, string> = {
  invalid_status: 'This statement has already moved on. Refresh to see where it stands.',
  reason_required: 'Write a reason.',
  cannot_approve_own_submission: 'You submitted this statement, so someone else has to approve it.',
  not_on_hold: 'This statement is not on hold.',
  on_hold: 'This statement is on hold. Release it first.',
  void_requested: 'A void has been requested for this statement. Confirm or cancel that first.',
  void_already_requested: 'A void has already been requested for this statement.',
  void_not_requested: 'Nobody has requested a void for this statement.',
  cannot_void_own_request: 'You asked for this void, so someone else has to confirm it.',
  nothing_to_pay: 'There is nothing to pay on this statement.',
  payment_reference_required: 'Enter the payment reference.',
  week_not_ended: 'That week has not ended yet.',
  period_must_start_on_monday: 'Choose a Monday.',
  acl_forbidden: 'You don’t have permission to do that.',
  forbidden: 'You don’t have permission to do that.',
};

function whyNot(kind: PayoutKind, reason?: string) {
  const known: Record<string, string> = {
    no_trainer_account: KIND.trainer.noAccount,
    no_vendor_account: KIND.vendor.noAccount,
    kyc_not_started: 'they have not started verification',
    payout_account_not_verified: 'they have no verified payout account',
    payout_account_cooling_off: 'their payout account was changed recently and is still in its waiting period',
  };
  return known[reason ?? ''] ?? (reason?.startsWith('kyc_') ? 'their verification is not approved' : 'they do not pass the payout check');
}

function errorText(kind: PayoutKind, err: unknown) {
  const body = (err as { body?: { error?: string; reason?: string } })?.body;
  if (body?.error === 'not_payable') return `This ${KIND[kind].who} can’t be paid yet: ${whyNot(kind, body.reason)}.`;
  return ERRORS[body?.error ?? ''] ?? 'Something went wrong.';
}

const week = (s: Pick<PartnerSettlement, 'periodStartDate' | 'periodEndDate'>) => `${shortDay(s.periodStartDate)} – ${shortDay(s.periodEndDate)}`;

/**
 * Weekly payout statements for trainers or vendors: by where they stand, and
 * one statement at a time (?statement=<id>) to check, approve and pay.
 */
export function PartnerPayouts({ kind }: { kind: PayoutKind }) {
  const k = KIND[kind];
  const { token, user, hasPermission } = useApp();
  const [rows, setRows] = useState<PartnerSettlement[] | null>(null);
  const [tab, setTab] = useState<GymSettlementStatus>('draft');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  // The open statement lives in the URL so it survives a refresh and can be shared.
  useEffect(() => {
    const sync = () => setOpenId(new URLSearchParams(window.location.search).get('statement'));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const open = (id: string | null) => {
    history.pushState(null, '', id ? `?statement=${encodeURIComponent(id)}` : window.location.pathname);
    setOpenId(id);
  };

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setRows((await api.partnerSettlements(token, kind)).statements);
    } catch (err) {
      setError(errorText(kind, err));
      setRows([]);
    }
  }, [token, kind]);
  useEffect(() => { load(); }, [load]);

  async function prepare() {
    if (!token) return;
    setPreparing(true);
    setNotice(null);
    setError(null);
    try {
      const r = await api.preparePartnerSettlements(token, kind);
      const made = r.prepared + r.rebuilt;
      const span = `${shortDay(r.periodStartDate)} – ${shortDay(r.periodEndDate)}`;
      setNotice(made ? `${made} draft ${made === 1 ? 'statement' : 'statements'} ready for ${span}.` : `${k.nothing} for ${span}.`);
      setTab('draft');
      await load();
    } catch (err) {
      setError(errorText(kind, err));
    } finally {
      setPreparing(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;
  if (openId) return <StatementView kind={kind} id={openId} onBack={() => { open(null); load(); }} />;

  const count = (s: GymSettlementStatus) => (rows ?? []).filter(r => r.status === s).length;
  const shown = (rows ?? []).filter(r => r.status === tab);
  const total = shown.reduce((sum, r) => sum + r.finalNetTzs, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={k.title}
        description={k.description}
        actions={<>
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>
          {hasPermission('settlements_prepare') && (
            <Button size="sm" onClick={prepare} disabled={preparing} data-testid={`${kind}-settlement-prepare`}>
              <Play className="h-4 w-4" />{preparing ? 'Preparing…' : 'Prepare last week'}
            </Button>
          )}
        </>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div role="tablist" className="flex w-fit flex-wrap gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1">
        {STATEMENT_TABS.map(s => (
          <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)} data-testid={`${kind}-settlement-tab-${s}`}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${tab === s ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
            {STATEMENT_STATUS[s].label}
            <span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 text-xs tabular-nums">{count(s)}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]">
              <Wallet className="h-6 w-6" />
              {rows.length === 0 ? k.emptyAll : `No ${STATEMENT_STATUS[tab].label.toLowerCase()} statements.`}
            </div>
          ) : (
            <Table aria-label={k.title} wrapperClassName="rounded-none border-0" className="min-w-[720px]" data-testid={`${kind}-settlement-table`}>
              <THead>
                <Tr>
                  <Th>{k.column}</Th>
                  <Th>Week</Th>
                  <Th className="!text-right">{k.countLabel}</Th>
                  <Th className="!text-right">{k.grossLabel}</Th>
                  <Th className="!text-right">Commission</Th>
                  <Th className="!text-right">To pay</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map(r => (
                  <Tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => open(r.id)} data-testid={`${kind}-settlement-row-${r.id}`}>
                    <Td>
                      <Button variant="link" className="h-auto px-0 text-left font-medium text-[var(--color-fg-primary)]" onClick={e => { e.stopPropagation(); open(r.id); }}>
                        {k.nameOf(r) || k.unnamed}
                      </Button>
                      {k.ownNameOf(r) && (
                        <div className="text-xs text-[var(--color-fg-quaternary)]" data-testid={`${kind}-settlement-own-name-${r.id}`}>{k.ownNameOf(r)}</div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{week(r)}</Td>
                    <Td className="text-right tabular-nums">{k.countOf(r)}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{money(k.grossOf(r))}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{money(r.commissionTzs)}</Td>
                    <Td className="whitespace-nowrap text-right font-medium tabular-nums">{money(r.finalNetTzs)}</Td>
                    <Td>
                      <Badge tone={STATEMENT_STATUS[r.status].tone}>{STATEMENT_STATUS[r.status].label}</Badge>
                      {r.holdReason && r.status !== 'voided' && <span className="ml-2"><Badge tone="danger">On hold</Badge></span>}
                      {r.voidRequestedBy && r.status !== 'voided' && <span className="ml-2"><Badge tone="warning">Void requested</Badge></span>}
                    </Td>
                  </Tr>
                ))}
              </TBody>
              <tfoot>
                <Tr className="border-t border-[var(--color-border-secondary)] text-sm [&>td]:!border-b-0">
                  <Td className="font-medium" colSpan={5}>{shown.length} {shown.length === 1 ? 'statement' : 'statements'}</Td>
                  <Td className="whitespace-nowrap text-right font-semibold tabular-nums" data-testid={`${kind}-settlement-total`}>{money(total)}</Td>
                  <Td />
                </Tr>
              </tfoot>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Lines({ kind, lines }: { kind: PayoutKind; lines: PartnerSettlementLine[] }) {
  const num = 'whitespace-nowrap text-right tabular-nums';
  const row = (l: PartnerSettlementLine) => (l.voided ? 'text-[var(--color-fg-quaternary)] line-through' : '');
  return (
    <Table aria-label={kind === 'trainer' ? 'Sessions' : 'Orders'} wrapperClassName="rounded-none border-0" className="min-w-[680px]">
      <THead>
        {kind === 'trainer' ? (
          <Tr>
            <Th>Date</Th><Th>Member</Th><Th>Why it is paid</Th>
            <Th className="!text-right">Price</Th><Th className="!text-right">Member paid</Th>
            <Th className="!text-right">Commission</Th><Th className="!text-right">Trainer</Th>
          </Tr>
        ) : (
          <Tr>
            <Th>Delivered</Th><Th>Order</Th><Th className="!text-right">Items</Th>
            <Th className="!text-right">Sales</Th><Th className="!text-right">Commission</Th><Th className="!text-right">Vendor</Th>
          </Tr>
        )}
      </THead>
      <TBody>
        {lines.map(l => kind === 'trainer' ? (
          <Tr key={l.id} className={row(l)}>
            <Td className="whitespace-nowrap">{shortDay(l.date)}{l.slot ? ` · ${l.slot}` : ''}</Td>
            <Td>{l.memberName || '—'}</Td>
            <Td>{l.basis === 'completed' ? 'Marked completed' : 'Took place (not cancelled)'}</Td>
            <Td className={num}>{money(l.listPriceTzs ?? 0)}</Td>
            <Td className={num}>{money(l.memberPaidTzs ?? 0)}</Td>
            <Td className={num}>{money(l.commissionTzs)}</Td>
            <Td className={`${num} font-medium`}>{money(l.payoutTzs)}</Td>
          </Tr>
        ) : (
          <Tr key={l.id} className={row(l)}>
            <Td className="whitespace-nowrap">{shortDay(l.deliveredOn)}</Td>
            <Td className="font-mono text-xs">{l.orderId}</Td>
            <Td className="text-right tabular-nums">{l.itemCount ?? 0}</Td>
            <Td className={num}>{money(l.salesTzs ?? 0)}</Td>
            <Td className={num}>{money(l.commissionTzs)}</Td>
            <Td className={`${num} font-medium`}>{money(l.payoutTzs)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

type Pending = { action: PartnerSettlementAction; title: string; confirm: string; needs?: 'reason' | 'reference'; hint?: string };

function StatementView({ kind, id, onBack }: { kind: PayoutKind; id: string; onBack: () => void }) {
  const k = KIND[kind];
  const { token, user, hasPermission } = useApp();
  const [data, setData] = useState<PartnerSettlementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await api.partnerSettlement(token, kind, id));
      setError(null);
    } catch (err) {
      setError(errorText(kind, err));
    }
  }, [token, kind, id]);
  useEffect(() => { load(); }, [load]);

  const start = (p: Pending) => { setPending(p); setInput(''); setActionError(null); };

  async function run() {
    if (!token || !pending) return;
    setBusy(true);
    try {
      await api.partnerSettlementAction(token, kind, id, pending.action,
        pending.needs === 'reason' ? { reason: input.trim() } : pending.needs === 'reference' ? { paymentReference: input.trim() } : {});
      setPending(null);
      await load();
    } catch (err) {
      setActionError(errorText(kind, err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <div className="space-y-4"><Button variant="secondary" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />Back</Button><Alert tone="error">{error}</Alert></div>;
  if (!data) return <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>;

  const s = data.statement;
  const n = k.countOf(s);
  const canPrepare = hasPermission('settlements_prepare');
  const canApprove = hasPermission('settlements_approve');
  const canPay = hasPermission('settlements_pay');
  const mine = s.submittedBy === user?.id;
  const dest = s.destinationSnapshot ?? data.payout.destination ?? null;
  // A void has been asked for and waits for a second person.
  const voidAsked = !!s.voidRequestedBy && s.status !== 'voided';
  const ownVoidRequest = voidAsked && s.voidRequestedBy === user?.id;
  const voidable = ['draft', 'submitted', 'approved'].includes(s.status);

  const actions: Array<Pending & { show: boolean; primary?: boolean }> = [
    { show: s.status === 'draft' && canPrepare && !voidAsked, primary: true, action: 'submit', title: 'Send for approval', confirm: 'Send for approval', hint: 'The amounts are frozen. Someone else has to approve it.' },
    { show: s.status === 'submitted' && canApprove && !mine && !voidAsked, primary: true, action: 'approve', title: 'Approve statement', confirm: 'Approve' },
    { show: s.status === 'submitted' && canApprove, action: 'reject', title: 'Send back to draft', confirm: 'Send back', needs: 'reason' },
    { show: s.status === 'approved' && canPay && !s.holdReason && !voidAsked, primary: true, action: 'payable', title: 'Clear for payment', confirm: 'Clear for payment', hint: `Checks the ${k.who}’s verification and payout account.` },
    { show: s.status === 'payable' && canPay, primary: true, action: 'pay', title: 'Record payment', confirm: 'Mark as paid', needs: 'reference', hint: 'Enter the mobile-money or bank reference of the payment you sent.' },
    { show: !!s.holdReason && canApprove && s.status !== 'voided', action: 'release', title: 'Release hold', confirm: 'Release' },
    { show: !s.holdReason && ['draft', 'submitted', 'approved', 'payable'].includes(s.status) && canPrepare, action: 'hold', title: 'Put on hold', confirm: 'Hold', needs: 'reason' },
    // Voiding takes two people: one asks with a reason, a different one confirms.
    { show: voidable && !voidAsked && (canPrepare || canApprove), action: 'void-request', title: 'Request void', confirm: 'Request void', needs: 'reason', hint: `${k.voidHint} A second person has to confirm before anything is voided.` },
    { show: voidAsked && canApprove && !ownVoidRequest, action: 'void', title: 'Confirm void', confirm: 'Void statement', hint: k.voidHint },
    { show: voidAsked && (canPrepare || canApprove), action: 'void-request/cancel', title: 'Cancel void request', confirm: 'Cancel request', hint: 'The statement carries on from where it was.' },
  ];

  return (
    <div className="space-y-6">
      <Button variant="secondary" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />All {k.title.toLowerCase()}</Button>
      <PageHeader
        title={k.labelOf(s) || k.unnamed}
        description={`${week(s)} · ${n} ${n === 1 ? k.unit[0] : k.unit[1]}`}
        actions={<Badge tone={STATEMENT_STATUS[s.status].tone}>{STATEMENT_STATUS[s.status].label}</Badge>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {s.holdReason && s.status !== 'voided' && <Alert tone="warning">On hold: {s.holdReason}</Alert>}
      {s.status === 'draft' && s.rejectReason && <Alert tone="warning">Sent back: {s.rejectReason}</Alert>}
      {s.status === 'voided' && <Alert tone="error">Voided: {s.voidReason}</Alert>}
      {voidAsked && (
        <Alert tone="warning">
          <span data-testid={`${kind}-settlement-void-requested`}>Void requested{s.voidRequestedAt ? ` on ${shortDay(s.voidRequestedAt)}` : ''}: {s.voidRequestReason}. {ownVoidRequest ? 'You asked for it, so someone else has to confirm it.' : 'A second person has to confirm it.'} Until then it can’t be sent for approval, approved or paid.</span>
        </Alert>
      )}
      {s.status === 'submitted' && mine && <Alert tone="info">You submitted this statement, so someone else has to approve it.</Alert>}
      {!data.payout.ok && !['paid', 'voided'].includes(s.status) && (
        <Alert tone="warning"><span data-testid={`${kind}-settlement-not-payable`}>This {k.who} can’t be paid yet: {whyNot(kind, data.payout.reason)}.</span></Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{k.grossCard}</p><p className="text-lg font-semibold tabular-nums">{money(k.grossOf(s))}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">FitFlex commission</p><p className="text-lg font-semibold tabular-nums">{money(s.commissionTzs)}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{k.netCard}</p><p className="text-lg font-semibold tabular-nums" data-testid={`${kind}-settlement-net`}>{money(s.finalNetTzs)}</p></CardContent></Card>
      </div>

      {(dest || s.paymentReference) && (
        <Card>
          <CardContent>
            <p className="text-sm">
              {dest && <>Payout account: <span className="font-medium">{[dest.provider, dest.accountName].filter(Boolean).join(' · ')}{dest.accountLast4 ? ` ····${dest.accountLast4}` : ''}</span></>}
              {s.paymentReference && <> · Paid {shortDay(s.paidAt)} · Reference <span className="font-mono">{s.paymentReference}</span></>}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {actions.filter(a => a.show).map(a => (
          <Button key={a.action} size="sm" variant={a.primary ? 'primary' : 'secondary'} onClick={() => start(a)} data-testid={`${kind}-settlement-${a.action.replace('/', '-')}`}>{a.title}</Button>
        ))}
      </div>

      <Card>
        <CardHeader><h2 className="font-semibold">{k.linesTitle}</h2></CardHeader>
        <CardContent className="p-0"><Lines kind={kind} lines={data.lines} /></CardContent>
      </Card>

      <Dialog open={!!pending} onClose={() => setPending(null)} title={pending?.title ?? ''} description={`${k.labelOf(s) || k.unnamed} · ${week(s)} · ${money(s.finalNetTzs)}`} size="sm">
        <div className="space-y-4">
          {actionError && <Alert tone="error">{actionError}</Alert>}
          {pending?.hint && <p className="text-sm text-[var(--color-fg-tertiary)]">{pending.hint}</p>}
          {pending?.needs === 'reason' && (
            <Field label="Reason"><Textarea className="min-h-[80px]" value={input} onChange={e => setInput(e.target.value)} data-testid={`${kind}-settlement-input`} /></Field>
          )}
          {pending?.needs === 'reference' && (
            <Field label="Payment reference"><Input value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. MPESA QX12AB34" data-testid={`${kind}-settlement-input`} /></Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={run} disabled={busy || (!!pending?.needs && !input.trim())} data-testid={`${kind}-settlement-confirm`}>{busy ? 'Saving…' : pending?.confirm}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
