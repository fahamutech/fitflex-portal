import { expect, test, type Page, type Request } from '@playwright/test';

// Admin held payments worklist (audit M5), against a mocked API. Every request outside localhost is aborted and
// recorded; nothing may reach the live API.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.use({ serviceWorkers: 'block' });

type Reply = { status?: number; json?: unknown };
type Routes = Record<string, Reply | ((req: Request) => Reply)>;
type Call = { method: string; path: string; search: string; body: Record<string, unknown> | null };

const ME = { id: 'adm_1', userType: 'admin', email: 'one@fitflex.test' };
const AT = '2026-10-30T08:15:00.000Z';
const row = (tx: string, extra: Record<string, unknown> = {}) => ({
  paymentRequestId: `pr_${tx}`, transactionId: tx, amountTzs: 50000, memberId: `mem_${tx}`, reason: 'request_closed', at: AT, refundId: null,
  requestStatus: 'cancelled', productType: 'subscription', refundStatus: null, refundable: true, notRefundableReason: null, amountReceivedKnown: true, ...extra,
});
const ITEMS = [
  row('TX-OK'),
  row('TX-DUP', { reason: 'reference_already_used', refundable: false, notRefundableReason: 'reference_already_used' }),
  row('TX-SBX', { reason: 'sandbox_not_settled', refundable: false, notRefundableReason: 'sandbox_not_settled' }),
  row('TX-OPEN', { requestStatus: 'pending', refundable: false, notRefundableReason: 'request_not_closed' }),
  row('TX-DONE', { refundId: 'rf_1', refundStatus: 'requested', refundable: false, notRefundableReason: 'already_refunded' }),
  row('TX-UNK', { amountTzs: null, amountReceivedKnown: false }),
];

async function open(page: Page, routes: Routes, path = '/admin/payments-held/', locale: 'en' | 'sw' = 'en') {
  const calls: Call[] = [];
  const outside: string[] = [];
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'admin-tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [ME, locale] as const);
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
const posts = (calls: Call[]) => calls.filter(c => c.method === 'POST' && c.path.endsWith('/refund'));

test.describe('held payments worklist', () => {
  test('lists rows; refundable has a Refund action, the others say why not', async ({ page }) => {
    const calls = await open(page, { 'GET /admin/payments/held': { json: { items: ITEMS } } });
    await expect(page.getByTestId('held-table')).toBeVisible();
    await expect(page.getByTestId('held-row-TX-OK').getByTestId('held-refund')).toBeVisible();
    await expect(page.getByTestId('held-row-TX-DUP')).toContainText('already paid for another request');
    await expect(page.getByTestId('held-row-TX-SBX')).toContainText('test payment');
    await expect(page.getByTestId('held-row-TX-OPEN')).toContainText('still open');
    await expect(page.getByTestId('held-row-TX-DONE')).toContainText('already raised');
    for (const tx of ['TX-DUP', 'TX-SBX', 'TX-OPEN', 'TX-DONE']) await expect(page.getByTestId(`held-row-${tx}`).getByTestId('held-refund')).toHaveCount(0);
    await expect(page.getByTestId('held-row-TX-UNK')).toContainText('Not known');
    expect(calls.some(c => c.path === '/admin/payments/held' && c.search === '?status=open')).toBe(true);
    expect(calls.outside).toEqual([]);
  });

  test('Swahili texts', async ({ page }) => {
    await open(page, { 'GET /admin/payments/held': { json: { items: ITEMS } } }, '/admin/payments-held/', 'sw');
    await expect(page.getByTestId('held-row-TX-SBX')).toContainText('malipo ya majaribio');
    await expect(page.getByTestId('held-row-TX-OK').getByTestId('held-refund')).toHaveText('Rejesha');
  });

  test('refund needs a reason, then sends reasonCode and the transaction id, and reloads', async ({ page }) => {
    let raised = false;
    const calls = await open(page, {
      'GET /admin/payments/held': () => ({ json: { items: raised ? [] : [ITEMS[0]] } }),
      'POST /admin/payments/held/pr_TX-OK/refund': () => { raised = true; return { status: 201, json: { refund: { id: 'rf_9', status: 'approved' } } }; },
    });
    await page.getByTestId('held-refund').click();
    await expect(page.getByRole('dialog')).toContainText('approved immediately');
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-error')).toContainText('Choose a reason');
    expect(posts(calls)).toHaveLength(0);
    await page.getByTestId('held-reason').selectOption('payment_error');
    await page.getByTestId('held-note').fill('Member charged after cancel');
    await page.getByTestId('held-submit').click();
    await expect(page.getByText('No held payments.')).toBeVisible();
    await expect(page.getByText('Refund raised. Status: To pay.')).toBeVisible();
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0].body).toEqual({ transactionId: 'TX-OK', reasonCode: 'payment_error', note: 'Member charged after cancel' });
  });

  test('amount unknown: the amount is asked for and sent; a server amount_unknown is explained', async ({ page }) => {
    let n = 0;
    const calls = await open(page, {
      'GET /admin/payments/held': { json: { items: [ITEMS[5]] } },
      'POST /admin/payments/held/pr_TX-UNK/refund': () => (++n === 1 ? { status: 409, json: { error: 'amount_unknown' } } : { status: 201, json: { refund: { id: 'rf_2' } } }),
    });
    await page.getByTestId('held-refund').click();
    await page.getByTestId('held-reason').selectOption('charged_twice');
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-error')).toContainText('Enter the amount');
    expect(posts(calls)).toHaveLength(0);
    await page.getByTestId('held-amount').fill('30000');
    await expect(page.getByTestId('held-submit')).toContainText('30,000');
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-error')).toContainText("amount received isn't on record");
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-dialog')).toHaveCount(0);
    expect(posts(calls).at(-1)?.body).toEqual({ transactionId: 'TX-UNK', reasonCode: 'charged_twice', amountTzs: 30000 });
  });

  test('maximum refundable is shown when known; a partial amount above it is blocked inline', async ({ page }) => {
    const calls = await open(page, { 'GET /admin/payments/held': { json: { items: [row('TX-UNK', { amountTzs: null, amountReceivedKnown: false, requestAmountTzs: 40000 })] } } });
    await page.getByTestId('held-refund').click();
    await expect(page.getByTestId('held-max')).toContainText('Maximum refundable: TSh 40,000');
    await page.getByTestId('held-reason').selectOption('payment_error');
    await page.getByTestId('held-amount').fill('45000');
    await expect(page.getByTestId('held-dialog')).toContainText('more than the maximum refundable');
    await expect(page.getByTestId('held-submit')).toBeDisabled();
    await expect(page.getByTestId('held-submit')).toContainText('45,000');
    expect(posts(calls)).toHaveLength(0);
    await page.getByTestId('held-amount').fill('40000');
    await expect(page.getByTestId('held-submit')).toBeEnabled();
    await page.getByTestId('held-submit').click();
    await expect.poll(() => posts(calls).length).toBe(1);
    expect(posts(calls)[0].body).toEqual({ transactionId: 'TX-UNK', reasonCode: 'payment_error', amountTzs: 40000 });
  });

  test('maximum refundable in Swahili', async ({ page }) => {
    await open(page, { 'GET /admin/payments/held': { json: { items: [row('TX-OK', { requestAmountTzs: 50000 })] } } }, '/admin/payments-held/', 'sw');
    await page.getByTestId('held-refund').click();
    await expect(page.getByTestId('held-max')).toContainText('Kiwango cha juu cha kurejeshwa');
  });

  test('maximum unknown (null or missing): no maximum line, any amount is sent as before', async ({ page }) => {
    for (const extra of [{ requestAmountTzs: null }, {}]) {
      const calls = await open(page, {
        'GET /admin/payments/held': { json: { items: [row('TX-UNK', { amountTzs: null, amountReceivedKnown: false, ...extra })] } },
        'POST /admin/payments/held/pr_TX-UNK/refund': { status: 201, json: { refund: { id: 'rf_3' } } },
      });
      await page.getByTestId('held-refund').click();
      await expect(page.getByTestId('held-max')).toHaveCount(0);
      await page.getByTestId('held-reason').selectOption('payment_error');
      await page.getByTestId('held-amount').fill('999999');
      await expect(page.getByTestId('held-submit')).toBeEnabled();
      await page.getByTestId('held-submit').click();
      await expect.poll(() => posts(calls).length).toBe(1);
      expect(posts(calls)[0].body).toEqual({ transactionId: 'TX-UNK', reasonCode: 'payment_error', amountTzs: 999999 });
    }
  });

  test('refund-scope and stale refusals are readable', async ({ page }) => {
    let code = 'cannot_approve_own_request';
    await open(page, {
      'GET /admin/payments/held': { json: { items: [ITEMS[0]] } },
      'POST /admin/payments/held/pr_TX-OK/refund': () => ({ status: code === 'forbidden' || code === 'acl_forbidden' ? 403 : 409, json: { error: code } }),
    });
    await page.getByTestId('held-refund').click();
    await page.getByTestId('held-reason').selectOption('payment_error');
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-error')).toContainText('A different admin must approve it');
    code = 'not_refundable';
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-error')).toContainText("can't be refunded");
    code = 'forbidden';
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-error')).toContainText("don't have permission");
    code = 'acl_forbidden';
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-error')).toContainText("don't have permission");
  });

  test('flag off: a neutral "not switched on" state, no table, no error', async ({ page }) => {
    const calls = await open(page, { 'GET /admin/payments/held': { status: 404, json: { error: 'feature_disabled' } } });
    await expect(page.getByTestId('held-off')).toContainText("isn't switched on yet");
    await expect(page.getByTestId('held-table')).toHaveCount(0);
    await expect(page.getByText("Couldn't load the held payments.")).toHaveCount(0);
    expect(calls.outside).toEqual([]);
  });

  test('a failed load is an error with a retry, not an empty list; retry works', async ({ page }) => {
    let down = true;
    await open(page, { 'GET /admin/payments/held': () => (down ? { status: 500, json: { error: 'boom' } } : { json: { items: [] } }) });
    await expect(page.getByText("Couldn't load the held payments.")).toBeVisible();
    await expect(page.getByText('No held payments.')).toHaveCount(0);
    down = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('No held payments.')).toBeVisible();
  });

  test('a row with no provider transaction shows the transaction_id_required message', async ({ page }) => {
    const calls = await open(page, { 'GET /admin/payments/held': { json: { items: [row('x', { transactionId: null })] } } });
    await page.getByTestId('held-refund').click();
    await page.getByTestId('held-reason').selectOption('payment_error');
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-error')).toContainText('no provider transaction');
    expect(posts(calls)).toHaveLength(0);
  });

  test('stale row: the dialog closes with the reason, no skeleton while open; if still refundable it stays open', async ({ page }) => {
    let posted = false;
    await open(page, {
      'GET /admin/payments/held': () => { return { json: { items: posted ? [row('TX-OK', { refundable: false, notRefundableReason: 'already_refunded', refundId: 'rf_1', refundStatus: 'requested' })] : [ITEMS[0]] } }; },
      'POST /admin/payments/held/pr_TX-OK/refund': () => { posted = true; return { status: 409, json: { error: 'refund_already_requested' } }; },
    });
    await page.getByTestId('held-refund').click();
    await page.getByTestId('held-reason').selectOption('payment_error');
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-dialog')).toHaveCount(0);
    await expect(page.getByText('A refund was already raised for this payment. The list was refreshed.')).toBeVisible();
    await expect(page.getByTestId('held-row-TX-OK')).toContainText('already raised');
  });

  test('stale code but the row is still refundable after reload: dialog stays with the message, table not replaced by a skeleton', async ({ page }) => {
    await open(page, {
      'GET /admin/payments/held': { json: { items: [ITEMS[0]] } },
      'POST /admin/payments/held/pr_TX-OK/refund': { status: 409, json: { error: 'not_held' } },
    });
    await page.getByTestId('held-refund').click();
    await page.getByTestId('held-reason').selectOption('payment_error');
    await page.getByTestId('held-submit').click();
    await expect(page.getByTestId('held-error')).toContainText('no longer held');
    await expect(page.getByTestId('held-dialog')).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });
});
