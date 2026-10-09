import { expect, test } from '@playwright/test';
import { fresh, setup, SUPER } from './helpers/promotion-mock';

// How strongly an approved promotion ranks is the approver's to change (the server refuses anyone else).
const staff = (...scopes: string[]) => ({ id: 'staff-1', userType: 'admin', portalUser: true, aclPermissions: scopes });

test('without the approve permission the ranking fields are locked and are not sent', async ({ page }) => {
  const state = fresh();
  await setup(page, state, staff('promotions'));
  await page.goto('/admin/promotions?item=p1');
  await page.getByTestId('promotion-action-edit_live').click();
  await expect(page.getByTestId('live-ranking-locked')).toBeVisible();
  await expect(page.getByTestId('live-priority')).toHaveCount(0);
  await page.getByTestId('live-save').click();
  await expect(page.getByTestId('promotion-live-edit')).toHaveCount(0);
  const patch = state.calls.find(c => c.method === 'PATCH')!;
  expect(patch.body).not.toHaveProperty('priority');
  expect(patch.body).not.toHaveProperty('boostWeight');
  expect(patch.body).toHaveProperty('endsAt');
});

test('an approver can change priority and weight', async ({ page }) => {
  const state = fresh();
  await setup(page, state, staff('promotions', 'promotions_approve'));
  await page.goto('/admin/promotions?item=p1');
  await page.getByTestId('promotion-action-edit_live').click();
  await page.getByTestId('live-priority').fill('2');
  await page.getByTestId('live-save').click();
  await expect(page.getByTestId('promotion-live-edit')).toHaveCount(0);
  expect(state.calls.find(c => c.method === 'PATCH')!.body).toMatchObject({ priority: 2 });
});

test('a full admin is an approver', async ({ page }) => {
  await setup(page, fresh(), SUPER);
  await page.goto('/admin/promotions?item=p1');
  await page.getByTestId('promotion-action-edit_live').click();
  await expect(page.getByTestId('live-priority')).toBeVisible();
});

test('analytics-only staff see the performance page and not the promotion screens in the sidebar', async ({ page }) => {
  await setup(page, fresh(), staff('promotion_analytics'));
  await page.goto('/admin/promotion-analytics');
  await expect(page.getByRole('link', { name: 'Promotion performance' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Campaigns' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Promotions', exact: true })).toHaveCount(0);
});
