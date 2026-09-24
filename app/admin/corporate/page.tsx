'use client';
import { useEffect, useState } from 'react';
import { Building2, KeyRound, RefreshCw, UserPlus } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ApiError, CorporateAccount, HrUser } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, PageHeader, Spinner } from '@/components/shared';

const ERRORS: Record<string, string> = {
  invalid_email: 'Enter a valid work email.',
  name_required: 'Enter the HR contact’s name.',
  password_too_short: 'The initial password needs at least 10 characters.',
  email_in_use: 'That email already has an HR login.',
};

/**
 * Companies and their HR logins. HR users sign in to this portal with the
 * email and initial password set here, and only ever see their company's
 * challenge totals.
 */
export default function AdminCorporatePage() {
  const { token } = useApp();
  const [accounts, setAccounts] = useState<CorporateAccount[] | null>(null);
  const [selected, setSelected] = useState<CorporateAccount | null>(null);
  const [hr, setHr] = useState<HrUser[] | null>(null);
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      setAccounts(await api.corporateAccounts(token));
    } catch {
      setError('Could not load companies.');
      setAccounts([]);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const openAccount = async (a: CorporateAccount) => {
    if (!token) return;
    setSelected(a);
    setHr(null);
    setError(null);
    setNotice(null);
    try {
      setHr((await api.hrUsers(token, a.id)).hrUsers);
    } catch {
      setError('Could not load HR logins.');
      setHr([]);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const { hrUser } = await api.createHrUser(token, selected.id, form);
      setHr(list => [...(list ?? []), hrUser]);
      setForm({ displayName: '', email: '', password: '' });
      setNotice(`HR login created for ${hrUser.email}. Share the initial password with them securely.`);
    } catch (err) {
      setError(err instanceof ApiError ? ERRORS[(err.body as any)?.error] ?? 'Could not create the login.' : 'Could not create the login.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (u: HrUser, status: 'active' | 'suspended') => {
    if (!token || !selected) return;
    try {
      const { hrUser } = await api.setHrUserStatus(token, selected.id, u.id, status);
      setHr(list => (list ?? []).map(x => (x.id === hrUser.id ? hrUser : x)));
    } catch {
      setError('Could not change that login.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description="Corporate wellness accounts and the HR logins that manage their challenges."
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader><span className="text-sm font-semibold">Accounts</span></CardHeader>
          <CardContent>
            {accounts == null ? <Spinner className="h-6 w-6" /> : accounts.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-quaternary)]">No corporate accounts yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border-secondary)]">
                {accounts.map(a => (
                  <li key={a.id}>
                    <button onClick={() => openAccount(a)} data-testid={`company-${a.id}`}
                      className={`flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm ${selected?.id === a.id ? 'font-semibold text-[var(--color-fg-brand)]' : ''}`}>
                      <span className="flex items-center gap-2"><Building2 className="h-4 w-4" />{a.companyName}</span>
                      <Badge tone={a.status === 'active' ? 'success' : 'gray'}>{a.status}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          {!selected ? (
            <Card><CardContent className="py-12 text-center text-sm text-[var(--color-fg-quaternary)]">Choose a company to manage its HR logins.</CardContent></Card>
          ) : (
            <>
              {error && <Alert tone="error">{error}</Alert>}
              {notice && <Alert tone="success">{notice}</Alert>}
              <Card>
                <CardHeader><span className="text-sm font-semibold">HR logins · {selected.companyName}</span></CardHeader>
                <CardContent>
                  {hr == null ? <Spinner className="h-6 w-6" /> : hr.length === 0 ? (
                    <p className="text-sm text-[var(--color-fg-quaternary)]">No HR logins yet.</p>
                  ) : (
                    <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="hr-list">
                      {hr.map(u => (
                        <li key={u.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                          <span><span className="font-medium">{u.displayName}</span> <span className="text-[var(--color-fg-quaternary)]">{u.email}</span></span>
                          <span className="flex items-center gap-2">
                            <Badge tone={u.accountStatus === 'active' ? 'success' : 'warning'}>{u.accountStatus}</Badge>
                            {u.accountStatus === 'active'
                              ? <Button size="sm" variant="secondary" onClick={() => setStatus(u, 'suspended')}>Suspend</Button>
                              : <Button size="sm" variant="secondary" onClick={() => setStatus(u, 'active')}>Reactivate</Button>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><span className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4" />Add an HR login</span></CardHeader>
                <CardContent>
                  <form onSubmit={add} className="grid gap-3 sm:grid-cols-2" data-testid="hr-form">
                    <Field label="Name"><input className="ui-input" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} required data-testid="hr-name" /></Field>
                    <Field label="Work email"><input className="ui-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required data-testid="hr-email" /></Field>
                    <Field label="Initial password (10+ characters)">
                      <input className="ui-input" type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required data-testid="hr-password" />
                    </Field>
                    <div className="flex items-end">
                      <Button type="submit" disabled={busy} className="w-full" data-testid="hr-create"><KeyRound className="h-4 w-4" />Create login</Button>
                    </div>
                  </form>
                  <p className="mt-3 text-xs text-[var(--color-fg-quaternary)]">
                    HR signs in to this portal under “Company HR”. They manage their company’s challenges and see participation, completion and team progress, never an employee’s personal activity.
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
