import { expect, test, type Page } from '@playwright/test';

// Admin Phase 0 (audit 2026-10-29, E1 and the nav guard): a failed load is an error with a retry, never an empty
// result; and the nav guard matches the longest href. Mocked API; every request outside localhost is aborted.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.use({ serviceWorkers: 'block' });

type Reply = { status?: number; json?: unknown };
type Routes = Record<string, Reply | (() => Reply)>;

const SUPER = { id: 'adm_1', userType: 'admin', email: 'one@fitflex.test' };
const staff = (aclPermissions: string[]) => ({ id: 'staff_1', userType: 'admin', portalUser: true, aclPermissions, email: 'staff@fitflex.test' });
const FAIL: Reply = { status: 500, json: { error: 'boom' } };

async function open(page: Page, user: Record<string, unknown>, routes: Routes, path: string, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'admin-tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [user, locale] as const);
  await page.context().route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => route.abort());
  await page.context().route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    const hit = routes[`${route.request().method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit() : hit;
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? null });
  });
  await page.goto(path);
}

const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
const dash = {
  asOf: '2026-10-29', totals: { invoicedTzs: 0, creditNotesTzs: 0, collectedTzs: 0, outstandingTzs: 0, overdueTzs: 0, creditTzs: 0 }, aging,
  organizations: [{ organizationId: 'org_1', name: 'Acme Ltd', status: 'active', invoicedTzs: 1, creditNotesTzs: 0, collectedTzs: 0, outstandingTzs: 1, overdueTzs: 0, creditTzs: 0, aging }],
  currentPeriod: { period: '2026-10', draftInvoices: 0, draftTotalTzs: 0 },
  billedAgainstProviders: { period: '2026-10', billedTzs: 0, differenceTzs: 0, note: '', providerObligations: { gymVisitsTzs: 0, sponsoredPassesTzs: 0, trainerSessionsTzs: 0, totalTzs: 0 } },
};
const orgs = { items: [{ id: 'org_1', tradingName: 'Acme', legalName: 'Acme Ltd' }], total: 1 };

test.describe('failed loads are errors, not empty results', () => {
  test('settlements: a failed clawbacks request shows an error with a retry, and retry works', async ({ page }) => {
    let down = true;
    await open(page, SUPER, {
      'GET /admin/settlements/statements': { json: [] },
      'GET /admin/settlements/runs': { json: [] },
      'GET /admin/settlements/clawbacks': () => (down ? FAIL : { json: { raised: [], pending: [{ gymId: 'g1', gymName: 'Kariakoo Gym', amountTzs: -5000, type: 'clawback', reason: 'x' }], skipped: [] } }),
    }, '/admin/settlements');
    await expect(page.getByTestId('settlement-clawbacks-error')).toContainText('Pending clawbacks could not be loaded');
    await expect(page.getByTestId('settlement-clawbacks-pending')).toHaveCount(0);
    down = false;
    await page.getByTestId('settlement-clawbacks-error').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('settlement-clawbacks-pending')).toContainText('Kariakoo Gym');
    await expect(page.getByTestId('settlement-clawbacks-error')).toHaveCount(0);
  });

  test('settlement config: a failed gym list shows an error, not an empty list', async ({ page }) => {
    await open(page, SUPER, {
      'GET /admin/settlement-config': { json: { passTierVersions: [], rules: [], rateCards: [] } },
      'GET /admin/gyms': FAIL,
    }, '/admin/settlement-config');
    await expect(page.getByTestId('settlement-config-gyms-error')).toContainText('The gym list could not be loaded');
  });

  test('B2B billing: a failed organisation list shows an error', async ({ page }) => {
    await open(page, SUPER, {
      'GET /admin/b2b/billing': { json: dash },
      'GET /admin/b2b/organizations': FAIL,
    }, '/admin/b2b-billing');
    await expect(page.getByTestId('billing-orgs-error')).toContainText('The organisation list could not be loaded');
  });

  test('B2B billing: a failed dashboard shows an error, not zeros', async ({ page }) => {
    await open(page, SUPER, { 'GET /admin/b2b/billing': FAIL, 'GET /admin/b2b/organizations': { json: orgs } }, '/admin/b2b-billing');
    await expect(page.getByTestId('billing-load-error')).toContainText('Billing could not be loaded');
    await expect(page.getByTestId('billing-totals')).toHaveCount(0);
  });

  test('B2B billing: an organisation whose billing fails to load shows an error, not stale or empty data', async ({ page }) => {
    await open(page, SUPER, {
      'GET /admin/b2b/billing': { json: dash },
      'GET /admin/b2b/organizations': { json: orgs },
      'GET /admin/b2b/organizations/org_1/statement': FAIL,
    }, '/admin/b2b-billing');
    await page.getByTestId('billing-organizations').getByRole('button', { name: 'Acme Ltd' }).click();
    await expect(page.getByTestId('org-billing-load-error')).toContainText("This organisation's billing could not be loaded");
  });

  test('B2B analytics: a failed organisation list shows an error', async ({ page }) => {
    await open(page, SUPER, { 'GET /admin/b2b/organizations': FAIL }, '/admin/b2b-analytics');
    await expect(page.getByTestId('analytics-orgs-error')).toContainText('The organisation list could not be loaded');
  });

  test('Swahili: the error is translated', async ({ page }) => {
    await open(page, SUPER, { 'GET /admin/b2b/organizations': FAIL }, '/admin/b2b-analytics', 'sw');
    await expect(page.getByTestId('analytics-orgs-error')).toContainText('Orodha ya mashirika haikuweza kupakiwa');
  });

  test('tax rates: only 404 feature_disabled is "VAT off"; a 500 or another 404 is an error', async ({ page }) => {
    await open(page, SUPER, { 'GET /admin/tax-rates': { status: 404, json: { error: 'feature_disabled' } } }, '/admin/tax-rates');
    await expect(page.getByTestId('tax-rates-off')).toBeVisible();
  });
  for (const [name, reply] of [['500', FAIL], ['404 not_found', { status: 404, json: { error: 'not_found' } }]] as const) {
    test(`tax rates: ${name} is a load error with a retry`, async ({ page }) => {
      await open(page, SUPER, { 'GET /admin/tax-rates': reply }, '/admin/tax-rates');
      await expect(page.getByText("Couldn't load the tax rates.")).toBeVisible();
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
      await expect(page.getByTestId('tax-rates-off')).toHaveCount(0);
    });
  }
});

test.describe('nav guard', () => {
  test('billing-only staff reach /admin/b2b-billing (not bounced to the /admin/b2b item)', async ({ page }) => {
    await open(page, staff(['b2b_billing']), { 'GET /admin/b2b/billing': { json: dash }, 'GET /admin/b2b/organizations': { json: orgs } }, '/admin/b2b-billing');
    await expect(page.getByTestId('b2b-billing')).toBeVisible();
    expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe('/admin/b2b-billing');
  });

  test('payments-only staff are still sent away from /admin/b2b-billing', async ({ page }) => {
    await open(page, staff(['payments']), {}, '/admin/b2b-billing');
    await expect.poll(() => new URL(page.url()).pathname.replace(/\/$/, ''), { timeout: 60_000 }).not.toBe('/admin/b2b-billing');
  });

  for (const scope of ['settlements_prepare', 'settlements_approve', 'settlements_pay']) {
    test(`staff holding only ${scope} reach /admin/settlements`, async ({ page }) => {
      await open(page, staff([scope]), { 'GET /admin/settlements/statements': { json: [] }, 'GET /admin/settlements/runs': { json: [] }, 'GET /admin/settlements/clawbacks': { json: { raised: [], pending: [], skipped: [] } } }, '/admin/settlements');
      await expect(page.getByRole('heading', { name: 'Gym settlements' })).toBeVisible();
      expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe('/admin/settlements');
    });
  }
});
