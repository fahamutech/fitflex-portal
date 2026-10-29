// A mock of the Partner photos admin API (functions#277, docs/partner-media-api.md) for
// tests/e2e/partner-media.spec.ts. Nothing reaches a real backend: every route is answered from
// in-memory state and every request is recorded. Also answers the gyms, trainers and vendors list
// routes the admin pages need.
import type { Page } from '@playwright/test';
import { API, png, type Json } from './hero-mock';

export { API, png, signInAs, staff, SUPER_ADMIN } from './hero-mock';

const PREVIEW_PNG = png(48, 32, { rgb: [30, 70, 110] });

export const GYM = { id: 'gym_1', name: 'Kinondoni Fit', tier: 'standard', location: 'Dar es Salaam', perVisitRate: 5000, commissionRate: 12, status: 'active', verified: true };
export const TRAINER = { id: 'tp_1', userId: 'usr_tr', displayName: 'Juma Coach', email: 'juma@fitflex.test', status: 'active', gymIds: [], specialties: [] };
export const VENDOR = {
  id: 'usr_vendor', displayName: 'Neema', email: 'neema@fitflex.test', userType: 'vendor', approvalStatus: 'approved', accountStatus: 'active',
  kycExempt: true, commissionPct: 10, productCount: 3, pendingProductCount: 0, vendorProfile: { businessName: 'Neema Supplements' },
};

let seqId = 0;
/** One MediaItem, admin view. */
export function media(id: string, over: Json = {}): Json {
  const kind = over.kind ?? 'hero';
  const status = over.status ?? 'live';
  return {
    id, kind, subject: { type: 'gym', id: GYM.id, name: GYM.name }, status, origin: 'partner',
    review: { state: 'to_review', at: null, by: null, byName: null }, takedown: null,
    width: kind === 'hero' ? 2160 : 512, height: kind === 'hero' ? 1440 : 512,
    ...(kind === 'hero' ? { focal: { x: 0, y: 0 }, bright: false } : { plate: 'light', plateChoice: 'auto' }),
    files: null, bytes: null,
    uploadedBy: 'usr_owner', uploadedByName: 'Asha Owner', uploadedByRole: 'gym_operator',
    confirmationVersion: '2026-10-29.draft1', rightsConfirmedBy: 'usr_owner', rightsConfirmedAt: '2026-10-28T07:00:00.000Z', rightsConfirmedByName: 'Asha Owner',
    ...(kind === 'logo' ? { ownLogoConfirmedBy: 'usr_owner', ownLogoConfirmedAt: '2026-10-28T07:00:00.000Z', ownLogoConfirmedByName: 'Asha Owner' } : {}),
    revision: 1, createdAt: '2026-10-28T07:00:00.000Z', updatedAt: '2026-10-28T07:00:00.000Z',
    ownUpload: false, previewUrl: status === 'live' ? `/admin/partner-media/${id}/preview` : null, statusChangedAt: null,
    ...over,
  };
}

export const ADMIN_CONFIRMATION = {
  adminConfirmation: {
    version: '2026-10-29.draft1', status: 'draft_pending_counsel',
    rights: { en: "FitFlex has the right to use this image, and it may show on this partner's home in the app.", sw: 'FitFlex ina haki ya kutumia picha hii, na inaweza kuonyeshwa kwenye ukurasa wa mwanzo wa mshirika huyu kwenye app.' },
    partnerLogo: { en: "This is this partner's own logo, and they have agreed to its use.", sw: 'Hii ni nembo ya mshirika huyu mwenyewe, na amekubali itumike.' },
  },
  limits: {
    hero: { minWidth: 1080, maxBytes: 15728640, types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] },
    logo: { minSide: 256, maxBytes: 2097152, types: ['image/png', 'image/jpeg', 'image/webp'] },
  },
};

export type Call = { method: string; path: string; query: Record<string, string>; body: Json | null; authorization?: string; contentType?: string; raw?: Buffer };

export type PmState = {
  items: Json[];
  calls: Call[];
  previews: Array<{ path: string; authorization?: string }>;
  /** One-shot error answers by route key ('list' | 'reviewed' | 'takeDown' | 'set' | 'confirmation'). */
  fail: Record<string, Array<{ status: number; json: Json }>>;
  confirmation: Json;
};

export function seed(over: Partial<PmState> = {}): PmState {
  return {
    items: [
      // Oldest first is the server's job; the mock answers in createdAt order for To review.
      media('pm_old', { createdAt: '2026-10-27T06:00:00.000Z' }),
      media('pm_logo', { kind: 'logo', subject: { type: 'vendor', id: VENDOR.id, name: VENDOR.vendorProfile.businessName }, uploadedByRole: 'vendor', uploadedByName: 'Neema', createdAt: '2026-10-28T06:00:00.000Z' }),
      media('pm_fitflex', { origin: 'fitflex', review: { state: 'reviewed', at: '2026-10-28T09:00:00.000Z', by: 'admin-2', byName: 'Neema O.' }, uploadedByRole: 'admin', uploadedByName: 'Neema O.', subject: { type: 'trainer', id: TRAINER.id, name: TRAINER.displayName }, createdAt: '2026-10-28T09:00:00.000Z' }),
      media('pm_down', {
        status: 'taken_down', previewUrl: null,
        takedown: { reason: 'other', note: 'Shows a phone number.', at: '2026-10-26T10:00:00.000Z', by: 'admin-2', byName: 'Neema O.' },
        createdAt: '2026-10-25T06:00:00.000Z', statusChangedAt: '2026-10-26T10:00:00.000Z',
      }),
    ],
    calls: [],
    previews: [],
    fail: {},
    confirmation: ADMIN_CONFIRMATION,
    ...over,
  };
}

const failOnce = (s: PmState, k: string) => s.fail[k]?.shift();

function listFor(s: PmState, q: Record<string, string>) {
  const tab = q.tab || 'to_review';
  let rows = s.items.filter(i => (
    tab === 'to_review' ? i.status === 'live' && i.origin === 'partner' && i.review.state === 'to_review'
      : tab === 'live' ? i.status === 'live' : i.status === 'taken_down'));
  const type = q.subjectType || q.type;
  if (type) rows = rows.filter(i => i.subject.type === type);
  if (q.kind) rows = rows.filter(i => i.kind === q.kind);
  if (q.subjectId) rows = rows.filter(i => i.subject.id === q.subjectId);
  if (q.q) rows = rows.filter(i => String(i.subject.name).toLowerCase().includes(q.q.toLowerCase()));
  rows = [...rows].sort((a, b) => (tab === 'to_review' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
  const limit = Number(q.limit) || 25;
  const offset = Number(q.cursor) || 0;
  const page = rows.slice(offset, offset + limit);
  return { items: page, total: rows.length, next: offset + page.length < rows.length ? offset + page.length : null };
}

/** Routes every API call to the fake. `serverOff`: every partner-media route answers 404 feature_disabled. */
export async function mockPartnerMediaApi(page: Page, s: PmState, opts: { serverOff?: boolean } = {}) {
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const query = Object.fromEntries(url.searchParams.entries());
    const ct = req.headers()['content-type'] || '';
    const body = method !== 'GET' && ct.includes('application/json') ? (req.postDataJSON() as Json | null) : null;

    if (path.startsWith('/admin/partner-media')) {
      if (opts.serverOff) return route.fulfill({ status: 404, json: { error: 'feature_disabled' } });
      if (!req.headers().authorization) return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
      const preview = path.match(/^\/admin\/partner-media\/([^/]+)\/preview$/);
      if (preview) {
        s.previews.push({ path: path + url.search, authorization: req.headers().authorization });
        return route.fulfill({ status: 200, contentType: 'image/png', body: PREVIEW_PNG, headers: { 'cache-control': 'no-store, private' } });
      }
      const call: Call = { method, path, query, body, authorization: req.headers().authorization, contentType: ct };
      if (method === 'POST' && path === '/admin/partner-media') call.raw = req.postDataBuffer() ?? Buffer.alloc(0);
      s.calls.push(call);

      if (path === '/admin/partner-media/confirmation') {
        const f = failOnce(s, 'confirmation');
        return f ? route.fulfill(f) : route.fulfill({ json: s.confirmation });
      }
      if (path === '/admin/partner-media' && method === 'GET') {
        const f = failOnce(s, 'list');
        return f ? route.fulfill(f) : route.fulfill({ json: listFor(s, query) });
      }
      if (path === '/admin/partner-media' && method === 'POST') {
        const f = failOnce(s, 'set');
        if (f) return route.fulfill(f);
        const text = (call.raw ?? Buffer.alloc(0)).toString('latin1');
        const field = (n: string) => text.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`))?.[1];
        const kind = field('kind') ?? 'hero';
        const subject = { type: field('subjectType'), id: field('subjectId'), name: null as string | null };
        subject.name = subject.type === 'gym' ? GYM.name : subject.type === 'trainer' ? TRAINER.displayName : VENDOR.vendorProfile.businessName;
        for (const i of s.items) if (i.status === 'live' && i.kind === kind && i.subject.id === subject.id) { i.status = 'replaced'; i.previewUrl = null; }
        const created = media(`pm_new_${++seqId}`, {
          kind, subject, origin: 'fitflex', review: { state: 'reviewed', at: '2026-10-29T08:00:00.000Z', by: 'admin-1', byName: 'Local Admin' },
          uploadedByRole: 'admin', uploadedByName: 'Local Admin', createdAt: '2026-10-29T08:00:00.000Z', ownUpload: true,
          ...(kind === 'logo' ? { plateChoice: field('plate') ?? 'auto', plate: field('plate') === 'dark' ? 'dark' : 'light' } : { focal: { x: Number(field('focalX') ?? 0), y: Number(field('focalY') ?? 0) } }),
        });
        s.items.push(created);
        return route.fulfill({ status: 201, json: { item: created } });
      }
      const reviewed = path.match(/^\/admin\/partner-media\/([^/]+)\/reviewed$/);
      if (reviewed && method === 'POST') {
        const f = failOnce(s, 'reviewed');
        if (f) return route.fulfill(f);
        const item = s.items.find(i => i.id === reviewed[1]);
        if (!item || item.status !== 'live') return route.fulfill({ status: 404, json: { error: 'media_gone' } });
        if (body?.revision !== item.revision) return route.fulfill({ status: 409, json: { error: 'stale_revision', revision: item.revision } });
        Object.assign(item, { review: { state: 'reviewed', at: '2026-10-29T08:00:00.000Z', by: 'admin-1', byName: 'Local Admin' }, revision: item.revision + 1 });
        return route.fulfill({ json: { item } });
      }
      const down = path.match(/^\/admin\/partner-media\/([^/]+)\/take-down$/);
      if (down && method === 'POST') {
        const f = failOnce(s, 'takeDown');
        if (f) return route.fulfill(f);
        const item = s.items.find(i => i.id === down[1]);
        if (!item || item.status !== 'live') return route.fulfill({ status: 404, json: { error: 'media_gone' } });
        if (body?.revision !== item.revision) return route.fulfill({ status: 409, json: { error: 'stale_revision', revision: item.revision } });
        if (!body?.reason) return route.fulfill({ status: 400, json: { error: 'reason_required' } });
        if (body.reason === 'other' && !body.note) return route.fulfill({ status: 400, json: { error: 'note_required' } });
        Object.assign(item, {
          status: 'taken_down', previewUrl: null, revision: item.revision + 1, statusChangedAt: '2026-10-29T08:00:00.000Z',
          takedown: { reason: body.reason, note: body.note ?? null, at: '2026-10-29T08:00:00.000Z', by: 'admin-1', byName: 'Local Admin' },
        });
        return route.fulfill({ json: { item } });
      }
      return route.fulfill({ status: 404, json: { error: 'not_found' } });
    }

    // Admin pages around the dialog.
    if (path === '/admin/gyms') return route.fulfill({ json: [GYM] });
    if (path === `/gyms/${GYM.id}`) return route.fulfill({ json: { ...GYM, images: [] } });
    if (path === '/admin/gym-owners') return route.fulfill({ json: [] });
    if (path === '/admin/trainers') return route.fulfill({ json: query.refs === 'true' ? [] : [TRAINER] });
    if (path === '/admin/vendors') return route.fulfill({ json: [VENDOR] });
    if (path === '/admin/geo-areas' || path === '/shop/areas') return route.fulfill({ json: { areas: [] } });
    if (path === '/admin/settings/specialties') return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
}
