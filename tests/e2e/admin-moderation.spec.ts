import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Json = Record<string, unknown>;
type Listing = { id: string; name: string; subtitle: string; status: string; mod: string; reason?: string; decidedAt?: string };

const ACTIONS: Record<string, Array<[string, boolean]>> = {
  pending: [['approve', false], ['reject', true]],
  approved: [['suspend', true], ['hide', true], ['require_review', true]],
  suspended: [['restore', false], ['hide', true]],
  hidden: [['restore', false], ['suspend', true]],
  rejected: [['reopen', false]],
};
const NEXT: Record<string, string> = {
  approve: 'approved', reject: 'rejected', suspend: 'suspended', hide: 'hidden', restore: 'approved', reopen: 'pending', 'require-review': 'pending',
};

/** A signed-in user and a small fake moderation API whose state the test can read. */
async function setup(page: Page, user: Json, state: { listings: Listing[]; history: Json[]; calls: Array<{ path: string; body: Json | null }>; queries: string[]; held?: number }, locale = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('locale', l as string);
  }, [user, locale]);
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const counts = () => Object.fromEntries(['pending', 'approved', 'rejected', 'suspended', 'hidden'].map(s => [s, state.listings.filter(l => l.mod === s).length]));
    if (method === 'POST' && path.startsWith('/admin/moderation/')) {
      const [, , , , id, action] = path.split('/');
      const body = route.request().postDataJSON() as Json | null;
      state.calls.push({ path, body });
      const l = state.listings.find(x => x.id === id)!;
      const needsReason = ['reject', 'suspend', 'hide', 'require-review'].includes(action);
      if (needsReason && !String(body?.reason || '').trim()) return route.fulfill({ status: 400, json: { error: 'reason_required' } });
      const from = l.mod;
      l.mod = NEXT[action];
      l.reason = String(body?.reason || '');
      l.decidedAt = '2026-10-08T10:00:00.000Z';
      state.history.unshift({ id: `h${state.history.length}`, entityType: 'gym', entityId: id, action: action.replace('-', '_'), fromStatus: from, toStatus: l.mod, reason: body?.reason ?? null, actor: 'admin-1', at: l.decidedAt });
      return route.fulfill({ json: { entityType: 'gym', entityId: id, from, to: l.mod, heldPromotions: state.held ?? 0 } });
    }
    if (path === '/admin/moderation') {
      state.queries.push(url.search);
      const type = url.searchParams.get('entityType');
      const status = url.searchParams.get('status');
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const items = state.listings
        .filter(l => (type === 'gym' ? l.id.startsWith('gym') : l.id.startsWith(type || '')) && (!status || l.mod === status) && (!q || l.name.toLowerCase().includes(q)))
        .map(l => ({ entityType: type, id: l.id, name: l.name, subtitle: l.subtitle, status: l.status, moderationStatus: l.mod, reason: l.reason ?? null, decidedBy: null, decidedAt: l.decidedAt ?? null }));
      return route.fulfill({ json: { items, total: items.length, nextCursor: null, counts: counts() } });
    }
    const detail = path.match(/^\/admin\/moderation\/(\w+)\/([\w-]+)$/);
    if (detail) {
      const l = state.listings.find(x => x.id === detail[2])!;
      const reasons = l.mod === 'approved' ? (l.status === 'inactive' ? ['gym_not_active'] : []) : [`moderation_${l.mod}`];
      return route.fulfill({ json: {
        entityType: detail[1], summary: { id: l.id, name: l.name, subtitle: l.subtitle, status: l.status }, moderationStatus: l.mod,
        reason: l.reason ?? null, decidedBy: null, decidedAt: l.decidedAt ?? null, eligibility: { ok: reasons.length === 0, reasons },
        history: state.history.filter(h => h.entityId === l.id),
        allowedActions: (ACTIONS[l.mod] || []).map(([action, reasonRequired]) => ({ action, reasonRequired })),
      } });
    }
    return route.fulfill({ json: [] });
  });
}

const fresh = () => ({
  listings: [
    { id: 'gym-1', name: 'Zanzibar Iron', subtitle: 'Stone Town, Zanzibar', status: 'active', mod: 'pending' },
    { id: 'gym-2', name: 'Masaki Fitness', subtitle: 'Dar es Salaam', status: 'active', mod: 'approved' },
    { id: 'gym-3', name: 'Old Gym', subtitle: 'Arusha', status: 'inactive', mod: 'approved' },
    { id: 'vendor-1', name: 'Protein House', subtitle: 'supplements', status: 'active', mod: 'pending' },
  ] as Listing[],
  history: [] as Json[], calls: [] as Array<{ path: string; body: Json | null }>, queries: [] as string[],
});
const SUPER = { id: 'admin-1', userType: 'admin', email: 'admin@example.com' };

test('the queue opens on pending, shows counts, and switches between listing types and statuses', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/moderation');
  await expect(page.getByRole('heading', { name: 'Listing moderation' })).toBeVisible();
  await expect(page.getByTestId('moderation-table')).toContainText('Zanzibar Iron');
  await expect(page.getByTestId('moderation-table')).not.toContainText('Masaki Fitness');
  await expect(page.getByTestId('moderation-tab-pending')).toContainText('2');
  await expect(page.getByTestId('moderation-tab-approved')).toContainText('2');

  await page.getByTestId('moderation-tab-approved').click();
  await expect(page.getByTestId('moderation-table')).toContainText('Masaki Fitness');
  await page.getByTestId('moderation-type-vendor').click();
  await page.getByTestId('moderation-tab-pending').click();
  await expect(page.getByTestId('moderation-table')).toContainText('Protein House');
  expect(state.queries.some(q => q.includes('entityType=vendor') && q.includes('status=pending'))).toBe(true);

  await page.getByTestId('moderation-tab-rejected').click();
  await expect(page.getByTestId('moderation-empty')).toBeVisible();
});

test('search narrows the queue', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/moderation');
  await page.getByTestId('moderation-tab-approved').click();
  await page.getByTestId('moderation-search').fill('masaki');
  await expect(page.getByTestId('moderation-table')).toContainText('Masaki Fitness');
  await expect(page.getByTestId('moderation-table')).not.toContainText('Old Gym');
  expect(state.queries.some(q => q.includes('q=masaki'))).toBe(true);
});

test('approving a pending listing: open it, see why it cannot be listed yet, approve, and see the history', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/moderation');
  await page.getByTestId('moderation-row-gym-1').click();
  await expect(page).toHaveURL(/item=gym-1/);
  await expect(page.getByTestId('moderation-name')).toHaveText('Zanzibar Iron');
  await expect(page.getByTestId('moderation-ineligible')).toContainText('Waiting for review');
  await expect(page.getByTestId('moderation-history')).toHaveCount(0);

  await page.getByTestId('moderation-action-approve').click();
  await page.getByTestId('moderation-confirm').click();
  await expect(page.getByTestId('moderation-eligible')).toBeVisible();
  await expect(page.getByTestId('moderation-history')).toContainText('Approve');
  await expect(page.getByTestId('moderation-history')).toContainText('Pending → Approved');
  expect(state.calls.map(c => c.path)).toEqual(['/admin/moderation/gym/gym-1/approve']);

  await page.getByTestId('moderation-back').click();
  await expect(page).not.toHaveURL(/item=/);
  await expect(page.getByTestId('moderation-tab-pending')).toContainText('1');
});

test('rejecting needs a reason, which is sent and kept in the history', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/moderation?type=gym&item=gym-1');
  await page.getByTestId('moderation-action-reject').click();
  await expect(page.getByTestId('moderation-confirm')).toBeDisabled();
  await page.getByTestId('moderation-reason').fill('Photos are not of this gym');
  await expect(page.getByTestId('moderation-confirm')).toBeEnabled();
  await page.getByTestId('moderation-confirm').click();
  await expect(page.getByTestId('moderation-history')).toContainText('Photos are not of this gym');
  expect(state.calls[0].body).toEqual({ reason: 'Photos are not of this gym' });
  // A rejected listing can only be reopened.
  await expect(page.getByTestId('moderation-action-reopen')).toBeVisible();
  await expect(page.getByTestId('moderation-action-approve')).toHaveCount(0);
});

test('suspending says how many running promotions were paused', async ({ page }) => {
  const state = { ...fresh(), held: 2 };
  await setup(page, SUPER, state);
  await page.goto('/admin/moderation?type=gym&item=gym-2');
  await expect(page.getByTestId('moderation-eligible')).toBeVisible();
  await page.getByTestId('moderation-action-suspend').click();
  await page.getByTestId('moderation-reason').fill('Safety complaint');
  await page.getByTestId('moderation-confirm').click();
  await expect(page.getByText('2 running promotion(s) were paused.')).toBeVisible();
  await expect(page.getByTestId('moderation-ineligible')).toContainText('Suspended in moderation');
});

test('an approved listing that is switched off explains the other reason it cannot be listed', async ({ page }) => {
  await setup(page, SUPER, fresh());
  await page.goto('/admin/moderation?type=gym&item=gym-3');
  await expect(page.getByTestId('moderation-ineligible')).toContainText('The gym is not active');
});

test('staff who may look but not decide see no action buttons', async ({ page }) => {
  await setup(page, { id: 'staff-1', userType: 'admin', portalUser: true, aclPermissions: ['moderation'] }, fresh());
  await page.goto('/admin/moderation?type=gym&item=gym-1');
  await expect(page.getByTestId('moderation-view-only')).toBeVisible();
  await expect(page.getByTestId('moderation-action-approve')).toHaveCount(0);
});

test('staff with the decide scope can act; the sidebar shows the page to them but not to others', async ({ page }) => {
  await setup(page, { id: 'staff-2', userType: 'admin', portalUser: true, aclPermissions: ['moderation_decide'] }, fresh());
  await page.goto('/admin/moderation');
  await expect(page.getByRole('link', { name: 'Listing moderation' })).toBeVisible();
  await page.getByTestId('moderation-row-gym-1').click();
  await expect(page.getByTestId('moderation-action-approve')).toBeVisible();
});

test('staff without a moderation scope do not get the page or the sidebar link', async ({ page }) => {
  await setup(page, { id: 'staff-3', userType: 'admin', portalUser: true, aclPermissions: ['gyms'] }, fresh());
  await page.goto('/admin/moderation');
  await expect(page).not.toHaveURL(/\/admin\/moderation/);
  await expect(page.getByRole('link', { name: 'Listing moderation' })).toHaveCount(0);
});

test('the page speaks Swahili', async ({ page }) => {
  await setup(page, SUPER, fresh(), 'sw');
  await page.goto('/admin/moderation');
  await expect(page.getByRole('heading', { name: 'Ukaguzi wa orodha' })).toBeVisible();
  await expect(page.getByTestId('moderation-tab-pending')).toContainText('Inasubiri');
  await page.getByTestId('moderation-row-gym-1').click();
  await expect(page.getByTestId('moderation-action-approve')).toHaveText('Idhinisha');
});
