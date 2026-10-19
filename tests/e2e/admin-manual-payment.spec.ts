import { expect, test, Page } from '@playwright/test';

// Slice A3 (functions#188): manual Lipa Namba settings + the member's transaction ID on payments.
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

const MANUAL_OFF = { enabled: false, lipaNamba: null, accountName: null, network: null, instructions: null, referenceRequired: false };

async function signInAsAdmin(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript((l) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
    localStorage.setItem('locale', l);
  }, locale);
}

test('settings: manual payment saves, and a manual_payment_invalid field shows against that field', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', error => runtimeErrors.push(error));
  await signInAsAdmin(page);

  let manualPayment: unknown = null;
  let enabled = false;
  const puts: unknown[] = [];

  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/admin/settings' && req.method() === 'PUT') {
      const body = req.postDataJSON();
      puts.push(body);
      if (body.manualPayment?.lipaNamba === '12') {
        return route.fulfill({ status: 400, json: { error: 'manual_payment_invalid', field: 'lipaNamba' } });
      }
      manualPayment = { ...body.manualPayment, lipaNamba: String(body.manualPayment.lipaNamba).replace(/[\s-]/g, '') };
      enabled = true;
      return route.fulfill({ json: { ...BASE_SETTINGS, manualPayment } });
    }
    if (url.pathname === '/admin/settings') return route.fulfill({ json: { ...BASE_SETTINGS, manualPayment } });
    if (url.pathname === '/payments/options') {
      return route.fulfill({ json: { available: false, manual: enabled ? { ...MANUAL_OFF, enabled: true, referenceRequired: true } : MANUAL_OFF } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/settings');
  const card = page.getByTestId('manual-payment-settings');
  await expect(card.getByText('Manual payment (Lipa Namba)')).toBeVisible();
  await expect(page.getByTestId('manual-pay-live')).toContainText('MANUAL_PAY_INSTRUCTIONS is on, but a Lipa Namba and account name must be saved here first');

  const lipa = card.getByLabel('Lipa Namba');
  await lipa.fill('12');
  await card.getByLabel('Account name').fill('FitFlex Africa Ltd');
  await card.getByLabel('Network', { exact: true }).selectOption('M-Pesa');
  await card.getByLabel('Extra instructions in English (optional)').fill('Pay the exact amount.');
  await card.getByLabel('Extra instructions in Swahili (optional)').fill('Lipa kiasi kamili.');
  await card.getByRole('button', { name: 'Save payment details' }).click();

  await expect(card.getByText('Enter 4 to 20 digits.')).toBeVisible();
  await expect(lipa).toHaveAttribute('aria-invalid', 'true');
  await expect(card.getByText('Payment details saved.')).toHaveCount(0);

  await lipa.fill('512 3456');
  await expect(card.getByText('Enter 4 to 20 digits.')).toHaveCount(0);
  await card.getByRole('button', { name: 'Save payment details' }).click();
  await expect(card.getByText('Payment details saved.')).toBeVisible();
  await expect(lipa).toHaveValue('5123456');
  await expect(page.getByTestId('manual-pay-live')).toContainText('Live for members');

  expect(puts).toHaveLength(2);
  // Saved on its own: only manualPayment is sent, never the tiers or bands.
  expect(puts[1]).toEqual({
    manualPayment: {
      lipaNamba: '512 3456',
      accountName: 'FitFlex Africa Ltd',
      network: 'M-Pesa',
      instructions: { en: 'Pay the exact amount.', sw: 'Lipa kiasi kamili.' },
    },
  });
  expect(runtimeErrors).toEqual([]);
});

test('settings: flag off is explained, another network is kept, and clearing sends null (Swahili)', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', error => runtimeErrors.push(error));
  await signInAsAdmin(page, 'sw');

  let manualPayment: unknown = { lipaNamba: '987654', accountName: 'FitFlex Africa', network: 'T-Pesa', instructions: null };
  const puts: unknown[] = [];
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/admin/settings' && req.method() === 'PUT') {
      const body = req.postDataJSON();
      puts.push(body);
      manualPayment = body.manualPayment;
      return route.fulfill({ json: { ...BASE_SETTINGS, manualPayment } });
    }
    if (url.pathname === '/admin/settings') return route.fulfill({ json: { ...BASE_SETTINGS, manualPayment } });
    // Flag off: the response has no `manual` key at all.
    if (url.pathname === '/payments/options') return route.fulfill({ json: { available: false } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/settings');
  const card = page.getByTestId('manual-payment-settings');
  await expect(card.getByText('Malipo kwa Lipa Namba')).toBeVisible();
  await expect(page.getByTestId('manual-pay-live')).toContainText('MANUAL_PAY_INSTRUCTIONS umezimwa');
  await expect(card.getByLabel('Mtandao', { exact: true })).toHaveValue('__other__');
  await expect(card.getByLabel('Jina la mtandao')).toHaveValue('T-Pesa');

  await card.getByRole('button', { name: 'Futa taarifa za malipo' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Futa taarifa za malipo' }).click();
  await expect(card.getByText('Taarifa za malipo zimefutwa.')).toBeVisible();
  await expect(card.getByLabel('Lipa Namba')).toHaveValue('');
  expect(puts).toEqual([{ manualPayment: null }]);
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
