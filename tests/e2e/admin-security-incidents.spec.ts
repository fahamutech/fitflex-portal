import { expect, test, type Page } from '@playwright/test';

// Security reports (S4b): staff with the `security_incidents` scope work a member's report of a web check-in
// they do not recognise. The API is mocked (contract: fitflex-functions docs/security-incident-report-api.md);
// nothing signs in for real and no server flag is needed.
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Call = { method: string; path: string; query: string; body: Json | null };

// Times must read in Dar es Salaam whatever the staff member's own clock says.
test.use({ timezoneId: 'UTC' });

const SUPER = { id: 'admin-1', userType: 'admin', email: 'root@fitflex.test' };
const STAFF = { id: 'staff-1', userType: 'admin', portalUser: true, aclPermissions: ['security_incidents'], email: 'sec@fitflex.test' };

const incident = (over: Json = {}): Json => ({
  id: 'sin_open1', userId: 'usr_member1', eventId: 'sev_1', status: 'open', outcome: null,
  snapshot: { kind: 'web_checkin', eventId: 'sev_1', gymId: 'gym_1', gymName: 'Fit Zone Mikocheni', occurredAt: '2026-11-09T05:30:00.000Z', channel: 'web' },
  protection: { requested: true, applied: true, limited: false, sessionsEnded: true, pinResetRequired: true },
  opsExceptionId: 'ops_1', reportedAt: '2026-11-09T21:45:00.000Z',
  acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolvedBy: null, resolutionReason: null,
  ...over,
});

const trail = (inc: Json) => [
  { id: 'sie_1', kind: 'reported', actor: inc.userId, detail: { secureAccount: true, limited: false }, at: inc.reportedAt },
  { id: 'sie_2', kind: 'protection', actor: inc.userId, detail: { sessionsEnded: true, pinResetRequired: true, limited: false, failed: false }, at: inc.reportedAt },
  ...(inc.acknowledgedAt ? [{ id: 'sie_3', kind: 'acknowledged', actor: inc.acknowledgedBy, detail: null, at: inc.acknowledgedAt }] : []),
  ...(inc.resolvedAt ? [{ id: 'sie_4', kind: 'resolved', actor: inc.resolvedBy, detail: { outcome: inc.outcome }, at: inc.resolvedAt }] : []),
];

type Opts = {
  locale?: 'en' | 'sw';
  incidents?: Json[];
  /** Answer for every security-incident route (e.g. the flag is off, or access was removed). */
  all?: { status: number; json?: Json; body?: string; contentType?: string };
  /** The list fails while this is true (the test switches it off; next dev runs effects twice, so a count would not do). */
  listDown?: boolean;
  /** Someone else resolved the report first: the resolve route answers 409 and the report is resolved. */
  resolveConflict?: boolean;
  resolveAnswer?: { status: number; json: Json };
  next?: string;
};

/** A signed-in admin and a small stateful fake of the four admin routes. */
async function setup(page: Page, user: Json, opts: Opts = {}) {
  const calls: Call[] = [];
  const store = new Map<string, Json>((opts.incidents ?? [incident()]).map(i => [i.id, { ...i }]));
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('locale', l as string);
  }, [user, opts.locale ?? 'en'] as const);
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path === '/admin/portal-users' && req.method() === 'GET') {
      return route.fulfill({ json: [{ id: 'staff-9', email: 'helper@fitflex.test', displayName: 'Helper', userType: 'admin', accountStatus: 'active', portalUser: true, aclPermissions: [], createdAt: '2026-10-01T00:00:00.000Z', isEnvAdmin: false }] });
    }
    if (!path.startsWith('/admin/security-incidents')) return route.fulfill({ json: [] });
    calls.push({ method: req.method(), path, query: url.search, body: req.method() === 'POST' ? (req.postDataJSON() as Json | null) : null });
    if (opts.all) return route.fulfill(opts.all);

    if (path === '/admin/security-incidents') {
      if (opts.listDown) return route.fulfill({ status: 500, json: { error: 'server_error' } });
      const status = url.searchParams.get('status');
      if (url.searchParams.get('before')) return route.fulfill({ json: { incidents: [incident({ id: 'sin_older', reportedAt: '2026-11-01T06:00:00.000Z' })] } });
      const incidents = [...store.values()].filter(i => i.status === status);
      return route.fulfill({ json: { incidents, ...(opts.next && status === 'open' ? { next: opts.next } : {}) } });
    }
    const [, , , id, action] = path.split('/');
    const inc = store.get(decodeURIComponent(id));
    if (!inc) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (action === 'acknowledge') {
      if (inc.status !== 'open') return route.fulfill({ status: 409, json: { error: 'invalid_state', current: inc.status } });
      Object.assign(inc, { status: 'acknowledged', acknowledgedAt: '2026-11-10T07:00:00.000Z', acknowledgedBy: 'admin-1' });
    } else if (action === 'resolve') {
      if (opts.resolveAnswer) return route.fulfill(opts.resolveAnswer);
      if (opts.resolveConflict) {
        Object.assign(inc, { status: 'resolved', outcome: 'inconclusive', resolvedAt: '2026-11-10T07:30:00.000Z', resolvedBy: 'admin-2', resolutionReason: 'Called the member; no answer.' });
        return route.fulfill({ status: 409, json: { error: 'invalid_state', current: 'resolved' } });
      }
      const body = req.postDataJSON() as Json;
      Object.assign(inc, { status: 'resolved', outcome: body.outcome, resolvedAt: '2026-11-10T08:00:00.000Z', resolvedBy: 'admin-1', resolutionReason: body.reason });
    }
    return route.fulfill({ json: { incident: inc, events: trail(inc) } });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  return calls;
}

const NO_VOID = 'Resolving a report does not cancel the check-in and does not change visits, payouts or settlement. The member gets one neutral message, with the same words whatever the outcome.';

test('the list shows reports in Dar es Salaam time, filters by status, and opens a report', async ({ page }) => {
  const calls = await setup(page, SUPER, {
    incidents: [
      incident(),
      incident({ id: 'sin_fail', protection: { requested: true, applied: false, limited: false, sessionsEnded: false, pinResetRequired: false, failed: true } }),
      incident({ id: 'sin_limited', protection: { requested: true, applied: false, limited: true, sessionsEnded: false, pinResetRequired: false } }),
      incident({ id: 'sin_only', protection: { requested: false, applied: false, limited: false, sessionsEnded: false, pinResetRequired: false } }),
      incident({ id: 'sin_ack', status: 'acknowledged', acknowledgedAt: '2026-11-10T06:00:00.000Z', acknowledgedBy: 'admin-2' }),
    ],
  });
  await page.goto('/admin/security-incidents');
  await expect(page.getByRole('heading', { name: 'Security reports' })).toBeVisible();
  await expect(page.getByTestId('secinc-no-void')).toHaveText(NO_VOID);

  // The first request asks for open reports; 05:30 UTC is 08:30 in Dar es Salaam, and 21:45 UTC is the next day there.
  const row = page.getByTestId('secinc-row-sin_open1');
  await expect(row).toContainText('Fit Zone Mikocheni');
  await expect(row).toContainText('9 Nov 2026, 08:30 EAT');
  await expect(row).toContainText('10 Nov 2026, 00:45 EAT');
  await expect(row).toContainText('Applied');
  await expect(row).toContainText('Open');
  await expect(page.getByTestId('secinc-row-sin_fail')).toContainText('Failed');
  await expect(page.getByTestId('secinc-row-sin_limited')).toContainText('Limited');
  await expect(page.getByTestId('secinc-row-sin_only')).toContainText('Not asked for');
  await expect(page.getByTestId('secinc-row-sin_ack')).toHaveCount(0);
  expect(calls[0]).toMatchObject({ method: 'GET', path: '/admin/security-incidents', query: '?status=open' });

  // Status filter: a labelled group of buttons, keyboard operable.
  const filter = page.getByRole('group', { name: 'Show reports by status' });
  await expect(filter.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
  await filter.getByRole('button', { name: 'Acknowledged' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('secinc-row-sin_ack')).toBeVisible();
  await expect(page.getByTestId('secinc-row-sin_open1')).toHaveCount(0);
  expect(calls.at(-1)).toMatchObject({ query: '?status=acknowledged' });
  await filter.getByRole('button', { name: 'Resolved' }).click();
  await expect(page.getByTestId('secinc-empty')).toContainText('No resolved reports yet.');
  expect(calls.at(-1)).toMatchObject({ query: '?status=resolved' });

  // Open a report with the keyboard: the title takes focus, and the snapshot, protection and trail are shown.
  await filter.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: /Open report sin_open1/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/id=sin_open1/);
  await expect(page.getByRole('heading', { name: 'Report sin_open1' })).toBeVisible();
  await expect(page.getByText('Report sin_open1', { exact: true })).toBeFocused();
  const snap = page.getByTestId('secinc-snapshot');
  await expect(snap).toContainText('Fit Zone Mikocheni');
  await expect(snap).toContainText('Check-in time (Dar es Salaam)');
  await expect(snap).toContainText('9 Nov 2026, 08:30 EAT');
  await expect(snap).toContainText('Web check-in (gym QR code in a browser)');
  await expect(snap).toContainText('usr_member1');
  await expect(page.getByTestId('secinc-protection')).toContainText('Applied');
  await expect(page.getByTestId('secinc-protection')).toContainText('FitFlex sessions were ended when they reported this.');
  await expect(page.getByTestId('secinc-protection')).toContainText("This does not change the member's Google or email sign-in.");
  await expect(page.getByTestId('secinc-protection')).not.toContainText('everywhere');
  await expect(page.getByTestId('secinc-protection')).toContainText('must set a new PIN');
  await expect(page.getByTestId('secinc-trail')).toContainText('Member reported the check-in');
  await expect(page.getByTestId('secinc-trail')).toContainText('asked to secure the account');
  await expect(page.getByTestId('secinc-no-void')).toHaveText(NO_VOID);

  // Back: focus returns to the row that opened the report.
  await page.getByTestId('secinc-back').click();
  await expect(page).not.toHaveURL(/id=/);
  await expect(page.getByRole('button', { name: /Open report sin_open1/ })).toBeFocused();
});

test('acknowledge moves an open report on, and resolve needs an outcome and a 10 to 500 character reason', async ({ page }) => {
  const calls = await setup(page, STAFF);
  await page.goto('/admin/security-incidents?id=sin_open1');

  await page.getByTestId('secinc-acknowledge').click();
  await expect(page.getByTestId('secinc-notice')).toContainText('Report acknowledged.');
  await expect(page.getByTestId('secinc-notice')).toBeFocused();
  await expect(page.getByTestId('secinc-acknowledge')).toHaveCount(0);
  await expect(page.getByTestId('secinc-trail')).toContainText('Acknowledged by staff');
  expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/admin/security-incidents/sin_open1/acknowledge' });

  // The dialog says what resolving does not do, and focus starts on the first field.
  await page.getByTestId('secinc-resolve').click();
  const dialog = page.getByRole('dialog', { name: 'Resolve this report' });
  await expect(dialog).toContainText(NO_VOID);
  await expect(dialog).toContainText('Do not include phone numbers, names or PINs.');
  await expect(dialog.getByLabel('Outcome')).toBeFocused();
  await expect(dialog.getByRole('option')).toHaveText([
    'Choose an outcome', 'Confirmed: someone else checked in', 'The member made or allowed the check-in', 'Could not be confirmed either way',
  ]);

  // Nothing chosen: nothing is sent, the outcome field says why and takes focus.
  const posts = () => calls.filter(c => c.path.endsWith('/resolve')).length;
  await page.getByTestId('secinc-resolve-confirm').click();
  await expect(dialog.getByText('Choose an outcome.')).toBeVisible();
  await expect(dialog.getByLabel('Outcome')).toBeFocused();
  expect(posts()).toBe(0);

  // Too short (spaces do not count), then too long.
  await dialog.getByLabel('Outcome').selectOption('authorised_by_member');
  await dialog.getByLabel('Reason').fill('   short   ');
  await expect(page.getByTestId('secinc-reason-count')).toHaveText('5 of 500 characters');
  await page.getByTestId('secinc-resolve-confirm').click();
  await expect(dialog.getByText('Write at least 10 characters.')).toBeVisible();
  await expect(dialog.getByLabel('Reason')).toBeFocused();
  await expect(dialog.getByLabel('Reason')).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByLabel('Reason').fill('x'.repeat(501));
  await expect(page.getByTestId('secinc-reason-count')).toHaveText('501 of 500 characters');
  await expect(dialog.getByText('Use 500 characters or fewer.')).toBeVisible();
  await page.getByTestId('secinc-resolve-confirm').click();
  expect(posts()).toBe(0);

  // Valid: sent trimmed, by keyboard; the report is closed and cannot be changed.
  await dialog.getByLabel('Reason').fill('  Called the member; her sister used the phone.  ');
  await expect(page.getByTestId('secinc-reason-count')).toHaveText('45 of 500 characters');
  await dialog.getByLabel('Outcome').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('secinc-resolve-confirm')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('secinc-notice')).toContainText('Report resolved. FitFlex sends the member the neutral message.');
  await expect(page.getByTestId('secinc-notice')).toBeFocused();
  await expect(dialog).toHaveCount(0);
  expect(calls.at(-1)).toEqual({
    method: 'POST', path: '/admin/security-incidents/sin_open1/resolve', query: '',
    body: { outcome: 'authorised_by_member', reason: 'Called the member; her sister used the phone.' },
  });
  await expect(page.getByTestId('secinc-snapshot')).toContainText('The member made or allowed the check-in');
  await expect(page.getByTestId('secinc-snapshot')).toContainText('Called the member; her sister used the phone.');
  await expect(page.getByTestId('secinc-closed')).toContainText('This report is resolved. It cannot be changed.');
  await expect(page.getByTestId('secinc-resolve')).toHaveCount(0);
});

test('Escape closes the resolve dialog and focus returns to the Resolve button', async ({ page }) => {
  await setup(page, SUPER);
  await page.goto('/admin/security-incidents?id=sin_open1');
  await page.getByTestId('secinc-resolve').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('secinc-resolve')).toBeFocused();
});

test('a report someone else already resolved (409) is refreshed, with a plain note', async ({ page }) => {
  await setup(page, SUPER, { resolveConflict: true });
  await page.goto('/admin/security-incidents?id=sin_open1');
  await page.getByTestId('secinc-resolve').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Outcome').selectOption('unauthorised_confirmed');
  await dialog.getByLabel('Reason').fill('Gym confirmed someone else scanned the code.');
  await page.getByTestId('secinc-resolve-confirm').click();
  await expect(page.getByTestId('secinc-notice')).toContainText('Someone else already updated this report. The latest version is shown below.');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('secinc-snapshot')).toContainText('Could not be confirmed either way');
  await expect(page.getByTestId('secinc-closed')).toBeVisible();
  await expect(page.getByTestId('secinc-resolve')).toHaveCount(0);
});

test('a reason the server refuses is shown on the field; an unknown failure keeps the dialog open', async ({ page }) => {
  await setup(page, SUPER, { resolveAnswer: { status: 400, json: { error: 'invalid_reason', min: 10, max: 500 } } });
  await page.goto('/admin/security-incidents?id=sin_open1');
  await page.getByTestId('secinc-resolve').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Outcome').selectOption('inconclusive');
  await dialog.getByLabel('Reason').fill('Could not reach the member today.');
  await page.getByTestId('secinc-resolve-confirm').click();
  await expect(dialog.getByText('Write at least 10 characters.')).toBeVisible();
  await expect(dialog.getByLabel('Reason')).toBeFocused();
});

test('not available yet while the server flag is off, on the list and on a report', async ({ page }) => {
  await setup(page, SUPER, { all: { status: 404, json: { error: 'feature_disabled' } } });
  await page.goto('/admin/security-incidents');
  await expect(page.getByTestId('secinc-off')).toContainText('Security reports are not available yet');
  await expect(page.getByTestId('secinc-off')).toContainText('Nothing needs doing now.');
  await expect(page.getByTestId('secinc-filter')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);

  await page.goto('/admin/security-incidents?id=sin_open1');
  await expect(page.getByTestId('secinc-off')).toContainText('Security reports are not available yet');
});

test('a backend without the routes yet (plain 404) also reads as not available', async ({ page }) => {
  await setup(page, SUPER, { all: { status: 404, json: { error: 'not_found' } } });
  await page.goto('/admin/security-incidents');
  await expect(page.getByTestId('secinc-off')).toContainText('Security reports are not available yet');
});

test('a report on a backend without the routes (plain 404) reads as not available; 404 not_found stays "not found"', async ({ page }) => {
  await setup(page, SUPER, { all: { status: 404, body: 'Not Found', contentType: 'text/plain' } });
  await page.goto('/admin/security-incidents?id=sin_open1');
  await expect(page.getByTestId('secinc-off')).toContainText('Security reports are not available yet');
  await expect(page.getByTestId('secinc-not-found')).toHaveCount(0);

  const other = await page.context().newPage();
  await setup(other, SUPER, { all: { status: 404, json: { error: 'not_found' } } });
  await other.goto('/admin/security-incidents?id=sin_open1');
  await expect(other.getByTestId('secinc-not-found')).toContainText('This report was not found.');
});

for (const bad of ['..', '../portal-users', 'sin_1%2F..', 'a b']) {
  test(`report id "${bad}" is never sent to the API and reads as not found`, async ({ page }) => {
    const calls = await setup(page, SUPER);
    await page.goto(`/admin/security-incidents?id=${bad}`);
    await expect(page.getByTestId('secinc-not-found')).toContainText('This report was not found.');
    // The list behind the report still loads; nothing is asked of the API with the id in it.
    expect(calls.filter(c => c.path !== '/admin/security-incidents')).toHaveLength(0);
  });
}

test('a 403 that is not an ACL refusal is a general error, not "ask for the permission"', async ({ page }) => {
  await setup(page, STAFF, { all: { status: 403, json: { error: 'account_suspended' } } });
  await page.goto('/admin/security-incidents');
  await expect(page.getByTestId('secinc-error')).toContainText('Security reports could not be loaded.');
  await expect(page.getByTestId('secinc-forbidden')).toHaveCount(0);
  await page.goto('/admin/security-incidents?id=sin_open1');
  await expect(page.getByTestId('secinc-case-error')).toContainText('This report could not be loaded.');
  await expect(page.getByTestId('secinc-forbidden')).toHaveCount(0);
});

test('half-failed protection, an account that cannot be secured, and an unknown channel', async ({ page }) => {
  await setup(page, SUPER, {
    incidents: [
      incident({ id: 'sin_half', protection: { requested: true, applied: false, limited: false, sessionsEnded: false, pinResetRequired: true, failed: true, failure: 'sessions' } }),
      incident({ id: 'sin_noperson', snapshot: { kind: 'web_checkin', eventId: 'sev_1', gymId: 'gym_1', gymName: 'Fit Zone Mikocheni', occurredAt: '2026-11-09T05:30:00.000Z', channel: 'kiosk_v2<raw>' },
        protection: { requested: true, applied: false, limited: false, sessionsEnded: false, pinResetRequired: 'not_applicable', failed: true, failure: 'no_person' } }),
      incident({ id: 'sin_nopin', protection: { requested: true, applied: true, limited: false, sessionsEnded: true, pinResetRequired: 'not_applicable' } }),
    ],
  });
  await page.goto('/admin/security-incidents?id=sin_half');
  const protection = page.getByTestId('secinc-protection');
  await expect(protection).toContainText('Failed');
  await expect(page.getByTestId('secinc-pin-off')).toHaveText('Their PIN was switched off, so they must use Forgot PIN to set a new one, even though ending their sessions did not work.');
  await expect(page.getByTestId('secinc-no-person')).toHaveCount(0);

  await page.goto('/admin/security-incidents?id=sin_noperson');
  await expect(page.getByTestId('secinc-no-person')).toHaveText('This account cannot be secured automatically.');
  await expect(page.getByTestId('secinc-pin-off')).toHaveCount(0);
  // The raw server string is never shown.
  await expect(page.getByTestId('secinc-snapshot')).toContainText('Another way of checking in');
  await expect(page.getByTestId('secinc-snapshot')).not.toContainText('kiosk_v2');

  await page.goto('/admin/security-incidents?id=sin_nopin');
  await expect(protection).toContainText('Advise the member to change the password they sign in with, or to contact support.');
});

test('403 says who to ask; an unknown report says so', async ({ page }) => {
  await setup(page, STAFF, { all: { status: 403, json: { error: 'acl_forbidden', requiredScope: 'security_incidents' } } });
  await page.goto('/admin/security-incidents');
  await expect(page.getByTestId('secinc-forbidden')).toContainText('You do not have access to security reports');
  await expect(page.getByTestId('secinc-forbidden')).toContainText('Ask a FitFlex admin for the Security reports permission.');

  const other = await page.context().newPage();
  await setup(other, SUPER);
  await other.goto('/admin/security-incidents?id=sin_gone');
  await expect(other.getByTestId('secinc-not-found')).toContainText('This report was not found.');
});

test('a failed load offers a retry; more reports load with the opaque cursor', async ({ page }) => {
  const opts: Opts = { listDown: true, next: '2026-11-09T21:45:00.000Z~sin_open1' };
  const calls = await setup(page, SUPER, opts);
  await page.goto('/admin/security-incidents');
  await expect(page.getByTestId('secinc-error')).toContainText('Security reports could not be loaded.');
  opts.listDown = false;
  await page.getByTestId('secinc-error').getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('secinc-row-sin_open1')).toBeVisible();

  await page.getByTestId('secinc-more').click();
  await expect(page.getByTestId('secinc-row-sin_older')).toBeVisible();
  await expect(page.getByTestId('secinc-more')).toHaveCount(0);
  const last = new URLSearchParams(calls.at(-1)!.query);
  expect(last.get('status')).toBe('open');
  expect(last.get('before')).toBe('2026-11-09T21:45:00.000Z~sin_open1');
});

test('an empty list says what will appear', async ({ page }) => {
  await setup(page, SUPER, { incidents: [] });
  await page.goto('/admin/security-incidents');
  await expect(page.getByTestId('secinc-empty')).toContainText('No open reports.');
  await expect(page.getByTestId('secinc-empty')).toContainText('A report appears here when a member says a web check-in was not theirs.');
});

test('Swahili: the list, the report and the resolve form', async ({ page }) => {
  await setup(page, SUPER, { locale: 'sw' });
  await page.goto('/admin/security-incidents');
  await expect(page.getByRole('heading', { name: 'Ripoti za usalama' })).toBeVisible();
  await expect(page.getByTestId('secinc-no-void')).toContainText('Kuhitimisha ripoti hakubatilishi kuingia gym na hakubadilishi ziara');
  // Swahili clock: 12-hour with the part of the day, still Dar es Salaam time labelled EAT.
  await expect(page.getByTestId('secinc-row-sin_open1')).toContainText('8:30 asubuhi EAT');
  await expect(page.getByTestId('secinc-row-sin_open1')).toContainText('12:45 usiku EAT');
  await page.getByTestId('secinc-row-sin_open1').click();
  await expect(page.getByTestId('secinc-snapshot')).toContainText('Kuingia gym kwa wavuti');
  await expect(page.getByTestId('secinc-protection')).toContainText('Umewekwa');
  await page.getByTestId('secinc-resolve').click();
  const dialog = page.getByRole('dialog', { name: 'Hitimisha ripoti hii' });
  await expect(dialog).toContainText('Mwanachama hupata ujumbe mmoja usioegemea upande wowote');
  await page.getByTestId('secinc-resolve-confirm').click();
  await expect(dialog.getByText('Chagua matokeo.')).toBeVisible();
});

test('the nav item follows the security_incidents scope', async ({ page }) => {
  await setup(page, STAFF);
  await page.goto('/admin/security-incidents');
  await expect(page.getByRole('link', { name: 'Security reports' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gyms' })).toHaveCount(0);
  await expect(page.getByTestId('secinc-row-sin_open1')).toBeVisible();
});

test('staff without the scope neither see the nav item nor reach the page', async ({ page }) => {
  const calls = await setup(page, { id: 'staff-2', userType: 'admin', portalUser: true, aclPermissions: ['payments'], email: 'pay@fitflex.test' });
  // Their own start page first: next dev drops a redirect to a page it has not compiled yet.
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: 'Payments' }).first()).toBeVisible();
  await page.goto('/admin/security-incidents');
  await expect(page).not.toHaveURL(/security-incidents/);
  await expect(page.getByRole('link', { name: 'Payments' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Security reports' })).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

test('Portal Users offers the security_incidents scope, in English and Swahili', async ({ page, browser }) => {
  await setup(page, SUPER);
  await page.goto('/admin/users/');
  await page.getByRole('row', { name: /helper@fitflex\.test/ }).getByTitle('Edit permissions').click();
  await expect(page.getByTestId('scope-toggle-security_incidents')).toHaveText('Security reports: unrecognised check-ins');
  await expect(page.getByTestId('scope-toggle-security_incidents')).toBeEnabled();

  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const sw = await ctx.newPage();
  await setup(sw, SUPER, { locale: 'sw' });
  await sw.goto('/admin/users/');
  await sw.getByRole('row', { name: /helper@fitflex\.test/ }).getByTitle('Edit permissions').click();
  await expect(sw.getByTestId('scope-toggle-security_incidents')).toHaveText('Ripoti za usalama: kuingia gym kusikotambuliwa');
  await ctx.close();
});
