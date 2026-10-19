// Phase A polish round 2 (UAT + design-QA re-check on RC a34bb4c): refunds, payments, settings, scan.
// Every API call is mocked.
import { expect, Page, Route, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.describe.configure({ timeout: 90_000 });

type Json = Record<string, unknown>;
type Call = { method: string; path: string; body: Json | null };
/** Returns a response, 'abort' for a network failure (fetch rejects: "Failed to fetch"), or null for the default. */
type Handler = (call: Call) => { status?: number; json: unknown } | 'abort' | null;

async function signIn(page: Page, user: Json, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'polish2-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('locale', l as string);
  }, [user, locale] as const);
}
const signInAdmin = (page: Page, id = 'admin-1', locale: 'en' | 'sw' = 'en') =>
  signIn(page, { id, userType: 'admin', email: `${id}@example.com` }, locale);

async function mockApi(page: Page, handler: Handler) {
  const calls: Call[] = [];
  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const url = new URL(req.url());
    const call: Call = { method: req.method(), path: url.pathname, body: req.postData() ? JSON.parse(req.postData()!) : null };
    if (call.method !== 'GET') calls.push(call);
    const out = handler(call);
    if (out === 'abort') return route.abort('internetdisconnected');
    if (out) return route.fulfill({ status: out.status ?? 200, json: out.json });
    if (call.path === '/me/personas' || call.path === '/me/invitations') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ json: call.method === 'GET' ? [] : {} });
  });
  return calls;
}

// ── Refunds ──────────────────────────────────────────────────────────────────────────────────────

const refund = {
  memberId: 'member-1', subscriptionId: 'sub-1', bookingId: null, orderId: null, paymentRequestId: 'pay-1',
  amountTzs: 30000, currency: 'TZS', note: null, decisionNote: null, requestedBy: 'member-1', requestedRole: 'member',
  decidedBy: null, decidedAt: null, paidAt: null, paymentReference: null, paidTo: null, createdAt: '2026-10-19T08:00:00.000Z',
  member: { id: 'member-1', displayName: 'Asha Member', phone: '+255700000001', email: null },
};
const REFUNDS = [
  { ...refund, id: 'r-1', kind: 'subscription', status: 'approved', reasonCode: 'charged_twice', decidedBy: 'admin-9', decidedAt: '2026-10-19T09:00:00.000Z' },
  { ...refund, id: 'r-2', kind: 'trainer_booking', status: 'requested', reasonCode: 'trainer_cancelled' },
  { ...refund, id: 'r-3', kind: 'shop_order', status: 'paid', reasonCode: 'vendor_cancelled', paymentReference: 'MPESA1', paidTo: '+255700000001', paidAt: '2026-10-19T10:00:00.000Z' },
  { ...refund, id: 'r-4', kind: 'subscription', status: 'rejected', reasonCode: 'other', decisionNote: 'Used the pass' },
];
const refundsMock: Handler = ({ method, path }) => (method === 'GET' && path === '/admin/refunds' ? { json: { refunds: REFUNDS } } : null);

test.describe('Refunds: translated (1)', () => {
  test('Swahili: filters, headers, kinds, reasons, status badges incl. paid, and Mark paid', async ({ page }) => {
    await signInAdmin(page, 'admin-1', 'sw');
    await mockApi(page, refundsMock);
    await page.goto('/admin/refunds');
    await expect(page.getByRole('heading', { name: 'Marejesho' })).toBeVisible();
    await expect(page.getByText('1 ya kulipa (TSh 30,000), 1 yanasubiri uamuzi.')).toBeVisible();
    const filters = page.getByRole('group', { name: 'Chuja marejesho' });
    await expect(filters.getByRole('button')).toHaveText(['Ya kulipa', 'Ya kuamua', 'Yamelipwa', 'Yamekataliwa', 'Yote']);
    await expect(page.getByRole('button', { name: 'Weka yamelipwa' })).toBeVisible();
    await page.getByTestId('refund-filter-all').click();
    for (const h of ['Kwa ajili ya', 'Aina', 'Kiasi', 'Yameombwa', 'Hali', 'Namba ya muamala']) {
      await expect(page.getByRole('columnheader').filter({ hasText: new RegExp(`^${h}$`) })).toBeVisible();
    }
    for (const sw of ['Pasi au mpango', 'Kipindi cha trainer', 'Oda ya duka', 'Alitozwa mara mbili', 'Imeghairiwa na muuzaji', 'kwa +255700000001']) {
      await expect(page.getByText(sw, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByTestId('refund-status')).toHaveText(['Ya kulipa', 'Ya kuamua', 'Yamelipwa', 'Yamekataliwa']);
    const main = page.getByRole('main');
    for (const en of ['To pay', 'To decide', 'Paid', 'Rejected', 'Mark paid', 'Pass or plan', 'Trainer session', 'Shop order', 'Charged twice', 'For', 'What', 'Raised', 'Refunds']) {
      await expect(main.getByText(en, { exact: true })).toHaveCount(0);
    }
    // The dialog too.
    await page.getByTestId('refund-filter-approved').click();
    await page.getByTestId('refund-paid').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toHaveText('Rekodi malipo ya marejesho');
    await expect(dialog.getByText('Namba ya muamala', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Weka kuwa yamelipwa' })).toBeVisible();
  });

  test('English labels stay as before', async ({ page }) => {
    await signInAdmin(page);
    await mockApi(page, refundsMock);
    await page.goto('/admin/refunds');
    await expect(page.getByRole('group', { name: 'Filter refunds' }).getByRole('button')).toHaveText(['To pay', 'To decide', 'Paid', 'Rejected', 'All']);
    await page.getByTestId('refund-filter-all').click();
    await expect(page.getByTestId('refund-status')).toHaveText(['To pay', 'To decide', 'Paid', 'Rejected']);
    await expect(page.getByText('Pass or plan').first()).toBeVisible();
  });
});

test.describe('Refunds: offline (2)', () => {
  test('one error with a retry: no "Failed to fetch", no "0 to pay", no empty-table text', async ({ page }) => {
    await signInAdmin(page);
    let offline = true;
    await mockApi(page, (call) => (call.method === 'GET' && call.path === '/admin/refunds' ? (offline ? 'abort' : refundsMock(call)) : null));
    await page.goto('/admin/refunds');
    const err = page.getByTestId('refunds-load-error');
    await expect(err).toContainText('Refunds could not be loaded');
    await expect(err).toContainText('Check the internet connection, then try again.');
    await expect(page.getByText('Failed to fetch')).toHaveCount(0);
    await expect(page.getByText(/to pay \(/)).toHaveCount(0);
    await expect(page.getByText('No refunds waiting to be paid.')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(1);
    offline = false;
    await err.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('1 to pay (TSh 30,000), 1 waiting for a decision.')).toBeVisible();
    await expect(err).toHaveCount(0);
  });

  test('Swahili error', async ({ page }) => {
    await signInAdmin(page, 'admin-1', 'sw');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/refunds' ? 'abort' : null));
    await page.goto('/admin/refunds');
    await expect(page.getByTestId('refunds-load-error')).toContainText('Marejesho hayakuweza kupakiwa');
    await expect(page.getByTestId('refunds-load-error').getByRole('button', { name: 'Jaribu tena' })).toBeVisible();
  });
});

test.describe('Disabled Approve is named "Approve"; the reason is its description (3)', () => {
  test('refunds', async ({ page }) => {
    await signInAdmin(page, 'admin-1');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/refunds' ? { json: { refunds: [
      { ...refund, id: 'r-own', kind: 'subscription', status: 'requested', reasonCode: 'payment_error', requestedBy: 'admin-1', requestedRole: 'admin',
        secondApproverRequired: true, approvalStage: 'awaiting_approval', approveNotBy: 'admin-1' },
    ] } } : null));
    await page.goto('/admin/refunds');
    await page.getByTestId('refund-filter-requested').click();
    const approve = page.getByTestId('refund-approve');
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleName('Approve');
    await expect(approve).toHaveAccessibleDescription('You raised this refund. A different admin must approve it.');
  });

  test('payments (same pattern)', async ({ page }) => {
    await signInAdmin(page, 'admin-1');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: [
      { ...pay, id: 'pay-own', status: 'pending', secondApproverRequired: true, verifiedBy: 'admin-1', verifiedAt: '2026-10-19T09:00:00.000Z',
        approvalStage: 'awaiting_second_approval', approveNotBy: 'admin-1' },
    ] } : null));
    await page.goto('/admin/payments');
    const approve = page.getByTestId('payment-approve');
    await expect(approve).toHaveAccessibleName('Approve');
    await expect(approve).toHaveAccessibleDescription('A different admin must approve it.');
  });
});

// ── Payments ─────────────────────────────────────────────────────────────────────────────────────

const pay = {
  memberId: 'member-1', subscriptionId: 'sub-1', tier: 'basic', amountTzs: 30000, provider: 'admin_approved', note: null, reference: 'R1',
  requestedAt: '2026-10-19T08:00:00.000Z', decidedAt: null, member: { displayName: 'Asha Member' },
  subscription: { type: 'platform_pass', tier: 'basic', status: 'pending' },
};
const twoAdminApproved = {
  ...pay, status: 'approved', decidedAt: '2026-10-19T10:00:00.000Z', secondApproverRequired: true, approveNotBy: null, confirmChangeNotBy: null,
  verifiedBy: 'admin-3', verifiedByName: 'Neema Admin', verifiedAt: '2026-10-19T09:00:00.000Z', approvalStage: null,
};

test.describe('Payments: who approved (4) and names as written (7)', () => {
  test('approved rows say who approved, like "Verified by"; emails are never capitalised', async ({ page }) => {
    await signInAdmin(page, 'admin-1');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: [
      { ...twoAdminApproved, id: 'pay-a', decidedBy: 'admin-2', decidedByName: 'dqa-admin@example.com', member: { displayName: 'Approved By Other' } },
      { ...twoAdminApproved, id: 'pay-b', decidedBy: 'admin-1', decidedByName: 'Me Admin', member: { displayName: 'Approved By Me' } },
      { ...twoAdminApproved, id: 'pay-c', decidedBy: 'admin-4', decidedByName: null, member: { displayName: 'Approved By Unknown' },
        requestedAt: '2026-10-18T08:00:00.000Z',
        changeRequestedStatus: 'rejected', changeRequestedBy: 'admin-5', changeRequestedByName: 'dqa-admin2@example.com',
        changeRequestedAt: '2026-10-19T11:00:00.000Z', changeRequestReason: 'Wrong member', approvalStage: 'change_requested' },
    ] } : null));
    await page.goto('/admin/payments');
    await page.getByRole('button', { name: 'Approved', exact: true }).click();
    const rows = page.locator('tbody tr');
    const other = rows.filter({ hasText: 'Approved By Other' });
    await expect(other.getByTestId('payment-approved-by')).toHaveText('Approved by dqa-admin@example.com · 19 Oct 2026, 13:00');
    await expect(other.getByTestId('payment-verified-by')).toContainText('Verified by Neema Admin');
    // Same style as the verified line.
    const cls = await other.getByTestId('payment-verified-by').getAttribute('class');
    await expect(other.getByTestId('payment-approved-by')).toHaveAttribute('class', cls!);
    await expect(rows.filter({ hasText: 'Approved By Me' }).getByTestId('payment-approved-by')).toContainText('Approved by you');
    // A pending change request is the one audit line that matters there.
    const changed = rows.filter({ hasText: 'Approved By Unknown' });
    await expect(changed.getByTestId('payment-change-requested-by')).toContainText('dqa-admin2@example.com asked to change this to Rejected');
    await expect(page.getByText(/Dqa-admin/)).toHaveCount(0);
    await expect(page.getByText('admin-2', { exact: true })).toHaveCount(0);
  });

  test('Swahili', async ({ page }) => {
    await signInAdmin(page, 'admin-1', 'sw');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: [
      { ...twoAdminApproved, id: 'pay-a', decidedBy: 'admin-2', decidedByName: 'dqa-admin@example.com' },
    ] } : null));
    await page.goto('/admin/payments');
    await page.getByRole('button', { name: 'Imeidhinishwa', exact: true }).click();
    await expect(page.getByTestId('payment-approved-by')).toContainText('Imeidhinishwa na dqa-admin@example.com');
  });
});

const ROWS_LONG = [
  { ...twoAdminApproved, id: 'pay-a', decidedBy: 'admin-2', decidedByName: 'Neema Admin', member: { displayName: 'Asha Mwanachama Mrefu' } },
  { ...pay, id: 'pay-p', status: 'pending', reference: null, secondApproverRequired: true, approvalStage: 'awaiting_verification', member: { displayName: 'Juma Mwanachama' } },
];

test.describe('Payments: toolbar and actions at narrow widths (5, 6)', () => {
  for (const width of [768, 1024]) {
    test(`Swahili at ${width}px: the search keeps at least 200px and the filters wrap below it`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAdmin(page, 'admin-1', 'sw');
      await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: ROWS_LONG } : null));
      await page.goto('/admin/payments');
      const search = page.getByRole('textbox', { name: /Tafuta/ });
      await expect(search).toBeVisible();
      const s = (await search.boundingBox())!;
      expect(s.width).toBeGreaterThanOrEqual(200);
      const chips = (await page.getByRole('group', { name: 'Chuja malipo' }).boundingBox())!;
      // Either beside the search with room, or on the next row; never squeezing it.
      expect(chips.y >= s.y + s.height || chips.x >= s.x + s.width).toBe(true);
    });
  }

  for (const width of [390, 768, 1024]) {
    test(`at ${width}px the actions are not pinned; name and status stay readable; actions on one line`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAdmin(page, 'admin-1', 'sw');
      await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: ROWS_LONG } : null));
      await page.goto('/admin/payments');
      await page.getByRole('button', { name: 'Yote', exact: true }).click();
      const row = page.locator('tbody tr').filter({ hasText: 'Asha Mwanachama Mrefu' });
      const actions = row.locator('td').last();
      await expect(actions).toHaveCSS('position', 'static');
      // The member cell is not covered by a pinned column.
      const member = (await row.locator('td').first().boundingBox())!;
      expect(member.width).toBeGreaterThanOrEqual(120);
      await expect(row.getByText('Asha Mwanachama Mrefu')).toBeInViewport();
      // "Omba kubadilisha hali" is one line, not a wrapped bold block.
      const change = row.getByTestId('payment-request-change');
      expect((await change.boundingBox())!.height).toBeLessThanOrEqual(44);
      expect(await change.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    });
  }

  test('at 1280px the actions stay pinned', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAdmin(page);
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: ROWS_LONG } : null));
    await page.goto('/admin/payments');
    await expect(page.locator('tbody tr').first().locator('td').last()).toHaveCSS('position', 'sticky');
  });
});

test.describe('Payments: sorting back to Member · date (8)', () => {
  test('after sorting another column, Member · date starts newest first again', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAdmin(page);
    const rows = [
      { ...pay, id: 'p-mid', status: 'pending', reference: null, amountTzs: 10000, requestedAt: '2026-10-18T08:00:00.000Z', member: { displayName: 'Middle Member' } },
      { ...pay, id: 'p-old', status: 'pending', reference: null, amountTzs: 30000, requestedAt: '2026-10-01T08:00:00.000Z', member: { displayName: 'Oldest Member' } },
      { ...pay, id: 'p-new', status: 'pending', reference: null, amountTzs: 20000, requestedAt: '2026-10-19T08:00:00.000Z', member: { displayName: 'Newest Member' } },
    ];
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: rows } : null));
    await page.goto('/admin/payments');
    const names = page.locator('tbody tr td:first-child .font-medium');
    const dateHeader = page.getByRole('columnheader', { name: /Member · date/ });
    await page.getByRole('columnheader', { name: /Amount/ }).getByRole('button').click();
    await expect(names).toHaveText(['Middle Member', 'Newest Member', 'Oldest Member']);
    await dateHeader.getByRole('button').click();
    await expect(dateHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(names).toHaveText(['Newest Member', 'Middle Member', 'Oldest Member']);
    await dateHeader.getByRole('button').click();
    await expect(dateHeader).toHaveAttribute('aria-sort', 'ascending');
  });
});

test.describe('Touch targets (12)', () => {
  test('filter chips and sort headers answer taps over 44px without growing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAdmin(page);
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/payment-requests' ? { json: ROWS_LONG } : null));
    await page.goto('/admin/payments');
    const chip = page.getByRole('group', { name: 'Filter payments' }).getByRole('button', { name: 'Approved', exact: true });
    const box = (await chip.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(28); // looks the same
    // 21px above and below the centre still lands on the chip (a 44px hit area).
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    for (const dy of [-21, 21]) {
      const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('button')?.textContent, [cx, cy + dy]);
      expect(hit).toBe('Approved');
    }
    await page.mouse.click(cx, cy + 20);
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // Sort header buttons are 44px tall.
    const sort = page.getByRole('columnheader', { name: /Amount/ }).getByRole('button');
    expect((await sort.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────

const SETTINGS = {
  id: 'platform',
  subscriptionTiers: [
    { key: 'basic', label: 'Basic', monthlyPrice: 30000, visits: 12, gymAccess: 'standard' },
    { key: 'pro', label: 'Pro', monthlyPrice: 100000, visits: -1, gymAccess: 'premium' },
    { key: 'lux', label: 'Luxury', monthlyPrice: 300000, visits: 30, gymAccess: 'luxury_executive' },
  ],
  payoutBands: [], paymentPeriodDays: 14, payoutModel: 'commission', currency: 'TZS', updatedAt: '2026-10-19T08:00:00Z',
};

test.describe('Settings: tier in use, singular and plural (9)', () => {
  const cases: Array<['en' | 'sw', number | null, string]> = [
    ['en', 1, 'Pro can’t be removed or switched off: 1 pass or account still uses it. Nothing was saved.'],
    ['en', 2, 'Pro can’t be removed or switched off: 2 passes or accounts still use it. Nothing was saved.'],
    ['en', null, 'Pro can’t be removed or switched off: passes or accounts still use it. Nothing was saved.'],
    ['sw', 1, 'Pro haiwezi kuondolewa wala kuzimwa: pasi au akaunti 1 bado inaitumia. Hakuna kilichohifadhiwa.'],
    ['sw', 4, 'Pro haiwezi kuondolewa wala kuzimwa: pasi au akaunti 4 bado zinaitumia. Hakuna kilichohifadhiwa.'],
  ];
  for (const [locale, holders, text] of cases) {
    test(`${locale}, ${holders ?? 'no count'}`, async ({ page }) => {
      await signInAdmin(page, 'admin-1', locale);
      await mockApi(page, ({ method, path }) => {
        if (method === 'GET' && path === '/admin/settings') return { json: SETTINGS };
        if (method === 'PUT' && path === '/admin/settings') return { status: 409, json: { error: 'tier_in_use', tier: 'pro', ...(holders == null ? {} : { holders }) } };
        return null;
      });
      await page.goto('/admin/settings');
      await page.getByTestId('tier-1-remove').click();
      await page.getByRole('alertdialog').getByRole('button').last().click();
      await page.getByTestId('settings-save').click();
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    });
  }
});

test.describe('Settings: tier editor fits 1280px in Swahili (10)', () => {
  test('no sideways scroll and no gym-access option is cut', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAdmin(page, 'admin-1', 'sw');
    await mockApi(page, ({ method, path }) => (method === 'GET' && path === '/admin/settings' ? { json: SETTINGS } : null));
    await page.goto('/admin/settings');
    const region = page.getByRole('region', { name: 'Viwango vya Pasi' });
    await expect(region).toBeVisible();
    expect(await region.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    for (let i = 0; i < 3; i++) {
      const fits = await page.getByTestId(`tier-${i}-gym-access`).evaluate((el) => {
        const s = el as HTMLSelectElement;
        const cs = getComputedStyle(s);
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = cs.font;
        const need = ctx.measureText(s.selectedOptions[0]?.text ?? '').width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        return need <= s.clientWidth;
      });
      expect(fits, `tier ${i} gym access fits`).toBe(true);
    }
  });
});

// ── Scan ─────────────────────────────────────────────────────────────────────────────────────────

test.describe('Scan: already checked in is information, not success (11)', () => {
  const owner = { id: 'owner-1', userType: 'gym_operator', email: 'owner@example.test' };
  const scanMock = (idempotent: boolean): Handler => ({ method, path }) => {
    if (method === 'GET' && path === '/subscription-tiers') return { json: [{ key: 'premium', label: 'Premium', monthlyPrice: 100000, visits: 30, gymAccess: 'premium' }] };
    if (method === 'POST' && path === '/operator/checkins') {
      return { json: { ok: true, idempotent, visitNumberInCycle: 3, checkin: { id: 'c1', memberId: 'member-1', memberPublicId: 'FF-1234', passTier: 'premium', visitNumberInCycle: 3, timestamp: '2026-10-19T10:00:00Z', memberPhone: null, gymTier: 'premium' } } };
    }
    return null;
  };

  test('a repeat scan uses the info tone; a fresh check-in stays green', async ({ page }) => {
    await signIn(page, owner);
    let idempotent = true;
    await mockApi(page, (c) => scanMock(idempotent)(c));
    await page.goto('/scan');
    await page.getByTestId('manual-token').fill('usr_1.abc.sig');
    await page.getByTestId('manual-submit').click();
    const result = page.getByTestId('scan-result');
    await expect(result).toContainText('Already checked in today');
    await expect(result).toHaveAttribute('data-tone', 'info');
    await expect(result).toHaveClass(/info/);
    await expect(result).not.toHaveClass(/success/);
    await expect(result.locator('span').filter({ hasText: 'Already checked in today' }).first()).toHaveClass(/info/);

    idempotent = false;
    await page.getByTestId('manual-token').fill('usr_1.abc.sig2');
    await page.getByTestId('manual-submit').click();
    await expect(result).toContainText('Check-in successful');
    await expect(result).toHaveAttribute('data-tone', 'success');
    await expect(result).toHaveClass(/success/);
  });

  test('Swahili', async ({ page }) => {
    await signIn(page, owner, 'sw');
    await mockApi(page, scanMock(true));
    await page.goto('/scan');
    await page.getByTestId('manual-token').fill('usr_1.abc.sig');
    await page.getByTestId('manual-submit').click();
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-tone', 'info');
  });
});
