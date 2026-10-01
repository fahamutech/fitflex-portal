'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, Gift, Pencil, Plus, Users } from 'lucide-react';
import {
  api, ApiError, B2BBeneficiary, B2BBenefit, B2BBenefitInput, B2BEligibilityRow, B2BOrganization,
  B2BProgram, B2BProgramInput, B2BProgramReference, B2BProgramUsage, B2BProviderRules,
} from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, Spinner } from '@/components/shared';

const ERRORS: Record<string, string> = {
  name_required: 'Enter a name.',
  invalid_start_date: 'Enter a valid start date.',
  invalid_end_date: 'Enter a valid end date.',
  end_before_start: 'The end date is before the start date.',
  ends_in_past: 'The end date has already passed.',
  eligibility_groups_required: 'Choose at least one group.',
  eligibility_beneficiaries_required: 'Choose at least one beneficiary.',
  unknown_beneficiaries: 'Some selected beneficiaries aren’t in this organisation.',
  organization_not_active: 'Activate the organisation first.',
  program_live: 'A live programme only takes a new name, description, later end date or bigger budget.',
  cannot_shorten_live_program: 'A live programme can’t end earlier.',
  cannot_reduce_live_budget: 'A live programme’s budget can’t go down.',
  program_closed: 'This programme has ended or was cancelled.',
  benefit_outside_program: 'Benefit dates must sit inside the programme dates.',
  no_active_benefits: 'Activate at least one benefit first.',
  invalid_transition: 'That status change isn’t allowed now.',
  invalid_sponsor_amount: 'Enter the sponsor amount in whole TZS.',
  invalid_sponsor_share: 'The sponsor share must be between 0% and 100%.',
  invalid_sponsor_cap: 'Enter the cap in whole TZS.',
  invalid_beneficiary_amount: 'Enter the copay in whole TZS.',
  invalid_usage_limit: 'The usage limit must be a whole number above zero.',
  unlimited_has_no_limits: 'Unlimited benefits have no count or money limit.',
  no_sponsor_money_to_cap: 'A benefit with no money involved can’t have a money cap.',
  unknown_providers: 'Some provider IDs don’t exist (or the challenge isn’t this organisation’s).',
  provider_rules_empty: 'Choose at least one provider, or allow all.',
  invalid_gym_tier: 'Unknown gym tier.',
  benefit_live: 'An active benefit in a live programme only takes new wording. Deactivate it to change the rest.',
  last_active_benefit: 'A live programme needs at least one active benefit. Pause the programme instead.',
  benefit_ended: 'This benefit’s dates have passed.',
  remark_required: 'Say why the programme is being resumed.',
  budget_still_exhausted: 'The budget is fully spent. Raise it (Edit) before resuming.',
};
const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? ERRORS[(err.body as { error?: string })?.error ?? ''] ?? fallback : fallback;

const TONE: Record<string, 'success' | 'warning' | 'gray' | 'danger' | 'brand'> = {
  active: 'success', pending: 'warning', draft: 'gray', paused: 'warning', expired: 'gray', cancelled: 'danger', inactive: 'gray',
};
const MOVE_LABEL: Record<string, string> = {
  pending: 'Submit for activation', draft: 'Back to draft', active: 'Activate', paused: 'Pause', cancelled: 'Cancel programme',
};
const GYM_TIERS = ['standard', 'midtier', 'premium', 'luxury_executive', 'online'];
const tzs = (n?: number | null) => (n == null ? '—' : `TZS ${n.toLocaleString('en-US')}`);
const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
const intOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

function usageText(b: B2BBenefit) {
  if (b.usagePeriod === 'unlimited') return 'Unlimited';
  const per = b.usagePeriod === 'program' ? 'for the programme' : `per ${b.usagePeriod}`;
  const parts = [b.usageLimit != null ? `${b.usageLimit} uses ${per}` : null,
    b.periodSponsorCapTzs != null ? `sponsor max ${tzs(b.periodSponsorCapTzs)} ${per}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : `No limit ${per}`;
}
function providerText(r: B2BProviderRules) {
  if (r.scope === 'all') return 'All eligible providers';
  const names: Record<string, string> = { gymIds: 'gyms', gymTiers: 'gym tiers', trainerIds: 'trainers', vendorIds: 'vendors', productCategories: 'categories', challengeIds: 'challenges' };
  return Object.entries(r).filter(([k]) => k !== 'scope').map(([k, v]) => `${names[k] ?? k}: ${(v as string[]).join(', ')}`).join(' · ');
}
function eligibilityText(p: B2BProgram) {
  const e = p.eligibility;
  const base = e.scope === 'all' ? 'All beneficiaries' : e.scope === 'groups' ? `Groups: ${e.groups.join(', ')}` : `${e.beneficiaryIds.length} selected beneficiaries`;
  return [base, e.beneficiaryTypes.length ? `types: ${e.beneficiaryTypes.join(', ')}` : null,
    e.enrolledOnOrBefore ? `enrolled by ${e.enrolledOnOrBefore}` : null].filter(Boolean).join(' · ');
}

const EMPTY_PROGRAM = { name: '', description: '', programType: 'wellness', startDate: '', endDate: '', budget: '', scope: 'all', groups: [] as string[], ids: [] as string[], types: '' };
const EMPTY_BENEFIT = {
  name: '', description: '', benefitType: 'gym_access', fundingType: 'full', sponsorAmount: '', sponsorPct: '', sponsorCap: '', copay: '',
  usagePeriod: 'month', usageLimit: '', periodCap: '', startDate: '', endDate: '', terms: '',
  providerScope: 'all', gymIds: '', gymTiers: [] as string[], trainerIds: '', vendorIds: '', productCategories: '', challengeIds: '', groups: '', types: '',
};

/**
 * Wellness programmes of one organisation, and each programme's benefits and
 * eligible beneficiaries. Rules only: usage and payments come later.
 */
export function B2BPrograms({ token, org, beneficiaries, onChanged }: { token: string; org: B2BOrganization; beneficiaries: B2BBeneficiary[]; onChanged?: () => void }) {
  const [ref, setRef] = useState<B2BProgramReference | null>(null);
  const [programs, setPrograms] = useState<B2BProgram[] | null>(null);
  const [open, setOpen] = useState<{ program: B2BProgram; benefits: B2BBenefit[] } | null>(null);
  const [programForm, setProgramForm] = useState<typeof EMPTY_PROGRAM | null>(null);
  const [benefitForm, setBenefitForm] = useState<(typeof EMPTY_BENEFIT & { id?: string }) | null>(null);
  const [eligibility, setEligibility] = useState<{ rows: B2BEligibilityRow[]; counts: { beneficiaries: number; wouldBeEligible: number; eligibleToday: number } } | null>(null);
  const [usage, setUsage] = useState<B2BProgramUsage | null>(null);
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = [...new Set(beneficiaries.map(b => b.groupName).filter((g): g is string => !!g))].sort();

  const loadList = async () => {
    try { setPrograms((await api.b2bPrograms(token, org.id)).items); } catch { setPrograms([]); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { api.b2bProgramReference().then(setRef).catch(() => setRef(null)); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setOpen(null); setProgramForm(null); setBenefitForm(null); setPrograms(null); loadList(); }, [org.id]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(message(err, fallback)); } finally { setBusy(false); }
  };
  const openProgram = (id: string) => run(async () => {
    setOpen(await api.b2bProgram(token, org.id, id));
    setEligibility(null);
    setUsage(null);
    setBenefitForm(null);
  }, 'Could not load the programme.');
  // Eligibility is a snapshot of one programme's rules: drop it whenever the programme reloads.
  const refresh = async (id: string) => { setEligibility(null); setUsage(null); setOpen(await api.b2bProgram(token, org.id, id)); await loadList(); onChanged?.(); };

  // ── Programme form ──
  const editProgram = (p?: B2BProgram) => setProgramForm(p ? {
    name: p.name, description: p.description ?? '', programType: p.programType, startDate: p.startDate, endDate: p.endDate ?? '',
    budget: p.budgetTzs?.toString() ?? '', scope: p.eligibility.scope, groups: p.eligibility.groups, ids: p.eligibility.beneficiaryIds,
    types: p.eligibility.beneficiaryTypes.join(', '),
  } : { ...EMPTY_PROGRAM });
  const live = open && ['active', 'paused'].includes(open.program.effectiveStatus);

  const saveProgram = (e: React.FormEvent) => {
    e.preventDefault();
    if (!programForm) return;
    const f = programForm;
    const full: B2BProgramInput = {
      name: f.name, description: f.description || null, programType: f.programType, startDate: f.startDate, endDate: f.endDate || null,
      budgetTzs: intOrNull(f.budget),
      eligibility: { scope: f.scope as 'all', groups: f.groups, beneficiaryIds: f.ids, beneficiaryTypes: list(f.types) },
    };
    // A live programme only accepts these fields.
    const body = live ? { name: full.name, description: full.description, endDate: full.endDate, budgetTzs: full.budgetTzs } : full;
    return run(async () => {
      const { program } = open
        ? await api.updateB2BProgram(token, org.id, open.program.id, body)
        : await api.createB2BProgram(token, org.id, full);
      setProgramForm(null);
      await refresh(program.id);
    }, 'Could not save the programme.');
  };

  const move = (status: string) => open && run(async () => {
    await api.setB2BProgramStatus(token, org.id, open.program.id, status, remark.trim() || undefined);
    setRemark('');
    await refresh(open.program.id);
  }, 'Could not change the status.');

  const showUsage = () => open && run(async () => {
    setUsage(await api.b2bProgramUsage(token, org.id, open.program.id));
  }, 'Could not load usage.');
  // Paused because the budget ran out: FitFlex resumes it, with a remark.
  const budgetPaused = open?.program.effectiveStatus === 'paused' && open.program.statusReason === 'budget_exhausted';

  const showEligibility = () => open && run(async () => {
    const r = await api.b2bProgramEligibility(token, org.id, open.program.id, { include: 'all', limit: 100 });
    setEligibility({ rows: r.items, counts: r.counts });
  }, 'Could not load eligibility.');

  // ── Benefit form ──
  const editBenefit = (b?: B2BBenefit) => setBenefitForm(b ? {
    id: b.id, name: b.name, description: b.description ?? '', benefitType: b.benefitType, fundingType: b.fundingType,
    sponsorAmount: b.sponsorAmountTzs?.toString() ?? '', sponsorPct: b.sponsorShareBps != null ? String(b.sponsorShareBps / 100) : '',
    sponsorCap: b.sponsorCapTzs?.toString() ?? '', copay: b.beneficiaryAmountTzs?.toString() ?? '',
    usagePeriod: b.usagePeriod, usageLimit: b.usageLimit?.toString() ?? '', periodCap: b.periodSponsorCapTzs?.toString() ?? '',
    startDate: b.startDate ?? '', endDate: b.endDate ?? '', terms: b.terms ?? '',
    providerScope: b.providerRules.scope, gymIds: (b.providerRules.gymIds ?? []).join(', '), gymTiers: b.providerRules.gymTiers ?? [],
    trainerIds: (b.providerRules.trainerIds ?? []).join(', '), vendorIds: (b.providerRules.vendorIds ?? []).join(', '),
    productCategories: (b.providerRules.productCategories ?? []).join(', '), challengeIds: (b.providerRules.challengeIds ?? []).join(', '),
    groups: (b.eligibility?.groups ?? []).join(', '), types: (b.eligibility?.beneficiaryTypes ?? []).join(', '),
  } : { ...EMPTY_BENEFIT });

  const saveBenefit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!open || !benefitForm) return;
    const f = benefitForm;
    const keys = ref?.benefitTypes[f.benefitType]?.providerKeys ?? [];
    const rules: B2BProviderRules = { scope: f.providerScope as 'all' | 'selected' };
    if (f.providerScope === 'selected') {
      const lists: Record<string, string[]> = {
        gymIds: list(f.gymIds), gymTiers: f.gymTiers, trainerIds: list(f.trainerIds), vendorIds: list(f.vendorIds),
        productCategories: list(f.productCategories), challengeIds: list(f.challengeIds),
      };
      for (const k of keys) if (lists[k]?.length) (rules as unknown as Record<string, string[]>)[k] = lists[k];
    }
    const body: B2BBenefitInput = {
      name: f.name, description: f.description || null, benefitType: f.benefitType, fundingType: f.fundingType,
      sponsorAmountTzs: f.fundingType === 'sponsor_fixed' ? intOrNull(f.sponsorAmount) : null,
      sponsorShareBps: f.fundingType === 'sponsor_percentage' && f.sponsorPct !== '' ? Math.round(Number(f.sponsorPct) * 100) : null,
      sponsorCapTzs: f.fundingType === 'sponsor_percentage' ? intOrNull(f.sponsorCap) : null,
      beneficiaryAmountTzs: f.fundingType === 'beneficiary_fixed' ? intOrNull(f.copay) : null,
      usagePeriod: f.usagePeriod,
      usageLimit: f.usagePeriod === 'unlimited' ? null : intOrNull(f.usageLimit),
      periodSponsorCapTzs: f.usagePeriod === 'unlimited' || f.fundingType === 'none' ? null : intOrNull(f.periodCap),
      startDate: f.startDate || null, endDate: f.endDate || null, terms: f.terms || null,
      providerRules: keys.length ? rules : { scope: 'all' },
      eligibility: list(f.groups).length || list(f.types).length ? { groups: list(f.groups), beneficiaryTypes: list(f.types) } : null,
    };
    const existing = f.id ? open.benefits.find(b => b.id === f.id) : null;
    const wordingOnly = existing?.status === 'active' && live;
    return run(async () => {
      if (f.id) await api.updateB2BBenefit(token, org.id, open.program.id, f.id, wordingOnly ? { name: body.name, description: body.description, terms: body.terms } : body);
      else await api.createB2BBenefit(token, org.id, open.program.id, body);
      setBenefitForm(null);
      await refresh(open.program.id);
    }, 'Could not save the benefit.');
  };

  const benefitStatus = (b: B2BBenefit, status: string) => open && run(async () => {
    await api.setB2BBenefitStatus(token, org.id, open.program.id, b.id, status);
    await refresh(open.program.id);
  }, 'Could not change the benefit.');

  // ── Render ──
  const programFormView = programForm && (
    <form onSubmit={saveProgram} className="grid gap-3 sm:grid-cols-2" data-testid="program-form">
      <Field label="Name"><input className="ui-input" required value={programForm.name} onChange={e => setProgramForm({ ...programForm, name: e.target.value })} data-testid="program-name" /></Field>
      <Field label="Type">
        <select className="ui-input" disabled={!!live} value={programForm.programType} onChange={e => setProgramForm({ ...programForm, programType: e.target.value })}>
          {ref && Object.entries(ref.programTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Starts"><input className="ui-input" type="date" required disabled={!!live} value={programForm.startDate} onChange={e => setProgramForm({ ...programForm, startDate: e.target.value })} data-testid="program-start" /></Field>
      <Field label="Ends (optional)"><input className="ui-input" type="date" value={programForm.endDate} onChange={e => setProgramForm({ ...programForm, endDate: e.target.value })} data-testid="program-end" /></Field>
      <Field label="Sponsor budget, TZS (optional)"><input className="ui-input" inputMode="numeric" value={programForm.budget} onChange={e => setProgramForm({ ...programForm, budget: e.target.value })} /></Field>
      <Field label="Who is eligible">
        <select className="ui-input" disabled={!!live} value={programForm.scope} onChange={e => setProgramForm({ ...programForm, scope: e.target.value })} data-testid="program-scope">
          <option value="all">All beneficiaries</option>
          <option value="groups">Selected groups</option>
          <option value="selected">Selected beneficiaries</option>
        </select>
      </Field>
      {programForm.scope === 'groups' && (
        <div className="sm:col-span-2 flex flex-wrap gap-3 text-sm" data-testid="program-groups">
          {groups.length === 0 && <span className="text-[var(--color-fg-quaternary)]">No groups yet: give beneficiaries a group first.</span>}
          {groups.map(g => (
            <label key={g} className="flex items-center gap-1.5">
              <input type="checkbox" disabled={!!live} checked={programForm.groups.includes(g)}
                onChange={e => setProgramForm({ ...programForm, groups: e.target.checked ? [...programForm.groups, g] : programForm.groups.filter(x => x !== g) })} />{g}
            </label>
          ))}
        </div>
      )}
      {programForm.scope === 'selected' && (
        <div className="sm:col-span-2 max-h-40 space-y-1 overflow-y-auto text-sm">
          {beneficiaries.map(b => (
            <label key={b.id} className="flex items-center gap-1.5">
              <input type="checkbox" disabled={!!live} checked={programForm.ids.includes(b.id)}
                onChange={e => setProgramForm({ ...programForm, ids: e.target.checked ? [...programForm.ids, b.id] : programForm.ids.filter(x => x !== b.id) })} />
              {b.displayName ?? b.id} <span className="text-[var(--color-fg-quaternary)]">{b.groupName}</span>
            </label>
          ))}
        </div>
      )}
      <Field label="Only these beneficiary types (optional, comma-separated)"><input className="ui-input" disabled={!!live} value={programForm.types} onChange={e => setProgramForm({ ...programForm, types: e.target.value })} placeholder="e.g. policyholder, employee" /></Field>
      <Field label="Description"><input className="ui-input" value={programForm.description} onChange={e => setProgramForm({ ...programForm, description: e.target.value })} /></Field>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setProgramForm(null)}>Cancel</Button>
        <Button type="submit" disabled={busy} data-testid="program-save">Save programme</Button>
      </div>
      {live && <p className="sm:col-span-2 text-xs text-[var(--color-fg-quaternary)]">Live programme: only the name, description, a later end date or a bigger budget can change.</p>}
    </form>
  );

  const bf = benefitForm;
  const providerKeys = bf ? ref?.benefitTypes[bf.benefitType]?.providerKeys ?? [] : [];
  const benefitFormView = bf && (
    <form onSubmit={saveBenefit} className="grid gap-3 rounded-lg border border-[var(--color-border-secondary)] p-3 sm:grid-cols-2" data-testid="benefit-form">
      <Field label="Benefit name"><input className="ui-input" required value={bf.name} onChange={e => setBenefitForm({ ...bf, name: e.target.value })} data-testid="benefit-name" /></Field>
      <Field label="Type">
        <select className="ui-input" value={bf.benefitType} onChange={e => setBenefitForm({ ...bf, benefitType: e.target.value, providerScope: 'all' })} data-testid="benefit-type">
          {ref && Object.entries(ref.benefitTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>
      <Field label="Who pays">
        <select className="ui-input" value={bf.fundingType} onChange={e => setBenefitForm({ ...bf, fundingType: e.target.value })} data-testid="benefit-funding">
          {ref && Object.entries(ref.fundingTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      {bf.fundingType === 'sponsor_fixed' && <Field label="Sponsor pays per use (TZS)"><input className="ui-input" inputMode="numeric" value={bf.sponsorAmount} onChange={e => setBenefitForm({ ...bf, sponsorAmount: e.target.value })} data-testid="benefit-sponsor-amount" /></Field>}
      {bf.fundingType === 'sponsor_percentage' && (
        <>
          <Field label="Sponsor share (%)"><input className="ui-input" inputMode="decimal" value={bf.sponsorPct} onChange={e => setBenefitForm({ ...bf, sponsorPct: e.target.value })} data-testid="benefit-sponsor-pct" /></Field>
          <Field label="Sponsor max per use, TZS (optional)"><input className="ui-input" inputMode="numeric" value={bf.sponsorCap} onChange={e => setBenefitForm({ ...bf, sponsorCap: e.target.value })} /></Field>
        </>
      )}
      {bf.fundingType === 'beneficiary_fixed' && <Field label="Beneficiary copay per use (TZS)"><input className="ui-input" inputMode="numeric" value={bf.copay} onChange={e => setBenefitForm({ ...bf, copay: e.target.value })} /></Field>}
      <Field label="Usage period">
        <select className="ui-input" value={bf.usagePeriod} onChange={e => setBenefitForm({ ...bf, usagePeriod: e.target.value })} data-testid="benefit-period">
          {ref?.usagePeriods.map(p => <option key={p} value={p}>{p === 'program' ? 'whole programme' : p}</option>)}
        </select>
      </Field>
      {bf.usagePeriod !== 'unlimited' && (
        <>
          <Field label="Uses per period (blank = no count limit)"><input className="ui-input" inputMode="numeric" value={bf.usageLimit} onChange={e => setBenefitForm({ ...bf, usageLimit: e.target.value })} data-testid="benefit-limit" /></Field>
          {bf.fundingType !== 'none' && <Field label="Sponsor money per period, TZS (optional)"><input className="ui-input" inputMode="numeric" value={bf.periodCap} onChange={e => setBenefitForm({ ...bf, periodCap: e.target.value })} /></Field>}
        </>
      )}
      <Field label="Valid from (blank = programme start)"><input className="ui-input" type="date" value={bf.startDate} onChange={e => setBenefitForm({ ...bf, startDate: e.target.value })} /></Field>
      <Field label="Valid to (blank = programme end)"><input className="ui-input" type="date" value={bf.endDate} onChange={e => setBenefitForm({ ...bf, endDate: e.target.value })} /></Field>
      {providerKeys.length > 0 && (
        <Field label="Providers">
          <select className="ui-input" value={bf.providerScope} onChange={e => setBenefitForm({ ...bf, providerScope: e.target.value })} data-testid="benefit-provider-scope">
            <option value="all">All eligible providers</option>
            <option value="selected">Only selected providers</option>
          </select>
        </Field>
      )}
      {bf.providerScope === 'selected' && providerKeys.includes('gymIds') && <Field label="Gym IDs (comma-separated)"><input className="ui-input" value={bf.gymIds} onChange={e => setBenefitForm({ ...bf, gymIds: e.target.value })} /></Field>}
      {bf.providerScope === 'selected' && providerKeys.includes('gymTiers') && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[var(--color-fg-quaternary)]">Gym tiers:</span>
          {GYM_TIERS.map(t => (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" checked={bf.gymTiers.includes(t)} onChange={e => setBenefitForm({ ...bf, gymTiers: e.target.checked ? [...bf.gymTiers, t] : bf.gymTiers.filter(x => x !== t) })} />{t}
            </label>
          ))}
        </div>
      )}
      {bf.providerScope === 'selected' && providerKeys.includes('trainerIds') && <Field label="Trainer profile IDs"><input className="ui-input" value={bf.trainerIds} onChange={e => setBenefitForm({ ...bf, trainerIds: e.target.value })} /></Field>}
      {bf.providerScope === 'selected' && providerKeys.includes('vendorIds') && <Field label="Vendor user IDs"><input className="ui-input" value={bf.vendorIds} onChange={e => setBenefitForm({ ...bf, vendorIds: e.target.value })} /></Field>}
      {bf.providerScope === 'selected' && providerKeys.includes('productCategories') && <Field label="Product categories"><input className="ui-input" value={bf.productCategories} onChange={e => setBenefitForm({ ...bf, productCategories: e.target.value })} /></Field>}
      {bf.providerScope === 'selected' && providerKeys.includes('challengeIds') && <Field label="Challenge IDs"><input className="ui-input" value={bf.challengeIds} onChange={e => setBenefitForm({ ...bf, challengeIds: e.target.value })} /></Field>}
      <Field label="Only for groups (optional)"><input className="ui-input" value={bf.groups} onChange={e => setBenefitForm({ ...bf, groups: e.target.value })} placeholder={groups.join(', ')} /></Field>
      <Field label="Only for beneficiary types (optional)"><input className="ui-input" value={bf.types} onChange={e => setBenefitForm({ ...bf, types: e.target.value })} /></Field>
      <Field label="Terms"><input className="ui-input" value={bf.terms} onChange={e => setBenefitForm({ ...bf, terms: e.target.value })} /></Field>
      <Field label="Description"><input className="ui-input" value={bf.description} onChange={e => setBenefitForm({ ...bf, description: e.target.value })} /></Field>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setBenefitForm(null)}>Cancel</Button>
        <Button type="submit" disabled={busy} data-testid="benefit-save">Save benefit</Button>
      </div>
      {ref && <p className="sm:col-span-2 text-xs text-[var(--color-fg-quaternary)]">Fulfilled by: {ref.benefitTypes[bf.benefitType]?.fulfilledBy}</p>}
    </form>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold"><Gift className="h-4 w-4" />Wellness programmes</span>
          {!open && !programForm && org.status === 'active' && (
            <Button size="sm" variant="secondary" onClick={() => editProgram()} data-testid="program-new"><Plus className="h-4 w-4" />New programme</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <Alert tone="error">{error}</Alert>}
        {!open ? (
          programForm ? programFormView : programs == null ? <Spinner className="h-6 w-6" /> : programs.length === 0 ? (
            <p className="text-[var(--color-fg-quaternary)]">No programmes yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="program-list">
              {programs.map(p => (
                <li key={p.id}>
                  <button onClick={() => openProgram(p.id)} className="flex w-full items-center justify-between gap-2 py-2 text-left" data-testid={`program-${p.id}`}>
                    <span><span className="font-medium">{p.name}</span> <span className="text-[var(--color-fg-quaternary)]">{p.startDate} → {p.endDate ?? 'open'}</span></span>
                    <Badge tone={TONE[p.effectiveStatus] ?? 'gray'}>{p.effectiveStatus}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="space-y-4" data-testid="program-detail">
            <button className="flex items-center gap-1 text-xs text-[var(--color-fg-quaternary)]" onClick={() => { setOpen(null); setProgramForm(null); setBenefitForm(null); setEligibility(null); setUsage(null); }}>
              <ArrowLeft className="h-3 w-3" />All programmes
            </button>
            {programForm ? programFormView : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{open.program.name}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone="brand">{ref?.programTypes[open.program.programType] ?? open.program.programType}</Badge>
                    <Badge tone={TONE[open.program.effectiveStatus] ?? 'gray'}>{open.program.effectiveStatus}</Badge>
                  </span>
                </div>
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {([
                    ['Validity', `${open.program.startDate} → ${open.program.endDate ?? 'open-ended'}`],
                    ['Sponsor budget', tzs(open.program.budgetTzs)],
                    ['Eligible population', eligibilityText(open.program)],
                    ['Description', open.program.description],
                  ] as const).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-[var(--color-fg-quaternary)]">{k}</dt><dd>{v || '—'}</dd></div>)}
                </dl>
                <div className="flex flex-wrap gap-2" data-testid="program-actions">
                  {!['expired', 'cancelled'].includes(open.program.effectiveStatus) && (
                    <Button size="sm" variant="secondary" onClick={() => editProgram(open.program)}><Pencil className="h-4 w-4" />Edit</Button>
                  )}
                  {(ref?.programStatuses[open.program.effectiveStatus] ?? []).map(s => (
                    <Button key={s} size="sm" variant={s === 'active' ? 'primary' : 'secondary'} disabled={busy} onClick={() => move(s)} data-testid={`program-move-${s}`}>
                      {open.program.effectiveStatus === 'paused' && s === 'active' ? 'Resume' : MOVE_LABEL[s] ?? s}
                    </Button>
                  ))}
                  <Button size="sm" variant="secondary" onClick={showEligibility} data-testid="program-eligibility"><Users className="h-4 w-4" />Eligible beneficiaries</Button>
                  <Button size="sm" variant="secondary" onClick={showUsage} data-testid="program-usage"><BarChart3 className="h-4 w-4" />Usage</Button>
                </div>
                {budgetPaused && (
                  <div className="space-y-2" data-testid="budget-paused">
                    <Alert tone="warning">Paused because the sponsor budget ran out. Raise the budget (Edit), then resume with a remark.</Alert>
                    <input className="ui-input" placeholder="Why is it being resumed? (required)" value={remark} onChange={e => setRemark(e.target.value)} data-testid="resume-remark" />
                  </div>
                )}
                {usage && (
                  <div className="space-y-3 rounded-lg border border-[var(--color-border-secondary)] p-3" data-testid="usage-panel">
                    <div className="grid gap-2 sm:grid-cols-4">
                      {([
                        ['Uses', String(usage.totals.uses)],
                        ['Service value', tzs(usage.totals.grossTzs)],
                        ['Sponsor pays', tzs(usage.totals.sponsorTzs)],
                        ['Beneficiaries pay', tzs(usage.totals.beneficiaryTzs)],
                      ] as const).map(([k, v]) => (
                        <div key={k}><div className="text-xs text-[var(--color-fg-quaternary)]">{k}</div><div className="font-semibold">{v}</div></div>
                      ))}
                    </div>
                    {usage.budget.budgetTzs != null && (
                      <p className="text-xs text-[var(--color-fg-quaternary)]">
                        Budget {tzs(usage.budget.budgetTzs)} · committed {tzs(usage.budget.spentTzs)} · left {tzs(usage.budget.remainingTzs)}
                      </p>
                    )}
                    {usage.totals.uses === 0 ? <p className="text-[var(--color-fg-quaternary)]">No usage yet.</p> : (
                      <div className="grid gap-4 sm:grid-cols-3">
                        {([
                          ['By benefit', usage.byBenefit.map(r => [r.benefitId, r.benefitName ?? r.benefitId, r] as const)],
                          ['By provider', usage.byProvider.map(r => [r.providerId, r.providerName ?? r.providerId, r] as const)],
                          ['By beneficiary', usage.byBeneficiary.map(r => [r.beneficiaryId, r.beneficiaryName ?? r.beneficiaryId, r] as const)],
                        ] as const).map(([title, rows]) => (
                          <div key={title}>
                            <div className="mb-1 text-xs font-semibold">{title}</div>
                            <ul className="space-y-1 text-xs">
                              {rows.map(([id, name, r]) => (
                                <li key={id} className="flex justify-between gap-2">
                                  <span className="truncate">{name}</span>
                                  <span className="shrink-0 text-[var(--color-fg-quaternary)]">{r.uses} · {tzs(r.sponsorTzs)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-[var(--color-fg-quaternary)]">Totals only. Each row shows uses and what the sponsor pays; individual visits are in Benefit usage.</p>
                  </div>
                )}
                {eligibility && (
                  <div className="rounded-lg border border-[var(--color-border-secondary)] p-3" data-testid="eligibility-panel">
                    <p className="mb-2 text-xs text-[var(--color-fg-quaternary)]">
                      {eligibility.counts.wouldBeEligible} of {eligibility.counts.beneficiaries} beneficiaries match · {eligibility.counts.eligibleToday} can use it today
                    </p>
                    <ul className="max-h-48 space-y-1 overflow-y-auto">
                      {eligibility.rows.map(r => (
                        <li key={r.beneficiary.id} className="flex justify-between gap-2">
                          <span>{r.beneficiary.displayName ?? r.beneficiary.id} <span className="text-[var(--color-fg-quaternary)]">{r.beneficiary.groupName}</span></span>
                          <span className="text-xs">{r.wouldBeEligible ? <Badge tone="success">eligible</Badge> : <span className="text-[var(--color-fg-quaternary)]">{r.reason?.replace(/_/g, ' ')}</span>}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Benefits</span>
                    {!benefitForm && !['expired', 'cancelled'].includes(open.program.effectiveStatus) && (
                      <Button size="sm" variant="secondary" onClick={() => editBenefit()} data-testid="benefit-new"><Plus className="h-4 w-4" />Add benefit</Button>
                    )}
                  </div>
                  {benefitFormView}
                  {open.benefits.length === 0 ? <p className="text-[var(--color-fg-quaternary)]">No benefits yet.</p> : (
                    <ul className="space-y-2" data-testid="benefit-list">
                      {open.benefits.map(b => (
                        <li key={b.id} className="rounded-lg border border-[var(--color-border-secondary)] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{b.name} <span className="font-normal text-[var(--color-fg-quaternary)]">· {ref?.benefitTypes[b.benefitType]?.label ?? b.benefitType}</span></span>
                            <span className="flex items-center gap-2">
                              <Badge tone={TONE[b.status] ?? 'gray'}>{b.status}</Badge>
                              {!['expired', 'cancelled'].includes(open.program.effectiveStatus) && (
                                <>
                                  <Button size="sm" variant="secondary" onClick={() => editBenefit(b)}>Edit</Button>
                                  {(ref?.benefitStatuses[b.status] ?? []).map(s => (
                                    <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => benefitStatus(b, s)} data-testid={`benefit-${b.id}-${s}`}>
                                      {s === 'active' ? 'Activate' : 'Deactivate'}
                                    </Button>
                                  ))}
                                </>
                              )}
                            </span>
                          </div>
                          <dl className="mt-2 grid gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
                            {([
                              ['Funding', b.fundingSummary],
                              ['Usage limit', usageText(b)],
                              ['Valid', `${b.validity.startDate} → ${b.validity.endDate ?? 'open-ended'}`],
                              ['Providers', providerText(b.providerRules)],
                              ['Population', b.eligibility ? [b.eligibility.groups.join(', '), b.eligibility.beneficiaryTypes.join(', ')].filter(Boolean).join(' · ') : 'Everyone eligible for the programme'],
                              ['Terms', b.terms],
                            ] as const).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-[var(--color-fg-quaternary)]">{k}</dt><dd>{v || '—'}</dd></div>)}
                          </dl>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <p className="text-xs text-[var(--color-fg-quaternary)]">Programmes set the rules only. Usage counting and payments come in later phases.</p>
      </CardContent>
    </Card>
  );
}
