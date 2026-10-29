import { defineConfig, devices } from '@playwright/test';

/**
 * Shop merch specs (tests/e2e/shop-banners.spec.ts, tests/e2e/shop-flash-sales.spec.ts) run against a mocked API:
 * no backend is started (every request to the API address is answered by page.route; anything else is aborted).
 * Its own port and dev dist dir so it never shares a dev server with other configs.
 *
 *   npx playwright test --config playwright.shop-merch.config.ts
 */
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || 3121);
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /shop-(banners|flash-sales)\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_DIST_DIR=.next-dev-shop-merch npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
