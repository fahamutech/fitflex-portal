import { expect, Page, test } from '@playwright/test';

// Admin "Trainer sessions" (functions#231): list, filters, outcome actions and every refusal. Every API call is mocked.
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.describe.configure({ timeout: 90_000 });

type Call = { method: string; path: string; body: unknown };
type Reply = { status?: number; json: unknown } | null;

const trainer = (name: string) => ({ id: `tr-${name}`, displayName: name, email: `${name.toLowerCase()}@example.com` });
const member = (name: string) => ({ displayName: name, phone: '+255700000001', email: null });

function booking(id: string, over: Record<string, unknown>) {
  return {
    id, memberId: `m-${id}`, trainerId: 'tr-x', gymId: 'gym-1', date: '2026-10-20', slot: '07:00', amountTzs: 30000,
    status: 'confirmed', createdAt: '2026-10-18T08:00:00.000Z',
    member: member('Asha Member'), trainer: trainer('Juma'), gym: { id: 'gym-1', name: 'Oyster Gym' },
    ...over,
  };
}

// Flag on: the server sends admin actions.
const flagOn = [
  booking('tbk_conf', { date: '2026-10-20', slot: '07:00', status: 'confirmed', actions: { canComplete: true, canMarkNoShow: true } }),
  booking('tbk_done', { date: '2026-10-19', slot: '18:00', status: 'completed', trainer: trainer('Neema'), member: member('Baraka'), actions: { canComplete: false, canMarkNoShow: true } }),
  booking('tbk_ns', { date: '2026-10-18', slot: '06:30', status: 'no_show', actions: { canComplete: true, canMarkNoShow: false } }),
  booking('tbk_lock', { date: '2026-10-12', slot: '09:00', status: 'completed', trainer: trainer('Neema'), actions: { canComplete: false, canMarkNoShow: false } }),
  booking('tbk_canc', { date: '2026-10-11', slot: '10:00', status: 'cancelled', actions: { canComplete: false, canMarkNoShow: false } }),
  booking('tbk_pend', { date: '2026-12-01', slot: '08:00', status: 'payment_pending', member: member('Zawadi'), actions: { canComplete: false, canMarkNoShow: false } }),
  booking('tbk_rej', { date: '2026-10-05', slot: '08:00', status: 'payment_rejected', actions: { canComplete: false, canMarkNoShow: false } }),
];
// Flag off: no actions anywhere.
const flagOff = flagOn.map(({ actions: _a, ...b }) => b);

async function signIn(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(l => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin-1@example.com' }));
    localStorage.setItem('locale', l);
  }, locale);
}

async function mockApi(page: Page, handler: (call: Call) => Reply) {
  const calls: Call[] = [];
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const call = { method: req.method(), path: new URL(req.url()).pathname, body };
    calls.push(call);
    const out = handler(call);
    if (out) return route.fulfill({ status: out.status ?? 200, json: out.json });
    return route.fulfill({ json: [] });
  });
  return calls;
}

const rowOf = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });
const listed = (rows: unknown[]) => ({ method, path }: Call): Reply =>
  method === 'GET' && path === '/admin/trainer-bookings' ? { json: rows } : null;

test.describe('Admin trainer sessions', () => {
  test('list: newest session first, one EAT format, status badges, nav entry', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', e => errors.push(e));
    await signIn(page);
    await mockApi(page, listed(flagOn));
    await page.goto('/admin/trainer-sessions');
    await expect(page.getByRole('heading', { name: 'Trainer sessions' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trainer sessions' }).first()).toBeVisible();
    const when = page.getByTestId('tsess-when');
    await expect(when.first()).toHaveText('Tue, 1 Dec 2026, 08:00');
    await expect(when.nth(1)).toHaveText('Tue, 20 Oct 2026, 07:00');
    await expect(rowOf(page, 'Mon, 19 Oct 2026, 18:00').getByTestId('tsess-status')).toHaveText('Completed');
    await expect(rowOf(page, 'Sun, 18 Oct 2026, 06:30').getByTestId('tsess-status')).toHaveText("Didn't attend");
    await expect(rowOf(page, '1 Dec 2026').getByTestId('tsess-status')).toHaveText('Payment pending');
    await expect(rowOf(page, '5 Oct 2026').getByTestId('tsess-status')).toHaveText('Payment rejected');
    await expect(rowOf(page, '11 Oct 2026').getByTestId('tsess-status')).toHaveText('Cancelled');
    await expect(rowOf(page, '20 Oct 2026').getByText('TSh 30,000')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('filters: status, date range, trainer search, clear', async ({ page }) => {
    await signIn(page);
    await mockApi(page, listed(flagOn));
    await page.goto('/admin/trainer-sessions');
    const when = page.getByTestId('tsess-when');
    await expect(when).toHaveCount(7);

    await page.getByTestId('tsess-filter-status').selectOption('completed');
    await expect(when).toHaveCount(2);
    await page.getByTestId('tsess-filter-clear').click();
    await expect(when).toHaveCount(7);

    await page.getByTestId('tsess-filter-from').fill('2026-10-12');
    await page.getByTestId('tsess-filter-to').fill('2026-10-19');
    await expect(when).toHaveCount(3);
    await page.getByTestId('tsess-filter-clear').click();

    await page.getByPlaceholder('Search trainer or member').fill('Neema');
    await expect(when).toHaveCount(2);
    await page.getByPlaceholder('Search trainer or member').fill('Nobody');
    await expect(page.getByText('No sessions match these filters.')).toBeVisible();
  });

  test('empty list and load error with retry', async ({ page }) => {
    await signIn(page);
    let fail = true;
    let rows: unknown[] = [];
    await mockApi(page, ({ method, path }) => {
      if (method === 'GET' && path === '/admin/trainer-bookings') return fail ? { status: 500, json: { error: 'boom' } } : { json: rows };
      return null;
    });
    await page.goto('/admin/trainer-sessions');
    await expect(page.getByTestId('tsess-load-error')).toContainText("Couldn't load trainer sessions");
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('No trainer sessions yet.')).toBeVisible();
    rows = flagOn;
    await page.getByTestId('tsess-refresh').click();
    await expect(page.getByTestId('tsess-when')).toHaveCount(7);
  });

  test('flag on: only the actions the server allows, and why the rest have none', async ({ page }) => {
    await signIn(page);
    await mockApi(page, listed(flagOn));
    await page.goto('/admin/trainer-sessions');
    const conf = rowOf(page, '20 Oct 2026');
    await expect(conf.getByTestId('tsess-complete')).toBeVisible();
    await expect(conf.getByTestId('tsess-noshow')).toBeVisible();
    await expect(conf.getByTestId('tsess-cancel')).toBeVisible();
    const done = rowOf(page, '19 Oct 2026');
    await expect(done.getByTestId('tsess-complete')).toHaveCount(0);
    await expect(done.getByTestId('tsess-noshow')).toBeVisible();
    const ns = rowOf(page, '18 Oct 2026');
    await expect(ns.getByTestId('tsess-complete')).toBeVisible();
    await expect(ns.getByTestId('tsess-noshow')).toHaveCount(0);

    const locked = rowOf(page, '12 Oct 2026');
    await expect(locked.getByRole('button')).toHaveCount(0);
    await expect(locked.getByTestId('tsess-why')).toHaveText("On a trainer statement past draft, so it can't be changed.");
    const cancelled = rowOf(page, '11 Oct 2026');
    await expect(cancelled.getByRole('button')).toHaveCount(0);
    await expect(cancelled.getByTestId('tsess-why')).toHaveText('Cancelled sessions are final and cannot be changed.');
    await expect(rowOf(page, '1 Dec 2026').getByTestId('tsess-why')).toHaveText('Decided through payment approval in Payments.');
    await expect(rowOf(page, '1 Dec 2026').getByRole('button')).toHaveCount(0);
  });

  test('flag off: no "didn\'t attend", status decides the rest', async ({ page }) => {
    await signIn(page);
    await mockApi(page, listed(flagOff));
    await page.goto('/admin/trainer-sessions');
    await expect(page.getByTestId('tsess-when')).toHaveCount(7);
    await expect(page.getByTestId('tsess-noshow')).toHaveCount(0);
    const conf = rowOf(page, '20 Oct 2026');
    await expect(conf.getByTestId('tsess-complete')).toBeVisible();
    await expect(conf.getByTestId('tsess-cancel')).toBeVisible();
    const done = rowOf(page, '19 Oct 2026');
    await expect(done.getByTestId('tsess-complete')).toHaveCount(0);
    await expect(done.getByTestId('tsess-cancel')).toBeVisible();
  });

  const actionCases = [
    { name: 'mark completed', testId: 'tsess-complete', status: 'completed', row: '20 Oct 2026', title: 'Mark this session completed?',
      consequence: 'The trainer is paid for it on their weekly statement. The member is not refunded.', toast: 'Session marked completed.', badge: 'Completed' },
    { name: "mark didn't attend", testId: 'tsess-noshow', status: 'no_show', row: '20 Oct 2026', title: "Mark that the member didn't attend?",
      consequence: 'The trainer is still paid in full and the member is not refunded. The member gets a notification.', toast: "Session marked didn't attend.", badge: "Didn't attend" },
    { name: 'cancel', testId: 'tsess-cancel', status: 'cancelled', row: '20 Oct 2026', title: 'Cancel this session?',
      consequence: 'A refund of TSh 30,000 is raised for the member (see Refunds). The trainer is not paid for it. Cancelling is final.', toast: 'Session cancelled.', badge: 'Cancelled' },
  ];
  for (const c of actionCases) {
    test(`action: ${c.name} confirms the consequence, posts the status, updates the row`, async ({ page }) => {
      await signIn(page);
      const calls = await mockApi(page, call => {
        if (call.method === 'POST' && call.path === '/admin/trainer-bookings/tbk_conf') {
          const after = { ...flagOn[0], status: c.status, actions: { canComplete: c.status === 'no_show', canMarkNoShow: c.status === 'completed' } };
          return { json: after };
        }
        return listed(flagOn)(call);
      });
      await page.goto('/admin/trainer-sessions');
      await rowOf(page, c.row).getByTestId(c.testId).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: c.title })).toBeVisible();
      await expect(dialog.getByTestId('tsess-consequence')).toHaveText(c.consequence);
      await dialog.getByTestId('tsess-submit').click();
      await expect(page.getByText(c.toast)).toBeVisible();
      await expect(dialog).toHaveCount(0);
      expect(calls.filter(x => x.method === 'POST').map(x => x.body)).toEqual([{ status: c.status }]);
      await expect(rowOf(page, c.row).getByTestId('tsess-status')).toHaveText(c.badge);
    });
  }

  test('cancel of a free session says no refund is raised', async ({ page }) => {
    await signIn(page);
    await mockApi(page, listed([{ ...flagOn[0], amountTzs: 0 }]));
    await page.goto('/admin/trainer-sessions');
    await page.getByTestId('tsess-cancel').click();
    await expect(page.getByTestId('tsess-consequence')).toHaveText('Nothing was paid, so no refund is raised. The trainer is not paid for it. Cancelling is final.');
  });

  const errorCases: { error: string; status: number; extra?: Record<string, unknown>; text: string; action?: string }[] = [
    { error: 'invalid_transition', status: 409, extra: { from: 'payment_pending' }, text: 'This session can\'t change from "Payment pending". Unpaid sessions are confirmed through payment approval.' },
    { error: 'session_not_started', status: 409, extra: { startsAt: '2026-12-01T05:00:00.000Z' }, text: "This session hasn't started yet (starts Tue, 1 Dec 2026, 08:00). Record its outcome once it has started." },
    { error: 'invalid_booking_time', status: 400, text: "This session's date or time can't be read, so its outcome can't be recorded." },
    { error: 'booking_cancelled', status: 409, text: 'This session was cancelled. A cancelled session is final.' },
    { error: 'booking_on_trainer_statement', status: 409, extra: { statementId: 'tst_42', statementStatus: 'submitted' }, text: "This session is on trainer statement tst_42 (Submitted), so it can't be changed." },
    { error: 'booking_changed', status: 409, text: 'Someone else changed this session at the same moment. The list has been reloaded; check it and try again.' },
    { error: 'invalid_status', status: 400, text: 'Recording "Didn\'t attend" is not switched on yet.', action: 'tsess-noshow' },
    { error: 'feature_disabled', status: 404, text: 'This feature is not switched on.', action: 'tsess-noshow' },
    { error: 'not_found', status: 404, text: 'This session no longer exists. The list has been reloaded.' },
    { error: 'payment_in_progress', status: 409, text: 'A mobile money payment is in progress for this booking — try again in a few minutes.', action: 'tsess-cancel' },
    { error: 'whatever_else', status: 500, text: 'That did not save. Try again.' },
  ];
  for (const c of errorCases) {
    test(`error: ${c.error} reads in plain words`, async ({ page }) => {
      await signIn(page);
      let gets = 0;
      await mockApi(page, call => {
        if (call.method === 'POST' && call.path === '/admin/trainer-bookings/tbk_conf') return { status: c.status, json: { error: c.error, ...c.extra } };
        if (call.method === 'GET' && call.path === '/admin/trainer-bookings') gets += 1;
        return listed(flagOn)(call);
      });
      await page.goto('/admin/trainer-sessions');
      await rowOf(page, '20 Oct 2026').getByTestId(c.action ?? 'tsess-complete').click();
      await page.getByTestId('tsess-submit').click();
      await expect(page.getByTestId('tsess-action-error')).toHaveText(c.text);
      if (['invalid_transition', 'booking_cancelled', 'booking_on_trainer_statement', 'booking_changed', 'not_found'].includes(c.error)) {
        await expect.poll(() => gets).toBeGreaterThan(1);
      }
      if (c.error === 'booking_on_trainer_statement') {
        // The row now says why, with the statement, and offers nothing.
        await page.getByRole('button', { name: 'Keep as is' }).click();
        const row = rowOf(page, '20 Oct 2026');
        await expect(row.getByTestId('tsess-why')).toHaveText("On trainer statement tst_42 (Submitted), so it can't be changed.");
        await expect(row.getByRole('button')).toHaveCount(0);
      }
    });
  }

  test('error: 403 (no trainers access) reads in plain words', async ({ page }) => {
    await signIn(page);
    await mockApi(page, call => {
      if (call.method === 'POST') return { status: 403, json: { error: 'forbidden' } };
      return listed(flagOn)(call);
    });
    await page.goto('/admin/trainer-sessions');
    await rowOf(page, '20 Oct 2026').getByTestId('tsess-cancel').click();
    await page.getByTestId('tsess-submit').click();
    await expect(page.getByTestId('tsess-action-error')).toHaveText("You don't have access to trainer sessions.");
  });

  test('Swahili: page, statuses, reasons, dialog and errors', async ({ page }) => {
    await signIn(page, 'sw');
    await mockApi(page, call => {
      if (call.method === 'POST') return { status: 409, json: { error: 'booking_on_trainer_statement', statementId: 'tst_42', statementStatus: 'paid' } };
      return listed(flagOn)(call);
    });
    await page.goto('/admin/trainer-sessions');
    await expect(page.getByRole('heading', { name: 'Vipindi vya trainer' })).toBeVisible();
    await expect(page.getByText('Vipindi ambavyo wanachama wamepanga na ma-trainer. Saa ni za Afrika Mashariki.')).toBeVisible();
    const statuses = page.getByTestId('tsess-status');
    await expect(statuses.filter({ hasText: 'Hakuhudhuria' })).toHaveCount(1);
    await expect(statuses.filter({ hasText: 'Kimeghairiwa' })).toHaveCount(1);
    await expect(statuses.filter({ hasText: 'Malipo yanasubiri' })).toHaveCount(1);
    await expect(page.getByText('Kipindi kilichoghairiwa ni cha mwisho na hakiwezi kubadilishwa.')).toBeVisible();
    await expect(page.getByPlaceholder('Tafuta trainer au mwanachama')).toBeVisible();
    await page.getByRole('button', { name: 'Weka hakuhudhuria' }).first().click();
    await expect(page.getByTestId('tsess-consequence')).toHaveText('Trainer bado analipwa kikamilifu na mwanachama harejeshewi pesa. Mwanachama atapata taarifa.');
    await page.getByTestId('tsess-submit').click();
    await expect(page.getByTestId('tsess-action-error')).toHaveText('Kipindi hiki kiko kwenye taarifa ya malipo ya trainer tst_42 (Imelipwa), hivyo hakiwezi kubadilishwa.');
  });

  test('Swahili: cancel refused while a mobile money payment is in progress', async ({ page }) => {
    await signIn(page, 'sw');
    await mockApi(page, call => {
      if (call.method === 'POST') return { status: 409, json: { error: 'payment_in_progress' } };
      return listed(flagOn)(call);
    });
    await page.goto('/admin/trainer-sessions');
    await page.getByRole('button', { name: 'Ghairi kipindi' }).first().click();
    await page.getByTestId('tsess-submit').click();
    await expect(page.getByTestId('tsess-action-error')).toHaveText('Malipo ya pesa kwa simu yanaendelea kwa miadi hii — jaribu tena baada ya dakika chache.');
  });

  test('1280 wide: every action on the row is on screen without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, 'sw'); // the longer language
    await mockApi(page, listed(flagOn));
    await page.goto('/admin/trainer-sessions');
    const row = rowOf(page, '20 Okt 2026');
    await expect(row).toHaveCount(1);
    for (const id of ['tsess-complete', 'tsess-noshow', 'tsess-cancel']) {
      const button = row.getByTestId(id);
      await expect(button).toBeInViewport({ ratio: 1 });
      const box = await button.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('390 wide: the page itself does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'sw');
    await mockApi(page, listed(flagOn));
    await page.goto('/admin/trainer-sessions');
    await expect(page.getByTestId('tsess-when').first()).toBeAttached();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
