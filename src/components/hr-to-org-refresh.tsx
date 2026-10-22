'use client';
import { useEffect, useRef } from 'react';
import { useApp } from '../../app/providers';
import { api } from '@/lib/api';

// Answers already worked out this browser session, per token: no need to ask on every page.
const CHECKED = 'hrToOrgChecked';
const checkedKey = (token: string) => `${CHECKED}:${token.slice(-24)}`;

/**
 * Phase B · B5b. A company HR login that signed in before ORG_ONLY_SPONSORS went on keeps a stored
 * user without the organisation marks, so it would stay in /hr until it signs in again. Sign-in is the
 * only response that carries the marks (GET /me does not), so this works them out the way the server
 * does (b2bService.organizationSessionMarks = GET /b2b/me/organizations while the flag is on) and stores
 * them. The token is unchanged (the server's JWT is too), and the Shell then moves the person to /org.
 *
 * With the flag off nothing changes: GET /b2b/me/organizations lists a company's organisation for its
 * HR login either way, so the flag is checked first (api.orgOnlySponsors); off or unknown leaves the
 * stored user alone.
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
    (async () => {
      const { organizations } = await api.myB2BOrganizations(token);
      if (cancelled) return;
      if (!organizations.length) { try { sessionStorage.setItem(key, 'none'); } catch { /* fine */ } return; }
      const flag = await api.orgOnlySponsors(token, organizations[0].id);
      if (cancelled) return;
      // Unknown (network, server error): ask again on the next page load.
      if (flag === 'unknown') return;
      try { sessionStorage.setItem(key, flag); } catch { /* fine */ }
      const { user: current, signIn: store } = latest.current;
      if (flag !== 'on' || !current) return;
      store(token, {
        ...current,
        organizationUser: true,
        organizationRoles: [...new Set(organizations.map(o => o.role))],
        organizationIds: organizations.map(o => o.id),
      });
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [needsCheck, token]);
}
