# Internal OpenAI camera pipeline

This opt-in server pipeline is separate from the existing YOLO detector and
public camera results. It is for owner-only inspection and subsequent model
benchmarks. No model is selected by default, and no public endpoint invokes it.

## Configuration

Apply the `20261023000100-create-openai-camera-pipeline-state.js` migration
through the normal database migration command before enabling the pipeline.
Build the updated detector runtime so that its non-inference `/prepare`
endpoint is available. This endpoint reuses Pillow but never runs YOLO.

The following server-only environment variables are required:

| Variable                              | Meaning                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `OPENAI_CAMERA_ENABLED`               | Must be exactly `true` to run inference; defaults disabled.               |
| `OPENAI_CAMERA_API_KEY`               | Dedicated camera key; never falls back to `OPENAI_API_KEY`.               |
| `OPENAI_CAMERA_MODEL`                 | Explicit model/candidate chosen for later benchmarking; no default.       |
| `OPENAI_CAMERA_PREPROCESSOR_ENDPOINT` | Private `/prepare` URL, e.g. `http://detector:8000/prepare` in Compose.   |
| `OPENAI_CAMERA_IMAGE_DETAIL`          | `auto` by default; `low`, `high`, and `original` depend on model support. |

Provision keys outside Git. Changing configuration does not enable public
rollout. Model-selection benchmarks, live activation, and production deployment
remain separate operator actions. Do not enable a candidate in production just
to test configuration readiness.

## Owner access

`GET /api/admin/openai-cameras` returns readiness (never the API key), the
versioned prompt, reviewed camera/lane metadata, storage availability, and the
latest durable state. It requires the existing verified owner bearer token and
uses `Cache-Control: no-store`. A GET only reads stored evidence; it never
fetches a camera or calls OpenAI. Before migration the endpoint reports
`storageAvailable: false` without exposing database details.

The existing `/admin?tab=operations` screen lists
`openai-camera-line-detection-refresh`. The normal owner-operation confirmation
and lease apply. Manual invocation outside the first 30 seconds of a five-minute
boundary does not create an off-tick prompt, and invoking while disabled spends
nothing. The singleton scheduler starts rounds at `:00`, `:05`, `:10`, etc.; it
does not warm this pipeline with an off-tick startup inference.

## Sampling and search

- Each camera can be submitted at most once per clock slot, not once per rolling
  300 seconds. A 10:01 follow-up is eligible again at 10:05, but not at 10:04.
- One initial prompt groups the selected changed images across terminals.
  Follow-ups are serial and contain one additional camera. Empty selections
  send no prompt. An expired round does not submit into a newer slot or accept
  late model results as current evidence.
- Cold start and periodic validation scan the entire enabled/reviewed annotated
  set. Full validation is capped at 15-minute intervals; stable checks back off
  from 5 to 10 to 15 minutes. Changed or uncertain evidence resets the backoff.
- Ordinary checks run only when a non-cancelled vehicle departure is predicted
  within the next hour or occurred in the previous fifteen minutes. No-service
  and overnight schedules do not trigger image or model work.
- Full scans also run on the last tick strictly before the app's current
  delay-adjusted predicted departure. Predicted 10:03 scans at 10:00; predicted
  10:10 scans at 10:05. Later delay predictions can require a later scan.
  Cancelled and passenger-only sailings do not trigger a vehicle-queue scan.
- Otherwise start at the previous furthest non-empty, non-passing camera and
  move outward or inward to bound the new tail. Visibility/fetch failures are
  unknown, never evidence that the queue is empty. Paired views retain their
  common physical-marker identity.

## Image preparation and results

The processor validates the annotated source dimensions, masks target/excluded
polygons, and selects a minimum-area native-scale rotated crop. It never
downsamples. Thin outer outlines and numeric markers identify the ordered
section IDs without painting over countable pixels. Non-right-angle rotation
uses interpolation, not scaling.

Canonical decoded countable-pixel fingerprints ignore outside-lane changes,
annotation ink, and image metadata. Unchanged lane content can reuse the prior
classification even in a mandatory full scan. Model, prompt, and geometry
changes invalidate relevant cached results. Source freshness and check time
remain distinct from inference time; stale/frozen source evidence is not
reported as a fresh empty lane.

The strict model response contains only camera ID, image visibility flag, and
per-section camera/lane IDs, skip flag, `empty | low | high | full` occupancy,
and passing flag. Visibility-skipped sections keep their IDs and have null
occupancy/passing. Passing from a still is a gap-based heuristic, not measured
motion. Invalid, incomplete, refused, or failed responses are not converted
into empty results or retried inline. Responses are sent with `store: false`.

Clinton front/back sections are explicitly mapped to physical lanes, including
the irregular Lane 6 Back ID. Server-side occupancy averages equally using
coarse scores `empty=0`, `low=0.25`, `high=0.675`, `full=1`, then thresholds
0/50%/85%; full + empty becomes high. These scores are not measured percentages.
An invisible required section makes combined occupancy unknown; raw section
passing evidence remains separate.

Only derived results, fingerprints, timings, and attempt reservations are
persisted in the singleton `OpenaiCameraPipelineStates` JSONB row. A monotonic
round claim and fenced saves prevent replay across restarts and stale owners.
Raw frames and the dedicated key are not stored there. A timed-out request can
still have incurred provider cost; reservations prevent automatic replay, not
an unsupported exactly-once billing guarantee.

## Validation without paid calls

```sh
yarn test tests/server/openai-camera-*.test.ts
# run durable fencing against a disposable local postgres database
OPENAI_CAMERA_STORE_TEST_DATABASE_URL="$DATABASE_URL" yarn test tests/server/openai-camera-store-postgres.test.ts
yarn type-check:server
yarn lint:js:server
cd detector-runtime && PYTHONPATH=. python -m pytest -q
```

The opt-in PostgreSQL suite creates and removes its own isolated schema and is
enabled in CI. Point it only at a disposable test database, not production.

Tests mock OpenAI and camera transport, and exercise synthetic pixel geometry,
strict outputs, all front/back combinations, queue search, delayed departures,
slot eligibility, stable backoff, stale imagery, and persistent round fencing.
Accuracy, real token usage, and model selection require the separate planned
benchmark phase.
