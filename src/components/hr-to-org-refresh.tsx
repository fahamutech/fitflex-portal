'use client';
import { useEffect, useRef } from 'react';
import { useApp } from '../../app/providers';
import { api, ApiError } from '@/lib/api';

// Answers already worked out this browser session, per token: no need to ask on every page.
const CHECKED = 'hrToOrgChecked';
const checkedKey = (token: string) => `${CHECKED}:${token.slice(-24)}`;

/**
 * Phase B · B5b. A company HR login that signed in before ORG_ONLY_SPONSORS went on keeps a stored
 * user without the organisation fields, so it would stay in /hr until it signs in again. This asks
 * GET /b2b/me/organization-session (functions#252), which answers what a sign-in would say right now,
 * and merges the fields into the stored user when organizationUser is true. The token is unchanged
 * (so is the server's JWT), and the Shell then moves the person to /org without signing out.
 * Anything else (flag off, no organisation, 404 on an older server, an error) changes nothing.
 */
export function useHrToOrgRefresh() {
  const { ready, token, user, signIn } = useApp();
  const needsCheck = ready && !!token && user?.userType === 'corporate_hr' && user.organizationUser !== true;
  // The latest user and signIn, without re-running the check each time the provider renders.
  const latest = useRef({ user, signIn });
  latest.current = { user, signIn };

  useEffect(() => {
    if (!needsCheck || !token) return;
    const key = checkedKey(token);
    try { if (sessionStorage.getItem(key)) return; } catch { /* private mode: ask anyway */ }
    let cancelled = false;
    api.organizationSession(token).then((s) => {
      if (cancelled) return;
      const { user: current, signIn: store } = latest.current;
      if (s.organizationUser !== true || !current) {
        try { sessionStorage.setItem(key, 'unchanged'); } catch { /* fine */ }
        return;
      }
      store(token, {
        ...current,
        organizationUser: true,
        organizationRoles: s.organizationRoles ?? [],
        organizationIds: s.organizationIds ?? [],
      });
    }).catch((err) => {
      // An older server without the route: nothing to learn this session. Other errors: ask again next load.
      if (err instanceof ApiError && err.status === 404) { try { sessionStorage.setItem(key, 'unavailable'); } catch { /* fine */ } }
    });
    return () => { cancelled = true; };
  }, [needsCheck, token]);
}
