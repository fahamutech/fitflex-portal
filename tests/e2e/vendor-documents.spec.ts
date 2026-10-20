import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';

// Vendor documents and tax details (S5) in the portal against a mocked API: gating (tools.documents / tools.vat,
// per-kind permissions), the document view (server HTML only inside a sandboxed iframe, language, Print, PDF A4 and
// 80mm), the share menu (lazy link, one link per session, WhatsApp, Copy link, ?lang=sw without a new link, 503
// public_url_not_configured → text only), links (Turn off / Turn off all), voided documents, entry points, and the
// Tax details page (owner edits, staff with `payments` read only, upload, errors).
// Network guard: every request outside localhost is aborted and recorded, for the whole browser context (popups
// too); the API is answered here. Nothing may reach the live API or any other service.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.use({ serviceWorkers: 'block' });

type Reply = { status?: number; json?: unknown; body?: string; contentType?: string; headers?: Record<string, string> };
type Routes = Record<string, Reply | ((req: Request, url: URL) => Reply)>;
type Call = { method: string; path: string; search: URLSearchParams; body: Record<string, unknown> | null; raw: string | null };

const ALL = ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff'];
const tools = (extra: Record<string, unknown> = {}) => ({ portal: true, stockLedger: true, buyerContact: true, canSeeCost: true, walkInSales: true, customers: true, documents: true, vat: true, ...extra });
const me = (extra: Record<string, unknown> = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ALL, approvalStatus: 'approved', accountStatus: 'active', tools: tools(), ...extra,
});
const staffMe = (permissions: string[], extra: Record<string, unknown> = {}) => me({ userType: 'vendor_staff', vendorRole: 'cashier', permissions, ...extra });
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };
const STAFF = { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' };
const NOW = new Date(Date.now() - 60_000).toISOString();
const TODAY = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const zeroAging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };

const doc = (extra: Record<string, unknown> = {}) => ({
  docType: 'receipt', number: 'R-000123', status: 'paid', issuedAt: NOW, lang: 'en',
  seller: { businessName: 'Dar Fitness Gear', logoUrl: null, address: 'Kariakoo', contactNumber: '+255700000000' },
  customer: { name: 'Juma Mussa' }, servedBy: { firstName: 'Asha' },
  lines: [{ name: 'Whey 2kg', variant: null, qty: 2, unitPriceTzs: 47500, discountTzs: 0, amountTzs: 95000, vatCode: 'A' }],
  subtotalTzs: 95000, discountsTzs: 0, totalTzs: 95000, vatIncludedTzs: 14492, vatSummary: [{ code: 'A', ratePct: 18, netTzs: 80508, vatTzs: 14492 }],
  payments: [{ method: 'cash', amountTzs: 100000 }], changeTzs: 5000, ...extra,
});
// The server's HTML. The script must never run: the iframe is sandboxed without allow-scripts.
const docHtml = (lang = 'en') => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body>`
  + `<h1 data-doc-marker="1">${lang === 'sw' ? 'Risiti' : 'Receipt'} R-000123</h1><p>TSh 95,000</p>`
  + '<script>try { window.parent.__docScriptRan = true; } catch (e) {} window.__docScriptRan = true;</script></body></html>';
const TOKEN_URL = 'https://docs.example.test/d/AbCdEfGhIjKlMnOpQrStUv';
const shareRes = (lang: 'en' | 'sw' = 'en') => ({
  linkId: 'lnk_new', url: lang === 'sw' ? `${TOKEN_URL}?lang=sw` : TOKEN_URL, lang, docType: 'receipt', docId: 'sal_1', number: 'R-000123',
  texts: {
    en: { whatsapp: `Dar Fitness Gear: Receipt R-000123, TSh 95,000. View it here: ${lang === 'sw' ? `${TOKEN_URL}?lang=en` : TOKEN_URL}`, sms: 'Dar Fitness Gear Receipt R-000123 TSh 95,000: x' },
    sw: { whatsapp: `Dar Fitness Gear: Risiti R-000123, TSh 95,000. Itazame hapa: ${TOKEN_URL}?lang=sw`, sms: 'Dar Fitness Gear Risiti R-000123 TSh 95,000: x' },
  },
  whatsappText: 'x', smsText: 'x',
});
const link = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `lnk_${n}`, n, docType: 'receipt', docId: 'sal_1', lang: 'en', createdAt: NOW, createdBy: { id: 'usr_vendor', firstName: 'Rehema' },
  lastOpenedAt: null, revokedAt: null, active: true, ...extra,
});
const sale = (extra: Record<string, unknown> = {}) => ({
  id: 'sal_1', number: 'R-000123', status: 'completed', kind: 'cash', soldAt: NOW, recordedAt: NOW, subtotalTzs: 95000, lineDiscountTzs: 0, discountTzs: 0,
  totalTzs: 95000, paidTzs: 100000, changeTzs: 5000, note: null, createdBy: { id: 'usr_vendor', name: 'Asha' }, voidedBy: null, voidedAt: null, voidReason: null,
  lateRecorded: false, lines: [{ nameSnapshot: 'Whey 2kg', variant: null, qty: 2, listPriceTzs: 47500, unitPriceTzs: 47500, priceChanged: false, priceChangedBy: null, discountTzs: 0, lineTotalTzs: 95000 }],
  payments: [{ method: 'cash', amountTzs: 100000, reference: null }], customer: { id: 'cus_juma', name: 'Juma Mussa' }, balanceTzs: 0, ...extra,
});
const order = (extra: Record<string, unknown> = {}) => ({
  id: 'ord_1', shortRef: 'AB12CD', createdAt: NOW, status: 'accepted', orderStatus: 'accepted', nextStatuses: ['processing'], timeline: [],
  items: [{ productId: 'p1', name: 'Whey 2kg', variant: null, qty: 1, priceTzs: 47500, image: null }], totalTzs: 47500,
  paymentStatus: 'paid', paymentMethod: 'mpesa', deliveryMethod: 'home', note: null, pickupGymId: null, pickupGym: null,
  buyer: { customerId: null, displayName: 'Neema' }, ...extra,
});
const walkIn = { id: 'cus_juma', source: 'manual', name: 'Juma Mussa', phone: '+255712345678', archived: false, forgotten: false, lastPurchaseAt: NOW, owedTzs: 0, overdueTzs: 0, oldestDueDate: null, maxDaysOverdue: 0, aging: zeroAging };
const profile = { ...walkIn, email: null, address: null, note: null, archivedAt: null, createdAt: NOW, updatedAt: NOW, totals: { shopSalesTzs: 95000, shopSalesCount: 1, appOrdersTzs: 0, appOrdersCount: 0, lastPurchaseAt: NOW }, asOf: TODAY, openSales: [] };
const payment = { id: 'pay_1', number: 'PMT-000001', customerId: 'cus_juma', status: 'recorded', amountTzs: 25000, method: 'mpesa', reference: 'QK12AB34', receivedOn: TODAY, note: null, clientRef: 'ref-1', recordedAt: NOW, recordedBy: { id: 'usr_vendor', name: 'Rehema' }, allocations: [], voidedAt: null, voidedBy: null, voidReason: null };
const taxProfile = (extra: Record<string, unknown> = {}) => ({
  vatRegistered: false, tin: null, tinFromKyc: false, vrn: null, certificateDocumentId: null, pricesIncludeVat: true, status: 'none',
  rejectReason: null, rejectNote: null, verifiedAt: null, inForce: false, changePending: false, verified: null, pending: null, updatedAt: '2026-10-20T08:00:00.000Z', ...extra,
});

async function signedInAs(page: Page, user: Record<string, unknown>, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
    const w = window as unknown as { __copied: string | null; __opened: Array<{ url: string; location: { href: string }; opener: unknown; closed: boolean; close: () => void }> };
    w.__copied = null;
    w.__opened = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { w.__copied = text; } } });
    // No real tab is ever opened: WhatsApp's tab is recorded here (and never loads anything).
    window.open = ((url?: string | URL) => {
      const rec = { url: String(url ?? ''), location: { href: '' }, opener: window as unknown, closed: false, close() { this.closed = true; } };
      w.__opened.push(rec);
      return rec as unknown as Window;
    }) as typeof window.open;
  }, [user, locale] as const);
}

/** The guard (for the whole context, popups too) and the API. Unknown routes are 404. */
async function mockApi(page: Page, routes: Routes) {
  const calls: Call[] = [];
  const outside: string[] = [];
  const ctx: BrowserContext = page.context();
  page.on('pageerror', err => console.log('PAGEERROR', err.message));
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => { outside.push(route.request().url()); return route.abort(); });
  await ctx.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body: Record<string, unknown> | null = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, search: url.searchParams, body, raw: req.postData() });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req, url) : hit;
    if (reply.body != null) return route.fulfill({ status: reply.status ?? 200, body: reply.body, contentType: reply.contentType ?? 'text/html; charset=utf-8', headers: reply.headers });
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? null, headers: reply.headers });
  });
  return Object.assign(calls, { outside });
}

/** GET /vendor/documents/:kind/:id answering json, html or pdf by `format`. */
const docRoute = (json: unknown = { doc: doc() }) => (_req: Request, url: URL): Reply => {
  const format = url.searchParams.get('format');
  const lang = url.searchParams.get('lang') ?? 'en';
  if (format === 'html') return { body: docHtml(lang) };
  if (format === 'pdf') return { body: '%PDF-1.4 test', contentType: 'application/pdf', headers: { 'content-disposition': 'attachment; filename="R-000123_dar-fitness-gear.pdf"' } };
  return { json };
};

const base = (extra: Routes = {}): Routes => ({
  'GET /vendor/me': { json: me() },
  'GET /vendor/products': { json: [] },
  'GET /vendor/stock/low': { json: [] },
  'GET /vendor/orders': { json: { orders: [order()], nextCursor: null } },
  'GET /vendor/orders/ord_1': { json: order() },
  'GET /vendor/payments': { json: { todaySalesTzs: 0, pendingSettlementTzs: 0 } },
  'GET /vendor/statements': { json: { statements: [], payoutReady: true, payoutBlockedBy: null } },
  'GET /vendor/sales': { json: { sales: [], nextCursor: null, summary: { count: 0, totalTzs: 0, voidedCount: 0, byMethod: [] } } },
  'GET /vendor/sales/sal_1': { json: { sale: sale() } },
  'GET /vendor/customers': { json: { customers: [walkIn], nextCursor: null, asOf: TODAY } },
  'GET /vendor/customers/cus_juma': { json: { customer: profile } },
  'GET /vendor/customers/cus_juma/sales': { json: { sales: [], nextCursor: null } },
  'GET /vendor/customers/cus_juma/orders': { json: { orders: [], nextCursor: null } },
  'GET /vendor/customers/cus_juma/payments': { json: { payments: [payment], nextCursor: null } },
  'GET /vendor/customers/cus_juma/payments/pay_1': { json: { payment } },
  'GET /vendor/receivables/aging': { json: { asOf: TODAY, totals: { owedTzs: 0, overdueTzs: 0, customerCount: 0, overdueCustomerCount: 0, openSaleCount: 0, overdueSaleCount: 0, ...zeroAging }, rows: [], nextCursor: null } },
  'GET /vendor/documents/sale/sal_1': docRoute(),
  'GET /vendor/document-links': { json: { links: [], activeCount: 0 } },
  'POST /vendor/sales/sal_1/share': (req: Request) => ({ status: 201, json: shareRes((req.postDataJSON()?.lang as 'en' | 'sw') ?? 'en') }),
  ...extra,
});
const callsTo = (calls: Call[], method: string, path: string) => calls.filter(c => c.method === method && c.path === path);
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string | null }).__copied);
const DOC_URL = '/vendor/documents/?type=sale&id=sal_1&customer=cus_juma';

test.describe('gating', () => {
  test('documents off: no View document on the sale, and a deep link goes back to the dashboard; nothing outside localhost', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: tools({ documents: false }) }) } }));
    await page.goto('/vendor/sales/?id=sal_1');
    await expect(page.getByTestId('sale-detail')).toBeVisible();
    await expect(page.getByTestId('sale-copy')).toBeVisible();
    await expect(page.getByTestId('sale-document')).toHaveCount(0);
    await page.goto(DOC_URL);
    await expect(page).toHaveURL(/\/vendor\/$/);
    expect(calls.filter(c => c.path.startsWith('/vendor/documents') || c.path.startsWith('/vendor/document-links'))).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('documents missing from tools fails closed; staff with `sales` only cannot open a payment receipt', async ({ page, browser }) => {
    await signedInAs(page, VENDOR);
    const t = tools(); delete (t as Record<string, unknown>).documents;
    await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: t }) } }));
    await page.goto('/vendor/orders/?id=ord_1');
    await expect(page.getByTestId('order-detail')).toBeVisible();
    await expect(page.getByTestId('order-invoice')).toHaveCount(0);

    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const p2 = await ctx.newPage();
    await signedInAs(p2, STAFF);
    const calls = await mockApi(p2, base({ 'GET /vendor/me': { json: staffMe(['sales']) } }));
    await p2.goto('/vendor/documents/?type=payment&id=pay_1&customer=cus_juma');
    await expect(p2).toHaveURL(/\/vendor\/$/);
    await expect(p2.getByText("You don't have access to this document.")).toBeVisible();
    expect(calls.filter(c => c.path.startsWith('/vendor/documents'))).toHaveLength(0);
    expect(calls.outside).toEqual([]);
    await ctx.close();
  });

  test('staff with `orders` only: the paid order shows Invoice; an unpaid one does not', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({
      'GET /vendor/me': { json: staffMe(['orders']) },
      'GET /vendor/orders/ord_2': { json: order({ id: 'ord_2', paymentStatus: 'pending', status: 'pending', orderStatus: 'pending', nextStatuses: [] }) },
    }));
    await page.goto('/vendor/orders/?id=ord_1');
    await expect(page.getByTestId('order-invoice')).toHaveAttribute('href', '/vendor/documents/?type=order&id=ord_1');
    await page.goto('/vendor/orders/?id=ord_2');
    await expect(page.getByTestId('order-detail')).toBeVisible();
    await expect(page.getByTestId('order-invoice')).toHaveCount(0);
  });
});

test.describe('document view', () => {
  test('server HTML only inside a sandboxed iframe (no scripts run), title, links count, back to the sale', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/document-links': { json: { links: [link(1), link(2, { active: false, revokedAt: NOW })], activeCount: 1 } } }));
    await page.goto('/vendor/sales/?id=sal_1');
    await expect(page.getByTestId('sale-document')).toHaveAttribute('href', DOC_URL);
    await page.getByTestId('sale-document').click();
    await expect(page.getByTestId('document-heading')).toHaveText('Receipt R-000123');
    await expect(page.getByTestId('document-heading')).toBeFocused();
    const frame = page.getByTestId('document-frame');
    await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin allow-modals');
    await expect(frame).toHaveAttribute('title', 'Receipt R-000123, document preview');
    await expect(page.frameLocator('[data-testid="document-frame"]').locator('[data-doc-marker]')).toHaveText('Receipt R-000123');
    // The document is never part of the page's own DOM, and its script never ran.
    await expect(page.locator('[data-doc-marker]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __docScriptRan?: boolean }).__docScriptRan)).toBeUndefined();
    expect(await page.frameLocator('[data-testid="document-frame"]').locator('body').evaluate(() => (window as unknown as { __docScriptRan?: boolean }).__docScriptRan)).toBeUndefined();
    await expect(page.getByTestId('document-links')).toHaveText('Links (1 active)');
    const views = callsTo(calls, 'GET', '/vendor/documents/sale/sal_1');
    expect(views.map(c => c.search.get('format')).sort()).toEqual(['html', 'json']);
    expect(views.every(c => c.search.get('lang') === 'en')).toBe(true);
    await expect(page.getByTestId('document-back')).toHaveAttribute('href', '/vendor/sales/?id=sal_1');
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('Kiswahili: the toggle reloads the document in sw; the UI in Swahili', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    const calls = await mockApi(page, base());
    await page.goto(DOC_URL);
    await expect(page.getByTestId('document-heading')).toHaveText('Risiti R-000123');
    await expect(page.getByTestId('document-print')).toHaveText('Chapisha');
    await expect(page.frameLocator('[data-testid="document-frame"]').locator('[data-doc-marker]')).toHaveText('Risiti R-000123');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect.poll(() => callsTo(calls, 'GET', '/vendor/documents/sale/sal_1').filter(c => c.search.get('lang') === 'en').length).toBe(2);
    await expect(page.frameLocator('[data-testid="document-frame"]').locator('[data-doc-marker]')).toHaveText('Receipt R-000123');
  });

  test('Download PDF (A4) and PDF for a receipt printer (80mm)', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto(DOC_URL);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('document-pdf').click()]);
    expect(download.suggestedFilename()).toBe('R-000123_dar-fitness-gear.pdf');
    await page.getByTestId('document-share').click();
    const [d80] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-pdf-80mm').click()]);
    expect(d80.suggestedFilename()).toMatch(/\.pdf$/);
    const pdfs = callsTo(calls, 'GET', '/vendor/documents/sale/sal_1').filter(c => c.search.get('format') === 'pdf');
    expect(pdfs.map(c => c.search.get('paper'))).toEqual(['a4', '80mm']);
    // A PDF never makes a link.
    expect(callsTo(calls, 'POST', '/vendor/sales/sal_1/share')).toHaveLength(0);
  });

  test('not found, invoice not ready, no access', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'GET /vendor/documents/sale/sal_x': { status: 404, json: { error: 'sale_not_found' } },
      'GET /vendor/documents/order/ord_2': { status: 409, json: { error: 'invoice_not_ready' } },
      'GET /vendor/documents/order/ord_3': { status: 403, json: { error: 'vendor_permission_forbidden', requiredPermission: 'orders' } },
    }));
    await page.goto('/vendor/documents/?type=sale&id=sal_x');
    await expect(page.getByTestId('document-not-found')).toContainText('Document not found.');
    await page.goto('/vendor/documents/?type=order&id=ord_2');
    await expect(page.getByTestId('document-not-ready')).toContainText('The invoice is ready once the order is paid.');
    await page.goto('/vendor/documents/?type=order&id=ord_3');
    await expect(page.getByTestId('document-no-access')).toContainText("You don't have access to this document.");
    await page.goto('/vendor/documents/?type=bogus&id=x');
    await expect(page.getByText('Document not found.')).toBeVisible();
  });

  test('a voided document: Cancelled note, no Share, links still reachable', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'GET /vendor/documents/sale/sal_1': docRoute({ doc: doc({ status: 'cancelled', cancelledAt: NOW }) }),
      'GET /vendor/document-links': { json: { links: [link(1)], activeCount: 1 } },
    }));
    await page.goto(DOC_URL);
    await expect(page.getByTestId('document-voided')).toContainText("Cancelled documents can't be shared.");
    await expect(page.getByTestId('document-share')).toHaveCount(0);
    await page.getByTestId('document-links').click();
    await expect(page.getByTestId('links-view')).toBeVisible();
    await expect(page.getByTestId('doc-link-revoke-lnk_1')).toBeVisible();
  });
});

test.describe('share menu', () => {
  test('Copy link makes exactly one link; WhatsApp reuses it; Kiswahili adds ?lang=sw without a new link; closing forgets it', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let active = 0;
    const calls = await mockApi(page, base({
      'GET /vendor/document-links': () => ({ json: { links: Array.from({ length: active }, (_, i) => link(i + 1)), activeCount: active } }),
      'POST /vendor/sales/sal_1/share': (req: Request) => { active += 1; return { status: 201, json: shareRes((req.postDataJSON()?.lang as 'en' | 'sw') ?? 'en') }; },
    }));
    await page.goto(DOC_URL);
    await page.getByTestId('document-share').click();
    const menu = page.getByRole('dialog', { name: 'Share Receipt R-000123' });
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Phone numbers are never shown.', { exact: false })).toBeVisible();
    // Opening the menu makes no link.
    expect(callsTo(calls, 'POST', '/vendor/sales/sal_1/share')).toHaveLength(0);

    await menu.getByTestId('share-copy').click();
    await expect.poll(() => copied(page)).toBe(TOKEN_URL);
    await expect(page.getByText('Link copied').first()).toBeVisible();
    expect(callsTo(calls, 'POST', '/vendor/sales/sal_1/share')).toHaveLength(1);
    expect(callsTo(calls, 'POST', '/vendor/sales/sal_1/share')[0].body).toEqual({ lang: 'en' });

    // WhatsApp now is a plain link with the same URL in the text (walk-in phone, digits only).
    const wa = menu.getByTestId('share-whatsapp');
    await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/255712345678\?text=/);
    expect(decodeURIComponent((await wa.getAttribute('href'))!.split('text=')[1])).toContain(TOKEN_URL);
    await expect(wa).toHaveAttribute('target', '_blank');
    await expect(wa).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(wa).toHaveAccessibleName('Share Receipt R-000123 on WhatsApp');

    await menu.getByRole('button', { name: 'Kiswahili', exact: true }).click();
    await menu.getByTestId('share-copy').click();
    await expect.poll(() => copied(page)).toBe(`${TOKEN_URL}?lang=sw`);
    expect(decodeURIComponent((await wa.getAttribute('href'))!.split('text=')[1])).toContain('Itazame hapa');
    expect(callsTo(calls, 'POST', '/vendor/sales/sal_1/share')).toHaveLength(1);
    await expect(menu.getByTestId('share-links')).toHaveText('Links (1 active)');

    // Share as text adds the link line in the chosen language.
    await menu.getByTestId('share-text').click();
    await expect.poll(() => copied(page)).toContain(`Tazama: ${TOKEN_URL}?lang=sw`);
    expect(await copied(page)).toContain('Risiti R-000123');

    // Close and reopen: a new session, the next copy makes a new link.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId('document-share')).toBeFocused();
    await page.getByTestId('document-share').click();
    await page.getByRole('dialog').getByTestId('share-copy').click();
    await expect.poll(() => callsTo(calls, 'POST', '/vendor/sales/sal_1/share').length).toBe(2);
    expect(calls.outside).toEqual([]);
  });

  test('WhatsApp first: one link, the tab opened in the click gets wa.me with the walk-in phone', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto(DOC_URL);
    await page.getByTestId('document-share').click();
    await expect.poll(() => callsTo(calls, 'GET', '/vendor/customers/cus_juma').length).toBeGreaterThan(0);
    await page.getByRole('dialog').getByTestId('share-whatsapp').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: Array<{ location: { href: string } }> }).__opened[0]?.location.href ?? '')).toMatch(/^https:\/\/wa\.me\/255712345678\?text=/);
    const opened = await page.evaluate(() => (window as unknown as { __opened: Array<{ url: string; opener: unknown }> }).__opened[0]);
    expect(opened.opener).toBeNull();
    expect(callsTo(calls, 'POST', '/vendor/sales/sal_1/share')).toHaveLength(1);
    await expect(page.getByTestId('share-live')).toHaveText('Link ready. You can copy it or turn it off here.');
    expect(calls.outside).toEqual([]);
  });

  test('503 public_url_not_configured: links off with the message; Share as text still works (no link line)', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'POST /vendor/sales/sal_1/share': { status: 503, json: { error: 'public_url_not_configured' } } }));
    await page.goto(DOC_URL);
    await page.getByTestId('document-share').click();
    const menu = page.getByRole('dialog');
    await menu.getByTestId('share-copy').click();
    await expect(menu.getByTestId('share-unavailable')).toHaveText("Links aren't available yet. Share as text for now.");
    await expect(menu.getByTestId('share-copy')).toBeDisabled();
    await expect(menu.getByTestId('share-whatsapp')).toBeDisabled();
    expect(await copied(page)).toBeNull();
    await menu.getByTestId('share-text').click();
    await expect.poll(() => copied(page)).toContain('Receipt R-000123');
    const text = (await copied(page))!;
    expect(text).toContain('This is not a TRA fiscal receipt.');
    expect(text).toContain('Includes VAT TSh 14,492');
    expect(text).not.toContain('View:');
    expect(text).not.toContain('+255');
    expect(callsTo(calls, 'POST', '/vendor/sales/sal_1/share')).toHaveLength(1);
  });

  test('credit invoice as text: live "Balance due", then "Paid in full on {date}" (sw) — never the "at sale" label', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let paid = false;
    await mockApi(page, base({
      'POST /vendor/sales/sal_1/share': { status: 503, json: { error: 'public_url_not_configured' } },
      'GET /vendor/documents/sale/sal_1': (_req: Request, url: URL) => (url.searchParams.get('format') === 'html' ? { body: docHtml() } : {
        json: { doc: doc({ docType: 'invoice', number: 'INV-000001', saleRef: 'R-000123', status: paid ? 'paid_in_full' : 'pay_later', liveStatus: paid
          ? { asOf: TODAY, balanceTzs: 0, paidInFullAt: '2026-10-19', paidWith: ['PMT-000001'] }
          : { asOf: TODAY, balanceTzs: 45000, paidInFullAt: null, paidWith: [] } }) },
      }),
    }));
    await page.goto(DOC_URL);
    await page.getByTestId('document-share').click();
    await page.getByRole('dialog').getByTestId('share-text').click();
    await expect.poll(() => copied(page)).toContain('Balance due  TSh 45,000');
    expect(await copied(page)).not.toContain('at sale');
    await page.keyboard.press('Escape');
    paid = true;
    await page.getByRole('button', { name: 'Kiswahili', exact: true }).click();
    await expect(page.frameLocator('[data-testid="document-frame"]').locator('[data-doc-marker]')).toBeVisible();
    await page.getByTestId('document-share').click();
    await page.getByRole('dialog').getByTestId('share-text').click();
    await expect.poll(() => copied(page)).toContain('Imelipwa yote tarehe 19 Okt 2026');
    expect(await copied(page)).not.toContain('Kiasi kinachodaiwa');
  });

  test('429 rate_limited on share: "Too many tries. Wait {n} seconds."', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'POST /vendor/sales/sal_1/share': { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 42 } } }));
    await page.goto(DOC_URL);
    await page.getByTestId('document-share').click();
    await page.getByRole('dialog').getByTestId('share-copy').click();
    await expect(page.getByTestId('share-error')).toHaveText('Too many tries. Wait 42 seconds.');
  });

  test('a create failure shows Try again text; a 409 document_cancelled shows the cancelled note', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let n = 0;
    await mockApi(page, base({ 'POST /vendor/sales/sal_1/share': () => (++n === 1 ? { status: 500, json: { error: 'boom' } } : { status: 409, json: { error: 'document_cancelled' } }) }));
    await page.goto(DOC_URL);
    await page.getByTestId('document-share').click();
    const menu = page.getByRole('dialog');
    await menu.getByTestId('share-copy').click();
    await expect(menu.getByTestId('share-error')).toHaveText("Couldn't create the link. Try again.");
    await menu.getByTestId('share-copy').click();
    await expect(menu.getByText("Cancelled documents can't be shared.", { exact: false })).toBeVisible();
    await expect(menu.getByTestId('share-copy')).toBeDisabled();
  });
});

test.describe('links', () => {
  test('rows (created by, never / last opened, language), Turn off with confirm, Turn off all; the URL is never listed', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let links = [link(1), link(2, { lang: 'sw', lastOpenedAt: NOW }), link(3)];
    const calls = await mockApi(page, base({
      'GET /vendor/document-links': () => ({ json: { links, activeCount: links.filter(l => l.active).length } }),
      'POST /vendor/documents/lnk_2/revoke': () => { links = links.map(l => (l.id === 'lnk_2' ? { ...l, active: false, revokedAt: NOW } : l)); return { json: { link: links[1] } }; },
      'POST /vendor/document-links/revoke': () => { links = links.map(l => ({ ...l, active: false, revokedAt: l.revokedAt ?? NOW })); return { json: { links, revokedCount: 2 } }; },
    }));
    await page.goto(DOC_URL);
    await expect(page.getByTestId('document-links')).toHaveText('Links (3 active)');
    await page.getByTestId('document-links').click();
    const view = page.getByTestId('links-view');
    await expect(view.getByTestId('doc-link-lnk_1')).toContainText('Link 1');
    await expect(view.getByTestId('doc-link-lnk_1')).toContainText('by Rehema');
    await expect(view.getByTestId('doc-link-lnk_1')).toContainText('Never opened');
    await expect(view.getByTestId('doc-link-lnk_2')).toContainText('Last opened');
    await expect(view.getByTestId('doc-link-lnk_2')).toContainText('SW');
    await expect(view).not.toContainText('https://');
    expect(callsTo(calls, 'GET', '/vendor/document-links')[0].search.get('docType')).toBe('sale');
    expect(callsTo(calls, 'GET', '/vendor/document-links')[0].search.get('docId')).toBe('sal_1');

    await view.getByRole('button', { name: 'Turn off link 2' }).click();
    await expect(view.getByTestId('links-confirm')).toContainText("This can't be undone.");
    await view.getByTestId('links-confirm-yes').click();
    await expect(view.getByTestId('doc-link-lnk_2')).toContainText('Turned off');
    await expect(page.locator('#doc-link-status-lnk_2')).toBeFocused();
    await expect(page.getByTestId('document-links')).toHaveText('Links (2 active)');

    await view.getByTestId('links-revoke-all').click();
    await expect(view.getByTestId('links-confirm')).toContainText('Turn off all 2 links?');
    await view.getByTestId('links-confirm-yes').click();
    await expect(page.getByText('2 links turned off')).toBeVisible();
    expect(callsTo(calls, 'POST', '/vendor/document-links/revoke')[0].body).toEqual({ docType: 'sale', docId: 'sal_1' });
    await expect(view.getByTestId('links-revoke-all')).toHaveCount(0);
    await expect(view.getByRole('button', { name: /^Turn off link/ })).toHaveCount(0);
  });

  test('no links yet', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto(DOC_URL);
    await page.getByTestId('document-links').click();
    await expect(page.getByTestId('links-empty')).toContainText('No links yet.');
  });
});

test.describe('entry points', () => {
  test('payment receipt and statement open the document view with their kind; the payment share goes under the customer', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'GET /vendor/documents/payment/pay_1': docRoute({ doc: doc({ docType: 'payment_receipt', number: 'PMT-000001', lines: [], paidTowards: [], stillOwedTzs: 0 }) }),
      'POST /vendor/customers/cus_juma/payments/pay_1/share': { status: 201, json: { ...shareRes(), docType: 'payment_receipt', docId: 'pay_1', number: 'PMT-000001' } },
    }));
    await page.goto('/vendor/customers/?id=cus_juma&tab=payments&payment=pay_1');
    await expect(page.getByTestId('payment-document')).toHaveAttribute('href', '/vendor/documents/?type=payment&id=pay_1&customer=cus_juma');
    await page.getByTestId('payment-done').click();
    await page.getByTestId('customer-statement').click();
    await expect(page.getByTestId('statement-document')).toHaveAttribute('href', '/vendor/documents/?type=statement&id=cus_juma');
    await page.keyboard.press('Escape');

    await page.goto('/vendor/documents/?type=payment&id=pay_1&customer=cus_juma');
    await expect(page.getByTestId('document-heading')).toHaveText('Payment receipt PMT-000001');
    await expect(page.getByTestId('document-back')).toHaveAttribute('href', '/vendor/customers/?id=cus_juma&tab=payments&payment=pay_1');
    await page.getByTestId('document-share').click();
    await page.getByRole('dialog').getByTestId('share-copy').click();
    await expect.poll(() => callsTo(calls, 'POST', '/vendor/customers/cus_juma/payments/pay_1/share').length).toBe(1);
    expect(calls.outside).toEqual([]);
  });
});

test.describe('tax details', () => {
  const taxBase = (extra: Routes = {}) => base({
    'GET /vendor/tax-profile': { json: { taxProfile: taxProfile() } },
    'GET /me/kyc': { json: { documents: [] } },
    ...extra,
  });

  test('VAT off: no Tax details in the nav and the route goes back', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, taxBase({ 'GET /vendor/me': { json: me({ tools: tools({ vat: false }) }) } }));
    await page.goto('/vendor/');
    await expect(page.getByRole('link', { name: 'Sales', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tax details' })).toHaveCount(0);
    await page.goto('/vendor/settings/tax/');
    await expect(page).toHaveURL(/\/vendor\/$/);
    expect(callsTo(calls, 'GET', '/vendor/tax-profile')).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('owner registers: validation, certificate upload, then PUT and "Waiting for review"', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let saved: Record<string, unknown> | null = null;
    const calls = await mockApi(page, taxBase({
      'POST /me/kyc/documents/vat_certificate/file': { json: { documents: [{ id: 'pdoc_vat1', requirementKey: 'vat_certificate', status: 'pending', hasFile: true, fileName: 'vat.pdf', mimeType: 'application/pdf', createdAt: NOW }] } },
      'PUT /vendor/tax-profile': (req: Request) => {
        saved = req.postDataJSON();
        return { json: { taxProfile: taxProfile({ vatRegistered: true, status: 'pending', tin: '123456789', vrn: '40012345X', certificateDocumentId: 'pdoc_vat1', pending: { tin: '123456789', vrn: '40012345X', certificateDocumentId: 'pdoc_vat1', submittedAt: NOW }, updatedAt: '2026-10-20T09:00:00.000Z' }) } };
      },
    }));
    await page.goto('/vendor/');
    await page.getByRole('link', { name: 'Tax details' }).click();
    await expect(page).toHaveURL(/\/vendor\/settings\/tax\/?$/);
    await expect(page.getByTestId('tax-status')).toContainText('Not registered for VAT.');
    await page.getByTestId('tax-registered').check();
    await page.getByTestId('tax-save').click();
    await expect(page.getByText('Enter the 9-digit TIN.')).toBeVisible();
    await expect(page.getByText('Enter the VRN as shown on your certificate.')).toBeVisible();
    await expect(page.getByText('Add your VAT certificate.')).toBeVisible();
    await expect(page.getByTestId('tax-tin')).toBeFocused();
    expect(callsTo(calls, 'PUT', '/vendor/tax-profile')).toHaveLength(0);

    await page.getByTestId('tax-tin').fill('123-456-789');
    await page.getByTestId('tax-vrn').fill('40-012345-X');
    await page.getByTestId('tax-cert-input').setInputFiles({ name: 'vat.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 cert') });
    await expect(page.getByTestId('tax-cert-name')).toHaveText('vat.pdf');
    const upload = callsTo(calls, 'POST', '/me/kyc/documents/vat_certificate/file')[0];
    expect(upload.raw ?? '').toContain('name="file"');
    await page.getByTestId('tax-save').click();
    await expect(page.getByText("Saved. We'll review it soon.")).toBeVisible();
    expect(saved).toEqual({ vatRegistered: true, vrn: '40-012345-X', tin: '123456789', certificateDocumentId: 'pdoc_vat1', updatedAt: '2026-10-20T08:00:00.000Z' });
    await expect(page.getByTestId('tax-status')).toContainText('Waiting for review.');
    expect(calls.outside).toEqual([]);
  });

  test('TIN from KYC is read-only; 409 tax_profile_changed reloads; a server vrn_invalid shows on the field', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let n = 0;
    const calls = await mockApi(page, taxBase({
      'GET /vendor/tax-profile': { json: { taxProfile: taxProfile({ tin: '111222333', tinFromKyc: true, certificateDocumentId: 'pdoc_v', vatRegistered: true, status: 'rejected', rejectReason: 'number_mismatch', vrn: '40012345X' }) } },
      'GET /me/kyc': { json: { documents: [{ id: 'pdoc_v', requirementKey: 'vat_certificate', status: 'rejected', hasFile: true, fileName: 'cert.png', mimeType: 'image/png', createdAt: NOW }] } },
      'PUT /vendor/tax-profile': () => (++n === 1 ? { status: 400, json: { error: 'vrn_invalid' } } : { status: 409, json: { error: 'tax_profile_changed', updatedAt: NOW } }),
    }));
    await page.goto('/vendor/settings/tax/');
    await expect(page.getByTestId('tax-status')).toContainText("Not accepted: The VRN doesn't match the certificate");
    await expect(page.getByTestId('tax-tin')).toHaveAttribute('readonly', '');
    await expect(page.getByText('From your verification')).toBeVisible();
    await expect(page.getByTestId('tax-cert-name')).toHaveText('cert.png');
    await page.getByTestId('tax-send-again').click();
    await expect(page.getByTestId('tax-vrn')).toBeFocused();
    await page.getByTestId('tax-vrn').fill('40012345Y');
    await page.getByTestId('tax-save').click();
    await expect(page.getByText('Enter the VRN as shown on your certificate.')).toBeVisible();
    expect(callsTo(calls, 'PUT', '/vendor/tax-profile')[0].body).not.toHaveProperty('tin');
    await page.getByTestId('tax-save').click();
    await expect(page.getByText("These details changed on another device. We've reloaded them.")).toBeVisible();
    await expect.poll(() => callsTo(calls, 'GET', '/vendor/tax-profile').length).toBe(2);
  });

  test('409 case_locked on upload: the verification is under review', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, taxBase({ 'POST /me/kyc/documents/vat_certificate/file': { status: 409, json: { error: 'case_locked', caseStatus: 'in_review' } } }));
    await page.goto('/vendor/settings/tax/');
    await page.getByTestId('tax-registered').check();
    await page.getByTestId('tax-cert-input').setInputFiles({ name: 'vat.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 cert') });
    await expect(page.getByTestId('tax-case-locked')).toHaveText("Your verification is under review. You can add VAT details after it's finished.");
    await expect(page.getByTestId('tax-upload-failed')).toHaveCount(0);
  });

  test('turning VAT off on a verified profile asks first', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let body: Record<string, unknown> | null = null;
    await mockApi(page, taxBase({
      'GET /vendor/tax-profile': { json: { taxProfile: taxProfile({ vatRegistered: true, status: 'verified', inForce: true, tin: '123456789', vrn: '40012345X', certificateDocumentId: 'pdoc_v', verifiedAt: NOW, verified: { tin: '123456789', vrn: '40012345X', certificateDocumentId: 'pdoc_v', verifiedAt: NOW, certificateStands: true } }) } },
      'PUT /vendor/tax-profile': (req: Request) => { body = req.postDataJSON(); return { json: { taxProfile: taxProfile() } }; },
    }));
    await page.goto('/vendor/settings/tax/');
    await expect(page.getByTestId('tax-status')).toContainText('Verified on');
    await page.getByTestId('tax-registered').uncheck();
    await page.getByTestId('tax-save').click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText("Stop showing VAT? New sales won't include VAT.");
    await confirm.getByRole('button', { name: 'Stop VAT' }).click();
    await expect(page.getByText("Saved. New sales won't include VAT.")).toBeVisible();
    expect(body).toEqual({ vatRegistered: false, updatedAt: '2026-10-20T08:00:00.000Z' });
  });

  test('staff with `payments`: read only with the owner note, in Swahili; staff without it cannot open it', async ({ page, browser }) => {
    await signedInAs(page, STAFF, 'sw');
    const calls = await mockApi(page, taxBase({ 'GET /vendor/me': { json: staffMe(['payments']) } }));
    await page.goto('/vendor/settings/tax/');
    await expect(page.getByRole('heading', { name: 'Taarifa za kodi' })).toBeVisible();
    await expect(page.getByTestId('tax-owner-only')).toHaveText('Mmiliki wa biashara pekee ndiye anaweza kubadilisha taarifa za kodi.');
    await expect(page.getByTestId('tax-registered')).toBeDisabled();
    await expect(page.getByTestId('tax-save')).toHaveCount(0);
    expect(callsTo(calls, 'GET', '/me/kyc')).toHaveLength(0);

    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const p2 = await ctx.newPage();
    await signedInAs(p2, STAFF);
    const c2 = await mockApi(p2, taxBase({ 'GET /vendor/me': { json: staffMe(['sales']) } }));
    await p2.goto('/vendor/settings/tax/');
    await expect(p2).toHaveURL(/\/vendor\/$/);
    expect(callsTo(c2, 'GET', '/vendor/tax-profile')).toHaveLength(0);
    expect(c2.outside).toEqual([]);
    await ctx.close();
  });
});
