// Member web portal (/m, flag NEXT_PUBLIC_MEMBER_PORTAL). Its own session and fetch wrapper on purpose:
// - the staff portal's request() signs the whole staff session out on a 401; a member 401 must only end the member session;
// - the member session lives under its own storage key and never touches the staff `token`/`user` keys.
// Nothing here logs anything, and no token, PIN or QR value is ever put in an address.
import { API_BASE } from './api';
import { normaliseError, type CheckinCode } from './web-checkin';

export const MEMBER_ROUTES = {
  home: '/m/', signin: '/m/signin/', pass: '/m/pass/', checkIn: '/m/check-in/',
  gyms: '/m/gyms/', trainers: '/m/trainers/', orders: '/m/orders/',
  activity: '/m/activity/', challenges: '/m/challenges/', events: '/m/events/', me: '/m/me/',
} as const;
const SESSION_KEY = 'ff_member_session';
const TIMEOUT_MS = 15_000;

// ── Types (shapes from fitflex-functions: subscriptions.mjs, mobile-money.mjs, checkins.mjs) ───────────────────────
export interface MemberUser { id: string; userType: string; name?: string | null; displayName?: string | null; phone?: string | null; email?: string | null; publicId?: string | null }
export interface MemberSession { token: string; user: MemberUser }
export interface Subscription { id: string; tier: string | null; type: string; status: string; startedAt?: string | null; expiresAt?: string | null; renewsAt?: string | null; homeGym?: { id: string; name: string } | null }
export interface PaymentRequest { id: string; tier: string | null; amountTzs: number; status: string; requestedAt: string; provider?: string | null; reference?: string | null; productType?: string | null; note?: string | null; gym?: { id: string; name: string } | null; eventName?: string | null }
export interface MeResponse { user: MemberUser; subscription: Subscription | null; pendingPayment: PaymentRequest | null; pendingPayments?: PaymentRequest[]; visitsUsed: number; visitCap: number | null }
export interface Pass { id: string; key: string; label: string; price: number; visitCap: number | null; visits?: number | null; gymAccess?: string | null }
export interface UpgradeOption { tier: string; label: string; monthlyPrice: number; visits?: number | null; differenceTzs: number }
export interface ManualPayment { enabled: boolean; lipaNamba?: string; accountName?: string; network?: string; instructions?: string; referenceRequired?: boolean; payerPhoneRequired?: boolean }
export interface PaymentOptions { enabled: boolean; provider?: string; environment?: string | null; manual?: ManualPayment; mobileMoney?: { products: string[] } }
export interface MemberQr { token: string; expiresAt: string; rotatesEverySeconds: number }
export interface Checkin { id: string; timestamp: string; status?: string; visitConsumed?: boolean; gym?: { id: string; name: string } | null }
export interface OperatingHours { [day: string]: { open?: string; close?: string; closed?: boolean } | string | null }
export interface Gym {
  id: string; name: string; tier?: string | null; location?: string | null; venueType?: string | null; accessMode?: string | null;
  coordinates?: { lat: number; lng: number } | null; thumbnail?: string | null; thumbnails?: string[]; images?: string[];
  operatingHours?: OperatingHours | null; amenities?: string[]; equipment?: string[]; verified?: boolean;
  rating?: number | null; reviewCount?: number | null;
}
export interface Trainer {
  id: string; displayName: string; photoUrl?: string | null; specialties?: string[]; bio?: string | null; gender?: string | null;
  rating?: number | null; reviewCount?: number | null; hourlyRateTzs?: number | null; experienceYears?: number | null;
  gymIds?: string[]; gyms?: Array<{ id: string; name: string }>; verified?: boolean; bookable?: boolean;
}
export interface ScheduleDay { date: string; weekday?: string; slots: Array<{ slot: string; status: 'available' | 'booked' | 'past'; gymIds?: string[] }> }
export interface BookingQuote { summary: { trainerId: string; gymId: string; slots: Array<{ date: string; slot: string }>; currency: string; passTier?: string | null; pricePerSession: number; discountPct: number; subtotal: number; discount: number; total: number } }
export interface TrainerBooking {
  id: string; trainerId: string; gymId: string; date: string; slot: string; status: string; amountTzs?: number; paymentRequestId?: string | null;
  trainer?: { id: string; displayName: string } | null; gym?: { id: string; name: string } | null;
}
export interface OrderItem { productId: string; name?: string | null; qty: number; priceTzs?: number; variant?: string | null; vendorName?: string | null }
export interface ShopOrder {
  id: string; items: OrderItem[]; totalTzs: number; status: string; deliveryMethod?: string; pickupGymId?: string | null; pickupGym?: { id: string; name: string } | null;
  paymentStatus?: string; timeline?: Array<{ status: string; at: string }>; createdAt: string; canCancel?: boolean;
}
export type PayState = 'in_progress' | 'completed' | 'failed' | 'held' | 'none';
export interface PayReply { state: PayState; reason?: string; paymentRequest?: PaymentRequest }

/** Error codes the member pages show. Sign-in codes come from the web check-in (same PIN sign-in, same EN/SW messages). */
export type MemberCode = CheckinCode | 'not_member' | 'payment_already_pending' | 'no_active_pass' | 'payment_reference_required'
  | 'payment_reference_invalid' | 'payment_reference_duplicate' | 'payer_phone_required' | 'payer_phone_invalid' | 'invalid_phone'
  | 'feature_disabled' | 'payment_not_pending' | 'too_many_attempts' | 'active_subscription_required'
  | 'slot_already_booked' | 'slot_in_past' | 'slot_not_available' | 'trainer_unavailable' | 'trainer_not_available_at_gym' | 'cannot_book_own_sessions'
  | 'challenge_closed' | 'challenge_paused' | 'team_required' | 'gym_required' | 'not_your_gym' | 'already_joined' | 'not_joined' | 'gym_owner_has_checkin_activity' | 'trainer_has_bookings'
  | 'organizer_owner' | 'account_deletion_failed' | 'invalid_field' | 'event_not_open' | 'registration_closed' | 'hold_limit_reached'
  | 'already_registered' | 'sold_out' | 'waitlist_full' | 'not_sold_out' | 'price_changed' | 'consent_version_stale' | 'participant_invalid' | 'validation_failed' | 'hold_expired' | 'waitlist_unavailable' | 'verification_required';
/** Codes with their own member.err.* message (src/lib/i18n-member.ts). */
export const MEMBER_PASSTHROUGH: ReadonlySet<string> = new Set<string>(['payment_already_pending', 'no_active_pass', 'payment_reference_required', 'payment_reference_invalid',
  'payment_reference_duplicate', 'payer_phone_required', 'payer_phone_invalid', 'invalid_phone', 'feature_disabled', 'payment_not_pending',
  'active_subscription_required', 'slot_already_booked', 'slot_in_past', 'slot_not_available', 'trainer_unavailable',
  'trainer_not_available_at_gym', 'cannot_book_own_sessions', 'challenge_closed', 'challenge_paused', 'team_required', 'gym_required', 'not_your_gym', 'already_joined', 'not_joined',
  'gym_owner_has_checkin_activity', 'trainer_has_bookings', 'organizer_owner', 'account_deletion_failed', 'invalid_field',
  'event_not_open', 'registration_closed', 'hold_limit_reached', 'already_registered', 'sold_out', 'waitlist_full', 'not_sold_out',
  'price_changed', 'consent_version_stale', 'participant_invalid', 'validation_failed', 'hold_expired', 'waitlist_unavailable', 'verification_required']);

export class MemberApiError extends Error {
  constructor(public status: number, public code: MemberCode) { super(code); }
}

// ── Session (own storage key; a blocked storage means memory only) ─────────────────────────────────────────────────
let mem: MemberSession | null = null;
let onEnded: (() => void) | null = null;
export function setOnSessionEnded(fn: (() => void) | null) { onEnded = fn; }

export function loadSession(): MemberSession | null {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as MemberSession;
    if (s && typeof s.token === 'string' && s.user?.userType === 'member') { mem = s; return s; }
  } catch { /* blocked or corrupt */ }
  return null;
}
function saveSession(s: MemberSession) {
  mem = s;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* memory only */ }
}
export function clearSession() {
  mem = null;
  try { localStorage.removeItem(SESSION_KEY); } catch { /* blocked */ }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Reply { status: number; body: Record<string, unknown> | null }
async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, opts: { body?: unknown; bearer?: string | null; headers?: Record<string, string> } = {}): Promise<Reply> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
    const res = await fetch(`${API_BASE}${path}`, {
      method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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

function codeOf(r: Reply): MemberCode {
  const raw = typeof r.body?.error === 'string' ? r.body.error : '';
  if (MEMBER_PASSTHROUGH.has(raw)) return raw as MemberCode;
  return normaliseError(r.status, r.body);
}

/** Signed-in request. A 401 ends the member session (never the staff one). */
async function authed<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const s = loadSession();
  if (!s) throw new MemberApiError(401, 'unauthorized');
  const r = await call(method, path, { body, bearer: s.token, headers });
  if (r.status === 401) { clearSession(); onEnded?.(); throw new MemberApiError(401, 'unauthorized'); }
  if (r.status < 200 || r.status >= 300) throw new MemberApiError(r.status, codeOf(r));
  return r.body as T;
}

// ── Sign-in: the same phone-or-email + PIN sign-in as the app and the web check-in ─────────────────────────────────
export type SignInResult = { ok: true; session: MemberSession } | { ok: false; code: MemberCode };
export async function signIn(identifier: string, pin: string): Promise<SignInResult> {
  const id = identifier.trim();
  const r = await call('POST', '/auth/pin/login', { body: { ...(id.includes('@') ? { email: id } : { phone: id }), pin } });
  if (r.status < 200 || r.status >= 300) return { ok: false, code: codeOf(r) };
  const b = r.body ?? {};
  // A PIN still held only by Firebase, an invitation start PIN or a person with no profile: finish in the app.
  if (b.setupRequired || b.onboarding || b.startPin || typeof b.token !== 'string') return { ok: false, code: 'setup_required' };
  const user = b.user as MemberUser | undefined;
  if (!user || user.userType !== 'member') return { ok: false, code: 'not_member' };
  const session = { token: b.token, user };
  saveSession(session);
  return { ok: true, session };
}

// ── Member data ───────────────────────────────────────────────────────────────────────────────────────────────────
export const memberApi = {
  me: () => authed<MeResponse>('GET', '/me'),
  passes: () => authed<Pass[] | { passes: Pass[] }>('GET', '/passes').then(r => Array.isArray(r) ? r : (r.passes ?? [])),
  upgradeOptions: () => authed<{ options: UpgradeOption[] }>('GET', '/me/upgrade-options').then(r => r.options ?? []),
  paymentOptions: () => authed<PaymentOptions>('GET', '/payments/options'),
  payments: () => authed<PaymentRequest[] | { payments: PaymentRequest[] }>('GET', '/me/payments').then(r => Array.isArray(r) ? r : (r.payments ?? [])),
  checkins: () => authed<Checkin[] | { checkins: Checkin[] }>('GET', '/me/checkins').then(r => Array.isArray(r) ? r : (r.checkins ?? [])),
  qr: () => authed<MemberQr>('GET', '/me/qr'),
  subscribe: (body: { tier: string; reference?: string; payerPhone?: string }) =>
    authed<{ paymentRequest: PaymentRequest }>('POST', '/me/subscribe', { type: 'platform_pass', ...body }),
  upgrade: (body: { tier: string; reference?: string; payerPhone?: string }) =>
    authed<{ paymentRequest: PaymentRequest }>('POST', '/me/upgrade', body),
  gyms: () => authed<Gym[]>('GET', '/gyms').then(r => Array.isArray(r) ? r : []),
  favoriteGymIds: () => authed<{ favoriteGymIds: string[] }>('GET', '/me/favorites/gyms').then(r => r.favoriteGymIds ?? []),
  setFavorite: (gymId: string, on: boolean) => authed<unknown>(on ? 'PUT' : 'DELETE', `/me/favorites/gyms/${encodeURIComponent(gymId)}`),
  trainers: () => authed<Trainer[] | { trainers: Trainer[] }>('GET', '/trainers').then(r => Array.isArray(r) ? r : (r.trainers ?? [])),
  trainerSchedule: (id: string, gymId: string, from: string, days = 7) =>
    authed<{ days: ScheduleDay[] }>('GET', `/trainers/${encodeURIComponent(id)}/schedule?from=${from}&days=${days}&gymId=${encodeURIComponent(gymId)}`).then(r => r.days ?? []),
  quoteBooking: (body: { trainerId: string; gymId: string; slots: Array<{ date: string; slot: string }> }) => authed<BookingQuote>('POST', '/me/trainer-bookings/quote', body),
  book: (body: { trainerId: string; gymId: string; slots: Array<{ date: string; slot: string }> }) =>
    authed<{ bookings: TrainerBooking[]; paymentRequest: PaymentRequest | null }>('POST', '/me/trainer-bookings', body),
  myBookings: () => authed<TrainerBooking[] | { bookings: TrainerBooking[] }>('GET', '/me/trainer-bookings').then(r => Array.isArray(r) ? r : (r.bookings ?? [])),
  shopOrders: () => authed<ShopOrder[] | { orders: ShopOrder[] }>('GET', '/me/shop-orders').then(r => Array.isArray(r) ? r : (r.orders ?? [])),
  payByMobileMoney: (paymentId: string, phone: string) =>
    authed<PayReply>('POST', `/me/payments/${encodeURIComponent(paymentId)}/mobile-money`, { phone }),
  refreshMobileMoney: (paymentId: string) =>
    authed<PayReply>('POST', `/me/payments/${encodeURIComponent(paymentId)}/mobile-money/refresh`),
};

/** Mobile money can pay a FitFlex Pass now (the `mobileMoney` key is absent while the B6a flag is off: passes are payable). */
export function canPayPassByMobileMoney(o: PaymentOptions | null): boolean {
  return canPayByMobileMoney(o, 'FITFLEX_PASS');
}
/**
 * Whether mobile money can pay this product now. Without the `mobileMoney` key (TUNZAA_TRAINER_PRODUCTS off) only
 * passes and gym plans are payable this way; trainer sessions then are not.
 */
export function canPayByMobileMoney(o: PaymentOptions | null, product: 'FITFLEX_PASS' | 'TRAINER_SERVICE' | 'EVENT_ORDER'): boolean {
  if (!o?.enabled) return false;
  if (!o.mobileMoney) return product === 'FITFLEX_PASS';
  return o.mobileMoney.products.includes(product);
}

/** Today in East Africa as YYYY-MM-DD. */
export function eatToday(now = new Date()): string {
  return new Date(+now + 3 * 3600_000).toISOString().slice(0, 10);
}

export function formatTzs(n: number, locale: 'en' | 'sw'): string {
  return `TZS ${new Intl.NumberFormat(locale === 'sw' ? 'sw-TZ' : 'en-GB').format(Math.round(n))}`;
}
export function formatDate(iso: string | null | undefined, locale: 'en' | 'sw', withTime = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  return new Intl.DateTimeFormat(locale === 'sw' ? 'sw-TZ' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Africa/Dar_es_Salaam',
  }).format(d);
}

// ── Slice 3: activity, challenges, events, account ────────────────────────────────────────────────────────────────
export interface Activity {
  id: string; type: string; source?: string | null; startedAt: string; durationMinutes?: number | null; activeMinutes?: number | null;
  distanceKm?: number | null; steps?: number | null; calories?: number | null; movingSeconds?: number | null; elevationGainM?: number | null;
  hasRoute?: boolean; notes?: string | null; deviceName?: string | null; workoutId?: string | null;
}
export interface Workout { id: string; name?: string | null; status: string; scheduledDate?: string | null; completedAt?: string | null; durationMinutes?: number | null }
export type RoutePoint = [number, number, number | null, number, number | null];
export interface Challenge {
  id: string; name: string; description?: string | null; type: string; target: number; startDate: string; endDate: string;
  mode: 'individual' | 'teams' | 'gym_vs_gym' | 'department' | string; phase: 'upcoming' | 'active' | 'ended' | 'cancelled' | string;
  joined: boolean; leaderboardOptIn: boolean; participantCount: number; rewards?: unknown; status?: string;
  teams: Array<{ id: string; name: string; gymId?: string | null }>; creator?: { type: string; id: string; name: string | null } | null;
}
export interface Leaderboard {
  individuals: Array<{ rank: number; name: string; progress: number; fraction: number; completed: boolean; you?: boolean }>;
  you?: { optedIn: boolean; rank: number; of: number; progress: number };
  teamStandings?: Array<{ teamId?: string; name: string; rank?: number; fraction?: number; progress?: number }>;
}
export interface CommsPrefs {
  inAppMarketing: boolean; pushMarketing: boolean; whatsappMarketing: boolean; smsMarketing: boolean;
  whatsappAvailable: boolean; smsAvailable: boolean; locale?: string | null;
}

export const memberApi3 = {
  activities: () => authed<Activity[] | { activities: Activity[] }>('GET', '/me/activities').then(r => Array.isArray(r) ? r : (r.activities ?? [])),
  activityRoute: (id: string) => authed<{ route: { segments: RoutePoint[][] } }>('GET', `/me/activities/${encodeURIComponent(id)}/route`).then(r => r.route?.segments ?? []),
  deleteActivity: (id: string) => authed<unknown>('DELETE', `/me/activities/${encodeURIComponent(id)}`),
  workouts: () => authed<Workout[] | { workouts: Workout[] }>('GET', '/me/workouts').then(r => Array.isArray(r) ? r : (r.workouts ?? [])),
  challenges: () => authed<{ challenges: Challenge[] }>('GET', '/me/challenges').then(r => r.challenges ?? []),
  challenge: (id: string) => authed<Challenge | { challenge: Challenge }>('GET', `/challenges/${encodeURIComponent(id)}`).then(r => ('challenge' in r && r.challenge ? r.challenge : r) as Challenge),
  joinChallenge: (id: string, body: { teamId?: string; gymId?: string; leaderboardOptIn: boolean }) => authed<unknown>('POST', `/challenges/${encodeURIComponent(id)}/join`, body),
  leaveChallenge: (id: string) => authed<unknown>('POST', `/challenges/${encodeURIComponent(id)}/leave`),
  setLeaderboardOptIn: (id: string, optIn: boolean) => authed<unknown>('PUT', `/challenges/${encodeURIComponent(id)}/leaderboard-opt-in`, { optIn }),
  leaderboard: (id: string) => authed<Leaderboard>('GET', `/challenges/${encodeURIComponent(id)}/leaderboard`),
  saveProfile: (body: { displayName?: string; email?: string }) => authed<unknown>('POST', '/me/profile', body),
  commsPrefs: () => authed<{ preferences: CommsPrefs } | CommsPrefs>('GET', '/me/communication-preferences').then(r => ('preferences' in r ? r.preferences : r) as CommsPrefs),
  setCommsPrefs: (body: Partial<Pick<CommsPrefs, 'inAppMarketing' | 'pushMarketing' | 'whatsappMarketing' | 'smsMarketing'>> & { locale?: string }) =>
    authed<unknown>('PUT', '/me/communication-preferences', body),
  deleteAccount: () => authed<{ ok: boolean }>('DELETE', '/me'),
};

// ── Events (module behind EVENTS_MODULE on the server and NEXT_PUBLIC_EVENTS_MODULE here) ─────────────────────────
export interface EventsOptions { discovery: boolean; registration: boolean; payment?: 'none' | 'manual' | 'provider'; waitlist?: boolean; consentTextVersion?: string }
export interface EventSummary {
  id: string; slug?: string; title: string; type?: string; startsAt: string; timezone?: string; availability: string;
  venue?: { name?: string | null; city?: string | null } | null; heroThumbUrl?: string | null; fromPriceTzs?: number | null; distancesM?: number[];
  organizer?: { name: string; verified?: boolean } | null;
}
export interface TicketType { id: string; name: string; priceTzs: number; availability: string; waitlist?: { state: string } | null }
export interface EventCategory { id: string; name: string; distanceM?: number | null; startsAt?: string | null; availability: string; remaining?: number | null; ticketTypes: TicketType[] }
export interface EventDetail extends EventSummary {
  description?: { en?: string | null; sw?: string | null } | null; heroImageUrl?: string | null; categories: EventCategory[];
  venue?: { name?: string | null; city?: string | null; address?: string | null } | null; terms?: string | null; refundPolicy?: unknown;
}
export interface Participant {
  ticketTypeId: string; firstName: string; lastName: string; phone?: string; dateOfBirth?: string;
  emergencyContact?: { name: string; phone: string }; kitSize?: string; consentBasis: 'self';
}
export type FieldPolicy = 'required' | 'optional' | 'off';
export interface EventQuote {
  valid: boolean; quote: { currency: string; subtotalTzs: number; discountTzs: number; feesTzs: number; totalTzs: number; feeLabel?: string | null };
  participants: Array<{ index: number; ok: boolean; problems: Array<{ field: string; code: string }> }>; problems: Array<{ code: string }>;
  fields?: Record<string, FieldPolicy>; termsVersion?: string; consentText?: { version: string; self: string };
}
export interface EventOrder { id: string; reference: string; status: string; totalTzs: number; holdExpiresAt?: string | null }
export interface EventTicket { registrationId: string; ticketId?: string | null; displayCode?: string | null; state: string; event: EventSummary; category?: { name: string } | null; ticketType?: { name: string } | null }

export function newIdempotencyKey(): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `m-${r}`;
}

export const eventsApi = {
  options: () => authed<EventsOptions>('GET', '/events/options'),
  list: () => authed<{ items: EventSummary[] }>('GET', '/events?sort=soonest&limit=30').then(r => r.items ?? []),
  detail: (id: string) => authed<EventDetail>('GET', `/events/${encodeURIComponent(id)}`),
  quote: (body: { eventId: string; lines: Array<{ ticketTypeId: string; quantity: number }>; participants: Participant[] }) =>
    authed<EventQuote>('POST', '/me/event-orders/quote', body),
  place: (key: string, body: { eventId: string; lines: Array<{ ticketTypeId: string; quantity: number }>; participants: Participant[]; acceptedTerms: true; consentTextVersion?: string; expectedTotalTzs: number }) =>
    authed<{ order: EventOrder }>('POST', '/me/event-orders', body, { 'Idempotency-Key': key }),
  startPayment: (orderId: string, key: string, body: { reference?: string; payerPhone?: string }) =>
    authed<{ next: { payment: string; paymentRequestId?: string | null }; order: EventOrder }>('POST', `/me/event-orders/${encodeURIComponent(orderId)}/payment`, body, { 'Idempotency-Key': key }),
  tickets: () => authed<{ items: EventTicket[] }>('GET', '/me/event-tickets').then(r => r.items ?? []),
  ticket: (registrationId: string) => authed<{ ticket: { displayCode: string; state: string }; qrPayload: string }>('GET', `/me/event-registrations/${encodeURIComponent(registrationId)}/ticket`),
  joinWaitlist: (eventId: string, body: { ticketTypeId: string; participants: Participant[]; consent: { accepted: true; textVersion?: string } }) =>
    authed<{ entry: { id: string; position?: number | null } }>('POST', `/me/events/${encodeURIComponent(eventId)}/waitlist`, body),
};
