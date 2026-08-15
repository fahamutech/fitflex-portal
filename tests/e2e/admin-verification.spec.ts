import { expect, test } from '@playwright/test';

const API = 'http://localhost:3000';

test('admin can review prior gym details and explicitly verify gyms and trainers', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
  });
  await page.route(`${API}/**`, async route => {
    const url = new URL(route.request().url());
    const gym = { id: 'gym-1', name: 'Mikocheni Fitness', location: 'Mikocheni', tier: 'standard', status: 'active', perVisitRate: 5000, ratePerDay: 5000, ratePerWeek: 30000, ratePerMonth: 100000, commissionRate: 10, verified: false, coordinates: { lat: -6.8, lng: 39.2 }, images: ['data:image/png;base64,iVBORw0KGgo='], amenities: ['Showers'], equipment: ['Treadmill'] };
    const trainer = { id: 'trainer-1', displayName: 'Amina Trainer', email: 'trainer@example.com', specialties: ['Yoga'], hourlyRateTzs: 10000, gymIds: ['gym-1'], status: 'active', verified: false, availability: [] };
    if (url.pathname === '/admin/gyms') return route.fulfill({ json: [gym] });
    if (url.pathname === '/gyms/gym-1') return route.fulfill({ json: gym });
    if (url.pathname === '/admin/gym-owners') return route.fulfill({ json: [{ id: 'owner-1', displayName: 'Owner', gymIds: ['gym-1'] }] });
    if (url.pathname === '/admin/trainers') return route.fulfill({ json: url.searchParams.get('refs') === 'true' ? [{ id: trainer.id, displayName: trainer.displayName, gymIds: trainer.gymIds }] : [trainer] });
    if (url.pathname === '/admin/settings/specialties') return route.fulfill({ json: ['Yoga'] });
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/gyms');
  await page.getByTitle('Edit gym').click();
  await expect(page.getByLabel('Verified gym')).toBeVisible();
  await page.getByRole('button', { name: /Edit Amenities/ }).click();
  await expect(page.getByText('Previously saved verification details')).toBeVisible();
  await expect(page.getByText('Showers')).toBeVisible();
  await expect(page.getByText('Treadmill', { exact: true })).toBeVisible();

  await page.goto('/admin/trainers');
  await page.getByText('Amina Trainer').click();
  await expect(page.getByLabel('Verified trainer')).toBeVisible();
});
