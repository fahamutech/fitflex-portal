import { expect, test, Page } from '@playwright/test';

// The transaction ID a member typed on an older payment request (slice A3, functions#188) is still shown to staff.
// Members no longer pay by hand (AzamPay is the only payment method, 2026-11-17): the Lipa Namba settings card is gone.
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

const BASE_SETTINGS = {
  id: 'platform',
  subscriptionTiers: [],
  payoutBands: [],
  paymentPeriodDays: 14,
  payoutModel: 'commission',
  currency: 'TZS',
  updatedAt: '2026-10-19T08:00:00.000Z',
};

async function signInAsAdmin(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript((l) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
    localStorage.setItem('locale', l);
  }, locale);
}

test('settings: there is no manual payment card any more (AzamPay is the only payment method)', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', error => runtimeErrors.push(error));
  await signInAsAdmin(page);

  const asked: string[] = [];
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    asked.push(url.pathname);
    // An older settings row may still carry the saved number: it is not shown.
    if (url.pathname === '/admin/settings') return route.fulfill({ json: { ...BASE_SETTINGS, manualPayment: { lipaNamba: '5123456', accountName: 'FitFlex Africa' } } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/settings');
  await expect(page.getByTestId('settings-reason')).toBeVisible();
  await expect(page.getByTestId('manual-payment-settings')).toHaveCount(0);
  await expect(page.getByText('5123456')).toHaveCount(0);
  expect(asked).not.toContain('/payments/options');
  expect(runtimeErrors).toEqual([]);
});

test("payments: the member's transaction ID is shown and prefilled when approving", async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', error => runtimeErrors.push(error));
  await signInAsAdmin(page);

  const posts: { id: string; body: unknown }[] = [];
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/admin/payment-requests') {
      return route.fulfill({
        json: [
          {
            id: 'pay-manual', memberId: 'member-1', subscriptionId: 'sub-1', tier: 'pro', amountTzs: 60000,
            status: 'pending', provider: 'admin_approved', reference: null, memberReference: 'QGH7XK2L9P', payerPhone: '+255754000111', note: null,
            requestedAt: '2026-10-19T08:00:00.000Z', decidedAt: null,
            member: { displayName: 'Manual Payer', phone: '+255712345678' }, subscription: { type: 'platform_pass', tier: 'pro', status: 'payment_pending' },
          },
          {
            id: 'pay-plain', memberId: 'member-2', subscriptionId: 'sub-2', tier: 'basic', amountTzs: 30000,
            status: 'pending', provider: 'admin_approved', reference: null, memberReference: null, note: null,
            requestedAt: '2026-10-19T07:00:00.000Z', decidedAt: null,
            member: { displayName: 'Plain Payer' }, subscription: { type: 'platform_pass', tier: 'basic', status: 'payment_pending' },
          },
        ],
      });
    }
    const m = /^\/admin\/payment-requests\/([^/]+)$/.exec(url.pathname);
    if (m && req.method() === 'POST') {
      posts.push({ id: m[1], body: req.postDataJSON() });
      return route.fulfill({ json: { id: m[1], status: 'approved' } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/payments');
  // One Transaction ID column: the member's ID shows there until a reference is recorded.
  await expect(page.getByRole('columnheader', { name: 'Transaction ID' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: "Member's transaction ID" })).toHaveCount(0);
  await expect(page.getByTestId('member-reference')).toHaveText('QGH7XK2L9P');
  await expect(page.getByTestId('payer-phone')).toHaveText('Paid from: +255754000111');

  // The row with a member ID opens the transaction-ID dialog.
  await page.getByRole('row', { name: /Manual Payer/ }).getByTitle('Approve').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('member-reference-highlight')).toContainText('QGH7XK2L9P');
  await expect(dialog.getByTestId('payer-phone-highlight')).toContainText('+255754000111');
  await expect(dialog.getByTestId('registered-phone')).toHaveText('+255712345678');
  await expect(dialog.getByTestId('payer-phone-differs')).toContainText('That is allowed');
  const ref = dialog.getByTestId('approve-reference');
  await expect(ref).toHaveValue('QGH7XK2L9P');
  await expect(dialog.getByTestId('approve-reference-differs')).toHaveCount(0);
  await ref.fill('OTHER123');
  await expect(dialog.getByTestId('approve-reference-differs')).toBeVisible();
  await ref.fill('qgh7xk2l9p');
  await expect(dialog.getByTestId('approve-reference-differs')).toHaveCount(0);
  await ref.fill('QGH7XK2L9P');
  await dialog.getByTestId('approve-with-reference').click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toEqual([{ id: 'pay-manual', body: { status: 'approved', reference: 'QGH7XK2L9P' } }]);

  // A row without a member ID keeps the plain confirmation, and sends no reference.
  await page.getByRole('row', { name: /Plain Payer/ }).getByTitle('Approve').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toEqual({ id: 'pay-plain', body: { status: 'approved' } });
  expect(runtimeErrors).toEqual([]);
});

test('payments: same paying number shows no warning, and a reused transaction ID (409) is explained', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', error => runtimeErrors.push(error));
  await signInAsAdmin(page);

  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/admin/payment-requests') {
      return route.fulfill({
        json: [{
          id: 'pay-dup', memberId: 'member-1', subscriptionId: 'sub-1', tier: 'pro', amountTzs: 60000,
          status: 'pending', provider: 'admin_approved', reference: null, memberReference: 'QGH7XK2L9P', payerPhone: '+255754000111', note: null,
          requestedAt: '2026-10-19T08:00:00.000Z', decidedAt: null,
          member: { displayName: 'Same Number', phone: '0754 000 111' }, subscription: { type: 'platform_pass', tier: 'pro', status: 'payment_pending' },
        }],
      });
    }
    if (url.pathname === '/admin/payment-requests/pay-dup' && req.method() === 'POST') {
      return route.fulfill({ status: 409, json: { error: 'reference_already_used' } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/payments');
  await page.getByRole('row', { name: /Same Number/ }).getByTitle('Approve').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('registered-phone')).toHaveText('0754 000 111');
  await expect(dialog.getByTestId('payer-phone-differs')).toHaveCount(0);
  await dialog.getByTestId('approve-with-reference').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('This transaction ID is already recorded on another pending or approved payment')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('payments, two admins on (A1 + A3): a verified row is approved with the verified reference, which stays locked', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', error => runtimeErrors.push(error));
  await signInAsAdmin(page);
  const posts: { id: string; body: unknown }[] = [];

  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/admin/payment-requests') {
      return route.fulfill({
        json: [{
          id: 'pay-verified', memberId: 'member-1', subscriptionId: 'sub-1', tier: 'pro', amountTzs: 60000,
          status: 'pending', provider: 'admin_approved', reference: 'QGH7XK2L9P', memberReference: 'QGH7XK2L9P', payerPhone: '+255754000111', note: null,
          requestedAt: '2026-10-19T08:00:00.000Z', decidedAt: null,
          secondApproverRequired: true, approvalStage: 'awaiting_approval', verifiedBy: 'admin-2', verifiedAt: '2026-10-19T08:30:00.000Z',
          approveNotBy: 'admin-2', confirmChangeNotBy: null,
          member: { displayName: 'Verified Payer', phone: '0754 000 111' }, subscription: { type: 'platform_pass', tier: 'pro', status: 'payment_pending' },
        }],
      });
    }
    if (url.pathname === '/admin/payment-requests/pay-verified' && req.method() === 'POST') {
      posts.push({ id: 'pay-verified', body: req.postDataJSON() });
      return route.fulfill({ json: { id: 'pay-verified', status: 'approved' } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/payments');
  await page.getByRole('row', { name: /Verified Payer/ }).getByTitle('Approve').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('member-reference-highlight')).toContainText('QGH7XK2L9P');
  const ref = dialog.getByTestId('approve-reference');
  await expect(ref).toHaveValue('QGH7XK2L9P');
  await expect(ref).toBeDisabled();
  await expect(dialog.getByText('The transaction ID is locked once a payment is verified or decided.')).toBeVisible();
  await dialog.getByTestId('approve-with-reference').click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toEqual([{ id: 'pay-verified', body: { status: 'approved', reference: 'QGH7XK2L9P' } }]);
  expect(runtimeErrors).toEqual([]);
});
