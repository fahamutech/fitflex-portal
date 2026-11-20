import { expect, test, type Page } from '@playwright/test';
import { messages } from '../../src/lib/i18n';
import { gymPassMessages } from '../../src/lib/i18n-gym-passes';
import { classifyGymPassError, inviteTokenFromHash } from '../../src/lib/gym-passes';
import { ApiError } from '../../src/lib/api';
import { contactOf, isWebGymPass, othersRange } from '../../src/lib/gym-pass-buy';

// Custom gym passes (backend functions#355, docs/custom-gym-passes-api.md). The API is mocked. Run twice (the flag is
// inlined when the portal is built):
//   npx playwright test --config playwright.gym-passes.config.ts                       (flag on)
//   GYM_PASSES_FLAG=false npx playwright test --config playwright.gym-passes.config.ts (flag off)
const FLAG_ON = (process.env.GYM_PASSES_FLAG ?? 'true') === 'true';
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const TOKEN = 'T0KEN_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'plan-1', gymId: 'gym-1', name: 'Couples 3 months', description: 'For two', category: 'couples', durationValue: 3, durationUnit: 'months',
  beneficiaryLimit: 2, priceTzs: 240000, currency: 'TZS', startPolicy: 'immediate', terms: null, termsVersion: 1, status: 'active', ...over,
});
const snapshot = { name: 'Couples 3 months', category: 'couples', priceTzs: 240000, currency: 'TZS', durationValue: 3, durationUnit: 'months', beneficiaryLimit: 2 };
const person = (over: Record<string, unknown> = {}) => ({
  id: 'ben-1', slot: 1, isPurchaser: true, status: 'active', userId: 'u-1', displayName: 'Asha Buyer', contactType: null, contact: null, subscriptionId: 'sub-1',
  notifiedAt: null, notifiedVia: [], claimedAt: null, removedAt: null, removedByRole: null, attendance: { visits: 3, lastVisitAt: '2026-11-10T08:00:00.000Z' }, ...over,
});
const membership = {
  id: 'pur-1', status: 'active', gymId: 'gym-1', planId: 'plan-1', plan: snapshot, priceTzs: 240000, currency: 'TZS', paymentRequestId: 'pay-1',
  startsAt: '2026-11-01T08:00:00.000Z', expiresAt: '2027-02-01T08:00:00.000Z', createdAt: '2026-10-31T08:00:00.000Z',
  purchaser: { id: 'u-1', displayName: 'Asha Buyer' }, payment: { status: 'approved', amountTzs: 240000, reference: 'R1' },
  beneficiaryCounts: { total: 2, active: 2, pending: 0, suspended: 0 }, slots: { used: 2, limit: 2 },
  beneficiaries: [person(), person({ id: 'ben-2', slot: 2, isPurchaser: false, userId: 'u-2', displayName: 'Juma Partner', contactType: 'phone', contact: '+255 7•• ••• 123', attendance: { visits: 0, lastVisitAt: null } })],
};
const summary = {
  gymId: 'gym-1', currency: 'TZS', plans: { total: 2, active: 1 }, sales: { count: 4, revenueTzs: 960000, pendingPayment: 1 },
  beneficiaries: { active: 5, pendingRegistration: 1, suspended: 0 }, memberships: { active: 2, expired: 1 },
};

test.use({ serviceWorkers: 'block' });

async function signInOwner(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'owner-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'owner-1', userType: 'gym_operator', email: 'owner@example.com' }));
    localStorage.setItem('locale', 'en');
  });
}

interface Seen { calls: Array<{ method: string; path: string; body: unknown }> }
async function mockOwnerApi(page: Page, over: (method: string, path: string, body: unknown) => { status?: number; json: unknown } | null = () => null): Promise<Seen> {
  const seen: Seen = { calls: [] };
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.method() === 'GET' ? null : req.postDataJSON();
    seen.calls.push({ method: req.method(), path: url.pathname + url.search, body });
    const o = over(req.method(), url.pathname + url.search, body);
    if (o) return route.fulfill({ status: o.status ?? 200, json: o.json });
    const p = url.pathname;
    if (p === '/owner/gyms') return route.fulfill({ json: [{ id: 'gym-1', name: 'Mikocheni Fitness' }] });
    if (p === '/owner/gyms/gym-1/pass-summary') return route.fulfill({ json: summary });
    if (p === '/owner/gyms/gym-1/pass-plans' && req.method() === 'GET') return route.fulfill({ json: { plans: [plan(), plan({ id: 'plan-2', name: 'Family of 4', category: 'group', beneficiaryLimit: 4, durationValue: 30, durationUnit: 'days', priceTzs: 400000, status: 'inactive' })] } });
    if (p === '/owner/gyms/gym-1/pass-plans' && req.method() === 'POST') return route.fulfill({ status: 201, json: { plan: plan({ id: 'plan-3' }) } });
    if (p.startsWith('/owner/gyms/gym-1/pass-plans/')) return route.fulfill({ json: { plan: plan() } });
    if (p === '/owner/gyms/gym-1/pass-sales') return route.fulfill({ json: { sales: [membership] } });
    if (p === '/owner/gyms/gym-1/pass-memberships') return route.fulfill({ json: { state: 'active', memberships: [membership] } });
    if (p.endsWith('/attendance')) return route.fulfill({ json: { beneficiaryId: 'ben-2', visits: [{ id: 'v1', gymId: 'gym-1', timestamp: '2026-11-10T08:00:00.000Z', method: 'member_scanned', status: 'valid', businessDate: '2026-11-10' }] } });
    if (/\/(suspend|resume|remove)$/.test(p)) return route.fulfill({ json: { beneficiary: { id: 'ben-2' } } });
    if (p.endsWith('/beneficiaries')) return route.fulfill({ status: 201, json: { beneficiary: { id: 'ben-3', status: 'invited', contactType: 'phone', contact: '+255 7•• ••• 999' } } });
    return route.fulfill({ json: {} });
  });
  return seen;
}

test.describe('pure helpers', () => {
  test('every English string has a Swahili entry, and Swahili is only the pending placeholder', () => {
    expect(Object.keys(gymPassMessages.sw).sort()).toEqual(Object.keys(gymPassMessages.en).sort());
    for (const [k, v] of Object.entries(gymPassMessages.sw)) expect(v, k).toMatch(/^\[SW pending review\] /);
    for (const k of Object.keys(gymPassMessages.en)) { expect(k in messages.en, k).toBe(true); expect(k in messages.sw, k).toBe(true); }
  });

  test('the invite token is read from the hash only', () => {
    expect(inviteTokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFromHash('')).toBeNull();
    expect(inviteTokenFromHash('#')).toBeNull();
  });

  test('errors map to feature_disabled, rate limit and readable messages', () => {
    expect(classifyGymPassError(new ApiError(404, { error: 'feature_disabled' }))).toEqual({ kind: 'disabled' });
    expect(classifyGymPassError(new ApiError(429, { error: 'rate_limited', retryAfterSeconds: 42 }))).toEqual({ kind: 'rate_limited', retryAfterSeconds: 42 });
    expect(classifyGymPassError(new ApiError(409, { error: 'cannot_add_person' }))).toMatchObject({ kind: 'message', key: 'gp.err.cannot_add_person' });
    expect(classifyGymPassError(new ApiError(400, { error: 'invalid_field', field: 'beneficiaryLimit', reason: 'group_limit_range' }))).toMatchObject({ key: 'gp.err.reason.group_limit_range' });
    expect(classifyGymPassError(new ApiError(403, { error: 'acl_forbidden', requiredScope: 'members' }))).toMatchObject({ key: 'gp.err.acl_forbidden' });
    expect(classifyGymPassError(new ApiError(500, {}))).toMatchObject({ key: 'gp.generic' });
  });
});

// ── Buying on the web: the public gym page (/g) and the member portal (/m/gym-passes) ─────────────────────────────────
const MEMBER_TOKEN = 'MEMBERTOKEN-gp';
const MEMBER = { id: 'usr_m1', userType: 'member', name: 'Neema Mushi', phone: '0754123678' };
const webPass = (over: Record<string, unknown> = {}) => ({
  planId: 'gpp_couples', name: 'Couples 3 months', description: 'For two', category: 'couples', durationValue: 3, durationUnit: 'months',
  beneficiaryLimit: 2, priceTzs: 240000, terms: 'No refunds after the first visit.', termsVersion: 2, ...over,
});
const gymProfile = (gymPasses: unknown[]) => ({
  lang: 'en',
  gym: { publicRef: 'abc123', name: 'Mikocheni Fitness', description: null, tier: 'standard', venueType: 'physical', verified: true, rating: null, reviewCount: null,
    photos: [], thumbnail: null, area: null, address: null, lat: null, lng: null, directions: null, facilities: [], equipment: [], amenities: [], services: [],
    operatingHours: null, classes: [], trainers: [] },
  membership: { currency: 'TZS', gymPlans: [], passTiers: [], gymPasses },
});
const PASS_PAY = { id: 'pay_gp1', tier: null, amountTzs: 240000, status: 'pending', requestedAt: '2026-11-20T08:00:00.000Z', provider: 'admin_approved', reference: null, note: 'gym_pass' };
const bought = (over: Record<string, unknown> = {}) => ({
  id: 'gpu_1', status: 'pending_payment', gymId: 'gym-1', planId: 'gpp_couples', plan: snapshot, priceTzs: 240000, currency: 'TZS', paymentRequestId: 'pay_gp1',
  startsAt: null, expiresAt: null, createdAt: '2026-11-20T08:00:00.000Z', gym: { id: 'gym-1', name: 'Mikocheni Fitness' }, payment: { status: 'pending', amountTzs: 240000 },
  beneficiaries: [
    { id: 'gpb_1', slot: 1, isPurchaser: true, status: 'awaiting_payment', you: true, displayName: 'Neema Mushi', contactType: null, contact: null },
    { id: 'gpb_2', slot: 2, isPurchaser: false, status: 'awaiting_payment', you: false, displayName: null, contactType: 'phone', contact: '+255 7•• ••• 678' },
  ],
  slots: { used: 2, limit: 2 }, ...over,
});

type Answer = { status?: number; json: unknown };
interface MemberSeen { calls: Array<{ method: string; path: string; body: any; auth: string | null }> }
async function mockMemberApi(page: Page, over: Record<string, Answer | ((n: number, body: any) => Answer)> = {}, signedIn = true): Promise<MemberSeen> {
  const seen: MemberSeen = { calls: [] };
  const counts: Record<string, number> = {};
  const routes: Record<string, Answer | ((n: number, body: any) => Answer)> = {
    'GET /auth/options': { json: { pinLogin: true } },
    'POST /auth/pin/login': { json: { token: MEMBER_TOKEN, user: MEMBER } },
    'POST /public/gyms/resolve': { json: gymProfile([webPass()]) },
    'GET /me/gym-passes': { json: { purchased: [], memberships: [] } },
    'GET /payments/options': { json: { enabled: true, provider: 'azampay', environment: 'production' } },
    'POST /me/gym-pass-purchases': { status: 202, json: { purchase: bought(), paymentRequest: PASS_PAY } },
    'POST /me/payments/pay_gp1/mobile-money': { status: 202, json: { state: 'in_progress', paymentRequest: PASS_PAY } },
    'POST /me/payments/pay_gp1/mobile-money/refresh': { json: { state: 'completed', paymentRequest: PASS_PAY } },
    ...over,
  };
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    let body: any = null;
    try { body = req.postData() ? JSON.parse(req.postData()!) : null; } catch { /* not json */ }
    const key = `${req.method()} ${path}`;
    seen.calls.push({ method: req.method(), path, body, auth: req.headers()['authorization'] ?? null });
    counts[key] = (counts[key] ?? 0) + 1;
    const v = routes[key];
    const r = !v ? { status: 404, json: { error: 'not_found' } } : typeof v === 'function' ? v(counts[key], body) : v;
    await route.fulfill({ status: r.status ?? 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.json) });
  });
  await page.addInitScript(([signed, t, u]) => {
    localStorage.setItem('locale', 'en');
    if (signed) localStorage.setItem('ff_member_session', JSON.stringify({ token: t, user: u }));
  }, [signedIn, MEMBER_TOKEN, MEMBER] as const);
  return seen;
}
const chooseOnGymPage = async (page: Page, planId = 'gpp_couples') => {
  await page.goto('/g/?q=fitflex%3Agym%3Agym_001%3ASIG');
  await page.getByTestId(`web-gym-pass-buy-${planId}`).click();
};

test.describe('buying on the web: pure helpers', () => {
  test('how many other people a pass asks for, and how a typed contact is sent', () => {
    expect(othersRange({ category: 'individual', beneficiaryLimit: 1 })).toEqual({ min: 0, max: 0 });
    expect(othersRange({ category: 'couples', beneficiaryLimit: 2 })).toEqual({ min: 1, max: 1 });
    expect(othersRange({ category: 'group', beneficiaryLimit: 5 })).toEqual({ min: 2, max: 4 });
    expect(othersRange({ category: 'group', beneficiaryLimit: 3 })).toEqual({ min: 2, max: 2 });
    expect(contactOf(' 0712345678 ')).toEqual({ phone: '0712345678' });
    expect(contactOf('a@b.co')).toEqual({ email: 'a@b.co' });
    expect(contactOf('   ')).toBeNull();
  });

  test('only a well-formed pass is listed', () => {
    expect(isWebGymPass(webPass())).toBe(true);
    for (const bad of [null, {}, webPass({ planId: '' }), webPass({ category: 'family' }), webPass({ priceTzs: 0 }), webPass({ durationUnit: 'years' }), webPass({ beneficiaryLimit: 0 })]) {
      expect(isWebGymPass(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

test.describe('buying on the web, flag on', () => {
  test.skip(!FLAG_ON, 'needs NEXT_PUBLIC_GYM_CUSTOM_PASSES=true');

  test('gym page lists the passes; Buy asks for sign-in, then returns to the chosen pass; one purchase, paid by the phone prompt', async ({ page }) => {
    const seen = await mockMemberApi(page, { 'POST /public/gyms/resolve': { json: gymProfile([webPass(), webPass({ planId: 'gpp_bad', priceTzs: 0 }), webPass({ planId: 'gpp_solo', name: 'Solo month', category: 'individual', beneficiaryLimit: 1, durationValue: 1, terms: null })]) } }, false);
    await page.goto('/g/?q=fitflex%3Agym%3Agym_001%3ASIG');
    const section = page.getByTestId('web-gym-custom-passes');
    await expect(section).toContainText('Couples 3 months');
    await expect(section).toContainText('240,000');
    await expect(section).toContainText('Couples · 2 people · 3 months');
    await expect(section).toContainText('Individual · 1 person · 1 month');
    await expect(page.getByTestId('web-gym-pass-gpp_bad')).toHaveCount(0);
    await expect(page.getByTestId('web-gym-pass-hint')).toContainText('PIN');

    await page.getByTestId('web-gym-pass-buy-gpp_couples').click();
    await expect(page).toHaveURL(/\/m\/signin\/$/);
    await page.getByTestId('member-signin-identifier').fill('0754123678');
    await page.getByTestId('member-signin-pin').fill('1234');
    await page.getByTestId('member-signin-submit').click();
    await expect(page).toHaveURL(/\/m\/gym-passes\/$/);

    const form = page.getByTestId('member-gym-pass-buy');
    await expect(form).toContainText('Couples 3 months');
    await expect(form).toContainText('At Mikocheni Fitness');
    await expect(page.getByTestId('member-gym-pass-price')).toContainText('TSh 240,000');
    await expect(page.getByTestId('member-gym-pass-terms')).toContainText('No refunds after the first visit.');
    await expect(page.getByTestId('member-gym-pass-person-add')).toHaveCount(0);

    // The other person and the terms are asked for before anything is sent.
    await page.getByTestId('member-gym-pass-continue').click();
    await expect(page.getByTestId('member-gym-pass-notice')).toContainText('mobile number or email for each person');
    await page.getByTestId('member-gym-pass-person-0').fill('0712345678');
    await page.getByTestId('member-gym-pass-continue').click();
    await expect(page.getByTestId('member-gym-pass-notice')).toContainText('Accept the terms');
    expect(seen.calls.filter(c => c.path === '/me/gym-pass-purchases')).toEqual([]);

    await page.getByTestId('member-gym-pass-accept').check();
    await page.getByTestId('member-gym-pass-continue').click();
    await expect(page.getByTestId('member-pay-mobile')).toBeVisible();
    await expect(page.getByTestId('member-pay-summary')).toContainText('Couples 3 months · TSh 240,000');
    const purchases = seen.calls.filter(c => c.path === '/me/gym-pass-purchases');
    expect(purchases).toHaveLength(1);
    expect(purchases[0].body).toEqual({ planId: 'gpp_couples', beneficiaries: [{ phone: '0712345678' }], termsVersion: 2, expectedPriceTzs: 240000 });
    expect(purchases[0].auth).toBe(`Bearer ${MEMBER_TOKEN}`);

    await page.getByTestId('member-pay-send').click();
    await expect(page.getByTestId('member-pay-done')).toContainText('Everyone on it can now check in', { timeout: 15_000 });
    expect(seen.calls.find(c => c.path === '/me/payments/pay_gp1/mobile-money')!.body).toEqual({ phone: '0754123678', network: 'Mpesa' });
    // The chosen pass is not offered again once it has been bought.
    expect(await page.evaluate(() => sessionStorage.getItem('ff_gym_pass_buy'))).toBeNull();
  });

  test('a changed price is shown and asked again; nothing is created at the old price', async ({ page }) => {
    const seen = await mockMemberApi(page, {
      'POST /me/gym-pass-purchases': (n) => (n === 1
        ? { status: 409, json: { error: 'price_changed', priceTzs: 260000, currency: 'TZS' } }
        : { status: 202, json: { purchase: bought({ priceTzs: 260000 }), paymentRequest: { ...PASS_PAY, amountTzs: 260000 } } }),
    });
    await chooseOnGymPage(page);
    await page.getByTestId('member-gym-pass-person-0').fill('friend@example.com');
    await page.getByTestId('member-gym-pass-accept').check();
    await page.getByTestId('member-gym-pass-continue').click();
    await expect(page.getByTestId('member-gym-pass-notice')).toContainText('TSh 260,000');
    await expect(page.getByTestId('member-gym-pass-price')).toContainText('TSh 260,000');
    await expect(page.getByTestId('member-pay-mobile')).toHaveCount(0);
    await page.getByTestId('member-gym-pass-continue').click();
    await expect(page.getByTestId('member-pay-summary')).toContainText('TSh 260,000');
    const sent = seen.calls.filter(c => c.path === '/me/gym-pass-purchases').map(c => c.body.expectedPriceTzs);
    expect(sent).toEqual([240000, 260000]);
    expect(seen.calls.filter(c => c.path === '/me/gym-pass-purchases')[1].body.beneficiaries).toEqual([{ email: 'friend@example.com' }]);
  });

  test('group pass: two to limit-1 other people; an individual pass asks for nobody; refusals read as sentences', async ({ page }) => {
    const seen = await mockMemberApi(page, {
      'POST /public/gyms/resolve': { json: gymProfile([
        webPass({ planId: 'gpp_group', name: 'Family of 4', category: 'group', beneficiaryLimit: 4, terms: null }),
        webPass({ planId: 'gpp_solo', name: 'Solo month', category: 'individual', beneficiaryLimit: 1, terms: null }),
      ]) },
      'POST /me/gym-pass-purchases': (n) => (n === 1 ? { status: 400, json: { error: 'cannot_add_yourself', index: 0 } } : { status: 409, json: { error: 'plan_not_available' } }),
    });
    await chooseOnGymPage(page, 'gpp_group');
    await expect(page.getByTestId('member-gym-pass-buy')).toContainText('Name 2 to 3 other people');
    await expect(page.getByTestId('member-gym-pass-person-1')).toBeVisible();
    await expect(page.getByTestId('member-gym-pass-person-2')).toHaveCount(0);
    await expect(page.getByTestId('member-gym-pass-person-remove-0')).toHaveCount(0);
    await page.getByTestId('member-gym-pass-person-add').click();
    await expect(page.getByTestId('member-gym-pass-person-add')).toHaveCount(0);
    await page.getByTestId('member-gym-pass-person-remove-2').click();
    await expect(page.getByTestId('member-gym-pass-person-2')).toHaveCount(0);
    await expect(page.getByTestId('member-gym-pass-terms')).toHaveCount(0);
    await page.getByTestId('member-gym-pass-person-0').fill('0754123678');
    await page.getByTestId('member-gym-pass-person-1').fill('0711111111');
    await page.getByTestId('member-gym-pass-continue').click();
    await expect(page.getByTestId('member-gym-pass-notice')).toContainText('not your own');
    await expect(page.getByTestId('member-gym-pass-notice')).not.toContainText('cannot_add_yourself');
    expect(seen.calls.find(c => c.path === '/me/gym-pass-purchases')!.body).toEqual({ planId: 'gpp_group', beneficiaries: [{ phone: '0754123678' }, { phone: '0711111111' }], expectedPriceTzs: 240000 });
    await page.getByTestId('member-gym-pass-continue').click();
    await expect(page.getByTestId('member-gym-pass-notice')).toContainText('no longer on sale');

    await chooseOnGymPage(page, 'gpp_solo');
    await expect(page.getByTestId('member-gym-pass-buy')).toContainText('Solo month');
    await expect(page.getByTestId('member-gym-pass-person-0')).toHaveCount(0);
    await page.getByTestId('member-gym-pass-dismiss').click();
    await expect(page.getByTestId('member-gym-pass-buy')).toHaveCount(0);
    await expect(page.getByTestId('member-gym-passes-empty')).toBeVisible();
  });

  test('My gym passes: masked people as given, pay or cancel a purchase awaiting payment, passes I am on', async ({ page }) => {
    let cancelled = false;
    const seen = await mockMemberApi(page, {
      'GET /me/gym-passes': () => ({ json: {
        purchased: [
          bought(cancelled ? { status: 'cancelled' } : {}),
          bought({ id: 'gpu_2', status: 'active', paymentRequestId: 'pay_gp2', expiresAt: '2027-02-01T08:00:00.000Z',
            beneficiaries: [{ id: 'gpb_3', slot: 1, isPurchaser: true, status: 'active', you: true, displayName: 'Neema Mushi', contactType: null, contact: null },
              { id: 'gpb_4', slot: 2, isPurchaser: false, status: 'invited', you: false, displayName: null, contactType: 'phone', contact: '+255 7•• ••• 123' }] }),
        ],
        memberships: [{ purchaseId: 'gpu_9', beneficiaryId: 'gpb_9', status: 'suspended', purchaseStatus: 'active', gym: { id: 'gym-2', name: 'Msasani Bay Fitness' },
          plan: { ...snapshot, name: 'Family of 4' }, startsAt: '2026-11-01T08:00:00.000Z', expiresAt: '2027-01-01T08:00:00.000Z', subscriptionId: 'sub_9' }],
      } }),
      'POST /me/gym-pass-purchases/gpu_1/cancel': () => { cancelled = true; return { json: { purchase: bought({ status: 'cancelled' }) } }; },
    });
    await page.goto('/m/gym-passes/');
    await expect(page.getByRole('link', { name: 'Gym passes', exact: true }).first()).toBeVisible();
    const active = page.getByTestId('member-gym-pass-gpu_2');
    await expect(active).toContainText('Active');
    await expect(active).toContainText('Valid until 1 Feb 2027');
    await expect(active).toContainText('+255 7•• ••• 123 · Invited');
    await expect(active).toContainText('You · Active');
    await expect(active).toContainText('2 of 2 places used');
    await expect(page.getByTestId('member-gym-pass-pay-gpu_2')).toHaveCount(0);
    await expect(page.getByTestId('member-gym-passes-shared')).toContainText('Family of 4');
    await expect(page.getByTestId('member-gym-passes-shared')).toContainText('Your place on this pass is suspended.');

    const pending = page.getByTestId('member-gym-pass-gpu_1');
    await expect(pending).toContainText('Waiting for payment');
    await page.getByTestId('member-gym-pass-pay-gpu_1').click();
    await expect(page.getByTestId('member-pay-summary')).toContainText('Couples 3 months · TSh 240,000');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(seen.calls.filter(c => c.path === '/me/gym-pass-purchases')).toEqual([]);

    await page.getByTestId('member-gym-pass-cancel-gpu_1').click();
    await expect(pending).toContainText('Nothing has been paid');
    await page.getByTestId('member-gym-pass-cancel-yes-gpu_1').click();
    await expect(pending).toContainText('Cancelled');
    await expect(page.getByTestId('member-gym-pass-pay-gpu_1')).toHaveCount(0);
    expect(seen.calls.filter(c => c.path.endsWith('/cancel'))).toHaveLength(1);
  });

  test('Swahili is the pending placeholder on the gym page section and the member page', async ({ page }) => {
    await mockMemberApi(page);
    await page.addInitScript(() => localStorage.setItem('locale', 'sw'));
    await page.goto('/g/?q=fitflex%3Agym%3Agym_001%3ASIG');
    await expect(page.getByTestId('web-gym-custom-passes')).toContainText('[SW pending review] Gym passes');
    await page.goto('/m/gym-passes/');
    await expect(page.getByTestId('member-gym-passes-mine')).toContainText('[SW pending review] Passes you bought');
  });
});

test.describe('flag on', () => {
  test.skip(!FLAG_ON, 'needs NEXT_PUBLIC_GYM_CUSTOM_PASSES=true');

  test('nav item, plans, publish and unpublish, create and server validation', async ({ page }) => {
    await signInOwner(page);
    const seen = await mockOwnerApi(page, (m, p, body) => {
      if (m === 'POST' && p === '/owner/gyms/gym-1/pass-plans' && (body as { priceTzs?: number }).priceTzs === 200000000) {
        return { status: 400, json: { error: 'invalid_field', field: 'priceTzs', reason: 'too_large' } };
      }
      return null;
    });
    await page.goto('/owner/memberships');
    await expect(page.getByRole('heading', { name: 'Membership & Pass Management' })).toBeVisible();
    // The nav item sits right after "Manage gym".
    const navLinks = page.locator('nav a');
    const labels = await navLinks.allInnerTexts();
    expect(labels.indexOf('Membership & Pass Management')).toBe(labels.indexOf('Manage gym') + 1);
    await expect(page.getByTestId('gp-summary')).toContainText('960,000');
    await expect(page.getByTestId('gp-plan-plan-1')).toContainText('Couples 3 months');
    await expect(page.getByTestId('gp-plan-plan-1')).toContainText('3 months');
    await expect(page.getByTestId('gp-plan-plan-1')).toContainText('2 people');

    await page.getByTestId('gp-plan-plan-1').getByTestId('gp-plan-unpublish').click();
    await page.getByTestId('gp-plan-confirm-yes').click();
    expect(seen.calls.some(c => c.method === 'POST' && c.path === '/owner/gyms/gym-1/pass-plans/plan-1/deactivate')).toBe(true);
    await page.getByTestId('gp-plan-plan-2').getByTestId('gp-plan-publish').click();
    await page.getByTestId('gp-plan-confirm-yes').click();
    await expect.poll(() => seen.calls.some(c => c.path === '/owner/gyms/gym-1/pass-plans/plan-2/activate')).toBe(true);

    // Create a group pass with the limit; the body matches the contract.
    await page.getByTestId('gp-plan-new').click();
    await page.getByTestId('gp-form-name').fill('Friends group');
    await page.getByTestId('gp-form-category').selectOption('group');
    await page.getByTestId('gp-form-limit').fill('5');
    await page.getByTestId('gp-form-duration').fill('6');
    await page.getByTestId('gp-form-unit').selectOption('weeks');
    await page.getByTestId('gp-form-price').fill('300000');
    await page.getByTestId('gp-form-save').click();
    await expect.poll(() => seen.calls.find(c => c.method === 'POST' && c.path === '/owner/gyms/gym-1/pass-plans')?.body).toEqual({
      name: 'Friends group', description: null, category: 'group', durationValue: 6, durationUnit: 'weeks', beneficiaryLimit: 5, priceTzs: 300000, terms: null, status: 'inactive',
    });

    // A server validation error is shown readably, not as a code.
    await page.getByTestId('gp-plan-new').click();
    await page.getByTestId('gp-form-name').fill('Too dear');
    await page.getByTestId('gp-form-price').fill('200000000');
    await page.getByTestId('gp-form-save').click();
    await expect(page.getByTestId('gp-plan-dialog')).toContainText('more than the highest price allowed');
    await expect(page.getByTestId('gp-plan-dialog')).not.toContainText('invalid_field');
  });

  test('sales list', async ({ page }) => {
    await signInOwner(page);
    await mockOwnerApi(page);
    await page.goto('/owner/memberships');
    await page.getByRole('button', { name: 'Sales', exact: true }).click();
    const row = page.getByTestId('gp-sale-pur-1');
    await expect(row).toContainText('Asha Buyer');
    await expect(row).toContainText('Couples 3 months');
    await expect(row).toContainText('240,000');
    await expect(row).toContainText('Paid');
    await expect(row).toContainText('Active');
  });

  test('memberships: masked contacts as given, confirm before suspend, remove, add, attendance', async ({ page }) => {
    await signInOwner(page);
    const seen = await mockOwnerApi(page, (m, p) => (m === 'POST' && p.endsWith('/beneficiaries') ? { status: 409, json: { error: 'cannot_add_person' } } : null));
    await page.goto('/owner/memberships');
    await page.getByRole('button', { name: 'Memberships', exact: true }).click();
    await expect(page.getByTestId('gp-expiry')).toContainText('Ends');
    // The mask is shown exactly as the server sent it.
    await expect(page.getByTestId('gp-person-ben-2').getByTestId('gp-person-contact')).toHaveText('+255 7•• ••• 123');
    await expect(page.getByTestId('gp-person-ben-1').getByTestId('gp-person-suspend')).toHaveCount(0);

    await page.getByTestId('gp-person-ben-2').getByTestId('gp-person-suspend').click();
    await expect(page.getByTestId('gp-person-confirm')).toContainText('Suspend this person?');
    expect(seen.calls.some(c => c.path.endsWith('/suspend'))).toBe(false);
    await page.getByTestId('gp-person-confirm-yes').click();
    await expect.poll(() => seen.calls.some(c => c.method === 'POST' && c.path === '/owner/gyms/gym-1/pass-purchases/pur-1/beneficiaries/ben-2/suspend')).toBe(true);

    await page.getByTestId('gp-person-ben-2').getByTestId('gp-person-remove').click();
    await expect(page.getByTestId('gp-person-confirm')).toContainText('never refunds');
    await page.getByTestId('gp-person-confirm-yes').click();
    await expect.poll(() => seen.calls.some(c => c.path.endsWith('/ben-2/remove'))).toBe(true);

    await page.getByTestId('gp-person-ben-2').getByTestId('gp-person-visits').click();
    await expect(page.getByTestId('gp-visits-dialog')).toContainText('Gym QR scanned by the member');
    await expect(page.getByTestId('gp-visits-dialog')).toContainText('Valid');
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();

    await page.getByTestId('gp-add-person').click();
    await page.getByTestId('gp-add-value').fill('+255700000999');
    await page.getByTestId('gp-add-submit').click();
    await expect(page.getByTestId('gp-add-dialog')).toContainText('This person cannot be added to this pass.');
    expect(seen.calls.find(c => c.method === 'POST' && c.path.endsWith('/pur-1/beneficiaries'))?.body).toEqual({ phone: '+255700000999' });
  });

  test('404 feature_disabled shows a friendly state; 429 shows the wait', async ({ page }) => {
    await signInOwner(page);
    await mockOwnerApi(page, (_m, p) => (p === '/owner/gyms/gym-1/pass-plans' ? { status: 404, json: { error: 'feature_disabled' } } : p.startsWith('/owner/gyms/gym-1/pass-sales') ? { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 42 } } : null));
    await page.goto('/owner/memberships');
    await expect(page.getByTestId('gp-disabled')).toContainText('not available yet');
    await page.getByRole('button', { name: 'Sales', exact: true }).click();
    await expect(page.getByTestId('gp-rate-limited')).toContainText('42 seconds');
  });

  test('a member session is sent away from the owner page', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('token', 'member-e2e-token');
      localStorage.setItem('user', JSON.stringify({ id: 'm-1', userType: 'member', email: 'm@example.com' }));
    });
    const seen = await mockOwnerApi(page);
    await page.goto('/owner/memberships');
    // The Shell redirects (the dev server may be slow to open the target page): the owner page never renders or loads.
    await expect(page.getByTestId('shell-redirecting')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('gp-page')).toHaveCount(0);
    expect(seen.calls.filter(c => c.path.includes('pass-'))).toEqual([]);
  });

  test('Swahili is the pending placeholder', async ({ page }) => {
    await signInOwner(page);
    await page.addInitScript(() => localStorage.setItem('locale', 'sw'));
    await mockOwnerApi(page);
    await page.goto('/owner/memberships');
    await expect(page.getByRole('heading', { name: /\[SW pending review\] Membership & Pass Management/ })).toBeVisible();
  });

  test('invite landing: token in the hash only, sent in the body only, removed from the address', async ({ page }) => {
    const requests: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    await page.route(`${API}/gym-pass-invitations/preview`, async route => {
      const r = route.request();
      requests.push({ url: r.url(), body: r.postDataJSON(), headers: r.headers() });
      await route.fulfill({ json: { invitation: { status: 'pending', contactType: 'phone', gymName: 'Mikocheni Fitness', planName: 'Couples 3 months', until: '2027-02-01T08:00:00.000Z', buyerName: 'Asha' } } });
    });
    await page.goto(`/gym-pass/#${TOKEN}`);
    await expect(page.getByTestId('gp-invite-ok')).toBeVisible();
    await expect(page.getByTestId('gp-invite-gym')).toContainText('Mikocheni Fitness');
    await expect(page.getByTestId('gp-invite-plan')).toContainText('Couples 3 months');
    await expect(page.getByTestId('gp-invite-from')).toContainText('Asha');
    await expect(page.getByTestId('gp-invite-signin')).toHaveAttribute('href', /\/m\/signin\/?$/);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({ token: TOKEN });
    expect(requests[0].url).not.toContain(TOKEN);
    expect(requests[0].headers['authorization']).toBeUndefined();
    expect(page.url()).not.toContain(TOKEN);
    expect(page.url()).not.toContain('?');
  });

  test('invite landing: expired link, unknown link, no token, rate limit', async ({ page }) => {
    let mode: 'expired' | 'unknown' | 'limited' = 'expired';
    let n = 0;
    await page.route(`${API}/gym-pass-invitations/preview`, async route => {
      n += 1;
      if (mode === 'expired') return route.fulfill({ json: { invitation: { status: 'expired', contactType: 'email' } } });
      if (mode === 'limited') return route.fulfill({ status: 429, json: { error: 'rate_limited', retryAfterSeconds: 30 } });
      return route.fulfill({ status: 404, json: { error: 'invalid_invitation' } });
    });
    await page.goto(`/gym-pass/#${TOKEN}`);
    await expect(page.getByTestId('gp-invite-expired')).toContainText('expired');
    mode = 'unknown';
    await page.goto('about:blank');
    await page.goto(`/gym-pass/#${TOKEN}x`);
    await expect(page.getByTestId('gp-invite-not-found')).toBeVisible();
    const before = n;
    await page.goto('about:blank');
    await page.goto('/gym-pass/');
    await expect(page.getByTestId('gp-invite-not-found')).toBeVisible();
    expect(n).toBe(before);
    mode = 'limited';
    await page.goto('about:blank');
    await page.goto(`/gym-pass/#${TOKEN}`);
    await expect(page.getByTestId('gp-invite-rate-limited')).toContainText('30 seconds');
  });

  test('admin Payments: a gym pass payment is labelled "Gym pass" and has no refund button', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('token', 'admin-e2e-token');
      localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
      localStorage.setItem('locale', 'en');
    });
    await page.route(`${API}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/admin/payment-requests') {
        return route.fulfill({
          json: [{
            id: 'pay-pass', memberId: 'member-1', subscriptionId: null, passPurchaseId: 'pur-1', tier: null, plan: null, amountTzs: 240000, status: 'approved',
            provider: 'admin_approved', reference: 'R1', note: 'gym_pass', requestedAt: '2026-11-01T08:00:00.000Z', decidedAt: '2026-11-01T09:00:00.000Z',
            gymId: 'gym-1', gym: { id: 'gym-1', name: 'Mikocheni Fitness' }, member: { displayName: 'Asha Buyer' }, subscription: null,
          }],
        });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto('/admin/payments');
    await page.getByRole('button', { name: 'Approved', exact: true }).click();
    await expect(page.getByText('GYM PASS', { exact: true })).toBeVisible();
    await expect(page.getByText('Asha Buyer')).toBeVisible();
    await expect(page.getByTestId('payment-refund')).toHaveCount(0);
  });
});

test.describe('flag off', () => {
  test.skip(FLAG_ON, 'needs NEXT_PUBLIC_GYM_CUSTOM_PASSES=false');

  test('no nav item; the page shows the not-available state and makes no pass request', async ({ page }) => {
    await signInOwner(page);
    const seen = await mockOwnerApi(page);
    await page.goto('/owner/memberships');
    await expect(page.getByTestId('gp-off')).toContainText('not available yet');
    await expect(page.locator('nav').getByText('Membership & Pass Management')).toHaveCount(0);
    expect(seen.calls.filter(c => c.path.includes('pass-'))).toEqual([]);
  });

  test('the member Gym passes page is not available and asks the server for nothing', async ({ page }) => {
    const seen = await mockMemberApi(page);
    await page.goto('/m/gym-passes/');
    await expect(page.getByTestId('member-flag-off')).toBeVisible();
    expect(seen.calls.filter(c => c.path.includes('gym-pass'))).toEqual([]);
  });

  test('the invite page shows the not-available state and makes no request', async ({ page }) => {
    const calls: string[] = [];
    await page.route(`${API}/**`, async route => { calls.push(route.request().url()); await route.fulfill({ json: {} }); });
    await page.goto(`/gym-pass/#${TOKEN}`);
    await expect(page.getByTestId('gp-invite-off')).toBeVisible();
    expect(page.url()).not.toContain(TOKEN);
    expect(calls.filter(u => u.includes('gym-pass'))).toEqual([]);
  });
});

// Analytics (backend functions#365): the new summary keys exist only while the server flag is on.
const analytics = {
  byPlan: [
    { planId: 'plan-1', name: 'Couples 3 months', category: 'couples', sales: 3, revenueTzs: 720000, people: 6 },
    { planId: 'plan-2', name: 'Family of 4', category: 'group', sales: 1, revenueTzs: 240000, people: 3 },
  ],
  expiring: { withinDays: 7, purchases: 1, people: 2 },
  utilisation: { visits: 12, peopleWithVisit: 3, peopleNeverVisited: 2, activePeople: 5, visitsPerActivePerson: 2.4 },
  groups: { slots: 4, filled: 3, fillRate: 0.75 },
};
const soonIso = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

test.describe('analytics, flag on', () => {
  test.skip(!FLAG_ON, 'needs NEXT_PUBLIC_GYM_CUSTOM_PASSES=true');

  test('renders by-plan, expiring, utilisation, group fill and the people lists', async ({ page }) => {
    await signInOwner(page);
    await mockOwnerApi(page, (m, p) => {
      if (p.startsWith('/owner/gyms/gym-1/pass-summary')) return { json: { ...summary, ...analytics } };
      if (p.startsWith('/owner/gyms/gym-1/pass-memberships')) return { json: { state: 'active', memberships: [{ ...membership, expiresAt: soonIso() }] } };
      return null;
    });
    await page.goto('/owner/memberships');
    await expect(page.getByTestId('gp-analytics')).toBeVisible();
    await expect(page.getByTestId('gp-byplan-row')).toHaveCount(2);
    await expect(page.getByTestId('gp-byplan-row').first()).toContainText('Couples 3 months');
    await expect(page.getByTestId('gp-an-expiring')).toHaveText('2');
    await expect(page.getByTestId('gp-utilisation')).toContainText('1 passes ending within 7 days');
    await expect(page.getByTestId('gp-an-visits')).toHaveText('12');
    await expect(page.getByTestId('gp-an-with-visit')).toHaveText('3');
    await expect(page.getByTestId('gp-an-never')).toHaveText('2');
    await expect(page.getByTestId('gp-an-per-person')).toHaveText('2.4');
    await expect(page.getByTestId('gp-an-group-fill')).toHaveText('3 of 4');
    await expect(page.getByTestId('gp-utilisation')).toContainText('Fill rate 75%');
    // Lists from pass-memberships: Juma has 0 visits; the pass ends within 7 days.
    await expect(page.getByTestId('gp-never-row')).toHaveCount(1);
    await expect(page.getByTestId('gp-never-row')).toContainText('Juma Partner');
    await expect(page.getByTestId('gp-expiring-row')).toHaveCount(1);
  });

  test('without the new keys the analytics section is absent and the totals still render', async ({ page }) => {
    await signInOwner(page);
    await mockOwnerApi(page);
    await page.goto('/owner/memberships');
    await expect(page.getByTestId('gp-summary')).toBeVisible();
    await expect(page.getByTestId('gp-analytics')).toHaveCount(0);
  });

  test('a partial summary shows em-dash and "not available", not zeros', async ({ page }) => {
    await signInOwner(page);
    await mockOwnerApi(page, (m, p) => (p.startsWith('/owner/gyms/gym-1/pass-summary') ? { json: { ...summary, byPlan: [] } } : null));
    await page.goto('/owner/memberships');
    await expect(page.getByTestId('gp-byplan-empty')).toBeVisible();
    await expect(page.getByTestId('gp-an-visits')).toHaveText('—');
    await expect(page.getByTestId('gp-an-group-fill')).toHaveText('—');
    await expect(page.getByTestId('gp-utilisation')).toContainText('Not available');
  });

  test('the date range is sent as from and to, explained, and can be cleared', async ({ page }) => {
    await signInOwner(page);
    const seen = await mockOwnerApi(page, (m, p) => (p.startsWith('/owner/gyms/gym-1/pass-summary') ? { json: { ...summary, ...analytics } } : null));
    await page.goto('/owner/memberships');
    await expect(page.getByTestId('gp-range-note')).toContainText('approved in that range');
    await page.getByTestId('gp-range-from').fill('2026-11-01');
    await page.getByTestId('gp-range-to').fill('2026-12-01');
    await expect.poll(() => seen.calls.some(c => c.path === '/owner/gyms/gym-1/pass-summary?from=2026-11-01&to=2026-12-01')).toBe(true);
    await page.getByTestId('gp-range-clear').click();
    await expect(page.getByTestId('gp-range-from')).toHaveValue('');
    await expect.poll(() => seen.calls.filter(c => c.path === '/owner/gyms/gym-1/pass-summary').length).toBeGreaterThan(1);
  });
});

const checkin = (over: Record<string, unknown> = {}) => ({
  id: 'c1', memberId: 'm1', memberPublicId: 'FF-1', displayName: 'Asha Buyer', memberPhone: null, timestamp: '2026-11-10T08:00:00.000Z', passTier: null, visitNumberInCycle: null, gymTier: 'standard', ...over,
});
const dashboardBase = {
  gym: { id: 'gym-1', name: 'Mikocheni Fitness', tier: 'standard', perVisitRate: 0 }, todayCount: 1, monthVisits: 2,
  periodVisits: 5, periodMembers: 3, directVisits: 3, directMembers: 2, fitflexVisits: 2, fitflexMembers: 1,
};

test.describe('check-in badge and dashboard (driven by the keys, either flag value)', () => {
  test('a pass visit shows the pass name; other rows are unchanged', async ({ page }) => {
    await signInOwner(page);
    await mockOwnerApi(page, (m, p) => (p === '/operator/checkins'
      ? { json: [checkin({ pass: { name: 'Couples 3 months', category: 'couples' } }), checkin({ id: 'c2', pass: null }), checkin({ id: 'c3', passTier: 'standard' })] }
      : null));
    await page.goto('/checkins');
    await expect(page.getByTestId('checkin-pass')).toHaveCount(1);
    await expect(page.getByTestId('checkin-pass')).toContainText('Couples 3 months');
    await expect(page.getByTestId('checkin-pass')).toContainText('Couples');
    await expect(page.getByText('Direct', { exact: true })).toHaveCount(1);
  });

  test('without the pass key the list is as before', async ({ page }) => {
    await signInOwner(page);
    await mockOwnerApi(page, (m, p) => (p === '/operator/checkins' ? { json: [checkin()] } : null));
    await page.goto('/checkins');
    await expect(page.getByText('Direct', { exact: true })).toBeVisible();
    await expect(page.getByTestId('checkin-pass')).toHaveCount(0);
  });

  test('dashboard shows pass members and visits only when the keys are present', async ({ page }) => {
    await signInOwner(page);
    await mockOwnerApi(page, (m, p) => (p.startsWith('/operator/dashboard') ? { json: { ...dashboardBase, passVisits: 7, passMembers: 4 } } : null));
    await page.goto('/dashboard');
    await expect(page.getByTestId('dash-pass-members')).toHaveText('4');
    await expect(page.getByTestId('dash-pass-visits')).toHaveText('7 visits');
  });

  test('dashboard has no pass card when the keys are missing', async ({ page }) => {
    await signInOwner(page);
    await mockOwnerApi(page, (m, p) => (p.startsWith('/operator/dashboard') ? { json: dashboardBase } : null));
    await page.goto('/dashboard');
    await expect(page.getByText('Direct members', { exact: true }).last()).toBeVisible();
    await expect(page.getByTestId('dash-pass-members')).toHaveCount(0);
  });
});

test.describe('door scan result (driven by the pass key, either flag value)', () => {
  async function scanWith(page: Page, body: unknown) {
    await page.addInitScript(() => {
      localStorage.setItem('token', 'operator-e2e-token');
      localStorage.setItem('user', JSON.stringify({ id: 'operator-1', userType: 'gym_operator', email: 'operator@example.com', gymId: 'gym-1' }));
      localStorage.setItem('locale', 'en');
    });
    await page.route(`${API}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/operator/checkins' && route.request().method() === 'POST') return route.fulfill({ status: 200, json: body });
      return route.fulfill({ json: [] });
    });
    await page.goto('/scan');
    await page.getByTestId('manual-token').fill('usr_test.123.sig');
    await page.getByTestId('manual-submit').click();
  }
  const checkin = { id: 'chk_1', memberId: 'usr_1', memberPublicId: 'FFA-1', passTier: null, visitNumberInCycle: null, passPurchaseId: 'gpu_1' };

  test('a custom-pass visit shows the pass name and when it ends, in place of "Gym membership"', async ({ page }) => {
    await scanWith(page, { ok: true, checkin, pass: { name: 'Pair Pass', category: 'couples', expiresAt: '2026-12-20T00:00:00.000Z', daysLeft: 30, status: 'active' } });
    await expect(page.getByTestId('scan-tier')).toHaveText('Pair Pass');
    await expect(page.getByTestId('scan-pass-until')).toContainText('Ends ');
    await expect(page.getByTestId('scan-result')).not.toContainText('Gym membership');
  });

  test('a visit without the pass key, or with null, is shown exactly as before', async ({ page }) => {
    await scanWith(page, { ok: true, checkin: { ...checkin, passPurchaseId: null } });
    await expect(page.getByTestId('scan-tier')).toHaveText('Gym membership');
    await expect(page.getByTestId('scan-pass-until')).toHaveCount(0);
  });

  test('a pass with no name falls back to "Gym membership" and still shows the end date', async ({ page }) => {
    await scanWith(page, { ok: true, checkin, pass: { name: null, category: null, expiresAt: '2026-12-20T00:00:00.000Z', daysLeft: 30, status: 'active' } });
    await expect(page.getByTestId('scan-tier')).toHaveText('Gym membership');
    await expect(page.getByTestId('scan-pass-until')).toBeVisible();
  });
});
