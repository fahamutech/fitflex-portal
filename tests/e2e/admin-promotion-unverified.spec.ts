import { expect, test, Page } from '@playwright/test';
import { fresh, setup, SUPER, Opts } from './helpers/promotion-mock';

// The "events were not counted" notice on the dashboard, the promotion detail view and the campaign performance section.
const PHONE = { width: 390, height: 844 };
const start = async (page: Page, opts: Partial<Opts> = {}, locale = 'en') => { await setup(page, fresh(opts), SUPER, locale); };
const SCREENS: Array<[string, string, string]> = [
  ['dashboard', '/admin/promotion-analytics', 'pan-tile-impressions'],
  ['promotion detail', '/admin/promotion-analytics?item=p1', 'pan-name'],
  ['campaign performance', '/admin/promotion-campaigns?item=camp-1', 'campaign-performance-tiles'],
];

for (const [name, url, ready] of SCREENS) {
  test.describe(name, () => {
    test('shows the notice with the number and formats big numbers', async ({ page }) => {
      await start(page, { unverified: 1234567 });
      await page.goto(url);
      await expect(page.getByTestId(ready)).toBeVisible();
      const note = page.getByTestId('pan-unverified');
      await expect(note).toBeVisible();
      await expect(note).toContainText('1,234,567 events from older app versions, or without proof, were not counted.');
      await expect(note).toContainText('only include verified events');
    });

    test('says "event" for exactly one', async ({ page }) => {
      await start(page, { unverified: 1 });
      await page.goto(url);
      await expect(page.getByTestId('pan-unverified')).toContainText('1 event from an older app version, or without proof, was not counted.');
    });

    test('is absent when the count is 0', async ({ page }) => {
      await start(page, { unverified: 0 });
      await page.goto(url);
      await expect(page.getByTestId(ready)).toBeVisible();
      await expect(page.getByTestId('pan-unverified')).toHaveCount(0);
    });

    test('is absent when an older server does not send the field', async ({ page }) => {
      await start(page, {});
      await page.goto(url);
      await expect(page.getByTestId(ready)).toBeVisible();
      await expect(page.getByTestId('pan-unverified')).toHaveCount(0);
    });

    test('fits a 390px phone with the notice shown', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await start(page, { unverified: 98765432 });
      await page.goto(url);
      await expect(page.getByTestId('pan-unverified')).toBeVisible();
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => { const m = document.querySelector('main')!; return { doc: document.documentElement.scrollWidth, iw: window.innerWidth, mainSw: m.scrollWidth, mainCw: m.clientWidth }; });
      expect(r.doc).toBeLessThanOrEqual(r.iw);
      expect(r.mainSw).toBeLessThanOrEqual(r.mainCw);
    });
  });
}

test('the notice is also shown when the rest of the response is sparse', async ({ page }) => {
  await start(page, { unverified: 7, sparse: true });
  await page.goto('/admin/promotion-analytics?item=p1');
  await expect(page.getByTestId('pan-unverified')).toContainText('7 events');
});

test('Swahili: plural and singular', async ({ page }) => {
  await start(page, { unverified: 1200 }, 'sw');
  await page.goto('/admin/promotion-analytics');
  const note = page.getByTestId('pan-unverified');
  await expect(note).toContainText('Baadhi ya matukio hayakuhesabiwa');
  await expect(note).toContainText('Matukio 1,200 kutoka matoleo ya zamani ya programu');
  await expect(note).toContainText('matukio yaliyothibitishwa tu');
  const page2 = await page.context().newPage();
  await setup(page2, fresh({ unverified: 1 }), SUPER, 'sw');
  await page2.goto('/admin/promotion-analytics');
  await expect(page2.getByTestId('pan-unverified')).toContainText('Tukio 1 kutoka toleo la zamani la programu');
});
