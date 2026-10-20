'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/shared';

/**
 * Old address from the design spec and from notification links (spec §4.3 "/vendor/merch?item=<id>"):
 * the vendor web portal keeps banners at /vendor/promotions. The query (item, tab) is kept.
 */
export default function VendorMerchRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace(`/vendor/promotions/${window.location.search}`); }, [router]);
  return <Spinner className="h-6 w-6" />;
}
