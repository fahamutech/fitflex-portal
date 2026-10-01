import { expect, test, type Page, type Route } from '@playwright/test';

// Identity V2 · I6 (slice D): with invitations on (/me/invitations answers),
// the owner page invites people by one phone or email and never sends a PIN.
// With the flag off (404) the page keeps its legacy forms.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

async function signedIn(page: Page, userType = 'gym_operator') {
  await page.addInitScript(type => {
    localStorage.setItem('locale', 'en');
    localStorage.setItem('token', 'owner-token');
    localStorage.setItem('user', JSON.stringify({ id: 'usr_owner', userType: type }));
  }, userType);
}

/** The owner page's own data; returns false when the route was not handled. */
function ownerData(route: Route, path: string, method: string) {
  if (path === '/owner/gyms') return route.fulfill({ json: [{ id: 'gym-1', name: 'Mikocheni Fitness', location: 'Mikocheni', status: 'active' }] });
  if (path === '/owner/members' && method === 'GET') return route.fulfill({ json: { members: [], stats: {} } });
  if (path === '/owner/staff' && method === 'GET') return route.fulfill({ json: [] });
  if (path === '/owner/trainers/pending' || path === '/owner/trainers') return route.fulfill({ json: [] });
  if (path === '/me/personas') return route.fulfill({ status: 404, json: { error: 'not_found' } });
  return false;
}

const invitation = (id: string, extra: Record<string, unknown> = {}) => ({
  id, role: 'member', status: 'pending', identifierType: 'phone', identifierValue: '+255712345678',
  expiresAt: '2026-10-15T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z', ...extra,
});

test('owner invites a member, staff and a trainer without setting a PIN', async ({ page }) => {
  const created: any[] = [];
  const lookups: any[] = [];
  const legacy: string[] = [];
  await signedIn(page);
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (pathname === '/me/invitations') return route.fulfill({ json: { invitations: [] } });
    if (pathname === '/orgs/gym/gym-1/people/lookup') { lookups.push(request.postDataJSON()); return route.fulfill({ json: { found: true, maskedName: 'A**** S***' } }); }
    if (pathname === '/orgs/gym/gym-1/invitations' && method === 'POST') {
      created.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { created: true, token: `tok ${created.length}`, invitation: invitation(`inv_${created.length}`) } });
    }
    if (pathname === '/orgs/gym/gym-1/invitations') return route.fulfill({ json: { invitations: [] } });
    if (method === 'POST' && (pathname === '/owner/members' || pathname === '/owner/staff')) { legacy.push(pathname); return route.fulfill({ status: 400, json: { error: 'use_invitation' } }); }
    return ownerData(route, pathname, method) || route.fulfill({ json: {} });
  });

  await page.goto('/owner/manage');
  const memberForm = page.getByTestId('invite-form-member');
  await expect(memberForm).toBeVisible();
  await expect(page.getByLabel('Owner member PIN')).toHaveCount(0);
  await expect(page.getByLabel('Staff PIN')).toHaveCount(0);

  await memberForm.getByLabel('Member: Phone number or email').fill('0712345678');
  await memberForm.getByRole('button', { name: 'Check if they use FitFlex' }).click();
  await expect(memberForm.getByText('A**** S*** uses FitFlex.')).toBeVisible();
  expect(lookups).toEqual([{ phone: '0712345678' }]);
  expect(created).toHaveLength(0);

  await memberForm.getByLabel('Member: Plan').selectOption('W');
  await memberForm.getByLabel('Member: Paid at the desk (TZS)').fill('15000');
  await memberForm.getByRole('button', { name: 'Send invitation' }).click();
  await expect(memberForm.getByText('Invitation sent.')).toBeVisible();
  await expect(memberForm.getByLabel('Invitation link')).toHaveValue(/\/invitations\?token=tok%201$/);
  expect(created[0]).toMatchObject({ role: 'member', phone: '0712345678', durationUnit: 'W', paidAmount: 15000 });
  expect(created[0].email).toBeUndefined();
  expect(+new Date(created[0].endDate) - +new Date(created[0].startDate)).toBe(7 * 86400e3);

  const staffForm = page.getByTestId('invite-form-staff');
  await staffForm.getByLabel('Staff: Phone number or email').fill('desk@example.com');
  await staffForm.getByRole('button', { name: 'Send invitation' }).click();
  await expect(staffForm.getByText('Invitation sent.')).toBeVisible();
  expect(created[1]).toEqual({ role: 'staff', email: 'desk@example.com', aclPermissions: ['members', 'checkins', 'trainers', 'gyms'] });

  const trainerForm = page.getByTestId('invite-form-trainer');
  await trainerForm.getByLabel('Trainer: Phone number or email').fill('coach@example.com');
  await trainerForm.getByRole('button', { name: 'Send invitation' }).click();
  await expect(trainerForm.getByText('Invitation sent.')).toBeVisible();
  expect(created[2]).toEqual({ role: 'trainer', email: 'coach@example.com' });

  await page.getByLabel('Bulk invitations CSV').fill('0711000000,D\nbulk@example.com,M,50000');
  await page.getByRole('button', { name: 'Invite many' }).click();
  await expect(page.getByText('2 invitations sent.')).toBeVisible();
  expect(created.slice(3)).toMatchObject([{ role: 'member', phone: '0711000000', durationUnit: 'D' }, { role: 'member', email: 'bulk@example.com', durationUnit: 'M', paidAmount: 50000 }]);
  expect(created[3].paidAmount).toBeUndefined();

  const body = JSON.stringify(created);
  expect(body).not.toMatch(/initialPassword|"pin"|displayName/i);
  expect(legacy).toEqual([]);
});

test('invitations sent: new link, cancel, and a paid one that lapsed', async ({ page }) => {
  const actions: string[] = [];
  await signedIn(page);
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (pathname === '/me/invitations') return route.fulfill({ json: { invitations: [] } });
    const action = pathname.match(/^\/orgs\/gym\/gym-1\/invitations\/(inv_[a-z]+)\/(cancel|resend|reissue|refunded)$/);
    if (action && method === 'POST') {
      actions.push(`${action[1]}:${action[2]}`);
      if (action[2] === 'resend' && action[1] === 'inv_done') return route.fulfill({ status: 429, json: { error: 'resend_too_soon' } });
      return route.fulfill({ json: { invitation: invitation(action[1]), ...(['resend', 'reissue'].includes(action[2]) ? { token: 'fresh' } : {}) } });
    }
    if (pathname === '/orgs/gym/gym-1/invitations') return route.fulfill({ json: { invitations: [
      invitation('inv_open'),
      invitation('inv_lapsed', { status: 'expired', identifierValue: 'paid@example.com', paidAmountTzs: 50000, needsResolution: true }),
      invitation('inv_done', { status: 'accepted', identifierValue: 'joined@example.com', role: 'staff' }),
    ] } });
    return ownerData(route, pathname, method) || route.fulfill({ json: {} });
  });

  await page.goto('/owner/manage');
  const sent = page.getByTestId('invitations-sent');
  await expect(sent.getByText('+255712345678 · Member')).toBeVisible();
  await expect(sent.getByText('Paid TZS 50,000 but never accepted. Send it again or record a refund.')).toBeVisible();
  const done = page.getByTestId('invitation-inv_done');
  await expect(done.getByText('Accepted')).toBeVisible();
  await expect(done.getByRole('button')).toHaveCount(0);

  await page.getByTestId('invitation-inv_open').getByRole('button', { name: 'New link' }).click();
  await expect(sent.getByLabel('Invitation link')).toHaveValue(/\/invitations\?token=fresh$/);
  await page.getByTestId('invitation-inv_lapsed').getByRole('button', { name: 'Refunded' }).click();
  await expect.poll(() => actions).toEqual(['inv_open:resend', 'inv_lapsed:refunded']);
  await page.getByTestId('invitation-inv_open').getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => actions.at(-1)).toBe('inv_open:cancel');
});

test('staff with the members scope invite members only', async ({ page }) => {
  await signedIn(page, 'gym_staff');
  await page.route(`${API}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/me/invitations') return route.fulfill({ json: { invitations: [] } });
    if (pathname === '/orgs/gym/gym-1/invitations') return route.fulfill({ json: { invitations: [] } });
    return ownerData(route, pathname, route.request().method()) || route.fulfill({ json: {} });
  });
  await page.goto('/owner/manage');
  await expect(page.getByTestId('invite-form-member')).toBeVisible();
  await expect(page.getByTestId('invite-form-staff')).toHaveCount(0);
  await expect(page.getByTestId('invite-form-trainer')).toHaveCount(0);
  await expect(page.getByLabel('Staff PIN')).toHaveCount(0);
});

test('with invitations off (404) the legacy forms stay', async ({ page }) => {
  let asked = 0;
  await signedIn(page);
  await page.route(`${API}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/me/invitations') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (pathname.startsWith('/orgs/')) { asked += 1; return route.fulfill({ status: 404, json: { error: 'not_found' } }); }
    return ownerData(route, pathname, route.request().method()) || route.fulfill({ json: {} });
  });
  await page.goto('/owner/manage');
  await expect(page.getByLabel('Owner member PIN')).toBeVisible();
  await expect(page.getByLabel('Staff PIN')).toBeVisible();
  await expect(page.getByLabel('Bulk members CSV')).toBeVisible();
  await expect(page.getByTestId('invite-form-member')).toHaveCount(0);
  await expect(page.getByTestId('invitations-sent')).toHaveCount(0);
  expect(asked).toBe(0);
});
