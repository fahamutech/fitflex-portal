import { expect, test, type Page, type Request } from '@playwright/test';

// Shop flash sales (Phase 2 S4) against a mocked API built to fitflex-functions docs/shop-flash-sales-api.md:
// the admin merch queue (Flash sales kind and type filter, discount column, detail with price check / 14-day rule /
// 30-day price history / "seller pays" line, approve with { revision } only, reject with code + note, end with a note,
// own-item block, sale_changed reload, staff create on any vendor's product) and the vendor web portal
// (/vendor/promotions?tab=sales: propose with live % and TSh, 5% minimum, below the standing discount, the 14-day
// message with "Start on", server refusals, send / withdraw / end, statuses, open proposals, feature_disabled).
// Network guard: every request outside localhost is aborted; nothing reaches a real service.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Call = { method: string; path: string; search: URLSearchParams; body: Json | null };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
/** What a person types into the Tanzania-time field for an instant. */
const eatInput = (ms: number) => new Date(ms + 3 * HOUR).toISOString().slice(0, 16);
const EAT = 'Africa/Dar_es_Salaam';
/** The portal's eatDateTime / eatDay in English. */
const eatWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: EAT })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: EAT })}`;
};
const eatDay = (ymd: string) => new Date(`${ymd}T12:00:00+03:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: EAT });
const tzDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: EAT });

const SUPER = { id: 'admin-x', userType: 'admin' };
const VIEWER = { id: 'admin-v', userType: 'admin', portalUser: true, aclPermissions: ['promotions'] };
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };

async function signIn(page: Page, user: Json, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [user, locale] as const);
}
type Handler = (req: Request, call: Call, m: RegExpMatchArray) => { status?: number; json?: unknown };
async function mockApi(page: Page, routes: Array<[string, RegExp, Handler]>) {
  const calls: Call[] = [];
  const outside: string[] = [];
  page.on('pageerror', err => console.log('PAGEERROR', err.message));
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => { outside.push(route.request().url()); return route.abort(); });
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body: Json | null = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const call = { method: req.method(), path: url.pathname, search: url.searchParams, body };
    calls.push(call);
    for (const [method, re, h] of routes) {
      const m = url.pathname.match(re);
      if (method === req.method() && m) {
        const r = h(req, call, m);
        return route.fulfill({ status: r.status ?? 200, json: r.json ?? {} });
      }
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  return Object.assign(calls, { outside });
}
const only = (calls: Call[], method: string, path: string) => calls.filter(c => c.method === method && c.path === path);
const nav = (page: Page) => page.getByRole('navigation', { name: /main navigation|menyu kuu/i });

// ── Fixtures ──────────────────────────────────────────────────────────────────

function sale(over: Json = {}): Json {
  return {
    id: 'fls_1', origin: 'vendor', vendorId: 'usr_vendor', vendorName: 'Dar Fitness Gear', sellerSuspended: false,
    productId: 'prd_1', productName: 'Whey Protein 1kg', productImage: null,
    salePriceTzs: 69000, regularPriceTzs: 85000, discountPriceTzs: null, wasPriceTzs: null, discountPct: 18, savingTzs: 16000,
    startsAt: at(48), endsAt: at(72), status: 'pending_approval', effectiveStatus: 'pending_approval', statusReason: null, statusReasonNote: null,
    expiresAt: at(47), revision: 3, submittedAt: at(-2), createdAt: at(-3), updatedAt: at(-2),
    createdBy: 'usr_vendor', createdByName: 'Rehema', submittedBy: 'usr_vendor', submittedByName: 'Rehema', editedBy: [],
    ownItem: false, allowedActions: ['approve', 'reject'], regularPriceTzsAtSubmit: 85000, discountPriceTzsAtSubmit: null, priceChangedSinceSubmit: false,
    ...over,
  };
}
const PASS = {
  passes14DayRule: true, raisedAt: null, raisedOn: null, earliestStart: null, lastRaiseAt: null,
  passesHistoryRule: true, listedAt: '2026-09-01T09:00:00.000Z', historyEarliestStart: null,
  priceHistory: [
    { at: '2026-10-12T09:00:00.000Z', on: '2026-10-12', fromTzs: 80000, toTzs: 85000, field: 'priceTzs', raised: true, source: 'trigger' },
    { at: '2026-10-05T09:00:00.000Z', on: '2026-10-05', fromTzs: 82000, toTzs: 79000, field: 'discountPriceTzs', raised: false, source: 'trigger' },
    { at: '2026-10-01T09:00:00.000Z', on: '2026-10-01', fromTzs: null, toTzs: 80000, field: 'priceTzs', raised: false, source: 'migration_baseline' },
  ],
  discountLine: { pct: 18, savingTzs: 16000, sellerPays: true }, priceChangedSinceSubmit: false,
};
const FAIL = {
  ...PASS, passes14DayRule: false, raisedAt: '2026-10-25T07:00:00.000Z', raisedOn: '2026-10-25', earliestStart: '2026-11-08T07:00:00.000Z',
  priceHistory: [{ at: '2026-10-25T07:00:00.000Z', fromTzs: 80000, toTzs: 85000, field: 'priceTzs', raised: true }],
};
function banner(): Json {
  return {
    id: 'bn_1', origin: 'vendor', vendorId: 'usr_vendor', vendorName: 'Dar Fitness Gear', status: 'pending_approval', effectiveStatus: 'pending_approval',
    headlineLead: { en: 'Run further in', sw: 'Kimbia mbali zaidi na' }, headlineAccent: { en: 'new shoes', sw: 'viatu vipya' }, subline: null,
    ctaLabel: { en: 'View product', sw: 'Tazama bidhaa' }, imageAlt: { en: 'Shoes', sw: 'Viatu' }, target: { type: 'product', value: 'prd_1' }, targetName: 'Trail runner',
    audienceRoles: ['member'], startsAt: at(30), endsAt: at(200), position: null, statusReason: null, expiresAt: at(29), submittedAt: at(-1), createdAt: at(-1),
    allowedActions: ['approve', 'reject'], image: null,
  };
}
const ADMIN_PRODUCTS = [
  { id: 'prd_1', vendorId: 'usr_vendor', name: 'Trail runner', priceTzs: 90000, stock: 4, status: 'active', approvalStatus: 'approved' },
  { id: 'prd_9', vendorId: 'usr_other', name: 'Paused rope', priceTzs: 20000, stock: 4, status: 'paused', approvalStatus: 'approved' },
];
const PICKER = [
  { id: 'prd_1', name: 'Trail runner', vendorId: 'usr_vendor', vendorName: 'Dar Fitness Gear', priceTzs: 90000, discountPriceTzs: null, effectivePriceTzs: 90000, maxSalePriceTzs: 85500, stock: 4, image: null },
  { id: 'prd_7', name: 'Skipping rope', vendorId: 'usr_other', vendorName: 'Arusha Sports', priceTzs: 15000, discountPriceTzs: null, effectivePriceTzs: 15000, maxSalePriceTzs: 14250, stock: 9, image: null },
];
const ADMIN_VENDORS = [{ id: 'usr_vendor', displayName: 'Dar Fitness Gear', userType: 'vendor', approvalStatus: 'approved', accountStatus: 'active' }];

type AdminOpts = { banners?: Json[] | 'off'; sales?: Json[] | 'off'; check?: Json; extra?: Array<[string, RegExp, Handler]> };
function adminRoutes(o: AdminOpts = {}): Array<[string, RegExp, Handler]> {
  const sales = o.sales === 'off' ? [] : o.sales ?? [sale()];
  const banners = o.banners === 'off' ? [] : o.banners ?? [];
  const find = (id: string) => sales.find(s => s.id === id);
  const off = { status: 404, json: { error: 'feature_disabled' } };
  return [
    ...(o.extra ?? []),
    ['GET', /^\/admin\/shop-merch$/, (_r, c) => {
      if (c.search.get('kind') === 'flash_sale') return o.sales === 'off' ? off : { json: { items: sales, total: sales.length, nextCursor: null } };
      return o.banners === 'off' ? off : { json: { items: banners, total: banners.length, nextCursor: null, confirmation: null } };
    }],
    ['GET', /^\/admin\/flash-sales\/([^/]+)$/, (_r, _c, m) => (find(m[1])
      ? { json: { sale: find(m[1]), priceCheck: o.check ?? PASS, history: [
        { id: 1, action: 'flash_sale.created', actor: 'usr_vendor', actorName: 'Rehema', at: at(-3) },
        { id: 2, action: 'flash_sale.submitted', actor: 'usr_vendor', actorName: 'Rehema', at: at(-2) },
      ] } }
      : { status: 404, json: { error: 'sale_not_found' } })],
    ['POST', /^\/admin\/flash-sales\/([^/]+)\/approve$/, (_r, _c, m) => { Object.assign(find(m[1])!, { status: 'approved', effectiveStatus: 'approved', wasPriceTzs: 85000, expiresAt: null, approvedBy: 'admin-x', approvedByName: 'Asha', allowedActions: ['end'] }); return { json: { sale: find(m[1]) } }; }],
    ['POST', /^\/admin\/flash-sales\/([^/]+)\/reject$/, (_r, c, m) => { Object.assign(find(m[1])!, { status: 'rejected', effectiveStatus: 'rejected', statusReason: c.body?.code, statusReasonNote: c.body?.note ?? null, allowedActions: [] }); return { json: { sale: find(m[1]) } }; }],
    ['POST', /^\/admin\/flash-sales\/([^/]+)\/end$/, (_r, c, m) => { Object.assign(find(m[1])!, { status: 'ended', effectiveStatus: 'ended', statusReason: 'ended_by_fitflex', statusReasonNote: c.body?.note, allowedActions: [] }); return { json: { sale: find(m[1]) } }; }],
    ['GET', /^\/admin\/products$/, () => ({ json: ADMIN_PRODUCTS })],
    ['GET', /^\/admin\/flash-sale-products$/, (_r, c) => {
      const q = (c.search.get('q') ?? '').toLowerCase();
      return { json: { items: PICKER.filter(p => !q || p.name.toLowerCase().includes(q)) } };
    }],
    ['GET', /^\/admin\/vendors$/, () => ({ json: ADMIN_VENDORS })],
    ['GET', /^\/shop\/categories$/, () => ({ json: { categories: [] } })],
  ];
}

// ── Admin ─────────────────────────────────────────────────────────────────────

test.describe('admin: flash sales in the merch queue', () => {
  test('flash sales on, banners off: nav item, only the sales kind, Create flash sale, discount column', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, adminRoutes({ banners: 'off' }));
    await page.goto('/admin/');
    await nav(page).getByRole('link', { name: 'Banners & flash sales' }).click();
    await expect(page.getByTestId('merch-row-fls_1')).toContainText('Whey Protein 1kg');
    await expect(page.getByTestId('merch-row-fls_1')).toContainText('Flash sale');
    await expect(page.getByTestId('merch-discount-fls_1')).toHaveText('−18% · TSh 69,000');
    await expect(page.getByTestId('merch-count-requests')).toHaveText('1');
    await expect(page.getByTestId('merch-create-banner')).toHaveCount(0);
    await expect(page.getByTestId('merch-create-sale')).toBeVisible();
    await expect(page.getByTestId('merch-type-filter').getByRole('button', { name: 'Banners' })).toHaveCount(0);
    await expect(page.getByTestId('merch-type-filter').getByRole('button', { name: 'Flash sales' })).toBeVisible();
    // The sales list asks for its own kind.
    expect(only(calls, 'GET', '/admin/shop-merch').some(c => c.search.get('kind') === 'flash_sale')).toBe(true);
    expect(calls.outside).toEqual([]);
  });

  test('both kinds: type filter All · Banners · Flash sales, counts follow the filter, search by product', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes({ banners: [banner()], sales: [sale(), sale({ id: 'fls_2', productName: 'Yoga mat', expiresAt: at(30) })] }));
    await page.goto('/admin/shop-merch/');
    await expect(page.getByTestId('merch-count-requests')).toHaveText('3');
    await page.getByTestId('merch-type-filter').getByRole('button', { name: 'Flash sales' }).click();
    await expect(page.getByTestId('merch-count-requests')).toHaveText('2');
    await expect(page.getByTestId('merch-row-bn_1')).toHaveCount(0);
    await page.getByTestId('merch-type-filter').getByRole('button', { name: 'Banners' }).click();
    await expect(page.getByTestId('merch-count-requests')).toHaveText('1');
    await expect(page.getByTestId('merch-row-fls_1')).toHaveCount(0);
    await page.getByTestId('merch-type-filter').getByRole('button', { name: 'All' }).click();
    await page.getByTestId('merch-search').fill('yoga');
    await expect(page.getByTestId('merch-row-fls_2')).toBeVisible();
    await expect(page.getByTestId('merch-row-fls_1')).toHaveCount(0);
    await page.getByTestId('merch-search').fill('zzz');
    await expect(page.getByTestId('merch-empty')).toHaveText('Nothing matches your search');
  });

  test('detail: prices, Tanzania-time window, price check passes, 30-day history, seller pays; approve sends { revision } only', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, adminRoutes({ banners: 'off' }));
    await page.goto('/admin/shop-merch/');
    await page.getByTestId('merch-row-fls_1').click();
    await expect(page).toHaveURL(/item=fls_1&kind=flash_sale/);
    const d = page.getByTestId('sale-detail');
    await expect(d.getByTestId('sale-title')).toHaveText('Whey Protein 1kg');
    await expect(d.getByTestId('sale-regular-now')).toHaveText('TSh 85,000');
    await expect(d.getByTestId('sale-price')).toHaveText('TSh 69,000');
    await expect(d.getByTestId('sale-discount')).toHaveText('−18% · buyers save TSh 16,000');
    await expect(d.getByTestId('sale-dates')).toContainText('(Tanzania time)');
    await expect(d.getByTestId('sale-preview').getByRole('group')).toHaveAttribute('aria-label', 'Sale price TSh 69,000, was TSh 85,000, 18 percent off');
    await expect(d.getByTestId('sale-rule-result')).toHaveText('Passes the 14-day rule');
    await expect(d.getByTestId('sale-price-history')).toContainText('12 Oct 2026: TSh 80,000 → TSh 85,000 (raised)');
    await expect(d.getByTestId('sale-price-history')).toContainText('5 Oct 2026: discount price TSh 82,000 → TSh 79,000');
    await expect(d.getByTestId('sale-price-history')).toContainText('1 Oct 2026: TSh 80,000 (starting price when price history began)');
    await expect(d.getByTestId('sale-history-result')).toHaveText('Has 14 days of price history');
    await expect(d.getByTestId('sale-discount-line')).toHaveText('−18% (TSh 16,000 off), seller pays');
    await expect(d.getByTestId('merch-history')).toContainText('Sent for approval');
    await d.getByTestId('merch-approve').click();
    const dlg = page.getByTestId('merch-approve-dialog');
    await expect(dlg.getByTestId('merch-approve-confirm')).toBeDisabled();
    await dlg.getByTestId('merch-check-sale').check();
    await dlg.getByTestId('merch-approve-confirm').click();
    await expect(page.getByText('Approved').first()).toBeVisible();
    await expect(d.getByTestId('sale-status')).toHaveText('Scheduled');
    const [approve] = only(calls, 'POST', '/admin/flash-sales/fls_1/approve');
    expect(approve.body).toEqual({ revision: 3 });
  });

  test('price check fails: the fail line, and Approve is disabled with the reason as text', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes({ banners: 'off', check: FAIL }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    const fail = `Fails: price raised on ${eatDay('2026-10-25')}; earliest start ${eatWhen('2026-11-08T07:00:00.000Z')}`;
    await expect(page.getByTestId('sale-rule-result')).toHaveText(fail);
    await expect(page.getByTestId('sale-approve-blocked')).toHaveText(fail);
    await expect(page.getByTestId('merch-approve')).toBeDisabled();
    await expect(page.getByTestId('merch-reject')).toBeEnabled();
  });

  test('price history rule fails (new or copied product): the fail line and Approve disabled', async ({ page }) => {
    await signIn(page, SUPER);
    const listedAt = '2026-10-25T07:00:00.000Z'; const hist = '2026-11-08T07:00:00.000Z';
    await mockApi(page, adminRoutes({ banners: 'off', check: { ...PASS, passesHistoryRule: false, listedAt, historyEarliestStart: hist } }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    const fail = `Fails: listed on ${eatWhen(listedAt)}; needs 14 days of price history, earliest start ${eatWhen(hist)}`;
    await expect(page.getByTestId('sale-rule-result')).toHaveText('Passes the 14-day rule');
    await expect(page.getByTestId('sale-history-result')).toHaveText(fail);
    await expect(page.getByTestId('sale-approve-blocked')).toHaveText(fail);
    await expect(page.getByTestId('merch-approve')).toBeDisabled();
  });

  test('regular price moved since sending: danger alert and Approve disabled', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes({ banners: 'off', sales: [sale({ regularPriceTzs: 90000, priceChangedSinceSubmit: true })], check: { ...PASS, priceChangedSinceSubmit: true } }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await expect(page.getByTestId('sale-price-moved')).toHaveText('The regular price changed since this was sent. Ask the seller to send it again.');
    await expect(page.getByTestId('merch-approve')).toBeDisabled();
  });

  test('own item: Approve and Reject disabled with the visible reason; End stays for the live one', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes({ banners: 'off', sales: [
      sale({ origin: 'staff', createdBy: 'admin-x', submittedBy: 'admin-x', ownItem: true, allowedActions: ['withdraw'] }),
      sale({ id: 'fls_live', status: 'approved', effectiveStatus: 'live', startsAt: at(-2), endsAt: at(20), expiresAt: null, createdBy: 'admin-x', ownItem: true, allowedActions: ['end'] }),
    ] }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await expect(page.getByTestId('merch-own-item')).toHaveText('You created this, so another admin must approve it.');
    await expect(page.getByTestId('merch-approve')).toBeDisabled();
    await expect(page.getByTestId('merch-reject')).toBeDisabled();
    await expect(page.getByTestId('merch-withdraw')).toBeVisible();
    await page.goto('/admin/shop-merch/?item=fls_live&kind=flash_sale');
    await expect(page.getByTestId('merch-end')).toBeEnabled();
  });

  test('approve answered 409 sale_changed: the dialog closes, the sale reloads and the admin is told', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, adminRoutes({ banners: 'off', extra: [
      ['POST', /^\/admin\/flash-sales\/fls_1\/approve$/, () => ({ status: 409, json: { error: 'sale_changed', revision: 4 } })],
    ] }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await page.getByTestId('merch-approve').click();
    await page.getByTestId('merch-check-sale').check();
    await page.getByTestId('merch-approve-confirm').click();
    await expect(page.getByTestId('sale-stale')).toHaveText('This flash sale changed after you opened it. Review it again.');
    await expect(page.getByTestId('merch-approve-dialog')).toHaveCount(0);
    await expect.poll(() => only(calls, 'GET', '/admin/flash-sales/fls_1').length).toBeGreaterThanOrEqual(2);
  });

  test('approve refused with a rule (price_raised_recently): the error is shown in the dialog with the dates', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes({ banners: 'off', extra: [
      ['POST', /^\/admin\/flash-sales\/fls_1\/approve$/, () => ({ status: 422, json: { error: 'price_raised_recently', raisedAt: '2026-10-25T07:00:00.000Z', raisedOn: '2026-10-25', earliestStart: '2026-11-08T07:00:00.000Z', fromTzs: 80000, toTzs: 85000 } })],
    ] }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await page.getByTestId('merch-approve').click();
    await page.getByTestId('merch-check-sale').check();
    await page.getByTestId('merch-approve-confirm').click();
    await expect(page.getByTestId('merch-approve-error')).toHaveText(`You raised this product's price on ${eatDay('2026-10-25')}. A flash sale can start on ${eatWhen('2026-11-08T07:00:00.000Z')} or later.`);
  });

  test('reject with a sale reason code and note; end a live sale with a note', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, adminRoutes({ banners: 'off', sales: [
      sale(),
      sale({ id: 'fls_live', status: 'approved', effectiveStatus: 'live', startsAt: at(-2), endsAt: at(20), expiresAt: null, allowedActions: ['end'] }),
    ] }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await page.getByTestId('merch-reject').click();
    const dlg = page.getByTestId('merch-reject-dialog');
    for (const label of ["The regular price doesn't look genuine", 'Problem with the product', "The dates don't work", 'Other']) await expect(dlg.getByText(label, { exact: true })).toBeVisible();
    await dlg.getByTestId('merch-reason-timing').check();
    await dlg.getByTestId('merch-reject-note').fill('Starts during a public holiday sale.');
    await dlg.getByTestId('merch-reject-confirm').click();
    await expect(page.getByTestId('sale-status')).toHaveText('Rejected');
    await expect(page.getByTestId('sale-reason')).toHaveText("Reason: The dates don't work: Starts during a public holiday sale.");
    expect(only(calls, 'POST', '/admin/flash-sales/fls_1/reject')[0].body).toEqual({ revision: 3, code: 'timing', note: 'Starts during a public holiday sale.' });

    await page.goto('/admin/shop-merch/?item=fls_live&kind=flash_sale');
    await page.getByTestId('merch-end').click();
    await expect(page.getByRole('dialog')).toContainText('Buyers pay the regular price from now. Carts with this item will show the new price at checkout.');
    await page.getByTestId('merch-end-reason').fill('Seller asked us to stop it.');
    await page.getByTestId('merch-end-confirm').click();
    await expect(page.getByTestId('sale-status')).toHaveText('Ended');
    expect(only(calls, 'POST', '/admin/flash-sales/fls_live/end')[0].body).toEqual({ note: 'Seller asked us to stop it.' });
  });

  test('viewer without promotions_approve: can view, the permission text, no decisions', async ({ page }) => {
    await signIn(page, VIEWER);
    await mockApi(page, adminRoutes({ banners: 'off' }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await expect(page.getByTestId('merch-no-approve')).toBeVisible();
    await expect(page.getByTestId('merch-approve')).toHaveCount(0);
  });

  test('staff create on any vendor\'s product: live % and TSh, 5% minimum, server 14-day refusal on the start, then create + send', async ({ page }) => {
    await signIn(page, SUPER);
    const created = sale({ id: 'fls_new', origin: 'staff', productId: 'prd_1', productName: 'Trail runner', regularPriceTzs: 90000, salePriceTzs: 69000, discountPct: 23, savingTzs: 21000,
      status: 'draft', effectiveStatus: 'draft', createdBy: 'admin-x', submittedBy: null, ownItem: true, allowedActions: ['edit', 'submit', 'withdraw'] });
    const sales: Json[] = [];
    let tries = 0;
    const calls = await mockApi(page, adminRoutes({ banners: 'off', sales, extra: [
      ['POST', /^\/admin\/flash-sales$/, () => {
        tries += 1;
        if (tries === 1) return { status: 422, json: { error: 'price_raised_recently', raisedAt: '2026-10-25T07:00:00.000Z', raisedOn: '2026-10-25', earliestStart: '2026-11-08T07:00:00.000Z' } };
        sales.push(created); return { status: 201, json: { sale: created } };
      }],
      ['POST', /^\/admin\/flash-sales\/fls_new\/submit$/, () => { Object.assign(created, { status: 'pending_approval', effectiveStatus: 'pending_approval', submittedBy: 'admin-x', allowedActions: ['withdraw'] }); return { json: { sale: created } }; }],
    ] }));
    await page.goto('/admin/shop-merch/');
    await page.getByTestId('merch-create-sale').click();
    await expect(page).toHaveURL(/new=sale/);
    await expect(page.getByTestId('sale-notes')).toContainText('The seller pays for the discount.');
    await page.getByTestId('sale-product-picker').getByRole('button').first().click();
    await expect(page.getByRole('option', { name: /Paused rope/ })).toHaveCount(0);
    await page.getByRole('option', { name: /Trail runner/ }).click();
    await expect(page.getByTestId('sale-regular')).toContainText('Regular price TSh 90,000');
    await page.getByTestId('sale-price').fill('86000');
    await expect(page.getByText('The sale price must be at least 5% below the regular price: TSh 85,500 or less.')).toBeVisible();
    await page.getByTestId('sale-price').fill('69000');
    await expect(page.getByTestId('sale-live')).toHaveText('23% off · buyers save TSh 21,000');
    const start = Date.now() + 3 * DAY;
    await page.getByTestId('sale-startsAt').fill(eatInput(start));
    await page.getByTestId('sale-endsAt').fill(eatInput(start + 2 * DAY));
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-startsAt-msg')).toHaveText(`You raised this product's price on ${eatDay('2026-10-25')}. A flash sale can start on ${eatWhen('2026-11-08T07:00:00.000Z')} or later.`);
    await page.getByTestId('sale-submit').click();
    await expect(page).toHaveURL(/item=fls_new&kind=flash_sale/);
    const posts = only(calls, 'POST', '/admin/flash-sales');
    expect(Object.keys(posts[1].body!).sort()).toEqual(['endsAt', 'productId', 'salePriceTzs', 'startsAt']);
    expect(posts[1].body).toMatchObject({ productId: 'prd_1', salePriceTzs: 69000 });
    expect(only(calls, 'POST', '/admin/flash-sales/fls_new/submit')).toHaveLength(1);
    await expect(page.getByTestId('merch-own-item')).toBeVisible();
  });

  test('approve refused because the seller is not approved: worded for staff', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes({ banners: 'off', extra: [
      ['POST', /^\/admin\/flash-sales\/fls_1\/approve$/, () => ({ status: 409, json: { error: 'vendor_not_approved' } })],
    ] }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await page.getByTestId('merch-approve').click();
    await page.getByTestId('merch-check-sale').check();
    await page.getByTestId('merch-approve-confirm').click();
    await expect(page.getByTestId('merch-approve-error')).toHaveText("The seller can't run sales right now (not approved or not verified).");
  });

  test('staff picker: promotions alone can create (no shop scope); approve-only staff cannot; search asks the server', async ({ page }) => {
    await signIn(page, VIEWER);
    const calls = await mockApi(page, adminRoutes({ banners: 'off' }));
    await page.goto('/admin/shop-merch/');
    await page.getByTestId('merch-create-sale').click();
    await page.getByTestId('sale-product-picker').getByRole('button', { name: /Product/ }).click();
    await expect(page.getByRole('option', { name: /Skipping rope/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('sale-product-search').fill('rope');
    await expect.poll(() => only(calls, 'GET', '/admin/flash-sale-products').some(c => c.search.get('q') === 'rope')).toBe(true);
    expect(only(calls, 'GET', '/admin/products')).toHaveLength(0);
    await page.getByTestId('sale-product-picker').getByRole('button', { name: /Product/ }).click();
    await expect(page.getByRole('option', { name: /Trail runner/ })).toHaveCount(0);
    await page.getByRole('option', { name: /Skipping rope/ }).click();
    await expect(page.getByTestId('sale-regular')).toContainText('Regular price TSh 15,000');
  });

  test('approve-only staff: no Create flash sale; a deep link says no permission', async ({ page }) => {
    await signIn(page, { id: 'admin-a', userType: 'admin', portalUser: true, aclPermissions: ['promotions_approve'] });
    await mockApi(page, adminRoutes({ banners: 'off' }));
    await page.goto('/admin/shop-merch/');
    await expect(page.getByTestId('merch-row-fls_1')).toBeVisible();
    await expect(page.getByTestId('merch-create-sale')).toHaveCount(0);
    await page.goto('/admin/shop-merch/?new=sale');
    await expect(page.getByTestId('merch-sale-no-create')).toBeVisible();
  });

  test('QA1 #1: at 1280 the Item cell is one line with an ellipsis and the full name in its title; Seller wraps on word boundaries', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, SUPER);
    const long = 'Whey Protein Isolate Ultra Premium Chocolate Flavour 2kg Tub';
    await mockApi(page, adminRoutes({ banners: [banner()], sales: [sale({ productName: long, vendorName: 'Dar es Salaam Fitness Gear and Supplements' })] }));
    await page.goto('/admin/shop-merch/');
    const title = page.getByTestId('merch-title-fls_1');
    await expect(title).toHaveAttribute('title', long);
    const css = await title.evaluate(el => { const c = getComputedStyle(el); return [c.whiteSpace, c.textOverflow, c.overflow]; });
    expect(css).toEqual(['nowrap', 'ellipsis', 'hidden']);
    const wrap = await page.getByTestId('merch-seller-fls_1').evaluate(el => getComputedStyle(el).overflowWrap);
    expect(wrap).toBe('break-word');
    // Each line of the seller name ends at a space, never inside a word.
    const lines = await page.getByTestId('merch-seller-fls_1').evaluate(el => {
      const range = document.createRange(); const text = el.firstChild!; const out: string[] = []; let last = -1; let cur = '';
      for (let i = 0; i < (text.textContent ?? '').length; i += 1) {
        range.setStart(text, i); range.setEnd(text, i + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        if (last !== -1 && top !== last) { out.push(cur); cur = ''; }
        last = top; cur += text.textContent![i];
      }
      out.push(cur); return out;
    });
    for (const l of lines.slice(0, -1)) expect(l.endsWith(' ')).toBe(true);
  });

  test('QA1 #2: Approve, Reject, Edit, Withdraw, the checklist row and the product picker are at least 44 px', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes({ banners: 'off', sales: [
      sale(),
      sale({ id: 'fls_mine', origin: 'staff', status: 'draft', effectiveStatus: 'draft', createdBy: 'admin-x', ownItem: true, allowedActions: ['edit', 'submit', 'withdraw'] }),
    ] }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    for (const id of ['merch-approve', 'merch-reject']) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('merch-approve').click();
    const row = page.getByTestId('merch-approve-dialog').locator('label').filter({ has: page.getByTestId('merch-check-sale') });
    const box = (await row.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const fieldset = (await page.getByTestId('merch-approve-dialog').locator('fieldset').boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(fieldset.width - 1);
    await page.keyboard.press('Escape');
    await page.goto('/admin/shop-merch/?item=fls_mine&kind=flash_sale');
    for (const id of ['merch-edit', 'merch-withdraw', 'merch-submit']) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.goto('/admin/shop-merch/?new=sale');
    const trigger = page.getByTestId('sale-product-picker').getByRole('button', { name: /Product/ });
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('QA1 #4: closing the approve dialog returns focus to Approve; after approving, focus goes to the title', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes({ banners: 'off' }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await page.getByTestId('merch-approve').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('merch-approve-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('merch-approve')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByTestId('merch-approve-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('merch-approve')).toBeFocused();
    await page.getByTestId('merch-approve').click();
    await page.getByTestId('merch-check-sale').check();
    await page.getByTestId('merch-approve-confirm').click();
    await expect(page.getByTestId('sale-status')).toHaveText('Scheduled');
    await expect(page.getByTestId('sale-title')).toBeFocused();
  });

  test('QA1 #5/#6: staff create below 5% shows only the 5% message; the discount line says "the product\'s"', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes({ banners: 'off', extra: [
      ['GET', /^\/admin\/flash-sale-products$/, () => ({ json: { items: [...PICKER, { id: 'prd_8', name: 'Gym gloves', vendorId: 'usr_vendor', vendorName: 'Dar Fitness Gear', priceTzs: 40000, discountPriceTzs: 36000, effectivePriceTzs: 36000, maxSalePriceTzs: 38000, stock: 5, image: null }] } })],
    ] }));
    await page.goto('/admin/shop-merch/?new=sale');
    await page.getByTestId('sale-product-picker').getByRole('button', { name: /Product/ }).click();
    await page.getByRole('option', { name: /Trail runner/ }).click();
    await page.getByTestId('sale-price').fill('86000');
    await expect(page.getByText('The sale price must be at least 5% below the regular price: TSh 85,500 or less.')).toBeVisible();
    await expect(page.getByTestId('sale-live')).toHaveCount(0);
    await page.getByTestId('sale-price').fill('69000');
    await expect(page.getByTestId('sale-live')).toHaveText('23% off · buyers save TSh 21,000');
    await page.goto('/admin/shop-merch/?new=sale');
    await page.getByTestId('sale-product-picker').getByRole('button', { name: /Product/ }).click();
    await page.getByRole('option', { name: /Gym gloves/ }).click();
    await expect(page.getByTestId('sale-current-discount')).toHaveText("The product's current discount price TSh 36,000");
    await page.getByTestId('sale-price').fill('37000');
    await expect(page.getByText("The sale price must be lower than the product's current discount price of TSh 36,000.")).toBeVisible();
    await expect(page.getByTestId('sale-live')).toHaveCount(0);
  });

  test('QA1 #3/#7 Swahili: sale rows agree with "ofa", the header says "ofa uliyounda", dates on a 12-hour clock with the part of the day', async ({ page }) => {
    await signIn(page, SUPER, 'sw');
    // 16:37 UTC = 19:37 Tanzania time → "7:37 usiku"; 05:10 UTC = 08:10 → "8:10 asubuhi".
    await mockApi(page, adminRoutes({ banners: 'off', sales: [sale({ submittedAt: at(-2), expiresAt: at(20), startsAt: '2026-11-02T16:37:00.000Z', endsAt: '2026-11-03T05:10:00.000Z' })] }));
    await page.goto('/admin/shop-merch/');
    await expect(page.getByText('Huwezi kuidhinisha ofa uliyounda.', { exact: false })).toBeVisible();
    await expect(page.getByTestId('merch-table').getByRole('columnheader', { name: 'Ilitumwa' })).toBeVisible();
    await expect(page.getByTestId('merch-expires-fls_1')).toHaveText('Itaisha muda baada ya saa 20');
    await expect(page.getByTestId('merch-row-fls_1')).toContainText('2 Nov, 7:37 usiku');
    await expect(page.getByTestId('merch-row-fls_1')).toContainText('3 Nov, 8:10 asubuhi');
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await expect(page.getByTestId('sale-dates')).toContainText('2 Nov, 7:37 usiku → 3 Nov, 8:10 asubuhi');
    // Phone: the card says "Ilitumwa saa 2 zilizopita".
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/admin/shop-merch/');
    await expect(page.getByTestId('merch-card-fls_1')).toContainText('Ilitumwa saa 2 zilizopita');
    await expect(page.getByTestId('merch-card-fls_1')).not.toContainText('Lilitumwa');
  });

  test('Swahili: price check, seller pays and type label', async ({ page }) => {
    await signIn(page, SUPER, 'sw');
    await mockApi(page, adminRoutes({ banners: 'off' }));
    await page.goto('/admin/shop-merch/?item=fls_1&kind=flash_sale');
    await expect(page.getByText('Ukaguzi wa bei', { exact: true })).toBeVisible();
    await expect(page.getByTestId('sale-rule-result')).toHaveText('Inakidhi sheria ya siku 14');
    await expect(page.getByTestId('sale-discount-line')).toHaveText('−18% (punguzo TSh 16,000), muuzaji analipia');
    // Sale-only I- forms, never the banner's li- forms.
    await expect(page.getByTestId('sale-terms')).toContainText('Imeundwa na: Rehema');
    await expect(page.getByTestId('sale-terms')).toContainText('Imetumwa na: Rehema');
    await expect(page.getByTestId('merch-history')).toContainText('Imetumwa kwa idhini');
    await expect(page.getByTestId('sale-preview')).toContainText('Inaisha');
  });
});

// ── Vendor ────────────────────────────────────────────────────────────────────

const me = (tools: Json = { portal: true, merch: { banners: true, flashSales: true } }) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff'], approvalStatus: 'approved', accountStatus: 'active', tools,
});
const PRODUCTS = [
  { id: 'prd_1', vendorId: 'usr_vendor', name: 'Trail runner', priceTzs: 90000, stock: 4, status: 'active', approvalStatus: 'approved' },
  { id: 'prd_4', vendorId: 'usr_vendor', name: 'Yoga mat', priceTzs: 50000, discountPriceTzs: 45000, stock: 2, status: 'active', approvalStatus: 'approved' },
  { id: 'prd_2', vendorId: 'usr_vendor', name: 'Sold-out bottle', priceTzs: 9000, stock: 0, status: 'active', approvalStatus: 'approved' },
  { id: 'prd_3', vendorId: 'usr_vendor', name: 'Paused mat', priceTzs: 30000, stock: 3, status: 'paused', approvalStatus: 'approved' },
];
const vsale = (over: Json = {}) => {
  const { vendorName, sellerSuspended, createdBy, createdByName, submittedBy, submittedByName, editedBy, ownItem, regularPriceTzsAtSubmit, discountPriceTzsAtSubmit, priceChangedSinceSubmit, ...v } = sale(over); // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...v, productName: over.productName ?? 'Trail runner', regularPriceTzs: over.regularPriceTzs ?? 90000, salePriceTzs: over.salePriceTzs ?? 72000, discountPct: over.discountPct ?? 20, savingTzs: over.savingTzs ?? 18000, allowedActions: over.allowedActions ?? ['edit', 'withdraw'], endedByFitflex: over.endedByFitflex ?? false };
};
const VENDOR_SALES = () => [
  vsale({ id: 's_live', status: 'approved', effectiveStatus: 'live', startsAt: at(-3), endsAt: at(20), expiresAt: null, wasPriceTzs: 90000, allowedActions: ['end'] }),
  vsale({ id: 's_sched', status: 'approved', effectiveStatus: 'approved', startsAt: at(50), endsAt: at(80), expiresAt: null, allowedActions: ['edit', 'withdraw', 'end'] }),
  vsale({ id: 's_pending', allowedActions: ['edit', 'withdraw'] }),
  vsale({ id: 's_draft', status: 'draft', effectiveStatus: 'draft', expiresAt: null, submittedAt: null, allowedActions: ['edit', 'submit', 'withdraw'] }),
  vsale({ id: 's_ended', status: 'ended', effectiveStatus: 'ended', startsAt: at(-80), endsAt: at(-10), endedAt: at(-12), expiresAt: null, statusReason: 'ended_by_fitflex', statusReasonNote: 'Wrong product photo.', endedByFitflex: true, allowedActions: [] }),
  vsale({ id: 's_susp', status: 'ended', effectiveStatus: 'ended', startsAt: at(-50), endsAt: at(-20), endedAt: at(-30), expiresAt: null, statusReason: 'vendor_suspended', endedByFitflex: true, allowedActions: [] }),
  vsale({ id: 's_expired', status: 'expired', effectiveStatus: 'expired', statusReason: 'not_reviewed_in_time', allowedActions: [] }),
  vsale({ id: 's_rejected', status: 'rejected', effectiveStatus: 'rejected', statusReason: 'timing', statusReasonNote: 'Clashes with a holiday.', expiresAt: null, allowedActions: ['edit'] }),
  vsale({ id: 's_staff', origin: 'staff', productName: 'Yoga mat', status: 'approved', effectiveStatus: 'approved', startsAt: at(30), endsAt: at(60), expiresAt: null, allowedActions: [] }),
];
type CheckFn = (productId: string, startsAt: number) => Json;
const passCheck: CheckFn = productId => {
  const p = PRODUCTS.find(x => x.id === productId)!;
  return { ok: true, productId, regularPriceTzs: p.priceTzs, discountPriceTzs: p.discountPriceTzs ?? null, effectivePriceTzs: p.discountPriceTzs ?? p.priceTzs, maxSalePriceTzs: Math.floor(p.priceTzs * 0.95), raisedAt: null, raisedOn: null, earliestStart: null, listedAt: '2026-09-01T09:00:00.000Z', historyEarliestStart: null, lockedBy: null };
};
function vendorRoutes(items: Json[], o: { check?: CheckFn; extra?: Array<[string, RegExp, Handler]>; tools?: Json; salesOff?: boolean; open?: Json } = {}): Array<[string, RegExp, Handler]> {
  const find = (id: string) => items.find(s => s.id === id);
  const off = { status: 404, json: { error: 'feature_disabled' } };
  return [
    ...(o.extra ?? []),
    ['GET', /^\/vendor\/me$/, () => ({ json: me(o.tools) })],
    ['GET', /^\/vendor\/products$/, () => ({ json: PRODUCTS })],
    ['GET', /^\/vendor\/shop-banners$/, () => ({ json: { items: [], total: 0, nextCursor: null, vendor: { canPropose: true, reason: null }, proposalExpiryDays: 14, openProposals: { open: 0, max: 10 }, confirmation: null } })],
    ['GET', /^\/vendor\/flash-sales$/, () => (o.salesOff ? off : { json: {
      items, total: items.length, nextCursor: null, vendor: { canPropose: true, reason: null }, proposalExpiryDays: 14, openProposals: o.open ?? { open: 3, max: 10 },
      rules: { minDiscountPct: 5, minLengthMs: HOUR, maxLengthMs: 7 * DAY, minLeadMs: HOUR, priceRaiseLookbackDays: 14 },
    } })],
    ['GET', /^\/vendor\/flash-sales\/price-check$/, (_r, c) => ({ json: (o.check ?? passCheck)(c.search.get('productId')!, Date.parse(c.search.get('startsAt') ?? '') || Date.now() + HOUR) })],
    ['POST', /^\/vendor\/flash-sales\/([^/]+)\/withdraw$/, (_r, _c, m) => { Object.assign(find(m[1])!, { status: 'withdrawn', effectiveStatus: 'withdrawn', allowedActions: [] }); return { json: { sale: find(m[1]) } }; }],
    ['POST', /^\/vendor\/flash-sales\/([^/]+)\/end$/, (_r, _c, m) => { Object.assign(find(m[1])!, { status: 'ended', effectiveStatus: 'ended', statusReason: 'ended_by_vendor', endedAt: at(0), allowedActions: [] }); return { json: { sale: find(m[1]) } }; }],
    ['GET', /^\/vendor\/orders$/, () => ({ json: { orders: [], nextCursor: null } })],
    ['GET', /^\/vendor\/payments$/, () => ({ json: { todaySalesTzs: 0, pendingSettlementTzs: 0 } })],
    ['GET', /^\/vendor\/statements$/, () => ({ json: { statements: [], payoutReady: true, payoutBlockedBy: null } })],
  ];
}
async function pickProduct(page: Page, name: RegExp) {
  await page.getByTestId('sale-product-picker').getByRole('button').first().click();
  await page.getByRole('option', { name }).click();
}

test.describe('vendor: flash sales on /vendor/promotions', () => {
  test('list: tab, groups, every status line, FitFlex-set sale read-only, open proposals; withdraw and end', async ({ page }) => {
    await signIn(page, VENDOR);
    const items = VENDOR_SALES();
    const calls = await mockApi(page, vendorRoutes(items));
    await page.goto('/vendor/promotions/');
    await page.getByTestId('merch-vendor-tab-sales').click();
    await expect(page).toHaveURL(/tab=sales/);
    await expect(page.getByRole('heading', { name: 'Banners & flash sales' })).toBeVisible();
    await expect(page.getByTestId('sale-open-proposals')).toHaveText('3 of 10 open proposals');
    await expect(page.getByTestId('sale-group-live')).toContainText('Live · 1');
    await expect(page.getByTestId('sale-status-s_live')).toHaveText('Live');
    await expect(page.getByTestId('sale-price-s_live')).toHaveAttribute('aria-label', 'Sale price TSh 72,000, was TSh 90,000, 20 percent off');
    await expect(page.getByTestId('sale-status-s_sched')).toHaveText('Scheduled');
    await expect(page.getByTestId('sale-status-s_pending')).toHaveText('Waiting for approval');
    await expect(page.getByTestId('sale-line-s_pending')).toContainText('Expires');
    await expect(page.getByTestId('sale-status-s_ended')).toHaveText('Ended');
    await expect(page.getByTestId('sale-line-s_ended')).toContainText('by FitFlex: Wrong product photo.');
    await expect(page.getByTestId('sale-line-s_susp')).toContainText("Ended because the seller's account was suspended");
    await expect(page.getByTestId('sale-status-s_expired')).toHaveText('Expired');
    await expect(page.getByTestId('sale-line-s_expired')).toHaveText('Not reviewed in time');
    await expect(page.getByTestId('sale-line-s_rejected')).toHaveText("Reason: The dates don't work: Clashes with a holiday.");
    await expect(page.getByTestId('sale-staff-s_staff')).toHaveText('FitFlex set this sale on your product. You pay for the discount.');
    await expect(page.getByTestId('sale-card-s_staff').getByRole('button')).toHaveCount(0);
    await expect(page.getByTestId('sale-withdraw-s_live')).toHaveCount(0);

    await page.getByTestId('sale-withdraw-s_pending').click();
    await page.getByTestId('sale-withdraw-confirm').click();
    await expect.poll(() => only(calls, 'POST', '/vendor/flash-sales/s_pending/withdraw').length).toBe(1);
    await page.getByTestId('sale-end-s_live').click();
    await expect(page.getByRole('dialog')).toContainText('Buyers pay the regular price from now.');
    await page.getByTestId('sale-end-confirm').click();
    await expect.poll(() => only(calls, 'POST', '/vendor/flash-sales/s_live/end').length).toBe(1);
    await expect(page.getByTestId('sale-submit-s_draft')).toBeVisible();
    expect(calls.outside).toEqual([]);
  });

  test('propose: live % and TSh, 5% minimum, 90% accepted, below the standing discount, out-of-stock warning, notes', async ({ page }) => {
    await signIn(page, VENDOR);
    await mockApi(page, vendorRoutes([]));
    await page.goto('/vendor/promotions/?tab=sales');
    await page.getByTestId('sale-propose-empty').click();
    await expect(page).toHaveURL(/tab=sales&new=sale/);
    await page.getByTestId('sale-product-picker').getByRole('button').first().click();
    await expect(page.getByRole('option', { name: /Paused mat/ })).toHaveCount(0);
    await page.getByRole('option', { name: /Trail runner/ }).click();
    await expect(page.getByTestId('sale-regular')).toHaveText('Regular price TSh 90,000');
    await page.getByTestId('sale-price').fill('86000');
    await expect(page.getByText('The sale price must be at least 5% below the regular price: TSh 85,500 or less.')).toBeVisible();
    await expect(page.getByTestId('sale-live')).toHaveText('4% off · buyers save TSh 4,000');
    await page.getByTestId('sale-price').fill('85500');
    await expect(page.getByTestId('sale-live')).toHaveText('5% off · buyers save TSh 4,500');
    await expect(page.getByText(/at least 5% below/)).toHaveCount(0);
    await page.getByTestId('sale-price').fill('9000');
    await expect(page.getByTestId('sale-live')).toHaveText('90% off · buyers save TSh 81,000');
    const notes = page.getByTestId('sale-notes');
    await expect(notes).toContainText('You pay for the discount. Your commission is worked out on the sale price.');
    await expect(notes).toContainText("A flash sale can't start within 14 days of a price rise. While it's scheduled or live, you can't change this product's price.");
    await expect(notes).toContainText("FitFlex reviews every sale. If it isn't reviewed within 14 days, or before it starts, it expires.");

    // New form: a product with a standing seller discount.
    await page.goto('/vendor/promotions/?tab=sales&new=sale&product=prd_4');
    await expect(page.getByTestId('sale-current-discount')).toHaveText('Your current discount price TSh 45,000');
    await page.getByTestId('sale-price').fill('46000');
    await expect(page.getByText('The sale price must be lower than your current discount price of TSh 45,000.')).toBeVisible();
    await page.goto('/vendor/promotions/?tab=sales&new=sale&product=prd_2');
    await expect(page.getByTestId('sale-oos')).toHaveText("This product is out of stock. The sale won't show until you add stock.");
  });

  test('14-day rule: the raised message, Send disabled, "Start on" moves the start; then create + send with the contract body', async ({ page }) => {
    await signIn(page, VENDOR);
    const raisedAt = new Date(Date.now() - 5 * DAY).toISOString();
    const earliest = new Date(Date.parse(raisedAt) + 14 * DAY).toISOString();
    const check: CheckFn = (productId, start) => (start < Date.parse(earliest)
      ? { ...passCheck(productId, start), ok: false, raisedAt, raisedOn: tzDate(raisedAt), earliestStart: earliest }
      : passCheck(productId, start));
    const draft = vsale({ id: 's_new', status: 'draft', effectiveStatus: 'draft', allowedActions: ['edit', 'submit', 'withdraw'] });
    const calls = await mockApi(page, vendorRoutes([], { check, extra: [
      ['POST', /^\/vendor\/flash-sales$/, (_r, c) => ({ status: 201, json: { sale: { ...draft, ...c.body } } })],
      ['POST', /^\/vendor\/flash-sales\/s_new\/submit$/, () => ({ json: { sale: { ...draft, status: 'pending_approval', effectiveStatus: 'pending_approval' } } })],
    ] }));
    await page.goto('/vendor/promotions/?tab=sales&new=sale');
    await pickProduct(page, /Trail runner/);
    await page.getByTestId('sale-price').fill('72000');
    const tomorrow = Date.now() + DAY;
    await page.getByTestId('sale-startsAt').fill(eatInput(tomorrow));
    await page.getByTestId('sale-endsAt').fill(eatInput(tomorrow + 2 * DAY));
    await expect(page.getByTestId('sale-raised')).toContainText(`You raised this product's price on ${eatDay(tzDate(raisedAt))}. A flash sale can start on ${eatWhen(earliest)} or later.`);
    await expect(page.getByTestId('sale-submit')).toBeDisabled();
    await page.getByTestId('sale-start-on').click();
    await expect(page.getByTestId('sale-raised')).toHaveCount(0);
    await expect(page.getByTestId('sale-submit')).toBeEnabled();
    await page.getByTestId('sale-submit').click();
    await expect(page).toHaveURL(/tab=sales$/);
    const [create] = only(calls, 'POST', '/vendor/flash-sales');
    expect(Object.keys(create.body!).sort()).toEqual(['endsAt', 'productId', 'salePriceTzs', 'startsAt']);
    expect(create.body).toMatchObject({ productId: 'prd_1', salePriceTzs: 72000, startsAt: new Date(Date.parse(earliest)).toISOString() });
    // The length was kept (2 days).
    expect(Date.parse(create.body!.endsAt) - Date.parse(create.body!.startsAt)).toBe(2 * DAY);
    expect(only(calls, 'POST', '/vendor/flash-sales/s_new/submit')).toHaveLength(1);
    const checks = only(calls, 'GET', '/vendor/flash-sales/price-check');
    expect(checks.every(c => c.search.get('productId') === 'prd_1')).toBe(true);
  });

  test('server refusals are worded: overlap, length, too many open, rate limited; another sale on the product from the price check', async ({ page }) => {
    await signIn(page, VENDOR);
    let answer: Json = {};
    const lockStart = at(100); const lockEnd = at(120);
    await mockApi(page, vendorRoutes([], {
      check: (productId, start) => (productId === 'prd_4' ? { ...passCheck(productId, start), ok: false, lockedBy: { saleId: 's_other', startsAt: lockStart, endsAt: lockEnd, effectiveStatus: 'approved' } } : passCheck(productId, start)),
      extra: [['POST', /^\/vendor\/flash-sales$/, () => answer]],
    }));
    await page.goto('/vendor/promotions/?tab=sales&new=sale');
    await pickProduct(page, /Trail runner/);
    await page.getByTestId('sale-price').fill('72000');
    const start = Date.now() + 2 * DAY;
    // 30 minutes: refused before sending.
    await page.getByTestId('sale-startsAt').fill(eatInput(start));
    await page.getByTestId('sale-endsAt').fill(eatInput(start + 30 * 60_000));
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-endsAt-msg')).toHaveText('A flash sale runs for 1 hour to 7 days.');
    await page.getByTestId('sale-endsAt').fill(eatInput(start + 8 * DAY));
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-endsAt-msg')).toHaveText('A flash sale runs for 1 hour to 7 days.');
    await page.getByTestId('sale-endsAt').fill(eatInput(start + DAY));

    const s1 = at(40); const e1 = at(60);
    answer = { status: 409, json: { error: 'sale_overlap', saleId: 's_x', startsAt: s1, endsAt: e1, effectiveStatus: 'approved' } };
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-startsAt-msg')).toHaveText(`This product already has a flash sale from ${eatWhen(s1)} to ${eatWhen(e1)}.`);
    answer = { status: 409, json: { error: 'too_many_open_proposals', max: 10, open: 10 } };
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-general-error')).toHaveText('You have 10 of 10 flash sales open. Withdraw one or wait for a decision.');
    answer = { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 30 } };
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-general-error')).toHaveText('Too many tries. Wait 30 seconds and try again.');
    answer = { status: 422, json: { error: 'discount_out_of_range', reason: 'below_minimum', minDiscountPct: 5, maxSalePriceTzs: 85500, regularPriceTzs: 90000 } };
    await page.getByTestId('sale-submit').click();
    await expect(page.getByText('The sale price must be at least 5% below the regular price: TSh 85,500 or less.')).toBeVisible();

    await page.goto('/vendor/promotions/?tab=sales&new=sale&product=prd_4');
    await expect(page.getByTestId('sale-overlap')).toHaveText(`This product already has a flash sale from ${eatWhen(lockStart)} to ${eatWhen(lockEnd)}.`);
    await expect(page.getByTestId('sale-submit')).toBeDisabled();
  });

  test('a FitFlex-made sale the server lets the vendor end: End with the confirm note, then POST end', async ({ page }) => {
    await signIn(page, VENDOR);
    const items = [vsale({ id: 's_fx', origin: 'staff', productName: 'Yoga mat', status: 'approved', effectiveStatus: 'live', startsAt: at(-1), endsAt: at(20), expiresAt: null, allowedActions: ['end'] })];
    const calls = await mockApi(page, vendorRoutes(items));
    await page.goto('/vendor/promotions/?tab=sales');
    await expect(page.getByTestId('sale-staff-s_fx')).toBeVisible();
    await page.getByTestId('sale-end-s_fx').click();
    await expect(page.getByTestId('sale-end-staff-note')).toHaveText('FitFlex set this sale on your product. You can end it: buyers pay the regular price from now.');
    await page.getByTestId('sale-end-confirm').click();
    await expect.poll(() => only(calls, 'POST', '/vendor/flash-sales/s_fx/end').length).toBe(1);
    await expect(page.getByTestId('sale-status-s_fx')).toHaveText('Ended');
  });

  test('short price history: from the check (listedAt) and from the server (price_history_too_short), each with "Start on"', async ({ page }) => {
    await signIn(page, VENDOR);
    const listedAt = new Date(Date.now() - 3 * DAY).toISOString();
    const earliest = new Date(Date.parse(listedAt) + 14 * DAY).toISOString();
    let refuse = true;
    const calls = await mockApi(page, vendorRoutes([], {
      check: (productId, start) => (productId === 'prd_4' && start < Date.parse(earliest)
        ? { ...passCheck(productId, start), ok: false, listedAt, historyEarliestStart: earliest }
        : passCheck(productId, start)),
      extra: [['POST', /^\/vendor\/flash-sales$/, () => (refuse
        ? { status: 422, json: { error: 'price_history_too_short', listedAt, earliestStart: earliest } }
        : { status: 201, json: { sale: vsale({ id: 's_h', status: 'draft', effectiveStatus: 'draft' }) } })],
      ['POST', /^\/vendor\/flash-sales\/s_h\/submit$/, () => ({ json: { sale: vsale({ id: 's_h' }) } })]],
    }));
    // From the check.
    await page.goto('/vendor/promotions/?tab=sales&new=sale&product=prd_4');
    await page.getByTestId('sale-price').fill('40000');
    const start = Date.now() + DAY;
    await page.getByTestId('sale-startsAt').fill(eatInput(start));
    await page.getByTestId('sale-endsAt').fill(eatInput(start + DAY));
    await expect(page.getByTestId('sale-history-short')).toContainText(`This product was listed on ${eatWhen(listedAt)}. A flash sale needs 14 days of price history, so it can start on ${eatWhen(earliest)} or later.`);
    await expect(page.getByTestId('sale-submit')).toBeDisabled();
    await page.getByTestId('sale-start-on').click();
    await expect(page.getByTestId('sale-history-short')).toHaveCount(0);
    // From the server (the check passed for this product).
    await page.goto('/vendor/promotions/?tab=sales&new=sale&product=prd_1');
    await page.getByTestId('sale-price').fill('72000');
    await page.getByTestId('sale-startsAt').fill(eatInput(start));
    await page.getByTestId('sale-endsAt').fill(eatInput(start + DAY));
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-startsAt-msg')).toHaveText(`This product was listed on ${eatWhen(listedAt)}. A flash sale needs 14 days of price history, so it can start on ${eatWhen(earliest)} or later.`);
    refuse = false;
    await page.getByTestId('sale-start-on-server').click();
    await expect(page.getByTestId('sale-start-on-server')).toHaveCount(0);
    await page.getByTestId('sale-submit').click();
    await expect(page).toHaveURL(/tab=sales$/);
    expect(only(calls, 'POST', '/vendor/flash-sales').at(-1)!.body!.startsAt).toBe(earliest);
  });

  test('price check failed: Send disabled until a retry passes; overlap without dates, 1-second wait and vendor_not_found are worded', async ({ page }) => {
    await signIn(page, VENDOR);
    let checkDown = true;
    let answer: Json = {};
    await mockApi(page, vendorRoutes([], { extra: [
      ['GET', /^\/vendor\/flash-sales\/price-check$/, (_r, c) => (checkDown ? { status: 500, json: { error: 'server_error' } } : { json: passCheck(c.search.get('productId')!, Date.now() + DAY) })],
      ['POST', /^\/vendor\/flash-sales$/, () => answer],
    ] }));
    await page.goto('/vendor/promotions/?tab=sales&new=sale&product=prd_1');
    await expect(page.getByTestId('sale-check-failed')).toHaveText("Couldn't check the 14-day rule. Try again.");
    await page.getByTestId('sale-price').fill('72000');
    const start = Date.now() + 2 * DAY;
    await page.getByTestId('sale-startsAt').fill(eatInput(start));
    await page.getByTestId('sale-endsAt').fill(eatInput(start + DAY));
    // The check for the new start failed too (wait for it: the check is debounced).
    await expect(page.getByTestId('sale-check-retry')).toBeVisible();
    await expect(page.getByTestId('sale-submit')).toBeDisabled();
    checkDown = false;
    await page.getByTestId('sale-check-retry').click();
    await expect(page.getByTestId('sale-check-failed')).toHaveCount(0);
    await expect(page.getByTestId('sale-submit')).toBeEnabled();
    answer = { status: 409, json: { error: 'sale_overlap' } };
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-startsAt-msg')).toHaveText('This product already has a flash sale at that time.');
    answer = { status: 429, json: { error: 'rate_limited', retryAfterSeconds: 1 } };
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-general-error')).toHaveText('Too many tries. Wait 1 second and try again.');
    answer = { status: 404, json: { error: 'vendor_not_found' } };
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-general-error')).toHaveText("Your business account wasn't found. Sign in again or contact FitFlex.");
  });

  test('Swahili: tab, notes and live line', async ({ page }) => {
    await signIn(page, VENDOR, 'sw');
    await mockApi(page, vendorRoutes([]));
    await page.goto('/vendor/promotions/?tab=sales');
    await expect(page.getByTestId('merch-vendor-tab-sales')).toHaveText('Ofa za muda mfupi');
    await expect(page.getByTestId('merch-vendor-tab-sales')).toHaveAttribute('aria-selected', 'true');
    await page.goto('/vendor/promotions/?tab=sales&new=sale&product=prd_1');
    await page.getByTestId('sale-price').fill('72000');
    await expect(page.getByTestId('sale-live')).toHaveText('Punguzo la 20% · wanunuzi wanaokoa TSh 18,000');
    const notes = page.getByTestId('sale-notes');
    await expect(notes).toContainText('Wewe unalipia punguzo. Kamisheni yako inahesabiwa kwa bei ya ofa.');
    await expect(notes).toContainText('Ofa ya muda mfupi haiwezi kuanza ndani ya siku 14 baada ya kuongeza bei.');
    await expect(notes).toContainText('FitFlex hukagua kila ofa. Isipokaguliwa ndani ya siku 14, au kabla ya kuanza, itaisha muda.');
    await expect(page.getByText(/^Inaanza/).first()).toBeVisible();
  });

  test('Swahili list: I- forms for sales (Sitisha, Iliisha, Itaisha muda, Haijatumwa), never the banner li- forms', async ({ page }) => {
    await signIn(page, VENDOR, 'sw');
    await mockApi(page, vendorRoutes(VENDOR_SALES()));
    await page.goto('/vendor/promotions/?tab=sales');
    await expect(page.getByTestId('sale-status-s_draft')).toHaveText('Haijatumwa');
    await expect(page.getByTestId('sale-line-s_draft')).toHaveText('Bado haijatumwa kwa idhini');
    await expect(page.getByTestId('sale-line-s_pending')).toContainText('Itaisha muda');
    await expect(page.getByTestId('sale-line-s_ended')).toContainText('Iliisha');
    await expect(page.getByTestId('sale-line-s_ended')).toContainText('imesitishwa na FitFlex: Wrong product photo.');
    await expect(page.getByTestId('sale-line-s_expired')).toHaveText('Haikukaguliwa kwa wakati');
    await expect(page.getByTestId('sale-line-s_susp')).toContainText('Iliisha kwa sababu akaunti ya muuzaji ilisimamishwa');
    await expect(page.getByTestId('sale-line-s_rejected')).toHaveText('Sababu: Tarehe hazifai: Clashes with a holiday.');
    await expect(page.getByTestId('sale-group-scheduled')).toContainText('Zimepangwa');
    await expect(page.getByTestId('sale-end-s_live')).toHaveAttribute('aria-label', 'Sitisha sasa ofa ya muda mfupi ya Trail runner');
    await page.getByTestId('sale-end-s_live').click();
    await expect(page.getByRole('dialog')).toContainText('Usitishe ofa hii sasa?');
    await expect(page.getByTestId('sale-end-keep')).toHaveText('Iache');
    const body = await page.locator('main').innerText();
    for (const banned of ['Liliisha', 'Litaisha', 'Halijatumwa', 'Halikukaguliwa', 'simamisha']) expect(body).not.toContain(banned);
  });

  test('SHOP_FLASH_SALES off: no Flash sales tab; a deep link says the tool is not available', async ({ page }) => {
    await signIn(page, VENDOR);
    await mockApi(page, vendorRoutes([], { salesOff: true, tools: { portal: true, merch: { banners: true, flashSales: false } } }));
    await page.goto('/vendor/promotions/');
    await expect(page.getByTestId('merch-vendor-tab-banners')).toBeVisible();
    await expect(page.getByTestId('merch-vendor-tab-sales')).toHaveCount(0);
    await page.goto('/vendor/promotions/?tab=sales');
    await expect(page.getByText("This tool isn't available yet")).toBeVisible();
  });

  test('products list: price lock line while a sale runs, and "Start a flash sale" opens the form with the product', async ({ page }) => {
    await signIn(page, VENDOR);
    const lockStart = at(-2); const lockEnd = at(30);
    await mockApi(page, vendorRoutes([], { extra: [
      ['GET', /^\/vendor\/products$/, () => ({ json: [{ ...PRODUCTS[0], priceLock: { saleId: 's_live', startsAt: lockStart, endsAt: lockEnd, effectiveStatus: 'live' } }, PRODUCTS[1]] })],
    ] }));
    await page.goto('/vendor/products/');
    await expect(page.locator('[data-testid="price-lock-prd_1"]:visible')).toContainText(`Locked while your flash sale runs (${eatWhen(lockStart)}–${eatWhen(lockEnd)}).`);
    await page.locator('[data-testid="start-sale-prd_4"]:visible').click();
    await expect(page).toHaveURL(/tab=sales&new=sale&product=prd_4/);
    await expect(page.getByTestId('sale-current-discount')).toHaveText('Your current discount price TSh 45,000');
  });
});
