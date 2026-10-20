import { expect, test, type Page, type Request } from '@playwright/test';

// Admin tax rates (S5 §7.3, maker ≠ checker) and the VAT registration section of a vendor's KYC case (§7.4),
// against a mocked API. Network guard: every request outside localhost is aborted and recorded, for the whole
// browser context; the API is answered here. Nothing may reach the live API or any other service.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
test.use({ serviceWorkers: 'block' });

type Reply = { status?: number; json?: unknown; body?: string | Buffer; contentType?: string };
type Routes = Record<string, Reply | ((req: Request) => Reply)>;
type Call = { method: string; path: string; body: Record<string, unknown> | null };

const ME = { id: 'adm_1', userType: 'admin', email: 'one@fitflex.test' };
const NOW = new Date(Date.now() - 60_000).toISOString();
const day = (n: number) => new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

const codes = [
  { code: 'A', nameEn: 'Standard', nameSw: 'Kiwango cha kawaida', exempt: false, inUse: true, status: 'active' },
  { code: 'B', nameEn: 'Special rate', nameSw: 'Kiwango maalum', exempt: false, inUse: false, status: 'unused' },
  { code: 'C', nameEn: 'Zero-rated', nameSw: 'Kiwango sifuri', exempt: false, inUse: true, status: 'active' },
  { code: 'D', nameEn: 'Special relief', nameSw: 'Nafuu maalum', exempt: false, inUse: false, status: 'unused' },
  { code: 'E', nameEn: 'Exempt', nameSw: 'Msamaha wa VAT', exempt: true, inUse: true, status: 'active' },
];
const rate = (id: string, extra: Record<string, unknown> = {}) => ({
  id, code: 'A', nameEn: 'Standard', nameSw: 'Kiwango cha kawaida', ratePct: 18, exempt: false, effectiveFrom: '2026-06-01', effectiveTo: null,
  status: 'active', reason: 'Seed', proposedBy: 'system', proposedAt: NOW, decidedBy: 'system', decidedAt: NOW, decisionNote: null,
  history: [{ action: 'tax_rate_proposed', actor: 'system', at: NOW, before: null, after: { status: 'pending' } }], ...extra,
});
const seed = () => [
  rate('tr_a'),
  rate('tr_c', { code: 'C', nameEn: 'Zero-rated', nameSw: 'Kiwango sifuri', ratePct: 0 }),
  rate('tr_e', { code: 'E', nameEn: 'Exempt', nameSw: 'Msamaha wa VAT', ratePct: null, exempt: true }),
];

async function signIn(page: Page, user: Record<string, unknown> = ME, locale: 'en' | 'sw' = 'en') {
  await page.addInitScript(([u, l]) => {
    localStorage.setItem('locale', l as string);
    localStorage.setItem('token', 'admin-tok');
    localStorage.setItem('user', JSON.stringify(u));
  }, [user, locale] as const);
}

async function mockApi(page: Page, routes: Routes) {
  const calls: Call[] = [];
  const outside: string[] = [];
  page.on('pageerror', err => console.log('PAGEERROR', err.message));
  await page.context().route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => { outside.push(route.request().url()); return route.abort(); });
  await page.context().route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body: Record<string, unknown> | null = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ method: req.method(), path: url.pathname, body });
    const hit = routes[`${req.method()} ${url.pathname}`];
    if (!hit) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const reply = typeof hit === 'function' ? hit(req) : hit;
    if (reply.body != null) return route.fulfill({ status: reply.status ?? 200, body: reply.body, contentType: reply.contentType ?? 'application/octet-stream' });
    return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? null });
  });
  return Object.assign(calls, { outside });
}
const callsTo = (calls: Call[], method: string, path: string) => calls.filter(c => c.method === method && c.path === path);

test.describe('tax rates', () => {
  test('VAT off: no Tax rates in the nav; a deep link says it is not switched on', async ({ page }) => {
    await signIn(page);
    const calls = await mockApi(page, { 'GET /admin/tax-rates': { status: 404, json: { error: 'feature_disabled' } } });
    await page.goto('/admin/payments/');
    await expect(page.getByRole('link', { name: 'Payments', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tax rates' })).toHaveCount(0);
    await page.goto('/admin/tax-rates/');
    await expect(page.getByTestId('tax-rates-off')).toContainText("Tax rates aren't switched on yet.");
    expect(callsTo(calls, 'POST', '/admin/tax-rates')).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('seeded codes: A 18% and C 0% active, E exempt, B and D not in use; history expander', async ({ page }) => {
    await signIn(page);
    const calls = await mockApi(page, { 'GET /admin/tax-rates': { json: { asOf: day(0), codes, rates: seed() } } });
    await page.goto('/admin/payments/');
    await page.getByRole('link', { name: 'Tax rates' }).click();
    await expect(page).toHaveURL(/\/admin\/tax-rates\/?$/);
    // The design-system Table names its scrollable region.
    const table = page.getByRole('region', { name: 'Tax rates' });
    await expect(table.getByTestId('tax-rate-tr_a')).toContainText('18%');
    await expect(table.getByTestId('tax-rate-tr_a')).toContainText('Active');
    await expect(table.getByTestId('tax-rate-tr_c')).toContainText('0%');
    await expect(table.getByTestId('tax-rate-tr_e')).toContainText('Exempt');
    await expect(table.getByTestId('tax-code-B')).toContainText('Not in use');
    await expect(table.getByTestId('tax-code-D')).toContainText('Not in use');
    await table.getByTestId('tax-history-toggle-tr_a').click();
    await expect(table.getByTestId('tax-history-toggle-tr_a')).toHaveAttribute('aria-expanded', 'true');
    await expect(table.getByTestId('tax-history-tr_a')).toContainText('Proposed');
    await expect(table.getByTestId('tax-history-tr_a')).toContainText('Reason: Seed');
    expect(calls.outside).toEqual([]);
  });

  test('propose: validation (rate, past date, reason), then POST; the proposer cannot approve and may withdraw', async ({ page }) => {
    await signIn(page);
    let rates = seed();
    const calls = await mockApi(page, {
      'GET /admin/tax-rates': () => ({ json: { asOf: day(0), codes, rates } }),
      'POST /admin/tax-rates': (req: Request) => {
        const b = req.postDataJSON();
        const r = rate('tr_new', { ratePct: b.ratePct, effectiveFrom: b.effectiveFrom, status: 'pending', proposedBy: ME.id, reason: b.reason, decidedBy: null, decidedAt: null, history: [{ action: 'tax_rate_proposed', actor: ME.id, at: NOW, before: null, after: { status: 'pending' } }] });
        rates = [...rates, r];
        return { status: 201, json: { rate: r } };
      },
      'POST /admin/tax-rates/tr_new/withdraw': () => { rates = rates.map(r => (r.id === 'tr_new' ? { ...r, status: 'withdrawn' } : r)); return { json: { rate: rates.at(-1) } }; },
    });
    await page.goto('/admin/tax-rates/');
    await page.getByTestId('tax-propose').click();
    const dialog = page.getByTestId('tax-propose-dialog');
    await dialog.getByTestId('tax-propose-rate').fill('150');
    await dialog.getByTestId('tax-propose-from').fill(day(0));
    await dialog.getByTestId('tax-propose-submit').click();
    await expect(dialog.getByText('Enter a rate from 0 to 100, with up to 2 decimals.')).toBeVisible();
    await expect(dialog.getByText('The effective date must be tomorrow or later.')).toBeVisible();
    await expect(dialog.getByText('Give a reason (3 to 300 characters).')).toBeVisible();
    expect(callsTo(calls, 'POST', '/admin/tax-rates')).toHaveLength(0);

    await dialog.getByTestId('tax-propose-rate').fill('16');
    await dialog.getByTestId('tax-propose-from').fill(day(10));
    await dialog.getByTestId('tax-propose-reason').fill('Finance Act 2026 (example)');
    await dialog.getByTestId('tax-propose-submit').click();
    await expect(page.getByText('Change proposed. Another admin must approve it.')).toBeVisible();
    expect(callsTo(calls, 'POST', '/admin/tax-rates')[0].body).toEqual({ code: 'A', ratePct: 16, effectiveFrom: day(10), reason: 'Finance Act 2026 (example)' });

    const row = page.getByTestId('tax-rate-tr_new');
    await expect(row).toContainText('Waiting for approval');
    await expect(row).toContainText('You');
    await expect(row.getByTestId('tax-waiting-tr_new')).toContainText('Waiting for another admin to approve.');
    await expect(row.getByTestId('tax-approve-tr_new')).toBeDisabled();
    await expect(row.getByTestId('tax-approve-tr_new')).toHaveAccessibleDescription(/another admin must approve it/);
    await expect(row.getByTestId('tax-reject-tr_new')).toHaveCount(0);
    await row.getByTestId('tax-withdraw-tr_new').click();
    await expect(page.getByText('Proposal withdrawn')).toBeVisible();
    await expect(page.getByTestId('tax-rate-tr_new')).toContainText('Withdrawn');
    expect(callsTo(calls, 'POST', '/admin/tax-rates/tr_new/approve')).toHaveLength(0);
  });

  test('exempt E proposes exempt: true; zero-rated C must be 0', async ({ page }) => {
    await signIn(page);
    const calls = await mockApi(page, {
      'GET /admin/tax-rates': { json: { asOf: day(0), codes, rates: seed() } },
      'POST /admin/tax-rates': (req: Request) => ({ status: 201, json: { rate: rate('tr_x', { ...req.postDataJSON(), status: 'pending', proposedBy: ME.id }) } }),
    });
    await page.goto('/admin/tax-rates/');
    await page.getByTestId('tax-propose').click();
    const dialog = page.getByTestId('tax-propose-dialog');
    await dialog.getByTestId('tax-propose-code').selectOption('C');
    await dialog.getByTestId('tax-propose-rate').fill('5');
    await dialog.getByTestId('tax-propose-reason').fill('Check');
    await dialog.getByTestId('tax-propose-submit').click();
    await expect(dialog.getByText('Zero-rated (C) must be 0%.')).toBeVisible();
    await dialog.getByTestId('tax-propose-code').selectOption('E');
    await expect(dialog.getByTestId('tax-propose-exempt')).toBeChecked();
    await expect(dialog.getByTestId('tax-propose-rate')).toHaveCount(0);
    await dialog.getByTestId('tax-propose-reason').fill('Exempt check');
    await dialog.getByTestId('tax-propose-submit').click();
    await expect.poll(() => callsTo(calls, 'POST', '/admin/tax-rates').length).toBe(1);
    expect(callsTo(calls, 'POST', '/admin/tax-rates')[0].body).toEqual({ code: 'E', exempt: true, effectiveFrom: day(1), reason: 'Exempt check' });
  });

  test('another admin approves (Scheduled) and rejects with a reason; a server same_admin refusal is shown', async ({ page }) => {
    await signIn(page);
    let rates = [...seed(),
      rate('tr_p1', { ratePct: 16, effectiveFrom: day(10), status: 'pending', proposedBy: 'adm_2', decidedBy: null, decidedAt: null }),
      rate('tr_p2', { ratePct: 17, effectiveFrom: day(20), status: 'pending', proposedBy: 'adm_2', decidedBy: null, decidedAt: null }),
      rate('tr_p3', { ratePct: 15, effectiveFrom: day(30), status: 'pending', proposedBy: 'adm_3', decidedBy: null, decidedAt: null })];
    const calls = await mockApi(page, {
      'GET /admin/tax-rates': () => ({ json: { asOf: day(0), codes, rates } }),
      'POST /admin/tax-rates/tr_p1/approve': () => { rates = rates.map(r => (r.id === 'tr_p1' ? { ...r, status: 'scheduled', decidedBy: ME.id } : r)); return { json: { rate: rates[3] } }; },
      'POST /admin/tax-rates/tr_p2/reject': () => { rates = rates.map(r => (r.id === 'tr_p2' ? { ...r, status: 'rejected', decidedBy: ME.id } : r)); return { json: { rate: rates[4] } }; },
      // A crafted case: the server knows better (maker ≠ checker is enforced there and in the database).
      'POST /admin/tax-rates/tr_p3/approve': { status: 403, json: { error: 'same_admin' } },
    });
    await page.goto('/admin/tax-rates/');
    await page.getByTestId('tax-approve-tr_p1').click();
    await expect(page.getByText('Rate approved')).toBeVisible();
    await expect(page.getByTestId('tax-rate-tr_p1')).toContainText('Scheduled');

    await page.getByTestId('tax-reject-tr_p2').click();
    const dialog = page.getByTestId('tax-reject-dialog');
    await dialog.getByTestId('tax-reject-submit').click();
    await expect(dialog.getByText('Give a reason (3 to 300 characters).')).toBeVisible();
    expect(callsTo(calls, 'POST', '/admin/tax-rates/tr_p2/reject')).toHaveLength(0);
    await dialog.getByTestId('tax-reject-reason').fill('Wrong date');
    await dialog.getByTestId('tax-reject-submit').click();
    await expect(page.getByText('Proposal rejected')).toBeVisible();
    expect(callsTo(calls, 'POST', '/admin/tax-rates/tr_p2/reject')[0].body).toEqual({ reason: 'Wrong date' });
    await expect(page.getByTestId('tax-rate-tr_p2')).toContainText('Rejected');

    await page.getByTestId('tax-approve-tr_p3').click();
    await expect(page.getByText('You proposed this change, so another admin must approve it.')).toBeVisible();
    expect(calls.outside).toEqual([]);
  });

  test('Kiswahili labels', async ({ page }) => {
    await signIn(page, ME, 'sw');
    await mockApi(page, { 'GET /admin/tax-rates': { json: { asOf: day(0), codes, rates: seed() } } });
    await page.goto('/admin/tax-rates/');
    await expect(page.getByRole('heading', { name: 'Viwango vya kodi' })).toBeVisible();
    await expect(page.getByTestId('tax-rate-tr_a')).toContainText('Kinatumika');
    await expect(page.getByTestId('tax-rate-tr_a')).toContainText('Kiwango cha kawaida');
    await expect(page.getByTestId('tax-code-B')).toContainText('Hakitumiki');
    await expect(page.getByTestId('tax-propose')).toHaveText('Pendekeza mabadiliko');
  });
});

test.describe('KYC: VAT registration', () => {
  const kycCase = {
    partnerType: 'vendor',
    case: {
      id: 'case_v1', partnerType: 'vendor', userId: 'usr_vendor', corporateId: null, status: 'approved', tier: 1, round: 1, legalName: 'Dar Fitness Gear Ltd',
      tradingName: null, entityType: null, registrationNumber: null, registrationAuthority: null, incorporatedOn: null, registeredAddress: null, businessActivity: null,
      tin: '111222333', submittedAt: NOW, reviewerId: null, decidedAt: NOW, decidedBy: 'adm_9', reasonCode: null, reasonNote: null, reverifyAt: null, updatedAt: NOW,
    },
    people: [],
    documents: [{
      id: 'pdoc_vat1', requirementKey: 'vat_certificate', docType: 'vat_certificate', status: 'pending', hasFile: true, fileName: 'vat.png', mimeType: 'image/png', sizeBytes: 2048,
      documentNumber: null, issuer: null, issuedOn: null, expiresOn: null, details: {}, reviewNote: null, reviewedAt: null, supersedesId: null, round: 1, createdAt: NOW,
    }],
    settlementAccounts: [],
    checklist: { partnerType: 'vendor', tier: 1, sections: [], missing: [], awaitingReview: [], readyToSubmit: false, complete: true },
    checks: [], agreements: [], events: [],
  };
  const profile = (extra: Record<string, unknown> = {}) => ({
    vatRegistered: true, tin: '123456789', tinFromKyc: false, vrn: '40012345X', certificateDocumentId: 'pdoc_vat1', pricesIncludeVat: true, status: 'pending',
    rejectReason: null, rejectNote: null, verifiedAt: null, inForce: false, changePending: false, verified: null,
    pending: { tin: '123456789', vrn: '40012345X', certificateDocumentId: 'pdoc_vat1', submittedAt: NOW }, updatedAt: NOW, ...extra,
  });
  const vat = (extra: Record<string, unknown> = {}) => ({
    vendorId: 'usr_vendor', taxProfile: profile(), kycCaseId: 'case_v1', kycTin: '111222333', tinMismatch: true,
    certificate: { id: 'pdoc_vat1', status: 'pending', fileName: 'vat.png', mimeType: 'image/png', uploadedAt: NOW }, ...extra,
  });
  // 1×1 PNG for the certificate viewer.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

  const kycRoutes = (extra: Routes = {}): Routes => ({
    'GET /admin/kyc/cases': { json: [] },
    'GET /admin/kyc/cases/case_v1': { json: kycCase },
    'GET /admin/kyc/vendors/usr_vendor/vat': { json: vat() },
    'GET /admin/kyc/cases/case_v1/documents/pdoc_vat1/file': { body: PNG, contentType: 'image/png' },
    ...extra,
  });

  test('VRN, TIN with the mismatch warning, certificate viewer, Verify; 409 certificate_not_current', async ({ page }) => {
    await signIn(page);
    let n = 0;
    const calls = await mockApi(page, kycRoutes({
      'POST /admin/kyc/vendors/usr_vendor/vat/verify': () => (++n === 1
        ? { status: 409, json: { error: 'certificate_not_current' } }
        : { json: vat({ tinMismatch: false, taxProfile: profile({ status: 'verified', inForce: true, verifiedAt: NOW, pending: null, verified: { tin: '123456789', vrn: '40012345X', certificateDocumentId: 'pdoc_vat1', verifiedAt: NOW, certificateStands: true } }), certificate: { id: 'pdoc_vat1', status: 'accepted', fileName: 'vat.png', mimeType: 'image/png', uploadedAt: NOW } }) }),
    }));
    await page.goto('/admin/kyc/?case=case_v1');
    const section = page.getByTestId('kyc-vat');
    await expect(section.getByRole('heading', { name: /VAT registration/ })).toBeVisible();
    await expect(section).toContainText('Waiting for review');
    await expect(section.getByTestId('kyc-vat-vrn')).toHaveText('40012345X');
    await expect(section.getByTestId('kyc-vat-tin')).toHaveText('123456789');
    await expect(section.getByTestId('kyc-vat-tin-mismatch')).toContainText('This TIN differs from the TIN on the verification case.');
    await expect(section.getByTestId('kyc-vat-tin-mismatch')).toContainText('111222333');
    await expect(section.getByTestId('kyc-vat-cert')).toContainText('vat.png');
    // The certificate in the case's documents list has a proper label.
    await expect(page.getByTestId('kyc-doc-vat_certificate')).toContainText('VAT certificate');
    await section.getByTestId('kyc-vat-view').click();
    await expect(page.getByTestId('kyc-viewer').locator('img')).toBeVisible();
    await page.keyboard.press('Escape');

    await section.getByTestId('kyc-vat-verify').click();
    await expect(section.getByTestId('kyc-vat-error')).toHaveText('The certificate changed since it was submitted. The vendor must send it again.');
    await section.getByTestId('kyc-vat-verify').click();
    await expect(page.getByText('VAT details verified')).toBeVisible();
    await expect(section).toContainText('Verified');
    await expect(section.getByTestId('kyc-vat-verify')).toHaveCount(0);
    expect(callsTo(calls, 'POST', '/admin/kyc/vendors/usr_vendor/vat/verify')).toHaveLength(2);
    // The case decision is never touched by the VAT section.
    expect(calls.filter(c => c.method === 'POST' && c.path.endsWith('/decision'))).toHaveLength(0);
    expect(calls.outside).toEqual([]);
  });

  test('Not accepted: reason Other needs a note; the body carries reason and note', async ({ page }) => {
    await signIn(page);
    const calls = await mockApi(page, kycRoutes({
      'POST /admin/kyc/vendors/usr_vendor/vat/reject': { json: vat({ taxProfile: profile({ status: 'rejected', rejectReason: 'other', rejectNote: 'Blurred stamp', pending: null }) }) },
    }));
    await page.goto('/admin/kyc/?case=case_v1');
    await page.getByTestId('kyc-vat-reject').click();
    const dialog = page.getByTestId('kyc-vat-reject-dialog');
    await dialog.getByTestId('kyc-vat-reason').selectOption('other');
    await dialog.getByTestId('kyc-vat-reject-submit').click();
    await expect(dialog.getByText('Add a note when the reason is Other.')).toBeVisible();
    expect(callsTo(calls, 'POST', '/admin/kyc/vendors/usr_vendor/vat/reject')).toHaveLength(0);
    await dialog.getByTestId('kyc-vat-note').fill('Blurred stamp');
    await dialog.getByTestId('kyc-vat-reject-submit').click();
    await expect(page.getByText('VAT details not accepted')).toBeVisible();
    expect(callsTo(calls, 'POST', '/admin/kyc/vendors/usr_vendor/vat/reject')[0].body).toEqual({ reason: 'other', note: 'Blurred stamp' });
    await expect(page.getByTestId('kyc-vat-rejected')).toContainText('Not accepted: Other (Blurred stamp)');
  });

  test('hidden when VAT is off or nothing was submitted', async ({ page }) => {
    await signIn(page);
    let off = true;
    await mockApi(page, kycRoutes({
      'GET /admin/kyc/vendors/usr_vendor/vat': () => (off
        ? { status: 404, json: { error: 'feature_disabled' } }
        : { json: vat({ tinMismatch: false, certificate: null, taxProfile: profile({ status: 'none', vatRegistered: false, pending: null, vrn: null, tin: null, certificateDocumentId: null }) }) }),
    }));
    await page.goto('/admin/kyc/?case=case_v1');
    await expect(page.getByTestId('kyc-case')).toBeVisible();
    await expect(page.getByTestId('kyc-doc-vat_certificate')).toBeVisible();
    await expect(page.getByTestId('kyc-vat')).toHaveCount(0);
    off = false;
    await page.reload();
    await expect(page.getByTestId('kyc-case')).toBeVisible();
    await expect(page.getByTestId('kyc-doc-vat_certificate')).toBeVisible();
    await expect(page.getByTestId('kyc-vat')).toHaveCount(0);
  });

  test('Kiswahili section labels', async ({ page }) => {
    await signIn(page, ME, 'sw');
    await mockApi(page, kycRoutes());
    await page.goto('/admin/kyc/?case=case_v1');
    const section = page.getByTestId('kyc-vat');
    await expect(section.getByRole('heading', { name: /Usajili wa VAT/ })).toBeVisible();
    await expect(section.getByTestId('kyc-vat-verify')).toHaveText('Thibitisha');
    await expect(section.getByTestId('kyc-vat-reject')).toHaveText('Haikukubaliwa');
    await expect(section.getByTestId('kyc-vat-tin-mismatch')).toContainText('TIN hii inatofautiana');
  });
});
