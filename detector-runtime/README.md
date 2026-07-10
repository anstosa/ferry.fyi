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
