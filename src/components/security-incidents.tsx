'use client';
// One security report, for FitFlex staff with the `security_incidents` scope: what the member reported, what
// protection was applied, the trail, and the two actions (acknowledge, resolve). Resolving never voids the
// check-in or changes visits, payouts or settlement; the member gets the same neutral message whatever the outcome.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Check, Eye, RefreshCw } from 'lucide-react';
import type { Locale, MessageKey } from '@/lib/i18n';
import {
  PROTECTION_TONE, SECURITY_INCIDENT_OUTCOMES, SECURITY_REASON_MAX, SECURITY_REASON_MIN, SECURITY_STATUS_TONE,
  SecurityIncident, SecurityIncidentDetail, SecurityIncidentEvent, SecurityIncidentOutcome, SecurityIncidentProtection,
  eatTime, protectionState, securityFailure, securityIncidentsApi, trailKey,
} from '@/lib/security-incidents';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { Alert, Badge, Button, Card, CardContent, EmptyState, ErrorState, Field, PageHeader, Select, Spinner, Textarea } from './shared';
import { Dialog, DialogFooter } from './dialog';
import { fill } from './communication-shared';

type T = (key: MessageKey) => string;
type View = 'loading' | 'ready' | 'off' | 'forbidden' | 'not_found' | 'error';
type Notice = { tone: 'success' | 'warning' | 'error'; text: string };

/** A time in Dar es Salaam, labelled EAT; a dash-free fallback when nothing was recorded. */
export function eatLabel(iso: string | null | undefined, locale: Locale, t: T): string {
  const time = eatTime(iso, locale);
  return time ? fill(t('secInc.timeEat'), { time }) : t('secInc.unknownTime');
}

export function ProtectionBadge({ protection, t }: { protection: SecurityIncidentProtection | null; t: T }) {
  const state = protectionState(protection);
  return <Badge tone={PROTECTION_TONE[state]}>{t(`secInc.protection.${state}` as MessageKey)}</Badge>;
}

export function SecurityStatusBadge({ incident, t }: { incident: SecurityIncident; t: T }) {
  return <Badge tone={SECURITY_STATUS_TONE[incident.status] ?? 'gray'}>{t(`secInc.status.${incident.status}` as MessageKey)}</Badge>;
}

/** The "feature is not switched on" and "no access" cards, shared by the list and the report view. */
export function SecurityOff({ t }: { t: T }) {
  return <div data-testid="secinc-off"><EmptyState title={t('secInc.off.title')} body={t('secInc.off.body')} /></div>;
}
export function SecurityForbidden({ t }: { t: T }) {
  return (
    <div data-testid="secinc-forbidden">
      <Alert tone="error">
        <p>{t('secInc.forbidden.title')}</p>
        <p className="mt-1 font-normal">{t('secInc.forbidden.body')}</p>
      </Alert>
    </div>
  );
}

export function SecurityIncidentCase({ id, token, t, locale, onBack }: { id: string; token: string; t: T; locale: Locale; onBack: () => void }) {
  const [data, setData] = useState<SecurityIncidentDetail | null>(null);
  const [view, setView] = useState<View>('loading');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [outcome, setOutcome] = useState<SecurityIncidentOutcome | ''>('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [serverField, setServerField] = useState<'outcome' | 'reason' | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const titleRef = useRef<HTMLSpanElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const countId = useId();
  const focusAfterRender = useFocusAfterRender();
  const when = (iso: string | null | undefined) => eatLabel(iso, locale, t);

  /** → true when the report is on screen. */
  const load = useCallback(async () => {
    try {
      setData(await securityIncidentsApi.get(token, id));
      setView('ready');
      return true;
    } catch (err) {
      const f = securityFailure(err);
      setView(f === 'off' || f === 'forbidden' || f === 'not_found' ? f : 'error');
      return false;
    }
  }, [token, id]);

  // First load: the title takes focus once the report is on screen (the row that opened it is gone).
  useEffect(() => {
    let live = true;
    setView('loading'); setData(null); setNotice(null);
    void load().then(ok => { if (ok && live) focusAfterRender(() => titleRef.current); });
    return () => { live = false; };
  }, [load, focusAfterRender]);

  const say = (n: Notice) => { setNotice(n); focusAfterRender(() => noticeRef.current); };

  /** A refusal that changes the whole view (flag off, access removed); → true when handled. */
  function leaves(err: unknown): boolean {
    const f = securityFailure(err);
    if (f !== 'off' && f !== 'forbidden' && f !== 'not_found') return false;
    setResolving(false);
    setView(f);
    return true;
  }

  async function acknowledge() {
    setBusy(true); setNotice(null);
    try {
      setData(await securityIncidentsApi.acknowledge(token, id));
      say({ tone: 'success', text: t('secInc.acknowledged') });
    } catch (err) {
      if (leaves(err)) return;
      if (securityFailure(err) === 'conflict') { await load(); say({ tone: 'warning', text: t('secInc.conflict') }); }
      else say({ tone: 'error', text: t('secInc.actionError') });
    } finally {
      setBusy(false);
    }
  }

  const reasonLength = reason.trim().length;
  const outcomeError = (tried && !outcome) || serverField === 'outcome' ? t('secInc.err.outcome') : null;
  const reasonError = reasonLength > SECURITY_REASON_MAX ? t('secInc.err.reasonLong')
    : (tried && reasonLength < SECURITY_REASON_MIN) || serverField === 'reason' ? t('secInc.err.reasonShort') : null;

  function openResolve() {
    setOutcome(''); setReason(''); setTried(false); setServerField(null); setDialogError(null); setNotice(null);
    setResolving(true);
  }

  async function resolve() {
    setTried(true); setServerField(null); setDialogError(null);
    if (!outcome) { focusAfterRender(() => outcomeRef.current); return; }
    if (reasonLength < SECURITY_REASON_MIN || reasonLength > SECURITY_REASON_MAX) { focusAfterRender(() => reasonRef.current); return; }
    setBusy(true);
    try {
      setData(await securityIncidentsApi.resolve(token, id, { outcome, reason: reason.trim() }));
      setResolving(false);
      say({ tone: 'success', text: t('secInc.resolved') });
    } catch (err) {
      if (leaves(err)) return;
      const f = securityFailure(err);
      if (f === 'conflict') {
        // Someone else resolved it first: show what is there now.
        await load();
        setResolving(false);
        say({ tone: 'warning', text: t('secInc.conflict') });
      } else if (f === 'invalid_outcome') {
        setServerField('outcome'); focusAfterRender(() => outcomeRef.current);
      } else if (f === 'invalid_reason') {
        setServerField('reason'); focusAfterRender(() => reasonRef.current);
      } else {
        setDialogError(t('secInc.actionError'));
      }
    } finally {
      setBusy(false);
    }
  }

  const back = <Button variant="ghost" size="sm" onClick={onBack} data-testid="secinc-back"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('secInc.back')}</Button>;

  if (view !== 'ready' || !data) {
    return (
      <div className="space-y-4" data-testid="secinc-case">
        {back}
        {view === 'off' ? <SecurityOff t={t} />
          : view === 'forbidden' ? <SecurityForbidden t={t} />
          : view === 'not_found' ? <div data-testid="secinc-not-found"><Alert tone="warning">{t('secInc.notFound')}</Alert></div>
          : view === 'error' ? <div data-testid="secinc-case-error"><ErrorState title={t('secInc.detailError')} message={t('secInc.loadErrorBody')} onRetry={() => { setView('loading'); void load(); }} retryLabel={t('secInc.retry')} /></div>
          : <div role="status" aria-busy="true" className="flex items-center gap-2 text-sm text-[var(--color-fg-tertiary)]"><Spinner className="h-5 w-5" />{t('secInc.detailLoading')}</div>}
      </div>
    );
  }

  const { incident: inc, events } = data;
  const snap = inc.snapshot ?? {};
  const state = protectionState(inc.protection);
  const pin = inc.protection?.pinResetRequired;
  const channel = !snap.channel || snap.channel === 'web' ? t('secInc.channel.web') : snap.channel;
  const closed = inc.status === 'resolved';

  return (
    <div className="space-y-6" data-testid="secinc-case">
      {back}
      <PageHeader
        title={<span ref={titleRef} tabIndex={-1} className="outline-none">{fill(t('secInc.detailTitle'), { id: inc.id })}</span>}
        description={snap.gymName || t('secInc.unknownGym')}
        actions={<><SecurityStatusBadge incident={inc} t={t} /><Button variant="secondary" size="sm" disabled={busy} onClick={() => { setNotice(null); void load(); }}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t('secInc.refresh')}</Button></>}
      />

      <div ref={noticeRef} tabIndex={-1} className="outline-none" data-testid="secinc-notice">
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      </div>
      <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="secinc-no-void">{t('secInc.noVoid')}</p>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">{t('secInc.snapshot')}</h2>
            <p className="text-xs text-[var(--color-fg-quaternary)]">{t('secInc.snapshotHelp')}</p>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3" data-testid="secinc-snapshot">
            <Fact label={t('secInc.field.gym')} value={snap.gymName || t('secInc.unknownGym')} />
            <Fact label={t('secInc.field.time')} value={when(snap.occurredAt)} />
            <Fact label={t('secInc.field.channel')} value={channel} />
            <Fact label={t('secInc.field.reported')} value={when(inc.reportedAt)} />
            <Fact label={t('secInc.field.member')} value={inc.userId} />
            <Fact label={t('secInc.field.event')} value={inc.eventId} />
            {inc.acknowledgedAt && <Fact label={t('secInc.field.acknowledged')} value={byline(when(inc.acknowledgedAt), inc.acknowledgedBy, t)} />}
            {inc.resolvedAt && <Fact label={t('secInc.field.resolved')} value={byline(when(inc.resolvedAt), inc.resolvedBy, t)} />}
            {inc.outcome && <Fact label={t('secInc.field.outcome')} value={t(`secInc.outcome.${inc.outcome}` as MessageKey)} />}
            {inc.resolutionReason && <Fact label={t('secInc.field.reason')} value={inc.resolutionReason} wide />}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-5 text-sm" data-testid="secinc-protection">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{t('secInc.protection')}</h2>
            <ProtectionBadge protection={inc.protection} t={t} />
          </div>
          <p>{t(`secInc.protectionBody.${state}` as MessageKey)}</p>
          {state === 'applied' && pin === true && <p>{t('secInc.pin.required')}</p>}
          {state === 'applied' && pin === 'not_applicable' && <p>{t('secInc.pin.notApplicable')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5 text-sm">
          <h2 className="text-base font-semibold">{t('secInc.trailTitle')}</h2>
          {events.length === 0 ? <p className="text-[var(--color-fg-quaternary)]">{t('secInc.trailEmpty')}</p> : (
            <ol className="space-y-2" data-testid="secinc-trail">
              {events.map(e => (
                <li key={e.id} className="flex flex-wrap gap-x-3">
                  <span className="w-52 shrink-0 text-xs tabular-nums text-[var(--color-fg-tertiary)]">{when(e.at)}</span>
                  <span className="font-medium">{t(trailKey(e.kind))}</span>
                  <span className="text-[var(--color-fg-tertiary)]">{trailDetail(e, t)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-base font-semibold">{t('secInc.actions')}</h2>
          {closed ? <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="secinc-closed">{t('secInc.closedNote')}</p> : (
            <>
              {inc.status === 'open' && <p className="text-sm text-[var(--color-fg-tertiary)]">{t('secInc.acknowledgeHelp')}</p>}
              <div className="flex flex-wrap gap-3">
                {inc.status === 'open' && (
                  <Button variant="secondary" disabled={busy} onClick={() => void acknowledge()} data-testid="secinc-acknowledge"><Eye aria-hidden="true" className="h-4 w-4" />{t('secInc.acknowledge')}</Button>
                )}
                <Button disabled={busy} onClick={openResolve} data-testid="secinc-resolve"><Check aria-hidden="true" className="h-4 w-4" />{t('secInc.resolve')}</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={resolving} onClose={() => { if (!busy) setResolving(false); }} title={t('secInc.resolveTitle')} description={t('secInc.noVoid')} testId="secinc-resolve-dialog">
        <form id={`${countId}-form`} className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); void resolve(); }}>
          {dialogError && <Alert tone="error">{dialogError}</Alert>}
          <Field label={t('secInc.resolveOutcome')} required error={outcomeError ?? undefined}>
            <Select ref={outcomeRef} value={outcome} onChange={e => { setOutcome(e.target.value as SecurityIncidentOutcome | ''); setServerField(null); }} data-testid="secinc-outcome">
              <option value="">{t('secInc.resolveChoose')}</option>
              {SECURITY_INCIDENT_OUTCOMES.map(o => <option key={o} value={o}>{t(`secInc.outcome.${o}` as MessageKey)}</option>)}
            </Select>
          </Field>
          <div>
            <Field label={t('secInc.resolveReason')} required hint={t('secInc.resolveReasonHint')} error={reasonError ?? undefined}>
              <Textarea ref={reasonRef} rows={4} value={reason} aria-describedby={countId} onChange={e => { setReason(e.target.value); setServerField(null); }} data-testid="secinc-reason" />
            </Field>
            <p id={countId} className={`mt-1 text-xs tabular-nums ${reasonLength > SECURITY_REASON_MAX ? 'text-[var(--color-error-700)]' : 'text-[var(--color-fg-tertiary)]'}`} data-testid="secinc-reason-count">
              {fill(t('secInc.reasonCount'), { count: reasonLength, max: SECURITY_REASON_MAX })}
            </p>
          </div>
        </form>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => setResolving(false)}>{t('secInc.cancel')}</Button>
          <Button type="submit" form={`${countId}-form`} disabled={busy} data-testid="secinc-resolve-confirm">{busy ? t('secInc.working') : t('secInc.resolveConfirm')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

const byline = (time: string, actor: string | null, t: T) => (actor ? fill(t('secInc.by'), { time, actor }) : time);

/** The few facts the server keeps on a trail row, in words. Free text is never stored there. */
function trailDetail(e: SecurityIncidentEvent, t: T): string {
  const d = e.detail ?? {};
  const parts: string[] = [];
  if (e.kind === 'reported') {
    parts.push(t(d.secureAccount === false ? 'secInc.trail.reportOnly' : 'secInc.trail.secureAsked'));
    if (d.limited === true) parts.push(t('secInc.protection.limited'));
  } else if (e.kind === 'protection') {
    const state = d.failed === true ? 'failed' : d.limited === true ? 'limited' : d.sessionsEnded === true ? 'applied' : 'pending';
    parts.push(t(`secInc.protection.${state}` as MessageKey));
    if (d.retry === true) parts.push(t('secInc.trail.retry'));
  } else if (e.kind === 'resolved') {
    const o = SECURITY_INCIDENT_OUTCOMES.find(x => x === d.outcome);
    if (o) parts.push(t(`secInc.outcome.${o}` as MessageKey));
    if (e.actor) parts.push(e.actor);
  } else if (e.kind === 'acknowledged' && e.actor) {
    parts.push(e.actor);
  }
  return parts.join(' · ');
}

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-xs text-[var(--color-fg-tertiary)]">{label}</dt>
      <dd className="font-medium [overflow-wrap:anywhere] whitespace-pre-wrap">{value}</dd>
    </div>
  );
}
