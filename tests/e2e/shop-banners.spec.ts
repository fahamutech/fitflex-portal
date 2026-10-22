import { expect, test, type Page, type Request } from '@playwright/test';
import { deflateSync } from 'node:zlib';

// Shop home banners (Phase 2 S1) against a mocked API: the admin merch queue (/admin/shop-merch: tabs, detail with
// previews in both languages and themes, approve with the checklist, reject with a reason, own-item block, end,
// position, staff create with photo + confirmations, permission text) and the vendor web portal (/vendor/promotions:
// propose with both languages, inline rules, server field errors, send, withdraw, end, feature_disabled, the
// /vendor/merch link). Network guard: every request outside localhost is aborted; nothing reaches a real service.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Call = { method: string; path: string; search: URLSearchParams; body: Json | null; raw: string | null };

const HOUR = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const SUPER = { id: 'admin-x', userType: 'admin' };
const STAFF_VIEWER = { id: 'admin-v', userType: 'admin', portalUser: true, aclPermissions: ['promotions'] };
const VENDOR = { id: 'usr_vendor', userType: 'vendor', displayName: 'Rehema' };

// ── A solid-colour PNG of any size (the form reads the real pixel size before uploading) ──
function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 0x40); row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BIG = { name: 'shoes.png', mimeType: 'image/png', buffer: png(1600, 1000) };
const SMALL = { name: 'small.png', mimeType: 'image/png', buffer: png(1200, 800) };
const GIF = { name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') };

const bi = (en: string, sw: string) => ({ en, sw });
const CONFIRMATION = {
  version: '2026-10-20.draft1', status: 'draft_pending_counsel',
  rights: bi('SERVER: I have the right to use this image.', 'SERVER: Nina haki ya kutumia picha hii.'),
  models: bi('SERVER: The people are models; I hold their release.', 'SERVER: Watu hawa ni wanamitindo; nina ridhaa yao.'),
};
function banner(over: Json = {}): Json {
  return {
    id: 'bn_1', origin: 'vendor', vendorId: 'usr_vendor', vendorName: 'Dar Fitness Gear', sellerSuspended: false,
    status: 'pending_approval', effectiveStatus: 'pending_approval',
    headlineLead: bi('Run further in', 'Kimbia mbali zaidi na'), headlineAccent: bi('new shoes', 'viatu vipya'), subline: bi('Light and strong.', 'Nyepesi na imara.'),
    ctaLabel: bi('View product', 'Tazama bidhaa'), ctaLabelCustom: false, imageAlt: bi('A pair of running shoes', 'Jozi ya viatu vya kukimbia'),
    target: { type: 'product', value: 'prd_1' }, targetName: 'Trail runner', audienceRoles: ['member', 'trainer', 'owner'],
    startsAt: at(48), endsAt: at(24 * 9), position: null, statusReason: null, statusReasonNote: null, ctaKey: 'view_product', expiresAt: at(47),
    submittedAt: at(-2), createdAt: at(-3), createdBy: 'usr_vendor', createdByName: 'Rehema', submittedBy: 'usr_vendor', submittedByName: 'Rehema',
    approvedBy: null, ownItem: false, allowedActions: ['approve', 'reject'], revision: 3, updatedAt: '2026-10-20T08:30:00.000Z',
    image: {
      id: 'img_1', uploadedBy: 'usr_vendor', uploadedByName: 'Rehema', confirmationVersion: '2026-10-20.draft1', consentRef: 'MR-2026-007', licenceRef: null, width: 1600, height: 1000, people: 'product_models', focal: { x: 0, y: 0 },
      rightsConfirmedAt: '2026-10-20T08:00:00.000Z', peopleConfirmedAt: '2026-10-20T08:00:00.000Z',
      rightsConfirmedBy: 'usr_vendor', rightsConfirmedByName: 'Rehema', peopleConfirmedBy: 'usr_vendor', peopleConfirmedByName: 'Rehema',
      previewUrl: '/admin/shop-banners/bn_1/image', public: null,
    },
    ...over,
  };
}
const ITEMS = () => [
  banner(),
  banner({ id: 'bn_live', status: 'approved', effectiveStatus: 'live', startsAt: at(-5), endsAt: at(48), position: 2, approvedBy: 'admin-y', approvedByName: 'Yusuf', allowedActions: ['end', 'position'], expiresAt: null, headlineLead: bi('Strong days with', 'Siku imara na'), headlineAccent: bi('FitFlex gear', 'vifaa vya FitFlex') }),
  banner({ id: 'bn_mine', origin: 'staff', vendorId: null, vendorName: null, createdBy: 'admin-x', submittedBy: 'admin-x', ownItem: true, allowedActions: ['edit', 'image', 'withdraw'], headlineLead: bi('Shop the', 'Nunua'), headlineAccent: bi('new season', 'msimu mpya') }),
  banner({ id: 'bn_old', status: 'rejected', effectiveStatus: 'rejected', statusReason: 'image', statusReasonNote: 'Blurred edges.', allowedActions: [], expiresAt: null }),
  // Sent later but expires sooner: listed first in Requests.
  banner({ id: 'bn_soon', expiresAt: at(20.5), submittedAt: at(-1), headlineLead: bi('Last chance for', 'Nafasi ya mwisho kwa'), headlineAccent: bi('yoga mats', 'mikeka ya yoga') }),
];

async function signIn(page: Page, user: Json, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [user, locale] as const);
}

type Handler = (req: Request, call: Call, m: RegExpMatchArray) => { status?: number; json?: unknown; body?: Buffer; contentType?: string };
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
    const call = { method: req.method(), path: url.pathname, search: url.searchParams, body, raw: req.postData() };
    calls.push(call);
    for (const [method, re, h] of routes) {
      const m = url.pathname.match(re);
      if (method === req.method() && m) {
        const r = h(req, call, m);
        if (r.body) return route.fulfill({ status: r.status ?? 200, body: r.body, contentType: r.contentType ?? 'image/webp' });
        return route.fulfill({ status: r.status ?? 200, json: r.json ?? {} });
      }
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  return Object.assign(calls, { outside });
}
const only = (calls: Call[], method: string, path: string) => calls.filter(c => c.method === method && c.path === path);
const photo: Handler = () => ({ body: png(16, 10), contentType: 'image/png' });
const nav = (page: Page) => page.getByRole('navigation', { name: /main navigation|menyu kuu/i });

// ── Admin ─────────────────────────────────────────────────────────────────────

function adminRoutes(items: Json[], extra: Array<[string, RegExp, Handler]> = []): Array<[string, RegExp, Handler]> {
  const find = (id: string) => items.find(b => b.id === id);
  return [
    ...extra,
    ['GET', /^\/admin\/shop-merch$/, () => ({ json: { items, total: items.length, nextCursor: null, confirmation: CONFIRMATION } })],
    ['GET', /^\/admin\/shop-banners\/([^/]+)\/image$/, photo],
    ['GET', /^\/admin\/shop-banners\/([^/]+)$/, (_r, _c, m) => (find(m[1]) ? { json: { banner: find(m[1]), history: [{ id: 1, action: 'shop_banner.submitted', actor: 'usr_vendor', actorName: 'Rehema', at: at(-2) }, { id: 2, action: 'shop_banner.image_published', actor: 'admin-y', actorName: 'Yusuf', at: at(-1) }, { id: 3, action: 'shop_banner.public_files_orphaned', actor: 'admin-y', actorName: 'Yusuf', at: at(-1) }, { id: 4, action: 'shop_banner.something_new', actor: 'admin-y', actorName: 'Yusuf', at: at(-1) }] } } : { status: 404, json: { error: 'banner_not_found' } })],
    ['POST', /^\/admin\/shop-banners\/([^/]+)\/approve$/, (_r, c, m) => { Object.assign(find(m[1])!, { status: 'approved', effectiveStatus: 'approved', allowedActions: ['end', 'position'], approvedBy: 'admin-x' }); return { json: { banner: find(m[1]) } }; }],
    ['POST', /^\/admin\/shop-banners\/([^/]+)\/reject$/, (_r, c, m) => { Object.assign(find(m[1])!, { status: 'rejected', effectiveStatus: 'rejected', statusReason: c.body?.code, statusReasonNote: c.body?.note ?? null, allowedActions: [] }); return { json: { banner: find(m[1]) } }; }],
    ['POST', /^\/admin\/shop-banners\/([^/]+)\/end$/, (_r, c, m) => { Object.assign(find(m[1])!, { status: 'ended', effectiveStatus: 'ended', statusReason: 'ended_by_fitflex', statusReasonNote: c.body?.note, allowedActions: [] }); return { json: { banner: find(m[1]) } }; }],
    ['POST', /^\/admin\/shop-banners\/([^/]+)\/position$/, (_r, c, m) => { find(m[1])!.position = c.body?.position; return { json: { banner: find(m[1]) } }; }],
    ['GET', /^\/admin\/products$/, () => ({ json: [{ id: 'prd_1', vendorId: 'usr_vendor', name: 'Trail runner', priceTzs: 90000, stock: 4, status: 'active' }] })],
    ['GET', /^\/admin\/vendors$/, () => ({ json: [{ id: 'usr_vendor', displayName: 'Dar Fitness Gear', userType: 'vendor', approvalStatus: 'approved', accountStatus: 'active', productCount: 1 }] })],
    ['GET', /^\/shop\/categories$/, () => ({ json: { categories: [{ key: 'footwear', en: 'Footwear', sw: 'Viatu' }] } })],
  ];
}

test.describe('admin merch queue', () => {
  test('SHOP_BANNERS off: no nav item, and the page says the tool is not available', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, [['GET', /^\/admin\/shop-merch$/, () => ({ status: 404, json: { error: 'feature_disabled' } })]]);
    await page.goto('/admin/');
    await expect(nav(page).getByRole('link', { name: 'Promotions', exact: true })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Banners & flash sales' })).toHaveCount(0);
    await page.goto('/admin/shop-merch/');
    await expect(page.getByText("This tool isn't available yet")).toBeVisible();
    expect(calls.outside).toEqual([]);
  });

  test('queue: nav item, tabs with counts, row opens the detail with previews, both languages and themes, confirmations', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, adminRoutes(ITEMS()));
    await page.goto('/admin/');
    await nav(page).getByRole('link', { name: 'Banners & flash sales' }).click();
    await expect(page).toHaveURL(/\/admin\/shop-merch\/?/);
    await expect(page.getByTestId('merch-count-requests')).toHaveText('3');
    // Sorted by expiresAt, soonest first (review #10); under a day in hours, under 72 h in days (QA1 #5).
    await expect(page.getByTestId('merch-table').locator('tbody tr').first()).toHaveAttribute('data-testid', 'merch-row-bn_soon');
    await expect(page.getByTestId('merch-expires-bn_soon')).toHaveText('Expires in 20 hours');
    // Rounded to the nearest unit (QA2 #2): ~47 h → 2 days.
    await expect(page.getByTestId('merch-expires-bn_1')).toHaveText('Expires in 2 days');
    // Sent column, type filter and search (QA1 #6).
    await expect(page.getByTestId('merch-row-bn_soon')).toContainText('1 hour ago');
    await expect(page.getByTestId('merch-type-filter').getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('merch-search').fill('yoga');
    await expect(page.getByTestId('merch-row-bn_soon')).toBeVisible();
    await expect(page.getByTestId('merch-row-bn_1')).toHaveCount(0);
    // The icon never covers the text (QA2 #1); no matches has its own message (QA2 #4).
    const pad = await page.getByTestId('merch-search').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
    expect(pad).toBeGreaterThanOrEqual(36);
    await page.getByTestId('merch-search').fill('zzzz-nothing');
    await expect(page.getByTestId('merch-empty')).toHaveText('No banners match your search');
    await page.getByTestId('merch-search').fill('');
    // Header buttons are at least 44 px tall (QA2 #3); the type filter says "Banners" (QA2 #8).
    for (const id of ['merch-refresh', 'merch-create-banner']) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId('merch-type-filter').getByRole('button', { name: 'Banners' })).toBeVisible();
    await expect(page.getByTestId('merch-count-live')).toHaveText('1');
    await expect(page.getByTestId('merch-count-closed')).toHaveText('1');
    await expect(page.getByTestId('merch-count-drafts')).toHaveText('0');
    await expect(page.getByTestId('merch-tab-requests')).toHaveAttribute('aria-selected', 'true');
    // The own staff banner is pending too, so it is in Requests with the vendor's.
    await expect(page.getByTestId('merch-row-bn_1')).toContainText('Dar Fitness Gear');
    await page.getByTestId('merch-tab-live').click();
    await expect(page.getByTestId('merch-row-bn_live')).toContainText('Strong days with FitFlex gear');
    await page.getByTestId('merch-tab-requests').click();
    await page.getByTestId('merch-row-bn_1').click();
    await expect(page).toHaveURL(/item=bn_1/);
    const detail = page.getByTestId('merch-detail');
    await expect(detail.getByTestId('banner-preview-phone')).toBeVisible();
    await expect(detail.getByTestId('banner-preview-desktop')).toBeVisible();
    await expect(detail.getByTestId('banner-preview-from').first()).toHaveText('From Dar Fitness Gear');
    await expect(detail.getByTestId('banner-preview-accent').first()).toHaveText('new shoes');
    await detail.getByTestId('banner-preview-lang').getByRole('button', { name: 'Kiswahili' }).click();
    await expect(detail.getByTestId('banner-preview-accent').first()).toHaveText('viatu vipya');
    await expect(detail.getByTestId('banner-preview-from').first()).toHaveText('Kutoka Dar Fitness Gear');
    await detail.getByTestId('banner-preview-theme').getByRole('button', { name: 'Dark' }).click();
    await expect(detail.getByTestId('banner-preview-phone')).toHaveAttribute('data-theme', 'dark');
    await expect(detail.getByTestId('merch-people')).toHaveText('Models showing the product');
    await expect(detail.getByTestId('merch-rights')).toContainText('Confirmed by Rehema');
    await expect(detail.getByTestId('merch-people-confirmed')).toContainText('Confirmed by Rehema');
    await expect(detail.getByTestId('merch-target')).toContainText('Trail runner');
    await expect(detail.getByTestId('merch-confirmation-version')).toHaveText('2026-10-20.draft1');
    await expect(detail.getByTestId('merch-consent-ref')).toHaveText('MR-2026-007');
    await expect(detail.getByTestId('merch-history')).toContainText('Sent for approval');
    // Every event is labelled (QA1 #2), unknown ones too, with the person's name.
    await expect(detail.getByTestId('merch-history')).toContainText('Photo published');
    await expect(detail.getByTestId('merch-history')).toContainText('Public photo files were not used (recorded)');
    await expect(detail.getByTestId('merch-history')).toContainText('Other change');
    await expect(detail.getByTestId('merch-history')).not.toContainText('something');
    await expect(detail.getByTestId('merch-history')).toContainText('Yusuf');
    // The private photo is fetched with the session (no public copy before approval).
    expect(only(calls, 'GET', '/admin/shop-banners/bn_1/image').length).toBeGreaterThan(0);
    expect(calls.outside).toEqual([]);
  });

  test('QA1: SW phone preview chip sits above the headline; store target shows the store name; 375 px queue is cards', async ({ page }) => {
    await signIn(page, SUPER, 'sw');
    const items = [banner({ target: { type: 'vendor_store', value: 'usr_vendor' }, targetName: null, vendorName: 'FitFlex Performance Store Dar es Salaam' })];
    await mockApi(page, adminRoutes(items));
    await page.goto('/admin/shop-merch/?item=bn_1');
    const phone = page.getByTestId('merch-detail').getByTestId('banner-preview-phone');
    for (const theme of ['Mwanga', 'Giza']) {
      await page.getByTestId('banner-preview-theme').getByRole('button', { name: theme }).click();
      const chip = await phone.getByTestId('banner-preview-from').boundingBox();
      const head = await phone.getByTestId('banner-preview-headline').boundingBox();
      expect(chip && head && chip.y + chip.height <= head.y + 0.5).toBeTruthy();
    }
    await expect(page.getByTestId('merch-target')).toHaveText('Duka la muuzaji: FitFlex Performance Store Dar es Salaam');
    await page.setViewportSize({ width: 375, height: 812 });
    // The phone preview scales to the column: no sideways scroll at 375 (QA2 #5).
    await expect(page.getByTestId('banner-preview-fit').first()).not.toHaveAttribute('data-scale', '1.000');
    const fit = page.getByTestId('banner-preview-fit').first();
    const fitBox = (await fit.boundingBox())!;
    const slideBox = (await fit.locator('.banner-slide').boundingBox())!;
    expect(slideBox.x + slideBox.width).toBeLessThanOrEqual(fitBox.x + fitBox.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await page.goto('/admin/shop-merch/');
    await expect(page.getByTestId('merch-cards')).toBeVisible();
    await expect(page.getByTestId('merch-table')).toBeHidden();
    await expect(page.getByTestId('merch-card-bn_1')).toContainText('Lilitumwa');
    await page.getByTestId('merch-card-bn_1').click();
    await expect(page).toHaveURL(/item=bn_1/);
  });

  test('approve needs all three checks and sends them; the item moves to Scheduled', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, adminRoutes(ITEMS()));
    await page.goto('/admin/shop-merch/?item=bn_1');
    await page.getByTestId('merch-approve').click();
    const dlg = page.getByTestId('merch-approve-dialog');
    await expect(dlg.getByTestId('merch-approve-confirm')).toBeDisabled();
    await dlg.getByTestId('merch-check-people').check();
    await dlg.getByTestId('merch-check-text').check();
    await expect(dlg.getByTestId('merch-approve-confirm')).toBeDisabled();
    await dlg.getByTestId('merch-check-languages').check();
    await dlg.getByTestId('merch-approve-confirm').click();
    await expect(page.getByTestId('merch-status')).toHaveText('Scheduled');
    // H2: the revision and photo the reviewer saw go with the decision.
    expect(only(calls, 'POST', '/admin/shop-banners/bn_1/approve')[0].body).toEqual({ checks: ['people', 'text', 'languages'], revision: 3, imageId: 'img_1' });
  });

  test('approve refusals are shown in words (image_people_unconfirmed, cannot_approve_own_submission)', async ({ page }) => {
    await signIn(page, SUPER);
    let refusal: Json = { error: 'image_people_unconfirmed', field: 'checks' };
    await mockApi(page, adminRoutes(ITEMS(), [['POST', /^\/admin\/shop-banners\/bn_1\/approve$/, () => ({ status: refusal.error === 'cannot_approve_own_submission' ? 403 : 422, json: refusal })]]));
    await page.goto('/admin/shop-merch/?item=bn_1');
    await page.getByTestId('merch-approve').click();
    for (const c of ['people', 'text', 'languages']) await page.getByTestId(`merch-check-${c}`).check();
    await page.getByTestId('merch-approve-confirm').click();
    await expect(page.getByTestId('merch-approve-dialog')).toContainText("make sure the photo's confirmations were given");
    refusal = { error: 'cannot_approve_own_submission' };
    await page.getByTestId('merch-approve-confirm').click();
    await expect(page.getByTestId('merch-approve-dialog')).toContainText('You created, changed or added the photo for this banner, so another admin must decide on it.');
  });

  test('reject needs a reason; "Other" needs a note; reason and code are sent', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, adminRoutes(ITEMS()));
    await page.goto('/admin/shop-merch/?item=bn_1');
    await page.getByTestId('merch-reject').click();
    const dlg = page.getByTestId('merch-reject-dialog');
    await expect(dlg.getByTestId('merch-reject-confirm')).toBeDisabled();
    await dlg.getByTestId('merch-reason-other').check();
    await expect(dlg.getByTestId('merch-reject-confirm')).toBeDisabled();
    await dlg.getByTestId('merch-reject-note').fill('too short');
    await expect(dlg.getByTestId('merch-reject-confirm')).toBeDisabled();
    await dlg.getByTestId('merch-reason-image').check();
    await dlg.getByTestId('merch-reject-note').fill('The photo is blurred at the edges.');
    await dlg.getByTestId('merch-reject-confirm').click();
    await expect(page.getByTestId('merch-status')).toHaveText('Rejected');
    // Code and note apart (review #5); the label is rendered from the code in the reader's language.
    expect(only(calls, 'POST', '/admin/shop-banners/bn_1/reject')[0].body).toEqual({ code: 'image', note: 'The photo is blurred at the edges.', revision: 3, imageId: 'img_1' });
    await expect(page.getByTestId('merch-reason')).toHaveText('Reason: Image quality: The photo is blurred at the edges.');
  });

  test('own item: Approve and Reject are disabled with the visible reason', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, adminRoutes(ITEMS()));
    await page.goto('/admin/shop-merch/?item=bn_mine');
    const hint = page.getByTestId('merch-own-item');
    await expect(hint).toHaveText('You created this, so another admin must approve it.');
    await expect(page.getByTestId('merch-approve')).toBeDisabled();
    await expect(page.getByTestId('merch-reject')).toBeDisabled();
    const hintId = await hint.getAttribute('id');
    await expect(page.getByTestId('merch-approve')).toHaveAttribute('aria-describedby', hintId!);
    // The creator may withdraw it instead; a staff banner has no "From" chip.
    await expect(page.getByTestId('merch-withdraw')).toBeVisible();
    await expect(page.getByTestId('banner-preview-from')).toHaveCount(0);
    expect(only(calls, 'POST', '/admin/shop-banners/bn_mine/approve')).toHaveLength(0);
  });

  test('H1: you uploaded its photo → Approve/Reject disabled with the reason; the server refusal reads the same', async ({ page }) => {
    await signIn(page, { id: 'admin-up', userType: 'admin' });
    const items = [banner({ image: { ...banner().image, uploadedBy: 'admin-up' } })];
    await mockApi(page, adminRoutes(items));
    await page.goto('/admin/shop-merch/?item=bn_1');
    await expect(page.getByTestId('merch-own-item')).toHaveText('You created, changed or added the photo for this banner, so another admin must decide on it.');
    await expect(page.getByTestId('merch-approve')).toBeDisabled();
    await expect(page.getByTestId('merch-reject')).toBeDisabled();
  });

  test('H2: a banner that changed after it was opened is not decided: message, and the detail reloads', async ({ page }) => {
    await signIn(page, SUPER);
    const items = ITEMS();
    let changed = false;
    const calls = await mockApi(page, adminRoutes(items, [
      ['POST', /^\/admin\/shop-banners\/bn_1\/reject$/, () => { changed = true; return { status: 409, json: { error: 'banner_changed' } }; }],
      ['GET', /^\/admin\/shop-banners\/bn_1$/, () => { return { json: { banner: changed ? { ...items[0], revision: 4, headlineAccent: bi('trail shoes', 'viatu vya milimani') } : items[0], history: [] } }; }],
    ]));
    await page.goto('/admin/shop-merch/?item=bn_1');
    await page.getByTestId('merch-reject').click();
    await page.getByTestId('merch-reason-link').check();
    await page.getByTestId('merch-reject-confirm').click();
    await expect(page.getByTestId('merch-stale')).toHaveText('This banner changed after you opened it. Review it again.');
    await expect(page.getByTestId('merch-reject-dialog')).toHaveCount(0);
    await expect(page.getByTestId('merch-headline')).toHaveText('Run further in trail shoes');
    expect(only(calls, 'POST', '/admin/shop-banners/bn_1/reject')[0].body).toMatchObject({ code: 'link', revision: 3 });
    // The next decision carries the new revision.
    await page.getByTestId('merch-approve').click();
    for (const c of ['people', 'text', 'languages']) await page.getByTestId(`merch-check-${c}`).check();
    await page.getByTestId('merch-approve-confirm').click();
    await expect.poll(() => only(calls, 'POST', '/admin/shop-banners/bn_1/approve')[0]?.body?.revision).toBe(4);
  });

  test('429 rate_limited is shown in words', async ({ page }) => {
    await signIn(page, SUPER);
    await mockApi(page, adminRoutes(ITEMS(), [['POST', /^\/admin\/shop-banners\/bn_live\/position$/, () => ({ status: 429, json: { error: 'rate_limited' } })]]));
    await page.goto('/admin/shop-merch/?item=bn_live');
    await page.getByTestId('merch-set-position').click();
    await page.getByTestId('merch-position-input').fill('1');
    await page.getByTestId('merch-position-save').click();
    await expect(page.getByTestId('merch-position-dialog')).toContainText('Too many tries. Wait a minute and try again.');
  });

  test('Swahili (glossary 2026-10-20): Sitisha sasa, Weka mpangilio, Kutoka {vendor}', async ({ page }) => {
    await signIn(page, SUPER, 'sw');
    await mockApi(page, adminRoutes(ITEMS()));
    await page.goto('/admin/shop-merch/?item=bn_live');
    await expect(page.getByTestId('merch-end')).toHaveText('Sitisha sasa');
    await expect(page.getByTestId('merch-set-position')).toHaveText('Weka mpangilio');
    await expect(page.getByTestId('banner-preview-from').first()).toHaveText('Kutoka Dar Fitness Gear');
  });

  test('end a live banner needs a reason; set position', async ({ page }) => {
    await signIn(page, SUPER);
    const calls = await mockApi(page, adminRoutes(ITEMS()));
    await page.goto('/admin/shop-merch/?item=bn_live');
    await expect(page.getByTestId('merch-status')).toHaveText('Live');
    await page.getByTestId('merch-set-position').click();
    await page.getByTestId('merch-position-input').fill('3');
    await page.getByTestId('merch-position-save').click();
    await expect(page.getByTestId('merch-position')).toHaveText('3');
    expect(only(calls, 'POST', '/admin/shop-banners/bn_live/position')[0].body).toEqual({ position: 3 });
    await page.getByTestId('merch-end').click();
    await expect(page.getByTestId('merch-end-confirm')).toBeDisabled();
    await page.getByTestId('merch-end-reason').fill('The product was recalled by the maker.');
    await page.getByTestId('merch-end-confirm').click();
    await expect(page.getByTestId('merch-status')).toHaveText('Ended');
    expect(only(calls, 'POST', '/admin/shop-banners/bn_live/end')[0].body).toEqual({ note: 'The product was recalled by the maker.' });
  });

  test('without promotions_approve: the item shows, with the permission text and no decision buttons', async ({ page }) => {
    await signIn(page, STAFF_VIEWER);
    await mockApi(page, adminRoutes(ITEMS().map(b => ({ ...b, allowedActions: b.origin === 'staff' ? ['edit'] : [] }))));
    await page.goto('/admin/shop-merch/?item=bn_1');
    await expect(page.getByTestId('merch-no-approve')).toHaveText('You can view this. Approving needs the "Approve promotions" permission.');
    await expect(page.getByTestId('merch-approve')).toHaveCount(0);
    await expect(page.getByTestId('merch-reject')).toHaveCount(0);
    await expect(page.getByTestId('merch-end')).toHaveCount(0);
  });

  test('staff create: inline checks, then create → photo with confirmations → send to another admin', async ({ page }) => {
    await signIn(page, SUPER);
    const created = banner({ id: 'bn_new', origin: 'staff', vendorId: null, vendorName: null, status: 'draft', effectiveStatus: 'draft', image: null, ownItem: true, allowedActions: ['edit', 'image', 'submit', 'withdraw'] });
    const items = ITEMS();
    const calls = await mockApi(page, adminRoutes(items, [
      ['POST', /^\/admin\/shop-banners$/, () => { items.push(created); return { status: 201, json: { banner: created } }; }],
      ['PATCH', /^\/admin\/shop-banners\/bn_new$/, () => ({ json: { banner: created } })],
      ['POST', /^\/admin\/shop-banners\/bn_new\/image$/, () => { created.image = banner().image; return { json: { banner: created } }; }],
      ['POST', /^\/admin\/shop-banners\/bn_new\/submit$/, () => { Object.assign(created, { status: 'pending_approval', effectiveStatus: 'pending_approval', allowedActions: ['withdraw'] }); return { json: { banner: created } }; }],
    ]));
    await page.goto('/admin/shop-merch/');
    await page.getByTestId('merch-create-banner').click();
    await expect(page).toHaveURL(/new=banner/);
    // Empty send: every required field says so, and focus goes to the first (the photo).
    await page.getByTestId('banner-submit').click();
    await expect(page.getByTestId('banner-image-msg')).toHaveText('Add an image.');
    await expect(page.getByTestId('banner-choose-image')).toBeFocused();
    await expect(page.getByTestId('banner-field-headlineLead')).toContainText('This is required.');
    // Staff targets and the button label list.
    await page.getByTestId('banner-target-type').selectOption('category');
    await page.getByTestId('banner-target-category').selectOption('footwear');
    await page.getByTestId('banner-cta-select').selectOption('viewAll');
    await page.getByTestId('banner-file-input').setInputFiles(BIG);
    await expect(page.getByTestId('banner-file-chosen')).toContainText('1600 × 1000');
    // With a photo chosen, who is in it and the rights confirmation are required.
    await page.getByTestId('banner-submit').click();
    await expect(page.getByText('Choose one.')).toBeVisible();
    await expect(page.getByTestId('banner-rights-error')).toHaveText('Tick this box to confirm.');
    await page.getByTestId('banner-people-none').check();
    await page.getByTestId('banner-rights').check();
    await page.getByTestId('banner-headlineLead-en').fill('Shop the');
    await page.getByTestId('banner-headlineLead-sw').fill('Nunua');
    await page.getByTestId('banner-headlineAccent-en').fill('new season');
    await page.getByTestId('banner-headlineAccent-sw').fill('msimu mpya');
    await page.getByTestId('banner-imageAlt-en').fill('Running shoes on a track');
    await page.getByTestId('banner-imageAlt-sw').fill('Viatu vya kukimbia uwanjani');
    await page.getByTestId('banner-startsAt').fill(new Date(Date.now() + 3 * 24 * HOUR + 3 * HOUR).toISOString().slice(0, 16));
    await page.getByTestId('banner-endsAt').fill(new Date(Date.now() + 9 * 24 * HOUR + 3 * HOUR).toISOString().slice(0, 16));
    // No "From" chip on a FitFlex banner preview.
    await expect(page.getByTestId('banner-form').getByTestId('banner-preview-from')).toHaveCount(0);
    await page.getByTestId('banner-submit').click();
    await expect(page).toHaveURL(/item=bn_new/);
    const body = only(calls, 'POST', '/admin/shop-banners')[0].body!;
    expect(body).toMatchObject({
      headlineLead: { en: 'Shop the', sw: 'Nunua' }, headlineAccent: { en: 'new season', sw: 'msimu mpya' }, subline: null,
      ctaKey: 'view_all', target: { type: 'category', value: 'footwear' }, audienceRoles: ['member', 'trainer', 'owner'],
    });
    expect(Object.keys(body).sort()).toEqual(['audienceRoles', 'ctaKey', 'endsAt', 'headlineAccent', 'headlineLead', 'imageAlt', 'startsAt', 'subline', 'target']);
    const upload = only(calls, 'POST', '/admin/shop-banners/bn_new/image')[0];
    expect(upload.raw).toContain('name="people"\r\n\r\nnone');
    expect(upload.raw).toContain('name="rightsConfirmed"\r\n\r\ntrue');
    expect(upload.raw).toContain('name="confirmationVersion"\r\n\r\n2026-10-20.draft1');
    expect(upload.raw).not.toContain('name="consentRef"');
    expect(only(calls, 'POST', '/admin/shop-banners/bn_new/submit')).toHaveLength(1);
  });
});

// ── Vendor ────────────────────────────────────────────────────────────────────

const me = (extra: Json = {}) => ({
  vendorId: 'usr_vendor', businessName: 'Dar Fitness Gear', userType: 'vendor', vendorRole: null,
  permissions: ['products', 'orders', 'sales', 'customers', 'reports', 'payments', 'staff'], approvalStatus: 'approved', accountStatus: 'active',
  tools: { portal: true, merch: { banners: true } }, ...extra,
});
const PRODUCTS = [
  { id: 'prd_1', vendorId: 'usr_vendor', name: 'Trail runner', priceTzs: 90000, stock: 4, status: 'active', approvalStatus: 'approved' },
  { id: 'prd_2', vendorId: 'usr_vendor', name: 'Sold-out bottle', priceTzs: 9000, stock: 0, status: 'active', approvalStatus: 'approved' },
  { id: 'prd_3', vendorId: 'usr_vendor', name: 'Paused mat', priceTzs: 30000, stock: 3, status: 'paused', approvalStatus: 'approved' },
];
const vendorView = (over: Json = {}) => {
  const { ownItem, createdByName, submittedByName, approvedBy, sellerSuspended, vendorName, ...b } = banner(over); // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...b, image: { ...b.image, previewUrl: `/vendor/shop-banners/${b.id}/image` }, allowedActions: over.allowedActions ?? ['edit', 'image', 'withdraw'] };
};
function vendorRoutes(items: Json[], extra: Array<[string, RegExp, Handler]> = [], standing: Json = { canPropose: true, reason: null }): Array<[string, RegExp, Handler]> {
  const find = (id: string) => items.find(b => b.id === id);
  return [
    ...extra,
    ['GET', /^\/vendor\/me$/, () => ({ json: me() })],
    ['GET', /^\/vendor\/products$/, () => ({ json: PRODUCTS })],
    ['GET', /^\/vendor\/shop-banners$/, () => ({ json: { items, total: items.length, nextCursor: null, vendor: standing, proposalExpiryDays: 14, openProposals: { open: items.filter(b => ['draft', 'pending_approval', 'approved'].includes(b.effectiveStatus)).length, max: 10 }, confirmation: CONFIRMATION } })],
    ['GET', /^\/vendor\/shop-banners\/([^/]+)\/image$/, photo],
    ['POST', /^\/vendor\/shop-banners\/([^/]+)\/withdraw$/, (_r, _c, m) => { Object.assign(find(m[1])!, { status: 'withdrawn', effectiveStatus: 'withdrawn', allowedActions: [] }); return { json: { banner: find(m[1]) } }; }],
    ['POST', /^\/vendor\/shop-banners\/([^/]+)\/end$/, (_r, _c, m) => { Object.assign(find(m[1])!, { status: 'ended', effectiveStatus: 'ended', statusReason: 'ended_by_vendor', allowedActions: [] }); return { json: { banner: find(m[1]) } }; }],
    ['GET', /^\/vendor\/orders$/, () => ({ json: { orders: [], nextCursor: null } })],
    ['GET', /^\/vendor\/payments$/, () => ({ json: { todaySalesTzs: 0, pendingSettlementTzs: 0 } })],
    ['GET', /^\/vendor\/statements$/, () => ({ json: { statements: [], payoutReady: true, payoutBlockedBy: null } })],
  ];
}
async function fillVendorForm(page: Page, opts: { swAccent?: string } = {}) {
  await page.getByTestId('banner-file-input').setInputFiles(BIG);
  await page.getByTestId('banner-people-models').check();
  await page.getByTestId('banner-rights').check();
  await page.getByTestId('banner-models-confirm').check();
  await page.getByTestId('banner-consent-ref').fill('MR-2026-041');
  await page.getByTestId('banner-headlineLead-en').fill('Run further in');
  await page.getByTestId('banner-headlineLead-sw').fill('Kimbia mbali zaidi na');
  await page.getByTestId('banner-headlineAccent-en').fill('new shoes');
  await page.getByTestId('banner-headlineAccent-sw').fill(opts.swAccent ?? 'viatu vipya');
  await page.getByTestId('banner-imageAlt-en').fill('A pair of running shoes');
  await page.getByTestId('banner-imageAlt-sw').fill('Jozi ya viatu vya kukimbia');
  await page.getByTestId('banner-product-picker').getByRole('button').first().click();
  await page.getByRole('option', { name: /Trail runner/ }).click();
  await page.getByTestId('banner-startsAt').fill(new Date(Date.now() + 2 * 24 * HOUR + 3 * HOUR).toISOString().slice(0, 16));
  await page.getByTestId('banner-endsAt').fill(new Date(Date.now() + 9 * 24 * HOUR + 3 * HOUR).toISOString().slice(0, 16));
}

test.describe('vendor banners', () => {
  test('SHOP_BANNERS off: no nav item; a deep link says the tool is not available', async ({ page }) => {
    await signIn(page, VENDOR);
    await mockApi(page, vendorRoutes([], [
      ['GET', /^\/vendor\/me$/, () => ({ json: me({ tools: { portal: true } }) })],
      ['GET', /^\/vendor\/shop-banners$/, () => ({ status: 404, json: { error: 'feature_disabled' } })],
    ]));
    await page.goto('/vendor/');
    await expect(nav(page).getByRole('link', { name: 'Products', exact: true })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Banners & sales' })).toHaveCount(0);
    await page.goto('/vendor/promotions/');
    await expect(page.getByText("This tool isn't available yet")).toBeVisible();
    await expect(page.getByTestId('merch-propose')).toHaveCount(0);
  });

  test('propose: both languages, own in-stock products only, button label from the target, send → waiting', async ({ page }) => {
    await signIn(page, VENDOR);
    const items: Json[] = [];
    const draft = vendorView({ id: 'bn_v', status: 'draft', effectiveStatus: 'draft', image: null, allowedActions: ['edit', 'image', 'submit', 'withdraw'], expiresAt: null });
    const calls = await mockApi(page, vendorRoutes(items, [
      ['POST', /^\/vendor\/shop-banners$/, () => ({ status: 201, json: { banner: draft } })],
      ['POST', /^\/vendor\/shop-banners\/bn_v\/image$/, () => ({ json: { banner: { ...draft, image: vendorView().image } } })],
      ['POST', /^\/vendor\/shop-banners\/bn_v\/submit$/, () => { const sent = { ...draft, status: 'pending_approval', effectiveStatus: 'pending_approval', image: vendorView().image, allowedActions: ['edit', 'image', 'withdraw'], expiresAt: at(47) }; items.push(sent); return { json: { banner: sent } }; }],
    ]));
    await page.goto('/vendor/');
    await nav(page).getByRole('link', { name: 'Banners & sales' }).click();
    await expect(page.getByText('No banners yet')).toBeVisible();
    await page.getByTestId('merch-propose').click();
    await expect(page.getByTestId('banner-text-rule')).toContainText('No prices, discounts, deal words (free, discount), numbers of 4 or more digits (years too), links, @handles or phone numbers.');
    await expect(page.getByTestId('banner-cta')).toHaveText('Button: View product');
    await page.getByTestId('banner-target-store').check();
    await expect(page.getByTestId('banner-cta')).toHaveText('Button: Visit store');
    await page.getByTestId('banner-target-product').check();
    await page.getByTestId('banner-product-picker').getByRole('button').first().click();
    await expect(page.getByRole('option', { name: /Trail runner/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Sold-out bottle/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /Paused mat/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await fillVendorForm(page);
    // The confirmation wording is the server's, marked as a draft pending legal review.
    await expect(page.getByTestId('banner-form')).toContainText('SERVER: I have the right to use this image.');
    await expect(page.getByTestId('banner-form')).toContainText('SERVER: The people are models; I hold their release.');
    await expect(page.getByTestId('banner-confirmations-draft')).toHaveText('Draft wording, pending legal review.');
    // Live preview: the business name chip and the typed text.
    await expect(page.getByTestId('banner-form').getByTestId('banner-preview-from')).toHaveText('From Dar Fitness Gear');
    await expect(page.getByTestId('banner-form').getByTestId('banner-preview-accent')).toHaveText('new shoes');
    await page.getByTestId('banner-submit').click();
    await expect(page.getByText('Sent for approval').first()).toBeVisible();
    await expect(page.getByTestId('merch-group-waiting')).toContainText('Run further in new shoes');
    await expect(page.getByTestId('banner-line-bn_v')).toContainText('Expires');
    const body = only(calls, 'POST', '/vendor/shop-banners')[0].body!;
    expect(body).toMatchObject({ target: { type: 'product', value: 'prd_1' }, audienceRoles: ['member', 'trainer', 'owner'], headlineAccent: { en: 'new shoes', sw: 'viatu vipya' } });
    expect(body.ctaKey).toBe('view_product');
    expect(body.ctaLabel).toBeUndefined();
    const upload = only(calls, 'POST', '/vendor/shop-banners/bn_v/image')[0];
    expect(upload.raw).toContain('name="people"\r\n\r\nproduct_models');
    expect(upload.raw).toContain('name="peopleConfirmed"\r\n\r\ntrue');
    expect(upload.raw).toContain('name="confirmationVersion"\r\n\r\n2026-10-20.draft1');
    expect(upload.raw).toContain('name="consentRef"\r\n\r\nMR-2026-041');
    expect(only(calls, 'POST', '/vendor/shop-banners/bn_v/submit')).toHaveLength(1);
    expect(calls.outside).toEqual([]);
  });

  test('inline rules: image type and size, prices, phone numbers, missing Swahili, dates', async ({ page }) => {
    await signIn(page, VENDOR);
    const calls = await mockApi(page, vendorRoutes([]));
    await page.goto('/vendor/promotions/?new=banner');
    await page.getByTestId('banner-file-input').setInputFiles(GIF);
    await expect(page.getByTestId('banner-image-msg')).toHaveText('Use a JPG, PNG or WebP image.');
    await page.getByTestId('banner-file-input').setInputFiles(SMALL);
    await expect(page.getByTestId('banner-image-msg')).toHaveText('The image must be at least 1600 × 1000 pixels.');
    await page.getByTestId('banner-headlineLead-en').fill('Save 20% on');
    await page.getByTestId('banner-headlineAccent-en').fill('TSh 50,000 shoes');
    await page.getByTestId('banner-subline-en').fill('Call 0712 345 678 today');
    await page.getByTestId('banner-startsAt').fill(new Date(Date.now() + 30 * 60_000 + 3 * HOUR).toISOString().slice(0, 16));
    await page.getByTestId('banner-endsAt').fill(new Date(Date.now() + 3 * HOUR).toISOString().slice(0, 16));
    await page.getByTestId('banner-submit').click();
    const msg = "Banners can't show prices, discounts or long numbers. Use a flash sale for a deal.";
    await expect(page.getByTestId('banner-field-headlineLead')).toContainText(msg);
    await expect(page.getByTestId('banner-field-headlineAccent')).toContainText(msg);
    await expect(page.getByTestId('banner-field-subline')).toContainText('Add the Kiswahili text too.');
    await page.getByTestId('banner-subline-sw').fill('Piga 0712 345 678 leo');
    await page.getByTestId('banner-submit').click();
    await expect(page.getByTestId('banner-field-subline')).toContainText('Remove links, @handles and phone numbers.');
    await expect(page.getByTestId('banner-field-headlineLead')).toContainText('This is required.');
    await expect(page.getByTestId('banner-startsAt-msg')).toHaveText('Pick a start at least an hour from now.');
    await expect(page.getByTestId('banner-endsAt-msg')).toHaveText('The end must be after the start.');
    await expect(page.getByTestId('banner-target-error')).toHaveText('Choose a product');
    // Nothing was sent.
    expect(only(calls, 'POST', '/vendor/shop-banners')).toHaveLength(0);
  });

  test('server refusals land on the field: price_claim_in_text (Swahili), missing_translation, target_not_owned', async ({ page }) => {
    await signIn(page, VENDOR);
    let refusal: Json = { status: 422, json: { error: 'price_claim_in_text', field: 'headlineAccent.sw' } };
    await mockApi(page, vendorRoutes([], [['POST', /^\/vendor\/shop-banners$/, () => refusal]]));
    await page.goto('/vendor/promotions/?new=banner');
    await fillVendorForm(page, { swAccent: 'viatu vipya kabisa' });
    await page.getByTestId('banner-submit').click();
    await expect(page.getByTestId('banner-field-headlineAccent')).toContainText("Banners can't show prices, discounts or long numbers.");
    await expect(page.getByTestId('banner-headlineAccent-sw')).toBeFocused();
    refusal = { status: 422, json: { error: 'missing_translation', field: 'imageAlt.sw', missing: ['sw'] } };
    await page.getByTestId('banner-submit').click();
    await expect(page.getByTestId('banner-field-imageAlt')).toContainText('Write this in both English and Kiswahili.');
    refusal = { status: 403, json: { error: 'target_not_owned', field: 'target.value' } };
    await page.getByTestId('banner-submit').click();
    await expect(page.getByTestId('banner-target-error')).toHaveText('Choose one of your own products.');
    refusal = { status: 409, json: { error: 'too_many_open_proposals' } };
    await page.getByTestId('banner-submit').click();
    await expect(page.getByTestId('banner-form').getByRole('alert').first()).toContainText('You have too many banners waiting or scheduled.');
    refusal = { status: 422, json: { error: 'cta_label_not_allowed', field: 'ctaKey' } };
    await page.getByTestId('banner-submit').click();
    await expect(page.getByTestId('banner-form').getByRole('alert').first()).toContainText("That button label isn't allowed for this link.");
    refusal = { status: 429, json: { error: 'rate_limited' } };
    await page.getByTestId('banner-submit').click();
    await expect(page.getByTestId('banner-form').getByRole('alert').first()).toContainText('Too many tries.');
  });

  test('withdraw a waiting banner, end a live one; a rejected one shows its reason', async ({ page }) => {
    await signIn(page, VENDOR);
    const items = [
      vendorView(),
      vendorView({ id: 'bn_live', status: 'approved', effectiveStatus: 'live', startsAt: at(-5), endsAt: at(48), allowedActions: ['edit', 'end'], expiresAt: null }),
      vendorView({ id: 'bn_old', status: 'rejected', effectiveStatus: 'rejected', statusReason: 'people', statusReasonNote: 'Remove the caption.', allowedActions: ['edit', 'image'], expiresAt: null }),
    ];
    const calls = await mockApi(page, vendorRoutes(items));
    await page.goto('/vendor/promotions/');
    await expect(page.getByTestId('banner-status-bn_live')).toHaveText('Live');
    await expect(page.getByTestId('banner-line-bn_old')).toHaveText('Reason: People framed as members or partners: Remove the caption.');
    // Review #1: "Change photo" on rejected and live banners once the server allows it.
    await expect(page.getByTestId('banner-photo-bn_old')).toBeVisible();
    await expect(page.getByTestId('banner-photo-bn_live')).toHaveCount(0);
    await page.getByTestId('banner-withdraw-bn_1').click();
    await page.getByTestId('banner-withdraw-confirm').click();
    await expect(page.getByTestId('banner-status-bn_1')).toHaveText('Withdrawn');
    await expect(page.getByTestId('banner-line-bn_1')).toHaveText('You withdrew this');
    expect(only(calls, 'POST', '/vendor/shop-banners/bn_1/withdraw')).toHaveLength(1);
    await page.getByTestId('banner-end-bn_live').click();
    await page.getByTestId('banner-end-confirm').click();
    await expect(page.getByTestId('banner-status-bn_live')).toHaveText('Ended');
    expect(only(calls, 'POST', '/vendor/shop-banners/bn_live/end')).toHaveLength(1);
  });

  test('revision 2 rules: consent reference, stricter text rules, open-proposal limit, wording changed', async ({ page }) => {
    await signIn(page, VENDOR);
    const draft = vendorView({ id: 'bn_v', status: 'draft', effectiveStatus: 'draft', image: null, allowedActions: ['edit', 'image', 'submit', 'withdraw'], expiresAt: null });
    let uploads = 0;
    const calls = await mockApi(page, vendorRoutes([], [
      ['POST', /^\/vendor\/shop-banners$/, () => ({ status: 201, json: { banner: draft } })],
      ['PATCH', /^\/vendor\/shop-banners\/bn_v$/, () => ({ json: { banner: draft } })],
      ['POST', /^\/vendor\/shop-banners\/bn_v\/image$/, () => { uploads += 1; return { status: 400, json: { error: 'confirmation_version_mismatch', field: 'confirmationVersion', current: '2026-10-21.draft2' } }; }],
    ]));
    await page.goto('/vendor/promotions/');
    await expect(page.getByTestId('merch-open-proposals')).toHaveText('0 of 10 open proposals');
    await page.getByTestId('merch-propose').click();
    await page.getByTestId('banner-file-input').setInputFiles(BIG);
    await page.getByTestId('banner-people-models').check();
    await page.getByTestId('banner-rights').check();
    await page.getByTestId('banner-models-confirm').check();
    await page.getByTestId('banner-headlineLead-en').fill('Since 2019 we sell');
    await page.getByTestId('banner-headlineAccent-en').fill('@darfit gear');
    await page.getByTestId('banner-subline-en').fill('Free delivery, half price');
    await page.getByTestId('banner-subline-sw').fill('Bure kabisa');
    await page.getByTestId('banner-submit').click();
    await expect(page.getByTestId('banner-field-headlineLead')).toContainText("Banners can't show prices, discounts or long numbers.");
    await expect(page.getByTestId('banner-field-headlineAccent')).toContainText('Remove links, @handles and phone numbers.');
    await expect(page.getByTestId('banner-field-subline')).toContainText("Banners can't show prices, discounts or long numbers.");
    await expect(page.getByTestId('banner-form')).toContainText('Give the model release reference.');
    await expect(page.getByTestId('banner-text-rule')).toContainText('numbers of 4 or more digits (years too)');
    await page.getByTestId('banner-consent-ref').fill('MR-1');
    await page.getByTestId('banner-headlineLead-en').fill('Run further in');
    await page.getByTestId('banner-headlineLead-sw').fill('Kimbia mbali zaidi na');
    await page.getByTestId('banner-headlineAccent-en').fill('new shoes');
    await page.getByTestId('banner-headlineAccent-sw').fill('viatu vipya');
    await page.getByTestId('banner-subline-en').fill('');
    await page.getByTestId('banner-subline-sw').fill('');
    await page.getByTestId('banner-imageAlt-en').fill('A pair of running shoes');
    await page.getByTestId('banner-imageAlt-sw').fill('Jozi ya viatu vya kukimbia');
    await page.getByTestId('banner-product-picker').getByRole('button').first().click();
    await page.getByRole('option', { name: /Trail runner/ }).click();
    await page.getByTestId('banner-startsAt').fill(new Date(Date.now() + 2 * 24 * HOUR + 3 * HOUR).toISOString().slice(0, 16));
    await page.getByTestId('banner-endsAt').fill(new Date(Date.now() + 9 * 24 * HOUR + 3 * HOUR).toISOString().slice(0, 16));
    await page.getByTestId('banner-submit').click();
    // The wording changed on the server: the boxes are unticked, the list is reloaded and the person is asked again.
    await expect(page.getByTestId('banner-rights-error')).toHaveText('The confirmation wording changed. Read it again and tick the boxes.');
    await expect(page.getByTestId('banner-rights')).not.toBeChecked();
    expect(uploads).toBe(1);
    expect(only(calls, 'GET', '/vendor/shop-banners').length).toBeGreaterThan(1);
  });

  test('at the open-proposal limit, Propose is disabled with the reason', async ({ page }) => {
    await signIn(page, VENDOR);
    await mockApi(page, vendorRoutes([vendorView()], [['GET', /^\/vendor\/shop-banners$/, () => ({ json: { items: [vendorView()], total: 1, nextCursor: null, vendor: { canPropose: true, reason: null }, openProposals: { open: 10, max: 10 }, confirmation: CONFIRMATION } })]]));
    await page.goto('/vendor/promotions/');
    await expect(page.getByTestId('merch-open-proposals')).toHaveText('You have the most open proposals allowed. Withdraw one or wait for a decision.');
    await expect(page.getByTestId('merch-propose')).toBeDisabled();
  });

  test('QA2: a pending business with no banners sees only the notice', async ({ page }) => {
    await signIn(page, VENDOR);
    await mockApi(page, vendorRoutes([], [['GET', /^\/vendor\/me$/, () => ({ json: me({ approvalStatus: 'pending_approval' }) })]], { canPropose: false, reason: 'vendor_not_approved' }));
    await page.goto('/vendor/promotions/');
    await expect(page.getByTestId('merch-pending-vendor')).toBeVisible();
    await expect(page.getByTestId('merch-open-proposals')).toHaveCount(0);
    await expect(page.getByText('No banners yet')).toHaveCount(0);
    await expect(page.getByTestId('merch-propose-empty')).toHaveCount(0);
  });

  test('a business not yet approved: spec copy + Verification centre, the list without Edit/Send, no Propose', async ({ page }) => {
    await signIn(page, VENDOR);
    const items = [vendorView({ id: 'bn_d', status: 'draft', effectiveStatus: 'draft', allowedActions: ['edit', 'image', 'submit', 'withdraw'], expiresAt: null })];
    await mockApi(page, vendorRoutes(items, [['GET', /^\/vendor\/me$/, () => ({ json: me({ approvalStatus: 'pending_approval' }) })]], { canPropose: false, reason: 'vendor_not_approved' }));
    await page.goto('/vendor/promotions/');
    await expect(page.getByTestId('merch-pending-vendor')).toContainText('Available once your business is approved');
    await expect(page.getByTestId('merch-pending-vendor')).toContainText('You can propose banners and flash sales after FitFlex approves your business.');
    await expect(page.getByTestId('merch-pending-verification')).toHaveText('Open the Verification centre in the FitFlex app to finish your business details.');
    await expect(page.getByTestId('merch-propose')).toHaveCount(0);
    await expect(page.getByTestId('banner-card-bn_d')).toBeVisible();
    await expect(page.getByTestId('banner-edit-bn_d')).toHaveCount(0);
    await expect(page.getByTestId('banner-submit-bn_d')).toHaveCount(0);
    await expect(page.getByTestId('banner-withdraw-bn_d')).toBeVisible();
  });

  test('suspended staff: the suspended alert and no Propose', async ({ page }) => {
    await signIn(page, { id: 'usr_staff', userType: 'vendor_staff', vendorId: 'usr_vendor', displayName: 'Juma' });
    await mockApi(page, vendorRoutes([vendorView()], [['GET', /^\/vendor\/me$/, () => ({ json: me({ userType: 'vendor_staff', permissions: ['products'] }) })]], { canPropose: false, reason: 'vendor_suspended' }));
    await page.goto('/vendor/promotions/');
    await expect(page.getByText('Your account is suspended.')).toBeVisible();
    await expect(page.getByTestId('merch-propose')).toHaveCount(0);
    await expect(page.getByTestId('banner-edit-bn_1')).toHaveCount(0);
  });

  test('ended card uses endedAt; rejected without a note shows the category alone; /vendor/merch without ?item opens the list', async ({ page }) => {
    await signIn(page, VENDOR);
    const endedAt = '2026-10-21T09:00:00.000Z';
    await mockApi(page, vendorRoutes([
      vendorView({ id: 'bn_end', status: 'ended', effectiveStatus: 'ended', statusReason: 'ended_by_vendor', endedAt, endsAt: '2026-10-30T09:00:00.000Z', allowedActions: [], expiresAt: null }),
      vendorView({ id: 'bn_fx', status: 'ended', effectiveStatus: 'ended', statusReason: 'ended_by_fitflex', statusReasonNote: 'The maker recalled it.', endedByFitflex: true, endedAt, allowedActions: [], expiresAt: null }),
      vendorView({ id: 'bn_draft', status: 'draft', effectiveStatus: 'draft', allowedActions: ['edit', 'submit'], expiresAt: null }),
      vendorView({ id: 'bn_rej', status: 'rejected', effectiveStatus: 'rejected', statusReason: 'claim', statusReasonNote: null, allowedActions: ['edit', 'image'], expiresAt: null }),
    ]));
    await page.goto('/vendor/merch/');
    await expect(page).toHaveURL(/\/vendor\/promotions\/$/);
    await expect(page.getByTestId('banner-line-bn_end')).toHaveText('Ended 21 Oct, 12:00');
    await expect(page.getByTestId('banner-line-bn_rej')).toHaveText('Reason: Misleading claim');
    // Ended by FitFlex: the date and who, with the reason (QA2 #7).
    await expect(page.getByTestId('banner-line-bn_fx')).toHaveText('Ended 21 Oct, 12:00 · by FitFlex: The maker recalled it.');
    // Swahili: a draft banner reads "Halijatumwa" (QA2 #8).
    await page.locator('[data-testid="locale-select"]:visible').selectOption('sw');
    await expect(page.getByTestId('banner-status-bn_draft')).toHaveText('Halijatumwa');
    await expect(page.getByTestId('banner-line-bn_fx')).toContainText('limesitishwa na FitFlex: The maker recalled it.');
  });

  test('Swahili: nav, list and form read in Swahili; /vendor/merch?item= opens /vendor/promotions', async ({ page }) => {
    await signIn(page, VENDOR, 'sw');
    await mockApi(page, vendorRoutes([vendorView()]));
    await page.goto('/vendor/merch/?item=bn_1');
    await expect(page).toHaveURL(/\/vendor\/promotions\/\?item=bn_1/);
    await expect(nav(page).getByRole('link', { name: 'Mabango na ofa' })).toBeVisible();
    await expect(page.getByTestId('banner-status-bn_1')).toHaveText('Inasubiri idhini');
    await expect(page.getByTestId('merch-group-waiting')).toContainText('Yanasubiri idhini');
    await expect(page.getByTestId('banner-line-bn_1')).toContainText('Litaisha muda');
    await expect(page.getByTestId('banner-card-bn_1')).toContainText('Kimbia mbali zaidi na viatu vipya');
    await page.getByTestId('merch-propose').click();
    await expect(page.getByText('Pendekeza bango').first()).toBeVisible();
    await expect(page.getByTestId('banner-cta')).toHaveText('Kitufe: Tazama bidhaa');
    await expect(page.getByTestId('banner-form').getByTestId('banner-preview-from')).toHaveText('Kutoka Dar Fitness Gear');
  });
});
