import { expect, test, type Page } from '@playwright/test';

// C10: gym owners and gym staff sign in at the portal. The portal never
// registers anyone: it asks for an admin profile, then an existing owner
// profile, then an existing staff profile, and only "no such profile" moves
// on. Firebase's REST endpoints and the FitFlex API are mocked.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const EMAIL = 'owner@example.com';

function fakeIdToken() {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({
      iss: 'https://securetoken.google.com/fitflex-test', aud: 'fitflex-test',
      auth_time: now, user_id: 'fb_owner', sub: 'fb_owner', iat: now, exp: now + 3600,
      email: EMAIL, email_verified: true,
      firebase: { identities: { email: [EMAIL] }, sign_in_provider: 'password' },
    }),
    'sig',
  ].join('.');
}

/** Firebase accepts only `accepted` as the password; records every password tried. */
async function mockFirebase(page: Page, accepted: string, tried: string[]) {
  await page.route('https://identitytoolkit.googleapis.com/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('accounts:signInWithPassword')) {
      const { password } = route.request().postDataJSON();
      tried.push(password);
      if (password !== accepted) {
        return route.fulfill({ status: 400, json: { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } } });
      }
      return route.fulfill({ json: {
        kind: 'identitytoolkit#VerifyPasswordResponse', localId: 'fb_owner', email: EMAIL,
        idToken: fakeIdToken(), refreshToken: 'refresh-1', expiresIn: '3600', registered: true,
      } });
    }
    if (path.endsWith('accounts:lookup')) {
      return route.fulfill({ json: { users: [{
        localId: 'fb_owner', email: EMAIL, emailVerified: true,
        providerUserInfo: [{ providerId: 'password', email: EMAIL, federatedId: EMAIL, rawId: EMAIL }],
        lastLoginAt: String(Date.now()), createdAt: String(Date.now()),
      }] } });
    }
    return route.fulfill({ status: 404, json: { error: { message: `unmocked ${path}` } } });
  });
}

/** The backend, holding one profile type (or none) for the signing-in identity. */
async function mockBackend(page: Page, answer: (body: any) => { status: number; json: object }, asked: any[]) {
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    if (new URL(request.url()).pathname === '/auth/firebase/session') {
      const { idToken, ...body } = request.postDataJSON();
      asked.push(body);
      return route.fulfill(answer(body));
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
}
const NOT_ADMIN = { status: 403, json: { error: 'admin_self_registration_not_allowed' } };
const NO_PROFILE = { status: 404, json: { error: 'profile_not_found' } };
const session = (userType: string) => ({ status: 200, json: { token: 'fitflex-jwt', user: { id: `usr_${userType}`, userType, email: EMAIL } } });

async function signIn(page: Page, password: string) {
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));
  await page.goto('/login');
  await page.getByTestId('email-method-btn').click();
  await page.getByTestId('email-input').fill(EMAIL);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('password-input').press('Enter');
}
const storedUser = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('user') || 'null'));

test('a gym owner signs in with the PIN they use in the app', async ({ page }) => {
  const tried: string[] = [];
  const asked: any[] = [];
  await mockFirebase(page, 'fitflex-pin:1234', tried);
  await mockBackend(page, body => (body.requestedRole === 'admin' ? NOT_ADMIN : body.requestedRole === 'gym_operator' ? session('gym_operator') : NO_PROFILE), asked);

  await signIn(page, '1234');
  await expect(page).toHaveURL(/\/dashboard/);
  expect(tried).toEqual(['1234', 'fitflex-pin:1234']);
  expect(asked).toEqual([{ requestedRole: 'admin' }, { requestedRole: 'gym_operator', existingOnly: true }]);
  expect((await storedUser(page)).userType).toBe('gym_operator');
});

test('gym staff sign in with their existing profile', async ({ page }) => {
  const asked: any[] = [];
  await mockFirebase(page, 'fitflex-pin:4321', []);
  await mockBackend(page, body => (body.requestedRole === 'admin' ? NOT_ADMIN : body.requestedRole === 'gym_staff' ? session('gym_staff') : NO_PROFILE), asked);

  await signIn(page, '4321');
  await expect(page).toHaveURL(/\/dashboard/);
  expect(asked).toEqual([
    { requestedRole: 'admin' },
    { requestedRole: 'gym_operator', existingOnly: true },
    { requestedRole: 'gym_staff', existingOnly: true },
  ]);
  expect((await storedUser(page)).userType).toBe('gym_staff');
});

test('an admin signs in on the first request, with a password, as before', async ({ page }) => {
  const tried: string[] = [];
  const asked: any[] = [];
  await mockFirebase(page, 'S3cure-password', tried);
  await mockBackend(page, () => session('admin'), asked);

  await signIn(page, 'S3cure-password');
  await expect(page).toHaveURL(/\/admin/);
  expect(tried).toEqual(['S3cure-password']);
  expect(asked).toEqual([{ requestedRole: 'admin' }]);
});

test('an account with no portal role gets no session, and nothing asks to create one', async ({ page }) => {
  const asked: any[] = [];
  await mockFirebase(page, 'fitflex-pin:1234', []);
  await mockBackend(page, body => (body.requestedRole === 'admin' ? NOT_ADMIN : NO_PROFILE), asked);

  await signIn(page, '1234');
  await expect(page.getByText('This account has no portal access.')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect(asked).toHaveLength(3);
  expect(asked.slice(1).every(body => body.existingOnly === true)).toBe(true);
  expect(await storedUser(page)).toBeNull();
});

test('a suspended owner is refused at once, without trying another role', async ({ page }) => {
  const asked: any[] = [];
  await mockFirebase(page, 'fitflex-pin:1234', []);
  await mockBackend(page, body => (body.requestedRole === 'admin' ? NOT_ADMIN : { status: 403, json: { error: 'account_suspended' } }), asked);

  await signIn(page, '1234');
  await expect(page.getByText('This account has been suspended.')).toBeVisible();
  expect(asked).toHaveLength(2);
  expect(await storedUser(page)).toBeNull();
});

test('a wrong password that is not a PIN is not retried', async ({ page }) => {
  const tried: string[] = [];
  const asked: any[] = [];
  await mockFirebase(page, 'the-right-one', tried);
  await mockBackend(page, () => session('admin'), asked);

  await signIn(page, 'wrong-password');
  await expect.poll(() => tried).toEqual(['wrong-password']);
  await expect(page.getByTestId('password-input')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect(tried).toEqual(['wrong-password']);
  expect(asked).toEqual([]);
});
