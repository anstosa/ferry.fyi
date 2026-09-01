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
point or its probability-derived risk band. The client separately presents a
near-capacity warning when fewer than 10 percent of vehicle spaces are forecast
to remain, so a practical-full point does not appear as an all-clear. A likely
or high probability-derived risk hides the point space count and presents the
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
