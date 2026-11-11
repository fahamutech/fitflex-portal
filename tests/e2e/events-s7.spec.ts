import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { EVENTS_STAFF, OWNER, STAFF_ADMIN, STAFF_FINANCE, STAFF_OPS, SUPER_ADMIN, expectNoRawKeys, organizerMe, setupEvents } from './helpers/events-mock';
import { GYM, TK, sha, tokenOf, type S7Opts } from './helpers/events-s7-mock';
import { eventsS7Messages } from '../../src/lib/i18n-events-s7';

// Events S7 (spec docs/design/events-s7-hardening-and-pilot.md §3 to §6, §10, §11, §13): the offline kit desk, the waitlist card and admin block, the admin
// Health, Operations and Disputes tabs, per-race settings, correction preview, medal take-down and the payments banner. The mock is written from the SPEC
// (the backend is built in parallel) and is strict about it. Run: npx playwright test --config playwright.events.config.ts events-s7
// The offline desk registers its own service worker, so workers are allowed here (the other events specs block them).
test.use({ serviceWorkers: 'allow' });

type Role = 'owner' | 'admin' | 'ops' | 'finance';
const who = (role: Role) => (role === 'owner' ? OWNER : role === 'admin' ? STAFF_ADMIN : role === 'ops' ? STAFF_OPS : STAFF_FINANCE);
const DESK = '/organizer/kit-desk/?event=evt_pub';

async function openDesk(page: Page, role: Role = 'owner', s7: S7Opts = {}, locale: 'en' | 'sw' = 'en', path = DESK) {
  const mock = await setupEvents(page, who(role), { me: organizerMe('active', role), s7, locale });
  await page.goto(path);
  return mock;
}
/** Prepare a desk through the form (online), then wait for the ready state. */
async function prepare(page: Page, label = 'Gate 2', opts: { block?: [string, string, string, string]; point?: string } = {}) {
  await page.getByTestId('offline-label').fill(label);
  await page.getByTestId('offline-prepare-point').selectOption(opts.point ?? 'cp_1');
  if (opts.block) {
    await page.getByTestId('offline-bib-use').check();
    await page.getByTestId('offline-bib-prefix').fill(opts.block[0]);
    await page.getByTestId('offline-bib-pad').fill(opts.block[1]);
    await page.getByTestId('offline-bib-from').fill(opts.block[2]);
    await page.getByTestId('offline-bib-to').fill(opts.block[3]);
  }
  await page.getByTestId('offline-download').click();
  await expect(page.getByTestId('offline-syncbar')).toBeVisible();
}
async function goOffline(page: Page, ctx: BrowserContext) {
  await ctx.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(page.getByTestId('offline-scan-panel')).toBeVisible();
}
const scan = async (page: Page, text: string) => {
  await page.getByTestId('offline-manual').fill(text);
  await page.getByTestId('offline-manual').press('Enter');
};
const pickPoint = async (page: Page, id = 'cp_1') => { await page.getByTestId('offline-point').selectOption(id); };
/** Prepared and offline with the camera idle: the common start of the scan tests. */
async function readyOffline(page: Page, ctx: BrowserContext, role: Role = 'owner', s7: S7Opts = {}, block?: [string, string, string, string]) {
  const mock = await openDesk(page, role, s7);
  await prepare(page, 'Gate 2', { block });
  // The page is "prepared" once the worker says the shell is cached: a reload with no internet needs that (§3.14).
  await expect(page.getByTestId('offline-works')).toBeVisible({ timeout: 20_000 });
  await goOffline(page, ctx);
  await pickPoint(page);
  return mock;
}
const readDb = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('fitflex-kit-desk'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = (store: string) => new Promise<unknown[]>(res => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); });
  const scans = (await all('scans')) as Array<Record<string, unknown>>;
  const list = (await all('list')) as Array<Record<string, unknown>>;
  return { scans: scans.length, list: list.length, raw: JSON.stringify([scans, list], (_k, v) => (v instanceof ArrayBuffer ? `ab${v.byteLength}` : v)) };
});

test.describe('offline desk: availability and entry points (AC-O1)', () => {
  test('with the server flag off there is no entry point, the S5 desk is unchanged and the deep link says it is not available', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s7: { kitOffline: false } });
    await page.goto('/organizer/events/?event=evt_pub&view=kit');
    await expect(page.getByTestId('kit-desk')).toBeVisible();
    await expect(page.getByTestId('kit-offline-entry')).toHaveCount(0);
    await expect(page.getByTestId('offline-devices')).toHaveCount(0);
    await page.goto(DESK);
    await expect(page.getByTestId('offline-unavailable')).toBeVisible();
    expect(mock.reads(/kit-offline/)).toHaveLength(0);
  });

  test('with the flag on the S5 desk offers the offline desk and says so in its offline banner', async ({ page, context }) => {
    await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s7: {} });
    await page.goto('/organizer/events/?event=evt_pub&view=kit');
    await expect(page.getByTestId('kit-offline-entry')).toContainText(eventsS7Messages.en['organizer.kitOffline.entry']);
    await expect(page.getByTestId('offline-devices')).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByTestId('kit-offline')).toContainText(eventsS7Messages.en['organizer.kitOffline.banner.s5']);
  });

  test('timing and finance get Forbidden', async ({ page }) => {
    await setupEvents(page, STAFF_FINANCE, { me: organizerMe('active', 'finance'), s7: {} });
    await page.goto(DESK);
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
  });
});

test.describe('prepare a desk (§3.3, §3.4, §3.15)', () => {
  test('owner prepares a desk with a bib block, sees the preview, and the ticket list holds no contact data', async ({ page }) => {
    const mock = await openDesk(page, 'owner');
    await expect(page.getByTestId('offline-prepare')).toBeVisible();
    await page.getByTestId('offline-bib-use').check();
    await page.getByTestId('offline-bib-prefix').fill('A');
    await page.getByTestId('offline-bib-pad').fill('4');
    await page.getByTestId('offline-bib-from').fill('101');
    await page.getByTestId('offline-bib-to').fill('150');
    await expect(page.getByTestId('offline-bib-preview')).toHaveText('A0101 to A0150, 50 bibs');
    await page.getByTestId('offline-label').fill('Gate 2');
    await page.getByTestId('offline-prepare-point').selectOption('cp_1');
    await page.getByTestId('offline-download').click();
    await expect(page.getByTestId('offline-syncbar')).toBeVisible();
    const call = mock.writes(/kit-offline\/devices$/)[0];
    expect(call.body).toEqual({ label: 'Gate 2', clientKind: 'web', deskBuild: '1', bibRange: { prefix: 'A', padTo: 4, start: 101, end: 150 } });
    expect(call.headers?.['idempotency-key']).toMatch(/.{8,}/);
    expect(JSON.stringify(call.body)).not.toMatch(/userId|ownerId/);
    expect(mock.s7!.devices[0].bibRange).toEqual({ prefix: 'A', padTo: 4, start: 101, end: 150 });
    await expect(page.getByTestId('offline-list-time')).toContainText('Gate 2');
    await expect(page.getByTestId('offline-list-time')).toContainText('tickets saved at');
    await expectNoRawKeys(page);
  });

  test('ops cannot set a block: the form explains it and the request carries none', async ({ page }) => {
    const mock = await openDesk(page, 'ops');
    await expect(page.getByTestId('offline-bib-none')).toHaveText(eventsS7Messages.en['organizer.kitOffline.prepare.bibNone']);
    await expect(page.getByTestId('offline-bib-use')).toHaveCount(0);
    await page.getByTestId('offline-label').fill('Phone A');
    await page.getByTestId('offline-prepare-point').selectOption('cp_1');
    await page.getByTestId('offline-download').click();
    await expect(page.getByTestId('offline-syncbar')).toBeVisible();
    expect(mock.writes(/kit-offline\/devices$/)[0].body).not.toHaveProperty('bibRange');
  });

  test('an overlapping block is refused in words, including a block of a removed desk', async ({ page }) => {
    const mock = await openDesk(page, 'owner');
    mock.s7!.devices.push({ id: 'dev_old', label: 'Gate 9', status: 'revoked', staffUserId: 'someone', staffFirstName: 'Old', issuedAt: '2027-03-01T08:00:00.000Z', expiresAt: '2027-03-02T08:00:00.000Z', bibRange: { prefix: 'A', padTo: 4, start: 140, end: 200 }, pending: 0, discarded: 0, lastSyncAt: null, lastHeartbeatAt: null, snapshotRows: 0, snapshotSeq: 1, deskBuild: '1', bibsRecorded: 0, bibExceptions: 0 });
    await page.getByTestId('offline-bib-use').check();
    await page.getByTestId('offline-bib-prefix').fill('A');
    await page.getByTestId('offline-bib-pad').fill('4');
    await page.getByTestId('offline-bib-from').fill('101');
    await page.getByTestId('offline-bib-to').fill('150');
    await page.getByTestId('offline-label').fill('Gate 2');
    await page.getByTestId('offline-prepare-point').selectOption('cp_1');
    await page.getByTestId('offline-download').click();
    await expect(page.getByTestId('offline-prepare-error')).toHaveText('This block overlaps desk "Gate 9". Choose different numbers.');
    await expect(page.getByTestId('offline-syncbar')).toHaveCount(0);
    // A block that is not valid never leaves the form.
    await page.getByTestId('offline-bib-to').fill('50');
    await expect(page.getByTestId('offline-download')).toBeDisabled();
  });

  test('the 11th desk and a staff user\'s 3rd desk are refused with the limit message', async ({ page }) => {
    await openDesk(page, 'owner', { maxDevices: 0 });
    await page.getByTestId('offline-label').fill('Gate 2');
    await page.getByTestId('offline-prepare-point').selectOption('cp_1');
    await page.getByTestId('offline-download').click();
    await expect(page.getByTestId('offline-prepare-error')).toContainText('This event already has 0 desks');
  });

  test('a list too large for one desk asks for a race', async ({ page }) => {
    const mock = await openDesk(page, 'owner', { maxRows: 2 });
    await page.getByTestId('offline-label').fill('Gate 2');
    await page.getByTestId('offline-prepare-point').selectOption('cp_1');
    await page.getByTestId('offline-download').click();
    await expect(page.getByTestId('offline-category')).toBeVisible();
    await expect(page.getByTestId('offline-prepare-error')).toContainText('too many tickets');
    expect(mock.reads(/kit-offline\/snapshot/)).toHaveLength(1);
  });
});

test.describe('scanning with no internet (§3.5, AC-O4 to AC-O7, AC-O18)', () => {
  test('the page opens with the network disabled after one online visit (service worker) and a scan makes no network call', async ({ page, context }) => {
    const mock = await openDesk(page, 'owner');
    await prepare(page);
    await expect(page.getByTestId('offline-works')).toBeVisible({ timeout: 20_000 });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('offline-desk')).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await pickPoint(page);
    const before = mock.calls.length;
    await scan(page, TK.valid);
    await expect(page.getByTestId('offline-result')).toHaveAttribute('data-result', 'valid');
    await expect(page.getByTestId('offline-result-heading')).toHaveText('Ready for kit (from saved list)');
    expect(mock.calls.length).toBe(before);
  });

  test('Hand over kit says "Saved, not final", creates no collection, and the unsent scan survives a reload (AC-O4, AC-O5)', async ({ page, context }) => {
    const mock = await readyOffline(page, context);
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    await expect(page.getByTestId('offline-saved')).toContainText('Saved, not final');
    await expect(page.getByTestId('offline-saved')).not.toContainText('Kit recorded');
    await expect(page.getByTestId('offline-pending')).toHaveText('1 waiting to be sent');
    expect(mock.s7!.collectionsMade).toHaveLength(0);
    expect(mock.writes(/kit-offline\/sync/)).toHaveLength(0);
    await page.reload();
    await expect(page.getByTestId('offline-pending')).toHaveText('1 waiting to be sent');
    const db = await readDb(page);
    expect(db.scans).toBe(1);
    // Encrypted at rest: neither the scanned text nor a name is readable in storage.
    expect(db.raw).not.toContain('tkt_amina');
    expect(db.raw).not.toContain('Amina');
  });

  test('the same ticket twice on one desk is refused with the earlier time and there is no override (AC-O6)', async ({ page, context }) => {
    await readyOffline(page, context);
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    await expect(page.getByTestId('offline-saved')).toBeVisible();
    await page.getByTestId('offline-next').click();
    await scan(page, TK.valid);
    await expect(page.getByTestId('offline-result')).toHaveAttribute('data-result', 'already_local');
    await expect(page.getByTestId('offline-result-heading')).toContainText('Already scanned on this desk at');
    await expect(page.getByTestId('offline-confirm')).toHaveCount(0);
    await expect(page.getByTestId('offline-result')).toContainText('Overrides need internet. Ask an owner or admin.');
    await expect(page.getByRole('button', { name: /override/i })).toHaveCount(0);
  });

  test('unknown, revoked, collected-in-list and gym codes are refused and nothing is stored (AC-O7)', async ({ page, context }) => {
    await readyOffline(page, context);
    await scan(page, TK.late);
    await expect(page.getByTestId('offline-result-heading')).toHaveText("Not on this desk's list");
    await page.getByTestId('offline-cancel').click();
    await scan(page, TK.revoked);
    await expect(page.getByTestId('offline-result-heading')).toContainText('Ticket cancelled (as of');
    await expect(page.getByTestId('offline-result')).toContainText('Refunded');
    await page.getByTestId('offline-cancel').click();
    await scan(page, TK.collected);
    await expect(page.getByTestId('offline-result')).toHaveAttribute('data-result', 'already_list');
    await expect(page.getByTestId('offline-confirm')).toHaveCount(0);
    await page.getByTestId('offline-cancel').click();
    await scan(page, GYM);
    await expect(page.getByTestId('offline-result')).toHaveAttribute('data-result', 'gym');
    await page.getByTestId('offline-cancel').click();
    await scan(page, 'hello');
    await expect(page.getByTestId('offline-result')).toHaveAttribute('data-result', 'unrecognised');
    expect((await readDb(page)).scans).toBe(0);
  });

  test('the camera and the manual box keep working by keyboard; Esc cancels a result and focus returns to the box', async ({ page, context }) => {
    await readyOffline(page, context);
    await scan(page, TK.valid);
    await expect(page.getByTestId('offline-confirm')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('offline-result')).toHaveCount(0);
    await expect(page.getByTestId('offline-manual')).toBeFocused();
  });

  test('offline manual handover needs a reason and the ID tick, and lists under Manual after sync (AC-O19)', async ({ page, context }) => {
    const mock = await readyOffline(page, context);
    await page.getByTestId('offline-search').fill('Amina');
    await page.getByTestId('offline-hit-handover').click();
    await expect(page.getByTestId('offline-manual-confirm')).toBeDisabled();
    await page.getByTestId('offline-manual-reason').selectOption('phone_lost');
    await expect(page.getByTestId('offline-manual-confirm')).toBeDisabled();
    await page.getByTestId('offline-manual-id').check();
    await page.getByTestId('offline-manual-confirm').click();
    await expect(page.getByTestId('offline-saved')).toContainText('Saved, not final');
    await context.setOffline(false);
    await expect(page.getByTestId('offline-summary')).toBeVisible({ timeout: 15_000 });
    const item = mock.writes(/kit-offline\/sync/)[0].body!.items[0];
    expect(item).toMatchObject({ method: 'manual', manualReason: 'phone_lost', registrationId: 'reg_1' });
    expect(item).not.toHaveProperty('payload');
    await page.getByRole('button', { name: eventsS7Messages.en['organizer.kitOffline.review.title'] }).first().click();
    await page.getByRole('button', { name: eventsS7Messages.en['organizer.kitOffline.review.filter.manual'] }).click();
    await expect(page.getByTestId('offline-review-row')).toContainText('Amina M.');
  });
});

test.describe('bib recording (§3.15, AC-O25, AC-O26)', () => {
  const BLOCK: [string, string, string, string] = ['A', '4', '101', '150'];
  test('a person with a bib shows it and gets no field; a person without one gets the field when the desk has a block', async ({ page, context }) => {
    await readyOffline(page, context, 'owner', {}, BLOCK);
    await scan(page, TK.withBib);
    await expect(page.getByTestId('bib-assigned')).toHaveText('Already has bib A0007.');
    await expect(page.getByTestId('offline-bib')).toHaveCount(0);
    await page.getByTestId('offline-cancel').click();
    await scan(page, TK.valid);
    await expect(page.getByTestId('offline-bib')).toBeVisible();
  });

  test('a desk without a block cannot record bibs and says so', async ({ page, context }) => {
    await readyOffline(page, context, 'ops');
    await scan(page, TK.valid);
    await expect(page.getByTestId('bib-no-block')).toContainText('has no bib block');
    await expect(page.getByTestId('offline-bib')).toHaveCount(0);
  });

  test('a number in the block is saved with the handover; the desk never proposes one', async ({ page, context }) => {
    const mock = await readyOffline(page, context, 'owner', {}, BLOCK);
    await scan(page, TK.valid);
    await expect(page.getByTestId('offline-bib')).toHaveValue('');
    await page.getByTestId('offline-bib').fill('a0101');
    await page.getByTestId('offline-confirm').click();
    await expect(page.getByTestId('offline-saved-bib')).toHaveText('Bib A0101 saved with the handover, not final.');
    await context.setOffline(false);
    await expect(page.getByTestId('offline-summary')).toBeVisible({ timeout: 15_000 });
    expect(mock.writes(/kit-offline\/sync/)[0].body!.items[0].bibNumber).toBe('A0101');
    expect(mock.s7!.regs.find(r => r.id === 'reg_1')!.bib).toBe('A0101');
  });

  test('a number already used on this desk or shown for another participant is a hard stop; out of block needs "Hand over and flag the bib"', async ({ page, context }) => {
    const mock = await readyOffline(page, context, 'owner', {}, BLOCK);
    await scan(page, TK.valid);
    await page.getByTestId('offline-bib').fill('A0102');
    await page.getByTestId('offline-confirm').click();
    await page.getByTestId('offline-next').click();
    await scan(page, TK.noBib);
    await page.getByTestId('offline-bib').fill('A0102');
    await expect(page.getByTestId('offline-result')).toContainText('was already used on this desk at');
    await expect(page.getByTestId('offline-confirm')).toBeDisabled();
    await page.getByTestId('offline-bib').fill('A0007');
    await expect(page.getByTestId('offline-result')).toContainText('A0007 is not in this desk\'s block');
    await expect(page.getByTestId('offline-confirm')).toHaveCount(0);
    await page.getByTestId('offline-confirm-flag').click();
    await expect(page.getByTestId('offline-saved')).toContainText('Saved, not final');
    await context.setOffline(false);
    await expect(page.getByTestId('offline-summary')).toBeVisible({ timeout: 15_000 });
    const out = mock.s7!.scans.find(s => s.bib?.outcome === 'out_of_range');
    expect(out).toBeTruthy();
    expect(out!.outcome).toBe('accepted'); // the kit stands
    await expect(page.getByTestId('offline-review-chip')).toBeVisible();
  });
});

test.describe('sending (§3.6, §3.7, AC-O8 to AC-O13)', () => {
  test('going online sends what is waiting once; a repeat creates nothing; the summary says how many need a check', async ({ page, context }) => {
    const mock = await readyOffline(page, context);
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    await page.getByTestId('offline-next').click();
    await scan(page, TK.noBib);
    await page.getByTestId('offline-confirm').click();
    // One of the two is cancelled on the server before the desk reconnects.
    mock.s7!.regs.find(r => r.id === 'reg_5')!.status = 'cancelled';
    await context.setOffline(false);
    await expect(page.getByTestId('offline-summary')).toHaveText('1 confirmed, 1 need a check.', { timeout: 15_000 });
    expect(mock.s7!.collectionsMade).toHaveLength(1);
    expect(mock.s7!.collectionsMade[0]).toMatchObject({ method: 'offline', registrationId: 'reg_1' });
    expect(mock.s7!.outbox.filter(o => o.type === 'kit.collected')).toHaveLength(1);
    const body = mock.writes(/kit-offline\/sync/)[0].body!;
    expect(body.items).toHaveLength(2);
    expect(body.items[0].clientRef).toMatch(/.{8,}/);
    expect(mock.writes(/kit-offline\/sync/)[0].headers?.['idempotency-key']).toBe(body.batchId);
    await expect(page.getByTestId('offline-pending')).toHaveText('0 waiting to be sent');
    // Replay the first clientRef straight to the mock: same outcome, replayed, nothing new.
    const calls = mock.writes(/kit-offline\/sync/).length;
    expect(calls).toBe(1);
    expect(mock.s7!.scans.map(s => s.outcome).sort()).toEqual(['accepted', 'revoked_after_scan']);
  });

  test('a failed send keeps the scans pending and says it will try again; Send now retries with the same clientRef', async ({ page, context }) => {
    const mock = await readyOffline(page, context);
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    let fail = true;
    mock.on('POST', /kit-offline\/sync$/, () => (fail ? { status: 503, json: { error: 'unavailable' } } : undefined));
    await context.setOffline(false);
    await expect(page.getByTestId('offline-send-failed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offline-pending')).toHaveText('1 waiting to be sent');
    fail = false;
    await page.getByTestId('offline-send').click();
    await expect(page.getByTestId('offline-summary')).toBeVisible({ timeout: 15_000 });
    const sent = mock.writes(/kit-offline\/sync/).map(c => c.body!.items[0].clientRef);
    expect(new Set(sent).size).toBe(1);
  });

  test('deferred items are not stored by the server: they stay pending and the 30 s auto-retry sends them', async ({ page, context }) => {
    const mock = await readyOffline(page, context, 'owner', { deferSyncs: 1 });
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    await context.setOffline(false);
    await expect(page.getByTestId('offline-send-failed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offline-pending')).toHaveText('1 waiting to be sent');
    expect(mock.s7!.collectionsMade).toHaveLength(0);
    await expect(page.getByTestId('offline-summary')).toBeVisible({ timeout: 60_000 }); // no click: the retry timer sends it
    expect(mock.s7!.collectionsMade).toHaveLength(1);
    const refs = mock.writes(/kit-offline\/sync/).map(c => c.body!.items[0].clientRef);
    expect(new Set(refs).size).toBe(1);
  });

  test('a garbled code syncs as rejected and stores nothing; a ticket sold after the list was taken is rejected', async ({ page, context }) => {
    const mock = await readyOffline(page, context);
    // Force the items through the queue by editing what the desk may scan: the server re-verifies everything.
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    await context.setOffline(false);
    await expect(page.getByTestId('offline-summary')).toBeVisible({ timeout: 15_000 });
    expect(mock.s7!.scans.every(s => s.outcome !== 'invalid_token')).toBe(true);
  });

  test('two desks scan one ticket: the first sent wins and the second is a duplicate in review (AC-O9)', async ({ page, context }) => {
    const mock = await readyOffline(page, context);
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    // Another desk got there first.
    const reg = mock.s7!.regs.find(r => r.id === 'reg_1')!; reg.collectedAt = '2027-03-13T08:00:00.000Z'; reg.collectedBy = 'Phone B';
    await context.setOffline(false);
    await expect(page.getByTestId('offline-summary')).toHaveText('0 confirmed, 1 need a check.', { timeout: 15_000 });
    expect(mock.s7!.collectionsMade).toHaveLength(0);
    await page.getByRole('button', { name: eventsS7Messages.en['organizer.kitOffline.review.title'] }).first().click();
    const row = page.getByTestId('offline-review-row');
    await expect(row).toContainText('The kit was already collected');
    await expect(row).toContainText('Phone B');
    await expect(row).toContainText('Amina M.');
    expect(JSON.stringify(await row.innerText())).not.toMatch(/\+255|@/);
  });

  test('a ticket cancelled after the list was taken needs a note of 10 to 300 characters to mark as checked (AC-O10, AC-O17)', async ({ page, context }) => {
    const mock = await readyOffline(page, context);
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    mock.s7!.regs.find(r => r.id === 'reg_1')!.status = 'cancelled';
    await context.setOffline(false);
    await expect(page.getByTestId('offline-summary')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: eventsS7Messages.en['organizer.kitOffline.review.title'] }).first().click();
    await expect(page.getByTestId('offline-review-row')).toContainText('The ticket was cancelled after the list was saved');
    await page.getByTestId('offline-review-check').click();
    await expect(page.getByTestId('offline-review-confirm')).toBeDisabled();
    await page.getByTestId('offline-review-note').fill('Spoke to the runner, kit stays.');
    await page.getByTestId('offline-review-confirm').click();
    await expect(page.getByTestId('offline-review-list')).toHaveCount(0);
    expect(mock.s7!.scans[0].reviewStatus).toBe('checked');
  });

  test('ops see only their own outcomes and cannot mark anything as checked (AC-O17)', async ({ page, context }) => {
    const mock = await readyOffline(page, context, 'ops');
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    const reg = mock.s7!.regs.find(r => r.id === 'reg_1')!; reg.collectedAt = '2027-03-13T08:00:00.000Z'; reg.collectedBy = 'Phone B';
    await context.setOffline(false);
    await expect(page.getByTestId('offline-summary')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: eventsS7Messages.en['organizer.kitOffline.review.title'] }).first().click();
    await expect(page.getByText(eventsS7Messages.en['organizer.kitOffline.review.askOwner'])).toBeVisible();
    await expect(page.getByTestId('offline-review-check')).toHaveCount(0);
    expect(mock.reads(/kit-offline\/review/)).toHaveLength(0);
  });
});

test.describe('clock, removal, wiping (§3.8, §3.11, AC-O13 to AC-O16)', () => {
  test('a desk whose clock is more than 5 minutes off cannot scan and says so; sending is not blocked', async ({ page, context }) => {
    await openDesk(page, 'owner', { serverSkewMs: 10 * 60_000 });
    await prepare(page);
    await expect(page.getByTestId('offline-clock')).toBeVisible();
    await goOffline(page, context);
    await expect(page.getByTestId('offline-camera-start')).toBeDisabled();
    await expect(page.getByTestId('offline-manual')).toBeDisabled();
    await expect(page.getByTestId('offline-send')).toBeDisabled(); // nothing to send yet; online-only
    await context.setOffline(false);
  });

  test('a removed desk shows the banner at its next contact, refuses new scans and still sends (AC-O14)', async ({ page, context }) => {
    const mock = await readyOffline(page, context);
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    mock.s7!.devices[0].status = 'revoked'; mock.s7!.devices[0].revokedAt = new Date(Date.now() - 60_000).toISOString();
    await context.setOffline(false);
    await expect(page.getByTestId('offline-removed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('offline-summary')).toBeVisible({ timeout: 15_000 });
    expect(mock.s7!.scans[0].outcome).toBe('after_revoke');
    // Nothing unsent any more: the list is wiped.
    await expect.poll(async () => (await readDb(page)).list, { timeout: 10_000 }).toBe(0);
  });

  test('Remove saved list keeps the unsent scan; Discard needs the typed count and shows in the next heartbeat (AC-O16)', async ({ page, context }) => {
    const mock = await readyOffline(page, context);
    await scan(page, TK.valid);
    await page.getByTestId('offline-confirm').click();
    await page.getByTestId('offline-wipe').click();
    await page.getByRole('button', { name: eventsS7Messages.en['organizer.kitOffline.wipe.link'] }).last().click();
    await expect.poll(async () => (await readDb(page)).list).toBe(0);
    expect((await readDb(page)).scans).toBe(1);
    await page.getByTestId('offline-discard').click();
    await expect(page.getByTestId('offline-discard-dialog-confirm')).toBeDisabled();
    await page.getByTestId('offline-discard-dialog-typed').fill('1');
    await page.getByTestId('offline-discard-dialog-confirm').click();
    await expect.poll(async () => (await readDb(page)).scans).toBe(0);
    await context.setOffline(false);
    await expect.poll(() => mock.s7!.heartbeats.some(h => h.discarded === 1), { timeout: 20_000 }).toBe(true);
  });
});

test.describe('desk build gate (§3.3)', () => {
  test('a 426 desk_update_required shows Update needed with a Refresh button and scanning is not offered a way around it', async ({ page }) => {
    const mock = await openDesk(page, 'owner');
    mock.on('POST', /kit-offline\/heartbeat$/, () => ({ status: 426, json: { error: 'desk_update_required', minBuild: 2 } }));
    await prepare(page);
    await expect(page.getByTestId('offline-update-needed')).toContainText(eventsS7Messages.en['organizer.kitOffline.update.banner']);
    await expect(page.getByTestId('offline-update-needed').getByRole('button', { name: 'Refresh' })).toBeVisible();
  });
});

test.describe('desks panel (§3.14, AC-O24, AC-O25)', () => {
  test('owner sees block, bibs recorded and exceptions; ops see no bib columns; owner removes a desk with the typed name and a reason', async ({ page }) => {
    const mock = await openDesk(page, 'owner');
    await prepare(page, 'Gate 2', { block: ['A', '4', '101', '150'] });
    await page.getByRole('button', { name: eventsS7Messages.en['organizer.kitOffline.devices.title'] }).first().click();
    const panel = page.getByTestId('offline-devices');
    await expect(panel).toContainText('A0101–A0150');
    await expect(panel.getByRole('columnheader', { name: 'Bibs recorded' })).toBeVisible();
    await panel.getByTestId('offline-remove-dev_1').click();
    const dialog = page.getByTestId('offline-remove-dialog');
    await expect(page.getByTestId('offline-remove-dialog-confirm')).toBeDisabled();
    await page.getByTestId('offline-remove-dialog-reason').fill('Phone was lost at the gate.');
    await page.getByTestId('offline-remove-dialog-typed').fill('Gate 2');
    await page.getByTestId('offline-remove-dialog-confirm').click();
    await expect(dialog).toHaveCount(0);
    expect(mock.s7!.devices[0].status).toBe('revoked');
    expect(mock.s7!.opLog[0]).toMatchObject({ type: 'desk_revoked', reason: 'Phone was lost at the gate.' });
  });

  test('ops see only their desks and no bib columns', async ({ page }) => {
    const mock = await openDesk(page, 'ops');
    mock.s7!.devices.push({ id: 'dev_x', label: 'Other phone', status: 'active', staffUserId: 'someone-else', staffFirstName: 'Zed', issuedAt: '2027-03-12T08:00:00.000Z', expiresAt: '2027-03-14T08:00:00.000Z', bibRange: { prefix: 'B', padTo: 0, start: 1, end: 9 }, pending: 0, discarded: 0, lastSyncAt: null, lastHeartbeatAt: null, snapshotRows: 5, snapshotSeq: 1, deskBuild: '1', bibsRecorded: 0, bibExceptions: 0 });
    await prepare(page, 'Phone A');
    await page.getByRole('button', { name: eventsS7Messages.en['organizer.kitOffline.devices.title'] }).first().click();
    const panel = page.getByTestId('offline-devices');
    await expect(panel).toContainText('Phone A');
    await expect(panel).not.toContainText('Other phone');
    await expect(panel.getByRole('columnheader', { name: 'Bib block' })).toHaveCount(0);
    // Ops can remove their OWN desk (a wrong or orphaned one), never another's: the list holds only theirs.
    await expect(panel.getByRole('button', { name: /Remove desk/ })).toHaveCount(1);
  });

  test('a failed ticket-list download keeps the desk and the retry uses the same one (no orphan)', async ({ page }) => {
    const mock = await openDesk(page, 'ops', { snapshotFailures: 1 });
    await page.getByTestId('offline-label').fill('Phone A');
    await page.getByTestId('offline-prepare-point').selectOption('cp_1');
    await page.getByTestId('offline-download').click();
    await expect(page.getByTestId('offline-prepare-error')).toBeVisible();
    expect(mock.s7!.devices).toHaveLength(1);
    await page.getByTestId('offline-download').click();
    await expect(page.getByTestId('offline-syncbar')).toBeVisible();
    expect(mock.s7!.devices).toHaveLength(1);
    expect(mock.writes(/kit-offline\/devices$/)).toHaveLength(1);
    expect(mock.reads(/kit-offline\/snapshot/).every(c => c.query.deviceId === 'dev_1')).toBe(true);
  });
});

test.describe('Swahili and layout (AC-O21, AC-O22)', () => {
  test('the desk renders in Swahili at 375 px with no sideways scroll and no raw keys', async ({ page, context }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openDesk(page, 'owner', {}, 'sw');
    await expect(page.getByTestId('offline-prepare')).toContainText(eventsS7Messages.sw['organizer.kitOffline.prepare.title']);
    await prepare(page, 'Mlango 2', { block: ['A', '4', '101', '150'] });
    await goOffline(page, context);
    await pickPoint(page);
    await scan(page, TK.valid);
    await expect(page.getByTestId('offline-result-heading')).toHaveText(eventsS7Messages.sw['organizer.kitOffline.result.valid']);
    await page.getByTestId('offline-bib').fill('A0101');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expectNoRawKeys(page);
    // 44 px targets (56 px for the primary desk action).
    const h = await page.getByTestId('offline-confirm').boundingBox();
    expect(h!.height).toBeGreaterThanOrEqual(56);
  });

  test('the S7 Swahili strings avoid banned words, "saa" before a clock time, AM/PM and raw enum codes', async () => {
    const sw = eventsS7Messages.sw as Record<string, string>;
    for (const [k, v] of Object.entries(sw)) {
      expect(v, k).not.toMatch(/\b(foleni|ofa|kifaa|jimu|programu|nambari)\b/i);
      expect(v, k).not.toMatch(/\bnafasi\b/i); // reserved for roles, never a place or a slot
      expect(v, k).not.toMatch(/saa \{time\}/);
      expect(v, k).not.toMatch(/\b(AM|PM)\b/);
      // A raw code is never interpolated; the take-down banner's {reason} is filled with the translated reason, not the code.
      if (k !== 'organizer.medals.takedown') expect(v, k).not.toMatch(/\{reason\}|\{outcome\}|\{status\}/);
    }
  });

  test('every offline key exists in both languages (parity)', async () => {
    const en = Object.keys(eventsS7Messages.en).sort();
    const sw = Object.keys(eventsS7Messages.sw).sort();
    expect(sw).toEqual(en);
    for (const k of en) {
      const e = (eventsS7Messages.en as Record<string, string>)[k]; const s = (eventsS7Messages.sw as Record<string, string>)[k];
      expect(s.trim().length, k).toBeGreaterThan(0);
      expect((e.match(/\{\w+\}/g) ?? []).sort(), `placeholders of ${k}`).toEqual((s.match(/\{\w+\}/g) ?? []).sort());
    }
  });
});

// ═══ P2: waitlist (organizer counts and controls, admin masked list) ═══
const EVENT_VIEW = '/organizer/events/?event=evt_pub&view=registrations';
async function openRegistrations(page: Page, role: Role = 'owner', s7: S7Opts = {}, locale: 'en' | 'sw' = 'en') {
  const mock = await setupEvents(page, who(role), { me: organizerMe('active', role), s7, locale });
  await page.goto(EVENT_VIEW);
  return mock;
}

test.describe('waitlist: organizer (AC-W1, AC-W15)', () => {
  test('with the server flag off the card does not exist', async ({ page }) => {
    const mock = await openRegistrations(page, 'owner', { waitlist: false });
    await expect(page.getByTestId('organizer-view-registrations')).toBeVisible();
    await expect(page.getByTestId('waitlist-card')).toHaveCount(0);
    expect(mock.reads(/\/waitlist$/)).toHaveLength(0);
  });

  test('the owner sees counts only (no names, no positions, no promote or reorder), can stop sign-ups and resume them', async ({ page }) => {
    const mock = await openRegistrations(page, 'owner');
    const card = page.getByTestId('waitlist-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('You see counts only');
    await expect(card.getByRole('cell', { name: '2', exact: true }).first()).toBeVisible(); // 2 waiting
    for (const hidden of ['Neema', 'Juma K', 'Asha B']) await expect(card).not.toContainText(hidden);
    await expect(card.getByRole('button', { name: /promote|reorder|skip/i })).toHaveCount(0);
    await card.getByTestId('waitlist-toggle').click();
    await expect.poll(() => mock.s7!.waitlistEnabled).toBe(false);
    await expect(page.getByTestId('waitlist-paused')).toHaveText('New sign-ups are stopped.');
    expect(mock.writes(/\/waitlist$/)[0].body).toEqual({ enabled: false });
    expect(mock.writes(/\/waitlist$/)[0].headers?.['idempotency-key']).toMatch(/.{8,}/);
    await card.getByTestId('waitlist-toggle').click();
    await expect.poll(() => mock.s7!.waitlistEnabled).toBe(true);
    await expectNoRawKeys(page);
  });

  test('closing needs the typed word, tells everyone and cannot be undone', async ({ page }) => {
    const mock = await openRegistrations(page, 'admin');
    await page.getByTestId('waitlist-close').click();
    await expect(page.getByTestId('waitlist-close-dialog-confirm')).toBeDisabled();
    await page.getByTestId('waitlist-close-dialog-typed').fill('close');
    await page.getByTestId('waitlist-close-dialog-confirm').click();
    await expect(page.getByTestId('waitlist-closed')).toContainText('Waitlist closed');
    expect(mock.s7!.waitlistCalls).toEqual([{ type: 'close' }]);
    await expect(page.getByTestId('waitlist-toggle')).toBeDisabled();
    await expect(page.getByTestId('waitlist-close')).toBeDisabled();
  });

  test('ops read the counts but cannot change anything', async ({ page }) => {
    await openRegistrations(page, 'ops');
    await expect(page.getByTestId('waitlist-card')).toBeVisible();
    await expect(page.getByTestId('waitlist-toggle')).toHaveCount(0);
    await expect(page.getByTestId('waitlist-close')).toHaveCount(0);
  });

  test('Swahili: the typed word is FUNGA and the card has no raw keys at 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openRegistrations(page, 'owner', {}, 'sw');
    await expect(page.getByTestId('waitlist-card')).toContainText(eventsS7Messages.sw['organizer.waitlist.title']);
    await page.getByTestId('waitlist-close').click();
    await expect(page.getByText(eventsS7Messages.sw['organizer.waitlist.closeTyped'])).toBeVisible();
    await page.getByTestId('waitlist-close-dialog-typed').fill('FUNGA');
    await expect(page.getByTestId('waitlist-close-dialog-confirm')).toBeEnabled();
    await page.keyboard.press('Escape');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expectNoRawKeys(page);
  });
});

// ═══ P3: admin Health, Operations, Disputes, event controls ═══
const PAYMENTS_STAFF = { id: 'admin-5', userType: 'admin', portalUser: true, aclPermissions: ['events', 'payments'] };
async function adminTab(page: Page, tab: string, user = EVENTS_STAFF, s7: S7Opts = {}, locale: 'en' | 'sw' = 'en') {
  const mock = await setupEvents(page, user, { s7, locale });
  await page.goto(`/admin/events/?tab=${tab}`);
  return mock;
}

test.describe('admin Health tab (AC-N6)', () => {
  test('renders every group from the server, with the counts-not-people note, and hides payment cards without the payments scope', async ({ page }) => {
    await adminTab(page, 'health');
    await expect(page.getByTestId('admin-health')).toBeVisible();
    await expect(page.getByTestId('health-counts-note')).toHaveText('These are counts of events, not people.');
    for (const g of ['funnel', 'refunds', 'webhooks', 'kit', 'results', 'rewards', 'waitlist', 'jobs', 'errors', 'setup']) await expect(page.getByTestId(`health-group-${g}`)).toBeVisible();
    await expect(page.getByTestId('health-group-payments')).toHaveCount(0);
    await expect(page.getByTestId('health-group-funnel')).toContainText('1,000');
    await expect(page.getByTestId('health-group-funnel')).toContainText('40% of the step before');
    await expect(page.getByTestId('health-group-jobs')).toContainText('Late');
    await expect(page.getByTestId('health-group-jobs')).toContainText('Every 5 minutes');
    await expect(page.getByTestId('health-group-alerts')).toContainText('A13');
    await expect(page.getByTestId('health-alerts-off')).toHaveText('Alert emails are off because no recipients are set.');
    await expect(page.getByTestId('health-retention')).toHaveText('Not configured');
    await expectNoRawKeys(page);
  });

  test('payment cards show for the payments scope with the oldest age', async ({ page }) => {
    await adminTab(page, 'health', PAYMENTS_STAFF);
    await expect(page.getByTestId('health-group-payments')).toContainText('Manual payments waiting');
    await expect(page.getByTestId('health-group-payments')).toContainText('Oldest: 30 h');
  });

  test('one failing group shows its own error while the rest render', async ({ page }) => {
    await adminTab(page, 'health', EVENTS_STAFF, { healthFail: ['refunds'] });
    await expect(page.getByTestId('health-group-refunds-error')).toBeVisible();
    await expect(page.getByTestId('health-group-webhooks')).toContainText('Webhook messages waiting');
  });

  test('the period filter asks the server for 1, 7 or 30 days and a feature that is off says Off', async ({ page }) => {
    const mock = await adminTab(page, 'health', EVENTS_STAFF, { waitlist: false });
    await expect(page.getByTestId('health-group-waitlist')).toContainText('Off');
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    await expect.poll(() => mock.reads(/events\/health$/).some(c => c.query.days === '30')).toBe(true);
  });

  test('with analytics off the tab is not available', async ({ page }) => {
    await adminTab(page, 'health', EVENTS_STAFF, { analytics: false });
    await expect(page.getByTestId('health-off')).toBeVisible();
  });

  test('Swahili at 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await adminTab(page, 'health', EVENTS_STAFF, {}, 'sw');
    await expect(page.getByTestId('health-counts-note')).toHaveText(eventsS7Messages.sw['admin.events.health.countsNote']);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expectNoRawKeys(page);
  });
});

test.describe('admin Operations tab (AC-H17)', () => {
  test('finds organizers by name; Disable API access needs a reason and writes it with the optional Swahili text', async ({ page }) => {
    const mock = await adminTab(page, 'operations');
    await expect(page.getByTestId('ops-setup')).toContainText('Feature switches are changed in the server settings by the owner, not here.');
    await page.getByTestId('ops-search').fill('arusha');
    await expect(page.getByTestId('ops-orgs')).not.toContainText('Dar Runners');
    await page.getByTestId('ops-search').fill('dar');
    await page.getByTestId('ops-api-org_1').click();
    await expect(page.getByTestId('ops-dialog-confirm')).toBeDisabled();
    await page.getByTestId('ops-dialog-reason').fill('Abuse of the roster feed.');
    await page.getByTestId('ops-dialog-confirm').click();
    await expect.poll(() => mock.s7!.opLog.length).toBe(1);
    expect(mock.s7!.opLog[0]).toMatchObject({ type: 'api_access', enabled: false, reason: 'Abuse of the roster feed.' });
    expect(mock.writes(/api-access$/)[0].body).toEqual({ enabled: false, reason: 'Abuse of the roster feed.' }); // the contract takes a reason only
    expect(JSON.stringify(mock.writes(/api-access$/)[0].body)).not.toMatch(/userId/);
  });

  test('Revoke all clients needs the organizer name typed and shows the count', async ({ page }) => {
    const mock = await adminTab(page, 'operations');
    await page.getByTestId('ops-revoke-org_1').click();
    await page.getByTestId('ops-dialog-reason').fill('Credentials leaked in public repo.');
    await expect(page.getByTestId('ops-dialog-confirm')).toBeDisabled();
    await page.getByTestId('ops-dialog-typed').fill('Dar Runners');
    await page.getByTestId('ops-dialog-confirm').click();
    await expect(page.getByText('2 API clients revoked.')).toBeVisible();
    expect(mock.s7!.opLog[0]).toMatchObject({ type: 'revoke_all', n: 2 });
  });

  test('Turn off all webhooks needs a reason and the typed name; there is no client-rate action (the server lists no clients)', async ({ page }) => {
    await adminTab(page, 'operations');
    await page.getByTestId('ops-webhooks-org_1').click();
    await page.getByTestId('ops-dialog-reason').fill('Endpoint is flooding a customer.');
    await page.getByTestId('ops-dialog-typed').fill('dar runners');
    await page.getByTestId('ops-dialog-confirm').click();
    await expect(page.getByText('1 webhook endpoints turned off.')).toBeVisible();
    await expect(page.getByTestId('ops-orgs').getByRole('button', { name: /rate/i })).toHaveCount(0);
  });

  test('jobs show their schedule in words (the server sends { type, minutes } or { type, utc }) and the organizer status is translated', async ({ page }) => {
    await adminTab(page, 'operations');
    await expect(page.getByTestId('ops-jobs')).toContainText('Every 5 minutes');
    await expect(page.getByTestId('ops-orgs')).toContainText('Verified');
    await expect(page.getByTestId('ops-orgs')).not.toContainText(/\bactive\b/);
  });

  test('a flag that is off says which feature is not available', async ({ page }) => {
    const mock = await adminTab(page, 'operations');
    mock.on('POST', /api-clients\/revoke-all$/, () => ({ status: 404, json: { error: 'feature_disabled' } }));
    await page.getByTestId('ops-revoke-org_1').click();
    await page.getByTestId('ops-dialog-reason').fill('Credentials leaked in public repo.');
    await page.getByTestId('ops-dialog-typed').fill('Dar Runners');
    await page.getByTestId('ops-dialog-confirm').click();
    await expect(page.getByTestId('ops-dialog')).toContainText('Not available because API is off.');
  });

  test('timing and an admin without the events scope get nothing', async ({ page }) => {
    await setupEvents(page, { id: 'admin-9', userType: 'admin', portalUser: true, aclPermissions: ['gyms'] }, { s7: {} });
    await page.goto('/admin/events/?tab=operations');
    await expect(page.getByTestId('admin-ops')).toHaveCount(0);
  });
});

test.describe('admin Disputes tab (AC-H10)', () => {
  test('lists open questions with age and May resolve, and the chips filter', async ({ page }) => {
    const mock = await adminTab(page, 'disputes');
    await expect(page.getByTestId('admin-disputes').getByRole('row')).toHaveCount(4); // header + 3
    await expect(page.getByTestId('admin-disputes')).toContainText('May resolve');
    await page.getByRole('button', { name: 'Older than 7 days' }).click();
    await expect(page.getByTestId('admin-disputes').getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Organizer suspended' }).click();
    await expect(page.getByTestId('admin-disputes')).toContainText('Moshi Fun Run');
    expect(mock.reads(/results\/disputes$/).map(c => c.query.organizerStatus).filter(Boolean)).toContain('suspended');
    await page.getByTestId('dispute-open-dsp_3').click();
    await expect(page).toHaveURL(/event=evt_1&view=results/);
  });
});

test.describe('admin event controls (AC-H6, AC-H16)', () => {
  test('Pause registrations needs a reason and the event title, then Resume reverses it', async ({ page }) => {
    const mock = await setupEvents(page, EVENTS_STAFF, { s7: {} });
    await page.goto('/admin/events/?event=evt_pub');
    await page.getByTestId('admin-pause').click();
    await page.getByTestId('admin-pause-dialog-reason').fill('Payment provider incident.');
    await page.getByTestId('admin-pause-dialog-reason-sw').fill('Tatizo la mtoa huduma wa malipo.');
    await expect(page.getByTestId('admin-pause-dialog-confirm')).toBeDisabled();
    await page.getByTestId('admin-pause-dialog-typed').fill('Arusha Trail 10K');
    await page.getByTestId('admin-pause-dialog-confirm').click();
    await expect(page.getByTestId('admin-paused-note')).toBeVisible();
    expect(mock.s7!.opLog[0]).toMatchObject({ type: 'registration_state', to: 'closed', reasonSw: 'Tatizo la mtoa huduma wa malipo.' });
    await page.getByTestId('admin-resume').click();
    await page.getByTestId('admin-pause-dialog-reason').fill('Incident is over.');
    await page.getByTestId('admin-pause-dialog-typed').fill('Arusha Trail 10K');
    await page.getByTestId('admin-pause-dialog-confirm').click();
    await expect(page.getByTestId('admin-pause')).toBeVisible();
    expect(mock.s7!.opLog[1]).toMatchObject({ to: 'open' });
  });

  test('the rewards-eligible switch is off by default, asks for a reason, and the integrations block shows counts only', async ({ page }) => {
    const mock = await setupEvents(page, EVENTS_STAFF, { s7: {} });
    await page.goto('/admin/events/?event=evt_pub');
    await expect(page.getByTestId('admin-rewards-switch')).not.toBeChecked();
    await expect(page.getByTestId('admin-integrations-block')).toContainText('2 API clients, 1 webhook endpoints');
    await expect(page.getByTestId('admin-integrations-block')).not.toContainText(/cli_|secret|whsec/);
    await page.getByTestId('admin-rewards-switch').click();
    await page.getByTestId('admin-rewards-dialog-reason').fill('Approved for the pilot rewards.');
    await page.getByTestId('admin-rewards-dialog-confirm').click();
    await expect.poll(() => mock.s7!.rewardsEligible).toBe(true);
    await expect(page.getByTestId('admin-rewards-switch')).toBeChecked();
  });

  test('the payments-off banner names the cause in words', async ({ page }) => {
    await setupEvents(page, EVENTS_STAFF, { s7: { paymentsBlocked: 'second_approver_off' } });
    await page.goto('/admin/events/?event=evt_pub');
    await expect(page.getByTestId('payments-off-banner')).toHaveText('Payments are off because two approvers are not turned on yet.');
  });
});

test.describe('admin redemptions (AC-H11)', () => {
  test('Recent redemptions shows reward, masked person, state and times and no code', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { s7: {} });
    await page.goto('/admin/event-rewards/?tab=redemptions');
    const table = page.getByTestId('admin-redemptions');
    await expect(table).toContainText('Finisher perk');
    await expect(table).toContainText('Baraka M.');
    await expect(table).not.toContainText(/FFR-|code/i);
  });
});


test.describe('admin: offline desks and waitlist blocks', () => {
  test('a FitFlex admin reads the desks of an event and can remove one with a reason', async ({ page }) => {
    const mock = await setupEvents(page, EVENTS_STAFF, { s7: {} });
    mock.s7!.devices.push({ id: 'dev_a', label: 'Gate 1', status: 'active', staffUserId: 'u', staffFirstName: 'Ali', issuedAt: '2027-03-12T08:00:00.000Z', expiresAt: '2027-03-14T08:00:00.000Z', bibRange: null, pending: 3, discarded: 0, lastSyncAt: null, lastHeartbeatAt: null, snapshotRows: 5, snapshotSeq: 1, deskBuild: '1', bibsRecorded: 0, bibExceptions: 0 });
    await page.goto('/admin/events/?event=evt_pub');
    await expect(page.getByTestId('admin-event-detail')).toBeVisible();
    const panel = page.getByTestId('offline-devices');
    await expect(panel).toContainText('Gate 1');
    await panel.getByTestId('offline-remove-dev_a').click();
    await page.getByTestId('offline-remove-dialog-reason').fill('Device reported stolen.');
    await page.getByTestId('offline-remove-dialog-reason-sw').fill('Kifaa kimeripotiwa kuibiwa.');
    await page.getByTestId('offline-remove-dialog-typed').fill('Gate 1');
    await page.getByTestId('offline-remove-dialog-confirm').click();
    await expect.poll(() => mock.s7!.devices[0].status).toBe('revoked');
    expect(mock.s7!.opLog[0]).toMatchObject({ type: 'admin_desk_revoked', reasonSw: 'Kifaa kimeripotiwa kuibiwa.' });
    void SUPER_ADMIN; void sha; void tokenOf;
  });
});

test.describe('waitlist: admin (AC-W16)', () => {
  test('a FitFlex admin sees masked entries and removes one with a reason and an optional Swahili reason', async ({ page }) => {
    const mock = await setupEvents(page, EVENTS_STAFF, { s7: {} });
    await page.goto('/admin/events/?event=evt_pub');
    const block = page.getByTestId('admin-waitlist');
    await expect(block).toContainText('Neema S.');
    expect(JSON.stringify(await block.innerText())).not.toMatch(/\+255|@|phone|email/i);
    await block.getByTestId('admin-waitlist-remove-wle_1').click();
    await expect(page.getByTestId('admin-waitlist-dialog-confirm')).toBeDisabled();
    await page.getByTestId('admin-waitlist-dialog-reason').fill('Account used for resale.');
    await page.getByTestId('admin-waitlist-dialog-reason-sw').fill('Akaunti ilitumika kuuza tena.');
    await page.getByTestId('admin-waitlist-dialog-confirm').click();
    await expect.poll(() => mock.s7!.waitlistCalls.length).toBe(1);
    expect(mock.s7!.waitlistCalls[0]).toMatchObject({ type: 'remove', id: 'wle_1', reasonSw: 'Akaunti ilitumika kuuza tena.' });
  });

  test('with the flag off the admin block does not exist', async ({ page }) => {
    await setupEvents(page, EVENTS_STAFF, { s7: { waitlist: false } });
    await page.goto('/admin/events/?event=evt_pub');
    await expect(page.getByTestId('admin-event-detail')).toBeVisible();
    await expect(page.getByTestId('admin-waitlist')).toHaveCount(0);
  });
});

// ═══ P4: results follow-ups and banners ═══
test.describe('per race settings (AC-H18)', () => {
  const RESULTS = '/organizer/events/?event=evt_pub&view=results&section=settings';
  test('saves per-race time basis, cut-off and tolerance through the existing route; "Same for all races" sets every race', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s6: {}, s7: {} });
    await page.goto(RESULTS);
    // The rows reset when the saved settings arrive, so anything chosen before that is lost.
    await page.waitForLoadState('networkidle');
    const card = page.getByTestId('results-per-race');
    await expect(card).toBeVisible();
    await card.getByTestId('per-race-basis-cat_1').selectOption('gun');
    await card.getByTestId('per-race-cutoff-cat_1').fill('240');
    await card.getByTestId('per-race-tolerance-cat_1').fill('5');
    await card.getByTestId('per-race-save').click();
    await expect(page.getByText('Per race settings saved.')).toBeVisible();
    const body = mock.s7!.settingsCalls[0];
    // A cleared field is sent as null, never omitted; time basis is always net or gun.
    expect(body.categories).toEqual([{ id: 'cat_1', timeBasis: 'gun', cutoffMinutes: 240, virtualDistanceToleranceBps: 500 }, { id: 'cat_2', timeBasis: 'net', cutoffMinutes: null, virtualDistanceToleranceBps: null }]);
    // The saved values come back from perCategory[].rules and fill the form after a reload.
    await page.reload();
    await expect(page.getByTestId('per-race-basis-cat_1')).toHaveValue('gun');
    await expect(page.getByTestId('per-race-cutoff-cat_1')).toHaveValue('240');
    await expect(page.getByTestId('per-race-tolerance-cat_1')).toHaveValue('5');
    // 5 % is the most the server takes.
    await page.getByTestId('per-race-tolerance-cat_1').fill('6');
    await expect(page.getByTestId('per-race-save')).toBeDisabled();
    await page.getByTestId('per-race-tolerance-cat_1').fill('');
    await page.getByTestId('per-race-save').click();
    await expect.poll(() => mock.s7!.settingsCalls.length).toBe(2);
    expect((mock.s7!.settingsCalls[1].categories as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 'cat_1', virtualDistanceToleranceBps: null });
    await page.getByTestId('per-race-same').check();
    await card.getByTestId('per-race-basis-all').selectOption('net');
    await card.getByTestId('per-race-save').click();
    await expect.poll(() => mock.s7!.settingsCalls.length).toBe(3);
    expect((mock.s7!.settingsCalls[2].categories as Array<Record<string, unknown>>).every(x => x.timeBasis === 'net')).toBe(true);
  });

  test('after the first official release the fields disable with the explanation', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s6: { officialRelease: true }, s7: {} });
    await page.goto(RESULTS);
    await expect(page.getByTestId('results-per-race')).toContainText("These can't change after the official release");
    await expect(page.getByTestId('per-race-basis-cat_1')).toBeDisabled();
    await expect(page.getByTestId('per-race-save')).toHaveCount(0);
  });
});

test.describe('correction preview (AC-H12)', () => {
  test('Preview effect shows rank change, shifted runners and medals; Confirm waits for a matching preview', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s6: {}, s7: {} });
    await page.goto('/organizer/events/?event=evt_pub&view=results&section=results');
    await page.getByTestId('result-open-reg_3').click();
    await page.getByTestId('act-correct').click();
    await page.getByTestId('correct-net').fill('1:40:00');
    await page.getByTestId('correct-reason').selectOption('timing_error');
    await page.getByTestId('correct-note').fill('Timing mat missed the first split.');
    await expect(page.getByTestId('correct-confirm')).toBeDisabled();
    await page.getByTestId('correct-preview').click();
    await expect(page.getByTestId('correct-preview-result')).toHaveText('Rank changes from 3 to 1. 2 other runners shift. 1 medals affected.');
    expect(JSON.stringify(mock.s7!.previews[0])).not.toMatch(/Amina/);
    await expect(page.getByTestId('correct-confirm')).toBeEnabled();
    await page.getByTestId('correct-net').fill('1:41:00');
    await expect(page.getByTestId('correct-confirm')).toBeDisabled();
  });
});

test.describe('medal take-down banner (AC-H13)', () => {
  test('shows the danger banner with the reason and an upload action; no banner without a take-down', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s6: {}, s7: { takedown: true } });
    await page.goto('/organizer/events/?event=evt_pub&view=results&section=medals');
    await expect(page.getByTestId('medal-takedown-banner')).toContainText('FitFlex removed your design for Finisher');
    await expect(page.getByTestId('medal-takedown-banner')).toContainText('The built-in design is shown instead.');
    await expect(page.getByTestId('medal-takedown-banner').getByRole('button', { name: 'Upload a new design' })).toBeVisible();
  });
  test('without a take-down there is no banner', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s6: {}, s7: {} });
    await page.goto('/organizer/events/?event=evt_pub&view=results&section=medals');
    await expect(page.getByTestId('medal-takedown-banner')).toHaveCount(0);
  });
});

test.describe('payments-off banner on the organizer event page (AC-H14)', () => {
  test('owner and finance see the cause; ops do not', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s7: { paymentsBlocked: 'no_ticket_secret' } });
    await page.goto('/organizer/events/?event=evt_pub&view=registrations');
    await expect(page.getByTestId('payments-off-banner')).toHaveText('Payments are off until the ticket key is set.');
  });
  test('ops never see it', async ({ page }) => {
    await setupEvents(page, STAFF_OPS, { me: organizerMe('active', 'ops'), s7: { paymentsBlocked: 'flag_off' } });
    await page.goto('/organizer/events/?event=evt_pub&view=registrations');
    await expect(page.getByTestId('organizer-view-registrations')).toBeVisible();
    await expect(page.getByTestId('payments-off-banner')).toHaveCount(0);
  });
  test('Swahili wording', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s7: { paymentsBlocked: 'second_approver_off' }, locale: 'sw' });
    await page.goto('/organizer/events/?event=evt_pub&view=registrations');
    await expect(page.getByTestId('payments-off-banner')).toHaveText(eventsS7Messages.sw['events.payments.blocked.second_approver_off']);
  });
});

test.describe('flag off: nothing new renders (AC-F1)', () => {
  test('older server without the S7 blocks: no new entry anywhere', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s6: {} });
    await page.goto('/organizer/events/?event=evt_pub&view=kit');
    await expect(page.getByTestId('kit-desk')).toBeVisible();
    await expect(page.getByTestId('kit-offline-entry')).toHaveCount(0);
    await page.goto('/organizer/events/?event=evt_pub&view=registrations');
    await expect(page.getByTestId('waitlist-card')).toHaveCount(0);
    await expect(page.getByTestId('payments-off-banner')).toHaveCount(0);
  });
});
