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
const SENT = 'Request sent. The member must accept in the FitFlex app before they\'re added.';
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
    await expect(page.getByText('Ombi limetumwa. Mwanachama lazima akubali kwenye programu ya FitFlex kabla ya kuongezwa.')).toBeVisible();
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
