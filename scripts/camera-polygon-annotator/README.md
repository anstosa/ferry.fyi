# Ferry FYI camera detection debugger

Recommended launch from the repo root:

```bash
yarn container:up
yarn start
```

Open the main menu as the owner in development and select **Detector**:

```text
http://localhost:4040/dev/camera-detection
```

The detector provides three development routes:

```text
http://localhost:4040/dev/camera-detection
http://localhost:4040/dev/camera-detection/benchmarks
http://localhost:4040/dev/camera-detection/capture
```

The links and routes are mounted only when `NODE_ENV=development`. JSON mutations and detector requests still pass through the owner-admin authorization boundary. `yarn container:up` starts the local detector container. The app uses `FERRY_DETECTOR_URL` when set, otherwise the stack's `CAR_DETECTION_ENDPOINT`, then falls back to `http://127.0.0.1:8001/detect` for host development.

The standalone debugger remains available for recovery or focused use:

```bash
FERRY_DETECTOR_URL=http://127.0.0.1:9001/detect yarn camera:polygons
```

App data file edited directly:

```text
shared/data/camera-detection-areas.json
```

## What's included

- All 61 Ferry FYI/WSDOT cameras from `shared/data/wsf-core.json`.
- Auto-loads `shared/data/camera-detection-areas.json` through the local server.
- **Save JSON** overwrites `shared/data/camera-detection-areas.json`.
- Reviewed checkbox for cameras that have been inspected, including cameras with no relevant ferry polygons.
- Include polygons: `queue_lane`, `holding_lane`, `holding_lot`, `ferry_slip`.
- Exclusion polygons: intersections, driveways, crosswalks, parking, opposing lanes, or other ignore/break regions.
- Browser autosave on this computer.
- Backup download/copy still available.
- Font Awesome controls use per-icon deep imports to generate a small standalone SVG sprite; the debugger does not load the full icon pack or Font Awesome browser runtime.
- Compact zoom controls: zoom in/out, fit width, or return to 1:1. Enable **Pan** to drag a zoomed image on mouse or touch; desktop users can also hold Space or middle-drag temporarily.
- Polygon editing: click a polygon on the image or click Edit, drag vertices, click an edge to add a point, select a point and delete it.
- Mobile image navigation: pinch with two fingers to zoom around the gesture midpoint.
- Detail editing: select a polygon, change Occupancy/Exclusion, type, id, or label, then click Apply details.
- Image labels use the polygon Label field, not the internal id.
- Smaller overlays: thin borders, compact vertex dots, and smaller image labels.
- Label placement: labels try to sit inside polygons and avoid overlapping earlier labels.
- Uses actual loaded image dimensions to avoid stretching stale catalog sizes.
- **Detect vehicles** crops to include polygons, blacks out exclusion polygons, and overlays only countable returned boxes. Use **Clear detections** to remove the active overlay.
- Benchmark mode loads immutable test or control frames from `benchmarks/camera-detection`.
- Each benchmark polygon can be labeled `empty`, `minority_full`, `majority_full`, or `full` and saved to `benchmarks/camera-detection/labels.json`.
- **All empty** speeds up negative-control labeling without creating vehicle counts.
- The top-level **Capture** tab starts bounded background recording sessions from the detector. Select enabled cameras and set any two of image limit, time limit, or interval; the third value is calculated automatically.
- Capture run cards show stored, duplicate, failed, and imported file counts. Stop active runs, copy unique completed frames into the benchmark labeling set, then delete the raw session when it is no longer needed.

## Workflow

1. From the repo root, run `yarn container:up`, then `yarn start`, open the **Camera detection** admin tab, and follow the **Open polygon editor** link.
2. Pick a camera.
3. If the camera has no relevant ferry detection regions, check **Reviewed** and save.
4. Otherwise choose Occupancy or Exclusion.
5. Choose the polygon type.
6. Click **Draw polygon**.
7. Click around the exact boundary.
8. Click **Finish**. Adding a polygon marks the camera reviewed.
9. To change a saved polygon, click it in the image or click **Edit** on its card. Drag points, click an edge to add a point, or select a point and click **Delete point**. Shift-clicking a point also deletes it when the polygon has more than 3 points. Change Occupancy/Exclusion, type, id, or label, then click **Apply details**.
10. Repeat. You can add multiple polygons per camera.
11. Click **Save JSON**. This overwrites `shared/data/camera-detection-areas.json`.

## Benchmark labeling workflow

1. Open the top-level **Capture** tab and select the enabled cameras to sample.
2. Set any two schedule values. Image limit is per camera, time limit bounds the run, and interval controls each capture round. Start the run and leave the development server running.
3. When the run completes, select **Add to labeling**. Unique images are copied into `benchmarks/camera-detection/frames` and added to the test-frame manifest. Raw capture files remain isolated until you delete them.
4. Return to the top-level **Benchmarks** tab, then choose **Controls**, **Tests**, or **All** in the benchmark panel.
5. Select a stored frame; it loads immediately. Polygon editing is disabled in benchmark mode.
6. Select one ground-truth occupancy state for every green/colored queue or holding polygon. Each selection saves immediately and focuses the next unlabeled polygon or loads the next incomplete frame. Select the active state again to clear and save it without advancing.
7. Add frame notes for weather, glare, staleness, loading transitions, or ambiguity.
8. Use **All empty** only when every configured polygon is visibly empty.
9. Run **Detect vehicles** to overlay detector signals for comparison; labels remain independent of predictions.
10. Use **Save labels** to retry or explicitly confirm persistence when needed.
11. Use **Next unlabeled** to jump to the next incomplete frame in the selected frame set.

## Rules

- Includes should only cover ferry queue lanes, holding lanes, holding lots, or ferry slips where spatial occupancy should be evaluated.
- Exclusions should cover intersections/driveways/crosswalks/breaks that split queue lanes or suppress false positives.
- Do not include parked cars, opposing traffic, normal through traffic, sidewalks, shoulders, side streets, or non-ferry lanes.

## Note

If you open `index.html` directly as a file, browsers block silent overwrites. Use a linked development route or `run-annotator.sh` for **Save JSON** to overwrite the app data file.
