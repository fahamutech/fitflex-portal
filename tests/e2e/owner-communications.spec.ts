import { expect, test, type Page } from '@playwright/test';

// Communications QA (M12) — the owner's Communication Center in the portal,
// with the API mocked: choosing a gym, a sent campaign's results and
// recipients (including the M11 skip reasons), and using a campaign again.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

const results = {
  attribution: { model: 'last_touch', clickWindowDays: 7, openWindowDays: 3 },
  members: { recipients: 120, sent: 120, delivered: 113, failed: 2, opened: 82, clicked: 61, ctaCompleted: 30, renewed: 24, paid: 26 },
  revenue: { currency: 'TZS', attributedTzs: 1_920_000, payments: 26 },
  channels: {}, reasons: { failed: {}, skipped: {} }, conversions: [], sources: [],
};
const sent = {
  id: 'cmp_sent', senderType: 'gym', gymId: 'gym_b', name: 'September renewals', purpose: 'renewal', category: 'transactional',
  status: 'sent', audience: { preset: 'expiring' }, channels: ['in_app', 'push'],
  content: { title: 'Time to renew', body: 'Hi {{member_name}}, renew today.', ctaLabel: 'Renew', deepLink: 'renewal' },
  scheduledAt: null, sentAt: '2026-09-20T07:00:00Z', createdAt: '2026-09-19T07:00:00Z', createdByName: 'Owner Asha',
  counts: { targeted: 120, queued: 118, skipped: { account_suspended: 1, not_gym_member: 1 }, byChannel: {} },
  stats: {
    targeted: 120, messages: 240,
    byChannel: { in_app: { delivered: 113, read: 82 }, push: { sent: 5 } },
    totals: { targeted: 120, sent: 118, delivered: 113, opened: 82, clicked: 61, failed: 2, skipped: 2, pending: 0 },
  },
};

async function mockApi(page: Page, calls: string[]) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'owner-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'owner-1', userType: 'gym_operator', email: 'owner@example.com', gymIds: ['gym_a', 'gym_b'] }));
  });
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    calls.push(`${req.method()} ${p}${url.search}`);
    if (p === '/owner/gyms') return route.fulfill({ json: [{ id: 'gym_a', name: 'Alpha Gym' }, { id: 'gym_b', name: 'Bravo Gym' }] });
    if (p === '/owner/communications/overview') {
      return route.fulfill({ json: {
        senderType: 'gym', gymIds: [url.searchParams.get('gymId') || 'gym_a'], members: 120, campaigns: { sent: 1 }, recent: [sent],
        channels: { in_app: true, push: true, whatsapp: false, sms: true }, limits: { largeSendThreshold: 500, marketingWeeklyCap: 2 },
      } });
    }
    if (p === '/owner/communications/campaigns' && req.method() === 'GET') return route.fulfill({ json: { campaigns: [sent], nextCursor: null } });
    if (p === '/owner/communications/campaigns/cmp_sent') {
      return route.fulfill({ json: { campaign: sent, progress: { in_app: { delivered: 113 }, push: { sent: 5 } }, stats: sent.stats } });
    }
    if (p === '/owner/communications/campaigns/cmp_sent/analytics') return route.fulfill({ json: results });
    if (p === '/owner/communications/analytics') return route.fulfill({ json: { ...results, period: { from: '2026-08-30', to: '2026-09-29', days: 30 } } });
    if (p === '/owner/communications/campaigns/cmp_sent/recipients') {
      return route.fulfill({ json: { recipients: [
        { memberId: 'usr_1', memberName: 'Amina Said', outcome: 'reached', channels: [{ id: 'm1', channel: 'in_app', status: 'read', failureReason: null, skipReason: null }] },
        { memberId: 'usr_2', memberName: 'Baraka Juma', outcome: 'skipped', channels: [{ id: 'm2', channel: 'in_app', status: 'skipped', failureReason: null, skipReason: 'account_suspended' }] },
      ], nextCursor: null } });
    }
    if (p === '/owner/communications/campaigns/cmp_sent/duplicate') {
      return route.fulfill({ status: 201, json: { campaign: { ...sent, id: 'cmp_copy', name: 'September renewals (copy)', status: 'draft', sentAt: null, counts: null, stats: null } } });
    }
    if (p === '/owner/communications/segments') return route.fulfill({ json: { scope: 'gym', presets: [{ key: 'all', filter: {} }, { key: 'expiring', filter: {} }], fields: [] } });
    if (p === '/owner/communications/audience/preview') {
      return route.fulfill({ json: { count: 9, category: 'transactional', channels: { in_app: { eligible: 9, excluded: {} }, push: { eligible: 4, excluded: { no_device: 5 } }, whatsapp: { eligible: 0, excluded: {} } }, sample: [] } });
    }
    if (p === '/owner/communications/templates') return route.fulfill({ json: { templates: [] } });
    return route.fulfill({ json: {} });
  });
}

test('an owner with two gyms opens a sent campaign, sees how it did, and uses it again', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', e => runtimeErrors.push(e));
  const calls: string[] = [];
  await mockApi(page, calls);

  await page.goto('/owner/communications');
  await expect(page.getByTestId('comms-home')).toBeVisible();
  // SMS is one of the channels, and is on.
  await expect(page.getByTestId('channel-sms')).toContainText('SMS');
  await expect(page.getByTestId('channel-sms')).toContainText('On');
  await expect(page.getByTestId('channel-whatsapp')).toContainText('Coming soon');

  // Choosing a gym scopes what is loaded to it.
  await page.getByTestId('comms-gym').selectOption('gym_b');
  await expect.poll(() => calls.some(c => c.startsWith('GET /owner/communications/overview?gymId=gym_b'))).toBe(true);

  // A sent campaign: results in three groups, recipients with reasons.
  await page.getByTestId('campaign-cmp_sent').first().click();
  await expect(page.getByTestId('comms-detail')).toBeVisible();
  await expect(page.getByTestId('result-revenue')).toContainText('TZS 1,920,000');
  await expect(page.getByTestId('result-renewed')).toContainText('24');
  await expect(page.getByTestId('delivery')).toContainText('Account suspended');
  await expect(page.getByTestId('delivery')).toContainText('Not a member of this gym');

  // Use it again: a new draft opens in the composer.
  await page.getByTestId('detail-duplicate').click();
  await expect(page.getByTestId('comms-composer')).toBeVisible();
  expect(calls).toContain('POST /owner/communications/campaigns/cmp_sent/duplicate');
  expect(runtimeErrors).toEqual([]);
});

test('a permission taken away shows a plain message, not a raw error', async ({ page }) => {
  const calls: string[] = [];
  await mockApi(page, calls);
  await page.route(`${API}/owner/communications/overview**`, route => route.fulfill({ status: 403, json: { error: 'acl_forbidden', requiredScope: 'communications' } }));
  await page.goto('/owner/communications');
  await expect(page.getByText('Communications permission any more')).toBeVisible();
});
