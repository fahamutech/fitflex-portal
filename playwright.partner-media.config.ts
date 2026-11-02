import { defineConfig, devices } from '@playwright/test';

/**
 * Partner photos admin specs (tests/e2e/partner-media.spec.ts) run against a mocked API (functions#277 contract):
 * no backend is started. NEXT_PUBLIC_PARTNER_MEDIA_ADMIN is inlined when the portal is built, so the flag value is
 * fixed at start: PARTNER_MEDIA_FLAG=true (default) serves the flag-on specs on port 3111; PARTNER_MEDIA_FLAG=false
 * serves the flag-off specs on port 3112. Each flag value gets its own dev dist dir so the inlined flag is never stale.
 *
 *   npx playwright test --config playwright.partner-media.config.ts
 *   PARTNER_MEDIA_FLAG=false npx playwright test --config playwright.partner-media.config.ts
 */
const flagOn = (process.env.PARTNER_MEDIA_FLAG ?? 'true') === 'true';
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || (flagOn ? 3111 : 3112));
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /partner-media\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_PUBLIC_PARTNER_MEDIA_ADMIN=${flagOn ? 'true' : 'false'} NEXT_DIST_DIR=.next-dev-partner-media-${flagOn ? 'on' : 'off'} npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
