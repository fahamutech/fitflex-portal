'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Locale, MessageKey, t as translate } from '@/lib/i18n';
import { setOnUnauthorized } from '@/lib/api';
import { PwaRegistration } from '@/components/pwa-registration';

export interface PortalAppUser {
  id: string;
  userType: string;
  gymId?: string;
  email?: string;
  portalUser?: boolean;
  aclPermissions?: string[];
}

interface AppCtx {
  ready: boolean;
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey) => string;
  token: string | null;
  user: PortalAppUser | null;
  signIn: (token: string, user: PortalAppUser) => void;
  signOut: () => void;
  hasPermission: (scope: string) => boolean;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp must be inside <Providers>');
  return c;
}

export function Providers({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AppCtx['user']>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const l = (typeof localStorage !== 'undefined' && localStorage.getItem('locale')) as Locale | null;
    if (l === 'en' || l === 'sw') setLocaleState(l);
    const t = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const u = typeof localStorage !== 'undefined' ? localStorage.getItem('user') : null;
    if (t && u) { setToken(t); setUser(JSON.parse(u)); }
    setReady(true);
  }, []);

  const setLocale = (l: Locale) => { localStorage.setItem('locale', l); setLocaleState(l); };
  const signIn = (tk: string, u: AppCtx['user']) => {
    localStorage.setItem('token', tk);
    localStorage.setItem('user', JSON.stringify(u));
    setToken(tk); setUser(u);
  };
  const signOut = useCallback(() => {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    setToken(null); setUser(null);
  }, []);

  // Super-admins (no portalUser flag or empty aclPermissions) can access everything.
  // Portal staff users with aclPermissions have granular access.
  const hasPermission = useCallback((scope: string): boolean => {
    if (!user) return false;
    if (user.userType === 'admin' && !user.portalUser) return true;
    return (user.aclPermissions ?? []).includes(scope);
  }, [user]);

  // Auto-logout on 401 from any API call
  useEffect(() => {
    setOnUnauthorized(signOut);
    return () => setOnUnauthorized(null);
  }, [signOut]);

  return (
    <Ctx.Provider value={{ ready, locale, setLocale, t: (k) => translate(locale, k), token, user, signIn, signOut, hasPermission }}>
      <PwaRegistration />
      {children}
    </Ctx.Provider>
  );
}
