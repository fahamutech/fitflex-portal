# fitflex-portal

FitFlex Af gym-operator + admin portal — Next.js 15 (App Router), Tailwind v4, TypeScript. Login uses Firebase Google sign-in.

Talks to `fitflex-functions` (default `http://localhost:3000`).

## Run

```bash
npm install
npm run dev          # http://localhost:3001
```

Backend must be running:
```bash
npm --prefix ../fitflex-functions start
```

## Demo login

Assign the Google account email to the matching FitFlex user record:

| Role          | Seed email                     |
|---------------|--------------------------------|
| Gym operator  | `operator@iron-paradise.tz`    |
| FitFlex admin | `mama27j@gmail.com`             |

Set Firebase web config before running:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

## Admin

`/admin` includes gym onboarding, payment approvals, member state, and payout readiness. Pilot pass requests remain pending until an admin approves them.

## E2E tests (Playwright)

The suite starts its own backend (from a `fitflex-functions` checkout) and portal dev server on ports 4310/4311, on an isolated database it creates and migrates. It refuses to run against a non-localhost API, or a database that is not local and named `fitflex_ci_*` / `fitflex_e2e_*`.

```bash
npx playwright install chromium
export FITFLEX_FUNCTIONS_DIR=/path/to/fitflex-functions   # default ../fitflex-functions; a fresh worktree (no .env) is best
export FITFLEX_E2E_DATABASE_URL=postgresql://localhost:5432/fitflex_e2e_portal_mine   # use a new name
npm run test:e2e
```

Servers already on those ports are reused only with `FITFLEX_E2E_REUSE_SERVERS=1` (never in CI). `tests/e2e/flutter-marketplace-web.spec.ts` runs only when `FITFLEX_FLUTTER_WEB_URL` points at a Flutter web build. CI runs the suite in the Portal Checks workflow.

The spec at `tests/e2e/checkin-flow.spec.ts` exercises the full member-→ operator check-in slice end to end.

## i18n

All user-facing strings live in `src/lib/i18n.ts` (EN + SW). Locale toggles in the header and persists in `localStorage`.

## Design tokens

CSS custom properties declared in `app/globals.css` under `@theme` (Tailwind v4) — keep in sync with `fitflexmobile/lib/shared/design_tokens.dart`.
# fitflex-portal
