'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useApp } from '../../app/providers';
import {
  api, ApiError, userContact, isPendingMemberAcceptance, B2BBeneficiary, B2BMemberRequest, B2BProgramLifecycle, B2BBenefit, B2BOrganization, B2BProgram, CorporateEmployee,
} from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, Field, Input, PageHeader, Select, Spinner, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { money } from '@/lib/admin-utils';
import { ChallengeManager } from '@/components/challenge-manager';
import { PeopleImport } from '@/components/b2b-people-import';
import { CompanyPeopleOr } from '@/components/b2b-company-people';
import { RewardQueue } from '@/components/reward-queue';
import { GroupManager } from '@/components/group-manager';
import type { Locale, MessageKey } from '@/lib/i18n';
import { PendingMemberStatus, WithdrawRequestButton, fill, memberRequestError, requestLabel, requestSentNotice, shownRequests, withdrawMemberRequest } from '@/components/b2b-member-requests';
import { OrgT, useOrgT } from '@/lib/org-i18n';

/**
 * The organisation's own screens for the people it covers and its
 * programmes. Used by organisation users (/org) and by a company's HR login
 * (/hr). What a role may see or change is decided on the server; these
 * screens only hide what would be refused.
 */

export type Mine = { organization: B2BOrganization; role: string; permissions: string[]; companyStaffManage?: boolean };

// The refusals these screens explain, each with an `org.err.<code>` message. By user ID only: by email or number
// nothing person-dependent comes back any more (functions#283), so user_not_found / beneficiary_must_be_member /
// user_must_be_member are not handled here.
const ERROR_CODES = new Set([
  'invalid_email', 'invalid_phone', 'user_contact_required', 'already_enrolled', 'user_already_linked', 'external_reference_in_use',
  'organization_not_active', 'display_name_required', 'seat_limit_reached', 'forbidden', 'invalid_transition',
]);
const said = (o: OrgT, e: unknown, fallback: MessageKey, t: (k: MessageKey) => string, locale: Locale = 'en') => {
  const request = memberRequestError(e, t, locale);
  if (request) return request;
  const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
  return o.t(code && ERROR_CODES.has(code) ? `org.err.${code}` as MessageKey : fallback);
};
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
      .then(r => setMine({ organization: r.organization, role: r.access.role, permissions: r.access.permissions, companyStaffManage: r.access.companyStaffManage === true }))
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
        <Select className="!w-auto" value={orgId} onChange={e => setOrgId(e.target.value)} data-testid="org-picker">
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
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
        // B5b: while the server has ORG_ONLY_SPONSORS on, the staff list is managed here for every role that may.
        if (mine.organization.legacyCorporateId) {
          return <CompanyPeopleOr token={token} mine={mine}>{user?.userType === 'corporate_hr' || user?.userType === 'admin'
            ? <CompanyStaff token={token} />
            : <Beneficiaries token={token} mine={mine} readOnlyNote={o.t('org.people.managedByHr')} />}</CompanyPeopleOr>;
        }
        return <Beneficiaries token={token} mine={mine} />;
      }}
    </OrgFrame>
  );
}

function Beneficiaries({ token, mine, readOnlyNote }: { token: string; mine: Mine; readOnlyNote?: string }) {
  const { t, locale } = useApp();
  const orgId = mine.organization.id;
  const canManage = mine.permissions.includes('beneficiaries.manage') && !readOnlyNote;
  const o = useOrgT();
  const [people, setPeople] = useState<B2BBeneficiary[] | null>(null);
  // Adds by user ID, email or number the member has not accepted yet (absent on an older backend).
  const [pending, setPending] = useState<B2BMemberRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ contact: '', beneficiaryType: 'member', groupName: '', externalReference: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api.b2bBeneficiaries(token, orgId, { search: search.trim() || undefined, limit: 100 });
    setPeople(r.items); setTotal(r.total); setPending(shownRequests(r.pendingMemberAcceptance));
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
      setError(said(o, e, fallback, t, locale));
    } finally {
      setBusy(false);
    }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const out = await api.enrollB2BBeneficiary(token, orgId, {
        ...userContact(form.contact), beneficiaryType: form.beneficiaryType, status: 'active',
        groupName: form.groupName.trim() || undefined, externalReference: form.externalReference.trim() || undefined,
      });
      setForm({ ...form, contact: '', externalReference: '' });
      // Named by user ID, email or number: nobody is added until the member accepts in the app. Same text
      // whatever came back (an id-null stub, or a request by contact that nobody may be behind), so the
      // screen can't reveal whether the person has an account (functions#241, #283).
      if (isPendingMemberAcceptance(out)) return requestSentNotice(t);
      return o.t('org.people.added', { name: out.beneficiary.displayName ?? o.t('org.people.they') });
    }, 'org.people.addFailed');
  };

  const withdraw = (r: B2BMemberRequest) => r.id && run(async () => {
    await withdrawMemberRequest(token, orgId, r.id as string);
    return t('b2b.memberRequest.withdrawn');
  }, 'b2b.memberRequest.withdrawFailed');

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
                <Field label={o.t('org.people.contact')} hint={t('b2b.memberRequest.contactHint')}>
                  <Input required value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder={o.t('org.people.contactPlaceholder')} data-testid="org-people-contact" />
                </Field>
              </div>
              <Field label={o.t('org.common.type')}>
                <Select value={form.beneficiaryType} onChange={e => setForm({ ...form, beneficiaryType: e.target.value })}>
                  {Object.entries(Object.keys(types).length ? types : { member: 'Member' }).map(([k, v]) => <option key={k} value={k}>{o.server('org.people.type', k, v)}</option>)}
                </Select>
              </Field>
              <Field label={o.t('org.people.groupOptional')}><Input value={form.groupName} onChange={e => setForm({ ...form, groupName: e.target.value })} placeholder={o.t('org.people.groupPlaceholder')} /></Field>
              <Field label={o.t('org.people.refOptional')}><Input value={form.externalReference} onChange={e => setForm({ ...form, externalReference: e.target.value })} placeholder={o.t('org.people.refPlaceholder')} /></Field>
              <div className="sm:col-span-5"><Button type="submit" size="sm" disabled={busy || !form.contact.trim()} data-testid="org-people-add-button">{o.t('org.people.add')}</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
      {!readOnlyNote && <PeopleImport token={token} orgId={orgId} canManage={canManage} onChanged={() => load().catch(() => undefined)} />}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">{o.n('org.people.count', total)}</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => undefined, 'org.people.searchFailed'); }}>
              <Input className="!w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder={o.t('org.people.searchPlaceholder')} />
              <Button type="submit" size="sm" variant="secondary" disabled={busy}><RefreshCw className="h-4 w-4" />{o.t('org.common.search')}</Button>
            </form>
          </div>
          {!people ? <Spinner className="h-5 w-5" /> : people.length === 0 && pending.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.people.empty')}</p> : (
            <Table aria-label={o.n('org.people.count', total)} data-testid="org-people-list">
              <THead>
                <Tr>
                  <Th>{o.t('org.common.name')}</Th><Th>{o.t('org.common.type')}</Th><Th>{o.t('org.common.group')}</Th><Th>{o.t('org.common.reference')}</Th><Th>{o.t('org.common.status')}</Th><Th></Th>
                </Tr>
              </THead>
              <TBody>
                {pending.map(r => (
                  <Tr key={`request-${r.id}`} data-testid={`org-people-request-${r.id}`}>
                    <Td className="font-medium">{requestLabel(t, r)}</Td>
                    <Td>{r.beneficiaryType ? o.server('org.people.type', r.beneficiaryType, types[r.beneficiaryType]) : ''}</Td>
                    <Td>{r.groupName ?? ''}</Td>
                    <Td>{r.externalReference ?? ''}</Td>
                    <Td><PendingMemberStatus request={r} /></Td>
                    <Td className="text-right">
                      {canManage && <span className="flex justify-end"><WithdrawRequestButton request={r} disabled={busy} onWithdraw={() => withdraw(r)} /></span>}
                    </Td>
                  </Tr>
                ))}
                {people.map(p => (
                  <Tr key={p.id}>
                    <Td className="font-medium">{p.displayName ?? '—'}{!p.userId && <span className="ml-2 text-xs font-normal text-[var(--color-fg-quaternary)]">{o.t('org.people.notLinked')}</span>}</Td>
                    <Td>{o.server('org.people.type', p.beneficiaryType, types[p.beneficiaryType])}</Td>
                    <Td>{p.groupName ?? ''}</Td>
                    <Td>{p.externalReference ?? ''}</Td>
                    <Td><Badge tone={TONE[p.status] ?? 'gray'}>{o.label('org.personStatus', p.status)}</Badge></Td>
                    <Td className="text-right">
                      {canManage && !p.readOnly && (
                        <span className="flex justify-end gap-2">
                          {p.status !== 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, 'active'); }, 'org.people.activateFailed')}>{o.t('org.people.activate')}</Button>}
                          {p.status === 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, 'suspended'); }, 'org.people.suspendFailed')}>{o.t('org.people.suspend')}</Button>}
                          {p.status !== 'inactive' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { if (window.confirm(o.t('org.people.removeConfirm'))) run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, 'inactive'); }, 'org.people.removeFailed'); }}>{o.t('org.common.remove')}</Button>}
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
          <p className="text-xs text-[var(--color-fg-quaternary)]">{o.t('org.people.note')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/** A company's staff list (the Companies side): add an employee, link them to their FitFlex account, change their status. */
function CompanyStaff({ token }: { token: string }) {
  const { t, locale } = useApp();
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
      setError(said(o, e, fallback, t, locale));
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
        const linked = await api.linkCorporateStaff(token, employee.id, contact);
        // HR only asks (functions#283): by email or number the reply is the same whoever is behind it, and the
        // record is linked only when the member accepts in the app. A FitFlex admin links directly.
        if (isPendingMemberAcceptance(linked)) {
          return fill(t('b2b.memberRequest.employeeAddedSent'), { employee: employee.displayName });
        }
        return o.t('org.people.staff.addedLinked', { name: employee.displayName });
      } catch (err) {
        // Only refusals that say nothing about the person (invalid contact, rate limits) come back now.
        return fill(t('b2b.memberRequest.employeeAddedNotLinked'), { employee: employee.displayName, reason: said(o, err, 'b2b.hrOrg.link.failed', t, locale) });
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
            <Field label={o.t('org.people.staff.name')}><Input required value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} data-testid="company-staff-name" /></Field>
            <div className="sm:col-span-2">
              <Field label={o.t('org.people.staff.contactOptional')} hint={t('b2b.hrOrg.add.contactHint')}>
                <Input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder={o.t('org.people.contactPlaceholder')} data-testid="company-staff-contact" />
              </Field>
            </div>
            <Field label={o.t('org.people.staff.departmentOptional')}><Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></Field>
            <div className="sm:col-span-4"><Button type="submit" size="sm" disabled={busy || !form.displayName.trim()} data-testid="company-staff-add-button">{o.t('org.people.staff.add')}</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="text-sm font-semibold">{o.n('org.people.staff.count', staff?.length ?? 0)}</div>
          {!staff ? <Spinner className="h-5 w-5" /> : staff.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{o.t('org.people.staff.empty')}</p> : (
            <Table aria-label={o.n('org.people.staff.count', staff?.length ?? 0)} data-testid="company-staff-list">
              <THead>
                <Tr>
                  <Th>{o.t('org.common.name')}</Th><Th>{o.t('org.people.staff.department')}</Th><Th>{o.t('org.people.staff.account')}</Th><Th>{o.t('org.common.status')}</Th><Th></Th>
                </Tr>
              </THead>
              <TBody>
                {staff.map(s => (
                  <Tr key={s.id} className="align-top">
                    <Td className="font-medium">{s.displayName}<div className="text-xs font-normal text-[var(--color-fg-quaternary)]">{s.email || s.phone || ''}</div></Td>
                    <Td>{s.department ?? ''}</Td>
                    <Td>
                      {s.userId ? (
                        <span className="flex items-center gap-2"><Badge tone="success">{o.t('org.people.staff.linked')}</Badge>
                          <Button variant="link" className="h-auto px-0 text-xs font-normal text-[var(--color-fg-quaternary)] underline" disabled={busy} onClick={() => run(async () => { await api.linkCorporateStaff(token, s.id, null); }, 'org.people.staff.unlinkFailed')}>{o.t('org.people.staff.unlink')}</Button>
                        </span>
                      ) : s.pendingLink?.id ? (
                        <span className="flex flex-wrap items-center gap-2" data-testid={`company-staff-request-${s.id}`}>
                          <span className="text-sm">{requestLabel(t, s.pendingLink)}</span>
                          <PendingMemberStatus request={s.pendingLink} />
                          {/* HR withdraws a link request (by user ID, email or number) by unlinking the record: the backend closes
                              it, a masked decline too. DELETE …/member-requests/:id does not take staff links (404). */}
                          <WithdrawRequestButton request={s.pendingLink} disabled={busy}
                            onWithdraw={() => run(async () => { await api.linkCorporateStaff(token, s.id, null); return t('b2b.memberRequest.withdrawn'); }, 'b2b.memberRequest.withdrawFailed')} />
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <Input className="!w-52" value={link[s.id] ?? ''} onChange={e => setLink({ ...link, [s.id]: e.target.value })} placeholder={o.t('org.people.staff.linkPlaceholder')} data-testid={`company-staff-link-${s.id}`} />
                          <Button size="sm" variant="secondary" disabled={busy || !(link[s.id] ?? '').trim()}
                            onClick={() => run(async () => {
                              const linked = await api.linkCorporateStaff(token, s.id, userContact(link[s.id]));
                              setLink({ ...link, [s.id]: '' });
                              if (isPendingMemberAcceptance(linked)) return requestSentNotice(t);
                              return o.t('org.people.staff.linkedNotice', { name: s.displayName });
                            }, 'org.people.staff.linkFailed')}>{o.t('org.people.staff.link')}</Button>
                        </span>
                      )}
                    </Td>
                    <Td><Badge tone={TONE[s.status] ?? 'gray'}>{o.label('org.personStatus', s.status)}</Badge></Td>
                    <Td className="text-right">
                      <span className="flex justify-end gap-2">
                        {s.status !== 'active' && s.status !== 'exited' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setCorporateStaffStatus(token, s.id, 'active'); }, 'org.people.activateFailed')}>{o.t('org.people.activate')}</Button>}
                        {s.status === 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api.setCorporateStaffStatus(token, s.id, 'suspended'); }, 'org.people.suspendFailed')}>{o.t('org.people.suspend')}</Button>}
                        {s.status !== 'exited' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { if (window.confirm(o.t('org.people.staff.leftConfirm'))) run(async () => { await api.setCorporateStaffStatus(token, s.id, 'exited'); }, 'org.people.staff.updateFailed'); }}>{o.t('org.people.staff.left')}</Button>}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
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
  const { t } = useApp();
  const orgId = mine.organization.id;
  const o = useOrgT();
  const day = o.day;
  const [programmes, setProgrammes] = useState<B2BProgram[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [benefits, setBenefits] = useState<Record<string, B2BBenefit[]>>({});
  const [types, setTypes] = useState<Record<string, { label: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [life, setLife] = useState<Record<string, B2BProgramLifecycle>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = mine.permissions.includes('programs.manage');

  const load = () => {
    api.b2bPrograms(token, orgId).then(r => setProgrammes(r.items)).catch(() => { setError(o.t('org.programmes.loadFailed')); setProgrammes([]); });
    api.b2bProgramLifecycle(token, orgId).then(r => setLife(Object.fromEntries(r.items.map(i => [i.programId, i])))).catch(() => undefined);
  };
  useEffect(() => {
    load();
    api.b2bProgramReference().then(r => setTypes(r.benefitTypes)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, orgId]);

  const renew = async (p: B2BProgram) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.prepareB2BProgramRenewal(token, orgId, p.id);
      const skipped = r.skipped.length ? o.n('org.programmes.renew.skipped', r.skipped.length, { names: r.skipped.map(x => x.name).join(', ') }) : '';
      const range = o.t('org.common.range', { from: day(r.program.startDate), to: r.program.endDate ? day(r.program.endDate) : o.t('org.programmes.open') });
      setNotice(`${o.t(r.existing ? 'org.programmes.renew.existing' : 'org.programmes.renew.prepared', { range })}${skipped}${r.discountNotCarriedOver ? o.t('org.programmes.renew.discount') : ''}`);
      load();
    } catch (e) {
      setError(said(o, e, 'org.programmes.renewFailed', t));
    } finally {
      setBusy(false);
    }
  };

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
      {notice && <Alert tone="success">{notice}</Alert>}
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
                {life[p.id]?.renewalOf && <Badge tone="brand">{o.t('org.programmes.renewal')}</Badge>}
                {life[p.id]?.endingSoon && <Badge tone="warning">{life[p.id].daysLeft === 0 ? o.t('org.programmes.endsToday') : o.n('org.programmes.endsIn', life[p.id].daysLeft ?? 0)}</Badge>}
                <span>{o.t('org.common.range', { from: day(p.startDate), to: p.endDate ? day(p.endDate) : o.t('org.programmes.open') })}</span>
                {p.budgetTzs != null && <span>{o.t('org.programmes.budget', { amount: money(p.budgetTzs) })}</span>}
                <Badge tone={TONE[p.effectiveStatus] ?? 'gray'}>{p.effectiveStatus === 'pending' ? o.t('org.status.waitingFitflex') : o.label('org.status', p.effectiveStatus)}</Badge>
              </span>
            </button>
            {open === p.id && (
              <div className="mt-3 space-y-2 border-t border-[var(--color-border-secondary)] pt-3 text-sm">
                {p.description && <p className="text-[var(--color-fg-tertiary)]">{p.description}</p>}
                {life[p.id]?.renewal && (
                  <Alert tone="info">
                    {o.t(life[p.id].renewal!.status === 'draft' ? 'org.programmes.renewal.draft' : life[p.id].renewal!.status === 'pending' ? 'org.programmes.renewal.pending' : 'org.programmes.renewal.other', {
                      range: o.t('org.common.range', { from: day(life[p.id].renewal!.startDate), to: life[p.id].renewal!.endDate ? day(life[p.id].renewal!.endDate!) : o.t('org.programmes.open') }),
                      status: o.label('org.status', life[p.id].renewal!.status),
                    })}
                  </Alert>
                )}
                {canManage && life[p.id]?.canRenew && (life[p.id].endingSoon || life[p.id].status === 'expired') && (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border-secondary)] px-3 py-2" data-testid={`renew-${p.id}`}>
                    <span className="text-[var(--color-fg-tertiary)]">{o.t(life[p.id].status === 'expired' ? 'org.programmes.ended' : 'org.programmes.endingSoon')} {o.t('org.programmes.renewHint')}</span>
                    <Button size="sm" disabled={busy} onClick={() => renew(p)} data-testid={`renew-button-${p.id}`}>{o.t('org.programmes.renew')}</Button>
                  </div>
                )}
                {p.effectiveStatus === 'paused' && <Alert tone="warning">{o.t(p.statusReason === 'budget_exhausted' ? 'org.programmes.pausedBudget' : 'org.programmes.paused')}</Alert>}
                <div className="text-xs text-[var(--color-fg-quaternary)]">
                  {o.t('org.programmes.covers', { who: p.eligibility.scope === 'all' ? o.t('org.programmes.covers.all') : p.eligibility.scope === 'groups' ? o.t('org.programmes.covers.groups', { groups: p.eligibility.groups.join(', ') }) : o.t('org.programmes.covers.chosen', { n: p.eligibility.beneficiaryIds.length }) })}
                </div>
                {!benefits[p.id] ? <Spinner className="h-5 w-5" /> : benefits[p.id].length === 0 ? <p className="text-[var(--color-fg-quaternary)]">{o.t('org.programmes.noBenefits')}</p> : (
                  <Table aria-label={p.name}>
                    <THead>
                      <Tr>
                        <Th>{o.t('org.programmes.col.benefit')}</Th><Th>{o.t('org.common.what')}</Th><Th>{o.t('org.programmes.col.whoPays')}</Th><Th>{o.t('org.programmes.col.howMuch')}</Th><Th>{o.t('org.common.status')}</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {benefits[p.id].map(b => (
                        <Tr key={b.id}>
                          <Td className="font-medium">{b.name}</Td>
                          <Td>{o.server('org.benefitType', b.benefitType, types[b.benefitType]?.label)}{b.passTier ? ` · ${b.passTier}` : ''}{b.fixedFeeTzs ? o.t('org.programmes.fixedFee', { amount: money(b.fixedFeeTzs) }) : ''}</Td>
                          <Td>{b.fundingSummary}</Td>
                          <Td>{USAGE(o, b)}</Td>
                          <Td><Badge tone={TONE[b.status] ?? 'gray'}>{o.label('org.status', b.status)}</Badge></Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
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
