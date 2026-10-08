import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

const channels = { in_app: { eligible: 3, excluded: {} }, push: { eligible: 1, excluded: { no_device: 2 } }, whatsapp: { eligible: 0, excluded: {} } };

test('FitFlex can address a message to trainers instead of members', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', error => runtimeErrors.push(error));
  const previews: Array<Record<string, unknown>> = [];
  const segmentQueries: string[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });

  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/communications/overview') {
      return route.fulfill({
        json: {
          senderType: 'platform', members: 120, trainers: 3, campaigns: {}, recent: [],
          channels: { in_app: true, push: true, whatsapp: false, sms: false },
          limits: { largeSendThreshold: 500, marketingWeeklyCap: 2 },
        },
      });
    }
    if (url.pathname === '/admin/communications/campaigns') return route.fulfill({ json: { campaigns: [], nextCursor: null } });
    if (url.pathname === '/admin/communications/analytics') {
      return route.fulfill({ json: {
        attribution: { model: 'last_touch', clickWindowDays: 7, openWindowDays: 3 },
        members: { recipients: 0, sent: 0, delivered: null, failed: 0, opened: 0, clicked: 0, ctaCompleted: null, renewed: 0, paid: 0 },
        revenue: { currency: 'TZS', attributedTzs: 0, payments: 0 }, channels: {}, sources: [],
      } });
    }
    if (url.pathname === '/admin/communications/segments') {
      segmentQueries.push(url.search);
      const trainers = url.searchParams.get('recipients') === 'trainers';
      return route.fulfill({
        json: {
          scope: trainers ? 'trainers' : 'platform',
          presets: (trainers ? ['all', 'verified', 'with_pass', 'no_gym', 'new'] : ['all', 'active', 'expiring']).map(key => ({ key, filter: {} })),
          fields: [],
        },
      });
    }
    if (url.pathname === '/admin/communications/audience/preview') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      previews.push(body);
      const trainers = body.recipients === 'trainers';
      return route.fulfill({
        json: {
          count: trainers ? 3 : 120, category: 'marketing', channels,
          sample: [{ id: 'u1', displayName: trainers ? 'Coach Asha' : 'Amina Said', status: 'active' }],
        },
      });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/communications');
  await expect(page.getByText('Trainers you can message')).toBeVisible();

  await page.getByTestId('comms-new').click();
  await page.getByTestId('purpose-promotion').click();
  await page.getByTestId('comms-next').click();

  await expect(page.getByTestId('recipients-members')).toBeVisible();
  await expect(page.getByTestId('audience-count')).toContainText('120 members match');

  await page.getByTestId('recipients-trainers').click();
  await expect(page.getByTestId('preset-with_pass')).toBeVisible();
  await expect(page.getByTestId('preset-all')).toHaveText('All trainers');
  await expect(page.getByTestId('audience-count')).toContainText('3 trainers match');
  await expect(page.getByTestId('audience-count')).toContainText('Coach Asha');

  await page.getByTestId('refine-trainer-verified').check();
  await expect.poll(() => previews.at(-1)).toMatchObject({
    recipients: 'trainers',
    preset: 'all',
    filter: { all: [{ field: 'trainerVerified', op: 'eq', value: 'yes' }] },
  });
  expect(segmentQueries).toContain('?recipients=trainers');
  expect(runtimeErrors).toEqual([]);
});
