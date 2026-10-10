import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

const partner = (id: string, userType: string, name: string) => ({
  id, userType, displayName: name, email: `${id}@example.com`, approvalStatus: 'pending_approval',
  accountStatus: 'active', createdAt: '2026-10-09T08:00:00.000Z',
});

async function setup(page: import('@playwright/test').Page, decide: (body: Record<string, unknown>) => { status: number; json: unknown }) {
  const calls: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/role-approvals') return route.fulfill({ json: [partner('v-1', 'vendor', 'Mwanga Traders')] });
    if (url.pathname.endsWith('/decision')) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      calls.push(body);
      return route.fulfill(decide(body));
    }
    return route.fulfill({ json: [] });
  });
  return calls;
}

test('approving a new partner here points to Partner Verification, not a raw error', async ({ page }) => {
  const calls = await setup(page, () => ({ status: 409, json: { error: 'use_kyc_review' } }));
  await page.goto('/admin/approvals');
  await page.getByTitle('Approve').click();
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();

  const notice = page.getByTestId('approvals-use-kyc');
  await expect(notice).toContainText('Mwanga Traders');
  await expect(notice).toContainText('Partner Verification');
  await expect(notice.getByRole('link', { name: 'Open Partner Verification' })).toHaveAttribute('href', /\/admin\/kyc/);
  await expect(page.getByText('API 409')).toHaveCount(0);
  expect(calls).toEqual([{ decision: 'approve' }]);
});

test('another failure still shows its message; a success shows no notice', async ({ page }) => {
  await setup(page, () => ({ status: 500, json: { error: 'boom' } }));
  await page.goto('/admin/approvals');
  await page.getByTitle('Reject').click();
  await page.getByRole('button', { name: 'Reject', exact: true }).last().click();
  await expect(page.getByRole('alert').filter({ hasText: 'API 500' })).toBeVisible();
  await expect(page.getByTestId('approvals-use-kyc')).toHaveCount(0);
});
