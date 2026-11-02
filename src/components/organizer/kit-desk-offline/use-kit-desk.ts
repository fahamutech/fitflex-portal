'use client';
// Events S7 offline kit desk (spec §3.1 to §3.12, §3.15): the desk's brain. One hook owns the saved list, the unsent scans, the clock guard, the
// worker, the heartbeat and the send loop. The server is the only authority: this hook only decides whether staff may hand a kit over RIGHT NOW from
// the saved list, writes that to durable storage BEFORE showing success, and sends it later.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { errorBody, errorCode } from '@/lib/events';
import { kitOfflineApi, type HeartbeatResult, type PrepareDeskBody, type PrepareDeskResult, type SnapshotHeader, type SnapshotPage, type SyncItem, type SyncResponse } from '@/lib/events-s7-api';
import { newIdempotencyKey } from '@/lib/events-ops';
import {
  DESK_BUILD, checkClock, decideScan, isBibException, newClientRef, normaliseRow, queueStats, stateForOutcome,
  type ClockCheck, type DeskRow, type LocalScan, type ScanDecision,
} from './desk-logic';
import {
  deleteScans, loadList, loadMeta, loadScans, putScan, requestPersistence, saveList, saveMeta, storageSupported, wipeList, type DeskMeta,
} from './desk-store';

export type DeskPhase = 'loading' | 'unsupported' | 'unprepared' | 'ready';
export type DeskMode = 'online' | 'offline' | 'weak';
const PAGE = '/organizer/kit-desk/';
const DAY = 86_400_000;
const WORKER = '/organizer/kit-desk/sw.js';

const isNetwork = (err: unknown) => !(err instanceof ApiError);
const monoNow = () => (typeof performance !== 'undefined' ? performance.now() : 0);

export interface PrepareInput { label: string; pointId: string; categoryId: string | null; eventTitle: string; bib: { prefix: string; padTo: number; start: number; end: number } | null; role: string | null; staffName: string | null; userId: string | null; points: Array<{ id: string; name: string }> }
export interface PrepareFailure { code: string; extra?: Record<string, unknown> }

export interface KitDeskApi {
  phase: DeskPhase; meta: DeskMeta | null; rows: DeskRow[]; scans: LocalScan[]; mode: DeskMode; online: boolean;
  listExpired: boolean; deskEnded: boolean; clock: ClockCheck; updateNeeded: boolean; swSupported: boolean; shellReady: boolean; swUpdate: boolean; persisted: boolean | null;
  sending: { done: number; total: number } | null; lastSummary: { accepted: number; review: number } | null; sendFailed: boolean;
  progress: { done: number; total: number } | null; stats: { pending: number; oldestPendingAt: string | null; review: number };
  prepare: (input: PrepareInput) => Promise<PrepareFailure | null>;
  decide: (text: string, fromCamera: boolean) => Promise<ScanDecision | { kind: 'blocked'; why: 'clock' | 'list' | 'desk' }>;
  handOver: (a: { row: DeskRow; method: 'scan' | 'manual'; payload?: string; manualReason?: string; pointId?: string; bib?: string; flagBib?: boolean }) => Promise<LocalScan>;
  sendNow: () => Promise<void>; clearSent: () => Promise<void>; discardUnsent: () => Promise<void>; removeList: () => Promise<void>; refreshDelta: () => Promise<void>;
  setPoint: (id: string) => void; applyUpdate: () => void; refreshShell: () => Promise<void>; reloadFromStorage: () => Promise<void>;
}

export function useKitDesk({ eventId, token, userId, enabled }: { eventId: string; token: string | null; userId: string | null; enabled: boolean }): KitDeskApi {
  const [phase, setPhase] = useState<DeskPhase>('loading');
  const [meta, setMeta] = useState<DeskMeta | null>(null);
  const [rows, setRows] = useState<DeskRow[]>([]);
  const [scans, setScans] = useState<LocalScan[]>([]);
  const [online, setOnline] = useState(true);
  const [weak, setWeak] = useState(false);
  const [updateNeeded, setUpdateNeeded] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const [swUpdate, setSwUpdate] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [lastSummary, setLastSummary] = useState<{ accepted: number; review: number } | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [tick, setTick] = useState(0);
  const metaRef = useRef<DeskMeta | null>(null);
  const scansRef = useRef<LocalScan[]>([]);
  const sendingRef = useRef(false);
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const failRef = useRef<number[]>([]);
  const createdRef = useRef<PrepareDeskResult | null>(null);
  const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

  const commitMeta = useCallback(async (next: DeskMeta) => { metaRef.current = next; setMeta(next); await saveMeta(next); }, []);
  const commitScans = useCallback((next: LocalScan[]) => { scansRef.current = next; setScans(next); }, []);

  // ── Load what is on this device ──
  const reloadFromStorage = useCallback(async () => {
    if (!storageSupported()) { setPhase('unsupported'); return; }
    try {
      const m = await loadMeta(eventId);
      // A crash during sending leaves rows marked `sending`: they are simply pending again (same clientRef, so the server dedupes).
      const stored = (await loadScans(eventId)).map(s => (s.state === 'sending' ? { ...s, state: 'pending' as const } : s));
      const cutoff = Date.now() - DAY;
      const stale = stored.filter(s => s.state !== 'pending' && s.state !== 'sending' && (s.outcomeAt ?? s.createdAt) < cutoff);
      if (stale.length) await deleteScans(stale.map(s => s.clientRef));
      const live = stored.filter(s => !stale.includes(s));
      commitScans(live);
      metaRef.current = m; setMeta(m);
      setRows(m && !m.listWiped ? await loadList(eventId) : []);
      setPhase(m ? 'ready' : 'unprepared');
    } catch { setPhase('unsupported'); }
  }, [eventId, commitScans]);
  useEffect(() => { if (enabled) void reloadFromStorage(); }, [enabled, reloadFromStorage]);

  // ── Connectivity ──
  useEffect(() => {
    const sync = () => { setOnline(typeof navigator === 'undefined' ? true : navigator.onLine); if (navigator.onLine) { failRef.current = []; setWeak(false); } };
    sync();
    window.addEventListener('online', sync); window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);
  useEffect(() => { const h = setInterval(() => setTick(n => n + 1), 15_000); return () => clearInterval(h); }, []);
  /** §3.14: two failed requests within 8 seconds move the desk to the saved list while the browser still says "online". */
  const noteContact = useCallback((ok: boolean) => {
    const now = Date.now();
    if (ok) { failRef.current = []; setWeak(false); return; }
    failRef.current = [...failRef.current.filter(t => now - t < 8000), now];
    if (failRef.current.length >= 2) setWeak(true);
  }, []);

  const mode: DeskMode = !online ? 'offline' : weak ? 'weak' : 'online';

  // ── Service worker (§3.14) ──
  useEffect(() => {
    if (!enabled || !swSupported) return;
    let live = true;
    const precache = async (reg: ServiceWorkerRegistration) => {
      const urls = [PAGE, ...performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/_next/static/'))];
      const target = reg.active ?? navigator.serviceWorker.controller;
      if (!target) return;
      await new Promise<void>(resolve => {
        const ch = new MessageChannel();
        const timer = setTimeout(resolve, 15_000);
        ch.port1.onmessage = e => { clearTimeout(timer); if (live && e.data?.type === 'shell-status' && e.data.cached) setShellReady(true); resolve(); };
        target.postMessage({ type: 'precache', urls }, [ch.port2]);
      });
    };
    navigator.serviceWorker.register(WORKER, { scope: PAGE }).then(async reg => {
      regRef.current = reg;
      if (reg.waiting && navigator.serviceWorker.controller) setSwUpdate(true);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) setSwUpdate(true); });
      });
      await navigator.serviceWorker.ready;
      await precache(reg);
      setTimeout(() => { if (live) void precache(reg); }, 3000); // late chunks (route code, fonts) that loaded after the first pass
    }).catch(() => undefined);
    return () => { live = false; };
  }, [enabled, swSupported]);

  const applyUpdate = useCallback(() => {
    if (sendingRef.current) return;
    const reg = regRef.current;
    navigator.serviceWorker?.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    if (reg?.waiting) reg.waiting.postMessage({ type: 'skip-waiting' }); else window.location.reload();
  }, []);
  const refreshShell = useCallback(async () => {
    const reg = regRef.current;
    try { await reg?.update(); } catch { /* offline */ }
    const target = reg?.active ?? navigator.serviceWorker?.controller;
    if (target) await new Promise<void>(resolve => { const ch = new MessageChannel(); const timer = setTimeout(resolve, 8000); ch.port1.onmessage = () => { clearTimeout(timer); resolve(); }; target.postMessage({ type: 'refresh-shell' }, [ch.port2]); });
    window.location.reload();
  }, []);

  // ── Derived ──
  const expired = (m: DeskMeta | null) => !!m && (m.status === 'expired' || Date.parse(m.expiresAt) < Date.now() - m.offsetMs);
  const listExpired = !!meta && (!meta.validUntil || Date.parse(meta.validUntil) < Date.now() - meta.offsetMs || meta.listWiped);
  const deskEnded = !!meta && (meta.status !== 'active' || expired(meta));
  // `tick` re-evaluates the clock guard every few seconds so a wrong clock shows without a scan.
  const clock = useMemo<ClockCheck>(() => (meta ? checkClock(meta.clock, Date.now(), monoNow(), meta.limits.clockToleranceSeconds) : { ok: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta, tick, scans.length]);
  const stats = useMemo(() => queueStats(scans), [scans]);

  // ── Prepare (§3.3, §3.4) ──
  const prepare = useCallback(async (input: PrepareInput): Promise<PrepareFailure | null> => {
    if (!token) return { code: 'unauthorized' };
    setProgress({ done: 0, total: 0 });
    try {
      const body: PrepareDeskBody = { label: input.label.trim(), clientKind: 'web', deskBuild: DESK_BUILD, ...(input.bib ? { bibRange: { ...(input.bib.prefix ? { prefix: input.bib.prefix } : {}), padTo: input.bib.padTo, start: input.bib.start, end: input.bib.end } } : {}) };
      // A failed download after the desk exists is retried on the SAME desk (never a second one): the created desk is kept until the list is saved.
      let created = createdRef.current;
      if (!created) { created = await kitOfflineApi.prepare(token, eventId, body, newIdempotencyKey()); createdRef.current = created; }
      const persistedNow = await requestPersistence(); setPersisted(persistedNow);
      let header: SnapshotHeader | null = null; const all: DeskRow[] = []; let cursor: string | null = null;
      for (let guard = 0; guard < 100; guard++) {
        const page: SnapshotPage = await kitOfflineApi.snapshot(token, eventId, { deviceId: created.device.id, limit: 1000, deskBuild: DESK_BUILD, ...(cursor ? { cursor } : {}), ...(input.categoryId ? { categoryId: input.categoryId } : {}) });
        header = header ?? page.header;
        for (const raw of page.rows ?? []) { const r = normaliseRow(raw); if (r) all.push(r); }
        setProgress({ done: all.length, total: header?.rowCount ?? all.length });
        cursor = page.nextCursor ?? null;
        if (!cursor) break;
      }
      if (!header) return { code: 'snapshot_failed' };
      const serverMs = Date.parse(created.serverTime || header.serverTime);
      const next: DeskMeta = {
        eventId, eventTitle: input.eventTitle, deskId: created.device.id, label: created.device.label, status: created.device.status, userId: input.userId, staffName: input.staffName, role: input.role,
        issuedAt: created.device.issuedAt, expiresAt: created.device.expiresAt, validUntil: header.validUntil, bibRange: created.device.bibRange, limits: created.limits,
        snapshotSeq: header.snapshotSeq, snapshotTakenAt: header.takenAt, rowCount: all.length, categoryId: input.categoryId,
        event: header.event, points: header.collectionPoints?.length ? header.collectionPoints : input.points, categories: header.categories ?? [], pointId: input.pointId,
        clock: { serverTimeMs: serverMs, deviceMs: Date.now(), mono: monoNow() }, offsetMs: Date.now() - serverMs, listWiped: false, discarded: 0, lastSentAt: null,
      };
      await saveList(eventId, all);
      setRows(all);
      await commitMeta(next);
      createdRef.current = null;
      setPhase('ready');
      noteContact(true);
      return null;
    } catch (err) {
      noteContact(!isNetwork(err));
      if (err instanceof ApiError) {
        const code = errorCode(err) ?? `http_${err.status}`;
        if (err.status === 426) setUpdateNeeded(true);
        return { code, extra: (errorBody<Record<string, unknown>>(err) ?? undefined) };
      }
      return { code: 'network' };
    } finally { setProgress(null); }
  }, [token, eventId, commitMeta, noteContact]);

  // ── Delta refresh and heartbeat (§3.4, §3.3) ──
  const applyContact = useCallback(async (res: { serverTime: string; deviceStatus?: HeartbeatResult['deviceStatus']; minDeskBuild?: string | number }) => {
    const m = metaRef.current; if (!m) return;
    const serverMs = Date.parse(res.serverTime);
    const next: DeskMeta = { ...m, ...(res.deviceStatus ? { status: res.deviceStatus } : {}), ...(Number.isFinite(serverMs) ? { clock: { serverTimeMs: serverMs, deviceMs: Date.now(), mono: monoNow() }, offsetMs: Date.now() - serverMs } : {}) };
    await commitMeta(next);
    if (res.minDeskBuild !== undefined && String(res.minDeskBuild) !== '' && Number(res.minDeskBuild) > Number(DESK_BUILD)) setUpdateNeeded(true);
  }, [commitMeta]);

  const heartbeat = useCallback(async () => {
    const m = metaRef.current; if (!token || !m || !navigator.onLine) return;
    const q = queueStats(scansRef.current);
    try {
      const res = await kitOfflineApi.heartbeat(token, eventId, { deviceId: m.deskId, pending: q.pending, oldestPendingAt: q.oldestPendingAt, discarded: m.discarded, deskBuild: DESK_BUILD, clockOffsetMs: m.offsetMs });
      noteContact(true); await applyContact(res);
    } catch (err) {
      noteContact(!isNetwork(err));
      if (err instanceof ApiError && err.status === 426) setUpdateNeeded(true);
    }
  }, [token, eventId, applyContact, noteContact]);

  const refreshDelta = useCallback(async () => {
    const m = metaRef.current; if (!token || !m || m.status !== 'active' || m.listWiped || !navigator.onLine) return;
    try {
      let cursor: string | null = null; let header: SnapshotHeader | null = null; const changed: DeskRow[] = []; const removed = new Set<string>();
      for (let guard = 0; guard < 100; guard++) {
        const page: SnapshotPage = await kitOfflineApi.snapshot(token, eventId, { deviceId: m.deskId, limit: 1000, deskBuild: DESK_BUILD, sinceSeq: m.snapshotSeq, ...(cursor ? { cursor } : {}), ...(m.categoryId ? { categoryId: m.categoryId } : {}) });
        header = header ?? page.header;
        for (const raw of page.rows ?? []) { const r = normaliseRow(raw); if (r) changed.push(r); }
        for (const id of page.removed ?? []) removed.add(id);
        cursor = page.nextCursor ?? null;
        if (!cursor) break;
      }
      noteContact(true);
      if (!header) return;
      const map = new Map(rowsRef.current.map(r => [r.registrationId, r]));
      for (const id of removed) map.delete(id);
      for (const r of changed) map.set(r.registrationId, r);
      const nextRows = Array.from(map.values());
      await saveList(eventId, nextRows); setRows(nextRows);
      const serverMs = Date.parse(header.serverTime);
      await commitMeta({ ...metaRef.current!, snapshotSeq: header.snapshotSeq, snapshotTakenAt: header.takenAt, validUntil: header.validUntil, rowCount: nextRows.length, event: header.event,
        ...(Number.isFinite(serverMs) ? { clock: { serverTimeMs: serverMs, deviceMs: Date.now(), mono: monoNow() }, offsetMs: Date.now() - serverMs } : {}) });
    } catch (err) {
      noteContact(!isNetwork(err));
      if (err instanceof ApiError && err.status === 426) setUpdateNeeded(true);
      if (err instanceof ApiError && errorCode(err) === 'device_not_active') await commitMeta({ ...metaRef.current!, status: 'revoked' });
    }
  }, [token, eventId, commitMeta, noteContact]);
  const rowsRef = useRef<DeskRow[]>([]);
  rowsRef.current = rows;

  useEffect(() => {
    if (phase !== 'ready' || !token) return;
    void heartbeat();
    const h = setInterval(() => { void heartbeat(); }, weak ? 8_000 : 30_000);
    const d = setInterval(() => { void refreshDelta(); }, 5 * 60_000);
    return () => { clearInterval(h); clearInterval(d); };
  }, [phase, token, weak, heartbeat, refreshDelta]);

  // ── Deciding a scan (§3.5) ──
  const decide = useCallback<KitDeskApi['decide']>(async (text, fromCamera) => {
    const m = metaRef.current;
    if (!m) return { kind: 'blocked', why: 'list' };
    // Guards first: stop, show the reason, store nothing.
    const c = checkClock(m.clock, Date.now(), monoNow(), m.limits.clockToleranceSeconds);
    if (!c.ok) return { kind: 'blocked', why: 'clock' };
    if (m.status !== 'active' || expired(m)) return { kind: 'blocked', why: 'desk' };
    if (m.listWiped || !m.validUntil || Date.parse(m.validUntil) < Date.now() - m.offsetMs) return { kind: 'blocked', why: 'list' };
    const hashes = new Map(rowsRef.current.map(r => [r.tokenHash, r]));
    const regs = new Map(scansRef.current.filter(s => s.state !== 'rejected').map(s => [s.registrationId, s]));
    return decideScan(text, fromCamera, hashes, regs);
  }, []);

  // ── Saving a provisional scan (§3.5 step 5, §3.15) ──
  const handOver = useCallback<KitDeskApi['handOver']>(async ({ row, method, payload, manualReason, pointId, bib, flagBib }) => {
    const m = metaRef.current!;
    const scan: LocalScan = {
      clientRef: newClientRef(), method, ...(method === 'scan' && payload ? { payload } : {}), registrationId: row.registrationId, tokenHash: row.tokenHash, name: row.name, bibNumber: row.bibNumber,
      ...(method === 'manual' && manualReason ? { manualReason } : {}), ...(pointId ? { collectionPointId: pointId } : {}), ...(row.kitSize ? { kitSize: row.kitSize } : {}),
      ...(bib ? { bibClaim: bib, bibFlagged: !!flagBib } : {}),
      claimedAt: new Date().toISOString(), mono: monoNow(), offsetMs: m.offsetMs, createdAt: Date.now(), state: 'pending',
    };
    await putScan(eventId, scan); // durable BEFORE the success text (AC-O5)
    commitScans([...scansRef.current, scan]);
    return scan;
  }, [eventId, commitScans]);

  // ── Sending (§3.6, §3.7) ──
  const wipeIfDone = useCallback(async () => {
    const m = metaRef.current; if (!m) return;
    const unsent = scansRef.current.some(s => s.state === 'pending' || s.state === 'sending');
    const ended = m.status !== 'active' || expired(m) || !m.validUntil || Date.parse(m.validUntil) < Date.now() - m.offsetMs;
    if (!unsent && ended && !m.listWiped) { await wipeList(eventId); setRows([]); await commitMeta({ ...m, listWiped: true, rowCount: 0 }); }
  }, [eventId, commitMeta]);

  const sendNow = useCallback(async () => {
    const m0 = metaRef.current;
    if (!token || !m0 || sendingRef.current) return;
    const pending = scansRef.current.filter(s => s.state === 'pending').sort((a, b) => (a.claimedAt < b.claimedAt ? -1 : 1));
    if (!pending.length) { await heartbeat(); return; }
    sendingRef.current = true; setSendFailed(false); setLastSummary(null);
    let done = 0; let accepted = 0; let review = 0; let failed = false;
    setSending({ done: 0, total: pending.length });
    try {
      const size = Math.max(1, m0.limits.syncBatch || 200);
      for (let i = 0; i < pending.length; i += size) {
        const batch = pending.slice(i, i + size);
        const refs = new Set(batch.map(b => b.clientRef));
        const marked = scansRef.current.map(s => (refs.has(s.clientRef) ? { ...s, state: 'sending' as const } : s));
        commitScans(marked);
        for (const s of marked) if (refs.has(s.clientRef)) await putScan(eventId, s);
        const m = metaRef.current!;
        const items: SyncItem[] = batch.map(s => ({
          clientRef: s.clientRef, method: s.method, ...(s.method === 'scan' ? { payload: s.payload } : { registrationId: s.registrationId, manualReason: s.manualReason }),
          ...(s.collectionPointId ? { collectionPointId: s.collectionPointId } : {}), ...(s.kitSize ? { kitSize: s.kitSize } : {}), ...(s.bibClaim ? { bibNumber: s.bibClaim } : {}), claimedAt: s.claimedAt,
        }));
        let res: SyncResponse;
        try {
          res = await kitOfflineApi.sync(token, eventId, { deviceId: m.deskId, batchId: newIdempotencyKey(), snapshotSeq: m.snapshotSeq, snapshotTakenAt: m.snapshotTakenAt ?? new Date(0).toISOString(), clockOffsetMs: m.offsetMs, deskBuild: DESK_BUILD, items });
          noteContact(true);
        } catch (err) {
          noteContact(!isNetwork(err));
          // Network error, 5xx, 429: back to pending with the same clientRef (§3.6). 426: the desk needs the new build.
          const back = scansRef.current.map(s => (refs.has(s.clientRef) && s.state === 'sending' ? { ...s, state: 'pending' as const } : s));
          commitScans(back); for (const s of back) if (refs.has(s.clientRef)) await putScan(eventId, s);
          if (err instanceof ApiError && err.status === 426) setUpdateNeeded(true);
          if (err instanceof ApiError && errorCode(err) === 'device_not_found') { /* shown through the failed banner */ }
          failed = true; break;
        }
        const by = new Map(res.results.map(r => [r.clientRef, r]));
        const nowMs = Date.now();
        const applied = scansRef.current.map(s => {
          const r = by.get(s.clientRef);
          if (!r) return refs.has(s.clientRef) && s.state === 'sending' ? { ...s, state: 'pending' as const } : s;
          let state = stateForOutcome(r.outcome);
          const bibOutcome = r.bib?.outcome;
          if (r.outcome === 'accepted' && isBibException(bibOutcome)) state = 'needs_review';
          return { ...s, state, outcome: r.outcome, ...(bibOutcome ? { bibOutcome } : {}), ...(state === 'pending' ? {} : { outcomeAt: nowMs }), warnings: r.warnings ?? [] };
        });
        commitScans(applied);
        for (const s of applied) if (by.has(s.clientRef)) await putScan(eventId, s);
        accepted += res.summary?.accepted ?? 0; review += (res.summary?.needsReview ?? 0) + (res.summary?.bibExceptions ?? 0);
        done += batch.length; setSending({ done, total: pending.length });
        await applyContact({ serverTime: res.serverTime, deviceStatus: res.deviceStatus, minDeskBuild: res.minDeskBuild });
        await commitMeta({ ...metaRef.current!, lastSentAt: Date.now() });
      }
    } finally {
      sendingRef.current = false; setSending(null);
    }
    setSendFailed(failed);
    if (!failed) setLastSummary({ accepted, review });
    await wipeIfDone();
    void heartbeat();
  }, [token, eventId, commitScans, commitMeta, applyContact, heartbeat, noteContact, wipeIfDone]);

  // §3.14: a reconnect sends what is waiting (the same clientRefs make a repeat harmless).
  const wasOnline = useRef(true);
  useEffect(() => {
    if (mode === 'online' && !wasOnline.current && phase === 'ready') {
      if (scansRef.current.some(s => s.state === 'pending')) void sendNow(); else { void heartbeat(); void refreshDelta(); }
    }
    wasOnline.current = mode === 'online';
  }, [mode, phase, sendNow, heartbeat, refreshDelta]);

  // Retry failed sends every 30 s while online ("We will try again").
  useEffect(() => {
    if (!sendFailed || mode !== 'online') return;
    const h = setTimeout(() => { void sendNow(); }, 30_000);
    return () => clearTimeout(h);
  }, [sendFailed, mode, sendNow]);

  // Wipe triggers that need no click (§3.11): list or desk ended with nothing unsent, and 7 days after the event.
  useEffect(() => { if (phase === 'ready') void wipeIfDone(); }, [phase, meta?.status, meta?.validUntil, scans.length, wipeIfDone]);

  const clearSent = useCallback(async () => {
    const gone = scansRef.current.filter(s => s.state === 'confirmed' || s.state === 'needs_review' || s.state === 'rejected');
    await deleteScans(gone.map(s => s.clientRef));
    commitScans(scansRef.current.filter(s => !gone.includes(s)));
  }, [commitScans]);
  const discardUnsent = useCallback(async () => {
    const gone = scansRef.current.filter(s => s.state === 'pending');
    await deleteScans(gone.map(s => s.clientRef));
    commitScans(scansRef.current.filter(s => !gone.includes(s)));
    const m = metaRef.current; if (m) await commitMeta({ ...m, discarded: m.discarded + gone.length });
    void heartbeat();
  }, [commitScans, commitMeta, heartbeat]);
  const removeList = useCallback(async () => {
    await wipeList(eventId); setRows([]);
    const m = metaRef.current; if (m) await commitMeta({ ...m, listWiped: true, rowCount: 0 });
  }, [eventId, commitMeta]);
  const setPoint = useCallback((id: string) => { const m = metaRef.current; if (m) void commitMeta({ ...m, pointId: id }); }, [commitMeta]);

  return {
    phase, meta, rows, scans, mode, online, listExpired, deskEnded, clock, updateNeeded, swSupported, shellReady, swUpdate, persisted, sending, lastSummary, sendFailed, progress, stats,
    prepare, decide, handOver, sendNow, clearSent, discardUnsent, removeList, refreshDelta, setPoint, applyUpdate, refreshShell, reloadFromStorage,
  };
}
