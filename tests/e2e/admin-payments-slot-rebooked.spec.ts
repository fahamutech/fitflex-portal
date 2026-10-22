import { expect, Page, test } from '@playwright/test';

// Trainer session outcomes (functions#231): approving a booking group's payment is refused with
// 409 group_slot_rebooked when a rejected session's slot was taken since. Every API call is mocked.
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.describe.configure({ timeout: 90_000 });

type Call = { method: string; path: string };

const sessionPayment = {
  id: 'pay-1',
  memberId: 'member-1',
  subscriptionId: null,
  bookingGroupId: 'grp-1',
  tier: null,
  amountTzs: 40000,
  provider: 'admin_approved',
  note: null,
  reference: null,
  requestedAt: '2026-10-19T08:00:00.000Z',
  decidedAt: null,
  member: { displayName: 'Asha Member' },
  subscription: null,
};

async function signIn(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(l => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-2', userType: 'admin', email: 'admin-2@example.com' }));
    localStorage.setItem('locale', l);
  }, locale);
}

async function mockApi(page: Page, handler: (call: Call) => { status?: number; json: unknown } | null) {
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const out = handler({ method: req.method(), path: new URL(req.url()).pathname });
    if (out) return route.fulfill({ status: out.status ?? 200, json: out.json });
    return route.fulfill({ json: [] });
  });
}

test.describe('Payments: session slot rebooked', () => {
  test('approve refused: count and booking ids are shown', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', e => errors.push(e));
    await signIn(page);
    await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') return { json: [{ ...sessionPayment, status: 'pending' }] };
      if (method === 'POST' && path === '/admin/payment-requests/pay-1') {
        return { status: 409, json: { error: 'group_slot_rebooked', bookingIds: ['tbk_a', 'tbk_b'] } };
      }
      return null;
    });
    await page.goto('/admin/payments');
    await page.getByTitle('Approve').click();
    await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
    await expect(page.getByText(
      "Can't approve: 2 session slot(s) in this booking were taken by another member since the payment was rejected. Adjust or reject the payment. Sessions: tbk_a, tbk_b.",
    )).toBeVisible();
    await expect(page.getByText('That did not save. Try again.')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('second approval of a verified payment refused without ids: message without a list', async ({ page }) => {
    await signIn(page);
    await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return {
          json: [{
            ...sessionPayment, status: 'pending', reference: 'MPESA123', verifiedBy: 'admin-1', verifiedAt: '2026-10-19T09:00:00.000Z',
            secondApproverRequired: true, approvalStage: 'awaiting_second_approval', approveNotBy: 'admin-1', confirmChangeNotBy: null,
          }],
        };
      }
      if (method === 'POST' && path === '/admin/payment-requests/pay-1') return { status: 409, json: { error: 'group_slot_rebooked' } };
      return null;
    });
    await page.goto('/admin/payments');
    await page.getByTestId('payment-approve').click();
    await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
    await expect(page.getByText(
      "Can't approve: 1 session slot(s) in this booking were taken by another member since the payment was rejected. Adjust or reject the payment.",
      { exact: true },
    )).toBeVisible();
  });

  test('confirming a change request refused, in Swahili, inside the dialog', async ({ page }) => {
    await signIn(page, 'sw');
    await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return {
          json: [{
            ...sessionPayment, status: 'rejected', decidedAt: '2026-10-19T10:00:00.000Z',
            changeRequestedStatus: 'approved', changeRequestedBy: 'admin-1', changeRequestedAt: '2026-10-19T11:00:00.000Z', changeRequestReason: 'Paid after all',
            secondApproverRequired: true, approvalStage: 'change_requested', approveNotBy: null, confirmChangeNotBy: 'admin-1',
          }],
        };
      }
      if (path.endsWith('/change-request/confirm')) return { status: 409, json: { error: 'group_slot_rebooked', bookingIds: ['tbk_a'] } };
      return null;
    });
    await page.goto('/admin/payments');
    await page.getByRole('button', { name: 'Imekataliwa', exact: true }).click();
    await page.getByTestId('payment-confirm-change').click();
    await page.getByTestId('confirm-change-submit').click();
    await expect(page.getByText(
      'Haiwezi kuidhinishwa: nafasi 1 za vipindi katika miadi hii zimechukuliwa na mwanachama mwingine tangu malipo yalipokataliwa. Rekebisha au kataa malipo. Vipindi: tbk_a.',
    )).toBeVisible();
  });
});
