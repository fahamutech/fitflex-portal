import { expect, test, type Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

// POST /admin/members refuses a bad date of birth with
// 400 { error: 'invalid_field', field: 'dateOfBirth' } (fitflex-functions src/shared/date-of-birth.mjs).
// The portal applies the same rule first and shows the refusal on the field.

const member = {
  id: 'member-dob',
  displayName: 'Dob Member',
  email: 'dob@example.com',
  phone: null,
  accountStatus: 'active',
  memberProfile: { dateOfBirth: '1990-04-01' },
};

async function signIn(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript((l) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
    localStorage.setItem('locale', l);
  }, locale);
}

async function mockApi(page: Page, rows: unknown[], onPost: (body: Record<string, unknown>) => { status: number; json: unknown }) {
  const posts: Record<string, unknown>[] = [];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/admin/members' && request.method() === 'GET') return route.fulfill({ json: rows });
    if (url.pathname === '/admin/members' && request.method() === 'POST') {
      const body = request.postDataJSON();
      posts.push(body);
      const out = onPost(body);
      return route.fulfill({ status: out.status, json: out.json });
    }
    return route.fulfill({ json: [] });
  });
  return posts;
}

const refuse = () => ({ status: 400, json: { error: 'invalid_field', field: 'dateOfBirth' } });

test('date of birth input is bounded from 1901-01-01 to today in Dar es Salaam', async ({ page }) => {
  await signIn(page);
  await mockApi(page, [member], refuse);
  await page.goto('/admin/members');
  await page.getByTitle('Edit member').click();
  const dob = page.getByTestId('member-dob');
  await expect(dob).toHaveAttribute('min', '1901-01-01');
  const darToday = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  await expect(dob).toHaveAttribute('max', darToday);
});

test('a server refusal of the date of birth shows on the field and keeps the dialog open', async ({ page }) => {
  await signIn(page);
  const posts = await mockApi(page, [member], refuse);
  await page.goto('/admin/members');
  await page.getByTitle('Edit member').click();
  const dialog = page.getByRole('dialog');
  await page.getByTestId('member-dob').fill('2000-01-31');
  await dialog.getByRole('button', { name: 'Update' }).click();

  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ id: member.id, memberProfile: { dateOfBirth: '2000-01-31' } });
  await expect(dialog.getByText('Enter a real date of birth.')).toBeVisible();
  await expect(page.getByTestId('member-dob')).toHaveAttribute('aria-invalid', 'true');
  // Not shown as a raw page-level error code.
  await expect(page.getByText('invalid_field')).toHaveCount(0);

  // Changing the date clears the message.
  await page.getByTestId('member-dob').fill('2000-02-01');
  await expect(dialog.getByText('Enter a real date of birth.')).toHaveCount(0);
});

test('a future date of birth is stopped before saving', async ({ page }) => {
  await signIn(page);
  const posts = await mockApi(page, [member], () => ({ status: 200, json: member }));
  await page.goto('/admin/members');
  await page.getByTitle('Edit member').click();
  const dialog = page.getByRole('dialog');
  const nextYear = new Date().getUTCFullYear() + 1;
  await page.getByTestId('member-dob').fill(`${nextYear}-01-01`);
  await dialog.getByRole('button', { name: 'Update' }).click();
  await expect(dialog.getByText("Date of birth can't be in the future.")).toBeVisible();
  expect(posts).toHaveLength(0);
});

test('Swahili: the refusal reads in Swahili', async ({ page }) => {
  await signIn(page, 'sw');
  await mockApi(page, [member], refuse);
  await page.goto('/admin/members');
  await page.getByTitle('Edit member').click();
  const dialog = page.getByRole('dialog');
  await page.getByTestId('member-dob').fill('2000-01-31');
  await dialog.getByRole('button', { name: 'Update' }).click();
  await expect(dialog.getByText('Weka tarehe sahihi ya kuzaliwa.')).toBeVisible();
});

test('a saved date in an old format is kept (sent as null) when the admin leaves it alone', async ({ page }) => {
  await signIn(page);
  const legacy = { ...member, memberProfile: { dateOfBirth: '03/05/1990' } };
  const posts = await mockApi(page, [legacy], (body) => ({ status: 200, json: { ...legacy, ...body } }));
  await page.goto('/admin/members');
  await page.getByTitle('Edit member').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('The saved date of birth "03/05/1990" is not a real date.', { exact: false })).toBeVisible();
  await dialog.locator('input.ui-input').first().fill('Dob Member Renamed');
  await dialog.getByRole('button', { name: 'Update' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ id: legacy.id, displayName: 'Dob Member Renamed', memberProfile: { dateOfBirth: null } });
});
