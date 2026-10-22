import { expect, test, Page } from '@playwright/test';

// Shared-gym payout owner (functions#247, GYM_PAYOUT_OWNER). Fully mocked API.
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Json = Record<string, unknown>;
type Owner = { id: string; displayName: string | null; email: string | null };

const asha: Owner = { id: 'own-a', displayName: 'Asha Owner', email: 'asha@example.com' };
const baraka: Owner = { id: 'own-b', displayName: 'Baraka Owner', email: 'baraka@example.com' };
const chui: Owner = { id: 'own-c', displayName: 'Chui Owner', email: 'chui@example.com' };

const baseGym = { location: 'Dar es Salaam', tier: 'standard', status: 'active', perVisitRate: 5000, ratePerDay: 5000, ratePerWeek: 30000, ratePerMonth: 100000, commissionRate: 10, verified: true, coordinates: { lat: -6.8, lng: 39.2 } };

type GymState = { id: string; name: string; payoutOwnerId: string | null; owners: Owner[] };

/** The backend rule: named → that owner; one owner → them; 2+ none named → payout_owner_required. */
function payoutOwner(g: GymState, flagOn: boolean) {
  if (!flagOn) return g.owners.length ? { mode: 'first_owner', ownerId: null, source: 'first_owner', reason: null } : { mode: 'first_owner', ownerId: null, source: null, reason: 'no_owner_account' };
  const named = g.owners.find(o => o.id === g.payoutOwnerId);
  if (named) return { mode: 'named', ownerId: named.id, source: 'named', reason: null };
  if (g.owners.length === 1) return { mode: 'named', ownerId: g.owners[0].id, source: 'only_owner', reason: null };
  if (!g.owners.length) return { mode: 'named', ownerId: null, source: null, reason: 'no_owner_account' };
  return { mode: 'named', ownerId: null, source: null, reason: 'payout_owner_required' };
}

async function setup(page: Page, opts: { flagOn?: boolean; locale?: 'en' | 'sw'; ownerSaveAnswer?: Json; barakaLeavesBeforeSave?: boolean } = {}) {
  const flagOn = opts.flagOn ?? true;
  const gyms: GymState[] = [
    { id: 'gym-1', name: 'Shared Fitness', payoutOwnerId: null, owners: [asha, baraka] },
    { id: 'gym-2', name: 'Solo Gym', payoutOwnerId: null, owners: [chui] },
  ];
  const puts: Json[] = [];
  const gymPosts: Json[] = [];
  const view = (g: GymState) => ({ gymId: g.id, payoutOwnerId: g.payoutOwnerId, owners: g.owners, payoutOwner: payoutOwner(g, flagOn) });
  const row = (g: GymState) => ({ ...baseGym, id: g.id, name: g.name, payoutOwnerId: g.payoutOwnerId, owners: g.owners, payoutOwner: payoutOwner(g, flagOn) });

  await page.addInitScript(([locale]) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
    localStorage.setItem('locale', locale);
  }, [opts.locale ?? 'en']);

  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const po = path.match(/^\/admin\/gyms\/([^/]+)\/payout-owner$/);
    if (po) {
      const g = gyms.find(x => x.id === decodeURIComponent(po[1]));
      if (!g) return route.fulfill({ status: 404, json: { error: 'gym_not_found' } });
      if (req.method() === 'PUT') {
        const body = req.postDataJSON() as Json;
        puts.push(body);
        if (!('ownerId' in body)) return route.fulfill({ status: 400, json: { error: 'ownerId_required' } });
        if (opts.barakaLeavesBeforeSave && body.ownerId === 'own-b') {
          // Another admin took Baraka off the gym after the picker loaded.
          g.owners = g.owners.filter(o => o.id !== 'own-b');
        }
        if (body.ownerId !== null && !g.owners.some(o => o.id === body.ownerId)) return route.fulfill({ status: 409, json: { error: 'not_a_gym_owner', owners: g.owners } });
        g.payoutOwnerId = body.ownerId as string | null;
      }
      return route.fulfill({ json: view(g) });
    }
    if (path === '/admin/gyms' && req.method() === 'POST') {
      const body = req.postDataJSON() as Json;
      gymPosts.push(body);
      return route.fulfill({ json: { ...baseGym, ...body } });
    }
    if (path === '/admin/gyms') return route.fulfill({ json: gyms.map(row) });
    const one = path.match(/^\/gyms\/([^/]+)$/);
    if (one) { const g = gyms.find(x => x.id === one[1]); return route.fulfill({ json: g ? { ...row(g), images: [] } : {} }); }
    if (path === '/admin/gym-owners' && req.method() === 'POST') {
      return route.fulfill({ json: { id: 'own-c', userType: 'gym_operator', displayName: 'Chui Owner', email: 'chui@example.com', gymIds: ['gym-1', 'gym-2'], ...(opts.ownerSaveAnswer ?? {}) } });
    }
    if (path === '/admin/gym-owners') {
      return route.fulfill({ json: [
        { id: 'own-a', userType: 'gym_operator', displayName: 'Asha Owner', email: 'asha@example.com', gymIds: ['gym-1'], accountStatus: 'active', approvalStatus: 'approved' },
        { id: 'own-b', userType: 'gym_operator', displayName: 'Baraka Owner', email: 'baraka@example.com', gymIds: ['gym-1'], accountStatus: 'suspended', approvalStatus: 'approved' },
        { id: 'own-c', userType: 'gym_operator', displayName: 'Chui Owner', email: 'chui@example.com', gymIds: ['gym-2'], accountStatus: 'active', approvalStatus: 'approved' },
      ] });
    }
    if (/^\/admin\/gym-owners\/[^/]+\/personal-details$/.test(path)) {
      return route.fulfill({ json: { ownerId: 'own-c', personalDetails: { dateOfBirth: null, age: null, gender: null, genderFrom: null, source: null } } });
    }
    return route.fulfill({ json: [] });
  });
  return { gyms, puts, gymPosts };
}

test('shared gym without a payout owner: badge, filter, name one with confirm, then clear it', async ({ page }) => {
  const { puts } = await setup(page);
  await page.goto('/admin/gyms');

  const shared = page.getByTestId('payout-owner-cell-gym-1');
  await expect(shared).toContainText('Needs payout owner');
  await expect(page.getByTestId('payout-owner-cell-gym-2')).toContainText('Chui Owner');
  await expect(page.getByTestId('payout-owner-cell-gym-2')).toContainText('The only owner');

  // Filter: only gyms whose payouts wait for a payout owner.
  const filter = page.getByTestId('filter-needs-payout-owner');
  await expect(filter).toHaveText(/Needs payout owner \(1\)/);
  await filter.click();
  await expect(page.getByText('Solo Gym')).toHaveCount(0);
  await expect(page.getByText('Shared Fitness')).toBeVisible();
  await filter.click();
  await expect(page.getByText('Solo Gym')).toBeVisible();

  // Picker offers this gym's owners only (suspended Baraka included, Chui not).
  await shared.click();
  const dialog = page.getByTestId('payout-owner-dialog');
  await expect(page.getByTestId('payout-owner-reason')).toContainText('more than one owner');
  const select = page.getByTestId('payout-owner-select');
  await expect(select.locator('option')).toHaveText(['Choose an owner of this gym', 'Asha Owner · asha@example.com', 'Baraka Owner · baraka@example.com']);
  await expect(page.getByTestId('payout-owner-save')).toBeDisabled();
  await expect(page.getByTestId('payout-owner-clear')).toHaveCount(0);

  await select.selectOption('own-b');
  await page.getByTestId('payout-owner-save').click();
  await expect(page.getByTestId('payout-owner-confirm-text')).toContainText('Payouts for Shared Fitness will go to Baraka Owner');
  expect(puts).toEqual([]); // nothing sent before confirming
  await page.getByTestId('payout-owner-confirm').click();
  await expect(page.getByTestId('payout-owner-notice')).toHaveText('Payout owner saved.');
  expect(puts).toEqual([{ ownerId: 'own-b' }]);
  await expect(dialog.getByTestId('payout-owner-named')).toHaveText('Baraka Owner');
  await expect(dialog.getByTestId('payout-owner-paid')).toContainText('Named by an admin');

  // Clear with confirmation: back to "needs payout owner".
  await page.getByTestId('payout-owner-clear').click();
  await expect(page.getByTestId('payout-owner-confirm-text')).toContainText('its payouts wait until one is named again');
  await page.getByTestId('payout-owner-confirm').click();
  await expect(page.getByTestId('payout-owner-notice')).toHaveText('Payout owner cleared.');
  expect(puts).toEqual([{ ownerId: 'own-b' }, { ownerId: null }]);
  await page.getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByTestId('payout-owner-cell-gym-1')).toContainText('Needs payout owner');
});

test('an owner who left the gym meanwhile: 409 not_a_gym_owner is explained and the list refreshed', async ({ page }) => {
  await setup(page, { barakaLeavesBeforeSave: true });
  await page.goto('/admin/gyms');
  await page.getByTestId('payout-owner-cell-gym-1').click();
  const select = page.getByTestId('payout-owner-select');
  await expect(select.locator('option')).toHaveCount(3);
  await select.selectOption('own-b');
  await page.getByTestId('payout-owner-save').click();
  await page.getByTestId('payout-owner-confirm').click();
  await expect(page.getByTestId('payout-owner-error')).toHaveText('That person is no longer an owner of this gym. The list of owners has been refreshed; choose again.');
  await expect(select.locator('option')).toHaveText(['Choose an owner of this gym', 'Asha Owner · asha@example.com']);
});

test('switch off: gym detail explains that the payout owner takes effect when the switch goes on', async ({ page }) => {
  await setup(page, { flagOn: false });
  await page.goto('/admin/gyms');
  // With the switch off nothing "needs" a payout owner, so no filter; the shared gym says it is not named yet.
  await expect(page.getByTestId('filter-needs-payout-owner')).toHaveCount(0);
  await expect(page.getByTestId('payout-owner-cell-gym-1')).toContainText('Not named yet');
  await page.getByRole('button', { name: 'Shared Fitness' }).first().click();
  const summary = page.getByTestId('payout-owner-summary');
  await expect(summary.getByTestId('payout-owner-switch-off')).toContainText('takes effect when the switch is turned on');
  await expect(summary.getByTestId('payout-owner-paid')).toHaveText('First owner account found');
  await summary.getByTestId('payout-owner-change').click();
  await expect(page.getByTestId('payout-owner-dialog')).toBeVisible();
  await expect(page.getByTestId('payout-owner-summary')).toHaveCount(0); // detail dialog closed, not stacked
});

test('saving an owner that leaves a shared gym without a payout owner shows a warning that links to the gym', async ({ page }) => {
  await setup(page, { ownerSaveAnswer: { payoutOwnerRequiredGymIds: ['gym-1'] } });
  await page.goto('/admin/owners');
  await page.getByText('Chui Owner').first().click();
  await page.getByRole('button', { name: 'Update' }).click();
  const warning = page.getByTestId('payout-owner-required-warning');
  await expect(warning).toContainText('Their payouts wait until you name one');
  const link = warning.getByRole('link', { name: 'Shared Fitness' });
  await expect(link).toHaveAttribute('href', /^\/admin\/gyms\/?\?payoutOwner=gym-1$/);
  await link.click();
  await expect(page.getByTestId('payout-owner-dialog')).toBeVisible();
  await expect(page.getByTestId('payout-owner-reason')).toContainText('more than one owner');
});

test('Swahili: badge, filter and reason are translated', async ({ page }) => {
  await setup(page, { locale: 'sw' });
  await page.goto('/admin/gyms');
  await expect(page.getByTestId('payout-owner-cell-gym-1')).toContainText('Inahitaji mmiliki anayelipwa');
  await expect(page.getByTestId('filter-needs-payout-owner')).toHaveText(/Inahitaji mmiliki anayelipwa \(1\)/);
  await page.getByTestId('payout-owner-cell-gym-1').click();
  await expect(page.getByTestId('payout-owner-reason')).toContainText('mmiliki zaidi ya mmoja');
});

// ── settlement statement payee ──
const statement = { id: 'st-1', runId: 'run-1', mode: 'live', gymId: 'gym-1', gymName: 'Shared Fitness', periodStartDate: '2026-10-01', periodEndDate: '2026-10-31', memberCycleCount: 0, qualifyingVisitCount: 0, heldVisitCount: 0, preliminaryTzs: 0, networkAdjustmentTzs: 0, adjustmentsTzs: 0, carryForwardTzs: 0, finalNetTzs: 50000, status: 'approved', holdReason: null, submittedBy: null };

async function statementPage(page: Page, payee: Json | undefined) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });
  await page.route(`${API}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST' && path.endsWith('/payable')) return route.fulfill({ status: 409, json: { error: 'not_payable', reason: 'payout_owner_required' } });
    if (path === '/admin/settlements/statements/st-1') return route.fulfill({ json: { statement, ...(payee ? { payee } : {}), lines: [], visits: [], adjustments: [] } });
    if (path === '/admin/settlements/statements') return route.fulfill({ json: [statement] });
    return route.fulfill({ json: [] });
  });
  await page.goto('/admin/settlements?statement=st-1');
}

test('statement detail shows the payee with its source', async ({ page }) => {
  await statementPage(page, { ownerId: 'own-b', displayName: 'Baraka Owner', source: 'named', reason: null });
  await expect(page.getByTestId('settlement-payee')).toContainText('Payee');
  await expect(page.getByTestId('settlement-payee')).toContainText('Baraka Owner');
  await expect(page.getByTestId('settlement-payee')).toContainText('(Named by an admin)');
});

test('statement detail: nobody can be paid yet, and clearing for payment explains why', async ({ page }) => {
  await statementPage(page, { ownerId: null, displayName: null, source: null, reason: 'payout_owner_required' });
  await expect(page.getByTestId('settlement-payee')).toContainText('Nobody can be paid yet');
  await expect(page.getByTestId('settlement-payee')).toContainText('none is named as payout owner');
  await page.getByTestId('settlement-payable').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear for payment' }).click();
  await expect(page.getByText('This gym can’t be paid yet: it has more than one owner and no payout owner. Name one on the Gyms page.')).toBeVisible();
});

test('statement detail without payee (switch off) shows no payee line', async ({ page }) => {
  await statementPage(page, undefined);
  await expect(page.getByTestId('settlement-net')).toBeVisible();
  await expect(page.getByTestId('settlement-payee')).toHaveCount(0);
});

test('saving a gym never sends the read-only payout-owner fields back', async ({ page }) => {
  const { gymPosts } = await setup(page);
  await page.goto('/admin/gyms');
  await expect(page.getByTestId('payout-owner-cell-gym-1')).toContainText('Needs payout owner');
  await page.locator('select').filter({ has: page.locator('option[value="suspended"]') }).first().selectOption('inactive');
  await expect.poll(() => gymPosts.length).toBe(1);
  expect(gymPosts[0]).toMatchObject({ id: 'gym-1', status: 'inactive' });
  for (const key of ['payoutOwnerId', 'owners', 'payoutOwner']) expect(gymPosts[0]).not.toHaveProperty(key);
});
