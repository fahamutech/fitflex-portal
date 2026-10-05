'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useApp } from '../../app/providers';
import {
  api, ApiError, userContact, B2BBeneficiary, B2BBenefit, B2BOrganization, B2BProgram, CorporateEmployee,
} from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, Field, PageHeader, Spinner } from '@/components/shared';
import { money } from '@/lib/admin-utils';
import { ChallengeManager } from '@/components/challenge-manager';
import { RewardQueue } from '@/components/reward-queue';
import { GroupManager } from '@/components/group-manager';

/**
 * The organisation's own screens for the people it covers and its
 * programmes. Used by organisation users (/org) and by a company's HR login
 * (/hr). What a role may see or change is decided on the server; these
 * screens only hide what would be refused.
 */

export type Mine = { organization: B2BOrganization; role: string; permissions: string[] };

const ERRORS: Record<string, string> = {
  user_not_found: 'Nobody has a FitFlex account with that email or number. They need to sign up in the app first.',
  invalid_email: 'That email address doesn’t look right.',
  invalid_phone: 'That number doesn’t look right. Try 0712 345 678 or +255712345678.',
  user_contact_required: 'Enter their email address or mobile number.',
  beneficiary_must_be_member: 'That account isn’t a member account. They need to use FitFlex as a member.',
  user_must_be_member: 'That account isn’t a member account. They need to use FitFlex as a member.',
  already_enrolled: 'They are already on your list.',
  user_already_linked: 'That account is already linked to another of your employees.',
  external_reference_in_use: 'Someone else already has that reference.',
  organization_not_active: 'Your organisation isn’t active yet, so people can’t be added.',
  display_name_required: 'Enter the employee’s name.',
  seat_limit_reached: 'All of your company’s seats are in use. Ask FitFlex for more.',
  forbidden: 'Your role doesn’t include this.',
  invalid_transition: 'That change isn’t possible now.',
};
const said = (e: unknown, fallback: string) => {
  const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
  return (code && ERRORS[code]) || fallback;
};
const TONE: Record<string, 'success' | 'warning' | 'gray' | 'danger' | 'brand'> = {
  active: 'success', pending: 'warning', suspended: 'danger', inactive: 'gray', exited: 'gray',
  draft: 'gray', paused: 'warning', expired: 'gray', cancelled: 'gray',
};
const day = (v?: string | null) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** The organisations the signed-in person belongs to, the one chosen, and what they may do there. */
export function useMyOrganization() {
  const { token } = useApp();
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }> | null>(null);
  const [orgId, setOrgId] = useState('');
  const [mine, setMine] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.myB2BOrganizations(token)
      .then((r) => {
        const list = r.organizations.map(o => ({ id: o.id, name: o.tradingName || o.legalName }));
        setOrgs(list);
        setOrgId(id => id || list[0]?.id || '');
      })
      .catch(() => { setOrgs([]); setError('Could not load your organisation.'); });
  }, [token]);
  useEffect(() => {
    if (!token || !orgId) return;
    setMine(null);
    api.b2bOrganization(token, orgId)
      .then(r => setMine({ organization: r.organization, role: r.access.role, permissions: r.access.permissions }))
      .catch(() => setError('Could not load your organisation.'));
  }, [token, orgId]);

  return { token, orgs, orgId, setOrgId, mine, error };
}

export function OrgFrame({ title, description, state, bare = false, children }: {
  title: string; description: string; state: ReturnType<typeof useMyOrganization>; children: (mine: Mine, token: string) => React.ReactNode;
  /** The screen inside brings its own heading. */
  bare?: boolean;
}) {
  const { token, orgs, orgId, setOrgId, mine, error } = state;
  if (!token) return null;
  return (
    <div className="space-y-5">
      {!bare && <PageHeader title={title} description={mine ? `${mine.organization.tradingName || mine.organization.legalName} · ${description}` : description} />}
      {error && <Alert tone="error">{error}</Alert>}
      {orgs && orgs.length === 0 && !error && <Alert tone="info">You aren’t part of any organisation on FitFlex yet.</Alert>}
      {orgs && orgs.length > 1 && (
        <select className="ui-input !w-auto" value={orgId} onChange={e => setOrgId(e.target.value)} data-testid="org-picker">
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {orgs === null || (orgId && !mine && !error) ? <Spinner className="h-6 w-6" /> : mine && children(mine, token)}
    </div>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

export function OrgPeoplePage() {
  const state = useMyOrganization();
  const { user } = useApp();
  return (
    <OrgFrame title="People" description="who your programmes cover." state={state}>
      {(mine, token) => {
        if (!mine.permissions.includes('beneficiaries.read')) return <Alert tone="info">Your role doesn’t include the list of people. Ask your organisation’s owner or admin.</Alert>;
        // A company set up under Companies keeps its staff list there; its HR login manages it.
        if (mine.organization.legacyCorporateId) {
          return user?.userType === 'corporate_hr' || user?.userType === 'admin'
            ? <CompanyStaff token={token} />
            : <Beneficiaries token={token} mine={mine} readOnlyNote="Your company’s staff list is managed by its HR login." />;
        }
        return <Beneficiaries token={token} mine={mine} />;
      }}
    </OrgFrame>
  );
}

function Beneficiaries({ token, mine, readOnlyNote }: { token: string; mine: Mine; readOnlyNote?: string }) {
  const orgId = mine.organization.id;
  const canManage = mine.permissions.includes('beneficiaries.manage') && !readOnlyNote;
  const [people, setPeople] = useState<B2BBeneficiary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ contact: '', beneficiaryType: 'member', groupName: '', externalReference: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api.b2bBeneficiaries(token, orgId, { search: search.trim() || undefined, limit: 100 });
    setPeople(r.items); setTotal(r.total);
  };
  useEffect(() => {
    load().catch(() => { setError('Could not load the list.'); setPeople([]); });
    api.b2bReference().then(r => setTypes(r.beneficiaryTypes)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const run = async (fn: () => Promise<string | void>, fallback: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const told = await fn();
      if (told) setNotice(told);
      await load();
    } catch (e) {
      setError(said(e, fallback));
    } finally {
      setBusy(false);
    }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { beneficiary } = await api.enrollB2BBeneficiary(token, orgId, {
        ...userContact(form.contact), beneficiaryType: form.beneficiaryType, status: 'active',
        groupName: form.groupName.trim() || undefined, externalReference: form.externalReference.trim() || undefined,
      });
      setForm({ ...form, contact: '', externalReference: '' });
      return `${beneficiary.displayName ?? 'They'} can now use your programmes.`;
    }, 'Could not add them.');
  };

  return (
    <div className="space-y-4" data-testid="org-people">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {readOnlyNote && <Alert tone="info">{readOnlyNote}</Alert>}
      {canManage && (
        <Card>
          <CardContent className="py-4">
            <form onSubmit={add} className="grid gap-3 sm:grid-cols-5" data-testid="org-people-add">
              <div className="sm:col-span-2">
                <Field label="Email or mobile number" hint="Of the FitFlex account they use in the app.">
                  <input className="ui-input" required value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="asha@example.co.tz or 0712 345 678" data-testid="org-people-contact" />
                </Field>
              </div>
              <Field label="Type">
                <select className="ui-input" value={form.beneficiaryType} onChange={e => setForm({ ...form, beneficiaryType: e.target.value })}>
                  {Object.entries(Object.keys(types).length ? types : { member: 'Member' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Group (optional)"><input className="ui-input" value={form.groupName} onChange={e => setForm({ ...form, groupName: e.target.value })} placeholder="e.g. Head office" /></Field>
              <Field label="Your reference (optional)"><input className="ui-input" value={form.externalReference} onChange={e => setForm({ ...form, externalReference: e.target.value })} placeholder="Staff or policy no." /></Field>
              <div className="sm:col-span-5"><Button type="submit" size="sm" disabled={busy || !form.contact.trim()} data-testid="org-people-add-button">Add person</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">{total} {total === 1 ? 'person' : 'people'}</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => undefined, 'Could not search.'); }}>
              <input className="ui-input !w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or reference" />
              <Button type="submit" size="sm" variant="secondary" disabled={busy}><RefreshCw className="h-4 w-4" />Search</Button>
            </form>
          </div>
          {!people ? <Spinner className="h-5 w-5" /> : people.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">Nobody yet.</p> : (
            <table className="w-full text-sm" data-testid="org-people-list">
              <thead>
                <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                  <th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Group</th><th className="py-2 pr-3">Reference</th><th className="py-2 pr-3">Status</th><th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {people.map(p => (
                  <tr key={p.id} className="border-b border-[var(--color-border-secondary)]">
                    <td className="py-2 pr-3 font-medium">{p.displayName ?? '—'}{!p.userId && <span className="ml-2 text-xs font-normal text-[var(--color-fg-quaternary)]">no FitFlex account linked</span>}</td>
                    <td className="py-2 pr-3">{types[p.beneficiaryType] ?? p.beneficiaryType}</td>
                    <td className="py-2 pr-3">{p.groupName ?? ''}</td>
                    <td className="py-2 pr-3">{p.externalReference ?? ''}</td>
                    <td className="py-2 pr-3"><Badge tone={TONE[p.status] ?? 'gray'}>{p.status}</Badge></td>
                    <td className="py-2 text-right">
                      {canManage && !p.readOnly && (
                        <span className="flex justify-end gap-2">
                          {p.status !== 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, 'active'); }, 'Could not activate them.')}>Activate</Button>}
                          {p.status === 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, 'suspended'); }, 'Could not suspend them.')}>Suspend</Button>}
                          {p.status !== 'inactive' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { if (window.confirm('Remove this person from your programmes? What they already used stays on record.')) run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, 'inactive'); }, 'Could not remove them.'); }}>Remove</Button>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-[var(--color-fg-quaternary)]">Only active people are covered. Suspending or removing someone stops new use straight away; a sponsored pass already started runs to the end of its month.</p>
        </CardContent>
      </Card>
    </div>
  );
}

/** A company's staff list (the Companies side): add an employee, link them to their FitFlex account, change their status. */
function CompanyStaff({ token }: { token: string }) {
  const [staff, setStaff] = useState<CorporateEmployee[] | null>(null);
  const [form, setForm] = useState({ displayName: '', contact: '', department: '' });
  const [link, setLink] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setStaff((await api.corporateStaff(token)).employees);
  useEffect(() => {
    load().catch(() => { setError('Could not load your staff.'); setStaff([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const run = async (fn: () => Promise<string | void>, fallback: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const told = await fn();
      if (told) setNotice(told);
      await load();
    } catch (e) {
      setError(said(e, fallback));
    } finally {
      setBusy(false);
    }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const contact = form.contact.trim() ? userContact(form.contact) : null;
      const { employee } = await api.provisionCorporateStaff(token, {
        displayName: form.displayName.trim(), department: form.department.trim() || undefined,
        email: contact?.email, phone: contact?.phone,
      });
      await api.setCorporateStaffStatus(token, employee.id, 'active');
      setForm({ displayName: '', contact: '', department: form.department });
      // Benefits only work once the employee is linked to the account they use in the app.
      if (!contact) return `${employee.displayName} added. Link their FitFlex account so they can use the benefits.`;
      try {
        await api.linkCorporateStaff(token, employee.id, contact);
        return `${employee.displayName} added and linked to their FitFlex account.`;
      } catch (err) {
        return `${employee.displayName} added, but not linked yet: ${said(err, 'their FitFlex account wasn’t found.')}`;
      }
    }, 'Could not add the employee.');
  };

  return (
    <div className="space-y-4" data-testid="company-staff">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card>
        <CardContent className="py-4">
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-4" data-testid="company-staff-add">
            <Field label="Employee’s name"><input className="ui-input" required value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} data-testid="company-staff-name" /></Field>
            <div className="sm:col-span-2">
              <Field label="Email or mobile number (optional)" hint="Of the FitFlex account they use in the app. They are linked to it if it exists.">
                <input className="ui-input" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="asha@example.co.tz or 0712 345 678" data-testid="company-staff-contact" />
              </Field>
            </div>
            <Field label="Department (optional)"><input className="ui-input" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></Field>
            <div className="sm:col-span-4"><Button type="submit" size="sm" disabled={busy || !form.displayName.trim()} data-testid="company-staff-add-button">Add employee</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="text-sm font-semibold">{staff?.length ?? 0} {staff?.length === 1 ? 'employee' : 'employees'}</div>
          {!staff ? <Spinner className="h-5 w-5" /> : staff.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No employees yet.</p> : (
            <table className="w-full text-sm" data-testid="company-staff-list">
              <thead>
                <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                  <th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Department</th><th className="py-2 pr-3">FitFlex account</th><th className="py-2 pr-3">Status</th><th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id} className="border-b border-[var(--color-border-secondary)] align-top">
                    <td className="py-2 pr-3 font-medium">{s.displayName}<div className="text-xs font-normal text-[var(--color-fg-quaternary)]">{s.email || s.phone || ''}</div></td>
                    <td className="py-2 pr-3">{s.department ?? ''}</td>
                    <td className="py-2 pr-3">
                      {s.userId ? (
                        <span className="flex items-center gap-2"><Badge tone="success">Linked</Badge>
                          <button className="text-xs text-[var(--color-fg-quaternary)] underline" disabled={busy} onClick={() => run(async () => { await api.linkCorporateStaff(token, s.id, null); }, 'Could not unlink.')}>Unlink</button>
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <input className="ui-input !w-52" value={link[s.id] ?? ''} onChange={e => setLink({ ...link, [s.id]: e.target.value })} placeholder="Their email or number" data-testid={`company-staff-link-${s.id}`} />
                          <Button size="sm" variant="secondary" disabled={busy || !(link[s.id] ?? '').trim()}
                            onClick={() => run(async () => { await api.linkCorporateStaff(token, s.id, userContact(link[s.id])); setLink({ ...link, [s.id]: '' }); return `${s.displayName} is linked to their FitFlex account.`; }, 'Could not link them.')}>Link</Button>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3"><Badge tone={TONE[s.status] ?? 'gray'}>{s.status === 'exited' ? 'left' : s.status}</Badge></td>
                    <td className="py-2 text-right">
                      <span className="flex justify-end gap-2">
                        {s.status !== 'active' && s.status !== 'exited' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setCorporateStaffStatus(token, s.id, 'active'); }, 'Could not activate them.')}>Activate</Button>}
                        {s.status === 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setCorporateStaffStatus(token, s.id, 'suspended'); }, 'Could not suspend them.')}>Suspend</Button>}
                        {s.status !== 'exited' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { if (window.confirm('Mark this employee as having left? Their seat goes back to your pool.')) run(async () => { await api.setCorporateStaffStatus(token, s.id, 'exited'); }, 'Could not update them.'); }}>Left</Button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-[var(--color-fg-quaternary)]">An employee is covered once they are active and linked to the FitFlex account they use in the app.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Programmes ───────────────────────────────────────────────────────────────

const USAGE = (b: B2BBenefit) => (b.benefitType === 'sponsored_pass' ? 'A pass for the month'
  : b.usagePeriod === 'unlimited' ? 'No limit'
    : `${b.usageLimit != null ? `${b.usageLimit} per ${b.usagePeriod === 'program' ? 'programme' : b.usagePeriod}` : `No count limit, per ${b.usagePeriod}`}`);

export function OrgProgrammesPage() {
  const state = useMyOrganization();
  return (
    <OrgFrame title="Programmes" description="the wellness programmes FitFlex runs for you." state={state}>
      {(mine, token) => (mine.permissions.includes('programs.read')
        ? <Programmes token={token} mine={mine} />
        : <Alert tone="info">Your role doesn’t include programmes. Ask your organisation’s owner or admin.</Alert>)}
    </OrgFrame>
  );
}

function Programmes({ token, mine }: { token: string; mine: Mine }) {
  const orgId = mine.organization.id;
  const [programmes, setProgrammes] = useState<B2BProgram[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [benefits, setBenefits] = useState<Record<string, B2BBenefit[]>>({});
  const [types, setTypes] = useState<Record<string, { label: string }>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.b2bPrograms(token, orgId).then(r => setProgrammes(r.items)).catch(() => { setError('Could not load your programmes.'); setProgrammes([]); });
    api.b2bProgramReference().then(r => setTypes(r.benefitTypes)).catch(() => undefined);
  }, [token, orgId]);

  const toggle = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!benefits[id]) {
      try {
        const r = await api.b2bProgram(token, orgId, id);
        setBenefits(b => ({ ...b, [id]: r.benefits }));
      } catch {
        setError('Could not load that programme.');
      }
    }
  };

  if (!programmes) return <Spinner className="h-6 w-6" />;
  return (
    <div className="space-y-3" data-testid="org-programmes">
      {error && <Alert tone="error">{error}</Alert>}
      {programmes.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-[var(--color-fg-quaternary)]">No programme yet. FitFlex sets programmes up with you.</CardContent></Card>}
      {programmes.map(p => (
        <Card key={p.id}>
          <CardContent className="py-4">
            <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => toggle(p.id)} data-testid={`org-programme-${p.id}`}>
              <span className="flex items-center gap-2">
                {open === p.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-semibold">{p.name}</span>
              </span>
              <span className="flex items-center gap-3 text-xs text-[var(--color-fg-quaternary)]">
                <span>{day(p.startDate)} to {p.endDate ? day(p.endDate) : 'open'}</span>
                {p.budgetTzs != null && <span>Budget {money(p.budgetTzs)}</span>}
                <Badge tone={TONE[p.effectiveStatus] ?? 'gray'}>{p.effectiveStatus === 'pending' ? 'waiting for FitFlex' : p.effectiveStatus}</Badge>
              </span>
            </button>
            {open === p.id && (
              <div className="mt-3 space-y-2 border-t border-[var(--color-border-secondary)] pt-3 text-sm">
                {p.description && <p className="text-[var(--color-fg-tertiary)]">{p.description}</p>}
                {p.effectiveStatus === 'paused' && <Alert tone="warning">This programme is paused{p.statusReason === 'budget_exhausted' ? ' because its budget has been used up' : ''}. Only FitFlex can resume it.</Alert>}
                <div className="text-xs text-[var(--color-fg-quaternary)]">
                  Covers: {p.eligibility.scope === 'all' ? 'everyone on your list' : p.eligibility.scope === 'groups' ? `the groups ${p.eligibility.groups.join(', ')}` : `${p.eligibility.beneficiaryIds.length} chosen people`}
                </div>
                {!benefits[p.id] ? <Spinner className="h-5 w-5" /> : benefits[p.id].length === 0 ? <p className="text-[var(--color-fg-quaternary)]">No benefits yet.</p> : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                        <th className="py-2 pr-3">Benefit</th><th className="py-2 pr-3">What</th><th className="py-2 pr-3">Who pays</th><th className="py-2 pr-3">How much</th><th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benefits[p.id].map(b => (
                        <tr key={b.id} className="border-b border-[var(--color-border-secondary)]">
                          <td className="py-2 pr-3 font-medium">{b.name}</td>
                          <td className="py-2 pr-3">{types[b.benefitType]?.label ?? b.benefitType}{b.passTier ? ` · ${b.passTier}` : ''}</td>
                          <td className="py-2 pr-3">{b.fundingSummary}</td>
                          <td className="py-2 pr-3">{USAGE(b)}</td>
                          <td className="py-2"><Badge tone={TONE[b.status] ?? 'gray'}>{b.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-[var(--color-fg-quaternary)]">Programmes and their benefits are set up and changed by FitFlex. Contact FitFlex to change one.</p>
    </div>
  );
}

// ── Challenges, rewards and groups ───────────────────────────────────────────

const NO_ENGAGEMENT = <Alert tone="info">Your role doesn’t include challenges and groups. Ask your organisation’s owner or admin.</Alert>;

/** Challenges an organisation runs for its own people. Totals here; each person's progress is under Insights. */
export function OrgChallengesPage() {
  const state = useMyOrganization();
  return (
    <OrgFrame bare title="Challenges" description="" state={state}>
      {mine => (mine.permissions.includes('engagement.read') ? (
        <ChallengeManager scope="corporate" organizationId={mine.organization.id} rewardsHref="/org/rewards"
          title="Wellness challenges"
          description={`Challenges for ${mine.organization.tradingName || mine.organization.legalName}’s people. This page shows participation, completion and group progress; each person’s progress is under Insights.`} />
      ) : NO_ENGAGEMENT)}
    </OrgFrame>
  );
}

export function OrgRewardsPage() {
  const state = useMyOrganization();
  return (
    <OrgFrame bare title="Rewards" description="" state={state}>
      {mine => (mine.permissions.includes('engagement.read') ? (
        <RewardQueue scope="corporate" organizationId={mine.organization.id} title="Rewards"
          description="Rewards your organisation funds that your people have earned. Approve, then mark issued once handed over. Rewards FitFlex funds are handed out by FitFlex." />
      ) : NO_ENGAGEMENT)}
    </OrgFrame>
  );
}

export function OrgGroupsPage() {
  const state = useMyOrganization();
  return (
    <OrgFrame bare title="Groups" description="" state={state}>
      {mine => (mine.permissions.includes('engagement.read') ? <GroupManager organizationId={mine.organization.id} /> : NO_ENGAGEMENT)}
    </OrgFrame>
  );
}
