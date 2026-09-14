'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, Plus, Pencil, CreditCard, ExternalLink, History, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useApp } from '../../providers';
import { api, MemberSummary, MemberProfile, PaymentRequest, MemberCheckinRecord } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter, ConfirmDialog } from '@/components/dialog';
import { statusTone, statusLabel, money, formatDateTime } from '@/lib/admin-utils';

const FITNESS_GOALS = ['build_muscle', 'lose_weight', 'stay_fit', 'flexibility', 'endurance'];
const FITNESS_LEVELS = ['beginner', 'intermediate', 'advanced'];
const GENDERS = ['male', 'female', 'other'];
const WORKOUT_TIMES = ['early_morning', 'morning', 'afternoon', 'evening', 'night'];

const BLANK_PROFILE: MemberProfile = {
  fitnessGoal: '', fitnessLevel: '', heightCm: null, weightKg: null,
  dateOfBirth: '', gender: '', preferredWorkoutTimes: [],
};

const BLANK_MEMBER: Partial<MemberSummary> = {
  displayName: '', email: '', phone: '', accountStatus: 'active',
  memberProfile: { ...BLANK_PROFILE },
};

export default function MembersPage() {
  const { token, user } = useApp();
  const [members, setMembers]   = useState<MemberSummary[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [actionTarget, setActionTarget] = useState<{ member: MemberSummary; action: 'suspend' | 'activate' } | null>(null);
  const [filter, setFilter]     = useState<'all' | 'active' | 'suspended' | 'payment_pending'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]   = useState<MemberSummary | null>(null);
  const [draft, setDraft]       = useState<Partial<MemberSummary>>(BLANK_MEMBER);
  const [paymentsDialogOpen, setPaymentsDialogOpen] = useState(false);
  const [paymentsTarget, setPaymentsTarget] = useState<MemberSummary | null>(null);
  const [memberPayments, setMemberPayments] = useState<PaymentRequest[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Visit history state
  const [visitDialogOpen, setVisitDialogOpen] = useState(false);
  const [visitTarget, setVisitTarget] = useState<MemberSummary | null>(null);
  const [visitRecords, setVisitRecords] = useState<MemberCheckinRecord[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [visitFrom, setVisitFrom] = useState('');
  const [visitTo, setVisitTo] = useState('');

  // QR code state
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<MemberSummary | null>(null);
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setMembers(await api.members(token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    if (!qrDialogOpen || !qrTarget || !token) return;
    if (!qrTarget.subscription || qrTarget.subscription.status !== 'active') return;

    let cancelled = false;
    let firstLoad = true;

    async function refreshPortalQr() {
      if (!token || !qrTarget) return;
      if (firstLoad) setLoadingQr(true);
      try {
        const qr = await api.adminMemberQr(token, qrTarget.id);
        if (cancelled) return;
        setQrValue(qr.token);
        setQrExpiresAt(qr.expiresAt);
        setQrError(null);
      } catch (e: any) {
        if (cancelled) return;
        setQrValue(null);
        setQrExpiresAt(null);
        setQrError(e?.body?.error || (e instanceof Error ? e.message : 'Failed to refresh QR code.'));
      } finally {
        if (!cancelled) {
          setLoadingQr(false);
          firstLoad = false;
        }
      }
    }

    refreshPortalQr();
    const timer = window.setInterval(refreshPortalQr, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [qrDialogOpen, qrTarget, token]);

  const filtered = (() => {
    if (filter === 'all') return members;
    if (filter === 'payment_pending') return members.filter(m => m.pendingPayment != null);
    return members.filter(m => (m.accountStatus || 'active') === filter);
  })();

  function openCreate() {
    setEditing(null);
    setDraft({ ...BLANK_MEMBER });
    setFormErrors({});
    setDialogOpen(true);
  }

  function openEdit(member: MemberSummary) {
    setEditing(member);
    setDraft({ ...member });
    setFormErrors({});
    setDialogOpen(true);
  }

  function validateMemberForm(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!draft.displayName?.trim()) errs.displayName = 'Display name is required';
    if (!draft.email?.trim() && !draft.phone?.trim()) errs.email = 'Email or phone is required';
    if (!draft.accountStatus) errs.accountStatus = 'Status is required';
    return errs;
  }

  async function handleSave() {
    if (!token) return;
    const errs = validateMemberForm();
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }
    setFormErrors({});
    setBusy(true);
    try {
      if (editing) {
        await api.saveMember(token, { ...draft, id: editing.id });
      } else {
        await api.saveMember(token, draft);
      }
      setDialogOpen(false);
      await load();
    } catch (e: any) {
      const msg = e?.body?.error || (e instanceof Error ? e.message : 'Save failed');
      if (e?.status === 409) {
        setFormErrors({ email: msg === 'email_already_used' ? 'This email is already in use by another user' : msg });
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleAction() {
    if (!token || !actionTarget) return;
    setBusy(true);
    try {
      const newStatus = actionTarget.action === 'suspend' ? 'suspended' : 'active';
      await api.setMemberStatus(token, actionTarget.member.id, newStatus);
      setActionTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(member: MemberSummary, newStatus: 'active' | 'suspended') {
    if (!token) return;
    try {
      await api.setMemberStatus(token, member.id, newStatus);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed');
    }
  }

  async function openVisitHistory(member: MemberSummary) {
    setVisitTarget(member);
    setVisitDialogOpen(true);
    setVisitFrom('');
    setVisitTo('');
    await loadVisits(member.id);
  }

  async function loadVisits(memberId: string, from?: string, to?: string) {
    if (!token) return;
    setLoadingVisits(true);
    try {
      const records = await api.adminMemberCheckins(token, memberId, from, to);
      setVisitRecords(records);
    } catch {
      setVisitRecords([]);
    } finally {
      setLoadingVisits(false);
    }
  }

  async function openQrDialog(member: MemberSummary) {
    setQrTarget(member);
    setQrDialogOpen(true);
    setQrValue(null);
    setQrExpiresAt(null);
    setQrError(null);
    // Check if member has active subscription
    if (!member.subscription || member.subscription.status !== 'active') {
      setQrError('Member has no active pass. QR code cannot be generated.');
      return;
    }
    setLoadingQr(true);
  }

  async function openPayments(member: MemberSummary) {
    setPaymentsTarget(member);
    setPaymentsDialogOpen(true);
    setLoadingPayments(true);
    try {
      if (token) {
        const payments = await api.memberPayments(token, member.id);
        setMemberPayments(payments);
      }
    } catch {
      // If endpoint not available, show pending payment from member data
      setMemberPayments(member.pendingPayment ? [member.pendingPayment] : []);
    } finally {
      setLoadingPayments(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const columns: ColumnDef<MemberSummary>[] = [
    {
      key: 'displayName', header: 'Member', sortable: true,
      cell: (m) => (
        <div>
          <div className="font-medium text-[var(--color-fg-primary)]">{m.displayName || m.email || m.phone || m.id}</div>
          <div className="text-xs text-[var(--color-fg-quaternary)]">{m.email || m.phone || m.id}</div>
        </div>
      ),
    },
    {
      key: 'accountStatus', header: 'Status', sortable: true,
      cell: (m) => (
        <select
          value={m.accountStatus || 'active'}
          onChange={(e) => handleStatusChange(m, e.target.value as 'active' | 'suspended')}
          onClick={(e) => e.stopPropagation()}
          className="appearance-none bg-transparent border-none text-xs font-medium cursor-pointer focus:outline-none"
          style={{ color: (m.accountStatus || 'active') === 'active' ? 'var(--color-success-700)' : 'var(--color-error-700)' }}
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      ),
    },
    { key: 'subscription', header: 'Subscription', sortable: false, cell: (m) => <span className="capitalize text-xs">{m.subscription?.tier || '—'}</span> },
    {
      key: 'pendingPayment', header: 'Payment', sortable: false,
      cell: (m) => m.pendingPayment ? (
        <button
          onClick={(e) => { e.stopPropagation(); openPayments(m); }}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-warning-700)] hover:underline"
        >
          <Badge tone="warning">Pending</Badge>
        </button>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); openPayments(m); }}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-fg-quaternary)] hover:text-[var(--color-brand-700)] hover:underline"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description={`${members.length} members on the platform.`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add member
            </Button>
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading && !members.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={filtered}
              keyFn={(m) => m.id}
              filterPlaceholder="Search members..."
              emptyState="No members found."
              extraFilters={
                <div className="flex gap-1">
                  {(['all', 'active', 'suspended', 'payment_pending'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
                        filter === f
                          ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
                          : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {f === 'all' ? 'All' : f === 'payment_pending' ? 'Payment pending' : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              }
              onRowClick={(member) => openPayments(member)}
              actions={(member) => (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(member); }} title="Edit member">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openPayments(member); }} title="View payments">
                    <CreditCard className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openVisitHistory(member); }} title="Visit history">
                    <History className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openQrDialog(member); }} title="Generate QR">
                    <QrCode className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            />
          </div>
        </Card>
      )}

      {/* Create/Edit Member Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? 'Edit member' : 'Add member'}
        description={editing ? `Editing ${editing.displayName || editing.email}` : 'Create a new member on the platform.'}
        size="lg"
      >
        <div className="space-y-4">
          <Field label="Display name" error={formErrors.displayName}>
            <input className="ui-input" value={draft.displayName || ''} onChange={e => { setDraft({ ...draft, displayName: e.target.value }); setFormErrors(prev => { const { displayName, ...rest } = prev; return rest; }); }} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Email" error={formErrors.email}>
              <input className="ui-input" type="email" value={draft.email || ''} onChange={e => { setDraft({ ...draft, email: e.target.value }); setFormErrors(prev => { const { email, ...rest } = prev; return rest; }); }} />
            </Field>
            <Field label="Phone" error={formErrors.phone}>
              <input className="ui-input" type="tel" value={draft.phone || ''} onChange={e => { setDraft({ ...draft, phone: e.target.value }); setFormErrors(prev => { const { phone, ...rest } = prev; return rest; }); }} placeholder="+255..." />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Gender">
              <select className="ui-input" value={draft.memberProfile?.gender || ''} onChange={e => setDraft({ ...draft, memberProfile: { ...draft.memberProfile, gender: e.target.value } })}>
                <option value="">Select gender</option>
                {GENDERS.map(g => <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Date of birth">
              <input className="ui-input" type="date" value={draft.memberProfile?.dateOfBirth || ''} onChange={e => setDraft({ ...draft, memberProfile: { ...draft.memberProfile, dateOfBirth: e.target.value } })} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Height (cm)">
              <input className="ui-input" type="number" value={draft.memberProfile?.heightCm || ''} onChange={e => setDraft({ ...draft, memberProfile: { ...draft.memberProfile, heightCm: e.target.value ? Number(e.target.value) : null } })} placeholder="e.g. 172" />
            </Field>
            <Field label="Weight (kg)">
              <input className="ui-input" type="number" value={draft.memberProfile?.weightKg || ''} onChange={e => setDraft({ ...draft, memberProfile: { ...draft.memberProfile, weightKg: e.target.value ? Number(e.target.value) : null } })} placeholder="e.g. 74" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Fitness goals" hint="Select all that apply.">
              <div className="flex flex-wrap gap-2">
                {FITNESS_GOALS.map(g => {
                  const raw = draft.memberProfile?.fitnessGoal || '';
                  const goals = typeof raw === 'string'
                    ? raw.split(',').map(s => s.trim()).filter(Boolean)
                    : Array.isArray(raw) ? (raw as unknown as string[]) : [];
                  const selected = goals.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        const next = selected ? goals.filter(x => x !== g) : [...goals, g];
                        setDraft({ ...draft, memberProfile: { ...draft.memberProfile, fitnessGoal: next.join(',') } });
                      }}
                      className={`px-3 py-1.5 text-xs rounded-[var(--radius-full)] font-medium transition-colors border ${
                        selected
                          ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border-[var(--color-brand-200)]'
                          : 'text-[var(--color-fg-tertiary)] border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {g.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Fitness level">
              <select className="ui-input" value={draft.memberProfile?.fitnessLevel || ''} onChange={e => setDraft({ ...draft, memberProfile: { ...draft.memberProfile, fitnessLevel: e.target.value } })}>
                <option value="">Select level</option>
                {FITNESS_LEVELS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Preferred workout times" hint="Select all that apply.">
            <div className="flex flex-wrap gap-2">
              {WORKOUT_TIMES.map(t => {
                const selected = draft.memberProfile?.preferredWorkoutTimes?.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      const current = draft.memberProfile?.preferredWorkoutTimes || [];
                      const next = selected ? current.filter(x => x !== t) : [...current, t];
                      setDraft({ ...draft, memberProfile: { ...draft.memberProfile, preferredWorkoutTimes: next } });
                    }}
                    className={`px-3 py-1.5 text-xs rounded-[var(--radius-full)] font-medium transition-colors border ${
                      selected
                        ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border-[var(--color-brand-200)]'
                        : 'text-[var(--color-fg-tertiary)] border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-tertiary)]'
                    }`}
                  >
                    {t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Status" error={formErrors.accountStatus}>
            <select className="ui-input" value={draft.accountStatus || 'active'} onChange={e => { setDraft({ ...draft, accountStatus: e.target.value as 'active' | 'suspended' }); setFormErrors(prev => { const { accountStatus, ...rest } = prev; return rest; }); }}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setDialogOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving...' : editing ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Member Payments Dialog */}
      <Dialog
        open={paymentsDialogOpen}
        onClose={() => setPaymentsDialogOpen(false)}
        title={`Payments — ${paymentsTarget?.displayName || paymentsTarget?.email || ''}`}
        description="Payment history for this member."
        size="lg"
      >
        {loadingPayments ? (
          <div className="flex h-32 items-center justify-center"><Spinner className="h-6 w-6" /></div>
        ) : memberPayments.length === 0 ? (
          <div className="text-center py-8 text-sm text-[var(--color-fg-quaternary)]">No payments found for this member.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-secondary)]">
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">ID</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Tier</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Amount</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Date</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Reference</th>
                </tr>
              </thead>
              <tbody>
                {memberPayments.map(p => (
                  <tr key={p.id} className="border-b border-[var(--color-border-secondary)] last:border-0">
                    <td className="py-2 px-3 font-mono text-xs">{p.id.slice(0, 12)}…</td>
                    <td className="py-2 px-3"><Badge tone="brand">{(p.tier ?? '—').toUpperCase()}</Badge></td>
                    <td className="py-2 px-3 text-right tabular-nums">{money(p.amountTzs)}</td>
                    <td className="py-2 px-3"><Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge></td>
                    <td className="py-2 px-3 text-xs whitespace-nowrap">{formatDateTime(p.requestedAt)}</td>
                    <td className="py-2 px-3 text-xs">{p.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Link href="/admin/payments">
            <Button variant="secondary" size="md">
              <ExternalLink className="h-4 w-4" /> Go to Payments
            </Button>
          </Link>
          <Button variant="primary" size="md" onClick={() => setPaymentsDialogOpen(false)}>Close</Button>
        </DialogFooter>
      </Dialog>

      {/* Visit History Dialog */}
      <Dialog
        open={visitDialogOpen}
        onClose={() => setVisitDialogOpen(false)}
        title={`Visit History — ${visitTarget?.displayName || visitTarget?.email || ''}`}
        description="Gym visits for this member."
        size="lg"
      >
        <div className="flex items-end gap-3 mb-4">
          <div className="flex-1">
            <label className="text-xs font-medium text-[var(--color-fg-quaternary)] mb-1 block">From</label>
            <input className="ui-input" type="date" value={visitFrom} onChange={e => setVisitFrom(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-[var(--color-fg-quaternary)] mb-1 block">To</label>
            <input className="ui-input" type="date" value={visitTo} onChange={e => setVisitTo(e.target.value)} />
          </div>
          <Button variant="secondary" size="sm" onClick={() => visitTarget && loadVisits(visitTarget.id, visitFrom || undefined, visitTo || undefined)} disabled={loadingVisits}>
            Filter
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setVisitFrom(''); setVisitTo(''); visitTarget && loadVisits(visitTarget.id); }}>Clear</Button>
        </div>
        {loadingVisits ? (
          <div className="flex h-32 items-center justify-center"><Spinner className="h-6 w-6" /></div>
        ) : visitRecords.length === 0 ? (
          <div className="text-center py-8 text-sm text-[var(--color-fg-quaternary)]">No visits found in this date range.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="text-xs text-[var(--color-fg-quaternary)] mb-2">{visitRecords.length} visit(s)</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-secondary)]">
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Date</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Gym</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Gym Tier</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Pass Tier</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Visit #</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-[var(--color-fg-quaternary)]">Method</th>
                </tr>
              </thead>
              <tbody>
                {visitRecords.map(v => (
                  <tr key={v.id} className="border-b border-[var(--color-border-secondary)] last:border-0">
                    <td className="py-2 px-3 text-xs whitespace-nowrap">{formatDateTime(v.timestamp)}</td>
                    <td className="py-2 px-3 text-xs">{v.gym?.name || v.gymId}</td>
                    <td className="py-2 px-3"><Badge tone="brand">{v.gymTier}</Badge></td>
                    <td className="py-2 px-3"><Badge tone="gray">{v.passTier || '—'}</Badge></td>
                    <td className="py-2 px-3 text-xs tabular-nums">{v.visitNumberInCycle ?? '—'}</td>
                    <td className="py-2 px-3 text-xs capitalize">{v.method?.replace(/_/g, ' ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="primary" size="md" onClick={() => setVisitDialogOpen(false)}>Close</Button>
        </DialogFooter>
      </Dialog>

      {/* QR Code Dialog */}
      <Dialog
        open={qrDialogOpen}
        onClose={() => setQrDialogOpen(false)}
        title={`QR Code — ${qrTarget?.displayName || qrTarget?.email || ''}`}
        description="Member check-in QR code."
        size="sm"
      >
        {loadingQr ? (
          <div className="flex h-32 items-center justify-center"><Spinner className="h-6 w-6" /></div>
        ) : qrError ? (
          <Alert tone="warning">{qrError}</Alert>
        ) : qrValue ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="bg-white p-4 rounded-xl border border-[var(--color-border-secondary)]">
              {/* SVG QR code placeholder — uses a data-uri-based approach */}
              <div className="w-48 h-48 flex items-center justify-center bg-[var(--color-bg-secondary)] rounded-lg">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(qrValue)}`}
                  alt="Member QR Code"
                  className="w-48 h-48"
                />
              </div>
            </div>
            <p className="text-xs text-[var(--color-fg-quaternary)] text-center">
              Show this QR at the gym for check-in.<br />
              Member: {qrTarget?.displayName || qrTarget?.email}<br />
              Auto-refreshes every 30 seconds{qrExpiresAt ? ` • Expires ${formatDateTime(qrExpiresAt)}` : ''}
            </p>
            <div className="text-xs font-mono text-[var(--color-fg-quaternary)] break-all text-center">{qrValue}</div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="primary" size="md" onClick={() => setQrDialogOpen(false)}>Close</Button>
        </DialogFooter>
      </Dialog>

      {/* Suspend/Activate Confirm */}
      <ConfirmDialog
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        onConfirm={handleAction}
        title={actionTarget?.action === 'suspend' ? 'Suspend member' : 'Activate member'}
        description={actionTarget?.action === 'suspend'
          ? `Suspend "${actionTarget?.member.displayName || actionTarget?.member.email}"? They will lose platform access.`
          : `Reactivate "${actionTarget?.member.displayName || actionTarget?.member.email}"?`}
        confirmLabel={actionTarget?.action === 'suspend' ? 'Suspend' : 'Activate'}
        tone={actionTarget?.action === 'suspend' ? 'danger' : 'primary'}
        busy={busy}
      />
    </div>
  );
}
