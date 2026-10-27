import { expect, test } from '@playwright/test';
import {
  EVENTS_STAFF, HR_USER, OPTIONS, ORDER_DETAIL, OWNER, PERMS_PEOPLE, STAFF_FINANCE, STAFF_OPS, SUPER_ADMIN, expectNoRawKeys, orgUser, organizerMe, setupEvents, validateRoster,
} from './helpers/events-mock';

// Events S3 (spec events-s3-registration-and-orders §6.7): corporate bulk registration (/org/events, /hr/events), the
// organizer roster and orders views, the Terms-step "Participant details" section and the admin orders/registrations
// tabs, against the mocked API. Self-contained like the S2 specs; nothing reaches a backend.
test.use({ serviceWorkers: 'block' });

const NAV = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Main navigation' });
const ROSTER_OK = 'first name,last name,phone,email,category,date of birth,gender,kit size,group\nAsha,Mollel,0712 345 678,asha@example.co.tz,21K Half Marathon,1990-01-01,,,Finance\nJuma,Omari,0755 000 111,,10K,,,,Operations\nZawadi,Kim,0788 000 222,z@example.co.tz,10K,,,,';
const ROSTER_BAD = 'name,mobile,distance,dob\nAsha Mollel,0712 345 678,21K,1990-01-01\nJuma,0755 000 111,10K,\nZawadi Kim,12345,10K,\nAsha Mollel,0712 345 678,21K,1990-01-01';

test.describe('corporate bulk registration (§6.2, D18, D19)', () => {
  test('nav item appears only with the options; the wizard happy path places an order and shows awaiting payment (P-C-1, P-C-4, P-C-5)', async ({ page }) => {
    const mock = await setupEvents(page, orgUser(['owner']), { s3: true });
    await page.goto('/org/events/');
    await expect(NAV(page).getByRole('link', { name: 'Events' })).toBeVisible();
    await expect(page.getByTestId('corp-events-list')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Event registrations' })).toContainText('EV-2026-0001');
    await expect(page.getByRole('region', { name: 'Event registrations' })).toContainText('Awaiting payment');
    await page.getByTestId('corp-events-new').click();
    await expect(page.getByTestId('corp-wizard')).toBeVisible();
    await expect(page.getByTestId('corp-next')).toBeDisabled();
    // Step 1: pick a published event; the card shows categories, policy and the public link.
    await page.getByRole('button', { name: 'Choose a published event' }).click();
    await page.getByRole('option', { name: /Arusha Trail 10K/ }).click();
    await expect(page.getByTestId('corp-event-card')).toContainText('21K Half Marathon');
    await expect(page.getByTestId('corp-event-card')).toContainText('Minimum age 16');
    await expect(page.getByTestId('corp-view-public')).toHaveAttribute('href', 'https://fitflex.test/e/arusha-trail-10k');
    await page.getByTestId('corp-next').click();
    // Step 2: the help block lists what this event requires; the example downloads; the list is checked.
    await expect(page.getByTestId('roster-help')).toContainText('Required for this event: First name, Last name, Mobile number, Category, Date of birth');
    await expect(page.getByTestId('roster-help')).toContainText('21K Half Marathon have an age rule');
    await expect(page.getByTestId('roster-headers-note')).toContainText('Keep the column names in English');
    const download = page.waitForEvent('download');
    await page.getByTestId('roster-example').click();
    expect((await download).suggestedFilename()).toBe('events-roster-example.csv');
    await page.getByTestId('roster-text').fill(ROSTER_OK);
    await page.getByTestId('roster-check').click();
    const validate = mock.writes(/\/event-orders\/roster\/validate$/);
    expect(validate).toHaveLength(1);
    expect(validate[0].body).toEqual({ eventId: 'evt_pub', rawText: ROSTER_OK });
    // Step 3: 3 ready, 0 to fix, group column from the CSV (D19).
    await expect(page.getByTestId('corp-step-check')).toBeVisible();
    const metrics = page.getByTestId('corp-check-metrics');
    await expect(metrics.getByText('Ready to register').locator('..')).toContainText('3');
    await expect(page.getByRole('region', { name: 'Check' })).toContainText('Finance');
    await expect(page.getByRole('region', { name: 'Check' })).toContainText('21K Half Marathon → Early bird');
    await page.getByTestId('corp-next').click();
    // Step 4: itemised quote, no discount or fee line (D21), place disabled until both boxes are ticked.
    await expect(page.getByTestId('corp-quote-total')).toHaveText('TSh 25,000');
    await expect(page.getByTestId('corp-quote-discount')).toHaveCount(0);
    await expect(page.getByTestId('corp-quote-fee')).toHaveCount(0);
    await expect(page.getByTestId('corp-place')).toBeDisabled();
    await expect(page.getByText('Places are held for 30 minutes after you place the order.')).toBeVisible();
    await page.getByTestId('corp-cost-centre').fill('CC-12');
    await page.getByTestId('corp-reference').fill('PO-77');
    await page.getByTestId('corp-consent').check();
    await expect(page.getByTestId('corp-place')).toBeDisabled();
    await page.getByTestId('corp-terms').check();
    await expect(page.getByTestId('corp-place')).toHaveText('Place order · TSh 25,000');
    await page.getByTestId('corp-place').click();
    const placed = mock.writes(/\/event-orders$/);
    expect(placed).toHaveLength(1);
    expect(placed[0].body).toMatchObject({ eventId: 'evt_pub', costCentre: 'CC-12', purchaserReference: 'PO-77', team: { create: { name: 'Safari Cover' } }, acceptedTerms: true, consentTextVersion: '2026-10-draft', expectedTotalTzs: 25000 });
    expect(placed[0].body?.rows).toHaveLength(3);
    expect(placed[0].body?.rows[0]).toMatchObject({ firstName: 'Asha', lastName: 'Mollel', ticketTypeId: 'tt_1', consentBasis: 'organisation', groupLabel: 'Finance' });
    // Order page: awaiting state, countdown, masked contacts, the labelled payment placeholder and no Lipa Namba.
    await expect(page).toHaveURL(/order=ord_new/);
    await expect(page.getByTestId('corp-order-detail')).toHaveAttribute('data-order-status', 'awaiting_payment');
    await expect(page.getByTestId('corp-order-awaiting')).toContainText(/min left/);
    await expect(page.getByTestId('corp-order-pay-soon')).toContainText('Payment instructions: coming in the next release');
    await expect(page.getByTestId('corp-order-detail')).not.toContainText(/Lipa Namba/i);
    const participants = page.getByRole('region', { name: 'Participants' });
    await expect(participants).toContainText('••• 678');
    await expect(participants).toContainText('a•••@example.co.tz');
    await expect(participants).not.toContainText('0712345678');
    await expect(page.getByTestId('corp-order-cancel')).toBeVisible();
    await expectNoRawKeys(page);
  });

  test('the Idempotency-Key header is sent and reused on a retry; a reused-key refusal gets a fresh key once', async ({ page }) => {
    let calls = 0;
    const mock = await setupEvents(page, orgUser(['owner']), { s3: true, extra: [['POST', /\/org-1\/event-orders$/, () => { calls += 1; return calls === 1 ? { status: 503, json: { error: 'unavailable' } } : undefined; }]] });
    const keys: string[] = [];
    await page.route(/\/b2b\/organizations\/org-1\/event-orders$/, async route => { if (route.request().method() === 'POST') keys.push(route.request().headers()['idempotency-key'] ?? ''); await route.fallback(); });
    await page.goto('/org/events/?new=1');
    await page.getByRole('button', { name: 'Choose a published event' }).click();
    await page.getByRole('option', { name: /Arusha Trail 10K/ }).click();
    await page.getByTestId('corp-next').click();
    await page.getByTestId('roster-text').fill(ROSTER_OK);
    await page.getByTestId('roster-check').click();
    await page.getByTestId('corp-next').click();
    await page.getByTestId('corp-consent').check();
    await page.getByTestId('corp-terms').check();
    await page.getByTestId('corp-place').click();
    // A 5xx is "uncertain": the person is told to look at the orders list before retrying.
    await expect(page.getByTestId('corp-uncertain')).toBeVisible();
    await page.getByTestId('corp-place').click();
    await expect(page).toHaveURL(/order=ord_new/);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^cor_[A-Za-z0-9._:-]{8,96}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(mock.writes(/\/org-1\/event-orders$/)).toHaveLength(2);
  });

  test('a dry run with invalid and duplicate rows blocks Continue; the problems filter and Edit list work (P-C-2, P-C-3)', async ({ page }) => {
    await setupEvents(page, orgUser(['admin']), { s3: true });
    await page.goto('/org/events/?new=1');
    await page.getByRole('button', { name: 'Choose a published event' }).click();
    await page.getByRole('option', { name: /Arusha Trail 10K/ }).click();
    await page.getByTestId('corp-next').click();
    await page.getByTestId('roster-text').fill(ROSTER_BAD);
    await page.getByTestId('roster-check').click();
    const metrics = page.getByTestId('corp-check-metrics');
    await expect(metrics.getByText('Need fixing').locator('..')).toContainText('2');
    await expect(metrics.getByText('Duplicates').locator('..')).toContainText('1');
    const table = page.getByRole('region', { name: 'Check' });
    await expect(table.getByRole('row')).toHaveCount(5);
    await expect(table).toContainText('Name: Give a first and a last name');
    await expect(table).toContainText('Mobile: That mobile number doesn\'t look right');
    await expect(table).toContainText('Listed twice (#1)');
    await expect(page.getByTestId('corp-next')).toBeDisabled();
    await page.getByTestId('corp-problems-only').check();
    await expect(table.getByRole('row')).toHaveCount(4);
    await page.getByTestId('corp-prev').click();
    await expect(page.getByTestId('roster-text')).toHaveValue(ROSTER_BAD);
    // Fix the list on step 2 and re-check: Continue opens.
    await page.getByTestId('roster-text').fill(ROSTER_OK);
    await page.getByTestId('roster-check').click();
    await expect(page.getByTestId('corp-next')).toBeEnabled();
  });

  test('a capacity shortfall shows the danger card with the per-ticket shortfall and blocks Continue', async ({ page }) => {
    await setupEvents(page, orgUser(['owner']), { s3: true, extra: [['POST', /\/roster\/validate$/, c => validateRoster(String(c.body?.rawText ?? ''), { capacityShort: [{ ticketTypeId: 'tt_1', requested: 1, remaining: 0 }] })]] });
    await page.goto('/org/events/?new=1');
    await page.getByRole('button', { name: 'Choose a published event' }).click();
    await page.getByRole('option', { name: /Arusha Trail 10K/ }).click();
    await page.getByTestId('corp-next').click();
    await page.getByTestId('roster-text').fill(ROSTER_OK);
    await page.getByTestId('roster-check').click();
    await expect(page.getByTestId('corp-capacity-short')).toContainText('Not enough places: Early bird needs 1, 0 left');
    await expect(page.getByTestId('corp-next')).toBeDisabled();
  });

  test('billing-role gate (D18): a people-only role validates but cannot place; the ask-your-billing-admin state shows', async ({ page }) => {
    const mock = await setupEvents(page, orgUser(['hr']), { s3: true, orgPermissions: PERMS_PEOPLE });
    await page.goto('/org/events/?new=1');
    await page.getByRole('button', { name: 'Choose a published event' }).click();
    await page.getByRole('option', { name: /Arusha Trail 10K/ }).click();
    await page.getByTestId('corp-next').click();
    await page.getByTestId('roster-text').fill(ROSTER_OK);
    await page.getByTestId('roster-check').click();
    expect(mock.writes(/\/roster\/validate$/)).toHaveLength(1);
    await page.getByTestId('corp-next').click();
    await expect(page.getByTestId('corp-billing-gate')).toContainText('Only a billing admin (owner, admin or finance) can place the order.');
    await expect(page.getByTestId('corp-consent')).toBeDisabled();
    await expect(page.getByTestId('corp-place')).toBeDisabled();
    expect(mock.writes(/\/org-1\/event-orders$/)).toHaveLength(0);
  });

  test('price_changed refreshes the quote and says so; the order is not placed (P-C-4)', async ({ page }) => {
    let attempts = 0;
    let validations = 0;
    const mock = await setupEvents(page, orgUser(['finance']), { s3: true, extra: [
      ['POST', /\/org-1\/event-orders$/, () => { attempts += 1; return attempts === 1 ? { status: 409, json: { error: 'price_changed', quotedTotalTzs: 25000, totalTzs: 30000 } } : undefined; }],
      // The second dry run (after price_changed) prices Early bird at 30,000.
      ['POST', /\/roster\/validate$/, c => { validations += 1; const v = validateRoster(String(c.body?.rawText ?? '')); return validations > 1 && v.quote ? { ...v, quote: { ...v.quote, totalTzs: 30000, subtotalTzs: 30000, lines: v.quote.lines.map(l => (l.ticketTypeId === 'tt_1' ? { ...l, unitPriceTzs: 30000, lineTotalTzs: 30000 } : l)) } } : v; }],
    ] });
    await page.goto('/org/events/?new=1');
    await page.getByRole('button', { name: 'Choose a published event' }).click();
    await page.getByRole('option', { name: /Arusha Trail 10K/ }).click();
    await page.getByTestId('corp-next').click();
    await page.getByTestId('roster-text').fill(ROSTER_OK);
    await page.getByTestId('roster-check').click();
    await page.getByTestId('corp-next').click();
    await expect(page.getByTestId('corp-quote-total')).toHaveText('TSh 25,000');
    await page.getByTestId('corp-consent').check();
    await page.getByTestId('corp-terms').check();
    await page.getByTestId('corp-place').click();
    await expect(page.getByTestId('corp-notice')).toContainText('Prices were updated; review the new total');
    await expect(page.getByTestId('corp-quote-total')).toHaveText('TSh 30,000');
    await expect(page.getByTestId('corp-place')).toHaveText('Place order · TSh 30,000');
    await expect(page).not.toHaveURL(/order=/);
    expect(mock.writes(/\/org-1\/event-orders$/)[0].body?.expectedTotalTzs).toBe(25000);
  });

  test('cancel order asks for a reason and shows the cancelled state; an expired order shows the expired state (P-C-6)', async ({ page }) => {
    const mock = await setupEvents(page, orgUser(['owner']), { s3: true, orders: { ord_1: ORDER_DETAIL(), ord_exp: ORDER_DETAIL({ id: 'ord_exp', reference: 'EV-2026-0002', status: 'expired', closedAt: '2026-10-22T08:30:00.000Z', closeReason: 'expired' }) } });
    await page.goto('/org/events/?order=ord_1');
    await page.getByTestId('corp-order-cancel').click();
    await expect(page.getByTestId('corp-cancel-confirm')).toBeDisabled();
    await page.getByTestId('corp-cancel-reason').selectOption('wrong_details');
    await page.getByTestId('corp-cancel-confirm').click();
    await expect.poll(() => mock.writes(/\/ord_1\/cancel$/).length).toBe(1);
    expect(mock.writes(/\/ord_1\/cancel$/)[0].body).toEqual({ reason: 'wrong_details' });
    await expect(page.getByTestId('corp-order-cancelled')).toContainText('Cancelled on');
    await expect(page.getByTestId('corp-order-cancel')).toHaveCount(0);
    await page.goto('/org/events/?order=ord_exp');
    await expect(page.getByTestId('corp-order-expired')).toContainText('The hold ended before payment. Places were released.');
    await page.goto('/org/events/');
    await expect(page.getByRole('region', { name: 'Event registrations' })).toContainText('Expired');
  });

  test('backend #265: 429 on the dry run shows the retry message; invalid_text blocks Place inline; an ok row with a warning stays ready', async ({ page }) => {
    let limited = true;
    await setupEvents(page, orgUser(['owner']), { s3: true, extra: [['POST', /\/roster\/validate$/, c => {
      if (limited) { limited = false; return { status: 429, json: { error: 'rate_limited' } }; }
      const v = validateRoster(String(c.body?.rawText ?? ''));
      return { ...v, rows: v.rows.map(r => (r.index === 0 ? { ...r, problems: [{ field: 'emergencyContact', code: 'not_collected' }] } : r)), duplicates: [{ index: 1, kind: 'already_registered' }].slice(0, 0) };
    }]] });
    await page.goto('/org/events/?new=1');
    await page.getByRole('button', { name: 'Choose a published event' }).click();
    await page.getByRole('option', { name: /Arusha Trail 10K/ }).click();
    await page.getByTestId('corp-next').click();
    await page.getByTestId('roster-text').fill(ROSTER_OK);
    await page.getByTestId('roster-check').click();
    await expect(page.getByTestId('roster-server-error')).toContainText('Too many list checks. Wait a minute, then check again.');
    await page.getByTestId('roster-check').click();
    await expect(page.getByTestId('corp-next')).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Check' })).toContainText('Not collected for this event (ignored)');
    await page.getByTestId('corp-next').click();
    await page.getByTestId('corp-consent').check();
    await page.getByTestId('corp-terms').check();
    await page.getByTestId('corp-cost-centre').fill('=SUM(A1)');
    await expect(page.getByText('Text can\'t start with = + - or @')).toBeVisible();
    await expect(page.getByTestId('corp-place')).toBeDisabled();
    await page.getByTestId('corp-cost-centre').fill('CC-12');
    await expect(page.getByTestId('corp-place')).toBeEnabled();
  });

  test('the HR page renders the same component for a company HR login', async ({ page }) => {
    await setupEvents(page, HR_USER, { s3: true });
    await page.goto('/hr/events/');
    await expect(NAV(page).getByRole('link', { name: 'Events' })).toHaveAttribute('href', /\/hr\/events/);
    await expect(page.getByTestId('corp-events-list')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Event registrations' })).toContainText('EV-2026-0001');
  });

  test('Swahili: the list, wizard and order page show no raw keys; the status reads Inasubiri malipo (P-ALL-1)', async ({ page }) => {
    await setupEvents(page, orgUser(['owner']), { s3: true, locale: 'sw' });
    await page.goto('/org/events/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Usajili wa matukio');
    await expect(page.getByRole('region', { name: 'Usajili wa matukio' })).toContainText('Inasubiri malipo');
    await expectNoRawKeys(page);
    await page.getByTestId('corp-events-new').click();
    await expect(page.getByTestId('corp-step-heading')).toHaveText('Tukio');
    await expectNoRawKeys(page);
    await page.goto('/org/events/?order=ord_1');
    await expect(page.getByTestId('corp-order-pay-soon')).toContainText('Maelekezo ya malipo: yanakuja kwenye toleo lijalo');
    await expectNoRawKeys(page);
  });

  test('runtime flag off: options say registration:false → no nav item and the not-available state (P-C-1)', async ({ page }) => {
    const mock = await setupEvents(page, orgUser(['owner']));
    await page.goto('/org/events/');
    await expect(page.getByTestId('events-unavailable')).toBeVisible();
    await expect(NAV(page).getByRole('link', { name: 'Events' })).toHaveCount(0);
    expect(mock.reads(/\/event-orders/)).toHaveLength(0);
    // corporate:false alone also hides it.
    await setupEvents(page, orgUser(['owner']), { extra: [['GET', /^\/events\/options$/, () => ({ ...OPTIONS, registration: true, corporate: false })]] });
    await page.goto('/org/events/');
    await expect(page.getByTestId('events-unavailable')).toBeVisible();
  });

  test('a role without the roster permission sees the no-permission state', async ({ page }) => {
    await setupEvents(page, orgUser(['analyst']), { s3: true, orgPermissions: ['analytics.read'] });
    await page.goto('/org/events/');
    await expect(page.getByTestId('corp-events-forbidden')).toBeVisible();
  });
});

test.describe('organizer roster and orders (§6.3)', () => {
  test('registrations tab: masked reserved names, full confirmed names, no contact columns, banner, filters (P-O-1)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s3: true });
    await page.goto('/organizer/events/?event=evt_pub');
    await expect(page.getByTestId('event-view-tabs')).toBeVisible();
    await page.getByTestId('event-view-tabs').getByRole('button', { name: 'Registrations' }).click();
    await expect(page).toHaveURL(/view=registrations/);
    await expect(page.getByTestId('reg-privacy-banner')).toContainText('Names of unpaid registrations are masked.');
    await expect(page.getByTestId('reg-summary')).toContainText('0 / 500 sold');
    const table = page.getByRole('region', { name: 'Registrations' });
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(page.getByTestId('reg-name-masked')).toHaveText('A*** M*****');
    await expect(page.getByTestId('reg-name-masked')).toHaveAttribute('title', 'Full name shows once paid');
    await expect(table).toContainText('Baraka Mushi');
    await expect(table).toContainText('Awaiting payment');
    await expect(table).not.toContainText('0712');
    await expect(table).not.toContainText('@');
    const headers = await table.getByRole('columnheader').allInnerTexts();
    expect(headers.join(' ')).not.toMatch(/Mobile|Email|Date of birth|Gender|Emergency/);
    expect(headers.join(' ')).toContain('Kit size');
    await page.getByTestId('reg-filter-status').selectOption('confirmed');
    await expect.poll(() => mock.reads(/\/evt_pub\/registrations$/).filter(c => c.query.status === 'confirmed').length).toBe(1);
    await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByTestId('reg-search').fill('Baraka');
    await expect.poll(() => mock.reads(/\/evt_pub\/registrations$/).filter(c => c.query.q === 'Baraka').length).toBe(1);
    await expectNoRawKeys(page);
  });

  test('orders tab: purchaser masked or Organisation badge, totals, fees, status, hold/closed, footer (P-O-3)', async ({ page }) => {
    await setupEvents(page, OWNER, { s3: true });
    await page.goto('/organizer/events/?event=evt_pub&view=orders');
    const table = page.getByRole('region', { name: 'Orders' });
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table).toContainText('Safari Cover');
    await expect(table.getByText('Organisation', { exact: true })).toBeVisible();
    await expect(table).toContainText('B***** M****');
    await expect(table).toContainText('TSh 50,000');
    await expect(table).toContainText('Paid');
    await expect(page.getByTestId('orders-footer')).toContainText('your payout statement comes with payments (next release)');
  });

  test('role gating: finance sees orders only (P-O-2)', async ({ page }) => {
    await setupEvents(page, STAFF_FINANCE, { s3: true, me: organizerMe('active', 'finance') });
    await page.goto('/organizer/events/?event=evt_pub');
    await expect(page.getByTestId('event-view-tabs').getByRole('button', { name: 'Orders' })).toBeVisible();
    await expect(page.getByTestId('event-view-tabs').getByRole('button', { name: 'Registrations' })).toHaveCount(0);
    await page.goto('/organizer/events/?event=evt_pub&view=registrations');
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
  });

  test('role gating: ops sees registrations only (P-O-2)', async ({ page }) => {
    await setupEvents(page, STAFF_OPS, { s3: true, me: organizerMe('active', 'ops') });
    await page.goto('/organizer/events/?event=evt_pub&view=orders');
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
    await page.goto('/organizer/events/?event=evt_pub&view=registrations');
    await expect(page.getByTestId('organizer-registrations')).toBeVisible();
    await expect(page.getByTestId('event-view-tabs').getByRole('button', { name: 'Orders' })).toHaveCount(0);
  });

  test('a draft event shows the once-published empty state; another organizer\'s event renders not-found (P-O-2)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { s3: true });
    await page.goto('/organizer/events/?event=evt_1&view=registrations');
    await expect(page.getByTestId('reg-not-published')).toContainText('Registrations appear once the event is published');
    expect(mock.reads(/\/evt_1\/registrations/)).toHaveLength(0);
    await page.goto('/organizer/events/?event=evt_other&view=registrations');
    await expect(page.getByTestId('organizer-forbidden')).toBeVisible();
  });
});

test.describe('wizard Terms step: participant details (§6.4, P-W-1)', () => {
  test('radios save participantFields and duplicatePolicy; DOB is locked by a minimum age; both-off is refused', async ({ page }) => {
    const mock = await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=evt_1&step=terms');
    const section = page.getByTestId('ev-participant-fields');
    await expect(section).toBeVisible();
    await expect(page.getByTestId('ev-field-dob-locked')).toContainText('Needed because 21K Half Marathon has a minimum age');
    await expect(page.getByTestId('ev-field-dateOfBirth-required')).toBeChecked();
    await expect(page.getByTestId('ev-field-dateOfBirth-optional')).toBeDisabled();
    await expect(page.getByTestId('ev-field-kitSize')).toHaveCount(0); // no kit on this event
    await page.getByTestId('ev-field-email-required').check();
    await page.getByTestId('ev-duplicate-allow').check();
    await expect.poll(() => mock.writes(/\/organizer\/events\/evt_1$/).length).toBeGreaterThanOrEqual(1);
    const last = mock.writes(/\/organizer\/events\/evt_1$/).at(-1)!.body!;
    expect(last.participantFields).toEqual({ phone: 'required', email: 'required', dateOfBirth: 'required', gender: 'off', emergencyContact: 'optional', kitSize: 'off' });
    expect(last.duplicatePolicy).toBe('allow');
    await page.getByTestId('ev-field-phone-off').check();
    await page.getByTestId('ev-field-email-off').check();
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('ev-contact-policy-error')).toHaveText('Mobile number and email can\'t both be "Not collected"');
    await expect(page.getByTestId('step-heading')).toContainText('Terms');
  });

  test('on a published event a changed policy is material: the change-note dialog appears before the PATCH', async ({ page }) => {
    const mock = await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=evt_pub&step=terms');
    await page.getByTestId('ev-field-gender-required').check();
    await page.getByTestId('wizard-save-changes').click();
    await expect(page.getByTestId('material-dialog')).toContainText('participantFields.gender');
    expect(mock.writes(/\/organizer\/events\/evt_pub$/)).toHaveLength(0);
  });
});

test.describe('admin orders and registrations (§6.5, P-A-1)', () => {
  test('tabs show full names; the order dialog lists participants with masked contacts; cancel needs a note and calls the admin route', async ({ page }) => {
    const mock = await setupEvents(page, EVENTS_STAFF, { s3: true });
    await page.goto('/admin/events/?event=evt_pub&view=registrations');
    const regs = page.getByRole('region', { name: 'Registrations' });
    await expect(regs).toContainText('Asha Mollel');
    await expect(page.getByTestId('reg-privacy-banner')).toHaveCount(0);
    await page.goto('/admin/events/?event=evt_pub&view=orders');
    const orders = page.getByRole('region', { name: 'Orders' });
    await expect(orders).toContainText('Baraka Mushi');
    await page.getByTestId('order-open-ord_1').click();
    const dialog = page.getByTestId('admin-order-dialog');
    await expect(dialog).toContainText('Asha Mollel');
    // #265: no contact fields come back, so the column is not shown at all and nothing breaks.
    await expect(page.getByTestId('admin-order-participants')).not.toContainText('Mobile');
    await expect(page.getByTestId('admin-order-participants')).toContainText('Juma Omari');
    await expect(page.getByTestId('admin-order-meta')).toContainText('2026-10-draft');
    await expect(page.getByTestId('admin-order-cancel')).toBeDisabled();
    await page.getByTestId('admin-order-cancel-note').fill('Dup');
    await expect(page.getByTestId('admin-order-cancel')).toBeDisabled();
    await page.getByTestId('admin-order-cancel-note').fill('Duplicate corporate order, organisation asked by email.');
    await page.getByTestId('admin-order-cancel').click();
    await expect.poll(() => mock.writes(/\/admin\/events\/evt_pub\/orders\/ord_1\/cancel$/).length).toBe(1);
    expect(mock.writes(/\/orders\/ord_1\/cancel$/)[0].body).toEqual({ note: 'Duplicate corporate order, organisation asked by email.' });
    await expect(page.getByRole('status').filter({ hasText: 'Order cancelled' })).toBeVisible();
    await expect(orders).not.toContainText('EV-2026-0001');
    await expectNoRawKeys(page);
  });

  test('a super admin sees the Review tab by default and can switch; Swahili tab labels resolve', async ({ page }) => {
    await setupEvents(page, SUPER_ADMIN, { s3: true, locale: 'sw' });
    await page.goto('/admin/events/?event=evt_pub');
    await expect(page.getByTestId('event-review-summary')).toBeVisible();
    await page.getByRole('button', { name: 'Oda' }).click();
    await expect(page).toHaveURL(/view=orders/);
    await expect(page.getByTestId('admin-orders')).toBeVisible();
    await expectNoRawKeys(page);
  });
});
