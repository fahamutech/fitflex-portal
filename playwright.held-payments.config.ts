import { defineConfig, devices } from '@playwright/test';

/**
 * Held payments worklist spec (tests/e2e/admin-held-payments.spec.ts): mocked API, no backend started.
 *
 *   npx playwright test --config playwright.held-payments.config.ts
 */
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || 3114);
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /admin-held-payments\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_DIST_DIR=.next-dev-held-payments npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
