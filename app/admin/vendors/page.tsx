'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CheckCircle2, RefreshCw, UserRoundCheck, UserRoundX, XCircle } from 'lucide-react';
import { useApp } from '../../providers';
import { api, VendorSummary } from '@/lib/api';
import { CASE_STATUS } from '@/lib/kyc';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '@/components/shared';
import { ColumnDef, DataTable } from '@/components/data-table';

/** A vendor is "verified" by their KYC case; existing vendors predate KYC. */
function KycBadge({ vendor, t }: { vendor: VendorSummary; t: ReturnType<typeof useApp>['t'] }) {
  if (vendor.kycStatus) {
    const s = CASE_STATUS[vendor.kycStatus];
    return <Badge tone={s.tone}>{t('vendors.kyc')}: {s.label}</Badge>;
  }
  return <Badge tone={vendor.kycExempt ? 'gray' : 'warning'}>{t(vendor.kycExempt ? 'vendors.kycExisting' : 'vendors.kycNotStarted')}</Badge>;
}

function approvalTone(status: VendorSummary['approvalStatus']) {
  if (status === 'approved') return 'success' as const;
  if (status === 'rejected') return 'danger' as const;
  return 'warning' as const;
}

export default function VendorsPage() {
  const { token, user, t } = useApp();
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setVendors(await api.adminVendors(token));
      setError(null);
    } catch {
      setError(t('vendors.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function update(vendor: VendorSummary, patch: Parameters<typeof api.updateAdminVendor>[2]) {
    if (!token) return;
    setBusyId(vendor.id);
    setSuccess(null);
    try {
      const updated = await api.updateAdminVendor(token, vendor.id, patch);
      setVendors((current) => current.map((row) => row.id === vendor.id ? { ...row, ...updated } : row));
      setError(null);
      setSuccess(t('vendors.updated'));
    } catch {
      setError(t('vendors.error'));
    } finally {
      setBusyId(null);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const columns: ColumnDef<VendorSummary>[] = [
    {
      key: 'displayName', header: t('vendors.business'), sortable: true,
      cell: (vendor) => <div>
        <p className="font-medium text-[var(--color-fg-primary)]">{vendor.vendorProfile?.businessName || vendor.displayName || vendor.id}</p>
        <p className="text-xs text-[var(--color-fg-quaternary)]">{vendor.vendorProfile?.businessCategory || vendor.vendorProfile?.address || vendor.id}</p>
      </div>,
    },
    {
      key: 'email', header: t('vendors.contact'), sortable: true,
      cell: (vendor) => <div className="text-xs"><p>{vendor.email || '—'}</p><p className="text-[var(--color-fg-quaternary)]">{vendor.phone || '—'}</p></div>,
    },
    {
      key: 'approvalStatus', header: t('vendors.approval'), sortable: true,
      cell: (vendor) => <div className="flex flex-wrap gap-1">
        <Badge tone={approvalTone(vendor.approvalStatus)}>{t(`vendors.${vendor.approvalStatus === 'pending_approval' ? 'pending' : vendor.approvalStatus}`)}</Badge>
        <KycBadge vendor={vendor} t={t} />
      </div>,
    },
    {
      key: 'accountStatus', header: t('vendors.account'), sortable: true,
      cell: (vendor) => <Badge tone={vendor.accountStatus === 'active' ? 'success' : 'danger'}>{t(vendor.accountStatus === 'active' ? 'vendors.active' : 'vendors.suspended')}</Badge>,
    },
    {
      key: 'productCount', header: t('vendors.products'), sortable: true,
      cell: (vendor) => <div className="text-xs"><p>{vendor.productCount}</p><p className="text-[var(--color-fg-quaternary)]">{t('vendors.pendingProducts').replace('{count}', String(vendor.pendingProductCount))}</p></div>,
    },
  ];

  return <div className="space-y-6">
    <PageHeader
      title={t('vendors.title')}
      description={t('vendors.description')}
      actions={<Button variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{t('admin.action.refresh')}</Button>}
    />
    {error && <Alert tone="error">{error}</Alert>}
    {success && <Alert tone="success">{success}</Alert>}
    {loading && vendors.length === 0 ? <div className="flex justify-center py-16"><Spinner /></div> : <Card><div className="p-5">
      <DataTable
        columns={columns}
        data={vendors}
        keyFn={(vendor) => vendor.id}
        filterPlaceholder={t('vendors.title')}
        emptyState={t('vendors.empty')}
        actions={(vendor) => <div className="flex flex-wrap justify-end gap-1">
          {/* New vendors are approved through their KYC case. */}
          {!vendor.kycExempt && <Link href="/admin/kyc" title={t('vendors.kycReview')} className="inline-flex items-center rounded-md px-2 py-1 text-[var(--color-brand-700)] hover:bg-[var(--color-bg-secondary)]"><BadgeCheck className="h-4 w-4" /></Link>}
          {vendor.kycExempt && vendor.approvalStatus !== 'approved' && <Button variant="ghost" size="sm" title={t('vendors.approve')} disabled={busyId === vendor.id} onClick={() => update(vendor, { approvalStatus: 'approved' })}><CheckCircle2 className="h-4 w-4 text-[var(--color-success-600)]" /></Button>}
          {vendor.kycExempt && vendor.approvalStatus !== 'rejected' && <Button variant="ghost" size="sm" title={t('vendors.reject')} disabled={busyId === vendor.id} onClick={() => update(vendor, { approvalStatus: 'rejected' })}><XCircle className="h-4 w-4 text-[var(--color-error-600)]" /></Button>}
          <Button variant="ghost" size="sm" title={t(vendor.accountStatus === 'active' ? 'vendors.suspend' : 'vendors.reactivate')} disabled={busyId === vendor.id} onClick={() => update(vendor, { accountStatus: vendor.accountStatus === 'active' ? 'suspended' : 'active' })}>{vendor.accountStatus === 'active' ? <UserRoundX className="h-4 w-4" /> : <UserRoundCheck className="h-4 w-4" />}</Button>
        </div>}
      />
    </div></Card>}
  </div>;
}
