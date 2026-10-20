import { expect, test, type Page } from '@playwright/test';

// Portal Users: staff can only give or take away scopes they hold (functions#217/#218), and the new
// 403 refusals read in English and Swahili. The API is mocked; nothing signs in for real.
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SUPER = { id: 'admin-1', userType: 'admin', email: 'root@fitflex.test', displayName: 'Root' };
const STAFF = { id: 'staff-1', userType: 'admin', email: 'lead@fitflex.test', displayName: 'Lead', portalUser: true, aclPermissions: ['users', 'gyms', 'members'] };
const TARGET = { id: 'staff-2', email: 'helper@fitflex.test', displayName: 'Helper', userType: 'admin', accountStatus: 'active', portalUser: true, aclPermissions: ['gyms', 'payments'], createdAt: '2026-10-01T00:00:00.000Z', isEnvAdmin: false };

async function open(page: Page, user: Json, opts: { locale?: 'en' | 'sw'; refuse?: Json } = {}) {
  const puts: Json[] = [];
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('locale', l as string);
  }, [user, opts.locale ?? 'en'] as const);
  await page.route(`${API}/**`, route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/admin/portal-users' && req.method() === 'GET') return route.fulfill({ json: [TARGET] });
    if (path === `/admin/portal-users/${TARGET.id}` && req.method() === 'PUT') {
      puts.push(req.postDataJSON());
      return opts.refuse ? route.fulfill({ status: 403, json: opts.refuse }) : route.fulfill({ json: { ...TARGET, ...req.postDataJSON() } });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/users/');
  await page.getByRole('row', { name: /helper@fitflex\.test/ }).getByTitle('Edit permissions').click();
  await expect(page.getByText('Edit permissions —')).toBeVisible();
  return puts;
}

test('staff: scopes they do not hold are disabled with the reason; ones they hold can change', async ({ page }) => {
  const puts = await open(page, STAFF);
  const payments = page.getByTestId('scope-toggle-payments');
  await expect(payments).toBeDisabled();
  await expect(payments).toHaveAttribute('aria-pressed', 'true');
  await expect(payments).toHaveAttribute('title', 'You can only give access you have');
  await expect(page.getByTestId('scope-toggle-kyc')).toBeDisabled();
  await expect(page.getByTestId('scope-toggle-gyms')).toBeEnabled();
  await page.getByTestId('scope-toggle-members').click();
  await expect(page.getByTestId('scope-toggle-members')).toHaveAttribute('aria-pressed', 'true');
  // A role preset never touches scopes the staff member doesn't hold.
  await page.getByRole('button', { name: 'Sales Person' }).click();
  await expect(payments).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('scope-toggle-owners')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect([...puts[0].aclPermissions].sort()).toEqual(['gyms', 'members', 'payments']);
});

test('super-admin: every scope can be changed', async ({ page }) => {
  await open(page, SUPER);
  for (const k of ['payments', 'kyc', 'gyms', 'users']) await expect(page.getByTestId(`scope-toggle-${k}`)).toBeEnabled();
  await expect(page.getByTestId('scope-toggle-payments')).not.toHaveAttribute('title', /.+/);
});

const REFUSALS: Array<[Json, string, string]> = [
  [{ error: 'acl_grant_exceeds_own', exceeding: ['payments', 'kyc'] }, 'You can only give or remove access you have yourself. Not yours: Payments, Partner verification.', 'Unaweza kutoa au kuondoa ruhusa ulizo nazo wewe mwenyewe tu. Si zako: Payments, Partner verification.'],
  [{ error: 'cannot_change_own_access' }, "You can't change your own permissions, role or status.", 'Huwezi kubadilisha ruhusa, nafasi au hali yako mwenyewe.'],
  [{ error: 'super_admin_required' }, 'Only a super-admin can change a super-admin account or make someone a super-admin.', 'Ni super-admin pekee anayeweza kubadilisha akaunti ya super-admin au kumfanya mtu kuwa super-admin.'],
  [{ error: 'actor_not_found' }, "Your account couldn't be found. Sign out and sign in again.", 'Akaunti yako haikupatikana. Toka kisha uingie tena.'],
];

for (const [body, en, sw] of REFUSALS) {
  test(`refusal ${body.error} is explained in English and Swahili`, async ({ page, browser }) => {
    await open(page, STAFF, { refuse: { ...body, message: 'raw server text' } });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('alert').filter({ hasText: en })).toBeVisible();
    await expect(page.getByText('raw server text')).toHaveCount(0);

    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const swPage = await ctx.newPage();
    await open(swPage, STAFF, { locale: 'sw', refuse: body });
    await swPage.getByRole('button', { name: 'Save changes' }).click();
    await expect(swPage.getByRole('alert').filter({ hasText: sw })).toBeVisible();
    await ctx.close();
  });
}
