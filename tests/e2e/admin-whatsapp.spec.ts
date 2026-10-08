import { expect, test } from '@playwright/test';

// Communications QA (M12) — the admin WhatsApp page, with the API mocked:
// what is missing on the server (names only, never values), and the kill
// switch.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

test('admins see why WhatsApp is off and can pause and resume it', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', e => runtimeErrors.push(e));
  const puts: unknown[] = [];
  let enabled = true;
  const status = () => ({
    provider: { name: 'not_configured', configured: false, setup: { reason: 'missing_credentials', wanted: 'meta', missing: ['WHATSAPP_META_TOKEN', 'WHATSAPP_META_PHONE_ID'] } },
    enabled, available: false,
    webhook: { path: '/webhooks/whatsapp/status', secretSet: false },
    members: { withPhone: 812, marketingOptedIn: 57, optedOut: 3 },
    templates: { pending: 0, approved: 0, rejected: 0, paused: 0 },
    last7Days: {},
  });

  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/admin/communications/whatsapp' && req.method() === 'PUT') {
      const body = req.postDataJSON() as { enabled: boolean };
      puts.push(body);
      enabled = body.enabled;
      return route.fulfill({ json: status() });
    }
    if (p === '/admin/communications/whatsapp') return route.fulfill({ json: status() });
    if (p === '/admin/communications/whatsapp/templates') return route.fulfill({ json: { provider: 'not_configured', templates: [], expected: [] } });
    if (p === '/admin/communications/overview') {
      return route.fulfill({ json: { senderType: 'platform', members: 900, trainers: 4, campaigns: {}, recent: [], channels: { in_app: true, push: false, whatsapp: false, sms: false }, limits: { largeSendThreshold: 500, marketingWeeklyCap: 2 } } });
    }
    if (p === '/admin/communications/campaigns') return route.fulfill({ json: { campaigns: [], nextCursor: null } });
    if (p === '/admin/communications/analytics') {
      return route.fulfill({ json: {
        attribution: { model: 'last_touch', clickWindowDays: 7, openWindowDays: 3 },
        members: { recipients: 0, sent: 0, delivered: null, failed: 0, opened: 0, clicked: 0, ctaCompleted: null, renewed: 0, paid: 0 },
        revenue: { currency: 'TZS', attributedTzs: 0, payments: 0 }, channels: {}, sources: [],
      } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/admin/communications');
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  const statusCard = page.getByTestId('wa-status');
  await expect(statusCard).toContainText('Not set up');
  await expect(statusCard).toContainText('settings are incomplete');
  await expect(statusCard).toContainText('WHATSAPP_META_TOKEN, WHATSAPP_META_PHONE_ID');
  await expect(page.getByTestId('wa-sync')).toBeDisabled();

  // The kill switch asks first, then pauses; resuming needs no confirmation.
  await page.getByTestId('wa-pause').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Pause WhatsApp' }).click();
  await expect(page.getByTestId('wa-resume')).toBeVisible();
  await expect(statusCard).toContainText('Paused');
  await page.getByTestId('wa-resume').click();
  await expect(page.getByTestId('wa-pause')).toBeVisible();
  expect(puts).toEqual([{ enabled: false }, { enabled: true }]);
  expect(runtimeErrors).toEqual([]);
});
