import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

test('admin manages vendor verification and creates a vendor-owned product', async ({ page }) => {
  let vendorPatch: Record<string, unknown> | null = null;
  let createdProduct: Record<string, unknown> | null = null;
  const vendor = {
    id: 'vendor-1', userType: 'vendor', displayName: 'Asha Seller', email: 'asha@example.com',
    phone: '+255700000001', approvalStatus: 'approved', accountStatus: 'active', verified: false,
    productCount: 0, pendingProductCount: 0,
    vendorProfile: { businessName: 'Asha Fitness Store', businessCategory: 'Equipment', address: 'Dar es Salaam' },
  };

  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/admin/vendors/vendor-1' && request.method() === 'PUT') {
      vendorPatch = request.postDataJSON();
      return route.fulfill({ json: { ...vendor, ...vendorPatch } });
    }
    if (url.pathname === '/admin/vendors') return route.fulfill({ json: [vendor] });
    if (url.pathname === '/admin/products' && request.method() === 'POST') {
      createdProduct = request.postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'product-1', status: 'active', ...createdProduct } });
    }
    if (url.pathname === '/admin/products') return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/vendors');
  await expect(page.getByText('Asha Fitness Store')).toBeVisible();
  await page.getByTitle('Verify').click();
  await expect.poll(() => vendorPatch).toMatchObject({ verified: true });

  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Create product' }).click();
  await page.getByLabel('Vendor').selectOption('vendor-1');
  await page.getByLabel('Product name').fill('Competition Kettlebell');
  await page.getByLabel('Price (TZS)').fill('65000');
  await page.getByLabel('Stock').fill('4');
  await page.getByRole('button', { name: 'Create product', exact: true }).last().click();

  await expect.poll(() => createdProduct).toMatchObject({
    vendorId: 'vendor-1', name: 'Competition Kettlebell', priceTzs: 65000, stock: 4,
  });
  await expect(page.getByText('Product created.')).toBeVisible();
});
