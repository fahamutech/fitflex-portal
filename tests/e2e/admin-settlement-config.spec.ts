import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Json = Record<string, unknown>;

const base = { version: 1, status: 'active', effectiveFrom: '2026-10-01', effectiveTo: null, reason: null, createdBy: 'seed', approvedBy: 'seed' };
const none = { networkPayoutBps: null, dailyDiscountBps: null, weeklyDiscountBps: null, monthlyDiscountBps: null, dailyCeilingTzs: null, weeklyCeilingTzs: null, monthlyCeilingTzs: null };

test('admin drafts a gym rule, cannot activate their own draft, and activates a colleague’s rate card', async ({ page }) => {
  const calls: Array<{ path: string; body: Json | null }> = [];
  const config = {
    passTierVersions: [{ ...base, id: 'ptv-pro-1', tierKey: 'pro', priceTzs: 150000, visitAllowance: 18 }],
    rules: [
      { ...base, ...none, id: 'rule-global-1', name: 'Dar es Salaam', scopeType: 'global', scopeId: null, networkPayoutBps: 7500, dailyDiscountBps: 2500, weeklyDiscountBps: 2000, monthlyDiscountBps: 2000 },
      { ...base, ...none, id: 'rule-ceil-standard-1', name: null, scopeType: 'gym_tier', scopeId: 'standard', dailyCeilingTzs: 4000, weeklyCeilingTzs: 15000, monthlyCeilingTzs: 45000 },
    ] as Json[],
    rateCards: [
      { ...base, id: 'card-1', gymId: 'gym-1', gymTier: 'standard', retailDailyTzs: 5000, retailWeeklyTzs: 30000, retailMonthlyTzs: 100000, dailyDiscountBps: 2500, weeklyDiscountBps: 2000, monthlyDiscountBps: 2000, dailyCeilingTzs: 4000, weeklyCeilingTzs: 15000, monthlyCeilingTzs: 45000 },
      { ...base, ...none, id: 'card-2', gymId: 'gym-2', gymTier: 'standard', status: 'draft', effectiveFrom: null, createdBy: 'admin-2', approvedBy: null, retailDailyTzs: 6000, retailWeeklyTzs: 32000, retailMonthlyTzs: 110000 },
    ] as Json[],
  };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });
  await page.route(`${API}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Json | null;
      calls.push({ path, body });
      if (path === '/admin/settlement-config/rules') {
        config.rules.push({ ...base, ...none, ...body, id: 'rule-new', name: null, status: 'draft', effectiveFrom: null, createdBy: 'admin-1', approvedBy: null });
        return route.fulfill({ status: 201, json: { rule: config.rules.at(-1) } });
      }
      if (path === '/admin/settlement-config/rate-cards/card-2/activate') {
        if (body?.effectiveFrom === '2026-01-01') return route.fulfill({ status: 409, json: { error: 'effective_from_in_past' } });
        Object.assign(config.rateCards[1], { status: 'active', effectiveFrom: body?.effectiveFrom, dailyDiscountBps: 2500, weeklyDiscountBps: 2000, monthlyDiscountBps: 2000, dailyCeilingTzs: 4000, weeklyCeilingTzs: 15000, monthlyCeilingTzs: 45000 });
      }
      return route.fulfill({ json: {} });
    }
    if (path === '/admin/settlement-config') return route.fulfill({ json: config });
    if (path === '/admin/gyms') return route.fulfill({ json: [{ id: 'gym-1', name: 'Mikocheni Fitness', tier: 'standard' }, { id: 'gym-2', name: 'Kariakoo Gym', tier: 'standard', ratePerDay: 6000, ratePerWeek: 32000, ratePerMonth: 110000 }] });
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/settlement-config');
  // The amount paid to the gym: retail less the discount, up to the ceiling.
  await expect(page.getByTestId('config-row-card-1')).toContainText('5,000 / 30,000 / 100,000');
  await expect(page.getByTestId('config-row-card-1')).toContainText('3,750 / 15,000 / 45,000');
  await expect(page.getByTestId('config-row-card-2')).toContainText('Set when activated');

  // A past start date is refused in words; a valid one activates the card.
  await page.getByTestId('config-activate-card-2').click();
  await page.getByTestId('config-activate-date').fill('2026-01-01');
  await page.getByTestId('config-activate-submit').click();
  await expect(page.getByText('The start date can’t be in the past: a version is already in force.')).toBeVisible();
  await page.getByTestId('config-activate-date').fill('2026-11-01');
  await page.getByTestId('config-activate-submit').click();
  await expect(page.getByTestId('config-row-card-2')).toContainText('4,000 / 15,000 / 45,000');
  expect(calls.at(-1)).toMatchObject({ path: '/admin/settlement-config/rate-cards/card-2/activate', body: { effectiveFrom: '2026-11-01' } });

  // Rules: percentages are shown as percentages and sent as basis points.
  await page.getByRole('button', { name: 'Discounts, ceilings and network share' }).click();
  await expect(page.getByTestId('config-row-rule-global-1')).toContainText('75%');
  await expect(page.getByTestId('config-row-rule-global-1')).toContainText('25% / 20% / 20%');
  await page.getByTestId('config-new').click();
  await page.getByTestId('config-rule-target').selectOption('gym-2');
  await page.getByTestId('config-rule-ceiling-month').fill('50000');
  await page.getByTestId('config-new-submit').click();
  await expect(page.getByTestId('config-row-rule-new')).toContainText('Kariakoo Gym');
  expect(calls.at(-1)).toEqual({ path: '/admin/settlement-config/rules', body: { scopeType: 'gym', scopeId: 'gym-2', monthlyCeilingTzs: 50000 } });
  // Maker-checker: the drafter cannot activate their own draft.
  await expect(page.getByTestId('config-activate-rule-new')).toBeDisabled();

  await page.getByRole('button', { name: 'Passes' }).click();
  await expect(page.getByTestId('config-row-ptv-pro-1')).toContainText('TZS 150,000');
});
