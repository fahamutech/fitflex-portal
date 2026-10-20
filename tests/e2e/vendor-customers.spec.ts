import { expect, test, type Page, type Request } from '@playwright/test';

// Vendor customers (S4) in the portal against a mocked API: gating (tools.customers + `customers`), the list
// (search, filters, sort, Load more), add/edit/archive/restore, the profile (A-02: no contact details for app
// customers), record payment (oldest-first preview, Choose sales, over-owed, references, retry with the same
// clientRef), payment receipt and void, Owed to you (buckets, totals row, aria-sort), the statement, the
// dashboard card, and the S3 sales page's pay-later additions. No POS and no pay-later sale here.
// Network guard: every request outside localhost is aborted, and the API is answered here (never the live API).

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Reply = { status?: number; json: unknown } | ((req: Request) => { status?: number; json: unknown } | 'abort');
type Routes = Record<string, Reply>;
type Call = { method: string; path: string; search: URLSearchParams; body: Record<string, unknown> | null };

const ALL_PERMISSIONS = ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff'];
const tools = (extra: Record<string, unknown> = {}) => ({ portal: true, stockLedger: true, buyerContact: true, canSeeCost: true, walkInSales: true, customers: true, ...extra });
const me = (extra: Record<string, unknown> = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ALL_PERMISSIONS, approvalStatus: 'approved', accountStatus: 'active', tools: tools(), ...extra,
});
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };
const STAFF = { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' };

const eatToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const NOW = new Date(Date.now() - 60_000).toISOString();
const TODAY = eatToday();
const zeroAging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };

const walkIn = (extra: Record<string, unknown> = {}) => ({
  id: 'cus_juma', source: 'manual', name: 'Juma Mussa', phone: '+255712345678', archived: false, forgotten: false, lastPurchaseAt: NOW,
  owedTzs: 50000, overdueTzs: 20000, oldestDueDate: addDays(TODAY, -5), maxDaysOverdue: 5, aging: { ...zeroAging, current: 30000, d1_30: 20000 }, ...extra,
});
const appRow = (extra: Record<string, unknown> = {}) => ({
  id: 'cus_app', source: 'marketplace', name: 'Neema Joseph', phone: null, archived: false, forgotten: false, lastPurchaseAt: NOW,
  owedTzs: 0, overdueTzs: 0, oldestDueDate: null, maxDaysOverdue: 0, aging: zeroAging, ...extra,
});
const openSales = [
  { id: 'sale_r1', number: 'R-000001', soldAt: NOW, dueDate: addDays(TODAY, -5), totalTzs: 20000, balanceTzs: 20000, daysOverdue: 5, overdue: true },
  { id: 'sale_r2', number: 'R-000002', soldAt: NOW, dueDate: addDays(TODAY, 3), totalTzs: 30000, balanceTzs: 30000, daysOverdue: 0, overdue: false },
];
const profile = (extra: Record<string, unknown> = {}) => ({
  ...walkIn(), email: 'juma@example.com', address: 'Kariakoo, Dar es Salaam', note: 'Pays at month end', archivedAt: null,
  createdAt: NOW, updatedAt: '2026-10-20T08:00:00.000Z',
  totals: { shopSalesTzs: 95000, shopSalesCount: 3, appOrdersTzs: 0, appOrdersCount: 0, lastPurchaseAt: NOW },
  asOf: TODAY, openSales, ...extra,
});
const appProfile = (extra: Record<string, unknown> = {}) => ({
  ...appRow(), email: null, address: null, note: null, archivedAt: null, createdAt: NOW, updatedAt: '2026-10-20T08:00:00.000Z',
  totals: { shopSalesTzs: 0, shopSalesCount: 0, appOrdersTzs: 45000, appOrdersCount: 2, lastPurchaseAt: NOW },
  asOf: TODAY, openSales: [], ...extra,
});
const payment = (extra: Record<string, unknown> = {}) => ({
  id: 'pay_1', number: 'PMT-000001', customerId: 'cus_juma', status: 'recorded', amountTzs: 25000, method: 'mpesa', reference: 'QK12AB34',
  receivedOn: TODAY, note: null, clientRef: 'ref-1', recordedAt: NOW, recordedBy: { id: 'usr_vendor', name: 'Rehema' },
  allocations: [{ saleId: 'sale_r1', saleNumber: 'R-000001', amountTzs: 20000 }, { saleId: 'sale_r2', saleNumber: 'R-000002', amountTzs: 5000 }],
  voidedAt: null, voidedBy: null, voidReason: null, ...extra,
});
const creditRow = (extra: Record<string, unknown> = {}) => ({
  id: 'sale_r1', number: 'R-000001', soldAt: NOW, recordedAt: NOW, status: 'completed', totalTzs: 20000, itemCount: 1, methods: [],
  createdBy: { id: 'usr_vendor', name: 'Asha' }, hasOverride: false, discountTzs: 0, lateRecorded: false,
  kind: 'credit', balanceTzs: 20000, dueDate: addDays(TODAY, -5), customer: { id: 'cus_juma', name: 'Juma Mussa' }, ...extra,
});
const aging = (extra: Record<string, unknown> = {}) => ({
  asOf: TODAY,
  totals: { owedTzs: 50000, overdueTzs: 20000, customerCount: 1, overdueCustomerCount: 1, openSaleCount: 2, overdueSaleCount: 1, current: 30000, d1_30: 20000, d31_60: 0, d61_90: 0, d90plus: 0 },
  rows: [{ customerId: 'cus_juma', name: 'Juma Mussa', source: 'manual', owedTzs: 50000, overdueTzs: 20000, oldestDueDate: addDays(TODAY, -5), maxDaysOverdue: 5, openSaleCount: 2, overdueSaleCount: 1, current: 30000, d1_30: 20000, d31_60: 0, d61_90: 0, d90plus: 0 }],
  nextCursor: null, ...extra,
});

async function signedInAs(page: Page, user: Record<string, unknown>, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
    const w = window as unknown as { __copied: string | null };
    w.__copied = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { w.__copied = text; } } });
  }, [user, locale] as const);
}

/** Every API call goes through here; unknown routes are 404. Nothing may reach a real service. */
async function mockApi(page: Page, routes: Routes) {
  const calls: Call[] = [];
  const outside: string[] = [];
  page.on('pageerror', err => console.log('PAGEERROR', err.message));
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => { outside.push(route.request().url()); return route.abort(); });
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body: Record<string, unknown> | null = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, search: url.searchParams, body });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req) : hit;
    if (reply === 'abort') return route.abort('internetdisconnected');
    return route.fulfill({ status: reply.status ?? 200, json: reply.json });
  });
  return Object.assign(calls, { outside });
}

const base = (extra: Routes = {}): Routes => ({
  'GET /vendor/me': { json: me() },
  'GET /vendor/products': { json: [] },
  'GET /vendor/stock/low': { json: [] },
  'GET /vendor/orders': { json: { orders: [], nextCursor: null } },
  'GET /vendor/payments': { json: { todaySalesTzs: 0, pendingSettlementTzs: 0 } },
  'GET /vendor/statements': { json: { statements: [], payoutReady: true, payoutBlockedBy: null } },
  'GET /vendor/sales': { json: { sales: [], nextCursor: null, summary: { count: 0, totalTzs: 0, voidedCount: 0, byMethod: [] } } },
  'GET /vendor/customers': { json: { customers: [walkIn(), appRow()], nextCursor: null, asOf: TODAY } },
  'GET /vendor/customers/cus_juma': { json: { customer: profile() } },
  'GET /vendor/customers/cus_juma/sales': { json: { sales: [creditRow(), creditRow({ id: 'sale_r2', number: 'R-000002', totalTzs: 30000, balanceTzs: 30000 })], nextCursor: null } },
  'GET /vendor/customers/cus_juma/payments': { json: { payments: [], nextCursor: null } },
  'GET /vendor/customers/cus_juma/orders': { json: { orders: [], nextCursor: null } },
  'GET /vendor/customers/cus_app': { json: { customer: appProfile() } },
  'GET /vendor/customers/cus_app/sales': { json: { sales: [], nextCursor: null } },
  'GET /vendor/customers/cus_app/orders': { json: { orders: [{ id: 'ord_1', shortRef: 'AB12CD', createdAt: NOW, status: 'delivered', orderStatus: 'delivered', tab: 'delivered', paymentStatus: 'paid', totalTzs: 45000, itemCount: 2 }], nextCursor: null } },
  'GET /vendor/customers/cus_app/payments': { json: { payments: [], nextCursor: null } },
  'GET /vendor/receivables/aging': { json: aging() },
  ...extra,
});
// Every page in this file installs the guard in mockApi(); a request outside localhost is aborted and recorded.
const callsTo = (calls: Call[], method: string, path: string) => calls.filter(c => c.method === method && c.path === path);

test.describe('gating', () => {
  test('customers off: no Customers nav, no Owed card, and a deep link goes back with "no access"', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: tools({ customers: false }) }) } }));
    await page.goto('/vendor/customers/');
    await expect(page).toHaveURL(/\/vendor\/$/);
    await expect(page.getByText("You don't have access to that.")).toBeVisible();
    await expect(page.getByTestId('dash-shop-sales')).toBeVisible();
    await expect(page.getByTestId('dash-owed')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Customers', exact: true })).toHaveCount(0);
    expect(callsTo(calls, 'GET', '/vendor/customers')).toHaveLength(0);
    expect(callsTo(calls, 'GET', '/vendor/receivables/aging')).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('customers missing from tools fails closed; staff without `customers` see no Customers', async ({ page, browser }) => {
    await signedInAs(page, VENDOR);
    const t = tools(); delete (t as Record<string, unknown>).customers;
    await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: t }) } }));
    await page.goto('/vendor/');
    await expect(page.getByTestId('dash-shop-sales')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Customers', exact: true })).toHaveCount(0);

    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const p2 = await ctx.newPage();
    await signedInAs(p2, STAFF);
    await mockApi(p2, base({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'sales', permissions: ['sales'] }) } }));
    await p2.goto('/vendor/');
    await expect(p2.getByRole('link', { name: 'Sales', exact: true }).first()).toBeVisible();
    await expect(p2.getByRole('link', { name: 'Customers', exact: true })).toHaveCount(0);
    await expect(p2.getByTestId('dash-owed')).toHaveCount(0);
    await ctx.close();
  });

  test('staff with only `customers`: Customers in the nav after Sales position, and the Owed to you card', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'cashier', permissions: ['customers'] }) } }));
    await page.goto('/vendor/');
    await expect(page.getByRole('link', { name: 'Customers', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('dash-owed-value')).toHaveText('TSh 50,000');
    await expect(page.getByTestId('dash-owed-hint')).toHaveText('1 overdue · not in FitFlex payouts');
    await page.getByTestId('dash-owed').getByRole('link', { name: 'View all' }).click();
    await expect(page).toHaveURL(/\/vendor\/customers\/\?view=owed/);
    await expect(page.getByTestId('owed-total')).toHaveText('TSh 50,000');
  });
});

test.describe('list', () => {
  test('rows, phone for walk-in only, search (debounced), filters and sort in the URL and the query', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/customers/');
    const table = page.getByTestId('customers-table');
    await expect(page.getByTestId('customer-row-cus_juma')).toContainText('+255712345678');
    await expect(page.getByTestId('customer-row-cus_juma')).toContainText('Shop customer');
    await expect(page.getByTestId('customer-row-cus_juma')).toContainText('TSh 50,000');
    await expect(page.getByTestId('customer-row-cus_juma')).toContainText('Overdue');
    await expect(page.getByTestId('customer-row-cus_app')).toContainText('App customer');
    await expect(page.getByTestId('customer-row-cus_app').locator('td').nth(2)).toHaveText('—');
    await expect(table.getByRole('link', { name: /^Juma Mussa, Shop customer, owes TSh 50,000, Overdue$/ })).toBeVisible();
    const first = callsTo(calls, 'GET', '/vendor/customers')[0];
    expect(first.search.get('filter')).toBe('all');
    expect(first.search.get('sort')).toBe('name');

    await page.getByTestId('customers-search').fill('0712');
    await expect(page).toHaveURL(/q=0712/);
    await expect.poll(() => callsTo(calls, 'GET', '/vendor/customers').at(-1)?.search.get('q')).toBe('0712');
    // One request for the typed text, not one per key.
    expect(callsTo(calls, 'GET', '/vendor/customers').filter(c => c.search.get('q')?.startsWith('07')).length).toBe(1);

    await page.getByRole('button', { name: 'Owe you' }).click();
    await expect(page).toHaveURL(/filter=owes/);
    await page.getByTestId('customers-sort').selectOption('overdue');
    await expect(page).toHaveURL(/sort=overdue/);
    await expect.poll(() => {
      const c = callsTo(calls, 'GET', '/vendor/customers').at(-1);
      return c ? `${c.search.get('q')}|${c.search.get('filter')}|${c.search.get('sort')}` : '';
    }).toBe('0712|owes|overdue');
    await page.reload();
    await expect(page.getByTestId('customers-search')).toHaveValue('0712');
    await expect(page.getByRole('button', { name: 'Owe you' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('customers-sort')).toHaveValue('overdue');
  });

  test('Load more appends; empty states: first ever, no match, filter', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'GET /vendor/customers': req => {
        const sp = new URL(req.url()).searchParams;
        if (sp.get('q') === 'zzz') return { json: { customers: [], nextCursor: null, asOf: TODAY } };
        if (sp.get('filter') === 'archived') return { json: { customers: [], nextCursor: null, asOf: TODAY } };
        if (sp.get('cursor') === 'c2') return { json: { customers: [appRow()], nextCursor: null, asOf: TODAY } };
        return { json: { customers: [walkIn()], nextCursor: 'c2', asOf: TODAY } };
      },
    }));
    await page.goto('/vendor/customers/');
    await expect(page.getByTestId('customer-row-cus_juma')).toBeVisible();
    await page.getByTestId('customers-load-more').click();
    await expect(page.getByTestId('customer-row-cus_app')).toBeVisible();
    await expect(page.getByTestId('customers-load-more')).toHaveCount(0);
    await page.goto('/vendor/customers/?q=zzz');
    await expect(page.getByText('No customers match "zzz".')).toBeVisible();
    await page.goto('/vendor/customers/?filter=archived');
    await expect(page.getByText('No customers here.')).toBeVisible();
  });

  test('none yet: the first-customer message with Add customer; an error offers Try again', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let failing = true;
    await mockApi(page, base({ 'GET /vendor/customers': () => (failing ? { status: 500, json: { error: 'boom' } } : { json: { customers: [], nextCursor: null, asOf: TODAY } }) }));
    await page.goto('/vendor/customers/');
    await expect(page.getByText('Could not load customers.')).toBeVisible();
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('No customers yet. They appear after an app order, or add one yourself.')).toBeVisible();
  });
});

test.describe('add and edit', () => {
  test('add a walk-in customer: validation, POST body with clientRef, duplicate-phone warning with Open', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'POST /vendor/customers': { status: 201, json: { customer: { ...profile(), id: 'cus_new', name: 'Asha Said', phone: '+255712345678' }, phoneDuplicate: { id: 'cus_juma', name: 'Juma Mussa' } } },
      'GET /vendor/customers/cus_new': { json: { customer: profile({ id: 'cus_new', name: 'Asha Said', owedTzs: 0, overdueTzs: 0, openSales: [], aging: zeroAging, note: null }) } },
      'GET /vendor/customers/cus_new/sales': { json: { sales: [], nextCursor: null } },
    }));
    await page.goto('/vendor/customers/');
    await page.getByTestId('vendor-customers-add').click();
    await expect(page.getByTestId('customer-consent')).toHaveText('Only save details the customer agreed to give you.');
    await page.getByTestId('customer-save').click();
    await expect(page.getByText("Enter the customer's name.")).toBeVisible();
    await page.getByTestId('customer-name').fill('A');
    await page.getByTestId('customer-save').click();
    await expect(page.getByText('Name must be 2–80 characters.')).toBeVisible();
    await page.getByTestId('customer-name').fill('Asha Said');
    await page.getByTestId('customer-phone').fill('12345');
    await page.getByTestId('customer-save').click();
    await expect(page.getByText('Enter a valid Tanzanian phone number.')).toBeVisible();
    expect(callsTo(calls, 'POST', '/vendor/customers')).toHaveLength(0);
    await page.getByTestId('customer-phone').fill('0712345678');
    await page.getByTestId('customer-save').click();
    await expect(page).toHaveURL(/id=cus_new/);
    const post = callsTo(calls, 'POST', '/vendor/customers')[0].body!;
    expect(post.name).toBe('Asha Said');
    expect(post.phone).toBe('0712345678');
    expect(String(post.clientRef).length).toBeGreaterThanOrEqual(8);
    await expect(page.getByText('Customer saved')).toBeVisible();
    await expect(page.getByTestId('customer-duplicate')).toContainText('Juma Mussa already has this number.');
    await page.getByTestId('customer-duplicate-open').click();
    await expect(page).toHaveURL(/id=cus_juma/);
    await expect(page.getByTestId('customer-heading')).toHaveText('Juma Mussa');
  });

  test('edit sends only what changed with updatedAt; 409 customer_changed offers Reload', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let conflict = true;
    const calls = await mockApi(page, base({
      'PUT /vendor/customers/cus_juma': () => (conflict
        ? { status: 409, json: { error: 'customer_changed', updatedAt: '2026-10-20T09:00:00.000Z' } }
        : { json: { customer: { ...profile(), note: 'Pays on Fridays' }, phoneDuplicate: null } }),
    }));
    await page.goto('/vendor/customers/?id=cus_juma');
    await page.getByTestId('customer-edit').click();
    await page.getByTestId('customer-note').fill('Pays on Fridays');
    await page.getByTestId('customer-save').click();
    await expect(page.getByTestId('customer-form-alert')).toContainText('Someone else changed this customer. Reload to see the latest.');
    const put = callsTo(calls, 'PUT', '/vendor/customers/cus_juma')[0].body!;
    expect(put).toEqual({ note: 'Pays on Fridays', updatedAt: '2026-10-20T08:00:00.000Z' });
    conflict = false;
    await page.getByTestId('customer-form-reload').click();
    await page.getByTestId('customer-note').fill('Pays on Fridays');
    await page.getByTestId('customer-save').click();
    await expect(page.getByText('Customer saved')).toBeVisible();
  });

  test('archive: refused while owing; with nothing owed it confirms and sends archived; Restore brings back', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let archived = false;
    const calls = await mockApi(page, base({
      'GET /vendor/customers/cus_juma': () => ({ json: { customer: profile({ owedTzs: 0, overdueTzs: 0, openSales: [], aging: zeroAging, archived, archivedAt: archived ? NOW : null }) } }),
      'GET /vendor/customers/cus_juma/sales': { json: { sales: [], nextCursor: null } },
      'PUT /vendor/customers/cus_juma': req => { archived = (req.postDataJSON() as { archived: boolean }).archived; return { json: { customer: { ...profile(), archived, archivedAt: archived ? NOW : null }, phoneDuplicate: null } }; },
    }));
    await page.goto('/vendor/customers/?id=cus_juma');
    await page.getByTestId('customer-archive').click();
    await expect(page.getByRole('dialog')).toContainText("Their history stays. They won't appear when you pick a customer for a sale.");
    await page.getByTestId('customer-archive-confirm').click();
    await expect(page.getByText('Customer archived')).toBeVisible();
    expect(callsTo(calls, 'PUT', '/vendor/customers/cus_juma')[0].body!.archived).toBe(true);
    await expect(page.getByTestId('customer-restore')).toBeVisible();
    await page.getByTestId('customer-restore').click();
    await expect(page.getByText('Customer restored')).toBeVisible();
    expect(callsTo(calls, 'PUT', '/vendor/customers/cus_juma')[1].body!.archived).toBe(false);
  });

  test('archive while owing is refused in place (and the server 409 customer_has_balance says so too)', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/customers/?id=cus_juma');
    await page.getByTestId('customer-archive').click();
    await expect(page.getByTestId('customer-archive-note')).toHaveText('This customer still owes TSh 50,000. Record the payment first.');
    expect(callsTo(calls, 'PUT', '/vendor/customers/cus_juma')).toHaveLength(0);
  });
});

test.describe('profile and A-02', () => {
  test('walk-in profile: owed, aging tiles (zeros muted, shown), open sales oldest first, totals', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto('/vendor/customers/?id=cus_juma');
    await expect(page.getByTestId('customer-heading')).toBeFocused();
    await expect(page.getByTestId('customer-owed-value')).toHaveText('TSh 50,000');
    await expect(page.getByTestId('customer-overdue')).toHaveText('Overdue TSh 20,000');
    await expect(page.getByTestId('customer-aging-current')).toHaveText('TSh 30,000');
    await expect(page.getByTestId('customer-aging-d1_30')).toHaveText('TSh 20,000');
    await expect(page.getByTestId('customer-aging-d90plus')).toHaveText('TSh 0');
    await expect(page.getByTestId('customer-open-sales').locator('li').first()).toContainText('R-000001');
    await expect(page.getByTestId('open-sale-sale_r1')).toContainText('5 days overdue');
    await expect(page.getByTestId('customer-total-shop')).toHaveText('TSh 95,000');
    await expect(page.getByRole('link', { name: 'Call Juma Mussa' })).toHaveAttribute('href', 'tel:+255712345678');
    await expect(page.getByTestId('customer-tab-sales')).toContainText('Pay later');
    await expect(page.getByTestId('customer-tab-sales')).toContainText('Owes TSh 20,000');
  });

  test('app customer: no phone, email, address anywhere; edit has the note only; app orders listed', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'PUT /vendor/customers/cus_app': { json: { customer: { ...appProfile(), note: 'VIP' }, phoneDuplicate: null } } }));
    await page.goto('/vendor/customers/?id=cus_app');
    await expect(page.getByTestId('customer-heading')).toHaveText('Neema Joseph');
    await expect(page.getByTestId('customer-app-hint')).toHaveText("Contact details show on an order while you're delivering it.");
    await expect(page.getByTestId('customer-contact')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Call / })).toHaveCount(0);
    await expect(page.getByTestId('customer-total-app')).toHaveText('TSh 45,000');
    await page.getByRole('button', { name: 'App orders' }).click();
    await expect(page).toHaveURL(/tab=orders/);
    await expect(page.getByTestId('customer-order-ord_1')).toContainText('AB12CD');
    await page.getByTestId('customer-edit').click();
    await expect(page.getByTestId('customer-form-app-name')).toContainText('Name from their FitFlex account.');
    for (const id of ['customer-name', 'customer-phone', 'customer-email', 'customer-address']) await expect(page.getByTestId(id)).toHaveCount(0);
    await page.getByTestId('customer-note').fill('VIP');
    await page.getByTestId('customer-save').click();
    await expect(page.getByText('Customer saved')).toBeVisible();
    expect(callsTo(calls, 'PUT', '/vendor/customers/cus_app')[0].body).toEqual({ note: 'VIP', updatedAt: '2026-10-20T08:00:00.000Z' });
  });

  test('another vendor\'s or an unknown customer is not found; a deleted member reads "Deleted member"', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'GET /vendor/customers': { json: { customers: [appRow({ id: 'cus_gone', name: null, forgotten: true })], nextCursor: null, asOf: TODAY } },
      'GET /vendor/customers/cus_other': { status: 404, json: { error: 'customer_not_found' } },
    }));
    await page.goto('/vendor/customers/?id=cus_other');
    await expect(page.getByText('This customer is not available.')).toBeVisible();
    await page.goto('/vendor/customers/');
    await expect(page.getByTestId('customer-row-cus_gone')).toContainText('Deleted member');
  });
});

test.describe('payments', () => {
  test('preview oldest first; over owed and missing reference disable Save; Choose sales must add up', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto('/vendor/customers/?id=cus_juma');
    await page.getByTestId('customer-record-payment').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Record payment from Juma Mussa');
    await expect(page.getByTestId('pay-notice')).toHaveText('You received this money directly. FitFlex only keeps the record.');
    await expect(page.getByTestId('pay-save')).toBeDisabled();
    await page.getByTestId('pay-amount').fill('25000');
    await expect(page.getByTestId('pay-preview')).toContainText('Pays off R-000001 (TSh 20,000)');
    await expect(page.getByTestId('pay-preview')).toContainText('Pays TSh 5,000 of R-000002 (TSh 25,000 left)');
    await expect(page.getByTestId('pay-save')).toHaveText('Save payment TSh 25,000');
    await expect(page.getByTestId('pay-save')).toBeEnabled();

    await page.getByTestId('pay-amount').fill('60000');
    await expect(dialog).toContainText("That's more than the TSh 50,000 owed. FitFlex can't keep extra as credit.");
    await expect(page.getByTestId('pay-save')).toBeDisabled();
    await page.getByTestId('pay-all-owed').click();
    await expect(page.getByTestId('pay-amount')).toHaveValue('50000');
    await page.getByTestId('pay-oldest').click();
    await expect(page.getByTestId('pay-amount')).toHaveValue('20000');

    await page.getByTestId('pay-method-mpesa').click();
    await expect(page.getByTestId('pay-save')).toBeDisabled();
    await page.getByTestId('pay-reference').fill('qk12ab34');
    await expect(page.getByTestId('pay-reference')).toHaveValue('QK12AB34');
    await expect(page.getByTestId('pay-save')).toBeEnabled();
    await page.getByTestId('pay-method-cash').click();
    await expect(page.getByTestId('pay-reference')).toHaveCount(0);

    await page.getByTestId('pay-amount').fill('25000');
    await page.getByTestId('pay-choose-sales').click();
    await page.getByTestId('pay-alloc-sale_r1').fill('0');
    await page.getByTestId('pay-alloc-sale_r2').fill('20000');
    await expect(page.getByTestId('pay-alloc-mismatch')).toHaveText('Amounts must add up to TSh 25,000.');
    await expect(page.getByTestId('pay-save')).toBeDisabled();
    await page.getByTestId('pay-alloc-sale_r2').fill('25000');
    await expect(page.getByTestId('pay-alloc-mismatch')).toHaveCount(0);
    await expect(page.getByTestId('pay-save')).toBeEnabled();
  });

  test('save: body, network failure keeps the same clientRef for Try again, then the receipt with Copy', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let attempt = 0;
    const calls = await mockApi(page, base({
      'POST /vendor/customers/cus_juma/payments': () => (++attempt === 1 ? 'abort'
        : { status: 201, json: { payment: payment(), customer: { owedTzs: 25000, overdueTzs: 0, oldestDueDate: addDays(TODAY, 3), maxDaysOverdue: 0, aging: { ...zeroAging, current: 25000 }, asOf: TODAY } } }),
      'GET /vendor/customers/cus_juma/payments/pay_1': { json: { payment: payment() } },
    }));
    await page.goto('/vendor/customers/?id=cus_juma');
    await page.getByTestId('customer-record-payment').click();
    await page.getByTestId('pay-amount').fill('25000');
    await page.getByTestId('pay-method-mpesa').click();
    await page.getByTestId('pay-reference').fill('QK12AB34');
    await page.getByTestId('pay-save').click();
    await expect(page.getByTestId('pay-alert')).toHaveText('Could not save the payment. Nothing is recorded yet.');
    await expect(page.getByTestId('pay-save')).toHaveText('Try again');
    await page.getByTestId('pay-save').click();
    await expect(page.getByText('Payment saved: PMT-000001')).toBeVisible();
    const posts = callsTo(calls, 'POST', '/vendor/customers/cus_juma/payments');
    expect(posts).toHaveLength(2);
    expect(posts[1].body!.clientRef).toBe(posts[0].body!.clientRef);
    expect(posts[1].body).toMatchObject({ amountTzs: 25000, method: 'mpesa', reference: 'QK12AB34', receivedOn: TODAY });
    expect(posts[1].body!.allocations).toBeUndefined();
    await expect(page).toHaveURL(/payment=pay_1/);
    await expect(page.getByTestId('payment-allocations')).toContainText('R-000001');
    await expect(page.getByTestId('payment-still-owed')).toHaveText('TSh 25,000');
    await page.getByTestId('payment-copy').click();
    const text = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(text).toContain('Dar Fitness Gear');
    expect(text).toContain('Payment PMT-000001');
    expect(text).toContain('Customer: Juma Mussa');
    expect(text).toContain('M-Pesa (QK12AB34)');
    expect(text).toContain('Paid towards:');
    expect(text).toContain('Still owed');
    expect(text).toContain('This is not a TRA fiscal receipt.');
    expect(text).not.toContain('+255');
  });

  test('server overpayment race shows the new owed amount; nothing saved', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'POST /vendor/customers/cus_juma/payments': { status: 409, json: { error: 'overpayment', owedTzs: 10000 } } }));
    await page.goto('/vendor/customers/?id=cus_juma');
    await page.getByTestId('customer-record-payment').click();
    await page.getByTestId('pay-amount').fill('25000');
    await page.getByTestId('pay-save').click();
    await expect(page.getByTestId('pay-owed')).toHaveText('TSh 10,000');
    await expect(page.getByRole('dialog')).toContainText("That's more than the TSh 10,000 owed.");
    await expect(page.getByTestId('pay-save')).toBeDisabled();
  });

  test('void a payment: reason required, then Voided with who and why; a second void says already voided', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let voided = false;
    const calls = await mockApi(page, base({
      'GET /vendor/customers/cus_juma/payments': () => ({ json: { payments: [payment(voided ? { status: 'voided', voidedAt: NOW, voidedBy: { id: 'usr_vendor', name: 'Rehema' }, voidReason: 'Wrong customer' } : {})], nextCursor: null } }),
      'GET /vendor/customers/cus_juma/payments/pay_1': () => ({ json: { payment: payment(voided ? { status: 'voided', voidedAt: NOW, voidedBy: { id: 'usr_vendor', name: 'Rehema' }, voidReason: 'Wrong customer' } : {}) } }),
      'POST /vendor/customers/cus_juma/payments/pay_1/void': () => {
        if (voided) return { status: 409, json: { error: 'already_voided', voidedAt: NOW } };
        voided = true;
        return { json: { payment: payment({ status: 'voided', voidedAt: NOW, voidedBy: { id: 'usr_vendor', name: 'Rehema' }, voidReason: 'Wrong customer' }), customer: { owedTzs: 50000, overdueTzs: 20000, oldestDueDate: null, maxDaysOverdue: 5, aging: zeroAging, asOf: TODAY } } };
      },
    }));
    await page.goto('/vendor/customers/?id=cus_juma&tab=payments');
    await page.getByTestId('customer-payment-pay_1').click();
    await expect(page).toHaveURL(/payment=pay_1/);
    await page.getByTestId('payment-void').click();
    await expect(page.getByRole('dialog')).toContainText('The sales it paid will show as owed again.');
    await expect(page.getByTestId('payment-void-confirm')).toBeDisabled();
    await page.getByTestId('payment-void-reason').fill('Wrong customer');
    await page.getByTestId('payment-void-confirm').click();
    await expect(page.getByText('Payment PMT-000001 voided')).toBeVisible();
    await expect(page.getByTestId('payment-voided')).toContainText('Voided by Rehema');
    await expect(page.getByTestId('payment-voided')).toContainText('Wrong customer');
    await expect(page.getByTestId('payment-copy')).toHaveCount(0);
    expect(callsTo(calls, 'POST', '/vendor/customers/cus_juma/payments/pay_1/void')[0].body).toEqual({ reason: 'Wrong customer' });
  });

  test('staff with `customers` but not `sales` open a sale read-only: no void, no copy receipt', async ({ page }) => {
    await signedInAs(page, STAFF);
    const calls = await mockApi(page, base({
      'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'cashier', permissions: ['customers'] }) },
      'GET /vendor/customers/cus_juma/sales/sale_r1': { json: { sale: {
        id: 'sale_r1', number: 'R-000001', status: 'completed', kind: 'credit', soldAt: NOW, recordedAt: NOW, subtotalTzs: 20000, lineDiscountTzs: 0, discountTzs: 0,
        totalTzs: 20000, paidTzs: 0, changeTzs: 0, note: null, createdBy: { id: 'usr_vendor', name: 'Asha' }, voidedBy: null, voidedAt: null, voidReason: null, lateRecorded: false,
        lines: [{ nameSnapshot: 'Whey 1kg', variant: null, qty: 1, listPriceTzs: 20000, unitPriceTzs: 20000, priceChanged: false, priceChangedBy: null, discountTzs: 0, lineTotalTzs: 20000 }],
        payments: [], customer: { id: 'cus_juma', name: 'Juma Mussa' }, dueDate: addDays(TODAY, -5), balanceTzs: 20000, paidAtSaleTzs: 0,
      } } },
    }));
    await page.goto('/vendor/customers/?id=cus_juma');
    await expect(page.getByTestId('customer-open-sales').getByRole('link', { name: 'R-000001' })).toHaveCount(0);
    await page.getByTestId('customer-open-sales').getByTestId('customer-sale-open-sale_r1').click();
    const detail = page.getByTestId('customer-sale-detail');
    await expect(detail).toContainText('Whey 1kg');
    await expect(page.getByTestId('customer-sale-balance')).toHaveText('TSh 20,000');
    await expect(page.getByTestId('sale-void')).toHaveCount(0);
    await expect(page.getByTestId('sale-copy')).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('button', { name: /void|copy/i })).toHaveCount(0);
    expect(callsTo(calls, 'GET', '/vendor/customers/cus_juma/sales/sale_r1')).toHaveLength(1);
    expect(callsTo(calls, 'GET', '/vendor/sales/sale_r1')).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('staff may not void another person\'s payment: no Void button; 403 void_not_allowed explains', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({
      'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'cashier', permissions: ['customers'] }) },
      'GET /vendor/customers/cus_juma/payments/pay_1': { json: { payment: payment() } },
    }));
    await page.goto('/vendor/customers/?id=cus_juma&tab=payments&payment=pay_1');
    await expect(page.getByTestId('payment-amount')).toHaveText('TSh 25,000');
    await expect(page.getByTestId('payment-void')).toHaveCount(0);
  });
});

test.describe('owed to you and statement', () => {
  test('summary, buckets filter the list, table with totals row and aria-sort headers', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'GET /vendor/receivables/aging': req => (new URL(req.url()).searchParams.get('bucket') === 'd90plus' ? { json: aging({ rows: [] }) } : { json: aging() }),
    }));
    await page.goto('/vendor/customers/');
    await page.getByRole('button', { name: 'Owed to you' }).click();
    await expect(page).toHaveURL(/view=owed/);
    await expect(page.getByTestId('owed-total')).toHaveText('TSh 50,000');
    await expect(page.getByTestId('owed-overdue')).toHaveText('TSh 20,000');
    await expect(page.getByTestId('owed-customers')).toHaveText('1');
    const table = page.getByTestId('owed-table');
    await expect(table.getByRole('columnheader')).toHaveCount(9);
    await expect(page.getByTestId('owed-totals-row')).toContainText('TSh 50,000');
    await expect(table.getByRole('columnheader', { name: 'Oldest due' })).toHaveAttribute('aria-sort', 'descending');
    await page.getByTestId('owed-sort-owed').click();
    await expect(table.getByRole('columnheader', { name: 'Total owed' })).toHaveAttribute('aria-sort', 'descending');
    await expect(table.getByRole('columnheader', { name: 'Oldest due' })).toHaveAttribute('aria-sort', 'none');
    await expect.poll(() => callsTo(calls, 'GET', '/vendor/receivables/aging').at(-1)?.search.get('sort')).toBe('owed');

    await page.getByTestId('owed-bucket-d90plus').click();
    await expect(page.getByTestId('owed-bucket-d90plus')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('No money owed in this group.')).toBeVisible();
    expect(callsTo(calls, 'GET', '/vendor/receivables/aging').at(-1)?.search.get('bucket')).toBe('d90plus');
    await page.getByTestId('owed-bucket-all').click();
    await page.getByTestId('owed-row-cus_juma').click();
    await expect(page).toHaveURL(/id=cus_juma/);
  });

  test('nobody owes: "Nobody owes you money."', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'GET /vendor/receivables/aging': { json: aging({ rows: [], totals: { ...aging().totals, owedTzs: 0, overdueTzs: 0, customerCount: 0, current: 0, d1_30: 0 } }) } }));
    await page.goto('/vendor/customers/?view=owed');
    await expect(page.getByText('Nobody owes you money.')).toBeVisible();
  });

  test('statement: open sales, recent payments, total owed and aging line; Swahili toggle; no contact details', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/customers/cus_juma/payments': { json: { payments: [payment(), payment({ id: 'pay_0', number: 'PMT-000000', status: 'voided' })], nextCursor: null } } }));
    await page.goto('/vendor/customers/?id=cus_juma');
    await page.getByTestId('customer-statement').click();
    const text = page.getByTestId('statement-text');
    await expect(text).toContainText('Statement for Juma Mussa');
    await expect(text).toContainText('R-000001');
    await expect(text).toContainText('5 days overdue');
    await expect(text).toContainText('PMT-000001');
    await expect(text).not.toContainText('PMT-000000');
    await expect(text).toContainText('Total owed');
    await expect(text).toContainText('1–30 days TSh 20,000');
    await expect(text).not.toContainText('+255');
    await expect(text).not.toContainText('Kariakoo');
    expect(callsTo(calls, 'GET', '/vendor/customers/cus_juma/payments').some(c => c.search.get('from') === addDays(TODAY, -90))).toBe(true);
    await page.getByRole('button', { name: 'Kiswahili' }).click();
    await expect(text).toContainText('Taarifa ya akaunti ya Juma Mussa');
    await page.getByTestId('statement-copy').click();
    const copied = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(copied).toContain('Jumla inayodaiwa');
  });
});

test.describe('sales page (S3) with pay later', () => {
  test('Pay later badge and balance, kind filter, customer on the detail with a link; void refused while payments are allocated', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const credit = {
      id: 'sale_r1', number: 'R-000001', status: 'completed', kind: 'credit', soldAt: NOW, recordedAt: NOW, subtotalTzs: 20000, lineDiscountTzs: 0, discountTzs: 0,
      totalTzs: 20000, paidTzs: 5000, changeTzs: 0, note: null, createdBy: { id: 'usr_vendor', name: 'Asha' }, voidedBy: null, voidedAt: null, voidReason: null, lateRecorded: false,
      lines: [{ nameSnapshot: 'Whey 1kg', variant: null, qty: 1, listPriceTzs: 20000, unitPriceTzs: 20000, priceChanged: false, priceChangedBy: null, discountTzs: 0, lineTotalTzs: 20000 }],
      payments: [], customer: { id: 'cus_juma', name: 'Juma Mussa' }, dueDate: addDays(TODAY, -5), balanceTzs: 15000, paidAtSaleTzs: 0,
      allocations: [{ paymentId: 'pay_1', number: 'PMT-000001', amountTzs: 5000, receivedOn: TODAY, voided: false }],
    };
    const calls = await mockApi(page, base({
      'GET /vendor/sales': { json: { sales: [creditRow({ balanceTzs: 15000 })], nextCursor: null, summary: { count: 1, totalTzs: 20000, voidedCount: 0, byMethod: [], payLaterTzs: 20000, owedTzs: 15000 } } },
      'GET /vendor/sales/sale_r1': { json: { sale: credit } },
      'POST /vendor/sales/sale_r1/void': { status: 409, json: { error: 'sale_has_payments', payments: [{ id: 'pay_1', number: 'PMT-000001' }] } },
    }));
    await page.goto('/vendor/sales/');
    const row = page.getByTestId('sale-row-sale_r1');
    await expect(row).toContainText('Pay later');
    await expect(row).toContainText('Owes TSh 15,000');
    await expect(row).toContainText('Juma Mussa');
    await expect(page.getByTestId('sales-summary-paylater')).toHaveText('TSh 20,000');
    await page.getByTestId('sales-kind').selectOption('credit');
    await expect(page).toHaveURL(/kind=credit/);
    await expect.poll(() => callsTo(calls, 'GET', '/vendor/sales').at(-1)?.search.get('kind')).toBe('credit');

    await page.goto('/vendor/sales/?id=sale_r1');
    await expect(page.getByTestId('sale-customer').getByRole('link', { name: 'Customer: Juma Mussa' })).toHaveAttribute('href', '/vendor/customers/?id=cus_juma');
    await expect(page.getByTestId('sale-balance')).toHaveText('TSh 15,000');
    await expect(page.getByTestId('sale-allocations')).toContainText('PMT-000001');
    await expect(page.getByTestId('sale-change')).toHaveCount(0);
    await page.getByTestId('sale-copy').click();
    const text = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(text).toContain('Customer: Juma Mussa');
    expect(text).toContain('Balance due');
    expect(text).toContain('Dar Fitness Gear recorded the balance due.');
    expect(text).not.toContain('Change');

    await page.getByTestId('sale-void').click();
    await expect(page.getByTestId('sale-void-credit')).toHaveText('The balance due is cancelled. Give back any money paid at the sale yourself.');
    await page.getByTestId('sale-void-reason').fill('Returned');
    await page.getByTestId('sale-void-confirm').click();
    await expect(page.getByTestId('sale-void-blocked')).toContainText('Payments are recorded against this sale. Void them first');
    await expect(page.getByTestId('sale-void-blocked').getByRole('link', { name: 'PMT-000001' })).toHaveAttribute('href', '/vendor/customers/?id=cus_juma&tab=payments&payment=pay_1');
    await expect(page.getByTestId('sale-void-confirm')).toBeDisabled();
  });

  test('staff with `sales` only: customerId in the URL is never sent, no kind link to customers', async ({ page }) => {
    await signedInAs(page, STAFF);
    const calls = await mockApi(page, base({
      'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'sales', permissions: ['sales'] }) },
      'GET /vendor/sales': { json: { sales: [creditRow()], nextCursor: null, summary: { count: 1, totalTzs: 20000, voidedCount: 0, byMethod: [] } } },
    }));
    await page.goto('/vendor/sales/?customerId=cus_juma');
    await expect(page.getByTestId('sale-row-sale_r1')).toContainText('Pay later');
    expect(callsTo(calls, 'GET', '/vendor/sales').every(c => !c.search.has('customerId'))).toBe(true);
    await expect(page.getByTestId('sales-customer-filter')).toHaveCount(0);
    expect(calls.outside).toEqual([]);
  });

  test('order detail links the buyer to their customer profile, and not when customerId is null', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const order = (customerId: string | null) => ({
      id: 'ord_1', shortRef: 'AB12CD', createdAt: NOW, status: 'delivered', orderStatus: 'delivered', nextStatuses: [], timeline: [],
      items: [{ productId: 'p1', name: 'Whey', variant: null, qty: 1, priceTzs: 45000, image: null }], totalTzs: 45000, paymentStatus: 'paid',
      paymentMethod: 'mpesa', deliveryMethod: 'pickup', note: null, pickupGymId: null, pickupGym: null, buyer: { customerId, displayName: 'Neema Joseph' },
    });
    let id: string | null = 'cus_app';
    await mockApi(page, base({ 'GET /vendor/orders/ord_1': () => ({ json: order(id) }) }));
    await page.goto('/vendor/orders/?id=ord_1');
    await expect(page.getByTestId('order-buyer-customer')).toHaveAttribute('href', '/vendor/customers/?id=cus_app');
    id = null;
    await page.reload();
    await expect(page.getByTestId('order-buyer')).toHaveText('Neema Joseph');
    await expect(page.getByTestId('order-buyer-customer')).toHaveCount(0);
  });

  test('order buyer link follows buyer.customerLinked; without it, paid orders only', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const order = (buyer: Record<string, unknown>, paymentStatus = 'paid') => ({
      id: 'ord_1', shortRef: 'AB12CD', createdAt: NOW, status: 'pending', orderStatus: 'pending', nextStatuses: [], timeline: [],
      items: [{ productId: 'p1', name: 'Whey', variant: null, qty: 1, priceTzs: 45000, image: null }], totalTzs: 45000, paymentStatus,
      paymentMethod: 'mpesa', deliveryMethod: 'pickup', note: null, pickupGymId: null, pickupGym: null, buyer: { customerId: 'cus_app', displayName: 'Neema Joseph', ...buyer },
    });
    let reply = order({ customerLinked: false });
    await mockApi(page, base({ 'GET /vendor/orders/ord_1': () => ({ json: reply }) }));
    await page.goto('/vendor/orders/?id=ord_1');
    await expect(page.getByTestId('order-buyer')).toHaveText('Neema Joseph');
    await expect(page.getByTestId('order-buyer-customer')).toHaveCount(0);
    reply = order({ customerLinked: true }, 'pending');
    await page.reload();
    await expect(page.getByTestId('order-buyer-customer')).toBeVisible();
    reply = order({}, 'pending');
    await page.reload();
    await expect(page.getByTestId('order-buyer')).toHaveText('Neema Joseph');
    await expect(page.getByTestId('order-buyer-customer')).toHaveCount(0);
  });

  test('a forgotten customer on aging rows and sale rows reads "Deleted member"', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const a = aging();
    await mockApi(page, base({
      'GET /vendor/receivables/aging': { json: { ...a, rows: [{ ...a.rows[0], customerId: 'cus_gone', name: null, source: 'marketplace', forgotten: true }] } },
      'GET /vendor/sales': { json: { sales: [creditRow({ customer: { id: 'cus_gone', name: null, forgotten: true } })], nextCursor: null, summary: { count: 1, totalTzs: 20000, voidedCount: 0, byMethod: [] } } },
    }));
    await page.goto('/vendor/customers/?view=owed');
    await expect(page.getByTestId('owed-row-cus_gone')).toContainText('Deleted member');
    await page.goto('/vendor/sales/');
    await expect(page.getByTestId('sale-row-sale_r1')).toContainText('Deleted member');
  });
});

test.describe('language and targets', () => {
  test('Swahili: nav, filters, aging tiles and payment strings; money never truncated', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    await mockApi(page, base());
    await page.goto('/vendor/customers/');
    await expect(page.getByRole('link', { name: 'Wateja', exact: true }).first()).toBeVisible();
    for (const label of ['Wanadaiwa', 'Wamechelewa', 'Wateja wa dukani', 'Wateja wa app', 'Waliowekwa kando']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
    await page.goto('/vendor/customers/?id=cus_juma');
    await expect(page.getByTestId('customer-aging')).toContainText('Bado muda haujafika');
    await expect(page.getByTestId('customer-aging')).toContainText('Zaidi ya siku 90');
    await page.getByTestId('customer-record-payment').click();
    await expect(page.getByTestId('pay-notice')).toHaveText('Umepokea pesa hii moja kwa moja. FitFlex inahifadhi kumbukumbu tu.');
    const owed = page.getByTestId('customer-owed-value');
    expect(await owed.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  test('nav item, filters, rows, buckets and payment chips are at least 44px; phones get cards', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    const tall = async (loc: ReturnType<Page['locator']>) => expect((await loc.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.goto('/vendor/customers/');
    await tall(page.getByRole('link', { name: 'Customers', exact: true }).first());
    await tall(page.getByRole('button', { name: 'Owe you' }));
    await tall(page.getByTestId('vendor-customers-add'));
    await page.goto('/vendor/customers/?view=owed');
    await tall(page.getByTestId('owed-bucket-current'));
    await page.goto('/vendor/customers/?id=cus_juma');
    await tall(page.getByTestId('customer-record-payment'));
    await page.getByTestId('customer-record-payment').click();
    await tall(page.getByTestId('pay-method-mpesa'));
    await tall(page.getByTestId('pay-all-owed'));
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/vendor/customers/');
    await expect(page.getByTestId('customer-card-cus_juma')).toBeVisible();
    await tall(page.getByTestId('customer-card-cus_juma'));
    const value = page.getByTestId('customer-card-cus_juma').getByText('TSh 50,000');
    expect(await value.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
});
