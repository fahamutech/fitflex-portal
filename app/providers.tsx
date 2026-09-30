'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Locale, MessageKey, t as translate } from '@/lib/i18n';
import { api, setOnUnauthorized, type PersonaSummary } from '@/lib/api';
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
  /** Identity V2: personas this portal session can switch to (empty when V2 is off). */
  switchablePersonas: PersonaSummary[];
  switchPersona: (personaId: string) => Promise<PortalAppUser>;
}

// Only personas the portal has screens for; members, trainers and vendors
// use the app, and admin personas are never switched into.
const PORTAL_PERSONA_TYPES = new Set(['gym_operator', 'gym_staff', 'corporate_hr']);

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
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);

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
    setToken(null); setUser(null); setPersonas([]);
  }, []);

  // Identity V2: the Person's personas; a 404 means V2 is off.
  useEffect(() => {
    if (!token) { setPersonas([]); return; }
    let cancelled = false;
    api.myPersonas(token)
      .then(r => { if (!cancelled) setPersonas(Array.isArray(r.personas) ? r.personas : []); })
      .catch(() => { if (!cancelled) setPersonas([]); });
    return () => { cancelled = true; };
  }, [token]);

  const switchablePersonas = personas.filter(p =>
    p.id !== user?.id && PORTAL_PERSONA_TYPES.has(p.userType) && !p.portalOnly
    && p.accountStatus !== 'suspended' && p.approvalStatus !== 'rejected');

  const switchPersona = useCallback(async (personaId: string) => {
    if (!token) throw new Error('not signed in');
    const res = await api.switchPersona(token, personaId);
    localStorage.setItem('token', res.token);
    localStorage.setItem('user', JSON.stringify(res.user));
    setToken(res.token); setUser(res.user);
    if (Array.isArray(res.personas)) setPersonas(res.personas);
    return res.user;
  }, [token]);

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
    <Ctx.Provider value={{ ready, locale, setLocale, t: (k) => translate(locale, k), token, user, signIn, signOut, hasPermission, switchablePersonas, switchPersona }}>
      <PwaRegistration />
      {children}
    </Ctx.Provider>
  );
}
