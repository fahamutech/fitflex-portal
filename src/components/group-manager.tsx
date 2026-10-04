'use client';
import { useEffect, useState } from 'react';
import { Copy, Lock, Plus, RefreshCw, Users } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, ApiError, GroupInput, GroupMember, GroupMemberAction, SocialGroup } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, Field, PageHeader, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';

const ERRORS: Record<string, string> = {
  invalid_name: 'Give the group a name.',
  not_found: 'That group isn’t available any more.',
};
const message = (err: unknown) =>
  err instanceof ApiError ? ERRORS[(err.body as { error?: string })?.error ?? ''] ?? 'Something went wrong.' : 'Something went wrong.';

/**
 * Company HR: groups for employees. Employees join with the invite code
 * (or find a listed group in the app) and can share activities with the
 * group. HR manages the group but never sees anyone's activity through it.
 */
export function GroupManager({ organizationId }: { organizationId?: string }) {
  const { token } = useApp();
  const [groups, setGroups] = useState<SocialGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SocialGroup | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // A company has employees; a B2B organisation (an insurer, a club) has people.
  const people = organizationId ? 'people' : 'employees';
  const place = organizationId ? 'your organisation' : 'the company';

  const load = async () => {
    if (!token) return;
    setError(null);
    try {
      setGroups((await api.corporateGroups(token, organizationId)).groups);
    } catch (err) {
      setError(message(err));
      setGroups([]);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, organizationId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Groups"
        description={`Groups your ${people} join to share activities with each other: a walking club, a team, a floor.`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>
            <Button size="sm" onClick={() => setEditing('new')} data-testid="group-new"><Plus className="h-4 w-4" />New group</Button>
          </div>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardContent className="p-0">
          {groups == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : groups.length === 0 ? (
            <p className="p-10 text-center text-sm text-[var(--color-fg-quaternary)]">No groups yet. Create one and share its invite code with your {people}.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="group-list">
              {groups.map(g => (
                <li key={g.id}>
                  <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen(g.id)} data-testid={`group-${g.id}`}>
                    <span>
                      <span className="flex items-center gap-2 font-medium"><Users className="h-4 w-4" />{g.name}</span>
                      <span className="text-xs text-[var(--color-fg-quaternary)]">
                        {g.memberCount} members · {g.joinPolicy === 'open' ? `Anyone at ${place} can join` : 'You approve members'}{g.discoverable ? ' · Listed in the app' : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {(g.pending ?? 0) > 0 && <Badge tone="warning">{g.pending} waiting</Badge>}
                      {g.inviteCode && <span className="font-mono text-sm">{g.inviteCode}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="flex items-start gap-2 text-xs text-[var(--color-fg-quaternary)]">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        These groups are for your {people} only. Members see what they choose to share with each other; you see who is in the group, never anyone’s activity.
      </p>
      {editing && token && (
        <GroupForm org={!!organizationId} existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSave={async body => {
            if (editing === 'new') {
              const { group } = await api.createCorporateGroup(token, body, organizationId);
              setOpen(group.id);
            } else {
              await api.updateCorporateGroup(token, editing.id, body, organizationId);
            }
            setEditing(null);
            await load();
          }} />
      )}
      {open && token && <GroupDetail organizationId={organizationId} id={open} onClose={() => { setOpen(null); load(); }} onEdit={g => setEditing(g)} />}
    </div>
  );
}

function GroupForm({ org, existing, onClose, onSave }: { org: boolean; existing: SocialGroup | null; onClose: () => void; onSave: (b: GroupInput) => Promise<void> }) {
  const [f, setF] = useState<GroupInput>({
    name: existing?.name ?? '', description: existing?.description ?? '',
    joinPolicy: existing?.joinPolicy ?? 'open', discoverable: existing?.discoverable ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title={existing ? 'Edit group' : 'New group'} size="md">
      <form className="space-y-4" data-testid="group-form" onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try { await onSave({ ...f, name: f.name.trim(), description: f.description?.trim() }); } catch (err) { setError(message(err)); setBusy(false); }
      }}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name"><input className="ui-input" required maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Finance walking club" data-testid="group-name" /></Field>
        <Field label="Description (optional)"><textarea className="ui-input" rows={2} maxLength={300} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" aria-label={`Anyone at ${org ? 'your organisation' : 'the company'} can join`} checked={f.joinPolicy === 'open'} onChange={e => setF({ ...f, joinPolicy: e.target.checked ? 'open' : 'approval' })} />
          <span>Anyone at {org ? 'your organisation' : 'the company'} can join<span className="block text-xs text-[var(--color-fg-quaternary)]">Off: you approve each request. People with the invite code always get in.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" aria-label="Listed in the app" checked={f.discoverable} onChange={e => setF({ ...f, discoverable: e.target.checked })} />
          <span>Listed in the app<span className="block text-xs text-[var(--color-fg-quaternary)]">{org ? 'Your people' : 'Employees'} can find it under Groups. Off: invite code only.</span></span>
        </label>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} data-testid="group-save">{existing ? 'Save' : 'Create group'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function GroupDetail({ id, organizationId, onClose, onEdit }: { id: string; organizationId?: string; onClose: () => void; onEdit: (g: SocialGroup) => void }) {
  const { token } = useApp();
  const [g, setG] = useState<SocialGroup | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      const r = await api.corporateGroup(token, id, organizationId);
      setG(r.group);
      setMembers(r.members);
    } catch (err) { setError(message(err)); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, id]);

  const act = async (userId: string, action: GroupMemberAction) => {
    if (!token) return;
    try {
      const r = await api.corporateGroupMember(token, id, userId, action, organizationId);
      setMembers(r.members);
      setG(r.group);
    } catch (err) { setError(message(err)); }
  };

  const close = async () => {
    if (!token || !window.confirm('Close this group? Members lose it, and what they shared with it is no longer shown to each other.')) return;
    await api.archiveCorporateGroup(token, id, organizationId);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={g?.name ?? 'Group'} description={g?.description ?? undefined} size="lg">
      {error && <Alert tone="error">{error}</Alert>}
      {!g ? <Spinner className="h-6 w-6" /> : (
        <div className="space-y-4" data-testid="group-detail">
          {g.inviteCode && (
            <Card>
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-[var(--color-fg-tertiary)]">Invite code</p>
                  <p className="font-mono text-2xl font-bold tracking-widest" data-testid="group-code">{g.inviteCode}</p>
                  <p className="text-xs text-[var(--color-fg-quaternary)]">{organizationId ? 'Your people' : 'Employees'} enter it in the FitFlex app under Friends &amp; groups → Groups → Join with code.</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => { navigator.clipboard?.writeText(g.inviteCode!); setCopied(true); }}>
                  <Copy className="h-4 w-4" />{copied ? 'Copied' : 'Copy'}
                </Button>
              </CardContent>
            </Card>
          )}
          <div>
            <p className="mb-2 text-sm font-semibold">Members ({g.memberCount})</p>
            {members.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No one yet. Share the invite code.</p> : (
              <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="group-members">
                {members.map(m => (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{m.displayName ?? 'Member'}</span>
                      {m.role === 'admin' && <Badge tone="brand">Admin</Badge>}
                      {m.status === 'pending' && <Badge tone="warning">Waiting</Badge>}
                    </span>
                    <span className="flex gap-2">
                      {m.status === 'pending' && <Button size="sm" onClick={() => act(m.id, 'approve')} data-testid={`approve-${m.id}`}>Approve</Button>}
                      {m.status === 'active' && m.role !== 'admin' && <Button size="sm" variant="secondary" onClick={() => act(m.id, 'make_admin')}>Make admin</Button>}
                      {m.role === 'admin' && <Button size="sm" variant="secondary" onClick={() => act(m.id, 'make_member')}>Remove admin</Button>}
                      <Button size="sm" variant="secondary" onClick={() => act(m.id, 'remove')}>Remove</Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="flex items-start gap-2 text-xs text-[var(--color-fg-quaternary)]">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Member admins can approve people from the app too. You never see what members share with the group.
          </p>
          <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
            <Button variant="secondary" onClick={() => onEdit(g)}>Edit</Button>
            <Button variant="secondary" onClick={close}>Close group</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
