import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Json = Record<string, unknown>;
type Call = { path: string; body: Json | null };

const hours = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();

const rows = [
  { id: 'rec-wait', status: 'open', tier: 'member', claimedName: 'Neema Joseph', accountName: 'Neema J.', newIdentifierType: 'phone', createdAt: hours(-2), waitUntil: hours(22), ready: false, answered: false },
  { id: 'rec-ready', status: 'open', tier: 'member', claimedName: 'Asha Mushi', accountName: 'Asha Mushi', newIdentifierType: 'email', createdAt: hours(-30), waitUntil: hours(-6), ready: true, answered: true },
];

const detail = (id: string, over: Json = {}) => ({
  recovery: {
    id, status: 'open', tier: 'member', claimedName: id === 'rec-ready' ? 'Asha Mushi' : 'Neema Joseph',
    oldIdentifier: { type: 'phone', masked: '+255•••••678' }, newIdentifier: { type: 'email', value: 'asha.new@example.com' },
    evidence: id === 'rec-ready' ? { homeGym: 'Fit Zone Mikocheni', plan: 'Standard', paymentRef: 'PAY-77' } : {},
    createdAt: hours(-30), waitUntil: id === 'rec-ready' ? hours(-6) : hours(22), ready: id === 'rec-ready',
    cancelledBy: null, decisionReason: null, decisionNote: null, decidedBy: null, decidedAt: null, requestIp: '41.59.0.1', ...over,
  },
  account: {
    registeredAt: '2026-05-01T08:00:00.000Z',
    personas: [{ id: 'u-1', userType: 'member', displayName: 'Asha Mushi', approvalStatus: 'approved' }],
    subscription: { type: 'monthly', tier: 'Standard', status: 'active', startedAt: '2026-09-20T00:00:00.000Z', expiresAt: '2026-10-20T00:00:00.000Z', homeGym: 'Fit Zone Mikocheni', paymentRef: 'PAY-77' },
    lastCheckins: [{ at: '2026-10-03T06:30:00.000Z', gym: 'Fit Zone Mikocheni' }],
    payments: [{ reference: 'PAY-77', amountTzs: 60000, status: 'approved', at: '2026-09-20T07:00:00.000Z' }],
    identifiers: [{ type: 'phone', masked: '+255•••••678', status: 'active', verified: true }],
  },
  events: [{ kind: 'requested', actor: null, detail: {}, createdAt: hours(-30) }, { kind: 'viewed', actor: 'admin-1', detail: null, createdAt: hours(-1) }],
});

/** A signed-in admin and a small fake recovery API whose calls the test can read. */
async function setup(page: Page, user: Json, opts: { decide?: (body: Json) => { status: number; json: Json }; off?: boolean } = {}) {
  const calls: Call[] = [];
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (!path.startsWith('/admin/account-recoveries')) return route.fulfill({ json: [] });
    if (opts.off) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Json;
      calls.push({ path, body });
      if (path.endsWith('/decision')) return route.fulfill(opts.decide?.(body) ?? { json: { status: body.decision === 'approve' ? 'completed' : 'refused' } });
      return route.fulfill({ json: { added: true } });
    }
    if (path === '/admin/account-recoveries') return route.fulfill({ json: { recoveries: url.searchParams.get('status') === 'refused' ? [] : rows } });
    return route.fulfill({ json: detail(decodeURIComponent(path.split('/').pop() || '')) });
  });
  return calls;
}

const admin = { id: 'admin-1', userType: 'admin', email: 'admin@example.com' };

test('queue shows the wait, and an approval needs the wait over and an answer, then a plain confirmation', async ({ page }) => {
  const calls = await setup(page, admin);
  await page.goto('/admin/account-recovery');
  await expect(page.getByRole('heading', { name: 'Account recovery' })).toBeVisible();
  await expect(page.getByTestId('rec-row-rec-wait')).toContainText('Neema Joseph');
  await expect(page.getByTestId('rec-row-rec-wait')).toContainText('Can be decided after');
  await expect(page.getByTestId('rec-row-rec-ready')).toContainText('Ready');
  await expect(page.getByTestId('rec-row-rec-ready')).toContainText('Answered');

  // Still waiting: approve is off, with the reason.
  await page.getByTestId('rec-row-rec-wait').click();
  await expect(page).toHaveURL(/id=rec-wait/);
  await expect(page.getByTestId('rec-approve')).toBeDisabled();
  await expect(page.getByTestId('rec-blocked')).toContainText('Approval is possible after');
  await expect(page.getByText('never see, set or ask for a PIN')).toBeVisible();
  await expect(page.getByText('recorded in the trail')).toBeVisible();

  // Ready with answers: the answers sit next to the account's facts.
  await page.goto('/admin/account-recovery?id=rec-ready');
  await expect(page.getByTestId('rec-q-homeGym')).toContainText('Fit Zone Mikocheni');
  await expect(page.getByTestId('rec-q-paymentRef')).toContainText('PAY-77');
  await expect(page.getByTestId('rec-q-lastCheckin')).toContainText('Fit Zone Mikocheni');
  await expect(page.getByTestId('rec-trail')).toContainText('Request opened');
  await expect(page.getByTestId('rec-approve')).toBeEnabled();

  await page.getByTestId('rec-approve').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('asha.new@example.com');
  await expect(dialog).toContainText('removes the old PIN');
  await expect(dialog).toContainText('signs the person out everywhere');
  await expect(dialog).toContainText('Forgot PIN');
  await dialog.getByRole('button', { name: 'Approve and move account' }).click();
  await expect(page.getByText('Recovery approved')).toBeVisible();
  expect(calls.at(-1)).toEqual({ path: '/admin/account-recoveries/rec-ready/decision', body: { decision: 'approve' } });
});

test('refusing needs a reason, sends a private note, and notes can be added', async ({ page }) => {
  const calls = await setup(page, admin);
  await page.goto('/admin/account-recovery?id=rec-wait');

  await page.getByTestId('rec-note').fill('Gym front desk does not know this person.');
  await page.getByTestId('rec-note-add').click();
  await expect(page.getByText('Note added.')).toBeVisible();
  expect(calls.at(-1)).toEqual({ path: '/admin/account-recoveries/rec-wait/note', body: { note: 'Gym front desk does not know this person.' } });

  // Refuse is open even while waiting, but only with a reason.
  await page.getByTestId('rec-refuse').click();
  await expect(page.getByText('told only the general reason')).toBeVisible();
  await expect(page.getByTestId('rec-refuse-confirm')).toBeDisabled();
  await page.getByTestId('rec-reason').selectOption('details_do_not_match');
  await page.getByTestId('rec-refuse-note').fill('Payment ref is not theirs.');
  await page.getByTestId('rec-refuse-confirm').click();
  await expect(page.getByText('Request refused.')).toBeVisible();
  expect(calls.at(-1)).toEqual({
    path: '/admin/account-recoveries/rec-wait/decision',
    body: { decision: 'refuse', reason: 'details_do_not_match', note: 'Payment ref is not theirs.' },
  });
});

test('server refusals are shown as friendly messages, in Swahili too', async ({ page }) => {
  await setup(page, admin, { decide: () => ({ status: 409, json: { error: 'identifier_in_use' } }) });
  await page.goto('/admin/account-recovery?id=rec-ready');
  await page.getByTestId('rec-approve').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve and move account' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'now belongs to another account' })).toBeVisible();

  await page.evaluate(() => localStorage.setItem('locale', 'sw'));
  await page.goto('/admin/account-recovery?id=rec-ready');
  await expect(page.getByRole('button', { name: 'Idhinisha', exact: true })).toBeVisible();
  await page.getByTestId('rec-approve').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Idhinisha na uhamishe akaunti' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'inatumiwa na akaunti nyingine' })).toBeVisible();
});

test('waiting-period refusal from the server names the time', async ({ page }) => {
  await setup(page, admin, { decide: () => ({ status: 409, json: { error: 'waiting_period_not_over', canDecideAt: '2026-10-07T09:00:00.000Z' } }) });
  await page.goto('/admin/account-recovery?id=rec-ready');
  await page.getByTestId('rec-approve').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve and move account' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'waiting period is not over yet' })).toContainText('2026');
});

test('a calm empty state while the backend flag is off', async ({ page }) => {
  await setup(page, admin, { off: true });
  await page.goto('/admin/account-recovery');
  await expect(page.getByTestId('rec-off')).toContainText('Account recovery is not switched on yet');
});

test('the nav item follows the account_recovery scope', async ({ page }) => {
  await setup(page, { id: 'staff-1', userType: 'admin', portalUser: true, aclPermissions: ['account_recovery'], email: 'staff@example.com' });
  await page.goto('/admin/account-recovery');
  await expect(page.getByRole('link', { name: 'Account recovery' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gyms' })).toHaveCount(0);
});

test('a staff account without the scope does not see account recovery', async ({ page }) => {
  await setup(page, { id: 'staff-2', userType: 'admin', portalUser: true, aclPermissions: ['payments'], email: 'staff2@example.com' });
  await page.goto('/admin/payments');
  await expect(page.getByRole('link', { name: 'Payments' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Account recovery' })).toHaveCount(0);
});
