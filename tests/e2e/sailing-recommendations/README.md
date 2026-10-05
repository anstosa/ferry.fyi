# Sailing recommendation browser fixture

This fixture mounts the production navigation form and response parser with synthetic
schedules and importer-specific location, transport and share adapters. It does
not call Google, invoke a native share provider, read credentials, retain real
origins, or represent a live provider smoke.

```sh
NODE_ENV=test yarn vite build --config tests/e2e/sailing-recommendations/vite.config.ts
python3 -m http.server 55768 --bind 127.0.0.1 --directory dist/e2e/sailing-recommendations
SAILING_FIXTURE_URL=http://127.0.0.1:55768/ node tests/e2e/sailing-recommendations/browser-check.mjs
```

The browser check uses real Chromium through the repository's Playwright package
and writes screenshots plus a redaction/network/console report under
`.omx/evidence/sailing-capacity-chart-browser/`. Available query scenarios are
`buffer-only-late`, `success`, `denied`, `vehicle-full`, `stale`, `expired`, `provider-error`,
`pending-success`, `pending-error`, `recursion`, `tight-timing`,
`capacity-unavailable`, `capacity-recovery`, `tied-repair`, `forecast-capacity`, `departed-clock`, `midnight`,
`multi-full`, `moderate`, `heavy` and `traffic-unavailable`; `theme=dark` selects class-based
dark mode.
Fixtures use the production travel/depletion model and buffer/neighbor builders
rather than fabricated chance percentages. The forecast-capacity scenario
supplies schedule forecast probabilities without live observations, the
departed-clock scenario crosses a projected departure during the response
validity window, midnight crosses the terminal-local day boundary without live
capacity, and the pending scenarios retain the result-shaped skeleton for one
second before success or failure. Chromium also exercises URL control
restoration, raw anchor preservation, address retention, browser history, and a
synthetic native-share result without sending fragment data over HTTP. The Vite
fixture shares the production SVG component transform so the icon-based method
controls render correctly. Result and skeleton alignment checks cover 320 px,
375 px, and 1280 px viewports, including exact arrival/share centering,
adjacent-sailing label gaps, and horizontal overflow.
Expanded-result checks also exercise the production shared-scale SVG timeline
at all three viewport widths. They verify exact source-time markers, bounded
colored ranges, rotated-label geometry, collision-free text polygons, internal
scroll reachability, Pacific-midnight ordering, coincident events, one-sided
unknown fill bounds, and the absence of replaced timing rows. Forecast-only sources must omit invented live-capacity curves; departure-clock
updates still zero the chance without shifting the frozen estimate frame. The
multi-full scenario supplies three declining observations per sailing to exercise
three dense exhaustion-caption banks and backlog spanning multiple boats; the compact chart omits visible detail titles, figure captions, allocation
footnotes and all numeric statistics below the graph. Exact source and unknown
bound descriptions remain accessible in the SVG.

Use an unused loopback port if 55768 is already occupied. Serve only the built
fixture directory, not the repository or environment files. The separately run
PostgreSQL rehearsal is in `tests/server/boat-database-integration.test.ts` and
requires its explicit isolated local URL; ordinary tests intentionally skip it.

The capacity chart uses the production optional live projection contract and the
global three-minute cutoff. Only the blue Sailing horizontal timeline remains,
with Departure and Cutoff markers and a right-aligned heading. The Scheduled
dot and label appear only when its time differs from Departure. A
full-height dotted blue vertical line marks the selected cutoff. Arrival uses
one full-height dotted vertical line with a centered, vertically rotated
ETA caption; both match the arrival time’s traffic color in the active theme
(green light, amber moderate, red heavy, or neutral unknown/non-driving); the horizontal You line and Earliest/Latest arrival annotations are
removed. Arrival uncertainty informs boarding chance at the actual cutoff. The safety
buffer selects a more conservative sailing but does not reduce the displayed
chance for that same sailing.
Capacity percentages are inferred from the graph, so numeric y-axis captions are
omitted; the underlying empty-to-full scale and grid are retained.

The Earlier, Estimated and Later blocks are native selection buttons. A fresh
estimate selects Estimated by default and repeated clicks never collapse it.
Label, time, vessel and keyboard selection change only Sailing and its cutoff,
not the ETA marker, axes, shared chart frame or capacity sets. The fixed axis
runs from the estimate snapshot's now to displayed Later's projected departure,
or the last available displayed sailing if Later is absent. Off-window markers
remain boundary-clamped with true timestamps and accessible explanations.

Sailing and fill captions use compact 22 px horizontal spacing and level
45-degree banks without connector lines. Sailing flips to clockwise, left-aligned
packing when its earliest caption would be pushed past the true time anchor.
The graph reserves all selectable caption widths/heights, keeping the vertical
ETA caption below Sailing annotations. Mobile scrolling is contained to the graph.

Each eligible displayed sailing has its own closed capacity area, rate envelope,
exact saturation corners and departure boundary. Quantitative preceding models
supply departure reset and uncapped excess-demand carryover. Missing, departed
or directly full predecessors cannot suppress the next sailing's own valid live
model: it renders the actual source occupancy without assuming an empty baseline
or measurable queue. A directly full source itself renders a truthful flat full
area. `data-model-basis` distinguishes `live` from `departure-reset` sources.
Unknown source data and forecast full probability do not fabricate occupancy.
These display models do not change server boarding probabilities.

A known central fill darkens its own area through departure; a dotted orange
line uses the earliest known fill bound. Annotations are bounded per sailing and
unknown bounds remain unknown. The chart retains the bottom-right Capacity
caption and accessible source/time descriptions without visible detail titles,
figure captions, allocation footnotes or statistics below it.

The capacity-recovery fixture supplies live observations only for later sailings
and proves their areas survive missing predecessors. The tied-repair fixture
supplies direct and repair-derived reports at equal timestamps and verifies that
the direct report remains authoritative. Newer unmatched repair boundaries still
invalidate older direct segments in focused server regression tests. Chromium
checks full-height marker positions/colors, centered vertical ETA text, absence
of replaced horizontal arrival content and capacity-axis captions, independent
area bounds, stable selections, polygon collisions, light/dark themes and narrow
screens. No fixture makes an external provider request.

The buffer-only-late scenario places ETA three minutes before cutoff with ample
capacity while a five-minute preference selects the later boat. Chromium verifies
the earlier boat still shows a high cutoff-based chance, green timing, and
unchanged probability when the safety buffer changes, without another request.
