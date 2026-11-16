import type { Metadata } from 'next';

// The invite token is in the address (after #). Keep the page out of search results and send no referrer.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function GymPassInviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
