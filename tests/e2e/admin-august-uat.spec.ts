import { expect, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'admin-august-uat-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin', email: 'admin@example.com' }));
    localStorage.setItem('locale', 'en');
  });
});

test('admin can manage an independent trainer with multiple photos and midnight availability', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  let uploadNumber = 0;
  const trainer = {
    id: 'trainer-independent',
    displayName: 'Independent Trainer',
    email: 'independent@example.com',
    photoUrl: 'https://images.example.com/trainer-1.webp',
    images: [
      'https://images.example.com/trainer-1.webp',
      'https://images.example.com/trainer-2.webp',
    ],
    imageThumbnails: [],
    specialties: ['Yoga'],
    hourlyRateTzs: 25000,
    sessionRateCurrency: 'TZS',
    gymIds: [],
    status: 'active',
    availability: [],
  };

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/admin/trainers' && request.method() === 'GET') return route.fulfill({ json: [trainer] });
    if (url.pathname === '/admin/trainers' && request.method() === 'POST') {
      saved.push(request.postDataJSON());
      return route.fulfill({ json: { ...trainer, ...request.postDataJSON() } });
    }
    if (url.pathname === '/storage/upload') {
      uploadNumber += 1;
      return route.fulfill({ json: {
        url: `/storage/trainer-${uploadNumber}.webp`,
        thumbnailUrl: `/storage/trainer-${uploadNumber}-thumb.webp`,
      } });
    }
    if (url.pathname === '/admin/gyms') return route.fulfill({ json: [] });
    if (url.pathname === '/admin/gym-owners') return route.fulfill({ json: [] });
    if (url.pathname === '/admin/settings/specialties') return route.fulfill({ json: ['Yoga'] });
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/trainers');
  await page.getByText('Independent Trainer').first().click();
  await expect(page.getByRole('heading', { name: 'Edit trainer' })).toBeVisible();

  await expect(page.locator('img[alt="Upload 1"]')).toBeVisible();
  await expect(page.locator('img[alt="Upload 2"]')).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveAttribute('multiple', '');
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'portfolio-one.png', mimeType: 'image/png', buffer: PNG_1X1 },
    { name: 'portfolio-two.png', mimeType: 'image/png', buffer: PNG_1X1 },
  ]);
  await expect(page.locator('img[alt="Upload 4"]')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Add slot' }).click();
  await expect(page.getByRole('button', { name: '22:00' })).toBeVisible();
  await expect(page.getByRole('button', { name: '23:00' })).toBeVisible();
  await expect(page.getByRole('button', { name: '00:00' })).toBeVisible();

  await page.getByRole('button', { name: 'Update' }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ gymIds: [] });
  expect((saved[0].images as string[])).toHaveLength(4);
  expect(saved[0].images).toEqual(expect.arrayContaining(trainer.images));
});

test('admin can edit an email member without adding a phone number', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  const member = {
    id: 'member-email-only',
    displayName: 'Email Member',
    email: 'member@example.com',
    phone: null,
    accountStatus: 'active',
    memberProfile: {},
  };

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/admin/members' && request.method() === 'GET') return route.fulfill({ json: [member] });
    if (url.pathname === '/admin/members' && request.method() === 'POST') {
      saved.push(request.postDataJSON());
      return route.fulfill({ json: { ...member, ...request.postDataJSON() } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/members');
  await page.getByTitle('Edit member').click();
  await page.getByRole('dialog').locator('input.ui-input').first().fill('Email Member Updated');
  await page.getByRole('button', { name: 'Update' }).click();

  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ id: member.id, email: member.email, phone: null });
});

test('admin can delete an unused gym from the portal', async ({ page }) => {
  let deleted = false;
  let gyms = [{
    id: 'gym-delete-proof',
    name: 'Delete Proof Gym',
    tier: 'standard',
    location: 'Dar es Salaam',
    venueType: 'physical',
    accessMode: 'paid_visit',
    status: 'active',
    verified: false,
    images: [],
    thumbnails: [],
    amenities: [],
    equipment: [],
  }];

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/admin/gyms' && request.method() === 'GET') {
      return route.fulfill({ json: gyms });
    }
    if (url.pathname === '/gyms/gym-delete-proof' && request.method() === 'GET') {
      return route.fulfill({ json: gyms[0] });
    }
    if (url.pathname === '/admin/gyms/gym-delete-proof' && request.method() === 'DELETE') {
      deleted = true;
      const gym = gyms[0];
      gyms = [];
      return route.fulfill({ json: { ok: true, gym } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/admin/gyms');
  await page.getByText('Delete Proof Gym', { exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Delete Proof Gym', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delete gym' })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();

  await expect.poll(() => deleted).toBe(true);
  await expect(page.getByText('Delete Proof Gym', { exact: true })).toHaveCount(0);
});
