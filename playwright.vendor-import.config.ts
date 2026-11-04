import { defineConfig, devices } from '@playwright/test';

/**
 * Vendor Smart Import (tests/e2e/vendor-import.spec.ts) and the other fully mocked vendor specs, against a mocked API:
 * no backend is started (every request to the API address is answered by page.route; anything else is aborted).
 * NEXT_PUBLIC_API_BASE is set to localhost here on purpose: the portal's built-in fallback is the live API.
 * Its own port and dev dist dir so it never shares a dev server with other configs.
 *
 *   npx playwright test --config playwright.vendor-import.config.ts
 *
 * vendor-management.spec.ts is not included: it talks to a real backend.
 */
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || 3122);
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(apiURL)) throw new Error(`FITFLEX_API_URL must be localhost, got ${apiURL}`);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /vendor-(import|portal|sales|customers|documents|refunds|reports)\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_DIST_DIR=.next-dev-vendor-import npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
