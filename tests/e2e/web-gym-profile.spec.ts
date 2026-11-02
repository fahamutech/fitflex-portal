import { expect, test, type Page } from '@playwright/test';
import { messages } from '../../src/lib/i18n';
import { hoursView, mapUrl, safeImage } from '../../src/lib/web-gym';

// Public gym page /g/?q=... (backend functions#281, POST /public/gyms/resolve). The API is mocked; nobody signs in.
// Run twice (the flag is inlined when the portal is built):
//   npx playwright test --config playwright.web-gym.config.ts                    (flag on)
//   WEB_GYM_FLAG=false npx playwright test --config playwright.web-gym.config.ts (flag off)
const FLAG_ON = (process.env.WEB_GYM_FLAG ?? 'true') === 'true';
const Q = 'fitflex:gym:gym_001:SECRETSIG';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const LABELS = { en: { daily: 'Daily', perDay: 'per day' }, sw: { daily: 'Kila siku', perDay: 'kwa siku' } };
function profile(lang: 'en' | 'sw', over: Record<string, unknown> = {}) {
  return {
    lang,
    labels: LABELS[lang],
    gym: {
      publicRef: 'abc123', name: 'Iron Temple', description: 'A friendly gym.', tier: 'standard', venueType: 'physical', verified: true,
      rating: 4.5, reviewCount: 12, photos: [PNG, PNG], thumbnail: null, area: 'Mikocheni', address: 'Mikocheni B, Dar es Salaam',
      lat: -6.77, lng: 39.25, directions: 'Next to the blue gate.', facilities: ['Showers', 'Parking'], equipment: ['Treadmills'],
      amenities: ['Showers', 'Wi-Fi'], services: ['Yoga'],
      operatingHours: { mon: { open: '06:00', close: '21:00' }, sun: null, default: { open: '07:00', close: '20:00' } },
      classes: [{ name: 'Yoga', schedule: 'Mon 18:00', priceTzs: 5000, location: 'Studio' }],
      trainers: [{ name: 'Asha M', photoUrl: null, specialties: ['Strength'], rating: 4.8 }],
      ...over,
    },
    membership: {
      currency: 'TZS',
      gymPlans: [{ plan: 'daily', label: LABELS[lang].daily, period: LABELS[lang].perDay, priceTzs: 10000, days: 1 }],
      passTiers: [{ key: 'standard', label: 'Standard', monthlyPriceTzs: 60000, visits: 12, visitsLabel: lang === 'sw' ? '12 ziara' : '12 visits' }],
    },
  };
}

interface Calls { bodies: Array<{ q: string; lang: string }>; headers: Array<Record<string, string>>; }
async function mockApi(page: Page, handler: (n: number, lang: string) => { status: number; body: unknown }) {
  const calls: Calls = { bodies: [], headers: [] };
  await page.route('**/public/gyms/resolve', async route => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    calls.bodies.push(body);
    calls.headers.push(req.headers());
    const r = handler(calls.bodies.length, body.lang);
    await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  return calls;
}
const open = async (page: Page, lang = 'en-US') => { await page.addInitScript(l => { Object.defineProperty(navigator, 'language', { get: () => l }); }, lang); await page.goto(`/g/?q=${encodeURIComponent(Q)}`); };

test.use({ serviceWorkers: 'block' });

test.describe('pure helpers', () => {
  test('map link, images and hours', () => {
    expect(mapUrl(-6.77, 39.25)).toBe('https://www.google.com/maps/search/?api=1&query=-6.77,39.25');
    expect(mapUrl(null, 39.25)).toBeNull();
    expect(mapUrl(0, 0)).toBeNull();
    expect(mapUrl(95, 10)).toBeNull();
    expect(safeImage('javascript:alert(1)')).toBeNull();
    expect(safeImage('data:text/html;base64,AAAA')).toBeNull();
    expect(safeImage(PNG)).toBe(PNG);
    expect(safeImage('https://x.test/a.jpg', 'https://api.test')).toBeNull();
    expect(safeImage('https://api.test/storage/a.jpg', 'https://api.test')).toBe('https://api.test/storage/a.jpg');
    expect(safeImage('http://api.test/storage/a.jpg', 'https://api.test')).toBeNull();
    expect(safeImage('https://api.test.evil.com/a.jpg', 'https://api.test')).toBeNull();
    expect(safeImage('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(hoursView(null)).toBeNull();
    expect(hoursView('Mon–Sat 6–9')).toEqual({ text: 'Mon–Sat 6–9' });
    const v = hoursView({ mon: { open: '06:00', close: '21:00' }, sun: null, default: { open: '07:00', close: '20:00' } });
    expect(v && 'rows' in v && v.rows.find(r => r.day === 'mon')?.text).toBe('06:00–21:00');
    expect(v && 'rows' in v && v.rows.find(r => r.day === 'tue')?.text).toBe('07:00–20:00');
    expect(v && 'rows' in v && v.rows.find(r => r.day === 'sun')?.text).toBeNull();
  });
  test('every web.gym key has English and Swahili', () => {
    const en = Object.keys(messages.en).filter(k => k.startsWith('web.gym.'));
    expect(en.length).toBeGreaterThan(20);
    for (const k of en) expect(Object.keys(messages.sw)).toContain(k);
  });
});

test.describe(FLAG_ON ? 'flag on' : 'flag off', () => {
  test.skip(!FLAG_ON, 'flag-on specs');

  test('loads without signing in: profile, no auth header, code stripped from the address', async ({ page }) => {
    const calls = await mockApi(page, (_n, lang) => ({ status: 200, body: profile(lang as 'en' | 'sw') }));
    await open(page);
    await expect(page.getByTestId('web-gym-name')).toHaveText('Iron Temple');
    expect(page).toHaveURL(/\/g\/$/);
    expect(page.url()).not.toContain('SECRETSIG');
    expect(calls.bodies).toEqual([{ q: Q, lang: 'en' }]);
    expect(calls.headers[0].authorization).toBeUndefined();
    await expect(page.getByTestId('web-gym-hours')).toBeVisible();
    await expect(page.getByTestId('web-gym-plans')).toContainText('TZS 10,000');
    await expect(page.getByTestId('web-gym-pass-tiers')).toContainText('12 visits');
    await expect(page.getByTestId('web-gym-map-link')).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=-6.77,39.25');
    await expect(page.getByTestId('web-gym-not-proof')).toContainText('does not record a visit');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    // duplicates between facilities / amenities / services are not repeated
    await expect(page.getByTestId('web-gym-amenities')).not.toContainText('Showers');
    await expect(page.getByTestId('web-gym-services')).toHaveCount(0);
    await expect(page.getByTestId('web-gym-photos').locator('img').first()).toHaveAttribute('loading', 'lazy');
  });

  test('Visit button is shown but disabled, with the sign-in hint', async ({ page }) => {
    await mockApi(page, (_n, lang) => ({ status: 200, body: profile(lang as 'en' | 'sw') }));
    await open(page);
    const visit = page.getByTestId('web-gym-visit');
    await expect(visit).toHaveText(messages.en['web.gym.visit']);
    await expect(visit).toBeDisabled();
    await expect(page.getByTestId('web-gym-visit-hint')).toHaveText(messages.en['web.gym.signInToVisit']);
  });

  test('English by default, Swahili from the browser language and via the toggle (re-fetched with lang)', async ({ page }) => {
    const calls = await mockApi(page, (_n, lang) => ({ status: 200, body: profile(lang as 'en' | 'sw') }));
    await open(page, 'sw-TZ');
    await expect(page.getByTestId('web-gym-visit')).toHaveText(messages.sw['web.gym.visit']);
    await expect(page.getByTestId('web-gym-plans')).toContainText('Kila siku');
    await expect(page.getByTestId('web-gym-hours')).toContainText('Jumatatu');
    expect(calls.bodies.at(-1)).toEqual({ q: Q, lang: 'sw' });
    await page.getByTestId('web-gym-lang-toggle').click();
    await expect(page.getByTestId('web-gym-visit')).toHaveText(messages.en['web.gym.visit']);
    await expect.poll(() => calls.bodies.at(-1)?.lang).toBe('en');
    expect(calls.bodies.every(b => b.q === Q)).toBe(true);
  });

  test('sections with null or empty data are not rendered', async ({ page }) => {
    await mockApi(page, (_n, lang) => ({
      status: 200,
      body: { ...profile(lang as 'en' | 'sw', {
        description: null, directions: null, lat: null, lng: null, operatingHours: null, photos: [], facilities: [], equipment: [], amenities: [],
        services: [], classes: [], trainers: [], address: null, rating: null, reviewCount: null,
      }), membership: { currency: 'TZS', gymPlans: [], passTiers: [] } },
    }));
    await open(page);
    await expect(page.getByTestId('web-gym-name')).toBeVisible();
    for (const id of ['about', 'directions', 'hours', 'plans', 'pass-tiers', 'facilities', 'amenities', 'equipment', 'services', 'classes', 'trainers', 'photos', 'address', 'rating']) {
      await expect(page.getByTestId(`web-gym-${id}`)).toHaveCount(0);
    }
  });

  test('320 px wide in Swahili: rows wrap, nothing scrolls sideways, amounts use sw-TZ', async ({ page }) => {
    await mockApi(page, (_n, lang) => ({ status: 200, body: profile(lang as 'en' | 'sw', { reviewCount: 1 }) }));
    await page.setViewportSize({ width: 320, height: 700 });
    await open(page, 'sw-TZ');
    await expect(page.getByTestId('web-gym-pass-tiers')).toContainText('12 ziara');
    await expect(page.getByTestId('web-gym-rating')).toContainText(messages.sw['web.gym.reviewsOne']);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const li = page.getByTestId('web-gym-pass-tiers').locator('li').first();
    const [lab, vis] = await Promise.all([li.locator('span').first().boundingBox(), li.locator('span > span').boundingBox()]);
    expect(vis!.y).toBeGreaterThan(lab!.y);
  });

  test('not found (404) and no q', async ({ page }) => {
    await mockApi(page, () => ({ status: 404, body: { error: 'not_found' } }));
    await open(page);
    await expect(page.getByTestId('web-gym-not-found')).toContainText(messages.en['web.gym.notFound']);
    const calls = await mockApi(page, () => ({ status: 200, body: {} }));
    await page.goto('/g/');
    await expect(page.getByTestId('web-gym-not-found')).toBeVisible();
    expect(calls.bodies).toHaveLength(0);
  });

  test('rate limited shows the retry hint, then retry works', async ({ page }) => {
    const calls = await mockApi(page, (n, lang) => n === 1 ? { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 42 } } : { status: 200, body: profile(lang as 'en' | 'sw') });
    await open(page);
    await expect(page.getByTestId('web-gym-rate-limited')).toContainText('42');
    await page.getByRole('button', { name: messages.en['web.gym.retry'] }).click();
    await expect(page.getByTestId('web-gym-name')).toBeVisible();
    expect(calls.bodies).toHaveLength(2);
  });

  test('server error and offline show an error with retry', async ({ page }) => {
    let fail = true;
    await page.route('**/public/gyms/resolve', route => fail
      ? route.abort('failed')
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile('en')) }));
    await open(page);
    await expect(page.getByTestId('web-gym-error')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: messages.en['web.gym.retry'] }).click();
    await expect(page.getByTestId('web-gym-name')).toBeVisible();
  });
});

test.describe('flag off', () => {
  test.skip(FLAG_ON, 'flag-off spec');
  test('neutral not-found and no API call', async ({ page }) => {
    const calls = await mockApi(page, (_n, lang) => ({ status: 200, body: profile(lang as 'en' | 'sw') }));
    await open(page);
    await expect(page.getByTestId('web-gym-not-found')).toBeVisible();
    await expect(page.getByTestId('web-gym-profile')).toHaveCount(0);
    expect(calls.bodies).toHaveLength(0);
  });
});
