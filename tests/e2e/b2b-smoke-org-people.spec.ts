// Smoke coverage for the organisation's own people and programme screens (src/components/b2b-org.tsx):
// /org/people and /org/programmes for organisation users, /hr/people and /hr/programmes for a company's HR.
import { expect, test } from '@playwright/test';
import { B2BMock, HR, expectNoHorizontalScroll, orgUser, setupB2B } from './helpers/b2b-mock';

test.describe('organisation user', () => {
  let mock: B2BMock;
  test.beforeEach(async ({ page }) => {
    mock = await setupB2B(page, orgUser(['admin']));
  });

  test('people: list, add form controls and request body', async ({ page }) => {
    await page.goto('/org/people');
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    await expect(page.getByTestId('org-people-list')).toContainText('Asha Juma');
    await expect(page.getByTestId('org-people-list')).toContainText('no FitFlex account linked');
    const form = page.getByTestId('org-people-add');
    for (const label of ['Email or mobile number', 'Type', 'Group (optional)', 'Your reference (optional)']) {
      await expect(form.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('org-people-add-button')).toBeDisabled();
    await form.getByLabel('Email or mobile number', { exact: true }).fill('zuhura@example.co.tz');
    await form.getByLabel('Type', { exact: true }).selectOption('employee');
    await form.getByLabel('Group (optional)', { exact: true }).fill('Head office');
    await form.getByLabel('Your reference (optional)', { exact: true }).fill('STAFF-9');
    // An organisation user only asks (functions#283): 202 whoever is behind the email.
    mock.on('POST', /^\/b2b\/organizations\/org-1\/beneficiaries$/, () => ({ status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: {
      id: 'mr-c1', kind: 'beneficiary', source: 'contact', contactType: 'email', contact: 'zuhura@example.co.tz', status: 'pending_member_acceptance', organizationId: 'org-1', corporateId: null, employeeId: null,
      userId: null, displayName: null, role: null, permissions: null, beneficiaryType: 'employee', groupName: 'Head office', externalReference: 'STAFF-9', beneficiaryStatus: 'active',
      expiresAt: '2026-11-12T08:00:00Z', createdAt: '2026-10-29T08:00:00Z', decidedAt: null, reason: null,
    } } }));
    await page.getByTestId('org-people-add-button').click();
    await expect.poll(() => mock.writes(/\/org-1\/beneficiaries$/).length).toBe(1);
    expect(mock.writes(/\/org-1\/beneficiaries$/)[0].body).toEqual({
      email: 'zuhura@example.co.tz', beneficiaryType: 'employee', status: 'active', groupName: 'Head office', externalReference: 'STAFF-9',
    });
    await expect(page.getByText('Request sent. They\'ll be added once they accept in the FitFlex app.')).toBeVisible();
  });

  test('people: search and status buttons', async ({ page }) => {
    await page.goto('/org/people');
    await page.getByPlaceholder('Search by name or reference').fill('asha');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect.poll(() => mock.reads(/\/org-1\/beneficiaries$/).some(c => c.query.search === 'asha')).toBe(true);
    const list = page.getByTestId('org-people-list');
    await list.getByRole('button', { name: 'Suspend' }).click();
    await expect.poll(() => mock.writes(/beneficiaries\/ben-1\/status$/).length).toBe(1);
    expect(mock.writes(/beneficiaries\/ben-1\/status$/)[0].body).toEqual({ status: 'suspended' });
    await list.getByRole('button', { name: 'Activate' }).click();
    await expect.poll(() => mock.writes(/beneficiaries\/ben-2\/status$/).length).toBe(1);
    expect(mock.writes(/beneficiaries\/ben-2\/status$/)[0].body).toEqual({ status: 'active' });
    page.once('dialog', d => d.accept());
    await list.getByRole('button', { name: 'Remove' }).first().click();
    await expect.poll(() => mock.writes(/beneficiaries\/ben-1\/status$/).length).toBe(2);
    expect(mock.writes(/beneficiaries\/ben-1\/status$/)[1].body).toEqual({ status: 'inactive' });
  });

  test('programmes: expand one to see its benefits', async ({ page }) => {
    await page.goto('/org/programmes');
    await expect(page.getByRole('heading', { name: 'Programmes' })).toBeVisible();
    await expect(page.getByTestId('org-programmes')).toContainText('Safari Wellness 2026');
    await expect(page.getByTestId('org-programmes')).toContainText('waiting for FitFlex');
    await page.getByTestId('org-programme-prog-1').click();
    await expect(page.getByRole('table')).toContainText('Monthly gym visits');
    await expect(page.getByRole('table')).toContainText('Gym access');
    await expect(page.getByRole('table')).toContainText('8 per month');
  });

  // Known today: raw <table>s in cards make <main> scroll sideways at 375px by up to this much.
  test('no horizontal scroll at 375px (not worse than the known overflow)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/org/people');
    await expect(page.getByTestId('org-people-list')).toBeVisible();
    await expectNoHorizontalScroll(page, 226);
    await page.goto('/org/programmes');
    await page.getByTestId('org-programme-prog-1').click();
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoHorizontalScroll(page, 0);
  });

  test('every request was handled by the mock', async ({ page }) => {
    await page.goto('/org/people');
    await expect(page.getByTestId('org-people-list')).toBeVisible();
    await page.goto('/org/programmes');
    await page.getByTestId('org-programme-prog-1').click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(mock.unmatched.map(c => `${c.method} ${c.path}`)).toEqual([]);
  });
});

test.describe('company HR', () => {
  let mock: B2BMock;
  test.beforeEach(async ({ page }) => {
    mock = await setupB2B(page, HR);
    // The HR login's organisation is a company set up under Companies.
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: 'org-3', legalName: 'Mwenge Textiles', tradingName: null, role: 'hr', status: 'active' }] }));
  });

  test('staff list, add an employee and link an account', async ({ page }) => {
    await page.goto('/hr/people');
    await expect(page.getByTestId('company-staff-list')).toContainText('Fatuma Hassan');
    await expect(page.getByTestId('company-staff-list')).toContainText('Juma Kileo');
    const form = page.getByTestId('company-staff-add');
    for (const label of ['Employee’s name', 'Email or mobile number (optional)', 'Department (optional)']) {
      await expect(form.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('company-staff-add-button')).toBeDisabled();
    await form.getByLabel('Employee’s name', { exact: true }).fill('Rehema Ally');
    await form.getByLabel('Email or mobile number (optional)', { exact: true }).fill('rehema@mwenge.test');
    await form.getByLabel('Department (optional)', { exact: true }).fill('Finance');
    // HR only asks (functions#283): 202 whoever is behind the email; the request is shown as sent.
    mock.on('POST', /^\/corporate\/staff\/emp-new\/link$/, () => ({ status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: {
      id: 'mr-c2', kind: 'employee_link', source: 'contact', contactType: 'email', contact: 'rehema@mwenge.test', status: 'pending_member_acceptance', organizationId: null, corporateId: 'corp-1', employeeId: 'emp-new',
      userId: null, displayName: null, role: null, permissions: null, beneficiaryType: null, groupName: null, externalReference: null, beneficiaryStatus: null,
      expiresAt: '2026-11-12T08:00:00Z', createdAt: '2026-10-29T08:00:00Z', decidedAt: null, reason: null,
    } } }));
    await page.getByTestId('company-staff-add-button').click();
    await expect.poll(() => mock.writes().length).toBe(3);
    const [provision, activate, link] = mock.writes();
    expect(provision).toMatchObject({ method: 'POST', path: '/corporate/staff', body: { displayName: 'Rehema Ally', department: 'Finance', email: 'rehema@mwenge.test' } });
    expect(activate).toMatchObject({ method: 'POST', path: '/corporate/staff/emp-new/status', body: { status: 'active' } });
    expect(link).toMatchObject({ method: 'POST', path: '/corporate/staff/emp-new/link', body: { email: 'rehema@mwenge.test' } });
    await expect(page.getByText('Rehema Ally added. Request sent. They\'ll be linked once they accept in the FitFlex app.')).toBeVisible();

    // Link an existing, unlinked employee by mobile number, then unlink the linked one.
    await page.getByTestId('company-staff-link-emp-2').fill('0712345678');
    await page.getByTestId('company-staff-list').getByRole('button', { name: 'Link', exact: true }).click();
    await expect.poll(() => mock.writes(/staff\/emp-2\/link$/).length).toBe(1);
    expect(mock.writes(/staff\/emp-2\/link$/)[0].body).toEqual({ phone: '0712345678' });
    await page.getByRole('button', { name: 'Unlink' }).click();
    await expect.poll(() => mock.writes(/staff\/emp-1\/link$/).length).toBe(1);
    expect(mock.writes(/staff\/emp-1\/link$/)[0].body).toEqual({ userId: null });
  });

  test('programmes are read only', async ({ page }) => {
    await page.goto('/hr/programmes');
    await expect(page.getByTestId('org-programmes')).toContainText('Safari Wellness 2026');
  });

  test('every request was handled by the mock', async ({ page }) => {
    await page.goto('/hr/people');
    await expect(page.getByTestId('company-staff-list')).toBeVisible();
    expect(mock.unmatched.map(c => `${c.method} ${c.path}`)).toEqual([]);
  });
});
