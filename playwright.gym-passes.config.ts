import { defineConfig, devices } from '@playwright/test';

/**
 * Custom gym passes specs (tests/e2e/gym-passes.spec.ts; backend functions#355) run against a mocked API: no backend is
 * started. NEXT_PUBLIC_GYM_CUSTOM_PASSES is inlined when the portal is built, so the flag value is fixed at start:
 * GYM_PASSES_FLAG=true (default) serves the flag-on specs on port 3127; GYM_PASSES_FLAG=false serves the flag-off
 * specs on port 3128. Each flag value gets its own dev dist dir. The flag-on build also has the member portal and the
 * public gym page on: a pass is listed on /g and bought on /m/gym-passes.
 *
 *   npx playwright test --config playwright.gym-passes.config.ts
 *   GYM_PASSES_FLAG=false npx playwright test --config playwright.gym-passes.config.ts
 */
const flagOn = (process.env.GYM_PASSES_FLAG ?? 'true') === 'true';
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || (flagOn ? 3127 : 3128));
const apiURL = process.env.FITFLEX_API_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /gym-passes\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${portalPort}`, trace: 'on-first-retry' },
  webServer: {
    command: `NEXT_PUBLIC_API_BASE=${apiURL} NEXT_PUBLIC_GYM_CUSTOM_PASSES=${flagOn ? 'true' : 'false'} NEXT_PUBLIC_MEMBER_PORTAL=${flagOn ? 'true' : 'false'} NEXT_PUBLIC_WEB_GYM_PROFILE=${flagOn ? 'true' : 'false'} NEXT_DIST_DIR=.next-dev-gym-passes-${flagOn ? 'on' : 'off'} npx next dev -p ${portalPort}`,
    port: portalPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
