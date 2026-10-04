# Sailing recommendation implementation validation

Validated locally on 2026-10-03 UTC. Production Google routing remains disabled.

## Implemented surfaces

- `client/views/Schedule/SailingRecommendationCard.tsx`: explicit foreground or
  manual origin, four methods, five-minute adjustable buffer, expiry/revision
  guards, attribution, warnings, timing-only and capacity estimates.
- `server/services/public/sailingRecommendations.ts` and
  `server/lib/sailingRecommendations.ts`: one provider call, causal snapshots,
  complete compressed buffer domain, stronger-capacity selection and normalized
  origin-free diagnostics.
- `server/lib/fillTiming.ts`, `server/lib/wsf/updateCapacity.ts`, and observation
  migration/model: immediate causal linear estimates, immutable physical-group
  observations, censor-aware zeros, atomic direct/repair persistence and retention.
- Google Routes accounting/Monitoring/WIF helpers, Terraform web-role isolation,
  readiness verifier and `docs/google-routes-operations.md`.

## Evidence

- Full TypeScript checks and repository lint passed.
- Client/server/SSR production builds and artifact smoke checks passed.
- Generated OpenAPI consistency and Redocly validation passed.
- Terraform validation and three runtime configuration tests passed.
- Focused feature suite passed: 13 files, 124 tests; the subsequently added
  destination-provenance regression also passed.
- Isolated PostgreSQL migration up/down and database constraints/concurrency
  rehearsal passed (three tests). All repository migrations then applied
  successfully to that disposable local database.
- Chromium fixture checks passed: nine scenarios across desktop/mobile, keyboard,
  dark mode, expiry/revision, tight timing, denial/manual recovery, buffer reuse
  and provider/recursion errors. No startup location/API activity, external
  requests or console errors; origin absent from URL/storage/remaining form.
  Screenshots/report live under `.omx/evidence/sailing-recommendations-browser/`.
- Backtest fixture command passed and explicitly reports
  `deterministic-baseline-only`, not empirical validation or calibrated probability.

## Full-suite limitation

The ordinary full test command was run. A clean archived HEAD reproduced its
pre-existing environment-sensitive failures: ambient Auth0 credentials trigger
unmocked revocation queries, SEO/sitemap fixtures require migrated public-state
and feature tables, and the legacy `tests/server/forecast.test.ts` fake timers
block production `setImmediate` yields.

After removing ambient `AUTH0_SERVER_SECRET` from the test process and using an
isolated migrated PostgreSQL database, every file except that unchanged legacy
forecast test passed: **323 files, 2,068 tests passed; seven files/31 tests skipped**.
The reproducible regression command is:

```sh
NODE_ENV=test env -u AUTH0_SERVER_SECRET \
  DATABASE_URL=postgres://boat_test:boat_test@127.0.0.1:16632/boat_test \
  yarn test --exclude tests/server/forecast.test.ts
```

The exclusion is explicit: this is not a claim that the ordinary full suite is
green. No unrelated forecast/auth/SEO implementation or test fixtures were changed.

## Remaining launch gates

- Owner-reviewed booth points configured per terminal in `/admin?tab=terminals`;
  booths remain unset until explicitly saved. All modes use the booth, and public
  maps independently use the saved dock or WSF fallback.
- Server key/API restriction, default-off app-config values, project quota and
  rotation; populate all referenced Secrets Manager fields before task deployment.
- Billing-account SKU inventory, four confirmed opening-email policies, explicit
  closure behavior, separate delayed USD-1 Actual budget, Monitoring cost review.
- Exact dedicated web-role WIF binding and live preproduction metric smoke.
- Real provider smoke for all four methods and retention volume/index review.

No credentials, external billing resources, email policies or production flags
were changed. No commits or pushes were made. Booth lines, parking, reservations,
future trip planning and background tracking remain excluded.

## Non-blocking proof gaps from final review

The reviewer approved the implementation remediation with no remaining production
defects found. Coverage can still be expanded for the combined observation plus
mutable-Crossing real-database rollback (current proofs cover real observation
rollback and mocked ingestion/cache rollback separately), the complete
logger/Sentry/analytics privacy matrix, and explicit duplicate/repair/postdeparture
evaluator exclusion-count fixtures. These are not claims of completed acceptance
proof or substitutes for the external launch gates.

## Combined-chance results update — 2026-10-03

The Navigation result now shows traffic-colored terminal ETA, the point-selected
sailing centered between its chronological neighbors, and expandable per-sailing
estimated chances. The tight-timing warning is removed. Required Google Maps
attribution sits in a compact footer below the main card, within a shared visual
container. The form, explicit origin actions, exact booth-line disclaimer and
local-only activation settings are unchanged.

`joint-triangular-v1` combines assumed travel-time and drive-up depletion
uncertainty at the same sampled arrival; non-drivers use timing only. Details
expose the priors, deadline, buffer, space support, fill range, freshness and
marginal chances. These are conditional model estimates, not measured success
rates. Unknown inventory stays unknown; direct zero and structural exclusions
stay zero without destroying the independently knowable timing curve. Same-time
vessels carry distinct snapshot IDs. Point-selection failure is explicitly
qualified so it cannot contradict a surviving modeled tail.

Fresh validation for this update:

- Seven focused files / **110 tests passed** covering provider normalization,
  joint model, selection/neighbor integration, strict client boundary, UI and
  revision rules.
- Client and server TypeScript checks passed. Targeted ESLint passed with zero
  errors; asynchronous fixture callbacks retain warning-only `require-await`
  diagnostics.
- Canonical OpenAPI generation consistency and Redocly validation passed.
- Isolated production-component Vite fixture build passed. Fresh Chromium checks
  passed across **12 scenarios**: desktop/mobile, light/dark, all traffic states,
  adjacent sailings, expansions, local buffer reuse, unknown/direct-zero chance,
  retired warning, manual denial recovery, stale revisions and provider errors.
  Console and external request checks were clean; **no paid Google calls** were
  made. Evidence: `.omx/evidence/sailing-results-browser/`.
- The configured local URL rendered the mobile Navigation form with HTTP 200,
  zero page errors and zero provider-endpoint requests:
  `https://dev.ferry.fyi/seattle/bainbridge/navigation`.

The browser-role MCP surface was unavailable in this run; Chromium evidence was
collected using the repository's existing Playwright harness instead. The fixture
now includes the same SVG component transform as the production app. This is a
rendered UI validation, not a fresh live-provider or production activation claim.
No keys, flags, cloud resources, production deployments, commits or pushes were
changed by this results update. Existing broader-suite limitations above remain
explicit; the full repository suite was not repeated for this update.

## Repeated-origin freshness fix — 2026-10-04

Each explicit origin action now reads the existing cached-schedule endpoint before
requesting directions. Selecting a Google address suggestion immediately starts
that estimate; typing alone still requests only suggestions, and manual text
still requires form submission. Results no longer compare a fresh server revision
only against the page's older schedule snapshot. If inventory changes during the
request, the client reconciles once with a cache-only read without repeating the
paid Google route request. Genuine material changes and the existing expiry
window remain guarded.

Results and expiry timers are scoped to the originating request. Mode changes,
navigation and raw address edits invalidate obsolete completions. Both schedule
GET and cache POST share a request generation, preventing an older same-route
completion from replacing newer schedule, error or loading state. Origins remain
transient, and adjusting the safety buffer causes no network request.

Fresh validation:

- Nine focused client files / **105 tests passed**, including location-to-address,
  repeated selected addresses, expired-result replacement, older-timer isolation,
  cache failure and route guards, one free reconciliation, a third revision during
  directions and reverse-ordered same-route schedule reads.
- Client TypeScript, targeted ESLint, Prettier and diff checks passed.
- Real configured Navigation page checked with Chromium at 375px and 1280px:
  location followed by two selected addresses produced three intercepted estimate
  requests, four cache reads including the simulated race reconciliation, no
  expired warning, zero page errors and no extra buffer requests. Feature provider
  endpoints were intercepted before reaching the server: **no paid Google calls**.
  Evidence: `.omx/evidence/estimate-freshness/`.
- Read-only architecture review cleared the request and revision guards. Browser
  MCP was unavailable; the existing repository Playwright/Chromium package
  provided the rendered verification instead.

No server API, provider credentials, cost settings, production deployment,
commits or pushes changed. This is not a new live-provider validation or a claim
that the full repository suite passed.

## Sailing result presentation update — 2026-10-04

The three columns now use fixed Earlier, Estimated and Later headings and vessel
names. Departure times use the displayed coarse boarding percentage: red at 30%
or less, orange from 31–69%, green from 70% upward, and neutral for an unavailable
chance. The five-percentage-point rounding and uncertainty model are unchanged.
Expand controls use down/up chevrons, the repeated Estimated chance caption is
removed, and the long model disclaimer is removed from the detail panel. The
main booth-line/boarding disclaimer, detail values and required safety warnings
remain. Only the exact unwanted tools/tolls notice is hidden.

Google Maps attribution is directly on the page background beneath the card,
inside the same transparent layout wrapper. Existing text, sizing, color and
translation protection remain; measured contrast was 6.16:1 in light mode and
16.93:1 in dark mode. Google requires associated, legible attribution near the
content: [Routes API attribution guidelines](https://developers.google.com/maps/documentation/routes/policies).

A schedule-hydration bug could replace a known vessel name with Vessel plus its
ID when a crossing omitted its name while metadata was warming. Full and cached
schedule updates now preserve names by matching vessel ID, including known swaps;
an unknown different vessel never borrows another vessel's name. The UI uses
Vessel unavailable rather than numeric placeholders when a real name is missing.
The local Seattle–Bainbridge cached schedule returned proper names for all 22
slots after the repair.

Fresh validation:

- Seven focused files / **130 tests passed** across client presentation, provider
  boundaries, model/revision rules and full/cached schedule assignment behavior.
- Client and server TypeScript checks, owned-file ESLint, Prettier and diff checks
  passed.
- Production-component fixture build and **12 Chromium scenarios** passed with
  no external provider calls or browser console errors. Evidence:
  `.omx/evidence/sailing-results-polish/`.
- The configured Navigation page was checked at 375px light/dark and 1280px dark
  with intercepted synthetic results: correct titles and names, all three color
  bands, chevrons and expanded details, removed text, credit outside the card,
  no extra requests on expansion and zero page errors. Evidence:
  `.omx/evidence/navigation-results-polish-live/`.

Browser MCP remained unavailable; the repository's existing Playwright/Chromium
package supplied rendered verification. No Google calls, new dependencies,
credentials, production settings, commits or pushes changed. The full repository
suite was not repeated.

## Chance colors and delayed-sailing investigation — 2026-10-04

The three headline percentages now share their sailing-time color, including the
existing displayed rounding and light/dark thresholds. Missing chances display
Unknown rather than Chance unavailable and remain neutral. The same formatting
also shortens missing marginal chances in expanded details. No probability,
capacity freshness rule or per-sailing event definition changed.

Read-only local evidence reproduced the Clinton–Mukilteo screenshot. The Later
Tokitae projected at 1:41 PM was the scheduled 1:00 PM sailing. Its last direct
capacity receipt was 1:04 PM, active with 26 spaces. Refreshes continued normally,
but observations stopped for that departure and returned arrival-row counts
dropped from 149 to 147 at 1:05 PM. Ingestion inserts every returned departure
without a scheduled-time cutoff. This supports upstream report omission rather
than a local filter; no raw historical provider response was retained.

The sanitized receipt replay produced a 95.124% individual boarding chance with
a 180-second-old anchor. At 181 seconds and at the screenshot's 240-second age,
capacity and boarding chance became unknown while timing probability remained
100%. Suquamish's separate fresh inventory cannot establish Tokitae's inventory.
An exact cumulative chance of boarding any boat by a departure is a different
event and was not silently substituted for this individual-sailing estimate.

Fresh validation:

- Six focused files / **148 tests passed**, including a regression replaying
  the delayed sailing across the 180/181/240-second freshness boundary.
- Client typecheck, changed production-file ESLint, Prettier and diff checks
  passed.
- Production-component fixture build and **12 Chromium scenarios** passed,
  checking percentage colors and neutral Unknown alongside existing controls.
- Four configured-page Chromium cases checked mobile light/dark, desktop dark
  and a later Unknown: computed percentage colors matched their departure times,
  with zero page errors and no additional requests when details expanded.
- Evidence: `.omx/evidence/chance-colors-unknown/`,
  `.omx/evidence/chance-colors-unknown-live/` and
  `.omx/evidence/chance-colors-unknown-investigation/report.json`.

Browser MCP was unavailable; existing repository Playwright/Chromium tooling
provided rendered verification. No paid provider calls, database writes, new
dependencies, credentials, production settings, commits or pushes changed. The
full repository suite was not repeated.
