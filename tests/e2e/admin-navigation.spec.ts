import { expect, test, type Page } from '@playwright/test';

// Phase 2B S2: grouped, collapsible admin sidebar; desktop top bar with breadcrumb, page finder,
// language, role and sign-out. Every route and permission scope is unchanged, so the checks here are
// about what a person can see and reach, never about what the server allows.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const superAdmin = { id: 'admin-1', userType: 'admin', email: 'admin@example.com' };
const staff = (aclPermissions: string[]) => ({ id: 'staff-1', userType: 'admin', portalUser: true, aclPermissions, email: 'staff@example.com' });

async function setup(page: Page, user: Record<string, unknown>) {
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
  await page.route(`${API}/**`, route => route.fulfill({ json: [] }));
}

const sidebar = (page: Page) => page.locator('aside:not(#mobile-drawer)');
const group = (page: Page, name: string) => sidebar(page).getByRole('button', { name, exact: true });
const topBar = (page: Page) => page.getByTestId('top-bar');

test.describe('admin sidebar groups', () => {
  test('only the group holding the current page is open; the others open on a click and are remembered', async ({ page }) => {
    await setup(page, superAdmin);
    await page.goto('/admin/payments');

    await expect(group(page, 'Money')).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar(page).getByRole('link', { name: 'Payments', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(sidebar(page).getByRole('link', { name: 'Refunds' })).toBeVisible();

    // A closed group keeps its links in the page but hidden.
    await expect(group(page, 'System')).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar(page).getByRole('link', { name: 'Audit log' })).toBeHidden();

    await group(page, 'System').click();
    await expect(group(page, 'System')).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar(page).getByRole('link', { name: 'Audit log' })).toBeVisible();

    await page.reload();
    await expect(group(page, 'System')).toHaveAttribute('aria-expanded', 'true');
    await expect(group(page, 'Money')).toHaveAttribute('aria-expanded', 'true');
  });

  test('a group closed by hand opens again when one of its pages is opened', async ({ page }) => {
    await setup(page, superAdmin);
    await page.goto('/admin/payments');
    await group(page, 'Money').click();
    await expect(group(page, 'Money')).toHaveAttribute('aria-expanded', 'false');

    await page.goto('/admin/refunds');
    await expect(group(page, 'Money')).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar(page).getByRole('link', { name: 'Refunds' })).toHaveAttribute('aria-current', 'page');
  });

  test('no group holds more than seven links, and money pages sit together', async ({ page }) => {
    await setup(page, superAdmin);
    await page.goto('/admin');
    const groups = sidebar(page).getByTestId('nav-group');
    const n = await groups.count();
    expect(n).toBeGreaterThanOrEqual(9);
    for (let i = 0; i < n; i++) expect(await groups.nth(i).getByRole('link', { includeHidden: true }).count()).toBeLessThanOrEqual(7);

    const money = sidebar(page).locator('[data-group="nav.group.money"]');
    for (const href of ['/admin/payments', '/admin/refunds', '/admin/payments-held', '/admin/settlements']) {
      await expect(money.locator(`a[href="${href}/"]`)).toHaveCount(1);
    }
  });

  test('portal staff see only the groups and links their scopes open', async ({ page }) => {
    await setup(page, staff(['kyc']));
    await page.goto('/admin/kyc');
    await expect(group(page, 'Verification and access')).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar(page).getByRole('link', { name: 'Partner verification' })).toBeVisible();
    // Nothing from groups they hold no scope for, open or closed.
    await expect(sidebar(page).getByTestId('nav-group')).toHaveCount(1);
    await expect(sidebar(page).locator('a[href^="/admin/payments"]')).toHaveCount(0);
    await expect(sidebar(page).locator('a[href^="/admin/users"]')).toHaveCount(0);
  });

  test('portal staff are still sent away from a page outside their scopes', async ({ page }) => {
    await setup(page, staff(['kyc']));
    await page.goto('/admin/payments');
    await expect(page).not.toHaveURL(/\/admin\/payments/);
  });
});

test.describe('desktop top bar', () => {
  test('breadcrumb names the group and the page', async ({ page }) => {
    await setup(page, superAdmin);
    await page.goto('/admin/payments');
    const crumb = topBar(page).getByRole('navigation', { name: 'You are here' });
    await expect(crumb).toContainText('Money');
    await expect(crumb.locator('[aria-current="page"]')).toHaveText('Payments');

    await page.goto('/admin');
    await expect(topBar(page).getByRole('navigation', { name: 'You are here' }).locator('[aria-current="page"]')).toHaveText('Overview');
  });

  test('page finder jumps to a page with the keyboard and lists nothing outside the menu', async ({ page }) => {
    await setup(page, superAdmin);
    await page.goto('/admin');
    const finder = topBar(page).getByRole('combobox', { name: 'Find a page' });
    const list = topBar(page).getByRole('listbox', { name: 'Find a page' });

    await finder.fill('refund');
    await expect(list.getByRole('option')).toHaveText([/Refunds/]);
    await finder.press('Enter');
    await expect(page).toHaveURL(/\/admin\/refunds/);
    await expect(finder).toHaveValue('');

    await finder.fill('zzzz');
    await expect(list).toContainText('No results found');
    await finder.press('Escape');
    await expect(list).toBeHidden();
  });

  test('page finder shows staff only the pages their scopes open', async ({ page }) => {
    await setup(page, staff(['kyc']));
    await page.goto('/admin/kyc');
    // One link in the menu: too few for a finder.
    await expect(topBar(page).getByTestId('page-finder')).toHaveCount(0);

    await setup(page, staff(['payments', 'kyc', 'members', 'gyms', 'owners', 'trainers', 'shop', 'audit', 'settings']));
    await page.goto('/admin/kyc');
    const finder = topBar(page).getByRole('combobox', { name: 'Find a page' });
    await finder.fill('portal');
    await expect(topBar(page).getByRole('listbox', { name: 'Find a page' })).toContainText('No results found');
  });

  test('language, role and sign-out are in the top bar, not the desktop sidebar', async ({ page }) => {
    await setup(page, superAdmin);
    await page.goto('/admin');
    await expect(topBar(page).getByTestId('shell-role')).toHaveText('Admin');
    await expect(sidebar(page).getByTestId('locale-select')).toHaveCount(0);

    await topBar(page).getByTestId('locale-select').selectOption('sw');
    await expect(page.locator('html')).toHaveAttribute('lang', 'sw');
    await topBar(page).getByTestId('locale-select').selectOption('en');

    await topBar(page).getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('phone: no top bar; the drawer has the groups and the account controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, superAdmin);
    await page.goto('/admin/payments');
    await expect(topBar(page)).toBeHidden();

    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.locator('#mobile-drawer');
    await expect(drawer.getByRole('button', { name: 'Money', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer.getByRole('link', { name: 'Payments', exact: true })).toBeVisible();
    await expect(drawer.getByTestId('locale-select')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
