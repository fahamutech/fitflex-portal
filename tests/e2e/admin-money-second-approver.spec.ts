import { expect, Page, test } from '@playwright/test';

// A1 · second approver on money (MONEY_SECOND_APPROVER). Every API call is mocked.
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
// The first test in a fresh `next dev` run pays for compiling the route.
test.describe.configure({ timeout: 90_000 });

type Json = Record<string, unknown>;
type Call = { method: string; path: string; body: Json | null };

const basePayment = {
  memberId: 'member-1',
  subscriptionId: 'sub-1',
  tier: 'basic',
  amountTzs: 30000,
  provider: 'admin_approved',
  note: null,
  requestedAt: '2026-10-19T08:00:00.000Z',
  member: { displayName: 'Asha Member' },
  subscription: { type: 'platform_pass', tier: 'basic', status: 'pending' },
};

async function signIn(page: Page, adminId: string, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([id, l]) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id, userType: 'admin', email: `${id}@example.com` }));
    localStorage.setItem('locale', l);
  }, [adminId, locale]);
}

/** Routes the API to `handler`; anything it does not answer gets an empty list. Records every POST. */
async function mockApi(page: Page, handler: (call: Call) => { status?: number; json: unknown } | null) {
  const calls: Call[] = [];
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const call: Call = { method: req.method(), path: url.pathname, body: req.postData() ? JSON.parse(req.postData()!) : null };
    if (call.method === 'POST') calls.push(call);
    const out = handler(call);
    if (out) return route.fulfill({ status: out.status ?? 200, json: out.json });
    return route.fulfill({ json: [] });
  });
  return calls;
}

function watchErrors(page: Page) {
  const errors: Error[] = [];
  page.on('pageerror', e => errors.push(e));
  return errors;
}

test.describe('Payments: second approver', () => {
  test('flag off: no stages, no Verify, Approve works as today', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, 'admin-1');
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        // Flag off: the columns exist (null) but no approvalStage / secondApproverRequired.
        return { json: [{ ...basePayment, id: 'pay-1', status: 'pending', reference: null, decidedAt: null, verifiedBy: null, verifiedAt: null }] };
      }
      if (method === 'POST' && path === '/admin/payment-requests/pay-1') return { json: { ...basePayment, id: 'pay-1', status: 'approved' } };
      return null;
    });
    await page.goto('/admin/payments');
    await expect(page.getByText('Asha Member')).toBeVisible();
    await expect(page.getByTestId('payment-stage')).toHaveCount(0);
    await expect(page.getByTestId('payment-status')).toHaveText('Pending');
    await expect(page.getByTestId('payment-verify')).toHaveCount(0);
    await expect(page.getByTestId('payment-approve-blocked')).toHaveCount(0);
    await page.getByTitle('Approve').click();
    await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
    await expect.poll(() => calls.find(c => c.path === '/admin/payment-requests/pay-1')?.body).toEqual({ status: 'approved' });
    expect(calls.some(c => c.path.endsWith('/verify'))).toBe(false);
    expect(errors).toEqual([]);
  });

  test('admin 1 verifies; Approve is then blocked for admin 1', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, 'admin-1');
    let verified = false;
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return {
          json: [{
            ...basePayment, id: 'pay-1', status: 'pending', reference: null, decidedAt: null,
            verifiedBy: verified ? 'admin-1' : null, verifiedAt: verified ? '2026-10-19T09:00:00.000Z' : null,
            secondApproverRequired: true,
            approvalStage: verified ? 'awaiting_second_approval' : 'awaiting_verification',
            approveNotBy: verified ? 'admin-1' : null, confirmChangeNotBy: null,
          }],
        };
      }
      if (method === 'POST' && path === '/admin/payment-requests/pay-1/verify') {
        verified = true;
        return { json: { ...basePayment, id: 'pay-1', status: 'pending', verifiedBy: 'admin-1', reference: 'MPESA123' } };
      }
      return null;
    });
    await page.goto('/admin/payments');
    await expect(page.getByTestId('payment-stage')).toHaveText('Awaiting verification');
    await expect(page.getByTestId('payment-status')).toHaveCount(0); // one badge: the stage replaces "Pending"
    // Not verified yet: Approve is disabled with the reason.
    await expect(page.getByTestId('payment-approve')).toBeDisabled();
    await expect(page.getByTestId('payment-approve-blocked')).toHaveAttribute('title', 'Verify this payment first. A different admin then approves it.');

    await page.getByTestId('payment-verify').click();
    await page.getByTestId('verify-reference').fill('MPESA123');
    await page.getByTestId('verify-note').fill('Seen on statement');
    await page.getByTestId('verify-submit').click();
    await expect.poll(() => calls.find(c => c.path.endsWith('/verify'))?.body).toEqual({ reference: 'MPESA123', note: 'Seen on statement' });
    await expect(page.getByText('Payment verified. A different admin can now approve it.')).toBeVisible();

    await expect(page.getByTestId('payment-stage')).toHaveText('Awaiting second approval');
    await expect(page.getByTestId('payment-status')).toHaveCount(0);
    await expect(page.getByTestId('payment-verified-by')).toContainText('Verified by you');
    await expect(page.getByTestId('payment-verify')).toHaveCount(0);
    await expect(page.getByTestId('payment-approve')).toBeDisabled();
    await expect(page.getByTestId('payment-approve-blocked')).toHaveAttribute('title', 'You verified this payment. A different admin must approve it.');
    expect(calls.some(c => c.path === '/admin/payment-requests/pay-1')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('admin 2 approves a payment admin 1 verified', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, 'admin-2');
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return {
          json: [{
            ...basePayment, id: 'pay-1', status: 'pending', reference: 'MPESA123', decidedAt: null,
            verifiedBy: 'admin-1', verifiedAt: '2026-10-19T09:00:00.000Z',
            secondApproverRequired: true, approvalStage: 'awaiting_second_approval', approveNotBy: 'admin-1', confirmChangeNotBy: null,
          }],
        };
      }
      if (method === 'POST' && path === '/admin/payment-requests/pay-1') return { json: { ...basePayment, id: 'pay-1', status: 'approved' } };
      return null;
    });
    await page.goto('/admin/payments');
    await expect(page.getByTestId('payment-verified-by')).toContainText('another admin (admin-1)');
    await expect(page.getByTestId('payment-approve')).toBeEnabled();
    await page.getByTestId('payment-approve').click();
    await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
    await expect.poll(() => calls.find(c => c.path === '/admin/payment-requests/pay-1')?.body).toEqual({ status: 'approved' });
    expect(errors).toEqual([]);
  });

  test('server refusal of own verification shows the mapped text', async ({ page }) => {
    // The list says admin 2 may approve, but the server disagrees (for example, a stale page).
    await signIn(page, 'admin-2');
    await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return { json: [{ ...basePayment, id: 'pay-1', status: 'pending', reference: 'R1', decidedAt: null, verifiedBy: 'admin-1', secondApproverRequired: true, approvalStage: 'awaiting_second_approval', approveNotBy: 'admin-1' }] };
      }
      if (method === 'POST' && path === '/admin/payment-requests/pay-1') return { status: 403, json: { error: 'cannot_approve_own_verification' } };
      return null;
    });
    await page.goto('/admin/payments');
    await page.getByTestId('payment-approve').click();
    await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
    await expect(page.getByText('You verified this payment. A different admin must approve it.')).toBeVisible();
  });

  test('change request by admin 1, confirmed by admin 2', async ({ browser }) => {
    // Admin 1 asks to change an approved payment to rejected.
    const one = await browser.newPage();
    const oneErrors = watchErrors(one);
    await signIn(one, 'admin-1');
    let requested = false;
    const oneCalls = await mockApi(one, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return {
          json: [{
            ...basePayment, id: 'pay-1', status: 'approved', reference: 'MPESA123', decidedAt: '2026-10-19T10:00:00.000Z',
            verifiedBy: 'admin-2', verifiedAt: '2026-10-19T09:00:00.000Z',
            changeRequestedStatus: requested ? 'rejected' : null, changeRequestedBy: requested ? 'admin-1' : null,
            changeRequestedAt: requested ? '2026-10-19T11:00:00.000Z' : null, changeRequestReason: requested ? 'Money never arrived' : null,
            secondApproverRequired: true, approvalStage: requested ? 'change_requested' : null,
            approveNotBy: null, confirmChangeNotBy: requested ? 'admin-1' : null,
          }],
        };
      }
      if (method === 'POST' && path === '/admin/payment-requests/pay-1/change-request') {
        requested = true;
        return { json: { ...basePayment, id: 'pay-1', status: 'approved' } };
      }
      return null;
    });
    await one.goto('/admin/payments');
    await one.getByRole('button', { name: 'Approved', exact: true }).click();
    await one.getByTestId('payment-request-change').click();
    await expect(one.getByTestId('change-submit')).toBeDisabled();
    await one.getByTestId('change-status').selectOption('rejected');
    await expect(one.getByTestId('change-submit')).toBeDisabled(); // reason is required
    await one.getByTestId('change-reason').fill('Money never arrived');
    await one.getByTestId('change-submit').click();
    await expect.poll(() => oneCalls.find(c => c.path.endsWith('/change-request'))?.body).toEqual({ status: 'rejected', reason: 'Money never arrived' });
    await expect(one.getByTestId('payment-stage')).toHaveText('Change requested');
    await expect(one.getByTestId('payment-status')).toHaveText('Approved'); // the status still adds something here
    await expect(one.getByTestId('payment-change-requested-by')).toContainText('you asked to change this to Rejected');
    await expect(one.getByTestId('payment-confirm-change')).toBeDisabled();
    await expect(one.getByTestId('payment-confirm-change-blocked')).toHaveAttribute('title', 'You asked for this change. A different admin must confirm it.');
    await expect(one.getByTestId('payment-request-change')).toHaveCount(0);
    expect(oneErrors).toEqual([]);
    await one.close();

    // Admin 2 confirms it.
    const two = await browser.newPage();
    const twoErrors = watchErrors(two);
    await signIn(two, 'admin-2');
    let confirmed = false;
    const twoCalls = await mockApi(two, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return {
          json: [{
            ...basePayment, id: 'pay-1', status: confirmed ? 'rejected' : 'approved', reference: 'MPESA123', decidedAt: '2026-10-19T10:00:00.000Z',
            changeRequestedStatus: confirmed ? null : 'rejected', changeRequestedBy: confirmed ? null : 'admin-1',
            changeRequestedAt: confirmed ? null : '2026-10-19T11:00:00.000Z', changeRequestReason: confirmed ? null : 'Money never arrived',
            secondApproverRequired: true, approvalStage: confirmed ? null : 'change_requested',
            approveNotBy: null, confirmChangeNotBy: confirmed ? null : 'admin-1',
          }],
        };
      }
      if (method === 'POST' && path === '/admin/payment-requests/pay-1/change-request/confirm') {
        confirmed = true;
        return { json: { ...basePayment, id: 'pay-1', status: 'rejected' } };
      }
      return null;
    });
    await two.goto('/admin/payments');
    await two.getByRole('button', { name: 'All', exact: true }).click();
    await expect(two.getByTestId('payment-change-requested-by')).toContainText('another admin (admin-1)');
    await expect(two.getByTestId('payment-confirm-change')).toBeEnabled();
    await two.getByTestId('payment-confirm-change').click();
    await expect(two.getByText(/Change this payment from Approved to Rejected/)).toBeVisible();
    await expect(two.getByText(/Money never arrived/).first()).toBeVisible();
    await two.getByTestId('confirm-change-submit').click();
    await expect.poll(() => twoCalls.find(c => c.path.endsWith('/change-request/confirm'))?.body).toEqual({}); // no amount: not a shop order
    await expect(two.getByText('Change confirmed. The payment is now Rejected.')).toBeVisible();
    await expect(two.getByTestId('payment-stage')).toHaveCount(0);
    expect(twoErrors).toEqual([]);
    await two.close();
  });

  test('confirming a shop-order payment as approved asks for the amount received', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, 'admin-2');
    let attempts = 0;
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return {
          json: [{
            ...basePayment, id: 'pay-ord', subscriptionId: null, orderId: 'ord-1', subscription: null, status: 'rejected', reference: 'MPESA77',
            decidedAt: '2026-10-19T10:00:00.000Z',
            changeRequestedStatus: 'approved', changeRequestedBy: 'admin-1', changeRequestedAt: '2026-10-19T11:00:00.000Z', changeRequestReason: 'Money did arrive',
            secondApproverRequired: true, approvalStage: 'change_requested', approveNotBy: null, confirmChangeNotBy: 'admin-1',
          }],
        };
      }
      if (method === 'POST' && path === '/admin/payment-requests/pay-ord/change-request/confirm') {
        attempts += 1;
        if (attempts === 1) return { status: 409, json: { error: 'amount_mismatch', expectedTzs: 30000 } };
        return { json: { ...basePayment, id: 'pay-ord', status: 'approved' } };
      }
      return null;
    });
    await page.goto('/admin/payments');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByTestId('payment-confirm-change').click();
    await expect(page.getByTestId('confirm-change-submit')).toBeDisabled(); // amount required
    await page.getByTestId('confirm-change-amount').fill('25000');
    await page.getByTestId('confirm-change-submit').click();
    await expect(page.getByText(/The amount received does not match this payment \(.*30,000.*\)\. Check what arrived\./)).toBeVisible();
    await page.getByTestId('confirm-change-amount').fill('30000');
    await page.getByTestId('confirm-change-submit').click();
    await expect(page.getByText('Change confirmed. The payment is now Approved.')).toBeVisible();
    const bodies = calls.filter(c => c.path.endsWith('/change-request/confirm')).map(c => c.body);
    expect(bodies).toEqual([{ amountTzs: 25000 }, { amountTzs: 30000 }]);
    expect(errors).toEqual([]);
  });

  test('cancel a change request; confirm errors are mapped; Swahili stage text', async ({ page }) => {
    await signIn(page, 'admin-2', 'sw');
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return {
          json: [{
            ...basePayment, id: 'pay-1', status: 'approved', reference: 'R1', decidedAt: '2026-10-19T10:00:00.000Z',
            changeRequestedStatus: 'pending', changeRequestedBy: 'admin-1', changeRequestedAt: '2026-10-19T11:00:00.000Z', changeRequestReason: 'Wrong member',
            secondApproverRequired: true, approvalStage: 'change_requested', approveNotBy: null, confirmChangeNotBy: 'admin-1',
          }],
        };
      }
      if (path.endsWith('/change-request/confirm')) return { status: 409, json: { error: 'payment_changed' } };
      if (path.endsWith('/change-request/cancel')) return { json: { ...basePayment, id: 'pay-1', status: 'approved' } };
      return null;
    });
    await page.goto('/admin/payments');
    await page.getByRole('button', { name: 'Approved', exact: true }).click();
    await expect(page.getByTestId('payment-stage')).toHaveText('Mabadiliko yameombwa');
    await page.getByTestId('payment-confirm-change').click();
    await page.getByTestId('confirm-change-submit').click();
    await expect(page.getByText('Mtu mwingine amebadilisha malipo haya sasa hivi. Onyesha upya kisha jaribu tena.')).toBeVisible();
    await page.getByRole('button', { name: 'Funga' }).last().click();

    await page.getByTestId('payment-cancel-change').click();
    await page.getByTestId('cancel-change-reason').fill('Not needed');
    await page.getByTestId('cancel-change-submit').click();
    await expect.poll(() => calls.find(c => c.path.endsWith('/change-request/cancel'))?.body).toEqual({ reason: 'Not needed' });
    await expect(page.getByText('Ombi la mabadiliko limeghairiwa. Malipo hayajabadilika.')).toBeVisible();
  });
});

test.describe('Refunds: second approver', () => {
  const baseRefund = {
    memberId: 'member-1', kind: 'subscription', subscriptionId: 'sub-1', bookingId: null, orderId: null, paymentRequestId: 'pay-1',
    amountTzs: 30000, currency: 'TZS', reasonCode: 'payment_error', note: null, decisionNote: null,
    paidAt: null, paymentReference: null, paidTo: null, createdAt: '2026-10-19T08:00:00.000Z',
    member: { id: 'member-1', displayName: 'Asha Member', phone: '+255700000001', email: null },
  };

  test('flag off: approve and mark paid stay open, no stage badge', async ({ page }) => {
    await signIn(page, 'admin-1');
    await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/refunds') {
        return {
          json: {
            refunds: [
              { ...baseRefund, id: 'r-1', status: 'requested', requestedBy: 'admin-1', requestedRole: 'admin', decidedBy: null, decidedAt: null },
              { ...baseRefund, id: 'r-2', status: 'approved', requestedBy: 'admin-1', requestedRole: 'admin', decidedBy: 'admin-1', decidedAt: '2026-10-19T09:00:00.000Z' },
            ],
          },
        };
      }
      return null;
    });
    await page.goto('/admin/refunds');
    await page.getByTestId('refund-filter-all').click();
    await expect(page.getByTestId('refund-stage')).toHaveCount(0);
    await expect(page.getByTestId('refund-status')).toHaveText(['To decide', 'To pay']);
    await expect(page.getByTestId('refund-approve')).toBeEnabled();
    await expect(page.getByTestId('refund-paid')).toBeEnabled();
  });

  test('the approver cannot mark paid; the raiser cannot approve', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, 'admin-1');
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/refunds') {
        return {
          json: {
            refunds: [
              { ...baseRefund, id: 'r-1', status: 'requested', requestedBy: 'admin-1', requestedRole: 'admin', decidedBy: null, decidedAt: null,
                secondApproverRequired: true, approvalStage: 'awaiting_approval', approveNotBy: 'admin-1', payNotBy: null },
              { ...baseRefund, id: 'r-2', status: 'approved', requestedBy: 'member-1', requestedRole: 'member', decidedBy: 'admin-1', decidedAt: '2026-10-19T09:00:00.000Z',
                secondApproverRequired: true, approvalStage: 'awaiting_payment', approveNotBy: null, payNotBy: 'admin-1' },
              { ...baseRefund, id: 'r-3', status: 'approved', requestedBy: 'member-1', requestedRole: 'member', decidedBy: 'admin-2', decidedAt: '2026-10-19T09:00:00.000Z',
                member: { ...baseRefund.member, displayName: 'Baraka Member' },
                secondApproverRequired: true, approvalStage: 'awaiting_payment', approveNotBy: null, payNotBy: 'admin-2' },
            ],
          },
        };
      }
      if (method === 'POST' && path === '/admin/refunds/r-3/paid') return { status: 403, json: { error: 'cannot_pay_own_request' } };
      return null;
    });
    await page.goto('/admin/refunds');
    await page.getByTestId('refund-filter-all').click();
    await expect(page.getByTestId('refund-stage')).toHaveText(['Awaiting approval', 'Awaiting payment', 'Awaiting payment']);
    await expect(page.getByTestId('refund-status')).toHaveCount(0); // one badge per row

    await expect(page.getByTestId('refund-approve')).toBeDisabled();
    await expect(page.getByTestId('refund-approve-blocked')).toHaveAttribute('title', 'You raised this refund. A different admin must approve it.');

    const paid = page.getByTestId('refund-paid');
    await expect(paid.nth(0)).toBeDisabled();
    await expect(page.getByTestId('refund-paid-blocked')).toHaveAttribute('title', 'You approved this refund. A different admin must record the payment.');
    await expect(paid.nth(1)).toBeEnabled();

    // A refusal the list could not predict still reads clearly.
    await paid.nth(1).click();
    await page.getByPlaceholder('e.g. MPESA QX12AB34').fill('MPESA999');
    await page.getByTestId('refund-submit').click();
    await expect(page.getByText('You started this refund. A different admin must record the payment.')).toBeVisible();
    expect(calls.filter(c => c.path === '/admin/refunds/r-2/paid')).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  test('a policy-approved refund the admin started cannot be marked paid by them', async ({ page }) => {
    await signIn(page, 'admin-1');
    await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/refunds') {
        return {
          json: {
            refunds: [
              { ...baseRefund, id: 'r-9', kind: 'trainer_booking', status: 'approved', requestedBy: 'admin-1', requestedRole: 'admin',
                decidedBy: 'policy', decidedAt: '2026-10-19T09:00:00.000Z',
                secondApproverRequired: true, approvalStage: 'awaiting_payment', approveNotBy: null, payNotBy: 'admin-1' },
            ],
          },
        };
      }
      return null;
    });
    await page.goto('/admin/refunds');
    await expect(page.getByTestId('refund-paid')).toBeDisabled();
    await expect(page.getByTestId('refund-paid-blocked')).toHaveAttribute('title', 'You started this refund. A different admin must record the payment.');
  });
});
