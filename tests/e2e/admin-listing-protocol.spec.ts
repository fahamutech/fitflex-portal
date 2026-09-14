import { expect, request, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

function devToken(payload: Record<string, string>) {
  return `dev:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

test('UAT 55: admin controls product homepage visibility and priority in a real browser', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const ctx = await request.newContext();
  const adminSession = await ctx.post(`${API}/auth/firebase/session`, {
    data: {
      idToken: devToken({ uid: `fb_admin_listing_${suffix}`, email: 'mama27j@gmail.com', name: 'FitFlex Admin' }),
      requestedRole: 'admin',
    },
  });
  expect(adminSession.ok()).toBeTruthy();
  const { token: adminToken, user: adminUser } = await adminSession.json();

  const vendorSession = await ctx.post(`${API}/auth/firebase/session`, {
    data: {
      idToken: devToken({ uid: `fb_vendor_listing_${suffix}`, email: `vendor-${suffix}@example.com`, name: 'Listing Vendor' }),
      requestedRole: 'vendor',
    },
  });
  expect(vendorSession.ok()).toBeTruthy();
  const { token: vendorToken } = await vendorSession.json();
  const productName = `Priority Product ${suffix}`;
  const created = await ctx.post(`${API}/vendor/products`, {
    headers: { Authorization: `Bearer ${vendorToken}` },
    data: { name: productName, priceTzs: 25000, stock: 12 },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto('/login');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('locale', 'en');
  }, { token: adminToken, user: adminUser });

  await page.goto('/admin/products');
  await expect(page.getByRole('heading', { name: 'Product listings' })).toBeVisible();
  await expect(page.getByText(productName)).toBeVisible();
  const productRow = page.getByText(productName).locator('xpath=ancestor::div[contains(@class, "md:grid-cols")][1]');
  await page.getByLabel(`Listing approval: ${productName}`).selectOption('approved');
  await page.getByLabel(`Listing priority: ${productName}`).fill('9000');
  await page.getByLabel(`Show in member listings: ${productName}`).uncheck();
  await productRow.getByRole('button', { name: 'Save listing' }).click();
  await expect(page.getByText('Listing updated.')).toBeVisible();

  const hiddenCatalogue = await ctx.get(`${API}/shop/products`, {
    headers: { Authorization: `Bearer ${vendorToken}` },
  });
  expect(hiddenCatalogue.ok()).toBeTruthy();
  expect((await hiddenCatalogue.json()).some((product: { name: string }) => product.name === productName)).toBeFalsy();

  await page.getByLabel(`Show in member listings: ${productName}`).check();
  await productRow.getByRole('button', { name: 'Save listing' }).click();
  const visibleCatalogue = await ctx.get(`${API}/shop/products`, {
    headers: { Authorization: `Bearer ${vendorToken}` },
  });
  const products = await visibleCatalogue.json();
  expect(products[0].name).toBe(productName);

  await page.evaluate(() => localStorage.setItem('locale', 'sw'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Orodha za bidhaa' })).toBeVisible();
  await expect(page.getByText('Onyesha kwenye orodha za wanachama').first()).toBeVisible();
});
