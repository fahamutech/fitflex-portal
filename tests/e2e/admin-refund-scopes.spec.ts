import { expect, test, type Page } from '@playwright/test';

// Phase 1 slice P-A: split refund scopes. The scope picker offers refunds_approve, refunds_pay and audit; refund and
// statement refusals read in English and Swahili instead of raw codes. Mocked API; nothing outside localhost is reached.
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.use({ serviceWorkers: 'block' });

type Reply = { status?: number; json?: unknown };
type Routes = Record<string, Reply>;
const SUPER = { id: 'adm_1', userType: 'admin', email: 'one@fitflex.test' };

async function open(page: Page, routes: Routes, path: string, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'admin-tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [SUPER, locale] as const);
  await page.context().route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => route.abort());
  await page.context().route(`${API}/**`, async route => {
    const hit = routes[`${route.request().method()} ${new URL(route.request().url()).pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ status: hit.status ?? 200, json: hit.json ?? null });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(path);
}

const refund = (id: string, status: string) => ({
  id, memberId: 'm1', kind: 'subscription', subscriptionId: 's1', bookingId: null, orderId: null, paymentRequestId: 'p1',
  amountTzs: 30000, currency: 'TZS', reasonCode: 'payment_error', note: null, decisionNote: null, status,
  requestedBy: 'adm_9', requestedRole: 'admin', decidedBy: null, decidedAt: null, paidAt: null, paymentReference: null, paidTo: null,
  createdAt: '2026-11-01T08:00:00.000Z', member: { id: 'm1', displayName: 'Asha Member', phone: '+255700000001', email: null },
});

const USER = { id: 'staff-2', email: 'helper@fitflex.test', displayName: 'Helper', userType: 'admin', accountStatus: 'active', portalUser: true, aclPermissions: ['payments'], createdAt: '2026-10-01T00:00:00.000Z', isEnvAdmin: false };

test.describe('scope picker', () => {
  for (const [locale, labels, hint] of [
    ['en', ['Refunds: approve or reject', 'Refunds: record payment', 'Audit log'], 'REFUND_SPLIT_SCOPES'],
    ['sw', ['Marejesho: kuidhinisha au kukataa', 'Marejesho: kurekodi malipo', 'Kumbukumbu za ukaguzi'], 'REFUND_SPLIT_SCOPES'],
  ] as const) {
    test(`edit dialog offers the new scopes (${locale})`, async ({ page }) => {
      await open(page, { 'GET /admin/portal-users': { json: [USER] } }, '/admin/users/', locale);
      await page.getByRole('row', { name: /helper@fitflex\.test/ }).getByTitle('Edit permissions').first().click();
      for (const [i, k] of (['refunds_approve', 'refunds_pay', 'audit'] as const).entries()) {
        await expect(page.getByTestId(`scope-toggle-${k}`)).toContainText(labels[i]);
        await expect(page.getByTestId(`scope-toggle-${k}`)).toBeEnabled();
      }
      await expect(page.getByTestId('refund-scopes-hint').last()).toContainText(hint);
    });
  }
});

test.describe('refund refusals', () => {
  const rows = { 'GET /admin/refunds': { json: { refunds: [refund('r-1', 'requested'), refund('r-2', 'approved')] } } };

  test('requested rows say so, and the approve refusals read in English', async ({ page }) => {
    await open(page, {
      ...rows,
      'POST /admin/refunds/r-1/decision': { status: 403, json: { error: 'cannot_approve_own_request' } },
      'POST /admin/refunds/r-2/paid': { status: 403, json: { error: 'cannot_pay_own_approval' } },
    }, '/admin/refunds');
    await page.getByTestId('refund-filter-all').click();
    await expect(page.getByTestId('refund-requested-note')).toHaveText('Requested: waiting for someone with approval access.');
    await page.getByTestId('refund-approve').click();
    await page.getByTestId('refund-submit').click();
    await expect(page.getByText('You raised this refund. A different admin must approve it.')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('refund-paid').click();
    await page.getByRole('dialog').getByRole('textbox').first().fill('REF-1');
    await page.getByTestId('refund-submit').click();
    await expect(page.getByText('You approved this refund. A different admin must record the payment.')).toBeVisible();
  });

  for (const [scope, en, sw] of [
    ['refunds_approve', 'You do not have the permission to approve refunds (Refunds: approve or reject).', 'Huna ruhusa ya kuidhinisha marejesho (Marejesho: kuidhinisha au kukataa).'],
    ['payments', 'You do not have the permission for this action. Ask an admin to grant it.', 'Huna ruhusa ya kitendo hiki. Muombe admin akupe ruhusa.'],
  ] as const) {
    for (const locale of ['en', 'sw'] as const) {
      test(`403 missing scope ${scope} (${locale})`, async ({ page }) => {
        await open(page, { ...rows, 'POST /admin/refunds/r-1/decision': { status: 403, json: { error: 'acl_forbidden', requiredScope: scope } } }, '/admin/refunds', locale);
        await page.getByTestId('refund-filter-all').click();
        await page.getByTestId('refund-approve').click();
        await page.getByTestId('refund-submit').click();
        await expect(page.getByText(locale === 'en' ? en : sw)).toBeVisible();
      });
    }
  }
});

test.describe('statement pay refusals', () => {
  const st = { id: 'st1', gymId: 'g1', gymName: 'Kariakoo Gym', periodStartDate: '2026-10-01', mode: 'live', status: 'payable', finalNetTzs: 100000, currency: 'TZS' };
  for (const [code, status, locale, text] of [
    ['cannot_pay_own_approval', 403, 'en', 'You approved this statement. A different admin must record the payment.'],
    ['approver_unknown', 409, 'sw', 'Hakuna aliyerekodiwa kuidhinisha taarifa hii'],
  ] as const) {
    test(`gym statement pay: ${code} (${locale})`, async ({ page }) => {
      await open(page, {
        'GET /admin/settlements/statements/st1': { json: { statement: st, lines: [], visits: [], adjustments: [] } },
        'POST /admin/settlements/statements/st1/pay': { status, json: { error: code } },
      }, '/admin/settlements?statement=st1', locale);
      await page.getByTestId('settlement-pay').click();
      await page.getByTestId('settlement-pay-reference').fill('REF-9');
      await page.getByTestId('settlement-pay-submit').click();
      await expect(page.getByText(text)).toBeVisible();
      await expect(page.getByText(text)).not.toContainText(/refund|marejesho/i);
    });
  }

  test('statement pay: a missing-scope 403 keeps the statement screen own message', async ({ page }) => {
    await open(page, {
      'GET /admin/settlements/statements/st1': { json: { statement: st, lines: [], visits: [], adjustments: [] } },
      'POST /admin/settlements/statements/st1/pay': { status: 403, json: { error: 'acl_forbidden', requiredScope: 'settlements_pay' } },
    }, '/admin/settlements?statement=st1');
    await page.getByTestId('settlement-pay').click();
    await page.getByTestId('settlement-pay-reference').fill('REF-9');
    await page.getByTestId('settlement-pay-submit').click();
    await expect(page.getByText('You don’t have permission to do that.')).toBeVisible();
  });
});
