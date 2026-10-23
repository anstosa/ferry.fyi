# Detector runtime

CPU-only Python HTTP service for image object detection. It keeps raw images in memory only and returns normalized detection boxes.

## API

- `GET /health` returns `{ "status": "ok", "provider": "..." }` without loading the model.
- `GET /ready` loads the configured model and returns `{ "status": "ready", "provider": "..." }`.
- `POST /detect` accepts image bytes as the request body and returns:

```json
{
  "detections": [
    {
      "label": "car",
      "confidence": 0.92,
      "box": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4 }
    }
  ]
}
```

Pass `X-Detection-Areas` as JSON with `allowedAreas` and `excludedAreas` polygon collections to crop detection to the bounding box of countable pixels and black out exclusions. Returned boxes remain normalized to the original image.

### Camera image preprocessing

`POST /prepare` prepares a camera frame for the private OpenAI line-estimation pipeline without loading or calling YOLO. Send the raw image bytes with:

- `X-Camera-Id`: the camera identifier.
- `X-Detection-Areas`: JSON containing at least one `allowedAreas` entry. Each allowed entry requires a unique `id`, a non-empty `label`, and a normalized polygon. `excludedAreas` entries require a polygon and may include an ID/label.
- Optional `frameSize: { "width": ..., "height": ... }` inside `X-Detection-Areas`. When supplied, it must exactly match the decoded source dimensions; mismatches return HTTP 400 instead of applying stale geometry.

The endpoint masks all non-target and excluded pixels, chooses the minimum-area enclosing rotation at native scale, tightly crops the result, and adds thin colored lane-section outlines plus PNG identity metadata. It does not stretch, perspective-warp, resize, archive, or infer over the image. The response is:

```json
{
  "imageBase64": "<base64 PNG without a data-URL prefix>",
  "fingerprint": "<canonical SHA-256>",
  "width": 128,
  "height": 64,
  "sourceWidth": 335,
  "sourceHeight": 249,
  "rotationDegrees": -12.5,
  "laneIds": ["lane-section-id"]
}
```

The fingerprint covers decoded RGB pixels only where the canonical include/exclude mask is countable, along with source dimensions, lane IDs, and normalized area geometry. Labels, annotations, encoded-file differences, and pixels outside the target mask do not affect it. The PNG stores `cameraId`, `laneAnnotations`, and `rotationDegrees` text metadata; `laneAnnotations` maps compact visual markers and outline colors back to the returned lane IDs.

## Runtime

Default provider is `ultralytics-yolo` with the checksum-verified baked `/app/models/yolov8n.pt` weights on CPU. Swap implementations with `DETECTOR_PROVIDER`; use `noop` for health/smoke-only startup without model loading.

Environment:

- `DETECTOR_PROVIDER=ultralytics-yolo|noop`
- `DETECTOR_MODEL=/app/models/yolov8n.pt`
- `DETECTOR_CONFIDENCE=0.25`
- `PORT=8000`

## Local checks

```sh
cd detector-runtime
PYTHONPATH=. pytest -q
DETECTOR_PROVIDER=noop PORT=8000 uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Docker

```sh
docker build -t ferry-fyi-detector -f detector-runtime/Dockerfile detector-runtime
docker run --rm -p 8000:8000 ferry-fyi-detector
```
