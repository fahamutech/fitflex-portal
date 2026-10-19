// Journey-audit Phase A design-QA fixes (payments, refunds, settings, scan). Every API call is mocked.
import { expect, Page, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
// The first test in a fresh `next dev` run pays for compiling the route.
test.describe.configure({ timeout: 90_000 });

type Json = Record<string, unknown>;
type Call = { method: string; path: string; body: Json | null };
type Handler = (call: Call) => { status?: number; json: unknown } | null;

async function signIn(page: Page, user: Json, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'dqa-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('locale', l as string);
  }, [user, locale] as const);
}
const signInAdmin = (page: Page, id = 'admin-1', locale: 'en' | 'sw' = 'en') =>
  signIn(page, { id, userType: 'admin', email: `${id}@example.com` }, locale);

/** Routes the API to `handler`; anything it does not answer gets an empty list. Records every write. */
async function mockApi(page: Page, handler: Handler) {
  const calls: Call[] = [];
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const url = new URL(req.url());
    const call: Call = { method: req.method(), path: url.pathname, body: req.postData() ? JSON.parse(req.postData()!) : null };
    if (call.method !== 'GET') calls.push(call);
    const out = handler(call);
    if (out) return route.fulfill({ status: out.status ?? 200, json: out.json });
    if (call.path === '/me/personas' || call.path === '/me/invitations') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ json: call.method === 'GET' ? [] : {} });
  });
  return calls;
}

function watchErrors(page: Page) {
  const errors: Error[] = [];
  page.on('pageerror', e => errors.push(e));
  return errors;
}

const base = {
  memberId: 'member-1', subscriptionId: 'sub-1', tier: 'basic', amountTzs: 30000, provider: 'admin_approved', note: null,
  requestedAt: '2026-10-19T08:00:00.000Z', decidedAt: null, member: { displayName: 'Asha Member' },
  subscription: { type: 'platform_pass', tier: 'basic', status: 'pending' },
};
const twoAdmin = { secondApproverRequired: true, approveNotBy: null, confirmChangeNotBy: null };

/** A busy page: every kind of row, long notes and references, two-admin audit text. Rows are found by position (0–3). */
const BUSY_ROWS = [
  { ...base, ...twoAdmin, id: 'pay_c7f2970201234567890abcdef', status: 'pending', subscriptionId: null, orderId: 'ord-1', subscription: null, tier: null,
    reference: null, memberReference: null, approvalStage: 'awaiting_verification', member: { displayName: 'Dev Member With A Long Name' } },
  { ...base, ...twoAdmin, id: 'pay_0c37a4ab0123456789abcdef', status: 'pending', tier: 'executive', amountTzs: 100000,
    note: 'upgrade:sub-1:premium', subscription: { type: 'platform_pass', tier: 'premium', status: 'active', expiresAt: '2026-11-19T08:00:00.000Z' },
    reference: 'RTY5UP8GRADE1', memberReference: 'RTY5UP8GRADE1', payerPhone: '+255700000010',
    verifiedBy: 'admin-2', verifiedByName: 'Neema Admin', verifiedAt: '2026-10-19T09:00:00.000Z', approvalStage: 'awaiting_second_approval', approveNotBy: 'admin-2' },
  { ...base, ...twoAdmin, id: 'pay_ea2e10c6a0123456789abcd', status: 'pending', tier: 'pro', amountTzs: 60000,
    reference: 'QGH7XK2L9P', memberReference: 'QGH7XK2L9P', payerPhone: '+255700000102',
    note: 'Member called twice to say the money was sent from a relative’s phone; checked with the till manager on Saturday morning.',
    verifiedBy: 'admin-1', verifiedAt: '2026-10-19T09:30:00.000Z', approvalStage: 'awaiting_second_approval', approveNotBy: 'admin-1' },
  { ...base, ...twoAdmin, id: 'pay_trainerpass0123456789ab', status: 'pending', tier: null, subscription: { type: 'trainer_pass', plan: 'weekly', status: 'pending' },
    gym: { id: 'gym-1', name: 'Mikocheni Fitness and Wellness Centre' }, reference: null, memberReference: 'MPX99ZZ', payerPhone: '+255712345678',
    approvalStage: 'awaiting_verification' },
];

test.describe('Payments layout (H4, M3)', () => {
  test('at 1280px every row’s actions are visible without scrolling, and an ID equal to the member’s shows once', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAdmin(page);
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: BUSY_ROWS } : null));
    await page.goto('/admin/payments');
    await expect(page.getByText('Dev Member With A Long Name')).toBeVisible();

    const region = page.getByRole('region', { name: 'Payments' });
    expect(await region.evaluate(el => el.scrollLeft)).toBe(0);
    // With this busy fixture the whole table fits 1280px; the pinned actions column is the fallback for longer data.
    expect(await region.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    for (const row of await page.locator('tbody tr').all()) {
      const edit = row.getByTestId('payment-edit');
      await expect(edit).toBeInViewport();
      const box = await edit.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
      // Approve (enabled or blocked) and Reject are on screen too.
      await expect(row.getByTestId('payment-approve')).toBeInViewport();
      await expect(row.getByTestId('payment-reject')).toBeInViewport();
      // The status (and why Approve is blocked) is not hidden under the pinned actions column.
      const status = (await row.locator('td').nth(3).boundingBox())!;
      const actions = (await row.locator('td').last().boundingBox())!;
      expect(status.x + status.width).toBeLessThanOrEqual(actions.x + 1);
    }

    // M3: the recorded reference equals the member's ID: shown once.
    const upgradeRow = page.locator('tbody tr').nth(1);
    await expect(upgradeRow.getByText('RTY5UP8GRADE1')).toHaveCount(1);
    await expect(upgradeRow.getByTestId('member-reference-differs')).toHaveCount(0);
    // Not recorded yet: the member's ID shows, marked as theirs.
    const passRow = page.locator('tbody tr').nth(3);
    await expect(passRow.getByTestId('member-reference')).toHaveText('MPX99ZZ');
    // The long note is one truncated line, full text in the tooltip.
    const note = page.locator('tbody tr').nth(2).getByTestId('payment-note');
    await expect(note).toHaveAttribute('title', /checked with the till manager/);
    expect((await note.boundingBox())!.height).toBeLessThan(24);
    // One date format per row (en-GB medium + short time), not the browser default.
    await expect(page.locator('tbody tr').first()).toContainText('19 Oct 2026');
    await expect(page.locator('tbody tr').first()).not.toContainText('10/19/2026');
    // Icon buttons carry names.
    await expect(page.getByRole('button', { name: 'Cancel payment' }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a recorded reference that differs from the member’s shows both, once each', async ({ page }) => {
    await signInAdmin(page);
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests'
      ? { json: [{ ...base, id: 'pay-1', status: 'pending', reference: 'BANK-9', memberReference: 'QX12AB34' }] } : null));
    await page.goto('/admin/payments');
    await expect(page.getByTestId('payment-reference')).toHaveText('BANK-9');
    await expect(page.getByTestId('member-reference-differs')).toHaveText('Member gave QX12AB34');
  });
});

test.describe('Payments: date sorting', () => {
  test('newest first by default; the Member · date header sorts oldest first, with aria-sort', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAdmin(page);
    // API order deliberately mixed.
    const rows = [
      { ...base, id: 'pay-mid', status: 'pending', reference: null, requestedAt: '2026-10-18T08:00:00.000Z', member: { displayName: 'Middle Member' } },
      { ...base, id: 'pay-old', status: 'pending', reference: null, requestedAt: '2026-10-01T08:00:00.000Z', member: { displayName: 'Oldest Member' } },
      { ...base, id: 'pay-new', status: 'pending', reference: null, requestedAt: '2026-10-19T08:00:00.000Z', member: { displayName: 'Newest Member' } },
    ];
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: rows } : null));
    await page.goto('/admin/payments');
    const names = page.locator('tbody tr td:first-child .font-medium');
    const header = page.getByRole('columnheader', { name: /Member · date/ });
    await expect(names).toHaveText(['Newest Member', 'Middle Member', 'Oldest Member']);
    await expect(header).toHaveAttribute('aria-sort', 'descending');

    await header.getByRole('button').click(); // newest first → oldest first (never back to API order)
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expect(names).toHaveText(['Oldest Member', 'Middle Member', 'Newest Member']);
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(names).toHaveText(['Newest Member', 'Middle Member', 'Oldest Member']);
    // Sorting adds no width: the actions stay on screen.
    for (const edit of await page.getByTestId('payment-edit').all()) await expect(edit).toBeInViewport();
  });

  test('Swahili header', async ({ page }) => {
    await signInAdmin(page, 'admin-1', 'sw');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: [{ ...base, id: 'pay-1', status: 'pending', reference: null }] } : null));
    await page.goto('/admin/payments');
    await expect(page.getByRole('columnheader', { name: /Mwanachama · tarehe/ })).toHaveAttribute('aria-sort', 'descending');
  });
});

test.describe('Payments: stages, reasons and names (M10, M11)', () => {
  test('awaiting second approval is amber, and why Approve is blocked is visible text', async ({ page }) => {
    await signInAdmin(page, 'admin-1');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: BUSY_ROWS } : null));
    await page.goto('/admin/payments');

    // Verified by this admin: says "you", and the reason is on screen, tied to the disabled button.
    const own = page.locator('tbody tr').nth(2);
    const stage = own.getByTestId('payment-stage').locator('span').first();
    await expect(stage).toHaveText('Awaiting second approval');
    await expect(stage).toHaveClass(/warning/);
    await expect(stage).not.toHaveClass(/success|brand/);
    await expect(own.getByTestId('payment-verified-by')).toContainText('Verified by you');
    await expect(own.getByTestId('payment-approve-hint')).toHaveText('A different admin must approve it.');
    await expect(own.getByTestId('payment-approve-hint')).toBeVisible();
    await expect(own.getByTestId('payment-approve')).toBeDisabled();
    await expect(own.getByTestId('payment-approve')).toHaveAttribute('aria-describedby', 'payment-hint-pay_ea2e10c6a0123456789abcd');

    // Not verified: the reason is visible too.
    await expect(page.locator('tbody tr').nth(3).getByTestId('payment-approve-hint'))
      .toHaveText('Verify first; a different admin then approves.');

    // Verified by another admin: their name, never the id; this admin may approve (no hint).
    const other = page.locator('tbody tr').nth(1);
    await expect(other.getByTestId('payment-verified-by')).toContainText('Verified by Neema Admin');
    await expect(other.getByTestId('payment-approve-hint')).toHaveCount(0);
    await expect(page.getByText('admin-2')).toHaveCount(0);
  });

  test('without a name the other admin is "another admin", and the change-request line is compact', async ({ page }) => {
    await signInAdmin(page, 'admin-2');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? {
      json: [{
        ...base, ...twoAdmin, id: 'pay-1', status: 'approved', reference: 'MPESA123', decidedAt: '2026-10-19T10:00:00.000Z',
        verifiedBy: 'usr_admin_1', verifiedAt: '2026-10-19T09:00:00.000Z',
        changeRequestedStatus: 'rejected', changeRequestedBy: 'usr_admin_1', changeRequestedByName: null, changeRequestedAt: '2026-10-19T11:00:00.000Z',
        changeRequestReason: 'Money never arrived on the till statement even after we waited two full working days and called the network.',
        approvalStage: 'change_requested', confirmChangeNotBy: 'usr_admin_1',
      }],
    } : null));
    await page.goto('/admin/payments');
    await page.getByRole('button', { name: 'Approved', exact: true }).click();
    const line = page.getByTestId('payment-change-requested-by');
    await expect(line).toContainText('Another admin asked to change this to Rejected');
    await expect(page.getByText('usr_admin_1')).toHaveCount(0);
    // The status cell stays a few lines tall, not ~14.
    const cell = page.getByTestId('payment-stage').locator('xpath=ancestor::td');
    expect((await cell.boundingBox())!.height).toBeLessThan(160); // about 7 short lines; was about 14
  });
});

test.describe('Payments: dialogs (M4, M12)', () => {
  test('approving a shop order shows the amount, transaction ID and verifier, in order words', async ({ page }) => {
    await signInAdmin(page, 'admin-2');
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return { json: [{ ...base, ...twoAdmin, id: 'pay-ord', subscriptionId: null, orderId: 'ord-1', subscription: null, tier: null, amountTzs: 39000,
          status: 'pending', reference: 'SHOP77', verifiedBy: 'admin-1', verifiedByName: 'Neema Admin', verifiedAt: '2026-10-19T09:00:00.000Z',
          approvalStage: 'awaiting_second_approval', approveNotBy: 'admin-1' }] };
      }
      if (method === 'POST' && path === '/admin/payment-requests/pay-ord') return { json: { id: 'pay-ord', status: 'approved' } };
      return null;
    });
    await page.goto('/admin/payments');
    await page.getByTestId('payment-approve').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading')).toHaveText('Approve payment');
    await expect(dialog).toContainText('The order is confirmed as paid.');
    await expect(dialog).not.toContainText('plan');
    await expect(dialog).not.toContainText('"approved"');
    await expect(dialog.getByTestId('decision-facts')).toContainText('TSh 39,000');
    await expect(dialog.getByTestId('decision-reference')).toHaveText('SHOP77');
    await expect(dialog.getByTestId('decision-verified-by')).toContainText('Neema Admin');
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect.poll(() => calls.find(c => c.path === '/admin/payment-requests/pay-ord')?.body).toEqual({ status: 'approved' });
  });

  test('verifying a shop order talks about the order, not a plan', async ({ page }) => {
    await signInAdmin(page);
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests'
      ? { json: [{ ...base, ...twoAdmin, id: 'pay-ord', subscriptionId: null, orderId: 'ord-1', subscription: null, tier: null, status: 'pending', reference: null, approvalStage: 'awaiting_verification' }] }
      : null));
    await page.goto('/admin/payments');
    await page.getByTestId('payment-verify').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('the order is confirmed as paid');
    await expect(dialog).not.toContainText('plan starts');
  });
});

test.describe('Payments: load failure (M14)', () => {
  test('one error with a retry; no count, no empty-table text', async ({ page }) => {
    await signInAdmin(page);
    let fail = true;
    await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/payment-requests') {
        return fail ? { status: 500, json: { error: 'internal' } } : { json: [{ ...base, id: 'pay-1', status: 'pending', reference: null }] };
      }
      return null;
    });
    await page.goto('/admin/payments');
    const err = page.getByTestId('payments-load-error');
    await expect(err).toContainText('Payments could not be loaded');
    await expect(page.getByText('No payments found.')).toHaveCount(0);
    await expect(page.getByText(/payment requests/)).toHaveCount(0);
    await expect(page.getByText('Failed to fetch')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(1);
    fail = false;
    await err.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Asha Member')).toBeVisible();
    await expect(page.getByText('1 payment requests, 1 pending.')).toBeVisible();
    await expect(err).toHaveCount(0);
  });
});

test.describe('Payments in Swahili (M8, D6)', () => {
  test('headings, filters, badges and actions are translated', async ({ page }) => {
    await signInAdmin(page, 'admin-1', 'sw');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? {
      json: [
        { ...base, id: 'pay-ord', subscriptionId: null, orderId: 'ord-1', subscription: null, tier: null, status: 'pending', reference: null },
        { ...base, id: 'pay-ok', status: 'approved', reference: 'R1', decidedAt: '2026-10-19T10:00:00.000Z' },
      ],
    } : null));
    await page.goto('/admin/payments');
    await expect(page.getByRole('heading', { name: 'Malipo' })).toBeVisible();
    await expect(page.getByText('ODA YA DUKA')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Namba ya muamala' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hariri' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Yote', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Rejesha malipo haya' })).toBeVisible();
    for (const en of ['SHOP ORDER', 'Payments', 'All types', 'Refund this payment']) await expect(page.getByText(en, { exact: true })).toHaveCount(0);
  });

  test('a change request by you reads "Umeomba", never "wewe ameomba"', async ({ page }) => {
    await signInAdmin(page, 'admin-1', 'sw');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? {
      json: [{ ...base, ...twoAdmin, id: 'pay-1', status: 'approved', reference: 'R1', decidedAt: '2026-10-19T10:00:00.000Z',
        changeRequestedStatus: 'rejected', changeRequestedBy: 'admin-1', changeRequestedAt: '2026-10-19T11:00:00.000Z', changeRequestReason: 'Kosa',
        approvalStage: 'change_requested', confirmChangeNotBy: 'admin-1' }],
    } : null));
    await page.goto('/admin/payments');
    await page.getByRole('button', { name: 'Yote', exact: true }).click();
    await expect(page.getByTestId('payment-change-requested-by')).toContainText('Umeomba hali ibadilishwe');
    await expect(page.getByText(/wewe ameomba/i)).toHaveCount(0);
    await expect(page.getByTestId('payment-confirm-hint')).toHaveText('Admin mwingine lazima athibitishe mabadiliko.');
  });
});

test.describe('Refunds: who did what is visible (M10)', () => {
  const refund = {
    memberId: 'member-1', kind: 'subscription', subscriptionId: 'sub-1', bookingId: null, orderId: null, paymentRequestId: 'pay-1',
    amountTzs: 30000, currency: 'TZS', reasonCode: 'payment_error', note: null, decisionNote: null,
    paidAt: null, paymentReference: null, paidTo: null, createdAt: '2026-10-19T08:00:00.000Z',
    member: { id: 'member-1', displayName: 'Asha Member', phone: '+255700000001', email: null }, secondApproverRequired: true,
  };
  test('raised by you / approved by you show as text, and other admins by name', async ({ page }) => {
    await signInAdmin(page, 'admin-1');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/refunds' ? { json: { refunds: [
      { ...refund, id: 'r-1', status: 'requested', requestedBy: 'admin-1', requestedRole: 'admin', decidedBy: null, decidedAt: null, approvalStage: 'awaiting_approval', approveNotBy: 'admin-1' },
      { ...refund, id: 'r-2', status: 'approved', requestedBy: 'member-1', requestedRole: 'member', decidedBy: 'admin-1', decidedAt: '2026-10-19T09:00:00.000Z', approvalStage: 'awaiting_payment', payNotBy: 'admin-1' },
      { ...refund, id: 'r-3', status: 'approved', requestedBy: 'member-1', requestedRole: 'member', decidedBy: 'admin-9', decidedByName: 'Juma Admin', decidedAt: '2026-10-19T09:00:00.000Z', approvalStage: 'awaiting_payment', payNotBy: 'admin-9' },
    ] } } : null));
    await page.goto('/admin/refunds');
    await page.getByTestId('refund-filter-all').click();
    await expect(page.getByTestId('refund-audit')).toHaveText([
      'You raised this refund. A different admin must approve it.',
      'You approved this refund. A different admin must record the payment.',
      'Approved by Juma Admin',
    ]);
    await expect(page.getByText('admin-9')).toHaveCount(0);
    // "Awaiting payment" is still work to do: amber, not green.
    await expect(page.getByTestId('refund-stage').nth(1).locator('span').first()).toHaveClass(/warning/);
  });
});

const SETTINGS = {
  id: 'platform',
  subscriptionTiers: [
    { key: 'basic', label: 'Basic', monthlyPrice: 30000, visits: 12, gymAccess: 'standard' },
    { key: 'pro', label: 'Pro', monthlyPrice: 60000, visits: 30, gymAccess: 'midtier' },
  ],
  payoutBands: [], paymentPeriodDays: 14, payoutModel: 'commission', currency: 'TZS', updatedAt: '2026-10-19T08:00:00Z',
};

test.describe('Settings (H5, D1)', () => {
  test('when settings fail to load: an error with retry, no tier table, nothing can be saved', async ({ page }) => {
    await signInAdmin(page);
    let fail = true;
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/settings') return fail ? { status: 503, json: { error: 'unavailable' } } : { json: SETTINGS };
      if (method === 'GET' && path === '/payments/options') return { json: {} };
      return null;
    });
    await page.goto('/admin/settings');
    const err = page.getByTestId('settings-load-error');
    await expect(err).toContainText('Settings could not be loaded');
    await expect(page.getByTestId('tiers-editor')).toHaveCount(0);
    await expect(page.getByTestId('settings-save')).toBeDisabled();
    await page.getByTestId('settings-save').click({ force: true });
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);

    fail = false;
    await err.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('tiers-editor')).toBeVisible();
    await expect(page.getByTestId('settings-save')).toBeEnabled();
  });

  test('an empty tier list is never sent; removing a saved tier asks first', async ({ page }) => {
    await signInAdmin(page);
    const calls = await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/settings' ? { json: SETTINGS } : null));
    await page.goto('/admin/settings');
    await page.getByTestId('tier-0-remove').click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Remove the Basic tier?');
    await expect(confirm).toContainText('The server refuses to remove a tier that members still hold');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('tier-1-status')).toBeVisible(); // still two rows
    for (let k = 0; k < 2; k++) {
      await page.getByTestId('tier-0-remove').click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remove tier' }).click();
    }
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('At least one pass must stay on sale.')).toBeVisible();
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
  });

  test('saving without a tier that existed (renamed) asks first; the backend’s none_on_sale is explained', async ({ page }) => {
    await signInAdmin(page);
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/settings') return { json: SETTINGS };
      if (method === 'PUT' && path === '/admin/settings') return { status: 400, json: { error: 'invalid_subscription_tier', tier: null, field: 'subscriptionTiers', reason: 'none_on_sale' } };
      return null;
    });
    await page.goto('/admin/settings');
    await page.getByTestId('tier-row-1').getByLabel('Tier key').fill('pro_plus');
    await page.getByTestId('settings-save').click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Save without pro?');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
    await page.getByTestId('settings-save').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save anyway' }).click();
    await expect.poll(() => calls.filter(c => c.method === 'PUT').length).toBe(1);
    await expect(page.getByText('At least one pass must stay on sale.')).toBeVisible();
  });

  test('a held tier the server refuses (409 tier_in_use) is named, with how many hold it', async ({ page }) => {
    await signInAdmin(page);
    const calls = await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/settings') return { json: SETTINGS };
      if (method === 'PUT' && path === '/admin/settings') return { status: 409, json: { error: 'tier_in_use', tier: 'pro', holders: 3 } };
      return null;
    });
    await page.goto('/admin/settings');
    await page.getByTestId('tier-1-remove').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove tier' }).click();
    await page.getByTestId('settings-save').click();
    await expect.poll(() => calls.filter(c => c.method === 'PUT').length).toBe(1);
    await expect(page.getByText('Pro can’t be removed or switched off: 3 passes or accounts still use it. Nothing was saved.')).toBeVisible();
  });

  test('Swahili: settings titles are translated', async ({ page }) => {
    await signInAdmin(page, 'admin-1', 'sw');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/settings' ? { json: SETTINGS } : null));
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Mipangilio ya Jukwaa' })).toBeVisible();
    await expect(page.getByText('Madaraja ya Malipo', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Utaalamu wa trainer')).toBeVisible();
    for (const en of ['Platform Settings', 'Payout Bands', 'Trainer Specialties', 'Save all']) await expect(page.getByText(en, { exact: true })).toHaveCount(0);
  });
});

test.describe('Scan (M13, D6)', () => {
  const owner = { id: 'owner-1', userType: 'gym_operator', email: 'owner@example.test' };
  const scanMock = (idempotent: boolean): Handler => ({ method, path }) => {
    if (method === 'GET' && path === '/subscription-tiers') return { json: [{ key: 'premium', label: 'Premium', monthlyPrice: 100000, visits: 30, gymAccess: 'premium' }] };
    if (method === 'POST' && path === '/operator/checkins') {
      return { json: { ok: true, idempotent, visitNumberInCycle: 3, checkin: { id: 'c1', memberId: 'member-1', memberPublicId: 'FF-1234', passTier: 'premium', visitNumberInCycle: 3, timestamp: '2026-10-19T10:00:00Z', memberPhone: null, gymTier: 'premium' } } };
    }
    return null;
  };

  test('a repeat same-day scan says "Already checked in today"; the tier is its label; the result is in view at 1280×900', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, owner);
    await mockApi(page, scanMock(true));
    await page.goto('/scan');
    await page.getByTestId('manual-token').fill('usr_1.abc.sig');
    await page.getByTestId('manual-submit').click();
    const result = page.getByTestId('scan-result');
    await expect(result).toContainText('Already checked in today');
    await expect(result).not.toContainText('Check-in successful');
    await expect(result).not.toContainText('Visit #');
    await expect(page.getByTestId('scan-tier')).toHaveText('Premium');
    await expect(result).toBeInViewport();
    // The role in the sidebar is a label, not "Gym_operator".
    await expect(page.getByRole('complementary').getByTestId('shell-role')).toHaveText('Gym owner');
  });

  test('a new visit still shows its number; idle camera text has enough contrast; Swahili labels', async ({ page }) => {
    await signIn(page, owner, 'sw');
    await mockApi(page, scanMock(false));
    await page.goto('/scan');
    const off = page.getByText('Kamera imezimwa');
    await expect(off).toBeVisible();
    // gray-400 (#98a2b3) on gray-950: well above 4.5:1.
    await expect(off.locator('xpath=..')).toHaveCSS('color', 'rgb(152, 162, 179)');
    for (const sw of ['Kamera', 'Kuweka kwa mkono', 'Wasilisha']) await expect(page.getByText(sw, { exact: true })).toBeVisible();
    await page.getByTestId('manual-token').fill('usr_1.abc.sig');
    await page.getByTestId('manual-submit').click();
    await expect(page.getByTestId('scan-result')).toContainText('Kuingia kumefanikiwa');
    await expect(page.getByTestId('scan-visit-number')).toHaveText('Ziara #3');
  });
});
