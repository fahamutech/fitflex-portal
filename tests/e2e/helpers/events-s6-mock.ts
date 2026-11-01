// Events S6 mock (spec docs/design/events-s6-runs-results-medals-rewards.md §6, §7, §8): organizer results (import, verify, release, correct,
// disputes, settings), medal templates and artwork, the admin reward desk, the medal-art moderation queue and the admin result exceptions.
// The backend for S6 is built in parallel, so this mock is written from the SPEC and is STRICT about it: it refuses what the spec says the
// server refuses (a missing Idempotency-Key, a wrong role, a stale revision, a stale preview, locked rules, a non-square or SVG image, an
// outdated rights confirmation, a reward value), so a portal that guesses a shape fails the spec instead of passing a lenient mock.
// State moves as writes are accepted. Nothing here is the real backend: shape differences are listed in the PR.
import type { Json } from './events-mock';

export type S6Opts = {
  /** The server flags (`GET /events/options.results`). Defaults: results/runs/rewards/medalArt on, public off. */
  results?: boolean; runs?: boolean; publicBoard?: boolean; rewards?: boolean; medalArt?: boolean;
  /** Status of evt_pub. Default in_progress (the Results tab opens from the start of the event). */
  eventStatus?: string;
  /** Answer GET /results with this page size so "Load more" can be exercised. */
  pageSize?: number;
  /** Trap: the server leaks contact data and a route in results; the portal must never render them. */
  leak?: boolean;
  /** Start with the 10K category already officially released (rules and settings are locked). */
  officialRelease?: boolean;
  /** Medals the event starts with. Default two (a finisher medal and a gold medal); false = none. */
  medals?: boolean;
};
type Reply = Json | { status: number; json: Json } | { status: 200 | 201; body: string; headers?: Record<string, string> } | { status: 204 };
type Call = { method: string; path: string; query: Record<string, string>; body: Json | null; headers?: Record<string, string>; bytes?: number };
type Handler = (c: Call, m: RegExpMatchArray) => Reply | undefined;

export const ART_CONFIRMATION_VERSION = '2026-10-29.s6draft1';
const ART_CONFIRMATION = { version: ART_CONFIRMATION_VERSION, status: 'draft_pending_counsel', en: 'I made this design or have the right to use it. It does not use another brand\'s logo or an identifiable person\'s picture without permission. FitFlex may show it to participants in the app.', sw: 'Nimetengeneza muundo huu au nina haki ya kuutumia. Hauna nembo ya chapa nyingine wala picha ya mtu anayetambulika bila ruhusa. FitFlex inaweza kuuonyesha kwa washiriki kwenye app.' };
const DQ_REASONS = ['rule_violation', 'course_cut', 'wrong_category', 'equipment', 'identity', 'virtual_evidence', 'other'];
export const BUILTIN = ['finisher_green', 'finisher_gold', 'podium_gold', 'podium_silver', 'podium_bronze', 'time_blue', 'charity_red', 'virtual_teal'];
const CATS: Record<string, { name: string; distanceMeters: number }> = { cat_1: { name: '21K Half Marathon', distanceMeters: 21100 }, cat_2: { name: '10K', distanceMeters: 10000 } };
/** A tiny SVG served for preview/file routes: enough for an <img> of a blob. */
const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#336699"/></svg>';

export const parseMs = (raw: string): number | 'invalid' | 'range' => {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(raw.trim());
  if (!m) return 'invalid';
  const ms = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + (m[4] ? Number(m[4].padEnd(3, '0')) : 0);
  return ms <= 0 || ms > 86_400_000 ? 'range' : ms;
};
export const fmtMs = (ms: number | null | undefined) => { if (ms == null) return null; const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export type S6Result = {
  id: string; registrationId: string; revision: number; finishStatus: 'finished' | 'dnf' | 'dns' | 'dq'; verificationStatus: string;
  netMs: number | null; gunMs: number | null; sourceType: string; sourceLabel: string | null; flags: string[]; history: Json[];
  overallRank: number | null; categoryRank: number | null; withinCutoff: boolean | null; linkedRun?: Json | null; updatedAt: string; rejectReason?: string | null;
};
export type S6State = {
  regs: Json[]; results: Record<string, S6Result>; releases: Record<string, { stage: 'provisional' | 'official'; releasedAt: string }>;
  imports: Json[]; importHashes: Record<string, Json>; disputes: Json[]; settings: Json; templates: Json[]; arts: Json[]; uploads: Json[]; failArt: string | null;
  idem: Record<string, { body: string; reply: Json }>; defs: Json[]; ledger: Json[]; redemptions: Json[]; tasks: Json[]; audit: Json[];
  version: number; seq: number; notices: string[];
};

export function makeS6(user: Json, me: Json | null, o: S6Opts) {
  const role: string = me?.role ?? (user.userType === 'event_organizer' ? 'owner' : 'ops');
  const suspended = (me?.organizer?.status ?? 'active') === 'suspended';
  const scopes: string[] | null = user.portalUser ? (user.aclPermissions ?? []) : null;
  const isAdmin = user.userType === 'admin';
  const hasScope = (s: string) => isAdmin && (scopes === null || scopes.includes(s));
  const status = o.eventStatus ?? 'in_progress';
  const flags = { enabled: o.results !== false, runs: o.runs !== false, public: !!o.publicBoard, rewards: o.rewards !== false, medalArt: o.medalArt !== false };
  const on = () => flags.enabled;
  const rewardsOn = () => flags.enabled && flags.rewards;
  const artOn = () => rewardsOn() && flags.medalArt;
  const KEY = /^.{8,100}$/;
  const forbidden = () => ({ status: 403, json: { error: 'forbidden_role' } });
  const off = () => ({ status: 404, json: { error: 'feature_disabled' } });
  const noEvent = () => ({ status: 404, json: { error: 'event_not_found' } });
  const inRoles = (...r: string[]) => r.includes(role);
  const noIds = (c: Call) => !!(c.body && ('userId' in c.body || 'ownerId' in c.body || 'organizerId' in c.body || 'imageUrl' in c.body));

  const state: S6State = {
    regs: [
      { id: 'reg_1', first: 'Amina', last: 'Mollel', cat: 'cat_1', bib: '101', status: 'confirmed' },
      { id: 'reg_2', first: 'Baraka', last: 'Mushi', cat: 'cat_1', bib: '102', status: 'confirmed' },
      { id: 'reg_3', first: 'Chausiku', last: 'Juma', cat: 'cat_1', bib: '103', status: 'confirmed' },
      { id: 'reg_4', first: 'Daudi', last: 'Kway', cat: 'cat_2', bib: '104', status: 'confirmed' },
      { id: 'reg_5', first: 'Neema', last: 'Swai', cat: 'cat_2', bib: '105', status: 'confirmed' },
      { id: 'reg_6', first: 'Zawadi', last: 'Kim', cat: 'cat_2', bib: '106', status: 'cancelled' },
      { id: 'reg_7', first: 'Hamisi', last: 'Ali', cat: 'cat_1', bib: '107', status: 'confirmed' },
    ],
    results: {}, releases: {}, imports: [], importHashes: {}, disputes: [], settings: { timeBasis: 'net', cutoffMinutes: null, disputeWindowHours: 168, publicNames: 'initial' },
    templates: [], arts: [], uploads: [], failArt: null, idem: {}, defs: [], ledger: [], redemptions: [], tasks: [], audit: [], version: 1, seq: 1, notices: [],
  };
  const stamp = '2027-03-13T09:00:00.000Z';
  const seed = (regId: string, over: Partial<S6Result>) => {
    state.results[regId] = { id: `res_${regId}`, registrationId: regId, revision: 1, finishStatus: 'finished', verificationStatus: 'pending_verification', netMs: null, gunMs: null, sourceType: 'timing_provider', sourceLabel: 'ChipTime Ltd', flags: [], history: [], overallRank: null, categoryRank: null, withinCutoff: null, updatedAt: stamp, ...over };
  };
  seed('reg_1', { netMs: 6_130_000, gunMs: 6_150_000 });
  seed('reg_2', { netMs: 6_903_000, sourceType: 'fitflex_gps', sourceLabel: null, flags: ['implausible_pace'], linkedRun: { distanceMeters: 21200, elapsedMs: 6_903_000, checks: { bestKmPaceSec: 120 }, flags: ['implausible_pace'] } });
  seed('reg_3', { netMs: 6_903_000, verificationStatus: 'verified', sourceType: 'organizer_verified', sourceLabel: null });
  seed('reg_4', { netMs: 3_080_000 });
  seed('reg_5', { netMs: 3_524_000 });
  state.disputes.push({ id: 'dsp_1', registrationId: 'reg_3', resultId: 'res_reg_3', reasonCode: 'time_wrong', note: 'My watch says 1:52', status: 'open', createdAt: '2027-03-13T12:00:00.000Z', windowEndsAt: '2027-03-20T12:00:00.000Z' });
  if (o.officialRelease) {
    state.releases.cat_2 = { stage: 'official', releasedAt: '2027-03-13T10:00:00.000Z' };
    for (const id of ['reg_4', 'reg_5']) state.results[id].verificationStatus = 'verified';
    rank('cat_2');
  }
  if (o.medals !== false) {
    state.templates.push(
      { id: 'tpl_1', name: { en: 'Finisher', sw: 'Aliyemaliza' }, description: { en: 'Finish the race', sw: 'Maliza mbio' }, tier: 'finisher', categoryId: null, rule: { type: 'finish' }, status: 'active', sortOrder: 0, awardedCount: 0, art: { source: 'builtin', artKey: 'finisher_green' } },
      { id: 'tpl_2', name: { en: 'Podium gold', sw: '' }, description: { en: '', sw: '' }, tier: 'gold', categoryId: 'cat_1', rule: { type: 'placing', scope: 'category', top: 1 }, status: 'active', sortOrder: 1, awardedCount: 0, art: { source: 'builtin', artKey: 'podium_gold' } },
    );
  }
  state.defs.push({ id: 'rwd_1', title: { en: 'Finisher certificate', sw: 'Cheti cha aliyemaliza' }, terms: { en: 'Shown in the app.', sw: 'Linaonyeshwa kwenye app.' }, triggerType: 'event_finish', triggerEventId: 'evt_pub', triggerRef: null, redeemMode: 'certificate', reversalPolicy: 'revoke_unredeemed', capTotal: 100, capPerUser: 1, capUsed: 3, status: 'active', issuer: 'fitflex', fundingNote: 'FitFlex', valueTzs: null, startsAt: null, endsAt: null, expiryDays: null });
  state.ledger.push({ id: 'led_1', entryType: 'earn', definitionId: 'rwd_1', titleOf: { en: 'Finisher certificate', sw: 'Cheti cha aliyemaliza' }, units: 1, sourceType: 'event_result', member: 'Amina M.', anonymised: false, userId: 'usr_a', occurredAt: stamp }, { id: 'led_2', entryType: 'reverse', definitionId: 'rwd_1', titleOf: { en: 'Finisher certificate', sw: 'Cheti cha aliyemaliza' }, units: -1, sourceType: 'event_medal', member: 'Amina M.', anonymised: false, userId: 'usr_a', occurredAt: stamp, reverses: 'led_1' });
  state.redemptions.push({ id: 'red_1', code: 'FFR-AB12CD34', definitionId: 'rwd_1', title: { en: 'Finisher perk', sw: 'Faida ya aliyemaliza' }, member: 'Baraka M.', needsReview: false, status: 'reserved', expiresAt: '2027-03-27T09:00:00.000Z' });
  state.tasks.push({ id: 'tsk_1', eventId: 'evt_pub', reason: 'release', state: 'failed', attempts: 5, lastError: 'timeout', createdAt: stamp });
  state.arts.push({ id: 'art_q1', templateId: 'tpl_x', eventId: 'evt_pub', eventTitle: 'Arusha Trail 10K', organizerId: 'org_1', organizerName: 'Dar Runners', categoryName: '10K', tier: 'finisher', status: 'live', reviewState: 'to_review', altText: { en: 'A green runner', sw: '' }, confirmedAt: '2027-03-12T08:00:00.000Z', confirmationVersion: ART_CONFIRMATION_VERSION, organizerTakedowns30d: 3, highlightOrganizer: true, revision: 1 });

  function rankOf(catId: string) {
    const list = Object.values(state.results).filter(r => state.regs.find(x => x.id === r.registrationId)?.cat === catId && r.finishStatus === 'finished' && ['verified', 'corrected'].includes(r.verificationStatus) && r.netMs != null);
    list.sort((a, b) => a.netMs! - b.netMs!);
    list.forEach((r, i) => { r.overallRank = i > 0 && list[i - 1].netMs === r.netMs ? list[i - 1].overallRank : i + 1; r.categoryRank = r.overallRank; });
  }
  function rank(catId: string) { rankOf(catId); }
  const reg = (id: string) => state.regs.find(r => r.id === id);
  const stageOf = (catId: string) => state.releases[catId]?.stage ?? 'none';
  const rowOf = (r: Json, res?: S6Result) => {
    const base = { registrationId: r.id, displayName: `${r.first} ${r.last}`, bibNumber: r.bib, categoryId: r.cat, categoryName: CATS[r.cat].name };
    if (!res) return { ...base, resultId: null, revision: null, finishStatus: null, verificationStatus: null, stage: 'none', flags: [], disputeOpen: false };
    const disputeOpen = state.disputes.some(d => d.registrationId === r.id && d.status === 'open');
    const st = res.verificationStatus === 'disqualified' ? 'disqualified' : res.verificationStatus === 'rejected' ? 'rejected' : disputeOpen ? 'disputed' : res.verificationStatus === 'corrected' ? 'corrected' : stageOf(r.cat) === 'official' && res.verificationStatus === 'verified' ? 'official' : stageOf(r.cat) === 'none' ? 'none' : 'provisional';
    return {
      ...base, resultId: res.id, revision: res.revision, finishStatus: res.finishStatus, verificationStatus: res.verificationStatus, stage: st, sourceType: res.sourceType, sourceLabel: res.sourceLabel,
      netElapsedMs: res.netMs, gunElapsedMs: res.gunMs, elapsedMs: res.netMs, overallRank: res.overallRank, categoryRank: res.categoryRank, withinCutoff: res.withinCutoff, flags: res.flags, disputeOpen, updatedAt: res.updatedAt,
      ...(o.leak ? { phone: '+255712000000', email: 'leak@example.com', route: [[-6.7, 39.2]] } : {}),
    };
  };
  const summaryFor = () => ({
    perCategory: Object.entries(CATS).map(([id, c]) => {
      const regs = state.regs.filter(r => r.cat === id && r.status === 'confirmed');
      const rs = regs.map(r => state.results[r.id]).filter(Boolean);
      const rel = state.releases[id];
      return {
        categoryId: id, name: c.name, distanceMeters: c.distanceMeters, confirmed: regs.length,
        finished: rs.filter(r => r.finishStatus === 'finished' && r.verificationStatus !== 'pending_verification' && r.verificationStatus !== 'rejected').length,
        dnf: rs.filter(r => r.finishStatus === 'dnf').length, dns: rs.filter(r => r.finishStatus === 'dns').length, dq: rs.filter(r => r.verificationStatus === 'disqualified').length,
        pending: rs.filter(r => r.verificationStatus === 'pending_verification').length, rejected: rs.filter(r => r.verificationStatus === 'rejected').length,
        noResult: regs.length - rs.length, flagged: rs.filter(r => r.flags.length && r.verificationStatus === 'pending_verification').length,
        release: rel ? { stage: rel.stage, releasedAt: rel.releasedAt, releasedBy: { name: 'Neema Organizer' } } : { stage: 'none', releasedAt: null, releasedBy: null },
        disputesOpen: state.disputes.filter(d => d.status === 'open' && reg(d.registrationId)?.cat === id).length,
      };
    }),
    disputesOpen: state.disputes.filter(d => d.status === 'open').length, importsCount: state.imports.length, settings: state.settings,
  });
  const csvRows = (csv: string) => {
    const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const delim = (lines[0] ?? '').includes(';') && !(lines[0] ?? '').includes(',') ? ';' : ',';
    const head = (lines[0] ?? '').split(delim).map(h => h.trim().toLowerCase());
    const col = (names: string[]) => head.findIndex(h => names.includes(h));
    const c = { bib: col(['bib', 'bib_number', 'number']), id: col(['registrationid']), status: col(['status']), net: col(['net_time', 'chip_time', 'time']), gun: col(['gun_time']), cat: col(['category']), rank: col(['rank', 'position']) };
    return { head, c, rows: lines.slice(1).map((l, i) => ({ line: i + 2, cells: l.split(delim).map(x => x.trim()) })) };
  };
  function analyse(csv: string) {
    const { c, rows } = csvRows(csv);
    const problems: Json[] = []; const warnings: Json[] = []; const seen = new Set<string>(); const ops: Json[] = [];
    if (c.rank >= 0) warnings.push({ line: 1, code: 'rank_ignored' });
    for (const row of rows) {
      const get = (i: number) => (i >= 0 ? row.cells[i] ?? '' : '');
      const bib = get(c.bib); const regId = get(c.id);
      const r = bib ? state.regs.find(x => x.bib === bib) : regId ? reg(regId) : undefined;
      const p = (code: string) => problems.push({ line: row.line, bib: bib || null, code });
      if (/^[=+\-@\t\r]/.test(bib)) { p('bib_not_found'); continue; }
      if (!r) { p('bib_not_found'); continue; }
      if (seen.has(r.id)) { p('bib_duplicate_in_file'); continue; }
      seen.add(r.id);
      if (r.status !== 'confirmed') { p('registration_not_confirmed'); continue; }
      const existing = state.results[r.id];
      if (existing && ['verified', 'corrected'].includes(existing.verificationStatus)) { p('already_official'); continue; }
      const st = (get(c.status) || (get(c.net) ? 'finished' : '')).toLowerCase().replace(/^fin$/, 'finished');
      if (!['finished', 'dnf', 'dns', 'dq'].includes(st)) { p(st ? 'status_invalid' : 'time_missing_for_finisher'); continue; }
      let net: number | null = null;
      if (st === 'finished' || st === 'dq') {
        const raw = get(c.net) || get(c.gun);
        if (!raw) { if (st === 'finished') { p('time_missing_for_finisher'); continue; } } else {
          const ms = parseMs(raw);
          if (ms === 'invalid') { p('time_invalid'); continue; }
          if (ms === 'range') { p('time_out_of_range'); continue; }
          net = ms;
        }
      }
      const gunRaw = get(c.gun); const gun = gunRaw ? parseMs(gunRaw) : null;
      ops.push({ regId: r.id, st, net, gun: typeof gun === 'number' ? gun : null, same: existing && existing.finishStatus === st && existing.netMs === net });
    }
    return { problems, warnings, ops, total: rows.length };
  }
  const hashOf = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return `ph_${(h >>> 0).toString(16)}_${state.version}`; };
  const audit = (action: string, extra: Json = {}) => state.audit.push({ action, ...extra });

  /** Idempotency like §8.1: same key + same body replays the stored answer; another body is 409. */
  const idempotent = (c: Call, route: string, work: () => { status: number; json: Json }) => {
    const key = c.headers?.['idempotency-key'];
    if (!key || !KEY.test(key)) return { status: 400, json: { error: 'idempotency_key_required' } };
    if (noIds(c)) return { status: 400, json: { error: 'invalid_request' } };
    const k = `${role}|${route}|${key}`; const fp = JSON.stringify(c.body ?? {});
    const seen = state.idem[k];
    if (seen) return seen.body === fp ? { status: 200, json: seen.reply } : { status: 409, json: { error: 'idempotency_key_reused' } };
    const out = work();
    if (out.status < 300) state.idem[k] = { body: fp, reply: out.json };
    return out;
  };
  const write = (c: Call, route: string, roles: string[], work: () => { status: number; json: Json }) => {
    if (!on()) return off();
    if (!inRoles(...roles)) return forbidden();
    if (suspended) return { status: 403, json: { error: 'organizer_suspended' } };
    return idempotent(c, route, work);
  };
  const needRevision = (c: Call, res: S6Result | undefined) => {
    if (!res) return { status: 404, json: { error: 'result_not_found' } };
    if (c.body?.expectedRevision !== res.revision) return { status: 409, json: { error: 'result_changed' } };
    return null;
  };
  const note = (c: Call, min: number, max: number) => { const n = String(c.body?.note ?? '').trim(); return n.length >= min && n.length <= max; };
  const bump = (res: S6Result, over: Partial<S6Result>, reason?: string, by = 'Neema Organizer') => {
    res.history.push({ revision: res.revision, finishStatus: res.finishStatus, verificationStatus: res.verificationStatus, netElapsedMs: res.netMs, gunElapsedMs: res.gunMs, sourceType: res.sourceType, reasonCode: reason ?? null, by: { name: by }, at: stamp });
    Object.assign(res, over, { revision: res.revision + 1, updatedAt: stamp });
    state.version += 1;
  };
  const resByResultId = (id: string) => Object.values(state.results).find(r => r.id === id);
  const pageOf = <T,>(items: T[], c: Call, size = o.pageSize ?? 50) => {
    const start = Number(c.query.cursor ?? 0) || 0;
    const next = start + size;
    return { items: items.slice(start, next), nextCursor: next < items.length ? String(next) : null };
  };
  const eventOk = (id: string) => id === 'evt_pub';
  const unsettledOf = (catId: string | null) => Object.values(state.results).filter(r => (!catId || reg(r.registrationId)?.cat === catId) && r.verificationStatus === 'pending_verification').length;
  const scopeCats = (catId: string | null) => (catId ? [catId] : Object.keys(CATS));
  const medalScopeReleased = (t: Json) => (t.categoryId ? stageOf(t.categoryId) === 'official' : Object.keys(CATS).some(c => stageOf(c) === 'official'));
  const tplOf = (id: string) => state.templates.find(t => t.id === id);
  const defOf = (id: string) => state.defs.find(d => d.id === id);
  const needEvents = () => (!hasScope('events') ? { status: 403, json: { error: 'acl_forbidden' } } : null);

  const routes: Array<[string, RegExp, Handler]> = [
    // ── summary and list ──
    ['GET', /^\/organizer\/events\/([^/]+)\/results\/summary$/, (_c, m) => {
      if (!on()) return off();
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      if (!eventOk(m[1])) return noEvent();
      return summaryFor();
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/results$/, (c, m) => {
      if (!on()) return off();
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      if (!eventOk(m[1])) return noEvent();
      const q = (c.query.q ?? '').toLowerCase();
      if (c.query.q && q.length < 2) return { status: 400, json: { error: 'invalid_request' } };
      let rows = state.regs.filter(r => r.status === 'confirmed').map(r => rowOf(r, state.results[r.id]));
      if (c.query.categoryId) rows = rows.filter(r => r.categoryId === c.query.categoryId);
      if (c.query.flag) rows = rows.filter(r => (r.flags as string[]).includes(c.query.flag));
      if (c.query.q) rows = rows.filter(r => `${r.displayName} ${r.bibNumber}`.toLowerCase().includes(q));
      const s = c.query.status;
      if (s && !['needs_review', 'verified', 'rejected', 'dnf', 'dns', 'dq', 'no_result'].includes(s)) return { status: 400, json: { error: 'invalid_request' } };
      if (s) rows = rows.filter(r => (s === 'needs_review' ? r.verificationStatus === 'pending_verification' : s === 'no_result' ? !r.resultId : s === 'dq' ? r.verificationStatus === 'disqualified' : ['dnf', 'dns'].includes(s) ? r.finishStatus === s : r.verificationStatus === s));
      return { ...pageOf(rows, c), total: rows.length };
    }],
    // ── import ──
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/imports\/preview$/, (c, m) => {
      if (!on()) return off();
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      if (!eventOk(m[1])) return noEvent();
      if (typeof c.body?.csv !== 'string' || !['timing_provider', 'organizer_verified'].includes(c.body?.sourceType)) return { status: 400, json: { error: 'invalid_request' } };
      if (c.body.csv.length > 1_048_576) return { status: 413, json: { error: 'payload_too_large' } };
      if (!/^[^,;\n]+[,;]/.test(c.body.csv)) return { status: 400, json: { error: 'csv_invalid' } };
      const a = analyse(c.body.csv);
      const byStatus = { finished: 0, dnf: 0, dns: 0, dq: 0 } as Record<string, number>;
      a.ops.forEach(op => { byStatus[op.st] += 1; });
      const covered = new Set(a.ops.map(x => x.regId));
      return {
        previewHash: hashOf(c.body.csv + JSON.stringify(c.body.timeBasis ?? '')), rows: { total: a.total, ok: a.ops.length, warnings: a.warnings.length, problems: a.problems.length },
        willCreate: a.ops.filter(x => !x.same && !state.results[x.regId]).length, willRevise: a.ops.filter(x => !x.same && state.results[x.regId]).length, unchanged: a.ops.filter(x => x.same).length,
        byStatus, unmatchedRegistrations: state.regs.filter(r => r.status === 'confirmed' && !state.results[r.id] && !covered.has(r.id)).length, problems: a.problems.slice(0, 200), warnings: a.warnings,
      };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/imports$/, (c, m) => write(c, `imports|${m[1]}`, ['owner', 'admin', 'timing'], () => {
      if (!eventOk(m[1])) return { status: 404, json: { error: 'event_not_found' } };
      const csv: string = c.body?.csv ?? '';
      if (state.importHashes[csv]) return { status: 200, json: state.importHashes[csv] };
      if (c.body?.previewHash !== hashOf(csv + JSON.stringify(c.body?.timeBasis ?? ''))) return { status: 409, json: { error: 'preview_stale' } };
      const a = analyse(csv);
      if (a.problems.length) return { status: 409, json: { error: 'import_has_errors', problems: a.problems.length, rows: a.problems.slice(0, 50) } };
      let created = 0; let revised = 0; let unchanged = 0;
      for (const op of a.ops) {
        if (op.same) { unchanged += 1; continue; }
        const cur = state.results[op.regId];
        const settled = op.st === 'dnf' || op.st === 'dns';
        const over = { finishStatus: op.st, verificationStatus: settled ? op.st : 'pending_verification', netMs: op.net, gunMs: op.gun, sourceType: c.body.sourceType, sourceLabel: c.body.sourceLabel ?? null, flags: [] as string[] };
        if (cur) { bump(cur, over as Partial<S6Result>); revised += 1; } else { seed(op.regId, over as Partial<S6Result>); created += 1; }
      }
      const rec = { id: `imp_${state.imports.length + 1}`, fileName: c.body.fileName ?? 'results.csv', sourceType: c.body.sourceType, sourceLabel: c.body.sourceLabel ?? null, rowCount: a.total, createdCount: created, revisedCount: revised, unchangedCount: unchanged, createdBy: { name: user.displayName ?? 'Neema Organizer' }, createdAt: stamp };
      state.imports.unshift(rec); state.version += 1; audit('events.results_imported');
      const reply = { import: rec };
      state.importHashes[csv] = reply;
      return { status: 201, json: reply };
    })],
    ['GET', /^\/organizer\/events\/([^/]+)\/results\/imports$/, (c, m) => {
      if (!on()) return off();
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      if (!eventOk(m[1])) return noEvent();
      return { items: state.imports, nextCursor: null, c: c.query.cursor ?? null };
    }],
    // ── bulk, release (before the :resultId routes so `verify-bulk` and `release` never read as ids) ──
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/verify-bulk\/preview$/, (c) => {
      if (!on()) return off();
      if (!inRoles('owner', 'admin')) return forbidden();
      if (c.body?.filter !== 'pending_clean') return { status: 400, json: { error: 'invalid_request' } };
      const pend = Object.values(state.results).filter(r => r.verificationStatus === 'pending_verification' && (!c.body?.categoryId || reg(r.registrationId)?.cat === c.body.categoryId));
      return { previewHash: hashOf(`bulk${pend.length}${c.body?.categoryId ?? ''}`), count: pend.filter(r => !r.flags.length && r.finishStatus !== 'dq').length, excludedFlagged: pend.filter(r => r.flags.length).length };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/verify-bulk$/, (c, m) => write(c, `bulk|${m[1]}`, ['owner', 'admin'], () => {
      const pend = Object.values(state.results).filter(r => r.verificationStatus === 'pending_verification' && (!c.body?.categoryId || reg(r.registrationId)?.cat === c.body.categoryId));
      if (c.body?.previewHash !== hashOf(`bulk${pend.length}${c.body?.categoryId ?? ''}`)) return { status: 409, json: { error: 'preview_stale' } };
      const clean = pend.filter(r => !r.flags.length && r.finishStatus !== 'dq');
      clean.forEach(r => bump(r, { verificationStatus: 'verified' }));
      audit('events.results_bulk_verified', { count: clean.length });
      return { status: 200, json: { verified: clean.length } };
    })],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/release\/preview$/, (c) => {
      if (!on()) return off();
      if (!inRoles('owner', 'admin')) return forbidden();
      if (!['provisional', 'official'].includes(c.body?.stage)) return { status: 400, json: { error: 'invalid_request' } };
      const cats = scopeCats(c.body?.categoryId ?? null);
      const rs = Object.values(state.results).filter(r => cats.includes(reg(r.registrationId)?.cat));
      const noRes = state.regs.filter(r => r.status === 'confirmed' && cats.includes(r.cat) && !state.results[r.id]).length;
      return {
        previewHash: hashOf(`rel${c.body?.categoryId ?? ''}${c.body.stage}${state.version}`),
        finished: rs.filter(r => r.finishStatus === 'finished' && !['pending_verification', 'rejected', 'disqualified'].includes(r.verificationStatus)).length,
        dnf: rs.filter(r => r.finishStatus === 'dnf').length, dns: rs.filter(r => r.finishStatus === 'dns').length, dq: rs.filter(r => r.verificationStatus === 'disqualified').length,
        noResult: noRes, unsettled: unsettledOf(c.body?.categoryId ?? null), rejected: Object.values(state.results).filter(r => cats.includes(reg(r.registrationId)?.cat) && r.verificationStatus === 'rejected').length, willMarkDns: noRes,
      };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/release\/withdraw$/, (c, m) => write(c, `withdraw|${m[1]}`, ['owner', 'admin'], () => {
      const cat = c.body?.categoryId ?? null;
      const cur = cat ? state.releases[cat] : undefined;
      if (!cur) return { status: 404, json: { error: 'not_found' } };
      if (cur.stage === 'official') return { status: 409, json: { error: 'already_released' } };
      delete state.releases[cat]; state.version += 1; audit('events.results_withdrawn');
      return { status: 200, json: { withdrawn: { id: `rel_${state.version}`, categoryId: cat } } };
    })],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/release$/, (c, m) => write(c, `release|${m[1]}`, ['owner', 'admin'], () => {
      const b = c.body ?? {};
      if (!['provisional', 'official'].includes(b.stage) || typeof b.markRemainingDns !== 'boolean' || typeof b.leaveUnsettledOut !== 'boolean') return { status: 400, json: { error: 'invalid_request' } };
      if (b.previewHash !== hashOf(`rel${b.categoryId ?? ''}${b.stage}${state.version}`)) return { status: 409, json: { error: 'preview_stale' } };
      const cats = scopeCats(b.categoryId ?? null);
      if (cats.some(cid => state.releases[cid]?.stage === 'official')) return { status: 409, json: { error: 'already_released' } };
      if (b.stage === 'official' && unsettledOf(b.categoryId ?? null) > 0 && !b.leaveUnsettledOut) return { status: 409, json: { error: 'unsettled_results', unsettled: unsettledOf(b.categoryId ?? null) } };
      if (b.stage === 'provisional' && !Object.values(state.results).some(r => cats.includes(reg(r.registrationId)?.cat))) return { status: 422, json: { error: 'no_results' } };
      const marked = b.stage === 'official' && b.markRemainingDns ? state.regs.filter(r => r.status === 'confirmed' && cats.includes(r.cat) && !state.results[r.id]).length : 0;
      const resultCount = Object.values(state.results).filter(r => cats.includes(reg(r.registrationId)?.cat) && r.verificationStatus !== 'pending_verification' && r.verificationStatus !== 'rejected').length + marked;
      if (b.stage === 'official' && b.markRemainingDns) state.regs.filter(r => r.status === 'confirmed' && cats.includes(r.cat) && !state.results[r.id]).forEach(r => seed(r.id, { finishStatus: 'dns', verificationStatus: 'dns', netMs: null, sourceType: 'organizer_verified', sourceLabel: null }));
      cats.forEach(cid => { state.releases[cid] = { stage: b.stage, releasedAt: stamp }; if (b.stage === 'official') rank(cid); });
      state.version += 1; audit('events.results_released', { stage: b.stage });
      return { status: 200, json: { release: { id: `rel_${state.version}`, stage: b.stage, categoryId: b.categoryId ?? null, resultCount, unsettledCount: unsettledOf(b.categoryId ?? null), releasedAt: stamp, markedDns: marked } } };
    })],
    // ── disputes and settings ──
    ['GET', /^\/organizer\/events\/([^/]+)\/results\/disputes$/, (c, m) => {
      if (!on()) return off();
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      if (!eventOk(m[1])) return noEvent();
      const items = state.disputes.filter(d => !c.query.status || d.status === c.query.status).map(d => { const r = reg(d.registrationId)!; return { ...d, bibNumber: r.bib, displayName: `${r.first} ${r.last}` }; });
      return { items, nextCursor: null };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/disputes\/([^/]+)\/resolve$/, (c, m) => write(c, `resolve|${m[2]}`, ['owner', 'admin'], () => {
      const d = state.disputes.find(x => x.id === m[2]);
      if (!d) return { status: 404, json: { error: 'dispute_not_found' } };
      if (d.status !== 'open') return { status: 409, json: { error: 'invalid_transition' } };
      const b = c.body ?? {};
      if (!['upheld', 'rejected'].includes(b.outcome) || String(b.note ?? '').trim().length < 5 || String(b.note).length > 500) return { status: 400, json: { error: 'invalid_request' } };
      if (b.outcome === 'upheld') {
        const res = state.results[d.registrationId]; const cor = b.correction;
        if (!cor) return { status: 422, json: { error: 'correction_required' } };
        if (cor.action !== 'correct' && cor.action !== 'disqualify') return { status: 400, json: { error: 'invalid_request' } };
        if (cor.expectedRevision !== res.revision) return { status: 409, json: { error: 'result_changed' } };
        const net = cor.netTime ? parseMs(cor.netTime) : null;
        bump(res, { verificationStatus: 'corrected', ...(typeof net === 'number' ? { netMs: net } : {}) }, cor.reasonCode);
        rank(reg(d.registrationId)!.cat);
      }
      Object.assign(d, { status: b.outcome, resolutionNote: b.note, resolvedAt: stamp });
      audit('events.dispute_resolved');
      return { status: 200, json: { dispute: { id: d.id, status: d.status, resolvedAt: stamp, resultIdAfter: d.resultId } } };
    })],
    ['PATCH', /^\/organizer\/events\/([^/]+)\/results-settings$/, (c, m) => write(c, `settings|${m[1]}`, ['owner', 'admin'], () => {
      const b = c.body ?? {};
      const locked = Object.keys(CATS).some(cid => stageOf(cid) === 'official');
      if (locked && Object.keys(b).some(k => k !== 'disputeWindowHours')) return { status: 409, json: { error: 'settings_locked' } };
      if (b.disputeWindowHours != null && (b.disputeWindowHours < 24 || b.disputeWindowHours > 720)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'disputeWindowHours', code: 'invalid' }] } };
      if (locked && b.disputeWindowHours < state.settings.disputeWindowHours) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'disputeWindowHours', code: 'cannot_shorten' }] } };
      if (b.cutoffMinutes != null && (b.cutoffMinutes < 1 || b.cutoffMinutes > 1440)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'cutoffMinutes', code: 'invalid' }] } };
      Object.assign(state.settings, b); audit('events.results_settings_changed');
      return { status: 200, json: { settings: state.settings } };
    })],
    // ── one result ──
    ['GET', /^\/organizer\/events\/([^/]+)\/results\/([^/]+)$/, (_c, m) => {
      if (!on()) return off();
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      const r = reg(m[2]);
      if (!r) return { status: 404, json: { error: 'registration_not_found' } };
      const res = state.results[r.id];
      return { result: rowOf(r, res), revisions: res ? [...res.history, { revision: res.revision, finishStatus: res.finishStatus, verificationStatus: res.verificationStatus, netElapsedMs: res.netMs, gunElapsedMs: res.gunMs, sourceType: res.sourceType, reasonCode: null, note: null, by: { name: 'Neema Organizer' }, at: stamp }] : [], linkedRun: res?.linkedRun ?? null, disputes: state.disputes.filter(d => d.registrationId === r.id) };
    }],
    ['PUT', /^\/organizer\/events\/([^/]+)\/results\/([^/]+)$/, (c, m) => write(c, `put|${m[2]}`, ['owner', 'admin', 'timing'], () => {
      const r = reg(m[2]);
      if (!r) return { status: 404, json: { error: 'registration_not_found' } };
      if (r.status !== 'confirmed') return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'registrationId', code: 'not_confirmed' }] } };
      const b = c.body ?? {};
      if (!['finished', 'dnf', 'dns'].includes(b.finishStatus)) return { status: 400, json: { error: 'invalid_request' } };
      const cur = state.results[r.id];
      if (cur && ['verified', 'corrected'].includes(cur.verificationStatus)) return { status: 409, json: { error: 'already_released' } };
      const net = b.netTime ? parseMs(b.netTime) : null; const gun = b.gunTime ? parseMs(b.gunTime) : null;
      if (b.finishStatus === 'finished' && !b.netTime && !b.gunTime) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'netTime', code: 'required' }] } };
      if (typeof net === 'string' || typeof gun === 'string') return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'netTime', code: 'invalid' }] } };
      const settled = b.finishStatus !== 'finished';
      const over = { finishStatus: b.finishStatus, verificationStatus: settled ? b.finishStatus : 'pending_verification', netMs: net, gunMs: gun, sourceType: 'organizer_verified', sourceLabel: b.sourceLabel ?? null, flags: [] as string[] };
      if (cur) bump(cur, over as Partial<S6Result>); else seed(r.id, over as Partial<S6Result>);
      state.version += 1; audit('events.result_entered');
      { const x = state.results[r.id]; return { status: 200, json: { result: { id: x.id, revision: x.revision, finishStatus: x.finishStatus, verificationStatus: x.verificationStatus, elapsedMs: x.netMs } } }; }
    })],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/([^/]+)\/verify$/, (c, m) => write(c, `verify|${m[2]}`, ['owner', 'admin'], () => {
      const res = resByResultId(m[2]); const bad = needRevision(c, res); if (bad) return bad;
      if (res!.verificationStatus !== 'pending_verification') return { status: 409, json: { error: 'invalid_transition' } };
      if (res!.finishStatus === 'dq' && !DQ_REASONS.includes(c.body?.reasonCode)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'reasonCode', code: 'required' }] } };
      bump(res!, { verificationStatus: 'verified' }); audit('events.result_verified');
      return { status: 200, json: { result: { id: res!.id, revision: res!.revision } } };
    })],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/([^/]+)\/reject$/, (c, m) => write(c, `reject|${m[2]}`, ['owner', 'admin'], () => {
      const res = resByResultId(m[2]); const bad = needRevision(c, res); if (bad) return bad;
      if (!['not_a_valid_run', 'data_error', 'duplicate', 'other'].includes(c.body?.reasonCode) || String(c.body?.note ?? '').length > 120) return { status: 400, json: { error: 'invalid_request' } };
      bump(res!, { verificationStatus: 'rejected' }, c.body.reasonCode); audit('events.result_rejected');
      return { status: 200, json: { result: { id: res!.id, revision: res!.revision } } };
    })],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/([^/]+)\/correct$/, (c, m) => write(c, `correct|${m[2]}`, ['owner', 'admin'], () => {
      const res = resByResultId(m[2]); const bad = needRevision(c, res); if (bad) return bad;
      if (!['timing_error', 'wrong_bib', 'late_finish_data', 'other'].includes(c.body?.reasonCode) || !note(c, 10, 300)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'note', code: 'invalid' }] } };
      const net = c.body.netTime ? parseMs(c.body.netTime) : null; const gun = c.body.gunTime ? parseMs(c.body.gunTime) : null;
      if (typeof net === 'string' || typeof gun === 'string') return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'netTime', code: 'invalid' }] } };
      if (net == null && gun == null && !c.body.finishStatus) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'netTime', code: 'required' }] } };
      bump(res!, { verificationStatus: 'corrected', ...(net != null ? { netMs: net } : {}), ...(gun != null ? { gunMs: gun } : {}), ...(c.body.finishStatus ? { finishStatus: c.body.finishStatus } : {}) }, c.body.reasonCode);
      rank(reg(res!.registrationId)!.cat); audit('events.result_corrected');
      return { status: 200, json: { result: { id: res!.id, revision: res!.revision } } };
    })],
    ['POST', /^\/organizer\/events\/([^/]+)\/results\/([^/]+)\/disqualify$/, (c, m) => write(c, `dq|${m[2]}`, ['owner', 'admin'], () => {
      const res = resByResultId(m[2]); const bad = needRevision(c, res); if (bad) return bad;
      if (!DQ_REASONS.includes(c.body?.reasonCode) || (c.body?.note != null && !note(c, 10, 300))) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'reasonCode', code: 'invalid' }] } };
      bump(res!, { verificationStatus: 'disqualified', finishStatus: 'dq', overallRank: null, categoryRank: null }, c.body.reasonCode);
      rank(reg(res!.registrationId)!.cat); audit('events.result_disqualified');
      return { status: 200, json: { result: { id: res!.id, revision: res!.revision } } };
    })],

    // ── medals (EVENTS_REWARDS) ──
    ['GET', /^\/organizer\/events\/([^/]+)\/medal-templates$/, (_c, m) => {
      if (!rewardsOn()) return off();
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      if (!eventOk(m[1])) return noEvent();
      return { items: state.templates.map(t => ({ ...t, locked: medalScopeReleased(t) })), builtInArt: BUILTIN, ...(artOn() ? { artConfirmation: ART_CONFIRMATION } : {}) };
    }],
    ['POST', /^\/organizer\/events\/([^/]+)\/medal-templates$/, (c, m) => {
      if (!rewardsOn()) return off();
      return write(c, `tplnew|${m[1]}`, ['owner', 'admin'], () => {
        const b = c.body ?? {};
        const rule = b.rule ?? {};
        const okRule = rule.type === 'finish' || (rule.type === 'placing' && ['category', 'overall'].includes(rule.scope) && rule.top >= 1 && rule.top <= 10) || (rule.type === 'time_under' && Number.isInteger(rule.maxElapsedMs) && rule.maxElapsedMs > 0);
        if (!okRule || !b.name?.en || !['finisher', 'gold', 'silver', 'bronze', 'time', 'other'].includes(b.tier) || (b.artKey && !BUILTIN.includes(b.artKey))) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'rule', code: 'invalid' }] } };
        const t = { id: `tpl_${state.templates.length + 1}`, name: b.name, description: b.description ?? { en: '', sw: '' }, tier: b.tier, categoryId: b.categoryId ?? null, rule, status: b.status ?? 'active', sortOrder: state.templates.length, awardedCount: 0, art: { source: 'builtin', artKey: b.artKey ?? 'finisher_green' } };
        state.templates.push(t); audit('events.medal_template_created');
        return { status: 201, json: { template: t } };
      });
    }],
    ['PATCH', /^\/organizer\/events\/([^/]+)\/medal-templates\/([^/]+)$/, (c, m) => {
      if (!rewardsOn()) return off();
      return write(c, `tplpatch|${m[2]}`, ['owner', 'admin'], () => {
        const t = tplOf(m[2]);
        if (!t) return { status: 404, json: { error: 'template_not_found' } };
        const b = c.body ?? {};
        if (medalScopeReleased(t) && ('rule' in b || 'categoryId' in b)) return { status: 409, json: { error: 'template_locked' } };
        for (const k of ['name', 'description', 'tier', 'status', 'rule', 'categoryId']) if (k in b) t[k] = b[k];
        if (b.artKey && BUILTIN.includes(b.artKey) && t.art.source !== 'custom') t.art = { source: 'builtin', artKey: b.artKey };
        audit('events.medal_template_updated');
        return { status: 200, json: { template: t } };
      });
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/medal-templates\/([^/]+)\/preview$/, (_c, m) => {
      if (!rewardsOn()) return off();
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      return tplOf(m[2]) ? { wouldReceive: 3, released: true } : { status: 404, json: { error: 'template_not_found' } };
    }],
    // ── medal art (EVENTS_MEDAL_ART): raw image body, rights confirmation as a query parameter ──
    ['POST', /^\/organizer\/events\/([^/]+)\/medal-templates\/([^/]+)\/art$/, (c, m) => {
      if (!artOn()) return off();
      if (!inRoles('owner', 'admin')) return forbidden();
      if (suspended) return { status: 403, json: { error: 'organizer_suspended' } };
      const key = c.headers?.['idempotency-key'];
      if (!key || !KEY.test(key)) return { status: 400, json: { error: 'idempotency_key_required' } };
      const t = tplOf(m[2]);
      if (!t) return { status: 404, json: { error: 'template_not_found' } };
      const type = (c.headers?.['content-type'] ?? '').split(';')[0];
      if (state.failArt) { const code = state.failArt; state.failArt = null; return { status: code === 'payload_too_large' ? 413 : code === 'busy' ? 503 : code === 'rate_limited' ? 429 : code === 'file_not_allowed' || code === 'confirmation_outdated' ? 409 : 400, json: { error: code, ...(code === 'rate_limited' ? { retryAfterSeconds: 60 } : {}) } }; }
      if (type === 'image/svg+xml') return { status: 400, json: { error: 'svg_not_allowed' } };
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) return { status: 400, json: { error: 'unsupported_file_type' } };
      if ((c.bytes ?? Number(c.headers?.['content-length'] ?? 0)) > 2 * 1024 * 1024) return { status: 413, json: { error: 'payload_too_large' } };
      if (c.query.confirmationVersion !== ART_CONFIRMATION_VERSION) return { status: 409, json: { error: 'confirmation_outdated', current: ART_CONFIRMATION } };
      const prev = state.arts.find(a => a.templateId === t.id && a.status === 'live');
      if (prev) prev.status = 'replaced';
      const art = { id: `art_${state.seq++}`, templateId: t.id, eventId: m[1], eventTitle: 'Arusha Trail 10K', organizerId: 'org_1', organizerName: 'Dar Runners', categoryName: t.categoryId ? CATS[t.categoryId].name : null, tier: t.tier, status: 'live', reviewState: 'to_review', altText: c.query.altEn || c.query.altSw ? { en: c.query.altEn ?? null, sw: c.query.altSw ?? null } : null, confirmedAt: stamp, confirmationVersion: ART_CONFIRMATION_VERSION, organizerTakedowns30d: 0, highlightOrganizer: false, revision: (prev?.revision ?? 0) + 1 };
      state.arts.push(art); state.uploads.push({ type, size: c.bytes ?? Number(c.headers?.['content-length'] ?? 0), key, templateId: t.id, confirmationVersion: c.query.confirmationVersion });
      t.art = { source: 'custom', artId: art.id, revision: art.revision, artKey: t.art.artKey, altText: art.altText };
      audit('events.medal_art_uploaded');
      return { status: 201, json: { art } };
    }],
    ['PATCH', /^\/organizer\/events\/([^/]+)\/medal-templates\/([^/]+)\/art$/, (c, m) => {
      if (!artOn()) return off();
      return write(c, `artalt|${m[2]}`, ['owner', 'admin'], () => {
        const t = tplOf(m[2]);
        if (!t || t.art.source !== 'custom') return { status: 404, json: { error: 'art_not_found' } };
        t.art.altText = c.body?.altText ?? null;
        return { status: 200, json: { art: t.art } };
      });
    }],
    ['DELETE', /^\/organizer\/events\/([^/]+)\/medal-templates\/([^/]+)\/art$/, (c, m) => {
      if (!artOn()) return off();
      if (!inRoles('owner', 'admin')) return forbidden();
      if (suspended) return { status: 403, json: { error: 'organizer_suspended' } };
      if (!c.headers?.['idempotency-key']) return { status: 400, json: { error: 'idempotency_key_required' } };
      const t = tplOf(m[2]);
      if (!t) return { status: 404, json: { error: 'template_not_found' } };
      const live = state.arts.find(a => a.templateId === t.id && a.status === 'live');
      if (live) live.status = 'removed';
      t.art = { source: 'builtin', artKey: t.art.artKey };
      audit('events.medal_art_removed');
      return { status: 200, json: { removed: { artId: live?.id ?? null } } };
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/medal-templates\/([^/]+)\/art\/preview$/, (c, m) => {
      if (!artOn()) return off();
      if (!inRoles('owner', 'admin', 'timing')) return forbidden();
      if (!['240', '480'].includes(c.query.w)) return { status: 400, json: { error: 'invalid_request' } };
      const t = tplOf(m[2]);
      const live = !!t && state.arts.some(a => a.templateId === t.id && a.status === 'live');
      return t?.art.source === 'custom' && live ? { status: 200, body: PICTURE, headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } } : { status: 404, json: { error: 'not_found' } };
    }],
    ['GET', /^\/events\/medal-art\/([^/]+)\/file$/, (c, m) => {
      if (!artOn()) return off();
      if (!['m512', 'm256', 'm128'].includes(c.query.variant)) return { status: 404, json: { error: 'not_found' } };
      const a = state.arts.find(x => x.id === m[1] && x.status === 'live');
      return a ? { status: 200, body: PICTURE, headers: { 'content-type': 'image/svg+xml' } } : { status: 404, json: { error: 'not_found' } };
    }],

    // ── FitFlex admin ──
    ['GET', /^\/admin\/medal-art$/, c => {
      if (!artOn()) return off();
      const d = needEvents(); if (d) return d;
      let items = state.arts.filter(a => (c.query.status ? a.status === c.query.status : true) && (c.query.reviewState ? a.reviewState === c.query.reviewState : true));
      if (!c.query.status && !c.query.reviewState) items = [...state.arts];
      return { toReview: state.arts.filter(a => a.reviewState === 'to_review' && a.status === 'live').length, items, nextCursor: null };
    }],
    ['GET', /^\/admin\/medal-art\/([^/]+)\/preview$/, (c, m) => {
      if (!artOn()) return off();
      const d = needEvents(); if (d) return d;
      if (!['240', '480'].includes(c.query.w)) return { status: 400, json: { error: 'invalid_request' } };
      const a = state.arts.find(x => x.id === m[1] && x.status === 'live');
      return a ? { status: 200, body: PICTURE, headers: { 'content-type': 'image/svg+xml' } } : { status: 404, json: { error: 'not_found' } };
    }],
    ['POST', /^\/admin\/medal-art\/([^/]+)\/reviewed$/, (c, m) => {
      if (!artOn()) return off();
      const d = needEvents(); if (d) return d;
      return idempotent(c, `reviewed|${m[1]}`, () => { const a = state.arts.find(x => x.id === m[1]); if (!a) return { status: 404, json: { error: 'art_not_found' } }; a.reviewState = 'reviewed'; return { status: 200, json: { art: a } }; });
    }],
    ['POST', /^\/admin\/medal-art\/([^/]+)\/take-down$/, (c, m) => {
      if (!artOn()) return off();
      const d = needEvents(); if (d) return d;
      return idempotent(c, `down|${m[1]}`, () => {
        const a = state.arts.find(x => x.id === m[1]);
        if (!a) return { status: 404, json: { error: 'art_not_found' } };
        if (a.status !== 'live') return { status: 409, json: { error: 'already_taken_down' } };
        const reason = c.body?.reason;
        if (!['inappropriate', 'rights', 'other_brand', 'person_request', 'quality', 'other'].includes(reason) || (reason === 'other' && !String(c.body?.note ?? '').trim()) || String(c.body?.note ?? '').length > 200) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'reason', code: 'invalid' }] } };
        a.status = 'taken_down'; a.takedownReason = reason;
        const t = tplOf(a.templateId); if (t) t.art = { source: 'builtin', artId: null, revision: null, artKey: t.art.artKey, altText: null };
        state.notices.push(`art_takedown:${a.id}:${reason}`); audit('events.medal_art_taken_down', { reason });
        return { status: 200, json: { art: a } };
      });
    }],
    ['GET', /^\/admin\/reward-definitions$/, () => { if (!rewardsOn()) return off(); const d = needEvents(); if (d) return d; return { items: state.defs, nextCursor: null }; }],
    ['POST', /^\/admin\/reward-definitions$/, c => {
      if (!rewardsOn()) return off();
      const d = needEvents(); if (d) return d;
      return idempotent(c, 'defnew', () => {
        const b = c.body ?? {};
        if (b.valueTzs != null) return { status: 422, json: { error: 'value_not_allowed_yet' } };
        if (b.issuerType !== undefined && b.issuerType !== 'fitflex') return { status: 422, json: { error: 'issuer_not_allowed' } };
        if (!b.title?.en || !b.title?.sw || !b.terms?.en || !b.terms?.sw || !String(b.fundingNote ?? '').trim() || !['event_finish', 'medal', 'achievement'].includes(b.triggerType)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'terms', code: 'required' }] } };
        const def = { ...b, id: `rwd_${state.defs.length + 1}`, capUsed: 0, valueTzs: null, issuerType: 'fitflex', status: b.status === 'active' ? 'active' : 'draft' };
        state.defs.push(def); audit('events.reward_definition_created');
        return { status: 201, json: { definition: def } };
      });
    }],
    ['PATCH', /^\/admin\/reward-definitions\/([^/]+)$/, (c, m) => {
      if (!rewardsOn()) return off();
      const d = needEvents(); if (d) return d;
      return idempotent(c, `defpatch|${m[1]}`, () => {
        const def = defOf(m[1]);
        if (!def) return { status: 404, json: { error: 'definition_not_found' } };
        if (c.body?.valueTzs != null) return { status: 422, json: { error: 'value_not_allowed_yet' } };
        if (def.status === 'ended') return { status: 409, json: { error: 'definition_ended' } };
        const hasLedger = state.ledger.some(l => l.definitionId === def.id);
        if (hasLedger && ['triggerType', 'triggerEventId', 'triggerRef', 'redeemMode'].some(k => k in (c.body ?? {}))) return { status: 409, json: { error: 'definition_locked' } };
        if (c.body && ((c.body.title && !(c.body.title.en && c.body.title.sw)) || (c.body.terms && !(c.body.terms.en && c.body.terms.sw)))) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'title', code: 'required' }] } };
        Object.assign(def, c.body); return { status: 200, json: { definition: def } };
      });
    }],
    ['POST', /^\/admin\/reward-definitions\/([^/]+)\/(activate|pause|end)$/, (c, m) => {
      if (!rewardsOn()) return off();
      const d = needEvents(); if (d) return d;
      return idempotent(c, `defact|${m[1]}|${m[2]}`, () => { const def = defOf(m[1]); if (!def) return { status: 404, json: { error: 'definition_not_found' } }; if (def.status === 'ended') return { status: 409, json: { error: 'definition_ended' } }; def.status = m[2] === 'pause' ? 'paused' : m[2] === 'end' ? 'ended' : 'active'; return { status: 200, json: { definition: def } }; });
    }],
    ['GET', /^\/admin\/reward-ledger$/, c => {
      if (!rewardsOn()) return off();
      const d = needEvents(); if (d) return d;
      return { items: state.ledger.filter(l => (!c.query.definitionId || l.definitionId === c.query.definitionId) && (!c.query.entryType || l.entryType === c.query.entryType)), nextCursor: null };
    }],
    ['GET', /^\/admin\/reward-summary$/, () => {
      if (!rewardsOn()) return off();
      const d = needEvents(); if (d) return d;
      return { items: [{ definitionId: 'rwd_1', earned: 5, redeemed: 2, expired: 1, reversed: 1, capUsed: 3, needsReview: 1 }], mostEarnedThisWeek: [{ userId: 'usr_farm1', count: 4 }] };
    }],
    ['POST', /^\/admin\/reward-redemptions\/lookup$/, c => {
      if (!rewardsOn()) return off();
      const d = needEvents(); if (d) return d;
      return idempotent(c, `lookup|${Math.random()}`, () => {
        const r = state.redemptions.find(x => x.code === String(c.body?.code ?? '').toUpperCase());
        if (!r) return { status: 404, json: { error: 'code_not_found' } };
        const { code: _c, ...rest } = r; void _c;
        return { status: 200, json: { redemption: rest } };
      });
    }],
    ['POST', /^\/admin\/reward-redemptions\/([^/]+)\/(redeem|cancel)$/, (c, m) => {
      if (!rewardsOn()) return off();
      const d = needEvents(); if (d) return d;
      return idempotent(c, `red|${m[1]}|${m[2]}`, () => {
        const r = state.redemptions.find(x => x.id === m[1]);
        if (!r) return { status: 404, json: { error: 'redemption_not_found' } };
        if (r.status !== 'reserved') return { status: 409, json: { error: 'already_redeemed' } };
        r.status = m[2] === 'redeem' ? 'redeemed' : 'cancelled'; r.note = c.body?.note ?? null;
        return { status: 200, json: { redemption: r } };
      });
    }],
    ['GET', /^\/admin\/event-award-tasks$/, c => { if (!rewardsOn()) return off(); const d = needEvents(); if (d) return d; return { items: state.tasks.filter(t => !c.query.state || t.state === c.query.state), nextCursor: null }; }],
    ['POST', /^\/admin\/event-award-tasks\/([^/]+)\/retry$/, (c, m) => {
      if (!rewardsOn()) return off();
      const d = needEvents(); if (d) return d;
      return idempotent(c, `retry|${m[1]}`, () => { const t = state.tasks.find(x => x.id === m[1]); if (!t) return { status: 404, json: { error: 'task_not_found' } }; t.state = 'pending'; return { status: 200, json: { task: t } }; });
    }],
    // ── admin result exceptions ──
    ['GET', /^\/admin\/events\/([^/]+)\/results\/summary$/, (_c, m) => { if (!on()) return off(); const d = needEvents(); if (d) return d; return eventOk(m[1]) ? summaryFor() : noEvent(); }],
    ['GET', /^\/admin\/events\/([^/]+)\/results$/, (c, m) => {
      if (!on()) return off();
      const d = needEvents(); if (d) return d;
      if (!eventOk(m[1])) return noEvent();
      const q = (c.query.q ?? '').toLowerCase();
      return { ...pageOf(state.regs.filter(r => r.status === 'confirmed').map(r => rowOf(r, state.results[r.id])).filter(r => !q || `${r.displayName} ${r.bibNumber}`.toLowerCase().includes(q)), c), counts: {} };
    }],
    ['POST', /^\/admin\/events\/([^/]+)\/results\/([^/]+)\/(correct|disqualify)$/, (c, m) => {
      if (!on()) return off();
      const d = needEvents(); if (d) return d;
      return idempotent(c, `admin|${m[2]}|${m[3]}`, () => {
        const res = resByResultId(m[2]); const bad = needRevision(c, res); if (bad) return bad;
        if (!(m[3] === 'correct' ? ['timing_error', 'wrong_bib', 'late_finish_data', 'other'] : DQ_REASONS).includes(c.body?.reasonCode) || !note(c, 10, 300)) return { status: 422, json: { error: 'validation_failed', fields: [{ path: 'note', code: 'invalid' }] } };
        if (m[3] === 'correct') { const net = c.body.netTime ? parseMs(c.body.netTime) : null; bump(res!, { verificationStatus: 'corrected', ...(typeof net === 'number' ? { netMs: net } : {}) }, c.body.reasonCode, 'FitFlex admin'); }
        else bump(res!, { verificationStatus: 'disqualified', finishStatus: 'dq' }, c.body.reasonCode, 'FitFlex admin');
        audit('events.admin_result_exception', { actorType: 'admin' });
        return { status: 200, json: { result: { id: res!.id, revision: res!.revision } } };
      });
    }],
  ];
  return { routes, flags, state, status };
}
