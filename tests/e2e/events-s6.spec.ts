import { expect, test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import {
  EVENTS_STAFF, OWNER, STAFF_ADMIN, STAFF_FINANCE, STAFF_OPS, SUPER_ADMIN, expectNoRawKeys, organizerMe, setupEvents,
} from './helpers/events-mock';
import { ART_CONFIRMATION_VERSION, type S6Opts } from './helpers/events-s6-mock';
import { eventsS6Messages } from '../../src/lib/i18n-events-s6';
import { ALL_REASONS, RESULTS_ERRORS } from '../../src/lib/events-results';

// Events S6 (spec docs/design/events-s6-runs-results-medals-rewards.md §6 to §9, §12, §14): the organizer Results tab (overview, import,
// results table and drawer, release, corrections, disputes, settings), medals and artwork, the integrations scope picker and result
// webhooks, and the admin reward desk, the medal-art queue and result exceptions. The mock is written from the SPEC (the backend is built in
// parallel) and is strict about it, so a portal that guesses a shape fails here. Run: npx playwright test --config playwright.events.config.ts
test.use({ serviceWorkers: 'block' });

const STAFF_TIMING = { id: 'usr_stim', userType: 'organizer_staff', displayName: 'Tumaini Timing' };
type Role = 'owner' | 'admin' | 'ops' | 'timing' | 'finance';
const who = (role: Role) => (role === 'owner' ? OWNER : role === 'admin' ? STAFF_ADMIN : role === 'ops' ? STAFF_OPS : role === 'finance' ? STAFF_FINANCE : STAFF_TIMING);
const EV = '/organizer/events/?event=evt_pub';
const open = async (page: Page, role: Role, section: string | null, s6: S6Opts = {}, locale: 'en' | 'sw' = 'en', extra: Parameters<typeof setupEvents>[2] = {}) => {
  const mock = await setupEvents(page, who(role), { me: organizerMe('active', role), s6, locale, ...extra });
  await page.goto(`${EV}&view=results${section ? `&section=${section}` : ''}`);
  return mock;
};
const PRIVATE = /\+255|@example\.com|dateOfBirth|emergency|"route"|-6\.7/i;
const csv = (rows: string[]) => ['bib,status,net_time,gun_time,category,note', ...rows].join('\n');
const file = (text: string, name = 'results.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });

/** A real PNG of the given size (RGB gradient), built without a library. */
function png(w: number, h: number): Buffer {
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x % 256; raw[o + 1] = y % 256; raw[o + 2] = 128; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngFile = (w = 600, h = 600, name = 'medal.png') => ({ name, mimeType: 'image/png', buffer: png(w, h) });

test.describe('availability and tab (AC-S1, AC-F1, AC-F2)', () => {
  for (const role of ['owner', 'admin', 'timing'] as Role[]) {
    test(`${role} sees the Results tab and the page`, async ({ page }) => {
      await open(page, role, null);
      await expect(page.getByTestId('results-view')).toBeVisible();
      await expect(page.getByTestId('event-view-tabs').getByRole('button', { name: /^Results/ })).toBeVisible();
      await expectNoRawKeys(page);
    });
  }
  for (const role of ['ops', 'finance'] as Role[]) {
    test(`${role} never sees the Results tab and the deep link is forbidden`, async ({ page }) => {
      const mock = await open(page, role, null);
      await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
      await expect(page.getByTestId('event-view-tabs').getByRole('button', { name: /^Results/ })).toHaveCount(0);
      expect(mock.reads(/results\/summary/)).toHaveLength(0);
    });
  }
  test('with the server flag off there is no tab and the deep link says it is not available', async ({ page }) => {
    const mock = await open(page, 'owner', null, { results: false });
    await expect(page.getByTestId('results-unavailable')).toContainText("Results aren't available yet.");
    await expect(page.getByTestId('event-view-tabs').getByRole('button', { name: /^Results/ })).toHaveCount(0);
    expect(mock.reads(/results/)).toHaveLength(0);
  });
  test('before the event starts the tab is hidden and the deep link waits', async ({ page }) => {
    const mock = await open(page, 'owner', null, { eventStatus: 'published' });
    await expect(page.getByTestId('results-not-started')).toContainText('Results open when the event starts.');
    await expect(page.getByTestId('event-view-tabs').getByRole('button', { name: /^Results/ })).toHaveCount(0);
    expect(mock.reads(/results\/summary/)).toHaveLength(0);
  });
  test('owner sees the open-questions count on the tab; timing does not', async ({ page }) => {
    await open(page, 'owner', null);
    await expect(page.getByTestId('event-view-tabs').getByRole('button', { name: 'Results (1)' })).toBeVisible();
    await page.getByTestId('results-sections').getByRole('button', { name: 'Disputes (1)' }).waitFor();
  });
  test('timing: no disputes count, Settings hidden, Medals read-only, starts on Import', async ({ page }) => {
    await open(page, 'timing', null);
    await expect(page.getByTestId('results-import')).toBeVisible();
    const seg = page.getByTestId('results-sections');
    await expect(seg.getByRole('button', { name: 'Settings' })).toHaveCount(0);
    await expect(seg.getByRole('button', { name: /^Disputes$/ })).toBeVisible();
    await seg.getByRole('button', { name: 'Medals' }).click();
    await expect(page.getByTestId('medal-add')).toHaveCount(0);
    await expect(page.getByTestId('medal-edit-tpl_1')).toHaveCount(0);
  });
  test('rewards flag off hides the Medals section; runs/public flags change nothing in the portal', async ({ page }) => {
    await open(page, 'owner', null, { rewards: false, medalArt: false, runs: false });
    await expect(page.getByTestId('results-sections').getByRole('button', { name: 'Medals' })).toHaveCount(0);
  });
  test('a suspended organizer can look but not change', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { me: organizerMe('suspended', 'owner'), s6: {} });
    await page.goto(`${EV}&view=results&section=overview`);
    await expect(page.getByTestId('results-suspended')).toBeVisible();
    await expect(page.getByTestId('release-off-cat_1')).toHaveCount(0);
    expect(mock.writes()).toHaveLength(0);
  });
});

test.describe('overview (§9.2)', () => {
  test('cards per category with counts, stage chip, progress and the step line', async ({ page }) => {
    await open(page, 'owner', 'overview');
    const c1 = page.getByTestId('results-cat-cat_1');
    await expect(c1).toContainText('21K Half Marathon');
    await expect(page.getByTestId('results-stage-cat_1')).toContainText('Not published');
    await expect(page.getByTestId('results-settled-cat_1')).toHaveText('Settled 1 of 4');
    await expect(c1.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await expect(c1).toContainText('7 need individual review'.replace('7', '1'));
    await expect(page.getByTestId('results-steps').locator('[aria-current="step"]')).toHaveText('2 Review');
    await expect(page.getByTestId('release-prov-cat_1')).toBeVisible();
    await expect(page.getByTestId('release-off-cat_1')).toBeVisible();
    await expectNoRawKeys(page);
  });
  test('timing sees counts only, with Import', async ({ page }) => {
    await open(page, 'timing', 'overview');
    await expect(page.getByTestId('results-cat-cat_1')).toBeVisible();
    await expect(page.getByTestId('release-off-cat_1')).toHaveCount(0);
    await expect(page.getByTestId('approve-clean-cat_1')).toHaveCount(0);
  });
  test('a failed summary degrades: a muted notice, the rest still works', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s6: {} });
    mock.on('GET', /^\/organizer\/events\/evt_pub\/results\/summary$/, () => ({ status: 500, json: { error: 'internal' } }));
    await page.goto(`${EV}&view=results&section=overview`);
    await expect(page.getByTestId('results-partial')).toBeVisible();
    await page.getByTestId('results-sections').getByRole('button', { name: 'Results', exact: true }).click();
    await expect(page.getByTestId('results-table-view')).toBeVisible();
  });
});

test.describe('import (§6.2, AC-S2, AC-S3)', () => {
  test('a bad file blocks Apply, lists line, bib and the reason in words, and writes nothing', async ({ page }) => {
    const mock = await open(page, 'owner', 'import');
    await page.getByTestId('import-file').setInputFiles(file(csv(['107,finished,1:30:00,,21K,', '999,finished,1:00:00,,21K,', '104,finished,abc,,10K,', '107,finished,1:31:00,,21K,', '106,finished,1:00:00,,10K,', '101,finished,1:42:11,,21K,'])));
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-summary')).toContainText('to fix');
    await expect(page.getByTestId('import-apply')).toBeDisabled();
    const probs = page.getByTestId('import-problems');
    await expect(probs).toContainText('Bib number not found in this event');
    await expect(probs).toContainText("Time isn't in a format we read (H:MM:SS)");
    await expect(probs).toContainText('This bib appears twice in the file');
    await expect(probs).toContainText('This place is cancelled or unpaid');
    await expect(probs.locator('tr', { hasText: '999' })).toContainText('3');
    expect(mock.writes(/results\/imports$/)).toHaveLength(0);
    expect(mock.reads(/results\/imports\/preview/)).toHaveLength(0);
    expect(mock.calls.filter(c => c.method === 'POST' && /imports\/preview/.test(c.path))).toHaveLength(1);
    await expectNoRawKeys(page);
  });
  test('a clean file applies atomically with an Idempotency-Key; a second identical file says nothing is new', async ({ page }) => {
    const mock = await open(page, 'owner', 'import');
    const good = csv(['107,finished,1:30:00,1:30:10,21K,', '106x,,,,,'].slice(0, 1).concat(['105,dnf,,,10K,']));
    await page.getByTestId('import-source-team').check();
    await page.getByTestId('import-provider').fill('Our timing team');
    await page.getByTestId('import-file').setInputFiles(file(good));
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-summary')).toContainText('2 ready, 0 to fix');
    await expect(page.getByTestId('import-bystatus')).toContainText('Finished: 1');
    await expect(page.getByTestId('import-apply')).toHaveText('Add 2 results');
    await page.getByTestId('import-apply').click();
    await expect(page.getByTestId('import-done')).toContainText('2 results added');
    const w = mock.writes(/results\/imports$/);
    expect(w).toHaveLength(1);
    expect(w[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(w[0].body).toMatchObject({ sourceType: 'organizer_verified', sourceLabel: 'Our timing team', timeBasis: 'net' });
    expect(w[0].body?.previewHash).toBeTruthy();
    expect(JSON.stringify(w[0].body)).not.toMatch(/userId/);
    expect(mock.s6!.results.reg_7.verificationStatus).toBe('pending_verification');
    expect(mock.s6!.results.reg_5.verificationStatus).toBe('dnf'); // a DNF enters already settled
    expect(mock.s6!.results.reg_5.revision).toBe(2); // a still-pending row is revised, never overwritten
    await expect(page.getByTestId('import-live')).toHaveText('2 results added');
    // The same file again: nothing is new, Apply stays off.
    await page.getByTestId('import-source-team').check();
    await page.getByTestId('import-provider').fill('Our timing team');
    await page.getByTestId('import-file').setInputFiles(file(good));
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-nothing-new')).toContainText('Nothing new');
    await expect(page.getByTestId('import-apply')).toBeDisabled();
  });
  test('ranks in the file are ignored with a note; Review results opens the table filtered to needs review', async ({ page }) => {
    await open(page, 'owner', 'import');
    await page.getByTestId('import-file').setInputFiles(file('bib,status,net_time,rank\n101,finished,1:42:11,1\n'));
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-warnings')).toContainText('Ranks in the file are ignored; FitFlex works them out');
    await expect(page.getByTestId('import-unmatched')).toContainText('registered people have no row in this file');
    await page.getByTestId('import-apply').click();
    await page.getByTestId('import-review').click();
    await expect(page.getByTestId('results-filter-status')).toHaveValue('needs_review');
    await expect(page.getByTestId('results-table-view')).toContainText('101');
    expect(page.url()).toContain('section=results');
    expect(page.url()).toContain('status=needs_review');
  });
  test('timing may import; a stale preview says so; a file over 1 MB or not CSV is refused before any request', async ({ page }) => {
    const mock = await open(page, 'timing', 'import');
    await page.getByTestId('import-file').setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.alloc(1_100_000, 'a') });
    await expect(page.getByTestId('import-file')).toBeVisible();
    await expect(page.getByTestId('results-import')).toContainText('Choose a .csv file of up to 1 MB.');
    await page.getByTestId('import-file').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('x') });
    await expect(page.getByTestId('results-import')).toContainText('Choose a .csv file of up to 1 MB.');
    await page.getByTestId('import-file').setInputFiles(file(csv(['107,finished,1:30:00,,21K,'])));
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-apply')).toBeEnabled();
    mock.s6!.version += 1; // registrations or bibs changed between check and apply
    await page.getByTestId('import-apply').click();
    await expect(page.getByTestId('import-error')).toContainText('Registrations changed. Check again.');
    await expect(page.getByTestId('import-apply')).toHaveCount(0);
  });
  test('the sample CSV downloads and the past imports table lists applied files', async ({ page }) => {
    await open(page, 'owner', 'import');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('import-sample').click()]);
    expect(dl.suggestedFilename()).toBe('results-sample.csv');
    await expect(page.getByTestId('results-import')).toContainText('No imports yet.');
  });
});

const openDrawer = async (page: Page, regId: string) => {
  await page.getByTestId(`result-open-${regId}`).click();
  await expect(page.getByTestId('result-drawer')).toBeVisible();
  await expect(page.getByTestId('drawer-numbers')).toBeVisible();
};

test.describe('results table and drawer (§6.3, §6.6, §9.2)', () => {
  test('rows show status in words, source label next to the time, flags as text; no contact data or route is ever rendered', async ({ page }) => {
    const mock = await open(page, 'owner', 'results', { leak: true });
    const t = page.getByTestId('results-table-view');
    await expect(t).toContainText('Amina Mollel');
    await expect(t.locator('tr', { hasText: '101' })).toContainText('Needs review');
    await expect(t.locator('tr', { hasText: '101' })).toContainText('Official timing · ChipTime Ltd');
    await expect(t.locator('tr', { hasText: '101' })).toContainText('1:42:10');
    await expect(t.locator('tr', { hasText: '102' })).toContainText('Virtual run, GPS');
    await expect(t.locator('tr', { hasText: '102' })).toContainText('Pace looks unusually fast');
    await expect(t.locator('tr', { hasText: '103' })).toContainText('Confirmed by organizer');
    await expect(t.locator('tr', { hasText: '103' })).toContainText('Under review');
    await expect(t.locator('tr', { hasText: '107' })).toContainText('No result');
    await expect(t).not.toContainText('Zawadi'); // cancelled place is not listed
    expect(await page.locator('main').innerText()).not.toMatch(PRIVATE);
    await openDrawer(page, 'reg_2');
    await expect(page.getByTestId('drawer-run')).toContainText('The route is private and isn\'t shown to you.');
    expect(await page.locator('main').innerText()).not.toMatch(PRIVATE);
    expect(JSON.stringify(mock.calls.map(c => c.body))).not.toMatch(/phone|email|route/);
    await expectNoRawKeys(page);
  });
  test('filters: category, status, flag and a search of at least two characters go to the server', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await page.getByTestId('results-filter-status').selectOption('needs_review');
    await expect(page.getByTestId('results-table-view')).not.toContainText('Chausiku');
    await page.getByTestId('results-filter-flag').selectOption('implausible_pace');
    await expect(page.getByTestId('results-table-view').locator('tbody tr')).toHaveCount(1);
    await page.getByTestId('results-filter-flag').selectOption('');
    await page.getByTestId('results-filter-category').selectOption('cat_2');
    await expect(page.getByTestId('results-table-view')).toContainText('Daudi');
    await expect(page.getByTestId('results-table-view')).not.toContainText('Amina');
    await page.getByTestId('results-search').fill('n');
    expect(mock.reads(/\/results$/).some(c => c.query.q)).toBe(false);
    await page.getByTestId('results-search').fill('Nee');
    await expect(page.getByTestId('results-table-view')).toContainText('Neema');
    expect(mock.reads(/\/results$/).some(c => c.query.q === 'Nee' && c.query.categoryId === 'cat_2')).toBe(true);
    expect(page.url()).toContain('category=cat_2');
  });
  test('"Load more" follows the cursor', async ({ page }) => {
    await open(page, 'owner', 'results', { pageSize: 3 });
    await expect(page.getByTestId('results-table-view').locator('tbody tr')).toHaveCount(3);
    await page.getByTestId('results-more').click();
    await expect(page.getByTestId('results-table-view').locator('tbody tr')).toHaveCount(6);
    await expect(page.getByTestId('results-more')).toHaveCount(0);
  });
  test('verify sends the current revision and an Idempotency-Key; the drawer shows the new version and announces it', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await openDrawer(page, 'reg_1');
    await expect(page.getByTestId('drawer-source')).toContainText('Official timing · ChipTime Ltd');
    await page.getByTestId('act-verify').click();
    await expect(page.getByTestId('drawer-live')).toHaveText('Result verified');
    const w = mock.writes(/results\/res_reg_1\/verify$/);
    expect(w).toHaveLength(1);
    expect(w[0].body).toEqual({ expectedRevision: 1 });
    expect(w[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(mock.s6!.results.reg_1.verificationStatus).toBe('verified');
    await expect(page.getByTestId('act-verify')).toHaveCount(0);
    await expect(page.getByTestId('drawer-revisions')).toContainText('Version 1');
  });
  test('a stale revision shows "Someone else changed this result" and Reload; nothing is written', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await openDrawer(page, 'reg_1');
    mock.s6!.results.reg_1.revision = 2; // someone else saved a new revision
    await page.getByTestId('act-verify').click();
    await expect(page.getByTestId('drawer-error')).toContainText('Someone else changed this result');
    expect(mock.s6!.results.reg_1.verificationStatus).toBe('pending_verification');
    await page.getByTestId('drawer-reload').click();
    await page.getByTestId('act-verify').click();
    await expect(page.getByTestId('drawer-live')).toHaveText('Result verified');
    expect(mock.writes(/verify$/)[1].body).toEqual({ expectedRevision: 2 });
  });
  test('reject needs a reason and sends the code; the note is optional', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await openDrawer(page, 'reg_1');
    await page.getByTestId('act-reject').click();
    await expect(page.getByTestId('decision-confirm')).toBeDisabled();
    await page.getByTestId('decision-reason').selectOption('duplicate');
    await page.getByTestId('decision-note').fill('Same run twice');
    await page.getByTestId('decision-confirm').click();
    await expect(page.getByTestId('drawer-live')).toHaveText('Result not accepted');
    expect(mock.writes(/reject$/)[0].body).toEqual({ expectedRevision: 1, reasonCode: 'duplicate', note: 'Same run twice' });
    expect(mock.s6!.results.reg_1.verificationStatus).toBe('rejected');
  });
  test('correct: inline time validation, reason and a note of 10 to 300; sends only what changed as H:MM:SS', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await openDrawer(page, 'reg_3');
    await page.getByTestId('act-correct').click();
    const c = page.getByTestId('correct-dialog');
    await expect(c.getByTestId('correct-current')).toContainText('1:55:03');
    await expect(page.getByTestId('correct-confirm')).toBeDisabled();
    await page.getByTestId('correct-net').fill('1:5');
    await expect(c).toContainText('Time isn\'t in a format we read (H:MM:SS)');
    await page.getByTestId('correct-net').fill('1:52:00');
    await expect(page.getByTestId('correct-reason').locator('option[value="late_finish_data"]')).toHaveCount(1);
    await page.getByTestId('correct-reason').selectOption('timing_error');
    await page.getByTestId('correct-note').fill('short');
    await expect(page.getByTestId('correct-confirm')).toBeDisabled();
    await page.getByTestId('correct-note').fill('Mat read was late; fixed to the chip time');
    await expect(c).toContainText('This changes ranks and may change medals.');
    await page.getByTestId('correct-confirm').click();
    await expect(page.getByTestId('drawer-live')).toHaveText('Result corrected');
    expect(mock.writes(/correct$/)[0].body).toEqual({ expectedRevision: 1, netTime: '1:52:00', reasonCode: 'timing_error', note: 'Mat read was late; fixed to the chip time' });
    expect(mock.s6!.results.reg_3.verificationStatus).toBe('corrected');
    await expect(page.getByTestId('drawer-net')).toHaveText('1:52:00');
    await expect(page.getByTestId('drawer-revisions')).toContainText('Version 1');
  });
  test('disqualify needs a note of 10 to 300 and warns about ranks and medals', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await openDrawer(page, 'reg_3');
    await page.getByTestId('act-dq').click();
    await expect(page.getByTestId('disqualify-dialog')).toContainText('loses their rank and any medals');
    await expect(page.getByTestId('decision-confirm')).toBeDisabled(); // a reason from the server's list is required
    await expect(page.getByTestId('decision-reason').locator('option')).toHaveCount(8);
    await page.getByTestId('decision-reason').selectOption('course_cut');
    await page.getByTestId('decision-note').fill('Cut the course at 8 km');
    await page.getByTestId('decision-confirm').click();
    await expect(page.getByTestId('drawer-live')).toHaveText('Result disqualified');
    expect(mock.writes(/disqualify$/)[0].body).toEqual({ expectedRevision: 1, reasonCode: 'course_cut', note: 'Cut the course at 8 km' });
    await expect(page.getByTestId('result-drawer')).toContainText('Disqualified');
  });
  test('timing may enter a provisional result but has no verify, reject, correct or disqualify', async ({ page }) => {
    const mock = await open(page, 'timing', 'results');
    await openDrawer(page, 'reg_7');
    for (const id of ['act-verify', 'act-reject', 'act-correct', 'act-dq']) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(page.getByTestId('result-drawer')).toContainText('An owner or admin verifies them.');
    await page.getByTestId('act-enter').click();
    await expect(page.getByTestId('entry-confirm')).toBeDisabled();
    await page.getByTestId('entry-net').fill('2:10:30');
    await page.getByTestId('entry-confirm').click();
    await expect(page.getByTestId('drawer-live')).toHaveText('Result saved as provisional');
    const w = mock.writes(/results\/reg_7$/);
    expect(w[0].body).toEqual({ finishStatus: 'finished', netTime: '2:10:30' });
    expect(w[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(mock.s6!.results.reg_7.verificationStatus).toBe('pending_verification');
  });
  test('a DNF is entered already settled, with no time field', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await openDrawer(page, 'reg_7');
    await page.getByTestId('act-enter').click();
    await page.getByTestId('entry-status').selectOption('dnf');
    await expect(page.getByTestId('entry-net')).toHaveCount(0);
    await page.getByTestId('entry-confirm').click();
    await expect(page.getByTestId('drawer-live')).toHaveText('Result saved as provisional');
    expect(mock.writes(/results\/reg_7$/)[0].body).toEqual({ finishStatus: 'dnf' });
    expect(mock.s6!.results.reg_7.verificationStatus).toBe('dnf');
  });
  test('the drawer deep link (&registration=) opens and closes keeping the section', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s6: {} });
    await page.goto(`${EV}&view=results&section=results&registration=reg_4`);
    await expect(page.getByRole('dialog')).toContainText('Daudi Kway');
    await page.getByTestId('drawer-close').click();
    await expect(page.getByTestId('result-drawer')).toHaveCount(0);
    expect(page.url()).not.toContain('registration=');
    expect(page.url()).toContain('section=results');
  });
});

test.describe('bulk approve and release (§6.3, §6.4, AC-S5, AC-S6, AC-S7)', () => {
  test('Approve all clean excludes flagged rows, says how many, and applies with the preview hash', async ({ page }) => {
    const mock = await open(page, 'owner', 'overview');
    await page.getByTestId('approve-clean-cat_1').click();
    await expect(page.getByTestId('bulk-approve-count')).toHaveText('1 clean results will be approved.');
    await expect(page.getByTestId('bulk-approve-excluded')).toContainText('1 flagged results are left out');
    await page.getByTestId('bulk-approve-confirm').click();
    await expect(page.getByTestId('results-live')).toHaveText('1 results approved');
    const w = mock.writes(/verify-bulk$/);
    expect(w[0].body).toMatchObject({ categoryId: 'cat_1', filter: 'pending_clean' });
    expect(w[0].body?.previewHash).toBeTruthy();
    expect(mock.s6!.results.reg_1.verificationStatus).toBe('verified');
    expect(mock.s6!.results.reg_2.verificationStatus).toBe('pending_verification'); // flagged rows need their own decision
  });
  test('the bulk bar on the filtered table works too, and a stale preview asks to check again', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await page.getByTestId('results-filter-status').selectOption('needs_review');
    await page.getByTestId('results-approve-clean').click();
    await expect(page.getByTestId('bulk-approve-count')).toBeVisible();
    mock.s6!.results.reg_4.revision += 1; mock.s6!.version += 1;
    mock.s6!.results.reg_4.verificationStatus = 'verified'; // pending set changed after the preview
    await page.getByTestId('bulk-approve-confirm').click();
    await expect(page.getByTestId('bulk-approve-dialog')).toContainText('Registrations changed. Check again.');
    await expect(page.getByTestId('bulk-approve-confirm')).toBeDisabled();
  });
  test('official release: blocked while results are unsettled, needs the typed number, checkboxes, and cannot be withdrawn', async ({ page }) => {
    const mock = await open(page, 'owner', 'overview');
    await page.getByTestId('release-off-cat_1').click();
    const d = page.getByTestId('release-dialog');
    await expect(d).toContainText('Publish as official');
    await expect(page.getByTestId('release-count-finished')).toHaveText('1');
    await expect(page.getByTestId('release-count-unsettled')).toHaveText('2');
    await expect(page.getByTestId('release-blocked')).toContainText('2 results are not settled yet');
    await expect(page.getByTestId('release-warn')).toHaveText("Official results can't be withdrawn. Mistakes are fixed as corrections that everyone can see.");
    await expect(page.getByTestId('release-confirm')).toBeDisabled();
    await page.getByTestId('release-leave-out').check();
    await expect(page.getByTestId('release-blocked')).toHaveCount(0);
    await page.getByTestId('release-mark-dns').check();
    await expect(page.getByText('Type the number of results being published (2)')).toBeVisible(); // 1 finished + 1 no result marked DNS
    await page.getByTestId('release-type').fill('3');
    await expect(page.getByTestId('release-confirm')).toBeDisabled();
    await page.getByTestId('release-type').fill('2');
    await expect(page.getByTestId('release-type')).toHaveAttribute('inputmode', 'numeric');
    await expect(page.getByTestId('release-type')).toHaveAttribute('aria-describedby', /.+/);
    await page.getByTestId('release-confirm').click();
    await expect(page.getByTestId('results-live')).toHaveText('Results published');
    const w = mock.writes(/results\/release$/);
    expect(w[0].body).toMatchObject({ categoryId: 'cat_1', stage: 'official', markRemainingDns: true, leaveUnsettledOut: true });
    expect(w[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(mock.s6!.releases.cat_1.stage).toBe('official');
    expect(mock.s6!.results.reg_7.verificationStatus).toBe('dns');
    await expect(page.getByTestId('results-stage-cat_1')).toContainText('Official');
    await expect(page.getByTestId('release-off-cat_1')).toHaveCount(0);
    await expect(page.getByTestId('withdraw-cat_1')).toHaveCount(0);
    await expect(page.getByTestId('results-steps').locator('[aria-current="step"]')).toHaveText('2 Review'); // the 10K still has results to review
  });
  test('provisional release can be withdrawn; ranks are the server\'s and appear after an official release', async ({ page }) => {
    const mock = await open(page, 'owner', 'overview');
    await page.getByTestId('release-prov-cat_2').click();
    await expect(page.getByTestId('release-dialog')).toContainText('Results still waiting for review are not counted.');
    await page.getByTestId('release-type').fill('0'); // the server's resultCount leaves out results still to review
    await page.getByTestId('release-confirm').click();
    await expect(page.getByTestId('results-stage-cat_2')).toContainText('Provisional');
    await page.getByTestId('withdraw-cat_2').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Withdraw provisional results' }).click();
    await expect(page.getByTestId('results-stage-cat_2')).toContainText('Not published');
    expect(mock.writes(/release\/withdraw$/)[0].body).toEqual({ categoryId: 'cat_2' });
    // Official 10K (two pending rows settled first), then the table shows server ranks with the tie sharing a rank.
    await page.getByTestId('approve-clean-cat_2').click();
    await page.getByTestId('bulk-approve-confirm').click();
    await page.getByTestId('release-off-cat_2').click();
    await page.getByTestId('release-type').fill('2');
    await page.getByTestId('release-confirm').click();
    await expect(page.getByTestId('results-stage-cat_2')).toContainText('Official');
    await page.getByTestId('results-sections').getByRole('button', { name: 'Results', exact: true }).click();
    await page.getByTestId('results-filter-category').selectOption('cat_2');
    const rows = page.getByTestId('results-table-view');
    await expect(rows.locator('tr', { hasText: '104' })).toContainText('1');
    await expect(rows.locator('tr', { hasText: '105' }).locator('td').nth(6)).toHaveText('2');
    expect(mock.writes(/results\/release$/).every(w => !('rank' in (w.body ?? {})))).toBe(true);
  });
  test('the server\'s unsettled_results refusal names the number', async ({ page }) => {
    const mock = await open(page, 'owner', 'overview');
    await page.getByTestId('release-off-cat_1').click();
    await page.getByTestId('release-leave-out').check();
    await page.getByTestId('release-type').fill('1');
    mock.on('POST', /results\/release$/, () => ({ status: 409, json: { error: 'unsettled_results', unsettled: 2 } }));
    await page.getByTestId('release-confirm').click();
    await expect(page.getByTestId('release-error')).toContainText('2 results are not settled yet.');
  });
  test('a second official release is refused by the server and shown in words', async ({ page }) => {
    const mock = await open(page, 'owner', 'overview', { officialRelease: true });
    await expect(page.getByTestId('release-off-cat_2')).toHaveCount(0);
    mock.s6!.releases.cat_1 = { stage: 'provisional', releasedAt: '2027-03-13T10:00:00.000Z' };
    await page.reload();
    await page.getByTestId('release-off-cat_1').click();
    await page.getByTestId('release-leave-out').check();
    mock.s6!.releases.cat_1 = { stage: 'official', releasedAt: '2027-03-13T11:00:00.000Z' };
    await page.getByTestId('release-type').fill('1');
    await page.getByTestId('release-confirm').click();
    await expect(page.getByTestId('release-error')).toContainText('already published as official');
  });
});

test.describe('disputes and settings (§6.7, §9.2)', () => {
  test('owner opens a question and corrects the result; correction and resolution travel together', async ({ page }) => {
    const mock = await open(page, 'owner', 'disputes');
    await expect(page.getByTestId('results-disputes')).toContainText('Chausiku Juma');
    await expect(page.getByTestId('results-disputes')).toContainText('My time is wrong');
    await page.getByTestId('dispute-open-dsp_1').click();
    await expect(page.getByTestId('dispute-note')).toHaveText('My watch says 1:52');
    await expect(page.getByTestId('dispute-result')).toContainText('1:55:03');
    await page.getByTestId('dispute-correct').click();
    await page.getByTestId('correct-net').fill('1:52:10');
    await page.getByTestId('correct-reason').selectOption('timing_error');
    await page.getByTestId('correct-note').fill('Runner is right: chip read late');
    await page.getByTestId('correct-confirm').click();
    const w = mock.writes(/disputes\/dsp_1\/resolve$/);
    expect(w).toHaveLength(1);
    expect(w[0].body).toEqual({ outcome: 'upheld', note: 'Runner is right: chip read late', correction: { action: 'correct', expectedRevision: 1, netTime: '1:52:10', reasonCode: 'timing_error', note: 'Runner is right: chip read late' } });
    expect(mock.s6!.disputes[0].status).toBe('upheld');
    await expect(page.getByTestId('disputes-empty')).toBeVisible();
  });
  test('"No change needed" needs a note; the answer is recorded as rejected', async ({ page }) => {
    const mock = await open(page, 'owner', 'disputes');
    await page.getByTestId('dispute-open-dsp_1').click();
    await page.getByTestId('dispute-nochange').click();
    await expect(page.getByTestId('dispute-note-confirm')).toBeDisabled();
    await page.getByTestId('dispute-note-input').fill('Chip log confirms the time');
    await page.getByTestId('dispute-note-confirm').click();
    expect(mock.writes(/resolve$/)[0].body).toEqual({ outcome: 'rejected', note: 'Chip log confirms the time' });
    await expect(page.getByTestId('disputes-empty')).toBeVisible();
  });
  test('timing can read a question but not answer it', async ({ page }) => {
    await open(page, 'timing', 'disputes');
    await page.getByTestId('dispute-open-dsp_1').click();
    await expect(page.getByTestId('dispute-panel')).toContainText('Only an owner or admin can answer this question.');
    await expect(page.getByTestId('dispute-correct')).toHaveCount(0);
  });
  test('settings save a window in days and the name rule; after official release only the window can be extended', async ({ page }) => {
    const mock = await open(page, 'owner', 'settings');
    await page.getByTestId('settings-basis').selectOption('gun');
    await page.getByTestId('settings-cutoff').fill('240');
    await page.getByTestId('settings-window').selectOption('14');
    await page.getByTestId('settings-names-bib').check();
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('Settings saved').first()).toBeVisible();
    const w = mock.writes(/results-settings$/);
    expect(w[0].body).toEqual({ timeBasis: 'gun', cutoffMinutes: 240, disputeWindowHours: 336, publicNames: 'bib_only' });
    expect(w[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    mock.s6!.releases.cat_1 = { stage: 'official', releasedAt: '2027-03-13T10:00:00.000Z' };
    await page.reload();
    await expect(page.getByTestId('settings-locked')).toBeVisible();
    await expect(page.getByTestId('settings-basis')).toBeDisabled();
    await expect(page.getByTestId('settings-cutoff')).toBeDisabled();
    await page.getByTestId('settings-window').selectOption('30');
    await page.getByTestId('settings-save').click();
    expect(mock.writes(/results-settings$/)[1].body).toEqual({ disputeWindowHours: 720 });
  });
  test('an invalid cut-off is stopped before sending', async ({ page }) => {
    await open(page, 'owner', 'settings');
    await page.getByTestId('settings-cutoff').fill('2000');
    await expect(page.getByTestId('results-settings')).toContainText('Use a whole number from 1 to 1440');
    await expect(page.getByTestId('settings-save')).toBeDisabled();
  });
});

test.describe('medals (§7.1, §9.2)', () => {
  test('cards show name, rule, scope, tier, source chip and the Swahili-missing warning; ruleless text is plain', async ({ page }) => {
    await open(page, 'owner', 'medals');
    const a = page.getByTestId('medal-tpl_1'); const b = page.getByTestId('medal-tpl_2');
    await expect(a).toContainText('Finisher');
    await expect(page.getByTestId('medal-rule-tpl_1')).toHaveText('Finish the race · All categories');
    await expect(page.getByTestId('medal-rule-tpl_2')).toHaveText('Finish in the top 1 of the category · 21K Half Marathon');
    await expect(a).toContainText('FitFlex design');
    await expect(page.getByTestId('medal-sw-missing-tpl_2')).toHaveText('Swahili text missing; members will see English');
    await expect(page.getByTestId('medal-sw-missing-tpl_1')).toHaveCount(0);
    await expect(b.getByTestId('medal-art')).toHaveAttribute('data-art-source', 'builtin');
    await expect(b.locator('svg[data-art="podium_gold"]')).toBeVisible();
    await expectNoRawKeys(page);
  });
  test('add a medal: top 3 overall with a FitFlex design; the body carries no image address', async ({ page }) => {
    const mock = await open(page, 'owner', 'medals');
    await page.getByTestId('medal-add').click();
    await expect(page.getByTestId('medal-save')).toBeDisabled();
    await page.getByTestId('medal-name-en').fill('Overall podium');
    await page.getByTestId('medal-tier').selectOption('silver');
    await page.getByTestId('medal-rule').selectOption('placing');
    await page.getByTestId('medal-scope').selectOption('overall');
    await page.getByTestId('medal-top').fill('3');
    await expect(page.getByTestId('art-podium_silver')).toBeChecked(); // the tier picks the default design
    await page.locator('label', { has: page.getByTestId('art-charity_red') }).click();
    await page.getByTestId('medal-save').click();
    await expect(page.getByTestId('medal-tpl_3')).toContainText('Overall podium');
    const w = mock.writes(/medal-templates$/);
    expect(w[0].body).toEqual({ name: { en: 'Overall podium', sw: '' }, description: { en: '', sw: '' }, tier: 'silver', status: 'active', artKey: 'charity_red', rule: { type: 'placing', scope: 'overall', top: 3 }, categoryId: null });
    expect(JSON.stringify(w[0].body)).not.toMatch(/imageUrl|http/);
    expect(w[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
  });
  test('an under-a-time rule sends milliseconds; a bad time blocks Save', async ({ page }) => {
    const mock = await open(page, 'owner', 'medals');
    await page.getByTestId('medal-add').click();
    await page.getByTestId('medal-name-en').fill('Sub 2');
    await page.getByTestId('medal-rule').selectOption('time_under');
    await page.getByTestId('medal-under').fill('2:0');
    await expect(page.getByTestId('medal-save')).toBeDisabled();
    await page.getByTestId('medal-under').fill('1:59:59');
    await page.getByTestId('medal-save').click();
    await expect(page.getByTestId('medal-tpl_3')).toContainText('Finish under 1:59:59');
    expect(mock.writes(/medal-templates$/)[0].body?.rule).toEqual({ type: 'time_under', maxElapsedMs: 7_199_000 });
  });
  test('an event with no medals suggests a finisher medal; nothing is created automatically', async ({ page }) => {
    const mock = await open(page, 'owner', 'medals', { medals: false });
    await expect(page.getByTestId('results-medals')).toContainText('No medals yet.');
    expect(mock.writes()).toHaveLength(0);
    await page.getByTestId('medal-add-finisher').click();
    await expect(page.getByTestId('medal-name-en')).toHaveValue('Finisher medal');
    await expect(page.getByTestId('medal-name-sw')).toHaveValue('Medali ya aliyemaliza');
    expect(mock.writes()).toHaveLength(0);
  });
  test('after official results the rules are locked, names stay editable, and "about N people" shows', async ({ page }) => {
    const mock = await open(page, 'owner', 'medals', { officialRelease: true });
    await expect(page.getByTestId('medal-tpl_1')).toContainText("Rules can't change after official results");
    await expect(page.getByTestId('medal-preview-tpl_1')).toHaveText('About 3 people would get this medal');
    await page.getByTestId('medal-edit-tpl_1').click();
    await expect(page.getByTestId('medal-rule')).toBeDisabled();
    await expect(page.getByTestId('medal-category')).toBeDisabled();
    await page.getByTestId('medal-name-en').fill('Finisher 2027');
    await page.getByTestId('medal-save').click();
    await expect(page.getByTestId('medal-name-tpl_1')).toHaveText('Finisher 2027');
    const body = mock.writes(/medal-templates\/tpl_1$/)[0].body!;
    expect(body).not.toHaveProperty('rule');
    expect(body).not.toHaveProperty('categoryId');
  });
  test('a locked-rule refusal from the server is shown in words', async ({ page }) => {
    const mock = await open(page, 'owner', 'medals');
    await page.getByTestId('medal-edit-tpl_1').click();
    mock.s6!.releases.cat_1 = { stage: 'official', releasedAt: '2027-03-13T10:00:00.000Z' };
    await page.getByTestId('medal-rule').selectOption('placing');
    await page.getByTestId('medal-save').click();
    await expect(page.getByTestId('medal-error')).toContainText("The rules of this medal can't change after official results.");
  });
});

test.describe('medal artwork (§7.7, D54, AC-G1 to AC-G9)', () => {
  const upload = async (page: Page, id = 'tpl_1') => {
    await page.getByTestId(`medal-upload-${id}`).click();
    await expect(page.getByTestId('art-dialog')).toBeVisible();
  };
  test('upload: crop with a circular preview, rights box required, raw image body with the confirmation version, live at once', async ({ page }) => {
    const mock = await open(page, 'owner', 'medals');
    await upload(page);
    const dlg = page.getByTestId('art-dialog');
    await expect(dlg).toContainText('PNG, JPEG or WebP, at least 512 x 512 pixels, up to 2 MB. Your design is shown in a circle.');
    await expect(dlg).toContainText("Don't include photos of people unless they agreed");
    await expect(page.getByTestId('art-upload')).toBeDisabled();
    await page.getByTestId('art-file').setInputFiles(pngFile(700, 600));
    await expect(page.getByTestId('art-crop')).toBeVisible();
    await expect(page.getByTestId('art-viewport')).toHaveClass(/rounded-full/);
    await expect(page.getByTestId('art-viewport').locator('img')).toHaveAttribute('alt', 'Preview of the Finisher medal design');
    await expect(page.getByTestId('art-upload')).toBeDisabled(); // the rights confirmation is required
    // The crop is keyboard operable and has numeric fields.
    await page.getByTestId('art-viewport').focus();
    await page.keyboard.press('+');
    await expect(page.getByTestId('art-zoom')).toHaveValue('1.1');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('art-x')).toHaveValue('5');
    await page.getByTestId('art-alt-en').fill('A green laurel');
    await page.getByTestId('art-alt-sw').fill('Taji ya kijani');
    await page.getByTestId('art-rights').check();
    await expect(dlg).toContainText('I made this design or have the right to use it.');
    await page.getByTestId('art-upload').click();
    await expect(page.getByTestId('art-dialog')).toHaveCount(0);
    expect(mock.s6!.uploads).toHaveLength(1);
    const up = mock.s6!.uploads[0];
    expect(['image/webp', 'image/png']).toContain(up.type);
    expect(up.size).toBeGreaterThan(1000);
    expect(up.size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(up.confirmationVersion).toBe(ART_CONFIRMATION_VERSION);
    expect(up.key).toMatch(/^.{8,100}$/);
    const post = mock.writes(/medal-templates\/tpl_1\/art$/).find(w => w.method === 'POST')!;
    expect(post.query).toMatchObject({ confirmationVersion: ART_CONFIRMATION_VERSION, altEn: 'A green laurel', altSw: 'Taji ya kijani' });
    expect(mock.writes(/medal-templates\/tpl_1\/art$/).filter(w => w.method === 'PATCH')).toHaveLength(0); // alt text rides the upload
    const card = page.getByTestId('medal-tpl_1');
    await expect(card).toContainText('Your design');
    await expect(card.getByTestId('medal-art')).toHaveAttribute('data-art-source', 'custom');
    await expect(card.getByTestId('medal-art').locator('img')).toHaveAttribute('alt', 'A green laurel');
    await expect(page.getByText('Your design is now shown to participants.').first()).toBeVisible();
  });
  test('Replace, Use a FitFlex design and Remove switch back to a built-in design; Remove asks first', async ({ page }) => {
    const mock = await open(page, 'owner', 'medals');
    mock.s6!.templates[0].art = { source: 'custom', artId: 'art_9', revision: 1, artKey: 'finisher_green', altText: null };
    mock.s6!.arts.push({ id: 'art_9', templateId: 'tpl_1', status: 'live', reviewState: 'reviewed', revision: 1 });
    await page.reload();
    const card = page.getByTestId('medal-tpl_1');
    await expect(card.getByTestId('medal-art')).toHaveAttribute('data-art-source', 'custom');
    await expect(page.getByTestId('medal-upload-tpl_1')).toHaveText('Replace');
    await page.getByTestId('medal-remove-tpl_1').click();
    await expect(page.getByRole('alertdialog')).toContainText('Participants will see a FitFlex design instead.');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(card.getByTestId('medal-art')).toHaveAttribute('data-art-source', 'builtin');
    expect(mock.writes(/art$/).filter(w => w.method === 'DELETE')).toHaveLength(1);
    mock.s6!.templates[0].art = { source: 'custom', artId: 'art_9', revision: 1, artKey: 'finisher_green', altText: null };
    await page.reload();
    await page.getByTestId('medal-builtin-tpl_1').click();
    await expect(card.getByTestId('medal-art')).toHaveAttribute('data-art-source', 'builtin');
  });
  test('files refused before any request: SVG, wrong type, over 2 MB, under 512 px', async ({ page }) => {
    const mock = await open(page, 'owner', 'medals');
    await upload(page);
    const err = page.getByTestId('art-error');
    await page.getByTestId('art-file').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    await expect(err).toContainText("SVG files aren't accepted. Use PNG, JPEG or WebP.");
    await page.getByTestId('art-file').setInputFiles({ name: 'a.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(err).toContainText("This file type isn't accepted. Use PNG, JPEG or WebP.");
    await page.getByTestId('art-file').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 10, 1) });
    await expect(err).toContainText('The file is over 2 MB.');
    await page.getByTestId('art-file').setInputFiles(pngFile(300, 300, 'small.png'));
    await expect(err).toContainText('The image must be at least 512 x 512 pixels.');
    await page.getByTestId('art-file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') });
    await expect(err).toContainText("We couldn't read this image. Try another file.");
    await expect(page.getByTestId('art-crop')).toHaveCount(0);
    await expect(page.getByTestId('art-upload')).toBeDisabled();
    expect(mock.s6!.uploads).toHaveLength(0);
    expect(mock.writes(/art$/)).toHaveLength(0);
    // The error line is announced (role=alert).
    await expect(err.getByRole('alert')).toBeVisible();
  });
  const SERVER_REFUSALS: Array<[string, string]> = [
    ['svg_not_allowed', "SVG files aren't accepted. Use PNG, JPEG or WebP."], ['unsupported_file_type', "This file type isn't accepted. Use PNG, JPEG or WebP."],
    ['animated_not_allowed', "Animated images aren't accepted."], ['corrupt_image', "We couldn't read this image. Try another file."],
    ['payload_too_large', 'The file is over 2 MB.'], ['image_too_small', 'The image must be at least 512 x 512 pixels.'], ['not_square', 'The image must be square. Crop it and try again.'],
    ['file_not_allowed', "This file was removed before and can't be used again."], ['rate_limited', 'Too many tries. Try again in 60 seconds.'],
    ['busy', "We're busy. Try again in a moment."], ['confirmation_outdated', 'The confirmation text has changed. Reload the page, read it again and confirm.'],
  ];
  for (const [code, text] of SERVER_REFUSALS) {
    test(`the server's ${code} is shown as a plain sentence and nothing is stored`, async ({ page }) => {
      const mock = await open(page, 'owner', 'medals');
      await upload(page);
      await page.getByTestId('art-file').setInputFiles(pngFile());
      await page.getByTestId('art-rights').check();
      mock.s6!.failArt = code;
      await page.getByTestId('art-upload').click();
      await expect(page.getByTestId('art-error')).toContainText(text);
      expect(mock.s6!.uploads).toHaveLength(0);
      await expect(page.getByTestId('art-dialog')).toBeVisible();
      // A retry of the same crop reuses the Idempotency-Key.
      const first = mock.writes(/art$/).at(-1)!.headers?.['idempotency-key'];
      await page.getByTestId('art-upload').click();
      await expect(page.getByTestId('art-dialog')).toHaveCount(0);
      expect(mock.writes(/art$/).at(-1)!.headers?.['idempotency-key']).toBe(first);
    });
  }
  test('timing sees designs but cannot upload; with the art flag off there is no upload control and the built-in design shows', async ({ page }) => {
    await open(page, 'timing', 'medals');
    await expect(page.getByTestId('medal-tpl_1')).toBeVisible();
    await expect(page.getByTestId('medal-upload-tpl_1')).toHaveCount(0);
    const mock = await open(page, 'owner', 'medals', { medalArt: false });
    await expect(page.getByTestId('medal-upload-tpl_1')).toHaveCount(0);
    await expect(page.getByTestId('medals-builtin-only')).toContainText('Medals use FitFlex designs for now.');
    await expect(page.getByTestId('medal-tpl_1').getByTestId('medal-art')).toHaveAttribute('data-art-source', 'builtin');
    expect(mock.reads(/art\/preview|medal-art/)).toHaveLength(0);
  });
  test('a design that fails to load never leaves a blank medal', async ({ page }) => {
    const mock = await open(page, 'owner', 'medals');
    mock.s6!.templates[0].art = { source: 'custom', artId: 'art_gone', revision: 1, artKey: 'finisher_green', altText: null };
    await page.reload();
    await expect(page.getByTestId('medal-tpl_1').getByTestId('medal-art')).toHaveAttribute('data-art-source', 'builtin');
    await expect(page.getByTestId('medal-tpl_1').locator('svg[data-art="finisher_green"]')).toBeVisible();
  });
});

test.describe('integrations: result scopes and webhooks (§8.4, §8.5, AC-A1, AC-A3)', () => {
  const go = async (page: Page, s6: S6Opts = {}, tab = '') => {
    const mock = await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s6 });
    await page.goto(`/organizer/integrations/${tab}`);
    return mock;
  };
  test('results:write is High risk with the "cannot verify or publish" line; results:read is selectable; both are sent', async ({ page }) => {
    const mock = await go(page);
    await page.getByTestId('clients-new').click();
    await page.getByTestId('client-name').fill('Timing partner');
    await expect(page.getByTestId('scope-row-results:write')).toContainText('High risk');
    await expect(page.getByTestId('scope-results:write')).toBeEnabled();
    await expect(page.getByTestId('scope-results-help')).toHaveText('Can submit provisional results for the selected events. It cannot verify or publish them.');
    await expect(page.getByTestId('scope-row-results:read')).toContainText('Read');
    await page.getByTestId('scope-results:read').check();
    await page.getByTestId('scope-results:write').check();
    await expect(page.getByTestId('scope-results-needs-read').first()).toContainText('Read registrations');
    await page.getByTestId('scope-registrations:read').check();
    await expect(page.getByTestId('scope-results-needs-read')).toHaveCount(0);
    await page.getByTestId('client-create').click();
    await expect(page.getByTestId('secret-value')).toBeVisible();
    expect(mock.writes(/api-clients$/)[0].body!.scopes).toEqual(['results:read', 'results:write', 'registrations:read']);
  });
  test('with the results flag off results:write stays "coming soon" and results:read is hidden (S5 unchanged)', async ({ page }) => {
    await go(page, { results: false });
    await page.getByTestId('clients-new').click();
    await expect(page.getByTestId('scope-results:write')).toBeDisabled();
    await expect(page.getByTestId('scope-row-results:write')).toContainText('coming soon');
    await expect(page.getByTestId('scope-row-results:read')).toHaveCount(0);
  });
  test('the four result events are offered (explicit, no wildcard) only while results are on', async ({ page }) => {
    const mock = await go(page, {}, '?tab=webhooks');
    await page.getByTestId('webhooks-new').click();
    for (const t of ['result.verified', 'result.published', 'result.corrected', 'result.disputed']) await expect(page.getByTestId(`endpoint-event-${t}`)).toBeVisible();
    await page.getByTestId('endpoint-url').fill('https://hooks.timing.test/results');
    await page.getByTestId('endpoint-event-result.published').check();
    await page.getByTestId('endpoint-create').click();
    await expect(page.getByTestId('secret-value')).toBeVisible();
    expect(mock.writes(/webhook-endpoints$/)[0].body!.events).toEqual(['result.published']);
  });
  test('results events are absent when the flag is off', async ({ page }) => {
    await go(page, { results: false }, '?tab=webhooks');
    await page.getByTestId('webhooks-new').click();
    await expect(page.getByTestId('endpoint-event-kit.collected')).toBeVisible();
    await expect(page.getByTestId('endpoint-event-result.verified')).toHaveCount(0);
  });
});

// ── FitFlex admin ──
const adminDesk = async (page: Page, s6: S6Opts = {}, tab = '', user = EVENTS_STAFF, locale: 'en' | 'sw' = 'en') => {
  const mock = await setupEvents(page, user, { s6, locale });
  await page.goto(`/admin/event-rewards/${tab}`);
  return mock;
};

test.describe('admin reward desk (§7.4, §7.6, §9.4)', () => {
  test('rewards flag off: not available, no calls, no nav item; on: nav item for an events-scope admin', async ({ page }) => {
    const off = await adminDesk(page, { rewards: false });
    await expect(page.getByTestId('rewards-unavailable')).toBeVisible();
    expect(off.reads(/admin\/reward|admin\/medal-art|event-award/)).toHaveLength(0);
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Event rewards' })).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await adminDesk(page);
    await expect(page.getByTestId('reward-desk')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Event rewards' })).toBeVisible();
  });
  test('an admin without the events scope gets nothing from the server and no nav item', async ({ page }) => {
    const mock = await adminDesk(page, {}, '', { id: 'admin-4', userType: 'admin', portalUser: true, aclPermissions: ['gyms'] } as typeof EVENTS_STAFF);
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Event rewards' })).toHaveCount(0);
    await expect(page.getByTestId('rewards-definitions')).toHaveCount(0);
    expect(mock.s6!.defs).toHaveLength(1);
  });
  test('definitions: summary strip, table, and a new reward with the value shown disabled; no "points" anywhere', async ({ page }) => {
    const mock = await adminDesk(page);
    await expect(page.getByTestId('rewards-summary')).toContainText('Earned');
    await expect(page.getByTestId('rewards-definitions')).toContainText('Finisher certificate');
    await expect(page.getByTestId('rewards-definitions')).toContainText('3 / 100');
    await expect(page.getByTestId('rewards-most')).toContainText('usr_farm1');
    await page.getByTestId('reward-new').click();
    await expect(page.getByTestId('reward-value')).toBeDisabled();
    await expect(page.getByTestId('reward-dialog')).toContainText("Cash and shop value aren't available yet.");
    await expect(page.getByTestId('reward-save')).toBeDisabled();
    await page.getByTestId('reward-title-en').fill('Marathon perk');
    await expect(page.getByTestId('reward-save')).toBeDisabled(); // the Swahili title and terms are required too
    await page.getByTestId('reward-title-sw').fill('Faida ya marathoni');
    await page.getByTestId('reward-terms-en').fill('Show the code at the desk.');
    await page.getByTestId('reward-terms-sw').fill('Onyesha msimbo kwenye dawati.');
    await page.getByTestId('reward-trigger').selectOption('achievement');
    await expect(page.getByTestId('reward-save')).toBeDisabled(); // an achievement is needed
    await page.getByTestId('reward-achievement').selectOption('marathon_finish');
    await page.getByTestId('reward-mode').selectOption('perk');
    await page.getByTestId('reward-status').selectOption('active');
    await page.getByTestId('reward-save').click();
    await expect(page.getByTestId('rewards-definitions')).toContainText('Marathon perk');
    const w = mock.writes(/admin\/reward-definitions$/)[0];
    expect(w.headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(w.body).toMatchObject({ issuerType: 'fitflex', title: { en: 'Marathon perk', sw: 'Faida ya marathoni' }, triggerType: 'achievement', triggerRef: 'marathon_finish', triggerEventId: null, redeemMode: 'perk', capPerUser: 1, fundingNote: 'FitFlex', status: 'active' });
    expect(w.body).not.toHaveProperty('valueTzs');
    expect(await page.locator('main').innerText()).not.toMatch(/\bpoints?\b|\bpointi\b/i);
    await expectNoRawKeys(page);
  });
  test('a medal reward picks the event, then the medal; the funding note is required; a refused value reads in words', async ({ page }) => {
    const mock = await adminDesk(page);
    await page.getByTestId('reward-new').click();
    await page.getByTestId('reward-title-en').fill('Gold perk'); await page.getByTestId('reward-title-sw').fill('Faida ya dhahabu');
    await page.getByTestId('reward-terms-en').fill('Terms'); await page.getByTestId('reward-terms-sw').fill('Masharti');
    await page.getByTestId('reward-trigger').selectOption('medal');
    await page.getByTestId('reward-event').selectOption('evt_pub');
    await page.getByTestId('reward-medal').selectOption('tpl_2');
    await page.getByTestId('reward-funding').fill('');
    await expect(page.getByTestId('reward-save')).toBeDisabled();
    await page.getByTestId('reward-funding').fill('FitFlex');
    mock.on('POST', /^\/admin\/reward-definitions$/, () => ({ status: 422, json: { error: 'value_not_allowed_yet' } }));
    await page.getByTestId('reward-save').click();
    await expect(page.getByTestId('reward-error')).toContainText("Cash and shop value aren't available yet.");
  });
  test('Pause asks first and the status changes', async ({ page }) => {
    const mock = await adminDesk(page);
    await page.getByTestId('reward-pause-rwd_1').click();
    await expect(page.getByRole('alertdialog')).toContainText('No new rewards are earned while it is paused.');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByTestId('rewards-definitions')).toContainText('Paused');
    expect(mock.s6!.defs[0].status).toBe('paused');
  });
  test('redemptions: look up a code, mark it as used once; an unknown code says so', async ({ page }) => {
    const mock = await adminDesk(page, {}, '?tab=redemptions');
    await page.getByTestId('redeem-code').fill('nope');
    await page.getByTestId('redeem-lookup').click();
    await expect(page.getByTestId('redeem-notfound')).toContainText('This code wasn\'t found.');
    await page.getByTestId('redeem-code').fill('ffr-ab12cd34');
    await expect(page.getByTestId('redeem-code')).toHaveValue('FFR-AB12CD34');
    await page.getByTestId('redeem-lookup').click();
    await expect(page.getByTestId('redeem-card')).toContainText('Finisher perk');
    await expect(page.getByTestId('redeem-card')).toContainText('Baraka M.');
    await page.getByTestId('redeem-note').fill('Collected at expo');
    await page.getByTestId('redeem-use').click();
    await expect(page.getByTestId('redeem-card')).toHaveCount(0);
    const w = mock.writes(/reward-redemptions\/red_1\/redeem$/);
    expect(w[0].body).toEqual({ note: 'Collected at expo' });
    expect(w[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(mock.s6!.redemptions[0].status).toBe('redeemed');
    await page.getByTestId('redeem-code').fill('FFR-AB12CD34');
    await page.getByTestId('redeem-lookup').click();
    await expect(page.getByTestId('redeem-card')).toContainText('Used');
    await expect(page.getByTestId('redeem-use')).toHaveCount(0);
  });
  test('ledger: every row says what happened and why, reversals are linked, nothing is a balance or "points"', async ({ page }) => {
    await adminDesk(page, {}, '?tab=ledger');
    const l = page.getByTestId('rewards-ledger');
    await expect(l).toContainText('Earned');
    await expect(l).toContainText('Taken back');
    await expect(l).toContainText('Undoes led_1');
    await expect(l).toContainText('An event result');
    await page.getByTestId('ledger-type').selectOption('reverse');
    await expect(l).not.toContainText('Earned');
    expect(await page.locator('main').innerText()).not.toMatch(/\bpoints?\b|balance/i);
  });
  test('tasks: a failed award task can be retried', async ({ page }) => {
    const mock = await adminDesk(page, {}, '?tab=tasks');
    await expect(page.getByTestId('rewards-tasks')).toContainText('timeout');
    await page.getByTestId('task-retry-tsk_1').click();
    await expect(page.getByTestId('rewards-tasks')).toContainText('No failed tasks.');
    expect(mock.writes(/event-award-tasks\/tsk_1\/retry$/)).toHaveLength(1);
  });
});

test.describe('admin medal art queue (§7.7, AC-G5)', () => {
  test('flag off: no tab and no call', async ({ page }) => {
    const mock = await adminDesk(page, { medalArt: false }, '?tab=medalArt');
    await expect(page.getByTestId('reward-desk')).toBeVisible();
    await expect(page.getByTestId('medal-art-queue')).toHaveCount(0);
    expect(mock.reads(/admin\/medal-art/)).toHaveLength(0);
  });
  test('To review: both previews with alt text, organizer, event, rights confirmation, the 30-day take-down count; Looks fine', async ({ page }) => {
    const mock = await adminDesk(page, {}, '?tab=medalArt');
    const card = page.getByTestId('art-card-art_q1');
    await expect(card).toContainText('Arusha Trail 10K · Dar Runners');
    await expect(card).toContainText('Rights confirmed on');
    await expect(card).toContainText('Review this organizer');
    await expect(card).toContainText('3 take-downs in 30 days');
    await expect(card.locator('img[alt="A green runner"]')).toHaveCount(2);
    await card.getByTestId('art-fine-art_q1').click();
    await expect(page.getByTestId('medal-art-empty')).toContainText('Nothing to review');
    expect(mock.writes(/medal-art\/art_q1\/reviewed$/)[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(mock.s6!.arts[0].reviewState).toBe('reviewed');
  });
  test('Take down needs a reason (a note for "other"), asks again, deletes the file, reverts the medal and records a notice for the organizer', async ({ page }) => {
    const mock = await adminDesk(page, {}, '?tab=medalArt');
    mock.s6!.templates[0].art = { source: 'custom', artId: 'art_q1', revision: 1, artKey: 'finisher_green', altText: null };
    mock.s6!.arts[0].templateId = 'tpl_1';
    await page.getByTestId('art-down-art_q1').click();
    await expect(page.getByTestId('takedown-next')).toBeDisabled();
    await page.getByTestId('takedown-reason').selectOption('other');
    await expect(page.getByTestId('takedown-next')).toBeDisabled();
    await page.getByTestId('takedown-note').fill('Looks like an official FitFlex badge');
    await page.getByTestId('takedown-reason').selectOption('rights');
    await page.getByTestId('takedown-next').click();
    await expect(page.getByRole('alertdialog')).toContainText("This can't be undone");
    await page.getByRole('alertdialog').getByRole('button', { name: 'Take down' }).click();
    await expect(page.getByTestId('medal-art-empty')).toBeVisible();
    const w = mock.writes(/take-down$/)[0];
    expect(w.body).toEqual({ reason: 'rights', note: 'Looks like an official FitFlex badge' });
    expect(mock.s6!.arts[0].status).toBe('taken_down');
    expect(mock.s6!.templates[0].art).toMatchObject({ source: 'builtin', artId: null });
    expect(mock.s6!.notices).toContain('art_takedown:art_q1:rights');
    await page.getByRole('button', { name: 'Taken down' }).click();
    await expect(page.getByTestId('art-card-art_q1')).toContainText('Taken down');
    await expect(page.getByTestId('art-card-art_q1').locator('img')).toHaveCount(0); // bytes are gone, nothing to preview
  });
});

test.describe('admin: results block and exceptions (§6.6, §9.1)', () => {
  test('read-only per-category stage and counts; correct needs a reason and the current revision; DQ too', async ({ page }) => {
    const mock = await setupEvents(page, EVENTS_STAFF, { s6: {} });
    await page.goto('/admin/events/?event=evt_pub&view=results');
    const b = page.getByTestId('admin-event-results');
    await expect(b).toContainText('You can see results here.');
    await expect(page.getByTestId('admin-results-summary')).toContainText('21K Half Marathon');
    await expect(b).toContainText('Amina Mollel');
    expect(await page.locator('main').innerText()).not.toMatch(PRIVATE);
    await page.getByTestId('admin-correct-reg_3').click();
    await page.getByTestId('correct-net').fill('1:50:00');
    await page.getByTestId('correct-reason').selectOption('wrong_bib');
    await page.getByTestId('correct-note').fill('Bib swapped with 104 at the finish');
    await page.getByTestId('correct-confirm').click();
    const w = mock.writes(/admin\/events\/evt_pub\/results\/res_reg_3\/correct$/)[0];
    expect(w.body).toEqual({ expectedRevision: 1, netTime: '1:50:00', reasonCode: 'wrong_bib', note: 'Bib swapped with 104 at the finish' });
    expect(mock.s6!.audit.some(a => a.action === 'events.admin_result_exception')).toBe(true);
    await page.getByTestId('admin-dq-reg_4').click();
    await page.getByTestId('decision-reason').selectOption('equipment');
    await expect(page.getByTestId('decision-confirm')).toBeDisabled(); // an admin exception always carries a note
    await page.getByTestId('decision-note').fill('Used a bike for part of the course');
    await page.getByTestId('decision-confirm').click();
    await expect.poll(() => mock.writes(/admin\/events\/evt_pub\/results\/res_reg_4\/disqualify$/).length).toBe(1);
    expect(mock.writes(/admin\/events\/evt_pub\/results\/res_reg_4\/disqualify$/)[0].body).toEqual({ expectedRevision: 1, reasonCode: 'equipment', note: 'Used a bike for part of the course' });
  });
  test('the Results tab is hidden in the admin event view when results are off', async ({ page }) => {
    await setupEvents(page, EVENTS_STAFF, { s6: { results: false } });
    await page.goto('/admin/events/?event=evt_pub');
    await expect(page.getByTestId('admin-event-detail')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Results', exact: true })).toHaveCount(0);
  });
});

// ── Swahili, layout and string parity ──
test.describe('Swahili, 375 px layout and string parity (AC-X3, AC-X4)', () => {
  const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  test('the Results tab reads in Swahili with no raw keys and no horizontal scroll at 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const mock = await open(page, 'owner', 'overview', {}, 'sw');
    await expect(page.getByTestId('results-view')).toContainText('Matokeo');
    await expect(page.getByTestId('results-stage-cat_1')).toContainText('Haijachapishwa');
    await expect(page.getByTestId('results-steps')).toContainText('2 Kagua');
    await expectNoRawKeys(page);
    expect(await noOverflow(page)).toBe(true);
    for (const sec of ['Pakia', 'Matokeo', 'Maswali', 'Medali', 'Mipangilio']) {
      await page.getByTestId('results-sections').getByRole('button', { name: sec, exact: sec === 'Matokeo' }).first().click();
      await expectNoRawKeys(page);
      expect(await noOverflow(page)).toBe(true);
    }
    await page.getByTestId('results-sections').getByRole('button', { name: 'Medali' }).click();
    await expect(page.getByTestId('medal-rule-tpl_2')).toContainText('Maliza kwenye 1 bora ya kundi');
    await expect(page.getByTestId('medal-sw-missing-tpl_2')).toHaveText('Maandishi ya Kiswahili hayapo; wanachama wataona Kiingereza');
    await page.getByTestId('medal-upload-tpl_1').click();
    await expect(page.getByTestId('art-dialog')).toContainText('Nimetengeneza muundo huu au nina haki ya kuutumia.');
    await page.getByTestId('art-file').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(page.getByTestId('art-error')).toContainText('Faili za SVG hazikubaliwi');
    expect(await noOverflow(page)).toBe(true);
    expect(mock.writes()).toHaveLength(0);
  });
  test('the release dialog, a correction and the admin desk read in Swahili', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page, 'owner', 'overview', {}, 'sw');
    await page.getByTestId('release-off-cat_1').click();
    await expect(page.getByTestId('release-dialog')).toContainText('Matokeo rasmi hayawezi kuondolewa.');
    await expect(page.getByTestId('release-dialog')).toContainText('Andika idadi ya matokeo yanayochapishwa');
    expect(await noOverflow(page)).toBe(true);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await adminDesk(page, {}, '?tab=medalArt', EVENTS_STAFF, 'sw');
    await expect(page.getByTestId('medal-art-queue')).toContainText('Picha za medali');
    await expect(page.getByTestId('art-fine-art_q1')).toHaveText('Inafaa');
    await expectNoRawKeys(page);
    expect(await noOverflow(page)).toBe(true);
  });
  test('every S6 string has a Swahili twin with the same placeholders; every error code and dynamic family has a sentence', async () => {
    const en = eventsS6Messages.en as Record<string, string>; const sw = eventsS6Messages.sw as Record<string, string>;
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    expect(Object.keys(sw).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) { expect(sw[k]?.trim(), k).toBeTruthy(); expect(ph(sw[k]), k).toBe(ph(en[k])); }
    const families: Array<[string, readonly string[]]> = [
      ['organizer.results.reason.', ALL_REASONS],
      ['organizer.results.dispute.reason.', ['time_wrong', 'not_my_result', 'wrong_category', 'missing_split', 'dq_challenge', 'other']], ['organizer.results.dispute.status.', ['open', 'upheld', 'rejected', 'withdrawn']],
      ['organizer.results.flag.', ['implausible_pace', 'many_dropped_points', 'long_gap', 'duplicate_route', 'other']], ['organizer.results.medals.tier.', ['finisher', 'gold', 'silver', 'bronze', 'time', 'other']],
      ['organizer.results.art.builtin.', ['finisher_green', 'finisher_gold', 'podium_gold', 'podium_silver', 'podium_bronze', 'time_blue', 'charity_red', 'virtual_teal']],
      ['organizer.results.art.reason.', ['inappropriate', 'rights', 'other_brand', 'person_request', 'quality', 'other']], ['admin.medalArt.reason.', ['inappropriate', 'rights', 'other_brand', 'person_request', 'quality', 'other']],
      ['organizer.results.problem.', ['bib_invalid', 'not_submitted', 'bib_not_found', 'bib_duplicate_in_file', 'registration_not_confirmed', 'category_mismatch', 'time_missing_for_finisher', 'time_invalid', 'time_out_of_range', 'status_invalid', 'already_official', 'event_not_open_for_results', 'other']],
      ['organizer.results.warn.', ['rank_ignored', 'kit_not_collected', 'over_cutoff', 'time_basis_missing', 'other']], ['organizer.results.stage.', ['none', 'provisional', 'official', 'corrected', 'disputed', 'disqualified', 'rejected']],
      ['organizer.results.status.', ['finished', 'dnf', 'dns', 'dq', 'pending', 'rejected', 'noResult']], ['organizer.results.vstatus.', ['pending_verification', 'verified', 'rejected', 'corrected', 'disqualified']],
      ['organizer.results.source.', ['timing_provider', 'organizer_verified', 'fitflex_gps', 'manual_unverified']], ['organizer.results.section.', ['overview', 'import', 'results', 'disputes', 'medals', 'settings']],
      ['organizer.results.step.', ['import', 'review', 'release', 'medals']], ['organizer.results.import.column.', ['bib', 'registrationId', 'status', 'net_time', 'gun_time', 'category', 'note']],
      ['admin.rewards.trigger.', ['event_finish', 'medal', 'achievement']], ['admin.rewards.redeemMode.', ['certificate', 'perk']], ['admin.rewards.status.', ['draft', 'active', 'paused', 'ended']],
      ['admin.rewards.redemption.', ['reserved', 'redeemed', 'cancelled', 'expired']], ['admin.rewards.ledger.', ['earn', 'redeem', 'expire', 'reverse', 'other']], ['admin.rewards.source.', ['event_medal', 'achievement', 'event_result', 'other']],
      ['admin.rewards.tab.', ['definitions', 'redemptions', 'ledger', 'tasks', 'medalArt']], ['admin.rewards.reversal.', ['revoke_unredeemed', 'revoke_all']],
      ['admin.rewards.achievement.', ['first_event_finish', 'first_10k_finish', 'half_marathon_finish', 'marathon_finish', 'three_events_year']],
      ['organizer.results.art.error.', ['svg_not_allowed', 'unsupported_file_type', 'animated_not_allowed', 'corrupt_image', 'payload_too_large', 'image_too_large', 'image_too_small', 'not_square', 'file_not_allowed', 'rate_limited', 'busy', 'confirmation_outdated', 'no_file_provided', 'raw_body_required']],
    ];
    for (const [prefix, vals] of families) for (const v of vals) expect(en[`${prefix}${v}`], `${prefix}${v}`).toBeTruthy();
    for (const [code, key] of Object.entries(RESULTS_ERRORS)) expect(en[key], `${code} -> ${key}`).toBeTruthy();
    for (const code of ['invalid_request', 'invalid_cursor', 'csv_invalid', 'idempotency_key_required', 'forbidden_role', 'organizer_suspended', 'event_not_found', 'registration_not_found', 'result_not_found', 'not_found', 'idempotency_key_reused', 'request_in_progress', 'preview_stale', 'result_changed', 'already_released', 'template_locked', 'dispute_open', 'dispute_window_closed', 'run_already_linked', 'activity_already_linked', 'already_claimed', 'reward_unavailable', 'not_enough_units', 'organizer_owner', 'payload_too_large', 'validation_failed', 'event_not_open_for_results', 'value_not_allowed_yet', 'source_not_allowed', 'rate_limited', 'unsettled_results', 'import_has_errors', 'no_results', 'no_change', 'nothing_to_withdraw', 'definition_locked', 'definition_ended', 'organizer_can_resolve', 'query_too_short', 'correction_required', 'dispute_closed', 'raw_body_required', 'no_file_provided', 'image_too_large']) {
      expect(RESULTS_ERRORS[code], `spec error code ${code} is mapped`).toBeTruthy();
    }
  });
});

// ── Round 2: the contract check against the real backend (functions#287) ──
test.describe('real backend shapes (contract round)', () => {
  test('the result detail is nested ({ result, revisions, linkedRun, disputes }) and the drawer reads it', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await openDrawer(page, 'reg_3');
    const detail = mock.reads(/results\/reg_3$/)[0];
    expect(detail).toBeTruthy();
    await expect(page.getByTestId('drawer-net')).toHaveText('1:55:03');
    await expect(page.getByTestId('act-correct')).toBeVisible(); // verified rows can be corrected: the status came from result.verificationStatus
    await expect(page.getByTestId('drawer-disputes')).toContainText('My time is wrong');
  });
  test('verifying a disqualification that came in with a file asks for the reason', async ({ page }) => {
    const mock = await open(page, 'owner', 'import');
    await page.getByTestId('import-file').setInputFiles(file(csv(['107,dq,1:00:00,,21K,'])));
    await page.getByTestId('import-check').click();
    await page.getByTestId('import-apply').click();
    expect(mock.writes(/results\/imports$/)[0].body?.fileName).toBe('results.csv');
    await page.getByTestId('import-review').click();
    await page.getByTestId('result-open-reg_7').click();
    await page.getByTestId('act-verify').click();
    await expect(page.getByTestId('verifyDq-dialog')).toBeVisible();
    await expect(page.getByTestId('decision-confirm')).toBeDisabled();
    await page.getByTestId('decision-reason').selectOption('identity');
    await page.getByTestId('decision-confirm').click();
    await expect(page.getByTestId('drawer-live')).toHaveText('Result verified');
    expect(mock.writes(/\/verify$/)[0].body).toEqual({ expectedRevision: 1, reasonCode: 'identity' });
  });
  test('the status filter sends needs_review (the server\'s word), never pending_verification', async ({ page }) => {
    const mock = await open(page, 'owner', 'results');
    await page.getByTestId('results-filter-status').selectOption('needs_review');
    await expect(page.getByTestId('results-table-view')).toContainText('Amina');
    expect(mock.reads(/\/results$/).some(c => c.query.status === 'needs_review')).toBe(true);
    expect(mock.calls.some(c => c.query.status === 'pending_verification')).toBe(false);
  });
  test('a dispute the organizer can still answer: FitFlex\'s organizer_can_resolve is shown in words', async ({ page }) => {
    const mock = await open(page, 'owner', 'disputes');
    await page.getByTestId('dispute-open-dsp_1').click();
    await page.getByTestId('dispute-nochange').click();
    mock.on('POST', /resolve$/, () => ({ status: 409, json: { error: 'organizer_can_resolve' } }));
    await page.getByTestId('dispute-note-input').fill('Chip log confirms');
    await page.getByTestId('dispute-note-confirm').click();
    await expect(page.getByTestId('dispute-note-dialog')).toContainText('The organizer can still answer this question.');
  });
  test('a reward edit sends only what changed (a locked trigger field is never sent); Activate and Pause move the status', async ({ page }) => {
    const mock = await adminDesk(page);
    await page.getByTestId('reward-edit-rwd_1').click();
    await expect(page.getByTestId('reward-status')).toHaveCount(0);
    await page.getByTestId('reward-cap-user').fill('2');
    await page.getByTestId('reward-save').click();
    await expect(page.getByTestId('reward-dialog')).toHaveCount(0);
    const w = mock.writes(/admin\/reward-definitions\/rwd_1$/)[0];
    expect(w.method).toBe('PATCH');
    expect(w.body).toEqual({ capPerUser: 2 });
    await page.getByTestId('reward-pause-rwd_1').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByTestId('rewards-definitions')).toContainText('Paused');
    await page.getByTestId('reward-activate-rwd_1').click();
    await expect(page.getByTestId('rewards-definitions')).toContainText('Active');
    expect(mock.writes(/rwd_1\/activate$/)).toHaveLength(1);
    // The server's definition_locked would be shown in words if a trigger field did travel.
    mock.on('PATCH', /reward-definitions\/rwd_1$/, () => ({ status: 409, json: { error: 'definition_locked' } }));
    await page.getByTestId('reward-edit-rwd_1').click();
    await page.getByTestId('reward-cap-user').fill('3');
    await page.getByTestId('reward-save').click();
    await expect(page.getByTestId('reward-error')).toContainText('already been earned');
  });
  test('a medal-art take-down shows the organizer highlight; the template art block carries no status', async ({ page }) => {
    const mock = await adminDesk(page, {}, '?tab=medalArt');
    await expect(page.getByTestId('art-card-art_q1')).toContainText('3 take-downs in 30 days');
    await expect(page.getByTestId('art-card-art_q1')).toContainText('Review this organizer');
    expect(mock.s6!.arts[0]).not.toHaveProperty('confirmedByName');
  });
});

test.describe('Swahili at 320 px (no overflow)', () => {
  const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  test('results table, medals and the reward desk', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await open(page, 'owner', 'results', {}, 'sw');
    await expect(page.getByTestId('results-table-view')).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await expectNoRawKeys(page);
    await page.getByTestId('result-open-reg_3').click();
    await expect(page.getByTestId('result-drawer')).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.getByTestId('drawer-close').click();
    await page.getByTestId('results-sections').getByRole('button', { name: 'Medali' }).click();
    await expect(page.getByTestId('results-medals')).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.getByTestId('medal-edit-tpl_1').click();
    expect(await noOverflow(page)).toBe(true);
    await page.keyboard.press('Escape');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await adminDesk(page, {}, '', EVENTS_STAFF, 'sw');
    await expect(page.getByTestId('rewards-definitions')).toBeVisible();
    await expect(page.getByTestId('rewards-definitions')).toContainText('Cheti cha aliyemaliza');
    expect(await noOverflow(page)).toBe(true);
    await page.getByTestId('reward-new').click();
    expect(await noOverflow(page)).toBe(true);
    await expectNoRawKeys(page);
  });
  test('the glossary fixes read as agreed', async ({ page }) => {
    await open(page, 'timing', 'import', {}, 'sw');
    await expect(page.getByTestId('results-sections')).toContainText('Maswali');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await adminDesk(page, {}, '', EVENTS_STAFF, 'sw');
    await page.getByTestId('reward-pause-rwd_1').click();
    await expect(page.getByRole('alertdialog')).toContainText('Sitisha');
  });
});
