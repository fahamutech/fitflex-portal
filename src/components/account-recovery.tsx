'use client';
// One account recovery request, for FitFlex admins: what the person answered
// next to what the account shows, the trail, notes, and the decision. Nobody
// here ever sees or sets a PIN or a code.

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, X } from 'lucide-react';
import { api, RecoveryDetail, RecoveryRefusalReason } from '@/lib/api';
import type { Locale, MessageKey } from '@/lib/i18n';
import { REFUSAL_REASONS, RECOVERY_TONE, canDecideAt, recoveryErrorKey, whenText } from '@/lib/recovery';
import { Alert, Badge, Button, Card, CardContent, Field, PageHeader, Spinner } from './shared';
import { ConfirmDialog, Dialog, DialogFooter } from './dialog';
import { fill } from './communication-shared';

type T = (key: MessageKey) => string;
const QUESTIONS = ['homeGym', 'plan', 'lastCheckin', 'paymentRef', 'other'] as const;

export function RecoveryCase({ id, token, t, locale, onBack }: { id: string; token: string; t: T; locale: Locale; onBack: () => void }) {
  const [data, setData] = useState<RecoveryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [approving, setApproving] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState<RecoveryRefusalReason | ''>('');
  const [refuseNote, setRefuseNote] = useState('');

  const when = (iso: string | null | undefined) => whenText(iso, locale);
  const failure = (err: unknown) => {
    const time = canDecideAt(err);
    return fill(t(recoveryErrorKey(err)), { time: time ? when(time) : '' });
  };

  const load = useCallback(async () => {
    try {
      setData(await api.recovery(token, id));
    } catch (err) {
      setError(failure(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, locale]);
  useEffect(() => { load(); }, [load]);

  async function run(job: () => Promise<unknown>, done: string, after?: () => void) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await job();
      setNotice(done);
      after?.();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
      setApproving(false);
      await load();
    }
  }

  const back = <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />{t('rec.back')}</Button>;
  if (!data) return <div className="space-y-4">{back}{error ? <Alert tone="error">{error}</Alert> : <Spinner className="h-6 w-6" />}</div>;

  const { recovery: r, account: a, events } = data;
  const answers = QUESTIONS.filter(q => r.evidence?.[q]?.trim());
  const isOpen = r.status === 'open';
  const blocked = !r.ready ? fill(t('rec.approveBlockedWait'), { time: when(r.waitUntil) })
    : answers.length === 0 ? t('rec.approveBlockedAnswers') : null;
  const kind = (type: string) => t(type === 'email' ? 'rec.email' : 'rec.phone');
  const sub = a.subscription;
  const facts: Record<(typeof QUESTIONS)[number], string> = {
    homeGym: sub?.homeGym || '',
    plan: sub ? [sub.type, sub.tier, sub.status].filter(Boolean).join(' · ') : '',
    lastCheckin: a.lastCheckins[0] ? `${when(a.lastCheckins[0].at)}${a.lastCheckins[0].gym ? ` · ${a.lastCheckins[0].gym}` : ''}` : '',
    paymentRef: [sub?.paymentRef, ...a.payments.map(p => p.reference)].filter(Boolean).join(', '),
    other: '',
  };

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={r.claimedName}
        description={t('rec.viewRecorded')}
        actions={<Badge tone={RECOVERY_TONE[r.status]}>{t(`rec.status.${r.status}` as MessageKey)}</Badge>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Alert tone="info">{t('rec.noPin')}</Alert>

      <Card>
        <CardContent className="grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t('rec.oldContact')} value={`${kind(r.oldIdentifier.type)} · ${r.oldIdentifier.masked}`} />
          <Fact label={t('rec.newContact')} value={`${kind(r.newIdentifier.type)} · ${r.newIdentifier.value}`} />
          <Fact label={t('rec.col.asked')} value={when(r.createdAt)} />
          <Fact label={t('rec.col.wait')} value={isOpen ? (r.ready ? t('rec.ready') : fill(t('rec.canDecideAfter'), { time: when(r.waitUntil) })) : when(r.waitUntil)} />
          {r.tier && <Fact label={t('rec.tier')} value={r.tier} />}
          {r.requestIp && <Fact label={t('rec.requestIp')} value={r.requestIp} />}
          {!isOpen && (
            <Fact label={t('rec.decided')} value={[
              r.cancelledBy ? t(`rec.cancelledBy.${r.cancelledBy}` as MessageKey) : null,
              r.decidedAt ? fill(t('rec.decidedBy'), { time: when(r.decidedAt) }) : null,
              r.decisionReason && r.decisionReason !== 'approved' ? `${t('rec.reasonShown')}: ${t(`rec.reason.${r.decisionReason}` as MessageKey)}` : null,
              r.decisionNote,
            ].filter(Boolean).join(' · ') || '—'} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-base font-semibold">{t('rec.compare')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" data-testid="rec-compare">
              <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                <tr className="border-b border-[var(--color-border-secondary)]">
                  <th className="py-2 pr-4 font-medium">{t('rec.col.question')}</th>
                  <th className="py-2 pr-4 font-medium">{t('rec.col.theirAnswer')}</th>
                  <th className="py-2 font-medium">{t('rec.col.accountFact')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-secondary)]">
                {QUESTIONS.map(q => (
                  <tr key={q} data-testid={`rec-q-${q}`}>
                    <td className="py-2 pr-4 text-[var(--color-fg-tertiary)]">{t(`rec.q.${q}` as MessageKey)}</td>
                    <td className="py-2 pr-4 font-medium">{r.evidence?.[q]?.trim() || <span className="font-normal text-[var(--color-fg-quaternary)]">{t('rec.noAnswer')}</span>}</td>
                    <td className="py-2">{q === 'other' ? '' : facts[q] || <span className="text-[var(--color-fg-quaternary)]">{t('rec.noFact')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <h2 className="text-base font-semibold">{t('rec.account')}</h2>
            <Fact label={t('rec.accountName')} value={a.personas.map(p => p.displayName).filter(Boolean).join(', ') || '—'} />
            <Fact label={t('rec.registered')} value={when(a.registeredAt)} />
            <div>
              <p className="text-xs text-[var(--color-fg-tertiary)]">{t('rec.personas')}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {a.personas.length ? a.personas.map(p => (
                  <Badge key={p.id} tone="gray">{p.userType.replace('_', ' ')}{p.approvalStatus ? ` · ${p.approvalStatus.replace('_', ' ')}` : ''}</Badge>
                )) : t('rec.none')}
              </div>
            </div>
            <div>
              <p className="text-xs text-[var(--color-fg-tertiary)]">{t('rec.contacts')}</p>
              <ul className="mt-1 space-y-0.5">
                {a.identifiers.map((i, n) => <li key={n}>{kind(i.type)} · {i.masked} <span className="text-xs text-[var(--color-fg-quaternary)]">({t(i.verified ? 'rec.verified' : 'rec.unverified')})</span></li>)}
              </ul>
            </div>
            <div>
              <p className="text-xs text-[var(--color-fg-tertiary)]">{t('rec.subscription')}</p>
              {sub ? (
                <p>{[sub.type, sub.tier, sub.status].filter(Boolean).join(' · ')}{sub.homeGym ? ` · ${sub.homeGym}` : ''}<br />
                  <span className="text-xs text-[var(--color-fg-quaternary)]">{when(sub.startedAt)} → {when(sub.expiresAt)}</span></p>
              ) : <p className="text-[var(--color-fg-quaternary)]">{t('rec.noSubscription')}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <div>
              <h2 className="text-base font-semibold">{t('rec.checkins')}</h2>
              {a.lastCheckins.length ? (
                <ul className="mt-1 space-y-0.5">{a.lastCheckins.map((c, n) => <li key={n}>{when(c.at)}{c.gym ? ` · ${c.gym}` : ''}</li>)}</ul>
              ) : <p className="mt-1 text-[var(--color-fg-quaternary)]">{t('rec.none')}</p>}
            </div>
            <div>
              <h2 className="text-base font-semibold">{t('rec.payments')}</h2>
              {a.payments.length ? (
                <ul className="mt-1 space-y-0.5">{a.payments.map((p, n) => <li key={n}>{p.reference} · {p.amountTzs.toLocaleString()} TZS · {p.status} · {when(p.at)}</li>)}</ul>
              ) : <p className="mt-1 text-[var(--color-fg-quaternary)]">{t('rec.none')}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-5 text-sm">
          <h2 className="text-base font-semibold">{t('rec.trail')}</h2>
          <ol className="space-y-2" data-testid="rec-trail">
            {events.map((e, n) => (
              <li key={n} className="flex flex-wrap gap-x-3">
                <span className="w-40 shrink-0 text-xs tabular-nums text-[var(--color-fg-quaternary)]">{when(e.createdAt)}</span>
                <span className="font-medium">{t(`rec.event.${e.kind}` as MessageKey)}</span>
                {typeof e.detail?.note === 'string' && <span>{e.detail.note}</span>}
                {typeof e.detail?.reason === 'string' && <span>{t(`rec.reason.${e.detail.reason}` as MessageKey)}</span>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-base font-semibold">{t('rec.notes')}</h2>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('rec.notesHelp')}</p>
          <textarea className="ui-input min-h-[80px]" maxLength={1000} value={note} placeholder={t('rec.notePlaceholder')}
            onChange={e => setNote(e.target.value)} data-testid="rec-note" aria-label={t('rec.notes')} />
          <Button variant="secondary" size="sm" disabled={busy || !note.trim()} data-testid="rec-note-add"
            onClick={() => run(() => api.recoveryNote(token, id, note.trim()), t('rec.noteAdded'), () => setNote(''))}>{t('rec.addNote')}</Button>
        </CardContent>
      </Card>

      {isOpen && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="text-base font-semibold">{t('rec.decision')}</h2>
            {blocked && <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="rec-blocked">{blocked}</p>}
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy || !!blocked} onClick={() => setApproving(true)} data-testid="rec-approve"><Check className="h-4 w-4" />{t('rec.approve')}</Button>
              <Button variant="destructive" disabled={busy} onClick={() => { setReason(''); setRefuseNote(''); setRefusing(true); }} data-testid="rec-refuse"><X className="h-4 w-4" />{t('rec.refuse')}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={approving}
        onClose={() => setApproving(false)}
        onConfirm={() => run(() => api.recoveryDecide(token, id, { decision: 'approve' }), t('rec.approved'))}
        title={t('rec.approveTitle')}
        description={fill(t('rec.approveBody'), { value: r.newIdentifier.value })}
        confirmLabel={t('rec.approveConfirm')}
        cancelLabel={t('rec.cancel')}
        tone="primary"
        busy={busy}
      />

      <Dialog open={refusing} onClose={() => setRefusing(false)} title={t('rec.refuseTitle')} description={t('rec.refuseTell')}>
        <div className="space-y-4">
          <Field label={t('rec.reason')}>
            <select className="ui-input" value={reason} onChange={e => setReason(e.target.value as RecoveryRefusalReason | '')} data-testid="rec-reason">
              <option value="">{t('rec.reasonChoose')}</option>
              {REFUSAL_REASONS.map(x => <option key={x} value={x}>{t(`rec.reason.${x}` as MessageKey)}</option>)}
            </select>
          </Field>
          <Field label={t('rec.privateNote')}>
            <textarea className="ui-input min-h-[80px]" maxLength={1000} value={refuseNote} onChange={e => setRefuseNote(e.target.value)} data-testid="rec-refuse-note" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setRefusing(false)}>{t('rec.cancel')}</Button>
          <Button variant="destructive" disabled={busy || !reason} data-testid="rec-refuse-confirm"
            onClick={() => run(
              () => api.recoveryDecide(token, id, { decision: 'refuse', reason: reason as RecoveryRefusalReason, note: refuseNote.trim() || undefined }),
              t('rec.refused'), () => setRefusing(false),
            )}>{t('rec.refuseConfirm')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--color-fg-tertiary)]">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
