// People are matched only by a confirmed (verified) email or number (unverified-contact-matching plan S1 + S4):
// the list import warns about email-only people while FitFlex can't send email codes, and (FitFlex admins, who still
// add directly) user_not_found tells staff the contact has not been confirmed in FitFlex.
import { expect, test } from '@playwright/test';
import { ADMIN, orgUser, setupB2B } from './helpers/b2b-mock';

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

  // Since functions#283 an organisation user's add by email or number never answers user_not_found: it is a 202
  // whoever is behind the contact (tests in b2b-member-requests.spec.ts). The import copy no longer says anyone is
  // added at once.
  test('import preview: everyone new is invited, nobody "added now"', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/beneficiaries\/import$/, c => (c.body?.dryRun
      ? preview({ emailCodesAvailable: true })
      : { ...preview({ emailCodesAvailable: true }), dryRun: undefined, importId: 'b2bim_1' }));
    await page.goto('/org/people');
    await expect(page.getByText('Anyone already on FitFlex is asked in the app within about 10 minutes and added only if they accept.')).toBeVisible();
    await page.getByTestId('import-open').click();
    await page.getByTestId('import-text').fill('name,email\nA,a@x.test');
    await page.getByTestId('import-check').click();
    const shown = page.getByTestId('import-preview');
    await expect(shown).toContainText('Will be invited');
    await expect(shown).not.toContainText(/added now|Already use FitFlex/i);
    await page.getByTestId('import-confirm').click();
    await expect(page.getByText('Done. 3 invited. Anyone already on FitFlex will be asked in the app within about 10 minutes. Each invite stays as invited until the person accepts.')).toBeVisible();
    await expect(page.getByTestId('import-result')).not.toContainText(/added now/i);
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
