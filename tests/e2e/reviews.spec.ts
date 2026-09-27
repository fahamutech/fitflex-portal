import { expect, test, Page } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

async function signIn(page: Page, user: Record<string, unknown>) {
  await page.addInitScript(u => {
    localStorage.setItem('token', 'reviews-e2e-token');
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('locale', 'en');
  }, user);
}

const gymReview = {
  id: 'grev_1', gymId: 'gym-1', gymName: 'Mikocheni Fitness', memberId: 'usr_1', memberName: 'Aisha Mwakasege',
  rating: 2, text: 'Showers were cold', status: 'published', createdAt: '2026-09-20T08:00:00.000Z',
};
const trainerReview = {
  id: 'trev_1', trainerId: 'trn_1', trainerName: 'Coach Amina', memberId: 'usr_2', memberName: 'Juma Hassan',
  rating: 5, text: 'Great session', status: 'flagged', createdAt: '2026-09-21T08:00:00.000Z',
};

test('admin lists reviews by kind and status, and hides one', async ({ page }) => {
  await signIn(page, { id: 'admin-1', userType: 'admin', email: 'admin@example.com' });
  const requests: string[] = [];
  const moderated: { path: string; body: unknown }[] = [];
  await page.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/moderate')) {
      moderated.push({ path: url.pathname, body: req.postDataJSON() });
      return route.fulfill({ json: { ok: true, reviewId: 'grev_1', status: 'hidden' } });
    }
    if (url.pathname === '/admin/gym-reviews' || url.pathname === '/admin/trainer-reviews') {
      requests.push(`${url.pathname}${url.search}`);
      const status = url.searchParams.get('status');
      const row = url.pathname === '/admin/gym-reviews' ? gymReview : trainerReview;
      const current = moderated.length ? { ...row, status: 'hidden' } : row;
      return route.fulfill({ json: !status || status === current.status ? [current] : [] });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/reviews');
  await expect(page.getByRole('link', { name: 'Reviews' })).toBeVisible();
  const list = page.getByTestId('review-list');
  await expect(list.getByText('Mikocheni Fitness')).toBeVisible();
  await expect(list.getByText('“Showers were cold”')).toBeVisible();
  await expect(list.getByText(/Aisha Mwakasege/)).toBeVisible();
  await expect(list.getByLabel('2 out of 5 stars')).toBeVisible();

  page.once('dialog', d => d.accept());
  await list.getByRole('button', { name: 'Hide' }).click();
  await expect.poll(() => moderated).toEqual([{ path: '/admin/gym-reviews/grev_1/moderate', body: { action: 'hide' } }]);
  await expect(list.getByText('hidden', { exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Restore' })).toBeVisible();

  await page.getByRole('button', { name: 'Trainers' }).click();
  await page.getByRole('tab', { name: 'Flagged' }).click();
  await expect.poll(() => requests.at(-1)).toBe('/admin/trainer-reviews?status=flagged');
});

test('admin reviews page is empty-safe and reports load failures', async ({ page }) => {
  await signIn(page, { id: 'admin-1', userType: 'admin', email: 'admin@example.com' });
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/gym-reviews') return route.fulfill({ status: 500, json: { error: 'boom' } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/admin/reviews');
  await expect(page.getByText('Could not load reviews.')).toBeVisible();
  await page.getByRole('button', { name: 'Trainers' }).click();
  await expect(page.getByText('No reviews here.')).toBeVisible();
});

test('portal staff see Reviews in the nav only with the social permission', async ({ page }) => {
  await page.route(`${API}/**`, route => route.fulfill({ json: [] }));
  await signIn(page, { id: 'staff-1', userType: 'admin', portalUser: true, aclPermissions: ['gyms'] });
  await page.goto('/admin/gyms');
  await expect(page.getByRole('link', { name: 'Gyms' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reviews' })).toHaveCount(0);
});

test('owner reads reviews for each of their gyms', async ({ page }) => {
  await signIn(page, { id: 'owner-1', userType: 'gym_operator', email: 'owner@example.com' });
  const asked: string[] = [];
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/owner/gyms') {
      return route.fulfill({ json: [
        { id: 'gym-1', name: 'Mikocheni Fitness', location: 'Mikocheni', tier: 'standard', status: 'active', perVisitRate: 5000, commissionRate: 10 },
        { id: 'gym-2', name: 'Masaki Strength', location: 'Masaki', tier: 'midtier', status: 'active', perVisitRate: 8000, commissionRate: 10 },
      ] });
    }
    if (url.pathname === '/operator/gym-reviews') {
      const gymId = url.searchParams.get('gymId')!;
      asked.push(gymId);
      return route.fulfill({ json: gymId === 'gym-1'
        ? { gymId, summary: { averageRating: 4.5, reviewCount: 2, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 } },
            reviews: [
              { id: 'r1', rating: 5, text: 'Spotless and friendly', memberName: 'Aisha M.', memberPhotoUrl: null, createdAt: '2026-09-20T08:00:00.000Z' },
              { id: 'r2', rating: 4, text: null, memberName: 'Juma', memberPhotoUrl: null, createdAt: '2026-09-19T08:00:00.000Z' },
            ] }
        : { gymId, summary: { averageRating: null, reviewCount: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }, reviews: [] } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/owner/reviews');
  await expect(page.getByRole('link', { name: 'Reviews' })).toBeVisible();
  const summary = page.getByTestId('reviews-summary');
  await expect(summary.getByText('4.5')).toBeVisible();
  await expect(summary.getByText('2 reviews')).toBeVisible();
  await expect(page.getByText('Spotless and friendly')).toBeVisible();
  await expect(page.getByText('Aisha M.')).toBeVisible();

  await page.getByTestId('review-gym-select').selectOption('gym-2');
  await expect(page.getByTestId('reviews-empty')).toHaveText('No reviews yet.');
  await expect(page.getByText('Members can review your gym after checking in.')).toBeVisible();
  expect(asked).toEqual(['gym-1', 'gym-2']);
});
