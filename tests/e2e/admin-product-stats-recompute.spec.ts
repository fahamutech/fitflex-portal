import { expect, test, type Page, type Request } from '@playwright/test';

// One-off recompute of product rating / reviewCount / soldCount from real reviews and orders
// (admin products page) against a mocked API: dry-run review, apply, empty state, errors, Swahili.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const RECOMPUTE = 'POST /admin/shop/product-stats/recompute';

type Reply = { status?: number; json: unknown } | ((req: Request) => { status?: number; json: unknown });
type Routes = Record<string, Reply>;

const ADMIN = { id: 'usr_admin', userType: 'admin', email: 'admin@example.com' };
const product = { id: 'prd_1', vendorId: 'usr_vendor', name: 'Whey Protein', priceTzs: 85000, stock: 10, status: 'active', approvalStatus: 'approved', homepageVisible: true, homepagePriority: 0 };
const vendors = [{ id: 'usr_vendor', userType: 'vendor', approvalStatus: 'approved', accountStatus: 'active', productCount: 1, pendingProductCount: 0, vendorProfile: { businessName: 'Dar Fitness Gear' } }];

const changed = [
  { productId: 'prd_1', name: 'Whey Protein', vendorId: 'usr_vendor', before: { rating: 5, reviewCount: 12, soldCount: 1200 }, after: { rating: 4.333333, reviewCount: 3, soldCount: 7 } },
  { productId: 'prd_2', name: 'Shaker Bottle', vendorId: 'usr_vendor', before: { rating: 4.5, reviewCount: 2, soldCount: 0 }, after: { rating: 4.5, reviewCount: 2, soldCount: 4 } },
];
const dryRun = { dryRun: true, checked: 5, changed, unchanged: 3 };
const applied = { dryRun: false, checked: 5, changed, unchanged: 3, appliedAt: '2026-10-20T09:15:00.000Z', runId: 'psr_0001' };

async function signedIn(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [ADMIN, locale] as const);
}

/** Every API call goes through here; unknown routes are 404. Returns the calls made. */
async function mockApi(page: Page, routes: Routes) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  await page.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, body });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req) : hit;
    return route.fulfill({ status: reply.status ?? 200, json: reply.json });
  });
  return calls;
}

const base = (extra: Routes = {}): Routes => ({
  'GET /admin/products': { json: [product] },
  'GET /admin/vendors': { json: vendors },
  ...extra,
});
const recomputeCalls = (calls: Array<{ path: string; body: unknown }>) =>
  calls.filter(c => c.path === '/admin/shop/product-stats/recompute').map(c => c.body);

test('dry run shows counts and before → after per product; Cancel writes nothing', async ({ page }) => {
  await signedIn(page);
  const calls = await mockApi(page, base({ [RECOMPUTE]: { json: dryRun } }));
  await page.goto('/admin/products');
  await expect(page.getByText('Whey Protein').first()).toBeVisible();

  await page.getByRole('button', { name: 'Recompute ratings & sales' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recompute ratings & sales' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Ratings, review counts and sold counts are worked out again from real reviews and orders.')).toBeVisible();
  const stats = dialog.getByTestId('product-stats-recompute');
  await expect(stats.locator('dt', { hasText: 'Checked' }).locator('xpath=following-sibling::dd')).toHaveText('5');
  await expect(stats.locator('dt', { hasText: 'Will change' }).locator('xpath=following-sibling::dd')).toHaveText('2');
  await expect(stats.locator('dt', { hasText: 'Unchanged' }).locator('xpath=following-sibling::dd')).toHaveText('3');

  const row1 = dialog.getByTestId('recompute-row-prd_1');
  await expect(row1).toContainText('Vendor: Dar Fitness Gear');
  await expect(row1.getByRole('cell', { name: 'was 5, now 4.33' })).toBeVisible();
  await expect(row1.getByRole('cell', { name: 'was 12, now 3' })).toBeVisible();
  await expect(row1.getByRole('cell', { name: 'was 1,200, now 7' })).toBeVisible();
  const row2 = dialog.getByTestId('recompute-row-prd_2');
  await expect(row2.getByRole('cell', { name: 'was 0, now 4' })).toBeVisible();
  await expect(row2.getByRole('cell', { name: 'was 4.5, now 4.5' })).not.toContainText('→');

  expect(recomputeCalls(calls)).toEqual([{ apply: false }]);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(recomputeCalls(calls)).toEqual([{ apply: false }]);
});

test('Apply changes sends apply true, is disabled while running and shows when it was applied', async ({ page }) => {
  await signedIn(page);
  let release: () => void = () => {};
  const gate = new Promise<void>(r => { release = r; });
  const calls = await mockApi(page, base());
  // Hold the apply reply until the busy state has been checked.
  await page.route(`${API}/admin/shop/product-stats/recompute`, async route => {
    const body = route.request().postDataJSON() as { apply?: boolean };
    calls.push({ method: 'POST', path: '/admin/shop/product-stats/recompute', body });
    if (body.apply) await gate;
    return route.fulfill({ json: body.apply ? applied : dryRun });
  });
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Recompute ratings & sales' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recompute ratings & sales' });
  await expect(dialog.getByText('Applying overwrites the stored rating, reviews and sold count of the products listed.')).toBeVisible();

  const apply = dialog.getByRole('button', { name: 'Apply changes' });
  await apply.click();
  await expect(apply).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  release();

  const when = new Date(applied.appliedAt).toLocaleString();
  await expect(dialog.getByText(`Changes applied on ${when}.`)).toBeVisible();
  await expect(dialog.getByText('Run ID: psr_0001')).toBeVisible();
  await expect(dialog.getByTestId('product-stats-recompute').locator('dt', { hasText: /^Changed$/ }).locator('xpath=following-sibling::dd')).toHaveText('2');
  await expect(dialog.getByRole('button', { name: 'Apply changes' })).toHaveCount(0);
  expect(recomputeCalls(calls)).toEqual([{ apply: false }, { apply: true }]);
  await dialog.getByRole('button', { name: 'Close' }).last().click();
  await expect(dialog).toBeHidden();
});

test('nothing to change shows the empty state and no Apply button', async ({ page }) => {
  await signedIn(page);
  await mockApi(page, base({ [RECOMPUTE]: { json: { dryRun: true, checked: 4, changed: [], unchanged: 4 } } }));
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Recompute ratings & sales' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recompute ratings & sales' });
  await expect(dialog.getByText("Nothing to change. Every product's rating, reviews and sold count already match real reviews and orders.")).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Apply changes' })).toHaveCount(0);
  await expect(dialog.getByRole('table')).toHaveCount(0);
});

test('errors: a failed dry run, a 403 and a failed apply are shown as alerts', async ({ page }) => {
  await signedIn(page);
  let mode: 'fail' | 'forbidden' | 'applyFails' = 'fail';
  await mockApi(page, base({
    [RECOMPUTE]: (req) => {
      const apply = (req.postDataJSON() as { apply?: boolean }).apply;
      if (mode === 'fail') return { status: 500, json: { error: 'internal' } };
      if (mode === 'forbidden') return { status: 403, json: { error: 'forbidden' } };
      return apply ? { status: 500, json: { error: 'internal' } } : { json: dryRun };
    },
  }));
  await page.goto('/admin/products');
  const action = page.getByRole('button', { name: 'Recompute ratings & sales' });

  await action.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ratings and sales could not be recomputed. Try again.' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  mode = 'forbidden';
  await action.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Only FitFlex admins can recompute ratings and sales.' })).toBeVisible();

  mode = 'applyFails';
  await action.click();
  const dialog = page.getByRole('dialog', { name: 'Recompute ratings & sales' });
  await dialog.getByRole('button', { name: 'Apply changes' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'Ratings and sales could not be recomputed. Try again.' })).toBeVisible();
  // Still open and retryable; nothing reported as applied.
  await expect(dialog.getByRole('button', { name: 'Apply changes' })).toBeEnabled();
  await expect(dialog.getByText(/Changes applied on/)).toHaveCount(0);
});

test('409 recompute_in_progress: apply shows the already-running message and can be retried', async ({ page }) => {
  await signedIn(page);
  let busy = true;
  const calls = await mockApi(page, base({
    [RECOMPUTE]: (req) => {
      const apply = (req.postDataJSON() as { apply?: boolean }).apply;
      if (!apply) return { json: dryRun };
      return busy ? { status: 409, json: { error: 'recompute_in_progress' } } : { json: applied };
    },
  }));
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Recompute ratings & sales' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recompute ratings & sales' });
  await dialog.getByRole('button', { name: 'Apply changes' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'A recompute is already running. Try again in a minute.' })).toBeVisible();
  await expect(dialog.getByText(/Changes applied on/)).toHaveCount(0);

  busy = false;
  await dialog.getByRole('button', { name: 'Apply changes' }).click();
  await expect(dialog.getByText('Run ID: psr_0001')).toBeVisible();
  await expect(dialog.getByText('A recompute is already running. Try again in a minute.')).toHaveCount(0);
  expect(recomputeCalls(calls)).toEqual([{ apply: false }, { apply: true }, { apply: true }]);
});

test('Swahili: action, columns and counts', async ({ page }) => {
  await signedIn(page, 'sw');
  await mockApi(page, base({ [RECOMPUTE]: { json: dryRun } }));
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Hesabu upya alama na mauzo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hesabu upya alama na mauzo' });
  await expect(dialog.getByRole('columnheader', { name: 'Alama' })).toBeVisible();
  await expect(dialog.getByRole('columnheader', { name: 'Maoni' })).toBeVisible();
  await expect(dialog.getByRole('columnheader', { name: 'Zilizouzwa' })).toBeVisible();
  await expect(dialog.getByText('Zitabadilika')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Tumia mabadiliko' })).toBeVisible();
});
