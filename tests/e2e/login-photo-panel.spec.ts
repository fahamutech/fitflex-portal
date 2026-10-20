import { expect, test, type Browser, type Page } from '@playwright/test';

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

  // Lighter heroes (spec §5 decision 2026-10-20): the photo is clear and only the
  // text block sits on >= 0.86 #020617. The check renders the panel over a
  // pure-white "photo" (the §5.1 worst case) with the text made transparent,
  // then reads the real pixels back, so it measures what the browser composites.
  // alpha = (255 - channel) / (255 - scrim channel), averaged over R, G, B.
  const ZONE = 0.86;
  const TOL = 0.006; // 8-bit rounding of the composite
  const SCRIM = [2, 6, 23];

  type Sample = { x: number; y: number; label: string };

  async function scrimAlphaAt(page: Page, points: Sample[]) {
    await page.addStyleTag({ content: `
      [data-testid="login-photo-panel"] { background: #fff !important; }
      [data-testid="login-photo-panel"] .photo-panel__img { visibility: hidden !important; }
      [data-testid="login-photo-panel"] .photo-panel__content :is(p, span) { color: transparent !important; }
    ` });
    await page.waitForTimeout(50);
    const png = (await page.screenshot({ scale: 'css' })).toString('base64');
    return page.evaluate(async ({ png, points, scrim }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return points.map(p => {
        const [r, g, b] = ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
        const a = ([r, g, b].map((c, i) => (255 - c) / (255 - scrim[i])).reduce((s, v) => s + v, 0)) / 3;
        return { ...p, alpha: Math.round(a * 1000) / 1000 };
      });
    }, { png, points, scrim: SCRIM });
  }

  /** A 5 × 5 grid (corners included, 2px inside) over every text box in the panel. */
  async function textBoxSamples(page: Page): Promise<Sample[]> {
    return page.getByTestId('login-photo-panel').locator('.photo-panel__content > p').evaluateAll(els => {
      const out: { x: number; y: number; label: string }[] = [];
      for (const el of els) {
        if (getComputedStyle(el).display === 'none') continue;
        // Each line box of the text, so a ragged last line is covered as well as the block.
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [el.getBoundingClientRect(), ...Array.from(range.getClientRects())];
        for (const r of rects) {
          if (r.width < 4 || r.height < 4) continue;
          for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
            out.push({ x: r.left + 2 + (r.width - 4) * i / 4, y: r.top + 2 + (r.height - 4) * j / 4, label: `${el.className} ${i},${j}` });
          }
        }
      }
      return out;
    });
  }

  async function openAt(browser: Browser, width: number, height: number, scale: number, locale: 'en' | 'sw') {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, baseURL: test.info().project.use.baseURL });
    const page = await context.newPage();
    await openLogin(page, locale);
    await expect(page.getByTestId('login-photo-panel-text-scrim')).toBeAttached();
    return { context, page };
  }

  // CSS viewports: desktop 1024–1920, plus 200% browser zoom (CSS width halves, DPR doubles)
  // of 1280×800, 1920×1080 and 2560×1440, plus the tablet and phone bands.
  const VIEWPORTS: { name: string; w: number; h: number; dpr: number }[] = [
    { name: 'desktop 1024', w: 1024, h: 768, dpr: 1 },
    { name: 'desktop 1280', w: 1280, h: 800, dpr: 1 },
    { name: 'desktop 1440', w: 1440, h: 900, dpr: 1 },
    { name: 'desktop 1920', w: 1920, h: 1080, dpr: 1 },
    { name: '1280 at 200%', w: 640, h: 400, dpr: 2 },
    { name: '1920 at 200%', w: 960, h: 540, dpr: 2 },
    { name: '2560 at 200%', w: 1280, h: 720, dpr: 2 },
    { name: 'tablet 768', w: 768, h: 1024, dpr: 1 },
    { name: 'phone 390', w: 390, h: 844, dpr: 3 },
    { name: 'phone 320', w: 320, h: 640, dpr: 2 },
  ];

  for (const vp of VIEWPORTS) {
    for (const locale of ['en', 'sw'] as const) {
      test(`scrim >= 0.86 under all panel text, photo clear above it: ${vp.name} (${locale})`, async ({ browser }) => {
        const { context, page } = await openAt(browser, vp.w, vp.h, vp.dpr, locale);
        try {
          const panel = (await page.getByTestId('login-photo-panel').boundingBox())!;
          const text = await textBoxSamples(page);
          expect(text.length).toBeGreaterThan(0);
          const eyebrow = (await page.getByTestId('login-photo-panel').locator('.photo-panel__eyebrow').boundingBox())!;
          const content = (await page.getByTestId('login-photo-panel-content').boundingBox())!;

          // Every text box sits inside the panel (nothing escapes the dark zone by overflowing).
          for (const p of text) {
            expect(p.x).toBeGreaterThanOrEqual(panel.x);
            expect(p.x).toBeLessThanOrEqual(panel.x + panel.width);
          }

          const extra: Sample[] = [];
          // Clear photo more than 48px above the first text line (where the panel has room).
          const clearY = eyebrow.y - 48 - 4;
          if (clearY > panel.y + 1) {
            for (const fx of [0.05, 0.5, 0.95]) extra.push({ x: panel.x + panel.width * fx, y: clearY, label: `clear ${fx}` });
          }
          const wide = vp.w >= 1024;
          if (wide) {
            // Upper half of the desktop panel is photo only.
            for (const fx of [0.1, 0.5, 0.9]) extra.push({ x: panel.x + panel.width * fx, y: panel.y + panel.height * 0.2, label: `top ${fx}` });
            // The zone runs 24px past the text column, then eases to <= 0.15 at the far edge.
            extra.push({ x: content.x + content.width + 22, y: panel.y + panel.height - 8, label: 'past text +22' });
            extra.push({ x: panel.x + panel.width - 2, y: panel.y + panel.height - 8, label: 'far edge' });
          }

          const samples = await scrimAlphaAt(page, [...text, ...extra]);
          const under = samples.filter(s => !s.label.startsWith('clear') && !s.label.startsWith('top') && s.label !== 'far edge');
          const failing = under.filter(s => s.alpha < ZONE - TOL);
          expect(failing, `points under text below ${ZONE}`).toEqual([]);
          for (const s of samples.filter(s => s.label.startsWith('clear') || s.label.startsWith('top'))) {
            expect(s.alpha, s.label).toBeLessThanOrEqual(0.02);
          }
          const far = samples.find(s => s.label === 'far edge');
          if (far) {
            expect(far.alpha).toBeLessThanOrEqual(0.15 + TOL);
            expect(far.alpha).toBeGreaterThan(0.1);
          }
        } finally {
          await context.close();
        }
      });
    }
  }

  test('high contrast keeps the navy ground under the text scrim', async ({ page }) => {
    await page.emulateMedia({ contrast: 'more' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLogin(page);
    const bg = await page.getByTestId('login-photo-panel').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(11, 25, 44)');
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
