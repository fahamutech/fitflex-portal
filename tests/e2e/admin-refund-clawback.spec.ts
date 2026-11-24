import { expect, test, type Page } from '@playwright/test';

// Phase 1 slice P-D: the gym clawback of a paid pass refund (functions#343). The result after "mark paid", a dialog that
// shows the adjustments and retries, and an end-access choice that no longer overrides the server's default.
// Mocked API; nothing outside localhost is reached.
const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.use({ serviceWorkers: 'block' });

type Reply = { status?: number; json?: unknown };
type Routes = Record<string, Reply>;
type Call = { key: string; body: Record<string, unknown> | null };
const SUPER = { id: 'adm_1', userType: 'admin', email: 'one@fitflex.test' };

async function open(page: Page, routes: Routes, locale: 'en' | 'sw' = 'en'): Promise<Call[]> {
  const calls: Call[] = [];
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'admin-tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [SUPER, locale] as const);
  await page.context().route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => route.abort());
  await page.context().route(`${API}/**`, async route => {
    const key = `${route.request().method()} ${new URL(route.request().url()).pathname}`;
    const raw = route.request().postData();
    calls.push({ key, body: raw ? JSON.parse(raw) : null });
    const hit = routes[key];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ status: hit.status ?? 200, json: hit.json ?? null });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin/refunds/');
  return calls;
}

const refund = (id: string, status: string, kind = 'subscription') => ({
  id, memberId: 'm1', kind, subscriptionId: 's1', bookingId: null, orderId: null, paymentRequestId: 'p1',
  amountTzs: 30000, currency: 'TZS', reasonCode: 'member_cancelled', note: null, decisionNote: null, status,
  requestedBy: 'adm_9', requestedRole: 'admin', decidedBy: null, decidedAt: null, paidAt: null, paymentReference: null, paidTo: null,
  createdAt: '2026-11-01T08:00:00.000Z', member: { id: 'm1', displayName: 'Asha Member', phone: '+255700000001', email: null },
});
const adjustment = (id: string, status: string, extra = {}) => ({
  id, gymSettlementId: 'gs-2', sourceSettlementId: 'gs-1', gymId: `gym-${id}`, amountTzs: -12000, status,
  reason: 'Pass refund r-1 paid after settlement', createdBy: 'adm_9', createdAt: '2026-11-05T09:00:00.000Z', ...extra,
});
const filterPaid = async (page: Page) => page.getByTestId('refund-filter-paid').click();

test.describe('clawback dialog', () => {
  const base = { 'GET /admin/refunds': { json: { refunds: [refund('r-1', 'paid'), refund('r-2', 'paid', 'shop_order'), refund('r-3', 'approved')] } } };

  test('only a paid pass refund has the Clawback button', async ({ page }) => {
    await open(page, base);
    await filterPaid(page);
    await expect(page.getByTestId('refund-clawback-open')).toHaveCount(1);
    await page.getByTestId('refund-filter-approved').click();
    await expect(page.getByTestId('refund-clawback-open')).toHaveCount(0);
  });

  test('shows the adjustments with their status and the held source', async ({ page }) => {
    await open(page, { ...base, 'GET /admin/refunds/r-1/clawback': { json: { refundId: 'r-1', enabled: true, adjustments: [adjustment('a1', 'proposed', { heldSource: true }), adjustment('a2', 'applied')] } } });
    await filterPaid(page);
    await page.getByTestId('refund-clawback-open').click();
    await expect(page.getByTestId('refund-clawback-row-a1')).toContainText('Proposed');
    await expect(page.getByTestId('refund-clawback-row-a1')).toContainText('Source statement on hold');
    await expect(page.getByTestId('refund-clawback-row-a2')).toContainText('Applied');
    await expect(page.getByTestId('refund-clawback-row-a1')).toContainText('12,000');
  });

  test('says nothing was raised yet when there are no adjustments', async ({ page }) => {
    await open(page, { ...base, 'GET /admin/refunds/r-1/clawback': { json: { refundId: 'r-1', enabled: true, adjustments: [] } } });
    await filterPaid(page);
    await page.getByTestId('refund-clawback-open').click();
    await expect(page.getByTestId('refund-clawback-empty')).toBeVisible();
  });

  test('switched off on the server: says so and offers no retry', async ({ page }) => {
    await open(page, { ...base, 'GET /admin/refunds/r-1/clawback': { json: { refundId: 'r-1', enabled: false, adjustments: [] } } });
    await filterPaid(page);
    await page.getByTestId('refund-clawback-open').click();
    await expect(page.getByTestId('refund-clawback-dialog')).toContainText('not switched on');
    await expect(page.getByTestId('refund-clawback-retry')).toHaveCount(0);
  });

  test('retry raises it, tells the result and reloads the rows', async ({ page }) => {
    let rows = [] as unknown[];
    let retries = 0;
    await open(page, base);
    await page.context().route(`${API}/admin/refunds/r-1/clawback`, async route => {
      if (route.request().method() === 'POST') { retries += 1; rows = [adjustment('a9', 'proposed')]; return route.fulfill({ json: { refundId: 'r-1', status: 'raised', raised: [{}], existing: [], pending: [], skipped: [], held: [] } }); }
      return route.fulfill({ json: { refundId: 'r-1', enabled: true, adjustments: rows } });
    });
    await filterPaid(page);
    await page.getByTestId('refund-clawback-open').click();
    await expect(page.getByTestId('refund-clawback-empty')).toBeVisible();
    await page.getByTestId('refund-clawback-retry').click();
    await expect(page.getByTestId('refund-clawback-dialog')).toContainText('A clawback was proposed');
    await expect(page.getByTestId('refund-clawback-row-a9')).toBeVisible();
    expect(retries).toBe(1);
  });

  for (const [name, reply, text] of [
    ['switched off', { status: 404, json: { error: 'feature_disabled' } }, 'not switched on for this server'],
    ['not paid', { status: 409, json: { error: 'refund_not_paid' } }, 'Record the refund as paid first'],
    ['no permission', { status: 403, json: { error: 'acl_forbidden', requiredScope: 'settlements_prepare' } }, 'settlements permission'],
    ['server error', { status: 500, json: { error: 'boom' } }, 'This did not work'],
  ] as const) {
    test(`retry refused: ${name}`, async ({ page }) => {
      await open(page, { ...base, 'GET /admin/refunds/r-1/clawback': { json: { refundId: 'r-1', enabled: true, adjustments: [] } }, 'POST /admin/refunds/r-1/clawback': reply });
      await filterPaid(page);
      await page.getByTestId('refund-clawback-open').click();
      await page.getByTestId('refund-clawback-retry').click();
      await expect(page.getByTestId('refund-clawback-dialog')).toContainText(text);
    });
  }

  test('a viewer without a settlements scope sees the permission message, not an empty list', async ({ page }) => {
    await open(page, { ...base, 'GET /admin/refunds/r-1/clawback': { status: 403, json: { error: 'acl_forbidden', requiredScope: 'settlements_prepare' } } });
    await filterPaid(page);
    await page.getByTestId('refund-clawback-open').click();
    await expect(page.getByTestId('refund-clawback-dialog')).toContainText('settlements permission');
    await expect(page.getByTestId('refund-clawback-empty')).toHaveCount(0);
  });
});

test.describe('after mark paid', () => {
  const approved = { 'GET /admin/refunds': { json: { refunds: [refund('r-3', 'approved')] } } };
  async function markPaid(page: Page) {
    await page.getByTestId('refund-paid').click();
    await page.getByRole('dialog').getByRole('textbox').first().fill('REF-1');
    await page.getByTestId('refund-submit').click();
  }

  for (const [status, tone, text] of [
    ['raised', true, 'A clawback was proposed'],
    ['pending', true, 'no draft statement yet'],
    ['failed', true, 'refund is recorded'],
    ['unsettled', false, ''],
    ['already_raised', false, ''],
    ['nothing_to_claw_back', false, ''],
    ['not_applicable', false, ''],
  ] as const) {
    test(`clawback ${status} ${tone ? 'is announced' : 'stays quiet'}`, async ({ page }) => {
      await open(page, { ...approved, 'POST /admin/refunds/r-3/paid': { json: { refund: refund('r-3', 'paid'), clawback: { status, raised: [], existing: [], pending: [], skipped: [], held: [] } } } });
      await markPaid(page);
      if (tone) await expect(page.getByTestId('refund-clawback-alert')).toContainText(text);
      else { await expect(page.getByTestId('refund-submit')).toHaveCount(0); await expect(page.getByTestId('refund-clawback-alert')).toHaveCount(0); }
    });
  }

  test('flag off: the answer has no clawback and nothing changes', async ({ page }) => {
    await open(page, { ...approved, 'POST /admin/refunds/r-3/paid': { json: { refund: refund('r-3', 'paid') } } });
    await markPaid(page);
    await expect(page.getByTestId('refund-submit')).toHaveCount(0);
    await expect(page.getByTestId('refund-clawback-alert')).toHaveCount(0);
  });

  test('a held source statement is mentioned', async ({ page }) => {
    await open(page, { ...approved, 'POST /admin/refunds/r-3/paid': { json: { refund: refund('r-3', 'paid'), clawback: { status: 'raised', raised: [{}], held: [{}] } } } });
    await markPaid(page);
    await expect(page.getByTestId('refund-clawback-alert')).toContainText('put on hold');
  });
});

test.describe('end-access choice', () => {
  const requested = { 'GET /admin/refunds': { json: { refunds: [refund('r-4', 'requested')] } }, 'POST /admin/refunds/r-4/decision': { json: { refund: refund('r-4', 'approved') } } };
  for (const [choice, expected] of [['default', 'absent'], ['end', true], ['keep', false]] as const) {
    test(`approve sends ${expected === 'absent' ? 'no endAccess' : `endAccess ${expected}`} for "${choice}"`, async ({ page }) => {
      const calls = await open(page, requested);
      await page.getByTestId('refund-filter-requested').click();
      await page.getByTestId('refund-approve').click();
      await expect(page.getByTestId('refund-end-access')).toHaveValue('default');
      if (choice !== 'default') await page.getByTestId('refund-end-access').selectOption(choice);
      await page.getByTestId('refund-submit').click();
      await expect.poll(() => calls.some(c => c.key === 'POST /admin/refunds/r-4/decision')).toBe(true);
      const body = calls.find(c => c.key === 'POST /admin/refunds/r-4/decision')!.body!;
      if (expected === 'absent') expect('endAccess' in body).toBe(false); else expect(body.endAccess).toBe(expected);
      expect(body.decision).toBe('approve');
    });
  }

  test('a shop refund has no end-access choice', async ({ page }) => {
    await open(page, { 'GET /admin/refunds': { json: { refunds: [refund('r-5', 'requested', 'shop_order')] } } });
    await page.getByTestId('refund-filter-requested').click();
    await page.getByTestId('refund-approve').click();
    await expect(page.getByTestId('refund-end-access')).toHaveCount(0);
  });
});

test('Swahili: the new strings are present as marked placeholders', async ({ page }) => {
  await open(page, { 'GET /admin/refunds': { json: { refunds: [refund('r-1', 'paid')] } } }, 'sw');
  await filterPaid(page);
  await expect(page.getByTestId('refund-clawback-open')).toContainText('[SW-REVIEW]');
});
