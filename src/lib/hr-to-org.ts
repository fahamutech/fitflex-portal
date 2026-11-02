// Phase B · B5b: company HR moves from /hr to /org (server flag ORG_ONLY_SPONSORS; B2B_FOUNDATION.md §3a).
// No strings here. /hr itself is deleted in a later slice, two weeks after the flag goes on.
import { ORG_BILLING_ROLES, ORG_PEOPLE_ROLES } from '@/lib/api';

/** Where an organisation user lands: its people, else its billing, else its programmes (as at sign-in). */
export function orgHome(roles: string[] | undefined): string {
  const r = roles ?? [];
  return r.some(x => ORG_PEOPLE_ROLES.has(x)) ? '/org/people' : r.some(x => ORG_BILLING_ROLES.has(x)) ? '/org' : '/org/programmes';
}

// /hr is the HR area's challenges page; every other /hr page has the same name under /org.
const HR_TO_ORG: Record<string, string> = {
  '/hr': '/org/challenges',
  '/hr/rewards': '/org/rewards',
  '/hr/groups': '/org/groups',
  '/hr/people': '/org/people',
  '/hr/programmes': '/org/programmes',
  '/hr/insights': '/org/insights',
};

/** The /org page that replaces an /hr page, or null when the path is not in /hr. Deeper paths keep their tail. */
export function orgPathForHr(path: string): string | null {
  const p = path.replace(/\/$/, '') || '/';
  if (p !== '/hr' && !p.startsWith('/hr/')) return null;
  if (HR_TO_ORG[p]) return HR_TO_ORG[p];
  const base = Object.keys(HR_TO_ORG).filter(k => k !== '/hr').find(k => p.startsWith(`${k}/`));
  return base ? `${HR_TO_ORG[base]}${p.slice(base.length)}` : '/org/challenges';
}

/** A company HR session the server marked for the organisation area. */
export const isHrInOrg = (user: { userType?: string; organizationUser?: boolean } | null | undefined) =>
  user?.userType === 'corporate_hr' && user.organizationUser === true;
