import { expect, test } from '@playwright/test';

test('portal exposes install metadata without enabling offline caching in development', async ({ page, request }) => {
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();

  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    name: 'FitFlex Af Operator Portal',
    short_name: 'FitFlex Portal',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#0f172a',
    background_color: '#ffffff',
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }),
      expect.objectContaining({ src: '/icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
    ]),
  );

  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');

  const registrationCount = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 0;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return (await navigator.serviceWorker.getRegistrations()).length;
  });
  expect(registrationCount).toBe(0);

  const workerResponse = await request.get('/sw.js');
  expect(workerResponse.ok()).toBeTruthy();
  const workerSource = await workerResponse.text();
  expect(workerSource).toContain("url.pathname.startsWith('/_next/')");
});

test('restores a saved session without a hydration mismatch', async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Hydration failed')) {
      hydrationErrors.push(message.text());
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem('token', 'saved-session-token');
    localStorage.setItem('user', JSON.stringify({ id: 'admin-1', userType: 'admin' }));
  });
  await page.goto('/admin');
  await expect(page.getByRole('complementary').getByText('Pilot Console')).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});
