'use client';
import { PartnerPayouts } from '@/components/partner-payouts';

/** Vendor payouts: a weekly statement per vendor for delivered orders, after FitFlex's commission. */
export default function VendorSettlementsPage() {
  return <PartnerPayouts kind="vendor" />;
}
