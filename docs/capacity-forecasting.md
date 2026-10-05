# Capacity forecasting

Ferry FYI estimates vehicle space from live Washington State Ferries capacity
reports and comparable historical sailings. The estimate is planning guidance,
not a boarding guarantee.

## Capacity-reporting state

WSF can publish a future sailing with every vehicle space still available before
active capacity reporting begins. Ferry FYI stores the first time a crossing
reports fewer than all assigned spaces in
`Crossing.capacityReportingStartedAt`.

- The timestamp is nullable epoch seconds and advances only from `null` to the
  first observed reporting time.
- A future all-open row with no reporting-start timestamp is treated as an
  uninformative placeholder.
- Once reporting has started, a later all-open row remains meaningful while its
  capacity report is fresh and is ignored after it becomes stale.
- Partial reports, cancellations, and past sailings retain their existing
  behavior.

`FORECAST_CAPACITY_REPORTING_GATE=on` selects this stateful classifier.
`FORECAST_CAPACITY_REPORTING_GATE=off` selects the retained legacy four-hour and
staleness classifier for operational rollback. The capacity gate is independent
of the demand-shock mode. The legacy rollback also retains a live all-open row
when no historical estimate exists, matching the pre-change live-only fallback;
the stateful gate remains conservative in that case.

The additive migration must be deployed before application code that selects
the new model field. Old application versions ignore the nullable column. New
web and worker code normalize a missing field from an old process to `null`.
Do not reverse the migration while old and new processes may be running.

## Directional demand shocks

The demand-shock estimator looks for recent same-direction traffic that differs
from the route's established pattern. It uses only completed outcomes available
before the forecast's `asOf` time and performs all calendar bucketing in
`America/Los_Angeles`.

Historical occupied vehicles are normalized to the target sailing's assigned
capacity before comparison. This prevents a change in vessel size from looking
like a change in demand. The estimator combines two bounded signals:

- **Recent route demand** compares the last 21 days with an older reference
  cohort for comparable weekday, daypart, and local-hour buckets.
- **Sustained same-day demand** uses three to five completed sailings from the
  same service day and decays as the target moves farther into the future.

Both signals require minimum row counts and effective sample sizes. They are
shrunk toward no adjustment, limited independently, and capped to a combined
25-percent occupied-share change. Adjustments shift the existing weighted
historical capacity distribution rather than overwriting its variance.

The response deliberately reflects asymmetric warning costs. Positive overload
evidence remains fully responsive. Negative evidence follows a continuous
ease-in curve, requiring stronger evidence before Ferry FYI withdraws a
full-boat warning. The shifted full probability is smoothly regularized toward
the exact baseline with paired positive ease-out and negative ease-in curves.
Both preserve the baseline at zero adjustment and reach the shifted calibration
at the 25-percent cap. This avoids letting small sample shifts cause
disproportionate jumps between existing calibration tails. For a material shock,
a candidate point that still rounds into the strict-full range is moved just
outside that range only when its regularized full probability is below 50
percent.

The final forecast reconciles full-probability and full-risk after live capacity,
weather, bounds, and rollover are applied; it does not rewrite the final capacity
point or its probability-derived risk band. The client presents a forecast as
full when fewer than 10 percent of vehicle spaces are forecast to remain, while
showing its probability-derived risk separately. A likely or high
probability-derived risk also hides the point space count and presents the
forecast as full. Live capacity remains authoritative when it is informative.

## Runtime modes

`FORECAST_DEMAND_SHOCK_MODE` accepts:

- `off`: return the current baseline and skip demand-shock work.
- `shadow`: compute the complete candidate but return a byte-equivalent
  baseline.
- `on`: return the candidate.

The local default is `on`. AWS production configuration is pre-armed with
`FORECAST_DEMAND_SHOCK_MODE=on`. Existing image versions without this
implementation ignore the setting. The first deployed image containing the
implementation will activate the demand-shock model directly in `on`; no
representative-weekday `shadow` evidence is claimed. Set the mode to `off` for
an immediate demand-model rollback. Set the capacity-reporting gate to `off`
only for a verified placeholder-classifier regression.

One aggregate forecast log records the selected modes, all-open rows suppressed
or accepted, separate recent-regime and same-day eligible/applied counts, applied
targets, capped targets, mean and maximum absolute-space changes, coherence
rewrites, probability bins, and elapsed time. It does not log raw crossing rows
or user data.

## Backtesting

The paired walk-forward command gives baseline and candidate the same target,
assigned capacity, `asOf`, and exact base comparable rows. The candidate alone
receives the full same-direction history available before `asOf`.

```bash
yarn forecast:backtest --year 2025 --lead-minutes 30 --compare-demand-shock --json --assert
yarn forecast:backtest --year 2025 --lead-minutes 120 --compare-demand-shock --json --assert
yarn forecast:backtest --year 2025 --lead-minutes 360 --compare-demand-shock --json --assert
yarn forecast:backtest --from 2026-08-17 --to 2026-08-31 --pair 5-14 --lead-minutes 30 --compare-demand-shock --json --assert
```

Reports include MAE and P90 space errors, strict-full metrics at no more than two
percent available, practical-full metrics below ten percent available, Brier
score, recall, precision, false-full rate, miss rates, coherence violations, and
signal counts. Paired assertions also verify matching target counts, capacities,
`asOf` values, and comparable-input digests. Do not use
`--persist-calibration` for evaluation-only runs because it writes calibration
rows.

## Public and worker boundaries

`capacityReportingStartedAt` is private operational state. Public schedule
responses use a recursive allow-list projection and never expose the field.
Forecast worker messages use a separate private DTO that includes and normalizes
the field. Demand diagnostics stay private; public estimates expose only the
existing capacity, risk, confidence, source, and readable factor contracts.

## Temporal drive-up fill estimates

`fill-linear-v1` estimates when provider-reported **drive-up** space reaches literal
zero, separate from reservation inventory and the existing combined eventual-full
classifier. One fresh direct displayed count plus the separate drive-up departure
forecast supports an immediate deterministic estimate; there is no training wait
or provisional badge. The explicit zero-at-departure prior places exhaustion ten
minutes before projected departure, with a three-minute minimum horizon, then
blends eligible live Theil–Sen slopes and bounded rate ranges. Projection starts at
the observation's receive time, including its age, not the current request time.
If a lagging positive departure forecast exceeds the fresh observed spaces, it
cannot define a zero-depletion prior. That prior is discarded; qualifying live
observations supply a live-only slope, otherwise capacity remains unknown.

Direct zero is `already-full`; extrapolated zero from a positive anchor is
`predicted-full-by-now`. Inactive all-open placeholders cannot supply a live slope
or fill label. Hidden, derived-repair, stale, cancelled, post-departure and
cross-segment evidence is excluded. WSF provides no upstream update clock or
physical-decrement guarantee, so observed zero is a received reporting proxy, not
proof of the exact tollbooth or loading event.

The leave-now tool evaluates drive-up inventory at terminal ETA. Its adjustable
five-minute buffer affects the conservative sailing selection, not actual arrival
or the displayed boarding probability. Vehicle fullness does not reject
walking, cycling or transit. Booth queues, parking and reservation-aware boarding
are excluded. Estimates do not guarantee boarding.

Append-only capacity observations retain poll and physical allocation identity,
reporting state and causal forecast context for 400 days. Repairs retain separate
trigger provenance and never become ground truth. The `fill-timing:backtest` command
reports censor-aware interval error, range coverage, event classification and
false availability at fixed synthetic horizons; sample gates apply only to future
empirical-validation claims, not immediate V1 release.
Positive-only reports ending more than five minutes before projected departure
are early right-censored outcomes, excluded from event classification rather than
counted as confirmed non-events. Near-departure coverage uses the same five-minute
tolerance as observation segmentation.

### Leave-now sailing chances

`joint-triangular-v1` estimates the chance a rider can make each nearby sailing,
not which boat they will actually board. Each sailing is evaluated independently.
It does not reuse the historical probability that a sailing fills at departure.

Travel uses an assumed triangular duration distribution centered on Google's
point duration `d`. Its half-width is `max(120s, 0.15*d, abs(d-staticDuration))`;
traffic-unaware driving widens this to at least `max(300s, 0.25*d)`. Google's
`staticDuration` is a non-current-traffic baseline, not an uncertainty interval.
The depletion rate uses an assumed triangular distribution with the existing
fill model's low, point and high rates. These assumptions are planning priors,
not measured boarding-success rates or statistical confidence intervals.

The model integrates 101 fixed midpoint travel quantiles with the analytic
triangular rate CDF. Displayed driver success requires both arrival before the
projected departure minus cutoff and positive drive-up inventory at that same
arrival. Travel and depletion rate are assumed independent; their marginal
success probabilities are **not multiplied**. Capacity support spans the earliest
arrival with the slowest depletion to the latest arrival with the fastest
depletion. The API retains 0–60 minute buffer-indexed readiness-target chances;
entry zero is the actual-cutoff boarding chance shown by the UI. Increasing the
preferred buffer changes the conservative recommendation, not that sailing's
displayed probability or inventory at arrival. Non-driving modes use travel timing
only.

Cancelled, departed, mode-ineligible and directly observed-full driver sailings
have zero joint chance; independently knowable timing remains available. When
usable live inventory is absent, a finite forecasted full probability in [0, 1]
supplies the capacity chance as its complement, multiplied by the timing chance.
This fallback does not invent observed spaces, depletion rates or an occupancy
curve. Without either live inventory or a valid forecast, capacity remains
unknown, not zero. Point-full or point-late neighbors can
retain nonzero chance from earlier travel or slower depletion tails. The center
remains the existing deterministic recommendation, not a new probability
threshold. Snapshot sailing identities distinguish same-time vessels.

The Navigation card shows arrival in app-defined light/moderate/heavy traffic
colors using the delay against Google's baseline. These are not Google's road
segment categories and require no Enterprise traffic-polyline request. Unknown
traffic remains neutral. Chance headings round to five-percentage-point steps;
modeled extremes use `<5%` / `>95%`, while hard exclusions may show `0%`.
The app applies a global three-minute boarding cutoff separately from operator
arrival advice. One Earlier, Estimated or Later block is always selected, with
Estimated selected on a fresh response. Expanded details show a shared-scale
timeline ending at Later's departure, independent live-capacity areas for each
sailing, the selected Sailing markers, and a vertical ETA marker matching the
arrival traffic color. Forecast-only sources do not fabricate capacity areas.
All 0–60 minute buffer outcomes and nearby assessments reuse one provider request.
Every displayed capacity anchor contributes to expiry, and material schedule or
vessel changes invalidate the response. Google attribution remains below the
results directly on the page background, outside the removed card wrapper.

Lines outside the toll booth are not included. Estimates do not guarantee boarding.
