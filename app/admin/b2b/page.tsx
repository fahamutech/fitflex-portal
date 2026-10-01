'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Building2, Plus, RefreshCw, UserPlus, Users } from 'lucide-react';
import { useApp } from '../../providers';
import {
  api, ApiError, B2BBeneficiary, B2BOrganization, B2BOrganizationUser, B2BProgram, B2BReference,
} from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, PageHeader, Spinner } from '@/components/shared';
import { B2BPrograms } from '@/components/b2b-programs';

const ERRORS: Record<string, string> = {
  invalid_organization_type: 'Choose an organisation type.',
  legal_name_required: 'Enter the legal name.',
  invalid_email: 'Enter a valid email.',
  invalid_phone: 'Enter a valid phone number.',
  registration_number_in_use: 'Another organisation already has that registration number.',
  tax_number_in_use: 'Another organisation already has that TIN.',
  managed_by_corporate: 'This organisation is a company from Companies. Change it there.',
  invalid_transition: 'That status change isn’t allowed from the current status.',
  user_not_found: 'No FitFlex user has that ID.',
  already_organization_user: 'That user is already on this organisation.',
  beneficiary_must_be_member: 'Beneficiaries must be FitFlex members.',
  already_enrolled: 'That member is already enrolled (change their status instead).',
  external_reference_in_use: 'That reference is already used in this organisation.',
  organization_not_active: 'Activate the organisation first.',
  last_owner: 'The organisation must keep at least one owner.',
};
const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? ERRORS[(err.body as { error?: string })?.error ?? ''] ?? fallback : fallback;

const TONE: Record<string, 'success' | 'warning' | 'gray' | 'danger'> = {
  active: 'success', pending: 'warning', suspended: 'danger', inactive: 'gray', removed: 'gray',
};

const EMPTY_ORG = { organizationType: 'insurer', legalName: '', tradingName: '', industrySector: '', registrationNumber: '', taxIdentificationNumber: '', email: '', phone: '' };

/**
 * B2B organisations: employers, insurers, clubs, banks and other sponsors,
 * their admin users and their beneficiaries. Companies from the Companies page
 * appear here as employers; Corporate still owns their details, HR logins and
 * staff, which show read-only.
 */
export default function AdminB2BPage() {
  const { token } = useApp();
  const [ref, setRef] = useState<B2BReference | null>(null);
  const [filter, setFilter] = useState({ type: '', status: '' });
  const [orgs, setOrgs] = useState<B2BOrganization[] | null>(null);
  const [selected, setSelected] = useState<B2BOrganization | null>(null);
  const [orgUsers, setOrgUsers] = useState<B2BOrganizationUser[] | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<B2BBeneficiary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newOrg, setNewOrg] = useState(EMPTY_ORG);
  const [userForm, setUserForm] = useState({ userId: '', role: 'admin' });
  const [benForm, setBenForm] = useState({ userId: '', beneficiaryType: 'member', externalReference: '', groupName: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState<B2BProgram[]>([]);
  const [programsKey, setProgramsKey] = useState(0);

  const load = async () => {
    if (!token) return;
    try {
      setOrgs((await api.b2bOrganizations(token, { ...filter, limit: 100 })).items);
    } catch {
      setError('Could not load organisations.');
      setOrgs([]);
    }
    // Programmes submitted by organisations, waiting for FitFlex to activate them.
    api.adminB2BPrograms(token, { status: 'pending', limit: 100 }).then(r => setAwaiting(r.items)).catch(() => setAwaiting([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { api.b2bReference().then(setRef).catch(() => setRef(null)); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, filter.type, filter.status]);

  const open = async (o: B2BOrganization) => {
    if (!token) return;
    setSelected(o);
    setCreating(false);
    setError(null);
    setNotice(null);
    setOrgUsers(null);
    setBeneficiaries(null);
    const [u, b] = await Promise.allSettled([
      api.b2bOrganizationUsers(token, o.id, { limit: 100 }),
      api.b2bBeneficiaries(token, o.id, { limit: 100 }),
    ]);
    setOrgUsers(u.status === 'fulfilled' ? u.value.items : []);
    setBeneficiaries(b.status === 'fulfilled' ? b.value.items : []);
  };

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const body = Object.fromEntries(Object.entries(newOrg).filter(([, v]) => v !== ''));
    return run(async () => {
      const { organization } = await api.createB2BOrganization(token, body);
      setNewOrg(EMPTY_ORG);
      await load();
      await open(organization);
      setNotice('Organisation created. It stays pending until you activate it.');
    }, 'Could not create the organisation.');
  };

  const sync = () => token && run(async () => {
    const { created } = await api.syncCorporateOrganizations(token);
    await load();
    setNotice(created ? `${created} compan${created === 1 ? 'y' : 'ies'} added as employer organisations.` : 'Every company already has its organisation.');
  }, 'Could not sync companies.');

  const setStatus = (status: string) => token && selected && run(async () => {
    const { organization } = await api.setB2BOrganizationStatus(token, selected.id, status);
    setSelected(organization);
    setOrgs(list => (list ?? []).map(o => (o.id === organization.id ? organization : o)));
  }, 'Could not change the status.');

  // Express the company's seat arrangement as a draft programme with a sponsored pass.
  const convertSeats = () => token && selected?.legacyCorporateId && run(async () => {
    const { program } = await api.convertCorporateToProgram(token, selected.legacyCorporateId!);
    setNotice(`Draft programme “${program.name}” created with a sponsored pass. Review it below, then submit and activate it. Seat bills stop once it is live.`);
    setProgramsKey(k => k + 1);
  }, 'Could not move seat billing (it may already be a programme).');

  const addUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selected) return;
    return run(async () => {
      const { organizationUser } = await api.addB2BOrganizationUser(token, selected.id, { userId: userForm.userId.trim(), role: userForm.role });
      setOrgUsers(list => [...(list ?? []), organizationUser]);
      setUserForm({ userId: '', role: userForm.role });
    }, 'Could not add the user.');
  };

  const changeUser = (u: B2BOrganizationUser, body: { role?: string; status?: string }) => token && selected && run(async () => {
    const { organizationUser } = await api.updateB2BOrganizationUser(token, selected.id, u.id, body);
    setOrgUsers(list => (list ?? [])
      .map(x => (x.id === organizationUser.id ? organizationUser : x))
      .filter(x => x.status !== 'removed'));
  }, 'Could not change that user.');

  const enroll = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selected) return;
    const body = Object.fromEntries(Object.entries({ ...benForm, userId: benForm.userId.trim() }).filter(([, v]) => v !== '')) as { userId: string };
    return run(async () => {
      const { beneficiary } = await api.enrollB2BBeneficiary(token, selected.id, body);
      setBeneficiaries(list => [...(list ?? []), beneficiary]);
      setBenForm({ userId: '', beneficiaryType: benForm.beneficiaryType, externalReference: '', groupName: '' });
    }, 'Could not enrol the member.');
  };

  const changeBeneficiary = (b: B2BBeneficiary, status: string) => token && selected && run(async () => {
    const { beneficiary } = await api.setB2BBeneficiaryStatus(token, selected.id, b.id, status);
    setBeneficiaries(list => (list ?? []).map(x => (x.id === beneficiary.id ? beneficiary : x)));
  }, 'Could not change that beneficiary.');

  const typeLabel = (t: string) => ref?.organizationTypes[t] ?? t;
  const nextStatuses = selected && ref ? ref.organizationStatuses[selected.status] ?? [] : [];
  const mapped = selected?.source === 'corporate';

  return (
    <div className="space-y-6">
      <PageHeader
        title="B2B organisations"
        description="Organisations that sponsor wellness for employees, policyholders, members or customers."
        actions={(
          <div className="flex gap-2">
            <Link href="/admin/b2b/usage"><Button variant="secondary" size="sm" data-testid="b2b-usage-link"><BarChart3 className="h-4 w-4" />Benefit usage</Button></Link>
            <Button variant="secondary" size="sm" onClick={sync} disabled={busy} data-testid="b2b-sync"><RefreshCw className="h-4 w-4" />Sync companies</Button>
            <Button size="sm" onClick={() => { setCreating(true); setSelected(null); setError(null); setNotice(null); }} data-testid="b2b-new"><Plus className="h-4 w-4" />New organisation</Button>
          </div>
        )}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {awaiting.length > 0 && (
        <Card>
          <CardHeader><span className="text-sm font-semibold">Programmes awaiting activation ({awaiting.length})</span></CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="programs-awaiting">
              {awaiting.map(p => {
                const org = orgs?.find(o => o.id === p.organizationId);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <span><span className="font-medium">{p.name}</span> <span className="text-[var(--color-fg-quaternary)]">{org?.legalName ?? p.organizationId} · from {p.startDate}</span></span>
                    {org && <Button size="sm" variant="secondary" onClick={() => open(org)}>Review</Button>}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <select className="ui-input w-auto" value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })} aria-label="Type">
                <option value="">All types</option>
                {ref && Object.entries(ref.organizationTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="ui-input w-auto" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} aria-label="Status">
                <option value="">All statuses</option>
                {['pending', 'active', 'suspended', 'inactive'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {orgs == null ? <Spinner className="h-6 w-6" /> : orgs.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-quaternary)]">No organisations yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="b2b-list">
                {orgs.map(o => (
                  <li key={o.id}>
                    <button onClick={() => open(o)} data-testid={`b2b-org-${o.id}`}
                      className={`flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm ${selected?.id === o.id ? 'font-semibold text-[var(--color-fg-brand)]' : ''}`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <Building2 className="h-4 w-4 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate">{o.legalName}</span>
                          <span className="block text-xs font-normal text-[var(--color-fg-quaternary)]">{typeLabel(o.organizationType)}</span>
                        </span>
                      </span>
                      <Badge tone={TONE[o.status] ?? 'gray'}>{o.status}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          {creating ? (
            <Card>
              <CardHeader><span className="text-sm font-semibold">New organisation</span></CardHeader>
              <CardContent>
                <form onSubmit={create} className="grid gap-3 sm:grid-cols-2" data-testid="b2b-create-form">
                  <Field label="Type">
                    <select className="ui-input" value={newOrg.organizationType} onChange={e => setNewOrg({ ...newOrg, organizationType: e.target.value })} data-testid="b2b-type">
                      {ref && Object.entries(ref.organizationTypes).filter(([k]) => k !== 'employer').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Legal name"><input className="ui-input" required value={newOrg.legalName} onChange={e => setNewOrg({ ...newOrg, legalName: e.target.value })} data-testid="b2b-legal-name" /></Field>
                  <Field label="Trading name"><input className="ui-input" value={newOrg.tradingName} onChange={e => setNewOrg({ ...newOrg, tradingName: e.target.value })} /></Field>
                  <Field label="Sector">
                    <select className="ui-input" value={newOrg.industrySector} onChange={e => setNewOrg({ ...newOrg, industrySector: e.target.value })}>
                      <option value="">—</option>
                      {ref && Object.entries(ref.industrySectors).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Registration number"><input className="ui-input" value={newOrg.registrationNumber} onChange={e => setNewOrg({ ...newOrg, registrationNumber: e.target.value })} /></Field>
                  <Field label="TIN"><input className="ui-input" value={newOrg.taxIdentificationNumber} onChange={e => setNewOrg({ ...newOrg, taxIdentificationNumber: e.target.value })} /></Field>
                  <Field label="Email"><input className="ui-input" type="email" value={newOrg.email} onChange={e => setNewOrg({ ...newOrg, email: e.target.value })} /></Field>
                  <Field label="Phone"><input className="ui-input" value={newOrg.phone} onChange={e => setNewOrg({ ...newOrg, phone: e.target.value })} /></Field>
                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
                    <Button type="submit" disabled={busy} data-testid="b2b-create">Create</Button>
                  </div>
                </form>
                <p className="mt-3 text-xs text-[var(--color-fg-quaternary)]">Employers are onboarded on the Companies page and appear here automatically.</p>
              </CardContent>
            </Card>
          ) : !selected ? (
            <Card><CardContent className="py-12 text-center text-sm text-[var(--color-fg-quaternary)]">Choose an organisation, or create one.</CardContent></Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{selected.legalName}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone="brand">{typeLabel(selected.organizationType)}</Badge>
                      <Badge tone={TONE[selected.status] ?? 'gray'}>{selected.status}</Badge>
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {([
                      ['Trading name', selected.tradingName], ['Sector', selected.industrySector && (ref?.industrySectors[selected.industrySector] ?? selected.industrySector)],
                      ['Registration no.', selected.registrationNumber], ['TIN', selected.taxIdentificationNumber],
                      ['Email', selected.email], ['Phone', selected.phone],
                      ['KYB', selected.kyc.supported ? selected.kyc.status?.replace(/_/g, ' ') : 'not available yet for this type'],
                    ] as const).map(([k, v]) => (
                      <div key={k} className="flex gap-2"><dt className="text-[var(--color-fg-quaternary)]">{k}</dt><dd>{v || '—'}</dd></div>
                    ))}
                  </dl>
                  {mapped ? (
                    <div className="space-y-2">
                      <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="b2b-mapped-note">
                        Company from the Companies page. Its details, status, HR logins and staff are managed there and shown here read-only.
                      </p>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={convertSeats} data-testid="b2b-convert-seats">Move seat billing to a programme</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2" data-testid="b2b-status-actions">
                      {nextStatuses.map(s => (
                        <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => setStatus(s)} data-testid={`b2b-status-${s}`}>
                          {s === 'active' ? 'Activate' : s === 'suspended' ? 'Suspend' : 'Deactivate'}
                        </Button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><span className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4" />Organisation users</span></CardHeader>
                <CardContent className="space-y-3">
                  {orgUsers == null ? <Spinner className="h-6 w-6" /> : orgUsers.length === 0 ? (
                    <p className="text-sm text-[var(--color-fg-quaternary)]">No users yet.</p>
                  ) : (
                    <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="b2b-users">
                      {orgUsers.map(u => (
                        <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                          <span>
                            <span className="font-medium">{u.user?.displayName ?? u.userId}</span>{' '}
                            <span className="text-[var(--color-fg-quaternary)]">{u.user?.email}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            {u.readOnly ? <Badge tone="gray">{u.role} · Companies</Badge> : (
                              <select className="ui-input w-auto py-1" value={u.role} disabled={busy} onChange={e => changeUser(u, { role: e.target.value })} aria-label="Role">
                                {ref?.organizationUserRoles.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            )}
                            <Badge tone={TONE[u.status] ?? 'gray'}>{u.status}</Badge>
                            {!u.readOnly && (
                              <>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeUser(u, { status: u.status === 'active' ? 'suspended' : 'active' })}>
                                  {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                                </Button>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeUser(u, { status: 'removed' })}>Remove</Button>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form onSubmit={addUser} className="grid gap-2 sm:grid-cols-3" data-testid="b2b-user-form">
                    <input className="ui-input sm:col-span-1" placeholder="FitFlex user ID (usr_…)" required value={userForm.userId} onChange={e => setUserForm({ ...userForm, userId: e.target.value })} data-testid="b2b-user-id" />
                    <select className="ui-input" value={userForm.role} onChange={e => setUserForm({ ...userForm, role: e.target.value })} aria-label="Role" data-testid="b2b-user-role">
                      {ref?.organizationUserRoles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <Button type="submit" disabled={busy} data-testid="b2b-user-add">Add user</Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><span className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" />Beneficiaries</span></CardHeader>
                <CardContent className="space-y-3">
                  {beneficiaries == null ? <Spinner className="h-6 w-6" /> : beneficiaries.length === 0 ? (
                    <p className="text-sm text-[var(--color-fg-quaternary)]">No beneficiaries yet.</p>
                  ) : (
                    <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="b2b-beneficiaries">
                      {beneficiaries.map(b => (
                        <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                          <span>
                            <span className="font-medium">{b.displayName ?? b.userId ?? b.id}</span>{' '}
                            <span className="text-[var(--color-fg-quaternary)]">
                              {[ref?.beneficiaryTypes[b.beneficiaryType] ?? b.beneficiaryType, b.groupName, b.externalReference].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <Badge tone={TONE[b.status] ?? 'gray'}>{b.status}</Badge>
                            {b.readOnly ? <Badge tone="gray">Companies</Badge> : (ref?.beneficiaryStatuses[b.status] ?? []).map(s => (
                              <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => changeBeneficiary(b, s)}>
                                {s === 'active' ? 'Activate' : s === 'suspended' ? 'Suspend' : 'Deactivate'}
                              </Button>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!mapped && (
                    <form onSubmit={enroll} className="grid gap-2 sm:grid-cols-2" data-testid="b2b-beneficiary-form">
                      <input className="ui-input" placeholder="Member's FitFlex user ID (usr_…)" required value={benForm.userId} onChange={e => setBenForm({ ...benForm, userId: e.target.value })} data-testid="b2b-ben-user-id" />
                      <select className="ui-input" value={benForm.beneficiaryType} onChange={e => setBenForm({ ...benForm, beneficiaryType: e.target.value })} aria-label="Beneficiary type">
                        {ref && Object.entries(ref.beneficiaryTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input className="ui-input" placeholder="Reference (policy / staff no.)" value={benForm.externalReference} onChange={e => setBenForm({ ...benForm, externalReference: e.target.value })} />
                      <input className="ui-input" placeholder="Group / department" value={benForm.groupName} onChange={e => setBenForm({ ...benForm, groupName: e.target.value })} />
                      <div className="sm:col-span-2 flex justify-end">
                        <Button type="submit" disabled={busy} data-testid="b2b-ben-enroll">Enrol member</Button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>

              {token && <B2BPrograms key={`${selected.id}-${programsKey}`} token={token} org={selected} beneficiaries={beneficiaries ?? []} onChanged={load} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
