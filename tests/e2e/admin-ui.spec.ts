import { expect, request, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

function devToken(payload: Record<string, string>) {
  return `dev:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

test('admin portal exposes localized management console', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const ctx = await request.newContext();
  const adminSession = await ctx.post(`${API}/auth/firebase/session`, {
    data: {
      idToken: devToken({ uid: `fb_admin_ui_${suffix}`, email: 'mama27j@gmail.com', name: 'FitFlex Admin' }),
      requestedRole: 'admin'
    }
  });
  const { token, user } = await adminSession.json();
  expect(token).toBeTruthy();

  await page.goto('/login');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token, user });

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gyms' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Owners' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trainers' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Approvals' }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Gyms' }).first().click();
  await expect(page.getByRole('heading', { name: 'Gyms' })).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();

  await page.getByRole('link', { name: 'Approvals' }).first().click();
  await expect(page.getByRole('heading', { name: 'Role Approvals' })).toBeVisible();

  await page.getByRole('link', { name: 'Owners' }).first().click();
  await expect(page.getByRole('heading', { name: 'Gym Owners' })).toBeVisible();

  await page.getByRole('link', { name: 'Trainers' }).first().click();
  await expect(page.getByRole('heading', { name: 'Trainers' })).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();

  await page.getByRole('link', { name: 'Payments' }).first().click();
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Reference' })).toBeVisible();

  await page.evaluate(() => localStorage.setItem('locale', 'sw'));
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.getByRole('link', { name: 'Ma-trainer' }).first().click();
  await expect(page.getByRole('heading', { name: 'Trainers' })).toBeVisible();
});
