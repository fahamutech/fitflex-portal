import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'owner-e2e-token');
    localStorage.setItem('user', JSON.stringify({ id: 'owner-1', userType: 'gym_operator', email: 'owner@example.com' }));
    localStorage.setItem('locale', 'en');
  });
});

test('owner web portal manages members, gym, staff, trainers and access', async ({ page }) => {
  const createdMembers: any[] = [];
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/owner/gyms' && request.method() === 'GET') return route.fulfill({ json: [{ id: 'gym-1', name: 'Mikocheni Fitness', location: 'Mikocheni', tier: 'standard', status: 'active', perVisitRate: 5000, commissionRate: 10 }] });
    if (url.pathname === '/owner/members' && request.method() === 'GET') return route.fulfill({ json: { members: [{ id: 'member-1', displayName: 'Existing Member', status: 'active' }], stats: { totalMembers: 1, activeMembers: 1 } } });
    if (url.pathname === '/owner/members' && request.method() === 'POST') { createdMembers.push(request.postDataJSON()); return route.fulfill({ status: 201, json: { member: { id: `member-${createdMembers.length}` }, subscription: {} } }); }
    if (url.pathname === '/owner/staff' && request.method() === 'GET') return route.fulfill({ json: [{ id: 'staff-1', displayName: 'Reception One' }] });
    if (url.pathname === '/owner/trainers/pending') return route.fulfill({ json: [{ id: 'trainer-pending', displayName: 'Pending Trainer', gymIds: [], specialties: [], hourlyRateTzs: 0, status: 'active' }] });
    if (url.pathname === '/owner/trainers') return route.fulfill({ json: [{ id: 'trainer-1', displayName: 'Verified Trainer', verified: true, gymIds: ['gym-1'], specialties: [], hourlyRateTzs: 10000, status: 'active' }] });
    if (url.pathname.startsWith('/owner/trainers/') && url.pathname.endsWith('/decision')) return route.fulfill({ json: { id: 'trainer-pending' } });
    if (url.pathname.startsWith('/owner/gyms/') && request.method() === 'PUT') return route.fulfill({ json: request.postDataJSON() });
    if (url.pathname === '/owner/staff' && request.method() === 'POST') return route.fulfill({ status: 201, json: { id: 'staff-2', ...request.postDataJSON() } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/owner/manage');
  await expect(page.getByRole('heading', { name: 'Gym management' })).toBeVisible();
  await expect(page.getByText('Existing Member')).toBeVisible();
  await expect(page.getByText('Reception One')).toBeVisible();
  await expect(page.getByText('Verified Trainer')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review check-ins' })).toHaveAttribute('href', /\/checkins\/?$/);
  await expect(page.getByRole('link', { name: 'Scan QR' })).toHaveAttribute('href', /\/scan\/?$/);

  await page.getByLabel('Owner member name').fill('Amina Said');
  await page.getByLabel('Owner member email').fill('amina@example.com');
  await page.getByLabel('Owner member PIN').fill('2468');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect.poll(() => createdMembers.length).toBe(1);
  expect(createdMembers[0]).toMatchObject({ displayName: 'Amina Said', initialPassword: '2468', durationUnit: 'M', gymId: 'gym-1' });

  await page.getByLabel('Bulk members CSV').fill('Bulk One,bulk1@example.com,0711000000,1357,W\nBulk Two,bulk2@example.com,0711000001,8642,D');
  await page.getByRole('button', { name: 'Bulk add' }).click();
  await expect.poll(() => createdMembers.length).toBe(3);
  expect(createdMembers.slice(1).map(m => m.initialPassword)).toEqual(['1357', '8642']);
});
