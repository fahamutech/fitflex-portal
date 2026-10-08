import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const eatToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const ZERO = { impressions: 0, searchAppearances: 0, clicks: 0, detailViews: 0, saves: 0, bookingClicks: 0, subscriptionClicks: 0, bookings: 0, subscriptions: 0, purchases: 0, purchaseValueTzs: 0, uniqueViewers: 0, clickThroughRate: null, viewRate: null, conversions: 0, conversionRate: null };
const ref = (id: string, name: string, over: Json = {}) => ({ id, type: 'featured', status: 'active', entityType: 'gym', entityId: `e-${id}`, entityName: name, startsAt: '2026-10-01T00:00:00Z', endsAt: '2036-10-01T00:00:00Z', campaignId: null, isCommercial: false, ...over });
const P1 = { ...ZERO, impressions: 1200, searchAppearances: 300, clicks: 96, detailViews: 60, saves: 12, bookingClicks: 20, subscriptionClicks: 5, purchases: 3, purchaseValueTzs: 150000, uniqueViewers: 800, clickThroughRate: 0.08, viewRate: 0.625, conversions: 0, conversionRate: null };
const P2 = { ...ZERO };      // live but no events: zeros, rates unknown
const TOTALS = { ...P1 };

type State = { calls: Array<{ path: string; search: string }>; campaignForbidden: boolean };
const fresh = (): State => ({ calls: [], campaignForbidden: false });

async function setup(page: Page, user: Json, state: State, locale = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'admin-e2e-token'); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('locale', l as string);
  }, [user, locale]);
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.includes('analytics')) state.calls.push({ path, search: url.search });
    const sp = url.searchParams;

    if (path === '/admin/promotion-analytics') {
      let items = [{ promotion: ref('p1', 'Zanzibar Iron'), ...P1 }, { promotion: ref('p2', 'Masaki Fitness', { entityId: 'g2', type: 'promoted' }), ...P2 }];
      if (sp.get('type')) items = items.filter(i => i.promotion.type === sp.get('type'));
      return route.fulfill({ json: { range: { from: sp.get('from'), to: sp.get('to') }, totals: items.length === 2 ? TOTALS : items[0]?.promotion.id === 'p1' ? P1 : ZERO, items, notTracked: ['booking_conversions', 'subscription_conversions'] } });
    }
    if (path === '/admin/promotions/p1/analytics') {
      const from = sp.get('from')!; const to = sp.get('to')!;
      const daily: Json[] = [];
      for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) daily.push({ day: d, ...ZERO, impressions: i % 5 === 0 ? 0 : 40, clicks: i % 5 === 0 ? 0 : 3 });
      return route.fulfill({ json: {
        promotion: ref('p1', 'Zanzibar Iron'), range: { from, to }, totals: P1, daily,
        byPlacement: [{ placement: 'gym_discovery', ...P1, impressions: 900, clicks: 72, clickThroughRate: 0.08 }, { placement: 'home', ...ZERO, impressions: 300, clicks: 0, clickThroughRate: 0 }],
        funnel: [{ step: 'impressions', count: 1200 }, { step: 'clicks', count: 96 }, { step: 'detailViews', count: 60 }, { step: 'actionClicks', count: 25 }, { step: 'conversions', count: 0 }],
        notTracked: ['booking_conversions', 'subscription_conversions'],
      } });
    }
    if (path === '/admin/promotions/p2/analytics') {
      const from = sp.get('from')!; const to = sp.get('to')!;
      return route.fulfill({ json: { promotion: ref('p2', 'Masaki Fitness'), range: { from, to }, totals: ZERO, daily: [{ day: from, ...ZERO }], byPlacement: [],
        funnel: ['impressions', 'clicks', 'detailViews', 'actionClicks', 'conversions'].map(step => ({ step, count: 0 })), notTracked: ['booking_conversions'] } });
    }
    if (path === '/admin/promotion-campaigns/camp-1/analytics') {
      if (state.campaignForbidden) return route.fulfill({ status: 403, json: { error: 'acl_forbidden' } });
      return route.fulfill({ json: { campaign: { id: 'camp-1', name: 'Zanzibar Fitness Week', status: 'active', startsAt: '2026-10-01T00:00:00Z', endsAt: '2036-10-08T00:00:00Z' }, range: { from: sp.get('from'), to: sp.get('to') }, totals: { ...P1, impressions: 777 }, items: [], notTracked: ['booking_conversions', 'subscription_conversions'] } });
    }
    if (path === '/admin/promotion-campaigns/camp-1') {
      return route.fulfill({ json: { campaign: { id: 'camp-1', name: 'Zanzibar Fitness Week', description: null, status: 'active', statusReason: null, startsAt: '2026-10-01T00:00:00Z', endsAt: '2036-10-08T00:00:00Z', geoScope: { areaIds: [] }, createdBy: 'a', createdAt: '', updatedAt: '' }, promotions: [] } });
    }
    if (path === '/admin/promotions/p1') {
      return route.fulfill({ json: { promotion: { id: 'p1', entityType: 'gym', entityId: 'gym-1', type: 'featured', status: 'active', effectiveStatus: 'active', statusReason: null, campaignId: null, partnerRef: null, startsAt: '2026-10-01T08:00:00Z', endsAt: '2036-10-31T08:00:00Z', priority: 5, boostWeight: 1, geoScope: { areaIds: [] }, audience: {}, categories: [], isCommercial: false, relationshipType: 'editorial', commercialRef: null, notes: null, createdBy: 'm', submittedBy: 'm', approvedBy: 'c', placements: ['gym_discovery'], label: 'Featured', entity: { id: 'gym-1', name: 'Zanzibar Iron', subtitle: null, status: 'active' } }, eligibility: { ok: true, reasons: [] }, capacity: [], history: [], allowedActions: [] } });
    }
    if (path === '/admin/geo-areas') return route.fulfill({ json: { areas: [] } });
    return route.fulfill({ json: [] });
  });
}
const SUPER = { id: 'admin-1', userType: 'admin' };
const staff = (id: string, ...scopes: string[]) => ({ id, userType: 'admin', portalUser: true, aclPermissions: scopes });
const lastCall = (s: State, path: string) => [...s.calls].reverse().find(c => c.path === path) ?? { path, search: '' };

test('summary numbers, dashes for rates with nothing to divide by, and zero-event promotions', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotion-analytics');
  await expect(page.getByTestId('pan-value-impressions')).toHaveText('1,200');
  await expect(page.getByTestId('pan-value-clicks')).toHaveText('96');
  await expect(page.getByTestId('pan-value-ctr')).toHaveText('8.0%');
  await expect(page.getByTestId('pan-value-views')).toHaveText('60');
  await expect(page.getByTestId('pan-value-bookingClicks')).toHaveText('20');
  await expect(page.getByTestId('pan-value-subscriptionClicks')).toHaveText('5');
  await expect(page.getByTestId('pan-value-purchases')).toHaveText('3');
  await expect(page.getByTestId('pan-sub-purchases')).toHaveText('TZS 150,000');
  await expect(page.getByTestId('pan-value-uniqueViewers')).toHaveText('800');
  // A promotion with no events at all is still listed, with zeros and a dash (not 0%).
  const row = page.getByTestId('pan-row-p2');
  await expect(row).toContainText('Masaki Fitness');
  await expect(row.getByTestId('pan-cell-impressions')).toHaveText('0');
  await expect(row.getByTestId('pan-cell-ctr')).toHaveText('—');
  await expect(page.getByTestId('pan-row-p1').getByTestId('pan-cell-ctr')).toHaveText('8.0%');
  // Default range: the last 30 days in EAT.
  const q = new URLSearchParams(lastCall(state, '/admin/promotion-analytics').search);
  expect(q.get('to')).toBe(eatToday());
  expect(q.get('from')).toBe(addDays(eatToday(), -29));
});

test('a rate with nothing to divide by shows a dash in the tiles too', async ({ page }) => {
  await setup(page, SUPER, fresh());
  await page.goto('/admin/promotion-analytics?type=promoted');
  await expect(page.getByTestId('pan-row-p2')).toBeVisible();
  await expect(page.getByTestId('pan-value-ctr')).toHaveText('—');
  await expect(page.getByTestId('pan-sub-views')).toContainText('—');
});

test('the not-tracked notice is driven by the server and says what is missing', async ({ page }) => {
  await setup(page, SUPER, fresh());
  await page.goto('/admin/promotion-analytics');
  const note = page.getByTestId('pan-not-tracked');
  await expect(note).toContainText('not tracked yet');
  await expect(note).toContainText('bookings, subscriptions');
  await expect(note).toContainText('not counted or estimated');
});

test('filters and date presets are sent to the server and kept in the URL', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotion-analytics');
  await page.getByTestId('pan-preset-7').click();
  await expect(page).toHaveURL(new RegExp(`from=${addDays(eatToday(), -6)}`));
  await expect.poll(() => new URLSearchParams(lastCall(state, '/admin/promotion-analytics').search).get('from')).toBe(addDays(eatToday(), -6));
  await page.getByTestId('pan-preset-90').click();
  await expect.poll(() => new URLSearchParams(lastCall(state, '/admin/promotion-analytics').search).get('from')).toBe(addDays(eatToday(), -89));

  await page.getByTestId('pan-filter-type').selectOption('promoted');
  await page.getByTestId('pan-filter-placement').selectOption('home');
  await page.getByTestId('pan-filter-listing').selectOption('gym');
  await expect.poll(() => {
    const q = new URLSearchParams(lastCall(state, '/admin/promotion-analytics').search);
    return [q.get('type'), q.get('placement'), q.get('entityType')].join(',');
  }).toBe('promoted,home,gym');
  await expect(page).toHaveURL(/type=promoted/);
  await expect(page.getByTestId('pan-row-p1')).toHaveCount(0);

  await page.getByTestId('pan-from').fill('2026-09-01');
  await page.getByTestId('pan-to').fill('2026-09-30');
  await expect.poll(() => { const q = new URLSearchParams(lastCall(state, '/admin/promotion-analytics').search); return `${q.get('from')}..${q.get('to')}`; }).toBe('2026-09-01..2026-09-30');

  await page.getByTestId('pan-clear').click();
  await expect.poll(() => new URLSearchParams(lastCall(state, '/admin/promotion-analytics').search).get('type')).toBe(null);
  await expect(page.getByTestId('pan-row-p1')).toBeVisible();
});

test('a filter in the URL is applied on load (campaign link from the campaign page)', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotion-analytics?campaignId=camp-1&from=2026-09-01&to=2026-09-15');
  await expect(page.getByTestId('pan-campaign-chip')).toBeVisible();
  await expect.poll(() => { const q = new URLSearchParams(lastCall(state, '/admin/promotion-analytics').search); return [q.get('campaignId'), q.get('from'), q.get('to')].join(','); }).toBe('camp-1,2026-09-01,2026-09-15');
});

test('detail: header, tiles, daily chart, funnel with step percentages and the placement table', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotion-analytics?from=2026-09-01&to=2026-09-30');
  await page.getByTestId('pan-row-p1').click();
  await expect(page).toHaveURL(/item=p1/);
  await expect(page.getByTestId('pan-name')).toHaveText('Zanzibar Iron');
  await expect(page.getByTestId('pan-status')).toHaveText('Active');
  await expect(page.getByTestId('pan-period')).toContainText(/1 Sep\w* 2026 to 30 Sep\w* 2026/);
  await expect(page.getByTestId('pan-value-impressions')).toHaveText('1,200');
  expect(new URLSearchParams(lastCall(state, '/admin/promotions/p1/analytics').search).get('from')).toBe('2026-09-01');

  // Daily series: one chart, every day of the range in the accessible table (zeros included).
  await expect(page.getByTestId('pan-chart').locator('svg.recharts-surface')).toBeVisible();
  await expect(page.getByTestId('pan-daily-table').locator('tbody tr')).toHaveCount(30);

  // Funnel, null-safe step percentages.
  await expect(page.getByTestId('pan-funnel-count-impressions')).toHaveText('1,200');
  await expect(page.getByTestId('pan-funnel-pct-clicks')).toContainText('8.0%');
  await expect(page.getByTestId('pan-funnel-pct-detailViews')).toContainText('62.5%');
  await expect(page.getByTestId('pan-funnel-pct-conversions')).toContainText('0.0%');

  await expect(page.getByTestId('pan-placement-gym_discovery')).toContainText('900');
  await expect(page.getByTestId('pan-placement-home')).toContainText('300');
  await expect(page.getByTestId('pan-not-tracked')).toBeVisible();

  await page.getByTestId('pan-back').click();
  await expect(page.getByTestId('pan-table')).toBeVisible();
  await expect(page).not.toHaveURL(/item=/);
});

test('detail of a promotion with no events shows dashes in the funnel and no chart', async ({ page }) => {
  await setup(page, SUPER, fresh());
  await page.goto('/admin/promotion-analytics?item=p2');
  await expect(page.getByTestId('pan-name')).toHaveText('Masaki Fitness');
  await expect(page.getByTestId('pan-daily-empty')).toBeVisible();
  await expect(page.getByTestId('pan-funnel-pct-clicks')).toContainText('—');
  await expect(page.getByTestId('pan-placements-empty')).toBeVisible();
});

test('staff with only the analytics scope can see the dashboard and the sidebar link', async ({ page }) => {
  await setup(page, staff('s1', 'promotion_analytics'), fresh());
  await page.goto('/admin/promotion-analytics');
  await expect(page.getByTestId('pan-value-impressions')).toHaveText('1,200');
  await expect(page.getByRole('link', { name: 'Promotion performance' })).toBeVisible();
});

test('staff without the analytics scope get no sidebar link, and no Performance link on a promotion', async ({ page }) => {
  await setup(page, staff('s2', 'promotions'), fresh());
  await page.goto('/admin/promotions?item=p1');
  await expect(page.getByTestId('promotion-name')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Promotions' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Promotion performance' })).toHaveCount(0);
  await expect(page.getByTestId('promotion-performance-link')).toHaveCount(0);
});

test('with the scope, a promotion links to its performance', async ({ page }) => {
  await setup(page, staff('s3', 'promotions', 'promotion_analytics'), fresh());
  await page.goto('/admin/promotions?item=p1');
  await page.getByTestId('promotion-performance-link').click();
  await expect(page).toHaveURL(/promotion-analytics\/?\?item=p1/);
  await expect(page.getByTestId('pan-name')).toHaveText('Zanzibar Iron');
});

test('a campaign shows its totals when the admin may see analytics, and hides them quietly on a 403', async ({ page }) => {
  const state = fresh();
  await setup(page, SUPER, state);
  await page.goto('/admin/promotion-campaigns?item=camp-1');
  await expect(page.getByTestId('campaign-performance')).toContainText('777');
  await expect(page.getByTestId('campaign-performance')).toContainText('not tracked yet');
  await expect(page.getByTestId('campaign-performance-link')).toHaveAttribute('href', /campaignId=camp-1/);

  const denied = { ...fresh(), campaignForbidden: true };
  const page2 = await page.context().newPage();
  await setup(page2, SUPER, denied);
  await page2.goto('/admin/promotion-campaigns?item=camp-1');
  await expect(page2.getByTestId('campaign-name')).toBeVisible();
  await expect(page2.getByTestId('campaign-performance')).toHaveCount(0);
  await expect(page2.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);

  const noScope = fresh();
  const page3 = await page.context().newPage();
  await setup(page3, staff('s4', 'campaigns'), noScope);
  await page3.goto('/admin/promotion-campaigns?item=camp-1');
  await expect(page3.getByTestId('campaign-name')).toBeVisible();
  expect(noScope.calls.some(c => c.path.includes('/analytics'))).toBe(false);
});

test('the dashboard speaks Swahili', async ({ page }) => {
  await setup(page, SUPER, fresh(), 'sw');
  await page.goto('/admin/promotion-analytics');
  await expect(page.getByRole('heading', { name: 'Utendaji wa promosheni' })).toBeVisible();
  await expect(page.getByTestId('pan-tile-impressions')).toContainText('Mionekano');
  await expect(page.getByTestId('pan-preset-7')).toHaveText('Siku 7 zilizopita');
  await expect(page.getByTestId('pan-not-tracked')).toContainText('bado havifuatiliwi');
  await page.getByTestId('pan-row-p1').click();
  await expect(page.getByTestId('pan-funnel-pct-clicks')).toContainText('ya hatua iliyotangulia');
});
