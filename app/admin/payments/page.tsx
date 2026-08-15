'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { useApp } from '../../providers';
import { api, PaymentRequest } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter, ConfirmDialog } from '@/components/dialog';
import { money, statusTone, statusLabel, formatDateTime } from '@/lib/admin-utils';

type PaymentFilter = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all';

export default function PaymentsPage() {
  const { token, user } = useApp();
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [filter, setFilter]     = useState<PaymentFilter>('pending');
  const [actionTarget, setActionTarget] = useState<{ payment: PaymentRequest; action: 'approved' | 'rejected' | 'cancelled' } | null>(null);
  const [editTarget, setEditTarget] = useState<PaymentRequest | null>(null);
  const [editFields, setEditFields] = useState<{ reference: string; note: string }>({ reference: '', note: '' });

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setPayments(await api.paymentRequests(token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const filtered = filter === 'all' ? payments : payments.filter(p => p.status === filter);

  async function handleAction() {
    if (!token || !actionTarget) return;
    setBusy(true);
    try {
      await api.updatePayment(token, actionTarget.payment.id, { status: actionTarget.action });
      setActionTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit() {
    if (!token || !editTarget) return;
    setBusy(true);
    try {
      await api.updatePayment(token, editTarget.id, { reference: editFields.reference, note: editFields.note });
      setEditTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const columns: ColumnDef<PaymentRequest>[] = [
    {
      key: 'memberId', header: 'Member', sortable: true,
      cell: (p) => (
        <div>
          <div className="font-medium text-[var(--color-fg-primary)] text-sm">{p.member?.displayName || p.member?.email || p.memberId}</div>
          <div className="text-xs text-[var(--color-fg-quaternary)] font-mono">{p.id.slice(0, 20)}…</div>
        </div>
      ),
    },
    { key: 'tier', header: 'Tier', sortable: true, cell: (p) => <Badge tone="brand">{(p.tier ?? '—').toUpperCase()}</Badge> },
    { key: 'amountTzs', header: 'Amount', sortable: true, align: 'right', cell: (p) => <span className="tabular-nums font-medium">{money(p.amountTzs)}</span> },
    { key: 'requestedAt', header: 'Date', sortable: true, cell: (p) => <span className="text-xs tabular-nums whitespace-nowrap">{formatDateTime(p.requestedAt)}</span> },
    { key: 'status', header: 'Status', sortable: true, cell: (p) => <Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge> },
    { key: 'reference', header: 'Reference', cell: (p) => <span className="text-xs">{p.reference || '—'}</span> },
    { key: 'note', header: 'Note', cell: (p) => <span className="text-xs max-w-[200px] truncate block">{p.note || '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description={`${payments.length} payment requests total. ${payments.filter(p => p.status === 'pending').length} pending.`}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading && !payments.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={filtered}
              keyFn={(p) => p.id}
              filterPlaceholder="Search payments..."
              emptyState="No payments found."
              extraFilters={
                <div className="flex gap-1">
                  {(['pending', 'approved', 'rejected', 'cancelled', 'all'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
                        filter === f ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]' : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              }
              actions={(payment) => (
                <>
                  {payment.status === 'pending' && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setActionTarget({ payment, action: 'approved' })} title="Approve">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setActionTarget({ payment, action: 'rejected' })} title="Reject">
                        <XCircle className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setActionTarget({ payment, action: 'cancelled' })} title="Cancel">
                        <Ban className="h-3.5 w-3.5 text-[var(--color-fg-quaternary)]" />
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => { setEditTarget(payment); setEditFields({ reference: payment.reference || '', note: payment.note || '' }); }}>
                    Edit
                  </Button>
                </>
              )}
            />
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        onConfirm={handleAction}
        title={actionTarget ? `${actionTarget.action.charAt(0).toUpperCase() + actionTarget.action.slice(1)} payment` : ''}
        description={`Set payment for ${actionTarget?.payment.member?.displayName || actionTarget?.payment.memberId} (${money(actionTarget?.payment.amountTzs)}) to "${actionTarget?.action}"?`}
        confirmLabel={actionTarget?.action === 'approved' ? 'Approve' : actionTarget?.action === 'rejected' ? 'Reject' : 'Cancel payment'}
        tone={actionTarget?.action === 'approved' ? 'primary' : 'danger'}
        busy={busy}
      />

      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit payment details" size="sm">
        <div className="space-y-4">
          <Field label="Reference">
            <input className="ui-input" value={editFields.reference} onChange={e => setEditFields({ ...editFields, reference: e.target.value })} placeholder="Payment reference..." />
          </Field>
          <Field label="Note">
            <textarea className="ui-input min-h-[80px]" value={editFields.note} onChange={e => setEditFields({ ...editFields, note: e.target.value })} placeholder="Admin note..." />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setEditTarget(null)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleEdit} disabled={busy}>{busy ? 'Saving...' : 'Update'}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
