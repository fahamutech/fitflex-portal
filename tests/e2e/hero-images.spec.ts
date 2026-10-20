import { expect, test, type Page } from '@playwright/test';
import { API, GIF, mockHeroApi, png, seedState, signInAs, staff, SUPER_ADMIN, type HeroState } from './helpers/hero-mock';

// Admin "App photos" + the remote-capable login panel (design spec photo-hero-screens §36–§38,
// AC-N1..N18; plan slice 5). The API is mocked (functions#216 contract); nothing signs in for real.
//
// The flags are inlined when the portal is built, so the flag state is the one the portal under test
// was started with. Run this file twice, each against a fresh `next dev`:
//   npx playwright test hero-images                                    (all flags off)
//   NEXT_PUBLIC_HERO_IMAGES_ADMIN=true NEXT_PUBLIC_HERO_IMAGES_REMOTE=true NEXT_PUBLIC_PHOTO_HERO_UI=true \
//     npx playwright test hero-images                                  (flags on)

const ADMIN_ON = process.env.NEXT_PUBLIC_HERO_IMAGES_ADMIN === 'true';
const REMOTE_ON = process.env.NEXT_PUBLIC_HERO_IMAGES_REMOTE === 'true' && process.env.NEXT_PUBLIC_PHOTO_HERO_UI === 'true';
const ANY_ON = ADMIN_ON || REMOTE_ON || process.env.NEXT_PUBLIC_PHOTO_HERO_UI === 'true';

async function openScreen(page: Page, s: HeroState, opts: { user?: Record<string, unknown>; locale?: 'en' | 'sw'; serverOff?: boolean } = {}) {
  await signInAs(page, opts.user ?? SUPER_ADMIN, opts.locale);
  await mockHeroApi(page, s, { serverOff: opts.serverOff });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/hero-images/');
}

const nav = (page: Page) => page.getByRole('navigation', { name: /main navigation|menyu kuu/i });

test.describe('flags off', () => {
  test.skip(ANY_ON, 'portal under test was built with a hero flag on');

  test('no App photos nav item, the route is not found, and no hero request is made', async ({ page }) => {
    const s = seedState();
    const heroCalls: string[] = [];
    page.on('request', r => { if (r.url().startsWith(API) && r.url().includes('/hero-')) heroCalls.push(r.url()); });
    await signInAs(page, SUPER_ADMIN);
    await mockHeroApi(page, s);
    await page.goto('/admin/');
    await expect(page.getByRole('link', { name: 'Exercises' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'App photos' })).toHaveCount(0);
    await page.goto('/admin/hero-images/');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByTestId('hero-images-page')).toHaveCount(0);
    expect(heroCalls).toEqual([]);
  });

  test('login asks for no remote photo', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', r => { if (r.url().includes('/app/hero-images')) calls.push(r.url()); });
    await page.route(`${API}/**`, route => route.fulfill({ status: 404, json: { error: 'not_found' } }));
    await page.goto('/login');
    await expect(page.getByTestId('google-submit')).toBeVisible();
    await page.waitForTimeout(500);
    expect(calls).toEqual([]);
    await expect(page.locator('h1')).toHaveCount(1);
  });
});

test.describe('App photos (flag on)', () => {
  test.skip(!ADMIN_ON, 'portal under test was built without NEXT_PUBLIC_HERO_IMAGES_ADMIN=true');

  test('super-admin: nav item, places grouped by area in order, built-in and Changed states, unknown slot under Other', async ({ page }) => {
    const s = seedState({ extraSlots: [{ id: 'mysterySlot', area: 'members', surface: 'mobile', variant: 'compact', aspectHint: 1.5, maxImages: 3, draft: [], published: [], brightWarning: false }] });
    await openScreen(page, s);
    await expect(nav(page).getByRole('link', { name: 'App photos' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'App photos' })).toBeVisible();
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.getByText('The app shows these photos only in builds with remote photos turned on.', { exact: false })).toBeVisible();

    const h2 = await page.getByTestId('hero-places').locator('h2').allTextContents();
    expect(h2).toEqual(['Before sign-in', 'Members', 'Partners', 'Page footers', 'Portal', 'Other']);
    await expect(page.getByTestId('hero-area-other').getByRole('heading', { name: 'mysterySlot' })).toBeVisible();

    const gyms = page.getByTestId('hero-slot-gyms');
    await expect(gyms.getByRole('heading', { name: 'Gyms list' })).toBeVisible();
    await expect(gyms.getByText('Shows at the top of the Gyms list.')).toBeVisible();
    await expect(gyms.getByText('Changed')).toHaveCount(0);
    await expect(page.getByTestId('hero-slot-language').getByText('Using the built-in photo')).toBeVisible();
    // portalLogin has a draft that differs from what is published.
    const portal = page.getByTestId('hero-slot-portalLogin');
    await expect(portal.getByText('Changed')).toBeVisible();
    await expect(portal.getByText('Bright')).toBeVisible();
    await expect(page.getByTestId('hero-slot-footerPool').getByTestId('hero-slot-count')).toHaveText('0 of 8');
  });

  test('thumbnails are authenticated blob URLs, never a public or preview address (AC-N18)', async ({ page }) => {
    const s = seedState();
    await openScreen(page, s);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByTestId('hero-image-hero_a').locator('img')).toHaveAttribute('src', /^blob:/);
    await expect(page.getByTestId('hero-image-hero_b').locator('img')).toHaveAttribute('src', /^blob:/);
    const srcs = await page.locator('main img').evaluateAll(els => els.map(e => (e as HTMLImageElement).getAttribute('src') || ''));
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(src.startsWith('blob:')).toBe(true);
    expect(s.previewRequests.length).toBeGreaterThan(0);
    for (const r of s.previewRequests) {
      expect(r.authorization).toBe('Bearer e2e-token');
      expect(r.path).toMatch(/\?w=(240|480|960)$/);
    }
  });

  test('staff with brand_media see the nav item and the screen (AC-N2)', async ({ page }) => {
    await openScreen(page, seedState(), { user: staff(['brand_media']) });
    await expect(nav(page).getByRole('link', { name: 'App photos' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'App photos' })).toBeVisible();
  });

  test('staff without brand_media never see it, are sent away, and make no request (AC-N2)', async ({ page }) => {
    const heroCalls: string[] = [];
    page.on('request', r => { if (r.url().startsWith(`${API}/admin/hero-`)) heroCalls.push(r.url()); });
    await openScreen(page, seedState(), { user: staff(['exercises']) });
    await expect(page).toHaveURL(/\/admin\/$/);
    await expect(nav(page).getByRole('link', { name: 'Exercises' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'App photos' })).toHaveCount(0);
    await expect(page.getByTestId('hero-images-page')).toHaveCount(0);
    expect(heroCalls).toEqual([]);
  });

  test('server flag off (404): "App photos are switched off", no actions (AC-N3)', async ({ page }) => {
    await openScreen(page, seedState(), { serverOff: true });
    await expect(page.getByText('App photos are switched off')).toBeVisible();
    await expect(page.getByText('This feature is turned off on the server.')).toBeVisible();
    await expect(page.getByTestId('hero-upload-open')).toHaveCount(0);
    await expect(page.getByTestId('hero-publish-open')).toHaveCount(0);
  });

  test('load failure shows an error with Try again', async ({ page }) => {
    const s = seedState({ fail: { load: { status: 500, json: { error: 'boom' } } } });
    await openScreen(page, s);
    await expect(page.getByText("Couldn't load app photos.")).toBeVisible();
    s.fail = {};
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('hero-places')).toBeVisible();
  });

  test('upload: blocked until every field and both boxes; only "No people"; browser rejects bad files; the ORIGINAL file is sent (AC-N5..N7)', async ({ page }) => {
    const s = seedState();
    await openScreen(page, s);
    await page.getByTestId('hero-upload-open').click();
    const dialog = page.getByRole('dialog', { name: 'Upload photo' });
    await expect(dialog).toBeVisible();
    const submit = dialog.getByTestId('hero-upload-submit');
    const input = dialog.getByTestId('hero-file-input');

    // Browser-side refusals, before any request.
    await input.setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: png(900, 600) });
    await expect(dialog.getByTestId('hero-file-error')).toHaveText('This photo is too small. Use one at least 1080 pixels wide.');
    await input.setInputFiles({ name: 'anim.gif', mimeType: 'image/gif', buffer: GIF });
    await expect(dialog.getByTestId('hero-file-error')).toHaveText("This file type isn't supported. Use JPEG, PNG or WebP.");
    await input.setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(16 * 1024 * 1024, 1) });
    await expect(dialog.getByTestId('hero-file-error')).toHaveText('This file is larger than 15 MB.');
    expect(s.calls.filter(c => c.path === '/admin/hero-images')).toEqual([]);

    const original = png(1600, 1067, { noise: true });
    await input.setInputFiles({ name: 'gym-floor.png', mimeType: 'image/png', buffer: original });
    await expect(dialog.getByTestId('hero-file-chosen')).toContainText('gym-floor.png');
    await expect(dialog.getByTestId('hero-file-chosen')).toContainText('1600 × 1067 px');

    // People: only "No people", already chosen, with the helper line (owner 2026-10-19).
    await expect(dialog.getByTestId('hero-people-none')).toBeChecked();
    await expect(dialog.getByTestId('hero-people-hands_backs')).toHaveCount(0);
    await expect(dialog.getByTestId('hero-people-unclear_faces')).toHaveCount(0);
    await expect(dialog.getByText('For now only photos without people can be used.')).toBeVisible();
    await expect(dialog.getByTestId('hero-faces')).toBeVisible();
    await expect(dialog.getByText('There are no people in this photo.')).toBeVisible();
    await expect(dialog.getByText('only backs, hands or unclear faces', { exact: false })).toHaveCount(0);

    await expect(submit).toBeDisabled();
    await dialog.getByTestId('hero-source').fill('Partner gym');
    await dialog.getByTestId('hero-photographer').fill('New Person');
    await dialog.getByTestId('hero-licence').fill('Partner consent');
    await expect(submit).toBeDisabled();
    await dialog.getByTestId('hero-partner-gym').check();
    await expect(dialog.getByTestId('hero-consent-ref')).toBeVisible();
    await dialog.getByTestId('hero-rights').check();
    await dialog.getByTestId('hero-faces').check();
    await expect(submit).toBeDisabled(); // consent reference still missing
    await dialog.getByTestId('hero-consent-ref').fill('Email 2026-10-18');
    await expect(submit).toBeEnabled();
    await dialog.getByTestId('hero-faces').uncheck();
    await expect(submit).toBeDisabled();
    await dialog.getByTestId('hero-faces').check();
    await submit.click();

    await expect(page.getByText('Photo uploaded. Set its focus point next.')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Edit photo' })).toBeVisible();

    const up = s.upload!;
    expect(up.authorization).toBe('Bearer e2e-token');
    expect(up.contentType).toMatch(/^multipart\/form-data; boundary=/);
    // The file goes as is: the body is the file plus a little multipart framing, and holds its exact bytes.
    expect(up.size).toBeGreaterThanOrEqual(original.length);
    expect(up.size - original.length).toBeLessThan(4096);
    expect(up.raw.includes(original)).toBe(true);
    const text = up.raw.toString('latin1');
    for (const [name, value] of [['source', 'Partner gym'], ['photographer', 'New Person'], ['licence', 'Partner consent'], ['people', 'none'], ['consentRef', 'Email 2026-10-18'], ['rightsConfirmed', 'true'], ['noFacesConfirmed', 'true']]) {
      expect(text).toContain(`name="${name}"\r\n\r\n${value}\r\n`);
    }
    expect(text).toContain('name="file"; filename="gym-floor.png"\r\nContent-Type: image/png');
    expect(text).not.toContain('name="licenceRef"');
  });

  test('upload: server error codes show the same messages', async ({ page }) => {
    const s = seedState();
    await openScreen(page, s);
    await page.getByTestId('hero-upload-open').click();
    const dialog = page.getByRole('dialog', { name: 'Upload photo' });
    await dialog.getByTestId('hero-file-input').setInputFiles({ name: 'ok.png', mimeType: 'image/png', buffer: png(1200, 800) });
    await dialog.getByTestId('hero-source').fill('FitFlex shoot');
    await dialog.getByTestId('hero-photographer').fill('Asha');
    await dialog.getByTestId('hero-licence').fill('Owned by FitFlex');
    await dialog.getByTestId('hero-rights').check();
    await dialog.getByTestId('hero-faces').check();
    const cases: Array<[number, Record<string, unknown>, string]> = [
      [400, { error: 'image_too_small', minWidth: 1080 }, 'This photo is too small. Use one at least 1080 pixels wide.'],
      [400, { error: 'unsupported_file_type' }, "This file type isn't supported. Use JPEG, PNG or WebP."],
      [413, { error: 'file_too_large', maxBytes: 15728640 }, 'This file is larger than 15 MB.'],
      [413, { error: 'file_too_large', maxPixels: 50000000 }, 'This photo has more than 50 megapixels. Use a smaller one.'],
      [503, { error: 'storage_service_unavailable' }, "Photo storage isn't available right now. Try again in a few minutes."],
      [400, { error: 'rights_confirmation_required' }, 'Tick this box to confirm.'],
      [400, { error: 'people_not_allowed' }, 'For now only photos without people can be used. Choose “No people”.'],
      [400, { error: 'invalid_multipart' }, "The upload didn't arrive complete. Try again."],
    ];
    for (const [status, json, message] of cases) {
      s.fail = { upload: { status, json } };
      await dialog.getByTestId('hero-upload-submit').click();
      await expect(dialog.getByText(message, { exact: true })).toBeVisible();
    }
  });

  test('focal point by keyboard: arrows 5%, Shift 1%, Home centres; ranges and previews follow; saved as -1..1 (AC-N8)', async ({ page }) => {
    const s = seedState();
    await openScreen(page, s);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByTestId('hero-edit-hero_a').click();
    const dialog = page.getByRole('dialog', { name: 'Edit photo' });
    const picker = dialog.getByRole('group', { name: 'Focus point' });
    await expect(dialog.getByTestId('hero-preview-phone-img')).toHaveAttribute('src', /^blob:/);
    await picker.focus();
    await page.keyboard.press('ArrowRight');
    await expect(picker).toHaveAttribute('data-x', '0.1');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(picker).toHaveAttribute('data-x', '0.12');
    await page.keyboard.press('ArrowUp');
    await expect(picker).toHaveAttribute('data-y', '-0.1');
    await expect(dialog.getByTestId('focal-x')).toHaveValue('12');
    await expect(dialog.getByTestId('focal-x')).toHaveAttribute('aria-valuetext', '56% from left');
    await expect(dialog.getByTestId('focal-y')).toHaveAttribute('aria-valuetext', '45% from top');
    await expect(dialog.getByTestId('focal-live')).toHaveText('56% from left, 45% from top');
    for (const kind of ['phone', 'band', 'desktop']) {
      await expect(dialog.getByTestId(`hero-preview-${kind}-img`)).toHaveCSS('object-position', '56% 45%');
    }
    await page.keyboard.press('Home');
    await expect(picker).toHaveAttribute('data-x', '0');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await dialog.getByTestId('hero-edit-save').click();
    await expect(page.getByText('Photo saved.')).toBeVisible();
    const patch = s.calls.find(c => c.method === 'PATCH')!;
    expect(patch.path).toBe('/admin/hero-images/hero_a');
    expect(patch.body).toEqual({ focal: { x: -0.1, y: 0.1 } }); // focal only: no re-confirmation needed
  });

  test('previews use the real scrim: the 0.80 stop sits 24px above the text, and 1.3× text moves it (AC-N9)', async ({ page }) => {
    await openScreen(page, seedState());
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByTestId('hero-edit-hero_b').click();
    const dialog = page.getByRole('dialog', { name: 'Edit photo' });
    await expect(dialog.getByText('This photo is bright where the text sits. It will still be readable but will look darker.')).toBeVisible();
    const phone = dialog.getByTestId('hero-preview-phone');
    const stop1 = Number(await phone.getAttribute('data-stop'));
    expect(stop1).toBeGreaterThan(0);
    const scrim = await phone.locator('.hero-preview__scrim').evaluate(el => getComputedStyle(el).backgroundImage);
    expect(scrim).toContain('rgba(2, 6, 23, 0.5)');
    expect(scrim).toContain('rgba(2, 6, 23, 0.8)');
    await dialog.getByTestId('hero-preview-card-phone').getByText('Show 1.3× text').click();
    await expect.poll(async () => Number(await phone.getAttribute('data-stop'))).toBeLessThan(stop1);
    const desktopScrim = await dialog.getByTestId('hero-preview-desktop').locator('.hero-preview__scrim').evaluate(el => getComputedStyle(el).backgroundImage);
    expect(desktopScrim).toContain('rgba(2, 6, 23, 0.92)');
    expect(desktopScrim).toContain('rgba(2, 6, 23, 0.3)');
  });

  test('editing licence or people needs both boxes again and sends them', async ({ page }) => {
    const s = seedState();
    await openScreen(page, s);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByTestId('hero-edit-hero_a').click();
    const dialog = page.getByRole('dialog', { name: 'Edit photo' });
    await expect(dialog.getByTestId('hero-edit-reconfirm')).toHaveCount(0);
    await dialog.getByTestId('hero-photographer').fill('Asha Mwita');
    await expect(dialog.getByTestId('hero-edit-reconfirm')).toBeVisible();
    await expect(dialog.getByTestId('hero-edit-save')).toBeDisabled();
    await dialog.getByTestId('hero-rights').check();
    await dialog.getByTestId('hero-faces').check();
    await dialog.getByTestId('hero-edit-save').click();
    await expect(page.getByText('Photo saved.')).toBeVisible();
    const patch = s.calls.find(c => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ photographer: 'Asha Mwita', rightsConfirmed: true, noFacesConfirmed: true });
  });

  test('choose photos: max per place, order buttons, built-in, saves the draft only (AC-N11)', async ({ page }) => {
    const s = seedState();
    await openScreen(page, s);
    await page.getByTestId('hero-choose-btn-portalLogin').click();
    const dialog = page.getByRole('dialog', { name: /Choose photos for Portal sign-in/ });
    await expect(dialog.getByTestId('hero-choose-hero_b')).toBeChecked();
    await expect(dialog.getByTestId('hero-choose-hero_a')).toBeDisabled(); // max 1
    await dialog.getByTestId('hero-use-built-in').click();
    await expect(dialog.getByTestId('hero-choose-none')).toBeVisible();
    await dialog.getByTestId('hero-choose-hero_a').check();
    await expect(dialog.getByTestId('hero-choose-hero_b')).toBeDisabled();
    await dialog.getByTestId('hero-choose-save').click();
    await expect(page.getByText('Saved as a draft. Publish to send it to the apps.').last()).toBeVisible();
    expect(s.calls.find(c => c.method === 'PUT')).toMatchObject({ path: '/admin/hero-slots/portalLogin', body: { imageIds: ['hero_a'] } });

    // Several photos, reordered.
    await page.getByTestId('hero-choose-btn-gyms').click();
    const gyms = page.getByRole('dialog', { name: /Choose photos for Gyms list/ });
    await expect(gyms.getByTestId('hero-choose-count')).toContainText('1 of 3');
    await gyms.getByTestId('hero-choose-hero_b').check();
    await gyms.getByRole('button', { name: /^Move up: Photo by Juma K./ }).click();
    await expect(gyms.getByTestId('hero-choose-order').locator('li').first()).toHaveAttribute('data-image-id', 'hero_b');
    await gyms.getByTestId('hero-choose-save').click();
    await expect(page.getByTestId('hero-slot-gyms').getByText('Changed')).toBeVisible();
    expect(s.calls.filter(c => c.method === 'PUT').at(-1)!.body).toEqual({ imageIds: ['hero_b', 'hero_a'] });
    // The published thumbnails are unchanged until Publish.
    await expect(page.getByTestId('hero-slot-gyms').getByTestId('hero-slot-published').getByTestId('hero-thumb')).toHaveCount(1);
  });

  test('slot save errors are explained', async ({ page }) => {
    const s = seedState({ fail: { slot: { status: 400, json: { error: 'too_many_images', maxImages: 3 } } } });
    await openScreen(page, s);
    await page.getByTestId('hero-choose-btn-gyms').click();
    const dialog = page.getByRole('dialog', { name: /Choose photos for Gyms list/ });
    await dialog.getByTestId('hero-choose-hero_b').check();
    await dialog.getByTestId('hero-choose-save').click();
    await expect(dialog.getByText('This place takes up to 3 photos.', { exact: true }).first()).toBeVisible();
    s.fail = { slot: { status: 400, json: { error: 'image_retired', imageIds: ['hero_b'] } } };
    await dialog.getByTestId('hero-choose-save').click();
    await expect(dialog.getByText('One of these photos was retired. Choose another.')).toBeVisible();
    s.fail = { slot: { status: 400, json: { error: 'unknown_slot' } } };
    await dialog.getByTestId('hero-choose-save').click();
    await expect(dialog.getByText('This place no longer exists. Reload the page.')).toBeVisible();
  });

  test('publish: disabled with nothing to publish; lists exactly the changed places; note; History shows the new Current (AC-N12)', async ({ page }) => {
    const nothing = seedState({ drafts: { gyms: ['hero_a'] } });
    await openScreen(page, nothing);
    await expect(page.getByTestId('hero-publish-open')).toBeDisabled();
    await expect(page.getByTestId('hero-publish-none')).toHaveText('No changes to publish');
  });

  test('publish and put back', async ({ page }) => {
    const s = seedState();
    await openScreen(page, s);
    await page.getByTestId('hero-publish-open').click();
    const dialog = page.getByRole('dialog', { name: 'Publish these changes?' });
    await expect(dialog.getByText('1 places change')).toBeVisible();
    const rows = dialog.getByTestId('hero-change-list').locator('> li');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-slot-id', 'portalLogin');
    await expect(rows.first().getByText('Built-in photo')).toBeVisible(); // before
    await dialog.getByTestId('hero-publish-note').fill('Sign-in photo for launch');
    await dialog.getByTestId('hero-publish-confirm').click();
    await expect(page.getByText('Published. Version 3.')).toBeVisible();
    expect(s.calls.find(c => c.path === '/admin/hero-slots/publish')!.body).toEqual({ note: 'Sign-in photo for launch' });

    const history = page.getByTestId('hero-history');
    await expect(history).toBeVisible();
    const v3 = page.getByTestId('hero-version-3');
    await expect(v3.getByText('Current')).toBeVisible();
    await expect(v3.getByText('Sign-in photo for launch')).toBeVisible();
    await expect(v3.getByText('Local Admin')).toBeVisible();
    await expect(v3.getByText('19 Oct 2026, 15:00')).toBeVisible(); // 12:00Z in Dar es Salaam
    await expect(v3.getByTestId('hero-rollback-3')).toHaveCount(0);
    await expect(page.getByTestId('hero-version-1').getByText('Neema O.')).toBeVisible();

    // Put back version #1 (nothing published).
    await page.getByTestId('hero-rollback-1').click();
    const confirm = page.getByRole('alertdialog', { name: 'Put back version #1?' });
    const changes = confirm.getByTestId('hero-change-list').locator('> li');
    await expect(changes).toHaveCount(2);
    await confirm.getByRole('button', { name: 'Put back' }).click();
    await expect(page.getByText('Version #1 is live again.')).toBeVisible();
    expect(s.calls.find(c => c.path === '/admin/hero-slots/rollback')!.body).toEqual({ publicationId: 1 });
    const v4 = page.getByTestId('hero-version-4');
    await expect(v4.getByText('Current')).toBeVisible();
    await expect(v4.getByText('Put back from #1')).toBeVisible();
  });

  test('every error code maps to its own message; unknown codes show the code (AC-N15)', async ({ page }) => {
    const s = seedState();
    await openScreen(page, s);
    await page.getByTestId('hero-publish-open').click();
    const dialog = page.getByRole('dialog', { name: 'Publish these changes?' });
    const cases: Array<[number, string, string]> = [
      [400, 'invalid_note', 'The note is too long.'],
      [409, 'drafts_changed', 'The photos changed while you were publishing. Check the changes and publish again.'],
      [422, 'variant_over_budget', "A photo couldn't be made small enough for the apps. Choose a simpler photo for that place."],
      [502, 'stored_file_mismatch', "A stored photo doesn't match what was uploaded. Upload it again."],
      [503, 'storage_service_unavailable', "Photo storage isn't available right now. Try again in a few minutes."],
      [400, 'licence_details_required', 'Fill in the source, photographer and licence.'],
      [400, 'invalid_people', 'Choose who is in the photo.'],
      [400, 'invalid_reference', 'A reference can be up to 200 characters.'],
      [400, 'no_file_provided', 'Choose a photo file to upload.'],
      [400, 'unknown_field', "The portal sent something the server doesn't accept. Reload the page."],
      [400, 'invalid_focal', 'The focus point must be inside the photo.'],
      [400, 'invalid_status', "That status change isn't allowed."],
      [400, 'nothing_to_change', 'There is nothing to save.'],
      [400, 'invalid_image_ids', "The photo list isn't valid. Reload the page."],
      [400, 'duplicate_image', 'A photo is chosen twice. Choose each photo once.'],
      [404, 'image_not_found', 'This photo no longer exists. Reload the page.'],
      [409, 'image_in_draft', 'This photo is still chosen for a place. Remove it from every place first.'],
      [400, 'invalid_publication_id', "That version isn't valid. Reload the page."],
      [404, 'publication_not_found', 'That version no longer exists. Reload the page.'],
      [409, 'already_current', 'This version is already live.'],
      [404, 'feature_disabled', 'App photos are switched off on the server.'],
      [400, 'invalid_width', "The preview size isn't valid."],
      [403, 'acl_forbidden', "You don't have permission to manage app photos."],
      [400, 'people_not_allowed', 'Some of these photos are marked as showing people, which isn\'t allowed for now. Edit them to “No people” or choose others.'],
      [409, 'image_not_live', "This photo isn't in the apps right now."],
      [500, 'image_save_failed', "The photo couldn't be saved. Try again."],
      [503, 'storage_service_unavailable', 'Sending the photos to the apps took too long. Nothing went live. Try again.'],
      [418, 'teapot_mode', 'Something went wrong (teapot_mode).'],
    ];
    let timeoutSeen = false;
    for (const [status, error, message] of cases) {
      const timeout = error === 'storage_service_unavailable' && message.startsWith('Sending') && !timeoutSeen;
      if (timeout) timeoutSeen = true;
      s.fail = { publish: { status, json: timeout ? { error, reason: 'upload_timeout' } : { error } } };
      await dialog.getByTestId('hero-publish-confirm').click();
      await expect(dialog.getByTestId('hero-publish-error')).toHaveText(message);
      await expect(dialog.getByText("Couldn't publish. Nothing has changed in the apps.")).toBeVisible();
    }
    // Same code, other context: a retired photo blocks putting a version back.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    s.fail = { rollback: { status: 409, json: { error: 'image_retired', imageIds: ['hero_a'] } } };
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.getByTestId('hero-rollback-1').click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('button', { name: 'Put back' }).click();
    await expect(confirm.getByText("Couldn't put this version back. Nothing has changed in the apps. This version uses a photo that was retired, so it can't be put back.")).toBeVisible();
    s.fail = { rollback: { status: 409, json: { error: 'image_unpublished', imageIds: ['hero_a'] } } };
    await confirm.getByRole('button', { name: 'Put back' }).click();
    await expect(confirm.getByText("Couldn't put this version back. Nothing has changed in the apps. A photo in this version was removed from the apps after it, so this version can't be put back. To show that photo again, choose it for its places and publish.")).toBeVisible();
  });

  test('library: status and live badges, Retire blocked while a place uses it, Remove from live (AC-N14)', async ({ page }) => {
    const s = seedState({ drafts: { portalLogin: ['hero_b'] } }); // hero_a is live but in no draft
    await openScreen(page, s);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    const a = page.getByTestId('hero-image-hero_a');
    const b = page.getByTestId('hero-image-hero_b');
    await expect(a.getByText('Published', { exact: true })).toBeVisible();
    await expect(a.getByText('Live in the apps')).toBeVisible();
    await expect(b.getByText('Draft', { exact: true })).toBeVisible();
    await expect(b.getByText('Used in 1 places')).toBeVisible();
    await expect(b.getByTestId('hero-retire-hero_b')).toBeDisabled();
    await expect(b.getByText('Remove it from every place first. Chosen for: Portal sign-in.')).toBeVisible();
    await expect(b.getByTestId('hero-unpublish-hero_b')).toHaveCount(0);

    await a.getByTestId('hero-unpublish-hero_a').click();
    const confirm = page.getByRole('alertdialog', { name: 'Remove this photo from the apps?' });
    await confirm.getByRole('button', { name: 'Remove from live' }).click();
    await expect(page.getByText('Photo removed from the apps.')).toBeVisible();
    expect(s.calls.find(c => c.path === '/admin/hero-images/hero_a/unpublish')).toBeTruthy();
    await expect(a.getByText('Live in the apps')).toHaveCount(0);
    await expect(a.getByText('Removed from app')).toBeVisible();

    await a.getByTestId('hero-retire-hero_a').click();
    await page.getByRole('alertdialog', { name: 'Retire this photo?' }).getByRole('button', { name: 'Retire' }).click();
    await expect(page.getByText('Photo retired.')).toBeVisible();
    expect(s.calls.find(c => c.method === 'PATCH')!.body).toEqual({ status: 'retired' });

    await page.getByTestId('hero-library-filter').selectOption('retired');
    await expect(page.getByTestId('hero-image-hero_a')).toBeVisible();
    await expect(page.getByTestId('hero-image-hero_b')).toHaveCount(0);
  });

  test('retire refused by the server (image_in_draft) is explained', async ({ page }) => {
    const s = seedState({ drafts: {}, fail: { patch: { status: 409, json: { error: 'image_in_draft', slotIds: ['gyms', 'portalLogin'] } } } });
    await openScreen(page, s);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByTestId('hero-retire-hero_b').click();
    const confirm = page.getByRole('alertdialog', { name: 'Retire this photo?' });
    await confirm.getByRole('button', { name: 'Retire' }).click();
    await expect(confirm.getByText('This photo is still chosen for: Gyms list, Portal sign-in. Remove it from those places first.')).toBeVisible();
  });

  test('Swahili: the page, dialogs and errors switch language (AC-N17)', async ({ page }) => {
    const s = seedState();
    await openScreen(page, s, { locale: 'sw' });
    await expect(page.getByRole('heading', { level: 1, name: 'Picha za app' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Picha za app' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sehemu', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Maktaba', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Historia', exact: true })).toBeVisible();
    await expect(page.getByTestId('hero-slot-language').getByText('Inatumia picha iliyomo kwenye app')).toBeVisible();
    await expect(page.getByTestId('hero-places').locator('h2').first()).toHaveText('Kabla ya kuingia');
    await page.getByTestId('hero-upload-open').click();
    const dialog = page.getByRole('dialog', { name: 'Pakia picha' });
    await expect(dialog.getByText('Nathibitisha kuwa FitFlex ina haki ya kutumia picha hii kwenye app na portal zake.')).toBeVisible();
    await expect(dialog.getByText('Hakuna watu kwenye picha hii.')).toBeVisible();
    await expect(dialog.getByText('Kwa sasa picha zisizo na watu pekee ndizo zinaweza kutumika.')).toBeVisible();
    await dialog.getByTestId('hero-file-input').setInputFiles({ name: 'a.gif', mimeType: 'image/gif', buffer: GIF });
    await expect(dialog.getByTestId('hero-file-error')).toHaveText('Aina hii ya faili haikubaliki. Tumia JPEG, PNG au WebP.');
    await dialog.getByRole('button', { name: 'Ghairi' }).click();

    // Switching back to English from the sidebar changes everything again.
    await page.locator('aside:not(#mobile-drawer)').getByTestId('locale-select').selectOption('en');
    await expect(page.getByRole('heading', { level: 1, name: 'App photos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Places', exact: true })).toBeVisible();
  });

  test('screenshots for the design record', async ({ page }) => {
    test.skip(!process.env.HERO_SCREENSHOTS_DIR, 'set HERO_SCREENSHOTS_DIR to write screenshots');
    const dir = process.env.HERO_SCREENSHOTS_DIR!;
    const s = seedState();
    await openScreen(page, s);
    await expect(page.getByTestId('hero-places')).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/portal-app-photos-list.png` });

    await page.getByTestId('hero-upload-open').click();
    const up = page.getByRole('dialog', { name: 'Upload photo' });
    await up.getByTestId('hero-file-input').setInputFiles({ name: 'gym-floor.jpg', mimeType: 'image/png', buffer: png(2160, 1440) });
    await up.getByTestId('hero-source').fill('FitFlex shoot');
    await up.getByTestId('hero-photographer').fill('Asha M.');
    await up.getByTestId('hero-licence').fill('Owned by FitFlex');
    await up.getByTestId('hero-rights').check();
    await page.screenshot({ path: `${dir}/portal-app-photos-upload.png` });
    await up.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByTestId('hero-edit-hero_b').click();
    const edit = page.getByRole('dialog', { name: 'Edit photo' });
    await expect(edit.getByTestId('hero-preview-desktop-img')).toHaveAttribute('src', /^blob:/);
    await edit.getByRole('group', { name: 'Focus point' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.screenshot({ path: `${dir}/portal-app-photos-slot-editor.png` });
    await edit.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Places', exact: true }).click();
    await page.getByTestId('hero-choose-btn-gyms').click();
    const choose = page.getByRole('dialog', { name: /Choose photos for Gyms list/ });
    await choose.getByTestId('hero-choose-hero_b').check();
    await page.screenshot({ path: `${dir}/portal-app-photos-choose.png` });
    await choose.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.screenshot({ path: `${dir}/portal-app-photos-history.png` });
  });
});

test.describe('login panel reads the remote photo (flag on)', () => {
  test.skip(!REMOTE_ON, 'portal under test was built without NEXT_PUBLIC_HERO_IMAGES_REMOTE=true and NEXT_PUBLIC_PHOTO_HERO_UI=true');

  const MANIFEST = (url: string) => ({
    version: 7, publishedAt: '2026-10-19T08:00:00.000Z',
    slots: { portalLogin: [{ id: 'hero_x-abc', sourceId: 'hero_x', url, url1x: url, urlWide: url, urlAvif: null, width: 1080, height: 720, bytes: 90000, focal: { x: -0.5, y: 0.2 } }] },
  });
  const PHOTO = png(320, 200, { rgb: [200, 120, 40] });

  async function openLogin(page: Page, opts: { manifest?: Record<string, unknown>; photoDelayMs?: number } = {}) {
    const calls: string[] = [];
    page.on('request', r => { if (r.url().startsWith(API) || r.url().includes('evil.example')) calls.push(new URL(r.url()).pathname); });
    await page.route('https://evil.example/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PHOTO }));
    await page.route(`${API}/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/app/hero-images') return route.fulfill({ json: opts.manifest ?? { version: 0, slots: {} } });
      if (path.startsWith('/storage/')) {
        if (opts.photoDelayMs) await new Promise(r => setTimeout(r, opts.photoDelayMs));
        return route.fulfill({ status: 200, contentType: 'image/png', body: PHOTO });
      }
      return route.fulfill({ status: 404, json: { error: 'not_found' } });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login');
    await expect(page.getByTestId('google-submit')).toBeVisible();
    return calls;
  }

  test('a photo that loads within 1.5 s is used; the bundled one paints first; one h1, unchanged', async ({ page }) => {
    await openLogin(page, { manifest: MANIFEST('/storage/bafyx/hero_x-wide.webp') });
    await expect(page.getByTestId('login-photo-panel-img')).toHaveAttribute('data-loaded', 'true');
    const remote = page.getByTestId('login-photo-panel-remote-img');
    await expect(remote).toHaveAttribute('src', `${API}/storage/bafyx/hero_x-wide.webp`, { timeout: 1500 });
    await expect(remote).toHaveAttribute('data-loaded', 'true');
    await expect(remote).toHaveAttribute('alt', '');
    await expect(remote).toHaveCSS('object-position', '25% 60%');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to FitFlex for partners' })).toBeVisible();
  });

  test('a photo slower than 1.5 s is not swapped in on this visit', async ({ page }) => {
    const calls = await openLogin(page, { manifest: MANIFEST('/storage/bafyx/slow-wide.webp'), photoDelayMs: 2500 });
    await page.waitForTimeout(3500);
    expect(calls).toContain('/storage/bafyx/slow-wide.webp'); // still fetched (warms the cache for next visit)
    await expect(page.getByTestId('login-photo-panel-remote-img')).toHaveCount(0);
    await expect(page.getByTestId('login-photo-panel-img')).toHaveAttribute('data-loaded', 'true');
  });

  test('empty slot or a non-FitFlex address keeps the bundled photo', async ({ page }) => {
    const calls = await openLogin(page, { manifest: MANIFEST('https://evil.example/x.webp') });
    await page.waitForTimeout(1800);
    await expect(page.getByTestId('login-photo-panel-remote-img')).toHaveCount(0);
    expect(calls.filter(c => c === '/x.webp')).toEqual([]);
  });

  for (const bad of ['/storage/%2e%2e/x.webp', '/storage/..%2fadmin/x.webp', '/storage/../x.webp', '/storage/bafy/..', '/storage/a/b/c.webp']) {
    test(`a smuggled storage path is refused: ${bad}`, async ({ page }) => {
      const calls = await openLogin(page, { manifest: MANIFEST(bad) });
      await page.waitForTimeout(1800);
      await expect(page.getByTestId('login-photo-panel-remote-img')).toHaveCount(0);
      expect(calls.filter(c => c.startsWith('/storage') || c.startsWith('/admin') || c === '/x.webp')).toEqual([]);
    });
  }

  test('no request under high contrast', async ({ page }) => {
    await page.emulateMedia({ contrast: 'more' });
    const calls = await openLogin(page, { manifest: MANIFEST('/storage/bafyx/hero_x-wide.webp') });
    await page.waitForTimeout(1000);
    expect(calls.filter(c => c === '/app/hero-images' || c.startsWith('/storage/'))).toEqual([]);
    await expect(page.locator('h1')).toHaveCount(1);
  });
});
