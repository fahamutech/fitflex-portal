'use client';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import {
  Activity, CalendarCheck, Dumbbell, Flame, Target, Trophy, UserCheck, Building2, RefreshCw, Lock,
} from 'lucide-react';
import { useApp } from '../../providers';
import { api, AnalyticsOverview, Rate, WorkoutTally, ApiError } from '@/lib/api';
import {
  MetricCard, Card, CardHeader, CardContent, Button, PageHeader, Alert, Spinner,
} from '@/components/shared';

const BRAND = '#079455';
const GRID  = 'var(--color-border-secondary)';
const INK   = 'var(--color-fg-quaternary)';
const RANGES = [7, 30, 90] as const;
const CREATOR: Record<string, string> = { fitflex: 'FitFlex', gym: 'gyms', trainer: 'trainers', corporate: 'companies' };

/** Member-local (EAT, UTC+3) calendar day, n days before today. */
function eatDay(daysAgo = 0): string {
  return new Date(Date.now() + 3 * 3600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
}
const pct = (r: Rate) => (r == null ? '—' : `${Math.round(r * 100)}%`);
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function AdminAnalyticsPage() {
  const { token, user, hasPermission } = useApp();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const allowed = user?.userType === 'admin' && hasPermission('analytics');

  const load = async () => {
    if (!token || !allowed) return;
    setLoading(true);
    try {
      setData(await api.adminAnalytics(token, eatDay(days - 1), eatDay()));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'You don’t have access to analytics.' : 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, allowed, days]);

  if (!token || user?.userType !== 'admin') return null;
  if (!allowed) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center text-[var(--color-fg-tertiary)]">
        <Lock className="h-6 w-6" />
        <p className="text-sm">Analytics needs the Analytics permission.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Internal engagement metrics. Aggregates only, for FitFlex staff. Never shown to members, trainers or gyms."
        actions={
          <>
            <div role="group" aria-label="Period" className="inline-flex rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] p-0.5">
              {RANGES.map(r => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  aria-pressed={days === r}
                  className={`rounded-[var(--radius-md)] px-3 py-1 text-sm font-medium ${days === r ? 'bg-[var(--color-brand-600)] text-white' : 'text-[var(--color-fg-tertiary)]'}`}
                >
                  {r} days
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {!data ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Overview d={data} />
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg-secondary)]">
        <span className="text-[var(--color-fg-brand)]">{icon}</span>{title}
      </h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-[var(--color-border-secondary)] text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-[var(--color-fg-tertiary)]">{k}</dt>
          <dd className="font-medium tabular-nums text-[var(--color-fg-primary)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const tallyText = (t: WorkoutTally) => `${pct(t.completionRate)} · ${t.completed} of ${t.due}`;

function Overview({ d }: { d: AnalyticsOverview }) {
  const { dailyActive: da, activityLogging: al, workouts: w, challenges: c, streaks: s, goals: g, trainers: t, gyms: gy } = d;
  const origin = al.byOrigin;
  const originTotal = origin.device + origin.fitflex + origin.manual;
  const streakData = s.distributionAtEnd.map(b => ({
    name: b.to == null ? `${b.from}+ days` : b.from === b.to ? `${b.from} days` : `${b.from}–${b.to} days`,
    members: b.members,
  }));

  return (
    <div className="space-y-8">
      <p className="text-xs text-[var(--color-fg-quaternary)]">
        {shortDay(d.period.from)} – {shortDay(d.period.to)} ({d.period.days} days, East Africa Time) · {num(d.members)} members
      </p>

      <Section title="Daily active members" icon={<Activity className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Average daily active" value={num(da.averageDaily)} sub={`of ${num(d.members)} members`} />
          <MetricCard label="Active in period" value={num(da.activeInPeriod)} sub={pct(d.members ? da.activeInPeriod / d.members : null) + ' of members'} />
          <MetricCard label="Active in last 7 days" value={num(da.activeLast7Days)} />
          <MetricCard label="Stickiness" value={pct(da.stickiness)} sub="Daily ÷ period actives" />
        </div>
        <Card>
          <CardHeader><span className="text-sm font-semibold">Active members per day</span></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={da.series} margin={{ left: -16, right: 8 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={v => shortDay(String(v))} formatter={v => [v, 'Active members']} />
                <Area type="monotone" dataKey="members" stroke={BRAND} strokeWidth={2} fill={BRAND} fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">
              Active means the member logged an activity, completed a workout or checked in at a gym that day. App opens aren’t tracked.
            </p>
          </CardContent>
        </Card>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Activity logging" icon={<CalendarCheck className="h-4 w-4" />}>
          <Card><CardContent className="pt-4">
            <Rows rows={[
              ['Members logging', `${num(al.membersLogging)} (${pct(al.loggingRate)})`],
              ['Activities logged', num(al.activities)],
              ['Per logging member', num(al.perLoggingMember)],
            ]} />
            <p className="mt-4 mb-2 text-xs font-medium text-[var(--color-fg-tertiary)]">Where the data came from</p>
            {originTotal === 0 ? (
              <p className="text-sm text-[var(--color-fg-quaternary)]">No activities in this period.</p>
            ) : (
              <Rows rows={[
                ['Device', `${num(origin.device)} (${pct(origin.device / originTotal)})`],
                ['FitFlex', `${num(origin.fitflex)} (${pct(origin.fitflex / originTotal)})`],
                ['Manual', `${num(origin.manual)} (${pct(origin.manual / originTotal)})`],
              ]} />
            )}
          </CardContent></Card>
        </Section>

        <Section title="Workout completion" icon={<Dumbbell className="h-4 w-4" />}>
          <Card><CardContent className="pt-4">
            <Rows rows={[
              ['Completion rate', `${pct(w.completionRate)} of ${num(w.due)} due`],
              ['Completed · skipped · missed', `${num(w.completed)} · ${num(w.skipped)} · ${num(w.missed)}`],
              ['Trainer-assigned', tallyText(w.trainerAssigned)],
              ['Self-planned', tallyText(w.selfPlanned)],
              ['Completed in period', num(w.completedInPeriod)],
            ]} />
            <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">Due means scheduled in the period for a day that has passed.</p>
          </CardContent></Card>
        </Section>

        <Section title="Challenge participation" icon={<Trophy className="h-4 w-4" />}>
          <Card><CardContent className="pt-4">
            <Rows rows={[
              ['Challenges running', `${num(c.running)}${Object.keys(c.byCreator).length ? ` (${Object.entries(c.byCreator).map(([k, v]) => `${v} by ${CREATOR[k] ?? k}`).join(', ')})` : ''}`],
              ['Members taking part', `${num(c.participants)} (${pct(c.participationRate)})`],
              ['Joins in period', num(c.joinsInPeriod)],
              ['Finished: reached the target', `${pct(c.completionRate)} of ${num(c.finishedEntries)}`],
              ['Leaderboard opt-in', pct(c.leaderboardOptInRate)],
            ]} />
          </CardContent></Card>
        </Section>

        <Section title="Goal completion" icon={<Target className="h-4 w-4" />}>
          <Card><CardContent className="pt-4">
            <Rows rows={[
              ['Goal periods met', `${pct(g.completionRate)} · ${num(g.periodsMet)} of ${num(g.periodsEvaluated)}`],
              ['Members with goals', num(g.membersWithGoals)],
              ...Object.entries(g.byPeriod).map(([k, v]) => [`${k[0].toUpperCase()}${k.slice(1)} goals`, `${pct(v.completionRate)} of ${num(v.evaluated)}`] as [string, string]),
            ]} />
            <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">Each whole day, week or month a goal covered that ended in the period.</p>
          </CardContent></Card>
        </Section>
      </div>

      <Section title="Streak retention" icon={<Flame className="h-4 w-4" />}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><span className="text-sm font-semibold">Activity streak at period end (active members)</span></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={streakData} margin={{ left: -16, right: 8 }} barSize={36}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={v => [v, 'Members']} />
                  <Bar dataKey="members" fill={BRAND} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card><CardContent className="pt-4">
            <Rows rows={[
              ['On a 3+ day streak at start', num(s.onStreakAtStart)],
              ['Kept it unbroken', `${num(s.unbrokenThroughPeriod)} (${pct(s.streakRetention)})`],
            ]} />
            <p className="mt-4 mb-2 text-xs font-medium text-[var(--color-fg-tertiary)]">Week-over-week retention</p>
            {s.weeklyRetention.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-quaternary)]">Needs two whole weeks in the period.</p>
            ) : (
              <Rows rows={s.weeklyRetention.map(r => [`Week of ${shortDay(r.week)}`, `${pct(r.retention)} of ${num(r.active)}`] as [string, string])} />
            )}
          </CardContent></Card>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Trainer engagement" icon={<UserCheck className="h-4 w-4" />}>
          <Card><CardContent className="pt-4">
            <Rows rows={[
              ['Active trainer–client connections', num(t.activeConnections)],
              ['Trainers with clients', num(t.trainersWithClients)],
              ['Requests in period', `${num(t.requests)} (${num(t.accepted)} accepted, ${num(t.declined)} declined, ${num(t.pending)} pending)`],
              ['Acceptance rate', pct(t.acceptanceRate)],
              ['Clients sharing any data', num(t.clientsSharingData)],
              ['Workouts assigned', `${num(t.workoutsAssigned)} by ${num(t.trainersAssigning)} ${t.trainersAssigning === 1 ? 'trainer' : 'trainers'}`],
              ['Assigned workouts completed', pct(t.assignedCompletionRate)],
            ]} />
          </CardContent></Card>
        </Section>

        <Section title="Gym engagement" icon={<Building2 className="h-4 w-4" />}>
          <Card><CardContent className="pt-4">
            <Rows rows={[
              ['Check-ins', num(gy.checkins)],
              ['Members visiting', `${num(gy.membersVisiting)} (${pct(gy.visitRate)})`],
              ['Visits per visiting member', num(gy.visitsPerVisitingMember)],
              ['Gyms visited', num(gy.gymsVisited)],
              ['Gym challenges', `${num(gy.gymChallenges)} · ${num(gy.gymChallengeParticipants)} members`],
              ['Members sharing data with a gym', num(gy.membersSharingWithGyms)],
            ]} />
          </CardContent></Card>
        </Section>
      </div>

      {gy.topGyms.length > 0 && (
        <Card>
          <CardHeader><span className="text-sm font-semibold">Most visited gyms</span></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--color-fg-quaternary)]">
                    <th className="py-2 font-medium">Gym</th>
                    <th className="py-2 text-right font-medium">Check-ins</th>
                    <th className="py-2 text-right font-medium">Members</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {gy.topGyms.map(r => (
                    <tr key={r.gymId}>
                      <td className="py-2 text-[var(--color-fg-primary)]">{r.name ?? r.gymId}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.checkins)}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.members)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-[var(--color-fg-quaternary)]">
        Generated {new Date(d.generatedAt).toLocaleString('en-GB')}. Counts only: no member names or individual activity are included.
      </p>
    </div>
  );
}
