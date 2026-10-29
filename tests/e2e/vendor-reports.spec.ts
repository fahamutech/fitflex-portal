import { expect, test, type Page, type Request } from '@playwright/test';

// Vendor reports (S6) in the portal against a mocked API (contract fitflex-functions #275): gating (tools.reports +
// `reports`; quiet redirect when off), sections per right (canSeeCost, canSeeOrderMoney, customers, stock ledger),
// cost keys absent → no cost wording, Overview / Sales / Products (days of cover) / Stock value / Profit / App sales
// after commission / Customers / Payment methods, period presets and custom range limits, URL fallback, the stale
// request rule, export (CSV, PDF, 413) and Swahili with the 12-hour clock.
// Network guard: every request outside localhost is aborted, and the API is answered here (never the live API).

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Answer = { status?: number; json?: unknown; body?: string; headers?: Record<string, string>; delayMs?: number };
type Reply = Answer | ((req: Request) => Answer | 'abort');
type Routes = Record<string, Reply>;
type Call = { method: string; path: string; search: URLSearchParams };

const ALL_PERMISSIONS = ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff'];
const tools = (extra: Record<string, unknown> = {}) => ({
  portal: true, stockLedger: true, canSeeCost: true, canSeeOrderMoney: true, walkInSales: true, customers: true, reports: true, ...extra,
});
const me = (extra: Record<string, unknown> = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ALL_PERMISSIONS, approvalStatus: 'approved', accountStatus: 'active', tools: tools(), ...extra,
});
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };
const STAFF = { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' };
// Reports only: no cost, no payouts, no customers (spec AC-4).
const reportsOnly = () => me({ userType: 'vendor_staff', vendorRole: 'reports', permissions: ['reports'], tools: tools({ canSeeCost: false, canSeeOrderMoney: false }) });

const eatToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const TODAY = eatToday();
const MONTH_START = `${TODAY.slice(0, 7)}-01`;
// 11:05 UTC = 14:05 EAT → "2:05 pm" / "2:05 mchana".
const GENERATED = `${TODAY}T11:05:00.000Z`;

const zero = () => ({ grossTzs: 0, discountTzs: 0, refundTzs: 0, netTzs: 0, vatIncludedTzs: 0, count: 0, itemsSold: 0 });
function head(req: Request, extra: Record<string, unknown> = {}) {
  const q = new URL(req.url()).searchParams;
  const from = q.get('from') ?? MONTH_START;
  const to = q.get('to') ?? TODAY;
  return { from, to, channel: q.get('channel') ?? 'all', generatedAt: GENERATED, timezone: 'Africa/Dar_es_Salaam', inProgress: to === TODAY, channels: { app: true, walkIn: true }, ...extra };
}
const salesTotals = { grossTzs: 520000, discountTzs: 20000, refundTzs: 30000, netTzs: 470000, vatIncludedTzs: 0, saleCount: 6, orderCount: 4, itemsSold: 25, voided: { count: 1, totalTzs: 15000 } };

const summary = (req: Request, opts: { cost?: boolean; payout?: boolean; customers?: boolean } = { cost: true, payout: true, customers: true }) => ({
  ...head(req, { groupBy: 'day' }),
  sales: { ...salesTotals, buckets: [{ start: MONTH_START, end: MONTH_START, netTzs: 470000 }] },
  topProducts: [
    { productId: 'p1', variant: 'L', name: 'Whey Protein', removed: false, unitsSold: 10, netRevenueTzs: 300000 },
    { productId: 'p9', variant: null, name: 'Old Shaker', removed: true, unitsSold: 2, netRevenueTzs: 20000 },
  ],
  slowCount: 3,
  methods: { byYou: [{ method: 'cash', amountTzs: 120000, count: 4, sharePct: 60 }], viaFitFlex: [{ paymentMethod: 'mpesa', amountTzs: 200000, count: 4, sharePct: 100 }] },
  stock: { atRetailTzs: 900000, units: 45, ...(opts.cost ? { atCostTzs: 500000, costUnknownCount: 1 } : {}) },
  ...(opts.cost ? { profit: { profitTzs: 123000, marginPct: 28.4, netExVatTzs: 433000, commissionTzs: 40000, costTzs: 270000, uncosted: { qty: 2, revenueTzs: 20000 } } } : {}),
  ...(opts.payout ? { payouts: { grossTzs: 200000, commissionTzs: 20000, payoutTzs: 180000, paidOutTzs: 90000, waitingTzs: 90000, notDeliveredTzs: 45000 } } : {}),
  ...(opts.customers ? { customers: { owedTzs: 50000, overdueTzs: 20000, collectedTzs: 25000 } } : {}),
});
const sales = (req: Request) => ({
  ...head(req, { groupBy: 'day' }),
  totals: salesTotals,
  byChannel: {
    app: { ...zero(), grossTzs: 200000, refundTzs: 30000, netTzs: 170000, count: 4, itemsSold: 10 },
    walkIn: { ...zero(), grossTzs: 320000, discountTzs: 20000, netTzs: 300000, count: 6, itemsSold: 15 },
  },
  buckets: [
    { start: MONTH_START, end: MONTH_START, netTzs: 470000, app: { ...zero(), grossTzs: 200000, refundTzs: 30000, netTzs: 170000, count: 4, itemsSold: 10 }, walkIn: { ...zero(), grossTzs: 320000, discountTzs: 20000, netTzs: 300000, count: 6, itemsSold: 15 } },
  ],
});
const prodRow = (extra: Record<string, unknown>) => ({
  productId: 'p1', variant: null, name: 'Whey Protein', removed: false, unitsSold: 60, appUnits: 40, walkInUnits: 20, netRevenueTzs: 600000,
  lastSoldAt: `${TODAY}T07:00:00.000Z`, stock: 30, avgDailyUnits30: 2, daysOfCover: 15, coverState: 'ok', noSalesInPeriod: false, ...extra,
});
// AC-18 with the formula (stock ÷ average daily units over 30 days): 30 ÷ (60/30) = 15 days; 5 ÷ (30/30) = 5 days.
const productRows = (cost: boolean) => [
  prodRow({}),
  prodRow({ productId: 'p2', name: 'Gloves', unitsSold: 30, appUnits: 30, walkInUnits: 0, netRevenueTzs: 300000, stock: 5, avgDailyUnits30: 1, daysOfCover: 5, coverState: 'soon' }),
  prodRow({ productId: 'p3', name: 'Mat', unitsSold: 0, appUnits: 0, walkInUnits: 0, netRevenueTzs: 0, lastSoldAt: null, stock: 10, avgDailyUnits30: 0, daysOfCover: null, coverState: 'none', noSalesInPeriod: true }),
  prodRow({ productId: 'p4', name: 'Bottle', unitsSold: 3, stock: 0, daysOfCover: 0, coverState: 'out' }),
].map(r => (cost ? { ...r, profitTzs: 1000 } : r));
const products = (req: Request, cost = true) => {
  const q = new URL(req.url()).searchParams;
  if (q.get('cursor')) return { ...head(req), sort: 'revenue', rows: [prodRow({ productId: 'p5', name: 'Rope' })], totals: { unitsSold: 93, netRevenueTzs: 900000 }, slowCount: 1, nextCursor: null };
  return { ...head(req), sort: q.get('sort') ?? 'revenue', rows: productRows(cost), totals: { unitsSold: 93, netRevenueTzs: 900000 }, slowCount: 1, nextCursor: 'b246NTA' };
};
const stockValue = (req: Request, cost = true) => ({
  ...head(req), asOf: GENERATED,
  totals: { atRetailTzs: 900000, units: 45, products: 2, ...(cost ? { atCostTzs: 500000 } : {}) },
  ...(cost ? { costUnknown: { count: 1, units: 5, retailTzs: 100000 } } : {}),
  rows: [
    { productId: 'p1', variant: 'L', name: 'Whey Protein', stock: 40, priceTzs: 20000, valueAtRetailTzs: 800000, ...(cost ? { costTzs: 12500, valueAtCostTzs: 500000 } : {}) },
    { productId: 'p2', variant: null, name: 'Gloves', stock: 5, priceTzs: 20000, valueAtRetailTzs: 100000, ...(cost ? { costTzs: null, valueAtCostTzs: null } : {}) },
  ],
});
const profit = (req: Request) => ({
  ...head(req, { groupBy: 'day' }),
  totals: { netExVatTzs: 433000, commissionTzs: 40000, costTzs: 270000, profitTzs: 123000, marginPct: 28.4 },
  uncosted: { lineCount: 1, qty: 2, revenueTzs: 20000, netExVatTzs: 20000 }, hasVat: true,
  buckets: [{ start: MONTH_START, end: MONTH_START, netExVatTzs: 433000, commissionTzs: 40000, costTzs: 270000, profitTzs: 123000, marginPct: 28.4, uncostedRevenueTzs: 20000 }],
  byChannel: { app: { netExVatTzs: 0, commissionTzs: 0, costTzs: 0, profitTzs: 0, marginPct: null }, walkIn: { netExVatTzs: 0, commissionTzs: 0, costTzs: 0, profitTzs: 0, marginPct: null } },
  byProduct: [{ productId: 'p1', variant: null, name: 'Whey Protein', removed: false, units: 10, netExVatTzs: 433000, commissionTzs: 40000, costTzs: 270000, profitTzs: 123000, marginPct: 28.4 }],
  uncostedProducts: [{ productId: 'p2', variant: null, name: 'Gloves', removed: false, units: 2, revenueTzs: 20000 }],
});
const payouts = (req: Request) => ({
  ...head(req, { channel: 'app' }), basis: 'delivered',
  totals: { orderCount: 3, grossTzs: 200000, commissionTzs: 20000, payoutTzs: 180000 },
  status: { notDelivered: { orders: 1, grossTzs: 50000, commissionTzs: 5000, payoutTzs: 45000 }, waiting: { orders: 1, grossTzs: 100000, commissionTzs: 10000, payoutTzs: 90000 }, paidOut: { orders: 2, grossTzs: 100000, commissionTzs: 10000, payoutTzs: 90000 } },
  weeks: [
    { periodStartDate: '2026-10-12', periodEndDate: '2026-10-18', orderCount: 2, grossTzs: 100000, commissionTzs: 10000, payoutTzs: 90000, paidOut: true, statement: { id: 'vst_1', status: 'paid', finalNetTzs: 90000 } },
    { periodStartDate: '2026-10-19', periodEndDate: '2026-10-25', orderCount: 1, grossTzs: 100000, commissionTzs: 10000, payoutTzs: 90000, paidOut: false, statement: null },
  ],
});
const customers = (req: Request) => ({
  ...head(req), asOf: TODAY, owedTzs: 50000, overdueTzs: 20000, aging: { current: 30000, d1_30: 20000, d31_60: 0, d61_90: 0, d90plus: 0 },
  creditSales: { count: 2, totalTzs: 60000 }, collectedTzs: 25000, buyers: { shop: 3, app: 4 },
});
const methods = (req: Request) => ({
  ...head(req),
  byYou: [{ method: 'cash', amountTzs: 120000, count: 4, sharePct: 60 }, { method: 'mpesa', amountTzs: 80000, count: 2, sharePct: 40 }],
  viaFitFlex: [{ paymentMethod: 'mpesa', amountTzs: 200000, count: 4, sharePct: 100 }],
});

async function signedInAs(page: Page, user: Record<string, unknown>, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
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
    calls.push({ method: req.method(), path: url.pathname, search: url.searchParams });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req) : hit;
    if (reply === 'abort') return route.abort('internetdisconnected');
    if (reply.delayMs) await new Promise(r => setTimeout(r, reply.delayMs));
    if (reply.body != null) return route.fulfill({ status: reply.status ?? 200, body: reply.body, headers: reply.headers });
    return route.fulfill({ status: reply.status ?? 200, json: reply.json }).catch(() => undefined);
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
  'GET /vendor/receivables/aging': { json: { asOf: TODAY, totals: { owedTzs: 0, overdueTzs: 0, customerCount: 0, overdueCustomerCount: 0, openSaleCount: 0, overdueSaleCount: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }, rows: [], nextCursor: null } },
  'GET /vendor/reports/summary': req => ({ json: summary(req) }),
  'GET /vendor/reports/sales': req => ({ json: sales(req) }),
  'GET /vendor/reports/products': req => ({ json: products(req) }),
  'GET /vendor/reports/stock-value': req => ({ json: stockValue(req) }),
  'GET /vendor/reports/profit': req => ({ json: profit(req) }),
  'GET /vendor/reports/marketplace-net': req => ({ json: payouts(req) }),
  'GET /vendor/reports/customers': req => ({ json: customers(req) }),
  'GET /vendor/reports/payment-methods': req => ({ json: methods(req) }),
  ...extra,
});
const reportCalls = (calls: Call[], section?: string) => calls.filter(c => c.method === 'GET' && (section ? c.path === `/vendor/reports/${section}` : c.path.startsWith('/vendor/reports/')));
const nav = (page: Page) => page.getByRole('navigation').first();

test.describe('gating', () => {
  test('reports off: no Reports nav, no dashboard link, a deep link goes home with no message and no report request', async ({ page }) => {
    await signedInAs(page, VENDOR);
    test.slow(); // Often the first test of the run: the dev server compiles both pages on the way.
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: tools({ reports: false }) }) } }));
    await page.goto('/vendor/reports/?view=sales');
    await expect(page).toHaveURL(/\/vendor\/$/, { timeout: 45_000 });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText("You don't have access to that.")).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('dash-reports-link')).toHaveCount(0);
    expect(reportCalls(calls)).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('staff without `reports`: no nav, and a deep link says "no access"', async ({ page }) => {
    await signedInAs(page, STAFF);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'orders_manager', permissions: ['orders'], tools: tools({ canSeeCost: false, canSeeOrderMoney: false }) }) } }));
    await page.goto('/vendor/reports/');
    await expect(page).toHaveURL(/\/vendor\/$/);
    await expect(page.getByText("You don't have access to that.")).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
    expect(reportCalls(calls)).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('owner: Reports nav after Customers, the dashboard link, every section offered', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/');
    await expect(nav(page).getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
    const hrefs = await nav(page).getByRole('link').evaluateAll(as => as.map(a => (a.getAttribute('href') ?? '').replace(/\/$/, '')));
    expect(hrefs.indexOf('/vendor/reports')).toBe(hrefs.indexOf('/vendor/customers') + 1);
    await page.getByTestId('dash-reports-link').click();
    await expect(page).toHaveURL(/\/vendor\/reports\/$/);
    for (const label of ['Overview', 'Sales', 'Products', 'Stock value', 'Profit', 'App sales after commission', 'Customers and money owed', 'Payment methods']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    expect(calls.outside).toEqual([]);
  });

  test('reports-only staff: no Profit, payouts or Customers; no cost words; a profit deep link falls back to Overview', async ({ page }) => {
    await signedInAs(page, STAFF);
    const calls = await mockApi(page, base({
      'GET /vendor/me': { json: reportsOnly() },
      'GET /vendor/reports/summary': req => ({ json: summary(req, {}) }),
      'GET /vendor/reports/products': req => ({ json: products(req, false) }),
      'GET /vendor/reports/stock-value': req => ({ json: stockValue(req, false) }),
    }));
    await page.goto('/vendor/reports/?view=profit');
    await expect(page.getByText("You don't have access to this report.")).toBeVisible();
    await expect(page).toHaveURL(/\/vendor\/reports\/$/);
    await expect(page.getByTestId('ov-net')).toContainText('TSh 470,000');
    await expect(page.getByTestId('ov-profit')).toHaveCount(0);
    await expect(page.getByTestId('ov-owed')).toHaveCount(0);
    await expect(page.getByTestId('ov-payouts')).toHaveCount(0);
    for (const label of ['Profit', 'App sales after commission', 'Customers and money owed']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Products', exact: true }).click();
    await expect(page.getByTestId('products-table')).toBeVisible();
    await expect(page.getByTestId('products-table').getByRole('columnheader', { name: 'Profit' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Stock value', exact: true }).click();
    await expect(page.getByTestId('stock-retail')).toContainText('TSh 900,000');
    await expect(page.getByTestId('stock-cost')).toHaveCount(0);
    await expect(page.getByTestId('stock-cost-unknown')).toHaveCount(0);
    await expect(page.getByText(/cost/i)).toHaveCount(0);
    expect(reportCalls(calls, 'profit')).toHaveLength(0);
    expect(reportCalls(calls, 'marketplace-net')).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('staff with reports + payments see App sales after commission but not Profit', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({
      'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'cashier', permissions: ['reports', 'payments'], tools: tools({ canSeeCost: false, canSeeOrderMoney: true }) }) },
      'GET /vendor/reports/summary': req => ({ json: summary(req, { payout: true }) }),
    }));
    await page.goto('/vendor/reports/');
    await expect(page.getByTestId('ov-payouts')).toBeVisible();
    await expect(page.getByRole('button', { name: 'App sales after commission', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Profit', exact: true })).toHaveCount(0);
  });

  test('stock value needs the stock ledger', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: tools({ stockLedger: false }) }) } }));
    await page.goto('/vendor/reports/?view=stock');
    await expect(page).toHaveURL(/\/vendor\/reports\/$/);
    await expect(page.getByRole('button', { name: 'Stock value', exact: true })).toHaveCount(0);
    expect(reportCalls(calls, 'stock-value')).toHaveLength(0);
  });
});

test.describe('views', () => {
  test('overview: figures, header line with the 12-hour clock, chart summary and table, top products, methods', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/reports/');
    await expect(page.getByTestId('report-header-line')).toContainText('(so far) · All sales · Updated 2:05 pm');
    await expect(page.getByTestId('ov-net')).toContainText('TSh 470,000');
    await expect(page.getByTestId('ov-net')).toContainText('Gross TSh 520,000 · Discounts TSh 20,000');
    await expect(page.getByTestId('ov-profit')).toContainText('TSh 123,000');
    await expect(page.getByTestId('ov-owed')).toContainText('TSh 50,000');
    await expect(page.getByTestId('ov-chart')).toHaveAttribute('aria-label', /Net sales by day, .*Highest: .*TSh 470,000\. Total TSh 470,000\. Table below\./);
    await expect(page.getByTestId('ov-buckets')).toContainText('TSh 470,000');
    await expect(page.getByTestId('ov-top')).toContainText('Whey Protein · L');
    await expect(page.getByTestId('ov-top')).toContainText('Old Shaker (removed)');
    await expect(page.getByTestId('ov-slow')).toHaveText('Slow sellers: 3');
    await expect(page.getByTestId('overview-methods-you')).toContainText('Cash');
    await expect(page.getByTestId('overview-methods-fitflex')).toContainText('M-Pesa');
    await expect(page.getByTestId('ov-payouts')).toContainText('− TSh 20,000');
    const first = reportCalls(calls, 'summary')[0];
    expect(first.search.get('from')).toBe(MONTH_START);
    expect(first.search.get('to')).toBe(TODAY);
    expect(calls.outside).toEqual([]);
  });

  test('sales: strip, voided note, table footer = totals, shop columns, channel filter sent', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/reports/?view=sales');
    await expect(page.getByTestId('sales-net')).toContainText('TSh 470,000');
    await expect(page.getByTestId('sales-refunds')).toContainText('− TSh 30,000');
    await expect(page.getByTestId('sales-vat')).toHaveCount(0);
    await expect(page.getByTestId('sales-count')).toContainText('10');
    await expect(page.getByTestId('sales-voided')).toHaveText('Voided (not counted): 1 sales · TSh 15,000');
    await expect(page.getByTestId('sales-voided').getByRole('link')).toHaveAttribute('href', /\/vendor\/sales\/\?status=voided/);
    const footer = page.getByTestId('sales-total-row');
    await expect(footer).toContainText('TSh 170,000');
    await expect(footer).toContainText('TSh 300,000');
    await expect(footer).toContainText('TSh 470,000');
    await expect(page.getByTestId('sales-chart')).toHaveAttribute('role', 'img');
    await page.getByRole('button', { name: 'Shop', exact: true }).click();
    await expect(page).toHaveURL(/channel=walk_in/);
    await expect.poll(() => reportCalls(calls, 'sales').some(c => c.search.get('channel') === 'walk_in')).toBe(true);
  });

  test('products: days of cover from the server (stock 30 + 60 sold = 15 days), reorder soon, none, out, load more', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/reports/?view=products');
    const rows = page.getByTestId('products-table').getByTestId('product-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).getByTestId('cover')).toHaveText('15 days');
    await expect(rows.nth(1).getByTestId('cover')).toHaveText('5 daysReorder soon');
    await expect(rows.nth(2).getByTestId('cover')).toHaveText('No sales in 30 days');
    await expect(rows.nth(2)).toContainText('Never');
    await expect(rows.nth(3).getByTestId('cover')).toHaveText('Out of stock');
    await expect(page.getByTestId('products-total-row')).toContainText('TSh 900,000');
    await page.getByTestId('products-more').click();
    await expect(rows).toHaveCount(5);
    expect(reportCalls(calls, 'products').some(c => c.search.get('cursor') === 'b246NTA')).toBe(true);
    await page.getByRole('button', { name: 'Slow sellers', exact: true }).click();
    await expect(page).toHaveURL(/sort=slow/);
    await expect.poll(() => reportCalls(calls, 'products').some(c => c.search.get('sort') === 'slow')).toBe(true);
  });

  test('stock value: as of now, no period sent, period controls disabled, cost unknown alert, sortable headers', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/reports/?view=stock');
    await expect(page.getByTestId('stock-as-of')).toHaveText('As of 2:05 pm today. The period you picked does not apply.');
    await expect(page.getByTestId('stock-cost')).toContainText('TSh 500,000');
    await expect(page.getByTestId('stock-cost-unknown')).toHaveText('1 products in stock have no cost price, so they are not in the cost value.');
    await expect(page.getByTestId('stock-table').getByText('Unknown')).toBeVisible();
    await expect(page.getByRole('button', { name: 'This month', exact: true })).toBeDisabled();
    const call = reportCalls(calls, 'stock-value')[0];
    expect(call.search.get('from')).toBeNull();
    expect(call.search.get('to')).toBeNull();
    const nameHeader = page.getByTestId('stock-table').getByRole('columnheader', { name: 'Product' });
    await expect(nameHeader).toHaveAttribute('aria-sort', 'none');
    await nameHeader.getByRole('button').click();
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.getByTestId('stock-row').first()).toContainText('Gloves');
  });

  test('profit: totals, uncosted block apart, no-VAT note, by product and no cost price list', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto('/vendor/reports/?view=profit');
    await expect(page.getByTestId('profit-profit')).toContainText('TSh 123,000');
    await expect(page.getByTestId('profit-margin')).toContainText('28.4%');
    await expect(page.getByTestId('profit-uncosted')).toHaveText('Sold without a cost price: 2 items · TSh 20,000. Not in profit.');
    await expect(page.getByTestId('profit-novat')).toBeVisible();
    await expect(page.getByTestId('profit-nocost')).toContainText('Gloves');
  });

  test('app sales after commission: basis, status, weeks with badges and a statement link', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/reports/?view=payouts');
    await expect(page.getByTestId('payouts-basis')).toHaveText('App orders only. Counted by delivery date, the same as your payout statements.');
    await expect(page.getByTestId('payouts-receive')).toContainText('TSh 180,000');
    await expect(page.getByTestId('payouts-not-delivered')).toContainText('1 orders');
    const weeks = page.getByTestId('payouts-week');
    await expect(weeks.nth(0)).toContainText('Paid out');
    await expect(weeks.nth(0).getByRole('link', { name: 'Open statement' })).toHaveAttribute('href', '/vendor/payouts/?id=vst_1');
    await expect(weeks.nth(1)).toContainText('Not on a statement yet');
    await expect(page.getByTestId('report-header-line')).toContainText('App only');
    expect(reportCalls(calls, 'marketplace-net')[0].search.get('channel')).toBeNull();
  });

  test('customers and payment methods', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto('/vendor/reports/?view=customers');
    await expect(page.getByTestId('cust-owed')).toContainText('TSh 50,000');
    await expect(page.getByTestId('cust-credit')).toContainText('2 sales');
    await expect(page.getByTestId('cust-buyers')).toContainText('Shop 3 · App 4');
    await expect(page.getByTestId('cust-aging')).toContainText('Not due yet TSh 30,000');
    await page.getByRole('button', { name: 'Payment methods', exact: true }).click();
    await expect(page.getByTestId('methods-you')).toContainText('Cash after change');
    await expect(page.getByTestId('methods-you')).toContainText('60%');
    await expect(page.getByTestId('methods-fitflex')).toContainText('M-Pesa');
    await expect(page.getByTestId('methods-you')).toContainText('FitFlex does not handle this money');
  });

  test('a failed report shows Try again in the view and retries', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let fail = true;
    await mockApi(page, base({ 'GET /vendor/reports/summary': req => (fail ? { status: 500, json: { error: 'boom' } } : { json: summary(req) }) }));
    await page.goto('/vendor/reports/');
    await expect(page.getByText('This report could not load.')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('ov-net')).toContainText('TSh 470,000');
  });

  test('no sales in the period: the empty state names the period', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const empty = { ...salesTotals, grossTzs: 0, discountTzs: 0, refundTzs: 0, netTzs: 0, saleCount: 0, orderCount: 0, itemsSold: 0, voided: { count: 0, totalTzs: 0 } };
    await mockApi(page, base({ 'GET /vendor/reports/summary': req => ({ json: { ...summary(req), sales: { ...empty, buckets: [] }, topProducts: [] } }) }));
    await page.goto('/vendor/reports/');
    await expect(page.getByTestId('report-empty')).toContainText('No sales in');
    await page.getByRole('button', { name: 'Try another period' }).click();
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeFocused();
  });
});

test.describe('period and URL', () => {
  test('presets set from/to; a custom range over 366 days or into the future cannot be applied', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/reports/?view=sales');
    await page.getByRole('button', { name: 'Yesterday', exact: true }).click();
    const y = addDays(TODAY, -1);
    await expect(page).toHaveURL(new RegExp(`from=${y}&to=${y}`));
    await expect.poll(() => reportCalls(calls, 'sales').some(c => c.search.get('from') === y && c.search.get('to') === y)).toBe(true);
    await page.getByRole('button', { name: 'Choose dates', exact: true }).click();
    await page.getByTestId('report-from').fill(addDays(TODAY, -400));
    await page.getByTestId('report-to').fill(TODAY);
    await expect(page.getByTestId('report-custom-error')).toHaveText('Choose up to 366 days.');
    await expect(page.getByTestId('report-apply')).toBeDisabled();
    await page.getByTestId('report-from').fill(TODAY);
    await page.getByTestId('report-to').fill(addDays(TODAY, 1));
    await expect(page.getByTestId('report-custom-error')).toHaveText("The end date can't be after today.");
    await expect(page.getByTestId('report-apply')).toBeDisabled();
    await page.getByTestId('report-from').fill(addDays(TODAY, -6));
    await page.getByTestId('report-to').fill(TODAY);
    await page.getByTestId('report-apply').click();
    await expect(page).toHaveURL(new RegExp(`from=${addDays(TODAY, -6)}&to=${TODAY}`));
  });

  test('invalid URL values fall back (This month, all, auto) and are rewritten', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto(`/vendor/reports/?view=nope&from=2026-02-30&to=${TODAY}&channel=web&groupBy=year`);
    await expect(page).toHaveURL(/\/vendor\/reports\/$/);
    await expect(page.getByTestId('ov-net')).toBeVisible();
    const last = reportCalls(calls, 'summary').at(-1)!;
    expect(last.search.get('from')).toBe(MONTH_START);
    expect(last.search.get('channel')).toBeNull();
    expect(last.search.get('groupBy')).toBeNull();
  });

  test('changing the period quickly renders only the latest answer', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const y = addDays(TODAY, -1);
    await mockApi(page, base({
      'GET /vendor/reports/sales': req => {
        const from = new URL(req.url()).searchParams.get('from');
        const body = sales(req);
        // Yesterday's answer is slow and would say 999; today's answer is fast.
        return from === y ? { delayMs: 1500, json: { ...body, totals: { ...body.totals, netTzs: 999 } } } : { json: body };
      },
    }));
    await page.goto('/vendor/reports/?view=sales');
    await expect(page.getByTestId('sales-net')).toContainText('TSh 470,000');
    await page.getByRole('button', { name: 'Yesterday', exact: true }).click();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page.getByTestId('sales-net')).toContainText('TSh 470,000');
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('sales-net')).toContainText('TSh 470,000');
    await expect(page.getByText('TSh 999')).toHaveCount(0);
  });
});

test.describe('export', () => {
  test('CSV of the current section in the chosen language, PDF summary, and the too-large message', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let csvStatus = 200;
    const calls = await mockApi(page, base({
      'GET /vendor/reports/sales': req => {
        const q = new URL(req.url()).searchParams;
        if (q.get('format') === 'csv') {
          return csvStatus === 413
            ? { status: 413, json: { error: 'export_too_large', maxRows: 50000 } }
            : { body: '﻿Period,Net sales (TZS)\r\n', headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="dar-fitness-gear_sales_x.csv"' } };
        }
        return { json: sales(req) };
      },
      'GET /vendor/reports/summary': req => (new URL(req.url()).searchParams.get('format') === 'pdf'
        ? { body: '%PDF-1.4\n%%EOF', headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="dar-fitness-gear_report_x.pdf"' } }
        : { json: summary(req) }),
    }));
    await page.goto('/vendor/reports/?view=sales');
    await expect(page.getByTestId('sales-net')).toBeVisible();
    await page.getByTestId('report-export').click();
    const dialog = page.getByTestId('report-export-dialog');
    await expect(dialog.getByTestId('export-sales')).toHaveText('Sales (CSV)');
    await expect(dialog.getByTestId('export-overview')).toHaveText('Summary (PDF)');
    const download = page.waitForEvent('download');
    await dialog.getByTestId('export-sales').click();
    // Cross-origin, Content-Disposition is not readable: the portal names the file as the server does.
    expect((await download).suggestedFilename()).toBe(`dar-fitness-gear_sales_${MONTH_START}${MONTH_START === TODAY ? '' : `_${TODAY}`}.csv`);
    await expect(page.getByText('Report downloaded.')).toBeVisible();
    const csv = reportCalls(calls, 'sales').find(c => c.search.get('format') === 'csv')!;
    expect(csv.search.get('lang')).toBe('en');
    expect(csv.search.get('from')).toBe(MONTH_START);

    await page.getByTestId('report-export').click();
    const pdf = page.waitForEvent('download');
    await page.getByTestId('export-overview').click();
    expect((await pdf).suggestedFilename()).toBe(`dar-fitness-gear_report_${MONTH_START}${MONTH_START === TODAY ? '' : `_${TODAY}`}.pdf`);
    expect(reportCalls(calls, 'summary').some(c => c.search.get('format') === 'pdf')).toBe(true);

    csvStatus = 413;
    await page.getByTestId('report-export').click();
    await page.getByTestId('export-sales').click();
    await expect(page.getByText('This report is too big to download. Choose a shorter period.')).toBeVisible();
    expect(calls.outside).toEqual([]);
  });

  test('reports-only staff are offered only their sections', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({ 'GET /vendor/me': { json: reportsOnly() }, 'GET /vendor/reports/summary': req => ({ json: summary(req, {}) }) }));
    await page.goto('/vendor/reports/');
    await page.getByTestId('report-export').click();
    const dialog = page.getByTestId('report-export-dialog');
    // Summary (PDF) + Sales, Products, Stock value, Payment methods (CSV).
    await expect(dialog.getByRole('button')).toHaveCount(5);
    await expect(dialog.getByTestId('export-profit')).toHaveCount(0);
    await expect(dialog.getByTestId('export-payouts')).toHaveCount(0);
    await expect(dialog.getByTestId('export-customers')).toHaveCount(0);
  });
});

test('Swahili: nav, labels and the 12-hour clock with the part of the day', async ({ page }) => {
  await signedInAs(page, VENDOR, 'sw');
  const calls = await mockApi(page, base());
  await page.goto('/vendor/reports/');
  await expect(nav(page).getByRole('link', { name: 'Ripoti', exact: true })).toBeVisible();
  await expect(page.getByTestId('report-header-line')).toContainText('(hadi sasa) · Mauzo yote · Imesasishwa 2:05 mchana');
  await expect(page.getByTestId('ov-net')).toContainText('Mauzo halisi');
  await page.getByRole('button', { name: 'Mauzo ya app baada ya kamisheni', exact: true }).click();
  await expect(page.getByTestId('payouts-week').nth(0)).toContainText('Yamelipwa');
  expect(calls.outside).toEqual([]);
});
