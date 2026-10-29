// Phase B · B5b: company HR moves from /hr to /org (server flag ORG_ONLY_SPONSORS; fitflex-functions#252,
// B2B_FOUNDATION.md §3a). Everything is mocked: sign-in marks, the /hr → /org redirects, the session refresh
// for an HR login signed in before the flag, and the company staff list written through /b2b/... routes.
import { expect, Page, test } from '@playwright/test';
import { B2BMock, HR, Json, setupB2B } from './helpers/b2b-mock';

const MARKED_HR = { ...HR, organizationUser: true, organizationRoles: ['hr'], organizationIds: ['org-3'] };
const MY_COMPANY = { organizations: [{ id: 'org-3', legalName: 'Mwenge Textiles', tradingName: null, role: 'hr', status: 'active' }] };
// GET /b2b/me/organization-session (functions#252): what a sign-in would say about this session now.
const SESSION = /^\/b2b\/me\/organization-session$/;
const flagOn = (mock: B2BMock) => mock.on('GET', SESSION, () => ({ orgOnlySponsors: true, organizationUser: true, organizationRoles: ['hr'], organizationIds: ['org-3'] }));
const HR_ACCESS = ['organization.read', 'beneficiaries.read', 'beneficiaries.manage', 'programs.read', 'analytics.read', 'analytics.people', 'engagement.read'];

const EMPLOYEES = [
  { id: 'cemp_1', organizationId: 'org-3', userId: 'usr-20', displayName: 'Fatuma Hassan', externalReference: null, beneficiaryType: 'employee', groupName: 'Sales', status: 'active', enrolledAt: '2026-09-01', source: 'corporate_employee', readOnly: false, employeeStatus: 'active', linked: true, email: 'fatuma@mwenge.test', phone: null },
  { id: 'cemp_2', organizationId: 'org-3', userId: null, displayName: 'Juma Kileo', externalReference: null, beneficiaryType: 'employee', groupName: null, status: 'pending', enrolledAt: null, source: 'corporate_employee', readOnly: false, employeeStatus: 'pending', linked: false, email: null, phone: '+255712000000' },
  { id: 'cemp_3', organizationId: 'org-3', userId: null, displayName: 'Rehema Ally', externalReference: null, beneficiaryType: 'employee', groupName: 'Finance', status: 'suspended', enrolledAt: null, source: 'corporate_employee', readOnly: false, employeeStatus: 'suspended', linked: false, email: null, phone: null },
];

/** The company organisation as an HR login sees it, with the flag on and the staff list above. */
// Owner decision (functions#252 7bee485): only org roles hr and admin manage a company's staff.
const STAFF_ROLES = new Set(['hr', 'admin']);
/** Employee rows as a role that may not manage company staff gets them: read-only, no contact details. */
const readOnlyRows = () => EMPLOYEES.map(({ email, phone, ...e }) => ({ ...e, readOnly: true })); // eslint-disable-line @typescript-eslint/no-unused-vars

/** The company organisation as `role` sees it (default hr), with the flag on and the staff list above. */
async function companyOrg(page: Page, user: Json = MARKED_HR, permissions = HR_ACCESS, role = 'hr') {
  const manage = STAFF_ROLES.has(role) && permissions.includes('beneficiaries.manage');
  const mock = await setupB2B(page, user);
  mock.on('GET', /^\/b2b\/me\/organizations$/, () => MY_COMPANY);
  mock.on('GET', /^\/b2b\/organizations\/org-3$/, () => ({ organization: { id: 'org-3', organizationType: 'employer', legalName: 'Mwenge Textiles', tradingName: null, legacyCorporateId: 'corp-1', status: 'active', source: 'corporate', managedFields: ['legalName'] }, access: { role, permissions, companyStaffManage: manage } }));
  mock.on('GET', /^\/b2b\/organizations\/org-3\/beneficiaries$/, () => {
    const items = manage ? EMPLOYEES : readOnlyRows();
    return { items, total: items.length, nextCursor: null };
  });
  flagOn(mock);
  return mock;
}
/** An add-by-contact reply: no userId or linked (functions#252 f4c0928), so it can't tell who is a member. */
const byContact = ({ userId, linked, ...rest }: Json) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars
/**
 * 202 for an add or link named by email, number or user id (functions#252 8e911a4): the member is asked first.
 * By email/number memberRequest.id and userId are null, so the reply never says whether a member is behind it.
 */
const pendingReply = (extra: Json) => ({ status: 202, json: {
  outcome: 'pending_member_acceptance',
  memberRequest: { id: null, kind: 'employee_link', status: 'pending_member_acceptance', organizationId: 'org-3', corporateId: 'corp-1', employeeId: extra.beneficiary?.id ?? null, userId: null, displayName: null, role: null, permissions: null, beneficiaryType: null, groupName: null, externalReference: null, beneficiaryStatus: null, expiresAt: '2026-11-12T08:00:00Z', createdAt: '2026-10-29T08:00:00Z', decidedAt: null, reason: null },
  writtenThrough: 'corporate_staff', ...extra,
} });
const storedUser = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('user') || 'null'));

// `next dev` compiles each page on its first visit (seconds for /org/insights with its charts), and these tests
// are often the first to open an /org page: give navigation time (test.slow triples the test timeout).
const FIRST_VISIT = { timeout: 60_000 };

test.describe('sign-in and routing', () => {
  test.slow();
  test.beforeEach(async ({ page }) => {
    // Nothing may reach a real service (live API, Firebase, Google).
    await page.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
    // `next dev` compiles a page on its first request; a first compile in the middle of the sign-in redirect could
    // leave the page on /login. Ask for the pages these tests land on first (the shipped static export has no compile step).
    for (const path of ['/login/', '/org/people/', '/hr/']) await page.request.get(path, { timeout: 60_000 });
  });

  test('an HR login the server marks for the organisation lands in /org and keeps the marks', async ({ page }) => {
    const mock = await setupB2B(page, null);
    mock.on('GET', /^\/auth\/options$/, () => ({ pinLogin: false }));
    mock.on('POST', /^\/auth\/login$/, () => ({ token: 'hr-token', user: MARKED_HR }));
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => MY_COMPANY);
    flagOn(mock);
    await page.goto('/login');
    await page.getByTestId('hr-method-btn').click();
    await page.getByTestId('hr-email-input').fill('hr@example.test');
    await page.getByTestId('hr-password-input').fill('secret-pass');
    await page.getByTestId('hr-submit').click();
    // The login page and the Shell both open /org/people for a company HR login (the first /org page may still be compiling in `next dev`).
    await expect(page).toHaveURL(/\/org\/people\/?$/, FIRST_VISIT);
    expect(mock.writes(/^\/auth\/login$/)[0].body).toEqual({ email: 'hr@example.test', password: 'secret-pass', requestedRole: 'corporate_hr' });
    expect(await storedUser(page)).toMatchObject({ userType: 'corporate_hr', organizationUser: true, organizationRoles: ['hr'], organizationIds: ['org-3'] });
    // The organisation navigation, not the HR one.
    await expect(page.getByRole('link', { name: 'People', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Employees', exact: true })).toHaveCount(0);
  });

  test('without the marks (flag off) an HR login still lands in /hr, unchanged', async ({ page }) => {
    const mock = await setupB2B(page, null);
    mock.on('GET', /^\/auth\/options$/, () => ({ pinLogin: false }));
    mock.on('POST', /^\/auth\/login$/, () => ({ token: 'hr-token', user: HR }));
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => MY_COMPANY);
    await page.goto('/login');
    await page.getByTestId('hr-method-btn').click();
    await page.getByTestId('hr-email-input').fill('hr@example.test');
    await page.getByTestId('hr-password-input').fill('secret-pass');
    await page.getByTestId('hr-submit').click();
    await expect(page).toHaveURL(/\/hr\/?$/, FIRST_VISIT);
    // The flag is asked once; off leaves the stored user alone and the person in /hr.
    await expect.poll(() => mock.reads(SESSION).length).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/hr\/?$/);
    const user = await storedUser(page);
    expect(user.organizationUser).toBeUndefined();
    expect(user.organizationIds).toBeUndefined();
    await expect(page.getByRole('link', { name: 'Employees', exact: true })).toBeVisible();
  });

  for (const [from, to] of [['/hr', '/org/challenges'], ['/hr/people', '/org/people'], ['/hr/rewards', '/org/rewards'], ['/hr/groups', '/org/groups'], ['/hr/programmes', '/org/programmes'], ['/hr/insights', '/org/insights']]) {
    test(`a marked HR session on ${from} is sent to ${to}`, async ({ page }) => {
      await companyOrg(page);
      await page.goto(from);
      await expect(page).toHaveURL(new RegExp(`${to}/?$`), FIRST_VISIT);
    });
  }

  test('a marked HR session can open /org/people (it is not sent back to /hr)', async ({ page }) => {
    await companyOrg(page);
    await page.goto('/org/people');
    await expect(page.getByTestId('org-staff-list')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/org\/people\/?$/);
  });

  test('an HR session stored before the flag moves to /org without signing out', async ({ page }) => {
    const mock = await companyOrg(page, HR);
    await page.goto('/hr/people');
    await expect(page).toHaveURL(/\/org\/people\/?$/);
    await expect(page.getByTestId('org-staff-list')).toBeVisible();
    const user = await storedUser(page);
    expect(user).toMatchObject({ id: 'hr-1', userType: 'corporate_hr', organizationUser: true, organizationRoles: ['hr'], organizationIds: ['org-3'] });
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('b2b-e2e-token');
    // No sign-in was needed and nothing was written.
    expect(mock.writes()).toEqual([]);
    expect(mock.reads(SESSION).length).toBeGreaterThan(0);
  });

  test('an older server without the session route (404) changes nothing', async ({ page }) => {
    const mock = await setupB2B(page, HR);
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => MY_COMPANY);
    mock.on('GET', SESSION, () => ({ status: 404, json: { error: 'not_found' } }));
    await page.goto('/hr/people');
    await expect(page.getByTestId('company-staff-list')).toBeVisible();
    await expect.poll(() => mock.reads(SESSION).length).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/hr\/people\/?$/);
    expect((await storedUser(page)).organizationUser).toBeUndefined();
    expect(mock.writes()).toEqual([]);
  });

  test('an HR session stored before the flag stays in /hr while the flag is off', async ({ page }) => {
    const mock = await setupB2B(page, HR);
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => MY_COMPANY);
    await page.goto('/hr/people');
    await expect(page.getByTestId('company-staff-list')).toBeVisible();
    // The default mock answers { orgOnlySponsors: false }.
    await expect.poll(() => mock.reads(SESSION).length).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/hr\/people\/?$/);
    expect((await storedUser(page)).organizationUser).toBeUndefined();
    // The older staff screen, on /corporate/staff, as before.
    expect(mock.reads(/^\/corporate\/staff$/).length).toBeGreaterThan(0);
    expect(mock.reads(/^\/b2b\/organizations\/org-3\/beneficiaries$/)).toEqual([]);
  });
});

test.describe('company people in /org (flag on)', () => {
  test('list: employees with contact, link state and status', async ({ page }) => {
    const mock = await companyOrg(page);
    await page.goto('/org/people');
    const list = page.getByTestId('org-staff-list');
    await expect(list).toContainText('Fatuma Hassan');
    await expect(list).toContainText('fatuma@mwenge.test');
    await expect(list).toContainText('+255712000000');
    await expect(page.getByTestId('org-staff-row-cemp_1')).toContainText('Linked');
    await expect(page.getByTestId('org-staff-row-cemp_3')).toContainText('Suspended');
    await expect(page.getByText('3 employees')).toBeVisible();
    // Nothing goes to the old /corporate/staff routes.
    expect(mock.calls.filter(c => c.path.startsWith('/corporate/staff'))).toEqual([]);
  });

  test('add a person: request body, PIN shown once with copy and warning', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const mock = await companyOrg(page);
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries$/, c => pendingReply({
      beneficiary: byContact({ ...EMPLOYEES[1], id: 'cemp_new', displayName: c.body?.displayName, status: 'active', employeeStatus: 'active' }),
      pin: '4821',
    }));
    await page.goto('/org/people');
    const form = page.getByTestId('org-staff-add');
    await expect(page.getByTestId('org-staff-add-button')).toBeDisabled();
    await form.getByTestId('org-staff-name').fill('Neema Said');
    await form.getByLabel('Email (optional)', { exact: true }).fill('neema@mwenge.test');
    await form.getByLabel('Department (optional)', { exact: true }).fill('Finance');
    await page.getByTestId('org-staff-add-button').click();
    await expect.poll(() => mock.writes(/\/org-3\/beneficiaries$/).length).toBe(1);
    expect(mock.writes(/\/org-3\/beneficiaries$/)[0].body).toEqual({ displayName: 'Neema Said', email: 'neema@mwenge.test', groupName: 'Finance', status: 'active' });

    const pin = page.getByRole('dialog', { name: 'Activation PIN for Neema Said' });
    await expect(pin).toBeVisible();
    await expect(pin).toContainText('This PIN is shown only once.');
    await expect(page.getByTestId('org-staff-pin-value')).toHaveValue('4821');
    await page.getByTestId('org-staff-pin-copy').click();
    await expect(page.getByTestId('org-staff-pin-copy')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('4821');
    // Named by email: added unlinked, the member is asked first (RC's consent wording, portal#141).
    await expect(page.getByText('Neema Said added. Request sent. The member must accept in the FitFlex app before they\'re linked.')).toBeVisible();
    await page.getByTestId('org-staff-pin-done').click();
    await expect(pin).toHaveCount(0);
    // Gone for good: the PIN is nowhere on the page any more.
    expect(await page.content()).not.toContain('4821');
  });

  test('the name is required; pending when "Active now" is unticked', async ({ page }) => {
    const mock = await companyOrg(page);
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries$/, c => pendingReply({ beneficiary: byContact({ ...EMPLOYEES[1], id: 'cemp_new', displayName: c.body?.displayName }), pin: '1111' }));
    await page.goto('/org/people');
    const form = page.getByTestId('org-staff-add');
    // A contact alone is not enough (functions#252 f4c0928: by contact, displayName is required).
    await form.getByLabel('Mobile number (optional)', { exact: true }).fill('0712345678');
    await expect(page.getByTestId('org-staff-add-button')).toBeDisabled();
    await expect(page.getByTestId('org-staff-name')).toHaveAttribute('required', '');
    await form.getByTestId('org-staff-name').fill('Asha Member');
    await page.getByTestId('org-staff-active').uncheck();
    await page.getByTestId('org-staff-add-button').click();
    await expect.poll(() => mock.writes(/\/org-3\/beneficiaries$/).length).toBe(1);
    expect(mock.writes(/\/org-3\/beneficiaries$/)[0].body).toEqual({ displayName: 'Asha Member', phone: '0712345678', status: 'pending' });
    await expect(page.getByText('Asha Member added. Request sent.', { exact: false })).toBeVisible();
  });

  test('name only: added (201) with the PIN, nobody asked', async ({ page }) => {
    const mock = await companyOrg(page);
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries$/, c => ({ beneficiary: byContact({ ...EMPLOYEES[1], id: 'cemp_new', displayName: c.body?.displayName }), pin: '2468', writtenThrough: 'corporate_staff' }));
    await page.goto('/org/people');
    await page.getByTestId('org-staff-name').fill('Baraka Mushi');
    await page.getByTestId('org-staff-add-button').click();
    await expect.poll(() => mock.writes(/\/org-3\/beneficiaries$/).length).toBe(1);
    expect(mock.writes(/\/org-3\/beneficiaries$/)[0].body).toEqual({ displayName: 'Baraka Mushi', status: 'active' });
    await expect(page.getByTestId('org-staff-pin-value')).toHaveValue('2468');
    await expect(page.getByText('Baraka Mushi was added. Link their FitFlex account below so they can use the benefits.')).toBeVisible();
  });

  test('a link waiting for the member: badge with expiry, withdraw sends an empty body', async ({ page }) => {
    const mock = await companyOrg(page);
    mock.on('GET', /^\/b2b\/organizations\/org-3\/beneficiaries$/, () => ({ items: [EMPLOYEES[0], { ...EMPLOYEES[1], pendingLink: { status: 'pending_member_acceptance', createdAt: '2026-10-29T08:00:00Z', expiresAt: '2026-11-12T08:00:00Z' } }], total: 2, nextCursor: null }));
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries\/cemp_2\/link$/, () => ({ beneficiary: { ...EMPLOYEES[1], pendingLink: null }, writtenThrough: 'corporate_staff' }));
    await page.goto('/org/people');
    const pending = page.getByTestId('org-staff-pending-cemp_2');
    await expect(pending).toContainText('Waiting for member');
    await expect(pending).toContainText('Request expires 12 Nov 2026');
    // Waiting: no second link box for that row.
    await expect(page.getByTestId('org-staff-link-cemp_2')).toHaveCount(0);
    await pending.getByRole('button', { name: 'Withdraw' }).click();
    await expect.poll(() => mock.writes(/cemp_2\/link$/).length).toBe(1);
    expect(mock.writes(/cemp_2\/link$/)[0].body).toEqual({});
    await expect(page.getByText('Request withdrawn.')).toBeVisible();
  });

  test('status changes: suspend, activate, left (confirmed) send active|suspended|inactive', async ({ page }) => {
    const mock = await companyOrg(page);
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries\/([^/]+)\/status$/, (c, m) => ({ beneficiary: { ...EMPLOYEES.find(e => e.id === m[1]), status: c.body?.status } }));
    await page.goto('/org/people');
    await page.getByTestId('org-staff-row-cemp_1').getByRole('button', { name: 'Suspend' }).click();
    await expect.poll(() => mock.writes(/cemp_1\/status$/).length).toBe(1);
    expect(mock.writes(/cemp_1\/status$/)[0].body).toEqual({ status: 'suspended' });
    await page.getByTestId('org-staff-row-cemp_2').getByRole('button', { name: 'Activate' }).click();
    await expect.poll(() => mock.writes(/cemp_2\/status$/).length).toBe(1);
    expect(mock.writes(/cemp_2\/status$/)[0].body).toEqual({ status: 'active' });
    await page.getByTestId('org-staff-row-cemp_3').getByRole('button', { name: 'Left' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Mark Rehema Ally as having left?' });
    await expect(confirm).toContainText('their seat goes back to your company’s pool');
    await confirm.getByRole('button', { name: 'Mark as left' }).click();
    await expect.poll(() => mock.writes(/cemp_3\/status$/).length).toBe(1);
    expect(mock.writes(/cemp_3\/status$/)[0].body).toEqual({ status: 'inactive' });
  });

  test('link by number and unlink with an empty body', async ({ page }) => {
    const mock = await companyOrg(page);
    // Linking asks the member (202); an empty body unlinks (200).
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries\/([^/]+)\/link$/, (c, m) => (Object.keys(c.body ?? {}).length
      ? pendingReply({ beneficiary: { ...EMPLOYEES.find(e => e.id === m[1]), linked: false } })
      : { beneficiary: { ...EMPLOYEES.find(e => e.id === m[1]), linked: false, userId: null }, writtenThrough: 'corporate_staff' }));
    await page.goto('/org/people');
    await page.getByTestId('org-staff-link-cemp_2').fill('0712345678');
    await page.getByTestId('org-staff-row-cemp_2').getByRole('button', { name: 'Link', exact: true }).click();
    await expect.poll(() => mock.writes(/cemp_2\/link$/).length).toBe(1);
    expect(mock.writes(/cemp_2\/link$/)[0].body).toEqual({ phone: '0712345678' });
    await expect(page.getByText('Request sent. Juma Kileo is linked once the member accepts in the FitFlex app.')).toBeVisible();
    await page.getByTestId('org-staff-row-cemp_1').getByRole('button', { name: 'Unlink' }).click();
    await expect.poll(() => mock.writes(/cemp_1\/link$/).length).toBe(1);
    expect(mock.writes(/cemp_1\/link$/)[0].body).toEqual({});
  });

  test('import: preview with free seats, then credentials shown once and downloadable', async ({ page }) => {
    const mock = await companyOrg(page);
    const base = { total: 3, unchanged: 1, rejected: 1, invited: 0, withoutEmail: 1, withoutPhone: 2, emailConfigured: true, smsConfigured: true, emailCodesAvailable: true, companyStaff: true, seatsAvailable: 5,
      problems: [{ line: 3, name: null, contact: 'nobody@x.test', problem: 'name_required' }] };
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries\/import$/, c => (c.body?.dryRun
      ? { dryRun: true, ...base, enrolled: 2 }
      : { importId: 'b2bim_1', ...base, enrolled: 2, credentials: [{ line: 1, employeeId: 'cemp_9', displayName: 'Asha, Mollel', pin: '1234' }, { line: 2, employeeId: 'cemp_10', displayName: 'Juma', pin: '5678' }] }));
    await page.goto('/org/people');
    await page.getByTestId('org-staff-import-open').click();
    await page.getByTestId('org-staff-import-text').fill('name,email,phone,group\nAsha Mollel,asha@x.test,,Finance\nJuma,,0712000111,\n,nobody@x.test,,');
    await page.getByTestId('org-staff-import-check').click();
    const preview = page.getByTestId('org-staff-import-preview');
    await expect(preview).toContainText('Will be added');
    await expect(preview).toContainText('Free seats: 5');
    await expect(page.getByTestId('org-staff-import-problems')).toContainText('No name given');
    expect(mock.writes(/\/import$/)[0].body).toMatchObject({ dryRun: true });
    await page.getByTestId('org-staff-import-confirm').click();
    await expect.poll(() => mock.writes(/\/import$/).length).toBe(2);
    expect(mock.writes(/\/import$/)[1].body).toMatchObject({ dryRun: false });
    const creds = page.getByTestId('org-staff-credentials');
    await expect(creds).toContainText('These PINs are shown only once.');
    await expect(creds).toContainText('1234');
    await expect(page.getByText('Done. 2 added, 1 already on your list, 1 could not be used.')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('org-staff-credentials-download').click()]);
    expect(download.suggestedFilename()).toBe('activation-pins.csv');
    const csv = await download.createReadStream().then(async (s) => { const parts: Buffer[] = []; for await (const p of s) parts.push(p as Buffer); return Buffer.concat(parts).toString('utf8'); });
    // One PIN for every row added (linked or not).
    expect(csv.replace(/^\uFEFF/, '')).toBe('line,employee id,name,pin\n1,cemp_9,"Asha, Mollel",1234\n2,cemp_10,Juma,5678\n');
    await page.getByTestId('org-staff-credentials-done').click();
    await expect(creds).toHaveCount(0);
    expect(await page.content()).not.toContain('cemp_9');
  });

  test('import: seats are all-or-nothing (409 seat_limit_reached)', async ({ page }) => {
    const mock = await companyOrg(page);
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries\/import$/, () => ({ status: 409, json: { error: 'seat_limit_reached', seatsAvailable: 1, requested: 3, seatLimit: 10 } }));
    await page.goto('/org/people');
    await page.getByTestId('org-staff-import-open').click();
    await page.getByTestId('org-staff-import-text').fill('a,a@x.test\nb,b@x.test\nc,c@x.test');
    await page.getByTestId('org-staff-import-check').click();
    await expect(page.getByText('This list needs 3 seats but only 1 are free. Nobody was added.')).toBeVisible();
  });

  const ADD_ERRORS: Array<[string, string]> = [
    ['already_enrolled', 'They are already on your staff list.'],
    ['seat_limit_reached', 'All of your company’s seats are in use.'],
    ['organization_not_active', 'Your company account isn’t active'],
    ['beneficiary_must_be_member', 'That account isn’t a member account.'],
    ['display_name_required', 'Enter the employee’s name.'],
    ['user_not_found', 'No FitFlex account has confirmed that email or number.'],
  ];
  test('add-person errors are explained', async ({ page }) => {
    const mock = await companyOrg(page);
    let answer = 'already_enrolled';
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries$/, () => ({ status: answer === 'user_not_found' ? 404 : answer.endsWith('_required') || answer.startsWith('beneficiary_') ? 400 : 409, json: { error: answer } }));
    await page.goto('/org/people');
    const form = page.getByTestId('org-staff-add');
    for (const [code, text] of ADD_ERRORS) {
      answer = code;
      await form.getByTestId('org-staff-name').fill('Some One');
      await form.getByLabel('Email (optional)', { exact: true }).fill('someone@x.test');
      await page.getByTestId('org-staff-add-button').click();
      await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
    }
  });

  test('member-consent refusals are explained (member_request_pending, cooldown, rate_limited)', async ({ page }) => {
    const mock = await companyOrg(page);
    let reply: Json = { status: 409, json: { error: 'member_request_pending' } };
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries\/cemp_2\/link$/, () => reply);
    await page.goto('/org/people');
    const tryLink = async (label = 'Link') => {
      await page.getByTestId('org-staff-link-cemp_2').fill('juma@x.test');
      await page.getByTestId('org-staff-row-cemp_2').getByRole('button', { name: label, exact: true }).click();
    };
    await tryLink();
    await expect(page.getByRole('alert').filter({ hasText: 'A request to this member is already waiting.' })).toBeVisible();
    reply = { status: 429, json: { error: 'member_request_cooldown', retryAfter: '2026-11-05T08:00:00Z' } };
    await tryLink();
    await expect(page.getByRole('alert').filter({ hasText: 'This member was asked recently. You can ask again after 5 Nov 2026.' })).toBeVisible();
    reply = { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 60 } };
    await tryLink();
    await expect(page.getByRole('alert').filter({ hasText: 'Too many requests. Try again in a few minutes.' })).toBeVisible();
    // Swahili.
    await page.addInitScript(() => localStorage.setItem('locale', 'sw'));
    await page.reload();
    reply = { status: 409, json: { error: 'member_request_pending' } };
    await tryLink('Unganisha');
    await expect(page.getByRole('alert').filter({ hasText: 'Ombi kwa mwanachama huyu tayari linasubiri.' })).toBeVisible();
  });

  test('status and link errors are explained (invalid_transition, link_not_supported)', async ({ page }) => {
    const mock = await companyOrg(page);
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries\/cemp_1\/status$/, () => ({ status: 409, json: { error: 'invalid_transition', from: 'active', to: 'suspended', allowed: [] } }));
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries\/cemp_2\/link$/, () => ({ status: 409, json: { error: 'link_not_supported' } }));
    await page.goto('/org/people');
    await page.getByTestId('org-staff-row-cemp_1').getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'That change isn’t possible from their current status.' })).toBeVisible();
    await page.getByTestId('org-staff-link-cemp_2').fill('juma@x.test');
    await page.getByTestId('org-staff-row-cemp_2').getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Only your company’s employees can be linked here.' })).toBeVisible();
  });

  test('a role without beneficiaries.manage sees the list only', async ({ page }) => {
    await companyOrg(page, { ...MARKED_HR, organizationRoles: ['analyst'] }, ['organization.read', 'beneficiaries.read'], 'analyst');
    await page.goto('/org/people');
    await expect(page.getByTestId('org-staff-list')).toContainText('Fatuma Hassan');
    await expect(page.getByText('Your role can see the staff list but not change it.')).toBeVisible();
    await expect(page.getByTestId('org-staff-add')).toHaveCount(0);
    await expect(page.getByTestId('org-staff-import-open')).toHaveCount(0);
    await expect(page.getByTestId('org-staff-list').getByRole('button')).toHaveCount(0);
  });

  // Owner and manager hold beneficiaries.manage but are not company-staff roles (companyStaffManage false).
  for (const role of ['owner', 'manager']) {
    test(`${role}: read-only list (no add, import, status, link, contact details)`, async ({ page }) => {
      const mock = await companyOrg(page, { ...MARKED_HR, userType: 'member', organizationRoles: [role] }, HR_ACCESS, role);
      await page.goto('/org/people');
      const list = page.getByTestId('org-staff-list');
      await expect(list).toContainText('Fatuma Hassan');
      await expect(list).not.toContainText('fatuma@mwenge.test');
      await expect(page.getByText('Your organisation’s HR and admin users manage company staff.')).toBeVisible();
      await expect(page.getByTestId('org-staff-add')).toHaveCount(0);
      await expect(page.getByTestId('org-staff-import-open')).toHaveCount(0);
      await expect(page.getByTestId('org-staff-link-cemp_2')).toHaveCount(0);
      await expect(list.getByRole('button')).toHaveCount(0);
      expect(mock.writes()).toEqual([]);
    });
  }

  test('admin: sees the controls', async ({ page }) => {
    await companyOrg(page, { ...MARKED_HR, userType: 'member', organizationRoles: ['admin'] }, HR_ACCESS, 'admin');
    await page.goto('/org/people');
    await expect(page.getByTestId('org-staff-add')).toBeVisible();
    await expect(page.getByTestId('org-staff-import-open')).toBeVisible();
    await expect(page.getByTestId('org-staff-row-cemp_1').getByRole('button', { name: 'Suspend' })).toBeVisible();
    await expect(page.getByTestId('org-staff-link-cemp_2')).toBeVisible();
    await expect(page.getByTestId('org-staff-list')).toContainText('fatuma@mwenge.test');
  });

  test('403 forbidden with requiredRoles reads as "not allowed" (EN and SW)', async ({ page }) => {
    const mock = await companyOrg(page);
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries$/, () => ({ status: 403, json: { error: 'forbidden', requiredRoles: ['hr', 'admin'] } }));
    await page.goto('/org/people');
    await page.getByTestId('org-staff-name').fill('Neema Said');
    await page.getByTestId('org-staff-add-button').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Only your organisation’s HR and admin users can manage company staff.' })).toBeVisible();
    await expect(page.getByTestId('org-staff-pin')).toHaveCount(0);
    // Runs after the mock's own init script (which sets English), so the reload opens in Swahili.
    await page.addInitScript(() => localStorage.setItem('locale', 'sw'));
    await page.reload();
    await page.getByTestId('org-staff-name').fill('Neema Said');
    await page.getByTestId('org-staff-add-button').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Watumiaji wa HR na admin wa shirika lako pekee ndio wanaweza kusimamia wafanyakazi wa kampuni.' })).toBeVisible();
  });

  test('Swahili: form, PIN dialog and an error', async ({ page }) => {
    const mock = await companyOrg(page);
    await page.addInitScript(() => localStorage.setItem('locale', 'sw'));
    let fail = false;
    mock.on('POST', /^\/b2b\/organizations\/org-3\/beneficiaries$/, c => (fail
      ? { status: 409, json: { error: 'seat_limit_reached', seatLimit: 3 } }
      : { beneficiary: byContact({ ...EMPLOYEES[1], id: 'cemp_new', displayName: c.body?.displayName }), pin: '9090', writtenThrough: 'corporate_staff' }));
    await page.goto('/org/people');
    await expect(page.getByText('Wafanyakazi 3')).toBeVisible();
    await expect(page.getByTestId('org-staff-row-cemp_3')).toContainText('Amesimamishwa');
    const form = page.getByTestId('org-staff-add');
    await form.getByTestId('org-staff-name').fill('Neema Said');
    await page.getByRole('button', { name: 'Ongeza mfanyakazi' }).click();
    const pin = page.getByRole('dialog', { name: 'PIN ya kuanzisha ya Neema Said' });
    await expect(pin).toContainText('PIN hii inaonyeshwa mara moja tu.');
    await pin.getByRole('button', { name: 'Nimeihifadhi' }).click();
    fail = true;
    await form.getByTestId('org-staff-name').fill('Juma');
    await page.getByRole('button', { name: 'Ongeza mfanyakazi' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Viti vyote vya kampuni yako vinatumika.' })).toBeVisible();
  });

  test('challenges, rewards and groups use the organisation routes (no /corporate calls)', async ({ page }) => {
    const mock = await companyOrg(page);
    for (const [path, route] of [['/org/challenges', 'challenges'], ['/org/rewards', 'rewards'], ['/org/groups', 'groups']]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}/?$`));
      // Each page asks its own organisation route before the next one opens (it may still be compiling).
      await expect.poll(() => mock.calls.filter(c => c.path.startsWith(`/b2b/organizations/org-3/${route}`)).length, { timeout: 15_000 }).toBeGreaterThan(0);
    }
    expect(mock.calls.filter(c => c.path.startsWith('/corporate/')).map(c => c.path)).toEqual([]);
  });
});

test('admin: adding another company’s HR login to an organisation is explained (hr_login_other_company)', async ({ page }) => {
  const mock = await setupB2B(page);
  mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/users$/, () => ({ status: 409, json: { error: 'hr_login_other_company' } }));
  await page.goto('/admin/b2b');
  await page.getByTestId('b2b-org-org-1').click();
  const userForm = page.getByTestId('b2b-user-form');
  await userForm.getByPlaceholder('Their email, mobile number or user ID').fill('hr@other.test');
  await userForm.getByRole('button', { name: 'Add user' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'That is an HR login of another company.' })).toBeVisible();
});
