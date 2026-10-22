'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { eatDateTime, errorBody, errorCode, fmt, receiptDay } from '@/lib/vendor';
import { actorId, actorName, adminTaxApi, eatTomorrow, type TaxActor, type TaxCode, type TaxRate, type TaxRatesPage, type TaxRateStatus } from '@/lib/vendor-documents';
import {
  Alert, Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonTable, Table, TBody, Td, Textarea, Th, THead, Tr, useToast,
} from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { forgetTaxRatesAvailability } from '@/components/tax-rates-gate';
import { useApp } from '../../providers';

const ORDER: TaxRateStatus[] = ['active', 'scheduled', 'pending', 'rejected', 'withdrawn', 'ended'];
const TONE: Record<TaxRateStatus, 'success' | 'info' | 'warning' | 'gray'> = {
  active: 'success', scheduled: 'info', pending: 'warning', rejected: 'gray', withdrawn: 'gray', ended: 'gray',
};
const REASON_MIN = 3;
const REASON_MAX = 300;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pct = (n: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)}%`;

/**
 * Tax rates (S5 §7.3): VAT codes and their rates, proposed by one admin and approved by another (maker ≠ checker;
 * the server refuses the proposer with 403 same_admin). PRICING-ADJACENT CONSTANTS: rates apply to vendor shop
 * sales and documents only; marketplace prices, commission and payouts never change. Scope `payments`.
 */
export default function TaxRatesPageView() {
  const { token, t, locale, user } = useApp();
  const toast = useToast();
  const [data, setData] = useState<TaxRatesPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'off'>('loading');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [rejecting, setRejecting] = useState<TaxRate | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setState(s => (s === 'ready' ? s : 'loading'));
    try {
      setData(await adminTaxApi.rates(token)); setState('ready');
    } catch (err) {
      // Any 404 is "VAT off" (feature_disabled, or an older backend without the route).
      if (err instanceof ApiError && err.status === 404) { forgetTaxRatesAvailability(); setState('off'); return; }
      setState('error');
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const statusLabel = (s: TaxRateStatus) => t(`admin.taxRates.st.${s}` as MessageKey);
  /** "You", the person's name, "System" for the seed, else the id (older backends send ids only). */
  const who = (a: TaxActor) => {
    const id = actorId(a);
    const name = actorName(a);
    if (!id && !name) return '—';
    if (id && id === user?.id) return t('admin.taxRates.you');
    if (id === 'system' || name === 'System') return t('admin.taxRates.system');
    return name || id || '—';
  };
  const nameOf = (r: { nameEn: string | null; nameSw: string | null }) => (locale === 'sw' ? r.nameSw || r.nameEn : r.nameEn || r.nameSw) || '—';

  /** One refusal → its message; null when unknown (the caller shows a generic error). */
  function refusal(err: unknown): string | null {
    const code = errorCode(err);
    if (code === 'same_admin') return t('admin.taxRates.sameAdmin');
    if (code === 'not_proposer') return t('admin.taxRates.notProposer');
    if (code === 'tax_rate_not_pending') { void load(); return t('admin.taxRates.notPending'); }
    if (code === 'rate_conflict') return t('admin.taxRates.conflict');
    if (code === 'effective_date_past') return t('admin.taxRates.approveTooLate');
    if (code === 'reason_required' || code === 'reason_too_long') return t('admin.taxRates.reasonRequired');
    return null;
  }

  async function decide(rate: TaxRate, action: 'approve' | 'withdraw') {
    if (!token) return;
    setBusyId(rate.id);
    try {
      await adminTaxApi.decide(token, rate.id, action);
      toast.success(t(action === 'approve' ? 'admin.taxRates.approved' : 'admin.taxRates.withdrawn'));
      await load();
    } catch (err) {
      toast.error(refusal(err) ?? t('vendor.saveFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <PageHeader
      title={t('admin.taxRates.title')}
      description={t('admin.taxRates.intro')}
      actions={state === 'ready' ? (
        <>
          <Button variant="secondary" className="min-h-11" onClick={load}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('admin.action.refresh')}</Button>
          <Button className="min-h-11" onClick={() => setProposeOpen(true)} data-testid="tax-propose"><Plus aria-hidden="true" className="h-4 w-4" />{t('admin.taxRates.propose')}</Button>
        </>
      ) : undefined}
    />
  );

  if (state === 'loading') return <div aria-busy="true">{header}<SkeletonTable rows={5} columns={8} /></div>;
  if (state === 'off') return <div>{header}<div data-testid="tax-rates-off"><EmptyState title={t('admin.taxRates.unavailable')} /></div></div>;
  if (state === 'error' || !data) return <div>{header}<ErrorState title={t('admin.taxRates.loadFailed')} onRetry={load} retryLabel={t('common.tryAgain')} /></div>;

  const byCode = (code: TaxCode) => data.rates.filter(r => r.code === code.code)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.effectiveFrom.localeCompare(a.effectiveFrom));
  const empty = data.codes.length === 0 && data.rates.length === 0;

  return (
    <div className="space-y-4" data-testid="tax-rates">
      {header}
      {empty ? <EmptyState title={t('admin.taxRates.empty')} /> : (
        <Card className="p-0">
          <Table aria-label={t('admin.taxRates.title')} data-testid="tax-rates-table">
            <THead>
              <Tr>
                <Th>{t('admin.taxRates.code')}</Th>
                <Th>{t('admin.taxRates.name')}</Th>
                <Th className="!text-right">{t('admin.taxRates.rate')}</Th>
                <Th>{t('admin.taxRates.from')}</Th>
                <Th>{t('admin.taxRates.until')}</Th>
                <Th>{t('admin.taxRates.status')}</Th>
                <Th>{t('admin.taxRates.proposedBy')}</Th>
                <Th>{t('common.actions')}</Th>
              </Tr>
            </THead>
            <TBody>
              {data.codes.map(code => {
                const rows = byCode(code);
                if (rows.length === 0) {
                  return (
                    <Tr key={code.code} data-testid={`tax-code-${code.code}`}>
                      <Td className="font-mono font-semibold">{code.code}</Td>
                      <Td>{nameOf(code)}</Td>
                      <Td className="text-right">—</Td>
                      <Td>—</Td>
                      <Td>—</Td>
                      <Td><Badge tone="gray">{t(code.status === 'unused' ? 'admin.taxRates.st.unused' : 'admin.taxRates.st.noRate')}</Badge></Td>
                      <Td>—</Td>
                      <Td />
                    </Tr>
                  );
                }
                return rows.map(r => {
                  const mine = !!user?.id && actorId(r.proposedBy) === user.id;
                  const pending = r.status === 'pending';
                  const expanded = !!open[r.id];
                  const helpId = `tax-same-admin-${r.id}`;
                  return (
                    <Fragment key={r.id}>
                      <Tr data-testid={`tax-rate-${r.id}`}>
                        <Td className="font-mono font-semibold">{r.code}</Td>
                        <Td>
                          <span className="block">{nameOf(r)}</span>
                          {!code.inUse && <span className="block text-xs text-[var(--color-fg-tertiary)]">{t('admin.taxRates.st.unused')}</span>}
                        </Td>
                        <Td className="whitespace-nowrap text-right tabular-nums">{r.exempt || r.ratePct == null ? t('admin.taxRates.exempt') : pct(r.ratePct)}</Td>
                        <Td className="whitespace-nowrap">{receiptDay(r.effectiveFrom, locale)}</Td>
                        <Td className="whitespace-nowrap">{r.effectiveTo ? receiptDay(r.effectiveTo, locale) : '—'}</Td>
                        <Td><Badge tone={TONE[r.status] ?? 'gray'}>{statusLabel(r.status)}</Badge></Td>
                        <Td className="[overflow-wrap:anywhere]">{who(r.proposedBy)}</Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-2">
                            {pending && mine && (
                              <>
                                <span id={helpId} className="w-full text-xs text-[var(--color-fg-tertiary)]" data-testid={`tax-waiting-${r.id}`}>
                                  {t('admin.taxRates.waitingOther')} {t('admin.taxRates.sameAdmin')}
                                </span>
                                <Button size="sm" className="min-h-11" disabled aria-describedby={helpId} data-testid={`tax-approve-${r.id}`}>{t('admin.taxRates.approve')}</Button>
                                <Button size="sm" variant="secondary" className="min-h-11" loading={busyId === r.id} onClick={() => decide(r, 'withdraw')} data-testid={`tax-withdraw-${r.id}`}>
                                  {t('admin.taxRates.withdraw')}
                                </Button>
                              </>
                            )}
                            {pending && !mine && (
                              <>
                                <Button size="sm" className="min-h-11" loading={busyId === r.id} onClick={() => decide(r, 'approve')} data-testid={`tax-approve-${r.id}`}>{t('admin.taxRates.approve')}</Button>
                                <Button size="sm" variant="secondary" className="min-h-11 text-[var(--color-error-700)]" disabled={busyId === r.id} onClick={() => setRejecting(r)} data-testid={`tax-reject-${r.id}`}>
                                  {t('admin.taxRates.reject')}
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" className="min-h-11" aria-expanded={expanded} aria-controls={`tax-history-${r.id}`}
                              onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))} data-testid={`tax-history-toggle-${r.id}`}>
                              {expanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}{t('admin.taxRates.history')}
                            </Button>
                          </div>
                        </Td>
                      </Tr>
                      {expanded && (
                        <Tr id={`tax-history-${r.id}`} data-testid={`tax-history-${r.id}`}>
                          <Td colSpan={8} className="bg-[var(--color-bg-secondary)]">
                            {actorId(r.decidedBy) || actorName(r.decidedBy) ? (
                              <p className="mb-2 text-sm" data-testid={`tax-decided-by-${r.id}`}>{fmt(t('admin.taxRates.decidedBy'), { name: who(r.decidedBy) })}{r.decidedAt ? ` · ${eatDateTime(r.decidedAt, locale)}` : ''}</p>
                            ) : null}
                            {r.reason && <p className="mb-2 text-sm"><span className="font-medium">{t('admin.taxRates.reason')}:</span> <span className="[overflow-wrap:anywhere]">{r.reason}</span></p>}
                            {r.history.length === 0 ? <p className="text-sm text-[var(--color-fg-tertiary)]">{t('admin.taxRates.historyEmpty')}</p> : (
                              <ul className="space-y-1 text-sm">
                                {r.history.map((h, i) => {
                                  const note = typeof h.after?.note === 'string' ? h.after.note : null;
                                  const key = `admin.taxRates.act.${h.action}` as MessageKey;
                                  return (
                                    <li key={`${h.at}-${i}`} className="flex flex-wrap gap-x-2">
                                      <span className="font-medium">{(t(key) as string | undefined) || h.action}</span>
                                      <span className="text-[var(--color-fg-tertiary)]">{who(h.actor)} · {eatDateTime(h.at, locale)}</span>
                                      {note && <span className="[overflow-wrap:anywhere]">{note}</span>}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </Td>
                        </Tr>
                      )}
                    </Fragment>
                  );
                });
              })}
            </TBody>
          </Table>
        </Card>
      )}

      {proposeOpen && <ProposeDialog codes={data.codes} onClose={() => setProposeOpen(false)} onDone={async () => { setProposeOpen(false); toast.success(t('admin.taxRates.proposed')); await load(); }} />}
      {rejecting && (
        <RejectDialog rate={rejecting} onClose={() => setRejecting(null)} refusal={refusal}
          onDone={async () => { setRejecting(null); toast.success(t('admin.taxRates.rejectedToast')); await load(); }} />
      )}
    </div>
  );
}

function ProposeDialog({ codes, onClose, onDone }: { codes: TaxCode[]; onClose: () => void; onDone: () => void }) {
  const { token, t, locale } = useApp();
  const usable = codes.filter(c => c.inUse);
  const tomorrow = eatTomorrow();
  const [code, setCode] = useState(usable[0]?.code ?? '');
  const [exempt, setExempt] = useState(usable[0]?.code === 'E');
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState(tomorrow);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'rate' | 'from' | 'reason' | 'form', string>>>({});
  const [busy, setBusy] = useState(false);
  const isE = code === 'E';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const next: typeof errors = {};
    const n = Number(rate);
    const useExempt = isE && exempt;
    if (!useExempt && (rate.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100 || !/^\d{1,3}(\.\d{1,2})?$/.test(rate.trim()))) next.rate = t('admin.taxRates.rateInvalid');
    else if (!useExempt && code === 'C' && n !== 0) next.rate = t('admin.taxRates.zeroOnly');
    if (!DAY.test(from) || from < tomorrow) next.from = t('admin.taxRates.dateFuture');
    const why = reason.trim();
    if (why.length < REASON_MIN || why.length > REASON_MAX) next.reason = t('admin.taxRates.reasonRequired');
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await adminTaxApi.propose(token, { code, ...(useExempt ? { exempt: true as const } : { ratePct: n }), effectiveFrom: from, reason: why });
      onDone();
    } catch (err) {
      const c = errorCode(err);
      if (c === 'effective_date_past') {
        const earliest = errorBody<{ earliest?: string }>(err)?.earliest;
        if (earliest && DAY.test(earliest)) setFrom(earliest);
        setErrors({ from: t('admin.taxRates.dateFuture') });
      } else if (c === 'invalid_rate') setErrors({ rate: t('admin.taxRates.rateInvalid') });
      else if (c === 'code_not_in_use' || c === 'invalid_code') setErrors({ form: t('admin.taxRates.codeNotInUse') });
      else if (c === 'reason_required' || c === 'reason_too_long') setErrors({ reason: t('admin.taxRates.reasonRequired') });
      else setErrors({ form: t('vendor.saveFailed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={t('admin.taxRates.propose')} description={t('admin.taxRates.waitingOther')}>
      <form onSubmit={submit} className="space-y-4" data-testid="tax-propose-dialog" noValidate>
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        <Field label={t('admin.taxRates.code')} required>
          <Select value={code} onChange={e => { setCode(e.target.value); setExempt(e.target.value === 'E'); setErrors({}); }} data-testid="tax-propose-code">
            {usable.map(c => <option key={c.code} value={c.code}>{`${c.code} · ${(locale === 'sw' ? c.nameSw : c.nameEn) || c.nameEn}`}</option>)}
          </Select>
        </Field>
        {isE && <Checkbox label={t('admin.taxRates.exemptBox')} checked={exempt} onChange={e => setExempt(e.target.checked)} data-testid="tax-propose-exempt" />}
        {!(isE && exempt) && (
          <Field label={t('admin.taxRates.ratePct')} required error={errors.rate}>
            <Input type="number" inputMode="decimal" min={0} max={100} step="0.01" value={rate} onChange={e => { setRate(e.target.value); setErrors(x => ({ ...x, rate: undefined })); }} data-testid="tax-propose-rate" />
          </Field>
        )}
        <Field label={t('admin.taxRates.from')} required error={errors.from}>
          <Input type="date" min={tomorrow} value={from} onChange={e => { setFrom(e.target.value); setErrors(x => ({ ...x, from: undefined })); }} data-testid="tax-propose-from" />
        </Field>
        <Field label={t('admin.taxRates.reason')} required error={errors.reason} hint={`${reason.length}/${REASON_MAX}`}>
          <Textarea rows={3} maxLength={REASON_MAX} value={reason} onChange={e => { setReason(e.target.value); setErrors(x => ({ ...x, reason: undefined })); }} data-testid="tax-propose-reason" />
        </Field>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" className="min-h-11" loading={busy} data-testid="tax-propose-submit">{t('admin.taxRates.submit')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function RejectDialog({ rate, onClose, onDone, refusal }: { rate: TaxRate; onClose: () => void; onDone: () => void; refusal: (err: unknown) => string | null }) {
  const { token, t } = useApp();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const why = reason.trim();
    if (why.length < REASON_MIN) { setError(t('admin.taxRates.reasonRequired')); return; }
    setBusy(true); setError(null);
    try {
      await adminTaxApi.decide(token, rate.id, 'reject', why);
      onDone();
    } catch (err) {
      setError(refusal(err) ?? t('vendor.saveFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={t('admin.taxRates.rejectTitle')}
      description={`${rate.code} · ${rate.exempt || rate.ratePct == null ? t('admin.taxRates.exempt') : pct(rate.ratePct)}`}>
      <form onSubmit={submit} className="space-y-4" data-testid="tax-reject-dialog" noValidate>
        <Field label={t('admin.taxRates.reason')} required error={error ?? undefined} hint={`${reason.length}/${REASON_MAX}`}>
          <Textarea rows={3} maxLength={REASON_MAX} value={reason} onChange={e => { setReason(e.target.value); setError(null); }} data-testid="tax-reject-reason" />
        </Field>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" variant="destructive" className="min-h-11" loading={busy} data-testid="tax-reject-submit">{t('admin.taxRates.reject')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
