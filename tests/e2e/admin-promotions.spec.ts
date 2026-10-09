import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const iso = (d: string) => new Date(d).toISOString();
const promo = (over: Json = {}): Json => ({
  id: 'p1', entityType: 'gym', entityId: 'gym-1', type: 'featured', status: 'active', effectiveStatus: 'active', statusReason: null, campaignId: null, partnerRef: null,
  startsAt: iso('2026-10-01T08:00'), endsAt: iso('2036-10-31T08:00'), priority: 5, boostWeight: 1, geoScope: { areaIds: ['tz-znz'] }, audience: {}, categories: [],
  isCommercial: false, relationshipType: 'editorial', commercialRef: null, disclosureLabel: null, notes: null, createdBy: 'maker-1', submittedBy: 'maker-1', approvedBy: 'checker-1',
  placements: ['gym_discovery'], label: 'Featured', entity: { id: 'gym-1', name: 'Zanzibar Iron', subtitle: 'Stone Town', status: 'active' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...over,
});
const AREAS = [
  { id: 'tz', level: 'country', name: 'Tanzania', parentId: null }, { id: 'tz-znz', level: 'region', name: 'Zanzibar', parentId: 'tz' },
  { id: 'tz-znz-city', level: 'city', name: 'Zanzibar City', parentId: 'tz-znz' }, { id: 'tz-dar', level: 'region', name: 'Dar es Salaam', parentId: 'tz' },
];
const PLACEMENTS = { gym_discovery: { label: 'Gym discovery', entityTypes: ['gym'] }, trainer_discovery: { label: 'Trainer discovery', entityTypes: ['trainer'] },
  vendor_discovery: { label: 'Vendor discovery', entityTypes: ['vendor'] }, marketplace: { label: 'Marketplace', entityTypes: ['product', 'vendor'] },
  search_results: { label: 'Search results', entityTypes: ['gym', 'trainer', 'vendor', 'product'] }, home: { label: 'Home', entityTypes: ['gym', 'trainer', 'vendor', 'product'] },
  campaign_page: { label: 'Campaign page', entityTypes: ['gym', 'trainer', 'vendor', 'product'] } };

function actionsFor(p: Json): string[] {
  switch (p.status) {
    case 'draft': return ['edit', 'submit', 'cancel'];
    case 'pending_approval': return ['approve', 'reject', 'reopen', 'cancel'];
    case 'rejected': return ['reopen'];
    case 'approved': return ['schedule', 'activate', 'cancel', 'edit_live'];
    case 'scheduled': return ['activate', 'pause', 'cancel', 'edit_live'];
    case 'active': return ['pause', 'complete', 'cancel', 'edit_live'];
    case 'paused': return ['resume', 'cancel', 'edit_live'];
    default: return [];
  }
}
const NEXT: Record<string, string> = { submit: 'pending_approval', approve: 'approved', reject: 'rejected', reopen: 'draft', schedule: 'scheduled', activate: 'active', pause: 'paused', resume: 'active', cancel: 'cancelled', complete: 'completed' };

type State = {
  promos: Json[]; campaigns: Json[]; limits: Json[]; history: Json[]; calls: Array<{ method: string; path: string; body: Json | null }>; full: boolean; me: string;
};
const fresh = (): State => ({
  promos: [
    promo(),
    promo({ id: 'p2', status: 'pending_approval', effectiveStatus: 'pending_approval', priority: 2, entityId: 'gym-2', entity: { id: 'gym-2', name: 'Masaki Fitness', subtitle: 'Dar', status: 'active' }, createdBy: 'maker-1', submittedBy: 'maker-1', approvedBy: null }),
    promo({ id: 'p3', status: 'draft', effectiveStatus: 'draft', entityId: 'gym-3', entity: { id: 'gym-3', name: 'Arusha Gym', subtitle: null, status: 'active' }, approvedBy: null }),
    promo({ id: 'p4', status: 'active', effectiveStatus: 'expired', entityId: 'gym-4', entity: { id: 'gym-4', name: 'Late Gym', subtitle: null, status: 'active' } }),
  ],
  campaigns: [{ id: 'camp-1', name: 'Zanzibar Fitness Week', description: 'A week of fitness', status: 'draft', statusReason: null, startsAt: iso('2030-01-01T08:00'), endsAt: iso('2030-01-08T08:00'), geoScope: { areaIds: ['tz-znz'] }, createdBy: 'a', createdAt: '', updatedAt: '' }],
  limits: ['gym_discovery', 'trainer_discovery', 'vendor_discovery', 'marketplace', 'search_results', 'home', 'campaign_page'].flatMap(pl => ['featured', 'promoted', 'sponsored', 'recommended', 'campaign'].map(ty => ({
    placement: pl, label: pl, promotionType: ty, entityTypes: [], maxSlots: ty === 'featured' ? 5 : 10, source: pl === 'gym_discovery' && ty === 'featured' ? 'config' : 'default', maxBoostFraction: 0.25, rotationMode: 'time_slice', rotationWindowMinutes: 60, used: pl === 'gym_discovery' && ty === 'featured' ? 2 : 0,
  }))),
  history: [], calls: [], full: false, me: 'admin-1',
});

async function setup(page: Page, user: Json, state: State, locale = 'en') {
  state.me = user.id;
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'admin-e2e-token'); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('locale', l as string);
  }, [user, locale]);
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const body = method === 'GET' ? null : (route.request().postDataJSON() as Json | null);
    if (method !== 'GET') state.calls.push({ method, path, body });
    const capacity = () => (body?.placements ?? ['gym_discovery']).map((placement: string) => ({ placement, type: 'featured', max: 5, used: state.full ? 5 : 2, available: state.full ? 0 : 3, full: state.full }));

    if (path === '/admin/promotion-reference') return route.fulfill({ json: { entityTypes: ['gym', 'trainer', 'vendor', 'product'], promotionTypes: {}, relationshipTypes: {}, placements: PLACEMENTS, defaultLimits: {}, defaultMaxBoostFraction: 0.25, maxPriority: 100 } });
    if (path === '/admin/geo-areas') return route.fulfill({ json: { areas: AREAS } });
    if (path === '/admin/promotion-entities') {
      const type = url.searchParams.get('entityType');
      const all = type === 'gym' ? [
        { entityType: 'gym', id: 'gym-1', name: 'Zanzibar Iron', subtitle: 'Stone Town', status: 'active', moderationStatus: 'approved', promotable: true, reasons: [], placements: ['gym_discovery', 'search_results', 'home', 'campaign_page'] },
        { entityType: 'gym', id: 'gym-9', name: 'Suspended Gym', subtitle: null, status: 'active', moderationStatus: 'suspended', promotable: false, reasons: ['moderation_suspended'], placements: ['gym_discovery'] },
      ] : [{ entityType: 'trainer', id: 'tr-1', name: 'Trainer One', subtitle: 'boxing', status: 'active', moderationStatus: 'approved', promotable: true, reasons: [], placements: ['trainer_discovery', 'search_results'] }];
      const q = (url.searchParams.get('q') || '').toLowerCase();
      return route.fulfill({ json: { items: all.filter(e => !q || e.name.toLowerCase().includes(q)), total: all.length } });
    }
    if (path === '/admin/promotion-partners') return route.fulfill({ json: { items: [{ id: 'org-1', name: 'Safari Cover', legalName: 'Safari Insurance Ltd', type: 'insurer', status: 'active' }], total: 1 } });
    if (path === '/admin/promotion-preview') return route.fulfill({ json: { entity: { id: 'gym-1', name: 'Zanzibar Iron', subtitle: null, status: 'active' }, eligibility: { ok: true, reasons: [] }, capacity: capacity(), canApprove: !state.full, warnings: [] } });
    if (path === '/admin/promotion-limits' && method === 'GET') return route.fulfill({ json: { limits: state.limits } });
    const putLimit = path.match(/^\/admin\/promotion-limits\/(\w+)\/(\w+)$/);
    if (putLimit && method === 'PUT') {
      const row = state.limits.find(l => l.placement === putLimit[1] && l.promotionType === putLimit[2])!;
      Object.assign(row, { maxSlots: body!.maxSlots, maxBoostFraction: body!.maxBoostFraction, rotationMode: body!.rotationMode, rotationWindowMinutes: body!.rotationWindowMinutes, source: 'config' });
      return route.fulfill({ json: { limit: row } });
    }
    if (path === '/admin/promotion-overview') return route.fulfill({ json: { active: 1, scheduled: 0, paused: 0, drafts: 1, pendingPromotionRequests: 1, pendingModeration: 3, moderation: {}, expiringSoon: [{ id: 'p1', entityType: 'gym', entityId: 'gym-1', type: 'featured', endsAt: iso('2026-10-12T08:00') }], recent: [{ id: 'a1', at: '2026-10-08T08:00:00Z', actor: 'maker-1', action: 'promotion.submitted', target: 'p2', before: null, after: null }] } });

    // Campaigns
    if (path === '/admin/promotion-campaigns' && method === 'GET') return route.fulfill({ json: { items: state.campaigns.map(c => ({ ...c, promotionCount: state.promos.filter(p => p.campaignId === c.id).length })), total: state.campaigns.length } });
    if (path === '/admin/promotion-campaigns' && method === 'POST') {
      const c = { id: 'camp-2', status: 'draft', statusReason: null, createdBy: state.me, createdAt: '', updatedAt: '', ...body };
      state.campaigns.push(c); return route.fulfill({ status: 201, json: { campaign: c } });
    }
    const camp = path.match(/^\/admin\/promotion-campaigns\/([\w-]+)(?:\/(start|end|cancel))?$/);
    if (camp) {
      const c = state.campaigns.find(x => x.id === camp[1])!;
      if (camp[2]) {
        if (camp[2] === 'cancel' && !String(body?.reason || '').trim()) return route.fulfill({ status: 400, json: { error: 'reason_required' } });
        c.status = ({ start: 'active', end: 'ended', cancel: 'cancelled' } as Json)[camp[2]]; c.statusReason = body?.reason ?? null;
        return route.fulfill({ json: { campaign: c, openPromotions: camp[2] === 'cancel' ? state.promos.filter(p => p.campaignId === c.id).map(p => p.id) : [] } });
      }
      if (method === 'PATCH') { Object.assign(c, body); return route.fulfill({ json: { campaign: c } }); }
      return route.fulfill({ json: { campaign: c, promotions: state.promos.filter(p => p.campaignId === c.id) } });
    }

    // Promotions
    if (path === '/admin/promotions' && method === 'GET') return route.fulfill({ json: { items: state.promos, total: state.promos.length, nextCursor: null } });
    if (path === '/admin/promotions' && method === 'POST') {
      const p = promo({ id: 'p-new', status: 'draft', effectiveStatus: 'draft', ...body, entity: { id: body!.entityId, name: 'Zanzibar Iron', subtitle: null, status: 'active' }, createdBy: state.me, submittedBy: null, approvedBy: null, label: 'x' });
      state.promos.push(p); return route.fulfill({ status: 201, json: { promotion: p } });
    }
    const one = path.match(/^\/admin\/promotions\/([\w-]+)(?:\/(\w+))?$/);
    if (one) {
      const p = state.promos.find(x => x.id === one[1])!;
      const action = one[2];
      if (action) {
        if (['reject', 'cancel'].includes(action) && !String(body?.reason || '').trim()) return route.fulfill({ status: 400, json: { error: 'reason_required' } });
        if (action === 'approve' && (state.me === p.createdBy || state.me === p.submittedBy)) return route.fulfill({ status: 403, json: { error: 'cannot_approve_own_submission' } });
        if (action === 'approve' && state.full) return route.fulfill({ status: 409, json: { error: 'placement_full', capacity: [{ placement: 'gym_discovery', full: true }] } });
        const from = p.status;
        p.status = NEXT[action]; p.effectiveStatus = p.status; p.statusReason = body?.reason ?? null;
        if (action === 'submit') p.submittedBy = state.me;
        if (action === 'approve') p.approvedBy = state.me;
        state.history.unshift({ id: `h${state.history.length}`, at: '2026-10-08T10:00:00Z', actor: state.me, action: `promotion.${({ submit: 'submitted', approve: 'approved', reject: 'rejected', reopen: 'reopened', schedule: 'scheduled', activate: 'activated', pause: 'paused', resume: 'resumed', cancel: 'cancelled', complete: 'completed' } as Json)[action]}`, target: p.id, before: { status: from }, after: { status: p.status, reason: body?.reason ?? null } });
        return route.fulfill({ json: { promotion: p } });
      }
      if (method === 'PATCH') {
        const before = { priority: p.priority, endsAt: p.endsAt };
        Object.assign(p, body);
        state.history.unshift({ id: `h${state.history.length}`, at: '2026-10-08T11:00:00Z', actor: state.me, action: 'promotion.updated', target: p.id, before, after: { priority: p.priority, endsAt: p.endsAt } });
        return route.fulfill({ json: { promotion: p } });
      }
      return route.fulfill({ json: { promotion: p, eligibility: { ok: true, reasons: [] }, capacity: [{ placement: 'gym_discovery', type: 'featured', max: 5, used: 2, available: 3, full: false }], history: state.history.filter(h => h.target === p.id), allowedActions: actionsFor(p) } });
    }
    return route.fulfill({ json: [] });
  });
}
const SUPER = { id: 'admin-1', userType: 'admin' };
const staff = (id: string, ...scopes: string[]) => ({ id, userType: 'admin', portalUser: true, aclPermissions: scopes });

test('promotions are listed by what they are right now, with counts', async ({ page }) => {
  await setup(page, SUPER, fresh());
  await page.goto('/admin/promotions');
  await expect(page.getByTestId('promotion-tab-active')).toContainText('1');
  await expect(page.getByTestId('promotion-table')).toContainText('Zanzibar Iron');
  await expect(page.getByTestId('promotion-row-p4')).toHaveCount(0);            // stored active, but its end has passed: it is closed
  await page.getByTestId('promotion-tab-closed').click();
  await expect(page.getByTestId('promotion-table')).toContainText('Late Gym');
  await page.getByTestId('promotion-tab-requests').click();
  await expect(page.getByTestId('promotion-table')).toContainText('Masaki Fitness');
  await page.getByTestId('promotion-tab-draft').click();
  await expect(page.getByTestId('promotion-table')).toContainText('Arusha Gym');
  await page.getByTestId('promotion-tab-paused').click();
  await expect(page.getByTestId('promotion-empty')).toBeVisible();
});

test('the wizard walks through every step and sends a sponsored promotion for approval', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotions');
  await page.getByTestId('promotion-new').click();
  await expect(page).toHaveURL(/new=1/);

  // 1. Listing: one that cannot be promoted is shown with why, and cannot be chosen.
  await expect(page.getByTestId('wizard-next')).toBeDisabled();
  await expect(page.getByTestId('entity-gym-9')).toBeDisabled();
  await expect(page.getByTestId('entity-gym-9')).toContainText('Suspended in moderation');
  await page.getByTestId('entity-gym-1').click();
  await page.getByTestId('wizard-next').click();

  // 2. Type.
  await expect(page.getByTestId('wizard-next')).toBeDisabled();
  await page.getByTestId('type-sponsored').click();
  await page.getByTestId('wizard-next').click();

  // 3. Placement: only those that suit a gym.
  await expect(page.getByTestId('placement-trainer_discovery')).toHaveCount(0);
  await expect(page.getByTestId('wizard-next')).toBeDisabled();
  await page.getByTestId('placement-gym_discovery').check();
  await page.getByTestId('placement-home').check();
  await page.getByTestId('wizard-next').click();

  // 4. Targeting.
  await page.getByTestId('area-tz-znz').check();
  await page.getByTestId('wizard-categories').fill('boxing, yoga');
  await page.getByTestId('wizard-next').click();

  // 5. Schedule: an end before the start is refused.
  await page.getByTestId('wizard-start').fill('2030-01-08T10:00');
  await page.getByTestId('wizard-end').fill('2030-01-01T10:00');
  await expect(page.getByText('The end must be after the start, and in the future.')).toBeVisible();
  await expect(page.getByTestId('wizard-next')).toBeDisabled();
  await page.getByTestId('wizard-start').fill('2030-01-01T10:00');
  await page.getByTestId('wizard-end').fill('2030-01-31T10:00');
  await page.getByTestId('wizard-next').click();

  // 6. Priority.
  await page.getByTestId('wizard-priority').fill('0');
  await expect(page.getByTestId('wizard-next')).toBeDisabled();
  await page.getByTestId('wizard-priority').fill('2');
  await page.getByTestId('wizard-next').click();

  // 7. Commercial: sponsored is always commercial.
  await expect(page.getByText('A sponsored placement is always commercial.')).toBeVisible();
  await page.getByTestId('wizard-relationship').selectOption('paid_advertising');
  await page.getByTestId('wizard-partner-search').fill('safari');
  await page.getByTestId('partner-org-1').click();
  await expect(page.getByTestId('wizard-partner-selected')).toContainText('Safari Cover');
  await page.getByTestId('wizard-commercial-ref').fill('CONTRACT-77');
  await page.getByTestId('wizard-next').click();

  // 8. Review.
  await expect(page.getByTestId('wizard-summary')).toContainText('Zanzibar Iron');
  await expect(page.getByTestId('wizard-summary')).toContainText('Sponsored');
  await expect(page.getByTestId('wizard-summary')).toContainText('Zanzibar');
  await expect(page.getByTestId('wizard-summary')).toContainText('CONTRACT-77');
  await expect(page.getByTestId('wizard-preview')).toContainText('The listing can be promoted now.');
  await expect(page.getByTestId('capacity-list')).toContainText('2 / 5');
  await page.getByTestId('wizard-submit').click();

  await expect(page.getByTestId('promotion-detail')).toBeVisible();
  const create = state.calls.find(c => c.method === 'POST' && c.path === '/admin/promotions')!;
  expect(create.body).toMatchObject({
    entityType: 'gym', entityId: 'gym-1', type: 'sponsored', placements: ['gym_discovery', 'home'], priority: 2, boostWeight: 1,
    geoScope: { areaIds: ['tz-znz'] }, categories: ['boxing', 'yoga'], isCommercial: true, relationshipType: 'paid_advertising', partnerRef: 'org-1', commercialRef: 'CONTRACT-77',
    startsAt: new Date('2030-01-01T10:00').toISOString(), endsAt: new Date('2030-01-31T10:00').toISOString(),
  });
  expect(state.calls.some(c => c.path === '/admin/promotions/p-new/submit')).toBe(true);
});

test('a full placement is called out at review, but a draft can still be saved', async ({ page }) => {
  const state = { ...fresh(), full: true };
  await setup(page, SUPER, state);
  await page.goto('/admin/promotions?new=1');
  await page.getByTestId('entity-gym-1').click(); await page.getByTestId('wizard-next').click();
  await page.getByTestId('type-featured').click(); await page.getByTestId('wizard-next').click();
  await page.getByTestId('placement-gym_discovery').check(); await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-start').fill('2030-01-01T10:00'); await page.getByTestId('wizard-end').fill('2030-01-31T10:00'); await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('wizard-preview')).toContainText('A placement is full');
  await expect(page.getByTestId('capacity-list')).toContainText('Full');
  await page.getByTestId('wizard-save-draft').click();
  await expect(page.getByTestId('promotion-detail')).toBeVisible();
  expect(state.calls.some(c => c.path.endsWith('/submit'))).toBe(false);
});

test('someone else approves; the person who sent it cannot', async ({ page }) => {
  const state = fresh();
  await setup(page, staff('maker-1', 'promotions', 'promotions_approve'), state);
  await page.goto('/admin/promotions?item=p2');
  await expect(page.getByTestId('promotion-self-approval')).toBeVisible();
  await expect(page.getByTestId('promotion-action-approve')).toHaveCount(0);
  await expect(page.getByTestId('promotion-action-reject')).toBeVisible();
});

test('a checker approves, schedules and activates, and the history shows each step', async ({ page }) => {
  const state = fresh();
  await setup(page, staff('checker-2', 'promotions_approve'), state);
  await page.goto('/admin/promotions?item=p2');
  await expect(page.getByTestId('promotion-status')).toHaveText('Waiting for approval');
  await page.getByTestId('promotion-action-approve').click();
  await page.getByTestId('promotion-confirm').click();
  await expect(page.getByTestId('promotion-status')).toHaveText('Approved');
  await page.getByTestId('promotion-action-activate').click();
  await page.getByTestId('promotion-confirm').click();
  await expect(page.getByTestId('promotion-status')).toHaveText('Active');
  await expect(page.getByTestId('promotion-history')).toContainText('Went live');
  await expect(page.getByTestId('promotion-history')).toContainText('Approved');
  // This approver cannot create or edit.
  await expect(page.getByTestId('promotion-action-edit')).toHaveCount(0);
  await expect(page.getByTestId('promotion-action-pause')).toHaveCount(0);
});

test('rejecting and cancelling need a reason; a full placement is explained when approval is refused', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotions?item=p2');
  await page.getByTestId('promotion-action-reject').click();
  await expect(page.getByTestId('promotion-confirm')).toBeDisabled();
  await page.getByTestId('promotion-reason').fill('Wrong dates');
  await page.getByTestId('promotion-confirm').click();
  await expect(page.getByTestId('promotion-status')).toHaveText('Rejected');
  expect(state.calls.find(c => c.path.endsWith('/reject'))!.body).toEqual({ reason: 'Wrong dates' });

  const full = { ...fresh(), full: true };
  const page2 = await page.context().newPage();
  await setup(page2, SUPER, full);
  await page2.goto('/admin/promotions?item=p2');
  await page2.getByTestId('promotion-action-approve').click();
  await page2.getByTestId('promotion-confirm').click();
  await expect(page2.getByTestId('promotion-action-dialog')).toContainText('already full');
  await expect(page2.getByTestId('promotion-action-dialog')).toContainText('Gym discovery');
});

test('pausing and resuming; a live promotion\'s priority can change and the change is in the history', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotions?item=p1');
  await expect(page.getByTestId('promotion-priority')).toHaveText('5');
  await page.getByTestId('promotion-action-pause').click();
  await page.getByTestId('promotion-reason').fill('Dispute');
  await page.getByTestId('promotion-confirm').click();
  await expect(page.getByTestId('promotion-status')).toHaveText('Paused');
  await page.getByTestId('promotion-action-resume').click();
  await page.getByTestId('promotion-confirm').click();
  await expect(page.getByTestId('promotion-status')).toHaveText('Active');

  await page.getByTestId('promotion-action-edit_live').click();
  await page.getByTestId('live-priority').fill('2');
  await page.getByTestId('live-save').click();
  await expect(page.getByTestId('promotion-priority')).toHaveText('2');
  await expect(page.getByTestId('promotion-history')).toContainText('Priority: 5 → 2');
  expect(state.calls.find(c => c.method === 'PATCH')!.body).toMatchObject({ priority: 2 });
});

test('a draft can be edited in the wizard; its listing is locked', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotions?item=p3');
  await page.getByTestId('promotion-action-edit').click();
  await expect(page).toHaveURL(/edit=p3/);
  await expect(page.getByTestId('wizard-entity-locked')).toContainText('Arusha Gym');
  await page.getByTestId('step-priority').click();
  await page.getByTestId('wizard-priority').fill('9');
  await page.getByTestId('step-review').click();
  await page.getByTestId('wizard-save-draft').click();
  await expect(page.getByTestId('promotion-detail')).toBeVisible();
  const patch = state.calls.find(c => c.method === 'PATCH')!;
  expect(patch.path).toBe('/admin/promotions/p3');
  expect(patch.body).toMatchObject({ priority: 9 });
  expect(patch.body).not.toHaveProperty('entityId');
});

test('staff without the create permission get no New promotion button; the sidebar follows the scopes', async ({ page }) => {
  await setup(page, staff('s1', 'promotions_approve'), fresh());
  await page.goto('/admin/promotions');
  await expect(page.getByTestId('promotion-new')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Promotions' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Placement limits' })).toBeVisible();
});

test('campaigns: create one, start it, cancel it with a reason and be told what is still open', async ({ page }) => {
  const state = fresh();
  state.promos[2].campaignId = 'camp-1';
  await setup(page, SUPER, state);
  await page.goto('/admin/promotion-campaigns');
  await expect(page.getByTestId('campaign-table')).toContainText('Zanzibar Fitness Week');
  await page.getByTestId('campaign-new').click();
  await page.getByTestId('campaign-name-input').fill('New Gym Launch');
  await page.getByTestId('campaign-start-input').fill('2030-02-01T08:00');
  await page.getByTestId('campaign-end-input').fill('2030-02-08T08:00');
  await page.getByTestId('area-tz-dar').check();
  await page.getByTestId('campaign-save').click();
  await expect(page.getByTestId('campaign-name')).toHaveText('New Gym Launch');
  expect(state.calls.find(c => c.method === 'POST')!.body).toMatchObject({ name: 'New Gym Launch', geoScope: { areaIds: ['tz-dar'] }, startsAt: new Date('2030-02-01T08:00').toISOString() });

  await page.getByTestId('campaign-back').click();
  await page.getByTestId('campaign-row-camp-1').click();
  await expect(page.getByTestId('campaign-promotions')).toContainText('Arusha Gym');
  await page.getByTestId('campaign-start').click();
  await expect(page.getByTestId('campaign-status')).toHaveText('Active');
  await page.getByTestId('campaign-cancel').click();
  await expect(page.getByTestId('campaign-cancel-confirm')).toBeDisabled();
  await page.getByTestId('campaign-reason').fill('Client pulled out');
  await page.getByTestId('campaign-cancel-confirm').click();
  await expect(page.getByTestId('campaign-status')).toHaveText('Cancelled');
  await expect(page.getByText('1 promotion(s) in it are still open')).toBeVisible();
});

test('placement limits show what is custom and what is default, and a change is sent as a fraction', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotion-limits');
  await expect(page.getByTestId('limit-gym_discovery-featured')).toContainText('2 / 5');
  await expect(page.getByTestId('limit-gym_discovery-featured')).toContainText('Custom');
  await expect(page.getByTestId('limit-home-promoted')).toContainText('Default');
  await page.getByTestId('limit-edit-gym_discovery-featured').click();
  await page.getByTestId('limit-slots').fill('3');
  await page.getByTestId('limit-boost').fill('15');
  await page.getByTestId('limit-save').click();
  await expect(page.getByTestId('limit-gym_discovery-featured')).toContainText('2 / 3');
  await expect(page.getByTestId('limit-gym_discovery-featured')).toContainText('15%');
  expect(state.calls[0]).toMatchObject({ method: 'PUT', path: '/admin/promotion-limits/gym_discovery/featured', body: { maxSlots: 3, maxBoostFraction: 0.15 } });
});

test('staff who can only look at limits cannot change them', async ({ page }) => {
  await setup(page, staff('s2', 'promotions'), fresh());
  await page.goto('/admin/promotion-limits');
  await expect(page.getByTestId('limit-gym_discovery-featured')).toBeVisible();
  await expect(page.getByTestId('limit-edit-gym_discovery-featured')).toHaveCount(0);
});

test('the overview shows what needs a person and what ends soon', async ({ page }) => {
  await setup(page, SUPER, fresh());
  await page.goto('/admin/promotion-overview');
  await expect(page.getByTestId('overview-requests')).toContainText('1');
  await expect(page.getByTestId('overview-moderation')).toContainText('3');
  await expect(page.getByTestId('overview-expiring')).toContainText('Featured');
  await expect(page.getByTestId('overview-recent')).toContainText('promotion · submitted');
});

test('the promotion screens speak Swahili', async ({ page }) => {
  await setup(page, SUPER, fresh(), 'sw');
  await page.goto('/admin/promotions');
  await expect(page.getByRole('heading', { name: 'Promosheni' })).toBeVisible();
  await expect(page.getByTestId('promotion-tab-active')).toContainText('Zinazoendelea');
  await page.getByTestId('promotion-new').click();
  await expect(page.getByText('Ni orodha ipi inapandishwa?')).toBeVisible();
});
