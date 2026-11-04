'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Truck } from 'lucide-react';
import { isAgingBucket } from '@/lib/vendor';
import type { SupplierFilter, SupplierSort, PayablesSort } from '@/lib/vendor-purchases';
import { PageHeader, Segmented, useToast } from '@/components/shared';
import { useOnline } from '@/components/vendor/customers/bits';
import { PurchaseDetail } from '@/components/vendor/purchases/purchase-detail';
import { PurchasesView, type ListFilters } from '@/components/vendor/purchases/purchases-view';
import { SupplierFormDialog } from '@/components/vendor/purchases/supplier-form-dialog';
import { SupplierProfile } from '@/components/vendor/purchases/supplier-profile';
import { SUPPLIER_FILTERS, SUPPLIER_SORTS, SuppliersView } from '@/components/vendor/purchases/suppliers-view';
import { PAYABLES_SORTS, PayablesView } from '@/components/vendor/purchases/payables-view';
import { useApp } from '../../providers';

const btnPrimary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-brand-600)] bg-[var(--color-brand-600)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-700)]';

/**
 * Vendor purchases (S9 §5): one area with three views (?view= purchases · suppliers · payables), a purchase by
 * ?id= and a supplier by ?supplier= (static export: query strings only). Receive stock is its own page
 * (/vendor/purchases/receive/). The Shell guards the area (tools.purchases and `purchases`, both failing closed).
 */
function PurchasesInner() {
  const { t } = useApp();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const online = useOnline();
  const [addOpen, setAddOpen] = useState(false);

  const viewParam = params.get('view');
  const view = viewParam === 'suppliers' || viewParam === 'payables' ? viewParam : 'purchases';
  const id = params.get('id');
  const supplierId = params.get('supplier');

  const setParams = (patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    const url = s ? `${pathname}?${s}` : pathname;
    if (push) router.push(url, { scroll: false }); else router.replace(url, { scroll: false });
  };
  const openPurchase = (pid: string) => setParams({ id: pid, supplier: null }, true);
  const openSupplier = (sid: string) => setParams({ supplier: sid, id: null }, true);
  const toReceive = () => router.push('/vendor/purchases/receive/');

  if (id) return <PurchaseDetail key={id} id={id} onBack={() => setParams({ id: null }, true)} onOpenSupplier={openSupplier} />;
  if (supplierId) return <SupplierProfile key={supplierId} id={supplierId} onBack={() => setParams({ supplier: null, view: 'suppliers' }, true)} onOpenPurchase={openPurchase} onOpenSupplier={openSupplier} />;

  const filters: ListFilters = {
    from: params.get('from') ?? '', to: params.get('to') ?? '', supplierId: params.get('supplierId') ?? '',
    status: (['received', 'voided'].includes(params.get('status') ?? '') ? params.get('status') : 'all') as ListFilters['status'],
    payment: (['open', 'overdue', 'paid'].includes(params.get('payment') ?? '') ? params.get('payment') : 'all') as ListFilters['payment'],
    mine: params.get('mine') === '1',
  };
  const sfilter = (SUPPLIER_FILTERS as string[]).includes(params.get('sfilter') ?? '') ? params.get('sfilter') as SupplierFilter : 'active';
  const ssort = (SUPPLIER_SORTS as string[]).includes(params.get('ssort') ?? '') ? params.get('ssort') as SupplierSort : 'name';
  const bucketParam = params.get('bucket');
  const psort = (PAYABLES_SORTS as string[]).includes(params.get('psort') ?? '') ? params.get('psort') as PayablesSort : 'overdue';

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('vendor.nav.purchases')}
        actions={<Link href="/vendor/purchases/receive/" className={btnPrimary} data-testid="purchases-receive"><Truck aria-hidden="true" className="h-4 w-4" />{t('vendor.purchases.receive')}</Link>}
      />
      <Segmented
        className="w-fit max-w-full flex-wrap"
        value={view}
        onChange={v => setParams({ view: v === 'purchases' ? null : v, bucket: null, psort: null })}
        options={[['purchases', t('vendor.purchases.segPurchases')], ['suppliers', t('vendor.suppliers.title')], ['payables', t('vendor.payables.title')]]}
      />
      {view === 'suppliers' ? (
        <SuppliersView q={(params.get('q') ?? '').trim()} filter={sfilter} sort={ssort} online={online} onParams={setParams} onOpen={openSupplier} onAdd={() => setAddOpen(true)} />
      ) : view === 'payables' ? (
        <PayablesView bucket={isAgingBucket(bucketParam) ? bucketParam : null} sort={psort} onParams={setParams} onOpen={openSupplier} />
      ) : (
        <PurchasesView filters={filters} onOpen={openPurchase} onReceive={toReceive}
          onFilters={patch => setParams(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, k === 'mine' ? (v ? '1' : null) : (v === 'all' ? null : (v as string) || null)])))} />
      )}
      <SupplierFormDialog open={addOpen} supplier={null} onClose={() => setAddOpen(false)} onOpenSupplier={sid => { setAddOpen(false); openSupplier(sid); }}
        onSaved={s => { setAddOpen(false); toast.success(t('vendor.suppliers.saved')); openSupplier(s.id); }} />
    </div>
  );
}

export default function VendorPurchasesPage() {
  return <Suspense fallback={null}><PurchasesInner /></Suspense>;
}
