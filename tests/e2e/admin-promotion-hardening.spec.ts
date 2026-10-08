import { expect, test, Page } from '@playwright/test';
import { fresh, setup, SUPER, Opts } from './helpers/promotion-mock';

// Phone widths, odd data, failures, double clicks, history and the keyboard, on the moderation and promotion screens.
const PHONE = { width: 390, height: 844 };
const MAIN_FITS = async (page: Page) => {
  await page.locator('main').waitFor();
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => { const m = document.querySelector('main')!; return { doc: document.documentElement.scrollWidth, iw: window.innerWidth, mainSw: m.scrollWidth, mainCw: m.clientWidth }; });
  expect(r.doc).toBeLessThanOrEqual(r.iw);
  expect(r.mainSw).toBeLessThanOrEqual(r.mainCw);
};
const start = async (page: Page, opts: Partial<Opts> = {}, locale = 'en') => {
  const state = fresh(opts);
  await setup(page, state, SUPER, locale);
  return state;
};
const writes = (s: ReturnType<typeof fresh>, re: RegExp) => s.calls.filter(c => re.test(c.path)).length;

test.describe('phone width with very long names and no spaces', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize(PHONE); });
  const screens: Array<[string, string]> = [
    ['moderation list', '/admin/moderation'], ['moderation detail', '/admin/moderation?type=gym&item=gym-1'],
    ['promotions list', '/admin/promotions'], ['promotion detail', '/admin/promotions?item=p2'], ['promotion edit wizard', '/admin/promotions?edit=p2'],
    ['campaigns list', '/admin/promotion-campaigns'], ['campaign detail', '/admin/promotion-campaigns?item=camp-1'],
    ['limits', '/admin/promotion-limits'], ['overview', '/admin/promotion-overview'], ['analytics', '/admin/promotion-analytics'], ['analytics detail', '/admin/promotion-analytics?item=p1'],
  ];
  for (const [name, url] of screens) {
    test(`${name} has no sideways scroll`, async ({ page }) => {
      await start(page, { longNames: true });
      await page.goto(url);
      await page.waitForTimeout(600);
      await MAIN_FITS(page);
    });
  }
  test('every wizard step, the dialogs and the Swahili wording fit too', async ({ page }) => {
    await start(page, { longNames: true }, 'sw');
    await page.goto('/admin/promotions?new=1');
    await MAIN_FITS(page);
    await page.getByTestId('entity-gym-1').click(); await page.getByTestId('wizard-next').click(); await MAIN_FITS(page);
    await page.getByTestId('type-sponsored').click(); await page.getByTestId('wizard-next').click(); await MAIN_FITS(page);
    await page.getByTestId('placement-gym_discovery').check(); await page.getByTestId('wizard-next').click(); await MAIN_FITS(page);
    await page.getByTestId('wizard-next').click(); await MAIN_FITS(page);
    await page.getByTestId('wizard-start').fill('2030-01-01T10:00'); await page.getByTestId('wizard-end').fill('2030-01-31T10:00'); await page.getByTestId('wizard-next').click(); await MAIN_FITS(page);
    await page.getByTestId('wizard-next').click(); await MAIN_FITS(page);
    await page.getByTestId('wizard-partner-search').fill('safari'); await page.getByTestId('partner-org-1').click(); await MAIN_FITS(page);
    await page.getByTestId('wizard-next').click(); await expect(page.getByTestId('wizard-preview')).toBeVisible(); await MAIN_FITS(page);
    await page.goto('/admin/promotions?item=p2');
    await page.getByTestId('promotion-action-edit_live').click(); await MAIN_FITS(page);
    await page.keyboard.press('Escape');
    await page.getByTestId('promotion-action-reject').click(); await MAIN_FITS(page);
  });
  test('the wizard stepper stays on one line, each step has a name and a thumb-sized target', async ({ page }) => {
    await start(page);
    await page.goto('/admin/promotions?new=1');
    await expect(page.getByTestId('stepper')).toBeVisible();
    const boxes = await page.getByTestId('stepper').getByRole('button').evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), h: b.height, w: b.width, name: e.getAttribute('aria-label') }; }));
    expect(boxes).toHaveLength(8);
    expect(new Set(boxes.map(b => b.top)).size).toBe(1);
    for (const b of boxes) { expect(b.h).toBeGreaterThanOrEqual(40); expect(b.w).toBeGreaterThanOrEqual(36); expect(b.name).toBeTruthy(); }
    await expect(page.getByTestId('stepper-current')).toContainText('1 / 8');
  });
  test('a dialog on a short phone scrolls and its buttons can be reached', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await start(page);
    await page.goto('/admin/promotion-campaigns');
    await page.getByTestId('campaign-new').click();
    const save = page.getByTestId('campaign-save');
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    const dlg = await page.getByRole('dialog').boundingBox();
    expect(dlg!.y).toBeGreaterThanOrEqual(0); expect(dlg!.y + dlg!.height).toBeLessThanOrEqual(480);
  });
  test('tap targets on the list and detail screens are at least 40px high', async ({ page }) => {
    await start(page);
    for (const url of ['/admin/promotions', '/admin/promotions?item=p2', '/admin/moderation', '/admin/promotion-analytics']) {
      await page.goto(url); await page.waitForTimeout(400);
      const small = await page.evaluate(() => [...document.querySelectorAll('main button, main a, main select, main input[type=date], main input[type=search]')]
        .filter(e => !e.closest('td')).map(e => ({ h: e.getBoundingClientRect().height, t: (e.textContent || '').trim().slice(0, 20) })).filter(x => x.h > 0 && x.h < 40));
      expect(small, url).toEqual([]);
    }
  });
});

test.describe('missing or odd data never crashes a screen', () => {
  test('a promotion whose listing was deleted still opens everywhere', async ({ page }) => {
    await start(page, { nullEntity: true });
    await page.goto('/admin/promotions');
    await expect(page.getByTestId('promotion-row-p1')).toContainText('gym-1');
    await page.getByTestId('promotion-row-p1').click();
    await expect(page.getByTestId('promotion-name')).toHaveText('gym-1');
    await page.getByTestId('promotion-action-edit').click();
    await expect(page.getByTestId('wizard-entity-locked')).toContainText('gym-1');
    await page.goto('/admin/promotion-campaigns?item=camp-1');
    await expect(page.getByTestId('campaign-promotions')).toContainText('gym-1');
    await page.goto('/admin/promotion-analytics');
    await expect(page.getByTestId('pan-row-p1')).toContainText('e-p1');
    await page.getByTestId('pan-row-p1').click();
    await expect(page.getByTestId('pan-name')).toHaveText('gym-1');
  });
  test('optional fields missing from responses: detail, moderation, overview, campaign and analytics', async ({ page }) => {
    await start(page, { sparse: true });
    await page.goto('/admin/promotions?item=p1');
    await expect(page.getByTestId('promotion-name')).toBeVisible();
    await expect(page.getByTestId('promotion-ineligible')).toBeVisible();
    await page.goto('/admin/promotions?edit=p1');
    await expect(page.getByTestId('wizard-entity-locked')).toBeVisible();
    await page.goto('/admin/moderation');
    await expect(page.getByTestId('moderation-row-gym-1')).toBeVisible();
    await expect(page.getByTestId('moderation-tab-pending')).not.toContainText('undefined');
    await page.getByTestId('moderation-row-gym-1').click();
    await expect(page.getByTestId('moderation-name')).toBeVisible();
    await page.goto('/admin/promotion-overview');
    await expect(page.getByTestId('overview-tiles')).toBeVisible();
    await expect(page.getByTestId('overview-expiring-empty')).toBeVisible();
    await page.goto('/admin/promotion-campaigns?item=camp-1');
    await expect(page.getByTestId('campaign-name')).toBeVisible();
    await page.goto('/admin/promotion-analytics');
    await expect(page.getByTestId('pan-table')).toBeVisible();
    await page.goto('/admin/promotion-analytics?item=p1');
    await expect(page.getByTestId('pan-name')).toBeVisible();
    await expect(page.getByTestId('pan-placements-empty')).toBeVisible();
  });
  test('numbers in the millions are written in full, zeros are zeros', async ({ page }) => {
    await start(page, { big: true });
    await page.setViewportSize(PHONE);
    await page.goto('/admin/promotion-analytics');
    await expect(page.getByTestId('pan-value-impressions')).toHaveText('12,345,678');
    await expect(page.getByTestId('pan-cell-impressions').first()).toHaveText('12,345,678');
    await expect(page.getByTestId('pan-cell-impressions').nth(1)).toHaveText('0');
    await expect(page.getByTestId('pan-sub-purchases')).toContainText('9,876,543,210');
    await MAIN_FITS(page);
    await page.goto('/admin/promotion-analytics?item=p1');
    await expect(page.getByTestId('pan-funnel-count-impressions')).toHaveText('12,345,678');
    await expect(page.getByTestId('pan-value-uniqueViewers')).toHaveText('5,000,000');
    await MAIN_FITS(page);
  });
});

test.describe('a failed call shows an error and a way to try again', () => {
  const cases: Array<[string, string, RegExp, string, string]> = [
    ['moderation list', '/admin/moderation', /^\/admin\/moderation$/, 'moderation-retry', 'moderation-row-gym-1'],
    ['moderation detail', '/admin/moderation?type=gym&item=gym-1', /^\/admin\/moderation\/gym\/gym-1$/, 'moderation-retry', 'moderation-name'],
    ['promotions list', '/admin/promotions', /^\/admin\/promotions$/, 'promotion-retry', 'promotion-table'],
    ['promotion detail', '/admin/promotions?item=p1', /^\/admin\/promotions\/p1$/, 'promotion-retry', 'promotion-name'],
    ['wizard', '/admin/promotions?new=1', /^\/admin\/promotion-reference$/, 'wizard-retry', 'wizard-step-content'],
    ['campaigns list', '/admin/promotion-campaigns', /^\/admin\/promotion-campaigns$/, 'campaign-retry', 'campaign-table'],
    ['campaign detail', '/admin/promotion-campaigns?item=camp-1', /^\/admin\/promotion-campaigns\/camp-1$/, 'campaign-retry', 'campaign-name'],
    ['limits', '/admin/promotion-limits', /^\/admin\/promotion-limits$/, 'limits-retry', 'limits-gym_discovery'],
    ['overview', '/admin/promotion-overview', /^\/admin\/promotion-overview$/, 'overview-retry', 'overview-tiles'],
    ['analytics', '/admin/promotion-analytics', /^\/admin\/promotion-analytics$/, 'pan-retry', 'pan-table'],
    ['analytics detail', '/admin/promotion-analytics?item=p1', /^\/admin\/promotions\/p1\/analytics$/, 'pan-detail-retry', 'pan-name'],
  ];
  for (const [name, url, re, retry, ok] of cases) {
    test(name, async ({ page }) => {
      const state = await start(page, { failing: re });
      await page.goto(url);
      await expect(page.getByRole('alert').first()).toBeVisible();
      await expect(page.getByTestId(retry)).toBeVisible();
      await expect(page.getByTestId(ok)).toHaveCount(0);
      await expect(page.locator('main')).not.toBeEmpty();
      state.opts.failing = null;
      await page.getByTestId(retry).click();
      await expect(page.getByTestId(ok).first()).toBeVisible();
    });
  }
  test('a failed write keeps the dialog open and says why inside it', async ({ page }) => {
    await start(page, { failing: /\/cancel$/ });
    await page.goto('/admin/promotion-campaigns?item=camp-1');
    await page.getByTestId('campaign-cancel').click();
    await page.getByTestId('campaign-reason').fill('no longer needed');
    await page.getByTestId('campaign-cancel-confirm').click();
    await expect(page.getByTestId('campaign-cancel-dialog').getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('campaign-cancel-confirm')).toBeEnabled();
  });
});

test.describe('a double click sends once', () => {
  test('rejecting a promotion', async ({ page }) => {
    const s = await start(page, { slow: 400 });
    await page.goto('/admin/promotions?item=p2');
    await page.getByTestId('promotion-action-reject').click();
    await page.getByTestId('promotion-reason').fill('not suitable');
    await page.getByTestId('promotion-confirm').dblclick();
    await expect(page.getByTestId('promotion-action-dialog')).toHaveCount(0);
    expect(writes(s, /\/reject$/)).toBe(1);
  });
  test('a moderation decision', async ({ page }) => {
    const s = await start(page, { slow: 400 });
    await page.goto('/admin/moderation?type=gym&item=gym-1');
    await page.getByTestId('moderation-action-approve').click();
    await page.getByTestId('moderation-confirm').dblclick();
    await expect(page.getByTestId('moderation-decision')).toHaveCount(0);
    expect(writes(s, /\/approve$/)).toBe(1);
  });
  test('saving a campaign, a limit and a live edit', async ({ page }) => {
    const s = await start(page, { slow: 400 });
    await page.goto('/admin/promotion-campaigns');
    await page.getByTestId('campaign-new').click();
    await page.getByTestId('campaign-name-input').fill('Ramadan push');
    await page.getByTestId('campaign-start-input').fill('2030-03-01T08:00'); await page.getByTestId('campaign-end-input').fill('2030-03-30T08:00');
    await page.getByTestId('campaign-save').dblclick();
    await expect(page.getByTestId('campaign-detail')).toBeVisible();
    expect(s.calls.filter(c => c.method === 'POST' && c.path === '/admin/promotion-campaigns')).toHaveLength(1);

    await page.goto('/admin/promotion-limits');
    await page.getByTestId('limit-edit-gym_discovery-featured').click();
    await page.getByTestId('limit-slots').fill('7');
    await page.getByTestId('limit-save').dblclick();
    await expect(page.getByTestId('limit-dialog')).toHaveCount(0);
    expect(writes(s, /promotion-limits\//)).toBe(1);

    await page.goto('/admin/promotions?item=p1');
    await page.getByTestId('promotion-action-edit_live').click();
    await page.getByTestId('live-save').dblclick();
    await expect(page.getByTestId('promotion-live-edit')).toHaveCount(0);
    expect(s.calls.filter(c => c.method === 'PATCH')).toHaveLength(1);
  });
  test('starting a campaign and the wizard submit', async ({ page }) => {
    const s = await start(page, { slow: 400 });
    await page.goto('/admin/promotion-campaigns?item=camp-1');
    await page.getByTestId('campaign-start').dblclick();
    await expect(page.getByTestId('campaign-status')).toHaveText('Active');
    expect(writes(s, /\/start$/)).toBe(1);

    await page.goto('/admin/promotions?new=1');
    await page.getByTestId('entity-gym-1').click(); await page.getByTestId('wizard-next').click();
    await page.getByTestId('type-featured').click(); await page.getByTestId('wizard-next').click();
    await page.getByTestId('placement-gym_discovery').check(); await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-start').fill('2030-01-01T10:00'); await page.getByTestId('wizard-end').fill('2030-01-31T10:00'); await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-next').click(); await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-preview')).toBeVisible();
    await page.getByTestId('wizard-submit').dblclick();
    await expect(page.getByTestId('promotion-detail')).toBeVisible();
    expect(s.calls.filter(c => c.method === 'POST' && c.path === '/admin/promotions')).toHaveLength(1);
    expect(writes(s, /\/submit$/)).toBe(1);
  });
});

test.describe('keyboard and screen readers', () => {
  test('Esc closes a dialog, focus goes in and comes back, Tab stays inside', async ({ page }) => {
    await start(page);
    await page.goto('/admin/promotions?item=p2');
    const opener = page.getByTestId('promotion-action-reject');
    await opener.focus(); await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Reject' });
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('promotion-reason')).toBeFocused();
    for (let i = 0; i < 6; i += 1) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true); }
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
    await expect(dlg.getByRole('button', { name: 'Close' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
  test('form fields have names, and a table row opens from the keyboard', async ({ page }) => {
    await start(page);
    await page.goto('/admin/promotion-limits');
    await page.getByTestId('limit-edit-gym_discovery-featured').click();
    await expect(page.getByLabel('Slots', { exact: false }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/admin/promotions');
    await page.getByTestId('promotion-row-p1').focus(); await page.keyboard.press('Enter');
    await expect(page.getByTestId('promotion-detail')).toBeVisible();
    await page.goto('/admin/promotion-campaigns?item=camp-1');
    await page.getByTestId('campaign-edit').click();
    await expect(page.getByLabel('Name')).toBeVisible();
  });
  test('stepping forward moves focus to the new step; a status is a word, not just a colour; the chart has a table', async ({ page }) => {
    await start(page);
    await page.goto('/admin/promotions?new=1');
    await page.getByTestId('entity-gym-1').click(); await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-step-content')).toBeFocused();
    await page.goto('/admin/promotions');
    await expect(page.getByTestId('promotion-row-p1')).toContainText('Active');
    await page.goto('/admin/promotion-analytics?item=p1');
    await expect(page.getByRole('img', { name: /by day/ })).toBeVisible();
    await expect(page.getByTestId('pan-daily-table')).toHaveCount(1);
  });
});

test.describe('history and dates', () => {
  test('back and forward walk through list, detail and edit', async ({ page }) => {
    await start(page);
    await page.goto('/admin/promotions');
    await page.getByTestId('promotion-row-p1').click();
    await expect(page).toHaveURL(/item=p1/);
    await page.getByTestId('promotion-action-edit_live').click(); await page.keyboard.press('Escape');
    await page.getByTestId('promotion-action-edit').click();
    await expect(page).toHaveURL(/edit=p1/); await expect(page.getByTestId('promotion-wizard')).toBeVisible();
    await page.goBack(); await expect(page.getByTestId('promotion-detail')).toBeVisible();
    await page.goBack(); await expect(page.getByTestId('promotion-table')).toBeVisible();
    await page.goForward(); await expect(page.getByTestId('promotion-detail')).toBeVisible();
    await page.goForward(); await expect(page.getByTestId('promotion-wizard')).toBeVisible();
    await page.goto('/admin/promotions?new=1'); await page.goBack();
    await page.goto('/admin/promotions'); await page.getByTestId('promotion-new').click();
    await expect(page.getByTestId('promotion-wizard')).toBeVisible();
    await page.goBack(); await expect(page.getByTestId('promotion-table')).toBeVisible();
  });
  test('moderation: back and forward keep the open listing', async ({ page }) => {
    await start(page);
    await page.goto('/admin/moderation');
    await page.getByTestId('moderation-row-gym-1').click();
    await expect(page.getByTestId('moderation-entity')).toBeVisible();
    await page.goBack(); await expect(page.getByTestId('moderation-table')).toBeVisible();
    await page.goForward(); await expect(page.getByTestId('moderation-name')).toBeVisible();
  });
});

test.describe('a clock that skips an hour', () => {
  test.use({ timezoneId: 'America/New_York' });
  test('a time inside the spring-forward gap still gives a valid, ordered period', async ({ page }) => {
    const s = await start(page);
    await page.goto('/admin/promotions?new=1');
    await page.getByTestId('entity-gym-1').click(); await page.getByTestId('wizard-next').click();
    await page.getByTestId('type-featured').click(); await page.getByTestId('wizard-next').click();
    await page.getByTestId('placement-gym_discovery').check(); await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-start').fill('2030-03-10T02:30');        // 10 Mar 2030, 02:30 does not exist in New York
    await page.getByTestId('wizard-end').fill('2030-11-03T01:30');          // 3 Nov 2030, 01:30 happens twice
    await expect(page.getByTestId('wizard-next')).toBeEnabled();
    await page.getByTestId('wizard-next').click(); await page.getByTestId('wizard-next').click(); await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-preview')).toBeVisible();
    await page.getByTestId('wizard-save-draft').click();
    await expect(page.getByTestId('promotion-detail')).toBeVisible();
    const body = s.calls.find(c => c.path === '/admin/promotions')!.body!;
    expect(Number.isNaN(Date.parse(body.startsAt))).toBe(false);
    expect(Date.parse(body.endsAt)).toBeGreaterThan(Date.parse(body.startsAt));
  });
});
