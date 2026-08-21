# Automatic check-in evidence reports

Physical T0/V0/V1 and R1 results must be summarized without creating a second
location or identity data store. The evidence command accepts aggregate strata
only, rejects unknown fields, calculates Wilson success intervals and paired
battery confidence bounds, and preserves the reviewed R1 amendment as a separate
release gate.

```bash
yarn evidence:automatic-checkins \
  --input automatic-checkin-evidence.json \
  --output automatic-checkin-evidence-summary.json
```

The output path must not already exist. This prevents a later run from silently
replacing an earlier receipt. Start from
`docs/automatic-checkin-evidence.example.json` and create one cell for each
non-poolable platform, OS class, device class, lifecycle, and detector stratum.
Each materially different fixed `scenario` is a separate cell rather than being
pooled into another lifecycle result. Android OS classes use exact API levels 26
through 37; iOS classes use exact major versions 15 through the currently
reviewed iOS 27 preview. `osReleaseChannel` records `stable` or `beta`; preview
evidence cannot satisfy a stable physical cell.

## Aggregate input contract

- `release` is the exact 7-12 character hexadecimal short commit, while
  `version`, `configGeneration`, and `serverPolicyGeneration` identify the app
  build and immutable server state.
- `localWorkCohort` is one opaque label from `cohort-a` through `cohort-z`. It
  must not be a raw per-install `localWorkGeneration` or identity-derived text.
- `gate` is exactly `t0`, `v0`, `v1`, `r1-pilot`, or `r1-release`. T0 accepts
  terminal evidence; V0 and V1 accept vessel evidence; R1 accepts either.
- `attempts`, `successes`, fixed failure/outcome buckets, delay buckets, and
  accuracy buckets must all reconcile to the same attempt count. Every failure
  must be present in the complete outcome buckets; successful outcome counts are
  derived rather than accepted as a second independent claim.
- `batteryDeltasPercentagePoints` is either `null` or at least three paired
  enrolled-minus-feature-off measurements from identical hardware and settings.
  Samples are accepted only in a fixed `battery-*` scenario with exact screen,
  network, thermal, randomized-order, and OS energy-diagnostic controls.
- `artifactLinks` may contain HTTP(S) links without credentials, query strings,
  or fragments. Linked artifacts must already be redacted.
- `falseCredits`, `expiredCredits`, `duplicateCredits`, `invariantBreaches`, and
  `privacyResult` are explicit zero-tolerance fields. Any nonzero breach or
  privacy failure sets `stopRuleTriggered`.

The schema deliberately has no route, terminal, vessel, sailing, subject,
enrollment, credential, candidate, coordinate, accuracy value, exact event
time, request body, config content, or raw native generation field. Unknown
fields fail the entire report instead of being copied through.

## Interpretation

Five attempts with at least one success and no stop-rule breach establish only
`observed-not-release-approved` characterization for that cell. The report
includes both a two-sided Wilson interval for characterization and a one-sided
95% Wilson lower confidence bound for comparison with a later frozen reliability
target. These bounds do not create that target. Battery output includes a
two-sided paired t interval plus the one-sided 95% upper confidence bound required
by R1, but remains characterization until the reviewed power analysis freezes a
minimum sample size and upper-bound gate.

Pixel, Samsung, and iPhone cells are labeled `physical-device`. Android emulator
and iOS simulator cells are always labeled supporting-only and cannot acquire a
physical characterization label regardless of their observed success count. A
physical device on a beta OS is likewise labeled supporting-only.

Every clean report remains `not-assessed-requires-reviewed-r1-amendment`; a
zero-tolerance breach reports `blocked-stop-rule`. Neither the tool nor a clean
five-attempt smoke sample can authorize production rollout.

## Prospective R1 power plan

After product and security supply reviewed target assumptions, copy
`docs/automatic-checkin-r1-plan.template.json`, replace every `null`, and run:

```bash
yarn evidence:automatic-checkins:r1-plan \
  --input automatic-checkin-r1-plan.json \
  --output automatic-checkin-r1-plan-summary.json
```

Probabilities are integer permille values. For each detector, the planner finds
the first sample size whose exact binomial probability of meeting the one-sided
Wilson lower-bound target reaches the requested power. The output is always
`draft-requires-independent-reviewed-amendment`; calculations cannot attest that
the inputs were reviewed and cannot authorize rollout.
