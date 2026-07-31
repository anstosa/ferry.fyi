# AGENTS.md

## Project overview

Ferry FYI is a TypeScript web and Android app for Washington State Ferries schedules, route status, vehicle-capacity forecasts, bulletins, traffic cameras, tickets, account alerts, and native mobile conveniences. The app is deployed as a Heroku-hosted web service and packaged for Android with Capacitor.

## Repository layout

- `client/` — React app, Vite config, SCSS/Tailwind styling, PWA service worker, browser/native integration, and user-facing views.
- `server/` — Express API/server, Sequelize models and migrations, WSF refresh jobs, Auth0/Firebase helpers, weather/tide ingestion, and notification logic.
- `shared/` — cross-runtime contracts, static ferry/camera/terminal data, and pure utility logic used by both client and server.
- `tests/` — Vitest coverage split by `client`, `server`, and `shared` behavior.
- `android/` — Capacitor Android project and Gradle configuration. Treat generated Capacitor files as generated unless you are running `npx cap sync android`.
- `docs/` — durable project notes, currently including weather forecasting details.
- `scripts/` — local dev, DB, and runtime helper scripts.

## Local setup

1. Use Node `^24.0.0` and Yarn classic.
2. Install dependencies with `yarn`.
3. Copy `.envrc.sample` to `.envrc` and fill in the required local credentials. `scripts/start-dev.js` loads `.envrc` automatically on Unix-like systems.
4. Start Postgres locally. The package helper is `yarn db:start`, which starts a Docker Postgres container with `postgres://test:testing@localhost:5432/ferryfyi`.
5. Initialize the database with `yarn db:migrate`.
6. Start local development with `yarn start` or `yarn start:dev`, then open `http://localhost:4040`.

## Important environment variables

- `BASE_URL`, `PORT`, `DATABASE_URL`, and `PGSSLMODE` control the local server and DB connection.
- `WSDOT_API_KEY` is required for live ferry data refreshes.
- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_AUDIENCE`, `AUTH0_CLIENT_REDIRECT`, `AUTH0_SERVER_ID`, `AUTH0_SERVER_SECRET`, and `AUTH0_SERVER_AUDIENCE` control Auth0 login and API auth.
- `FCM_PUBLIC_KEY`, `GCM_SENDER_ID`, and Firebase credentials support push notifications.
- `MAPBOX_ACCESS_TOKEN`, `GOOGLE_ANALYTICS`, `GTM_CONTAINER_ID`, and `SENTRY_DSN` support maps, analytics, and error reporting.
- Never commit filled `.envrc`, keystores, signing passwords, or production secrets.

## Common commands

- `yarn start` — run client and server together using `scripts/start-dev.js`.
- `yarn start:client` — run only the Vite client on all interfaces.
- `yarn start:server` — run only the Express dev server through `scripts/register-esbuild.js`.
- `yarn build` — build both client and server for production.
- `yarn build:client` / `yarn build:server` — build one side only.
- `yarn test` — run the Vitest suite once.
- `yarn test:watch` — run Vitest in watch mode.
- `yarn test:coverage` — run Vitest with coverage.
- `yarn type-check` — type-check client and server.
- `yarn lint` — lint SCSS and TypeScript.
- `yarn lint:fix` — run available CSS and JS autofixes.
- `yarn db:start` / `yarn db:stop` — start or stop the local Docker database.
- `yarn db:migrate` — run Sequelize migrations.
- `yarn db:reset` — reset the local database with `scripts/resetdb.sh`.

## Android and native support

- Capacitor config lives in `capacitor.config.ts`; the Android package id is `fyi.ferry`.
- The native project targets the Android SDK configured in `android/variables.gradle` and uses Gradle via `android/gradlew`.
- This repo uses Capacitor 8 plugins, including the official `@capacitor/barcode-scanner` package for native ticket scanning.
- If JS/native plugin dependencies change, run `npx cap sync android` and commit the generated Capacitor Android updates.
- For a native debug build, run `cd android && ./gradlew --no-daemon assembleDebug`.
- For local device testing, run the web build/sync path with `yarn start:android` or run `npx cap run android` through `yarn android` after Android SDK/JDK setup.
- Keep `android/local.properties`, Gradle caches, `android/app/build/`, `android/build/`, and packaged web assets out of commits unless intentionally generated and tracked.

### App-release version control

- Before triggering the `Publish apps` GitHub Action (or any Android/iOS release action), confirm the exact requested version name and target platform with the user.
- Never infer, auto-increment, or otherwise change a requested app version. Dispatch only the user-confirmed version; if it is missing or ambiguous, ask before triggering the action.
- Report the confirmed version and source commit/ref when starting the release, then report the completed workflow result.

### Git change control

- Do not create commits or push changes to any remote unless the user explicitly asks to commit or push. Local edits and validation are allowed without that request.

## Architecture notes

- The client talks to the server through helpers in `client/lib/api.ts`; keep API shape changes synchronized with `shared/contracts/*` and server routes.
- Server API controllers are mounted under `/api` from `server/server.ts`; static client rendering is mounted at `/`.
- WSF, weather, tide, and schedule refresh jobs start from `server/server.ts` after `dbInit`.
- Shared ferry data lives in `shared/data`; prefer updating these canonical files instead of duplicating route, terminal, vessel, or camera facts in client/server code.
- Time and ferry-domain helpers are mostly in `shared/lib`; prefer pure shared helpers for logic that needs tests.
- Auth0 browser/native redirect handling is in `client/entry-client.tsx`, `client/clientRuntime.tsx`, and `client/App.tsx`; native login also depends on Capacitor `App` and `Browser` plugins.

## Development guidance for agents

- Prefer existing patterns, aliases, scripts, models, and contracts before adding new abstractions or dependencies.
- Keep `client/static/llms.txt` current whenever public pages, user-facing features, or AI-useful API endpoints change. It must describe Ferry FYI directly, link only to Ferry FYI pages, and document authentication, freshness, and safety constraints for any API it lists.
- Keep owner admin operations, notification send paths, public content/SEO controls, `docs/admin-operations.md`, `docs/leaderboards.md`, and `client/static/llms.txt` aligned; new privileged jobs must use the owner admin boundary, and new notification sends must use the final shared policy boundary.
- Keep frontend/API boundary changes typed through `shared/contracts` when possible.
- For DB changes, add a Sequelize migration and corresponding model/test coverage.
- For scheduled ingestion or forecast logic, add focused tests under `tests/server` or `tests/shared` before claiming behavior is safe.
- For visible UI changes, validate the rendered app when practical; otherwise run the narrowest relevant client tests, type-check, and lint.
- For Android/native changes, run `npx cap sync android`, `yarn type-check:client`, and an Android Gradle build when practical.
- Do not reformat unrelated files or remove existing dirty work outside the requested scope.

## Recommended validation by change type

- Client-only UI or browser logic: `yarn type-check:client`, `yarn lint:js:client`, plus targeted Vitest tests if existing coverage applies.
- Server/API/model logic: `yarn type-check:server`, `yarn lint:js:server`, and targeted `tests/server` cases.
- Shared utilities/contracts: `yarn type-check`, relevant `tests/shared` or client/server contract tests.
- Native/Capacitor changes: `npx cap sync android`, `yarn type-check:client`, and `cd android && ./gradlew --no-daemon assembleDebug`.
- Broad dependency or framework changes: `yarn type-check`, `yarn lint`, `yarn test`, and production build checks as time allows.
