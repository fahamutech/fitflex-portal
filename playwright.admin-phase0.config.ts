import { defineConfig, devices } from '@playwright/test';

/**
 * Admin Phase 0 portal specs (tests/e2e/admin-load-errors.spec.ts): mocked API, no backend started.
 *
 *   npx playwright test --config playwright.admin-phase0.config.ts
 */
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || 3113);
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /admin-load-errors\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_DIST_DIR=.next-dev-admin-phase0 npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
