import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

// A trainer may choose the name clients see. Staff see both: the nickname and
// the trainer's own name — on the trainer list, when editing, and on payouts.
test('admin sees a trainer\'s nickname together with their own name', async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });
  const names = { displayName: 'Coach Asha', fullName: 'Asha Mushi', nickname: 'Coach Asha' };
  const nicknamed = { id: 'trainer-1', ...names, email: 'asha@example.com', specialties: ['Yoga'], hourlyRateTzs: 10000, gymIds: [], status: 'active', verified: false, availability: [] };
  const plain = { id: 'trainer-2', displayName: 'Juma Ali', fullName: 'Juma Ali', nickname: null, email: 'juma@example.com', specialties: [], hourlyRateTzs: 8000, gymIds: [], status: 'active', verified: false, availability: [] };
  const statement = {
    id: 'ts-1', trainerId: 'trainer-1', trainer: { id: 'trainer-1', ...names, userId: 'usr-1' },
    periodStartDate: '2026-09-28', periodEndDate: '2026-10-04', sessionCount: 2, listTzs: 40000, commissionTzs: 6000, finalNetTzs: 34000,
    status: 'draft', submittedBy: null, holdReason: null, rejectReason: null, voidReason: null, paymentReference: null, paidAt: null, destinationSnapshot: null,
  };
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/trainers' && route.request().method() === 'POST') {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { ...nicknamed, bio: 'saved' } });
    }
    if (url.pathname === '/admin/trainers') return route.fulfill({ json: [nicknamed, plain] });
    if (url.pathname === '/admin/trainer-settlements') return route.fulfill({ json: { statements: [statement] } });
    if (url.pathname === '/admin/settings/specialties') return route.fulfill({ json: ['Yoga'] });
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/trainers');
  await expect(page.getByText('Coach Asha', { exact: true })).toBeVisible();
  await expect(page.getByTestId('trainer-own-name-trainer-1')).toHaveText('Name: Asha Mushi');
  await expect(page.getByTestId('trainer-own-name-trainer-2')).toHaveCount(0);

  // Editing shows the trainer's own name, and says which nickname clients see.
  await page.getByText('Coach Asha', { exact: true }).click();
  await expect(page.getByText('Editing Coach Asha (Asha Mushi)')).toBeVisible();
  await expect(page.getByText('Clients see the nickname this trainer chose: Coach Asha')).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('input.ui-input').first()).toHaveValue('Asha Mushi');
  await dialog.getByRole('button', { name: 'Update', exact: true }).click();
  // Saving sends the own name and leaves the trainer's nickname alone.
  await expect.poll(() => saved).toMatchObject({ id: 'trainer-1', displayName: 'Asha Mushi' });
  expect(saved).not.toHaveProperty('nickname');
  expect(saved).not.toHaveProperty('fullName');

  await page.goto('/admin/trainer-settlements');
  await expect(page.getByRole('button', { name: 'Coach Asha' })).toBeVisible();
  await expect(page.getByTestId('trainer-settlement-own-name-ts-1')).toHaveText('Asha Mushi');
});
