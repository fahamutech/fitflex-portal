import { expect, test } from '@playwright/test';
import { GYM_OWNER, KYC_INFO, KYC_READY, KYC_REJECTED, KYC_SUBMITTED, OWNER, STAFF_OPS, expectNoRawKeys, organizerMe, setupEvents } from './helpers/events-mock';

// Organizer onboarding states (spec §4), overview (§5), gates (§4.4) and the language toggle, against the mocked API.
test.use({ serviceWorkers: 'block' });

test.describe('organizer onboarding', () => {
  test('a gym owner with no organizer sees state A and creates one without a page reload (P-ON-2)', async ({ page }) => {
    const mock = await setupEvents(page, GYM_OWNER, { me: null });
    await page.goto('/organizer/onboarding/');
    await expect(page.getByTestId('organizer-intro')).toBeVisible();
    // Validation first: a one-letter name and a bad phone send nothing.
    await page.getByTestId('intro-name').fill('D');
    await page.getByTestId('intro-phone').fill('abc');
    await page.getByTestId('intro-submit').click();
    expect(mock.writes(/\/me\/organizer$/)).toHaveLength(0);
    await page.getByTestId('intro-name').fill('Dar Runners');
    await page.getByTestId('intro-phone').fill('0712 345 678');
    // After creation /organizer/me answers with the new draft organizer.
    mock.on('GET', /^\/organizer\/me$/, () => organizerMe('draft'));
    await page.getByTestId('intro-submit').click();
    const write = mock.writes(/\/me\/organizer$/)[0];
    expect(write.body).toEqual({ name: 'Dar Runners', timezone: 'Africa/Dar_es_Salaam', contactPhone: '0712 345 678' });
    await expect(page.getByTestId('organizer-checklist')).toBeVisible();
    await expect(page.getByTestId('organizer-status-badge')).toHaveText('Not submitted');
  });

  test('state B: submit is disabled until nothing is missing; the hint lists the items (P-ON-3)', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('draft') });
    await page.goto('/organizer/onboarding/');
    await expect(page.getByTestId('kyc-submit')).toBeDisabled();
    await expect(page.getByTestId('kyc-missing-hint')).toContainText('Still needed: Registration number, TIN');
    await expect(page.getByTestId('kyc-missing-hint')).toContainText('Payout account');
    // The event permit row carries its hint and is optional.
    await expect(page.getByTestId('kyc-item-documents-event_permit')).toContainText('Optional');
    await expect(page.getByTestId('kyc-item-documents-event_permit')).toContainText('FitFlex asks for it before an event is published');
    await expectNoRawKeys(page);
  });

  test('state B: saving business details and uploading a document hit the /me/kyc routes', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { me: organizerMe('draft') });
    await page.goto('/organizer/onboarding/');
    await page.getByTestId('kyc-legalName').fill('Dar Runners Ltd');
    await page.getByTestId('kyc-save-business').click();
    await expect.poll(() => mock.writes(/\/me\/kyc\/business$/).length).toBe(1);
    await page.getByTestId('kyc-file-tin_certificate').setInputFiles({ name: 'tin.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
    await expect.poll(() => mock.writes(/\/me\/kyc\/documents\/tin_certificate\/file$/).length).toBe(1);
  });

  test('state B → C: a ready checklist submits and shows Under review with a read-only checklist (P-ON-4)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { me: organizerMe('draft'), kyc: KYC_READY });
    await page.goto('/organizer/onboarding/');
    await expect(page.getByTestId('kyc-submit')).toBeEnabled();
    await page.getByTestId('kyc-submit').click();
    mock.on('GET', /^\/organizer\/me$/, () => organizerMe('pending_review'));
    await page.getByRole('alertdialog').getByRole('button', { name: 'Submit for review' }).click();
    await expect.poll(() => mock.writes(/\/me\/kyc\/submit$/).length).toBe(1);
    await expect(page.getByTestId('organizer-status-pending')).toBeVisible();
    await expect(page.getByTestId('organizer-status-badge')).toHaveText('Under review');
    await expect(page.getByTestId('kyc-submit')).toHaveCount(0);
    await expect(page.getByTestId('kyc-withdraw')).toBeVisible();
  });

  test('info requested: the reviewer note shows and only flagged items are editable (P-ON-5)', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('pending_review'), kyc: KYC_INFO });
    await page.goto('/organizer/onboarding/');
    await expect(page.getByRole('alert').filter({ hasText: 'Note from the reviewer' })).toContainText('Please re-upload the TIN certificate.');
    await expect(page.getByTestId('kyc-upload-tin_certificate')).toBeVisible();
    await expect(page.getByTestId('kyc-submit')).toBeVisible();
  });

  test('rejected and suspended show the reason and no event or staff controls (P-ON-6)', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('rejected'), kyc: KYC_REJECTED });
    await page.goto('/organizer/onboarding/');
    await expect(page.getByTestId('organizer-status-rejected')).toContainText('Reason: Duplicate partner');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Events' })).toHaveCount(0);
    await page.goto('/organizer/events/');
    await expect(page.getByTestId('organizer-gate')).toBeVisible();
    await page.goto('/organizer/staff/');
    await expect(page.getByTestId('organizer-gate')).toBeVisible();
  });

  test('suspended: banner on every organizer page, events read-only, no New event (P-OV-3)', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('suspended'), kyc: KYC_SUBMITTED });
    await page.goto('/organizer/');
    await expect(page.getByTestId('organizer-suspended-banner')).toContainText('Reason: Duplicate partner');
    await expect(page.getByTestId('overview-create-event')).toHaveCount(0);
    await page.goto('/organizer/events/');
    await expect(page.getByTestId('organizer-suspended-banner')).toBeVisible();
    await expect(page.getByTestId('events-list')).toBeVisible();
    await expect(page.getByTestId('events-new')).toHaveCount(0);
  });

  test('a non-owner staff member sees the status view read-only with the owner-only note', async ({ page }) => {
    await setupEvents(page, STAFF_OPS, { me: organizerMe('active', 'ops'), kyc: KYC_SUBMITTED });
    await page.goto('/organizer/onboarding/');
    await expect(page.getByText('Only the organizer owner can edit verification details.')).toBeVisible();
    await expect(page.getByTestId('kyc-submit')).toHaveCount(0);
  });

  test('Swahili: the onboarding page shows no English keys and the status reads Inakaguliwa (P-ON-7)', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('pending_review'), kyc: KYC_SUBMITTED, locale: 'sw' });
    await page.goto('/organizer/onboarding/');
    await expect(page.getByTestId('organizer-status-badge')).toHaveText('Inakaguliwa');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Uthibitisho wa mwandaaji');
    await expectNoRawKeys(page);
  });
});

test.describe('organizer overview and gates', () => {
  test('four metric cards, three registration cards at 0 with the coming-soon sub, next up rows (P-OV-1, P-OV-2)', async ({ page }) => {
    await setupEvents(page, OWNER);
    await page.goto('/organizer/');
    const metrics = page.getByTestId('organizer-metrics');
    await expect(metrics.getByText('Available once registration opens')).toHaveCount(3);
    await expect(metrics).toContainText('1 published');
    const rows = page.getByTestId('overview-next-up').getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Dar Half Marathon 2027');
    await expect(rows.first()).toContainText('06:30 EAT');
    await expect(rows.first().getByRole('link', { name: 'Open' })).toHaveAttribute('href', /\/organizer\/events\/?\?event=evt_1/);
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Staff' })).toBeVisible();
    await expectNoRawKeys(page);
  });

  test('at 375px the metric cards stack without horizontal scroll (P-OV-4)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setupEvents(page, OWNER);
    await page.goto('/organizer/');
    await expect(page.getByTestId('organizer-metrics')).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });

  test('a draft organizer opening events or staff is sent to verification first (P-ON gate)', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('draft') });
    await page.goto('/organizer/events/');
    await expect(page.getByTestId('organizer-gate')).toBeVisible();
    await page.getByRole('link', { name: 'Go to verification' }).click();
    await expect(page).toHaveURL(/\/organizer\/onboarding/);
  });

  test('ops staff: no Staff nav item and the staff page is forbidden (P-ST-1)', async ({ page }) => {
    await setupEvents(page, STAFF_OPS, { me: organizerMe('active', 'ops') });
    await page.goto('/organizer/');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Staff' })).toHaveCount(0);
    await page.goto('/organizer/staff/');
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
  });

  test('an organizer session is confined to /organizer; a gym owner cannot open /organizer', async ({ page }) => {
    await setupEvents(page, OWNER);
    await page.goto('/admin/');
    await expect(page).toHaveURL(/\/organizer\/?$/);
    await setupEvents(page, GYM_OWNER, { me: null });
    await page.goto('/organizer/');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('server flag off: GET /organizer/me 404 feature_disabled renders the not-available state', async ({ page }) => {
    await setupEvents(page, OWNER, { extra: [['GET', /^\/organizer\/me$/, () => ({ status: 404, json: { error: 'feature_disabled' } })]] });
    await page.goto('/organizer/');
    await expect(page.getByTestId('events-unavailable')).toBeVisible();
  });
});
