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

```bash
npx playwright install chromium
npm run test:e2e
```

The spec at `tests/e2e/checkin-flow.spec.ts` exercises the full member-→ operator check-in slice end to end.

## i18n

All user-facing strings live in `src/lib/i18n.ts` (EN + SW). Locale toggles in the header and persists in `localStorage`.

## Design tokens

CSS custom properties declared in `app/globals.css` under `@theme` (Tailwind v4) — keep in sync with `fitflexmobile/lib/shared/design_tokens.dart`.
# fitflex-portal
