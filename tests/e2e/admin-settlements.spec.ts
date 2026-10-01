import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Json = Record<string, unknown>;

const statement = (over: Json = {}) => ({
  id: 'st-1', runId: 'run-1', mode: 'live', gymId: 'gym-1', gymName: 'Mikocheni Fitness',
  periodStartDate: '2026-10-01', periodEndDate: '2026-10-31', memberCycleCount: 2, qualifyingVisitCount: 9, heldVisitCount: 0,
  preliminaryTzs: 120000, networkAdjustmentTzs: 15000, adjustmentsTzs: 0, carryForwardTzs: 0, finalNetTzs: 105000,
  status: 'draft', holdReason: null, submittedBy: null, ...over,
});

const lines = [
  { id: 'ln-1', memberId: 'm-1', member: { publicId: 'FF-1001', displayName: 'Asha M' }, fundingType: 'platform_pass', qualifyingVisitCount: 5, heldVisitCount: 0, bracket: 'weekly', rawPreliminaryTzs: 70000, preliminaryTzs: 70000, monotonicGuardApplied: false, networkAdjustmentTzs: 15000, finalTzs: 55000, rateCardSnapshot: { wholesaleDailyTzs: 12000, wholesaleWeeklyTzs: 70000, wholesaleMonthlyTzs: 200000 } },
  { id: 'ln-2', memberId: 'm-2', member: { publicId: 'FF-1002', displayName: null }, fundingType: 'b2b_benefit', qualifyingVisitCount: 4, heldVisitCount: 0, bracket: 'weekly', rawPreliminaryTzs: 50000, preliminaryTzs: 50000, monotonicGuardApplied: false, networkAdjustmentTzs: 0, finalTzs: 50000, rateCardSnapshot: null },
];
const visits = [
  { id: 'v-1', lineId: 'ln-1', checkinId: 'c-1', businessDate: '2026-10-03', outcome: 'payable', eligibility: 'eligible', allowanceSlot: 1 },
  { id: 'v-2', lineId: 'ln-1', checkinId: 'c-2', businessDate: '2026-10-04', outcome: 'excluded', eligibility: 'duplicate_same_day', allowanceSlot: null },
];

/** A signed-in admin and a small fake settlements API whose state the test can read. */
async function setup(page: Page, user: Json, state: { statement: Json; adjustments: Json[]; calls: Array<{ path: string; body: Json | null }> }) {
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Json | null;
      state.calls.push({ path, body });
      if (path.endsWith('/submit')) state.statement = { ...state.statement, status: 'submitted', submittedBy: 'admin-1' };
      if (path.endsWith('/approve')) {
        if (state.statement.submittedBy === user.id) return route.fulfill({ status: 403, json: { error: 'cannot_approve_own_submission' } });
        state.statement = { ...state.statement, status: 'approved' };
      }
      if (path.endsWith('/payable')) return route.fulfill({ status: 409, json: { error: 'not_payable', reason: 'payout_account_not_verified' } });
      if (path.endsWith('/adjustments')) {
        state.adjustments.push({ id: 'adj-1', gymSettlementId: 'st-1', status: 'proposed', createdBy: user.id, ...body });
        return route.fulfill({ status: 201, json: { adjustment: state.adjustments[0] } });
      }
      if (path === '/admin/settlements/runs') return route.fulfill({ status: 201, json: { run: { id: 'run-2', mode: body?.mode, periodStartDate: `${body?.month}-01`, periodEndDate: `${body?.month}-30`, status: 'locked' } } });
      return route.fulfill({ json: { statement: state.statement } });
    }
    if (path === '/admin/settlements/statements') return route.fulfill({ json: url.searchParams.get('mode') === 'shadow' ? [] : [state.statement] });
    if (path === '/admin/settlements/statements/st-1') return route.fulfill({ json: { statement: state.statement, lines, visits, adjustments: state.adjustments } });
    if (path === '/admin/settlements/runs') {
      return route.fulfill({ json: [{ id: 'run-1', mode: url.searchParams.get('mode'), periodStartDate: '2026-10-01', periodEndDate: '2026-10-31', status: 'locked', lockedAt: '2026-11-01T00:30:00.000Z', configurationSnapshot: { stats: { statements: 1, settledCycles: 2, skippedCycles: 1, totalFinalTzs: 105000 }, exceptions: [{ subscriptionId: 'sub-9', memberId: 'm-9', reason: 'no_approved_payment' }] } }] });
    }
    return route.fulfill({ json: [] });
  });
}

test('admin prepares a statement: adjustment, submit, and cannot approve their own submission', async ({ page }) => {
  const state = { statement: statement(), adjustments: [] as Json[], calls: [] as Array<{ path: string; body: Json | null }> };
  await setup(page, { id: 'admin-1', userType: 'admin', email: 'admin@example.com' }, state);

  await page.goto('/admin/settlements');
  await expect(page.getByTestId('settlement-table')).toContainText('Mikocheni Fitness');
  await expect(page.getByTestId('settlement-table')).toContainText('October 2026');
  await expect(page.getByTestId('settlement-total')).toHaveText('TZS 105,000');

  await page.getByTestId('settlement-row-st-1').click();
  await expect(page).toHaveURL(/statement=st-1/);
  await expect(page.getByTestId('settlement-net')).toHaveText('TZS 105,000');
  await expect(page.getByTestId('settlement-lines')).toContainText('Asha M');
  await expect(page.getByTestId('settlement-lines')).toContainText('Sponsored');

  // The check-ins behind a line, with why one did not count.
  await page.getByTestId('settlement-line-ln-1').click();
  await expect(page.getByText('3 Oct')).toBeVisible();
  await expect(page.getByText('Same gym again that day')).toBeVisible();

  // A clawback is always sent as a negative amount.
  await page.getByTestId('settlement-adjust').click();
  await page.getByTestId('settlement-adjust-type').selectOption('clawback');
  await page.getByTestId('settlement-adjust-amount').fill('3500');
  await page.getByTestId('settlement-adjust-reason').fill('Visit voided after payment');
  await page.getByTestId('settlement-adjust-submit').click();
  await expect(page.getByTestId('settlement-adjustments')).toContainText('Visit voided after payment');
  expect(state.calls.at(-1)).toMatchObject({ path: '/admin/settlements/statements/st-1/adjustments', body: { amountTzs: -3500, type: 'clawback' } });

  // A proposed adjustment blocks submitting, and its proposer cannot apply it.
  await expect(page.getByTestId('settlement-submit')).toBeDisabled();
  await expect(page.getByTestId('settlement-adjustment-apply-adj-1')).toBeDisabled();

  state.adjustments = [];
  await page.reload();
  await page.getByTestId('settlement-submit').click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Submitted for approval.')).toBeVisible();
  await expect(page.getByTestId('settlement-approve')).toBeDisabled();
});

test('a second admin approves, and a failed payout check is explained', async ({ page }) => {
  const state = { statement: statement({ status: 'submitted', submittedBy: 'admin-1' }), adjustments: [] as Json[], calls: [] as Array<{ path: string; body: Json | null }> };
  await setup(page, { id: 'admin-2', userType: 'admin', email: 'second@example.com' }, state);

  await page.goto('/admin/settlements?statement=st-1');
  await page.getByTestId('settlement-approve').click();
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
  await expect(page.getByText('Approved.', { exact: true })).toBeVisible();

  await page.getByTestId('settlement-payable').click();
  await page.getByRole('button', { name: 'Clear for payment', exact: true }).last().click();
  await expect(page.getByText('This gym can’t be paid yet: it has no verified payout account.')).toBeVisible();

  await page.getByTestId('settlement-back').click();
  await expect(page).not.toHaveURL(/statement=/);
  await page.getByTestId('settlement-tab-approved').click();
  await expect(page.getByTestId('settlement-table')).toContainText('Mikocheni Fitness');
});

test('portal staff without settlement scopes can read but not act; runs list shows skipped cycles', async ({ page }) => {
  const state = { statement: statement(), adjustments: [] as Json[], calls: [] as Array<{ path: string; body: Json | null }> };
  await setup(page, { id: 'staff-1', userType: 'admin', portalUser: true, aclPermissions: ['payments'], email: 'staff@example.com' }, state);

  await page.goto('/admin/settlements');
  await expect(page.getByTestId('settlement-run-open')).toHaveCount(0);
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await page.getByTestId('settlement-run-run-1').click();
  await expect(page.getByText('No approved payment for the subscription')).toBeVisible();

  await page.getByRole('button', { name: 'Statements', exact: true }).click();
  await page.getByTestId('settlement-row-st-1').click();
  await expect(page.getByTestId('settlement-net')).toBeVisible();
  await expect(page.getByTestId('settlement-actions').getByRole('button')).toHaveCount(0);
});
