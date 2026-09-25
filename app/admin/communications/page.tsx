'use client';
import { CommunicationCenter } from '@/components/communication-center';

// FitFlex admins: messages to any member, including by area.
export default function AdminCommunicationsPage() {
  return <CommunicationCenter scope="admin" />;
}
