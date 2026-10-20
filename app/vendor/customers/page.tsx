'use client';
import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import type { VendorCustomerFilter, VendorCustomerSort, VendorPhoneDuplicate } from '@/lib/api';
import { isAgingBucket } from '@/lib/vendor';
import { Button, PageHeader, Segmented, useToast } from '@/components/shared';
import { CustomerFormDialog } from '@/components/vendor/customers/customer-form-dialog';
import { CustomerProfile } from '@/components/vendor/customers/customer-profile';
import { CustomersList, FILTERS, SORTS } from '@/components/vendor/customers/customers-list';
import { AGING_SORTS, OwedView, type AgingSort } from '@/components/vendor/customers/owed-view';
import { useOnline } from '@/components/vendor/customers/bits';
import { useApp } from '../../providers';

/**
 * Vendor customers (S4): list (?q, ?filter, ?sort), Owed to you (?view=owed, ?bucket, ?osort) and one customer's
 * profile (?id, ?tab, ?payment). Static export: query strings only. No POS and no pay-later sales here (decided):
 * the portal adds and edits customers, records and voids payments, and copies statements. The Shell guards the
 * area (tools.customers and the `customers` permission, both failing closed).
 */
function CustomersInner() {
  const { t } = useApp();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const online = useOnline();
  const [addOpen, setAddOpen] = useState(false);
  const [duplicate, setDuplicate] = useState<VendorPhoneDuplicate>(null);

  const view = params.get('view') === 'owed' ? 'owed' : 'list';
  const id = params.get('id');
  const q = (params.get('q') ?? '').trim();
  const filterParam = params.get('filter') as VendorCustomerFilter | null;
  const filter: VendorCustomerFilter = filterParam && FILTERS.includes(filterParam) ? filterParam : 'all';
  const sortParam = params.get('sort') as VendorCustomerSort | null;
  const sort: VendorCustomerSort = sortParam && SORTS.includes(sortParam) ? sortParam : 'name';
  const bucketParam = params.get('bucket');
  const bucket = isAgingBucket(bucketParam) ? bucketParam : null;
  const osortParam = params.get('osort') as AgingSort | null;
  const osort: AgingSort = osortParam && AGING_SORTS.includes(osortParam) ? osortParam : 'overdue';

  const setParams = (patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const s = next.toString();
    const url = s ? `${pathname}?${s}` : pathname;
    if (push) router.push(url, { scroll: false }); else router.replace(url, { scroll: false });
  };
  const openCustomer = (customerId: string) => setParams({ id: customerId, tab: null, payment: null }, true);

  if (id) {
    return (
      <CustomerProfile
        key={id}
        id={id}
        tab={params.get('tab')}
        paymentId={params.get('payment')}
        initialDuplicate={duplicate}
        onBack={() => { setDuplicate(null); setParams({ id: null, tab: null, payment: null }, true); }}
        onTab={tab => setParams({ tab: tab === 'sales' ? null : tab })}
        onPayment={pid => setParams({ payment: pid }, !!pid)}
        onOpenCustomer={cid => { setDuplicate(null); openCustomer(cid); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('vendor.nav.customers')}
        description={t('vendor.customers.portalDescription')}
        actions={
          <Button className="min-h-11" onClick={() => setAddOpen(true)} disabled={!online} data-testid="vendor-customers-add">
            <UserPlus aria-hidden="true" className="h-4 w-4" />{t('vendor.customers.add')}
          </Button>
        }
      />
      <Segmented
        className="w-fit flex-wrap"
        value={view}
        onChange={v => setParams(v === 'owed' ? { view: 'owed' } : { view: null, bucket: null, osort: null })}
        options={[['list', t('vendor.customers.seg.list')], ['owed', t('vendor.owed.title')]]}
      />
      {view === 'owed'
        ? <OwedView bucket={bucket} sort={osort} onOpen={openCustomer} onParams={patch => setParams('sort' in patch ? { osort: patch.sort } : patch)} />
        : <CustomersList q={q} filter={filter} sort={sort} online={online} onOpen={openCustomer} onAdd={() => setAddOpen(true)} onParams={setParams} />}

      <CustomerFormDialog
        open={addOpen}
        customer={null}
        onClose={() => setAddOpen(false)}
        onSaved={(customer, dup) => {
          setAddOpen(false);
          toast.success(t('vendor.customers.saved'));
          // To the new customer's profile; a shared phone number is a warning there (Q-7), never a block.
          setDuplicate(dup);
          openCustomer(customer.id);
        }}
      />
    </div>
  );
}

export default function VendorCustomersPage() {
  return <Suspense fallback={null}><CustomersInner /></Suspense>;
}
