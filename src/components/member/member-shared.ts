import type { Locale } from '@/lib/i18n';
import type { MeResponse, Pass } from '@/lib/member-api';

export { fmt } from '@/lib/vendor';

/** A tier's display name from the catalogue, else the key with a capital letter. */
export function tierLabel(key: string | null | undefined, passes: Pass[]): string {
  if (!key) return '';
  const p = passes.find(x => x.key === key || x.id === key);
  return p?.label || key.charAt(0).toUpperCase() + key.slice(1);
}

export function isActive(me: MeResponse | null): boolean {
  return me?.subscription?.status === 'active';
}

export function nameOf(me: MeResponse | null): string {
  const u = me?.user;
  const n = (u?.name || u?.displayName || '').trim();
  return n.split(/\s+/)[0] || '';
}

export type { Locale };
