import { expect, test, type Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

// Partner DOB plan slice 2: admins may VIEW a trainer's or gym owner's date of birth,
// age and gender (no edit). Contract: fitflex-functions docs/partner-dob-api.md
//   GET /admin/trainers/:id/personal-details     (scope trainers; :id = trainer profile id)
//   GET /admin/gym-owners/:id/personal-details   (scope owners;   :id = owner user id)
// Every read is audited server-side, so the portal must only call it when the admin asks.

const trainer = { id: 'trn_1a2b3c4d', displayName: 'Asha Mushi', fullName: 'Asha Mushi', nickname: null, email: 'asha@example.com', specialties: [], hourlyRateTzs: 10000, gymIds: [], status: 'active', verified: false, availability: [] };
const owner = { id: 'usr_owner1', displayName: 'Juma Owner', email: 'juma@example.com', gymIds: [], accountStatus: 'active', approvalStatus: 'approved' };

type Reply = { status: number; json: unknown };

async function signIn(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript((l) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
    localStorage.setItem('locale', l);
  }, locale);
}

async function mockApi(page: Page, details: Reply) {
  const calls: string[] = [];
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/personal-details')) {
      calls.push(url.pathname);
      return route.fulfill({ status: details.status, json: details.json });
    }
    if (url.pathname === '/admin/trainers') return route.fulfill({ json: [trainer] });
    if (url.pathname === '/admin/gym-owners') return route.fulfill({ json: [owner] });
    return route.fulfill({ json: [] });
  });
  return calls;
}

const full = (dob: string | null, age: number | null, gender: string | null) => ({
  dateOfBirth: dob, age, gender, genderFrom: gender ? 'person' : null, source: dob ? 'person' : null,
});

test('trainer: nothing is requested until the admin asks, then DOB, age and gender show read-only', async ({ page }) => {
  await signIn(page);
  const calls = await mockApi(page, { status: 200, json: { trainerId: trainer.id, userId: 'usr_t1', personalDetails: { ...full('1994-03-21', 32, 'female'), genderFrom: 'trainer_profile' } } });
  await page.goto('/admin/trainers');
  await expect(page.getByText('Asha Mushi', { exact: true }).first()).toBeVisible();
  expect(calls).toHaveLength(0);

  await page.getByText('Asha Mushi', { exact: true }).first().click();
  const section = page.getByTestId('trainer-personal-details');
  await expect(section).toBeVisible();
  await expect(section.getByText('View only. Each view is recorded.')).toBeVisible();
  // Opening the dialog alone does not read the audited endpoint.
  await page.waitForTimeout(300);
  expect(calls).toHaveLength(0);

  await section.getByRole('button', { name: 'Show personal details' }).click();
  await expect(page.getByTestId('trainer-personal-details-dob')).toHaveText('1994-03-21');
  await expect(page.getByTestId('trainer-personal-details-age')).toHaveText('32');
  await expect(page.getByTestId('trainer-personal-details-gender')).toHaveText('Female');
  expect(calls).toEqual([`/admin/trainers/${trainer.id}/personal-details`]);
  await expect(section.locator('input, select, textarea')).toHaveCount(0);
  await expect(section.getByRole('button')).toHaveCount(0);
});

test('owner: values show after asking, using the owner user id', async ({ page }) => {
  await signIn(page);
  const calls = await mockApi(page, { status: 200, json: { ownerId: owner.id, personalDetails: full('1979-06-30', 47, 'male') } });
  await page.goto('/admin/owners');
  await expect(page.getByText('Juma Owner', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
  await page.getByText('Juma Owner', { exact: true }).click();
  const section = page.getByTestId('owner-personal-details');
  await expect(section).toBeVisible();
  expect(calls).toHaveLength(0);
  await section.getByRole('button', { name: 'Show personal details' }).click();
  await expect(page.getByTestId('owner-personal-details-dob')).toHaveText('1979-06-30');
  await expect(page.getByTestId('owner-personal-details-age')).toHaveText('47');
  await expect(page.getByTestId('owner-personal-details-gender')).toHaveText('Male');
  expect(calls).toEqual([`/admin/gym-owners/${owner.id}/personal-details`]);
});

test('owner: null values read "Not given"', async ({ page }) => {
  await signIn(page);
  await mockApi(page, { status: 200, json: { ownerId: owner.id, personalDetails: full(null, null, null) } });
  await page.goto('/admin/owners');
  await page.getByText('Juma Owner', { exact: true }).click();
  await page.getByTestId('owner-personal-details').getByRole('button', { name: 'Show personal details' }).click();
  await expect(page.getByTestId('owner-personal-details-dob')).toHaveText('Not given');
  await expect(page.getByTestId('owner-personal-details-age')).toHaveText('Not given');
  await expect(page.getByTestId('owner-personal-details-gender')).toHaveText('Not given');
});

test('feature_disabled: no values, only a muted "not available" note', async ({ page }) => {
  await signIn(page);
  await mockApi(page, { status: 404, json: { error: 'feature_disabled' } });
  await page.goto('/admin/trainers');
  await page.getByText('Asha Mushi', { exact: true }).first().click();
  const section = page.getByTestId('trainer-personal-details');
  await section.getByRole('button', { name: 'Show personal details' }).click();
  await expect(section.getByText('Personal details are not available.')).toBeVisible();
  await expect(page.getByTestId('trainer-personal-details-dob')).toHaveCount(0);
  await expect(section.getByRole('button')).toHaveCount(0);
  await expect(section.getByRole('alert')).toHaveCount(0);
});

test('acl_forbidden: the section is hidden', async ({ page }) => {
  await signIn(page);
  await mockApi(page, { status: 403, json: { error: 'acl_forbidden', requiredScope: 'owners' } });
  await page.goto('/admin/owners');
  await page.getByText('Juma Owner', { exact: true }).click();
  await page.getByTestId('owner-personal-details').getByRole('button', { name: 'Show personal details' }).click();
  await expect(page.getByTestId('owner-personal-details')).toHaveCount(0);
  await expect(page.getByText('acl_forbidden')).toHaveCount(0);
});

test('other errors show inline and can be retried', async ({ page }) => {
  await signIn(page);
  await mockApi(page, { status: 500, json: { error: 'internal' } });
  await page.goto('/admin/trainers');
  await page.getByText('Asha Mushi', { exact: true }).first().click();
  const section = page.getByTestId('trainer-personal-details');
  await section.getByRole('button', { name: 'Show personal details' }).click();
  await expect(section.getByRole('alert')).toHaveText('Could not load personal details. Try again.');
  await expect(section.getByRole('button', { name: 'Show personal details' })).toBeVisible();
});

test('Swahili: labels and values read in Swahili', async ({ page }) => {
  await signIn(page, 'sw');
  await mockApi(page, { status: 200, json: { ownerId: owner.id, personalDetails: full('1979-06-30', 47, null) } });
  await page.goto('/admin/owners');
  await page.getByText('Juma Owner', { exact: true }).click();
  const section = page.getByTestId('owner-personal-details');
  await expect(section.getByText('Taarifa binafsi', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Onyesha taarifa binafsi' }).click();
  await expect(section.getByText('Tarehe ya kuzaliwa')).toBeVisible();
  await expect(section.getByText('Umri')).toBeVisible();
  await expect(section.getByText('Jinsia')).toBeVisible();
  await expect(page.getByTestId('owner-personal-details-gender')).toHaveText('Haijatolewa');
});

test('add dialogs have no personal details section', async ({ page }) => {
  await signIn(page);
  const calls = await mockApi(page, { status: 200, json: {} });
  await page.goto('/admin/owners');
  await page.getByRole('button', { name: 'Add owner' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('owner-personal-details')).toHaveCount(0);
  expect(calls).toHaveLength(0);
});
