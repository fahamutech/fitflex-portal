import { expect, Page, test } from '@playwright/test';

// Shop Phase 2 slice 3 ("Popular near you"): admins map vendors to areas on /admin/vendors.
// Contract: fitflex-functions docs/shop-near-you-api.md (vendorProfile.cityId, regionId, deliveryAreaIds, areasSource).
// AREAS are raw GET /admin/geo-areas rows (active, nameSw); /shop/areas rows are built from them (names, locatable, no active).
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

const AREAS = [
  { id: 'tz', level: 'country', name: 'Tanzania', parentId: null, active: true },
  { id: 'tz-dar', level: 'region', name: 'Dar es Salaam', parentId: 'tz', active: true },
  { id: 'tz-dar-city', level: 'city', name: 'Dar es Salaam', parentId: 'tz-dar', active: true },
  { id: 'tz-dar-kinondoni', level: 'district', name: 'Kinondoni', parentId: 'tz-dar-city', active: true },
  { id: 'tz-aru', level: 'region', name: 'Arusha', parentId: 'tz', active: true },
  { id: 'tz-aru-city', level: 'city', name: 'Arusha City', nameSw: 'Jiji la Arusha', parentId: 'tz-aru', active: true },
  { id: 'tz-mwz', level: 'region', name: 'Mwanza', parentId: 'tz', active: false },
  { id: 'tz-znz', level: 'region', name: 'Zanzibar', parentId: 'tz', active: true },
  { id: 'tz-znz-city', level: 'city', name: 'Zanzibar City', nameSw: 'Mji wa Zanzibar', parentId: 'tz-znz', active: true },
];

const base = { userType: 'vendor', approvalStatus: 'approved', accountStatus: 'active', productCount: 2, pendingProductCount: 0, kycExempt: true };
const mapped = { ...base, id: 'v-mapped', vendorProfile: { businessName: 'Kinondoni Gear', cityId: 'tz-dar-kinondoni', regionId: 'tz-dar', deliveryAreaIds: ['tz-dar', 'tz-aru'], areasSource: 'vendor' } };
const unmapped = { ...base, id: 'v-unmapped', vendorProfile: { businessName: 'Asha Fitness Store', address: 'Plot 4, Mikocheni', deliveryRegions: ['Dar es Salaam', 'Arusha', 'Mbeya'] } };
// Stored areas that are no longer usable: Mwanza is inactive, the city was deleted.
const stale = { ...base, id: 'v-stale', vendorProfile: { businessName: 'Old Lake Sports', cityId: 'tz-gone-city', regionId: 'tz-gone', deliveryAreaIds: ['tz-dar', 'tz-mwz'], areasSource: 'vendor' } };
// One stored area that is no longer usable.
const stale1 = { ...base, id: 'v-stale1', vendorProfile: { businessName: 'Lake Runners', cityId: 'tz-aru-city', regionId: 'tz-aru', deliveryAreaIds: ['tz-aru', 'tz-mwz'], areasSource: 'vendor' } };
const guessed = { ...base, id: 'v-guessed', vendorProfile: { businessName: 'Nationwide Supplements', deliveryAreaIds: ['tz'], areasSource: 'backfill', deliveryRegions: 'Tanzania nzima' } };

type Mock = { geoAreas?: 'ok' | 'forbidden' | 'empty'; shopAreas?: 'ok' | 'disabled'; put?: 'ok' | 'invalid' };

async function setup(page: Page, mock: Mock = {}, locale = 'en') {
  const puts: Array<Record<string, unknown>> = [];
  await page.addInitScript((l) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
    localStorage.setItem('locale', l);
  }, locale);
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/admin/vendors') return route.fulfill({ json: [mapped, unmapped, guessed, stale, stale1] });
    if (path === '/admin/geo-areas') {
      if (mock.geoAreas === 'forbidden') return route.fulfill({ status: 403, json: { error: 'forbidden' } });
      return route.fulfill({ json: { areas: mock.geoAreas === 'empty' ? [] : AREAS } });
    }
    if (path === '/shop/areas') {
      if (mock.shopAreas === 'disabled') return route.fulfill({ status: 404, json: { error: 'feature_disabled' } });
      const rows = AREAS.filter(a => a.active).map(({ active: _a, nameSw, ...a }) => ({
        ...a, names: { en: a.name, sw: nameSw || a.name }, locatable: a.level !== 'country', lat: null, lng: null, radiusKm: null,
      }));
      return route.fulfill({ json: { areas: rows } });
    }
    if (path === '/admin/vendors/v-unmapped' && req.method() === 'PUT') {
      const body = req.postDataJSON();
      puts.push(body);
      if (mock.put === 'invalid') return route.fulfill({ status: 400, json: { error: 'invalid_area', field: 'deliveryAreaIds', ids: ['tz-aru'], reason: 'inactive' } });
      return route.fulfill({ json: { ...unmapped, vendorProfile: { ...unmapped.vendorProfile, ...body, regionId: 'tz-dar', areasSource: 'admin' } } });
    }
    if (path.startsWith('/admin/vendors/') && req.method() === 'PUT') {
      const body = req.postDataJSON();
      puts.push(body);
      const v = [mapped, guessed, stale].find(x => path.endsWith(`/${x.id}`))!;
      return route.fulfill({ json: { ...v, vendorProfile: { ...v.vendorProfile, ...body, areasSource: 'admin' } } });
    }
    return route.fulfill({ json: [] });
  });
  return puts;
}

test('vendors table shows Based in and Delivers to, and filters unmapped and guessed vendors', async ({ page }) => {
  await setup(page);
  await page.goto('/admin/vendors');
  await expect(page.getByRole('columnheader', { name: 'Where they sell' })).toBeVisible();
  const mappedCell = page.getByTestId('vendor-areas-v-mapped');
  await expect(mappedCell).toContainText('Based in: Kinondoni (Dar es Salaam)');
  await expect(mappedCell).toContainText('Delivers to: Dar es Salaam, Arusha');
  await expect(page.getByTestId('vendor-areas-v-guessed')).toContainText('Delivers to: Nationwide');
  await expect(page.getByTestId('vendor-areas-v-guessed')).toContainText('Guessed from their text');
  await expect(page.getByRole('row', { name: /Asha Fitness Store/ }).getByText('No area set')).toBeVisible();

  await page.getByRole('button', { name: 'No area set (1)' }).click();
  await expect(page.getByText('Asha Fitness Store')).toBeVisible();
  await expect(page.getByText('Kinondoni Gear')).toHaveCount(0);
  await expect(page.getByText('Nationwide Supplements')).toHaveCount(0);

  await page.getByRole('button', { name: 'Guessed from their text (1)' }).click();
  await expect(page.getByText('Nationwide Supplements')).toBeVisible();
  await expect(page.getByText('Asha Fitness Store')).toHaveCount(0);
});

test('admin maps an unmapped vendor from what they wrote and saves to the contract', async ({ page }) => {
  const puts = await setup(page);
  await page.goto('/admin/vendors');
  await page.getByTestId('vendor-areas-edit-v-unmapped').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('vendor-areas-written')).toContainText('Plot 4, Mikocheni');
  await expect(dialog.getByTestId('vendor-areas-written')).toContainText('Dar es Salaam, Arusha, Mbeya');
  // Inactive Mwanza is not offered.
  await expect(dialog.getByTestId('vendor-delivers-to-tz-mwz')).toHaveCount(0);

  // Based in lists only cities and districts; search keeps parents visible.
  await expect(dialog.getByTestId('vendor-based-in-tz-dar')).toHaveCount(0);
  await dialog.getByTestId('vendor-based-in-search').fill('kino');
  await expect(dialog.getByTestId('vendor-based-in')).toContainText('Dar es Salaam');
  await expect(dialog.getByTestId('vendor-based-in-tz-aru-city')).toHaveCount(0);
  await dialog.getByTestId('vendor-based-in-tz-dar-kinondoni').check();
  await expect(dialog.getByTestId('vendor-based-in-selected')).toContainText('Selected: Kinondoni (Dar es Salaam)');

  // Exact-name matches from the free text, region first; Mbeya matches nothing.
  await dialog.getByRole('button', { name: 'Add Dar es Salaam' }).click();
  await dialog.getByRole('button', { name: 'Add Arusha' }).click();
  await expect(dialog.getByRole('button', { name: /Add / })).toHaveCount(0);
  // Areas under a ticked region show as included and can't be ticked on their own.
  await expect(dialog.getByTestId('vendor-delivers-to-tz-dar-kinondoni')).toBeChecked();
  await expect(dialog.getByTestId('vendor-delivers-to-tz-dar-kinondoni')).toBeDisabled();
  await expect(dialog.getByText('Included in Dar es Salaam').first()).toBeVisible();

  await dialog.getByTestId('vendor-areas-save').click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ deliveryAreaIds: ['tz-dar', 'tz-aru'], cityId: 'tz-dar-kinondoni', regionId: 'tz-dar' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Vendor updated.')).toBeVisible();
  await expect(page.getByTestId('vendor-areas-v-unmapped')).toContainText('Based in: Kinondoni (Dar es Salaam)');
  await expect(page.getByTestId('vendor-areas-v-unmapped')).toContainText('Delivers to: Dar es Salaam, Arusha');
});

test('nationwide covers every area, and an invalid_area refusal is explained', async ({ page }) => {
  const puts = await setup(page, { put: 'invalid' });
  await page.goto('/admin/vendors');
  await page.getByTestId('vendor-areas-edit-v-unmapped').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('vendor-delivers-to-tz').check();
  await expect(dialog.getByTestId('vendor-delivers-to-tz-aru-city')).toBeDisabled();
  await expect(dialog.getByText('Included in Nationwide').first()).toBeVisible();
  await dialog.getByTestId('vendor-delivers-to-clear').click();
  await dialog.getByTestId('vendor-delivers-to-tz-aru').check();
  await dialog.getByTestId('vendor-areas-save').click();
  await expect.poll(() => puts.length).toBe(1);
  // Based in was not touched, so it is left out of the patch.
  expect(puts[0]).toEqual({ deliveryAreaIds: ['tz-aru'] });
  await expect(dialog.getByRole('alert')).toContainText('Arusha: this area is no longer available. Pick another.');
  await expect(dialog).toBeVisible();
});

test('falls back to /shop/areas when the admin has no promotions scope', async ({ page }) => {
  await setup(page, { geoAreas: 'forbidden' });
  await page.goto('/admin/vendors');
  await expect(page.getByTestId('vendor-areas-v-mapped')).toContainText('Based in: Kinondoni (Dar es Salaam)');
});

test('area mapping stays hidden when no areas are set up', async ({ page }) => {
  await setup(page, { geoAreas: 'empty' });
  await page.goto('/admin/vendors');
  await expect(page.getByText('Kinondoni Gear')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Where they sell' })).toHaveCount(0);
  await expect(page.getByTestId('vendor-areas-edit-v-mapped')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /No area set/ })).toHaveCount(0);
});

test('a load failure says so and can be retried', async ({ page }) => {
  await setup(page, { geoAreas: 'forbidden', shopAreas: 'disabled' });
  await page.goto('/admin/vendors');
  await expect(page.getByText("Couldn't load areas. Try again.")).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Where they sell' })).toHaveCount(0);
});

test('Swahili labels', async ({ page }) => {
  await setup(page, {}, 'sw');
  await page.goto('/admin/vendors');
  await expect(page.getByRole('columnheader', { name: 'Anapouzia' })).toBeVisible();
  await expect(page.getByTestId('vendor-areas-v-mapped')).toContainText('Ipo: Kinondoni (Dar es Salaam)');
  await expect(page.getByTestId('vendor-areas-v-guessed')).toContainText('Ina delivery hadi: Nchi nzima');
  await page.getByTestId('vendor-areas-edit-v-unmapped').click();
  await expect(page.getByRole('dialog').getByText('Alichoandika muuzaji')).toBeVisible();
});

test('stored areas that are no longer available are dropped on opening, so saving is not blocked', async ({ page }) => {
  const puts = await setup(page);
  await page.goto('/admin/vendors');
  await page.getByTestId('vendor-areas-edit-v-stale').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('vendor-areas-dropped')).toHaveText('Removed 2 areas that are no longer available: tz-gone-city, Mwanza');
  await expect(dialog.getByTestId('vendor-delivers-to-tz-dar')).toBeChecked();
  await dialog.getByTestId('vendor-areas-save').click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ deliveryAreaIds: ['tz-dar'], cityId: null, regionId: null });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('area names follow the reader\'s language when the backend sends them', async ({ page }) => {
  await setup(page, {}, 'sw');
  await page.goto('/admin/vendors');
  await page.getByTestId('vendor-areas-edit-v-mapped').click();
  await expect(page.getByRole('dialog').getByTestId('vendor-delivers-to')).toContainText('Jiji la Arusha');
  await expect(page.getByRole('dialog').getByTestId('vendor-delivers-to').getByText('Nchi nzima (Tanzania yote)')).toBeVisible();
  await page.getByRole('dialog').getByTestId('vendor-delivers-to-search').fill('jiji la');
  await expect(page.getByRole('dialog').getByTestId('vendor-delivers-to-tz-aru-city')).toBeVisible();
});

test('area names in English', async ({ page }) => {
  await setup(page);
  await page.goto('/admin/vendors');
  await page.getByTestId('vendor-areas-edit-v-mapped').click();
  await expect(page.getByRole('dialog').getByTestId('vendor-delivers-to')).toContainText('Arusha City');
  await expect(page.getByRole('dialog').getByTestId('vendor-areas-dropped')).toHaveCount(0);
});

test('Swahili names also come through the /shop/areas fallback (names.sw)', async ({ page }) => {
  await setup(page, { geoAreas: 'forbidden' }, 'sw');
  await page.goto('/admin/vendors');
  await page.getByTestId('vendor-areas-edit-v-mapped').click();
  await expect(page.getByRole('dialog').getByTestId('vendor-delivers-to')).toContainText('Jiji la Arusha');
});

test('the list names areas that are no longer available, and the note uses the singular for one', async ({ page }) => {
  await setup(page);
  await page.goto('/admin/vendors');
  // Mwanza is inactive (named from its admin row); the deleted city has no row, so its id is the last resort.
  await expect(page.getByTestId('vendor-areas-v-stale')).toContainText('Based in: tz-gone-city (no longer available)');
  await expect(page.getByTestId('vendor-areas-v-stale')).toContainText('Delivers to: Dar es Salaam, Mwanza (no longer available)');
  await page.getByTestId('vendor-areas-edit-v-stale1').click();
  await expect(page.getByRole('dialog').getByTestId('vendor-areas-dropped')).toHaveText('Removed 1 area that is no longer available: Mwanza');
});

test('Swahili: unavailable areas and the removed-areas note', async ({ page }) => {
  await setup(page, {}, 'sw');
  await page.goto('/admin/vendors');
  await expect(page.getByTestId('vendor-areas-v-stale')).toContainText('Mwanza (halipatikani tena)');
  await page.getByTestId('vendor-areas-edit-v-stale1').click();
  await expect(page.getByRole('dialog').getByTestId('vendor-areas-dropped')).toHaveText('Limeondolewa eneo 1 ambalo halipatikani tena: Mwanza');
});

test('a name that already says its level is not followed by the level again', async ({ page }) => {
  await setup(page);
  await page.goto('/admin/vendors');
  await page.getByTestId('vendor-areas-edit-v-unmapped').click();
  const dialog = page.getByRole('dialog');
  const row = dialog.getByTestId('vendor-delivers-to').locator('label').filter({ has: page.getByTestId('vendor-delivers-to-tz-znz-city') });
  await expect(row).toContainText('Zanzibar City');
  await expect(row).not.toContainText('City ·');
  await expect(row).toContainText('Zanzibar');
  // Other cities still say their level.
  const darCity = dialog.getByTestId('vendor-delivers-to').locator('label').filter({ has: page.getByTestId('vendor-delivers-to-tz-dar-city') });
  await expect(darCity).toContainText('City · Dar es Salaam');
});
