import { expect, test, type Page, type Request } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

/**
 * Scanner refusal messages (slice A5). The backend answers POST /operator/checkins
 * with `failure` for check-in rules and `error` for access checks; staff must see
 * the right reason for each, never the expired-QR message as a fallback.
 * Fully mocked: no backend needed.
 */
type Mock = { status: number; body: unknown } | 'network';

async function openScanner(page: Page, mock: Mock, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript((l) => {
    localStorage.setItem('token', 'operator-e2e-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'operator-1',
      userType: 'gym_operator',
      email: 'operator@example.com',
      gymId: 'gym-1',
    }));
    localStorage.setItem('locale', l);
  }, locale);
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/operator/checkins' && route.request().method() === 'POST') {
      if (mock === 'network') return route.abort('internetdisconnected');
      return route.fulfill({ status: mock.status, json: mock.body });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/scan');
  await page.getByTestId('manual-token').fill('usr_test.123.sig');
  await page.getByTestId('manual-submit').click();
}

const EXPIRED_EN = 'QR code expired';

test('wrong_gym (409 failure) shows the different-gym message', async ({ page }) => {
  await openScanner(page, { status: 409, body: { ok: false, failure: 'wrong_gym' } });
  const msg = page.getByTestId('scan-failure-message');
  await expect(msg).toHaveText("Member's membership is for a different gym");
  await expect(page.getByTestId('scan-result')).not.toContainText(EXPIRED_EN);
  await expect(page.getByTestId('scan-failure-code')).toHaveCount(0);
});

test('gym_not_verified (409 failure) shows the verification message', async ({ page }) => {
  await openScanner(page, { status: 409, body: { ok: false, failure: 'gym_not_verified' } });
  await expect(page.getByTestId('scan-failure-message')).toContainText('This gym is not verified yet');
  await expect(page.getByTestId('scan-result')).not.toContainText(EXPIRED_EN);
});

test('not_your_gym (403 error field) is read and not shown as an expired QR', async ({ page }) => {
  await openScanner(page, { status: 403, body: { error: 'not_your_gym' } });
  await expect(page.getByTestId('scan-failure-message'))
    .toHaveText('You are not allowed to check members in at this gym');
  await expect(page.getByTestId('scan-result')).not.toContainText(EXPIRED_EN);
});

test('operator_not_assigned_to_gym (400 error field) shows the staff-link message', async ({ page }) => {
  await openScanner(page, { status: 400, body: { error: 'operator_not_assigned_to_gym' } });
  await expect(page.getByTestId('scan-failure-message')).toContainText('Your account is not linked to a gym');
});

test('tier_not_configured shows the pass-type message', async ({ page }) => {
  await openScanner(page, { status: 409, body: { ok: false, failure: 'tier_not_configured' } });
  await expect(page.getByTestId('scan-failure-message')).toContainText("Member's pass type is not set up");
});

test('unknown code shows the generic refusal with the code in small text', async ({ page }) => {
  await openScanner(page, { status: 409, body: { ok: false, failure: 'brand_new_reason' } });
  await expect(page.getByTestId('scan-failure-message')).toHaveText('Check-in refused — contact FitFlex support');
  await expect(page.getByTestId('scan-failure-code')).toHaveText('Code: brand_new_reason');
  await expect(page.getByTestId('scan-result')).not.toContainText(EXPIRED_EN);
});

test('expired QR (401) shows the expired message and keeps the operator signed in', async ({ page }) => {
  await openScanner(page, { status: 401, body: { ok: false, failure: 'invalid_or_expired_qr' } });
  await expect(page.getByTestId('scan-failure-message')).toHaveText('QR code expired — ask member to refresh');
  await expect(page).toHaveURL(/\/scan/);
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('operator-e2e-token');
});

test('network failure is shown separately from refusals', async ({ page }) => {
  await openScanner(page, 'network');
  await expect(page.getByTestId('scan-problem')).toContainText('Could not reach FitFlex');
  await expect(page.getByTestId('scan-result')).toHaveCount(0);
});

test('refusal messages are shown in Swahili', async ({ page }) => {
  await openScanner(page, { status: 403, body: { error: 'not_your_gym' } }, 'sw');
  await expect(page.getByTestId('scan-failure-message'))
    .toHaveText('Huna ruhusa ya kuwaingiza wanachama katika gym hii');
});

// ── Gym choice for operators who work at more than one gym ──

const GYM_A = { id: 'gym-a', name: 'Iron Paradise Mikocheni' };
const GYM_B = { id: 'gym-b', name: 'Iron Paradise Masaki' };

async function scannerWithGyms(page: Page, gyms: unknown[], checkin: { status: number; body: unknown }, stored?: string) {
  const posts: Record<string, unknown>[] = [];
  await page.addInitScript((s) => {
    localStorage.setItem('token', 'operator-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'operator-1', userType: 'gym_operator', email: 'operator@example.com' }));
    localStorage.setItem('locale', 'en');
    if (s) localStorage.setItem('fitflex.scan.gymId.operator-1', s);
  }, stored ?? '');
  await page.route(`${API}/**`, async route => {
    const req: Request = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/owner/gyms') return route.fulfill({ json: gyms });
    if (url.pathname === '/operator/checkins' && req.method() === 'POST') {
      posts.push(req.postDataJSON());
      return route.fulfill({ status: checkin.status, json: checkin.body });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/scan');
  return posts;
}

const OK = { status: 200, body: { ok: true, checkin: { id: 'c1', memberId: 'm1', memberPublicId: 'm1', passTier: 'pro', visitNumberInCycle: 1 } } };

test('multi-gym operator must pick a gym; gymId is sent and remembered', async ({ page }) => {
  const posts = await scannerWithGyms(page, [GYM_A, GYM_B], OK);
  const select = page.getByTestId('scan-gym-select');
  await expect(select).toBeVisible();
  await expect(page.getByText('Gym you are checking members in at')).toBeVisible();
  await page.getByTestId('manual-token').fill('usr_test.123.sig');
  await expect(page.getByTestId('manual-submit')).toBeDisabled();
  await expect(page.getByTestId('start-scan')).toBeDisabled();

  await select.selectOption('gym-b');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('scan-result')).toContainText('Check-in successful');
  expect(posts).toEqual([{ qrToken: 'usr_test.123.sig', gymId: 'gym-b' }]);

  await page.reload();
  await expect(page.getByTestId('scan-gym-select')).toHaveValue('gym-b');
  await expect(page.getByTestId('start-scan')).toBeEnabled();
});

test('a remembered gym that is no longer theirs is not used', async ({ page }) => {
  await scannerWithGyms(page, [GYM_A, GYM_B], OK, 'gym-gone');
  await expect(page.getByTestId('scan-gym-select')).toHaveValue('');
  await expect(page.getByTestId('start-scan')).toBeDisabled();
});

test('single-gym operator sees no picker and sends no gymId', async ({ page }) => {
  const posts = await scannerWithGyms(page, [GYM_A], OK);
  await page.getByTestId('manual-token').fill('usr_test.123.sig');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('scan-result')).toContainText('Check-in successful');
  await expect(page.getByTestId('scan-gym-select')).toHaveCount(0);
  expect(posts).toEqual([{ qrToken: 'usr_test.123.sig' }]);
});

test('gym_required from the backend shows the picker and asks to choose a gym', async ({ page }) => {
  await scannerWithGyms(page, [GYM_A], { status: 400, body: { ok: false, failure: 'gym_required' } });
  await page.getByTestId('manual-token').fill('usr_test.123.sig');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('scan-failure-message')).toHaveText('Choose the gym for this check-in above, then scan again');
  await expect(page.getByTestId('scan-gym-select')).toBeVisible();
  await expect(page.getByTestId('manual-submit')).toBeDisabled();
});
