# Camera detection areas

`camera-detection-areas.json` is the app-data source for manually reviewed camera regions used by future ferry line-length detection.

- `allowedAreas` are regions where vehicle detections may count toward a ferry queue, holding lane, holding lot, or ferry slip.
- `detectionEnabled: false` keeps reviewed polygons available for QA while excluding that camera from scheduled and public line detection.
- Every enabled allowed area reports one spatial occupancy state: `empty`, `minority_full`, `majority_full`, or `full`.
- Spatial occupancy measures the share of the polygon's principal lane axis covered by detected vehicle boxes. Minority ends below 50%, majority begins at 50%, and full begins at 85%; benchmark results should tune those thresholds before a user-facing launch.
- `excludedAreas` are holes/breaks/ignore regions inside or near allowed areas, such as intersections and driveways.
- `reviewed: true` means the camera has been manually inspected. A reviewed camera may have zero polygons when no relevant ferry detection region exists.
- Coordinates are normalized `[x, y]` values in image space, with origin at the top-left of the loaded camera image.
- `frameSize` records the image dimensions observed by the annotator. These may differ from stale WSDOT catalog dimensions for some traffic cameras.

Edit this file with the repo-local annotator:

```bash
cd scripts/camera-polygon-annotator
./run-annotator.sh
```

The annotator reads and writes `shared/data/camera-detection-areas.json` directly through its local server.
Its detector request crops and masks the image to allowed areas, then blacks out exclusion areas before inference. Only countable detections are shown in the annotator and QA overlays.

## QA overlays

Render polygon-only QA overlays:

```bash
python3 scripts/render-camera-detection-overlays.py
```

Render line-detection QA overlays with classified detection boxes and counts:

```bash
python3 scripts/render-camera-line-detection-results.py --api-url http://localhost:4040/api/cameras/line-detection
```

Without `--api-url` or `--results-json`, the line-detection renderer writes an explicit unavailable-result overlay so stale/missing detector output is visible in review artifacts.
