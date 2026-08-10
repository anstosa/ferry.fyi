# Camera spatial-occupancy benchmark

This benchmark evaluates the four-state output for each configured queue or holding polygon:

1. `empty`
2. `minority_full`
3. `majority_full`
4. `full`

The benchmark unit is one immutable camera frame plus one configured polygon. Human labels are the control truth. Detector boxes and exact vehicle counts are not benchmark outputs.

## Seed selection

The initial **test set** contains one frame from every currently enabled pilot camera:

- Clover Lane
- Mukilteo Holding
- Clinton Holding
- Tollbooth / uphill
- Food Mart / east SR 525
- Post Office / west SR 525
- 5th Street north
- 5th Street south

The initial **control set** contains known non-production views that should not influence live queue state:

- 76th Street / school south
- Clover Lane empty control

These ten seed frames prove the capture, labeling, and scoring workflow. They are not large enough to approve the model.

## Sampling plan

Grow the dataset in complete eight-camera test rounds so each operating moment has comparable coverage. Select rounds across:

- empty, minority-full, majority-full, and full queues
- morning, midday, evening, and darkness
- dry, rain, glare, fog, and low-contrast conditions
- loading transitions and recently cleared holding lanes
- fresh frames, repeated frames, and explicitly stale frames

For every five test rounds, capture at least one negative-control round containing normal through traffic, parked vehicles, opposing traffic, or disabled camera views.

Target the first decision-quality dataset at **20 labeled examples per state for each polygon type**, with at least **20 control frames**. Keep the seed set separate so threshold tuning does not silently overwrite the original baseline.

## Metrics

Report metrics across polygons, then break them down by camera and polygon type:

- exact four-state accuracy
- ordinal mean absolute error using state positions 0–3
- within-one-state accuracy
- empty false-occupied rate
- majority/full recall
- full false-positive rate
- confusion matrix
- detector unavailable and stale-frame rates, reported separately from occupancy

Initial acceptance targets for a user-facing pilot:

- at least 80% exact-state accuracy
- at least 95% within-one-state accuracy
- no more than 5% empty false-occupied rate
- at least 90% majority/full recall
- no full prediction more than one state above its control label

## Labeling

Run the existing debugger and use its benchmark mode:

```bash
yarn camera:polygons
```

Choose a control frame, assign one state to every configured polygon, optionally add a note, and save benchmark labels. Labels are written to `benchmarks/camera-detection/labels.json`.

Capture a replacement seed set only intentionally:

```bash
python scripts/capture-camera-detection-benchmark.py --replace
```

## Bounded recording sessions

Record every enabled, reviewed pilot camera on a fixed interval into an isolated
session directory. The recorder stores each unique image once and records stale
or repeated responses as manifest metadata rather than duplicate image files.

```bash
yarn camera:benchmark:record \
  --session-id weekend-2026-08-07 \
  --stop-at 2026-08-10T08:00:00-07:00
```

The default interval is 600 seconds. Each session contains `session.json`, an
append-only `manifest.jsonl`, and LFS-managed images under `frames/`. Recording
requires at least 2 GiB of free disk by default and refuses concurrent writers
to the same session.

The development detector now manages the same recorder from **Capture images for
labeling**. Set any two of image limit, time limit, and interval; select eligible
cameras; then start the bounded run. Completed runs can be copied into the test
frame manifest with **Add to labeling**. Import deduplicates by camera and image
hash, copies canonical LFS-managed images into `frames/`, and leaves the raw
session isolated so it can be deleted after review.
