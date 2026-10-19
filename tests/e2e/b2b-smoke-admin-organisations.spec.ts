// Smoke coverage for /admin/b2b (organisations, users, beneficiaries) and the programme manager it
// embeds (src/components/b2b-programs.tsx). Mock-driven: asserts what renders, which labelled controls
// exist, and the exact request each form sends.
import { expect, test } from '@playwright/test';
import { ADMIN, B2BMock, ORG_COMPANY, PROGRAM, expectNoHorizontalScroll, setupB2B } from './helpers/b2b-mock';

let mock: B2BMock;
test.beforeEach(async ({ page }) => {
  mock = await setupB2B(page, ADMIN);
});

const openOrg = async (page: import('@playwright/test').Page, id = 'org-1') => {
  await page.getByTestId(`b2b-org-${id}`).click();
};

test('lists organisations and keeps its filter controls', async ({ page }) => {
  await page.goto('/admin/b2b');
  await expect(page.getByRole('heading', { name: 'B2B organisations' })).toBeVisible();
  await expect(page.getByTestId('b2b-list')).toContainText('Safari Insurance Ltd');
  await expect(page.getByTestId('b2b-list')).toContainText('Kilimani Club Ltd');
  await expect(page.getByTestId('programs-awaiting')).toContainText('Awaiting Programme');
  // Filters (header selects) are named by aria-label.
  await expect(page.getByLabel('Type', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Status', { exact: true })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('pending');
  await expect.poll(() => mock.reads(/^\/admin\/b2b\/organizations$/).some(c => c.query.status === 'pending')).toBe(true);
  await page.getByLabel('Type', { exact: true }).selectOption('club');
  await expect.poll(() => mock.reads(/^\/admin\/b2b\/organizations$/).some(c => c.query.type === 'club' && c.query.status === 'pending')).toBe(true);
  await expect(page.getByRole('button', { name: 'Sync companies' })).toBeVisible();
});

test('creates an organisation: form controls and request body', async ({ page }) => {
  await page.goto('/admin/b2b');
  await page.getByTestId('b2b-new').click();
  const form = page.getByTestId('b2b-create-form');
  for (const label of ['Type', 'Legal name', 'Trading name', 'Sector', 'Registration number', 'TIN', 'Email', 'Phone']) {
    await expect(form.getByLabel(label, { exact: true })).toBeVisible();
  }
  await form.getByLabel('Type', { exact: true }).selectOption('bank');
  await form.getByLabel('Legal name', { exact: true }).fill('Kibo Bank Plc');
  await form.getByLabel('Trading name', { exact: true }).fill('Kibo Bank');
  await form.getByLabel('Sector', { exact: true }).selectOption('banking');
  await form.getByLabel('Registration number', { exact: true }).fill('REG-777');
  await form.getByLabel('TIN', { exact: true }).fill('TIN-888');
  await form.getByLabel('Email', { exact: true }).fill('hello@kibo.test');
  await form.getByLabel('Phone', { exact: true }).fill('0713000111');
  await page.getByTestId('b2b-create').click();
  await expect.poll(() => mock.writes(/^\/admin\/b2b\/organizations$/).length).toBe(1);
  expect(mock.writes(/^\/admin\/b2b\/organizations$/)[0]).toMatchObject({
    method: 'POST',
    body: { organizationType: 'bank', legalName: 'Kibo Bank Plc', tradingName: 'Kibo Bank', industrySector: 'banking', registrationNumber: 'REG-777', taxIdentificationNumber: 'TIN-888', email: 'hello@kibo.test', phone: '0713000111' },
  });
  await expect(page.getByText('Organisation created. It stays pending until you activate it.')).toBeVisible();
  // Empty fields are left out of the body.
  await page.getByTestId('b2b-new').click();
  await page.getByTestId('b2b-legal-name').fill('Minimal Club');
  await page.getByTestId('b2b-create').click();
  await expect.poll(() => mock.writes(/^\/admin\/b2b\/organizations$/).length).toBe(2);
  expect(mock.writes(/^\/admin\/b2b\/organizations$/)[1].body).toEqual({ organizationType: 'insurer', legalName: 'Minimal Club' });
});

test('organisation detail: status change, users and beneficiaries', async ({ page }) => {
  await page.goto('/admin/b2b');
  await openOrg(page, 'org-2'); // pending
  await expect(page.getByText('Kilimani Club Ltd').first()).toBeVisible();
  await page.getByTestId('b2b-status-active').click();
  await expect.poll(() => mock.writes(/\/status$/).length).toBe(1);
  expect(mock.writes(/\/status$/)[0]).toMatchObject({ method: 'POST', path: '/admin/b2b/organizations/org-2/status', body: { status: 'active' } });

  await openOrg(page, 'org-1');
  await expect(page.getByTestId('b2b-users')).toContainText('Neema Admin');
  await expect(page.getByTestId('b2b-beneficiaries')).toContainText('Asha Juma');

  // Per-user role select (aria-label "Role") sends a PUT with the new role.
  await page.getByTestId('b2b-users').getByLabel('Role').selectOption('finance');
  await expect.poll(() => mock.writes(/\/users\/ou-1$/).length).toBe(1);
  expect(mock.writes(/\/users\/ou-1$/)[0]).toMatchObject({ method: 'PUT', path: '/b2b/organizations/org-1/users/ou-1', body: { role: 'finance' } });

  // Suspend the user.
  await page.getByTestId('b2b-users').getByRole('button', { name: 'Suspend' }).click();
  await expect.poll(() => mock.writes(/\/users\/ou-1$/).length).toBe(2);
  expect(mock.writes(/\/users\/ou-1$/)[1].body).toEqual({ status: 'suspended' });

  // Add a user by email with a role.
  const userForm = page.getByTestId('b2b-user-form');
  await userForm.getByPlaceholder('Their email, mobile number or user ID').fill('zuhura@safari.test');
  await userForm.getByLabel('Role').selectOption('analyst');
  await userForm.getByRole('button', { name: 'Add user' }).click();
  await expect.poll(() => mock.writes(/\/org-1\/users$/).length).toBe(1);
  expect(mock.writes(/\/org-1\/users$/)[0]).toMatchObject({ method: 'POST', body: { email: 'zuhura@safari.test', role: 'analyst' } });

  // Enrol a beneficiary by mobile number.
  const benForm = page.getByTestId('b2b-beneficiary-form');
  await benForm.getByPlaceholder('Member’s email, mobile number or user ID').fill('0712345678');
  await benForm.getByLabel('Beneficiary type').selectOption('policyholder');
  await benForm.getByPlaceholder('Reference (policy / staff no.)').fill('POL-55');
  await benForm.getByPlaceholder('Group / department').fill('Finance');
  await page.getByTestId('b2b-ben-enroll').click();
  await expect.poll(() => mock.writes(/\/org-1\/beneficiaries$/).length).toBe(1);
  expect(mock.writes(/\/org-1\/beneficiaries$/)[0]).toMatchObject({
    method: 'POST', body: { phone: '0712345678', beneficiaryType: 'policyholder', externalReference: 'POL-55', groupName: 'Finance' },
  });

  // Beneficiary status button (active -> suspended / inactive).
  await page.getByTestId('b2b-beneficiaries').getByRole('button', { name: 'Suspend' }).first().click();
  await expect.poll(() => mock.writes(/\/beneficiaries\/ben-1\/status$/).length).toBe(1);
  expect(mock.writes(/\/beneficiaries\/ben-1\/status$/)[0]).toMatchObject({ method: 'POST', body: { status: 'suspended' } });
});

test('a company organisation is read-only and can be converted, companies can be synced', async ({ page }) => {
  await page.goto('/admin/b2b');
  await page.getByTestId('b2b-sync').click();
  await expect(page.getByText('2 companies added as employer organisations.')).toBeVisible();
  expect(mock.writes(/corporate-sync$/)[0]).toMatchObject({ method: 'POST', path: '/admin/b2b/corporate-sync' });

  await openOrg(page, ORG_COMPANY.id);
  await expect(page.getByTestId('b2b-mapped-note')).toBeVisible();
  await expect(page.getByTestId('b2b-beneficiary-form')).toHaveCount(0);
  await page.getByTestId('b2b-convert-seats').click();
  await expect.poll(() => mock.writes(/\/convert$/).length).toBe(1);
  expect(mock.writes(/\/convert$/)[0].path).toBe('/admin/b2b/corporate/corp-1/convert');
  await expect(page.getByText(/Draft programme “Seats programme” created/)).toBeVisible();
});

test.describe('programmes', () => {
  test('create a programme with groups and open it', async ({ page }) => {
    await page.goto('/admin/b2b');
    await openOrg(page);
    await expect(page.getByTestId('program-list')).toContainText('Safari Wellness 2026');
    await page.getByTestId('program-new').click();
    const form = page.getByTestId('program-form');
    for (const label of ['Name', 'Type', 'Starts', 'Ends (optional)', 'Sponsor budget, TSh (optional)', 'Discount on pass prices, % (optional)', 'Who is eligible',
      'Only these beneficiary types (optional, comma-separated)', 'Description']) {
      await expect(form.getByLabel(label, { exact: true })).toBeVisible();
    }
    await form.getByLabel('Name', { exact: true }).fill('Winter Fitness');
    await form.getByLabel('Type', { exact: true }).selectOption('fitness');
    await form.getByLabel('Starts', { exact: true }).fill('2026-11-01');
    await form.getByLabel('Ends (optional)', { exact: true }).fill('2027-01-31');
    await form.getByLabel('Sponsor budget, TSh (optional)', { exact: true }).fill('2500000');
    await form.getByLabel('Discount on pass prices, % (optional)', { exact: true }).fill('12.5');
    await form.getByLabel('Who is eligible', { exact: true }).selectOption('groups');
    // Group checkboxes come from the organisation's beneficiaries.
    await expect(page.getByTestId('program-groups').getByRole('checkbox')).toHaveCount(2);
    await page.getByTestId('program-groups').getByLabel('Head office').check();
    await form.getByLabel('Only these beneficiary types (optional, comma-separated)', { exact: true }).fill('policyholder, employee');
    await form.getByLabel('Description', { exact: true }).fill('Winter programme');
    await page.getByTestId('program-save').click();
    await expect.poll(() => mock.writes(/\/org-1\/programs$/).length).toBe(1);
    expect(mock.writes(/\/org-1\/programs$/)[0]).toMatchObject({ method: 'POST' });
    expect(mock.writes(/\/org-1\/programs$/)[0].body).toEqual({
      name: 'Winter Fitness', description: 'Winter programme', programType: 'fitness', startDate: '2026-11-01', endDate: '2027-01-31', budgetTzs: 2500000, discountBps: 1250,
      eligibility: { scope: 'groups', groups: ['Head office'], beneficiaryIds: [], beneficiaryTypes: ['policyholder', 'employee'] },
    });
  });

  test('selected beneficiaries are listed as checkboxes', async ({ page }) => {
    await page.goto('/admin/b2b');
    await openOrg(page);
    await page.getByTestId('program-new').click();
    await page.getByTestId('program-name').fill('Pick People');
    await page.getByTestId('program-start').fill('2026-11-01');
    await page.getByTestId('program-scope').selectOption('selected');
    await page.getByLabel('Baraka Mushi').check();
    await page.getByTestId('program-save').click();
    await expect.poll(() => mock.writes(/\/org-1\/programs$/).length).toBe(1);
    expect(mock.writes(/\/org-1\/programs$/)[0].body).toMatchObject({ eligibility: { scope: 'selected', beneficiaryIds: ['ben-2'] } });
  });

  test('programme detail: status moves, edit, usage and eligibility', async ({ page }) => {
    await page.goto('/admin/b2b');
    await openOrg(page);
    await page.getByTestId('program-prog-1').click();
    const detail = page.getByTestId('program-detail');
    await expect(detail).toContainText('Safari Wellness 2026');
    await expect(detail).toContainText('Monthly gym visits');
    await page.getByTestId('program-move-pending').click();
    await expect.poll(() => mock.writes(/\/programs\/prog-1\/status$/).length).toBe(1);
    expect(mock.writes(/\/programs\/prog-1\/status$/)[0]).toMatchObject({ method: 'POST', body: { status: 'pending' } });

    // Edit sends a PUT with the whole form.
    await detail.getByRole('button', { name: 'Edit' }).first().click();
    await page.getByTestId('program-name').fill('Safari Wellness 2026 (renamed)');
    await page.getByTestId('program-save').click();
    await expect.poll(() => mock.writes(/\/programs\/prog-1$/).length).toBe(1);
    expect(mock.writes(/\/programs\/prog-1$/)[0]).toMatchObject({
      method: 'PUT', body: { name: 'Safari Wellness 2026 (renamed)', startDate: '2026-10-01', endDate: '2026-12-31', budgetTzs: 5000000, programType: 'wellness' },
    });

    await page.getByTestId('program-eligibility').click();
    await expect(page.getByTestId('eligibility-panel')).toContainText('1 of 2 beneficiaries match');
    expect(mock.reads(/\/programs\/prog-1\/eligibility$/)[0].query).toMatchObject({ include: 'all', limit: '100' });
  });

  test('add, edit and activate a benefit', async ({ page }) => {
    await page.goto('/admin/b2b');
    await openOrg(page);
    await page.getByTestId('program-prog-1').click();
    await page.getByTestId('benefit-new').click();
    const form = page.getByTestId('benefit-form');
    // Labelled controls the migration has to keep. "Who pays" is a select whose label sits beside two
    // children, so it has no accessible name today and is found by test id.
    for (const label of ['Benefit name', 'Type', 'Usage period', 'Uses per period (blank = no count limit)', 'Valid from (blank = programme start)', 'Valid to (blank = programme end)',
      'Providers', 'Only for groups (optional)', 'Only for beneficiary types (optional)', 'Terms', 'Description']) {
      await expect(form.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('benefit-funding')).toBeVisible();
    await form.getByLabel('Benefit name', { exact: true }).fill('Weekend gym visits');
    await form.getByLabel('Usage period', { exact: true }).selectOption('week');
    await form.getByLabel('Uses per period (blank = no count limit)', { exact: true }).fill('3');
    await form.getByLabel('Providers', { exact: true }).selectOption('selected');
    await form.getByLabel('Gym IDs (comma-separated)', { exact: true }).fill('gym-1, gym-2');
    for (const tier of ['premium', 'luxury_executive']) await form.getByLabel(tier, { exact: true }).check();
    await form.getByLabel('Terms', { exact: true }).fill('Weekends only');
    await page.getByTestId('benefit-save').click();
    await expect.poll(() => mock.writes(/\/prog-1\/benefits$/).length).toBe(1);
    expect(mock.writes(/\/prog-1\/benefits$/)[0]).toMatchObject({ method: 'POST' });
    expect(mock.writes(/\/prog-1\/benefits$/)[0].body).toEqual({
      name: 'Weekend gym visits', description: null, benefitType: 'gym_access', fundingType: 'full', sponsorAmountTzs: null, sponsorShareBps: null, sponsorCapTzs: null,
      beneficiaryAmountTzs: null, passTier: null, usagePeriod: 'week', usageLimit: 3, periodSponsorCapTzs: null, startDate: null, endDate: null, terms: 'Weekends only',
      fixedFeeTzs: null, // the per-person fee is sent since it was added; empty here
      providerRules: { scope: 'selected', gymIds: ['gym-1', 'gym-2'], gymTiers: ['premium', 'luxury_executive'] }, eligibility: null,
    });

    // Activate the existing benefit.
    await page.getByTestId('benefit-bnf-1-active').click();
    await expect.poll(() => mock.writes(/\/benefits\/bnf-1\/status$/).length).toBe(1);
    expect(mock.writes(/\/benefits\/bnf-1\/status$/)[0]).toMatchObject({ method: 'POST', body: { status: 'active' } });
  });

  test('a sponsored pass shows the pass-tier and money fields', async ({ page }) => {
    await page.goto('/admin/b2b');
    await openOrg(page);
    await page.getByTestId('program-prog-1').click();
    await page.getByTestId('benefit-new').click();
    const form = page.getByTestId('benefit-form');
    await form.getByLabel('Benefit name', { exact: true }).fill('Pass for all');
    await page.getByTestId('benefit-type').selectOption('sponsored_pass');
    await expect(form.getByLabel('Pass tier', { exact: true })).toBeVisible();
    await page.getByTestId('benefit-funding').selectOption('sponsor_fixed');
    await form.getByLabel('Sponsor pays per person per month (TSh)', { exact: true }).fill('30000');
    await form.getByLabel('Pass tier', { exact: true }).selectOption('premium');
    await page.getByTestId('benefit-save').click();
    await expect.poll(() => mock.writes(/\/prog-1\/benefits$/).length).toBe(1);
    expect(mock.writes(/\/prog-1\/benefits$/)[0].body).toMatchObject({
      benefitType: 'sponsored_pass', fundingType: 'sponsor_fixed', sponsorAmountTzs: 30000, passTier: 'premium', usagePeriod: 'unlimited', usageLimit: null,
    });
  });

  test('a budget-paused programme asks for a remark before resuming', async ({ page }) => {
    mock.on('GET', /^\/b2b\/organizations\/org-1\/programs\/prog-1$/, () => ({
      program: { ...PROGRAM, status: 'active', effectiveStatus: 'paused', statusReason: 'budget_exhausted' }, benefits: [],
    }));
    await page.goto('/admin/b2b');
    await openOrg(page);
    await page.getByTestId('program-prog-1').click();
    await page.getByTestId('resume-remark').fill('Budget topped up');
    await page.getByTestId('program-move-active').click();
    await expect.poll(() => mock.writes(/\/programs\/prog-1\/status$/).length).toBe(1);
    expect(mock.writes(/\/programs\/prog-1\/status$/)[0].body).toEqual({ status: 'active', reason: 'Budget topped up' });
  });
});

// Known today: the three header action buttons do not wrap, so <main> overflows by 20px at 375px.
const KNOWN_OVERFLOW = 20;
test('no horizontal scroll at 375px (beyond the known 20px header overflow)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/admin/b2b');
  await expect(page.getByTestId('b2b-list')).toBeVisible();
  await expectNoHorizontalScroll(page, KNOWN_OVERFLOW);
  await openOrg(page);
  await expect(page.getByTestId('b2b-users')).toBeVisible();
  await page.getByTestId('program-prog-1').click();
  await expect(page.getByTestId('program-detail')).toBeVisible();
  await page.getByTestId('benefit-new').click();
  await expect(page.getByTestId('benefit-form')).toBeVisible();
  await expectNoHorizontalScroll(page, KNOWN_OVERFLOW);
});

test('every request was handled by the mock', async ({ page }) => {
  await page.goto('/admin/b2b');
  await openOrg(page);
  await expect(page.getByTestId('program-list')).toBeVisible();
  expect(mock.unmatched.map(c => `${c.method} ${c.path}`)).toEqual([]);
});
