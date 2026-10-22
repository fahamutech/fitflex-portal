import { expect, test } from '@playwright/test';
import { OWNER, STAFF_ADMIN, expectNoRawKeys, organizerMe, setupEvents } from './helpers/events-mock';

// Organizer staff (spec §9) against the mocked API: invite contacts, errors, role rules, remove, masking, Swahili.
test.use({ serviceWorkers: 'block' });

test('the owner invites by phone or email; "abc" is refused locally; contacts are masked (P-ST-2, P-ST-5)', async ({ page }) => {
  const mock = await setupEvents(page, OWNER);
  await page.goto('/organizer/staff/');
  const region = page.getByRole('region', { name: 'Organizer staff' });
  await expect(region).toContainText('+255 7•• ••• 123');
  await expect(region).toContainText('j•••@example.com');
  await page.getByTestId('staff-invite').click();
  await page.getByTestId('staff-contact').fill('abc');
  await page.getByTestId('staff-send').click();
  await expect(page.getByRole('dialog')).toContainText('Enter an email address or a Tanzanian phone number.');
  expect(mock.writes(/\/organizer\/staff$/)).toHaveLength(0);
  await page.getByTestId('staff-contact').fill('0712 345 678');
  await page.getByTestId('staff-role-finance').check();
  await page.getByTestId('staff-send').click();
  await expect.poll(() => mock.writes(/\/organizer\/staff$/).length).toBe(1);
  expect(mock.writes(/\/organizer\/staff$/)[0].body).toEqual({ phone: '0712 345 678', role: 'finance' });
  await expect(page.getByRole('status').filter({ hasText: 'Invitation sent.' })).toBeVisible();
  await expect(region.getByRole('row')).toHaveCount(5);
  await page.getByTestId('staff-invite').click();
  await page.getByTestId('staff-contact').fill('name@example.com');
  await page.getByTestId('staff-send').click();
  await expect.poll(() => mock.writes(/\/organizer\/staff$/).length).toBe(2);
  expect(mock.writes(/\/organizer\/staff$/)[1].body).toEqual({ email: 'name@example.com', role: 'ops' });
  await expectNoRawKeys(page);
});

test('a 409 already_staff shows the inline error and keeps the dialog open (P-ST-3)', async ({ page }) => {
  await setupEvents(page, OWNER, { extra: [['POST', /\/organizer\/staff$/, () => ({ status: 409, json: { error: 'already_staff' } })]] });
  await page.goto('/organizer/staff/');
  await page.getByTestId('staff-invite').click();
  await page.getByTestId('staff-contact').fill('+255712345678');
  await page.getByTestId('staff-send').click();
  await expect(page.getByRole('dialog')).toContainText('This person is already on your staff.');
});

test('the owner row has no actions; an admin cannot remove another admin; remove calls DELETE (P-ST-4)', async ({ page }) => {
  const mock = await setupEvents(page, OWNER);
  await page.goto('/organizer/staff/');
  await expect(page.getByTestId('staff-remove-st_owner')).toHaveCount(0);
  await expect(page.getByTestId('staff-remove-st_admin')).toBeVisible();
  await page.getByTestId('staff-remove-st_ops').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => mock.writes(/\/organizer\/staff\/st_ops$/).length).toBe(1);
  expect(mock.writes(/\/organizer\/staff\/st_ops$/)[0].method).toBe('DELETE');
  await expect(page.getByRole('status').filter({ hasText: 'Removed.' })).toBeVisible();
  // Signed in as the admin: the other admin row shows no Remove.
  await setupEvents(page, STAFF_ADMIN, { me: organizerMe('active', 'admin') });
  await page.goto('/organizer/staff/');
  await expect(page.getByTestId('staff-invite')).toBeVisible();
  await expect(page.getByTestId('staff-remove-st_owner')).toHaveCount(0);
  await expect(page.getByTestId('staff-remove-st_ops')).toBeVisible();
});

test('change role sends PATCH {role}', async ({ page }) => {
  const mock = await setupEvents(page, OWNER);
  await page.goto('/organizer/staff/');
  await page.getByTestId('staff-change-role-st_ops').click();
  await page.getByRole('dialog').getByTestId('staff-role-timing').check();
  await page.getByTestId('staff-role-save').click();
  await expect.poll(() => mock.writes(/\/organizer\/staff\/st_ops$/).length).toBe(1);
  expect(mock.writes(/\/organizer\/staff\/st_ops$/)[0].body).toEqual({ role: 'timing' });
});

test('Swahili: roles and statuses are translated and the contact stays masked', async ({ page }) => {
  await setupEvents(page, OWNER, { locale: 'sw' });
  await page.goto('/organizer/staff/');
  const region = page.getByRole('region', { name: 'Wafanyakazi wa mwandaaji' });
  await expect(region).toContainText('Mmiliki');
  await expect(region).toContainText('Amealikwa');
  await expect(region).toContainText('+255 6•• ••• 456');
  await expectNoRawKeys(page);
});
