'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api, ORGANIZER_USER_TYPES, type OrganizerMe, type OrganizerRole } from '@/lib/api';
import { EVENTS_MODULE } from '@/lib/flags';
import { errorCode, isFeatureOff, isNoOrganizer } from '@/lib/events';
import { useApp } from '../../app/providers';

/**
 * Events S2 (spec §3): the signed-in person's organizer, loaded once from GET /organizer/me.
 * none: nothing to load (flag off, signed out, or not on an organizer page and not an organizer session) ·
 * loading · ready · no_organizer: this person has none yet (onboarding state A) ·
 * off: the server's EVENTS_MODULE is off (404 feature_disabled; fails closed) · error: could not load.
 */
export type OrganizerLoadStatus = 'none' | 'loading' | 'ready' | 'no_organizer' | 'off' | 'error';

interface OrganizerCtx {
  status: OrganizerLoadStatus;
  me: OrganizerMe | null;
  organizer: OrganizerMe['organizer'] | null;
  role: OrganizerRole | null;
  permissions: string[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<OrganizerCtx | null>(null);

export function useOrganizer(): OrganizerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useOrganizer must be inside <OrganizerProvider>');
  return c;
}

export function OrganizerProvider({ children }: { children: ReactNode }) {
  const { token, user } = useApp();
  const pathname = usePathname();
  const isOrganizerUser = !!token && ORGANIZER_USER_TYPES.has(user?.userType ?? '');
  const onOrganizerPage = pathname === '/organizer' || pathname.startsWith('/organizer/');
  // Anyone signed in may open /organizer/onboarding to request the capability (state A); organizer sessions load everywhere.
  const wanted = EVENTS_MODULE && !!token && (isOrganizerUser || onOrganizerPage);
  const [status, setStatus] = useState<OrganizerLoadStatus>('none');
  const [me, setMe] = useState<OrganizerMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!token || !wanted) return;
    const n = ++seq.current;
    setStatus(s => (s === 'ready' ? s : 'loading'));
    setError(null);
    try {
      const next = await api.organizerMe(token);
      if (n !== seq.current) return;
      setMe(next);
      setStatus('ready');
    } catch (err) {
      if (n !== seq.current) return;
      setMe(null);
      if (isNoOrganizer(err)) setStatus('no_organizer');
      else if (isFeatureOff(err)) setStatus('off');
      else { setStatus('error'); setError(errorCode(err) ?? 'network'); }
    }
  }, [token, wanted]);

  useEffect(() => {
    if (!wanted) { setMe(null); setStatus('none'); return; }
    setStatus('loading');
    void reload();
  }, [wanted, token, reload]);

  const value = useMemo<OrganizerCtx>(() => ({
    status, me, organizer: me?.organizer ?? null, role: me?.role ?? null, permissions: me?.permissions ?? [],
    loading: status === 'loading', error, reload,
  }), [status, me, error, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The admin nav count for /admin/events (spec §3): the number of submitted events, from GET /admin/events/summary.
 * null when the route is unavailable (404 feature_disabled, no scope): the nav item is then hidden, as for banners.
 */
export function useAdminEventsSummary(token: string | null | undefined, enabled: boolean): { available: boolean; submitted: number } {
  const [state, setState] = useState<{ available: boolean; submitted: number }>({ available: false, submitted: 0 });
  useEffect(() => {
    if (!enabled || !token || !EVENTS_MODULE) { setState({ available: false, submitted: 0 }); return; }
    let live = true;
    api.adminEventsSummary(token)
      .then(r => { if (live) setState({ available: true, submitted: Number(r?.submitted) || 0 }); })
      .catch(() => { if (live) setState({ available: false, submitted: 0 }); });
    return () => { live = false; };
  }, [token, enabled]);
  return state;
}
