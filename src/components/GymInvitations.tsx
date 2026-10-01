'use client';

// Identity V2 · I6: a gym invites a person by one phone number or email. The
// person joins with their own FitFlex account; the gym never sets a PIN or
// password for them. Rendered only while the backend has invitations on.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, GymInvitation, GymInvitationInput, InviteRole } from '@/lib/api';
import { Alert, Badge, Button, Field } from '@/components/shared';

// The app opens the invitation; it is the same link the app itself shares.
export const INVITE_LINK_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://fitflex-af-app.web.app';
export const inviteLink = (token: string) => `${INVITE_LINK_BASE}/invitations?token=${encodeURIComponent(token)}`;

const STAFF_SCOPES = ['members', 'checkins', 'trainers', 'gyms'];
const PLAN_DAYS = { D: 1, W: 7, M: 30 } as const;
type Plan = keyof typeof PLAN_DAYS;

const EN = {
  body: 'They join with their own FitFlex account. You never set a PIN or password for them.',
  contact: 'Phone number or email', plan: 'Plan', D: 'One day', W: 'One week', M: 'One month',
  paid: 'Paid at the desk (TZS)', paidHint: 'Leave empty if nothing was paid. The plan runs from today once they accept.',
  check: 'Check if they use FitFlex', found: (name: string) => `${name} uses FitFlex.`,
  notFound: 'Not found yet. They will get the invitation when they sign up with this phone or email and verify it.',
  send: 'Send invitation', sent: 'Invitation sent.', alreadySent: 'An invitation is already open for this person.',
  linkLabel: 'Invitation link', copy: 'Copy invitation link', copied: 'Link copied.',
  linkOnce: 'Share this link with them. It is shown only once.',
  bulk: 'Invite many', bulkHint: 'One row: phone or email,plan (D/W/M),amount paid', bulkDone: (n: number) => `${n} invitations sent.`,
  sentTitle: 'Invitations sent', sentEmpty: 'No invitations sent yet.',
  lapsed: (amount: string) => `Paid TZS ${amount} but never accepted. Send it again or record a refund.`,
  resend: 'New link', cancel: 'Cancel', reissue: 'Send again', refunded: 'Refunded', done: 'Done.',
  roles: { member: 'Member', staff: 'Staff', trainer: 'Trainer' } as Record<InviteRole, string>,
  status: { pending: 'Waiting', claimed: 'Opened', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired' } as Record<string, string>,
  failed: 'The request could not be completed.',
  errors: {
    trainer_persona_required: 'This person must add the trainer role to their FitFlex account first.',
    already_staff_elsewhere: 'This person is already staff at another gym, so this one cannot be added yet.',
    already_a_member: 'This person already belongs to this gym.',
    already_owner: 'This person already belongs to this gym.',
    invitation_not_open: 'This invitation is no longer open.',
    invitation_not_found: 'Invitation not found.',
    nothing_to_resolve: 'This invitation has already been dealt with.',
    one_phone_or_email_required: 'Enter one phone number or email.',
    lookup_rate_limited: 'Too many checks. Try again later.',
    lookup_cooldown: 'Too many checks. Try again later.',
    resend_too_soon: 'A new link was sent recently. Try again later.',
    resend_limit_reached: 'A new link was sent recently. Try again later.',
    owner_only: 'Only the gym owner can send this invitation.',
  } as Record<string, string>,
};

const SW: typeof EN = {
  body: 'Atajiunga kwa akaunti yake mwenyewe ya FitFlex. Hutamwekea PIN wala nenosiri.',
  contact: 'Namba ya simu au barua pepe', plan: 'Mpango', D: 'Siku moja', W: 'Wiki moja', M: 'Mwezi mmoja',
  paid: 'Amelipa mapokezi (TZS)', paidHint: 'Acha wazi kama hakuna malipo. Mpango unaanza leo pindi atakapokubali.',
  check: 'Angalia kama anatumia FitFlex', found: name => `${name} anatumia FitFlex.`,
  notFound: 'Bado hajapatikana. Atapata mwaliko atakapojisajili kwa simu au barua pepe hii na kuithibitisha.',
  send: 'Tuma mwaliko', sent: 'Mwaliko umetumwa.', alreadySent: 'Tayari kuna mwaliko ulio wazi kwa mtu huyu.',
  linkLabel: 'Kiungo cha mwaliko', copy: 'Nakili kiungo cha mwaliko', copied: 'Kiungo kimenakiliwa.',
  linkOnce: 'Mtumie kiungo hiki. Kinaonyeshwa mara moja tu.',
  bulk: 'Alika wengi', bulkHint: 'Mstari mmoja: simu au barua pepe,mpango (D/W/M),kiasi kilicholipwa', bulkDone: n => `Mialiko ${n} imetumwa.`,
  sentTitle: 'Mialiko iliyotumwa', sentEmpty: 'Bado hakuna mialiko iliyotumwa.',
  lapsed: amount => `Amelipa TZS ${amount} lakini hakukubali. Tuma tena au rekodi marejesho.`,
  resend: 'Kiungo kipya', cancel: 'Ghairi', reissue: 'Tuma tena', refunded: 'Amerudishiwa', done: 'Imekamilika.',
  roles: { member: 'Mwanachama', staff: 'Mfanyakazi', trainer: 'Mkufunzi' },
  status: { pending: 'Unasubiri', claimed: 'Umefunguliwa', accepted: 'Umekubaliwa', declined: 'Umekataliwa', cancelled: 'Umeghairiwa', expired: 'Umeisha muda' },
  failed: 'Ombi halikukamilika.',
  errors: {
    trainer_persona_required: 'Mtu huyu lazima aongeze nafasi ya mkufunzi kwenye akaunti yake ya FitFlex kwanza.',
    already_staff_elsewhere: 'Tayari ni mfanyakazi wa jimu nyingine, kwa hiyo hii haiwezi kuongezwa bado.',
    already_a_member: 'Mtu huyu tayari yuko kwenye jimu hii.',
    already_owner: 'Mtu huyu tayari yuko kwenye jimu hii.',
    invitation_not_open: 'Mwaliko huu haupo wazi tena.',
    invitation_not_found: 'Mwaliko haujapatikana.',
    nothing_to_resolve: 'Mwaliko huu umeshashughulikiwa.',
    one_phone_or_email_required: 'Weka namba moja ya simu au barua pepe.',
    lookup_rate_limited: 'Umeangalia mara nyingi mno. Jaribu tena baadaye.',
    lookup_cooldown: 'Umeangalia mara nyingi mno. Jaribu tena baadaye.',
    resend_too_soon: 'Kiungo kipya kimetumwa hivi karibuni. Jaribu tena baadaye.',
    resend_limit_reached: 'Kiungo kipya kimetumwa hivi karibuni. Jaribu tena baadaye.',
    owner_only: 'Mmiliki wa jimu pekee ndiye anayeweza kutuma mwaliko huu.',
  },
};

const copyFor = (sw: boolean) => (sw ? SW : EN);

function errorText(copy: typeof EN, error: unknown) {
  const code = error instanceof ApiError ? (error.body as { error?: string } | null)?.error : undefined;
  return (code && copy.errors[code]) || copy.failed;
}

/** One phone number or one email, as the backend expects it. */
export function contactOf(raw: string): { phone?: string; email?: string } {
  const value = raw.trim();
  return value.includes('@') ? { email: value } : { phone: value };
}

/** A member invitation's plan: it runs from today (the payment date) once accepted. */
export function memberPlan(plan: Plan, paid?: string) {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + PLAN_DAYS[plan]);
  const amount = Number(paid);
  return { durationUnit: plan, startDate: start.toISOString(), endDate: end.toISOString(), ...(amount > 0 ? { paidAmount: amount } : {}) };
}

function LinkBox({ copy, token }: { copy: typeof EN; token: string }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(token);
  return <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3" data-testid="invite-link">
    <p className="text-xs text-[var(--color-fg-quaternary)]">{copy.linkOnce}</p>
    <input aria-label={copy.linkLabel} readOnly className="ui-input" value={link} onFocus={e => e.currentTarget.select()} />
    <Button type="button" size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* the field stays selectable */ } }}>{copied ? copy.copied : copy.copy}</Button>
  </div>;
}

export function InviteForm({ token, gymId, role, sw, onSent }: { token: string; gymId: string; role: InviteRole; sw: boolean; onSent?: () => void }) {
  const copy = copyFor(sw);
  const [contact, setContact] = useState('');
  const [plan, setPlan] = useState<Plan>('M');
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const label = `${copy.roles[role]}: ${copy.contact}`;

  async function check() {
    if (!contact.trim()) return;
    setBusy(true); setLink(null);
    try {
      const res = await api.gymLookupPerson(token, gymId, contactOf(contact));
      setNotice({ tone: 'info', text: res.found ? copy.found(res.maskedName || 'FitFlex') : copy.notFound });
    } catch (e) { setNotice({ tone: 'error', text: errorText(copy, e) }); } finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setLink(null);
    try {
      const body: GymInvitationInput = {
        role, ...contactOf(contact),
        ...(role === 'member' ? memberPlan(plan, paid) : {}),
        ...(role === 'staff' ? { aclPermissions: STAFF_SCOPES } : {}),
      };
      const res = await api.gymCreateInvitation(token, gymId, body);
      setNotice({ tone: res.created ? 'success' : 'info', text: res.created ? copy.sent : copy.alreadySent });
      setLink(res.token ?? null);
      if (res.created) { setContact(''); setPaid(''); }
      onSent?.();
    } catch (e) { setNotice({ tone: 'error', text: errorText(copy, e) }); } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="space-y-3" data-testid={`invite-form-${role}`}>
    <p className="text-sm text-[var(--color-fg-quaternary)]">{copy.body}</p>
    <Field label={copy.contact}><input aria-label={label} required className="ui-input" value={contact} onChange={e => setContact(e.target.value)} /></Field>
    {role === 'member' && <div className="grid grid-cols-2 gap-3">
      <Field label={copy.plan}><select aria-label={`${copy.roles[role]}: ${copy.plan}`} className="ui-input" value={plan} onChange={e => setPlan(e.target.value as Plan)}><option value="D">{copy.D}</option><option value="W">{copy.W}</option><option value="M">{copy.M}</option></select></Field>
      <Field label={copy.paid} hint={copy.paidHint}><input aria-label={`${copy.roles[role]}: ${copy.paid}`} className="ui-input" inputMode="numeric" pattern="[0-9]*" value={paid} onChange={e => setPaid(e.target.value)} /></Field>
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy}>{copy.send}</Button>
      <Button type="button" variant="secondary" disabled={busy || !contact.trim()} onClick={check}>{copy.check}</Button>
    </div>
    {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
    {link && <LinkBox copy={copy} token={link} />}
  </form>;
}

/** Bulk member invitations: one row per person, no names and no PINs. */
export function BulkInvite({ token, gymId, sw, onSent }: { token: string; gymId: string; sw: boolean; onSent?: () => void }) {
  const copy = copyFor(sw);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [links, setLinks] = useState<{ contact: string; token: string }[]>([]);

  async function submit() {
    const rows = text.split('\n').map(line => line.split(',').map(v => v.trim())).filter(parts => parts[0]);
    setBusy(true); setLinks([]);
    const sent: { contact: string; token: string }[] = [];
    let count = 0;
    try {
      for (const [contact, rawPlan = 'M', paid = ''] of rows) {
        const plan = (['D', 'W', 'M'].includes(rawPlan.toUpperCase()) ? rawPlan.toUpperCase() : 'M') as Plan;
        const res = await api.gymCreateInvitation(token, gymId, { role: 'member', ...contactOf(contact), ...memberPlan(plan, paid) });
        count += 1;
        if (res.token) sent.push({ contact, token: res.token });
      }
      setText(''); setNotice({ tone: 'success', text: copy.bulkDone(count) });
    } catch (e) { setNotice({ tone: 'error', text: `${copy.bulkDone(count)} ${errorText(copy, e)}` }); } finally { setLinks(sent); setBusy(false); onSent?.(); }
  }

  return <div className="space-y-3">
    <textarea aria-label="Bulk invitations CSV" className="ui-input min-h-36" placeholder={copy.bulkHint} value={text} onChange={e => setText(e.target.value)} />
    <Button onClick={submit} disabled={busy || !text.trim()}>{copy.bulk}</Button>
    {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
    {links.length > 0 && <div className="space-y-2">
      <p className="text-xs text-[var(--color-fg-quaternary)]">{copy.linkOnce}</p>
      {links.map(l => <div key={l.token} className="text-xs"><span className="font-medium text-[var(--color-fg-primary)]">{l.contact}</span><input aria-label={`${copy.linkLabel}: ${l.contact}`} readOnly className="ui-input mt-1" value={inviteLink(l.token)} onFocus={e => e.currentTarget.select()} /></div>)}
    </div>}
  </div>;
}

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'brand' | 'gray'> = {
  pending: 'brand', claimed: 'brand', accepted: 'success', declined: 'danger', cancelled: 'gray', expired: 'warning',
};

/** What the gym has sent: open invitations, answers, and paid ones that lapsed. */
export function InvitationsSent({ token, gymId, sw, refreshKey = 0 }: { token: string; gymId: string; sw: boolean; refreshKey?: number }) {
  const copy = copyFor(sw);
  const [rows, setRows] = useState<GymInvitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await api.gymInvitations(token, gymId)).invitations ?? []); } catch { setRows([]); }
  }, [token, gymId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function act(inv: GymInvitation, action: 'cancel' | 'resend' | 'reissue' | 'refunded') {
    setBusyId(inv.id); setLink(null);
    try {
      const res = await api.gymInvitationAction(token, gymId, inv.id, action);
      setLink(res.token ?? null); setNotice({ tone: 'success', text: copy.done });
      await load();
    } catch (e) { setNotice({ tone: 'error', text: errorText(copy, e) }); } finally { setBusyId(null); }
  }

  return <div className="space-y-3" data-testid="invitations-sent">
    <h3 className="font-medium text-[var(--color-fg-primary)]">{copy.sentTitle}</h3>
    {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
    {link && <LinkBox copy={copy} token={link} />}
    {rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{copy.sentEmpty}</p> : <div className="divide-y divide-[var(--color-border-secondary)]">
      {rows.map(inv => {
        const open = inv.status === 'pending' || inv.status === 'claimed';
        return <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`invitation-${inv.id}`}>
          <div>
            <p className="text-sm font-medium text-[var(--color-fg-primary)]">{inv.identifierValue} · {copy.roles[inv.role] ?? inv.role}</p>
            {inv.needsResolution && <p className="text-xs text-[var(--color-fg-quaternary)]">{copy.lapsed(Number(inv.paidAmountTzs ?? 0).toLocaleString('en-US'))}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[inv.status] ?? 'gray'}>{copy.status[inv.status] ?? inv.status}</Badge>
            {open && <><Button size="sm" variant="secondary" disabled={busyId === inv.id} onClick={() => act(inv, 'resend')}>{copy.resend}</Button><Button size="sm" variant="secondary" disabled={busyId === inv.id} onClick={() => act(inv, 'cancel')}>{copy.cancel}</Button></>}
            {inv.needsResolution && <><Button size="sm" disabled={busyId === inv.id} onClick={() => act(inv, 'reissue')}>{copy.reissue}</Button><Button size="sm" variant="secondary" disabled={busyId === inv.id} onClick={() => act(inv, 'refunded')}>{copy.refunded}</Button></>}
          </div>
        </div>;
      })}
    </div>}
  </div>;
}
