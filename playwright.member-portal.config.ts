import { defineConfig, devices } from '@playwright/test';

/**
 * Member portal specs (tests/e2e/member-portal.spec.ts) run against a mocked API: no backend is started.
 * NEXT_PUBLIC_MEMBER_PORTAL is inlined when the portal is built: MEMBER_PORTAL_FLAG=true (default) serves the flag-on
 * specs on port 3125; MEMBER_PORTAL_FLAG=false serves the flag-off spec on port 3126.
 *
 *   npx playwright test --config playwright.member-portal.config.ts
 *   MEMBER_PORTAL_FLAG=false npx playwright test --config playwright.member-portal.config.ts
 */
const flagOn = (process.env.MEMBER_PORTAL_FLAG ?? 'true') === 'true';
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || (flagOn ? 3125 : 3126));
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /member-portal\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_PUBLIC_MEMBER_PORTAL=${flagOn ? 'true' : 'false'} NEXT_DIST_DIR=.next-dev-member-${flagOn ? 'on' : 'off'} npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
