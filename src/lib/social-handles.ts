// Trainer social handles — the same cleaning rule as the backend
// (src/shared/trainer-access.mjs): accept `handle`, `@handle` or a profile
// URL and store the bare handle.
import type { TrainerSocialLinks } from './api';

export const SOCIAL_PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'twitter', label: 'X (Twitter)' },
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]['id'];

const HOSTS: Record<SocialPlatform, string[]> = {
  instagram: ['instagram.com', 'instagr.am'],
  facebook: ['facebook.com', 'fb.com', 'm.facebook.com'],
  twitter: ['twitter.com', 'x.com', 'mobile.twitter.com'],
};
const HANDLE_RE = /^[A-Za-z0-9._-]{1,50}$/;
const FB_NUMERIC_RE = /^profile\.php\?id=\d{1,30}$/;

/** The bare handle, '' for an empty value, or null when it is not valid. */
export function normalizeSocialHandle(platform: SocialPlatform, value: string | undefined | null): string | null {
  let v = String(value ?? '').trim();
  if (!v) return '';
  if (/^(https?:\/\/)?(www\.)?[a-z.]+\.[a-z]{2,}\//i.test(v)) {
    let url: URL;
    try { url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { return null; }
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (!HOSTS[platform].includes(host)) return null;
    if (platform === 'facebook' && url.pathname === '/profile.php') {
      const id = url.searchParams.get('id');
      return id && /^\d{1,30}$/.test(id) ? `profile.php?id=${id}` : null;
    }
    v = url.pathname.split('/').filter(Boolean)[0] || '';
  }
  if (platform === 'facebook' && FB_NUMERIC_RE.test(v)) return v;
  v = v.replace(/^@/, '');
  return HANDLE_RE.test(v) ? v : null;
}

/** Public profile URL for a stored handle. */
export function socialProfileUrl(platform: SocialPlatform, handle: string): string {
  if (platform === 'instagram') return `https://www.instagram.com/${handle}`;
  if (platform === 'facebook') return `https://www.facebook.com/${handle}`;
  return `https://x.com/${handle}`;
}

/** Clean every handle; `invalid` lists the platforms that did not validate. */
export function cleanSocialLinks(links?: TrainerSocialLinks | null): { links: TrainerSocialLinks; invalid: SocialPlatform[] } {
  const out: TrainerSocialLinks = {};
  const invalid: SocialPlatform[] = [];
  for (const { id } of SOCIAL_PLATFORMS) {
    const handle = normalizeSocialHandle(id, links?.[id]);
    if (handle === null) invalid.push(id);
    else out[id] = handle;
  }
  return { links: out, invalid };
}
