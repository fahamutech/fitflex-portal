// Smoke coverage for the B2B insights screens: an organisation's own (/org/insights, /hr/insights, both
// src/components/b2b-insights.tsx) and FitFlex staff's overview (/admin/b2b-analytics).
import { expect, test } from '@playwright/test';
import { ADMIN, B2BMock, expectNoHorizontalScroll, orgUser, setupB2B } from './helpers/b2b-mock';

test.describe('organisation insights', () => {
  let mock: B2BMock;
  test.beforeEach(async ({ page }) => {
    mock = await setupB2B(page, orgUser(['admin']));
  });
  const dashQueries = () => mock.reads(/analytics\/dashboard$/).map(c => c.query);

  test('overview renders figures and the filter controls', async ({ page }) => {
    await page.goto('/org/insights');
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
    await expect(page.getByTestId('insights-kpis')).toContainText('People on your list');
    await expect(page.getByTestId('insights-kpis')).toContainText('42');
    await expect(page.getByTestId('insights-top-providers')).toContainText('Zanzibar Iron');
    await expect(page.getByTestId('insights-engagement')).toContainText('Workouts recorded');
    await expect(page.getByTestId('insights-billing-kpis')).toContainText('TZS 175,000');
    for (const label of ['Period', 'Programme', 'Group']) await expect(page.getByTestId('insights-filters').getByLabel(label, { exact: true })).toBeVisible();
    for (const tab of ['Overview', 'People', 'Programmes & benefits', 'Gyms & trainers', 'Billing', 'Reports']) {
      await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
    }
  });

  test('period, programme and group filters change the query', async ({ page }) => {
    await page.goto('/org/insights');
    const filters = page.getByTestId('insights-filters');
    await filters.getByLabel('Period', { exact: true }).selectOption('last_7_days');
    await expect.poll(() => dashQueries().some(q => q.period === 'last_7_days')).toBe(true);
    await filters.getByLabel('Programme', { exact: true }).selectOption('prog-1');
    await expect.poll(() => dashQueries().some(q => q.period === 'last_7_days' && q.programId === 'prog-1')).toBe(true);
    await filters.getByLabel('Group', { exact: true }).selectOption('Branch');
    await expect.poll(() => dashQueries().some(q => q.programId === 'prog-1' && q.group === 'Branch')).toBe(true);
    // Custom dates show two date inputs, and nothing is asked until both are set.
    await filters.getByLabel('Period', { exact: true }).selectOption('custom');
    await expect(page.getByText('Choose a start date and an end date.')).toBeVisible();
    await filters.getByLabel('From', { exact: true }).fill('2026-09-01');
    await filters.getByLabel('To', { exact: true }).fill('2026-09-30');
    await expect.poll(() => dashQueries().some(q => q.from === '2026-09-01' && q.to === '2026-09-30')).toBe(true);
  });

  test('people tab: search, show, sort and a person detail', async ({ page }) => {
    await page.goto('/org/insights');
    await page.getByRole('button', { name: 'People', exact: true }).click();
    await expect(page.getByTestId('insights-people')).toContainText('Asha Juma');
    await page.getByLabel('Search people', { exact: true }).fill('asha');
    await page.getByLabel('Show', { exact: true }).selectOption('active');
    await page.getByLabel('Sort', { exact: true }).selectOption('uses');
    await expect.poll(() => mock.reads(/analytics\/people$/).some(c => c.query.search === 'asha' && c.query.activity === 'active' && c.query.sort === 'uses')).toBe(true);
    await page.getByTestId('person-ben-1').click();
    await expect(page.getByTestId('person-detail')).toContainText('Zanzibar Iron');
    await expect(page.getByTestId('person-detail')).toContainText('Masaki Fitness');
    expect(mock.reads(/analytics\/people\/ben-1$/).length).toBeGreaterThan(0);
  });

  test('programmes, gyms and billing tabs render their tables', async ({ page }) => {
    await page.goto('/org/insights');
    await page.getByRole('button', { name: 'Programmes & benefits', exact: true }).click();
    await expect(page.getByTestId('insights-programs')).toContainText('Safari Wellness 2026');
    await page.getByRole('button', { name: 'Gyms & trainers', exact: true }).click();
    await expect(page.getByText('No sponsored visits in this period.')).toBeVisible();
    await page.getByRole('button', { name: 'Billing', exact: true }).click();
    await expect(page.getByText('Figures are from invoices and payments.')).toBeVisible();
  });

  test('reports tab downloads a CSV from the export route', async ({ page }) => {
    await page.goto('/org/insights');
    await page.getByRole('button', { name: 'Reports', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-beneficiaries').click();
    expect((await download).suggestedFilename()).toBe('beneficiaries.csv');
    await expect(page.getByText('Beneficiaries: 1 row downloaded.')).toBeVisible();
    const call = mock.reads(/analytics\/export\/beneficiaries$/)[0];
    expect(call.path).toBe('/b2b/organizations/org-1/analytics/export/beneficiaries');
    expect(call.query.period).toBe('this_month');
  });

  // Known today: raw <table>s inside cards (not in a scroll container) make <main> scroll sideways at
  // 375px by the amounts below. A migration may lower them, never raise them.
  test('no horizontal scroll at 375px (not worse than the known overflow)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/org/insights');
    await expect(page.getByTestId('insights-kpis')).toBeVisible();
    await expectNoHorizontalScroll(page, 0);
    await page.getByRole('button', { name: 'Programmes & benefits', exact: true }).click();
    await expect(page.getByTestId('insights-programs')).toBeVisible();
    await expectNoHorizontalScroll(page, 0);
  });

  test('every request was handled by the mock', async ({ page }) => {
    await page.goto('/org/insights');
    await page.getByRole('button', { name: 'People', exact: true }).click();
    await expect(page.getByTestId('insights-people')).toBeVisible();
    await page.getByRole('button', { name: 'Billing', exact: true }).click();
    await expect(page.getByText('Figures are from invoices and payments.')).toBeVisible();
    expect(mock.unmatched.map(c => `${c.method} ${c.path}`)).toEqual([]);
  });
});

test.describe('FitFlex staff overview', () => {
  let mock: B2BMock;
  test.beforeEach(async ({ page }) => {
    mock = await setupB2B(page, ADMIN);
  });

  test('renders KPIs, rankings and the data-quality table', async ({ page }) => {
    await page.goto('/admin/b2b-analytics');
    await expect(page.getByRole('heading', { name: 'B2B insights' })).toBeVisible();
    await expect(page.getByTestId('analytics-kpis')).toContainText('Organisations');
    await expect(page.getByTestId('analytics-kpis')).toContainText('TZS 480,000');
    await expect(page.getByTestId('analytics-top-orgs')).toContainText('Safari Cover');
    await expect(page.getByTestId('analytics-top-providers')).toContainText('Zanzibar Iron');
    await expect(page.getByTestId('data-quality')).toContainText('Beneficiaries not linked to an account');
    await expect(page.getByLabel('Period', { exact: true })).toBeVisible();
    await expect(page.getByTestId('analytics-open-org')).toBeVisible();
  });

  test('period filter and opening one organisation', async ({ page }) => {
    await page.goto('/admin/b2b-analytics');
    await page.getByLabel('Period', { exact: true }).selectOption('last_30_days');
    await expect.poll(() => mock.reads(/^\/admin\/b2b\/analytics$/).some(c => c.query.period === 'last_30_days')).toBe(true);
    await page.getByTestId('analytics-open-org').selectOption('org-1');
    await expect(page.getByTestId('org-insights')).toContainText('Safari Cover');
    expect(mock.reads(/organizations\/org-1\/analytics\/dashboard$/).length).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'All organisations' }).click();
    await expect(page.getByTestId('analytics-kpis')).toBeVisible();
    // The organisation can also be opened from the ranking.
    await page.getByTestId('analytics-top-orgs').getByRole('button', { name: 'Safari Cover' }).click();
    await expect(page.getByTestId('org-insights')).toBeVisible();
  });

  test('no horizontal scroll at 375px (not worse than the known overflow)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/admin/b2b-analytics');
    await expect(page.getByTestId('analytics-top-orgs')).toBeVisible();
    await expectNoHorizontalScroll(page, 0);
  });

  test('every request was handled by the mock', async ({ page }) => {
    await page.goto('/admin/b2b-analytics');
    await expect(page.getByTestId('data-quality')).toBeVisible();
    expect(mock.unmatched.map(c => `${c.method} ${c.path}`)).toEqual([]);
  });
});
