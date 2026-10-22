'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api, type OrganizerRole, type OrganizerStaffRow } from '@/lib/api';
import { INVITABLE_ROLES, STAFF_STATUS, errorCode, errorKey, eventDay, fmt, isEmail, isTzPhone, maskContact, roleDescKey, roleKey } from '@/lib/events';
import { Badge, Button, Card, CardContent, Field, Input, PageHeader, Radio, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';
import { useOrganizer } from '@/components/organizer-context';
import { OrganizerPage, PageError, PageLoading, useDocumentTitle } from '@/components/organizer/page-states';
import { useApp } from '../../providers';

function RoleRadios({ value, onChange, name }: { value: OrganizerRole; onChange: (r: OrganizerRole) => void; name: string }) {
  const { t } = useApp();
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('organizer.staff.role')}</legend>
      {INVITABLE_ROLES.map(r => (
        <Radio key={r} name={name} value={r} checked={value === r} onChange={() => onChange(r)} label={t(roleKey(r))} description={t(roleDescKey(r))} data-testid={`staff-role-${r}`} />
      ))}
    </fieldset>
  );
}

function StaffInner() {
  const { t, token, locale, user } = useApp();
  const org = useOrganizer();
  const toast = useToast();
  const [rows, setRows] = useState<OrganizerStaffRow[] | null>(null);
  const [error, setError] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<OrganizerRole>('ops');
  const [contactError, setContactError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleTarget, setRoleTarget] = useState<OrganizerStaffRow | null>(null);
  const [newRole, setNewRole] = useState<OrganizerRole>('ops');
  const [removeTarget, setRemoveTarget] = useState<OrganizerStaffRow | null>(null);
  useDocumentTitle(t('organizer.staff.title'));

  const load = useCallback(async () => {
    if (!token) return;
    setError(false);
    try { setRows((await api.organizerStaff(token)).items ?? []); } catch { setError(true); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const myRole = org.role;
  const nameOf = (r: OrganizerStaffRow) => r.displayName || t('organizer.staff.unnamed');
  // Owner rows have no actions; an admin cannot remove or re-role another admin (§9.1).
  const canAct = (r: OrganizerStaffRow) => r.role !== 'owner' && r.status !== 'removed' && r.userId !== user?.id && (myRole === 'owner' || (myRole === 'admin' && r.role !== 'admin'));

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    const value = contact.trim();
    // Email or Tanzanian phone only: the backend refuses anything else (400 invalid_contact), including user ids.
    if (!value || (!isEmail(value) && !isTzPhone(value))) { setContactError(t('organizer.staff.invalidContact')); return; }
    setContactError(null); setBusy(true);
    try {
      await api.inviteOrganizerStaff(token, { ...(isEmail(value) ? { email: value } : { phone: value }), role });
      toast.success(t('organizer.staff.sent'));
      setInviteOpen(false); setContact(''); setRole('ops');
      await load();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'already_staff') setContactError(t('organizer.staff.alreadyStaff'));
      else if (code === 'invalid_contact' || code === 'invalid_email') setContactError(t('organizer.staff.invalidContact'));
      else if (code === 'cannot_invite_self') setContactError(t('organizer.staff.cannotInviteSelf'));
      else toast.error(t(errorKey(err)));
    } finally { setBusy(false); }
  }
  async function changeRole() {
    if (!token || !roleTarget) return;
    setBusy(true);
    try { await api.changeOrganizerStaffRole(token, roleTarget.id, newRole); toast.success(t('organizer.staff.roleChanged')); setRoleTarget(null); await load(); }
    catch (err) { toast.error(t(errorKey(err))); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!token || !removeTarget) return;
    setBusy(true);
    try { await api.removeOrganizerStaff(token, removeTarget.id); toast.success(t('organizer.staff.removed')); setRemoveTarget(null); await load(); }
    catch (err) { toast.error(t(errorKey(err))); }
    finally { setBusy(false); }
  }

  if (error) return <PageError onRetry={() => void load()} />;
  if (!rows) return <PageLoading table />;

  const columns: ColumnDef<OrganizerStaffRow>[] = [
    { key: 'displayName', header: t('organizer.staff.col.person'), sortable: true, cell: r => (
      <div className="min-w-0"><p className="font-medium text-[var(--color-fg-primary)]">{nameOf(r)}</p><p className="text-xs text-[var(--color-fg-quaternary)]">{maskContact(r.maskedContact)}</p></div>
    ) },
    { key: 'role', header: t('organizer.staff.col.role'), sortable: true, cell: r => <Badge tone="brand">{t(roleKey(r.role))}</Badge> },
    { key: 'status', header: t('organizer.staff.col.status'), sortable: true, cell: r => { const s = STAFF_STATUS[r.status] ?? STAFF_STATUS.invited; return <Badge tone={s.tone}>{t(s.key)}</Badge>; } },
    { key: 'addedAt', header: t('organizer.staff.col.added'), sortable: true, cell: r => eventDay(r.addedAt, org.organizer?.timezone, locale) },
  ];

  return (
    <div className="space-y-4" data-testid="organizer-staff">
      <PageHeader title={t('organizer.staff.title')} actions={<Button onClick={() => setInviteOpen(true)} data-testid="staff-invite"><UserPlus aria-hidden="true" className="h-4 w-4" />{t('organizer.staff.invite')}</Button>} />
      <Card><CardContent>
        <DataTable
          columns={columns} data={rows.filter(r => r.status !== 'removed')} keyFn={r => r.id} label={t('organizer.staff.tableLabel')} stickyActions
          emptyState={t('common.noRecords')}
          actions={r => canAct(r) ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setRoleTarget(r); setNewRole(r.role === 'owner' ? 'admin' : r.role); }} data-testid={`staff-change-role-${r.id}`}>{t('organizer.staff.changeRole')}</Button>
              <Button variant="ghost" size="sm" className="text-[var(--color-error-700)]" onClick={() => setRemoveTarget(r)} data-testid={`staff-remove-${r.id}`}>{t('organizer.staff.remove.action')}</Button>
            </>
          ) : null}
        />
        <p className="mt-4 text-xs text-[var(--color-fg-quaternary)]">{t('organizer.staff.s2Note')}</p>
      </CardContent></Card>

      <Dialog open={inviteOpen} onClose={() => { setInviteOpen(false); setContactError(null); }} title={t('organizer.staff.inviteTitle')} size="md">
        <form onSubmit={invite} className="space-y-4" noValidate id="staff-invite-form">
          <Field label={t('organizer.staff.contact')} hint={t('organizer.staff.contactHint')} error={contactError} required>
            <Input value={contact} onChange={e => setContact(e.target.value)} autoComplete="off" data-testid="staff-contact" />
          </Field>
          <RoleRadios value={role} onChange={setRole} name="invite-role" />
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setInviteOpen(false)}>{t('common.cancel')}</Button>
          <Button type="submit" form="staff-invite-form" loading={busy} data-testid="staff-send">{t('organizer.staff.send')}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!roleTarget} onClose={() => setRoleTarget(null)} title={fmt(t('organizer.staff.changeRoleTitle'), { name: roleTarget ? nameOf(roleTarget) : '' })} size="md">
        <RoleRadios value={newRole} onChange={setNewRole} name="change-role" />
        <DialogFooter>
          <Button variant="secondary" onClick={() => setRoleTarget(null)}>{t('common.cancel')}</Button>
          <Button onClick={() => void changeRole()} loading={busy} data-testid="staff-role-save">{t('events.common.save')}</Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog open={!!removeTarget} onClose={() => setRemoveTarget(null)} onConfirm={() => void remove()} busy={busy}
        title={fmt(t('organizer.staff.remove.title'), { name: removeTarget ? nameOf(removeTarget) : '' })} description={t('organizer.staff.remove.body')} confirmLabel={t('organizer.staff.remove.action')} />
    </div>
  );
}

export default function OrganizerStaffPage() {
  return <OrganizerPage area="staff"><StaffInner /></OrganizerPage>;
}
