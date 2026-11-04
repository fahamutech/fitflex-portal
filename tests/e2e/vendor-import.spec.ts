import { expect, test, type Page, type Request } from '@playwright/test';

// Vendor Smart Import (portal wizard) against a mocked API (contract: fitflex-functions #326, functions/vendor-imports.mjs):
// gating (tools.import missing/off = hidden, `import` permission), history list + empty state + template download,
// choose + upload (multipart without a hand-set Content-Type, xlsx and size checks, duplicate_file, quota), columns
// (synonym/fuzzy confirmations, PUT mapping confirm:true), check (problem rows first, server text in EN and SW, paging),
// confirm + apply loop (includeNeedsReview default off, progress, 409/503 waits, calm pause), result (counts, paused
// products note, errors.csv with the sign-in header, retry), discard and its refusals, expired, staff and profile, 375px.
// Network guard: every request outside localhost is aborted and asserted empty; the API is answered here.
// Nothing may reach the live API or any other service.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.use({ serviceWorkers: 'block' });

// The dev server compiles a page on its first visit, which can take over a minute on a cold start and made the first
// test flaky. Visit the pages once up front (localhost only, no browser, no API).
test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(240_000);
  const ctx = await playwright.request.newContext({ baseURL });
  for (const path of ['/vendor/', '/vendor/import/', '/vendor/import/new/', '/vendor/import/batch/']) await ctx.get(path, { timeout: 200_000 });
  await ctx.dispose();
});

type Reply = { status?: number; json?: unknown; body?: string; headers?: Record<string, string>; delayMs?: number };
type Routes = Record<string, Reply | ((req: Request, url: URL) => Reply)>;
type Call = { method: string; path: string; search: URLSearchParams; body: Record<string, unknown> | null; raw: Buffer | null; headers: Record<string, string> };

const ALL = ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff', 'import'];
const tools = (extra: Record<string, unknown> = {}) => ({ portal: true, stockLedger: true, canSeeCost: true, canSeeOrderMoney: true, import: true, importLimits: { maxBytes: 2097152, maxRows: 2000 }, ...extra });
const me = (extra: Record<string, unknown> = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ALL, approvalStatus: 'approved', accountStatus: 'active', tools: tools(), ...extra,
});
const staffMe = (permissions: string[], extra: Record<string, unknown> = {}) => me({ userType: 'vendor_staff', vendorRole: 'admin', permissions, ...extra });
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };
const STAFF = { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' };
const NOW = new Date(Date.now() - 3_600_000).toISOString();

const counts = (extra: Record<string, number> = {}) => ({ total: 4, valid: 2, needs_review: 1, invalid: 1, pending: 4, applied: 0, failed: 0, skipped: 0, ...extra });
const batch = (extra: Record<string, unknown> = {}) => ({
  id: 'imp_1', entity: 'products', status: 'ready', filename: 'products.csv', sizeBytes: 1200, templateVersion: null, delimiter: ',',
  counts: counts(), createdBy: 'usr_vendor', includeNeedsReview: null, needsConfirmation: false, missingRequired: [],
  createdAt: NOW, updatedAt: NOW, applyStartedAt: null, finishedAt: null, ...extra,
});
const col = (source: string, field: string | null, match: string, sample: string[] = [], confirmed = false) => ({ source, field, match, confirmed, sample });
const COLUMNS = [
  col('Bidhaa', 'name', 'synonym', ['Whey Protein', 'Shaker']),
  col('Bei ya kuuza', 'price_tzs', 'synonym', ['85000', '12,000']),
  col('Idadi', 'stock', 'synonym', ['10', '3']),
  col('Catgory', 'category', 'fuzzy', ['Supplements']),
  col('Notes', null, 'none', []),
];
const issue = (code: string, severity: string, en: string, sw: string, field: string | null = null) => ({ code, field, severity, params: {}, message: { en, sw } });
const ROWS = [
  { id: 'r3', rowNo: 3, status: 'invalid', applyState: 'pending', values: { name: 'Bands' }, resultId: null, lastError: null, attempts: 0,
    issues: [issue('price_invalid', 'error', 'The value in Price (TSh) is not a valid amount.', 'Thamani ya Bei (TSh) si kiasi sahihi.', 'price_tzs')] },
  { id: 'r4', rowNo: 4, status: 'needs_review', applyState: 'pending', values: { name: 'Mat', price_tzs: 40000, category: 'yogaa' }, resultId: null, lastError: null, attempts: 0,
    issues: [issue('category_unknown', 'warning', 'The category is not one of ours. It will be left empty. Closest: Yoga.', 'Aina ya bidhaa si miongoni mwa zetu. Itaachwa wazi. Karibu zaidi: Yoga.', 'category')] },
  { id: 'r2', rowNo: 2, status: 'valid', applyState: 'pending', values: { name: 'Whey Protein', price_tzs: 85000, stock: 10, sku: 'WP-1' }, resultId: null, lastError: null, attempts: 0, issues: [] },
];

async function signedInAs(page: Page, user: Record<string, unknown>, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [user, locale] as const);
}

/** The guard (for the whole context) and the API. Unknown routes are 404. Every call is recorded. */
async function mockApi(page: Page, routes: Routes) {
  const calls: Call[] = [];
  const outside: string[] = [];
  page.on('pageerror', err => console.log('PAGEERROR', err.message));
  await page.context().route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => { outside.push(route.request().url()); return route.abort(); });
  await page.context().route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    let body: Record<string, unknown> | null = null;
    try { body = req.postData() && !(req.headers()['content-type'] || '').startsWith('multipart') ? JSON.parse(req.postData() as string) : null; } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, search: url.searchParams, body, raw: req.postDataBuffer(), headers: req.headers() });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req, url) : hit;
    if (reply.delayMs) await new Promise(r => setTimeout(r, reply.delayMs));
    const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Disposition, Retry-After', ...(reply.headers ?? {}) };
    if (reply.body != null) return route.fulfill({ status: reply.status ?? 200, body: reply.body, headers });
    return route.fulfill({ status: reply.status ?? 200, json: reply.json, headers }).catch(() => undefined);
  });
  return Object.assign(calls, { outside });
}

const base = (extra: Routes = {}): Routes => ({
  'GET /vendor/me': { json: me() },
  'GET /vendor/products': { json: [] },
  'GET /vendor/stock/low': { json: [] },
  'GET /vendor/orders': { json: { orders: [], nextCursor: null } },
  'GET /vendor/imports': { json: { batches: [], nextCursor: null } },
  ...extra,
});
const importCalls = (calls: Call[]) => calls.filter(c => c.path.startsWith('/vendor/imports'));
const refusal = (status: number, error: string, extra: Record<string, unknown> = {}, en = 'Server says no.', sw = 'Seva inakataa.') => ({ status, json: { error, message: { en, sw }, ...extra } });
const CSV = (name: string, size = 60) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(`name,price_tzs,stock\r\n${'x'.repeat(Math.max(0, size - 30))}\r\n`) });

test.describe('gating', () => {
  for (const [label, t] of [['missing', tools({ import: undefined })], ['false', tools({ import: false })]] as const) {
    test(`tool ${label}: no nav item, a deep link goes home quietly, no import request (fails closed)`, async ({ page }) => {
      await signedInAs(page, VENDOR);
      test.slow();
      const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: t }) } }));
      await page.goto('/vendor/import/');
      await expect(page).toHaveURL(/\/vendor\/$/, { timeout: 90_000 });
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      await expect(page.getByText("You don't have access to Smart Import.")).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Smart Import' })).toHaveCount(0);
      expect(importCalls(calls)).toHaveLength(0);
      expect(calls.outside).toEqual([]);
    });
  }

  test('staff without `import`: no nav and a deep link says no access', async ({ page }) => {
    await signedInAs(page, STAFF);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ userType: 'vendor_staff', permissions: ['products'] }) } }));
    await page.goto('/vendor/import/');
    await expect(page).toHaveURL(/\/vendor\/$/, { timeout: 45_000 });
    await expect(page.getByText("You don't have access to Smart Import.")).toBeVisible();
    await expect(page.getByRole('link', { name: 'Smart Import' })).toHaveCount(0);
    expect(importCalls(calls)).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('tool on + permission: nav item shows and opens the empty history', async ({ page }) => {
    await signedInAs(page, VENDOR);
    test.slow();
    const calls = await mockApi(page, base());
    await page.goto('/vendor/');
    await page.getByRole('link', { name: 'Smart Import' }).first().click();
    await expect(page).toHaveURL(/\/vendor\/import\/$/);
    await expect(page.getByText('No imports yet')).toBeVisible();
    await expect(page.getByTestId('import-start')).toBeVisible();
    expect(calls.outside).toEqual([]);
  });
});

test.describe('history and templates', () => {
  test('lists imports with counts, status and resume / view links; Swahili renders', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    const calls = await mockApi(page, base({
      'GET /vendor/imports': { json: { nextCursor: null, batches: [
        batch({ id: 'imp_a', filename: 'bidhaa.csv', status: 'mapping_required' }),
        batch({ id: 'imp_b', filename: 'old.csv', status: 'applied', counts: counts({ applied: 3, invalid: 1, total: 4 }) }),
      ] } },
    }));
    await page.goto('/vendor/import/');
    const items = page.getByTestId('import-item');
    await expect(items).toHaveCount(2, { timeout: 45_000 });
    await expect(items.first()).toContainText('bidhaa.csv');
    await expect(items.first()).toContainText('Unganisha safu wima');
    await expect(items.first().getByRole('link', { name: /Endelea/ })).toHaveAttribute('href', '/vendor/import/batch/?id=imp_a');
    await expect(items.nth(1)).toContainText('Imeingizwa');
    await expect(items.nth(1)).toContainText('Zilizoingizwa: 3');
    await expect(items.nth(1).getByRole('link', { name: /Tazama/ })).toHaveAttribute('href', '/vendor/import/batch/?id=imp_b');
    expect(calls.outside).toEqual([]);
  });

  test('a list error shows a retry', async ({ page }) => {
    await signedInAs(page, VENDOR);
    let failing = true;
    const calls = await mockApi(page, base({ 'GET /vendor/imports': () => (failing ? { status: 500, json: { error: 'x' } } : { json: { batches: [batch()], nextCursor: null } }) }));
    await page.goto('/vendor/import/');
    await expect(page.getByText('Your imports could not be loaded.')).toBeVisible({ timeout: 45_000 });
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('import-item')).toHaveCount(1);
    expect(calls.outside).toEqual([]);
  });

  test('template download is an authenticated fetch with entity, language and example in the query', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'GET /vendor/imports/template': { body: '﻿jina,bei_tzs\r\n', headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="fitflex-import-inventory-sw.csv"' } },
    }));
    await page.goto('/vendor/import/');
    await page.getByTestId('template-entity').selectOption('inventory');
    await page.getByRole('button', { name: 'Swahili' }).click();
    await page.getByTestId('template-example').check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('template-download').click()]);
    expect(download.suggestedFilename()).toBe('fitflex-import-inventory-sw.csv');
    const call = calls.find(c => c.path === '/vendor/imports/template')!;
    expect(Object.fromEntries(call.search)).toEqual({ entity: 'inventory', lang: 'sw', example: '1' });
    expect(call.headers.authorization).toBe('Bearer tok');
    expect(calls.outside).toEqual([]);
  });
});

test.describe('choose and upload', () => {
  test('staff cannot choose the business profile', async ({ page }) => {
    await signedInAs(page, STAFF);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: staffMe(ALL) } }));
    await page.goto('/vendor/import/new/');
    await expect(page.getByTestId('entity-profile')).toBeDisabled({ timeout: 45_000 });
    await expect(page.getByText('Only the account holder can import the business profile.').first()).toBeVisible();
    await expect(page.getByTestId('entity-products')).toBeEnabled();
    expect(calls.outside).toEqual([]);
  });

  test('xlsx and oversize files are stopped in the browser; nothing is sent', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/me': { json: me({ tools: tools({ importLimits: { maxBytes: 1024, maxRows: 2000 } }) }) } }));
    await page.goto('/vendor/import/new/');
    await page.getByTestId('import-choose-next').click();
    await page.getByTestId('import-file').setInputFiles({ name: 'stock.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK') });
    await expect(page.getByText(/Excel files are not supported yet/)).toBeVisible();
    await expect(page.getByTestId('import-upload')).toBeDisabled();
    await page.getByTestId('import-file').setInputFiles(CSV('big.csv', 4096));
    await expect(page.getByText('This file is larger than 0 MB. Split it into smaller files.')).toBeVisible();
    expect(importCalls(calls)).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('uploads multipart (browser-set Content-Type, entity + file) and moves to the batch', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({
      'POST /vendor/imports': { status: 201, json: { batch: batch({ id: 'imp_7', status: 'mapping_required' }) } },
      'GET /vendor/imports/imp_7': { json: { batch: batch({ id: 'imp_7', status: 'mapping_required' }), columns: COLUMNS } },
    }));
    await page.goto('/vendor/import/new/');
    await expect(page.getByRole('heading', { name: 'What do you want to import?' })).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('import-choose-next').click();
    await expect(page.getByRole('heading', { name: 'Upload your file' })).toBeFocused();
    await page.getByTestId('import-file').setInputFiles(CSV('products.csv'));
    await expect(page.getByTestId('import-file-chosen')).toContainText('products.csv');
    await page.getByTestId('import-upload').click();
    await expect(page).toHaveURL(/\/vendor\/import\/batch\/\?id=imp_7/);
    await expect(page.getByTestId('import-columns')).toBeVisible();
    const post = calls.find(c => c.method === 'POST' && c.path === '/vendor/imports')!;
    expect(post.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    const raw = post.raw!.toString('utf8');
    expect(raw).toContain('name="entity"');
    expect(raw).toMatch(/name="entity"\r\n\r\nproducts/);
    expect(raw).toContain('name="file"; filename="products.csv"');
    expect(post.headers.authorization).toBe('Bearer tok');
    expect(calls.outside).toEqual([]);
  });

  test('duplicate_file offers the existing import; xlsx hint, quota and rate limits show the server text', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const answers: Reply[] = [
      refusal(409, 'duplicate_file', { batchId: 'imp_old', createdAt: NOW, status: 'ready' }, 'This exact file was already uploaded.'),
      refusal(415, 'unsupported_file_type', { hint: 'xlsx_not_supported_yet' }, 'Only CSV files are supported.'),
      refusal(429, 'import_quota', { reason: 'daily', max: 20 }, 'Too many imports today or still open. Finish or discard one first.', 'Uingizaji mwingi leo.'),
      refusal(429, 'rate_limited', { retryAfterSeconds: 30 }, 'Too many requests. Try again shortly.'),
    ];
    let i = 0;
    const calls = await mockApi(page, base({ 'POST /vendor/imports': () => answers[Math.min(i++, answers.length - 1)] }));
    await page.goto('/vendor/import/new/');
    await page.getByTestId('import-choose-next').click();
    await page.getByTestId('import-file').setInputFiles(CSV('products.csv'));
    await page.getByTestId('import-upload').click();
    await expect(page.getByText('You already uploaded this file')).toBeVisible();
    await expect(page.getByTestId('import-dup-open')).toHaveAttribute('href', '/vendor/import/batch/?id=imp_old');
    await page.getByTestId('import-upload').click();
    await expect(page.getByText(/Excel files are not supported yet/)).toBeVisible();
    await page.getByTestId('import-upload').click();
    await expect(page.getByText('Import limit reached')).toBeVisible();
    await expect(page.getByText('Too many imports today or still open.')).toBeVisible();
    await page.getByTestId('import-upload').click();
    await expect(page.getByText('Too many requests. Try again shortly.')).toBeVisible();
    expect(calls.outside).toEqual([]);
  });
});

/** A stateful server for one products import: columns, mapping, preview, apply, retry, errors.csv, discard. */
function journey(over: { applySteps?: Array<Reply>; retry?: Reply } = {}) {
  let current = batch({ status: 'mapping_required', needsConfirmation: true, counts: counts({ valid: 0, needs_review: 4, invalid: 0 }) });
  let applyCall = 0;
  const steps = over.applySteps ?? [
    { json: { batch: batch({ status: 'ready', includeNeedsReview: false, counts: counts({ applied: 1 }) }), processed: 1, remaining: 1 } },
    { json: { batch: batch({ status: 'partial', includeNeedsReview: false, counts: counts({ applied: 1, failed: 1 }) }), processed: 1, remaining: 0 } },
  ];
  const routes: Routes = {
    'GET /vendor/imports/imp_1': () => ({ json: { batch: current, columns: COLUMNS } }),
    'PUT /vendor/imports/imp_1/mapping': () => { current = batch({ status: 'ready' }); return { json: { batch: current } }; },
    'GET /vendor/imports/imp_1/preview': (_req, url) => {
      const status = url.searchParams.get('status');
      return { json: { batch: current, counts: current.counts, rows: status ? ROWS.filter(r => r.status === status) : ROWS, nextCursor: null } };
    },
    'POST /vendor/imports/imp_1/apply': () => {
      const reply = steps[Math.min(applyCall++, steps.length - 1)];
      const b = (reply.json as { batch?: typeof current } | undefined)?.batch;
      if (b) current = b;
      return reply;
    },
    'POST /vendor/imports/imp_1/retry': () => over.retry ?? { json: { batch: batch({ status: 'applied', includeNeedsReview: false, counts: counts({ applied: 2, failed: 0 }) }), processed: 1, remaining: 0 } },
    'GET /vendor/imports/imp_1/errors.csv': { body: '﻿row,field\r\n3,price_tzs\r\n', headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="import-imp_1-errors.csv"' } },
    'POST /vendor/imports/imp_1/discard': () => { current = batch({ status: 'discarded', counts: counts() }); return { json: { batch: current } }; },
  };
  return { routes, set: (b: typeof current) => { current = b; } };
}

test.describe('the wizard', () => {
  test('columns: matches need confirming, then check, apply, result and retry', async ({ page }) => {
    await signedInAs(page, VENDOR);
    test.slow();
    const j = journey();
    const calls = await mockApi(page, base(j.routes));
    await page.goto('/vendor/import/batch/?id=imp_1');

    // Step 3: columns.
    await expect(page.getByRole('heading', { name: 'Check the columns' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('import-column')).toHaveCount(5);
    await expect(page.getByTestId('import-column').first()).toContainText('Whey Protein · Shaker');
    await expect(page.getByTestId('import-column').nth(3)).toContainText('Close guess');
    await expect(page.getByTestId('import-column-confirm')).toHaveCount(4);
    await page.getByTestId('import-columns-save').click();
    await expect(page.getByText('Confirm the matches marked "Please check this match".')).toBeVisible();
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
    for (const box of await page.getByTestId('import-column-confirm').all()) await box.check();
    await page.getByTestId('import-columns-save').click();
    await expect(page.getByRole('heading', { name: 'Check your rows' })).toBeFocused();
    const put = calls.find(c => c.method === 'PUT')!;
    expect(put.body).toEqual({ mapping: { Bidhaa: 'name', 'Bei ya kuuza': 'price_tzs', Idadi: 'stock', Catgory: 'category', Notes: null }, confirm: true });

    // Step 4: problem rows first, server text, money as TSh.
    const rows = page.getByTestId('import-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute('data-row-status', 'invalid');
    await expect(rows.first()).toContainText('The value in Price (TSh) is not a valid amount.');
    await expect(rows.nth(2)).toContainText('TSh 85,000');
    await expect(page.getByTestId('import-counts')).toContainText('Needs review');
    await page.getByRole('button', { name: /^Not valid \(1\)/ }).click();
    await expect(rows).toHaveCount(1);
    expect(calls.some(c => c.path.endsWith('/preview') && c.search.get('status') === 'invalid')).toBe(true);
    await page.getByTestId('import-check-next').click();

    // Step 5: needs-review rows are off by default; the first apply sends false.
    await expect(page.getByTestId('import-confirm-summary')).toHaveText('Rows to import: 2');
    await expect(page.getByTestId('import-include-review')).not.toBeChecked();
    await expect(page.getByText(/created as paused, waiting for approval/)).toBeVisible();
    await page.getByTestId('import-apply').click();

    // Step 6: result (partial: one row failed).
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Import finished with some rows not imported' })).toBeVisible();
    const applies = calls.filter(c => c.path === '/vendor/imports/imp_1/apply');
    expect(applies).toHaveLength(2);
    expect(applies.every(c => (c.body as { includeNeedsReview: boolean }).includeNeedsReview === false)).toBe(true);
    await expect(page.getByTestId('import-result-counts')).toContainText('Imported');
    await expect(page.getByText(/paused and waiting for FitFlex approval/)).toBeVisible();
    await expect(page.getByText(/restore each product to publish it/)).toBeVisible();
    await expect(page.getByTestId('import-to-products')).toHaveAttribute('href', '/vendor/products/');

    // errors.csv: authenticated fetch + blob.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('import-errors-download').first().click()]);
    expect(download.suggestedFilename()).toBe('import-imp_1-errors.csv');
    expect(calls.find(c => c.path.endsWith('/errors.csv'))!.headers.authorization).toBe('Bearer tok');

    // Retry failed rows → applied.
    await page.getByTestId('import-retry').click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({ timeout: 20_000 });
    expect(calls.filter(c => c.path.endsWith('/retry'))).toHaveLength(1);
    await expect(page.getByTestId('import-retry')).toHaveCount(0);
    expect(calls.outside).toEqual([]);
  });

  test('"also import rows that need review" is sent as true and stays true on every call', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey({ applySteps: [
      { json: { batch: batch({ status: 'ready', includeNeedsReview: true, counts: counts({ applied: 1 }) }), processed: 1, remaining: 2 } },
      { json: { batch: batch({ status: 'applied', includeNeedsReview: true, counts: counts({ applied: 3 }) }), processed: 2, remaining: 0 } },
    ] });
    j.set(batch({ status: 'ready' }));
    const calls = await mockApi(page, base(j.routes));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await expect(page.getByRole('heading', { name: 'Check your rows' })).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('import-check-next').click();
    await page.getByTestId('import-include-review').check();
    await expect(page.getByTestId('import-confirm-summary')).toHaveText('Rows to import: 3');
    await page.getByTestId('import-apply').click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({ timeout: 20_000 });
    const applies = calls.filter(c => c.path.endsWith('/apply'));
    expect(applies.map(c => (c.body as { includeNeedsReview: boolean }).includeNeedsReview)).toEqual([true, true]);
    expect(calls.outside).toEqual([]);
  });

  test('a ready batch skips the columns step; "Change columns" goes back and "Back" leaves it unchanged', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey();
    j.set(batch({ status: 'ready', counts: counts() }));
    const calls = await mockApi(page, base(j.routes));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await expect(page.getByRole('heading', { name: 'Check your rows' })).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('import-edit-columns').click();
    await expect(page.getByRole('heading', { name: 'Check the columns' })).toBeFocused();
    await expect(page.getByTestId('import-column-confirm')).toHaveCount(4); // not confirmed by the server yet
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Check your rows' })).toBeVisible();
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
  });

  test('waits out 409 apply_in_progress and 503 import_busy, then finishes', async ({ page }) => {
    await signedInAs(page, VENDOR);
    test.slow();
    const j = journey({ applySteps: [
      refusal(409, 'apply_in_progress', { retryAfterSeconds: 1 }),
      refusal(503, 'import_busy', { retryAfterSeconds: 1 }),
      { json: { batch: batch({ status: 'applied', includeNeedsReview: false, counts: counts({ applied: 2 }) }), processed: 2, remaining: 0 } },
    ] });
    j.set(batch({ status: 'ready' }));
    const calls = await mockApi(page, base(j.routes));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await page.getByTestId('import-check-next').click({ timeout: 45_000 });
    await page.getByTestId('import-apply').click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({ timeout: 30_000 });
    expect(calls.filter(c => c.path.endsWith('/apply'))).toHaveLength(3);
    expect(calls.outside).toEqual([]);
  });

  test('keeps waiting a little, then says it calmly and lets the vendor continue', async ({ page }) => {
    await signedInAs(page, VENDOR);
    test.slow();
    let n = 0;
    const j = journey();
    j.set(batch({ status: 'ready' }));
    const calls = await mockApi(page, base({
      ...j.routes,
      'POST /vendor/imports/imp_1/apply': () => (++n <= 6
        ? refusal(503, 'import_busy', { retryAfterSeconds: 1 }, 'Imports are busy. Try again shortly.')
        : { json: { batch: batch({ status: 'applied', includeNeedsReview: false, counts: counts({ applied: 2 }) }), processed: 2, remaining: 0 } }),
    }));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await page.getByTestId('import-check-next').click({ timeout: 45_000 });
    await page.getByTestId('import-apply').click();
    await expect(page.getByText('Imports are busy right now. Nothing is lost. Continue in a moment.')).toBeVisible({ timeout: 30_000 });
    expect(calls.filter(c => c.path.endsWith('/apply'))).toHaveLength(6);
    await page.getByTestId('import-apply').click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({ timeout: 20_000 });
    expect(calls.outside).toEqual([]);
  });

  test('a batch found applying opens on Import and can be continued', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey();
    j.set(batch({ status: 'applying', includeNeedsReview: false, counts: counts({ applied: 1 }) }));
    const calls = await mockApi(page, base(j.routes));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await expect(page.getByText(/running or was interrupted/)).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('import-apply').click();
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 20_000 });
    expect(calls.outside).toEqual([]);
  });

  test('server texts follow the language (Swahili) and the chrome is Swahili too', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    const j = journey();
    j.set(batch({ status: 'ready' }));
    const calls = await mockApi(page, base(j.routes));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await expect(page.getByRole('heading', { name: 'Hakiki safu mlalo zako' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('import-row').first()).toContainText('Thamani ya Bei (TSh) si kiasi sahihi.');
    await expect(page.getByTestId('import-row').nth(1)).toContainText('Karibu zaidi: Yoga.');
    await expect(page.getByTestId('import-check-next')).toHaveText('Endelea kuingiza');
    expect(calls.outside).toEqual([]);
  });

  test('discard works before anything is applied; refusals show the server text', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey();
    j.set(batch({ status: 'ready' }));
    let refuse = true;
    const calls = await mockApi(page, base({
      ...j.routes,
      'POST /vendor/imports/imp_1/discard': () => (refuse ? refusal(409, 'not_discardable', { batchStatus: 'ready' }, 'Rows were already imported, so this import cannot be discarded.') : { json: { batch: batch({ status: 'discarded' }) } }),
    }));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await page.getByTestId('import-discard').click({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByText(/Rows were already imported, so this import cannot be discarded\./)).toBeVisible();
    refuse = false;
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByTestId('import-discarded')).toBeVisible();
    expect(calls.filter(c => c.path.endsWith('/discard'))).toHaveLength(2);
    expect(calls.outside).toEqual([]);
  });

  test('mapping refused (batch_not_editable) shows the server text and reloads', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey();
    const calls = await mockApi(page, base({ ...j.routes, 'PUT /vendor/imports/imp_1/mapping': refusal(409, 'batch_not_editable', {}, 'This import can no longer be changed.') }));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await expect(page.getByTestId('import-column-confirm')).toHaveCount(4, { timeout: 45_000 });
    for (const box of await page.getByRole('checkbox').all()) await box.check();
    await page.getByTestId('import-columns-save').click();
    await expect(page.getByText('This import can no longer be changed.')).toBeVisible();
    expect(calls.filter(c => c.path === '/vendor/imports/imp_1' && c.method === 'GET').length).toBeGreaterThan(1);
    expect(calls.outside).toEqual([]);
  });

  test('retry on an expired batch explains it and offers a fresh upload', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey({ retry: refusal(409, 'batch_expired', {}, 'This import ended more than 30 days ago and its data was cleared. Upload the file again.') });
    j.set(batch({ status: 'partial', includeNeedsReview: false, counts: counts({ applied: 1, failed: 1 }) }));
    const calls = await mockApi(page, base(j.routes));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await page.getByTestId('import-retry').click({ timeout: 45_000 });
    await expect(page.getByText('This import has expired')).toBeVisible();
    await expect(page.getByText(/Upload the file again/)).toBeVisible();
    await expect(page.getByTestId('import-retry')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Start another import' })).toBeVisible();
    expect(calls.outside).toEqual([]);
  });

  test('unknown import id: not found, no crash', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'GET /vendor/imports/nope': refusal(404, 'import_not_found', {}, 'Import not found.') }));
    await page.goto('/vendor/import/batch/?id=nope');
    await expect(page.getByText('Import not found')).toBeVisible({ timeout: 45_000 });
    expect(calls.outside).toEqual([]);
  });

  test('staff see a profile import read only, with the account-holder message and no actions', async ({ page }) => {
    await signedInAs(page, STAFF);
    const calls = await mockApi(page, base({
      'GET /vendor/me': { json: staffMe(ALL) },
      'GET /vendor/imports/imp_p': { json: { batch: batch({ id: 'imp_p', entity: 'profile', status: 'ready', counts: counts({ total: 1, valid: 1, needs_review: 0, invalid: 0 }) }), columns: [] } },
      'GET /vendor/imports/imp_p/preview': { json: { batch: batch({ id: 'imp_p', entity: 'profile' }), counts: counts(), rows: [], nextCursor: null } },
    }));
    await page.goto('/vendor/import/batch/?id=imp_p');
    await expect(page.getByText('Only the account holder can work on a business profile import.')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('import-check-next')).toHaveCount(0);
    await expect(page.getByTestId('import-discard')).toHaveCount(0);
    expect(calls.filter(c => c.method !== 'GET')).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('profile import: owner_only refusal from the server is shown (staff upload attempt)', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const calls = await mockApi(page, base({ 'POST /vendor/imports': refusal(403, 'profile_import_owner_only', {}, 'Only the account holder can import the business profile.') }));
    await page.goto('/vendor/import/new/');
    await page.getByTestId('entity-profile').check();
    await page.getByTestId('import-choose-next').click();
    await page.getByTestId('import-file').setInputFiles(CSV('profile.csv'));
    await page.getByTestId('import-upload').click();
    await expect(page.getByText('Only the account holder can import the business profile.')).toBeVisible();
    expect(calls.outside).toEqual([]);
  });
});

test.describe('375px', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('nothing overflows and the main controls are at least 44px tall, in Swahili too', async ({ page }) => {
    await signedInAs(page, VENDOR, 'sw');
    test.slow();
    const j = journey();
    const calls = await mockApi(page, base(j.routes));
    const overflow = () => page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('main *').forEach(el => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1) bad.push(`${el.tagName}.${(el as HTMLElement).className.toString().slice(0, 40)}`);
      });
      return bad;
    });
    const tall = async (ids: string[]) => {
      // A checkbox's target is its label (44px), not the 16px box.
      for (const id of ids) for (const el of await page.getByTestId(id).all()) {
        const target = id.endsWith('confirm') && id !== 'import-confirm' || id === 'import-include-review' ? el.locator('xpath=ancestor::label') : el;
        expect((await target.boundingBox())!.height, id).toBeGreaterThanOrEqual(43.5);
      }
    };
    await page.goto('/vendor/import/');
    await expect(page.getByTestId('import-start')).toBeVisible({ timeout: 45_000 });
    expect(await overflow()).toEqual([]);
    await tall(['import-start', 'template-download']);

    await page.goto('/vendor/import/new/');
    await expect(page.getByTestId('import-choose-next')).toBeVisible();
    expect(await overflow()).toEqual([]);
    await tall(['import-choose-next']);

    await page.goto('/vendor/import/batch/?id=imp_1');
    await expect(page.getByTestId('import-columns')).toBeVisible();
    expect(await overflow()).toEqual([]);
    await tall(['import-columns-save', 'import-column-confirm']);
    for (const box of await page.getByRole('checkbox').all()) await box.check();
    await page.getByTestId('import-columns-save').click();
    await expect(page.getByTestId('import-check')).toBeVisible();
    expect(await overflow()).toEqual([]);
    await tall(['import-check-next', 'import-edit-columns']);
    await page.getByTestId('import-check-next').click();
    await expect(page.getByTestId('import-confirm')).toBeVisible();
    expect(await overflow()).toEqual([]);
    await tall(['import-apply', 'import-include-review']);
    await page.getByTestId('import-apply').click();
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 20_000 });
    expect(await overflow()).toEqual([]);
    await tall(['import-retry', 'import-errors-download', 'import-to-products']);
    expect(calls.outside).toEqual([]);
  });
});

const FAILED_ROW = { id: 'r9', rowNo: 9, status: 'valid', applyState: 'failed', values: { name: 'Gloves' }, resultId: null, attempts: 1, issues: [],
  lastError: { code: 'stock_changed', message: { en: 'Stock changed since the file was checked.', sw: 'Stock ilibadilika tangu faili ilipokaguliwa.' } } };
const PARTIAL = () => batch({ status: 'partial', includeNeedsReview: false, counts: counts({ applied: 1, failed: 1 }) });

test.describe('review round', () => {
  test('C1: a retry refused with apply_in_progress is not "finished" by a stale partial read; it keeps waiting', async ({ page }) => {
    await signedInAs(page, VENDOR);
    test.slow();
    let n = 0;
    const j = journey();
    j.set(PARTIAL());
    const calls = await mockApi(page, base({
      ...j.routes,
      'POST /vendor/imports/imp_1/retry': () => (++n <= 2
        ? refusal(409, 'apply_in_progress', { retryAfterSeconds: 1 }, 'This import is being applied right now.')
        : { json: { batch: batch({ status: 'applied', includeNeedsReview: false, counts: counts({ applied: 2 }) }), processed: 1, remaining: 0 } }),
    }));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await page.getByTestId('import-retry').click({ timeout: 45_000 });
    await expect(page.getByRole('heading', { name: 'Import finished', exact: true })).toBeVisible({ timeout: 30_000 });
    expect(calls.filter(c => c.path.endsWith('/retry'))).toHaveLength(3);
    expect(calls.outside).toEqual([]);
  });

  test('C1: while a retry keeps being refused, the calm wait message shows and Retry stays available', async ({ page }) => {
    await signedInAs(page, VENDOR);
    test.slow();
    const j = journey();
    j.set(PARTIAL());
    const calls = await mockApi(page, base({ ...j.routes, 'POST /vendor/imports/imp_1/retry': refusal(409, 'apply_in_progress', { retryAfterSeconds: 1 }) }));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await page.getByTestId('import-retry').click({ timeout: 45_000 });
    await expect(page.getByText('Imports are busy right now. Nothing is lost. Continue in a moment.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('import-retry')).toBeVisible();
    expect(calls.filter(c => c.path.endsWith('/retry')).length).toBe(6);
  });

  for (const supported of [true, false]) {
    test(`C2: Failed rows filter ${supported ? 'asks applyState=failed' : 'is hidden when the server says invalid_status'}`, async ({ page }) => {
      await signedInAs(page, VENDOR);
      const j = journey();
      j.set(PARTIAL());
      const calls = await mockApi(page, base({
        ...j.routes,
        'GET /vendor/imports/imp_1/preview': (_req, url) => (url.searchParams.get('applyState')
          ? (supported ? { json: { batch: PARTIAL(), counts: counts(), rows: [FAILED_ROW], nextCursor: null } } : refusal(400, 'invalid_status', {}, 'Unknown status filter.'))
          : { json: { batch: PARTIAL(), counts: counts(), rows: [...ROWS, FAILED_ROW], nextCursor: null } }),
      }));
      await page.goto('/vendor/import/batch/?id=imp_1');
      await expect(page.getByTestId('import-rows')).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId('import-row')).toHaveCount(4); // default order unchanged
      await page.getByTestId('import-filter-failed').click();
      if (supported) {
        await expect(page.getByTestId('import-row')).toHaveCount(1);
        await expect(page.getByTestId('import-row-failure')).toHaveText('Stock changed since the file was checked.');
        expect(calls.some(c => c.path.endsWith('/preview') && c.search.get('applyState') === 'failed')).toBe(true);
      } else {
        await expect(page.getByTestId('import-filter-failed')).toHaveCount(0);
        await expect(page.getByTestId('import-row')).toHaveCount(4);
      }
      expect(calls.outside).toEqual([]);
    });
  }

  test('C3: reload mid-loop shows Continue / Retry with counts, no mapping or check controls', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey();
    j.set(batch({ status: 'ready', includeNeedsReview: false, counts: counts({ applied: 1, failed: 1 }) }));
    const calls = await mockApi(page, base(j.routes));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await expect(page.getByTestId('import-continue')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('import-continue-counts')).toContainText('Imported');
    await expect(page.getByTestId('import-continue-counts')).toContainText('Waiting');
    await expect(page.getByTestId('import-edit-columns')).toHaveCount(0);
    await expect(page.getByTestId('import-columns')).toHaveCount(0);
    await expect(page.getByTestId('import-discard')).toHaveCount(0);
    await page.getByTestId('import-continue-retry').click();
    await expect(page.getByRole('heading', { name: 'Import finished', exact: true })).toBeVisible({ timeout: 20_000 });
    expect(calls.filter(c => c.path.endsWith('/retry'))).toHaveLength(1);
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
  });

  test('C3: Continue importing applies the rest and the step stays put between calls', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey({ applySteps: [
      { json: { batch: batch({ status: 'ready', includeNeedsReview: false, counts: counts({ applied: 2 }) }), processed: 1, remaining: 1 } },
      { json: { batch: batch({ status: 'applied', includeNeedsReview: false, counts: counts({ applied: 3 }) }), processed: 1, remaining: 0 } },
    ] });
    j.set(batch({ status: 'ready', includeNeedsReview: false, counts: counts({ applied: 1 }) }));
    const calls = await mockApi(page, base(j.routes));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await page.getByTestId('import-continue-go').click({ timeout: 45_000 });
    await expect(page.getByRole('heading', { name: 'Import finished', exact: true })).toBeVisible({ timeout: 20_000 });
    expect(calls.filter(c => c.path.endsWith('/apply'))).toHaveLength(2);
  });

  test('C4: duplicate_file mid-loop shows the server text and a link to the other import; 499 is calm', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey();
    j.set(batch({ status: 'ready' }));
    const answers: Reply[] = [
      refusal(409, 'duplicate_file', { batchId: 'imp_other', createdAt: NOW, status: 'ready' }, 'This exact file was already uploaded.'),
      { status: 499, json: { error: 'request_aborted' } },
    ];
    let i = 0;
    const calls = await mockApi(page, base({ ...j.routes, 'POST /vendor/imports/imp_1/apply': () => answers[Math.min(i++, 1)] }));
    await page.goto('/vendor/import/batch/?id=imp_1');
    await page.getByTestId('import-check-next').click({ timeout: 45_000 });
    await page.getByTestId('import-apply').click();
    await expect(page.getByText('This exact file was already uploaded.')).toBeVisible();
    await expect(page.getByTestId('import-other-batch')).toHaveAttribute('href', '/vendor/import/batch/?id=imp_other');
    await page.getByTestId('import-apply').click();
    await expect(page.getByText('That request was interrupted. Nothing is lost. Try again.')).toBeVisible();
    await expect(page.getByText(/API 499/)).toHaveCount(0);
    expect(calls.outside).toEqual([]);
  });

  test('I1: unknown issue code, unknown field key and boolean values never show raw codes', async ({ page }) => {
    await signedInAs(page, VENDOR);
    const j = journey();
    j.set(batch({ status: 'ready' }));
    const calls = await mockApi(page, base({
      ...j.routes,
      'GET /vendor/imports/imp_1/preview': { json: { batch: batch(), counts: counts(), nextCursor: null, rows: [
        { id: 'rx', rowNo: 2, status: 'invalid', applyState: 'pending', resultId: null, lastError: null, attempts: 0,
          values: { name: 'Odd', brand_new_field: 'abc', flag: true }, issues: [{ code: 'brand_new_code', field: null, severity: 'error', params: {} }] },
      ] } },
    }));
    await page.goto('/vendor/import/batch/?id=imp_1');
    const row = page.getByTestId('import-row');
    await expect(row).toContainText('This row has a problem.', { timeout: 45_000 });
    await expect(row).toContainText(/Other:\s*abc/);
    await expect(row).toContainText(/Other:\s*Yes/);
    await expect(row).not.toContainText('brand_new');
    expect(calls.outside).toEqual([]);
  });

  test('I3: Swahili at 375px: result, continue, upload error and Failed rows filter do not overflow or clip', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signedInAs(page, VENDOR, 'sw');
    test.slow();
    const j = journey();
    j.set(PARTIAL());
    const calls = await mockApi(page, base({
      ...j.routes,
      'GET /vendor/imports/imp_c': { json: { batch: batch({ id: 'imp_c', status: 'ready', includeNeedsReview: false, counts: counts({ applied: 1, failed: 1 }) }), columns: COLUMNS } },
      'GET /vendor/imports/imp_c/preview': { json: { batch: batch(), counts: counts(), rows: [], nextCursor: null } },
      'GET /vendor/imports/imp_1/preview': { json: { batch: PARTIAL(), counts: counts(), rows: [FAILED_ROW, ...ROWS], nextCursor: null } },
    }));
    const problems = () => page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('main *').forEach(el => {
        const h = el as HTMLElement;
        const r = h.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1) bad.push(`overflow ${h.tagName}`);
        if ((h.tagName === 'BUTTON' || h.tagName === 'A') && h.scrollHeight > h.clientHeight + 1) bad.push(`clipped ${h.tagName} ${h.textContent?.slice(0, 30)}`);
      });
      return bad;
    });
    await page.goto('/vendor/import/batch/?id=imp_1');
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('import-retry')).toHaveText('Jaribu tena zilizoshindikana');
    await expect(page.getByTestId('import-filter-failed')).toBeVisible();
    expect(await problems()).toEqual([]);
    await page.goto('/vendor/import/batch/?id=imp_c');
    await expect(page.getByTestId('import-continue')).toBeVisible();
    expect(await problems()).toEqual([]);
    await page.goto('/vendor/import/new/');
    await page.getByTestId('import-choose-next').click();
    await page.getByTestId('import-file').setInputFiles({ name: 'a.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK') });
    await expect(page.getByText(/Hifadhi kama \(Save As\)/)).toBeVisible();
    expect(await problems()).toEqual([]);
    expect(calls.outside).toEqual([]);
  });
});
