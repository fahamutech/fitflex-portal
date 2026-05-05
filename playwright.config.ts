import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry'
  },
  webServer: [
    {
      command: 'npm --prefix ../fitflex-functions run start:fs',
      port: 3000,
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: 'npm run dev:portal',
      port: 3001,
      reuseExistingServer: true,
      timeout: 60_000
    }
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
