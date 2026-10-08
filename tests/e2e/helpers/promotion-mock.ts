// One stateful fake of the moderation, promotion, campaign, limits, overview and analytics API,
// with switches for the awkward shapes a real server can send (deleted entities, missing fields,
// huge numbers, failures) so one place serves the hardening specs.
import { Page } from '@playwright/test';

export const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const iso = (d: string) => new Date(d).toISOString();
export const LONG = 'Supercalifragilisticexpialidocious'.repeat(3);          // 102 characters, no spaces
export const SUPER = { id: 'admin-1', userType: 'admin' };

export type Opts = {
  longNames: boolean;       // listing, campaign and partner names are very long and have no spaces
  nullEntity: boolean;      // every promotion's `entity` is null (the listing was deleted)
  sparse: boolean;          // optional arrays and objects are missing from responses
  big: boolean;             // analytics numbers in the millions
  failing: RegExp | null;   // GET/POST paths matching this answer 500 until `failing` is cleared
  slow: number;             // ms to hold every write, so a double click can be tried
  manyCampaigns: boolean;
  unverified: number | undefined; // `unverifiedEvents` on every analytics response (undefined = field missing, as from an older server)
};
export const defaults = (): Opts => ({ longNames: false, nullEntity: false, sparse: false, big: false, failing: null, slow: 0, manyCampaigns: false, unverified: undefined });

export type State = {
  opts: Opts; calls: Array<{ method: string; path: string; body: Json | null }>; promos: Json[]; campaigns: Json[]; limits: Json[]; me: string;
};

const ENTITY_NAME = (n: string, o: Opts) => (o.longNames ? `${LONG}-${n}` : n);
export function promo(over: Json = {}): Json {
  return {
    id: 'p1', entityType: 'gym', entityId: 'gym-1', type: 'featured', status: 'active', effectiveStatus: 'active', statusReason: null, campaignId: null, partnerRef: null,
    startsAt: iso('2026-10-01T08:00'), endsAt: iso('2036-10-31T08:00'), priority: 5, boostWeight: 1, geoScope: { areaIds: ['tz-znz'] }, audience: {}, categories: ['boxing'],
    isCommercial: false, relationshipType: 'editorial', commercialRef: null, disclosureLabel: null, notes: null, createdBy: 'maker-1', submittedBy: 'maker-1', approvedBy: 'checker-1',
    placements: ['gym_discovery', 'search_results'], label: 'Featured', entity: { id: 'gym-1', name: 'Zanzibar Iron', subtitle: 'Stone Town', status: 'active' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...over,
  };
}
export const AREAS = [
  { id: 'tz', level: 'country', name: 'Tanzania', parentId: null }, { id: 'tz-znz', level: 'region', name: 'Zanzibar', parentId: 'tz' },
  { id: 'tz-znz-city', level: 'city', name: 'Zanzibar City', parentId: 'tz-znz' }, { id: 'tz-dar', level: 'region', name: 'Dar es Salaam', parentId: 'tz' },
];
const PLACEMENTS = {
  gym_discovery: { label: 'Gym discovery', entityTypes: ['gym'] }, trainer_discovery: { label: 'Trainer discovery', entityTypes: ['trainer'] }, vendor_discovery: { label: 'Vendor discovery', entityTypes: ['vendor'] },
  marketplace: { label: 'Marketplace', entityTypes: ['product', 'vendor'] }, search_results: { label: 'Search results', entityTypes: ['gym', 'trainer', 'vendor', 'product'] },
  home: { label: 'Home', entityTypes: ['gym', 'trainer', 'vendor', 'product'] }, campaign_page: { label: 'Campaign page', entityTypes: ['gym', 'trainer', 'vendor', 'product'] },
};
export const ALL_ACTIONS = ['edit', 'submit', 'approve', 'reject', 'reopen', 'schedule', 'activate', 'pause', 'resume', 'cancel', 'complete', 'edit_live'];
const NEXT: Record<string, string> = { submit: 'pending_approval', approve: 'approved', reject: 'rejected', reopen: 'draft', schedule: 'scheduled', activate: 'active', pause: 'paused', resume: 'active', cancel: 'cancelled', complete: 'completed' };
const ZERO = { impressions: 0, searchAppearances: 0, clicks: 0, detailViews: 0, saves: 0, bookingClicks: 0, subscriptionClicks: 0, bookings: 0, subscriptions: 0, purchases: 0, purchaseValueTzs: 0, uniqueViewers: 0, clickThroughRate: null, viewRate: null, conversions: 0, conversionRate: null };

export function fresh(opts: Partial<Opts> = {}): State {
  const o = { ...defaults(), ...opts };
  const ent = (id: string, name: string, sub: string | null = null) => (o.nullEntity ? null : { id, name: ENTITY_NAME(name, o), subtitle: sub, status: 'active' });
  const camps = [{ id: 'camp-1', name: o.longNames ? `${LONG}${LONG}` : 'Zanzibar Fitness Week', description: o.longNames ? LONG.repeat(2) : 'A week of fitness', status: 'draft', statusReason: null, startsAt: iso('2030-01-01T08:00'), endsAt: iso('2030-01-08T08:00'), geoScope: { areaIds: ['tz-znz'] }, createdBy: 'a', createdAt: '', updatedAt: '' }];
  if (o.manyCampaigns) for (let i = 2; i < 40; i += 1) camps.push({ ...camps[0], id: `camp-${i}`, name: `Campaign ${i}` });
  return {
    opts: o, calls: [], me: 'admin-1',
    promos: [
      promo({ entity: ent('gym-1', 'Zanzibar Iron', 'Stone Town') }),
      promo({ id: 'p2', status: 'pending_approval', effectiveStatus: 'pending_approval', priority: 2, entityId: 'gym-2', entity: ent('gym-2', 'Masaki Fitness', 'Dar'), approvedBy: null, isCommercial: true, type: 'sponsored', relationshipType: 'paid_advertising', commercialRef: o.longNames ? LONG : 'INV-1', notes: o.longNames ? LONG.repeat(3) : null, statusReason: o.longNames ? LONG : null }),
      promo({ id: 'p3', status: 'draft', effectiveStatus: 'draft', entityId: 'gym-3', entity: ent('gym-3', 'Arusha Gym'), approvedBy: null }),
    ],
    campaigns: camps,
    limits: Object.keys(PLACEMENTS).flatMap(pl => ['featured', 'promoted', 'sponsored', 'recommended', 'campaign'].map(ty => ({
      placement: pl, label: pl, promotionType: ty, entityTypes: [], maxSlots: 5, source: pl === 'gym_discovery' ? 'config' : 'default', maxBoostFraction: 0.25, rotationMode: 'time_slice', rotationWindowMinutes: 60, used: 1,
    }))),
  };
}

const LISTINGS = (o: Opts) => [
  { id: 'gym-1', name: ENTITY_NAME('Zanzibar Iron', o), subtitle: o.longNames ? LONG : 'Stone Town', mod: 'pending', reason: o.longNames ? LONG.repeat(3) : 'Needs photos', decidedAt: '2026-10-08T10:00:00.000Z' },
  { id: 'gym-2', name: 'Masaki Fitness', subtitle: null, mod: 'pending', reason: null, decidedAt: null },
];

export async function setup(page: Page, state: State, user: Json = SUPER, locale = 'en') {
  state.me = user.id;
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'admin-e2e-token'); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('locale', l as string);
  }, [user, locale]);
  await page.route(`${API}/**`, async route => {
    const o = state.opts;
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const body = method === 'GET' ? null : (route.request().postDataJSON() as Json | null);
    if (method !== 'GET') state.calls.push({ method, path, body });
    if (o.failing && o.failing.test(path)) return route.fulfill({ status: 500, json: { error: 'boom' } });
    if (method !== 'GET' && o.slow) await new Promise(r => setTimeout(r, o.slow));
    const sp = url.searchParams;
    const cap = (n: number) => ({ placement: 'gym_discovery', type: 'featured', max: 5, used: n, available: 5 - n, full: n >= 5 });

    // Reference data
    if (path === '/admin/promotion-reference') return route.fulfill({ json: { entityTypes: ['gym', 'trainer', 'vendor', 'product'], promotionTypes: {}, relationshipTypes: {}, placements: PLACEMENTS, defaultLimits: {}, defaultMaxBoostFraction: 0.25, maxPriority: 100 } });
    if (path === '/admin/geo-areas') return route.fulfill({ json: { areas: AREAS } });
    if (path === '/admin/promotion-entities') {
      const items = sp.get('entityType') === 'gym' ? [
        { entityType: 'gym', id: 'gym-1', name: ENTITY_NAME('Zanzibar Iron', o), subtitle: o.longNames ? LONG : 'Stone Town', status: 'active', moderationStatus: 'approved', promotable: true, reasons: [], placements: ['gym_discovery', 'search_results', 'home', 'campaign_page'] },
        { entityType: 'gym', id: 'gym-9', name: ENTITY_NAME('Suspended Gym', o), subtitle: null, status: 'active', moderationStatus: 'suspended', promotable: false, reasons: ['moderation_suspended', 'some_unknown_code_that_is_long'], placements: ['gym_discovery'] },
      ] : [];
      return route.fulfill({ json: { items, total: items.length } });
    }
    if (path === '/admin/promotion-partners') return route.fulfill({ json: { items: [{ id: 'org-1', name: ENTITY_NAME('Safari Cover', o), legalName: 'Safari Insurance Ltd', type: 'insurer', status: 'active' }], total: 1 } });
    if (path === '/admin/promotion-preview') {
      const full = (body?.placements ?? []).length > 1;
      return route.fulfill({ json: { entity: { id: 'gym-1', name: 'Zanzibar Iron', subtitle: null, status: 'active' }, eligibility: { ok: true, reasons: [] }, capacity: [cap(full ? 5 : 2)], canApprove: !full, warnings: [] } });
    }
    if (path === '/admin/promotion-limits' && method === 'GET') return route.fulfill({ json: { limits: state.limits } });
    const putLimit = path.match(/^\/admin\/promotion-limits\/(\w+)\/(\w+)$/);
    if (putLimit && method === 'PUT') {
      const row = state.limits.find(l => l.placement === putLimit[1] && l.promotionType === putLimit[2])!;
      Object.assign(row, { maxSlots: body!.maxSlots, source: 'config' });
      return route.fulfill({ json: { limit: row } });
    }
    if (path === '/admin/promotion-overview') {
      return route.fulfill({ json: o.sparse ? { active: 1 } : { active: 1, scheduled: 0, paused: 0, drafts: 1, pendingPromotionRequests: 1, pendingModeration: 3, moderation: {},
        expiringSoon: [{ id: 'p1', entityType: 'gym', entityId: 'gym-1', type: 'featured', endsAt: iso('2026-10-12T08:00') }],
        recent: [{ id: 'a1', at: '2026-10-08T08:00:00Z', actor: o.longNames ? LONG : 'maker-1', action: 'promotion.submitted_for_something_with_a_long_name', target: 'p2', before: null, after: null }] } });
    }

    // Moderation
    if (path === '/admin/moderation') {
      const items = LISTINGS(o).filter(l => (!sp.get('status') || l.mod === sp.get('status')) && sp.get('entityType') === 'gym')
        .map(l => ({ entityType: 'gym', id: l.id, name: l.name, subtitle: l.subtitle, status: 'active', moderationStatus: l.mod, reason: l.reason, decidedBy: null, decidedAt: l.decidedAt }));
      return route.fulfill({ json: o.sparse ? { items } : { items, total: items.length, nextCursor: null, counts: { pending: items.length, approved: 0, rejected: 0, suspended: 0, hidden: 0 } } });
    }
    const modPost = path.match(/^\/admin\/moderation\/(\w+)\/([\w-]+)\/([\w-]+)$/);
    if (modPost && method === 'POST') return route.fulfill({ json: { entityType: 'gym', entityId: modPost[2], from: 'pending', to: 'approved', heldPromotions: 0 } });
    const modOne = path.match(/^\/admin\/moderation\/(\w+)\/([\w-]+)$/);
    if (modOne) {
      const l = LISTINGS(o).find(x => x.id === modOne[2])!;
      if (o.sparse) return route.fulfill({ json: { entityType: 'gym', summary: { id: l.id, name: l.name }, moderationStatus: 'pending', eligibility: { ok: false } } });
      return route.fulfill({ json: {
        entityType: 'gym', summary: { id: l.id, name: l.name, subtitle: l.subtitle, status: 'active' }, moderationStatus: 'pending', reason: l.reason, decidedBy: null, decidedAt: l.decidedAt,
        eligibility: { ok: false, reasons: ['moderation_pending', 'a_code_the_page_has_no_words_for_yet'] },
        history: [{ id: 'h1', entityType: 'gym', entityId: l.id, action: 'reject', fromStatus: 'pending', toStatus: 'rejected', reason: o.longNames ? LONG.repeat(3) : 'Photos missing', actor: o.longNames ? LONG : 'admin-1', at: '2026-10-08T10:00:00Z' }],
        allowedActions: [{ action: 'approve', reasonRequired: false }, { action: 'reject', reasonRequired: true }, { action: 'suspend', reasonRequired: true }, { action: 'hide', reasonRequired: true }, { action: 'require_review', reasonRequired: true }],
      } });
    }

    // Campaigns
    if (path === '/admin/promotion-campaigns' && method === 'GET') return route.fulfill({ json: { items: state.campaigns.map(c => ({ ...c, promotionCount: 2 })), total: state.campaigns.length } });
    if (path === '/admin/promotion-campaigns' && method === 'POST') {
      const c = { id: 'camp-new', status: 'draft', statusReason: null, createdBy: state.me, createdAt: '', updatedAt: '', ...body };
      state.campaigns.push(c); return route.fulfill({ status: 201, json: { campaign: c } });
    }
    const analyticsCamp = path.match(/^\/admin\/promotion-campaigns\/([\w-]+)\/analytics$/);
    if (analyticsCamp) return route.fulfill({ json: { campaign: state.campaigns[0], range: { from: sp.get('from'), to: sp.get('to') }, totals: o.big ? { ...ZERO, impressions: 12345678, clicks: 1000000 } : ZERO, items: [], notTracked: ['booking_conversions'], unverifiedEvents: o.unverified } });
    const camp = path.match(/^\/admin\/promotion-campaigns\/([\w-]+)(?:\/(start|end|cancel))?$/);
    if (camp) {
      const c = state.campaigns.find(x => x.id === camp[1]) ?? state.campaigns[0];
      if (camp[2]) {
        if (camp[2] === 'cancel' && !String(body?.reason || '').trim()) return route.fulfill({ status: 400, json: { error: 'reason_required' } });
        c.status = ({ start: 'active', end: 'ended', cancel: 'cancelled' } as Json)[camp[2]]; c.statusReason = body?.reason ?? null;
        return route.fulfill({ json: { campaign: c, openPromotions: [] } });
      }
      if (method === 'PATCH') { Object.assign(c, body); return route.fulfill({ json: { campaign: c } }); }
      return route.fulfill({ json: o.sparse ? { campaign: { ...c, geoScope: undefined, description: undefined } } : { campaign: c, promotions: state.promos } });
    }

    // Promotion analytics
    if (path === '/admin/promotion-analytics') {
      const m = o.big ? { ...ZERO, impressions: 12345678, clicks: 1234567, detailViews: 999999, saves: 1000000, bookingClicks: 1000000, subscriptionClicks: 1000000, purchases: 1000000, purchaseValueTzs: 9876543210, uniqueViewers: 5000000, clickThroughRate: 0.1, viewRate: 0.8 } : ZERO;
      const ref = (id: string, name: string) => ({ id, type: 'featured', status: 'active', entityType: 'gym', entityId: `e-${id}`, entityName: o.nullEntity ? null : ENTITY_NAME(name, o), startsAt: '2026-10-01T00:00:00Z', endsAt: '2036-10-01T00:00:00Z', campaignId: null, isCommercial: false });
      return route.fulfill({ json: { range: { from: sp.get('from'), to: sp.get('to') }, totals: m, items: [{ promotion: ref('p1', 'Zanzibar Iron'), ...m }, { promotion: ref('p2', 'Masaki Fitness'), ...ZERO }], notTracked: o.sparse ? undefined : ['booking_conversions', 'subscription_conversions'], unverifiedEvents: o.unverified } });
    }
    const an = path.match(/^\/admin\/promotions\/([\w-]+)\/analytics$/);
    if (an) {
      const from = sp.get('from')!; const to = sp.get('to')!;
      const daily: Json[] = []; for (let d = new Date(`${from}T00:00:00Z`), i = 0; d <= new Date(`${to}T00:00:00Z`) && i < 400; d.setUTCDate(d.getUTCDate() + 1), i += 1) daily.push({ day: d.toISOString().slice(0, 10), ...ZERO, impressions: o.big ? 400000 + i : 40, clicks: i % 3 ? 3 : 0 });
      const m = o.big ? { ...ZERO, impressions: 12345678, clicks: 1234567, purchaseValueTzs: 9876543210, purchases: 1000000, uniqueViewers: 5000000 } : { ...ZERO, impressions: 1200, clicks: 96, clickThroughRate: 0.08 };
      const promotion = { id: an[1], type: 'featured', status: 'active', entityType: 'gym', entityId: 'gym-1', entityName: o.nullEntity ? null : ENTITY_NAME('Zanzibar Iron', o), startsAt: '2026-10-01T00:00:00Z', endsAt: '2036-10-01T00:00:00Z', campaignId: null, isCommercial: false };
      if (o.sparse) return route.fulfill({ json: { promotion, range: { from, to }, totals: m, unverifiedEvents: o.unverified } });
      return route.fulfill({ json: { promotion, range: { from, to }, totals: m, daily,
        byPlacement: [{ placement: 'gym_discovery', ...m }, { placement: 'home', ...ZERO, impressions: 300 }, { placement: 'campaign_page', ...ZERO }],
        funnel: [{ step: 'impressions', count: m.impressions }, { step: 'clicks', count: m.clicks }, { step: 'detailViews', count: 60 }, { step: 'actionClicks', count: 25 }, { step: 'conversions', count: 0 }], notTracked: ['booking_conversions'], unverifiedEvents: o.unverified } });
    }

    // Promotions
    if (path === '/admin/promotions' && method === 'GET') return route.fulfill({ json: { items: state.promos, total: state.promos.length, nextCursor: null } });
    if (path === '/admin/promotions' && method === 'POST') {
      const p = promo({ id: 'p-new', status: 'draft', effectiveStatus: 'draft', ...body, entity: { id: body!.entityId, name: 'Zanzibar Iron', subtitle: null, status: 'active' }, createdBy: state.me, submittedBy: null, approvedBy: null });
      state.promos.push(p); return route.fulfill({ status: 201, json: { promotion: p } });
    }
    const one = path.match(/^\/admin\/promotions\/([\w-]+)(?:\/(\w+))?$/);
    if (one) {
      const p = state.promos.find(x => x.id === one[1]) ?? state.promos[0];
      const action = one[2];
      if (action) {
        if (['reject', 'cancel'].includes(action) && !String(body?.reason || '').trim()) return route.fulfill({ status: 400, json: { error: 'reason_required' } });
        p.status = NEXT[action]; p.effectiveStatus = p.status;
        return route.fulfill({ json: { promotion: p } });
      }
      if (method === 'PATCH') { Object.assign(p, body); return route.fulfill({ json: { promotion: p } }); }
      const history = [{ id: 'h1', at: '2026-10-08T10:00:00Z', actor: o.longNames ? LONG : 'maker-1', action: 'promotion.updated', target: p.id, before: { priority: 2 }, after: { priority: 5, reason: o.longNames ? LONG.repeat(3) : 'because' } }, { id: 'h2', at: '2026-10-08T09:00:00Z', actor: 'maker-1', action: 'promotion.created', target: p.id, before: null, after: null }];
      if (o.sparse) {
        const { categories: _c, placements: _p, geoScope: _g, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
        return route.fulfill({ json: { promotion: rest, eligibility: { ok: false }, allowedActions: ['approve'] } });
      }
      return route.fulfill({ json: { promotion: p, eligibility: { ok: false, reasons: ['moderation_suspended', 'a_code_the_page_has_no_words_for_yet'] }, capacity: [cap(2), { ...cap(5), placement: 'search_results' }], history, allowedActions: ALL_ACTIONS } });
    }
    return route.fulfill({ json: [] });
  });
}
