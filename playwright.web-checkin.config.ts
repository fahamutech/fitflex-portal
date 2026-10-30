import { defineConfig, devices } from '@playwright/test';

/**
 * Browser gym check-in specs (tests/e2e/web-checkin.spec.ts; backend functions#284) run against a mocked API: no
 * backend is started. NEXT_PUBLIC_WEB_QR_CHECKIN is inlined when the portal is built, so the flag value is fixed at
 * start: WEB_CHECKIN_FLAG=true (default) serves the flag-on specs on port 3123; WEB_CHECKIN_FLAG=false serves the
 * flag-off specs on port 3124. Each flag value gets its own dev dist dir. The gym page flag is on in both.
 *
 *   npx playwright test --config playwright.web-checkin.config.ts
 *   WEB_CHECKIN_FLAG=false npx playwright test --config playwright.web-checkin.config.ts
 */
const flagOn = (process.env.WEB_CHECKIN_FLAG ?? 'true') === 'true';
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || (flagOn ? 3123 : 3124));
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /web-checkin\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_PUBLIC_WEB_GYM_PROFILE=true NEXT_PUBLIC_WEB_QR_CHECKIN=${flagOn ? 'true' : 'false'} NEXT_DIST_DIR=.next-dev-web-checkin-${flagOn ? 'on' : 'off'} npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
