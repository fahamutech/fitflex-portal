import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
import { Providers } from './providers';
import { Shell } from '../src/components/Shell';

export const metadata = {
  title: 'FitFlex Af — Operator Portal',
  description: 'FitFlex Af operator and admin portal for gym check-ins, payments, and pilot operations.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'FitFlex Portal',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport = {
  themeColor: '#101828',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Set <html lang> before first paint for returning Swahili users; the
            provider keeps it in step afterwards. Static string, no user input. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var l=localStorage.getItem('locale');if(l==='sw'||l==='en')document.documentElement.lang=l}catch(e){}",
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
