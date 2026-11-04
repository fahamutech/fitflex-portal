import { expect, test, type Page, type Request } from '@playwright/test';

// Vendor S9: suppliers, receive stock (GRN) and payables in the portal (docs/design/vendor-purchases-s9.md §5, §11, §12),
// against a mocked API (contract: fitflex-functions#327). Gating (tools.purchases, `purchases`), permission visibility
// (owner, M2 staff), suppliers (add, duplicate, archive refused while owed, restore), Receive stock (variant, cost
// notices, last cost, part payment + Split evenly, sum error, confirm → detail, retry with the same clientRef, draft),
// the purchase detail (payment preview, overpayment, void payment, change plan, void with insufficient_stock and
// has_others_payments), Owed to suppliers (buckets, aria-sort, CSV), stock history GRN rows, Payment methods "Paid to
// suppliers", the dashboard tile, 375px, Escape, Swahili. Nothing may reach a real service.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Reply = { status?: number; json?: unknown; body?: string; contentType?: string; headers?: Record<string, string> } | 'abort';
type Handler = Reply | ((req: Request, url: URL) => Reply);
type Routes = Record<string, Handler>;
type Call = { method: string; path: string; search: URLSearchParams; body: Record<string, unknown> | null };

const ALL = ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff', 'purchases'];
const tools = (extra: Record<string, unknown> = {}) => ({ portal: true, stockLedger: true, canSeeCost: true, walkInSales: true, customers: true, reports: true, purchases: true, ...extra });
const me = (extra: Record<string, unknown> = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ALL, approvalStatus: 'approved', accountStatus: 'active', tools: tools(), ...extra,
});
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };
const STAFF = { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' };

const eatToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const TODAY = eatToday();
const EAT_DAY_START = Date.parse(`${TODAY}T00:00:00+03:00`);
const NOW = new Date(Math.max(Date.now() - 60_000, EAT_DAY_START)).toISOString();
const zero = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };

const products = [
  { id: 'prd_whey', vendorId: 'usr_vendor', name: 'Whey 1kg', priceTzs: 15000, stock: 3, status: 'active', costTzs: 9000, reorderLevel: 5, variants: [] },
  { id: 'prd_tee', vendorId: 'usr_vendor', name: 'Gym tee', priceTzs: 20000, stock: 6, status: 'active', costTzs: 8000, variants: [
    { name: 'S', stock: 2, costTzs: null, effectiveCostTzs: 8000 }, { name: 'M', stock: 1, costTzs: 7500, effectiveCostTzs: 7500 }, { name: 'L', stock: 3, costTzs: null, effectiveCostTzs: 8000 },
  ] },
  { id: 'prd_bar', vendorId: 'usr_vendor', name: 'Protein bar', priceTzs: 3000, stock: 0, status: 'paused', costTzs: null, variants: [] },
  { id: 'prd_old', vendorId: 'usr_vendor', name: 'Old shaker', priceTzs: 5000, stock: 0, status: 'archived', costTzs: null, variants: [] },
];
const supplierRow = (extra: Record<string, unknown> = {}) => ({ id: 'vsp_juma', name: 'Juma Supplies', phone: '+255712345678', contactPerson: 'Juma', owedTzs: 150000, overdueTzs: 50000, nextDueDate: addDays(TODAY, -3), lastReceivedOn: TODAY, archived: false, ...extra });
const supplierProfile = (extra: Record<string, unknown> = {}, sup: Record<string, unknown> = {}) => ({
  supplier: { id: 'vsp_juma', name: 'Juma Supplies', phone: '+255712345678', email: null, contactPerson: 'Juma', address: 'Kariakoo', tin: null, note: null, archivedAt: null, createdAt: NOW, updatedAt: NOW, ...sup },
  totals: { purchasedTzs: 200000, purchaseCount: 1, paidTzs: 50000, lastReceivedOn: TODAY },
  owedTzs: 150000, overdueTzs: 50000, aging: { ...zero, current: 100000, d1_30: 50000 }, asOf: TODAY,
  openInstalments: [{ purchaseId: 'vpo_1', number: 'GRN-000001', seq: 2, dueDate: addDays(TODAY, -3), openTzs: 50000, daysOverdue: 3 }],
  ...extra,
});
const inst = (seq: number, extra: Record<string, unknown> = {}) => ({ id: `vpi_${seq}`, seq, dueDate: addDays(TODAY, 30 * (seq - 1)), amountTzs: 50000, coveredTzs: 0, openTzs: 50000, state: 'due', daysOverdue: 0, ...extra });
const pay = (extra: Record<string, unknown> = {}) => ({
  id: 'vpp_1', amountTzs: 50000, paidOn: TODAY, method: 'mpesa', reference: 'QK12AB34', note: null, atReceipt: true,
  recordedBy: { id: 'usr_vendor', name: 'Rehema' }, recordedAt: NOW, status: 'recorded', voidedBy: null, voidedAt: null, voidReason: null, voidedWithPurchase: false, ...extra,
});
const purchase = (extra: Record<string, unknown> = {}) => ({
  id: 'vpo_1', number: 'GRN-000001', status: 'received', supplier: { id: 'vsp_juma', name: 'Juma Supplies', archived: false },
  receivedOn: TODAY, recordedAt: NOW, supplierInvoiceRef: 'INV-4471', note: 'Back door', createdBy: { id: 'usr_vendor', name: 'Rehema' },
  totalTzs: 200000, paidTzs: 50000, balanceTzs: 150000, overdueTzs: 0, paymentState: 'part_paid', nextDue: { dueDate: addDays(TODAY, 30), openTzs: 50000, daysOverdue: 0 },
  lines: [{ id: 'vpl_1', productId: 'prd_whey', variant: null, nameSnapshot: 'Whey 1kg', qty: 20, unitCostTzs: 10000, lineTotalTzs: 200000, costUpdated: true, free: false, previousCostTzs: 9000, costRestoredOnVoid: null }],
  instalments: [inst(1, { dueDate: TODAY, coveredTzs: 50000, openTzs: 0, state: 'paid', daysOverdue: 0 }), inst(2), inst(3), inst(4)],
  payments: [pay()], voidedBy: null, voidedAt: null, voidReason: null, ...extra,
});
const row = (extra: Record<string, unknown> = {}) => ({
  id: 'vpo_1', number: 'GRN-000001', status: 'received', receivedOn: TODAY, recordedAt: NOW, supplier: { id: 'vsp_juma', name: 'Juma Supplies' },
  totalTzs: 200000, paidTzs: 50000, balanceTzs: 150000, overdueTzs: 0, paymentState: 'part_paid', nextDueDate: addDays(TODAY, 30), lineCount: 1, units: 20, createdBy: { id: 'usr_vendor', name: 'Rehema' }, ...extra,
});
const aging = (extra: Record<string, unknown> = {}) => ({
  asOf: TODAY,
  totals: { owedTzs: 150000, overdueTzs: 50000, supplierCount: 1, overdueSupplierCount: 1, dueIn7DaysTzs: 20000, current: 100000, d1_30: 50000, d31_60: 0, d61_90: 0, d90plus: 0 },
  rows: [{ supplierId: 'vsp_juma', name: 'Juma Supplies', owedTzs: 150000, overdueTzs: 50000, oldestDueDate: addDays(TODAY, -3), maxDaysOverdue: 3, current: 100000, d1_30: 50000, d31_60: 0, d61_90: 0, d90plus: 0 }],
  nextCursor: null, ...extra,
});

async function signedInAs(page: Page, user: Record<string, unknown>, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
    const w = window as unknown as { __copied: string | null };
    w.__copied = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { w.__copied = text; } } });
  }, [user, locale] as const);
}

async function mockApi(page: Page, routes: Routes) {
  const calls: Call[] & { outside: string[] } = Object.assign([] as Call[], { outside: [] as string[] });
  const ctx = page.context();
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => { calls.outside.push(route.request().url()); return route.abort(); });
  await ctx.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body: Record<string, unknown> | null = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, search: url.searchParams, body });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req, url) : hit;
    if (reply === 'abort') return route.abort('internetdisconnected');
    if (reply.body != null) return route.fulfill({ status: reply.status ?? 200, body: reply.body, contentType: reply.contentType ?? 'text/csv; charset=utf-8', headers: reply.headers });
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? null, headers: reply.headers });
  });
  return calls;
}
const callsOf = (calls: Call[], method: string, path: string) => calls.filter(c => c.method === method && c.path === path);

const base = (extra: Routes = {}): Routes => ({
  'GET /vendor/me': { json: me() },
  'GET /vendor/products': { json: products },
  'GET /vendor/stock/low': { json: [] },
  'GET /vendor/orders': { json: { orders: [], nextCursor: null } },
  'GET /vendor/payments': { json: { todaySalesTzs: 0, pendingSettlementTzs: 0 } },
  'GET /vendor/statements': { json: { statements: [], payoutReady: true, payoutBlockedBy: null } },
  'GET /vendor/sales': { json: { sales: [], nextCursor: null, summary: { count: 0, totalTzs: 0, voidedCount: 0, byMethod: [] } } },
  'GET /vendor/receivables/aging': { json: { asOf: TODAY, totals: { owedTzs: 0, overdueTzs: 0, customerCount: 0, overdueCustomerCount: 0, openSaleCount: 0, overdueSaleCount: 0, ...zero }, rows: [], nextCursor: null } },
  'GET /vendor/suppliers': { json: { suppliers: [supplierRow()], nextCursor: null } },
  'GET /vendor/suppliers/vsp_juma': { json: supplierProfile() },
  'GET /vendor/purchases': { json: { purchases: [row()], nextCursor: null, summary: { count: 1, totalTzs: 200000, paidTzs: 50000, balanceTzs: 150000, units: 20 } } },
  'GET /vendor/purchases/vpo_1': { json: { purchase: purchase() } },
  'GET /vendor/purchases/last-costs': { json: { rows: [{ productId: 'prd_whey', variant: null, unitCostTzs: 9500, receivedOn: addDays(TODAY, -2), supplierName: 'Juma Supplies', number: 'GRN-000000' }] } },
  'GET /vendor/payables/aging': { json: aging() },
  ...extra,
});

/** Pick a product in line `idx` of Receive stock. */
async function pickProduct(page: Page, idx: number, search: string, id: string) {
  await page.getByTestId(`receive-product-${idx}`).fill(search);
  await page.getByTestId(`product-option-${id}`).click();
}

test.describe('gating and permissions', () => {
  test('tool off: no Purchases nav or tile, and a deep link goes home with no message', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: tools({ purchases: false }) }) } }));
    await page.goto('/vendor/purchases/receive/');
    await expect(page).toHaveURL(/\/vendor\/$/);
    await expect(page.getByRole('link', { name: 'Purchases', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('dash-payables')).toHaveCount(0);
    await expect(page.getByText("You don't have access to purchases. Ask the owner.")).toHaveCount(0);
    expect(calls.filter(c => /^\/vendor\/(suppliers|purchases|payables)/.test(c.path))).toEqual([]);
    expect(calls.outside).toEqual([]);
  });

  test('staff without `purchases`: no nav, a deep link says "no access to purchases"', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'inventory_manager', permissions: ['products'] }) } }));
    await page.goto('/vendor/purchases/');
    await expect(page).toHaveURL(/\/vendor\/$/);
    await expect(page.getByText("You don't have access to purchases. Ask the owner.")).toBeVisible();
    await expect(page.getByRole('link', { name: 'Purchases', exact: true })).toHaveCount(0);
  });

  test('owner: nav item, metric row, list, and the dashboard tile with what is due in 7 days', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto('/vendor/');
    await expect(page.getByTestId('dash-payables-value')).toHaveText('TSh 150,000');
    await expect(page.getByTestId('dash-payables-due')).toHaveText('Due in 7 days: TSh 20,000');
    await expect(page.getByTestId('dash-payables-link')).toHaveAttribute('href', /view=payables/);
    await page.getByRole('link', { name: 'Purchases', exact: true }).click();
    await expect(page.getByTestId('metric-owed')).toHaveText('TSh 150,000');
    await expect(page.getByTestId('metric-due-soon')).toHaveText('TSh 20,000');
    await expect(page.getByTestId('metric-month')).toHaveText('TSh 200,000');
    const table = page.getByTestId('purchases-table');
    await expect(table.getByRole('link', { name: /GRN-000001, Juma Supplies/ })).toBeVisible();
    await expect(table.getByTestId('payment-badge')).toHaveText('Part paid');
  });

  test('suspended vendor staff: GET /vendor/products 403 vendor_suspended shows the banner, Receive stays disabled', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({
      'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'inventory_manager', permissions: ['purchases'] }) },
      'GET /vendor/products': { status: 403, json: { error: 'vendor_suspended' } },
    }));
    await page.goto('/vendor/purchases/receive/');
    await expect(page.getByTestId('receive-add-row')).toBeVisible();
    await expect(page.getByTestId('receive-review')).toBeDisabled();
    await expect(page.getByTestId('receive-product-0')).toBeVisible();
  });
});

test.describe('suppliers', () => {
  test('add a supplier; a duplicate name shows the error and "Open Juma Supplies"', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let n = 0;
    const calls = await mockApi(page, base({
      'POST /vendor/suppliers': () => (++n === 1 ? { status: 409, json: { error: 'duplicate_supplier', supplierId: 'vsp_juma' } }
        : { status: 201, json: { supplier: { id: 'vsp_new', name: 'Kariakoo Traders', phone: null, email: null, contactPerson: null, address: null, tin: null, note: null, archivedAt: null, createdAt: NOW, updatedAt: NOW } } }),
      'GET /vendor/suppliers/vsp_new': { json: supplierProfile({ owedTzs: 0, overdueTzs: 0, aging: zero, openInstalments: [] }, { id: 'vsp_new', name: 'Kariakoo Traders' }) },
    }));
    await page.goto('/vendor/purchases/?view=suppliers');
    await expect(page.getByTestId('suppliers-table').getByRole('link', { name: /Juma Supplies, you owe TSh 150,000/ })).toBeVisible();
    await page.getByTestId('suppliers-add').click();
    await page.getByTestId('supplier-name').fill('juma supplies');
    await page.getByTestId('supplier-save').click();
    await expect(page.getByTestId('supplier-form')).toContainText('You already have a supplier called juma supplies.');
    await expect(page.getByTestId('supplier-open-duplicate')).toHaveText('Open juma supplies');
    await page.getByTestId('supplier-name').fill('Kariakoo Traders');
    await page.getByTestId('supplier-phone').fill('0712 345 678');
    await page.getByTestId('supplier-save').click();
    await expect(page.getByTestId('supplier-heading')).toHaveText('Kariakoo Traders');
    expect(callsOf(calls, 'POST', '/vendor/suppliers')[1].body).toMatchObject({ name: 'Kariakoo Traders', phone: '0712 345 678' });
  });

  test('profile: archive disabled while owed; archived supplier shows the banner and Restore', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let archived = false;
    const calls = await mockApi(page, base({
      'GET /vendor/suppliers/vsp_juma': () => ({ json: archived ? supplierProfile({ owedTzs: 0, overdueTzs: 0, aging: zero, openInstalments: [] }, { archivedAt: NOW }) : supplierProfile() }),
      'PUT /vendor/suppliers/vsp_juma': () => { archived = false; return { json: { supplier: {} } }; },
    }));
    await page.goto('/vendor/purchases/?supplier=vsp_juma');
    await expect(page.getByTestId('supplier-heading')).toBeFocused();
    await expect(page.getByTestId('supplier-archive')).toBeDisabled();
    await expect(page.getByTestId('supplier-archive-owes')).toHaveText("You still owe TSh 150,000, so they can't be archived.");
    await expect(page.getByTestId('supplier-call')).toHaveAttribute('aria-label', 'Call Juma Supplies');
    await expect(page.getByTestId('supplier-bought')).toHaveText('Bought TSh 200,000 in 1 deliveries · paid TSh 50,000');
    await expect(page.getByTestId('supplier-receive')).toHaveAttribute('href', /receive\/\?supplier=vsp_juma/);
    archived = true;
    await page.reload();
    await expect(page.getByTestId('supplier-archived-banner')).toContainText('Archived. Restore to receive stock from them.');
    await expect(page.getByTestId('supplier-receive')).toHaveCount(0);
    await page.getByTestId('supplier-restore').click();
    await expect(page.getByText('Supplier restored')).toBeVisible();
    expect(callsOf(calls, 'PUT', '/vendor/suppliers/vsp_juma')[0].body).toEqual({ archived: false });
  });
});

test.describe('receive stock', () => {
  test('variant required, cost notices, last cost, part payment split evenly, confirm → the GRN', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'POST /vendor/purchases': { status: 201, json: { purchase: purchase({ id: 'vpo_9', number: 'GRN-000009' }), costChanges: [] } },
      'GET /vendor/purchases/vpo_9': { json: { purchase: purchase({ id: 'vpo_9', number: 'GRN-000009' }) } },
    }));
    await page.goto('/vendor/purchases/receive/?supplier=vsp_juma');
    await expect(page.getByTestId('receive-supplier-chosen')).toContainText('Juma Supplies');
    await expect(page.getByTestId('receive-supplier-chosen')).toContainText('You already owe TSh 150,000');
    // Line 1: whey, last cost 9,500 prefilled; owner sees "from 9,000 to 9,500".
    await pickProduct(page, 0, 'whey', 'prd_whey');
    await expect(page.getByTestId('receive-cost-0')).toHaveValue('9500');
    await expect(page.getByTestId('receive-cost-notice-0')).toHaveText('Cost price will change from TSh 9,000 to TSh 9,500.');
    await page.getByTestId('receive-qty-0').fill('10');
    await expect(page.getByTestId('receive-stock-0')).toHaveText('Stock 3 → 13');
    await expect(page.getByText('Last time: TSh 9,500 from Juma Supplies')).toBeVisible();
    // Line 2: tracked variants need a variant; M has its own cost (7,500); 0 = free.
    await page.getByTestId('receive-add-row').click();
    await pickProduct(page, 1, 'tee', 'prd_tee');
    await expect(page.getByTestId('receive-variant-1')).toBeFocused();
    await page.getByTestId('receive-review').click();
    await expect(page.getByTestId('receive-line-error-1')).toHaveText('Choose a variant');
    await page.getByTestId('receive-variant-1').selectOption('M');
    await page.getByTestId('receive-cost-1').fill('0');
    await expect(page.getByTestId('receive-cost-notice-1')).toHaveText('Free: cost price stays as it is.');
    await page.getByTestId('receive-qty-1').fill('4');
    await expect(page.getByTestId('receive-stock-1')).toHaveText('Stock 1 → 5');
    // Adding whey again merges into line 1 (one line per product).
    await page.getByTestId('receive-add-row').click();
    await pickProduct(page, 2, 'whey', 'prd_whey');
    await expect(page.getByTestId('receive-qty-0')).toHaveValue('11');
    await expect(page.getByTestId('receive-line-2')).toHaveCount(0);
    await page.getByTestId('receive-qty-0').fill('20');
    await page.getByTestId('receive-cost-0').fill('10000');
    await expect(page.getByTestId('receive-total')).toHaveText('TSh 200,000');
    // Supplier chosen → defaults to Not paid yet. Paid part 50,000 by M-Pesa (reference), the rest in 3 monthly instalments.
    await page.getByRole('button', { name: 'Paid part' }).click();
    await page.getByTestId('receive-paid-now').fill('50000');
    await page.getByTestId('receive-method-mpesa').click();
    await expect(page.getByTestId('receive-missing')).toHaveText('Enter the transaction reference.');
    await page.getByTestId('receive-reference').fill('qk12ab34');
    await expect(page.getByTestId('receive-left')).toHaveText('Left to pay TSh 150,000');
    await page.getByTestId('receive-split').click();
    await page.getByTestId('receive-plan-count').selectOption('3');
    await expect(page.getByTestId('receive-plan-amount-0')).toHaveValue('50000');
    await expect(page.getByTestId('receive-plan-sum')).toHaveText('Instalments add up to TSh 150,000 of TSh 150,000');
    await page.getByTestId('receive-plan-amount-2').fill('40000');
    await expect(page.getByTestId('receive-missing')).toHaveText('Instalments must add up to TSh 150,000.');
    await page.getByTestId('receive-plan-even').click();
    await expect(page.getByTestId('receive-missing')).toHaveCount(0);
    await expect(page.getByTestId('purchases-money-notice')).toContainText('FitFlex does not pay suppliers.');
    await page.getByTestId('receive-review').click();
    const confirm = page.getByTestId('receive-confirm');
    await expect(confirm.getByRole('heading')).toHaveText('Receive 24 items from Juma Supplies?');
    await expect(confirm).toContainText('3 instalments:');
    await expect(confirm).toContainText('Cost price changes for 1 items');
    await page.getByTestId('receive-confirm-save').click();
    await expect(page).toHaveURL(/\/vendor\/purchases\/\?id=vpo_9/);
    await expect(page.getByText('Stock received: GRN-000009')).toBeVisible();
    await expect(page.getByTestId('purchase-heading')).toBeFocused();
    const sent = callsOf(calls, 'POST', '/vendor/purchases')[0].body!;
    expect(sent).toMatchObject({
      supplierId: 'vsp_juma', receivedOn: TODAY,
      lines: [{ productId: 'prd_whey', qty: 20, unitCostTzs: 10000 }, { productId: 'prd_tee', variant: 'M', qty: 4, unitCostTzs: 0 }],
      paidNow: { amountTzs: 50000, method: 'mpesa', reference: 'QK12AB34' },
    });
    expect((sent.schedule as Array<{ amountTzs: number }>).map(r => r.amountTzs)).toEqual([50000, 50000, 50000]);
    expect(sent.dueDate).toBeUndefined();
    expect(String(sent.clientRef)).toMatch(/^[A-Za-z0-9._:-]{8,100}$/);
    expect(String(sent.clientRef).endsWith(':paid')).toBe(false);
    expect(sent.totalTzs).toBeUndefined();
  });

  test('no supplier: Not paid yet needs a supplier; network failure retries with the same clientRef; staff without canSeeCost see "will be set"', async ({ page }) => {
    await signedInAs(page, STAFF);
    let n = 0;
    const calls = await mockApi(page, base({
      'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'inventory_manager', permissions: ['purchases'], tools: tools({ canSeeCost: false }) }) },
      'GET /vendor/products': { json: products.map(p => ({ ...p, costTzs: undefined })) },
      'GET /vendor/purchases/last-costs': { json: { rows: [] } },
      'POST /vendor/purchases': () => (++n === 1 ? 'abort' : { status: 201, json: { purchase: purchase({ id: 'vpo_2', number: 'GRN-000002', supplier: null }), costChanges: [] } }),
      'GET /vendor/purchases/vpo_2': { json: { purchase: purchase({ id: 'vpo_2', number: 'GRN-000002', supplier: null }) } },
    }));
    await page.goto('/vendor/purchases/receive/');
    await pickProduct(page, 0, 'whey', 'prd_whey');
    await page.getByTestId('receive-cost-0').fill('9500');
    await expect(page.getByTestId('receive-cost-notice-0')).toHaveText('Cost price will be set to TSh 9,500.');
    await page.getByRole('button', { name: 'Not paid yet' }).click();
    await expect(page.getByTestId('receive-missing')).toHaveText('Choose a supplier, or mark it paid in full.');
    await page.getByRole('button', { name: 'Paid in full' }).click();
    await page.getByTestId('receive-supplier-search').click();
    await page.getByTestId('supplier-option-none').click();
    await expect(page.getByTestId('receive-no-supplier')).toContainText('Only if you paid in full');
    await page.getByTestId('receive-review').click();
    await expect(page.getByTestId('receive-confirm').getByRole('heading')).toHaveText('Receive 1 items?');
    await page.getByTestId('receive-confirm-save').click();
    await expect(page.getByTestId('receive-confirm-alert')).toContainText('Could not save. Nothing was changed.');
    await expect(page.getByTestId('receive-confirm-save')).toHaveText('Try again');
    await page.getByTestId('receive-confirm-save').click();
    await expect(page).toHaveURL(/\?id=vpo_2/);
    const [a, b] = callsOf(calls, 'POST', '/vendor/purchases');
    expect(a.body!.clientRef).toBe(b.body!.clientRef);
    expect(b.body!.supplierId).toBeUndefined();
    expect(b.body!.paidNow).toEqual({ amountTzs: 9500, method: 'cash' });
  });

  test('refusals: a removed product marks its line; an archived supplier marks the supplier', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let n = 0;
    await mockApi(page, base({
      'POST /vendor/purchases': () => (++n === 1 ? { status: 400, json: { error: 'product_unavailable', productId: 'prd_whey' } } : { status: 409, json: { error: 'supplier_archived', supplierId: 'vsp_juma' } }),
    }));
    await page.goto('/vendor/purchases/receive/?supplier=vsp_juma');
    await expect(page.getByTestId('receive-supplier-chosen')).toBeVisible();
    await pickProduct(page, 0, 'whey', 'prd_whey');
    await page.getByRole('button', { name: 'Paid in full' }).click();
    await page.getByTestId('receive-review').click();
    await page.getByTestId('receive-confirm-save').click();
    await expect(page.getByTestId('receive-line-error-0')).toHaveText("Whey 1kg can't be received any more. Remove it.");
    await page.getByTestId('receive-review').click();
    await page.getByTestId('receive-confirm-save').click();
    await expect(page.getByTestId('receive-supplier-error')).toHaveText('Juma Supplies is archived. Choose another supplier or restore them.');
  });

  test('draft: kept after a reload, offered back, and removed on sign-out', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto('/vendor/purchases/receive/');
    await pickProduct(page, 0, 'whey', 'prd_whey');
    await page.getByTestId('receive-qty-0').fill('7');
    await expect(page.getByTestId('receive-draft-saved')).toBeVisible();
    await page.waitForTimeout(700);
    page.on('dialog', d => d.accept());
    await page.reload();
    await expect(page.getByTestId('receive-draft-offer')).toContainText('You have an unfinished delivery from');
    await page.getByTestId('receive-draft-continue').click();
    await expect(page.getByTestId('receive-qty-0')).toHaveValue('7');
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fitflex.vendor.purchaseDraft.')).length)).toBe(1);
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fitflex.vendor.purchaseDraft.')).length)).toBe(0);
  });

  test('375px: no horizontal scroll; the leave dialog keeps or discards the draft', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto('/vendor/purchases/receive/?supplier=vsp_juma');
    await pickProduct(page, 0, 'tee', 'prd_tee');
    await page.getByTestId('receive-variant-0').selectOption('S');
    await page.getByRole('button', { name: 'Paid part' }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('receive-review')).toBeInViewport();
    await page.getByTestId('receive-close').click();
    await expect(page.getByTestId('receive-leave')).toBeVisible();
    await page.getByTestId('receive-leave-discard').click();
    await expect(page).toHaveURL(/\/vendor\/purchases\/$/);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fitflex.vendor.purchaseDraft.')).length)).toBe(0);
  });
});

test.describe('purchase detail', () => {
  test('record a payment: coverage preview, overpayment with the fresh balance, then saved', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let n = 0;
    const after = purchase({ paidTzs: 120000, balanceTzs: 80000, payments: [pay(), pay({ id: 'vpp_2', amountTzs: 70000, atReceipt: false, method: 'cash', reference: null })],
      instalments: [inst(1, { dueDate: TODAY, coveredTzs: 50000, openTzs: 0, state: 'paid', daysOverdue: 0 }), inst(2, { coveredTzs: 50000, openTzs: 0, state: 'paid' }), inst(3, { coveredTzs: 20000, openTzs: 30000, state: 'part_paid' }), inst(4)] });
    const calls = await mockApi(page, base({
      'POST /vendor/purchases/vpo_1/payments': () => (++n === 1 ? { status: 409, json: { error: 'overpayment', balanceTzs: 140000 } } : { status: 201, json: { purchase: after, payment: pay({ id: 'vpp_2' }), covered: [] } }),
    }));
    await page.goto('/vendor/purchases/?id=vpo_1');
    await expect(page.getByTestId('purchase-heading')).toHaveText('Stock received GRN-000001');
    await expect(page.getByTestId('instalment-1-state')).toHaveText('Paid');
    await expect(page.getByTestId('instalment-2-state')).toHaveText('Due in 30 days');
    await expect(page.getByTestId('purchase-lines')).toContainText('Cost price updated (was TSh 9,000)');
    await page.getByTestId('purchase-record-payment').click();
    const dialog = page.getByTestId('purchase-pay-dialog');
    await expect(dialog.getByRole('heading')).toHaveText('Record payment to Juma Supplies');
    await expect(page.getByTestId('purchase-pay-amount')).toHaveValue('50000');
    await page.getByTestId('purchase-pay-amount').fill('70000');
    await expect(page.getByTestId('purchase-pay-covers')).toHaveText(/Covers instalment 2 \(.+\) and TSh 20,000 of instalment 3/);
    await expect(dialog.getByTestId('purchases-money-notice')).toBeVisible();
    await page.getByTestId('purchase-pay-save').click();
    await expect(dialog).toContainText('That is more than is owed (TSh 140,000).');
    await page.getByTestId('purchase-pay-save').click();
    await expect(page.getByText('Payment saved: TSh 70,000')).toBeVisible();
    await expect(page.getByTestId('purchase-balance')).toHaveText('TSh 80,000');
    await expect(page.getByTestId('instalment-3-state')).toHaveText('TSh 20,000 of TSh 50,000 paid');
    await expect(page.getByTestId('purchase-payments-heading')).toBeFocused();
    const [a, b] = callsOf(calls, 'POST', '/vendor/purchases/vpo_1/payments');
    expect(a.body).toMatchObject({ amountTzs: 70000, method: 'cash', paidOn: TODAY });
    expect(a.body!.clientRef).not.toBe(b.body!.clientRef);
  });

  test('void a payment with a reason; change instalments sends a schedule adding up to the balance', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'POST /vendor/purchases/vpo_1/payments/vpp_1/void': { json: { purchase: purchase({ paidTzs: 0, balanceTzs: 200000, payments: [pay({ status: 'voided', voidedBy: { id: 'usr_vendor', name: 'Rehema' }, voidedAt: NOW, voidReason: 'Recorded twice' })] }) } },
      'PUT /vendor/purchases/vpo_1/instalments': { json: { purchase: purchase() } },
    }));
    await page.goto('/vendor/purchases/?id=vpo_1');
    await page.getByTestId('purchase-change-plan').click();
    await expect(page.getByTestId('plan-kept')).toContainText('Instalment 1');
    await page.getByTestId('change-plan-count').selectOption('2');
    await expect(page.getByTestId('change-plan-sum')).toHaveText('Instalments add up to TSh 150,000 of TSh 150,000');
    await page.getByTestId('purchase-plan-save').click();
    await expect(page.getByText('Instalments updated')).toBeVisible();
    const sched = callsOf(calls, 'PUT', '/vendor/purchases/vpo_1/instalments')[0].body!.schedule as Array<{ amountTzs: number }>;
    expect(sched.map(r => r.amountTzs)).toEqual([75000, 75000]);
    await page.getByTestId('payment-void-vpp_1').click();
    const dialog = page.getByTestId('payment-void-dialog');
    await expect(dialog).toContainText('The amount is owed again.');
    await expect(page.getByTestId('payment-void-confirm')).toBeDisabled();
    await page.getByTestId('payment-void-reason').fill('Recorded twice');
    await page.getByTestId('payment-void-confirm').click();
    await expect(page.getByTestId('payment-vpp_1')).toContainText('Voided');
    await expect(page.getByTestId('payment-vpp_1')).toContainText('Recorded twice');
  });

  test('void: insufficient_stock lists the short lines with Count stock; has_others_payments; then voided with cost put back', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let n = 0;
    const voided = purchase({ status: 'voided', voidedBy: { id: 'usr_vendor', name: 'Rehema' }, voidedAt: NOW, voidReason: 'Wrong delivery', paymentState: 'part_paid',
      lines: [{ ...purchase().lines[0], costRestoredOnVoid: true }], payments: [pay({ status: 'voided', voidedWithPurchase: true, voidReason: 'Wrong delivery', voidedAt: NOW })] });
    const calls = await mockApi(page, base({
      'POST /vendor/purchases/vpo_1/void': () => {
        n += 1;
        if (n === 1) return { status: 409, json: { error: 'insufficient_stock', lines: [{ productId: 'prd_whey', variant: null, name: 'Whey 1kg', receivedQty: 20, available: 4 }] } };
        if (n === 2) return { status: 409, json: { error: 'void_not_allowed', reason: 'has_others_payments' } };
        return { json: { purchase: voided, costRestored: [{ productId: 'prd_whey', variant: null, name: 'Whey 1kg' }], costKept: [], paymentsVoided: 1 } };
      },
    }));
    await page.goto('/vendor/purchases/?id=vpo_1');
    await page.getByTestId('purchase-void').click();
    const dialog = page.getByTestId('purchase-void-dialog');
    await expect(dialog.getByRole('heading')).toHaveText('Void GRN-000001?');
    await expect(page.getByTestId('void-payments-note')).toHaveText('The 1 payments recorded on it (TSh 50,000) are voided too. Get any money back from the supplier yourself.');
    await expect(page.getByTestId('void-cost-note')).toBeVisible();
    await page.getByTestId('purchase-void-reason').fill('Wrong delivery');
    await page.getByTestId('purchase-void-confirm').click();
    await expect(page.getByTestId('void-insufficient')).toContainText('Whey 1kg: received 20, in stock 4');
    await page.getByTestId('void-count-prd_whey').click();
    await expect(page.getByTestId('adjust-stock-dialog')).toBeVisible();
    await expect(page.getByTestId('adjust-purchases-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.getByTestId('purchase-void-confirm').click();
    await expect(page.getByTestId('purchase-void-alert')).toHaveText('Ask the owner or an admin to void this; it has payments recorded by someone else.');
    await page.getByTestId('purchase-void-confirm').click();
    await expect(page.getByText('GRN-000001 voided').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByTestId('purchase-voided-banner')).toContainText('Voided by Rehema');
    await expect(page.getByTestId('purchase-lines')).toContainText('Cost price put back');
    await expect(page.getByTestId('purchase-record-payment')).toHaveCount(0);
    expect(callsOf(calls, 'POST', '/vendor/purchases/vpo_1/void')[0].body).toEqual({ reason: 'Wrong delivery' });
  });

  test('payment void on an archived supplier: its own message', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'POST /vendor/purchases/vpo_1/payments/vpp_1/void': { status: 409, json: { error: 'supplier_archived', supplierId: 'vsp_juma' } } }));
    await page.goto('/vendor/purchases/?id=vpo_1');
    await expect(page.getByTestId('instalment-2-state')).toHaveText('Due in 30 days');
    await page.getByTestId('payment-void-vpp_1').click();
    await page.getByTestId('payment-void-reason').fill('Recorded twice');
    await page.getByTestId('payment-void-confirm').click();
    await expect(page.getByTestId('payment-void-alert')).toHaveText('This supplier is archived. Restore them before changing payments.');
  });

  test('M2: other staff see "Only the owner or an admin can void this." on someone else\'s purchase', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'inventory_manager', permissions: ['purchases'], tools: tools({ canSeeCost: false }) }) } }));
    await page.goto('/vendor/purchases/?id=vpo_1');
    await expect(page.getByTestId('purchase-ask-owner')).toHaveText('Only the owner or an admin can void this.');
    await expect(page.getByTestId('purchase-void')).toHaveCount(0);
    await expect(page.getByTestId('payment-void-vpp_1')).toHaveCount(0);
    await expect(page.getByTestId('purchase-lines')).toContainText('Cost price updated');
    await expect(page.getByTestId('purchase-lines')).not.toContainText('was TSh');
  });

  test('copy as text: no previous cost, note or recorder; Escape closes a dialog and returns focus', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto('/vendor/purchases/?id=vpo_1');
    await page.getByTestId('purchase-copy').click();
    const text = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(text).toContain('Stock received GRN-000001');
    expect(text).toContain('Supplier invoice: INV-4471');
    expect(text).toContain('From Juma Supplies');
    expect(text).toContain('This is not a TRA fiscal receipt.');
    expect(text).not.toContain('9,000');
    expect(text).not.toContain('Back door');
    expect(text).not.toContain('Rehema');
    await page.getByTestId('purchase-record-payment').click();
    await expect(page.getByTestId('purchase-pay-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('purchase-pay-dialog')).toHaveCount(0);
    await expect(page.getByTestId('purchase-record-payment')).toBeFocused();
  });
});

test.describe('owed to suppliers, history, reports, Swahili', () => {
  test('payables: tiles, bucket filter, sort with aria-sort, CSV export', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'GET /vendor/payables/aging': (_req, url) => (url.searchParams.get('format') === 'csv'
        ? { body: 'Supplier,Total (TZS)\nJuma Supplies,150000\n', headers: { 'content-disposition': 'attachment; filename="dar_payables.csv"', 'access-control-expose-headers': 'Content-Disposition' } }
        : { json: aging() }),
    }));
    await page.goto('/vendor/purchases/?view=payables');
    await expect(page.getByTestId('payables-total')).toHaveText('TSh 150,000');
    await expect(page.getByTestId('payables-due-soon')).toHaveText('TSh 20,000');
    await expect(page.getByTestId('payables-totals-row')).toContainText('TSh 150,000');
    await page.getByTestId('payables-bucket-d1_30').click();
    await expect(page.getByTestId('payables-bucket-d1_30')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => calls.some(c => c.path === '/vendor/payables/aging' && c.search.get('bucket') === 'd1_30')).toBe(true);
    await page.getByTestId('payables-sort-owed').click();
    await expect(page.getByTestId('payables-sort-owed').locator('xpath=..')).toHaveAttribute('aria-sort', 'descending');
    const download = page.waitForEvent('download');
    await page.getByTestId('payables-export').click();
    expect((await download).suggestedFilename()).toBe('dar_payables.csv');
    const csv = calls.find(c => c.search.get('format') === 'csv')!;
    expect(csv.search.get('lang')).toBe('en');
  });

  test('stock history: Received from supplier links to the GRN; without `purchases` it is plain text', async ({ page }) => {
    const history = { productId: 'prd_whey', variant: null, openingStock: 3, closingStock: 3, nextCursor: null, rows: [
      { id: 'mv_2', productId: 'prd_whey', variant: null, reason: 'stock_in_void', kind: 'stock_in_void', delta: -10, stockBefore: 13, stockAfter: 3, note: 'GRN-000001', actor: { id: 'usr_vendor', name: 'Rehema' }, document: { type: 'purchase', id: 'vpo_1', number: 'GRN-000001' }, createdAt: NOW },
      { id: 'mv_3', productId: 'prd_whey', variant: null, reason: 'sale_void', kind: 'sale_void', delta: 1, stockBefore: 2, stockAfter: 3, note: 'variant_gone', actor: null, document: null, createdAt: NOW },
      { id: 'mv_1', productId: 'prd_whey', variant: null, reason: 'stock_in', kind: 'stock_in', delta: 10, stockBefore: 3, stockAfter: 13, note: 'GRN-000001', actor: { id: 'usr_vendor', name: 'Rehema' }, document: { type: 'purchase', id: 'vpo_1', number: 'GRN-000001' }, createdAt: NOW },
    ] };
    await signedInAs(page, VENDOR);
    let purchasesOn = true;
    await mockApi(page, base({
      'GET /vendor/me': () => ({ json: me({ tools: tools({ purchases: purchasesOn }) }) }),
      'GET /vendor/products/prd_whey/stock-movements': { json: history },
    }));
    await page.goto('/vendor/products/history/?id=prd_whey');
    await expect(page.getByText('Received from supplier').first()).toBeVisible();
    await expect(page.getByText('Delivery voided, out of stock again').first()).toBeVisible();
    await expect(page.getByText('This option no longer exists').first()).toBeVisible();
    await expect(page.getByText('variant_gone')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Delivery GRN-000001' }).first()).toHaveAttribute('href', /\/vendor\/purchases\/\?id=vpo_1/);
    purchasesOn = false;
    await page.reload();
    await expect(page.getByText('Received from supplier').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Delivery GRN-000001' })).toHaveCount(0);
    await expect(page.getByText('Delivery GRN-000001').first()).toBeVisible();
  });

  test('Payment methods: "Paid to suppliers (by you)" as its own group, only with `purchases`', async ({ page }) => {
    const head = { from: `${TODAY.slice(0, 7)}-01`, to: TODAY, channel: 'all', generatedAt: NOW, timezone: 'Africa/Dar_es_Salaam', inProgress: true, channels: { app: false, walkIn: true } };
    const report = { ...head, byYou: [{ method: 'cash', amountTzs: 20000, count: 1, sharePct: 100 }], viaFitFlex: [], paidBack: [], paidToSuppliers: [{ method: 'mpesa', amountTzs: 50000, count: 1 }] };
    await signedInAs(page, VENDOR);
    let perms = ALL;
    await mockApi(page, base({
      'GET /vendor/me': () => ({ json: me({ permissions: perms }) }),
      'GET /vendor/reports/payment-methods': { json: report },
    }));
    await page.goto('/vendor/reports/?view=methods');
    const group = page.getByTestId('methods-paid-to-suppliers');
    await expect(group).toContainText('Paid to suppliers (by you)');
    await expect(group).toContainText('TSh 50,000');
    await expect(page.getByTestId('methods-you')).toContainText('TSh 20,000');
    await expect(page.getByTestId('methods-payables-link')).toHaveAttribute('href', /view=payables/);
    perms = ALL.filter(p => p !== 'purchases');
    await page.reload();
    await expect(page.getByTestId('methods-you')).toBeVisible();
    await expect(page.getByTestId('methods-paid-to-suppliers')).toHaveCount(0);
  });

  test('Swahili: nav, segments, receive page and money notice', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    await mockApi(page, base());
    await page.goto('/vendor/purchases/');
    await expect(page.getByRole('link', { name: 'Ununuzi', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Madeni kwa wasambazaji' })).toBeVisible();
    await expect(page.getByTestId('purchases-receive')).toHaveText('Pokea Stock');
    await page.goto('/vendor/purchases/receive/?supplier=vsp_juma');
    await pickProduct(page, 0, 'whey', 'prd_whey');
    await expect(page.getByTestId('purchases-money-notice')).toHaveText('FitFlex hailipi wasambazaji. Hapa unarekodi tu ulicholipa na unachodaiwa bado.');
    await expect(page.getByRole('button', { name: 'Bado haijalipwa' })).toBeVisible();
    await expect(page.getByTestId('receive-supplier-chosen')).toContainText('Tayari unadaiwa TSh 150,000');
    await page.getByTestId('receive-add-row').click();
    await pickProduct(page, 1, 'tee', 'prd_tee');
    await expect(page.getByLabel('Chaguo')).toBeVisible();
    await expect(page.getByText('Aina', { exact: true })).toHaveCount(0);
  });
});
