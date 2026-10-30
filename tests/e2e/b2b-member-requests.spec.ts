// Adds by user ID wait for the member to accept in the app (fitflex-functions#241): the add answers
// 202 { outcome: 'pending_member_acceptance', memberRequest }, lists carry pendingMemberAcceptance[]
// (HR staff: pendingLink), and the organisation can withdraw a request it made.
// Privacy (security review): no name until the member accepts (displayName null), and an unknown id or a
// non-member gets the same 202 with id null; the screens must look the same either way.
import { expect, test } from '@playwright/test';
import { ADMIN, HR, Json, orgUser, setupB2B } from './helpers/b2b-mock';

const BENEFICIARIES_PATH = /^\/b2b\/organizations\/([^/]+)\/beneficiaries$/;
const request = (extra: Json = {}): Json => ({
  id: 'mr-1', kind: 'beneficiary', status: 'pending_member_acceptance', organizationId: 'org-1', corporateId: null, employeeId: null,
  userId: 'usr_zuhura', displayName: null, role: null, permissions: null, beneficiaryType: 'employee', groupName: 'Head office',
  externalReference: null, beneficiaryStatus: 'active', expiresAt: '2026-11-05T09:00:00.000Z', createdAt: '2026-10-22T09:00:00.000Z',
  decidedAt: null, reason: null, ...extra,
});
const ASHA = { id: 'ben-1', organizationId: 'org-1', userId: 'usr-10', displayName: 'Asha Juma', externalReference: 'POL-1', beneficiaryType: 'policyholder', groupName: 'Head office', status: 'active', enrolledAt: '2026-09-01', source: 'b2b', readOnly: false };
const SENT = 'Request sent. They\'ll be added once they accept in the FitFlex app.';
const stub = (extra: Json = {}) => ({ outcome: 'pending_member_acceptance', memberRequest: request({ id: null, ...extra }) });
const list = (pending?: Json[]) => ({ items: [ASHA], total: 1, nextCursor: null, ...(pending ? { pendingMemberAcceptance: pending } : {}) });

test.describe('organisation user', () => {
  test('adding by user ID says the request was sent and shows a waiting row, not an active person', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    let sent = false;
    mock.on('GET', BENEFICIARIES_PATH, () => list(sent ? [request()] : []));
    mock.on('POST', BENEFICIARIES_PATH, () => { sent = true; return { status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: request() } }; });
    await page.goto('/org/people');
    await expect(page.getByTestId('org-people-list')).toContainText('Asha Juma');
    await page.getByTestId('org-people-contact').fill('usr_zuhura');
    await page.getByTestId('org-people-add-button').click();

    await expect(page.getByText(SENT)).toBeVisible();
    await expect(page.getByText(/can now use your programmes/)).toHaveCount(0);
    expect(mock.writes(/\/org-1\/beneficiaries$/).at(-1)?.body).toMatchObject({ userId: 'usr_zuhura' });
    const row = page.getByTestId('org-people-request-mr-1');
    await expect(row).toContainText('User ID usr_zuhura');
    await expect(row).toContainText('Waiting for member');
    await expect(row).toContainText('Request expires 5 Nov 2026');
    await expect(row).not.toContainText('active');
    // The person count still counts only people on the list.
    await expect(page.getByTestId('org-people')).toContainText('1 person');
  });

  test('withdraw asks first, then calls DELETE and the row goes', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    let open = true;
    mock.on('GET', BENEFICIARIES_PATH, () => list(open ? [request()] : []));
    mock.on('DELETE', /^\/b2b\/organizations\/([^/]+)\/member-requests\/([^/]+)$/, () => { open = false; return { memberRequest: request({ status: 'cancelled' }) }; });
    await page.goto('/org/people');
    await expect(page.getByTestId('org-people-request-mr-1')).toBeVisible();

    // Dismissing the confirm does nothing.
    page.once('dialog', d => { expect(d.message()).toBe('Withdraw the request to User ID usr_zuhura? They won\'t be added.'); void d.dismiss(); });
    await page.getByTestId('member-request-withdraw-mr-1').click();
    expect(mock.writes(/member-requests/)).toHaveLength(0);

    page.once('dialog', d => void d.accept());
    await page.getByTestId('member-request-withdraw-mr-1').click();
    await expect(page.getByText('Request withdrawn.')).toBeVisible();
    expect(mock.writes(/member-requests/).map(c => `${c.method} ${c.path}`)).toEqual(['DELETE /b2b/organizations/org-1/member-requests/mr-1']);
    await expect(page.getByTestId('org-people-request-mr-1')).toHaveCount(0);
  });

  test('a repeat add explains the request is already waiting (409 member_request_pending)', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    mock.on('POST', BENEFICIARIES_PATH, () => ({ status: 409, json: { error: 'member_request_pending', memberRequestId: 'mr-1', expiresAt: '2026-11-05T09:00:00.000Z' } }));
    await page.goto('/org/people');
    await page.getByTestId('org-people-contact').fill('usr_zuhura');
    await page.getByTestId('org-people-add-button').click();
    await expect(page.getByText('A request to this member is already waiting.')).toBeVisible();
  });

  test('an older backend (no pending list, 201 add) still works as before', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    mock.on('GET', BENEFICIARIES_PATH, () => list());
    await page.goto('/org/people');
    await expect(page.getByTestId('org-people-list')).toContainText('Asha Juma');
    await expect(page.getByText('Waiting for member')).toHaveCount(0);
    await page.getByTestId('org-people-contact').fill('usr_new');
    await page.getByTestId('org-people-add-button').click();
    await expect(page.getByText('New Person can now use your programmes.')).toBeVisible();
  });

  test('an id with nothing stored (id: null) gets the same message, no row and no withdraw', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    mock.on('GET', BENEFICIARIES_PATH, () => list([]));
    mock.on('POST', BENEFICIARIES_PATH, () => ({ status: 202, json: stub({ userId: 'usr_nobody' }) }));
    await page.goto('/org/people');
    await page.getByTestId('org-people-contact').fill('usr_nobody');
    await page.getByTestId('org-people-add-button').click();
    await expect(page.getByText(SENT)).toBeVisible();
    await expect(page.getByText('Waiting for member')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
    await expect(page.getByText('usr_nobody')).toHaveCount(0);
    // A stub that sneaks into a list is not shown either.
    mock.on('GET', BENEFICIARIES_PATH, () => list([request({ id: null })]));
    await page.reload();
    await expect(page.getByTestId('org-people-list')).toContainText('Asha Juma');
    await expect(page.getByText('Waiting for member')).toHaveCount(0);
  });

  const TOO_MANY: Array<[string, Json, string]> = [
    ['member_request_cooldown', { error: 'member_request_cooldown', retryAfter: '2026-11-05T09:00:00.000Z', retryAfterSeconds: 1209600 },
      'This member was asked recently. You can ask again after 5 Nov 2026.'],
    ['member_request_limit', { error: 'member_request_limit', maxPending: 50 },
      'Too many requests are waiting for members. Wait for some to be answered or withdraw old ones.'],
    ['rate_limited', { error: 'rate_limited', retryAfterSeconds: 600 }, 'Too many requests. Try again in a few minutes.'],
  ];
  for (const [code, json, text] of TOO_MANY) {
    test(`429 ${code} is explained`, async ({ page }) => {
      const mock = await setupB2B(page, orgUser(['admin']));
      mock.on('POST', BENEFICIARIES_PATH, () => ({ status: 429, json }));
      await page.goto('/org/people');
      await page.getByTestId('org-people-contact').fill('usr_zuhura');
      await page.getByTestId('org-people-add-button').click();
      await expect(page.getByText(text)).toBeVisible();
    });
  }

  test('Swahili: the 429 texts', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    await page.addInitScript(() => { localStorage.setItem('locale', 'sw'); });
    let answer: Json = TOO_MANY[0][1];
    mock.on('POST', BENEFICIARIES_PATH, () => ({ status: 429, json: answer }));
    await page.goto('/org/people');
    const add = async () => { await page.getByTestId('org-people-contact').fill('usr_zuhura'); await page.getByTestId('org-people-add-button').click(); };
    await add();
    await expect(page.getByText(/^Mwanachama huyu aliulizwa hivi karibuni\. Unaweza kuuliza tena baada ya .+\.$/)).toBeVisible();
    answer = TOO_MANY[1][1]; await add();
    await expect(page.getByText('Maombi mengi yanasubiri wanachama. Subiri baadhi yajibiwe au futa ya zamani.')).toBeVisible();
    answer = TOO_MANY[2][1]; await add();
    await expect(page.getByText('Maombi mengi mno. Jaribu tena baada ya dakika chache.')).toBeVisible();
  });

  test('Swahili: badge, expiry and request-sent message', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    await page.addInitScript(() => { localStorage.setItem('locale', 'sw'); });
    let sent = false;
    mock.on('GET', BENEFICIARIES_PATH, () => list(sent ? [request()] : []));
    mock.on('POST', BENEFICIARIES_PATH, () => { sent = true; return { status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: request() } }; });
    await page.goto('/org/people');
    await page.getByTestId('org-people-contact').fill('usr_zuhura');
    await page.getByTestId('org-people-add-button').click();
    await expect(page.getByText('Ombi limetumwa. Ataongezwa atakapokubali kwenye programu ya FitFlex.')).toBeVisible();
    const row = page.getByTestId('org-people-request-mr-1');
    await expect(row).toContainText('Kitambulisho usr_zuhura');
    await expect(row).toContainText('Inasubiri mwanachama');
    await expect(row).toContainText('Ombi linaisha');
    await expect(page.getByTestId('member-request-withdraw-mr-1')).toHaveText('Futa ombi');
  });
});

test.describe('company HR', () => {
  const STAFF = [
    { id: 'emp-1', displayName: 'Fatuma Hassan', email: 'fatuma@mwenge.test', phone: null, department: 'Sales', userId: 'usr-20', status: 'active', pendingLink: null },
    { id: 'emp-2', displayName: 'Juma Kileo', email: null, phone: null, department: null, userId: null, status: 'pending' },
  ];
  const linkRequest = request({ id: 'mr-9', kind: 'employee_link', organizationId: null, corporateId: 'corp-1', employeeId: 'emp-2', userId: 'usr_juma', beneficiaryType: null, groupName: null });

  test('linking by user ID sends a request; the staff list shows it waiting and HR can withdraw it', async ({ page }) => {
    const mock = await setupB2B(page, HR);
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: 'org-3', legalName: 'Mwenge Textiles', tradingName: null, role: 'hr', status: 'active' }] }));
    let pending = false;
    mock.on('GET', /^\/corporate\/staff$/, () => ({ employees: STAFF.map(e => (e.id === 'emp-2' ? { ...e, pendingLink: pending ? linkRequest : null } : e)) }));
    mock.on('POST', /^\/corporate\/staff\/([^/]+)\/link$/, c => {
      if (c.body?.userId === null) { pending = false; return { employee: { ...STAFF[1], userId: null } }; }
      pending = true;
      return { status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: linkRequest } };
    });
    await page.goto('/hr/people');
    await page.getByTestId('company-staff-link-emp-2').fill('usr_juma');
    await page.getByTestId('company-staff-list').getByRole('button', { name: 'Link', exact: true }).click();

    await expect(page.getByText(SENT)).toBeVisible();
    expect(mock.writes(/\/corporate\/staff\/emp-2\/link$/).at(-1)?.body).toEqual({ userId: 'usr_juma' });
    const cell = page.getByTestId('company-staff-request-emp-2');
    await expect(cell).toContainText('User ID usr_juma');
    await expect(cell).toContainText('Waiting for member');
    await expect(cell).toContainText('Request expires 5 Nov 2026');
    await expect(page.getByTestId('company-staff-link-emp-2')).toHaveCount(0);

    page.once('dialog', d => void d.accept());
    await page.getByTestId('member-request-withdraw-mr-9').click();
    await expect(page.getByText('Request withdrawn.')).toBeVisible();
    expect(mock.writes(/\/corporate\/staff\/emp-2\/link$/).at(-1)?.body).toEqual({ userId: null });
    await expect(page.getByTestId('company-staff-request-emp-2')).toHaveCount(0);
    await expect(page.getByTestId('company-staff-link-emp-2')).toBeVisible();
  });

  test('a link by an id with nothing stored (id: null) looks the same and leaves the link box', async ({ page }) => {
    const mock = await setupB2B(page, HR);
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: 'org-3', legalName: 'Mwenge Textiles', tradingName: null, role: 'hr', status: 'active' }] }));
    mock.on('GET', /^\/corporate\/staff$/, () => ({ employees: STAFF.map(e => ({ ...e, pendingLink: null })) }));
    mock.on('POST', /^\/corporate\/staff\/([^/]+)\/link$/, () => ({ status: 202, json: stub({ kind: 'employee_link', employeeId: 'emp-2', userId: 'usr_nobody' }) }));
    await page.goto('/hr/people');
    await page.getByTestId('company-staff-link-emp-2').fill('usr_nobody');
    await page.getByTestId('company-staff-list').getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByText(SENT)).toBeVisible();
    await expect(page.getByTestId('company-staff-request-emp-2')).toHaveCount(0);
    await expect(page.getByTestId('company-staff-link-emp-2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  });

  test('HR: 429 cooldown is explained', async ({ page }) => {
    const mock = await setupB2B(page, HR);
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: 'org-3', legalName: 'Mwenge Textiles', tradingName: null, role: 'hr', status: 'active' }] }));
    mock.on('POST', /^\/corporate\/staff\/([^/]+)\/link$/, () => ({ status: 429, json: { error: 'member_request_cooldown', retryAfter: '2026-11-05T09:00:00.000Z', retryAfterSeconds: 1209600 } }));
    await page.goto('/hr/people');
    await page.getByTestId('company-staff-link-emp-2').fill('usr_juma');
    await page.getByTestId('company-staff-list').getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByText('This member was asked recently. You can ask again after 5 Nov 2026.')).toBeVisible();
  });

  test('a repeat link by user ID explains the request is already waiting', async ({ page }) => {
    const mock = await setupB2B(page, HR);
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: 'org-3', legalName: 'Mwenge Textiles', tradingName: null, role: 'hr', status: 'active' }] }));
    mock.on('POST', /^\/corporate\/staff\/([^/]+)\/link$/, () => ({ status: 409, json: { error: 'member_request_pending', memberRequestId: 'mr-9' } }));
    await page.goto('/hr/people');
    await page.getByTestId('company-staff-link-emp-2').fill('usr_juma');
    await page.getByTestId('company-staff-list').getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByText('A request to this member is already waiting.')).toBeVisible();
  });
});

test.describe('admin B2B', () => {
  test('requests made by the organisation show in its users and beneficiaries, and can be withdrawn', async ({ page }) => {
    const mock = await setupB2B(page, ADMIN);
    const userRequest = request({ id: 'mr-2', kind: 'org_user', userId: 'usr_grace', role: 'finance', beneficiaryType: null, groupName: null, beneficiaryStatus: null });
    mock.on('GET', /^\/b2b\/organizations\/([^/]+)\/users$/, () => ({ items: [], total: 0, nextCursor: null, pendingMemberAcceptance: [userRequest] }));
    mock.on('GET', BENEFICIARIES_PATH, () => list([request()]));
    mock.on('DELETE', /^\/b2b\/organizations\/([^/]+)\/member-requests\/([^/]+)$/, (_c, m) => ({ memberRequest: { ...(m[2] === 'mr-2' ? userRequest : request()), status: 'cancelled' } }));
    await page.goto('/admin/b2b');
    await page.getByTestId('b2b-org-org-1').click();

    const userRow = page.getByTestId('b2b-user-request-mr-2');
    await expect(userRow).toContainText('User ID usr_grace');
    await expect(userRow).toContainText('Role: finance');
    await expect(userRow).toContainText('Waiting for member');
    await expect(page.getByTestId('b2b-ben-request-mr-1')).toContainText('Waiting for member');

    page.once('dialog', d => void d.accept());
    await page.getByTestId('member-request-withdraw-mr-2').click();
    await expect(page.getByText('Request withdrawn.')).toBeVisible();
    await expect(page.getByTestId('b2b-user-request-mr-2')).toHaveCount(0);
    expect(mock.writes(/member-requests/).map(c => `${c.method} ${c.path}`)).toEqual(['DELETE /b2b/organizations/org-1/member-requests/mr-2']);
  });
});

// Consent slice (a) (fitflex-functions#283): adds by email or mobile number wait for the member too. The 202 is the
// same whoever is behind the contact (memberRequest.id set, userId and displayName null); lists show the contact the
// organisation typed, and the old not-found / not-a-member answers no longer come back.
const byContact = (contactType: 'email' | 'phone', contact: string, extra: Json = {}) =>
  request({ id: 'mr-c1', source: 'contact', contactType, contact, userId: null, ...extra });
const NO_ACCOUNT_HINT = /not found|no FitFlex account|Nobody has confirmed|isn’t a member|already on your list/i;

test.describe('adds by email or number (functions#283)', () => {
  test('organisation user: add by email says "request sent", lists the email and withdraws with DELETE', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    let open = false;
    mock.on('GET', BENEFICIARIES_PATH, () => list(open ? [byContact('email', 'zuhura@example.co.tz')] : []));
    mock.on('POST', BENEFICIARIES_PATH, () => { open = true; return { status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: byContact('email', 'zuhura@example.co.tz') } }; });
    mock.on('DELETE', /^\/b2b\/organizations\/([^/]+)\/member-requests\/([^/]+)$/, () => { open = false; return { memberRequest: byContact('email', 'zuhura@example.co.tz', { status: 'cancelled' }) }; });
    await page.goto('/org/people');
    await expect(page.getByTestId('org-people-add')).toContainText('Only someone who has confirmed this email or number in FitFlex can be asked');
    await page.getByTestId('org-people-contact').fill('zuhura@example.co.tz');
    await page.getByTestId('org-people-add-button').click();

    await expect(page.getByText(SENT)).toBeVisible();
    expect(mock.writes(/\/org-1\/beneficiaries$/).at(-1)?.body).toMatchObject({ email: 'zuhura@example.co.tz' });
    await expect(page.getByText(NO_ACCOUNT_HINT)).toHaveCount(0);
    const row = page.getByTestId('org-people-request-mr-c1');
    await expect(row).toContainText('Email zuhura@example.co.tz');
    await expect(row).toContainText('Waiting for member');

    page.once('dialog', d => { expect(d.message()).toBe('Withdraw the request to Email zuhura@example.co.tz? They won\'t be added.'); void d.accept(); });
    await page.getByTestId('member-request-withdraw-mr-c1').click();
    await expect(page.getByText('Request withdrawn.')).toBeVisible();
    expect(mock.writes(/member-requests/).map(c => `${c.method} ${c.path}`)).toEqual(['DELETE /b2b/organizations/org-1/member-requests/mr-c1']);
    await expect(page.getByTestId('org-people-request-mr-c1')).toHaveCount(0);
  });

  test('organisation user: a number shows as "Number …"; Swahili text and label', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    await page.addInitScript(() => { localStorage.setItem('locale', 'sw'); });
    let open = false;
    mock.on('GET', BENEFICIARIES_PATH, () => list(open ? [byContact('phone', '+255712345678')] : []));
    mock.on('POST', BENEFICIARIES_PATH, () => { open = true; return { status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: byContact('phone', '+255712345678') } }; });
    await page.goto('/org/people');
    await page.getByTestId('org-people-contact').fill('0712345678');
    await page.getByTestId('org-people-add-button').click();
    await expect(page.getByText('Ombi limetumwa. Ataongezwa atakapokubali kwenye programu ya FitFlex.')).toBeVisible();
    await expect(page.getByTestId('org-people-request-mr-c1')).toContainText('Namba +255712345678');
  });

  test('company HR (/hr): link by number answers 202; pendingLink with userId null shows the number; Withdraw unlinks', async ({ page }) => {
    const mock = await setupB2B(page, HR);
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: 'org-3', legalName: 'Mwenge Textiles', tradingName: null, role: 'hr', status: 'active' }] }));
    const linkRequest = byContact('phone', '+255712345678', { id: 'mr-c9', kind: 'employee_link', organizationId: null, corporateId: 'corp-1', employeeId: 'emp-2', beneficiaryType: null, groupName: null });
    let pending = false;
    mock.on('GET', /^\/corporate\/staff$/, () => ({ employees: [
      { id: 'emp-1', displayName: 'Fatuma Hassan', email: 'fatuma@mwenge.test', phone: null, department: 'Sales', userId: 'usr-20', status: 'active', pendingLink: null },
      { id: 'emp-2', displayName: 'Juma Kileo', email: null, phone: null, department: null, userId: null, status: 'pending', pendingLink: pending ? linkRequest : null },
    ] }));
    mock.on('POST', /^\/corporate\/staff\/([^/]+)\/link$/, c => {
      if (c.body?.userId === null) { pending = false; return { employee: { id: 'emp-2', userId: null } }; }
      pending = true;
      return { status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: linkRequest } };
    });
    await page.goto('/hr/people');
    await page.getByTestId('company-staff-link-emp-2').fill('0712345678');
    await page.getByTestId('company-staff-list').getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByText(SENT)).toBeVisible();
    expect(mock.writes(/\/corporate\/staff\/emp-2\/link$/).at(-1)?.body).toEqual({ phone: '0712345678' });
    await expect(page.getByText(NO_ACCOUNT_HINT)).toHaveCount(0);
    const cell = page.getByTestId('company-staff-request-emp-2');
    await expect(cell).toContainText('Number +255712345678');
    await expect(cell).toContainText('Waiting for member');

    page.once('dialog', d => void d.accept());
    await page.getByTestId('member-request-withdraw-mr-c9').click();
    await expect(page.getByText('Request withdrawn.')).toBeVisible();
    expect(mock.writes(/\/corporate\/staff\/emp-2\/link$/).at(-1)?.body).toEqual({ userId: null });
    expect(mock.calls.filter(c => c.method === 'DELETE')).toEqual([]);
    await expect(page.getByTestId('company-staff-link-emp-2')).toBeVisible();
  });

  test('company HR (/hr): adding an employee with an email sends the request; a refusal says nothing about the person', async ({ page }) => {
    const mock = await setupB2B(page, HR);
    mock.on('GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: 'org-3', legalName: 'Mwenge Textiles', tradingName: null, role: 'hr', status: 'active' }] }));
    let reply: Json = { status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: byContact('email', 'rehema@mwenge.test', { kind: 'employee_link', employeeId: 'emp-new' }) } };
    mock.on('POST', /^\/corporate\/staff\/([^/]+)\/link$/, () => reply);
    await page.goto('/hr/people');
    await expect(page.getByTestId('company-staff-add')).toContainText('they are asked to accept the link in the app');
    const add = async (name: string) => {
      await page.getByTestId('company-staff-name').fill(name);
      await page.getByTestId('company-staff-contact').fill('rehema@mwenge.test');
      await page.getByTestId('company-staff-add-button').click();
    };
    await add('Rehema Ally');
    await expect(page.getByText('Rehema Ally added. Request sent. They\'ll be linked once they accept in the FitFlex app.')).toBeVisible();
    reply = { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 600 } };
    await add('Baraka Mushi');
    await expect(page.getByText('Baraka Mushi added, but no link request was sent: Too many requests. Try again in a few minutes.')).toBeVisible();
  });

  test('admin B2B: an org-user or beneficiary add that comes back 202 by email lists the email, not a name', async ({ page }) => {
    const mock = await setupB2B(page, ADMIN);
    const userReq = byContact('email', 'grace@safari.test', { id: 'mr-u1', kind: 'org_user', role: 'finance', beneficiaryType: null, groupName: null, beneficiaryStatus: null });
    let asked = false;
    mock.on('GET', /^\/b2b\/organizations\/([^/]+)\/users$/, () => ({ items: [], total: 0, nextCursor: null, pendingMemberAcceptance: asked ? [userReq] : [] }));
    mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/users$/, () => { asked = true; return { status: 202, json: { outcome: 'pending_member_acceptance', memberRequest: userReq } }; });
    await page.goto('/admin/b2b');
    await page.getByTestId('b2b-org-org-1').click();
    await page.getByTestId('b2b-user-id').fill('grace@safari.test');
    await page.getByTestId('b2b-user-add').click();
    await expect(page.getByText(SENT)).toBeVisible();
    const row = page.getByTestId('b2b-user-request-mr-u1');
    await expect(row).toContainText('Email grace@safari.test');
    await expect(row).toContainText('Role: finance');
    await expect(page.getByTestId('member-request-withdraw-mr-u1')).toBeVisible();
  });
});

// functions#283 after its security review: the per-organisation hourly cap, a repeat withdraw, and "Send again".
test.describe('consent slice (a) security-review follow-ups', () => {
  for (const [locale, text] of [
    ['en', 'Your organisation has sent a lot of requests in the last hour. Try again in 25 min.'],
    ['sw', 'Shirika lako limetuma maombi mengi ndani ya saa moja iliyopita. Jaribu tena baada ya dakika 25.'],
  ] as const) {
    test(`429 rate_limited with scope organization is the organisation cap (${locale})`, async ({ page }) => {
      const mock = await setupB2B(page, orgUser(['admin']));
      if (locale === 'sw') await page.addInitScript(() => { localStorage.setItem('locale', 'sw'); });
      mock.on('POST', BENEFICIARIES_PATH, () => ({ status: 429, json: { error: 'rate_limited', scope: 'organization', retryAfterSeconds: 1500 } }));
      await page.goto('/org/people');
      await page.getByTestId('org-people-contact').fill('zuhura@example.co.tz');
      await page.getByTestId('org-people-add-button').click();
      await expect(page.getByText(text)).toBeVisible();
    });
  }

  for (const requestStatus of ['cancelled', 'expired']) {
    test(`a withdraw answered 409 member_request_not_pending (${requestStatus}) counts as withdrawn`, async ({ page }) => {
      const mock = await setupB2B(page, orgUser(['admin']));
      let open = true;
      mock.on('GET', BENEFICIARIES_PATH, () => list(open ? [byContact('email', 'zuhura@example.co.tz')] : []));
      mock.on('DELETE', /^\/b2b\/organizations\/([^/]+)\/member-requests\/([^/]+)$/, () => { open = false; return { status: 409, json: { error: 'member_request_not_pending', requestStatus } }; });
      await page.goto('/org/people');
      page.once('dialog', d => void d.accept());
      await page.getByTestId('member-request-withdraw-mr-c1').click();
      await expect(page.getByText('Request withdrawn.')).toBeVisible();
      await expect(page.getByText('That request has already been answered or has expired.')).toHaveCount(0);
      await expect(page.getByTestId('org-people-request-mr-c1')).toHaveCount(0);
    });
  }

  test('admin B2B: a repeat withdraw (409 cancelled) also clears the row', async ({ page }) => {
    const mock = await setupB2B(page, ADMIN);
    mock.on('GET', BENEFICIARIES_PATH, () => list([byContact('phone', '+255712345678')]));
    mock.on('DELETE', /^\/b2b\/organizations\/([^/]+)\/member-requests\/([^/]+)$/, () => ({ status: 409, json: { error: 'member_request_not_pending', requestStatus: 'cancelled' } }));
    await page.goto('/admin/b2b');
    await page.getByTestId('b2b-org-org-1').click();
    await expect(page.getByTestId('b2b-ben-request-mr-c1')).toContainText('Number +255712345678');
    page.once('dialog', d => void d.accept());
    await page.getByTestId('member-request-withdraw-mr-c1').click();
    await expect(page.getByText('Request withdrawn.')).toBeVisible();
    await expect(page.getByTestId('b2b-ben-request-mr-c1')).toHaveCount(0);
  });

  test('"Send again" says it only resends the invitation', async ({ page }) => {
    const mock = await setupB2B(page, orgUser(['admin']));
    const invite = { id: 'inv-1', displayName: 'Asha Mollel', email: 'asha@x.test', phone: null, groupName: null, beneficiaryType: 'member', status: 'invited', invitedAt: '2026-10-29T08:00:00Z',
      emailsSent: 1, lastEmailAt: '2026-10-29T08:00:00Z', nextEmailAt: '2026-11-01T08:00:00Z', emailFailures: 0, smsSent: 0, lastSmsAt: null, nextSmsAt: null, smsFailures: 0, canResend: true };
    mock.on('GET', /^\/b2b\/organizations\/([^/]+)\/beneficiary-invites$/, () => ({ items: [invite], invited: 1, emailConfigured: true, smsConfigured: true }));
    mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/beneficiary-invites\/([^/]+)\/resend$/, () => ({ invite, sent: { email: true, sms: false }, emailConfigured: true, smsConfigured: true }));
    await page.goto('/org/people');
    await expect(page.getByText('An invite stays here until the person accepts in the FitFlex app')).toBeVisible();
    const again = page.getByRole('button', { name: 'Send again' });
    await expect(again).toHaveAttribute('title', 'Sends the invitation email or SMS again. It doesn\'t ask anyone in the app again.');
    await again.click();
    await expect(page.getByText('Invitation sent again by email.')).toBeVisible();
  });
});
