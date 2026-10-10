import { expect, test, Page } from '@playwright/test';
import { fresh, setup, SUPER, Opts } from './helpers/promotion-mock';

// Bookings and gym subscriptions credited to the promotion the member tapped.
const PHONE = { width: 390, height: 844 };
const noOverflow = async (page: Page) => {
  await page.locator('main').waitFor();
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => { const m = document.querySelector('main')!; return { doc: document.documentElement.scrollWidth, iw: window.innerWidth, mainSw: m.scrollWidth, mainCw: m.clientWidth }; });
  expect(r.doc).toBeLessThanOrEqual(r.iw);
  expect(r.mainSw).toBeLessThanOrEqual(r.mainCw);
};
const open = async (page: Page, opts: Partial<Opts>, locale = 'en') => { await setup(page, fresh(opts), SUPER, locale); };

test('tiles show bookings and subscriptions with their values, and the conversion rate', async ({ page }) => {
  await open(page, { conversions: 'full' });
  await page.goto('/admin/promotion-analytics');
  await expect(page.getByTestId('pan-value-bookings')).toHaveText('4');
  await expect(page.getByTestId('pan-sub-bookings')).toHaveText('TZS 200,000');
  await expect(page.getByTestId('pan-value-subscriptions')).toHaveText('2');
  await expect(page.getByTestId('pan-sub-subscriptions')).toHaveText('TZS 90,000');
  await expect(page.getByTestId('pan-value-conversionRate')).toHaveText('7.3%');
  await expect(page.getByTestId('pan-tile-conversionRate')).toContainText('Conversion rate');
  await expect(page.getByTestId('pan-sub-conversionRate')).toHaveText('conversions per click');
});

test('the table has bookings, subscriptions, purchases and conversion rate columns', async ({ page }) => {
  await open(page, { conversions: 'full' });
  await page.goto('/admin/promotion-analytics');
  const p1 = page.getByTestId('pan-row-p1');
  await expect(p1.getByTestId('pan-cell-bookings')).toContainText('4');
  await expect(p1.getByTestId('pan-cell-bookings')).toContainText('TZS 200,000');
  await expect(p1.getByTestId('pan-cell-subscriptions')).toContainText('TZS 90,000');
  await expect(p1.getByTestId('pan-cell-purchases')).toContainText('TZS 30,000');
  await expect(p1.getByTestId('pan-cell-conversionRate')).toHaveText('7.3%');
  // Nothing happened for the other one: zeros without a value line, a dash for the rate.
  const p2 = page.getByTestId('pan-row-p2');
  await expect(p2.getByTestId('pan-cell-bookings')).toHaveText('0');
  await expect(p2.getByTestId('pan-cell-subscriptions')).toHaveText('0');
  await expect(p2.getByTestId('pan-cell-conversionRate')).toHaveText('—');
  await expect(page.getByTestId('pan-table').locator('th')).toContainText(['Bookings', 'Subscriptions', 'Purchases', 'Conversion rate']);
});

test('the conversion rate is a dash while there are no clicks', async ({ page }) => {
  await open(page, { conversions: 'off' });
  await page.goto('/admin/promotion-analytics');
  await expect(page.getByTestId('pan-value-conversionRate')).toHaveText('—');
  await expect(page.getByTestId('pan-value-bookings')).toHaveText('0');
  await expect(page.getByTestId('pan-sub-bookings')).toHaveCount(0);
});

test('detail view breaks conversions down and adds placement columns', async ({ page }) => {
  await open(page, { conversions: 'full' });
  await page.goto('/admin/promotion-analytics?item=p1');
  await expect(page.getByTestId('pan-conv-count-bookings')).toHaveText('4');
  await expect(page.getByTestId('pan-conv-value-bookings')).toHaveText('TZS 200,000');
  await expect(page.getByTestId('pan-conv-count-subscriptions')).toHaveText('2');
  await expect(page.getByTestId('pan-conv-value-subscriptions')).toHaveText('TZS 90,000');
  await expect(page.getByTestId('pan-conv-count-purchases')).toHaveText('1');
  await expect(page.getByTestId('pan-conv-value-purchases')).toHaveText('TZS 30,000');
  await expect(page.getByTestId('pan-value-conversionRate')).toHaveText('7.3%');
  const row = page.getByTestId('pan-placement-gym_discovery');
  await expect(row.getByTestId('pan-placement-bookings')).toContainText('4');
  await expect(row.getByTestId('pan-placement-subscriptions')).toContainText('2');
  await expect(page.getByTestId('pan-placement-home').getByTestId('pan-placement-bookings')).toHaveText('0');
});

test('missing value fields count as zero and show no value line', async ({ page }) => {
  await open(page, { conversions: 'novalues' });
  await page.goto('/admin/promotion-analytics');
  await expect(page.getByTestId('pan-value-bookings')).toHaveText('4');
  await expect(page.getByTestId('pan-sub-bookings')).toHaveCount(0);
  await expect(page.getByTestId('pan-sub-subscriptions')).toHaveCount(0);
  await expect(page.getByTestId('pan-row-p1').getByTestId('pan-cell-bookings')).toHaveText('4');
  await page.goto('/admin/promotion-analytics?item=p1');
  await expect(page.getByTestId('pan-conv-count-bookings')).toHaveText('4');
  await expect(page.getByTestId('pan-conv-value-bookings')).toHaveCount(0);
  await expect(page.getByTestId('pan-conv-value-purchases')).toHaveText('TZS 30,000');
});

test('nothing overflows the page at phone width', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await open(page, { conversions: 'full' });
  await page.goto('/admin/promotion-analytics');
  await expect(page.getByTestId('pan-value-bookings')).toBeVisible();
  await noOverflow(page);
  await page.goto('/admin/promotion-analytics?item=p1');
  await expect(page.getByTestId('pan-conv-bookings')).toBeVisible();
  await noOverflow(page);
});

test('Swahili labels', async ({ page }) => {
  await open(page, { conversions: 'full' }, 'sw');
  await page.goto('/admin/promotion-analytics');
  await expect(page.getByTestId('pan-tile-bookings')).toContainText('Uhifadhi');
  await expect(page.getByTestId('pan-tile-subscriptions')).toContainText('Uanachama');
  await expect(page.getByTestId('pan-tile-conversionRate')).toContainText('Kiwango cha waliokamilisha');
  await expect(page.getByTestId('pan-table').locator('th')).toContainText(['Uhifadhi', 'Uanachama', 'Ununuzi', 'Waliokamilisha']);
  await page.getByTestId('pan-row-p1').click();
  await expect(page.getByTestId('pan-conversions')).toContainText('Waliokamilisha kwa aina');
});
