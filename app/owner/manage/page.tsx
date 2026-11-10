'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, Gym, isPin, passwordForPin, TrainerProfile } from '@/lib/api';
import { messages, type MessageKey } from '@/lib/i18n';
import { fmt } from '@/lib/vendor';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/shared';
import { BulkInvite, InvitationsSent, InviteForm } from '@/components/GymInvitations';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../providers';

type MemberDraft = { displayName: string; email: string; phone: string; pin: string; plan: 'D' | 'W' | 'M' };
type StaffDraft = { displayName: string; email: string; pin: string; canMessage: boolean };

// What every staff member gets; sending messages to members is the owner's choice.
const BASE_STAFF_SCOPES = ['members', 'checkins', 'trainers', 'gyms'];

const EMPTY_MEMBER: MemberDraft = { displayName: '', email: '', phone: '', pin: '', plan: 'M' };
const EMPTY_STAFF: StaffDraft = { displayName: '', email: '', pin: '', canMessage: false };

// What each refusal of POST /owner/staff/:id/pin (B3a) means for the owner.
const RESET_PIN_ERROR_KEYS: Record<string, MessageKey> = {
  pin_must_be_4_digits: 'ownerStaff.err.format',
  staff_identity_shared: 'ownerStaff.err.shared',
  credentials_not_accepted: 'ownerStaff.err.credentialsNotAccepted',
  feature_disabled: 'ownerStaff.err.unavailable',
  staff_not_found: 'ownerStaff.err.notFound',
  staff_not_at_your_gym: 'ownerStaff.err.otherGym',
  firebase_update_failed: 'ownerStaff.err.saveFailed',
};

export default function OwnerManagePage() {
  const { token, user, invitesEnabled, t } = useApp();
  const failed = t('comms.error.generic');
  const saved = t('ownerManage.saved');
  const statusLabel = (status: string) => {
    const key = `ownerManage.status.${status}`;
    return key in messages.en ? t(key as MessageKey) : status;
  };

  const [gyms, setGyms] = useState<Gym[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [staff, setStaff] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<TrainerProfile[]>([]);
  const [pending, setPending] = useState<TrainerProfile[]>([]);
  const [member, setMember] = useState<MemberDraft>(EMPTY_MEMBER);
  const [staffDraft, setStaffDraft] = useState<StaffDraft>(EMPTY_STAFF);
  const [bulkText, setBulkText] = useState('');
  const [gymDraft, setGymDraft] = useState<Partial<Gym>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [invitesSent, setInvitesSent] = useState(0);
  // Owner "Reset PIN" for one staff member (B3a): who, the new start PIN, and what the server said.
  const [resetFor, setResetFor] = useState<{ id: string; name: string } | null>(null);
  const [resetPin, setResetPin] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  const gymId = gyms[0]?.id;
  const activeGym = useMemo(() => gyms.find(g => g.id === gymId), [gyms, gymId]);
  // Identity V2: with invitations on, people join with their own account and no PIN is set here.
  const invites = invitesEnabled && token && gymId ? { token, gymId, onSent: () => setInvitesSent(n => n + 1) } : null;
  const isOwner = user?.userType === 'gym_operator';
  // Staff rows carry passwordChangeRequired only while STAFF_PIN_CHANGE_REQUIRED is on: the badge and the
  // reset action stay hidden (dormant) until then. With invitations on, owners no longer set a PIN.
  const staffPinOn = staff.some(s => typeof s?.passwordChangeRequired === 'boolean');
  const canResetPin = isOwner && staffPinOn && !invitesEnabled;
  const staffName = (s: any) => String(s?.displayName || s?.email || '');

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const ownerGyms = await api.ownerGyms(token);
      const firstGymId = ownerGyms[0]?.id;
      const [memberData, staffData, trainerData, pendingData] = await Promise.all([
        api.ownerMembers(token, firstGymId), api.ownerStaff(token), api.ownerTrainers(token, firstGymId), api.ownerPendingTrainers(token),
      ]);
      setGyms(ownerGyms); setGymDraft(ownerGyms[0] ?? {}); setMembers(memberData.members ?? []); setStats(memberData.stats ?? {}); setStaff(staffData); setTrainers(trainerData); setPending(pendingData);
      setMessage(null);
    } catch { setMessage(failed); } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  function dates(plan: 'D' | 'W' | 'M') {
    const start = new Date(); const end = new Date(start);
    end.setDate(end.getDate() + (plan === 'D' ? 1 : plan === 'W' ? 7 : 30));
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }

  async function createMember(draft: MemberDraft) {
    if (!token || !gymId) return;
    // Never create a sign-in the member could not use: a PIN is four digits.
    if (draft.pin && !isPin(draft.pin)) throw new Error('invalid_pin');
    await api.ownerCreateMember(token, { displayName: draft.displayName, email: draft.email || undefined, phone: draft.phone || undefined, initialPassword: draft.pin ? passwordForPin(draft.pin) : undefined, gymId, durationUnit: draft.plan, ...dates(draft.plan) });
  }

  async function submitMember(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await createMember(member); setMember(EMPTY_MEMBER); setMessage(saved); await load(); } catch { setMessage(failed); } finally { setBusy(false); }
  }

  async function submitBulk() {
    const rows = bulkText.split('\n').map(line => line.split(',').map(v => v.trim())).filter(parts => parts[0]);
    setBusy(true);
    try {
      for (const [displayName, email = '', phone = '', pin = '', rawPlan = 'M'] of rows) {
        const plan = ['D', 'W', 'M'].includes(rawPlan.toUpperCase()) ? rawPlan.toUpperCase() as 'D' | 'W' | 'M' : 'M';
        await createMember({ displayName, email, phone, pin, plan });
      }
      setBulkText(''); setMessage(saved); await load();
    } catch { setMessage(failed); } finally { setBusy(false); }
  }

  async function saveGym() {
    if (!token || !gymId) return; setBusy(true);
    try { await api.ownerUpdateGym(token, gymId, gymDraft); setMessage(saved); await load(); } catch { setMessage(failed); } finally { setBusy(false); }
  }

  async function addStaff(event: FormEvent) {
    event.preventDefault(); if (!token || !gymId) return; setBusy(true);
    try { await api.ownerCreateStaff(token, { displayName: staffDraft.displayName, email: staffDraft.email, password: passwordForPin(staffDraft.pin), gymIds: [gymId], aclPermissions: [...BASE_STAFF_SCOPES, ...(staffDraft.canMessage ? ['communications'] : [])] }); setStaffDraft(EMPTY_STAFF); setMessage(saved); await load(); } catch { setMessage(failed); } finally { setBusy(false); }
  }

  function openReset(s: any) { setResetNotice(null); setResetFor({ id: s.id, name: staffName(s) }); setResetPin(''); setResetError(null); }

  async function submitResetPin(event: FormEvent) {
    event.preventDefault(); if (!token || !resetFor) return;
    setResetError(null);
    if (!isPin(resetPin)) { setResetError(t('ownerStaff.err.format')); return; }
    setResetBusy(true);
    try {
      const row = await api.ownerResetStaffPin(token, resetFor.id, resetPin);
      setStaff(list => list.map(s => (s.id === resetFor.id ? { ...s, ...row, passwordChangeRequired: true } : s)));
      setResetNotice(fmt(t('ownerStaff.resetDone'), { name: resetFor.name }));
      setResetFor(null); setResetPin('');
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
      const key = code ? RESET_PIN_ERROR_KEYS[code] : undefined;
      setResetError(fmt(t(key ?? 'ownerStaff.err.generic'), { name: resetFor.name }));
    } finally { setResetBusy(false); }
  }

  async function decideTrainer(trainerId: string, decision: 'approve' | 'reject') {
    if (!token || !gymId) return; setBusy(true);
    try { await api.ownerDecideTrainer(token, trainerId, gymId, decision); setMessage(saved); await load(); } catch { setMessage(failed); } finally { setBusy(false); }
  }

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Spinner /></div>;

  return <div className="space-y-6">
    <PageHeader title={t('ownerManage.title')} description={t('ownerManage.subtitle')} actions={<Button variant="secondary" onClick={load}>{t('ownerManage.reload')}</Button>} />
    {message && <Alert tone={message === saved ? 'success' : 'error'}>{message}</Alert>}
    {resetNotice && <Alert tone="success">{resetNotice}</Alert>}
    <div className="grid gap-3 sm:grid-cols-2"><Card><p className="text-sm text-[var(--color-fg-quaternary)]">{t('ownerManage.total')}</p><p className="text-2xl font-semibold text-[var(--color-fg-primary)]">{stats.totalMembers ?? members.length}</p></Card><Card><p className="text-sm text-[var(--color-fg-quaternary)]">{t('ownerManage.active')}</p><p className="text-2xl font-semibold text-[var(--color-fg-primary)]">{stats.activeMembers ?? stats.activeToday ?? 0}</p></Card></div>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{t('ownerManage.members')}</h2>{invites ? <div className="grid gap-6 lg:grid-cols-2"><div className="space-y-3"><h3 className="font-medium text-[var(--color-fg-primary)]">{t('ownerManage.addMember')}</h3><InviteForm role="member" {...invites} /></div><div className="space-y-3"><h3 className="font-medium text-[var(--color-fg-primary)]">{t('ownerManage.bulk')}</h3><BulkInvite {...invites} /></div></div> : <div className="grid gap-6 lg:grid-cols-2"><form onSubmit={submitMember} className="space-y-3"><h3 className="font-medium text-[var(--color-fg-primary)]">{t('ownerManage.addMember')}</h3><Field label={t('ownerManage.name')}><Input aria-label={t('ownerManage.aria.memberName')} required value={member.displayName} onChange={e => setMember({...member, displayName:e.target.value})}/></Field><Field label={t('ownerManage.email')}><Input aria-label={t('ownerManage.aria.memberEmail')} type="email" value={member.email} onChange={e => setMember({...member, email:e.target.value})}/></Field><div className="grid grid-cols-2 gap-3"><Field label={t('ownerManage.phone')}><Input value={member.phone} onChange={e => setMember({...member, phone:e.target.value})}/></Field><Field label={t('ownerManage.pin')}><Input aria-label={t('ownerManage.aria.memberPin')} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={member.pin} onChange={e => setMember({...member, pin:e.target.value})}/></Field></div><Field label={t('ownerManage.plan')}><Select value={member.plan} onChange={e => setMember({...member, plan:e.target.value as 'D'|'W'|'M'})}><option value="D">{t('comms.plan.daily')}</option><option value="W">{t('comms.plan.weekly')}</option><option value="M">{t('comms.plan.monthly')}</option></Select></Field><Button type="submit" disabled={busy}>{t('ownerManage.save')}</Button></form><div className="space-y-3"><h3 className="font-medium text-[var(--color-fg-primary)]">{t('ownerManage.bulk')}</h3><Textarea aria-label={t('ownerManage.aria.bulkCsv')} className="!min-h-36" placeholder={t('ownerManage.bulkHint')} value={bulkText} onChange={e => setBulkText(e.target.value)}/><Button onClick={submitBulk} disabled={busy || !bulkText.trim()}>{t('ownerManage.bulk')}</Button></div></div>}{invites && <div className="mt-5"><InvitationsSent token={invites.token} gymId={invites.gymId} refreshKey={invitesSent} /></div>}<div className="mt-5 divide-y divide-[var(--color-border-secondary)]">{members.length === 0 ? <p className="py-3 text-sm text-[var(--color-fg-quaternary)]">{t('ownerManage.empty')}</p> : members.slice(0,10).map(m => <div key={m.id} className="flex items-center justify-between py-3"><div><p className="text-sm font-medium text-[var(--color-fg-primary)]">{m.displayName || m.email}{m.username && <span className="ml-1 font-normal text-[var(--color-fg-tertiary)]">@{m.username}</span>}</p><p className="text-xs text-[var(--color-fg-quaternary)]">{m.email || m.phone}</p></div><Badge tone={m.status === 'active' ? 'success' : 'gray'}>{statusLabel(m.status || 'active')}</Badge></div>)}</div></Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{t('ownerManage.gym')}</h2>{activeGym ? <div className="grid gap-3 sm:grid-cols-2"><Field label={t('ownerManage.name')}><Input aria-label={t('ownerManage.aria.gymName')} value={gymDraft.name || ''} onChange={e => setGymDraft({...gymDraft,name:e.target.value})}/></Field><Field label={t('ownerManage.location')}><Input aria-label={t('ownerManage.aria.gymLocation')} value={gymDraft.location || ''} onChange={e => setGymDraft({...gymDraft,location:e.target.value})}/></Field><div className="sm:col-span-2"><Button onClick={saveGym} disabled={busy}>{t('ownerManage.save')}</Button></div></div> : <p>{t('ownerManage.empty')}</p>}</Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{t('ownerManage.staff')}</h2>{invites ? (isOwner && <div className="max-w-xl"><InviteForm role="staff" {...invites} /></div>) : <form onSubmit={addStaff} className="grid gap-3 sm:grid-cols-4"><Field label={t('ownerManage.name')}><Input required value={staffDraft.displayName} onChange={e => setStaffDraft({...staffDraft,displayName:e.target.value})}/></Field><Field label={t('ownerManage.email')}><Input required type="email" value={staffDraft.email} onChange={e => setStaffDraft({...staffDraft,email:e.target.value})}/></Field><Field label={t('ownerManage.pin')}><Input aria-label={t('ownerManage.aria.staffPin')} required pattern="[0-9]{4}" maxLength={4} value={staffDraft.pin} onChange={e => setStaffDraft({...staffDraft,pin:e.target.value})}/></Field><div className="self-end"><Button type="submit" disabled={busy}>{t('ownerManage.addStaff')}</Button></div><label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" data-testid="staff-can-message" checked={staffDraft.canMessage} onChange={e => setStaffDraft({...staffDraft,canMessage:e.target.checked})}/>{t('invites.canMessage')}</label></form>}{staffPinOn ? <ul className="mt-4 divide-y divide-[var(--color-border-secondary)]" data-testid="owner-staff-list">{staff.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`owner-staff-${s.id}`}><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-[var(--color-fg-primary)]">{staffName(s)}</span>{s.passwordChangeRequired === true && <Badge tone="warning">{t('ownerStaff.mustChangePin')}</Badge>}</div>{canResetPin && <Button type="button" variant="secondary" size="sm" onClick={() => openReset(s)} data-testid={`owner-staff-reset-${s.id}`}>{t('ownerStaff.resetPin')}</Button>}</li>)}</ul> : <div className="mt-4 flex flex-wrap gap-2">{staff.map(s => <Badge key={s.id} tone="brand">{s.displayName || s.email}</Badge>)}</div>}</Card>
    <Dialog open={!!resetFor} onClose={() => { if (!resetBusy) setResetFor(null); }} title={fmt(t('ownerStaff.resetTitle'), { name: resetFor?.name ?? '' })} description={fmt(t('ownerStaff.resetBody'), { name: resetFor?.name ?? '' })} size="sm">
      <form id="owner-reset-pin-form" onSubmit={submitResetPin} noValidate className="space-y-3">
        {resetError && <Alert tone="error">{resetError}</Alert>}
        <Field label={t('ownerStaff.resetPinLabel')} required><Input type="password" inputMode="numeric" pattern="[0-9]{4}" autoComplete="off" value={resetPin} onChange={e => { setResetPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setResetError(null); }} data-testid="owner-staff-reset-pin" /></Field>
      </form>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => setResetFor(null)} disabled={resetBusy}>{t('common.cancel')}</Button>
        <Button type="submit" form="owner-reset-pin-form" loading={resetBusy} data-testid="owner-staff-reset-submit">{t('ownerStaff.resetPin')}</Button>
      </DialogFooter>
    </Dialog>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{t('ownerManage.trainers')}</h2>{invites && isOwner && <div className="mb-4 max-w-xl"><InviteForm role="trainer" {...invites} /></div>}<div className="flex flex-wrap gap-2">{trainers.map(tr => <Badge key={tr.id} tone={tr.verified ? 'success':'gray'}>{tr.displayName}</Badge>)}</div>{pending.length > 0 && <div className="mt-5 space-y-2"><h3 className="text-sm font-medium text-[var(--color-fg-primary)]">{t('ownerManage.pending')}</h3>{pending.map(tr => <div key={tr.id} className="flex items-center justify-between rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3"><span>{tr.displayName}</span><div className="flex gap-2"><Button size="sm" onClick={() => decideTrainer(tr.id,'approve')}>{t('ownerManage.approve')}</Button><Button size="sm" variant="secondary" onClick={() => decideTrainer(tr.id,'reject')}>{t('ownerManage.reject')}</Button></div></div>)}</div>}</Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{t('ownerManage.access')}</h2><div className="flex gap-3"><Link href="/checkins"><Button variant="secondary">{t('ownerManage.review')}</Button></Link><Link href="/scan"><Button>{t('ownerManage.scan')}</Button></Link></div></Card>
  </div>;
}
