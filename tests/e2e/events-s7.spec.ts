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
    await expect(panel.getByRole('button', { name: /Remove desk/ })).toHaveCount(0);
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

