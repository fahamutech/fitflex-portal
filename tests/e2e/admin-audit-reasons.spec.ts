import { expect, test, type Page, type Request } from '@playwright/test';

// Admin audit log viewer and required reasons (admin-portal audit S2/S3), against a mocked API.
// Every request outside localhost is aborted and recorded; nothing may reach the live API.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.use({ serviceWorkers: 'block' });

type Reply = { status?: number; json?: unknown };
type Routes = Record<string, Reply | ((req: Request) => Reply)>;
type Call = { method: string; path: string; search: string; body: Record<string, unknown> | null };

const SUPER = { id: 'adm_1', userType: 'admin', email: 'one@fitflex.test' };
const staff = (aclPermissions: string[]) => ({ id: 'staff_1', userType: 'admin', portalUser: true, aclPermissions, email: 'staff@fitflex.test' });

async function open(page: Page, user: Record<string, unknown>, routes: Routes, path: string, locale: 'en' | 'sw' = 'en') {
  const calls: Call[] = [];
  const outside: string[] = [];
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'admin-tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [user, locale] as const);
  await page.context().route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => { outside.push(route.request().url()); return route.abort(); });
  await page.context().route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body: Record<string, unknown> | null = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, search: url.search, body });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req) : hit;
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? null });
  });
  await page.goto(path);
  return Object.assign(calls, { outside });
}

const AT = '2026-11-01T08:15:00.000Z';
const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id, at: AT, actor: 'adm_1', action: 'member.suspend', target: `mem_${id}`, before: { accountStatus: 'active' }, after: { accountStatus: 'suspended' }, reason: `why ${id}`, ...extra,
});

test.describe('audit log', () => {
  test('lists entries, says it is append-only, and pages with the keyset cursor', async ({ page }) => {
    const calls = await open(page, SUPER, {
      'GET /admin/audit-log': req => {
        const cursor = new URL(req.url()).searchParams.get('cursor');
        return cursor === 'CUR2'
          ? { json: { items: [entry('e3', { reason: null })], nextCursor: null } }
          : { json: { items: [entry('e1'), entry('e2')], nextCursor: 'CUR2' } };
      },
    }, '/admin/audit/');
    await expect(page.getByTestId('audit-append-only')).toContainText('append-only');
    await expect(page.getByTestId('audit-row-e1')).toContainText('member.suspend');
    await expect(page.getByTestId('audit-row-e1')).toContainText('why e1');
    await expect(page.getByTestId('audit-row-e2')).toBeVisible();
    await expect(page.getByTestId('audit-end')).toHaveCount(0);
    await page.getByTestId('audit-more').click();
    await expect(page.getByTestId('audit-row-e3')).toContainText('No reason given');
    await expect(page.getByTestId('audit-row-e1')).toBeVisible();
    await expect(page.getByTestId('audit-more')).toHaveCount(0);
    await expect(page.getByTestId('audit-end')).toBeVisible();
    // (The dev server's double effect may repeat the first-page request; the cursor request happens once, after the click.)
    const gets = calls.filter(c => c.path === '/admin/audit-log');
    expect(gets[0].search).not.toContain('cursor');
    const paged = gets.filter(c => c.search.includes('cursor='));
    expect(paged).toHaveLength(1);
    expect(new URLSearchParams(paged[0].search).get('cursor')).toBe('CUR2');
    expect(calls.outside).toEqual([]);
  });

  test('filters are sent to the API and clearing returns to all entries', async ({ page }) => {
    const calls = await open(page, SUPER, { 'GET /admin/audit-log': { json: { items: [entry('e1')], nextCursor: null } } }, '/admin/audit/');
    await expect(page.getByTestId('audit-row-e1')).toBeVisible();
    await page.getByTestId('audit-f-actor').fill('adm_9');
    await page.getByTestId('audit-f-action').fill('settings.update');
    await page.getByTestId('audit-f-target').fill('platform');
    await page.getByTestId('audit-f-from').fill('2026-11-01T00:00');
    await page.getByTestId('audit-f-to').fill('2026-11-02T00:00');
    await page.getByTestId('audit-apply').click();
    const lists = () => calls.filter(c => c.path === '/admin/audit-log');
    await expect.poll(() => lists().some(c => c.search.includes('actor=adm_9'))).toBe(true);
    const q = new URLSearchParams(lists().find(c => c.search.includes('actor=adm_9'))!.search);
    expect(q.get('actor')).toBe('adm_9');
    expect(q.get('action')).toBe('settings.update');
    expect(q.get('target')).toBe('platform');
    expect(q.get('from')).toBe(new Date('2026-11-01T00:00').toISOString());
    expect(q.get('to')).toBe(new Date('2026-11-02T00:00').toISOString());
    expect(q.get('cursor')).toBeNull();
    const before = lists().length;
    await page.getByTestId('audit-clear').click();
    await expect.poll(() => lists().length).toBeGreaterThan(before);
    expect(new URLSearchParams(lists().at(-1)!.search).get('actor')).toBeNull();
    await expect(page.getByTestId('audit-f-actor')).toHaveValue('');
  });

  test('empty is an empty state; a failed load is an error with a retry; a bad filter is named', async ({ page }) => {
    let mode: 'empty' | 'down' | 'bad' | 'ok' = 'empty';
    await open(page, SUPER, {
      'GET /admin/audit-log': () => mode === 'empty' ? { json: { items: [], nextCursor: null } }
        : mode === 'down' ? { status: 500, json: { error: 'boom' } }
        : mode === 'bad' ? { status: 400, json: { error: 'invalid_filter', field: 'from' } }
        : { json: { items: [entry('e1')], nextCursor: null } },
    }, '/admin/audit/');
    await expect(page.getByTestId('audit-empty')).toContainText('No entries match');
    await expect(page.getByTestId('audit-error')).toHaveCount(0);
    mode = 'down';
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByTestId('audit-error')).toContainText("Couldn't load the audit log");
    await expect(page.getByTestId('audit-empty')).toHaveCount(0);
    mode = 'bad';
    await page.getByTestId('audit-error').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('audit-invalid')).toContainText("A filter isn't valid");
    mode = 'ok';
    await page.getByTestId('audit-clear').click();
    await expect(page.getByTestId('audit-row-e1')).toBeVisible();
  });

  test('a failed load-more keeps the rows and says so', async ({ page }) => {
    await open(page, SUPER, {
      'GET /admin/audit-log': req => new URL(req.url()).searchParams.get('cursor')
        ? { status: 500, json: { error: 'boom' } }
        : { json: { items: [entry('e1')], nextCursor: 'C' } },
    }, '/admin/audit/');
    await page.getByTestId('audit-more').click();
    await expect(page.getByTestId('audit-more-error')).toContainText("Couldn't load more");
    await expect(page.getByTestId('audit-row-e1')).toBeVisible();
    await expect(page.getByTestId('audit-more')).toBeVisible();
  });

  test('403 acl_forbidden shows a permission message, not an error or empty list', async ({ page }) => {
    await open(page, staff(['audit']), { 'GET /admin/audit-log': { status: 403, json: { error: 'acl_forbidden' } } }, '/admin/audit/');
    await expect(page.getByTestId('audit-forbidden')).toContainText("don't have permission");
    await expect(page.getByTestId('audit-error')).toHaveCount(0);
    await expect(page.getByTestId('audit-empty')).toHaveCount(0);
  });

  test('reason and before/after are shown as plain text, never as HTML', async ({ page }) => {
    const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
    await open(page, SUPER, {
      'GET /admin/audit-log': { json: { items: [entry('e1', { reason: evil, before: { note: evil }, after: { note: '<script>window.__pwned=2</script>' } })], nextCursor: null } },
    }, '/admin/audit/');
    const row = page.getByTestId('audit-row-e1');
    await expect(row.getByTestId('audit-reason')).toHaveText(evil);
    await expect(row.locator('img, b')).toHaveCount(0);
    await row.getByTestId('audit-details').click();
    const detail = page.getByTestId('audit-detail');
    await expect(detail.getByTestId('audit-before')).toContainText('<img src=x');
    await expect(detail.getByTestId('audit-after')).toContainText('<script>window.__pwned=2</script>');
    await expect(detail.locator('img, b, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('redacted payloads show what the server sent; Swahili labels render', async ({ page }) => {
    await open(page, SUPER, {
      'GET /admin/audit-log': { json: { items: [entry('e1', { before: null, after: { manualPayment: { lipaNamba: '***123' } } })], nextCursor: null } },
    }, '/admin/audit/', 'sw');
    await expect(page.getByTestId('audit-append-only')).toContainText('huongezwa tu');
    await page.getByTestId('audit-row-e1').getByTestId('audit-details').click();
    await expect(page.getByTestId('audit-after')).toContainText('***123');
    await expect(page.getByTestId('audit-before')).toHaveText('Hakuna kilichorekodiwa');
  });

  test('nav entry shows only with scope audit, and the route is guarded', async ({ page }) => {
    const calls = await open(page, staff(['members']), { 'GET /admin/members': { json: [] }, 'GET /admin/audit-log': { json: { items: [], nextCursor: null } } }, '/admin/audit/');
    // The shell renders, but not the page: no audit UI, no audit request, no nav link (the redirect itself is the shared guard, covered in admin-load-errors).
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.locator('a[href^="/admin/audit"]')).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('audit-log')).toHaveCount(0);
    expect(calls.filter(c => c.path === '/admin/audit-log')).toEqual([]);
  });

  test('nav entry shows for scope audit', async ({ page }) => {
    await open(page, staff(['audit']), { 'GET /admin/audit-log': { json: { items: [], nextCursor: null } } }, '/admin/audit/');
    await expect(page.locator('a[href^="/admin/audit"]').first()).toBeVisible();
    await expect(page.getByTestId('audit-empty')).toBeVisible();
  });
});

const MEMBER = { id: 'mem_1', displayName: 'Mwajuma', email: 'mwajuma@example.com', phone: null, accountStatus: 'active', memberProfile: {} };

test.describe('reasons', () => {
  test('suspending a member sends the reason in the body; reactivating needs no dialog', async ({ page }) => {
    const calls = await open(page, SUPER, {
      'GET /admin/members': { json: [MEMBER] },
      'POST /admin/members/mem_1/status': { json: { ...MEMBER, accountStatus: 'suspended' } },
    }, '/admin/members/');
    await page.locator('select').filter({ hasText: 'Suspended' }).first().selectOption('suspended');
    await expect(page.getByTestId('member-status-reason')).toBeVisible();
    await page.getByTestId('member-status-reason').fill('  Chargeback abuse  ');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Suspend' }).click();
    await expect.poll(() => calls.filter(c => c.path === '/admin/members/mem_1/status').length).toBe(1);
    expect(calls.find(c => c.path === '/admin/members/mem_1/status')!.body).toEqual({ status: 'suspended', reason: 'Chargeback abuse' });
  });

  test('reason_required keeps the dialog open with a readable message (EN and SW); no reason sends no reason key', async ({ page }) => {
    const calls = await open(page, SUPER, {
      'GET /admin/members': { json: [MEMBER] },
      'POST /admin/members/mem_1/status': req => (req.postDataJSON() as { reason?: string }).reason
        ? { json: { ...MEMBER, accountStatus: 'suspended' } }
        : { status: 400, json: { error: 'reason_required' } },
    }, '/admin/members/', 'sw');
    await page.locator('select').filter({ hasText: 'Suspended' }).first().selectOption('suspended');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Toa sababu ya hatua hii.');
    expect(calls.find(c => c.path === '/admin/members/mem_1/status')!.body).toEqual({ status: 'suspended' });
    await page.getByTestId('member-status-reason').fill('Sababu');
    await expect(page.getByRole('alertdialog')).not.toContainText('Toa sababu ya hatua hii.');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('deleting a gym owner sends the reason in the body only; reason_required is shown', async ({ page }) => {
    const OWNER = { id: 'own-a', userType: 'gym_operator', displayName: 'Asha Owner', email: 'asha@example.com', gymIds: [], accountStatus: 'active', approvalStatus: 'approved' };
    const calls = await open(page, SUPER, {
      'GET /admin/gym-owners': { json: [OWNER] }, 'GET /admin/gyms': { json: [] }, 'GET /admin/trainers': { json: [] },
      'DELETE /admin/gym-owners/own-a': req => (req.postDataJSON() as { reason?: string } | null)?.reason ? { json: { ok: true, owner: OWNER } } : { status: 400, json: { error: 'reason_required' } },
    }, '/admin/owners/');
    await page.locator('tr', { hasText: 'Asha Owner' }).locator('button').last().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Give a reason for this action.');
    await page.getByTestId('owner-delete-reason').fill('Left the business');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const dels = calls.filter(c => c.method === 'DELETE');
    expect(dels).toHaveLength(2);
    expect(dels[1].body).toEqual({ reason: 'Left the business' });
    expect(dels.every(c => !c.search.includes('reason'))).toBe(true);
  });

  const SETTINGS = {
    id: 'platform', subscriptionTiers: [{ key: 'basic', label: 'Basic', monthlyPrice: 30000, visits: 12, gymAccess: 'standard' }],
    payoutBands: [], paymentPeriodDays: 14, payoutModel: 'commission', currency: 'TZS', updatedAt: '2026-10-19T08:00:00Z',
  };

  test('settings: Save all sends the reason in the body; reason_required shows a message and saves nothing', async ({ page }) => {
    const calls = await open(page, SUPER, {
      'GET /admin/settings': { json: SETTINGS },
      'GET /admin/settings/specialties': { json: [] },
      'PUT /admin/settings': req => (req.postDataJSON() as { reason?: string }).reason ? { json: SETTINGS } : { status: 400, json: { error: 'reason_required' } },
    }, '/admin/settings/');
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('Give a reason for this action.')).toBeVisible();
    await page.getByTestId('settings-reason').fill('Price review');
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('Give a reason for this action.')).toHaveCount(0);
    const puts = calls.filter(c => c.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(puts[0].body).not.toHaveProperty('reason');
    expect(puts[1].body).toMatchObject({ reason: 'Price review', currency: 'TZS' });
  });

  test('settings: the manual payment card sends its own reason', async ({ page }) => {
    const calls = await open(page, SUPER, {
      'GET /admin/settings': { json: SETTINGS },
      'GET /admin/settings/specialties': { json: [] },
      'GET /payments/options': { json: { manual: { enabled: true } } },
      'PUT /admin/settings': req => ({ json: { ...SETTINGS, manualPayment: (req.postDataJSON() as { manualPayment: unknown }).manualPayment } }),
    }, '/admin/settings/');
    const card = page.getByTestId('manual-payment-settings');
    await card.locator('input').nth(0).fill('123456');
    await card.locator('input').nth(1).fill('FitFlex Ltd');
    await card.getByTestId('manual-pay-reason').fill('New till number');
    await card.getByRole('button', { name: /^Save/ }).click();
    await expect.poll(() => calls.filter(c => c.method === 'PUT').length).toBe(1);
    expect(calls.find(c => c.method === 'PUT')!.body).toMatchObject({ reason: 'New till number', manualPayment: { lipaNamba: '123456', accountName: 'FitFlex Ltd' } });
  });
});
