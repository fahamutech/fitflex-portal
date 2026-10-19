import { expect, test, type Page, type Request } from '@playwright/test';

// Vendor web portal (S2) against a mocked API: sign-in routing, gating, nav by permission,
// stock adjust, order status moves and privacy, partner payouts, Swahili.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Reply = { status?: number; json: unknown } | ((req: Request) => { status?: number; json: unknown });
type Routes = Record<string, Reply>;

const ALL_PERMISSIONS = ['products', 'orders', 'customers', 'reports', 'payments', 'staff'];
const tools = (extra: Record<string, unknown> = {}) => ({ portal: true, stockLedger: true, buyerContact: true, canSeeCost: true, ...extra });
const me = (extra: Record<string, unknown> = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ALL_PERMISSIONS, approvalStatus: 'approved', accountStatus: 'active', tools: tools(), ...extra,
});

const product = (extra: Record<string, unknown> = {}) => ({
  id: 'prd_1', vendorId: 'usr_vendor', name: 'Whey Protein', category: 'supplements_nutrition', priceTzs: 85000,
  stock: 10, status: 'active', approvalStatus: 'approved', images: [], costTzs: 60000, reorderLevel: 5, variants: [], ...extra,
});
const order = (extra: Record<string, unknown> = {}) => ({
  id: 'ord_0000ab12cd', shortRef: 'AB12CD', createdAt: '2026-10-19T08:30:00.000Z', status: 'pending', orderStatus: 'pending',
  nextStatuses: ['accepted'], timeline: [{ status: 'pending', at: '2026-10-19T08:30:00.000Z' }],
  items: [{ productId: 'prd_1', name: 'Whey Protein', variant: 'Vanilla', qty: 2, priceTzs: 85000, image: null, commissionTzs: 17000, vendorPayoutTzs: 153000 }],
  totalTzs: 170000, paymentStatus: 'paid', paymentMethod: 'mpesa', deliveryMethod: 'gym_pickup', note: 'Please call first',
  pickupGymId: 'gym_42', pickupGym: { id: 'gym_42', name: 'Mikocheni Fitness' },
  buyer: { customerId: 'cus_9', displayName: 'Asha M.', phone: '+255712000111', contactVisibleUntil: null }, ...extra,
});

async function signedInAs(page: Page, user: Record<string, unknown>, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [user, locale] as const);
}
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };
const STAFF = { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' };

/** Every API call goes through here; unknown routes are 404 (Identity V2 off etc.). Returns the calls made. */
async function mockApi(page: Page, routes: Routes) {
  const calls: Array<{ method: string; path: string; search: string; body: unknown }> = [];
  // Nothing in these tests may reach a real service (live API, Firebase, Google).
  await page.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}`;
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, search: url.search, body });
    const hit = routes[key];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req) : hit;
    return route.fulfill({ status: reply.status ?? 200, json: reply.json });
  });
  return calls;
}

const vendorBase = (extra: Routes = {}): Routes => ({
  'GET /vendor/me': { json: me() },
  'GET /vendor/products': { json: [product(), product({ id: 'prd_2', name: 'Shaker', stock: 2, reorderLevel: 3, costTzs: null })] },
  'GET /vendor/stock/low': { json: [{ productId: 'prd_2', name: 'Shaker', variant: null, stock: 2, reorderLevel: 3 }] },
  'GET /vendor/orders': { json: { orders: [order()], nextCursor: null } },
  'GET /vendor/payments': { json: { todaySalesTzs: 170000, pendingSettlementTzs: 50000 } },
  'GET /vendor/statements': { json: { statements: [], payoutReady: true, payoutBlockedBy: null } },
  ...extra,
});

test.describe('sign-in', () => {
  // `next dev` compiles a route on first visit and drops a soft navigation that arrives meanwhile;
  // compile /vendor/ once so the sign-in tests check the app's landing, not the dev compiler.
  test.beforeAll(async ({ browser }) => {
    const warm = await browser.newPage();
    await warm.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
    await warm.route(`${API}/**`, route => route.fulfill({ status: 404, json: { error: 'not_found' } }));
    await warm.goto('/vendor/');
    await warm.close();
  });
  test('the PIN method shows only when the server offers it; a 3-digit PIN sends nothing', async ({ page }) => {
    const calls = await mockApi(page, { 'GET /auth/options': { json: { pinLogin: false } } });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to FitFlex for partners' })).toBeVisible();
    await expect(page.getByTestId('google-submit')).toBeVisible();
    await expect(page.getByTestId('pin-method-btn')).toHaveCount(0);

    await page.unroute(`${API}/**`);
    const calls2 = await mockApi(page, { 'GET /auth/options': { json: { pinLogin: true } } });
    await page.reload();
    await page.getByTestId('pin-method-btn').click();
    await page.getByTestId('pin-identifier-input').fill('0712345678');
    await page.getByTestId('pin-input').fill('123');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByText('Your PIN is 4 digits.')).toBeVisible();
    expect([...calls, ...calls2].filter(c => c.path === '/auth/pin/login')).toHaveLength(0);
  });

  test('a vendor signs in with number + PIN and lands on /vendor/', async ({ page }) => {
    const calls = await mockApi(page, {
      'GET /auth/options': { json: { pinLogin: true } },
      'POST /auth/pin/login': { json: { token: 'vendor-token', user: VENDOR, personas: [] } },
      ...vendorBase(),
    });
    await page.goto('/login');
    await page.getByTestId('pin-method-btn').click();
    await page.getByTestId('pin-identifier-input').fill('0712345678');
    await page.getByTestId('pin-input').fill('1234');
    await page.getByTestId('pin-submit').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('token'))).toBe('vendor-token');
    await expect(page).toHaveURL(/\/vendor\/$/, { timeout: 20_000 });
    expect(calls.find(c => c.path === '/auth/pin/login')?.body).toEqual({ phone: '0712345678', pin: '1234' });
    await expect(page.getByTestId('vendor-business-name').first()).toHaveText('Dar Fitness Gear');
  });

  test('a member session with a vendor persona is switched to it', async ({ page }) => {
    const calls = await mockApi(page, {
      'GET /auth/options': { json: { pinLogin: true } },
      'POST /auth/pin/login': { json: { token: 'member-token', user: { id: 'usr_m', userType: 'member' }, personas: [
        { id: 'usr_m', userType: 'member', accountStatus: 'active' },
        { id: 'usr_vendor', userType: 'vendor', accountStatus: 'active', approvalStatus: 'approved' },
      ] } },
      'POST /auth/switch-persona': { json: { token: 'vendor-token', user: VENDOR, personas: [] } },
      ...vendorBase(),
    });
    await page.goto('/login');
    await page.getByTestId('pin-method-btn').click();
    await page.getByTestId('pin-identifier-input').fill('rehema@example.com');
    await page.getByTestId('pin-input').fill('1234');
    await page.getByTestId('pin-submit').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('token'))).toBe('vendor-token');
    expect(calls.find(c => c.path === '/auth/pin/login')?.body).toEqual({ email: 'rehema@example.com', pin: '1234' });
    expect(calls.find(c => c.path === '/auth/switch-persona')?.body).toEqual({ personaId: 'usr_vendor' });
    await expect(page).toHaveURL(/\/vendor\/$/, { timeout: 20_000 });
  });

  test('wrong PIN clears the PIN, keeps the number; turned-off staff are told so', async ({ page }) => {
    let tries = 0;
    await mockApi(page, {
      'GET /auth/options': { json: { pinLogin: true } },
      'POST /auth/pin/login': () => (++tries === 1
        ? { status: 401, json: { error: 'invalid_credentials' } }
        : { status: 403, json: { error: 'vendor_staff_inactive' } }),
    });
    await page.goto('/login');
    await page.getByTestId('pin-method-btn').click();
    await page.getByTestId('pin-identifier-input').fill('0712345678');
    await page.getByTestId('pin-input').fill('9999');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByText('That number or PIN is not right. Try again.')).toBeVisible();
    await expect(page.getByTestId('pin-input')).toHaveValue('');
    await expect(page.getByTestId('pin-input')).toBeFocused();
    await expect(page.getByTestId('pin-identifier-input')).toHaveValue('0712345678');
    await page.getByTestId('pin-input').fill('1234');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByText('Your staff access has been turned off. Ask the business owner.')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });
});

test.describe('sign-in messages and companies', () => {
  async function pinSignIn(page: Page) {
    await page.goto('/login');
    await page.getByTestId('pin-method-btn').click();
    await page.getByTestId('pin-identifier-input').fill('0712345678');
    await page.getByTestId('pin-input').fill('1234');
    await page.getByTestId('pin-submit').click();
  }

  test('no profile, and a suspended business, each get a clear message and no session', async ({ page }) => {
    let tries = 0;
    await mockApi(page, {
      'GET /auth/options': { json: { pinLogin: true } },
      'POST /auth/pin/login': () => (++tries === 1
        ? { status: 409, json: { error: 'no_profile' } }
        : { status: 403, json: { error: 'account_suspended' } }),
    });
    await pinSignIn(page);
    await expect(page.getByText('No business or portal access is linked to this number or email.')).toBeVisible();
    await page.getByTestId('pin-input').fill('1234');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByText('This account or business is suspended. Contact FitFlex.')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('a member who looks after a company opens the company area', async ({ page }) => {
    const calls = await mockApi(page, {
      'GET /auth/options': { json: { pinLogin: true } },
      'POST /auth/pin/login': { json: { token: 'member-token', user: { id: 'usr_m', userType: 'member' }, personas: [{ id: 'usr_m', userType: 'member', accountStatus: 'active' }] } },
      'GET /b2b/me/organizations': { json: { organizations: [{ id: 'org_1', role: 'finance' }] } },
    });
    await pinSignIn(page);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('user') || 'null'))).toMatchObject({ organizationUser: true, organizationRoles: ['finance'] });
    expect(calls.find(c => c.path === '/b2b/me/organizations')).toBeTruthy();
    expect(calls.find(c => c.path === '/auth/switch-persona')).toBeFalsy();
  });

  test('a member with no portal role and no company is refused and nothing is stored', async ({ page }) => {
    await mockApi(page, {
      'GET /auth/options': { json: { pinLogin: true } },
      'POST /auth/pin/login': { json: { token: 'member-token', user: { id: 'usr_m', userType: 'member' }, personas: [] } },
      'GET /b2b/me/organizations': { json: { organizations: [] } },
    });
    await pinSignIn(page);
    await expect(page.getByText('No business or portal access is linked to this number or email.')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });
});

test.describe('gating and routing', () => {
  test('portal switched off: only the "not open yet" card, no nav, even on a deep link', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, { 'GET /vendor/me': { status: 404, json: { error: 'feature_disabled' } } });
    await page.goto('/vendor/products/');
    await expect(page.getByTestId('vendor-portal-off')).toBeVisible();
    await expect(page.getByText('The business portal is not open yet')).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('staff turned off by the owner see the staff-disabled card', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, { 'GET /vendor/me': { status: 403, json: { error: 'vendor_staff_inactive' } } });
    await page.goto('/vendor/');
    await expect(page.getByTestId('vendor-staff-disabled')).toBeVisible();
    await expect(page.getByText('Your access has been turned off')).toBeVisible();
  });

  test('staff with only `orders` see Dashboard and Orders; /vendor/products/ sends them back', async ({ page }) => {
    await signedInAs(page, STAFF);
    const calls = await mockApi(page, vendorBase({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'orders_manager', permissions: ['orders'], tools: tools({ canSeeCost: false }) }) } }));
    await page.goto('/vendor/');
    const nav = page.locator('aside').first().getByRole('navigation');
    await expect(nav.getByRole('link')).toHaveText([/Dashboard/, /Orders/]);
    await expect(page.getByTestId('dash-open-orders')).toBeVisible();
    await expect(page.getByTestId('dash-sales')).toHaveCount(0);
    const before = calls.length;
    await page.goto('/vendor/products/');
    await expect(page).toHaveURL(/\/vendor\/$/);
    await expect(page.getByText("You don't have access to that.")).toBeVisible();
    // The products page was held back by the role check: it never asked for products.
    expect(calls.slice(before).filter(c => c.path === '/vendor/products')).toEqual([]);
  });

  test('a vendor on /dashboard goes to /vendor/; a gym owner on /vendor goes home', async ({ page, browser }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, vendorBase());
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/vendor\/$/);

    const owner = await browser.newPage();
    await signedInAs(owner, { id: 'usr_owner', userType: 'gym_operator', gymId: 'gym_1' });
    const ownerCalls = await mockApi(owner, {});
    await owner.goto('/vendor/');
    await expect(owner).toHaveURL(/\/dashboard/);
    // The vendor page never rendered for them, so none of its requests went out.
    expect(ownerCalls.filter(c => c.path.startsWith('/vendor/'))).toEqual([]);
    await owner.close();
  });

  test('pending approval shows the banner on every page; Swahili applies to nav and cards', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    await mockApi(page, vendorBase({ 'GET /vendor/me': { json: me({ approvalStatus: 'pending_approval' }) } }));
    await page.goto('/vendor/');
    await expect(page.getByText('Biashara yako inasubiri idhini ya FitFlex.', { exact: false })).toBeVisible();
    const nav = page.locator('aside').first().getByRole('navigation');
    await expect(nav.getByRole('link')).toHaveText([/Muhtasari/, /Bidhaa/, /Oda/, /Malipo yako/]);
    await expect(page.getByText('Mauzo ya leo')).toBeVisible();
    await expect(page.getByTestId('shell-role').first()).toHaveText('Mmiliki wa biashara');
  });
});

test.describe('products and stock', () => {
  test('low filter, cost column, and Adjust stock updates the row', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, vendorBase({
      'POST /vendor/products/prd_1/stock-adjustments': { status: 201, json: {
        movement: { id: 'mv_1', productId: 'prd_1', variant: null, reason: 'damaged', delta: -2, stockBefore: 10, stockAfter: 8, note: null, actor: null, document: null, createdAt: '2026-10-19T09:00:00Z' },
        product: { id: 'prd_1', stock: 8, variants: [] },
      } },
    }));
    await page.goto('/vendor/products/');
    const table = page.getByTestId('vendor-products-table');
    await expect(table.getByTestId('cost-column')).toBeVisible();
    await expect(page.getByTestId('product-row-prd_2').getByText('Low stock')).toBeVisible();

    await page.getByRole('button', { name: 'Low stock (1)' }).click();
    await expect(page).toHaveURL(/filter=low/);
    await expect(table.getByTestId('product-row-prd_1')).toHaveCount(0);
    await page.getByRole('button', { name: 'All products' }).click();

    await page.getByRole('button', { name: 'Adjust stock for Whey Protein' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('adjust-save')).toBeDisabled();
    // Reasons in the S1 order.
    await expect(dialog.getByRole('radio')).toHaveCount(8);
    const labels = await dialog.locator('fieldset').first().locator('label').allTextContents();
    expect(labels).toEqual(['Counted', 'Restocked', 'Returned', 'Found', 'Damaged', 'Expired', 'Lost', 'Other']);
    await dialog.getByLabel('Damaged').check();
    await dialog.getByTestId('adjust-quantity').fill('20');
    await expect(dialog.getByText("Only 10 in stock. You can't remove more than that.")).toBeVisible();
    await expect(dialog.getByTestId('adjust-save')).toBeDisabled();
    await dialog.getByTestId('adjust-quantity').fill('2');
    await expect(dialog.getByTestId('adjust-preview')).toHaveText('Stock after: 8');
    await dialog.getByTestId('adjust-save').click();
    await expect(page.getByText('Stock updated from 10 to 8')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('product-row-prd_1').getByRole('cell').nth(2)).toContainText('8');
    await expect(page.getByRole('button', { name: 'Adjust stock for Whey Protein' })).toBeFocused();

    const sent = calls.find(c => c.path === '/vendor/products/prd_1/stock-adjustments')?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ reason: 'damaged', quantity: 2 });
    expect(typeof sent.clientRef).toBe('string');
    expect(sent).not.toHaveProperty('expectedStock');
  });

  test('a stale count shows the warning, clears and refocuses the count', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, vendorBase({
      'POST /vendor/products/prd_1/stock-adjustments': { status: 409, json: { error: 'stock_changed', currentStock: 7 } },
    }));
    await page.goto('/vendor/products/');
    await page.getByRole('button', { name: 'Adjust stock for Whey Protein' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Counted').check();
    await dialog.getByTestId('adjust-quantity').fill('9');
    await expect(dialog.getByTestId('adjust-preview')).toHaveText('Difference: −1');
    await dialog.getByTestId('adjust-save').click();
    await expect(dialog.getByText('Stock changed while you were counting. Count again.')).toBeVisible();
    await expect(dialog.getByTestId('adjust-current')).toHaveText('7');
    await expect(dialog.getByTestId('adjust-quantity')).toHaveValue('');
    await expect(dialog.getByTestId('adjust-quantity')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('staff without cost rights: no cost column; ledger off: no stock tools', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, vendorBase({
      'GET /vendor/me': { json: me({ userType: 'vendor_staff', permissions: ['products'], tools: tools({ canSeeCost: false, stockLedger: false }) }) },
      'GET /vendor/products': { json: [{ ...product(), costTzs: undefined, reorderLevel: undefined }] },
    }));
    await page.goto('/vendor/products/');
    await expect(page.getByTestId('product-row-prd_1')).toBeVisible();
    await expect(page.getByTestId('cost-column')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Adjust stock/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Low stock/ })).toHaveCount(0);
  });

  test('stock history shows rows and links an order row to the order', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, vendorBase({
      'GET /vendor/products/prd_1/stock-movements': { json: {
        productId: 'prd_1', variant: null, openingStock: 12, closingStock: 10, nextCursor: null,
        rows: [
          { id: 'mv_2', productId: 'prd_1', variant: null, reason: 'reserve', delta: -2, stockBefore: 12, stockAfter: 10, note: null, actor: null, orderId: 'ord_0000ab12cd', document: { type: 'order', id: 'ord_0000ab12cd', number: null }, createdAt: '2026-10-19T08:30:00Z' },
          { id: 'mv_1', productId: 'prd_1', variant: null, reason: 'count', delta: 2, stockBefore: 10, stockAfter: 12, note: 'product_form', actor: { id: 'usr_vendor', name: 'Rehema' }, document: null, createdAt: '2026-10-18T08:30:00Z' },
        ],
      } },
    }));
    await page.goto('/vendor/products/history/?id=prd_1');
    await expect(page.getByTestId('history-opening')).toHaveText('12');
    await expect(page.getByTestId('history-closing')).toHaveText('10');
    const table = page.getByTestId('history-table');
    await expect(table.getByText('Order placed')).toBeVisible();
    await expect(table.getByText('Changed in the product form')).toBeVisible();
    await expect(table.getByText('By Rehema')).toBeVisible();
    await table.getByRole('link', { name: 'Order AB12CD' }).click();
    await expect(page).toHaveURL(/\/vendor\/orders\/\?id=ord_0000ab12cd/);
  });
});

test.describe('orders', () => {
  test('detail shows only allowlisted fields, pickup gym name, tap-to-call; Accept moves the order', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const accepted = order({ status: 'accepted', orderStatus: 'accepted', nextStatuses: ['processing', 'packed', 'ready_for_pickup'], timeline: [{ status: 'pending', at: '2026-10-19T08:30:00Z' }, { status: 'accepted', at: '2026-10-19T09:00:00Z' }] });
    const calls = await mockApi(page, vendorBase({
      // An older backend could still leak these: the portal must not render them.
      'GET /vendor/orders/ord_0000ab12cd': { json: { ...order(), buyerId: 'usr_buyer_secret', paymentReference: 'MPESA-SECRET' } },
      'POST /vendor/orders/ord_0000ab12cd/status': { json: accepted },
    }));
    await page.goto('/vendor/orders/');
    await expect(page.getByTestId('vendor-orders-table').getByText('Pickup at Mikocheni Fitness')).toBeVisible();
    expect(calls.find(c => c.path === '/vendor/orders')?.search).toContain('limit=50');
    await page.getByRole('link', { name: 'AB12CD' }).first().click();
    await expect(page).toHaveURL(/\?id=ord_0000ab12cd/);
    const detail = page.getByTestId('order-detail');
    await expect(detail.getByRole('heading', { name: 'Order AB12CD' })).toBeFocused();
    await expect(detail.getByText('Pickup at Mikocheni Fitness')).toBeVisible();
    await expect(detail.getByText('Variant: Vanilla')).toBeVisible();
    await expect(detail.getByTestId('order-you-receive')).toContainText('153,000');
    await expect(detail.getByTestId('order-call')).toHaveAttribute('href', 'tel:+255712000111');
    await expect(detail.getByText('Please call first')).toBeVisible();
    await expect(page.getByText('usr_buyer_secret')).toHaveCount(0);
    await expect(page.getByText('MPESA-SECRET')).toHaveCount(0);
    await expect(page.getByText('gym_42')).toHaveCount(0);

    await detail.getByTestId('order-move-accepted').click();
    await page.getByRole('dialog').getByTestId('order-move-confirm').click();
    await expect(page.getByText('Order is now: Accepted')).toBeVisible();
    expect(calls.find(c => c.method === 'POST' && c.path.endsWith('/status'))?.body).toEqual({ status: 'accepted' });
    await expect(detail.getByTestId('order-move-ready_for_pickup')).toBeVisible();
  });

  test('a move made elsewhere shows "changed in the meantime"; cancel needs a reason', async ({ page }) => {
    await signedInAs(page, VENDOR);
    // Someone else accepts the order in the meantime: reads after the refused move see it accepted.
    let movedElsewhere = false;
    await mockApi(page, vendorBase({
      'GET /vendor/orders/ord_0000ab12cd': () => ({ json: movedElsewhere ? order({ status: 'accepted', nextStatuses: ['processing'] }) : order() }),
      'POST /vendor/orders/ord_0000ab12cd/status': () => { movedElsewhere = true; return { status: 409, json: { error: 'invalid_transition', allowed: ['processing'] } }; },
    }));
    await page.goto('/vendor/orders/?id=ord_0000ab12cd');
    const detail = page.getByTestId('order-detail');
    await detail.getByTestId('order-cancel').click();
    await page.getByRole('dialog').getByTestId('order-move-confirm').click();
    await expect(page.getByRole('dialog').getByText('Write a reason.')).toBeVisible();
    await page.keyboard.press('Escape');
    await detail.getByTestId('order-move-accepted').click();
    await page.getByRole('dialog').getByTestId('order-move-confirm').click();
    await expect(detail.getByText('This order changed in the meantime. Here is where it stands now.')).toBeVisible();
    await expect(detail.getByTestId('order-move-processing')).toBeVisible();
  });

  test('another vendor\'s order id shows "not available"; paging loads more', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, vendorBase({
      'GET /vendor/orders': (req) => (new URL(req.url()).searchParams.get('cursor')
        ? { json: { orders: [order({ id: 'ord_00000zz999', shortRef: 'ZZ999' })], nextCursor: null } }
        : { json: { orders: [order()], nextCursor: 'c1' } }),
      'GET /vendor/orders/ord_other': { status: 404, json: { error: 'order_not_found' } },
    }));
    await page.goto('/vendor/orders/?id=ord_other');
    await expect(page.getByText('This order is not available.')).toBeVisible();
    await page.getByTestId('order-back').click();
    await page.getByTestId('orders-load-more').click();
    await expect(page.getByRole('link', { name: 'ZZ999' }).first()).toBeVisible();
    expect(calls.some(c => c.path === '/vendor/orders' && c.search.includes('cursor=c1'))).toBe(true);
  });
});

test.describe('payouts', () => {
  test('partner mode is read-only and explains a blocked payout', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, vendorBase({
      'GET /vendor/statements': { json: { payoutReady: false, payoutBlockedBy: 'payout_account_not_verified', statements: [
        { id: 'vs_1', periodStartDate: '2026-10-06', periodEndDate: '2026-10-12', status: 'paid', orderCount: 3, salesTzs: 300000, commissionTzs: 30000, finalNetTzs: 270000, onHold: false, holdReason: null, paidAt: '2026-10-14T10:00:00Z', paymentReference: 'MP123', paidTo: { method: 'mobile_money', provider: 'M-Pesa', accountLast4: '0111' } },
      ] } },
      'GET /vendor/statements/vs_1': { json: {
        statement: { id: 'vs_1', periodStartDate: '2026-10-06', periodEndDate: '2026-10-12', status: 'paid', orderCount: 3, salesTzs: 300000, commissionTzs: 30000, finalNetTzs: 270000, onHold: false, holdReason: null, paidAt: '2026-10-14T10:00:00Z', paymentReference: 'MP123', paidTo: { method: 'mobile_money', provider: 'M-Pesa', accountLast4: '0111' } },
        lines: [{ id: 'l1', orderId: 'ord_0000ab12cd', deliveredOn: '2026-10-08', itemCount: 2, salesTzs: 170000, commissionTzs: 17000, payoutTzs: 153000, voided: false }],
      } },
    }));
    await page.goto('/vendor/payouts/');
    await expect(page.getByTestId('vendor-payout-blocked')).toHaveText("We can't pay you yet: you have no verified payout account.");
    await expect(page.getByRole('button', { name: /Prepare|Approve|Mark as paid|void/i })).toHaveCount(0);
    await page.getByTestId('vendor-payout-row-vs_1').getByRole('button').click();
    const detail = page.getByTestId('vendor-payout-detail');
    await expect(detail.getByText('MP123')).toBeVisible();
    await expect(detail.getByText('M-Pesa ····0111')).toBeVisible();
    await expect(detail.getByRole('link', { name: 'AB12CD' })).toHaveAttribute('href', /\/vendor\/orders\/\?id=ord_0000ab12cd/);
  });
});

test.describe('admin products', () => {
  const adminUser = { id: 'usr_admin', userType: 'admin' };
  const vendors = [{ id: 'usr_vendor', userType: 'vendor', approvalStatus: 'approved', accountStatus: 'active', productCount: 1, pendingProductCount: 0, vendorProfile: { businessName: 'Dar Fitness Gear' } }];

  test('with the ledger on, cost and reorder level are shown and saved; the vendor shows by name', async ({ page }) => {
    await signedInAs(page, adminUser);
    const calls = await mockApi(page, {
      'GET /admin/products': { json: [product({ variants: [{ name: 'Vanilla', stock: 4, costTzs: null, reorderLevel: 2 }], homepageVisible: true, homepagePriority: 0 })] },
      'GET /admin/vendors': { json: vendors },
      'PUT /admin/products/prd_1/listing': (req) => ({ json: { ...product(), ...req.postDataJSON() } }),
    });
    await page.goto('/admin/products');
    await expect(page.getByText('Vendor: Dar Fitness Gear', { exact: false })).toBeVisible();
    await page.getByLabel('Cost price (TSh): Whey Protein').fill('55000');
    await page.getByLabel('Reorder level: Whey Protein').fill('');
    await page.getByRole('button', { name: 'Variants' }).click();
    await page.getByLabel('Cost price (TSh): Whey Protein · Vanilla').fill('50000');
    await page.getByRole('button', { name: /Save/ }).first().click();
    await expect.poll(() => calls.find(c => c.method === 'PUT')?.body).toBeTruthy();
    const body = calls.find(c => c.method === 'PUT')?.body as Record<string, unknown>;
    // Only what changed: cost set, reorder level cleared, and the variant's cost (its reorder level untouched).
    expect(body).toMatchObject({ costTzs: 55000, reorderLevel: null, variants: [{ name: 'Vanilla', costTzs: 50000 }] });
    expect((body.variants as Array<Record<string, unknown>>)[0]).not.toHaveProperty('reorderLevel');
  });

  test('saving the listing without touching cost or reorder sends no private fields', async ({ page }) => {
    await signedInAs(page, adminUser);
    const calls = await mockApi(page, {
      'GET /admin/products': { json: [product({ variants: [{ name: 'Vanilla', stock: 4, costTzs: null, reorderLevel: 2 }], homepageVisible: true, homepagePriority: 0 })] },
      'GET /admin/vendors': { json: vendors },
      'PUT /admin/products/prd_1/listing': { json: product() },
    });
    await page.goto('/admin/products');
    await expect(page.getByTestId('product-private-prd_1')).toBeVisible();
    await page.getByRole('button', { name: /Save/ }).first().click();
    await expect.poll(() => calls.find(c => c.method === 'PUT')?.body).toBeTruthy();
    const body = calls.find(c => c.method === 'PUT')?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['approvalStatus', 'homepagePriority', 'homepageVisible']);
  });

  test('with the ledger off (no private keys) the page has no cost fields', async ({ page }) => {
    await signedInAs(page, adminUser);
    const calls = await mockApi(page, {
      'GET /admin/products': { json: [{ ...product(), costTzs: undefined, reorderLevel: undefined }] },
      'GET /admin/vendors': { json: vendors },
      'PUT /admin/products/prd_1/listing': { json: product() },
    });
    await page.goto('/admin/products');
    await expect(page.getByText('Whey Protein')).toBeVisible();
    await expect(page.getByTestId('product-private-prd_1')).toHaveCount(0);
    await page.getByRole('button', { name: /Save/ }).first().click();
    await expect.poll(() => calls.find(c => c.method === 'PUT')?.body).toBeTruthy();
    expect(calls.find(c => c.method === 'PUT')?.body).not.toHaveProperty('costTzs');
  });
});
