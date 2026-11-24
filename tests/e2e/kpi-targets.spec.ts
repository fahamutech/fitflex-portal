// FR-K01: admins view the KPI targets, change one, and confirm it. The API is faked in the browser
// (backend: fitflex-functions docs/kpi-targets-api.md).
import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
type Json = Record<string, unknown>;
type Call = { method: string; path: string; body: Json | null };

const ADMIN = { id: 'admin-1', userType: 'admin', email: 'admin@example.com', displayName: 'Local Admin' };
const row = (id: string, area: string, unit: string, baseline: string, draftTarget: number, target: number, sort: number) => ({
  id, area, unit, baseline, draftTarget, target, sort, assumption: true,
  confirmedAt: null, confirmedBy: null, updatedAt: '2026-11-24T08:00:00.000Z', updatedBy: null,
});
const seed = () => [
  row('pn_active_days', 'programmes', 'percent_change', 'To measure', 30, 20, 1),
  row('pn_programme_starts', 'programmes', 'percent', '0', 35, 25, 2),
  row('pn_food_count', 'programmes', 'count', '0', 400, 400, 5),
  row('pn_month2_renewal', 'programmes', 'points', 'To measure', 10, 5, 6),
  row('wa_cost_per_paid', 'whatsapp', 'percent_lower', 'To measure', 40, 25, 9),
];

async function setup(page: Page, state: { targets: Json[]; calls: Call[]; fail?: Json }) {
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, ADMIN);
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.method() === 'GET' ? null : (req.postDataJSON() as Json | null);
    if (req.method() !== 'GET') state.calls.push({ method: req.method(), path, body });
    if (path === '/admin/kpi-targets' && req.method() === 'GET') return route.fulfill({ json: { targets: state.targets } });
    const m = path.match(/^\/admin\/kpi-targets\/([^/]+)$/);
    if (m && req.method() === 'PUT') {
      if (state.fail) return route.fulfill({ status: 400, json: state.fail });
      const t = state.targets.find(x => x.id === m[1])!;
      if (body?.target !== undefined) t.target = body.target;
      if (body?.baseline !== undefined) t.baseline = body.baseline;
      if (body?.confirmed !== undefined) {
        t.assumption = !body.confirmed;
        t.confirmedBy = body.confirmed ? 'admin-1' : null;
        t.confirmedAt = body.confirmed ? '2026-11-24T09:00:00.000Z' : null;
      }
      Object.assign(t, { updatedBy: 'admin-1', updatedAt: '2026-11-24T09:00:00.000Z' });
      return route.fulfill({ json: { target: t } });
    }
    return route.fulfill({ json: [] });
  });
}

test('the targets are listed by area with their units, as assumptions', async ({ page }) => {
  await setup(page, { targets: seed(), calls: [] });
  await page.goto('/admin/kpi-targets');
  const starts = page.getByTestId('kpi-row-pn_programme_starts');
  await expect(starts).toContainText('Active Pass holders who start a programme');
  await expect(starts).toContainText('35%');
  await expect(page.getByTestId('kpi-target-pn_programme_starts')).toHaveText('25%');
  await expect(starts).toContainText('Assumption');
  await expect(page.getByTestId('kpi-target-pn_active_days')).toHaveText('+20%');
  await expect(page.getByTestId('kpi-target-pn_month2_renewal')).toHaveText('+5 points');
  await expect(page.getByTestId('kpi-target-pn_food_count')).toHaveText('400');
  await expect(page.getByTestId('kpi-table-whatsapp')).toContainText('WhatsApp');
  await expect(page.getByTestId('kpi-target-wa_cost_per_paid')).toHaveText('25% lower');
});

test('an admin changes a target and confirms it', async ({ page }) => {
  const state = { targets: seed(), calls: [] as Call[] };
  await setup(page, state);
  await page.goto('/admin/kpi-targets');
  await page.getByTestId('kpi-edit-pn_programme_starts').click();
  await page.getByTestId('kpi-field-target').fill('150');
  await page.getByTestId('kpi-save').click();
  await expect(page.getByTestId('kpi-form-error')).toHaveText('Enter a target between 0 and 100, with at most two decimals.');
  expect(state.calls).toHaveLength(0);

  await page.getByTestId('kpi-field-target').fill('30');
  await page.getByTestId('kpi-field-baseline').fill('2%');
  await page.getByTestId('kpi-field-confirmed').check();
  await page.getByTestId('kpi-save').click();
  await expect(page.getByTestId('kpi-done')).toContainText('Saved');
  expect(state.calls).toEqual([{ method: 'PUT', path: '/admin/kpi-targets/pn_programme_starts', body: { target: 30, baseline: '2%', confirmed: true } }]);
  await expect(page.getByTestId('kpi-target-pn_programme_starts')).toHaveText('30%');
  await expect(page.getByTestId('kpi-row-pn_programme_starts')).toContainText('Confirmed by admin-1');
});

test('saving with nothing changed says so, and a server refusal is shown', async ({ page }) => {
  const state = { targets: seed(), calls: [] as Call[], fail: { error: 'invalid_kpi_target', field: 'baseline' } };
  await setup(page, state);
  await page.goto('/admin/kpi-targets');
  await page.getByTestId('kpi-edit-pn_food_count').click();
  await page.getByTestId('kpi-save').click();
  await expect(page.getByTestId('kpi-form-error')).toHaveText('Nothing changed.');
  await page.getByTestId('kpi-field-baseline').fill('12');
  await page.getByTestId('kpi-save').click();
  await expect(page.getByTestId('kpi-form-error')).toHaveText('The baseline can be up to 40 characters.');
});
