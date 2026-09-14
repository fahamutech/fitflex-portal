import { expect, request, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

function devToken(payload: Record<string, string>) {
  return `dev:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

async function session(ctx: Awaited<ReturnType<typeof request.newContext>>, role: string, suffix: string) {
  const email = role === 'admin' ? 'mama27j@gmail.com' : `${role}-${suffix}@marketplace.test`;
  const response = await ctx.post(`${API}/auth/firebase/session`, {
    data: {
      idToken: devToken({ uid: `fb_${role}_${suffix}`, email, name: `${role} Marketplace` }),
      requestedRole: role,
    },
  });
  expect(response.ok(), `${role} session`).toBeTruthy();
  return response.json() as Promise<{ token: string; user: Record<string, unknown> }>;
}

test('marketplace requirements: portal approval connects vendor, every buyer role, checkout, tracking, enquiry, settlement, review and staff ACL', async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const ctx = await request.newContext();
  const [admin, vendor, member, trainer, owner] = await Promise.all([
    session(ctx, 'admin', suffix),
    session(ctx, 'vendor', suffix),
    session(ctx, 'member', suffix),
    session(ctx, 'trainer', suffix),
    session(ctx, 'gym_owner', suffix),
  ]);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const profile = await ctx.put(`${API}/vendor/profile`, {
    headers: auth(vendor.token),
    data: {
      businessName: `Market Store ${suffix}`,
      logo: 'data:image/png;base64,bG9nbw==',
      banner: 'data:image/png;base64,YmFubmVy',
      description: 'End-to-end marketplace store',
      businessCategory: 'Equipment',
      contactNumber: '+255700000111',
      email: `store-${suffix}@marketplace.test`,
      address: 'Masaki, Dar es Salaam',
      deliveryRegions: ['Dar es Salaam', 'Arusha'],
      businessHours: { monday: '08:00-18:00' },
      settlementAccount: { provider: 'M-Pesa', account: '255700000111' },
      publish: true,
    },
  });
  expect(profile.ok()).toBeTruthy();
  expect((await profile.json()).status).toBe('published');

  const productName = `Marketplace Bands ${suffix}`;
  const created = await ctx.post(`${API}/vendor/products`, {
    headers: auth(vendor.token),
    data: {
      name: productName,
      description: 'Portable resistance band kit',
      category: 'Equipment',
      brand: 'FitFlex',
      priceTzs: 50000,
      discountPriceTzs: 45000,
      stock: 20,
      distanceKm: 4.5,
      sku: `BAND-${suffix}`,
      weightKg: 0.8,
      variants: [{ name: 'Green', stock: 10 }, { name: 'Black', stock: 10 }],
      images: ['data:image/png;base64,aW1hZ2Ux', 'data:image/png;base64,aW1hZ2Uy'],
      deliveryAvailable: true,
    },
  });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  expect(product.approvalStatus).toBe('pending');

  const beforeApproval = await ctx.get(`${API}/shop/products?search=${encodeURIComponent(productName)}`, {
    headers: auth(member.token),
  });
  expect(await beforeApproval.json()).toEqual([]);

  await page.goto('/login');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('locale', 'en');
  }, admin);
  await page.goto('/admin/products');
  await expect(page.getByText(productName)).toBeVisible();
  await page.getByLabel(`Listing approval: ${productName}`).selectOption('approved');
  const row = page.getByText(productName).locator('xpath=ancestor::div[contains(@class, "md:grid-cols")][1]');
  await row.getByRole('button', { name: 'Save listing' }).click();
  await expect(page.getByText('Listing updated.')).toBeVisible();

  for (const buyer of [member, trainer, owner]) {
    const catalogueStartedAt = Date.now();
    const catalogue = await ctx.get(
      `${API}/shop/products?category=Equipment&brand=FitFlex&minPrice=40000&maxPrice=46000&maxDistanceKm=5&delivery=true&promotions=true&sort=popularity`,
      { headers: auth(buyer.token) },
    );
    expect(Date.now() - catalogueStartedAt).toBeLessThan(3000);
    expect(catalogue.ok()).toBeTruthy();
    expect((await catalogue.json()).some((item: { id: string }) => item.id === product.id)).toBeTruthy();
  }

  const detail = await ctx.get(`${API}/shop/products/${product.id}`, { headers: auth(member.token) });
  expect(detail.ok()).toBeTruthy();
  const detailBody = await detail.json();
  expect(detailBody.images).toHaveLength(2);
  expect(detailBody.vendor.businessName).toBe(`Market Store ${suffix}`);
  expect(detailBody.similarProducts).toBeInstanceOf(Array);
  const store = await ctx.get(`${API}/shop/vendors/${vendor.user.id}`, { headers: auth(member.token) });
  expect(store.ok()).toBeTruthy();
  const storeBody = await store.json();
  expect(storeBody.businessName).toBe(`Market Store ${suffix}`);
  expect(storeBody.products.some((item: { id: string }) => item.id === product.id)).toBeTruthy();

  const enquiry = await ctx.post(`${API}/me/marketplace-enquiries`, {
    headers: auth(member.token),
    data: { productId: product.id, message: 'Can this be delivered to Arusha?' },
  });
  expect(enquiry.ok()).toBeTruthy();
  const enquiryBody = await enquiry.json();
  const inbox = await ctx.get(`${API}/vendor/enquiries?search=arusha`, { headers: auth(vendor.token) });
  expect((await inbox.json())).toHaveLength(1);
  await ctx.post(`${API}/vendor/enquiries/${enquiryBody.id}/reply`, {
    headers: auth(vendor.token), data: { message: 'Yes, delivery is available.' },
  });
  const resolved = await ctx.post(`${API}/vendor/enquiries/${enquiryBody.id}/resolve`, { headers: auth(vendor.token) });
  expect((await resolved.json()).status).toBe('resolved');

  const failedPayment = await ctx.post(`${API}/me/shop-orders`, {
    headers: auth(member.token),
    data: {
      items: [{ productId: product.id, qty: 1 }],
      deliveryMethod: 'home_delivery', deliveryAddress: 'Arusha',
      paymentMethod: 'mpesa', paymentOutcome: 'failed',
    },
  });
  expect(failedPayment.status()).toBe(402);

  const checkout = await ctx.post(`${API}/me/shop-orders`, {
    headers: auth(member.token),
    data: {
      items: [{ productId: product.id, qty: 2 }],
      deliveryMethod: 'home_delivery', deliveryAddress: 'Arusha',
      paymentMethod: 'mpesa', paymentOutcome: 'success',
    },
  });
  expect(checkout.ok()).toBeTruthy();
  const order = await checkout.json();
  for (const status of ['accepted', 'processing', 'packed', 'dispatched', 'delivered']) {
    const update = await ctx.post(`${API}/vendor/orders/${order.id}/status`, {
      headers: auth(vendor.token), data: { status },
    });
    expect(update.ok(), status).toBeTruthy();
  }
  const history = await ctx.get(`${API}/me/shop-orders`, { headers: auth(member.token) });
  const tracked = (await history.json()).find((item: { id: string }) => item.id === order.id);
  expect(tracked.status).toBe('delivered');
  expect(tracked.timeline.map((entry: { status: string }) => entry.status)).toEqual([
    'pending', 'accepted', 'processing', 'packed', 'dispatched', 'delivered',
  ]);

  const payments = await ctx.get(`${API}/vendor/payments`, { headers: auth(vendor.token) });
  expect((await payments.json()).todaySalesTzs).toBeGreaterThanOrEqual(90000);
  const statement = await ctx.get(`${API}/vendor/payments/statement`, { headers: auth(vendor.token) });
  expect(await statement.text()).toContain(order.id);
  const invoice = await ctx.get(`${API}/me/shop-orders/${order.id}/invoice`, { headers: auth(member.token) });
  expect(await invoice.text()).toContain('FitFlex Marketplace Invoice');
  const reordered = await ctx.post(`${API}/me/shop-orders/${order.id}/reorder`, { headers: auth(member.token) });
  expect((await reordered.json()).items).toEqual([{ productId: product.id, qty: 2 }]);
  const review = await ctx.post(`${API}/me/shop-orders/${order.id}/reviews`, {
    headers: auth(member.token), data: { productId: product.id, rating: 5, comment: 'Excellent bands' },
  });
  expect(review.ok()).toBeTruthy();

  const staffEmail = `stock-${suffix}@marketplace.test`;
  const staffPhone = `+2557${Date.now().toString().slice(-8)}`;
  const staff = await ctx.post(`${API}/vendor/staff`, {
    headers: auth(vendor.token),
    data: {
      name: 'Stock Manager', email: staffEmail, phone: staffPhone, password: 'Staff123',
      role: 'inventory_manager', permissions: ['products'],
    },
  });
  expect(staff.ok()).toBeTruthy();
  const staffBody = await staff.json();
  const staffLogin = await ctx.post(`${API}/auth/login`, {
    data: { email: staffEmail, password: 'Staff123', requestedRole: 'vendor' },
  });
  expect(staffLogin.ok()).toBeTruthy();
  const staffSession = await staffLogin.json();
  expect((await ctx.get(`${API}/vendor/products`, { headers: auth(staffSession.token) })).ok()).toBeTruthy();
  expect((await ctx.get(`${API}/vendor/payments`, { headers: auth(staffSession.token) })).status()).toBe(403);
  await ctx.post(`${API}/vendor/staff/${staffBody.id}/disable`, { headers: auth(vendor.token) });
  expect((await ctx.get(`${API}/vendor/products`, { headers: auth(staffSession.token) })).status()).toBe(403);
  expect((await ctx.post(`${API}/auth/login`, {
    data: { email: staffEmail, password: 'Staff123', requestedRole: 'vendor' },
  })).status()).toBe(403);

  await page.evaluate(() => localStorage.setItem('locale', 'sw'));
  await page.reload();
  await expect(page.getByText('Idhini ya orodha').first()).toBeVisible();
});
