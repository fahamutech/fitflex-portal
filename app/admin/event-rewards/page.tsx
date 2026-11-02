'use client';
import { Suspense } from 'react';
import { EVENTS_MODULE } from '@/lib/flags';
import { EventRewardDesk } from '@/components/admin-event-rewards';
import { EventsUnavailable } from '@/components/organizer/page-states';

/** Events S6 reward desk (spec §9.4). The existing /admin/rewards stays the challenge-reward queue; this one is for event rewards and medal art. */
export default function AdminEventRewardsPage() {
  if (!EVENTS_MODULE) return <EventsUnavailable />;
  return <Suspense fallback={null}><EventRewardDesk /></Suspense>;
}
