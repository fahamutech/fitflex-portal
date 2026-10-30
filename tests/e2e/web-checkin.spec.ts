import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { messages } from '../../src/lib/i18n';
import { ERROR_KEYS, formatEat, newIdempotencyKey, normaliseError, type CheckinCode } from '../../src/lib/web-checkin';

// Browser gym check-in /g/signin, /g/confirm, /g/done (backend functions#284). The API is mocked. Run twice:
//   npx playwright test --config playwright.web-checkin.config.ts                      (flag on)
//   WEB_CHECKIN_FLAG=false npx playwright test --config playwright.web-checkin.config.ts (flag off)
const FLAG_ON = (process.env.WEB_CHECKIN_FLAG ?? 'true') === 'true';
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const Q = 'fitflex:gym:gym_001:SECRETSIG';
const PIN = '4821';
const LONG = 'LONGTOKEN-abc123';
const PURPOSE = 'PURPOSETOKEN-xyz789';
const INTENT1 = 'INTENTTOKEN-one';
const INTENT2 = 'INTENTTOKEN-two';
const en = messages.en;
const sw = messages.sw;

const PROFILE = {
  lang: 'en', gym: { publicRef: 'abc123', name: 'Iron Temple', description: null, tier: 'standard', venueType: 'physical', verified: true, rating: null, reviewCount: null,
    photos: [], thumbnail: null, area: null, address: null, lat: null, lng: null, directions: null, facilities: [], equipment: [], amenities: [], services: [],
    operatingHours: null, classes: [], trainers: [] },
  membership: { currency: 'TZS', gymPlans: [], passTiers: [] },
};

type Json = { status: number; body: unknown; delayMs?: number };
interface Mock {
  options: Json; login: Json | ((n: number, body: any) => Json); session: Json; intent: Json | ((n: number) => Json);
  preview: Json | ((n: number) => Json); confirm: Json | ((n: number) => Json);
}
const ok = (body: unknown, status = 200): Json => ({ status, body });
const base = (): Mock => ({
  options: ok({ pinLogin: true, smsCodes: true, emailCodes: false }),
  login: ok({ token: LONG, user: { id: 'u1', userType: 'member' }, partnerVerified: false }),
  session: ok({ token: PURPOSE, expiresAt: '2030-01-01T00:00:00.000Z' }),
  intent: n => ok({ intentToken: n === 1 ? INTENT1 : INTENT2, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), gym: { publicRef: 'abc123', name: 'Iron Temple' } }),
  preview: ok({ eligible: true, visitsLeft: 7, alreadyCheckedIn: false, gym: { name: 'Iron Temple' } }),
  confirm: ok({ ok: true, idempotent: false, checkin: { id: 'c1', timestamp: '2026-10-29T11:05:00.000Z', gym: { name: 'Iron Temple' } }, visitNumberInCycle: 3 }),
});

interface Req { method: string; path: string; headers: Record<string, string>; body: any }
interface Harness { reqs: Req[]; count: (method: string, path: string) => number; consoleLines: string[]; urls: string[] }

async function setup(page: Page, over: Partial<Mock> = {}): Promise<Harness> {
  const m = { ...base(), ...over };
  const h: Harness = { reqs: [], consoleLines: [], urls: [], count: (method, path) => h.reqs.filter(r => r.method === method && r.path === path).length };
  page.on('console', msg => h.consoleLines.push(msg.text()));
  page.on('framenavigated', f => h.urls.push(f.url()));
  // Nothing may reach a real service.
  await page.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
  const pick = (v: Json | ((n: number, b?: any) => Json), n: number, b?: any) => (typeof v === 'function' ? v(n, b) : v);
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    let body: any = null;
    try { body = req.postData() ? JSON.parse(req.postData()!) : null; } catch { /* not json */ }
    h.reqs.push({ method, path, headers: req.headers(), body });
    const n = h.count(method, path);
    let r: Json | null = null;
    if (path === '/public/gyms/resolve') r = ok(PROFILE);
    else if (path === '/auth/options') r = m.options;
    else if (path === '/auth/pin/login') r = pick(m.login, n, body);
    else if (path === '/auth/web-checkin/session') r = m.session;
    else if (path === '/public/web-checkin/intent') r = pick(m.intent, n);
    else if (path === '/me/web-checkins/preview') r = pick(m.preview, n);
    else if (path === '/me/web-checkins') r = pick(m.confirm, n);
    if (!r) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}', headers: { 'access-control-allow-origin': '*' } });
    if (r.delayMs) await new Promise(res => setTimeout(res, r!.delayMs));
    await route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.body) });
  });
  return h;
}

const lang = async (page: Page, l: string) => page.addInitScript(x => { Object.defineProperty(navigator, 'language', { get: () => x }); }, l);
const openGym = async (page: Page) => { await page.goto(`/g/?q=${encodeURIComponent(Q)}`); await page.getByTestId('web-gym-name').waitFor(); };
const startVisit = async (page: Page) => { await openGym(page); await page.getByTestId('web-gym-visit').click(); await expect(page).toHaveURL(/\/g\/signin\/$/); };
async function signIn(page: Page, pin = PIN, id = '0712345678') {
  await page.getByTestId('web-checkin-identifier').fill(id);
  await page.getByTestId('web-checkin-pin').fill(pin);
  await page.getByTestId('web-checkin-signin-submit').click();
}
const toConfirm = async (page: Page) => { await startVisit(page); await expect(page.getByTestId('web-checkin-pin')).toBeVisible(); await signIn(page); await expect(page.getByTestId('web-checkin-confirm-title')).toBeVisible(); };

test.use({ serviceWorkers: 'block' });

test.describe('pure helpers', () => {
  const cases: Array<[number, unknown, CheckinCode]> = [
    [0, null, 'network'],
    [401, { error: 'invalid_credentials' }, 'wrong_pin'],
    [429, { error: 'too_many_attempts', retryAfterSeconds: 300 }, 'locked'],
    [403, { error: 'pin_reset_required' }, 'pin_reset_required'],
    [429, { error: 'rate_limited', retryAfterSeconds: 30 }, 'rate_limited'],
    [404, { error: 'not_found' }, 'unavailable'],
    [404, null, 'unavailable'],
    [500, { error: 'server_error' }, 'server_error'],
    [502, null, 'server_error'],
    [401, null, 'unauthorized'],
    [403, { error: 'forbidden' }, 'role_refused'],
    [409, { ok: false, failure: 'visits_exhausted' }, 'visits_exhausted'],
    [409, { ok: false, failure: 'intent_expired' }, 'intent_expired'],
    [409, { ok: false, failure: 'intent_used' }, 'intent_used'],
    [400, { ok: false, error: 'confirmation_required' }, 'confirmation_required'],
    [400, { ok: false, error: 'invalid_idempotency_key' }, 'invalid_idempotency_key'],
    [401, { error: 'session_ended' }, 'unauthorized'],
    [403, { error: 'account_suspended' }, 'account_unavailable'],
    [418, { error: 'something_new' }, 'unknown'],
    [200, undefined, 'unknown'],
  ];
  for (const [status, body, code] of cases) {
    test(`normaliseError(${status}, ${JSON.stringify(body)}) -> ${code}`, () => { expect(normaliseError(status, body)).toBe(code); });
  }
  test('every code has an English and a Swahili message; every web.checkin key has both', () => {
    for (const k of Object.values(ERROR_KEYS)) { expect(en[k]).toBeTruthy(); expect(sw[k]).toBeTruthy(); }
    const enKeys = Object.keys(en).filter(k => k.startsWith('web.checkin.'));
    expect(enKeys.length).toBeGreaterThan(50);
    for (const k of enKeys) { expect((sw as Record<string, string>)[k], k).toBeTruthy(); }
    expect(Object.keys(sw).filter(k => k.startsWith('web.checkin.'))).toHaveLength(enKeys.length);
  });
  test('idempotency key is 8-100 safe characters and differs each time; EAT formatting', () => {
    const a = newIdempotencyKey(); const b = newIdempotencyKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(a).not.toBe(b);
    expect(formatEat('2026-10-29T11:05:00.000Z', 'en')).toBe('29 Oct, 14:05');
    // Swahili month names come from our own table, not the browser's ICU data; midnight is 00:xx (h23), not 24:xx.
    expect(formatEat('2026-03-04T21:07:00.000Z', 'sw')).toBe('5 Mac, 00:07');
    expect(formatEat('2026-12-31T11:00:00.000Z', 'sw')).toBe('31 Des, 14:00');
    expect(en['web.checkin.tz.eat']).toBe('EAT');
    expect(formatEat('nonsense', 'en')).toBeNull();
  });
});

test.describe('service worker', () => {
  // Runs public/sw.js in a sandbox and fires fetch events: /g pages and any query string must never touch Cache Storage.
  function run(url: string, mode = 'navigate') {
    const src = readFileSync('public/sw.js', 'utf8');
    const listeners: Record<string, (e: any) => void> = {};
    const opened: string[] = [];
    const self = { location: { origin: 'https://portal.example' }, addEventListener: (t: string, f: (e: any) => void) => { listeners[t] = f; }, skipWaiting() {}, clients: { claim() {} } };
    const ctx = { self, URL, caches: { open: async (n: string) => { opened.push(n); return { put: async () => {}, addAll: async () => {} }; }, match: async () => undefined, keys: async () => [] }, fetch: async () => ({ ok: true, clone: () => ({}) }) };
    vm.runInNewContext(src, ctx);
    let responded = false;
    listeners.fetch({ request: { url, method: 'GET', mode }, respondWith: () => { responded = true; } });
    return { responded, opened };
  }
  for (const u of ['https://portal.example/g/?q=fitflex%3Agym%3Ax%3Asig', 'https://portal.example/g/', 'https://portal.example/g', 'https://portal.example/g/signin/', 'https://portal.example/g/confirm/', 'https://portal.example/g/done/', 'https://portal.example/dashboard/?x=1']) {
    test(`never handled or cached: ${u}`, () => { const r = run(u); expect(r.responded).toBe(false); expect(r.opened).toEqual([]); });
  }
  test('control: other pages are still handled', () => { expect(run('https://portal.example/dashboard/').responded).toBe(true); });
});

test.describe('flag off', () => {
  test.skip(FLAG_ON, 'needs WEB_CHECKIN_FLAG=false');
  test('Visit button stays disabled with the old hint, the routes are unavailable and no check-in call is made', async ({ page }) => {
    const h = await setup(page);
    await openGym(page);
    await expect(page.getByTestId('web-gym-visit')).toBeDisabled();
    await expect(page.getByTestId('web-gym-visit-hint')).toHaveText(en['web.gym.signInToVisit']);
    for (const p of ['/g/signin/', '/g/confirm/', '/g/done/']) {
      await page.goto(p);
      await expect(page.getByTestId('web-checkin-flag-off')).toBeVisible();
    }
    expect(h.reqs.filter(r => r.path !== '/public/gyms/resolve')).toEqual([]);
  });
});

test.describe('flag on', () => {
  test.skip(!FLAG_ON, 'needs WEB_CHECKIN_FLAG=true');

  test('happy path: sign in, confirm, done; auth alone sends no confirm; tokens as specified; nothing leaks', async ({ page }) => {
    const h = await setup(page);
    await startVisit(page);
    // The button is enabled with the new hint, and the code is kept under its own key only.
    expect(await page.evaluate(() => sessionStorage.getItem('ff_webcheckin_intent'))).toBe(Q);
    await expect(page.getByTestId('web-checkin-pin')).toHaveAttribute('inputmode', 'numeric');
    await expect(page.getByTestId('web-checkin-pin')).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(page.getByTestId('web-checkin-pin')).toHaveAttribute('type', 'password');
    await signIn(page);
    await expect(page).toHaveURL(/\/g\/confirm\/$/);
    await expect(page.getByTestId('web-checkin-confirm-title')).toHaveText('Check in at Iron Temple now?');
    await expect(page.getByTestId('web-checkin-visits-left')).toHaveText('Visits left: 7');
    await expect(page.getByTestId('web-checkin-confirm-notproof')).toContainText('does not prove you are at the gym');
    // Authentication alone has not recorded or even requested a confirm.
    expect(h.count('POST', '/me/web-checkins')).toBe(0);
    const login = h.reqs.find(r => r.path === '/auth/pin/login')!;
    expect(login.headers['x-fitflex-channel']).toBe('web-checkin');
    expect(login.body).toEqual({ phone: '0712345678', pin: PIN });
    expect(h.reqs.find(r => r.path === '/auth/web-checkin/session')!.headers.authorization).toBe(`Bearer ${LONG}`);
    expect(h.reqs.find(r => r.path === '/public/web-checkin/intent')!.body).toEqual({ q: Q });
    const prev = h.reqs.find(r => r.path === '/me/web-checkins/preview')!;
    expect(prev.headers.authorization).toBe(`Bearer ${PURPOSE}`);
    expect(prev.body).toEqual({ intentToken: INTENT1 });
    await page.getByTestId('web-checkin-confirm-button').click();
    await expect(page).toHaveURL(/\/g\/done\/$/);
    await expect(page.getByTestId('web-checkin-done-body')).toContainText('Checked in at Iron Temple on');
    await expect(page.getByTestId('web-checkin-done-body')).toContainText('14:05 EAT');
    await expect(page.getByTestId('web-checkin-done-visit')).toHaveText('This is visit 3 of your current pass.');
    const conf = h.reqs.find(r => r.method === 'POST' && r.path === '/me/web-checkins')!;
    expect(conf.headers.authorization).toBe(`Bearer ${PURPOSE}`);
    expect(conf.body.confirm).toBe(true);
    expect(conf.body.intentToken).toBe(INTENT1);
    expect(conf.body.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    // Nothing in any address, console line or the portal's own storage; the PIN is nowhere.
    const secrets = ['SECRETSIG', LONG, PURPOSE, INTENT1, PIN, 'fitflex:gym'];
    // (the first address is the QR scan itself, which legitimately carries the code until the page strips it)
    const afterStrip = h.urls.slice(h.urls.findIndex(u => !u.includes('?')));
    expect(afterStrip.length).toBeGreaterThan(3);
    for (const s of secrets) {
      expect(afterStrip.join('\n')).not.toContain(s);
      expect(h.consoleLines.join('\n')).not.toContain(s);
    }
    const stores = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    for (const s of [LONG, PURPOSE, INTENT1, PIN]) expect(stores).not.toContain(s);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    // Done clears the code and the memory.
    await page.getByTestId('web-checkin-done-button').click();
    await expect(page.getByTestId('web-checkin-signed-out')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('ff_webcheckin_intent'))).toBeNull();
  });

  test('the address bar never carries the code, on the gym page or after Visit', async ({ page }) => {
    await setup(page);
    await startVisit(page);
    expect(page.url()).not.toContain('?');
    expect(page.url()).not.toContain('SECRETSIG');
  });

  test('PIN sign-in switched off: honest not-available state, no form', async ({ page }) => {
    await setup(page, { options: ok({ pinLogin: false, smsCodes: false, emailCodes: false }) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin-off')).toContainText(en['web.checkin.signin.notReadyTitle']);
    await expect(page.getByTestId('web-checkin-signin-form')).toHaveCount(0);
  });

  test('signin without a stored code asks to scan again, and makes no sign-in call', async ({ page }) => {
    const h = await setup(page);
    await page.goto('/g/signin/');
    await expect(page.getByTestId('web-checkin-no-code')).toBeVisible();
    expect(h.reqs).toEqual([]);
  });

  test('wrong PIN: clear error, PIN field emptied, stays on sign-in', async ({ page }) => {
    const h = await setup(page, { login: ok({ error: 'invalid_credentials' }, 401) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('web-checkin-signin-error')).toHaveText(en['web.checkin.err.wrong_pin']);
    await expect(page.getByTestId('web-checkin-pin')).toHaveValue('');
    await expect(page).toHaveURL(/\/g\/signin\/$/);
    expect(h.count('POST', '/auth/web-checkin/session')).toBe(0);
  });

  test('PIN needs four digits before anything is sent', async ({ page }) => {
    const h = await setup(page);
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page, '12');
    await expect(page.getByText(en['web.checkin.signin.pinFormat'])).toBeVisible();
    expect(h.count('POST', '/auth/pin/login')).toBe(0);
  });

  test('429 lockout is explained', async ({ page }) => {
    await setup(page, { login: ok({ error: 'too_many_attempts', retryAfterSeconds: 600 }, 429) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('web-checkin-signin-error')).toHaveText(en['web.checkin.err.locked']);
  });

  test('pin_reset_required shows the same generic locked message (does not reveal which)', async ({ page }) => {
    await setup(page, { login: ok({ error: 'pin_reset_required' }, 403) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('web-checkin-signin-error')).toHaveText(en['web.checkin.err.locked']);
    await expect(page.getByTestId('web-checkin-signin-error')).toHaveAttribute('data-code', 'locked');
  });

  for (const status of [500, 503]) {
    test(`a transient ${status} on /auth/options does not hide the sign-in form`, async ({ page }) => {
      await setup(page, { options: ok({ error: 'server_error' }, status) });
      await startVisit(page);
      await expect(page.getByTestId('web-checkin-signin-form')).toBeVisible();
      await expect(page.getByTestId('web-checkin-pin-off')).toHaveCount(0);
    });
  }

  test('PIN field hints: numeric, one-time-code, no username autofill', async ({ page }) => {
    await setup(page);
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(page.getByTestId('web-checkin-pin')).toHaveAttribute('name', 'ff-checkin-code');
    await expect(page.getByTestId('web-checkin-identifier')).toHaveAttribute('autocomplete', 'off');
  });

  test('320 px: a very long unbroken gym name wraps on confirm and done', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const long = 'IronTemple'.repeat(12);
    await setup(page, {
      preview: ok({ eligible: true, visitsLeft: 5, alreadyCheckedIn: false, gym: { name: long } }),
      confirm: ok({ ok: true, idempotent: false, checkin: { id: 'c1', timestamp: '2026-10-29T11:05:00.000Z', gym: { name: long } } }),
    });
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await toConfirm(page);
    await fits();
    await page.getByTestId('web-checkin-confirm-button').click();
    await expect(page.getByTestId('web-checkin-done')).toBeVisible();
    await fits();
  });

  test('admin is refused and no check-in session is requested', async ({ page }) => {
    const h = await setup(page, { login: ok({ token: LONG, user: { id: 'a1', userType: 'admin' }, partnerVerified: false }) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('web-checkin-signin-error')).toHaveText(en['web.checkin.err.role_refused']);
    expect(h.count('POST', '/auth/web-checkin/session')).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('a trainer may use the page; an email sign-in sends email', async ({ page }) => {
    const h = await setup(page, { login: ok({ token: LONG, user: { id: 't1', userType: 'trainer' } }) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page, PIN, 'a@b.co');
    await expect(page.getByTestId('web-checkin-confirm-title')).toBeVisible();
    expect(h.reqs.find(r => r.path === '/auth/pin/login')!.body).toEqual({ email: 'a@b.co', pin: PIN });
  });

  const refusals: CheckinCode[] = ['subscription_inactive', 'wrong_gym', 'tier_not_covered', 'tier_not_configured', 'basic_daily_limit', 'visits_exhausted', 'gym_closed', 'gym_not_verified', 'member_not_found'];
  for (const reason of refusals) {
    test(`preview not eligible (${reason}): specific reason, app pointer, button disabled`, async ({ page }) => {
      const h = await setup(page, { preview: ok({ eligible: false, reason, alreadyCheckedIn: false, gym: { name: 'Iron Temple' } }) });
      await toConfirm(page);
      await expect(page.getByTestId('web-checkin-reason')).toHaveText(en[ERROR_KEYS[reason]]);
      await expect(page.getByTestId('web-checkin-ineligible')).toContainText(en['web.checkin.confirm.buyHint']);
      await expect(page.getByTestId('web-checkin-confirm-button')).toBeDisabled();
      expect(h.count('POST', '/me/web-checkins')).toBe(0);
    });
  }

  test('already checked in today: shown, and no new confirm is offered', async ({ page }) => {
    const h = await setup(page, { preview: ok({ eligible: true, alreadyCheckedIn: true, gym: { name: 'Iron Temple' } }) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('web-checkin-already')).toContainText('You are already checked in today');
    await expect(page.getByTestId('web-checkin-confirm-button')).toHaveCount(0);
    expect(h.count('POST', '/me/web-checkins')).toBe(0);
  });

  test('no visitsLeft in the preview: no number is shown', async ({ page }) => {
    await setup(page, { preview: ok({ eligible: true, alreadyCheckedIn: false, gym: { name: 'Iron Temple' } }) });
    await toConfirm(page);
    await expect(page.getByTestId('web-checkin-visits-left')).toHaveCount(0);
  });

  test('preview intent_expired renews the intent automatically with the stored code', async ({ page }) => {
    const h = await setup(page, {
      preview: n => (n === 1 ? ok({ ok: false, failure: 'intent_expired' }, 409) : ok({ eligible: true, visitsLeft: 2, alreadyCheckedIn: false, gym: { name: 'Iron Temple' } })),
    });
    await toConfirm(page);
    expect(h.count('POST', '/public/web-checkin/intent')).toBe(2);
    expect(h.reqs.filter(r => r.path === '/me/web-checkins/preview').map(r => r.body.intentToken)).toEqual([INTENT1, INTENT2]);
    expect(h.reqs.filter(r => r.path === '/public/web-checkin/intent').every(r => r.body.q === Q)).toBe(true);
  });

  test('confirm intent_expired renews the link and asks again; a second tap succeeds', async ({ page }) => {
    const h = await setup(page, { confirm: n => (n === 1 ? ok({ ok: false, failure: 'intent_expired' }, 409) : base().confirm as Json) });
    await toConfirm(page);
    await page.getByTestId('web-checkin-confirm-button').click();
    await expect(page.getByTestId('web-checkin-renewed')).toBeVisible();
    expect(h.count('POST', '/me/web-checkins')).toBe(1);
    await page.getByTestId('web-checkin-confirm-button').click();
    await expect(page).toHaveURL(/\/g\/done\/$/);
    expect(h.reqs.filter(r => r.method === 'POST' && r.path === '/me/web-checkins').map(r => r.body.intentToken)).toEqual([INTENT1, INTENT2]);
  });

  test('intent 404: "not available right now" without a reason', async ({ page }) => {
    await setup(page, { intent: ok({ error: 'not_found' }, 404) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('web-checkin-confirm-error')).toContainText(en['web.checkin.unavailableTitle']);
  });

  test('401 mid-flow returns to sign-in with the code kept and the portal itself still signed in', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('token', 'PORTAL-TOKEN'); localStorage.setItem('user', JSON.stringify({ id: 'p', userType: 'admin' })); });
    const h = await setup(page, { preview: ok({ error: 'unauthorized' }, 401) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page);
    await expect(page).toHaveURL(/\/g\/signin\/$/);
    await expect(page.getByTestId('web-checkin-signin-error')).toHaveText(en['web.checkin.err.unauthorized']);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('PORTAL-TOKEN');
    expect(await page.evaluate(() => sessionStorage.getItem('ff_webcheckin_intent'))).toBe(Q);
    expect(h.count('POST', '/me/web-checkins')).toBe(0);
  });

  test('reload keeps the code but loses the token: sign in again, a new intent is requested', async ({ page }) => {
    const h = await setup(page);
    await toConfirm(page);
    await page.reload();
    await expect(page).toHaveURL(/\/g\/signin\/$/);
    expect(await page.evaluate(() => sessionStorage.getItem('ff_webcheckin_intent'))).toBe(Q);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('web-checkin-confirm-title')).toBeVisible();
    expect(h.count('POST', '/auth/pin/login')).toBe(2);
    expect(h.count('POST', '/public/web-checkin/intent')).toBe(2);
    expect(h.count('POST', '/me/web-checkins')).toBe(0);
  });

  test('double click sends one confirm', async ({ page }) => {
    const h = await setup(page, { confirm: { ...(base().confirm as Json), delayMs: 600 } });
    await toConfirm(page);
    await page.getByTestId('web-checkin-confirm-button').dblclick();
    await expect(page).toHaveURL(/\/g\/done\/$/);
    expect(h.count('POST', '/me/web-checkins')).toBe(1);
  });

  test('idempotent reply: "already checked in" wording', async ({ page }) => {
    await setup(page, { confirm: ok({ ok: true, idempotent: true, checkin: { id: 'c1', timestamp: '2026-10-29T05:00:00.000Z', gym: { name: 'Iron Temple' } } }) });
    await toConfirm(page);
    await page.getByTestId('web-checkin-confirm-button').click();
    await expect(page.getByRole('heading')).toHaveText(en['web.checkin.done.idempotentTitle']);
    await expect(page.getByTestId('web-checkin-done-visit')).toHaveCount(0);
    await expect(page.getByTestId('web-checkin-done-body')).toContainText('08:00 EAT');
  });

  const confirmFailures: Array<[string, number, unknown, CheckinCode]> = [
    ['visits_exhausted', 409, { ok: false, failure: 'visits_exhausted' }, 'visits_exhausted'],
    ['intent_used', 409, { ok: false, failure: 'intent_used' }, 'intent_used'],
    ['gym_not_found', 409, { ok: false, failure: 'gym_not_found' }, 'gym_not_found'],
    ['basic_daily_limit', 409, { ok: false, failure: 'basic_daily_limit' }, 'basic_daily_limit'],
    ['gym_closed', 409, { ok: false, failure: 'gym_closed' }, 'gym_closed'],
    ['confirmation_required', 400, { ok: false, error: 'confirmation_required' }, 'confirmation_required'],
    ['invalid_idempotency_key', 400, { ok: false, error: 'invalid_idempotency_key' }, 'invalid_idempotency_key'],
  ];
  for (const [name, status, body, code] of confirmFailures) {
    test(`confirm refused (${name}) shows its own message on the done screen`, async ({ page }) => {
      await setup(page, { confirm: ok(body, status) });
      await toConfirm(page);
      await page.getByTestId('web-checkin-confirm-button').click();
      await expect(page).toHaveURL(/\/g\/done\/$/);
      await expect(page.getByTestId('web-checkin-done-error')).toHaveText(en[ERROR_KEYS[code]]);
      await expect(page.getByTestId('web-checkin-done')).toHaveAttribute('data-outcome', code);
    });
  }

  test('a network failure on confirm stays on the screen and a repeat reuses the same idempotency key', async ({ page }) => {
    const h = await setup(page, { confirm: n => (n === 1 ? ok({ error: 'server_error' }, 500) : base().confirm as Json) });
    await toConfirm(page);
    await page.getByTestId('web-checkin-confirm-button').click();
    await expect(page.getByTestId('web-checkin-confirm-error')).toBeVisible();
    await page.getByTestId('web-checkin-retry').click();
    await page.getByTestId('web-checkin-confirm-button').click();
    await expect(page).toHaveURL(/\/g\/done\/$/);
    const keys = h.reqs.filter(r => r.method === 'POST' && r.path === '/me/web-checkins').map(r => r.body.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test('Swahili from the browser language, on all three screens', async ({ page }) => {
    await lang(page, 'sw-TZ');
    await setup(page);
    await openGym(page);
    await expect(page.getByTestId('web-gym-visit')).toHaveText(sw['web.gym.visit']);
    await expect(page.getByTestId('web-gym-visit-hint')).toHaveText(sw['web.checkin.visitHint']);
    await page.getByTestId('web-gym-visit').click();
    await expect(page.getByText(sw['web.checkin.signin.title'])).toBeVisible();
    await signIn(page);
    await expect(page.getByTestId('web-checkin-confirm-title')).toHaveText('Ingia gym Iron Temple sasa?');
    await expect(page.getByTestId('web-checkin-confirm-button')).toHaveText(sw['web.checkin.confirm.button']);
    await page.getByTestId('web-checkin-confirm-button').click();
    await expect(page.getByRole('heading')).toHaveText(sw['web.checkin.done.successTitle']);
    await page.getByTestId('web-checkin-lang-toggle').click();
    await expect(page.getByRole('heading')).toHaveText(en['web.checkin.done.successTitle']);
  });

  test('320 px wide, Swahili: no horizontal overflow on any screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await lang(page, 'sw-TZ');
    await setup(page, { preview: ok({ eligible: false, reason: 'tier_not_configured', alreadyCheckedIn: false, gym: { name: 'Iron Temple Fitness and Wellness Centre' } }) });
    const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await noOverflow();
    await signIn(page);
    await expect(page.getByTestId('web-checkin-ineligible')).toBeVisible();
    await noOverflow();
  });

  test('320 px wide, Swahili: done screen fits', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await lang(page, 'sw-TZ');
    await setup(page, { preview: ok({ eligible: true, visitsLeft: 5, alreadyCheckedIn: false, gym: { name: 'Iron Temple Fitness and Wellness Centre' } }) });
    await startVisit(page);
    await expect(page.getByTestId('web-checkin-pin')).toBeVisible();
    await signIn(page);
    await page.getByTestId('web-checkin-confirm-button').click();
    await expect(page.getByTestId('web-checkin-done')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('the new routes are noindex and carry no referrer', async ({ page }) => {
    await setup(page);
    await startVisit(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  });
});
