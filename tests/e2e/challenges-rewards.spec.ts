import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Json = Record<string, unknown>;
type Call = { method: string; path: string; body: Json | null };

const challenge = (over: Json = {}) => ({
  id: 'chl-1', name: 'FitFlex 50K Steps', description: null, type: 'steps', target: 50000,
  startDate: '2026-10-01', endDate: '2099-10-30', rewards: ['7-day Gym Pass'],
  rewardItems: [{ id: 'rwd-1', type: 'gym_pass', label: '7-day Gym Pass', value: '7 days', rule: 'finishers', topN: null }],
  rewardFunding: 'fitflex', eligibility: null, mode: 'individual', status: 'active', phase: 'active', participantCount: 4, teams: [],
  ...over,
});

const award = (over: Json = {}) => ({
  id: 'rwa-1', challenge: { id: 'chl-1', name: 'FitFlex 50K Steps', endDate: '2099-10-30' },
  reward: { id: 'rwd-1', type: 'gym_pass', label: '7-day Gym Pass', value: '7 days', rule: 'finishers' },
  rank: null, status: 'pending', earnedAt: '2026-10-05T07:00:00.000Z', issuedAt: null, reference: null, note: null,
  member: { id: 'm-1', displayName: 'Asha Juma' }, funder: 'fitflex',
  history: [{ status: 'pending', at: '2026-10-05T07:00:00.000Z', by: null, note: 'Earned' }],
  ...over,
});

const counts = (rows: Json[]) => {
  const c: Record<string, number> = { pending: 0, approved: 0, issued: 0, rejected: 0 };
  for (const r of rows) c[r.status as string] += 1;
  return c;
};

/**
 * A signed-in user and a small fake challenges/rewards API. `scope` is the
 * route prefix the screens should use: `admin` or `corporate`.
 */
async function setup(page: Page, user: Json, scope: 'admin' | 'corporate', state: { challenges: Json[]; summary: Json; awards: Json[]; calls: Call[] }) {
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.method() === 'GET' ? null : (req.postDataJSON() as Json | null);
    if (req.method() !== 'GET') state.calls.push({ method: req.method(), path, body });

    if (path === `/${scope}/challenges` && req.method() === 'POST') {
      const created = challenge({ id: 'chl-new', participantCount: 0, phase: 'upcoming', ...body, rewards: [], ...(body?.draft ? { status: 'draft', phase: 'draft' } : {}) });
      state.challenges.push(created);
      return route.fulfill({ status: 201, json: { challenge: created } });
    }
    if (path === `/${scope}/challenges`) return route.fulfill({ json: { challenges: state.challenges } });
    const step = path.match(new RegExp(`^/${scope}/challenges/([^/]+)/(publish|pause|resume)$`));
    if (step) {
      const c = state.challenges.find(x => x.id === step[1])!;
      Object.assign(c, step[2] === 'pause' ? { status: 'paused' } : step[2] === 'resume' ? { status: 'active' } : { status: 'active', phase: 'upcoming' });
      return route.fulfill({ json: { challenge: c } });
    }
    const action = path.match(new RegExp(`^/${scope}/challenges/([^/]+)/(close|cancel|archive)$`));
    if (action) {
      const c = state.challenges.find(x => x.id === action[1])!;
      Object.assign(c, action[2] === 'close' ? { status: 'closed', phase: 'ended' } : action[2] === 'archive' ? { status: 'archived', phase: 'ended' } : { status: 'cancelled', phase: 'cancelled' });
      return route.fulfill({ json: { challenge: c } });
    }
    if (path.endsWith('/participants')) return route.fulfill({ json: state.summary });
    if (path === '/corporate/staff') return route.fulfill({ json: { employees: [] } });

    const status = path.match(new RegExp(`^/${scope}/rewards/([^/]+)/status$`));
    if (status) {
      const a = state.awards.find(x => x.id === status[1])!;
      const from = a.status, to = body?.status as string;
      const allowed: Record<string, string[]> = { pending: ['approved', 'rejected'], approved: ['issued', 'rejected'], rejected: ['pending'], issued: [] };
      if (!allowed[from as string].includes(to)) return route.fulfill({ status: 409, json: { error: 'invalid_transition' } });
      if (to === 'rejected' && !body?.note) return route.fulfill({ status: 400, json: { error: 'reason_required' } });
      Object.assign(a, { status: to, reference: body?.reference ?? a.reference, note: body?.note ?? a.note, issuedAt: to === 'issued' ? '2026-10-06T09:00:00.000Z' : null });
      (a.history as Json[]).push({ status: to, at: '2026-10-06T09:00:00.000Z', by: user.id, byName: 'Local Admin', note: body?.note, reference: body?.reference });
      return route.fulfill({ json: { reward: a } });
    }
    if (path === `/${scope}/rewards`) return route.fulfill({ json: { rewards: state.awards, counts: counts(state.awards) } });
    return route.fulfill({ json: [] });
  });
}

const ADMIN = { id: 'admin-1', userType: 'admin', email: 'admin@example.com', displayName: 'Local Admin' };
const HR = { id: 'hr-1', userType: 'corporate_hr', email: 'hr@kilimo.test', displayName: 'Neema HR', corporateId: 'corp-1' };
const fullSummary = { summary: { eligible: 574, joined: 4, participationRate: 0.007, completed: 2, completionRate: 0.5, averageProgress: 0.65 } };

test('a draft stays out of sight until published; a running challenge can be paused and resumed', async ({ page }) => {
  const state = { challenges: [challenge()], summary: fullSummary, awards: [] as Json[], calls: [] as Call[] };
  await setup(page, ADMIN, 'admin', state);
  page.on('dialog', d => d.accept());

  await page.goto('/admin/challenges');
  await page.getByTestId('challenge-new').click();
  await page.getByTestId('challenge-name').fill('November Walk');
  await page.getByTestId('challenge-save-draft').click();
  expect(state.calls.find(c => c.method === 'POST' && c.path === '/admin/challenges')!.body).toMatchObject({ name: 'November Walk', draft: true });

  // It opens as a draft, listed under Drafts and not with the running ones.
  const detail = page.getByTestId('challenge-detail');
  await expect(detail).toContainText('Nobody can see or join it until you publish it');
  await expect(page.getByTestId('challenge-tab-draft')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('challenge-row-chl-new')).toContainText('Draft');
  await expect(page.getByTestId('challenge-row-chl-1')).toHaveCount(0);
  await expect(page.getByTestId('challenge-pause')).toHaveCount(0);

  await page.getByTestId('challenge-publish').click();
  await expect.poll(() => state.calls.some(c => c.path === '/admin/challenges/chl-new/publish')).toBe(true);
  await expect(page.getByTestId('challenge-tab-live')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('challenge-row-chl-new')).toContainText('Upcoming');

  // Pause the running one: it stays in the list, marked, and can be resumed.
  await page.reload();
  await page.getByTestId('challenge-row-chl-1').click();
  await page.getByTestId('challenge-pause').click();
  await expect.poll(() => state.calls.some(c => c.path === '/admin/challenges/chl-1/pause')).toBe(true);
  await expect(detail).toContainText('People already taking part carry on');
  await expect(page.getByTestId('challenge-row-chl-1')).toContainText('Paused');
  await expect(page.getByTestId('challenge-edit')).toBeVisible();
  await page.getByTestId('challenge-resume').click();
  await expect.poll(() => state.calls.some(c => c.path === '/admin/challenges/chl-1/resume')).toBe(true);
  await expect(page.getByTestId('challenge-row-chl-1')).toContainText('Running');
  await expect(page.getByTestId('challenge-pause')).toBeVisible();
});

test('admin creates a challenge with a structured reward, sees totals, and closes it', async ({ page }) => {
  const state = { challenges: [challenge()], summary: fullSummary, awards: [] as Json[], calls: [] as Call[] };
  await setup(page, ADMIN, 'admin', state);
  page.on('dialog', d => d.accept());

  await page.goto('/admin/challenges');
  await expect(page.getByTestId('challenge-row-chl-1')).toContainText('FitFlex 50K Steps');

  await page.getByTestId('challenge-new').click();
  await page.getByTestId('challenge-name').fill('October Walk');
  await page.getByTestId('challenge-target').fill('30000');
  await page.getByTestId('reward-add').click();
  await page.getByTestId('reward-row-0').getByLabel('Reward name').fill('Finisher badge');
  await page.getByTestId('challenge-save').click();

  const created = state.calls.find(c => c.method === 'POST' && c.path === '/admin/challenges')!;
  expect(created.body).toMatchObject({ name: 'October Walk', target: 30000 });
  expect((created.body!.rewardItems as Json[])[0]).toMatchObject({ label: 'Finisher badge', rule: 'finishers' });

  // The detail view: totals only, and the reward with who earns it.
  await page.reload();
  await page.getByTestId('challenge-row-chl-1').click();
  const detail = page.getByTestId('challenge-detail');
  await expect(detail).toContainText('Taking part');
  await expect(detail).toContainText('50%');
  await expect(page.getByTestId('challenge-reward-list')).toContainText('7-day Gym Pass');
  await expect(page.getByTestId('challenge-reward-list')).toContainText('Everyone who finishes');

  await page.getByTestId('challenge-close').click();
  await expect.poll(() => state.calls.some(c => c.path === '/admin/challenges/chl-1/close')).toBe(true);
});

test('company HR: results are withheld until 3 people take part', async ({ page }) => {
  const summary = {
    summary: { eligible: 5, joined: 1, participationRate: 0.2, completed: null, completionRate: null, averageProgress: null, resultsHidden: true },
    byDepartment: [{ department: 'Finance', other: false, eligible: 4, joined: 1, participationRate: 0.25 }],
    minGroupSize: 3,
  };
  const state = { challenges: [challenge({ rewardFunding: 'company', participantCount: 1 })], summary, awards: [] as Json[], calls: [] as Call[] };
  await setup(page, HR, 'corporate', state);

  await page.goto('/hr');
  await page.getByTestId('challenge-row-chl-1').click();
  const detail = page.getByTestId('challenge-detail');
  await expect(detail).toContainText('Shown once 3 or more take part');
  await expect(detail).not.toContainText('100%');
  await expect(page.getByTestId('department-table')).toContainText('Finance');
  // The page no longer claims individual activity is never shown anywhere.
  await expect(detail).toContainText('Each person’s progress is under Insights');
});

test('admin hands out a reward: approve, then mark issued with a reference', async ({ page }) => {
  const state = { challenges: [challenge()], summary: fullSummary, awards: [award()], calls: [] as Call[] };
  await setup(page, ADMIN, 'admin', state);

  await page.goto('/admin/rewards');
  await expect(page.getByTestId('reward-table')).toContainText('Asha Juma');
  await expect(page.getByTestId('reward-table')).toContainText('Finished');

  await page.getByTestId('reward-approve').click();
  await page.getByTestId('reward-step-save').click();
  await expect.poll(() => state.awards[0].status).toBe('approved');

  await page.getByTestId('reward-tab-approved').click();
  await page.getByTestId('reward-issue').click();
  await page.getByTestId('reward-reference').fill('PASS-7D-0192');
  await page.getByTestId('reward-note').fill('Sent by SMS');
  await page.getByTestId('reward-step-save').click();
  await expect.poll(() => state.awards[0].status).toBe('issued');
  expect(state.calls.at(-1)).toMatchObject({ path: '/admin/rewards/rwa-1/status', body: { status: 'issued', reference: 'PASS-7D-0192', note: 'Sent by SMS' } });

  await page.getByTestId('reward-tab-issued').click();
  await expect(page.getByTestId('reward-table')).toContainText('PASS-7D-0192');
});

test('rejecting a reward needs a reason, and company HR uses its own queue', async ({ page }) => {
  const state = { challenges: [], summary: fullSummary, awards: [award({ funder: 'company', member: { id: 'm-2', displayName: 'Asha Kweka', department: 'Finance' } })], calls: [] as Call[] };
  await setup(page, HR, 'corporate', state);

  await page.goto('/hr/rewards');
  const table = page.getByTestId('reward-table');
  await expect(table).toContainText('Asha Kweka');
  await expect(table).toContainText('Finance');

  await table.getByRole('button', { name: 'Reject' }).click();
  await page.getByTestId('reward-note').fill('Leave days are paused this month');
  await page.getByTestId('reward-step-save').click();
  await expect.poll(() => state.awards[0].status).toBe('rejected');
  expect(state.calls.at(-1)).toMatchObject({ path: '/corporate/rewards/rwa-1/status', body: { status: 'rejected', note: 'Leave days are paused this month' } });

  await page.getByTestId('reward-tab-rejected').click();
  await expect(page.getByTestId('reward-table')).toContainText('Leave days are paused this month');
});
