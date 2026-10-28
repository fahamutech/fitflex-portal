import { expect, test, type Page } from '@playwright/test';
import {
  EVENTS_STAFF, OWNER, STAFF_FINANCE, STAFF_OPS, SUPER_ADMIN, expectNoRawKeys, orgUser, organizerMe, setupEvents,
} from './helpers/events-mock';

// Events S4 (spec docs/design/events-s4-payments-and-tickets.md §6.10): admin payments and refunds for event orders, the admin
// order panel, the refund batch on event cancel, the organizer Finance tab, the corporate payment flow and the refund-policy
// presets of the wizard Terms step. The mock is strict about the spec's real shapes (a missing amount received, a wrong role,
// a client-sent amount or a missing Idempotency-Key are refused), so a portal that guesses a shape fails here.
test.use({ serviceWorkers: 'block' });

const ADMIN_2 = { id: 'admin-2', userType: 'admin', email: 'second@fitflex.test' };
const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });
const QUEUE = async (page: Page, user = SUPER_ADMIN, opts: Parameters<typeof setupEvents>[2] = {}) => {
  const mock = await setupEvents(page, user, { s4: {}, ...opts });
  await page.goto('/admin/payments/');
  await page.getByTestId('payments-kind-event_order').click();
  await expect(page.getByTestId('payment-event-detail').first()).toBeVisible();
  return mock;
};

test.describe('admin Payments: event orders (§6.2, P-P-1..5)', () => {
  test('an event row shows the kind, event, order, places, hold and payer details; the filter asks the server for event payments only', async ({ page }) => {
    const mock = await QUEUE(page);
    expect(mock.reads(/^\/admin\/payment-requests$/).some(c => c.query.productType === 'EVENT_ORDER')).toBe(true);
    const r = row(page, 'EV-2026-0001');
    await expect(r).toContainText('EVENT TICKETS');
    await expect(r).toContainText('Arusha Trail 10K');
    await expect(r).toContainText('2 places');
    await expect(r.getByTestId('payment-event-hold')).toContainText('Held until');
    // Payer phone and the member's transaction ID are visible to admins on this page.
    await expect(r.getByTestId('member-reference')).toHaveText('QGH7XK2L9P');
    await expect(r.getByTestId('payer-phone')).toContainText('+255712345678');
    await expect(r.getByTestId('payment-open-order')).toHaveAttribute('href', /\/admin\/events\/?\?event=evt_pub&view=orders&order=ord_1$/);
    await expect(row(page, 'EV-2026-0004')).toContainText('Organisation');
    await expect(row(page, 'EV-2026-0008').getByTestId('payment-event-state')).toContainText('Event cancelled');
    // The pass/plan refund icon is never offered on event rows.
    await page.getByRole('button', { name: 'Approved' }).click();
    await expect(page.getByTestId('payment-refund')).toHaveCount(0);
    await expectNoRawKeys(page);
  });

  test('without the filter the whole list loads and the pass row keeps its refund icon', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: {} });
    await page.goto('/admin/payments/');
    await page.getByRole('button', { name: 'Approved' }).click();
    expect(mock.reads(/^\/admin\/payment-requests$/).every(c => !c.query.productType)).toBe(true);
    await expect(row(page, 'Baraka Mushi').getByTestId('payment-refund')).toHaveCount(1);
    await expect(row(page, 'EV-2026-0005').getByTestId('payment-refund')).toHaveCount(0);
  });

  test('approving needs the amount received, typed (empty by default), and sends it; the outcome is shown', async ({ page }) => {
    const mock = await QUEUE(page);
    await row(page, 'EV-2026-0001').getByTestId('payment-approve').click();
    const dialog = page.getByTestId('event-approve-dialog');
    await expect(dialog).toContainText('Expected amount');
    await expect(page.getByTestId('event-approve-expected')).toHaveText('TSh 50,000');
    await expect(page.getByTestId('event-approve-amount')).toHaveValue('');
    await expect(page.getByTestId('event-approve-confirm')).toBeDisabled();
    await expect(page.getByTestId('event-approve-reference')).toHaveValue('QGH7XK2L9P');
    await expect(page.getByTestId('event-approve-member-details')).toContainText('+255712345678');
    await page.getByTestId('event-approve-amount').fill('50000');
    await page.getByTestId('event-approve-confirm').click();
    await expect.poll(() => mock.writes(/\/decision$/).length).toBe(1);
    expect(mock.writes(/\/pr_ev1\/decision$/)[0].body).toEqual({ decision: 'approve', amountTzs: 50000, reference: 'QGH7XK2L9P' });
    await expect(page.getByTestId('payments-event-notice')).toContainText('Payment confirmed. 2 tickets issued.');
    await expect(row(page, 'EV-2026-0001')).toHaveCount(0); // no longer pending
  });

  test('a different amount is refused by the server: the expected amount shows in the dialog and nothing changes', async ({ page }) => {
    const mock = await QUEUE(page);
    await row(page, 'EV-2026-0001').getByTestId('payment-approve').click();
    await page.getByTestId('event-approve-amount').fill('49,000');
    await page.getByTestId('event-approve-confirm').click();
    await expect(page.getByTestId('event-approve-error')).toContainText('TSh 50,000');
    expect(mock.s4!.requests.find(r => r.id === 'pr_ev1')!.status).toBe('pending');
    await expect(page.getByTestId('event-approve-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row(page, 'EV-2026-0001')).toBeVisible();
  });

  test('a late payment shows what approving will do, and the actual outcome after: re-reserved, or a refund raised (never silent success)', async ({ page }) => {
    const mock = await QUEUE(page);
    await expect(row(page, 'EV-2026-0002').getByTestId('payment-event-state')).toContainText('Hold ended: late payment');
    await row(page, 'EV-2026-0002').getByTestId('payment-approve').click();
    await expect(page.getByTestId('event-approve-late-rehold')).toContainText('Approving will try to re-reserve the places');
    await page.getByTestId('event-approve-amount').fill('50000');
    await page.getByTestId('event-approve-confirm').click();
    await expect(page.getByTestId('payments-event-notice')).toContainText('Payment confirmed and places re-reserved.');
    await row(page, 'EV-2026-0003').getByTestId('payment-approve').click();
    await expect(page.getByTestId('event-approve-late-refund')).toContainText('a full refund of TSh 50,000 will be raised');
    await page.getByTestId('event-approve-amount').fill('50000');
    await page.getByTestId('event-approve-confirm').click();
    const notice = page.getByTestId('payments-event-notice');
    await expect(notice).toContainText('Payment recorded, places unavailable. A refund was raised.');
    await expect(page.getByTestId('payments-event-notice-link')).toHaveAttribute('href', /\/admin\/refunds\/?\?order=EV-2026-0003$/);
    expect(mock.s4!.refunds.some(r => r.id === 'rf_new' && r.scope === 'unfulfilled_payment')).toBe(true);
  });

  test('rejecting needs a reason code; "Other" needs the note for the member; the body carries the code and note', async ({ page }) => {
    const mock = await QUEUE(page);
    await row(page, 'EV-2026-0001').getByTestId('payment-reject').click();
    await expect(page.getByTestId('event-reject-confirm')).toBeDisabled();
    await page.getByTestId('event-reject-reason').selectOption('other');
    await expect(page.getByTestId('event-reject-confirm')).toBeDisabled();
    await expect(page.getByTestId('event-reject-dialog')).toContainText('The member sees this.');
    // Swahili note alone does not satisfy "Other": the English note is required (backend note_required).
    await page.getByTestId('event-reject-member-note-sw').fill('Imelipwa kwa namba nyingine');
    await expect(page.getByTestId('event-reject-confirm')).toBeDisabled();
    await page.getByTestId('event-reject-member-note').fill('Paid to another number');
    await page.getByTestId('event-reject-reason').selectOption('wrong_account');
    await expect(page.getByTestId('event-reject-confirm')).toBeEnabled();
    await page.getByTestId('event-reject-confirm').click();
    await expect.poll(() => mock.writes(/\/decision$/).length).toBe(1);
    expect(mock.writes(/\/decision$/)[0].body).toEqual({ decision: 'reject', reasonCode: 'wrong_account', memberNote: 'Paid to another number', memberNoteSw: 'Imelipwa kwa namba nyingine' });
    await expect(page.getByTestId('payments-event-notice')).toContainText('Payment rejected');
  });

  test('the five reason codes are offered', async ({ page }) => {
    await QUEUE(page);
    await row(page, 'EV-2026-0001').getByTestId('payment-reject').click();
    const opts = await page.getByTestId('event-reject-reason').locator('option').allTextContents();
    expect(opts).toEqual(['—', 'Transaction ID not found', 'Amount differs', 'Paid to a different number', 'Transaction ID already used', 'Other']);
  });

  test('two-admin approval: an unverified row cannot be approved; verifying hands it to a different admin; the verifier is blocked', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: { secondApprover: true } });
    mock.s4!.requests.find(r => r.id === 'pr_ev_org')!.verifiedBy = 'admin-9';
    mock.s4!.requests.find(r => r.id === 'pr_ev_org')!.verifiedByName = 'Grace Finance';
    await page.goto('/admin/payments/');
    await page.getByTestId('payments-kind-event_order').click();
    const r1 = row(page, 'EV-2026-0001');
    await expect(r1.getByTestId('payment-approve')).toBeDisabled();
    await expect(r1.getByTestId('payment-approve-hint')).toContainText('Verify');
    await r1.getByTestId('payment-verify').click();
    await expect(page.getByTestId('verify-event-facts')).toContainText('Arusha Trail 10K');
    await page.getByTestId('verify-submit').click();
    await expect.poll(() => mock.writes(/\/verify$/).length).toBe(1);
    // I verified it, so a different admin has to approve it.
    await expect(r1.getByTestId('payment-approve')).toBeDisabled();
    await expect(r1.getByTestId('payment-approve-hint')).toContainText('A different admin must approve it.');
    // Another admin verified the organisation's payment: approving is open and still needs the amount.
    const org = row(page, 'EV-2026-0004');
    await expect(org.getByTestId('payment-approve')).toBeEnabled();
    await org.getByTestId('payment-approve').click();
    await expect(page.getByTestId('event-approve-verified-by')).toContainText('Grace Finance');
    await page.getByTestId('event-approve-amount').fill('50000');
    await page.getByTestId('event-approve-confirm').click();
    await expect(page.getByTestId('payments-event-notice')).toContainText('Payment confirmed');
  });

  test('two-admin approval: the server refusal "you verified this" shows inside the dialog and writes nothing', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: { secondApprover: true } });
    // The row looks approvable to the page (verified by someone else) but the server knows the caller verified it.
    mock.s4!.requests.find(r => r.id === 'pr_ev1')!.verifiedBy = 'admin-9';
    await page.goto('/admin/payments/');
    await page.getByTestId('payments-kind-event_order').click();
    mock.s4!.requests.find(r => r.id === 'pr_ev1')!.verifiedBy = 'admin-1';
    await row(page, 'EV-2026-0001').getByTestId('payment-approve').click();
    await page.getByTestId('event-approve-amount').fill('50000');
    await page.getByTestId('event-approve-confirm').click();
    await expect(page.getByTestId('event-approve-error')).toContainText('A different admin must approve it');
    expect(mock.s4!.requests.find(r => r.id === 'pr_ev1')!.status).toBe('pending');
  });

  test('an approved payment whose order was not updated is flagged and repaired in one click', async ({ page }) => {
    const mock = await QUEUE(page);
    await page.getByRole('button', { name: 'Approved' }).click();
    const r = row(page, 'EV-2026-0005');
    await expect(r.getByTestId('payment-event-repair-badge')).toContainText('Confirmed, order not updated');
    await expect(page.locator('main')).toContainText('2 need attention');
    await r.getByTestId('payment-repair').click();
    await expect.poll(() => mock.writes(/\/repair-payment$/).length).toBe(1);
    expect(mock.writes(/\/repair-payment$/)[0].path).toBe('/admin/events/evt_pub/orders/ord_rep/repair-payment');
    await expect(page.getByTestId('payments-event-notice')).toContainText('Order updated.');
    await expect(r.getByTestId('payment-event-repair-badge')).toHaveCount(0);
  });

  test('a payment that needs attention shows the reason and links to its refund', async ({ page }) => {
    await QUEUE(page);
    await page.getByRole('button', { name: 'Approved' }).click();
    const r = row(page, 'EV-2026-0006');
    await expect(r.getByTestId('payment-event-attention')).toContainText('Needs attention');
    await expect(r.getByTestId('payment-event-attention')).toContainText('Places unavailable');
    await expect(r.getByRole('link', { name: 'View refunds' })).toHaveAttribute('href', /\/admin\/refunds\/?\?order=EV-2026-0006$/);
  });

  test('Swahili: the queue, approve and reject dialogs show no raw keys', async ({ page }) => {
    await QUEUE(page, SUPER_ADMIN, { locale: 'sw' });
    await expect(row(page, 'EV-2026-0001')).toContainText('TIKETI ZA TUKIO');
    await row(page, 'EV-2026-0001').getByTestId('payment-approve').click();
    await expect(page.getByTestId('event-approve-dialog')).toContainText('Kiasi kinachotarajiwa');
    await expect(page.getByTestId('event-approve-dialog')).toContainText('Kiasi kilichopokelewa (TSh)');
    await expect(page.getByTestId('event-approve-dialog')).not.toContainText(/payments\.event\./);
    await page.keyboard.press('Escape');
    await row(page, 'EV-2026-0001').getByTestId('payment-reject').click();
    await expect(page.getByTestId('event-reject-dialog')).toContainText('Namba ya muamala haikupatikana');
    await expect(page.getByTestId('event-reject-dialog')).not.toContainText(/payments\.event\./);
  });
});

test.describe('admin Refunds: event orders (§6.3, P-R-1, P-R-2)', () => {
  const open = async (page: Page, user = SUPER_ADMIN, s4: Parameters<typeof setupEvents>[2] extends infer O ? NonNullable<O>['s4'] : never = {}) => {
    const mock = await setupEvents(page, user, { s4 });
    await page.goto('/admin/refunds/');
    await page.getByTestId('refund-filter-all').click();
    return mock;
  };

  test('event rows show kind, scope, event and order; a policy approval says so', async ({ page }) => {
    await open(page);
    const r = row(page, 'EV-2026-0013');
    await expect(r).toContainText('Event tickets');
    await expect(r.getByTestId('refund-scope')).toHaveText('One ticket');
    await expect(r).toContainText('Arusha Trail 10K');
    await expect(row(page, 'EV-2026-0001')).toContainText('Approved by policy');
    await expect(row(page, 'EV-2026-0006').getByTestId('refund-scope')).toHaveText('Payment returned');
    await expect(row(page, 'EV-2026-0012')).toContainText('Organisation');
    await expectNoRawKeys(page);
  });

  test('a custom-policy request warns that approving cancels the place; the amount is limited to the request', async ({ page }) => {
    const mock = await open(page);
    await row(page, 'EV-2026-0007').getByTestId('refund-approve').click();
    await expect(page.getByTestId('refund-review-warning')).toContainText("Approving will cancel the member's place and revoke the ticket.");
    await expect(page.getByRole('dialog')).toContainText('Up to TSh 25,000');
    await page.getByRole('dialog').locator('input[inputmode="numeric"]').fill('30000');
    await page.getByTestId('refund-submit').click();
    await expect(page.getByRole('dialog')).toContainText('Enter an amount above zero and no more than was asked for.');
    await page.getByRole('dialog').locator('input[inputmode="numeric"]').fill('25000');
    await page.getByTestId('refund-submit').click();
    await expect.poll(() => mock.writes(/\/rf_review\/decision$/).length).toBe(2);
    expect(mock.writes(/\/rf_review\/decision$/).at(-1)!.body).toMatchObject({ decision: 'approve', amountTzs: 25000 });
  });

  test('the policy snapshot shows on approve; mark paid prefills the payer phone (and stays empty for an organisation)', async ({ page }) => {
    const mock = await open(page);
    await row(page, 'EV-2026-0016').getByTestId('refund-approve').click();
    await expect(page.getByTestId('refund-policy-line')).toContainText('Policy: Tiered refunds, 50% evaluated on');
    await expect(page.getByTestId('refund-review-warning')).toHaveCount(0); // a tiered policy decided the amount: nothing to review
    await page.keyboard.press('Escape');
    await page.getByTestId('refund-filter-approved').click();
    await row(page, 'EV-2026-0001').getByTestId('refund-paid').click();
    await expect(page.getByRole('dialog').locator('input').nth(1)).toHaveValue('+255712345678');
    await page.getByRole('dialog').locator('input').nth(0).fill('MPESA QX99');
    await page.getByTestId('refund-submit').click();
    await expect.poll(() => mock.writes(/\/rf_policy\/paid$/).length).toBe(1);
    expect(mock.writes(/\/rf_policy\/paid$/)[0].body).toEqual({ paymentReference: 'MPESA QX99', paidTo: '+255712345678' });
    await row(page, 'EV-2026-0012').getByTestId('refund-paid').click();
    await expect(page.getByRole('dialog').locator('input').nth(1)).toHaveValue('');
  });

  test('with a batch selected: summary strip; approve-all confirms the count and total and sends the expected totals', async ({ page }) => {
    const mock = await open(page, ADMIN_2);
    await page.getByTestId('refund-filter-batch').selectOption('evb_1');
    await expect(page.getByTestId('refund-batch-summary')).toContainText('3 refunds · TSh 100,000 · 2 requested · 1 approved · 0 sent');
    await page.getByTestId('refund-approve-all').click();
    await expect(page.getByRole('alertdialog')).toContainText('Approve 2 refunds totalling TSh 50,000?');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Approve all requested' }).click();
    await expect.poll(() => mock.writes(/batch-decision$/).length).toBe(1);
    expect(mock.writes(/batch-decision$/)[0].body).toEqual({ batchId: 'evb_1', decision: 'approve', expectedTotalTzs: 50000, expectedCount: 2 });
    await expect(page.getByTestId('refund-batch-summary')).toContainText('0 requested · 3 approved');
  });

  test('under two-admin approval the admin who started the batch cannot approve it, and the button says why', async ({ page }) => {
    const mock = await open(page, SUPER_ADMIN, { secondApprover: true });
    await page.getByTestId('refund-filter-batch').selectOption('evb_1');
    await expect(page.getByTestId('refund-approve-all')).toBeDisabled();
    await expect(page.getByTestId('refund-approve-all-hint')).toContainText('You raised this refund. A different admin must approve it.');
    expect(mock.writes(/batch-decision$/)).toHaveLength(0);
  });

  test('record payouts reports saved / not saved per row; failed rows stay open', async ({ page }) => {
    const mock = await open(page, ADMIN_2);
    await page.getByTestId('refund-filter-batch').selectOption('evb_1');
    // Approve the batch first so all three rows are approved and ready for a payout.
    await page.getByTestId('refund-approve-all').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Approve all requested' }).click();
    await expect(page.getByTestId('refund-batch-summary')).toContainText('3 approved');
    await page.getByTestId('refund-record-payouts').click();
    await page.getByTestId('refund-payout-ref-rf_b1').fill('MPESA B1');
    await page.getByTestId('refund-payout-ref-rf_b2').fill('MPESA B2');
    await page.getByTestId('refund-payout-ref-rf_b3').fill('BANK B3');
    // The server refuses one row (rf_b2 is no longer approved by the time the payouts arrive): the others are saved, this one is reported.
    mock.s4!.refunds.find(r => r.id === 'rf_b2')!.status = 'requested';
    await page.getByTestId('refund-payouts-submit').click();
    await expect.poll(() => mock.writes(/batch-paid$/).length).toBe(1);
    const body = mock.writes(/batch-paid$/)[0].body!;
    expect(body.batchId).toBe('evb_1');
    expect(body.items).toEqual([
      { refundId: 'rf_b1', paymentReference: 'MPESA B1', paidTo: '+255788000222' },
      { refundId: 'rf_b2', paymentReference: 'MPESA B2', paidTo: '+255755000111' },
      { refundId: 'rf_b3', paymentReference: 'BANK B3' },
    ]);
    await expect(page.getByTestId('refund-payout-result-rf_b1')).toContainText('Saved');
    await expect(page.getByTestId('refund-payout-result-rf_b2')).toContainText('Not saved');
    await expect(page.getByTestId('refund-payout-result-rf_b3')).toContainText('Saved');
  });

  test('an order link filters the list to that order', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { s4: {} });
    await page.goto('/admin/refunds/?order=EV-2026-0006');
    await expect(page.getByTestId('refund-filter-order')).toContainText('Order EV-2026-0006');
    await expect(page.getByRole('row').filter({ hasText: 'EV-2026' })).toHaveCount(1);
  });
});

test.describe('admin order panel and event cancellation (§6.4, §6.5, P-A-1, P-A-2)', () => {
  const orders = async (page: Page, user: Parameters<typeof setupEvents>[1] = SUPER_ADMIN, opts: Parameters<typeof setupEvents>[2] = {}) => {
    const mock = await setupEvents(page, user, { s4: {}, ...opts });
    await page.goto('/admin/events/?event=evt_pub&view=orders');
    return mock;
  };

  test('the panel shows the timeline, payer details with the payments scope, tickets and refunds', async ({ page }) => {
    await orders(page);
    await page.getByTestId('order-open-ord_2').click();
    const panel = page.getByTestId('order-payment-panel');
    await expect(panel.getByTestId('order-payment-state')).toHaveText('Confirmed');
    await expect(panel.getByTestId('order-payment-reference')).toHaveText('DONE000001');
    await expect(panel.getByTestId('order-payment-phone')).toHaveText('+255712345678');
    await expect(panel.getByTestId('order-payment-timeline')).toContainText('Submitted');
    await expect(panel.getByTestId('order-payment-timeline')).toContainText('Verified · Grace Finance');
    await expect(panel.getByTestId('order-payment-timeline')).toContainText('Approved · Admin One');
    await expect(panel.getByTestId('order-payment-timeline')).toContainText('Tickets issued');
    await expect(panel.getByTestId('order-tickets-summary')).toHaveText('3 issued, 0 cancelled');
    await expect(panel.getByTestId('order-payment-open-payments')).toBeVisible();
    // A ticket token or QR never shows here.
    await expect(page.getByTestId('admin-order-dialog')).not.toContainText(/FFEV1|qrPayload/);
  });

  test('staff with the events scope but not payments see the payer number masked and no link into Payments', async ({ page }) => {
    await orders(page, EVENTS_STAFF);
    await page.getByTestId('order-open-ord_2').click();
    const panel = page.getByTestId('order-payment-panel');
    await expect(panel.getByTestId('order-payment-masked')).toContainText('Payer phone hidden (needs Payments access)');
    await expect(panel.getByTestId('order-payment-phone')).toContainText('+255 7•• ••• 678');
    await expect(panel).not.toContainText('+255712345678');
    await expect(panel.getByTestId('order-payment-reference')).toHaveCount(0);
    await expect(panel.getByTestId('order-payment-open-payments')).toHaveCount(0);
  });

  test('cancelling a paid order needs a refund mode and a note, shows the amounts, and sends refundMode', async ({ page }) => {
    const mock = await orders(page);
    await page.getByTestId('order-open-ord_2').click();
    await expect(page.getByTestId('admin-refund-mode-full').locator('..')).toContainText('TSh 75,000');
    await expect(page.getByTestId('admin-refund-mode-policy').locator('..')).toContainText('TSh 37,500');
    await expect(page.getByTestId('admin-refund-mode-none').locator('..')).toContainText('TSh 0');
    await expect(page.getByTestId('admin-order-refund-mode')).toContainText('A second admin approves the refund.');
    await expect(page.getByTestId('admin-order-cancel')).toBeDisabled();
    await page.getByTestId('admin-refund-mode-full').check();
    await page.getByTestId('admin-order-cancel-note').fill('Organizer asked us to refund this order.');
    await page.getByTestId('admin-order-cancel').click();
    await expect.poll(() => mock.writes(/\/orders\/ord_2\/cancel$/).length).toBe(1);
    expect(mock.writes(/\/orders\/ord_2\/cancel$/)[0].body).toEqual({ note: 'Organizer asked us to refund this order.', refundMode: 'full' });
  });

  test('an approved payment that did not update the order shows Repair; a payment needing attention shows its reason and refund link', async ({ page }) => {
    const mock = await orders(page);
    await page.getByTestId('order-open-ord_rep').click();
    await expect(page.getByTestId('order-payment-repair-badge')).toContainText('Confirmed, order not updated');
    await page.getByTestId('order-payment-repair').click();
    await expect.poll(() => mock.writes(/repair-payment$/).length).toBe(1);
    await page.keyboard.press('Escape');
    await page.getByTestId('order-open-ord_attn').click();
    await expect(page.getByTestId('order-payment-attention')).toContainText('Places unavailable');
    await expect(page.getByTestId('order-payment-refund-link')).toHaveAttribute('href', /order=EV-2026-0006/);
    await expect(page.getByTestId('order-refunds')).toContainText('Payment returned');
  });

  test('a payment needing attention without a refund can raise one (unfulfilled payment) with a note', async ({ page }) => {
    const mock = await orders(page);
    await page.getByTestId('order-open-ord_attn2').click();
    await page.getByTestId('order-payment-raise-refund').click();
    await expect(page.getByTestId('order-payment-refund-confirm')).toBeDisabled();
    await page.getByTestId('order-payment-refund-note').fill('Order was cancelled; refund the payer.');
    await page.getByTestId('order-payment-refund-confirm').click();
    await expect.poll(() => mock.writes(/^\/admin\/refunds$/).length).toBe(1);
    expect(mock.writes(/^\/admin\/refunds$/)[0].body).toEqual({ eventPaymentId: 'evp_attn2', note: 'Order was cancelled; refund the payer.', reasonCode: 'payment_error' });
  });

  test('an order link from Payments opens that order straight away', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { s4: {} });
    await page.goto('/admin/events/?event=evt_pub&view=orders&order=ord_1');
    await expect(page.getByTestId('order-payment-panel')).toBeVisible();
    await expect(page.getByTestId('order-payment-state')).toHaveText('Under review');
  });

  test('cancelling an event with paid orders shows the numbers, defaults to raising refunds, repeats them, and ends on the batch', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: {} });
    await page.goto('/admin/events/?event=evt_pub');
    await page.getByTestId('admin-action-cancel').click();
    await expect(page.getByTestId('cancel-event-summary')).toHaveText('2 unpaid orders will be released. 3 paid orders (7 places, TSh 350,000) will be cancelled and their tickets revoked.');
    await expect(page.getByTestId('cancel-event-submitted')).toContainText('1 order has a payment waiting for review');
    await expect(page.getByTestId('cancel-event-raise')).toBeChecked();
    await expect(page.getByTestId('cancel-confirm')).toHaveText('Cancel event and raise refunds');
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByTestId('cancel-event-confirm-numbers')).toContainText('3 paid orders (7 places, TSh 350,000)');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel event and raise refunds' }).click();
    await expect.poll(() => mock.writes(/\/admin\/events\/evt_pub\/cancel$/).length).toBe(1);
    expect(mock.writes(/\/cancel$/)[0].body).toEqual({ reason: 'organizer_decision', note: { en: '', sw: '' }, refundPaidOrders: true, expectedRefundableTzs: 350000 });
    // The cancel answer carries no batch, so the idempotent batch route is asked for the numbers: with NO expected total (the pre-cancel figure is stale).
    await expect.poll(() => mock.writes(/refund-batch$/).length).toBe(1);
    expect(mock.writes(/refund-batch$/)[0].body).toEqual({});
    await expect(page.getByTestId('cancel-event-result')).toContainText('Event cancelled. 200 refunds raised.');
    await expect(page.getByTestId('cancel-event-remaining')).toContainText('150 orders still need refunds raised.');
    await expect(page.getByTestId('cancel-event-review')).toHaveAttribute('href', /\/admin\/refunds\/?\?batch=evb_9$/);
    // More than 200 orders: resuming after the first chunk must not resend the stale total (the live total dropped; the server would answer 409).
    await page.getByTestId('cancel-event-continue').click();
    await expect.poll(() => mock.writes(/refund-batch$/).length).toBe(2);
    expect(mock.writes(/refund-batch$/)[1].body).toEqual({});
    await expect(page.getByTestId('cancel-event-remaining')).toHaveCount(0);
    await expect(page.getByTestId('cancel-event-error')).toHaveCount(0);
    expect(mock.s4!.liveRefundable).toBe(0);
  });

  test('unchecking the refunds box cancels without raising them; refundable_changed refreshes the numbers and asks again', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: {} });
    let stale = true;
    mock.on('POST', /\/admin\/events\/evt_pub\/cancel$/, c => {
      if (stale && c.body?.refundPaidOrders === true) { stale = false; return { status: 409, json: { error: 'refundable_changed' } }; }
      return undefined;
    });
    await page.goto('/admin/events/?event=evt_pub');
    await page.getByTestId('admin-action-cancel').click();
    await page.getByTestId('cancel-confirm').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel event and raise refunds' }).click();
    await expect(page.getByTestId('cancel-event-error')).toContainText('The refund total changed while you were reading');
    await page.getByTestId('cancel-event-raise').uncheck();
    await expect(page.getByTestId('cancel-confirm')).toHaveText('Cancel event');
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByRole('alertdialog')).toContainText('No refunds will be raised.');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel event' }).click();
    await expect.poll(() => mock.writes(/\/admin\/events\/evt_pub\/cancel$/).length).toBe(2);
    expect(mock.writes(/\/cancel$/)[1].body).toEqual({ reason: 'organizer_decision', note: { en: '', sw: '' }, refundPaidOrders: false, expectedRefundableTzs: 350000 });
    await expect(page.getByTestId('cancel-event-result')).toContainText('Event cancelled.');
    await expect(page.getByTestId('cancel-event-result')).not.toContainText('refunds raised');
    expect(mock.writes(/refund-batch$/)).toHaveLength(0);
  });

  test('an organizer whose event has registrations is told to contact FitFlex, which handles the refunds', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s4: {} });
    mock.on('POST', /\/organizer\/events\/evt_pub\/cancel$/, () => ({ status: 409, json: { error: 'has_registrations' } }));
    await page.goto('/organizer/events/');
    await page.getByTestId('events-more-evt_pub').click();
    await page.getByTestId('row-action-cancel').click();
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByTestId('cancel-has-registrations')).toContainText('Ask FitFlex to cancel it.');
    await expect(page.getByTestId('cancel-has-registrations')).toContainText('Contact FitFlex to cancel an event that has paid registrations. FitFlex handles the refunds.');
  });
});

test.describe('organizer Finance tab (§6.6, D25, D28, P-O-1, P-O-2)', () => {
  test('visible to owner and finance; shows the totals, ticket table, payout-not-live note and the privacy line; never payer data', async ({ page }) => {
    await setupEvents(page, STAFF_FINANCE, { s4: { financeLeak: true }, me: organizerMe('active', 'finance') });
    await page.goto('/organizer/events/?event=evt_pub&view=finance');
    const fin = page.getByTestId('organizer-finance');
    await expect(fin.getByTestId('finance-paid')).toContainText('TSh 1,200,000');
    await expect(fin.getByTestId('finance-refunded')).toContainText('TSh 100,000');
    await expect(fin.getByTestId('finance-refund-pending')).toContainText('TSh 50,000');
    await expect(fin.getByTestId('finance-awaiting')).toContainText('TSh 75,000');
    await expect(fin.getByTestId('finance-commission')).toContainText('FitFlex commission (10%)');
    await expect(fin.getByTestId('finance-commission')).toContainText('TSh 105,000');
    await expect(fin.getByTestId('finance-net')).toContainText('TSh 945,000');
    await expect(fin.getByRole('region', { name: 'By ticket type' })).toContainText('Early bird');
    await expect(fin.getByRole('region', { name: 'By ticket type' })).toContainText('TSh 1,000,000');
    await expect(fin).toContainText('Payout statements are not live yet.');
    await expect(page.getByTestId('finance-privacy')).toHaveText('Payer details are never shown to organizers.');
    // D28: no promise about when the organizer is paid.
    await expect(fin).not.toContainText(/within|weekly|after the event|days/i);
    // Totals only: nothing the server should not have sent is rendered, whatever it sent.
    const text = await page.locator('main').innerText();
    for (const leak of ['0712999888', 'LEAKTXN001', 'EV-LEAK-1', 'Leaky Payer']) expect(text).not.toContain(leak);
    await expectNoRawKeys(page);
  });

  test('finance staff see the Finance tab beside Orders', async ({ page }) => {
    await setupEvents(page, STAFF_FINANCE, { s4: {}, me: organizerMe('active', 'finance') });
    await page.goto('/organizer/events/?event=evt_pub&view=orders');
    await expect(page.getByTestId('event-view-tabs').getByText('Finance')).toBeVisible();
  });

  test('ops does not see the tab or the data', async ({ page }) => {
    const mock = await setupEvents(page, STAFF_OPS, { s4: {}, me: organizerMe('active', 'ops') });
    await page.goto('/organizer/events/?event=evt_pub&view=registrations');
    await expect(page.getByTestId('event-view-tabs').getByText('Finance')).toHaveCount(0);
    await page.goto('/organizer/events/?event=evt_pub&view=finance');
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
    expect(mock.reads(/\/finance$/)).toHaveLength(0);
  });

  test('empty, once-published, error with retry and not-available states', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s4: { financeEmpty: true } });
    await page.goto('/organizer/events/?event=evt_pub&view=finance');
    await expect(page.getByTestId('finance-empty')).toContainText('No payments yet. Totals appear once participants pay.');
    await expect(page.getByTestId('finance-metrics')).toHaveCount(0);
    await page.goto('/organizer/events/?event=evt_1&view=finance');
    await expect(page.getByTestId('finance-not-published')).toBeVisible();
    let fail = true;
    mock.on('GET', /\/organizer\/events\/evt_pub\/finance$/, () => (fail ? { status: 500, json: { error: 'boom' } } : undefined));
    await page.goto('/organizer/events/?event=evt_pub&view=finance');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('finance-empty')).toBeVisible();
    mock.on('GET', /\/organizer\/events\/evt_pub\/finance$/, () => ({ status: 404, json: { error: 'feature_disabled' } }));
    await page.getByTestId('finance-refresh').click().catch(() => undefined);
    await page.goto('/organizer/events/?event=evt_pub&view=finance');
    await expect(page.getByTestId('events-unavailable')).toBeVisible();
  });

  test('the Orders tab status filter gains the paid-order states and the footer text changes; Swahili labels resolve', async ({ page }) => {
    await setupEvents(page, OWNER, { s4: {}, locale: 'sw' });
    await page.goto('/organizer/events/?event=evt_pub&view=finance');
    await expect(page.getByTestId('organizer-finance')).toContainText('Zilizolipwa');
    await expect(page.getByTestId('organizer-finance')).toContainText('Taarifa za mlipaji hazionyeshwi kamwe kwa waandaaji.');
    await expectNoRawKeys(page);
    await page.goto('/organizer/events/?event=evt_pub&view=orders');
    await expect(page.getByTestId('orders-filter-status')).toBeVisible();
    const values = await page.getByTestId('orders-filter-status').locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value));
    expect(values).toEqual(['', 'awaiting_payment', 'confirmed', 'partially_cancelled', 'refund_pending', 'refunded', 'cancelled', 'expired']);
    await expect(page.getByTestId('orders-footer')).toHaveText('Jumla ni kile wanunuzi walicholipa. Taarifa ya malipo yako itakuja kwenye toleo la baadaye.');
  });
});

test.describe('wizard Terms step: refund presets (§6.7, D24, P-W-1)', () => {
  test('all five presets are offered; full-until-N-days takes whole days 1 to 365 and shows the sentence members read', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s4: {} });
    await page.goto('/organizer/events/?event=evt_1&step=terms');
    for (const p of ['no_refund', 'refund_until_close', 'full_until_days', 'tiered', 'custom']) await expect(page.getByTestId(`ev-policy-${p}`)).toBeVisible();
    await page.getByTestId('ev-policy-full_until_days').check();
    await expect(page.getByTestId('ev-policyDays')).toBeVisible();
    await page.getByTestId('ev-policyDays').fill('400');
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('ev-refund-policy')).toContainText('Enter a number from 1 to 365.');
    await page.getByTestId('ev-policyDays').fill('14');
    await expect(page.getByTestId('ev-policy-generated')).toHaveValue('Full refund until 14 days before the event. No refund after that.', { timeout: 15_000 });
    await expect.poll(() => mock.writes(/\/organizer\/events\/evt_1$/).length).toBeGreaterThanOrEqual(1);
    await page.getByTestId('wizard-next').click();
    const last = mock.writes(/\/organizer\/events\/evt_1$/).at(-1)!.body!;
    expect(last.refundPolicy).toEqual({ preset: 'full_until_days', text: null, days: 14 });
    expect(JSON.stringify(last.refundPolicy)).not.toContain('tiers');
  });

  test('tiered: up to three steps; days must fall and percent must not rise; the sentence appears once valid, in the active language', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s4: {} });
    await page.goto('/organizer/events/?event=evt_1&step=terms');
    await page.getByTestId('ev-policy-tiered').check();
    await expect(page.getByTestId('ev-tier-0')).toBeVisible();
    await expect(page.getByTestId('ev-refund-policy')).toContainText('100% until 30 days before, 50% until 14 days before, then no refund');
    await page.getByTestId('ev-tier-0-days').fill('30');
    await page.getByTestId('ev-tier-0-percent').fill('100');
    await page.getByTestId('ev-tier-add').click();
    await page.getByTestId('ev-tier-1-days').fill('40');
    await page.getByTestId('ev-tier-1-percent').fill('50');
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('ev-tier-1')).toContainText('Days must be fewer than the step above.');
    await page.getByTestId('ev-tier-1-days').fill('14');
    await page.getByTestId('ev-tier-add').click();
    await page.getByTestId('ev-tier-2-days').fill('3');
    await page.getByTestId('ev-tier-2-percent').fill('80');
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('ev-tier-2')).toContainText("Percent can't be higher than the step above.");
    await page.getByTestId('ev-tier-2-percent').fill('25');
    await expect(page.getByTestId('ev-tier-add')).toHaveCount(0); // three is the most
    await expect(page.getByTestId('ev-policy-generated')).toHaveValue('100% refund until 30 days before the event. 50% refund until 14 days before the event. 25% refund until 3 days before the event. No refund after that.', { timeout: 15_000 });
    await page.getByTestId('ev-tier-2-remove').click();
    await expect(page.getByTestId('ev-tier-add')).toBeVisible();
    await page.getByTestId('ev-tier-add').click();
    await page.getByTestId('ev-tier-2-days').fill('3');
    await page.getByTestId('ev-tier-2-percent').fill('25');
    await page.getByTestId('wizard-next').click();
    await expect.poll(() => mock.writes(/\/organizer\/events\/evt_1$/).length).toBeGreaterThanOrEqual(1);
    const last = mock.writes(/\/organizer\/events\/evt_1$/).at(-1)!.body!;
    expect(last.refundPolicy).toEqual({ preset: 'tiered', text: null, tiers: [{ daysBefore: 30, percent: 100 }, { daysBefore: 14, percent: 50 }, { daysBefore: 3, percent: 25 }] });
  });

  test('Swahili: the sentence members read follows the language; the counsel-draft banner shows', async ({ page }) => {
    await setupEvents(page, OWNER, { s4: {}, locale: 'sw' });
    await page.goto('/organizer/events/?event=evt_1&step=terms');
    await page.getByTestId('ev-policy-full_until_days').check();
    await page.getByTestId('ev-policyDays').fill('7');
    await expect(page.getByTestId('ev-policy-generated')).toHaveValue('Marejesho kamili hadi siku 7 kabla ya tukio. Hakuna marejesho baada ya hapo.', { timeout: 15_000 });
    await expect(page.getByTestId('ev-refund-policy')).toContainText('Maandishi ya sera ya marejesho ni rasimu inayosubiri ukaguzi wa wakili wa Tanzania.');
    await expectNoRawKeys(page);
  });

  test('a server refusal on the refund policy shows an inline sentence (never a raw key)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s4: {} });
    mock.on('PATCH', /\/organizer\/events\/evt_1$/, c => (c.body?.refundPolicy?.preset === 'tiered'
      ? { status: 422, json: { error: 'event_invalid', fields: [{ path: 'refundPolicy.tiers[0].percent', code: 'weird_server_code' }] } } : undefined));
    await page.goto('/organizer/events/?event=evt_1&step=terms');
    await page.getByTestId('ev-policy-tiered').check();
    await page.getByTestId('ev-tier-0-days').fill('10');
    await page.getByTestId('ev-tier-0-percent').fill('100');
    // The autosave is refused by the server (422 event_invalid with a code the portal has no text for).
    await expect(page.getByTestId('ev-tier-0')).toContainText('This refund policy is not valid');
    await expectNoRawKeys(page);
  });

  test('the review step shows the generated sentence', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { s4: {} });
    await page.goto('/admin/events/?event=evt_pub');
    // The published fixture uses no_refund: the review summary shows its sentence.
    await expect(page.getByTestId('review-policy-line')).toHaveText('No refunds.');
  });
});

test.describe('corporate order payment (§6.8, P-C-1, P-C-2)', () => {
  const open = async (page: Page, id: string, roles = ['owner'], opts: NonNullable<Parameters<typeof setupEvents>[2]>['s4'] = {}) => {
    const mock = await setupEvents(page, orgUser(roles), { s4: opts });
    await page.goto(`/org/events/?order=${id}`);
    await expect(page.getByTestId('corp-order-detail')).toBeVisible();
    return mock;
  };

  test('a billing user sees how to pay (reference, amount, bank, Lipa Namba) and sends "I\'ve paid" with an Idempotency-Key and only the spec fields', async ({ page }) => {
    const mock = await open(page, 'ord_c_new');
    const how = page.getByTestId('corp-pay-howto');
    await expect(how).toContainText('How to pay');
    await expect(page.getByTestId('corp-pay-ref')).toHaveText('EV-2026-0021');
    await expect(page.getByTestId('corp-pay-amount')).toHaveText('TSh 50,000');
    await expect(page.getByTestId('corp-pay-bank')).toHaveText('CRDB Bank');
    await expect(page.getByTestId('corp-pay-account-number')).toHaveText('0150123456700');
    await expect(page.getByTestId('corp-pay-lipa')).toHaveText('5123456');
    await expect(how).toContainText('use the order reference EV-2026-0021 as the payment reference');
    await expect(page.getByTestId('corp-pay-form')).toContainText('Manual confirmation: FitFlex finance checks payments');
    await expect(page.getByTestId('corp-pay-submit')).toBeDisabled();
    await page.getByTestId('corp-pay-reference').fill('CRDB-TRF-00917');
    await page.getByTestId('corp-pay-paid-on').fill('2999-01-01');
    await expect(page.getByTestId('corp-pay-submit')).toBeDisabled(); // not in the future
    await page.getByTestId('corp-pay-paid-on').fill('2026-10-27');
    await page.getByTestId('corp-pay-note').fill('Paid by Safari Cover finance');
    await page.getByTestId('corp-pay-submit').click();
    await expect.poll(() => mock.writes(/\/payment$/).length).toBe(1);
    const w = mock.writes(/\/payment$/)[0];
    expect(w.body).toEqual({ method: 'bank_transfer', reference: 'CRDB-TRF-00917', paidOn: '2026-10-27', note: 'Paid by Safari Cover finance' });
    expect(w.headers!['idempotency-key']).toMatch(/^pay_[A-Za-z0-9._:-]{8,}$/);
    await expect(page.getByTestId('corp-pay-submitted')).toContainText('Payment sent for checking');
    await expect(page.getByTestId('corp-pay-submitted-ref')).toHaveText('CRDB-TRF-00917');
    await expect(page.getByTestId('corp-order-cancel')).toHaveCount(0); // no cancel while the payment is being checked
    await expect(page.getByTestId('corp-pay-form')).toHaveCount(0);
  });

  test('printing the payment summary uses the browser print', async ({ page }) => {
    await page.addInitScript(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed += 1; }; });
    await open(page, 'ord_c_new');
    await page.getByTestId('corp-pay-print').click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  });

  test('a people-only role sees the billing notice and no form; missing bank details disable the form', async ({ page }) => {
    await open(page, 'ord_c_new', ['hr']);
    await expect(page.getByTestId('corp-pay-billing-gate')).toContainText('A billing user (owner, admin or finance) pays for this order.');
    await expect(page.getByTestId('corp-pay-form')).toHaveCount(0);
  });

  test('payment details not configured: the card says so and the form is disabled (never an empty Lipa Namba)', async ({ page }) => {
    await open(page, 'ord_c_new', ['owner'], { noOrgInstructions: true });
    await expect(page.getByTestId('corp-pay-not-configured')).toContainText('Payment details are not available yet. Contact FitFlex.');
    await expect(page.getByTestId('corp-pay-reference')).toBeDisabled();
    await expect(page.getByTestId('corp-pay-submit')).toBeDisabled();
    await expect(page.getByTestId('corp-pay-lipa')).toHaveCount(0);
  });

  test('a rejected payment shows the reason and note and brings the form back prefilled', async ({ page }) => {
    const mock = await open(page, 'ord_c_rej');
    await expect(page.getByTestId('corp-pay-rejected')).toContainText('Transaction ID not found');
    await expect(page.getByTestId('corp-pay-rejected')).toContainText('No such transfer on the statement');
    await expect(page.getByTestId('corp-pay-reference')).toHaveValue('CRDB-TRF-00917');
    await page.getByTestId('corp-pay-reference').fill('CRDB-TRF-00918');
    await page.getByTestId('corp-pay-submit').click();
    await expect.poll(() => mock.writes(/\/payment$/).length).toBe(1);
    expect(mock.writes(/\/payment$/)[0].body!.reference).toBe('CRDB-TRF-00918');
  });

  test('the same Idempotency-Key is reused on a retry after a server error', async ({ page }) => {
    const mock = await open(page, 'ord_c_new');
    let first = true;
    mock.on('POST', /\/ord_c_new\/payment$/, () => { if (first) { first = false; return { status: 503, json: { error: 'tickets_unavailable' } }; } return undefined; });
    await page.getByTestId('corp-pay-reference').fill('CRDB-TRF-00917');
    await page.getByTestId('corp-pay-paid-on').fill('2026-10-27');
    await page.getByTestId('corp-pay-submit').click();
    await expect(page.getByTestId('corp-pay-error')).toContainText('Payments are paused for now');
    await page.getByTestId('corp-pay-submit').click();
    await expect.poll(() => mock.writes(/\/payment$/).length).toBe(2);
    const keys = mock.writes(/\/payment$/).map(c => c.headers!['idempotency-key']);
    expect(keys[0]).toBe(keys[1]);
    await expect(page.getByTestId('corp-pay-submitted')).toBeVisible();
  });

  test('expired inside the grace window: "I already paid" shows the late warning and the form; expired with a submitted payment says what happens', async ({ page }) => {
    const mock = await open(page, 'ord_c_exp');
    await expect(page.getByTestId('corp-pay-form')).toHaveCount(0);
    await page.getByTestId('corp-pay-already-paid').click();
    await expect(page.getByTestId('corp-pay-form')).toContainText('The hold ended. The places are re-reserved if they are still free; otherwise you are refunded in full.');
    await page.getByTestId('corp-pay-reference').fill('CRDB-TRF-00555');
    await page.getByTestId('corp-pay-paid-on').fill('2026-10-27');
    await page.getByTestId('corp-pay-submit').click();
    await expect.poll(() => mock.writes(/\/payment$/).length).toBe(1);
    await page.goto('/org/events/?order=ord_c_expsub');
    await expect(page.getByTestId('corp-pay-expired-submitted')).toContainText("We'll try to re-reserve your places; if they are gone we'll refund you in full.");
  });

  test('payments off (options say none): the S3 placeholder stays and no payment form shows', async ({ page }) => {
    await open(page, 'ord_c_new', ['owner'], { payment: 'none' });
    await expect(page.getByTestId('corp-order-pay-soon')).toBeVisible();
    await expect(page.getByTestId('corp-pay-form')).toHaveCount(0);
  });

  test('confirmed: success notice, invitation column, "Send again" warns the old link stops, and the daily limit shows', async ({ page }) => {
    const mock = await open(page, 'ord_c_conf');
    await expect(page.getByTestId('corp-pay-confirmed')).toContainText('Payment confirmed. Employees are invited to claim their places by SMS or email.');
    await expect(page.getByTestId('corp-invited-reg_2')).toBeVisible();
    await expect(page.getByTestId('corp-nocontact-reg_3')).toHaveText('No contact');
    await expect(page.getByTestId('corp-resend-reg_1')).toHaveCount(0); // claimed
    await expect(page.getByTestId('corp-resend-reg_3')).toHaveCount(0); // no contact
    await page.getByTestId('corp-resend-reg_2').click();
    await expect(page.getByRole('alertdialog')).toContainText('This creates a new link. The old link stops working.');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Send again' }).click();
    await expect.poll(() => mock.writes(/claim-invitations$/).length).toBe(1);
    expect(mock.writes(/claim-invitations$/)[0].body).toEqual({ registrationId: 'reg_2' });
    await page.getByTestId('corp-resend-reg_2').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Send again' }).click();
    await expect(page.getByText('The invitation was sent too many times. Try again tomorrow.')).toBeVisible();
    // Contact columns stay masked.
    await expect(page.getByTestId('corp-order-detail')).not.toContainText('0755000111');
  });

  test('cancelling a paid order: the preview states the policy and refund, a reason is required, expectedRefundTzs is sent; the refund card follows', async ({ page }) => {
    const mock = await open(page, 'ord_c_conf');
    await page.getByTestId('corp-order-cancel-paid').click();
    await expect(page.getByTestId('corp-cancel-refund')).toContainText('TSh 25,000 (50%)');
    await expect(page.getByTestId('corp-cancel-policy')).toContainText('Full refund until 30 days before');
    await expect(page.getByTestId('corp-cancel-confirm')).toBeDisabled();
    await page.getByTestId('corp-cancel-reason').selectOption('changed_mind');
    await page.getByTestId('corp-cancel-confirm').click();
    await expect.poll(() => mock.writes(/\/ord_c_conf\/cancel$/).length).toBe(1);
    expect(mock.writes(/\/ord_c_conf\/cancel$/)[0].body).toEqual({ reason: 'changed_mind', expectedRefundTzs: 25000 });
    await expect(page.getByTestId('corp-refund-card')).toContainText('TSh 25,000');
    await expect(page.getByTestId('corp-refund-card')).toContainText('Refunds go to your organisation.');
  });

  test('a refund that moved while the dialog was open is refused with the new amount asked again (refund_changed)', async ({ page }) => {
    const mock = await open(page, 'ord_c_conf');
    mock.on('POST', /\/ord_c_conf\/cancel$/, () => ({ status: 409, json: { error: 'refund_changed', refundTzs: 0 } }));
    await page.getByTestId('corp-order-cancel-paid').click();
    await page.getByTestId('corp-cancel-reason').selectOption('other');
    await page.getByTestId('corp-cancel-confirm').click();
    await expect(page.getByTestId('corp-cancel-notice')).toContainText('The refund amount changed');
  });

  test('a no-refund outcome needs an explicit acknowledgement', async ({ page }) => {
    const mock = await open(page, 'ord_c_conf');
    mock.on('GET', /\/ord_c_conf\/cancel-preview$/, () => ({ eligible: true, mode: 'none', percent: 0, paidTzs: 50000, refundTzs: 0, currency: 'TZS', deadlineAt: null, policy: { preset: 'no_refund', text: { en: 'No refunds.', sw: 'Hakuna marejesho.' } }, releaseInventory: false, blocked: null }));
    await page.getByTestId('corp-order-cancel-paid').click();
    await page.getByTestId('corp-cancel-reason').selectOption('other');
    await expect(page.getByTestId('corp-cancel-confirm')).toBeDisabled();
    await page.getByTestId('corp-cancel-ack').check();
    await expect(page.getByTestId('corp-cancel-confirm')).toBeEnabled();
  });

  test('refund pending: the order shows the pill and the refund card; Swahili has no raw keys', async ({ page }) => {
    await setupEvents(page, orgUser(['owner']), { s4: {}, locale: 'sw' });
    await page.goto('/org/events/?order=ord_c_ref');
    await expect(page.getByTestId('corp-order-detail')).toContainText('Inasubiri marejesho');
    await expect(page.getByTestId('corp-refund-card')).toContainText('Marejesho huenda kwa shirika lenu.');
    await page.goto('/org/events/?order=ord_c_new');
    await expect(page.getByTestId('corp-pay-howto')).toContainText('Jinsi ya kulipa');
    await expect(page.getByTestId('corp-pay-submit')).toHaveText('Tumelipa · Tuma ikaguliwe');
    await expectNoRawKeys(page);
  });
});

// ── Review round (contract check + Swahili audit of PR #161) ──
test.describe('review fixes: real backend shapes and scope rules', () => {
  const EVENTS_ONLY = { id: 'admin-5', userType: 'admin', portalUser: true, aclPermissions: ['events'] };

  test('an events-only admin can cancel and raise refunds but sees no resume or Review refunds control', async ({ page }) => {
    const mock = await setupEvents(page, EVENTS_ONLY, { s4: {} });
    await page.goto('/admin/events/?event=evt_pub');
    await page.getByTestId('admin-action-cancel').click();
    await page.getByTestId('cancel-confirm').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel event and raise refunds' }).click();
    await expect(page.getByTestId('cancel-event-result')).toBeVisible();
    // Resume, batch decision and payouts need the payments scope: the call is not even made.
    expect(mock.writes(/refund-batch$/)).toHaveLength(0);
    await expect(page.getByTestId('cancel-event-continue')).toHaveCount(0);
    await expect(page.getByTestId('cancel-event-review')).toHaveCount(0);
  });

  test('a 403 forbidden on resuming the batch shows a sentence, not a raw key', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: {} });
    await page.goto('/admin/events/?event=evt_pub');
    await page.getByTestId('admin-action-cancel').click();
    await page.getByTestId('cancel-confirm').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel event and raise refunds' }).click();
    await expect(page.getByTestId('cancel-event-continue')).toBeVisible();
    mock.on('POST', /refund-batch$/, () => ({ status: 403, json: { error: 'forbidden' } }));
    await page.getByTestId('cancel-event-continue').click();
    await expect(page.getByTestId('cancel-event-result')).toContainText('needs the Payments permission');
  });

  test('refund mode "none" is hidden without the payments scope; "per policy" is off for a custom policy', async ({ page }) => {
    await setupEvents(page, EVENTS_ONLY, { s4: {} });
    await page.goto('/admin/events/?event=evt_pub&view=orders');
    await page.getByTestId('order-open-ord_2').click();
    await expect(page.getByTestId('admin-refund-mode-full')).toBeVisible();
    await expect(page.getByTestId('admin-refund-mode-none')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('order-open-ord_cust').click();
    await expect(page.getByTestId('admin-refund-mode-policy')).toBeDisabled();
    await expect(page.getByTestId('admin-refund-mode-full')).toBeChecked();
  });

  test('policy_not_evaluable and payments_scope_required are mapped to sentences', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: {} });
    await page.goto('/admin/events/?event=evt_pub&view=orders');
    await page.getByTestId('order-open-ord_2').click();
    mock.on('POST', /ord_2\/cancel$/, () => ({ status: 403, json: { error: 'payments_scope_required' } }));
    await page.getByTestId('admin-order-cancel-note').fill('Organizer asked us to refund this order.');
    await page.getByTestId('admin-order-cancel').click();
    await expect(page.getByText('Refunding nothing needs the Payments permission', { exact: false })).toBeVisible();
  });

  test('staff data comes from paymentPanel.payments[] (status, not state): pill, attention reason and the new failure reasons', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { s4: {} });
    await page.goto('/admin/events/?event=evt_pub&view=orders');
    await page.getByTestId('order-open-ord_attn3').click();
    await expect(page.getByTestId('order-payment-state')).toHaveText('Needs attention');
    await expect(page.getByTestId('order-payment-attention')).toContainText('Order was already paid');
    await page.keyboard.press('Escape');
    await page.getByTestId('order-open-ord_2').click();
    await expect(page.getByTestId('order-payment-state')).toHaveText('Confirmed');
    await expect(page.getByTestId('order-tickets-summary')).toHaveText('3 issued, 0 cancelled');
  });

  test('an event payment change request offers only rejected to approved; a cancelled event payment offers none', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: { secondApprover: true } });
    await page.goto('/admin/payments/');
    await page.getByTestId('payments-kind-event_order').click();
    await page.getByRole('button', { name: 'Rejected' }).click();
    await row(page, 'EV-2026-0017').getByTestId('payment-request-change').click();
    const opts = await page.getByTestId('change-status').locator('option').allTextContents();
    expect(opts).toEqual(['Choose a status', 'Approved']);
    await page.getByTestId('change-status').selectOption('approved');
    await page.getByTestId('change-reason').fill('Rejected by mistake');
    await page.getByTestId('change-submit').click();
    await expect.poll(() => mock.writes(/change-request$/).length).toBe(1);
    await page.getByRole('button', { name: 'Cancelled' }).click();
    await expect(row(page, 'EV-2026-0018').getByTestId('payment-request-change')).toHaveCount(0);
  });

  test('event_payment_change_not_allowed shows a sentence in the dialog', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: { secondApprover: true } });
    await page.goto('/admin/payments/');
    await page.getByTestId('payments-kind-event_order').click();
    await page.getByRole('button', { name: 'Rejected' }).click();
    await row(page, 'EV-2026-0017').getByTestId('payment-request-change').click();
    mock.on('POST', /change-request$/, () => ({ status: 409, json: { error: 'event_payment_change_not_allowed' } }));
    await page.getByTestId('change-status').selectOption('approved');
    await page.getByTestId('change-reason').fill('Mistake');
    await page.getByTestId('change-submit').click();
    await expect(page.getByRole('dialog')).toContainText('Only a rejected payment can be approved by a change request');
  });

  test('the reject dialog sends memberNoteSw next to memberNote', async ({ page }) => {
    const mock = await QUEUE(page);
    await row(page, 'EV-2026-0001').getByTestId('payment-reject').click();
    await page.getByTestId('event-reject-reason').selectOption('other');
    await page.getByTestId('event-reject-member-note').fill('Please check the ID');
    await page.getByTestId('event-reject-member-note-sw').fill('Tafadhali kagua namba');
    await page.getByTestId('event-reject-confirm').click();
    await expect.poll(() => mock.writes(/\/decision$/).length).toBe(1);
    expect(mock.writes(/\/decision$/)[0].body).toEqual({ decision: 'reject', reasonCode: 'other', memberNote: 'Please check the ID', memberNoteSw: 'Tafadhali kagua namba' });
  });

  test('corporate: the payment form shows while next.payment is provider (Tunzaa on), and a "none" payment prefills the form', async ({ page }) => {
    const mock = await setupEvents(page, orgUser(['owner']), { s4: { payment: 'provider' } });
    await page.goto('/org/events/?order=ord_c_new');
    await expect(page.getByTestId('corp-pay-form')).toBeVisible();
    // PaymentView.state "none" is not "submitted": no under-review card; the last method and date prefill the form.
    await expect(page.getByTestId('corp-pay-submitted')).toHaveCount(0);
    await expect(page.getByTestId('corp-pay-paid-on')).toHaveValue('2026-10-27');
    await expect(page.getByTestId('corp-pay-method')).toHaveValue('bank_transfer');
    await page.getByTestId('corp-pay-reference').fill('CRDB-TRF-00917');
    await page.getByTestId('corp-pay-submit').click();
    await expect.poll(() => mock.writes(/\/payment$/).length).toBe(1);
  });

  test('registration status refunded reads Refunded / Imerejeshwa', async ({ page }) => {
    await setupEvents(page, orgUser(['owner']), { s4: {} });
    await page.goto('/org/events/?order=ord_c_ref');
    await expect(page.getByTestId('corp-order-detail')).not.toContainText(/events\.regStatus/);
  });

  test('invitation: the nested invitation is read when the flat fields are absent', async ({ page }) => {
    const mock = await setupEvents(page, orgUser(['owner']), { s4: {} });
    mock.s4!.corp.ord_c_conf.registrations.forEach((r: Record<string, unknown>) => { delete r.claimInvitedAt; delete r.claimInviteCount; delete r.hasContact; });
    await page.goto('/org/events/?order=ord_c_conf');
    await expect(page.getByTestId('corp-invited-reg_2')).toBeVisible();
    await expect(page.getByTestId('corp-nocontact-reg_3')).toHaveText('No contact');
  });

  test('Swahili: times use the 12-hour clock with the part of the day; wording follows the audit', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { s4: {}, locale: 'sw' });
    await page.goto('/admin/events/?event=evt_pub&view=orders');
    await page.getByTestId('order-open-ord_2').click();
    const panel = page.getByTestId('order-payment-panel');
    await expect(panel.getByTestId('order-payment-timeline')).toContainText(/\d{1,2}:\d{2} (asubuhi|mchana|jioni|usiku)/);
    await expect(panel.getByTestId('order-payment-timeline')).not.toContainText(/\b(1[3-9]|2[0-3]):\d{2}\b/);
    await expect(panel.getByTestId('order-payment-timeline')).toHaveAttribute('aria-label', 'Hatua za malipo');
    await expect(page.getByTestId('admin-order-refund-mode')).toContainText('Admin wa pili ataidhinisha marejesho.');
  });

  test('Swahili: the finance time reads "Kufikia"', async ({ page }) => {
    await setupEvents(page, OWNER, { s4: {}, locale: 'sw' });
    await page.goto('/organizer/events/?event=evt_pub&view=finance');
    await expect(page.getByTestId('finance-as-of')).toContainText(/Kufikia .*\d{1,2}:\d{2} (asubuhi|mchana|jioni|usiku)/);
  });

  test('Swahili plural-safe strings: one and many', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { s4: {}, locale: 'sw' });
    await page.goto('/admin/events/?event=evt_pub');
    await page.getByTestId('admin-action-cancel').click();
    await expect(page.getByTestId('cancel-event-submitted')).toContainText('Oda 1 ina malipo yanayosubiri ukaguzi.');
  });
});

test.describe('final contract check (backend #270 shapes)', () => {
  test('a cancel answer with batch.error: the event is cancelled, the mapped error shows, Resume works, no NaN and no batch=undefined', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: { cancelResponse: 'batch_error' } });
    await page.goto('/admin/events/?event=evt_pub');
    await page.getByTestId('admin-action-cancel').click();
    await page.getByTestId('cancel-confirm').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel event and raise refunds' }).click();
    const box = page.getByTestId('cancel-event-batch-error');
    await expect(box).toContainText('The event is cancelled, but raising the refunds failed:');
    await expect(box).toContainText('Raising the refunds failed. Resume it.');
    await expect(page.getByTestId('cancel-event-result')).not.toContainText(/NaN|undefined/);
    await expect(page.getByTestId('cancel-event-review')).toHaveCount(0);
    expect(mock.writes(/refund-batch$/)).toHaveLength(0); // no silent retry
    await page.getByTestId('cancel-event-continue').click();
    await expect.poll(() => mock.writes(/refund-batch$/).length).toBe(1);
    expect(mock.writes(/refund-batch$/)[0].body).toEqual({});
    await expect(page.getByTestId('cancel-event-batch-error')).toHaveCount(0);
    await expect(page.getByTestId('cancel-event-review')).toHaveAttribute('href', /batch=evb_9$/);
  });

  test('approve-all: a stale batch shows the live totals (batch_changed); a partial failure is not shown as full success', async ({ page }) => {
    const mock = await setupEvents(page, ADMIN_2, { s4: { failOneInBatch: true } });
    await page.goto('/admin/refunds/?batch=evb_1');
    await expect(page.getByTestId('refund-batch-summary')).toBeVisible();
    // Someone else changed the batch after the page loaded.
    mock.s4!.refunds.find(r => r.id === 'rf_b2')!.amountTzs = 30000;
    await page.getByTestId('refund-approve-all').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Approve all requested' }).click();
    await expect(page.getByTestId('refund-batch-error')).toContainText('The batch changed: now 2 refunds, TSh 55,000.');
    await page.getByTestId('refund-approve-all').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Approve all requested' }).click();
    const err = page.getByTestId('refund-batch-error');
    await expect(err).toContainText('1 approved, 1 could not be approved.');
    await expect(err).toContainText('There is no recipient to send this refund to.');
    await expect(page.locator('main')).not.toContainText('Refunds approved.');
    expect(mock.writes(/batch-decision$/)).toHaveLength(2);
  });

  test('the admin order preview reads modes.policy: a custom policy shows no amount and is disabled', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { s4: {} });
    await page.goto('/admin/events/?event=evt_pub&view=orders');
    await page.getByTestId('order-open-ord_cust').click();
    await expect(page.getByTestId('admin-refund-mode-policy')).toBeDisabled();
    await expect(page.getByTestId('admin-refund-mode-policy').locator('..')).not.toContainText('TSh');
    await expect(page.getByTestId('admin-refund-mode-full').locator('..')).toContainText('TSh 60,000');
  });

  test('the new backend refusal codes read as sentences in English and Swahili', async ({ page }) => {
    const mock = await setupEvents(page, SUPER_ADMIN, { s4: {}, locale: 'sw' });
    await page.goto('/admin/events/?event=evt_pub&view=orders');
    await page.getByTestId('order-open-ord_rep').click();
    mock.on('POST', /repair-payment$/, () => ({ status: 409, json: { error: 'nothing_to_repair' } }));
    await page.getByTestId('order-payment-repair').click();
    await expect(page.getByText('Hakuna cha kurekebisha kwenye oda hii.')).toBeVisible();
  });
});
