import { expect, test, type Page } from '@playwright/test';
import { messages } from '../../src/lib/i18n';

// Member portal slice 1 (/m): sign-in, Today, Pass and paying by mobile money, check-in QR. The API is mocked. Run twice:
//   npx playwright test --config playwright.member-portal.config.ts                        (flag on)
//   MEMBER_PORTAL_FLAG=false npx playwright test --config playwright.member-portal.config.ts (flag off)
const FLAG_ON = (process.env.MEMBER_PORTAL_FLAG ?? 'true') === 'true';
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const TOKEN = 'MEMBERTOKEN-abc';
const QR = 'usr_m1.29384756.SIGSIGSIGSIGSIG1';
const en = messages.en;
const sw = messages.sw;

const PASSES = [
  { id: 'basic', key: 'basic', label: 'Basic', price: 60000, visitCap: 16 },
  { id: 'pro', key: 'pro', label: 'Pro', price: 150000, visitCap: 18 },
  { id: 'premium', key: 'premium', label: 'Premium', price: 250000, visitCap: 20 },
];
const USER = { id: 'usr_m1', userType: 'member', name: 'Neema Mushi', phone: '0754123678', publicId: 'FF-4821' };
const ACTIVE = { id: 'sub1', tier: 'pro', type: 'platform_pass', status: 'active', expiresAt: '2030-11-18T21:00:00.000Z' };
const PAY = { id: 'pay_1', tier: 'basic', amountTzs: 60000, status: 'pending', requestedAt: '2026-11-03T08:00:00.000Z', provider: 'admin_approved', reference: null };

type Json = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Json => ({ status, body });
interface Mock { [route: string]: Json | ((n: number, body: any) => Json) }
interface Req { method: string; path: string; auth: string | null; body: any }

function base(): Mock {
  return {
    'GET /auth/options': ok({ pinLogin: true }),
    'POST /auth/pin/login': ok({ token: TOKEN, user: USER }),
    'GET /me': ok({ user: USER, subscription: null, pendingPayment: null, visitsUsed: 0, visitCap: null }),
    'GET /passes': ok(PASSES),
    'GET /me/upgrade-options': ok({ options: [{ tier: 'premium', label: 'Premium', monthlyPrice: 250000, visits: 20, differenceTzs: 100000 }] }),
    'GET /payments/options': ok({ enabled: true, provider: 'tunzaa', environment: 'production' }),
    'GET /me/payments': ok([]),
    'GET /me/checkins': ok([{ id: 'c1', timestamp: '2026-11-02T06:10:00.000Z', gym: { id: 'g1', name: 'Kijiweni Strength Club' } }]),
    'GET /me/qr': ok({ token: QR, expiresAt: new Date(Date.now() + 60_000).toISOString(), rotatesEverySeconds: 60 }),
    'POST /me/subscribe': ok({ subscription: { id: 'sub2' }, paymentRequest: PAY }, 202),
    'POST /me/payments/pay_1/mobile-money': ok({ state: 'in_progress', paymentRequest: PAY }, 202),
    'POST /me/payments/pay_1/mobile-money/refresh': n => ok({ state: n < 2 ? 'in_progress' : 'completed', paymentRequest: PAY }),
  };
}

async function setup(page: Page, over: Mock = {}, signedIn = true) {
  const m = { ...base(), ...over };
  const reqs: Req[] = [];
  const counts: Record<string, number> = {};
  const urls: string[] = [];
  page.on('framenavigated', f => urls.push(f.url()));
  await page.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    let body: any = null;
    try { body = req.postData() ? JSON.parse(req.postData()!) : null; } catch { /* not json */ }
    const key = `${req.method()} ${path}`;
    reqs.push({ method: req.method(), path, auth: req.headers()['authorization'] ?? null, body });
    counts[key] = (counts[key] ?? 0) + 1;
    const v = m[key];
    const r = !v ? ok({ error: 'not_found' }, 404) : typeof v === 'function' ? v(counts[key], body) : v;
    await route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.body) });
  });
  if (signedIn) {
    await page.addInitScript(([t, u]) => { localStorage.setItem('ff_member_session', JSON.stringify({ token: t, user: u })); }, [TOKEN, USER] as const);
  }
  return { reqs, urls, count: (k: string) => counts[k] ?? 0 };
}

test.describe('member portal, flag off', () => {
  test.skip(FLAG_ON, 'flag-off build only');
  test('every page shows "not available yet" and makes no request', async ({ page }) => {
    const h = await setup(page);
    for (const p of ['/m/', '/m/signin/', '/m/pass/', '/m/check-in/']) {
      await page.goto(p);
      await expect(page.getByTestId('member-flag-off')).toBeVisible();
    }
    expect(h.reqs).toHaveLength(0);
  });
});

test.describe('member portal, flag on', () => {
  test.skip(!FLAG_ON, 'flag-on build only');

  test('signed out: /m sends to sign-in; PIN sign-in opens Today and stores only the member session', async ({ page }) => {
    const h = await setup(page, {}, false);
    await page.goto('/m/');
    await expect(page).toHaveURL(/\/m\/signin\/$/);
    await page.getByTestId('member-signin-identifier').fill('0754123678');
    await page.getByTestId('member-signin-pin').fill('4821');
    await page.getByTestId('member-signin-submit').click();
    await expect(page.getByTestId('member-today-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hello, Neema' })).toBeVisible();
    const login = h.reqs.find(r => r.path === '/auth/pin/login')!;
    expect(login.body).toEqual({ phone: '0754123678', pin: '4821' });
    expect(h.reqs.find(r => r.path === '/me')!.auth).toBe(`Bearer ${TOKEN}`);
    // The staff portal session keys are never written, and no PIN or token goes in an address.
    const stored = await page.evaluate(() => ({ token: localStorage.getItem('token'), user: localStorage.getItem('user') }));
    expect(stored).toEqual({ token: null, user: null });
    for (const u of h.urls) { expect(u).not.toContain('4821'); expect(u).not.toContain(TOKEN); }
  });

  test('a wrong PIN shows the message; a staff account is turned away', async ({ page }) => {
    await setup(page, {
      'POST /auth/pin/login': n => n === 1 ? ok({ error: 'invalid_credentials' }, 401) : ok({ token: 'STAFF', user: { id: 'a1', userType: 'admin' } }),
    }, false);
    await page.goto('/m/signin/');
    await page.getByTestId('member-signin-identifier').fill('0754123678');
    await page.getByTestId('member-signin-pin').fill('1111');
    await page.getByTestId('member-signin-submit').click();
    await expect(page.getByTestId('member-signin-error')).toHaveText(en['web.checkin.err.wrong_pin']);
    await page.getByTestId('member-signin-pin').fill('2222');
    await page.getByTestId('member-signin-submit').click();
    await expect(page.getByTestId('member-signin-error')).toHaveText(en['member.signin.notMember']);
    expect(await page.evaluate(() => localStorage.getItem('ff_member_session'))).toBeNull();
  });

  test('no pass: choose Basic, pay by mobile money, confirmed only when the server says completed', async ({ page }) => {
    const h = await setup(page);
    await page.goto('/m/pass/');
    await page.getByTestId('member-pass-option-basic').check();
    await page.getByTestId('member-pass-continue').click();
    await expect(page.getByTestId('member-pay-phone')).toHaveValue('0754123678');
    await page.getByTestId('member-pay-send').click();
    await expect(page.getByTestId('member-pay-waiting')).toBeVisible();
    await expect(page.getByTestId('member-pay-done')).toBeVisible({ timeout: 20_000 });
    expect(h.reqs.find(r => r.path === '/me/subscribe')!.body).toEqual({ type: 'platform_pass', tier: 'basic' });
    expect(h.reqs.find(r => r.path === '/me/payments/pay_1/mobile-money')!.body).toEqual({ phone: '0754123678' });
    expect(h.count('POST /me/payments/pay_1/mobile-money/refresh')).toBeGreaterThanOrEqual(2);
  });

  test('a failed payment says no money was taken and retries the same request', async ({ page }) => {
    const h = await setup(page, { 'POST /me/payments/pay_1/mobile-money/refresh': ok({ state: 'failed', paymentRequest: PAY }) });
    await page.goto('/m/pass/');
    await page.getByTestId('member-pass-option-basic').check();
    await page.getByTestId('member-pass-continue').click();
    await page.getByTestId('member-pay-send').click();
    await expect(page.getByTestId('member-pay-failed')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: en['member.pay.tryAgain'] }).click();
    await page.getByTestId('member-pay-send').click();
    await expect(page.getByTestId('member-pay-waiting')).toBeVisible();
    expect(h.count('POST /me/subscribe')).toBe(1);
    expect(h.count('POST /me/payments/pay_1/mobile-money')).toBe(2);
  });

  test('active pass: shows visits and offers moving up for the difference', async ({ page }) => {
    await setup(page, { 'GET /me': ok({ user: USER, subscription: ACTIVE, pendingPayment: null, visitsUsed: 11, visitCap: 18 }) });
    await page.goto('/m/pass/');
    await expect(page.getByTestId('member-pass-current')).toContainText('11 of 18 visits used');
    await expect(page.getByTestId('member-pass-choose')).toContainText(en['member.pass.upgradeTitle']);
    await expect(page.getByTestId('member-pass-option-premium')).toBeVisible();
    await expect(page.getByTestId('member-pass-option-basic')).toHaveCount(0);
  });

  test('manual payment mode: Lipa Namba, transaction ID sent with the request', async ({ page }) => {
    const h = await setup(page, {
      'GET /payments/options': ok({ enabled: false, manual: { enabled: true, lipaNamba: '5123456', accountName: 'FITFLEX AFRICA', network: 'M-Pesa' } }),
    });
    await page.goto('/m/pass/');
    await page.getByTestId('member-pass-option-pro').check();
    await page.getByTestId('member-pass-continue').click();
    await expect(page.getByTestId('member-pay-manual')).toContainText('5123456');
    await page.getByTestId('member-pay-reference').fill('QGH7XK2L9P');
    await page.getByTestId('member-pay-manual-submit').click();
    await expect(page.getByTestId('member-pay-manual_done')).toBeVisible();
    expect(h.reqs.find(r => r.path === '/me/subscribe')!.body).toEqual({ type: 'platform_pass', tier: 'pro', reference: 'QGH7XK2L9P', payerPhone: '0754123678' });
  });

  test('check-in QR is drawn in the page (no image service) and the token never appears in an address', async ({ page }) => {
    const h = await setup(page, { 'GET /me': ok({ user: USER, subscription: ACTIVE, pendingPayment: null, visitsUsed: 1, visitCap: 18 }) });
    const external: string[] = [];
    page.on('request', r => { if (!r.url().startsWith('http://localhost')) external.push(r.url()); });
    await page.goto('/m/check-in/');
    await expect(page.getByTestId('member-qr').locator('svg')).toBeVisible();
    await expect(page.getByTestId('member-qr')).toContainText('FF-4821');
    expect(external).toEqual([]);
    for (const u of h.urls) expect(u).not.toContain(QR);
  });

  test('a 401 ends only the member session and returns to sign-in', async ({ page }) => {
    await setup(page, { 'GET /me': ok({ error: 'unauthorized' }, 401) });
    await page.addInitScript(() => { localStorage.setItem('token', 'STAFF-TOKEN'); localStorage.setItem('user', '{"id":"a1","userType":"admin"}'); });
    await page.goto('/m/');
    await expect(page).toHaveURL(/\/m\/signin\/$/);
    const s = await page.evaluate(() => ({ member: localStorage.getItem('ff_member_session'), staff: localStorage.getItem('token') }));
    expect(s).toEqual({ member: null, staff: 'STAFF-TOKEN' });
  });

  test('Swahili: the language switch translates the member pages', async ({ page }) => {
    await setup(page);
    await page.goto('/m/');
    await page.getByTestId('member-lang-toggle').click();
    await expect(page.getByRole('link', { name: sw['member.nav.pass'], exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Habari, Neema' })).toBeVisible();
  });
});
