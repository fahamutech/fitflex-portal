'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, RefreshCw, Wallet } from 'lucide-react';
import { useApp } from '../../app/providers';
import {
  api, GymSettlementStatus, PartnerSettlement, PartnerSettlementAction, PartnerSettlementDetail, PartnerSettlementLine, PayoutKind,
  type VendorStatement, type VendorStatementList,
} from '@/lib/api';
import { money, trainerNames } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { STATEMENT_STATUS, STATEMENT_TABS, shortDay } from '@/lib/settlements';
import { eatDay, errorCode, fmt, payoutWhyKey, shortRefOf } from '@/lib/vendor';
import { Alert, Badge, Button, Card, CardContent, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, SkeletonTable, Spinner, Table, TBody, Td, Textarea, Th, THead, Tr } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from './vendor-context';

type T = (key: MessageKey) => string;

/** What differs between a trainer's and a vendor's weekly statement (labels are i18n keys). */
const KIND = {
  trainer: {
    nameOf: (s: PartnerSettlement) => trainerNames(s.trainer).shown,
    ownNameOf: (s: PartnerSettlement) => trainerNames(s.trainer).own,
    labelOf: (s: PartnerSettlement) => trainerNames(s.trainer).label,
    countOf: (s: PartnerSettlement) => s.sessionCount ?? 0,
    grossOf: (s: PartnerSettlement) => s.listTzs ?? 0,
  },
  vendor: {
    nameOf: (s: PartnerSettlement) => s.vendor?.businessName,
    ownNameOf: (_s: PartnerSettlement) => '',
    labelOf: (s: PartnerSettlement) => s.vendor?.businessName,
    countOf: (s: PartnerSettlement) => s.orderCount ?? 0,
    grossOf: (s: PartnerSettlement) => s.salesTzs ?? 0,
  },
} as const;
const k = (kind: PayoutKind, key: string) => `payouts.${kind}.${key}` as MessageKey;

const ERRORS = new Set([
  'invalid_status', 'reason_required', 'cannot_approve_own_submission', 'not_on_hold', 'on_hold', 'void_requested',
  'void_already_requested', 'void_not_requested', 'cannot_void_own_request', 'nothing_to_pay', 'payment_reference_required',
  'week_not_ended', 'period_must_start_on_monday',
]);

/** Why FitFlex can't pay this trainer or vendor (staff voice: "they…"). */
function whyNot(t: T, reason?: string) {
  if (reason === 'no_trainer_account' || reason === 'no_vendor_account' || reason === 'kyc_not_started'
    || reason === 'payout_account_not_verified' || reason === 'payout_account_cooling_off') return t(`payouts.why.${reason}` as MessageKey);
  return t(reason?.startsWith('kyc_') ? 'payouts.why.kyc_other' : 'payouts.why.other');
}

function errorText(t: T, kind: PayoutKind, err: unknown) {
  const body = (err as { body?: { error?: string; reason?: string } })?.body;
  if (body?.error === 'not_payable') return fmt(t(k(kind, 'notPayable')), { reason: whyNot(t, body.reason) });
  if (body?.error === 'acl_forbidden' || body?.error === 'forbidden') return t('payouts.err.forbidden');
  return body?.error && ERRORS.has(body.error) ? t(`payouts.err.${body.error}` as MessageKey) : t('payouts.err.generic');
}

const week = (s: Pick<PartnerSettlement, 'periodStartDate' | 'periodEndDate'>) => `${shortDay(s.periodStartDate)} – ${shortDay(s.periodEndDate)}`;
const statusLabel = (t: T, s: GymSettlementStatus) => t(`payouts.status.${s}` as MessageKey);

/** The open statement lives in the URL so it survives a refresh and can be shared. */
function useOpenStatement(param: string) {
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setOpenId(new URLSearchParams(window.location.search).get(param));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [param]);
  const open = (id: string | null) => {
    history.pushState(null, '', id ? `?${param}=${encodeURIComponent(id)}` : window.location.pathname);
    setOpenId(id);
  };
  return [openId, open] as const;
}

/**
 * Weekly payout statements for trainers or vendors.
 * - audience 'admin' (default): FitFlex staff, by where they stand, one at a time (?statement=<id>) to check, approve and pay.
 * - audience 'partner': a vendor's own statements (?id=<id>), read-only; no workflow action exists.
 */
export function PartnerPayouts({ kind, audience = 'admin' }: { kind: PayoutKind; audience?: 'admin' | 'partner' }) {
  if (audience === 'partner') return <PartnerOwnPayouts />;
  return <AdminPayouts kind={kind} />;
}

function AdminPayouts({ kind }: { kind: PayoutKind }) {
  const K = KIND[kind];
  const { token, user, hasPermission, t } = useApp();
  const [rows, setRows] = useState<PartnerSettlement[] | null>(null);
  const [tab, setTab] = useState<GymSettlementStatus>('draft');
  const [openId, open] = useOpenStatement('statement');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setRows((await api.partnerSettlements(token, kind)).statements);
    } catch (err) {
      setError(errorText(t, kind, err));
      setRows([]);
    }
  }, [token, kind, t]);
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
      setNotice(made ? fmt(t(made === 1 ? 'payouts.preparedOne' : 'payouts.preparedMany'), { n: made, span }) : fmt(t('payouts.nothingFor'), { nothing: t(k(kind, 'nothing')), span }));
      setTab('draft');
      await load();
    } catch (err) {
      setError(errorText(t, kind, err));
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
        title={t(k(kind, 'title'))}
        description={t(k(kind, 'description'))}
        actions={<>
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />{t('payouts.refresh')}</Button>
          {hasPermission('settlements_prepare') && (
            <Button size="sm" onClick={prepare} disabled={preparing} data-testid={`${kind}-settlement-prepare`}>
              <Play className="h-4 w-4" />{preparing ? t('payouts.preparing') : t('payouts.prepare')}
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
            {statusLabel(t, s)}
            <span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 text-xs tabular-nums">{count(s)}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]">
              <Wallet className="h-6 w-6" />
              {rows.length === 0 ? t(k(kind, 'emptyAll')) : fmt(t('payouts.noneInTab'), { status: statusLabel(t, tab).toLowerCase() })}
            </div>
          ) : (
            <Table aria-label={t(k(kind, 'title'))} wrapperClassName="rounded-none border-0" className="min-w-[720px]" data-testid={`${kind}-settlement-table`}>
              <THead>
                <Tr>
                  <Th>{t(k(kind, 'column'))}</Th>
                  <Th>{t('payouts.week')}</Th>
                  <Th className="!text-right">{t(k(kind, 'countLabel'))}</Th>
                  <Th className="!text-right">{t(k(kind, 'grossLabel'))}</Th>
                  <Th className="!text-right">{t('payouts.commission')}</Th>
                  <Th className="!text-right">{t('payouts.toPay')}</Th>
                  <Th>{t('payouts.status')}</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map(r => (
                  <Tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => open(r.id)} data-testid={`${kind}-settlement-row-${r.id}`}>
                    <Td>
                      <Button variant="link" className="h-auto px-0 text-left font-medium text-[var(--color-fg-primary)]" onClick={e => { e.stopPropagation(); open(r.id); }}>
                        {K.nameOf(r) || t(k(kind, 'unnamed'))}
                      </Button>
                      {K.ownNameOf(r) && (
                        <div className="text-xs text-[var(--color-fg-quaternary)]" data-testid={`${kind}-settlement-own-name-${r.id}`}>{K.ownNameOf(r)}</div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{week(r)}</Td>
                    <Td className="text-right tabular-nums">{K.countOf(r)}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{money(K.grossOf(r))}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{money(r.commissionTzs)}</Td>
                    <Td className="whitespace-nowrap text-right font-medium tabular-nums">{money(r.finalNetTzs)}</Td>
                    <Td>
                      <Badge tone={STATEMENT_STATUS[r.status].tone}>{statusLabel(t, r.status)}</Badge>
                      {r.holdReason && r.status !== 'voided' && <span className="ml-2"><Badge tone="danger">{t('payouts.onHold')}</Badge></span>}
                      {r.voidRequestedBy && r.status !== 'voided' && <span className="ml-2"><Badge tone="warning">{t('payouts.voidRequestedBadge')}</Badge></span>}
                    </Td>
                  </Tr>
                ))}
              </TBody>
              <tfoot>
                <Tr className="border-t border-[var(--color-border-secondary)] text-sm [&>td]:!border-b-0">
                  <Td className="font-medium" colSpan={5}>{fmt(t(shown.length === 1 ? 'payouts.countOne' : 'payouts.countMany'), { n: shown.length })}</Td>
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
  const { t } = useApp();
  const num = 'whitespace-nowrap text-right tabular-nums';
  const row = (l: PartnerSettlementLine) => (l.voided ? 'text-[var(--color-fg-quaternary)] line-through' : '');
  return (
    <Table aria-label={kind === 'trainer' ? t('payouts.lines.sessions') : t('payouts.lines.orders')} wrapperClassName="rounded-none border-0" className="min-w-[680px]">
      <THead>
        {kind === 'trainer' ? (
          <Tr>
            <Th>{t('payouts.lines.date')}</Th><Th>{t('payouts.lines.member')}</Th><Th>{t('payouts.lines.why')}</Th>
            <Th className="!text-right">{t('payouts.lines.price')}</Th><Th className="!text-right">{t('payouts.lines.memberPaid')}</Th>
            <Th className="!text-right">{t('payouts.commission')}</Th><Th className="!text-right">{t('payouts.lines.trainer')}</Th>
          </Tr>
        ) : (
          <Tr>
            <Th>{t('payouts.lines.delivered')}</Th><Th>{t('payouts.lines.order')}</Th><Th className="!text-right">{t('payouts.lines.items')}</Th>
            <Th className="!text-right">{t('payouts.lines.sales')}</Th><Th className="!text-right">{t('payouts.commission')}</Th><Th className="!text-right">{t('payouts.lines.vendor')}</Th>
          </Tr>
        )}
      </THead>
      <TBody>
        {lines.map(l => kind === 'trainer' ? (
          <Tr key={l.id} className={row(l)}>
            <Td className="whitespace-nowrap">{shortDay(l.date)}{l.slot ? ` · ${l.slot}` : ''}</Td>
            <Td>{l.memberName || '—'}</Td>
            <Td>{l.basis === 'completed' ? t('payouts.lines.completed') : t('payouts.lines.tookPlace')}</Td>
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
  const K = KIND[kind];
  const { token, user, hasPermission, t } = useApp();
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
      setError(errorText(t, kind, err));
    }
  }, [token, kind, id, t]);
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
      setActionError(errorText(t, kind, err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <div className="space-y-4"><Button variant="secondary" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />{t('payouts.back')}</Button><Alert tone="error">{error}</Alert></div>;
  if (!data) return <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>;

  const s = data.statement;
  const n = K.countOf(s);
  const canPrepare = hasPermission('settlements_prepare');
  const canApprove = hasPermission('settlements_approve');
  const canPay = hasPermission('settlements_pay');
  const mine = s.submittedBy === user?.id;
  const dest = s.destinationSnapshot ?? data.payout.destination ?? null;
  // A void has been asked for and waits for a second person.
  const voidAsked = !!s.voidRequestedBy && s.status !== 'voided';
  const ownVoidRequest = voidAsked && s.voidRequestedBy === user?.id;
  const voidable = ['draft', 'submitted', 'approved'].includes(s.status);
  const voidHint = t(k(kind, 'voidHint'));
  const label = K.labelOf(s) || t(k(kind, 'unnamed'));

  const actions: Array<Pending & { show: boolean; primary?: boolean }> = [
    { show: s.status === 'draft' && canPrepare && !voidAsked, primary: true, action: 'submit', title: t('payouts.action.submit'), confirm: t('payouts.action.submit'), hint: t('payouts.action.submitHint') },
    { show: s.status === 'submitted' && canApprove && !mine && !voidAsked, primary: true, action: 'approve', title: t('payouts.action.approveTitle'), confirm: t('payouts.action.approve') },
    { show: s.status === 'submitted' && canApprove, action: 'reject', title: t('payouts.action.rejectTitle'), confirm: t('payouts.action.reject'), needs: 'reason' },
    { show: s.status === 'approved' && canPay && !s.holdReason && !voidAsked, primary: true, action: 'payable', title: t('payouts.action.payable'), confirm: t('payouts.action.payable'), hint: t(k(kind, 'payableHint')) },
    { show: s.status === 'payable' && canPay, primary: true, action: 'pay', title: t('payouts.action.payTitle'), confirm: t('payouts.action.pay'), needs: 'reference', hint: t('payouts.action.payHint') },
    { show: !!s.holdReason && canApprove && s.status !== 'voided', action: 'release', title: t('payouts.action.releaseTitle'), confirm: t('payouts.action.release') },
    { show: !s.holdReason && ['draft', 'submitted', 'approved', 'payable'].includes(s.status) && canPrepare, action: 'hold', title: t('payouts.action.holdTitle'), confirm: t('payouts.action.hold'), needs: 'reason' },
    // Voiding takes two people: one asks with a reason, a different one confirms.
    { show: voidable && !voidAsked && (canPrepare || canApprove), action: 'void-request', title: t('payouts.action.voidRequest'), confirm: t('payouts.action.voidRequest'), needs: 'reason', hint: `${voidHint} ${t('payouts.action.voidRequestHint')}` },
    { show: voidAsked && canApprove && !ownVoidRequest, action: 'void', title: t('payouts.action.voidTitle'), confirm: t('payouts.action.void'), hint: voidHint },
    { show: voidAsked && (canPrepare || canApprove), action: 'void-request/cancel', title: t('payouts.action.cancelVoidTitle'), confirm: t('payouts.action.cancelVoid'), hint: t('payouts.action.cancelVoidHint') },
  ];

  return (
    <div className="space-y-6">
      <Button variant="secondary" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />{t('payouts.allStatements')}</Button>
      <PageHeader
        title={label}
        description={`${week(s)} · ${n} ${n === 1 ? t(k(kind, 'unitOne')) : t(k(kind, 'unitMany'))}`}
        actions={<Badge tone={STATEMENT_STATUS[s.status].tone}>{statusLabel(t, s.status)}</Badge>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {s.holdReason && s.status !== 'voided' && <Alert tone="warning">{fmt(t('payouts.heldReason'), { reason: s.holdReason })}</Alert>}
      {s.status === 'draft' && s.rejectReason && <Alert tone="warning">{fmt(t('payouts.sentBack'), { reason: s.rejectReason })}</Alert>}
      {s.status === 'voided' && <Alert tone="error">{fmt(t('payouts.voidedReason'), { reason: s.voidReason ?? '' })}</Alert>}
      {voidAsked && (
        <Alert tone="warning">
          <span data-testid={`${kind}-settlement-void-requested`}>
            {s.voidRequestedAt ? fmt(t('payouts.voidRequestedOn'), { date: shortDay(s.voidRequestedAt), reason: s.voidRequestReason ?? '' }) : fmt(t('payouts.voidRequested'), { reason: s.voidRequestReason ?? '' })}
            {' '}{ownVoidRequest ? t('payouts.voidOwn') : t('payouts.voidSecond')} {t('payouts.voidUntil')}
          </span>
        </Alert>
      )}
      {s.status === 'submitted' && mine && <Alert tone="info">{t('payouts.submittedByYou')}</Alert>}
      {!data.payout.ok && !['paid', 'voided'].includes(s.status) && (
        <Alert tone="warning"><span data-testid={`${kind}-settlement-not-payable`}>{fmt(t(k(kind, 'notPayable')), { reason: whyNot(t, data.payout.reason) })}</span></Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{t(k(kind, 'grossCard'))}</p><p className="text-lg font-semibold tabular-nums">{money(K.grossOf(s))}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{t('payouts.fitflexCommission')}</p><p className="text-lg font-semibold tabular-nums">{money(s.commissionTzs)}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{t(k(kind, 'netCard'))}</p><p className="text-lg font-semibold tabular-nums" data-testid={`${kind}-settlement-net`}>{money(s.finalNetTzs)}</p></CardContent></Card>
      </div>

      {(dest || s.paymentReference) && (
        <Card>
          <CardContent>
            <p className="text-sm">
              {dest && <>{t('payouts.payoutAccount')} <span className="font-medium">{[dest.provider, dest.accountName].filter(Boolean).join(' · ')}{dest.accountLast4 ? ` ····${dest.accountLast4}` : ''}</span></>}
              {s.paymentReference && <> · {fmt(t('payouts.paidRef'), { date: shortDay(s.paidAt) })} <span className="font-mono">{s.paymentReference}</span></>}
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
        <CardHeader><h2 className="font-semibold">{t(k(kind, 'linesTitle'))}</h2></CardHeader>
        <CardContent className="p-0"><Lines kind={kind} lines={data.lines} /></CardContent>
      </Card>

      <Dialog open={!!pending} onClose={() => setPending(null)} title={pending?.title ?? ''} description={`${label} · ${week(s)} · ${money(s.finalNetTzs)}`} size="sm">
        <div className="space-y-4">
          {actionError && <Alert tone="error">{actionError}</Alert>}
          {pending?.hint && <p className="text-sm text-[var(--color-fg-tertiary)]">{pending.hint}</p>}
          {pending?.needs === 'reason' && (
            <Field label={t('payouts.reason')}><Textarea className="min-h-[80px]" value={input} onChange={e => setInput(e.target.value)} data-testid={`${kind}-settlement-input`} /></Field>
          )}
          {pending?.needs === 'reference' && (
            <Field label={t('payouts.paymentReference')}><Input value={input} onChange={e => setInput(e.target.value)} placeholder={t('payouts.paymentReferencePlaceholder')} data-testid={`${kind}-settlement-input`} /></Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setPending(null)} disabled={busy}>{t('payouts.cancel')}</Button>
          <Button variant="primary" size="md" onClick={run} disabled={busy || (!!pending?.needs && !input.trim())} data-testid={`${kind}-settlement-confirm`}>{busy ? t('payouts.saving') : pending?.confirm}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

// ── Partner mode: a vendor's own statements (read-only) ──

const PARTNER_TONE: Record<string, 'warning' | 'brand' | 'success' | 'gray'> = { submitted: 'warning', approved: 'brand', payable: 'warning', paid: 'success' };
const partnerStatusKey = (status: string) =>
  (['submitted', 'approved', 'payable', 'paid'].includes(status) ? `vendor.payouts.status.${status}` : 'vendor.payouts.status.submitted') as MessageKey;

function PartnerOwnPayouts() {
  const { token, t } = useApp();
  const vendor = useVendor();
  const [list, setList] = useState<VendorStatementList | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, open] = useOpenStatement('id');

  const load = useCallback(async () => {
    if (!token) return;
    setFailed(false);
    try { setList(await api.vendorStatements(token)); }
    catch (err) { if (!vendor.handleError(err)) setFailed(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const blocked = list && list.payoutReady === false ? (
    <Alert tone="warning">
      <span data-testid="vendor-payout-blocked">{fmt(t('vendor.payouts.blocked'), { reason: t(payoutWhyKey(list.payoutBlockedBy)) })}</span>
      <span className="mt-1 block font-normal">{t('vendor.payouts.fixInApp')}</span>
    </Alert>
  ) : null;

  if (openId) return <PartnerStatementView id={openId} onBack={() => open(null)} blocked={blocked} />;
  const rows = list?.statements ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('vendor.payouts.title')}
        description={t('vendor.payouts.description')}
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('admin.action.refresh')}</Button>}
      />
      {blocked}
      {list == null && !failed ? <div aria-busy="true"><SkeletonTable rows={4} columns={6} /></div>
        : failed ? <ErrorState title={t('vendor.payouts.failed')} onRetry={load} retryLabel={t('common.tryAgain')} />
        : rows.length === 0 ? <EmptyState icon={<Wallet />} title={t('vendor.payouts.empty')} body={t('vendor.payouts.emptyHint')} />
        : (
          <>
            <div className="hidden md:block">
              <Table aria-label={t('vendor.payouts.title')} data-testid="vendor-payouts-table">
                <THead>
                  <Tr>
                    <Th>{t('vendor.payouts.week')}</Th>
                    <Th className="!text-right">{t('vendor.payouts.orders')}</Th>
                    <Th className="!text-right">{t('vendor.payouts.sales')}</Th>
                    <Th className="!text-right">{t('vendor.payouts.commission')}</Th>
                    <Th className="!text-right">{t('vendor.payouts.toPay')}</Th>
                    <Th>{t('vendor.products.colStatus')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {rows.map(r => (
                    <Tr key={r.id} data-testid={`vendor-payout-row-${r.id}`}>
                      <Td>
                        <Button variant="link" className="h-auto min-h-11 px-0 font-medium" onClick={() => open(r.id)}>{week(r)}</Button>
                      </Td>
                      <Td className="text-right tabular-nums">{r.orderCount ?? 0}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">{money(r.salesTzs ?? 0)}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">{money(r.commissionTzs)}</Td>
                      <Td className="whitespace-nowrap text-right font-medium tabular-nums">{money(r.finalNetTzs)}</Td>
                      <Td>
                        <Badge tone={PARTNER_TONE[r.status] ?? 'gray'}>{t(partnerStatusKey(r.status))}</Badge>
                        {(r.onHold || r.holdReason) && <span className="ml-2"><Badge tone="danger">{t('vendor.payouts.onHold')}</Badge></span>}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="space-y-3 md:hidden" aria-label={t('vendor.payouts.title')}>
              {rows.map(r => (
                <li key={r.id}>
                  <Card className="p-0">
                    <button type="button" onClick={() => open(r.id)} className="block w-full space-y-1 p-4 text-left">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{week(r)}</span>
                        <Badge tone={PARTNER_TONE[r.status] ?? 'gray'}>{t(partnerStatusKey(r.status))}</Badge>
                      </span>
                      <span className="block text-sm text-[var(--color-fg-tertiary)]">{t('vendor.payouts.toPay')}: <span className="font-semibold tabular-nums text-[var(--color-fg-primary)]">{money(r.finalNetTzs)}</span></span>
                      <span className="block text-xs text-[var(--color-fg-tertiary)]">{t('vendor.payouts.orders')} {r.orderCount ?? 0} · {t('vendor.payouts.sales')} {money(r.salesTzs ?? 0)}</span>
                      {(r.onHold || r.holdReason) && <Badge tone="danger">{t('vendor.payouts.onHold')}</Badge>}
                    </button>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
    </div>
  );
}

function PartnerStatementView({ id, onBack, blocked }: { id: string; onBack: () => void; blocked: React.ReactNode }) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [data, setData] = useState<{ statement: VendorStatement; lines: PartnerSettlementLine[] } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notFound' | 'failed'>('loading');

  const load = useCallback(async () => {
    if (!token) return;
    setState('loading');
    try { setData(await api.vendorStatement(token, id)); setState('ready'); }
    catch (err) {
      if (vendor.handleError(err)) return;
      setState(errorCode(err) === 'statement_not_found' ? 'notFound' : 'failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);
  useEffect(() => { void load(); }, [load]);

  const back = <Button variant="link" className="min-h-11 h-auto px-0 text-sm font-semibold" onClick={onBack}><ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.payouts.back')}</Button>;
  if (state === 'loading') return <div className="space-y-4" aria-busy="true">{back}<SkeletonTable rows={3} columns={5} /></div>;
  if (state === 'notFound') return <div className="space-y-4">{back}<ErrorState title={t('vendor.payouts.notFound')} /></div>;
  if (state === 'failed' || !data) return <div className="space-y-4">{back}<ErrorState title={t('vendor.payouts.failed')} onRetry={load} retryLabel={t('common.tryAgain')} /></div>;

  const s = data.statement;
  const canOrders = vendor.can('orders');
  const onHold = s.onHold || !!s.holdReason;
  return (
    <div className="space-y-5" data-testid="vendor-payout-detail">
      {back}
      <PageHeader title={week(s)} actions={<Badge tone={PARTNER_TONE[s.status] ?? 'gray'}>{t(partnerStatusKey(s.status))}</Badge>} />
      {s.status !== 'paid' && blocked}
      {onHold && <Alert tone="warning">{t('vendor.payouts.onHoldHint')}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.payouts.sales')}</p><p className="text-lg font-semibold tabular-nums">{money(s.salesTzs ?? 0)}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.payouts.commission')}</p><p className="text-lg font-semibold tabular-nums">{money(s.commissionTzs)}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-[var(--color-fg-tertiary)]">{t('vendor.payouts.toPay')}</p><p className="text-lg font-semibold tabular-nums" data-testid="vendor-payout-net">{money(s.finalNetTzs)}</p></CardContent></Card>
      </div>
      {s.status === 'paid' && (
        <Card>
          <CardContent className="space-y-1 text-sm">
            <p>{fmt(t('vendor.payouts.paidOn'), { date: eatDay(s.paidAt, locale) })}</p>
            {s.paymentReference && <p>{t('vendor.payouts.reference')}: <span className="font-mono">{s.paymentReference}</span></p>}
            {s.paidTo && (
              <p>{t('vendor.payouts.paidTo')}: {[s.paidTo.provider ?? s.paidTo.method, s.paidTo.accountLast4 ? `····${s.paidTo.accountLast4}` : null].filter(Boolean).join(' ')}</p>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><h2 className="font-semibold">{t('vendor.payouts.ordersTitle')}</h2></CardHeader>
        <CardContent className="p-0">
          <Table aria-label={t('vendor.payouts.ordersTitle')} wrapperClassName="rounded-none border-0">
            <THead>
              <Tr>
                <Th>{t('vendor.orders.colRef')}</Th>
                <Th>{t('vendor.payouts.delivered')}</Th>
                <Th className="!text-right">{t('vendor.payouts.sales')}</Th>
                <Th className="!text-right">{t('vendor.payouts.commission')}</Th>
                <Th className="!text-right">{t('vendor.payouts.youReceive')}</Th>
              </Tr>
            </THead>
            <TBody>
              {data.lines.map(l => (
                <Tr key={l.id}>
                  <Td className="font-mono">
                    {canOrders && l.orderId
                      ? <Link href={`/vendor/orders/?id=${encodeURIComponent(l.orderId)}`} className="font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline">{shortRefOf(l.orderId)}</Link>
                      : shortRefOf(l.orderId)}
                  </Td>
                  <Td className="whitespace-nowrap">{eatDay(l.deliveredOn, locale)}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{money(l.salesTzs ?? 0)}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{money(l.commissionTzs)}</Td>
                  <Td className="whitespace-nowrap text-right font-medium tabular-nums">{money(l.payoutTzs)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
