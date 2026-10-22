import { expect, test } from '@playwright/test';
import { ADMIN_DOC, EVENTS_KYC_STAFF, EVENTS_STAFF, OTHER_STAFF, PUBLISHED, SUPER_ADMIN, expectNoRawKeys, setupEvents } from './helpers/events-mock';

// Admin moderation queue (spec §8) against the mocked API: scope gating, tabs, permit badge, approve, reject, KYC link, audit.
test.use({ serviceWorkers: 'block' });

test('staff without the events scope get no nav item and are redirected (P-AD-1)', async ({ page }) => {
  await setupEvents(page, OTHER_STAFF);
  // The redirect target is compiled on demand by the dev server: warm it so the client-side replace completes promptly.
  await page.goto('/admin/');
  await page.goto('/admin/events/');
  await expect(page).not.toHaveURL(/\/admin\/events/, { timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /Events/ })).toHaveCount(0);
});

test('the nav item carries the submitted count; the Submitted tab lists the row with the permit badge; approve publishes (P-AD-2)', async ({ page }) => {
  const mock = await setupEvents(page, EVENTS_STAFF);
  await page.goto('/admin/events/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: '1 events waiting for review' })).toBeVisible();
  const region = page.getByRole('region', { name: 'Events for review' });
  await expect(region.getByRole('row')).toHaveCount(2);
  await expect(region).toContainText('Moshi Marathon');
  await expect(region).toContainText('Missing');
  await expect(region).toContainText('Verified');
  await page.getByTestId('admin-event-open-evt_sub').click();
  await expect(page.getByTestId('admin-event-detail')).toBeVisible();
  await expect(page.getByTestId('admin-permit-missing')).toBeVisible();
  await page.getByTestId('admin-approve').click();
  await page.getByTestId('admin-approve-note').fill('Looks good');
  mock.on('GET', /^\/admin\/events\/evt_sub$/, () => ADMIN_DOC({ ...PUBLISHED, id: 'evt_sub', title: 'Moshi Marathon' }));
  await page.getByTestId('admin-approve-confirm').click();
  await expect.poll(() => mock.writes(/\/admin\/events\/evt_sub\/decision$/).length).toBe(1);
  expect(mock.writes(/\/decision$/)[0].body).toEqual({ decision: 'approve', note: 'Looks good' });
  await expect(page.getByRole('status').filter({ hasText: 'Published.' })).toBeVisible();
  await expect(page.getByTestId('admin-event-detail')).toContainText('Published');
  await expectNoRawKeys(page);
});

test('reject needs a reason and a note; both are sent (P-AD-3)', async ({ page }) => {
  const mock = await setupEvents(page, EVENTS_STAFF);
  await page.goto('/admin/events/?event=evt_sub');
  await page.getByTestId('admin-reject').click();
  await expect(page.getByTestId('admin-reject-confirm')).toBeDisabled();
  await page.getByTestId('admin-reject-reason').selectOption('permit_missing');
  await expect(page.getByTestId('admin-reject-confirm')).toBeDisabled();
  await page.getByTestId('admin-reject-note').fill('Please upload the permit.');
  await page.getByTestId('admin-reject-confirm').click();
  await expect.poll(() => mock.writes(/\/decision$/).length).toBe(1);
  expect(mock.writes(/\/decision$/)[0].body).toEqual({ decision: 'reject', reason: 'permit_missing', note: 'Please upload the permit.' });
  await expect(page.getByRole('status').filter({ hasText: 'Returned to the organizer.' })).toBeVisible();
});

test('a 409 invalid_transition says the event moved on and reloads', async ({ page }) => {
  const mock = await setupEvents(page, EVENTS_STAFF, { extra: [['POST', /\/decision$/, () => ({ status: 409, json: { error: 'invalid_transition' } })]] });
  await page.goto('/admin/events/?event=evt_sub');
  await page.getByTestId('admin-approve').click();
  await page.getByTestId('admin-approve-confirm').click();
  await expect(page.getByRole('alert').filter({ hasText: 'This event has already moved on. Refresh.' })).toBeVisible();
  await expect.poll(() => mock.reads(/^\/admin\/events\/evt_sub$/).length).toBeGreaterThanOrEqual(2);
});

test('the KYC link opens the case with the kyc scope and is disabled without it (P-AD-4)', async ({ page }) => {
  await setupEvents(page, EVENTS_STAFF);
  await page.goto('/admin/events/?event=evt_sub');
  await expect(page.getByTestId('admin-open-kyc')).toBeDisabled();
  await expect(page.getByTestId('admin-organizer-card')).toContainText('Needs the verification (KYC) permission.');
  await setupEvents(page, EVENTS_KYC_STAFF);
  await page.goto('/admin/events/?event=evt_sub');
  await expect(page.getByTestId('admin-open-kyc')).toHaveAttribute('href', /\/admin\/kyc\/?\?case=kyc_1$/);
});

test('Preview as member shows the Swahili description when SW is active; nothing else is a raw key (P-AD-5, P-AD-6)', async ({ page }) => {
  await setupEvents(page, SUPER_ADMIN, { locale: 'sw' });
  await page.goto('/admin/events/?event=evt_sub');
  const summary = page.getByTestId('event-review-summary');
  await expect(summary).toContainText('This is a long enough description');
  await page.getByTestId('admin-preview-member').check();
  await expect(summary).toContainText('Haya ni maelezo marefu');
  await expect(page.getByTestId('admin-decision-card')).toContainText('Chapisha');
  await expectNoRawKeys(page);
});

test('later statuses offer cancel/archive, the audit card lists rows, the Audit tab filters by action', async ({ page }) => {
  await setupEvents(page, SUPER_ADMIN);
  await page.goto('/admin/events/?event=evt_pub');
  await expect(page.getByTestId('admin-action-cancel')).toBeVisible();
  await expect(page.getByTestId('admin-event-audit')).toContainText('Submitted');
  await page.goto('/admin/events/?tab=audit');
  await expect(page.getByTestId('admin-events-audit')).toContainText('Admin One');
  await expect(page.getByTestId('admin-events-audit')).toContainText('Submitted');
  // The filter lists the backend's real action names, translated.
  await expect(page.getByRole('combobox', { name: 'Action' }).locator('option', { hasText: 'Staff role changed' })).toHaveAttribute('value', 'events.staff_role_changed');
  await page.goto('/admin/events/?tab=published');
  await expect(page.getByRole('region', { name: 'Events for review' })).toContainText('Arusha Trail 10K');
});

test('server flag off: the queue renders the not-available state', async ({ page }) => {
  await setupEvents(page, SUPER_ADMIN, { extra: [['GET', /^\/admin\/events$/, () => ({ status: 404, json: { error: 'feature_disabled' } })]] });
  await page.goto('/admin/events/');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
});
