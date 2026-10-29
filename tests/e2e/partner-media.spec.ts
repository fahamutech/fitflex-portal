import { expect, test, type Page } from '@playwright/test';
import { messages } from '../../src/lib/i18n';
import {
  autoPlate, checkFileBasics, checkFileSize, eatDateTime, PARTNER_MEDIA_ERROR_CODES, partnerMediaErrorText, reasonsFor, takedownReady,
} from '../../src/lib/partner-media';
import { ApiError } from '../../src/lib/api';
import {
  API, GYM, media, mockPartnerMediaApi, png, seed, signInAs, staff, SUPER_ADMIN, TRAINER, VENDOR, type PmState,
} from './helpers/partner-media-mock';

// Partner photos admin (design spec photo-hero-screens §43, AC-P31..P42; backend functions#277). The API is mocked;
// nothing signs in for real. Run twice (the flag is inlined when the portal is built):
//   npx playwright test --config playwright.partner-media.config.ts                          (flag on)
//   PARTNER_MEDIA_FLAG=false npx playwright test --config playwright.partner-media.config.ts (flag off)

const FLAG_ON = (process.env.PARTNER_MEDIA_FLAG ?? 'true') === 'true';
const nav = (page: Page) => page.getByRole('navigation', { name: /main navigation|menyu kuu/i });

async function openQueue(page: Page, s: PmState, opts: { user?: Record<string, unknown>; locale?: 'en' | 'sw'; serverOff?: boolean; width?: number } = {}) {
  await signInAs(page, opts.user ?? SUPER_ADMIN, opts.locale);
  await mockPartnerMediaApi(page, s, { serverOff: opts.serverOff });
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.goto('/admin/partner-media/');
}
const allListCalls = (s: PmState) => s.calls.filter(c => c.method === 'GET' && c.path === '/admin/partner-media');
/** A card's look-up of the partner's other live item (limit 1, one partner, one kind). */
const isCompanionCall = (c: PmState['calls'][number]) => c.query.limit === '1' && !!c.query.subjectId && !!c.query.kind;
/** The page's own list requests, without the cards' companion look-ups. */
const listCalls = (s: PmState) => allListCalls(s).filter(c => !isCompanionCall(c));

// ── Pure rules (no browser) ─────────────────────────────────────────────────
test.describe('rules', () => {
  test('file checks before any request', () => {
    expect(checkFileBasics('logo', { name: 'logo.svg', type: 'image/svg+xml', size: 100 })).toMatchObject({ ok: false, key: 'partnerMedia.error.svg_not_allowed' });
    expect(checkFileBasics('hero', { name: 'a.gif', type: 'image/gif', size: 100 })).toMatchObject({ ok: false, key: 'partnerMedia.error.unsupported_file_type' });
    expect(checkFileBasics('hero', { name: 'a.jpg', type: 'image/jpeg', size: 16 * 1024 * 1024 })).toMatchObject({ ok: false, key: 'partnerMedia.error.file_too_large', vars: { maxMb: 15 } });
    expect(checkFileBasics('logo', { name: 'a.png', type: 'image/png', size: 3 * 1024 * 1024 })).toMatchObject({ ok: false, vars: { maxMb: 2 } });
    expect(checkFileBasics('hero', { name: 'a.webp', type: '', size: 1000 })).toEqual({ ok: true });
    expect(checkFileSize('hero', { width: 900, height: 600 })).toMatchObject({ ok: false, key: 'partnerMedia.error.image_too_small.hero' });
    expect(checkFileSize('hero', { width: 1080, height: 600 })).toEqual({ ok: true });
    expect(checkFileSize('logo', { width: 1000, height: 200 })).toMatchObject({ ok: false, key: 'partnerMedia.error.image_too_small.logo' });
    expect(checkFileSize('logo', { width: 4100, height: 300 })).toMatchObject({ ok: false, key: 'partnerMedia.error.too_many_pixels' });
    expect(checkFileSize('hero', { width: 9000, height: 6000 })).toMatchObject({ ok: false, key: 'partnerMedia.error.too_many_pixels.photo', vars: { maxMp: 50 } });
    // A changed limit changes the check (AC-P23).
    const limits = { hero: { minWidth: 2000, maxBytes: 1024, types: ['image/png'] }, logo: { minSide: 10, maxBytes: 1024, types: ['image/png'] } };
    expect(checkFileSize('hero', { width: 1500, height: 900 }, limits)).toMatchObject({ ok: false, vars: { minWidth: 2000 } });
    expect(checkFileBasics('hero', { name: 'a.jpg', type: 'image/jpeg', size: 10 }, limits)).toMatchObject({ ok: false, key: 'partnerMedia.error.unsupported_file_type' });
  });

  test('reasons per kind and the Take down rule', () => {
    expect(reasonsFor('hero')).toEqual(['inappropriate', 'rights', 'other_brand', 'person_request', 'quality', 'other']);
    expect(reasonsFor('logo')).toEqual(['inappropriate', 'rights', 'not_own_logo', 'quality', 'other']);
    expect(takedownReady('', '')).toBe(false);
    expect(takedownReady('quality', '')).toBe(true);
    expect(takedownReady('other', '  ')).toBe(false);
    expect(takedownReady('other', 'why')).toBe(true);
    expect(takedownReady('rights', 'x'.repeat(501))).toBe(false);
  });

  test('times: English 24-hour, Swahili 12-hour with the part of the day (EAT)', () => {
    expect(eatDateTime('2026-10-29T11:05:00.000Z', 'en')).toBe('29 Oct 2026, 14:05');
    expect(eatDateTime('2026-10-29T11:05:00.000Z', 'sw')).toBe('29 Okt 2026, 2:05 mchana');
    expect(eatDateTime('2026-10-27T06:00:00.000Z', 'sw')).toBe('27 Okt 2026, 9:00 asubuhi');
    expect(eatDateTime(null, 'en')).toBe('—');
  });

  test('automatic plate: white logo gets dark, dark logo gets light, transparent pixels ignored', () => {
    expect(autoPlate([255, 255, 255, 255, 0, 0, 0, 0])).toBe('dark');
    expect(autoPlate([20, 30, 40, 255, 255, 255, 255, 0])).toBe('light');
    expect(autoPlate([])).toBe('light');
  });

  test('every error code and every partnerMedia string exists in English and Swahili', () => {
    const en = messages.en as Record<string, string>;
    const sw = messages.sw as Record<string, string>;
    const keys = Object.keys(en).filter(k => k.startsWith('partnerMedia.') || k === 'admin.nav.partnerMedia');
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) { expect(sw[k], k).toBeTruthy(); expect(sw[k], k).not.toBe(''); }
    for (const locale of ['en', 'sw'] as const) {
      const t = (k: string) => (messages[locale] as Record<string, string>)[k];
      for (const code of PARTNER_MEDIA_ERROR_CODES) {
        const text = partnerMediaErrorText(t as never, new ApiError(400, { error: code }));
        expect(text, `${locale} ${code}`).not.toMatch(/\{|\(.*_.*\)|undefined/);
      }
      expect(partnerMediaErrorText(t as never, new ApiError(400, { error: 'brand_new_code' }))).toContain('brand_new_code');
    }
    // Review fixes (functions#277 6cc45ec): scope-specific 429 texts and the new codes.
    const en2 = (k: string) => en[k];
    expect(partnerMediaErrorText(en2 as never, new ApiError(429, { error: 'rate_limited', scope: 'person' }))).toBe(en['partnerMedia.error.rate_limited.person']);
    expect(partnerMediaErrorText(en2 as never, new ApiError(429, { error: 'rate_limited', scope: 'partner' }))).toBe(en['partnerMedia.error.rate_limited.partner']);
    for (const code of ['image_service_busy', 'rate_limit_unavailable', 'reinstate_requires_moderation_decide', 'override_reason_required', 'override_reason_too_long']) {
      expect(PARTNER_MEDIA_ERROR_CODES).toContain(code);
    }
    // file_too_large: maxPixels and maxSide both get the too-many-pixels text; maxBytes the size text.
    expect(partnerMediaErrorText(en2 as never, new ApiError(413, { error: 'file_too_large', maxPixels: 50_000_000 }))).toBe('This photo has too many pixels. Use one of at most 50 megapixels.');
    expect(partnerMediaErrorText(en2 as never, new ApiError(413, { error: 'file_too_large', maxSide: 4000 }))).toBe('This logo is too large. Use one at most 4000 pixels on each side.');
    expect(partnerMediaErrorText(en2 as never, new ApiError(413, { error: 'file_too_large', maxBytes: 2097152 }), 'logo')).toBe('This file is too large. The limit is 2 MB.');
    expect(partnerMediaErrorText(en2 as never, new ApiError(429, { error: 'rate_limited', scope: 'partner_attempts' }))).toBe(en['partnerMedia.error.rate_limited.partnerAttempts']);
    // Swahili glossary (2026-10-29 review): "Chagua kisanduku", "Hakiki", li-class "faili", "Imeshindikana … Jaribu tena."
    const swPm = keys.map(k => sw[k]).join('\n');
    expect(swPm).not.toMatch(/weka alama|mwonekano|Faili za|Hatukuweza|Kuna hitilafu/i);
    expect(sw['partnerMedia.confirmRequired']).toBe('Chagua kisanduku hiki kuthibitisha.');
    expect(sw['partnerMedia.preview.failed']).toMatch(/^Imeshindikana .*Jaribu tena\.$/);
    // Permission names as the Users page labels them.
    expect(en['partnerMedia.noDecide']).toContain('"Moderation: approve, reject, suspend, hide"');
    expect(en['partnerMedia.noBrandMedia']).toContain(`"${en['admin.nav.heroImages']}"`);
    expect(sw['partnerMedia.noBrandMedia']).toContain(`"${sw['admin.nav.heroImages']}"`);
    // No copy says the partner is told when FitFlex sets their photo (O-P3).
    expect(en['partnerMedia.setDialog.note']).not.toMatch(/told|notif/i);
    expect(sw['partnerMedia.setDialog.note']).not.toMatch(/julish/i);
  });
});

// ── Flag off ────────────────────────────────────────────────────────────────
test.describe('flag off', () => {
  test.skip(FLAG_ON, 'portal under test was built with NEXT_PUBLIC_PARTNER_MEDIA_ADMIN=true');

  test('no nav item, the route is not found, no row actions, and no partner-media request', async ({ page }) => {
    const s = seed();
    const calls: string[] = [];
    page.on('request', r => { if (r.url().startsWith(API) && r.url().includes('/partner-media')) calls.push(r.url()); });
    await signInAs(page, SUPER_ADMIN);
    await mockPartnerMediaApi(page, s);
    await page.goto('/admin/');
    await expect(nav(page).getByRole('link', { name: 'Listing moderation' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Partner photos' })).toHaveCount(0);
    await page.goto('/admin/partner-media/');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByTestId('partner-media-page')).toHaveCount(0);
    await page.goto('/admin/gyms/');
    await expect(page.getByText(GYM.name).first()).toBeVisible();
    await expect(page.getByTestId(`partner-media-row-gym-${GYM.id}`)).toHaveCount(0);
    await page.goto('/admin/vendors/');
    await expect(page.getByText('Neema Supplements').first()).toBeVisible();
    await expect(page.getByTestId(`partner-media-row-vendor-${VENDOR.id}`)).toHaveCount(0);
    expect(calls).toEqual([]);
  });
});

// ── Flag on: queue ──────────────────────────────────────────────────────────
test.describe('Partner photos queue (flag on)', () => {
  test.skip(!FLAG_ON, 'portal under test was built without NEXT_PUBLIC_PARTNER_MEDIA_ADMIN=true');

  test('nav after Moderation, one h1, scope note, To review oldest first with count, previews as authenticated blobs', async ({ page }) => {
    const s = seed();
    await openQueue(page, s);
    await expect(nav(page).getByRole('link', { name: 'Partner photos' })).toBeVisible();
    const links = await nav(page).getByRole('link').allTextContents();
    const mod = links.findIndex(l => l.includes('Listing moderation'));
    expect(links[mod + 1]).toContain('Partner photos');
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Partner photos' })).toBeVisible();
    await expect(page.getByText("Only the partner and their team see these for now. Members don't.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'To review (2)' })).toHaveAttribute('aria-pressed', 'true');
    const cards = page.getByTestId('partner-cards').locator('> li');
    await expect(cards).toHaveCount(2);
    expect(await cards.evaluateAll(els => els.map(e => e.getAttribute('data-testid')))).toEqual(['partner-card-pm_old', 'partner-card-pm_logo']);
    // FitFlex-set item never in To review.
    await expect(page.getByTestId('partner-card-pm_fitflex')).toHaveCount(0);
    await expect(page.getByTestId('partner-card-pm_old')).toContainText('Uploaded');
    await expect(page.getByTestId('partner-card-pm_old')).toContainText('by Asha Owner (gym owner)');
    // Logo card: both plates and a band with the plate.
    await expect(page.getByTestId('partner-card-pm_logo').getByTestId('partner-plate-dark')).toBeVisible();
    await expect(page.getByTestId('partner-card-pm_logo').getByTestId('partner-band-band-plate')).toBeVisible();
    // Previews: blob URLs only, fetched with the token, never the API's preview URL in the DOM (AC-P37).
    await expect.poll(() => s.previews.length).toBeGreaterThanOrEqual(2);
    expect(s.previews.every(p => p.authorization === 'Bearer e2e-token')).toBe(true);
    await expect(page.getByTestId('partner-card-pm_old').getByTestId('partner-band-band-img')).toHaveAttribute('src', /^blob:/);
    const srcs = await page.locator('img').evaluateAll(els => els.map(e => (e as HTMLImageElement).getAttribute('src') || ''));
    expect(srcs.some(src => src.includes('/admin/partner-media') || src.includes('/media/p/'))).toBe(false);
    expect(listCalls(s)[0].query.tab).toBe('to_review');
  });

  test('Live and Taken down tabs; Taken down shows reason, note, who and File deleted; filters and search narrow', async ({ page }) => {
    const s = seed();
    await openQueue(page, s);
    await page.getByRole('button', { name: 'Live' }).click();
    await expect(page.getByTestId('partner-card-pm_fitflex')).toContainText('Set by FitFlex');
    await expect(page.getByTestId('partner-cards').locator('> li')).toHaveCount(3);
    await page.getByRole('button', { name: 'Taken down' }).click();
    const down = page.getByTestId('partner-card-pm_down');
    await expect(down.getByTestId('partner-file-deleted')).toHaveText('File deleted');
    await expect(down.getByTestId('partner-takedown-reason')).toHaveText('Another reason');
    await expect(down).toContainText('Shows a phone number.');
    await expect(down).toContainText('Taken down by Neema O.');
    await expect(down.getByRole('button', { name: 'Take down' })).toHaveCount(0);
    await page.getByRole('button', { name: /^To review/ }).click();
    await page.getByTestId('partner-filter-type').selectOption('vendor');
    await expect(page.getByTestId('partner-cards').locator('> li')).toHaveCount(1);
    expect(listCalls(s).at(-1)!.query.subjectType).toBe('vendor');
    await page.getByTestId('partner-filter-type').selectOption('');
    await page.getByTestId('partner-filter-kind').selectOption('logo');
    await expect(page.getByTestId('partner-card-pm_old')).toHaveCount(0);
    await page.getByTestId('partner-filter-kind').selectOption('');
    await page.getByTestId('partner-search').fill('kinon');
    await expect.poll(() => listCalls(s).at(-1)?.query.q).toBe('kinon');
    await expect(page.getByTestId('partner-cards').locator('> li')).toHaveCount(1);
  });

  test('cards draw the partner\'s live logo plate on the photo, and the logo\'s plate on the partner\'s live photo (§43.2)', async ({ page }) => {
    const s = seed();
    // A FitFlex-set live logo for the gym (never in To review) and a live photo for the vendor.
    s.items.push(
      media('pm_gym_logo', { kind: 'logo', plate: 'dark', origin: 'fitflex', review: { state: 'reviewed', at: '2026-10-28T09:00:00.000Z', by: 'admin-2', byName: 'Neema O.' }, createdAt: '2026-10-26T09:00:00.000Z' }),
      media('pm_vendor_photo', { subject: { type: 'vendor', id: VENDOR.id, name: VENDOR.vendorProfile.businessName }, origin: 'fitflex', review: { state: 'reviewed', at: '2026-10-28T09:00:00.000Z', by: 'admin-2', byName: 'Neema O.' }, createdAt: '2026-10-26T09:00:00.000Z' }),
    );
    await openQueue(page, s);
    const photoCard = page.getByTestId('partner-card-pm_old');
    const plate = photoCard.getByTestId('partner-band-band-plate');
    await expect(plate).toHaveAttribute('data-tone', 'dark');
    await expect(plate.locator('img')).toHaveAttribute('src', /^blob:/);
    await expect(photoCard.getByTestId('partner-band-band-img')).toHaveAttribute('src', /^blob:/);
    const logoCard = page.getByTestId('partner-card-pm_logo');
    await expect(logoCard.getByTestId('partner-band-band-img')).toHaveAttribute('src', /^blob:/);
    await expect(logoCard.getByTestId('partner-band-band-plate')).toBeVisible();
    // One look-up per partner and kind, live items of that partner only.
    const companions = allListCalls(s).filter(isCompanionCall);
    expect(companions.map(c => `${c.query.tab}:${c.query.subjectType}:${c.query.subjectId}:${c.query.kind}`).sort())
      .toEqual([`live:gym:${GYM.id}:logo`, `live:vendor:${VENDOR.id}:hero`]);
    // A partner with no live logo: the photo card has no plate.
    await page.getByRole('button', { name: 'Live' }).click();
    await expect(page.getByTestId('partner-card-pm_fitflex').getByTestId('partner-band-band-img')).toHaveAttribute('src', /^blob:/);
    await expect(page.getByTestId('partner-card-pm_fitflex').getByTestId('partner-band-band-plate')).toHaveCount(0);
  });

  test('Take down on cards is a ghost button in the error colour; the dialog\'s confirm stays solid', async ({ page }) => {
    await openQueue(page, seed());
    const inline = page.getByTestId('partner-take-down-pm_old');
    await expect(inline).toHaveClass(/color-error-700/);
    await expect(inline).not.toHaveClass(/bg-\[var\(--color-error-600\)\]/);
    await inline.click();
    await expect(page.getByTestId('partner-takedown-submit')).toHaveClass(/bg-\[var\(--color-error-600\)\]/);
  });

  test('moderation only: actions disabled with the hint', async ({ page }) => {
    await openQueue(page, seed(), { user: staff(['moderation']) });
    const card = page.getByTestId('partner-card-pm_old');
    await expect(card.getByRole('button', { name: 'Looks fine' })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Take down' })).toBeDisabled();
    await expect(card).toContainText('needs the "Moderation: approve, reject, suspend, hide" permission');
  });

  test('brand_media only: no queue nav item', async ({ page }) => {
    await signInAs(page, staff(['brand_media', 'gyms']));
    await mockPartnerMediaApi(page, seed());
    await page.goto('/admin/gyms/');
    await expect(nav(page).getByRole('link', { name: 'Gyms' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Partner photos' })).toHaveCount(0);
  });

  test('Looks fine sends the revision, leaves To review, stays in Live; own upload is disabled', async ({ page }) => {
    const s = seed();
    s.items[1].ownUpload = true;
    await openQueue(page, s, { user: staff(['moderation_decide']) });
    await expect(page.getByTestId('partner-looks-fine-pm_logo')).toBeDisabled();
    await expect(page.getByTestId('partner-own-upload-pm_logo')).toHaveText('You set this one, so someone else should review it.');
    await page.getByTestId('partner-looks-fine-pm_old').click();
    await expect(page.getByText('Marked as reviewed.')).toBeVisible();
    await expect(page.getByTestId('partner-card-pm_old')).toHaveCount(0);
    const call = s.calls.find(c => c.path === '/admin/partner-media/pm_old/reviewed')!;
    expect(call.body).toEqual({ revision: 1 });
    await expect(page.getByRole('button', { name: 'To review (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Live' }).click();
    await expect(page.getByTestId('partner-card-pm_old')).toContainText('Reviewed by Local Admin');
  });

  test('stale (409) and gone (404) on Looks fine', async ({ page }) => {
    const s = seed();
    s.fail.reviewed = [{ status: 409, json: { error: 'stale_revision', revision: 2 } }, { status: 404, json: { error: 'media_gone' } }];
    await openQueue(page, s);
    const before = listCalls(s).length;
    await page.getByTestId('partner-looks-fine-pm_old').click();
    await expect(page.getByText("This item changed since you opened it. We've reloaded it.")).toBeVisible();
    await expect.poll(() => listCalls(s).length).toBeGreaterThan(before);
    await page.getByTestId('partner-looks-fine-pm_logo').click();
    await expect(page.getByText('The partner has already removed or replaced this.')).toBeVisible();
  });

  test('Take down: needs a reason, a note for Another reason; sends revision; moves to Taken down', async ({ page }) => {
    const s = seed();
    await openQueue(page, s);
    await page.getByTestId('partner-take-down-pm_old').click();
    const dialog = page.getByRole('dialog', { name: 'Take down this photo?' });
    await expect(dialog).toContainText("It disappears from Kinondoni Fit's home at once and the file is deleted.");
    await expect(dialog.getByRole('radio')).toHaveCount(6);
    await expect(dialog.getByText("Another brand's logo or sign", { exact: true })).toBeVisible();
    await expect(dialog.getByText('Not their own logo')).toHaveCount(0);
    await expect(dialog.getByText('Someone in the photo asked for it to be removed.')).toBeVisible(); // partner wording as hint
    const submit = dialog.getByTestId('partner-takedown-submit');
    await expect(submit).toBeDisabled();
    await dialog.getByTestId('partner-reason-other').check();
    await expect(submit).toBeDisabled();
    await dialog.getByTestId('partner-takedown-note').fill('Shows a phone number.');
    await expect(dialog.getByTestId('partner-takedown-count')).toHaveText('21 of 500 characters');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText('Taken down. Kinondoni Fit has been told.')).toBeVisible();
    expect(s.calls.find(c => c.path.endsWith('/pm_old/take-down'))!.body).toEqual({ revision: 1, reason: 'other', note: 'Shows a phone number.' });
    await expect(page.getByTestId('partner-card-pm_old')).toHaveCount(0);
    await page.getByRole('button', { name: 'Taken down' }).click();
    await expect(page.getByTestId('partner-card-pm_old').getByTestId('partner-file-deleted')).toBeVisible();
  });

  test('Take down a logo: logo reasons only; Escape closes and focus returns', async ({ page }) => {
    await openQueue(page, seed());
    const opener = page.getByTestId('partner-take-down-pm_logo');
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Take down this logo?' });
    await expect(dialog.getByRole('radio')).toHaveCount(5);
    await expect(dialog.getByText('Not their own logo')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('Take down stale (409) reloads; detail dialog shows both previews and confirmations', async ({ page }) => {
    const s = seed();
    s.fail.takeDown = [{ status: 409, json: { error: 'stale_revision', revision: 3 } }];
    await openQueue(page, s);
    await page.getByTestId('partner-open-pm_old').click();
    const detail = page.getByTestId('partner-detail');
    await expect(detail.getByTestId('partner-band-band')).toBeVisible();
    await expect(detail.getByTestId('partner-band-wide')).toBeVisible();
    await expect(detail).toContainText('2160 × 1440 pixels');
    await expect(detail).toContainText('Wording version 2026-10-29.draft1');
    await expect(detail).toContainText('Rights confirmed by Asha Owner');
    await expect(detail.getByRole('link', { name: 'Open Gyms' })).toHaveAttribute('href', '/admin/gyms/');
    await detail.getByTestId('partner-take-down-pm_old').click();
    await page.getByTestId('partner-reason-quality').check();
    await page.getByTestId('partner-takedown-submit').click();
    await expect(page.getByText("This item changed since you opened it. We've reloaded it.")).toBeVisible();
  });

  // Dev builds run effects twice (React strict mode), so a failure is queued several times and cleared to recover.
  const many = (status: number, error: string) => Array.from({ length: 6 }, () => ({ status, json: { error } }));

  test('state: server flag off', async ({ page }) => {
    await openQueue(page, seed(), { serverOff: true });
    await expect(page.getByText('Partner photos are switched off')).toBeVisible();
    await expect(page.getByText('This feature is turned off on the server.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Take down' })).toHaveCount(0);
  });

  test('state: load failed, then Try again', async ({ page }) => {
    const s = seed({ fail: { list: many(500, 'partner_media_failed') } });
    await openQueue(page, s);
    await expect(page.getByText("Couldn't load partner photos.")).toBeVisible();
    s.fail.list = [];
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('partner-card-pm_old')).toBeVisible();
  });

  test('state: forbidden (403)', async ({ page }) => {
    await openQueue(page, seed({ fail: { list: many(403, 'acl_forbidden') } }));
    await expect(page.getByText("You don't have permission to view partner photos.")).toBeVisible();
  });

  test('state: offline', async ({ page }) => {
    await signInAs(page, SUPER_ADMIN);
    await mockPartnerMediaApi(page, seed());
    await page.route(`${API}/admin/partner-media**`, r => r.abort('internetdisconnected'));
    await page.goto('/admin/partner-media/');
    await expect(page.getByText("You're offline. Check your connection and try again.")).toBeVisible();
  });

  test('state: empty, per tab', async ({ page }) => {
    await openQueue(page, seed({ items: [] }));
    await expect(page.getByText('Nothing to review. New uploads appear here.')).toBeVisible();
    await page.getByRole('button', { name: 'Live' }).click();
    await expect(page.getByText('No partner photos yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Taken down' }).click();
    await expect(page.getByText('Nothing has been taken down.')).toBeVisible();
  });

  test('Swahili: page, tabs and dialog switch', async ({ page }) => {
    await openQueue(page, seed(), { locale: 'sw' });
    await expect(page.getByRole('heading', { level: 1, name: 'Picha za washirika' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Za kukagua (2)' })).toBeVisible();
    await expect(page.getByTestId('partner-card-pm_old')).toContainText('Imepakiwa 27 Okt 2026, 9:00 asubuhi na Asha Owner (mmiliki wa gym)');
    await page.getByTestId('partner-take-down-pm_old').click();
    await expect(page.getByRole('dialog', { name: 'Uondoe picha hii?' })).toContainText('Sababu nyingine');
  });

  test('phone width: one column, full-width actions', async ({ page }) => {
    await openQueue(page, seed(), { width: 375 });
    const btn = page.getByTestId('partner-take-down-pm_old');
    const card = page.getByTestId('partner-card-pm_old');
    await expect(btn).toBeVisible();
    const [b, c] = [await btn.boundingBox(), await card.boundingBox()];
    expect(b!.width).toBeGreaterThan(c!.width * 0.8);
    expect(b!.height).toBeGreaterThanOrEqual(44);
  });
});

// ── Flag on: Home photo and logo dialog ─────────────────────────────────────
test.describe('Home photo and logo dialog (flag on)', () => {
  test.skip(!FLAG_ON, 'portal under test was built without NEXT_PUBLIC_PARTNER_MEDIA_ADMIN=true');

  test('gyms: row action and detail section; brand_media-only reads tab=live with subjectId; sets a photo with focal point', async ({ page }) => {
    const s = seed();
    await signInAs(page, staff(['brand_media', 'gyms']));
    await mockPartnerMediaApi(page, s);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin/gyms/');
    const row = page.getByTestId(`partner-media-row-gym-${GYM.id}`);
    await expect(row).toHaveAttribute('aria-label', `Home photo and logo: ${GYM.name}`);
    await row.click();
    const dialog = page.getByRole('dialog', { name: `Home photo and logo: ${GYM.name}` });
    await expect(dialog).toContainText("What you set here shows on this partner's home at once.");
    await expect(dialog).not.toContainText(/told|notified/);
    const first = listCalls(s)[0];
    expect(first.query).toMatchObject({ tab: 'live', subjectType: 'gym', subjectId: GYM.id });
    // No queue tabs for brand_media alone.
    expect(listCalls(s).every(c => c.query.tab === 'live' && c.query.subjectId)).toBe(true);
    await expect(dialog.getByTestId('partner-set-current-hero')).toBeVisible();
    await expect(dialog.getByTestId('partner-set-none-logo')).toHaveText('No logo');
    // moderation_decide missing: no Take down here.
    await expect(dialog.getByTestId('partner-set-take-down-hero')).toHaveCount(0);

    await dialog.getByTestId('partner-set-open-hero').click();
    const form = dialog.getByTestId('partner-set-form-hero');
    await form.getByTestId('partner-set-file').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: png(900, 600) });
    await expect(form.getByTestId('partner-set-file-error')).toHaveText('This photo is too small. Use one at least 1080 pixels wide.');
    const big = png(1200, 800);
    await form.getByTestId('partner-set-file').setInputFiles({ name: 'gym.png', mimeType: 'image/png', buffer: big });
    await expect(form.getByTestId('partner-set-chosen')).toContainText('1200 × 800 pixels');
    await expect(form.getByTestId('focal-picker')).toBeVisible();
    await expect(form.getByTestId('partner-band-wide')).toBeVisible();
    const submit = form.getByTestId('partner-set-submit');
    await expect(submit).toBeDisabled();
    await form.getByText(s.confirmation.adminConfirmation.rights.en).click();
    await form.getByTestId('focal-picker').focus();
    await page.keyboard.press('ArrowRight');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText(`Live on ${GYM.name}'s home.`)).toBeVisible();
    const set = s.calls.find(c => c.method === 'POST' && c.path === '/admin/partner-media')!;
    expect(set.contentType).toContain('multipart/form-data');
    const text = set.raw!.toString('latin1');
    for (const [k, v] of [['subjectType', 'gym'], ['subjectId', GYM.id], ['kind', 'hero'], ['rightsConfirmed', 'true'], ['adminConfirmationVersion', '2026-10-29.draft1'], ['focalX', '0.1'], ['focalY', '0']]) {
      expect(text, k).toContain(`name="${k}"\r\n\r\n${v}\r\n`);
    }
    expect(text).not.toContain('name="people"');
    expect(text).not.toContain('name="partnerLogoConfirmed"');
    // The original bytes, not a re-encode (body ≈ file size).
    expect(set.raw!.length).toBeGreaterThan(big.length);
    expect(set.raw!.length).toBeLessThan(big.length + 4096);
  });

  test('gym detail dialog: section with Manage opens the dialog', async ({ page }) => {
    await signInAs(page, SUPER_ADMIN);
    await mockPartnerMediaApi(page, seed());
    await page.goto('/admin/gyms/');
    await page.getByText(GYM.name).first().click();
    const section = page.getByTestId('partner-detail-section');
    await expect(section.getByTestId('partner-detail-thumbs')).toBeVisible();
    await section.getByTestId('partner-detail-manage').click();
    await expect(page.getByRole('dialog', { name: `Home photo and logo: ${GYM.name}` })).toBeVisible();
  });

  test('vendors: hint, logo rules, plate choice, both confirmations; wording change unticks', async ({ page }) => {
    const s = seed();
    s.fail.set = [{ status: 400, json: { error: 'confirmation_version_mismatch', field: 'adminConfirmationVersion', current: '2026-10-29.draft1' } }];
    await signInAs(page, SUPER_ADMIN);
    await mockPartnerMediaApi(page, s);
    await page.goto('/admin/vendors/');
    await page.getByTestId(`partner-media-row-vendor-${VENDOR.id}`).click();
    const dialog = page.getByRole('dialog', { name: 'Home photo and logo: Neema Supplements' });
    await expect(dialog.getByTestId('partner-set-vendor-hint')).toHaveText('This is not the shop logo or banner members see.');
    await expect(dialog.getByTestId('partner-set-current-logo')).toBeVisible();
    await expect(dialog.getByTestId('partner-set-take-down-logo')).toHaveClass(/color-error-700/); // super-admin has moderation_decide; inline danger ghost
    await dialog.getByTestId('partner-set-open-logo').click();
    const form = dialog.getByTestId('partner-set-form-logo');
    const before = s.calls.length;
    await form.getByTestId('partner-set-file').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    await expect(form.getByTestId('partner-set-file-error')).toHaveText("SVG files can't be used. Save the logo as PNG and try again.");
    await form.getByTestId('partner-set-file').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: png(200, 200) });
    await expect(form.getByTestId('partner-set-file-error')).toHaveText('This logo is too small. Use one at least 256 pixels on the short side.');
    expect(s.calls.length).toBe(before); // refused before any request
    await form.getByTestId('partner-set-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png(300, 300, { rgb: [250, 250, 250] }) });
    await expect(form.getByRole('button', { name: 'Automatic (dark)' })).toBeVisible();
    await form.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(form.getByTestId('partner-band-band-plate')).toHaveAttribute('data-tone', 'light');
    await form.getByText(s.confirmation.adminConfirmation.rights.en).click();
    await expect(form.getByTestId('partner-set-submit')).toBeDisabled();
    await form.getByText(s.confirmation.adminConfirmation.partnerLogo.en).click();
    await form.getByTestId('partner-set-submit').click();
    await expect(form.getByText('The wording below has changed. Please read it and tick again.')).toBeVisible();
    await expect(form.getByTestId('partner-set-rights')).not.toBeChecked();
    await expect(form.getByTestId('partner-set-partner-logo')).not.toBeChecked();
    expect(s.calls.filter(c => c.path === '/admin/partner-media/confirmation').length).toBeGreaterThanOrEqual(2);
    await form.getByTestId('partner-set-rights').check();
    await form.getByTestId('partner-set-partner-logo').check();
    await form.getByTestId('partner-set-submit').click();
    await expect(page.getByText("Live on Neema Supplements's home.")).toBeVisible();
    const text = s.calls.filter(c => c.method === 'POST' && c.path === '/admin/partner-media').at(-1)!.raw!.toString('latin1');
    for (const [k, v] of [['kind', 'logo'], ['plate', 'light'], ['partnerLogoConfirmed', 'true'], ['subjectId', VENDOR.id]]) expect(text, k).toContain(`name="${k}"\r\n\r\n${v}\r\n`);
  });

  test('putting back a file taken down at a person\'s request asks for a reason; reinstate without decide and busy are explained', async ({ page }) => {
    const s = seed();
    s.fail.set = [
      { status: 403, json: { error: 'reinstate_requires_moderation_decide', reinstates: 'pm_down', requiredScope: 'moderation_decide' } },
      { status: 503, json: { error: 'image_service_busy', retryAfterSeconds: 5 } },
      { status: 409, json: { error: 'override_reason_required', reinstates: 'pm_down', field: 'overrideReason', takedownReason: 'person_request' } },
    ];
    await signInAs(page, SUPER_ADMIN);
    await mockPartnerMediaApi(page, s);
    await page.goto('/admin/gyms/');
    await page.getByTestId(`partner-media-row-gym-${GYM.id}`).click();
    const dialog = page.getByRole('dialog', { name: `Home photo and logo: ${GYM.name}` });
    await dialog.getByTestId('partner-set-open-hero').click();
    const form = dialog.getByTestId('partner-set-form-hero');
    await form.getByTestId('partner-set-file').setInputFiles({ name: 'again.png', mimeType: 'image/png', buffer: png(1200, 800) });
    await form.getByTestId('partner-set-rights').check();
    const submit = form.getByTestId('partner-set-submit');
    await submit.click();
    await expect(form.getByText('This file was taken down before. Putting it back needs the "Moderation: approve, reject, suspend, hide" permission.')).toBeVisible();
    await submit.click();
    await expect(form.getByText('The image service is busy. Try again in a few seconds.')).toBeVisible();
    await submit.click();
    await expect(form.getByTestId('partner-set-override')).toContainText('someone in it asked for it to be removed');
    await expect(submit).toBeDisabled();
    await form.getByTestId('partner-set-override-reason').fill('They agreed in writing on 29 Oct.');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText(`Live on ${GYM.name}'s home.`)).toBeVisible();
    const sets = s.calls.filter(c => c.method === 'POST' && c.path === '/admin/partner-media');
    expect(sets).toHaveLength(4);
    expect(sets[2].raw!.toString('latin1')).not.toContain('name="overrideReason"');
    expect(sets[3].raw!.toString('latin1')).toContain('name="overrideReason"\r\n\r\nThey agreed in writing on 29 Oct.\r\n');
  });

  test('trainers: TrainerProfile id is the subject; moderation only sees the hint, no set button', async ({ page }) => {
    const s = seed();
    await signInAs(page, staff(['moderation', 'trainers']));
    await mockPartnerMediaApi(page, s);
    await page.goto('/admin/trainers/');
    await page.getByTestId(`partner-media-row-trainer-${TRAINER.id}`).click();
    const dialog = page.getByRole('dialog', { name: `Home photo and logo: ${TRAINER.displayName}` });
    await expect(dialog.getByTestId('partner-set-no-brand')).toHaveText('Setting a photo needs the "App photos" permission.');
    await expect(dialog.getByTestId('partner-set-open-hero')).toHaveCount(0);
    expect(listCalls(s)[0].query).toMatchObject({ subjectType: 'trainer', subjectId: TRAINER.id });
    expect(s.calls.some(c => c.path === '/admin/partner-media/confirmation')).toBe(false);
  });

  test('no row action without any of the three scopes', async ({ page }) => {
    await signInAs(page, staff(['shop']));
    await mockPartnerMediaApi(page, seed());
    await page.goto('/admin/vendors/');
    await expect(page.getByText('Neema Supplements').first()).toBeVisible();
    await expect(page.getByTestId(`partner-media-row-vendor-${VENDOR.id}`)).toHaveCount(0);
  });

  test('dialog with the server flag off', async ({ page }) => {
    await signInAs(page, SUPER_ADMIN);
    await mockPartnerMediaApi(page, seed(), { serverOff: true });
    await page.goto('/admin/vendors/');
    await page.getByTestId(`partner-media-row-vendor-${VENDOR.id}`).click();
    await expect(page.getByRole('dialog').getByText('Partner photos are switched off')).toBeVisible();
  });
});

