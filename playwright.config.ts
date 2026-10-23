import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The e2e suite starts its own backend (from a fitflex-functions checkout) on an
// isolated database, and its own portal dev server, on non-default ports so it
// never attaches to another session's servers on 3000/3001.
//
//   FITFLEX_FUNCTIONS_DIR      fitflex-functions checkout (default ../fitflex-functions)
//   FITFLEX_E2E_DATABASE_URL   isolated local Postgres DB named fitflex_ci_* or fitflex_e2e_*;
//                              created and migrated before the backend starts
//   FITFLEX_API_PORT           backend port (default 4310)
//   FITFLEX_PORTAL_PORT        portal port (default 4311)
//   FITFLEX_E2E_REUSE_SERVERS  1 = reuse servers already on those ports (local only)
//
// It refuses to run against a non-localhost API or a database not named for tests.
// The backend still reads a .env in FITFLEX_FUNCTIONS_DIR for anything not set
// here, so point it at a checkout without one (a fresh worktree has none).

const apiPort = Number(process.env.FITFLEX_API_PORT || 4310);
const portalPort = Number(process.env.FITFLEX_PORTAL_PORT || 4311);
const apiURL = process.env.FITFLEX_API_URL || `http://localhost:${apiPort}`;
const portalURL = process.env.FITFLEX_PORTAL_URL || `http://localhost:${portalPort}`;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const TEST_DB_NAME = /^fitflex_(ci|e2e)_[a-z0-9_]+$/;

function refuse(message: string): never {
  throw new Error(`[e2e] Refusing to run: ${message}`);
}

function hostOf(name: string, url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return refuse(`${name} is not a URL: ${url}`);
  }
}

for (const [name, url] of [['FITFLEX_API_URL', apiURL], ['FITFLEX_PORTAL_URL', portalURL]]) {
  const host = hostOf(name, url);
  if (!LOCAL_HOSTS.has(host)) refuse(`${name} must be localhost, got ${host}. Tests never run against a live API.`);
}

const databaseURL = process.env.FITFLEX_E2E_DATABASE_URL
  || refuse('set FITFLEX_E2E_DATABASE_URL to an isolated local database, e.g. postgresql://localhost:5432/fitflex_e2e_portal');
const dbHost = hostOf('FITFLEX_E2E_DATABASE_URL', databaseURL);
const dbName = decodeURIComponent(new URL(databaseURL).pathname.replace(/^\//, ''));
if (!TEST_DB_NAME.test(dbName)) refuse(`database "${dbName}" is not named fitflex_ci_* or fitflex_e2e_*.`);
if (!LOCAL_HOSTS.has(dbHost)) refuse(`database host must be localhost, got ${dbHost}.`);

// Specs and helpers read FITFLEX_API_URL; workers inherit it from here.
process.env.FITFLEX_API_URL = apiURL;

const functionsDir = path.resolve(process.env.FITFLEX_FUNCTIONS_DIR || '../fitflex-functions');

/** The public Firebase web config from .env.example (public by design; the deploy workflow uses the same values). */
function publicPortalEnv() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path.join(__dirname, '.env.example'), 'utf8').split('\n')) {
    const match = /^(NEXT_PUBLIC_(?:FIREBASE|GOOGLE)_[A-Z_]+)=(.+)$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const backendEnv = {
  FITFLEX_USE_CI_DB: '1',
  DATABASE_URL_CI: databaseURL,
  // The backend's default database is the test one too, should anything read it directly.
  DATABASE_URL: databaseURL,
  KYC_ENFORCEMENT: 'off',
  NODE_ENV: 'development',
  // Uploads are checked (type, size) before they reach storage; a dead local address
  // keeps those checks running and makes sure nothing is ever sent to the real storage service.
  ZEBRA_BASE_URL: 'http://127.0.0.1:9',
};

// A server already on a port is reused only when asked for, and never in CI: anything
// else on the port (another session's server, on another database) would be tested instead.
const reuseExistingServer = !process.env.CI && process.env.FITFLEX_E2E_REUSE_SERVERS === '1';

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
      command: `node scripts/create-db.mjs && npx knex --knexfile knexfile.cjs migrate:latest && bfast fs serve --port ${apiPort} --static`,
      cwd: functionsDir,
      env: backendEnv,
      port: apiPort,
      reuseExistingServer,
      timeout: 180_000
    },
    {
      command: `npx next dev -p ${portalPort}`,
      env: { ...publicPortalEnv(), NEXT_PUBLIC_API_BASE: apiURL },
      port: portalPort,
      reuseExistingServer,
      timeout: 120_000
    }
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
