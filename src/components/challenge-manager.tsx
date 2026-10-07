'use client';
import { useEffect, useMemo, useState } from 'react';
import { Gift, Plus, RefreshCw, Trophy, Lock, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useApp } from '../../app/providers';
import {
  api, ApiError, ChallengeApiScope, ChallengeInput, ChallengeMode, ChallengeParticipation, ChallengeScope,
  ChallengeStandings, ChallengeType, CorporateEmployee, Eligibility, ManagedChallenge,
  Rate, RewardFunding, RewardItem, RewardItemInput, RewardQueue, RewardRule, RewardType,
} from '@/lib/api';
import { REWARD_TYPES, RULES, ruleLabel, STATUS, typeLabel } from '@/lib/rewards';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, Field, MetricCard, PageHeader, Spinner,
} from '@/components/shared';
import { Dialog } from '@/components/dialog';

const TYPES: { value: ChallengeType; label: string; unit: string }[] = [
  { value: 'steps', label: 'Steps', unit: 'steps' },
  { value: 'distance_km', label: 'Distance', unit: 'km' },
  { value: 'workouts', label: 'Workouts', unit: 'workouts' },
  { value: 'active_minutes', label: 'Active minutes', unit: 'minutes' },
  { value: 'consistency', label: 'Active days', unit: 'active days' },
  { value: 'gym_attendance', label: 'Gym visits', unit: 'visit days' },
];
const TIERS = [
  { value: 'basic', label: 'Basic' },
  { value: 'pro', label: 'Pro' },
  { value: 'premium', label: 'Premium' },
  { value: 'executive', label: 'Executive' },
];
const FUNDERS: Record<ChallengeScope, { value: RewardFunding; label: string }[]> = {
  admin: [{ value: 'fitflex', label: 'FitFlex' }, { value: 'partner', label: 'A partner' }],
  corporate: [{ value: 'company', label: 'Your company' }, { value: 'fitflex', label: 'FitFlex' }, { value: 'partner', label: 'A partner' }],
};
const MODES: Record<ChallengeScope, { value: ChallengeMode; label: string; hint: string }[]> = {
  admin: [
    { value: 'individual', label: 'Individual', hint: 'Everyone works toward their own target.' },
    { value: 'teams', label: 'Teams', hint: 'You name the teams; members pick one.' },
    { value: 'gym_vs_gym', label: 'Gym vs gym', hint: 'Each member represents their gym.' },
  ],
  corporate: [
    { value: 'individual', label: 'Individual', hint: 'Everyone works toward their own target.' },
    { value: 'teams', label: 'Teams', hint: 'You name the teams; employees pick one.' },
    { value: 'department', label: 'Departments', hint: 'Each employee represents their department.' },
  ],
};

const ERRORS: Record<string, string> = {
  invalid_name: 'Give the challenge a name.',
  invalid_type: 'Choose what the challenge measures.',
  invalid_dates: 'The end date must be on or after the start date.',
  too_long: 'A challenge can run for up to 92 days.',
  ends_in_past: 'The end date has already passed.',
  invalid_target: 'That target is outside what the challenge length allows.',
  invalid_teams: 'Add at least two different team names.',
  invalid_rewards: 'Up to 5 rewards, each with a name of up to 80 characters.',
  invalid_reward_type: 'Choose what kind of reward each one is.',
  invalid_reward_rule: 'Choose who earns each reward.',
  invalid_reward_top_n: 'Top places must be a whole number from 1 to 100.',
  team_reward_needs_teams: 'A winning-team reward needs a team, gym or department format.',
  reward_locked: 'Someone has already earned one of these rewards, so it can’t be removed or changed (you can still rename it).',
  invalid_eligibility: 'Choose at least one tier, department or employee.',
  invalid_reward_funding: 'Choose who funds the rewards.',
  mode_not_allowed: 'That challenge format is not available here.',
  measure_locked: 'What it measures can’t change once it has started or someone has joined.',
  start_locked: 'The start date can’t change once the challenge has started.',
  not_editable: 'Only running or upcoming challenges can be edited.',
  still_running: 'Close or cancel the challenge before archiving it.',
  not_started_cancel_instead: 'It hasn’t started yet — cancel it instead.',
};
const message = (e: unknown) =>
  e instanceof ApiError ? ERRORS[(e.body as any)?.error] ?? 'That didn’t work. Please try again.' : 'That didn’t work. Please try again.';

const pct = (r: Rate | undefined) => (r == null ? '—' : `${Math.round(r * 100)}%`);
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const range = (c: { startDate: string; endDate: string }) => `${day(c.startDate)} – ${day(c.endDate)}`;
const unitFor = (t: ChallengeType) => TYPES.find(x => x.value === t)?.unit ?? '';
const phaseTone = (c: ManagedChallenge): 'default' | 'success' | 'brand' | 'danger' | 'gray' =>
  c.status === 'archived' ? 'gray' : c.phase === 'active' ? 'success' : c.phase === 'upcoming' ? 'brand' : c.phase === 'cancelled' ? 'danger' : 'default';
const phaseLabel = (c: ManagedChallenge) =>
  c.status === 'archived' ? 'Archived' : c.status === 'closed' ? 'Closed early' : { active: 'Running', upcoming: 'Upcoming', ended: 'Ended', cancelled: 'Cancelled' }[c.phase];

/**
 * A company has employees in departments; a B2B organisation (an insurer, a
 * club, a school) has people in groups. Same screens, its own words.
 */
const wordsFor = (org: boolean) => (org
  ? { person: 'person', people: 'people', unit: 'group', units: 'groups', Unit: 'Group', owner: 'Your organisation', list: 'people list' }
  : { person: 'employee', people: 'employees', unit: 'department', units: 'departments', Unit: 'Department', owner: 'Your company', list: 'staff list' });
const isOrg = (apiScope: ChallengeApiScope) => apiScope.startsWith('b2b/');

function eligibilityText(e: Eligibility | null, scope: ChallengeScope, staff: CorporateEmployee[], org = false) {
  const w = wordsFor(org);
  if (!e || e.kind === 'all') return scope === 'admin' ? 'All FitFlex members' : org ? 'Everyone' : 'All employees';
  if (e.kind === 'tiers') return `Members on ${e.tiers.map(t => TIERS.find(x => x.value === t)?.label ?? t).join(', ')} passes`;
  if (e.kind === 'departments') return e.departments.join(', ');
  return `${e.employeeIds.length} chosen ${e.employeeIds.length === 1 ? w.person : w.people}`;
}

/**
 * Challenge management for FitFlex admins (`scope="admin"`) and company HR
 * (`scope="corporate"`). Both only ever see totals: participation,
 * completion and average progress. An organisation sees each person's
 * progress elsewhere, under Insights.
 */
export function ChallengeManager({ scope, title, description, organizationId, rewardsHref }: {
  scope: ChallengeScope; title: string; description: string;
  /** A B2B organisation's own users: its routes and its people list are used instead of the company HR ones. */
  organizationId?: string; rewardsHref?: string;
}) {
  const { token } = useApp();
  const apiScope: ChallengeApiScope = organizationId ? `b2b/organizations/${organizationId}` : scope;
  const rewardsBase = rewardsHref ?? `${scope === 'admin' ? '/admin' : '/hr'}/rewards`;
  const [rows, setRows] = useState<ManagedChallenge[] | null>(null);
  const [staff, setStaff] = useState<CorporateEmployee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'live' | 'ended' | 'closed'>('live');
  const [editing, setEditing] = useState<ManagedChallenge | 'new' | null>(null);
  const [open, setOpen] = useState<ManagedChallenge | null>(null);

  const load = async () => {
    if (!token) return;
    try {
      const [c, s] = await Promise.all([
        api.creatorChallenges(token, apiScope),
        organizationId
          // The organisation's people; their group stands in for a department.
          ? api.b2bBeneficiaries(token, organizationId, { status: 'active', limit: 100 })
            .then(r => ({ employees: r.items.map(b => ({ id: b.id, displayName: b.displayName ?? 'Unnamed', department: b.groupName, status: b.status })) }))
            .catch(() => ({ employees: [] }))
          : scope === 'corporate' ? api.corporateStaff(token).catch(() => ({ employees: [] })) : Promise.resolve({ employees: [] }),
      ]);
      setRows(c.challenges);
      setStaff(s.employees);
      setError(null);
    } catch (e) {
      setError(message(e));
      setRows([]);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, apiScope]);

  const shown = useMemo(() => (rows ?? []).filter(c =>
    tab === 'live' ? c.status === 'active' && (c.phase === 'active' || c.phase === 'upcoming')
      : tab === 'ended' ? (c.status === 'active' || c.status === 'closed') && c.phase === 'ended'
        : c.status === 'cancelled' || c.status === 'archived'), [rows, tab]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>
            <Button size="sm" onClick={() => setEditing('new')} data-testid="challenge-new"><Plus className="h-4 w-4" />New challenge</Button>
          </>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}

      <div role="tablist" className="inline-flex rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] p-0.5">
        {([['live', 'Running & upcoming'], ['ended', 'Ended'], ['closed', 'Cancelled & archived']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-[var(--radius-md)] px-3 py-1 text-sm font-medium ${tab === k ? 'bg-[var(--color-brand-600)] text-white' : 'text-[var(--color-fg-tertiary)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {rows == null ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : shown.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-[var(--color-fg-quaternary)]">
          <Trophy className="mx-auto mb-2 h-6 w-6" />
          {tab === 'live' ? 'No running or upcoming challenges. Create one to get started.' : 'Nothing here yet.'}
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {shown.map(c => (
            <button key={c.id} onClick={() => setOpen(c)} data-testid={`challenge-row-${c.id}`}
              className="text-left">
              <Card className="transition-colors hover:border-[var(--color-brand-300)]">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--color-fg-primary)]">{c.name}</p>
                    <p className="text-sm text-[var(--color-fg-tertiary)]">
                      {num(c.target)} {unitFor(c.type)} · {range(c)} · {eligibilityText(c.eligibility, scope, staff, isOrg(apiScope))}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-sm tabular-nums text-[var(--color-fg-secondary)]"><Users className="h-4 w-4" />{num(c.participantCount)}</span>
                    <Badge tone={phaseTone(c)}>{phaseLabel(c)}</Badge>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <ChallengeForm
          scope={scope}
          apiScope={apiScope}
          rewardsBase={rewardsBase}
          staff={staff}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async saved => { setEditing(null); await load(); setOpen(saved); }}
        />
      )}
      {open && !editing && (
        <ChallengeDetail
          scope={scope}
          apiScope={apiScope}
          rewardsBase={rewardsBase}
          staff={staff}
          challenge={open}
          onClose={() => setOpen(null)}
          onEdit={() => setEditing(open)}
          onChanged={async c => { await load(); setOpen(c); }}
        />
      )}
    </div>
  );
}

// ── Rewards ───────────────────────────────────────────────────────────────

/** Rewards as items (challenges saved before structured rewards carry labels only). */
function rewardItemsOf(c?: ManagedChallenge | null): RewardItem[] {
  if (!c) return [];
  if (Array.isArray(c.rewardItems)) return c.rewardItems;
  return c.rewards.map((label, i) => ({ id: `legacy_${i}`, type: 'other', label, value: null, rule: 'finishers', topN: null }));
}

/** Does this area hand out the challenge's rewards? Admin: FitFlex/partner. HR: company-funded. */
function handledHere(scope: ChallengeScope, c: ManagedChallenge) {
  const funder = c.rewardFunding ?? (scope === 'corporate' ? 'company' : 'fitflex');
  return scope === 'corporate' ? funder === 'company' : funder !== 'company';
}

const MAX_REWARDS = 5;

function RewardEditor({ items, teamsOk, onChange }: {
  items: RewardItemInput[]; teamsOk: boolean; onChange: (v: RewardItemInput[]) => void;
}) {
  const edit = (i: number, patch: Partial<RewardItemInput>) => onChange(items.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="space-y-2" data-testid="challenge-rewards">
      <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">Rewards (optional)</legend>
      <p className="text-xs text-[var(--color-fg-quaternary)]">
        Earning a reward isn’t the same as receiving it: each one starts as pending fulfilment and is approved, then issued, from the Rewards page.
      </p>
      {items.map((r, i) => {
        const hint = REWARD_TYPES.find(t => t.value === r.type)?.valueHint;
        return (
          <div key={r.id ?? `new_${i}`} className="grid gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 sm:grid-cols-12" data-testid={`reward-row-${i}`}>
            <select className="ui-input sm:col-span-3" aria-label="Reward type" value={r.type} onChange={e => edit(i, { type: e.target.value as RewardType })}>
              {REWARD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input className="ui-input sm:col-span-4" aria-label="Reward name" placeholder="e.g. 7-day FitFlex Gym Pass" maxLength={80} value={r.label} onChange={e => edit(i, { label: e.target.value })} />
            <input className="ui-input sm:col-span-2" aria-label="Reward value" placeholder={hint || 'Value'} maxLength={40} value={r.value ?? ''} onChange={e => edit(i, { value: e.target.value })} />
            <div className="flex gap-2 sm:col-span-3">
              <select className="ui-input min-w-0 flex-1" aria-label="Who earns it" value={r.rule} onChange={e => edit(i, { rule: e.target.value as RewardRule, topN: e.target.value === 'top' ? r.topN ?? 3 : null })}>
                {RULES.filter(x => x.value !== 'team' || teamsOk || r.rule === 'team').map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
              {r.rule === 'top' && (
                <input className="ui-input w-16" type="number" min={1} max={100} aria-label="How many top places" value={r.topN ?? ''} onChange={e => edit(i, { topN: e.target.value === '' ? null : Number(e.target.value) })} />
              )}
              <button type="button" className="shrink-0 rounded-md p-2 text-[var(--color-fg-quaternary)] hover:bg-[var(--color-bg-secondary)]" aria-label={`Remove ${r.label || 'reward'}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
      {items.length < MAX_REWARDS && (
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...items, { type: 'badge', label: '', value: null, rule: 'finishers', topN: null }])} data-testid="reward-add">
          <Gift className="h-4 w-4" />Add a reward
        </Button>
      )}
    </fieldset>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────

function ChallengeDetail({ scope, apiScope, rewardsBase, staff, challenge: c, onClose, onEdit, onChanged }: {
  scope: ChallengeScope; apiScope: ChallengeApiScope; rewardsBase: string; staff: CorporateEmployee[]; challenge: ManagedChallenge;
  onClose: () => void; onEdit: () => void; onChanged: (c: ManagedChallenge) => Promise<void>;
}) {
  const { token } = useApp();
  const [p, setP] = useState<ChallengeParticipation | null>(null);
  const [standings, setStandings] = useState<ChallengeStandings | null>(null);
  const [rewardCounts, setRewardCounts] = useState<RewardQueue['counts'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const teamed = c.mode && c.mode !== 'individual';
  const ownRewards = rewardItemsOf(c).length > 0 && handledHere(scope, c);

  useEffect(() => {
    if (!token) return;
    api.challengeParticipation(token, apiScope, c.id).then(setP).catch(e => setError(message(e)));
    if (teamed) api.challengeStandings(token, apiScope, c.id).then(setStandings).catch(() => setStandings(null));
    if (ownRewards) api.rewardQueue(token, apiScope, { challengeId: c.id }).then(q => setRewardCounts(q.counts)).catch(() => setRewardCounts(null));
  }, [token, apiScope, c.id, teamed, ownRewards]);

  const act = async (action: 'cancel' | 'close' | 'archive', confirmText: string) => {
    if (!token || !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await api.challengeAction(token, apiScope, c.id, action);
      await onChanged({ ...c, ...r.challenge });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const running = c.status === 'active' && c.phase === 'active';
  const upcoming = c.status === 'active' && c.phase === 'upcoming';
  const over = c.phase === 'ended' && c.status !== 'archived' || c.status === 'cancelled';
  const s = p?.summary;

  return (
    <Dialog open onClose={onClose} title={c.name} description={`${num(c.target)} ${unitFor(c.type)} · ${range(c)}`} size="xl">
      <div className="space-y-5" data-testid="challenge-detail">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={phaseTone(c)}>{phaseLabel(c)}</Badge>
          <span className="text-sm text-[var(--color-fg-tertiary)]">Open to: {eligibilityText(c.eligibility, scope, staff, isOrg(apiScope))}</span>
        </div>

        {!s ? (
          <div className="flex h-24 items-center justify-center"><Spinner className="h-6 w-6" /></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Taking part" value={num(s.joined)} sub={s.eligible == null ? undefined : `${pct(s.participationRate)} of ${num(s.eligible)} eligible`} />
            {s.resultsHidden || s.completed == null || s.averageProgress == null ? (
              // Too few people for results to be shown without pointing at someone.
              <>
                <MetricCard label="Completed" value="—" sub={`Shown once ${p?.minGroupSize ?? 3} or more take part`} />
                <MetricCard label="Average progress" value="—" sub={`Shown once ${p?.minGroupSize ?? 3} or more take part`} />
              </>
            ) : (
              <>
                <MetricCard label="Completed" value={num(s.completed)} sub={`${pct(s.completionRate)} of those taking part`} />
                <MetricCard label="Average progress" value={pct(s.averageProgress)} sub="Toward the target" />
              </>
            )}
            <MetricCard label="Eligible" value={num(s.eligible)} sub={eligibilityText(c.eligibility, scope, staff, isOrg(apiScope))} />
          </div>
        )}

        {p?.byDepartment && p.byDepartment.length > 0 && (
          <Card>
            <CardHeader><span className="text-sm font-semibold">By {wordsFor(isOrg(apiScope)).unit}</span></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="department-table">
                  <thead><tr className="text-left text-xs text-[var(--color-fg-quaternary)]">
                    <th className="py-2 font-medium">{wordsFor(isOrg(apiScope)).Unit}</th>
                    <th className="py-2 text-right font-medium">Taking part</th>
                    <th className="py-2 text-right font-medium">Completed</th>
                    <th className="py-2 text-right font-medium">Avg progress</th>
                  </tr></thead>
                  <tbody className="divide-y divide-[var(--color-border-secondary)]">
                    {p.byDepartment.map((d, i) => (
                      <tr key={i}>
                        <td className="py-2">{d.other ? `Smaller groups (under ${p.minGroupSize ?? 3})` : d.department}</td>
                        <td className="py-2 text-right tabular-nums">{num(d.joined)} of {num(d.eligible)} ({pct(d.participationRate)})</td>
                        <td className="py-2 text-right tabular-nums">{d.completed == null ? '—' : num(d.completed)}</td>
                        <td className="py-2 text-right tabular-nums">{d.averageProgress == null ? '—' : pct(d.averageProgress)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">
                Progress and completion show only for groups of {p.minGroupSize ?? 3} or more taking part, so the table stays readable. Each person’s progress is under Insights.
              </p>
            </CardContent>
          </Card>
        )}

        {teamed && standings && (
          <Card>
            <CardHeader><span className="text-sm font-semibold">Team standings</span></CardHeader>
            <CardContent>
              {standings.teams.length === 0 ? (
                <p className="text-sm text-[var(--color-fg-quaternary)]">Standings appear once a team has {standings.minTeamSize} members.</p>
              ) : (
                <ol className="space-y-2" data-testid="team-standings">
                  {standings.teams.map(t => (
                    <li key={t.teamId} className="flex items-center justify-between text-sm">
                      <span><span className="mr-2 font-semibold tabular-nums">{t.rank}</span>{t.name} · {t.members} members</span>
                      <span className="tabular-nums">{pct(t.averageCompletion)}</span>
                    </li>
                  ))}
                </ol>
              )}
              {standings.hiddenTeams > 0 && (
                <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">{standings.hiddenTeams} smaller {standings.hiddenTeams === 1 ? 'team is' : 'teams are'} hidden until they reach {standings.minTeamSize} members.</p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-[var(--color-fg-tertiary)]">Rewards</p>
            {rewardItemsOf(c).length === 0 ? <p className="text-sm">None</p> : (
              <ul className="space-y-1 text-sm" data-testid="challenge-reward-list">
                {rewardItemsOf(c).map(r => (
                  <li key={r.id}>
                    <span className="font-medium">{r.label}</span>
                    <span className="text-[var(--color-fg-quaternary)]"> · {typeLabel(r.type)}{r.value ? ` · ${r.value}` : ''} · {ruleLabel(r)}</span>
                  </li>
                ))}
              </ul>
            )}
            {c.rewards.length > 0 && c.rewardFunding && (
              <p className="text-xs text-[var(--color-fg-quaternary)]">Funded by {c.rewardFunding === 'company' ? wordsFor(isOrg(apiScope)).owner : FUNDERS[scope].find(f => f.value === c.rewardFunding)?.label ?? c.rewardFunding}</p>
            )}
            {rewardCounts && rewardItemsOf(c).length > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" data-testid="challenge-reward-counts">
                {(['pending', 'approved', 'issued', 'rejected'] as const).filter(k => rewardCounts[k] > 0).map(k => (
                  <Badge key={k} tone={STATUS[k].tone}>{rewardCounts[k]} {STATUS[k].label.toLowerCase()}</Badge>
                ))}
                {Object.values(rewardCounts).every(n => n === 0) && <span className="text-[var(--color-fg-quaternary)]">Nobody has earned one yet.</span>}
                {Object.values(rewardCounts).some(n => n > 0) && (
                  <Link className="font-medium text-[var(--color-fg-brand)] underline-offset-2 hover:underline" href={`${rewardsBase}?challengeId=${encodeURIComponent(c.id)}`}>Hand out rewards</Link>
                )}
              </p>
            )}
            {!rewardCounts && rewardItemsOf(c).length > 0 && c.rewardFunding && !handledHere(scope, c) && (
              <p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">FitFlex hands these out.</p>
            )}
          </div>
          {c.description && (
            <div>
              <p className="text-xs font-medium text-[var(--color-fg-tertiary)]">Description</p>
              <p className="text-sm">{c.description}</p>
            </div>
          )}
        </div>

        <p className="flex items-start gap-2 text-xs text-[var(--color-fg-quaternary)]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {scope === 'admin'
            ? 'You see totals only: who is taking part, completion and average progress. Individual activity, workouts and health information are never shown here.'
            : 'This page shows totals: who is taking part, completion and average progress. Each person’s progress is under Insights.'}
        </p>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          {(running || upcoming) && <Button variant="secondary" onClick={onEdit} data-testid="challenge-edit">Edit</Button>}
          {running && <Button variant="secondary" disabled={busy} onClick={() => act('close', 'End this challenge today? Results so far are kept.')} data-testid="challenge-close">Close now</Button>}
          {(running || upcoming) && <Button variant="secondary" disabled={busy} onClick={() => act('cancel', 'Cancel this challenge? It disappears for members.')} data-testid="challenge-cancel">Cancel</Button>}
          {over && <Button variant="secondary" disabled={busy} onClick={() => act('archive', 'Archive this challenge? It stays in the history of those who took part.')} data-testid="challenge-archive">Archive</Button>}
        </div>
      </div>
    </Dialog>
  );
}

// ── Create / edit ─────────────────────────────────────────────────────────

const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

function ChallengeForm({ scope, apiScope, staff, existing, onClose, onSaved }: {
  scope: ChallengeScope; apiScope: ChallengeApiScope; rewardsBase: string; staff: CorporateEmployee[]; existing: ManagedChallenge | null;
  onClose: () => void; onSaved: (c: ManagedChallenge) => Promise<void>;
}) {
  const org = isOrg(apiScope);
  const w = wordsFor(org);
  const { token } = useApp();
  const started = !!existing && existing.phase !== 'upcoming';
  const locked = !!existing && (started || existing.participantCount > 0);
  const [f, setF] = useState(() => ({
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    type: existing?.type ?? 'steps' as ChallengeType,
    target: existing ? String(existing.target) : '50000',
    startDate: existing?.startDate ?? today(),
    endDate: existing?.endDate ?? today(),
    mode: existing?.mode ?? 'individual' as ChallengeMode,
    teams: '',
    rewards: rewardItemsOf(existing).map(r => ({ ...r })) as RewardItemInput[],
    rewardFunding: (existing?.rewardFunding ?? FUNDERS[scope][0].value) as RewardFunding,
    eligKind: (existing?.eligibility?.kind ?? 'all') as Eligibility['kind'],
    tiers: existing?.eligibility?.kind === 'tiers' ? existing.eligibility.tiers : [] as string[],
    departments: existing?.eligibility?.kind === 'departments' ? existing.eligibility.departments : [] as string[],
    employeeIds: existing?.eligibility?.kind === 'employees' ? existing.eligibility.employeeIds : [] as string[],
  }));
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const toggle = (k: 'tiers' | 'departments' | 'employeeIds', v: string) =>
    setF(x => ({ ...x, [k]: x[k].includes(v) ? x[k].filter(y => y !== v) : [...x[k], v] }));

  const active = staff.filter(e => e.status === 'active' || e.status === 'pending');
  const departments = [...new Set(active.map(e => e.department).filter(Boolean) as string[])].sort();
  const people = active.filter(e => !search || `${e.displayName} ${e.department ?? ''} ${e.email ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  const eligibility = (): Eligibility => {
    if (f.eligKind === 'tiers') return { kind: 'tiers', tiers: f.tiers };
    if (f.eligKind === 'departments') return { kind: 'departments', departments: f.departments };
    if (f.eligKind === 'employees') return { kind: 'employees', employeeIds: f.employeeIds };
    return { kind: 'all' };
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const rewardItems = f.rewards
      .map(r => ({ ...r, label: r.label.trim(), value: r.value?.trim() || null, topN: r.rule === 'top' ? Number(r.topN) || null : null }))
      .filter(r => r.label);
    const body: ChallengeInput = {
      name: f.name.trim(), description: f.description.trim() || null, type: f.type,
      target: Number(f.target), startDate: f.startDate, endDate: f.endDate, rewardItems,
      rewardFunding: f.rewardFunding, eligibility: eligibility(), mode: f.mode,
      ...(!existing && f.mode === 'teams' ? { teams: f.teams.split(',').map(t => t.trim()).filter(Boolean) } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      const r = existing
        ? await api.updateChallenge(token, apiScope, existing.id, locked ? { ...body, type: undefined, mode: undefined, ...(started ? { startDate: undefined } : {}) } : body)
        : await api.createChallenge(token, apiScope, body);
      await onSaved(r.challenge);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={existing ? 'Edit challenge' : 'New challenge'} size="lg">
      <form onSubmit={save} className="space-y-4" data-testid="challenge-form">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          <input className="ui-input" value={f.name} onChange={e => set('name', e.target.value)} maxLength={80} required
            placeholder={scope === 'admin' ? 'FitFlex 50K Steps Challenge' : org ? 'Wellness Challenge' : 'Company Wellness Challenge'} data-testid="challenge-name" />
        </Field>
        <Field label="Description (optional)">
          <textarea className="ui-input" rows={2} value={f.description} onChange={e => set('description', e.target.value)} maxLength={500} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Measures">
            <select className="ui-input" value={f.type} disabled={locked} onChange={e => set('type', e.target.value as ChallengeType)} data-testid="challenge-type">
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label={`Target (${unitFor(f.type)})`}>
            <input className="ui-input" type="number" min={1} step="any" value={f.target} onChange={e => set('target', e.target.value)} required data-testid="challenge-target" />
          </Field>
          <Field label="Starts">
            <input className="ui-input" type="date" value={f.startDate} disabled={started} onChange={e => set('startDate', e.target.value)} required data-testid="challenge-start" />
          </Field>
          <Field label="Ends">
            <input className="ui-input" type="date" value={f.endDate} onChange={e => set('endDate', e.target.value)} required data-testid="challenge-end" />
          </Field>
        </div>
        {locked && <p className="text-xs text-[var(--color-fg-quaternary)]">What it measures{started ? ', its format and its start date' : ' and its format'} are fixed now that it has {started ? 'started' : 'participants'}.</p>}

        <Field label="Format">
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES[scope].map(m => (org ? { ...m, label: m.value === 'department' ? 'Groups' : m.label, hint: m.hint.replace('employees pick', 'people pick').replace('Each employee represents their department', 'Each person represents their group') } : m)).map(m => (
              <label key={m.value} className={`cursor-pointer rounded-[var(--radius-lg)] border p-3 text-sm ${f.mode === m.value ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)]' : 'border-[var(--color-border-primary)]'} ${locked ? 'opacity-60' : ''}`}>
                <input type="radio" className="sr-only" name="mode" aria-label={m.label} disabled={locked} checked={f.mode === m.value} onChange={() => set('mode', m.value)} />
                <span className="font-medium">{m.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-fg-quaternary)]">{m.hint}</span>
              </label>
            ))}
          </div>
        </Field>
        {!existing && f.mode === 'teams' && (
          <Field label="Team names (comma separated)">
            <input className="ui-input" value={f.teams} onChange={e => set('teams', e.target.value)} placeholder="Red, Blue, Green" data-testid="challenge-teams" />
          </Field>
        )}

        <Field label="Who can join">
          <div className="space-y-2" data-testid="challenge-eligibility">
            {(scope === 'admin'
              ? [['all', 'All FitFlex members'], ['tiers', 'Members on chosen passes']]
              : [['all', org ? 'Everyone' : 'All employees'], ['departments', `Chosen ${w.units}`], ['employees', `Chosen ${w.people}`]]
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="radio" name="elig" aria-label={label} checked={f.eligKind === k} onChange={() => set('eligKind', k as Eligibility['kind'])} data-testid={`elig-${k}`} />
                {label}
              </label>
            ))}
            {f.eligKind === 'tiers' && (
              <div className="flex flex-wrap gap-3 pl-6">
                {TIERS.map(t => (
                  <label key={t.value} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" aria-label={t.label} checked={f.tiers.includes(t.value)} onChange={() => toggle('tiers', t.value)} data-testid={`tier-${t.value}`} />{t.label}
                  </label>
                ))}
              </div>
            )}
            {f.eligKind === 'departments' && (
              <div className="flex flex-wrap gap-3 pl-6">
                {departments.length === 0 && <p className="text-xs text-[var(--color-fg-quaternary)]">No {w.units} on your {w.list} yet.</p>}
                {departments.map(d => (
                  <label key={d} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" aria-label={d} checked={f.departments.includes(d)} onChange={() => toggle('departments', d)} data-testid={`dept-${d}`} />{d}
                  </label>
                ))}
              </div>
            )}
            {f.eligKind === 'employees' && (
              <div className="space-y-2 pl-6">
                <input className="ui-input" aria-label={`Search ${w.people}`} placeholder={`Search ${w.people}`} value={search} onChange={e => setSearch(e.target.value)} />
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-secondary)] p-2">
                  {people.map(p => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" aria-label={p.displayName} checked={f.employeeIds.includes(p.id)} onChange={() => toggle('employeeIds', p.id)} />
                      {p.displayName}{p.department ? <span className="text-xs text-[var(--color-fg-quaternary)]">· {p.department}</span> : null}
                    </label>
                  ))}
                  {people.length === 0 && <p className="text-xs text-[var(--color-fg-quaternary)]">No matching {w.people}.</p>}
                </div>
                <p className="text-xs text-[var(--color-fg-quaternary)]">{f.employeeIds.length} chosen</p>
              </div>
            )}
          </div>
        </Field>

        <RewardEditor items={f.rewards} teamsOk={f.mode !== 'individual'} onChange={v => set('rewards', v)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rewards funded by">
            <select className="ui-input" value={f.rewardFunding} onChange={e => set('rewardFunding', e.target.value as RewardFunding)} data-testid="challenge-funding">
              {FUNDERS[scope].map(x => <option key={x.value} value={x.value}>{x.value === 'company' ? w.owner : x.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} data-testid="challenge-save">{existing ? 'Save changes' : 'Create challenge'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
