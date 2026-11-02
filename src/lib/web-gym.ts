// Public gym page (S1): POST /public/gyms/resolve (backend functions#281). No sign-in: no Authorization header,
// no cookies, no referrer. The signed code `q` is only ever sent in the request body; it is never logged or stored.
import { API_BASE } from './api';

export type DayHours = string | { open: string | null; close: string | null } | null;
export type OperatingHours = null | string | Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'default', DayHours>>;

export interface WebGymClass { name: string; schedule: string | Record<string, unknown> | null; priceTzs: number | null; location: string | null }
export interface WebGymTrainer { name: string | null; photoUrl: string | null; specialties: string[]; rating: number | null; reviewCount?: number | null }
export interface WebGym {
  publicRef: string; name: string | null; description: string | null; tier: string; venueType: string; verified: boolean;
  rating: number | null; reviewCount: number | null; photos: string[]; thumbnail: string | null; area: string | null; address: string | null;
  lat: number | null; lng: number | null; directions: string | null; facilities: string[]; equipment: string[]; amenities: string[];
  services: string[]; operatingHours: OperatingHours; classes: WebGymClass[]; trainers: WebGymTrainer[];
}
export interface WebGymProfile {
  lang: 'en' | 'sw';
  /** Older replies carried heading labels; the page uses its own strings. Absent in newer replies. */
  labels?: Record<string, string>;
  gym: WebGym;
  membership: {
    currency: 'TZS';
    gymPlans: { plan: string; label: string; period: string; priceTzs: number; days: number }[];
    passTiers: { key: string; label: string; monthlyPriceTzs: number | null; visits: number | null; visitsLabel: string }[];
  };
}

export type ResolveResult =
  | { kind: 'ok'; profile: WebGymProfile }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | null }
  | { kind: 'error' };

const TIMEOUT_MS = 15_000;

/** Resolve a scanned code. Never throws; a network failure, timeout or unexpected reply is { kind: 'error' }. */
export async function resolveWebGym(q: string, lang: 'en' | 'sw', signal?: AbortSignal): Promise<ResolveResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${API_BASE}/public/gyms/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, lang }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (res.ok) {
      return body && typeof body === 'object' && body.gym && typeof body.gym === 'object'
        ? { kind: 'ok', profile: body as unknown as WebGymProfile }
        : { kind: 'error' };
    }
    if (res.status === 404) return { kind: 'not_found' };
    if (res.status === 429) {
      const n = Number(body?.retryAfterSeconds);
      return { kind: 'rate_limited', retryAfterSeconds: Number.isFinite(n) && n > 0 ? Math.ceil(n) : null };
    }
    return { kind: 'error' };
  } catch {
    return { kind: 'error' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** A map link for the gym's coordinates (opens the visitor's own map app on a phone). Null when they are not usable. */
export function mapUrl(lat: number | null, lng: number | null): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Only images the page can show safely: a data URI image, or an https address on the API's own origin. */
export function safeImage(src: unknown, apiBase: string = API_BASE): string | null {
  if (typeof src !== 'string') return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src)) return src;
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && u.origin === new URL(apiBase).origin ? src : null;
  } catch { return null; }
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type HoursRow = { day: (typeof DAYS)[number]; text: string | null };

function dayText(v: DayHours | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object') return v.open && v.close ? `${v.open}–${v.close}` : null;
  return null;
}

/**
 * Opening hours as display rows. A plain string is returned as { text }. For an object each day uses its own
 * entry, else `default`; a day with neither is left out; an entry that is present but empty means closed (text null).
 */
export function hoursView(raw: OperatingHours): { text: string } | { rows: HoursRow[] } | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() ? { text: raw.trim() } : null;
  const rows: HoursRow[] = [];
  for (const day of DAYS) {
    const own = dayText(raw[day]);
    const t = own !== undefined ? own : dayText(raw.default);
    if (t !== undefined) rows.push({ day, text: t });
  }
  return rows.length ? { rows } : null;
}
