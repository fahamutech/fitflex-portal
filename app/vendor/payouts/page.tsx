'use client';
import { PartnerPayouts } from '@/components/partner-payouts';

/** Vendor (or staff with `payments`): my weekly payout statements, read-only (?id=<statementId> opens one). */
export default function VendorPayoutsPage() {
  return <PartnerPayouts kind="vendor" audience="partner" />;
}
