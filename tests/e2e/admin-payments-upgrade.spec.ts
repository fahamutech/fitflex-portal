import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

test('a pass upgrade is labelled as an upgrade with the plan it keeps', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', error => runtimeErrors.push(error));

  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });

  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/payment-requests') {
      return route.fulfill({
        json: [
          {
            id: 'pay-upgrade',
            memberId: 'member-1',
            subscriptionId: 'sub_old',
            tier: 'pro',
            amountTzs: 60000,
            status: 'pending',
            provider: 'admin_approved',
            reference: null,
            note: 'upgrade:sub_old:basic',
            requestedAt: '2026-10-12T08:00:00.000Z',
            decidedAt: null,
            member: { displayName: 'Upgrading Member' },
            subscription: { type: 'platform_pass', tier: 'basic', status: 'active', expiresAt: '2026-11-02T08:00:00.000Z' },
          },
        ],
      });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/payments');

  // One badge for the kind, the tier step under it (design QA: the long badge wrapped into a blob).
  await expect(page.getByText('UPGRADE', { exact: true })).toBeVisible();
  await expect(page.getByText('BASIC → PRO', { exact: true })).toBeVisible();
  await expect(page.getByText(/Pays the difference; plan stays until/)).toBeVisible();
  await expect(page.getByText('upgrade:sub_old:basic')).toHaveCount(0);

  await page.getByTitle('Approve').click();
  await expect(page.getByText(/The plan is upgraded now and keeps its end date\./)).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
