import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

test('payments table renders legacy null tiers without crashing', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', error => runtimeErrors.push(error));

  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'admin-1',
      userType: 'admin',
      email: 'admin@example.com',
    }));
  });

  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/payment-requests') {
      return route.fulfill({
        json: [
          {
            id: 'payment-null-tier',
            memberId: 'member-1',
            subscriptionId: 'subscription-1',
            tier: null,
            amountTzs: 60000,
            status: 'pending',
            provider: 'manual',
            reference: null,
            note: null,
            requestedAt: '2026-09-14T08:00:00.000Z',
            decidedAt: null,
            member: { displayName: 'Legacy Member' },
            subscription: null,
          },
        ],
      });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/payments');

  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
  await expect(page.getByText('Legacy Member')).toBeVisible();
  await expect(page.getByRole('cell', { name: '—', exact: true }).first()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
