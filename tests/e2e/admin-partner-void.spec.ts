import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Json = Record<string, unknown>;
const statement = (over: Json = {}) => ({
  id: 'ts-1', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', commissionTzs: 6000, finalNetTzs: 34000, status: 'submitted',
  submittedBy: 'admin-1', holdReason: null, rejectReason: null, voidReason: null, paymentReference: null, paidAt: null, destinationSnapshot: null,
  trainer: { id: 'trn-1', displayName: 'Asha Mushi', userId: 'usr-1' }, sessionCount: 2, listTzs: 40000, ...over,
});

async function setup(page: Page, userId: string, state: { statement: Json; calls: Array<{ path: string; body: Json | null }> }) {
  await page.addInitScript((id) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id, userType: 'admin', email: `${id}@example.com` }));
  }, userId);
  await page.route(`${API}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Json | null;
      state.calls.push({ path, body });
      if (path.endsWith('/void-request')) state.statement = { ...state.statement, voidRequestedBy: userId, voidRequestedAt: '2026-10-13T09:00:00.000Z', voidRequestReason: body?.reason };
      else if (path.endsWith('/void-request/cancel')) state.statement = { ...state.statement, voidRequestedBy: null, voidRequestedAt: null, voidRequestReason: null };
      else if (path.endsWith('/void')) state.statement = { ...state.statement, status: 'voided', voidReason: state.statement.voidRequestReason };
      return route.fulfill({ json: { statement: state.statement } });
    }
    if (path === '/admin/trainer-settlements') return route.fulfill({ json: { statements: [state.statement] } });
    if (path === '/admin/trainer-settlements/ts-1') return route.fulfill({ json: { statement: state.statement, lines: [], payout: { ok: true, destination: null } } });
    return route.fulfill({ json: [] });
  });
}

test('trainer statement: a void is requested by one admin and cannot be confirmed by the same one', async ({ page }) => {
  const state = { statement: statement(), calls: [] as Array<{ path: string; body: Json | null }> };
  await setup(page, 'admin-2', state);
  await page.goto('/admin/trainer-settlements?statement=ts-1');

  await page.getByTestId('trainer-settlement-void-request').click();
  await expect(page.getByTestId('trainer-settlement-confirm')).toBeDisabled();
  await page.getByTestId('trainer-settlement-input').fill('Prepared with the wrong sessions');
  await page.getByTestId('trainer-settlement-confirm').click();
  expect(state.calls.at(-1)).toEqual({ path: '/admin/trainer-settlements/ts-1/void-request', body: { reason: 'Prepared with the wrong sessions' } });

  await expect(page.getByTestId('trainer-settlement-void-requested')).toContainText('Void requested on 13 Oct: Prepared with the wrong sessions. You asked for it, so someone else has to confirm it.');
  await expect(page.getByTestId('trainer-settlement-void')).toHaveCount(0);
  await expect(page.getByTestId('trainer-settlement-approve')).toHaveCount(0);
  await expect(page.getByTestId('trainer-settlement-void-request-cancel')).toBeVisible();
});

test('trainer statement: a second admin cancels the request, or confirms the void', async ({ page }) => {
  const requested = { voidRequestedBy: 'admin-2', voidRequestedAt: '2026-10-13T09:00:00.000Z', voidRequestReason: 'Prepared with the wrong sessions' };
  const state = { statement: statement(requested), calls: [] as Array<{ path: string; body: Json | null }> };
  await setup(page, 'admin-3', state);

  await page.goto('/admin/trainer-settlements?statement=ts-1');
  await page.getByTestId('trainer-settlement-void-request-cancel').click();
  await page.getByTestId('trainer-settlement-confirm').click();
  await expect(page.getByTestId('trainer-settlement-void-requested')).toHaveCount(0);
  await expect(page.getByTestId('trainer-settlement-approve')).toBeVisible();

  state.statement = statement(requested);
  await page.reload();
  await page.getByTestId('trainer-settlement-void').click();
  await page.getByTestId('trainer-settlement-confirm').click();
  expect(state.calls.at(-1)).toEqual({ path: '/admin/trainer-settlements/ts-1/void', body: {} });
  await expect(page.getByText('Voided: Prepared with the wrong sessions')).toBeVisible();
});
