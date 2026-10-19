// Smoke coverage for /org (app/org/page.tsx): an organisation's own billing, including the "Pay" tab
// (OrgPaying in src/components/b2b-collections.tsx) that tells FitFlex a payment was made.
import { expect, test } from '@playwright/test';
import { B2BMock, expectNoHorizontalScroll, orgUser, setupB2B } from './helpers/b2b-mock';

let mock: B2BMock;
test.beforeEach(async ({ page }) => {
  mock = await setupB2B(page, orgUser(['finance']));
});

const todayEat = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

test('overview shows balances, terms, contact and the latest invoices', async ({ page }) => {
  await page.goto('/org');
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(page.getByTestId('billing-balances')).toContainText('TSh 150,000');
  await expect(page.getByTestId('billing-aging')).toBeVisible();
  await expect(page.getByText('Payment terms')).toBeVisible();
  await expect(page.getByText('Neema Finance')).toBeVisible();
  await expect(page.getByTestId('org-invoices')).toContainText('INV-2026-0001');
  for (const tab of ['Overview', 'Invoices', 'Pay', 'Payments', 'Statement']) await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
});

test('several organisations: a picker switches the organisation', async ({ page }) => {
  mock.on('GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [
    { id: 'org-1', legalName: 'Safari Insurance Ltd', tradingName: 'Safari Cover', role: 'finance', status: 'active' },
    { id: 'org-2', legalName: 'Kilimani Club Ltd', tradingName: null, role: 'owner', status: 'active' },
  ] }));
  await page.goto('/org');
  await expect(page.getByTestId('org-picker').locator('option')).toHaveText(['Safari Cover', 'Kilimani Club Ltd']);
  await page.getByTestId('org-picker').selectOption('org-2');
  await expect.poll(() => mock.reads(/organizations\/org-2\/billing$/).length).toBe(1);
});

test('invoices tab opens an invoice and leads to the pay form', async ({ page }) => {
  await page.goto('/org');
  await page.getByRole('button', { name: 'Invoices', exact: true }).click();
  await page.getByTestId('org-invoice-inv-1').click();
  await expect(page.getByTestId('invoice-document')).toContainText('INV-2026-0001');
  await page.getByTestId('pay-this-invoice').click();
  await expect(page.getByTestId('org-paying')).toBeVisible();
  // The invoice it was started from is ticked and the amount is what it still owes.
  await expect(page.getByLabel('INV-2026-0001')).toBeChecked();
  await expect(page.getByTestId('notice-amount')).toHaveValue('100000');
});

test('payment notice: controls and request body', async ({ page }) => {
  await page.goto('/org');
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  const form = page.getByTestId('payment-notice-form');
  await expect(page.getByTestId('payment-details')).toContainText('CRDB Bank');
  for (const label of ['Amount paid (TSh)', 'Date paid', 'How', 'Bank or mobile-money reference', 'Note (optional)']) {
    await expect(form.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(form.getByText('Proof of payment (optional)')).toBeVisible();
  // Ticking invoices adds up what they owe.
  await form.getByLabel('INV-2026-0001').check();
  await expect(page.getByTestId('notice-amount')).toHaveValue('100000');
  await form.getByLabel('INV-2026-0002').check();
  await expect(page.getByTestId('notice-amount')).toHaveValue('150000');
  await form.getByLabel('INV-2026-0002').uncheck();
  await expect(page.getByTestId('notice-amount')).toHaveValue('100000');

  await form.getByLabel('How', { exact: true }).selectOption('mobile_money');
  await form.getByLabel('Bank or mobile-money reference', { exact: true }).fill('MM-998877');
  await form.getByLabel('Note (optional)', { exact: true }).fill('Paid by the finance office');
  await page.getByTestId('notice-send').click();
  await expect.poll(() => mock.writes(/payment-notices$/).length).toBe(1);
  expect(mock.writes(/payment-notices$/)[0]).toMatchObject({ method: 'POST', path: '/b2b/organizations/org-1/payment-notices' });
  expect(mock.writes(/payment-notices$/)[0].body).toEqual({
    amountTzs: 100000, method: 'mobile_money', reference: 'MM-998877', paidOn: todayEat(), invoiceIds: ['inv-1'], note: 'Paid by the finance office',
  });
  await expect(page.getByText('Thank you. FitFlex will check its statement and confirm the payment.')).toBeVisible();
});

test('a notice that is being checked can be withdrawn', async ({ page }) => {
  await page.goto('/org');
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByTestId('org-notices')).toContainText('SAFARI-REF-9');
  await page.getByTestId('org-notices').getByRole('button', { name: 'Withdraw' }).click();
  await expect.poll(() => mock.writes(/withdraw$/).length).toBe(1);
  expect(mock.writes(/withdraw$/)[0]).toMatchObject({ method: 'POST', path: '/b2b/organizations/org-1/payment-notices/ntc-1/withdraw' });
});

test('payments list and statement range', async ({ page }) => {
  await page.goto('/org');
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await expect(page.getByTestId('org-payments')).toContainText('RCT-0001');
  await page.getByRole('button', { name: 'Statement', exact: true }).click();
  await expect(page.getByTestId('billing-statement')).toContainText('INV-2026-0001');
  await page.getByLabel('From', { exact: true }).fill('2026-09-01');
  await page.getByLabel('To', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect.poll(() => mock.reads(/organizations\/org-1\/statement$/).some(c => c.query.from === '2026-09-01' && c.query.to === '2026-09-30')).toBe(true);
});

// Known today: the invoice, payment and statement tables are raw <table>s with no scroll container, so
// <main> scrolls sideways at 375px by the amounts below. They are ceilings: a migration may only lower them.
test('no horizontal scroll at 375px (not worse than the known overflow)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/org');
  await expect(page.getByTestId('org-invoices')).toBeVisible();
  await expectNoHorizontalScroll(page, 198);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByTestId('org-paying')).toBeVisible();
  await expectNoHorizontalScroll(page, 183);
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await expect(page.getByTestId('org-payments')).toBeVisible();
  await expectNoHorizontalScroll(page, 156);
  await page.getByRole('button', { name: 'Statement', exact: true }).click();
  await expect(page.getByTestId('billing-statement')).toBeVisible();
  await expectNoHorizontalScroll(page, 55);
});

test('every request was handled by the mock', async ({ page }) => {
  await page.goto('/org');
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByTestId('org-paying')).toBeVisible();
  await page.getByRole('button', { name: 'Statement', exact: true }).click();
  await expect(page.getByTestId('billing-statement')).toBeVisible();
  expect(mock.unmatched.map(c => `${c.method} ${c.path}`)).toEqual([]);
});
