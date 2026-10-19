import { expect, test, type Page } from '@playwright/test';

// An admin who was created by another admin (POST /admin/portal-users) signs in with the start
// password and must choose their own before anything else: the session token carries `pwc: true`,
// and every ordinary route answers 403 password_change_required. POST /auth/portal/password
// returns a fresh { token, user }. Firebase's REST endpoints and the FitFlex API are mocked.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const EMAIL = 'new.admin@fitflex.test';
const START = 'Start-password-1';
const CHOSEN = 'My-own-password-22';
const ADMIN = { id: 'usr_new_admin', userType: 'admin', email: EMAIL, portalUser: true, aclPermissions: ['users'] };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** A FitFlex session JWT (only the payload matters to the portal). */
const sessionJwt = (claims: object) => [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: ADMIN.id, ...claims }), 'sig'].join('.');
const PWC_TOKEN = sessionJwt({ pwc: true });
const NEW_TOKEN = sessionJwt({ n: 2 });

function fakeIdToken() {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({
      iss: 'https://securetoken.google.com/fitflex-test', aud: 'fitflex-test',
      auth_time: now, user_id: 'fb_new_admin', sub: 'fb_new_admin', iat: now, exp: now + 3600,
      email: EMAIL, email_verified: true, firebase: { identities: { email: [EMAIL] }, sign_in_provider: 'password' },
    }),
    'sig',
  ].join('.');
}

async function blockOutside(page: Page) {
  // Nothing here may reach a real service (live API, Firebase, Google).
  await page.route(/^https?:\/\/(?!localhost[:/])/, route => route.abort());
}

async function mockFirebase(page: Page, accepted: string) {
  await page.route('https://identitytoolkit.googleapis.com/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('accounts:signInWithPassword')) {
      if (route.request().postDataJSON().password !== accepted) {
        return route.fulfill({ status: 400, json: { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } } });
      }
      return route.fulfill({ json: {
        kind: 'identitytoolkit#VerifyPasswordResponse', localId: 'fb_new_admin', email: EMAIL,
        idToken: fakeIdToken(), refreshToken: 'refresh-1', expiresIn: '3600', registered: true,
      } });
    }
    if (path.endsWith('accounts:lookup')) {
      return route.fulfill({ json: { users: [{
        localId: 'fb_new_admin', email: EMAIL, emailVerified: true,
        providerUserInfo: [{ providerId: 'password', email: EMAIL, federatedId: EMAIL, rawId: EMAIL }],
        lastLoginAt: String(Date.now()), createdAt: String(Date.now()),
      }] } });
    }
    return route.fulfill({ status: 404, json: { error: { message: `unmocked ${path}` } } });
  });
}

type Calls = { paths: string[]; changes: Array<{ auth: string | undefined; body: any }> };

/**
 * The backend as the contract describes it: a `pwc` token is refused (403 password_change_required)
 * everywhere except the shell's reads and the password route; `change` answers that route.
 */
async function mockBackend(page: Page, calls: Calls, change: (body: any) => { status: number; json: object }) {
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const auth = request.headers()['authorization'];
    calls.paths.push(`${request.method()} ${path}`);
    if (path === '/auth/options') return route.fulfill({ json: { pinLogin: false } });
    if (path === '/auth/firebase/session') return route.fulfill({ json: { token: PWC_TOKEN, user: ADMIN } });
    if (path === '/auth/portal/password') {
      const body = request.postDataJSON();
      calls.changes.push({ auth, body });
      return route.fulfill(change(body));
    }
    if (path === '/me/personas' || path === '/me/invitations') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (auth !== `Bearer ${NEW_TOKEN}`) return route.fulfill({ status: 403, json: { error: 'password_change_required' } });
    if (path === '/admin/portal-users') {
      return route.fulfill({ json: [
        { ...ADMIN, displayName: 'New Admin', accountStatus: 'active', passwordChangeRequired: false },
        { id: 'usr_other', email: 'other@fitflex.test', displayName: 'Other Admin', userType: 'admin', accountStatus: 'active', portalUser: true, aclPermissions: [], passwordChangeRequired: true },
      ] });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
}
const ok = () => ({ status: 200, json: { token: NEW_TOKEN, user: ADMIN } });

async function signInWithStartPassword(page: Page) {
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));
  await page.goto('/login');
  await page.getByTestId('email-method-btn').click();
  await page.getByTestId('email-input').fill(EMAIL);
  await page.getByTestId('password-input').fill(START);
  await page.getByTestId('password-input').press('Enter');
}

/** A session restored from storage whose token the portal cannot read: only the 403 tells it. */
async function restoreOpaqueSession(page: Page, locale = 'en') {
  await page.addInitScript(([user, loc]) => {
    if (!localStorage.getItem('token')) {
      localStorage.setItem('token', 'opaque-session-token');
      localStorage.setItem('user', user);
    }
    localStorage.setItem('locale', loc);
  }, [JSON.stringify(ADMIN), locale]);
}

const gate = (page: Page) => page.getByTestId('change-password-gate');

test('a pwc token from sign-in opens only the choose-password step, then the admin area', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [] };
  await blockOutside(page);
  await mockFirebase(page, START);
  await mockBackend(page, calls, ok);

  await signInWithStartPassword(page);
  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
  await expect(gate(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
  await expect(page.getByText('The person who created your account will no longer know it.')).toBeVisible();
  // No navigation and no admin page while the step is open.
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByTestId('pwc-signout')).toBeVisible();

  // Client checks: too short, then not matching. Nothing is sent.
  await page.getByTestId('pwc-new').fill('short');
  await page.getByTestId('pwc-confirm').fill('short');
  await page.getByTestId('pwc-submit').click();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
  await page.getByTestId('pwc-new').fill(CHOSEN);
  await page.getByTestId('pwc-confirm').fill(`${CHOSEN}x`);
  await page.getByTestId('pwc-submit').click();
  await expect(page.getByText('The two passwords do not match.')).toBeVisible();
  expect(calls.changes).toEqual([]);

  // Show / hide.
  await expect(page.getByTestId('pwc-new')).toHaveAttribute('type', 'password');
  await page.getByTestId('pwc-toggle').click();
  await expect(page.getByTestId('pwc-new')).toHaveAttribute('type', 'text');
  await expect(page.getByTestId('pwc-confirm')).toHaveAttribute('type', 'text');
  await page.getByTestId('pwc-toggle').click();
  await expect(page.getByTestId('pwc-new')).toHaveAttribute('type', 'password');

  await page.getByTestId('pwc-confirm').fill(CHOSEN);
  await page.getByTestId('pwc-submit').click();
  await expect(gate(page)).toHaveCount(0);
  await expect(page.locator('aside').first()).toBeAttached();
  expect(calls.changes).toEqual([{ auth: `Bearer ${PWC_TOKEN}`, body: { newPassword: CHOSEN } }]);
  // Stored exactly as sign-in stores a session.
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe(NEW_TOKEN);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('user') || 'null'))).toEqual(ADMIN);
  // Before the change only the sign-in, the shell's reads and the password route were asked.
  const before = calls.paths.slice(0, calls.paths.indexOf('POST /auth/portal/password'));
  expect(before.every(p => /\/auth\/(options|firebase\/session)$|\/me\/(personas|invitations)$/.test(p))).toBe(true);
});

test('a 403 password_change_required on any page opens the step; afterwards that page opens', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [] };
  await blockOutside(page);
  await restoreOpaqueSession(page);
  await mockBackend(page, calls, ok);

  await page.goto('/admin/users');
  await expect(gate(page)).toBeVisible();
  await page.getByTestId('pwc-new').fill(CHOSEN);
  await page.getByTestId('pwc-confirm').fill(CHOSEN);
  await page.getByTestId('pwc-submit').click();

  await expect(gate(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/users/);
  // The page they were going to, with the badge for an admin still on a start password.
  await expect(page.getByText('Other Admin')).toBeVisible();
  await expect(page.getByText('Must change password')).toHaveCount(1);
  await expect(page.getByText('Your new password is saved. Use it the next time you sign in.')).toBeVisible();
});

test('each refusal of the password route reads plainly, and the session is kept', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [] };
  const answers = [
    { status: 400, json: { error: 'password_unchanged' } },
    { status: 400, json: { error: 'password_too_short' } },
    { status: 502, json: { error: 'firebase_update_failed' } },
    { status: 409, json: { error: 'password_change_not_required' } },
    { status: 500, json: { error: 'boom' } },
  ];
  await blockOutside(page);
  await restoreOpaqueSession(page);
  await mockBackend(page, calls, () => answers.shift()!);

  // A page that asks the server for something: the 403 is what reveals the start password.
  await page.goto('/admin/users');
  await expect(gate(page)).toBeVisible();
  const submit = async () => {
    await page.getByTestId('pwc-new').fill(CHOSEN);
    await page.getByTestId('pwc-confirm').fill(CHOSEN);
    await page.getByTestId('pwc-submit').click();
  };
  await submit();
  await expect(page.getByText('Choose a password that is different from the starting password.')).toBeVisible();
  await submit();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
  await submit();
  await expect(page.getByText("We couldn't save your new password just now. Your password has not changed.")).toBeVisible();
  await submit();
  await expect(page.getByText('Your password has already been changed. Sign out, then sign in with your own password.')).toBeVisible();
  await submit();
  await expect(page.getByText('Something went wrong. Your password has not changed. Try again.')).toBeVisible();
  expect(calls.changes).toHaveLength(5);
  await expect(gate(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('opaque-session-token');
});

test('sign out stays available on the step and ends the session', async ({ page }) => {
  const calls: Calls = { paths: [], changes: [] };
  await blockOutside(page);
  await page.addInitScript(([user]) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('token', 'opaque-session-token');
      localStorage.setItem('user', user);
    }
    localStorage.setItem('locale', 'sw');
  }, [JSON.stringify(ADMIN)]);
  await mockBackend(page, calls, ok);

  // A page that asks the server for something: the 403 is what reveals the start password.
  await page.goto('/admin/users');
  await expect(gate(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chagua nenosiri lako mwenyewe' })).toBeVisible();
  await page.getByTestId('pwc-signout').click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  expect(calls.changes).toEqual([]);
});
