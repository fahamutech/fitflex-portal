import { expect, request, test } from '@playwright/test';

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';

function devToken(payload: Record<string, string>) {
  return `dev:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

// A 1x1 red PNG, small enough to embed inline for the file input.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('gym image upload proxies through /storage and shows the returned URL', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const ctx = await request.newContext();
  const adminSession = await ctx.post(`${API}/auth/firebase/session`, {
    data: {
      idToken: devToken({ uid: `fb_admin_upload_${suffix}`, email: 'mama27j@gmail.com', name: 'FitFlex Admin' }),
      requestedRole: 'admin'
    }
  });
  const { token, user } = await adminSession.json();
  expect(token).toBeTruthy();

  await page.goto('/login');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token, user });

  // Stub the backend storage proxy so this test never hits the real Zebra
  // service — it only asserts the portal's upload wiring end to end. The
  // backend normalizes Zebra's response to root-relative `url`/
  // `thumbnailUrl` values (`/storage/<cid>/<filename>`), which the portal
  // then resolves against its API base URL.
  const relativeUrl = `/storage/QmTest${suffix}/photo.webp`;
  const relativeThumbnailUrl = `/storage/QmTest${suffix}-thumb/photo-thumb.webp`;
  const expectedThumbnailUrl = `${API}${relativeThumbnailUrl}`;
  await page.route(`${API}/storage/upload`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cid: `QmTest${suffix}`, filename: 'photo.webp', url: relativeUrl,
        thumbnailCid: `QmTest${suffix}-thumb`, thumbnailFilename: 'photo-thumb.webp', thumbnailUrl: relativeThumbnailUrl
      })
    });
  });

  await page.goto('/admin');
  await page.getByRole('link', { name: 'Gyms' }).first().click();
  await page.getByRole('button', { name: 'Create gym' }).click();
  await expect(page.getByRole('heading', { name: /Create gym/ })).toBeVisible();

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG_1X1 });

  const preview = page.locator('img[alt="Upload 1"]');
  await expect(preview).toBeVisible({ timeout: 10_000 });
  await expect(preview).toHaveAttribute('src', expectedThumbnailUrl);
});

test('image storage upload rejects non-image files', async ({ request: apiRequest }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const adminSession = await apiRequest.post(`${API}/auth/firebase/session`, {
    data: {
      idToken: devToken({ uid: `fb_admin_upload_reject_${suffix}`, email: 'mama27j@gmail.com', name: 'FitFlex Admin' }),
      requestedRole: 'admin'
    }
  });
  const { token } = await adminSession.json();
  expect(token).toBeTruthy();

  const res = await apiRequest.post(`${API}/storage/upload`, {
    headers: { authorization: `Bearer ${token}` },
    multipart: { file: { name: 'doc.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') } }
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('unsupported_file_type');
});
