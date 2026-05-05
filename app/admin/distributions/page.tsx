'use client';
import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, CheckCircle, Upload } from 'lucide-react';
import { useApp } from '../../providers';
import { api, PeriodDistribution, PeriodMemberDetail, Invoice } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { ImageUpload } from '@/components/image-upload';
import { money } from '@/lib/admin-utils';

// Flat row for the main distribution table
interface DistRow {
  _key: string;
  periodStart: string;
  periodEnd: string;
  gymId: string;
  gymName: string;
  location: string;
  totalVisits: number;
  uniqueMembers: number;
  totalOwed: number;
  totalPaid: number;
  balance: number;
  invoiceStatus: string;
  invoice: Invoice | null;
  members: PeriodMemberDetail[];
}

export default function DistributionsPage() {
  const { token, user } = useApp();
  const [periods, setPeriods]   = useState<PeriodDistribution[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'outstanding' | 'paid'>('all');

  // Detail dialog
  const [detailRow, setDetailRow] = useState<DistRow | null>(null);

  // Receipt upload dialog
  const [receiptDialog, setReceiptDialog] = useState<Invoice | null>(null);
  const [receiptImages, setReceiptImages] = useState<string[]>([]);
  const [paymentRef, setPaymentRef]       = useState('');
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.periodDistribution(token);
      setPeriods(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  // Flatten periods → rows
  const rows: DistRow[] = useMemo(() => {
    const out: DistRow[] = [];
    for (const p of periods) {
      for (const g of p.gyms) {
        out.push({
          _key: `${p.periodStart}_${g.gymId}`,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          gymId: g.gymId,
          gymName: g.gymName,
          location: g.location,
          totalVisits: g.totalVisits,
          uniqueMembers: g.uniqueMembers,
          totalOwed: g.totalOwed,
          totalPaid: g.totalPaid,
          balance: g.balance,
          invoiceStatus: g.invoice?.status || 'none',
          invoice: g.invoice,
          members: g.members,
        });
      }
    }
    return out;
  }, [periods]);

  const filtered = useMemo(() => {
    if (balanceFilter === 'outstanding') return rows.filter(r => r.balance > 0);
    if (balanceFilter === 'paid') return rows.filter(r => r.invoiceStatus === 'paid');
    return rows;
  }, [rows, balanceFilter]);

  const totalOwed = rows.reduce((s, r) => s + r.totalOwed, 0);
  const totalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);

  function openReceiptUpload(inv: Invoice) {
    setReceiptDialog(inv);
    setReceiptImages(inv.receiptUrl ? [inv.receiptUrl] : []);
    setPaymentRef(inv.paymentReference || '');
  }

  async function handleUploadReceipt() {
    if (!token || !receiptDialog) return;
    if (receiptImages.length === 0) return;
    setBusy(true);
    try {
      await api.updateInvoice(token, receiptDialog.id, {
        receiptUrl: receiptImages[0] || undefined,
        paymentReference: paymentRef || undefined,
        status: 'paid',
      });
      setReceiptDialog(null);
      setDetailRow(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update invoice');
    } finally {
      setBusy(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const memberColumns: ColumnDef<PeriodMemberDetail>[] = [
    { key: 'memberName', header: 'Member', sortable: true, cell: (r) => <span className="text-sm font-medium">{r.memberName}</span> },
    { key: 'visitCount', header: 'Visits', sortable: true, align: 'right', cell: (r) => <span className="tabular-nums">{r.visitCount}</span> },
    { key: 'billingType', header: 'Billing', sortable: true, cell: (r) => (
      <Badge tone={r.billingType === 'month' ? 'brand' : r.billingType === 'week' ? 'success' : 'gray'}>
        {r.billingType.toUpperCase()}
      </Badge>
    )},
    { key: 'amount', header: 'Amount', sortable: true, align: 'right', cell: (r) => <span className="tabular-nums font-medium">{money(r.amount)}</span> },
  ];

  const columns: ColumnDef<DistRow>[] = [
    { key: 'periodStart', header: 'Period', sortable: true, cell: (r) => (
      <div>
        <div className="text-sm font-medium text-[var(--color-fg-primary)]">{r.periodStart}</div>
        <div className="text-xs text-[var(--color-fg-quaternary)]">to {r.periodEnd}</div>
      </div>
    )},
    { key: 'gymName', header: 'Gym', sortable: true, cell: (r) => (
      <div>
        <div className="text-sm font-medium text-[var(--color-fg-primary)]">{r.gymName}</div>
        <div className="text-xs text-[var(--color-fg-quaternary)]">{r.location}</div>
      </div>
    )},
    { key: 'totalVisits', header: 'Visits', sortable: true, align: 'right', cell: (r) => <span className="tabular-nums font-medium">{r.totalVisits}</span> },
    { key: 'uniqueMembers', header: 'Members', sortable: true, align: 'right', cell: (r) => <span className="tabular-nums">{r.uniqueMembers}</span> },
    { key: 'totalOwed', header: 'Owed', sortable: true, align: 'right', cell: (r) => <span className="tabular-nums font-medium">{money(r.totalOwed)}</span> },
    { key: 'totalPaid', header: 'Paid', sortable: true, align: 'right', cell: (r) => <span className="tabular-nums text-[var(--color-success-700)]">{money(r.totalPaid)}</span> },
    { key: 'balance', header: 'Balance', sortable: true, align: 'right', cell: (r) => (
      <span className={`tabular-nums font-semibold ${r.balance > 0 ? 'text-[var(--color-error-700)]' : 'text-[var(--color-success-700)]'}`}>
        {money(r.balance)}
      </span>
    )},
    { key: 'invoiceStatus', header: 'Invoice', sortable: true, cell: (r) => {
      if (!r.invoice) return <span className="text-xs text-[var(--color-fg-quaternary)]">—</span>;
      return (
        <Badge tone={r.invoice.status === 'paid' ? 'success' : 'warning'}>
          {r.invoice.status === 'paid' ? 'Paid' : 'Unpaid'}
        </Badge>
      );
    }},
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gym Payment Distribution"
        description={`Period-based distribution · ${periods.length > 0 ? `${periods[0].periodDays}-day periods` : ''} · ${rows.length} records`}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><div className="p-4 text-center">
          <p className="text-xs text-[var(--color-fg-quaternary)]">Total Owed</p>
          <p className="text-2xl font-bold tabular-nums">{money(totalOwed)}</p>
        </div></Card>
        <Card><div className="p-4 text-center">
          <p className="text-xs text-[var(--color-fg-quaternary)]">Total Paid</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--color-success-700)]">{money(totalPaid)}</p>
        </div></Card>
        <Card><div className="p-4 text-center">
          <p className="text-xs text-[var(--color-fg-quaternary)]">Outstanding</p>
          <p className={`text-2xl font-bold tabular-nums ${totalBalance > 0 ? 'text-[var(--color-error-700)]' : 'text-[var(--color-success-700)]'}`}>{money(totalBalance)}</p>
        </div></Card>
      </div>

      {loading && !rows.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={filtered}
              keyFn={(r) => r._key}
              filterPlaceholder="Search by gym or period..."
              emptyState="No distribution data yet."
              pageSize={15}
              onRowClick={(row) => setDetailRow(row)}
              extraFilters={
                <div className="flex gap-1">
                  {(['all', 'outstanding', 'paid'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setBalanceFilter(f)}
                      className={`px-3 py-1 text-xs rounded-[var(--radius-full)] font-medium transition-colors ${
                        balanceFilter === f
                          ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
                          : 'text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {f === 'all' ? 'All' : f === 'outstanding' ? 'Outstanding' : 'Paid'}
                    </button>
                  ))}
                </div>
              }
              actions={(row) => (
                row.invoice && row.invoice.status === 'unpaid' ? (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openReceiptUpload(row.invoice!); }} title="Upload receipt & pay">
                    <Upload className="h-3.5 w-3.5 text-[var(--color-brand-600)]" />
                  </Button>
                ) : row.invoice && row.invoice.status === 'paid' ? (
                  <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success-600)]" />
                ) : null
              )}
            />
          </div>
        </Card>
      )}

      {/* Detail Dialog — member breakdown + invoice info */}
      <Dialog
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        title={detailRow ? `${detailRow.gymName} — ${detailRow.periodStart} to ${detailRow.periodEnd}` : ''}
        description={detailRow ? `${detailRow.totalVisits} visits · ${detailRow.uniqueMembers} members · Owed: ${money(detailRow.totalOwed)}` : ''}
        size="lg"
      >
        {detailRow && (
          <div className="space-y-4">
            {/* Invoice summary */}
            {detailRow.invoice && (
              <div className={`rounded-[var(--radius-lg)] border p-3 flex items-center justify-between ${
                detailRow.invoice.status === 'paid'
                  ? 'border-[var(--color-success-200)] bg-[var(--color-success-50)]'
                  : 'border-[var(--color-warning-200)] bg-[var(--color-warning-50)]'
              }`}>
                <div>
                  <p className="text-xs text-[var(--color-fg-quaternary)]">Invoice #{detailRow.invoice.id.slice(0, 8)}</p>
                  <p className="text-sm font-bold tabular-nums">{money(detailRow.invoice.amount)}</p>
                  {detailRow.invoice.ownerName && <p className="text-xs text-[var(--color-fg-quaternary)]">Owner: {detailRow.invoice.ownerName}</p>}
                  {detailRow.invoice.paymentReference && <p className="text-xs text-[var(--color-fg-quaternary)]">Ref: {detailRow.invoice.paymentReference}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {detailRow.invoice.receiptUrl && (
                    <button onClick={() => setReceiptPreview(detailRow.invoice!.receiptUrl)} className="h-10 w-10 rounded-[var(--radius-md)] overflow-hidden border border-[var(--color-border-secondary)] block cursor-pointer">
                      <img src={detailRow.invoice.receiptUrl} alt="Receipt" className="h-full w-full object-cover" />
                    </button>
                  )}
                  {detailRow.invoice.status === 'unpaid' ? (
                    <Button variant="primary" size="sm" onClick={() => openReceiptUpload(detailRow.invoice!)}>
                      <Upload className="h-3.5 w-3.5" /> Pay
                    </Button>
                  ) : (
                    <CheckCircle className="h-5 w-5 text-[var(--color-success-600)]" />
                  )}
                </div>
              </div>
            )}

            {/* Member breakdown */}
            <DataTable
              columns={memberColumns}
              data={detailRow.members}
              keyFn={(r) => r.memberId}
              filterPlaceholder="Search members..."
              emptyState="No members in this period."
              pageSize={10}
            />
          </div>
        )}
      </Dialog>

      {/* Upload Receipt & Mark Paid Dialog */}
      <Dialog
        open={!!receiptDialog}
        onClose={() => setReceiptDialog(null)}
        title="Upload Payment Receipt"
        description={`Invoice for ${receiptDialog?.gymName || ''} — ${money(receiptDialog?.amount ?? 0)}`}
        size="md"
      >
        <div className="space-y-4">
          <Field label="Payment reference" hint="Transaction ID, receipt number, or bank reference.">
            <input className="ui-input" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="e.g. TXN-2024-001234" />
          </Field>
          <Field label="Receipt image" hint="Upload a photo of the payment receipt.">
            <ImageUpload
              value={receiptImages}
              onChange={setReceiptImages}
              maxFiles={1}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setReceiptDialog(null)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleUploadReceipt} disabled={busy || receiptImages.length === 0}>
            <CheckCircle className="h-4 w-4" /> {busy ? 'Saving...' : 'Mark as Paid'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Receipt Image Preview Dialog */}
      <Dialog
        open={!!receiptPreview}
        onClose={() => setReceiptPreview(null)}
        title="Payment Receipt"
        size="md"
      >
        {receiptPreview && (
          <div className="flex items-center justify-center">
            <img src={receiptPreview} alt="Receipt" className="max-w-full max-h-[60vh] rounded-[var(--radius-lg)] object-contain" />
          </div>
        )}
      </Dialog>
    </div>
  );
}
