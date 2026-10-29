import type { Metadata } from 'next';

// The public gym page carries a signed code in its address: keep it out of search results and previews.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function GymLayout({ children }: { children: React.ReactNode }) {
  return children;
}
