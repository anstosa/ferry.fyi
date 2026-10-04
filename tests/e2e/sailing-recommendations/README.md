# Sailing recommendation browser fixture

This fixture mounts the production card and response parser with synthetic
schedules and two importer-specific low-level adapters. It does not call Google,
read credentials, retain origins, or represent a live provider smoke.

```sh
NODE_ENV=test yarn vite build --config tests/e2e/sailing-recommendations/vite.config.ts
python3 -m http.server 55768 --bind 127.0.0.1 --directory dist/e2e/sailing-recommendations
SAILING_FIXTURE_URL=http://127.0.0.1:55768/ node tests/e2e/sailing-recommendations/browser-check.mjs
```

The browser check uses real Chromium through the repository's Playwright package
and writes screenshots plus a redaction/network/console report under
`.omx/evidence/sailing-results-browser/`. Available query scenarios are
`success`, `denied`, `vehicle-full`, `stale`, `expired`, `provider-error`, and
`recursion`, `tight-timing`, `capacity-unavailable`, `moderate`, `heavy` and
`traffic-unavailable`; `theme=dark` selects class-based dark mode. Fixtures use
the production travel/depletion model and buffer/neighbor builders rather than
fabricated chance percentages. The Vite fixture shares the production SVG
component transform so the icon-based method controls render correctly.

Use an unused loopback port if 55768 is already occupied. Serve only the built
fixture directory, not the repository or environment files. The separately run
PostgreSQL rehearsal is in `tests/server/boat-database-integration.test.ts` and
requires its explicit isolated local URL; ordinary tests intentionally skip it.
