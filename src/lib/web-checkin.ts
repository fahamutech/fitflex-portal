// Browser gym check-in (S2 portal; backend functions#284). Own fetch wrapper on purpose: the portal's request()
// signs the whole portal out on a 401, which must never happen here. Nothing in this file logs anything, and no
// token, PIN or signed code is ever put in an address. The PIN-login token is exchanged for a 15-minute purpose
// token and dropped at once; the purpose token and the intent token live in memory only (module variables), so a
// reload loses them. Only the signed gym code `q` is kept in sessionStorage so a reload can start over.
import { API_BASE } from './api';
import type { MessageKey } from './i18n';

export const INTENT_STORAGE_KEY = 'ff_webcheckin_intent';
export const CHECKIN_ROUTES = { signin: '/g/signin/', confirm: '/g/confirm/', done: '/g/done/' } as const;
/** Only these may use the page; admin, operator, staff and the rest are refused. */
export const CHECKIN_USER_TYPES = ['member', 'trainer'] as const;

export type CheckinCode =
  | 'wrong_pin' | 'locked' | 'pin_reset_required' | 'unauthorized' | 'role_refused' | 'setup_required' | 'account_unavailable'
  | 'unavailable' | 'rate_limited' | 'server_error' | 'network' | 'unknown'
  | 'subscription_inactive' | 'wrong_gym' | 'tier_not_covered' | 'tier_not_configured' | 'basic_daily_limit' | 'visits_exhausted'
  | 'gym_closed' | 'gym_not_verified' | 'member_not_found'
  | 'invalid_intent' | 'intent_expired' | 'intent_used' | 'gym_not_found'
  | 'confirmation_required' | 'invalid_idempotency_key';

/** Reasons a preview or a confirm can refuse with (the check-in rules, the same as the app). */
export const REFUSAL_CODES: readonly CheckinCode[] = [
  'subscription_inactive', 'wrong_gym', 'tier_not_covered', 'tier_not_configured', 'basic_daily_limit', 'visits_exhausted',
  'gym_closed', 'gym_not_verified', 'member_not_found',
];
const PASSTHROUGH = new Set<string>([
  ...REFUSAL_CODES, 'invalid_intent', 'intent_expired', 'intent_used', 'gym_not_found', 'confirmation_required',
  'invalid_idempotency_key', 'pin_reset_required', 'rate_limited', 'server_error',
]);

/**
 * The API answers errors in three shapes ({ error }, { ok:false, failure }, { ok:false, error }). One code comes out.
 * A body-less status is mapped from the status alone; status 0 is a network failure.
 */
export function normaliseError(status: number, body: unknown): CheckinCode {
  if (status === 0) return 'network';
  const b = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const raw = typeof b.failure === 'string' ? b.failure : typeof b.error === 'string' ? b.error : '';
  if (raw === 'invalid_credentials') return 'wrong_pin';
  if (raw === 'too_many_attempts') return 'locked';
  if (raw === 'not_found' || raw === 'pin_not_configured') return 'unavailable';
  if (raw === 'account_suspended' || raw === 'person_not_active' || raw === 'no_profile' || raw === 'vendor_staff_inactive' || raw === 'session_ended') {
    return raw === 'session_ended' ? 'unauthorized' : 'account_unavailable';
  }
  if (PASSTHROUGH.has(raw)) return raw as CheckinCode;
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'role_refused';
  if (status === 404) return 'unavailable';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/** i18n key for each code (EN and SW live in src/lib/i18n.ts under web.checkin.err.*). */
export const ERROR_KEYS: Record<CheckinCode, MessageKey> = {
  wrong_pin: 'web.checkin.err.wrong_pin', locked: 'web.checkin.err.locked', pin_reset_required: 'web.checkin.err.locked',
  unauthorized: 'web.checkin.err.unauthorized', role_refused: 'web.checkin.err.role_refused', setup_required: 'web.checkin.err.setup_required',
  account_unavailable: 'web.checkin.err.account_unavailable', unavailable: 'web.checkin.err.unavailable', rate_limited: 'web.checkin.err.rate_limited',
  server_error: 'web.checkin.err.server_error', network: 'web.checkin.err.network', unknown: 'web.checkin.err.unknown',
  subscription_inactive: 'web.checkin.err.subscription_inactive', wrong_gym: 'web.checkin.err.wrong_gym', tier_not_covered: 'web.checkin.err.tier_not_covered',
  tier_not_configured: 'web.checkin.err.tier_not_configured', basic_daily_limit: 'web.checkin.err.basic_daily_limit', visits_exhausted: 'web.checkin.err.visits_exhausted',
  gym_closed: 'web.checkin.err.gym_closed', gym_not_verified: 'web.checkin.err.gym_not_verified', member_not_found: 'web.checkin.err.member_not_found',
  invalid_intent: 'web.checkin.err.invalid_intent', intent_expired: 'web.checkin.err.intent_expired', intent_used: 'web.checkin.err.intent_used',
  gym_not_found: 'web.checkin.err.gym_not_found', confirmation_required: 'web.checkin.err.confirmation_required', invalid_idempotency_key: 'web.checkin.err.invalid_idempotency_key',
};

// ── State kept in memory (module variables; a reload clears them) ─────────────────────────────────────────────────
interface Intent { token: string; expiresAtMs: number; gymName: string }
export type Outcome =
  | { kind: 'success'; idempotent: boolean; gymName: string; timestamp: string | null; visitNumber: number | null }
  | { kind: 'error'; code: CheckinCode };

let memQ: string | null = null;
let sessionToken: string | null = null;
let intent: Intent | null = null;
let outcome: Outcome | null = null;

export const getSessionToken = () => sessionToken;
export const getOutcome = () => outcome;
export const setOutcome = (o: Outcome | null) => { outcome = o; };
export const getIntent = () => intent;

/** Remember the signed code for this tab: memory and sessionStorage (own key, never the portal's token/user keys). */
export function rememberQ(q: string): void {
  memQ = q;
  try { sessionStorage.setItem(INTENT_STORAGE_KEY, q); } catch { /* storage blocked: memory only */ }
}
export function getQ(): string | null {
  if (memQ) return memQ;
  try { const v = sessionStorage.getItem(INTENT_STORAGE_KEY); if (v) { memQ = v; return v; } } catch { /* blocked */ }
  return null;
}
/** Drop the purpose token (a 401, or a reload that never ran this). The code and intent stay so sign-in can resume. */
export function dropSession(): void { sessionToken = null; intent = null; }
/** Done / sign out: forget everything, including the stored code. */
export function clearAll(): void {
  memQ = null; sessionToken = null; intent = null; outcome = null;
  try { sessionStorage.removeItem(INTENT_STORAGE_KEY); } catch { /* blocked */ }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const TIMEOUT_MS = 15_000;
interface Reply { status: number; body: Record<string, unknown> | null }

async function call(method: 'GET' | 'POST', path: string, opts: { body?: unknown; bearer?: string; channel?: boolean } = {}): Promise<Reply> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
    if (opts.channel) headers['X-FitFlex-Channel'] = 'web-checkin';
    const res = await fetch(`${API_BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctl.signal,
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body: body && typeof body === 'object' ? body as Record<string, unknown> : null };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export type Fail = { ok: false; code: CheckinCode; retryAfterSeconds: number | null };
const fail = (r: Reply): Fail => {
  const n = Number(r.body?.retryAfterSeconds);
  return { ok: false, code: normaliseError(r.status, r.body), retryAfterSeconds: Number.isFinite(n) && n > 0 ? Math.ceil(n) : null };
};

/**
 * GET /auth/options. 'off' only when the server says so (pinLogin false) or the route is not found; a 5xx, a timeout or
 * a network failure is 'unknown' and must not hide the sign-in form.
 */
export async function pinLoginAvailable(): Promise<'on' | 'off' | 'unknown'> {
  const r = await call('GET', '/auth/options');
  if (r.status === 200 && r.body) return r.body.pinLogin === true ? 'on' : 'off';
  if (r.status === 404) return 'off';
  return 'unknown';
}

/**
 * PIN sign-in, then straight into the 15-minute check-in token; the long sign-in token is a local variable that
 * goes out of scope here and is never stored. Only member and trainer accounts may continue.
 */
export async function signInWithPin(identifier: string, pin: string): Promise<{ ok: true } | Fail> {
  const id = identifier.trim();
  const login = await call('POST', '/auth/pin/login', { body: { ...(id.includes('@') ? { email: id } : { phone: id }), pin }, channel: true });
  if (login.status !== 200 || !login.body) return fail(login);
  const b = login.body;
  const token = typeof b.token === 'string' ? b.token : '';
  const user = b.user && typeof b.user === 'object' ? b.user as Record<string, unknown> : null;
  if (b.setupRequired || !token || !user) return { ok: false, code: 'setup_required', retryAfterSeconds: null };
  if (!(CHECKIN_USER_TYPES as readonly string[]).includes(String(user.userType))) return { ok: false, code: 'role_refused', retryAfterSeconds: null };
  const minted = await call('POST', '/auth/web-checkin/session', { bearer: token });
  if (minted.status !== 200 || typeof minted.body?.token !== 'string') return fail(minted);
  sessionToken = minted.body.token as string;
  return { ok: true };
}

/** A fresh intent for the stored code (10 minutes). Kept in memory. */
export async function refreshIntent(): Promise<{ ok: true; gymName: string } | Fail> {
  const q = getQ();
  if (!q) return { ok: false, code: 'unavailable', retryAfterSeconds: null };
  const r = await call('POST', '/public/web-checkin/intent', { body: { q } });
  const b = r.body;
  if (r.status !== 200 || !b || typeof b.intentToken !== 'string') return fail(r);
  const gym = b.gym && typeof b.gym === 'object' ? b.gym as Record<string, unknown> : {};
  const exp = Date.parse(String(b.expiresAt));
  intent = { token: b.intentToken, expiresAtMs: Number.isFinite(exp) ? exp : Date.now() + 10 * 60_000, gymName: typeof gym.name === 'string' ? gym.name : '' };
  return { ok: true, gymName: intent.gymName };
}

/** The intent in memory, or a new one when there is none or it is about to run out. */
export async function ensureIntent(): Promise<{ ok: true; token: string } | Fail> {
  if (!intent || intent.expiresAtMs - Date.now() < 15_000) {
    const r = await refreshIntent();
    if (!r.ok) return r;
  }
  return { ok: true, token: intent!.token };
}

export interface Preview { eligible: boolean; reason: CheckinCode | null; visitsLeft: number | null; alreadyCheckedIn: boolean; gymName: string }

/** Read-only preview. An expired or unknown intent is renewed once with the stored code. A 401 drops the session. */
export async function previewCheckin(): Promise<{ ok: true; preview: Preview } | Fail> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const i = await ensureIntent();
    if (!i.ok) return i;
    if (!sessionToken) return { ok: false, code: 'unauthorized', retryAfterSeconds: null };
    const r = await call('POST', '/me/web-checkins/preview', { body: { intentToken: i.token }, bearer: sessionToken });
    if (r.status === 200 && r.body) {
      const b = r.body;
      const gym = b.gym && typeof b.gym === 'object' ? b.gym as Record<string, unknown> : {};
      const reason = typeof b.reason === 'string' ? normaliseError(409, { failure: b.reason }) : null;
      return {
        ok: true,
        preview: {
          eligible: b.eligible === true, reason: b.eligible === true ? null : (reason ?? 'unknown'),
          visitsLeft: typeof b.visitsLeft === 'number' && Number.isFinite(b.visitsLeft) ? b.visitsLeft : null,
          alreadyCheckedIn: b.alreadyCheckedIn === true,
          gymName: typeof gym.name === 'string' ? gym.name : intent?.gymName ?? '',
        },
      };
    }
    const f = fail(r);
    if (f.code === 'unauthorized') dropSession();
    if (attempt === 0 && (f.code === 'intent_expired' || f.code === 'invalid_intent')) { intent = null; continue; }
    return f;
  }
  return { ok: false, code: 'unknown', retryAfterSeconds: null };
}

/** 8-100 characters of A-Z a-z 0-9 _ - . */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Send confirm:true. Called only from the explicit confirm click. Any refusal is returned, not retried: after an
 * expired intent the screen renews it and asks again.
 */
export async function confirmCheckin(idempotencyKey: string): Promise<{ ok: true; outcome: Extract<Outcome, { kind: 'success' }> } | Fail> {
  if (!sessionToken) return { ok: false, code: 'unauthorized', retryAfterSeconds: null };
  const i = await ensureIntent();
  if (!i.ok) return i;
  const r = await call('POST', '/me/web-checkins', { body: { intentToken: i.token, confirm: true, idempotencyKey }, bearer: sessionToken });
  const b = r.body;
  if (r.status === 200 && b && b.ok === true) {
    const c = b.checkin && typeof b.checkin === 'object' ? b.checkin as Record<string, unknown> : {};
    const gym = c.gym && typeof c.gym === 'object' ? c.gym as Record<string, unknown> : {};
    return {
      ok: true,
      outcome: {
        kind: 'success', idempotent: b.idempotent === true,
        gymName: typeof gym.name === 'string' ? gym.name : intent?.gymName ?? '',
        timestamp: typeof c.timestamp === 'string' ? c.timestamp : null,
        visitNumber: typeof b.visitNumberInCycle === 'number' && Number.isFinite(b.visitNumberInCycle) ? b.visitNumberInCycle : null,
      },
    };
  }
  const f = fail(r);
  if (f.code === 'unauthorized') dropSession();
  if (f.code === 'intent_expired' || f.code === 'invalid_intent') intent = null;
  return f;
}

const SW_MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "29 Oct, 14:05" in Dar es Salaam time whatever the phone's own zone is. The caller adds the zone label (web.checkin.tz.eat).
 * Month names are our own tables, so the result does not depend on the browser's ICU data. East Africa Time is UTC+3, no DST.
 */
export function formatEat(iso: string | null, locale: 'en' | 'sw'): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Dar_es_Salaam', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const month = (locale === 'sw' ? SW_MONTHS : EN_MONTHS)[Number(get('month')) - 1] ?? get('month');
  return `${Number(get('day'))} ${month}, ${get('hour')}:${get('minute')}`;
}

// A note for the sign-in screen when a screen sent the person back to it (for example "your sign-in ended").
let resumeCode: CheckinCode | null = null;
export const setResumeCode = (c: CheckinCode | null) => { resumeCode = c; };
export function takeResumeCode(): CheckinCode | null { const c = resumeCode; resumeCode = null; return c; }
