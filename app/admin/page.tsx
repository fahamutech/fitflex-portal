'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import {
  Building2, Users, CreditCard, ShieldCheck, Dumbbell, UserCheck,
  TrendingUp, RefreshCw, ArrowUpRight,
} from 'lucide-react';
import { useApp } from '../providers';
import {
  api, Gym, GymOwner, MemberSummary, PaymentRequest, RoleApproval, TrainerProfile,
} from '@/lib/api';
import {
  MetricCard, Card, CardHeader, CardContent, Badge, Button,
  PageHeader, Alert, Spinner,
} from '@/components/shared';
import { money, statusTone, statusLabel } from '@/lib/admin-utils';

const BRAND   = '#079455';
const WARNING = '#f79009';
const DANGER  = '#d92d20';
const GRAY    = '#98a2b3';

export default function AdminOverviewPage() {
  const { token, user, hasPermission } = useApp();
  const [gyms, setGyms]           = useState<Gym[]>([]);
  const [owners, setOwners]       = useState<GymOwner[]>([]);
  const [payments, setPayments]   = useState<PaymentRequest[]>([]);
  const [members, setMembers]     = useState<MemberSummary[]>([]);
  const [trainers, setTrainers]   = useState<TrainerProfile[]>([]);
  const [approvals, setApprovals] = useState<RoleApproval[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  const load = async () => {
    if (!token || user?.userType !== 'admin') return;
    setLoading(true);
    try {
      // Only fetch data the current user is permitted to see
      const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
        p.catch(e => (e?.status === 403 || (e as any)?.body?.error === 'acl_forbidden') ? fallback : Promise.reject(e));

      const [g, o, p, m, tr, a] = await Promise.all([
        hasPermission('gyms')      ? safe(api.adminGyms(token), [])       : Promise.resolve([] as Gym[]),
        hasPermission('owners')    ? safe(api.gymOwners(token), [])        : Promise.resolve([] as GymOwner[]),
        hasPermission('payments')  ? safe(api.paymentRequests(token), [])  : Promise.resolve([] as PaymentRequest[]),
        hasPermission('members')   ? safe(api.members(token), [])          : Promise.resolve([] as MemberSummary[]),
        hasPermission('trainers')  ? safe(api.adminTrainers(token), [])    : Promise.resolve([] as TrainerProfile[]),
        hasPermission('approvals') ? safe(api.roleApprovals(token), [])    : Promise.resolve([] as RoleApproval[]),
      ]);
      setGyms(g); setOwners(o); setPayments(p);
      setMembers(m); setTrainers(tr); setApprovals(a);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, user?.userType]);

  if (!token || user?.userType !== 'admin') return null;

  const metrics = useMemo(() => {
    const pendingPayments  = payments.filter(p => p.status === 'pending').length;
    const approvedPayments = payments.filter(p => p.status === 'approved').length;
    const rejectedPayments = payments.filter(p => p.status === 'rejected').length;
    const activeMembers    = members.filter(m => (m.accountStatus || 'active') === 'active').length;
    const suspendedMembers = members.filter(m => m.accountStatus === 'suspended').length;
    const approvedValue    = payments.filter(p => p.status === 'approved').reduce((s, p) => s + p.amountTzs, 0);
    const pendingApprovals = approvals.filter(a => a.approvalStatus === 'pending_approval').length;
    const onlineGyms       = gyms.filter(g => g.accessMode === 'free_online').length;
    const physicalGyms     = gyms.filter(g => g.accessMode !== 'free_online').length;
    return {
      pendingPayments, approvedPayments, rejectedPayments,
      activeMembers, suspendedMembers,
      approvedValue, pendingApprovals, onlineGyms, physicalGyms,
    };
  }, [gyms, members, payments, approvals]);

  const gymTierData = useMemo(() => {
    const counts: Record<string, number> = {};
    gyms.forEach(g => { counts[g.tier] = (counts[g.tier] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [gyms]);

  const paymentStatusData = useMemo(() => [
    { name: 'Pending',  value: metrics.pendingPayments,  fill: WARNING },
    { name: 'Approved', value: metrics.approvedPayments, fill: BRAND },
    { name: 'Rejected', value: metrics.rejectedPayments, fill: DANGER },
  ].filter(d => d.value > 0), [metrics]);

  const memberStatusData = useMemo(() => [
    { name: 'Active',    value: metrics.activeMembers,    fill: BRAND },
    { name: 'Suspended', value: metrics.suspendedMembers, fill: DANGER },
  ].filter(d => d.value > 0), [metrics]);

  const venueData = useMemo(() => [
    { name: 'Physical', Gyms: metrics.physicalGyms },
    { name: 'Online',   Gyms: metrics.onlineGyms },
  ], [metrics]);

  const recentPayments = payments.slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Platform-wide metrics and activity snapshot."
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading && !gyms.length ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {hasPermission('gyms')      && <MetricCard label="Gyms" value={gyms.length} icon={<Building2 className="h-5 w-5" />} sub={`${metrics.physicalGyms} physical \u00b7 ${metrics.onlineGyms} online`} />}
            {hasPermission('members')   && <MetricCard label="Members" value={members.length} icon={<Users className="h-5 w-5" />} sub={`${metrics.activeMembers} active \u00b7 ${metrics.suspendedMembers} suspended`} />}
            {hasPermission('payments')  && <MetricCard label="Approved value" value={money(metrics.approvedValue)} icon={<CreditCard className="h-5 w-5" />} sub={`${metrics.pendingPayments} payments pending`} />}
            {hasPermission('approvals') && <MetricCard label="Pending approvals" value={metrics.pendingApprovals} icon={<ShieldCheck className="h-5 w-5" />} sub="Role & gym owner requests" />}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {hasPermission('owners')   && <MetricCard label="Gym owners" value={owners.length} icon={<UserCheck className="h-5 w-5" />} />}
            {hasPermission('trainers') && <MetricCard label="Trainers" value={trainers.length} icon={<Dumbbell className="h-5 w-5" />} />}
            {hasPermission('payments') && <MetricCard label="Total payments" value={payments.length} icon={<TrendingUp className="h-5 w-5" />} sub={`${metrics.approvedPayments} approved`} />}
          </div>

          {(hasPermission('payments') || hasPermission('members') || hasPermission('gyms')) && (
          <div className="grid gap-4 lg:grid-cols-3">
            {hasPermission('payments') && <Card>
              <CardHeader><span className="text-sm font-semibold">Payment status</span></CardHeader>
              <CardContent>
                {paymentStatusData.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--color-fg-quaternary)]">No payments yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={paymentStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                        {paymentStatusData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                <div className="mt-2 flex flex-wrap justify-center gap-3">
                  {paymentStatusData.map(d => (
                    <span key={d.name} className="flex items-center gap-1.5 text-xs text-[var(--color-fg-tertiary)]">
                      <span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />{d.name} ({d.value})
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>}

            {hasPermission('members') && <Card>
              <CardHeader><span className="text-sm font-semibold">Member status</span></CardHeader>
              <CardContent>
                {memberStatusData.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--color-fg-quaternary)]">No members yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={memberStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                        {memberStatusData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                <div className="mt-2 flex flex-wrap justify-center gap-3">
                  {memberStatusData.map(d => (
                    <span key={d.name} className="flex items-center gap-1.5 text-xs text-[var(--color-fg-tertiary)]">
                      <span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />{d.name} ({d.value})
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>}

            {hasPermission('gyms') && <Card>
              <CardHeader><span className="text-sm font-semibold">Gyms by venue</span></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={venueData} barSize={48}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-gray-100)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: GRAY }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: GRAY }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="Gyms" fill={BRAND} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>}
          </div>
          )}

          {hasPermission('gyms') && gymTierData.length > 0 && (
            <Card>
              <CardHeader><span className="text-sm font-semibold">Gym tier distribution</span></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={gymTierData}>
                    <defs>
                      <linearGradient id="brandGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BRAND} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-gray-100)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: GRAY }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: GRAY }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" stroke={BRAND} strokeWidth={2} fill="url(#brandGrad)" name="Gyms" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {hasPermission('payments') && <Card>
            <CardHeader>
              <span className="text-sm font-semibold">Recent payment requests</span>
              <Link href="/admin/payments">
                <Button variant="ghost" size="sm">View all <ArrowUpRight className="h-3.5 w-3.5" /></Button>
              </Link>
            </CardHeader>
            <div className="overflow-x-auto">
              {recentPayments.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-[var(--color-fg-quaternary)]">No payment requests yet.</p>
              ) : (
                <table className="ui-table">
                  <thead><tr><th>Member</th><th>Tier</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead>
                  <tbody>
                    {recentPayments.map(p => (
                      <tr key={p.id}>
                        <td>
                          <div className="font-medium text-[var(--color-fg-primary)] text-sm">{p.member?.displayName || p.member?.email || p.memberId}</div>
                          <div className="text-xs text-[var(--color-fg-quaternary)] font-mono">{p.id.slice(0, 22)}{'\u2026'}</div>
                        </td>
                        <td><Badge tone="brand">{(p.tier ?? '—').toUpperCase()}</Badge></td>
                        <td className="font-medium tabular-nums">{money(p.amountTzs)}</td>
                        <td className="text-xs tabular-nums whitespace-nowrap">{p.requestedAt ? new Date(p.requestedAt).toLocaleDateString() : '\u2014'}</td>
                        <td><Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              { href: '/admin/gyms',      label: 'Manage Gyms',    Icon: Building2,   count: gyms.length,              alert: false,                              scope: 'gyms' },
              { href: '/admin/members',   label: 'Manage Members', Icon: Users,       count: members.length,           alert: false,                              scope: 'members' },
              { href: '/admin/payments',  label: 'Payment Queue',  Icon: CreditCard,  count: metrics.pendingPayments,  alert: metrics.pendingPayments > 0,        scope: 'payments' },
              { href: '/admin/approvals', label: 'Role Approvals', Icon: ShieldCheck, count: metrics.pendingApprovals, alert: metrics.pendingApprovals > 0,        scope: 'approvals' },
            ] as const).filter(item => hasPermission(item.scope)).map(item => (
              <Link key={item.href} href={item.href} className="block">
                <div className="flex items-center gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] p-4 hover:border-[var(--color-brand-300)] hover:shadow-[var(--shadow-md)] transition-all cursor-pointer group">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-xl)] border ${item.alert ? 'bg-[var(--color-warning-50)] border-[var(--color-warning-200)] text-[var(--color-warning-700)]' : 'bg-[var(--color-brand-50)] border-[var(--color-brand-200)] text-[var(--color-brand-700)]'}`}>
                    <item.Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-fg-secondary)] group-hover:text-[var(--color-fg-primary)] transition-colors">{item.label}</p>
                    <p className="text-xl font-bold text-[var(--color-fg-primary)] tabular-nums">{item.count}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-[var(--color-fg-disabled)] group-hover:text-[var(--color-fg-secondary)] transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
