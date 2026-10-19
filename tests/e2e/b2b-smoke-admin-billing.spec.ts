// Smoke coverage for /admin/b2b-billing: the billing dashboard, the collections panel
// (src/components/b2b-collections.tsx: CollectionsPanel and its dialogs) and one organisation's
// invoices, payments, statement and agreement. Mock-driven, asserting rendering, labelled controls and
// the exact requests the forms send.
import { expect, Page, test } from '@playwright/test';
import { ADMIN, B2BMock, expectNoHorizontalScroll, setupB2B } from './helpers/b2b-mock';

let mock: B2BMock;
test.beforeEach(async ({ page }) => {
  mock = await setupB2B(page, ADMIN);
});

const openOrg = async (page: Page) => {
  await page.goto('/admin/b2b-billing');
  await expect(page.getByTestId('billing-organizations')).toBeVisible();
  await page.getByTestId('billing-organizations').getByRole('button', { name: 'Safari Cover' }).click();
  await expect(page.getByTestId('org-billing-admin')).toBeVisible();
};

test('dashboard renders totals, collections and the organisations table', async ({ page }) => {
  await page.goto('/admin/b2b-billing');
  await expect(page.getByRole('heading', { name: 'B2B billing' })).toBeVisible();
  await expect(page.getByTestId('billing-totals')).toContainText('TSh 175,000');
  await expect(page.getByTestId('billing-aging')).toContainText('Not yet due');
  await expect(page.getByTestId('collections')).toContainText('1 payment notice to check');
  await expect(page.getByTestId('notices-to-check')).toContainText('SAFARI-REF-9');
  await expect(page.getByTestId('overdue-invoices')).toContainText('INV-2026-0002');
  await expect(page.getByTestId('on-hold')).toContainText('Held Holdings');
  await expect(page.getByTestId('billed-vs-providers')).toContainText('TSh 150,000');
  await expect(page.getByTestId('billing-organizations')).toContainText('Safari Cover');
  // Controls: month picker and organisation chooser.
  await page.getByTestId('billing-period').fill('2026-09');
  await expect.poll(() => mock.reads(/^\/admin\/b2b\/billing$/).some(c => c.query.period === '2026-09')).toBe(true);
  await expect(page.getByTestId('billing-open-org').locator('option')).toHaveText(['Open an organisation…', 'Safari Cover', 'Kilimani Club Ltd', 'Mwenge Textiles']);
  await page.getByTestId('billing-open-org').selectOption('org-1');
  await expect(page.getByTestId('org-billing-admin')).toBeVisible();
  await page.getByRole('button', { name: 'All organisations' }).click();
  await expect(page.getByTestId('billing-totals')).toBeVisible();
});

test.describe('collections', () => {
  test('payment details dialog saves every field', async ({ page }) => {
    await page.goto('/admin/b2b-billing');
    await page.getByTestId('edit-payment-details').click();
    const form = page.getByTestId('payment-details-form');
    for (const label of ['Bank', 'Account name', 'Account number', 'Branch', 'SWIFT code', 'Lipa Namba', 'Lipa Namba name', 'Anything else organisations should know (optional)']) {
      await expect(form.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(form.getByLabel('Bank', { exact: true })).toHaveValue('CRDB Bank');
    await form.getByLabel('Bank', { exact: true }).fill('NMB Bank');
    await form.getByLabel('Branch', { exact: true }).fill('Mlimani');
    await form.getByLabel('Anything else organisations should know (optional)', { exact: true }).fill('Quote the invoice number');
    await page.getByTestId('details-save').click();
    await expect.poll(() => mock.writes(/payment-instructions$/).length).toBe(1);
    expect(mock.writes(/payment-instructions$/)[0]).toMatchObject({ method: 'PUT', path: '/admin/b2b/payment-instructions' });
    expect(mock.writes(/payment-instructions$/)[0].body).toEqual({
      bankName: 'NMB Bank', accountName: 'FitFlex Africa Ltd', accountNumber: '0150123456', branch: 'Mlimani', swiftCode: 'CORUTZTZ',
      lipaNamba: '123456', lipaNambaName: 'FitFlex', notes: 'Quote the invoice number',
    });
    await expect(page.getByText('Payment details saved.')).toBeVisible();
  });

  test('confirm a payment notice with the amount seen on the statement', async ({ page }) => {
    await page.goto('/admin/b2b-billing');
    await page.getByTestId('confirm-ntc-1').click();
    const form = page.getByTestId('decide-notice');
    await expect(form.getByLabel('Amount on the statement (TSh)', { exact: true })).toHaveValue('100000');
    await form.getByLabel('Amount on the statement (TSh)', { exact: true }).fill('95000');
    await form.getByLabel('Note (optional, internal)', { exact: true }).fill('Seen on the CRDB statement');
    await page.getByTestId('decide-submit').click();
    await expect.poll(() => mock.writes(/payment-notices\/ntc-1\/confirm$/).length).toBe(1);
    expect(mock.writes(/payment-notices\/ntc-1\/confirm$/)[0]).toMatchObject({ method: 'POST', body: { amountTzs: 95000, note: 'Seen on the CRDB statement' } });
    await expect(page.getByText(/Payment RCT-0002 recorded\./)).toBeVisible();
  });

  test('reject a payment notice with a reason', async ({ page }) => {
    await page.goto('/admin/b2b-billing');
    await page.getByTestId('notices-to-check').getByRole('button', { name: 'Not found' }).click();
    await page.getByTestId('reject-reason').fill('Nothing arrived on 8 October');
    await page.getByTestId('decide-submit').click();
    await expect.poll(() => mock.writes(/payment-notices\/ntc-1\/reject$/).length).toBe(1);
    expect(mock.writes(/payment-notices\/ntc-1\/reject$/)[0].body).toEqual({ reason: 'Nothing arrived on 8 October' });
  });

  test('remind, put on hold and lift a hold', async ({ page }) => {
    await page.goto('/admin/b2b-billing');
    await page.getByTestId('remind-inv-2').click();
    await expect.poll(() => mock.writes(/invoices\/inv-2\/remind$/).length).toBe(1);
    await expect(page.getByText('Reminder for INV-2026-0002 sent to 2 portal users.')).toBeVisible();

    await page.getByTestId('overdue-invoices').getByRole('button', { name: 'Put on hold' }).click();
    await page.getByTestId('hold-reason').fill('Two months unpaid');
    await page.getByTestId('hold-form').getByRole('button', { name: 'Put on hold' }).click();
    await expect.poll(() => mock.writes(/billing-hold$/).length).toBe(1);
    expect(mock.writes(/billing-hold$/)[0]).toMatchObject({ method: 'POST', path: '/admin/b2b/organizations/org-1/billing-hold', body: { onHold: true, reason: 'Two months unpaid' } });

    await page.getByTestId('on-hold').getByRole('button', { name: 'Lift hold' }).click();
    await page.getByTestId('hold-form').getByRole('button', { name: 'Lift hold' }).click();
    await expect.poll(() => mock.writes(/billing-hold$/).length).toBe(2);
    expect(mock.writes(/billing-hold$/)[1].path).toBe('/admin/b2b/organizations/org-9/billing-hold');
    expect(mock.writes(/billing-hold$/)[1].body).toEqual({ onHold: false });
  });
});

test.describe('one organisation', () => {
  test('invoices: prepare fee, issue a draft, correction notes, void, trace', async ({ page }) => {
    await openOrg(page);
    await expect(page.getByTestId('billing-balances')).toContainText('TSh 150,000');
    await expect(page.getByTestId('admin-invoices')).toContainText('INV-2026-0003');
    await expect(page.getByLabel('Platform fee for', { exact: true })).toBeVisible();
    await page.getByTestId('fee-prepare').click();
    await expect.poll(() => mock.writes(/prepare-fee$/).length).toBe(1);
    expect(mock.writes(/prepare-fee$/)[0]).toMatchObject({ method: 'POST', path: '/admin/b2b/organizations/org-1/invoices/prepare-fee' });
    expect(mock.writes(/prepare-fee$/)[0].body?.period).toMatch(/^\d{4}-\d{2}$/);

    // A draft is issued with the VAT rate typed in percent (18 -> 1800 bps).
    await page.getByTestId('admin-invoice-inv-3').click();
    await expect(page.getByTestId('invoice-document')).toContainText('INV-2026-0003');
    await expect(page.getByTestId('invoice-issue')).toBeDisabled();
    await page.getByLabel('VAT rate %', { exact: true }).fill('18');
    await page.getByTestId('invoice-issue').click();
    await expect.poll(() => mock.writes(/invoices\/inv-3\/issue$/).length).toBe(1);
    expect(mock.writes(/invoices\/inv-3\/issue$/)[0]).toMatchObject({ method: 'POST', body: { vatRateBps: 1800 } });
    // Void needs a reason.
    await page.getByLabel('Reason (to void)', { exact: true }).fill('Raised in error');
    await page.getByTestId('invoice-void').click();
    await expect.poll(() => mock.writes(/invoices\/inv-3\/void$/).length).toBe(1);
    expect(mock.writes(/invoices\/inv-3\/void$/)[0].body).toEqual({ reason: 'Raised in error' });
  });

  test('an issued invoice takes correction notes and can be traced', async ({ page }) => {
    await openOrg(page);
    await page.getByTestId('admin-invoice-inv-1').click();
    await expect(page.getByTestId('invoice-document')).toContainText('INV-2026-0001');
    await page.getByLabel('Correction amount (TSh)', { exact: true }).fill('5000');
    await page.getByLabel('Why', { exact: true }).fill('Member left in September');
    await page.getByTestId('note-credit').click();
    await expect.poll(() => mock.writes(/invoices\/inv-1\/notes$/).length).toBe(1);
    expect(mock.writes(/invoices\/inv-1\/notes$/)[0]).toMatchObject({ method: 'POST', body: { type: 'credit', amountTzs: 5000, reason: 'Member left in September' } });
    await page.getByTestId('invoice-trace').click();
    await expect(page.getByTestId('invoice-reconciliation')).toContainText('Lines add up to the total');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId('admin-invoices')).toBeVisible();
  });

  test('payments: record in each mode, apply what is left, reverse', async ({ page }) => {
    await openOrg(page);
    await page.getByRole('button', { name: 'Payments', exact: true }).click();
    const form = page.getByTestId('payment-form');
    for (const label of ['Amount (TSh)', 'How it was paid', 'Bank or mobile-money reference', 'Received on (blank = today)']) {
      await expect(form.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('payment-record')).toBeDisabled();
    await form.getByLabel('Amount (TSh)', { exact: true }).fill('60000');
    await form.getByLabel('How it was paid', { exact: true }).selectOption('mobile_money');
    await form.getByLabel('Bank or mobile-money reference', { exact: true }).fill('MM-123');
    await page.getByTestId('payment-record').click();
    await expect.poll(() => mock.writes(/\/organizations\/org-1\/payments$/).length).toBe(1);
    expect(mock.writes(/\/organizations\/org-1\/payments$/)[0]).toMatchObject({ method: 'POST', body: { amountTzs: 60000, method: 'mobile_money', reference: 'MM-123', autoAllocate: true } });
    await expect(page.getByText(/RCT-0003 recorded\./)).toBeVisible();

    // Choose invoices: one amount per open invoice.
    await form.getByLabel('Amount (TSh)', { exact: true }).fill('40000');
    await form.getByLabel('Bank or mobile-money reference', { exact: true }).fill('MM-124');
    await form.getByLabel('Received on (blank = today)', { exact: true }).fill('2026-10-05');
    await page.getByRole('button', { name: 'Choose invoices' }).click();
    await page.getByTestId('payment-apply-inv-1').fill('40000');
    await page.getByTestId('payment-record').click();
    await expect.poll(() => mock.writes(/\/organizations\/org-1\/payments$/).length).toBe(2);
    expect(mock.writes(/\/organizations\/org-1\/payments$/)[1].body).toEqual({
      amountTzs: 40000, method: 'mobile_money', reference: 'MM-124', receivedAt: new Date('2026-10-05T09:00:00').toISOString(), autoAllocate: false,
      allocations: [{ invoiceId: 'inv-1', amountTzs: 40000 }],
    });

    // The received payment still has money to apply.
    await expect(page.getByTestId('admin-payments')).toContainText('RCT-0001');
    await page.getByTestId('payment-apply-open-pay-1').click();
    const panel = page.getByTestId('payment-apply-panel');
    await panel.getByPlaceholder('Amount to apply').first().fill('30000');
    await panel.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => mock.writes(/payments\/pay-1\/allocate$/).length).toBe(1);
    expect(mock.writes(/payments\/pay-1\/allocate$/)[0].body).toEqual({ allocations: [{ invoiceId: 'inv-1', amountTzs: 30000 }] });

    // Reverse asks for a reason in a browser prompt.
    page.once('dialog', d => d.accept('Bounced cheque'));
    await page.getByTestId('payment-reverse-pay-1').click();
    await expect.poll(() => mock.writes(/payments\/pay-1\/reverse$/).length).toBe(1);
    expect(mock.writes(/payments\/pay-1\/reverse$/)[0].body).toEqual({ reason: 'Bounced cheque' });
  });

  test('statement date range reloads the statement', async ({ page }) => {
    await openOrg(page);
    await page.getByRole('button', { name: 'Statement', exact: true }).click();
    await expect(page.getByTestId('billing-statement')).toContainText('INV-2026-0001');
    await page.getByLabel('From', { exact: true }).fill('2026-09-01');
    await page.getByLabel('To', { exact: true }).fill('2026-09-30');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect.poll(() => mock.reads(/organizations\/org-1\/statement$/).some(c => c.query.from === '2026-09-01' && c.query.to === '2026-09-30')).toBe(true);
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  });

  test('agreement and billing contact', async ({ page }) => {
    await openOrg(page);
    await page.getByRole('button', { name: 'Agreement and account' }).click();
    const account = page.getByTestId('account-panel');
    await expect(account.getByLabel('Contact name', { exact: true })).toHaveValue('Neema Finance');
    await account.getByLabel('Contact name', { exact: true }).fill('Zawadi Accounts');
    await account.getByLabel('Phone', { exact: true }).fill('0713999000');
    await page.getByTestId('account-save').click();
    await expect.poll(() => mock.writes(/billing-account$/).length).toBe(1);
    expect(mock.writes(/billing-account$/)[0]).toMatchObject({ method: 'PUT', body: { contactName: 'Zawadi Accounts', email: 'finance@safari.test', phone: '0713999000' } });

    // The billing contact is saved first: every save reloads the tab, which resets that form.
    const panel = page.getByTestId('agreement-panel');
    await expect(panel).toContainText('AGR-0001');
    for (const label of ['Starts on', 'Contract reference (optional)', 'Days to pay advance invoices', 'Days to pay usage invoices', 'Platform fee a month, TSh incl. VAT (optional)', 'Usual VAT rate % (optional)']) {
      await expect(panel.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('agreement-create')).toBeDisabled();
    await panel.getByLabel('Starts on', { exact: true }).fill('2026-12-01');
    await panel.getByLabel('Contract reference (optional)', { exact: true }).fill('C-77');
    await panel.getByLabel('Days to pay advance invoices', { exact: true }).fill('7');
    await panel.getByLabel('Days to pay usage invoices', { exact: true }).fill('21');
    await panel.getByLabel('Platform fee a month, TSh incl. VAT (optional)', { exact: true }).fill('75000');
    await panel.getByLabel('Usual VAT rate % (optional)', { exact: true }).fill('18');
    await page.getByTestId('agreement-create').click();
    await expect.poll(() => mock.writes(/organizations\/org-1\/agreements$/).length).toBe(1);
    expect(mock.writes(/organizations\/org-1\/agreements$/)[0].body).toEqual({
      effectiveFrom: '2026-12-01', prepaidTermsDays: 7, usageTermsDays: 21, platformFeeTzs: 75000, vatRateBps: 1800, contractReference: 'C-77',
      passRates: {}, // sent since pass-rate overrides were added; none are set here
    });
    await page.getByTestId('agreement-activate-agr-1').click();
    await expect.poll(() => mock.writes(/agreements\/agr-1\/activate$/).length).toBe(1);
  });
});

// Known today: raw <table>s are not in a scroll container, so at 375px <main> scrolls sideways by the
// amounts below (px beyond the viewport). They are a ceiling: a migration to the Table family (which
// scrolls inside its own wrapper) may lower them, never raise them.
test('no horizontal scroll at 375px (not worse than the known overflow)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/admin/b2b-billing');
  await expect(page.getByTestId('billing-organizations')).toBeVisible();
  await expectNoHorizontalScroll(page, 300);
  await page.getByTestId('billing-organizations').getByRole('button', { name: 'Safari Cover' }).click();
  await expect(page.getByTestId('admin-invoices')).toBeVisible();
  await expectNoHorizontalScroll(page, 108);
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await expect(page.getByTestId('payment-form')).toBeVisible();
  await expectNoHorizontalScroll(page, 196);
  await page.getByRole('button', { name: 'Statement', exact: true }).click();
  await expect(page.getByTestId('billing-statement')).toBeVisible();
  await expectNoHorizontalScroll(page, 102);
});

test('every request was handled by the mock', async ({ page }) => {
  await openOrg(page);
  await page.getByRole('button', { name: 'Agreement and account' }).click();
  await expect(page.getByTestId('account-panel')).toBeVisible();
  expect(mock.unmatched.map(c => `${c.method} ${c.path}`)).toEqual([]);
});
