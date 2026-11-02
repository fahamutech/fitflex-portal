import { defineConfig, devices } from '@playwright/test';

/**
 * Public gym page specs (tests/e2e/web-gym-profile.spec.ts; backend functions#281) run against a mocked API: no
 * backend is started. NEXT_PUBLIC_WEB_GYM_PROFILE is inlined when the portal is built, so the flag value is fixed at
 * start: WEB_GYM_FLAG=true (default) serves the flag-on specs on port 3121; WEB_GYM_FLAG=false serves the flag-off
 * spec on port 3122. Each flag value gets its own dev dist dir.
 *
 *   npx playwright test --config playwright.web-gym.config.ts
 *   WEB_GYM_FLAG=false npx playwright test --config playwright.web-gym.config.ts
 */
const flagOn = (process.env.WEB_GYM_FLAG ?? 'true') === 'true';
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || (flagOn ? 3121 : 3122));
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /web-gym-profile\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_PUBLIC_WEB_GYM_PROFILE=${flagOn ? 'true' : 'false'} NEXT_DIST_DIR=.next-dev-web-gym-${flagOn ? 'on' : 'off'} npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
