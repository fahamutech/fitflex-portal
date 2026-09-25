'use client';
import { CommunicationCenter } from '@/components/communication-center';

// Gym owners (and staff with the communications permission): messages to
// their gym's direct members.
export default function OwnerCommunicationsPage() {
  return <CommunicationCenter scope="owner" />;
}
