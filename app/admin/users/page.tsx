'use client';
import { useEffect, useState } from 'react';
import {
  Plus, Trash2, RefreshCw, ShieldCheck, ShieldOff, Pencil, Lock,
} from 'lucide-react';
import { useApp } from '../../providers';
import { api, PortalUser, ApiError } from '@/lib/api';
import {
  Button, PageHeader, Alert, Spinner, Card, Badge, Field,
} from '@/components/shared';
import { ConfirmDialog } from '@/components/dialog';

const ACL_SCOPES = [
  { key: 'gyms',      label: 'Gyms' },
  { key: 'owners',    label: 'Owners' },
  { key: 'trainers',  label: 'Trainers' },
  { key: 'members',   label: 'Members' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'challenges', label: 'Challenges' },
  { key: 'rewards', label: 'Rewards' },
  { key: 'social', label: 'Community moderation' },
  { key: 'corporate', label: 'Companies' },
  { key: 'b2b',       label: 'B2B organisations' },
  { key: 'vendors',   label: 'Vendor outreach' },
  { key: 'shop',      label: 'Products' },
  { key: 'payments',  label: 'Payments' },
  { key: 'settlements_prepare', label: 'Settlements: prepare' },
  { key: 'settlements_approve', label: 'Settlements: approve' },
  { key: 'settlements_pay',     label: 'Settlements: pay' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'kyc',       label: 'Partner verification' },
  { key: 'settings',  label: 'Settings' },
  { key: 'users',     label: 'Portal Users' },
  { key: 'communications', label: 'Messages' },
] as const;

type AclScope = typeof ACL_SCOPES[number]['key'];

const ROLE_PRESETS = [
  { key: 'custom',      label: 'Custom',      scopes: [] as AclScope[] },
  { key: 'sales',       label: 'Sales Person', scopes: ['gyms', 'owners', 'trainers', 'members'] as AclScope[] },
  { key: 'finance',     label: 'Finance',      scopes: ['payments', 'approvals'] as AclScope[] },
  { key: 'operations',  label: 'Operations',   scopes: ['gyms', 'trainers', 'members', 'approvals', 'kyc'] as AclScope[] },
] as const;

type RolePreset = typeof ROLE_PRESETS[number]['key'];

interface CreateForm {
  email: string;
  password: string;
  displayName: string;
  aclPermissions: AclScope[];
}

const EMPTY_FORM: CreateForm = { email: '', password: '', displayName: '', aclPermissions: [] };

export default function PortalUsersPage() {
  const { token, user } = useApp();
  const [users, setUsers]           = useState<PortalUser[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating]     = useState(false);
  const [rolePreset, setRolePreset] = useState<RolePreset>('custom');
  const [editRolePreset, setEditRolePreset] = useState<RolePreset>('custom');
  const [editTarget, setEditTarget]       = useState<PortalUser | null>(null);
  const [editPerms, setEditPerms]          = useState<AclScope[]>([]);
  const [editStatus, setEditStatus]        = useState<'active' | 'suspended'>('active');
  const [editIsPortalUser, setEditIsPortalUser] = useState(true);
  const [saving, setSaving]           = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PortalUser | null>(null);
  const [deleting, setDeleting]         = useState(false);

  const isSuperAdmin = user?.userType === 'admin' && !user?.portalUser;

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const list = await api.listPortalUsers(token);
      setUsers(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portal users');
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  function flash(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3500);
  }

  function applyRolePreset(key: RolePreset, target: 'create' | 'edit') {
    const preset = ROLE_PRESETS.find(p => p.key === key);
    if (!preset) return;
    if (target === 'create') {
      setRolePreset(key);
      if (key !== 'custom') setForm(f => ({ ...f, aclPermissions: [...preset.scopes] as AclScope[] }));
    } else {
      setEditRolePreset(key);
      if (key !== 'custom') setEditPerms([...preset.scopes] as AclScope[]);
    }
  }

  function toggleFormPerm(scope: AclScope) {
    setRolePreset('custom');
    setForm(f => ({
      ...f,
      aclPermissions: f.aclPermissions.includes(scope)
        ? f.aclPermissions.filter(p => p !== scope)
        : [...f.aclPermissions, scope],
    }));
  }

  function toggleEditPerm(scope: AclScope) {
    setEditRolePreset('custom');
    setEditPerms(prev =>
      prev.includes(scope) ? prev.filter(p => p !== scope) : [...prev, scope]
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createPortalUser(token, {
        email: form.email,
        password: form.password,
        displayName: form.displayName || undefined,
        aclPermissions: form.aclPermissions,
      });
      setUsers(prev => [...prev, created]);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      flash(`Portal user ${created.email} created successfully.`);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as any) : null;
      setError(body?.error === 'email_already_exists'
        ? 'A user with this email already exists.'
        : body?.error === 'firebase_user_creation_failed'
          ? `Firebase error: ${body?.detail}`
          : (err instanceof Error ? err.message : 'Failed to create user'));
    } finally {
      setCreating(false);
    }
  }

  function openEdit(u: PortalUser) {
    setEditTarget(u);
    setEditPerms(u.aclPermissions as AclScope[]);
    setEditStatus(u.accountStatus);
    setEditIsPortalUser(u.portalUser);
    setEditRolePreset('custom');
  }

  async function handleSaveEdit() {
    if (!token || !editTarget) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updatePortalUser(token, editTarget.id, {
        aclPermissions: editPerms,
        accountStatus: editStatus,
        portalUser: editIsPortalUser,
      });
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
      setEditTarget(null);
      flash('Permissions updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || !isSuperAdmin || !deleteTarget) return;
    setDeleting(true);
    try {
      await api.deletePortalUser(token, deleteTarget.id);
      setUsers(prev => prev.filter(x => x.id !== deleteTarget.id));
      flash(`User ${deleteTarget.email} deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portal Users"
        description="Manage staff accounts that can access this admin portal. Only super-admins can create or delete portal users."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {isSuperAdmin && (
              <Button variant="primary" size="sm" onClick={() => setShowCreate(v => !v)}>
                <Plus className="h-4 w-4" /> New user
              </Button>
            )}
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {/* Create form */}
      {showCreate && isSuperAdmin && (
        <Card>
          <div className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">Create portal staff user</h3>
            <p className="text-xs text-[var(--color-fg-quaternary)]">
              This will register the user in Firebase with email/password and store them with the selected ACL permissions.
              They will sign in using their email and password on the login page.
            </p>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Email" hint="Used to log in">
                  <input
                    type="email"
                    className="ui-input"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    required
                  />
                </Field>
                <Field label="Temporary password" hint="User should change after first login">
                  <input
                    type="password"
                    className="ui-input"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    minLength={8}
                    required
                  />
                </Field>
                <Field label="Display name" hint="Optional">
                  <input
                    type="text"
                    className="ui-input"
                    value={form.displayName}
                    onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                  />
                </Field>
              </div>

              <div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-[var(--color-fg-secondary)]">Role preset:</p>
                    {ROLE_PRESETS.map(rp => (
                      <button
                        key={rp.key}
                        type="button"
                        onClick={() => applyRolePreset(rp.key as RolePreset, 'create')}
                        className={`px-3 py-1 text-xs rounded-full font-medium border transition-colors ${
                          rolePreset === rp.key
                            ? 'bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]'
                            : 'border-[var(--color-border-secondary)] text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                        }`}
                      >
                        {rp.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs font-medium text-[var(--color-fg-secondary)]">ACL Permissions</p>
                  <div className="flex flex-wrap gap-2">
                    {ACL_SCOPES.map(s => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => toggleFormPerm(s.key)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          form.aclPermissions.includes(s.key)
                            ? 'bg-[var(--color-brand-600)] border-[var(--color-brand-600)] text-white'
                            : 'border-[var(--color-border-secondary)] text-[var(--color-fg-tertiary)] hover:border-[var(--color-brand-400)]'
                        }`}
                      >
                        {form.aclPermissions.includes(s.key)
                          ? <ShieldCheck className="h-3 w-3" />
                          : <ShieldOff className="h-3 w-3" />}
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {form.aclPermissions.length === 0 && (
                    <p className="mt-1.5 text-xs text-[var(--color-warning-700)]">No permissions selected — user can log in but will see no data.</p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" disabled={creating}>
                  {creating ? <><Spinner className="h-3.5 w-3.5" /> Creating…</> : 'Create user'}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); setError(null); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </Card>
      )}

      {/* Edit permissions dialog */}
      {editTarget && (
        <Card>
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">
                Edit permissions — <span className="font-mono text-[var(--color-brand-600)]">{editTarget.email}</span>
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)}>Discard</Button>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-[var(--color-fg-secondary)]">Role preset:</p>
                {ROLE_PRESETS.map(rp => (
                  <button
                    key={rp.key}
                    type="button"
                    onClick={() => applyRolePreset(rp.key as RolePreset, 'edit')}
                    className={`px-3 py-1 text-xs rounded-full font-medium border transition-colors ${
                      editRolePreset === rp.key
                        ? 'bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]'
                        : 'border-[var(--color-border-secondary)] text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                    }`}
                  >
                    {rp.label}
                  </button>
                ))}
              </div>
              <p className="text-xs font-medium text-[var(--color-fg-secondary)]">ACL Permissions</p>
              <div className="flex flex-wrap gap-2">
                {ACL_SCOPES.map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggleEditPerm(s.key)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      editPerms.includes(s.key)
                        ? 'bg-[var(--color-brand-600)] border-[var(--color-brand-600)] text-white'
                        : 'border-[var(--color-border-secondary)] text-[var(--color-fg-tertiary)] hover:border-[var(--color-brand-400)]'
                    }`}
                  >
                    {editPerms.includes(s.key)
                      ? <ShieldCheck className="h-3 w-3" />
                      : <ShieldOff className="h-3 w-3" />}
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-[var(--color-fg-secondary)]">Account status</label>
                <select
                  className="ui-input !w-auto !py-1 !text-xs"
                  value={editStatus}
                  onChange={e => setEditStatus(e.target.value as 'active' | 'suspended')}
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
              {isSuperAdmin && (
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-[var(--color-fg-secondary)]">User type</label>
                  <select
                    className="ui-input !w-auto !py-1 !text-xs"
                    value={editIsPortalUser ? 'portal' : 'super_admin'}
                    onChange={e => setEditIsPortalUser(e.target.value === 'portal')}
                  >
                    <option value="portal">Portal staff (ACL-scoped)</option>
                    <option value="super_admin">Super admin (all access)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={handleSaveEdit} disabled={saving}>
                {saving ? <><Spinner className="h-3.5 w-3.5" /> Saving…</> : 'Save changes'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setEditTarget(null)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Users table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-7 w-7" /></div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            {users.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-[var(--color-fg-quaternary)]">
                No portal users yet. Create one above.
              </p>
            ) : (
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Permissions</th>
                    <th>Created</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div className="font-medium text-[var(--color-fg-primary)] text-sm">
                          {u.displayName || u.email}
                        </div>
                        {u.displayName && (
                          <div className="text-xs text-[var(--color-fg-quaternary)]">{u.email}</div>
                        )}
                      </td>
                      <td>
                        <Badge tone={u.portalUser ? 'brand' : 'default'}>
                          {u.portalUser ? 'Portal staff' : 'Super admin'}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={u.accountStatus === 'active' ? 'success' : 'danger'}>
                          {u.accountStatus}
                        </Badge>
                      </td>
                      <td>
                        {!u.portalUser ? (
                          <span className="text-xs text-[var(--color-fg-quaternary)] italic">All access</span>
                        ) : u.aclPermissions.length === 0 ? (
                          <span className="text-xs text-[var(--color-warning-700)]">No permissions</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {u.aclPermissions.map(p => (
                              <span
                                key={p}
                                className="rounded-full bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-brand-700)] capitalize"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="text-xs tabular-nums text-[var(--color-fg-quaternary)]">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        {u.isEnvAdmin ? (
                          <span
                            title="Managed via FITFLEX_ADMIN_EMAILS environment variable"
                            className="inline-flex items-center gap-1 text-xs text-[var(--color-fg-quaternary)]"
                          >
                            <Lock className="h-3.5 w-3.5" /> env-protected
                          </span>
                        ) : (u.portalUser || isSuperAdmin) ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(u)}
                              title="Edit permissions"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {isSuperAdmin && u.portalUser && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteTarget(u)}
                                title="Delete user"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        tone="danger"
        busy={deleting}
        title="Delete portal user"
        description={`Remove ${deleteTarget?.displayName || deleteTarget?.email} from the portal? Their Firebase account will also be deleted. This cannot be undone.`}
        confirmLabel="Delete user"
        cancelLabel="Cancel"
      />
    </div>
  );
}
