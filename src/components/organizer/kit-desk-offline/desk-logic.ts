// Events S7 offline kit desk (spec docs/design/events-s7-hardening-and-pilot.md §3.5 to §3.8, §3.15): the pure rules. No React, no storage, no
// network, no strings: the UI turns the returned codes into i18n keys. Everything here is a convenience for the person at the desk; the
// server re-verifies every item at sync and is the only thing that makes a handover official (§3.9).
import type { BibRange, RawSnapshotRow } from '@/lib/events-s7-api';

/** Sent as `deskBuild`; the server answers 426 `desk_update_required { minBuild }` for older builds (§3.3). */
export const DESK_BUILD = '1';
export const TICKET_PREFIX = 'FFEV1:';

/** One row of the downloaded ticket list, normalised. */
export interface DeskRow {
  registrationId: string; tokenHash: string; ticketCode: string; name: string; categoryId: string | null; categoryName: string | null; bibNumber: string | null;
  ticketActive: boolean; revokeReason: string | null; collected: boolean; collectedAt: string | null; collectionPointName: string | null; kitSize: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * §3.4: a row is `{ registrationId, tokenHash, ticketCode, name, categoryId, bibNumber, ticket: active|revoked (+ revokeReason), kit: collected (+ collectedAt,
 * collectionPointName) | not } `. The nesting is not fixed by the spec, so both flat and nested spellings are read; a row without a hash or an id is dropped.
 */
export function normaliseRow(raw: RawSnapshotRow): DeskRow | null {
  const registrationId = str(raw.registrationId) ?? str(raw.id);
  const tokenHash = (str(raw.tokenHash) ?? str(raw.hash))?.toLowerCase() ?? null;
  if (!registrationId || !tokenHash) return null;
  const ticket = obj(raw.ticket); const kit = obj(raw.kit);
  const ticketState = str(raw.ticket) ?? str(raw.ticketStatus) ?? str(ticket?.status) ?? str(ticket?.state) ?? 'active';
  const kitState = str(raw.kit) ?? str(raw.kitStatus) ?? str(kit?.status) ?? str(kit?.state) ?? (raw.collected === true ? 'collected' : 'not_collected');
  return {
    registrationId, tokenHash, ticketCode: str(raw.ticketCode) ?? '', name: str(raw.name) ?? str(raw.displayName) ?? '',
    categoryId: str(raw.categoryId), categoryName: str(raw.categoryName), bibNumber: str(raw.bibNumber) ?? str(raw.bib),
    ticketActive: ticketState === 'active', revokeReason: str(raw.revokeReason) ?? str(ticket?.revokeReason) ?? str(ticket?.reason),
    collected: kitState === 'collected', collectedAt: str(raw.collectedAt) ?? str(kit?.collectedAt), collectionPointName: str(raw.collectionPointName) ?? str(kit?.collectionPointName),
    kitSize: str(raw.kitSize) ?? str(kit?.kitSize),
  };
}

/** `FFEV1:<token>` or a bare `ev1.…` token → the token; anything else → null. */
export function tokenOf(text: string): string | null {
  const v = text.trim();
  if (v.startsWith(TICKET_PREFIX)) { const t = v.slice(TICKET_PREFIX.length).trim(); return t || null; }
  if (v.startsWith('ev1.')) return v;
  return null;
}
export const isEventTicketText = (text: string) => tokenOf(text) !== null;

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Local scans (the provisional records) ──
export type LocalState = 'pending' | 'sending' | 'confirmed' | 'needs_review' | 'rejected';
export interface LocalScan {
  clientRef: string; method: 'scan' | 'manual'; /** The scanned text: needed by the server for the MAC check; stored encrypted only. */ payload?: string;
  registrationId: string; tokenHash?: string; name: string; bibNumber?: string | null; manualReason?: string; collectionPointId?: string; kitSize?: string;
  /** The bib read off the physical bib (§3.15); never generated here. */ bibClaim?: string; bibFlagged?: boolean;
  claimedAt: string; mono: number; offsetMs: number; createdAt: number;
  state: LocalState; outcome?: string; bibOutcome?: string; outcomeAt?: number; warnings?: string[];
}

export type ScanDecision =
  | { kind: 'gym' } | { kind: 'unrecognised' } | { kind: 'unknown' }
  | { kind: 'revoked'; row: DeskRow } | { kind: 'already_list'; row: DeskRow } | { kind: 'already_local'; row: DeskRow; scan: LocalScan }
  | { kind: 'valid'; row: DeskRow; tokenText: string };

/** §3.5 steps 1, 4: what the saved list says about the scanned text. The caller has already passed the clock and list guards. */
export async function decideScan(text: string, fromCamera: boolean, byHash: Map<string, DeskRow>, byReg: Map<string, LocalScan>): Promise<ScanDecision> {
  const value = text.trim();
  const token = tokenOf(value);
  if (!token) return fromCamera || /^usr_/i.test(value) ? { kind: 'gym' } : { kind: 'unrecognised' };
  const hash = await sha256Hex(token);
  const row = byHash.get(hash);
  if (!row) return { kind: 'unknown' };
  if (!row.ticketActive) return { kind: 'revoked', row };
  const local = byReg.get(row.registrationId);
  if (local && local.state !== 'rejected') return { kind: 'already_local', row, scan: local };
  if (row.collected) return { kind: 'already_list', row };
  return { kind: 'valid', row, tokenText: value };
}

// ── Bib recording (§3.15) ──
export const BIB_RE = /^[A-Z0-9-]{1,12}$/;
export const normaliseBib = (v: string) => v.trim().toUpperCase();
export function formatBib(range: BibRange, n: number): string { return `${range.prefix ?? ''}${range.padTo > 0 ? String(n).padStart(range.padTo, '0') : String(n)}`; }
export function bibCount(range: Pick<BibRange, 'start' | 'end'>): number { return Math.max(0, range.end - range.start + 1); }
/** Whether `bib` is inside the desk's block (prefix, padding and numeric range all considered). */
export function bibInBlock(range: BibRange | null, bib: string): boolean {
  if (!range) return false;
  const prefix = range.prefix ?? '';
  if (!bib.startsWith(prefix)) return false;
  const digits = bib.slice(prefix.length);
  if (!/^\d+$/.test(digits)) return false;
  if (range.padTo > 0 && digits.length !== Math.max(range.padTo, String(Number(digits)).length)) return false;
  const n = Number(digits);
  return Number.isInteger(n) && n >= range.start && n <= range.end && formatBib(range, n) === bib;
}
export type BibCheck = { ok: true; bib: string } | { ok: false; code: 'invalid' | 'noBlock' | 'outOfRange' | 'usedHere' | 'otherPerson'; bib: string; at?: number };
/** §3.15 order: format, block, used on this desk, shown for someone else on the list. */
export function checkBib(input: string, range: BibRange | null, ownRegistrationId: string, byReg: Map<string, LocalScan>, rows: Iterable<DeskRow>): BibCheck {
  const bib = normaliseBib(input);
  if (!BIB_RE.test(bib)) return { ok: false, code: 'invalid', bib };
  if (!range) return { ok: false, code: 'noBlock', bib };
  if (!bibInBlock(range, bib)) return { ok: false, code: 'outOfRange', bib };
  for (const s of byReg.values()) if (s.registrationId !== ownRegistrationId && s.state !== 'rejected' && s.bibClaim === bib && !s.bibFlagged) return { ok: false, code: 'usedHere', bib, at: s.createdAt };
  for (const r of rows) if (r.registrationId !== ownRegistrationId && r.bibNumber === bib) return { ok: false, code: 'otherPerson', bib };
  return { ok: true, bib };
}

/** Live preview for the bib block form: "A0101 to A0150, 50 bibs". Null when the numbers are not a valid block. */
export function previewBlock(prefix: string, padTo: string, from: string, to: string): { first: string; last: string; count: number } | null {
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) return null;
  const start = Number(from), end = Number(to);
  const pad = padTo ? Number(padTo) : 0;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start + 1 > 5000 || pad < 0 || pad > 6) return null;
  const range: BibRange = { prefix, padTo: pad, start, end };
  return { first: formatBib(range, start), last: formatBib(range, end), count: bibCount(range) };
}
export const BIB_PREFIX_RE = /^[A-Z0-9-]{0,4}$/;

// ── Clock (§3.8) ──
/** The pieces the guard needs, kept in memory and in the desk meta. */
export interface ClockRef { serverTimeMs: number; deviceMs: number; mono: number }
export type ClockCheck = { ok: true } | { ok: false; reason: 'backwards' | 'drift'; expected: number; actual: number };
/** Guard for scanning only (sending is never blocked, §3.8). With no server reference the desk cannot scan. */
export function checkClock(ref: ClockRef | null, nowMs: number, nowMono: number, toleranceSeconds: number): ClockCheck {
  if (!ref) return { ok: false, reason: 'drift', expected: nowMs, actual: nowMs };
  const tol = toleranceSeconds * 1000;
  const monoElapsed = nowMono - ref.mono;
  const wallElapsed = nowMs - ref.deviceMs;
  const expected = ref.serverTimeMs + monoElapsed;
  // (a) the wall clock advanced less than the monotonic clock did (it was set back); 5 s of slack for rounding and slewing.
  if (wallElapsed < monoElapsed - 5000) return { ok: false, reason: 'backwards', expected, actual: nowMs };
  // (b) it is far from what the server said plus the time that has passed since.
  if (Math.abs(nowMs - expected) > tol) return { ok: false, reason: 'drift', expected, actual: nowMs };
  return { ok: true };
}

export const newClientRef = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);

/** Summary of the unsent queue for the sync bar and the heartbeat. */
export function queueStats(scans: LocalScan[]): { pending: number; oldestPendingAt: string | null; review: number } {
  const pending = scans.filter(s => s.state === 'pending' || s.state === 'sending');
  const oldest = pending.reduce<string | null>((a, s) => (a === null || s.claimedAt < a ? s.claimedAt : a), null);
  return { pending: pending.length, oldestPendingAt: oldest, review: scans.filter(s => s.state === 'needs_review').length };
}

/** §3.6: how a server outcome moves a scan. `deferred` returns to pending (retried with the same clientRef). */
export function stateForOutcome(outcome: string): LocalState {
  switch (outcome) {
    case 'accepted': return 'confirmed';
    case 'duplicate': case 'revoked_after_scan': case 'event_closed': case 'after_revoke': case 'organizer_suspended': return 'needs_review';
    case 'invalid_token': case 'unknown_ticket': case 'wrong_event': case 'validation_failed': return 'rejected';
    default: return 'pending';
  }
}
/** A bib outcome that puts an accepted scan into review (§3.15): everything but assigned, same_already and empty. */
export const isBibException = (o: string | null | undefined) => !!o && o !== 'assigned' && o !== 'same_already';
