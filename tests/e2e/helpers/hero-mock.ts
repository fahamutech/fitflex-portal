// A mock of the App photos API (functions#216) for tests/e2e/hero-images.spec.ts. Nothing reaches a
// real backend: every route is answered from in-memory state and every write is recorded.
import { deflateSync } from 'node:zlib';
import type { Page, Request } from '@playwright/test';

export const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ── Real image bytes, so the browser can decode them ─────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** An RGB PNG of the given size. `noise` makes it large and incompressible (a realistic photo size). */
export function png(width: number, height: number, { noise = false, rgb = [40, 90, 60] as [number, number, number] } = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  let seed = 12345;
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * row + 1 + x * 3;
      if (noise) {
        for (let i = 0; i < 3; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; raw[o + i] = seed & 0xff; }
      } else { raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** A 1×1 GIF (a type the upload refuses). */
export const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const PREVIEW_PNG = png(48, 32, { rgb: [30, 70, 110] });

// ── Seed data ────────────────────────────────────────────────────────────────
export const AREAS = ['preSignIn', 'members', 'partners', 'footers', 'portal'];
type SlotDef = [id: string, area: string, variant: string, max?: number];
const SLOT_DEFS: SlotDef[] = [
  ['language', 'preSignIn', 'full'], ['signIn', 'preSignIn', 'full'], ['signUp', 'preSignIn', 'full'], ['role', 'preSignIn', 'compact'], ['pin', 'preSignIn', 'compact'],
  ['homeStart', 'members', 'full'], ['homePass', 'members', 'compact'], ['profile', 'members', 'compact'], ['upgrade', 'members', 'compact'],
  ['activityToday', 'members', 'compact'], ['activityTraining', 'members', 'compact'], ['activityChallenges', 'members', 'compact'], ['activityProgress', 'members', 'compact'],
  ['gyms', 'members', 'compact'], ['trainers', 'members', 'compact'], ['shop', 'members', 'compact'],
  ['trainer', 'partners', 'compact'], ['vendor', 'partners', 'compact'], ['owner', 'partners', 'compact'],
  ['footerPool', 'footers', 'band', 8], ['portalLogin', 'portal', 'panel', 1],
];
export const SLOT_IDS = SLOT_DEFS.map(d => d[0]);

export const image = (id: string, over: Json = {}): Json => ({
  id, sourceId: id, status: 'draft', width: 2160, height: 1440, focal: { x: 0, y: 0 }, focalX: 0, focalY: 0,
  variants: null, textZoneLuminance: { vertical: { mean: 0.1, maxPatch: 0.2 }, horizontal: { mean: 0.1, maxPatch: 0.2 } },
  brightWarning: { vertical: false, horizontal: false },
  source: 'FitFlex shoot', photographer: 'Asha M.', licence: 'Owned by FitFlex', licenceRef: null, people: 'none', consentRef: null,
  rightsConfirmedBy: 'admin-1', rightsConfirmedByName: 'Local Admin', rightsConfirmedAt: '2026-10-19T07:00:00.000Z',
  noFacesConfirmedBy: 'admin-1', noFacesConfirmedByName: 'Local Admin', noFacesConfirmedAt: '2026-10-19T07:00:00.000Z',
  createdBy: 'admin-1', createdByName: 'Local Admin', createdAt: '2026-10-19T07:00:00.000Z', updatedAt: '2026-10-19T07:00:00.000Z',
  previewUrl: `/admin/hero-images/${id}/preview`,
  ...over,
});

export type HeroState = {
  images: Json[];
  drafts: Record<string, string[]>;
  publications: Json[];
  extraSlots?: Json[];
  /** Error answers by route key ('upload' | 'patch' | 'slot' | 'publish' | 'rollback' | 'unpublish' | 'load'). */
  fail?: Record<string, { status: number; json: Json } | undefined>;
  calls: Array<{ method: string; path: string; body: Json | null; headers: Record<string, string> }>;
  upload?: { size: number; contentType: string; raw: Buffer; authorization: string };
  previewRequests: Array<{ path: string; authorization: string | undefined }>;
  /** Bytes served for every photo preview (default: a small slate-blue PNG). */
  previewPng?: Buffer;
  nextPublicationId?: number;
};

const live = (s: HeroState) => (s.publications[0]?.slots ?? {}) as Record<string, string[]>;

export function adminState(s: HeroState): Json {
  return {
    areas: AREAS,
    images: s.images.map(i => ({ ...i, live: Object.values(live(s)).some(ids => ids.includes(i.id)) })),
    slots: [
      ...SLOT_DEFS.map(([id, area, variant, max = 3]) => ({
        id, area, surface: id === 'portalLogin' ? 'portal' : 'mobile', variant, aspectHint: 1.5, maxImages: max,
        draft: s.drafts[id] ?? [], published: live(s)[id] ?? [], brightWarning: false,
      })),
      ...(s.extraSlots ?? []),
    ],
    publications: s.publications,
  };
}

/** Seeds: two photos; `gyms` live with photo A; `portalLogin` drafted with B (not published). */
export function seedState(over: Partial<HeroState> = {}): HeroState {
  return {
    images: [
      image('hero_a', { status: 'published', hasPublicFiles: true, photographer: 'Asha M.', source: 'FitFlex shoot', createdAt: '2026-10-18T07:00:00.000Z' }),
      image('hero_b', { photographer: 'Juma K.', source: 'Pexels', licence: 'Pexels licence', brightWarning: { vertical: true, horizontal: true }, createdAt: '2026-10-19T07:00:00.000Z' }),
    ],
    drafts: { gyms: ['hero_a'], portalLogin: ['hero_b'] },
    publications: [
      { id: 2, publishedBy: 'admin-1', publishedByName: 'Local Admin', publishedAt: '2026-10-18T09:30:00.000Z', note: 'Gyms photo', rolledBackFrom: null, slots: { gyms: ['hero_a'] } },
      { id: 1, publishedBy: 'admin-2', publishedByName: 'Neema O.', publishedAt: '2026-10-17T06:00:00.000Z', note: null, rolledBackFrom: null, slots: {} },
    ],
    calls: [],
    previewRequests: [],
    ...over,
  };
}

const headersOf = (r: Request) => r.headers();

/** Routes every API call to the fake. `serverOff` answers 404 feature_disabled on admin routes. */
export async function mockHeroApi(page: Page, s: HeroState, opts: { serverOff?: boolean; manifest?: Json } = {}) {
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const isJson = (req.headers()['content-type'] || '').includes('application/json');
    const body = method !== 'GET' && isJson ? (req.postDataJSON() as Json | null) : null;
    if (method !== 'GET') s.calls.push({ method, path, body, headers: headersOf(req) });
    const fail = (k: string) => s.fail?.[k];

    if (path === '/app/hero-images') return route.fulfill({ json: opts.manifest ?? { version: 0, slots: {} } });
    if (path.startsWith('/admin/hero-')) {
      if (opts.serverOff) return route.fulfill({ status: 404, json: { error: 'feature_disabled' } });
      if (!req.headers().authorization) return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    }

    const preview = path.match(/^\/admin\/hero-images\/([^/]+)\/preview$/);
    if (preview) {
      s.previewRequests.push({ path: path + url.search, authorization: req.headers().authorization });
      return route.fulfill({ status: 200, contentType: 'image/png', body: s.previewPng ?? PREVIEW_PNG, headers: { 'cache-control': 'no-store, private' } });
    }
    if (path === '/admin/hero-images' && method === 'GET') {
      const f = fail('load');
      return f ? route.fulfill(f) : route.fulfill({ json: adminState(s) });
    }
    if (path === '/admin/hero-images' && method === 'POST') {
      const raw = req.postDataBuffer() ?? Buffer.alloc(0);
      s.upload = { size: raw.length, contentType: req.headers()['content-type'] || '', raw, authorization: req.headers().authorization || '' };
      const f = fail('upload');
      if (f) return route.fulfill(f);
      const created = image('hero_new', { photographer: 'New Person', source: 'Partner gym', createdAt: '2026-10-19T10:00:00.000Z' });
      s.images.push(created);
      return route.fulfill({ status: 201, json: { image: created } });
    }
    const unpublish = path.match(/^\/admin\/hero-images\/([^/]+)\/unpublish$/);
    if (unpublish && method === 'POST') {
      const f = fail('unpublish');
      if (f) return route.fulfill(f);
      const id = unpublish[1];
      const removedFromSlots = Object.entries(live(s)).filter(([, v]) => v.includes(id)).map(([k]) => k);
      if (!removedFromSlots.length) return route.fulfill({ status: 409, json: { error: 'image_not_live' } });
      const slots = Object.fromEntries(Object.entries(live(s)).map(([k, v]) => [k, v.filter(x => x !== id)]).filter(([, v]) => v.length));
      const pub = { id: (s.nextPublicationId ??= 3), publishedBy: 'admin-1', publishedByName: 'Local Admin', publishedAt: '2026-10-19T11:00:00.000Z', note: null, rolledBackFrom: null, slots };
      s.nextPublicationId++;
      s.publications.unshift(pub);
      const img = s.images.find(i => i.id === id);
      if (img) img.unpublishedInPublication = pub.id;
      return route.fulfill({ status: 201, json: { publication: pub, removedFromSlots, rollbackBlockedBefore: pub.id } });
    }
    const one = path.match(/^\/admin\/hero-images\/([^/]+)$/);
    if (one && method === 'PATCH') {
      const f = fail('patch');
      if (f) return route.fulfill(f);
      const img = s.images.find(i => i.id === one[1])!;
      if (body?.focal) Object.assign(img, { focal: body.focal, focalX: body.focal.x, focalY: body.focal.y });
      for (const k of ['source', 'photographer', 'licence', 'licenceRef', 'people', 'consentRef']) if (body && k in body) img[k] = body[k];
      if (body?.status === 'retired') img.status = 'retired';
      return route.fulfill({ json: { image: img, ...(body?.status === 'retired' ? { inLiveSnapshot: false } : {}) } });
    }
    const slot = path.match(/^\/admin\/hero-slots\/([^/]+)$/);
    if (slot && method === 'PUT') {
      const f = fail('slot');
      if (f) return route.fulfill(f);
      s.drafts[slot[1]] = body?.imageIds ?? [];
      return route.fulfill({ json: { slot: { id: slot[1], draft: s.drafts[slot[1]] } } });
    }
    if (path === '/admin/hero-slots/publish') {
      const f = fail('publish');
      if (f) return route.fulfill(f);
      const pub = { id: (s.nextPublicationId ??= 3), publishedBy: 'admin-1', publishedByName: 'Local Admin', publishedAt: '2026-10-19T12:00:00.000Z', note: body?.note ?? null, rolledBackFrom: null, slots: Object.fromEntries(Object.entries(s.drafts).filter(([, v]) => v.length)) };
      s.nextPublicationId++;
      s.publications.unshift(pub);
      for (const ids of Object.values(s.drafts)) for (const id of ids) { const i = s.images.find(x => x.id === id); if (i && i.status === 'draft') Object.assign(i, { status: 'published', hasPublicFiles: true }); }
      return route.fulfill({ status: 201, json: { publication: pub } });
    }
    if (path === '/admin/hero-slots/rollback') {
      const f = fail('rollback');
      if (f) return route.fulfill(f);
      const target = s.publications.find(p => p.id === body?.publicationId)!;
      const pub = { id: (s.nextPublicationId ??= 3), publishedBy: 'admin-1', publishedByName: 'Local Admin', publishedAt: '2026-10-19T13:00:00.000Z', note: null, rolledBackFrom: target.id, slots: target.slots };
      s.nextPublicationId++;
      s.publications.unshift(pub);
      s.drafts = { ...target.slots };
      return route.fulfill({ status: 201, json: { publication: pub } });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
}

export const SUPER_ADMIN = { id: 'admin-1', userType: 'admin', email: 'admin@fitflex.test', displayName: 'Local Admin' };
export const staff = (scopes: string[]) => ({ id: 'staff-1', userType: 'admin', email: 'staff@fitflex.test', displayName: 'Staff', portalUser: true, aclPermissions: scopes });

export async function signInAs(page: Page, user: Json, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('locale', l as string);
  }, [user, locale] as const);
}
