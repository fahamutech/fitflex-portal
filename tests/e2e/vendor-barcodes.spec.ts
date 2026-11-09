import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { codeKey, validateBarcode } from '../../src/lib/barcode-rules';
import { messages } from '../../src/lib/i18n';

// Vendor S8 barcodes in the portal (docs/design/vendor-barcodes-s8.md §6, §14), against a mocked API (contract:
// fitflex-functions#334). Shared rule vectors, gating (tools.barcodes exactly true, `products`), the Barcodes dialog
// (autofocus, Enter adds and keeps focus, validation, For, barcode_in_use on its row, Esc discard, save → row count),
// page search by code, Receive stock Enter (local code, +1, variant code, whole-product code → variant select, SKU
// fallback, several matches, lookup, unknown + quick add with and without `products`, archived, 429, network retry,
// plain text keeps S9), 375px, Swahili and accessible names. Nothing may reach a real service.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> } | 'abort';
type Handler = Reply | ((req: Request, url: URL) => Reply);
type Routes = Record<string, Handler>;
type Call = { method: string; path: string; search: URLSearchParams; body: Record<string, unknown> | null };

const ALL = ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff', 'purchases'];
const tools = (extra: Record<string, unknown> = {}) => ({ portal: true, stockLedger: true, canSeeCost: true, purchases: true, barcodes: true, ...extra });
const me = (extra: Record<string, unknown> = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ALL, approvalStatus: 'approved', accountStatus: 'active', tools: tools(), ...extra,
});
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };
const STAFF = { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' };

const product = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, vendorId: 'usr_vendor', name, priceTzs: 10000, stock: 5, status: 'active', approvalStatus: 'approved', costTzs: 5000, sku: null, variants: [], barcodes: [], ...extra,
});
const WHEY = product('prd_whey', 'Whey Protein 1kg', { stock: 10, sku: 'WP-1KG', barcodes: [{ code: '6201234567893', variant: null }] });
const GLOVES = product('prd_gloves', 'Gym Gloves', {
  stock: 7,
  variants: [{ name: 'S', stock: 3, costTzs: null, effectiveCostTzs: 5000 }, { name: 'M', stock: 4, costTzs: null, effectiveCostTzs: 5000 }, { name: 'L', stock: 0, costTzs: null, effectiveCostTzs: 5000 }],
  barcodes: [{ code: 'GLOVES-ALL', variant: null }, { code: '036000291452', variant: 'M' }],
});
const SHAKER = product('prd_shaker', 'Shaker', { sku: '6201234567886' });
const BAND_A = product('prd_band_a', 'Band light', { sku: 'BAND' });
const BAND_B = product('prd_band_b', 'Band heavy', { sku: 'band' });
const OLD = product('prd_old', 'Old shaker', { status: 'archived', stock: 0, barcodes: [{ code: '12345670', variant: null }] });
const NEW = product('prd_new', 'Kettlebell 8kg', { barcodes: [{ code: '5012345678900', variant: null }] });
const PRODUCTS = [WHEY, GLOVES, SHAKER, BAND_A, BAND_B, OLD];
const lookupMatch = (p: ReturnType<typeof product>, extra: Record<string, unknown> = {}) => ({
  productId: p.id, name: p.name, variant: null, variants: null, priceTzs: p.priceTzs, discountPriceTzs: null, stock: p.stock,
  status: p.status, approvalStatus: 'approved', sku: p.sku, matchedBy: 'barcode', ...extra,
});

async function signedInAs(page: Page, user: Record<string, unknown>, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
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
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? null, headers: reply.headers });
  });
  return calls;
}
const callsOf = (calls: Call[], method: string, path: string) => calls.filter(c => c.method === method && c.path === path);

const base = (extra: Routes = {}): Routes => ({
  'GET /vendor/me': { json: me() },
  'GET /vendor/products': { json: PRODUCTS },
  'GET /vendor/stock/low': { json: [] },
  'GET /vendor/orders': { json: { orders: [], nextCursor: null } },
  'GET /vendor/suppliers': { json: { suppliers: [], nextCursor: null } },
  'GET /vendor/purchases/last-costs': { json: { rows: [] } },
  'GET /shop/categories': { json: { categories: [] } },
  ...extra,
});

const table = (page: Page) => page.getByTestId('vendor-products-table');
async function openBarcodes(page: Page, id: string) {
  await page.goto('/vendor/products/');
  await table(page).getByTestId(`barcodes-${id}`).click();
  await expect(page.getByTestId('barcodes-dialog')).toBeVisible();
}
/** Type into an item search and press Enter, as a USB scanner does. */
async function scan(page: Page, idx: number, text: string) {
  const input = page.getByTestId(`receive-product-${idx}`);
  await input.fill(text);
  await input.press('Enter');
}

// ── Shared rules ─────────────────────────────────────────────────────────────

test.describe('barcode rules (shared vectors with functions and mobile)', () => {
  const file = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'barcode-vectors.json'), 'utf8')) as {
    version: number; vectors: Array<{ input: string; codeKey?: string; error?: string; reason?: string }>;
  };
  test('every vector gives the same codeKey or error as the server', () => {
    expect(file.version).toBe(1);
    expect(file.vectors.length).toBeGreaterThan(20);
    for (const v of file.vectors) {
      const got = validateBarcode(v.input);
      if (v.error) {
        expect(got, v.input).toMatchObject({ error: v.error, ...(v.reason ? { reason: v.reason } : {}) });
      } else {
        expect(got, v.input).toEqual({ code: v.input.trim(), codeKey: v.codeKey });
        expect(codeKey(v.input), v.input).toBe(v.codeKey);
      }
    }
  });
  test('every new string exists in English and Swahili', () => {
    const en = Object.keys(messages.en).filter(k => k.startsWith('vendor.barcodes.') || k.startsWith('vendor.scan.'));
    expect(en.length).toBeGreaterThan(30);
    const sw = messages.sw as Record<string, string>;
    for (const k of en) expect(sw[k], k).toBeTruthy();
    // "msimbopau" is the barcode term (spec §10).
    expect(sw['vendor.barcodes.title']).toBe('Misimbopau');
  });
});

// ── Gating ───────────────────────────────────────────────────────────────────

test.describe('gating', () => {
  test('tool off (missing, false or not exactly true): no Barcodes action, no count; Receive Enter stays S9 and never looks up', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let barcodes: unknown = undefined;
    const calls = await mockApi(page, base({ 'GET /vendor/me': () => ({ json: me({ tools: tools({ barcodes }) }) }) }));
    // Dev server: open /vendor once so later client navigations are compiled.
    await page.goto('/vendor/');
    for (const value of [undefined, false, 'true']) {
      barcodes = value;
      await page.goto('/vendor/products/');
      await expect(table(page).getByTestId('product-row-prd_whey')).toBeVisible();
      await expect(page.getByTestId('barcodes-prd_whey')).toHaveCount(0);
      await expect(table(page)).not.toContainText('barcode');
    }
    await page.goto('/vendor/purchases/receive/');
    await scan(page, 0, '6201234567893');
    await expect(page.getByTestId('receive-product-0')).toHaveValue('6201234567893');
    await expect(page.getByTestId('receive-product-0-status')).toHaveCount(0);
    expect(callsOf(calls, 'GET', '/vendor/products/lookup')).toEqual([]);
    expect(calls.outside).toEqual([]);
  });

  test('staff without `products` (purchases only): no Barcodes action; an unknown code asks someone who manages products', async ({ page }) => {
    await signedInAs(page, STAFF);
    await mockApi(page, base({
      'GET /vendor/me': { json: me({ userType: 'vendor_staff', vendorRole: 'inventory_manager', permissions: ['purchases'] }) },
      'GET /vendor/products/lookup': { json: { code: '4006381333931', codeKey: '4006381333931', matches: [] } },
    }));
    await page.goto('/vendor/purchases/receive/');
    await scan(page, 0, '4006381333931');
    const status = page.getByTestId('receive-product-0-status');
    await expect(status).toContainText('No product has the code 4006381333931.');
    await expect(page.getByTestId('receive-product-0-ask-products')).toHaveText('Ask someone who manages products to add this code.');
    await expect(page.getByTestId('receive-product-0-add-code')).toHaveCount(0);
  });
});

// ── Barcodes dialog ──────────────────────────────────────────────────────────

test.describe('Barcodes dialog', () => {
  test('autofocus, Enter adds and keeps focus, validation, save → toast and row count; focus returns to the row action', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'PUT /vendor/products/prd_whey': req => ({ json: { ...WHEY, barcodes: (req.postDataJSON() as { barcodes: unknown[] }).barcodes.map(b => ({ variant: null, ...(b as object) })) } }),
    }));
    await openBarcodes(page, 'prd_whey');
    const dialog = page.getByTestId('barcodes-dialog');
    await expect(dialog.getByRole('heading', { name: 'Barcodes for Whey Protein 1kg' })).toBeVisible();
    await expect(dialog.getByTestId('barcode-code')).toHaveText(['6201234567893']);
    const input = page.getByTestId('barcode-input');
    await expect(input).toBeFocused();
    await expect(dialog).toContainText('A USB scanner types the code and presses Enter.');

    // Client checks (same rules as the server), value kept, focus kept.
    const cases: Array<[string, string]> = [
      ['123', 'A barcode has at least 4 characters.'],
      ['A123456789012345678901234567890123456789012345678', 'A barcode has at most 48 characters.'],
      ['AB 12', 'Use letters, numbers and symbols only, with no spaces.'],
      ['6201234567891', "This number doesn't look right. Check the last digit."],
      ['6201234567893', 'This barcode is already in the list.'],
    ];
    for (const [code, message] of cases) {
      await input.fill(code);
      await input.press('Enter');
      await expect(page.getByTestId('barcode-input-error')).toHaveText(message);
      await expect(input).toHaveValue(code);
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
    }
    // Three scans in a row (8 digits are accepted; letters compared upper case).
    for (const code of ['12345671', 'abc-123', '0036000291452']) {
      await input.fill(code);
      await input.press('Enter');
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
    }
    await expect(dialog.getByTestId('barcode-code')).toHaveText(['6201234567893', '12345671', 'abc-123', '0036000291452']);
    await input.fill('ABC-123');
    await input.press('Enter');
    await expect(page.getByTestId('barcode-input-error')).toHaveText('This barcode is already in the list.');
    await input.fill('');
    // Remove one.
    await dialog.getByRole('button', { name: 'Remove barcode 0036000291452' }).click();
    await expect(input).toBeFocused();
    await page.getByTestId('barcodes-save').click();
    await expect(page.getByText('Barcodes saved.')).toBeVisible();
    await expect(page.getByTestId('barcodes-dialog')).toHaveCount(0);
    expect(callsOf(calls, 'PUT', '/vendor/products/prd_whey')[0].body).toEqual({ barcodes: [{ code: '6201234567893' }, { code: '12345671' }, { code: 'abc-123' }] });
    await expect(table(page).getByTestId('product-row-prd_whey')).toContainText('3 barcodes');
    await expect(table(page).getByTestId('barcodes-prd_whey')).toBeFocused();
  });

  test('variants: For picks a variant and the body names it; never inside a variant object', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'PUT /vendor/products/prd_gloves': { json: { ...GLOVES } } }));
    await openBarcodes(page, 'prd_gloves');
    const dialog = page.getByTestId('barcodes-dialog');
    await expect(dialog).toContainText('GLOVES-ALL · Whole product');
    await expect(dialog).toContainText('036000291452 · M');
    await page.getByTestId('barcode-for').selectOption('S');
    await page.getByTestId('barcode-input').fill('4006381333931');
    await page.getByTestId('barcode-add').click();
    await expect(dialog).toContainText('4006381333931 · S');
    await page.getByTestId('barcodes-save').click();
    await expect(page.getByText('Barcodes saved.')).toBeVisible();
    const body = callsOf(calls, 'PUT', '/vendor/products/prd_gloves')[0].body!;
    expect(body).toEqual({ barcodes: [{ code: 'GLOVES-ALL' }, { code: '036000291452', variant: 'M' }, { code: '4006381333931', variant: 'S' }] });
    expect(Object.keys(body)).toEqual(['barcodes']);
  });

  test('409 barcode_in_use marks the row and focuses its Remove; other errors show an alert; feature_disabled closes', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let n = 0;
    await mockApi(page, base({
      'PUT /vendor/products/prd_shaker': () => (++n === 1
        ? { status: 409, json: { error: 'barcode_in_use', code: '0036000291452', productId: 'prd_gloves', name: 'Gym Gloves', variant: 'M', message: { en: 'Already on Gym Gloves.', sw: 'Tayari upo kwenye Gym Gloves.' } } }
        : n === 2 ? { status: 400, json: { error: 'too_many_barcodes', max: 20 } }
        : n === 3 ? { status: 400, json: { error: 'something_new', message: { en: 'Server says no.', sw: 'Seva imekataa.' } } }
        : n === 4 ? { status: 409, json: { error: 'barcode_in_use', code: '4006381333931', productId: null, name: null, variant: null } }
        : { status: 404, json: { error: 'feature_disabled' } }),
    }));
    await openBarcodes(page, 'prd_shaker');
    const dialog = page.getByTestId('barcodes-dialog');
    await expect(dialog.getByTestId('barcodes-none')).toHaveText('No barcodes yet.');
    for (const code of ['4006381333931', '036000291452']) {
      await page.getByTestId('barcode-input').fill(code);
      await page.getByTestId('barcode-input').press('Enter');
    }
    await page.getByTestId('barcodes-save').click();
    await expect(dialog.getByTestId('barcode-row-error')).toHaveText('Already on Gym Gloves.');
    await expect(dialog.getByTestId('barcode-row').nth(1)).toContainText('Already on Gym Gloves.');
    await expect(dialog.getByRole('button', { name: 'Remove barcode 036000291452' })).toBeFocused();
    await page.getByTestId('barcodes-save').click();
    await expect(page.getByTestId('barcodes-alert')).toHaveText('A product can have up to 20 barcodes.');
    await page.getByTestId('barcodes-save').click();
    await expect(page.getByTestId('barcodes-alert')).toHaveText('Server says no.');
    // functions#334 L-1: the holder is unknown → a dialog alert, not "Already on" on the first row.
    await page.getByTestId('barcodes-save').click();
    await expect(page.getByTestId('barcodes-alert')).toHaveText('This code is in use. Try again.');
    await expect(page.getByTestId('barcode-row-error')).toHaveCount(0);
    await page.getByTestId('barcodes-save').click();
    await expect(page.getByText("Barcodes aren't available right now.")).toBeVisible();
    await expect(page.getByTestId('barcodes-dialog')).toHaveCount(0);
  });

  test('Escape: no changes closes and returns focus; with changes asks to discard', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await openBarcodes(page, 'prd_whey');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('barcodes-dialog')).toHaveCount(0);
    await expect(table(page).getByTestId('barcodes-prd_whey')).toBeFocused();
    await table(page).getByTestId('barcodes-prd_whey').click();
    await page.getByTestId('barcode-input').fill('12345671');
    await page.getByTestId('barcode-input').press('Enter');
    await page.keyboard.press('Escape');
    const confirm = page.getByRole('alertdialog', { name: 'Discard changes to barcodes?' });
    await expect(confirm).toBeVisible();
    await expect(page.getByTestId('barcodes-dialog')).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByTestId('barcodes-dialog').getByTestId('barcode-code')).toHaveText(['6201234567893', '12345671']);
    await page.getByTestId('barcodes-cancel').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('barcodes-dialog')).toHaveCount(0);
    expect(callsOf(calls, 'PUT', '/vendor/products/prd_whey')).toEqual([]);
  });

  test('page search also matches codes (by codeKey)', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await page.goto('/vendor/products/');
    await page.getByTestId('products-search').fill('00036000291452');
    await expect(table(page).getByTestId('product-row-prd_gloves')).toBeVisible();
    await expect(table(page).getByTestId('product-row-prd_whey')).toHaveCount(0);
    await page.getByTestId('products-search').fill('gloves-all');
    await expect(table(page).getByTestId('product-row-prd_gloves')).toBeVisible();
    await expect(table(page).getByTestId('product-row-prd_gloves')).toContainText('2 barcodes');
  });
});

// ── Receive stock: Enter matches codes ───────────────────────────────────────

test.describe('Receive stock: Enter with a code', () => {
  test('local code adds a line, again makes qty 2, focus stays in an empty item search, announced; no lookup', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/purchases/receive/');
    await scan(page, 0, '6201234567893');
    await expect(page.getByTestId('receive-line-0')).toContainText('Whey Protein 1kg');
    await expect(page.getByTestId('receive-qty-0')).toHaveValue('1');
    await expect(page.getByTestId('receive-product-1')).toBeFocused();
    await expect(page.getByTestId('receive-product-1')).toHaveValue('');
    await expect(page.getByTestId('receive-scan-live')).toHaveText('Whey Protein 1kg added · 1 received');
    await page.keyboard.type('6201234567893');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('receive-qty-0')).toHaveValue('2');
    await expect(page.getByTestId('receive-product-1')).toBeFocused();
    await expect(page.getByTestId('receive-scan-live')).toHaveText('Whey Protein 1kg added · 2 received');
    // A variant code (UPC-A stored, EAN-13 scanned) → that variant.
    await scan(page, 1, '0036000291452');
    await expect(page.getByTestId('receive-line-1')).toContainText('Gym Gloves');
    await expect(page.getByTestId('receive-variant-1')).toHaveValue('M');
    // A whole-product code on a product whose variants keep stock → the line's variant select, focused.
    await scan(page, 2, 'gloves-all');
    await expect(page.getByTestId('receive-variant-2')).toBeFocused();
    await expect(page.getByTestId('receive-variant-2')).toHaveValue('');
    expect(callsOf(calls, 'GET', '/vendor/products/lookup')).toEqual([]);
  });

  test('SKU fallback: one match adds, several keep the listbox with just those; archived is refused', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base());
    await page.goto('/vendor/purchases/receive/');
    await scan(page, 0, ' wp-1kg ');
    await expect(page.getByTestId('receive-line-0')).toContainText('Whey Protein 1kg');
    await scan(page, 1, 'BAND');
    await expect(page.getByTestId('receive-product-1-status')).toHaveText('More than one product has this code. Choose one.');
    const listbox = page.getByRole('listbox', { name: 'Item 2' });
    await expect(listbox.getByRole('option')).toHaveCount(2);
    await expect(listbox.getByTestId('product-option-prd_band_a')).toBeVisible();
    await expect(listbox.getByTestId('product-option-prd_band_b')).toBeVisible();
    await page.getByTestId('receive-product-1').press('ArrowDown');
    await page.getByTestId('receive-product-1').press('Enter');
    await expect(page.getByTestId('receive-line-1')).toContainText('Band heavy');
    await page.getByTestId('receive-add-row').click();
    await scan(page, 2, '12345670');
    await expect(page.getByTestId('receive-product-2-status')).toHaveText('Old shaker is archived. Restore it in Products first.');
    await expect(page.getByTestId('receive-product-2')).toHaveValue('12345670');
    expect(callsOf(calls, 'GET', '/vendor/products/lookup')).toEqual([]);
  });

  test('lookup: a code saved on another device reloads the list and adds; 429, network failure + Try again', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let list = PRODUCTS;
    let mode: 'ok' | 'limited' | 'down' = 'ok';
    const calls = await mockApi(page, base({
      'GET /vendor/products': () => ({ json: list }),
      'GET /vendor/products/lookup': (_req, url) => {
        if (mode === 'limited') return { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 12 }, headers: { 'Retry-After': '12' } };
        if (mode === 'down') return 'abort';
        const code = url.searchParams.get('code');
        return { json: { code, codeKey: code, matches: code === '5012345678900' ? [lookupMatch(NEW)] : [] } };
      },
    }));
    await page.goto('/vendor/purchases/receive/');
    await expect(page.getByTestId('receive-product-0')).toBeVisible();
    list = [...PRODUCTS, NEW];
    await scan(page, 0, '5012345678900');
    await expect(page.getByTestId('receive-line-0')).toContainText('Kettlebell 8kg');
    expect(callsOf(calls, 'GET', '/vendor/products/lookup')[0].search.get('code')).toBe('5012345678900');
    expect(callsOf(calls, 'GET', '/vendor/products').length).toBeGreaterThanOrEqual(2);

    mode = 'limited';
    await scan(page, 1, '4006381333931');
    await expect(page.getByTestId('receive-product-1-status')).toHaveText('Too many scans. Wait 12 seconds.');
    mode = 'down';
    await scan(page, 1, '4006381333931');
    await expect(page.getByTestId('receive-product-1-status')).toContainText("Couldn't check this code. Try again.");
    mode = 'ok';
    list = [...PRODUCTS, NEW];
    await page.getByTestId('receive-product-1-retry').click();
    await expect(page.getByTestId('receive-product-1-status')).toContainText('No product has the code 4006381333931.');
  });

  test('unknown code with `products`: Add this code to a product → addBarcodes, toast, and the line is added', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'GET /vendor/products/lookup': (_req, url) => ({ json: { code: url.searchParams.get('code'), codeKey: url.searchParams.get('code'), matches: [] } }),
      'PUT /vendor/products/prd_gloves': { json: { ...GLOVES, barcodes: [...GLOVES.barcodes, { code: '4006381333931', variant: 'S' }] } },
    }));
    await page.goto('/vendor/purchases/receive/');
    await scan(page, 0, '4006381333931');
    await expect(page.getByTestId('receive-product-0-status')).toContainText('No product has the code 4006381333931.');
    await expect(page.getByTestId('receive-product-0')).toHaveAttribute('aria-describedby', /.+/);
    await page.getByTestId('receive-product-0-add-code').click();
    const dialog = page.getByTestId('add-code-dialog');
    await expect(dialog.getByRole('heading', { name: 'Add this code to a product' })).toBeVisible();
    await expect(dialog.getByTestId('add-code-value')).toHaveText('4006381333931');
    await expect(page.getByTestId('add-code-save')).toBeDisabled();
    await page.getByTestId('add-code-product').fill('glove');
    await dialog.getByTestId('product-option-prd_gloves').click();
    await page.getByTestId('add-code-for').selectOption('S');
    await expect(dialog.getByTestId('add-code-confirm-text')).toHaveText('Add code 4006381333931 to Gym Gloves (S)?');
    await page.getByTestId('add-code-save').click();
    await expect(page.getByText('Code added to Gym Gloves.')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(callsOf(calls, 'PUT', '/vendor/products/prd_gloves')[0].body).toEqual({ addBarcodes: [{ code: '4006381333931', variant: 'S' }] });
    await expect(page.getByTestId('receive-line-0')).toContainText('Gym Gloves');
    await expect(page.getByTestId('receive-variant-0')).toHaveValue('S');
    // The code is now known locally: scanning it again is +1 with no lookup.
    const before = callsOf(calls, 'GET', '/vendor/products/lookup').length;
    await scan(page, 1, '4006381333931');
    await expect(page.getByTestId('receive-qty-0')).toHaveValue('2');
    expect(callsOf(calls, 'GET', '/vendor/products/lookup').length).toBe(before);
  });

  test('quick add refused with barcode_in_use shows "Already on {name}"', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base({
      'GET /vendor/products/lookup': { json: { code: '4006381333931', codeKey: '4006381333931', matches: [] } },
      'PUT /vendor/products/prd_whey': { status: 409, json: { error: 'barcode_in_use', code: '4006381333931', productId: 'prd_shaker', name: 'Shaker', variant: null } },
    }));
    await page.goto('/vendor/purchases/receive/');
    await scan(page, 0, '4006381333931');
    await page.getByTestId('receive-product-0-add-code').click();
    await page.getByTestId('add-code-product').fill('whey');
    await page.getByTestId('add-code-dialog').getByTestId('product-option-prd_whey').click();
    await page.getByTestId('add-code-save').click();
    await expect(page.getByTestId('add-code-error')).toHaveText('Already on Shaker.');
    expect(messages.sw['vendor.barcodes.err.inUseRetry']).toBe('Msimbopau huu unatumika. Jaribu tena.');
  });

  test('plain text keeps S9 Enter: a name with a space never looks up; a word with no match falls back to the highlighted hit', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/products/lookup': (_req, url) => ({ json: { code: url.searchParams.get('code'), codeKey: '', matches: [] } }) }));
    await page.goto('/vendor/purchases/receive/');
    await scan(page, 0, 'gym glo');
    await expect(page.getByTestId('receive-line-0')).toContainText('Gym Gloves');
    expect(callsOf(calls, 'GET', '/vendor/products/lookup')).toEqual([]);
    await page.getByTestId('receive-add-row').click();
    await page.getByTestId('receive-product-1').fill('shaker');
    await expect(page.getByTestId('product-option-prd_shaker')).toBeVisible();
    await page.getByTestId('receive-product-1').press('Enter');
    await expect(page.getByTestId('receive-line-1')).toContainText('Shaker');
    expect(callsOf(calls, 'GET', '/vendor/products/lookup').length).toBe(1);
  });
});

// ── Layout, language, accessibility ──────────────────────────────────────────

test.describe('375px, Swahili and accessible names', () => {
  test('375px: products cards and the dialog, and Receive with the inline status, never scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signedInAs(page, VENDOR);
    await mockApi(page, base({ 'GET /vendor/products/lookup': { json: { code: '4006381333931', codeKey: '4006381333931', matches: [] } } }));
    await page.goto('/vendor/products/');
    await expect(page.getByTestId('barcode-count-prd_gloves')).toHaveText('2 barcodes');
    const card = page.locator('ul[aria-label="Products"]').getByTestId('barcodes-prd_gloves');
    await expect(card).toHaveCSS('min-height', '44px');
    await card.click();
    await expect(page.getByTestId('barcode-input')).toBeFocused();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    for (const id of ['barcode-add', 'barcodes-save', 'barcodes-cancel']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box!.height, id).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press('Escape');
    await page.goto('/vendor/purchases/receive/');
    await scan(page, 0, '4006381333931');
    await expect(page.getByTestId('receive-product-0-add-code')).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test('Swahili: row action, dialog and Receive messages', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    await mockApi(page, base({ 'GET /vendor/products/lookup': { json: { code: '4006381333931', codeKey: '4006381333931', matches: [] } } }));
    await page.goto('/vendor/products/');
    await expect(table(page).getByTestId('barcodes-prd_whey')).toHaveText('Misimbopau');
    await expect(table(page).getByTestId('product-row-prd_gloves')).toContainText('Misimbopau 2');
    await table(page).getByTestId('barcodes-prd_whey').click();
    await expect(page.getByTestId('barcodes-dialog').getByRole('heading', { name: 'Misimbopau ya Whey Protein 1kg' })).toBeVisible();
    await page.getByTestId('barcode-input').fill('123');
    await page.getByTestId('barcode-input').press('Enter');
    await expect(page.getByTestId('barcode-input-error')).toHaveText('Msimbopau una angalau herufi 4.');
    // A refused code is not in the list, so nothing changed: Cancel closes with no discard question.
    await page.getByTestId('barcodes-cancel').click();
    await expect(page.getByTestId('barcodes-dialog')).toHaveCount(0);
    await page.goto('/vendor/purchases/receive/');
    await scan(page, 0, '4006381333931');
    await expect(page.getByTestId('receive-product-0-status')).toContainText('Hakuna bidhaa yenye msimbo 4006381333931.');
    await expect(page.getByTestId('receive-product-0-add-code')).toHaveText('Weka msimbo huu kwenye bidhaa');
  });

  test('accessible names: every control in the dialog and the Receive status is named; the row reads digit by digit', async ({ page }) => {
    await signedInAs(page, VENDOR);
    await mockApi(page, base());
    await openBarcodes(page, 'prd_gloves');
    const dialog = page.getByRole('dialog', { name: 'Barcodes for Gym Gloves' });
    await expect(dialog.getByRole('textbox', { name: 'Barcode' })).toBeFocused();
    await expect(dialog.getByRole('combobox', { name: 'For' })).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Barcodes on this product' })).toBeVisible();
    await expect(dialog.getByText('Barcode 0 3 6 0 0 0 2 9 1 4 5 2, M')).toBeAttached();
    const unnamed = await dialog.locator('button, input, select').evaluateAll(els => els.filter(el => {
      const name = el.getAttribute('aria-label') || (el as HTMLElement).innerText?.trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim());
      return !name;
    }).length);
    expect(unnamed).toBe(0);
  });
});
