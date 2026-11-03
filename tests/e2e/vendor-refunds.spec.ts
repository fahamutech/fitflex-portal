import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';

// Vendor S7: refunds on walk-in sales in the portal (docs/design/vendor-refunds-s7.md §5, §6, §11, §12), against a
// mocked API (contract: fitflex-functions#318). Gating (tools.refunds, read-only existing refunds), permission
// visibility (owner, admin staff, own-sale staff), the refund dialog (choose → confirm → toast, panel refresh, credit
// note link), 409 refund_exceeds_sold, network retry with the same clientRef, undo with reason and its refusals, Void
// hidden / 409 has_refunds, 375px full-screen dialog, focus and Escape, the Reports Refunds view and Payment methods
// "Paid back by you", the credit-note document view. Nothing may reach a real service.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Reply = { status?: number; json?: unknown; body?: string; contentType?: string; headers?: Record<string, string> } | 'abort';
type Handler = Reply | ((req: Request, url: URL) => Reply);
type Routes = Record<string, Handler>;
type Call = { method: string; path: string; search: URLSearchParams; body: Record<string, unknown> | null };

const ALL = ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff'];
const tools = (extra: Record<string, unknown> = {}) => ({
  portal: true, stockLedger: true, canSeeCost: true, walkInSales: true, customers: true, documents: true, reports: true, refunds: true, ...extra,
});
const me = (extra: Record<string, unknown> = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ALL, approvalStatus: 'approved', accountStatus: 'active', tools: tools(), ...extra,
});
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };
const STAFF = { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' };
const staffMe = (role: string, extra: Record<string, unknown> = {}) => me({ userType: 'vendor_staff', vendorRole: role, permissions: ['sales'], ...extra });

const NOW = new Date(Date.now() - 60_000).toISOString();
const YESTERDAY = new Date(Date.now() - 30 * 3_600_000).toISOString();
const eatToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/** 3 × TSh 3,500 with a TSh 500 line discount (lineNet 10,000) and a shaker; cash. */
const line = (extra: Record<string, unknown> = {}) => ({
  id: 'sln_whey', productId: 'prd_whey', nameSnapshot: 'Whey 1kg', variant: null, qty: 3, listPriceTzs: 3500, unitPriceTzs: 3500, priceChanged: false, priceChangedBy: null,
  discountTzs: 500, lineTotalTzs: 10000, vatTzs: 0, vatCode: null, lineNetTzs: 10000, refundedQty: 0, refundableQty: 3, refundedTzs: 0, ...extra,
});
const shaker = (extra: Record<string, unknown> = {}) => ({
  id: 'sln_shaker', productId: 'prd_shaker', nameSnapshot: 'Shaker', variant: null, qty: 1, listPriceTzs: 10000, unitPriceTzs: 10000, priceChanged: false, priceChangedBy: null,
  discountTzs: 0, lineTotalTzs: 10000, vatTzs: 0, vatCode: null, lineNetTzs: 10000, refundedQty: 0, refundableQty: 1, refundedTzs: 0, ...extra,
});
const sale = (extra: Record<string, unknown> = {}) => ({
  id: 'sale_1', number: 'R-000123', status: 'completed', kind: 'cash', soldAt: NOW, recordedAt: NOW, lateRecorded: false,
  subtotalTzs: 20500, lineDiscountTzs: 500, discountTzs: 0, totalTzs: 20000, paidTzs: 20000, changeTzs: 0, note: null,
  createdBy: { id: 'usr_vendor', name: 'Asha' }, voidedBy: null, voidedAt: null, voidReason: null,
  lines: [line(), shaker()], payments: [{ method: 'cash', amountTzs: 20000, reference: null }],
  refundedTzs: 0, refundableTzs: 20000, netAfterRefundsTzs: 20000, refundState: 'none', balanceReducedTzs: 0, refunds: [],
  ...extra,
});
const refund = (extra: Record<string, unknown> = {}) => ({
  id: 'vrf_1', number: 'CN-000004', status: 'active', saleId: 'sale_1', saleNumber: 'R-000123', saleInvoiceNumber: null, saleKind: 'cash',
  refundedAt: NOW, createdBy: { id: 'usr_vendor', name: 'Asha' }, reason: 'Customer returned it', method: 'cash', reference: null,
  amountTzs: 3333, balanceReducedTzs: 0, paidOutTzs: 3333, vatTzs: 0, vatSummary: [], customer: null,
  lines: [{ saleLineId: 'sln_whey', productId: 'prd_whey', variant: null, nameSnapshot: 'Whey 1kg', qty: 1, unitPriceTzs: 3500, amountTzs: 3333, vatTzs: 0, vatCode: null, restock: true }],
  revertedBy: null, revertedAt: null, revertReason: null, ...extra,
});
/** The sale after refund vrf_1 (1 unit of whey). */
const refundedSale = (status: 'active' | 'reverted' = 'active') => sale(status === 'active' ? {
  refundedTzs: 3333, refundableTzs: 16667, netAfterRefundsTzs: 16667, refundState: 'partial',
  lines: [line({ refundedQty: 1, refundableQty: 2, refundedTzs: 3333 }), shaker()],
  refunds: [{ id: 'vrf_1', number: 'CN-000004', status: 'active', refundedAt: NOW, amountTzs: 3333 }],
} : { refunds: [{ id: 'vrf_1', number: 'CN-000004', status: 'reverted', refundedAt: NOW, amountTzs: 3333 }] });

async function signedInAs(page: Page, user: Record<string, unknown>, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [user, locale] as const);
}

async function mockApi(page: Page, routes: Routes) {
  const calls: Call[] = [];
  const ctx: BrowserContext = page.context();
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => route.abort());
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
    if (reply.body != null) return route.fulfill({ status: reply.status ?? 200, body: reply.body, contentType: reply.contentType ?? 'text/html; charset=utf-8', headers: reply.headers });
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? null, headers: reply.headers });
  });
  return calls;
}
const posts = (calls: Call[], path: string) => calls.filter(c => c.method === 'POST' && c.path === path);

const base = (extra: Routes = {}): Routes => ({
  'GET /vendor/me': { json: me() },
  'GET /vendor/products': { json: [] },
  'GET /vendor/stock/low': { json: [] },
  'GET /vendor/orders': { json: { orders: [], nextCursor: null } },
  'GET /vendor/payments': { json: { todaySalesTzs: 0, pendingSettlementTzs: 0 } },
  'GET /vendor/statements': { json: { statements: [], payoutReady: true, payoutBlockedBy: null } },
  'GET /vendor/receivables/aging': { json: { customers: [], totals: { owedTzs: 0, overdueTzs: 0, customers: 0, overdueCustomers: 0 }, nextCursor: null } },
  'GET /vendor/sales': { json: { sales: [], nextCursor: null, summary: { count: 1, totalTzs: 20000, voidedCount: 0, byMethod: [], refundCount: 1, refundTzs: 3333, netTzs: 16667, refundsByMethod: [] } } },
  'GET /vendor/sales/sale_1': { json: { sale: sale() } },
  'GET /vendor/refunds/vrf_1': { json: { refund: refund() } },
  ...extra,
});
const openSale = (page: Page) => page.goto('/vendor/sales/?id=sale_1');

test.describe('gating', () => {
  test('refunds off: no Refund items, no Undo; refunds already made stay visible read only', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'GET /vendor/me': { json: me({ tools: tools({ refunds: false }) }) },
      'GET /vendor/sales/sale_1': { json: { sale: refundedSale() } },
    }));
    await openSale(page);
    const detail = page.getByTestId('sale-detail');
    await expect(detail.getByText('Part refunded')).toBeVisible();
    await expect(page.getByTestId('sale-refunded')).toHaveText('−TSh 3,333');
    await expect(page.getByTestId('sale-net-after')).toHaveText('TSh 16,667');
    await expect(page.getByTestId('sale-line-0-refunded')).toHaveText('1 refunded');
    await expect(page.getByTestId('sale-refunds')).toBeVisible();
    await expect(page.locator('#refund-card-vrf_1, #refund-row-vrf_1').filter({ visible: true })).toBeVisible();
    await expect(page.getByTestId('sale-refund')).toHaveCount(0);
    await expect(page.getByTestId('refund-undo-vrf_1').filter({ visible: true })).toHaveCount(0);
    // Void is hidden while an active refund exists (it would be 409 has_refunds).
    await expect(page.getByTestId('sale-void')).toHaveCount(0);
    await expect(page.getByTestId('sale-void-has-refunds')).toHaveText("This sale has refunds, so it can't be voided.");
    // The list read is never asked for (it 404s with the flag off); each refund is read by id.
    expect(calls.some(c => c.method === 'GET' && c.path === '/vendor/refunds')).toBe(false);
    expect(calls.some(c => c.method === 'GET' && c.path === '/vendor/refunds/vrf_1')).toBe(true);
  });

  test('walkInSales on but refunds missing from tools fails closed', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const t = tools(); delete (t as Record<string, unknown>).refunds;
    await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: t }) } }));
    await openSale(page);
    await expect(page.getByTestId('sale-heading')).toBeVisible();
    await expect(page.getByTestId('sale-refund')).toHaveCount(0);
    await expect(page.getByTestId('sale-void')).toBeVisible();
  });
});

test.describe('permission visibility (Q-1)', () => {
  test('owner: Refund items on a completed sale; voided and fully refunded sales show none', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let current: unknown = sale();
    await mockApi(page, base({ 'GET /vendor/sales/sale_1': () => ({ json: { sale: current } }) }));
    await openSale(page);
    await expect(page.getByTestId('sale-refund')).toBeVisible();
    await expect(page.getByTestId('sale-refund')).toHaveAccessibleName('Refund items from R-000123');
    const box = await page.getByTestId('sale-refund').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    current = sale({ refundState: 'full', refundedTzs: 20000, netAfterRefundsTzs: 0, lines: [line({ refundedQty: 3, refundableQty: 0, refundedTzs: 10000 }), shaker({ refundedQty: 1, refundableQty: 0, refundedTzs: 10000 })] });
    await page.getByTestId('sale-back').click();
    await openSale(page);
    await expect(page.getByTestId('sale-refund')).toHaveCount(0);
    await expect(page.getByTestId('sale-refund-note')).toHaveText('Everything on this sale has been refunded.');
    await expect(page.getByTestId('sale-detail').getByText('Refunded', { exact: true }).first()).toBeVisible();

    current = sale({ status: 'voided', voidedBy: { id: 'usr_vendor', name: 'Rehema' }, voidedAt: NOW, voidReason: 'Wrong sale' });
    await page.reload();
    await expect(page.getByTestId('sale-voided')).toBeVisible();
    await expect(page.getByTestId('sale-refund')).toHaveCount(0);
    await expect(page.getByTestId('sale-refund-note')).toHaveCount(0);
  });

  test('sales staff: own sale today yes; another person\'s or yesterday\'s sale says only the owner or an admin', async ({ page }) => {
    await signedInAs(page, STAFF);
    let current: unknown = sale({ createdBy: { id: 'usr_staff', name: 'Juma' } });
    await mockApi(page, base({ 'GET /vendor/me': { json: staffMe('sales') }, 'GET /vendor/sales/sale_1': () => ({ json: { sale: current } }) }));
    await openSale(page);
    await expect(page.getByTestId('sale-refund')).toBeVisible();

    current = sale();
    await page.reload();
    await expect(page.getByTestId('sale-heading')).toBeVisible();
    await expect(page.getByTestId('sale-refund')).toHaveCount(0);
    await expect(page.getByTestId('sale-refund-note')).toHaveText('Only the owner or an admin can refund this sale.');

    current = sale({ createdBy: { id: 'usr_staff', name: 'Juma' }, soldAt: YESTERDAY });
    await page.reload();
    await expect(page.getByTestId('sale-refund-note')).toHaveText('Only the owner or an admin can refund this sale.');
  });

  test('admin staff may refund any sale', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({ 'GET /vendor/me': { json: staffMe('admin') }, 'GET /vendor/sales/sale_1': { json: { sale: sale({ soldAt: YESTERDAY }) } } }));
    await openSale(page);
    await expect(page.getByTestId('sale-refund')).toBeVisible();
  });
});

test.describe('refund dialog', () => {
  test('choose → confirm → saved: no amounts sent, toast, panel updates, CN links to the credit note', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let after = false;
    const calls = await mockApi(page, base({
      'GET /vendor/sales/sale_1': () => ({ json: { sale: after ? refundedSale() : sale() } }),
      'POST /vendor/sales/sale_1/refunds': () => { after = true; return { status: 201, json: { refund: refund(), sale: refundedSale() } }; },
    }));
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    await expect(dialog.getByTestId('refund-step-heading')).toHaveText('What is the customer bringing back?');
    // UAT L-10: the dialog (labelled by its title) has focus on open.
    await expect(dialog).toBeFocused();
    await expect(dialog).toHaveAccessibleName('Refund from R-000123');
    await expect(dialog.getByTestId('refund-money-notice')).toHaveText('FitFlex does not handle this money. Give it back to the customer yourself.');
    // Nothing picked yet: Review is disabled and says why.
    await expect(dialog.getByTestId('refund-review')).toBeDisabled();
    await expect(dialog.getByTestId('refund-missing')).toHaveText('Choose at least one item.');

    await dialog.getByRole('button', { name: 'Refund one more Whey 1kg' }).click();
    await expect(dialog.getByTestId('refund-total')).toHaveText('TSh 3,333');
    await expect(dialog.getByTestId('refund-pay-back')).toHaveText('TSh 3,333');
    await expect(dialog.getByRole('switch', { name: 'Put Whey 1kg back in stock' })).toBeChecked();
    await expect(dialog.getByTestId('refund-missing')).toHaveText('Say why you are refunding.');
    await dialog.getByTestId('refund-reason-returned').click();
    await expect(dialog.getByTestId('refund-reason')).toHaveValue('Customer returned it');
    // Default method = the sale's first payment method (cash: no reference).
    await expect(dialog.getByTestId('refund-method-cash')).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByTestId('refund-review')).toHaveText('Review refund TSh 3,333');
    await dialog.getByTestId('refund-review').click();

    await expect(dialog.getByTestId('refund-step-heading')).toHaveText('Refund TSh 3,333 from R-000123?');
    await expect(dialog.getByTestId('refund-step-heading')).toBeFocused();
    await expect(dialog.getByTestId('refund-confirm-lines')).toContainText('1 × Whey 1kg · TSh 3,333 · Back in stock');
    await expect(dialog.getByTestId('refund-money-notice')).toBeVisible();
    await dialog.getByTestId('refund-confirm-button').click();

    await expect(page.getByText('Refund saved: CN-000004')).toBeVisible();
    await expect(page.getByTestId('refund-dialog')).toHaveCount(0);
    const [post] = posts(calls, '/vendor/sales/sale_1/refunds');
    expect(post.body).toMatchObject({ lines: [{ saleLineId: 'sln_whey', qty: 1, restock: true }], reason: 'Customer returned it', method: 'cash' });
    expect(String(post.body?.clientRef)).toMatch(/^[A-Za-z0-9._:-]{8,100}$/);
    expect(JSON.stringify(post.body)).not.toMatch(/Tzs|amount/i);
    await expect(page.getByTestId('sale-net-after')).toHaveText('TSh 16,667');
    const doc = page.getByTestId('refund-doc-vrf_1').filter({ visible: true });
    await expect(doc).toHaveAttribute('href', /\/vendor\/documents\/\?type=credit_note&id=vrf_1&sale=sale_1/);
    // §3.3: focus moves to the new row.
    await expect(page.locator('#refund-card-vrf_1, #refund-row-vrf_1').filter({ visible: true })).toBeFocused();
  });

  test('network loss at Confirm keeps the dialog with Try again, which reuses the same clientRef', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let n = 0;
    const calls = await mockApi(page, base({
      'POST /vendor/sales/sale_1/refunds': () => {
        n += 1;
        if (n === 1) return 'abort';
        if (n === 2) return { status: 201, json: { refund: refund(), sale: refundedSale() } };
        return { status: 500, json: {} };
      },
    }));
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    await dialog.getByTestId('refund-inc-sln_whey').filter({ visible: true }).click();
    await dialog.getByTestId('refund-reason-faulty').click();
    await dialog.getByTestId('refund-review').click();
    await dialog.getByTestId('refund-confirm-button').click();
    await expect(dialog.getByTestId('refund-banner')).toHaveText("We couldn't confirm the refund. Try again — it won't be made twice.");
    await expect(dialog.getByTestId('refund-confirm-button')).toHaveText('Try again');
    await dialog.getByTestId('refund-confirm-button').click();
    await expect(page.getByText('Refund saved: CN-000004')).toBeVisible();
    const sent = posts(calls, '/vendor/sales/sale_1/refunds');
    expect(sent).toHaveLength(2);
    expect(sent[0].body?.clientRef).toBe(sent[1].body?.clientRef);
  });

  test('409 refund_exceeds_sold clamps the picks, highlights the line and moves focus there', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'POST /vendor/sales/sale_1/refunds': { status: 409, json: { error: 'refund_exceeds_sold', lines: [{ saleLineId: 'sln_whey', soldQty: 3, refundedQty: 2, refundableQty: 1 }] } },
    }));
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    await dialog.getByTestId('refund-all').click();
    await dialog.getByTestId('refund-reason').fill('Wrong size');
    await dialog.getByTestId('refund-review').click();
    await dialog.getByTestId('refund-confirm-button').click();
    await expect(dialog.getByTestId('refund-banner')).toHaveText('Part of this sale was refunded somewhere else. Check the quantities again.');
    await expect(dialog.getByTestId('refund-choose')).toBeVisible();
    await expect(dialog.getByTestId('refund-qty-sln_whey').filter({ visible: true })).toHaveValue('1');
    await expect(dialog.getByTestId('refund-qty-sln_whey').filter({ visible: true })).toBeFocused();
  });

  test('credit sale: the balance comes off first, no method when nothing is paid back; M-Pesa needs a reference', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const credit = sale({ kind: 'credit', balanceTzs: 5000, customer: { id: 'cus_1', name: 'Neema', forgotten: false }, payments: [{ method: 'mpesa', amountTzs: 15000, reference: 'QK1' }], paidAtSaleTzs: 15000 });
    await mockApi(page, base({ 'GET /vendor/sales/sale_1': { json: { sale: credit } } }));
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    await dialog.getByTestId('refund-inc-sln_whey').filter({ visible: true }).click();
    await expect(dialog.getByTestId('refund-off-balance')).toHaveText('−TSh 3,333');
    await expect(dialog.getByTestId('refund-pay-back')).toHaveText('TSh 0');
    await expect(dialog.getByTestId('refund-nothing-back')).toBeVisible();
    await expect(dialog.getByTestId('refund-method-cash')).toHaveCount(0);
    await dialog.getByTestId('refund-inc-sln_shaker').filter({ visible: true }).click();
    // 13,333 − 5,000 owed = 8,333 to give back, by the sale's first method (M-Pesa), which needs a reference.
    await expect(dialog.getByTestId('refund-pay-back')).toHaveText('TSh 8,333');
    await expect(dialog.getByTestId('refund-method-mpesa')).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByTestId('refund-reason-mind').click();
    await expect(dialog.getByTestId('refund-review')).toBeDisabled();
    await expect(dialog.getByTestId('refund-missing')).toHaveText('Enter the transaction reference.');
    await dialog.getByTestId('refund-reference').fill('QX99');
    await expect(dialog.getByTestId('refund-review')).toBeEnabled();
  });
});

test.describe('refund dialog (round 2)', () => {
  test('VAT preview uses the server refundedVatTzs when sent, else the estimate', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let withCounter = true;
    const vatLine = () => line({ vatTzs: 1525, vatCode: 'A', refundedQty: 1, refundableQty: 2, refundedTzs: 3333, ...(withCounter ? { refundedVatTzs: 500 } : {}) });
    await mockApi(page, base({ 'GET /vendor/sales/sale_1': () => ({ json: { sale: sale({ lines: [vatLine(), shaker()], refundedTzs: 3333, refundState: 'partial' }) } }) }));
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    await dialog.getByRole('button', { name: 'Refund one more Whey 1kg' }).click();
    // floor(1525 × 2 / 3) − 500 = 516 (the estimate would say 508).
    await expect(dialog.getByTestId('refund-summary')).toContainText('Includes VAT TSh 516');
    withCounter = false;
    await page.keyboard.press('Escape');
    await dialog.getByTestId('refund-leave').click();
    await page.getByTestId('sale-refund').click();
    await page.getByTestId('refund-dialog').getByRole('button', { name: 'Refund one more Whey 1kg' }).click();
    await expect(page.getByTestId('refund-dialog').getByTestId('refund-summary')).toContainText('Includes VAT TSh 508');
  });

  test('method_required and reason_too_long show their own messages', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let n = 0;
    await mockApi(page, base({
      'POST /vendor/sales/sale_1/refunds': () => {
        n += 1;
        return n === 1 ? { status: 400, json: { error: 'method_required' } } : { status: 400, json: { error: 'reason_too_long', max: 200 } };
      },
    }));
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    await dialog.getByRole('button', { name: 'Refund one more Whey 1kg' }).click();
    await dialog.getByTestId('refund-reason-wrong').click();
    await dialog.getByTestId('refund-review').click();
    await dialog.getByTestId('refund-confirm-button').click();
    await expect(dialog).toContainText('Choose how you give the money back.');
    await dialog.getByTestId('refund-review').click();
    await dialog.getByTestId('refund-confirm-button').click();
    await expect(dialog).toContainText('The reason is too long (200 characters at most).');
    await expect(dialog.getByTestId('refund-reason')).toBeFocused();
  });
});

test.describe('UAT fixes (S7 UAT on RC)', () => {
  test('L-3: pay-later chips — Refunded, Settled by credit note, and Paid off only when payments paid it', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const credit = (extra: Record<string, unknown>) => ({
      id: 'x', number: 'R-0', soldAt: NOW, recordedAt: NOW, status: 'completed', totalTzs: 20000, itemCount: 2, methods: [], createdBy: { id: 'usr_vendor', name: 'Asha' },
      hasOverride: false, discountTzs: 0, lateRecorded: false, kind: 'credit', balanceTzs: 0, dueDate: null, customer: { id: 'cus_1', name: 'Neema', forgotten: false }, ...extra,
    });
    await mockApi(page, base({
      'GET /vendor/sales': { json: { sales: [
        credit({ id: 's5', number: 'R-000005', refundedTzs: 20000, refundState: 'full' }),
        credit({ id: 's6', number: 'R-000006', refundedTzs: 3333, refundState: 'partial' }),
        credit({ id: 's7', number: 'R-000007', refundedTzs: 0, refundState: 'none' }),
        // functions#321 rows: balanceReducedTzs decides. Paid off by payments, refunded afterwards → still Paid off.
        credit({ id: 's8', number: 'R-000008', refundedTzs: 3333, refundState: 'partial', balanceReducedTzs: 0 }),
        credit({ id: 's9', number: 'R-000009', refundedTzs: 3333, refundState: 'partial', balanceReducedTzs: 3333 }),
      ], nextCursor: null, summary: { count: 3, totalTzs: 60000, voidedCount: 0, byMethod: [] } } },
      'GET /vendor/sales/sale_1': { json: { sale: sale({ kind: 'credit', balanceTzs: 0, balanceReducedTzs: 3333, refundedTzs: 3333, refundState: 'partial', customer: { id: 'cus_1', name: 'Neema', forgotten: false }, lines: [line({ refundedQty: 1, refundableQty: 2, refundedTzs: 3333 }), shaker()] }) } },
    }));
    await page.goto('/vendor/sales/');
    const row = (id: string) => page.getByTestId(`sale-row-${id}`);
    await expect(row('s5')).toContainText('Refunded');
    await expect(row('s5')).not.toContainText('Paid off');
    await expect(row('s5')).not.toContainText('Settled by credit note');
    await expect(row('s6')).toContainText('Settled by credit note');
    await expect(row('s6')).not.toContainText('Paid off');
    await expect(row('s7')).toContainText('Paid off');
    await expect(row('s8')).toContainText('Paid off');
    await expect(row('s8')).not.toContainText('Settled by credit note');
    await expect(row('s9')).toContainText('Settled by credit note');
    await expect(row('s9')).not.toContainText('Paid off');
    await openSale(page);
    await expect(page.getByTestId('sale-settled')).toHaveText('Settled by credit note');
    await expect(page.getByTestId('sale-credit')).not.toContainText('Paid off');
  });

  test('L-9: an undone refund does not say "back in stock"', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'GET /vendor/sales/sale_1': { json: { sale: refundedSale('reverted') } },
      'GET /vendor/refunds/vrf_1': { json: { refund: refund({ status: 'reverted', revertedAt: NOW, revertedBy: { id: 'usr_vendor', name: 'Rehema' }, revertReason: 'Mistake' }) } },
    }));
    await openSale(page);
    const card = page.getByTestId('refund-card-vrf_1');
    await expect(card).toContainText('Undone');
    await expect(card).toContainText('TSh 3,333');
    await expect(card).not.toContainText('back in stock');
  });

  test('L-4 at 375px: after refund_exceeds_sold focus is on the affected line, not Close', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'POST /vendor/sales/sale_1/refunds': { status: 409, json: { error: 'refund_exceeds_sold', lines: [{ saleLineId: 'sln_whey', soldQty: 3, refundedQty: 2, refundableQty: 1 }] } },
    }));
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    await dialog.getByTestId('refund-all').click();
    await dialog.getByTestId('refund-reason-faulty').click();
    await dialog.getByTestId('refund-review').click();
    await dialog.getByTestId('refund-confirm-button').click();
    const qtyBox = dialog.getByTestId('refund-qty-sln_whey').filter({ visible: true });
    await expect(qtyBox).toHaveValue('1');
    await expect(qtyBox).toBeFocused();
  });

  test('L-8: Close is at least 44×44px; the restock box is at least 24px with a 44px label target', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    const close = await dialog.getByRole('button', { name: 'Close' }).first().boundingBox();
    expect(close!.width).toBeGreaterThanOrEqual(44);
    expect(close!.height).toBeGreaterThanOrEqual(44);
    await dialog.getByRole('button', { name: 'Refund one more Whey 1kg' }).click();
    const sw = dialog.getByRole('switch', { name: 'Put Whey 1kg back in stock' });
    const box = await sw.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
    const label = await sw.locator('xpath=ancestor::label[1]').boundingBox();
    expect(label!.height).toBeGreaterThanOrEqual(44);
  });

  test('L-5 in Swahili: a lost answer at Confirm reads Jaribu tena with the "won\'t be made twice" message', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    await mockApi(page, base({ 'POST /vendor/sales/sale_1/refunds': 'abort' }));
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    await dialog.getByTestId('refund-inc-sln_whey').filter({ visible: true }).click();
    await dialog.getByTestId('refund-reason-faulty').click();
    await dialog.getByTestId('refund-review').click();
    await dialog.getByTestId('refund-confirm-button').click();
    await expect(dialog.getByTestId('refund-banner')).toHaveText('Hatukuweza kuthibitisha marejesho. Jaribu tena — hayatafanywa mara mbili.');
    await expect(dialog.getByTestId('refund-confirm-button')).toHaveText('Jaribu tena');
  });
});

test.describe('undo', () => {
  test('needs a reason; insufficient_stock explains; already_reverted after a lost answer counts as done', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let undone = false;
    let n = 0;
    const calls = await mockApi(page, base({
      'GET /vendor/sales/sale_1': () => ({ json: { sale: refundedSale(undone ? 'reverted' : 'active') } }),
      'GET /vendor/refunds/vrf_1': () => ({ json: { refund: undone ? refund({ status: 'reverted', revertedAt: NOW, revertedBy: { id: 'usr_vendor', name: 'Rehema' }, revertReason: 'Mistake' }) : refund() } }),
      'POST /vendor/refunds/vrf_1/revert': () => {
        n += 1;
        if (n === 1) return { status: 409, json: { error: 'insufficient_stock', productId: 'prd_whey', variant: null, available: 0 } };
        if (n === 2) { undone = true; return 'abort'; }
        return { status: 409, json: { error: 'already_reverted', revertedAt: NOW } };
      },
    }));
    await openSale(page);
    const undo = page.getByTestId('refund-undo-vrf_1').filter({ visible: true });
    await expect(undo).toHaveAccessibleName('Undo refund CN-000004');
    await undo.click();
    const dialog = page.getByTestId('refund-undo-dialog').filter({ visible: true });
    await expect(dialog).toContainText('TSh 3,333 counts as sold again and the credit note shows as cancelled.');
    await expect(page.getByTestId('refund-undo-restock').filter({ visible: true })).toHaveText('Items that went back into stock are taken out again.');
    await expect(page.getByTestId('refund-undo-confirm').filter({ visible: true })).toBeDisabled();
    await page.getByTestId('refund-undo-reason').filter({ visible: true }).fill('Mistake');
    await page.getByTestId('refund-undo-confirm').filter({ visible: true }).click();
    await expect(page.getByTestId('refund-undo-stock').filter({ visible: true })).toContainText('Only 0 of Whey 1kg left in stock, so this refund can\'t be undone. Count the stock first.');
    await expect(page.getByTestId('refund-undo-stock').filter({ visible: true }).getByRole('link', { name: 'Count stock' })).toHaveAttribute('href', /\/vendor\/products\/history\/\?id=prd_whey/);
    await page.getByTestId('refund-undo-confirm').filter({ visible: true }).click();
    await expect(dialog).toContainText('Refunds need an internet connection. Nothing was changed.');
    await page.getByTestId('refund-undo-confirm').filter({ visible: true }).click();
    await expect(page.getByText('Refund CN-000004 undone')).toBeVisible();
    await expect(page.getByTestId('refund-undo-dialog').filter({ visible: true })).toHaveCount(0);
    expect(posts(calls, '/vendor/refunds/vrf_1/revert').map(c => c.body)).toEqual([{ reason: 'Mistake' }, { reason: 'Mistake' }, { reason: 'Mistake' }]);
    // Undone: the word, no Undo, and Void is back (no active refunds).
    await expect(page.getByTestId('sale-refunds').getByText('Undone').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByTestId('refund-undo-vrf_1').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByTestId('sale-void')).toBeVisible();
  });

  test('undo answered 429 rate_limited stays open and says to wait', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'GET /vendor/sales/sale_1': { json: { sale: refundedSale() } },
      'POST /vendor/refunds/vrf_1/revert': { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 30 } },
    }));
    await openSale(page);
    await page.getByTestId('refund-undo-vrf_1').filter({ visible: true }).click();
    await page.getByTestId('refund-undo-reason').fill('Mistake');
    await page.getByTestId('refund-undo-confirm').click();
    await expect(page.getByTestId('refund-undo-dialog')).toContainText('Too many tries. Wait a minute and try again.');
  });

  test('a void refused with 409 has_refunds says so and reloads', async ({ page }) => {
    await signedInAs(page, VENDOR);
    // Another device refunded the sale after it was opened here.
    let refused = false;
    await mockApi(page, base({
      'GET /vendor/sales/sale_1': () => ({ json: { sale: refused ? refundedSale() : sale() } }),
      'POST /vendor/sales/sale_1/void': () => { refused = true; return { status: 409, json: { error: 'has_refunds', refunds: [{ id: 'vrf_1', number: 'CN-000004' }] } }; },
    }));
    await openSale(page);
    await page.getByTestId('sale-void').click();
    await page.getByTestId('sale-void-reason').fill('Wrong sale');
    await page.getByTestId('sale-void-confirm').click();
    await expect(page.getByText("This sale has refunds, so it can't be voided.").first()).toBeVisible();
    await expect(page.getByTestId('sale-void')).toHaveCount(0);
    await expect(page.getByTestId('sale-refunds')).toBeVisible();
  });
});

test.describe('layout, focus, language', () => {
  test('375px: the dialog fills the screen; Escape asks first when picks exist, then focus returns to Refund items', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await openSale(page);
    await page.getByTestId('sale-refund').click();
    const dialog = page.getByTestId('refund-dialog');
    // UAT L-10: the dialog (labelled by its title) has focus on open.
    await expect(dialog).toBeFocused();
    await expect(dialog).toHaveAccessibleName('Refund from R-000123');
    const box = await dialog.boundingBox();
    expect(Math.round(box!.width)).toBe(375);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll).toBeLessThanOrEqual(375);
    // Phone layout: one card per line, steppers at least 44px.
    await expect(dialog.getByTestId('refund-card-line-sln_whey')).toBeVisible();
    const inc = await dialog.getByTestId('refund-inc-sln_whey').filter({ visible: true }).boundingBox();
    expect(inc!.height).toBeGreaterThanOrEqual(44);
    expect(inc!.width).toBeGreaterThanOrEqual(44);
    await dialog.getByTestId('refund-inc-sln_whey').filter({ visible: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialog.getByTestId('refund-discard')).toHaveText('Leave without refunding? Your choices will be lost.');
    await dialog.getByTestId('refund-leave').click();
    await expect(page.getByTestId('refund-dialog')).toHaveCount(0);
    await expect(page.getByTestId('sale-refund')).toBeFocused();
  });

  test('Kiswahili: the sale detail and dialog read in Swahili', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    await mockApi(page, base({ 'GET /vendor/sales/sale_1': { json: { sale: refundedSale() } } }));
    await openSale(page);
    await expect(page.getByTestId('sale-detail').getByText('Imerejeshwa sehemu')).toBeVisible();
    await expect(page.getByTestId('sale-refund')).toContainText('Fanya marejesho');
    await page.getByTestId('sale-refund').click();
    await expect(page.getByTestId('refund-step-heading')).toHaveText('Mteja anarudisha nini?');
    await expect(page.getByTestId('refund-money-notice')).toHaveText('FitFlex haishughulikii pesa hii. Mrudishie mteja pesa wewe mwenyewe.');
  });
});

test.describe('reports and documents', () => {
  const head = (extra: Record<string, unknown> = {}) => ({
    from: `${eatToday().slice(0, 7)}-01`, to: eatToday(), channel: 'all', generatedAt: NOW, timezone: 'Africa/Dar_es_Salaam', inProgress: true,
    channels: { app: false, walkIn: true }, ...extra,
  });
  const refundsReport = {
    ...head(),
    rows: [
      { type: 'refund', refundId: 'vrf_1', number: 'CN-000004', at: NOW, date: eatToday(), saleId: 'sale_1', saleNumber: 'R-000123', amountTzs: 3333, paidOutTzs: 3333, balanceReducedTzs: 0, method: 'cash', restockedUnits: 1, status: 'reverted' },
      { type: 'revert', refundId: 'vrf_1', number: 'CN-000004', at: NOW, date: eatToday(), saleId: 'sale_1', saleNumber: 'R-000123', amountTzs: -3333, paidOutTzs: -3333, balanceReducedTzs: 0, method: 'cash', restockedUnits: -1, status: 'reverted' },
    ],
    totals: { count: 1, amountTzs: 0, paidOutTzs: 0, balanceReducedTzs: 0, restockedUnits: 0, revertedCount: 1 },
  };

  test('a credit note does not open with walk-in sales off (functions#318 L1)', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: tools({ walkInSales: false }) }) } }));
    await page.goto('/vendor/documents/?type=credit_note&id=vrf_1');
    await expect(page).toHaveURL(/\/vendor\/$/);
    expect(calls.some(c => c.path.startsWith('/vendor/documents/credit_note'))).toBe(false);
  });

  test('view=refunds lists Refund and Undone rows (Undone negative with U+2212) and the totals', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'GET /vendor/reports/refunds': { json: refundsReport } }));
    await page.goto('/vendor/reports/?view=refunds');
    await expect(page.getByTestId('report-view-heading')).toHaveText('Refunds');
    await expect(page.getByTestId('refunds-count')).toContainText('1');
    await expect(page.getByTestId('refunds-undone')).toContainText('1');
    const undone = page.getByTestId('refunds-row-revert-vrf_1');
    await expect(undone).toContainText('Undone');
    await expect(undone).toContainText('−TSh 3,333');
    await expect(undone).toContainText('−1');
    await expect(page.getByTestId('refunds-row-refund-vrf_1').getByRole('link', { name: 'CN-000004' })).toHaveAttribute('href', /type=credit_note&id=vrf_1/);
  });

  test('refunds off: the Refunds view still shows for a period with refund rows; Payment methods has "Paid back by you"', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'GET /vendor/me': { json: me({ tools: tools({ refunds: false }) }) },
      'GET /vendor/reports/refunds': { json: refundsReport },
      'GET /vendor/reports/payment-methods': { json: { ...head(), byYou: [{ method: 'cash', amountTzs: 20000, count: 1, sharePct: 100 }], viaFitFlex: [], paidBack: [{ method: 'cash', amountTzs: 3333, count: 1 }] } },
    }));
    await page.goto('/vendor/reports/?view=refunds');
    await expect(page.getByTestId('report-view-heading')).toHaveText('Refunds');
    await expect(page.getByTestId('refunds-row-refund-vrf_1')).toBeVisible();
    await page.goto('/vendor/reports/?view=methods');
    const paidBack = page.getByTestId('methods-paid-back');
    await expect(paidBack).toContainText('Paid back by you (refunds)');
    await expect(paidBack).toContainText('TSh 3,333');
    await expect(page.getByTestId('methods-you')).toContainText('TSh 20,000');
  });

  test('credit note view: Issued badge and Share; Share hidden with refunds off; sale documents show Refunded / Settled by credit note', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const cn = {
      docType: 'credit_note', number: 'CN-000004', saleRef: { number: 'R-000123', invoiceNumber: null, soldAt: NOW }, status: 'issued', issuedAt: NOW, lang: 'en',
      seller: { businessName: 'Dar Fitness Gear', logoUrl: null, address: null, contactNumber: null }, servedBy: { firstName: 'Asha' },
      lines: [{ name: 'Whey 1kg', variant: null, qty: 1, amountTzs: 3333 }], totalTzs: 3333, vatIncludedTzs: 0, vatSummary: [], balanceReducedTzs: 0,
      paidOut: { method: 'cash', amountTzs: 3333 },
    };
    let flag = true;
    let saleStatus = 'refunded';
    await mockApi(page, base({
      'GET /vendor/me': () => ({ json: me({ tools: tools({ refunds: flag }) }) }),
      'GET /vendor/documents/credit_note/vrf_1': (_r, url) => (url.searchParams.get('format') === 'html' ? { body: '<html><body><h1>Credit note CN-000004</h1></body></html>' } : { json: { doc: cn } }),
      'GET /vendor/documents/sale/sale_1': (_r, url) => (url.searchParams.get('format') === 'html' ? { body: '<html><body>R-000123</body></html>' } : {
        json: { doc: { ...cn, docType: 'receipt', number: 'R-000123', saleRef: null, status: saleStatus, subtotalTzs: 20500, discountsTzs: 500, totalTzs: 20000, payments: [], changeTzs: 0, refunds: [{ number: 'CN-000004', refundedAt: NOW, amountTzs: 3333 }], totalAfterRefundsTzs: 16667 } },
      }),
      'GET /vendor/document-links': { json: { links: [], activeCount: 0 } },
    }));
    await page.goto('/vendor/documents/?type=credit_note&id=vrf_1&sale=sale_1');
    await expect(page.getByTestId('document-heading')).toHaveText('Credit note CN-000004');
    await expect(page.getByTestId('document-status')).toContainText('Issued');
    await expect(page.getByTestId('document-share')).toBeVisible();
    await expect(page.getByTestId('document-back')).toHaveAttribute('href', '/vendor/sales/?id=sale_1');

    flag = false;
    await page.reload();
    await expect(page.getByTestId('document-heading')).toHaveText('Credit note CN-000004');
    await expect(page.getByTestId('document-share')).toHaveCount(0);

    await page.goto('/vendor/documents/?type=sale&id=sale_1');
    await expect(page.getByTestId('document-status')).toContainText('Refunded');
    saleStatus = 'settled_by_credit_note';
    await page.reload();
    await expect(page.getByTestId('document-status')).toContainText('Settled by credit note');
  });
});
