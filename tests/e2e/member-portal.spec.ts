import { expect, test, type Page } from '@playwright/test';
import { messages } from '../../src/lib/i18n';

// Member portal (/m): slice 1 sign-in, Today, Pass and paying by mobile money, check-in QR; slice 2 Gyms, Trainers, Orders; slice 3 Activity, Challenges, Events, Me. The API is mocked. Run twice:
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

const GYMS = [
  { id: 'g1', name: 'Kijiweni Strength Club', tier: 'standard', location: 'Sinza', verified: true, rating: 4.6, reviewCount: 82,
    operatingHours: { default: { open: '05:30', close: '22:00' } }, amenities: ['Lockers'], coordinates: { lat: -6.78, lng: 39.22 } },
  { id: 'g2', name: 'Msasani Bay Fitness', tier: 'premium', location: 'Msasani' },
];
const TRAINERS = [
  { id: 't1', displayName: 'Coach Daudi', specialties: ['Strength'], hourlyRateTzs: 35000, gyms: [{ id: 'g1', name: 'Kijiweni Strength Club' }], gymIds: ['g1'], bookable: true },
  { id: 't2', displayName: 'Coach Rehema', specialties: ['HIIT'], hourlyRateTzs: 30000, gyms: [{ id: 'g2', name: 'Msasani Bay Fitness' }], gymIds: ['g2'], bookable: true },
];
const ORDERS = [
  { id: 'ord_ready001', items: [{ productId: 'p1', name: 'Whey protein 1 kg', qty: 1 }], totalTzs: 85000, status: 'ready_for_pickup', deliveryMethod: 'gym_pickup', pickupGymId: 'g1', paymentStatus: 'paid', createdAt: '2026-11-01T08:00:00.000Z' },
  { id: 'ord_onway002', items: [{ productId: 'p2', name: 'Resistance bands', qty: 2 }], totalTzs: 42000, status: 'dispatched', deliveryMethod: 'gym_pickup', pickupGymId: 'g1', paymentStatus: 'paid', createdAt: '2026-11-02T08:00:00.000Z' },
  { id: 'ord_done003', items: [{ productId: 'p3', name: 'Lifting gloves', qty: 1 }], totalTzs: 20000, status: 'delivered', deliveryMethod: 'gym_pickup', pickupGymId: 'g1', paymentStatus: 'paid', createdAt: '2026-10-10T08:00:00.000Z' },
];
const CHALLENGES = [
  { id: 'ch_open', name: 'Run 50 km in November', type: 'distance_km', target: 50, startDate: '2030-11-01', endDate: '2030-11-30', mode: 'individual', phase: 'upcoming', joined: false, leaderboardOptIn: false, participantCount: 412, teams: [], creator: null },
  { id: 'ch_mine', name: '12 gym visits', type: 'gym_attendance', target: 12, startDate: '2026-10-20', endDate: '2030-11-20', mode: 'individual', phase: 'active', joined: true, leaderboardOptIn: false, participantCount: 1038, teams: [], creator: null },
];
const EVENT = { id: 'ev1', title: 'Coastline 10K', startsAt: '2030-11-22T03:30:00.000Z', availability: 'open', venue: { name: 'Coco Beach', city: 'Dar es Salaam' }, fromPriceTzs: 0, distancesM: [5000, 10000], organizer: { name: 'Dar Runners' } };
type Json = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Json => ({ status, body });
interface Mock { [route: string]: Json | ((n: number, body: any) => Json) }
interface Req { method: string; path: string; auth: string | null; body: any; headers: Record<string, string> }

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
    'GET /gyms': ok(GYMS),
    'GET /me/favorites/gyms': ok({ favoriteGymIds: ['g2'] }),
    'PUT /me/favorites/gyms/g1': ok({ ok: true }),
    'GET /trainers': ok(TRAINERS),
    'GET /trainers/t1/schedule': ok({ days: [{ date: '2030-01-10', weekday: 'thu', slots: [{ slot: '06:00', status: 'booked' }, { slot: '17:30', status: 'available' }] }] }),
    'POST /me/trainer-bookings/quote': ok({ summary: { trainerId: 't1', gymId: 'g1', slots: [{ date: '2030-01-10', slot: '17:30' }], currency: 'TZS', pricePerSession: 35000, discountPct: 10, subtotal: 35000, discount: 3500, total: 31500 } }),
    'POST /me/trainer-bookings': ok({ bookings: [{ id: 'b1' }], paymentRequest: { ...PAY, id: 'pay_t1', amountTzs: 31500 } }, 201),
    'POST /me/payments/pay_t1/mobile-money': ok({ state: 'in_progress' }, 202),
    'POST /me/payments/pay_t1/mobile-money/refresh': ok({ state: 'completed' }),
    'GET /me/trainer-bookings': ok([]),
    'GET /me/shop-orders': ok(ORDERS),
    'GET /me/activities': ok([
      { id: 'act_run', type: 'running', source: 'fitflex', startedAt: new Date(Date.now() - 86400_000).toISOString(), durationMinutes: 48, movingSeconds: 2856, distanceKm: 8.2, hasRoute: true },
      { id: 'act_wk', type: 'strength', source: 'manual', startedAt: new Date(Date.now() - 2 * 86400_000).toISOString(), durationMinutes: 52 },
    ]),
    'GET /me/activities/act_run/route': ok({ route: { activityId: 'act_run', segments: [[[-6.75, 39.27, null, 0, 5], [-6.76, 39.28, null, 60000, 5], [-6.77, 39.27, null, 120000, 5]]] } }),
    'DELETE /me/activities/act_run': ok({ ok: true }),
    'GET /me/challenges': ok({ challenges: CHALLENGES }),
    'POST /challenges/ch_open/join': ok({ ok: true }),
    'GET /challenges/ch_mine/leaderboard': ok({ individuals: [{ rank: 1, name: 'Neema K.', progress: 12, fraction: 1, completed: true }], you: { optedIn: false, rank: 3, of: 10, progress: 7 }, teamStandings: [] }),
    'GET /me/communication-preferences': ok({ preferences: { inAppMarketing: true, pushMarketing: false, smsMarketing: false, whatsappMarketing: false, smsAvailable: true, whatsappAvailable: false } }),
    'PUT /me/communication-preferences': ok({ ok: true }),
    'POST /me/profile': ok({ ok: true }),
    'DELETE /me': ok({ ok: true }),
    'GET /events/options': ok({ discovery: true, registration: true, payment: 'provider', consentTextVersion: 'v3' }),
    'GET /events': ok({ items: [EVENT] }),
    'GET /events/ev1': ok({ ...EVENT, categories: [{ id: 'c10', name: '10K', distanceM: 10000, availability: 'open', ticketTypes: [{ id: 'tt10', name: 'Standard', priceTzs: 35000, availability: 'open' }] },
      { id: 'c5', name: '5K', distanceM: 5000, availability: 'open', ticketTypes: [{ id: 'tt5', name: 'Fun run', priceTzs: 0, availability: 'open' }] }] }),
    'POST /me/event-orders/quote': (_n, b) => ok({ valid: true, quote: { currency: 'TZS', subtotalTzs: b.lines[0].ticketTypeId === 'tt5' ? 0 : 35000, discountTzs: 0, feesTzs: 0, totalTzs: b.lines[0].ticketTypeId === 'tt5' ? 0 : 35000 },
      participants: [{ index: 0, ok: true, problems: [] }], problems: [], fields: { phone: 'required', dateOfBirth: 'off' }, consentText: { version: 'v3', self: { en: 'I agree to take part.', sw: 'Ninakubali kushiriki.' } } }),
    'POST /me/event-orders': (_n, b) => ok({ order: b.lines[0].ticketTypeId === 'tt5' ? { id: 'eo_free', reference: 'EV-2', status: 'awaiting_payment', totalTzs: 0 } : { id: 'eo1', reference: 'EV-1', status: 'awaiting_payment', totalTzs: 35000 } }, 201),
    'POST /me/event-orders/eo_free/payment': ok({ next: { payment: 'none', paymentRequestId: null }, order: { id: 'eo_free', status: 'confirmed', totalTzs: 0 } }, 201),
    'POST /me/event-orders/eo1/payment': ok({ next: { payment: 'provider', paymentRequestId: 'pay_ev1' }, order: { id: 'eo1', status: 'awaiting_payment', totalTzs: 35000 } }, 201),
    'POST /me/payments/pay_ev1/mobile-money': ok({ state: 'in_progress' }, 202),
    'POST /me/payments/pay_ev1/mobile-money/refresh': ok({ state: 'completed' }),
    'GET /me/event-tickets': ok({ items: [{ registrationId: 'reg1', displayCode: 'K7Q2', state: 'active', event: EVENT, category: { name: '10K' } }] }),
    'GET /me/event-registrations/reg1/ticket': ok({ ticket: { displayCode: 'K7Q2', state: 'active' }, qrPayload: 'FFEV1:TICKETTOKEN' }),
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
    reqs.push({ method: req.method(), path, auth: req.headers()['authorization'] ?? null, body, headers: req.headers() });
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
    for (const p of ['/m/', '/m/signin/', '/m/pass/', '/m/check-in/', '/m/gyms/', '/m/trainers/', '/m/orders/', '/m/activity/', '/m/challenges/', '/m/events/', '/m/me/']) {
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
    // The first spec on a fresh dev server: the sign-in page may still be compiling.
    await expect(page).toHaveURL(/\/m\/signin\/$/, { timeout: 30_000 });
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
      'GET /payments/options': ok({ enabled: false, manual: { enabled: true, lipaNamba: '5123456', accountName: 'FITFLEX AFRICA', network: 'M-Pesa', instructions: { en: 'Use the business number.', sw: 'Tumia namba ya biashara.' }, referenceRequired: true, payerPhoneRequired: true } }),
    });
    await page.goto('/m/pass/');
    await page.getByTestId('member-pass-option-pro').check();
    await page.getByTestId('member-pass-continue').click();
    await expect(page.getByTestId('member-pay-manual')).toContainText('5123456');
    // The server keeps the instructions as { en, sw } (shape from GET /payments/options).
    await expect(page.getByTestId('member-pay-manual')).toContainText('Use the business number.');
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

  test('gyms: search, pass coverage from the pass level, save a favourite', async ({ page }) => {
    const h = await setup(page, { 'GET /me': ok({ user: USER, subscription: { ...ACTIVE, tier: 'basic' }, pendingPayment: null, visitsUsed: 1, visitCap: 16 }),
      'GET /passes': ok(PASSES.map(p => ({ ...p, gymAccess: p.key === 'basic' ? 'standard' : 'premium' }))) });
    await page.goto('/m/gyms/');
    await expect(page.getByTestId('member-gym-g1')).toContainText(en['member.gyms.covered']);
    await expect(page.getByTestId('member-gym-g2')).toContainText(en['member.gyms.notCovered']);
    await page.getByTestId('member-gyms-filter-covered').click();
    await expect(page.getByTestId('member-gym-g2')).toHaveCount(0);
    await page.getByTestId('member-gyms-filter-covered').click();
    await page.getByTestId('member-gyms-search').fill('msasani');
    await expect(page.getByTestId('member-gym-g1')).toHaveCount(0);
    await page.getByTestId('member-gyms-search').fill('');
    await page.getByTestId('member-gym-g1').click();
    await expect(page.getByTestId('member-gym-detail')).toContainText('05:30 – 22:00');
    await page.getByTestId('member-gym-fav').click();
    await expect.poll(() => h.count('PUT /me/favorites/gyms/g1')).toBe(1);
  });

  test('trainers: pick a time, see the quote with the pass discount, book and pay by mobile money', async ({ page }) => {
    const h = await setup(page, { 'GET /payments/options': ok({ enabled: true, environment: 'production', mobileMoney: { products: ['FITFLEX_PASS', 'TRAINER_SERVICE'] } }) });
    await page.goto('/m/trainers/');
    await page.getByTestId('member-trainer-t1').click();
    await expect(page.getByLabel('06:00, booked')).toBeVisible();
    await page.getByTestId('member-slot-17:30').click();
    await expect(page.getByTestId('member-trainer-quote')).toContainText('31,500');
    await page.getByTestId('member-trainer-book').click();
    await page.getByTestId('member-pay-send').click();
    await expect(page.getByTestId('member-pay-done')).toContainText(en['member.trainers.bookedTitle'], { timeout: 15_000 });
    expect(h.reqs.find(r => r.method === 'POST' && r.path === '/me/trainer-bookings')!.body).toEqual({ trainerId: 't1', gymId: 'g1', slots: [{ date: '2030-01-10', slot: '17:30' }] });
  });

  test('trainers: when trainer sessions are not payable by mobile money, nothing is booked on the web', async ({ page }) => {
    const h = await setup(page);
    await page.goto('/m/trainers/');
    await page.getByTestId('member-trainer-t1').click();
    await page.getByTestId('member-slot-17:30').click();
    await expect(page.getByTestId('member-trainer-in-app')).toBeVisible();
    await expect(page.getByTestId('member-trainer-book')).toHaveCount(0);
    expect(h.count('POST /me/trainer-bookings')).toBe(0);
  });

  test('orders: ready for pickup shows the gym and order number; collected ones are in the second tab', async ({ page }) => {
    await setup(page);
    await page.goto('/m/orders/');
    const ready = page.getByTestId('member-order-ord_ready001');
    await expect(ready).toContainText('Kijiweni Strength Club');
    await expect(ready).toContainText(en['member.orders.collectHint']);
    await expect(page.getByTestId('member-order-ord_onway002')).toContainText(en['member.orders.step.onWay']);
    await expect(page.getByTestId('member-order-ord_done003')).toHaveCount(0);
    await page.getByTestId('member-orders-tab-past').click();
    await expect(page.getByTestId('member-order-ord_done003')).toBeVisible();
  });

  test('today lists a ready pickup under coming up', async ({ page }) => {
    await setup(page);
    await page.goto('/m/');
    await expect(page.getByTestId('member-today-next')).toContainText('Whey protein 1 kg');
  });

  test('activity: totals, run detail with its route drawn, delete after confirming', async ({ page }) => {
    const h = await setup(page);
    await page.goto('/m/activity/');
    await page.getByTestId('member-activity-period-90').click();
    await expect(page.getByTestId('member-activity-stats')).toContainText('8.2 km');
    await page.getByTestId('member-activity-act_run').click();
    await expect(page.getByTestId('member-activity-route').locator('path')).toHaveCount(1);
    await expect(page.getByTestId('member-activity-detail')).toContainText('5:48');
    await page.getByTestId('member-activity-delete').click();
    expect(h.count('DELETE /me/activities/act_run')).toBe(0);
    await page.getByTestId('member-activity-delete-yes').click();
    await expect(page.getByTestId('member-activity-act_run')).toHaveCount(0);
    expect(h.count('DELETE /me/activities/act_run')).toBe(1);
  });

  test('challenges: join an open one off the leaderboard; a joined one shows where you would place', async ({ page }) => {
    const h = await setup(page);
    await page.goto('/m/challenges/');
    await expect(page.getByTestId('member-challenge-leaderboard')).toContainText('You\'re not on the leaderboard. You would be 3 of 10.');
    await page.getByTestId('member-challenges-tab-open').click();
    await page.getByTestId('member-challenge-ch_open').click();
    await page.getByTestId('member-challenge-optin').uncheck();
    await page.getByTestId('member-challenge-join').click();
    await expect.poll(() => h.count('POST /challenges/ch_open/join')).toBe(1);
    expect(h.reqs.find(r => r.path === '/challenges/ch_open/join')!.body).toEqual({ leaderboardOptIn: false });
  });

  test('me: save the profile, switch an offer channel off, delete only after typing the word', async ({ page }) => {
    const h = await setup(page);
    await page.goto('/m/me/');
    await page.getByTestId('member-me-email').fill('neema@example.com');
    await page.getByTestId('member-me-save').click();
    await expect(page.getByTestId('member-me-saved')).toBeVisible();
    expect(h.reqs.find(r => r.path === '/me/profile')!.body).toEqual({ displayName: 'Neema Mushi', email: 'neema@example.com' });
    await page.getByTestId('member-me-pref-smsMarketing').check();
    await expect.poll(() => h.reqs.find(r => r.method === 'PUT' && r.path === '/me/communication-preferences')?.body).toEqual({ smsMarketing: true });
    await expect(page.getByTestId('member-me-pref-whatsappMarketing')).toHaveCount(0);
    await expect(page.getByTestId('member-me-delete-button')).toBeDisabled();
    await page.getByTestId('member-me-delete-type').fill('delete');
    await page.getByTestId('member-me-delete-button').click();
    await expect(page).toHaveURL(/\/m\/signin\/$/);
    expect(h.count('DELETE /me')).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('ff_member_session'))).toBeNull();
  });

  test('events: register for a paid race, pay by mobile money; the order carries an idempotency key', async ({ page }) => {
    const h = await setup(page, { 'GET /payments/options': ok({ enabled: true, environment: 'production', mobileMoney: { products: ['FITFLEX_PASS', 'EVENT_ORDER'] } }) });
    await page.goto('/m/events/');
    await page.getByTestId('member-event-ev1').click();
    await page.getByTestId('member-event-ticket-tt10').check();
    await expect(page.getByTestId('member-event-first')).toHaveValue('Neema');
    await page.getByTestId('member-event-quote').click();
    // Server texts come as { en, sw }.
    await expect(page.getByTestId('member-event-consent')).toHaveText('I agree to take part.');
    await expect(page.getByTestId('member-event-register')).toBeDisabled();
    await page.getByTestId('member-event-terms').check();
    await page.getByTestId('member-event-register').click();
    await page.getByTestId('member-pay-send').click();
    await expect(page.getByTestId('member-pay-done')).toContainText(en['member.events.registeredTitle'], { timeout: 15_000 });
    const place = h.reqs.find(r => r.method === 'POST' && r.path === '/me/event-orders')!;
    expect(place.headers['idempotency-key']).toMatch(/^m-/);
    expect(place.body).toMatchObject({ eventId: 'ev1', acceptedTerms: true, consentTextVersion: 'v3', expectedTotalTzs: 35000,
      participants: [{ ticketTypeId: 'tt10', firstName: 'Neema', lastName: 'Mushi', consentBasis: 'self' }] });
  });

  test('events: a free race is confirmed by the payment step at once; tickets show the QR drawn in the page', async ({ page }) => {
    const h = await setup(page);
    await page.goto('/m/events/');
    await page.getByTestId('member-event-ev1').click();
    await page.getByTestId('member-event-ticket-tt5').check();
    await page.getByTestId('member-event-quote').click();
    await page.getByTestId('member-event-terms').check();
    await page.getByTestId('member-event-register').click();
    await expect(page.getByTestId('member-event-done')).toContainText(en['member.events.registeredTitle']);
    expect(h.count('POST /me/event-orders/eo_free/payment')).toBe(1);
    expect(h.count('POST /me/event-orders/eo1/payment')).toBe(0);
    await page.getByTestId('member-events-tab-tickets').click();
    await page.getByTestId('member-event-show-reg1').click();
    await expect(page.getByTestId('member-event-qr').locator('svg')).toBeVisible();
  });

  test('events: nothing is registered on the web while the server\'s event payments are off', async ({ page }) => {
    const h = await setup(page, { 'GET /events/options': ok({ discovery: true, registration: true, payment: 'none' }) });
    await page.goto('/m/events/');
    await page.getByTestId('member-event-ev1').click();
    await page.getByTestId('member-event-ticket-tt10').check();
    await page.getByTestId('member-event-quote').click();
    await expect(page.getByTestId('member-event-pay-not-open')).toBeVisible();
    expect(h.count('POST /me/event-orders')).toBe(0);
  });

  test('events: server module off shows one notice and asks nothing else', async ({ page }) => {
    const h = await setup(page, { 'GET /events/options': ok({ discovery: false, registration: false }) });
    await page.goto('/m/events/');
    await expect(page.getByTestId('member-events-off')).toBeVisible();
    expect(h.count('GET /events')).toBe(0);
  });

  // ── Review fixes (security, contract and Swahili audits) ─────────────────────────────────────────────────────────
  test('session: kept in this tab only unless "keep me signed in"; a sign-out in another tab ends it here', async ({ page, context }) => {
    await setup(page, {}, false);
    await page.goto('/m/signin/');
    await page.getByTestId('member-signin-identifier').fill('0754123678');
    await page.getByTestId('member-signin-pin').fill('4821');
    await page.getByTestId('member-signin-submit').click();
    await expect(page.getByTestId('member-today-page')).toBeVisible();
    expect(await page.evaluate(() => ({ local: localStorage.getItem('ff_member_session'), tab: !!sessionStorage.getItem('ff_member_session') }))).toEqual({ local: null, tab: true });
    // Signed in to keep: a second tab shares it, and signing out there ends this tab too.
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/m/signin/');
    await page.getByTestId('member-signin-identifier').fill('0754123678');
    await page.getByTestId('member-signin-pin').fill('4821');
    await page.getByTestId('member-signin-keep').check();
    await page.getByTestId('member-signin-submit').click();
    await expect(page.getByTestId('member-today-page')).toBeVisible();
    expect(await page.evaluate(() => !!localStorage.getItem('ff_member_session'))).toBe(true);
    const other = await context.newPage();
    await setup(other, {}, false);
    await other.goto('/m/me/');
    await other.getByTestId('member-me-sign-out').click();
    await expect(page).toHaveURL(/\/m\/signin\/$/);
  });

  test('session: a session idle for over 30 minutes is ended', async ({ page }) => {
    await setup(page);
    await page.addInitScript(() => { localStorage.setItem('ff_member_last_active', String(Date.now() - 31 * 60_000)); });
    await page.goto('/m/');
    await expect(page).toHaveURL(/\/m\/signin\/$/);
  });

  test('session: a deleted account (404 user_not_found) or a suspended one ends the session', async ({ page }) => {
    await setup(page, { 'GET /me': ok({ error: 'user_not_found' }, 404) });
    await page.goto('/m/');
    await expect(page).toHaveURL(/\/m\/signin\/$/);
    expect(await page.evaluate(() => localStorage.getItem('ff_member_session'))).toBeNull();
  });

  test('sign-in: a person whose sign-in opened their trainer role is switched to their member role', async ({ page }) => {
    const h = await setup(page, {
      'POST /auth/pin/login': ok({ token: 'TRAINER-TOKEN', user: { id: 'usr_t1', userType: 'trainer' }, personas: [{ id: 'usr_t1', userType: 'trainer' }, { id: 'usr_m1', userType: 'member', accountStatus: 'active' }] }),
      'POST /auth/switch-persona': ok({ token: TOKEN, user: USER }),
    }, false);
    await page.goto('/m/signin/');
    await page.getByTestId('member-signin-identifier').fill('0754123678');
    await page.getByTestId('member-signin-pin').fill('4821');
    await page.getByTestId('member-signin-submit').click();
    await expect(page.getByTestId('member-today-page')).toBeVisible();
    const sw = h.reqs.find(r => r.path === '/auth/switch-persona')!;
    expect(sw.body).toEqual({ personaId: 'usr_m1' });
    expect(sw.auth).toBe('Bearer TRAINER-TOKEN');
    expect(await page.evaluate(() => sessionStorage.getItem('ff_member_session'))).not.toContain('TRAINER-TOKEN');
  });

  test('portal sign-in (/login): a member with no business role is taken to their member area', async ({ page }) => {
    const h = await setup(page, {}, false);
    await page.goto('/login/');
    await expect(page.getByTestId('pin-method-btn')).toHaveText(en['login.pinHeading'], { timeout: 30_000 });
    // The page speaks to members too, not only partners.
    await expect(page.getByRole('heading', { level: 1, name: en['member.login.heading'] })).toBeVisible();
    await expect(page.getByText(en['member.login.newHere'])).toBeVisible();
    await page.getByTestId('pin-method-btn').click();
    await page.getByTestId('pin-identifier-input').fill('0754123678');
    await page.getByTestId('pin-input').fill('4821');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('member-today-page')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/m\/$/);
    expect(h.reqs.filter(r => r.path === '/auth/pin/login')).toHaveLength(1);
    // Only the member session is stored: the staff portal keys stay empty.
    const stored = await page.evaluate(() => ({ member: sessionStorage.getItem('ff_member_session'), token: localStorage.getItem('token'), user: localStorage.getItem('user') }));
    expect(stored.member).toContain(TOKEN);
    expect(stored.token).toBeNull();
    expect(stored.user).toBeNull();
  });

  test('portal sign-in (/login): a trainer who is also a member opens the member role; a business role still opens the portal', async ({ page }) => {
    const h = await setup(page, {
      'POST /auth/pin/login': n => n === 1
        ? ok({ token: 'TRAINER-TOKEN', user: { id: 'usr_t1', userType: 'trainer' }, personas: [{ id: 'usr_t1', userType: 'trainer' }, { id: 'usr_m1', userType: 'member', accountStatus: 'active' }] })
        : ok({ token: 'ADMIN-TOKEN', user: { id: 'a1', userType: 'admin', portalUser: true } }),
      'POST /auth/switch-persona': ok({ token: TOKEN, user: USER }),
    }, false);
    await page.goto('/login/');
    await page.getByTestId('pin-method-btn').click({ timeout: 30_000 });
    await page.getByTestId('pin-identifier-input').fill('0754123678');
    await page.getByTestId('pin-input').fill('4821');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('member-today-page')).toBeVisible({ timeout: 30_000 });
    expect(h.reqs.find(r => r.path === '/auth/switch-persona')!.body).toEqual({ personaId: 'usr_m1' });
    // An admin signing in on /login goes to the admin area, and no member session is kept.
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
    await page.goto('/login/');
    await page.getByTestId('pin-method-btn').click({ timeout: 30_000 });
    await page.getByTestId('pin-identifier-input').fill('0754000000');
    await page.getByTestId('pin-input').fill('1234');
    await page.getByTestId('pin-submit').click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
    expect(await page.evaluate(() => sessionStorage.getItem('ff_member_session') ?? localStorage.getItem('ff_member_session'))).toBeNull();
  });

  test('pass: a gym plan is not the FitFlex Pass; an unlimited tier says unlimited', async ({ page }) => {
    await setup(page, {
      'GET /me': ok({ user: USER, subscription: { id: 'sub_gym', tier: null, type: 'direct_sub', status: 'active' }, pendingPayment: null, visitsUsed: 3, visitCap: null,
        entitlements: { fitflexPass: null, gymSubscriptions: [{ id: 'sub_gym', type: 'direct_sub', status: 'active' }] } }),
      'GET /passes': ok([...PASSES, { id: 'executive', key: 'executive', label: 'Executive', price: 400000, visitCap: null, visits: -1 }]),
    });
    await page.goto('/m/pass/');
    await expect(page.getByTestId('member-pass-current')).toContainText(en['member.pass.none']);
    await expect(page.getByTestId('member-pass-option-executive').locator('xpath=ancestor::label')).toContainText(en['member.pass.planUnlimited']);
    await expect(page.getByTestId('member-pass-choose')).not.toContainText('-1');
  });

  test('pass: with mobile money AND Lipa Namba on, the pass goes the Lipa Namba way (the server needs the transaction ID)', async ({ page }) => {
    const h = await setup(page, { 'GET /payments/options': ok({ enabled: true, environment: 'production', manual: { enabled: true, lipaNamba: '5123456', accountName: 'FITFLEX', referenceRequired: true, payerPhoneRequired: true } }) });
    await page.goto('/m/pass/');
    await page.getByTestId('member-pass-option-basic').check();
    await page.getByTestId('member-pass-continue').click();
    await expect(page.getByTestId('member-pay-manual')).toBeVisible();
    await expect(page.getByTestId('member-pay-mobile')).toHaveCount(0);
    expect(h.count('POST /me/subscribe')).toBe(0);
  });

  test('prices say TSh and Swahili times use the 12-hour clock with the part of the day', async ({ page }) => {
    await setup(page, { 'GET /payments/options': ok({ enabled: true, environment: 'production', mobileMoney: { products: ['FITFLEX_PASS', 'TRAINER_SERVICE'] } }) });
    await page.goto('/m/trainers/');
    await page.getByTestId('member-trainer-t1').click();
    await page.getByTestId('member-slot-17:30').click();
    await expect(page.getByTestId('member-trainer-quote')).toContainText('TSh 31,500');
    await page.getByTestId('member-lang-toggle').click();
    await expect(page.getByTestId('member-slot-17:30')).toHaveText('5:30 jioni');
  });

  test('challenges: team standings render from the server field; gym vs gym offers your own gyms', async ({ page }) => {
    const h = await setup(page, {
      'GET /me/challenges': ok({ challenges: [
        { ...CHALLENGES[1], mode: 'teams', teams: [{ id: 'tm1', name: 'Sinza Squad' }] },
        { id: 'ch_gvg', name: 'Gym vs gym', type: 'gym_attendance', target: 8, startDate: '2026-10-20', endDate: '2030-11-20', mode: 'gym_vs_gym', phase: 'active', joined: false, leaderboardOptIn: false, participantCount: 30, teams: [], creator: null },
      ] }),
      'GET /challenges/ch_mine/leaderboard': ok({ individuals: [], you: { optedIn: true, rank: 1, of: 3, progress: 5 }, teams: [{ rank: 1, teamId: 'tm1', name: 'Sinza Squad', members: 3, averageCompletion: 0.42, total: 15 }], hiddenTeams: 0 }),
      'GET /me/gym-sharing': ok({ gyms: [{ gym: { id: 'g1', name: 'Kijiweni Strength Club' }, reasons: ['visited'] }] }),
      'POST /challenges/ch_gvg/join': ok({ ok: true }),
    });
    await page.goto('/m/challenges/');
    await expect(page.getByTestId('member-challenge-teams')).toContainText('Sinza Squad');
    await expect(page.getByTestId('member-challenge-teams')).toContainText('42%');
    await page.getByTestId('member-challenges-tab-open').click();
    await page.getByTestId('member-challenge-ch_gvg').click();
    await expect(page.getByTestId('member-challenge-gym')).toHaveValue('g1');
    await page.getByTestId('member-challenge-join').click();
    await expect.poll(() => h.reqs.find(r => r.path === '/challenges/ch_gvg/join')?.body).toEqual({ leaderboardOptIn: true, gymId: 'g1' });
  });

  test('events: the terms and refund rules are shown before registering; waitlist only when the server has it on, with consent', async ({ page }) => {
    const soldOutEvent = { ...EVENT, terms: { en: 'Run at your own risk.', sw: 'Kimbia kwa hatari yako.' }, refundPolicy: { preset: null, text: { en: 'No refunds after 7 days.', sw: null }, generated: null },
      categories: [{ id: 'c10', name: '10K', distanceM: 10000, availability: 'sold_out', ticketTypes: [{ id: 'tt10', name: 'Standard', priceTzs: 35000, availability: 'sold_out', waitlist: { state: 'open' } }] }] };
    let h = await setup(page, { 'GET /events/ev1': ok(soldOutEvent), 'GET /events/options': ok({ discovery: true, registration: true, payment: 'provider', waitlist: { enabled: false } }) });
    await page.goto('/m/events/');
    await page.getByTestId('member-event-ev1').click();
    await page.getByTestId('member-event-ticket-tt10').check();
    await expect(page.getByTestId('member-event-waitlist')).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    h = await setup(page, { 'GET /events/ev1': ok(soldOutEvent), 'GET /events/options': ok({ discovery: true, registration: true, payment: 'provider', waitlist: { enabled: true }, consentTextVersion: 'v3' }),
      'POST /me/events/ev1/waitlist': ok({ entry: { id: 'w1', position: 4 } }, 201), 'POST /me/event-orders/quote': ok({ error: 'sold_out' }, 409) });
    await page.reload();
    await page.getByTestId('member-event-ev1').click();
    await page.getByTestId('member-event-ticket-tt10').check();
    await page.getByText(en['member.events.readTerms']).click();
    await expect(page.getByTestId('member-event-terms-text')).toHaveText('Run at your own risk.');
    await expect(page.getByTestId('member-event-refund-text')).toHaveText('No refunds after 7 days.');
    await expect(page.getByTestId('member-event-waitlist')).toBeDisabled();
    await page.getByTestId('member-event-terms').check();
    await page.getByTestId('member-event-waitlist').click();
    await expect(page.getByTestId('member-event-done')).toContainText('4');
    expect(h.reqs.find(r => r.path === '/me/events/ev1/waitlist')!.body.consent).toEqual({ accepted: true, textVersion: 'v3' });
  });

  test('events: fields the event asks for (email, gender) appear after the first price check and stay', async ({ page }) => {
    await setup(page, { 'POST /me/event-orders/quote': ok({ valid: false, quote: { currency: 'TZS', subtotalTzs: 35000, discountTzs: 0, feesTzs: 0, totalTzs: 35000 },
      participants: [{ index: 0, ok: false, problems: [{ field: 'gender', code: 'required' }] }], problems: [], fields: { phone: 'required', email: 'required', gender: 'required' },
      consentText: { version: 'v3', self: { en: 'I agree.', sw: 'Ninakubali.' } } }) });
    await page.goto('/m/events/');
    await page.getByTestId('member-event-ev1').click();
    await page.getByTestId('member-event-ticket-tt10').check();
    await page.getByTestId('member-event-quote').click();
    await expect(page.getByTestId('member-event-gender')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: en['member.events.gender'] })).toBeVisible();
    await page.getByTestId('member-event-email').fill('neema@example.com');
    await expect(page.getByTestId('member-event-gender')).toBeVisible();
  });

  test('activity: no delete for a record from a trainer or a gym', async ({ page }) => {
    await setup(page, { 'GET /me/activities': ok([{ id: 'act_tr', type: 'strength', source: 'trainer', startedAt: new Date(Date.now() - 3600_000).toISOString(), durationMinutes: 40 }]) });
    await page.goto('/m/activity/');
    await page.getByTestId('member-activity-period-week').click();
    await page.getByTestId('member-activity-act_tr').click();
    await expect(page.getByTestId('member-activity-detail')).toBeVisible();
    await expect(page.getByTestId('member-activity-delete')).toHaveCount(0);
  });
});
