'use client';
import { useEffect, useState } from 'react';
import { Check, Gift, History, Lock, PackageCheck, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, ChallengeApiScope, ChallengeScope, RewardAward, RewardQueue as Queue, RewardStatus } from '@/lib/api';
import { STATUS } from '@/lib/rewards';
import { Alert, Badge, Button, Card, CardContent, Field, PageHeader, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { OrgT, useOrgT } from '@/lib/org-i18n';

const TABS: RewardStatus[] = ['pending', 'approved', 'issued', 'rejected'];
const message = (o: OrgT, err: unknown) => o.err('org.rewards.err', err, 'org.common.failed');
/** Why this member earned it. */
const reasonLabel = (o: OrgT, rule: RewardAward['reward']['rule'], rank: number | null) =>
  (rule === 'top' ? (rank ? o.t('org.rewards.reason.placed', { rank }) : o.t('org.rewards.reason.top')) : rule === 'team' ? o.t('org.rewards.rule.team') : o.t('org.rewards.reason.finished'));

type Step = { award: RewardAward; to: RewardStatus };

/**
 * Earned rewards and handing them out: pending → approved → issued, or
 * rejected with a reason. Shows who earned what and why, never activity.
 */
export function RewardQueue({ scope: role, title, description, organizationId }: { scope: ChallengeScope; title: string; description: string; organizationId?: string }) {
  // A B2B organisation's own users go through its routes; what is shown is the same as for a company's HR.
  const scope: ChallengeApiScope = organizationId ? `b2b/organizations/${organizationId}` : role;
  const { token, t } = useApp();
  const o = useOrgT();
  const [tab, setTab] = useState<RewardStatus>('pending');
  const [data, setData] = useState<Queue | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [trail, setTrail] = useState<RewardAward | null>(null);

  useEffect(() => {
    setChallengeId(new URLSearchParams(window.location.search).get('challengeId'));
  }, []);

  const load = async () => {
    if (!token) return;
    setError(null);
    try {
      setData(await api.rewardQueue(token, scope, { challengeId: challengeId ?? undefined }));
    } catch (err) {
      setError(message(o, err));
      setData({ rewards: [], counts: { pending: 0, approved: 0, issued: 0, rejected: 0 } });
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, scope, challengeId]);

  const rows = (data?.rewards ?? []).filter(r => r.status === tab);
  const challengeName = challengeId ? data?.rewards[0]?.challenge.name : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />{t('admin.action.refresh')}</Button>}
      />
      {challengeId && (
        <Alert tone="info">
          {o.t('org.rewards.showingFrom', { name: challengeName ?? o.t('org.rewards.oneChallenge') })}{' '}
          <button className="font-medium underline" onClick={() => { history.replaceState(null, '', window.location.pathname); setChallengeId(null); }}>{o.t('org.rewards.showAll')}</button>
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      <div role="tablist" className="flex flex-wrap gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1">
        {TABS.map(k => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`reward-tab-${k}`}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${tab === k ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
            {o.label('org.rewards.status', k)}
            <span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 text-xs tabular-nums">{data?.counts[k] ?? 0}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {data == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-[var(--color-fg-quaternary)]">
              {tab === 'pending' ? o.t('org.rewards.emptyPending') : o.label('org.rewards.empty', tab)}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" data-testid="reward-table">
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                  <tr className="border-b border-[var(--color-border-secondary)]">
                    <th className="px-4 py-2.5 font-medium">{o.t('org.common.member')}</th>
                    <th className="px-4 py-2.5 font-medium">{o.t('org.rewards.col.reward')}</th>
                    <th className="px-4 py-2.5 font-medium">{o.t('org.rewards.col.challenge')}</th>
                    <th className="px-4 py-2.5 font-medium">{o.t('org.rewards.col.why')}</th>
                    <th className="px-4 py-2.5 font-medium">{tab === 'issued' ? o.t('org.common.issued') : o.t('org.rewards.col.earned')}</th>
                    <th className="px-4 py-2.5 font-medium"><span className="sr-only">{o.t('org.rewards.col.actions')}</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {rows.map(r => (
                    <tr key={r.id} data-testid={`reward-${r.id}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{r.member.displayName ?? o.t('org.common.member')}</p>
                        {r.member.department && <p className="text-xs text-[var(--color-fg-quaternary)]">{r.member.department}</p>}
                      </td>
                      <td className="min-w-[180px] px-4 py-3">
                        <p className="font-medium">{r.reward.label}</p>
                        <p className="text-xs text-[var(--color-fg-quaternary)]">{o.label('org.rewards.type', r.reward.type)}{r.reward.value ? ` · ${r.reward.value}` : ''}</p>
                        {r.status === 'issued' && r.reference && <p className="text-xs">{o.t('org.rewards.ref')} <span className="font-mono">{r.reference}</span></p>}
                        {r.status === 'rejected' && r.note && <p className="text-xs text-[var(--color-fg-error-primary,inherit)]">{r.note}</p>}
                      </td>
                      <td className="px-4 py-3">{r.challenge.name ?? '—'}</td>
                      <td className="px-4 py-3">{reasonLabel(o, r.reward.rule, r.rank)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{o.day(r.status === 'issued' ? r.issuedAt : r.earnedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {r.status === 'pending' && <>
                            <Button size="sm" onClick={() => setStep({ award: r, to: 'approved' })} data-testid="reward-approve"><Check className="h-4 w-4" />{o.t('org.common.approve')}</Button>
                            <Button size="sm" variant="secondary" onClick={() => setStep({ award: r, to: 'rejected' })}><X className="h-4 w-4" />{o.t('org.rewards.reject')}</Button>
                          </>}
                          {r.status === 'approved' && <>
                            <Button size="sm" onClick={() => setStep({ award: r, to: 'issued' })} data-testid="reward-issue"><PackageCheck className="h-4 w-4" />{o.t('org.rewards.markIssued')}</Button>
                            <Button size="sm" variant="secondary" onClick={() => setStep({ award: r, to: 'rejected' })}><X className="h-4 w-4" />{o.t('org.rewards.reject')}</Button>
                          </>}
                          {r.status === 'rejected' && (
                            <Button size="sm" variant="secondary" onClick={() => setStep({ award: r, to: 'pending' })}><RotateCcw className="h-4 w-4" />{o.t('org.rewards.reopen')}</Button>
                          )}
                          <Button size="sm" variant="secondary" aria-label={o.t('org.rewards.historyFor', { name: r.reward.label })} onClick={() => setTrail(r)}><History className="h-4 w-4" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 text-xs text-[var(--color-fg-quaternary)]">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {o.t('org.rewards.privacy')}
      </p>

      {step && token && (
        <StepDialog scope={scope} step={step} onClose={() => setStep(null)}
          onDone={async () => { setStep(null); await load(); }} />
      )}
      {trail && <TrailDialog award={trail} onClose={() => setTrail(null)} />}
    </div>
  );
}

const STEP_ACTION: Record<RewardStatus, 'org.common.approve' | 'org.rewards.markIssued' | 'org.rewards.reject' | 'org.rewards.reopen'> = {
  approved: 'org.common.approve', issued: 'org.rewards.markIssued', rejected: 'org.rewards.reject', pending: 'org.rewards.reopen',
};

function StepDialog({ scope, step, onClose, onDone }: { scope: ChallengeApiScope; step: Step; onClose: () => void; onDone: () => Promise<void> }) {
  const { token, t } = useApp();
  const o = useOrgT();
  const { award: a, to } = step;
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.setRewardStatus(token, scope, a.id, { status: to, reference: reference.trim() || undefined, note: note.trim() || undefined });
      await onDone();
    } catch (err) {
      setError(message(o, err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={o.t(`org.rewards.step.${to}.title`)} description={o.t('org.rewards.step.description', { reward: a.reward.label, member: a.member.displayName ?? o.t('org.rewards.thisMember'), challenge: a.challenge.name ?? '' })} size="sm">
      <form onSubmit={submit} className="space-y-4" data-testid="reward-step">
        {error && <Alert tone="error">{error}</Alert>}
        {to === 'issued' && (
          <Field label={o.t('org.rewards.referenceOptional')}>
            <input className="ui-input" value={reference} onChange={e => setReference(e.target.value)} maxLength={120}
              placeholder={o.t('org.rewards.referencePlaceholder')} data-testid="reward-reference" />
          </Field>
        )}
        <Field label={to === 'rejected' ? o.t('org.rewards.reasonLabel') : o.t('org.common.noteOptional')}>
          <textarea className="ui-input" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={300} required={to === 'rejected'}
            placeholder={to === 'issued' ? o.t('org.rewards.notePlaceholder.issued') : to === 'rejected' ? o.t('org.rewards.notePlaceholder.rejected') : ''} data-testid="reward-note" />
        </Field>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>{t('admin.action.cancel')}</Button>
          <Button type="submit" disabled={busy} data-testid="reward-step-save">{o.t(STEP_ACTION[to])}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function TrailDialog({ award: a, onClose }: { award: RewardAward; onClose: () => void }) {
  const o = useOrgT();
  return (
    <Dialog open onClose={onClose} title={o.t('org.rewards.history')} description={`${a.reward.label} · ${a.member.displayName ?? ''}`} size="sm">
      <ol className="space-y-3" data-testid="reward-trail">
        {a.history.map((h, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <Gift className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-fg-quaternary)]" />
            <div>
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS[h.status].tone}>{i === 0 ? o.t('org.rewards.trail.earned') : h.status === 'pending' ? o.t('org.rewards.trail.reopened') : o.label('org.rewards.status', h.status)}</Badge>
                <span className="text-xs text-[var(--color-fg-quaternary)]">{o.dateTime(h.at)}{h.by ? ` · ${o.t('org.rewards.trail.by', { name: h.byName ?? o.t('org.rewards.trail.teamMember') })}` : ''}</span>
              </p>
              {h.reference && <p className="text-xs">{o.t('org.rewards.ref')} <span className="font-mono">{h.reference}</span></p>}
              {h.note && i > 0 && <p className="text-xs text-[var(--color-fg-tertiary)]">{h.note}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
