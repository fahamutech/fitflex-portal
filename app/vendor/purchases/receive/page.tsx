'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ReceiveStock } from '@/components/vendor/purchases/receive-stock';

/** Receive stock (S9 §5.2): a full page, not a dialog (it can hold many lines). ?supplier= preselects a supplier. */
function ReceiveInner() {
  const params = useSearchParams();
  return <ReceiveStock initialSupplierId={params.get('supplier')} />;
}

export default function VendorReceiveStockPage() {
  return <Suspense fallback={null}><ReceiveInner /></Suspense>;
}
