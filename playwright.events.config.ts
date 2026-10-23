import { defineConfig, devices } from '@playwright/test';

/**
 * Events S2 specs (tests/e2e/events-*.spec.ts) run against a mocked API: no backend is started (playwright.config.ts
 * would start the sibling fitflex-functions checkout). The portal is a static export, so NEXT_PUBLIC_EVENTS_MODULE is
 * fixed at start: EVENTS_FLAG=true (default) serves the flag-on specs on port 3101; EVENTS_FLAG=false serves
 * events-flag-off.spec.ts on port 3102. Each flag value gets its own dev dist dir so the inlined flag is never stale.
 *
 *   npx playwright test --config playwright.events.config.ts
 *   EVENTS_FLAG=false npx playwright test --config playwright.events.config.ts
 */
const flagOn = (process.env.EVENTS_FLAG ?? 'true') === 'true';
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || (flagOn ? 3101 : 3102));
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: flagOn ? /events-(?!flag-off)[a-z0-9-]+\.spec\.ts$/ : /events-flag-off\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_PUBLIC_EVENTS_MODULE=${flagOn ? 'true' : 'false'} NEXT_DIST_DIR=.next-dev-events-${flagOn ? 'on' : 'off'} npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
