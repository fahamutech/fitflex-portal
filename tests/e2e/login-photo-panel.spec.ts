import { expect, test, type Page } from '@playwright/test';

// Photo hero login (design spec photo-hero-screens §12, AC-C1..C7, AC-F2).
// NEXT_PUBLIC_PHOTO_HERO_UI is inlined when the portal is built, so the flag
// state is the one the portal under test was started with. Run this file
// twice to cover both states:
//   npx playwright test login-photo-panel                                 (flag off)
//   NEXT_PUBLIC_PHOTO_HERO_UI=true npx playwright test login-photo-panel  (flag on)
// (each against a fresh `next dev`, since a reused server keeps its env).
// The FitFlex API is mocked; nothing signs in.

const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
const FLAG_ON = process.env.NEXT_PUBLIC_PHOTO_HERO_UI === 'true';

async function openLogin(page: Page, locale: 'en' | 'sw' = 'en') {
  await page.route(`${API}/**`, route => route.fulfill({ status: 404, json: { error: 'not_found' } }));
  await page.addInitScript(l => localStorage.setItem('locale', l), locale);
  await page.goto('/login');
  await expect(page.getByTestId('google-submit')).toBeVisible();
}

test('the login page has one h1 and no "FF" text square', async ({ page }) => {
  await openLogin(page);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to FitFlex for partners' })).toBeVisible();
  await expect(page.getByText('FF', { exact: true })).toHaveCount(0);
});

test.describe('flag off', () => {
  test.skip(FLAG_ON, 'portal under test was built with NEXT_PUBLIC_PHOTO_HERO_UI=true');

  test('login is unchanged: no photo panel, no hero photo requested', async ({ page }) => {
    const photoRequests: string[] = [];
    page.on('request', r => { if (r.url().includes('/photos/hero/')) photoRequests.push(r.url()); });
    await openLogin(page);
    await expect(page.getByTestId('login-photo-layout')).toHaveCount(0);
    await expect(page.getByTestId('login-photo-panel')).toHaveCount(0);
    await expect(page.getByText('Run it all from')).toHaveCount(0);
    expect(photoRequests).toEqual([]);
  });
});

test.describe('flag on', () => {
  test.skip(!FLAG_ON, 'portal under test was built without NEXT_PUBLIC_PHOTO_HERO_UI=true');

  test('desktop 1280: panel left ~55%, card right, panel text in a labelled section', async ({ page }) => {
    const portalOrigin = new URL(test.info().project.use.baseURL!).origin;
    const otherHosts: string[] = [];
    page.on('request', r => {
      if (r.resourceType() === 'image' && !r.url().startsWith('data:') && new URL(r.url()).origin !== portalOrigin) otherHosts.push(r.url());
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLogin(page);

    const panel = page.getByTestId('login-photo-panel');
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBe(0);
    expect(Math.round(box.width)).toBe(Math.round(1280 * 0.55));

    // Section named by its headline; the page's only h1 stays in the card.
    const section = page.getByRole('region', { name: 'Run it all from one place.' });
    await expect(section).toBeVisible();
    await expect(section.getByText('FITFLEX PORTAL', { exact: true })).toBeVisible();
    await expect(section.getByText('Check-ins, members, statements and programmes for FitFlex partners and companies.')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByText(/Dar es Salaam/i)).toHaveCount(0);

    // Decorative photo: empty alt, presentation role, the 3:4 panel crop.
    const img = page.getByTestId('login-photo-panel-img');
    await expect(img).toHaveAttribute('alt', '');
    await expect(img).toHaveAttribute('role', 'presentation');
    await expect(img).toHaveAttribute('data-loaded', 'true');
    expect(await img.evaluate((el: HTMLImageElement) => el.currentSrc)).toMatch(/\/photos\/hero\/login-panel\.(avif|webp|jpg)$/);
    expect(otherHosts).toEqual([]);

    // The card sits right of the panel.
    const cardBox = (await page.getByTestId('google-submit').boundingBox())!;
    expect(cardBox.x).toBeGreaterThan(box.width);
  });

  test('Tab never stops in the panel', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLogin(page);
    const panel = page.getByTestId('login-photo-panel');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inPanel = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="login-photo-panel"]'));
      expect(inPanel).toBe(false);
    }
    await expect(panel.locator('a, button, input, select, textarea, [tabindex]')).toHaveCount(0);
  });

  test('tablet 768: 220px band above the card with the band crop', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openLogin(page);
    const box = (await page.getByTestId('login-photo-panel').boundingBox())!;
    expect(box.width).toBe(768);
    expect(Math.round(box.height)).toBe(220);
    await expect(page.getByText('Check-ins, members, statements and programmes for FitFlex partners and companies.')).toBeVisible();
    await expect(page.getByTestId('login-photo-panel-img')).toHaveAttribute('data-loaded', 'true');
    expect(await page.getByTestId('login-photo-panel-img').evaluate((el: HTMLImageElement) => el.currentSrc)).toMatch(/login-band\.(avif|webp|jpg)$/);
    const cardBox = (await page.getByTestId('google-submit').boundingBox())!;
    expect(cardBox.y).toBeGreaterThan(box.y + box.height);
  });

  test('phone 375: 160px band with eyebrow and headline only', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openLogin(page);
    const box = (await page.getByTestId('login-photo-panel').boundingBox())!;
    expect(Math.round(box.height)).toBe(160);
    await expect(page.getByText('FITFLEX PORTAL', { exact: true })).toBeVisible();
    await expect(page.getByText('one place.', { exact: true })).toBeVisible();
    await expect(page.getByText('Check-ins, members, statements and programmes for FitFlex partners and companies.')).toBeHidden();
  });

  test('Swahili panel copy', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLogin(page, 'sw');
    await expect(page.getByRole('region', { name: 'Simamia kila kitu mahali pamoja.' })).toBeVisible();
    await expect(page.getByText('PORTAL YA FITFLEX', { exact: true })).toBeVisible();
  });

  test('high contrast: navy ground, same text, no hero photo requested', async ({ page }) => {
    const photoRequests: string[] = [];
    page.on('request', r => { if (r.url().includes('/photos/hero/')) photoRequests.push(r.url()); });
    await page.emulateMedia({ contrast: 'more' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLogin(page);
    await expect(page.getByRole('region', { name: 'Run it all from one place.' })).toBeVisible();
    await expect(page.getByTestId('login-photo-panel-img')).toBeHidden();
    expect(photoRequests).toEqual([]);
  });

  test('the email step still works inside the card', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLogin(page);
    await page.getByTestId('email-method-btn').click();
    await expect(page.getByTestId('email-input')).toBeVisible();
    await expect(page.getByTestId('password-input')).toBeVisible();
    await expect(page.getByTestId('login-photo-panel')).toBeVisible();
  });
});
