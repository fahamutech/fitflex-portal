// People are matched only by a confirmed (verified) email or number (unverified-contact-matching plan S1 + S4):
// the list import warns about email-only people while FitFlex can't send email codes, and user_not_found
// tells staff the contact has not been confirmed in FitFlex.
import { expect, test } from '@playwright/test';
import { ADMIN, HR, orgUser, setupB2B } from './helpers/b2b-mock';

const NOT_FOUND = 'Nobody has confirmed that email or number in FitFlex. They need to sign up in the app, or confirm it under Mobile number and email.';
const preview = (extra: Record<string, unknown>) => ({
  dryRun: true, total: 3, enrolled: 0, invited: 3, unchanged: 0, rejected: 0, withoutEmail: 1, withoutPhone: 2,
  emailConfigured: false, smsConfigured: true, problems: [], ...extra,
});

test.describe('organisation user', () => {
  test('import warns about email-only people when email codes are not available', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/beneficiaries\/import$/, () => preview({ emailCodesAvailable: false }));
    await page.goto('/org/people');
    await page.getByTestId('import-open').click();
    await page.getByTestId('import-text').fill('name,email,phone\nA,a@x.test,\nB,b@x.test,\nC,,0712345678');
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('import-email-only-warning')).toHaveText(
      '2 people are listed by email only. They are matched only after confirming that email in FitFlex; add mobile numbers where you can.',
    );
  });

  for (const [name, extra] of [['an older backend leaves the field out', {}], ['email codes are available', { emailCodesAvailable: true }]] as const) {
    test(`no email-only warning when ${name}`, async ({ page }) => {
      const mock = await setupB2B(page, orgUser(['admin']));
      mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/beneficiaries\/import$/, () => preview(extra));
      await page.goto('/org/people');
      await page.getByTestId('import-open').click();
      await page.getByTestId('import-text').fill('name,email\nA,a@x.test');
      await page.getByTestId('import-check').click();
      await expect(page.getByTestId('import-preview')).toBeVisible();
      await expect(page.getByTestId('import-email-only-warning')).toHaveCount(0);
    });
  }

  test('adding someone by an unconfirmed contact explains user_not_found', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/beneficiaries$/, () => ({ status: 404, json: { error: 'user_not_found' } }));
    await page.goto('/org/people');
    const form = page.getByTestId('org-people-add');
    await form.getByLabel('Email or mobile number', { exact: true }).fill('zuhura@example.co.tz');
    await page.getByTestId('org-people-add-button').click();
    await expect(page.getByText(NOT_FOUND)).toBeVisible();
  });
});

test.describe('company HR', () => {
  test('linking an employee by an unconfirmed contact explains user_not_found', async ({ page }) => {
    const mock = await setupB2B(page, HR);
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: 'org-3', legalName: 'Mwenge Textiles', tradingName: null, role: 'hr', status: 'active' }] }));
    mock.on('POST', /^\/corporate\/staff\/([^/]+)\/link$/, () => ({ status: 404, json: { error: 'user_not_found' } }));
    await page.goto('/hr/people');
    await page.getByTestId('company-staff-link-emp-2').fill('0712345678');
    await page.getByTestId('company-staff-list').getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByText(NOT_FOUND)).toBeVisible();
  });
});

test.describe('admin B2B', () => {
  const ID_NOT_FOUND = 'No FitFlex account has that ID.';
  test('user_not_found says the ID matched no account only when the request was by ID', async ({ page }) => {
    const mock = await setupB2B(page, ADMIN);
    mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/users$/, () => ({ status: 404, json: { error: 'user_not_found' } }));
    mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/beneficiaries$/, () => ({ status: 404, json: { error: 'user_not_found' } }));
    await page.goto('/admin/b2b');
    await page.getByTestId('b2b-org-org-1').click();

    const userForm = page.getByTestId('b2b-user-form');
    await userForm.getByPlaceholder('Their email, mobile number or user ID').fill('usr_missing');
    await userForm.getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByText(ID_NOT_FOUND)).toBeVisible();
    expect(mock.writes(/\/org-1\/users$/).at(-1)?.body).toMatchObject({ userId: 'usr_missing' });

    await userForm.getByPlaceholder('Their email, mobile number or user ID').fill('zuhura@safari.test');
    await userForm.getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByText(NOT_FOUND)).toBeVisible();
    await expect(page.getByText(ID_NOT_FOUND)).toHaveCount(0);

    const benForm = page.getByTestId('b2b-beneficiary-form');
    await benForm.getByPlaceholder('Member’s email, mobile number or user ID').fill('usr_missing');
    await page.getByTestId('b2b-ben-enroll').click();
    await expect(page.getByText(ID_NOT_FOUND)).toBeVisible();

    await benForm.getByPlaceholder('Member’s email, mobile number or user ID').fill('0712345678');
    await page.getByTestId('b2b-ben-enroll').click();
    await expect(page.getByText(NOT_FOUND)).toBeVisible();
    await expect(page.getByText(ID_NOT_FOUND)).toHaveCount(0);
  });
});
