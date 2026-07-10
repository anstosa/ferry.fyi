# Ferry FYI manual camera polygon tool

Recommended launch from the repo root:

```bash
yarn container:up
yarn camera:polygons
```

Then use the browser tab it opens:

```text
http://127.0.0.1:8787/
```

`yarn container:up` starts the local detector container. The annotator proxies image bytes to `http://127.0.0.1:8001/detect` by default; override it when needed with `FERRY_DETECTOR_URL`, for example:

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
- **Save app data JSON** overwrites `shared/data/camera-detection-areas.json`.
- Reviewed checkbox for cameras that have been inspected, including cameras with no relevant ferry polygons.
- Include polygons: `queue_lane`, `holding_lane`, `holding_lot`, `ferry_slip`.
- Per-include `vehicleCapacity` for the number of cars that fit when a zone is full.
- Exclusion polygons: intersections, driveways, crosswalks, parking, opposing lanes, or other ignore/break regions.
- Browser autosave on this computer.
- Backup download/copy still available.
- Zoom controls: zoom in/out, fit width, 100%, or choose a fixed percentage.
- Polygon editing: click a polygon on the image or click Edit, drag vertices, click an edge to add a point, select a point and delete it.
- Detail editing: select a polygon, change Include/Exclude, type, id, label, or vehicle capacity, then click Update selected details.
- Image labels use the polygon Label field, not the internal id.
- Smaller overlays: thin borders, compact vertex dots, and smaller image labels.
- Label placement: labels try to sit inside polygons and avoid overlapping earlier labels.
- Uses actual loaded image dimensions to avoid stretching stale catalog sizes.
- **Detect vehicles** crops to include polygons, blacks out exclusion polygons, and overlays only countable returned boxes. Use **Clear detections** to remove the active overlay.

## Workflow

1. From the repo root, run `yarn container:up`, then `yarn camera:polygons`.
2. Pick a camera.
3. If the camera has no relevant ferry detection regions, check **Reviewed** and save.
4. Otherwise choose Include or Exclude.
5. Choose the polygon type.
6. Click Start polygon.
7. Click around the exact boundary.
8. Click Finish polygon. Adding a polygon marks the camera reviewed.
9. To change a saved polygon, click it in the image or click Edit under it. Drag points, click an edge to add a point, or select a point and click Delete selected point. Shift-clicking a point also deletes it when the polygon has more than 3 points. Change Include/Exclude, type, id, or label, then click Update selected details.
10. Repeat. You can add multiple polygons per camera.
11. Click Save app data JSON. This overwrites `shared/data/camera-detection-areas.json`.

## Rules

- Includes should only cover ferry queue lanes, holding lanes, holding lots, or ferry slips where cars should be counted/associated.
- Exclusions should cover intersections/driveways/crosswalks/breaks that split queue lanes or suppress false positives.
- Do not include parked cars, opposing traffic, normal through traffic, sidewalks, shoulders, side streets, or non-ferry lanes.

## Note

If you open `index.html` directly as a file, browsers block silent overwrites. Use `run-annotator.sh` for the Save app data JSON button to overwrite the app data file.
