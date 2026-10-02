'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, Gym, isPin, passwordForPin, TrainerProfile } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner } from '@/components/shared';
import { BulkInvite, InvitationsSent, InviteForm } from '@/components/GymInvitations';
import { useApp } from '../../providers';

type MemberDraft = { displayName: string; email: string; phone: string; pin: string; plan: 'D' | 'W' | 'M' };
type StaffDraft = { displayName: string; email: string; pin: string };

const EMPTY_MEMBER: MemberDraft = { displayName: '', email: '', phone: '', pin: '', plan: 'M' };
const EMPTY_STAFF: StaffDraft = { displayName: '', email: '', pin: '' };

export default function OwnerManagePage() {
  const { token, locale, user, invitesEnabled } = useApp();
  const sw = locale === 'sw';
  const copy = sw ? {
    title: 'Usimamizi wa gym', subtitle: 'Wanachama, gym, wafanyakazi, wakufunzi na ufikiaji.', members: 'Wanachama', addMember: 'Ongeza mwanachama', bulk: 'Ongeza wengi', bulkHint: 'Mstari mmoja: jina,email,simu,PIN,mpango (D/W/M)', save: 'Hifadhi', gym: 'Maelezo ya gym', staff: 'Wafanyakazi', trainers: 'Wakufunzi', access: 'Ufikiaji na kuingia', review: 'Kagua walioingia', scan: 'Skani QR', pending: 'Maombi yanayosubiri', approve: 'Idhinisha', reject: 'Kataa', empty: 'Hakuna rekodi bado.', saved: 'Imehifadhiwa.', failed: 'Ombi halikukamilika.', name: 'Jina', email: 'Barua pepe', phone: 'Simu', pin: 'PIN ya tarakimu 4', plan: 'Mpango', location: 'Mahali', addStaff: 'Ongeza mfanyakazi', reload: 'Pakia upya', active: 'Wanachama hai', total: 'Jumla ya wanachama',
  } : {
    title: 'Gym management', subtitle: 'Members, gym details, staff, trainers, and access.', members: 'Members', addMember: 'Add member', bulk: 'Bulk add', bulkHint: 'One row: name,email,phone,PIN,plan (D/W/M)', save: 'Save', gym: 'Gym details', staff: 'Staff', trainers: 'Trainers', access: 'Access and check-ins', review: 'Review check-ins', scan: 'Scan QR', pending: 'Pending applications', approve: 'Approve', reject: 'Reject', empty: 'No records yet.', saved: 'Saved successfully.', failed: 'The request could not be completed.', name: 'Name', email: 'Email', phone: 'Mobile', pin: '4 digit PIN', plan: 'Plan', location: 'Location', addStaff: 'Add staff', reload: 'Reload', active: 'Active members', total: 'Total members',
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

  const gymId = gyms[0]?.id;
  const activeGym = useMemo(() => gyms.find(g => g.id === gymId), [gyms, gymId]);
  // Identity V2: with invitations on, people join with their own account and no PIN is set here.
  const invites = invitesEnabled && token && gymId ? { token, gymId, sw, onSent: () => setInvitesSent(n => n + 1) } : null;
  const isOwner = user?.userType === 'gym_operator';

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
    } catch { setMessage(copy.failed); } finally { setLoading(false); }
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
    try { await createMember(member); setMember(EMPTY_MEMBER); setMessage(copy.saved); await load(); } catch { setMessage(copy.failed); } finally { setBusy(false); }
  }

  async function submitBulk() {
    const rows = bulkText.split('\n').map(line => line.split(',').map(v => v.trim())).filter(parts => parts[0]);
    setBusy(true);
    try {
      for (const [displayName, email = '', phone = '', pin = '', rawPlan = 'M'] of rows) {
        const plan = ['D', 'W', 'M'].includes(rawPlan.toUpperCase()) ? rawPlan.toUpperCase() as 'D' | 'W' | 'M' : 'M';
        await createMember({ displayName, email, phone, pin, plan });
      }
      setBulkText(''); setMessage(copy.saved); await load();
    } catch { setMessage(copy.failed); } finally { setBusy(false); }
  }

  async function saveGym() {
    if (!token || !gymId) return; setBusy(true);
    try { await api.ownerUpdateGym(token, gymId, gymDraft); setMessage(copy.saved); await load(); } catch { setMessage(copy.failed); } finally { setBusy(false); }
  }

  async function addStaff(event: FormEvent) {
    event.preventDefault(); if (!token || !gymId) return; setBusy(true);
    try { await api.ownerCreateStaff(token, { displayName: staffDraft.displayName, email: staffDraft.email, password: passwordForPin(staffDraft.pin), gymIds: [gymId], aclPermissions: ['members', 'checkins', 'trainers', 'gyms'] }); setStaffDraft(EMPTY_STAFF); setMessage(copy.saved); await load(); } catch { setMessage(copy.failed); } finally { setBusy(false); }
  }

  async function decideTrainer(trainerId: string, decision: 'approve' | 'reject') {
    if (!token || !gymId) return; setBusy(true);
    try { await api.ownerDecideTrainer(token, trainerId, gymId, decision); setMessage(copy.saved); await load(); } catch { setMessage(copy.failed); } finally { setBusy(false); }
  }

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Spinner /></div>;

  return <div className="space-y-6">
    <PageHeader title={copy.title} description={copy.subtitle} actions={<Button variant="secondary" onClick={load}>{copy.reload}</Button>} />
    {message && <Alert tone={message === copy.saved ? 'success' : 'error'}>{message}</Alert>}
    <div className="grid gap-3 sm:grid-cols-2"><Card><p className="text-sm text-[var(--color-fg-quaternary)]">{copy.total}</p><p className="text-2xl font-semibold text-[var(--color-fg-primary)]">{stats.totalMembers ?? members.length}</p></Card><Card><p className="text-sm text-[var(--color-fg-quaternary)]">{copy.active}</p><p className="text-2xl font-semibold text-[var(--color-fg-primary)]">{stats.activeMembers ?? stats.activeToday ?? 0}</p></Card></div>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{copy.members}</h2>{invites ? <div className="grid gap-6 lg:grid-cols-2"><div className="space-y-3"><h3 className="font-medium text-[var(--color-fg-primary)]">{copy.addMember}</h3><InviteForm role="member" {...invites} /></div><div className="space-y-3"><h3 className="font-medium text-[var(--color-fg-primary)]">{copy.bulk}</h3><BulkInvite {...invites} /></div></div> : <div className="grid gap-6 lg:grid-cols-2"><form onSubmit={submitMember} className="space-y-3"><h3 className="font-medium text-[var(--color-fg-primary)]">{copy.addMember}</h3><Field label={copy.name}><input aria-label="Owner member name" required className="ui-input" value={member.displayName} onChange={e => setMember({...member, displayName:e.target.value})}/></Field><Field label={copy.email}><input aria-label="Owner member email" className="ui-input" type="email" value={member.email} onChange={e => setMember({...member, email:e.target.value})}/></Field><div className="grid grid-cols-2 gap-3"><Field label={copy.phone}><input className="ui-input" value={member.phone} onChange={e => setMember({...member, phone:e.target.value})}/></Field><Field label={copy.pin}><input aria-label="Owner member PIN" className="ui-input" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={member.pin} onChange={e => setMember({...member, pin:e.target.value})}/></Field></div><Field label={copy.plan}><select className="ui-input" value={member.plan} onChange={e => setMember({...member, plan:e.target.value as 'D'|'W'|'M'})}><option value="D">Daily</option><option value="W">Weekly</option><option value="M">Monthly</option></select></Field><Button type="submit" disabled={busy}>{copy.save}</Button></form><div className="space-y-3"><h3 className="font-medium text-[var(--color-fg-primary)]">{copy.bulk}</h3><textarea aria-label="Bulk members CSV" className="ui-input min-h-36" placeholder={copy.bulkHint} value={bulkText} onChange={e => setBulkText(e.target.value)}/><Button onClick={submitBulk} disabled={busy || !bulkText.trim()}>{copy.bulk}</Button></div></div>}{invites && <div className="mt-5"><InvitationsSent token={invites.token} gymId={invites.gymId} sw={sw} refreshKey={invitesSent} /></div>}<div className="mt-5 divide-y divide-[var(--color-border-secondary)]">{members.length === 0 ? <p className="py-3 text-sm text-[var(--color-fg-quaternary)]">{copy.empty}</p> : members.slice(0,10).map(m => <div key={m.id} className="flex items-center justify-between py-3"><div><p className="text-sm font-medium text-[var(--color-fg-primary)]">{m.displayName || m.email}</p><p className="text-xs text-[var(--color-fg-quaternary)]">{m.email || m.phone}</p></div><Badge tone={m.status === 'active' ? 'success' : 'gray'}>{m.status || 'active'}</Badge></div>)}</div></Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{copy.gym}</h2>{activeGym ? <div className="grid gap-3 sm:grid-cols-2"><Field label={copy.name}><input aria-label="Owner gym name" className="ui-input" value={gymDraft.name || ''} onChange={e => setGymDraft({...gymDraft,name:e.target.value})}/></Field><Field label={copy.location}><input aria-label="Owner gym location" className="ui-input" value={gymDraft.location || ''} onChange={e => setGymDraft({...gymDraft,location:e.target.value})}/></Field><div className="sm:col-span-2"><Button onClick={saveGym} disabled={busy}>{copy.save}</Button></div></div> : <p>{copy.empty}</p>}</Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{copy.staff}</h2>{invites ? (isOwner && <div className="max-w-xl"><InviteForm role="staff" {...invites} /></div>) : <form onSubmit={addStaff} className="grid gap-3 sm:grid-cols-4"><Field label={copy.name}><input required className="ui-input" value={staffDraft.displayName} onChange={e => setStaffDraft({...staffDraft,displayName:e.target.value})}/></Field><Field label={copy.email}><input required type="email" className="ui-input" value={staffDraft.email} onChange={e => setStaffDraft({...staffDraft,email:e.target.value})}/></Field><Field label={copy.pin}><input aria-label="Staff PIN" required pattern="[0-9]{4}" maxLength={4} className="ui-input" value={staffDraft.pin} onChange={e => setStaffDraft({...staffDraft,pin:e.target.value})}/></Field><div className="self-end"><Button type="submit" disabled={busy}>{copy.addStaff}</Button></div></form>}<div className="mt-4 flex flex-wrap gap-2">{staff.map(s => <Badge key={s.id} tone="brand">{s.displayName || s.email}</Badge>)}</div></Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{copy.trainers}</h2>{invites && isOwner && <div className="mb-4 max-w-xl"><InviteForm role="trainer" {...invites} /></div>}<div className="flex flex-wrap gap-2">{trainers.map(t => <Badge key={t.id} tone={t.verified ? 'success':'gray'}>{t.displayName}</Badge>)}</div>{pending.length > 0 && <div className="mt-5 space-y-2"><h3 className="text-sm font-medium text-[var(--color-fg-primary)]">{copy.pending}</h3>{pending.map(t => <div key={t.id} className="flex items-center justify-between rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3"><span>{t.displayName}</span><div className="flex gap-2"><Button size="sm" onClick={() => decideTrainer(t.id,'approve')}>{copy.approve}</Button><Button size="sm" variant="secondary" onClick={() => decideTrainer(t.id,'reject')}>{copy.reject}</Button></div></div>)}</div>}</Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-[var(--color-fg-primary)]">{copy.access}</h2><div className="flex gap-3"><Link href="/checkins"><Button variant="secondary">{copy.review}</Button></Link><Link href="/scan"><Button>{copy.scan}</Button></Link></div></Card>
  </div>;
}
