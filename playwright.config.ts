import { defineConfig, devices } from '@playwright/test';

const apiPort = Number(process.env.FITFLEX_API_PORT || 3000);
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || 3001);
const apiURL = process.env.FITFLEX_API_URL || `http://localhost:${apiPort}`;
const portalURL = process.env.FITFLEX_PORTAL_URL || `http://localhost:${portalPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: portalURL,
    trace: 'on-first-retry'
  },
  webServer: [
    {
      command: `/usr/local/bin/bfast fs serve --port ${apiPort} --static`,
      cwd: '../fitflex-functions',
      port: apiPort,
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: `NEXT_PUBLIC_API_BASE=${apiURL} npx next dev -p ${portalPort}`,
      port: portalPort,
      reuseExistingServer: true,
      timeout: 60_000
    }
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
