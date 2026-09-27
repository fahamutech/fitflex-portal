import { expect, test, type Page } from '@playwright/test';

// Identity V2 · I0: when the backend answers a Firebase sign-in with
// 409 email_verification_required, the login page keeps the Firebase session,
// sends the verification link and retries with a fresh ID token once the
// email is verified. Firebase's REST endpoints and the FitFlex API are mocked,
// so this runs without a real Firebase project.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const EMAIL = 'owner@example.com';

function fakeIdToken(emailVerified: boolean, n: number) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({
      iss: 'https://securetoken.google.com/fitflex-test', aud: 'fitflex-test',
      auth_time: now, user_id: 'fb_owner', sub: 'fb_owner', iat: now, exp: now + 3600,
      email: EMAIL, email_verified: emailVerified, n,
      firebase: { identities: { email: [EMAIL] }, sign_in_provider: 'password' },
    }),
    'sig',
  ].join('.');
}

async function mockFirebase(page: Page, state: { verified: boolean; oobSent: number }) {
  const account = () => ({
    localId: 'fb_owner', email: EMAIL, emailVerified: state.verified,
    providerUserInfo: [{ providerId: 'password', email: EMAIL, federatedId: EMAIL, rawId: EMAIL }],
    lastLoginAt: String(Date.now()), createdAt: String(Date.now()),
  });
  await page.route('https://identitytoolkit.googleapis.com/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('accounts:signInWithPassword')) {
      return route.fulfill({ json: {
        kind: 'identitytoolkit#VerifyPasswordResponse', localId: 'fb_owner', email: EMAIL,
        idToken: fakeIdToken(false, 1), refreshToken: 'refresh-1', expiresIn: '3600', registered: true,
      } });
    }
    if (path.endsWith('accounts:lookup')) return route.fulfill({ json: { users: [account()] } });
    if (path.endsWith('accounts:sendOobCode')) {
      state.oobSent += 1;
      return route.fulfill({ json: { email: EMAIL } });
    }
    return route.fulfill({ status: 404, json: { error: { message: `unmocked ${path}` } } });
  });
  await page.route('https://securetoken.googleapis.com/**', route => route.fulfill({ json: {
    access_token: fakeIdToken(state.verified, 2), id_token: fakeIdToken(state.verified, 2),
    refresh_token: 'refresh-2', expires_in: '3600', token_type: 'Bearer', user_id: 'fb_owner',
  } }));
}

test('an unverified email is sent the link, then signs in once verified', async ({ page }) => {
  const firebase = { verified: false, oobSent: 0 };
  const sessionTokens: string[] = [];
  await mockFirebase(page, firebase);
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/auth/firebase/session') {
      const { idToken } = request.postDataJSON();
      sessionTokens.push(idToken);
      const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
      if (!claims.email_verified) return route.fulfill({ status: 409, json: { error: 'email_verification_required' } });
      return route.fulfill({ json: { token: 'fitflex-jwt', user: { id: 'usr_admin', userType: 'admin', email: EMAIL } } });
    }
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));

  await page.goto('/login');
  await page.getByTestId('email-method-btn').click();
  await page.getByTestId('email-input').fill(EMAIL);
  await page.getByTestId('password-input').fill('fitflex-pin:1234');
  await page.getByTestId('email-submit').click();

  // The backend refused the unverified email: the verify step replaces the error.
  await expect(page.getByTestId('verify-email-step')).toBeVisible();
  await expect(page.getByText(`confirm ${EMAIL} before signing in`, { exact: false })).toBeVisible();
  await expect(page.getByText('Verification link sent.', { exact: false })).toBeVisible();
  expect(firebase.oobSent).toBe(1);

  // Not verified yet: stays on the step and says so, without a session call.
  await page.getByTestId('verify-email-continue').click();
  await expect(page.getByText('That email is not verified yet.', { exact: false })).toBeVisible();
  expect(sessionTokens).toHaveLength(1);

  await page.getByTestId('verify-email-resend').click();
  await expect.poll(() => firebase.oobSent).toBe(2);

  // Verified: the retry carries a freshly minted token and the session opens.
  firebase.verified = true;
  await page.getByTestId('verify-email-continue').click();
  await expect(page).toHaveURL(/\/admin/);
  expect(sessionTokens).toHaveLength(2);
  const retried = JSON.parse(Buffer.from(sessionTokens[1].split('.')[1], 'base64url').toString());
  expect(retried).toMatchObject({ email_verified: true, n: 2 });
});

test('use a different account leaves the verify step', async ({ page }) => {
  await mockFirebase(page, { verified: false, oobSent: 0 });
  await page.route(`${API}/**`, route => route.fulfill({ status: 409, json: { error: 'email_verification_required' } }));
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));

  await page.goto('/login');
  await page.getByTestId('email-method-btn').click();
  await page.getByTestId('email-input').fill(EMAIL);
  await page.getByTestId('password-input').fill('fitflex-pin:1234');
  await page.getByTestId('email-submit').click();
  await expect(page.getByTestId('verify-email-step')).toBeVisible();

  await page.getByTestId('verify-email-other-account').click();
  await expect(page.getByTestId('google-submit')).toBeVisible();
  await expect(page.getByTestId('verify-email-step')).toHaveCount(0);
});
