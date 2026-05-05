import './globals.css';
import { Providers } from './providers';
import { Shell } from '../src/components/Shell';

export const metadata = { title: 'FitFlex Af — Operator Portal' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
