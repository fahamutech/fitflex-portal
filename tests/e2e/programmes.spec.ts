// Programmes P1, slice PO1: staff list, write, publish, retire and re-version FitFlex programmes, and add
// picture/clip links to exercises. The API is faked in the browser (docs: fitflex-functions docs/programmes-api.md).
import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Json = Record<string, unknown>;
type Call = { method: string; path: string; body: Json | null };
type State = { programmes: Json[]; calls: Call[]; catalogueOn?: boolean; publishFail?: Json; exercises?: Json[] };

const ADMIN = { id: 'admin-1', userType: 'admin', email: 'admin@example.com', displayName: 'Local Admin' };

const exercise = (over: Json = {}) => ({
  id: 'ex_bodyweight_squat', name: 'Bodyweight Squat', description: '', category: 'strength',
  targetAreas: ['quadriceps'], secondaryAreas: [], difficulty: 'beginner', equipment: ['none'], environment: ['home', 'gym'],
  suitableGoals: ['stay_fit'], defaultSets: 3, defaultReps: 12, restSeconds: 60, instructions: ['Stand tall.'],
  alternatives: [], active: true, source: 'builtin', ...over,
});
const OPTIONS = {
  categories: ['strength'], targetAreaGroups: [{ id: 'lower_body', areas: ['quadriceps'] }], movementPatterns: [],
  difficulties: ['beginner'], equipment: ['none'], environments: ['gym', 'home'], goals: ['stay_fit'],
};
const workout = { name: 'Legs at home', activityType: 'strength', estimatedDuration: 20, exercises: [{ exerciseName: 'Bodyweight Squat', libraryId: 'ex_bodyweight_squat', sets: 3, reps: 12 }] };
const days = (types: string[]) => types.map((type, i) => (type === 'home' ? { day: i + 1, type, workout } : { day: i + 1, type }));
const programme = (over: Json = {}) => ({
  id: 'prg_live', title: '7-day home starter', summary: 'Build the habit.', i18n: { sw: { title: '[SW] 7-day home starter', summary: '[SW] Build the habit.' } },
  goal: 'stay_fit', level: 'beginner', environment: 'home', equipment: ['none'], lengthDays: 7,
  days: days(['home', 'rest', 'gym', 'home', 'rest', 'gym', 'home']), status: 'live', enrolled: 4, updatedAt: '2026-11-18T08:00:00.000Z', ...over,
});

async function setup(page: Page, state: State) {
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, ADMIN);
  page.on('dialog', d => void d.accept());
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const body = method === 'GET' ? null : (req.postDataJSON() as Json | null);
    if (method !== 'GET') state.calls.push({ method, path, body });
    const find = (id: string) => state.programmes.find(p => p.id === id);

    if (path === '/admin/exercises' && method === 'GET') return route.fulfill({ json: { exercises: state.exercises ?? [exercise()], options: OPTIONS } });
    const ex = path.match(/^\/admin\/exercises\/([^/]+)$/);
    if (ex && method === 'PUT') {
      const e = (state.exercises ?? []).find(x => x.id === ex[1])!;
      Object.assign(e, body);
      return route.fulfill({ json: { exercise: e } });
    }
    if (path === '/admin/programmes' && method === 'GET') return route.fulfill({ json: { programmes: state.programmes, catalogueOn: state.catalogueOn ?? false } });
    if (path === '/admin/programmes' && method === 'POST') {
      const created = { ...body, id: 'prg_new', status: 'draft', enrolled: 0, updatedAt: '2026-11-20T08:00:00.000Z' };
      state.programmes.unshift(created);
      return route.fulfill({ status: 201, json: { programme: created } });
    }
    const m = path.match(/^\/admin\/programmes\/([^/]+)(\/\w+)?$/);
    if (m) {
      const p = find(m[1]);
      if (!p) return route.fulfill({ status: 404, json: { error: 'not_found' } });
      if (!m[2] && method === 'GET') return route.fulfill({ json: { programme: p, catalogueOn: state.catalogueOn ?? false } });
      if (!m[2] && method === 'PUT') { Object.assign(p, body); return route.fulfill({ json: { programme: p } }); }
      if (m[2] === '/publish') {
        if (state.publishFail) return route.fulfill({ status: 400, json: state.publishFail });
        p.status = 'live';
        return route.fulfill({ json: { programme: p } });
      }
      if (m[2] === '/retire') { p.status = 'retired'; return route.fulfill({ json: { programme: p } }); }
      if (m[2] === '/duplicate') {
        const copy = { ...structuredClone(p), id: 'prg_v2', status: 'draft', versionOf: p.id, enrolled: 0 };
        state.programmes.unshift(copy);
        return route.fulfill({ status: 201, json: { programme: copy } });
      }
    }
    return route.fulfill({ json: [] });
  });
}

test('the list shows each programme, filters by status, and says when members cannot see them yet', async ({ page }) => {
  const state: State = {
    programmes: [programme(), programme({ id: 'prg_draft', title: '21-day cardio builder', status: 'draft', lengthDays: 21, environment: 'any', enrolled: 0 })],
    calls: [],
  };
  await setup(page, state);
  await page.goto('/admin/programmes');

  await expect(page.getByTestId('programme-flag-off')).toBeVisible();
  const live = page.getByTestId('programme-row-prg_live');
  await expect(live).toContainText('7-day home starter');
  await expect(live).toContainText('Stay fit');
  await expect(live).toContainText('7 days');
  await expect(live).toContainText('Live');
  await expect(live).toContainText('4');
  await expect(page.getByTestId('programme-row-prg_draft')).toContainText('Anywhere');

  await page.getByTestId('programme-status-filter').selectOption('draft');
  await expect(page.getByTestId('programme-row-prg_live')).toHaveCount(0);
  await expect(page.getByTestId('programme-row-prg_draft')).toBeVisible();
});

test('with the member flag on there is no notice; with no programmes there is an empty state', async ({ page }) => {
  await setup(page, { programmes: [], calls: [], catalogueOn: true });
  await page.goto('/admin/programmes');
  await expect(page.getByText('No programmes yet')).toBeVisible();
  await expect(page.getByTestId('programme-flag-off')).toHaveCount(0);
});

test('an admin writes a draft day by day, adds the Swahili, then publishes it', async ({ page }) => {
  const state: State = { programmes: [], calls: [] };
  await setup(page, state);
  await page.goto('/admin/programmes');
  await page.getByTestId('programme-new').click();

  await page.getByTestId('programme-title').fill('7-day home starter');
  await page.getByTestId('programme-summary').fill('Build the habit.');
  await expect(page.getByTestId('programme-checks')).toContainText('Make at least one day a gym or home day.');
  await expect(page.getByTestId('programme-publish')).toBeDisabled();

  // Day 1: a home day with a workout.
  await page.getByTestId('programme-day-1').click();
  await page.getByTestId('programme-day-type-home').check();
  await page.getByTestId('programme-day-done').click();
  await expect(page.getByTestId('programme-workout-problem')).toBeVisible();
  await page.getByTestId('programme-workout-name').fill('Legs at home');
  await page.getByTestId('programme-ex-add').click();
  await expect(page.getByTestId('programme-ex-0-pick')).toHaveValue('ex_bodyweight_squat');
  await page.getByTestId('programme-ex-0-sets').fill('4');
  await page.getByTestId('programme-day-copy').click();
  // Pasted to day 4, then pasting is finished.
  await expect(page.getByTestId('programme-paste-bar')).toBeVisible();
  await page.getByTestId('programme-day-4').click();
  await page.getByTestId('programme-paste-done').click();
  await expect(page.getByTestId('programme-day-4')).toHaveAttribute('data-type', 'home');
  await expect(page.getByTestId('programme-day-4')).toContainText('Legs at home');

  // Day 3: a gym day, chosen with the keyboard (Space cycles gym → home → rest from rest).
  await page.getByTestId('programme-day-3').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('programme-day-3')).toHaveAttribute('data-type', 'gym');
  await expect(page.getByTestId('programme-day-3')).toHaveAttribute('aria-label', 'Day 3, Gym');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('programme-day-4')).toBeFocused();

  await expect(page.getByTestId('programme-checks')).toContainText('Add the Swahili title and summary.');
  await page.getByTestId('programme-save').click();
  await expect(page).toHaveURL(/\?id=prg_new$/);
  const created = state.calls.find(c => c.method === 'POST' && c.path === '/admin/programmes')!.body!;
  expect(created.title).toBe('7-day home starter');
  expect(created.i18n).toBeNull();
  expect((created.days as Json[]).map(d => d.type)).toEqual(['home', 'rest', 'gym', 'home', 'rest', 'rest', 'rest']);
  expect(((created.days as Json[])[0].workout as Json).exercises).toEqual([
    { exerciseName: 'Bodyweight Squat', libraryId: 'ex_bodyweight_squat', sets: 4, reps: 12, duration: null, tracksWeight: false },
  ]);
  expect((created.days as Json[])[2]).toEqual({ day: 3, type: 'gym' });

  await expect(page.getByTestId('programme-status')).toHaveText('Draft');
  await page.getByTestId('programme-sw-title').fill('[SW] 7-day home starter');
  await page.getByTestId('programme-sw-summary').fill('[SW] Build the habit.');
  await expect(page.getByTestId('programme-publish')).toBeEnabled();
  await page.getByTestId('programme-publish').click();
  await expect(page.getByTestId('programme-done')).toHaveText('Published.');
  await expect(page.getByTestId('programme-status')).toHaveText('Live');
  const put = state.calls.find(c => c.method === 'PUT')!;
  expect(put.body!.i18n).toEqual({ sw: { title: '[SW] 7-day home starter', summary: '[SW] Build the habit.' } });
  expect(state.calls.map(c => `${c.method} ${c.path}`).slice(-2)).toEqual(['PUT /admin/programmes/prg_new', 'POST /admin/programmes/prg_new/publish']);
  // A live programme can't be edited in place.
  await expect(page.getByTestId('programme-save')).toHaveCount(0);
  await expect(page.getByTestId('programme-title')).toBeDisabled();
});

test('the server saying a programme is not ready is shown in plain words', async ({ page }) => {
  const state: State = {
    programmes: [programme({ id: 'prg_draft', status: 'draft' })], calls: [],
    publishFail: { error: 'not_ready_to_publish', field: 'days[0].workout' },
  };
  await setup(page, state);
  await page.goto('/admin/programmes?id=prg_draft');
  await page.getByTestId('programme-publish').click();
  await expect(page.getByTestId('programme-error')).toHaveText('Not ready to publish: day 1: an exercise is no longer in the library or switched off.');
  await expect(page.getByTestId('programme-status')).toHaveText('Draft');
});

test('a live programme is retired, and changed only through a new draft version', async ({ page }) => {
  const state: State = { programmes: [programme()], calls: [] };
  await setup(page, state);
  await page.goto('/admin/programmes');
  await page.getByTestId('programme-open-prg_live').click();
  await expect(page.getByText('This programme is live, so it can’t be changed.')).toBeVisible();

  await page.getByTestId('programme-retire').click();
  await expect(page.getByTestId('programme-status')).toHaveText('Retired');
  await expect(page.getByTestId('programme-retire')).toHaveCount(0);

  await page.getByTestId('programme-new-version').click();
  await expect(page).toHaveURL(/\?id=prg_v2$/);
  await expect(page.getByTestId('programme-status')).toHaveText('Draft');
  await expect(page.getByTestId('programme-title')).toBeEnabled();
  expect(state.calls.map(c => `${c.method} ${c.path}`)).toEqual(['POST /admin/programmes/prg_live/retire', 'POST /admin/programmes/prg_live/duplicate']);

  await page.getByTestId('programme-back').click();
  await expect(page.getByTestId('programme-row-prg_v2')).toContainText('Draft');
});

test('an exercise gets an image link and a clip link, with a preview', async ({ page }) => {
  const state: State = { programmes: [], calls: [], exercises: [exercise()] };
  await setup(page, state);
  await page.goto('/admin/exercises');
  await page.getByTestId('exercise-open-ex_bodyweight_squat').click();
  await expect(page.getByText('Only add clips FitFlex has the right to use.')).toBeVisible();
  await page.getByTestId('exercise-still-url').fill('https://media.example.test/squat.jpg');
  await page.getByTestId('exercise-clip-url').fill('https://media.example.test/squat.mp4');
  await expect(page.getByTestId('exercise-clip-open')).toHaveAttribute('href', 'https://media.example.test/squat.mp4');
  await expect(page.getByTestId('exercise-media-preview').locator('img')).toHaveAttribute('src', 'https://media.example.test/squat.jpg');
  await page.getByTestId('exercise-save').click();
  await expect(page.getByTestId('exercise-form')).toHaveCount(0);
  const put = state.calls.find(c => c.method === 'PUT')!;
  expect(put.body!.clipUrl).toBe('https://media.example.test/squat.mp4');
  expect(put.body!.stillUrl).toBe('https://media.example.test/squat.jpg');
});
