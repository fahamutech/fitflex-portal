import { expect, test, type Page } from '@playwright/test';

// Phase 2B S3: the rebuilt admin overview. Every figure comes from a call another admin page already
// makes; the checks are that tiles follow permissions, link to the right queue, and that one failing
// source never blanks the page.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const superAdmin = { id: 'admin-1', userType: 'admin', email: 'admin@example.com' };
const staff = (aclPermissions: string[]) => ({ id: 'staff-1', userType: 'admin', portalUser: true, aclPermissions, email: 'staff@example.com' });

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const payment = (id: string, status: string, amountTzs: number, requestedAt: string) =>
  ({ id, memberId: `m-${id}`, member: { displayName: `Sample member ${id}` }, tier: 'pro', amountTzs, status, requestedAt });

type Reply = { status?: number; json: unknown };
const DEFAULTS: Record<string, Reply> = {
  '/admin/gyms': { json: [{ id: 'g1', name: 'Gym one', tier: 'standard', accessMode: 'in_person' }, { id: 'g2', name: 'Gym two', tier: 'premium', accessMode: 'free_online' }] },
  '/admin/members': { json: [{ id: 'm1', accountStatus: 'active' }, { id: 'm2', accountStatus: 'active' }, { id: 'm3', accountStatus: 'suspended' }] },
  '/admin/payment-requests': { json: [
    payment('1', 'pending', 60000, hoursAgo(50)), payment('2', 'pending', 120000, hoursAgo(3)),
    payment('3', 'approved', 180000, hoursAgo(80)), payment('4', 'rejected', 60000, hoursAgo(90)),
  ] },
  '/admin/refunds': { json: { refunds: [{ id: 'r1', memberId: 'm1', kind: 'subscription', amountTzs: 60000, status: 'requested', createdAt: hoursAgo(5) }] } },
  '/admin/payments/held': { json: { items: [] } },
  '/admin/role-approvals': { json: [{ id: 'a1', userType: 'vendor', approvalStatus: 'pending_approval' }, { id: 'a2', userType: 'trainer', approvalStatus: 'approved' }] },
  '/admin/kyc/cases': { json: [
    { id: 'k1', partnerType: 'gym', status: 'submitted', submittedAt: hoursAgo(70), updatedAt: hoursAgo(70) },
    { id: 'k2', partnerType: 'vendor', status: 'in_review', submittedAt: hoursAgo(20), updatedAt: hoursAgo(2) },
    { id: 'k3', partnerType: 'trainer', status: 'approved', submittedAt: hoursAgo(200), updatedAt: hoursAgo(100) },
  ] },
  '/admin/moderation/counts': { json: { counts: { pending: 7, approved: 3, rejected: 0, suspended: 0, hidden: 0 } } },
  '/admin/security-incidents': { json: { incidents: [] } },
  '/admin/audit-log': { json: { items: [{ id: 'au1', at: hoursAgo(1), actor: 'admin@example.com', action: 'payment.approve', target: 'pr_1', before: null, after: null, reason: null }], nextCursor: null } },
  '/admin/analytics': { json: {
    period: { from: '2026-10-27', to: '2026-11-25', days: 30 }, generatedAt: hoursAgo(0), members: 3,
    dailyActive: { series: [{ day: '2026-11-23', members: 1 }, { day: '2026-11-24', members: 3 }, { day: '2026-11-25', members: 2 }], averageDaily: 2, activeInPeriod: 3, activeLast7Days: 3, stickiness: 0.6 },
  } },
};

async function setup(page: Page, user: Record<string, unknown>, overrides: Record<string, Reply> = {}) {
  const seen: string[] = [];
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
  await page.route(`${API}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    seen.push(path);
    const reply = overrides[path] ?? DEFAULTS[path] ?? { json: [] };
    return route.fulfill({ status: reply.status ?? 200, json: reply.json });
  });
  return seen;
}

const overview = (page: Page) => page.getByTestId('admin-overview');
const queue = (page: Page, key: string) => overview(page).getByTestId(`queue-${key}`);

test.describe('admin overview', () => {
  test('super-admin: what needs attention, with counts, age and links to each queue', async ({ page }) => {
    await setup(page, superAdmin);
    await page.goto('/admin');

    await expect(overview(page).getByRole('heading', { name: 'Needs attention' })).toBeVisible();
    await expect(queue(page, 'payments')).toContainText('2');
    await expect(queue(page, 'payments')).toContainText('Payments to approve');
    await expect(queue(page, 'payments')).toContainText('Oldest 2 days');
    await expect(queue(page, 'payments').getByRole('link')).toHaveAttribute('href', /\/admin\/payments\/?$/);

    await expect(queue(page, 'refunds')).toContainText('1');
    await expect(queue(page, 'refunds')).toContainText('Oldest 5 hours');
    await expect(queue(page, 'refunds').getByRole('link')).toHaveAttribute('href', /\/admin\/refunds\/?$/);

    // Submitted and in review count; approved cases do not.
    await expect(queue(page, 'kyc')).toContainText('2');
    await expect(queue(page, 'kyc').getByRole('link')).toHaveAttribute('href', /\/admin\/kyc\/?$/);

    await expect(queue(page, 'approvals')).toContainText('1');
    await expect(queue(page, 'moderation')).toContainText('7');
    await expect(queue(page, 'moderation').getByRole('link')).toHaveAttribute('href', /\/admin\/moderation\/?$/);

    // An empty queue is drawn, and says so.
    await expect(queue(page, 'held')).toContainText('0');
    await expect(queue(page, 'held')).toContainText('Nothing waiting');
    await expect(queue(page, 'security')).toContainText('Nothing waiting');

    await expect(overview(page).getByTestId('overview-waiting-total')).toHaveText('13 waiting');
  });

  test('key figures carry their context; charts and recent activity are shown', async ({ page }) => {
    await setup(page, superAdmin);
    await page.goto('/admin');
    const figures = overview(page).getByRole('region', { name: 'Key figures' });
    await expect(figures).toContainText('Members');
    await expect(figures).toContainText('2 active · 1 suspended');
    await expect(figures).toContainText('1 physical · 1 online');
    await expect(figures).toContainText('TSh 180,000');
    await expect(figures).toContainText('Active in last 7 days');

    await expect(overview(page).getByTestId('overview-active-chart')).toContainText('Highest 3 on 24 Nov');
    await expect(overview(page).getByRole('img', { name: /Active members per day over 3 days/ })).toBeVisible();
    await expect(overview(page).getByTestId('overview-payment-status')).toContainText('4 requests in all');

    await expect(overview(page).getByRole('region', { name: 'Recent payment requests' })).toContainText('Sample member 1');
    await expect(overview(page).getByTestId('overview-audit')).toContainText('payment.approve');
  });

  test('the period switch reloads only the active-members figures', async ({ page }) => {
    const seen = await setup(page, superAdmin);
    await page.goto('/admin');
    await expect(overview(page).getByTestId('overview-active-chart')).toContainText('Highest 3');
    const before = seen.filter(p => p === '/admin/payment-requests').length;
    const analyticsBefore = seen.filter(p => p === '/admin/analytics').length;
    await overview(page).getByTestId('overview-active-chart').getByRole('button', { name: '7 days' }).click();
    await expect.poll(() => seen.filter(p => p === '/admin/analytics').length).toBeGreaterThan(analyticsBefore);
    expect(seen.filter(p => p === '/admin/payment-requests').length).toBe(before);
  });

  test('portal staff see only the tiles and figures their scopes open, and no request outside them', async ({ page }) => {
    const seen = await setup(page, staff(['kyc']));
    await page.goto('/admin');
    await expect(queue(page, 'kyc')).toContainText('2');
    await expect(overview(page).getByTestId('overview-queues').locator('[data-testid^="queue-"]')).toHaveCount(1);
    await expect(overview(page).getByRole('region', { name: 'Recent payment requests' })).toHaveCount(0);
    await expect(overview(page).getByTestId('overview-audit')).toHaveCount(0);
    await expect(overview(page).getByTestId('overview-active-chart')).toHaveCount(0);
    for (const path of ['/admin/payment-requests', '/admin/refunds', '/admin/payments/held', '/admin/members', '/admin/gyms', '/admin/audit-log', '/admin/analytics', '/admin/role-approvals']) {
      expect(seen, `no call to ${path}`).not.toContain(path);
    }
  });

  test('a source that fails is named with a retry; the rest of the page stays', async ({ page }) => {
    let fail = true;
    await setup(page, superAdmin);
    await page.route(`${API}/admin/refunds**`, route => (fail
      ? route.fulfill({ status: 500, json: { error: 'boom' } })
      : route.fulfill({ json: { refunds: [] } })));
    await page.goto('/admin');

    const notice = overview(page).getByTestId('overview-partial');
    await expect(notice).toContainText("These didn't load: Refunds.");
    await expect(notice).not.toContainText('boom');
    await expect(queue(page, 'payments')).toContainText('2');
    await expect(queue(page, 'refunds')).toHaveCount(0);

    fail = false;
    await notice.getByRole('button', { name: 'Try again' }).click();
    await expect(notice).toHaveCount(0);
    await expect(queue(page, 'refunds')).toContainText('Nothing waiting');
  });

  test('a tool switched off on the server (404) or refused (403) is left out without an error', async ({ page }) => {
    await setup(page, superAdmin, {
      '/admin/payments/held': { status: 404, json: { error: 'feature_disabled' } },
      '/admin/security-incidents': { status: 404, json: { error: 'feature_disabled' } },
      '/admin/audit-log': { status: 403, json: { error: 'acl_forbidden' } },
    });
    await page.goto('/admin');
    await expect(queue(page, 'payments')).toBeVisible();
    await expect(queue(page, 'held')).toHaveCount(0);
    await expect(queue(page, 'security')).toHaveCount(0);
    await expect(overview(page).getByTestId('overview-audit')).toHaveCount(0);
    await expect(overview(page).getByTestId('overview-partial')).toHaveCount(0);
  });

  test('phone: no sideways scroll, tiles stack', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, superAdmin);
    await page.goto('/admin');
    await expect(queue(page, 'payments')).toBeVisible();
    const over = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth };
    });
    expect(over.doc).toBeLessThanOrEqual(1);
    expect(over.main).toBeLessThanOrEqual(1);
  });
});

test('sidebar: the moderation link carries its waiting count', async ({ page }) => {
  await setup(page, superAdmin);
  await page.goto('/admin/moderation');
  await expect(page.locator('aside:not(#mobile-drawer)').getByRole('link', { name: 'Listing moderation, 7 waiting' })).toBeVisible();
});
