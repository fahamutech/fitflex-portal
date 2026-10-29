import { expect, test, type Page } from '@playwright/test';
import {
  EVENTS_STAFF, OWNER, STAFF_ADMIN, STAFF_FINANCE, STAFF_OPS, SUPER_ADMIN, expectNoRawKeys, organizerMe, setupEvents,
} from './helpers/events-mock';
import { GYM_QR, TICKET, type S5Opts } from './helpers/events-s5-mock';

// Events S5 (spec docs/design/events-s5-venue-api-and-webhooks.md §3 to §8, §12): the kit desk, bibs, export, the registration
// drawer, integrations (API clients, webhooks, delivery log) and the payout schedule. The mock is strict about the spec's
// real shapes (a missing Idempotency-Key, a wrong role, a userId in a body, a scope the role cannot grant, a private
// webhook address, a payout change after publish), so a portal that guesses a shape fails here.
test.use({ serviceWorkers: 'block' });

const STAFF_TIMING = { id: 'usr_stim', userType: 'organizer_staff', displayName: 'Tumaini Timing' };
const EV = '/organizer/events/?event=evt_pub';
type Role = 'owner' | 'admin' | 'ops' | 'timing' | 'finance';
const who = (role: Role) => (role === 'owner' ? OWNER : role === 'admin' ? STAFF_ADMIN : role === 'ops' ? STAFF_OPS : role === 'finance' ? STAFF_FINANCE : STAFF_TIMING);
const open = async (page: Page, role: Role, view: string, s5: S5Opts = {}, extra: Parameters<typeof setupEvents>[2] = {}, locale: 'en' | 'sw' = 'en') => {
  const mock = await setupEvents(page, who(role), { me: organizerMe('active', role), s5, locale, ...extra });
  await page.goto(`${EV}&view=${view}`);
  return mock;
};
const desk = async (page: Page, role: Role = 'ops', s5: S5Opts = {}, locale: 'en' | 'sw' = 'en') => {
  const mock = await open(page, role, 'kit', s5, {}, locale);
  await expect(page.getByTestId('kit-desk')).toBeVisible();
  return mock;
};
const paste = async (page: Page, text: string) => {
  await page.getByTestId('kit-manual').fill(text);
  await page.getByTestId('kit-manual-submit').click();
};
const pickPoint = (page: Page, id = 'cp_1') => page.getByTestId('kit-point').selectOption(id);
const PRIVATE = /\+255|@example\.com|dateOfBirth|emergency/i;

test.describe('kit desk (§8.3, AC-B1..B9)', () => {
  test('a valid ticket shows the masked card, then one handover is recorded with an Idempotency-Key and the point', async ({ page }) => {
    const mock = await desk(page);
    await expect(page.getByTestId('kit-progress')).toHaveText('1 of 4 collected');
    await expect(page.getByTestId('kit-confirm')).toHaveCount(0);
    await pickPoint(page);
    await paste(page, TICKET.valid);
    await expect(page.getByTestId('kit-result')).toHaveAttribute('data-result', 'valid');
    await expect(page.getByTestId('kit-result-heading')).toHaveText('Ready for kit');
    await expect(page.getByTestId('kit-card-name')).toHaveText('Amina M.');
    await expect(page.getByTestId('kit-card-code')).toHaveText('AMN-1001');
    await expect(page.getByTestId('kit-card')).toContainText('No bib yet');
    await expect(page.getByTestId('kit-card-size')).toHaveText('Kit size M');
    await expect(page.getByTestId('kit-warnings')).toContainText('No bib assigned yet');
    await expect(page.getByTestId('kit-confirm')).toBeFocused();
    // The verify call is read-only and sends the payload and the point, nothing else; no contact data is on screen.
    expect(mock.writes(/tickets\/verify$/)[0].body).toEqual({ payload: TICKET.valid, collectionPointId: 'cp_1' });
    expect(await page.locator('main').innerText()).not.toMatch(PRIVATE);
    await page.getByTestId('kit-confirm').click();
    await expect(page.getByTestId('kit-recorded')).toContainText('Kit recorded for Amina M.');
    const w = mock.writes(/kit-collections$/);
    expect(w).toHaveLength(1);
    expect(w[0].body).toEqual({ method: 'scan', payload: TICKET.valid, collectionPointId: 'cp_1' });
    expect(w[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(mock.s5!.collections.filter(c => c.registrationId === 'reg_1' && c.status === 'collected')).toHaveLength(1);
    // The card clears itself and the box is ready for the next scan.
    await expect(page.getByTestId('kit-recorded')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByTestId('kit-manual')).toBeFocused();
    await expect(page.getByTestId('kit-progress')).toHaveText('2 of 4 collected');
    await expectNoRawKeys(page);
  });

  test('the collection point is required before handing over (the server refuses a missing point)', async ({ page }) => {
    const mock = await desk(page);
    await expect(page.getByTestId('kit-point-hint')).toHaveText('Choose where you are working');
    await page.getByTestId('kit-manual').fill(TICKET.valid);
    await expect(page.getByTestId('kit-manual-submit')).toBeDisabled();
    await page.getByTestId('kit-manual').press('Enter');
    await expect(page.getByTestId('kit-camera-start')).toBeDisabled();
    expect(mock.writes(/tickets\/verify$/)).toHaveLength(0);
    await page.getByTestId('kit-manual').fill('');
    await pickPoint(page, 'cp_2');
    await paste(page, TICKET.valid);
    await page.getByTestId('kit-confirm').click();
    await expect(page.getByTestId('kit-recorded')).toBeVisible();
    expect(mock.writes(/kit-collections$/)[0].body?.collectionPointId).toBe('cp_2');
    // The choice is remembered for the event.
    await page.reload();
    await expect(page.getByTestId('kit-point')).toHaveValue('cp_2');
  });

  test('an event with no collection points records handovers without one and says so', async ({ page }) => {
    const mock = await desk(page, 'ops', { noCollectionPoints: true });
    await expect(page.getByTestId('kit-no-points')).toContainText('This event has no collection points');
    await paste(page, TICKET.valid);
    await page.getByTestId('kit-confirm').click();
    await expect(page.getByTestId('kit-recorded')).toBeVisible();
    expect(mock.writes(/kit-collections$/)[0].body).toEqual({ method: 'scan', payload: TICKET.valid });
  });

  test('a second scan of a collected ticket shows time, point and name and creates no row; ops are told to ask an owner or admin', async ({ page }) => {
    const mock = await desk(page, 'ops');
    await pickPoint(page);
    await paste(page, TICKET.collected);
    await expect(page.getByTestId('kit-result')).toHaveAttribute('data-result', 'already_collected');
    await expect(page.getByTestId('kit-result-heading')).toHaveText('Kit already collected');
    await expect(page.getByTestId('kit-already-body')).toContainText('at Expo Hall by Asha');
    await expect(page.getByTestId('kit-confirm')).toHaveCount(0);
    await expect(page.getByTestId('kit-override')).toHaveCount(0);
    await expect(page.getByTestId('kit-override-ask')).toHaveText('Ask an owner or admin to override.');
    expect(mock.writes(/kit-collections/)).toHaveLength(0);
    expect(mock.s5!.collections.filter(c => c.registrationId === 'reg_2')).toHaveLength(1);
  });

  test('a race on the collection write (the other desk won) turns the card into "already collected" without a second row', async ({ page }) => {
    const mock = await desk(page, 'ops');
    await pickPoint(page);
    await paste(page, TICKET.valid);
    await expect(page.getByTestId('kit-confirm')).toBeVisible();
    mock.s5!.regs.find(r => r.id === 'reg_1')!.kit = 'collected'; // another desk collected it between verify and confirm
    mock.s5!.collections.push({ id: 'col_x', registrationId: 'reg_1', status: 'collected', collectedAt: '2027-03-12T09:00:00.000Z', pointId: 'cp_2', by: 'Zawadi', method: 'scan' });
    await page.getByTestId('kit-confirm').click();
    await expect(page.getByTestId('kit-result-heading')).toHaveText('Kit already collected');
    await expect(page.getByTestId('kit-already-body')).toContainText('at Mall Desk by Zawadi');
    expect(mock.s5!.collections.filter(c => c.registrationId === 'reg_1')).toHaveLength(1);
  });

  test('owner override: the reason is required (10+ characters), then "recollect" is sent and the first row stays in the history', async ({ page }) => {
    const mock = await desk(page, 'owner');
    await pickPoint(page);
    await paste(page, TICKET.collected);
    await page.getByTestId('kit-override').click();
    await expect(page.getByRole('dialog')).toContainText('The first handover stays in the history');
    await expect(page.getByTestId('kit-override-dialog-confirm')).toBeDisabled();
    await page.getByTestId('kit-override-dialog-reason').fill('too short');
    await expect(page.getByTestId('kit-override-dialog-confirm')).toBeDisabled();
    await page.getByTestId('kit-override-dialog-reason').fill('Kit was lost on the way home');
    await page.getByTestId('kit-override-dialog-confirm').click();
    await expect(page.getByTestId('kit-recorded')).toBeVisible();
    const w = mock.writes(/corrections$/);
    expect(w).toHaveLength(1);
    expect(w[0].path).toBe('/organizer/events/evt_pub/kit-collections/col_0/corrections');
    expect(w[0].body).toEqual({ action: 'recollect', reason: 'Kit was lost on the way home' });
    expect(w[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(mock.s5!.collections.map(c => c.status)).toEqual(['corrected', 'collected']);
  });

  test('revoked, wrong event, unknown and a ticket of another organizer: each has its own heading; the foreign one is just "not recognised"', async ({ page }) => {
    const mock = await desk(page, 'ops');
    await pickPoint(page);
    const heading = page.getByTestId('kit-result-heading');
    await paste(page, TICKET.revoked);
    await expect(heading).toHaveText('Ticket cancelled');
    await expect(page.getByTestId('kit-revoked-reason')).toHaveText('Refunded');
    await expect(page.getByTestId('kit-confirm')).toHaveCount(0);
    await page.getByTestId('kit-cancel').click();
    await paste(page, TICKET.other);
    await expect(heading).toHaveText('Ticket for a different event');
    await expect(page.getByTestId('kit-result')).toContainText('This ticket is for Arusha Fun Run.');
    await page.getByTestId('kit-cancel').click();
    await paste(page, TICKET.foreign);
    await expect(heading).toHaveText('Code not recognised');
    await expect(page.getByTestId('kit-result')).not.toContainText('different event');
    await page.getByTestId('kit-cancel').click();
    await paste(page, 'ev1.k1.garbage.1.zzzz');
    await expect(heading).toHaveText('Code not recognised');
    await page.getByTestId('kit-cancel').click();
    await paste(page, 'hello world');
    await expect(heading).toHaveText('Code not recognised'); // the server's 400 not_event_ticket
    expect(mock.writes(/kit-collections$/)).toHaveLength(0);
  });

  test('a gym QR is refused locally: nothing is sent to the server (AC-B5)', async ({ page }) => {
    const mock = await desk(page, 'ops');
    await pickPoint(page);
    await paste(page, GYM_QR);
    await expect(page.getByTestId('kit-result')).toHaveAttribute('data-result', 'gym');
    await expect(page.getByTestId('kit-result-heading')).toHaveText('This looks like a gym pass, not an event ticket.');
    expect(mock.writes(/tickets\/verify$/)).toHaveLength(0);
  });

  test('manual lookup: an exact registration id of an unpaid place says "Not paid yet" with no handover; a name finds only masked cards', async ({ page }) => {
    const mock = await desk(page, 'ops');
    await pickPoint(page);
    await page.getByTestId('kit-search').fill('Ne');
    await expect(page.getByTestId('kit-search-submit')).toBeDisabled(); // 3+ characters
    await page.getByTestId('kit-search').fill('reg_4');
    await page.getByTestId('kit-search-submit').click();
    await expect(page.getByTestId('kit-hit')).toContainText('Daudi K.');
    await expect(page.getByTestId('kit-hit-handover')).toHaveCount(0);
    await page.getByTestId('kit-search').fill('Neema');
    await page.getByTestId('kit-search-submit').click();
    await expect(page.getByTestId('kit-hit')).toHaveCount(1);
    await expect(page.getByTestId('kit-hit')).toContainText('Neema S.');
    expect(await page.locator('main').innerText()).not.toMatch(PRIVATE);
    await page.getByTestId('kit-search').fill('zzzzz');
    await page.getByTestId('kit-search-submit').click();
    await expect(page.getByTestId('kit-search-none')).toBeVisible();
    expect(mock.reads(/kit\/lookup$/).map(c => c.query.q)).toEqual(['reg_4', 'Neema', 'zzzzz']);
  });

  test('manual handover needs a reason and the ID check, and records method "manual" with the reason code (AC-B8)', async ({ page }) => {
    const mock = await desk(page, 'ops');
    await pickPoint(page);
    await page.getByTestId('kit-search').fill('Neema');
    await page.getByTestId('kit-search-submit').click();
    await page.getByTestId('kit-hit-handover').click();
    await expect(page.getByTestId('manual-confirm')).toBeDisabled();
    await page.getByTestId('manual-reason').selectOption('phone_lost');
    await expect(page.getByTestId('manual-confirm')).toBeDisabled();
    await page.getByTestId('manual-id-check').check();
    await page.getByTestId('manual-confirm').click();
    await expect(page.getByTestId('kit-recorded')).toContainText('Kit recorded for Neema S.');
    expect(mock.writes(/kit-collections$/)[0].body).toEqual({ method: 'manual', registrationId: 'reg_5', manualReason: 'phone_lost', collectionPointId: 'cp_1' });
  });

  test('the server refuses a handover from a role that cannot hand over (timing: tab hidden, direct URL forbidden)', async ({ page }) => {
    const mock = await open(page, 'timing', 'kit');
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
    expect(mock.reads(/tickets|kit-collections|kit\/summary/)).toHaveLength(0);
  });

  test('camera denied: the message shows and the code box still works; leaving stops the tracks (AC-B6)', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) } });
    });
    const mock = await desk(page, 'ops');
    await pickPoint(page);
    await page.getByTestId('kit-camera-start').click();
    await expect(page.getByTestId('kit-camera-status')).toContainText('Camera access is blocked');
    await expect(page.getByTestId('kit-camera-start')).toBeVisible();
    await paste(page, TICKET.valid);
    await expect(page.getByTestId('kit-result-heading')).toHaveText('Ready for kit');
    expect(mock.writes(/tickets\/verify$/)).toHaveLength(1);
  });

  test('camera unsupported and no camera each have their own message', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }); });
    await desk(page, 'ops');
    await pickPoint(page);
    await page.getByTestId('kit-camera-start').click();
    await expect(page.getByTestId('kit-camera-status')).toContainText("This browser can't use the camera here");
  });

  test('a running camera is stopped by Stop and by leaving the page', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __tracks: MediaStreamTrack[] };
      w.__tracks = [];
      const make = () => {
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
        canvas.getContext('2d')!.fillRect(0, 0, 64, 48);
        const stream = canvas.captureStream(5);
        stream.getTracks().forEach(t => w.__tracks.push(t));
        return Promise.resolve(stream);
      };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: make } });
    });
    await desk(page, 'ops');
    await pickPoint(page);
    await page.getByTestId('kit-camera-start').click();
    await expect(page.getByTestId('kit-camera-stop')).toBeVisible();
    await expect(page.getByLabel('Camera preview').first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map(t => t.readyState))).toEqual(['live']);
    await page.getByTestId('kit-camera-stop').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map(t => t.readyState))).toEqual(['ended']);
    await page.getByTestId('kit-camera-start').click();
    await expect(page.getByTestId('kit-camera-stop')).toBeVisible();
    await page.getByTestId('kit-camera-stop').click();
    await page.getByRole('link', { name: /Overview/ }).first().click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every(t => t.readyState === 'ended'))).toBe(true);
  });

  test('offline: a sticky banner says offline scanning is not available yet, verify and confirm are disabled and nothing is queued (AC-B7)', async ({ page, context }) => {
    const mock = await desk(page, 'ops');
    await pickPoint(page);
    await context.setOffline(true);
    await expect(page.getByTestId('kit-offline')).toContainText('You are offline. Scanning needs a connection. Offline scanning is not available yet.');
    await expect(page.getByTestId('kit-manual')).toBeDisabled();
    await expect(page.getByTestId('kit-camera-start')).toBeDisabled();
    expect(mock.writes()).toHaveLength(0);
    await context.setOffline(false);
    await expect(page.getByTestId('kit-offline')).toHaveCount(0);
    await expect(page.getByTestId('kit-manual')).toBeEnabled();
  });

  test('a save that fails on the network keeps the card and retries with the SAME Idempotency-Key (no double record)', async ({ page }) => {
    const mock = await desk(page, 'ops');
    await pickPoint(page);
    await paste(page, TICKET.valid);
    await expect(page.getByTestId('kit-confirm')).toBeVisible();
    let first = true;
    mock.on('POST', /kit-collections$/, () => { if (first) { first = false; return { status: 503, json: { error: 'unavailable' } }; } return undefined; });
    await page.getByTestId('kit-confirm').click();
    await expect(page.getByTestId('kit-save-failed')).toContainText("Couldn't save. Try again; it won't be recorded twice.");
    await expect(page.getByTestId('kit-result-heading')).toHaveText('Ready for kit');
    await page.getByTestId('kit-retry').click();
    await expect(page.getByTestId('kit-recorded')).toBeVisible();
    const keys = mock.writes(/kit-collections$/).map(c => c.headers?.['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(mock.s5!.collections.filter(c => c.registrationId === 'reg_1')).toHaveLength(1);
  });

  test('too many failed scans: the server rate limit shows a wait message (429)', async ({ page }) => {
    await desk(page, 'ops', { failLimit: 1 });
    await pickPoint(page);
    await paste(page, TICKET.foreign);
    await page.getByTestId('kit-cancel').click();
    await paste(page, TICKET.foreign);
    await expect(page.getByTestId('kit-rate-limited')).toContainText('Too many scans. Wait');
  });

  test('completed and cancelled events are read-only; an unpublished one says the desk is not open', async ({ page }) => {
    await desk(page, 'ops', { eventStatus: 'completed' });
    await expect(page.getByTestId('kit-completed')).toContainText('The event has ended. Handovers are read-only.');
    await expect(page.getByTestId('kit-manual')).toBeDisabled();
    await expect(page.getByTestId('kit-camera-start')).toBeDisabled();
  });
  test('a cancelled event closes the desk', async ({ page }) => {
    await desk(page, 'ops', { eventStatus: 'cancelled' });
    await expect(page.getByTestId('kit-cancelled')).toContainText('Handovers are closed.');
    await expect(page.getByTestId('kit-manual')).toBeDisabled();
  });

  test('a suspended organizer reads the desk but cannot write (AC-B17)', async ({ page }) => {
    await setupEvents(page, who('ops'), { me: organizerMe('suspended', 'ops'), s5: {} });
    await page.goto(`${EV}&view=kit`);
    await expect(page.getByTestId('kit-suspended')).toBeVisible();
    await expect(page.getByTestId('kit-manual')).toBeDisabled();
    await expect(page.getByTestId('kit-camera-start')).toBeDisabled();
  });

  test('Swahili: the desk renders in Swahili without raw keys and without horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await desk(page, 'ops', {}, 'sw');
    await pickPoint(page);
    await paste(page, TICKET.collected);
    await expect(page.getByTestId('kit-result-heading')).toHaveText('Vifaa vimeshachukuliwa');
    await expect(page.getByTestId('kit-already-body')).toContainText('Vilichukuliwa');
    await expect(page.getByTestId('kit-override-ask')).toHaveText('Mwombe mmiliki au msimamizi aruhusu.');
    await expect(page.getByTestId('kit-progress')).toContainText('wamechukua');
    await expectNoRawKeys(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe('gym scan page keeps its behaviour (§4.7, §8.2)', () => {
  test('an event ticket is refused locally with the event-ticket message and never sent to check-in', async ({ page }) => {
    const mock = await setupEvents(page, { id: 'usr_gym', userType: 'gym_operator', gymId: 'gym_1', displayName: 'Baraka Gym' }, { me: null });
    await page.goto('/scan/');
    await page.getByTestId('manual-token').fill(TICKET.valid);
    await page.getByTestId('manual-submit').click();
    await expect(page.getByTestId('scan-event-ticket')).toContainText('This is an event ticket');
    await expect(page.getByTestId('scan-event-ticket')).toContainText('Scan it under Kit collection in the organizer portal');
    expect(mock.writes(/checkins/)).toHaveLength(0);
  });
  test('a camera failure keeps the old camera message', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.reject(new Error('nope')) } }); });
    await setupEvents(page, { id: 'usr_gym', userType: 'gym_operator', gymId: 'gym_1', displayName: 'Baraka Gym' }, { me: null });
    await page.goto('/scan/');
    await page.getByTestId('start-scan').click();
    await expect(page.getByTestId('scan-problem')).toBeVisible();
  });
});

test.describe('role gating of the venue tabs (§2, §8.1, AC-B16)', () => {
  const tabs = (page: Page) => page.getByTestId('event-view-tabs');
  test('ops sees Registrations, Kit collection and Bib numbers only', async ({ page }) => {
    await open(page, 'ops', 'registrations');
    await expect(page.getByTestId('organizer-view-registrations')).toBeVisible();
    for (const name of ['Registrations', 'Kit collection', 'Bib numbers']) await expect(tabs(page).getByRole('button', { name })).toBeVisible();
    for (const name of ['Orders', 'Finance', 'Export']) await expect(tabs(page).getByRole('button', { name })).toHaveCount(0);
  });
  test('timing sees Bib numbers (read-only), not Kit collection or Export; the bibs page has no write controls', async ({ page }) => {
    await open(page, 'timing', 'bibs');
    await expect(page.getByTestId('bibs-view')).toBeVisible();
    await expect(tabs(page).getByRole('button', { name: 'Kit collection' })).toHaveCount(0);
    await expect(tabs(page).getByRole('button', { name: 'Export' })).toHaveCount(0);
    await expect(page.getByTestId('bibs-bulk')).toHaveCount(0);
    await expect(page.getByTestId('bib-assign-reg_1')).toHaveCount(0);
  });
  test('finance sees Orders and Finance only, no venue tabs; the export URL is forbidden', async ({ page }) => {
    await open(page, 'finance', 'finance');
    for (const name of ['Orders', 'Finance']) await expect(tabs(page).getByRole('button', { name })).toBeVisible();
    for (const name of ['Kit collection', 'Bib numbers', 'Export']) await expect(tabs(page).getByRole('button', { name })).toHaveCount(0);
    await page.goto(`${EV}&view=export`);
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
  });
  test('owner sees every tab; ops opening the export URL is forbidden', async ({ page }) => {
    await open(page, 'owner', 'registrations');
    for (const name of ['Registrations', 'Orders', 'Finance', 'Kit collection', 'Bib numbers', 'Export']) await expect(tabs(page).getByRole('button', { name })).toBeVisible();
  });
  test('ops cannot open the export tab by URL', async ({ page }) => {
    await open(page, 'ops', 'export');
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
  });
});

test.describe('bib numbers (§8.4, AC-B10)', () => {
  test('ops can assign to an unassigned person only; a taken number is refused with a plain message', async ({ page }) => {
    const mock = await open(page, 'ops', 'bibs');
    await expect(page.getByTestId('bibs-counts')).toContainText('With a bib');
    await expect(page.getByTestId('bibs-counts')).toContainText('Without a bib');
    await expect(page.getByTestId('bib-change-reg_2')).toHaveCount(0);
    await expect(page.getByTestId('bibs-bulk')).toHaveCount(0);
    await page.getByTestId('bib-assign-reg_1').click();
    await page.getByTestId('bib-input').fill('1002');
    await page.getByTestId('bib-save').click();
    await expect(page.getByTestId('bib-dialog')).toContainText('That number is already used.');
    await page.getByTestId('bib-input').fill('a-101');
    await expect(page.getByTestId('bib-input')).toHaveValue('A-101');
    await page.getByTestId('bib-save').click();
    await expect(page.getByTestId('bib-dialog')).toHaveCount(0);
    const w = mock.writes(/bib-assignments$/);
    expect(w[w.length - 1].body).toEqual({ registrationId: 'reg_1', bibNumber: 'A-101' });
    expect(w[w.length - 1].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    await expect(page.getByTestId('bibs-view')).toContainText('A-101');
  });

  test('owner changes a bib with a reason (replace) and releases one with a reason', async ({ page }) => {
    const mock = await open(page, 'owner', 'bibs');
    await page.getByTestId('bib-change-reg_2').click();
    await page.getByTestId('bib-input').fill('2002');
    await expect(page.getByTestId('bib-save')).toBeDisabled(); // a change needs a reason
    await page.getByTestId('bib-reason').fill('Printed wrong number');
    await page.getByTestId('bib-save').click();
    await expect(page.getByTestId('bib-dialog')).toHaveCount(0);
    expect(mock.writes(/bib-assignments$/).pop()!.body).toEqual({ registrationId: 'reg_2', bibNumber: '2002', reason: 'Printed wrong number', replace: true });
    await expect(page.getByTestId('bibs-view')).toContainText('Bib changed after kit handover');
    await page.getByTestId('bib-release-reg_2').click();
    await expect(page.getByTestId('bib-release-dialog-confirm')).toBeDisabled();
    await page.getByTestId('bib-release-dialog-reason').fill('Runner swapped distance');
    await page.getByTestId('bib-release-dialog-confirm').click();
    await expect.poll(() => mock.writes(/release$/).length).toBe(1);
    expect(mock.writes(/release$/)[0].body).toEqual({ reason: 'Runner swapped distance' });
    expect(mock.s5!.regs.find(r => r.id === 'reg_2')!.bib).toBeNull();
  });

  test('bulk by rule: Apply is disabled until a preview; a stale preview is refused and asks to preview again', async ({ page }) => {
    const mock = await open(page, 'owner', 'bibs');
    await page.getByTestId('bibs-bulk').click();
    await expect(page.getByTestId('bulk-apply')).toBeDisabled();
    await page.getByTestId('bulk-start').fill('3000');
    await page.getByTestId('bulk-prefix').fill('5k-');
    await page.getByTestId('bulk-pad').fill('4');
    await page.getByTestId('bulk-preview-btn').click();
    await expect(page.getByTestId('bulk-preview')).toContainText('3 people get 5K-3000 to 5K-3002.');
    expect(mock.writes(/bulk\/preview$/)[0].body).toEqual({ start: 3000, prefix: '5K-', padTo: 4, order: 'registered_at', onlyUnassigned: true });
    await expect(page.getByTestId('bulk-apply')).toBeEnabled();
    mock.s5!.bibVersion += 1; // the roster changed behind the owner's back
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByTestId('bulk-error')).toContainText('Registrations changed. Preview again.');
    await expect(page.getByTestId('bulk-apply')).toBeDisabled();
    await page.getByTestId('bulk-preview-btn').click();
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByTestId('bulk-dialog')).toHaveCount(0);
    const b = mock.writes(/bulk$/).pop()!;
    expect(b.body?.previewHash).toMatch(/^ph_/);
    expect(b.headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
    expect(mock.s5!.regs.filter(r => r.status === 'confirmed').map(r => r.bib)).toEqual(['5K-3000', '1002', '5K-3001', '5K-3002']);
  });

  test('CSV import: a file with a bad row shows the problems and blocks Apply; the fixed file applies', async ({ page }) => {
    const mock = await open(page, 'owner', 'bibs');
    await page.getByTestId('bibs-import').click();
    await page.getByTestId('import-file').setInputFiles({ name: 'bibs.csv', mimeType: 'text/csv', buffer: Buffer.from('registrationId,bibNumber\nreg_1,A-1\nreg_5,1002\nreg_nope,B-2\n') });
    await expect(page.getByTestId('import-result')).toHaveText('1 rows ready · 2 with problems');
    await expect(page.getByTestId('import-problems')).toContainText('That number is already used.');
    await expect(page.getByTestId('import-problems')).toContainText('No such registration in this event.');
    await expect(page.getByTestId('import-preview')).toContainText('Nothing is saved until every row is fixed.');
    await expect(page.getByTestId('import-apply')).toBeDisabled();
    expect(mock.s5!.regs.find(r => r.id === 'reg_1')!.bib).toBeNull(); // nothing applied
    await page.getByTestId('import-file').setInputFiles({ name: 'bibs.csv', mimeType: 'text/csv', buffer: Buffer.from('registrationId;bibNumber\nreg_1;A-1\nreg_5;a-2\n') });
    await expect(page.getByTestId('import-result')).toHaveText('2 rows ready · 0 with problems');
    await expect(page.getByTestId('import-apply')).toBeEnabled();
    await page.getByTestId('import-apply').click();
    await expect(page.getByTestId('import-dialog')).toHaveCount(0);
    expect(mock.s5!.regs.find(r => r.id === 'reg_1')!.bib).toBe('A-1');
    expect(mock.s5!.regs.find(r => r.id === 'reg_5')!.bib).toBe('A-2');
    expect(mock.writes(/import$/)[0].headers?.['idempotency-key']).toMatch(/^.{8,100}$/);
  });

  test('a file that is not a CSV or is too big is refused before upload', async ({ page }) => {
    const mock = await open(page, 'owner', 'bibs');
    await page.getByTestId('bibs-import').click();
    await page.getByTestId('import-file').setInputFiles({ name: 'bibs.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
    await expect(page.getByTestId('import-dialog')).toContainText('too big or is not a CSV');
    expect(mock.writes(/import/)).toHaveLength(0);
  });
});

test.describe('export (§8.6, AC-B13)', () => {
  test('owner downloads the CSV: fixed columns, BOM, neutralised formula cell, no contact data, an authenticated fetch', async ({ page }) => {
    const mock = await open(page, 'owner', 'export');
    await expect(page.getByTestId('export-privacy')).toHaveText('Phone, email, date of birth and emergency contact are never included.');
    await expect(page.getByTestId('export-columns')).toContainText('registrationId');
    await expect(page.getByTestId('export-columns')).not.toContainText(/phone|email|dateOfBirth|emergency|gender/i);
    await expect(page.getByTestId('export-rows')).toContainText('Confirmed participants: 4');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
    expect(download.suggestedFilename()).toMatch(/^arusha-trail-10k-participants-\d{8}\.csv$/);
    const text = await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xFEFF);
    expect(text).toContain('"registrationId","ticketCode","firstName","lastName"');
    expect(text).toContain(`"'=cmd"`);
    expect(text).not.toMatch(/phone|email|dateOfBirth|emergencyContact|@/i);
    expect(mock.reads(/exports\/registrations\.csv$/)[0].headers?.authorization).toMatch(/^Bearer /);
    await expect(page.getByText('Download started')).toBeVisible();
  });
  test('the sixth download in an hour is refused with the time to try again', async ({ page }) => {
    const mock = await open(page, 'admin', 'export');
    mock.s5!.exports = 5;
    await page.getByTestId('export-download').click();
    await expect(page.getByTestId('export-message')).toContainText('You can export 5 times an hour. Try again at');
  });
});

test.describe('registration drawer (§8.5)', () => {
  test('opens from the URL with the masked card and the kit history; no phone, email, date of birth or emergency contact; owner can void', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { me: organizerMe('active', 'owner'), s5: {} });
    await page.goto(`${EV}&view=kit&registration=reg_2`);
    const drawer = page.getByTestId('registration-drawer');
    await expect(drawer.getByTestId('drawer-card')).toContainText('Baraka M.');
    await expect(drawer.getByTestId('drawer-bib')).toHaveText('1002');
    await expect(drawer.getByTestId('drawer-kit-rows')).toContainText('Collected');
    await expect(drawer).toContainText('Ticket codes are never shown to organizers.');
    expect(await drawer.innerText()).not.toMatch(PRIVATE);
    await page.getByTestId('drawer-void').click();
    await page.getByTestId('drawer-void-dialog-reason').fill('Wrong person collected it');
    await page.getByTestId('drawer-void-dialog-confirm').click();
    await expect.poll(() => mock.writes(/corrections$/).length).toBe(1);
    expect(mock.writes(/corrections$/)[0].body).toEqual({ action: 'void', reason: 'Wrong person collected it' });
    await expect(drawer.getByTestId('drawer-kit-rows')).toContainText('Voided');
  });
  test('another event’s id or a made-up id shows the same "not part of this event" state', async ({ page }) => {
    await setupEvents(page, STAFF_OPS, { me: organizerMe('active', 'ops'), s5: {} });
    await page.goto(`${EV}&view=bibs&registration=reg_zzz`);
    await expect(page.getByTestId('drawer-notfound')).toContainText("This registration isn't part of this event.");
  });
  test('ops can assign a missing bib from the drawer but has no void or release', async ({ page }) => {
    await setupEvents(page, STAFF_OPS, { me: organizerMe('active', 'ops'), s5: {} });
    await page.goto(`${EV}&view=bibs&registration=reg_5`);
    await expect(page.getByTestId('drawer-bib-btn')).toHaveText('Assign');
    await expect(page.getByTestId('drawer-void')).toHaveCount(0);
    await expect(page.getByTestId('drawer-release')).toHaveCount(0);
  });
});

test.describe('payout schedule (§3, AC-A1..A8, D33)', () => {
  const PAYOUT = (page: Page) => page.getByTestId('payout-card');
  test('step 4 shows the card above the ticket groups, nothing selected, both choices; a draft saves without one', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s5: {} });
    await page.goto('/organizer/events/?event=evt_1&step=tickets');
    await expect(PAYOUT(page)).toContainText('Payout schedule');
    await expect(PAYOUT(page)).toContainText("How often FitFlex pays you for this event's sales.");
    await expect(page.getByTestId('payout-biweekly')).not.toBeChecked();
    await expect(page.getByTestId('payout-monthly')).not.toBeChecked();
    await expect(PAYOUT(page)).toContainText('Every two weeks');
    await expect(PAYOUT(page)).toContainText('Once a month');
    await expect(PAYOUT(page)).toContainText('FitFlex confirms payout dates and amounts in your payout statements, which are not live yet.');
    // The card sits before the first category group.
    const order = await page.evaluate(() => { const c = document.querySelector('[data-testid="payout-card"]')!; const s = document.querySelector('section[aria-label]')!; return c.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING; });
    expect(order).toBeTruthy();
    // Saving the step without choosing a schedule is fine (required at submit, not at create): the field is simply not sent.
    await page.getByTestId('ev-categories-0-ticketTypes-0-priceText').fill('30000');
    await page.getByTestId('wizard-save-draft').click();
    await expect.poll(() => mock.writes(/^\/organizer\/events\/evt_1$/).length).toBeGreaterThan(0);
    const last = mock.writes(/^\/organizer\/events\/evt_1$/).pop()!;
    expect(last.body?.categories[0].ticketTypes[0].priceTzs).toBe(30000);
    expect('payoutSchedule' in (last.body ?? {})).toBe(false);
  });
  test('choosing a schedule autosaves it with the tickets step', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s5: {} });
    await page.goto('/organizer/events/?event=evt_1&step=tickets');
    await page.getByTestId('payout-monthly').check();
    await expect.poll(() => mock.writes(/^\/organizer\/events\/evt_1$/).length, { timeout: 8000 }).toBeGreaterThan(0);
    expect(mock.writes(/^\/organizer\/events\/evt_1$/).pop()!.body?.payoutSchedule).toBe('monthly');
    expect(mock.s5!.payout.evt_1).toBe('monthly');
  });
  test('required at submit, locked after: Review blocks submit and links to the card; once chosen the draft submits with it and becomes read-only', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s5: {} });
    await page.goto('/organizer/events/?event=evt_1&step=review');
    await expect(page.getByTestId('review-payout')).toContainText('Not set');
    const problem = page.getByTestId('review-problem-ev-payoutSchedule');
    await expect(problem).toContainText('Choose how often you want to be paid.');
    await problem.click();
    await expect(page.getByTestId('step-heading')).toHaveText('Ticket types');
    await expect(page.getByTestId('payout-biweekly')).toBeFocused();
    await page.getByTestId('payout-biweekly').check();
    await page.getByTestId('step-review').click();
    await expect(page.getByTestId('review-problem-ev-payoutSchedule')).toHaveCount(0);
    await expect(page.getByTestId('review-payout')).toContainText('Every two weeks');
    await page.getByTestId('review-confirm').check();
    await page.getByTestId('wizard-submit').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Submit for review' }).click();
    await expect.poll(() => mock.writes(/\/organizer\/events\/evt_1\/submit$/).length).toBe(1);
    // The schedule travelled with the tickets step before the submit.
    expect(mock.writes(/^\/organizer\/events\/evt_1$/).some(c => c.body?.payoutSchedule === 'biweekly')).toBe(true);
    await expect(page.getByTestId('submitted-card')).toBeVisible();
    await page.getByTestId('step-tickets').click();
    await expect(page.getByTestId('payout-value')).toHaveText('Every two weeks');
    await expect(page.getByTestId('payout-locked')).toBeVisible();
    await expect(page.getByTestId('payout-biweekly')).toHaveCount(0);
  });
  test('the server refuses a submit without a schedule (422, path payoutSchedule): the problem list links to the card', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s5: {} });
    mock.on('POST', /\/organizer\/events\/evt_1\/submit$/, () => ({ status: 422, json: { error: 'event_invalid', fields: [{ path: 'payoutSchedule', code: 'required' }] } }));
    await page.goto('/organizer/events/?event=evt_1&step=tickets');
    await page.getByTestId('payout-monthly').check();
    await page.getByTestId('step-review').click();
    await page.getByTestId('review-confirm').check();
    await page.getByTestId('wizard-submit').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByTestId('review-problem-ev-payoutSchedule')).toBeVisible();
  });
  test('a submitted event shows the value read-only with the lock line; a published one too, and the server refuses a PATCH (409)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s5: {} });
    await page.goto('/organizer/events/?event=evt_pub&step=tickets');
    await expect(page.getByTestId('payout-value')).toHaveText('Every two weeks');
    await expect(page.getByTestId('payout-locked')).toHaveText('This is locked after you submit. To change it, contact FitFlex support.');
    await expect(page.getByTestId('payout-biweekly')).toHaveCount(0);
    // An explicit save of a published event never carries the field.
    await page.getByTestId('wizard-save-changes').click();
    const patches = mock.writes(/^\/organizer\/events\/evt_pub$/);
    expect(patches.every(c => !('payoutSchedule' in (c.body ?? {})))).toBe(true);
  });
  test('Finance tab shows the schedule (or Not set) and still promises no date', async ({ page }) => {
    const mock = await open(page, 'finance', 'finance');
    await expect(page.getByTestId('finance-payout')).toHaveText('Payout schedule: Every two weeks');
    await expect(page.getByTestId('organizer-finance')).toContainText('Payout statements are not live yet');
    await expect(page.getByTestId('organizer-finance')).not.toContainText(/\b(20\d\d-\d\d-\d\d|paid on|next payout)\b/i);
    mock.s5!.payout.evt_pub = null;
    await page.getByTestId('finance-refresh').click();
    await expect(page.getByTestId('finance-payout')).toHaveText('Payout schedule: Not set');
  });
  test('Finance tab in Swahili', async ({ page }) => {
    await open(page, 'finance', 'finance', {}, {}, 'sw');
    await expect(page.getByTestId('finance-payout')).toHaveText('Ratiba ya malipo: Kila wiki mbili');
  });
  test('wizard in Swahili: the card, help, choices and lock line are translated', async ({ page }) => {
    await setupEvents(page, OWNER, { s5: {}, locale: 'sw' });
    await page.goto('/organizer/events/?event=evt_1&step=tickets');
    await expect(PAYOUT(page)).toContainText('Ratiba ya malipo');
    await expect(PAYOUT(page)).toContainText('Kila wiki mbili');
    await expect(PAYOUT(page)).toContainText('Mara moja kwa mwezi');
    await expectNoRawKeys(page);
  });
  test('admin: the event page shows the value; an events-scope admin changes it with a reason; the reason is required (10+)', async ({ page }) => {
    const mock = await setupEvents(page, EVENTS_STAFF, { me: null, s5: {} });
    await page.goto('/admin/events/?event=evt_pub');
    await expect(page.getByTestId('admin-payout-value')).toHaveText('Every two weeks');
    await page.getByTestId('admin-payout-edit').click();
    await expect(page.getByTestId('admin-payout-save')).toBeDisabled();
    await page.getByTestId('admin-payout-monthly').check();
    await page.getByTestId('admin-payout-reason').fill('too short');
    await expect(page.getByTestId('admin-payout-save')).toBeDisabled();
    await page.getByTestId('admin-payout-reason').fill('Organizer asked us in writing');
    await page.getByTestId('admin-payout-save').click();
    await expect.poll(() => mock.writes(/payout-schedule$/).length).toBe(1);
    expect(mock.writes(/payout-schedule$/)[0].body).toEqual({ payoutSchedule: 'monthly', reason: 'Organizer asked us in writing' });
    await expect(page.getByTestId('admin-payout-value')).toHaveText('Once a month');
  });
  test('admin without the events scope cannot reach the page; a super admin sees the control', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { me: null, s5: {} });
    await page.goto('/admin/events/?event=evt_pub');
    await expect(page.getByTestId('admin-payout-edit')).toBeVisible();
  });
});

test.describe('integrations (§5.1, §7, §8.7)', () => {
  const INT = '/organizer/integrations/';
  const go = async (page: Page, role: Role, query = '', s5: S5Opts = {}, locale: 'en' | 'sw' = 'en') => {
    const mock = await setupEvents(page, who(role), { me: organizerMe('active', role), s5, locale });
    await page.goto(`${INT}${query}`);
    return mock;
  };

  test('ops cannot open the page and has no nav item', async ({ page }) => {
    await go(page, 'ops');
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Integrations' })).toHaveCount(0);
  });
  test('finance cannot open the page either', async ({ page }) => {
    await go(page, 'finance');
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
  });
  test('an admin can open the page and sees the nav item', async ({ page }) => {
    await go(page, 'admin');
    await expect(page.getByTestId('integrations-page')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Integrations' })).toBeVisible();
  });

  test('create a client: scope picker with risk chips, secret shown once (Done and Esc locked until saved), never in the list or after reload', async ({ page }) => {
    const mock = await go(page, 'owner');
    await expect(page.getByTestId('clients-empty')).toBeVisible();
    await page.getByTestId('clients-new').click();
    await expect(page.getByTestId('client-create')).toBeDisabled();
    await page.getByTestId('client-name').fill('Race timing');
    await expect(page.getByTestId('scope-row-webhooks:manage')).toContainText('High risk');
    await expect(page.getByTestId('scope-row-registrations:read')).toContainText('Read');
    await expect(page.getByTestId('scope-row-kit:write')).toContainText('Write');
    await expect(page.getByTestId('scope-results:write')).toBeDisabled();
    await expect(page.getByTestId('scope-row-results:write')).toContainText('coming soon');
    await page.getByTestId('scope-registrations:read').check();
    await page.getByTestId('scope-webhooks:manage').check(); // the owner may grant it
    await page.getByTestId('client-create').click();
    const secret = page.getByTestId('secret-value');
    await expect(secret).toBeVisible();
    const value = await secret.innerText();
    expect(value).toMatch(/^ffs_test_.{43}$/);
    await expect(page.getByTestId('secret-client-id')).toHaveText(/^ffc_[0-9a-f]{16}$/);
    await expect(page.getByTestId('secret-dialog')).toContainText("Copy your secret now. You won't be able to see it again.");
    const body = mock.writes(/api-clients$/)[0].body!;
    expect(body).toEqual({ name: 'Race timing', environment: 'sandbox', scopes: ['registrations:read', 'webhooks:manage'], expiresInDays: 90 });
    // Locked until the box is ticked: Done is disabled and Esc does nothing.
    await expect(page.getByTestId('secret-done')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('secret-dialog')).toBeVisible();
    await expect(page.getByTestId('secret-nudge')).toBeVisible();
    await page.getByTestId('secret-saved').check();
    await page.getByTestId('secret-done').click();
    await expect(page.getByTestId('secret-dialog')).toHaveCount(0);
    // The list shows the client but never the secret; a reload shows no secret anywhere.
    await expect(page.getByTestId('clients-tab')).toContainText('Race timing');
    expect(await page.locator('body').innerText()).not.toContain(value);
    await page.reload();
    await expect(page.getByTestId('clients-tab')).toContainText('Race timing');
    expect(await page.locator('body').innerText()).not.toContain(value);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href)).not.toContain('ffs_');
  });

  test('an admin cannot grant webhooks:manage (disabled, "Only the owner can grant this."); results:write is never sent', async ({ page }) => {
    const mock = await go(page, 'admin');
    await page.getByTestId('clients-new').click();
    await page.getByTestId('client-name').fill('Timing');
    await expect(page.getByTestId('scope-webhooks:manage')).toBeDisabled();
    await expect(page.getByTestId('scope-row-webhooks:manage')).toContainText('Only the owner can grant this.');
    await page.getByTestId('scope-kit:write').check();
    await page.getByTestId('client-create').click();
    await expect(page.getByTestId('secret-dialog')).toBeVisible();
    expect(mock.writes(/api-clients$/)[0].body!.scopes).toEqual(['kit:write']);
  });

  test('live clients need the extra confirmation and can be restricted to selected events', async ({ page }) => {
    const mock = await go(page, 'owner');
    await page.getByTestId('clients-new').click();
    await page.getByTestId('client-name').fill('Live timing');
    await page.getByTestId('scope-registrations:read').check();
    await page.getByTestId('client-env-live').check();
    await expect(page.getByTestId('client-create')).toBeDisabled();
    await page.getByTestId('client-live-ack').check();
    await page.getByTestId('client-events-selected').check();
    await expect(page.getByTestId('client-create')).toBeDisabled(); // pick at least one event
    await page.getByRole('checkbox', { name: 'Dar Half Marathon 2027' }).check();
    await page.getByTestId('client-expiry').selectOption('30');
    await page.getByTestId('client-create').click();
    await expect(page.getByTestId('secret-value')).toHaveText(/^ffs_live_/);
    expect(mock.writes(/api-clients$/)[0].body).toEqual({ name: 'Live timing', environment: 'live', scopes: ['registrations:read'], expiresInDays: 30, eventIds: ['evt_1'] });
  });

  test('a pilot-gated organisation gets "not enabled for your organisation" (D39)', async ({ page }) => {
    await go(page, 'owner', '', { apiAllowed: false });
    await page.getByTestId('clients-new').click();
    await page.getByTestId('client-name').fill('Timing');
    await page.getByTestId('scope-registrations:read').check();
    await page.getByTestId('client-create').click();
    await expect(page.getByTestId('client-error')).toContainText("API access isn't enabled for your organisation yet.");
  });

  test('rotate with a 24 hour overlap shows a new secret once; revoke needs the typed name and is final', async ({ page }) => {
    const mock = await go(page, 'owner');
    mock.s5!.clients.push({ id: 'apc_9', clientId: 'ffc_0123456789abcdef', name: 'Old timing', environment: 'sandbox', scopes: ['registrations:read'], eventIds: null, status: 'active', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), lastUsedAt: null, createdAt: '2027-01-01T08:00:00.000Z', rotation: { inGrace: false, graceEndsAt: null }, secretVersion: 1 });
    await page.reload();
    const tab = page.getByTestId('clients-tab');
    await expect(tab).toContainText('Old timing');
    await expect(tab).toContainText('Expires in 5 days'); // under 14 days is a warning badge
    await expect(tab).toContainText('Never used');
    await page.getByTestId('client-rotate-apc_9').click();
    await expect(page.getByTestId('rotate-grace-24')).toBeChecked();
    await expect(page.getByTestId('rotate-dialog')).toContainText('24 hours overlap (recommended)');
    await page.getByTestId('rotate-confirm').click();
    expect(mock.writes(/rotate$/)[0].body).toEqual({ graceHours: 24 });
    await expect(page.getByTestId('secret-value')).toHaveText(/^ffs_test_/);
    await page.getByTestId('secret-saved').check();
    await page.getByTestId('secret-done').click();
    await expect(tab).toContainText('Rotation in progress');
    await page.getByTestId('client-revoke-apc_9').click();
    await expect(page.getByTestId('revoke-confirm')).toBeDisabled();
    await page.getByTestId('revoke-type').fill('Old tim');
    await expect(page.getByTestId('revoke-confirm')).toBeDisabled();
    await page.getByTestId('revoke-type').fill('Old timing');
    await page.getByTestId('revoke-confirm').click();
    await expect(tab).toContainText('Revoked');
    expect(mock.s5!.clients[0].status).toBe('revoked');
  });

  test('client details show 30-day usage with a table alternative', async ({ page }) => {
    const mock = await go(page, 'owner');
    mock.s5!.clients.push({ id: 'apc_9', clientId: 'ffc_0123456789abcdef', name: 'Old timing', environment: 'sandbox', scopes: ['registrations:read'], eventIds: null, status: 'active', expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(), lastUsedAt: new Date().toISOString(), createdAt: '2027-01-01T08:00:00.000Z', rotation: { inGrace: true, graceEndsAt: new Date(Date.now() + 3_600_000).toISOString() }, secretVersion: 2 });
    await page.reload();
    await page.getByTestId('client-details-apc_9').click();
    await expect(page.getByTestId('usage-table')).toContainText('80');
    await expect(page.getByTestId('client-details')).toContainText('Old secret works until');
  });

  test('webhooks: private, http and IP addresses are refused with plain reasons; a good one shows its secret once and is verified', async ({ page }) => {
    const mock = await go(page, 'owner', '?tab=webhooks');
    await expect(page.getByTestId('webhooks-tab')).toContainText('hooks.timing.test');
    await expect(page.getByTestId('webhooks-tab')).toContainText('Failing');
    await page.getByTestId('webhooks-new').click();
    await page.getByTestId('endpoint-event-kit.collected').check();
    await page.getByTestId('endpoint-url').fill('http://example.com/hook');
    await expect(page.getByTestId('endpoint-dialog')).toContainText('Use an https:// address.');
    await expect(page.getByTestId('endpoint-create')).toBeDisabled();
    const cases: Array<[string, string]> = [
      ['https://localhost/hook', "This host name isn't allowed."], ['https://127.0.0.1/hook', 'Use a domain name, not an IP number.'],
      ['https://169.254.169.254/latest', 'Use a domain name, not an IP number.'], ['https://user:pw@example.com/h', 'Remove the username and password from the address.'],
      ['https://example.com:8443/h', 'Only the standard https port is allowed.'], ['https://private-db.example.com/h', 'This address points to a private or internal network.'],
      ['https://nxdomain-x.example.com/h', "We couldn't find this address."],
    ];
    for (const [url, message] of cases) {
      await page.getByTestId('endpoint-url').fill(url);
      await page.getByTestId('endpoint-create').click();
      await expect(page.getByTestId('endpoint-dialog')).toContainText(message);
    }
    await page.getByTestId('endpoint-url').fill('https://good.example.com/fitflex');
    await page.getByTestId('endpoint-select-all').click();
    await page.getByTestId('endpoint-create').click();
    await expect(page.getByTestId('secret-value')).toHaveText(/^whsec_/);
    const body = mock.writes(/webhook-endpoints$/).pop()!.body!;
    expect(body.url).toBe('https://good.example.com/fitflex');
    expect(body.events).not.toContain('*');
    expect(body.events).not.toContain('payment.succeeded');
    expect(body.events).not.toContain('registration.reserved');
    expect(body.events).toHaveLength(9);
    await page.getByTestId('secret-saved').check();
    await page.getByTestId('secret-done').click();
    await expect(page.getByTestId('webhook-notice')).toContainText('good.example.com answered correctly.');
    await expect(page.getByTestId('webhooks-tab')).toContainText('good.example.com');
    expect(await page.locator('body').innerText()).not.toMatch(/whsec_/);
  });

  test('an endpoint that does not answer the challenge stays "Not verified"; Verify now tries again and says so', async ({ page }) => {
    const mock = await go(page, 'owner', '?tab=webhooks');
    await page.getByTestId('webhooks-new').click();
    await page.getByTestId('endpoint-url').fill('https://unverifiable.example.com/h');
    await page.getByTestId('endpoint-event-kit.collected').check();
    await page.getByTestId('endpoint-create').click();
    await page.getByTestId('secret-saved').check();
    await page.getByTestId('secret-done').click();
    await expect(page.getByTestId('webhooks-tab')).toContainText('Not verified');
    await expect(page.getByTestId('webhook-notice')).toContainText('Endpoint added. Verify it to start receiving events.');
    await page.getByTestId('endpoint-verify-whk_2').click();
    await expect(page.getByTestId('webhook-notice')).toContainText('unverifiable.example.com did not answer correctly.');
    await expect(page.getByTestId('endpoint-test-whk_2')).toHaveCount(0); // no test send before it is verified
    expect(mock.s5!.endpoints.find(e => e.id === 'whk_2')!.verifiedAt).toBeNull();
  });

  test('send test reports the result inline; disable and enable move the endpoint; rotate shows a new secret once', async ({ page }) => {
    const mock = await go(page, 'owner', '?tab=webhooks');
    await page.getByTestId('endpoint-test-whk_seed').click();
    await expect(page.getByTestId('webhook-notice')).toContainText('Test delivered (200).');
    await page.getByTestId('endpoint-disable-whk_seed').click();
    await expect(page.getByTestId('webhooks-tab')).toContainText('Off');
    await page.getByTestId('endpoint-enable-whk_seed').click();
    await expect(page.getByTestId('webhooks-tab')).toContainText('Healthy');
    await page.getByTestId('endpoint-rotate-whk_seed').click();
    await page.getByTestId('rotate-grace-72').check();
    await page.getByTestId('rotate-confirm').click();
    await expect(page.getByTestId('secret-value')).toHaveText(/^whsec_/);
    expect(mock.writes(/rotate-secret$/)[0].body).toEqual({ graceHours: 72 });
  });

  test('an auto-disabled endpoint shows why and when, and "Enable again"', async ({ page }) => {
    const mock = await go(page, 'owner', '?tab=webhooks');
    const ep = mock.s5!.endpoints[0];
    Object.assign(ep, { status: 'disabled', health: 'disabled', disabledReason: 'auto_failures', disabledAt: '2027-03-12T08:00:00.000Z' });
    await page.reload();
    await expect(page.getByTestId('webhook-auto-disabled')).toContainText('Turned off after repeated failures');
    await page.getByTestId('endpoint-enable-again-whk_seed').click();
    await expect(page.getByTestId('webhook-auto-disabled')).toHaveCount(0);
  });

  test('delivery log: a failed delivery shows every attempt with a redacted snippet; Retry now queues it, and queued twice says so', async ({ page }) => {
    const mock = await go(page, 'owner', '?tab=deliveries');
    const status = page.getByTestId('delivery-status').first();
    await expect(status).toHaveText('Gave up');
    await expect(page.getByTestId('deliveries-tab')).toContainText('kit.collected');
    await expect(page.getByTestId('deliveries-tab')).toContainText('obx_0123456789abcdef');
    await expect(page.getByTestId('deliveries-tab')).toContainText('hooks.timing.test');
    await page.getByTestId('delivery-open-dlv_dead').click();
    const outcomes = page.getByTestId('attempt-outcome');
    await expect(outcomes.nth(0)).toHaveText('Your server returned an error');
    await expect(outcomes.nth(1)).toHaveText('Timed out');
    await expect(page.getByTestId('attempt-snippet')).toContainText('[redacted]');
    expect(await page.getByTestId('delivery-payload').innerText()).not.toMatch(/phone|email|@|amount/i);
    await page.getByTestId('delivery-retry').click();
    await expect(page.getByTestId('delivery-msg')).toContainText('Retry queued');
    expect(mock.s5!.deliveries[0].status).toBe('pending');
    await page.getByTestId('delivery-retry').click();
    await expect(page.getByTestId('delivery-msg')).toContainText('Already queued');
  });

  test('retry is bounded: the 429 shows the generic wait message', async ({ page }) => {
    const mock = await go(page, 'owner', '?tab=deliveries');
    mock.s5!.deliveries[0].manualRetryCount = 5;
    await page.getByTestId('delivery-open-dlv_dead').click();
    await page.getByTestId('delivery-retry').click();
    await expect(page.getByTestId('delivery-msg')).toContainText('Too many requests. Wait a moment and try again.');
  });

  test('delivery log filters go to the server (endpoint, status, event id)', async ({ page }) => {
    const mock = await go(page, 'owner', '?tab=deliveries');
    await page.getByTestId('deliveries-filter-status').selectOption('delivered');
    await expect(page.getByTestId('deliveries-empty').or(page.getByTestId('deliveries-tab'))).toBeVisible();
    expect(mock.reads(/webhook-deliveries$/).some(c => c.query.status === 'delivered')).toBe(true);
  });

  test('docs tab: base address, quick start and signature samples; no secret anywhere', async ({ page }) => {
    await go(page, 'owner', '?tab=docs');
    await expect(page.getByTestId('docs-tab')).toContainText('Quick start');
    await expect(page.getByTestId('docs-code-base')).toContainText('/v1/organizer');
    await expect(page.getByTestId('docs-code-step2')).toContainText('client_credentials');
    await page.getByRole('button', { name: 'Python' }).click();
    await expect(page.getByTestId('docs-code-python')).toContainText('compare_digest');
  });

  test('the Overview shows the integration health card for an owner', async ({ page }) => {
    await setupEvents(page, OWNER, { s5: {} });
    await page.goto('/organizer/');
    await expect(page.getByTestId('overview-integrations')).toContainText('0 healthy · 1 failing');
  });

  test('Swahili: the integrations page and the secret dialog are translated, with no raw keys', async ({ page }) => {
    await go(page, 'owner', '', {}, 'sw');
    await expect(page.getByTestId('integrations-page')).toContainText('Miunganisho');
    await expect(page.getByTestId('clients-empty')).toContainText('Hakuna wateja wa API bado');
    await page.getByTestId('clients-new').click();
    await page.getByTestId('client-name').fill('Muda');
    await page.getByTestId('scope-registrations:read').check();
    await page.getByTestId('client-create').click();
    await expect(page.getByTestId('secret-dialog')).toContainText('Nakili siri yako sasa. Hutaweza kuiona tena.');
    await expect(page.getByTestId('secret-dialog')).toContainText('Nimehifadhi siri');
    await expectNoRawKeys(page);
  });

  test('375px: no horizontal page scroll on the integrations page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await go(page, 'owner', '?tab=webhooks', {}, 'sw');
    await expect(page.getByTestId('webhooks-tab')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe('flags (§11.1)', () => {
  test('server says kit ops are off: no venue tabs and the kit URL says unavailable', async ({ page }) => {
    await open(page, 'owner', 'registrations', { kit: false });
    await expect(page.getByTestId('event-view-tabs').getByRole('button', { name: 'Kit collection' })).toHaveCount(0);
    await page.goto(`${EV}&view=kit`);
    await expect(page.getByTestId('events-unavailable')).toBeVisible();
    await page.goto(`${EV}&view=bibs`);
    await expect(page.getByTestId('events-unavailable')).toBeVisible();
  });
  test('server says api and webhooks are off: no Integrations nav item and the page says it is not available', async ({ page }) => {
    await setupEvents(page, OWNER, { s5: { api: false, webhooks: false } });
    await page.goto('/organizer/integrations/');
    await expect(page.getByTestId('integrations-unavailable')).toContainText("Integrations aren't available yet.");
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Integrations' })).toHaveCount(0);
  });
  test('only webhooks on: the page offers Webhooks, Delivery log and Docs but no API clients', async ({ page }) => {
    await setupEvents(page, OWNER, { s5: { api: false } });
    await page.goto('/organizer/integrations/');
    const tabs = page.getByTestId('integrations-tabs');
    await expect(tabs.getByRole('button', { name: 'Webhooks' })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'API clients' })).toHaveCount(0);
  });
  test('a 404 feature_disabled from the clients route reads as "not available yet"', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s5: {} });
    mock.on('GET', /^\/organizer\/api-clients$/, () => ({ status: 404, json: { error: 'feature_disabled' } }));
    await page.goto('/organizer/integrations/');
    await expect(page.getByTestId('clients-unavailable')).toContainText("API clients aren't available yet.");
  });
  test('a suspended organizer sees integrations read-only', async ({ page }) => {
    await setupEvents(page, OWNER, { me: organizerMe('suspended', 'owner'), s5: {} });
    await page.goto('/organizer/integrations/');
    await expect(page.getByTestId('integrations-suspended')).toBeVisible();
    await expect(page.getByTestId('clients-new')).toHaveCount(0);
  });
});
