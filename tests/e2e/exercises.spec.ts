import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

type Json = Record<string, unknown>;
type Call = { method: string; path: string; body: Json | null };

const exercise = (over: Json = {}) => ({
  id: 'ex_push_up', name: 'Push-up', description: 'A bodyweight press.', category: 'strength',
  targetAreas: ['chest'], secondaryAreas: ['triceps'], movementPattern: 'push', difficulty: 'beginner',
  equipment: ['none'], environment: ['gym', 'home', 'outdoor'], suitableGoals: ['gain_muscle', 'stay_fit'],
  defaultSets: 3, defaultReps: 10, restSeconds: 60, tracksWeight: false,
  instructions: ['Hands under your shoulders.', 'Lower your chest.', 'Press back up.'],
  alternatives: [], active: true, source: 'builtin',
  ...over,
});

const OPTIONS = {
  categories: ['strength', 'cardio', 'hiit', 'functional', 'mobility', 'stretching'],
  targetAreaGroups: [
    { id: 'upper_body', areas: ['chest', 'back', 'shoulders'] },
    { id: 'lower_body', areas: ['glutes', 'quadriceps'] },
    { id: 'core', areas: ['abs'] },
  ],
  movementPatterns: ['push', 'pull', 'squat', 'hinge'],
  difficulties: ['beginner', 'intermediate', 'advanced'],
  equipment: ['none', 'dumbbells', 'machines', 'other'],
  environments: ['gym', 'home', 'outdoor'],
  goals: ['lose_weight', 'gain_muscle', 'stay_fit'],
};

const ADMIN = { id: 'admin-1', userType: 'admin', email: 'admin@example.com', displayName: 'Local Admin' };

/** A signed-in admin and a small fake of the exercise API. */
async function setup(page: Page, state: { exercises: Json[]; calls: Call[]; fail?: Json }) {
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, ADMIN);
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.method() === 'GET' ? null : (req.postDataJSON() as Json | null);
    if (req.method() !== 'GET') state.calls.push({ method: req.method(), path, body });

    if (path === '/admin/exercises' && req.method() === 'GET') {
      return route.fulfill({ json: { exercises: state.exercises, options: OPTIONS } });
    }
    if (req.method() !== 'GET' && state.fail) return route.fulfill({ status: 400, json: state.fail });
    if (path === '/admin/exercises' && req.method() === 'POST') {
      const created = exercise({ ...body, id: 'ex_new', source: 'custom' });
      state.exercises.push(created);
      return route.fulfill({ status: 201, json: { exercise: created } });
    }
    const reset = path.match(/^\/admin\/exercises\/([^/]+)\/reset$/);
    if (reset) {
      const i = state.exercises.findIndex(e => e.id === reset[1]);
      state.exercises[i] = exercise();
      return route.fulfill({ json: { exercise: state.exercises[i] } });
    }
    const one = path.match(/^\/admin\/exercises\/([^/]+)$/);
    if (one && req.method() === 'PUT') {
      const e = state.exercises.find(x => x.id === one[1])!;
      Object.assign(e, body, { source: e.source === 'builtin' ? 'edited' : e.source });
      return route.fulfill({ json: { exercise: e } });
    }
    return route.fulfill({ json: [] });
  });
}

test('the library is listed, searched and filtered', async ({ page }) => {
  const state = {
    exercises: [
      exercise(),
      exercise({ id: 'ex_goblet_squat', name: 'Goblet Squat', targetAreas: ['quadriceps', 'glutes'], equipment: ['dumbbells'], source: 'edited', i18n: { sw: { name: 'Squat ya dumbbell' } } }),
      exercise({ id: 'ex_plank', name: 'Plank', targetAreas: ['abs'], defaultReps: undefined, defaultDuration: 30, active: false, source: 'custom' }),
    ],
    calls: [] as Call[],
  };
  await setup(page, state);
  await page.goto('/admin/exercises');

  await expect(page.getByTestId('exercise-count')).toHaveText('3 of 3 shown · 2 switched on');
  const squat = page.getByTestId('exercise-row-ex_goblet_squat');
  await expect(squat).toContainText('Quadriceps, Glutes');
  await expect(squat).toContainText('Dumbbells');
  await expect(squat).toContainText('Edited');
  await expect(squat).toContainText('Yes');
  await expect(page.getByTestId('exercise-row-ex_plank')).toContainText('3 × 30 s');
  await expect(page.getByTestId('exercise-row-ex_plank')).toContainText('Off');
  await expect(page.getByTestId('exercise-row-ex_plank')).toContainText('Added by FitFlex');

  await page.getByTestId('exercise-search').fill('squat');
  await expect(page.getByTestId('exercise-count')).toHaveText('1 of 3 shown · 2 switched on');
  await page.getByTestId('exercise-search').fill('');
  await page.getByTestId('exercise-area-filter').selectOption('abs');
  await expect(page.getByTestId('exercise-row-ex_plank')).toBeVisible();
  await expect(page.getByTestId('exercise-row-ex_push_up')).toHaveCount(0);
  await page.getByTestId('exercise-area-filter').selectOption('');
  await page.getByTestId('exercise-status-filter').selectOption('off');
  await expect(page.getByTestId('exercise-count')).toHaveText('1 of 3 shown · 2 switched on');
});

test('an admin adds an exercise with Swahili, and it joins the list', async ({ page }) => {
  const state = { exercises: [exercise()], calls: [] as Call[] };
  await setup(page, state);
  await page.goto('/admin/exercises');

  await page.getByTestId('exercise-new').click();
  await page.getByTestId('exercise-name').fill('Kettlebell Swing');
  await page.getByTestId('exercise-description').fill('A hip hinge that swings a kettlebell.');
  await page.getByTestId('exercise-target-glutes').check();
  await page.getByTestId('exercise-equipment-other').check();
  await expect(page.getByTestId('exercise-equipment-none')).not.toBeChecked();
  await page.getByTestId('exercise-goal-gain_muscle').check();
  await page.getByTestId('exercise-sets').fill('4');
  await page.getByTestId('exercise-amount').fill('15');
  await page.getByTestId('exercise-weight').check();
  await page.getByTestId('exercise-instructions').fill('Hinge at the hips.\n\nDrive your hips forward.');
  await page.getByTestId('exercise-alt-ex_push_up').check();
  await page.getByTestId('exercise-sw-name').fill('Kuzungusha kettlebell');
  await page.getByTestId('exercise-sw-instructions').fill('Inama kwenye nyonga.');
  await page.getByTestId('exercise-save').click();

  await expect(page.getByTestId('exercise-row-ex_new')).toContainText('Kettlebell Swing');
  const sent = state.calls.find(c => c.method === 'POST' && c.path === '/admin/exercises')!.body!;
  expect(sent).toMatchObject({
    name: 'Kettlebell Swing', targetAreas: ['glutes'], equipment: ['other'], suitableGoals: ['gain_muscle'],
    defaultSets: 4, defaultReps: 15, defaultDuration: null, tracksWeight: true,
    instructions: ['Hinge at the hips.', 'Drive your hips forward.'],
    alternatives: ['ex_push_up'], active: true,
    i18n: { sw: { name: 'Kuzungusha kettlebell', instructions: ['Inama kwenye nyonga.'] } },
  });
});

test('editing a built-in, making it timed, then putting it back', async ({ page }) => {
  const state = { exercises: [exercise(), exercise({ id: 'ex_plank', name: 'Plank', targetAreas: ['abs'] })], calls: [] as Call[] };
  await setup(page, state);
  page.on('dialog', d => d.accept());
  await page.goto('/admin/exercises');

  await page.getByTestId('exercise-open-ex_push_up').click();
  await expect(page.getByTestId('exercise-form')).toBeVisible();
  await expect(page.getByText('This is a built-in exercise.')).toBeVisible();
  await expect(page.getByTestId('exercise-name')).toHaveValue('Push-up');
  await expect(page.getByTestId('exercise-target-chest')).toBeChecked();
  await expect(page.getByTestId('exercise-reset')).toHaveCount(0);
  await page.getByTestId('exercise-measure').selectOption('timed');
  await page.getByTestId('exercise-amount').fill('40');
  await page.getByTestId('exercise-save').click();

  const put = state.calls.find(c => c.method === 'PUT')!;
  expect(put.path).toBe('/admin/exercises/ex_push_up');
  expect(put.body).toMatchObject({ defaultReps: null, defaultDuration: 40 });
  await expect(page.getByTestId('exercise-row-ex_push_up')).toContainText('Edited');
  await expect(page.getByTestId('exercise-row-ex_push_up')).toContainText('3 × 40 s');

  await page.getByTestId('exercise-open-ex_push_up').click();
  await page.getByTestId('exercise-reset').click();
  await expect.poll(() => state.calls.some(c => c.path === '/admin/exercises/ex_push_up/reset')).toBe(true);
  await expect(page.getByTestId('exercise-row-ex_push_up')).toContainText('Built in');
  await expect(page.getByTestId('exercise-row-ex_push_up')).toContainText('3 × 10');
});

test('switching an exercise off and on from the list', async ({ page }) => {
  const state = { exercises: [exercise(), exercise({ id: 'ex_plank', name: 'Plank', targetAreas: ['abs'] })], calls: [] as Call[] };
  await setup(page, state);
  page.on('dialog', d => d.accept());
  await page.goto('/admin/exercises');

  await page.getByTestId('exercise-toggle-ex_plank').click();
  await expect(page.getByTestId('exercise-row-ex_plank')).toContainText('Off');
  expect(state.calls.at(-1)).toMatchObject({ method: 'PUT', path: '/admin/exercises/ex_plank', body: { active: false } });
  await expect(page.getByTestId('exercise-count')).toHaveText('2 of 2 shown · 1 switched on');
  await expect(page.getByTestId('exercise-toggle-ex_plank')).toHaveText('Switch on');
  await page.getByTestId('exercise-toggle-ex_plank').click();
  await expect(page.getByTestId('exercise-row-ex_plank')).toContainText('On');
  expect(state.calls.at(-1)!.body).toMatchObject({ active: true });
});

test('a refused save says which field is wrong and keeps the form', async ({ page }) => {
  const state = { exercises: [exercise()], calls: [] as Call[], fail: { error: 'invalid_exercise', field: 'targetAreas' } as Json };
  await setup(page, state);
  await page.goto('/admin/exercises');
  await page.getByTestId('exercise-new').click();
  await page.getByTestId('exercise-name').fill('Mystery move');
  await page.getByTestId('exercise-save').click();
  await expect(page.getByText('Choose at least one area it mainly works.')).toBeVisible();
  await expect(page.getByTestId('exercise-name')).toHaveValue('Mystery move');
  await expect(page.getByTestId('exercise-row-ex_new')).toHaveCount(0);
});
