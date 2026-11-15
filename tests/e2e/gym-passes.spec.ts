import { expect, test, type Page } from '@playwright/test';
import { messages } from '../../src/lib/i18n';
import { gymPassMessages } from '../../src/lib/i18n-gym-passes';
import { classifyGymPassError, inviteTokenFromHash } from '../../src/lib/gym-passes';
import { ApiError } from '../../src/lib/api';

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
    if (p.endsWith('/attendance')) return route.fulfill({ json: { beneficiaryId: 'ben-2', visits: [{ id: 'v1', gymId: 'gym-1', timestamp: '2026-11-10T08:00:00.000Z', method: 'qr', status: 'valid', businessDate: '2026-11-10' }] } });
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
    expect(classifyGymPassError(new ApiError(500, {}))).toMatchObject({ key: 'gp.generic' });
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
    await expect(row).toContainText('Running');
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
    await expect(page.getByTestId('gp-visits-dialog')).toContainText('qr');
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

  test('the invite page shows the not-available state and makes no request', async ({ page }) => {
    const calls: string[] = [];
    await page.route(`${API}/**`, async route => { calls.push(route.request().url()); await route.fulfill({ json: {} }); });
    await page.goto(`/gym-pass/#${TOKEN}`);
    await expect(page.getByTestId('gp-invite-off')).toBeVisible();
    expect(calls.filter(u => u.includes('gym-pass'))).toEqual([]);
  });
});
