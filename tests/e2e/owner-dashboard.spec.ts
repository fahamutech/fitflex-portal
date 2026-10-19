import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

const base = {
  gym: { id: 'gym-1', name: 'Mikocheni Fitness', tier: 'standard', perVisitRate: 5000 },
  gyms: [{ id: 'gym-1', name: 'Mikocheni Fitness', tier: 'standard' }],
  todayCount: 4, monthVisits: 61, periodStart: '2026-10-01', periodEnd: '2026-10-11', memberType: 'all',
  periodVisits: 61, periodMembers: 20, directVisits: 30, directMembers: 9, fitflexVisits: 31, fitflexMembers: 11,
};
const settlement = {
  rates: { dailyTzs: 3500, weeklyTzs: 12000, monthlyTzs: 40000 },
  latest: { id: 'st-sep', gymId: 'gym-1', gymName: 'Mikocheni Fitness', periodStartDate: '2026-09-01', periodEndDate: '2026-10-01', status: 'in_review', onHold: false, members: 6, visits: 22, earnedTzs: 47000, networkAdjustmentTzs: 0, adjustmentsTzs: 0, carriedForwardTzs: 0, payableTzs: 47000, paidAt: null, paymentReference: null, receiptUrl: null, payoutAccountLast4: null },
  awaitingPaymentTzs: 22500,
  lastPaid: { periodStartDate: '2026-07-01', payableTzs: 30000, paidAt: '2026-08-06T09:00:00.000Z' },
};

async function open(page: Page, user: Record<string, unknown>, body: Record<string, unknown>) {
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'owner-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
  await page.route(`${API}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/operator/dashboard' ? body : [] });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Mikocheni Fitness' })).toBeVisible();
}

test('owner dashboard shows what FitFlex pays, from statements, and no bands or commission', async ({ page }) => {
  await open(page, { id: 'owner-1', userType: 'gym_operator', gymId: 'gym-1', email: 'owner@example.com' }, { ...base, settlement });

  await expect(page.getByTestId('dash-rates')).toContainText('TSh 3,500 per visit (1–3 visits) · TSh 12,000 per week (4–7 visits) · TSh 40,000 per month (15+ visits)');
  await expect(page.getByTestId('dash-latest')).toHaveText('TSh 47,000');
  await expect(page.getByText('September 2026 · In review')).toBeVisible();
  await expect(page.getByTestId('dash-awaiting')).toHaveText('TSh 22,500');
  await expect(page.getByText('July 2026 · 6 Aug')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View statements' })).toHaveAttribute('href', /\/owner\/statements/);

  for (const old of ['Band', 'commission', 'Commission', 'Estimated net', '/ visit']) {
    await expect(page.getByText(old, { exact: false })).toHaveCount(0);
  }
});

test('gym staff without the payments permission see the dashboard without any payment figures', async ({ page }) => {
  await open(page, { id: 'staff-1', userType: 'gym_staff', gymId: 'gym-1', aclPermissions: ['checkins'], email: 'staff@example.com' }, { ...base, settlement: null });
  await expect(page.getByTestId('dash-rates')).toHaveCount(0);
  await expect(page.getByTestId('dash-latest')).toHaveCount(0);
  await expect(page.getByText('How FitFlex pays you')).toHaveCount(0);
});
