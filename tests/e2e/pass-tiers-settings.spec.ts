// fitflex-functions#189: Settings is the only FitFlex Pass price source and it fails closed.
// Mock-driven: covers the Settings tier editor (validation, status badges, explicit Unlimited,
// the 400 invalid_subscription_tier), the programme pass-tier picker (only tiers on sale), and
// the tier_not_available / tier_not_configured messages where the portal sells or uses a pass.
import { expect, test, Page } from '@playwright/test';
import { ADMIN, API, BENEFIT, Json, ORG_COMPANY, PROGRAM, SELLABLE_TIERS, setupB2B } from './helpers/b2b-mock';

const SETTINGS = {
  id: 'platform',
  subscriptionTiers: [
    { key: 'basic', label: 'Basic', monthlyPrice: 30000, visits: 12, gymAccess: 'standard' },
    // No visits: not sold, and members holding it can't check in.
    { key: 'legacy', label: 'Legacy', monthlyPrice: 50000, gymAccess: 'standard' },
    // Price 0 but otherwise set up: not sold, members holding it still check in.
    { key: 'free', label: 'Free', monthlyPrice: 0, visits: 4, gymAccess: 'online' },
    // Unknown gym access: not set up.
    { key: 'odd', label: 'Odd', monthlyPrice: 40000, visits: -1, gymAccess: 'everything' },
  ],
  payoutBands: [], paymentPeriodDays: 14, payoutModel: 'commission', currency: 'TZS', updatedAt: '2026-10-19T08:00:00Z',
};

async function mockSettings(page: Page, onPut?: (body: Json) => { status: number; json: Json }) {
  const puts: Json[] = [];
  await page.addInitScript(([u]) => {
    localStorage.setItem('token', 'tiers-e2e-token'); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('locale', 'en');
  }, [ADMIN]);
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/admin/settings' && req.method() === 'GET') return route.fulfill({ json: SETTINGS });
    if (path === '/admin/settings' && req.method() === 'PUT') {
      const body = req.postDataJSON() as Json;
      puts.push(body);
      const out = onPut?.(body) ?? { status: 200, json: { ...SETTINGS, ...body } };
      return route.fulfill(out);
    }
    if (path === '/admin/settings/specialties') return route.fulfill({ json: [] });
    if (path === '/me/personas' || path === '/me/invitations') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ json: req.method() === 'GET' ? [] : {} });
  });
  return puts;
}

test.describe('Settings: subscription tiers', () => {
  test('existing tiers show whether they are on sale, and an invalid list is not saved', async ({ page }) => {
    const puts = await mockSettings(page);
    await page.goto('/admin/settings');
    const editor = page.getByTestId('tiers-editor');
    await expect(editor).toBeVisible();

    await expect(page.getByTestId('tier-0-status')).toHaveText('On sale');
    // Short badge; what it means for holders on a line under it (design QA M9).
    await expect(page.getByTestId('tier-0-status-hint')).toHaveCount(0);
    await expect(page.getByTestId('tier-1-status')).toHaveText('Not set up');
    await expect(page.getByTestId('tier-1-status-hint')).toHaveText('Not sold; holders can’t check in');
    await expect(page.getByTestId('tier-1-error-visits')).toBeVisible();
    await expect(page.getByTestId('tier-2-status')).toHaveText('Not on sale');
    await expect(page.getByTestId('tier-2-status-hint')).toHaveText('Holders can still check in');
    await expect(page.getByTestId('tier-2-error-monthlyPrice')).toBeVisible();
    await expect(page.getByTestId('tier-3-status')).toHaveText('Not set up');
    await expect(page.getByTestId('tier-3-error-gymAccess')).toBeVisible();
    // Unlimited is an explicit choice, not a typed -1.
    await expect(page.getByTestId('tier-3-unlimited')).toBeChecked();
    await expect(page.getByTestId('tier-3-visits')).toHaveCount(0);

    await page.getByRole('button', { name: /Save all/ }).click();
    await expect(page.getByText('Fix the subscription tiers marked below before saving.')).toBeVisible();
    expect(puts).toHaveLength(0);

    // Fix every row, then save.
    await page.getByTestId('tier-1-visits').fill('10');
    await page.getByTestId('tier-2-price').fill('5000');
    await page.getByTestId('tier-3-gym-access').selectOption('premium');
    await expect(page.getByTestId('tier-1-status')).toHaveText('On sale');
    await expect(page.getByTestId('tier-2-status')).toHaveText('On sale');
    await expect(page.getByTestId('tier-3-status')).toHaveText('On sale');
    await page.getByRole('button', { name: /Save all/ }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].subscriptionTiers).toEqual([
      { key: 'basic', label: 'Basic', monthlyPrice: 30000, visits: 12, gymAccess: 'standard' },
      { key: 'legacy', label: 'Legacy', monthlyPrice: 50000, visits: 10, gymAccess: 'standard' },
      { key: 'free', label: 'Free', monthlyPrice: 5000, visits: 4, gymAccess: 'online' },
      { key: 'odd', label: 'Odd', monthlyPrice: 40000, visits: -1, gymAccess: 'premium' },
    ]);
  });

  test('a new tier starts unset, and Unlimited saves -1', async ({ page }) => {
    const puts = await mockSettings(page);
    await page.goto('/admin/settings');
    await page.getByTestId('tier-add').click();
    const i = SETTINGS.subscriptionTiers.length;
    await expect(page.getByTestId(`tier-${i}-visits`)).toHaveValue('');
    await expect(page.getByTestId(`tier-${i}-status`)).toHaveText('Not set up');
    await expect(page.getByTestId(`tier-${i}-error-monthlyPrice`)).toBeVisible();
    await expect(page.getByTestId(`tier-${i}-error-visits`)).toBeVisible();
    await expect(page.getByTestId(`tier-${i}-error-gymAccess`)).toBeVisible();

    // Leave only the new tier, and set it up.
    // Removing a saved tier asks first (holders are refused at check-in once saved).
    for (let k = 0; k < i; k++) {
      await page.getByTestId('tier-0-remove').click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remove tier' }).click();
    }
    await page.getByTestId('tier-0-price').fill('250000');
    await page.getByTestId('tier-0-unlimited').check();
    await page.getByTestId('tier-0-gym-access').selectOption('luxury_executive');
    await expect(page.getByTestId('tier-0-status')).toHaveText('On sale');
    await page.getByRole('button', { name: /Save all/ }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].subscriptionTiers).toEqual([
      expect.objectContaining({ label: 'New tier', monthlyPrice: 250000, visits: -1, gymAccess: 'luxury_executive' }),
    ]);
  });

  test('the backend refusal names the tier and the field', async ({ page }) => {
    await mockSettings(page, () => ({ status: 400, json: { error: 'invalid_subscription_tier', tier: 'basic', field: 'visits', hint: '-1 for unlimited, or a whole number above 0' } }));
    await page.goto('/admin/settings');
    for (const _ of ['legacy', 'free', 'odd']) {
      await page.getByTestId('tier-1-remove').click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remove tier' }).click();
    }
    await page.getByRole('button', { name: /Save all/ }).click();
    await expect(page.getByText('Not saved. Tier basic: Enter the visits a month as a whole number above zero, or tick Unlimited.')).toBeVisible();
  });

  test('Swahili: status and errors are translated', async ({ page }) => {
    await mockSettings(page);
    await page.addInitScript(() => localStorage.setItem('locale', 'sw'));
    await page.goto('/admin/settings');
    await expect(page.getByTestId('tier-0-status')).toHaveText('Inauzwa');
    await expect(page.getByTestId('tier-1-status')).toHaveText('Haijakamilika');
    await expect(page.getByTestId('tier-1-status-hint')).toHaveText('Haiuzwi; walio nayo hawawezi kuingia gym');
  });
});

test.describe('B2B: only tiers on sale, and tier errors', () => {
  test('the pass-tier picker lists the tiers on sale; tier_not_available is explained', async ({ page }) => {
    const mock = await setupB2B(page, ADMIN);
    mock.on('POST', /^\/b2b\/organizations\/([^/]+)\/programs\/([^/]+)\/benefits$/, () => ({ status: 409, json: { error: 'tier_not_available' } }));
    await page.goto('/admin/b2b');
    await page.getByTestId('b2b-org-org-1').click();
    await page.getByTestId('program-prog-1').click();
    await page.getByTestId('benefit-new').click();
    await page.getByTestId('benefit-type').selectOption('sponsored_pass');
    const picker = page.getByTestId('benefit-pass-tier');
    // Nothing is preselected: the admin chooses (design QA L).
    await expect(picker.locator('option')).toHaveText([
      'Choose a pass…', 'Basic · TSh 30,000 · 12 visits a month', 'Pro · TSh 60,000 · 30 visits a month',
      'Premium · TSh 100,000 · 30 visits a month', 'Executive · TSh 200,000 · 30 visits a month',
    ].map(s => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('TSh ', 'TSh\\s?'))));
    await expect(picker).toHaveValue('');
    await picker.selectOption('basic');
    await page.getByTestId('benefit-form').getByLabel('Benefit name', { exact: true }).fill('Pass');
    await page.getByTestId('benefit-funding').selectOption('sponsor_fixed');
    await page.getByTestId('benefit-sponsor-amount').fill('30000');
    await page.getByTestId('benefit-save').click();
    await expect(page.getByText('This pass isn’t on sale right now. A tier needs a price, visits and the gyms it covers set in Settings before it can be sold.')).toBeVisible();
  });

  test('a saved benefit whose tier is no longer on sale keeps it, marked', async ({ page }) => {
    const mock = await setupB2B(page, ADMIN);
    const PASS_BENEFIT = { ...BENEFIT, id: 'bnf-pass', name: 'Gold pass', benefitType: 'sponsored_pass', fundingType: 'sponsor_fixed', sponsorAmountTzs: 30000, passTier: 'gold', usagePeriod: 'unlimited', usageLimit: null };
    mock.on('GET', /^\/b2b\/organizations\/org-1\/programs\/prog-1$/, () => ({ program: PROGRAM, benefits: [PASS_BENEFIT] }));
    await page.goto('/admin/b2b');
    await page.getByTestId('b2b-org-org-1').click();
    await page.getByTestId('program-prog-1').click();
    await page.getByTestId('program-detail').getByRole('button', { name: 'Edit' }).last().click();
    const picker = page.getByTestId('benefit-pass-tier');
    await expect(picker).toHaveValue('gold');
    await expect(picker.locator('option').first()).toHaveText('gold (not on sale)');
  });

  test('no tiers on sale: the picker says so', async ({ page }) => {
    const mock = await setupB2B(page, ADMIN);
    mock.on('GET', /^\/subscription-tiers$/, () => [] as unknown as Json);
    await page.goto('/admin/b2b');
    await page.getByTestId('b2b-org-org-1').click();
    await page.getByTestId('program-prog-1').click();
    await page.getByTestId('benefit-new').click();
    await page.getByTestId('benefit-type').selectOption('sponsored_pass');
    await expect(page.getByText('No pass is on sale. Give a tier a price and visits in Settings first.')).toBeVisible();
  });

  test('preparing flat fees for a tier not on sale is explained', async ({ page }) => {
    const mock = await setupB2B(page, ADMIN);
    const PASS_BENEFIT = { ...BENEFIT, id: 'bnf-pass', benefitType: 'sponsored_pass', passTier: 'pro', status: 'active' };
    mock.on('GET', /^\/b2b\/organizations\/org-1\/programs\/prog-1$/, () => ({ program: { ...PROGRAM, status: 'active', effectiveStatus: 'active' }, benefits: [PASS_BENEFIT] }));
    mock.on('GET', /^\/admin\/b2b\/programs\/prog-1\/entitlements$/, () => ({ period: '2026-10', counts: {}, entitlements: [] }));
    mock.on('POST', /^\/admin\/b2b\/programs\/prog-1\/invoices\/prepare$/, () => ({ status: 409, json: { error: 'tier_not_available' } }));
    await page.goto('/admin/b2b');
    await page.getByTestId('b2b-org-org-1').click();
    await page.getByTestId('program-prog-1').click();
    await page.getByTestId('program-billing').click();
    await page.getByTestId('billing-prepare-current').click();
    await expect(page.getByText(/^This pass isn’t on sale right now\./)).toBeVisible();
  });

  test('moving company seats to a programme on a tier not on sale is explained', async ({ page }) => {
    const mock = await setupB2B(page, ADMIN);
    mock.on('POST', /^\/admin\/b2b\/corporate\/([^/]+)\/convert$/, () => ({ status: 409, json: { error: 'tier_not_available' } }));
    await page.goto('/admin/b2b');
    await page.getByTestId(`b2b-org-${ORG_COMPANY.id}`).click();
    await page.getByTestId('b2b-convert-seats').click();
    await expect(page.getByText(/^This pass isn’t on sale right now\./)).toBeVisible();
  });
});

test('scan: tier_not_configured is explained', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'op-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'owner-1', userType: 'gym_owner', email: 'owner@example.test' }));
    localStorage.setItem('locale', 'en');
  });
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/operator/checkins') return route.fulfill({ status: 409, json: { ok: false, failure: 'tier_not_configured' } });
    if (path === '/me/personas' || path === '/me/invitations') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ json: req.method() === 'GET' ? [] : {} });
  });
  await page.goto('/scan');
  await page.getByTestId('manual-token').fill('usr_1.abc.sig');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('scan-result')).toContainText("Member's pass type is not set up"); // scanner wording from portal#93 (A5)
});

// Keep the seed in the mock aligned with what the backend sells today.
test('mock tiers are all sellable', () => {
  for (const tier of SELLABLE_TIERS) {
    expect(Number.isInteger(tier.monthlyPrice) && tier.monthlyPrice > 0).toBe(true);
    expect(tier.visits === -1 || (Number.isInteger(tier.visits) && tier.visits > 0)).toBe(true);
  }
});
