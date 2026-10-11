'use client';
import { PartnerPayouts } from '@/components/partner-payouts';

/** Trainer payouts: a weekly statement per trainer for sessions that were completed or took place. */
export default function TrainerSettlementsPage() {
  return <PartnerPayouts kind="trainer" />;
}
