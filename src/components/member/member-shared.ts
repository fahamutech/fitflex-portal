import type { Locale } from '@/lib/i18n';
import type { MeResponse, Pass, Subscription } from '@/lib/member-api';

export { fmt } from '@/lib/vendor';

/** A tier's display name from the catalogue, else the key with a capital letter. */
export function tierLabel(key: string | null | undefined, passes: Pass[]): string {
  if (!key) return '';
  const p = passes.find(x => x.key === key || x.id === key);
  return p?.label || key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * The member's FitFlex Pass. /me `subscription` is the newest subscription of any kind (a gym's own plan too), so the
 * pass comes from `entitlements.fitflexPass`; older servers without it: `subscription` when it is a platform pass.
 */
export function passOf(me: MeResponse | null): Subscription | null {
  if (!me) return null;
  if (me.entitlements && 'fitflexPass' in me.entitlements) return me.entitlements.fitflexPass ?? null;
  return me.subscription?.type === 'platform_pass' ? me.subscription : null;
}

export function isActive(me: MeResponse | null): boolean {
  return passOf(me)?.status === 'active';
}

/** Visits of the pass: /me counts them for `subscription`, so only when that is the pass. cap null = unlimited. */
export function passVisits(me: MeResponse | null): { used: number; cap: number | null } | null {
  const pass = passOf(me);
  if (!me || !pass || me.subscription?.id !== pass.id) return null;
  return { used: me.visitsUsed ?? 0, cap: unlimited(me.visitCap) ? null : me.visitCap };
}

/** The server sends -1 (or nothing) for an unlimited number of visits. */
export const unlimited = (n: number | null | undefined) => n == null || n < 0;

export function nameOf(me: MeResponse | null): string {
  const u = me?.user;
  const n = (u?.name || u?.displayName || '').trim();
  return n.split(/\s+/)[0] || '';
}

export type { Locale };

/** On a narrow screen the detail panel sits below the list: bring it into view after a choice. */
export function revealPanel(testId: string) {
  if (typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches) return;
  window.setTimeout(() => {
    document.querySelector(`[data-testid="${testId}"]`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, 50);
}
