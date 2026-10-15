import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const ADMIN = { id: 'admin-1', userType: 'admin', email: 'admin@example.com' };

type Json = Record<string, unknown>;
type Report = { id: string; targetType: string; targetId: string; reason: string | null; status: string; createdAt: string; reporter: string | null; target: Json | null };

/** An admin signed in, and a tiny fake social-reports API whose state the test can read. */
async function setup(page: Page, reports: Report[], calls: Array<{ path: string; body: Json | null }>) {
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('locale', 'en');
  }, ADMIN);
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (method === 'GET' && path === '/admin/social/reports') {
      const status = url.searchParams.get('status') ?? 'open';
      return route.fulfill({ json: { reports: reports.filter(r => r.status === status) } });
    }
    const m = path.match(/^\/admin\/social\/reports\/([^/]+)\/resolve$/);
    if (method === 'POST' && m) {
      const body = route.request().postDataJSON() as Json;
      calls.push({ path, body });
      const r = reports.find(x => x.id === m[1])!;
      r.status = body.action === 'dismiss' ? 'dismissed' : 'actioned';
      if (body.action === 'clear_username' && r.target) r.target.username = null;
      return route.fulfill({ json: { resolved: true } });
    }
    return route.fulfill({ json: {} });
  });
}

const userReport = (over: Partial<Report> = {}): Report => ({
  id: 'rpt_1', targetType: 'user', targetId: 'usr_1', reason: 'offensive', status: 'open',
  createdAt: '2026-10-14T08:00:00.000Z', reporter: 'Neema K.',
  target: { displayName: 'Amina Said', username: 'rude_name' }, ...over,
});

test('a reported user shows the real name with the username, and Clear username is logged', async ({ page }) => {
  const calls: Array<{ path: string; body: Json | null }> = [];
  await setup(page, [userReport()], calls);
  await page.goto('/admin/social');
  await expect(page.getByText('Member Amina Said (@rude_name)')).toBeVisible();

  page.once('dialog', d => { expect(d.message()).toContain('@rude_name'); d.accept(); });
  await page.getByTestId('clear-username').click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].path).toBe('/admin/social/reports/rpt_1/resolve');
  expect(calls[0].body).toEqual({ action: 'clear_username' });
  // The report leaves the open list once handled.
  await expect(page.getByText('Nothing here.')).toBeVisible();
});

test('no username on the reported member: there is nothing to clear', async ({ page }) => {
  const calls: Array<{ path: string; body: Json | null }> = [];
  await setup(page, [userReport({ target: { displayName: 'Amina Said', username: null } })], calls);
  await page.goto('/admin/social');
  await expect(page.getByText('Member Amina Said')).toBeVisible();
  await expect(page.getByTestId('clear-username')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();
});
