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
import { MessageKey } from '@/lib/i18n';
import { OrgT, useOrgT } from '@/lib/org-i18n';

/**
 * The organisation's own screens for the people it covers and its
 * programmes. Used by organisation users (/org) and by a company's HR login
 * (/hr). What a role may see or change is decided on the server; these
 * screens only hide what would be refused.
 */

export type Mine = { organization: B2BOrganization; role: string; permissions: string[] };

const TONE: Record<string, 'success' | 'warning' | 'gray' | 'danger' | 'brand'> = {
  active: 'success', pending: 'warning', suspended: 'danger', inactive: 'gray', exited: 'gray',
  draft: 'gray', paused: 'warning', expired: 'gray', cancelled: 'gray',
};

/** The organisations the signed-in person belongs to, the one chosen, and what they may do there. */
export function useMyOrganization() {
  const { token } = useApp();
  const o = useOrgT();
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
      .catch(() => { setOrgs([]); setError(o.t('org.frame.loadFailed')); });
  }, [token]);
  useEffect(() => {
    if (!token || !orgId) return;
    setMine(null);
    api.b2bOrganization(token, orgId)
      .then(r => setMine({ organization: r.organization, role: r.access.role, permissions: r.access.permissions }))
      .catch(() => setError(o.t('org.frame.loadFailed')));
  }, [token, orgId]);

  return { token, orgs, orgId, setOrgId, mine, error };
}

export function OrgFrame({ title, description, state, bare = false, children }: {
  title: string; description: string; state: ReturnType<typeof useMyOrganization>; children: (mine: Mine, token: string) => React.ReactNode;
  /** The screen inside brings its own heading. */
  bare?: boolean;
}) {
  const { token, orgs, orgId, setOrgId, mine, error } = state;
  const o = useOrgT();
  if (!token) return null;
  return (
    <div className="space-y-5">
      {!bare && <PageHeader title={title} description={mine ? `${mine.organization.tradingName || mine.organization.legalName} · ${description}` : description} />}
      {error && <Alert tone="error">{error}</Alert>}
      {orgs && orgs.length === 0 && !error && <Alert tone="info">{o.t('org.frame.none')}</Alert>}
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
  const { user, t } = useApp();
  const o = useOrgT();
  return (
    <OrgFrame title={t('org.nav.people')} description={o.t('org.people.description')} state={state}>
      {(mine, token) => {
        if (!mine.permissions.includes('beneficiaries.read')) return <Alert tone="info">{o.t('org.people.noRole')}</Alert>;
        // A company set up under Companies keeps its staff list there; its HR login manages it.
        if (mine.organization.legacyCorporateId) {
          return user?.userType === 'corporate_hr' || user?.userType === 'admin'
            ? <CompanyStaff token={token} />
            : <Beneficiaries token={token} mine={mine} readOnlyNote={o.t('org.people.managedByHr')} />;
        }
        return <Beneficiaries token={token} mine={mine} />;
      }}
    </OrgFrame>
  );
}

function Beneficiaries({ token, mine, readOnlyNote }: { token: string; mine: Mine; readOnlyNote?: string }) {
  const orgId = mine.organization.id;
  const canManage = mine.permissions.includes('beneficiaries.manage') && !readOnlyNote;
  const o = useOrgT();
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
    load().catch(() => { setError(o.t('org.people.loadFailed')); setPeople([]); });
    api.b2bReference().then(r => setTypes(r.beneficiaryTypes)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const run = async (fn: () => Promise<string | void>, fallback: MessageKey) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const told = await fn();
      if (told) setNotice(told);
      await load();
    } catch (e) {
      setError(o.err('org.err', e, fallback));
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
      return o.t('org.people.added', { name: beneficiary.displayName ?? o.t('org.people.they') });
    }, 'org.people.addFailed');
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
                <Field label={o.t('org.people.contact')} hint={o.t('org.people.contactHint')}>
                  <input className="ui-input" required value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder={o.t('org.people.contactPlaceholder')} data-testid="org-people-contact" />
                </Field>
              </div>
              <Field label={o.t('org.common.type')}>
                <select className="ui-input" value={form.beneficiaryType} onChange={e => setForm({ ...form, beneficiaryType: e.target.value })}>
                  {Object.entries(Object.keys(types).length ? types : { member: 'Member' }).map(([k, v]) => <option key={k} value={k}>{o.server('org.people.type', k, v)}</option>)}
                </select>
              </Field>
              <Field label={o.t('org.people.groupOptional')}><input className="ui-input" value={form.groupName} onChange={e => setForm({ ...form, groupName: e.target.value })} placeholder={o.t('org.people.groupPlaceholder')} /></Field>
              <Field label={o.t('org.people.refOptional')}><input className="ui-input" value={form.externalReference} onChange={e => setForm({ ...form, externalReference: e.target.value })} placeholder={o.t('org.people.refPlaceholder')} /></Field>
              <div className="sm:col-span-5"><Button type="submit" size="sm" disabled={busy || !form.contact.trim()} data-testid="org-people-add-button">{o.t('org.people.add')}</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">{o.n('org.people.count', total)}</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => undefined, 'org.people.searchFailed'); }}>
              <input className="ui-input !w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder={o.t('org.people.searchPlaceholder')} />
              <Button type="submit" size="sm" variant="secondary" disabled={busy}><RefreshCw className="h-4 w-4" />{o.t('org.common.search')}</Button>
            </form>
          </div>
          {!people ? <Spinner className="h-5 w-5" /> : people.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.people.empty')}</p> : (
            <table className="w-full text-sm" data-testid="org-people-list">
              <thead>
                <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                  <th className="py-2 pr-3">{o.t('org.common.name')}</th><th className="py-2 pr-3">{o.t('org.common.type')}</th><th className="py-2 pr-3">{o.t('org.common.group')}</th><th className="py-2 pr-3">{o.t('org.common.reference')}</th><th className="py-2 pr-3">{o.t('org.common.status')}</th><th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {people.map(p => (
                  <tr key={p.id} className="border-b border-[var(--color-border-secondary)]">
                    <td className="py-2 pr-3 font-medium">{p.displayName ?? '—'}{!p.userId && <span className="ml-2 text-xs font-normal text-[var(--color-fg-quaternary)]">{o.t('org.people.notLinked')}</span>}</td>
                    <td className="py-2 pr-3">{o.server('org.people.type', p.beneficiaryType, types[p.beneficiaryType])}</td>
                    <td className="py-2 pr-3">{p.groupName ?? ''}</td>
                    <td className="py-2 pr-3">{p.externalReference ?? ''}</td>
                    <td className="py-2 pr-3"><Badge tone={TONE[p.status] ?? 'gray'}>{o.label('org.personStatus', p.status)}</Badge></td>
                    <td className="py-2 text-right">
                      {canManage && !p.readOnly && (
                        <span className="flex justify-end gap-2">
                          {p.status !== 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, 'active'); }, 'org.people.activateFailed')}>{o.t('org.people.activate')}</Button>}
                          {p.status === 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, 'suspended'); }, 'org.people.suspendFailed')}>{o.t('org.people.suspend')}</Button>}
                          {p.status !== 'inactive' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { if (window.confirm(o.t('org.people.removeConfirm'))) run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, 'inactive'); }, 'org.people.removeFailed'); }}>{o.t('org.common.remove')}</Button>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.people.note')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/** A company's staff list (the Companies side): add an employee, link them to their FitFlex account, change their status. */
function CompanyStaff({ token }: { token: string }) {
  const o = useOrgT();
  const [staff, setStaff] = useState<CorporateEmployee[] | null>(null);
  const [form, setForm] = useState({ displayName: '', contact: '', department: '' });
  const [link, setLink] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setStaff((await api.corporateStaff(token)).employees);
  useEffect(() => {
    load().catch(() => { setError(o.t('org.people.staff.loadFailed')); setStaff([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const run = async (fn: () => Promise<string | void>, fallback: MessageKey) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const told = await fn();
      if (told) setNotice(told);
      await load();
    } catch (e) {
      setError(o.err('org.err', e, fallback));
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
      if (!contact) return o.t('org.people.staff.addedNoLink', { name: employee.displayName });
      try {
        await api.linkCorporateStaff(token, employee.id, contact);
        return o.t('org.people.staff.addedLinked', { name: employee.displayName });
      } catch (err) {
        return o.t('org.people.staff.addedNotLinked', { name: employee.displayName, why: o.err('org.err', err, 'org.people.staff.accountNotFound') });
      }
    }, 'org.people.staff.addFailed');
  };

  return (
    <div className="space-y-4" data-testid="company-staff">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card>
        <CardContent className="py-4">
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-4" data-testid="company-staff-add">
            <Field label={o.t('org.people.staff.name')}><input className="ui-input" required value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} data-testid="company-staff-name" /></Field>
            <div className="sm:col-span-2">
              <Field label={o.t('org.people.staff.contactOptional')} hint={o.t('org.people.staff.contactHint')}>
                <input className="ui-input" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder={o.t('org.people.contactPlaceholder')} data-testid="company-staff-contact" />
              </Field>
            </div>
            <Field label={o.t('org.people.staff.departmentOptional')}><input className="ui-input" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></Field>
            <div className="sm:col-span-4"><Button type="submit" size="sm" disabled={busy || !form.displayName.trim()} data-testid="company-staff-add-button">{o.t('org.people.staff.add')}</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="text-sm font-semibold">{o.n('org.people.staff.count', staff?.length ?? 0)}</div>
          {!staff ? <Spinner className="h-5 w-5" /> : staff.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.people.staff.empty')}</p> : (
            <table className="w-full text-sm" data-testid="company-staff-list">
              <thead>
                <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                  <th className="py-2 pr-3">{o.t('org.common.name')}</th><th className="py-2 pr-3">{o.t('org.people.staff.department')}</th><th className="py-2 pr-3">{o.t('org.people.staff.account')}</th><th className="py-2 pr-3">{o.t('org.common.status')}</th><th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id} className="border-b border-[var(--color-border-secondary)] align-top">
                    <td className="py-2 pr-3 font-medium">{s.displayName}<div className="text-xs font-normal text-[var(--color-fg-quaternary)]">{s.email || s.phone || ''}</div></td>
                    <td className="py-2 pr-3">{s.department ?? ''}</td>
                    <td className="py-2 pr-3">
                      {s.userId ? (
                        <span className="flex items-center gap-2"><Badge tone="success">{o.t('org.people.staff.linked')}</Badge>
                          <button className="text-xs text-[var(--color-fg-quaternary)] underline" disabled={busy} onClick={() => run(async () => { await api.linkCorporateStaff(token, s.id, null); }, 'org.people.staff.unlinkFailed')}>{o.t('org.people.staff.unlink')}</button>
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <input className="ui-input !w-52" value={link[s.id] ?? ''} onChange={e => setLink({ ...link, [s.id]: e.target.value })} placeholder={o.t('org.people.staff.linkPlaceholder')} data-testid={`company-staff-link-${s.id}`} />
                          <Button size="sm" variant="secondary" disabled={busy || !(link[s.id] ?? '').trim()}
                            onClick={() => run(async () => { await api.linkCorporateStaff(token, s.id, userContact(link[s.id])); setLink({ ...link, [s.id]: '' }); return o.t('org.people.staff.linkedNotice', { name: s.displayName }); }, 'org.people.staff.linkFailed')}>{o.t('org.people.staff.link')}</Button>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3"><Badge tone={TONE[s.status] ?? 'gray'}>{o.label('org.personStatus', s.status)}</Badge></td>
                    <td className="py-2 text-right">
                      <span className="flex justify-end gap-2">
                        {s.status !== 'active' && s.status !== 'exited' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setCorporateStaffStatus(token, s.id, 'active'); }, 'org.people.activateFailed')}>{o.t('org.people.activate')}</Button>}
                        {s.status === 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setCorporateStaffStatus(token, s.id, 'suspended'); }, 'org.people.suspendFailed')}>{o.t('org.people.suspend')}</Button>}
                        {s.status !== 'exited' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { if (window.confirm(o.t('org.people.staff.leftConfirm'))) run(async () => { await api.setCorporateStaffStatus(token, s.id, 'exited'); }, 'org.people.staff.updateFailed'); }}>{o.t('org.people.staff.left')}</Button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.people.staff.note')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Programmes ───────────────────────────────────────────────────────────────

const USAGE = (o: OrgT, b: B2BBenefit) => (b.benefitType === 'sponsored_pass' ? o.t('org.programmes.usage.pass')
  : b.usagePeriod === 'unlimited' ? o.t('org.programmes.usage.noLimit')
    : b.usageLimit != null ? o.t('org.programmes.usage.limited', { n: b.usageLimit, period: o.label('org.programmes.period', b.usagePeriod) })
      // English has always shown this one as the server names it ("per program").
      : o.t('org.programmes.usage.uncounted', { period: o.locale === 'en' ? b.usagePeriod : o.label('org.programmes.period', b.usagePeriod) }));

export function OrgProgrammesPage() {
  const state = useMyOrganization();
  const { t } = useApp();
  const o = useOrgT();
  return (
    <OrgFrame title={t('org.nav.programmes')} description={o.t('org.programmes.description')} state={state}>
      {(mine, token) => (mine.permissions.includes('programs.read')
        ? <Programmes token={token} mine={mine} />
        : <Alert tone="info">{o.t('org.programmes.noRole')}</Alert>)}
    </OrgFrame>
  );
}

function Programmes({ token, mine }: { token: string; mine: Mine }) {
  const orgId = mine.organization.id;
  const o = useOrgT();
  const day = o.day;
  const [programmes, setProgrammes] = useState<B2BProgram[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [benefits, setBenefits] = useState<Record<string, B2BBenefit[]>>({});
  const [types, setTypes] = useState<Record<string, { label: string }>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.b2bPrograms(token, orgId).then(r => setProgrammes(r.items)).catch(() => { setError(o.t('org.programmes.loadFailed')); setProgrammes([]); });
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
        setError(o.t('org.programmes.loadOneFailed'));
      }
    }
  };

  if (!programmes) return <Spinner className="h-6 w-6" />;
  return (
    <div className="space-y-3" data-testid="org-programmes">
      {error && <Alert tone="error">{error}</Alert>}
      {programmes.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-[var(--color-fg-quaternary)]">{o.t('org.programmes.empty')}</CardContent></Card>}
      {programmes.map(p => (
        <Card key={p.id}>
          <CardContent className="py-4">
            <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => toggle(p.id)} data-testid={`org-programme-${p.id}`}>
              <span className="flex items-center gap-2">
                {open === p.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-semibold">{p.name}</span>
              </span>
              <span className="flex items-center gap-3 text-xs text-[var(--color-fg-quaternary)]">
                <span>{o.t('org.common.range', { from: day(p.startDate), to: p.endDate ? day(p.endDate) : o.t('org.programmes.open') })}</span>
                {p.budgetTzs != null && <span>{o.t('org.programmes.budget', { amount: money(p.budgetTzs) })}</span>}
                <Badge tone={TONE[p.effectiveStatus] ?? 'gray'}>{p.effectiveStatus === 'pending' ? o.t('org.status.waitingFitflex') : o.label('org.status', p.effectiveStatus)}</Badge>
              </span>
            </button>
            {open === p.id && (
              <div className="mt-3 space-y-2 border-t border-[var(--color-border-secondary)] pt-3 text-sm">
                {p.description && <p className="text-[var(--color-fg-tertiary)]">{p.description}</p>}
                {p.effectiveStatus === 'paused' && <Alert tone="warning">{o.t(p.statusReason === 'budget_exhausted' ? 'org.programmes.pausedBudget' : 'org.programmes.paused')}</Alert>}
                <div className="text-xs text-[var(--color-fg-quaternary)]">
                  {o.t('org.programmes.covers', { who: p.eligibility.scope === 'all' ? o.t('org.programmes.covers.all') : p.eligibility.scope === 'groups' ? o.t('org.programmes.covers.groups', { groups: p.eligibility.groups.join(', ') }) : o.t('org.programmes.covers.chosen', { n: p.eligibility.beneficiaryIds.length }) })}
                </div>
                {!benefits[p.id] ? <Spinner className="h-5 w-5" /> : benefits[p.id].length === 0 ? <p className="text-[var(--color-fg-quaternary)]">{o.t('org.programmes.noBenefits')}</p> : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                        <th className="py-2 pr-3">{o.t('org.programmes.col.benefit')}</th><th className="py-2 pr-3">{o.t('org.common.what')}</th><th className="py-2 pr-3">{o.t('org.programmes.col.whoPays')}</th><th className="py-2 pr-3">{o.t('org.programmes.col.howMuch')}</th><th className="py-2">{o.t('org.common.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benefits[p.id].map(b => (
                        <tr key={b.id} className="border-b border-[var(--color-border-secondary)]">
                          <td className="py-2 pr-3 font-medium">{b.name}</td>
                          <td className="py-2 pr-3">{o.server('org.benefitType', b.benefitType, types[b.benefitType]?.label)}{b.passTier ? ` · ${b.passTier}` : ''}</td>
                          <td className="py-2 pr-3">{b.fundingSummary}</td>
                          <td className="py-2 pr-3">{USAGE(o, b)}</td>
                          <td className="py-2"><Badge tone={TONE[b.status] ?? 'gray'}>{o.label('org.status', b.status)}</Badge></td>
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
      <p className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.programmes.note')}</p>
    </div>
  );
}

// ── Challenges, rewards and groups ───────────────────────────────────────────

function NoEngagement() {
  const o = useOrgT();
  return <Alert tone="info">{o.t('org.frame.noEngagement')}</Alert>;
}

/** Challenges an organisation runs for its own people. Totals here; each person's progress is under Insights. */
export function OrgChallengesPage() {
  const state = useMyOrganization();
  const { t } = useApp();
  const o = useOrgT();
  return (
    <OrgFrame bare title={t('admin.nav.challenges')} description="" state={state}>
      {mine => (mine.permissions.includes('engagement.read') ? (
        <ChallengeManager scope="corporate" organizationId={mine.organization.id} rewardsHref="/org/rewards"
          title={t('hr.nav.challenges')}
          description={o.t('org.challenges.org.description', { name: mine.organization.tradingName || mine.organization.legalName })} />
      ) : <NoEngagement />)}
    </OrgFrame>
  );
}

export function OrgRewardsPage() {
  const state = useMyOrganization();
  const { t } = useApp();
  const o = useOrgT();
  return (
    <OrgFrame bare title={t('hr.nav.rewards')} description="" state={state}>
      {mine => (mine.permissions.includes('engagement.read') ? (
        <RewardQueue scope="corporate" organizationId={mine.organization.id} title={t('hr.nav.rewards')}
          description={o.t('org.rewards.org.description')} />
      ) : <NoEngagement />)}
    </OrgFrame>
  );
}

export function OrgGroupsPage() {
  const state = useMyOrganization();
  const { t } = useApp();
  return (
    <OrgFrame bare title={t('hr.nav.groups')} description="" state={state}>
      {mine => (mine.permissions.includes('engagement.read') ? <GroupManager organizationId={mine.organization.id} /> : <NoEngagement />)}
    </OrgFrame>
  );
}
