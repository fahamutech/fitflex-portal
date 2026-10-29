// Events S5 mock (spec docs/design/events-s5-venue-api-and-webhooks.md §3 to §7): the kit desk, bibs, export, API clients,
// webhook endpoints, the delivery log and the payout schedule. STRICT about the spec's real shapes: it refuses what the backend
// would refuse (a missing Idempotency-Key, a wrong role, a userId in a body, a scope the role cannot grant, a private webhook
// address, a payout change after publish, a bib that is taken), so a portal that guesses a shape fails the spec instead of
// passing against a lenient mock. State moves as writes are accepted.
import type { Json } from './events-mock';

export type S5Opts = {
  /** The server's options probe (`ops`). Default: all three on. */
  kit?: boolean; api?: boolean; webhooks?: boolean;
  /** The pilot allowlist (D39). Default true; false makes POST /organizer/api-clients answer 403 `api_not_enabled`. */
  apiAllowed?: boolean;
  /** Status of evt_pub for the desk states (published | completed | cancelled). */
  eventStatus?: string;
  /** Failed verify outcomes allowed per minute before 429 (the spec says 30). */
  failLimit?: number;
  /** Endpoint hosts that fail the handshake / the test send. */
  noCollectionPoints?: boolean;
  /** Trap: the server leaks a phone number in a card; the portal must never render it. */
  leak?: boolean;
  /** The bib list carries `assignmentId` (the backend is adding it). Default true; false shows the disabled Release state. */
  assignmentIds?: boolean;
  /** Verify and the 409 carry `collectionId` (the backend is adding it). Default true; false exercises the history fallback. */
  collectionIds?: boolean;
};
type Reply = Json | { status: number; json: Json } | { status: 200 | 201; body: string; headers?: Record<string, string> } | { status: 204 };
type Call = { method: string; path: string; query: Record<string, string>; body: Json | null; headers?: Record<string, string> };
type Handler = (c: Call, m: RegExpMatchArray) => Reply | undefined;

export const TICKET = {
  valid: 'FFEV1:ev1.k1.tkt_amina.1.aaaaaaaaaaaaaaaa',
  collected: 'FFEV1:ev1.k1.tkt_baraka.1.bbbbbbbbbbbbbbbb',
  revoked: 'FFEV1:ev1.k1.tkt_chausiku.1.cccccccccccccccc',
  other: 'FFEV1:ev1.k1.tkt_otherevent.1.dddddddddddddddd',
  foreign: 'FFEV1:ev1.k1.tkt_foreign.1.eeeeeeeeeeeeeeee',
  noBib: 'FFEV1:ev1.k1.tkt_daudi.1.ffffffffffffffff',
};
export const GYM_QR = 'usr_member1.9876543.sigsigsig';
const NAME_OF = (r: Json) => `${r.first} ${String(r.last).charAt(0)}.`;

export const COLLECTION_POINTS = [
  { id: 'cp_1', name: 'Expo Hall', address: 'Coco Beach', lat: -6.75, lng: 39.27, windows: [{ opensAt: '2027-03-12T06:00:00.000Z', closesAt: '2027-03-13T14:00:00.000Z' }], instructions: { en: 'Bring ID', sw: 'Leta kitambulisho' } },
  { id: 'cp_2', name: 'Mall Desk', address: 'Mlimani City', lat: -6.77, lng: 39.22, windows: [{ opensAt: '2027-03-12T06:00:00.000Z', closesAt: '2027-03-13T14:00:00.000Z' }], instructions: { en: 'Level 2', sw: 'Ghorofa ya 2' } },
];
const CAT = { cat_1: { name: '21K Half Marathon', distanceM: 21100 }, cat_2: { name: '10K', distanceM: 10000 } } as Record<string, { name: string; distanceM: number }>;

const baseRegs = (): Json[] => [
  { id: 'reg_1', first: 'Amina', last: 'Mollel', cat: 'cat_1', ticket: TICKET.valid, code: 'AMN-1001', status: 'confirmed', bib: null, size: 'M', pay: 'paid', kit: 'ready', created: '2027-01-01T08:00:00.000Z' },
  { id: 'reg_2', first: 'Baraka', last: 'Mushi', cat: 'cat_1', ticket: TICKET.collected, code: 'BRK-1002', status: 'confirmed', bib: '1002', size: 'L', pay: 'paid', kit: 'collected', created: '2027-01-02T08:00:00.000Z' },
  { id: 'reg_3', first: 'Chausiku', last: 'Juma', cat: 'cat_2', ticket: TICKET.revoked, code: 'CHS-1003', status: 'cancelled', bib: null, size: null, pay: 'refunded', kit: 'not_ready', revoked: 'refunded', created: '2027-01-03T08:00:00.000Z' },
  { id: 'reg_4', first: 'Daudi', last: 'Kway', cat: 'cat_2', ticket: null, code: 'DAU-1004', status: 'reserved', bib: null, size: null, pay: 'unpaid', kit: 'not_ready', created: '2027-01-04T08:00:00.000Z' },
  { id: 'reg_5', first: 'Neema', last: 'Swai', cat: 'cat_2', ticket: TICKET.noBib, code: 'NEM-1005', status: 'confirmed', bib: null, size: null, pay: 'paid', kit: 'ready', created: '2027-01-05T08:00:00.000Z' },
  { id: 'reg_6', first: '=cmd', last: 'Formula', cat: 'cat_2', ticket: null, code: 'FRM-1006', status: 'confirmed', bib: null, size: null, pay: 'paid', kit: 'ready', created: '2027-01-06T08:00:00.000Z' },
];

const rand = (n: number) => Array.from({ length: n }, (_, i) => 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_'[(i * 7 + 3) % 38]).join('');
const URL_BLOCKED = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa|metadata\.google\.internal)$/i;
/** §7.2 rules 1 to 3 as a function: the reason the backend would give, or null when the address is fine. */
export function urlReason(raw: string): string | null {
  if (raw.length > 2000) return 'too_long';
  let u: URL;
  try { u = new URL(raw); } catch { return 'not_https'; }
  if (u.protocol !== 'https:') return 'not_https';
  if (u.username || u.password) return 'credentials_in_url';
  if (u.port && u.port !== '443') return 'bad_port';
  const host = u.hostname.replace(/\.$/, '');
  if (/^\d+(\.\d+){0,3}$/.test(host) || host.startsWith('[') || host.includes(':') || /^0x/i.test(host)) return 'ip_literal';
  if (URL_BLOCKED.test(host) || !host.includes('.')) return 'blocked_host';
  if (/^(private|internal)-/.test(host)) return 'blocked_address';
  if (/^nxdomain-/.test(host)) return 'unresolvable';
  return null;
}

export type S5State = {
  regs: Json[]; collections: Json[]; clients: Json[]; endpoints: Json[]; deliveries: Json[]; idem: Record<string, { body: string; reply: Json }>;
  bibVersion: number; exports: number; payout: Record<string, string | null>; verifyFails: number; secrets: string[]; logins: Json[];
};

export function makeS5(user: Json, me: Json | null, o: S5Opts) {
  const role: string = me?.role ?? (user.userType === 'event_organizer' ? 'owner' : 'ops');
  const orgStatus: string = me?.organizer?.status ?? 'active';
  const suspended = orgStatus === 'suspended';
  const scopes: string[] | null = user.portalUser ? (user.aclPermissions ?? []) : null;
  const hasScope = (s: string) => user.userType === 'admin' && (scopes === null || scopes.includes(s));
  const status = o.eventStatus ?? 'published';
  const points = o.noCollectionPoints ? [] : COLLECTION_POINTS;
  const options = {
    discovery: true, favourites: false, registration: true, currency: 'TZS', closingSoonHours: 72, regions: [{ code: 'dar', name: { en: 'Dar es Salaam', sw: 'Dar es Salaam' } }], timezones: ['Africa/Dar_es_Salaam'],
    holdTtlMinutes: 30, maxParticipantsPerOrder: 10, payment: 'none', teams: true, corporate: true, claim: { smsCodes: true, emailCodes: false }, consentTextVersion: '2026-10-draft',
    tickets: { qr: true, scanning: o.kit !== false }, ops: { kit: o.kit !== false, api: o.api !== false, webhooks: o.webhooks !== false }, payoutSchedules: ['biweekly', 'monthly'],
  };
  const state: S5State = {
    regs: baseRegs(), collections: [], clients: [], endpoints: [], deliveries: [], idem: {}, bibVersion: 1, exports: 0, payout: { evt_pub: 'biweekly', evt_1: null }, verifyFails: 0, secrets: [], logins: [],
  };
  state.collections.push({ id: 'col_0', registrationId: 'reg_2', status: 'collected', collectedAt: '2027-03-12T08:00:00.000Z', pointId: 'cp_1', by: 'Asha', method: 'scan' });
  state.deliveries.push({
    id: 'dlv_dead', endpointId: 'whk_seed', eventType: 'kit.collected', outboxEventId: 'obx_0123456789abcdef', forEventId: 'evt_pub', status: 'dead', attemptCount: 3, createdAt: '2027-03-12T08:00:00.000Z', lastAttemptAt: '2027-03-12T09:00:00.000Z', nextAttemptAt: null,
    responseCode: 500, lastError: 'http_500', manualRetryCount: 0, payload: { type: 'kit.collected', data: { registrationId: 'reg_2' } },
    attempts: [
      { attemptNo: 1, trigger: 'auto', startedAt: '2027-03-12T08:00:00.000Z', durationMs: 120, outcome: 'http_error', responseCode: 500, responseSnippet: 'Internal Server Error [redacted]', errorCode: 'http_500', nextAttemptAt: '2027-03-12T08:01:00.000Z' },
      { attemptNo: 2, trigger: 'auto', startedAt: '2027-03-12T08:01:00.000Z', durationMs: 10000, outcome: 'timeout', responseCode: null, responseSnippet: null, errorCode: 'timeout', nextAttemptAt: null },
    ],
  });
  state.endpoints.push({
    id: 'whk_seed', url: 'https://hooks.timing.test/fitflex', host: 'hooks.timing.test', rotation: { inGrace: false, graceEndsAt: null }, events: ['kit.collected', 'bib.assigned'], eventIds: null, description: null, status: 'active', verifiedAt: '2027-03-10T08:00:00.000Z', lastSuccessAt: null,
    last24h: { delivered: 0, failed: 3, dead: 1 }, pending: 0, oldestPendingAgeSeconds: null, consecutiveFailures: 3, health: 'failing', secretHint: 'whsec_…abcd', createdAt: '2027-03-10T08:00:00.000Z',
  });

  const forbiddenRole = () => ({ status: 403, json: { error: 'forbidden_role' } });
  const noEvent = () => ({ status: 404, json: { error: 'event_not_found' } });
  const inRoles = (...r: string[]) => r.includes(role);
  const ownerAdmin = () => inRoles('owner', 'admin');
  const KEY = /^.{8,100}$/;
  const noIds = (c: Call) => (c.body && ('userId' in c.body || 'ownerId' in c.body || 'staffUserId' in c.body || 'organizerId' in c.body));
  const reg = (id: string) => state.regs.find(r => r.id === id);
  const live = (r: Json) => r.status === 'confirmed' || (r.status === 'cancelled' && r.pay === 'refunded');
  const card = (r: Json) => ({
    displayName: NAME_OF(r), ticketCode: r.code, categoryName: CAT[r.cat].name, distanceM: CAT[r.cat].distanceM, ticketTypeName: 'Standard', teamName: null, bibNumber: r.bib, kitSize: r.size,
    kit: { state: r.kit, ...(r.kit === 'collected' ? { collectedAt: '2027-03-12T08:00:00.000Z', collectionPointName: 'Expo Hall' } : {}) }, payment: r.pay,
    ...(o.leak ? { phone: '+255712000000', email: 'leak@example.com' } : {}),
  });
  /** Idempotency like §6: same key + same body replays the stored answer; another body is 409. */
  const idempotent = (c: Call, route: string, work: () => { status: number; json: Json }) => {
    const key = c.headers?.['idempotency-key'];
    if (!key || !KEY.test(key)) return { status: 400, json: { error: 'idempotency_key_required' } };
    if (noIds(c)) return { status: 400, json: { error: 'invalid_body' } };
    const k = `${role}|${route}|${key}`;
    const fp = JSON.stringify(c.body ?? {});
    const seen = state.idem[k];
    if (seen) return seen.body === fp ? { status: 200, json: seen.reply } : { status: 409, json: { error: 'idempotency_key_reused' } };
    const out = work();
    if (out.status < 300) state.idem[k] = { body: fp, reply: out.json };
    return out;
  };
  const byPayload = (payload: string) => state.regs.find(r => r.ticket === payload || (r.ticket && r.ticket.replace('FFEV1:', '') === payload));
  const pointName = (id: string | undefined) => points.find(p => p.id === id)?.name ?? null;

  const doc = (id: string) => {
    if (id !== 'evt_pub') return undefined;
    return { collectionPoints: points, kitProvided: true, status, payoutSchedule: state.payout.evt_pub };
  };

  const routes: Array<[string, RegExp, Handler]> = [
    ['GET', /^\/events\/options$/, () => options],
    // ── verify (§4.1) ──
    ['POST', /^\/organizer\/events\/([^/]+)\/tickets\/verify$/, (c, m) => {
      if (!options.ops.kit) return { status: 404, json: { error: 'feature_disabled' } };
      if (!inRoles('owner', 'admin', 'ops')) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      const payload = c.body?.payload;
      if (noIds(c) || typeof payload !== 'string') return { status: 400, json: { error: 'invalid_payload' } };
      if (payload.length > 200) return { status: 400, json: { error: 'invalid_payload' } };
      if (!/^(FFEV1:)?ev1\./.test(payload)) return { status: 400, json: { error: 'not_event_ticket' } };
      const fail = (body: Json) => {
        state.verifyFails += 1;
        if (state.verifyFails > (o.failLimit ?? 30)) return { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 20 } };
        return body;
      };
      if (payload.includes('tkt_foreign')) return fail({ result: 'unknown', warnings: [], canCollect: false, canOverride: false });
      if (payload.includes('tkt_otherevent')) return fail({ result: 'wrong_event', otherEvent: { title: 'Arusha Fun Run' }, warnings: [], canCollect: false, canOverride: false });
      const r = byPayload(payload);
      if (!r) return fail({ result: 'unknown', warnings: [], canCollect: false, canOverride: false });
      if (r.revoked) return { result: 'revoked', registrationId: r.id, revokedReason: r.revoked, card: card(r), warnings: [], canCollect: false, canOverride: false };
      const warnings = [...(r.bib ? [] : ['bib_missing']), ...(r.size ? [] : ['kit_size_missing'])];
      if (r.kit === 'collected') {
        const col = state.collections.find(x => x.registrationId === r.id && x.status === 'collected');
        return { result: 'already_collected', registrationId: r.id, card: card(r), warnings, collectedAt: col?.collectedAt ?? '2027-03-12T08:00:00.000Z', collectionPointName: pointName(col?.pointId) ?? 'Expo Hall', byFirstName: col?.by ?? 'Asha', canCollect: false, canOverride: ownerAdmin(), ...(o.collectionIds === false ? {} : { collectionId: col?.id }) };
      }
      return { result: 'valid', registrationId: r.id, card: card(r), warnings, canCollect: !suspended && inRoles('owner', 'admin', 'ops'), canOverride: false };
    }],
    // ── collect (§4.2) ──
    ['POST', /^\/organizer\/events\/([^/]+)\/kit-collections$/, (c, m) => {
      if (!options.ops.kit) return { status: 404, json: { error: 'feature_disabled' } };
      if (!inRoles('owner', 'admin', 'ops')) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      if (suspended) return { status: 403, json: { error: 'organizer_suspended' } };
      return idempotent(c, 'collect', () => {
        const b = c.body ?? {};
        if (!['scan', 'manual'].includes(b.method)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'method', code: 'invalid' }] } };
        if (points.length && !b.collectionPointId) return { status: 422, json: { error: 'collection_point_required' } };
        if (b.collectionPointId && !points.some(p => p.id === b.collectionPointId)) return { status: 422, json: { error: 'collection_point_invalid' } };
        let r: Json | undefined;
        if (b.method === 'scan') { if (!b.payload) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'payload', code: 'required' }] } }; r = byPayload(b.payload); }
        else {
          if (!b.registrationId) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'registrationId', code: 'required' }] } };
          if (!['phone_lost', 'no_signal', 'screen_damaged', 'other'].includes(b.manualReason)) return { status: 422, json: { error: 'manual_reason_required' } };
          r = reg(b.registrationId);
        }
        if (!r) return { status: 404, json: { error: 'registration_not_found' } };
        if (r.revoked) return { status: 409, json: { error: 'ticket_revoked', reason: r.revoked } };
        if (r.pay !== 'paid') return { status: 409, json: { error: 'registration_unpaid' } };
        if (r.kit === 'collected') {
          const col = state.collections.find(x => x.registrationId === r.id && x.status === 'collected');
          return { status: 409, json: { error: 'already_collected', collectedAt: col?.collectedAt, collectionPointName: pointName(col?.pointId), byFirstName: col?.by ?? 'Asha', canOverride: ownerAdmin(), ...(o.collectionIds === false ? {} : { collectionId: col?.id }) } };
        }
        const col = { id: `col_${state.collections.length}`, registrationId: r.id, status: 'collected', collectedAt: '2027-03-12T09:30:00.000Z', pointId: b.collectionPointId, by: (user.displayName ?? 'Asha').split(' ')[0], method: b.method, manualReason: b.manualReason };
        state.collections.push(col); r.kit = 'collected';
        return { status: 201, json: { collection: { id: col.id, status: 'collected', collectedAt: col.collectedAt, collectionPointId: col.pointId ?? null }, card: card(r) } };
      });
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/kit-collections\/([^/]+)\/corrections$/, (c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      return idempotent(c, 'correct', () => {
        const b = c.body ?? {};
        if (!['void', 'recollect'].includes(b.action)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'action', code: 'invalid' }] } };
        const reason = String(b.reason ?? '').trim();
        if (reason.length < 10 || reason.length > 300) return { status: 422, json: { error: 'reason_required' } };
        const col = state.collections.find(x => x.id === m[2]);
        if (!col) return { status: 404, json: { error: 'collection_not_found' } };
        if (col.status !== 'collected') return { status: 409, json: { error: 'already_corrected' } };
        col.status = 'corrected'; col.correctionReason = reason;
        const r = reg(col.registrationId)!;
        r.kit = 'ready';
        let newCollectionId: string | undefined;
        if (b.action === 'recollect') { newCollectionId = `col_${state.collections.length}`; state.collections.push({ id: newCollectionId, registrationId: r.id, status: 'collected', collectedAt: '2027-03-12T10:00:00.000Z', pointId: col.pointId, by: 'Owner', method: 'scan' }); r.kit = 'collected'; }
        return { status: 200, json: { corrected: { collectionId: col.id, action: b.action, ...(newCollectionId ? { newCollectionId } : {}) } } };
      });
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/kit-collections$/, (c, m) => {
      if (!inRoles('owner', 'admin', 'ops')) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      const items = state.collections.filter(x => !c.query.status || x.status === c.query.status).slice().reverse().map(x => {
        const r = reg(x.registrationId)!;
        return { id: x.id, registrationId: x.registrationId, displayName: NAME_OF(r), bibNumber: r.bib, status: x.status, collectedAt: x.collectedAt, collectionPointName: pointName(x.pointId) ?? 'Expo Hall', byFirstName: x.by, method: x.method, ...(x.manualReason ? { manualReason: x.manualReason } : {}), ...(x.correctionReason ? { correctionReason: x.correctionReason } : {}) };
      });
      return { items: items.slice(0, Number(c.query.limit ?? 50)), nextCursor: null };
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/kit\/summary$/, (_c, m) => {
      if (!inRoles('owner', 'admin', 'ops')) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      const confirmed = state.regs.filter(r => r.status === 'confirmed').length;
      const collected = state.regs.filter(r => r.kit === 'collected').length;
      return { confirmed, collected, remaining: confirmed - collected, exceptions: 0, byCategory: [], byCollectionPoint: [] };
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/kit\/lookup$/, (c, m) => {
      if (!inRoles('owner', 'admin', 'ops')) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      const q = String(c.query.q ?? '').trim();
      if (q.length < 3) return { status: 400, json: { error: 'query_too_short' } };
      const lc = q.toLowerCase();
      const exact = state.regs.find(r => r.id === q);
      const hits = exact ? [exact] : state.regs.filter(r => r.status === 'confirmed' && (r.bib === q || r.code.toLowerCase() === lc || r.first.toLowerCase().startsWith(lc) || r.last.toLowerCase().startsWith(lc))).slice(0, 10);
      return { items: hits.map(r => ({ registrationId: r.id, card: card(r), warnings: [], canCollect: r.pay === 'paid' && r.kit !== 'collected' })) };
    }],
    // ── bibs (§4.3) ──
    ['GET', /^\/organizer\/events\/([^/]+)\/bib-assignments$/, (c, m) => {
      if (!inRoles('owner', 'admin', 'ops', 'timing')) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      const confirmed = state.regs.filter(r => r.status === 'confirmed');
      const q = String(c.query.q ?? '').toLowerCase();
      let rows = confirmed.filter(r => (!c.query.categoryId || r.cat === c.query.categoryId) && (c.query.filter !== 'assigned' || r.bib) && (c.query.filter !== 'unassigned' || !r.bib)
        && (!q || `${r.first} ${r.last}`.toLowerCase().includes(q) || (r.bib ?? '').toLowerCase() === q || r.code.toLowerCase() === q));
      rows = rows.slice(0, Number(c.query.limit ?? 50));
      return {
        items: rows.map(r => ({ registrationId: r.id, displayName: `${r.first} ${r.last}`, categoryName: CAT[r.cat].name, bibNumber: r.bib, assignedAt: r.bib ? '2027-03-01T08:00:00.000Z' : null, kit: { state: r.kit }, assignmentId: o.assignmentIds === false ? undefined : r.bib ? `asg_${r.id}` : null, warnings: r.bib && r.kit === 'collected' && r.bibChanged ? ['bib_changed_after_collection'] : [] })),
        nextCursor: null, counts: { assigned: confirmed.filter(r => r.bib).length, unassigned: confirmed.filter(r => !r.bib).length },
      };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/bib-assignments$/, (c, m) => {
      if (!inRoles('owner', 'admin', 'ops')) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      return idempotent(c, 'bib', () => {
        const b = c.body ?? {};
        const r = reg(b.registrationId);
        if (!r) return { status: 404, json: { error: 'registration_not_found' } };
        if (r.status !== 'confirmed') return { status: 409, json: { error: 'registration_unpaid' } };
        const bib = String(b.bibNumber ?? '').trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(bib)) return { status: 422, json: { error: 'bib_invalid' } };
        if (r.bib && !b.replace) return { status: 409, json: { error: 'bib_already_assigned', current: r.bib } };
        if (b.replace) {
          if (!ownerAdmin()) return forbiddenRole();
          const reason = String(b.reason ?? '').trim();
          if (reason.length < 10 || reason.length > 300) return { status: 422, json: { error: 'reason_required' } };
        }
        if (state.regs.some(x => x.id !== r.id && x.bib === bib)) return { status: 409, json: { error: 'bib_taken' } };
        const previousBibNumber = r.bib ?? null;
        if (r.bib && r.kit === 'collected') r.bibChanged = true;
        r.bib = bib; state.bibVersion += 1;
        return { status: 201, json: { assignment: { id: `asg_${r.id}`, registrationId: r.id, bibNumber: bib, assignedAt: '2027-03-12T09:00:00.000Z' }, previousBibNumber, warnings: r.bibChanged ? ['bib_changed_after_collection'] : [] } };
      });
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/bib-assignments\/([^/]+)\/release$/, (c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      return idempotent(c, 'release', () => {
        const r = reg(String(m[2]).replace('asg_', ''));
        if (!r) return { status: 404, json: { error: 'assignment_not_found' } };
        if (!r.bib) return { status: 409, json: { error: 'already_released' } };
        if (String(c.body?.reason ?? '').trim().length < 10) return { status: 422, json: { error: 'reason_required' } };
        const released = { id: `asg_${r.id}`, registrationId: r.id, bibNumber: r.bib };
        r.bib = null; state.bibVersion += 1;
        return { status: 200, json: { released, warnings: [] } };
      });
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/bib-assignments\/bulk\/preview$/, (c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      const b = c.body ?? {};
      if (!Number.isInteger(b.start) || b.start < 0 || 'onlyUnassigned' in b || ('order' in b && !['registered_at', 'last_name'].includes(b.order))) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'start', code: 'invalid' }] } };
      const todo = state.regs.filter(r => r.status === 'confirmed' && !r.bib && (!b.categoryId || r.cat === b.categoryId));
      const label = (n: number) => `${b.prefix ?? ''}${String(n).padStart(b.padTo ?? 0, '0')}`;
      const count = todo.length; const last = count ? b.start + count - 1 : b.start;
      const shortfall = b.end != null && last > b.end ? last - b.end : 0;
      const conflicts = state.regs.filter(r => r.bib && Array.from({ length: count }, (_, i) => label(b.start + i)).includes(r.bib)).map(r => ({ bibNumber: r.bib }));
      return { previewHash: `ph_${state.bibVersion}_${JSON.stringify(b)}`, count, first: count ? label(b.start) : null, last: count ? label(last) : null, conflicts, shortfall };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/bib-assignments\/bulk$/, (c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      return idempotent(c, 'bulk', () => {
        const { previewHash, ...b } = c.body ?? {};
        if (previewHash !== `ph_${state.bibVersion}_${JSON.stringify(b)}`) return { status: 409, json: { error: 'preview_stale' } };
        const todo = state.regs.filter(r => r.status === 'confirmed' && !r.bib && (!b.categoryId || r.cat === b.categoryId));
        todo.forEach((r, i) => { r.bib = `${b.prefix ?? ''}${String(b.start + i).padStart(b.padTo ?? 0, '0')}`; });
        state.bibVersion += 1;
        return { status: 200, json: { assigned: todo.length, first: todo[0]?.bib ?? null, last: todo[todo.length - 1]?.bib ?? null } };
      });
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/bib-assignments\/import\/preview$/, (c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      const csv = String(c.body?.csv ?? '');
      if (csv.length > 512 * 1024) return { status: 413, json: { error: 'payload_too_large' } };
      const lines = csv.split(/\r?\n/).filter(Boolean);
      if (!/registrationId|ticketCode/.test(lines[0] ?? '') || !/bibNumber/.test(lines[0] ?? '')) return { status: 422, json: { error: 'csv_header_invalid' } };
      const seen = new Set<string>();
      const rows = lines.slice(1).map((ln, i) => {
        const [id, bib] = ln.split(/[,;]/).map(x => x.trim());
        const line = i + 2; const up = (bib ?? '').toUpperCase();
        const r = reg(id) ?? state.regs.find(x => x.code === id);
        let code: string | undefined;
        if (!r) code = 'registration_not_found'; else if (r.status !== 'confirmed') code = 'registration_not_confirmed';
        else if (r.bib) code = 'already_assigned'; else if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(up)) code = 'bib_invalid';
        else if (seen.has(up)) code = 'bib_duplicate_in_file'; else if (state.regs.some(x => x.bib === up)) code = 'bib_taken';
        seen.add(up);
        return code ? { line, status: 'error', code, bibNumber: up } : { line, status: 'ok', bibNumber: up };
      });
      return { previewHash: `ih_${state.bibVersion}_${csv.length}`, total: rows.length, ok: rows.filter(r => r.status === 'ok').length, bad: rows.filter(r => r.status === 'error').length, rows };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/bib-assignments\/import$/, (c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      return idempotent(c, 'import', () => {
        const csv = String(c.body?.csv ?? '');
        if (c.body?.previewHash !== `ih_${state.bibVersion}_${csv.length}`) return { status: 409, json: { error: 'preview_stale' } };
        const lines = csv.split(/\r?\n/).filter(Boolean).slice(1);
        const bad = lines.some(ln => { const [id, bib] = ln.split(/[,;]/).map(x => x.trim()); const r = reg(id) ?? state.regs.find(x => x.code === id); return !r || r.status !== 'confirmed' || r.bib || state.regs.some(x => x.bib === (bib ?? '').toUpperCase()); });
        if (bad) return { status: 409, json: { error: 'import_has_errors', bad: 1, rows: [] } };
        lines.forEach(ln => { const [id, bib] = ln.split(/[,;]/).map(x => x.trim()); const r = (reg(id) ?? state.regs.find(x => x.code === id))!; r.bib = bib.toUpperCase(); });
        state.bibVersion += 1;
        return { status: 200, json: { imported: lines.length } };
      });
    }],
    // ── registrations summary and export (§4.5) ──
    ['GET', /^\/organizer\/events\/([^/]+)\/registrations\/summary$/, (_c, m) => (m[1] !== 'evt_pub' ? undefined : {
      byStatus: { reserved: state.regs.filter(r => r.status === 'reserved').length, confirmed: state.regs.filter(r => r.status === 'confirmed').length, cancelled: state.regs.filter(r => r.status === 'cancelled').length },
      byCategory: Object.entries(CAT).map(([categoryId, c]) => ({ categoryId, name: c.name, capacity: null, sold: state.regs.filter(r => r.cat === categoryId && r.status === 'confirmed').length, held: 0 })),
    })],
    ['GET', /^\/organizer\/events\/([^/]+)\/exports\/registrations\.csv$/, (c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      if (!c.headers?.authorization?.startsWith('Bearer ')) return { status: 401, json: { error: 'unauthenticated' } };
      state.exports += 1;
      if (state.exports > 5) return { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 1800 } };
      const cell = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const head = ['registrationId', 'ticketCode', 'firstName', 'lastName', 'categoryName', 'ticketTypeName', 'status', 'bibNumber', 'kitStatus', 'kitCollectedAt', 'kitSize', 'teamName', 'groupLabel', 'claimed'];
      const body = state.regs.filter(live).map(r => [r.id, r.code, r.status === 'cancelled' ? '' : r.first, r.status === 'cancelled' ? '' : r.last, CAT[r.cat].name, 'Standard', r.status, r.bib, r.kit, '', r.size, '', '', 'false'].map(cell).join(','));
      return { status: 200, body: `﻿${head.map(cell).join(',')}\n${body.join('\n')}\n`, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="arusha-trail-10k-participants-20270312.csv"', 'cache-control': 'no-store' } };
    }],
    // ── finance with the payout schedule (§3.1) ──
    ['GET', /^\/organizer\/events\/([^/]+)\/finance$/, (_c, m) => {
      if (!inRoles('owner', 'admin', 'finance')) return forbiddenRole();
      if (m[1] !== 'evt_pub') return noEvent();
      return { eventId: 'evt_pub', currency: 'TZS', asOf: '2027-03-12T08:00:00.000Z', paidTzs: 50000, refundedTzs: 0, refundPendingTzs: 0, awaitingPaymentTzs: 0, commissionPct: 5, commissionTzs: 2500, expectedNetTzs: 47500,
        orders: { paid: 1, refunded: 0, partlyRefunded: 0 }, byTicketType: [{ ticketTypeId: 'tt_1', name: 'Early bird', sold: 2, grossTzs: 50000 }], settlement: { state: 'not_live' }, payoutSchedule: state.payout.evt_pub };
    }],
    // ── payout schedule on the event document (§3.1) ──
    ['POST', /^\/admin\/events\/([^/]+)\/payout-schedule$/, (c, m) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'acl_forbidden' } };
      if (m[1] !== 'evt_pub') return { status: 404, json: { error: 'event_not_found' } };
      if (!['published', 'registration_closed', 'in_progress', 'completed'].includes(status)) return { status: 409, json: { error: 'invalid_transition' } };
      const b = c.body ?? {};
      if (!['biweekly', 'monthly'].includes(b.payoutSchedule)) return { status: 422, json: { error: 'event_invalid', fields: [{ path: 'payoutSchedule', code: 'invalid' }] } };
      const reason = String(b.reason ?? '').trim();
      if (reason.length < 10 || reason.length > 300) return { status: 422, json: { error: 'reason_required' } };
      const changed = state.payout.evt_pub !== b.payoutSchedule;
      state.payout.evt_pub = b.payoutSchedule;
      return { status: 200, json: { payoutSchedule: b.payoutSchedule, changed } };
    }],
    // ── API clients (§5.1) ──
    ['GET', /^\/organizer\/api-clients$/, () => {
      if (!options.ops.api) return { status: 404, json: { error: 'feature_disabled' } };
      if (!ownerAdmin()) return forbiddenRole();
      return { items: state.clients.map(c => ({ ...c })), max: 10, accessEnabled: o.apiAllowed !== false };
    }],
    ['POST', /^\/organizer\/api-clients$/, c => {
      if (!options.ops.api) return { status: 404, json: { error: 'feature_disabled' } };
      if (!ownerAdmin()) return forbiddenRole();
      if (suspended) return { status: 403, json: { error: 'organizer_suspended' } };
      if (o.apiAllowed === false) return { status: 403, json: { error: 'api_access_not_enabled' } };
      const b = c.body ?? {};
      const name = String(b.name ?? '').trim();
      if (!name || name.length > 60) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'name', code: 'invalid' }] } };
      if (!['live', 'sandbox'].includes(b.environment)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'environment', code: 'invalid' }] } };
      const SCOPES = ['registrations:read', 'registrations:demographics', 'kit:write', 'bibs:write', 'webhooks:manage'];
      const given: string[] = b.scopes ?? [];
      if (!given.length) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'scopes', code: 'required' }] } };
      if (given.includes('results:write')) return { status: 422, json: { error: 'scope_not_available' } };
      if (given.some(s => !SCOPES.includes(s))) return { status: 422, json: { error: 'invalid_scope' } };
      if (given.includes('webhooks:manage') && role !== 'owner') return { status: 403, json: { error: 'forbidden_role' } };
      if (given.includes('webhooks:manage') && b.environment === 'sandbox') return { status: 422, json: { error: 'invalid_scope' } }; // never on sandbox
      if (state.clients.filter(x => x.status === 'active').length >= 10) return { status: 409, json: { error: 'client_limit_reached' } };
      if (b.expiresInDays != null && (!Number.isInteger(b.expiresInDays) || b.expiresInDays < 1 || b.expiresInDays > 730)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'expiresInDays', code: 'invalid' }] } };
      if (b.environment === 'sandbox' && b.eventIds) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'eventIds', code: 'invalid' }] } };
      const secret = `ffs_${b.environment === 'live' ? 'live' : 'test'}_${rand(43)}`;
      state.secrets.push(secret);
      const client = { id: `apc_${state.clients.length + 1}`, clientId: `ffc_${rand(16).toLowerCase().replace(/[^0-9a-f]/g, 'a')}`, name, environment: b.environment, scopes: given, eventIds: b.environment === 'sandbox' ? ['evt_sandbox'] : (b.eventIds ?? null),
        status: 'active', expiresAt: new Date(Date.now() + (b.expiresInDays ?? 365) * 86_400_000).toISOString(), lastUsedAt: null, createdAt: '2027-03-12T08:00:00.000Z', createdBy: { name: user.displayName ?? 'Owner' }, rateLimitPerMinute: 120, rotation: { inGrace: false, graceEndsAt: null }, secretVersion: 1 };
      state.clients.push(client);
      return { status: 201, json: { client, clientSecret: secret } };
    }],
    ['GET', /^\/organizer\/api-clients\/([^/]+)$/, (_c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      const cl = state.clients.find(x => x.id === m[1]);
      if (!cl) return { status: 404, json: { error: 'client_not_found' } };
      return { client: cl, usage: { days: [{ day: '2027-03-10', requests: 40, errors: 2, rateLimited: 0 }, { day: '2027-03-11', requests: 80, errors: 0, rateLimited: 1 }] }, history: [{ at: '2027-03-10T08:00:00.000Z', action: 'created' }] };
    }],
    ['POST', /^\/organizer\/api-clients\/([^/]+)\/rotate$/, (c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      const cl = state.clients.find(x => x.id === m[1]);
      if (!cl) return { status: 404, json: { error: 'client_not_found' } };
      if (cl.status !== 'active') return { status: 409, json: { error: 'client_not_active' } };
      if (![0, 24, 72].includes(c.body?.graceHours)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'graceHours', code: 'invalid' }] } };
      const secret = `ffs_${cl.environment === 'live' ? 'live' : 'test'}_${rand(43)}x`;
      state.secrets.push(secret);
      cl.secretVersion += 1;
      cl.rotation = c.body.graceHours ? { inGrace: true, graceEndsAt: new Date(Date.now() + c.body.graceHours * 3_600_000).toISOString() } : { inGrace: false, graceEndsAt: null };
      return { status: 200, json: { client: cl, clientSecret: secret } };
    }],
    ['POST', /^\/organizer\/api-clients\/([^/]+)\/revoke$/, (_c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      const cl = state.clients.find(x => x.id === m[1]);
      if (!cl) return { status: 404, json: { error: 'client_not_found' } };
      const changed = cl.status !== 'revoked';
      cl.status = 'revoked';
      return { status: 200, json: { client: cl, changed } };
    }],
    // ── webhooks (§7) ──
    ['GET', /^\/organizer\/integrations\/health$/, () => {
      if (!ownerAdmin()) return forbiddenRole();
      if (!options.ops.api && !options.ops.webhooks) return { status: 404, json: { error: 'feature_disabled' } };
      const e = state.endpoints;
      return {
        webhooks: options.ops.webhooks ? { endpoints: e.length, healthy: e.filter(x => x.health === 'healthy').length, degraded: e.filter(x => x.health === 'degraded').length, failing: e.filter(x => x.health === 'failing').length, disabled: e.filter(x => x.health === 'disabled').length, unverified: e.filter(x => x.health === 'unverified').length, deadLast24h: state.deliveries.filter(d => d.status === 'dead').length } : null,
        apiClients: options.ops.api ? { active: state.clients.filter(x => x.status === 'active').length, expiringSoon: 0 } : null,
      };
    }],
    ['GET', /^\/organizer\/webhook-endpoints$/, () => {
      if (!options.ops.webhooks) return { status: 404, json: { error: 'feature_disabled' } };
      if (!ownerAdmin()) return forbiddenRole();
      return { items: state.endpoints, max: 5, types: [], available: true };
    }],
    ['POST', /^\/organizer\/webhook-endpoints$/, c => {
      if (!options.ops.webhooks) return { status: 404, json: { error: 'feature_disabled' } };
      if (!ownerAdmin()) return forbiddenRole();
      const b = c.body ?? {};
      const reason = urlReason(String(b.url ?? ''));
      if (reason) return { status: 400, json: { error: 'invalid_url', reason } };
      const TYPES = ['registration.created', 'registration.paid', 'registration.cancelled', 'registration.updated', 'kit.collected', 'bib.assigned', 'event.updated', 'event.cancelled', 'refund.updated'];
      const events: string[] = b.events ?? [];
      if (events.some(e => !TYPES.includes(e))) return { status: 422, json: { error: 'invalid_event_type' } };
      if (!events.length) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'events', code: 'required' }] } };
      if (state.endpoints.filter(x => x.status === 'active').length >= 5) return { status: 409, json: { error: 'endpoint_limit_reached' } };
      const host = new URL(b.url).hostname;
      const secret = `whsec_${rand(43)}`;
      state.secrets.push(secret);
      // §7.2: the endpoint starts UNVERIFIED and receives only the challenge until POST …/verify succeeds.
      const ep = { id: `whk_${state.endpoints.length + 1}`, url: b.url, host, events, eventIds: null, description: b.description ?? null, status: 'active', verifiedAt: null, lastSuccessAt: null, secretHint: `whsec_…${secret.slice(-4)}`,
        rotation: { inGrace: false, graceEndsAt: null }, last24h: { delivered: 0, failed: 0, dead: 0 }, pending: 0, consecutiveFailures: 0, health: 'unverified', disabledReason: null, disabledAt: null };
      state.endpoints.push(ep);
      return { status: 201, json: { endpoint: ep, signingSecret: secret } };
    }],
    ['GET', /^\/organizer\/webhook-endpoints\/([^/]+)$/, (_c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      const ep = state.endpoints.find(x => x.id === m[1]);
      if (!ep) return { status: 404, json: { error: 'endpoint_not_found' } };
      return { endpoint: ep, attempts: [{ attemptNo: 1, trigger: 'verify', startedAt: '2027-03-12T08:00:00.000Z', durationMs: 90, outcome: ep.verifiedAt ? 'success' : 'timeout', responseCode: ep.verifiedAt ? 200 : null, errorCode: null, responseSnippet: null, nextAttemptAt: null }] };
    }],
    ['POST', /^\/organizer\/webhook-endpoints\/([^/]+)\/(verify|test|disable|enable|rotate-secret)$/, (c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      const ep = state.endpoints.find(x => x.id === m[1]);
      if (!ep) return { status: 404, json: { error: 'endpoint_not_found' } };
      const host = new URL(ep.url).hostname;
      const good = !/^unverifiable\./.test(host);
      if (m[2] === 'verify') {
        if (!good) return { status: 200, json: { ok: false, host, reason: 'timeout' } };
        ep.verifiedAt = '2027-03-12T08:30:00.000Z'; if (ep.status === 'active') ep.health = 'healthy';
        return { status: 200, json: { ok: true, host } };
      }
      if (m[2] === 'test') {
        if (ep.status !== 'active' || !ep.verifiedAt) return { status: 409, json: { error: 'verification_failed' } };
        return /^slow\./.test(host) ? { status: 200, json: { ok: false, outcome: 'timeout', responseCode: null, durationMs: 10000, errorCode: 'timeout', snippet: null } } : { status: 200, json: { ok: true, outcome: 'success', responseCode: 200, durationMs: 80, errorCode: null, snippet: null } };
      }
      if (m[2] === 'disable') { const changed = ep.status !== 'disabled'; ep.status = 'disabled'; ep.health = 'disabled'; return { status: 200, json: { endpoint: ep, changed } }; }
      if (m[2] === 'enable') {
        // §7.4: enabling needs the handshake to succeed first.
        if (!good) return { status: 409, json: { error: 'verification_failed', reason: 'timeout' } };
        ep.status = 'active'; ep.disabledReason = null; ep.disabledAt = null; ep.verifiedAt = '2027-03-12T08:30:00.000Z'; ep.health = 'healthy';
        return { status: 200, json: { endpoint: ep, changed: true, requeued: 0 } };
      }
      if (![0, 24, 72].includes(c.body?.graceHours)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'graceHours', code: 'invalid' }] } };
      const secret = `whsec_${rand(43)}y`;
      state.secrets.push(secret);
      ep.rotation = c.body.graceHours ? { inGrace: true, graceEndsAt: new Date(Date.now() + c.body.graceHours * 3_600_000).toISOString() } : { inGrace: false, graceEndsAt: null };
      return { status: 200, json: { endpoint: ep, signingSecret: secret } };
    }],
    ['GET', /^\/organizer\/webhook-deliveries$/, c => {
      if (!ownerAdmin()) return forbiddenRole();
      // `eventId` filters by the organizer's EVENT; the row's own message id is `outboxEventId`.
      const items = state.deliveries.filter(d => (!c.query.endpointId || d.endpointId === c.query.endpointId) && (!c.query.status || d.status === c.query.status) && (!c.query.eventId || d.forEventId === c.query.eventId));
      return { items: items.map(({ attempts: _a, payload: _p, forEventId: _f, manualRetryCount: _m, ...row }) => row), nextCursor: null };
    }],
    ['GET', /^\/organizer\/webhook-deliveries\/([^/]+)$/, (_c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      const d = state.deliveries.find(x => x.id === m[1]);
      if (!d) return { status: 404, json: { error: 'delivery_not_found' } };
      const { attempts, payload, forEventId: _f, manualRetryCount, ...delivery } = d;
      return { delivery, attempts, payload, manualRetriesLeft: Math.max(0, 5 - manualRetryCount) };
    }],
    ['POST', /^\/organizer\/webhook-deliveries\/([^/]+)\/retry$/, (_c, m) => {
      if (!ownerAdmin()) return forbiddenRole();
      const d = state.deliveries.find(x => x.id === m[1]);
      if (!d) return { status: 404, json: { error: 'delivery_not_found' } };
      if (d.status === 'delivered') return { status: 409, json: { error: 'already_delivered' } };
      if (d.manualRetryCount >= 5) return { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 3600 } };
      if (d.status === 'pending') return { status: 200, json: { alreadyQueued: true } };
      d.status = 'pending'; d.manualRetryCount += 1; d.nextAttemptAt = '2027-03-12T09:01:00.000Z';
      return { status: 200, json: { alreadyQueued: false } };
    }],
  ];
  return { routes, options, state, doc };
}
