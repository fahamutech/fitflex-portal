import { expect, test, type Page } from '@playwright/test';

// Identity V2 · I2: the portal lists the Person's portal personas (from
// /me/personas) and switches the session with /auth/switch-persona. With the
// backend's V2 flags off, /me/personas is 404 and nothing appears.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

const persona = (id: string, userType: string, extra: Record<string, unknown> = {}) => ({
  id, userType, approvalStatus: 'approved', accountStatus: 'active', onboardingCompleted: true, portalOnly: false, ...extra,
});

async function signedInAsOwner(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('locale', 'en');
    localStorage.setItem('token', 'owner-token');
    localStorage.setItem('user', JSON.stringify({ id: 'usr_owner', userType: 'gym_operator', gymId: 'gym_1' }));
  });
}

test('lists only portal personas and switches the session', async ({ page }) => {
  const headers: string[] = [];
  const switched: string[] = [];
  await signedInAsOwner(page);
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    headers.push(request.headers()['x-fitflex-client'] ?? '');
    if (url.pathname === '/me/personas') {
      return route.fulfill({ json: { activePersonaId: 'usr_owner', personas: [
        persona('usr_owner', 'gym_operator'),
        persona('usr_hr', 'corporate_hr'),
        persona('usr_member', 'member'),
        persona('usr_trainer', 'trainer'),
        persona('usr_staff_off', 'gym_staff', { accountStatus: 'suspended' }),
        persona('usr_admin', 'admin', { portalOnly: true }),
      ] } });
    }
    if (url.pathname === '/auth/switch-persona') {
      switched.push(request.postDataJSON().personaId);
      return route.fulfill({ json: {
        token: 'hr-token', user: { id: 'usr_hr', userType: 'corporate_hr' },
        personas: [persona('usr_owner', 'gym_operator'), persona('usr_hr', 'corporate_hr')],
      } });
    }
    return route.fulfill({ json: [] });
  });

  // /scan needs no data to render the shell (the dashboard needs a fixture).
  await page.goto('/scan');
  const select = page.getByTestId('persona-select').first();
  await expect(select).toBeVisible();
  const options = await select.locator('option:not([disabled])').allTextContents();
  expect(options).toEqual(['Company HR'], 'no app-only, suspended, admin or current persona');

  await select.selectOption('usr_hr');
  await expect(page).toHaveURL(/\/hr/);
  expect(switched).toEqual(['usr_hr']);
  // Polled: the first visit to /hr can still be compiling in dev.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('token'))).toBe('hr-token');
  expect(headers.every(h => h === 'identity-v2')).toBe(true);
});

test('with Identity V2 off (404) there is no switcher', async ({ page }) => {
  await signedInAsOwner(page);
  await page.route(`${API}/**`, async route => {
    if (new URL(route.request().url()).pathname === '/me/personas') {
      return route.fulfill({ status: 404, json: { error: 'not_found' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/scan');
  await expect(page.getByTestId('locale-select').first()).toBeVisible();
  await expect(page.getByTestId('persona-switcher')).toHaveCount(0);
});
