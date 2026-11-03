import type { Metadata } from 'next';

// Member pages are personal: keep them out of search results and link previews.
export const metadata: Metadata = {
  title: 'FitFlex — Member',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
