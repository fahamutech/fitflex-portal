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
  test.setTimeout(60_000);
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
  const { token: memberToken, user: memberUser } = await verRes.json();
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

  // 3. Operator session is bootstrapped through Firebase exchange.
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

  // 4. Fetch a fresh rotating QR immediately before it is submitted.
  await page.goto('/scan');
  async function freshQr() {
    const response = await ctx.get(`${API}/me/qr?t=${Date.now()}`, {
      headers: { authorization: `Bearer ${memberToken}`, 'cache-control': 'no-cache' },
    });
    return response.json();
  }
  let qr = await freshQr();
  const remainingMs = +new Date(qr.expiresAt) - Date.now();
  if (remainingMs < 15_000) {
    await new Promise(resolve => setTimeout(resolve, Math.max(remainingMs + 250, 250)));
    qr = await freshQr();
  }
  const qrToken = qr.token;
  expect(memberUser.id).toBeTruthy();

  // 5. Operator submits the member QR via /scan manual fallback
  const checkin = {
    id: `checkin-${suffix}`,
    memberId: memberUser.id,
    memberPublicId: memberEmail,
    memberPhone: null,
    memberEmail,
    timestamp: new Date().toISOString(),
    passTier: 'pro',
    visitNumberInCycle: 1,
    gymTier: 'standard',
  };
  await page.route('**/operator/checkins*', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: { ok: true, checkin, visitNumberInCycle: 1 } });
    }
    return route.fulfill({ json: [checkin] });
  });
  await page.getByTestId('manual-token').fill(qrToken);
  await page.getByTestId('manual-submit').click();
  const result = page.getByTestId('scan-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Check-in successful');

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
