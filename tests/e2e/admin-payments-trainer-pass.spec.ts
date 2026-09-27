import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

const payment = (over: Record<string, unknown>) => ({
  memberId: 'member-1',
  subscriptionId: 'subscription-1',
  tier: null,
  amountTzs: 40000,
  status: 'pending',
  provider: 'admin_approved',
  reference: null,
  note: null,
  requestedAt: '2026-09-27T08:00:00.000Z',
  decidedAt: null,
  ...over,
});

test('trainer pass requests show period and gym, and can be filtered', async ({ page }) => {
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
          payment({
            id: 'pay-trainer-pass',
            // The note was edited by an admin — the label must not depend on it.
            note: 'Paid by M-Pesa',
            gymId: 'gym-tu',
            gym: { id: 'gym-tu', name: 'Gym Tu' },
            member: { displayName: 'Coach Asha' },
            subscription: { type: 'trainer_pass', plan: 'weekly', status: 'payment_pending' },
          }),
          payment({
            id: 'pay-platform',
            tier: 'pro',
            amountTzs: 100000,
            member: { displayName: 'Regular Member' },
            subscription: { type: 'platform_pass', tier: 'pro', status: 'payment_pending' },
          }),
        ],
      });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/payments');

  await expect(page.getByText('TRAINER PASS · WEEKLY')).toBeVisible();
  await expect(page.getByText('Gym Tu')).toBeVisible();
  await expect(page.getByText('Regular Member')).toBeVisible();

  await page.getByRole('button', { name: 'Trainer passes' }).click();
  await expect(page.getByText('Coach Asha')).toBeVisible();
  await expect(page.getByText('Regular Member')).toHaveCount(0);

  await page.getByTitle('Approve').click();
  await expect(page.getByText(/trainer pass · weekly at Gym Tu/)).toBeVisible();
  await expect(page.getByText(/The pass period starts now\./)).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
