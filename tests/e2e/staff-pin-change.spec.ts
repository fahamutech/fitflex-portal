import { expect, test, type Page } from '@playwright/test';

// B3a (functions#260, flag STAFF_PIN_CHANGE_REQUIRED): gym staff whose owner chose their PIN sign in with a
// session that carries `pwc: true` and user.passwordChangeRequired, and every route but POST /auth/pin/change
// answers 403 password_change_required. The portal shows a 4-digit PIN step (admins keep the password step).
// Owners see who still has to change their PIN and can reset a staff member's PIN. All API calls are mocked.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const PHONE = '0711000111';
const START_PIN = '1111';
const CHOSEN_PIN = '4821';
const STAFF = { id: 'usr_staff', userType: 'gym_staff', gymId: 'gym-1', email: 'desk@fitflex.test', aclPermissions: ['members', 'checkins', 'trainers', 'gyms'] };
const ADMIN = { id: 'usr_new_admin', userType: 'admin', email: 'new.admin@fitflex.test', portalUser: true, aclPermissions: ['users'] };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** A FitFlex session JWT (only the payload matters to the portal). */
const sessionJwt = (claims: object) => [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: STAFF.id, ...claims }), 'sig'].join('.');
const PWC_TOKEN = sessionJwt({ pwc: true });
const NEW_TOKEN = sessionJwt({ n: 2 });

type Reply = { status: number; json: object };
type Calls = { paths: string[]; changes: Array<{ auth: string | undefined; body: any }>; adminChanges: number };

async function blockOutside(page: Page) {
  // Nothing here may reach a real service (live API, Firebase, Google).
  await page.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
}

/**
 * The backend as functions#260 describes it: anything but the shell's reads, PIN sign-in and the change
 * route is refused with 403 password_change_required until the new token is used.
 */
async function mockBackend(page: Page, calls: Calls, change: (body: any) => Reply) {
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const auth = request.headers()['authorization'];
    calls.paths.push(`${request.method()} ${path}`);
    if (path === '/auth/options') return route.fulfill({ json: { pinLogin: true } });
    if (path === '/auth/pin/login') {
      return route.fulfill({ json: { token: PWC_TOKEN, user: { ...STAFF, passwordChangeRequired: true }, personas: [] } });
    }
    if (path === '/auth/pin/change') {
      const body = request.postDataJSON();
      calls.changes.push({ auth, body });
      return route.fulfill(change(body));
    }
    if (path === '/auth/portal/password') { calls.adminChanges += 1; return route.fulfill({ status: 403, json: { error: 'forbidden' } }); }
    if (path === '/me/personas' || path === '/me/invitations') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (auth !== `Bearer ${NEW_TOKEN}`) return route.fulfill({ status: 403, json: { error: 'password_change_required' } });
    if (path === '/operator/checkins') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
}
const ok = (): Reply => ({ status: 200, json: { token: NEW_TOKEN, user: { ...STAFF, passwordChangeRequired: false }, pendingApproval: false, partnerVerified: true } });

/** A staff session restored from storage whose token the portal cannot read: only the 403 (or the user flag) tells it. */
async function restoreStaffSession(page: Page, { locale = 'en', user = STAFF as object } = {}) {
  await page.addInitScript(([u, loc]) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('token', 'opaque-session-token');
      localStorage.setItem('user', u);
    }
    localStorage.setItem('locale', loc);
  }, [JSON.stringify(user), locale]);
}

const pinGate = (page: Page) => page.getByTestId('change-pin-gate');

async function submitPin(page: Page, pin: string, confirm = pin) {
  await page.getByTestId('pinc-new').fill(pin);
  await page.getByTestId('pinc-confirm').fill(confirm);
  await page.getByTestId('pinc-submit').click();
}

test('held staff signing in with the start PIN get only the PIN step, then their landing', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [], adminChanges: 0 };
  await blockOutside(page);
  await mockBackend(page, calls, ok);
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));

  await page.goto('/login');
  await page.getByTestId('pin-method-btn').click();
  await page.getByTestId('pin-identifier-input').fill(PHONE);
  await page.getByTestId('pin-input').fill(START_PIN);
  await page.getByTestId('pin-submit').click();

  await expect(pinGate(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Choose your own PIN' })).toBeVisible();
  await expect(page.getByText('Your owner will no longer know it.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('change-password-gate')).toHaveCount(0);
  // No navigation and no page while the step is open.
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByTestId('pinc-signout')).toBeVisible();

  // The fields take digits only, at most four, masked by default.
  await expect(page.getByTestId('pinc-new')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('pinc-new')).toHaveAttribute('inputmode', 'numeric');
  await page.getByTestId('pinc-new').fill('48a2199');
  await expect(page.getByTestId('pinc-new')).toHaveValue('4821');

  // Client checks: too short, then not matching. Nothing is sent.
  await submitPin(page, '482');
  await expect(page.getByText('Enter exactly 4 digits.')).toBeVisible();
  await submitPin(page, CHOSEN_PIN, '4822');
  await expect(page.getByText('The two PINs do not match.')).toBeVisible();
  expect(calls.changes).toEqual([]);

  // Show / hide.
  await page.getByTestId('pinc-toggle').click();
  await expect(page.getByTestId('pinc-new')).toHaveAttribute('type', 'text');
  await expect(page.getByTestId('pinc-confirm')).toHaveAttribute('type', 'text');
  await page.getByTestId('pinc-toggle').click();
  await expect(page.getByTestId('pinc-new')).toHaveAttribute('type', 'password');

  await submitPin(page, CHOSEN_PIN);
  await expect(pinGate(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator('aside').first()).toBeAttached();
  await expect(page.getByText('Your new PIN is saved. Use it the next time you sign in.')).toBeVisible();
  expect(calls.changes).toEqual([{ auth: `Bearer ${PWC_TOKEN}`, body: { newPin: CHOSEN_PIN } }]);
  expect(calls.adminChanges).toBe(0);
  // The new session replaces the held one, as sign-in stores one.
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe(NEW_TOKEN);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('user') || 'null'))).toMatchObject({ ...STAFF, passwordChangeRequired: false });
  // Before the change only sign-in, the shell's reads and the change route were asked.
  const before = calls.paths.slice(0, calls.paths.indexOf('POST /auth/pin/change'));
  expect(before.every(p => /\/auth\/(options|pin\/login)$|\/me\/(personas|invitations)$/.test(p))).toBe(true);
});

test('a 403 password_change_required on check-ins opens the PIN step; afterwards the staff landing opens', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [], adminChanges: 0 };
  await blockOutside(page);
  await restoreStaffSession(page);
  await mockBackend(page, calls, ok);

  await page.goto('/checkins');
  await expect(pinGate(page)).toBeVisible();
  expect(calls.paths).toContain('GET /operator/checkins');
  await submitPin(page, CHOSEN_PIN);
  await expect(pinGate(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard/);
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe(NEW_TOKEN);
});

test('a held staff session cannot open the scanner: user.passwordChangeRequired alone shows the step', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [], adminChanges: 0 };
  await blockOutside(page);
  await restoreStaffSession(page, { user: { ...STAFF, passwordChangeRequired: true } });
  await mockBackend(page, calls, ok);

  await page.goto('/scan');
  await expect(pinGate(page)).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  // Nothing the scanner needs was asked for.
  expect(calls.paths.filter(p => !/\/me\/(personas|invitations)$/.test(p))).toEqual([]);
});

test('each refusal of the PIN route reads plainly, and the session is kept', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [], adminChanges: 0 };
  const answers: Reply[] = [
    { status: 400, json: { error: 'pin_must_be_4_digits' } },
    { status: 400, json: { error: 'pin_unchanged' } },
    { status: 409, json: { error: 'pin_change_not_required' } },
    { status: 409, json: { error: 'pin_change_in_progress' } },
    { status: 502, json: { error: 'firebase_update_failed' } },
    { status: 404, json: { error: 'feature_disabled' } },
    { status: 503, json: { error: 'pin_check_unavailable' } },
    { status: 500, json: { error: 'boom' } },
  ];
  await blockOutside(page);
  await restoreStaffSession(page);
  await mockBackend(page, calls, () => answers.shift()!);

  await page.goto('/checkins');
  await expect(pinGate(page)).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText('Enter exactly 4 digits.')).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText('Choose a PIN that is different from the starting PIN.')).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText('Your PIN has already been changed. Sign out, then sign in with your own PIN.')).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText('A PIN change is already in progress. Wait a minute and try again.')).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText("We couldn't save your new PIN just now. Your PIN has not changed. Try again in a moment.")).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText('Changing your PIN is not available right now. Your PIN has not changed. Sign out, then sign in again.')).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText("We couldn't check your new PIN right now. Nothing was changed — try again later.")).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText('Something went wrong. Your PIN has not changed. Try again.')).toBeVisible();
  expect(calls.changes).toHaveLength(8);
  await expect(pinGate(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('opaque-session-token');
});

test('PIN changed but no new session: signed out and sent to sign in with the new PIN', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [], adminChanges: 0 };
  await blockOutside(page);
  await restoreStaffSession(page);
  await mockBackend(page, calls, () => ({ status: 500, json: { error: 'pin_changed_session_failed' } }));

  await page.goto('/checkins');
  await expect(pinGate(page)).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Your PIN was changed, but we could not start your new session. Sign in again with your new PIN.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
});

test('Swahili: the PIN step and its refusals read in Swahili; sign out ends the session', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [], adminChanges: 0 };
  await blockOutside(page);
  await restoreStaffSession(page, { locale: 'sw' });
  const swAnswers: Reply[] = [{ status: 400, json: { error: 'pin_unchanged' } }, { status: 503, json: { error: 'pin_check_unavailable' } }];
  await mockBackend(page, calls, () => swAnswers.shift()!);

  await page.goto('/checkins');
  await expect(pinGate(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chagua PIN yako mwenyewe' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'PIN mpya', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Thibitisha PIN mpya' })).toBeVisible();
  await submitPin(page, '12');
  await expect(page.getByText('Weka tarakimu 4 kamili.')).toBeVisible();
  await submitPin(page, CHOSEN_PIN, '9999');
  await expect(page.getByText('PIN mbili hazifanani.')).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText('Chagua PIN tofauti na ile ya kuanzia.')).toBeVisible();
  await submitPin(page, CHOSEN_PIN);
  await expect(page.getByText('Hatukuweza kukagua PIN yako mpya sasa hivi. Hakuna kilichobadilishwa — jaribu tena baadaye.')).toBeVisible();
  await page.getByTestId('pinc-signout').click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
});

test('a held admin still gets the password step, not the PIN step', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [], adminChanges: 0 };
  await blockOutside(page);
  await restoreStaffSession(page, { user: ADMIN });
  await mockBackend(page, calls, ok);

  await page.goto('/admin/users');
  await expect(page.getByTestId('change-password-gate')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
  await expect(pinGate(page)).toHaveCount(0);
  await expect(page.getByTestId('pwc-new')).toBeVisible();
  await expect(page.getByTestId('pinc-new')).toHaveCount(0);
});

/* ── Owner: staff rows and Reset PIN ─────────────────────── */

const OWNER = { id: 'owner-1', userType: 'gym_operator', email: 'owner@example.com' };

async function mockOwner(page: Page, staffRows: object[], reset: (body: any) => Reply, resets: Array<{ id: string; body: any }>) {
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/owner/gyms') return route.fulfill({ json: [{ id: 'gym-1', name: 'Mikocheni Fitness', location: 'Mikocheni', tier: 'standard', status: 'active' }] });
    if (path === '/owner/members') return route.fulfill({ json: { members: [], stats: { totalMembers: 0, activeMembers: 0 } } });
    if (path === '/owner/staff') return route.fulfill({ json: staffRows });
    if (path === '/owner/trainers' || path === '/owner/trainers/pending') return route.fulfill({ json: [] });
    const m = path.match(/^\/owner\/staff\/([^/]+)\/pin$/);
    if (m && request.method() === 'POST') {
      const body = request.postDataJSON();
      resets.push({ id: m[1], body });
      return route.fulfill(reset(body));
    }
    if (path === '/me/personas' || path === '/me/invitations') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ json: {} });
  });
}

async function asOwner(page: Page, locale = 'en') {
  await page.addInitScript(([u, loc]) => {
    localStorage.setItem('token', 'owner-e2e-token');
    localStorage.setItem('user', u);
    localStorage.setItem('locale', loc);
  }, [JSON.stringify(OWNER), locale]);
}

const ROWS = [
  { id: 'staff-1', displayName: 'Reception One', email: 'r1@example.com', passwordChangeRequired: true },
  { id: 'staff-2', displayName: 'Reception Two', email: 'r2@example.com', passwordChangeRequired: false },
];

test('owner sees who must change their PIN and resets a PIN', async ({ page }) => {
  const resets: Array<{ id: string; body: any }> = [];
  await blockOutside(page);
  await asOwner(page);
  await mockOwner(page, ROWS, () => ({ status: 200, json: { ...ROWS[1], passwordChangeRequired: true } }), resets);

  await page.goto('/owner/manage');
  const row1 = page.getByTestId('owner-staff-staff-1');
  const row2 = page.getByTestId('owner-staff-staff-2');
  await expect(row1.getByText('Must change PIN')).toBeVisible();
  await expect(row2.getByText('Must change PIN')).toHaveCount(0);

  await page.getByTestId('owner-staff-reset-staff-2').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Reset PIN for Reception Two' })).toBeVisible();
  // Four digits only; a short one is refused before anything is sent.
  await page.getByTestId('owner-staff-reset-pin').fill('77');
  await page.getByTestId('owner-staff-reset-submit').click();
  await expect(dialog.getByText('Enter exactly 4 digits.')).toBeVisible();
  expect(resets).toEqual([]);
  await page.getByTestId('owner-staff-reset-pin').fill('7777');
  await page.getByTestId('owner-staff-reset-submit').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(resets).toEqual([{ id: 'staff-2', body: { pin: '7777' } }]);
  await expect(page.getByText('PIN reset. Reception Two must choose their own PIN at the next sign-in.')).toBeVisible();
  await expect(row2.getByText('Must change PIN')).toBeVisible();
});

test('each refusal of the owner reset reads plainly and keeps the dialog open', async ({ page }) => {
  const resets: Array<{ id: string; body: any }> = [];
  const answers: Reply[] = [
    { status: 409, json: { error: 'staff_identity_shared' } },
    { status: 400, json: { error: 'credentials_not_accepted' } },
    { status: 404, json: { error: 'feature_disabled' } },
    { status: 400, json: { error: 'pin_must_be_4_digits' } },
    { status: 404, json: { error: 'staff_not_found' } },
    { status: 403, json: { error: 'staff_not_at_your_gym' } },
    { status: 502, json: { error: 'firebase_update_failed' } },
    { status: 500, json: { error: 'boom' } },
  ];
  await blockOutside(page);
  await asOwner(page);
  await mockOwner(page, ROWS, () => answers.shift()!, resets);

  await page.goto('/owner/manage');
  await page.getByTestId('owner-staff-reset-staff-1').click();
  const dialog = page.getByRole('dialog');
  const send = async () => {
    await page.getByTestId('owner-staff-reset-pin').fill('7777');
    await page.getByTestId('owner-staff-reset-submit').click();
  };
  await send();
  await expect(dialog.getByText("Reception One signs in with their own FitFlex account, so you can't reset their PIN. Ask them to use Forgot PIN in the FitFlex app.")).toBeVisible();
  await send();
  await expect(dialog.getByText('PINs are no longer set here: staff join by invitation and choose their own PIN.')).toBeVisible();
  await send();
  await expect(dialog.getByText('Resetting staff PINs is not available yet.')).toBeVisible();
  await send();
  await expect(dialog.getByText('Enter exactly 4 digits.')).toBeVisible();
  await send();
  await expect(dialog.getByText('This staff member is no longer at your gym. Reload the page.')).toBeVisible();
  await send();
  await expect(dialog.getByText("This staff member also works at a gym you don't own, so only FitFlex can reset their PIN.")).toBeVisible();
  await send();
  await expect(dialog.getByText("We couldn't set the new PIN. Reception One has been signed out and their old PIN still works. Try again.")).toBeVisible();
  await send();
  await expect(dialog.getByText('The PIN could not be reset. Try again.')).toBeVisible();
  expect(resets).toHaveLength(8);
  await expect(dialog).toBeVisible();
});

test('flag off (rows without passwordChangeRequired): no badge and no Reset PIN', async ({ page }) => {
  const resets: Array<{ id: string; body: any }> = [];
  await blockOutside(page);
  await asOwner(page);
  await mockOwner(page, [{ id: 'staff-1', displayName: 'Reception One' }], () => ({ status: 404, json: { error: 'feature_disabled' } }), resets);

  await page.goto('/owner/manage');
  await expect(page.getByText('Reception One')).toBeVisible();
  await expect(page.getByTestId('owner-staff-reset-staff-1')).toHaveCount(0);
  await expect(page.getByText('Must change PIN')).toHaveCount(0);
});

test('Swahili: owner badge, reset dialog and a refusal', async ({ page }) => {
  const resets: Array<{ id: string; body: any }> = [];
  await blockOutside(page);
  await asOwner(page, 'sw');
  const swResets: Reply[] = [{ status: 409, json: { error: 'staff_identity_shared' } }, { status: 403, json: { error: 'staff_not_at_your_gym' } }];
  await mockOwner(page, ROWS, () => swResets.shift()!, resets);

  await page.goto('/owner/manage');
  await expect(page.getByTestId('owner-staff-staff-1').getByText('Lazima abadilishe PIN')).toBeVisible();
  await page.getByTestId('owner-staff-reset-staff-1').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Weka PIN upya kwa Reception One' })).toBeVisible();
  await page.getByTestId('owner-staff-reset-pin').fill('7777');
  await page.getByTestId('owner-staff-reset-submit').click();
  await expect(dialog.getByText('Reception One anaingia kwa akaunti yake mwenyewe ya FitFlex, kwa hiyo huwezi kuweka PIN yake upya. Mwombe atumie Forgot PIN kwenye programu ya FitFlex.')).toBeVisible();
  await page.getByTestId('owner-staff-reset-pin').fill('7777');
  await page.getByTestId('owner-staff-reset-submit').click();
  await expect(dialog.getByText('Mfanyakazi huyu anafanya kazi pia kwenye gym ambayo si yako, kwa hiyo ni FitFlex pekee wanaoweza kuweka PIN yake upya.')).toBeVisible();
});
