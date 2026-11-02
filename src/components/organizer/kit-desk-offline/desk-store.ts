// Events S7 offline kit desk (spec §3.11, §3.12): durable local storage. The ticket list and the unsent scans are stored in IndexedDB encrypted with
// AES-GCM under a NON-EXTRACTABLE CryptoKey that lives in the same origin's IndexedDB. That protects against casual disk reading and other pages; it does
// not protect against someone who can use the signed-in browser profile, which is why the list is time-limited and wiped on sign-out (§3.12).
// Nothing here uses localStorage, cookies or the URL, and nothing is logged.
import type { BibRange, DeskStatus, OfflineLimits } from '@/lib/events-s7-api';
import type { ClockRef, DeskRow, LocalScan } from './desk-logic';

const DB_NAME = 'fitflex-kit-desk';
const DB_VERSION = 1;
const CHUNK = 1000;

/** Plain (not secret) facts about this desk. Anything personal lives in the encrypted list or scans. */
export interface DeskMeta {
  eventId: string; eventTitle: string; deskId: string; label: string; status: DeskStatus; userId: string | null; staffName: string | null; role: string | null;
  issuedAt: string; expiresAt: string; validUntil: string | null; bibRange: BibRange | null; limits: OfflineLimits;
  snapshotSeq: number; snapshotTakenAt: string | null; rowCount: number; categoryId: string | null;
  event: { status: string; timezone: string; kitProvided: boolean } | null;
  points: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }>; pointId: string;
  clock: ClockRef | null; offsetMs: number; listWiped: boolean; discarded: number; lastSentAt: number | null; organizerSuspended?: boolean;
}

export const storageSupported = () => typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('list')) db.createObjectStore('list');
      if (!db.objectStoreNames.contains('scans')) db.createObjectStore('scans', { keyPath: 'clientRef' }).createIndex('eventId', 'eventId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('blocked')); };
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}

let keyPromise: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const db = await openDb();
    const existing = await wrap(db.transaction('keys').objectStore('keys').get('main')) as CryptoKey | undefined;
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const tx = db.transaction('keys', 'readwrite');
    // add(), not put(): if two tabs raced, the first key wins and the second tab re-reads it.
    try { tx.objectStore('keys').add(key, 'main'); await done(tx); return key; }
    catch { const again = await wrap(db.transaction('keys').objectStore('keys').get('main')) as CryptoKey | undefined; if (again) return again; throw new Error('key'); }
  })();
  keyPromise.catch(() => { keyPromise = null; });
  return keyPromise;
}

async function seal(value: unknown): Promise<{ iv: ArrayBuffer; data: ArrayBuffer }> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: iv.buffer as ArrayBuffer, data };
}
async function open_<T>(rec: { iv: ArrayBuffer; data: ArrayBuffer }): Promise<T> {
  const key = await getKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(rec.iv) }, key, rec.data);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

/** §3.12: ask the browser not to evict the data. Resolves to whether it will persist; a refusal only shows a warning. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
  } catch { return false; }
}

// ── Meta ──
export async function loadMeta(eventId: string): Promise<DeskMeta | null> {
  const db = await openDb();
  return ((await wrap(db.transaction('meta').objectStore('meta').get(`desk:${eventId}`))) as DeskMeta | undefined) ?? null;
}
export async function saveMeta(meta: DeskMeta): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(meta, `desk:${meta.eventId}`);
  await done(tx);
}
export async function deleteMeta(eventId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').delete(`desk:${eventId}`);
  await done(tx);
}

// ── The ticket list (encrypted chunks) ──
export async function saveList(eventId: string, rows: DeskRow[]): Promise<void> {
  const chunks: Array<{ iv: ArrayBuffer; data: ArrayBuffer }> = [];
  for (let i = 0; i < rows.length; i += CHUNK) chunks.push(await seal(rows.slice(i, i + CHUNK)));
  const db = await openDb();
  const tx = db.transaction('list', 'readwrite');
  const store = tx.objectStore('list');
  store.delete(IDBKeyRange.bound(`${eventId}:`, `${eventId}:￿`));
  chunks.forEach((c, i) => store.put(c, `${eventId}:${String(i).padStart(6, '0')}`));
  await done(tx);
}
export async function loadList(eventId: string): Promise<DeskRow[]> {
  const db = await openDb();
  const recs = await wrap(db.transaction('list').objectStore('list').getAll(IDBKeyRange.bound(`${eventId}:`, `${eventId}:￿`))) as Array<{ iv: ArrayBuffer; data: ArrayBuffer }>;
  const out: DeskRow[] = [];
  for (const r of recs) out.push(...(await open_<DeskRow[]>(r)));
  return out;
}
/** Removes the saved list of one event and marks the desk. Unsent scans are NEVER touched (§3.11). */
export async function wipeList(eventId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['list', 'meta'], 'readwrite');
  tx.objectStore('list').delete(IDBKeyRange.bound(`${eventId}:`, `${eventId}:￿`));
  const metaStore = tx.objectStore('meta');
  const req = metaStore.get(`desk:${eventId}`);
  req.onsuccess = () => { const m = req.result as DeskMeta | undefined; if (m) metaStore.put({ ...m, listWiped: true, rowCount: 0 }, `desk:${eventId}`); };
  await done(tx);
}
/** Sign-out (§3.11): every saved list goes, every unsent scan stays. Safe to call when nothing is stored. */
export async function wipeAllListsOnSignOut(): Promise<void> {
  if (!storageSupported()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(['list', 'meta'], 'readwrite');
    tx.objectStore('list').clear();
    const metaStore = tx.objectStore('meta');
    const cur = metaStore.openCursor();
    cur.onsuccess = () => { const c = cur.result; if (c) { c.update({ ...(c.value as DeskMeta), listWiped: true, rowCount: 0 }); c.continue(); } };
    await done(tx);
  } catch { /* nothing to wipe, or storage blocked */ }
}

// ── Scans (the unsent queue) ──
interface ScanRecord { clientRef: string; eventId: string; state: LocalScan['state']; createdAt: number; outcomeAt: number | null; iv: ArrayBuffer; data: ArrayBuffer }
export async function putScan(eventId: string, scan: LocalScan): Promise<void> {
  const sealed = await seal(scan);
  const db = await openDb();
  const tx = db.transaction('scans', 'readwrite');
  const rec: ScanRecord = { clientRef: scan.clientRef, eventId, state: scan.state, createdAt: scan.createdAt, outcomeAt: scan.outcomeAt ?? null, ...sealed };
  tx.objectStore('scans').put(rec);
  await done(tx);
}
export async function loadScans(eventId: string): Promise<LocalScan[]> {
  const db = await openDb();
  const recs = await wrap(db.transaction('scans').objectStore('scans').index('eventId').getAll(eventId)) as ScanRecord[];
  const out: LocalScan[] = [];
  for (const r of recs) { try { out.push(await open_<LocalScan>(r)); } catch { /* an unreadable record is skipped, never deleted */ } }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}
export async function deleteScans(clientRefs: string[]): Promise<void> {
  if (!clientRefs.length) return;
  const db = await openDb();
  const tx = db.transaction('scans', 'readwrite');
  for (const r of clientRefs) tx.objectStore('scans').delete(r);
  await done(tx);
}
/** All events that still have unsent scans on this browser (used to keep a desk's meta when the list is wiped). */
export async function eventsWithScans(): Promise<string[]> {
  const db = await openDb();
  const recs = await wrap(db.transaction('scans').objectStore('scans').getAll()) as ScanRecord[];
  return Array.from(new Set(recs.filter(r => r.state === 'pending' || r.state === 'sending').map(r => r.eventId)));
}
