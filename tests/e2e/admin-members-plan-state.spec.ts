import { expect, test, type Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

// GET /admin/members reports the plan a member's account runs on (`currentPlan`), a paid renewal
// that is waiting (`scheduledPlan`) and every open payment request by product (`openPayments`).
// An old open request for another product must not make a paid member look unpaid.

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const paid = {
  id: 'member-paid', displayName: 'Paid Member', email: 'paid@example.com', phone: null, accountStatus: 'active', memberProfile: null,
  // What an older portal read: the newest plan of any status, and the newest open request.
  subscription: { id: 'sub_next', tier: 'basic', type: 'platform_pass', status: 'scheduled', expiresAt: at(37) },
  pendingPayment: { id: 'pay_shop', amountTzs: 4500, tier: null, status: 'pending', requestedAt: at(0) },
  currentPlan: { id: 'sub_pass', tier: 'executive', type: 'platform_pass', plan: null, status: 'active', expiresAt: '2026-12-02T08:04:00.000Z' },
  scheduledPlan: { id: 'sub_next', tier: 'basic', type: 'platform_pass', plan: null, startsAt: '2026-12-02T08:04:00.000Z' },
  openPayments: [
    { id: 'pay_shop', amountTzs: 4500, tier: null, status: 'pending', requestedAt: at(0), productType: 'SHOP_ORDER' },
    { id: 'pay_gym', amountTzs: 10000, tier: null, status: 'pending', requestedAt: at(-8), productType: 'GYM_SUBSCRIPTION' },
  ],
};
const ended = {
  id: 'member-ended', displayName: 'Ended Member', email: 'ended@example.com', phone: null, accountStatus: 'active', memberProfile: null,
  subscription: { id: 'sub_day', tier: null, type: 'direct_sub', status: 'active', expiresAt: '2026-11-17T12:44:00.000Z' },
  pendingPayment: null,
  currentPlan: { id: 'sub_day', tier: null, type: 'direct_sub', plan: 'daily', status: 'expired', expiresAt: '2026-11-17T12:44:00.000Z' },
  scheduledPlan: null,
  openPayments: [],
};
// A server that does not send the new fields yet: the page shows what it showed before.
const legacy = {
  id: 'member-legacy', displayName: 'Legacy Member', email: 'legacy@example.com', phone: null, accountStatus: 'active', memberProfile: null,
  subscription: { id: 'sub_old', tier: 'pro', type: 'platform_pass', status: 'active', expiresAt: null },
  pendingPayment: { id: 'pay_old', amountTzs: 150000, tier: 'pro', status: 'pending', requestedAt: at(-1) },
};

async function open(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript((l) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
    localStorage.setItem('locale', l);
  }, locale);
  const qrCalls: string[] = [];
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/members') return route.fulfill({ json: [paid, ended, legacy] });
    if (/^\/admin\/members\/[^/]+\/qr$/.test(url.pathname)) {
      qrCalls.push(url.pathname);
      return route.fulfill({ json: { token: 'e2e-qr-token', expiresAt: at(1), rotatesEverySeconds: 30 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/admin/members');
  await expect(page.getByText('Paid Member')).toBeVisible();
  return qrCalls;
}

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });

test('a member with a running pass shows it as active, with the waiting renewal and open requests apart', async ({ page }) => {
  await open(page);
  const r = row(page, 'Paid Member');
  await expect(r.getByTestId('member-plan')).toContainText('executive');
  await expect(r.getByTestId('member-plan-state')).toHaveText('Active until 2 Dec 2026');
  await expect(r.getByTestId('member-plan-next')).toHaveText('Next: basic from 2 Dec 2026');
  await expect(r.getByTestId('member-open-payments')).toContainText('2 open requests');
  await expect(r.getByTestId('member-open-payments')).toContainText('Shop order, Gym plan');
});

test('an ended gym plan says when it ended; a member with nothing open has no open-request badge', async ({ page }) => {
  await open(page);
  const r = row(page, 'Ended Member');
  await expect(r.getByTestId('member-plan')).toContainText('Gym plan');
  await expect(r.getByTestId('member-plan-state')).toHaveText('Ended 17 Nov 2026');
  await expect(r.getByTestId('member-open-payments')).toHaveCount(0);
});

test('a server without the new fields still shows the tier and one open request', async ({ page }) => {
  await open(page);
  const r = row(page, 'Legacy Member');
  await expect(r.getByTestId('member-plan')).toContainText('pro');
  await expect(r.getByTestId('member-open-payments')).toContainText('1 open request');
});

test('the Payment pending filter lists members with any open request', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Payment pending' }).click();
  await expect(page.getByText('Paid Member')).toBeVisible();
  await expect(page.getByText('Legacy Member')).toBeVisible();
  await expect(page.getByText('Ended Member')).toHaveCount(0);
});

test('the member QR is offered for the running pass, not refused because a newer plan is not active', async ({ page }) => {
  const qrCalls = await open(page);
  await row(page, 'Paid Member').getByTitle(/QR/i).click();
  await expect(page.getByText('Member has no active pass. QR code cannot be generated.')).toHaveCount(0);
  await expect.poll(() => qrCalls).toContain('/admin/members/member-paid/qr');
});

test('Swahili: the new labels are placeholders marked for review, never bare English', async ({ page }) => {
  await open(page, 'sw');
  const r = row(page, 'Paid Member');
  await expect(r.getByTestId('member-plan-state')).toContainText('[SW-REVIEW]');
  await expect(r.getByTestId('member-open-payments')).toContainText('[SW-REVIEW]');
  await expect(r.getByTestId('member-open-payments')).toContainText('Oda ya duka, Mpango wa gym');
});
