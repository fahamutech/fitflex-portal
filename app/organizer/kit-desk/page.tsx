'use client';
// Events S7 (spec §3.14): the offline kit desk. One self-contained page with its own service worker (public/organizer/kit-desk/sw.js, scope /organizer/kit-desk/).
// No dynamic import() here: everything the desk needs is bundled so the page opens with no network.
import { OfflineKitDeskPage } from '@/components/organizer/kit-desk-offline/offline-desk-page';

export default function OrganizerKitDeskPage() {
  return <OfflineKitDeskPage />;
}
