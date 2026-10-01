'use client';
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import {
  api, Gym, GymRateCard, PassTierVersion, SettlementConfig, SettlementConfigKind, SettlementConfigStatus,
  SettlementRule, SettlementRuleScope, SettlementRuleValues,
} from '@/lib/api';
import { BadgeTone, money } from '@/lib/admin-utils';
import { PASS_TIER_KEYS, SETTLED_GYM_TIERS, configError, percent, shortDay, tierLabel, todayEAT, wholesale } from '@/lib/settlements';
import { Alert, Badge, Button, Card, CardContent, Field, Input, PageHeader, Segmented, Spinner } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';

type Tab = 'rate-cards' | 'rules' | 'pass-tiers';
type Row = { id: string; status: SettlementConfigStatus; effectiveFrom: string | null; effectiveTo: string | null; createdBy: string | null; reason: string | null };
type Ask =
  | { kind: 'activate' | 'reject'; of: SettlementConfigKind; row: Row; label: string }
  | { kind: 'new'; of: SettlementConfigKind };

const th = 'px-4 py-2.5 font-medium';
const td = 'px-4 py-3';

/** Draft, in force, replaced or rejected — and from when. */
function standing(row: Row, today: string): { label: string; tone: BadgeTone; when: string } {
  if (row.status === 'draft') return { label: 'Draft', tone: 'warning', when: 'Waiting for a second admin' };
  if (row.status === 'rejected') return { label: 'Rejected', tone: 'danger', when: row.reason || '' };
  if (row.effectiveTo && row.effectiveTo <= today) return { label: 'Ended', tone: 'gray', when: `${shortDay(row.effectiveFrom)} – ${shortDay(row.effectiveTo)}` };
  if (row.effectiveFrom && row.effectiveFrom > today) return { label: 'Scheduled', tone: 'brand', when: `From ${shortDay(row.effectiveFrom)}` };
  return { label: 'In force', tone: 'success', when: `Since ${shortDay(row.effectiveFrom)}${row.effectiveTo ? ` · until ${shortDay(row.effectiveTo)}` : ''}` };
}

/**
 * Settlement rules: what gyms are paid from. Pass prices and allowances, the
 * discounts, ceilings and network share, and each gym's rate card. Nothing in
 * force is ever edited: a change is a new draft that a second admin activates
 * from a date.
 */
export default function SettlementConfigPage() {
  const { token, user } = useApp();
  const [config, setConfig] = useState<SettlementConfig | null>(null);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [tab, setTab] = useState<Tab>('rate-cards');
  const [history, setHistory] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const today = todayEAT();
  const openAsk = (a: Ask) => { setError(null); setNotice(null); setAsk(a); };

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [c, g] = await Promise.all([api.settlementConfig(token), api.adminGyms(token).catch(() => [] as Gym[])]);
      setConfig(c);
      setGyms(g);
    } catch (err) {
      setError(configError(err));
      setConfig({ passTierVersions: [], rules: [], rateCards: [] });
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const gymName = useMemo(() => {
    const names = new Map(gyms.map(g => [g.id, g.name]));
    return (id: string | null) => (id ? names.get(id) ?? id : '—');
  }, [gyms]);

  if (!token || user?.userType !== 'admin') return null;

  /** Run one change, close its dialog on success, then reload. */
  const act = async (work: (t: string) => Promise<unknown>, done: string | ((result: unknown) => string)) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await work(token);
      setAsk(null);
      setNotice(typeof done === 'string' ? done : done(result));
      await load();
    } catch (err) {
      setError(configError(err));
    } finally {
      setBusy(false);
    }
  };

  // Hide ended and rejected versions unless asked for.
  const current = <T extends Row>(rows: T[]) => rows.filter(r => history || (r.status !== 'rejected' && !(r.status === 'active' && r.effectiveTo && r.effectiveTo <= today)));
  const drafts = config ? config.passTierVersions.concat(config.rules as never[], config.rateCards as never[]).filter(r => r.status === 'draft').length : 0;

  const actions = (of: SettlementConfigKind, row: Row, label: string) => row.status !== 'draft' ? null : (
    <span className="flex justify-end gap-2">
      <Button size="sm" variant="secondary" onClick={() => openAsk({ kind: 'reject', of, row, label })} data-testid={`config-reject-${row.id}`}>Reject</Button>
      <Button size="sm" disabled={row.createdBy === user.id} title={row.createdBy === user.id ? 'You drafted this, so someone else has to activate it' : undefined}
        onClick={() => openAsk({ kind: 'activate', of, row, label })} data-testid={`config-activate-${row.id}`}>Activate</Button>
    </span>
  );
  const status = (row: Row) => {
    const s = standing(row, today);
    return <><Badge tone={s.tone}>{s.label}</Badge><p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">{s.when}</p></>;
  };
  const table = (testid: string, head: ReactNode, body: ReactNode, empty: boolean) => empty
    ? <p className="p-10 text-center text-sm text-[var(--color-fg-quaternary)]">Nothing here yet.</p>
    : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm" data-testid={testid}>
          <thead className="text-left text-xs text-[var(--color-fg-tertiary)]"><tr className="border-b border-[var(--color-border-secondary)]">{head}</tr></thead>
          <tbody className="divide-y divide-[var(--color-border-secondary)]">{body}</tbody>
        </table>
      </div>
    );

  const ruleScope = (r: SettlementRule) => r.scopeType === 'global' ? 'All gyms'
    : r.scopeType === 'gym_tier' ? `${tierLabel(r.scopeId)} gyms`
    : r.scopeType === 'pass_tier' ? `${tierLabel(r.scopeId)} pass`
    : r.scopeType === 'gym' ? gymName(r.scopeId) : 'Special contract';
  const trio = (a: number | null, b: number | null, c: number | null, fmt: (v: number | null) => string) =>
    a == null && b == null && c == null ? '—' : [a, b, c].map(v => (v == null ? '·' : fmt(v))).join(' / ');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlement rules"
        description="What gym payouts are calculated from. A change is drafted by one admin and activated from a date by another; what is in force is never edited."
        actions={<>
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>
          <Button size="sm" onClick={() => openAsk({ kind: 'new', of: tab })} data-testid="config-new"><Plus className="h-4 w-4" />
            {tab === 'rate-cards' ? 'New rate card' : tab === 'rules' ? 'New rule' : 'New pass version'}
          </Button>
        </>}
      />
      {error && !ask && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {drafts > 0 && <Alert tone="info">{drafts} {drafts === 1 ? 'draft is' : 'drafts are'} waiting to be activated or rejected.</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={tab} onChange={v => setTab(v as Tab)} options={[['rate-cards', 'Gym rate cards'], ['rules', 'Discounts, ceilings and network share'], ['pass-tiers', 'Passes']]} />
        <label className="flex items-center gap-2 text-sm text-[var(--color-fg-tertiary)]">
          <input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} data-testid="config-history" />
          Show ended and rejected
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          {config == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : tab === 'rate-cards' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-secondary)] px-4 py-3 text-sm text-[var(--color-fg-tertiary)]">
                A gym without a rate card in force is not paid: its visits are held until it has one.
                <Button size="sm" variant="secondary" disabled={busy} data-testid="config-draft-missing"
                  onClick={() => act(t => api.draftMissingRateCards(t), r => {
                    const { drafted, skipped } = r as { drafted: unknown[]; skipped: Array<{ gymId: string; reason: string }> };
                    const left = skipped.filter(x => x.reason === 'retail_rates_missing');
                    return `${drafted.length} rate ${drafted.length === 1 ? 'card' : 'cards'} drafted.${left.length ? ` ${left.length} skipped for missing retail rates: ${left.map(x => gymName(x.gymId)).join(', ')}.` : ''}`;
                  })}>Draft cards for gyms without one</Button>
              </div>
              {table('config-rate-cards', <>
                <th className={th}>Gym</th><th className={th}>Retail day / week / month</th><th className={th}>Paid to gym day / week / month</th><th className={th}>Status</th><th className={th} />
              </>, current<GymRateCard>(config.rateCards).map(c => (
                <tr key={c.id} data-testid={`config-row-${c.id}`}>
                  <td className={td}><span className="font-medium">{gymName(c.gymId)}</span><p className="text-xs text-[var(--color-fg-quaternary)]">{tierLabel(c.gymTier)} · v{c.version}</p></td>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{trio(c.retailDailyTzs, c.retailWeeklyTzs, c.retailMonthlyTzs, v => money(v, '').trim())}</td>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>
                    {c.status === 'active'
                      ? trio(wholesale(c.retailDailyTzs, c.dailyDiscountBps, c.dailyCeilingTzs), wholesale(c.retailWeeklyTzs, c.weeklyDiscountBps, c.weeklyCeilingTzs), wholesale(c.retailMonthlyTzs, c.monthlyDiscountBps, c.monthlyCeilingTzs), v => money(v, '').trim())
                      : <span className="text-[var(--color-fg-quaternary)]">Set when activated</span>}
                  </td>
                  <td className={td}>{status(c)}</td>
                  <td className={td}>{actions('rate-cards', c, `rate card for ${gymName(c.gymId)}`)}</td>
                </tr>
              )), current(config.rateCards).length === 0)}
            </>
          ) : tab === 'rules' ? table('config-rules', <>
            <th className={th}>Applies to</th><th className={th}>Network share</th><th className={th}>Discount day / week / month</th><th className={th}>Ceiling day / week / month</th><th className={th}>Status</th><th className={th} />
          </>, current<SettlementRule>(config.rules).map(r => (
            <tr key={r.id} data-testid={`config-row-${r.id}`}>
              <td className={td}><span className="font-medium">{ruleScope(r)}</span><p className="text-xs text-[var(--color-fg-quaternary)]">{r.name ? `${r.name} · ` : ''}v{r.version}</p></td>
              <td className={`${td} tabular-nums`}>{percent(r.networkPayoutBps)}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{trio(r.dailyDiscountBps, r.weeklyDiscountBps, r.monthlyDiscountBps, percent)}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{trio(r.dailyCeilingTzs, r.weeklyCeilingTzs, r.monthlyCeilingTzs, v => money(v, '').trim())}</td>
              <td className={td}>{status(r)}</td>
              <td className={td}>{actions('rules', r, `rule for ${ruleScope(r).toLowerCase()}`)}</td>
            </tr>
          )), current(config.rules).length === 0) : table('config-pass-tiers', <>
            <th className={th}>Pass</th><th className={`${th} text-right`}>Price</th><th className={`${th} text-right`}>Visits per cycle</th><th className={th}>Status</th><th className={th} />
          </>, current<PassTierVersion>(config.passTierVersions).map(p => (
            <tr key={p.id} data-testid={`config-row-${p.id}`}>
              <td className={td}><span className="font-medium">{tierLabel(p.tierKey)}</span><p className="text-xs text-[var(--color-fg-quaternary)]">v{p.version}</p></td>
              <td className={`${td} text-right tabular-nums`}>{money(p.priceTzs)}</td>
              <td className={`${td} text-right tabular-nums`}>{p.visitAllowance}</td>
              <td className={td}>{status(p)}</td>
              <td className={td}>{actions('pass-tiers', p, `${tierLabel(p.tierKey)} pass version`)}</td>
            </tr>
          )), current(config.passTierVersions).length === 0)}
        </CardContent>
      </Card>

      {tab === 'pass-tiers' && <p className="text-xs text-[var(--color-fg-quaternary)]">These are the prices and allowances settlement uses. The price members see and the check-in visit limit are still set in Settings.</p>}
      {tab === 'rules' && <p className="text-xs text-[var(--color-fg-quaternary)]">A gym is paid the retail rate less the discount, up to the ceiling. A rule for one gym beats its tier’s, which beats the rule for all gyms. The network share caps what all gyms together earn from one member’s payment.</p>}

      {ask?.kind === 'activate' && (
        <ActivateDialog label={ask.label} today={today} busy={busy} error={error} onClose={() => setAsk(null)}
          onSubmit={date => act(t => api.activateSettlementConfig(t, ask.of, ask.row.id, date), `Activated from ${shortDay(date)}.`)} />
      )}
      {ask?.kind === 'reject' && (
        <RejectDialog label={ask.label} busy={busy} error={error} onClose={() => setAsk(null)}
          onSubmit={reason => act(t => api.rejectSettlementConfig(t, ask.of, ask.row.id, reason), 'Draft rejected.')} />
      )}
      {ask?.kind === 'new' && ask.of === 'pass-tiers' && (
        <PassDialog busy={busy} error={error} onClose={() => setAsk(null)} onSubmit={body => act(t => api.draftPassTierVersion(t, body), 'Draft saved. Another admin has to activate it.')} />
      )}
      {ask?.kind === 'new' && ask.of === 'rate-cards' && (
        <RateCardDialog gyms={gyms} busy={busy} error={error} onClose={() => setAsk(null)} onSubmit={body => act(t => api.draftGymRateCard(t, body), 'Draft saved. Another admin has to activate it.')} />
      )}
      {ask?.kind === 'new' && ask.of === 'rules' && (
        <RuleDialog gyms={gyms} busy={busy} error={error} onClose={() => setAsk(null)} onSubmit={body => act(t => api.draftSettlementRule(t, body), 'Draft saved. Another admin has to activate it.')} />
      )}
    </div>
  );
}

const whole = (v: string) => (v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null);

function Footer({ busy, disabled, label, onClose, onSubmit, testid }: { busy: boolean; disabled: boolean; label: string; onClose: () => void; onSubmit: () => void; testid: string }) {
  return (
    <DialogFooter>
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button onClick={onSubmit} disabled={busy || disabled} data-testid={testid}>{label}</Button>
    </DialogFooter>
  );
}

function ActivateDialog({ label, today, busy, error, onClose, onSubmit }: { label: string; today: string; busy: boolean; error: string | null; onClose: () => void; onSubmit: (date: string) => void }) {
  const [date, setDate] = useState(today);
  return (
    <Dialog open onClose={onClose} title="Activate" description={`Put this ${label} in force. The version it replaces ends on the same date.`} size="sm">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="In force from" hint="East Africa Time. Visits and cycles before this date keep the earlier version.">
          <input type="date" className="ui-input" value={date} onChange={e => setDate(e.target.value)} data-testid="config-activate-date" />
        </Field>
      </div>
      <Footer busy={busy} disabled={!date} label="Activate" onClose={onClose} onSubmit={() => onSubmit(date)} testid="config-activate-submit" />
    </Dialog>
  );
}

function RejectDialog({ label, busy, error, onClose, onSubmit }: { label: string; busy: boolean; error: string | null; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open onClose={onClose} title="Reject draft" description={`Reject this ${label}. It stays on record as rejected.`} size="sm">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Reason"><textarea className="ui-input min-h-20" value={reason} onChange={e => setReason(e.target.value)} data-testid="config-reject-reason" /></Field>
      </div>
      <Footer busy={busy} disabled={!reason.trim()} label="Reject" onClose={onClose} onSubmit={() => onSubmit(reason.trim())} testid="config-reject-submit" />
    </Dialog>
  );
}

function PassDialog({ busy, error, onClose, onSubmit }: { busy: boolean; error: string | null; onClose: () => void; onSubmit: (body: { tierKey: string; priceTzs: number; visitAllowance: number; reason?: string }) => void }) {
  const [tierKey, setTierKey] = useState<string>(PASS_TIER_KEYS[0]);
  const [price, setPrice] = useState('');
  const [visits, setVisits] = useState('');
  const [reason, setReason] = useState('');
  const p = whole(price), v = whole(visits);
  return (
    <Dialog open onClose={onClose} title="New pass version" description="The price and visit allowance settlement uses for this pass from the date it is activated." size="sm">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Pass">
          <select className="ui-input" value={tierKey} onChange={e => setTierKey(e.target.value)} data-testid="config-pass-tier">
            {PASS_TIER_KEYS.map(k => <option key={k} value={k}>{tierLabel(k)}</option>)}
          </select>
        </Field>
        <Field label="Price (TZS)"><Input type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} data-testid="config-pass-price" /></Field>
        <Field label="Visits per cycle"><Input type="number" min={0} value={visits} onChange={e => setVisits(e.target.value)} data-testid="config-pass-visits" /></Field>
        <Field label="Why (optional)"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </div>
      <Footer busy={busy} disabled={p == null || v == null} label="Save draft" onClose={onClose} testid="config-new-submit"
        onSubmit={() => onSubmit({ tierKey, priceTzs: p!, visitAllowance: v!, ...(reason.trim() ? { reason: reason.trim() } : {}) })} />
    </Dialog>
  );
}

function RateCardDialog({ gyms, busy, error, onClose, onSubmit }: { gyms: Gym[]; busy: boolean; error: string | null; onClose: () => void; onSubmit: (body: { gymId: string; retailDailyTzs: number; retailWeeklyTzs: number; retailMonthlyTzs: number; reason?: string }) => void }) {
  const [gymId, setGymId] = useState('');
  const [rates, setRates] = useState({ day: '', week: '', month: '' });
  const [reason, setReason] = useState('');
  const pick = (id: string) => {
    setGymId(id);
    const g = gyms.find(x => x.id === id);
    // Start from the gym's own listed rates.
    if (g) setRates({ day: String(g.ratePerDay ?? ''), week: String(g.ratePerWeek ?? ''), month: String(g.ratePerMonth ?? '') });
  };
  const d = whole(rates.day), w = whole(rates.week), m = whole(rates.month);
  return (
    <Dialog open onClose={onClose} title="New rate card" description="The gym’s own retail rates. The discounts and ceilings in force are applied when the card is activated.">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Gym">
          <select className="ui-input" value={gymId} onChange={e => pick(e.target.value)} data-testid="config-card-gym">
            <option value="">Choose a gym</option>
            {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Retail per day (TZS)"><Input type="number" min={0} value={rates.day} onChange={e => setRates({ ...rates, day: e.target.value })} data-testid="config-card-day" /></Field>
          <Field label="Per week (TZS)"><Input type="number" min={0} value={rates.week} onChange={e => setRates({ ...rates, week: e.target.value })} /></Field>
          <Field label="Per month (TZS)"><Input type="number" min={0} value={rates.month} onChange={e => setRates({ ...rates, month: e.target.value })} /></Field>
        </div>
        <Field label="Why (optional)"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </div>
      <Footer busy={busy} disabled={!gymId || d == null || w == null || m == null} label="Save draft" onClose={onClose} testid="config-new-submit"
        onSubmit={() => onSubmit({ gymId, retailDailyTzs: d!, retailWeeklyTzs: w!, retailMonthlyTzs: m!, ...(reason.trim() ? { reason: reason.trim() } : {}) })} />
    </Dialog>
  );
}

const EMPTY_RULE = { network: '', dDay: '', dWeek: '', dMonth: '', cDay: '', cWeek: '', cMonth: '' };

function RuleDialog({ gyms, busy, error, onClose, onSubmit }: {
  gyms: Gym[]; busy: boolean; error: string | null; onClose: () => void;
  onSubmit: (body: Partial<SettlementRuleValues> & { scopeType: SettlementRuleScope; scopeId: string | null; reason?: string }) => void;
}) {
  const [scopeType, setScopeType] = useState<SettlementRuleScope>('gym');
  const [scopeId, setScopeId] = useState('');
  const [v, setV] = useState(EMPTY_RULE);
  const [reason, setReason] = useState('');
  const set = (k: keyof typeof EMPTY_RULE) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  // Percentages are typed as "25" and stored as basis points.
  const bps = (s: string) => (s.trim() === '' ? undefined : Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 100 ? Math.round(Number(s) * 100) : NaN);
  const tzs = (s: string) => (s.trim() === '' ? undefined : whole(s) ?? NaN);
  const network = scopeType === 'global' || scopeType === 'pass_tier';
  const reimbursement = scopeType !== 'pass_tier';
  const values: Record<string, number | undefined> = {
    ...(network ? { networkPayoutBps: bps(v.network) } : {}),
    ...(reimbursement ? {
      dailyDiscountBps: bps(v.dDay), weeklyDiscountBps: bps(v.dWeek), monthlyDiscountBps: bps(v.dMonth),
      dailyCeilingTzs: tzs(v.cDay), weeklyCeilingTzs: tzs(v.cWeek), monthlyCeilingTzs: tzs(v.cMonth),
    } : {}),
  };
  const filled = Object.fromEntries(Object.entries(values).filter(([, x]) => x !== undefined)) as Record<string, number>;
  const valid = Object.keys(filled).length > 0 && Object.values(filled).every(x => !Number.isNaN(x)) && (scopeType === 'global' || !!scopeId);

  return (
    <Dialog open onClose={onClose} title="New rule" description="Leave a value empty to keep what the wider rule says." size="lg">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Applies to">
            <select className="ui-input" value={scopeType} onChange={e => { setScopeType(e.target.value as SettlementRuleScope); setScopeId(''); }} data-testid="config-rule-scope">
              <option value="gym">One gym</option>
              <option value="gym_tier">A gym tier</option>
              <option value="global">All gyms</option>
              <option value="pass_tier">A pass (network share only)</option>
            </select>
          </Field>
          {scopeType !== 'global' && (
            <Field label={scopeType === 'gym' ? 'Gym' : scopeType === 'gym_tier' ? 'Gym tier' : 'Pass'}>
              <select className="ui-input" value={scopeId} onChange={e => setScopeId(e.target.value)} data-testid="config-rule-target">
                <option value="">Choose</option>
                {scopeType === 'gym' ? gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)
                  : (scopeType === 'gym_tier' ? SETTLED_GYM_TIERS : PASS_TIER_KEYS).map(k => <option key={k} value={k}>{tierLabel(k)}</option>)}
              </select>
            </Field>
          )}
        </div>
        {network && (
          <Field label="Network share (%)" hint="The most all gyms together can earn from one member’s payment.">
            <Input type="number" min={0} max={100} value={v.network} onChange={set('network')} data-testid="config-rule-network" />
          </Field>
        )}
        {reimbursement && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Daily discount (%)"><Input type="number" min={0} max={100} value={v.dDay} onChange={set('dDay')} /></Field>
              <Field label="Weekly discount (%)"><Input type="number" min={0} max={100} value={v.dWeek} onChange={set('dWeek')} /></Field>
              <Field label="Monthly discount (%)"><Input type="number" min={0} max={100} value={v.dMonth} onChange={set('dMonth')} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Daily ceiling (TZS)"><Input type="number" min={0} value={v.cDay} onChange={set('cDay')} /></Field>
              <Field label="Weekly ceiling (TZS)"><Input type="number" min={0} value={v.cWeek} onChange={set('cWeek')} /></Field>
              <Field label="Monthly ceiling (TZS)"><Input type="number" min={0} value={v.cMonth} onChange={set('cMonth')} data-testid="config-rule-ceiling-month" /></Field>
            </div>
          </>
        )}
        <Field label="Why (optional)"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </div>
      <Footer busy={busy} disabled={!valid} label="Save draft" onClose={onClose} testid="config-new-submit"
        onSubmit={() => onSubmit({ scopeType, scopeId: scopeType === 'global' ? null : scopeId, ...filled, ...(reason.trim() ? { reason: reason.trim() } : {}) })} />
    </Dialog>
  );
}
