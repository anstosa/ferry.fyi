"""CPU-only image detection HTTP runtime."""

from __future__ import annotations

import io
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from fastapi import FastAPI, HTTPException, Request
from PIL import Image, ImageDraw, UnidentifiedImageError


# detection box shape
@dataclass(frozen=True)
class PixelBox:
    x: float
    y: float
    width: float
    height: float


# provider result shape
@dataclass(frozen=True)
class PixelDetection:
    label: str
    confidence: float
    box: PixelBox


# detector crop metadata
@dataclass(frozen=True)
class DetectionImage:
    image: Image.Image
    offset_x: int
    offset_y: int


# provider contract
class DetectorProvider(Protocol):
    # provider name
    @property
    def name(self) -> str:
        ...

    # readiness check
    def ready(self) -> None:
        ...

    # run detection
    def detect(self, image: Image.Image) -> list[PixelDetection]:
        ...


# ultralytics implementation
class UltralyticsYoloProvider:
    # provider setup
    def __init__(self, model_name: str, confidence_threshold: float) -> None:
        self.model_name = model_name
        self.confidence_threshold = confidence_threshold
        self._model = None

    # provider name
    @property
    def name(self) -> str:
        return "ultralytics-yolo"

    # lazy model load
    def _load_model(self):
        from ultralytics import YOLO

        # model cache
        if self._model is None:
            self._model = YOLO(self.model_name)

        return self._model

    # readiness model load
    def ready(self) -> None:
        self._load_model()

    # run detection
    def detect(self, image: Image.Image) -> list[PixelDetection]:
        model = self._load_model()
        rgb_image = image.convert("RGB")
        results = model.predict(
            rgb_image,
            conf=self.confidence_threshold,
            device="cpu",
            verbose=False,
        )
        detections: list[PixelDetection] = []

        # result batch
        for result in results:
            names = getattr(result, "names", {})
            boxes = getattr(result, "boxes", None)

            # empty image result
            if boxes is None:
                continue

            # detected boxes
            for box in boxes:
                xyxy = box.xyxy[0].tolist()
                confidence = float(box.conf[0])
                class_id = int(box.cls[0])
                label = str(names.get(class_id, class_id))
                detections.append(
                    PixelDetection(
                        label=label,
                        confidence=confidence,
                        box=PixelBox(
                            x=float(xyxy[0]),
                            y=float(xyxy[1]),
                            width=float(xyxy[2]) - float(xyxy[0]),
                            height=float(xyxy[3]) - float(xyxy[1]),
                        ),
                    ),
                )

        return detections


# test and fallback implementation
class NoopProvider:
    # provider name
    @property
    def name(self) -> str:
        return "noop"

    # always ready
    def ready(self) -> None:
        return None

    # return no detections
    def detect(self, image: Image.Image) -> list[PixelDetection]:
        return []


# numeric clamp
def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


# normalized response conversion
def serialize_detection(detection: PixelDetection, image: Image.Image) -> dict:
    image_width, image_height = image.size
    left = clamp(detection.box.x / image_width)
    top = clamp(detection.box.y / image_height)
    right = clamp((detection.box.x + detection.box.width) / image_width)
    bottom = clamp((detection.box.y + detection.box.height) / image_height)

    return {
        "label": detection.label,
        "confidence": clamp(detection.confidence),
        "box": {
            "x": round(left, 6),
            "y": round(top, 6),
            "width": round(max(0.0, right - left), 6),
            "height": round(max(0.0, bottom - top), 6),
        },
    }


# image decode
def decode_image(image_bytes: bytes) -> Image.Image:
    # empty body guard
    if not image_bytes:
        raise HTTPException(status_code=400, detail="request body must contain image bytes")

    # image parse
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
        return image
    except UnidentifiedImageError as error:
        raise HTTPException(status_code=400, detail="request body is not a supported image") from error


# validate one normalized polygon
def parse_polygon(value: object) -> list[tuple[float, float]]:
    # list guard
    if not isinstance(value, list) or len(value) < 3:
        raise ValueError("polygons must contain at least three points")
    polygon: list[tuple[float, float]] = []
    # point scan
    for point in value:
        # point shape guard
        if (
            not isinstance(point, list)
            or len(point) != 2
            or not all(isinstance(coordinate, (int, float)) for coordinate in point)
        ):
            raise ValueError("polygon points must be numeric [x, y] pairs")
        polygon.append((clamp(float(point[0])), clamp(float(point[1]))))
    return polygon


# parse area-mask request header
def parse_detection_areas(header: str | None) -> tuple[list[list[tuple[float, float]]], list[list[tuple[float, float]]]] | None:
    # no mask guard
    if header is None:
        return None
    try:
        payload = json.loads(header)
        # object guard
        if not isinstance(payload, dict):
            raise ValueError("detection area mask must be an object")
        allowed_areas = payload.get("allowedAreas", [])
        excluded_areas = payload.get("excludedAreas", [])
        # collection guard
        if not isinstance(allowed_areas, list) or not isinstance(excluded_areas, list):
            raise ValueError("detection areas must be arrays")
        return (
            [parse_polygon(area["polygon"]) for area in allowed_areas if isinstance(area, dict)],
            [parse_polygon(area["polygon"]) for area in excluded_areas if isinstance(area, dict)],
        )
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"invalid X-Detection-Areas header: {error}") from error


# mask and crop countable image pixels
def prepare_detection_image(
    image: Image.Image,
    areas: tuple[list[list[tuple[float, float]]], list[list[tuple[float, float]]]] | None,
) -> DetectionImage:
    # unmasked guard
    if areas is None:
        return DetectionImage(image=image, offset_x=0, offset_y=0)
    allowed_areas, excluded_areas = areas
    width, height = image.size
    # convert normalized points
    def pixels(polygon: list[tuple[float, float]]) -> list[tuple[int, int]]:
        return [(round(x * width), round(y * height)) for x, y in polygon]

    mask = Image.new("L", image.size, color=0)
    draw = ImageDraw.Draw(mask)
    # inclusion pass
    for polygon in allowed_areas:
        draw.polygon(pixels(polygon), fill=255)
    # exclusion pass
    for polygon in excluded_areas:
        draw.polygon(pixels(polygon), fill=0)
    bbox = mask.getbbox()
    # empty selection guard
    if bbox is None:
        return DetectionImage(Image.new("RGB", (1, 1), color="black"), 0, 0)
    left, top, right, bottom = bbox
    cropped_image = image.crop(bbox)
    cropped_mask = mask.crop(bbox)
    masked_image = Image.new("RGB", cropped_image.size, color="black")
    masked_image.paste(cropped_image, mask=cropped_mask)
    return DetectionImage(masked_image, left, top)


# restore crop-relative detection coordinates
def offset_detection(detection: PixelDetection, offset_x: int, offset_y: int) -> PixelDetection:
    return PixelDetection(
        label=detection.label,
        confidence=detection.confidence,
        box=PixelBox(
            x=detection.box.x + offset_x,
            y=detection.box.y + offset_y,
            width=detection.box.width,
            height=detection.box.height,
        ),
    )


# env provider selection
def build_provider() -> DetectorProvider:
    provider_name = os.getenv("DETECTOR_PROVIDER", "ultralytics-yolo")

    # noop provider for smoke tests
    if provider_name == "noop":
        return NoopProvider()

    # default cpu detector
    if provider_name == "ultralytics-yolo":
        model_name = os.getenv("DETECTOR_MODEL", "yolov8n.pt")
        confidence_threshold = float(os.getenv("DETECTOR_CONFIDENCE", "0.25"))
        return UltralyticsYoloProvider(model_name, confidence_threshold)

    raise RuntimeError(f"unsupported detector provider: {provider_name}")


# cached provider
@lru_cache(maxsize=1)
def get_provider() -> DetectorProvider:
    return build_provider()


# app factory
def create_app(provider: DetectorProvider | None = None) -> FastAPI:
    app = FastAPI(title="ferry.fyi detector runtime", version="0.1.0")

    # provider resolver
    def resolve_provider() -> DetectorProvider:
        # injected provider
        if provider is not None:
            return provider

        return get_provider()

    # health endpoint
    @app.get("/health")
    def health() -> dict:
        detector = resolve_provider()
        return {"status": "ok", "provider": detector.name}

    # readiness endpoint
    @app.get("/ready")
    def ready() -> dict:
        detector = resolve_provider()

        # model load check
        try:
            detector.ready()
        except Exception as error:
            raise HTTPException(status_code=503, detail="detector is not ready") from error

        return {"status": "ready", "provider": detector.name}

    # detection endpoint
    @app.post("/detect")
    async def detect(request: Request) -> dict:
        image_bytes = await request.body()
        image = decode_image(image_bytes)
        areas = parse_detection_areas(request.headers.get("X-Detection-Areas"))
        detection_image = prepare_detection_image(image, areas)
        detector = resolve_provider()
        detections = detector.detect(detection_image.image)
        response_detections = []

        # response serialization
        for detection in detections:
            response_detections.append(
                serialize_detection(
                    offset_detection(
                        detection,
                        detection_image.offset_x,
                        detection_image.offset_y,
                    ),
                    image,
                )
            )

        return {"detections": response_detections}

    return app


# default app
app = create_app()
