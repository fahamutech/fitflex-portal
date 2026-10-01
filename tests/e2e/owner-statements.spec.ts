import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

const paid = {
  id: 'st-sep', gymId: 'gym-1', gymName: 'Mikocheni Fitness', periodStartDate: '2026-09-01', periodEndDate: '2026-09-30', status: 'paid', onHold: false,
  members: 2, visits: 9, earnedTzs: 120000, networkAdjustmentTzs: 15000, adjustmentsTzs: -3500, carriedForwardTzs: 0, payableTzs: 101500,
  paidAt: '2026-10-05T09:00:00.000Z', paymentReference: 'MPESA-QK7H2L9', receiptUrl: null, payoutAccountLast4: '4821',
};
const preparing = { ...paid, id: 'st-oct', periodStartDate: '2026-10-01', periodEndDate: '2026-10-31', status: 'preparing', onHold: true, adjustmentsTzs: 0, payableTzs: 105000, paidAt: null, paymentReference: null, payoutAccountLast4: null };

test('gym owner sees their statements, how one was calculated and how it was paid', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'owner-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'owner-1', userType: 'gym_operator', gymId: 'gym-1', email: 'owner@example.com' }));
  });
  await page.route(`${API}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/owner/gyms') return route.fulfill({ json: [{ id: 'gym-1', name: 'Mikocheni Fitness' }] });
    if (path === '/owner/settlements') return route.fulfill({ json: [preparing, paid] });
    if (path === '/owner/settlements/st-sep') {
      return route.fulfill({ json: {
        statement: paid,
        lines: [
          { memberCode: 'FF-1001', funding: 'pass', visits: 5, visitDates: ['2026-09-03', '2026-09-04', '2026-09-08', '2026-09-10', '2026-09-12'], bracket: 'weekly', rates: { dailyTzs: 12000, weeklyTzs: 70000, monthlyTzs: 200000 }, earnedTzs: 70000, networkAdjustmentTzs: 15000, finalTzs: 55000 },
          { memberCode: 'FF-1002', funding: 'sponsored', visits: 4, visitDates: [], bracket: 'weekly', rates: null, earnedTzs: 50000, networkAdjustmentTzs: 0, finalTzs: 50000 },
        ],
        adjustments: [{ amountTzs: -3500, type: 'clawback', reason: 'Visit voided after last month was paid', appliedAt: '2026-10-02T08:00:00.000Z' }],
      } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/owner/statements');
  await expect(page.getByTestId('statement-row-st-oct')).toContainText('October 2026');
  await expect(page.getByTestId('statement-row-st-oct')).toContainText('Being prepared');
  await expect(page.getByTestId('statement-row-st-oct')).toContainText('On hold');
  await expect(page.getByTestId('statement-row-st-sep')).toContainText('TZS 101,500');

  await page.getByTestId('statement-row-st-sep').click();
  await expect(page).toHaveURL(/statement=st-sep/);
  await expect(page.getByTestId('statement-net')).toHaveText('TZS 101,500');
  await expect(page.getByTestId('statement-reference')).toHaveText('MPESA-QK7H2L9');
  await expect(page.getByText('····4821')).toBeVisible();
  await expect(page.getByTestId('statement-lines')).toContainText('Sponsored');
  await expect(page.getByTestId('statement-adjustments')).toContainText('Visit voided after last month was paid');
  await expect(page.getByTestId('statement-adjustments')).toContainText('−TZS 3,500');

  await page.getByTestId('statement-line-0').click();
  await expect(page.getByText('Your rates: daily TZS 12,000 · weekly TZS 70,000 · monthly TZS 200,000')).toBeVisible();
  await expect(page.getByText('12 Sept').or(page.getByText('12 Sep'))).toBeVisible();

  await page.getByTestId('statement-back').click();
  await expect(page.getByTestId('statement-table')).toBeVisible();
});
