import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const FLUTTER_WEB = process.env.FITFLEX_FLUTTER_WEB_URL || 'http://127.0.0.1:8082';
const EVIDENCE = '/Users/joshuamshana/FitFlexPlatform/FeedbackDocs/uat-evidence-27.08.26';

async function enableSemantics(page: import('@playwright/test').Page) {
  const placeholder = page.locator('flt-semantics-placeholder');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await placeholder.count()) {
      await placeholder.evaluate((element) => (element as HTMLElement).click());
    }
    if (await page.getByText('English').isVisible().catch(() => false)) return;
    await page.waitForTimeout(500);
  }
  await expect(page.getByText('English')).toBeVisible();
}

async function enterRoleScreen(page: import('@playwright/test').Page) {
  await page.getByText('English').click();
  await page.getByText('Continue', { exact: true }).click();
  await page.getByText('Create account').click();
  await expect(page.getByText('Welcome to FitFlex')).toBeVisible();
}

test('Flutter web fallback proves vendor operations and buyer checkout on a real browser', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  await page.goto(`${FLUTTER_WEB}/?marketplace-proof=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('flt-semantics-placeholder')
    .waitFor({ state: 'attached', timeout: 90_000 });
  await enableSemantics(page);
  await enterRoleScreen(page);

  await page.getByText('Vendor', { exact: true }).last().click();
  await expect(page.getByText('Vendor marketplace')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Products' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Payments' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Messages' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Business' })).toBeVisible();

  await page.getByRole('tab', { name: 'Payments' }).click();
  await expect(page.getByText("Today's sales")).toBeVisible();
  await expect(page.getByText('Download statement')).toBeVisible();
  const statementEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download statement' }).click();
  const statement = await statementEvent;
  expect(statement.suggestedFilename()).toBe('fitflex-vendor-statement.csv');
  await statement.saveAs(`${EVIDENCE}/marketplace-statement.csv`);
  expect(await readFile(`${EVIDENCE}/marketplace-statement.csv`, 'utf8')).toContain('order_id,amount_tzs');
  await page.screenshot({ path: `${EVIDENCE}/marketplace-vendor-payments-live.png`, fullPage: true });

  await page.getByRole('tab', { name: 'Business' }).click();
  await expect(page.getByRole('group', { name: /FitFlex Performance Store/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add staff' })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/marketplace-vendor-business-live.png`, fullPage: true });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('English')).toBeVisible();
  await enterRoleScreen(page);
  await page.getByText('Member', { exact: true }).last().click();
  await expect(page.getByText('Dev Member')).toBeVisible();

  await page.getByRole('tab', { name: 'Shop' }).click();
  await expect(page.getByText('Browse')).toBeVisible();
  await page.getByRole('button', { name: /Sort Newest/ }).click();
  await page.getByRole('menuitem', { name: 'Most popular' }).click();
  await expect(page.getByRole('button', { name: /Sort Most popular/ })).toBeVisible();
  await page.getByRole('button', { name: 'More filters' }).click();
  await expect(page.getByLabel('Brand')).toBeVisible();
  await expect(page.getByLabel('Maximum distance (km)')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  const search = page.getByRole('textbox', { name: 'Search products' });
  await search.click();
  await search.pressSequentially('Resistance Bands', { delay: 30 });
  const product = page.getByRole('group', { name: /FitFlex Resistance Bands/ });
  await expect(product).toBeVisible();
  await product.click();
  await expect(page.getByText('Reviews', { exact: true })).toBeVisible();
  await page.mouse.wheel(0, 900);
  await expect(page.getByRole('button', { name: 'Chat with vendor' })).toBeVisible();
  await page.getByRole('button', { name: 'Visit store' }).click();
  await expect(page.getByRole('img', { name: /FitFlex Performance Store/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search this store' })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/marketplace-buyer-storefront-live.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Buy now', exact: true }).click();
  await page.getByRole('radio', { name: 'Gym pickup' }).click();
  await page.getByLabel('Search pickup gyms').fill('Test Gym');
  await page.getByRole('button', { name: 'Search or select pickup gym' }).click();
  await page.getByRole('menuitem', { name: 'Test Gym · Makumbusho' }).first().click();
  await page.getByText('Pay and place order').click();
  await expect(
    page.getByText('Order placed — the vendor will confirm it.').last(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'My orders' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: /Order ord_.*pending/ }).first(),
  ).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/marketplace-buyer-order-live.png`, fullPage: true });
  await page.getByRole('button', { name: 'Invoice', exact: true }).first().click();
  const receiptEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download receipt' }).click();
  const receipt = await receiptEvent;
  expect(receipt.suggestedFilename()).toMatch(/^fitflex-receipt-ord_.*\.txt$/);
  await receipt.saveAs(`${EVIDENCE}/marketplace-receipt.txt`);
  expect(await readFile(`${EVIDENCE}/marketplace-receipt.txt`, 'utf8')).toContain('FitFlex Marketplace Invoice');
  const orderId = receipt.suggestedFilename().replace('fitflex-receipt-', '').replace('.txt', '');
  const api = process.env.FITFLEX_API_URL || 'http://127.0.0.1:3100';
  const vendorResponse = await page.request.post(`${api}/auth/dev/login`, { data: { role: 'vendor' } });
  expect(vendorResponse.ok()).toBeTruthy();
  const vendorSession = await vendorResponse.json();
  const update = await page.request.post(`${api}/vendor/orders/${orderId}/status`, {
    headers: { Authorization: `Bearer ${vendorSession.token}` },
    data: { status: 'accepted' },
  });
  expect(update.ok()).toBeTruthy();
  await expect(page.getByRole('group', { name: new RegExp(`Order ${orderId}.*accepted`) })).toBeVisible({ timeout: 20000 });
});

for (const role of [
  { login: 'Gym Owner' },
  { login: 'Trainer' },
]) {
  test(`${role.login} can enter the live marketplace in Flutter web`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${FLUTTER_WEB}/?marketplace-role=${role.login}-${Date.now()}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('flt-semantics-placeholder').waitFor({ state: 'attached', timeout: 90_000 });
    await enableSemantics(page);
    await enterRoleScreen(page);
    await page.getByText(role.login, { exact: true }).last().click();
    await page.getByRole('button', { name: 'Shop', exact: true }).click();
    await expect(page.getByText('Browse', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search products' })).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE}/marketplace-${role.login.toLowerCase().replace(' ', '-')}-shop-live.png`,
      fullPage: true,
    });
  });
}
