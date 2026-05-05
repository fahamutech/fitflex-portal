'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { useApp } from '../../providers';
import { api, RoleApproval } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { ConfirmDialog } from '@/components/dialog';
import { statusTone, statusLabel } from '@/lib/admin-utils';

type ApprovalFilter = 'pending_approval' | 'approved' | 'rejected' | 'all';

export default function ApprovalsPage() {
  const { token, user } = useApp();
  const [approvals, setApprovals] = useState<RoleApproval[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);
  const [filter, setFilter]       = useState<ApprovalFilter>('pending_approval');
  const [actionTarget, setActionTarget] = useState<{ approval: RoleApproval; action: 'approve' | 'reject' } | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setApprovals(await api.roleApprovals(token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const filtered = filter === 'all' ? approvals : approvals.filter(a => a.approvalStatus === filter);

  async function handleAction() {
    if (!token || !actionTarget) return;
    setBusy(true);
    try {
      await api.decideRoleApproval(token, actionTarget.approval.id, actionTarget.action);
      setActionTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const columns: ColumnDef<RoleApproval>[] = [
    {
      key: 'displayName', header: 'Profile', sortable: true,
      cell: (a) => (
        <div className="flex items-center gap-3">
          {a.photoUrl && (
            <div className="h-9 w-9 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-bg-tertiary)]">
              <img src={a.photoUrl} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <div>
            <div className="font-medium text-[var(--color-fg-primary)]">{a.displayName || a.email || a.id}</div>
            <div className="text-xs text-[var(--color-fg-quaternary)]">{a.email || a.id}</div>
          </div>
        </div>
      ),
    },
    { key: 'userType', header: 'Role', sortable: true, cell: (a) => <span className="capitalize text-xs">{a.userType.replace('_', ' ')}</span> },
    { key: 'approvalStatus', header: 'Status', sortable: true, cell: (a) => <Badge tone={statusTone(a.approvalStatus)}>{statusLabel(a.approvalStatus)}</Badge> },
    { key: 'createdAt', header: 'Requested', sortable: true, cell: (a) => <span className="text-xs tabular-nums">{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role Approvals"
        description={`${approvals.filter(a => a.approvalStatus === 'pending_approval').length} pending role requests.`}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading && !approvals.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={filtered}
              keyFn={(a) => a.id}
              filterPlaceholder="Search approvals..."
              emptyState="No role approval requests found."
              extraFilters={
                <div className="flex gap-1">
                  {(['pending_approval', 'approved', 'rejected', 'all'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
                        filter === f ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]' : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {f === 'pending_approval' ? 'Pending' : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              }
              actions={(approval) => approval.approvalStatus === 'pending_approval' ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setActionTarget({ approval, action: 'approve' })} title="Approve">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setActionTarget({ approval, action: 'reject' })} title="Reject">
                    <XCircle className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                  </Button>
                </>
              ) : null}
            />
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        onConfirm={handleAction}
        title={actionTarget?.action === 'approve' ? 'Approve role request' : 'Reject role request'}
        description={`${actionTarget?.action === 'approve' ? 'Approve' : 'Reject'} the ${actionTarget?.approval.userType.replace('_', ' ')} request for "${actionTarget?.approval.displayName || actionTarget?.approval.email}"?`}
        confirmLabel={actionTarget?.action === 'approve' ? 'Approve' : 'Reject'}
        tone={actionTarget?.action === 'approve' ? 'primary' : 'danger'}
        busy={busy}
      />
    </div>
  );
}
