// Events S7 mock (spec docs/design/events-s7-hardening-and-pilot.md §3 to §6, §8): offline kit desk, waitlist (organizer + admin), the admin Health,
// Operations and Disputes tabs, per-race settings, correction preview, medal take-down and the payments banner. The backend for S7 is built in
// parallel, so this mock is written from the SPEC and is STRICT about it (missing Idempotency-Key, wrong role, overlapping bib blocks, device limits,
// the sync outcome rules, the typed reasons), so a portal that guesses a shape fails the spec instead of passing a lenient mock.
// Nothing here is the real backend: shape differences are listed in the PR.
import { createHash } from 'node:crypto';
import type { Json } from './events-mock';
import { TICKET } from './events-s5-mock';

export type S7Opts = {
  /** `ops.kitOffline`. Default true. */ kitOffline?: boolean;
  /** `waitlist.enabled`. Default true. */ waitlist?: boolean;
  /** `analytics.enabled`. Default true. */ analytics?: boolean;
  /** `payments.blockedReason`. Default null. */ paymentsBlocked?: null | 'second_approver_off' | 'no_ticket_secret' | 'flag_off';
  /** Active desks per event before 409 device_limit_reached (spec: 10). */ maxDevices?: number;
  /** Rows above which the snapshot answers 413 snapshot_too_large. */ maxRows?: number;
  /** Start the clock-skew trap: the server time given to the desk is this many ms away from the browser's. */ serverSkewMs?: number;
  /** `waitlistEnabled` of the event at the start. */ waitlistEnabled?: boolean;
  /** Medal 1 starts taken down. */ takedown?: boolean;
  /** Per-race results settings already official-released. */ officialRelease?: boolean;
  /** Fail health groups by name. */ healthFail?: string[];
};
type Reply = Json | { status: number; json: Json } | { status: 204 };
type Call = { method: string; path: string; query: Record<string, string>; body: Json | null; headers?: Record<string, string> };
type Handler = (c: Call, m: RegExpMatchArray) => Reply | undefined;

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const tokenOf = (qr: string) => (qr.startsWith('FFEV1:') ? qr.slice(6) : qr);
export const TK = {
  valid: TICKET.valid, // Amina M., no bib
  collected: TICKET.collected, // Baraka M., bib 1002, already collected
  revoked: TICKET.revoked, // Chausiku J., cancelled + refunded
  noBib: TICKET.noBib, // Daudi K., no bib
  withBib: 'FFEV1:ev1.k1.tkt_hamisi.1.gggggggggggggggg', // Hamisi A., bib A0007 pre-assigned
  late: 'FFEV1:ev1.k1.tkt_late.1.hhhhhhhhhhhhhhhh', // bought after the list was taken: not on it
  garbled: 'FFEV1:ev1.k1.tkt_nope.1.zzzzzzzzzzzzzzzz',
  other: TICKET.other,
};
export const GYM = 'usr_member1.9876543.sigsigsig';

type Reg = { id: string; name: string; cat: string; ticket: string | null; code: string; status: 'confirmed' | 'cancelled'; bib: string | null; size: string | null; revoked?: string; collectedAt?: string; collectedBy?: string };
type Desk = { id: string; label: string; status: 'active' | 'revoked' | 'expired'; staffUserId: string; staffFirstName: string; issuedAt: string; expiresAt: string; revokedAt?: string; bibRange: Json | null; pending: number; discarded: number; lastSyncAt: string | null; lastHeartbeatAt: string | null; snapshotRows: number; snapshotSeq: number; deskBuild: string | null; bibsRecorded: number; bibExceptions: number };
type Scan = { id: string; deviceId: string; clientRef: string; outcome: string; replayed?: boolean; regId?: string; reviewStatus: 'none' | 'needs_review' | 'checked'; method: string; bib?: { outcome: string; claimed?: string; number?: string }; claimedAt: string; receivedAt: string; note?: string; winnerDesk?: string };

export function makeS7(user: Json, me: Json | null, o: S7Opts) {
  const role: string = me?.role ?? (user.userType === 'event_organizer' ? 'owner' : 'ops');
  const suspended = (me?.organizer?.status ?? 'active') === 'suspended';
  const isAdmin = user.userType === 'admin';
  const scopes: string[] | null = user.portalUser ? (user.aclPermissions ?? []) : null;
  const hasScope = (s: string) => isAdmin && (scopes === null || scopes.includes(s));
  const KEY = /^.{8,100}$/;
  const forbidden = () => ({ status: 403, json: { error: 'forbidden_role' } });
  const off = () => ({ status: 404, json: { error: 'feature_disabled' } });
  const inRoles = (...r: string[]) => r.includes(role);
  const ownerAdmin = () => inRoles('owner', 'admin');
  const kitOfflineOn = () => o.kitOffline !== false;
  const waitlistOn = () => o.waitlist !== false;
  const analyticsOn = () => o.analytics !== false;

  const state = {
    regs: [
      { id: 'reg_1', name: 'Amina M.', cat: 'cat_1', ticket: TK.valid, code: 'AMN-1001', status: 'confirmed', bib: null, size: 'M' },
      { id: 'reg_2', name: 'Baraka M.', cat: 'cat_1', ticket: TK.collected, code: 'BRK-1002', status: 'confirmed', bib: '1002', size: 'L', collectedAt: '2027-03-12T08:00:00.000Z', collectedBy: 'Gate 1' },
      { id: 'reg_3', name: 'Chausiku J.', cat: 'cat_2', ticket: TK.revoked, code: 'CHS-1003', status: 'cancelled', bib: null, size: null, revoked: 'refunded' },
      { id: 'reg_5', name: 'Daudi K.', cat: 'cat_2', ticket: TK.noBib, code: 'DAU-1005', status: 'confirmed', bib: null, size: null },
      { id: 'reg_7', name: 'Hamisi A.', cat: 'cat_2', ticket: TK.withBib, code: 'HAM-1007', status: 'confirmed', bib: 'A0007', size: 'S' },
    ] as Reg[],
    /** Set true to put the late-bought ticket on the next snapshot/delta. */ lateIncluded: false,
    lateReg: { id: 'reg_9', name: 'Zuri L.', cat: 'cat_1', ticket: TK.late, code: 'ZUR-1009', status: 'confirmed', bib: null, size: null } as Reg,
    devices: [] as Desk[],
    scans: [] as Scan[],
    idem: {} as Record<string, { body: string; reply: Json }>,
    seq: 10,
    heartbeats: [] as Json[],
    syncs: [] as Json[],
    collectionsMade: [] as Json[],
    outbox: [] as Json[],
    revokedBlocks: [] as Json[],
    // waitlist
    waitlistEnabled: o.waitlistEnabled !== false, waitlistClosed: false,
    waitlistEntries: [
      { id: 'wle_1', name: 'Neema S.', seq: 1, status: 'waiting', joinedAt: '2027-02-01T08:00:00.000Z', ticketTypeId: 'tt_1', ticketTypeName: 'Standard' },
      { id: 'wle_2', name: 'Juma K.', seq: 2, status: 'waiting', joinedAt: '2027-02-01T09:00:00.000Z', ticketTypeId: 'tt_1', ticketTypeName: 'Standard' },
      { id: 'wle_3', name: 'Asha B.', seq: 3, status: 'offered', joinedAt: '2027-02-01T09:30:00.000Z', ticketTypeId: 'tt_1', ticketTypeName: 'Standard' },
    ] as Json[],
    waitlistCalls: [] as Json[],
    // admin ops
    paused: false, rewardsEligible: false, orgs: [] as Json[], clients: [] as Json[], opLog: [] as Json[],
    disputes: [] as Json[], redemptions: [] as Json[],
    // results
    resultSettings: { timeBasis: 'net', cutoffMinutes: null, disputeWindowHours: 168, publicNames: 'initial' } as Json,
    perRace: {} as Record<string, Json>,
    settingsCalls: [] as Json[],
    previews: [] as Json[],
    takedown: o.takedown === true,
    resultRevision: 1,
  };
  state.orgs.push(
    { id: 'org_1', name: 'Dar Runners', status: 'active', apiAccessEnabled: true, activeClients: 2, activeEndpoints: 1, lastFailureAt: '2027-03-01T08:00:00.000Z' },
    { id: 'org_2', name: 'Arusha Trail Club', status: 'suspended', apiAccessEnabled: false, activeClients: 0, activeEndpoints: 0, lastFailureAt: null },
  );
  state.clients.push({ id: 'cli_1', organizerId: 'org_1', name: 'Timing feed', ratePerMinute: 60, status: 'active' }, { id: 'cli_2', organizerId: 'org_1', name: 'Roster sync', ratePerMinute: 30, status: 'active' });
  state.disputes.push(
    { id: 'dsp_1', eventId: 'evt_pub', eventTitle: 'Arusha Trail 10K', organizerName: 'Dar Runners', openedAt: '2027-03-01T08:00:00.000Z', ageDays: 9, status: 'open', adminMayResolve: true, organizerStatus: 'active' },
    { id: 'dsp_2', eventId: 'evt_pub', eventTitle: 'Arusha Trail 10K', organizerName: 'Dar Runners', openedAt: '2027-03-08T08:00:00.000Z', ageDays: 2, status: 'open', adminMayResolve: false, organizerStatus: 'active' },
    { id: 'dsp_3', eventId: 'evt_1', eventTitle: 'Moshi Fun Run', organizerName: 'Arusha Trail Club', openedAt: '2027-03-09T08:00:00.000Z', ageDays: 1, status: 'open', adminMayResolve: true, organizerStatus: 'suspended' },
  );
  state.redemptions.push(
    { id: 'red_1', rewardTitle: { en: 'Finisher perk', sw: 'Faida ya aliyemaliza' }, person: 'Baraka M.', status: 'redeemed', claimedAt: '2027-03-12T08:00:00.000Z', redeemedAt: '2027-03-12T10:00:00.000Z' },
    { id: 'red_2', rewardTitle: { en: 'Finisher certificate', sw: 'Cheti cha aliyemaliza' }, person: 'Amina M.', status: 'claimed', claimedAt: '2027-03-12T09:00:00.000Z', redeemedAt: null },
  );

  const all = () => [...state.regs, ...(state.lateIncluded ? [state.lateReg] : [])];
  const regOf = (id: string) => all().find(r => r.id === id);
  const byHash = (h: string) => all().find(r => r.ticket && sha(tokenOf(r.ticket)) === h);
  const byToken = (tok: string) => all().find(r => r.ticket && tokenOf(r.ticket) === tok);
  const nowIso = () => new Date().toISOString();
  const serverNow = () => new Date(Date.now() + (o.serverSkewMs ?? 0));
  const idem = (c: Call, route: string, work: () => { status: number; json: Json }) => {
    const key = c.headers?.['idempotency-key'];
    if (!key || !KEY.test(key)) return { status: 400, json: { error: 'idempotency_key_required' } };
    if (c.body && ('userId' in c.body || 'ownerId' in c.body || 'staffUserId' in c.body)) return { status: 400, json: { error: 'invalid_body' } };
    const k = `${user.id}|${route}|${key}`;
    const fp = JSON.stringify(c.body ?? {});
    const seen = state.idem[k];
    if (seen) return seen.body === fp ? { status: 200, json: seen.reply } : { status: 409, json: { error: 'idempotency_key_reused' } };
    const out = work();
    if (out.status < 300) state.idem[k] = { body: fp, reply: out.json };
    return out;
  };

  const rowOf = (r: Reg) => ({
    registrationId: r.id, tokenHash: sha(tokenOf(r.ticket!)), ticketCode: r.code, name: r.name, categoryId: r.cat, bibNumber: r.bib,
    ticket: r.status === 'confirmed' ? 'active' : 'revoked', ...(r.revoked ? { revokeReason: r.revoked } : {}),
    kit: r.collectedAt ? 'collected' : 'not_collected', ...(r.collectedAt ? { collectedAt: r.collectedAt, collectionPointName: r.collectedBy ?? 'Expo Hall' } : {}), kitSize: r.size,
  });
  const blockNumbers = (b: Json) => ({ start: Number(b.start), end: Number(b.end) });
  const sameFamily = (a: Json, b: Json) => (a.prefix ?? '') === (b.prefix ?? '') && Number(a.padTo ?? 0) === Number(b.padTo ?? 0);
  const inBlock = (b: Json | null, bib: string) => {
    if (!b) return false;
    const prefix = b.prefix ?? '';
    if (!bib.startsWith(prefix)) return false;
    const d = bib.slice(prefix.length);
    if (!/^\d+$/.test(d)) return false;
    const n = Number(d);
    const pad = Number(b.padTo ?? 0);
    return n >= b.start && n <= b.end && (pad ? d === String(n).padStart(pad, '0') : d === String(n));
  };
  const deviceView = (d: Desk) => ({ id: d.id, label: d.label, status: d.status, issuedAt: d.issuedAt, expiresAt: d.expiresAt, bibRange: d.bibRange });
  const desks = (c: Call) => state.devices.filter(d => ownerAdmin() || isAdmin || d.staffUserId === user.id);
  void blockNumbers;

  const reviewCounts = () => ({ needsReview: state.scans.filter(s => s.reviewStatus === 'needs_review').length, checked: state.scans.filter(s => s.reviewStatus === 'checked').length });
  const cardOf = (r?: Reg) => (r ? { displayName: r.name, categoryName: r.cat === 'cat_1' ? '21K Half Marathon' : '10K', bibNumber: r.bib, ticketCode: r.code } : null);

  function applyBib(dev: Desk, reg: Reg, claim: string | undefined, accepted: boolean): { outcome: string; number?: string } | undefined {
    if (!claim) return undefined;
    const bib = claim.trim().toUpperCase();
    if (!accepted) return { outcome: 'not_applied' };
    if (!/^[A-Z0-9-]{1,12}$/.test(bib)) return { outcome: 'format_invalid' };
    if (!dev.bibRange) return { outcome: 'no_range' };
    if (!inBlock(dev.bibRange, bib)) return { outcome: 'out_of_range' };
    if (reg.bib) return reg.bib === bib ? { outcome: 'same_already', number: bib } : { outcome: 'registration_has_other', number: reg.bib };
    if (all().some(x => x.bib === bib && x.id !== reg.id)) return { outcome: 'taken', number: bib };
    reg.bib = bib; dev.bibsRecorded += 1;
    state.outbox.push({ type: 'bib.assigned', registrationId: reg.id, bib });
    return { outcome: 'assigned', number: bib };
  }

  const routes: Array<[string, RegExp, Handler]> = [
    // ═══ Offline kit desk (§3.13) ═══
    ['POST', /^\/organizer\/events\/([^/]+)\/kit-offline\/devices$/, (c, m) => {
      if (!kitOfflineOn()) return off();
      if (!inRoles('owner', 'admin', 'ops')) return forbidden();
      if (m[1] !== 'evt_pub') return { status: 404, json: { error: 'event_not_found' } };
      if (suspended) return { status: 403, json: { error: 'organizer_suspended' } };
      return idem(c, 'prepare', () => {
        const b = c.body ?? {};
        if (typeof b.label !== 'string' || b.label.trim().length < 1 || b.label.length > 40) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'label', code: 'invalid' }] } };
        if (b.clientKind !== 'web' || typeof b.deskBuild !== 'string') return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'deskBuild', code: 'required' }] } };
        const active = state.devices.filter(d => d.status === 'active');
        if (active.length >= (o.maxDevices ?? 10) || active.filter(d => d.staffUserId === user.id).length >= 2) return { status: 409, json: { error: 'device_limit_reached', max: o.maxDevices ?? 10 } };
        let range: Json | null = null;
        if (b.bibRange) {
          if (!ownerAdmin()) return forbidden();
          const r = b.bibRange;
          if (!Number.isInteger(r.start) || !Number.isInteger(r.end) || r.end < r.start || r.end - r.start + 1 > 5000 || !/^[A-Z0-9-]{0,4}$/.test(r.prefix ?? '') || (r.padTo ?? 0) < 0 || (r.padTo ?? 0) > 6) return { status: 422, json: { error: 'bib_range_invalid' } };
          range = { prefix: r.prefix ?? '', padTo: r.padTo ?? 0, start: r.start, end: r.end };
          // Overlap includes blocks of removed and expired desks (their unsent scans may still carry those numbers).
          const clash = state.devices.find(d => d.bibRange && sameFamily(d.bibRange, range!) && d.bibRange.start <= range!.end && range!.start <= d.bibRange.end);
          if (clash) return { status: 409, json: { error: 'bib_range_overlap', with: clash.label } };
        }
        const dev: Desk = {
          id: `dev_${state.devices.length + 1}`, label: b.label.trim(), status: 'active', staffUserId: user.id, staffFirstName: String(user.displayName ?? 'Staff').split(' ')[0], issuedAt: nowIso(),
          expiresAt: new Date(Date.now() + 36 * 3600_000).toISOString(), bibRange: range, pending: 0, discarded: 0, lastSyncAt: null, lastHeartbeatAt: null, snapshotRows: 0, snapshotSeq: state.seq, deskBuild: b.deskBuild,
          bibsRecorded: 0, bibExceptions: 0,
        };
        state.devices.push(dev);
        return { status: 201, json: { device: deviceView(dev), limits: { sessionHours: 36, maxPending: 2000, clockToleranceSeconds: 300, syncBatch: 200 }, serverTime: serverNow().toISOString() } };
      });
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/kit-offline\/devices$/, (c, m) => {
      if (!kitOfflineOn()) return off();
      if (!inRoles('owner', 'admin', 'ops')) return forbidden();
      if (m[1] !== 'evt_pub') return { status: 404, json: { error: 'event_not_found' } };
      const own = ownerAdmin();
      return { items: desks(c).filter(d => !c.query.status || d.status === c.query.status).map(d => ({
        id: d.id, label: d.label, status: d.status, staffFirstName: d.staffFirstName, issuedAt: d.issuedAt, expiresAt: d.expiresAt, lastSyncAt: d.lastSyncAt, lastHeartbeatAt: d.lastHeartbeatAt,
        pendingReported: d.pending, discardedReported: d.discarded, snapshotRows: d.snapshotRows, snapshotSeq: d.snapshotSeq, deskBuild: d.deskBuild,
        ...(own ? { bibRange: d.bibRange, bibsRecorded: d.bibsRecorded, bibExceptions: d.bibExceptions } : {}),
      })) };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/kit-offline\/devices\/([^/]+)\/revoke$/, (c, m) => {
      if (!kitOfflineOn()) return off();
      if (!ownerAdmin()) return forbidden();
      return idem(c, `revoke:${m[2]}`, () => {
        const d = state.devices.find(x => x.id === m[2]);
        if (!d) return { status: 404, json: { error: 'device_not_found' } };
        if (d.status !== 'active') return { status: 409, json: { error: 'already_ended' } };
        if (typeof c.body?.reason !== 'string' || c.body.reason.trim().length < 10 || c.body.reason.length > 300) return { status: 422, json: { error: 'reason_required' } };
        d.status = 'revoked'; d.revokedAt = nowIso();
        state.opLog.push({ type: 'desk_revoked', id: d.id, reason: c.body.reason, reasonSw: c.body.reasonSw ?? null });
        return { status: 200, json: { device: deviceView(d) } };
      });
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/kit-offline\/snapshot$/, (c, m) => {
      if (!kitOfflineOn()) return off();
      if (!inRoles('owner', 'admin', 'ops')) return forbidden();
      const d = state.devices.find(x => x.id === c.query.deviceId);
      if (!d || d.status !== 'active') return { status: 403, json: { error: 'device_not_active' } };
      const rows = all().filter(r => r.ticket && r.id !== state.lateReg.id).concat(state.lateIncluded ? [state.lateReg] : []).filter((r, i, a) => a.indexOf(r) === i);
      const filtered = rows.filter(r => !c.query.categoryId || r.cat === c.query.categoryId);
      if (!c.query.sinceSeq && filtered.length > (o.maxRows ?? 20000)) return { status: 413, json: { error: 'snapshot_too_large', rows: filtered.length, max: o.maxRows ?? 20000 } };
      d.snapshotRows = filtered.length; d.snapshotSeq = state.seq;
      return {
        header: { snapshotSeq: state.seq, takenAt: nowIso(), serverTime: serverNow().toISOString(), validUntil: new Date(Date.now() + 36 * 3600_000).toISOString(), event: { status: 'published', timezone: 'Africa/Dar_es_Salaam', kitProvided: true },
          collectionPoints: [{ id: 'cp_1', name: 'Expo Hall' }, { id: 'cp_2', name: 'Mall Desk' }], categories: [{ id: 'cat_1', name: '21K Half Marathon' }, { id: 'cat_2', name: '10K' }], rowCount: filtered.length },
        rows: filtered.map(rowOf), removed: [], nextCursor: null,
      };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/kit-offline\/heartbeat$/, (c) => {
      if (!kitOfflineOn()) return off();
      if (!inRoles('owner', 'admin', 'ops')) return forbidden();
      const b = c.body ?? {};
      const d = state.devices.find(x => x.id === b.deviceId);
      if (!d) return { status: 404, json: { error: 'device_not_found' } };
      d.pending = Number(b.pending ?? 0); d.discarded = Number(b.discarded ?? 0); d.lastHeartbeatAt = nowIso(); d.deskBuild = b.deskBuild ?? d.deskBuild;
      state.heartbeats.push(b);
      return { serverTime: serverNow().toISOString(), deviceStatus: d.status, minDeskBuild: '1' };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/kit-offline\/sync$/, (c) => {
      if (!kitOfflineOn()) return off();
      if (!inRoles('owner', 'admin', 'ops')) return forbidden();
      const key = c.headers?.['idempotency-key'];
      if (!key || !KEY.test(key)) return { status: 400, json: { error: 'idempotency_key_required' } };
      const b = c.body ?? {};
      const d = state.devices.find(x => x.id === b.deviceId);
      if (!d) return { status: 404, json: { error: 'device_not_found' } };
      if (!Array.isArray(b.items) || !b.batchId) return { status: 400, json: { error: 'invalid_batch' } };
      if (b.items.length > 200) return { status: 413, json: { error: 'too_many_items' } };
      state.syncs.push(b);
      const results: Json[] = [];
      const summary = { accepted: 0, duplicate: 0, needsReview: 0, bibExceptions: 0, rejected: 0, deferred: 0 };
      for (const it of b.items as Json[]) {
        const seen = state.scans.find(s => s.deviceId === d.id && s.clientRef === it.clientRef);
        if (seen) { results.push({ clientRef: it.clientRef, outcome: seen.outcome, replayed: true, registrationId: seen.regId, ...(seen.bib ? { bib: seen.bib } : {}) }); continue; }
        const scan: Scan = { id: `scn_${state.scans.length + 1}`, deviceId: d.id, clientRef: it.clientRef, outcome: 'accepted', reviewStatus: 'none', method: it.method, claimedAt: it.claimedAt, receivedAt: nowIso() };
        let reg: Reg | undefined;
        if (it.method === 'scan') {
          const p = String(it.payload ?? '');
          const tok = p.startsWith('FFEV1:') ? p.slice(6) : p;
          if (!/^ev1\./.test(tok) || /zzzz/.test(tok)) scan.outcome = 'invalid_token';
          else { reg = byToken(tok); if (!reg) scan.outcome = tok.includes('tkt_otherevent') ? 'wrong_event' : 'unknown_ticket'; }
        } else {
          reg = regOf(String(it.registrationId ?? ''));
          if (!reg || !['phone_lost', 'no_signal', 'screen_damaged', 'other'].includes(it.manualReason)) { scan.outcome = 'validation_failed'; reg = undefined; }
        }
        if (scan.outcome === 'accepted' && reg) {
          scan.regId = reg.id;
          if (d.status === 'revoked' && d.revokedAt && Date.parse(it.claimedAt) > Date.parse(d.revokedAt)) { scan.outcome = 'after_revoke'; scan.reviewStatus = 'needs_review'; }
          else if (suspended) { scan.outcome = 'organizer_suspended'; scan.reviewStatus = 'needs_review'; }
          else if (reg.status !== 'confirmed') { scan.outcome = 'revoked_after_scan'; scan.reviewStatus = 'needs_review'; }
          else if (reg.collectedAt) { scan.outcome = 'duplicate'; scan.reviewStatus = 'needs_review'; scan.winnerDesk = reg.collectedBy; }
          else { reg.collectedAt = it.claimedAt; reg.collectedBy = d.label; state.collectionsMade.push({ registrationId: reg.id, method: 'offline', deviceId: d.id, clientRef: it.clientRef }); state.outbox.push({ type: 'kit.collected', registrationId: reg.id }); }
        }
        if (it.bibNumber) {
          const bib = applyBib(d, reg ?? ({ id: 'none', bib: null } as Reg), String(it.bibNumber), scan.outcome === 'accepted' && !!reg);
          if (bib) {
            scan.bib = { ...bib, claimed: String(it.bibNumber).toUpperCase() };
            if (scan.outcome === 'accepted' && !['assigned', 'same_already'].includes(bib.outcome)) { scan.reviewStatus = 'needs_review'; d.bibExceptions += 1; }
          }
        }
        state.scans.push(scan);
        if (scan.outcome === 'accepted') summary.accepted += 1; else if (scan.outcome === 'duplicate') summary.duplicate += 1; else if (['invalid_token', 'unknown_ticket', 'wrong_event', 'validation_failed'].includes(scan.outcome)) summary.rejected += 1;
        if (scan.reviewStatus === 'needs_review') summary.needsReview += 1;
        if (scan.bib && scan.reviewStatus === 'needs_review' && scan.outcome === 'accepted') summary.bibExceptions += 1;
        results.push({ clientRef: it.clientRef, outcome: scan.outcome, registrationId: scan.regId, ...(scan.bib ? { bib: scan.bib } : {}), warnings: [] });
      }
      d.lastSyncAt = nowIso();
      state.seq += 1;
      return { status: 200, json: { results, summary, serverTime: serverNow().toISOString(), deviceStatus: d.status, minDeskBuild: '1' } };
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/kit-offline\/review$/, (c) => {
      if (!kitOfflineOn()) return off();
      if (!ownerAdmin()) return forbidden();
      const status = c.query.status ?? 'needs_review';
      const pick = state.scans.filter(s => status === 'manual' ? s.method === 'manual' && s.outcome === 'accepted' : s.reviewStatus === status);
      return {
        items: pick.map(s => {
          const dev = state.devices.find(x => x.id === s.deviceId);
          const r = s.regId ? regOf(s.regId) : undefined;
          return { id: s.id, outcome: s.outcome, card: cardOf(r), deviceLabel: dev?.label ?? null, deviceTime: s.claimedAt, receivedAt: s.receivedAt, reviewStatus: s.reviewStatus, note: s.note ?? null, method: s.method, warnings: [],
            ...(s.winnerDesk ? { winner: { collectedAt: r?.collectedAt, deviceLabel: s.winnerDesk, method: 'offline' } } : {}),
            ...(s.bib && !['assigned', 'same_already'].includes(s.bib.outcome) ? { bibOutcome: s.bib.outcome, bibClaimed: s.bib.claimed } : {}) };
        }), nextCursor: null, counts: reviewCounts(),
      };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/kit-offline\/review\/([^/]+)\/check$/, (c, m) => {
      if (!kitOfflineOn()) return off();
      if (!ownerAdmin()) return forbidden();
      return idem(c, `check:${m[2]}`, () => {
        const s = state.scans.find(x => x.id === m[2]);
        if (!s) return { status: 404, json: { error: 'not_found' } };
        if (s.reviewStatus !== 'needs_review') return { status: 409, json: { error: 'not_in_review' } };
        const note = String(c.body?.note ?? '').trim();
        if (s.outcome === 'revoked_after_scan' && (note.length < 10 || note.length > 300)) return { status: 422, json: { error: 'note_required' } };
        s.reviewStatus = 'checked'; s.note = note || undefined;
        return { status: 200, json: { review: { id: s.id, reviewStatus: 'checked', note: s.note ?? null } } };
      });
    }],
    // FitFlex admin (scope events)
    ['GET', /^\/admin\/events\/([^/]+)\/kit-offline$/, () => {
      if (!kitOfflineOn()) return off();
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return { items: state.devices.map(d => ({ id: d.id, label: d.label, status: d.status, staffFirstName: d.staffFirstName, issuedAt: d.issuedAt, expiresAt: d.expiresAt, lastSyncAt: d.lastSyncAt, lastHeartbeatAt: d.lastHeartbeatAt, pendingReported: d.pending, discardedReported: d.discarded, snapshotRows: d.snapshotRows, snapshotSeq: d.snapshotSeq, deskBuild: d.deskBuild, bibRange: d.bibRange, bibsRecorded: d.bibsRecorded, bibExceptions: d.bibExceptions })), counts: reviewCounts() };
    }],
    ['POST', /^\/admin\/events\/([^/]+)\/kit-offline\/devices\/([^/]+)\/revoke$/, (c, m) => {
      if (!kitOfflineOn()) return off();
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return idem(c, `arevoke:${m[2]}`, () => {
        const d = state.devices.find(x => x.id === m[2]);
        if (!d) return { status: 404, json: { error: 'device_not_found' } };
        if (typeof c.body?.reason !== 'string' || c.body.reason.trim().length < 10) return { status: 422, json: { error: 'reason_required' } };
        d.status = 'revoked'; d.revokedAt = nowIso(); state.opLog.push({ type: 'admin_desk_revoked', id: d.id, reason: c.body.reason, reasonSw: c.body.reasonSw ?? null });
        return { status: 200, json: { device: deviceView(d) } };
      });
    }],

    // ═══ Waitlist (§4.9): organizer counts and controls, admin masked list ═══
    ['GET', /^\/organizer\/events\/([^/]+)\/waitlist$/, (_c, m) => {
      if (!waitlistOn()) return off();
      if (!inRoles('owner', 'admin', 'ops', 'finance')) return forbidden();
      if (m[1] !== 'evt_pub') return { status: 404, json: { error: 'event_not_found' } };
      const live = state.waitlistEntries;
      const count = (st: string) => live.filter(e => e.status === st).length;
      // Counts only: no names, no positions (D70/AC-W15). The trap fields below must never be rendered.
      return { enabled: state.waitlistEnabled, closedAt: state.waitlistClosed ? '2027-03-01T08:00:00.000Z' : null, byTicketType: [{ ticketTypeId: 'tt_1', name: 'Standard', waiting: count('waiting'), offered: count('offered'), converted: count('converted'), expired: count('expired'), left: count('left') }],
        totals: { waiting: count('waiting'), offered: count('offered'), converted: count('converted'), expired: count('expired'), left: count('left') } };
    }],
    ['PATCH', /^\/organizer\/events\/([^/]+)\/waitlist$/, (c) => {
      if (!waitlistOn()) return off();
      if (!ownerAdmin()) return forbidden();
      return idem(c, 'waitlist-toggle', () => {
        if (typeof c.body?.enabled !== 'boolean') return { status: 422, json: { error: 'validation_failed' } };
        if (state.waitlistClosed) return { status: 409, json: { error: 'invalid_state' } };
        state.waitlistEnabled = c.body.enabled; state.waitlistCalls.push({ type: 'toggle', enabled: c.body.enabled });
        return { status: 200, json: { enabled: state.waitlistEnabled } };
      });
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/waitlist\/close$/, (c) => {
      if (!waitlistOn()) return off();
      if (!ownerAdmin()) return forbidden();
      return idem(c, 'waitlist-close', () => {
        state.waitlistClosed = true; state.waitlistEnabled = false; state.waitlistCalls.push({ type: 'close' });
        state.waitlistEntries.forEach(e => { if (e.status === 'waiting' || e.status === 'offered') e.status = 'closed'; });
        return { status: 200, json: { closed: true } };
      });
    }],
    ['GET', /^\/admin\/events\/([^/]+)\/waitlist$/, () => {
      if (!waitlistOn()) return off();
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return { items: state.waitlistEntries.map(e => ({ id: e.id, name: e.name, seq: e.seq, status: e.status, joinedAt: e.joinedAt, ticketTypeId: e.ticketTypeId, ticketTypeName: e.ticketTypeName })), nextCursor: null };
    }],
    ['POST', /^\/admin\/events\/([^/]+)\/waitlist\/([^/]+)\/remove$/, (c, m) => {
      if (!waitlistOn()) return off();
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return idem(c, `wl-remove:${m[2]}`, () => {
        const e = state.waitlistEntries.find(x => x.id === m[2]);
        if (!e) return { status: 404, json: { error: 'not_found' } };
        if (typeof c.body?.reason !== 'string' || c.body.reason.trim().length < 10 || c.body.reason.length > 300) return { status: 422, json: { error: 'reason_required' } };
        e.status = 'removed'; state.waitlistCalls.push({ type: 'remove', id: e.id, reason: c.body.reason, reasonSw: c.body.reasonSw ?? null });
        return { status: 200, json: { entry: { id: e.id, status: 'removed' } } };
      });
    }],

    // ═══ Admin Health (§5.7), Operations (§6.3), Disputes (§6.4) ═══
    ['GET', /^\/admin\/events\/health$/, (c) => {
      if (!analyticsOn()) return off();
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      const fail = (g: string, v: Json) => ((o.healthFail ?? []).includes(g) ? { error: 'unavailable' } : v);
      return {
        generatedAt: nowIso(), rolledUpAt: '2027-03-12T23:30:00.000Z', periodDays: Number(c.query.days ?? 1), eventId: c.query.eventId ?? null,
        setup: { flags: { module: true, registration: true, kitOps: true, kitOffline: kitOfflineOn(), waitlist: waitlistOn(), analytics: true, webhooks: true, organizerApi: true, results: true, rewards: true, medalArt: true }, payment: 'manual', retentionConfigured: false, alertsConfigured: false, consentTextVersion: '2026-10-draft' },
        funnel: [{ name: 'event_list_viewed', count: 1000, ratioToPrevious: null }, { name: 'event_detail_viewed', count: 400, ratioToPrevious: 0.4 }, { name: 'registration_started', count: 100, ratioToPrevious: 0.25 }, { name: 'order_created', count: 50, ratioToPrevious: 0.5 }, { name: 'payment_confirmed', count: 25, ratioToPrevious: 0.5 }],
        ...(hasScope('payments') ? { payments: fail('payments', { manualWaiting: { count: 3, oldestAgeHours: 30, targetHours: 24 }, rejected: 1, lateCases: 0, reconciliationRequired: { count: 2, oldestAgeHours: 5 } }) } : {}),
        refunds: fail('refunds', { requestedNotPaid: { count: 4, oldestAgeDays: 6, targetDays: 7 }, batchesStuck: 0 }),
        webhooks: fail('webhooks', { pending: 7, oldestPendingAgeMinutes: 12, failedLast24h: 2, failedByClass: [{ class: 'timeout', count: 2 }], gaveUp: 1, endpointsAutoDisabled: 0 }),
        kit: fail('kit', { confirmed: 50, collected: 30, exceptions: 1, offlineDesksActive: state.devices.filter(d => d.status === 'active').length, unsentScansReported: 5, scansToCheck: reviewCounts().needsReview }),
        results: fail('results', { waitingForVerification: { count: 9, oldestAgeHours: 60 }, openDisputes: { count: 3, oldestAgeDays: 9 }, releasesInPeriod: 1 }),
        rewards: fail('rewards', { awardTasksFailed: 1, oldestAwardTaskAgeMinutes: 90, redemptionsWaiting: 2, duplicatePreventionIncidents: 0 }),
        waitlist: fail('waitlist', { waiting: state.waitlistEntries.filter(e => e.status === 'waiting').length, offersOpen: 1, converted: 2, expired: 1, promoterLastRunAt: nowIso(), promoterLastStatus: 'ok' }),
        jobs: [{ name: 'event-hold-expiry', schedule: 'every 5 minutes', lastRunAt: nowIso(), outcome: 'ok', lastSuccessAt: nowIso(), flagOn: true, late: false }, { name: 'event-waitlist-promote', schedule: 'every minute', lastRunAt: '2027-03-12T20:00:00.000Z', outcome: 'ok', lastSuccessAt: '2027-03-12T20:00:00.000Z', flagOn: true, late: true }],
        errors: [{ group: 'registration', class: '5xx', count: 2 }],
        alerts: [{ rule: 'A13', subject: 'retention', severity: 'warning', runbook: 'R10', counts: {} }],
      };
    }],
    ['GET', /^\/admin\/events\/organizers$/, (c) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      const q = (c.query.q ?? '').toLowerCase();
      return { items: state.orgs.filter(x => !q || String(x.name).toLowerCase().includes(q)).map(x => ({ ...x, clients: state.clients.filter(k => k.organizerId === x.id && k.status === 'active') })), nextCursor: null };
    }],
    ['POST', /^\/admin\/events\/organizers\/([^/]+)\/api-access$/, (c, m) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return idem(c, `api-access:${m[1]}`, () => {
        const org = state.orgs.find(x => x.id === m[1]); if (!org) return { status: 404, json: { error: 'organizer_not_found' } };
        if (typeof c.body?.enabled !== 'boolean' || String(c.body?.reason ?? '').trim().length < 10) return { status: 422, json: { error: 'reason_required' } };
        org.apiAccessEnabled = c.body.enabled; state.opLog.push({ type: 'api_access', id: org.id, enabled: c.body.enabled, reason: c.body.reason, reasonSw: c.body.reasonSw ?? null });
        return { status: 200, json: { organizerId: org.id, apiAccessEnabled: org.apiAccessEnabled } };
      });
    }],
    ['POST', /^\/admin\/events\/organizers\/([^/]+)\/api-clients\/revoke-all$/, (c, m) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return idem(c, `revoke-all:${m[1]}`, () => {
        const org = state.orgs.find(x => x.id === m[1]); if (!org) return { status: 404, json: { error: 'organizer_not_found' } };
        if (String(c.body?.reason ?? '').trim().length < 10) return { status: 422, json: { error: 'reason_required' } };
        const act = state.clients.filter(k => k.organizerId === m[1] && k.status === 'active'); act.forEach(k => { k.status = 'revoked'; }); org.activeClients = 0;
        state.opLog.push({ type: 'revoke_all', id: org.id, n: act.length, reason: c.body.reason });
        return { status: 200, json: { revoked: act.length } };
      });
    }],
    ['POST', /^\/admin\/events\/organizers\/([^/]+)\/webhook-endpoints\/disable-all$/, (c, m) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return idem(c, `disable-all:${m[1]}`, () => {
        const org = state.orgs.find(x => x.id === m[1]); if (!org) return { status: 404, json: { error: 'organizer_not_found' } };
        if (String(c.body?.reason ?? '').trim().length < 10) return { status: 422, json: { error: 'reason_required' } };
        const n = org.activeEndpoints; org.activeEndpoints = 0; state.opLog.push({ type: 'disable_all', id: org.id, n, reason: c.body.reason });
        return { status: 200, json: { disabled: n } };
      });
    }],
    ['PATCH', /^\/admin\/events\/api-clients\/([^/]+)$/, (c, m) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return idem(c, `rate:${m[1]}`, () => {
        const k = state.clients.find(x => x.id === m[1]); if (!k) return { status: 404, json: { error: 'client_not_found' } };
        const n = c.body?.ratePerMinute;
        if (!Number.isInteger(n) || n < 1 || n > 600 || String(c.body?.reason ?? '').trim().length < 10) return { status: 422, json: { error: 'validation_failed' } };
        k.ratePerMinute = n; state.opLog.push({ type: 'rate', id: k.id, n, reason: c.body.reason });
        return { status: 200, json: { client: k } };
      });
    }],
    ['GET', /^\/admin\/events\/([^/]+)\/integrations$/, (_c, m) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      if (m[1] !== 'evt_pub') return undefined;
      const org = state.orgs[0];
      return { apiClients: { active: org.activeClients, expiringSoon: 0 }, webhooks: { endpoints: org.activeEndpoints } };
    }],
    ['POST', /^\/admin\/events\/([^/]+)\/registration-state$/, (c) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return idem(c, 'reg-state', () => {
        const to = c.body?.state;
        if (!['closed', 'open'].includes(to) || String(c.body?.reason ?? '').trim().length < 10) return { status: 422, json: { error: 'validation_failed' } };
        if ((to === 'closed') === state.paused) return { status: 409, json: { error: 'invalid_transition' } };
        state.paused = to === 'closed'; state.opLog.push({ type: 'registration_state', to, reason: c.body.reason, reasonSw: c.body.reasonSw ?? null });
        return { status: 200, json: { status: state.paused ? 'registration_closed' : 'published' } };
      });
    }],
    ['POST', /^\/admin\/events\/([^/]+)\/rewards-eligible$/, (c) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      return idem(c, 'rewards-eligible', () => {
        if (typeof c.body?.eligible !== 'boolean' || String(c.body?.reason ?? '').trim().length < 10) return { status: 422, json: { error: 'validation_failed' } };
        state.rewardsEligible = c.body.eligible; state.opLog.push({ type: 'rewards_eligible', eligible: c.body.eligible, reason: c.body.reason, reasonSw: c.body.reasonSw ?? null });
        return { status: 200, json: { rewardsEligible: state.rewardsEligible } };
      });
    }],
    ['GET', /^\/admin\/events\/results\/disputes$/, (c) => {
      if (!hasScope('events')) return { status: 403, json: { error: 'forbidden' } };
      let rows = state.disputes.filter(d => d.status === (c.query.status ?? 'open'));
      if (c.query.olderThanDays) rows = rows.filter(d => d.ageDays > Number(c.query.olderThanDays));
      if (c.query.organizerStatus) rows = rows.filter(d => d.organizerStatus === c.query.organizerStatus);
      return { items: rows.map(({ organizerStatus, ...d }) => { void organizerStatus; return d; }), nextCursor: null, counts: { open: state.disputes.length } };
    }],
    ['GET', /^\/admin\/reward-redemptions$/, () => {
      if (!hasScope('events') && !hasScope('rewards')) return { status: 403, json: { error: 'forbidden' } };
      // Trap: no code is ever sent. If one were, the portal must not render it.
      return { items: state.redemptions.map(r => ({ ...r, code: undefined })), nextCursor: null };
    }],
    // ═══ Results follow-ups (§6.4) ═══
    ['PATCH', /^\/organizer\/events\/([^/]+)\/results-settings$/, (c) => {
      const cats = c.body?.categories;
      if (cats === undefined) return undefined;
      state.settingsCalls.push(c.body ?? {});
      if (!Array.isArray(cats)) return { status: 422, json: { error: 'validation_failed' } };
      for (const x of cats) {
        if (!['cat_1', 'cat_2'].includes(x.id)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'categories.id', code: 'invalid' }] } };
        if (x.timeBasis != null && !['net', 'gun'].includes(x.timeBasis)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'timeBasis', code: 'invalid' }] } };
        if (x.cutoffMinutes != null && (x.cutoffMinutes < 1 || x.cutoffMinutes > 1440)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'cutoffMinutes', code: 'invalid' }] } };
        if (x.virtualDistanceToleranceBps != null && (x.virtualDistanceToleranceBps < 0 || x.virtualDistanceToleranceBps > 10000)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'virtualDistanceToleranceBps', code: 'invalid' }] } };
      }
      return undefined; // the S6 route stores it (locked rules answer settings_locked there) and the summary returns it
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/([^/]+)\/correct\/preview$/, (c) => {
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      state.previews.push(c.body ?? {});
      const stale = c.body?.expectedRevision != null && c.body.expectedRevision !== state.resultRevision;
      if (stale) return { status: 409, json: { error: 'result_changed' } };
      return { rankBefore: 3, rankAfter: 1, othersShifted: 2, medalsAffected: 1, revision: state.resultRevision };
    }],
  ];

  return { routes, state, optionsPatch: { ops: { kitOffline: kitOfflineOn() }, waitlist: waitlistOn() ? { enabled: true, offerHours: 12, maxActivePerUser: 5 } : undefined, analytics: analyticsOn() ? { enabled: true } : undefined, payments: { blockedReason: o.paymentsBlocked ?? null } } as Json };
}
export type S7State = ReturnType<typeof makeS7>['state'];
