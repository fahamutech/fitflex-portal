import { expect, test } from '@playwright/test';
import { DOC, OWNER, PUBLISHED, STAFF_OPS, expectNoRawKeys, organizerMe, setupEvents } from './helpers/events-mock';

// Events list (spec §6.1), the wizard (§6.2): draft creation, validation, autosave, version conflict, submit; lifecycle
// (§7.2), the material-change dialog (§7.4) and the change log (§7.5), against the mocked API.
test.use({ serviceWorkers: 'block' });

test.describe('events list', () => {
  test('lists events in the event timezone, hides archived by default, opens a row (P-LC-1)', async ({ page }) => {
    await setupEvents(page, OWNER);
    await page.goto('/organizer/events/');
    const region = page.getByRole('region', { name: 'Your events' });
    await expect(region.getByRole('row')).toHaveCount(3); // header + 2 (archived hidden)
    await expect(region).toContainText('Sun 14 Mar 2027, 06:30 EAT');
    await expect(region).toContainText('3 · 5K 10K 21.1K');
    await expect(region).toContainText('Published');
    await page.getByTestId('events-filter-status').selectOption('archived');
    await expect(region.getByRole('row')).toHaveCount(2);
    await expect(region).toContainText('Old Fun Run');
    await page.getByTestId('events-filter-status').selectOption('');
    // Only the row's allowed lifecycle actions are offered: the draft has delete, the published one cancel.
    await page.getByTestId('events-more-evt_1').click();
    await expect(page.getByTestId('row-action-delete')).toBeVisible();
    await expect(page.getByTestId('row-action-cancel')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('events-open-evt_1').click();
    await expect(page).toHaveURL(/event=evt_1/);
    await expect(page.getByTestId('event-wizard')).toBeVisible();
    await expectNoRawKeys(page);
  });

  test('ops staff see the list read-only: no New event and no row actions', async ({ page }) => {
    await setupEvents(page, STAFF_OPS, { me: organizerMe('active', 'ops') });
    await page.goto('/organizer/events/');
    await expect(page.getByTestId('events-list')).toBeVisible();
    await expect(page.getByTestId('events-new')).toHaveCount(0);
    await expect(page.getByTestId('events-more-evt_1')).toHaveCount(0);
  });
});

test.describe('wizard', () => {
  test('New event: the draft is created when the title loses focus and the URL becomes ?event=<id> (P-EV-1)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=new');
    await expect(page.getByTestId('event-wizard')).toHaveAttribute('data-event-id', 'new');
    await page.getByTestId('ev-title').fill('Dar Night Run');
    await page.getByTestId('ev-title').blur();
    await expect.poll(() => mock.writes(/^\/organizer\/events$/).length).toBe(1);
    expect(mock.writes(/^\/organizer\/events$/)[0].body).toEqual({ title: 'Dar Night Run' });
    await expect(page.getByTestId('event-wizard')).toHaveAttribute('data-event-id', 'evt_new');
    await expect(page).toHaveURL(/event=evt_new/);
    await expect(page.getByTestId('save-indicator')).toContainText('Saved');
  });

  test('validation blocks Next with the message from events.validation.* and the step badge (P-EV-4)', async ({ page }) => {
    await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=new');
    await page.getByTestId('ev-title').fill('Da');
    await page.getByTestId('wizard-next').click();
    await expect(page.getByText('This is required.').first()).toBeVisible();
    await expect(page.getByText('Use between 3 and 80 characters.')).toBeVisible();
    await expect(page.getByTestId('step-basics')).toHaveAttribute('aria-label', '1. Basics · has errors');
    await expect(page.getByTestId('step-heading')).toContainText('Basics');
    await expect(page.getByTestId('step-venue')).toBeDisabled();
  });

  test('edits autosave with the version; a failed save shows Not saved — Retry, and the retry succeeds (P-EV-2)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=evt_1');
    await expect(page.getByTestId('ev-title')).toHaveValue('Dar Half Marathon 2027');
    let fail = true;
    mock.on('PATCH', /^\/organizer\/events\/evt_1$/, () => (fail ? { status: 503, json: { error: 'unavailable' } } : undefined));
    await page.getByTestId('ev-title').fill('Dar Half Marathon 2027 Edition');
    await expect(page.getByTestId('save-indicator')).toContainText('Not saved');
    fail = false;
    await page.getByTestId('save-retry').click();
    await expect(page.getByTestId('save-indicator')).toContainText('Saved');
    const patches = mock.writes(/^\/organizer\/events\/evt_1$/);
    expect(patches).toHaveLength(2);
    expect(patches[1].body?.version).toBe(3);
    expect(patches[1].body?.title).toBe('Dar Half Marathon 2027 Edition');
  });

  test('a 409 version_conflict shows the warning with Reload and keeps the local edit until reload (P-EV-3)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=evt_1');
    mock.on('PATCH', /^\/organizer\/events\/evt_1$/, () => ({ status: 409, json: { error: 'version_conflict' } }));
    await page.getByTestId('ev-title').fill('Changed locally');
    await expect(page.getByTestId('version-conflict')).toContainText('This event was changed elsewhere');
    await expect(page.getByTestId('ev-title')).toHaveValue('Changed locally');
    await page.getByTestId('conflict-reload').click();
    await expect(page.getByTestId('ev-title')).toHaveValue('Dar Half Marathon 2027');
    await expect(page.getByTestId('version-conflict')).toHaveCount(0);
  });

  test('prices: "25,000" and "25000" both save as 25000; "25000.50" is refused (P-EV-9)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=evt_1&step=tickets');
    const price = page.getByTestId('ev-categories-0-ticketTypes-0-priceText');
    await price.fill('25000.50');
    await page.getByTestId('wizard-next').click();
    await expect(page.getByText('Enter whole shillings without decimals.')).toBeVisible();
    await price.fill('25,000');
    await page.getByTestId('wizard-save-draft').click();
    await expect.poll(() => mock.writes(/^\/organizer\/events\/evt_1$/).length).toBeGreaterThan(0);
    const last = mock.writes(/^\/organizer\/events\/evt_1$/).pop()!;
    expect(last.body?.categories[0].ticketTypes[0].priceTzs).toBe(25000);
    expect(last.body?.categories[0].ticketTypes[0].currency).toBe('TZS');
  });

  test('review lists remaining problems as links that focus the field, then submit needs the confirmation (P-EV-5, P-EV-6)', async ({ page }) => {
    const past = () => DOC({ startsAt: '2026-01-01T03:30:00.000Z', endsAt: '2026-01-01T06:00:00.000Z', registrationClosesAt: '2025-12-30T20:59:00.000Z', categories: DOC().categories.map((c: Record<string, unknown>) => ({ ...c, startsAt: null })) });
    const mock = await setupEvents(page, OWNER, { extra: [['GET', /^\/organizer\/events\/evt_1$/, past]] });
    await page.goto('/organizer/events/?event=evt_1&step=review');
    await expect(page.getByTestId('review-permit-missing')).toBeVisible();
    const problem = page.getByTestId('review-problem-ev-startsAt');
    await expect(problem).toContainText('The event must start at least 24 hours from now.');
    await problem.click();
    await expect(page.getByTestId('ev-startsAt')).toBeFocused();
    // Fix the dates, back to review, confirm and submit.
    const in2d = new Date(Date.now() + 2 * 86_400_000); in2d.setSeconds(0, 0);
    const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    await page.getByTestId('ev-startsAt').fill(local(in2d));
    await page.getByTestId('ev-endsAt').fill(local(new Date(in2d.getTime() + 3 * 3_600_000)));
    await page.getByTestId('ev-registrationClosesAt').fill(local(new Date(in2d.getTime() - 3_600_000)));
    await page.getByTestId('step-review').click();
    await expect(page.getByTestId('review-problems')).toHaveCount(0);
    await expect(page.getByTestId('wizard-submit')).toBeDisabled();
    await page.getByTestId('review-confirm').check();
    await page.getByTestId('wizard-submit').click();
    mock.on('GET', /^\/organizer\/events\/evt_1$/, () => ({ ...past(), status: 'submitted', allowedActions: ['withdraw'] }));
    await page.getByRole('alertdialog').getByRole('button', { name: 'Submit for review' }).click();
    await expect.poll(() => mock.writes(/\/organizer\/events\/evt_1\/submit$/).length).toBe(1);
    await expect(page.getByTestId('submitted-card')).toBeVisible();
    await expect(page.getByTestId('event-wizard')).toContainText('Submitted');
    await expect(page.getByTestId('ev-action-withdraw')).toBeVisible();
  });

  test('organizer A opening organizer B’s event sees the forbidden state (P-EV-10)', async ({ page }) => {
    await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=evt_other');
    await expect(page.getByTestId('organizer-forbidden')).toContainText("You can't open this page");
  });

  test('published: a material edit opens the dialog, cancelling keeps the form dirty, confirming saves with the note (P-LC-3)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=evt_pub&step=venue');
    await expect(page.getByTestId('wizard-save-changes')).toBeVisible();
    await page.getByTestId('ev-venueName').fill('Arusha Stadium');
    await page.getByTestId('wizard-save-changes').click();
    await expect(page.getByTestId('material-dialog')).toContainText('venue.name');
    await expect(page.getByTestId('material-save')).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    expect(mock.writes(/^\/organizer\/events\/evt_pub$/)).toHaveLength(0);
    await expect(page.getByTestId('ev-venueName')).toHaveValue('Arusha Stadium');
    await page.getByTestId('wizard-save-changes').click();
    await page.getByTestId('material-note-en').fill('New start venue');
    await page.getByTestId('material-note-sw').fill('Mahali papya pa kuanzia');
    await page.getByTestId('material-ack').check();
    await page.getByTestId('material-save').click();
    await expect.poll(() => mock.writes(/^\/organizer\/events\/evt_pub$/).length).toBe(1);
    const body = mock.writes(/^\/organizer\/events\/evt_pub$/)[0].body!;
    expect(body.version).toBe(7);
    expect(body.changeNote).toEqual({ en: 'New start venue', sw: 'Mahali papya pa kuanzia' });
    expect(body.venue.name).toBe('Arusha Stadium');
    await expect(page.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible();
  });

  test('published: a non-material edit saves with a toast and no dialog (P-LC-4)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=evt_pub');
    await page.getByTestId('ev-descriptionEn').fill('An updated description that is long enough for the validation rule to pass here.');
    await page.getByTestId('wizard-save-changes').click();
    await expect(page.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible();
    await expect(page.getByTestId('material-dialog')).toHaveCount(0);
    expect(mock.writes(/^\/organizer\/events\/evt_pub$/)[0].body?.changeNote).toBeUndefined();
  });

  test('cancel asks for a reason; a 409 has_registrations shows the ask-FitFlex copy (P-LC-5)', async ({ page }) => {
    const mock = await setupEvents(page, OWNER, { extra: [['POST', /\/organizer\/events\/evt_pub\/cancel$/, () => ({ status: 409, json: { error: 'has_registrations' } })]] });
    await page.goto('/organizer/events/?event=evt_pub');
    await page.getByTestId('ev-action-cancel').click();
    await page.getByTestId('cancel-reason').selectOption('weather');
    await page.getByTestId('cancel-note-en').fill('Flooding on the route');
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByTestId('cancel-has-registrations')).toContainText('Ask FitFlex to cancel it.');
    const call = mock.writes(/\/cancel$/)[0];
    expect(call.body).toEqual({ reason: 'weather', note: { en: 'Flooding on the route', sw: '' } });
  });

  test('rejected draft shows the banner; the change log view lists material rows (P-LC-2, P-LC-6)', async ({ page }) => {
    await setupEvents(page, OWNER, { extra: [['GET', /^\/organizer\/events\/evt_1$/, () => DOC({ rejection: { reason: 'permit_missing', note: 'Upload the permit first.', at: '2026-10-21T10:00:00.000Z' }, changeLogCount: 1 })]] });
    await page.goto('/organizer/events/?event=evt_1');
    await expect(page.getByTestId('rejected-banner')).toContainText('Returned by FitFlex: Event permit missing. Upload the permit first.');
    await page.getByTestId('open-change-log').click();
    await expect(page.getByTestId('event-change-log')).toContainText('Material');
    await expect(page.getByTestId('event-change-log')).toContainText('Start moved');
  });

  test('Swahili: the wizard renders no raw keys; the status reads Imechapishwa', async ({ page }) => {
    await setupEvents(page, OWNER, { locale: 'sw' });
    await page.goto('/organizer/events/?event=evt_pub');
    await expect(page.getByTestId('event-wizard')).toContainText('Imechapishwa');
    await expect(page.getByTestId('stepper-current')).toContainText('1 / 7 · Msingi');
    await expectNoRawKeys(page);
  });

  test('at 375px the stepper shows the n / 7 line and the footer sticks (P-EV-7)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setupEvents(page, OWNER);
    await page.goto('/organizer/events/?event=evt_1');
    await expect(page.getByTestId('stepper-current')).toHaveText('1 / 7 · Basics');
    expect(await page.getByTestId('wizard-footer').evaluate(el => getComputedStyle(el).position)).toBe('sticky');
    const h = await page.getByTestId('ev-title').evaluate(el => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
  });

  test('published staff view: ops staff get read-only fields', async ({ page }) => {
    await setupEvents(page, STAFF_OPS, { me: organizerMe('active', 'ops'), extra: [['GET', /^\/organizer\/events\/evt_pub$/, () => PUBLISHED]] });
    await page.goto('/organizer/events/?event=evt_pub');
    await expect(page.getByTestId('ev-title')).toBeDisabled();
    await expect(page.getByTestId('wizard-save-changes')).toHaveCount(0);
    await expect(page.getByTestId('ev-action-cancel')).toHaveCount(0);
  });
});
