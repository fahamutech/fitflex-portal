import { expect, test, type Page, type Request } from '@playwright/test';

// Vendor walk-in sales (S3) in the portal against a mocked API: gating (walkInSales + `sales`),
// list + filters in the URL, summary, detail, Copy receipt text, void and its refusals, the
// dashboard card, the stock-history link, Swahili and 44px targets. No POS in the portal.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Reply = { status?: number; json: unknown } | ((req: Request) => { status?: number; json: unknown } | 'abort');
type Routes = Record<string, Reply>;
type Call = { method: string; path: string; search: URLSearchParams; body: unknown };

const ALL_PERMISSIONS = ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff'];
const tools = (extra: Record<string, unknown> = {}) => ({ portal: true, stockLedger: true, buyerContact: true, canSeeCost: true, walkInSales: true, ...extra });
const me = (extra: Record<string, unknown> = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ALL_PERMISSIONS, approvalStatus: 'approved', accountStatus: 'active', tools: tools(), ...extra,
});
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };
const STAFF = { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' };

const eatToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const NOW = new Date(Date.now() - 60_000).toISOString();
const YESTERDAY = new Date(Date.now() - 30 * 3_600_000).toISOString();

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'sale_1', number: 'R-000123', soldAt: NOW, recordedAt: NOW, status: 'completed', totalTzs: 95000, itemCount: 3,
  methods: ['cash', 'mpesa'], createdBy: { id: 'usr_vendor', name: 'Asha' }, ...extra,
});
const summary = (extra: Record<string, unknown> = {}) => ({
  count: 2, totalTzs: 130000, voidedCount: 1, byMethod: [{ method: 'cash', amountTzs: 90000 }, { method: 'mpesa', amountTzs: 40000 }], ...extra,
});
const sale = (extra: Record<string, unknown> = {}) => ({
  id: 'sale_1', number: 'R-000123', status: 'completed', kind: 'cash', soldAt: NOW, recordedAt: NOW,
  subtotalTzs: 100000, lineDiscountTzs: 5000, discountTzs: 0, totalTzs: 95000, paidTzs: 100000, changeTzs: 5000, note: 'Paid at the counter',
  createdBy: { id: 'usr_vendor', name: 'Asha' }, voidedBy: null, voidedAt: null, voidReason: null,
  lines: [
    { nameSnapshot: 'Whey 1kg', variant: 'Chocolate', qty: 2, listPriceTzs: 50000, unitPriceTzs: 45000, priceChanged: true, priceChangedBy: { id: 'usr_vendor', name: 'Asha' }, discountTzs: 5000, lineTotalTzs: 85000 },
    { nameSnapshot: 'Shaker', variant: null, qty: 1, listPriceTzs: 10000, unitPriceTzs: 10000, priceChanged: false, priceChangedBy: null, discountTzs: 0, lineTotalTzs: 10000 },
  ],
  payments: [{ method: 'cash', amountTzs: 60000, reference: null }, { method: 'mpesa', amountTzs: 40000, reference: 'QK12AB34' }],
  ...extra,
});
const voidedSale = () => sale({ status: 'voided', voidedBy: { id: 'usr_vendor', name: 'Rehema' }, voidedAt: NOW, voidReason: 'Customer returned it' });

async function signedInAs(page: Page, user: Record<string, unknown>, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
    // Capture what "Copy receipt text" writes (no real clipboard needed).
    const w = window as unknown as { __copied: string | null };
    w.__copied = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { w.__copied = text; } } });
  }, [user, locale] as const);
}

/** Every API call goes through here; unknown routes are 404. Nothing may reach a real service. */
async function mockApi(page: Page, routes: Routes) {
  const calls: Call[] = [];
  await page.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, search: url.searchParams, body });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req) : hit;
    if (reply === 'abort') return route.abort('internetdisconnected');
    return route.fulfill({ status: reply.status ?? 200, json: reply.json });
  });
  return calls;
}

const base = (extra: Routes = {}): Routes => ({
  'GET /vendor/me': { json: me() },
  'GET /vendor/products': { json: [] },
  'GET /vendor/stock/low': { json: [] },
  'GET /vendor/orders': { json: { orders: [], nextCursor: null } },
  'GET /vendor/payments': { json: { todaySalesTzs: 170000, pendingSettlementTzs: 50000 } },
  'GET /vendor/statements': { json: { statements: [], payoutReady: true, payoutBlockedBy: null } },
  'GET /vendor/sales': { json: { sales: [row(), row({ id: 'sale_2', number: 'R-000122', status: 'voided', totalTzs: 35000, methods: ['cash'] })], nextCursor: null, summary: summary() } },
  'GET /vendor/sales/sale_1': { json: { sale: sale() } },
  ...extra,
});
const salesCalls = (calls: Call[]) => calls.filter(c => c.method === 'GET' && c.path === '/vendor/sales');

test.describe('gating', () => {
  test('walkInSales off: no Sales nav, no dashboard card, and a deep link goes back with "no access"', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: tools({ walkInSales: false }) }) } }));
    await page.goto('/vendor/sales/');
    await expect(page).toHaveURL(/\/vendor\/$/);
    await expect(page.getByText("You don't have access to that.")).toBeVisible();
    await expect(page.getByTestId('dash-sales')).toBeVisible();
    await expect(page.getByTestId('dash-shop-sales')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
    expect(salesCalls(calls)).toHaveLength(0);
  });

  test('walkInSales missing from tools fails closed too', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const t = tools(); delete (t as Record<string, unknown>).walkInSales;
    await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: t }) } }));
    await page.goto('/vendor/');
    await expect(page.getByTestId('dash-sales')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
  });

  test('staff without `sales` see no Sales; staff with only `sales` see Dashboard and Sales', async ({ page, browser }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'orders_manager', permissions: ['orders'] }) } }));
    await page.goto('/vendor/');
    await expect(page.getByRole('link', { name: 'Orders', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await signedInAs(p2, STAFF);
    await mockApi(p2, base({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'sales', permissions: ['sales'] }) } }));
    await p2.goto('/vendor/');
    await expect(p2.getByTestId('dash-shop-sales')).toBeVisible();
    await expect(p2.getByTestId('dash-shop-sales-value')).toHaveText('TSh 130,000');
    await expect(p2.getByRole('link', { name: 'Sales', exact: true }).first()).toBeVisible();
    await expect(p2.getByRole('link', { name: 'Orders', exact: true })).toHaveCount(0);
    await ctx.close();
  });

  test('staff of a suspended business (403 vendor_suspended) get the suspended banner', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({
      'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'sales', permissions: ['sales'] }) },
      'GET /vendor/sales': { status: 403, json: { error: 'vendor_suspended' } },
    }));
    await page.goto('/vendor/sales/');
    await expect(page.getByText('Your business account is suspended. Your products are not on sale. Contact FitFlex.')).toBeVisible();
  });
});

test.describe('list', () => {
  test('defaults to today (EAT), shows notice, summary, rows; filters go in the URL and the query', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/sales/');
    await expect(page.getByRole('heading', { name: 'Sales', level: 1 })).toBeVisible();
    await expect(page.getByTestId('sales-record-in-app')).toHaveText('Record new sales in the FitFlex app (phone or web).');
    await expect(page.getByTestId('sales-money-notice')).toContainText('FitFlex does not handle this money');
    await expect(page.getByTestId('sales-money-notice')).toContainText('No commission is charged and it is not part of your FitFlex payouts.');
    await expect(page.getByTestId('sales-summary-count')).toHaveText('2');
    await expect(page.getByTestId('sales-summary-total')).toHaveText('TSh 130,000');
    await expect(page.getByTestId('sales-by-method')).toContainText('Cash');
    await expect(page.getByTestId('sales-by-method')).toContainText('TSh 40,000');
    // No security follow-up fields from the server yet: those tiles stay hidden.
    await expect(page.getByTestId('sales-summary-overrides')).toHaveCount(0);

    const first = salesCalls(calls)[0];
    expect(first.search.get('from')).toBe(eatToday());
    expect(first.search.get('to')).toBe(eatToday());
    expect(first.search.get('status')).toBeNull();
    expect(first.search.get('createdBy')).toBeNull();

    const table = page.getByTestId('vendor-sales-table');
    await expect(table.getByRole('link', { name: 'R-000123' })).toBeVisible();
    await expect(page.getByTestId('sale-row-sale_1')).toContainText('Cash + M-Pesa');
    await expect(page.getByTestId('sale-row-sale_1')).toContainText('Asha');
    await expect(page.getByTestId('sale-row-sale_1')).toContainText('3 items');
    const voided = page.getByTestId('sale-row-sale_2');
    await expect(voided).toContainText('Voided');
    await expect(voided.locator('.line-through')).toHaveText('TSh 35,000');

    await page.getByTestId('sales-status').selectOption('voided');
    await expect(page).toHaveURL(/status=voided/);
    await page.getByTestId('sales-mine').click();
    await expect(page).toHaveURL(/mine=1/);
    await expect(page.getByTestId('sales-mine')).toBeChecked();
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    await expect(page).toHaveURL(/range=7d/);
    await expect.poll(() => {
      const last = salesCalls(calls).filter(c => !c.search.has('cursor') && c.search.get('limit') === '50').at(-1);
      return last ? `${last.search.get('from')}|${last.search.get('to')}|${last.search.get('status')}|${last.search.get('createdBy')}` : '';
    }).toBe(`${addDays(eatToday(), -6)}|${eatToday()}|voided|me`);

    // The URL keeps the filters on reload.
    await page.reload();
    await expect(page.getByTestId('sales-status')).toHaveValue('voided');
    await expect(page.getByTestId('sales-mine')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('custom dates are sent as EAT days; Load more appends the next page', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'GET /vendor/sales': req => (new URL(req.url()).searchParams.get('cursor') === 'c2'
        ? { json: { sales: [row({ id: 'sale_9', number: 'R-000100' })], nextCursor: null, summary: summary() } }
        : { json: { sales: [row()], nextCursor: 'c2', summary: summary() } }),
    }));
    await page.goto('/vendor/sales/?range=custom&from=2026-10-01&to=2026-10-05');
    await expect(page.getByTestId('sales-from')).toHaveValue('2026-10-01');
    await expect(page.getByTestId('sale-row-sale_1')).toBeVisible();
    expect(salesCalls(calls)[0].search.get('from')).toBe('2026-10-01');
    expect(salesCalls(calls)[0].search.get('to')).toBe('2026-10-05');
    await page.getByTestId('sales-load-more').click();
    await expect(page.getByTestId('sale-row-sale_9')).toBeVisible();
    await expect(page.getByTestId('sale-row-sale_1')).toBeVisible();
    await expect(page.getByTestId('sales-load-more')).toHaveCount(0);
    expect(salesCalls(calls).find(c => c.search.get('cursor') === 'c2')?.search.get('from')).toBe('2026-10-01');
  });

  test('empty: "No shop sales yet" when nothing was ever sold, else "No sales in these dates"', async ({ page, browser }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'GET /vendor/sales': { json: { sales: [], nextCursor: null, summary: summary({ count: 0, totalTzs: 0, voidedCount: 0, byMethod: [] }) } } }));
    await page.goto('/vendor/sales/');
    await expect(page.getByText('No shop sales yet. Record your first sale.')).toBeVisible();

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await signedInAs(p2, VENDOR);
    await mockApi(p2, base({
      'GET /vendor/sales': req => (new URL(req.url()).searchParams.has('from')
        ? { json: { sales: [], nextCursor: null, summary: summary({ count: 0, totalTzs: 0, voidedCount: 0, byMethod: [] }) } }
        : { json: { sales: [row()], nextCursor: null, summary: summary() } }),
    }));
    await p2.goto('/vendor/sales/');
    await expect(p2.getByText('No sales in these dates.')).toBeVisible();
    await ctx.close();
  });

  test('an error shows Try again; the summary hides when the server sends none', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let failing = true;
    await mockApi(page, base({
      'GET /vendor/sales': () => (failing ? { status: 500, json: { error: 'boom' } } : { json: { sales: [row()], nextCursor: null } }),
    }));
    await page.goto('/vendor/sales/');
    await expect(page.getByText('Could not load sales.')).toBeVisible();
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('sale-row-sale_1')).toBeVisible();
    await expect(page.getByTestId('sales-summary')).toHaveCount(0);
  });

  test('security follow-up fields, when sent, show badges and summary tiles', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'GET /vendor/sales': { json: { sales: [row({ hasOverride: true, lateRecorded: true, discountTzs: 5000 })], nextCursor: null, summary: summary({ discountTzs: 5000, overrideCount: 1, lateCount: 1 }) } },
    }));
    await page.goto('/vendor/sales/');
    await expect(page.getByTestId('sale-row-sale_1')).toContainText('Price changed');
    await expect(page.getByTestId('sale-row-sale_1')).toContainText('Recorded offline');
    await expect(page.getByTestId('sales-summary-discounts')).toHaveText('TSh 5,000');
    await expect(page.getByTestId('sales-summary-overrides')).toHaveText('1');
    await expect(page.getByTestId('sales-summary-late')).toHaveText('1');
  });
});

test.describe('detail', () => {
  test('shows the receipt with the price-change audit line; Copy receipt text; Back returns focus to the row', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'GET /vendor/sales/sale_1': { json: { sale: sale({ soldAt: '2026-10-19T11:05:00.000Z', payments: [
      { method: 'cash', amountTzs: 60000, reference: null },
      { method: 'mpesa', amountTzs: 40000, reference: 'QK12AB34' },
      { method: 'airtel_money', amountTzs: 1000, reference: 'AIRTEL-REF-0000123456' },
    ] }) } } }));
    await page.goto('/vendor/sales/');
    await page.getByTestId('vendor-sales-table').getByRole('link', { name: 'R-000123' }).click();
    await expect(page).toHaveURL(/\?id=sale_1/);
    const detail = page.getByTestId('sale-detail');
    await expect(page.getByTestId('sale-heading')).toBeFocused();
    await expect(page.getByTestId('sale-heading')).toHaveText('Receipt R-000123');
    await expect(page.getByTestId('sale-line-0')).toContainText('2 × Whey 1kg (Chocolate)');
    await expect(page.getByTestId('sale-line-0-changed')).toHaveText('Price changed by Asha (shop price TSh 50,000)');
    await expect(page.getByTestId('sale-discounts')).toHaveText('−TSh 5,000');
    await expect(page.getByTestId('sale-payment-1')).toContainText('M-Pesa (QK12AB34)');
    await expect(page.getByTestId('sale-change')).toHaveText('TSh 5,000');
    await expect(page.getByTestId('sale-not-fiscal')).toHaveText('This is not a TRA fiscal receipt.');
    await expect(detail).toContainText('Payment received by Dar Fitness Gear.');
    await expect(detail).toContainText('FitFlex does not handle this money');
    await expect(detail).toContainText('Paid at the counter');
    // Cost and profit are never shown.
    await expect(detail).not.toContainText(/cost|profit/i);

    await page.getByTestId('sale-copy').click();
    await expect(page.getByText('Receipt copied')).toBeVisible();
    const text = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(text.split('\n')[0]).toBe('Dar Fitness Gear');
    expect(text).toContain('Receipt R-000123');
    expect(text).toContain('2 x Whey 1kg (Chocolate)');
    expect(text).toMatch(/ {3}@ 45,000 +90,000/);
    expect(text).toMatch(/ {3}Discount +-5,000/);
    expect(text).toMatch(/1 x Shaker +10,000/);
    expect(text).toMatch(/Total +TSh 95,000/);
    expect(text.split('\n')[2]).toBe('19 Oct 2026, 14:05');
    expect(text).toMatch(/M-Pesa \(QK12AB34\) +40,000/);
    // Every amount row is 32 wide; a method + reference too long for one line wraps, amount still right-aligned.
    expect(text).toContain(`Airtel Money (AIRTEL-REF-0000123456)\n${'1,000'.padStart(32)}`);
    for (const l of text.split('\n').filter(x => /\d$/.test(x) && / {2,}/.test(x))) expect(l.length).toBe(32);
    expect(text).toMatch(/Change +5,000/);
    expect(text).toContain('Served by Asha');
    expect(text).toContain('Payment received by Dar Fitness Gear.');
    expect(text.trim().split('\n').at(-1)).toBe('This is not a TRA fiscal receipt.');
    expect(text).not.toMatch(/FitFlex/);

    await page.getByTestId('sale-back').click();
    await expect(page).not.toHaveURL(/id=/);
    await expect(page.locator('#sale-link-sale_1')).toBeFocused();
  });

  test("another vendor's sale id shows not available", async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'GET /vendor/sales/sale_x': { status: 404, json: { error: 'sale_not_found' } } }));
    await page.goto('/vendor/sales/?id=sale_x');
    await expect(page.getByText('This sale is not available.')).toBeVisible();
  });

  test('a voided sale shows who voided it and why; no Copy, no Void', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'GET /vendor/sales/sale_1': { json: { sale: voidedSale() } } }));
    await page.goto('/vendor/sales/?id=sale_1');
    await expect(page.getByTestId('sale-voided')).toContainText('Voided by Rehema');
    await expect(page.getByTestId('sale-voided')).toContainText('Customer returned it');
    await expect(page.getByTestId('sale-total').locator('.line-through')).toHaveText('TSh 95,000');
    await expect(page.getByTestId('sale-copy')).toHaveCount(0);
    await expect(page.getByTestId('sale-void')).toHaveCount(0);
  });
});

test.describe('void', () => {
  test('needs a reason; success updates panel and row; Escape closes and returns focus', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'POST /vendor/sales/sale_1/void': { json: { sale: voidedSale() } } }));
    await page.goto('/vendor/sales/');
    await page.getByTestId('vendor-sales-table').getByRole('link', { name: 'R-000123' }).click();
    await page.getByTestId('sale-void').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Void sale R-000123?' })).toBeVisible();
    await expect(dialog).toContainText('FitFlex does not refund the customer');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('sale-void')).toBeFocused();

    await page.getByTestId('sale-void').click();
    await expect(page.getByTestId('sale-void-confirm')).toBeDisabled();
    await page.getByTestId('sale-void-reason').fill('no');
    await page.getByTestId('sale-void-confirm').click();
    await expect(dialog.getByText('Say why you are voiding this sale.')).toBeVisible();
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    await page.getByTestId('sale-void-reason').fill('  Customer returned it  ');
    await page.getByTestId('sale-void-confirm').click();
    await expect(page.getByText('Sale R-000123 voided. Items are back in stock.')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(calls.find(c => c.method === 'POST')?.body).toEqual({ reason: 'Customer returned it' });
    await expect(page.getByTestId('sale-voided')).toContainText('Voided by Rehema');
    await expect(page.getByTestId('sale-copy')).toHaveCount(0);
    await expect(page.getByTestId('sale-row-sale_1')).toContainText('Voided');
  });

  test('already voided reloads; no connection keeps the dialog; 403 void_not_allowed says why', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let tries = 0;
    let loads = 0;
    await mockApi(page, base({
      'GET /vendor/sales/sale_1': () => ({ json: { sale: ++loads > 1 && tries >= 1 ? voidedSale() : sale() } }),
      'POST /vendor/sales/sale_1/void': () => {
        tries += 1;
        if (tries === 1) return 'abort';
        if (tries === 2) return { status: 403, json: { error: 'void_not_allowed', reason: 'too_old' } };
        return { status: 409, json: { error: 'already_voided', voidedAt: NOW } };
      },
    }));
    await page.goto('/vendor/sales/?id=sale_1');
    await page.getByTestId('sale-void').click();
    await page.getByTestId('sale-void-reason').fill('Wrong item');
    await page.getByTestId('sale-void-confirm').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Voiding needs a connection. Nothing was changed.')).toBeVisible();
    await expect(page.getByTestId('sale-void-confirm')).toHaveText('Try again');

    await page.getByTestId('sale-void-confirm').click();
    await expect(page.getByText('You can only void a sale on the day it was made. Ask the business owner.')).toBeVisible();
    await expect(dialog).toHaveCount(0);

    await page.getByTestId('sale-void').click();
    await page.getByTestId('sale-void-reason').fill('Wrong item');
    await page.getByTestId('sale-void-confirm').click();
    await expect(page.getByText('This sale was already voided.')).toBeVisible();
    await expect(page.getByTestId('sale-voided')).toBeVisible();
  });

  test('403 vendor_permission_forbidden on void says so', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'POST /vendor/sales/sale_1/void': { status: 403, json: { error: 'vendor_permission_forbidden', requiredPermission: 'sales' } } }));
    await page.goto('/vendor/sales/?id=sale_1');
    await page.getByTestId('sale-void').click();
    await page.getByTestId('sale-void-reason').fill('Wrong item');
    await page.getByTestId('sale-void-confirm').click();
    await expect(page.getByText("You don't have permission to void sales.")).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test("non-admin staff: Void only on their own sale of today; admin-role staff on any", async ({ page, browser }) => {
    const staffMe = (vendorRole: string) => me({ userType: 'vendor_staff', vendorRole, permissions: ['sales'] });
    await signedInAs(page, STAFF);
    await mockApi(page, base({
      'GET /vendor/me': { json: staffMe('sales') },
      'GET /vendor/sales/sale_1': { json: { sale: sale() } },
      'GET /vendor/sales/sale_own': { json: { sale: sale({ id: 'sale_own', createdBy: { id: 'usr_staff', name: 'Juma' } }) } },
      'GET /vendor/sales/sale_old': { json: { sale: sale({ id: 'sale_old', soldAt: YESTERDAY, createdBy: { id: 'usr_staff', name: 'Juma' } }) } },
    }));
    await page.goto('/vendor/sales/?id=sale_1');
    await expect(page.getByTestId('sale-copy')).toBeVisible();
    await expect(page.getByTestId('sale-void')).toHaveCount(0);
    await page.goto('/vendor/sales/?id=sale_own');
    await expect(page.getByTestId('sale-void')).toBeVisible();
    await page.goto('/vendor/sales/?id=sale_old');
    await expect(page.getByTestId('sale-copy')).toBeVisible();
    await expect(page.getByTestId('sale-void')).toHaveCount(0);

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await signedInAs(p2, STAFF);
    await mockApi(p2, base({ 'GET /vendor/me': { json: staffMe('admin') } }));
    await p2.goto('/vendor/sales/?id=sale_1');
    await expect(p2.getByTestId('sale-void')).toBeVisible();
    await ctx.close();
  });
});

test.describe('dashboard and stock history', () => {
  test('"Shop sales today" is its own card next to app-order sales and links to Sales', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/');
    await expect(page.getByTestId('dash-sales-value')).toHaveText('TSh 170,000');
    await expect(page.getByTestId('dash-shop-sales')).toContainText('Shop sales today');
    await expect(page.getByTestId('dash-shop-sales')).toContainText('Counter sales; not in FitFlex payouts');
    await expect(page.getByTestId('dash-shop-sales-value')).toHaveText('TSh 130,000');
    const call = salesCalls(calls)[0];
    expect(call.search.get('from')).toBe(eatToday());
    expect(call.search.get('to')).toBe(eatToday());
    await page.getByTestId('dash-shop-sales').getByRole('link').click();
    await expect(page).toHaveURL(/\/vendor\/sales\/?$/);
  });

  test('a stock-history sale row links to the sale (plain text without `sales`)', async ({ page, browser }) => {
    const history = {
      productId: 'prd_1', variant: null, openingStock: 12, closingStock: 10, nextCursor: null,
      rows: [{ id: 'mv_1', productId: 'prd_1', variant: null, reason: 'sale', kind: 'sale', delta: -2, stockBefore: 12, stockAfter: 10, note: null,
        actor: { id: 'usr_vendor', name: 'Asha' }, orderId: null, document: { type: 'sale', id: 'sale_1', number: 'R-000123' }, createdAt: NOW }],
    };
    const routes = (extra: Routes = {}) => base({
      'GET /vendor/products': { json: [{ id: 'prd_1', vendorId: 'usr_vendor', name: 'Whey 1kg', priceTzs: 50000, stock: 10, status: 'active', images: [], variants: [] }] },
      'GET /vendor/products/prd_1/stock-movements': { json: history },
      ...extra,
    });
    await signedInAs(page, VENDOR);
    await mockApi(page, routes());
    await page.goto('/vendor/products/history/?id=prd_1');
    const table = page.getByTestId('history-table');
    await expect(table).toContainText('Shop sale');
    await table.getByRole('link', { name: 'Receipt R-000123' }).click();
    await expect(page).toHaveURL(/\/vendor\/sales\/\?id=sale_1/);
    await expect(page.getByTestId('sale-heading')).toHaveText('Receipt R-000123');

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await signedInAs(p2, STAFF);
    await mockApi(p2, routes({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'inventory_manager', permissions: ['products'] }) } }));
    await p2.goto('/vendor/products/history/?id=prd_1');
    await expect(p2.getByTestId('history-table')).toContainText('Receipt R-000123');
    await expect(p2.getByTestId('history-table').getByRole('link', { name: 'Receipt R-000123' })).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('Swahili and targets', () => {
  test('Swahili nav, notice, detail and copied receipt text', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    await mockApi(page, base({ 'GET /vendor/sales/sale_1': { json: { sale: sale({ soldAt: '2026-10-19T11:05:00.000Z' }) } } }));
    await page.goto('/vendor/sales/?id=sale_1');
    await expect(page.getByRole('link', { name: 'Mauzo', exact: true }).first()).toBeVisible();
    await expect(page.getByText('Rekodi mauzo mapya kwenye app ya FitFlex (simu au kivinjari).')).toBeVisible();
    await expect(page.getByTestId('sale-heading')).toHaveText('Risiti R-000123');
    await expect(page.getByTestId('sale-not-fiscal')).toHaveText('Hii si risiti ya kodi ya TRA.');
    await expect(page.getByTestId('sale-detail')).toContainText('FitFlex haishughulikii pesa hii');
    await page.getByTestId('sale-copy').click();
    await expect(page.getByText('Risiti imenakiliwa')).toBeVisible();
    const text = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(text).toContain('Risiti R-000123');
    expect(text).toMatch(/Jumla +TSh 95,000/);
    expect(text).toMatch(/Taslimu +60,000/);
    expect(text).toMatch(/Chenji +5,000/);
    expect(text).toContain('Mhudumu: Asha');
    // The app's Swahili clock: 12-hour with the part of the day (14:05 EAT → "2:05 mchana").
    expect(text.split('\n')[2]).toBe('19 Okt 2026, 2:05 mchana');
    expect(text.trim().split('\n').at(-1)).toBe('Hii si risiti ya kodi ya TRA.');
  });

  test('nav item, range buttons, row links, Copy and Void are at least 44px tall; phones get cards', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'GET /vendor/sales': { json: { sales: [row()], nextCursor: 'c2', summary: summary() } } }));
    await page.goto('/vendor/sales/');
    const tall = async (loc: ReturnType<Page['locator']>) => expect((await loc.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await tall(page.getByRole('link', { name: 'Sales', exact: true }).first());
    await tall(page.getByRole('button', { name: 'Today' }));
    await tall(page.getByTestId('sales-load-more'));
    await tall(page.locator('#sale-link-sale_1'));
    await page.locator('#sale-link-sale_1').click();
    await tall(page.getByTestId('sale-copy'));
    await tall(page.getByTestId('sale-void'));
    await tall(page.getByTestId('sale-back'));

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/vendor/sales/');
    await expect(page.getByTestId('sale-card-sale_1')).toBeVisible();
    await tall(page.getByTestId('sale-card-sale_1'));
  });
});
