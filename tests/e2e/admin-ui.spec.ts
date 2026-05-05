import { expect, request, test } from '@playwright/test';

const API = 'http://localhost:3000';

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
  await expect(page.getByRole('heading', { name: 'Pilot Console' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gyms' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Owners' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trainers' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approvals' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Gyms' }).first().click();
  await expect(page.getByRole('heading', { name: /Create gym|Edit gym/ })).toBeVisible();
  await expect(page.getByText('Gym catalogue')).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();

  await page.getByRole('button', { name: 'Approvals' }).first().click();
  await expect(page.getByRole('heading', { name: 'Role approval queue' })).toBeVisible();

  await page.getByRole('button', { name: 'Owners' }).first().click();
  await expect(page.getByRole('heading', { name: 'Gym owner management' })).toBeVisible();

  await page.getByRole('button', { name: 'Trainers' }).first().click();
  await expect(page.getByRole('heading', { name: 'Trainer profiles' })).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();

  await page.getByRole('button', { name: 'Payments' }).first().click();
  await expect(page.getByRole('heading', { name: 'Payment queue' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'PAYMENT REFERENCE' })).toBeVisible();

  await page.evaluate(() => localStorage.setItem('locale', 'sw'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashibodi ya Majaribio' })).toBeVisible();
  await page.getByRole('button', { name: 'Makocha' }).first().click();
  await expect(page.getByRole('heading', { name: 'Wasifu wa makocha' })).toBeVisible();
});
