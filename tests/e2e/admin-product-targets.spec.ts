import { expect, test, type Page, type Request } from '@playwright/test';

// Shop personalisation (S2) on /admin/products against a mocked API: "Made for" / "Age group" are
// read-only here (vendors set them in the app), the two list filters, the ordering-only note,
// graceful hiding on an older backend, and Swahili.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Reply = { status?: number; json: unknown } | ((req: Request) => { status?: number; json: unknown });
type Routes = Record<string, Reply>;

const ADMIN = { id: 'usr_admin', userType: 'admin', email: 'admin@example.com' };
const listing = { vendorId: 'usr_vendor', priceTzs: 85000, stock: 10, status: 'active', approvalStatus: 'approved', homepageVisible: true, homepagePriority: 0 };
const women = { ...listing, id: 'prd_w', name: 'Yoga Mat', targetGender: 'women', targetAgeBands: ['18_29', '30_44'] };
const men = { ...listing, id: 'prd_m', name: 'Beard Balm', targetGender: 'men', targetAgeBands: ['60_plus'] };
const plain = { ...listing, id: 'prd_p', name: 'Whey Protein', targetGender: null, targetAgeBands: [] };
const vendors = [{ id: 'usr_vendor', userType: 'vendor', approvalStatus: 'approved', accountStatus: 'active', productCount: 3, pendingProductCount: 0, vendorProfile: { businessName: 'Dar Fitness Gear' } }];

async function signedIn(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [ADMIN, locale] as const);
}

/** Every API call goes through here; unknown routes are 404. Returns the calls made. */
async function mockApi(page: Page, routes: Routes) {
  const calls: Array<{ method: string; path: string; search: string; body: unknown }> = [];
  await page.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, search: url.search, body });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req) : hit;
    return route.fulfill({ status: reply.status ?? 200, json: reply.json });
  });
  return calls;
}

/** Server-side filtering as the contract describes: targetGender / targetAgeBand query params. */
const filtered = (req: Request) => {
  const q = new URL(req.url()).searchParams;
  const g = q.get('targetGender'), b = q.get('targetAgeBand');
  const rows = [women, men, plain].filter(p =>
    (!g || (g === 'everyone' ? p.targetGender === null : p.targetGender === g))
    && (!b || (b === 'all' ? p.targetAgeBands.length === 0 : (p.targetAgeBands as string[]).includes(b))));
  return { json: rows };
};

const base = (extra: Routes = {}): Routes => ({
  'GET /admin/products': filtered,
  'GET /admin/vendors': { json: vendors },
  ...extra,
});
const productQueries = (calls: Array<{ method: string; path: string; search: string }>) =>
  calls.filter(c => c.method === 'GET' && c.path === '/admin/products').map(c => c.search);

test('rows show Made for and Age group, with the ordering-only note', async ({ page }) => {
  await signedIn(page);
  await mockApi(page, base());
  await page.goto('/admin/products');

  await expect(page.getByTestId('product-targets-prd_w')).toContainText('Made for: Women · Age group: 18–29, 30–44');
  await expect(page.getByTestId('product-targets-prd_m')).toContainText('Made for: Men · Age group: 60+');
  await expect(page.getByTestId('product-targets-prd_p')).toContainText('Made for: Everyone · Age group: All ages');
  // Screen readers get the bands as words (visually hidden text, visible digits hidden from them).
  await expect(page.getByTestId('product-targets-prd_w').locator('.sr-only')).toHaveText('18 to 29, 30 to 44');
  await expect(page.getByTestId('product-targets-prd_w').locator('[aria-hidden="true"]')).toHaveText('18–29, 30–44');
  await expect(page.getByTestId('product-targets-prd_m').locator('.sr-only')).toHaveText('60 and over');
  await expect(page.getByTestId('product-target-note')).toContainText('Vendors set "Made for" and "Age group" in the app. They only change the order products are shown in to members who keep "Personalised shop" on.');
  await expect(page.getByTestId('product-target-note')).toContainText('never change who can see or buy');
  // Read-only: no control edits the targets.
  await expect(page.getByRole('combobox', { name: /Made for/ })).toHaveCount(1);
  await expect(page.getByLabel('Filter: Made for')).toBeVisible();
});

test('filters go to the server, show the no-match state and clear', async ({ page }) => {
  await signedIn(page);
  const calls = await mockApi(page, base());
  await page.goto('/admin/products');
  await expect(page.getByText('Beard Balm')).toBeVisible();

  await page.getByLabel('Filter: Made for').selectOption('women');
  await expect(page.getByText('Beard Balm')).toHaveCount(0);
  await expect(page.getByText('Yoga Mat')).toBeVisible();
  expect(productQueries(calls)).toContain('?targetGender=women');

  await page.getByLabel('Filter: Age group').selectOption('60_plus');
  await expect(page.getByText('No products match these filters.')).toBeVisible();
  // Filters stay even though nothing matched.
  await expect(page.getByTestId('product-target-filters')).toBeVisible();
  expect(productQueries(calls)).toContain('?targetGender=women&targetAgeBand=60_plus');

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('Beard Balm')).toBeVisible();
  expect(productQueries(calls).at(-1)).toBe('');
});

test('saving a listing never sends target fields', async ({ page }) => {
  await signedIn(page);
  const calls = await mockApi(page, base({ 'PUT /admin/products/prd_w/listing': { json: women } }));
  await page.goto('/admin/products');
  await page.getByLabel('Listing priority: Yoga Mat').fill('3');
  await page.getByRole('button', { name: 'Save listing' }).first().click();
  await expect(page.getByText('Listing updated.')).toBeVisible();
  const put = calls.find(c => c.method === 'PUT');
  expect(put?.body).toBeTruthy();
  expect(Object.keys(put!.body as object)).not.toContain('targetGender');
  expect(Object.keys(put!.body as object)).not.toContain('targetAgeBands');
});

test('older backend without target fields: nothing new is shown and no filter is sent', async ({ page }) => {
  await signedIn(page);
  const old = [women, plain].map(({ targetGender: _g, targetAgeBands: _b, ...rest }) => rest);
  const calls = await mockApi(page, base({ 'GET /admin/products': { json: old } }));
  await page.goto('/admin/products');
  await expect(page.getByText('Yoga Mat')).toBeVisible();
  await expect(page.getByTestId('product-target-filters')).toHaveCount(0);
  await expect(page.getByTestId('product-target-note')).toHaveCount(0);
  await expect(page.getByTestId('product-targets-prd_w')).toHaveCount(0);
  expect(productQueries(calls).every(s => s === '')).toBe(true);
});

test('Swahili labels and note', async ({ page }) => {
  await signedIn(page, 'sw');
  await mockApi(page, base());
  await page.goto('/admin/products');
  await expect(page.getByTestId('product-targets-prd_w')).toContainText('Walengwa: Wanawake · Kundi la umri: 18–29, 30–44');
  await expect(page.getByTestId('product-targets-prd_w').locator('.sr-only')).toHaveText('18 hadi 29, 30 hadi 44');
  await expect(page.getByTestId('product-targets-prd_p')).toContainText('Walengwa: Wote · Kundi la umri: Umri wote');
  await expect(page.getByTestId('product-target-note')).toContainText('Wauzaji huchagua "Walengwa" na "Kundi la umri" kwenye app.');
  await expect(page.getByTestId('product-target-note')).toContainText('walioacha "Duka kwa ajili yako" likiwa limewashwa');
  // "Yoyote" (no filter) is distinct from "Wote" (Everyone).
  await expect(page.getByLabel('Chuja: Walengwa').locator('option').first()).toHaveText('Yoyote');
  await expect(page.getByLabel('Chuja: Walengwa').locator('option').nth(1)).toHaveText('Wote');
  await page.getByLabel('Chuja: Walengwa').selectOption('men');
  await page.getByLabel('Chuja: Kundi la umri').selectOption('18_29');
  await expect(page.getByText('Hakuna bidhaa zinazolingana na vichujio hivi.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Futa vichujio' })).toBeVisible();
});

test('filters live in the URL: refresh and Back restore them; unknown values are ignored', async ({ page }) => {
  await signedIn(page);
  const calls = await mockApi(page, base());
  await page.goto('/admin/products');
  await page.getByLabel('Filter: Made for').selectOption('women');
  await page.getByLabel('Filter: Age group').selectOption('30_44');
  await expect(page).toHaveURL(/\/admin\/products\/?\?targetGender=women&targetAgeBand=30_44$/);
  await expect(page.getByText('Yoga Mat')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Filter: Made for')).toHaveValue('women');
  await expect(page.getByLabel('Filter: Age group')).toHaveValue('30_44');
  await expect(page.getByText('Beard Balm')).toHaveCount(0);
  expect(productQueries(calls).at(-1)).toBe('?targetGender=women&targetAgeBand=30_44');

  await page.goto('about:blank');
  await page.goBack();
  await expect(page.getByLabel('Filter: Made for')).toHaveValue('women');
  await expect(page.getByLabel('Filter: Age group')).toHaveValue('30_44');

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/?$/);
  await expect(page.getByText('Beard Balm')).toBeVisible();

  await page.goto('/admin/products?targetGender=nobody&targetAgeBand=99');
  await expect(page.getByText('Beard Balm')).toBeVisible();
  await expect(page.getByLabel('Filter: Made for')).toHaveValue('');
  expect(productQueries(calls).at(-1)).toBe('');
});

test('filter card content is inset from the card edge', async ({ page }) => {
  await signedIn(page);
  await mockApi(page, base());
  await page.goto('/admin/products');
  const filters = page.getByTestId('product-target-filters');
  const note = page.getByTestId('product-target-note');
  await expect(note).toBeVisible();
  const cardOf = (el: typeof filters) => el.locator('xpath=ancestor::div[contains(@class,"radius-xl")][1]');
  const card = cardOf(filters);
  const [c, f, n] = await Promise.all([card.boundingBox(), filters.boundingBox(), note.boundingBox()]);
  expect(f!.x - c!.x).toBeGreaterThanOrEqual(16);
  expect(f!.y - c!.y).toBeGreaterThanOrEqual(16);
  expect(c!.x + c!.width - (n!.x + n!.width)).toBeGreaterThanOrEqual(16);
  expect(c!.y + c!.height - (n!.y + n!.height)).toBeGreaterThanOrEqual(16);
  // Product row cards are inset the same way.
  const row = page.getByTestId('product-targets-prd_w');
  const [rc, r] = await Promise.all([cardOf(row).boundingBox(), row.boundingBox()]);
  expect(r!.x - rc!.x).toBeGreaterThanOrEqual(16);
});

test('Swahili at 375 px: header buttons fit, status badge translated', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signedIn(page, 'sw');
  await mockApi(page, base({ 'GET /admin/products': { json: [women, { ...men, status: 'paused' }] } }));
  await page.goto('/admin/products');
  const recompute = page.getByRole('button', { name: 'Hesabu upya alama na mauzo' });
  await expect(recompute).toBeVisible();
  const box = await recompute.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(await recompute.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const name of ['Sasisha', 'Ongeza bidhaa']) {
    const b = page.getByRole('button', { name });
    const bb = await b.boundingBox(); expect(bb!.x + bb!.width).toBeLessThanOrEqual(375);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expect(page.getByText('Inauzwa', { exact: true })).toBeVisible();
  await expect(page.getByText('Imesimamishwa', { exact: true })).toBeVisible();
  await expect(page.getByText('active', { exact: true })).toHaveCount(0);
});
