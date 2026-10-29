import { expect, test, type Page } from '@playwright/test';

// FitFlex admins can address a message to vendors (owner decision 2026-10-22):
// the Vendors recipients option, vendor presets and conditions, a sample that
// names the shop, the vendor language warnings, the overview tile and the
// vendor_unavailable skip reason. Gym owners are never offered Vendors.
//
// Network guard: every request outside localhost is aborted and recorded, and
// the API is answered here — no spec ever reaches the live API.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const VENDOR_PRESETS = ['all', 'approved', 'pending', 'walk_in', 'no_live_products', 'new'];
const VENDOR_FIELDS = [
  { key: 'joinedDaysAgo', type: 'number', ops: ['eq', 'gte', 'lte', 'between', 'exists'] },
  { key: 'vendorApproval', type: 'enum', ops: ['eq', 'neq', 'in', 'not_in', 'exists'], values: ['approved', 'pending_approval', 'rejected'] },
  { key: 'vendorWalkInSales', type: 'enum', ops: ['eq', 'neq', 'in', 'not_in', 'exists'], values: ['yes', 'no'] },
  { key: 'vendorProducts', type: 'number', ops: ['eq', 'gte', 'lte', 'between', 'exists'] },
  { key: 'vendorLiveProducts', type: 'number', ops: ['eq', 'gte', 'lte', 'between', 'exists'] },
  { key: 'vendorCategory', type: 'text', ops: ['eq', 'neq', 'in', 'not_in', 'exists'] },
  { key: 'vendorRecipient', type: 'enum', ops: ['eq', 'neq', 'in', 'not_in', 'exists'], values: ['account', 'admin_staff'] },
];
const channels = { in_app: { eligible: 4, excluded: {} }, push: { eligible: 2, excluded: { no_device: 2 } }, whatsapp: { eligible: 0, excluded: {} }, sms: { eligible: 0, excluded: {} } };
const results = {
  attribution: { model: 'last_touch', clickWindowDays: 7, openWindowDays: 3 },
  members: { recipients: 0, sent: 0, delivered: null, failed: 0, opened: 0, clicked: 0, ctaCompleted: null, renewed: 0, paid: 0 },
  revenue: { currency: 'TZS', attributedTzs: 0, payments: 0 }, channels: {}, reasons: { failed: {}, skipped: {} }, conversions: [], sources: [],
};

type Seen = { previews: Array<Record<string, any>>; drafts: Array<Record<string, any>>; created: Array<Record<string, any>>; segments: string[]; outside: string[] };

// fitflex-functions#274 lets vendors get every purpose (their own opt-out is
// honoured per channel by the backend). The older #257 backend refused
// marketing to vendors; `oldBackend` mocks that so its error still reads well.
const MARKETING = ['promotion', 'engagement', 'general'];
const refused = { status: 400, json: { error: 'vendor_marketing_not_available' } };
const marketingToVendors = (b: Record<string, any>) =>
  (b.recipients ?? b.audience?.recipients) === 'vendors' && MARKETING.includes(b.purpose);

// The group #257 ANDs onto every vendor audience that doesn't name vendorApproval.
const VENDOR_BASE = { all: [{ field: 'vendorApproval', op: 'in', value: ['approved', 'pending_approval'] }] };
const draft = (id: string, filter: unknown) => ({
  id, senderType: 'platform', gymId: null, name: `Draft ${id}`, purpose: 'announcement', category: 'transactional', status: 'draft',
  audience: { recipients: 'vendors', preset: 'all', filter }, channels: ['in_app'],
  content: { title: 'Holiday hours', body: 'Orders close on 24 December.', deepLink: 'message', locale: 'en' },
  scheduledAt: null, sentAt: null, createdAt: '2026-10-22T07:00:00Z', counts: null,
});
const DRAFTS = [
  draft('cmp_base', VENDOR_BASE),
  draft('cmp_mixed', { all: [VENDOR_BASE, { all: [{ field: 'vendorWalkInSales', op: 'eq', value: 'yes' }] }] }),
];

async function mockAdmin(page: Page, seen: Seen, opts: { refuseSend?: boolean; drafts?: boolean; oldBackend?: boolean } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => { seen.outside.push(route.request().url()); return route.abort(); });
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p === '/admin/communications/overview') {
      return route.fulfill({ json: {
        senderType: 'platform', members: 120, trainers: 3, vendors: 7, campaigns: {}, recent: opts.drafts ? DRAFTS : [],
        channels: { in_app: true, push: true, whatsapp: false, sms: false }, limits: { largeSendThreshold: 500, marketingWeeklyCap: 2 },
      } });
    }
    if (p === '/admin/communications/campaigns' && req.method() === 'GET') return route.fulfill({ json: { campaigns: [], nextCursor: null } });
    if (p === '/admin/communications/analytics') return route.fulfill({ json: { ...results, period: { from: '2026-09-22', to: '2026-10-22', days: 30 } } });
    if (p === '/admin/communications/segments') {
      seen.segments.push(url.search);
      const r = url.searchParams.get('recipients');
      if (r === 'vendors') {
        return route.fulfill({ json: { scope: 'vendors', presets: VENDOR_PRESETS.map(key => ({ key, filter: {} })), fields: VENDOR_FIELDS, limits: { maxDepth: 3, maxConditions: 20 } } });
      }
      return route.fulfill({ json: { scope: r === 'trainers' ? 'trainers' : 'platform', presets: ['all', 'active'].map(key => ({ key, filter: {} })), fields: [] } });
    }
    if (p === '/admin/communications/audience/preview') {
      const body = req.postDataJSON() as Record<string, any>;
      seen.previews.push(body);
      if (opts.oldBackend && marketingToVendors(body)) return route.fulfill(refused);
      const vendors = body.recipients === 'vendors';
      return route.fulfill({ json: {
        count: vendors ? 4 : 120, category: vendors && body.purpose == null ? 'transactional' : 'marketing', channels,
        sample: vendors
          ? [
            { id: 'usr_v1', displayName: 'Juma Ally', status: 'active', businessName: 'Juma Sports', vendorId: 'usr_v1', vendorRecipient: 'account' },
            { id: 'usr_s1', displayName: 'Neema Joseph', status: 'active', businessName: 'Juma Sports', vendorId: 'usr_v1', vendorRecipient: 'admin_staff' },
          ]
          : [{ id: 'u1', displayName: 'Amina Said', status: 'active' }],
      } });
    }
    if (p === '/admin/communications/campaigns/preview') {
      const body = req.postDataJSON() as Record<string, any>;
      seen.drafts.push(body);
      if (opts.oldBackend && marketingToVendors(body)) return route.fulfill(refused);
      return route.fulfill({ json: {
        category: 'marketing', largeSendThreshold: 500,
        counts: { targeted: 4, queued: 4, skipped: {}, byChannel: { in_app: { queued: 4 } } },
        example: { memberName: 'Juma Ally', title: body.content?.title ?? '', body: body.content?.body ?? '', ctaLabel: null, deepLink: 'message' },
        warnings: [{ code: 'no_swahili_text', count: 3, of: 4 }],
      } });
    }
    if (p === '/admin/communications/campaigns' && req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, any>;
      seen.created.push(body);
      if (opts.oldBackend && marketingToVendors(body)) return route.fulfill(refused);
      return route.fulfill({ status: 201, json: { campaign: { id: 'cmp_v', status: 'draft', ...body } } });
    }
    if (p === '/admin/communications/campaigns/cmp_v/send' && opts.refuseSend) return route.fulfill(refused);
    if (p === '/admin/communications/campaigns/cmp_v/send') return route.fulfill({ json: { campaign: { id: 'cmp_v', status: 'sending' } } });
    if (p === '/admin/communications/campaigns/cmp_v') {
      const draft = seen.created.at(-1) ?? {};
      return route.fulfill({ json: {
        campaign: {
          id: 'cmp_v', senderType: 'platform', gymId: null, name: 'Stock up for December', purpose: 'announcement', category: 'transactional',
          status: 'sent', audience: draft.audience, content: draft.content, channels: ['in_app'], scheduledAt: null,
          sentAt: '2026-10-22T08:00:00Z', createdAt: '2026-10-22T07:59:00Z',
          counts: { targeted: 4, queued: 2, skipped: { vendor_unavailable: 1, not_vendor_admin: 1 }, byChannel: {} },
        },
        progress: {}, stats: null,
      } });
    }
    const d = DRAFTS.find(x => p === `/admin/communications/campaigns/${x.id}`);
    if (d) return route.fulfill({ json: { campaign: d, progress: {}, stats: null } });
    if (p === '/admin/communications/campaigns/cmp_v/analytics') return route.fulfill({ json: results });
    if (p === '/admin/communications/campaigns/cmp_v/recipients') return route.fulfill({ json: { recipients: [], nextCursor: null } });
    if (p === '/admin/communications/templates') return route.fulfill({ json: { templates: [] } });
    return route.fulfill({ json: {} });
  });
}

test('FitFlex sends a message to vendors: presets, conditions, sample, warnings and skip reason', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', e => runtimeErrors.push(e));
  const seen: Seen = { previews: [], drafts: [], created: [], segments: [], outside: [] };
  await mockAdmin(page, seen);

  await page.goto('/admin/communications');
  await expect(page.getByTestId('overview-vendors')).toContainText('People at vendors you can message');
  await expect(page.getByTestId('overview-vendors')).toContainText('7');

  await page.getByTestId('comms-new').click();
  await page.getByTestId('purpose-announcement').click();
  await page.getByTestId('comms-next').click();

  // Members, Trainers and Vendors; each choice is at least 44px tall.
  for (const r of ['members', 'trainers', 'vendors']) {
    const box = await page.getByTestId(`recipients-${r}`).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByTestId('audience-count')).toContainText('120 members match');

  await page.getByTestId('recipients-vendors').click();
  await expect(page.getByTestId('recipients-vendors')).toHaveAttribute('aria-pressed', 'true');
  for (const key of VENDOR_PRESETS) await expect(page.getByTestId(`preset-${key}`)).toBeVisible();
  await expect(page.getByTestId('preset-all')).toHaveText('All vendors');
  await expect(page.getByTestId('preset-no_live_products')).toHaveText('Nothing on sale');
  await expect(page.getByTestId('audience-count')).toContainText('4 people at vendors match');
  await expect(page.getByTestId('audience-count')).toContainText('Juma Ally (Juma Sports)');
  await expect(page.getByTestId('audience-count')).toContainText('Neema Joseph (Juma Sports, admin staff)');
  await expect(page.getByTestId('vendor-people-note')).toBeVisible();
  // Member conditions are not offered for vendors.
  await expect(page.getByTestId('refine-expires')).toHaveCount(0);
  await expect.poll(() => seen.previews.at(-1)).toMatchObject({ recipients: 'vendors', preset: 'all', purpose: 'announcement' });

  await page.getByTestId('preset-approved').click();
  await page.getByTestId('refine-vendor-walkin').selectOption('yes');
  await page.getByTestId('refine-vendor-products').selectOption('none_live');
  await page.getByTestId('refine-vendor-recipient').selectOption('admin_staff');
  await page.getByTestId('refine-vendor-joined').selectOption('30');
  await page.getByTestId('refine-vendor-category').fill(' Supplements ');
  await expect.poll(() => seen.previews.at(-1)).toEqual({
    recipients: 'vendors', preset: 'approved', purpose: 'announcement',
    filter: { all: [
      { field: 'vendorWalkInSales', op: 'eq', value: 'yes' },
      { field: 'vendorLiveProducts', op: 'eq', value: 0 },
      { field: 'vendorCategory', op: 'eq', value: 'Supplements' },
      { field: 'vendorRecipient', op: 'eq', value: 'admin_staff' },
      { field: 'joinedDaysAgo', op: 'lte', value: 30 },
    ] },
  });
  // Only approved / pending approval: rejected vendors are never in a vendor audience.
  await expect(page.getByTestId('refine-vendor-approval').locator('option')).toHaveText(['—', 'Approved', 'Pending approval']);
  await page.getByTestId('refine-vendor-approval').selectOption('approved');
  await expect.poll(() => (seen.previews.at(-1)?.filter?.all ?? [])[0]).toEqual({ field: 'vendorApproval', op: 'eq', value: 'approved' });

  await page.getByTestId('comms-next').click();
  // The message: English only, so the preview says the Swahili readers get English.
  await page.getByTestId('msg-title-en').fill('Stock up for December');
  await page.getByTestId('msg-body-en').fill('List your gift packs before the holidays.');
  await page.getByTestId('comms-next').click(); // → channels
  await page.getByTestId('comms-next').click(); // → schedule
  await page.getByTestId('comms-next').click(); // → preview
  await expect(page.getByTestId('warning-no_swahili_text')).toContainText('3 of 4 vendor recipients read Swahili');
  expect(seen.drafts.at(-1)?.audience).toMatchObject({ recipients: 'vendors', preset: 'approved' });

  await page.getByTestId('comms-next').click(); // → confirm
  await expect(page.getByText('Approved · 4 people at vendors match this audience.')).toBeVisible();
  await expect(page.getByTestId('warning-no_swahili_text')).toBeVisible();
  await page.getByTestId('comms-submit').click();

  expect(seen.created.at(-1)?.audience).toMatchObject({ recipients: 'vendors', preset: 'approved' });
  // The sent campaign: vendor preset wording and the vendor skip reason.
  await expect(page.getByText('Vendor suspended, closed or rejected: 1')).toBeVisible();
  await expect(page.getByText("No longer one of the vendor's admin staff: 1")).toBeVisible();
  await expect(page.getByText('4 people at vendors match this audience.')).toBeVisible();

  expect(seen.segments).toContain('?recipients=vendors');
  expect(seen.outside).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test('Swahili: the vendor option and wording are translated', async ({ page }) => {
  const seen: Seen = { previews: [], drafts: [], created: [], segments: [], outside: [] };
  await page.addInitScript(() => localStorage.setItem('locale', 'sw'));
  await mockAdmin(page, seen);

  await page.goto('/admin/communications');
  await expect(page.getByTestId('overview-vendors')).toContainText('Watu wa wauzaji unaoweza kuwatumia ujumbe');
  await page.getByTestId('comms-new').click();
  await page.getByTestId('purpose-promotion').click();
  await page.getByTestId('comms-next').click();
  await expect(page.getByTestId('recipients-vendors')).toHaveText('Wauzaji');
  await page.getByTestId('recipients-vendors').click();
  await expect(page.getByTestId('vendor-optout-note')).toHaveText('Promosheni huwafikia wauzaji tu ambao hawajazizima kwenye mipangilio yao ya ujumbe.');
  await page.getByTestId('comms-back').click();
  await expect(page.getByTestId('vendor-marketing-note')).toContainText('Promosheni huwafikia wauzaji tu ambao hawajazizima kwenye mipangilio yao ya ujumbe.');
  await page.getByTestId('purpose-announcement').click();
  await page.getByTestId('comms-next').click();
  await expect(page.getByTestId('vendor-optout-note')).toHaveCount(0);
  await expect(page.getByTestId('preset-all')).toHaveText('Wauzaji wote');
  await expect(page.getByTestId('audience-count')).toContainText('Watu 4 wa wauzaji wanalingana');
  await expect(page.getByTestId('audience-count')).toContainText('Neema Joseph (Juma Sports, mfanyakazi wa admin)');
  expect(seen.outside).toEqual([]);
});

test('gym owners are never offered Vendors', async ({ page }) => {
  const outside: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'owner-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'owner-1', userType: 'gym_operator', email: 'owner@example.com', gymIds: ['gym_a'] }));
  });
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => { outside.push(route.request().url()); return route.abort(); });
  const segmentQueries: string[] = [];
  const previews: Array<Record<string, unknown>> = [];
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p === '/owner/gyms') return route.fulfill({ json: [{ id: 'gym_a', name: 'Alpha Gym' }] });
    if (p === '/owner/communications/overview') {
      return route.fulfill({ json: {
        senderType: 'gym', gymIds: ['gym_a'], members: 40, campaigns: {}, recent: [],
        channels: { in_app: true, push: true, whatsapp: false, sms: false }, limits: { largeSendThreshold: 500, marketingWeeklyCap: 2 },
      } });
    }
    if (p === '/owner/communications/campaigns') return route.fulfill({ json: { campaigns: [], nextCursor: null } });
    if (p === '/owner/communications/analytics') return route.fulfill({ json: { ...results, period: { from: '2026-09-22', to: '2026-10-22', days: 30 } } });
    if (p === '/owner/communications/segments') {
      segmentQueries.push(url.search);
      return route.fulfill({ json: { scope: 'gym', presets: [{ key: 'active', filter: {} }], fields: [] } });
    }
    if (p === '/owner/communications/audience/preview') {
      previews.push(req.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { count: 40, category: 'marketing', channels, sample: [] } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/owner/communications');
  await expect(page.getByTestId('comms-home')).toBeVisible();
  await expect(page.getByTestId('overview-vendors')).toHaveCount(0);
  await page.getByTestId('comms-new').click();
  await page.getByTestId('purpose-promotion').click();
  await page.getByTestId('comms-next').click();
  await expect(page.getByTestId('audience-count')).toContainText('40 members match');
  await expect(page.getByTestId('recipients-vendors')).toHaveCount(0);
  await expect(page.getByTestId('recipients-members')).toHaveCount(0);
  expect(segmentQueries.every(q => !q.includes('recipients'))).toBe(true);
  expect(previews.every(b => !('recipients' in b))).toBe(true);
  expect(outside).toEqual([]);
});

test('promotions, engagement and general messages can go to vendors, with the opt-out note', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', e => runtimeErrors.push(e));
  const seen: Seen = { previews: [], drafts: [], created: [], segments: [], outside: [] };
  await mockAdmin(page, seen);
  const NOTE = "Promotions reach only vendors who haven't switched them off in their message settings.";

  await page.goto('/admin/communications');
  await page.getByTestId('comms-new').click();
  await page.getByTestId('purpose-promotion').click();
  await page.getByTestId('comms-next').click();
  await expect(page.getByTestId('audience-count')).toContainText('120 members match');
  await expect(page.getByTestId('vendor-optout-note')).toHaveCount(0);

  // Promotion, then Vendors: a real count, the opt-out note, and the way on is open.
  await page.getByTestId('recipients-vendors').click();
  await expect(page.getByTestId('audience-count')).toContainText('4 people at vendors match');
  await expect(page.getByTestId('vendor-optout-note')).toHaveText(NOTE);
  await expect(page.getByTestId('vendor-marketing-blocked')).toHaveCount(0);
  await expect(page.getByTestId('vendor-change-purpose')).toHaveCount(0);
  await expect.poll(() => seen.previews.at(-1)).toMatchObject({ recipients: 'vendors', purpose: 'promotion' });
  await expect(page.getByTestId('comms-next')).toBeEnabled();

  // Back on the purpose step: every purpose is open for vendors, with the note.
  await page.getByTestId('comms-back').click();
  await expect(page.getByTestId('vendor-marketing-note')).toHaveText(NOTE);
  for (const p of [...MARKETING, 'renewal', 'payment', 'announcement']) await expect(page.getByTestId(`purpose-${p}`)).toBeEnabled();

  for (const p of ['engagement', 'general']) {
    await page.getByTestId(`purpose-${p}`).click();
    await page.getByTestId('comms-next').click();
    await expect.poll(() => seen.previews.at(-1)).toMatchObject({ recipients: 'vendors', purpose: p });
    await expect(page.getByTestId('vendor-optout-note')).toHaveText(NOTE);
    await expect(page.getByTestId('comms-next')).toBeEnabled();
    await page.getByTestId('comms-back').click();
  }

  // A service purpose: no opt-out note on the audience step.
  await page.getByTestId('purpose-renewal').click();
  await page.getByTestId('comms-next').click();
  await expect.poll(() => seen.previews.at(-1)).toMatchObject({ recipients: 'vendors', purpose: 'renewal' });
  await expect(page.getByTestId('vendor-optout-note')).toHaveCount(0);

  // Members again: no vendor note anywhere.
  await page.getByTestId('recipients-members').click();
  await expect(page.getByTestId('audience-count')).toContainText('120 members match');
  await page.getByTestId('comms-back').click();
  await expect(page.getByTestId('vendor-marketing-note')).toHaveCount(0);

  expect(seen.outside).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test('a promotion to vendors is created and sent', async ({ page }) => {
  const seen: Seen = { previews: [], drafts: [], created: [], segments: [], outside: [] };
  await mockAdmin(page, seen);

  await page.goto('/admin/communications');
  await page.getByTestId('comms-new').click();
  await page.getByTestId('purpose-promotion').click();
  await page.getByTestId('comms-next').click();
  await page.getByTestId('recipients-vendors').click();
  await expect(page.getByTestId('audience-count')).toContainText('4 people at vendors match');
  await page.getByTestId('comms-next').click();
  await page.getByTestId('msg-title-en').fill('List your December stock');
  await page.getByTestId('msg-body-en').fill('Shoppers are looking for gym gear this month.');
  for (let i = 0; i < 4; i++) await page.getByTestId('comms-next').click(); // channels → schedule → preview → confirm
  await page.getByTestId('comms-submit').click();
  await expect.poll(() => seen.created.at(-1)).toMatchObject({ purpose: 'promotion', audience: { recipients: 'vendors' } });
  expect(seen.drafts.some(b => b.purpose === 'promotion' && b.audience?.recipients === 'vendors')).toBe(true);
  await expect(page.getByText('vendor_marketing_not_available')).toHaveCount(0);
  await expect(page.getByText("Promotions to vendors aren't available yet")).toHaveCount(0);
  expect(seen.outside).toEqual([]);
});

test('an older backend that still refuses marketing to vendors shows the plain EN and SW note', async ({ page }) => {
  for (const [locale, text] of [
    ['en', "Promotions to vendors aren't available yet — vendors can't opt out in the app yet."],
    ['sw', 'Promosheni kwa wauzaji bado hazipatikani — wauzaji bado hawawezi kujiondoa kwenye app.'],
  ] as const) {
    const seen: Seen = { previews: [], drafts: [], created: [], segments: [], outside: [] };
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.addInitScript(l => localStorage.setItem('locale', l), locale);
    await mockAdmin(page, seen, { oldBackend: true });
    await page.goto('/admin/communications');
    await page.getByTestId('comms-new').click();
    await page.getByTestId('purpose-promotion').click();
    await page.getByTestId('comms-next').click();
    await page.getByTestId('recipients-vendors').click();
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByText('vendor_marketing_not_available')).toHaveCount(0);
    expect(seen.outside).toEqual([]);
  }
});

test('vendor_marketing_not_available from the server reads as the plain note', async ({ page }) => {
  const seen: Seen = { previews: [], drafts: [], created: [], segments: [], outside: [] };
  await mockAdmin(page, seen, { refuseSend: true });

  await page.goto('/admin/communications');
  await page.getByTestId('comms-new').click();
  await page.getByTestId('purpose-announcement').click();
  await page.getByTestId('comms-next').click();
  await page.getByTestId('recipients-vendors').click();
  await expect(page.getByTestId('audience-count')).toContainText('4 people at vendors match');
  await page.getByTestId('comms-next').click();
  await page.getByTestId('msg-title-en').fill('Holiday hours');
  await page.getByTestId('msg-body-en').fill('Orders close on 24 December.');
  for (let i = 0; i < 4; i++) await page.getByTestId('comms-next').click(); // channels → schedule → preview → confirm
  await page.getByTestId('comms-submit').click();
  await expect(page.getByText("Promotions to vendors aren't available yet — vendors can't opt out in the app yet.")).toBeVisible();
  await expect(page.getByText('vendor_marketing_not_available')).toHaveCount(0);
  expect(seen.outside).toEqual([]);
});

test("the vendor base group a filter may carry isn't shown as the admin's own conditions", async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', e => runtimeErrors.push(e));
  const seen: Seen = { previews: [], drafts: [], created: [], segments: [], outside: [] };
  await mockAdmin(page, seen, { drafts: true });

  await page.goto('/admin/communications');
  // Only the base group: no "extra conditions", and the vendor conditions are editable.
  await page.getByTestId('campaign-cmp_base').click();
  await expect(page.getByText('All vendors', { exact: true })).toBeVisible();
  await expect(page.getByText('With extra conditions')).toHaveCount(0);
  await page.getByTestId('detail-edit').click();
  await page.getByTestId('comms-next').click();
  await expect(page.getByTestId('recipients-vendors')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText("This audience has conditions that can't be edited here.")).toHaveCount(0);
  await expect(page.getByTestId('vendor-conditions')).toBeVisible();
  await expect.poll(() => seen.previews.at(-1)).toEqual({ recipients: 'vendors', preset: 'all', purpose: 'announcement' });

  // The base group plus a real condition: only the real one is kept.
  await page.goto('/admin/communications');
  await page.getByTestId('campaign-cmp_mixed').click();
  await expect(page.getByText('With extra conditions', { exact: false })).toBeVisible();
  await page.getByTestId('detail-edit').click();
  await page.getByTestId('comms-next').click();
  await expect(page.getByText("This audience has conditions that can't be edited here.")).toBeVisible();
  await expect.poll(() => seen.previews.at(-1)).toEqual({
    recipients: 'vendors', preset: 'all', purpose: 'announcement',
    filter: { all: [{ field: 'vendorWalkInSales', op: 'eq', value: 'yes' }] },
  });
  expect(seen.outside).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});
