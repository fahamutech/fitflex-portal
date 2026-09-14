'use client';

import { useEffect } from 'react';

export function PwaRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      // A previously-installed production worker can otherwise serve stale
      // Next.js chunks while developing, pairing old client code with fresh
      // server HTML and causing hydration mismatches.
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      void caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('fitflex-portal-')).map((key) => caches.delete(key))),
      );
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed', error);
    });
  }, []);

  return null;
}
