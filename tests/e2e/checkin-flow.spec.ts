import { test, expect, request } from '@playwright/test';

const API = 'http://localhost:3000';

function devToken(payload: Record<string, string>) {
  return `dev:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

/**
 * E2E: full FitFlex check-in core flow.
 * 1. Member signs up via OTP, subscribes to Pro pass, gets a QR token (via API).
 * 2. Operator logs into the portal.
 * 3. Operator submits the QR token via the manual-input fallback on /scan.
 * 4. Portal renders success result; /checkins lists the new entry.
 */
test('member-operator check-in core flow', async ({ page }) => {
  const ctx = await request.newContext();

  // 1. Member signs in through Firebase session exchange.
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const memberEmail = `member-${suffix}@example.com`;
  const verRes = await ctx.post(`${API}/auth/firebase/session`, {
    data: {
      idToken: devToken({ uid: `fb_member_${suffix}`, email: memberEmail, name: 'Pilot Member' }),
      requestedRole: 'member'
    }
  });
  const { token: memberToken } = await verRes.json();
  expect(memberToken).toBeTruthy();

  // 2. Request Pro pass, then approve it as admin.
  const subRes = await ctx.post(`${API}/me/subscribe`, {
    headers: { authorization: `Bearer ${memberToken}` },
    data: { tier: 'pro', type: 'platform_pass' }
  });
  expect(subRes.ok()).toBeTruthy();
  const { paymentRequest } = await subRes.json();

  const adminSession = await ctx.post(`${API}/auth/firebase/session`, {
    data: {
      idToken: devToken({ uid: `fb_admin_${suffix}`, email: 'mama27j@gmail.com', name: 'FitFlex Admin' }),
      requestedRole: 'admin'
    }
  });
  const { token: adminToken } = await adminSession.json();
  const approveRes = await ctx.post(`${API}/admin/payment-requests/${paymentRequest.id}/decision`, {
    headers: { authorization: `Bearer ${adminToken}` },
    data: { decision: 'approve', reference: `E2E-${suffix}` }
  });
  expect(approveRes.ok()).toBeTruthy();

  // 3. Member QR token
  const qrRes = await ctx.get(`${API}/me/qr`, { headers: { authorization: `Bearer ${memberToken}` } });
  const { token: qrToken } = await qrRes.json();
  expect(qrToken).toMatch(/^usr_/);

  // 4. Operator session is bootstrapped through Firebase exchange.
  const operatorSession = await ctx.post(`${API}/auth/firebase/session`, {
    data: {
      idToken: devToken({ uid: `fb_operator_${suffix}`, email: 'operator@iron-paradise.tz', name: 'Operator' }),
      requestedRole: 'gym_operator'
    }
  });
  const { token: operatorToken, user: operatorUser } = await operatorSession.json();
  await page.goto('/login');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token: operatorToken, user: operatorUser });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/);

  // 5. Operator submits the member QR via /scan manual fallback
  await page.goto('/scan');
  await page.getByTestId('manual-token').fill(qrToken);
  await page.getByTestId('manual-submit').click();
  const result = page.getByTestId('scan-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('OK');

  // 6. Verify it appears in /checkins
  await page.goto('/checkins');
  await expect(page.locator('table')).toContainText(memberEmail);
});

test('locale switcher toggles UI to Swahili', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading')).toContainText('Operator / Admin login');
  await page.getByTestId('locale-select').selectOption('sw');
  await expect(page.getByRole('heading')).toContainText('mwendeshaji');
});
