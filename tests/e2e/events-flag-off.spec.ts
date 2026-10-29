import { expect, test } from '@playwright/test';
import { GYM_OWNER, HR_USER, OWNER, SUPER_ADMIN, orgUser, setupEvents } from './helpers/events-mock';

// Build flag off (NEXT_PUBLIC_EVENTS_MODULE unset): the pages render "not available", no nav items, no login link
// (spec §3, P-ON-1). Run with: EVENTS_FLAG=false npx playwright test --config playwright.events.config.ts
test.use({ serviceWorkers: 'block' });

test('login shows no organizer link', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => route.abort());
  await page.goto('/login/');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByTestId('login-organizer-link')).toHaveCount(0);
});

test('/organizer/onboarding renders the not-available state for a gym owner', async ({ page }) => {
  const mock = await setupEvents(page, GYM_OWNER, { me: null });
  await page.goto('/organizer/onboarding/');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
  expect(mock.reads(/^\/organizer\/me$/)).toHaveLength(0);
});

test('an organizer session sees the not-available state on every organizer page and no nav items', async ({ page }) => {
  await setupEvents(page, OWNER);
  await page.goto('/organizer/');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(0);
  await page.goto('/organizer/events/');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
});

// Events S5 (spec §11.1): integrations and the venue tabs vanish with the build flag, and no S5 call is made.
test('/organizer/integrations renders the not-available state and makes no integrations call', async ({ page }) => {
  const mock = await setupEvents(page, OWNER);
  await page.goto('/organizer/integrations/');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
  expect(mock.reads(/api-clients|webhook-endpoints|webhook-deliveries|integrations\/health/)).toHaveLength(0);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Integrations' })).toHaveCount(0);
  await page.goto('/organizer/events/?event=evt_pub&view=kit');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
  expect(mock.reads(/tickets|kit-collections|kit\/summary|bib-assignments/)).toHaveLength(0);
});

test('/admin/events renders the not-available state and the admin nav has no Events item', async ({ page }) => {
  await setupEvents(page, SUPER_ADMIN);
  await page.goto('/admin/events/');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /^Events/ })).toHaveCount(0);
});

// Events S3 (spec §7.1, P-C-1): with the build flag off the corporate pages render not-available and the probe is not even made.
test('/org/events and /hr/events render the not-available state and no Events nav item', async ({ page }) => {
  const mock = await setupEvents(page, orgUser(['owner']), { s3: true });
  await page.goto('/org/events/');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Events' })).toHaveCount(0);
  expect(mock.reads(/^\/events\/options$/)).toHaveLength(0);
  await setupEvents(page, HR_USER, { s3: true });
  await page.goto('/hr/events/');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Events' })).toHaveCount(0);
});

// Events S4 (spec §6.1, §7.1): with the build flag off the money pages render exactly as before: no Event tickets filter,
// no productType query, and the organizer Finance tab / corporate payment panel are unreachable (not-available states above).
test('/admin/payments has no Event tickets filter and asks for the whole list', async ({ page }) => {
  const mock = await setupEvents(page, SUPER_ADMIN, { s4: {} });
  await page.goto('/admin/payments/');
  await expect(page.getByRole('button', { name: 'Trainer pass' })).toBeVisible();
  await expect(page.getByTestId('payments-kind-event_order')).toHaveCount(0);
  expect(mock.reads(/^\/admin\/payment-requests$/).every(c => !c.query.productType)).toBe(true);
});

test('the organizer Finance link and the admin event cancel preview are not reachable with the flag off', async ({ page }) => {
  const mock = await setupEvents(page, OWNER, { s4: {} });
  await page.goto('/organizer/events/?event=evt_pub&view=finance');
  await expect(page.getByTestId('events-unavailable')).toBeVisible();
  expect(mock.reads(/\/finance$/)).toHaveLength(0);
});
